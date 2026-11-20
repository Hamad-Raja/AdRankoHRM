'use strict';
const prisma=require('../config/prisma');
const {actor,fail}=require('./organization.service');
const {localParts}=require('../utils/office-schedule');
const {statusOn}=require('../utils/employment-status');
const {normalizedCnic}=require('../validation/employee-record.validation');
const date=value=>new Date(value+'T00:00:00Z');
const day=value=>value?.toISOString().slice(0,10)||null;
const instant=value=>value?.toISOString()||null;
function maskCnic(value){return /^\d{5}-\d{7}-\d$/.test(value||'')?value.slice(0,5)+'-*******-'+value.slice(-1):null;}
function pageInfo(page,pageSize,total){return {page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize))};}
// Domain queries are enforced READ ONLY. Sensitive-read audit evidence is the
// sole write, separately committed after the consistent snapshot succeeds.
async function read(userId,action,employeeId,work){
 const result=await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const user=await actor(tx,userId,false);if(user.role!=='ADMIN')fail(403,'Employee Records is restricted to Admin.','FORBIDDEN');
  return work(tx,date(localParts(new Date(),'Asia/Karachi').date));
 },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:20000});
 await prisma.auditLog.create({data:{actorUserId:userId,action,success:true,targetType:'EmployeeRecords',targetId:employeeId||null}});
 return result;
}
async function employee(tx,id){const value=await tx.employee.findUnique({where:{id},select:{id:true,fullName:true,employeeCode:true,cnic:true,user:{select:{status:true}},createdAt:true}});if(!value)fail(404,'Employee record not found.','NOT_FOUND');return value;}
const episodeSelect={id:true,startDate:true,endDate:true,status:true,statusEffectiveDate:true,employmentType:true};
function episodeView(row){return {id:row.id,startDate:day(row.startDate),endDate:day(row.endDate),recordedStatus:row.status,statusEffectiveDate:day(row.statusEffectiveDate),employmentType:row.employmentType};}
const placementSelect={id:true,effectiveFrom:true,effectiveTo:true,reason:true,designation:{select:{name:true}},department:{select:{name:true}},campaign:{select:{name:true}},team:{select:{name:true}}};
function placementView(row){return row?{id:row.id,from:day(row.effectiveFrom),to:day(row.effectiveTo),designation:row.designation?.name||null,department:row.department?.name||null,campaign:row.campaign?.name||null,team:row.team?.name||null,reason:row.reason}:null;}
const exitSelect={id:true,kind:true,source:true,reason:true,preparationReason:true,noticeDays:true,receivedDate:true,proposedLastDate:true,confirmedLastDate:true,employmentEndDate:true,finalShiftStart:true,accessCutoff:true,completedAt:true,approvedAt:true,terminationCategory:true,noticeHandling:true,approver:{select:{displayName:true}}};
function exitView(row){return row?{id:row.id,kind:row.kind,source:row.source,reason:row.preparationReason||row.reason,originalReason:row.reason,noticeDays:row.noticeDays,receivedDate:day(row.receivedDate),proposedLastDate:day(row.proposedLastDate),lastWorkingShiftDate:day(row.confirmedLastDate),employmentEndDate:day(row.employmentEndDate),finalShiftStart:instant(row.finalShiftStart),accessCutoff:instant(row.accessCutoff),completedAt:instant(row.completedAt),approvedAt:instant(row.approvedAt),approvedBy:row.approver?.displayName||null,terminationCategory:row.terminationCategory,noticeHandling:row.noticeHandling}:null;}
async function completedExit(tx,employeeId,episodeId){return episodeId?tx.employmentCase.findFirst({where:{employeeId,episodeId,kind:{in:['RESIGNATION','TERMINATION']},state:'COMPLETED'},select:exitSelect,orderBy:[{completedAt:'desc'},{id:'desc'}]}):null;}
async function search(userId,input){return read(userId,'EMPLOYEE_RECORDS_SEARCHED',null,async(tx,asOf)=>{
 const cnic=normalizedCnic(input.query),offset=(input.page-1)*input.pageSize;
 // Dated status lookup follows dashboard classification, with stable ordering.
 const [result]=await tx.$queryRaw`
 WITH classified AS (
  SELECT e.id,e."fullName",e."employeeCode",
   CASE WHEN e.cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN left(e.cnic,5)||'-*******-'||right(e.cnic,1) END AS "maskedCnic",
   CASE WHEN ep.id IS NULL THEN CASE WHEN EXISTS(SELECT 1 FROM employment_episodes f WHERE f."employeeId"=e.id) THEN 'FUTURE_START' ELSE 'NO_EMPLOYMENT' END
    WHEN ep."endDate"<${asOf}::date THEN 'EXITED'
    ELSE coalesce((SELECT ev."toStatus"::text FROM employment_status_events ev WHERE ev."employmentEpisodeId"=ep.id AND ev."effectiveDate"<=${asOf}::date ORDER BY ev."effectiveDate" DESC,ev."createdAt" DESC,ev.id DESC LIMIT 1),
     (SELECT ev."fromStatus"::text FROM employment_status_events ev WHERE ev."employmentEpisodeId"=ep.id AND ev."effectiveDate">${asOf}::date ORDER BY ev."effectiveDate",ev."createdAt",ev.id LIMIT 1),CASE WHEN ep."statusEffectiveDate"<=${asOf}::date THEN ep.status::text END,'UNKNOWN') END AS status
  FROM employees e LEFT JOIN LATERAL (SELECT * FROM employment_episodes ep WHERE ep."employeeId"=e.id AND ep."startDate"<=${asOf}::date ORDER BY ep."startDate" DESC,ep.id DESC LIMIT 1) ep ON true
  WHERE ${input.query}='' OR position(lower(${input.query}) in lower(e."fullName"))>0 OR position(lower(${input.query}) in lower(e."employeeCode"))>0 OR (${cnic}::text IS NOT NULL AND e.cnic=${cnic})
 ), matching AS (SELECT * FROM classified WHERE ${input.status}='' OR status=${input.status}),
 paged AS (SELECT * FROM matching ORDER BY "fullName",id LIMIT ${input.pageSize} OFFSET ${offset})
 SELECT (SELECT count(*)::int FROM matching) AS total,coalesce((SELECT jsonb_agg(to_jsonb(paged) ORDER BY "fullName",id) FROM paged),'[]'::jsonb) AS employees`;
 return {...pageInfo(input.page,input.pageSize,result.total),employees:result.employees};
 });}
