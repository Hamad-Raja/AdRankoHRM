'use strict';

// Service tests use an in-memory Prisma double. They do not certify SQL/auth middleware.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReportsService } = require('../src/services/reports.service');

const at = value => new Date(`${value}T00:00:00.000Z`);
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function employee(number = 1) {
  return {
    id: id(number), employeeCode: `E${number}`, fullName: `Employee ${number}`,
    assignments: [], shiftAssignments: [], employmentEpisodes: [{
      id: id(number + 10000), startDate: at('2026-01-01'), endDate: null,
      status: 'ACTIVE', statusEffectiveDate: at('2026-01-01'), statusEvents: [],
    }],
  };
}
function version() {
  return { id: id(50), effectiveFrom: at('2026-01-01'), policy: {
    timeZone: 'Asia/Karachi', workDays: [1, 2, 3, 4, 5], graceMinutes: 30,
    holidayPolicy: 'COMPANY_ANNOUNCED', breakTrackingEnabled: false, automaticBreakDeduction: false,
  } };
}
function attendance(number = 1, overrides = {}) {
  return {
    id: id(number + 900), employeeId: id(number), shiftDate: at('2026-10-23'),
    scheduledStart: new Date('2026-10-23T14:00:00Z'), scheduledEnd: new Date('2026-10-24T00:00:00Z'),
    clockInAt: new Date('2026-10-23T14:30:00Z'), clockOutAt: new Date('2026-10-24T00:00:00Z'),
    status: 'COMPLETED', scheduleTimeZone: 'Asia/Karachi', graceMinutes: 30,
    workedMinutes: 570, officeScheduleId: id(50), approvedAdjustment: null,
    isLate: false, isEarlyDeparture: false, isAfterScheduleEnd: false, ...overrides,
  };
}
function correction(number = 1, overrides = {}) {
  return {
    id: id(800), employeeId: id(number), attendanceRecordId: null, shiftDate: at('2026-10-23'),
    requestType: 'OTHER', status: 'APPROVED', reason: 'Missed entry',
    correctedClockIn: new Date('2026-10-23T14:00:00Z'), correctedClockOut: new Date('2026-10-24T00:00:00Z'),
    reviewedAt: new Date('2026-10-24T00:30:00Z'), createdAt: new Date('2026-10-24T00:10:00Z'),
    reviewReason: 'Verified', originalData: null,
    requestedBy: { displayName: 'Employee' }, reviewedBy: { displayName: 'HR' }, ...overrides,
  };
}
function harness(overrides = {}) {
  const data = {
    user: { id: id(77), role: 'ADMIN' }, own: null, managers: [],
    employees: [employee()], versions: [version()], records: [], corrections: [], holidays: [],
    now: new Date('2026-10-24T01:00:00Z'), ...overrides,
  };
  const calls = [];
  const take = (rows, query) => rows.slice(0, query.take ?? rows.length);
  function recordFilter(row, where) {
    return (!where.employeeId || where.employeeId.in.includes(row.employeeId))
      && (!where.shiftDate || (row.shiftDate >= where.shiftDate.gte && row.shiftDate <= where.shiftDate.lte))
      && (!where.status || row.status === where.status)
      && (!Object.hasOwn(where, 'attendanceRecordId') || row.attendanceRecordId === where.attendanceRecordId);
  }
  const tx = {
    employee: {
      findUnique: async query => { calls.push(['employee.findUnique', query]); return data.own && { id: data.own.id }; },
      // Date/role authorization is also checked in service; employee SQL filtering is verified by the real read-only probe.
      findMany: async query => { calls.push(['employee.findMany', query]); return take(data.employees, query); },
    },
    teamManagerAssignment: { findMany: async query => { calls.push(['teamManagerAssignment.findMany', query]); return take(data.managers, query); } },
    officeSchedule: { findMany: async query => { calls.push(['officeSchedule.findMany', query]); return take(data.versions, query); } },
    attendanceRecord: { findMany: async query => { calls.push(['attendanceRecord.findMany', query]); return take(data.records.filter(row => recordFilter(row, query.where)), query); } },
    attendanceCorrectionRequest: { findMany: async query => { calls.push(['attendanceCorrectionRequest.findMany', query]); return take(data.corrections.filter(row => recordFilter(row, query.where)), query); } },
    companyHolidayEvent: { findMany: async query => { calls.push(['companyHolidayEvent.findMany', query]); return take(data.holidays, query); } },
    leaveRequest:{findMany:async query=>{calls.push(['leaveRequest.findMany',query]);return take((data.leaves||[]).filter(row=>recordFilter(row,query.where)),query);}},
  };
  const prisma = { $transaction: async (work, options) => { calls.push(['transaction', options]); return work(tx); } };
  const actor = overrides.actor || (async () => data.user);
  return { data, calls, api: createReportsService({ prisma, actor, now: () => new Date(data.now) }) };
}
const period = { dateFrom: '2026-10-23', dateTo: '2026-10-24' };

