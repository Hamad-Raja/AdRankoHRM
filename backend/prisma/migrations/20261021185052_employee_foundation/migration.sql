BEGIN;

-- Enable UUID equality alongside date ranges in GiST constraints.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM (
    'PROBATION',
    'ACTIVE',
    'NOTICE_PERIOD',
    'SUSPENDED',
    'EXITED'
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employeeCode" VARCHAR(30) NOT NULL,
    "userId" UUID,
    "fullName" VARCHAR(120) NOT NULL,
    "personalEmail" VARCHAR(254),
    "phone" VARCHAR(32),
    "address" VARCHAR(1000),
    "emergencyContactName" VARCHAR(120),
    "emergencyContactPhone" VARCHAR(32),
    "emergencyContactRelationship" VARCHAR(60),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_episodes" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "EmploymentStatus" NOT NULL,
    "statusEffectiveDate" DATE NOT NULL,
    "probationEndDate" DATE,
    "confirmedOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employment_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_status_events" (
    "id" UUID NOT NULL,
    "employmentEpisodeId" UUID NOT NULL,
    "fromStatus" "EmploymentStatus",
    "toStatus" "EmploymentStatus" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key"
ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key"
ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_fullName_id_idx"
ON "employees"("fullName", "id");

-- CreateIndex
CREATE INDEX "employment_episodes_employeeId_status_idx"
ON "employment_episodes"("employeeId", "status");

-- CreateIndex
CREATE INDEX "employment_episodes_status_startDate_idx"
ON "employment_episodes"("status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "employment_episodes_employeeId_startDate_key"
ON "employment_episodes"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "employment_status_timeline_idx"
ON "employment_status_events"(
    "employmentEpisodeId",
    "effectiveDate",
    "createdAt"
);

-- CreateIndex
CREATE INDEX "employment_status_actor_idx"
ON "employment_status_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "employment_status_events_approvedByUserId_idx"
ON "employment_status_events"("approvedByUserId");

-- AddForeignKey
ALTER TABLE "employees"
ADD CONSTRAINT "employees_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_episodes"
ADD CONSTRAINT "employment_episodes_employeeId_fkey"
FOREIGN KEY ("employeeId")
REFERENCES "employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_events"
ADD CONSTRAINT "employment_status_events_employmentEpisodeId_fkey"
FOREIGN KEY ("employmentEpisodeId")
REFERENCES "employment_episodes"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_events"
ADD CONSTRAINT "employment_status_events_actorUserId_fkey"
FOREIGN KEY ("actorUserId")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_events"
ADD CONSTRAINT "employment_status_events_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Employee identity and optimistic-concurrency checks.
ALTER TABLE "employees"
ADD CONSTRAINT "employees_code_not_blank"
CHECK (length(btrim("employeeCode")) > 0),
ADD CONSTRAINT "employees_name_not_blank"
CHECK (length(btrim("fullName")) > 0),
ADD CONSTRAINT "employees_version_positive"
CHECK ("version" > 0);

-- Employment dates must be real, finite calendar dates.
ALTER TABLE "employment_episodes"
ADD CONSTRAINT "employment_episodes_finite_dates"
CHECK (
    isfinite("startDate")
    AND isfinite("statusEffectiveDate")
    AND ("endDate" IS NULL OR isfinite("endDate"))
    AND ("probationEndDate" IS NULL OR isfinite("probationEndDate"))
    AND ("confirmedOn" IS NULL OR isfinite("confirmedOn"))
);

-- End date represents the actual, inclusive last working date.
ALTER TABLE "employment_episodes"
ADD CONSTRAINT "employment_episodes_date_order"
CHECK (
    "endDate" IS NULL
    OR "endDate" >= "startDate"
),
ADD CONSTRAINT "employment_episodes_status_date_bounds"
CHECK (
    "statusEffectiveDate" >= "startDate"
    AND (
        "endDate" IS NULL
        OR "statusEffectiveDate" <= "endDate"
    )
),
ADD CONSTRAINT "employment_episodes_probation_date_bounds"
CHECK (
    "probationEndDate" IS NULL
    OR "probationEndDate" >= "startDate"
),
ADD CONSTRAINT "employment_episodes_confirmation_date_bounds"
CHECK (
    "confirmedOn" IS NULL
    OR (
        "confirmedOn" >= "startDate"
        AND (
            "endDate" IS NULL
            OR "confirmedOn" <= "endDate"
        )
    )
),
ADD CONSTRAINT "employment_episodes_version_positive"
CHECK ("version" > 0);

-- An episode is closed only when its current status is EXITED.
-- Planned exits remain NOTICE_PERIOD until the actual exit is recorded.
ALTER TABLE "employment_episodes"
ADD CONSTRAINT "employment_episodes_exit_consistency"
CHECK (
    (
        "status" = 'EXITED'
        AND "endDate" IS NOT NULL
        AND "statusEffectiveDate" = "endDate"
    )
    OR
    (
        "status" <> 'EXITED'
        AND "endDate" IS NULL
    )
);

-- Prevent overlapping employment periods for the same employee.
-- [] includes both the joining date and the last working date.
-- A NULL endDate leaves the period open, preventing another
-- employment episode until the existing episode has been closed.
ALTER TABLE "employment_episodes"
ADD CONSTRAINT "employment_episodes_no_overlap"
EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
);

-- Status-event integrity checks.
-- A NULL fromStatus is allowed for the initial employment event.
ALTER TABLE "employment_status_events"
ADD CONSTRAINT "employment_status_events_reason_not_blank"
CHECK (length(btrim("reason")) > 0),
ADD CONSTRAINT "employment_status_events_finite_date"
CHECK (isfinite("effectiveDate")),
ADD CONSTRAINT "employment_status_events_status_changed"
CHECK (
    "fromStatus" IS NULL
    OR "fromStatus" <> "toStatus"
),
ADD CONSTRAINT "employment_status_events_approval_pair"
CHECK (
    (
        "approvedByUserId" IS NULL
        AND "approvedAt" IS NULL
    )
    OR
    (
        "approvedByUserId" IS NOT NULL
        AND "approvedAt" IS NOT NULL
    )
);

COMMIT;