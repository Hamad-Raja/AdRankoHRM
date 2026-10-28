'use strict';

const ApiError = require('./ApiError');

const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const at = value => new Date(`${value}T00:00:00.000Z`);
const covers = (row, date) => day(row.effectiveFrom) <= date
  && (!row.effectiveTo || day(row.effectiveTo) >= date);
const overlaps = (from, to) => ({
  effectiveFrom: { lte: at(to) },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: at(from) } }],
});

function fail(status, message, code = 'FORBIDDEN') {
  throw new ApiError(status, message, code);
}

function organizationMatches(assignment, filters) {
  return (!filters.teamId || assignment.teamId === filters.teamId)
    && (!filters.departmentId || assignment.team.departmentId === filters.departmentId)
    && (!filters.campaignId || assignment.team.campaignId === filters.campaignId);
}

function organizationView(assignment) {
  if (!assignment) return null;
  return {
    team: { id: assignment.teamId, name: assignment.team.name },
    department: assignment.team.department
      ? { id: assignment.team.departmentId, name: assignment.team.department.name } : null,
    campaign: assignment.team.campaign
      ? { id: assignment.team.campaignId, name: assignment.team.campaign.name } : null,
    designation: assignment.designation
      ? { id: assignment.designation.id, name: assignment.designation.name } : null,
  };
}

async function buildReportScope(tx, user, filters) {
  if (!['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(user.role)) {
    fail(403, 'Report access denied.');
  }
  const management = ['ADMIN', 'HR'].includes(user.role);
  const correctionOwnOnly = filters.report === 'corrections' && !management;
  let own = null;
  if (!management) {
    own = await tx.employee.findUnique({ where: { userId: user.id }, select: { id: true } });
  }
  const ownOnly = user.role === 'EMPLOYEE' || correctionOwnOnly;
  if (ownOnly && !own) fail(403, 'No linked employee profile.', 'PROFILE_LINK_REQUIRED');
  if (ownOnly && filters.employeeId && filters.employeeId !== own.id) {
    fail(403, 'Report access denied.');
  }

  let managers = [];
  if (user.role === 'MANAGER' && !ownOnly) {
    managers = await tx.teamManagerAssignment.findMany({
      where: { managerUserId: user.id, ...overlaps(filters.dateFrom, filters.dateTo) },
      select: { id: true, teamId: true, effectiveFrom: true, effectiveTo: true },
      orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }], take: 2001,
    });
    if (managers.length > 2000) {
      fail(413, 'Too many historical team intervals. Narrow the report period.', 'REPORT_TOO_LARGE');
    }
  }

  const AND = [];
  if (ownOnly) AND.push({ id: own.id });
  else if (!management) {
    const OR = own ? [{ id: own.id }] : [];
    for (const manager of managers) {
      const from = [day(manager.effectiveFrom), filters.dateFrom].sort().at(-1);
      const to = [day(manager.effectiveTo) || filters.dateTo, filters.dateTo].sort()[0];
      if (from <= to) OR.push({ assignments: { some: {
        teamId: manager.teamId, ...overlaps(from, to),
      } } });
    }
    AND.push({ OR: OR.length ? OR : [{ id: { in: [] } }] });
  }
  if (filters.employeeId) AND.push({ id: filters.employeeId });
  if (filters.search) AND.push({ OR: [
    { fullName: { contains: filters.search, mode: 'insensitive' } },
    { employeeCode: { contains: filters.search, mode: 'insensitive' } },
  ] });

  const hasOrganizationFilter = Boolean(filters.teamId || filters.departmentId || filters.campaignId);
  if (hasOrganizationFilter) AND.push({ assignments: { some: {
    ...overlaps(filters.dateFrom, filters.dateTo),
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
    team: {
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
  } } });

  function matchingAssignment(employee, date) {
    return employee.assignments.find(assignment => covers(assignment, date)
      && organizationMatches(assignment, filters)
      && (management || ownOnly || employee.id === own?.id
        || managers.some(manager => manager.teamId === assignment.teamId && covers(manager, date))));
  }

  function canSee(employee, date) {
    const assignment = matchingAssignment(employee, date);
    if (hasOrganizationFilter && !assignment) return false;
    if (management) return true;
    if (ownOnly) return employee.id === own.id;
    return employee.id === own?.id || Boolean(assignment);
  }

  return {
    where: { AND },
    access: management ? 'ORGANIZATION' : ownOnly ? 'OWN' : 'DATED_TEAM_AND_OWN',
    canSee,
    organizationFor: (employee, date) => organizationView(matchingAssignment(employee, date)),
  };
}

module.exports = { buildReportScope, organizationMatches, organizationView, overlaps };