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
  if(['40001','40P01'].includes(e.cause?.originalCode)||e.cause?.kind==='TransactionWriteConflict'||['P2002','P2004','P2025','P2034'].includes(e.code)||e.meta?.code==='23514'||JSON.stringify(e.meta||{}).includes('23514'))fail(409,'Payroll changed or conflicts with its workflow. Reload before trying again.','PAYROLL_CONFLICT');
  throw e;
 }
}
async function event(tx,userId,action,targetId,metadata){await tx.auditLog.create({data:{actorUserId:userId,action,success:true,targetType:'Payroll',targetId,metadata}});}
async function employee(tx,id){const emp=await tx.employee.findUnique({where:{id},select:{id:true,fullName:true,employeeCode:true}});if(!emp)fail(404,'Employee not found.','NOT_FOUND');return emp;}
async function lock(tx,id){await tx.$queryRaw`SELECT id FROM employees WHERE id=${id}::uuid FOR UPDATE`;}
async function applicable(tx,employeeId,month){const boundary=(await require('./employment.service').salaryBoundaries(tx,employeeId)).find(item=>item.month<=month);const salary=await tx.employeeSalaryVersion.findFirst({where:{employeeId,effectiveMonth:{lte:date(month),...(boundary?{gte:date(boundary.month)}:{})},...(boundary?{id:{notIn:boundary.excludedVersionIds}}:{})},orderBy:[{effectiveMonth:'desc'},{revision:'desc'}]});if(!salary)fail(409,'Set an effective salary for this payroll month and employment episode first.','SALARY_REQUIRED');return salary;}
const salaryView=s=>({id:s.id,employeeId:s.employeeId,effectiveMonth:monthOf(s.effectiveMonth),revision:s.revision,previousId:s.previousId,monthlyBasic:s.monthlyBasic.toFixed(2),currency:s.currency,reason:s.reason,actorUserId:s.actorUserId,actorName:s.actor?.displayName||null,createdAt:s.createdAt.toISOString()});
async function organizationAt(tx,employeeId,asOf){
 const assignment=await tx.organizationAssignment.findFirst({where:{employeeId,effectiveFrom:{lte:asOf},OR:[{effectiveTo:null},{effectiveTo:{gte:asOf}}]},orderBy:[{effectiveFrom:'desc'},{id:'desc'}],select:{department:{select:{name:true}},designation:{select:{name:true}},team:{select:{department:{select:{name:true}}}}}});
 return assignment?{department:assignment.department?.name||assignment.team?.department?.name||null,designation:assignment.designation?.name||null,asOf:asOf.toISOString().slice(0,10)}:null;
}
async function salaryHistory(userId,employeeId){return transaction(async tx=>{
 await actor(tx,userId);const emp=await employee(tx,employeeId);
 const versions=await tx.employeeSalaryVersion.findMany({where:{employeeId},include:{actor:{select:{displayName:true}}},orderBy:[{effectiveMonth:'desc'},{revision:'desc'}]});
 const today=require('../utils/office-schedule').localParts(new Date(),'Asia/Karachi').date;
 return {employee:{...emp,organization:await organizationAt(tx,emp.id,new Date(today+'T00:00:00Z'))},rehireBoundaries:await require('./employment.service').salaryBoundaries(tx,emp.id),versions:versions.map(version=>{
  const previous=versions.find(other=>other.id===version.previousId)||versions.find(other=>other.effectiveMonth<version.effectiveMonth);
  const difference=previous?moneyToMinor(version.monthlyBasic.toFixed(2))-moneyToMinor(previous.monthlyBasic.toFixed(2)):null;
  return {...salaryView(version),changeAmount:difference===null?null:(difference<0n?'-':'+')+moneyFromMinor(difference<0n?-difference:difference)};
 })};
});}
async function saveSalaryInTransaction(tx,userId,employeeId,input){
 const parsed=require('../validation/payroll-api.validation').salary.safeParse(input);
 if(!parsed.success)fail(400,'Enter a valid positive monthly salary and effective month.','VALIDATION_ERROR');
 input=parsed.data;
 const user=await actor(tx,userId);await employee(tx,employeeId);await lock(tx,employeeId);
 const previous=await tx.employeeSalaryVersion.findFirst({where:{employeeId,effectiveMonth:date(input.effectiveMonth)},orderBy:{revision:'desc'}});
 if((previous?.id||null)!==input.expectedPreviousId)fail(409,'Salary revision changed. Reload salary history.','SALARY_CONFLICT');
 const record=await tx.employeeSalaryVersion.create({data:{employeeId,effectiveMonth:date(input.effectiveMonth),monthlyBasic:moneyFromMinor(moneyToMinor(input.monthlyBasic)),currency:'PKR',revision:(previous?.revision||0)+1,previousId:previous?.id||null,actorUserId:user.id,reason:input.reason}});
 await event(tx,user.id,'SALARY_REVISION_CREATED',record.id,{employeeId,effectiveMonth:input.effectiveMonth,revision:record.revision,reason:input.reason});return salaryView(record);
}
async function saveSalary(userId,employeeId,input){return transaction(tx=>saveSalaryInTransaction(tx,userId,employeeId,input));}
const financialItems=items=>items?.map(({type,label,amount})=>({type,label,amount}));
async function calculation(tx,employeeId,month,input){const salary=await applicable(tx,employeeId,month);const result=calculatePayrollPreview({month,monthlyBasic:salary.monthlyBasic.toFixed(2),currency:'PKR',totalPayableDays:input.totalPayableDays,workedDays:input.workedDays,earnings:financialItems(input.earnings),deductions:financialItems(input.deductions)});return {salary,result};}
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
async function createDraft(userId,input,options={}){return transaction(async tx=>{
 const user=await actor(tx,userId);if(user.role!=='HR')fail(403,'HR prepares payroll drafts.','FORBIDDEN');const emp=await employee(tx,input.employeeId);await lock(tx,emp.id);
 const expectedSalaryVersionId=options.expectedSalaryVersionId||input.expectedSalaryVersionId;
 const fingerprint=digest({employeeId:emp.id,month:input.month,totalPayableDays:input.totalPayableDays,workedDays:input.workedDays,earnings:input.earnings||[],deductions:input.deductions||[],reason:input.reason,expectedSalaryVersionId:expectedSalaryVersionId||null});
 if(input.operationKey){
  const previous=await tx.auditLog.findFirst({where:{actorUserId:user.id,targetType:'Payroll',action:'PAYROLL_BATCH_EDIT',metadata:{path:['operationKey'],equals:input.operationKey}}});
  if(previous){if(previous.metadata.kind!=='PREPARE'||previous.metadata.fingerprint!==fingerprint)fail(409,'Operation key already belongs to different preparation inputs. Start a new operation.','OPERATION_CONFLICT');const saved=await tx.payrollRecord.findUnique({where:{id:previous.metadata.recordId}});if(!saved)fail(409,'Saved preparation is unavailable. Reload payroll.','PAYROLL_CONFLICT');return {...view(saved),preparationReplayed:true};}
 }
 if(options.bulk){if(await tx.payrollRecord.findFirst({where:{employeeId:emp.id,payrollMonth:date(input.month)},select:{id:true}}))fail(409,'Payroll already exists.','PAYROLL_EXISTS');if(!await monthEligible(tx,emp.id,input.month))fail(409,'No employment overlaps this payroll month.','MONTH_NOT_ELIGIBLE');}
 const {salary,result}=await calculation(tx,emp.id,input.month,input);
 if(expectedSalaryVersionId&&expectedSalaryVersionId!==salary.id)fail(409,'Applicable salary changed. Review and select again.','SALARY_STALE');
 const record=await tx.payrollRecord.create({data:{employeeId:emp.id,salaryVersionId:salary.id,payrollMonth:date(input.month),...financial(result),employeeCodeSnapshot:emp.employeeCode,employeeNameSnapshot:emp.fullName,createdByUserId:user.id,updatedByUserId:user.id,changeReason:input.reason}});
 const preparation=Object.fromEntries(['earnings','deductions'].map(kind=>[kind,result[kind].map((line,index)=>({...line,...(input[kind]?.[index]?.reason?{reason:input[kind][index].reason}:{})}))]));
 await event(tx,user.id,'PAYROLL_CREATED',record.id,{reason:input.reason,version:record.version,preparation});
 // Self-target the operation UUID so the existing unique audit index protects
 // the identity across employees, not just within a newly created record.
 if(input.operationKey)await event(tx,user.id,'PAYROLL_BATCH_EDIT',input.operationKey,{kind:'PREPARE',operationKey:input.operationKey,recordId:record.id,fingerprint,reason:input.reason,version:record.version});
 return view(record);
});}
async function bulkDrafts(userId,input){
 const parsed=require('../validation/payroll-api.validation').bulk.safeParse(input);if(!parsed.success)fail(400,'Select 1 to 25 unique employees with valid preparation inputs.','VALIDATION_ERROR');input=parsed.data;
 await transaction(async tx=>{const user=await actor(tx,userId);if(user.role!=='HR')fail(403,'HR prepares payroll drafts.','FORBIDDEN');});
 const results=[];
 // Bounded sequential processing; each employee commits or rolls back independently.
 for(const item of input.items){
  try{const prepare=()=>createDraft(userId,{...item,month:input.month},{bulk:true,expectedSalaryVersionId:item.expectedSalaryVersionId});let record;try{record=await prepare();}catch(error){if(item.operationKey&&error.code==='PAYROLL_CONFLICT')record=await prepare();else throw error;}results.push({employeeId:item.employeeId,outcome:record.preparationReplayed?'SKIPPED':'CREATED',recordId:record.id,reason:record.preparationReplayed?'Already prepared; retry did not duplicate adjustments.':'Draft created.'});}
  catch(error){let existing=null;if(['PAYROLL_CONFLICT','PAYROLL_EXISTS'].includes(error.code)){try{existing=await transaction(async tx=>{await actor(tx,userId);return tx.payrollRecord.findFirst({where:{employeeId:item.employeeId,payrollMonth:date(input.month)},select:{id:true}});});}catch{/* A changed authorization must not expose records. */}}
   const skipped=!!existing||['SALARY_REQUIRED','MONTH_NOT_ELIGIBLE'].includes(error.code);results.push({employeeId:item.employeeId,outcome:skipped?'SKIPPED':'FAILED',...(existing?{recordId:existing.id}:{}),reason:existing?'Payroll already exists; it was not overwritten.':error instanceof ApiError?error.message:'Preparation failed. Reload saved state before retrying.',code:error.code||'UNCONFIRMED',...(error.details?{details:error.details}:{})});
  }
 }
 return {month:input.month,results,created:results.filter(row=>row.outcome==='CREATED').length,skipped:results.filter(row=>row.outcome==='SKIPPED').length,failed:results.filter(row=>row.outcome==='FAILED').length};
}

// Operation identities commit with the financial save in immutable audit history.
const digest=value=>require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function batchChanges(userId,input,apply=false){
 const parsed=require('../validation/payroll-api.validation').changes.safeParse(input);
 if(!parsed.success)fail(400,parsed.error.issues[0]?.message||'Invalid draft changes.','VALIDATION_ERROR');input=parsed.data;
 await transaction(async tx=>{if((await actor(tx,userId)).role!=='HR')fail(403,'HR edits drafts.','FORBIDDEN');});
 const results=[];
 for(const item of input.items){
  let identity={};
  try{results.push(await transaction(async tx=>{
   const user=await actor(tx,userId);if(user.role!=='HR')fail(403,'HR edits drafts.','FORBIDDEN');
   const initial=await tx.payrollRecord.findUnique({where:{id:item.recordId}});if(!initial)fail(404,'Draft not found.','NOT_FOUND');
   identity={employeeId:initial.employeeId,employeeName:initial.employeeNameSnapshot,employeeCode:initial.employeeCodeSnapshot};
   await lock(tx,initial.employeeId);
   const {previewHash,...request}=item;const fingerprint=digest({month:input.month,...request});
   const previous=await tx.auditLog.findFirst({where:{actorUserId:user.id,targetType:'Payroll',targetId:item.recordId,action:'PAYROLL_BATCH_EDIT',metadata:{path:['operationKey'],equals:item.operationKey}}});
   if(previous){if(previous.metadata.fingerprint!==fingerprint)fail(409,'Operation key already belongs to different changes. Start a new operation.','OPERATION_CONFLICT');return {recordId:item.recordId,...identity,outcome:'SKIPPED',reason:'Already saved; retry did not add duplicate items.',savedVersion:previous.metadata.version};}
   const record=await tx.payrollRecord.findUnique({where:{id:item.recordId}});
   if(record.status!=='DRAFT'||record.version!==item.expectedVersion||record.version>=2147483647)fail(409,'Draft changed or is no longer editable. Reload and review.','PAYROLL_CONFLICT');
   if(monthOf(record.payrollMonth)!==input.month)fail(400,'Draft belongs to another month.','VALIDATION_ERROR');
   const importing=item.kind==='IMPORT',adding=!importing&&item.kind!=='EDIT';
   if(!importing&&item.additions!==undefined)fail(400,'Additional import rows require an import group.','VALIDATION_ERROR');
   if(importing&&(item.adjustment||item.earnings!==undefined||item.deductions!==undefined))fail(400,'Import adds named items without replacing existing items.','VALIDATION_ERROR');
   const additions=item.additions||[],identities=additions.map(line=>line.operationKey);
   if(new Set([item.operationKey,...identities]).size!==identities.length+1)fail(400,'Duplicate operation keys in employee group.','VALIDATION_ERROR');
   for(const line of additions){if(!line.label?.trim())fail(400,'Enter a title for each adjustment.','VALIDATION_ERROR');if(await tx.auditLog.findFirst({where:{targetType:'Payroll',targetId:item.recordId,action:'PAYROLL_ADJUSTMENT_IDENTITY',metadata:{path:['operationKey'],equals:line.operationKey}}}))fail(409,'An imported adjustment was already applied. Retry the original group or remove the already applied row.','OPERATION_CONFLICT');}
   if(adding&&!item.adjustment?.label?.trim())fail(400,'Enter an adjustment title.','VALIDATION_ERROR');
   if(adding&&(!item.adjustment||item.earnings!==undefined||item.deductions!==undefined||item.totalPayableDays!==undefined||item.workedDays!==undefined))fail(400,'An addition requires one named item only.','VALIDATION_ERROR');
   if(!adding&&item.adjustment)fail(400,'Use the named line editors for draft edits.','VALIDATION_ERROR');
   const plain=line=>({type:line.type,label:line.label,amount:line.amount});
   const fields={totalPayableDays:item.totalPayableDays??record.totalPayableDays.toFixed(2),workedDays:item.workedDays??record.workedDays.toFixed(2),earnings:importing?[...record.earnings,...additions.filter(line=>line.kind==='EARNING').map(plain)]:adding?[...record.earnings,...(item.kind==='ADD_EARNING'?[item.adjustment]:[])]:item.earnings??record.earnings,deductions:importing?[...record.deductions,...additions.filter(line=>line.kind==='DEDUCTION').map(plain)]:adding?[...record.deductions,...(item.kind==='ADD_DEDUCTION'?[item.adjustment]:[])]:item.deductions??record.deductions};
   const {salary,result}=await calculation(tx,record.employeeId,input.month,fields);
   if(salary.id!==item.expectedSalaryVersionId)fail(409,'Applicable salary changed. Reload and review.','SALARY_STALE');
   const before=view(record),after={...before,...financial(result),salaryVersionId:salary.id};
   if(!adding&&salary.id===record.salaryVersionId&&['totalPayableDays','workedDays','earnings','deductions'].every(key=>JSON.stringify(before[key])===JSON.stringify(result[key])))return {recordId:record.id,employeeId:record.employeeId,...identity,outcome:'UNCHANGED',reason:'No financial changes.'};
   const hash=digest({fingerprint,version:record.version,salaryVersionId:salary.id,result});
   const response={recordId:record.id,employeeId:record.employeeId,employeeName:record.employeeNameSnapshot,employeeCode:record.employeeCodeSnapshot,outcome:'READY',before,after,previewHash:hash};
   if(!apply)return response;
   if(!previewHash||previewHash!==hash)fail(409,'Review the current server preview before saving.','PREVIEW_REQUIRED');
   const saved=await tx.payrollRecord.update({where:{id:record.id,version:item.expectedVersion},data:{...financial(result),salaryVersionId:salary.id,version:{increment:1},updatedByUserId:user.id,changeReason:item.reason}});
   for(const [index,line]of additions.entries())await event(tx,user.id,'PAYROLL_ADJUSTMENT_IDENTITY',record.id,{operationKey:line.operationKey,groupOperationKey:item.operationKey,employeeId:record.employeeId,month:input.month,reason:line.reason,item:plain(line),collection:line.kind==='EARNING'?'earnings':'deductions',index:(line.kind==='EARNING'?record.earnings:record.deductions).length+additions.slice(0,index).filter(other=>other.kind===line.kind).length});
   await event(tx,user.id,'PAYROLL_BATCH_EDIT',record.id,{operationKey:item.operationKey,fingerprint,employeeId:record.employeeId,month:input.month,kind:item.kind,reason:item.reason,version:saved.version,before:{totalPayableDays:before.totalPayableDays,workedDays:before.workedDays,earnings:before.earnings,deductions:before.deductions,netPay:before.netPay},after:{...fields,netPay:result.netPay},...(adding?{lineIdentity:{operationKey:item.operationKey,collection:item.kind==='ADD_EARNING'?'earnings':'deductions',index:(item.kind==='ADD_EARNING'?record.earnings:record.deductions).length}}:{})});
   return {...response,outcome:'CREATED',reason:'Draft changes saved.',savedVersion:saved.version};
  }));}catch(error){results.push({recordId:item.recordId,...identity,outcome:'FAILED',reason:error instanceof ApiError?error.message:'Changes could not be confirmed. Retry the same operation key.',code:error.code||'UNCONFIRMED'});}
 }
 const ready=results.filter(row=>['READY','CREATED'].includes(row.outcome)),sums={before:0n,after:0n};for(const row of ready){sums.before+=moneyToMinor(row.before.netPay);sums.after+=moneyToMinor(row.after.netPay);}
 const decimal=value=>(value<0n?'-':'')+(value<0n?-value:value)/100n+'.'+String((value<0n?-value:value)%100n).padStart(2,'0');
 return {month:input.month,results,created:results.filter(row=>row.outcome==='CREATED').length,skipped:results.filter(row=>row.outcome==='SKIPPED').length,unchanged:results.filter(row=>row.outcome==='UNCHANGED').length,failed:results.filter(row=>row.outcome==='FAILED').length,totals:{before:decimal(sums.before),after:decimal(sums.after),impact:decimal(sums.after-sums.before)}};
}
async function ownEmployee(tx,user){const emp=await tx.employee.findUnique({where:{userId:user.id},select:{id:true}});if(!emp)fail(403,'No linked employee profile. Contact Admin/HR.','PROFILE_LINK_REQUIRED');return emp;}
async function list(userId,filters={},own=false){if(filters.workspace){if(own)fail(400,'Monthly workspace is management-only.');return monthlyWorkspace(userId,filters);}if(['NOT_PREPARED','SALARY_REQUIRED'].includes(filters.status))fail(400,'Derived states require the monthly workspace.');return transaction(async tx=>{
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
// Employment dates, not the employee's current status, determine historical membership.
// Legacy profiles without episodes retain their existing preparation compatibility.
async function monthEligible(tx,employeeId,month){const period=payrollPeriod(month);return !await tx.employmentEpisode.count({where:{employeeId}})||!!await tx.employmentEpisode.findFirst({where:{employeeId,startDate:{lte:new Date(period.dateTo+'T00:00:00Z')},OR:[{endDate:null},{endDate:{gte:date(month)}}]},select:{id:true}});}
async function monthlyWorkspace(userId,filters){return transaction(async tx=>{
 const user=await actor(tx,userId);const {month,page=1,pageSize=20,search='',status=''}=filters;if(!month)fail(400,'Select a payroll month.');const employeeFilter=filters.employeeId||null;const period=payrollPeriod(month),from=date(month),to=new Date(period.dateTo+'T00:00:00Z');
 const [result]=await tx.$queryRaw`
 WITH candidates AS (
 SELECT e.id,e."fullName",e."employeeCode",p.id AS "payrollId",v.id AS "salaryVersionId",
 coalesce(p."monthlyBasic",v."monthlyBasic")::text AS "monthlyBasic",p."netPay"::text AS "netPay",
 CASE WHEN p.id IS NOT NULL THEN p.status::text WHEN v.id IS NULL THEN 'SALARY_REQUIRED' ELSE 'NOT_PREPARED' END AS status,
 (NOT EXISTS(SELECT 1 FROM employment_episodes ep WHERE ep."employeeId"=e.id) OR EXISTS(SELECT 1 FROM employment_episodes ep WHERE ep."employeeId"=e.id AND ep."startDate"<=${to} AND (ep."endDate" IS NULL OR ep."endDate">=${from}))) AS eligible
 FROM employees e LEFT JOIN payroll_records p ON p."employeeId"=e.id AND p."payrollMonth"=${from}
 LEFT JOIN LATERAL (SELECT c."rehirePlan" plan FROM employment_cases c WHERE c."employeeId"=e.id AND c.kind='REHIRE' AND c.state IN ('APPROVED','COMPLETED') AND substring(c."rehirePlan"->>'joiningDate',1,7)<=${month} ORDER BY c."accessCutoff" DESC LIMIT 1) boundary ON true
 LEFT JOIN LATERAL (SELECT s.id,s."monthlyBasic" FROM employee_salary_versions s WHERE s."employeeId"=e.id AND s."effectiveMonth"<=${from}
 AND (boundary.plan IS NULL OR s."effectiveMonth">=to_date(substring(boundary.plan->>'joiningDate',1,7)||'-01','YYYY-MM-DD'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(boundary.plan->'priorSalaryVersionIds','[]'::jsonb)) old WHERE old.value=s.id::text)
 ORDER BY s."effectiveMonth" DESC,s.revision DESC LIMIT 1) v ON true
 ), filtered AS (SELECT * FROM candidates WHERE (eligible OR "payrollId" IS NOT NULL) AND (${employeeFilter}::uuid IS NULL OR id=${employeeFilter}::uuid) AND (${status}='' OR status=${status}) AND (${search}='' OR position(lower(${search}) in lower("fullName"))>0 OR position(lower(${search}) in lower("employeeCode"))>0))
 SELECT (SELECT count(*)::int FROM filtered) total,coalesce((SELECT jsonb_agg(rows ORDER BY rows."fullName",rows.id) FROM (SELECT * FROM filtered ORDER BY "fullName",id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}) rows),'[]'::jsonb) rows`;
 const records=await tx.payrollRecord.findMany({where:{id:{in:result.rows.map(row=>row.payrollId).filter(Boolean)}},include:{payment:true}}),returned=await corrections(tx,records);
 return {month,page,pageSize,total:result.total,totalPages:Math.ceil(result.total/pageSize),rows:result.rows.map(row=>({employee:{id:row.id,fullName:row.fullName,employeeCode:row.employeeCode},monthlyBasic:row.monthlyBasic,netPay:row.netPay,status:row.status,salaryVersionId:row.salaryVersionId,canPrepare:user.role==='HR'&&row.eligible&&!row.payrollId&&!!row.salaryVersionId,record:row.payrollId?{...view(records.find(p=>p.id===row.payrollId)),needsCorrection:returned.has(row.payrollId)}:null}))};
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
 const data={updatedByUserId:user.id,changeReason:input.reason||(['hr-approve','approve'].includes(action)?(action==='hr-approve'?'HR approval (no note provided).':'Admin approval (no note provided).'):input.reason),version:{increment:1}};const now=new Date();
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
 await event(tx,user.id,`PAYROLL_${action.toUpperCase().replaceAll('-','_')}`,id,{reason:input.reason||null,version:record.version,status:record.status,...(resubmitted?{resubmitted:true}:{})});await require('./workflow-notifications').payrollChanged(tx,record,action,user.id);return view(record);
});}
async function annualSummary(userId,input,own=false){return transaction(async tx=>{
 const user=await actor(tx,userId,false);
 if(!own&&!management(user))fail(403,'Payroll management access required.','FORBIDDEN');
 const employeeId=own?(await ownEmployee(tx,user)).id:input.employeeId;
 if(own&&input.employeeId&&input.employeeId!==employeeId)fail(403,'Own payslips only.','FORBIDDEN');
 if(!employeeId)fail(400,'Select an employee for the annual summary.','EMPLOYEE_REQUIRED');
 const emp=await employee(tx,employeeId);
 // One unique payroll record per employee/month; read the complete calendar
 // year in the same transaction, independently of monthly table pagination.
 const records=await tx.payrollRecord.findMany({where:{employeeId,status:{in:['APPROVED','PAID']},payrollMonth:{gte:date(input.year+'-01'),lte:date(input.year+'-12')}},orderBy:{payrollMonth:'asc'},select:{id:true,payrollMonth:true,status:true,grossPay:true,totalDeductions:true,netPay:true}});
 const sums={grossPay:0n,totalDeductions:0n,netPay:0n,paidTotal:0n,awaitingPayment:0n};
 const months=records.map(record=>{for(const key of ['grossPay','totalDeductions','netPay'])sums[key]+=moneyToMinor(record[key].toFixed(2));sums[record.status==='PAID'?'paidTotal':'awaitingPayment']+=moneyToMinor(record.netPay.toFixed(2));return {id:record.id,month:monthOf(record.payrollMonth),status:record.status,grossPay:record.grossPay.toFixed(2),totalDeductions:record.totalDeductions.toFixed(2),netPay:record.netPay.toFixed(2)};});
 // Yearly sums can exceed the per-record input limit. Format exact integer
 // paisa without applying a transaction limit to a read-only aggregate.
 const totals=Object.fromEntries(Object.entries(sums).map(([key,value])=>[key,`${value/100n}.${String(value%100n).padStart(2,'0')}`]));
 return {employee:emp,year:input.year,currency:'PKR',recordCount:months.length,totals,months};
});}
module.exports={salaryHistory,saveSalary,saveSalaryInTransaction,preview,createDraft,list,detail,mutate,annualSummary,monthlyWorkspace,bulkDrafts,batchChanges};
