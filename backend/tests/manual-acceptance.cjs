'use strict';
// Explicit disposable environment for human QA. Never reuses the configured DB.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomBytes}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
async function main(){
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'officehr-manual-acceptance-'));let prisma,api,vite;
 try{
  process.env.DATABASE_URL=db.url;process.env.DOCUMENT_STORAGE_DIR=path.join(temporary,'documents');process.env.NODE_ENV='development';process.env.FRONTEND_ORIGIN='http://127.0.0.1:4200';
  prisma=require('../src/config/prisma');const credentials=[],users={};
  for(const [name,role] of [['ADMIN','ADMIN'],['HR','HR'],['HR2','HR'],['MANAGER','MANAGER'],['EMPLOYEE','EMPLOYEE']]){
   const password='QA-'+randomBytes(15).toString('hex');
   users[name]=await prisma.user.create({data:{email:name.toLowerCase()+'@qa.example.invalid',displayName:'Disposable QA '+name,role,passwordHash:await require('../src/utils/password').hashPassword(password),mustChangePassword:false}});
   credentials.push(`${name}: ${users[name].email}\nTemporary fixture password: ${password}\n`);
  }
  const unit=(kind,name,extra={})=>prisma.organizationUnit.create({data:{kind,name,actorUserId:users.ADMIN.id,reason:'Disposable manual QA fixture',...extra}});
  const department=await unit('DEPARTMENT','QA Department'),campaign=await unit('CAMPAIGN','QA Campaign'),designation=await unit('DESIGNATION','QA Designation');const team=await unit('TEAM','QA Team',{departmentId:department.id,campaignId:campaign.id});
  for(const name of ['HR','HR2','MANAGER','EMPLOYEE']){
   const employee=await prisma.employee.create({data:{userId:users[name].id,employeeCode:'QA-'+name,fullName:'Disposable QA '+name,employmentEpisodes:{create:{startDate:new Date('2020-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2020-01-01')}}}});
   if(name==='EMPLOYEE')await prisma.organizationAssignment.create({data:{employeeId:employee.id,teamId:team.id,designationId:designation.id,effectiveFrom:new Date('2020-01-01'),actorUserId:users.ADMIN.id,reason:'Disposable QA team membership'}});
  }
  await prisma.teamManagerAssignment.create({data:{teamId:team.id,managerUserId:users.MANAGER.id,effectiveFrom:new Date('2020-01-01'),actorUserId:users.ADMIN.id,reason:'Disposable QA manager'}});
  await prisma.officeScheduleDraft.create({data:{revision:1,policy:require('../src/validation/schedule-readiness.validation').confirmedPolicy,actorUserId:users.ADMIN.id,reason:'Disposable inactive draft; activation requires explicit QA action'}});
  const accountFile=path.join(temporary,'accounts.txt');fs.writeFileSync(accountFile,credentials.join('\n'),{mode:0o600});
  api=require('../app').listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));process.env.VITE_API_URL=`http://127.0.0.1:${api.address().port}/api`;
  const root=path.resolve(__dirname,'../../frontend'),{createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);vite=await createServer({root,cacheDir:path.join(temporary,'vite'),server:{host:'127.0.0.1',port:4200,strictPort:true}});await vite.listen();
  console.log('Disposable QA application: http://127.0.0.1:4200');console.log('Synthetic account credentials are in: '+accountFile);console.log('Attendance starts inactive. Ctrl+C removes this disposable database, documents and credentials. Normal OfficeHR is unchanged.');
  if(process.argv.includes('--smoke')){
   if((await fetch(process.env.VITE_API_URL+'/health')).status!==200||(await fetch(process.env.FRONTEND_ORIGIN+'/login')).status!==200)throw new Error('QA health check failed');
   console.log('Disposable manual environment smoke check passed.');return;
  }
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }finally{
  if(vite)await vite.close();if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}if(prisma)await prisma.$disconnect();await db.cleanup();
  // This exact directory was created above; never delete a configured user path.
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir()))throw new Error('Unexpected QA temporary directory');
  fs.rmSync(temporary,{recursive:true,force:true});console.log('Disposable QA database, documents, credentials, cache and listeners removed.');
 }
}
main().catch(e=>{console.error('Manual environment failed:',e.code||e.name);process.exitCode=1;});
