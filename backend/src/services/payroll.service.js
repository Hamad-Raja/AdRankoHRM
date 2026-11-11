"use strict";
const prisma=require('../config/prisma');
const {actor,fail}=require('./organization.service');
const ApiError=require('../utils/ApiError');
const {PayrollInputError,payrollPeriod,moneyFromMinor,moneyToMinor}=require('../utils/payroll-values');
const {calculatePayrollPreview}=require('../utils/payroll-calculator');
const date=month=>new Date(`${month}-01T00:00:00.000Z`);
const monthOf=value=>value.toISOString().slice(0,7);
const management=user=>['ADMIN','HR'].includes(user.role);
async function transaction(work){
 try{return await prisma.$transaction(work,{isolationLevel:'Serializable',timeout:15000});}
 catch(e){
  if(e instanceof PayrollInputError)throw new ApiError(400,e.message,e.code,{field:e.field});
  if(['P2002','P2004','P2025','P2034'].includes(e.code)||e.meta?.code==='23514'||JSON.stringify(e.meta||{}).includes('23514'))fail(409,'Payroll changed or conflicts with its workflow. Reload before trying again.','PAYROLL_CONFLICT');
  throw e;
 }
}
async function event(tx,userId,action,targetId,metadata){await tx.auditLog.create({data:{actorUserId:userId,action,success:true,targetType:'Payroll',targetId,metadata}});}
async function employee(tx,id){const emp=await tx.employee.findUnique({where:{id},select:{id:true,fullName:true,employeeCode:true}});if(!emp)fail(404,'Employee not found.','NOT_FOUND');return emp;}
async function lock(tx,id){await tx.$queryRaw`SELECT id FROM employees WHERE id=${id}::uuid FOR UPDATE`;}
async function applicable(tx,employeeId,month){const salary=await tx.employeeSalaryVersion.findFirst({where:{employeeId,effectiveMonth:{lte:date(month)}},orderBy:[{effectiveMonth:'desc'},{revision:'desc'}]});if(!salary)fail(409,'Set an effective salary for this payroll month first.','SALARY_REQUIRED');return salary;}
const salaryView=s=>({id:s.id,employeeId:s.employeeId,effectiveMonth:monthOf(s.effectiveMonth),revision:s.revision,previousId:s.previousId,monthlyBasic:s.monthlyBasic.toFixed(2),currency:s.currency,reason:s.reason,actorUserId:s.actorUserId,actorName:s.actor?.displayName||null,createdAt:s.createdAt.toISOString()});
async function organizationAt(tx,employeeId,asOf){
 const assignment=await tx.organizationAssignment.findFirst({where:{employeeId,effectiveFrom:{lte:asOf},OR:[{effectiveTo:null},{effectiveTo:{gte:asOf}}]},orderBy:[{effectiveFrom:'desc'},{id:'desc'}],select:{department:{select:{name:true}},designation:{select:{name:true}},team:{select:{department:{select:{name:true}}}}}});
 return assignment?{department:assignment.department?.name||assignment.team?.department?.name||null,designation:assignment.designation?.name||null,asOf:asOf.toISOString().slice(0,10)}:null;
}
async function salaryHistory(userId,employeeId){return transaction(async tx=>{
 await actor(tx,userId);const emp=await employee(tx,employeeId);
 const versions=await tx.employeeSalaryVersion.findMany({where:{employeeId},include:{actor:{select:{displayName:true}}},orderBy:[{effectiveMonth:'desc'},{revision:'desc'}]});
 const today=require('../utils/office-schedule').localParts(new Date(),'Asia/Karachi').date;
 return {employee:{...emp,organization:await organizationAt(tx,emp.id,new Date(today+'T00:00:00Z'))},versions:versions.map(version=>{
  const previous=versions.find(other=>other.id===version.previousId)||versions.find(other=>other.effectiveMonth<version.effectiveMonth);
  const difference=previous?moneyToMinor(version.monthlyBasic.toFixed(2))-moneyToMinor(previous.monthlyBasic.toFixed(2)):null;
  return {...salaryView(version),changeAmount:difference===null?null:(difference<0n?'-':'+')+moneyFromMinor(difference<0n?-difference:difference)};
 })};
});}
async function saveSalary(userId,employeeId,input){return transaction(async tx=>{
 const user=await actor(tx,userId);await employee(tx,employeeId);await lock(tx,employeeId);
 const previous=await tx.employeeSalaryVersion.findFirst({where:{employeeId,effectiveMonth:date(input.effectiveMonth)},orderBy:{revision:'desc'}});
 if((previous?.id||null)!==input.expectedPreviousId)fail(409,'Salary revision changed. Reload salary history.','SALARY_CONFLICT');
 const record=await tx.employeeSalaryVersion.create({data:{employeeId,effectiveMonth:date(input.effectiveMonth),monthlyBasic:moneyFromMinor(moneyToMinor(input.monthlyBasic)),currency:'PKR',revision:(previous?.revision||0)+1,previousId:previous?.id||null,actorUserId:user.id,reason:input.reason}});
 await event(tx,user.id,'SALARY_REVISION_CREATED',record.id,{employeeId,effectiveMonth:input.effectiveMonth,revision:record.revision,reason:input.reason});return salaryView(record);
});}
async function calculation(tx,employeeId,month,input){const salary=await applicable(tx,employeeId,month);const result=calculatePayrollPreview({month,monthlyBasic:salary.monthlyBasic.toFixed(2),currency:'PKR',totalPayableDays:input.totalPayableDays,workedDays:input.workedDays,earnings:input.earnings,deductions:input.deductions});return {salary,result};}
async function preview(userId,input){return transaction(async tx=>{await actor(tx,userId);const emp=await employee(tx,input.employeeId);const {salary,result}=await calculation(tx,emp.id,input.month,input);return {...result,salaryVersionId:salary.id,employee:emp};});}
function financial(result){const {month,period,...fields}=result;void month;void period;return fields;}
function paymentView(p,privateView){if(!p)return null;return {id:p.id,amount:p.amount.toFixed(2),currency:p.currency,method:p.method,paidOn:p.paidOn.toISOString().slice(0,10),recordedAt:p.recordedAt.toISOString(),...(!privateView?{reference:p.reference,note:p.note,actorUserId:p.actorUserId}:{})};}
function view(record,privateView=false){
 const value={id:record.id,employeeId:record.employeeId,month:monthOf(record.payrollMonth),period:payrollPeriod(monthOf(record.payrollMonth)),currency:record.currency,employeeCode:record.employeeCodeSnapshot,employeeName:record.employeeNameSnapshot,status:record.status,version:record.version,basis:record.basis,rounding:record.rounding,calculationVersion:record.calculationVersion,earnings:record.earnings,deductions:record.deductions,hrApprovedAt:record.hrApprovedAt?.toISOString()||null,adminApprovedAt:record.adminApprovedAt?.toISOString()||null,paidAt:record.paidAt?.toISOString()||null,payment:paymentView(record.payment,privateView)};
 for(const key of ['monthlyBasic','totalPayableDays','workedDays','earnedBasic','unearnedBasic','additionalEarnings','grossPay','totalDeductions','netPay'])value[key]=record[key].toFixed(2);
 if(!privateView)Object.assign(value,{salaryVersionId:record.salaryVersionId,changeReason:record.changeReason,createdByUserId:record.createdByUserId,hrApprovedByUserId:record.hrApprovedByUserId,adminApprovedByUserId:record.adminApprovedByUserId,paidByUserId:record.paidByUserId,createdAt:record.createdAt.toISOString(),updatedAt:record.updatedAt.toISOString()});
 return value;
}
async function corrections(tx,records){
 const ids=records.filter(record=>record.status==='DRAFT').map(record=>record.id);
 if(!ids.length)return new Map();
 const events=await tx.auditLog.findMany({where:{targetType:'Payroll',targetId:{in:ids},action:'PAYROLL_RETURN',success:true},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{targetId:true,metadata:true}});
 const result=new Map();for(const entry of events)if(!result.has(entry.targetId))result.set(entry.targetId,entry.metadata?.reason||'Review the correction history.');return result;
}
async function createDraft(userId,input){return transaction(async tx=>{
 const user=await actor(tx,userId);if(user.role!=='HR')fail(403,'HR prepares payroll drafts.','FORBIDDEN');const emp=await employee(tx,input.employeeId);await lock(tx,emp.id);
 const {salary,result}=await calculation(tx,emp.id,input.month,input);
 const record=await tx.payrollRecord.create({data:{employeeId:emp.id,salaryVersionId:salary.id,payrollMonth:date(input.month),...financial(result),employeeCodeSnapshot:emp.employeeCode,employeeNameSnapshot:emp.fullName,createdByUserId:user.id,updatedByUserId:user.id,changeReason:input.reason}});
 await event(tx,user.id,'PAYROLL_CREATED',record.id,{reason:input.reason,version:record.version});return view(record);
});}
async function ownEmployee(tx,user){const emp=await tx.employee.findUnique({where:{userId:user.id},select:{id:true}});if(!emp)fail(403,'No linked employee profile. Contact Admin/HR.','PROFILE_LINK_REQUIRED');return emp;}
async function list(userId,filters={},own=false){return transaction(async tx=>{
 const user=await actor(tx,userId,false);if(!own&&!management(user))fail(403,'Payroll management access required.','FORBIDDEN');
 const {page=1,pageSize=20,month,employeeId,status,search}=filters;
 const where={};if(own){const emp=await ownEmployee(tx,user);where.employeeId=emp.id;where.status={in:['APPROVED','PAID']};if(employeeId&&employeeId!==emp.id)fail(403,'Own payslips only.','FORBIDDEN');if(status&&!['APPROVED','PAID'].includes(status))fail(400,'Only finally approved payslips are visible.');}
 else if(employeeId)where.employeeId=employeeId;
 if(month)where.payrollMonth=date(month);if(status)where.status=status;
 if(search)where.OR=[{employeeNameSnapshot:{contains:search,mode:'insensitive'}},{employeeCodeSnapshot:{contains:search,mode:'insensitive'}}];
 const records=await tx.payrollRecord.findMany({where,include:{payment:true},orderBy:[{payrollMonth:'desc'},{employeeNameSnapshot:'asc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize});const total=await tx.payrollRecord.count({where});
 const returned=own?new Map():await corrections(tx,records);
 return {records:records.map(r=>({...view(r,own),...(!own?{needsCorrection:returned.has(r.id)}:{})})),total,page,pageSize,totalPages:Math.ceil(total/pageSize)};
});}
async function detail(userId,id,own=false){return transaction(async tx=>{
 const user=await actor(tx,userId,false);if(!own&&!management(user))fail(403,'Payroll management access required.','FORBIDDEN');
 const record=await tx.payrollRecord.findUnique({where:{id},include:{payment:true}});
 if(own){const emp=await ownEmployee(tx,user);if(!record||record.employeeId!==emp.id||!['APPROVED','PAID'].includes(record.status))fail(404,'Payslip not found.','NOT_FOUND');}
 if(!record)fail(404,'Payroll not found.','NOT_FOUND');
 const result=view(record,own);
 result.organization=await organizationAt(tx,record.employeeId,new Date(result.period.dateTo+'T00:00:00Z'));
 if(!own){const events=await tx.auditLog.findMany({where:{targetType:'Payroll',targetId:id},orderBy:[{createdAt:'asc'},{id:'asc'}],include:{actor:{select:{displayName:true}}}});result.history=events.map(e=>({action:e.action,at:e.createdAt.toISOString(),actor:e.actor?.displayName||'Authorized account',metadata:e.metadata}));const returned=record.status==='DRAFT'?events.findLast(e=>e.action==='PAYROLL_RETURN'):null;result.needsCorrection=Boolean(returned);result.correctionReason=returned?.metadata?.reason||null;}
 return result;
});}
async function mutate(userId,id,input,action){return transaction(async tx=>{
 const user=await actor(tx,userId);
 const role={edit:'HR','hr-approve':'HR',return:'ADMIN',approve:'ADMIN',pay:'ADMIN'}[action];
 if(role&&user.role!==role)fail(403,`This action requires ${role}.`,'FORBIDDEN');
 let record=await tx.payrollRecord.findUnique({where:{id}});if(!record)fail(404,'Payroll not found.','NOT_FOUND');await lock(tx,record.employeeId);
 if(record.version!==input.expectedVersion)fail(409,'Payroll changed. Reload before trying again.','VERSION_CONFLICT');
 if(record.version>=2147483647)fail(409,'Payroll revision limit reached. No changes were saved.','VERSION_EXHAUSTED');
 const data={updatedByUserId:user.id,changeReason:input.reason,version:{increment:1}};const now=new Date();
 if(action==='edit'){
  if(record.status!=='DRAFT')fail(409,'Only drafts can be edited.','INVALID_TRANSITION');
  const {salary,result}=await calculation(tx,record.employeeId,monthOf(record.payrollMonth),input);Object.assign(data,financial(result),{salaryVersionId:salary.id});
 }else if(action==='return'){
  if(record.status!=='HR_APPROVED')fail(409,'Only HR-approved payroll can return to draft.','INVALID_TRANSITION');Object.assign(data,{status:'DRAFT',hrApprovedByUserId:null,hrApprovedAt:null});
 }else if(action==='hr-approve'||action==='approve'){
  if(action==='hr-approve'&&user.role!=='HR'||action==='approve'&&user.role!=='ADMIN')fail(403,'This approval requires a different role.','FORBIDDEN');
  if(record.status!==(action==='hr-approve'?'DRAFT':'HR_APPROVED'))fail(409,'Invalid approval order.','INVALID_TRANSITION');
  if(action==='approve'&&record.hrApprovedByUserId===user.id)fail(403,'Final approval requires a distinct Admin account.','FORBIDDEN');
  const salary=await applicable(tx,record.employeeId,monthOf(record.payrollMonth));if(salary.id!==record.salaryVersionId)fail(409,'Salary changed. Return to draft if needed, recalculate and review again.','SALARY_STALE');
  Object.assign(data,action==='hr-approve'?{status:'HR_APPROVED',hrApprovedByUserId:user.id,hrApprovedAt:now}:{status:'APPROVED',adminApprovedByUserId:user.id,adminApprovedAt:now});
 }else if(action==='pay'){
  if(record.status!=='APPROVED')fail(409,'Record one full payment for finally approved payroll only.','INVALID_TRANSITION');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);if(input.paidOn>today)fail(400,'Payment date cannot be in the future.');
  await tx.payrollPayment.create({data:{payrollRecordId:id,amount:record.netPay,currency:'PKR',method:input.method,paidOn:new Date(input.paidOn+'T00:00:00Z'),reference:input.reference||null,note:input.note||null,actorUserId:user.id,recordedAt:now}});Object.assign(data,{status:'PAID',paidByUserId:user.id,paidAt:now});
 }else fail(400,'Unknown payroll action.');
 record=await tx.payrollRecord.update({where:{id,version:input.expectedVersion},data,include:{payment:true}});
 const resubmitted=action==='hr-approve'&&Boolean(await tx.auditLog.findFirst({where:{targetType:'Payroll',targetId:id,action:'PAYROLL_RETURN',success:true},select:{id:true}}));
 await event(tx,user.id,`PAYROLL_${action.toUpperCase().replaceAll('-','_')}`,id,{reason:input.reason,version:record.version,status:record.status,...(resubmitted?{resubmitted:true}:{})});await require('./workflow-notifications').payrollChanged(tx,record,action,user.id);return view(record);
});}
module.exports={salaryHistory,saveSalary,preview,createDraft,list,detail,mutate};
