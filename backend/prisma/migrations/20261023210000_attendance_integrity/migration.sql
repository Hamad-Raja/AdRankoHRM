BEGIN;
ALTER TABLE attendance_records ADD COLUMN "officeScheduleId" uuid REFERENCES office_schedules(id) ON DELETE RESTRICT;
ALTER TABLE attendance_records ADD COLUMN "approvedAdjustment" jsonb;
CREATE UNIQUE INDEX attendance_one_unresolved_session ON attendance_records ("employeeId") WHERE status IN ('OPEN', 'MISSING_CHECKOUT');
CREATE UNIQUE INDEX attendance_one_pending_correction ON attendance_correction_requests ("employeeId", "shiftDate") WHERE status = 'PENDING';
ALTER TABLE attendance_records ADD CONSTRAINT attendance_time_sequence CHECK (
  "scheduledEnd" > "scheduledStart" AND "clockInAt" >= "scheduledStart" AND "clockInAt" < "scheduledEnd"
  AND ("clockOutAt" IS NULL OR "clockOutAt" >= "clockInAt")
  AND ("workedMinutes" IS NULL OR "workedMinutes" >= 0)
  AND "graceMinutes" >= 0
);
ALTER TABLE attendance_correction_requests ADD CONSTRAINT correction_time_sequence CHECK (
  "correctedClockIn" IS NULL OR "correctedClockOut" IS NULL OR "correctedClockOut" >= "correctedClockIn"
);
ALTER TABLE attendance_records ADD CONSTRAINT attendance_resolution CHECK (
  (status NOT IN ('OPEN','MISSING_CHECKOUT') OR "clockOutAt" IS NULL)
  AND (status <> 'COMPLETED' OR "clockOutAt" IS NOT NULL)
  AND (status <> 'CORRECTED' OR "approvedAdjustment" IS NOT NULL)
  AND ("clockOutAt" IS NULL OR ("clockOutRequestId" IS NOT NULL AND "clockOutActorUserId" IS NOT NULL))
);
CREATE FUNCTION attendance_validate_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employment_episodes e WHERE e.id=NEW."employmentEpisodeId" AND e."employeeId"=NEW."employeeId" AND e."startDate" <= NEW."shiftDate" AND (e."endDate" IS NULL OR e."endDate" >= NEW."shiftDate")) THEN
    RAISE EXCEPTION 'Attendance employment episode must cover this employee and duty';
  END IF;
  IF NEW."officeScheduleId" IS NULL THEN RAISE EXCEPTION 'An effective schedule reference is required for new attendance'; END IF;
  IF NEW."officeScheduleId" IS DISTINCT FROM (SELECT id FROM office_schedules WHERE "effectiveFrom" <= NEW."shiftDate" ORDER BY "effectiveFrom" DESC LIMIT 1) THEN RAISE EXCEPTION 'Attendance must reference the effective schedule for this duty date'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_validate_links BEFORE INSERT ON attendance_records FOR EACH ROW EXECUTE FUNCTION attendance_validate_links();
CREATE FUNCTION attendance_preserve_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance evidence cannot be deleted'; END IF;
  IF ROW(NEW."employeeId", NEW."employmentEpisodeId", NEW."shiftDate", NEW."scheduledStart", NEW."scheduledEnd", NEW."scheduleTimeZone", NEW."graceMinutes", NEW."clockInAt", NEW."clockInRequestId", NEW."clockInActorUserId", NEW."scheduleSnapshot", NEW."officeScheduleId")
    IS DISTINCT FROM ROW(OLD."employeeId", OLD."employmentEpisodeId", OLD."shiftDate", OLD."scheduledStart", OLD."scheduledEnd", OLD."scheduleTimeZone", OLD."graceMinutes", OLD."clockInAt", OLD."clockInRequestId", OLD."clockInActorUserId", OLD."scheduleSnapshot", OLD."officeScheduleId") THEN
    RAISE EXCEPTION 'Original attendance evidence is immutable';
  END IF;
  IF OLD."clockOutAt" IS NOT NULL AND ROW(NEW."clockOutAt", NEW."clockOutRequestId", NEW."clockOutActorUserId") IS DISTINCT FROM ROW(OLD."clockOutAt", OLD."clockOutRequestId", OLD."clockOutActorUserId") THEN
    RAISE EXCEPTION 'Original checkout is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_preserve_evidence BEFORE UPDATE OR DELETE ON attendance_records FOR EACH ROW EXECUTE FUNCTION attendance_preserve_evidence();
CREATE FUNCTION attendance_preserve_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Correction history cannot be deleted'; END IF;
  IF OLD.status <> 'PENDING' OR ROW(NEW."attendanceRecordId", NEW."employeeId", NEW."shiftDate", NEW."requestType", NEW."correctedClockIn", NEW."correctedClockOut", NEW.reason, NEW."requestedByUserId", NEW."originalData", NEW."createdAt") IS DISTINCT FROM ROW(OLD."attendanceRecordId", OLD."employeeId", OLD."shiftDate", OLD."requestType", OLD."correctedClockIn", OLD."correctedClockOut", OLD.reason, OLD."requestedByUserId", OLD."originalData", OLD."createdAt") THEN
    RAISE EXCEPTION 'Correction evidence and decisions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_preserve_correction BEFORE UPDATE OR DELETE ON attendance_correction_requests FOR EACH ROW EXECUTE FUNCTION attendance_preserve_correction();
COMMIT;
