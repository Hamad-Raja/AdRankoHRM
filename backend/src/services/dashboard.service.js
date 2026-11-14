'use strict';

const prisma = require('../config/prisma');
const {actor, fail} = require('./organization.service');
const {localParts, addDays, missingPolicy} = require('../utils/office-schedule');
const {activeAnnouncement} = require('./notification.service');
const {createReportsService} = require('./reports.service');
const clock = require('../utils/dashboard-clock');
const at = value => new Date(`${value}T00:00:00.000Z`);
const management = user => ['ADMIN','HR'].includes(user.role);

function periods(now) {
  const local = localParts(now,'Asia/Karachi');
  return {today:local.date, dutyDate:local.time<'05:00'?addDays(local.date,-1):local.date,
    leaveMonth:local.date.slice(0,7), timeZone:'Asia/Karachi'};
}
async function read(userId, work) {
  return prisma.$transaction(async tx => {
    // Dashboard refresh is unable to perform business writes, even accidentally.
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const user = await actor(tx,userId,false), now = clock.now();
    return {asOf:now.toISOString(),...periods(now),...await work(tx,user,now)};
  },{isolationLevel:'RepeatableRead',timeout:20000,maxWait:5000});
}

async function employees(userId) {
  return read(userId,async(tx,user,now)=>{
    if (!management(user)&&user.role!=='MANAGER') fail(403,'Employee aggregates require management or dated team scope.','FORBIDDEN');
    const date=at(periods(now).today);
    // One aggregate with a dated status-event lookup, never one query per employee.
    const rows=await tx.$queryRaw`
      WITH scoped AS (
        SELECT p.id FROM employees p WHERE ${management(user)} OR EXISTS (
          SELECT 1 FROM organization_assignments a JOIN team_manager_assignments m ON m."teamId"=a."teamId"
          WHERE a."employeeId"=p.id AND m."managerUserId"=${user.id}::uuid
          AND a."effectiveFrom"<=${date}::date AND (a."effectiveTo" IS NULL OR a."effectiveTo">=${date}::date)
          AND m."effectiveFrom"<=${date}::date AND (m."effectiveTo" IS NULL OR m."effectiveTo">=${date}::date)
        )
      ), classified AS (
        SELECT CASE
          WHEN ep.id IS NULL THEN CASE WHEN EXISTS(SELECT 1 FROM employment_episodes f WHERE f."employeeId"=s.id) THEN 'FUTURE_START' ELSE 'NO_EMPLOYMENT' END
          WHEN ep."endDate"<${date}::date THEN 'EXITED'
          ELSE coalesce(
            (SELECT ev."toStatus"::text FROM employment_status_events ev WHERE ev."employmentEpisodeId"=ep.id AND ev."effectiveDate"<=${date}::date ORDER BY ev."effectiveDate" DESC,ev."createdAt" DESC,ev.id DESC LIMIT 1),
            (SELECT ev."fromStatus"::text FROM employment_status_events ev WHERE ev."employmentEpisodeId"=ep.id AND ev."effectiveDate">${date}::date ORDER BY ev."effectiveDate",ev."createdAt",ev.id LIMIT 1),
            CASE WHEN ep."statusEffectiveDate"<=${date}::date THEN ep.status::text END,'UNKNOWN')
          END AS status
        FROM scoped s LEFT JOIN LATERAL (
          SELECT e.* FROM employment_episodes e WHERE e."employeeId"=s.id AND e."startDate"<=${date}::date ORDER BY e."startDate" DESC,e.id DESC LIMIT 1
        ) ep ON true
      ) SELECT status,count(*)::int AS count FROM classified GROUP BY status`;
    const statuses={ACTIVE:0,PROBATION:0,NOTICE_PERIOD:0,SUSPENDED:0,EXITED:0,FUTURE_START:0,NO_EMPLOYMENT:0,UNKNOWN:0};
    for (const row of rows) statuses[row.status]=row.count;
    const assignedTeams=user.role==='MANAGER'?await tx.teamManagerAssignment.count({where:{managerUserId:user.id,effectiveFrom:{lte:date},OR:[{effectiveTo:null},{effectiveTo:{gte:date}}]}}):null;
    return {scope:management(user)?'ORGANIZATION':'DATED_TEAM',date:periods(now).today,
      totalProfiles:rows.reduce((sum,row)=>sum+row.count,0),eligibleEmployment:statuses.ACTIVE+statuses.PROBATION+statuses.NOTICE_PERIOD,statuses,assignedTeams};
  });
}

