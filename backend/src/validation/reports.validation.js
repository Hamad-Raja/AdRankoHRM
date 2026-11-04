'use strict';

const ApiError = require('../utils/ApiError');

const REPORT_TIME_ZONE = 'Asia/Karachi';

const REPORT_LIMITS = Object.freeze({
  maxRangeDays: 366,
  maxPage: 10000,
  maxPageSize: 100,
  maxExportRows: 10000,
});

const ATTENDANCE_FILTERS = Object.freeze([
  'OPEN',
  'COMPLETED',
  'CORRECTED',
  'MISSING_CHECKOUT',
  'LATE',
  'EARLY_DEPARTURE',
  'AFTER_SCHEDULE_END',
  'NO_CLOCK_IN',
  'APPROVED_EXCEPTION',
  'PAID_LEAVE',
  'NOT_YET_ENDED',
  'WEEKLY_OFF',
  'HOLIDAY',
  'NOT_ELIGIBLE',
  'SETUP_REQUIRED',
  'LEGACY_ASSIGNMENT_REVIEW',
]);

const CORRECTION_FILTERS = Object.freeze([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_MS = 86400000;

const has = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

function invalid(message) {
  throw new ApiError(400, message, 'VALIDATION_ERROR');
}

function calendarDate(value, field) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    invalid(`${field} must be a valid YYYY-MM-DD date.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(+parsed) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    invalid(`${field} must be a valid calendar date.`);
  }

  return parsed;
}

function currentMonth(now) {
  if (!(now instanceof Date) || !Number.isFinite(+now)) {
    throw new TypeError(
      'Report validation requires a valid server date.'
    );
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: REPORT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
    })
      .formatToParts(now)
      .map(part => [part.type, part.value])
  );

  return `${parts.year.padStart(4, '0')}-${parts.month}`;
}

function monthRange(month) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    month.startsWith('0000-')
  ) {
    invalid('month must be a valid YYYY-MM value.');
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

function positiveInteger(value, fallback, maximum, field) {
  if (value === undefined) return fallback;

  if (!/^[1-9]\d*$/.test(value)) {
    invalid(`${field} must be a positive integer.`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    invalid(`${field} must not exceed ${maximum}.`);
  }

  return number;
}

// Routes choose report/exporting. Only the server supplies now.
// This validates syntax and bounds; services still enforce ownership and scope.
function parseReportQuery(query = {}, options = {}) {
  const {
    report = 'attendance',
    exporting = false,
    now = new Date(),
  } = options;

  if (
    !['monthly', 'attendance', 'corrections'].includes(report) ||
    typeof exporting !== 'boolean'
  ) {
    throw new TypeError('Invalid server report configuration.');
  }

  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    ![null, Object.prototype].includes(
      Object.getPrototypeOf(query)
    )
  ) {
    invalid('Report query must be an object of single text values.');
  }

  const allowed = new Set([
    'month',
    'employeeId',
    'departmentId',
    'campaignId',
    'teamId',
    'search',
    ...(report === 'monthly'
      ? []
      : ['dateFrom', 'dateTo', 'status']),
    ...(exporting ? ['format'] : ['page', 'pageSize']),
  ]);

  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key)) {
      invalid(`Unsupported report parameter: ${key}.`);
    }

    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > 200
    ) {
      invalid(
        `${key} must contain one non-empty text value of at most 200 characters.`
      );
    }
  }

  const hasRange =
    has(query, 'dateFrom') || has(query, 'dateTo');

  if (has(query, 'month') && hasRange) {
    invalid('Use month or dateFrom/dateTo, not both.');
  }

  if (
    hasRange &&
    !(has(query, 'dateFrom') && has(query, 'dateTo'))
  ) {
    invalid('dateFrom and dateTo must be provided together.');
  }

  const month = hasRange
    ? null
    : (query.month ?? currentMonth(now));

  const range = hasRange
    ? {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }
    : monthRange(month);

  const from = calendarDate(range.dateFrom, 'dateFrom');
  const to = calendarDate(range.dateTo, 'dateTo');

  const rangeDays = (+to - +from) / DAY_MS + 1;

  if (rangeDays < 1) {
    invalid('dateTo must be on or after dateFrom.');
  }

  if (rangeDays > REPORT_LIMITS.maxRangeDays) {
    invalid(
      `Select at most ${REPORT_LIMITS.maxRangeDays} inclusive duty dates.`
    );
  }

  const result = {
    report,
    timeZone: REPORT_TIME_ZONE,
    month,
    ...range,
    rangeDays,
  };

  for (const field of [
    'employeeId',
    'departmentId',
    'campaignId',
    'teamId',
  ]) {
    if (has(query, field)) {
      if (!UUID.test(query[field])) {
        invalid(`${field} must be a valid UUID.`);
      }

      result[field] = query[field].toLowerCase();
    }
  }

  if (has(query, 'search')) {
    const search = query.search.trim();

    if (
      !search ||
      search.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(search)
    ) {
      invalid(
        'search must contain 1–120 characters without control characters.'
      );
    }

    result.search = search;
  }

  if (has(query, 'status')) {
    const statuses =
      report === 'corrections'
        ? CORRECTION_FILTERS
        : ATTENDANCE_FILTERS;

    if (!statuses.includes(query.status)) {
      invalid('Unsupported status for this report.');
    }

    result.status = query.status;
  }

  if (exporting) {
    const format = query.format ?? 'csv';

    if (!['csv', 'xlsx'].includes(format)) {
      invalid('format must be csv or xlsx.');
    }

    result.format = format;

    // The export service must reject overflow, never silently truncate.
    result.maxExportRows = REPORT_LIMITS.maxExportRows;
  } else {
    result.page = positiveInteger(
      query.page,
      1,
      REPORT_LIMITS.maxPage,
      'page'
    );

    result.pageSize = positiveInteger(
      query.pageSize,
      20,
      REPORT_LIMITS.maxPageSize,
      'pageSize'
    );
  }

  return result;
}

module.exports = {
  parseReportQuery,
  REPORT_TIME_ZONE,
  REPORT_LIMITS,
  ATTENDANCE_FILTERS,
  CORRECTION_FILTERS,
};
