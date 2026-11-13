"use strict";
const { actor, audit, transaction, fail } = require('./organization.service');
const { dateValue, dateString } = require('../utils/shift-rules');
const { localParts, instantFor, addDays, missingPolicy, scheduleDate } = require('../utils/office-schedule');
const clock = require('../utils/attendance-clock');
const { statusOn } = require('../utils/employment-status');

// ─── Schedule resolution helpers ────────────────────────────────────────
// ─── Get the schedule for the current/potential duty ─────────────────
async function getScheduleContext(tx, now) {
  const versions = await tx.officeSchedule.findMany({
    orderBy: { effectiveFrom: 'asc' },
  });
  // Select by shift-start date, so future/new policies cannot reinterpret yesterday.
  let active, anchor;
  for (const version of versions) {
    if (!version.policy.timeZone) continue;
    const local = localParts(now, version.policy.timeZone);
    const date = local.time < '05:00' ? addDays(local.date, -1) : local.date;
    if (versions.filter(v => dateString(v.effectiveFrom) <= date).at(-1)?.id === version.id) {
      active = version; anchor = date;
    }
  }
  if (!active || missingPolicy(active.policy).length) return null;
  const policy = active.policy, zone = policy.timeZone;
  if (policy.holidayPolicy === 'DATES' && (anchor < policy.holidayFrom || anchor > policy.holidayTo)) return null;
  // Compute the scheduled duty window
  const startInstant = instantFor(anchor, '19:00', zone);
  const endInstant = instantFor(addDays(anchor, 1), '05:00', zone);
  if (!startInstant || !endInstant || endInstant <= startInstant) return null;

  // Reuse Phase 3 policy interpretation; personal eligibility is checked separately.
  const holidayEvents = await tx.companyHolidayEvent.findMany({
    where: { holidayDate: dateValue(anchor) },
    orderBy: { revision: 'desc' },
    take: 1,
  });
  const interpreted = scheduleDate(active, anchor, [], [{ startDate: '0001-01-01', endDate: null, status: 'ACTIVE' }], holidayEvents[0]?.action === 'ANNOUNCE' ? [anchor] : []);
  if (interpreted.state === 'SETUP_REQUIRED') return null;
  return {
    type: interpreted.state,
    shiftDate: anchor,
    zone,
    startInstant,
    endInstant,
    policy,
    graceMinutes: policy.graceMinutes,
    versionId: active.id,
  };
}

// ─── Check legacy shift assignments ─────────────────────────────────
async function hasLegacyAssignment(tx, employeeId, shiftDate) {
  const assignments = await tx.employeeShiftAssignment.findMany({
    where: { employeeId },
    select: { effectiveFrom: true, effectiveTo: true },
  });
  return assignments.some(
    (a) =>
      dateString(a.effectiveFrom) <= shiftDate &&
      (!a.effectiveTo || dateString(a.effectiveTo) >= shiftDate)
  );
}

// ─── Find eligible employment episode ────────────────────────────────
async function findEligibleEpisode(tx, employeeId, shiftDate) {
  const episodes = await tx.employmentEpisode.findMany({
    where: { employeeId },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    include: { statusEvents: { orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] } },
  });
  return (
    episodes.find(
      (e) =>
        dateString(e.startDate) <= shiftDate &&
        (!e.endDate || dateString(e.endDate) >= shiftDate) &&
        ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD'].includes(statusOn(e, shiftDate))
    ) || null
  );
}


