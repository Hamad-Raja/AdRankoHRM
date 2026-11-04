'use strict';

const { scheduleDate, addDays } = require('./office-schedule');

const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const iso = value => value == null ? null : new Date(value).toISOString();
const within = (from, to, date) => day(from) <= date && (!to || day(to) >= date);

function datesBetween(from, to) {
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    result.push(date);
    if (date === to) break;
  }
  return result;
}

function statusOn(episode, date) {
  const events = [...(episode.statusEvents || [])].sort((a, b) =>
    day(a.effectiveDate).localeCompare(day(b.effectiveDate))
    || String(iso(a.createdAt) || '').localeCompare(String(iso(b.createdAt) || ''))
    || String(a.id).localeCompare(String(b.id)));
  const prior = events.filter(event => day(event.effectiveDate) <= date).at(-1);
  if (prior) return prior.toStatus;
  const next = events.find(event => day(event.effectiveDate) > date);
  if (next) return next.fromStatus;
  return day(episode.statusEffectiveDate) <= date ? episode.status : null;
}

function calendarFor(employee, date, versions, holidayDates) {
  const episodes = employee.employmentEpisodes.map(episode => ({
    startDate: day(episode.startDate), endDate: day(episode.endDate),
    status: statusOn(episode, date),
  }));
  const eligible = episodes.some(episode => within(episode.startDate, episode.endDate, date)
    && ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD'].includes(episode.status));
  const version = versions.filter(item => day(item.effectiveFrom) <= date).at(-1);
  if (!version) return {
    scheduleDate: date, state: eligible ? 'SETUP_REQUIRED' : 'NOT_ELIGIBLE',
    missing: eligible ? ['effectiveOfficePolicy'] : [],
  };
  return scheduleDate(version, date, employee.shiftAssignments.map(assignment => ({
    effectiveFrom: day(assignment.effectiveFrom), effectiveTo: day(assignment.effectiveTo),
  })), episodes, holidayDates);
}

function adjustmentView(adjustment) {
  if (!adjustment) return null;
  return {
    correctionId: adjustment.correctionId,
    clockInAt: iso(adjustment.clockInAt), clockOutAt: iso(adjustment.clockOutAt),
    minutes: adjustment.minutes ?? null, reviewedAt: iso(adjustment.reviewedAt),
  };
}

function classifyDuty({ employee, date, versions, holidayDates, record, exception, approvedLeave, now }) {
  const calendar = calendarFor(employee, date, versions, holidayDates);
  const adjustment = adjustmentView(record?.approvedAdjustment);
  const rawMissingCheckout = Boolean(record && !record.clockOutAt && now >= record.scheduledEnd);
  const unresolvedMissingCheckout = rawMissingCheckout && !adjustment?.clockOutAt;
  let classification = calendar.state;
  let approvedException = null;

  if (record) {
    classification = unresolvedMissingCheckout ? 'MISSING_CHECKOUT'
      : adjustment ? 'CORRECTED' : record.clockOutAt ? 'COMPLETED' : 'OPEN';
  } else if (exception) {
    // A decision is evidence of an approved exception, never a server punch.
    classification = 'APPROVED_EXCEPTION';
    approvedException = {
      correctionId: exception.id, clockInAt: iso(exception.correctedClockIn),
      clockOutAt: iso(exception.correctedClockOut), reviewedAt: iso(exception.reviewedAt),
      minutes: exception.correctedClockIn && exception.correctedClockOut
        ? Math.floor((+new Date(exception.correctedClockOut) - +new Date(exception.correctedClockIn)) / 60000) : null,
    };
  } else if (approvedLeave) {
    classification = 'PAID_LEAVE';
  } else if (calendar.state === 'SCHEDULED') {
    classification = now >= new Date(calendar.endsAt) ? 'NO_CLOCK_IN' : 'NOT_YET_ENDED';
  }

  return {
    employee: { id: employee.id, employeeCode: employee.employeeCode, fullName: employee.fullName },
    shiftDate: date, classification, scheduleState: calendar.state,
    // Actual records retain their recorded duty even if a current interpretation differs.
    eligibleDuty: Boolean(record) || calendar.state === 'SCHEDULED',
    scheduledStart: record ? iso(record.scheduledStart) : calendar.startsAt || null,
    scheduledEnd: record ? iso(record.scheduledEnd) : calendar.endsAt || null,
    scheduleTimeZone: record?.scheduleTimeZone || calendar.timeZone || 'Asia/Karachi',
    graceMinutes: record?.graceMinutes ?? calendar.graceMinutes ?? null,
    actual: record ? {
      attendanceRecordId: record.id, status: record.status,
      officeScheduleId: record.officeScheduleId || null,
      clockInAt: iso(record.clockInAt), clockOutAt: iso(record.clockOutAt),
      workedMinutes: record.workedMinutes ?? null,
      isLate: record.isLate, isEarlyDeparture: record.isEarlyDeparture,
      isAfterScheduleEnd: record.isAfterScheduleEnd, rawMissingCheckout,
    } : null,
    approvedAdjustment: adjustment, approvedException, unresolvedMissingCheckout,
    paidLeave:approvedLeave?{id:approvedLeave.id,days:1,paid:true,startsAt:iso(approvedLeave.startsAt),endsAt:iso(approvedLeave.endsAt)}:null,
    leaveConflict:Boolean(approvedLeave&&(record||exception||holidayDates.includes(date)||!['SCHEDULED','SETUP_REQUIRED'].includes(calendar.state)
      ||calendar.state==='SCHEDULED'&&(calendar.timeZone!=='Asia/Karachi'||iso(approvedLeave.startsAt)!==calendar.startsAt||iso(approvedLeave.endsAt)!==calendar.endsAt))),
  };
}

function matchesAttendanceStatus(row, status) {
  if (!status) return true;
  if (status === 'LATE') return row.actual?.isLate === true;
  if (status === 'EARLY_DEPARTURE') return row.actual?.isEarlyDeparture === true;
  if (status === 'AFTER_SCHEDULE_END') return row.actual?.isAfterScheduleEnd === true;
  return row.classification === status;
}

function emptyMetrics() {
  return {
    dutyDates: 0, eligibleDuties: 0, actualRecords: 0, actualCompleted: 0,
    actualOpen: 0, onTime: 0, late: 0, earlyDeparture: 0, afterScheduleEnd: 0,
    rawMissingCheckout: 0, unresolvedMissingCheckout: 0, noClockIn: 0,
    approvedExceptions: 0, adjustedRecords: 0, rawWorkedMinutes: 0,
    rawDurationUnknown: 0, approvedIntervalMinutes: 0, classifications: {},
    paidLeaveDays:0, leaveConflicts:0,
  };
}

function addMetrics(metrics, row) {
  metrics.dutyDates++;
  metrics.paidLeaveDays+=Number(Boolean(row.paidLeave));
  metrics.leaveConflicts+=Number(Boolean(row.leaveConflict));
  metrics.eligibleDuties += Number(row.eligibleDuty);
  metrics.classifications[row.classification] = (metrics.classifications[row.classification] || 0) + 1;
  metrics.unresolvedMissingCheckout += Number(row.unresolvedMissingCheckout);
  metrics.noClockIn += Number(row.classification === 'NO_CLOCK_IN');
  metrics.approvedExceptions += Number(Boolean(row.approvedException));
  metrics.adjustedRecords += Number(Boolean(row.approvedAdjustment));
  if (row.actual) {
    const actual = row.actual;
    metrics.actualRecords++;
    metrics.actualCompleted += Number(Boolean(actual.clockOutAt));
    metrics.actualOpen += Number(!actual.clockOutAt);
    metrics.onTime += Number(!actual.isLate);
    metrics.late += Number(actual.isLate);
    metrics.earlyDeparture += Number(actual.isEarlyDeparture);
    metrics.afterScheduleEnd += Number(actual.isAfterScheduleEnd);
    metrics.rawMissingCheckout += Number(actual.rawMissingCheckout);
    if (actual.clockOutAt && Number.isInteger(actual.workedMinutes)) {
      metrics.rawWorkedMinutes += actual.workedMinutes;
    } else metrics.rawDurationUnknown++;
  }
  const minutes = (row.approvedAdjustment || row.approvedException)?.minutes;
  if (Number.isInteger(minutes)) metrics.approvedIntervalMinutes += minutes;
  return metrics;
}

function summarize(rows) {
  const totals = emptyMetrics();
  for (const row of rows) addMetrics(totals, row);
  return totals;
}

function monthlyRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    let group = groups.get(row.employee.id);
    if (!group) {
      group = { employee: row.employee, metrics: emptyMetrics(), organizations: [] };
      groups.set(row.employee.id, group);
    }
    addMetrics(group.metrics, row);
    if (row.organization && !group.organizations.some(item => item.team.id === row.organization.team.id
      && item.designation?.id === row.organization.designation?.id)) {
      group.organizations.push(row.organization);
    }
  }
  return [...groups.values()].sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName)
    || a.employee.id.localeCompare(b.employee.id));
}

module.exports = {
  datesBetween, statusOn, calendarFor, classifyDuty,
  matchesAttendanceStatus, emptyMetrics, summarize, monthlyRows,
};
