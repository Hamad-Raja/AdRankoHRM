BEGIN;
ALTER TYPE "AnnouncementPriority" ADD VALUE 'IMPORTANT';
ALTER TABLE announcements ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE announcements ADD COLUMN category varchar(20) NOT NULL DEFAULT 'GENERAL',
 ADD COLUMN "audienceMode" varchar(20) NOT NULL DEFAULT 'ALL', ADD COLUMN "audienceRoles" "Role"[] NOT NULL DEFAULT '{}',
 ADD COLUMN "audienceTeamIds" uuid[] NOT NULL DEFAULT '{}', ADD COLUMN "audienceFrozen" boolean NOT NULL DEFAULT false,
 ADD COLUMN "legacyReview" boolean NOT NULL DEFAULT false, ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN "publishedByUserId" uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN "archivedByUserId" uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN "archivedAt" timestamptz(3), ADD COLUMN "archiveReason" varchar(1000), ADD COLUMN "replacesId" uuid REFERENCES announcements(id) ON DELETE RESTRICT;
-- Technical review flag only; original content, dates, receipts and audience fields stay untouched.
UPDATE announcements SET "legacyReview"=true;
ALTER TABLE announcements ADD CONSTRAINT announcement_values CHECK (category IN ('GENERAL','POLICY','HOLIDAY','EVENT') AND "audienceMode" IN ('ALL','ROLES','TEAMS','DEPARTMENTS') AND version>0);
CREATE TABLE announcement_recipients (
 "announcementId" uuid NOT NULL REFERENCES announcements(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY("announcementId","userId")
);
CREATE INDEX announcement_recipient_user_idx ON announcement_recipients("userId");
CREATE TABLE notification_events (
 id uuid PRIMARY KEY, "eventKey" varchar(200) NOT NULL, kind varchar(50) NOT NULL, "resourceId" uuid NOT NULL,
 "announcementId" uuid REFERENCES announcements(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX notification_event_key ON notification_events("eventKey");
ALTER TABLE notifications ADD COLUMN sequence bigserial NOT NULL,
 ADD COLUMN "eventId" uuid REFERENCES notification_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN "announcementId" uuid REFERENCES announcements(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN "dismissedAt" timestamptz(3);
CREATE UNIQUE INDEX notification_sequence_key ON notifications(sequence);
CREATE UNIQUE INDEX notification_event_recipient_key ON notifications("eventId","userId");

CREATE FUNCTION announcement_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'DRAFT' OR OLD."legacyReview" OR EXISTS(SELECT 1 FROM announcement_reads WHERE "announcementId"=OLD.id) THEN RAISE EXCEPTION 'Announcement history cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."replacesId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM announcements WHERE id=NEW."replacesId" AND status='ARCHIVED') THEN RAISE EXCEPTION 'Archive original before creating a correction draft' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW."legacyReview" OR NEW."audienceFrozen" OR NEW."publishedAt" IS NOT NULL OR NEW."publishedByUserId" IS NOT NULL OR NEW."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'New announcements must be drafts' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."authorUserId"<>OLD."authorUserId" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1 OR NEW."legacyReview"<>OLD."legacyReview" OR NEW."replacesId" IS DISTINCT FROM OLD."replacesId" THEN RAISE EXCEPTION 'Invalid announcement provenance/version' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['status','version','updatedAt','archivedAt','archivedByUserId','archiveReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt','archivedAt','archivedByUserId','archiveReason']) THEN RAISE EXCEPTION 'Published content/audience is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','PUBLISHED')) OR (OLD.status='PUBLISHED' AND NEW.status='ARCHIVED')) THEN RAISE EXCEPTION 'Invalid announcement transition' USING ERRCODE='23514'; END IF;
  IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND (NEW."audienceFrozen" OR NEW."publishedAt" IS NOT NULL OR NEW."publishedByUserId" IS NOT NULL) THEN RAISE EXCEPTION 'Draft cannot be published implicitly' USING ERRCODE='23514'; END IF;
  IF NEW.status='PUBLISHED' AND OLD.status='DRAFT' THEN
   IF NEW."legacyReview" OR NOT NEW."audienceFrozen" OR NEW."publishedAt" IS NULL OR NEW."publishedByUserId" IS NULL OR NOT EXISTS(SELECT 1 FROM announcement_recipients WHERE "announcementId"=NEW.id) THEN RAISE EXCEPTION 'Publication requires frozen recipients and provenance' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW."publishedByUserId" AND role IN ('ADMIN','HR') AND status='ACTIVE' AND NOT "mustChangePassword") THEN RAISE EXCEPTION 'Publication role required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.status='ARCHIVED' AND (NEW."archivedAt" IS NULL OR NEW."archivedByUserId" IS NULL OR coalesce(btrim(NEW."archiveReason"),'')='' OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW."archivedByUserId" AND role IN ('ADMIN','HR') AND status='ACTIVE' AND NOT "mustChangePassword")) THEN RAISE EXCEPTION 'Archive reason/provenance required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER announcement_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON announcements FOR EACH ROW EXECUTE FUNCTION announcement_lifecycle_guard();

CREATE FUNCTION frozen_recipient_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Recipient snapshot is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM announcements WHERE id=NEW."announcementId" AND status='DRAFT' AND NOT "legacyReview") OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW."userId" AND status='ACTIVE') THEN RAISE EXCEPTION 'Invalid publication recipient' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_recipient_guard BEFORE INSERT OR UPDATE OR DELETE ON announcement_recipients FOR EACH ROW EXECUTE FUNCTION frozen_recipient_guard();

CREATE FUNCTION announcement_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Read history is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM announcements a JOIN announcement_recipients r ON r."announcementId"=a.id WHERE a.id=NEW."announcementId" AND r."userId"=NEW."userId" AND a.status='PUBLISHED' AND a."audienceFrozen" AND NOT a."legacyReview" AND (a."expiresAt" IS NULL OR a."expiresAt">clock_timestamp())) THEN RAISE EXCEPTION 'No active recipient access' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER announcement_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON announcement_reads FOR EACH ROW EXECUTE FUNCTION announcement_receipt_guard();

