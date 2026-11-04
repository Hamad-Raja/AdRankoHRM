BEGIN;
ALTER TYPE "NotificationType" ADD VALUE 'LEAVE';
CREATE TABLE leave_requests (
 id uuid PRIMARY KEY, "employeeId" uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "requestedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "shiftDate" date NOT NULL, "calendarMonth" varchar(7) NOT NULL, reason varchar(1000) NOT NULL,
 status varchar(12) NOT NULL DEFAULT 'PENDING', version integer NOT NULL DEFAULT 1,
 "startsAt" timestamptz(3) NOT NULL, "endsAt" timestamptz(3) NOT NULL,
 "reviewedByUserId" uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "reviewedAt" timestamptz(3), "reviewReason" varchar(1000),
 "cancelledByUserId" uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "cancelledAt" timestamptz(3), "cancellationReason" varchar(1000),
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamptz(3) NOT NULL,
 CONSTRAINT leave_values CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED') AND version>0 AND btrim(reason)<>''
 AND "calendarMonth"=to_char("shiftDate",'YYYY-MM') AND extract(isodow FROM "shiftDate") BETWEEN 1 AND 5
 AND "startsAt"=("shiftDate"+time '19:00') AT TIME ZONE 'Asia/Karachi'
 AND "endsAt"=(("shiftDate"+1)+time '05:00') AT TIME ZONE 'Asia/Karachi')
);
CREATE UNIQUE INDEX leave_monthly_slot ON leave_requests("employeeId","calendarMonth") WHERE status IN ('PENDING','APPROVED');
CREATE INDEX leave_employee_month_idx ON leave_requests("employeeId","calendarMonth");
CREATE INDEX leave_status_date_idx ON leave_requests(status,"shiftDate");
CREATE TABLE leave_history (
 id uuid PRIMARY KEY, "requestId" uuid NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "actorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action varchar(20) NOT NULL, reason varchar(1000) NOT NULL CHECK(btrim(reason)<>''), version integer NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX leave_history_version_key ON leave_history("requestId",version);

CREATE FUNCTION leave_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reviewer uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Leave evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."employeeId"::text,413));
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>1 OR NEW."reviewedAt" IS NOT NULL OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewReason" IS NOT NULL OR NEW."cancelledAt" IS NOT NULL OR NEW."cancelledByUserId" IS NOT NULL OR NEW."cancellationReason" IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON e."userId"=u.id WHERE e.id=NEW."employeeId" AND u.id=NEW."requestedByUserId" AND u.status='ACTIVE' AND NOT u."mustChangePassword")
  THEN RAISE EXCEPTION 'Invalid leave ownership/defaults' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','updatedAt','reviewedByUserId','reviewedAt','reviewReason','cancelledByUserId','cancelledAt','cancellationReason']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','version','updatedAt','reviewedByUserId','reviewedAt','reviewReason','cancelledByUserId','cancelledAt','cancellationReason']) OR NEW.version<>OLD.version+1
   THEN RAISE EXCEPTION 'Leave identity/date/reason is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED') THEN
   reviewer=NEW."reviewedByUserId";
   IF NEW."reviewedAt" IS NULL OR coalesce(btrim(NEW."reviewReason"),'')='' OR NEW."cancelledAt" IS NOT NULL OR NEW."cancelledByUserId" IS NOT NULL OR NEW."cancellationReason" IS NOT NULL THEN RAISE EXCEPTION 'Review provenance required' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status IN ('PENDING','APPROVED') AND NEW.status='CANCELLED' THEN
   IF ROW(NEW."reviewedByUserId",NEW."reviewedAt",NEW."reviewReason") IS DISTINCT FROM ROW(OLD."reviewedByUserId",OLD."reviewedAt",OLD."reviewReason") OR NEW."cancelledAt" IS NULL OR coalesce(btrim(NEW."cancellationReason"),'')='' THEN RAISE EXCEPTION 'Cancellation provenance required' USING ERRCODE='23514'; END IF;
   IF OLD.status='PENDING' THEN
    IF NEW."cancelledByUserId" IS DISTINCT FROM NEW."requestedByUserId" OR NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON e."userId"=u.id WHERE e.id=NEW."employeeId" AND u.id=NEW."cancelledByUserId" AND u.status='ACTIVE' AND NOT u."mustChangePassword") THEN RAISE EXCEPTION 'Only the current owner may withdraw pending leave' USING ERRCODE='23514'; END IF;
   ELSE reviewer=NEW."cancelledByUserId"; END IF;
  ELSE RAISE EXCEPTION 'Invalid leave transition' USING ERRCODE='23514'; END IF;
  IF reviewer IS NOT NULL AND (reviewer=NEW."requestedByUserId" OR EXISTS(SELECT 1 FROM employees WHERE id=NEW."employeeId" AND "userId"=reviewer) OR NOT EXISTS(SELECT 1 FROM users WHERE id=reviewer AND role='HR' AND status='ACTIVE' AND NOT "mustChangePassword")) THEN RAISE EXCEPTION 'Distinct eligible HR required' USING ERRCODE='23514'; END IF;
  IF reviewer IS NULL AND NEW.status IN ('APPROVED','REJECTED') OR NEW.status='CANCELLED' AND NEW."cancelledByUserId" IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='23514'; END IF;
 END IF;
 IF (TG_OP='INSERT' OR NEW.status IN ('APPROVED','CANCELLED')) AND NEW."startsAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Duty has already started' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('PENDING','APPROVED') THEN
  IF EXISTS(SELECT 1 FROM attendance_records WHERE "employeeId"=NEW."employeeId" AND "shiftDate"=NEW."shiftDate") OR EXISTS(SELECT 1 FROM attendance_correction_requests WHERE "employeeId"=NEW."employeeId" AND "shiftDate"=NEW."shiftDate" AND status IN ('PENDING','APPROVED')) THEN RAISE EXCEPTION 'Attendance conflicts with leave' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER leave_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON leave_requests FOR EACH ROW EXECUTE FUNCTION leave_lifecycle_guard();
CREATE FUNCTION leave_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Leave history is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM leave_requests WHERE id=NEW."requestId" AND version=NEW.version) THEN RAISE EXCEPTION 'History version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER leave_history_guard BEFORE INSERT OR UPDATE OR DELETE ON leave_history FOR EACH ROW EXECUTE FUNCTION leave_history_guard();
CREATE FUNCTION leave_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."employeeId"::text,413));
 IF (TG_TABLE_NAME='attendance_records' OR NEW.status::text IN ('PENDING','APPROVED')) AND EXISTS(SELECT 1 FROM leave_requests WHERE "employeeId"=NEW."employeeId" AND "shiftDate"=NEW."shiftDate" AND status='APPROVED') THEN RAISE EXCEPTION 'Approved full-day leave conflicts with attendance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER leave_attendance_guard BEFORE INSERT ON attendance_records FOR EACH ROW EXECUTE FUNCTION leave_attendance_guard();
CREATE TRIGGER leave_attendance_guard BEFORE INSERT OR UPDATE ON attendance_correction_requests FOR EACH ROW EXECUTE FUNCTION leave_attendance_guard();
CREATE FUNCTION leave_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."targetType"='Leave' THEN RAISE EXCEPTION 'Leave audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER leave_audit_guard BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION leave_audit_guard();
COMMIT;
