// Presentation only. Server classifications, duty dates and action flags remain authoritative.
export function approvedScheduleMessage(shift, settings) {
 const future = shift?.state === 'SCHEDULED_ACTIVATION' || (!settings?.activeVersion && settings?.draftStatus === 'SCHEDULED_ACTIVATION');
 if (!future) return null;
 const version = settings?.versions?.filter(v => v.missing?.length === 0).sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
 const time = settings?.duty?.startTime;
 if (version?.effectiveFrom && Number.isFinite(Date.parse(version.effectiveFrom+'T12:00:00Z')) && version.policy?.timeZone && /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
  const date = new Intl.DateTimeFormat('en-GB', {timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(new Date(version.effectiveFrom + 'T12:00:00Z'));
  const [hour,minute] = time.split(':').map(Number);
  return {title:`Schedule approved — starts ${date}, ${hour % 12 || 12}:${String(minute).padStart(2,'0')} ${hour < 12 ? 'am' : 'pm'}, ${version.policy.timeZone}.`,detail:'No further setup needed.'};
 }
 // My Shift confirms approval but does not expose the published activation instant.
 // Its next assigned duty can be later than policy activation and is not a substitute.
 return {title:'Schedule approved — future activation.',detail:'No further setup needed. The published start time is unavailable in this schedule response.'};
}
export function attendanceCalendarLabel(reports) {
 const list = Array.isArray(reports) ? reports : [reports];
 const classes = list.flatMap(report => Object.entries(report?.totals?.classifications || {}).filter(([,count]) => count > 0).map(([name]) => name));
 return classes.length && classes.every(name => name === 'WEEKLY_OFF') ? 'Weekly off'
  : classes.length && classes.every(name => name === 'HOLIDAY') ? 'Company holiday' : null;
}
export function attendancePeriodMessage({state, reports = [], settings, shift} = {}) {
 const list = Array.isArray(reports) ? reports : [reports];
 const review = list.some(r => (r?.totals?.classifications?.LEGACY_ASSIGNMENT_REVIEW || 0) > 0 || r?.rows?.some(row => row.scheduleState === 'LEGACY_ASSIGNMENT_REVIEW' || row.classification === 'LEGACY_ASSIGNMENT_REVIEW'));
 if (review || state === 'REVIEW_REQUIRED') return {title:'Attendance needs review',detail:'Conflicting or incomplete duties need review before rates can be shown.',setupRequired:false};
 if (state === 'UNAVAILABLE') return {title:'Attendance data unavailable',detail:'The report could not be verified. Refresh to try again.',setupRequired:false};
 const future = approvedScheduleMessage(shift, settings);
 if (future) return {...future,detail:future.detail + ' Attendance data unavailable for this period: duties precede policy coverage.',setupRequired:false};
 const incomplete = settings?.versions?.find(v => v.id === settings.activeVersion?.id)?.missing?.length > 0
  || settings?.versions?.length > 0 && settings.versions.every(v => v.missing?.length > 0)
  || shift?.missing?.some(key => ['officeSchedule','timeZone','workDays','graceMinutes','holidayPolicy','breakMinutes','breakPaid','approvedEffectiveDate'].includes(key));
 if (incomplete || shift?.state === 'PENDING_ACTIVATION') return {title:'Schedule setup required',detail:'A required policy setting or approved effective date is missing.',setupRequired:true};
 const published = settings?.versions?.some(v => v.missing?.length === 0) || list.some(r => ['EFFECTIVE_POLICY_PRESENT','FUTURE_POLICY_ONLY'].includes(r?.meta?.currentPolicyState));
 if (published) return {title:'Attendance data unavailable for this period',detail:'The selected period includes duties without complete published policy coverage. This does not mean the current schedule needs configuration.',setupRequired:false};
 if (list.some(r => r?.meta?.currentPolicyState === 'NO_ACTIVATED_POLICY') || ['SETUP_REQUIRED','PENDING_ACTIVATION'].includes(shift?.state) || settings?.versions?.length === 0 || settings?.versions?.some(v => v.missing?.length > 0)) return {title:'Schedule setup required',detail:'No complete published policy covers these duties. An approved effective schedule is required.',setupRequired:true};
 return {title:'Schedule status unavailable',detail:'Published policy coverage could not be verified. Refresh schedule status.',setupRequired:false};
}
export function dutyPresentation(data,shift,settings){
 const record=data?.attendance;
 const assigned=shift?.current||shift?.next;
 const schedule=record?{date:record.shiftDate,startsAt:record.scheduledStart,endsAt:record.scheduledEnd,timeZone:record.scheduleTimeZone}:data?.schedule?{date:data.schedule.shiftDate,...data.schedule}:assigned?{date:assigned.scheduleDate,...assigned}:null;
 const reason=data?.clockInBlockReason;
 const future=approvedScheduleMessage(shift,settings);
 const off=reason==='WEEKLY_OFF'||data?.state==='WEEKLY_OFF',holiday=reason==='HOLIDAY'||data?.state==='HOLIDAY';
 const setup=attendancePeriodMessage({state:'SETUP_REQUIRED',shift,settings});
 const explanation=shift?.state==='LEGACY_ASSIGNMENT_REVIEW'?'Individual shift assignment requires review.':shift?.state==='NOT_ELIGIBLE'?'No eligible employment for this duty date.':({BEFORE_DUTY_START:'Upcoming duty. Clock In is not available before the scheduled start.',AFTER_DUTY_END:'The duty window ended. Open attendance to request a correction.',ALREADY_CLOCKED:'Attendance is already recorded for this duty date.',OPEN_SESSION_EXISTS:'An open attendance record must be checked out first.',WEEKLY_OFF:'This duty date is a weekly off.',HOLIDAY:'This duty date is an approved company holiday.',NOT_ELIGIBLE:'No eligible employment for this duty date.',LEGACY_ASSIGNMENT:'Individual shift assignment requires review.',NOT_SCHEDULED:'No scheduled duty is available.',APPROVED_PAID_LEAVE:'Approved full-day paid leave. No attendance punch is required.',APPROVED_EXCEPTION:'Approved attendance exception. Original punches were not created.'})[reason]||({PROFILE_LINK_REQUIRED:'No employee profile is linked. Contact Admin to link your profile.',SETUP_REQUIRED:future?.detail||setup.detail,PAID_LEAVE:'Approved full-day paid leave. No attendance punch is required.'})[data?.state]||(off?'This duty date is a weekly off.':holiday?'This duty date is an approved company holiday.':'');
 const actual=record?.status==='COMPLETED'?'Completed':record?.status==='CORRECTED'?'Corrected attendance':['OPEN','MISSING_CHECKOUT'].includes(record?.status)?(record.isMissingCheckout||record.status==='MISSING_CHECKOUT'?'Checked In - missing checkout':'Checked In'):data?.canClockOut?'Open attendance - checkout available':data?.approvedException?'Approved exception':data?.state==='PROFILE_LINK_REQUIRED'?'Profile link required':reason==='LEGACY_ASSIGNMENT'||shift?.state==='LEGACY_ASSIGNMENT_REVIEW'?'Attendance review required':reason==='NOT_ELIGIBLE'||shift?.state==='NOT_ELIGIBLE'?'Not eligible':off?'Weekly off':holiday?'Company holiday':data?.state==='PAID_LEAVE'?'Paid leave':data?.state==='SETUP_REQUIRED'?(future?.title||setup.title):reason==='BEFORE_DUTY_START'?'Upcoming duty':data?.canClockIn?'Not checked in':'Not checked in';
 const scheduleLabel=record?'Recorded duty schedule':off?'Weekly off - duty window':holiday?'Holiday - duty window':data?.state==='PAID_LEAVE'?'Paid leave - duty window':data?.state==='SETUP_REQUIRED'?'Next assigned duty':reason==='NOT_ELIGIBLE'?'Duty window (not eligible)':reason==='LEGACY_ASSIGNMENT'?'Duty window - review required':'Scheduled';
 const nextDuty=(off||holiday)&&shift?.next?.startsAt?`Next assigned duty: ${attendanceInstant(shift.next.startsAt,shift.next.timeZone)} (${shift.next.timeZone}).`:null;
 return {schedule,actual,explanation:data?.canClockOut?'Existing open attendance can still be checked out. '+(record?'Its recorded duty schedule is preserved.':'Refresh to load its recorded details.'):explanation,record,scheduleLabel,nextDuty};
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
