'use strict';

const ApiError = require('../utils/ApiError');
const { parseReportQuery } = require('../validation/reports.validation');
const { localParts } = require('../utils/office-schedule');
const { buildReportScope, overlaps } = require('../utils/reports-scope');
const {
  payrollAttendanceSummaries, datesBetween, classifyDuty, matchesAttendanceStatus, summarize, monthlyRows, statusOn,
} = require('../utils/reports-rules');

const READ_LIMITS = Object.freeze({
  maxEmployees: 2000, maxDutyCells: 100000,
  maxRecords: 100000, maxCorrections: 30000, maxPolicies: 2000, maxHolidayEvents: 10000,
});
const READ_TRANSACTION = Object.freeze({ isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 20000 });
const at = value => new Date(`${value}T00:00:00.000Z`);
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const iso = value => value == null ? null : new Date(value).toISOString();
const key = (employeeId, date) => `${employeeId}:${date}`;

const attendanceSelect = {
  id: true, employeeId: true, shiftDate: true, scheduledStart: true, scheduledEnd: true,
  scheduleTimeZone: true, graceMinutes: true, clockInAt: true, clockOutAt: true,
  status: true, isLate: true, isEarlyDeparture: true, isAfterScheduleEnd: true,
  workedMinutes: true, officeScheduleId: true, approvedAdjustment: true,
};
const correctionSelect = {
  id: true, employeeId: true, attendanceRecordId: true, shiftDate: true,
  requestType: true, correctedClockIn: true, correctedClockOut: true,
  reason: true, status: true, originalData: true, reviewReason: true,
  reviewedAt: true, createdAt: true,
  requestedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
};

function fail(status, message, code) { throw new ApiError(status, message, code); }
function bounded(rows, limit, label) {
  if (rows.length > limit) {
    fail(413, `${label} exceeds the report limit. Narrow the dates, employee or organization filters.`, 'REPORT_TOO_LARGE');
  }
  return rows;
}

function employeeSelect(filters) {
  return {
    id: true, employeeCode: true, fullName: true,
    assignments: {
      where: overlaps(filters.dateFrom, filters.dateTo),
      orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
      select: {
        id: true, teamId: true, departmentId:true,campaignId:true,department:{select:{name:true}},campaign:{select:{name:true}},effectiveFrom: true, effectiveTo: true,
        team: { select: {
          name: true, departmentId: true, campaignId: true,
          department: { select: { name: true } }, campaign: { select: { name: true } },
        } },
        designation: { select: { id: true, name: true } },
      },
    },
    employmentEpisodes: {
      where: {
        startDate: { lte: at(filters.dateTo) },
        OR: [{ endDate: null }, { endDate: { gte: at(filters.dateFrom) } }],
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true, startDate: true, endDate: true, status: true, statusEffectiveDate: true,
        statusEvents: {
          orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, effectiveDate: true, createdAt: true, fromStatus: true, toStatus: true },
        },
      },
    },
    shiftAssignments: {
      where: overlaps(filters.dateFrom, filters.dateTo),
      select: { effectiveFrom: true, effectiveTo: true },
    },
  };
}

function approvedInterpretation(correction) {
  if (correction.status !== 'APPROVED') return null;
  const original = correction.originalData || {};
  const entry = correction.correctedClockIn || original.approvedAdjustment?.clockInAt || original.clockInAt;
  const exit = correction.correctedClockOut || original.approvedAdjustment?.clockOutAt || original.clockOutAt;
  return {
    clockInAt: iso(entry), clockOutAt: iso(exit),
    minutes: entry && exit ? Math.floor((+new Date(exit) - +new Date(entry)) / 60000) : null,
  };
}

function correctionRow(correction, employee, organization) {
  return {
    id: correction.id,
    employee: { id: employee.id, employeeCode: employee.employeeCode, fullName: employee.fullName },
    organization, shiftDate: day(correction.shiftDate), attendanceRecordId: correction.attendanceRecordId,
    requestType: correction.requestType, status: correction.status, reason: correction.reason,
    proposedClockInAt: iso(correction.correctedClockIn), proposedClockOutAt: iso(correction.correctedClockOut),
    original: correction.originalData ? {
      clockInAt: correction.originalData.clockInAt || null,
      clockOutAt: correction.originalData.clockOutAt || null,
      recordVersion: correction.originalData.recordVersion ?? null,
    } : null,
    approvedInterpretation: approvedInterpretation(correction),
    requestedAt: iso(correction.createdAt), reviewedAt: iso(correction.reviewedAt),
    requester: correction.requestedBy?.displayName || null,
    reviewer: correction.reviewedBy?.displayName || null, reviewReason: correction.reviewReason,
  };
}

