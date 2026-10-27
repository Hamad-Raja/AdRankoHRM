"use strict";
const { z } = require('zod');
const { isCalendarDate, isTimeZone, isWorkWeek } = require('../utils/shift-rules');
const date = z.string().refine(isCalendarDate, 'Use a valid YYYY-MM-DD date.');
const policy = z.strictObject({
  timeZone: z.string().refine(isTimeZone, 'Use an explicit IANA timezone.').nullable(),
  workDays: z.array(z.number().int()).refine(isWorkWeek, 'Choose unique ISO weekdays 1–7.').nullable(),
  graceMinutes: z.number().int().min(0).max(599).nullable(),
  breakMinutes: z.number().int().min(0).max(599).nullable(),
  breakPaid: z.boolean().nullable(),
  holidayPolicy: z.enum(['NONE', 'DATES']).nullable(),
  holidayFrom: date.nullable(), holidayTo: date.nullable(), holidays: z.array(date).max(366),
}).superRefine((p, ctx) => {
  if ((p.breakMinutes === 0 || p.breakMinutes == null) && p.breakPaid != null) ctx.addIssue({code:'custom',path:['breakPaid'],message:'Use unconfirmed/not applicable when no break allowance is approved.'});
  if (p.holidayPolicy === 'DATES') {
    if (!p.holidayFrom || !p.holidayTo || p.holidayFrom > p.holidayTo || p.holidays.some(d => d < p.holidayFrom || d > p.holidayTo) || new Set(p.holidays).size !== p.holidays.length) ctx.addIssue({code:'custom',path:['holidays'],message:'Provide a confirmed coverage interval and unique holiday dates within it.'});
  } else if (p.holidayFrom || p.holidayTo || p.holidays.length) ctx.addIssue({code:'custom',path:['holidays'],message:'Holiday dates/coverage require the confirmed dated-calendar policy.'});
});
const settingsSchema = z.strictObject({ effectiveFrom: date, expectedPreviousId: z.uuid().nullable(), reason: z.string().trim().min(1).max(1000).regex(/^[^\u0000-\u001f\u007f]+$/u), policy });
module.exports = { settingsSchema };
