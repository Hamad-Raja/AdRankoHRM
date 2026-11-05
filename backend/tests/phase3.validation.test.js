"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createShiftSchema, assignShiftSchema } = require("../src/validation/shift.validation");
const base = {
  name: "Night v1", timeZone: "Asia/Karachi", startTime: "20:00", endTime: "05:00",
  endsNextDay: true, workDays: [1, 2, 3, 4, 5], breakMinutes: 60,
  breakPaid: false, graceMinutes: 10, reason: "Approved test schedule",
};
test("shift schema requires explicit policy choices and rejects unknown fields", () => {
  assert.equal(createShiftSchema.safeParse(base).success, true);
  for (const key of ["timeZone", "endsNextDay", "workDays", "breakMinutes", "breakPaid", "graceMinutes", "reason"]) {
    const input = { ...base }; delete input[key];
    assert.equal(createShiftSchema.safeParse(input).success, false, key);
  }
  assert.equal(createShiftSchema.safeParse({ ...base, actorUserId: "invented" }).success, false);
});
test("shift schema rejects invalid workdays, limits and mismatched overnight flag", () => {
  for (const patch of [{ workDays: [1, 1] }, { breakMinutes: -1 }, { graceMinutes: 0.5 }, { endsNextDay: false }, { breakMinutes: 540 }, { breakMinutes: 60, breakPaid: null }, { timeZone: "Invalid/Zone" }]) {
    assert.equal(createShiftSchema.safeParse({ ...base, ...patch }).success, false, JSON.stringify(patch));
  }
});
const assignment = {
  shiftId: "64e94ff0-ab1e-4ad6-aa16-bc158ac21d45",
  employmentEpisodeId: "675bd7dd-d269-4cad-a661-8f8d127384d5",
  effectiveFrom: "2026-10-22", reason: "Approved test assignment",
};
test("assignment schema supports an open interval and explicit replacement", () => {
  assert.equal(assignShiftSchema.safeParse(assignment).success, true);
  assert.equal(assignShiftSchema.safeParse({ ...assignment, replacesAssignmentId: assignment.shiftId }).success, true);
  assert.equal(assignShiftSchema.safeParse({ ...assignment, effectiveTo: "2026-10-22" }).success, true);
});
test("assignment schema rejects invalid dates, missing episode and injected ownership", () => {
  for (const patch of [{ effectiveFrom: "2026-02-30" }, { effectiveTo: "2026-10-21" }, { employmentEpisodeId: undefined }, { shiftId: "1" }, { employeeId: assignment.shiftId }]) {
    assert.equal(assignShiftSchema.safeParse({ ...assignment, ...patch }).success, false);
  }
});