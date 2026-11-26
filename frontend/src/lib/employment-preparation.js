import {validDate} from './reports.js';

export function noticeEnd(start,days){
 return validDate(start)&&/^\d+$/.test(String(days))&&Number(days)<=365?new Date(Date.parse(start+'T00:00:00Z')+Number(days)*86400000).toISOString().slice(0,10):null;
}
export function noticeDaysLabel(days){return /^\d+$/.test(String(days))?`${Number(days)} ${Number(days)===1?'day':'days'}`:null;}

// Values and resolved times here are already in the form's Asia/Karachi input format.
export function preparationOverrides(values,resolved,edited={},saved=false){
 const suggestion=noticeEnd(values.noticeStartDate,values.noticeDays);
 return {
  ...edited,
  confirmedLastDate:!!(edited.confirmedLastDate||saved&&suggestion&&values.confirmedLastDate!==suggestion),
  finalShiftStart:!!(edited.finalShiftStart||saved&&values.finalShiftStart&&(!resolved||values.finalShiftStart!==resolved.start)),
  finalShiftEnd:!!(edited.finalShiftEnd||saved&&values.finalShiftEnd&&(!resolved||values.finalShiftEnd!==resolved.end)),
  employmentEndsAt:!!(edited.employmentEndsAt||values.employmentEndsAt&&values.employmentEndsAt!==values.finalShiftEnd),
  accessCutoff:!!(edited.accessCutoff||values.accessMode==='SCHEDULED'&&values.accessCutoff&&values.accessCutoff!==values.finalShiftEnd),
 };
}
export function changeNotice(values,name,value,overrides){
 const next={...values,[name]:value,confirmed:false},suggestion=noticeEnd(next.noticeStartDate,next.noticeDays);
 if(!overrides.confirmedLastDate)next.confirmedLastDate=suggestion||'';
 // Clear previous derived timestamps immediately, before the next resolver response.
 for(const field of ['finalShiftStart','finalShiftEnd','employmentEndsAt'])if(!overrides[field])next[field]='';
 if(!overrides.employmentEndsAt)next.employmentEndDate='';
 if(next.accessMode==='SCHEDULED'&&!overrides.accessCutoff)next.accessCutoff='';
 return next;
}
export function applyPreparationShift(values,resolved,overrides){
 const next={...values};
 if(!overrides.finalShiftStart)next.finalShiftStart=resolved?.start||'';
 if(!overrides.finalShiftEnd)next.finalShiftEnd=resolved?.end||'';
 if(!overrides.employmentEndsAt){next.employmentEndsAt=next.finalShiftEnd;next.employmentEndDate=next.finalShiftEnd.slice(0,10);}
 if(next.accessMode==='SCHEDULED'&&!overrides.accessCutoff)next.accessCutoff=next.finalShiftEnd;
 return next;
}
