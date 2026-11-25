import {readable} from '../components/payroll/payroll-format.js';
const unapproved=['MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL'];
const terminal=['REJECTED','WITHDRAWN','CANCELLED'];
const instant=value=>value?Date.parse(value):NaN;
export function canWithdrawPersonal(record,user){return record?.kind==='RESIGNATION'&&record.employee?.userId===user.id&&unapproved.includes(record.state);}
export function personalStage(record,now=Date.now()){
 if(terminal.includes(record.state))return {label:readable(record.state),tone:record.state==='REJECTED'?'negative':'neutral',next:'This request is closed. Review its history below.'};
 if(record.kind==='REHIRE'){
  if(record.state==='COMPLETED')return {label:'Rehire completed',tone:'positive',next:'Rehire processing is recorded. Login access follows the explicit account decision and any manual hold.'};
  if(record.state==='APPROVED')return {label:Number.isFinite(instant(record.accessCutoff))?(instant(record.accessCutoff)>now?'Approved · Rehire scheduled':'Approved · Awaiting processing'):'Approved · Timing unavailable',tone:'positive',next:'Rehire is approved. Joining, salary and account access follow the recorded decisions; no access restoration is inferred.'};
  return {label:record.state==='ADMIN_APPROVAL'?'Awaiting Admin approval':'Pending HR review',tone:'pending',next:'Review the prepared joining, salary and account decisions before approval.'};
 }
 if(record.state==='COMPLETED'||record.state==='APPROVED'&&record.employmentEndedAt)return {label:'Employment ended',tone:'neutral',next:'Employment end is recorded. Login access and clearance are tracked separately.'};
 if(record.state==='APPROVED'){
  const noticeStart=instant(record.noticeStartDate?record.noticeStartDate+'T00:00:00+05:00':null),noticeEnd=instant(record.finalShiftEnd);
  const inNotice=record.noticeDays>0&&record.noticeStartDate&&record.confirmedLastDate&&record.noticeSuggestedEnd===record.confirmedLastDate&&instant(record.approvedAt)<=now&&noticeStart<=now&&now<noticeEnd;
  if(Number.isFinite(instant(record.employmentEndsAt))&&instant(record.employmentEndsAt)<=now)return {label:'Approved · Awaiting processing',tone:'positive',next:'The approved employment-end time has passed. Completion is awaiting server confirmation; check the current login-access status separately.'};
  if(inNotice||Number.isFinite(instant(record.employmentEndsAt))&&instant(record.employmentEndsAt)>now)return {label:inNotice?'Approved · Notice period':'Approved · Exit scheduled',tone:'positive',next:'Admin approved these arrangements. Employment and login access follow their separate confirmed times.'};
  return {label:'Approved · Timing unavailable',tone:'positive',next:'Approval is recorded, but confirmed employment-end timing is unavailable. Reload or contact HR; login access is shown separately.'};
 }
 if(record.state==='ADMIN_APPROVAL')return {label:'Awaiting Admin approval',tone:'pending',next:'Admin reviews the prepared arrangements. Proposed dates do not yet end employment or disable login access.'};
 const returned=record.history?.some(entry=>entry.action==='EMPLOYMENT_RETURNED_TO_HR');
 return {label:returned?'Under HR review':'Pending HR review',tone:'pending',next:returned?'The request was returned to HR for review before another Admin decision.':'HR reviews your notice and final shift. Prepared arrangements are then sent to Admin for approval.'};
}
