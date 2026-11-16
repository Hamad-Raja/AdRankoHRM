export const REPORT_ZONE = "Asia/Karachi";

export const REPORT_TYPES = [
  "monthly",
  "attendance",
  "corrections",
];

export const STATUS_LABELS = {
  OPEN: "Open",
  COMPLETED: "Completed",
  CORRECTED: "Adjusted",
  MISSING_CHECKOUT: "Missing checkout",
  NO_CLOCK_IN: "No clock-in",
  APPROVED_EXCEPTION: "Approved exception",
  PAID_LEAVE: "Approved paid leave",
  NOT_YET_ENDED: "Duty not yet ended",
  WEEKLY_OFF: "Weekly off",
  HOLIDAY: "Company holiday",
  NOT_ELIGIBLE: "Not eligible",
  SETUP_REQUIRED: "Setup required",
  LEGACY_ASSIGNMENT_REVIEW: "Assignment review required",
  LATE: "Late entry",
  EARLY_DEPARTURE: "Early departure",
  AFTER_SCHEDULE_END: "Checkout after duty",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const ATTENDANCE_STATUSES = [
  "OPEN",
  "COMPLETED",
  "CORRECTED",
  "MISSING_CHECKOUT",
  "LATE",
  "EARLY_DEPARTURE",
  "AFTER_SCHEDULE_END",
  "NO_CLOCK_IN",
  "APPROVED_EXCEPTION",
  "PAID_LEAVE",
  "NOT_YET_ENDED",
  "WEEKLY_OFF",
  "HOLIDAY",
  "NOT_ELIGIBLE",
  "SETUP_REQUIRED",
  "LEGACY_ASSIGNMENT_REVIEW",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const count = (value) =>
  Number.isSafeInteger(value) && value >= 0;

export const validDate = (value) =>
  typeof value === "string" &&
  /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function karachiMonth(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_ZONE,
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  return `${parts.year.padStart(4, "0")}-${parts.month}`;
}

export function monthDates(month) {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Select a valid month.");
  }

  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  const leap =
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);

  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${days[number - 1]}`,
  };
}

export function initialReportFilters(month = karachiMonth()) {
  return {
    periodMode: "month",
    month,
    ...monthDates(month),
    search: "",
    employeeId: "",
    employeeLabel: "",
    departmentId: "",
    campaignId: "",
    teamId: "",
    status: "",
  };
}

export function reportQuery(filters, report, page = 1) {
  if (!REPORT_TYPES.includes(report)) {
    throw new Error("Select a valid report.");
  }

  const query = new URLSearchParams();

  if (report === "monthly" || filters.periodMode === "month") {
    monthDates(filters.month);
    query.set("month", filters.month);
  } else {
    if (
      filters.periodMode !== "range" ||
      !validDate(filters.dateFrom) ||
      !validDate(filters.dateTo)
    ) {
      throw new Error("Select valid start and end duty dates.");
    }

    const days =
      (Date.parse(filters.dateTo) - Date.parse(filters.dateFrom)) /
        86400000 +
      1;

    if (days < 1 || days > 366) {
      throw new Error(
        "Select an ordered range of at most 366 duty dates."
      );
    }

    query.set("dateFrom", filters.dateFrom);
    query.set("dateTo", filters.dateTo);
  }

   const search = filters.search.trim();

  const hasControlCharacters = [...search].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (search.length > 120 || hasControlCharacters) {
    throw new Error(
      "Search must contain at most 120 characters without control characters."
    );
  }

  if (search) {
    query.set("search", search);
  }

  for (const field of [
    "employeeId",
    "departmentId",
    "campaignId",
    "teamId",
  ]) {
    if (filters[field]) {
      if (!UUID.test(filters[field])) {
        throw new Error(
          "Select a valid employee or organization filter."
        );
      }

      query.set(field, filters[field]);
    }
  }

  if (filters.status && report !== "monthly") {
    const allowed =
      report === "corrections"
        ? ["PENDING", "APPROVED", "REJECTED"]
        : ATTENDANCE_STATUSES;

    if (!allowed.includes(filters.status)) {
      throw new Error("Select a valid report status.");
    }

    query.set("status", filters.status);
  }

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000
  ) {
    throw new Error("Invalid report page.");
  }

  query.set("page", String(page));
  query.set("pageSize", "20");

  return query.toString();
}

export function exportQuery(queryString, format) {
  if (!["csv", "xlsx"].includes(format)) {
    throw new Error("Select CSV or XLSX.");
  }

  const query = new URLSearchParams(queryString);

  query.delete("page");
  query.delete("pageSize");
  query.set("format", format);

  return query.toString();
}

export function validateReport(payload, report) {
  const data = payload?.data;
  const meta = data?.meta;

  const employee = (row) =>
    row?.employee &&
    typeof row.employee.fullName === "string" &&
    typeof row.employee.employeeCode === "string" &&
    typeof row.employee.id === "string";

  if (
    !REPORT_TYPES.includes(report) ||
    payload?.success !== true ||
    !meta ||
    meta.report !== report ||
    meta.timeZone !== REPORT_ZONE ||
    !["ORGANIZATION", "OWN", "DATED_TEAM_AND_OWN"].includes(
      meta.access
    ) ||
    ![
      "EFFECTIVE_POLICY_PRESENT",
      "FUTURE_POLICY_ONLY",
      "NO_ACTIVATED_POLICY",
    ].includes(meta.currentPolicyState) ||
    !Number.isFinite(Date.parse(meta.generatedAt)) ||
    !validDate(meta.period?.dateFrom) ||
    !validDate(meta.period?.dateTo) ||
    meta.period.dateFrom > meta.period.dateTo ||
    !Array.isArray(data.rows) ||
    !count(data.total) ||
    !Number.isInteger(data.page) ||
    data.page < 1 ||
    !Number.isInteger(data.pageSize) ||
    data.pageSize < 1 ||
    data.pageSize > 100 ||
    data.totalPages !== Math.ceil(data.total / data.pageSize) ||
    data.rows.length > data.pageSize ||
    data.rows.length > data.total ||
    !data.totals ||
    Array.isArray(data.totals) ||
    !data.rows.every(
      (row) =>
        employee(row) &&
        (report === "monthly"
          ? row.metrics &&
            typeof row.metrics === "object" &&
            !Array.isArray(row.metrics)
          : validDate(row.shiftDate) &&
            (report === "attendance"
              ? typeof row.classification === "string"
              : typeof row.status === "string"))
    )
  ) {
    throw new Error(
      "The server returned an unexpected report response."
    );
  }

  return data;
}

export function reportFilename(report, meta, format) {
  if (
    !REPORT_TYPES.includes(report) ||
    !["csv", "xlsx"].includes(format) ||
    !validDate(meta?.period?.dateFrom) ||
    !validDate(meta?.period?.dateTo)
  ) {
    throw new Error(
      "The download period is unavailable. Refresh the report."
    );
  }

  return `AdRankoHRM-${report}-${meta.period.dateFrom}-to-${meta.period.dateTo}.${format}`;
}

export async function validateReportBlob(blob, format) {
  const type = blob?.type?.split(";")[0].trim().toLowerCase();

  const expected =
    format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (
    !(blob instanceof Blob) ||
    !blob.size ||
    !["csv", "xlsx"].includes(format) ||
    type !== expected
  ) {
    throw new Error(
      "The server returned an unexpected download response."
    );
  }

  const bytes = new Uint8Array(
    await blob.slice(0, 4).arrayBuffer()
  );

  const valid =
    format === "xlsx"
      ? bytes[0] === 80 &&
        bytes[1] === 75 &&
        bytes[2] === 3 &&
        bytes[3] === 4
      : bytes[0] === 239 &&
        bytes[1] === 187 &&
        bytes[2] === 191;

  if (!valid) {
    throw new Error("The download content could not be verified.");
  }

  return blob;
}

export function formatReportTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).format(new Date(value));
}

export function formatReportMinutes(value) {
  return count(value)
    ? `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`
    : "—";
}
