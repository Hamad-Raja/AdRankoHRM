import { ApiError, apiRequest } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = value => typeof value === "string" && UUID.test(value);
const sameId = (left, right) => isId(left) && isId(right) && left.toLowerCase() === right.toLowerCase();

function validDate(value) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validShift(shift) {
  if (!shift || typeof shift.startTime !== "string" || typeof shift.endTime !== "string" ||
      !CLOCK.test(shift.startTime) || !CLOCK.test(shift.endTime) || typeof shift.endsNextDay !== "boolean") return false;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const duration = minutes(shift.endTime) - minutes(shift.startTime) + (shift.endsNextDay ? 1440 : 0);
  return isId(shift.id) && duration > 0 && duration < 1440 &&
    typeof shift.name === "string" && shift.name.length > 0 &&
    typeof shift.timeZone === "string" && shift.timeZone.length > 0 &&
    typeof shift.startTime === "string" && CLOCK.test(shift.startTime) &&
    typeof shift.endTime === "string" && CLOCK.test(shift.endTime) &&
    typeof shift.endsNextDay === "boolean" &&
    Array.isArray(shift.workDays) && shift.workDays.length > 0 && shift.workDays.length <= 7 &&
    shift.workDays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(shift.workDays).size === shift.workDays.length &&
    Number.isInteger(shift.breakMinutes) && shift.breakMinutes >= 0 && shift.breakMinutes < duration &&
    Number.isInteger(shift.graceMinutes) && shift.graceMinutes >= 0 && shift.graceMinutes < duration &&
    (shift.breakMinutes === 0 ? shift.breakPaid === null : typeof shift.breakPaid === "boolean") &&
    (shift.archivedAt === null || validTimestamp(shift.archivedAt));
}

function validAssignment(row) {
  return row && isId(row.id) && isId(row.employeeId) &&
    isId(row.employmentEpisodeId) && isId(row.shiftId) &&
    validDate(row.effectiveFrom) &&
    (row.effectiveTo === null || (validDate(row.effectiveTo) && row.effectiveTo >= row.effectiveFrom)) &&
    typeof row.reason === "string" && validShift(row.shift) && sameId(row.shift.id, row.shiftId);
}

function invalidResponse() {
  return new ApiError("The server returned an unexpected shift response.", { code: "INVALID_RESPONSE" });
}

function idPath(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ApiError("The shift or employee ID is invalid.", { status: 400, code: "VALIDATION_ERROR" });
  }
  return encodeURIComponent(value.toLowerCase());
}

function writeOptions(csrfToken, body, signal) {
  if (typeof csrfToken !== "string" || !/^[a-f0-9]{64}$/i.test(csrfToken)) {
    throw new ApiError("Please verify your session before saving.", { status: 401, code: "CSRF_UNAVAILABLE" });
  }
  return { method: "POST", body, csrfToken, signal };
}

export async function listShifts({ signal } = {}) {
  const payload = await apiRequest("/shifts", { signal });
  if (!Array.isArray(payload?.data?.shifts) || !payload.data.shifts.every(validShift)) throw invalidResponse();
  return payload.data.shifts;
}

export async function createShift(data, { csrfToken, signal } = {}) {
  const payload = await apiRequest("/shifts", writeOptions(csrfToken, data, signal));
  if (!validShift(payload?.data?.shift)) throw invalidResponse();
  return payload.data.shift;
}

export async function archiveShift(shiftId, reason, { csrfToken, signal } = {}) {
  const payload = await apiRequest(`/shifts/${idPath(shiftId)}/archive`, writeOptions(csrfToken, { reason }, signal));
  const shift = payload?.data?.shift;
  if (!validShift(shift) || !sameId(shift.id, shiftId) || shift.archivedAt === null) throw invalidResponse();
  return shift;
}

export async function listShiftAssignments(employeeId, { signal } = {}) {
  const payload = await apiRequest(`/shifts/employees/${idPath(employeeId)}/assignments`, { signal });
  const rows = payload?.data?.assignments;
  if (!Array.isArray(rows) || !rows.every(row => validAssignment(row) && sameId(row.employeeId, employeeId))) throw invalidResponse();
  return rows;
}

export async function assignShift(employeeId, data, { csrfToken, signal } = {}) {
  const payload = await apiRequest(`/shifts/employees/${idPath(employeeId)}/assignments`, writeOptions(csrfToken, data, signal));
  const row = payload?.data?.assignment;
  if (!validAssignment(row) || !sameId(row.employeeId, employeeId) || !sameId(row.shiftId, data.shiftId) ||
      !sameId(row.employmentEpisodeId, data.employmentEpisodeId) || row.effectiveFrom !== data.effectiveFrom ||
      row.effectiveTo !== (data.effectiveTo ?? null)) throw invalidResponse();
  return row;
}