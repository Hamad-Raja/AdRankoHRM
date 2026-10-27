"use strict";

const { actor, transaction, fail } = require("./organization.service");
const { dateValue, dateString, previousDate } = require("../utils/shift-rules");

const definitionSelect = {
  id: true, name: true, timeZone: true, startTime: true, endTime: true,
  endsNextDay: true, workDays: true, breakMinutes: true, breakPaid: true,
  graceMinutes: true, archivedAt: true, actorUserId: true, reason: true, createdAt: true,
};
const assignmentSelect = {
  id: true, employeeId: true, employmentEpisodeId: true, shiftId: true,
  effectiveFrom: true, effectiveTo: true, actorUserId: true, reason: true,
  closedByUserId: true, closedReason: true, closedAt: true, createdAt: true,
  shift: { select: definitionSelect },
};

function assignmentResponse(row) {
  return {
    ...row,
    effectiveFrom: dateString(row.effectiveFrom),
    effectiveTo: dateString(row.effectiveTo),
  };
}

async function audit(tx, userId, action, targetId, metadata) {
  await tx.auditLog.create({ data: {
    actorUserId: userId, action, targetType: "ShiftManagement", targetId,
    success: true, metadata,
  } });
}

async function listShifts(userId) {
  return transaction(async tx => {
    await actor(tx, userId);
    return { shifts: await tx.shiftDefinition.findMany({
      select: definitionSelect, orderBy: [{ name: "asc" }, { id: "asc" }],
    }) };
  });
}

async function createShift(userId, data) {
  return transaction(async tx => {
    await actor(tx, userId);
    const shift = await tx.shiftDefinition.create({
      data: { ...data, workDays: [...data.workDays].sort((a, b) => a - b), actorUserId: userId },
      select: definitionSelect,
    });
    await audit(tx, userId, "SHIFT_CREATED", shift.id, {
      timeZone: shift.timeZone, endsNextDay: shift.endsNextDay,
    });
    return { shift };
  });
}

async function archiveShift(userId, shiftId, reason) {
  return transaction(async tx => {
    await actor(tx, userId);
    const existing = await tx.shiftDefinition.findUnique({ where: { id: shiftId } });
    if (!existing) fail(404, "Shift not found.", "NOT_FOUND");
    if (existing.archivedAt) fail(409, "Shift is already archived.", "RECORD_CONFLICT");
    // Archive removes this definition from NEW assignments. Existing dated
    // assignments still refer to it; archiving never cancels their schedules.
    const shift = await tx.shiftDefinition.update({
      where: { id: shiftId }, data: { archivedAt: new Date() }, select: definitionSelect,
    });
    await audit(tx, userId, "SHIFT_ARCHIVED", shift.id, { reason });
    return { shift };
  });
}

async function listAssignments(userId, employeeId) {
  return transaction(async tx => {
    await actor(tx, userId);
    if (!await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } })) {
      fail(404, "Employee not found.", "NOT_FOUND");
    }
    const assignments = await tx.employeeShiftAssignment.findMany({
      where: { employeeId }, select: assignmentSelect,
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    return { assignments: assignments.map(assignmentResponse) };
  });
}

async function assignShift(userId, employeeId, data) {
  return transaction(async tx => {
    await actor(tx, userId);
    const shift = await tx.shiftDefinition.findUnique({ where: { id: data.shiftId }, select: { id: true, archivedAt: true } });
    if (!shift || shift.archivedAt) fail(400, "Select an active shift definition.");
    const episode = await tx.employmentEpisode.findUnique({
      where: { id: data.employmentEpisodeId },
      select: { id: true, employeeId: true, startDate: true, endDate: true, status: true },
    });
    if (!episode || episode.employeeId !== employeeId) fail(404, "Employment record not found for this employee.", "NOT_FOUND");
    if (!["ACTIVE", "PROBATION", "NOTICE_PERIOD"].includes(episode.status)) {
      fail(400, "Shift assignments require an active, probation or notice-period employment record.");
    }
    const from = dateValue(data.effectiveFrom), to = data.effectiveTo ? dateValue(data.effectiveTo) : null;
    if (from < episode.startDate || (episode.endDate && (!to || to > episode.endDate))) {
      fail(400, "Assignment dates must stay inside the employment period.");
    }
    let predecessor = null;
    if (data.replacesAssignmentId) {
      predecessor = await tx.employeeShiftAssignment.findUnique({ where: { id: data.replacesAssignmentId } });
      if (!predecessor || predecessor.employeeId !== employeeId ||
          predecessor.employmentEpisodeId !== episode.id || predecessor.effectiveTo !== null ||
          from <= predecessor.effectiveFrom) {
        fail(409, "The named open assignment has changed or cannot be replaced. Reload its history.", "ASSIGNMENT_CONFLICT");
      }
    }

    // Inclusive DATE intervals; the database exclusion constraint is the final
    // concurrency guard. No automatic transaction or request retries.
    const conflict = await tx.employeeShiftAssignment.findFirst({ where: {
      employeeId,
      ...(predecessor ? { id: { not: predecessor.id } } : {}),
      ...(to ? { effectiveFrom: { lte: to } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
    }, select: { id: true } });
    if (conflict) fail(409, "Assignment overlaps an existing schedule. Explicitly replace the intended open assignment or choose non-overlapping dates.", "ASSIGNMENT_CONFLICT");

    if (predecessor) {
      await tx.employeeShiftAssignment.update({
        where: { id: predecessor.id },
        data: { effectiveTo: previousDate(data.effectiveFrom), closedByUserId: userId, closedReason: data.reason, closedAt: new Date() },
      });
    }
    const assignment = await tx.employeeShiftAssignment.create({
      data: {
        employeeId, employmentEpisodeId: episode.id, shiftId: shift.id,
        effectiveFrom: from, effectiveTo: to, reason: data.reason, actorUserId: userId,
      }, select: assignmentSelect,
    });
    await audit(tx, userId, "EMPLOYEE_SHIFT_ASSIGNED", employeeId, {
      assignmentId: assignment.id, shiftId: shift.id, employmentEpisodeId: episode.id,
      replacesAssignmentId: predecessor?.id ?? null,
      effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo ?? null,
      reason: data.reason,
    });
    return { assignment: assignmentResponse(assignment) };
  });
}

module.exports = { listShifts, createShift, archiveShift, listAssignments, assignShift };