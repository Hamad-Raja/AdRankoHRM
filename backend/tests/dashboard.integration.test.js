'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
test('Role dashboard aggregates, dated scopes and read-only privacy',{timeout:180000},async t=>{
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';let prisma,server,sql;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect();if(sql)await sql.end();await db.cleanup();console.log('Dashboard database removed; original Admin unchanged.');});
 prisma=require('../src/config/prisma');sql=new Client({connectionString:db.url});await sql.connect();
 const f=await require('./dashboard-fixtures.cjs').fixtures(prisma),service=require('../src/services/dashboard.service'),clock=require('../src/utils/dashboard-clock'),originalClock=clock.now;
 let now=new Date('2030-02-28T21:00:00Z');clock.now=()=>now;t.after(()=>{clock.now=originalClock;});
 const app=require('../app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0],sessions={};
 for(const key of Object.keys(f.users)){const r=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.users[key].email,password:f.password})});assert.equal(r.status,200);sessions[key]=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
 async function api(path,key='STAFF'){const r=await fetch(base+path,{headers:{Cookie:sessions[key]||'',Origin:origin}});return {status:r.status,body:await r.json(),headers:r.headers};}
 await t.test('strict session-based role and ownership authorization for all roles',async()=>{
  for(const key of ['ADMIN','HR','MANAGER','STAFF']){for(const section of ['attendance','personal','payslip','announcements'])assert.equal((await api('/dashboard/'+section,key)).status,200);assert.equal((await api('/dashboard/queues',key)).status,['ADMIN','HR'].includes(key)?200:403);assert.equal((await api('/dashboard/employees',key)).status,key==='STAFF'?403:200);}
  for(const query of ['role=ADMIN','employeeId='+f.employees.OTHER.id,'userId='+f.users.OTHER.id,'month=2030-02'])assert.equal((await api('/dashboard/personal?'+query)).status,400);
  assert.equal((await api('/dashboard/queues?month=bad','ADMIN')).status,400);assert.equal((await api('/dashboard/personal','missing')).status,401);assert.equal((await api('/dashboard/personal')).headers.get('cache-control'),'no-store');
 });
 await t.test('dated employment counts distinguish users, probation, future and absent history',async()=>{
  const a=await service.employees(f.users.ADMIN.id);assert.equal(a.totalProfiles,12);assert.equal(a.statuses.PROBATION,1);assert.equal(a.statuses.ACTIVE,7);assert.equal(a.statuses.SUSPENDED,1);assert.equal(a.statuses.EXITED,1);assert.equal(a.statuses.FUTURE_START,1);assert.equal(a.statuses.NO_EMPLOYMENT,1);assert.equal(a.eligibleEmployment,8);assert.equal(a.date,'2030-03-01');
  assert.equal(JSON.stringify(a).includes('PRIVATE_'),false);assert.equal(a.employees,undefined);
 });
 await t.test('manager headcount is current dated team only; overnight attendance uses duty date and own scope',async()=>{
  const e=await service.employees(f.users.MANAGER.id),a=await service.attendance(f.users.MANAGER.id);assert.equal(e.totalProfiles,1);assert.equal(e.assignedTeams,1);assert.equal(e.scope,'DATED_TEAM');assert.equal(a.scope,'DATED_TEAM_AND_OWN');assert.equal(a.dutyDate,'2030-02-28');assert.equal(a.metrics.setupRequired,3);assert.equal(a.metrics.noClockIn,null);
  now=new Date('2030-03-01T01:00:00Z');assert.equal((await service.attendance(f.users.MANAGER.id)).metrics.setupRequired,2);now=new Date('2030-02-28T21:00:00Z');
  const empty=await service.employees(f.users.EMPTY_MANAGER.id);assert.equal(empty.totalProfiles,0);assert.equal(empty.assignedTeams,0);
 });
 await t.test('inactive scheduling produces unknown absence, never fabricated rates or duty totals',async()=>{
  assert.equal(await prisma.officeSchedule.count(),0);const a=await service.attendance(f.users.ADMIN.id);assert.equal(a.state,'SETUP_REQUIRED');assert.equal(a.metrics.noClockIn,null);assert.equal(a.metrics.recorded,0);assert.equal(a.presentRate,undefined);assert.equal(a.metrics.scheduledDays,undefined);
  const summary=await require('../src/services/attendance.service').getDailySummary(f.users.ADMIN.id,a.dutyDate);
  const reports=await require('../src/services/reports.service').getAttendanceReport(f.users.ADMIN.id,{dateFrom:a.dutyDate,dateTo:a.dutyDate,pageSize:'100'});
  const classified=new Map(reports.rows.map(r=>[r.employee.id,r.classification]));assert.ok(summary.classifications.every(r=>classified.get(r.employee.id)===r.classification),'daily summary and reports must interpret dated employment and inactive setup identically');
 });
 await t.test('unlinked personal states do not block management, manager scope or other widgets',async()=>{
  for(const key of ['ADMIN','UNLINKED','EMPTY_MANAGER']){assert.equal((await service.personal(f.users[key].id)).state,'PROFILE_LINK_REQUIRED');assert.equal((await service.payslip(f.users[key].id)).latest,null);}
  assert.equal((await service.attendance(f.users.UNLINKED.id)).metrics,null);assert.equal((await service.queues(f.users.ADMIN.id)).role,'ADMIN');
 });
 await t.test('Admin final queue excludes same approver and stale salary; HR receives no final action fields',async()=>{
  const admin=await service.queues(f.users.ADMIN.id,'2030-03');assert.equal(admin.hrApprovedPayroll,3);assert.equal(admin.eligibleFinalApprovals,1);assert.equal(admin.blockedSameApprover,1);assert.equal(admin.blockedStaleSalary,1);assert.equal(admin.awaitingManualPayment,1);assert.equal(admin.draftPayroll,undefined);
  const hr=await service.queues(f.users.HR.id,'2030-03');assert.equal(hr.draftPayroll,2);assert.equal(hr.eligibleFinalApprovals,undefined);assert.equal(hr.reviewableLeaves,2);assert.equal(hr.pendingLeavesOverall,3);assert.equal(hr.awaitingManualPayment,1);assert.equal((await service.queues(f.users.ADMIN.id,'2030-04')).hrApprovedPayroll,0);
 });
 await t.test('reviewable leave destination exactly matches HR count and denies Admin review filters',async()=>{
  const result=await api('/leaves/management?status=PENDING&reviewableOnly=true','HR');assert.equal(result.status,200);assert.equal(result.body.data.total,2);assert.ok(result.body.data.requests.every(r=>r.requestedByUserId!==f.users.HR.id&&r.canReview));assert.equal((await api('/leaves/management?reviewableOnly=true','ADMIN')).status,403);
  await prisma.employee.update({where:{id:f.employees.HR.id},data:{userId:null}});await prisma.employee.update({where:{id:f.employees.STAFF.id},data:{userId:f.users.HR.id}});
  assert.equal((await service.queues(f.users.HR.id,'2030-03')).reviewableLeaves,1);assert.equal((await api('/leaves/management?status=PENDING&reviewableOnly=true','HR')).body.data.total,1);
  await prisma.employee.update({where:{id:f.employees.STAFF.id},data:{userId:f.users.STAFF.id}});await prisma.employee.update({where:{id:f.employees.HR.id},data:{userId:f.users.HR.id}});
 });
 await t.test('own payslip visibility includes final statuses only and rechecks current linkage',async()=>{
  const a=await service.payslip(f.users.STAFF.id);assert.equal(a.latest.month,'2030-02');assert.equal(a.latest.status,'APPROVED');assert.equal(a.latest.netPay,undefined);const m=await service.payslip(f.users.MANAGER.id);assert.equal(m.latest.status,'PAID');assert.equal(m.latest.month,'2030-02');
  await prisma.employee.update({where:{id:f.employees.STAFF.id},data:{userId:null}});assert.equal((await service.payslip(f.users.STAFF.id)).latest,null);await prisma.employee.update({where:{id:f.employees.STAFF.id},data:{userId:f.users.STAFF.id}});
 });
 await t.test('current-month leave separates reserved/used/available and has no carry-forward',async()=>{
  const p=await service.personal(f.users.STAFF.id);assert.deepEqual(p.leave,{month:'2030-03',allowance:1,reserved:1,used:0,available:0,expired:false,unusedExpired:0});assert.equal(p.reason,undefined);
  now=new Date('2030-03-31T19:00:00Z');const april=await service.personal(f.users.STAFF.id);assert.equal(april.leave.month,'2030-04');assert.equal(april.leave.available,1);assert.equal((await service.attendance(f.users.STAFF.id)).dutyDate,'2030-03-31');now=new Date('2030-02-28T21:00:00Z');
 });
 await t.test('announcements enforce frozen recipients, expiry/archive and explicit bounded fields',async()=>{
  const s=await service.announcements(f.users.STAFF.id);assert.deepEqual(s.items.map(a=>a.id),[f.announcements.visible.id]);assert.equal(s.items[0].content,undefined);assert.equal(s.items[0].recipientIds,undefined);assert.equal((await service.announcements(f.users.ADMIN.id)).items.length,0);
  await prisma.user.update({where:{id:f.users.STAFF.id},data:{role:'MANAGER'}});assert.equal((await service.announcements(f.users.STAFF.id)).items.length,1);await prisma.user.update({where:{id:f.users.STAFF.id},data:{role:'EMPLOYEE'}});
 });
 await t.test('notification counts are private through the reused inbox API',async()=>{
  const inbox=require('../src/services/notification.service');for(const key of ['ADMIN','HR','MANAGER','STAFF']){const count=await inbox.getUnreadCount(f.users[key].id);const own=await prisma.notification.count({where:{...inbox.activeInbox(f.users[key].id),isRead:false}});assert.equal(count.unreadCount,own);}
 });
 await t.test('ordinary dashboard reads create no receipts, audits, events or business changes',async()=>{
  async function hash(){const parts=[];for(const {tablename} of (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){const rows=(await sql.query(`SELECT row_to_json(t) AS data FROM "${tablename}" t ORDER BY row_to_json(t)::text`)).rows;parts.push([tablename,rows]);}return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');}
  const before=await hash();for(const key of ['ADMIN','HR','MANAGER','STAFF'])for(const section of ['personal','payslip','attendance','announcements',...(['ADMIN','HR'].includes(key)?['queues','employees']:key==='MANAGER'?['employees']:[])])await service[section](f.users[key].id);
  assert.equal(await hash(),before);assert.equal(await prisma.announcementRead.count(),0);
 });
 await t.test('active-policy attendance reuses actual records, paid leave and weekly-off distinctions',async()=>{
  await prisma.officeSchedule.create({data:{effectiveFrom:new Date('2029-01-01'),policy:require('../src/validation/schedule-readiness.validation').confirmedPolicy,actorUserId:f.users.HR.id,reason:'Disposable attendance policy'}});
  const attendance=require('../src/services/attendance.service');const record=await attendance.clockIn(f.users.MANAGER.id,'dashboard-clock-fixture',new Date('2030-03-01T14:00:00Z'));await attendance.clockOut(f.users.MANAGER.id,'dashboard-out-fixture',record.id,new Date('2030-03-01T16:00:00Z'));
  now=new Date('2030-03-01T21:00:00Z');const a=await service.attendance(f.users.MANAGER.id);assert.equal(a.dutyDate,'2030-03-01');assert.equal(a.metrics.recorded,1);assert.equal(a.metrics.completed,1);assert.equal(a.metrics.noClockIn,0);
  now=new Date('2030-03-02T01:00:00Z');assert.ok((await service.attendance(f.users.MANAGER.id)).metrics.weeklyOff>0);now=new Date('2030-02-28T21:00:00Z');
 });
 await t.test('disabled and forced-password accounts cannot obtain aggregate data',async()=>{
  await prisma.user.update({where:{id:f.users.UNLINKED.id},data:{mustChangePassword:true}});assert.equal((await api('/dashboard/personal','UNLINKED')).status,403);await prisma.user.update({where:{id:f.users.UNLINKED.id},data:{mustChangePassword:false,status:'DISABLED'}});assert.equal((await api('/dashboard/personal','UNLINKED')).status,401);
 });
});
