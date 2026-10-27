BEGIN;

-- This migration creates new objects only. It neither rewrites nor deletes
-- any existing user, employee, employment, organization or audit row.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE FUNCTION "officehr_shift_valid_weekdays"(days INTEGER[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT cardinality(days) BETWEEN 1 AND 7
    AND array_ndims(days) = 1
    AND array_lower(days, 1) = 1
    AND array_position(days, NULL) IS NULL
    AND days <@ ARRAY[1,2,3,4,5,6,7]
    AND cardinality(days) = (SELECT count(DISTINCT d) FROM unnest(days) AS d);
$$;

CREATE TABLE "shift_definitions" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "timeZone" VARCHAR(80) NOT NULL,
  "startTime" VARCHAR(5) NOT NULL,
  "endTime" VARCHAR(5) NOT NULL,
  "endsNextDay" BOOLEAN NOT NULL,
  "workDays" INTEGER[] NOT NULL,
  "breakMinutes" INTEGER NOT NULL,
  "breakPaid" BOOLEAN,
  "graceMinutes" INTEGER NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  "actorUserId" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shift_definitions_actorUserId_fkey" FOREIGN KEY ("actorUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shift_clock_format" CHECK (
    "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
    "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "shift_work_days" CHECK ("officehr_shift_valid_weekdays"("workDays")),
  CONSTRAINT "shift_nonblank_text" CHECK (length(trim("name")) > 0 AND length(trim("reason")) > 0),
  CONSTRAINT "shift_duration_and_allowances" CHECK (
    (extract(epoch FROM ("endTime"::TIME - "startTime"::TIME)) / 60 +
      CASE WHEN "endsNextDay" THEN 1440 ELSE 0 END) BETWEEN 1 AND 1439 AND
    "breakMinutes" >= 0 AND "graceMinutes" >= 0 AND
    "breakMinutes" < (extract(epoch FROM ("endTime"::TIME - "startTime"::TIME)) / 60 + CASE WHEN "endsNextDay" THEN 1440 ELSE 0 END) AND
    "graceMinutes" < (extract(epoch FROM ("endTime"::TIME - "startTime"::TIME)) / 60 + CASE WHEN "endsNextDay" THEN 1440 ELSE 0 END) AND
    (("breakMinutes" = 0 AND "breakPaid" IS NULL) OR ("breakMinutes" > 0 AND "breakPaid" IS NOT NULL)))
);
CREATE UNIQUE INDEX "shift_definitions_name_key" ON "shift_definitions"("name");
CREATE INDEX "shift_definitions_archivedAt_name_idx" ON "shift_definitions"("archivedAt", "name");

CREATE TABLE "employee_shift_assignments" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "employmentEpisodeId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "actorUserId" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "closedByUserId" UUID,
  "closedReason" VARCHAR(1000),
  "closedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_shift_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_shift_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_shift_assignments_employmentEpisodeId_fkey" FOREIGN KEY ("employmentEpisodeId") REFERENCES "employment_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_shift_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_shift_assignments_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_shift_assignments_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shift_assignment_dates" CHECK (
    "effectiveFrom" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND
    ("effectiveTo" IS NULL OR ("effectiveTo" BETWEEN "effectiveFrom" AND DATE '9999-12-31'))),
  CONSTRAINT "shift_assignment_reason" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "shift_assignment_closure" CHECK (
    ("closedByUserId" IS NULL AND "closedReason" IS NULL AND "closedAt" IS NULL) OR
    ("closedByUserId" IS NOT NULL AND "closedReason" IS NOT NULL AND length(trim("closedReason")) > 0 AND "closedAt" IS NOT NULL AND "effectiveTo" IS NOT NULL)),
  CONSTRAINT "shift_assignment_no_overlap" EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[]') WITH &&)
);
CREATE INDEX "employee_shift_assignments_employeeId_effectiveFrom_idx" ON "employee_shift_assignments"("employeeId", "effectiveFrom");
CREATE INDEX "employee_shift_assignments_shiftId_effectiveFrom_idx" ON "employee_shift_assignments"("shiftId", "effectiveFrom");
CREATE INDEX "employee_shift_assignments_employmentEpisodeId_idx" ON "employee_shift_assignments"("employmentEpisodeId");

-- Shift definitions are immutable; only a one-way archive is allowed.
CREATE FUNCTION "officehr_shift_definition_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shift definitions cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'archivedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'archivedAt')
     OR OLD."archivedAt" IS NOT NULL OR NEW."archivedAt" IS NULL THEN
    RAISE EXCEPTION 'Create a new shift definition to change its schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "shift_definition_guard" BEFORE UPDATE OR DELETE ON "shift_definitions"
  FOR EACH ROW EXECUTE FUNCTION "officehr_shift_definition_guard"();

CREATE FUNCTION "officehr_shift_assignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shift history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."effectiveTo" IS NOT NULL OR NEW."effectiveTo" IS NULL OR NEW."closedByUserId" IS NULL
       OR (to_jsonb(NEW) - ARRAY['effectiveTo','closedByUserId','closedReason','closedAt'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['effectiveTo','closedByUserId','closedReason','closedAt']) THEN
      RAISE EXCEPTION 'Only an audited open-interval closure is allowed' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "shift_definitions" WHERE "id" = NEW."shiftId" AND "archivedAt" IS NULL) THEN
      RAISE EXCEPTION 'New assignments require an active shift' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT "employeeId", "startDate", "endDate" INTO episode FROM "employment_episodes" WHERE "id" = NEW."employmentEpisodeId";
  IF NOT FOUND OR episode."employeeId" <> NEW."employeeId" OR NEW."effectiveFrom" < episode."startDate"
     OR (episode."endDate" IS NOT NULL AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo" > episode."endDate")) THEN
    RAISE EXCEPTION 'Shift assignment must belong to and fit its employment episode' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "shift_assignment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "employee_shift_assignments"
  FOR EACH ROW EXECUTE FUNCTION "officehr_shift_assignment_guard"();

COMMIT;