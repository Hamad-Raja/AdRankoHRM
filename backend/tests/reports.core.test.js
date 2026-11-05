'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReportQuery } = require('../src/validation/reports.validation');
const { buildReportScope } = require('../src/utils/reports-scope');
const {
  datesBetween, statusOn, classifyDuty, matchesAttendanceStatus, summarize, monthlyRows,
} = require('../src/utils/reports-rules');

const at = value => new Date(`${value}T00:00:00.000Z`);
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const policy = {
  timeZone: 'Asia/Karachi', workDays: [1, 2, 3, 4, 5], graceMinutes: 30,
  holidayPolicy: 'COMPANY_ANNOUNCED', breakTrackingEnabled: false, automaticBreakDeduction: false,
};
const versions = [{ id: id(50), effectiveFrom: at('2026-01-01'), policy }];
function employee(number = 1) {
  return {
    id: id(number), employeeCode: `E${number}`, fullName: `Employee ${number}`,
    assignments: [], shiftAssignments: [],
    employmentEpisodes: [{
      startDate: at('2026-01-01'), endDate: null, status: 'ACTIVE',
      statusEffectiveDate: at('2026-01-01'), statusEvents: [],
    }],
  };
}
function assignment(teamNumber, from = '2026-01-01', to = null) {
  return {
    id: id(teamNumber + 500), teamId: id(teamNumber), effectiveFrom: at(from), effectiveTo: to && at(to),
    team: { name: `Team ${teamNumber}`, departmentId: id(100), campaignId: id(200),
      department: { name: 'Operations' }, campaign: { name: 'Campaign' } },
    designation: { id: id(300), name: 'Agent' },
  };
}
function record(overrides = {}) {
  return {
    id: id(900), shiftDate: at('2026-10-23'), officeScheduleId: id(50),
    scheduledStart: new Date('2026-10-23T14:00:00.000Z'),
    scheduledEnd: new Date('2026-10-24T00:00:00.000Z'),
    scheduleTimeZone: 'Asia/Karachi', graceMinutes: 30,
    clockInAt: new Date('2026-10-23T14:30:00.000Z'),
    clockOutAt: new Date('2026-10-24T00:00:00.000Z'),
    status: 'COMPLETED', workedMinutes: 570, isLate: false,
    isEarlyDeparture: false, isAfterScheduleEnd: false, approvedAdjustment: null,
    ...overrides,
  };
}
function classify(overrides = {}) {
  return classifyDuty({ employee: employee(), date: '2026-10-23', versions,
    holidayDates: [], now: new Date('2026-10-24T01:00:00.000Z'), ...overrides });
}