// ─── Get attendance status ──────────────────────────────────────────
async function getAttendanceStatus(userId, now = clock.now()) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!employee) {
      return {
        state: 'PROFILE_LINK_REQUIRED',
        attendance: null,
        schedule: null,
        canClockIn: false,
        canClockOut: false,
      };
    }

    const local=localParts(now,'Asia/Karachi');
    const anchor=local.time<'05:00'?addDays(local.date,-1):local.date;
    const approvedLeave=await tx.leaveRequest.findFirst({where:{employeeId:employee.id,shiftDate:dateValue(anchor),status:'APPROVED'},select:{id:true,shiftDate:true}});
    const schedule = await getScheduleContext(tx, now);
    if (!schedule) {
      return {
        state: approvedLeave?'PAID_LEAVE':'SETUP_REQUIRED',
        approvedLeave:approvedLeave?{id:approvedLeave.id,shiftDate:dateString(approvedLeave.shiftDate),days:1,paid:true}:null,
        attendance: formatAttendanceRecord(await tx.attendanceRecord.findFirst({ where: { employeeId: employee.id, status: { in: ['OPEN', 'MISSING_CHECKOUT'] } } }), now),
        schedule: null,
        canClockIn: false,
        canClockOut: !!(await tx.attendanceRecord.findFirst({ where: { employeeId: employee.id, status: { in: ['OPEN', 'MISSING_CHECKOUT'] } } })),
      };
    }

    // Check for existing open session (any shift date)
    const openSession = await tx.attendanceRecord.findFirst({
      where: { employeeId: employee.id, status: { in: ['OPEN', 'MISSING_CHECKOUT'] } },
      orderBy: { clockInAt: 'desc' },
    });

    // Check for today's attendance
    const todayRecord = await tx.attendanceRecord.findUnique({
      where: {
        employeeId_shiftDate: {
          employeeId: employee.id,
          shiftDate: dateValue(schedule.shiftDate),
        },
      },
    });

    const approvedException = await tx.attendanceCorrectionRequest.findFirst({ where: { employeeId: employee.id, shiftDate: dateValue(schedule.shiftDate), attendanceRecordId: null, status: 'APPROVED' }, orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }] });
    const eligible = await findEligibleEpisode(
      tx,
      employee.id,
      schedule.shiftDate
    );
    const hasLegacy = await hasLegacyAssignment(
      tx,
      employee.id,
      schedule.shiftDate
    );

    // Determine clock in eligibility
    let canClockIn = false;
    let canClockOut = false;
    let clockInBlockReason = null;

    if (openSession) {
      // There is an unresolved open session
      canClockOut = true;
      canClockIn = false;
      clockInBlockReason = 'OPEN_SESSION_EXISTS';
    } else if (approvedLeave) {
      clockInBlockReason = 'APPROVED_PAID_LEAVE';
    } else if (approvedException) {
      clockInBlockReason = 'APPROVED_EXCEPTION';
    } else if (todayRecord) {
      // Already clocked in/out for today
      canClockIn = false;
      clockInBlockReason = 'ALREADY_CLOCKED';
    } else if (!eligible) {
      canClockIn = false;
      clockInBlockReason = 'NOT_ELIGIBLE';
    } else if (hasLegacy) {
      canClockIn = false;
      clockInBlockReason = 'LEGACY_ASSIGNMENT';
    } else if (
      schedule.type === 'WEEKLY_OFF' ||
      schedule.type === 'HOLIDAY'
    ) {
      canClockIn = false;
      clockInBlockReason = schedule.type;
    } else if (schedule.type !== 'SCHEDULED') {
      canClockIn = false;
      clockInBlockReason = 'NOT_SCHEDULED';
    } else {
      // Must be within the duty window (at or after scheduled start)
      // Grace period is for lateness tracking, not for early clock-in
      if (now >= schedule.startInstant && now < schedule.endInstant) {
        canClockIn = true;
      } else {
        canClockIn = false;
        clockInBlockReason =
          now < schedule.startInstant
            ? 'BEFORE_DUTY_START'
            : 'AFTER_DUTY_END';
      }
    }

    const formatRecord = r => formatAttendanceRecord(r, now);

    return {
      state: approvedLeave?'PAID_LEAVE':schedule.type,
      approvedLeave:approvedLeave?{id:approvedLeave.id,shiftDate:dateString(approvedLeave.shiftDate),days:1,paid:true}:null,
      attendance: formatRecord(openSession || todayRecord),
      approvedException: approvedException ? formatCorrectionRequest(approvedException) : null,
      schedule: {
        shiftDate: schedule.shiftDate,
        startTime: '19:00',
        endTime: '05:00',
        endsNextDay: true,
        timeZone: schedule.zone,
        startsAt: schedule.startInstant.toISOString(),
        endsAt: schedule.endInstant.toISOString(),
        graceMinutes: schedule.graceMinutes,
      },
      canClockIn,
      canClockOut,
      clockInBlockReason,
      asOf: now.toISOString(),
    };
  });
}

