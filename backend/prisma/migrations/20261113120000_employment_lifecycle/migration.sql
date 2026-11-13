BEGIN;
-- Additive lifecycle persistence. Existing business rows are not backfilled.
CREATE TABLE employment_cases (
 id uuid PRIMARY KEY, "employeeId" uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 "episodeId" uuid REFERENCES employment_episodes(id) ON DELETE RESTRICT,
 "resultEpisodeId" uuid REFERENCES employment_episodes(id) ON DELETE RESTRICT,
 kind varchar(20) NOT NULL CHECK (kind IN ('RESIGNATION','TERMINATION','REHIRE')),
 state varchar(24) NOT NULL CHECK (state IN ('MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL','APPROVED','COMPLETED','WITHDRAWN','CANCELLED','REJECTED')),
 source varchar(20) NOT NULL CHECK (source IN ('SELF','HR_RECORDED','COMPANY')),
 "recordedById" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "employeeUserId" uuid REFERENCES users(id) ON DELETE RESTRICT,
 reason varchar(1000) NOT NULL CHECK (length(btrim(reason))>0),
 "submittedAt" timestamptz(3) NOT NULL DEFAULT now(), "receivedDate" date,
 "proposedLastDate" date, "confirmedLastDate" date, "noticeDays" integer CHECK ("noticeDays" BETWEEN 0 AND 365),
 "finalShiftStart" timestamptz(3), "accessCutoff" timestamptz(3),
 "supportingDocumentId" uuid REFERENCES employee_documents(id) ON DELETE RESTRICT,
 "supportingInfo" varchar(1000), "managerReviewerId" uuid REFERENCES users(id) ON DELETE RESTRICT,
 "managerReviewedAt" timestamptz(3), "managerNote" varchar(1000), "fallbackReason" varchar(1000),
 "preparedById" uuid REFERENCES users(id) ON DELETE RESTRICT,
 "approvedById" uuid REFERENCES users(id) ON DELETE RESTRICT, "approvedAt" timestamptz(3),
 "overrideReason" varchar(1000), "handoverStatus" varchar(20) NOT NULL DEFAULT 'NOT_STARTED' CHECK ("handoverStatus" IN ('NOT_STARTED','IN_PROGRESS','COMPLETE')),
 "clearanceStatus" varchar(20) NOT NULL DEFAULT 'PENDING' CHECK ("clearanceStatus" IN ('PENDING','COMPLETE')),
 "rehirePlan" jsonb, "completedAt" timestamptz(3), version integer NOT NULL DEFAULT 1 CHECK (version>0),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT employment_case_cutoff CHECK (kind='REHIRE' OR "accessCutoff" IS NULL OR "finalShiftStart" IS NOT NULL AND "accessCutoff">"finalShiftStart"),
 CONSTRAINT employment_case_distinct_approval CHECK ("approvedById" IS NULL OR ("approvedById" IS DISTINCT FROM "recordedById" AND "approvedById" IS DISTINCT FROM "preparedById" AND "approvedById" IS DISTINCT FROM "employeeUserId")),
 CONSTRAINT employment_case_approval CHECK (state NOT IN ('APPROVED','COMPLETED') OR "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX employment_case_one_open ON employment_cases ("employeeId") WHERE state IN ('MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL','APPROVED');
CREATE INDEX employment_cases_state_accessCutoff_idx ON employment_cases(state,"accessCutoff");
CREATE INDEX employment_cases_employeeId_submittedAt_idx ON employment_cases("employeeId","submittedAt");
CREATE TABLE employment_access_controls (
 "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 "manualDisabledAt" timestamptz(3), "disabledById" uuid REFERENCES users(id) ON DELETE RESTRICT,
 reason varchar(1000), version integer NOT NULL DEFAULT 1 CHECK (version>0), "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
);
COMMIT;
