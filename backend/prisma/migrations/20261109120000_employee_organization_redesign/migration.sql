BEGIN;
-- Existing codes and all dated intervals remain intact. A sequence, never a
-- row count, allocates generated codes; manual codes remain supported.
CREATE SEQUENCE employee_code_sequence;
SELECT setval('employee_code_sequence', GREATEST(1, COALESCE((SELECT max(substring("employeeCode" from '^EMP-([0-9]{1,15})$')::bigint) FROM employees),0)+1), false);
ALTER TABLE organization_units ADD COLUMN description varchar(1000);
CREATE UNIQUE INDEX organization_unit_normalized_name_key ON organization_units(kind, lower(regexp_replace(btrim(name),'\s+',' ','g')));
ALTER TABLE organization_assignments ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE organization_assignments ADD COLUMN "departmentId" uuid REFERENCES organization_units(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "campaignId" uuid REFERENCES organization_units(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "reportingManagerId" uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE organization_assignments a SET "departmentId"=t."departmentId", "campaignId"=t."campaignId" FROM organization_units t WHERE t.id=a."teamId";
ALTER TABLE organization_units DROP CONSTRAINT organization_unit_values;
ALTER TABLE organization_units ADD CONSTRAINT organization_unit_values CHECK (
 length(btrim(name))>0 AND length(btrim(reason))>0 AND
 ((kind='TEAM' AND "departmentId" IS NOT NULL) OR (kind='CAMPAIGN' AND "campaignId" IS NULL) OR
 (kind IN ('DEPARTMENT','DESIGNATION') AND "departmentId" IS NULL AND "campaignId" IS NULL)));
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
    IF NEW."departmentId" IS DISTINCT FROM t."departmentId" OR NEW."campaignId" IS DISTINCT FROM t."campaignId" THEN RAISE EXCEPTION 'Assignment team parents mismatch' USING ERRCODE='23514'; END IF;
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