async function financialTotals(tx,id,month){
 const where={currency:'PKR',payrollRecord:{employeeId:id,status:'PAID',...(month?{payrollMonth:date(month+'-01')}:{})}};
 const aggregate=await tx.payrollPayment.aggregate({where,_sum:{amount:true},_count:{_all:true}});
 // One payment per payroll is constrained by payroll_payment_record_key.
 return {totalRecordedPayments:aggregate._sum.amount?.toFixed(2)||'0.00',paidPayrollCount:aggregate._count._all,currency:'PKR'};
}
async function applicableSalary(tx,id,asOf){
 const context=day(asOf),month=context.slice(0,7);
 // Same rehire exclusions/month boundary as employment.salaryBoundaries(),
 // bounded to the latest boundary applicable to this period's actual date.
 const [boundary]=await tx.$queryRaw`SELECT "rehirePlan" FROM employment_cases WHERE "employeeId"=${id}::uuid AND kind='REHIRE' AND state IN ('APPROVED','COMPLETED') AND "rehirePlan"->>'joiningDate'<=${context} ORDER BY "accessCutoff" DESC,id DESC LIMIT 1`;
 const plan=boundary?.rehirePlan;
 const row=await tx.employeeSalaryVersion.findFirst({where:{employeeId:id,effectiveMonth:{lte:date(month+'-01'),...(plan?{gte:date(plan.joiningDate.slice(0,7)+'-01')}:{})},...(plan?{id:{notIn:plan.priorSalaryVersionIds||[]}}:{})},orderBy:[{effectiveMonth:'desc'},{revision:'desc'},{id:'desc'}],select:{id:true,effectiveMonth:true,revision:true,monthlyBasic:true,currency:true}});
 return row?{id:row.id,effectiveMonth:day(row.effectiveMonth).slice(0,7),revision:row.revision,monthlyBasic:row.monthlyBasic.toFixed(2),currency:row.currency}:null;
}
async function contextPeriod(tx,id,asOf){
 let episode=await tx.employmentEpisode.findFirst({where:{employeeId:id,startDate:{lte:asOf}},select:episodeSelect,orderBy:[{startDate:'desc'},{id:'desc'}]});
 if(!episode)episode=await tx.employmentEpisode.findFirst({where:{employeeId:id},select:episodeSelect,orderBy:[{startDate:'asc'},{id:'asc'}]});
 return episode;
}
async function summary(userId,id){return read(userId,'EMPLOYEE_RECORD_SUMMARY_READ',id,async(tx,asOf)=>{
 const person=await employee(tx,id);
 const episode=await contextPeriod(tx,id,asOf);
 const end=episode?.endDate&&episode.endDate<asOf?episode.endDate:asOf;
 const placement=await tx.organizationAssignment.findFirst({where:{employeeId:id,effectiveFrom:{lte:end},...(episode?{OR:[{effectiveTo:null},{effectiveTo:{gte:episode.startDate}}]}:{})},select:placementSelect,orderBy:[{effectiveFrom:'desc'},{id:'desc'}]});
 const exit=await completedExit(tx,id,episode?.id);
 const legacyExit=episode?.endDate&&!exit?await tx.employmentStatusEvent.findFirst({where:{employmentEpisodeId:episode.id,toStatus:'EXITED'},orderBy:[{effectiveDate:'desc'},{createdAt:'desc'},{id:'desc'}],select:{reason:true}}):null;
 let status='NO_EMPLOYMENT';
 if(episode){if(episode.startDate>asOf)status='FUTURE_START';else if(episode.endDate&&episode.endDate<asOf)status='EXITED';else{const prior=await tx.employmentStatusEvent.findFirst({where:{employmentEpisodeId:episode.id,effectiveDate:{lte:asOf}},orderBy:[{effectiveDate:'desc'},{createdAt:'desc'},{id:'desc'}]});const next=prior?null:await tx.employmentStatusEvent.findFirst({where:{employmentEpisodeId:episode.id,effectiveDate:{gt:asOf}},orderBy:[{effectiveDate:'asc'},{createdAt:'asc'},{id:'asc'}]});status=statusOn({...episode,statusEvents:[prior||next].filter(Boolean)},day(asOf))||'UNKNOWN';}}
 const recentEvents=episode?await tx.employmentStatusEvent.findMany({where:{employmentEpisodeId:episode.id},orderBy:[{effectiveDate:'desc'},{createdAt:'desc'},{id:'desc'}],take:5,select:{id:true,toStatus:true,effectiveDate:true,reason:true}}):[];
 return {asOf:day(asOf),employee:{id:person.id,fullName:person.fullName,employeeCode:person.employeeCode,maskedCnic:maskCnic(person.cnic),status,accountStatus:person.user?.status||null},period:episode?episodeView(episode):null,placement:placementView(placement),exit:exitView(exit),recordedExitReason:exit?.preparationReason||exit?.reason||legacyExit?.reason||null,latestApplicableSalary:episode?await applicableSalary(tx,id,end):null,lifetime:await financialTotals(tx,id),recentEvents:recentEvents.map(e=>({id:e.id,status:e.toStatus,effectiveDate:day(e.effectiveDate),reason:e.reason}))};
 });}