function metadata(filters, now, access, versions = []) {
  const localDate = localParts(now, filters.timeZone).date;
  return {
    report: filters.report, timeZone: filters.timeZone, generatedAt: now.toISOString(), access,
    period: { month: filters.month, dateFrom: filters.dateFrom, dateTo: filters.dateTo },
    filters: Object.fromEntries(['employeeId', 'departmentId', 'campaignId', 'teamId', 'search', 'status']
      .filter(field => filters[field] !== undefined).map(field => [field, filters[field]])),
    currentPolicyState: versions.some(version => day(version.effectiveFrom) <= localDate)
      ? 'EFFECTIVE_POLICY_PRESENT' : versions.length ? 'FUTURE_POLICY_ONLY' : 'NO_ACTIVATED_POLICY',
    dutyDateMeaning: 'The local date on which the 19:00 duty starts, including Friday duties ending Saturday.',
    organizationMeaning: 'Assignments are selected for the duty date; organization names are the currently stored labels.',
    durationMeaning: 'Raw recorded minutes and separately approved intervals are not payable hours. Do not add them together.',
    metricMeaning: 'Late, early-departure and other flags can overlap. Classification counts count each visible employee-duty once.',
    absenceMeaning: 'NO_CLOCK_IN excludes approved full-day paid leave and approved exceptions. Paid leave, actual records and scheduled duties are distinct; payroll remains manual.',
    openMeaning: 'actualOpen counts original records without an actual exit, even when an adjustment resolves the exception.',
    totalsMeaning: 'Totals cover all rows matching this report and its filters, before page slicing.',
    readLimits: READ_LIMITS,
  };
}

function response(rows, totals, meta, filters, exporting) {
  const total = rows.length;
  if (exporting) {
    if (total > filters.maxExportRows) {
      fail(413, `Export exceeds ${filters.maxExportRows} rows. Narrow the selected period or filters.`, 'EXPORT_TOO_LARGE');
    }
    return { meta, totals, rows, total, format: filters.format };
  }
  return {
    meta, totals, rows: rows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
    total, page: filters.page, pageSize: filters.pageSize, totalPages: Math.ceil(total / filters.pageSize),
  };
}

