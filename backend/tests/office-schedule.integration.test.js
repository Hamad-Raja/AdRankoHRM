"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
const {confirmedPolicy}=require('../src/validation/schedule-readiness.validation');
const {addDays}=require('../src/utils/office-schedule');
test('Scheduling draft, activation and company holiday safety in a guarded database',{timeout:120000},async t=>{
 const database=await createIsolatedDatabase();assertTestDatabase(database.url);process.env.DATABASE_URL=database.url;process.env.NODE_ENV='test';
 const prisma=require('../src/config/prisma'),app=require('../app'),service=require('../src/services/attendance-settings.service');
 const sql=new Client({connectionString:database.url});await sql.connect();const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await prisma.$disconnect();await sql.end();await database.cleanup();t.diagnostic('Temporary database removed; original Admin snapshot unchanged.');});
 const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0],password='Readiness-fixture-123!',passwordHash=await require('../src/utils/password').hashPassword(password);
 async function account(role){const u=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,displayName:role,passwordHash,role,mustChangePassword:false}});const r=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});assert.equal(r.status,200);const p=await r.json();return {...u,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),csrf:p.data.csrfToken};}
 const admin=await account('ADMIN'),hr=await account('HR'),manager=await account('MANAGER'),owner=await account('EMPLOYEE'),outsider=await account('EMPLOYEE');
 async function profile(user,code){return prisma.employee.create({data:{employeeCode:code,fullName:code,userId:user.id,personalEmail:'private@example.invalid',address:'Private HR address',employmentEpisodes:{create:{startDate:new Date('2020-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2020-01-01')}}},include:{employmentEpisodes:true}});}
 const employee=await profile(owner,'READY-OWNER');await profile(manager,'READY-MANAGER');
 async function req(path,{method='GET',user=admin,body,csrf=true}={}){const r=await fetch(base+path,{method,headers:{Origin:origin,...(user?{Cookie:user.cookie}:{}),...(user&&csrf?{'x-csrf-token':user.csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.headers.get('cache-control'),'no-store');return {status:r.status,data:await r.json()};}
 const api='/attendance-settings',why='Approved isolated scheduling fixture';
 async function draft(expectedPreviousId,policy=confirmedPolicy){const r=await req(api+'/draft',{method:'POST',user:hr,body:{expectedPreviousId,policy,reason:why}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.data;}
 let monday='2090-01-01';while(new Date(monday).getUTCDay()!==1)monday=addDays(monday,1);const friday=addDays(monday,4);
 let firstDraft,firstActive,lastDraft,holiday;
 await t.test('authorization, CSRF, strict validation and cross-owner denial',async()=>{
  const body={expectedPreviousId:null,policy:confirmedPolicy,reason:why};
  assert.equal((await req(api,{user:null})).status,401);
  for(const user of [manager,owner]){assert.equal((await req(api,{user})).status,403);for(const route of ['/draft','/activate','/holidays'])assert.equal((await req(api+route,{method:'POST',user,body})).status,403);}
  assert.equal((await req(api+'/draft',{method:'POST',csrf:false,body})).status,403);
  for(const patch of [{effectiveFrom:monday},{policy:{...confirmedPolicy,breakTrackingEnabled:true}},{policy:{...confirmedPolicy,automaticBreakDeduction:true}},{policy:{...confirmedPolicy,breakMinutes:0}},{policy:{...confirmedPolicy,holidayPolicy:'NONE'}},{policy:{...confirmedPolicy,timeZone:'PST'}}])assert.equal((await req(api+'/draft',{method:'POST',body:{...body,...patch}})).status,400);
  assert.equal((await req(api+'/my-shift?employeeId='+employee.id,{user:outsider})).status,400);
  assert.equal((await req(api+'/my-shift/'+employee.id,{user:owner})).status,403);
  assert.equal((await req(api+'/my-shift')).data.data.state,'PROFILE_LINK_REQUIRED');
  assert.equal((await req(api,{method:'POST',body})).status,410);
 });
 await t.test('saved confirmed draft survives reload, remains inactive and does not change employees',async()=>{
  const before=await prisma.employee.findMany({orderBy:{id:'asc'}});firstDraft=await draft(null);lastDraft=firstDraft;
  const settings=(await req(api,{user:hr})).data.data;assert.equal(settings.draft.id,firstDraft.id);assert.deepEqual(settings.draft.policy,confirmedPolicy);assert.equal(settings.draftStatus,'PENDING_ACTIVATION');assert.equal(settings.activeVersion,null);assert.equal(settings.versions.length,0);
  const mine=(await req(api+'/my-shift',{user:owner})).data.data;assert.equal(mine.state,'PENDING_ACTIVATION');assert.equal(mine.current,null);assert.equal(mine.next,null);assert.equal(mine.applicable,null);assert.deepEqual(mine.draftPreview.workDays,[1,2,3,4,5]);
  for(const key of ['Private HR','private@example','actorUserId','passwordHash','reason','employeeId'])assert.equal(JSON.stringify(mine).includes(key),false,key);
  assert.equal(await prisma.employeeShiftAssignment.count(),0);assert.deepEqual(await prisma.employee.findMany({orderBy:{id:'asc'}}),before);
 });
 await t.test('draft revisions reject stale and concurrent saves while preserving earlier revision',async()=>{
  lastDraft=await draft(firstDraft.id);
  assert.equal((await req(api+'/draft',{method:'POST',body:{expectedPreviousId:firstDraft.id,policy:confirmedPolicy,reason:why}})).status,409);
  const r=await Promise.all([1,2].map(()=>req(api+'/draft',{method:'POST',body:{expectedPreviousId:lastDraft.id,policy:confirmedPolicy,reason:why}})));assert.deepEqual(r.map(v=>v.status).sort(),[200,409]);lastDraft=r.find(v=>v.status===200).data.data;
  assert.deepEqual((await prisma.officeScheduleDraft.findUnique({where:{id:firstDraft.id}})).policy,confirmedPolicy);
  await assert.rejects(sql.query('UPDATE office_schedule_drafts SET reason=\'Rewrite\' WHERE id=$1',[firstDraft.id]),e=>e.code==='23514');
 });
 await t.test('activation requires explicit future start, rejects stale drafts, and enforces fixed duty',async()=>{
  const body={draftId:lastDraft.id,expectedPreviousId:null,effectiveFrom:monday,reason:why};
  assert.equal((await req(api+'/activate',{method:'POST',body:{...body,effectiveFrom:undefined}})).status,400);
  assert.equal((await req(api+'/activate',{method:'POST',body:{...body,effectiveFrom:'2000-01-01'}})).status,400);
  assert.equal((await req(api+'/activate',{method:'POST',body:{...body,draftId:firstDraft.id}})).status,409);
  assert.equal((await req(api+'/activate',{method:'POST',body:{...body,effectiveFrom:addDays(monday,5)}})).status,400);
  const r=await req(api+'/activate',{method:'POST',body});assert.equal(r.status,200);firstActive=r.data.data;
  assert.equal(firstActive.startTime,'19:00');assert.equal(firstActive.endTime,'05:00');assert.equal(firstActive.endsNextDay,true);
  const settings=(await req(api)).data.data;assert.equal(settings.draftStatus,'SCHEDULED_ACTIVATION');assert.equal(settings.activeVersion,null);
  const pending=(await req(api+'/my-shift',{user:owner})).data.data;assert.equal(pending.state,'SCHEDULED_ACTIVATION');assert.equal(pending.current,null);assert.equal(pending.next,null);assert.equal(pending.nextSearchDays,366); // 2090 is intentionally outside the bounded current-time search.
  assert.equal((await req(api+'/activate',{method:'POST',body})).status,409);
  await assert.rejects(sql.query('UPDATE office_schedules SET "startTime"=\'20:00\' WHERE id=$1',[firstActive.id]),e=>e.code==='23514');
 });
 await t.test('empty announced list inherits Monday-Friday with no assignments; owner and Manager use own profile',async()=>{
  for(const user of [owner,manager]){const r=await service.myShift(user.id,new Date(friday+'T21:00:00Z'));assert.equal(r.current.scheduleDate,friday);assert.equal(r.current.timeZone,'Asia/Karachi');assert.equal(r.current.graceMinutes,30);assert.equal(r.current.scheduledSpanMinutes,600);assert.equal(r.current.breakTrackingEnabled,false);assert.equal(r.current.automaticBreakDeduction,false);assert.equal(r.current.breakMinutes,null);assert.equal(r.current.breakPaid,null);}
  const off=await service.myShift(owner.id,new Date(addDays(friday,1)+'T14:00:00Z'));assert.equal(off.state,'WEEKLY_OFF');assert.equal(off.current,null);assert.equal(off.next.scheduleDate,addDays(monday,7));assert.equal(await prisma.employeeShiftAssignment.count(),0);
  const linked=await prisma.employee.create({data:{employeeCode:'INELIGIBLE',fullName:'Ineligible fixture',userId:outsider.id}});assert.ok(linked.id);assert.equal((await req(api+'/my-shift',{user:outsider})).data.data.state,'NOT_ELIGIBLE');
 });
 await t.test('announcements, duplicate/concurrent prevention, cancellation and approved holiday history',async()=>{
  const body={holidayDate:friday,expectedPreviousId:null,reason:why};const r=await req(api+'/holidays',{method:'POST',user:hr,body});assert.equal(r.status,200);holiday=r.data.data;
  assert.equal((await service.myShift(owner.id,new Date(friday+'T14:00:00Z'))).state,'HOLIDAY');
  assert.equal((await req(api+'/holidays',{method:'POST',body})).status,409);
  assert.equal((await req(api+'/holidays',{method:'POST',body:{...body,holidayDate:'2090-02-30'}})).status,400);
  assert.equal((await req(api+'/holidays/'+holiday.id+'/cancel',{method:'POST',user:owner,body:{expectedPreviousId:holiday.id,reason:why}})).status,403);
  const cancellations=await Promise.all([1,2].map(()=>req(api+'/holidays/'+holiday.id+'/cancel',{method:'POST',body:{expectedPreviousId:holiday.id,reason:why}})));assert.deepEqual(cancellations.map(v=>v.status).sort(),[200,409]);
  assert.equal((await service.myShift(owner.id,new Date(friday+'T14:00:00Z'))).state,'SCHEDULED');
  const events=await prisma.companyHolidayEvent.findMany({where:{holidayDate:new Date(friday)},orderBy:{revision:'asc'}});assert.deepEqual(events.map(e=>e.action),['ANNOUNCE','CANCEL']);assert.equal(events[0].actorUserId,hr.id);assert.equal(events[0].reason,why);
  await assert.rejects(sql.query('DELETE FROM company_holiday_events WHERE id=$1',[holiday.id]),e=>e.code==='23514');
  const date=addDays(monday,9);const writes=await Promise.all([1,2].map(()=>req(api+'/holidays',{method:'POST',body:{holidayDate:date,expectedPreviousId:null,reason:why}})));assert.deepEqual(writes.map(v=>v.status).sort(),[200,409]);holiday=writes.find(v=>v.status===200).data.data;
 });
 await t.test('already-started duties and historic announcements cannot be changed',async()=>{
  assert.equal((await req(api+'/holidays',{method:'POST',body:{holidayDate:'2000-01-01',expectedPreviousId:null,reason:why}})).status,409);
  const old=await prisma.companyHolidayEvent.create({data:{holidayDate:new Date('2000-01-01'),revision:1,action:'ANNOUNCE',actorUserId:admin.id,reason:'Historical fixture only'}});
  assert.equal((await req(api+'/holidays/'+old.id+'/cancel',{method:'POST',body:{expectedPreviousId:old.id,reason:why}})).status,409);assert.equal(await prisma.companyHolidayEvent.count({where:{holidayDate:old.holidayDate}}),1);
 });
 await t.test('activation concurrency, inactive draft isolation and ongoing policy transition',async()=>{
  const previous=await prisma.officeScheduleDraft.findFirst({orderBy:{revision:'desc'}});const changed=await draft(previous.id,{...confirmedPolicy,graceMinutes:35});
  const before=await service.myShift(owner.id,new Date(friday+'T21:00:00Z'));assert.equal(before.current.graceMinutes,30);
  const starts=addDays(friday,3);const requests=await Promise.all([starts,addDays(starts,1)].map(effectiveFrom=>req(api+'/activate',{method:'POST',body:{draftId:changed.id,expectedPreviousId:firstActive.id,effectiveFrom,reason:why}})));assert.deepEqual(requests.map(v=>v.status).sort(),[200,409]);
  const after=await service.myShift(owner.id,new Date(friday+'T21:00:00Z'));assert.equal(after.current.graceMinutes,30);assert.equal(after.current.scheduleDate,friday);assert.equal((await prisma.officeSchedule.findUnique({where:{id:firstActive.id}})).policy.graceMinutes,30);
 });
 await t.test('draft, activation, holiday approval and cancellation audit failures roll back completely',async()=>{
  const latest=await prisma.officeScheduleDraft.findFirst({orderBy:{revision:'desc'}}),fresh=await draft(latest.id);const active=await prisma.officeSchedule.findFirst({orderBy:{effectiveFrom:'desc'}});
  const before={drafts:await prisma.officeScheduleDraft.count(),policies:await prisma.officeSchedule.count(),events:await prisma.companyHolidayEvent.count()};
  await sql.query("ALTER TABLE audit_logs ADD CONSTRAINT readiness_test_audit_failure CHECK(action NOT IN ('OFFICE_SCHEDULE_DRAFT_SAVED','OFFICE_SCHEDULE_CONFIGURED','COMPANY_HOLIDAY_ANNOUNCED','COMPANY_HOLIDAY_CANCELLED')) NOT VALID");
  try{
   assert.equal((await req(api+'/draft',{method:'POST',body:{expectedPreviousId:fresh.id,policy:confirmedPolicy,reason:why}})).status,500);
   assert.equal((await req(api+'/activate',{method:'POST',body:{draftId:fresh.id,expectedPreviousId:active.id,effectiveFrom:addDays(monday,42),reason:why}})).status,500);
   assert.equal((await req(api+'/holidays',{method:'POST',body:{holidayDate:addDays(monday,41),expectedPreviousId:null,reason:why}})).status,500);
   assert.equal((await req(api+'/holidays/'+holiday.id+'/cancel',{method:'POST',body:{expectedPreviousId:holiday.id,reason:why}})).status,500);
  }finally{await sql.query('ALTER TABLE audit_logs DROP CONSTRAINT readiness_test_audit_failure');}
  assert.deepEqual({drafts:await prisma.officeScheduleDraft.count(),policies:await prisma.officeSchedule.count(),events:await prisma.companyHolidayEvent.count()},before);
 });
 await t.test('legacy assignment and applied common-policy history remain preserved',async()=>{
  const shift=await prisma.shiftDefinition.create({data:{name:'Legacy fixture',timeZone:'Asia/Karachi',startTime:'20:00',endTime:'05:00',endsNextDay:true,workDays:[1,2,3,4,5],breakMinutes:0,breakPaid:null,graceMinutes:0,actorUserId:admin.id,reason:why}});
  const assignment=await prisma.employeeShiftAssignment.create({data:{employeeId:employee.id,employmentEpisodeId:employee.employmentEpisodes[0].id,shiftId:shift.id,effectiveFrom:new Date(monday),actorUserId:admin.id,reason:why}});
  assert.equal((await service.myShift(owner.id,new Date(friday+'T14:00:00Z'))).state,'LEGACY_ASSIGNMENT_REVIEW');assert.deepEqual(await prisma.employeeShiftAssignment.findUnique({where:{id:assignment.id}}),assignment);
  assert.equal((await req('/shifts',{method:'POST',body:{}})).status,410);assert.equal((await req('/shifts/employees/'+employee.id+'/assignments')).data.data.assignments.length,1);
 });
});
