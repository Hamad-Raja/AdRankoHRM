'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
async function main(){
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';let prisma;
 try{
  prisma=require('../src/config/prisma');const hr=await prisma.user.create({data:{email:'summary-benchmark@example.invalid',displayName:'Isolated benchmark HR',role:'HR',passwordHash:'not-a-login-fixture',mustChangePassword:false}});
  for(let i=0;i<40;i++)await prisma.employee.create({data:{employeeCode:'BENCH-'+i,fullName:'Synthetic employee '+i,employmentEpisodes:{create:{startDate:new Date('2020-01-01'),status:'ACTIVE',statusEffectiveDate:new Date('2020-01-01')}}}});
  await prisma.officeSchedule.create({data:{effectiveFrom:new Date('2020-01-01'),policy:require('../src/validation/schedule-readiness.validation').confirmedPolicy,actorUserId:hr.id,reason:'Disposable benchmark only'}});
  const service=require('../src/services/attendance.service'),original=prisma.$transaction.bind(prisma);let queries=0;
  prisma.$transaction=(work,options)=>original(tx=>work(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);if(value&&typeof value==='object')return new Proxy(value,{get(model,name){const method=Reflect.get(model,name,model);return typeof method==='function'?(...args)=>{queries++;return method.apply(model,args);}:method;}});return typeof value==='function'?value.bind(target):value;}})),options);
  const samples=[];for(let i=0;i<3;i++){queries=0;const start=performance.now(),result=await service.getDailySummary(hr.id,'2026-01-06');assert.equal(result.classifications.length,40);samples.push({queries,elapsedMs:Number((performance.now()-start).toFixed(2))});}
  const result={employees:40,samples};const output=process.argv[2];if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(prisma)await prisma.$disconnect();await db.cleanup();console.log('Benchmark database removed.');}
}
main().catch(e=>{console.error('Benchmark failed:',e.code||e.name);process.exitCode=1;});
