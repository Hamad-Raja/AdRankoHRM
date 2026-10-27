"use strict";
const { actor, audit, transaction, fail } = require('./organization.service');
const { dateValue, dateString } = require('../utils/shift-rules');
const { localParts, instantFor, missingPolicy, resolveSchedule } = require('../utils/office-schedule');
const schemas = require('../validation/schedule-readiness.validation');
function parse(schema, data) { const result=schema.safeParse(data); if(!result.success) fail(400,'Invalid scheduling input. Check required values and disabled break flags.','VALIDATION_ERROR'); return result.data; }
const serialize = row => ({ ...row, effectiveFrom: dateString(row.effectiveFrom) });
const effectiveInstant = row => row.policy.timeZone ? instantFor(dateString(row.effectiveFrom),'19:00',row.policy.timeZone) : null;
function activeVersion(versions,now) { return versions.filter(v => effectiveInstant(v) && effectiveInstant(v) <= now).at(-1) || null; }
async function settings(userId) {
  return transaction(async tx => {
    await actor(tx, userId);
    const versions = await tx.officeSchedule.findMany({ orderBy: { effectiveFrom: 'asc' } });
    const draft=await tx.officeScheduleDraft.findFirst({orderBy:{revision:'desc'},include:{activation:{select:{id:true,effectiveFrom:true,policy:true}}}});
    const now=new Date(),active=activeVersion(versions,now);
    const holidays=await tx.companyHolidayEvent.findMany({orderBy:[{holidayDate:'desc'},{revision:'desc'}]});
    const latestHolidayIds=new Map();for(const event of holidays){const date=dateString(event.holidayDate);if(!latestHolidayIds.has(date))latestHolidayIds.set(date,event.id);}
    return { duty: { startTime: '19:00', endTime: '05:00', endsNextDay: true }, asOf:now.toISOString(), confirmedPolicy:schemas.confirmedPolicy,
      draft:draft?{...draft,activation:draft.activation?{id:draft.activation.id,effectiveFrom:dateString(draft.activation.effectiveFrom)}:null}:null,
      draftStatus:!draft?'NOT_SAVED':!draft.activation?'PENDING_ACTIVATION':effectiveInstant(draft.activation)>now?'SCHEDULED_ACTIVATION':'ACTIVE',
      activeVersion:active?serialize(active):null,holidayEvents:holidays.map(e=>({...e,holidayDate:dateString(e.holidayDate),canCancel:e.action==='ANNOUNCE'&&latestHolidayIds.get(dateString(e.holidayDate))===e.id&&instantFor(dateString(e.holidayDate),'19:00',versions.filter(v=>v.effectiveFrom<=e.holidayDate).at(-1)?.policy.timeZone||schemas.confirmedPolicy.timeZone)>now})),
      versions: versions.map(row => ({ ...serialize(row), missing: missingPolicy(row.policy) })), legacyAssignmentCount: await tx.employeeShiftAssignment.count() };
  });
}
async function appendVersion(tx,userId,data,draftId=null) {
    const previous = await tx.officeSchedule.findFirst({ orderBy: { effectiveFrom: 'desc' } });
    if ((previous?.id || null) !== data.expectedPreviousId) fail(409, 'Office settings changed. Reload before saving another version.', 'SCHEDULE_VERSION_CONFLICT');
    if (previous && data.effectiveFrom <= dateString(previous.effectiveFrom)) fail(409, 'New versions must follow the latest effective date. Earlier schedules cannot be rewritten.', 'SCHEDULE_DATE_CONFLICT');
    const zone = data.policy.timeZone || previous?.policy.timeZone;
    const today = zone ? localParts(new Date(), zone).date : new Date().toISOString().slice(0,10);
    const begins = zone ? instantFor(data.effectiveFrom, '19:00', zone) : null;
    if (data.effectiveFrom < today || (begins && begins <= new Date()) || (zone && !begins)) fail(400, 'Choose a future shift-start date/time. Historical or ongoing shifts cannot be changed.');
    if (previous?.policy.timeZone && data.policy.timeZone && previous.policy.timeZone !== data.policy.timeZone) {
      const previousEnd = instantFor(data.effectiveFrom, '05:00', previous.policy.timeZone);
      if (!previousEnd || begins < previousEnd) fail(409, 'Timezone change would overlap the preceding overnight duty. Choose a compatible timezone/effective date.', 'TIMEZONE_CONFLICT');
    }
    const row = await tx.officeSchedule.create({ data: { effectiveFrom: dateValue(data.effectiveFrom), policy: data.policy, actorUserId: userId, reason: data.reason, startTime: '19:00', endTime: '05:00', endsNextDay: true, draftId } });
    await audit(tx, userId, 'OFFICE_SCHEDULE_CONFIGURED', row.id, { effectiveFrom: data.effectiveFrom, previousId: previous?.id || null });
    return serialize(row);
}
async function saveDraft(userId,input) {
  const data=parse(schemas.draftSchema,input);
  return transaction(async tx=>{
    await actor(tx,userId);
    const latest=await tx.officeScheduleDraft.findFirst({orderBy:{revision:'desc'}});
    if((latest?.id||null)!==data.expectedPreviousId)fail(409,'Draft changed. Reload before saving a revision.','DRAFT_VERSION_CONFLICT');
    const draft=await tx.officeScheduleDraft.create({data:{revision:(latest?.revision||0)+1,policy:data.policy,actorUserId:userId,reason:data.reason}});
    await audit(tx,userId,'OFFICE_SCHEDULE_DRAFT_SAVED',draft.id,{revision:draft.revision,previousId:latest?.id||null});
    return draft;
  });
}
async function activate(userId,input) {
  const data=parse(schemas.activationSchema,input);
  return transaction(async tx=>{
    await actor(tx,userId);
    const draft=await tx.officeScheduleDraft.findFirst({orderBy:{revision:'desc'},include:{activation:{select:{id:true}}}});
    if(!draft||draft.id!==data.draftId||draft.activation)fail(409,'Select the current unactivated draft. Reload settings.','DRAFT_VERSION_CONFLICT');
    const policy=parse(schemas.policySchema,draft.policy);
    if(!policy.workDays.includes(dateValue(data.effectiveFrom).getUTCDay()||7))fail(400,'Choose an approved working-day duty start for activation.','ACTIVATION_NOT_WORKDAY');
    const holiday=await tx.companyHolidayEvent.findFirst({where:{holidayDate:dateValue(data.effectiveFrom)},orderBy:{revision:'desc'}});
    if(holiday?.action==='ANNOUNCE')fail(409,'Activation cannot begin on an approved company holiday. Choose a scheduled duty start.','ACTIVATION_HOLIDAY');
    return appendVersion(tx,userId,{...data,policy},draft.id);
  });
}
async function upcoming(tx,date, now=new Date()) {
  const version=await tx.officeSchedule.findFirst({where:{effectiveFrom:{lte:dateValue(date)}},orderBy:{effectiveFrom:'desc'},select:{policy:true}});
  const start=instantFor(date,'19:00',version?.policy.timeZone||schemas.confirmedPolicy.timeZone);
  if(!start||start<=now)fail(409,'Announcements cannot change a duty that has already started. Select an upcoming shift-start date.','HOLIDAY_ALREADY_STARTED');
}
async function announceHoliday(userId,input) {
  const data=parse(schemas.holidaySchema,input);
  return transaction(async tx=>{
    await actor(tx,userId);await upcoming(tx,data.holidayDate);
    const latest=await tx.companyHolidayEvent.findFirst({where:{holidayDate:dateValue(data.holidayDate)},orderBy:{revision:'desc'}});
    if((latest?.id||null)!==data.expectedPreviousId||latest?.action==='ANNOUNCE')fail(409,'Announcement changed or this date already has an approved announcement. Reload.','HOLIDAY_VERSION_CONFLICT');
    const event=await tx.companyHolidayEvent.create({data:{holidayDate:dateValue(data.holidayDate),revision:(latest?.revision||0)+1,action:'ANNOUNCE',actorUserId:userId,reason:data.reason}});
    await audit(tx,userId,'COMPANY_HOLIDAY_ANNOUNCED',event.id,{holidayDate:data.holidayDate,revision:event.revision});
    return {...event,holidayDate:data.holidayDate};
  });
}
async function cancelHoliday(userId,eventId,input) {
  const data=parse(schemas.cancellationSchema,input);
  return transaction(async tx=>{
    await actor(tx,userId);
    const selected=await tx.companyHolidayEvent.findUnique({where:{id:eventId}});
    if(!selected)fail(404,'Holiday announcement not found.','NOT_FOUND');
    await upcoming(tx,dateString(selected.holidayDate));
    const latest=await tx.companyHolidayEvent.findFirst({where:{holidayDate:selected.holidayDate},orderBy:{revision:'desc'}});
    if(latest.id!==eventId||latest.id!==data.expectedPreviousId||latest.action!=='ANNOUNCE')fail(409,'Announcement changed or was already cancelled. Reload.','HOLIDAY_VERSION_CONFLICT');
    const event=await tx.companyHolidayEvent.create({data:{holidayDate:latest.holidayDate,revision:latest.revision+1,action:'CANCEL',actorUserId:userId,reason:data.reason}});
    await audit(tx,userId,'COMPANY_HOLIDAY_CANCELLED',event.id,{holidayDate:dateString(event.holidayDate),previousId:latest.id});
    return {...event,holidayDate:dateString(event.holidayDate)};
  });
}
async function myShift(userId, now = new Date()) {
  return transaction(async tx => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({ where: { userId: user.id }, select: { id: true, employmentEpisodes: { select: { startDate: true, endDate: true, status: true }, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] } } });
    if (!employee) return { state: 'PROFILE_LINK_REQUIRED', duty: '19:00–05:00 next day', current: null, next: null, applicable: null, missing: ['linkedEmployeeProfile'] };
    const rows = await tx.officeSchedule.findMany({ orderBy: { effectiveFrom: 'asc' } });
    const draft=await tx.officeScheduleDraft.findFirst({orderBy:{revision:'desc'},select:{policy:true}});
    const preview=draft?{label:'Inactive draft preview; not an operational schedule',...draft.policy}:null;
    const zone=activeVersion(rows,now)?.policy.timeZone||draft?.policy.timeZone||schemas.confirmedPolicy.timeZone;
    const local=localParts(now,zone),anchor=local.time<'05:00'?require('../utils/office-schedule').addDays(local.date,-1):local.date;
    if(!employee.employmentEpisodes.some(e=>dateString(e.startDate)<=anchor&&(!e.endDate||dateString(e.endDate)>=anchor)&&['ACTIVE','PROBATION','NOTICE_PERIOD'].includes(e.status)))return {state:'NOT_ELIGIBLE',current:null,next:null,applicable:null,missing:[],asOf:now.toISOString()};
    const assignments = await tx.employeeShiftAssignment.findMany({ where: { employeeId: employee.id }, select: { effectiveFrom: true, effectiveTo: true } });
    const events=await tx.companyHolidayEvent.findMany({where:{createdAt:{lte:now}},orderBy:[{holidayDate:'asc'},{revision:'desc'}],select:{holidayDate:true,action:true}});
    const latestEvents=new Map();for(const event of events){const date=dateString(event.holidayDate);if(!latestEvents.has(date))latestEvents.set(date,event.action);}
    const holidayDates=[...latestEvents].filter(([,action])=>action==='ANNOUNCE').map(([date])=>date);
    const result=resolveSchedule(rows.map(serialize), assignments.map(a => ({ effectiveFrom: dateString(a.effectiveFrom), effectiveTo: dateString(a.effectiveTo) })), employee.employmentEpisodes.map(e => ({ ...e, startDate: dateString(e.startDate), endDate: dateString(e.endDate) })), now,holidayDates);
    if(!activeVersion(rows,now)){const scheduled=rows.some(row=>effectiveInstant(row)>now&&missingPolicy(row.policy).length===0);return {...result,state:scheduled?'SCHEDULED_ACTIVATION':draft?'PENDING_ACTIVATION':'SETUP_REQUIRED',applicable:null,current:null,draftPreview:preview,missing:[scheduled?'effectiveDutyStartNotReached':'approvedEffectiveDate'],asOf:now.toISOString()};}
    return {...result,asOf:now.toISOString()};
  });
}
module.exports = { settings, saveDraft, activate, announceHoliday, cancelHoliday, myShift };
