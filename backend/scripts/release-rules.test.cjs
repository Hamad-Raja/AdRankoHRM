'use strict';
// Portable tests: no Prisma import, database connection or environment mutation.
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const {calculatePayrollPreview:calc}=require('../src/utils/payroll-calculator');
const {instantFor,scheduleDate,resolveSchedule,addDays}=require('../src/utils/office-schedule');
const {classifyDuty}=require('../src/utils/reports-rules');
const {csvCell}=require('../src/utils/reports-export');
const {makeWorkbook}=require('../src/utils/reports-xlsx');
const policy=require('../src/validation/schedule-readiness.validation').confirmedPolicy;
const version={id:'synthetic',effectiveFrom:'2026-11-16',policy};
const episodes=[{startDate:'2026-01-01',endDate:null,status:'ACTIVE',statusEffectiveDate:'2026-01-01'}];
const person={id:'synthetic',employeeCode:'SYNTHETIC',fullName:'Synthetic',employmentEpisodes:episodes,shiftAssignments:[]};
const duty=(date,now,extra={})=>classifyDuty({employee:person,date,versions:[version],holidayDates:[],now:new Date(now),...extra});
test('manual payroll proration uses paisa, half-up and exact line-item sums',()=>{
 for(const [basic,worked,total,earned] of [['40000.00','24','30','32000.00'],['0.01','1','2','0.01'],['10000.00','1','3','3333.33'],['10000.00','2','3','6666.67']]){
  const r=calc({month:'2026-11',monthlyBasic:basic,workedDays:worked,totalPayableDays:total,currency:'PKR',earnings:[{type:'ALLOWANCE',amount:'5000.00'}],deductions:[{type:'OTHER',amount:'100.25'}]});
  assert.equal(r.earnedBasic,earned);assert.equal(r.basis,'MANUAL_DAYS');
 }assert.equal(calc({month:'2026-11',monthlyBasic:'40000',totalPayableDays:'30',workedDays:'24',earnings:[{type:'BONUS',amount:'5000'}],deductions:[{type:'TAX',amount:'100.25'}]}).netPay,'36899.75');
});
test('invalid payroll days, precision, items and negative net are rejected',()=>{
 const input={month:'2026-11',monthlyBasic:'100.00',totalPayableDays:'30',workedDays:'30'};
 for(const bad of [{workedDays:'31'},{workedDays:'-1'},{monthlyBasic:'1.001'},{totalPayableDays:'0'},{deductions:[{type:'TAX',amount:'100.01'}]},{earnings:[{type:'SETTLEMENT',amount:'1'}]}])assert.throws(()=>calc({...input,...bad}));
});
test('Karachi overnight duty has exact instants and calendar date arithmetic',()=>{
 assert.equal(instantFor('2026-11-20','19:00','Asia/Karachi').toISOString(),'2026-11-20T14:00:00.000Z');
 assert.equal(instantFor('2026-11-21','05:00','Asia/Karachi').toISOString(),'2026-11-21T00:00:00.000Z');
 assert.equal(addDays('2028-02-28',1),'2028-02-29');assert.equal(addDays('2026-12-31',1),'2027-01-01');
 const s=scheduleDate(version,'2026-11-20',[],episodes,[]);assert.equal(s.state,'SCHEDULED');assert.equal(s.endsAt,'2026-11-21T00:00:00.000Z');
});
test('weekly off and company holiday remain distinct',()=>{
 assert.equal(scheduleDate(version,'2026-11-21',[],episodes,[]).state,'WEEKLY_OFF');
 assert.equal(scheduleDate(version,'2026-11-20',[],episodes,['2026-11-20']).state,'HOLIDAY');
});
test('report cutoff never turns pending duties or open records into absence',()=>{
 assert.equal(duty('2026-11-20','2026-11-20T15:00:00Z').classification,'NOT_YET_ENDED');
 assert.equal(duty('2026-11-20','2026-11-21T00:00:00Z').classification,'NO_CLOCK_IN');
 const record={id:'record',shiftDate:'2026-11-20',clockInAt:new Date('2026-11-20T14:00:00Z'),clockOutAt:null,scheduledStart:new Date('2026-11-20T14:00:00Z'),scheduledEnd:new Date('2026-11-21T00:00:00Z'),status:'OPEN'};
 assert.equal(duty('2026-11-20','2026-11-20T15:00:00Z',{record}).classification,'OPEN');
 assert.equal(duty('2026-11-20','2026-11-21T02:00:00Z',{record}).classification,'MISSING_CHECKOUT');
});
test('leave, uncovered history and approved exceptions preserve their classifications',()=>{
 assert.equal(duty('2026-11-20','2026-11-21T02:00:00Z',{approvedLeave:{id:'leave'}}).classification,'PAID_LEAVE');
 assert.equal(duty('2026-11-13','2026-11-21T02:00:00Z').classification,'SETUP_REQUIRED');
 assert.equal(duty('2026-11-20','2026-11-21T02:00:00Z',{exception:{id:'exception',status:'APPROVED'}}).classification,'APPROVED_EXCEPTION');
});
test('CSV formula payloads and identifiers are neutralized while numeric data stays numeric',()=>{
 for(const payload of ['=1+1','+cmd','-cmd','@SUM(1)','  =1','\t=1'])assert.match(csvCell(payload),/^"'/);
 assert.match(csvCell('00123','identifier'),/^"'00123"$/);assert.equal(csvCell(12.5),'12.5');assert.throws(()=>csvCell(Infinity));
});
test('XLSX text stays typed text and XML is escaped',async()=>{
 const buffer=await makeWorkbook([{name:'Synthetic',headers:['Name'],rows:[['=SUM(1,2)'],['<script>']]}],new Date('2026-11-23T00:00:00Z'));
 const zip=await require('jszip').loadAsync(buffer),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 assert.ok(xml.includes('=SUM(1,2)'));assert.ok(!xml.includes('<f>'));assert.ok(xml.includes('&lt;script&gt;'));
});
test('shared duty presentation preserves old checkout over weekly off/future-policy labels',async()=>{
 const p=await import(pathToFileURL(path.resolve(__dirname,'../../frontend/src/lib/attendance-clock-presentation.js')).href);
 const data={state:'WEEKLY_OFF',canClockOut:true,attendance:{status:'OPEN',shiftDate:'2026-11-20',scheduledStart:'2026-11-20T14:00:00Z',scheduledEnd:'2026-11-21T00:00:00Z',scheduleTimeZone:'Asia/Karachi'}};
 const view=p.dutyPresentation(data,{state:'SCHEDULED_ACTIVATION'},null);assert.equal(view.actual,'Checked In');assert.equal(view.schedule.date,'2026-11-20');assert.match(view.explanation,/can still be checked out/);
});
test('approved activation and uncovered report periods do not invite republishing',async()=>{
 const p=await import(pathToFileURL(path.resolve(__dirname,'../../frontend/src/lib/attendance-clock-presentation.js')).href);
 const settings={draftStatus:'SCHEDULED_ACTIVATION',activeVersion:null,duty:{startTime:'19:00'},versions:[{effectiveFrom:'2026-11-24',policy,missing:[]}]};
 const message=p.approvedScheduleMessage(null,settings);assert.match(message.title,/24 November 2026/);assert.equal(message.detail,'No further setup needed.');
 const period=p.attendancePeriodMessage({state:'SETUP_REQUIRED',settings:{...settings,draftStatus:'ACTIVE',activeVersion:{id:'published'}},reports:{meta:{currentPolicyState:'EFFECTIVE_POLICY_PRESENT'}}});assert.equal(period.setupRequired,false);
});


test('login return paths retain Admin records and authorized nested reports without widening role guards',async()=>{
 const {loginDestination}=await import(pathToFileURL(path.resolve(__dirname,'../../frontend/src/lib/return-path.js')).href);
 assert.equal(loginDestination('/employee-records?tab=history','ADMIN'),'/employee-records?tab=history');
 for(const role of ['HR','MANAGER','EMPLOYEE'])assert.equal(loginDestination('/employee-records',''+role),'/dashboard');
 const report='/reports/attendance/00000000-0000-4000-8000-000000000001?month=2026-11';
 for(const role of ['ADMIN','HR','MANAGER','EMPLOYEE'])assert.equal(loginDestination(report,role),report);
 for(const bad of ['//outside.invalid','/reports/attendance/not-an-id','https://outside.invalid','/unknown'])assert.equal(loginDestination(bad,'ADMIN'),'/dashboard');
});