// ─── Clock In ────────────────────────────────────────────────────────
async function clockIn(userId, requestId, now = clock.now()) {
  if (
    !requestId ||
    typeof requestId !== 'string' ||
    requestId.length < 8 ||
    requestId.length > 64
  ) {
    fail(400, 'A valid request identifier is required.', 'VALIDATION_ERROR');
  }

  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!employee) {
      fail(
        403,
        'No linked employee profile. Contact Admin/HR.',
        'PROFILE_LINK_REQUIRED'
      );
    }

    // Idempotency: check for existing record with this request ID
    if (await tx.attendanceRecord.findUnique({ where: { clockOutRequestId: requestId } })) fail(409, 'Request identifier is bound to a checkout.', 'REQUEST_CONFLICT');
    const existing = await tx.attendanceRecord.findUnique({
      where: { clockInRequestId: requestId },
    });
    if (existing) {
      if (existing.employeeId !== employee.id) fail(409, 'Request identifier is already bound.', 'REQUEST_CONFLICT');
      // Return the existing record unchanged for replay safety
      return formatAttendanceRecord(existing);
    }

    // Check for unresolved open sessions
    const openSession = await tx.attendanceRecord.findFirst({
      where: { employeeId: employee.id, status: { in: ['OPEN', 'MISSING_CHECKOUT'] } },
    });
    if (openSession) {
      fail(
        409,
        'You have an unresolved open attendance session. Clock out or request a correction first.',
        'OPEN_SESSION_EXISTS'
      );
    }

    const schedule = await getScheduleContext(tx, now);
    if (!schedule || schedule.type !== 'SCHEDULED') {
      fail(
        409,
        'No active scheduled duty at this time. Clock In requires an approved, current duty window.',
        'NO_ACTIVE_SCHEDULE'
      );
    }

    if (await tx.leaveRequest.findFirst({where:{employeeId:employee.id,shiftDate:dateValue(schedule.shiftDate),status:'APPROVED'}})) fail(409,'Approved full-day paid leave blocks Clock In. Contact HR.','APPROVED_PAID_LEAVE');
    // Must be within scheduled duty window
    if (now < schedule.startInstant) {
      fail(
        409,
        'Clock In is only available during or after the scheduled duty start time.',
        'BEFORE_DUTY_START'
      );
    }
    if (now >= schedule.endInstant) {
      fail(
        409,
        'The scheduled duty has ended. Clock In is no longer available.',
        'AFTER_DUTY_END'
      );
    }

    // Check for existing record for this shift date
    const existingForDate = await tx.attendanceRecord.findUnique({
      where: {
        employeeId_shiftDate: {
          employeeId: employee.id,
          shiftDate: dateValue(schedule.shiftDate),
        },
      },
    });
    if (existingForDate) {
      fail(
        409,
        'Attendance already recorded for this duty date.',
        'ALREADY_CLOCKED'
      );
    }
    if (await tx.attendanceCorrectionRequest.findFirst({ where: { employeeId: employee.id, shiftDate: dateValue(schedule.shiftDate), attendanceRecordId: null, status: 'APPROVED' } })) fail(409, 'This duty has an approved attendance exception. Contact HR before recording another entry.', 'ALREADY_CLOCKED');

    // Check employment eligibility
    const episode = await findEligibleEpisode(
      tx,
      employee.id,
      schedule.shiftDate
    );
    if (!episode) {
      fail(
        403,
        'No eligible employment on this date.',
        'NOT_ELIGIBLE'
      );
    }

    // Check legacy assignment restrictions
    if (await hasLegacyAssignment(tx, employee.id, schedule.shiftDate)) {
      fail(
        409,
        'An individual shift assignment exists. Attendance uses the common schedule; review the legacy assignment.',
        'LEGACY_ASSIGNMENT'
      );
    }

    // Determine lateness: late if clock-in is after scheduled start + grace
    const graceDeadline = new Date(
      schedule.startInstant.getTime() + schedule.graceMinutes * 60000
    );
    // Exactly at graceDeadline (19:30:00.000) is within grace → not late
    // Anything after 19:30:00.000 is late
    const isLate = now > graceDeadline;

    const record = await tx.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        employmentEpisodeId: episode.id,
        shiftDate: dateValue(schedule.shiftDate),
        scheduledStart: schedule.startInstant,
        scheduledEnd: schedule.endInstant,
        scheduleTimeZone: schedule.zone,
        graceMinutes: schedule.graceMinutes,
        clockInAt: now,
        status: 'OPEN',
        isLate,
        clockInRequestId: requestId,
        clockInActorUserId: user.id,
        officeScheduleId: schedule.versionId,
        scheduleSnapshot: {
          versionId: schedule.versionId,
          shiftDate: schedule.shiftDate,
          startTime: '19:00',
          endTime: '05:00',
          timeZone: schedule.zone,
          graceMinutes: schedule.graceMinutes,
          workDays: schedule.policy.workDays,
          breakTrackingEnabled: schedule.policy.breakTrackingEnabled,
          automaticBreakDeduction: schedule.policy.automaticBreakDeduction,
          holidayPolicy: schedule.policy.holidayPolicy,
        },
      },
    });

    await audit(tx, user.id, 'ATTENDANCE_CLOCK_IN', record.id, {
      shiftDate: schedule.shiftDate,
      clockInAt: now.toISOString(),
      isLate,
      requestId,
    });

    return formatAttendanceRecord(record);
  });
}