async function history(userId,id,input){return read(userId,'EMPLOYEE_RECORD_HISTORY_READ',id,async tx=>{
 await employee(tx,id);const where={employeeId:id};const total=await tx.employmentEpisode.count({where});const rows=await tx.employmentEpisode.findMany({where,select:episodeSelect,orderBy:[{startDate:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});return {...pageInfo(input.page,input.pageSize,total),periods:rows.map(episodeView)};
 });}
async function period(userId,id,episodeId,input){return read(userId,'EMPLOYEE_RECORD_PERIOD_READ',id,async tx=>{
 const episode=await tx.employmentEpisode.findFirst({where:{id:episodeId,employeeId:id},select:episodeSelect});if(!episode)fail(404,'Employment period not found.','NOT_FOUND');
 const eventsWhere={employmentEpisodeId:episodeId},placementWhere={employeeId:id,...(episode.endDate?{effectiveFrom:{lte:episode.endDate}}:{}),OR:[{effectiveTo:null},{effectiveTo:{gte:episode.startDate}}]};
 const eventsTotal=await tx.employmentStatusEvent.count({where:eventsWhere}),assignmentsTotal=await tx.organizationAssignment.count({where:placementWhere});
 const events=await tx.employmentStatusEvent.findMany({where:eventsWhere,select:{id:true,fromStatus:true,toStatus:true,effectiveDate:true,reason:true,createdAt:true,actor:{select:{displayName:true}},approvedBy:{select:{displayName:true}},approvedAt:true},orderBy:[{effectiveDate:'asc'},{createdAt:'asc'},{id:'asc'}],skip:(input.eventsPage-1)*input.pageSize,take:input.pageSize});
 const assignments=await tx.organizationAssignment.findMany({where:placementWhere,select:placementSelect,orderBy:[{effectiveFrom:'desc'},{id:'desc'}],skip:(input.assignmentsPage-1)*input.pageSize,take:input.pageSize});
 return {period:episodeView(episode),exit:exitView(await completedExit(tx,id,episodeId)),events:{...pageInfo(input.eventsPage,input.pageSize,eventsTotal),rows:events.map(e=>({id:e.id,from:e.fromStatus,to:e.toStatus,effectiveDate:day(e.effectiveDate),reason:e.reason,actor:e.actor.displayName,approvedBy:e.approvedBy?.displayName||null,approvedAt:instant(e.approvedAt),recordedAt:instant(e.createdAt)}))},assignments:{...pageInfo(input.assignmentsPage,input.pageSize,assignmentsTotal),rows:assignments.map(placementView)}};
 });}
async function finances(userId,id,input){return read(userId,'EMPLOYEE_RECORD_FINANCES_READ',id,async(tx,asOf)=>{
 await employee(tx,id);const episode=await contextPeriod(tx,id,asOf),salaryDate=episode?.endDate&&episode.endDate<asOf?episode.endDate:asOf;const where={currency:'PKR',payrollRecord:{employeeId:id,status:'PAID',...(input.month?{payrollMonth:date(input.month+'-01')}:{})}};
 const total=await tx.payrollPayment.count({where}),salaryTotal=await tx.employeeSalaryVersion.count({where:{employeeId:id}});
 const rows=await tx.payrollPayment.findMany({where,select:{id:true,amount:true,currency:true,paidOn:true,recordedAt:true,payrollRecord:{select:{id:true,payrollMonth:true,status:true,monthlyBasic:true,netPay:true}}},orderBy:[{paidOn:'desc'},{recordedAt:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
 const salaries=await tx.employeeSalaryVersion.findMany({where:{employeeId:id},select:{id:true,effectiveMonth:true,monthlyBasic:true,currency:true,revision:true,createdAt:true},orderBy:[{effectiveMonth:'desc'},{revision:'desc'},{id:'desc'}],skip:(input.salaryPage-1)*input.pageSize,take:input.pageSize});
 return {latestApplicableSalary:episode?await applicableSalary(tx,id,salaryDate):null,lifetime:await financialTotals(tx,id),filtered:await financialTotals(tx,id,input.month),month:input.month||null,payments:{...pageInfo(input.page,input.pageSize,total),rows:rows.map(r=>({id:r.id,payrollId:r.payrollRecord.id,month:day(r.payrollRecord.payrollMonth).slice(0,7),paidAmount:r.amount.toFixed(2),monthlyBasic:r.payrollRecord.monthlyBasic.toFixed(2),netPay:r.payrollRecord.netPay.toFixed(2),currency:r.currency,paidOn:day(r.paidOn),recordedAt:instant(r.recordedAt),status:r.payrollRecord.status}))},salaries:{...pageInfo(input.salaryPage,input.pageSize,salaryTotal),rows:salaries.map(s=>({id:s.id,effectiveMonth:day(s.effectiveMonth).slice(0,7),monthlyBasic:s.monthlyBasic.toFixed(2),revision:s.revision,currency:s.currency,recordedAt:instant(s.createdAt)}))}};
 });}
async function documents(userId,id,input){return read(userId,'EMPLOYEE_RECORD_DOCUMENTS_READ',id,async tx=>{
 await employee(tx,id);const where={employeeId:id};const total=await tx.employeeDocument.count({where});const rows=await tx.employeeDocument.findMany({where,select:{id:true,title:true,mediaType:true,byteLength:true,createdAt:true,ownerVisible:true,replacesId:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});return {...pageInfo(input.page,input.pageSize,total),documents:rows.map(r=>({...r,createdAt:instant(r.createdAt)}))};
 });}
module.exports={search,summary,history,period,finances,documents,maskCnic};
