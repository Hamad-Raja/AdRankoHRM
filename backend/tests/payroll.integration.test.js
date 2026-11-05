"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {createIsolatedDatabase,assertTestDatabase}=require('./isolated-db');
test('Salary and payroll workflow in a guarded PostgreSQL database',{timeout:180000},async t=>{
 const db=await createIsolatedDatabase();assertTestDatabase(db.url);process.env.DATABASE_URL=db.url;process.env.NODE_ENV='test';
 let prisma,server,sql;t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect();if(sql)await sql.end();await db.cleanup();console.log('Payroll temporary database removed; original Admin unchanged.');});
 prisma=require('../src/config/prisma');const app=require('../app'),service=require('../src/services/payroll.service');
 sql=new Client({connectionString:db.url});await sql.connect();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`,origin=require('../src/config/auth').ALLOWED_ORIGINS[0],password='Payroll-fixture-123!',passwordHash=await require('../src/utils/password').hashPassword(password);
 async function account(role){const u=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',displayName:role+' payroll fixture',role,passwordHash,mustChangePassword:false}});const response=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});assert.equal(response.status,200);const data=await response.json();return {...u,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:data.data.csrfToken};}
 const admin=await account('ADMIN'),hr=await account('HR'),manager=await account('MANAGER'),staff=await account('EMPLOYEE'),other=await account('EMPLOYEE'),unlinked=await account('EMPLOYEE');
 const emp=await prisma.employee.create({data:{userId:staff.id,employeeCode:'PAY-001',fullName:'Payroll Employee'}}),mgr=await prisma.employee.create({data:{userId:manager.id,employeeCode:'PAY-002',fullName:'Payroll Manager'}});
 await prisma.employee.create({data:{userId:other.id,employeeCode:'PAY-003',fullName:'Other Employee'}});
 async function req(path,{user=hr,method='GET',body,csrf=true,requestOrigin=origin}={}){const response=await fetch(base+'/payroll'+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(user?{Cookie:user.cookie}:{}),...(user&&csrf?{'x-csrf-token':user.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),headers:response.headers};}
 const salaryInput=(effectiveMonth='2026-01',monthlyBasic='44000',expectedPreviousId=null)=>({effectiveMonth,monthlyBasic,expectedPreviousId,reason:'Salary review'});
 const draftInput=(employeeId=emp.id,month='2026-02')=>({employeeId,month,totalPayableDays:'22',workedDays:'20',earnings:[{type:'ALLOWANCE',label:'Travel allowance',amount:'2000'}],deductions:[{type:'TAX',label:'Manual tax',amount:'500'}],reason:'Monthly payroll preparation'});
 const decision=(version,reason='Reviewed payroll')=>({expectedVersion:version,reason});
 let salary,record;
 await t.test('salary history, effective selection and exact calculator/API parity',async()=>{
  const response=await req('/salaries/'+emp.id,{method:'POST',body:salaryInput()});assert.equal(response.status,200,JSON.stringify(response.body));salary=response.body.data;assert.equal(salary.revision,1);
  await service.saveSalary(admin.id,emp.id,salaryInput('2027-01','50000'));
  const preview=await req('/preview',{method:'POST',body:(({reason,...v})=>v)(draftInput())});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.data.salaryVersionId,salary.id);assert.equal(preview.body.data.earnedBasic,'40000.00');assert.equal(preview.body.data.netPay,'41500.00');
  const wrong=await req('/preview',{method:'POST',body:{...draftInput(),monthlyBasic:'1'}});assert.equal(wrong.status,400);
  const responseDraft=await req('',{method:'POST',body:draftInput()});assert.equal(responseDraft.status,200,JSON.stringify(responseDraft.body));record=responseDraft.body.data;assert.equal(record.netPay,preview.body.data.netPay);assert.equal(record.period.dateTo,'2026-02-28');
  assert.equal((await service.salaryHistory(hr.id,emp.id)).versions.length,2);
 });
 await t.test('draft validation, optional adjustments, zero net and stale edits',async()=>{
  assert.equal((await req('/'+record.id,{method:'PATCH',body:{...decision(999),totalPayableDays:'22',workedDays:'20'}})).status,409);
  for(const changes of [{totalPayableDays:'0'},{workedDays:'22.01'},{workedDays:'1.001'},{deductions:[{type:'OTHER',label:'Too much',amount:'99999'}]}])assert.equal((await req('/preview',{method:'POST',body:{employeeId:emp.id,month:'2026-02',totalPayableDays:'22',workedDays:'20',...changes}})).status,400);
  const zero=await service.preview(hr.id,{employeeId:emp.id,month:'2026-02',totalPayableDays:'31',workedDays:'0'});assert.equal(zero.netPay,'0.00');
  const edited=await req('/'+record.id,{method:'PATCH',body:{...decision(record.version),totalPayableDays:'22',workedDays:'20',earnings:draftInput().earnings,deductions:draftInput().deductions}});assert.equal(edited.status,200,JSON.stringify(edited.body));record=edited.body.data;assert.equal(record.version,2);
 });
 await t.test('role restrictions, CSRF/origin and client provenance injection',async()=>{
  for(const user of [manager,staff]){assert.equal((await req('',{user})).status,403);assert.equal((await req('/salaries/'+emp.id,{user})).status,403);assert.equal((await req('/'+record.id,{user})).status,403);}
  assert.equal((await req('',{user:null})).status,401);
  assert.equal((await req('/salaries/'+emp.id,{method:'POST',csrf:false,body:salaryInput()})).status,403);
  assert.equal((await req('/salaries/'+emp.id,{method:'POST',requestOrigin:'https://hostile.invalid',body:salaryInput()})).status,403);
  assert.equal((await req('',{method:'POST',body:{...draftInput(emp.id,'2026-03'),status:'APPROVED'}})).status,400);
  assert.equal((await req('/'+record.id+'/hr-approve',{user:admin,method:'POST',body:decision(record.version)})).status,403);
  assert.equal((await req('/'+record.id+'/approve',{user:admin,method:'POST',body:decision(record.version)})).status,409);
  assert.equal((await req('/'+record.id+'/hr-approve',{method:'POST',body:decision(2147483648)})).status,400);
  assert.equal((await req('?page=1000001')).status,400);
  assert.equal((await req('/payslips',{user:unlinked})).body.code,'PROFILE_LINK_REQUIRED');
  await prisma.user.update({where:{id:hr.id},data:{mustChangePassword:true}});
  assert.equal((await req('')).status,403);await prisma.user.update({where:{id:hr.id},data:{mustChangePassword:false}});
 });
 await t.test('HR approval, return reason and historical decisions',async()=>{
  record=await service.mutate(hr.id,record.id,decision(record.version),'hr-approve');assert.equal(record.status,'HR_APPROVED');
  await assert.rejects(service.mutate(admin.id,record.id,{...decision(record.version),totalPayableDays:'22',workedDays:'20'},'edit'),e=>e.code==='INVALID_TRANSITION');
  record=await service.mutate(admin.id,record.id,decision(record.version,'Needs review'),'return');assert.equal(record.status,'DRAFT');
  const history=await service.detail(hr.id,record.id);assert.ok(history.history.some(h=>h.action==='PAYROLL_HR_APPROVE'));assert.ok(history.history.some(h=>h.action==='PAYROLL_RETURN'));
 });
 await t.test('salary revisions stale drafts/HR approvals; recalculation restores approval',async()=>{
  salary=await service.saveSalary(hr.id,emp.id,salaryInput('2026-01','45000',salary.id));assert.equal(salary.revision,2);
  await assert.rejects(service.mutate(hr.id,record.id,decision(record.version),'hr-approve'),e=>e.code==='SALARY_STALE');
  record=await service.mutate(hr.id,record.id,{...decision(record.version),totalPayableDays:'22',workedDays:'20'},'edit');
  record=await service.mutate(hr.id,record.id,decision(record.version),'hr-approve');
  salary=await service.saveSalary(hr.id,emp.id,salaryInput('2026-01','46000',salary.id));
  await assert.rejects(service.mutate(admin.id,record.id,decision(record.version),'approve'),e=>e.code==='SALARY_STALE');
  record=await service.mutate(hr.id,record.id,decision(record.version,'Salary changed'),'return');record=await service.mutate(hr.id,record.id,{...decision(record.version),totalPayableDays:'22',workedDays:'20'},'edit');record=await service.mutate(hr.id,record.id,decision(record.version),'hr-approve');record=await service.mutate(admin.id,record.id,decision(record.version),'approve');assert.equal(record.status,'APPROVED');
 });
 await t.test('approved snapshots immutable; distinct approver accounts enforced',async()=>{
  await assert.rejects(sql.query('UPDATE payroll_records SET "netPay"=1,version=version+1 WHERE id=$1',[record.id]));
  await assert.rejects(sql.query('DELETE FROM payroll_records WHERE id=$1',[record.id]));
  await assert.rejects(sql.query('UPDATE employee_salary_versions SET "monthlyBasic"=1 WHERE id=$1',[salary.id]));
  await assert.rejects(sql.query('DELETE FROM audit_logs WHERE "targetType"=\'Payroll\' AND "targetId"=$1',[record.id]));
  const before=(await service.detail(hr.id,record.id)).netPay;await service.saveSalary(admin.id,emp.id,salaryInput('2026-02','99999'));assert.equal((await service.detail(hr.id,record.id)).netPay,before);
  await service.saveSalary(hr.id,mgr.id,salaryInput());let same=await service.createDraft(hr.id,draftInput(mgr.id));same=await service.mutate(hr.id,same.id,decision(same.version),'hr-approve');
  await prisma.user.update({where:{id:hr.id},data:{role:'ADMIN'}});await assert.rejects(service.mutate(hr.id,same.id,decision(same.version),'approve'),e=>e.code==='FORBIDDEN');await prisma.user.update({where:{id:hr.id},data:{role:'HR'}});
 });
 await t.test('own approved payslip visibility and private response fields',async()=>{
  const own=await req('/payslips/'+record.id,{user:staff});assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');assert.equal(own.body.data.netPay,record.netPay);for(const key of ['history','changeReason','salaryVersionId','createdByUserId','hrApprovedByUserId'])assert.equal(key in own.body.data,false);
  assert.equal((await req('/payslips/'+record.id,{user:other})).status,404);assert.equal((await req('/payslips/'+record.id,{user:manager})).status,404);
  assert.equal((await req('/payslips?employeeId='+emp.id,{user:other})).status,403);
  assert.equal((await req('/payslips',{user:manager})).body.data.total,0);
 });
 await t.test('one full manual payment and PAID transition are atomic and immutable',async()=>{
  await assert.rejects(sql.query('UPDATE payroll_records SET status=\'PAID\',"paidAt"=now(),"paidByUserId"=$2,"updatedByUserId"=$2,version=version+1 WHERE id=$1',[record.id,admin.id]));
  await assert.rejects(sql.query(`INSERT INTO payroll_payments (id,"payrollRecordId",amount,currency,method,"paidOn","actorUserId") SELECT gen_random_uuid(),id,"netPay",'PKR','CASH','2026-10-01'::date,$2 FROM payroll_records WHERE id=$1`,[record.id,hr.id]),e=>e.code==='23514');
  assert.equal((await req('/'+record.id+'/pay',{user:admin,method:'POST',body:{...decision(record.version),method:'BANK_TRANSFER',paidOn:'2026-10-01'}})).status,400);
  const results=await Promise.allSettled([admin,hr].map(u=>service.mutate(u.id,record.id,{...decision(record.version),method:'BANK_TRANSFER',paidOn:'2026-10-01',reference:'Guarded bank record',note:'Internal note'},'pay')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);record=results.find(r=>r.status==='fulfilled').value;assert.equal(record.status,'PAID');assert.equal(record.payment.amount,record.netPay);assert.equal(await prisma.payrollPayment.count({where:{payrollRecordId:record.id}}),1);
  await assert.rejects(sql.query('UPDATE payroll_payments SET amount=1 WHERE "payrollRecordId"=$1',[record.id]));
  const own=(await req('/payslips/'+record.id,{user:staff})).body.data;assert.equal(own.payment.amount,record.netPay);assert.equal('reference' in own.payment,false);assert.equal('note' in own.payment,false);
 });
 await t.test('concurrent duplicate creation, salary revision and stale version safeguards',async()=>{
  const input=draftInput(emp.id,'2026-03'),created=await Promise.allSettled([admin,hr].map(u=>service.createDraft(u.id,input)));assert.equal(created.filter(r=>r.status==='fulfilled').length,1);
  const stale=await Promise.allSettled([1,2].map(()=>service.saveSalary(hr.id,emp.id,salaryInput('2026-04','47000'))));assert.equal(stale.filter(r=>r.status==='fulfilled').length,1);
  const draft=created.find(r=>r.status==='fulfilled').value,edited=await Promise.allSettled([admin,hr].map(u=>service.mutate(u.id,draft.id,{...decision(draft.version),totalPayableDays:'22',workedDays:'20'},'edit')));assert.equal(edited.filter(r=>r.status==='fulfilled').length,1);
  const filtered=await service.list(hr.id,{month:'2026-03',search:'Payroll Employee',page:1,pageSize:1});assert.equal(filtered.total,1);assert.equal(filtered.records.length,1);
 });
 await t.test('audit failure rolls back draft, approval and payment changes',async()=>{
  let p=await service.createDraft(hr.id,draftInput(emp.id,'2026-05'));
  await sql.query(`CREATE FUNCTION reject_payroll_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."targetType"='Payroll' THEN RAISE EXCEPTION 'Intentional audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_payroll_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_payroll_audit()`);
  try{await assert.rejects(service.saveSalary(hr.id,emp.id,salaryInput('2026-11','48000')));assert.equal(await prisma.employeeSalaryVersion.count({where:{effectiveMonth:new Date('2026-11-01')}}),0);await assert.rejects(service.createDraft(hr.id,draftInput(emp.id,'2026-06')));assert.equal(await prisma.payrollRecord.count({where:{payrollMonth:new Date('2026-06-01')}}),0);await assert.rejects(service.mutate(hr.id,p.id,decision(p.version),'hr-approve'));assert.equal((await service.detail(hr.id,p.id)).status,'DRAFT');}
  finally{await sql.query('DROP TRIGGER test_payroll_audit ON audit_logs');}
  p=await service.mutate(hr.id,p.id,decision(p.version),'hr-approve');p=await service.mutate(admin.id,p.id,decision(p.version),'approve');
  await sql.query('CREATE TRIGGER test_payroll_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_payroll_audit()');
  try{await assert.rejects(service.mutate(admin.id,p.id,{...decision(p.version),method:'CASH',paidOn:'2026-10-01'},'pay'));assert.equal((await service.detail(hr.id,p.id)).status,'APPROVED');assert.equal(await prisma.payrollPayment.count({where:{payrollRecordId:p.id}}),0);}
  finally{await sql.query('DROP TRIGGER test_payroll_audit ON audit_logs; DROP FUNCTION reject_payroll_audit()');}
 });
 await t.test('direct database constraints reject inconsistent finances, invalid months and forged approvals; zero payment is valid',async()=>{
  const p=await service.createDraft(hr.id,draftInput(emp.id,'2026-07'));
  const foreignSalary=await prisma.employeeSalaryVersion.findFirst({where:{employeeId:mgr.id}});
  for(const [statement,values] of [
   ['UPDATE payroll_records SET "salaryVersionId"=$2,version=version+1 WHERE id=$1',[p.id,foreignSalary.id]],
   ['UPDATE payroll_records SET "netPay"=1,version=version+1 WHERE id=$1',[p.id]],
   ['UPDATE payroll_records SET "totalPayableDays"=0,version=version+1 WHERE id=$1',[p.id]],
   ['UPDATE payroll_records SET earnings=\'[{"type":"BONUS","label":"Bad precision","amount":"1.001"}]\'::jsonb,version=version+1 WHERE id=$1',[p.id]],
   ['UPDATE payroll_records SET status=\'HR_APPROVED\',"updatedByUserId"=$2,"hrApprovedByUserId"=$2,"hrApprovedAt"=now(),version=version+1 WHERE id=$1',[p.id,admin.id]],
   ['INSERT INTO employee_salary_versions (id,"employeeId","effectiveMonth",revision,"monthlyBasic","actorUserId",reason) VALUES (gen_random_uuid(),$1,\'2026-08-02\',1,100,$2,\'Bad month\')',[emp.id,hr.id]],
  ])await assert.rejects(sql.query(statement,values),e=>e.code==='23514');
  let zero=await service.createDraft(hr.id,{employeeId:emp.id,month:'2026-08',totalPayableDays:'31',workedDays:'0',reason:'Zero pay fixture'});
  zero=await service.mutate(hr.id,zero.id,decision(zero.version),'hr-approve');zero=await service.mutate(admin.id,zero.id,decision(zero.version),'approve');zero=await service.mutate(hr.id,zero.id,{...decision(zero.version),method:'CASH',paidOn:'2026-10-01'},'pay');assert.equal(zero.netPay,'0.00');assert.equal(zero.payment.amount,'0.00');
 });
});