// ─── Clock Out ───────────────────────────────────────────────────────
async function clockOut(userId, requestId, attendanceRecordId, now = clock.now()) {
  if (
    !requestId ||
    typeof requestId !== 'string' ||
    requestId.length < 8 ||
    requestId.length > 64
  ) {
    fail(400, 'A valid request identifier is required.', 'VALIDATION_ERROR');
  }

  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!employee) {
      fail(
        403,
        'No linked employee profile.',
        'PROFILE_LINK_REQUIRED'
      );
    }

    // Idempotency: check for existing record with this clock-out request ID
    if (await tx.attendanceRecord.findUnique({ where: { clockInRequestId: requestId } })) fail(409, 'Request identifier is bound to an entry.', 'REQUEST_CONFLICT');
    const existingByRequest = await tx.attendanceRecord.findUnique({
      where: { clockOutRequestId: requestId },
    });
    if (existingByRequest) {
      if (existingByRequest.employeeId !== employee.id || existingByRequest.id !== attendanceRecordId) fail(409, 'Request identifier is already bound.', 'REQUEST_CONFLICT');
      return formatAttendanceRecord(existingByRequest);
    }

    if (!attendanceRecordId) fail(400, 'An exact attendance record is required.', 'VALIDATION_ERROR');
    // Find open session
    const openSession = await tx.attendanceRecord.findFirst({
      where: { id: attendanceRecordId, employeeId: employee.id, status: { in: ['OPEN', 'MISSING_CHECKOUT'] } },
      orderBy: { clockInAt: 'desc' },
    });
    if (!openSession) {
      fail(
        409,
        'No open attendance session to clock out.',
        'NO_OPEN_SESSION'
      );
    }

    // Verify ownership
    if (openSession.employeeId !== employee.id) {
      fail(403, 'Access denied.', 'FORBIDDEN');
    }

    if (now < openSession.clockInAt) fail(409, 'Checkout cannot precede Clock In.', 'INVALID_TIME_SEQUENCE');
    const workedMinutes = Math.floor(
      (now.getTime() - openSession.clockInAt.getTime()) / 60000
    );
    const isEarlyDeparture = now < openSession.scheduledEnd;
    const isAfterScheduleEnd = now > openSession.scheduledEnd;
    const isMissingCheckout = false; // Actual checkout is happening

    const record = await tx.attendanceRecord.update({
      where: { id: openSession.id, version: openSession.version },
      data: {
        clockOutAt: now,
        status: 'COMPLETED',
        isEarlyDeparture,
        isAfterScheduleEnd,
        workedMinutes,
        clockOutRequestId: requestId,
        clockOutActorUserId: user.id,
        version: { increment: 1 },
      },
    });

    await audit(tx, user.id, 'ATTENDANCE_CLOCK_OUT', record.id, {
      shiftDate: dateString(record.shiftDate),
      clockOutAt: now.toISOString(),
      isEarlyDeparture,
      isAfterScheduleEnd,
      workedMinutes,
      requestId,
    });

    return formatAttendanceRecord(record);
  });
}

