'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const {
  encodeReport,
  csvCell,
  localTime,
} = require('../src/utils/reports-export');

const { emptyMetrics } = require('../src/utils/reports-rules');

function fixture(report = 'attendance', format = 'xlsx') {
  const employee = {
    id: 'employee-id',
    employeeCode: '000123',
    fullName: 'علی, "Khan"\nReport',
  };

  const metrics = {
    ...emptyMetrics(),
    dutyDates: 1,
    eligibleDuties: 1,
    actualRecords: 1,
    actualOpen: 1,
    rawDurationUnknown: 1,
    adjustedRecords: 1,
    approvedIntervalMinutes: 570,
    classifications: { CORRECTED: 1 },
  };

  const row =
    report === 'monthly'
      ? {
          employee,
          metrics,
          organizations: [],
        }
      : report === 'corrections'
        ? {
            employee,
            id: 'correction-id',
            attendanceRecordId: 'record-id',
            organization: null,
            shiftDate: '2026-10-23',
            requestType: 'MISSING_CHECKOUT',
            status: 'APPROVED',
            reason: '=HYPERLINK("https://example.invalid", "test")',
            requester: 'Employee',
            requestedAt: '2026-10-24T00:10:00.000Z',
            reviewedAt: '2026-10-24T01:00:00.000Z',
            reviewer: 'HR',
            reviewReason: 'Checked',
            original: {
              clockInAt: '2026-10-23T14:30:00.000Z',
              clockOutAt: null,
              recordVersion: 1,
            },
            proposedClockInAt: null,
            proposedClockOutAt: '2026-10-24T00:00:00.000Z',
            approvedInterpretation: {
              clockInAt: '2026-10-23T14:30:00.000Z',
              clockOutAt: '2026-10-24T00:00:00.000Z',
              minutes: 570,
            },
          }
        : {
            employee,
            organization: null,
            shiftDate: '2026-10-23',
            classification: 'CORRECTED',
            scheduleState: 'SCHEDULED',
            eligibleDuty: true,
            scheduleTimeZone: 'Asia/Karachi',
            graceMinutes: 30,
            scheduledStart: '2026-10-23T14:00:00.000Z',
            scheduledEnd: '2026-10-24T00:00:00.000Z',
            actual: {
              attendanceRecordId: 'record-id',
              clockInAt: '2026-10-23T14:30:00.000Z',
              clockOutAt: null,
              workedMinutes: null,
              isLate: false,
              isEarlyDeparture: false,
              isAfterScheduleEnd: false,
              rawMissingCheckout: true,
            },
            approvedAdjustment: {
              correctionId: 'correction-id',
              clockInAt: '2026-10-23T14:30:00.000Z',
              clockOutAt: '2026-10-24T00:00:00.000Z',
              minutes: 570,
            },
            approvedException: null,
            unresolvedMissingCheckout: false,
          };

  return {
    meta: {
      report,
      timeZone: 'Asia/Karachi',
      generatedAt: '2026-10-24T01:00:00.000Z',
      period: {
        month: '2026-10',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      },
      access: 'OWN',
      durationMeaning:
        'Actual and approved minutes overlap; these are not payable hours.',
    },
    rows: [row],
    total: 1,
    totals:
      report === 'corrections'
        ? {
            requests: 1,
            approved: 1,
            pending: 0,
            rejected: 0,
          }
        : metrics,
    format,
  };
}

function readCSV(text) {
  const rows = [];
  const values = [];
  let value = '';
  let quoted = false;

  const source = text.replace(/^\ufeff/, '');

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else if (
      char === '\r' &&
      source[index + 1] === '\n' &&
      !quoted
    ) {
      values.push(value);
      rows.push([...values]);
      values.length = 0;
      value = '';
      index++;
    } else {
      value += char;
    }
  }

  return rows;
}

test('CSV round trips Unicode, embedded quotes, commas and newlines', async () => {
  const data = fixture('attendance', 'csv');
  const file = await encodeReport(data);

  assert.deepEqual(
    [...file.buffer.subarray(0, 3)],
    [0xef, 0xbb, 0xbf]
  );

  const [headers, row] = readCSV(file.buffer.toString('utf8'));

  assert.equal(
    row[headers.indexOf('EmployeeName')],
    data.rows[0].employee.fullName
  );
  assert.equal(
    row[headers.indexOf('EmployeeCode')],
    "'000123"
  );
  assert.equal(row.length, headers.length);
  assert.equal(row[headers.indexOf('RawWorkedMinutes')], '');
  assert.equal(
    row[headers.indexOf('ApprovedAdjustmentMinutes')],
    '570'
  );
});

test('CSV formula-like strings are neutralized, including leading whitespace', () => {
  for (const text of [
    '=1+1',
    '+SUM(A1:A2)',
    '-1+1',
    '@SUM(A1)',
    '\t=1+1',
    '\r\n =1+1',
  ]) {
    assert.ok(
      readCSV(csvCell(text) + '\r\n')[0][0].startsWith("'")
    );
  }

  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(570), '570');

  assert.equal(
    readCSV(csvCell('ordinary text') + '\r\n')[0][0],
    'ordinary text'
  );
});

test('timestamps use Karachi, retain milliseconds and cross overnight dates', () => {
  assert.equal(
    localTime('2026-10-23T14:30:00.001Z'),
    '2026-10-23 19:30:00.001'
  );

  assert.equal(
    localTime('2026-10-24T00:00:00.000Z'),
    '2026-10-24 05:00:00.000'
  );

  assert.equal(localTime(null), null);
});

