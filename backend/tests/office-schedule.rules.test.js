"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSchedule, instantFor } = require('../src/utils/office-schedule');
const { settingsSchema } = require('../src/validation/attendance-settings.validation');
const policy = { timeZone:'Asia/Karachi', workDays:[1,2,3,4,5], graceMinutes:0, breakMinutes:0, breakPaid:null, holidayPolicy:'NONE', holidayFrom:null, holidayTo:null, holidays:[] };
const row = (id,effectiveFrom,p={}) => ({id,effectiveFrom,policy:{...policy,...p}});
const episodes = [{startDate:'2020-01-01',endDate:null,status:'ACTIVE'}];
const resolve = (rows, instant, assignments=[]) => resolveSchedule(rows,assignments,episodes,new Date(instant));
test('19:00–05:00 spans month/year boundaries and stays on shift-start date at 2 AM',()=>{
  for (const [now,date] of [['2027-01-01T21:00:00Z','2027-01-01'],['2026-12-31T21:00:00Z','2026-12-31'],['2028-02-29T21:00:00Z','2028-02-29']]) {
    const r=resolve([row('a','2020-01-01',{workDays:[1,2,3,4,5,6,7]})],now);
    assert.equal(r.current.scheduleDate,date); assert.equal(r.current.startsAt,`${date}T14:00:00.000Z`); assert.equal(r.applicable.scheduleDate,date);
  }
});
test('working days, weekly offs and exact end boundary use confirmed start-date policy',()=>{
  const rows=[row('a','2020-01-01')];
  assert.equal(resolve(rows,'2026-10-23T21:00:00Z').current.scheduleDate,'2026-10-23'); // Saturday 02:00, Friday duty
  const off=resolve(rows,'2026-10-24T14:00:00Z'); assert.equal(off.state,'WEEKLY_OFF'); assert.equal(off.current,null); assert.equal(off.next.scheduleDate,'2026-10-26');
  assert.equal(resolve(rows,'2026-10-24T00:00:00Z').current,null); // 05:00 exact
});
test('missing policy and unconfirmed holiday coverage never claim a working day',()=>{
  assert.equal(resolve([],'2026-10-23T14:00:00Z').state,'SETUP_REQUIRED');
  for (const key of ['timeZone','workDays','graceMinutes','breakMinutes','holidayPolicy']) assert.equal(resolve([row('a','2020-01-01',{[key]:null})],'2026-10-23T14:00:00Z').state,'SETUP_REQUIRED',key);
  assert.equal(resolve([row('a','2020-01-01',{breakMinutes:30,breakPaid:null})],'2026-10-23T14:00:00Z').state,'SETUP_REQUIRED');
  const rows=[row('a','2020-01-01',{holidayPolicy:'DATES',holidayFrom:'2026-10-01',holidayTo:'2026-10-31',holidays:['2026-10-23']})];
  assert.equal(resolve(rows,'2026-10-23T14:00:00Z').state,'HOLIDAY'); assert.equal(resolve(rows,'2026-11-02T14:00:00Z').state,'SETUP_REQUIRED');
});
test('new version does not alter ongoing previous-evening duty or invent older history',()=>{
  const rows=[row('a','2026-10-01'),row('b','2026-10-24',{graceMinutes:25,workDays:[1,2,3,4,5,6,7]})];
  const r=resolve(rows,'2026-10-23T21:00:00Z'); assert.equal(r.current.graceMinutes,0); assert.equal(r.current.scheduleDate,'2026-10-23'); assert.equal(r.next.scheduleDate,'2026-10-24'); assert.equal(r.next.graceMinutes,25);
  assert.equal(resolve(rows,'2026-09-01T14:00:00Z').state,'SETUP_REQUIRED');
});
test('legacy assignments are explicit conflicts; no common override or private legacy fields',()=>{
  const r=resolve([row('a','2020-01-01')],'2026-10-23T14:00:00Z',[{effectiveFrom:'2026-10-01',effectiveTo:null}]);
  assert.equal(r.state,'LEGACY_ASSIGNMENT_REVIEW'); assert.equal(r.current,null); assert.equal(r.next,null);
});
test('timezone conversion respects DST rather than assuming a fixed UTC offset',()=>{
  assert.equal(instantFor('2026-11-01','05:00','America/New_York').toISOString(),'2026-11-01T10:00:00.000Z');
  assert.equal(instantFor('2026-10-31','19:00','America/New_York').toISOString(),'2026-10-31T23:00:00.000Z');
});
test('strict policy validation rejects altered duty, ownership and unconfirmed holiday assumptions',()=>{
  const base={effectiveFrom:'2090-01-01',expectedPreviousId:null,reason:'Approved configuration',policy}; assert.equal(settingsSchema.safeParse(base).success,true);
  for (const patch of [{startTime:'20:00'},{endsNextDay:false},{actorUserId:'invented'}]) assert.equal(settingsSchema.safeParse({...base,...patch}).success,false);
  assert.equal(settingsSchema.safeParse({...base,policy:{...policy,holidayPolicy:'DATES'}}).success,false);
  assert.equal(settingsSchema.safeParse({...base,policy:{...policy,workDays:[1,1]}}).success,false);
});