// ─── Own Attendance History ──────────────────────────────────────────
async function getOwnHistory(
  userId,
  { page = 1, pageSize = 20, dateFrom, dateTo } = {}
) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!employee) {
      return { records: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const where = { employeeId: employee.id };
    if (dateFrom || dateTo) {
      where.shiftDate = {};
      if (dateFrom) where.shiftDate.gte = dateValue(dateFrom);
      if (dateTo) where.shiftDate.lte = dateValue(dateTo);
    }

    const [records, total] = [
      await tx.attendanceRecord.findMany({
        where,
        orderBy: { shiftDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      await tx.attendanceRecord.count({ where }),
    ];

    return {
      records: records.map(r => formatAttendanceRecord(r)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });
}

// ─── HR/Manager Attendance List ──────────────────────────────────────
async function getAttendanceList(
  userId,
  {
    page = 1,
    pageSize = 20,
    dateFrom,
    dateTo,
    employeeId,
    search,
    departmentId, campaignId, teamId,
    status,
  } = {}
) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);

    // Build the scope filter
    let employeeFilter = {};
    if (user.role === 'EMPLOYEE') {
      // Employees see only their own
      const emp = await tx.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!emp) return { records: [], total: 0, page, pageSize, totalPages: 0 };
      employeeFilter = { employeeId: emp.id };
    } else if (user.role === 'MANAGER') {
      const managers = await tx.teamManagerAssignment.findMany({ where: { managerUserId: user.id } });
      const assignments = await tx.organizationAssignment.findMany({ where: { teamId: { in: managers.map(m => m.teamId) } } });
      const intervals = [];
      for (const m of managers) for (const a of assignments.filter(a => a.teamId === m.teamId)) {
        const from = new Date(Math.max(+m.effectiveFrom, +a.effectiveFrom));
        const until = Math.min(m.effectiveTo ? +m.effectiveTo : Infinity, a.effectiveTo ? +a.effectiveTo : Infinity);
        if (+from <= until) intervals.push({ employeeId: a.employeeId, shiftDate: { gte: from, ...(Number.isFinite(until) ? { lte: new Date(until) } : {}) } });
      }
      employeeFilter = { OR: intervals.length ? intervals : [{ employeeId: '00000000-0000-0000-0000-000000000000' }] };
    }
    // ADMIN/HR: no employee filter restriction

    const where = { AND: [employeeFilter] };

    if (employeeId) {
      // Additional employee filter from query
      if (user.role === 'EMPLOYEE') {
        // Must match their own
        const emp = await tx.employee.findUnique({
          where: { userId: user.id },
          select: { id: true },
        });
        if (!emp || emp.id !== employeeId) {
          fail(403, 'Access denied.', 'FORBIDDEN');
        }
      }
      where.AND.push({ employeeId });
    }

    if (dateFrom || dateTo) {
      where.shiftDate = {};
      if (dateFrom) where.shiftDate.gte = dateValue(dateFrom);
      if (dateTo) where.shiftDate.lte = dateValue(dateTo);
    }

    if (status === 'MISSING_CHECKOUT') where.AND.push({ OR: [{ isMissingCheckout: true }, { status: { in: ['OPEN', 'MISSING_CHECKOUT'] }, scheduledEnd: { lte: clock.now() } }] });
    else if (status) where.status = status;
    if (search) where.employee = { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { employeeCode: { contains: search, mode: 'insensitive' } }] };
    if (departmentId || campaignId || teamId) {
      // New placements can name a department/campaign without a team. Match
      // the dated assignment's own links; use team links only for legacy nulls.
      const placement = [];
      if (teamId) placement.push({ teamId });
      if (departmentId) placement.push({ OR: [{ departmentId }, { departmentId: null, team: { departmentId } }] });
      if (campaignId) placement.push({ OR: [{ campaignId }, { campaignId: null, team: { campaignId } }] });
      const assignments = await tx.organizationAssignment.findMany({ where: { AND: placement } });
      where.AND.push({ OR: assignments.length ? assignments.map(a => ({ employeeId: a.employeeId, shiftDate: { gte: a.effectiveFrom, ...(a.effectiveTo ? { lte: a.effectiveTo } : {}) } })) : [{ employeeId: '00000000-0000-0000-0000-000000000000' }] });
    }

    const [records, total] = [
      await tx.attendanceRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
            },
          },
        },
        orderBy: [{ shiftDate: 'desc' }, { clockInAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      await tx.attendanceRecord.count({ where }),
    ];

    return {
      records: records.map((r) => ({
        ...formatAttendanceRecord(r),
        employee: r.employee,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });
}

// ─── Submit Correction Request ───────────────────────────────────────
async function submitCorrectionRequest(
  userId,
  { attendanceRecordId, shiftDate, requestType, correctedClockIn, correctedClockOut, reason }
) {
  if (!reason || reason.trim().length < 1) {
    fail(400, 'A reason is required for correction requests.', 'VALIDATION_ERROR');
  }
  if (!['MISSING_CHECKOUT', 'WRONG_TIME', 'OTHER'].includes(requestType)) {
    fail(400, 'Invalid correction request type.', 'VALIDATION_ERROR');
  }

  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const employee = await tx.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!employee) {
      fail(403, 'No linked employee profile.', 'PROFILE_LINK_REQUIRED');
    }

    let record = null;
    if (attendanceRecordId) {
      record = await tx.attendanceRecord.findUnique({
        where: { id: attendanceRecordId },
      });
      if (!record || record.employeeId !== employee.id) {
        fail(404, 'Attendance record not found.', 'NOT_FOUND');
      }
    }

    if (record && dateString(record.shiftDate) !== shiftDate) fail(400, 'Correction date must match the attendance record.', 'VALIDATION_ERROR');
    // Check for existing pending correction for this shift date
    const existingPending = await tx.attendanceCorrectionRequest.findFirst({
      where: {
        employeeId: employee.id,
        shiftDate: dateValue(shiftDate),
        status: 'PENDING',
      },
    });
    if (existingPending) {
      fail(
        409,
        'A pending correction already exists for this date. Wait for review.',
        'CORRECTION_PENDING'
      );
    }

    const proposedIn = correctedClockIn ? new Date(correctedClockIn) : (record?.approvedAdjustment?.clockInAt ? new Date(record.approvedAdjustment.clockInAt) : record?.clockInAt);
    const proposedOut = correctedClockOut ? new Date(correctedClockOut) : (record?.approvedAdjustment?.clockOutAt ? new Date(record.approvedAdjustment.clockOutAt) : record?.clockOutAt);
    if ((correctedClockIn && !Number.isFinite(+proposedIn)) || (correctedClockOut && !Number.isFinite(+proposedOut)) || (proposedIn && proposedOut && proposedOut < proposedIn) || (proposedIn && proposedIn > clock.now()) || (proposedOut && proposedOut > clock.now())) fail(400, 'Invalid correction time sequence.', 'VALIDATION_ERROR');
    if (record && (proposedIn < record.scheduledStart || proposedIn >= record.scheduledEnd)) fail(400, 'Proposed entry must belong to this duty.', 'VALIDATION_ERROR');
    if (!record && (!proposedIn || !proposedOut)) fail(400, 'A missing-punch exception needs both proposed times.', 'VALIDATION_ERROR');
    if (!record) {
      const context = await getScheduleContext(tx, instantFor(shiftDate, '19:00', 'Asia/Karachi'));
      if (!context || context.type !== 'SCHEDULED' || !(await findEligibleEpisode(tx, employee.id, shiftDate)) || await hasLegacyAssignment(tx, employee.id, shiftDate)) fail(409, 'No eligible scheduled duty on this date.', 'NOT_ELIGIBLE');
      if (proposedIn < context.startInstant || proposedIn >= context.endInstant) fail(400, 'Proposed entry must belong to the requested duty.', 'VALIDATION_ERROR');
    }
    const correction = await tx.attendanceCorrectionRequest.create({
      data: {
        attendanceRecordId: record?.id || null,
        employeeId: employee.id,
        shiftDate: dateValue(shiftDate),
        requestType,
        correctedClockIn: correctedClockIn ? new Date(correctedClockIn) : null,
        correctedClockOut: correctedClockOut
          ? new Date(correctedClockOut)
          : null,
        reason: reason.trim(),
        requestedByUserId: user.id,
        originalData: record
          ? {
              recordVersion: record.version,
              approvedAdjustment: record.approvedAdjustment,
              clockInAt: record.clockInAt.toISOString(),
              clockOutAt: record.clockOutAt
                ? record.clockOutAt.toISOString()
                : null,
              status: record.status,
              isLate: record.isLate,
              isEarlyDeparture: record.isEarlyDeparture,
            }
          : null,
      },
    });

    await audit(tx, user.id, 'ATTENDANCE_CORRECTION_REQUESTED', correction.id, {
      shiftDate,
      requestType,
      attendanceRecordId: record?.id || null,
    });

    await require('./workflow-notifications').correctionSubmitted(tx, correction, user.id);
    return formatCorrectionRequest(correction);
  });
}

