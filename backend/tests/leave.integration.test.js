'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');

test('Leave policy, authorization, concurrency and transactional integrations',{timeout:180000},async t=>{
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';
 let prisma,sql,server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect();if(sql)await sql.end();await db.cleanup();console.log('Leave fixtures/database removed; original Admin unchanged.');});
 prisma=require('../src/config/prisma');sql=new Client({connectionString:db.url});await sql.connect();
 const app=require('../app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0];
 const service=require('../src/services/leave.service'),clock=require('../src/utils/leave-clock'),attendance=require('../src/services/attendance.service');
 const originalClock=clock.now;let now=new Date('2030-02-01T18:59:59Z');clock.now=()=>now;t.after(()=>{clock.now=originalClock;});
 const password='Leave-audit-fixture-123!',passwordHash=await require('../src/utils/password').hashPassword(password);
 async function account(role,linked=true){
  const u=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',displayName:role+' fixture',role,passwordHash,mustChangePassword:false}});
  if(linked){u.employee=await prisma.employee.create({data:{userId:u.id,employeeCode:randomUUID().slice(0,16),fullName:role+' leave employee'}});await prisma.employmentEpisode.create({data:{employeeId:u.employee.id,startDate:new Date('2029-01-01'),status:'PROBATION',statusEffectiveDate:new Date('2029-01-01')}});}
  const r=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});assert.equal(r.status,200);const body=await r.json();
  return {...u,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:body.data.csrfToken};
 }
 const hr=await account('HR'),otherHr=await account('HR'),admin=await account('ADMIN'),staff=await account('EMPLOYEE'),other=await account('EMPLOYEE'),manager=await account('MANAGER'),unlinked=await account('EMPLOYEE',false);
 async function api(path,{user=staff,method='GET',body,csrf=true,requestOrigin=origin}={}){const r=await fetch(base+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(user?{Cookie:user.cookie}:{}),...(user&&csrf?{'x-csrf-token':user.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),headers:r.headers};}
 const request=(user,date,reason='PRIVATE_LEAVE_REASON')=>service.submit(user.id,{shiftDate:date,reason});
 const act=(r,extra={})=>({expectedVersion:r.version,reason:'PRIVATE_REVIEW_REASON',...extra});
 const approve=(r,user=hr)=>service.transition(user.id,r.id,act(r,{decision:'APPROVED'}),'review');
 let leave;
 await t.test('strict full-day ownership/date input, CSRF and role access',async()=>{
  for(const extra of [{days:0.5},{paid:false},{type:'SICK'},{employeeId:other.employee.id},{status:'APPROVED'},{createdAt:'2030-01-01'},{calendarMonth:'2030-02'}])assert.equal((await api('/leaves',{method:'POST',body:{shiftDate:'2030-03-01',reason:'Valid',...extra}})).status,400);
  for(const date of ['2030-02-30','bad','0000-01-01'])assert.equal((await api('/leaves',{method:'POST',body:{shiftDate:date,reason:'Valid'}})).status,400);
  assert.equal((await api('/leaves',{method:'POST',body:{shiftDate:'2030-03-01',reason:'Valid'},csrf:false})).status,403);
  assert.equal((await api('/leaves',{method:'POST',body:{shiftDate:'2030-03-01',reason:'Valid'},requestOrigin:'https://hostile.invalid'})).status,403);
  assert.equal((await api('/leaves?employeeId='+other.employee.id)).status,400);
  assert.equal((await api('/leaves/management',{user:manager})).status,403);
  assert.equal((await api('/leaves/balance?month=2030-03',{user:unlinked})).body.code,'PROFILE_LINK_REQUIRED');
  const r=await api('/leaves/balance?month=2030-03');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 });
 await t.test('confirmed inactive calendar, one monthly reservation and Friday overnight date month',async()=>{
  assert.equal(await prisma.officeSchedule.count(),0);assert.equal(await prisma.payrollRecord.count(),0);
  const preview=await service.preview(staff.id,'2030-03-01');assert.equal(preview.eligible,true);assert.equal(preview.attendanceState,'SETUP_REQUIRED');
  leave=await request(staff,'2030-03-01');assert.equal(leave.status,'PENDING');assert.equal(leave.month,'2030-03');assert.equal(leave.days,1);assert.equal(leave.paid,true);assert.equal(leave.startsAt,'2030-03-01T14:00:00.000Z');assert.equal(leave.endsAt,'2030-03-02T00:00:00.000Z');
  assert.deepEqual(Object.fromEntries(Object.entries(await service.getBalance(staff.id,'2030-03')).filter(([k])=>['reserved','used','available'].includes(k))),{reserved:1,used:0,available:0});
  await assert.rejects(request(staff,'2030-03-04'),e=>e.statusCode===409);
  assert.equal((await service.getBalance(staff.id,'2030-04')).available,1);assert.equal(await prisma.attendanceRecord.count(),0);
 });
 await t.test('private ownership, HR-only review, self-review and expected versions',async()=>{
  assert.equal((await api('/leaves/'+leave.id,{user:other})).status,404);
  assert.equal((await api('/leaves/'+leave.id+'/review',{user:admin,method:'POST',body:act(leave,{decision:'APPROVED'})})).status,403);
  await assert.rejects(service.transition(hr.id,leave.id,act(leave,{expectedVersion:99,decision:'APPROVED'}),'review'),e=>e.code==='VERSION_CONFLICT');
  const own=await request(hr,'2030-03-04');await assert.rejects(approve(own,hr),e=>e.statusCode===403);await approve(own,otherHr);
  await prisma.user.update({where:{id:otherHr.id},data:{mustChangePassword:true}});
  const ownLater=await service.preview(hr.id,'2030-04-01');assert.equal(ownLater.eligibleReviewerCount,0);
  await assert.rejects(request(hr,'2030-04-01'),e=>e.code==='NO_HR_REVIEWER');
  await prisma.user.update({where:{id:otherHr.id},data:{mustChangePassword:false}});
 });
 await t.test('rejection, withdrawal and approved cancellation release once and retain history',async()=>{
  leave=await service.transition(hr.id,leave.id,act(leave,{decision:'REJECTED'}),'review');assert.equal(leave.history.length,2);
  assert.equal((await service.getBalance(staff.id,'2030-03')).available,1);
  let r=await request(staff,'2030-03-04');r=await service.transition(staff.id,r.id,act(r),'withdraw');assert.equal(r.status,'CANCELLED');
  await assert.rejects(service.transition(staff.id,r.id,act(r),'withdraw'),e=>e.statusCode===409);
  r=await approve(await request(staff,'2030-03-05'));assert.equal((await service.getBalance(staff.id,'2030-03')).used,1);
  assert.equal((await api('/leaves/'+r.id+'/cancel',{user:staff,method:'POST',body:act(r)})).status,403);
  r=await service.transition(hr.id,r.id,act(r),'cancel');assert.equal(r.history.length,3);assert.equal(r.reviewedByUserId,hr.id);assert.equal((await service.getBalance(staff.id,'2030-03')).used,0);
  await assert.rejects(sql.query('DELETE FROM leave_requests WHERE id=$1',[r.id]));await assert.rejects(sql.query('UPDATE leave_history SET reason=$1 WHERE "requestId"=$2',['tamper',r.id]));
  await assert.rejects(sql.query('UPDATE leave_requests SET "shiftDate"=$1,version=version+1 WHERE id=$2',['2030-03-06',r.id]));
 });
 await t.test('concurrent submissions reserve a single slot and concurrent review has one winner',async()=>{
  const results=await Promise.allSettled([request(staff,'2030-03-06'),request(staff,'2030-03-07')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  leave=results.find(r=>r.status==='fulfilled').value;
  const reviews=await Promise.allSettled([approve(leave,hr),approve(leave,otherHr)]);assert.equal(reviews.filter(r=>r.status==='fulfilled').length,1);leave=reviews.find(r=>r.status==='fulfilled').value;
  assert.equal((await service.getBalance(staff.id,'2030-03')).used,1);assert.equal(await prisma.notificationEvent.count({where:{resourceId:leave.id,kind:'LEAVE_APPROVED'}}),1);
 });
 await t.test('weekly offs, holidays, employment and shift-start restrictions',async()=>{
  for(const date of ['2030-03-02','2030-03-03'])assert.equal((await service.preview(other.id,date)).eligible,false);
  await prisma.companyHolidayEvent.create({data:{holidayDate:new Date('2030-04-01'),action:'ANNOUNCE',revision:1,actorUserId:hr.id,reason:'Isolated holiday'}});
  assert.ok((await service.preview(other.id,'2030-04-01')).issues.includes('COMPANY_HOLIDAY'));
  const episode=await prisma.employmentEpisode.findFirst({where:{employeeId:other.employee.id}});await prisma.employmentEpisode.update({where:{id:episode.id},data:{endDate:new Date('2030-02-28'),status:'EXITED',statusEffectiveDate:new Date('2030-02-28')}});
  assert.ok((await service.preview(other.id,'2030-03-01')).issues.includes('NOT_ELIGIBLE'));
  await prisma.employmentEpisode.update({where:{id:episode.id},data:{endDate:null,status:'PROBATION',statusEffectiveDate:new Date('2029-01-01')}});
  now=new Date('2030-03-08T14:00:00Z');await assert.rejects(request(other,'2030-03-08'),e=>e.code==='LEAVE_CONFLICT');now=new Date('2030-02-01T18:59:59Z');
 });
 await t.test('approval rechecks later holidays; approved history and slot survive later changes',async()=>{
  const r=await request(other,'2030-04-02');await prisma.companyHolidayEvent.create({data:{holidayDate:new Date('2030-04-02'),action:'ANNOUNCE',revision:1,actorUserId:hr.id,reason:'Later holiday'}});
  await assert.rejects(approve(r),e=>e.code==='LEAVE_CONFLICT');await service.transition(hr.id,r.id,act(r,{decision:'REJECTED'}),'review');
  await prisma.companyHolidayEvent.create({data:{holidayDate:new Date(leave.shiftDate),action:'ANNOUNCE',revision:1,actorUserId:hr.id,reason:'After approval'}});
  const detail=await service.detail(hr.id,leave.id,true);assert.ok(detail.eligibility.issues.includes('COMPANY_HOLIDAY'));assert.equal(detail.status,'APPROVED');assert.equal((await service.getBalance(staff.id,'2030-03')).used,1);
 });
 await t.test('Karachi month expiry, overnight month anchoring and no retrospective restoration',async()=>{
  const r=await request(other,'2030-05-31');assert.equal(r.endsAt,'2030-06-01T00:00:00.000Z');assert.equal(r.month,'2030-05');
  now=new Date('2030-02-28T19:00:00Z');assert.equal((await service.getBalance(other.id,'2030-02')).expired,true);assert.equal((await service.getBalance(other.id,'2030-03')).available,1);
  now=new Date(leave.startsAt);await assert.rejects(service.transition(hr.id,leave.id,act(leave),'cancel'),e=>e.code==='SHIFT_STARTED');assert.equal((await service.getBalance(staff.id,'2030-03')).used,1);now=new Date('2030-02-01T18:59:59Z');
 });
 await t.test('approved leave appears without punches in scoped reports, summaries and clock',async()=>{
  const report=await require('../src/services/reports.service').getAttendanceReport(staff.id,{month:'2030-03',status:'PAID_LEAVE'});assert.equal(report.total,1);assert.equal(report.rows[0].actual,null);assert.equal(report.rows[0].leaveConflict,true);assert.equal(report.totals.paidLeaveDays,1);assert.equal(report.totals.noClockIn,0);assert.equal(report.totals.actualRecords,0);assert.equal(report.rows[0].reason,undefined);
  const summary=await attendance.getDailySummary(hr.id,leave.shiftDate);assert.equal(summary.classifications.find(r=>r.employee.id===staff.employee.id).classification,'PAID_LEAVE');
  const clockStatus=await attendance.getAttendanceStatus(staff.id,new Date(leave.startsAt));assert.equal(clockStatus.state,'PAID_LEAVE');assert.equal(clockStatus.canClockIn,false);assert.equal(clockStatus.attendance,null);
  assert.equal(await prisma.officeSchedule.count(),0);assert.equal(await prisma.attendanceRecord.count(),0);assert.equal(await prisma.payrollRecord.count(),0);
 });
 await t.test('notification recipients, privacy, replay and click-time role/ownership authorization',async()=>{
  const event=await prisma.notificationEvent.findUnique({where:{eventKey:`leave:${leave.id}:SUBMITTED:1`},include:{notifications:true}});assert.deepEqual(new Set(event.notifications.map(n=>n.userId)),new Set([hr.id,otherHr.id]));
  assert.ok(event.notifications.every(n=>!JSON.stringify(n,(_,v)=>typeof v==='bigint'?String(v):v).includes('PRIVATE_')));
  const inbox=require('../src/services/notification.service');const notification=event.notifications.find(n=>n.userId===hr.id);
  assert.equal((await inbox.openNotification(hr.id,notification.id)).link,`/leaves?id=${leave.id}`);
  await prisma.user.update({where:{id:hr.id},data:{role:'ADMIN'}});await assert.rejects(inbox.openNotification(hr.id,notification.id),e=>e.statusCode===404);await prisma.user.update({where:{id:hr.id},data:{role:'HR'}});
  await assert.rejects(inbox.openNotification(other.id,notification.id),e=>e.statusCode===404);
  const lostLink=await request(other,'2030-10-01');await prisma.employee.update({where:{id:other.employee.id},data:{userId:null}});
  await assert.rejects(approve(lostLink),e=>e.code==='REQUESTER_INELIGIBLE');
  await service.transition(hr.id,lostLink.id,act(lostLink,{decision:'REJECTED'}),'review');
  const eventWithoutDelivery=await prisma.notificationEvent.findUnique({where:{eventKey:`leave:${lostLink.id}:REJECTED:2`},include:{notifications:true}});assert.equal(eventWithoutDelivery.notifications.length,0);
  await prisma.employee.update({where:{id:other.employee.id},data:{userId:other.id}});
 });
 await t.test('delivery/audit failure rolls back leave, history and monthly reservation',async()=>{
  const pending=await request(manager,'2030-07-01');
  await sql.query(`CREATE FUNCTION reject_leave_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type::text='LEAVE' THEN RAISE EXCEPTION 'Intentional leave delivery failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_leave_delivery BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_leave_delivery()`);
  const before=await prisma.leaveRequest.count(),events=await prisma.notificationEvent.count(),history=await prisma.leaveHistory.count();await assert.rejects(request(other,'2030-07-01'));assert.equal(await prisma.leaveRequest.count(),before);assert.equal(await prisma.leaveHistory.count(),history);assert.equal(await prisma.notificationEvent.count(),events);assert.equal((await service.getBalance(other.id,'2030-07')).available,1);
  await assert.rejects(approve(pending));assert.equal((await prisma.leaveRequest.findUnique({where:{id:pending.id}})).status,'PENDING');assert.equal(await prisma.leaveHistory.count(),history);assert.equal(await prisma.notificationEvent.count(),events);
  await sql.query('DROP TRIGGER reject_leave_delivery ON notifications');
  await sql.query(`CREATE FUNCTION reject_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."targetType"='Leave' THEN RAISE EXCEPTION 'Intentional leave audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_leave_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_leave_audit()`);
  await assert.rejects(request(other,'2030-07-01'));assert.equal(await prisma.leaveRequest.count(),before);assert.equal(await prisma.leaveHistory.count(),history);await sql.query('DROP TRIGGER reject_leave_audit ON audit_logs');
 });
 await t.test('active-policy clock-in and correction conflicts, no payroll mutation',async()=>{
  await prisma.officeSchedule.create({data:{effectiveFrom:new Date('2029-01-01'),policy:require('../src/validation/schedule-readiness.validation').confirmedPolicy,actorUserId:hr.id,reason:'Isolated active schedule only'}});
  const r=await approve(await request(other,'2030-08-01'));await assert.rejects(attendance.clockIn(other.id,randomUUID(),new Date(r.startsAt)),e=>e.code==='APPROVED_PAID_LEAVE');
  const employee=manager.employee;await attendance.clockIn(manager.id,randomUUID(),new Date('2030-08-02T14:00:00Z'));assert.ok((await service.preview(manager.id,'2030-08-02')).issues.includes('ATTENDANCE_EXISTS'));
  assert.equal(await prisma.employeeSalaryVersion.count(),0);assert.equal(await prisma.payrollRecord.count(),0);assert.equal(await prisma.payrollPayment.count(),0);
  const racer=await account('EMPLOYEE'),pending=await request(racer,'2030-09-02');
  const outcomes=await Promise.allSettled([approve(pending),attendance.clockIn(racer.id,randomUUID(),new Date(pending.startsAt))]);
  assert.ok(outcomes.some(r=>r.status==='fulfilled'));
  const approved=await prisma.leaveRequest.count({where:{id:pending.id,status:'APPROVED'}}),punched=await prisma.attendanceRecord.count({where:{employeeId:racer.employee.id}});
  assert.ok(!(approved&&punched),'concurrent approval and punch must not coexist');
 });
 await t.test('disabled and password-restricted accounts cannot mutate leave',async()=>{
  await prisma.user.update({where:{id:other.id},data:{mustChangePassword:true}});assert.equal((await api('/leaves/balance?month=2030-09',{user:other})).status,403);
  await prisma.user.update({where:{id:other.id},data:{mustChangePassword:false,status:'DISABLED'}});assert.equal((await api('/leaves',{user:other})).status,401);
 });
});
