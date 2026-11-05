"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { createIsolatedDatabase, assertTestDatabase } = require('./isolated-db');
const { confirmedPolicy } = require('../src/validation/schedule-readiness.validation');
const { addDays, instantFor } = require('../src/utils/office-schedule');

test('Phase 4 Attendance Management comprehensive integration suite', { timeout: 180000 }, async (t) => {
  const database = await createIsolatedDatabase();
  assertTestDatabase(database.url);
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = 'test';

  // Clear require cache to ensure fresh PrismaClient with isolated database URL
  delete require.cache[require.resolve('../src/config/prisma')];
  delete require.cache[require.resolve('../app')];
  delete require.cache[require.resolve('../src/services/organization.service')];
  delete require.cache[require.resolve('../src/services/attendance.service')];
  delete require.cache[require.resolve('../src/services/attendance-settings.service')];

  const prisma = require('../src/config/prisma');
  const app = require('../app');
  const attendanceService = require('../src/services/attendance.service');

  const sql = new Client({ connectionString: database.url });
  await sql.connect();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
    await sql.end();
    await database.cleanup();
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const origin = require('../src/config/auth').ALLOWED_ORIGINS[0];
  const password = 'Attendance-test-123!';
  const passwordHash = await require('../src/utils/password').hashPassword(password);

  async function account(role) {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        displayName: role + ' User',
        passwordHash,
        role,
        mustChangePassword: false,
      },
    });
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password }),
    });
    assert.equal(r.status, 200);
    const p = await r.json();
    return {
      ...u,
      cookie: r.headers.getSetCookie().map((v) => v.split(';')[0]).join('; '),
      csrf: p.data.csrfToken,
    };
  }

  const admin = await account('ADMIN');
  const hr = await account('HR');
  const manager = await account('MANAGER');
  const employeeUser = await account('EMPLOYEE');
  const unlinkedUser = await account('EMPLOYEE');

  // Create linked employee for employeeUser and manager
  const employee = await prisma.employee.create({
    data: {
      employeeCode: 'EMP-ATT-001',
      fullName: 'Attending Employee',
      userId: employeeUser.id,
      personalEmail: 'emp@example.invalid',
      employmentEpisodes: {
        create: {
          startDate: new Date('2020-01-01'),
          status: 'ACTIVE',
          statusEffectiveDate: new Date('2020-01-01'),
        },
      },
    },
    include: { employmentEpisodes: true },
  });

  await prisma.employee.create({
    data: {
      employeeCode: 'MGR-ATT-001',
      fullName: 'Manager Employee',
      userId: manager.id,
      personalEmail: 'mgr@example.invalid',
      employmentEpisodes: {
        create: {
          startDate: new Date('2020-01-01'),
          status: 'ACTIVE',
          statusEffectiveDate: new Date('2020-01-01'),
        },
      },
    },
  });

  // Activate common office schedule for test anchor dates
  // Find a Monday far enough in the past so it is active
  const pastMonday = '2025-12-01'; // 2025-12-01 is a Monday
  const draft = await prisma.officeScheduleDraft.create({
    data: {
      revision: 1,
      policy: confirmedPolicy,
      reason: 'Active schedule for attendance test',
      actorUserId: hr.id,
    },
  });
  await prisma.officeSchedule.create({
    data: {
      draftId: draft.id,
      effectiveFrom: new Date(pastMonday),
      startTime: '19:00',
      endTime: '05:00',
      endsNextDay: true,
      policy: confirmedPolicy,
      reason: 'Active schedule',
      actorUserId: hr.id,
    },
  });

  async function req(path, { method = 'GET', user = admin, body, csrf = true } = {}) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        ...(user ? { Cookie: user.cookie } : {}),
        ...(user && csrf ? { 'x-csrf-token': user.csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    return { status: r.status, data: await r.json() };
  }

  await t.test('1. Authorization, CSRF and Profile Linking', async () => {
    // Unauthenticated
    assert.equal((await req('/attendance/status', { user: null })).status, 401);
    assert.equal((await req('/attendance/clock-in', { method: 'POST', user: null, body: { requestId: '12345678' } })).status, 401);

    // CSRF missing on POST
    assert.equal(
      (await req('/attendance/clock-in', { method: 'POST', user: employeeUser, csrf: false, body: { requestId: '12345678' } })).status,
      403
    );

    // Unlinked employee calling status
    const unlinkedStatus = await req('/attendance/status', { user: unlinkedUser });
    assert.equal(unlinkedStatus.status, 200);
    assert.equal(unlinkedStatus.data.data.state, 'PROFILE_LINK_REQUIRED');
    assert.equal(unlinkedStatus.data.data.canClockIn, false);

    // Unlinked employee clock-in fails
    const unlinkedClockIn = await req('/attendance/clock-in', {
      method: 'POST',
      user: unlinkedUser,
      body: { requestId: 'req_unlinked_123' },
    });
    assert.equal(unlinkedClockIn.status, 403);
    assert.equal(unlinkedClockIn.data.code, 'PROFILE_LINK_REQUIRED');

    // Manager / Employee cannot view daily summary
    assert.equal((await req('/attendance/daily-summary/2026-01-05', { user: employeeUser })).status, 403);
    assert.equal((await req('/attendance/daily-summary/2026-01-05', { user: manager })).status, 403);
    // HR and Admin can access daily summary
    assert.equal((await req('/attendance/daily-summary/2026-01-05', { user: hr })).status, 200);
    assert.equal((await req('/attendance/daily-summary/2026-01-05', { user: admin })).status, 200);
  });

  await t.test('2. Clock-In Timing, Lateness & Grace Period', async () => {
    // Test date: 2026-01-05 (Monday)
    // Duty start: 19:00 PKT (14:00 UTC)
    // Grace end: 19:30 PKT (14:30 UTC)
    // Duty end: 05:00 next day PKT (00:00 UTC 2026-01-06)

    // Before duty start: 18:50 PKT (13:50 UTC)
    const beforeDutyTime = new Date('2026-01-05T13:50:00.000Z');
    await assert.rejects(
      attendanceService.clockIn(employeeUser.id, 'req_early_clockin', beforeDutyTime),
      (err) => err.code === 'BEFORE_DUTY_START'
    );

    // Non-working day (Saturday 2026-01-10): clock in rejected
    const saturdayTime = new Date('2026-01-10T14:30:00.000Z');
    await assert.rejects(
      attendanceService.clockIn(employeeUser.id, 'req_saturday_clockin', saturdayTime),
      (err) => err.code === 'NO_ACTIVE_SCHEDULE'
    );

    // On-Time clock-in: 19:15 PKT (14:15 UTC) -> Within grace period (grace is 30m, up to 19:30)
    const onTimeClockIn = new Date('2026-01-05T14:15:00.000Z');
    const record = await attendanceService.clockIn(employeeUser.id, 'req_ontime_001', onTimeClockIn);
    assert.equal(record.shiftDate, '2026-01-05');
    assert.equal(record.status, 'OPEN');
    assert.equal(record.isLate, false); // On time!

    // Check status API now reflects OPEN session
    const statusRes = await attendanceService.getAttendanceStatus(employeeUser.id, onTimeClockIn);
    assert.equal(statusRes.canClockIn, false);
    assert.equal(statusRes.canClockOut, true);
    assert.equal(statusRes.clockInBlockReason, 'OPEN_SESSION_EXISTS');
    assert.equal(statusRes.attendance.status, 'OPEN');

    // Idempotency: Replaying the clock-in with the exact same requestId returns the same record
    const replayRecord = await attendanceService.clockIn(employeeUser.id, 'req_ontime_001', onTimeClockIn);
    assert.equal(replayRecord.id, record.id);
    assert.equal(replayRecord.isLate, false);

    // A second clock-in attempt with a new requestId while open session exists is rejected
    await assert.rejects(
      attendanceService.clockIn(employeeUser.id, 'req_second_attempt', onTimeClockIn),
      (err) => err.code === 'OPEN_SESSION_EXISTS'
    );
  });

  await t.test('3. Clock-Out, Duration and Departure Flags', async () => {
    // Clock-out at 04:30 PKT (23:30 UTC) -> Early departure (before 05:00 scheduled end)
    const clockOutTime = new Date('2026-01-05T23:30:00.000Z');
    const clockOutRecord = await attendanceService.clockOut(employeeUser.id, 'req_out_001', (await prisma.attendanceRecord.findFirst({ where: { employee: { userId: employeeUser.id } }, orderBy: { shiftDate: "desc" } })).id, clockOutTime);

    assert.equal(clockOutRecord.status, 'COMPLETED');
    assert.equal(clockOutRecord.isEarlyDeparture, true);
    assert.equal(clockOutRecord.isAfterScheduleEnd, false);
    // 14:15 UTC to 23:30 UTC = 9 hours 15 minutes = 555 minutes
    assert.equal(clockOutRecord.workedMinutes, 555);

    // Idempotent replay of clock-out returns exact same record
    const replayClockOut = await attendanceService.clockOut(employeeUser.id, 'req_out_001', (await prisma.attendanceRecord.findFirst({ where: { employee: { userId: employeeUser.id } }, orderBy: { shiftDate: "desc" } })).id, clockOutTime);
    assert.equal(replayClockOut.id, clockOutRecord.id);
    assert.equal(replayClockOut.status, 'COMPLETED');

    // Attempting to clock out when no open session exists -> 409 NO_OPEN_SESSION
    await assert.rejects(
      attendanceService.clockOut(employeeUser.id, 'req_out_again', (await prisma.attendanceRecord.findFirst({ where: { employee: { userId: employeeUser.id } }, orderBy: { shiftDate: "desc" } })).id, clockOutTime),
      (err) => err.code === 'NO_OPEN_SESSION'
    );

    // Cannot clock in again for the same shift date (already clocked)
    await assert.rejects(
      attendanceService.clockIn(employeeUser.id, 'req_second_clockin_same_day', clockOutTime),
      (err) => err.code === 'ALREADY_CLOCKED'
    );
  });

  await t.test('4. Lateness Detection Past Grace Period', async () => {
    // Create another employee for lateness test
    const lateUser = await account('EMPLOYEE');
    await prisma.employee.create({
      data: {
        employeeCode: 'EMP-LATE-001',
        fullName: 'Late Employee',
        userId: lateUser.id,
        personalEmail: 'late@example.invalid',
        employmentEpisodes: {
          create: {
            startDate: new Date('2020-01-01'),
            status: 'ACTIVE',
            statusEffectiveDate: new Date('2020-01-01'),
          },
        },
      },
    });

    // Clock in on Tuesday 2026-01-06 at 19:35 PKT (14:35 UTC) -> 5 minutes past 30-min grace
    const lateClockInTime = new Date('2026-01-06T14:35:00.000Z');
    const lateRecord = await attendanceService.clockIn(lateUser.id, 'req_late_001', lateClockInTime);

    assert.equal(lateRecord.shiftDate, '2026-01-06');
    assert.equal(lateRecord.isLate, true); // Flagged late!

    // Clock out after duty end: 05:15 PKT next day (00:15 UTC 2026-01-07)
    const lateClockOutTime = new Date('2026-01-07T00:15:00.000Z');
    const lateOutRecord = await attendanceService.clockOut(lateUser.id, 'req_late_out_001', (await prisma.attendanceRecord.findFirst({ where: { employee: { userId: lateUser.id } }, orderBy: { shiftDate: "desc" } })).id, lateClockOutTime);
    assert.equal(lateOutRecord.isEarlyDeparture, false);
    assert.equal(lateOutRecord.isAfterScheduleEnd, true);
  });

  await t.test('5. Own History and Daily Summary Endpoints', async () => {
    // Own history
    const historyRes = await req('/attendance/history', { user: employeeUser });
    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.data.data.records.length, 1);
    assert.equal(historyRes.data.data.records[0].shiftDate, '2026-01-05');

    // Daily summary for 2026-01-05
    const summary20260105 = await req('/attendance/daily-summary/2026-01-05', { user: hr });
    assert.equal(summary20260105.status, 200);
    assert.equal(summary20260105.data.data.totalRecords, 1);
    assert.equal(summary20260105.data.data.onTime, 1);
    assert.equal(summary20260105.data.data.late, 0);
    assert.equal(summary20260105.data.data.earlyDeparture, 1);

    // Daily summary for 2026-01-06
    const summary20260106 = await req('/attendance/daily-summary/2026-01-06', { user: hr });
    assert.equal(summary20260106.status, 200);
    assert.equal(summary20260106.data.data.totalRecords, 1);
    assert.equal(summary20260106.data.data.late, 1);
  });

  await t.test('6. Correction Request Workflow: Submit, Conflict & Review', async () => {
    // Find the record for employeeUser
    const rec = await prisma.attendanceRecord.findFirst({
      where: { employeeId: employee.id, shiftDate: new Date('2026-01-05') },
    });
    assert.ok(rec);

    // Submit correction request
    const correctionRes = await req('/attendance/corrections', {
      method: 'POST',
      user: employeeUser,
      body: {
        attendanceRecordId: rec.id,
        shiftDate: '2026-01-05',
        requestType: 'WRONG_TIME',
        correctedClockIn: '2026-01-05T14:00:00.000Z',
        correctedClockOut: '2026-01-06T00:00:00.000Z',
        reason: 'Office badge reader malfunctioned, actual times were full duty.',
      },
    });
    assert.equal(correctionRes.status, 200);
    const correction = correctionRes.data.data;
    assert.equal(correction.status, 'PENDING');
    assert.equal(correction.shiftDate, '2026-01-05');

    // Duplicate submission for same shift date is rejected with 409
    const dupRes = await req('/attendance/corrections', {
      method: 'POST',
      user: employeeUser,
      body: {
        attendanceRecordId: rec.id,
        shiftDate: '2026-01-05',
        requestType: 'WRONG_TIME',
        reason: 'Another request for same date',
      },
    });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.data.code, 'CORRECTION_PENDING');

    // Employee cannot review corrections
    const empReview = await req(`/attendance/corrections/${correction.id}/review`, {
      method: 'POST',
      user: employeeUser,
      body: { decision: 'APPROVED', reviewReason: 'Self-approve attempt' },
    });
    assert.equal(empReview.status, 403);

    // Manager cannot review corrections
    const mgrReview = await req(`/attendance/corrections/${correction.id}/review`, {
      method: 'POST',
      user: manager,
      body: { decision: 'APPROVED', reviewReason: 'Manager approve attempt' },
    });
    assert.equal(mgrReview.status, 403);

    // Version conflict on review: expectedVersion mismatch
    const conflictReview = await req(`/attendance/corrections/${correction.id}/review`, {
      method: 'POST',
      user: hr,
      body: { decision: 'APPROVED', reviewReason: 'Approving', expectedVersion: 999 },
    });
    assert.equal(conflictReview.status, 409);
    assert.equal(conflictReview.data.code, 'VERSION_CONFLICT');

    // Successful HR review approval
    const hrReview = await req(`/attendance/corrections/${correction.id}/review`, {
      method: 'POST',
      user: hr,
      body: {
        decision: 'APPROVED',
        reviewReason: 'Verified with security desk logbook.',
        expectedVersion: correction.version,
      },
    });
    assert.equal(hrReview.status, 200);
    assert.equal(hrReview.data.data.status, 'APPROVED');

    // Check attendance record was updated
    const updatedRec = await prisma.attendanceRecord.findUnique({ where: { id: rec.id } });
    assert.equal(updatedRec.isEarlyDeparture, true); // No longer early out because correctedClockOut was 05:00 PKT (00:00 UTC)
    assert.equal(updatedRec.workedMinutes, 555);
    assert.equal(updatedRec.clockInAt.toISOString(), rec.clockInAt.toISOString());
    assert.equal(updatedRec.clockOutAt.toISOString(), rec.clockOutAt.toISOString());
    assert.equal(updatedRec.approvedAdjustment.minutes, 600); // 10 hours = 600 minutes
  });
  await t.test('7. Replay ownership, exact target, strict input and audit deduplication', async () => {
    const rec = await prisma.attendanceRecord.findFirst({ where: { employeeId: employee.id } });
    await assert.rejects(attendanceService.clockIn(manager.id, rec.clockInRequestId), e => e.code === 'REQUEST_CONFLICT');
    await assert.rejects(attendanceService.clockOut(manager.id, rec.clockOutRequestId, rec.id), e => e.code === 'REQUEST_CONFLICT');
    await assert.rejects(attendanceService.clockOut(employeeUser.id, rec.clockOutRequestId, randomUUID()), e => e.code === 'REQUEST_CONFLICT');
    await assert.rejects(attendanceService.clockIn(employeeUser.id, rec.clockOutRequestId), e => e.code === 'REQUEST_CONFLICT');
    assert.equal(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CLOCK_IN', targetId: rec.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CLOCK_OUT', targetId: rec.id } }), 1);
    assert.equal((await req('/attendance/clock-in', { method:'POST', user:employeeUser, body:{ requestId:randomUUID(), clockInAt:'2026-01-05T14:00:00Z' } })).status,400);
    assert.equal((await req('/attendance/clock-out', { method:'POST', user:employeeUser, body:{ requestId:randomUUID() } })).status,400);
    assert.equal((await req('/attendance/history?dateFrom=wrong', { user:employeeUser })).status,400);
    assert.equal((await req('/attendance/history?employeeId='+employee.id, { user:employeeUser })).status,400);
    assert.equal((await req('/attendance/all?dateFrom=2026-02-01&dateTo=2026-01-01', { user:hr })).status,400);
  });

  async function fixture(code) {
    const user = await account('EMPLOYEE');
    const emp = await prisma.employee.create({ data:{ userId:user.id, employeeCode:code, fullName:code, employmentEpisodes:{ create:{ startDate:new Date('2020-01-01'), status:'ACTIVE', statusEffectiveDate:new Date('2020-01-01') } } } });
    return { user, emp };
  }
  await t.test('8. Exact boundaries, overnight Friday/year anchor and recovery', async () => {
    const f = await fixture('BOUNDARY');
    await assert.rejects(attendanceService.clockIn(f.user.id,randomUUID(),new Date('2025-11-28T14:00:00Z')),e => e.code === 'NO_ACTIVE_SCHEDULE');
    const rec = await attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-09T14:30:00Z'));
    assert.equal(rec.isLate,false);
    assert.equal((await attendanceService.getAttendanceStatus(f.user.id,new Date('2026-01-09T23:59:59Z'))).attendance.isMissingCheckout,false);
    const ended = await attendanceService.getAttendanceStatus(f.user.id,new Date('2026-01-10T00:00:00Z'));
    assert.equal(ended.attendance.isMissingCheckout,true);
    assert.equal(ended.canClockOut,true);
    await assert.rejects(attendanceService.clockOut(f.user.id,randomUUID(),rec.id,new Date('2026-01-09T14:29:00Z')),e => e.code === 'INVALID_TIME_SEQUENCE');
    const out = await attendanceService.clockOut(f.user.id,randomUUID(),rec.id,new Date('2026-01-10T01:00:00Z'));
    assert.equal(out.shiftDate,'2026-01-09'); assert.equal(out.isAfterScheduleEnd,true);
    const year = await fixture('YEAR');
    const entry = await attendanceService.clockIn(year.user.id,randomUUID(),new Date('2025-12-31T20:00:00Z'));
    assert.equal(entry.shiftDate,'2025-12-31'); assert.equal(entry.isLate,true);
    await attendanceService.clockOut(year.user.id,randomUUID(),entry.id,new Date('2026-01-01T00:00:00Z'));
    const late = await fixture('GRACE');
    assert.equal((await attendanceService.clockIn(late.user.id,randomUUID(),new Date('2026-01-05T14:30:00.001Z'))).isLate,true);
    const exactEnd = await fixture('END');
    await assert.rejects(attendanceService.clockIn(exactEnd.user.id,randomUUID(),new Date('2026-01-06T00:00:00Z')),e => ['BEFORE_DUTY_START','AFTER_DUTY_END'].includes(e.code));
  });
  await t.test('9. Manager historical interval intersection and organization filters', async () => {
    const unit = (kind,name,extra={}) => prisma.organizationUnit.create({ data:{ kind,name,actorUserId:hr.id,reason:'Guarded scope fixture',...extra } });
    const dept=await unit('DEPARTMENT','D'), campaign=await unit('CAMPAIGN','C'), designation=await unit('DESIGNATION','Role');
    const team=await unit('TEAM','A',{ departmentId:dept.id,campaignId:campaign.id });
    await prisma.organizationAssignment.create({ data:{ employeeId:employee.id,teamId:team.id,designationId:designation.id,effectiveFrom:new Date('2026-01-01'),effectiveTo:new Date('2026-01-31'),actorUserId:hr.id,reason:'Scope' } });
    await prisma.teamManagerAssignment.create({ data:{ managerUserId:manager.id,teamId:team.id,effectiveFrom:new Date('2026-01-05'),effectiveTo:new Date('2026-01-05'),actorUserId:hr.id,reason:'Historical manager' } });
    const allowed=await attendanceService.getAttendanceList(manager.id,{employeeId:employee.id});
    assert.equal(allowed.total,1); assert.equal(allowed.records[0].shiftDate,'2026-01-05');
    const outsider=await prisma.employee.findFirst({where:{employeeCode:'BOUNDARY'}});
    assert.equal((await attendanceService.getAttendanceList(manager.id,{employeeId:outsider.id})).total,0);
    assert.equal((await attendanceService.getAttendanceList(manager.id,{dateFrom:'2026-01-06'})).total,0);
    assert.equal((await attendanceService.getAttendanceList(hr.id,{departmentId:dept.id,search:'Attending'})).total,1);
    assert.equal((await attendanceService.getAttendanceList(hr.id,{teamId:randomUUID()})).total,0);
    assert.equal((await attendanceService.getAttendanceList(hr.id,{search:'unknown-name'})).total,0);
    assert.equal((await attendanceService.getAttendanceList(hr.id,{pageSize:1})).records.length,1);
  });
  await t.test('10. Derived absence excludes future/off/holiday/ineligible dates', async () => {
    const clock = require('../src/utils/attendance-clock');
    const original=clock.now;
    clock.now=()=>new Date('2026-01-06T00:01:00Z');
    try {
      const past=await attendanceService.getDailySummary(hr.id,'2026-01-05');
      assert.ok(past.noClockIn>0);
      assert.equal((await attendanceService.getDailySummary(hr.id,'2026-01-06')).noClockIn,0);
      assert.equal((await attendanceService.getDailySummary(hr.id,'2026-01-10')).noClockIn,0);
      assert.equal((await attendanceService.getDailySummary(hr.id,'2019-01-07')).noClockIn,0);
      await prisma.companyHolidayEvent.create({data:{holidayDate:new Date('2026-01-08'),revision:1,action:'ANNOUNCE',reason:'Fixture holiday',actorUserId:hr.id}});
      assert.equal((await attendanceService.getDailySummary(hr.id,'2026-01-08')).noClockIn,0);
      const f=await fixture('HOLIDAY');
      await assert.rejects(attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-08T14:00:00Z')),e=>e.code==='NO_ACTIVE_SCHEDULE');
    } finally { clock.now=original; }
  });
  await t.test('11. Concurrent punches, DB invariants and atomic audit rollback', async () => {
    const f=await fixture('CONCURRENT');
    const results=await Promise.allSettled([1,2].map(()=>attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-12T14:00:00Z'))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const rec=await prisma.attendanceRecord.findFirst({where:{employeeId:f.emp.id}});
    await assert.rejects(sql.query(`INSERT INTO attendance_records (id,"employeeId","employmentEpisodeId","shiftDate","scheduledStart","scheduledEnd","scheduleTimeZone","graceMinutes","clockInAt",status,"clockInRequestId","clockInActorUserId","scheduleSnapshot",version,"updatedAt","officeScheduleId") SELECT gen_random_uuid(),"employeeId","employmentEpisodeId","shiftDate"+1,"scheduledStart"+interval '1 day',"scheduledEnd"+interval '1 day',"scheduleTimeZone","graceMinutes","clockInAt"+interval '1 day','OPEN',$2,"clockInActorUserId","scheduleSnapshot",1,now(),"officeScheduleId" FROM attendance_records WHERE id=$1`,[rec.id,randomUUID()]),e=>e.code==='23505' && e.constraint==='attendance_one_unresolved_session');
    await assert.rejects(sql.query('UPDATE attendance_records SET "clockInAt" = "clockInAt" + interval \'1 minute\' WHERE id=$1',[rec.id]));
    await assert.rejects(sql.query('UPDATE attendance_records SET "clockOutAt" = "clockInAt" - interval \'1 minute\' WHERE id=$1',[rec.id]));
    const rollback=await fixture('ROLLBACK');
    const correction=await attendanceService.submitCorrectionRequest(f.user.id,{attendanceRecordId:rec.id,shiftDate:'2026-01-12',requestType:'MISSING_CHECKOUT',correctedClockOut:'2026-01-13T00:00:00Z',reason:'Audit rollback fixture'});
    await sql.query(`CREATE FUNCTION reject_attendance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'ATTENDANCE_%' THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_attendance_audit()`);
    try {
      await assert.rejects(attendanceService.clockIn(rollback.user.id,randomUUID(),new Date('2026-01-12T14:00:00Z')));
      assert.equal(await prisma.attendanceRecord.count({where:{employeeId:rollback.emp.id}}),0);
      await assert.rejects(attendanceService.clockOut(f.user.id,randomUUID(),rec.id,new Date('2026-01-13T00:00:00Z')));
      assert.equal((await prisma.attendanceRecord.findUnique({where:{id:rec.id}})).clockOutAt,null);
      await assert.rejects(attendanceService.reviewCorrection(hr.id,correction.id,{decision:'APPROVED',reviewReason:'Audit failure',expectedVersion:1}));
      assert.equal((await prisma.attendanceCorrectionRequest.findUnique({where:{id:correction.id}})).status,'PENDING');
      assert.equal((await prisma.attendanceRecord.findUnique({where:{id:rec.id}})).approvedAdjustment,null);
    } finally { await sql.query('DROP TRIGGER test_audit_failure ON audit_logs; DROP FUNCTION reject_attendance_audit()'); }
  });
  await t.test('12. Missing-checkout approval preserves actual null and releases blocking', async () => {
    const f=await fixture('CORRECTION');
    const rec=await attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-12T14:00:00Z'));
    await assert.rejects(attendanceService.submitCorrectionRequest(f.user.id,{attendanceRecordId:rec.id,shiftDate:'2026-01-13',requestType:'OTHER',reason:'Wrong date'}),e=>e.code==='VALIDATION_ERROR');
    const correction=await attendanceService.submitCorrectionRequest(f.user.id,{attendanceRecordId:rec.id,shiftDate:'2026-01-12',requestType:'MISSING_CHECKOUT',correctedClockOut:'2026-01-13T00:00:00Z',reason:'Missed exit'});
    await attendanceService.reviewCorrection(hr.id,correction.id,{decision:'APPROVED',reviewReason:'Confirmed',expectedVersion:correction.version});
    const actual=await prisma.attendanceRecord.findUnique({where:{id:rec.id}});
    assert.equal(actual.clockOutAt,null); assert.equal(actual.workedMinutes,null); assert.equal(actual.status,'CORRECTED');
    assert.equal(actual.approvedAdjustment.minutes,600);
    assert.ok((await attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-13T14:00:00Z'))).id);
    await assert.rejects(attendanceService.reviewCorrection(hr.id,correction.id,{decision:'REJECTED',reviewReason:'Second decision',expectedVersion:1}),e=>e.code==='ALREADY_REVIEWED');
    await assert.rejects(sql.query('UPDATE attendance_correction_requests SET reason=$1 WHERE id=$2',['Changed',correction.id]));
  });
  await t.test('13. Stale approval rolls back decision and audit; future policy preserves snapshots', async () => {
    const f=await fixture('STALE');
    const rec=await attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-14T14:00:00Z'));
    const correction=await attendanceService.submitCorrectionRequest(f.user.id,{attendanceRecordId:rec.id,shiftDate:'2026-01-14',requestType:'MISSING_CHECKOUT',correctedClockOut:'2026-01-15T00:00:00Z',reason:'Proposed exit'});
    await attendanceService.clockOut(f.user.id,randomUUID(),rec.id,new Date('2026-01-14T23:30:00Z'));
    await assert.rejects(attendanceService.reviewCorrection(hr.id,correction.id,{decision:'APPROVED',reviewReason:'Stale',expectedVersion:1}),e=>e.code==='VERSION_CONFLICT');
    assert.equal((await prisma.attendanceCorrectionRequest.findUnique({where:{id:correction.id}})).status,'PENDING');
    assert.equal(await prisma.auditLog.count({where:{action:'ATTENDANCE_CORRECTION_REVIEWED',targetId:correction.id}}),0);
    const version=await prisma.officeSchedule.create({data:{effectiveFrom:new Date('2027-01-04'),startTime:'19:00',endTime:'05:00',endsNextDay:true,policy:{...confirmedPolicy,graceMinutes:10},actorUserId:hr.id,reason:'Future fixture policy'}});
    const before=await attendanceService.getAttendanceStatus(f.user.id,new Date('2027-01-04T13:59:59Z'));
    assert.equal(before.canClockIn,false);
    const actual=await prisma.attendanceRecord.findUnique({where:{id:rec.id}});
    assert.equal(actual.graceMinutes,30); assert.notEqual(actual.officeScheduleId,version.id);
    const future=await fixture('FUTURE');
    const newRecord=await attendanceService.clockIn(future.user.id,randomUUID(),new Date('2027-01-04T14:11:00Z'));
    assert.equal(newRecord.graceMinutes,10); assert.equal(newRecord.isLate,true);
    assert.throws(()=>assertTestDatabase(database.url.replace(/officehr_phase1_test_[a-f0-9]{16}/,'AdRankoHRM')));
  });
  await t.test('14. Missing-entry exception remains separate evidence; concurrent review has one winner', async () => {
    const f=await fixture('NOENTRY');
    const correction=await attendanceService.submitCorrectionRequest(f.user.id,{shiftDate:'2026-01-15',requestType:'OTHER',correctedClockIn:'2026-01-15T14:00:00Z',correctedClockOut:'2026-01-16T00:00:00Z',reason:'Both badge punches missed'});
    const decisions=await Promise.allSettled([hr,admin].map(u=>attendanceService.reviewCorrection(u.id,correction.id,{decision:'APPROVED',reviewReason:'Verified exception',expectedVersion:1})));
    assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await prisma.attendanceRecord.count({where:{employeeId:f.emp.id}}),0);
    await assert.rejects(attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-15T14:10:00Z')),e=>e.code==='ALREADY_CLOCKED');
    const daily=await attendanceService.getDailySummary(hr.id,'2026-01-15');
    assert.equal(daily.classifications.find(c=>c.employee.id===f.emp.id).classification,'APPROVED_EXCEPTION');
    assert.equal(await prisma.auditLog.count({where:{action:'ATTENDANCE_CORRECTION_REVIEWED',targetId:correction.id}}),1);
  });
  await t.test('15. Legacy assignments, employment dates and hostile origins remain blocked', async () => {
    const f=await fixture('LEGACY');
    const episode=await prisma.employmentEpisode.findFirst({where:{employeeId:f.emp.id}});
    const shift=await prisma.shiftDefinition.create({data:{name:'Legacy fixture',timeZone:'Asia/Karachi',startTime:'19:00',endTime:'05:00',endsNextDay:true,workDays:[1,2,3,4,5],breakMinutes:0,breakPaid:null,graceMinutes:30,actorUserId:hr.id,reason:'Legacy guard fixture'}});
    await prisma.employeeShiftAssignment.create({data:{employeeId:f.emp.id,employmentEpisodeId:episode.id,shiftId:shift.id,effectiveFrom:new Date('2026-01-01'),actorUserId:hr.id,reason:'Legacy assignment fixture'}});
    await assert.rejects(attendanceService.clockIn(f.user.id,randomUUID(),new Date('2026-01-05T14:00:00Z')),e=>e.code==='LEGACY_ASSIGNMENT');
    const future=await fixture('NOTELIGIBLE');
    const futureEpisode=await prisma.employmentEpisode.findFirst({where:{employeeId:future.emp.id}});
    await prisma.employmentEpisode.update({where:{id:futureEpisode.id},data:{startDate:new Date('2026-02-01'),statusEffectiveDate:new Date('2026-02-01')}});
    await assert.rejects(attendanceService.clockIn(future.user.id,randomUUID(),new Date('2026-01-05T14:00:00Z')),e=>e.code==='NOT_ELIGIBLE');
    const hostile=await fetch(base+'/attendance/clock-in',{method:'POST',headers:{Origin:'https://hostile.example.invalid',Cookie:employeeUser.cookie,'x-csrf-token':employeeUser.csrf,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})});
    assert.equal(hostile.status,403);
  });
});
