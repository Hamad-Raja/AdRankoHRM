'use strict';

const ApiError = require('./ApiError');
const { localParts } = require('./office-schedule');

const {
  REPORT_LIMITS,
  REPORT_TIME_ZONE,
} = require('../validation/reports.validation');

const { makeWorkbook, validText } = require('./reports-xlsx');

const MAX_CSV_BYTES = 32 * 1024 * 1024;

function localTime(value) {
  if (!value) return null;

  const instant = new Date(value);
  const parts = localParts(instant, REPORT_TIME_ZONE);

  return `${parts.date} ${parts.time}:${parts.stamp.slice(17, 19)}.${String(
    instant.getUTCMilliseconds()
  ).padStart(3, '0')}`;
}

const column = (header, get, type = 'text') => ({
  header,
  get,
  type,
});

const names = (row, field) =>
  [
    ...new Set(
      (row.organizations || [])
        .map(org => org[field]?.name)
        .filter(Boolean)
    ),
  ].join('; ');

const orgColumns = [
  'department',
  'campaign',
  'team',
  'designation',
].map(field =>
  column(
    `${field[0].toUpperCase()}${field.slice(1)}`,
    row => row.organization?.[field]?.name
  )
);

const identity = [
  column(
    'EmployeeCode',
    row => row.employee.employeeCode,
    'identifier'
  ),
  column('EmployeeName', row => row.employee.fullName),
];

function reportColumns(report) {
  if (report === 'monthly') {
    const fields = [
      'dutyDates',
      'eligibleDuties',
      'actualRecords',
      'actualCompleted',
      'actualOpen',
      'onTime',
      'late',
      'earlyDeparture',
      'afterScheduleEnd',
      'rawMissingCheckout',
      'unresolvedMissingCheckout',
      'noClockIn',
      'approvedExceptions',
      'adjustedRecords',
      'rawWorkedMinutes',
      'rawDurationUnknown',
      'approvedIntervalMinutes',
    ];

    return [
      ...identity,
      ...fields.map(field =>
        column(field, row => row.metrics[field], 'number')
      ),
      ...['department', 'campaign', 'team', 'designation'].map(
        field =>
          column(`${field}Labels`, row => names(row, field))
      ),
      column(
        'ClassificationCounts',
        row => JSON.stringify(row.metrics.classifications)
      ),
    ];
  }

  if (report === 'attendance') {
    return [
      ...identity,
      ...orgColumns,
      column('DutyStartDate', row => row.shiftDate),
      column('Classification', row => row.classification),
      column('CalendarState', row => row.scheduleState),
      column('EligibleDuty', row => row.eligibleDuty),
      column(
        'RecordedScheduleTimezone',
        row => row.scheduleTimeZone
      ),
      column(
        'ScheduledStartLocal',
        row => localTime(row.scheduledStart)
      ),
      column(
        'ScheduledEndLocal',
        row => localTime(row.scheduledEnd)
      ),
      column('GraceMinutes', row => row.graceMinutes, 'number'),
      column(
        'ActualRecordId',
        row => row.actual?.attendanceRecordId,
        'identifier'
      ),
      column(
        'ActualClockInLocal',
        row => localTime(row.actual?.clockInAt)
      ),
      column(
        'ActualClockOutLocal',
        row => localTime(row.actual?.clockOutAt)
      ),
      column(
        'RawWorkedMinutes',
        row => row.actual?.workedMinutes,
        'number'
      ),
      column('RawLate', row => row.actual?.isLate),
      column(
        'RawEarlyDeparture',
        row => row.actual?.isEarlyDeparture
      ),
      column(
        'RawAfterScheduleEnd',
        row => row.actual?.isAfterScheduleEnd
      ),
      column(
        'RawMissingCheckout',
        row => row.actual?.rawMissingCheckout
      ),
      column(
        'UnresolvedMissingCheckout',
        row => row.unresolvedMissingCheckout
      ),
      column(
        'AdjustmentCorrectionId',
        row => row.approvedAdjustment?.correctionId,
        'identifier'
      ),
      column(
        'AdjustedClockInLocal',
        row => localTime(row.approvedAdjustment?.clockInAt)
      ),
      column(
        'AdjustedClockOutLocal',
        row => localTime(row.approvedAdjustment?.clockOutAt)
      ),
      column(
        'ApprovedAdjustmentMinutes',
        row => row.approvedAdjustment?.minutes,
        'number'
      ),
      column(
        'ExceptionCorrectionId',
        row => row.approvedException?.correctionId,
        'identifier'
      ),
      column(
        'ExceptionClockInLocal',
        row => localTime(row.approvedException?.clockInAt)
      ),
      column(
        'ExceptionClockOutLocal',
        row => localTime(row.approvedException?.clockOutAt)
      ),
      column(
        'ApprovedExceptionMinutes',
        row => row.approvedException?.minutes,
        'number'
      ),
    ];
  }

  if (report === 'corrections') {
    return [
      ...identity,
      ...orgColumns,
      column('CorrectionId', row => row.id, 'identifier'),
      column('DutyStartDate', row => row.shiftDate),
      column(
        'ActualRecordId',
        row => row.attendanceRecordId,
        'identifier'
      ),
      column('RequestType', row => row.requestType),
      column('Decision', row => row.status),
      column('Reason', row => row.reason),
      column('Requester', row => row.requester),
      column(
        'RequestedLocal',
        row => localTime(row.requestedAt)
      ),
      column(
        'OriginalClockInLocal',
        row => localTime(row.original?.clockInAt)
      ),
      column(
        'OriginalClockOutLocal',
        row => localTime(row.original?.clockOutAt)
      ),
      column(
        'OriginalRecordVersion',
        row => row.original?.recordVersion,
        'number'
      ),
      column(
        'ProposedClockInLocal',
        row => localTime(row.proposedClockInAt)
      ),
      column(
        'ProposedClockOutLocal',
        row => localTime(row.proposedClockOutAt)
      ),
      column(
        'ApprovedClockInLocal',
        row => localTime(row.approvedInterpretation?.clockInAt)
      ),
      column(
        'ApprovedClockOutLocal',
        row => localTime(row.approvedInterpretation?.clockOutAt)
      ),
      column(
        'ApprovedIntervalMinutes',
        row => row.approvedInterpretation?.minutes,
        'number'
      ),
      column('Reviewer', row => row.reviewer),
      column(
        'ReviewedLocal',
        row => localTime(row.reviewedAt)
      ),
      column('ReviewReason', row => row.reviewReason),
    ];
  }

  throw new ApiError(404, 'Report not found.', 'NOT_FOUND');
}

