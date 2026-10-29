BEGIN;
-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'HR_APPROVED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateTable
CREATE TABLE "employee_salary_versions" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveMonth" DATE NOT NULL,
    "revision" INTEGER NOT NULL,
    "previousId" UUID,
    "monthlyBasic" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "actorUserId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salary_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "salaryVersionId" UUID NOT NULL,
    "payrollMonth" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "basis" VARCHAR(20) NOT NULL DEFAULT 'MANUAL_DAYS',
    "calculationVersion" VARCHAR(40) NOT NULL DEFAULT 'MANUAL_DAYS_V1',
    "rounding" VARCHAR(32) NOT NULL DEFAULT 'HALF_UP_TO_PAISA',
    "monthlyBasic" DECIMAL(14,2) NOT NULL,
    "totalPayableDays" DECIMAL(4,2) NOT NULL,
    "workedDays" DECIMAL(4,2) NOT NULL,
    "earnings" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "earnedBasic" DECIMAL(14,2) NOT NULL,
    "unearnedBasic" DECIMAL(14,2) NOT NULL,
    "additionalEarnings" DECIMAL(14,2) NOT NULL,
    "grossPay" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "netPay" DECIMAL(14,2) NOT NULL,
    "employeeCodeSnapshot" VARCHAR(30) NOT NULL,
    "employeeNameSnapshot" VARCHAR(120) NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "hrApprovedByUserId" UUID,
    "hrApprovedAt" TIMESTAMPTZ(3),
    "adminApprovedByUserId" UUID,
    "adminApprovedAt" TIMESTAMPTZ(3),
    "paidByUserId" UUID,
    "paidAt" TIMESTAMPTZ(3),
    "changeReason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" UUID NOT NULL,
    "payrollRecordId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "method" "PayrollPaymentMethod" NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" VARCHAR(120),
    "note" VARCHAR(1000),
    "actorUserId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_previous_key" ON "employee_salary_versions"("previousId");

-- CreateIndex
CREATE INDEX "salary_actor_created_idx" ON "employee_salary_versions"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "salary_employee_month_revision_key" ON "employee_salary_versions"("employeeId", "effectiveMonth", "revision");

-- CreateIndex
CREATE INDEX "payroll_month_status_idx" ON "payroll_records"("payrollMonth", "status");

