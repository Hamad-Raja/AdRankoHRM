BEGIN;
-- Preserve team department ownership and all existing dated records.
-- Only membership department equality is relaxed; campaign/reference guards remain.
CREATE OR REPLACE FUNCTION employee_management_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t organization_units; c organization_units;
BEGIN
 IF TG_TABLE_NAME='organization_units' THEN
  IF NEW."departmentId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=NEW."departmentId" AND kind='DEPARTMENT') THEN RAISE EXCEPTION 'Invalid department' USING ERRCODE='23514'; END IF;
  IF NEW."campaignId" IS NOT NULL THEN
   SELECT * INTO c FROM organization_units WHERE id=NEW."campaignId" AND kind='CAMPAIGN';
   IF NOT FOUND OR (c."departmentId" IS NOT NULL AND c."departmentId" IS DISTINCT FROM NEW."departmentId") THEN RAISE EXCEPTION 'Invalid campaign department' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF NEW."teamId" IS NOT NULL THEN
   SELECT * INTO t FROM organization_units WHERE id=NEW."teamId" AND kind='TEAM';
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid team' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='team_manager_assignments' THEN RAISE EXCEPTION 'Team required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='organization_assignments' THEN
   IF NEW."teamId" IS NOT NULL THEN
    NEW."departmentId"=COALESCE(NEW."departmentId",t."departmentId"); NEW."campaignId"=COALESCE(NEW."campaignId",t."campaignId");
    IF NEW."campaignId" IS DISTINCT FROM t."campaignId" THEN RAISE EXCEPTION 'Assignment team parents mismatch' USING ERRCODE='23514'; END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM organization_units WHERE id=NEW."designationId" AND kind='DESIGNATION') OR
      NOT EXISTS(SELECT 1 FROM organization_units WHERE id=NEW."departmentId" AND kind='DEPARTMENT') THEN RAISE EXCEPTION 'Invalid assignment references' USING ERRCODE='23514'; END IF;
   IF NEW."campaignId" IS NOT NULL THEN
    SELECT * INTO c FROM organization_units WHERE id=NEW."campaignId" AND kind='CAMPAIGN';
    IF NOT FOUND OR (c."departmentId" IS NOT NULL AND c."departmentId" IS DISTINCT FROM NEW."departmentId") THEN RAISE EXCEPTION 'Invalid assignment campaign' USING ERRCODE='23514'; END IF;
   END IF;
   IF NEW."reportingManagerId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."reportingManagerId" IS DISTINCT FROM OLD."reportingManagerId" OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId") THEN
    IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW."reportingManagerId" AND role='MANAGER') OR EXISTS(SELECT 1 FROM employees WHERE id=NEW."employeeId" AND "userId"=NEW."reportingManagerId") THEN RAISE EXCEPTION 'Invalid reporting manager' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
