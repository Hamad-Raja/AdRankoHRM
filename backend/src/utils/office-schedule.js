"use strict";
const { dateValue, dateString } = require('./shift-rules');
const { statusOn } = require('./employment-status');
const formatters = new Map();
function addDays(date, count) { return dateString(new Date(+dateValue(date) + count * 86400000)); }
function localParts(instant, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(instant).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, stamp: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z` };
}
function instantFor(date, time, zone) {
  const target = Date.parse(`${date}T${time}:00Z`); let guess = target;
  for (let i = 0; i < 4; i++) { const delta = target - Date.parse(localParts(new Date(guess), zone).stamp); if (!delta) break; guess += delta; }
  const check = localParts(new Date(guess), zone);
  return check.date === date && check.time === time ? new Date(guess) : null;
}
function missingPolicy(policy) {
  const missing = [];
  const keys = ['timeZone', 'workDays', 'graceMinutes', 'holidayPolicy'];
  if (!(policy.breakTrackingEnabled === false && policy.automaticBreakDeduction === false)) keys.push('breakMinutes');
  for (const key of keys) if (policy[key] == null) missing.push(key);
  if (policy.breakMinutes > 0 && policy.breakPaid == null) missing.push('breakPaid');
  return missing;
}
function versionFor(versions, date) { return [...versions].reverse().find(v => v.effectiveFrom <= date); }
function scheduleDate(version, date, assignments, episodes, companyHolidays) {
  const p = version.policy, missing = missingPolicy(p);
  const result = { scheduleDate: date, startTime: '19:00', endTime: '05:00', endsNextDay: true, scheduledSpanMinutes: 600, timeZone: p.timeZone, workDays: p.workDays, graceMinutes: p.graceMinutes, breakTrackingEnabled: p.breakTrackingEnabled, automaticBreakDeduction: p.automaticBreakDeduction, breakMinutes: p.breakMinutes ?? null, breakPaid: p.breakPaid ?? null, state: 'SETUP_REQUIRED', missing };
  if (assignments.some(a => a.effectiveFrom <= date && (!a.effectiveTo || a.effectiveTo >= date))) return { ...result, state: 'LEGACY_ASSIGNMENT_REVIEW', missing: ['Existing individual assignment requires an explicit policy decision.'] };
  if (!episodes.some(e => e.startDate <= date && (!e.endDate || e.endDate >= date) && ['ACTIVE','PROBATION','NOTICE_PERIOD'].includes(e.statusEffectiveDate || e.statusEvents ? statusOn(e, date) : e.status))) return { ...result, state: 'NOT_ELIGIBLE', missing: [] };
  if (missing.length) return result;
  if (p.holidayPolicy === 'DATES' && (date < p.holidayFrom || date > p.holidayTo)) return { ...result, missing: ['holidayCoverage'] };
  if (p.holidayPolicy === 'DATES' && p.holidays.includes(date)) return { ...result, state: 'HOLIDAY', missing: [] };
  if (p.holidayPolicy === 'COMPANY_ANNOUNCED' && companyHolidays.includes(date)) return { ...result, state: 'HOLIDAY', missing: [] };
  const weekday = dateValue(date).getUTCDay() || 7;
  if (!p.workDays.includes(weekday)) return { ...result, state: 'WEEKLY_OFF', missing: [] };
  const start = instantFor(date, '19:00', p.timeZone), end = instantFor(addDays(date, 1), '05:00', p.timeZone);
  if (!start || !end || end <= start) return { ...result, missing: ['timeZoneTransition'] };
  return { ...result, state: 'SCHEDULED', missing: [], startsAt: start.toISOString(), endsAt: end.toISOString() };
}
function resolveSchedule(versions, assignments, episodes, now = new Date(), companyHolidays = []) {
  const base = { duty: '19:00–05:00 next day', anchor: 'SHIFT_START_DATE', current: null, next: null };
  if (!versions.length) return { ...base, state: 'SETUP_REQUIRED', missing: ['officeSchedule'], applicable: null };
  const candidates = [], applicable = [];
  for (const version of versions) {
    if (!version.policy.timeZone) continue;
    const local = localParts(now, version.policy.timeZone), anchor = local.time < '05:00' ? addDays(local.date, -1) : local.date;
    if (versionFor(versions, anchor)?.id === version.id) applicable.push(scheduleDate(version, anchor, assignments, episodes, companyHolidays));
    // Bounded search: return an honest null if no confirmed scheduled date exists in the next year.
    for (let offset = -1; offset <= 366; offset++) {
      const date = addDays(local.date, offset);
      if (versionFor(versions, date)?.id !== version.id) continue;
      const item = scheduleDate(version, date, assignments, episodes, companyHolidays);
      if (item.state === 'SCHEDULED') { candidates.push(item); if (Date.parse(item.startsAt) > +now) break; }
    }
  }
  const current = candidates.filter(s => Date.parse(s.startsAt) <= +now && +now < Date.parse(s.endsAt)).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0] || null;
  const next = candidates.filter(s => Date.parse(s.startsAt) > +now).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0] || null;
  const selected = current || applicable[applicable.length - 1] || null;
  return { ...base, state: selected?.state || 'SETUP_REQUIRED', missing: selected?.missing || ['effectiveOfficePolicy'], applicable: selected, current, next, nextSearchDays: 366 };
}
module.exports = { addDays, localParts, instantFor, missingPolicy, resolveSchedule, scheduleDate };