async function attendance(userId) {
  return read(userId,async(tx,user,now)=>{
    const {dutyDate}=periods(now);
    if (user.role==='EMPLOYEE'&&!await tx.employee.findUnique({where:{userId:user.id},select:{id:true}})) return {state:'PROFILE_LINK_REQUIRED',metrics:null,scope:'OWN'};
    // Reuse the existing bounded batched reader and its dated authorization and
    // classifications inside this read-only snapshot; no daily-summary N+1 loop.
    const reports=createReportsService({prisma:{$transaction:work=>work(tx)},actor,now:()=>now});
    const result=await reports.getAttendanceReport(user.id,{dateFrom:dutyDate,dateTo:dutyDate,pageSize:'1'});
    const version=await tx.officeSchedule.findFirst({where:{effectiveFrom:{lte:at(dutyDate)}},orderBy:{effectiveFrom:'desc'},select:{policy:true}});
    const policy=version?.policy;
    const confirmed=policy&&!missingPolicy(policy).length&&!(policy.holidayPolicy==='DATES'&&(dutyDate<policy.holidayFrom||dutyDate>policy.holidayTo));
    const totals=result.totals, classes=totals.classifications;
    const unresolved=(classes.SETUP_REQUIRED||0)+(classes.LEGACY_ASSIGNMENT_REVIEW||0);
    return {scope:result.meta.access, state:!confirmed?'SETUP_REQUIRED':result.total===0?'EMPTY_SCOPE':'READY',
      policyState:confirmed?'CONFIRMED_FOR_DUTY':'INACTIVE_OR_INCOMPLETE',
      metrics:{recorded:totals.actualRecords,completed:totals.actualCompleted,open:totals.actualOpen,
        paidLeaveDays:totals.paidLeaveDays,weeklyOff:confirmed&&!unresolved?(classes.WEEKLY_OFF||0):null,holidays:confirmed&&!unresolved?(classes.HOLIDAY||0):null,
        noClockIn:confirmed&&!unresolved?totals.noClockIn:null,setupRequired:classes.SETUP_REQUIRED||0,
        assignmentReview:classes.LEGACY_ASSIGNMENT_REVIEW||0,notEligible:classes.NOT_ELIGIBLE||0,
        missingCheckout:totals.unresolvedMissingCheckout,approvedExceptions:totals.approvedExceptions,late:totals.late},
      definition:'No clock-in means an ended eligible duty without actual attendance, approved exception or paid leave. Flags may overlap; these are not payroll inputs.'};
  });
}

async function queues(userId, month) {
  return read(userId,async(tx,user,now)=>{
    if(!management(user)) fail(403,'Management queues are restricted.','FORBIDDEN');
    const payrollMonth=month||periods(now).leaveMonth;
    const payrollDate=at(payrollMonth+'-01');
    const pendingCorrectionsOverall=await tx.attendanceCorrectionRequest.count({where:{status:'PENDING'}});
    const pendingCorrections=await tx.attendanceCorrectionRequest.count({where:require('../utils/attendance-review').reviewableWhere(user.id)});
    const pendingLeaves=await tx.leaveRequest.count({where:{status:'PENDING'}});
    const payments=await tx.payrollRecord.count({where:{payrollMonth:payrollDate,status:'APPROVED'}});
    const common={payrollMonth,pendingCorrections,pendingCorrectionsOverall,pendingLeavesOverall:pendingLeaves,awaitingManualPayment:payments};
    if(user.role==='HR') {
      const reviewable=await tx.leaveRequest.count({where:{status:'PENDING',requestedByUserId:{not:user.id},employee:{is:{OR:[{userId:null},{userId:{not:user.id}}]}}}});
      return {...common,role:'HR',draftPayroll:await tx.payrollRecord.count({where:{payrollMonth:payrollDate,status:'DRAFT'}}),reviewableLeaves:reviewable};
    }
    const q=await require('./payroll-dashboard-query').payrollQueue(tx,user.id,payrollDate);
    return {...common,role:'ADMIN',hrApprovedPayroll:q.total,eligibleFinalApprovals:q.eligible,
      blockedSameApprover:q.blockedSameApprover,blockedStaleSalary:q.blockedStaleSalary,blockedRevisionLimit:q.blockedRevisionLimit};
  });
}

