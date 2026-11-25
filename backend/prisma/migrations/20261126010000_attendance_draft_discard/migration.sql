BEGIN;
-- Terminal append-only evidence. Original revisions/policies are never rewritten.
CREATE TABLE office_schedule_draft_discards (
  "draftId" UUID PRIMARY KEY REFERENCES office_schedule_drafts(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "actorUserId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "discardedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER office_schedule_discard_history_guard BEFORE UPDATE OR DELETE
ON office_schedule_draft_discards FOR EACH ROW EXECUTE FUNCTION office_schedule_history_guard();

CREATE FUNCTION office_schedule_discard_eligibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM office_schedule_drafts WHERE id=NEW."draftId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM office_schedules WHERE "draftId"=NEW."draftId") THEN
    RAISE EXCEPTION 'An approved policy cannot be discarded' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER office_schedule_discard_eligibility_guard BEFORE INSERT
ON office_schedule_draft_discards FOR EACH ROW EXECUTE FUNCTION office_schedule_discard_eligibility_guard();

CREATE FUNCTION office_schedule_discard_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."draftId" IS NOT NULL THEN
    PERFORM id FROM office_schedule_drafts WHERE id=NEW."draftId" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM office_schedule_draft_discards WHERE "draftId"=NEW."draftId") THEN
      RAISE EXCEPTION 'A discarded draft cannot be activated' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER office_schedule_discard_activation_guard BEFORE INSERT
ON office_schedules FOR EACH ROW EXECUTE FUNCTION office_schedule_discard_activation_guard();

CREATE FUNCTION office_schedule_discard_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action='OFFICE_SCHEDULE_DRAFT_DISCARDED' OR (TG_OP='UPDATE' AND NEW.action='OFFICE_SCHEDULE_DRAFT_DISCARDED') THEN
    RAISE EXCEPTION 'Draft discard audit history is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER office_schedule_discard_audit_guard BEFORE UPDATE OR DELETE
ON audit_logs FOR EACH ROW EXECUTE FUNCTION office_schedule_discard_audit_guard();
COMMIT;
