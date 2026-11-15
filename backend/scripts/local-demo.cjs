'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { assertConnectedDatabase } = require('../src/config/local-demo');
const ROLES = ['HR', 'MANAGER', 'EMPLOYEE'];
const unitNames = { DEPARTMENT: 'Synthetic Local Demo Department', CAMPAIGN: 'Synthetic Local Demo Campaign', DESIGNATION: 'Synthetic Local Demo Designation', TEAM: 'Synthetic Local Demo Team' };
const reason = 'User-authorized temporary local demo fixture; synthetic records only';

function save(file, manifest, initial = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (initial) fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  else {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}

async function setup({ prisma, databaseName, file }) {
  if (!require('../src/config/local-demo').APPROVED_LOCAL_DATABASES.has(databaseName) && !/^officehr_phase1_test_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Unsupported local demo setup target.');
  await assertConnectedDatabase(prisma, databaseName);
  if (fs.existsSync(file)) {
    const manifest = require('../src/services/local-demo.service').readManifest(file);
    for (const role of ROLES) {
      const credentials = await require('../src/services/local-demo.service').resolveDemoCredentials({ prisma, config: { databaseName, manifestPath: file }, role });
      const user = await prisma.user.findUnique({ where: { id: manifest.accounts[role].id } });
      if (!await require('../src/utils/password').verifyPassword(credentials.password, user.passwordHash)) throw new Error('Registered credentials changed; refusing to reset a password.');
    }
    return { reused: true, manifest };
  }
  const accounts = Object.fromEntries(ROLES.map(role => [role, { email: `officehr-local-demo-${role.toLowerCase()}@example.test`, password: 'LocalQA!' + randomBytes(24).toString('hex') }]));
  const codes = ROLES.map(role => 'LOCAL-DEMO-' + role);
  // Refuse any collision before the first fixture write. Never adopt an account
  // merely because its name/email looks synthetic, and never overwrite it.
  const collisions = await prisma.user.count({ where: { email: { in: Object.values(accounts).map(account => account.email) } } }) +
    await prisma.employee.count({ where: { employeeCode: { in: codes } } }) +
    await prisma.organizationUnit.count({ where: { name: { in: Object.values(unitNames) } } });
  if (collisions) throw new Error('Local demo identity/code/unit collision; no records were overwritten.');
  const administrator = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false }, select: { id: true }, orderBy: { id: 'asc' } });
  if (!administrator) throw new Error('An eligible existing Admin actor is required; no account will be modified to obtain one.');
  const org = require('../src/services/organization.service');
  const employees = require('../src/services/employee.service');
  const { createEmployeeSchema } = require('../src/validation/employee.validation');
  const { hashPassword } = require('../src/utils/password');
  const date = require('../src/utils/office-schedule').localParts(new Date(), 'Asia/Karachi').date;
  const manifest = { version: 1, complete: false, databaseName, createdAt: new Date().toISOString(), accounts, records: {
    users: [], employees: [], employment_episodes: [], employment_status_events: [], organization_units: [], organization_assignments: [], team_manager_assignments: [], audit_logs: [],
  } };
  save(file, manifest, true);
  for (const role of ROLES) {
    const account = accounts[role];
    const data = createEmployeeSchema.parse({ employeeCode: 'LOCAL-DEMO-' + role, fullName: 'Synthetic Local Demo ' + role,
      employment: { startDate: date, status: 'ACTIVE', reason },
      ...(role !== 'HR' ? { portalLogin: { email: account.email, password: account.password, role } } : {}),
    });
    const employee = await employees.createEmployee({ actorUserId: administrator.id, data });
    account.employeeId = employee.id;
    manifest.records.employees.push(employee.id); manifest.records.employment_episodes.push(employee.employment.id);
    if (employee.loginAccount) { account.id = employee.loginAccount.id; manifest.records.users.push(account.id); }
    save(file, manifest);
    if (role === 'HR') {
      // Public employee provisioning deliberately excludes elevated roles. This
      // CLI-only bootstrap follows the existing Admin actor/hash/audit rules;
      // it can link only the just-created, unlinked synthetic profile.
      const passwordHash = await hashPassword(account.password);
      account.id = await org.transaction(async tx => {
        const actor = await org.actor(tx, administrator.id);
        if (actor.role !== 'ADMIN') throw new Error('Only the existing Admin actor may bootstrap the synthetic HR account.');
        const profile = await tx.employee.findUnique({ where: { id: employee.id } });
        if (!profile || profile.userId || profile.employeeCode !== 'LOCAL-DEMO-HR' || profile.version !== 1) throw new Error('Synthetic HR linkage changed.');
        const user = await tx.user.create({ data: { email: account.email, displayName: data.fullName, passwordHash, role: 'HR', status: 'ACTIVE', mustChangePassword: false } });
        await tx.employee.update({ where: { id: employee.id }, data: { userId: user.id, version: { increment: 1 } } });
        await org.audit(tx, administrator.id, 'LOCAL_DEMO_HR_PROVISIONED', employee.id, { userId: user.id, role: 'HR' });
        return user.id;
      });
      manifest.records.users.push(account.id);
    } else {
      await org.transaction(async tx => {
        const actor = await org.actor(tx, administrator.id);
        const user = await tx.user.findUnique({ where: { id: account.id } });
        if (actor.role !== 'ADMIN' || !user || user.email !== account.email || user.role !== role || user.lastLoginAt) throw new Error('New synthetic account readiness check failed.');
        await tx.user.update({ where: { id: account.id }, data: { mustChangePassword: false } });
        await org.audit(tx, administrator.id, 'LOCAL_DEMO_ACCOUNT_READY', account.id, { role });
      });
    }
    save(file, manifest);
  }
  const units = {};
  for (const kind of ['DEPARTMENT', 'CAMPAIGN', 'DESIGNATION', 'TEAM']) {
    units[kind] = await org.createUnit(administrator.id, { kind, name: unitNames[kind], reason,
      ...(kind === 'TEAM' ? { departmentId: units.DEPARTMENT.id, campaignId: units.CAMPAIGN.id } : {}) });
    manifest.records.organization_units.push(units[kind].id); save(file, manifest);
  }
  const employeeAssignment = await org.assignEmployee(administrator.id, accounts.EMPLOYEE.employeeId, { teamId: units.TEAM.id, designationId: units.DESIGNATION.id, effectiveFrom: date, reason });
  manifest.records.organization_assignments.push(employeeAssignment.id); save(file, manifest);
  const managerAssignment = await org.assignManager(administrator.id, units.TEAM.id, { managerUserId: accounts.MANAGER.id, effectiveFrom: date, reason });
  manifest.records.team_manager_assignments.push(managerAssignment.id); save(file, manifest);
  manifest.records.employment_status_events = (await prisma.employmentStatusEvent.findMany({ where: { employmentEpisodeId: { in: manifest.records.employment_episodes } }, select: { id: true } })).map(row => row.id);
  const targets = Object.values(manifest.records).flat();
  manifest.records.audit_logs = (await prisma.auditLog.findMany({ where: { targetId: { in: targets }, actorUserId: administrator.id }, select: { id: true } })).map(row => row.id);
  manifest.complete = true; save(file, manifest);
  return { reused: false, manifest };
}