async function personal(userId) {
  return read(userId,async(tx,user,now)=>{
    const employee=await tx.employee.findUnique({where:{userId:user.id},select:{id:true,employeeCode:true,fullName:true}});
    if(!employee) return {state:'PROFILE_LINK_REQUIRED',leave:null};
    const {leaveMonth}=periods(now);
    const groups=await tx.leaveRequest.groupBy({by:['status'],where:{employeeId:employee.id,calendarMonth:leaveMonth,status:{in:['PENDING','APPROVED']}},_count:{_all:true}});
    const reserved=groups.find(g=>g.status==='PENDING')?._count._all||0, used=groups.find(g=>g.status==='APPROVED')?._count._all||0;
    return {state:'LINKED',employee:{employeeCode:employee.employeeCode,fullName:employee.fullName},
      leave:{month:leaveMonth,allowance:1,reserved,used,available:Math.max(0,1-reserved-used),expired:false,unusedExpired:0}};
  });
}

async function payslip(userId) {
  return read(userId,async(tx,user)=>{
    const employee=await tx.employee.findUnique({where:{userId:user.id},select:{id:true}});
    if(!employee) return {state:'PROFILE_LINK_REQUIRED',latest:null};
    const latest=await tx.payrollRecord.findFirst({where:{employeeId:employee.id,status:{in:['APPROVED','PAID']}},select:{id:true,payrollMonth:true,status:true},orderBy:[{payrollMonth:'desc'},{id:'desc'}]});
    return {state:latest?'AVAILABLE':'EMPTY',latest:latest?{month:latest.payrollMonth.toISOString().slice(0,7),status:latest.status,link:`/my-payslips?payrollId=${latest.id}`}:null};
  });
}

async function announcements(userId) {
  return read(userId,async(tx,user,now)=>{
    const rows=await tx.announcement.findMany({where:activeAnnouncement(user.id,now),select:{id:true,title:true,category:true,priority:true,pinned:true,publishedAt:true,expiresAt:true},orderBy:[{pinned:'desc'},{publishedAt:'desc'},{id:'desc'}],take:5});
    return {items:rows.map(a=>({id:a.id,title:a.title,category:a.category,priority:a.priority,pinned:a.pinned,publishedAt:a.publishedAt.toISOString(),expiresAt:a.expiresAt?.toISOString()||null,link:`/announcements?id=${a.id}`}))};
  });
}
async function adminQueues(userId,month){return read(userId,async(tx,user,now)=>{
 if(user.role!=='ADMIN')fail(403,'Admin dashboard queues require Admin access.','FORBIDDEN');
 const payrollMonth=month||periods(now).leaveMonth;
 const payroll=await require('./payroll-dashboard-query').payrollQueue(tx,user.id,at(payrollMonth+'-01'));
 const paymentsOverall=await tx.payrollRecord.count({where:{payrollMonth:at(payrollMonth+'-01'),status:'APPROVED'}});
 const payments=await tx.payrollRecord.count({where:{payrollMonth:at(payrollMonth+'-01'),status:'APPROVED',version:{lt:2147483647}}});
 const corrections={reviewable:await tx.attendanceCorrectionRequest.count({where:require('../utils/attendance-review').reviewableWhere(user.id)}),overall:await tx.attendanceCorrectionRequest.count({where:{status:'PENDING'}})};
 const employment={reviewable:await tx.employmentCase.count({where:require('../utils/employment-approval').approvalWhere(user.id)}),overall:await tx.employmentCase.count({where:{state:'ADMIN_APPROVAL'}})};
 return {payrollMonth,payroll,payments,paymentsOverall,blockedPaymentsRevisionLimit:paymentsOverall-payments,corrections,employment};
 });}
module.exports={employees,attendance,queues,personal,payslip,announcements,periods,adminQueues};
