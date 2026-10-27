import { apiRequest, ApiError } from "@/lib/api";

const invalid = () => {
  throw new ApiError("The server returned an unexpected attendance response.", {
    code: "INVALID_RESPONSE",
  });
};

const data = (payload) =>
  payload?.success === true && payload.data && typeof payload.data === "object"
    ? payload.data
    : invalid();

export async function getAttendanceStatus(options = {}) {
  const value = data(await apiRequest("/attendance/status", options));
  return value;
}

export async function clockIn(requestId, csrfToken, options = {}) {
  const value = data(
    await apiRequest("/attendance/clock-in", {
      ...options,
      method: "POST",
      body: { requestId },
      csrfToken,
    })
  );
  return value;
}

export async function clockOut(requestId, attendanceRecordId, csrfToken, options = {}) {
  const value = data(
    await apiRequest("/attendance/clock-out", {
      ...options,
      method: "POST",
      body: { requestId, attendanceRecordId },
      csrfToken,
    })
  );
  return value;
}

export async function getOwnHistory(
  { page = 1, pageSize = 20, dateFrom, dateTo } = {},
  options = {}
) {
  const query = new URLSearchParams();
  if (page) query.set("page", String(page));
  if (pageSize) query.set("pageSize", String(pageSize));
  if (dateFrom) query.set("dateFrom", dateFrom);
  if (dateTo) query.set("dateTo", dateTo);

  const qs = query.toString();
  const path = `/attendance/history${qs ? `?${qs}` : ""}`;
  const value = data(await apiRequest(path, options));
  return value;
}

export async function submitCorrectionRequest(body, csrfToken, options = {}) {
  const value = data(
    await apiRequest("/attendance/corrections", {
      ...options,
      method: "POST",
      body,
      csrfToken,
    })
  );
  return value;
}

export async function listOwnCorrections(
  { page = 1, pageSize = 20, status } = {},
  options = {}
) {
  const query = new URLSearchParams();
  if (page) query.set("page", String(page));
  if (pageSize) query.set("pageSize", String(pageSize));
  if (status) query.set("status", status);

  const qs = query.toString();
  const path = `/attendance/corrections${qs ? `?${qs}` : ""}`;
  const value = data(await apiRequest(path, options));
  return value;
}

export async function getAttendanceList(
  { page = 1, pageSize = 20, dateFrom, dateTo, employeeId, status, search, departmentId, campaignId, teamId } = {},
  options = {}
) {
  const query = new URLSearchParams();
  if (page) query.set("page", String(page));
  if (pageSize) query.set("pageSize", String(pageSize));
  if (dateFrom) query.set("dateFrom", dateFrom);
  if (dateTo) query.set("dateTo", dateTo);
  if (employeeId) query.set("employeeId", employeeId);
  if (search) query.set("search", search);
  if (departmentId) query.set("departmentId", departmentId);
  if (campaignId) query.set("campaignId", campaignId);
  if (teamId) query.set("teamId", teamId);
  if (status) query.set("status", status);

  const qs = query.toString();
  const path = `/attendance/all${qs ? `?${qs}` : ""}`;
  const value = data(await apiRequest(path, options));
  return value;
}

export async function getDailySummary(date, options = {}) {
  const path = `/attendance/daily-summary/${encodeURIComponent(date)}`;
  const value = data(await apiRequest(path, options));
  return value;
}

export async function reviewCorrection(id, body, csrfToken, options = {}) {
  const path = `/attendance/corrections/${encodeURIComponent(id)}/review`;
  const value = data(
    await apiRequest(path, {
      ...options,
      method: "POST",
      body,
      csrfToken,
    })
  );
  return value;
}

export async function listAllCorrections(
  { page = 1, pageSize = 20, status, employeeId } = {},
  options = {}
) {
  const query = new URLSearchParams();
  if (page) query.set("page", String(page));
  if (pageSize) query.set("pageSize", String(pageSize));
  if (status) query.set("status", status);
  if (employeeId) query.set("employeeId", employeeId);

  const qs = query.toString();
  const path = `/attendance/corrections/all${qs ? `?${qs}` : ""}`;
  const value = data(await apiRequest(path, options));
  return value;
}