// ─── Review Correction (Admin/HR only) ───────────────────────────────
async function reviewCorrection(
  userId,
  correctionId,
  { decision, reviewReason, expectedVersion }
) {
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    fail(400, 'Decision must be APPROVED or REJECTED.', 'VALIDATION_ERROR');
  }
  if (!reviewReason || reviewReason.trim().length < 1) {
    fail(400, 'A review reason is required.', 'VALIDATION_ERROR');
  }

  return transaction(async (tx) => {
    const user = await actor(tx, userId); // Requires ADMIN/HR

    const correction = await tx.attendanceCorrectionRequest.findUnique({
      where: { id: correctionId },
    });
    if (!correction) {
      fail(404, 'Correction request not found.', 'NOT_FOUND');
    }
    if (correction.status !== 'PENDING') {
      fail(409, 'This correction has already been reviewed.', 'ALREADY_REVIEWED');
    }
    if (correction.version !== expectedVersion) {
      fail(
        409,
        'Correction has been modified. Reload and try again.',
        'VERSION_CONFLICT'
      );
    }

    const now = clock.now();
    const updated = await tx.attendanceCorrectionRequest.update({
      where: { id: correctionId, version: correction.version },
      data: {
        status: decision,
        reviewedByUserId: user.id,
        reviewReason: reviewReason.trim(),
        reviewedAt: now,
        version: { increment: 1 },
      },
    });

    // Corrections never replace actual punch evidence or raw duration.
    if (decision === 'APPROVED' && correction.attendanceRecordId) {
      const record = await tx.attendanceRecord.findUnique({ where: { id: correction.attendanceRecordId } });
      if (!record || record.version !== correction.originalData?.recordVersion) fail(409, 'Attendance changed after this request. Submit a fresh request.', 'VERSION_CONFLICT');
      const entry = correction.correctedClockIn || (record.approvedAdjustment?.clockInAt ? new Date(record.approvedAdjustment.clockInAt) : record.clockInAt);
      const exit = correction.correctedClockOut || (record.approvedAdjustment?.clockOutAt ? new Date(record.approvedAdjustment.clockOutAt) : record.clockOutAt);
      if (exit && exit < entry) fail(400, 'Invalid correction time sequence.', 'VALIDATION_ERROR');
      await tx.attendanceRecord.update({ where: { id: record.id, version: record.version }, data: {
        approvedAdjustment: { correctionId, clockInAt: entry.toISOString(), clockOutAt: exit?.toISOString() || null, minutes: exit ? Math.floor((exit - entry) / 60000) : null, reviewedAt: now.toISOString(), reviewerUserId: user.id },
        ...(exit ? { status: 'CORRECTED' } : {}), version: { increment: 1 },
      } });
    }
    if (decision === 'APPROVED' && !correction.attendanceRecordId) {
      if (await tx.attendanceRecord.findUnique({ where: { employeeId_shiftDate: { employeeId: correction.employeeId, shiftDate: correction.shiftDate } } })) fail(409, 'Attendance now exists. Submit a request against that record.', 'VERSION_CONFLICT');
      // The approved exception remains separate evidence, never a fabricated server punch.
    }

    await audit(tx, user.id, 'ATTENDANCE_CORRECTION_REVIEWED', correctionId, {
      decision,
      shiftDate: dateString(correction.shiftDate),
      employeeId: correction.employeeId,
    });

    await require('./workflow-notifications').correctionReviewed(tx, updated, user.id);
    return formatCorrectionRequest(updated);
  });
}

