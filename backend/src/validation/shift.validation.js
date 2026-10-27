"use strict";

const { z } = require("zod");
const rules = require("../utils/shift-rules");

const text = max => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/u);
const calendar = z.string().refine(rules.isCalendarDate, "Use a valid YYYY-MM-DD date.");
const clock = z.string().refine(value => rules.timeMinutes(value) !== null, "Use HH:mm in 24-hour format.");

const createShiftSchema = z.strictObject({
  name: text(120),
  timeZone: z.string().max(80).refine(rules.isTimeZone, "Use an explicit IANA timezone such as Asia/Karachi or Etc/UTC."),
  startTime: clock,
  endTime: clock,
  endsNextDay: z.boolean(),
  // ISO weekdays: Monday=1 ... Sunday=7. No silent schedule defaults.
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .refine(rules.isWorkWeek, "Select unique weekdays from Monday=1 through Sunday=7."),
  breakMinutes: z.number().int().min(0).max(1439),
  breakPaid: z.boolean().nullable(),
  graceMinutes: z.number().int().min(0).max(1439),
  reason: text(1000),
}).superRefine((data, context) => {
  for (const issue of rules.shiftIssues(data)) {
    context.addIssue({ code: "custom", path: [issue.field], message: issue.message });
  }
});

const assignShiftSchema = z.strictObject({
  shiftId: z.uuid(),
  employmentEpisodeId: z.uuid(),
  effectiveFrom: calendar,
  effectiveTo: calendar.nullable().optional(),
  // Explicitly name the existing open assignment to close. Omission never closes it.
  replacesAssignmentId: z.uuid().optional(),
  reason: text(1000),
}).refine(data => !data.effectiveTo || data.effectiveTo >= data.effectiveFrom, {
  path: ["effectiveTo"], message: "End date cannot be before start date.",
});

const archiveShiftSchema = z.strictObject({ reason: text(1000) });
const idParamsSchema = z.strictObject({ shiftId: z.uuid() });
const employeeParamsSchema = z.strictObject({ employeeId: z.uuid() });

module.exports = {
  createShiftSchema, assignShiftSchema, archiveShiftSchema,
  idParamsSchema, employeeParamsSchema,
};