test('default report month follows Karachi across a UTC month boundary', () => {
  assert.equal(parseReportQuery({}, { now: new Date('2026-10-31T20:00:00Z') }).month, '2026-11');
});
test('calendar ranges accept leap years and reject normalized dates and year zero', () => {
  assert.equal(parseReportQuery({ month: '2024-02' }).dateTo, '2024-02-29');
  assert.equal(parseReportQuery({ month: '2100-02' }).dateTo, '2100-02-28');
  assert.throws(() => parseReportQuery({ dateFrom: '2026-02-29', dateTo: '2026-03-01' }), /calendar date/);
  assert.throws(() => parseReportQuery({ month: '0000-01' }), /valid YYYY-MM/);
});
test('ambiguous, partial, reversed and oversized periods fail closed', () => {
  for (const query of [
    { month: '2026-01', dateFrom: '2026-01-01', dateTo: '2026-01-02' },
    { dateFrom: '2026-01-01' },
    { dateFrom: '2026-01-02', dateTo: '2026-01-01' },
    { dateFrom: '2024-01-01', dateTo: '2025-01-01' },
  ]) assert.throws(() => parseReportQuery(query));
});
test('nested/repeated parameters and caller identity/clock overrides are rejected', () => {
  for (const query of [{ teamId: [id(1), id(2)] }, { search: { contains: 'x' } },
    { userId: id(1) }, { now: '2026-10-23' }, { role: 'ADMIN' }]) {
    assert.throws(() => parseReportQuery(query));
  }
});
test('pagination and export controls reject silent truncation requests', () => {
  for (const query of [{ page: '-1' }, { page: '1.5' }, { page: '10001' }, { pageSize: '101' }]) {
    assert.throws(() => parseReportQuery(query));
  }
  assert.throws(() => parseReportQuery({ page: '2' }, { exporting: true }));
  assert.throws(() => parseReportQuery({ format: 'pdf' }, { exporting: true }));
  const parsed = parseReportQuery({ format: 'xlsx' }, { exporting: true });
  assert.equal(parsed.maxExportRows, 10000);
  assert.equal(parsed.page, undefined);
});
test('report types have separate status vocabularies and monthly periods', () => {
  assert.equal(parseReportQuery({ status: 'PENDING' }, { report: 'corrections' }).status, 'PENDING');
  assert.throws(() => parseReportQuery({ status: 'PENDING' }));
  assert.throws(() => parseReportQuery({ status: 'LATE' }, { report: 'monthly' }));
});
test('date enumeration includes year rollover and terminates at year 9999', () => {
  assert.deepEqual(datesBetween('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(datesBetween('9999-12-31', '9999-12-31'), ['9999-12-31']);
});
test('historical status is reconstructed from dated events, not current status', () => {
  const episode = { status: 'SUSPENDED', statusEffectiveDate: at('2026-10-25'), statusEvents: [{
    id: id(1), effectiveDate: at('2026-10-25'), createdAt: at('2026-10-24'), fromStatus: 'ACTIVE', toStatus: 'SUSPENDED',
  }] };
  assert.equal(statusOn(episode, '2026-10-23'), 'ACTIVE');
  assert.equal(statusOn(episode, '2026-10-25'), 'SUSPENDED');
});
test('inactive and future policies never generate ordinary no-clock-in rows', () => {
  assert.equal(classify({ versions: [] }).classification, 'SETUP_REQUIRED');
  assert.equal(classify({ versions: [{ ...versions[0], effectiveFrom: at('2026-11-01') }] }).classification, 'SETUP_REQUIRED');
});
test('Friday duty ends Saturday and becomes missing only at its end', () => {
  const beforeEnd = classify({ now: new Date('2026-10-23T23:59:59.999Z') });
  assert.equal(beforeEnd.classification, 'NOT_YET_ENDED');
  assert.equal(beforeEnd.scheduledEnd, '2026-10-24T00:00:00.000Z');
  assert.equal(classify({ now: new Date('2026-10-24T00:00:00.000Z') }).classification, 'NO_CLOCK_IN');
});
test('Saturday evening, holidays, legacy intervals and employment bounds are distinct', () => {
  assert.equal(classify({ date: '2026-10-24' }).classification, 'WEEKLY_OFF');
  assert.equal(classify({ holidayDates: ['2026-10-23'] }).classification, 'HOLIDAY');
  const legacy = employee(); legacy.shiftAssignments = [{ effectiveFrom: at('2026-10-23'), effectiveTo: null }];
  assert.equal(classify({ employee: legacy }).classification, 'LEGACY_ASSIGNMENT_REVIEW');
  const ended = employee(); ended.employmentEpisodes[0].endDate = at('2026-10-22');
  assert.equal(classify({ employee: ended }).classification, 'NOT_ELIGIBLE');
});
test('recorded policy times, grace and raw duration survive future policy changes', () => {
  const actual = record();
  const row = classify({ record: actual, versions: [...versions, { ...versions[0], effectiveFrom: at('2026-11-01'), policy: { ...policy, graceMinutes: 0 } }] });
  assert.equal(row.graceMinutes, 30);
  assert.equal(row.actual.isLate, false);
  assert.equal(row.actual.workedMinutes, 570);
  assert.equal(row.scheduledEnd, actual.scheduledEnd.toISOString());
});
test('late and early-departure flags can overlap without counting two duties', () => {
  const row = classify({ record: record({ isLate: true, isEarlyDeparture: true }) });
  assert.equal(matchesAttendanceStatus(row, 'LATE'), true);
  assert.equal(matchesAttendanceStatus(row, 'EARLY_DEPARTURE'), true);
  const totals = summarize([row]);
  assert.equal(totals.dutyDates, 1); assert.equal(totals.late, 1); assert.equal(totals.earlyDeparture, 1);
});
test('open raw evidence has unknown duration, not a fabricated zero-minute session', () => {
  const row = classify({ record: record({ clockOutAt: null, workedMinutes: null, status: 'OPEN' }) });
  assert.equal(row.classification, 'MISSING_CHECKOUT');
  assert.equal(row.actual.workedMinutes, null);
  const totals = summarize([row]);
  assert.equal(totals.rawDurationUnknown, 1); assert.equal(totals.unresolvedMissingCheckout, 1);
});
test('approved checkout resolves the exception without inventing an actual exit', () => {
  const actual = record({ status: 'CORRECTED', clockOutAt: null, workedMinutes: null, approvedAdjustment: {
    correctionId: id(80), clockInAt: '2026-10-23T14:30:00.000Z',
    clockOutAt: '2026-10-24T00:00:00.000Z', minutes: 570, reviewedAt: '2026-10-24T00:30:00.000Z',
  } });
  const before = JSON.stringify(actual), row = classify({ record: actual });
  assert.equal(row.classification, 'CORRECTED'); assert.equal(row.actual.clockOutAt, null);
  assert.equal(row.actual.rawMissingCheckout, true); assert.equal(row.unresolvedMissingCheckout, false);
  assert.equal(summarize([row]).approvedIntervalMinutes, 570);
  assert.equal(summarize([row]).rawWorkedMinutes, 0);
  assert.equal(JSON.stringify(actual), before);
});
test('an approved exception stays separate and is not double-counted with a real record', () => {
  const exception = { id: id(80), correctedClockIn: '2026-10-23T14:00:00Z', correctedClockOut: '2026-10-24T00:00:00Z', reviewedAt: '2026-10-24T00:30:00Z' };
  const row = classify({ exception });
  assert.equal(row.actual, null); assert.equal(row.classification, 'APPROVED_EXCEPTION');
  assert.equal(summarize([row]).approvedIntervalMinutes, 600);
  const actualRow = classify({ exception, record: record() });
  assert.equal(actualRow.approvedException, null);
  assert.equal(summarize([actualRow]).actualRecords, 1);
});
test('monthly grouping keeps different employees and preserves metric totals', () => {
  const rows = [classify({ record: record() }), classify({ employee: employee(2) })];
  const monthly = monthlyRows(rows);
  assert.equal(monthly.length, 2);
  assert.equal(monthly.reduce((sum, item) => sum + item.metrics.dutyDates, 0), summarize(rows).dutyDates);
});

function scopeTx(own, managers = []) {
  return { employee: { findUnique: async () => own && { id: own.id } },
    teamManagerAssignment: { findMany: async () => managers } };
}
function filters(extra = {}) {
  return parseReportQuery({ dateFrom: '2026-10-22', dateTo: '2026-10-26', ...extra });
}
test('manager access requires both employee and manager intervals on the same duty', async () => {
  const e = employee(); e.assignments = [assignment(10, '2026-10-22', '2026-10-24')];
  const manager = { teamId: id(10), effectiveFrom: at('2026-10-23'), effectiveTo: at('2026-10-23') };
  const scope = await buildReportScope(scopeTx(null, [manager]), { id: id(99), role: 'MANAGER' }, filters());
  assert.equal(scope.canSee(e, '2026-10-22'), false);
  assert.equal(scope.canSee(e, '2026-10-23'), true);
  assert.equal(scope.canSee(e, '2026-10-24'), false);
});
test('an employee ID filter cannot replace the manager restriction', async () => {
  const scope = await buildReportScope(scopeTx(null, []), { id: id(99), role: 'MANAGER' }, filters({ employeeId: id(2) }));
  assert.deepEqual(scope.where.AND.at(-1), { id: id(2) });
  assert.equal(scope.canSee(employee(2), '2026-10-23'), false);
  assert.ok(scope.where.AND.some(part => part.OR));
});
test('organization filters and manager scope must match the same dated assignment', async () => {
  const e = employee(); e.assignments = [assignment(10, '2026-10-22', '2026-10-23'), assignment(20, '2026-10-24')];
  const scope = await buildReportScope(scopeTx(null, [{ teamId: id(10), effectiveFrom: at('2026-01-01'), effectiveTo: null }]),
    { id: id(99), role: 'MANAGER' }, filters({ teamId: id(20) }));
  assert.equal(scope.canSee(e, '2026-10-23'), false);
  assert.equal(scope.canSee(e, '2026-10-24'), false);
});
test('linked manager may report own attendance but not team correction reasons', async () => {
  const own = employee(99), other = employee(1);
  const tx = scopeTx(own, []), user = { id: id(77), role: 'MANAGER' };
  const ownScope = await buildReportScope(tx, user, filters());
  assert.equal(ownScope.canSee(own, '2026-10-23'), true);
  const correctionFilters = parseReportQuery({ month: '2026-10' }, { report: 'corrections' });
  const correctionScope = await buildReportScope(tx, user, correctionFilters);
  assert.equal(correctionScope.canSee(other, '2026-10-23'), false);
  assert.equal(correctionScope.access, 'OWN');
});
test('unlinked employees and forged own-report filters fail closed', async () => {
  await assert.rejects(buildReportScope(scopeTx(null), { id: id(9), role: 'EMPLOYEE' }, filters()), /linked employee/);
  await assert.rejects(buildReportScope(scopeTx(employee()), { id: id(9), role: 'EMPLOYEE' }, filters({ employeeId: id(2) })), /access denied/);
});
test('Admin reports may retain unassigned employees while dated organization filters narrow them', async () => {
  const e = employee(), tx = scopeTx(null), user = { id: id(99), role: 'ADMIN' };
  assert.equal((await buildReportScope(tx, user, filters())).canSee(e, '2026-10-23'), true);
  assert.equal((await buildReportScope(tx, user, filters({ departmentId: id(100) }))).canSee(e, '2026-10-23'), false);
});