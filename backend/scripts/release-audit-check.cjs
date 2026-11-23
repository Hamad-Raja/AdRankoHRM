'use strict';
// Release checks only: refuses normal DBs, creates synthetic fixtures and uses real HTTP + Chromium.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const database=process.env.RELEASE_TEST_DATABASE_URL;
let target;try{target=new URL(database);}catch{throw Error('RELEASE_TEST_DATABASE_URL must identify a fresh disposable loopback database.');}
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='55439'||!/^officehr_release_test_[a-z0-9_]+$/.test(target.pathname.slice(1)))throw Error('Refusing non-disposable database target.');
Object.assign(process.env,{DATABASE_URL:database,NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5176',OFFICEHR_LOCAL_DEMO_ENABLED:'false',OFFICEHR_PRODUCTION_DEMO_ENABLED:'false'});
const root=path.resolve(__dirname,'../..'),out=path.join(root,'reports','release-audit'),backend=path.resolve(__dirname,'..');
fs.mkdirSync(out,{recursive:true});process.env.DOCUMENT_STORAGE_DIR=path.join(out,'synthetic-documents');
const {chromium}=require(path.join(root,'frontend/node_modules/playwright-core'));
const results=[],accounts={},people={},sessions={},password='Synthetic-'+randomUUID();
let prisma,server,browser,now=new Date('2026-11-24T14:15:00Z');
function result(name,ok,detail){results.push({name,result:ok===null?'SKIP':ok?'PASS':'FAIL',detail});fs.writeFileSync(path.join(out,'functional-results.json'),JSON.stringify(results,null,2));console.log((ok===null?'SKIP ':ok?'PASS ':'FAIL ')+name+(detail?' — '+detail:''));}
async function check(name,work){try{const outcome=await work();result(name,outcome==='SKIP'?null:true);}catch(error){result(name,false,error.message);}}
async function api(key,url,body,method,extra={}){
 const context=sessions[key],cookies=context?await context.cookies('http://localhost:3020'):[],csrf=cookies.find(c=>c.name==='officehr_csrf')?.value;
 const request=context?.request||browser.request;
 const r=await request.fetch('http://localhost:3020/api'+url,{method:method||(body===undefined?'GET':'POST'),...(body===undefined?{}:{data:body}),headers:{origin:process.env.FRONTEND_ORIGIN,...(csrf?{'x-csrf-token':csrf}:{}),...extra}});
 const type=r.headers()['content-type']||'',data=type.includes('json')?await r.json():null;
 return {status:r.status(),data:data?.data,code:data?.code,message:data?.message,raw:r};
}
async function expect(key,url,body,status=200,method,extra){const r=await api(key,url,body,method,extra);assert.equal(r.status,status,url+' '+r.code+' '+r.message);return r.data;}
async function login(key,pass=password){const r=await sessions[key].request.post('http://localhost:3020/api/auth/login',{data:{email:accounts[key].email,password:pass},headers:{origin:process.env.FRONTEND_ORIGIN}});return r.status();}
async function main(){
 const pg=new(require('pg').Client)({connectionString:database});try{await pg.connect();const row=(await pg.query("select current_database() name,host(inet_server_addr()) address,(select count(*) from information_schema.tables where table_schema='public') n")).rows[0];assert.equal(row.name,target.pathname.slice(1));assert.equal(row.address,'127.0.0.1');assert.equal(Number(row.n),0);}finally{await pg.end();}
 const migrate=spawnSync(process.execPath,[path.join(backend,'node_modules/prisma/build/index.js'),'migrate','deploy','--config','prisma7.config.ts'],{cwd:backend,env:process.env,encoding:'utf8'});assert.equal(migrate.status,0,migrate.stderr);result('17 migrations on fresh isolated PostgreSQL',true);
 prisma=require('../src/config/prisma');for(const name of ['attendance','leave','dashboard','employment','notification'])require('../src/utils/'+name+'-clock').now=()=>new Date(now);
 const passwordHash=await require('../src/utils/password').hashPassword(password);
 accounts.admin=await prisma.user.create({data:{email:'admin@release.invalid',displayName:'Synthetic Admin',role:'ADMIN',status:'ACTIVE',mustChangePassword:false,passwordHash}});
 server=await new Promise(resolve=>{const s=require('../app').listen(3020,'127.0.0.1',()=>resolve(s));});
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 sessions.guest=await browser.newContext();
 sessions.admin=await browser.newContext();assert.equal(await login('admin'),200);
 const dept=await expect('admin','/organization',{kind:'DEPARTMENT',name:'Release Department',reason:'Synthetic setup'},201);
 const title=await expect('admin','/organization',{kind:'DESIGNATION',name:'Release Job',reason:'Synthetic setup'},201);
 const campaign=await expect('admin','/organization',{kind:'CAMPAIGN',name:'Release Campaign',departmentId:dept.id,reason:'Synthetic setup'},201);
 const team=await expect('admin','/organization',{kind:'TEAM',name:'Release Team',departmentId:dept.id,campaignId:campaign.id,reason:'Synthetic setup'},201);
 const placement={departmentId:dept.id,campaignId:campaign.id,teamId:team.id,designationId:title.id};
 for(const [key,role] of [['hr','HR'],['hr2','HR'],['manager','MANAGER'],['employee','EMPLOYEE'],['outsider','EMPLOYEE']]){
  const data=await expect('admin','/employees',{employeeCode:'RELEASE-'+key.toUpperCase(),fullName:'Synthetic '+key,employment:{startDate:'2026-01-01',status:'ACTIVE',reason:'Synthetic release fixture'},organization:placement,portalLogin:{email:key+'@release.invalid',password,role}},201);
  const person=data.employee||data;people[key]=person;
  accounts[key]=await prisma.user.findUnique({where:{email:key+'@release.invalid'},select:{id:true,email:true,role:true}});
  if(!person.id)throw Error('Employee creation response missing ID');
  sessions[key]=await browser.newContext({timezoneId:'America/Los_Angeles'});assert.equal(await login(key),200);
 }
 await expect('hr','/organization/teams/'+team.id+'/managers',{managerUserId:accounts.manager.id,effectiveFrom:'2026-01-01',reason:'Synthetic dated manager'},201);
 await expect('hr','/organization/employees/'+people.employee.id+'/assignments',{...placement,reportingManagerId:accounts.manager.id,effectiveFrom:'2026-11-23',reason:'Synthetic manager placement'},201);
 // Keep one fixture outside the manager's dated team.
 const outside=await expect('admin','/organization',{kind:'TEAM',name:'Outside Team',departmentId:dept.id,campaignId:campaign.id,reason:'Synthetic scope'},201);
 await expect('hr','/organization/employees/'+people.outsider.id+'/assignments',{...placement,teamId:outside.id,effectiveFrom:'2026-11-23',reason:'Outside scope'},201);
 await check('Authentication: all four roles, unauthenticated and CSRF/origin rejection',async()=>{
  for(const key of ['admin','hr','manager','employee'])assert.equal((await expect(key,'/auth/me')).user?.role||accounts[key].role,accounts[key].role);
  await expect('guest','/auth/me',undefined,401);
  await expect('hr','/auth/logout',{},403,undefined,{'x-csrf-token':''});
  await expect('employee','/auth/logout',{},403,undefined,{origin:'https://untrusted.invalid'});
 });
 await check('Direct API role gates, own records and manager IDOR',async()=>{
  for(const key of ['manager','employee']){
   await expect(key,'/employees',undefined,403);await expect(key,'/payroll',undefined,403);await expect(key,'/audit',undefined,403);await expect(key,'/attendance-settings',undefined,403);
   await expect(key,'/auth/change-password',{currentPassword:password,newPassword:password+'X'},403);
  }
  await expect('hr','/audit',undefined,403);
  await expect('manager','/organization/scope/employees/'+people.outsider.id,undefined,404);
  await expect('employee','/organization/scope/employees/'+people.outsider.id,undefined,404);
  await expect('employee','/employee-files/'+people.outsider.id+'/documents',undefined,403);
  await expect('manager','/employee-files/'+people.employee.id+'/documents',undefined,403);
 });
 await check('Private filesystem uploads and authorized downloads retain visibility and validation',async()=>{
  const base='/employee-files/'+people.employee.id+'/documents';
  const text='Synthetic private release document';
  const visible=await expect('hr',base+'?title=Synthetic&ownerVisible=true',text,201,'POST',{'content-type':'text/plain'});
  const own=await api('employee',base+'/'+visible.id+'/download');assert.equal(own.status,200);assert.equal((await own.raw.body()).toString(),text);
  await expect('manager',base+'/'+visible.id+'/download',undefined,403);
  const hidden=await expect('admin',base+'?title=Restricted&ownerVisible=false',text,201,'POST',{'content-type':'text/plain'});
  await expect('employee',base+'/'+hidden.id+'/download',undefined,404);
  await expect('hr',base+'?title=Invalid&ownerVisible=true','not png',415,'POST',{'content-type':'image/png'});
  await expect('hr',base+'?title=Invalid&ownerVisible=true','bad\u0000text',400,'POST',{'content-type':'text/plain'});
  await expect('hr',base+'?title=Large&ownerVisible=true','x'.repeat(5*1024*1024+1),413,'POST',{'content-type':'text/plain'});
 });
 await check('Employee create permissions, validation and optimistic edit',async()=>{
  await expect('hr','/employees',{fullName:'Denied HR',employment:{startDate:'2026-01-01',status:'ACTIVE',reason:'Fixture'},portalLogin:{email:'denied-hr@release.invalid',password,role:'HR'}},403);
  await expect('employee','/employees',{fullName:'Denied'},403);
  await expect('hr','/employees',{fullName:''},400);
  const before=await expect('hr','/employees/'+people.employee.id),version=(before.employee||before).version;
  await expect('hr','/employees/'+people.employee.id,{version,location:'Synthetic Karachi'},200,'PATCH');
  await expect('hr','/employees/'+people.employee.id,{version,location:'Stale'},409,'PATCH');
  const after=await expect('hr','/employees/'+people.employee.id);assert.equal((after.employee||after).location,'Synthetic Karachi');
 });
 await check('Organization validation, duplicate name and historical assignments',async()=>{
  await expect('hr','/organization',{kind:'DEPARTMENT',name:' release department ',reason:'Duplicate'},409);
  const history=await expect('hr','/organization/employees/'+people.employee.id+'/history');assert.ok(history.assignments.length>=2);assert.ok(history.assignments.some(a=>a.team?.name==='Release Team'));
  await expect('employee','/organization',undefined,403);
 });
 const policy=require('../src/validation/schedule-readiness.validation').confirmedPolicy;
 const draft=await expect('hr','/attendance-settings/draft',{expectedPreviousId:null,reason:'Isolated schedule',policy});
 await expect('hr','/attendance-settings/activate',{draftId:draft.id,expectedPreviousId:null,effectiveFrom:'2026-11-24',reason:'Isolated publication'});
 await check('Attendance policy persists; no automatic punches; bounded concurrent reads',async()=>{
  const before=await prisma.attendanceRecord.count();for(const key of ['hr','manager','employee'])await expect(key,'/attendance-settings/my-shift');
  const start=performance.now();const reads=await Promise.all(Array.from({length:6},(_,i)=>api(i%2?'hr':'employee',i%3?'/attendance/status':'/attendance-settings/my-shift')));assert.ok(reads.every(r=>r.status===200));assert.equal(await prisma.attendanceRecord.count(),before);result('6 concurrent attendance reads',true,Math.round(performance.now()-start)+' ms');
 });
 let punch;
 await check('Clock-in replay, overnight checkout and original punch preservation',async()=>{
  const ready=await expect('employee','/attendance/status');assert.equal(ready.canClockIn,true);const requestId=randomUUID();
  punch=await expect('employee','/attendance/clock-in',{requestId});const again=await expect('employee','/attendance/clock-in',{requestId});assert.equal(again.id,punch.id);
  assert.equal(await prisma.attendanceRecord.count({where:{employeeId:people.employee.id}}),1);
  now=new Date('2026-11-25T00:00:00Z');const status=await expect('employee','/attendance/status');assert.equal(status.canClockOut,true);assert.equal(status.attendance.shiftDate,'2026-11-24');
  const checkoutId=randomUUID();const done=await expect('employee','/attendance/clock-out',{requestId:checkoutId,attendanceRecordId:punch.id});assert.equal(done.status,'COMPLETED');await expect('employee','/attendance/clock-out',{requestId:checkoutId,attendanceRecordId:punch.id});
  const saved=await prisma.attendanceRecord.findUnique({where:{id:punch.id}});assert.equal(saved.clockInAt.toISOString(),'2026-11-24T14:15:00.000Z');assert.equal(saved.clockOutAt.toISOString(),'2026-11-25T00:00:00.000Z');
 });
 await check('Corrections: non-self HR review, versioning, immutable originals and report evidence',async()=>{
  assert.ok(punch);now=new Date('2026-11-25T08:00:00Z');
  const row=await expect('employee','/attendance/corrections',{attendanceRecordId:punch.id,shiftDate:'2026-11-24',requestType:'WRONG_TIME',correctedClockIn:'2026-11-24T14:00:00Z',correctedClockOut:'2026-11-25T00:00:00Z',reason:'Synthetic correction'});
  await expect('employee','/attendance/corrections/'+row.id+'/review',{decision:'APPROVED',reviewReason:'Denied self',expectedVersion:row.version},403);
  await expect('hr','/attendance/corrections/'+row.id+'/review',{decision:'APPROVED',reviewReason:'Synthetic reviewed',expectedVersion:row.version});
  await expect('hr','/attendance/corrections/'+row.id+'/review',{decision:'APPROVED',reviewReason:'Stale',expectedVersion:row.version},409);
  const saved=await prisma.attendanceRecord.findUnique({where:{id:punch.id}});assert.equal(saved.clockInAt.toISOString(),'2026-11-24T14:15:00.000Z');
 });
 let leave;
 await check('Leave reservation/concurrency, HR-only independent review and cancellation',async()=>{
  now=new Date('2026-11-25T08:00:00Z');
  const preview=await expect('employee','/leaves/preview',{shiftDate:'2026-11-26'});assert.equal(preview.eligible,true);
  const raced=await Promise.all([api('employee','/leaves',{shiftDate:'2026-11-26',reason:'Synthetic one'}),api('employee','/leaves',{shiftDate:'2026-11-27',reason:'Synthetic two'})]);assert.equal(raced.filter(r=>r.status===200).length,1);assert.ok(raced.every(r=>[200,409].includes(r.status)));leave=raced.find(r=>r.status===200).data;
  const slot=await expect('employee','/leaves/balance?month=2026-11');assert.equal(slot.reserved,1);assert.equal(slot.available,0);
  await expect('admin','/leaves/'+leave.id+'/review',{expectedVersion:leave.version,decision:'APPROVED',reason:'Admin cannot review'},403);
  await expect('manager','/leaves/management',undefined,403);await expect('outsider','/leaves/'+leave.id,undefined,404);
  leave=await expect('hr','/leaves/'+leave.id+'/review',{expectedVersion:leave.version,decision:'APPROVED',reason:'Synthetic HR review'});
  const paid=await expect('hr','/leaves/management?month=2026-11&status=APPROVED&search=RELEASE-EMPLOYEE');assert.equal(paid.total,1);
  const cancelled=await expect('hr2','/leaves/'+leave.id+'/cancel',{expectedVersion:leave.version,reason:'Synthetic cancellation'});assert.equal(cancelled.status,'CANCELLED');assert.equal((await expect('employee','/leaves/balance?month=2026-11')).available,1);
  const own=await expect('hr','/leaves',{shiftDate:'2026-11-27',reason:'Own HR fixture'});await expect('hr','/leaves/'+own.id+'/review',{expectedVersion:own.version,decision:'APPROVED',reason:'Own denied'},403);
  await expect('hr2','/leaves/'+own.id+'/review',{expectedVersion:own.version,decision:'APPROVED',reason:'Independent HR'});
 });
 let payroll;
 await check('Payroll salary revision, exact calculation, return/stale/approval/payment and own visibility',async()=>{
  const salary=await expect('hr','/payroll/salaries/'+people.employee.id,{effectiveMonth:'2026-11',monthlyBasic:'40000.00',expectedPreviousId:null,reason:'Synthetic starting salary'});
  await expect('hr','/payroll/salaries/'+people.employee.id,{effectiveMonth:'2026-11',monthlyBasic:'41000.00',expectedPreviousId:null,reason:'Stale'},409);
  const input={employeeId:people.employee.id,month:'2026-11',totalPayableDays:'30',workedDays:'24',earnings:[{type:'ALLOWANCE',label:'Synthetic allowance',amount:'5000.00'}],deductions:[{type:'OTHER',label:'Synthetic deduction',amount:'100.25'}]};
  const calc=await expect('hr','/payroll/preview',input);assert.equal(calc.earnedBasic,'32000.00');assert.equal(calc.netPay,'36899.75');
  payroll=await expect('hr','/payroll',{...input,reason:'Synthetic preparation'});await expect('admin','/payroll',{...input,reason:'Admin denied'},403);
  await expect('employee','/payroll/payslips/'+payroll.id,undefined,404);
  payroll=await expect('hr','/payroll/'+payroll.id+'/hr-approve',{expectedVersion:payroll.version,reason:'HR review'});
  payroll=await expect('admin','/payroll/'+payroll.id+'/return',{expectedVersion:payroll.version,reason:'Synthetic send back'});assert.equal(payroll.status,'DRAFT');
  await expect('hr','/payroll/'+payroll.id,{totalPayableDays:'30',workedDays:'24',earnings:input.earnings,deductions:input.deductions,expectedVersion:1,reason:'Stale'},409,'PATCH');
  payroll=await expect('hr','/payroll/'+payroll.id+'/hr-approve',{expectedVersion:payroll.version,reason:'Reviewed again'});
  payroll=await expect('admin','/payroll/'+payroll.id+'/approve',{expectedVersion:payroll.version,reason:'Independent final approval'});
  await expect('outsider','/payroll/payslips/'+payroll.id,undefined,404);await expect('employee','/payroll/payslips/'+payroll.id);
  await expect('hr','/payroll/'+payroll.id+'/pay',{expectedVersion:payroll.version,reason:'Denied',method:'CASH',paidOn:require('../src/utils/office-schedule').localParts(new Date(),'Asia/Karachi').date},403);
  payroll=await expect('admin','/payroll/'+payroll.id+'/pay',{expectedVersion:payroll.version,reason:'Synthetic recording only',method:'CASH',paidOn:require('../src/utils/office-schedule').localParts(new Date(),'Asia/Karachi').date});assert.equal(payroll.status,'PAID');
  await expect('admin','/payroll/'+payroll.id+'/pay',{expectedVersion:payroll.version,reason:'Duplicate',method:'CASH',paidOn:require('../src/utils/office-schedule').localParts(new Date(),'Asia/Karachi').date},409);
  const saved=await expect('employee','/payroll/payslips/'+payroll.id);assert.equal(saved.netPay,'36899.75');assert.equal('createdByUserId'in saved,false);assert.equal('history'in saved,false);
 });
 await check('Announcements targeted publication, IDOR, read state and notifications',async()=>{
  const row=await expect('hr','/announcements',{title:'Synthetic employee-only notice',content:'Synthetic content',audienceMode:'ROLES',audienceRoles:['EMPLOYEE']});
  await expect('employee','/announcements/'+row.id,undefined,404);
  const published=await expect('hr','/announcements/'+row.id+'/publish',{expectedVersion:row.version,reason:'Isolated publish'});
  await expect('employee','/announcements/'+row.id);await expect('manager','/announcements/'+row.id,undefined,404);
  await expect('employee','/announcements/'+row.id+'/read',{});const inbox=await expect('employee','/notifications');assert.ok(inbox);
  await expect('employee','/announcements',{title:'Denied',content:'Denied'},403);
 });
 await check('Reports role scope, monthly/detail reconciliation and real CSV/XLSX exports',async()=>{
  const summary=await expect('employee','/reports/monthly?month=2026-11'),details=await expect('employee','/reports/attendance?month=2026-11');assert.equal(summary.totals.actualRecords,details.totals.actualRecords);
  for(const key of ['employee','manager']){const scoped=await expect(key,'/reports/attendance?dateFrom=2026-11-23&dateTo=2026-11-25&employeeId='+people.outsider.id,undefined,key==='employee'?403:200);if(key==='manager')assert.equal(scoped.total,0);}
  for(const format of ['csv','xlsx']){const r=await api('employee','/reports/monthly/export?month=2026-11&format='+format);assert.equal(r.status,200);const bytes=await r.raw.body();assert.ok(bytes.length>100);if(format==='xlsx')assert.equal(bytes.subarray(0,2).toString(),'PK');fs.writeFileSync(path.join(out,'synthetic-monthly.'+format),bytes);}
 });
 await check('Dashboards independent resource reads and Admin-only global audit',async()=>{
  for(const key of ['admin','hr','manager','employee'])for(const endpoint of ['/dashboard/personal','/dashboard/payslip','/dashboard/announcements'])await expect(key,endpoint);
  for(const endpoint of ['/dashboard/employees','/dashboard/attendance','/dashboard/queues'])await expect('hr',endpoint);
  await expect('admin','/dashboard/admin-queues');await expect('admin','/audit');await expect('hr','/dashboard/admin-queues',undefined,403);
 });
 await check('All-role real-browser routes, reload/fresh tab, themes and responsive overflow',async()=>{
  if(process.env.RELEASE_SKIP_RESPONSIVE==='true')return 'SKIP';
  const routes={admin:['/dashboard','/employees','/organization','/attendance','/leaves','/payroll','/employment','/reports','/announcements','/notifications','/attendance-settings','/audit','/employee-records','/my-profile?tab=security'],hr:['/dashboard','/employees','/organization','/attendance','/leaves','/payroll','/employment','/reports','/announcements','/notifications','/attendance-settings','/my-profile'],manager:['/dashboard','/my-employees','/attendance','/leaves','/reports','/my-payslips','/announcements','/notifications','/employment','/my-profile'],employee:['/dashboard','/attendance','/leaves','/reports','/my-payslips','/announcements','/notifications','/employment','/my-profile']};
  const failures=[],screens=[],browserErrors=[];let viewed=0;
  for(const key of ['admin','hr','manager','employee']){
   const page=await sessions[key].newPage();page.on('pageerror',e=>browserErrors.push({role:key,message:e.message}));
   for(const route of routes[key])for(const width of [320,375,768,1024,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.goto('http://localhost:5176'+route);await page.locator('main').waitFor();await page.waitForTimeout(70);
    await page.evaluate(theme=>{localStorage.setItem('officehr-theme',theme);document.documentElement.classList.toggle('dark',theme==='dark');},theme);
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,login:location.pathname==='/login',error:document.body.innerText.includes('Unable to verify your session')}));
    if(state.overflow||state.login||state.error)failures.push({key,route,width,theme,...state});viewed++;
    if(width===320||width===1440){const name=key+'-'+route.split('?')[0].replaceAll('/','_')+'-'+width+'-'+theme+'.png';await page.screenshot({path:path.join(out,name),fullPage:true,animations:'disabled'});screens.push(name);}
   }
   await page.goto('http://localhost:5176/dashboard');await page.reload();await page.locator('main').waitFor();assert.ok(!page.url().endsWith('/login'));
   const fresh=await sessions[key].newPage();await fresh.goto('http://localhost:5176/dashboard');await fresh.locator('main').waitFor();await fresh.close();await page.close();
  }
  fs.writeFileSync(path.join(out,'browser-matrix.json'),JSON.stringify({viewed,screens,failures,browserErrors},null,2));assert.deepEqual(browserErrors,[]);assert.deepEqual(failures,[]);result('Responsive route/theme matrix',true,viewed+' page/width/theme combinations');
 });
 await check('Managed reset permissions, session revocation and credential-free audit',async()=>{
  const newPassword=password+'-reset',body={requestId:randomUUID(),newPassword,confirmPassword:newPassword,reason:'Synthetic reset',confirmed:true};
  await expect('hr','/organization/employees/'+people.hr2.id+'/reset-password',body,403);
  await expect('hr','/organization/employees/'+people.employee.id+'/reset-password',body);await expect('employee','/auth/me',undefined,401);
  assert.equal(await login('employee',newPassword),200);
  const audit=await prisma.auditLog.findFirst({where:{action:'MANAGED_ACCOUNT_PASSWORD_RESET',targetId:people.employee.id}});assert.ok(audit);assert.ok(!JSON.stringify(audit.metadata).includes(newPassword));
  await expect('admin','/organization/employees/'+people.hr2.id+'/reset-password',{...body,requestId:randomUUID()});await expect('hr2','/auth/me',undefined,401);
 });
 await check('Inactivity, expiry, disabled account, lockout and logout invalidate sessions',async()=>{
  const session=await prisma.userSession.findFirst({where:{userId:accounts.employee.id,revokedAt:null},orderBy:{createdAt:'desc'}});
  await prisma.userSession.update({where:{id:session.id},data:{lastSeenAt:new Date(Date.now()-3600001)}});await expect('employee','/auth/me',undefined,401);
  for(const key of ['admin','hr','manager']){await expect(key,'/auth/logout',{});await expect(key,'/auth/me',undefined,401);}
  const lock=await prisma.user.create({data:{email:'lock@release.invalid',displayName:'Synthetic lock',role:'EMPLOYEE',status:'ACTIVE',passwordHash,mustChangePassword:false}});accounts.lock=lock;sessions.lock=await browser.newContext();
  for(let n=0;n<5;n++)assert.equal(await login('lock','wrong'),401);assert.equal(await login('lock'),401);assert.ok((await prisma.user.findUnique({where:{id:lock.id}})).lockedUntil);
  await prisma.user.update({where:{id:lock.id},data:{lockedUntil:null,failedLoginAttempts:0,status:'DISABLED'}});assert.equal(await login('lock'),401);
 });
}
main().catch(e=>{result('Harness setup/completion',false,e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();if(results.some(r=>r.result==='FAIL'))process.exitCode=1;console.log('Evidence: '+out);});