function csvCell(value, type = 'text') {
  if (value == null) return '""';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ApiError(
        422,
        'Invalid export number.',
        'EXPORT_VALUE_INVALID'
      );
    }

    return String(value);
  }

  let text = validText(
    typeof value === 'boolean' ? String(value) : value
  );

  if (
    text &&
    (
      type === 'identifier' ||
      /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/u.test(text)
    )
  ) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function flattenObject(value, prefix = '') {
  const rows = [];

  for (const [key, item] of Object.entries(value || {})) {
    const label = prefix ? `${prefix}.${key}` : key;

    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item)
    ) {
      rows.push(...flattenObject(item, label));
    } else {
      rows.push([
        label,
        Array.isArray(item) ? JSON.stringify(item) : item,
      ]);
    }
  }

  return rows;
}

async function encodeReport(data) {
  if (
    !data ||
    !Array.isArray(data.rows) ||
    data.rows.length !== data.total ||
    data.page !== undefined
  ) {
    throw new ApiError(
      500,
      'Complete authorized export data is required.',
      'EXPORT_DATA_INCOMPLETE'
    );
  }

  if (data.rows.length > REPORT_LIMITS.maxExportRows) {
    throw new ApiError(
      413,
      'Export exceeds the row limit. Narrow the filters.',
      'EXPORT_TOO_LARGE'
    );
  }

  const { meta, format } = data;

  if (!['csv', 'xlsx'].includes(format)) {
    throw new ApiError(
      400,
      'Unsupported export format.',
      'VALIDATION_ERROR'
    );
  }

  const columns = [
    ...reportColumns(meta.report),
    column('DisplayTimezone', () => REPORT_TIME_ZONE),
    column('ReportDateFrom', () => meta.period.dateFrom),
    column('ReportDateTo', () => meta.period.dateTo),
    column('GeneratedAtUTC', () => meta.generatedAt),
  ];

  const headers = columns.map(item => item.header);

  const rows = data.rows.map(row =>
    columns.map(item => item.get(row) ?? null)
  );

  let buffer;

  if (format === 'csv') {
    const lines = [
      headers.map(header => csvCell(header)).join(','),
    ];

    let bytes = Buffer.byteLength(lines[0], 'utf8') + 5;

    for (const row of rows) {
      const line = row
        .map((value, index) =>
          csvCell(value, columns[index].type)
        )
        .join(',');

      bytes += Buffer.byteLength(line, 'utf8') + 2;

      if (bytes > MAX_CSV_BYTES) {
        throw new ApiError(
          413,
          'CSV is too large. Narrow the report filters.',
          'EXPORT_TOO_LARGE'
        );
      }

      lines.push(line);
    }

    buffer = Buffer.from(
      '\ufeff' + lines.join('\r\n') + '\r\n',
      'utf8'
    );
  } else {
    buffer = await makeWorkbook(
      [
        {
          name: 'Report',
          headers,
          rows,
        },
        {
          name: 'Totals',
          headers: ['Metric', 'Value'],
          rows: flattenObject(data.totals),
        },
        {
          name: 'Metadata',
          headers: ['Field', 'Value'],
          rows: [
            ...flattenObject(meta),
            ['exportRowCount', data.total],
            [
              'textHandling',
              'XLSX strings are typed text. CSV identifiers carry a protective apostrophe; formula-like CSV text is also prefixed.',
            ],
          ],
        },
      ],
      meta.generatedAt
    );
  }

  return {
    buffer,
    filename: `officehr-${meta.report}-${meta.period.dateFrom}-to-${meta.period.dateTo}.${format}`,
    contentType:
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

module.exports = {
  encodeReport,
  csvCell,
  localTime,
  reportColumns,
};