// Factory injection is for isolated tests/read-only probes. HTTP callers never choose it.
function createReportsService({ prisma, actor, now = () => new Date() }) {
  async function read(userId, rawQuery, report, exporting = false, summaryIds = null) {
    return prisma.$transaction(async tx => {
      if(summaryIds!==null)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const user = await actor(tx, userId, false);
      if(summaryIds!==null&&(!Array.isArray(summaryIds)||!['ADMIN','HR'].includes(user.role)||!summaryIds.length||summaryIds.length>25))fail(403,'Payroll summary access denied.','FORBIDDEN');
      const asOf = now();
      const filters = parseReportQuery(rawQuery, { report, exporting, now: asOf });
      const scope = await buildReportScope(tx, user, filters);
      const employeeLimit = Math.min(READ_LIMITS.maxEmployees, Math.floor(READ_LIMITS.maxDutyCells / filters.rangeDays));
      const employees = bounded(await tx.employee.findMany({
        where: summaryIds?{AND:[scope.where,{id:{in:summaryIds}}]}:scope.where, select: employeeSelect(filters),
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: employeeLimit + 1,
      }), employeeLimit, 'Employee/date workload');
      const ids = employees.map(employee => employee.id);
      const rangeWhere = { employeeId: { in: ids }, shiftDate: { gte: at(filters.dateFrom), lte: at(filters.dateTo) } };

      const versions = bounded(await tx.officeSchedule.findMany({
        orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
        select: { id: true, effectiveFrom: true, policy: true }, take: READ_LIMITS.maxPolicies + 1,
      }), READ_LIMITS.maxPolicies, 'Policy history');
      const meta = metadata(filters, asOf, scope.access, versions);

      if (report === 'corrections') {
        const corrections = ids.length ? bounded(await tx.attendanceCorrectionRequest.findMany({
          where: { ...rangeWhere, ...(filters.status ? { status: filters.status } : {}) },
          select: correctionSelect,
          orderBy: [{ shiftDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: READ_LIMITS.maxCorrections + 1,
        }), READ_LIMITS.maxCorrections, 'Correction history') : [];
        const employeeMap = new Map(employees.map(employee => [employee.id, employee]));
        const rows = [];
        for (const correction of corrections) {
          const employee = employeeMap.get(correction.employeeId), date = day(correction.shiftDate);
          if (employee && scope.canSee(employee, date)) {
            rows.push(correctionRow(correction, employee, scope.organizationFor(employee, date)));
          }
        }
        const totals = { requests: rows.length, pending: 0, approved: 0, rejected: 0 };
        for (const row of rows) totals[row.status.toLowerCase()]++;
        return response(rows, totals, meta, filters, exporting);
      }

      const records = ids.length ? bounded(await tx.attendanceRecord.findMany({
        where: rangeWhere, select: attendanceSelect,
        orderBy: [{ shiftDate: 'desc' }, { id: 'asc' }], take: READ_LIMITS.maxRecords + 1,
      }), READ_LIMITS.maxRecords, 'Attendance history') : [];
      const exceptions = ids.length ? bounded(await tx.attendanceCorrectionRequest.findMany({
        where: { ...rangeWhere, attendanceRecordId: null, status: 'APPROVED' },
        select: { id: true, employeeId: true, shiftDate: true, correctedClockIn: true, correctedClockOut: true, reviewedAt: true },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }], take: READ_LIMITS.maxCorrections + 1,
      }), READ_LIMITS.maxCorrections, 'Approved exception history') : [];
      const holidayEvents = bounded(await tx.companyHolidayEvent.findMany({
        where: { holidayDate: { gte: at(filters.dateFrom), lte: at(filters.dateTo) } },
        orderBy: [{ holidayDate: 'asc' }, { revision: 'asc' }],
        select: { holidayDate: true, revision: true, action: true }, take: READ_LIMITS.maxHolidayEvents + 1,
      }), READ_LIMITS.maxHolidayEvents, 'Holiday history');
      const leaves = ids.length ? bounded(await tx.leaveRequest.findMany({
        where:{...rangeWhere,status:'APPROVED'},
        select:{id:true,employeeId:true,shiftDate:true,startsAt:true,endsAt:true},take:READ_LIMITS.maxRecords+1,
      }),READ_LIMITS.maxRecords,'Approved leave history') : [];
      const leaveMap = new Map(leaves.map(leave=>[key(leave.employeeId,day(leave.shiftDate)),leave]));

      const holidayMap = new Map();
      for (const event of holidayEvents) holidayMap.set(day(event.holidayDate), event.action);
      const holidayDates = [...holidayMap].filter(([, action]) => action === 'ANNOUNCE').map(([date]) => date);
      const recordMap = new Map(records.map(record => [key(record.employeeId, day(record.shiftDate)), record]));
      const exceptionMap = new Map();
      for (const exception of exceptions) {
        const identifier = key(exception.employeeId, day(exception.shiftDate));
        if (!exceptionMap.has(identifier)) exceptionMap.set(identifier, exception);
      }
      const rows = [];
      const dates = datesBetween(filters.dateFrom, filters.dateTo);
      for (const employee of employees) for (const date of dates) {
        if (!scope.canSee(employee, date)) continue;
        const identifier = key(employee.id, date);
        const row = classifyDuty({
          employee, date, versions, holidayDates, now: asOf,
          record: recordMap.get(identifier), exception: exceptionMap.get(identifier),
          approvedLeave:leaveMap.get(identifier),
        });
        if (matchesAttendanceStatus(row, filters.status)) {
          rows.push({ ...row, organization: scope.organizationFor(employee, date) });
        }
      }
      if(summaryIds)return payrollAttendanceSummaries(rows,summaryIds,filters,asOf);
      rows.sort((a, b) => b.shiftDate.localeCompare(a.shiftDate)
        || a.employee.fullName.localeCompare(b.employee.fullName)
        || a.employee.id.localeCompare(b.employee.id));
      let output = rows;
      if (report === 'monthly') {
        const people = new Map(employees.map(employee => [employee.id, employee]));
        // Newest authorized duty, never a later status outside the caller's dated scope.
        const visibleDates = new Map();
        for (const row of rows) if (!visibleDates.has(row.employee.id)) visibleDates.set(row.employee.id, row.shiftDate);
        output = monthlyRows(rows).map(group => {
          const visibleDate = visibleDates.get(group.employee.id);
          const episode = people.get(group.employee.id).employmentEpisodes
            .filter(item => day(item.startDate) <= visibleDate).at(-1);
          return { ...group, employee: { ...group.employee,
            employmentStatus: episode ? statusOn(episode, visibleDate) : null,
            employmentStatusDate: visibleDate,
          } };
        });
      }
      return response(output, summarize(rows), meta, filters, exporting);
    }, READ_TRANSACTION);
  }
  return {
    getPayrollAttendanceSummary: (userId,{month,employeeIds}) => read(userId,{month},'monthly',false,employeeIds),
    getMonthlyReport: (userId, query = {}) => read(userId, query, 'monthly'),
    getAttendanceReport: (userId, query = {}) => read(userId, query, 'attendance'),
    getCorrectionsReport: (userId, query = {}) => read(userId, query, 'corrections'),
    // Returns authorized data for a later CSV/XLSX writer, not a download yet.
    getExportData: (userId, report, query = {}) => read(userId, query, report, true),
  };
}

let service;
function defaults() {
  if (!service) service = createReportsService({
    prisma: require('../config/prisma'), actor: require('./organization.service').actor,
    now: () => require('../utils/attendance-clock').now(),
  });
  return service;
}

module.exports = {
  createReportsService, READ_LIMITS, READ_TRANSACTION,
  getPayrollAttendanceSummary: (...args) => defaults().getPayrollAttendanceSummary(...args),
  getMonthlyReport: (...args) => defaults().getMonthlyReport(...args),
  getAttendanceReport: (...args) => defaults().getAttendanceReport(...args),
  getCorrectionsReport: (...args) => defaults().getCorrectionsReport(...args),
  getExportData: (...args) => defaults().getExportData(...args),
};