test('XLSX is a real workbook with Report, Totals and Metadata parts', async () => {
  const file = await encodeReport(fixture());

  assert.equal(file.buffer.subarray(0, 2).toString(), 'PK');

  assert.match(
    file.filename,
    /^officehr-attendance-2026-10-01-to-2026-10-31\.xlsx$/
  );

  const zip = await JSZip.loadAsync(file.buffer, {
    checkCRC32: true,
  });

  assert.ok(zip.file('[Content_Types].xml'));
  assert.ok(zip.file('xl/styles.xml'));

  const workbook = await zip
    .file('xl/workbook.xml')
    .async('string');

  for (const name of ['Report', 'Totals', 'Metadata']) {
    assert.ok(workbook.includes(`name="${name}"`));
  }
});

test('XLSX typed text preserves leading zeros and XML-sensitive characters', async () => {
  const data = fixture();
  data.rows[0].employee.fullName = '<f>1+1</f> & "Agent"';

  const zip = await JSZip.loadAsync(
    (await encodeReport(data)).buffer
  );

  const sheet = await zip
    .file('xl/worksheets/sheet1.xml')
    .async('string');

  assert.match(sheet, /r="A2"[^>]*t="inlineStr"/);
  assert.ok(sheet.includes('>000123</t>'));

  assert.ok(
    sheet.includes(
      '&lt;f&gt;1+1&lt;/f&gt; &amp; &quot;Agent&quot;'
    )
  );

  assert.doesNotMatch(sheet, /<f(?:\s|>)/);
});

test('formula-like XLSX cells remain literal strings without macros or external relationships', async () => {
  const file = await encodeReport(fixture('corrections'));
  const zip = await JSZip.loadAsync(file.buffer);

  const names = Object.keys(zip.files).filter(name =>
    /\.xml$|\.rels$/.test(name)
  );

  for (const name of names) {
    const xml = await zip.file(name).async('string');

    assert.doesNotMatch(xml, /<f(?:\s|>)/);
    assert.doesNotMatch(xml, /TargetMode="External"/);
  }

  assert.equal(
    Object.keys(zip.files).some(name => /vba|\.bin$/i.test(name)),
    false
  );

  const sheet = await zip
    .file('xl/worksheets/sheet1.xml')
    .async('string');

  assert.ok(sheet.includes('=HYPERLINK('));
});

test('literal OOXML escape-looking text is escaped rather than reinterpreted', async () => {
  for (const name of [
    'literal _x0041_',
    '_x005F_x0041_',
    '_X0041_',
    'a\r\nb',
  ]) {
    const data = fixture();
    data.rows[0].employee.fullName = name;

    const zip = await JSZip.loadAsync(
      (await encodeReport(data)).buffer
    );

    const xml = await zip
      .file('xl/worksheets/sheet1.xml')
      .async('string');

    const text = xml.match(
      /<c r="B2"[^>]*><is><t[^>]*>([\s\S]*?)<\/t>/
    )[1];

    const decoded = text.replace(
      /_x([0-9a-fA-F]{4})_/g,
      (_, hex) => String.fromCharCode(parseInt(hex, 16))
    );

    assert.equal(decoded, name);
  }
});

test('correction exports keep original null checkout separate from the approved interval', async () => {
  const file = await encodeReport(
    fixture('corrections', 'csv')
  );

  const [headers, row] = readCSV(file.buffer.toString());

  assert.equal(
    row[headers.indexOf('OriginalClockOutLocal')],
    ''
  );

  assert.equal(
    row[headers.indexOf('ApprovedClockOutLocal')],
    '2026-10-24 05:00:00.000'
  );

  assert.equal(
    row[headers.indexOf('ApprovedIntervalMinutes')],
    '570'
  );
});

test('empty CSV still has a header and empty XLSX retains all three sheets', async () => {
  for (const format of ['csv', 'xlsx']) {
    const data = fixture('monthly', format);
    data.rows = [];
    data.total = 0;

    const file = await encodeReport(data);

    if (format === 'csv') {
      assert.equal(
        readCSV(file.buffer.toString()).length,
        1
      );
    } else {
      const zip = await JSZip.loadAsync(file.buffer);
      assert.ok(zip.file('xl/worksheets/sheet3.xml'));
    }
  }
});

test('partial pages, inconsistent counts and unsupported formats are rejected', async () => {
  await assert.rejects(
    encodeReport({ ...fixture(), page: 1 }),
    /Complete authorized/
  );

  await assert.rejects(
    encodeReport({ ...fixture(), total: 2 }),
    /Complete authorized/
  );

  await assert.rejects(
    encodeReport({ ...fixture(), format: 'pdf' }),
    /Unsupported export/
  );
});

test('exports reject overflow instead of silently taking the first 10000 rows', async () => {
  const data = fixture();

  data.rows = Array(10001).fill(data.rows[0]);
  data.total = data.rows.length;

  await assert.rejects(
    encodeReport(data),
    /exceeds the row limit/
  );
});

test('invalid XML controls and oversized text fail without silently changing evidence', async () => {
  for (const name of [
    'bad\u0001name',
    'x'.repeat(32768),
    '\ud800',
  ]) {
    const data = fixture();
    data.rows[0].employee.fullName = name;

    await assert.rejects(
      encodeReport(data),
      /unsupported control|spreadsheet limits|invalid Unicode/
    );
  }
});

test('monthly exports serialize numeric metrics without combining approved and raw minutes', async () => {
  const data = fixture('monthly', 'csv');
  const before = JSON.stringify(data);

  const file = await encodeReport(data);
  const [headers, row] = readCSV(file.buffer.toString());

  assert.equal(
    row[headers.indexOf('rawWorkedMinutes')],
    '0'
  );

  assert.equal(
    row[headers.indexOf('approvedIntervalMinutes')],
    '570'
  );

  assert.equal(JSON.stringify(data), before);
});