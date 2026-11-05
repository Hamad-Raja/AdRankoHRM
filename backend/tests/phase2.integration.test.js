"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { createIsolatedDatabase, assertTestDatabase } = require('./isolated-db');

test('Phase 2 organization, access, accounts and private documents', { timeout: 120000 }, async t => {
  const db = await createIsolatedDatabase(); assertTestDatabase(db.url);
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'officehr-docs-'));
  process.env.DATABASE_URL = db.url; process.env.NODE_ENV = 'test'; process.env.DOCUMENT_STORAGE_DIR = storage;
  const prisma = require('../src/config/prisma'), app = require('../app');
  const sql = new Client({ connectionString: db.url }); await sql.connect();
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect(); await sql.end(); await fs.rm(storage, { recursive: true, force: true }); await db.cleanup();
    t.diagnostic('Temporary database/storage removed; original Admin snapshot unchanged.');
  });
  const base = `http://127.0.0.1:${server.address().port}/api`, origin = require('../src/config/auth').ALLOWED_ORIGINS[0];
  const password = 'Isolated-Phase2-123!', hash = await require('../src/utils/password').hashPassword(password);
  async function user(role) {
    const row = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, displayName: role, passwordHash: hash, role, mustChangePassword: false } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: row.email, password }) });
    assert.equal(response.status, 200); const data = await response.json();
    return { ...row, cookie: response.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), csrf: data.data.csrfToken };
  }
  const admin = await user('ADMIN'), hr = await user('HR'), manager = await user('MANAGER'), owner = await user('EMPLOYEE'), outsider = await user('EMPLOYEE');
  async function req(route, { method = 'GET', body, actor = admin, raw, type, csrf = true } = {}) {
    const response = await fetch(base + route, { method, headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}), ...(csrf && actor ? { 'x-csrf-token': actor.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(raw !== undefined ? { 'Content-Type': type || 'text/plain' } : {}) }, body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text(), headers: response.headers };
  }
  async function employee(code) {
    const r = await req('/employees', { method: 'POST', body: { employeeCode: code, fullName: code, personalEmail: 'secret@example.invalid', address: 'Private address', employment: { status: 'ACTIVE', startDate: '2020-01-01', reason: 'Private HR employment reason' } } });
    assert.equal(r.status, 201); return r.data.data.employee;
  }
  const employeeA = await employee('PHASE2-A'), employeeB = await employee('PHASE2-B'), employeeC = await employee('PHASE2-C');
  const why = 'Approved isolated organization fixture';
  async function unit(kind, name, extra = {}) {
    const r = await req('/organization', { method: 'POST', body: { kind, name, reason: why, ...extra } }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.data;
  }
  const department = await unit('DEPARTMENT', 'Engineering'), campaign = await unit('CAMPAIGN', 'Operations'), designation = await unit('DESIGNATION', 'Engineer');
  const team = await unit('TEAM', 'Platform', { departmentId: department.id, campaignId: campaign.id });
  const assignmentRoute = `/organization/employees/${employeeA.id}/assignments`;
  const assignment = { teamId: team.id, designationId: designation.id, effectiveFrom: '2020-01-01', reason: 'Private assignment reason' };
  const accountRoute = id => `/organization/employees/${id}/account`;
  const docsRoute = id => `/employee-files/${id}/documents`;
  let privateDoc, publicDoc;

  await t.test('organization references, strict validation, role restrictions and CSRF', async () => {
    assert.equal((await req('/organization', { actor: manager })).status, 403);
    assert.equal((await req('/organization', { actor: owner })).status, 403);
    assert.equal((await req('/organization', { method: 'POST', csrf: false, body: { kind: 'DEPARTMENT', name: 'X', reason: why } })).status, 403);
    assert.equal((await req('/organization', { method: 'POST', body: { kind: 'TEAM', name: 'Invalid', reason: why, departmentId: campaign.id, campaignId: campaign.id } })).status, 400);
    assert.equal((await req(assignmentRoute, { method: 'POST', body: { ...assignment, effectiveFrom: '2026-02-30' } })).status, 400);
    assert.equal((await req(assignmentRoute, { method: 'POST', body: { ...assignment, effectiveTo: '2019-01-01' } })).status, 400);
    assert.equal((await req(assignmentRoute, { method: 'POST', body: { ...assignment, designationId: team.id } })).status, 400);
  });
  await t.test('effective replacements preserve reason/actor and close old dates; database excludes overlaps', async () => {
    assert.equal((await req(assignmentRoute, { method: 'POST', body: assignment })).status, 201);
    assert.equal((await req(assignmentRoute, { method: 'POST', body: { ...assignment, effectiveFrom: '2021-01-01' } })).status, 201);
    const rows = await prisma.organizationAssignment.findMany({ where: { employeeId: employeeA.id }, orderBy: { effectiveFrom: 'asc' } });
    assert.equal(rows.length, 2); assert.equal(rows[0].effectiveTo.toISOString().slice(0, 10), '2020-12-31'); assert.equal(rows[0].reason, assignment.reason); assert.equal(rows[0].actorUserId, admin.id);
    await assert.rejects(sql.query('INSERT INTO organization_assignments(id,"employeeId","teamId","designationId","effectiveFrom","effectiveTo","actorUserId",reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), employeeA.id, team.id, designation.id, '2020-06-01', '2020-07-01', admin.id, why]), e => e.code === '23P01');
    assert.equal((await req(assignmentRoute, { method: 'POST', body: assignment })).status, 409);
  });
  await t.test('competing assignment writes cannot create overlapping single assignments', async () => {
    const results = await Promise.all([1, 2].map(() => req(`/organization/employees/${employeeB.id}/assignments`, { method: 'POST', body: assignment })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.organizationAssignment.count({ where: { employeeId: employeeB.id } }), 1);
    const route = `/organization/employees/${employeeC.id}/assignments`;
    assert.equal((await req(route, { method: 'POST', body: { ...assignment, effectiveTo: '2021-01-01' } })).status, 201);
    assert.equal((await req(route, { method: 'POST', body: { ...assignment, effectiveFrom: '2020-06-01', effectiveTo: '2020-07-01' } })).status, 409);
  });
  await t.test('HR provisions only ordinary employees; elevated accounts and one-to-one links are protected', async () => {
    const adminBefore = await prisma.user.findUnique({ where: { id: admin.id } });
    assert.equal((await req(accountRoute(employeeC.id), { method: 'POST', actor: hr, body: { mode: 'provision', email: 'denied@example.invalid', role: 'MANAGER', password } })).status, 403);
    assert.equal((await req(accountRoute(employeeC.id), { method: 'POST', actor: hr, body: { mode: 'link', email: manager.email } })).status, 403);
    assert.equal((await req(accountRoute(employeeC.id), { method: 'POST', body: { mode: 'link', email: admin.email } })).status, 400);
    assert.equal((await req(accountRoute(employeeA.id), { method: 'POST', actor: hr, body: { mode: 'link', email: owner.email } })).status, 201);
    assert.equal((await req(accountRoute(employeeB.id), { method: 'POST', body: { mode: 'link', email: owner.email } })).status, 409);
    const created = await req(accountRoute(employeeC.id), { method: 'POST', actor: hr, body: { mode: 'provision', email: 'new-employee@example.invalid', role: 'EMPLOYEE', password } });
    assert.equal(created.status, 201); assert.equal(created.data.data.mustChangePassword, true); assert.equal(created.data.data.passwordHash, undefined);
    const account = await prisma.user.findUnique({ where: { id: created.data.data.userId } });
    assert.equal(await require('../src/utils/password').verifyPassword(password, account.passwordHash), true);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: admin.id } }), adminBefore);
    assert.equal((await prisma.employee.findUnique({ where: { id: employeeA.id } })).personalEmail, 'secret@example.invalid');
  });
  await t.test('manager dates and team scope; employee own record; no private values/reasons/actors', async () => {
    const route = `/organization/teams/${team.id}/managers`;
    assert.equal((await req(route, { method: 'POST', body: { managerUserId: owner.id, effectiveFrom: '2020-01-01', reason: why } })).status, 400);
    assert.equal((await req(route, { method: 'POST', body: { managerUserId: manager.id, effectiveFrom: '2020-01-01', reason: why } })).status, 201);
    assert.equal((await req(route, { method: 'POST', body: { managerUserId: manager.id, effectiveFrom: '2020-01-01', reason: why } })).status, 409);
    const scoped = await req('/organization/scope/employees', { actor: manager }); assert.equal(scoped.status, 200); assert.equal(scoped.data.data.length, 2);
    const json = JSON.stringify(scoped.data); for (const forbidden of ['Private', 'secret@', 'actorUserId', 'reason', 'personalEmail', 'userId', 'passwordHash']) assert.equal(json.includes(forbidden), false, forbidden);
    const own = await req('/organization/scope/employees', { actor: owner }); assert.equal(own.data.data.length, 1); assert.equal(own.data.data[0].id, employeeA.id);
    assert.equal((await req(`/organization/scope/employees/${employeeB.id}`, { actor: owner })).status, 404);
    assert.equal((await req(`/organization/scope/employees/${employeeC.id}`, { actor: manager })).status, 404);
    assert.equal((await req(`/organization/employees/${employeeA.id}/history`, { actor: manager })).status, 403);
    const history = await req(`/organization/employees/${employeeA.id}/history`, { actor: owner }); assert.equal(history.status, 200); assert.equal(JSON.stringify(history.data).includes('reason'), false);
    assert.equal((await req(`/organization/employees/${employeeB.id}/history`, { actor: owner })).status, 404);
  });
  await t.test('future and expired manager intervals do not grant present access', async () => {
    await prisma.teamManagerAssignment.updateMany({ where: { managerUserId: manager.id }, data: { effectiveTo: new Date('2021-01-01') } });
    assert.equal((await req('/organization/scope/employees', { actor: manager })).data.data.length, 0);
    await prisma.teamManagerAssignment.updateMany({ where: { managerUserId: manager.id }, data: { effectiveTo: null, effectiveFrom: new Date('2090-01-01') } });
    assert.equal((await req('/organization/scope/employees', { actor: manager })).data.data.length, 0);
    await prisma.teamManagerAssignment.updateMany({ where: { managerUserId: manager.id }, data: { effectiveFrom: new Date('2020-01-01') } });
  });
  await t.test('archiving preserves history and rejects new references including archived parents', async () => {
    assert.equal((await req(`/organization/${department.id}/archive`, { method: 'POST', body: { reason: why } })).status, 200);
    assert.equal((await req(assignmentRoute, { method: 'POST', body: { ...assignment, effectiveFrom: '2022-01-01' } })).status, 400);
    assert.equal((await req(`/organization/employees/${employeeA.id}/history`)).data.data.assignments.length, 2);
    assert.equal((await req('/organization', { method: 'POST', body: { kind: 'TEAM', name: 'Archived parent', departmentId: department.id, campaignId: campaign.id, reason: why } })).status, 400);
  });
  await t.test('document content/type/size/metadata validation and denied writes leave storage empty', async () => {
    const route = docsRoute(employeeA.id) + '?title=Private&ownerVisible=false';
    for (const input of [{ raw: 'not png', type: 'image/png' }, { raw: Buffer.from([0xff]), type: 'text/plain' }, { raw: 'abc', type: 'application/pdf' }, { raw: '' }]) assert.ok([400, 415].includes((await req(route, { method: 'POST', ...input })).status));
    assert.equal((await req(route, { method: 'POST', raw: 'x'.repeat(5242881) })).status, 413);
    assert.equal((await req(route, { method: 'POST', raw: 'Valid', actor: manager })).status, 403);
    assert.equal((await req(route, { method: 'POST', raw: 'Valid', actor: owner })).status, 403);
    assert.equal((await req(route, { method: 'POST', raw: 'Valid', csrf: false })).status, 403);
    assert.equal((await req(docsRoute(employeeA.id) + '?title=Valid&ownerVisible=false&path=../../secret', { method: 'POST', raw: 'Valid' })).status, 400);
    assert.deepEqual(await fs.readdir(storage), []);
  });
  await t.test('private downloads are authorized, non-cacheable, attached, audited and have immutable replacements', async () => {
    privateDoc = await req(docsRoute(employeeA.id) + '?title=Confidential&ownerVisible=false', { method: 'POST', raw: 'Private original' }); assert.equal(privateDoc.status, 201); privateDoc = privateDoc.data.data;
    publicDoc = await req(docsRoute(employeeA.id) + `?title=Visible&ownerVisible=true&replacesId=${privateDoc.id}`, { method: 'POST', raw: 'Visible replacement' }); assert.equal(publicDoc.status, 201); publicDoc = publicDoc.data.data;
    assert.equal((await req(docsRoute(employeeA.id))).data.data.length, 2);
    const visible = await req(docsRoute(employeeA.id), { actor: owner }); assert.equal(visible.data.data.length, 1); assert.equal(visible.data.data[0].replacesId, null);
    const download = id => docsRoute(employeeA.id) + `/${id}/download`;
    assert.equal((await req(download(privateDoc.id), { actor: owner })).status, 404);
    assert.equal((await req(download(publicDoc.id), { actor: outsider })).status, 403);
    assert.equal((await req(download(publicDoc.id), { actor: manager })).status, 403);
    const r = await req(download(publicDoc.id), { actor: owner }); assert.equal(r.status, 200); assert.equal(r.data, 'Visible replacement'); assert.match(r.headers.get('content-disposition'), /^attachment; filename="document-/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await req(download(privateDoc.id))).data, 'Private original');
    assert.equal((await req(docsRoute(employeeA.id) + `?title=Duplicate&ownerVisible=false&replacesId=${privateDoc.id}`, { method: 'POST', raw: 'Another replacement' })).status, 409);
    assert.equal((await fs.readdir(storage)).length, 2);
    assert.ok(await prisma.auditLog.count({ where: { action: 'EMPLOYEE_DOCUMENT_DOWNLOAD_REQUESTED' } }));
  });
  await t.test('failed audit rolls back document metadata and cleans staged bytes', async () => {
    const before = await fs.readdir(storage), count = await prisma.employeeDocument.count();
    await sql.query("ALTER TABLE audit_logs ADD CONSTRAINT phase2_document_audit_failure CHECK (action <> 'EMPLOYEE_DOCUMENT_UPLOADED') NOT VALID");
    try { assert.equal((await req(docsRoute(employeeA.id) + '?title=Rollback&ownerVisible=false', { method: 'POST', raw: 'Must be cleaned' })).status, 500); }
    finally { await sql.query('ALTER TABLE audit_logs DROP CONSTRAINT phase2_document_audit_failure'); }
    assert.equal(await prisma.employeeDocument.count(), count); assert.deepEqual(await fs.readdir(storage), before);
    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: 'EMPLOYEE_DOCUMENT' } } });
    for (const row of audits) { const json = JSON.stringify(row.metadata); assert.equal(json.includes('Private original'), false); assert.equal(json.includes('Visible replacement'), false); }
  });
  await t.test('actual PNG pixels/checksums are validated; corrupt files and failed transfers remain safe', async () => {
    const { deflateSync } = require('node:zlib');
    function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
    function chunk(type, bytes) { const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length); b.write(type, 4); bytes.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; }
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 0, 255, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
    const route = docsRoute(employeeA.id) + '?title=Validated-PNG&ownerVisible=false';
    const good = await req(route, { method: 'POST', type: 'image/png', raw: png }); assert.equal(good.status, 201);
    const corrupt = Buffer.from(png); corrupt[40] ^= 0xff;
    assert.equal((await req(route, { method: 'POST', type: 'image/png', raw: corrupt })).status, 400);
    assert.equal((await req(route, { method: 'POST', type: 'image/png', raw: Buffer.concat([png, Buffer.from('trailing')]) })).status, 400);
    const row = await prisma.employeeDocument.findUnique({ where: { id: good.data.data.id } });
    await fs.truncate(path.join(storage, row.storageName), 1);
    assert.equal((await req(docsRoute(employeeA.id) + `/${row.id}/download`)).status, 500);
    assert.equal((await req('/health')).status, 200);
    const large = await req(docsRoute(employeeA.id) + '?title=Transfer&ownerVisible=false', { method: 'POST', raw: 'x'.repeat(1024 * 1024) });
    assert.equal(large.status, 201);
    const controller = new AbortController();
    const response = await fetch(base + docsRoute(employeeA.id) + `/${large.data.data.id}/download`, { signal: controller.signal, headers: { Cookie: admin.cookie, Origin: origin } });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
    assert.equal((await req('/health')).status, 200);
  });
});