// ─── List Corrections ────────────────────────────────────────────────
async function listCorrections(
  userId,
  { page = 1, pageSize = 20, status: filterStatus, employeeId, ownOnly = false } = {}
) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);

    const where = {};

    if (ownOnly || user.role === 'EMPLOYEE') {
      const emp = await tx.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!emp)
        return { corrections: [], total: 0, page, pageSize, totalPages: 0 };
      where.employeeId = emp.id;
    } else if (user.role === 'MANAGER') {
      // Managers cannot review corrections per requirements
      // They can only see their own if they have an employee profile
      const emp = await tx.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!emp)
        return { corrections: [], total: 0, page, pageSize, totalPages: 0 };
      where.employeeId = emp.id;
    }
    // ADMIN/HR see all

    if (filterStatus) where.status = filterStatus;
    if (!ownOnly && employeeId && ['ADMIN', 'HR'].includes(user.role)) {
      where.employeeId = employeeId;
    }

    const [corrections, total] = [
      await tx.attendanceCorrectionRequest.findMany({
        where,
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true } },
          requestedBy: { select: { id: true, displayName: true } },
          reviewedBy: { select: { id: true, displayName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      await tx.attendanceCorrectionRequest.count({ where }),
    ];

    return {
      corrections: corrections.map((c) => ({
        ...formatCorrectionRequest(c),
        employee: c.employee,
        requestedBy: c.requestedBy,
        reviewedBy: c.reviewedBy,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });
}

// ─── Daily summary helper ─────────────────────────────────────────────
async function getDailySummary(userId, shiftDate) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId); // Admin/HR only

    const records = await tx.attendanceRecord.findMany({
      where: { shiftDate: dateValue(shiftDate) },
      include: {
        employee: {
          select: { id: true, employeeCode: true, fullName: true },
        },
      },
      orderBy: { clockInAt: 'asc' },
      take:2001,
    });

    const now = clock.now();
    const maximum=2000;
    const employees = await tx.employee.findMany({take:maximum+1,select:{id:true,employeeCode:true,fullName:true,
      employmentEpisodes:{select:{startDate:true,endDate:true,status:true,statusEffectiveDate:true,statusEvents:{select:{id:true,effectiveDate:true,createdAt:true,fromStatus:true,toStatus:true}}}},
      shiftAssignments:{select:{effectiveFrom:true,effectiveTo:true}}}});
    if(employees.length>maximum||records.length>maximum)fail(413,'Daily summary exceeds 2000 employees. Use scoped reports.','REPORT_TOO_LARGE');
    const versions=await tx.officeSchedule.findMany({orderBy:[{effectiveFrom:'asc'},{id:'asc'}],take:2001,select:{id:true,effectiveFrom:true,policy:true}});
    if(versions.length>2000)fail(413,'Policy history exceeds the summary limit.','REPORT_TOO_LARGE');
    const holiday=await tx.companyHolidayEvent.findFirst({where:{holidayDate:dateValue(shiftDate)},orderBy:{revision:'desc'},select:{action:true}});
    const approvedExceptions = await tx.attendanceCorrectionRequest.findMany({where:{shiftDate:dateValue(shiftDate),attendanceRecordId:null,status:'APPROVED'},take:30001});
    if(approvedExceptions.length>30000)fail(413,'Correction history exceeds the summary limit.','REPORT_TOO_LARGE');
    const paidLeaves = await tx.leaveRequest.findMany({where:{shiftDate:dateValue(shiftDate),status:'APPROVED'},take:2001,select:{id:true,employeeId:true,startsAt:true,endsAt:true}});
    if(paidLeaves.length>2000)fail(413,'Leave history exceeds the summary limit.','REPORT_TOO_LARGE');
    const recordMap=new Map(records.map(r=>[r.employeeId,r])),leaveMap=new Map(paidLeaves.map(r=>[r.employeeId,r]));
    const exceptionMap=new Map();
    for(const correction of [...approvedExceptions].sort((a,b)=>+b.reviewedAt-+a.reviewedAt||b.id.localeCompare(a.id)))if(!exceptionMap.has(correction.employeeId))exceptionMap.set(correction.employeeId,correction);
    const {classifyDuty}=require('../utils/reports-rules');
    const classifications=employees.map(employee=>{
      const row=classifyDuty({employee,date:shiftDate,versions,holidayDates:holiday?.action==='ANNOUNCE'?[shiftDate]:[],record:recordMap.get(employee.id),exception:exceptionMap.get(employee.id),approvedLeave:leaveMap.get(employee.id),now});
      return {employee:{id:employee.id,employeeCode:employee.employeeCode,fullName:employee.fullName},classification:row.classification};
    });
    const summary = {
      classifications,
      paidLeaveDays:paidLeaves.length,
      noClockIn: classifications.filter(c => c.classification === 'NO_CLOCK_IN').length,
      approvedExceptions: approvedExceptions.map(formatCorrectionRequest),
      date: shiftDate,
      totalRecords: records.length,
      onTime: records.filter((r) => !r.isLate).length,
      late: records.filter((r) => r.isLate).length,
      earlyDeparture: records.filter((r) => r.isEarlyDeparture).length,
      missingCheckout: records.filter(
        (r) => r.isMissingCheckout || (['OPEN', 'MISSING_CHECKOUT'].includes(r.status) && clock.now() >= r.scheduledEnd)
      ).length,
      completed: records.filter((r) => r.status === 'COMPLETED').length,
      records: records.map((r) => ({
        ...formatAttendanceRecord(r),
        employee: r.employee,
      })),
    };

    return summary;
  });
}

