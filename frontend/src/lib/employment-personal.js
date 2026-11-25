import {readable} from '../components/payroll/payroll-format.js';
const unapproved=['MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL'];
const terminal=['REJECTED','WITHDRAWN','CANCELLED'];
const instant=value=>value?Date.parse(value):NaN;
export function canWithdrawPersonal(record,user){return record?.kind==='RESIGNATION'&&record.employee?.userId===user.id&&unapproved.includes(record.state);}
// Only compare scheduling against an authoritative response timestamp (or an explicitly supplied server time).
export function personalStage(record,now){
 const result=(label,tone,nextAction,next)=>({label,tone,nextAction,next});
 const rehire=record.kind==='REHIRE',exit=['RESIGNATION','TERMINATION'].includes(record.kind);
 if(terminal.includes(record.state))return result(readable(record.state),record.state==='REJECTED'?'negative':'neutral',record.state==='REJECTED'?'View decision':'View history','This request is closed. Review its history below.');
 if(rehire&&record.state==='COMPLETED')return result('Rehired','positive','View history','Rehire is processed. Login access and any manual hold are recorded separately.');
 if(exit&&(Number.isFinite(instant(record.employmentEndedAt))||record.state==='COMPLETED'))return result(record.kind==='RESIGNATION'?'Resigned':'Terminated','neutral','View history','Employment end is processed. Login access and clearance are recorded separately.');
 if(record.state==='COMPLETED')return result('Completed','neutral','View history','Review the recorded outcome and history.');
 if(record.state==='APPROVED'){
  const serverNow=Number.isFinite(instant(record.asOf))?instant(record.asOf):typeof now==='number'?now:instant(now);
  const effective=instant(rehire?record.accessCutoff:exit?record.employmentEndsAt:null);
  if(Number.isFinite(serverNow)&&Number.isFinite(effective))return effective>serverNow?result(rehire?'Approved \u00b7 Rehire scheduled':'Approved \u00b7 Exit scheduled','positive',rehire?'Await scheduled rehire':'Await scheduled exit',rehire?'Rehire is approved for the recorded joining time. Login access follows the explicit account decision.':'Exit arrangements are approved. Employment and login access follow their separate confirmed times.'):result(rehire?'Rehire processing pending':'Exit processing pending','pending','Review processing','The approved effective time has passed. Processing has not been recorded; review the saved result.');
  return result('Approved','positive','Review arrangements','Approval is recorded. Authoritative timing is unavailable; review the arrangements and current access separately.');
 }
 if(record.state==='ADMIN_APPROVAL')return result('Pending Admin approval','pending',rehire?'Admin: review rehire details':exit?'Admin: review exit details':'Admin: review case','Awaiting an Admin decision on the prepared arrangements.');
 if(record.state==='MANAGER_REVIEW')return result('Pending HR review','pending',rehire?'HR: prepare rehire details':exit?'HR: prepare exit details':'HR: review case','Awaiting HR review under the current preparation workflow.');
 if(record.state==='HR_PREPARATION'){
  const history=record.history||[],returned=record.returnedToHr===true||(record.returnedToHr===undefined&&history.findLastIndex(entry=>entry.action==='EMPLOYMENT_RETURNED_TO_HR')>history.findLastIndex(entry=>entry.action==='EMPLOYMENT_SENT_TO_ADMIN'));
  if(returned)return result('Returned to HR','pending',rehire?'HR: update rehire details':'HR: update and resend','Returned to HR for updates before another Admin decision.');
  if(exit&&(record.sendReady===true||record.sendReady===undefined&&record.submissionReadiness?.ready===true))return result('Ready to send to Admin','positive','HR: review and send','HR preparation passes the existing send-readiness check and has not been submitted.');
  return result('Pending HR review','pending',rehire?'HR: prepare rehire details':exit?'HR: prepare exit details':'HR: review case','Awaiting HR preparation and review.');
 }
 return result(readable(record.state)||'Not recorded','neutral','Review record','Review the recorded case state.');
}
export function loginAccessPresentation(record){
 if(record.accountStatus==='DISABLED')return {label:'Disabled'};
 if(record.accountStatus==='ACTIVE')return ['RESIGNATION','TERMINATION'].includes(record.kind)&&record.state==='APPROVED'&&record.accessMode==='SCHEDULED'&&Number.isFinite(instant(record.accessCutoff))&&!record.accessDisabledAt&&!record.manualAccessHold?{label:'Disable scheduled',cutoff:record.accessCutoff}:{label:'Active'};
 return {label:'Unknown'};
}

export function noticeHandlingLabel(value){return ({WORKED:'Notice served',WAIVED:'Notice waived',PAYMENT_IN_LIEU:'Payment in lieu - record only',OTHER:'Other arrangement'})[value]||readable(value);}
