"use strict";
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { localParts } = require('../utils/office-schedule');

const fail = (status, message, code = 'VALIDATION_ERROR') => { throw new ApiError(status, message, code); };
const date = value => value == null ? null : new Date(`${value}T00:00:00.000Z`);
const day = () => date(localParts(new Date(), 'Asia/Karachi').date);
const current = now => ({ effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] });
async function actor(tx, id, management = true) {
  const user = await tx.user.findUnique({ where: { id } });
  if (!user || user.status !== 'ACTIVE') fail(401, 'Account unavailable.', 'UNAUTHENTICATED');
  if (user.mustChangePassword) fail(403, 'Change your password first.', 'PASSWORD_CHANGE_REQUIRED');
  if (management && !['ADMIN', 'HR'].includes(user.role)) fail(403, 'Management access required.', 'FORBIDDEN');
  return user;
}
async function audit(tx, id, action, targetId, metadata = {}) {
  await tx.auditLog.create({ data: { actorUserId: id, action, success: true, targetType: 'EmployeeManagement', targetId, metadata } });
}
async function transaction(work) {
  try { return await prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 }); }
  catch (error) {
    if (['P2002', 'P2004', 'P2034'].includes(error.code) || (error.code === 'P2039' && ['23P01', '23514'].includes(error.meta?.code)) || JSON.stringify(error.meta || {}).includes('23P01')) fail(409, 'Conflicting record or effective dates. Reload before trying again.', 'RECORD_CONFLICT');
    throw error;
  }
}
async function activeUnit(tx, id, kind) {
  const unit = await tx.organizationUnit.findUnique({ where: { id } });
  if (!unit || unit.kind !== kind || unit.archivedAt) fail(400, `Select an active ${kind.toLowerCase()}.`);
  return unit;
}
async function team(tx, id) {
  const result = await activeUnit(tx, id, 'TEAM');
  await activeUnit(tx, result.departmentId, 'DEPARTMENT');
  await activeUnit(tx, result.campaignId, 'CAMPAIGN');
  return result;
}
async function listOrganization(id) {
  return transaction(async tx => {
    await actor(tx, id);
    return { units: await tx.organizationUnit.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
      managers: await tx.teamManagerAssignment.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }], include: { manager: { select: { id: true, displayName: true } } } }) };
  });
}
async function createUnit(id, data) {
  return transaction(async tx => {
    await actor(tx, id);
    if (data.kind === 'TEAM') {
      if (!data.departmentId || !data.campaignId) fail(400, 'Teams require a department and campaign.');
      await activeUnit(tx, data.departmentId, 'DEPARTMENT'); await activeUnit(tx, data.campaignId, 'CAMPAIGN');
    } else if (data.departmentId || data.campaignId) fail(400, 'Only teams have parent references.');
    const unit = await tx.organizationUnit.create({ data: { ...data, actorUserId: id } });
    await audit(tx, id, 'ORGANIZATION_CREATED', unit.id, { kind: unit.kind }); return unit;
  });
}
async function archiveUnit(id, unitId, reason) {
  return transaction(async tx => {
    await actor(tx, id);
    const unit = await tx.organizationUnit.findUnique({ where: { id: unitId } });
    if (!unit) fail(404, 'Organization record not found.', 'NOT_FOUND');
    if (unit.archivedAt) fail(409, 'Record is already archived.', 'RECORD_CONFLICT');
    const archived = await tx.organizationUnit.update({ where: { id: unitId }, data: { archivedAt: new Date() } });
    await audit(tx, id, 'ORGANIZATION_ARCHIVED', unitId, { reason }); return archived;
  });
}
// A replacement explicitly ends the previous open interval on the preceding day.
// Closed historical rows cannot be rewritten. PostgreSQL exclusion constraints are the final race guard.
async function replaceInterval(model, field, owner, tx, data) {
  const from = date(data.effectiveFrom), to = date(data.effectiveTo);
  const open = await tx[model].findFirst({ where: { [field]: owner, effectiveTo: null } });
  if (open) {
    if (from <= open.effectiveFrom) fail(409, 'Replacement must start after the existing open assignment.', 'ASSIGNMENT_CONFLICT');
    await tx[model].update({ where: { id: open.id }, data: { effectiveTo: new Date(from.getTime() - 86400000) } });
  }
  return { effectiveFrom: from, effectiveTo: to };
}
async function assignEmployee(id, employeeId, data) {
  return transaction(async tx => {
    await actor(tx, id); await team(tx, data.teamId); await activeUnit(tx, data.designationId, 'DESIGNATION');
    if (!await tx.employee.findUnique({ where: { id: employeeId } })) fail(404, 'Employee not found.', 'NOT_FOUND');
    const dates = await replaceInterval('organizationAssignment', 'employeeId', employeeId, tx, data);
    const assignment = await tx.organizationAssignment.create({ data: { ...data, ...dates, employeeId, actorUserId: id } });
    await audit(tx, id, 'EMPLOYEE_ORGANIZATION_ASSIGNED', employeeId, { assignmentId: assignment.id, effectiveFrom: data.effectiveFrom }); return assignment;
  });
}
async function assignManager(id, teamId, data) {
  return transaction(async tx => {
    await actor(tx, id); await team(tx, teamId);
    const manager = await tx.user.findUnique({ where: { id: data.managerUserId } });
    if (!manager || manager.role !== 'MANAGER' || manager.status !== 'ACTIVE') fail(400, 'Select an active MANAGER account.');
    const dates = await replaceInterval('teamManagerAssignment', 'teamId', teamId, tx, data);
    const assignment = await tx.teamManagerAssignment.create({ data: { ...data, ...dates, teamId, actorUserId: id } });
    await audit(tx, id, 'TEAM_MANAGER_ASSIGNED', teamId, { assignmentId: assignment.id, effectiveFrom: data.effectiveFrom }); return assignment;
  });
}
async function employeeScope(tx, user, asOf = day()) {
  if (['ADMIN', 'HR'].includes(user.role)) return {};
  if (user.role === 'EMPLOYEE') return { userId: user.id };
  const teams = await tx.teamManagerAssignment.findMany({ where: { managerUserId: user.id, ...current(asOf) }, select: { teamId: true } });
  return { assignments: { some: { teamId: { in: teams.map(item => item.teamId) }, ...current(asOf) } } };
}
async function scopedEmployees(id, employeeId) {
  return transaction(async tx => {
    const user = await actor(tx, id, false), asOf = day(), scope = await employeeScope(tx, user, asOf);
    const employees = await tx.employee.findMany({ where: { AND: [scope, ...(employeeId ? [{ id: employeeId }] : [])] },
      select: { id: true, employeeCode: true, fullName: true, assignments: { where: current(asOf), select: { id: true, effectiveFrom: true, effectiveTo: true, team: { select: { name: true, department: { select: { name: true } }, campaign: { select: { name: true } } } }, designation: { select: { name: true } } } }, employmentEpisodes: { orderBy: [{ startDate: 'desc' }, { id: 'desc' }], take: 1, select: { startDate: true, endDate: true, status: true } } }, orderBy: [{ fullName: 'asc' }, { id: 'asc' }] });
    if (employeeId && !employees.length) fail(404, 'Employee not found.', 'NOT_FOUND');
    return employees;
  });
}
async function history(id, employeeId) {
  return transaction(async tx => {
    const user = await actor(tx, id, false), scope = await employeeScope(tx, user);
    if (!await tx.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] } })) fail(404, 'Employee not found.', 'NOT_FOUND');
    // Managers see only present assignment/basic employment, never historical HR reasons or actors.
    if (user.role === 'MANAGER') fail(403, 'Historical HR records are restricted.', 'FORBIDDEN');
    const management = ['ADMIN', 'HR'].includes(user.role);
    const episodes = await tx.employmentEpisode.findMany({ where: { employeeId }, orderBy: [{ startDate: 'desc' }, { id: 'desc' }], select: {
      id: true, startDate: true, endDate: true, status: true, statusEffectiveDate: true, probationEndDate: true, confirmedOn: true,
      statusEvents: { orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { id: true, fromStatus: true, toStatus: true, effectiveDate: true, ...(management ? { reason: true, actorUserId: true, approvedByUserId: true, approvedAt: true } : {}) } }
    } });
    const assignments = await tx.organizationAssignment.findMany({ where: { employeeId }, orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }], select: { id: true, effectiveFrom: true, effectiveTo: true, ...(management ? { reason: true, actorUserId: true } : {}), team: { select: { name: true, department: { select: { name: true } }, campaign: { select: { name: true } } } }, designation: { select: { name: true } } } });
    await audit(tx, id, 'EMPLOYEE_HISTORY_READ', employeeId); return { episodes, assignments };
  });
}
module.exports = { actor, audit, transaction, fail, listOrganization, createUnit, archiveUnit, assignEmployee, assignManager, scopedEmployees, history };