test('service reads use one RepeatableRead transaction per report', async () => {
  const { api, calls } = harness(); await api.getAttendanceReport(id(77), period);
  const transactions = calls.filter(([name]) => name === 'transaction');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0][1].isolationLevel, 'RepeatableRead');
  assert.ok(calls.every(([name]) => !/create|update|delete/i.test(name)));
});
test('inactive settings return setup rows without generating missing attendance', async () => {
  const { api } = harness({ versions: [] });
  const result = await api.getAttendanceReport(id(77), period);
  assert.equal(result.meta.currentPolicyState, 'NO_ACTIVATED_POLICY');
  assert.equal(result.totals.noClockIn, 0);
  assert.ok(result.rows.every(row => row.classification === 'SETUP_REQUIRED'));
});
test('zero employees produce a genuine empty report', async () => {
  const { api } = harness({ employees: [] }); const result = await api.getMonthlyReport(id(77), { month: '2026-10' });
  assert.equal(result.total, 0); assert.equal(result.totalPages, 0); assert.deepEqual(result.rows, []);
  assert.equal(result.totals.actualRecords, 0);
});
test('details include no-punch employees and exclude Saturday from ordinary missing attendance', async () => {
  const { api } = harness({ employees: [employee(1), employee(2)], records: [attendance()] });
  const result = await api.getAttendanceReport(id(77), period);
  assert.equal(result.total, 4); assert.equal(result.totals.actualRecords, 1);
  assert.equal(result.totals.noClockIn, 1); assert.equal(result.totals.classifications.WEEKLY_OFF, 2);
});
test('monthly, details and full export data agree before pagination', async () => {
  const { api } = harness({ records: [attendance()] });
  const monthly = await api.getMonthlyReport(id(77), { month: '2026-10' });
  const details = await api.getAttendanceReport(id(77), { month: '2026-10', pageSize: '2' });
  const exported = await api.getExportData(id(77), 'attendance', { month: '2026-10', format: 'xlsx' });
  assert.equal(details.rows.length, 2); assert.equal(details.total, 31); assert.equal(exported.rows.length, 31);
  assert.deepEqual(monthly.totals, details.totals); assert.deepEqual(details.totals, exported.totals);
});
test('status-filtered totals cover all matching rows, not the current page', async () => {
  const { api } = harness({ records: [attendance(1, { isLate: true })] });
  const result = await api.getAttendanceReport(id(77), { ...period, status: 'LATE' });
  assert.equal(result.total, 1); assert.equal(result.totals.late, 1); assert.equal(result.totals.dutyDates, 1);
});
test('approved corrections preserve raw null exit and expose separate interval minutes', async () => {
  const record = attendance(1, { clockOutAt: null, workedMinutes: null, status: 'CORRECTED', approvedAdjustment: {
    correctionId: id(800), clockInAt: '2026-10-23T14:00:00Z', clockOutAt: '2026-10-24T00:00:00Z',
    minutes: 600, reviewedAt: '2026-10-24T00:30:00Z', reviewerUserId: id(77),
  } });
  const { api, data } = harness({ records: [record] }); const before = JSON.stringify(data);
  const result = await api.getAttendanceReport(id(77), { ...period, status: 'CORRECTED' });
  assert.equal(result.rows[0].actual.clockOutAt, null); assert.equal(result.totals.rawWorkedMinutes, 0);
  assert.equal(result.totals.approvedIntervalMinutes, 600); assert.equal(result.totals.unresolvedMissingCheckout, 0);
  assert.equal(result.rows[0].approvedAdjustment.reviewerUserId, undefined);
  assert.equal(JSON.stringify(data), before);
});
test('latest approved missing-entry exception counts once; real evidence has precedence', async () => {
  const { api } = harness({ corrections: [correction(1, { id: id(802) }), correction(1, { id: id(801) })] });
  const result = await api.getAttendanceReport(id(77), period);
  assert.equal(result.totals.approvedExceptions, 1); assert.equal(result.totals.actualRecords, 0);
  assert.equal(result.rows.find(row => row.shiftDate === '2026-10-23').approvedException.correctionId, id(802));
  const actual = await harness({ records: [attendance()], corrections: [correction()] }).api.getAttendanceReport(id(77), period);
  assert.equal(actual.totals.approvedExceptions, 0); assert.equal(actual.totals.actualRecords, 1);
});
test('holiday cancellation changes derived calendar without writing attendance', async () => {
  const holidayDate = at('2026-10-23');
  const announced = await harness({ holidays: [{ holidayDate, revision: 1, action: 'ANNOUNCE' }] }).api.getAttendanceReport(id(77), period);
  assert.equal(announced.totals.noClockIn, 0);
  const cancelled = await harness({ holidays: [
    { holidayDate, revision: 1, action: 'ANNOUNCE' }, { holidayDate, revision: 2, action: 'CANCEL' },
  ] }).api.getAttendanceReport(id(77), period);
  assert.equal(cancelled.totals.noClockIn, 1);
});
test('manager monthly/detail totals include only authorized historical duty dates', async () => {
  const e = employee(); e.assignments = [{ teamId: id(10), effectiveFrom: at('2026-01-01'), effectiveTo: null,
    team: { name: 'Operations', departmentId: id(100), campaignId: id(200), department: { name: 'Dept' }, campaign: { name: 'Campaign' } }, designation: null }];
  const { api } = harness({ user: { id: id(77), role: 'MANAGER' }, employees: [e],
    managers: [{ id: id(501), teamId: id(10), effectiveFrom: at('2026-10-23'), effectiveTo: at('2026-10-23') }] });
  const result = await api.getAttendanceReport(id(77), { dateFrom: '2026-10-22', dateTo: '2026-10-26' });
  assert.equal(result.total, 1); assert.equal(result.rows[0].shiftDate, '2026-10-23');
  assert.equal(result.totals.noClockIn, 1);
});
test('Manager correction reports expose own decisions only', async () => {
  const own = employee(99);
  const { api } = harness({ user: { id: id(77), role: 'MANAGER' }, own, employees: [own, employee(1)],
    corrections: [correction(99), correction(1, { id: id(801), reason: 'Private team reason' })] });
  const result = await api.getCorrectionsReport(id(77), { month: '2026-10' });
  assert.equal(result.total, 1); assert.equal(result.rows[0].employee.id, own.id);
  assert.equal(JSON.stringify(result).includes('Private team reason'), false);
});
test('correction decisions retain original facts and a separate approved interpretation', async () => {
  const c = correction(1, { attendanceRecordId: id(901), correctedClockIn: null,
    originalData: { recordVersion: 1, clockInAt: '2026-10-23T14:30:00Z', clockOutAt: null } });
  const result = await harness({ corrections: [c] }).api.getCorrectionsReport(id(77), { month: '2026-10' });
  assert.equal(result.rows[0].original.clockOutAt, null);
  assert.equal(result.rows[0].approvedInterpretation.minutes, 570);
  assert.equal(result.totals.approved, 1);
});
test('an actor rejection propagates without reading report data', async () => {
  const { api, calls } = harness({ actor: async () => { throw new Error('Account unavailable.'); } });
  await assert.rejects(api.getAttendanceReport(id(77), period), /Account unavailable/);
  assert.equal(calls.length, 1);
});
test('oversized employee/date workloads fail instead of returning partial totals', async () => {
  const { api } = harness({ employees: Array.from({ length: 274 }, (_, index) => employee(index + 1)) });
  await assert.rejects(api.getAttendanceReport(id(77), { dateFrom: '2026-01-01', dateTo: '2027-01-01' }), /workload exceeds/);
});
test('export overflow is explicit and never returns the first 10000 rows as a complete result', async () => {
  const { api } = harness({ employees: Array.from({ length: 325 }, (_, index) => employee(index + 1)) });
  await assert.rejects(api.getExportData(id(77), 'attendance', { month: '2026-10', format: 'csv' }), /Export exceeds 10000 rows/);
});
