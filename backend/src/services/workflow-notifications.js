"use strict";
const {emitEvent,reviewers}=require('./notification.service');
async function correctionSubmitted(tx,c,actorUserId){return emitEvent(tx,{eventKey:`correction:${c.id}:submitted`,kind:'CORRECTION_SUBMITTED',resourceId:c.id,recipientIds:await reviewers(tx,['ADMIN','HR']),actorUserId,title:'Attendance request awaiting review',message:'An attendance correction is ready for authorized review.',type:'ATTENDANCE',link:'/attendance'});}
async function correctionReviewed(tx,c,actorUserId){return emitEvent(tx,{eventKey:`correction:${c.id}:reviewed:${c.version}`,kind:'CORRECTION_REVIEWED',resourceId:c.id,recipientIds:[c.requestedByUserId],actorUserId,title:'Attendance request reviewed',message:'Your attendance correction has a review decision.',type:'ATTENDANCE',link:'/attendance'});}
async function payrollChanged(tx,p,action,actorUserId){
 let ids,kind,link,title,message;
 if(action==='hr-approve'){kind='PAYROLL_HR_APPROVED';ids=await reviewers(tx,['ADMIN'],[p.hrApprovedByUserId]);link=`/payroll?payrollId=${p.id}`;title='Payroll ready for final approval';message='A payroll record is ready for an eligible Admin review.';}
 else if(action==='return'){kind='PAYROLL_RETURNED';ids=await reviewers(tx,['ADMIN','HR']);ids=ids.filter(id=>id===p.createdByUserId);link=`/payroll?payrollId=${p.id}`;title='Payroll returned to draft';message='A payroll draft you prepared needs another review.';}
 else if(action==='approve'||action==='pay'){kind=action==='approve'?'PAYROLL_APPROVED':'PAYROLL_PAID';const emp=await tx.employee.findUnique({where:{id:p.employeeId},select:{userId:true}});ids=emp?.userId?[emp.userId]:[];link=`/my-payslips?payrollId=${p.id}`;title=action==='approve'?'Payslip available':'Payment recorded';message=action==='approve'?'Your approved payslip is available.':'A payment record is available with your payslip.';}
 else return;
 return emitEvent(tx,{eventKey:`payroll:${p.id}:${kind}:${p.version}`,kind,resourceId:p.id,recipientIds:ids,actorUserId,title,message,type:'PAYROLL',link});
}
module.exports={correctionSubmitted,correctionReviewed,payrollChanged};