CREATE FUNCTION notification_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dismiss notifications instead of deleting delivery history' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['isRead','readAt','dismissedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['isRead','readAt','dismissedAt']) OR (OLD."isRead" AND ROW(NEW."isRead",NEW."readAt") IS DISTINCT FROM ROW(OLD."isRead",OLD."readAt")) OR (OLD."dismissedAt" IS NOT NULL AND NEW."dismissedAt" IS DISTINCT FROM OLD."dismissedAt") THEN RAISE EXCEPTION 'Notification delivery/read evidence is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."isRead" AND NEW."readAt" IS NULL OR NOT NEW."isRead" AND NEW."readAt" IS NOT NULL THEN RAISE EXCEPTION 'Read provenance required' USING ERRCODE='23514'; END IF;
 IF NEW."announcementId" IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM announcement_recipients WHERE "announcementId"=NEW."announcementId" AND "userId"=NEW."userId") OR NOT EXISTS(SELECT 1 FROM notification_events WHERE id=NEW."eventId" AND "announcementId"=NEW."announcementId") THEN RAISE EXCEPTION 'Notification must match frozen delivery' USING ERRCODE='23514'; END IF;
  IF NEW."isRead" THEN SELECT coalesce(min("readAt"),NEW."readAt") INTO NEW."readAt" FROM announcement_reads WHERE "announcementId"=NEW."announcementId" AND "userId"=NEW."userId"; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_history_guard BEFORE INSERT OR UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION notification_history_guard();
CREATE FUNCTION synchronize_announcement_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='announcement_reads' THEN
  UPDATE notifications SET "isRead"=true,"readAt"=NEW."readAt" WHERE "announcementId"=NEW."announcementId" AND "userId"=NEW."userId" AND NOT "isRead";
 ELSIF NEW."isRead" AND NEW."announcementId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM announcement_reads WHERE "announcementId"=NEW."announcementId" AND "userId"=NEW."userId") THEN
  INSERT INTO announcement_reads(id,"announcementId","userId","readAt") VALUES(gen_random_uuid(),NEW."announcementId",NEW."userId",NEW."readAt") ON CONFLICT("announcementId","userId") DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER synchronize_announcement_read AFTER INSERT ON announcement_reads FOR EACH ROW EXECUTE FUNCTION synchronize_announcement_read();
CREATE TRIGGER synchronize_announcement_read AFTER INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION synchronize_announcement_read();
CREATE FUNCTION notification_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Event identity is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER notification_event_immutable BEFORE UPDATE OR DELETE ON notification_events FOR EACH ROW EXECUTE FUNCTION notification_event_immutable();
CREATE FUNCTION announcement_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."targetType"='Announcement' THEN RAISE EXCEPTION 'Announcement audit history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER announcement_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION announcement_audit_immutable();
COMMIT;
