'use strict';

// No login, fixtures, migration, activation or writes. PostgreSQL enforces READ ONLY.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const prisma = require('../src/config/prisma');
const { actor } = require('../src/services/organization.service');
const { createReportsService, READ_TRANSACTION } = require('../src/services/reports.service');

async function main() {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const account = await tx.user.findFirst({
      where: { role: { in: ['ADMIN', 'HR'] }, status: 'ACTIVE', mustChangePassword: false },
      select: { id: true }, orderBy: { id: 'asc' },
    });
    assert.ok(account, 'No eligible Admin/HR account exists. Do not change accounts for this probe.');
    const asOf = new Date();
    const api = createReportsService({
      prisma: { $transaction: work => work(tx) }, actor, now: () => new Date(asOf),
    });
    const monthly = await api.getMonthlyReport(account.id);
    const details = await api.getAttendanceReport(account.id);
    const corrections = await api.getCorrectionsReport(account.id);
    const exportData = await api.getExportData(account.id, 'monthly', { format: 'csv' });
    assert.equal(monthly.meta.access, 'ORGANIZATION');
    assert.equal(monthly.totals.dutyDates, details.total);
    assert.equal(monthly.totals.actualRecords, details.totals.actualRecords);
    assert.equal(exportData.total, monthly.total);
    assert.equal(corrections.total, corrections.totals.requests);
    if (monthly.meta.currentPolicyState === 'NO_ACTIVATED_POLICY') {
      assert.equal(monthly.totals.noClockIn, 0, 'Inactive settings must not generate ordinary missing attendance.');
    }
    console.log(`Monthly employee rows: ${monthly.total}`);
    console.log(`Attendance detail rows: ${details.total}`);
    console.log(`Correction rows: ${corrections.total}`);
    console.log(`Current policy: ${monthly.meta.currentPolicyState}`);
    console.log('PASS: Prisma report reads and consistency checks, inside a PostgreSQL READ ONLY transaction.');
    console.log('CSV/XLSX files, HTTP authorization and browser UI are not tested by this probe.');
  }, { ...READ_TRANSACTION, timeout: 60000 });
}

main().catch(error => {
  const message = String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL redacted]');
  console.error(`Read-only report check failed: ${message}`);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });