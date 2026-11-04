'use strict';

const { actor, fail, transaction } = require('./organization.service');
const { dateValue, dateString } = require('../utils/shift-rules');
const { localParts, instantFor, addDays, scheduleDate } = require('../utils/office-schedule');
const { emitEvent, reviewers } = require('./notification.service');
const clock = require('../utils/leave-clock');
const include = { employee:{select:{id:true,employeeCode:true,fullName:true,userId:true}}, history:{orderBy:{version:'asc'},include:{actor:{select:{displayName:true}}}} };

async function ownEmployee(tx, user) {
  const employee = await tx.employee.findUnique({where:{userId:user.id},select:{id:true,employeeCode:true,fullName:true,userId:true}});
  if (!employee) fail(403,'A linked employee profile is required. Contact HR.','PROFILE_LINK_REQUIRED');
  return employee;
}
function management(user) {
  if (!['HR','ADMIN'].includes(user.role)) fail(403,'HR management access required.','FORBIDDEN');
}
async function authorized(tx, user, id, manage=false) {
  if (manage) management(user);
  const request = await tx.leaveRequest.findUnique({where:{id},include});
  if (!request || !manage && (request.requestedByUserId!==user.id || request.employee.userId!==user.id)) fail(404,'Leave request unavailable.','NOT_FOUND');
  return request;
}
async function eligibleReviewers(tx, requester, employeeUserId=requester) {
  return reviewers(tx,['HR'],[requester,...(employeeUserId ? [employeeUserId] : [])]);
}

// Leave has a confirmed calendar even while the attendance policy remains inactive.
// A later policy/holiday/employment change is surfaced, never used to rewrite leave.
async function eligibility(tx, employeeId, shiftDate, now=clock.now()) {
  const issues=[];
  const startsAt=instantFor(shiftDate,'19:00','Asia/Karachi');
  const endsAt=instantFor(addDays(shiftDate,1),'05:00','Asia/Karachi');
  if (now>=startsAt) issues.push('SHIFT_STARTED');
  const weekday=dateValue(shiftDate).getUTCDay();
  if ([0,6].includes(weekday)) issues.push('WEEKLY_OFF');
  const attendance=require('./attendance.service');
  const episode=await attendance.findEligibleEpisode(tx,employeeId,shiftDate);
  if (!episode) issues.push('NOT_ELIGIBLE');
  if (await attendance.hasLegacyAssignment(tx,employeeId,shiftDate)) issues.push('LEGACY_ASSIGNMENT_REVIEW');
  const holiday=await tx.companyHolidayEvent.findFirst({where:{holidayDate:dateValue(shiftDate)},orderBy:{revision:'desc'}});
  if (holiday?.action==='ANNOUNCE') issues.push('COMPANY_HOLIDAY');
  const version=await tx.officeSchedule.findFirst({where:{effectiveFrom:{lte:dateValue(shiftDate)}},orderBy:{effectiveFrom:'desc'}});
  let attendanceState='SETUP_REQUIRED';
  if (version) {
    const result=scheduleDate(version,shiftDate,[],episode ? [{startDate:shiftDate,endDate:null,status:'ACTIVE'}] : [],holiday?.action==='ANNOUNCE'?[shiftDate]:[]);
    attendanceState=result.state;
    if (result.state!=='SCHEDULED') issues.push(result.state==='SETUP_REQUIRED'?'ATTENDANCE_SETUP_REQUIRED':`SCHEDULE_${result.state}`);
    if (version.policy.timeZone!=='Asia/Karachi' || JSON.stringify([...version.policy.workDays||[]].sort())!==JSON.stringify([1,2,3,4,5])) issues.push('SCHEDULE_POLICY_CONFLICT');
  }
  if (await tx.attendanceRecord.findFirst({where:{employeeId,shiftDate:dateValue(shiftDate)}})) issues.push('ATTENDANCE_EXISTS');
  if (await tx.attendanceCorrectionRequest.findFirst({where:{employeeId,shiftDate:dateValue(shiftDate),status:{in:['PENDING','APPROVED']}}})) issues.push('ATTENDANCE_CORRECTION_EXISTS');
  return {eligible:issues.length===0,issues,attendanceState,attendanceWarning:version?null:'Attendance is not activated. Leave uses the confirmed Karachi calendar; no punches or absences are inferred.',shiftDate,calendarMonth:shiftDate.slice(0,7),startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),timeZone:'Asia/Karachi'};
}
function ensureEligible(check) {
  if (!check.eligible) fail(409,`Leave date unavailable: ${check.issues.join(', ')}. Review the date or contact HR.`,'LEAVE_CONFLICT');
}
async function balance(tx, employeeId, month, now=clock.now()) {
  const rows=await tx.leaveRequest.findMany({where:{employeeId,calendarMonth:month,status:{in:['PENDING','APPROVED']}},select:{status:true}});
  const reserved=rows.filter(r=>r.status==='PENDING').length,used=rows.filter(r=>r.status==='APPROVED').length;
  const expired=month<localParts(now,'Asia/Karachi').date.slice(0,7);
  return {month,allowance:1,reserved,used,available:expired?0:Math.max(0,1-reserved-used),expired,unusedExpired:expired?Math.max(0,1-reserved-used):0};
}
function view(r,user) {
  const future=clock.now()<r.startsAt;
  return {
    id:r.id,employee:{id:r.employee.id,employeeCode:r.employee.employeeCode,fullName:r.employee.fullName},
    shiftDate:dateString(r.shiftDate),month:r.calendarMonth,reason:r.reason,status:r.status,version:r.version,
    paid:true,days:1,classification:'FULL_DAY',startsAt:r.startsAt.toISOString(),endsAt:r.endsAt.toISOString(),
    createdAt:r.createdAt.toISOString(),requestedByUserId:r.requestedByUserId,
    reviewedByUserId:r.reviewedByUserId,reviewedAt:r.reviewedAt?.toISOString()||null,reviewReason:r.reviewReason,
    cancelledByUserId:r.cancelledByUserId,cancelledAt:r.cancelledAt?.toISOString()||null,cancellationReason:r.cancellationReason,
    canWithdraw:r.status==='PENDING'&&future&&r.requestedByUserId===user.id&&r.employee.userId===user.id,
    canReview:r.status==='PENDING'&&user.role==='HR'&&r.requestedByUserId!==user.id&&r.employee.userId!==user.id,
    canCancel:r.status==='APPROVED'&&future&&user.role==='HR'&&r.requestedByUserId!==user.id&&r.employee.userId!==user.id,
    history:(r.history||[]).map(h=>({action:h.action,actorUserId:h.actorUserId,actorName:h.actor.displayName,reason:h.reason,version:h.version,at:h.createdAt.toISOString()})),
  };
}
async function record(tx,request,userId,action,reason) {
  await tx.leaveHistory.create({data:{requestId:request.id,actorUserId:userId,action,reason,version:request.version}});
  await tx.auditLog.create({data:{actorUserId:userId,action:`LEAVE_${action}`,success:true,targetType:'Leave',targetId:request.id,metadata:{version:request.version,shiftDate:dateString(request.shiftDate)}}});
  const recipientIds=['SUBMITTED','WITHDRAWN'].includes(action)
    ? await eligibleReviewers(tx,request.requestedByUserId,request.employee.userId)
    : (request.employee.userId===request.requestedByUserId&&await tx.user.findFirst({where:{id:request.requestedByUserId,status:'ACTIVE',mustChangePassword:false}})?[request.requestedByUserId]:[]);
  await emitEvent(tx,{eventKey:`leave:${request.id}:${action}:${request.version}`,kind:`LEAVE_${action}`,resourceId:request.id,recipientIds,actorUserId:userId,
    title:action==='SUBMITTED'?'Leave request awaiting HR review':action==='WITHDRAWN'?'Leave request withdrawn':'Leave request updated',
    message:['SUBMITTED','WITHDRAWN'].includes(action)?'A leave request has an update for eligible HR reviewers.':'Your leave request has a decision or cancellation update.',type:'LEAVE',link:`/leaves?id=${request.id}`});
}
async function getBalance(userId,month) {
  return transaction(async tx=>{const user=await actor(tx,userId,false),employee=await ownEmployee(tx,user);return {...await balance(tx,employee.id,month),employee,eligibleReviewerCount:(await eligibleReviewers(tx,user.id)).length,timeZone:'Asia/Karachi'};});
}
async function preview(userId,shiftDate) {
  return transaction(async tx=>{const user=await actor(tx,userId,false),employee=await ownEmployee(tx,user);return {...await eligibility(tx,employee.id,shiftDate),balance:await balance(tx,employee.id,shiftDate.slice(0,7)),eligibleReviewerCount:(await eligibleReviewers(tx,user.id)).length};});
}
async function submit(userId,{shiftDate,reason}) {
  return transaction(async tx=>{
    const user=await actor(tx,userId,false),employee=await ownEmployee(tx,user);
    const check=await eligibility(tx,employee.id,shiftDate);ensureEligible(check);
    if (!(await eligibleReviewers(tx,user.id)).length) fail(409,'No other eligible HR reviewer is available. Contact HR; Admin cannot substitute.','NO_HR_REVIEWER');
    const slot=await balance(tx,employee.id,check.calendarMonth);
    if (!slot.available) fail(409,'This month already has a pending or approved leave request.','MONTHLY_ALLOWANCE_RESERVED');
    const request=await tx.leaveRequest.create({data:{employeeId:employee.id,requestedByUserId:user.id,shiftDate:dateValue(shiftDate),calendarMonth:check.calendarMonth,startsAt:new Date(check.startsAt),endsAt:new Date(check.endsAt),reason},include});
    await record(tx,request,user.id,'SUBMITTED',reason);
    return view(await tx.leaveRequest.findUnique({where:{id:request.id},include}),user);
  });
}
async function detail(userId,id,manage=false) {
  return transaction(async tx=>{
    const user=await actor(tx,userId,false),request=await authorized(tx,user,id,manage);
    return {...view(request,user),eligibility:await eligibility(tx,request.employeeId,dateString(request.shiftDate)),eligibleReviewerCount:(await eligibleReviewers(tx,request.requestedByUserId,request.employee.userId)).length};
  });
}
async function list(userId,{page=1,pageSize=20,month,status,employeeId,search,reviewableOnly}={},manage=false) {
  return transaction(async tx=>{
    const user=await actor(tx,userId,false);if (manage) management(user);
    if(reviewableOnly&&(!manage||user.role!=='HR'))fail(403,'The actionable review queue is restricted to HR.','FORBIDDEN');
    const employee=manage?null:await ownEmployee(tx,user);
    const where={...(manage?{}:{employeeId:employee.id,requestedByUserId:user.id}),...(month?{calendarMonth:month}:{}),...(status?{status}:{}),...(manage&&employeeId?{employeeId}:{}),...(manage&&search?{employee:{OR:[{fullName:{contains:search,mode:'insensitive'}},{employeeCode:{contains:search,mode:'insensitive'}}]}}:{})};
    if(reviewableOnly)where.AND=[{status:'PENDING'},{requestedByUserId:{not:user.id}},{employee:{is:{OR:[{userId:null},{userId:{not:user.id}}]}}}];
    const rows=await tx.leaveRequest.findMany({where,include,orderBy:[{shiftDate:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});
    const total=await tx.leaveRequest.count({where});
    return {requests:rows.map(r=>view(r,user)),page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize))};
  });
}
async function transition(userId,id,{expectedVersion,reason,decision},action) {
  return transaction(async tx=>{
    const user=await actor(tx,userId,false),request=await authorized(tx,user,id,action!=='withdraw');
    if (request.version!==expectedVersion) fail(409,'Leave request changed. Reload saved data before another action.','VERSION_CONFLICT');
    if (action!=='withdraw'&&(user.role!=='HR'||[request.requestedByUserId,request.employee.userId].includes(user.id))) fail(403,'A different eligible HR must review or cancel this request.','FORBIDDEN');
    const now=clock.now();let data,event;
    if (action==='review') {
      if (request.status!=='PENDING') fail(409,'Only pending leave can be reviewed.','INVALID_TRANSITION');
      if (decision==='APPROVED') {
        if (request.employee.userId!==request.requestedByUserId || !await tx.user.findFirst({where:{id:request.requestedByUserId,status:'ACTIVE',mustChangePassword:false}})) fail(409,'Requester is no longer eligible. Reject this request and review the employee linkage.','REQUESTER_INELIGIBLE');
        ensureEligible(await eligibility(tx,request.employeeId,dateString(request.shiftDate),now));
      }
      data={status:decision,reviewedByUserId:user.id,reviewedAt:now,reviewReason:reason};event=decision;
    } else {
      if (request.status!==(action==='withdraw'?'PENDING':'APPROVED')) fail(409,'This leave cannot be cancelled through this action.','INVALID_TRANSITION');
      if (now>=request.startsAt) fail(409,'The shift has started. Retrospective cancellation is not supported.','SHIFT_STARTED');
      data={status:'CANCELLED',cancelledByUserId:user.id,cancelledAt:now,cancellationReason:reason};event=action==='withdraw'?'WITHDRAWN':'CANCELLED';
    }
    const updated=await tx.leaveRequest.update({where:{id,version:expectedVersion},data:{...data,version:{increment:1}},include});
    await record(tx,updated,user.id,event,reason);
    return view(await tx.leaveRequest.findUnique({where:{id},include}),user);
  });
}
module.exports={getBalance,preview,submit,detail,list,transition,eligibility};
