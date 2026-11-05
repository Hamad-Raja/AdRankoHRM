"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/utils/shift-rules");

test("calendar validation rejects normalized invalid dates and year zero", () => {
  assert.equal(rules.isCalendarDate("2028-02-29"), true);
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-01", null, "2026-10-22T00:00:00Z"]) {
    assert.equal(rules.isCalendarDate(value), false, String(value));
  }
});
test("clock inputs require complete 24-hour times", () => {
  assert.equal(rules.timeMinutes("00:00"), 0);
  assert.equal(rules.timeMinutes("23:59"), 1439);
  for (const value of ["24:00", "12:60", "8:00", "08:00:00", 800]) assert.equal(rules.timeMinutes(value), null);
});
test("day shift has an explicit same-day end", () => {
  assert.equal(rules.shiftDuration("09:00", "17:00", false), 480);
});
test("night shift crosses midnight without losing its duration", () => {
  assert.equal(rules.shiftDuration("20:00", "05:00", true), 540);
  assert.equal(rules.shiftDuration("20:00", "00:00", true), 240);
});
test("zero length, accidental overnight and multi-day shifts are rejected", () => {
  for (const args of [["08:00", "08:00", false], ["08:00", "08:00", true], ["20:00", "05:00", false], ["08:00", "17:00", true]]) {
    assert.equal(rules.shiftDuration(...args), null);
  }
});
test("explicit IANA timezones are accepted; abbreviations and unknown zones are rejected", () => {
  assert.equal(rules.isTimeZone("Asia/Karachi"), true);
  assert.equal(rules.isTimeZone("Etc/UTC"), true);
  for (const value of ["Invalid/Timezone", "PST", "UTC", "", null]) assert.equal(rules.isTimeZone(value), false);
});
test("work week uses unique ISO weekdays", () => {
  assert.equal(rules.isWorkWeek([1, 2, 3, 4, 5]), true);
  assert.equal(rules.isWorkWeek([6, 7]), true);
  for (const value of [[], [0], [8], [1, 1], [1.5], ["1"], null]) assert.equal(rules.isWorkWeek(value), false);
});
const base = { startTime: "20:00", endTime: "05:00", endsNextDay: true, breakMinutes: 0, breakPaid: null, graceMinutes: 0 };
test("no break allowance requires an explicit null paid policy", () => {
  assert.deepEqual(rules.shiftIssues(base), []);
  assert.ok(rules.shiftIssues({ ...base, breakPaid: true }).some(issue => issue.field === "breakPaid"));
});
test("nonzero break allowance requires an explicit paid/unpaid choice", () => {
  assert.deepEqual(rules.shiftIssues({ ...base, breakMinutes: 60, breakPaid: false }), []);
  assert.deepEqual(rules.shiftIssues({ ...base, breakMinutes: 60, breakPaid: true }), []);
  assert.ok(rules.shiftIssues({ ...base, breakMinutes: 60 }).some(issue => issue.field === "breakPaid"));
});
test("break and grace cannot consume the entire shift", () => {
  assert.ok(rules.shiftIssues({ ...base, breakMinutes: 540, breakPaid: false }).some(issue => issue.field === "breakMinutes"));
  assert.ok(rules.shiftIssues({ ...base, graceMinutes: 540 }).some(issue => issue.field === "graceMinutes"));
});
test("inclusive assignment intervals detect collisions, including open ends", () => {
  assert.equal(rules.intervalsOverlap("2026-10-01", null, "2026-11-01", "2026-12-01"), true);
  assert.equal(rules.intervalsOverlap("2026-10-01", "2026-10-22", "2026-10-22", null), true);
  assert.equal(rules.intervalsOverlap("2026-10-01", "2026-10-21", "2026-10-22", null), false);
});
test("replacement closure handles year and leap-day boundaries", () => {
  assert.equal(rules.dateString(rules.previousDate("2026-01-01")), "2025-12-31");
  assert.equal(rules.dateString(rules.previousDate("2028-03-01")), "2028-02-29");
  assert.equal(rules.dateString(null), null);
});