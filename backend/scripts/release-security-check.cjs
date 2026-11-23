'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const database=process.env.RELEASE_TEST_DATABASE_URL;let target;try{target=new URL(database);}catch{throw Error('Explicit disposable database required.');}
if(target.hostname!=='127.0.0.1'||target.port!=='55439'||!/^officehr_release_test_[a-z0-9_]+$/.test(target.pathname.slice(1)))throw Error('Refusing normal database.');
Object.assign(process.env,{DATABASE_URL:database,NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5177',OFFICEHR_LOCAL_DEMO_ENABLED:'false',OFFICEHR_PRODUCTION_DEMO_ENABLED:'false'});
const root=path.resolve(__dirname,'../..'),out=path.join(root,'reports/release-audit'),{chromium}=require(path.join(root,'frontend/node_modules/playwright-core'));
const results=[];let prisma,browser,server;
async function main(){
 prisma=require('../src/config/prisma');assert.equal((await prisma.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,target.pathname.slice(1));
 const password='Synthetic-security-'+randomUUID(),passwordHash=await require('../src/utils/password').hashPassword(password),accounts={};
 server=await new Promise(resolve=>{const s=require('../app').listen(3021,'127.0.0.1',()=>resolve(s));});browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const role of ['ADMIN','HR','MANAGER','EMPLOYEE']){
  accounts[role]=await prisma.user.create({data:{email:role.toLowerCase()+'-'+randomUUID()+'@security.invalid',displayName:'Synthetic security '+role,role,status:'ACTIVE',mustChangePassword:true,passwordHash}});
  const ctx=await browser.newContext();
  async function login(pass){return ctx.request.post('http://localhost:3021/api/auth/login',{data:{email:accounts[role].email,password:pass},headers:{origin:process.env.FRONTEND_ORIGIN}});}
  let response=await login(password);assert.equal(response.status(),200);
  const initial=await response.json();assert.equal(initial.data.user.mustChangePassword,['HR','ADMIN'].includes(role));
  const cookies=await ctx.cookies('http://localhost:3021'),csrf=cookies.find(c=>c.name==='officehr_csrf').value;
  const auth={origin:process.env.FRONTEND_ORIGIN,'x-csrf-token':csrf};
  if(['ADMIN','HR'].includes(role)){
   response=await ctx.request.get('http://localhost:3021/api/employees');assert.equal(response.status(),403);assert.equal((await response.json()).code,'PASSWORD_CHANGE_REQUIRED');
   const next=password+'X';response=await ctx.request.post('http://localhost:3021/api/auth/change-password',{data:{currentPassword:password,newPassword:next},headers:auth});assert.equal(response.status(),200);
   assert.equal((await ctx.request.get('http://localhost:3021/api/auth/me')).status(),401);assert.equal((await login(next)).status(),200);
   assert.equal((await prisma.user.findUnique({where:{id:accounts[role].id}})).mustChangePassword,false);
  }else{
   response=await ctx.request.post('http://localhost:3021/api/auth/change-password',{data:{currentPassword:password,newPassword:password+'X'},headers:auth});assert.equal(response.status(),403);
   assert.equal((await prisma.user.findUnique({where:{id:accounts[role].id}})).passwordHash,passwordHash);
  }
  results.push({scenario:'First-login and self-password permissions',role,result:'PASS'});
  const session=await prisma.userSession.findFirst({where:{userId:accounts[role].id,revokedAt:null},orderBy:{createdAt:'desc'}});
  await prisma.userSession.update({where:{id:session.id},data:{expiresAt:new Date(Date.now()-1)}});
  assert.equal((await ctx.request.get('http://localhost:3021/api/auth/me')).status(),401);results.push({scenario:'Absolute session expiry',role,result:'PASS'});
 }
 const client=await browser.newContext();
 for(let n=0;n<101;n++){const r=await client.request.post('http://localhost:3021/api/auth/login',{data:{},headers:{origin:process.env.FRONTEND_ORIGIN}});assert.equal(r.status(),n<100?400:429);}
 results.push({scenario:'100-attempt login rate limit; malformed attempts consume quota',result:'PASS'});
 const metadata=await prisma.auditLog.findMany({where:{actorUserId:{in:Object.values(accounts).map(u=>u.id)}},select:{metadata:true}});
 assert.ok(!JSON.stringify(metadata).includes(password));assert.ok(!JSON.stringify(metadata).includes(passwordHash));results.push({scenario:'No passwords or hashes in password audit metadata',result:'PASS'});
 console.log(JSON.stringify(results));
}
main().catch(e=>{results.push({scenario:'Security checks',result:'FAIL',detail:e.message});console.error(e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();fs.writeFileSync(path.join(out,'security-results.json'),JSON.stringify(results,null,2));});

