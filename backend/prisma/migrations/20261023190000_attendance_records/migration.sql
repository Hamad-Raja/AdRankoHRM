-- Phase 4: Attendance Management

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('OPEN', 'COMPLETED', 'MISSING_CHECKOUT', 'CORRECTED');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "employmentEpisodeId" UUID NOT NULL,
    "shiftDate" DATE NOT NULL,
    "scheduledStart" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEnd" TIMESTAMPTZ(3) NOT NULL,
    "scheduleTimeZone" VARCHAR(80) NOT NULL,
    "graceMinutes" INTEGER NOT NULL,
    "clockInAt" TIMESTAMPTZ(3) NOT NULL,
    "clockOutAt" TIMESTAMPTZ(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'OPEN',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isEarlyDeparture" BOOLEAN NOT NULL DEFAULT false,
    "isMissingCheckout" BOOLEAN NOT NULL DEFAULT false,
    "isAfterScheduleEnd" BOOLEAN NOT NULL DEFAULT false,
    "workedMinutes" INTEGER,
    "clockInRequestId" VARCHAR(64) NOT NULL,
    "clockOutRequestId" VARCHAR(64),
    "clockInActorUserId" UUID NOT NULL,
    "clockOutActorUserId" UUID,
    "scheduleSnapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendanceRecordId" UUID,
    "employeeId" UUID NOT NULL,
    "shiftDate" DATE NOT NULL,
    "requestType" VARCHAR(50) NOT NULL,
    "correctedClockIn" TIMESTAMPTZ(3),
    "correctedClockOut" TIMESTAMPTZ(3),
    "reason" VARCHAR(1000) NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" UUID NOT NULL,
    "reviewedByUserId" UUID,
    "reviewReason" VARCHAR(1000),
    "reviewedAt" TIMESTAMPTZ(3),
    "originalData" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_clockInRequestId_key" ON "attendance_records"("clockInRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_clockOutRequestId_key" ON "attendance_records"("clockOutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeId_shiftDate_key" ON "attendance_records"("employeeId", "shiftDate");

-- CreateIndex
CREATE INDEX "attendance_records_employeeId_shiftDate_idx" ON "attendance_records"("employeeId", "shiftDate");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance_records"("status");

-- CreateIndex
CREATE INDEX "attendance_records_shiftDate_idx" ON "attendance_records"("shiftDate");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_employeeId_shiftDate_idx" ON "attendance_correction_requests"("employeeId", "shiftDate");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_status_idx" ON "attendance_correction_requests"("status");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employmentEpisodeId_fkey" FOREIGN KEY ("employmentEpisodeId") REFERENCES "employment_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clockInActorUserId_fkey" FOREIGN KEY ("clockInActorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clockOutActorUserId_fkey" FOREIGN KEY ("clockOutActorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
