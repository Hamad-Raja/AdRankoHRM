'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createIsolatedDatabase}=require('./isolated-db');
test('attendance rejects oversized page numbers before database pagination',{timeout:30000},async t=>{
 const db=await createIsolatedDatabase();process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';let prisma,server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect();await db.cleanup();});
 prisma=require('../src/config/prisma');const password='Pagination-fixture-123!',u=await prisma.user.create({data:{email:'pagination@example.invalid',displayName:'Pagination fixture',role:'EMPLOYEE',mustChangePassword:false,passwordHash:await require('../src/utils/password').hashPassword(password)}});
 await prisma.employee.create({data:{userId:u.id,employeeCode:'PAGINATION',fullName:'Pagination fixture'}});
 server=require('../app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0];
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 for(const endpoint of ['history','all','corrections']){const response=await fetch(base+`/attendance/${endpoint}?page=999999999&pageSize=100`,{headers:{Cookie:cookie,Origin:origin}});assert.equal(response.status,400,endpoint);assert.equal((await response.json()).code,'VALIDATION_ERROR');}
});
