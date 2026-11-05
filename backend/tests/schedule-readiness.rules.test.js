"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {confirmedPolicy,policySchema,draftSchema,activationSchema}=require('../src/validation/schedule-readiness.validation');
const {resolveSchedule,missingPolicy}=require('../src/utils/office-schedule');
const episodes=[{startDate:'2020-01-01',endDate:null,status:'ACTIVE'}],versions=[{id:'original',effectiveFrom:'2020-01-01',policy:confirmedPolicy}];
test('confirmed settings encode disabled mechanisms without a break duration or unpaid allowance',()=>{
 assert.deepEqual(confirmedPolicy,{timeZone:'Asia/Karachi',workDays:[1,2,3,4,5],graceMinutes:30,breakTrackingEnabled:false,automaticBreakDeduction:false,holidayPolicy:'COMPANY_ANNOUNCED'});
 assert.deepEqual(missingPolicy(confirmedPolicy),[]);assert.equal(policySchema.safeParse(confirmedPolicy).success,true);
 for(const patch of [{breakTrackingEnabled:true},{automaticBreakDeduction:true},{breakMinutes:0},{breakPaid:false},{holidayPolicy:'NONE'}])assert.equal(policySchema.safeParse({...confirmedPolicy,...patch}).success,false);
});
test('inactive draft accepts no date while activation requires a selected date and draft identity',()=>{
 assert.equal(draftSchema.safeParse({expectedPreviousId:null,reason:'Approved settings',policy:confirmedPolicy}).success,true);
 assert.equal(draftSchema.safeParse({expectedPreviousId:null,reason:'Approved settings',policy:confirmedPolicy,effectiveFrom:'2026-10-23'}).success,false);
 assert.equal(activationSchema.safeParse({expectedPreviousId:null,reason:'Approved settings'}).success,false);
});
test('empty announced list means no recorded closures, not a no-holidays policy or missing coverage',()=>{
 const result=resolveSchedule(versions,[],episodes,new Date('2026-10-23T14:00:00Z'),[]);assert.equal(result.state,'SCHEDULED');assert.equal(result.current.graceMinutes,30);assert.equal(result.current.scheduledSpanMinutes,600);assert.equal(result.current.breakMinutes,null);assert.equal(result.current.breakPaid,null);
 const holiday=resolveSchedule(versions,[],episodes,new Date('2026-10-23T14:00:00Z'),['2026-10-23']);assert.equal(holiday.state,'HOLIDAY');assert.equal(holiday.current,null);assert.equal(holiday.next.scheduleDate,'2026-10-26');
});
test('Friday remains scheduled at Saturday 02:00; weekend starts are weekly offs',()=>{
 const overnight=resolveSchedule(versions,[],episodes,new Date('2026-10-23T21:00:00Z'));assert.equal(overnight.current.scheduleDate,'2026-10-23');
 for(const day of ['2026-10-24','2026-10-25'])assert.equal(resolveSchedule(versions,[],episodes,new Date(day+'T14:00:00Z')).state,'WEEKLY_OFF');
});
test('confirmed policy crosses year/month/leap-day boundaries and keeps previous-night version',()=>{
 for(const date of ['2026-12-31','2027-01-01','2028-02-29'])assert.equal(resolveSchedule(versions,[],episodes,new Date(date+'T21:00:00Z')).current.scheduleDate,date);
 const changed=[...versions,{id:'next',effectiveFrom:'2026-10-26',policy:{...confirmedPolicy,graceMinutes:35}}];
 const old=resolveSchedule(changed,[],episodes,new Date('2026-10-23T21:00:00Z'));assert.equal(old.current.graceMinutes,30);assert.equal(old.next.graceMinutes,35);
});