async function cleanupCheck({ prisma, databaseName, file }) {
  await assertConnectedDatabase(prisma, databaseName);
  const manifest = require('../src/services/local-demo.service').readManifest(file);
  if (manifest.databaseName !== databaseName) throw new Error('Cleanup target does not match registration.');
  for (const role of ROLES) await require('../src/services/local-demo.service').resolveDemoCredentials({ prisma, config: { databaseName, manifestPath: file }, role });
  // PostgreSQL's actual FK graph supplies dependency counts; no deletion,
  // cascading, history rewriting or automatic cleanup is performed.
  const dependencies = [];
  const relations = await prisma.$queryRaw`
    SELECT tc.table_name AS source_table, kcu.column_name AS source_column,
      ccu.table_name AS target_table FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
      AND ccu.table_name IN ('users','employees','employment_episodes','organization_units')`;
  for (const relation of relations) {
    const ids = manifest.records[relation.target_table];
    if (!ids?.length) continue;
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    const [row] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${quote(relation.source_table)} WHERE ${quote(relation.source_column)} = ANY($1::uuid[])`, ids);
    if (row.count) dependencies.push({ table: relation.source_table, column: relation.source_column, count: row.count });
  }
  return { destructiveCleanupAllowed: dependencies.length === 0, dependencies,
    action: 'Read-only check only. Disable flags and restart services. Keep the manifest. No history or accounts were deleted.' };
}

async function main() {
  require('dotenv/config'); require('dotenv').config({ path: path.join(__dirname, '../.env.local'), quiet: true });
  const config = require('../src/config/local-demo').readLocalDemoConfig();
  if (!config.enabled) throw new Error('Enable the explicit local-demo switch for setup/inspection.');
  const prisma = require('../src/config/prisma');
  try {
    const command = process.argv[2];
    if (command === 'setup') {
      const result = await setup({ prisma, databaseName: config.databaseName, file: config.manifestPath });
      console.log(JSON.stringify({ reused: result.reused, createdRecordCounts: Object.fromEntries(Object.entries(result.manifest.records).map(([name, ids]) => [name, ids.length])), manifest: config.manifestPath }, null, 2));
    } else if (command === 'cleanup-check') {
      console.log(JSON.stringify(await cleanupCheck({ prisma, databaseName: config.databaseName, file: config.manifestPath }), null, 2));
    } else throw new Error('Use setup or cleanup-check. No destructive cleanup command exists.');
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error('Local demo operation failed:', error.code || error.name); process.exitCode = 1; });
module.exports = { setup, cleanupCheck };
