'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{randomUUID}=require('crypto');
const url=process.env.RELEASE_TEST_DATABASE_URL;let target;try{target=new URL(url);}catch{throw Error('An explicit disposable database is required.');}
if(target.hostname!=='127.0.0.1'||target.port!=='55439'||!/^officehr_release_test_[a-z0-9_]+$/.test(target.pathname.slice(1)))throw Error('Refusing normal database.');
Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5176',OFFICEHR_LOCAL_DEMO_ENABLED:'false',OFFICEHR_PRODUCTION_DEMO_ENABLED:'false'});
const root=path.resolve(__dirname,'../..'),out=path.join(root,'reports/release-audit'),{chromium}=require(path.join(root,'frontend/node_modules/playwright-core'));
const results=[],errors=[],contexts={},users={};let prisma,server,browser;
const routes={admin:['/dashboard','/employees','/organization','/attendance','/leaves','/payroll','/employment','/reports','/announcements','/notifications','/attendance-settings','/audit','/employee-records','/my-profile?tab=security'],hr:['/dashboard','/employees','/organization','/attendance','/leaves','/payroll','/employment','/reports','/announcements','/notifications','/attendance-settings','/my-profile'],manager:['/dashboard','/my-employees','/attendance','/leaves','/reports','/my-payslips','/announcements','/notifications','/employment','/my-profile'],employee:['/dashboard','/attendance','/leaves','/reports','/my-payslips','/announcements','/notifications','/employment','/my-profile']};
function save(){fs.writeFileSync(path.join(out,process.env.RELEASE_DETAILS_ONLY==='true'?'focused-browser-results.json':'loaded-browser-results.json'),JSON.stringify({results,errors},null,2));}
async function check(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',detail:e.message});console.log('FAIL '+name+' '+e.message);}save();}
async function ready(page){await page.locator('main').waitFor();await page.waitForLoadState('networkidle');}
async function main(){
 const probe=new(require('pg').Client)({connectionString:url});try{await probe.connect();assert.equal((await probe.query('select current_database() name')).rows[0].name,target.pathname.slice(1));}finally{await probe.end();}
 prisma=require('../src/config/prisma');const password='Synthetic-browser-'+randomUUID(),hash=await require('../src/utils/password').hashPassword(password);
 // Fixture setup is confined to known synthetic identities in the guarded disposable DB.
 for(const key of ['admin','hr','manager','employee']){const user=await prisma.user.findUnique({where:{email:key+'@release.invalid'},select:{id:true,email:true,role:true}});assert.ok(user);users[key]=user;await prisma.user.update({where:{id:user.id,email:key+'@release.invalid'},data:{passwordHash:hash,status:'ACTIVE',mustChangePassword:false,lockedUntil:null,failedLoginAttempts:0}});}
 server=await new Promise(resolve=>{const s=require('../app').listen(3020,'127.0.0.1',()=>resolve(s));});
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const key of Object.keys(routes)){const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'America/Los_Angeles'});contexts[key]=context;await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());assert.equal((await context.request.post('http://localhost:3020/api/auth/login',{data:{email:users[key].email,password},headers:{origin:process.env.FRONTEND_ORIGIN}})).status(),200);}
 if(process.env.RELEASE_DETAILS_ONLY!=='true'){
 let viewed=0;const failures=[];
 for(const key of Object.keys(routes))await check('Loaded routes: '+key,async()=>{
  const page=await contexts[key].newPage();page.on('pageerror',e=>errors.push({key,message:e.message}));
  await page.goto('http://localhost:5176/dashboard');await ready(page);
  for(const route of routes[key])for(const width of [320,375,768,1024,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('officehr-theme',t),theme);await page.goto('http://localhost:5176'+route);await ready(page);
   const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,login:location.pathname==='/login',theme:document.documentElement.classList.contains('dark')?'dark':'light',loading:[...document.querySelectorAll('main [role="status"]')].some(e=>e.getClientRects().length&&/loading/i.test(e.textContent))}));
   if(state.overflow||state.login||state.theme!==theme||state.loading)failures.push({key,route,width,theme,state});viewed++;
   if(width===320||width===1440)await page.screenshot({path:path.join(out,'loaded-'+key+'-'+route.split('?')[0].replaceAll('/','_')+'-'+width+'-'+theme+'.png'),fullPage:true,animations:'disabled'});
  }await page.close();
 });
 fs.writeFileSync(path.join(out,'loaded-browser-matrix.json'),JSON.stringify({viewed,failures,errors},null,2));
 await check('450 loaded route/width/theme combinations',async()=>{assert.equal(viewed,450);assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);});
 }
 await check('Payroll modal: loaded data, portal, disclosures, focus trap, Escape and scroll restoration',async()=>{
  const p=await contexts.admin.newPage();await p.goto('http://localhost:5176/payroll');await ready(p);const opener=p.getByRole('button',{name:/^View payroll/}).first();await opener.scrollIntoViewIfNeeded();await opener.focus();const scroll=await p.evaluate(()=>scrollY);await opener.click();
  const dialog=p.getByRole('dialog',{name:'Payroll Details',exact:true});await dialog.waitFor();await p.waitForLoadState('networkidle');await dialog.getByText(/36,899\.75/).first().waitFor();
  assert.equal(await dialog.evaluate(el=>el.parentElement===document.body),true);
  for(const width of [1440,375,320])for(const theme of ['light','dark']){await p.setViewportSize({width,height:900});await p.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);const box=await dialog.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1);assert.ok(box.height<=900);await p.screenshot({path:path.join(out,'payroll-modal-'+width+'-'+theme+'.png')});}
  for(const summary of await dialog.locator('summary').all()){await summary.click();assert.equal(await summary.evaluate(el=>el.parentElement.open),true);await summary.click();}
  for(let n=0;n<14;n++){await p.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}
  await p.setViewportSize({width:1440,height:900});await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await opener.evaluate(el=>el===document.activeElement),true);assert.ok(Math.abs((await p.evaluate(()=>scrollY))-scroll)<=2);await p.close();
 });
 await check('HR paid-leave tab, month/search and empty state; personal disclosures',async()=>{
  const p=await contexts.hr.newPage();await p.goto('http://localhost:5176/attendance');await ready(p);await p.getByRole('button',{name:'Paid Leave',exact:true}).click();await p.getByLabel('Search approved paid leave employees',{exact:true}).fill('nonexistent');await p.getByText('No matching employees',{exact:true}).waitFor();await p.getByLabel('Search approved paid leave employees',{exact:true}).fill('');await p.getByLabel('Leave attendance month',{exact:true}).fill('2026-10');await p.getByText('No approved paid leave for this month',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Next leave page'}).count(),0);await p.close();
  for(const key of ['manager','employee']){const page=await contexts[key].newPage();await page.goto('http://localhost:5176/leaves');await ready(page);const guide=page.locator('summary').filter({hasText:'Leave policy'});await guide.waitFor();assert.equal(await guide.count(),1);await guide.click();assert.equal(await guide.evaluate(el=>el.parentElement.open),true);await page.close();}
 });
 await check('Report tabs, loaded table, existing CSV and XLSX browser downloads',async()=>{
  for(const key of ['manager','employee']){const p=await contexts[key].newPage();await p.goto('http://localhost:5176/reports');await ready(p);await p.getByRole('region',{name:'Report results'}).locator('table').waitFor();
   for(const name of ['CSV','XLSX']){const download=p.waitForEvent('download');await p.getByRole('button',{name,exact:true}).click();const file=await download;assert.equal(await file.failure(),null);}
   for(const tab of ['Attendance Details','Corrections & Decisions','Monthly Summary']){await p.getByRole('button',{name:tab,exact:true}).click();await ready(p);}await p.close();
  }
 });
 await check('Admin profile-less security, Employee/Manager self-change hidden, direct URL role guards',async()=>{
  for(const key of Object.keys(routes)){const p=await contexts[key].newPage();await p.goto('http://localhost:5176/account');await ready(p);await p.waitForURL(/\/my-profile\?.*tab=security/);assert.ok(p.url().includes('/my-profile'));assert.ok(p.url().includes('tab=security'));const change=p.getByRole('button',{name:'Change my password',exact:true});await p.getByRole('heading',{name:'Password and security',exact:true}).waitFor();assert.equal(await change.count(),['admin','hr'].includes(key)?1:0);
   if(['employee','manager'].includes(key)){await p.goto('http://localhost:5176/employees');await p.getByRole('heading',{name:'Access restricted'}).waitFor();}await p.close();
  }
 });
 await check('Network failure remains verification error; retry recovers instead of false logout',async()=>{
  const p=await contexts.employee.newPage();await p.route('**/api/auth/me',r=>r.abort('failed'));await p.goto('http://localhost:5176/dashboard');await p.getByRole('heading',{name:'Unable to verify your session'}).waitFor();assert.ok(p.url().endsWith('/dashboard'));await p.unroute('**/api/auth/me');await p.getByRole('button',{name:'Try again',exact:true}).click();await ready(p);await p.close();
 });
 await check('Report unavailable values stay within their cards at narrow widths in both themes',async()=>{
  const p=await contexts.manager.newPage();await p.route('**/api/reports/monthly*',r=>r.fulfill({status:503,json:{success:false,message:'Synthetic report unavailable'}}));
  for(const width of [320,375])for(const theme of ['light','dark']){await p.setViewportSize({width,height:900});await p.goto('http://localhost:5176/reports');await ready(p);await p.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await p.getByText('Synthetic report unavailable',{exact:true}).waitFor();
   const clipped=await p.getByText('Unavailable',{exact:true}).evaluateAll(elements=>elements.some(el=>{const card=el.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].some(r=>r.right>card.right+1||r.left<card.left-1);}));assert.equal(clipped,false);await p.screenshot({path:path.join(out,'reports-unavailable-'+width+'-'+theme+'.png'),fullPage:true});}
  await p.unroute('**/api/reports/monthly*');await p.goto('http://localhost:5176/reports');await ready(p);await p.getByRole('region',{name:'Report results'}).locator('table').waitFor();await p.close();
 });
 await check('Theme persistence, mobile drawer, keyboard focus and fresh tabs',async()=>{
  for(const key of Object.keys(routes)){const p=await contexts[key].newPage();await p.setViewportSize({width:375,height:812});await p.goto('http://localhost:5176/dashboard');await ready(p);const theme=p.getByRole('button',{name:/Switch to (light|dark) mode/});await theme.waitFor();assert.equal(await theme.count(),1);{await theme.click();const chosen=await p.evaluate(()=>localStorage.getItem('officehr-theme'));await p.reload();await ready(p);assert.equal(await p.evaluate(()=>document.documentElement.classList.contains('dark')),chosen==='dark');}
   const menu=p.getByRole('button',{name:/Open.*navigation|Open.*menu/i});await menu.waitFor();assert.equal(await menu.count(),1);await menu.click();await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'hidden'});
   const fresh=await contexts[key].newPage();await fresh.goto('http://localhost:5176/dashboard');await ready(fresh);assert.ok(!fresh.url().includes('/login'));await fresh.close();await p.close();
  }
 });
}
main().catch(e=>{results.push({name:'Browser setup/completion',result:'FAIL',detail:e.message});save();console.error(e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();if(results.some(r=>r.result==='FAIL'))process.exitCode=1;save();console.log('Evidence: '+out);});

