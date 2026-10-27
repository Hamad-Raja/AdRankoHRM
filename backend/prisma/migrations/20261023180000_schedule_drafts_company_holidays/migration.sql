BEGIN;
CREATE TABLE office_schedule_drafts (
  id UUID PRIMARY KEY,
  revision INTEGER NOT NULL UNIQUE CHECK(revision > 0),
  policy JSONB NOT NULL CHECK(jsonb_typeof(policy) = 'object'),
  "actorUserId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reason VARCHAR(1000) NOT NULL CHECK(length(trim(reason)) > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE office_schedules ADD COLUMN "draftId" UUID;
CREATE UNIQUE INDEX "office_schedules_draftId_key" ON office_schedules("draftId");
ALTER TABLE office_schedules ADD CONSTRAINT "office_schedules_draftId_fkey" FOREIGN KEY("draftId") REFERENCES office_schedule_drafts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE company_holiday_events (
  id UUID PRIMARY KEY,
  "holidayDate" DATE NOT NULL CHECK("holidayDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  revision INTEGER NOT NULL CHECK(revision > 0),
  action VARCHAR(10) NOT NULL CHECK(action IN ('ANNOUNCE','CANCEL')),
  "actorUserId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reason VARCHAR(1000) NOT NULL CHECK(length(trim(reason)) > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_holiday_events_date_revision_key UNIQUE("holidayDate", revision)
);
-- Reuse the existing generic append-only guard without modifying its applied definition.
CREATE TRIGGER office_schedule_draft_history_guard BEFORE UPDATE OR DELETE ON office_schedule_drafts FOR EACH ROW EXECUTE FUNCTION office_schedule_history_guard();
CREATE TRIGGER company_holiday_history_guard BEFORE UPDATE OR DELETE ON company_holiday_events FOR EACH ROW EXECUTE FUNCTION office_schedule_history_guard();
COMMIT;