-- CreateIndex
CREATE INDEX "payroll_salary_version_idx" ON "payroll_records"("salaryVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_employee_month_key" ON "payroll_records"("employeeId", "payrollMonth");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payment_record_key" ON "payroll_payments"("payrollRecordId");

-- CreateIndex
CREATE INDEX "payroll_payment_actor_idx" ON "payroll_payments"("actorUserId", "recordedAt");

-- AddForeignKey
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "employee_salary_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_salaryVersionId_fkey" FOREIGN KEY ("salaryVersionId") REFERENCES "employee_salary_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_hrApprovedByUserId_fkey" FOREIGN KEY ("hrApprovedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_adminApprovedByUserId_fkey" FOREIGN KEY ("adminApprovedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Payroll-only integrity guards. Financial arithmetic stays decimal/integer exact.
ALTER TABLE employee_salary_versions ADD CONSTRAINT salary_values CHECK (
 "currency"='PKR' AND "monthlyBasic">0 AND revision>0 AND btrim(reason)<>''
 AND extract(day FROM "effectiveMonth")=1 AND extract(year FROM "effectiveMonth") BETWEEN 1 AND 9999
);
ALTER TABLE payroll_records ADD CONSTRAINT payroll_values CHECK (
 currency='PKR' AND basis='MANUAL_DAYS' AND "calculationVersion"='MANUAL_DAYS_V1' AND rounding='HALF_UP_TO_PAISA'
 AND extract(day FROM "payrollMonth")=1 AND extract(year FROM "payrollMonth") BETWEEN 1 AND 9999
 AND "monthlyBasic">0 AND "totalPayableDays">0 AND "totalPayableDays"<=31 AND "workedDays">=0 AND "workedDays"<="totalPayableDays"
 AND "earnedBasic"=round("monthlyBasic"*"workedDays"/"totalPayableDays",2)
 AND "unearnedBasic"="monthlyBasic"-"earnedBasic" AND "additionalEarnings">=0 AND "totalDeductions">=0
 AND "grossPay"="earnedBasic"+"additionalEarnings" AND "netPay"="grossPay"-"totalDeductions" AND "netPay">=0
 AND version>0 AND btrim("changeReason")<>''
);
ALTER TABLE payroll_payments ADD CONSTRAINT payment_values CHECK (currency='PKR' AND amount>=0 AND extract(year FROM "paidOn") BETWEEN 1 AND 9999 AND "paidOn" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date AND (method='CASH' OR (reference IS NOT NULL AND btrim(reference)<>'')));

CREATE FUNCTION payroll_management_actor(actor uuid, required_role text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=actor AND status='ACTIVE' AND NOT "mustChangePassword" AND role::text IN ('ADMIN','HR') AND (required_role IS NULL OR role::text=required_role))
$$;
CREATE FUNCTION salary_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior employee_salary_versions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Salary history is append only' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM employees WHERE id=NEW."employeeId" FOR UPDATE;
 IF NOT payroll_management_actor(NEW."actorUserId") THEN RAISE EXCEPTION 'Salary management role required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM employee_salary_versions WHERE "employeeId"=NEW."employeeId" AND "effectiveMonth"=NEW."effectiveMonth" ORDER BY revision DESC LIMIT 1;
 IF NEW."previousId" IS DISTINCT FROM prior.id OR NEW.revision<>coalesce(prior.revision,0)+1 THEN RAISE EXCEPTION 'Stale salary revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER salary_append_guard BEFORE INSERT OR UPDATE OR DELETE ON employee_salary_versions FOR EACH ROW EXECUTE FUNCTION salary_append_guard();

CREATE FUNCTION payroll_adjustment_total(items jsonb, earning boolean) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; total numeric:=0;
BEGIN
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)>50 THEN RAISE EXCEPTION 'Invalid adjustment list' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR (item->>'amount') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR (item->>'amount')::numeric<=0 OR (item->>'amount')::numeric>999999999999.99
    OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 120 OR (item->>'label') ~ '[[:cntrl:]]'
    OR jsonb_typeof(item->'type') IS DISTINCT FROM 'string'
    OR (earning AND item->>'type' NOT IN ('ALLOWANCE','BONUS','COMMISSION','OVERTIME','OTHER'))
    OR (NOT earning AND item->>'type' NOT IN ('TAX','ADVANCE_RECOVERY','LOAN_RECOVERY','OTHER'))
    OR (item - ARRAY['type','label','amount']) <> '{}'::jsonb THEN RAISE EXCEPTION 'Invalid adjustment' USING ERRCODE='23514'; END IF;
  total:=total+(item->>'amount')::numeric;
 END LOOP;
 RETURN total;
END $$;

CREATE FUNCTION payroll_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE salary employee_salary_versions; latest uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll history cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM employees WHERE id=NEW."employeeId" FOR UPDATE;
 IF NOT payroll_management_actor(NEW."updatedByUserId") THEN RAISE EXCEPTION 'Payroll management role required' USING ERRCODE='23514'; END IF;
 SELECT * INTO salary FROM employee_salary_versions WHERE id=NEW."salaryVersionId";
 IF salary."employeeId" IS DISTINCT FROM NEW."employeeId" OR salary."effectiveMonth">NEW."payrollMonth" OR salary."monthlyBasic"<>NEW."monthlyBasic" THEN RAISE EXCEPTION 'Salary ownership or value mismatch' USING ERRCODE='23514'; END IF;
 IF NEW."additionalEarnings"<>payroll_adjustment_total(NEW.earnings,true) OR NEW."totalDeductions"<>payroll_adjustment_total(NEW.deductions,false) THEN RAISE EXCEPTION 'Adjustment totals mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW."createdByUserId"<>NEW."updatedByUserId" THEN RAISE EXCEPTION 'Payroll must begin in draft' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."employeeId"<>OLD."employeeId" OR NEW."payrollMonth"<>OLD."payrollMonth" OR NEW."createdByUserId"<>OLD."createdByUserId" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid identity or revision' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['status','version','updatedByUserId','updatedAt','changeReason','hrApprovedByUserId','hrApprovedAt','adminApprovedByUserId','adminApprovedAt','paidByUserId','paidAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedByUserId','updatedAt','changeReason','hrApprovedByUserId','hrApprovedAt','adminApprovedByUserId','adminApprovedAt','paidByUserId','paidAt']) THEN RAISE EXCEPTION 'Approved financial snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','HR_APPROVED')) OR (OLD.status='HR_APPROVED' AND NEW.status IN ('DRAFT','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='PAID')) THEN RAISE EXCEPTION 'Forbidden payroll transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='HR_APPROVED' AND (NOT payroll_management_actor(NEW."updatedByUserId",'HR') OR NEW."hrApprovedByUserId"<>NEW."updatedByUserId") THEN RAISE EXCEPTION 'HR approval required' USING ERRCODE='23514'; END IF;
  IF NEW.status='APPROVED' AND (NOT payroll_management_actor(NEW."updatedByUserId",'ADMIN') OR NEW."adminApprovedByUserId"<>NEW."updatedByUserId" OR NEW."adminApprovedByUserId"=OLD."hrApprovedByUserId") THEN RAISE EXCEPTION 'Distinct Admin approval required' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('HR_APPROVED','APPROVED') AND NEW.status<>'DRAFT' AND ROW(NEW."hrApprovedByUserId",NEW."hrApprovedAt") IS DISTINCT FROM ROW(OLD."hrApprovedByUserId",OLD."hrApprovedAt") THEN RAISE EXCEPTION 'HR approval evidence is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='APPROVED' AND ROW(NEW."adminApprovedByUserId",NEW."adminApprovedAt") IS DISTINCT FROM ROW(OLD."adminApprovedByUserId",OLD."adminApprovedAt") THEN RAISE EXCEPTION 'Admin approval evidence is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='DRAFT' AND (NEW."hrApprovedByUserId" IS NOT NULL OR NEW."hrApprovedAt" IS NOT NULL) OR NEW.status<>'DRAFT' AND (NEW."hrApprovedByUserId" IS NULL OR NEW."hrApprovedAt" IS NULL) THEN RAISE EXCEPTION 'Invalid HR provenance' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('DRAFT','HR_APPROVED') AND (NEW."adminApprovedByUserId" IS NOT NULL OR NEW."adminApprovedAt" IS NOT NULL) OR NEW.status IN ('APPROVED','PAID') AND (NEW."adminApprovedByUserId" IS NULL OR NEW."adminApprovedAt" IS NULL OR NEW."adminApprovedByUserId"=NEW."hrApprovedByUserId") THEN RAISE EXCEPTION 'Invalid Admin provenance' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'PAID' AND (NEW."paidByUserId" IS NOT NULL OR NEW."paidAt" IS NOT NULL) OR NEW.status='PAID' AND (NEW."paidByUserId" IS NULL OR NEW."paidAt" IS NULL OR NEW."paidByUserId"<>NEW."updatedByUserId") THEN RAISE EXCEPTION 'Invalid payment provenance' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR NEW.status IN ('HR_APPROVED','APPROVED') OR (NEW.status='DRAFT' AND OLD.status='DRAFT') THEN
  SELECT id INTO latest FROM employee_salary_versions WHERE "employeeId"=NEW."employeeId" AND "effectiveMonth"<=NEW."payrollMonth" ORDER BY "effectiveMonth" DESC,revision DESC LIMIT 1;
  IF latest IS DISTINCT FROM NEW."salaryVersionId" THEN RAISE EXCEPTION 'Salary changed; recalculate draft' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_record_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_records FOR EACH ROW EXECUTE FUNCTION payroll_record_guard();

CREATE FUNCTION payroll_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payroll payroll_records;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payment history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO payroll FROM payroll_records WHERE id=NEW."payrollRecordId" FOR UPDATE;
 IF payroll.status<>'APPROVED' OR NEW.amount<>payroll."netPay" OR NEW.currency<>payroll.currency OR NOT payroll_management_actor(NEW."actorUserId") THEN RAISE EXCEPTION 'One full approved payment required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_payments FOR EACH ROW EXECUTE FUNCTION payroll_payment_guard();
CREATE FUNCTION payroll_payment_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payroll payroll_records; payment payroll_payments; record_id uuid;
BEGIN
 record_id:=coalesce(to_jsonb(NEW)->>'payrollRecordId',to_jsonb(NEW)->>'id')::uuid;
 SELECT * INTO payroll FROM payroll_records WHERE id=record_id;
 SELECT * INTO payment FROM payroll_payments WHERE "payrollRecordId"=record_id;
 IF (payroll.status='PAID') IS DISTINCT FROM (payment.id IS NOT NULL) OR (payment.id IS NOT NULL AND (payment.amount<>payroll."netPay" OR payment.currency<>payroll.currency OR payment."actorUserId"<>payroll."paidByUserId")) THEN RAISE EXCEPTION 'Payment and PAID transition must commit together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payroll_payment_commit_guard AFTER INSERT OR UPDATE ON payroll_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_payment_commit_guard();
CREATE CONSTRAINT TRIGGER payroll_payment_commit_guard AFTER INSERT ON payroll_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_payment_commit_guard();
CREATE FUNCTION payroll_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."targetType"='Payroll' THEN RAISE EXCEPTION 'Payroll audit history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION payroll_audit_immutable();
COMMIT;

