// Labels only. Action authorization always comes from the attendance API booleans.
export function dutyPresentation(data,shift){
 const record=data?.attendance;
 const assigned=shift?.current||shift?.next;
 const schedule=record?{date:record.shiftDate,startsAt:record.scheduledStart,endsAt:record.scheduledEnd,timeZone:record.scheduleTimeZone}:data?.schedule?{date:data.schedule.shiftDate,...data.schedule}:assigned?{date:assigned.scheduleDate,...assigned}:null;
 const reason=data?.clockInBlockReason;
 const explanation=({BEFORE_DUTY_START:'Upcoming duty. Clock In is not available before the scheduled start.',AFTER_DUTY_END:'The duty window ended. Open attendance to request a correction.',ALREADY_CLOCKED:'Attendance is already recorded for this duty date.',OPEN_SESSION_EXISTS:'An open attendance record must be checked out first.',WEEKLY_OFF:'This duty date is a weekly off.',HOLIDAY:'This duty date is an approved company holiday.',NOT_ELIGIBLE:'No eligible employment for this duty date.',LEGACY_ASSIGNMENT:'Individual shift assignment requires review.',NOT_SCHEDULED:'No scheduled duty is available.',APPROVED_PAID_LEAVE:'Approved full-day paid leave. No attendance punch is required.',APPROVED_EXCEPTION:'Approved attendance exception. Original punches were not created.'})[reason]||({PROFILE_LINK_REQUIRED:'No employee profile is linked. Contact Admin to link your profile.',SETUP_REQUIRED:'Schedule setup required. No complete approved schedule is effective. Existing open attendance can still be checked out.',WEEKLY_OFF:'This duty date is a weekly off.',HOLIDAY:'This duty date is an approved company holiday.',PAID_LEAVE:'Approved full-day paid leave. No attendance punch is required.'})[data?.state]||'';
 const actual=record?.status==='COMPLETED'?'Completed':record?.status==='CORRECTED'?'Corrected attendance':['OPEN','MISSING_CHECKOUT'].includes(record?.status)?(record.isMissingCheckout||record.status==='MISSING_CHECKOUT'?'Checked In - missing checkout':'Checked In'):data?.approvedException?'Approved exception':data?.state==='PROFILE_LINK_REQUIRED'?'Profile link required':data?.state==='SETUP_REQUIRED'?'Schedule setup required':data?.canClockIn?'Not checked in':reason==='LEGACY_ASSIGNMENT'?'Attendance review required':reason==='NOT_ELIGIBLE'?'Not eligible':data?.state==='WEEKLY_OFF'?'Weekly off':data?.state==='HOLIDAY'?'Company holiday':data?.state==='PAID_LEAVE'?'Paid leave':'Not checked in';
 const scheduleLabel=record?'Recorded duty schedule':data?.state==='WEEKLY_OFF'?'Weekly off - duty window':data?.state==='HOLIDAY'?'Holiday - duty window':data?.state==='PAID_LEAVE'?'Paid leave - duty window':data?.state==='SETUP_REQUIRED'?'Upcoming schedule (not active)':reason==='NOT_ELIGIBLE'?'Duty window (not eligible)':reason==='LEGACY_ASSIGNMENT'?'Duty window - review required':'Scheduled';
 return {schedule,actual,explanation,record,scheduleLabel};
}
export function attendanceInstant(value,timeZone='Asia/Karachi'){
 if(!value||!Number.isFinite(Date.parse(value)))return 'Not recorded';
 return new Intl.DateTimeFormat('en-GB',{timeZone,day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));
}
export function dutyTime(value,timeZone='Asia/Karachi'){
 if(!value||!Number.isFinite(Date.parse(value)))return 'Unavailable';
 return new Intl.DateTimeFormat('en-GB',{timeZone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));
}
export function nextDay(schedule){return !!schedule?.startsAt&&!!schedule?.endsAt&&new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone}).format(new Date(schedule.startsAt))!==new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone}).format(new Date(schedule.endsAt));}
