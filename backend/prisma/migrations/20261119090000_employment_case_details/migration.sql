BEGIN;
-- Additive, nullable fields: do not invent values for historical cases.
-- Apply with the existing deployment migration process BEFORE deploying the new client.
ALTER TABLE employment_cases
 ADD COLUMN "hrRemarks" varchar(1000),
 ADD COLUMN "preparationReason" varchar(1000),
 ADD COLUMN "terminationCategory" varchar(32),
 ADD COLUMN "companyDecisionDate" date,
 ADD COLUMN "employmentEndDate" date,
 ADD COLUMN "noticeHandling" varchar(32),
 ADD CONSTRAINT employment_case_category CHECK ("terminationCategory" IS NULL OR "terminationCategory" IN ('PERFORMANCE','CONDUCT','ROLE_REDUNDANCY','CONTRACT_END','OTHER')),
 ADD CONSTRAINT employment_case_notice_handling CHECK ("noticeHandling" IS NULL OR "noticeHandling" IN ('WORKED','WAIVED','PAYMENT_IN_LIEU','OTHER')),
 ADD CONSTRAINT employment_case_calendar_end CHECK ("employmentEndDate" IS NULL OR "confirmedLastDate" IS NOT NULL AND "employmentEndDate">="confirmedLastDate" AND "accessCutoff" IS NOT NULL AND "employmentEndDate"=("accessCutoff" AT TIME ZONE 'Asia/Karachi')::date),
 ADD CONSTRAINT employment_case_private_text CHECK (("hrRemarks" IS NULL OR length(btrim("hrRemarks"))>0) AND ("preparationReason" IS NULL OR length(btrim("preparationReason"))>0));
-- noticeDays already has an integer 0..365 constraint. Episode endDate remains
-- the inclusive final DUTY START date. employmentEndDate records the calendar
-- date of the approved Karachi cutoff; it does not create another eligible duty.
COMMIT;
