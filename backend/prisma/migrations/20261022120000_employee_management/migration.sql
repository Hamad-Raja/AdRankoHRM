BEGIN;
-- Additive only: no existing rows or applied migrations are rewritten.
-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('DEPARTMENT', 'CAMPAIGN', 'TEAM', 'DESIGNATION');

-- CreateTable
CREATE TABLE "organization_units" (
    "id" UUID NOT NULL,
    "kind" "OrganizationKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "departmentId" UUID,
    "campaignId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "actorUserId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_assignments" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "designationId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "actorUserId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_manager_assignments" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "managerUserId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "actorUserId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_manager_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "replacesId" UUID,
    "title" VARCHAR(120) NOT NULL,
    "storageName" VARCHAR(80) NOT NULL,
    "mediaType" VARCHAR(80) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "ownerVisible" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_units_kind_name_key" ON "organization_units"("kind", "name");

-- CreateIndex
CREATE INDEX "organization_assignments_teamId_effectiveFrom_idx" ON "organization_assignments"("teamId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "team_manager_assignments_managerUserId_effectiveFrom_idx" ON "team_manager_assignments"("managerUserId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_replacesId_key" ON "employee_documents"("replacesId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storageName_key" ON "employee_documents"("storageName");

-- CreateIndex
CREATE INDEX "employee_documents_employeeId_createdAt_idx" ON "employee_documents"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_manager_assignments" ADD CONSTRAINT "team_manager_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_manager_assignments" ADD CONSTRAINT "team_manager_assignments_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_manager_assignments" ADD CONSTRAINT "team_manager_assignments_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "employee_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE organization_units ADD CONSTRAINT organization_unit_values CHECK (
  length(trim(name)) > 0 AND length(trim(reason)) > 0 AND
  ((kind = 'TEAM' AND "departmentId" IS NOT NULL AND "campaignId" IS NOT NULL)
   OR (kind <> 'TEAM' AND "departmentId" IS NULL AND "campaignId" IS NULL)));
ALTER TABLE organization_assignments ADD CONSTRAINT organization_assignment_dates CHECK (
  isfinite("effectiveFrom") AND ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" >= "effectiveFrom")) AND length(trim(reason)) > 0);
ALTER TABLE organization_assignments ADD CONSTRAINT organization_assignment_no_overlap EXCLUDE USING gist (
  "employeeId" WITH =, daterange("effectiveFrom", "effectiveTo", '[]') WITH &&);
ALTER TABLE team_manager_assignments ADD CONSTRAINT team_manager_dates CHECK (
  isfinite("effectiveFrom") AND ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" >= "effectiveFrom")) AND length(trim(reason)) > 0);
ALTER TABLE team_manager_assignments ADD CONSTRAINT team_manager_no_overlap EXCLUDE USING gist (
  "teamId" WITH =, daterange("effectiveFrom", "effectiveTo", '[]') WITH &&);
ALTER TABLE employee_documents ADD CONSTRAINT document_values CHECK (
  "byteLength" BETWEEN 1 AND 5242880 AND length(trim(title)) > 0 AND "mediaType" IN ('text/plain', 'image/png') AND "replacesId" IS DISTINCT FROM id);

-- Enforce coherent kinds even for future clients that do not use the service validator.
CREATE FUNCTION employee_management_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'organization_units' THEN
    IF NEW.kind = 'TEAM' AND (
      NOT EXISTS (SELECT 1 FROM organization_units WHERE id = NEW."departmentId" AND kind = 'DEPARTMENT') OR
      NOT EXISTS (SELECT 1 FROM organization_units WHERE id = NEW."campaignId" AND kind = 'CAMPAIGN')) THEN
      RAISE EXCEPTION 'Invalid team parents' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM organization_units WHERE id = NEW."teamId" AND kind = 'TEAM') THEN
      RAISE EXCEPTION 'Invalid team' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'organization_assignments' THEN
      IF NOT EXISTS (SELECT 1 FROM organization_units WHERE id = NEW."designationId" AND kind = 'DESIGNATION') THEN
        RAISE EXCEPTION 'Invalid designation' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_unit_reference_guard BEFORE INSERT OR UPDATE ON organization_units FOR EACH ROW EXECUTE FUNCTION employee_management_reference_guard();
CREATE TRIGGER organization_assignment_reference_guard BEFORE INSERT OR UPDATE ON organization_assignments FOR EACH ROW EXECUTE FUNCTION employee_management_reference_guard();
CREATE TRIGGER team_manager_reference_guard BEFORE INSERT OR UPDATE ON team_manager_assignments FOR EACH ROW EXECUTE FUNCTION employee_management_reference_guard();
COMMIT;
