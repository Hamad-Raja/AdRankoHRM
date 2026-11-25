"use strict";
const {z}=require('zod');
const {isCalendarDate,isTimeZone,isWorkWeek}=require('../utils/shift-rules');
const calendar=z.string().refine(isCalendarDate,'Use a valid YYYY-MM-DD shift-start date.');
const reason=z.string().trim().min(1).max(1000).regex(/^[^\u0000-\u001f\u007f]+$/u);
const confirmedPolicy={timeZone:'Asia/Karachi',workDays:[1,2,3,4,5],graceMinutes:30,breakTrackingEnabled:false,automaticBreakDeduction:false,holidayPolicy:'COMPANY_ANNOUNCED'};
const policySchema=z.strictObject({
  timeZone:z.string().refine(isTimeZone,'Use an explicit IANA timezone.'),
  workDays:z.array(z.number().int()).refine(isWorkWeek,'Choose unique ISO weekdays 1–7.'),
  graceMinutes:z.number().int().min(0).max(599),
  breakTrackingEnabled:z.literal(false),automaticBreakDeduction:z.literal(false),holidayPolicy:z.literal('COMPANY_ANNOUNCED')
});
const draftSchema=z.strictObject({expectedPreviousId:z.uuid().nullable(),reason,policy:policySchema});
const activationSchema=z.strictObject({draftId:z.uuid(),expectedPreviousId:z.uuid().nullable(),effectiveFrom:calendar,reason});
const discardSchema=z.strictObject({draftId:z.uuid(),expectedRevision:z.number().int().positive().max(2147483647)});
const holidaySchema=z.strictObject({holidayDate:calendar,expectedPreviousId:z.uuid().nullable(),reason});
const cancellationSchema=z.strictObject({expectedPreviousId:z.uuid(),reason});
module.exports={confirmedPolicy,policySchema,draftSchema,activationSchema,discardSchema,holidaySchema,cancellationSchema};
