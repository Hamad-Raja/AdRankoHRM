import test from "node:test";
import assert from "node:assert/strict";

import {
  karachiMonth,
  monthDates,
  initialReportFilters,
  reportQuery,
  exportQuery,
  validateReport,
  validateReportBlob,
  reportFilename,
  formatReportTime,
  formatReportMinutes,
} from "../src/lib/reports.js";

test("month follows Karachi across the UTC boundary", () => {
  assert.equal(
    karachiMonth(new Date("2026-10-31T20:00:00Z")),
    "2026-11"
  );
});

test("month dates handle leap years and invalid months", () => {
  assert.equal(monthDates("2024-02").dateTo, "2024-02-29");
  assert.equal(monthDates("2100-02").dateTo, "2100-02-28");
  assert.throws(() => monthDates("0000-01"));
  assert.throws(() => monthDates("2026-13"));
});

test("date ranges reject invalid dates, reversed and oversized ranges", () => {
  const filters = {
    ...initialReportFilters("2026-10"),
    periodMode: "range",
  };

  for (const [dateFrom, dateTo] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-10-02", "2026-10-01"],
    ["2024-01-01", "2025-01-01"],
  ]) {
    assert.throws(() =>
      reportQuery({ ...filters, dateFrom, dateTo }, "attendance")
    );
  }

  const query = new URLSearchParams(
    reportQuery(
      {
        ...filters,
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      },
      "attendance"
    )
  );

  assert.equal(query.get("dateTo"), "2024-12-31");
});

test("queries omit caller role and clock overrides", () => {
  const query = new URLSearchParams(
    reportQuery(
      {
        ...initialReportFilters("2026-10"),
        search: "  Ali  ",
        role: "ADMIN",
        now: "2099-01-01",
      },
      "monthly",
      2
    )
  );

  assert.equal(query.get("search"), "Ali");
  assert.equal(query.get("page"), "2");
  assert.equal(query.has("role"), false);
  assert.equal(query.has("now"), false);
  assert.equal(query.has("dateFrom"), false);
});

test("exports retain filters and remove pagination", () => {
  const source =
    "month=2026-10&employeeId=abc&search=Ali&page=3&pageSize=20";

  const query = new URLSearchParams(exportQuery(source, "xlsx"));

  assert.equal(query.has("page"), false);
  assert.equal(query.has("pageSize"), false);
  assert.equal(query.get("employeeId"), "abc");
  assert.equal(query.get("search"), "Ali");
  assert.equal(query.get("month"), "2026-10");
  assert.equal(query.get("format"), "xlsx");
  assert.throws(() => exportQuery(source, "pdf"));
});

test("attendance and correction statuses stay separate", () => {
  const filters = initialReportFilters("2026-10");

  assert.throws(() =>
    reportQuery({ ...filters, status: "PENDING" }, "attendance")
  );

  assert.throws(() =>
    reportQuery({ ...filters, status: "LATE" }, "corrections")
  );

  assert.ok(
    reportQuery(
      { ...filters, status: "PENDING" },
      "corrections"
    ).includes("status=PENDING")
  );
});

test("invalid identifiers and unsafe search inputs are rejected", () => {
  const filters = initialReportFilters("2026-10");

  for (const changes of [
    { employeeId: "wrong" },
    { teamId: "wrong" },
    { search: "a\nb" },
    { search: "a".repeat(121) },
  ]) {
    assert.throws(() =>
      reportQuery({ ...filters, ...changes }, "attendance")
    );
  }
});

test("formatting distinguishes unknown duration from zero", () => {
  assert.equal(formatReportMinutes(null), "—");
  assert.equal(formatReportMinutes(undefined), "—");
  assert.equal(formatReportMinutes(0), "0h 00m");
  assert.equal(formatReportMinutes(570), "9h 30m");

  assert.ok(
    formatReportTime("2026-10-23T14:30:00.001Z").includes(
      "19:30:00.001"
    )
  );

  assert.equal(formatReportTime(null), "—");
});

function payload() {
  return {
    success: true,
    data: {
      meta: {
        report: "monthly",
        timeZone: "Asia/Karachi",
        access: "OWN",
        currentPolicyState: "NO_ACTIVATED_POLICY",
        generatedAt: "2026-10-28T00:00:00Z",
        period: {
          dateFrom: "2026-10-01",
          dateTo: "2026-10-31",
        },
      },
      rows: [],
      total: 0,
      totals: {},
      page: 1,
      pageSize: 20,
      totalPages: 0,
    },
  };
}

test("response validation accepts empty reports and rejects inconsistencies", () => {
  assert.equal(validateReport(payload(), "monthly").total, 0);

  assert.throws(() =>
    validateReport({ success: true, data: {} }, "monthly")
  );

  const badCounts = payload();
  badCounts.data.totalPages = 2;
  assert.throws(() => validateReport(badCounts, "monthly"));

  const reversed = payload();
  reversed.data.meta.period.dateFrom = "2026-11-01";
  assert.throws(() => validateReport(reversed, "monthly"));

  const missingPolicy = payload();
  delete missingPolicy.data.meta.currentPolicyState;
  assert.throws(() => validateReport(missingPolicy, "monthly"));
});

test("download filenames reject path-like values", () => {
  assert.equal(
    reportFilename("monthly", payload().data.meta, "csv"),
    "officehr-monthly-2026-10-01-to-2026-10-31.csv"
  );

  assert.throws(() =>
    reportFilename("../../other", payload().data.meta, "csv")
  );

  assert.throws(() =>
    reportFilename(
      "monthly",
      {
        period: {
          dateFrom: "../../x",
          dateTo: "2026-10-31",
        },
      },
      "csv"
    )
  );
});

test("downloads reject unexpected content and accept expected signatures", async () => {
  for (const blob of [
    new Blob(["<html>error</html>"], { type: "text/html" }),
    new Blob(["{}"], { type: "application/json" }),
    new Blob([], { type: "text/csv" }),
    new Blob(["invalid"], { type: "text/csv" }),
  ]) {
    await assert.rejects(validateReportBlob(blob, "csv"));
  }

  const csv = new Blob(
    [
      new Uint8Array([239, 187, 191]),
      '"EmployeeCode"\r\n',
    ],
    { type: "text/csv;charset=utf-8" }
  );

  assert.equal(await validateReportBlob(csv, "csv"), csv);

  const xlsx = new Blob(
    [new Uint8Array([80, 75, 3, 4])],
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
  );

  assert.equal(await validateReportBlob(xlsx, "xlsx"), xlsx);
});