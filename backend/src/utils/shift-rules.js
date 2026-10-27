"use strict";

// Pure rules shared by validation and the dependency-free tests.
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function timeMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isTimeZone(value) {
  if (typeof value !== "string" || value.length > 80 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isWorkWeek(days) {
  return Array.isArray(days) && days.length > 0 && days.length <= 7 &&
    days.every(day => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(days).size === days.length;
}

function shiftDuration(startTime, endTime, endsNextDay) {
  const start = timeMinutes(startTime), end = timeMinutes(endTime);
  if (start === null || end === null || typeof endsNextDay !== "boolean") return null;
  const duration = end - start + (endsNextDay ? 1440 : 0);
  // Reject zero-length and 24-hour/multi-day definitions.
  return duration > 0 && duration < 1440 ? duration : null;
}

function shiftIssues(data) {
  const issues = [];
  const duration = shiftDuration(data.startTime, data.endTime, data.endsNextDay);
  if (duration === null) {
    issues.push({ field: "endTime", message: "Enter a shift longer than zero and shorter than 24 hours; check the next-day setting." });
  }
  if (data.breakMinutes === 0 && data.breakPaid !== null) {
    issues.push({ field: "breakPaid", message: "Use null when there is no break allowance." });
  }
  if (data.breakMinutes > 0 && typeof data.breakPaid !== "boolean") {
    issues.push({ field: "breakPaid", message: "Explicitly choose whether the break allowance is paid." });
  }
  if (duration !== null && data.breakMinutes >= duration) {
    issues.push({ field: "breakMinutes", message: "Break allowance must be shorter than the shift." });
  }
  if (duration !== null && data.graceMinutes >= duration) {
    issues.push({ field: "graceMinutes", message: "Grace period must be shorter than the shift." });
  }
  return issues;
}

function dateValue(value) { return new Date(`${value}T00:00:00.000Z`); }
function dateString(value) { return value == null ? null : value.toISOString().slice(0, 10); }
function previousDate(value) { return new Date(dateValue(value).getTime() - 86400000); }
function intervalsOverlap(aFrom, aTo, bFrom, bTo) {
  return (aTo == null || bFrom <= aTo) && (bTo == null || aFrom <= bTo);
}

module.exports = {
  isCalendarDate, timeMinutes, isTimeZone, isWorkWeek, shiftDuration,
  shiftIssues, dateValue, dateString, previousDate, intervalsOverlap,
};