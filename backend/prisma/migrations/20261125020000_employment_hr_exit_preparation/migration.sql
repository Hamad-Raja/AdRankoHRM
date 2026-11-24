BEGIN;
-- No state/date/task backfill: legacy Manager Review cases can be prepared by HR
-- directly. Existing approved cases retain their exact old cutoff semantics.
ALTER TABLE employment_cases
 ADD COLUMN "noticeStartDate" date,
 ADD COLUMN "finalShiftEnd" timestamptz(3),
 ADD COLUMN "employmentEndsAt" timestamptz(3),
 ADD COLUMN "employmentEndedAt" timestamptz(3),
 ADD COLUMN "accessMode" varchar(24) NOT NULL DEFAULT 'SCHEDULED',
 ADD COLUMN "accessDisabledAt" timestamptz(3),
 DROP CONSTRAINT employment_case_cutoff,
 DROP CONSTRAINT employment_case_calendar_end,
 ADD CONSTRAINT employment_case_access_mode CHECK ("accessMode" IN ('SCHEDULED','ON_APPROVAL')),
 ADD CONSTRAINT employment_case_shift_end CHECK ("finalShiftEnd" IS NULL OR "finalShiftStart" IS NOT NULL AND "finalShiftEnd">"finalShiftStart" AND "finalShiftEnd"<="finalShiftStart"+interval '36 hours'),
 ADD CONSTRAINT employment_case_effective_end CHECK ("employmentEndsAt" IS NULL OR "finalShiftEnd" IS NOT NULL AND "employmentEndDate" IS NOT NULL AND "employmentEndsAt">="finalShiftEnd" AND "employmentEndDate"=("employmentEndsAt" AT TIME ZONE 'Asia/Karachi')::date),
 ADD CONSTRAINT employment_case_cutoff CHECK (kind='REHIRE' OR "accessCutoff" IS NULL OR "accessMode"='ON_APPROVAL' OR "finalShiftStart" IS NOT NULL AND "accessCutoff">"finalShiftStart");
CREATE INDEX employment_cases_pending_end_idx ON employment_cases ("employmentEndsAt") WHERE state='APPROVED' AND "employmentEndedAt" IS NULL;
CREATE FUNCTION employment_case_preparation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='RESIGNATION' AND ROW(NEW.source,NEW.reason,NEW."submittedAt",NEW."receivedDate",NEW."proposedLastDate") IS DISTINCT FROM ROW(OLD.source,OLD.reason,OLD."submittedAt",OLD."receivedDate",OLD."proposedLastDate") THEN
  RAISE EXCEPTION 'Original resignation proposal is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('APPROVED','COMPLETED') AND ROW(NEW.reason,NEW."submittedAt",NEW."terminationCategory",NEW."companyDecisionDate",NEW."noticeHandling",NEW."preparationReason",NEW."overrideReason",NEW."hrRemarks",NEW."supportingInfo",NEW."supportingDocumentId",NEW.kind,NEW.source,NEW."employeeId",NEW."episodeId",NEW."recordedById",NEW."employeeUserId",NEW."receivedDate",NEW."proposedLastDate",NEW."confirmedLastDate",NEW."noticeDays",NEW."noticeStartDate",NEW."finalShiftStart",NEW."finalShiftEnd",NEW."employmentEndsAt",NEW."employmentEndDate",NEW."accessMode",NEW."accessCutoff",NEW."preparedById",NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM ROW(OLD.reason,OLD."submittedAt",OLD."terminationCategory",OLD."companyDecisionDate",OLD."noticeHandling",OLD."preparationReason",OLD."overrideReason",OLD."hrRemarks",OLD."supportingInfo",OLD."supportingDocumentId",OLD.kind,OLD.source,OLD."employeeId",OLD."episodeId",OLD."recordedById",OLD."employeeUserId",OLD."receivedDate",OLD."proposedLastDate",OLD."confirmedLastDate",OLD."noticeDays",OLD."noticeStartDate",OLD."finalShiftStart",OLD."finalShiftEnd",OLD."employmentEndsAt",OLD."employmentEndDate",OLD."accessMode",OLD."accessCutoff",OLD."preparedById",OLD."approvedById",OLD."approvedAt") THEN
  RAISE EXCEPTION 'Approved exit values require a new reviewed decision, not a silent edit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employment_case_preparation_guard BEFORE UPDATE ON employment_cases FOR EACH ROW EXECUTE FUNCTION employment_case_preparation_guard();
COMMIT;
