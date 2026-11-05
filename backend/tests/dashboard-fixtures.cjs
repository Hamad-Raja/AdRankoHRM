'use strict';
const {assertTestDatabase}=require('./isolated-db');
async function fixtures(prisma){
 assertTestDatabase(process.env.DATABASE_URL);
 const password='Dashboard-fixture-123!',passwordHash=await require('../src/utils/password').hashPassword(password),users={},employees={};
 for(const [key,role] of [['ADMIN','ADMIN'],['HR','HR'],['HR2','HR'],['MANAGER','MANAGER'],['STAFF','EMPLOYEE'],['OTHER','EMPLOYEE'],['UNLINKED','EMPLOYEE'],['EMPTY_MANAGER','MANAGER']])users[key]=await prisma.user.create({data:{email:key.toLowerCase()+'-dashboard@example.invalid',displayName:key+' dashboard fixture',role,passwordHash,mustChangePassword:false}});
 async function profile(key,user=null,status='ACTIVE',start='2029-01-01',end=null){
  const e=await prisma.employee.create({data:{employeeCode:'DASH-'+key,fullName:'Dashboard '+key,...(user?{userId:user.id}:{})}});
  if(status)await prisma.employmentEpisode.create({data:{employeeId:e.id,startDate:new Date(start),status,statusEffectiveDate:new Date(end||start),...(end?{endDate:new Date(end)}:{})}});
  employees[key]=e;return e;
 }
 for(const key of ['HR','HR2','MANAGER','STAFF','OTHER'])await profile(key,users[key],key==='STAFF'?'PROBATION':'ACTIVE');
 for(const key of ['STALE','PAY','DRAFT'])await profile(key);
 await profile('SUSPENDED',null,'SUSPENDED');await profile('EXITED',null,'EXITED','2028-01-01','2029-12-31');await profile('FUTURE',null,'ACTIVE','2031-01-01');await profile('NO_EMPLOYMENT',null,null);
 const episode=await prisma.employmentEpisode.findFirst({where:{employeeId:employees.STAFF.id}});
 await prisma.employmentEpisode.update({where:{id:episode.id},data:{status:'ACTIVE',statusEffectiveDate:new Date('2030-03-02')}});
 await prisma.employmentStatusEvent.create({data:{employmentEpisodeId:episode.id,fromStatus:'PROBATION',toStatus:'ACTIVE',effectiveDate:new Date('2030-03-02'),actorUserId:users.HR.id,reason:'Future fixture transition'}});
 const unit=(kind,name,extra={})=>prisma.organizationUnit.create({data:{kind,name,actorUserId:users.HR.id,reason:'Isolated dashboard organization',...extra}});
 const department=await unit('DEPARTMENT','Dashboard department'),campaign=await unit('CAMPAIGN','Dashboard campaign'),designation=await unit('DESIGNATION','Dashboard role');
 const main=await unit('TEAM','Main dashboard team',{departmentId:department.id,campaignId:campaign.id}),old=await unit('TEAM','Ended dashboard team',{departmentId:department.id,campaignId:campaign.id});
 for(const [team,employee,end] of [[main,employees.STAFF,null],[old,employees.OTHER,'2030-02-28']]){
  await prisma.organizationAssignment.create({data:{employeeId:employee.id,teamId:team.id,designationId:designation.id,effectiveFrom:new Date('2029-01-01'),...(end?{effectiveTo:new Date(end)}:{}),actorUserId:users.HR.id,reason:'Dated fixture employee membership'}});
  await prisma.teamManagerAssignment.create({data:{managerUserId:users.MANAGER.id,teamId:team.id,effectiveFrom:new Date('2029-01-01'),...(end?{effectiveTo:new Date(end)}:{}),actorUserId:users.HR.id,reason:'Dated fixture manager membership'}});
 }
 const pay=require('../src/services/payroll.service'),payroll={};
 for(const key of ['STAFF','OTHER','STALE','PAY','DRAFT','MANAGER'])await pay.saveSalary(users.HR.id,employees[key].id,{effectiveMonth:'2029-01',monthlyBasic:'44000',expectedPreviousId:null,reason:'Guarded salary fixture'});
 async function payrollRecord(key,month,status){
  let p=await pay.createDraft(users.HR.id,{employeeId:employees[key].id,month,totalPayableDays:'22',workedDays:'20',reason:'PRIVATE_PAYROLL_FIXTURE'});
  const action=async name=>{p=await pay.mutate(name==='approve'?users.ADMIN.id:users.HR.id,p.id,{expectedVersion:p.version,reason:'PRIVATE_PAYROLL_REVIEW',...(name==='pay'?{method:'CASH',paidOn:'2026-11-01'}:{})},name);};
  if(status!=='DRAFT')await action('hr-approve');
  if(['APPROVED','PAID'].includes(status))await action('approve');if(status==='PAID')await action('pay');
  payroll[key+month]=p;return p;
 }
 await payrollRecord('STAFF','2030-03','HR_APPROVED');await payrollRecord('STALE','2030-03','HR_APPROVED');await payrollRecord('PAY','2030-03','APPROVED');await payrollRecord('DRAFT','2030-03','DRAFT');
 const same=await payrollRecord('OTHER','2030-03','DRAFT');
 await prisma.user.update({where:{id:users.ADMIN.id},data:{role:'HR'}});
 await pay.mutate(users.ADMIN.id,same.id,{expectedVersion:1,reason:'Fixture same account HR approval'},'hr-approve');await prisma.user.update({where:{id:users.ADMIN.id},data:{role:'ADMIN'}});
 await pay.saveSalary(users.HR.id,employees.STALE.id,{effectiveMonth:'2030-03',monthlyBasic:'45000',expectedPreviousId:null,reason:'Fixture later salary makes review stale'});
 await payrollRecord('STAFF','2030-02','APPROVED');await payrollRecord('MANAGER','2030-02','PAID');await payrollRecord('MANAGER','2030-03','DRAFT');
 const leave=require('../src/services/leave.service'),leaveClock=require('../src/utils/leave-clock'),originalLeaveClock=leaveClock.now;leaveClock.now=()=>new Date('2030-02-01T00:00:00Z');
 const leaves={};try{for(const [key,date] of [['STAFF','2030-03-04'],['HR','2030-03-05'],['HR2','2030-03-06']])leaves[key]=await leave.submit(users[key].id,{shiftDate:date,reason:'PRIVATE_LEAVE_REASON'});}finally{leaveClock.now=originalLeaveClock;}
 const ann=require('../src/services/announcement.service');
 async function announcement(title,audienceRoles,expiresAt=null){let a=await ann.createAnnouncement(users.HR.id,{title,content:'PRIVATE_ANNOUNCEMENT_BODY',category:'GENERAL',priority:'IMPORTANT',audienceMode:'ROLES',audienceRoles,audienceTeamIds:[],pinned:true,...(expiresAt?{expiresAt}:{})});return ann.publishAnnouncement(users.HR.id,a.id,{expectedVersion:a.version,reason:'Isolated dashboard publication'});}
 const visible=await announcement('Dashboard employee notice',['EMPLOYEE','MANAGER']);
 const restricted=await announcement('Restricted HR notice',['HR']);
 const expired=await announcement('Expired dashboard notice',['EMPLOYEE'],'2029-01-01T00:00:00Z');
 const archived=await announcement('Archived dashboard notice',['EMPLOYEE']);await ann.archiveAnnouncement(users.HR.id,archived.id,{expectedVersion:archived.version,reason:'Fixture archive'});
 return {users,employees,password,payroll,leaves,announcements:{visible,restricted,expired,archived}};
}
module.exports={fixtures};
