BEGIN;
-- Additive: no policy defaults or historical/employee assignment backfill.
CREATE TABLE office_schedules (
  id UUID PRIMARY KEY,
  "effectiveFrom" DATE NOT NULL UNIQUE,
  "startTime" VARCHAR(5) NOT NULL DEFAULT '19:00',
  "endTime" VARCHAR(5) NOT NULL DEFAULT '05:00',
  "endsNextDay" BOOLEAN NOT NULL DEFAULT true,
  policy JSONB NOT NULL,
  "actorUserId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reason VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT office_schedule_duty CHECK ("startTime" = '19:00' AND "endTime" = '05:00' AND "endsNextDay"),
  CONSTRAINT office_schedule_values CHECK ("effectiveFrom" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND length(trim(reason)) > 0 AND jsonb_typeof(policy) = 'object')
);
CREATE FUNCTION office_schedule_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Office schedule history is immutable; append a new effective version' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER office_schedule_history_guard BEFORE UPDATE OR DELETE ON office_schedules
FOR EACH ROW EXECUTE FUNCTION office_schedule_history_guard();
COMMIT;
