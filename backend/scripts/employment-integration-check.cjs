'use strict';
// Real PostgreSQL + HTTP + browser checks. Never reads DATABASE_URL from .env.
// Supply a freshly created, disposable loopback database explicitly.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const database=process.env.EMPLOYMENT_TEST_DATABASE_URL;
if(!database)throw new Error('EMPLOYMENT_TEST_DATABASE_URL is required; production .env is never a fallback.');
let target;try{target=new URL(database);}catch{throw new Error('Invalid explicit test database URL.');}
if(!['localhost','127.0.0.1'].includes(target.hostname)||!/^officehr_employment_test_[a-z0-9_]+$/.test(target.pathname.slice(1))||!target.port)throw new Error('Only a named disposable loopback test database is supported.');
Object.assign(process.env,{DATABASE_URL:database,NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5174',HOST:'127.0.0.1',OFFICEHR_LOCAL_DEMO_ENABLED:'false',OFFICEHR_PRODUCTION_DEMO_ENABLED:'false'});
const backend=path.resolve(__dirname,'..'),root=path.resolve(backend,'..');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'employment-integration-'));
process.env.DOCUMENT_STORAGE_DIR=path.join(out,'documents');fs.mkdirSync(process.env.DOCUMENT_STORAGE_DIR);
const results=[];
function evidence(scenario,role,expected,actual,status='PASS'){results.push({scenario,role,expected,actual,status});console.log(status+': '+scenario+' ['+role+'] — '+actual);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({target:{host:target.hostname,port:target.port,database:target.pathname.slice(1)},results},null,2));}
let prisma,server,browser;
const stamp='2026-11-20',next='2026-11-21';let instant=new Date(stamp+'T08:00:00Z');
const credentials={password:'Synthetic-only-'+randomUUID()};
const accounts={},people={},contexts={};let department,designation,team;
async function main(){
 const {Client}=require('pg'),probe=new Client({connectionString:database});let identity;
 try{await probe.connect();identity=(await probe.query('SELECT current_database() AS name, host(inet_server_addr()) AS address')).rows[0];
 assert.equal(identity.name,target.pathname.slice(1));assert.ok(['127.0.0.1','::1'].includes(identity.address));
 assert.equal((await probe.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0,'Use a new blank disposable database for each run.');}finally{await probe.end();}
 console.log('Confirmed disposable database: '+identity.name+' on '+identity.address+':'+target.port);
 for(const args of [['migrate','deploy'],['generate'],['migrate','status']]){const r=spawnSync(process.execPath,[path.join(backend,'node_modules/prisma/build/index.js'),...args,'--config','prisma7.config.ts'],{cwd:backend,env:process.env,encoding:'utf8'});console.log(r.stdout);assert.equal(r.status,0,r.stderr);}
 evidence('All existing migrations on blank PostgreSQL','Database','All migrations apply; status current','All migrations applied through migrate deploy');
 prisma=require('../src/config/prisma');require('../src/utils/employment-clock').now=()=>new Date(instant);
 const passwordHash=await require('../src/utils/password').hashPassword(credentials.password);
 for(const [key,role] of Object.entries({admin:'ADMIN',admin2:'ADMIN',hr:'HR',hr2:'HR',manager:'MANAGER',reviewer:'MANAGER',employee:'EMPLOYEE',recorded:'EMPLOYEE',termination:'EMPLOYEE',spare:'EMPLOYEE'})){
  accounts[key]=await prisma.user.create({data:{email:key+'@employment.example.test',displayName:'Synthetic '+key,role,status:'ACTIVE',mustChangePassword:false,passwordHash}});
 }
 department=await prisma.organizationUnit.create({data:{kind:'DEPARTMENT',name:'Test department',reason:'Isolated verification',actorUserId:accounts.admin.id}});
 designation=await prisma.organizationUnit.create({data:{kind:'DESIGNATION',name:'Test designation',reason:'Isolated verification',actorUserId:accounts.admin.id}});
 team=await prisma.organizationUnit.create({data:{kind:'TEAM',name:'Test team',departmentId:department.id,reason:'Isolated verification',actorUserId:accounts.admin.id}});
 for(const key of ['hr','hr2','manager','reviewer','employee','recorded','termination','spare']){
  const employee=await prisma.employee.create({data:{employeeCode:'TEST-'+key.toUpperCase(),fullName:accounts[key].displayName,userId:accounts[key].id}});
  const episode=await prisma.employmentEpisode.create({data:{employeeId:employee.id,startDate:new Date('2026-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2026-01-01'),employmentType:'FULL_TIME'}});
  await prisma.employmentStatusEvent.create({data:{employmentEpisodeId:episode.id,toStatus:'ACTIVE',effectiveDate:new Date('2026-01-01'),actorUserId:accounts.hr.id,reason:'Synthetic initial employment'}});
  await prisma.organizationAssignment.create({data:{employeeId:employee.id,designationId:designation.id,departmentId:department.id,teamId:team.id,reportingManagerId:key==='reviewer'?null:key==='spare'?accounts.manager.id:accounts.reviewer.id,effectiveFrom:new Date('2026-01-01'),actorUserId:accounts.hr.id,reason:'Synthetic placement'}});
  const storageName=randomUUID()+'.txt';fs.writeFileSync(path.join(process.env.DOCUMENT_STORAGE_DIR,storageName),'Synthetic supporting document only.');
  const document=await prisma.employeeDocument.create({data:{employeeId:employee.id,title:'Supporting document '+key,storageName,mediaType:'text/plain',byteLength:Buffer.byteLength('Synthetic supporting document only.'),ownerVisible:true,actorUserId:accounts.hr.id}});
  people[key]={...employee,episodeId:episode.id,document};
 }
 await prisma.teamManagerAssignment.create({data:{teamId:team.id,managerUserId:accounts.manager.id,effectiveFrom:new Date('2026-01-01'),actorUserId:accounts.hr.id,reason:'Synthetic manager assignment'}});
 const app=require('../app');server=await new Promise(resolve=>{const s=app.listen(3018,'127.0.0.1',()=>resolve(s));});
 const {chromium}=require(path.join(root,'frontend/node_modules/playwright-core'));
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const key of ['admin','admin2','hr','hr2','reviewer','manager','employee','recorded','termination','spare']){
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'America/Los_Angeles'});
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const login=await context.request.post('http://localhost:3018/api/auth/login',{data:{email:accounts[key].email,password:credentials.password},headers:{origin:'http://localhost:5174'}});assert.equal(login.status(),200,'Synthetic login failed: '+key);contexts[key]={context,page:null};
  console.log('Authenticated disposable '+key);
 }
 async function getPage(key){for(const session of Object.values(contexts)){if(session.page){await session.page.close();session.page=null;}}const p=await contexts[key].context.newPage();contexts[key].page=p;p.on('pageerror',error=>console.error('Browser error: '+error.message));return p;}
 async function api(key,url,body,extra={}){const session=contexts[key];const cookies=await session.context.cookies('http://localhost:3018');const csrf=cookies.find(c=>c.name==='officehr_csrf')?.value;const response=await session.context.request.fetch('http://localhost:3018/api'+url,{method:body===undefined?'GET':'POST',data:body,headers:{origin:'http://localhost:5174',...(csrf?{'x-csrf-token':csrf}:{}),...extra}});return {status:response.status(),body:await response.json()};}
 async function choose(page,label,value){const field=page.getByLabel(label,{exact:true});if(await field.evaluate(el=>el.tagName)==='SELECT'){await field.selectOption(value);return;}await field.click();const labels={ACCEPTED:'Handover supported',COMPLETE:'Complete',OTHER:'Other',WAIVED:'Notice waived'};await page.getByRole('option',{name:labels[value]||value,exact:true}).click();}
 async function submit(page,name,pathFragment){const wait=page.waitForResponse(r=>r.url().includes(pathFragment)&&r.request().method()==='POST');await page.getByRole('button',{name,exact:true}).click();const response=await wait;const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));return body.data;}
 async function casePage(key,id){const p=await getPage(key);await p.goto('http://localhost:5174/employment?id='+id);await p.getByRole('dialog',{name:'Employment Case Details',exact:true}).waitFor();await p.getByRole('heading',{name:new RegExp(people.employee.employeeCode)}).count();return p;}
 async function prepare(page,termination){
  await page.getByLabel(termination?'Proposed last working shift date':'Confirmed last working shift date',{exact:true}).fill(stamp);
  if(termination){await choose(page,'Termination category','OTHER');await page.getByLabel('Proposed decision date',{exact:true}).fill(stamp);await page.getByLabel('Proposed employment end date',{exact:true}).fill(next);await choose(page,'Notice handling','WAIVED');}
  await page.getByLabel('Final shift starts (Asia/Karachi)',{exact:true}).fill(stamp+'T19:00');await page.getByLabel(termination?'Access cutoff date and time (Asia/Karachi)':'Proposed access cutoff (Asia/Karachi)',{exact:true}).fill(next+'T05:00');await page.getByLabel('Notice period (days)',{exact:true}).fill('0');await page.getByLabel('Reason',{exact:true}).fill('Synthetic prepared grounds');await page.getByLabel('HR remarks (optional)',{exact:true}).fill('Private synthetic HR remarks');await page.getByLabel('Supporting information (optional)',{exact:true}).fill('Synthetic supporting context');await page.getByRole('checkbox').last().check();
 }
 const completed=[];
 for(const spec of [{key:'employee',type:'SELF'},{key:'manager',type:'SELF'},{key:'hr',type:'SELF'},{key:'recorded',type:'HR_RECORDED'},{key:'termination',type:'COMPANY'}]){
  const person=people[spec.key],initiator=spec.type==='SELF'?spec.key:'hr',p=await getPage(initiator);
  await p.goto('http://localhost:5174/employment'+(spec.type==='SELF'?'':'?employeeId='+person.id));
  await p.getByRole('button',{name:spec.type==='SELF'?'Submit my resignation':spec.type==='HR_RECORDED'?'Record resignation on behalf':'Prepare termination case',exact:true}).click();
  await p.getByLabel('Reason',{exact:true}).fill('Synthetic original '+spec.key);
  if(spec.type!=='COMPANY')await p.getByLabel('Proposed last working shift date',{exact:true}).fill(stamp);
  if(spec.type==='HR_RECORDED'){await p.getByLabel('Resignation received on',{exact:true}).fill(stamp);await p.getByLabel('Notice period (days)',{exact:true}).fill('0');await p.getByLabel('HR remarks (optional)',{exact:true}).fill('Initial private remarks');}
  if(spec.type==='COMPANY')await prepare(p,true);
  if(spec.key!=='manager')await choose(p,spec.type==='SELF'?'Existing supporting document':'Supporting documents (optional)',person.document.title);
  const row=await submit(p,spec.type==='SELF'?'Confirm Submit My Resignation':spec.type==='HR_RECORDED'?'Record resignation':'Save preparation','/employment/cases');
  await p.getByRole('dialog',{name:'Employment Case Details',exact:true}).waitFor();
  assert.equal(row.source,spec.type);assert.equal(row.recordedById,accounts[initiator].id);assert.equal((await prisma.user.findUnique({where:{id:person.userId}})).status,'ACTIVE');assert.equal((await prisma.employmentEpisode.findUnique({where:{id:person.episodeId}})).endDate,null);
  let saved=(await api('admin','/employment/cases/'+row.id)).body.data;assert.equal(saved.reason,spec.type==='COMPANY'?'Synthetic prepared grounds':'Synthetic original '+spec.key);
  await p.reload();await p.getByRole('dialog',{name:'Employment Case Details',exact:true}).waitFor();
  if(spec.type!=='COMPANY'){
   const reviewer=await casePage('reviewer',row.id);await reviewer.getByRole('button',{name:'Review handover',exact:true}).click();await choose(reviewer,'Manager recommendation','ACCEPTED');await choose(reviewer,'Handover status','COMPLETE');await reviewer.getByLabel('Handover review and recommendation',{exact:true}).fill('Synthetic handover reviewed');await submit(reviewer,'Confirm Manager Handover Review','/manager-review');
   const hrKey=spec.key==='hr'?'hr2':'hr',hp=await casePage(hrKey,row.id);await hp.getByRole('button',{name:'Prepare confirmed exit',exact:true}).click();await prepare(hp,false);await submit(hp,'Submit for Admin review','/prepare');
  }
  saved=(await api('admin','/employment/cases/'+row.id)).body.data;assert.equal(saved.state,'ADMIN_APPROVAL');assert.equal(saved.noticeDays,0);assert.equal(saved.accessCutoff,next+'T00:00:00.000Z');assert.equal(saved.employmentEndDate,next);assert.equal(saved.hrRemarks,'Private synthetic HR remarks');assert.equal(saved.supportingInfo,'Synthetic supporting context');assert.equal(saved.finalShiftStart,stamp+'T14:00:00.000Z');
  const admin=await casePage('admin',row.id);await admin.getByRole('button',{name:'Approve case',exact:true}).click();await admin.getByLabel('Reason',{exact:true}).fill('Synthetic independent approval');for(const checkbox of await admin.getByRole('checkbox').all())await checkbox.check();await submit(admin,'Confirm Approve Employment Case','/approve');
  saved=(await api('admin','/employment/cases/'+row.id)).body.data;assert.equal(saved.state,'APPROVED');assert.equal(saved.approvedById,accounts.admin.id);assert.notEqual(saved.approvedById,saved.preparedById);assert.notEqual(saved.preparedById,person.userId);assert.ok(saved.history.length>=3);assert.equal((await prisma.user.findUnique({where:{id:person.userId}})).status,'ACTIVE');
  assert.ok(await prisma.notification.count({where:{event:{resourceId:row.id}}}));
  const own=await api(spec.key,'/employment/cases/'+row.id);if(spec.type==='COMPANY')assert.equal(own.status,404);else{assert.equal(own.status,200);if(accounts[spec.key].role!=='HR'){assert.equal('hrRemarks'in own.body.data,false);assert.ok(own.body.data.history.every(e=>!('details'in e)));}}
  completed.push({...spec,id:row.id});evidence('Frontend submit → reload → review → independent approval',accounts[initiator].role+' / '+spec.key,'Correct workflow and durable fields; no early access loss','Real frontend, HTTP, PostgreSQL, audit and notification assertions passed');
 }
 instant=new Date(Date.parse(next+'T00:00:00Z')-1);
 assert.equal((await api('admin','/employment/process-due',{confirmed:true})).body.data.processed,0);
 for(const record of completed)assert.equal((await api(record.key,'/employment/self-profile')).status,200);
 evidence('One millisecond before approved cutoff','All subjects','Sessions still work; no exit processed','All five accounts authenticated; process-due processed zero');
 instant=new Date(next+'T00:00:00Z');
 // A test-only trigger deliberately fails after the episode update. The real
 // transaction must roll back every employment/access change, not just the case.
 await prisma.$executeRawUnsafe(`CREATE FUNCTION employment_test_abort_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."employmentEpisodeId"='${people.employee.episodeId}'::uuid THEN RAISE EXCEPTION 'Synthetic rollback probe' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER employment_test_abort_exit AFTER INSERT ON employment_status_events FOR EACH ROW EXECUTE FUNCTION employment_test_abort_exit()');
 await assert.rejects(require('../src/services/employment.service').processCase(completed[0].id));
 assert.equal((await prisma.employmentEpisode.findUnique({where:{id:people.employee.episodeId}})).endDate,null);
 assert.equal((await prisma.user.findUnique({where:{id:people.employee.userId}})).status,'ACTIVE');
 assert.equal((await prisma.employmentCase.findUnique({where:{id:completed[0].id}})).state,'APPROVED');
 await prisma.$executeRawUnsafe('DROP TRIGGER employment_test_abort_exit ON employment_status_events');await prisma.$executeRawUnsafe('DROP FUNCTION employment_test_abort_exit()');
 evidence('Atomic exit rollback after an injected database failure','Database','No partial episode/access/case changes','Real PostgreSQL trigger failure rolled the entire transaction back');
 const processed=await api('admin','/employment/process-due',{confirmed:true});assert.equal(processed.status,200,JSON.stringify(processed.body));assert.equal(processed.body.data.processed,5,JSON.stringify(processed.body));assert.equal((await api('admin','/employment/process-due',{confirmed:true})).body.data.processed,0);
 for(const record of completed){const person=people[record.key],row=await prisma.employmentCase.findUnique({where:{id:record.id}});assert.equal(row.state,'COMPLETED');assert.equal((await prisma.employmentEpisode.findUnique({where:{id:person.episodeId}})).endDate.toISOString().slice(0,10),stamp);assert.equal((await prisma.user.findUnique({where:{id:person.userId}})).status,'DISABLED');assert.equal(await prisma.userSession.count({where:{userId:person.userId,revokedAt:null}}),0);assert.equal((await api(record.key,'/employment/self-profile')).status,401);assert.equal((await prisma.organizationAssignment.findFirst({where:{employeeId:person.id}})).effectiveTo.toISOString().slice(0,10),stamp);evidence('Effective cutoff closes employment/placement and revokes sessions',record.key,'Completed at Karachi next-day cutoff exactly once','Database episode, assignments, user/session state and HTTP denial verified');}
 assert.equal(await prisma.payrollRecord.count(),0);assert.equal(await prisma.payrollPayment.count(),0);evidence('No automatic payroll side effects','All exits','No payroll records or payments','Both tables remain empty');
 assert.equal((await prisma.teamManagerAssignment.findFirst({where:{managerUserId:accounts.manager.id}})).effectiveTo.toISOString().slice(0,10),stamp);
 const reportHistory=await prisma.organizationAssignment.findMany({where:{employeeId:people.spare.id},orderBy:{effectiveFrom:'asc'}});assert.equal(reportHistory.length,2);assert.equal(reportHistory[0].effectiveTo.toISOString().slice(0,10),stamp);assert.equal(reportHistory[1].reportingManagerId,null);assert.equal(reportHistory[1].effectiveFrom.toISOString().slice(0,10),next);
 evidence('Departing Manager teams and direct reports','Manager','Close management interval; retain old reporting history; unassign prospectively','Real team closure and two dated reporting assignments verified');
 await additionalChecks({prisma,api,accounts,people,department,designation,team,contexts,choose,submit,casePage});
 await browserChecks({getPage,api,choose});
 console.log('Evidence: '+out);
}
async function browserChecks({getPage,api,choose}){
 // Authentication after a rehire must create a NEW session, never restore one.
 const relogin=await api('termination','/auth/login',{email:accounts.termination.email,password:credentials.password});assert.equal(relogin.status,200);
 for(const key of ['admin','hr2','reviewer','termination']){
  const p=await getPage(key);await p.goto('http://localhost:5174/employment');await p.getByRole('heading',{name:'Employment Management',exact:true}).waitFor();
  await p.getByRole('button',{name:'Reload employment records',exact:true}).waitFor();
  if(!['ADMIN','HR'].includes(accounts[key].role)){assert.equal(await p.getByRole('button',{name:'Prepare termination case',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Disable account access',exact:true}).count(),0);}
 }
 const subject=people.spare;
 await prisma.employmentCase.createMany({data:Array.from({length:21},(_,i)=>({employeeId:subject.id,episodeId:subject.episodeId,employeeUserId:subject.userId,kind:'RESIGNATION',state:'CANCELLED',source:'HR_RECORDED',recordedById:accounts.hr2.id,reason:'Synthetic pagination history '+i}))});
 for(const width of [1440,320])for(const dark of [false,true]){
  const p=await getPage('hr2');await p.setViewportSize({width,height:900});await p.goto('http://localhost:5174/employment?employeeId='+subject.id);await p.getByRole('button',{name:'Record resignation on behalf',exact:true}).waitFor();await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
  const nextButton=p.getByRole('button',{name:'Next',exact:true});await nextButton.click();await p.getByText(/cases.*Page 2 of/).waitFor();await p.getByRole('button',{name:'Previous',exact:true}).click();await p.getByText(/cases.*Page 1 of/).waitFor();
  await p.getByRole('button',{name:'Clear selection',exact:true}).click();assert.equal(await p.getByRole('button',{name:'Record resignation on behalf',exact:true}).count(),0);
  const search=p.getByRole('combobox',{name:'Search Employee',exact:true});await search.fill(subject.employeeCode);await p.getByRole('option').filter({hasText:subject.employeeCode}).click();await p.getByRole('button',{name:'Record resignation on behalf',exact:true}).waitFor();
  for(const mode of ['record','termination']){
   await p.getByRole('button',{name:mode==='record'?'Record resignation on behalf':'Prepare termination case',exact:true}).click();const dialog=p.getByRole('dialog').last();await dialog.waitFor();await p.getByLabel('Reason',{exact:true}).fill('Unsaved synthetic UI check');
   const labels=mode==='record'?['Supporting documents (optional)']:['Termination category','Notice handling','Supporting documents (optional)','Handover status','Clearance status'];
   for(const label of labels){const trigger=p.getByRole('combobox',{name:label,exact:true});await trigger.scrollIntoViewIfNeeded();await trigger.focus();await p.keyboard.press('ArrowDown');await p.getByRole('listbox').waitFor();await p.keyboard.press('End');await p.keyboard.press('Enter');await p.getByRole('listbox').waitFor({state:'hidden'});await trigger.click();await p.getByRole('option').last().hover();
    const bounds=await p.getByRole('listbox').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,inside:!!el.closest('dialog')};});assert.ok(bounds.inside&&bounds.left>=0&&bounds.right<=width&&bounds.top>=0&&bounds.bottom<=900,JSON.stringify(bounds));
    await p.screenshot({path:path.join(out,'ui-'+mode+'-'+label.replace(/\W/g,'')+'-'+width+'-'+dark+'.png')});await p.keyboard.press('Escape');await p.getByRole('listbox').waitFor({state:'hidden'});assert.equal(await p.getByRole('dialog').count(),1);assert.ok(await trigger.evaluate(el=>el===document.activeElement));
   }
   assert.equal(await p.getByLabel(mode==='record'?'Resignation received on':'Proposed decision date',{exact:true}).getAttribute('type'),'date');
   const footer=dialog.getByRole('button',{name:mode==='record'?'Record resignation':'Save preparation',exact:true});const rect=await footer.boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=900);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await p.getByRole('button',{name:'Discard changes',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
  }
  await p.getByRole('button',{name:'Disable account access',exact:true}).click();await p.getByRole('dialog',{name:'Disable Account Access',exact:true}).waitFor();await p.getByRole('button',{name:'Cancel',exact:true}).click();
  await p.getByRole('button',{name:'Reload employment records',exact:true}).click();await p.getByText('Saved employment records reloaded. Review their history before another action.',{exact:true}).waitFor();
  evidence('Actual UI: search, clearing, pagination, dropdown keyboard/focus, dialogs and refresh','HR '+width+'px '+(dark?'dark':'light'),'No clipping; accessible menus; actions stay intact','Browser assertions and screenshots passed; no employment write sent');
 }
 const p=await getPage('hr2');await p.route('**/api/employment/cases?**',route=>route.fulfill({status:503,json:{success:false,message:'Synthetic service unavailable',code:'SYNTHETIC_TEST_ERROR'}}));await p.goto('http://localhost:5174/employment');await p.getByRole('button',{name:'Retry employment cases',exact:true}).waitFor();await p.unroute('**/api/employment/cases?**');await p.getByRole('button',{name:'Retry employment cases',exact:true}).click();await p.getByRole('button',{name:'Process approved due actions',exact:true}).waitFor();
 const missing=await api('hr2','/employment/cases/'+randomUUID());assert.equal(missing.status,404);assert.equal((await api('hr2','/employment/cases/not-a-uuid')).status,400);
 const doc=people.termination.document;const download=await contexts.hr2.context.request.get('http://localhost:3018/api/employee-files/'+people.termination.id+'/documents/'+doc.id+'/download');assert.equal(download.status(),200);assert.equal(await download.text(),'Synthetic supporting document only.');
 evidence('Error recovery, missing resources and permitted document download','HR','503 retry recovers; missing/invalid IDs rejected; permitted file downloads','Controlled UI error recovery, real 404/400 and exact download bytes verified');
}
async function additionalChecks({prisma,api,accounts,people,department,designation,team,contexts,choose,submit,casePage}){
 const subject=people.spare,base={kind:'TERMINATION',source:'COMPANY',employeeId:subject.id,reason:'Synthetic company grounds'};
 const prep={reason:'Prepared synthetic grounds',confirmedLastDate:'2026-11-21',noticeDays:0,finalShiftStart:'2026-11-21T19:00:00+05:00',accessCutoff:'2026-11-22T05:00:00+05:00',terminationCategory:'OTHER',companyDecisionDate:'2026-11-21',employmentEndDate:'2026-11-22',noticeHandling:'WAIVED',hrRemarks:'Synthetic private remarks',supportingInfo:'Synthetic case context',supportingDocumentId:subject.document.id,handoverStatus:'NOT_STARTED',clearanceStatus:'PENDING',confirmed:true};
 const decision=row=>({expectedVersion:row.version,reason:'Synthetic reviewed decision',confirmed:true,assignmentsAcknowledged:true});
 const raw=await fetch('http://localhost:3018/api/employment/cases');assert.equal(raw.status,401);
 assert.equal((await api('hr2','/employment/cases',base,{'x-csrf-token':''})).status,403);
 assert.equal((await api('reviewer','/employment/cases',base)).status,403);
 for(const noticeDays of [-1,0.5,366])assert.equal((await api('hr2','/employment/cases',{...base,preparation:{...prep,noticeDays}})).status,400);
 assert.equal((await api('hr2','/employment/cases',{...base,preparation:{...prep,companyDecisionDate:'not-a-date'}})).status,400);
 const before=await prisma.employmentCase.count();
 assert.equal((await api('hr2','/employment/cases',{...base,preparation:{...prep,supportingDocumentId:people.employee.document.id}})).status,400);
 assert.equal(await prisma.employmentCase.count(),before);
 evidence('Authentication, CSRF, role and invalid-field enforcement','Unauthenticated / Manager / HR','401/403/400; no partial case','HTTP enforcement and rollback assertions passed');
 const concurrent=await Promise.all([api('hr2','/employment/cases',{...base,preparation:prep}),api('hr2','/employment/cases',{...base,preparation:prep})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);let row=concurrent.find(r=>r.status===200).body.data;
 assert.equal(await prisma.employmentCase.count({where:{employeeId:subject.id,state:'ADMIN_APPROVAL'}}),1);
 assert.equal((await api('reviewer','/employment/cases/'+row.id)).status,404);assert.equal((await api('spare','/employment/cases/'+row.id)).status,404);
 assert.equal((await api('hr2','/employment/cases/'+row.id+'/approve',decision(row))).status,403);
 const revision={...prep,expectedVersion:row.version,reason:'Revised synthetic grounds',hrRemarks:'Revised private remarks'};
 row=(await api('hr2','/employment/cases/'+row.id+'/prepare',revision)).body.data;
 assert.equal((await api('hr2','/employment/cases/'+row.id+'/prepare',revision)).status,409);
 assert.equal((await api('admin','/employment/cases/'+row.id+'/cancel',decision(row))).status,200);
 assert.equal((await prisma.employmentEpisode.findUnique({where:{id:subject.episodeId}})).endDate,null);
 evidence('Concurrent create, stale version, confidentiality and cancellation','HR / Manager / Employee / Admin','One open case; stale rejected; unauthorized hidden; employment unchanged','200+409 concurrency, stale 409, private detail 404, cancellation verified');
 for(const action of ['withdraw','reject']){
  const created=await api('spare','/employment/cases',{kind:'RESIGNATION',source:'SELF',proposedLastDate:'2026-11-21',reason:'Synthetic resubmission'});assert.equal(created.status,200,JSON.stringify(created.body));
  const result=await api(action==='withdraw'?'spare':'hr2','/employment/cases/'+created.body.data.id+'/'+action,decision(created.body.data));assert.equal(result.status,200,JSON.stringify(result.body));
 }
 const fallbackCase=(await api('spare','/employment/cases',{kind:'RESIGNATION',source:'SELF',proposedLastDate:'2026-11-21',reason:'Synthetic manager fallback'})).body.data;assert.equal(fallbackCase.managerReviewerId,null);
 let fallback=(await api('admin','/employment/cases/'+fallbackCase.id+'/fallback',{expectedVersion:fallbackCase.version,reason:'No eligible reporting manager after exit',confirmed:true})).body.data;
 fallback=(await api('hr2','/employment/cases/'+fallback.id+'/prepare',{expectedVersion:fallback.version,reason:'Synthetic fallback preparation',confirmedLastDate:'2026-11-21',noticeDays:0,finalShiftStart:prep.finalShiftStart,accessCutoff:prep.accessCutoff,handoverStatus:'NOT_STARTED',clearanceStatus:'PENDING',confirmed:true})).body.data;
 assert.equal((await api('admin','/employment/cases/'+fallback.id+'/approve',decision(fallback))).status,403);
 fallback=(await api('admin2','/employment/cases/'+fallback.id+'/approve',decision(fallback))).body.data;
 assert.equal((await api('admin2','/employment/cases/'+fallback.id+'/cancel',decision(fallback))).status,200);
 evidence('Documented Manager fallback and approval separation','Employee / HR / two Admins','Fallback reviewer cannot approve; another Admin can','Real fallback, preparation, independent approval and safe cancellation passed');
 let legacy=(await api('hr2','/employment/cases',base)).body.data;
 assert.equal((await api('admin','/employment/cases/'+legacy.id+'/approve',decision(legacy))).status,403);
 assert.equal((await api('hr2','/employment/cases/'+legacy.id+'/prepare',{...prep,expectedVersion:legacy.version,terminationCategory:undefined})).status,400);
 assert.equal((await api('admin','/employment/cases/'+legacy.id)).body.data.terminationCategory,null);
 legacy=(await api('hr2','/employment/cases/'+legacy.id+'/prepare',{...prep,expectedVersion:legacy.version})).body.data;
 const clearance=await api('hr2','/employment/cases/'+legacy.id+'/clearance',{expectedVersion:legacy.version,reason:'Synthetic handover check',handoverStatus:'COMPLETE',clearanceStatus:'COMPLETE'});assert.equal(clearance.status,200);
 legacy=clearance.body.data;assert.equal((await api('hr2','/employment/cases/'+legacy.id+'/reject',decision(legacy))).status,200);
 evidence('Withdrawal/rejection/resubmission, legacy case and clearance','Employee / HR / Admin','Unapproved cases stay harmless; no fabricated historical details','All API transitions and database assertions passed');
 const held=await api('hr2','/employment/employees/'+subject.id+'/disable',{reason:'Disposable synthetic account hold',confirmed:true});assert.equal(held.status,200);
 assert.equal((await api('hr2','/employment/employees/'+subject.id+'/disable',{reason:'Disposable synthetic account hold',confirmed:true})).body.data.replayed,true);
 assert.equal((await api('spare','/employment/self-profile')).status,401);assert.equal((await prisma.employmentEpisode.findUnique({where:{id:subject.episodeId}})).endDate,null);assert.ok(await prisma.auditLog.count({where:{action:'EMPLOYMENT_ACCESS_MANUALLY_DISABLED',targetId:subject.id}}));
 evidence('Separate manual disable and safe replay','HR / disposable Employee','Access revoked; employment untouched; audit retained','HTTP 401, active episode and one manual-hold audit verified');
 // Rehire uses an exited synthetic employee; old sessions must never return.
 const person=people.termination,rehire={employeeId:person.id,joiningDate:'2026-11-22',employmentType:'CONTRACT',organization:{departmentId:department.id,campaignId:null,teamId:team.id,designationId:designation.id,reportingManagerId:accounts.reviewer.id},salaryDecision:'UNCONFIGURED',accountDecision:'REACTIVATE',accessAt:'2026-11-22T19:00:00+05:00',reason:'Synthetic rehire',confirmed:true};
 const rehired=await api('hr2','/employment/rehire',rehire);assert.equal(rehired.status,200,JSON.stringify(rehired.body));let plan=rehired.body.data;
 const approved=await api('admin','/employment/cases/'+plan.id+'/approve',decision(plan));assert.equal(approved.status,200,JSON.stringify(approved.body));
 instant=new Date('2026-11-22T14:00:00Z');assert.equal((await api('admin','/employment/process-due',{confirmed:true})).body.data.processed,1);
 assert.equal(await prisma.employmentEpisode.count({where:{employeeId:person.id}}),2);assert.equal((await prisma.user.findUnique({where:{id:person.userId}})).status,'ACTIVE');assert.equal(await prisma.userSession.count({where:{userId:person.userId,revokedAt:null}}),0);assert.equal(await prisma.employeeSalaryVersion.count({where:{employeeId:person.id}}),0);
 evidence('Rehire episode/placement/salary/account decisions','HR / independent Admin','New episode and placement; salary unconfigured; old sessions revoked','Real API approval and due processing passed; two retained episodes');
 const constraints=await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid IN ('employment_cases'::regclass,'employment_episodes'::regclass)`;assert.ok(constraints.some(c=>c.conname==='employment_case_distinct_approval'));assert.ok(constraints.some(c=>c.conname==='employment_episodes_no_overlap'));
 await assert.rejects(prisma.employmentCase.update({where:{id:plan.id},data:{approvedById:accounts.hr2.id}}));
 await assert.rejects(prisma.employmentEpisode.create({data:{employeeId:person.id,startDate:new Date('2026-11-23'),status:'ACTIVE',statusEffectiveDate:new Date('2026-11-23')}}));
 evidence('Database integrity safeguards','Database','Distinct approval and overlapping episodes rejected','Real PostgreSQL constraint violations rejected; existing rows retained');
 const unlinked=await prisma.employee.create({data:{employeeCode:'TEST-LONG-REVIEW',fullName:'Synthetic long review'}});
 await prisma.employmentEpisode.create({data:{employeeId:unlinked.id,startDate:new Date('2026-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2026-01-01')}});
 await prisma.organizationAssignment.create({data:{employeeId:unlinked.id,departmentId:department.id,designationId:designation.id,reportingManagerId:accounts.reviewer.id,effectiveFrom:new Date('2026-01-01'),actorUserId:accounts.hr2.id,reason:'Synthetic length regression'}});
 const longReason='x'.repeat(1000);
 let reviewed=(await api('hr2','/employment/cases',{kind:'RESIGNATION',source:'HR_RECORDED',employeeId:unlinked.id,receivedDate:'2026-11-22',proposedLastDate:'2026-11-22',noticeDays:0,reason:'Synthetic length regression'})).body.data;
 const longReview=await api('reviewer','/employment/cases/'+reviewed.id+'/manager-review',{expectedVersion:reviewed.version,recommendation:'ACCEPTED',handoverStatus:'COMPLETE',reason:longReason});assert.equal(longReview.status,200,JSON.stringify(longReview.body));reviewed=longReview.body.data;
 const reviewDetail=(await api('hr2','/employment/cases/'+reviewed.id)).body.data;assert.equal(reviewDetail.managerNote,'ACCEPTED: '+longReason);assert.equal(reviewDetail.history.at(-1).reason,longReason);
 assert.equal((await api('hr2','/employment/employees/'+unlinked.id+'/disable',{reason:'Synthetic unlinked target',confirmed:true})).status,403);
 evidence('Maximum-length Manager review regression and unlinked access','Manager / HR','1000-character reason round-trips without truncation; unlinked disable denied','1010-character prefixed note and full audit persisted; HTTP 403 for unlinked account');
 const returning=people.recorded;
 assert.equal((await api('hr2','/employment/employees/'+returning.id+'/disable',{reason:'Synthetic rehire hold',confirmed:true})).status,200);
 let longPlan=(await api('hr2','/employment/rehire',{...rehire,employeeId:returning.id,joiningDate:'2026-11-23',accessAt:'2026-11-23T19:00:00+05:00',reason:longReason,salaryDecision:'NEW',salary:{monthlyBasic:'100000.00',effectiveMonth:'2026-11'}})).body.data;
 const cleared=await api('admin','/employment/cases/'+longPlan.id+'/approve',{...decision(longPlan),reason:longReason,clearManualDisable:true});assert.equal(cleared.status,200,JSON.stringify(cleared.body));longPlan=cleared.body.data;
 assert.equal((await prisma.employmentAccessControl.findUnique({where:{userId:returning.userId}})).reason,'Explicit rehire approval: '+longReason);
 instant=new Date('2026-11-23T14:00:00Z');const longProcessed=await api('admin','/employment/process-due',{confirmed:true});assert.equal(longProcessed.body.data.processed,1,JSON.stringify(longProcessed.body));
 const statusEvent=await prisma.employmentStatusEvent.findFirst({where:{employmentEpisode:{employeeId:returning.id}},orderBy:{createdAt:'desc'}});assert.equal(statusEvent.reason,'Approved rehire: '+longReason);assert.equal(await prisma.employeeSalaryVersion.count({where:{employeeId:returning.id}}),1);assert.equal((await prisma.user.findUnique({where:{id:returning.userId}})).status,'ACTIVE');
 evidence('Maximum-length rehire/hold-clear regression and explicit salary','HR / Admin','Full reasons retained; due action succeeds; explicit salary only','Prefixed reasons persisted without truncation; new episode, active account and one salary version verified');
}
main().catch(async error=>{for(const [key,session] of Object.entries(contexts)){if(session.page&&!session.page.isClosed()){console.log('Failed browser location: '+key+' '+session.page.url());await session.page.screenshot({path:path.join(out,'failure-'+key+'.png')}).catch(()=>{});}}evidence('Runner stopped','Verification','All assertions pass',error.message,'FAIL');console.error(error.stack);console.log('Evidence: '+out);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(prisma)await prisma.$disconnect();});
