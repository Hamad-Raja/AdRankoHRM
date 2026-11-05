"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
test('Announcement and notification security, frozen audiences and real workflow events',{timeout:180000},async t=>{
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';
 let prisma,server,sql;t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect();if(sql)await sql.end();await db.cleanup();console.log('Announcement audit database removed; original Admin unchanged.');});
 prisma=require('../src/config/prisma');const app=require('../app'),ann=require('../src/services/announcement.service'),inbox=require('../src/services/notification.service'),clock=require('../src/utils/notification-clock');
 sql=new Client({connectionString:db.url});await sql.connect();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0],password='Announcement-audit-123!',passwordHash=await require('../src/utils/password').hashPassword(password);
 async function account(role){const u=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',displayName:role+' audit fixture',role,passwordHash,mustChangePassword:false}});const r=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});assert.equal(r.status,200);const body=await r.json();return {...u,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),csrf:body.data.csrfToken};}
 const admin=await account('ADMIN'),hr=await account('HR'),manager=await account('MANAGER'),staff=await account('EMPLOYEE'),unlinked=await account('EMPLOYEE'),disabled=await account('EMPLOYEE'),forcedAdmin=await account('ADMIN');
 await prisma.user.update({where:{id:disabled.id},data:{status:'DISABLED'}});await prisma.user.update({where:{id:forcedAdmin.id},data:{mustChangePassword:true}});
 const unit=(kind,name,extra={})=>prisma.organizationUnit.create({data:{kind,name,actorUserId:admin.id,reason:'Isolated audience fixture',...extra}});
 const dept=await unit('DEPARTMENT','Department'),campaign=await unit('CAMPAIGN','Campaign'),designation=await unit('DESIGNATION','Role'),team=await unit('TEAM','Team',{departmentId:dept.id,campaignId:campaign.id}),emptyTeam=await unit('TEAM','Empty',{departmentId:dept.id,campaignId:campaign.id});
 const employee=await prisma.employee.create({data:{userId:staff.id,employeeCode:'ANN-001',fullName:'Audience employee'}});
 await prisma.organizationAssignment.create({data:{employeeId:employee.id,teamId:team.id,designationId:designation.id,effectiveFrom:new Date('2020-01-01'),actorUserId:admin.id,reason:'Audience fixture'}});
 const input=(extra={})=>({title:'Plain notice',content:'First line\nSecond line <b>literal</b>',priority:'NORMAL',category:'GENERAL',audienceMode:'ALL',audienceRoles:[],audienceTeamIds:[],pinned:false,...extra});
 const action=(a,reason='Explicit lifecycle review')=>({expectedVersion:a.version,reason});
 const publish=async extra=>{const a=await ann.createAnnouncement(hr.id,input(extra));return ann.publishAnnouncement(hr.id,a.id,action(a));};
 async function api(path,{user=hr,method='GET',body,csrf=true,requestOrigin=origin}={}){const r=await fetch(base+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(user?{Cookie:user.cookie}:{}),...(user&&csrf?{'x-csrf-token':user.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),headers:r.headers};}
 let roleNotice,teamNotice;
 await t.test('draft default, strict fields, explicit publication and empty preview',async()=>{
  const r=await api('/announcements',{method:'POST',body:input()});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.status,'DRAFT');assert.equal(await prisma.notification.count(),0);
  assert.equal((await api('/announcements',{method:'POST',body:input({status:'PUBLISHED'})})).status,400);
  assert.equal((await api('/announcements/'+r.body.data.id,{method:'PATCH',body:{...input(),status:'PUBLISHED',expectedVersion:1}})).status,400);
  const empty=await ann.createAnnouncement(hr.id,input({audienceMode:'TEAMS',audienceTeamIds:[emptyTeam.id]}));assert.equal((await ann.previewAudience(hr.id,input({audienceMode:'TEAMS',audienceTeamIds:[emptyTeam.id]}))).recipientCount,0);
  await assert.rejects(ann.publishAnnouncement(hr.id,empty.id,action(empty)),e=>e.code==='EMPTY_AUDIENCE');assert.equal(await prisma.announcementRecipient.count({where:{announcementId:empty.id}}),0);
  assert.equal((await api('/announcements/audience-preview',{method:'POST',body:input()})).status,200);
 });
 await t.test('selected roles include eligible unlinked accounts, exclude disabled and freeze membership',async()=>{
  roleNotice=await publish({audienceMode:'ROLES',audienceRoles:['EMPLOYEE']});
  assert.equal((await ann.getAnnouncement(unlinked.id,roleNotice.id)).id,roleNotice.id);assert.equal(await prisma.announcementRecipient.count({where:{announcementId:roleNotice.id,userId:disabled.id}}),0);
  await assert.rejects(ann.getAnnouncement(manager.id,roleNotice.id),e=>e.statusCode===404);
  await prisma.user.update({where:{id:unlinked.id},data:{role:'MANAGER'}});assert.equal((await ann.getAnnouncement(unlinked.id,roleNotice.id)).id,roleNotice.id);
  const newcomer=await account('EMPLOYEE');await assert.rejects(ann.getAnnouncement(newcomer.id,roleNotice.id),e=>e.statusCode===404);
 });
 await t.test('team/department audiences use dated linked assignments and frozen user IDs',async()=>{
  teamNotice=await publish({audienceMode:'TEAMS',audienceTeamIds:[team.id,team.id]});assert.equal(teamNotice.recipientCount,1);
  await prisma.employee.update({where:{id:employee.id},data:{userId:unlinked.id}});
  assert.equal((await ann.getAnnouncement(staff.id,teamNotice.id)).id,teamNotice.id);await assert.rejects(ann.getAnnouncement(unlinked.id,teamNotice.id),e=>e.statusCode===404);
  const preview=await ann.previewAudience(hr.id,input({audienceMode:'DEPARTMENTS',departmentId:dept.id,audienceRoles:['MANAGER']}));assert.equal(preview.recipientCount,1);
  const future=await prisma.employee.create({data:{employeeCode:'ANN-FUTURE',fullName:'Future member',userId:manager.id}});
  await prisma.organizationAssignment.create({data:{employeeId:future.id,teamId:emptyTeam.id,designationId:designation.id,effectiveFrom:new Date('2030-01-02'),effectiveTo:new Date('2030-01-02'),actorUserId:admin.id,reason:'PKT date boundary'}});
  const before=await prisma.$transaction(tx=>ann.targets(tx,input({audienceMode:'TEAMS',audienceTeamIds:[emptyTeam.id]}),new Date('2030-01-01T18:59:59Z')));assert.equal(before.length,0);
  const after=await prisma.$transaction(tx=>ann.targets(tx,input({audienceMode:'TEAMS',audienceTeamIds:[emptyTeam.id]}),new Date('2030-01-01T19:00:00Z')));assert.deepEqual(after,[manager.id]);
 });
 await t.test('management access is separate; unauthorized reads cannot forge acknowledgement',async()=>{
  assert.equal((await ann.getAnnouncement(hr.id,roleNotice.id,true)).isRecipient,false);await assert.rejects(ann.markAnnouncementRead(hr.id,roleNotice.id),e=>e.statusCode===404);assert.equal(await prisma.announcementRead.count({where:{announcementId:roleNotice.id,userId:hr.id}}),0);
  assert.equal((await api('/announcements/'+roleNotice.id+'/read',{user:manager,method:'POST'})).status,404);
  assert.equal((await api('/announcements/management/list',{user:manager})).status,403);
  assert.equal((await api('/announcements/management/'+roleNotice.id,{user:admin})).status,200);
  assert.equal((await api('/announcements/'+roleNotice.id,{user:admin})).status,404);
 });
 await t.test('published fields, audience, receipts, events and audit history cannot be overwritten/deleted',async()=>{
  await assert.rejects(ann.updateAnnouncement(hr.id,roleNotice.id,{...input(),expectedVersion:roleNotice.version}),e=>e.code==='INVALID_TRANSITION');await assert.rejects(ann.deleteAnnouncement(hr.id,roleNotice.id,action(roleNotice)),e=>e.code==='INVALID_TRANSITION');
  await assert.rejects(sql.query('UPDATE announcements SET content=$2,version=version+1 WHERE id=$1',[roleNotice.id,'Forged content']),e=>e.code==='23514');
  await assert.rejects(sql.query('DELETE FROM announcement_recipients WHERE "announcementId"=$1',[roleNotice.id]),e=>e.code==='23514');
  await assert.rejects(sql.query('DELETE FROM notification_events WHERE "announcementId"=$1',[roleNotice.id]),e=>e.code==='23514');
  await assert.rejects(sql.query('DELETE FROM audit_logs WHERE "targetType"=\'Announcement\' AND "targetId"=$1',[roleNotice.id]),e=>e.code==='23514');
 });
 await t.test('bidirectional read synchronization, original read timestamp and no compliance claim',async()=>{
  const first=await ann.markAnnouncementRead(staff.id,roleNotice.id),again=await ann.markAnnouncementRead(staff.id,roleNotice.id);assert.equal(first.readAt,again.readAt);
  const n=await prisma.notification.findFirst({where:{userId:staff.id,announcementId:roleNotice.id}});assert.equal(n.isRead,true);assert.equal(n.readAt.toISOString(),first.readAt);
  const other=await publish({audienceMode:'ROLES',audienceRoles:['EMPLOYEE']});const notif=await prisma.notification.findFirst({where:{userId:staff.id,announcementId:other.id}});await inbox.markAsRead(staff.id,notif.id);const receipt=await prisma.announcementRead.findUnique({where:{announcementId_userId:{announcementId:other.id,userId:staff.id}}});assert.ok(receipt);assert.equal((await inbox.markAsRead(staff.id,notif.id)).readAt,receipt.readAt.toISOString());
  await assert.rejects(sql.query('UPDATE announcement_reads SET "readAt"=now() WHERE id=$1',[receipt.id]),e=>e.code==='23514');
  const acks=await ann.getAcknowledgements(hr.id,other.id);assert.match(acks.notice,/not policy acceptance/);assert.equal(acks.totalReads,1);
 });
 await t.test('private inbox ownership, soft dismissal, read clearing and stable delivery uniqueness',async()=>{
  const n=await prisma.notification.findFirst({where:{userId:staff.id,announcementId:teamNotice.id}});
  assert.equal((await api('/notifications/'+n.id+'/read',{user:admin,method:'PATCH'})).status,404);assert.equal((await api('/notifications/'+n.id,{user:admin,method:'DELETE'})).status,404);
  await inbox.deleteNotification(staff.id,n.id);assert.ok((await prisma.notification.findUnique({where:{id:n.id}})).dismissedAt);
  const event=await prisma.notificationEvent.findUnique({where:{id:n.eventId}});const before=await prisma.notification.count({where:{eventId:event.id}});
  await prisma.$transaction(tx=>inbox.emitEvent(tx,{eventKey:event.eventKey,kind:event.kind,resourceId:event.resourceId,announcementId:teamNotice.id,recipientIds:[staff.id,unlinked.id],title:'New announcement',message:'Notice',type:'ANNOUNCEMENT',link:`/announcements?id=${teamNotice.id}`}));assert.equal(await prisma.notification.count({where:{eventId:event.id}}),before);
  await ann.markAnnouncementRead(staff.id,teamNotice.id);await inbox.clearReadNotifications(staff.id);assert.equal(await prisma.announcementRead.count({where:{announcementId:teamNotice.id,userId:staff.id}}),1);
  assert.equal((await api('/notifications/read',{user:staff,method:'DELETE'})).status,200);
 });
 await t.test('concurrent publication/edit conflicts do not duplicate frozen deliveries',async()=>{
  const draft=await ann.createAnnouncement(hr.id,input());const result=await Promise.allSettled([1,2].map(()=>ann.publishAnnouncement(hr.id,draft.id,action(draft))));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const published=await ann.getAnnouncement(hr.id,draft.id,true);assert.equal(await prisma.notification.count({where:{announcementId:draft.id}}),published.recipientCount);assert.equal(await prisma.notificationEvent.count({where:{announcementId:draft.id}}),1);
  const editable=await ann.createAnnouncement(hr.id,input());const edits=await Promise.allSettled([1,2].map(i=>ann.updateAnnouncement(hr.id,editable.id,{...input({title:'Draft '+i}),expectedVersion:1})));assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
 });
 await t.test('expiry, search and archive remove feed/detail/count access while preserving history; HOLIDAY is not a calendar mutation',async()=>{
  const before=await prisma.companyHolidayEvent.count(),a=await publish({category:'HOLIDAY',expiresAt:new Date(Date.now()+60000).toISOString(),title:'Expiry needle'});assert.equal(await prisma.companyHolidayEvent.count(),before);
  const n=await prisma.notification.findFirst({where:{announcementId:a.id,userId:staff.id}});const original=clock.now;clock.now=()=>new Date(Date.now()+120000);
  try{assert.equal((await ann.listAnnouncements(staff.id,{search:'Expiry needle'})).total,0);await assert.rejects(ann.getAnnouncement(staff.id,a.id),e=>e.statusCode===404);assert.equal((await inbox.listNotifications(staff.id)).notifications.some(r=>r.id===n.id),false);await assert.rejects(inbox.openNotification(staff.id,n.id),e=>e.statusCode===404);}finally{clock.now=original;}
  const archived=await ann.archiveAnnouncement(hr.id,a.id,action(a,'Superseded notice'));assert.equal(archived.status,'ARCHIVED');await assert.rejects(ann.markAnnouncementRead(staff.id,a.id),e=>e.statusCode===404);assert.equal((await inbox.listNotifications(staff.id)).notifications.some(r=>r.id===n.id),false);assert.equal((await ann.getAnnouncement(hr.id,a.id,true)).archiveReason,'Superseded notice');
  const replacement=await ann.createAnnouncement(hr.id,{...input(),replacesId:a.id});assert.equal(replacement.replacesId,a.id);
  await assert.rejects(ann.createAnnouncement(hr.id,{...input(),replacesId:roleNotice.id}),e=>e.code==='INVALID_TRANSITION');
  assert.equal(await prisma.officeSchedule.count(),0);
 });
 await t.test('clearing an already-read archived delivery preserves its original receipt',async()=>{const a=await publish({title:'Read then archive'});const first=await ann.markAnnouncementRead(staff.id,a.id);await ann.archiveAnnouncement(hr.id,a.id,action(a,'Retired'));await inbox.clearReadNotifications(staff.id);assert.equal((await prisma.announcementRead.findUnique({where:{announcementId_userId:{announcementId:a.id,userId:staff.id}}})).readAt.toISOString(),first.readAt);});
 async function eventFor(userId,key){return prisma.$transaction(tx=>inbox.emitEvent(tx,{eventKey:key,kind:'SYSTEM_FIXTURE',resourceId:randomUUID(),recipientIds:[userId],title:'System notice',message:'Safe message',type:'SYSTEM',link:'/dashboard'}));}
 await t.test('mark-all uses a server cutoff; a concurrently created delivery remains unread',async()=>{
  const old=await eventFor(staff.id,'cutoff-old'),oldRow=await prisma.notification.findFirst({where:{eventId:old.eventId}}),blocker=new Client({connectionString:db.url});await blocker.connect();
  try{await blocker.query('BEGIN');await blocker.query('SELECT id FROM notifications WHERE id=$1 FOR UPDATE',[oldRow.id]);const marking=inbox.markAllAsRead(staff.id);let waiting=false;
   for(let i=0;i<100;i++){waiting=(await sql.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%UPDATE%notifications%') AS waiting")).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(waiting,true,'mark-all reached the row-lock barrier after cutoff selection');const newer=await eventFor(staff.id,'cutoff-new');await blocker.query('COMMIT');await marking;assert.equal((await prisma.notification.findUnique({where:{id:oldRow.id}})).isRead,true);assert.equal((await prisma.notification.findFirst({where:{eventId:newer.eventId}})).isRead,false);
  }finally{await blocker.query('ROLLBACK');await blocker.end();}
 });
 await t.test('strict input, no-store, CSRF, hostile origins, forced password change and disabled accounts',async()=>{
  assert.equal((await api('/notifications',{user:null})).status,401);assert.equal((await api('/notifications',{user:disabled})).status,401);assert.equal((await api('/notifications',{user:forcedAdmin})).status,403);
  assert.equal((await api('/notifications?unreadOnly=garbage',{user:staff})).status,400);assert.equal((await api('/notifications?userId='+admin.id,{user:staff})).status,400);assert.equal((await api('/notifications',{user:staff})).headers.get('cache-control'),'no-store');
  assert.equal((await api('/notifications/mark-all-read',{user:staff,method:'POST',csrf:false})).status,403);assert.equal((await api('/notifications/mark-all-read',{user:staff,method:'POST',requestOrigin:'https://hostile.invalid'})).status,403);
  assert.equal((await api('/announcements',{user:manager,method:'POST',body:input()})).status,403);assert.equal((await api('/announcements',{method:'POST',body:input({category:'UNSUPPORTED'})})).status,400);
  assert.equal(inbox.safeLink('https://hostile.invalid'),null);assert.equal(inbox.safeLink('//hostile.invalid'),null);assert.equal(inbox.safeLink('/dashboard?next=https://hostile.invalid'),null);
 });
 let workflowUser,workflowEmp,correction,payroll;
 await t.test('real attendance submission/review events route to reviewers/requester without private reasons',async()=>{
  workflowUser=await account('EMPLOYEE');workflowEmp=await prisma.employee.create({data:{userId:workflowUser.id,employeeCode:'ANN-WORKFLOW',fullName:'Workflow employee',employmentEpisodes:{create:{startDate:new Date('2020-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2020-01-01')}}}});
  await prisma.officeSchedule.create({data:{effectiveFrom:new Date('2025-12-01'),policy:require('../src/validation/schedule-readiness.validation').confirmedPolicy,actorUserId:hr.id,reason:'Guarded workflow schedule'}});
  const attendance=require('../src/services/attendance.service');correction=await attendance.submitCorrectionRequest(workflowUser.id,{shiftDate:'2026-01-12',requestType:'OTHER',correctedClockIn:'2026-01-12T14:00:00Z',correctedClockOut:'2026-01-13T00:00:00Z',reason:'PRIVATE_CORRECTION_REASON'});
  const e=await prisma.notificationEvent.findUnique({where:{eventKey:`correction:${correction.id}:submitted`}});const deliveries=await prisma.notification.findMany({where:{eventId:e.id}});assert.deepEqual(deliveries.map(n=>n.userId).sort(),[admin.id,hr.id].sort());assert.ok(deliveries.every(n=>!JSON.stringify(n,(_,v)=>typeof v==='bigint'?v.toString():v).includes('PRIVATE_CORRECTION_REASON')));
  await attendance.reviewCorrection(hr.id,correction.id,{decision:'REJECTED',reviewReason:'PRIVATE_REVIEW_REASON',expectedVersion:1});const review=await prisma.notificationEvent.findFirst({where:{kind:'CORRECTION_REVIEWED',resourceId:correction.id}});assert.deepEqual((await prisma.notification.findMany({where:{eventId:review.id}})).map(n=>n.userId),[workflowUser.id]);
 });
 await t.test('real payroll routing, distinct approver restriction and exact private payslip destinations',async()=>{
  const pay=require('../src/services/payroll.service');await pay.saveSalary(hr.id,workflowEmp.id,{effectiveMonth:'2026-01',monthlyBasic:'44000',expectedPreviousId:null,reason:'PRIVATE_SALARY_NOTE'});payroll=await pay.createDraft(hr.id,{employeeId:workflowEmp.id,month:'2026-02',totalPayableDays:'22',workedDays:'20',reason:'PRIVATE_PAYROLL_NOTE'});
  payroll=await pay.mutate(hr.id,payroll.id,{expectedVersion:payroll.version,reason:'PRIVATE_HR_REASON'},'hr-approve');let e=await prisma.notificationEvent.findFirst({where:{resourceId:payroll.id,kind:'PAYROLL_HR_APPROVED'}});assert.deepEqual((await prisma.notification.findMany({where:{eventId:e.id}})).map(n=>n.userId),[admin.id]);
  await prisma.user.update({where:{id:hr.id},data:{role:'ADMIN'}});await assert.rejects(pay.mutate(hr.id,payroll.id,{expectedVersion:payroll.version,reason:'Forbidden'},'approve'),r=>r.code==='FORBIDDEN');await prisma.user.update({where:{id:hr.id},data:{role:'HR'}});
  payroll=await pay.mutate(admin.id,payroll.id,{expectedVersion:payroll.version,reason:'PRIVATE_RETURN_REASON'},'return');e=await prisma.notificationEvent.findFirst({where:{resourceId:payroll.id,kind:'PAYROLL_RETURNED'}});assert.deepEqual((await prisma.notification.findMany({where:{eventId:e.id}})).map(n=>n.userId),[hr.id]);
  payroll=await pay.mutate(hr.id,payroll.id,{expectedVersion:payroll.version,reason:'Review again'},'hr-approve');assert.equal(await prisma.notificationEvent.count({where:{resourceId:payroll.id,kind:'PAYROLL_HR_APPROVED'}}),2);
  payroll=await pay.mutate(admin.id,payroll.id,{expectedVersion:payroll.version,reason:'Final approval'},'approve');payroll=await pay.mutate(hr.id,payroll.id,{expectedVersion:payroll.version,reason:'Manual record',method:'BANK_TRANSFER',paidOn:'2026-10-01',reference:'PRIVATE_BANK_REFERENCE',note:'PRIVATE_PAYMENT_NOTE'},'pay');
  const rows=await prisma.notification.findMany({where:{event:{resourceId:payroll.id}}});assert.equal(rows.some(n=>n.userId===manager.id),false);assert.equal(rows.some(n=>/PRIVATE_|44000|40000/.test(n.title+n.message)),false);
  const paid=await prisma.notification.findFirst({where:{userId:workflowUser.id,event:{kind:'PAYROLL_PAID',resourceId:payroll.id}}});assert.equal((await inbox.openNotification(workflowUser.id,paid.id)).link,`/my-payslips?payrollId=${payroll.id}`);
  const adminNotice=rows.find(n=>n.userId===admin.id);await prisma.user.update({where:{id:admin.id},data:{role:'MANAGER'}});await assert.rejects(inbox.openNotification(admin.id,adminNotice.id),r=>r.statusCode===404);await prisma.user.update({where:{id:admin.id},data:{role:'ADMIN'}});
 });
 await t.test('notification/audit failure rolls back domain changes, recipient snapshots and event identities',async()=>{
  const draft=await ann.createAnnouncement(hr.id,input());await sql.query(`CREATE FUNCTION reject_audit_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Intentional delivery failure'; END $$; CREATE TRIGGER module_delivery_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_audit_notification()`);
  try{await assert.rejects(ann.publishAnnouncement(hr.id,draft.id,action(draft)));assert.equal((await ann.getAnnouncement(hr.id,draft.id,true)).status,'DRAFT');assert.equal(await prisma.announcementRecipient.count({where:{announcementId:draft.id}}),0);assert.equal(await prisma.notificationEvent.count({where:{announcementId:draft.id}}),0);
   const pay=require('../src/services/payroll.service');const p=await pay.createDraft(hr.id,{employeeId:workflowEmp.id,month:'2026-03',totalPayableDays:'22',workedDays:'20',reason:'Rollback fixture'});await assert.rejects(pay.mutate(hr.id,p.id,{expectedVersion:p.version,reason:'Review'},'hr-approve'));assert.equal((await pay.detail(hr.id,p.id)).status,'DRAFT');assert.equal(await prisma.auditLog.count({where:{targetId:p.id,action:'PAYROLL_HR_APPROVE'}}),0);
   const attendance=require('../src/services/attendance.service'),before=await prisma.attendanceCorrectionRequest.count();await assert.rejects(attendance.submitCorrectionRequest(workflowUser.id,{shiftDate:'2026-01-13',requestType:'OTHER',correctedClockIn:'2026-01-13T14:00:00Z',correctedClockOut:'2026-01-14T00:00:00Z',reason:'Failure fixture'}));assert.equal(await prisma.attendanceCorrectionRequest.count(),before);
  }finally{await sql.query('DROP TRIGGER module_delivery_failure ON notifications; DROP FUNCTION reject_audit_notification()');}
  await sql.query(`CREATE FUNCTION reject_announcement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ANNOUNCEMENT_PUBLISHED' THEN RAISE EXCEPTION 'Intentional audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER module_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_announcement_audit()`);
  try{await assert.rejects(ann.publishAnnouncement(hr.id,draft.id,action(draft)));assert.equal(await prisma.notificationEvent.count({where:{announcementId:draft.id}}),0);assert.equal(await prisma.notification.count({where:{announcementId:draft.id}}),0);}finally{await sql.query('DROP TRIGGER module_audit_failure ON audit_logs; DROP FUNCTION reject_announcement_audit()');}
 });
});