// ─── Format helpers ──────────────────────────────────────────────────
function formatAttendanceRecord(r, now = clock.now()) {
  if (!r) return null;
  return {
    id: r.id,
    employeeId: r.employeeId,
    shiftDate: dateString(r.shiftDate),
    scheduledStart: r.scheduledStart.toISOString(),
    scheduledEnd: r.scheduledEnd.toISOString(),
    scheduleTimeZone: r.scheduleTimeZone,
    graceMinutes: r.graceMinutes,
    clockInAt: r.clockInAt.toISOString(),
    clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
    status: r.status,
    isLate: r.isLate,
    isEarlyDeparture: r.isEarlyDeparture,
    isMissingCheckout: r.isMissingCheckout || (['OPEN', 'MISSING_CHECKOUT'].includes(r.status) && now >= r.scheduledEnd),
    isAfterScheduleEnd: r.isAfterScheduleEnd,
    workedMinutes: r.workedMinutes,
    version: r.version,
    clockInRequestId: r.clockInRequestId,
    clockOutRequestId: r.clockOutRequestId,
    approvedAdjustment: r.approvedAdjustment ? {
      correctionId: r.approvedAdjustment.correctionId,
      clockInAt: r.approvedAdjustment.clockInAt,
      clockOutAt: r.approvedAdjustment.clockOutAt,
      minutes: r.approvedAdjustment.minutes,
      reviewedAt: r.approvedAdjustment.reviewedAt,
    } : null,
  };
}

function formatCorrectionRequest(c) {
  return {
    id: c.id,
    attendanceRecordId: c.attendanceRecordId,
    employeeId: c.employeeId,
    shiftDate: dateString(c.shiftDate),
    requestType: c.requestType,
    correctedClockIn: c.correctedClockIn
      ? c.correctedClockIn.toISOString()
      : null,
    correctedClockOut: c.correctedClockOut
      ? c.correctedClockOut.toISOString()
      : null,
    reason: c.reason,
    status: c.status,
    reviewReason: c.reviewReason,
    reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null,
    originalData: c.originalData,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
  };
}

module.exports = {
  findEligibleEpisode, hasLegacyAssignment,
  getAttendanceStatus,
  clockIn,
  clockOut,
  getOwnHistory,
  getAttendanceList,
  submitCorrectionRequest,
  reviewCorrection,
  listCorrections,
  getDailySummary,
};
