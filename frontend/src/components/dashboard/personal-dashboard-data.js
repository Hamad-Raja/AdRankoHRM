import {validDate} from '../../lib/reports.js';
const present=new Set(['OPEN','COMPLETED','CORRECTED','MISSING_CHECKOUT']);
export function teamSnapshot(report,personal){
 if(!personal||!['LINKED','PROFILE_LINK_REQUIRED'].includes(personal.state))throw new Error('Own profile scope is unavailable.');
 if(report.meta.access!=='DATED_TEAM_AND_OWN')throw new Error('Dated team scope could not be verified.');
 const date=report.meta.period.dateFrom;
 if(date!==report.meta.period.dateTo||!validDate(date)||report.rows.length!==report.total)throw new Error('The complete daily report is required.');
 const seen=new Set(),classes={};
 for(const row of report.rows){if(row.shiftDate!==date||seen.has(row.employee.id))throw new Error('Team report changed. Refresh to reconcile.');seen.add(row.employee.id);classes[row.classification]=(classes[row.classification]||0)+1;}
 const normalized=value=>JSON.stringify(Object.entries(value).filter(([,count])=>count).sort(([a],[b])=>a.localeCompare(b)));
 if(normalized(classes)!==normalized(report.totals.classifications))throw new Error('Team report changed. Refresh to reconcile.');
 const ownCode=personal.state==='LINKED'?personal.employee.employeeCode:null;
 if(ownCode&&report.rows.filter(row=>row.employee.employeeCode===ownCode).length!==1){const error=new Error('Own profile changed. Refresh the overview to reconcile team scope.');error.code='OWN_SCOPE_CHANGED';throw error;}
 const rows=report.rows.filter(row=>row.employee.employeeCode!==ownCode);
 if(rows.some(row=>!row.organization?.team?.id))throw new Error('Dated team assignment could not be verified.');
 const setup=report.meta.currentPolicyState!=='EFFECTIVE_POLICY_PRESENT'||rows.some(row=>['SETUP_REQUIRED','LEGACY_ASSIGNMENT_REVIEW'].includes(row.scheduleState)||['SETUP_REQUIRED','LEGACY_ASSIGNMENT_REVIEW'].includes(row.classification));
 const review=rows.some(row=>row.leaveConflict);
 return {date,policyMeta:report.meta,rows,total:rows.length,state:setup?'SETUP_REQUIRED':review?'REVIEW_REQUIRED':rows.length?'READY':'EMPTY',present:rows.filter(row=>present.has(row.classification)).length,absent:rows.filter(row=>row.classification==='NO_CLOCK_IN').length,leave:rows.filter(row=>row.classification==='PAID_LEAVE').length,pending:rows.filter(row=>row.classification==='NOT_YET_ENDED').length,exceptions:rows.filter(row=>row.classification==='APPROVED_EXCEPTION').length,eligible:rows.filter(row=>row.eligibleDuty).length,excluded:rows.filter(row=>!row.eligibleDuty).length};
}
export function teamStatus(row){const labels={OPEN:'Present',COMPLETED:'Present',CORRECTED:'Present - corrected',MISSING_CHECKOUT:'Present - missing checkout',NO_CLOCK_IN:'Absent',PAID_LEAVE:'On leave',NOT_YET_ENDED:'Pending',APPROVED_EXCEPTION:'Approved exception',WEEKLY_OFF:'Weekly off',HOLIDAY:'Holiday',NOT_ELIGIBLE:'Not eligible',SETUP_REQUIRED:'Policy coverage unavailable',LEGACY_ASSIGNMENT_REVIEW:'Assignment review'};return (labels[row.classification]||'Needs review')+(row.leaveConflict?' - leave conflict':row.actual?.isLate?' - late':'');}
export function monthLabel(month){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00Z'));}
export function initials(name){return name.trim().split(/\s+/).filter(Boolean).map(word=>Array.from(word)[0]).filter(Boolean).filter((_,index,all)=>index===0||index===all.length-1).join('').toLocaleUpperCase()||'OH';}
export function validPersonal(data){return ['LINKED','PROFILE_LINK_REQUIRED'].includes(data?.state)&&validDate(data.dutyDate)&&Number.isFinite(Date.parse(data.asOf))&&(data.state==='PROFILE_LINK_REQUIRED'||typeof data.employee?.employeeCode==='string'&&data.employee.employeeCode.trim().length>0&&/^\d{4}-(0[1-9]|1[0-2])$/.test(data.leave?.month)&&['allowance','reserved','used','available'].every(key=>Number.isSafeInteger(data.leave[key])&&data.leave[key]>=0));}
export function validPayslip(data){return ['AVAILABLE','EMPTY','PROFILE_LINK_REQUIRED'].includes(data?.state)&&(data.state!=='AVAILABLE'?data.latest===null:/^\d{4}-(0[1-9]|1[0-2])$/.test(data.latest?.month)&&['APPROVED','PAID'].includes(data.latest.status)&&/^\/my-payslips\?payrollId=[0-9a-f-]{36}$/i.test(data.latest.link));}
