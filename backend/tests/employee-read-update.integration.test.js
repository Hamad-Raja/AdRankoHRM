"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { createIsolatedDatabase, assertTestDatabase } = require("./isolated-db");

test("Employee list, detail and profile updates in an isolated database", { timeout: 120000 }, async t => {
  const database = await createIsolatedDatabase();
  const previousUrl = process.env.DATABASE_URL;
  const previousMode = process.env.NODE_ENV;
  let prisma, sql, server;
  t.after(async () => {
    const failures = [];
    for (const cleanup of [
      async () => {
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
      },
      () => prisma?.$disconnect(), () => sql?.end(), () => database.cleanup(),
    ]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    for (const [key, value] of [["DATABASE_URL", previousUrl], ["NODE_ENV", previousMode]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (failures.length) throw new AggregateError(failures, "Employee read/update cleanup failed.");
    t.diagnostic("Temporary employee read/update database removed; original Admin snapshot unchanged.");
  });
  assertTestDatabase(database.url);
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = "test";
  prisma = require("../src/config/prisma");
  const app = require("../app");
  const { hashPassword } = require("../src/utils/password");
  const { ALLOWED_ORIGINS } = require("../src/config/auth");
  sql = new Client({ connectionString: database.url });
  await sql.connect();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const password = "Read-update-fixture!123";
  const passwordHash = await hashPassword(password);
  let sequence = 0;
  async function request(route, { method = "GET", body, session, csrf = true, headers = {} } = {}) {
    const response = await fetch(base + route, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: {
        Origin: ALLOWED_ORIGINS[0],
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Cookie: session.cookie } : {}),
        ...(session && csrf ? { "x-csrf-token": session.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, data: await response.json() };
  }
  async function account(role, overrides = {}) {
    const user = await prisma.user.create({ data: {
      email: `employee-read-fixture-${++sequence}@example.invalid`,
      displayName: "Employee Read/Update Test Fixture", passwordHash,
      role, mustChangePassword: false, ...overrides,
    } });
    const response = await fetch(base + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGINS[0] },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    return { user, session: {
      csrf: data.data.csrfToken,
      cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "),
    } };
  }
  const admin = await account("ADMIN");
  const hr = await account("HR");
  const manager = await account("MANAGER");
  const employeeUser = await account("EMPLOYEE");
  async function fixture(fullName = "Phase 2 Read Fixture", overrides = {}) {
    const result = await request("/employees", { method: "POST", session: admin.session, body: {
      employeeCode: `READ-${++sequence}`, fullName,
      personalEmail: "private-fixture@example.invalid", phone: "+92 300 1234567",
      address: "Isolated private test address", emergencyContactName: "Private Test Contact",
      emergencyContactPhone: "+92 300 7654321", emergencyContactRelationship: "Sibling",
      employment: { startDate: "2020-01-01", status: "ACTIVE", reason: "Isolated read/update fixture" },
      ...overrides,
    } });
    assert.equal(result.status, 201);
    return result.data.data.employee;
  }
  const alpha = await fixture("Phase 2 Read Fixture Alpha");
  const alphaTwin = await fixture("Phase 2 Read Fixture Alpha");
  const beta = await fixture("Phase 2 Read Fixture Beta", {
    employment: { startDate: "2020-02-29", status: "PROBATION", probationEndDate: "2020-05-31", reason: "Isolated leap-day fixture" },
  });
  const percent = await fixture("Literal Fixture % marker");
  const underscore = await fixture("Literal Fixture _ marker", { employeeCode: "READ_UNDERSCORE" });
  const backslash = await fixture("Literal Fixture \\ marker");
  const rehire = await fixture("Phase 2 Read Fixture Rehired");
  const exited = await fixture("Phase 2 Read Fixture Exited");
  for (const profile of [rehire, exited]) {
    await prisma.employmentEpisode.update({ where: { id: profile.employment.id }, data: {
      status: "EXITED", endDate: new Date("2020-12-31T00:00:00Z"), statusEffectiveDate: new Date("2020-12-31T00:00:00Z"),
    } });
  }
  const latestEpisode = await prisma.employmentEpisode.create({ data: {
    employeeId: rehire.id, startDate: new Date("2025-01-01T00:00:00Z"), status: "ACTIVE",
    statusEffectiveDate: new Date("2025-01-01T00:00:00Z"),
    // Older insertion timestamp proves reads select by employment start date.
    createdAt: new Date("2000-01-01T00:00:00Z"),
    statusEvents: { create: { actorUserId: admin.user.id, fromStatus: null, toStatus: "ACTIVE",
      effectiveDate: new Date("2025-01-01T00:00:00Z"), reason: "Isolated rehire history fixture" } },
  } });
  await prisma.employee.update({ where: { id: rehire.id }, data: { userId: employeeUser.user.id } });

  const get = (id, session = admin.session) => request(`/employees/${id}`, { session });
  const list = (query = "", session = admin.session) => request("/employees" + query, { session });
  const patch = (id, body, options = {}) => request(`/employees/${id}`, {
    method: "PATCH", session: admin.session, body, ...options,
  });
  const history = async id => ({
    episodes: await prisma.employmentEpisode.findMany({ where: { employeeId: id }, orderBy: { id: "asc" } }),
    events: await prisma.employmentStatusEvent.findMany({ where: { employmentEpisode: { employeeId: id } }, orderBy: { id: "asc" } }),
  });
  const updateAudits = id => prisma.auditLog.findMany({ where: { targetId: id, action: "EMPLOYEE_PROFILE_UPDATED" }, orderBy: { createdAt: "asc" } });

  await t.test("Admin and HR list/detail have compatible envelopes, date-only dates and no cached responses", async () => {
    for (const actor of [admin, hr]) {
      const result = await list("?page=1&pageSize=100", actor.session);
      assert.equal(result.status, 200); assert.equal(result.data.success, true);
      assert.equal(result.data.data.pagination.total, 8);
      const detail = await get(beta.id, actor.session);
      assert.equal(detail.status, 200);
      assert.equal(detail.data.data.employee.employment.startDate, "2020-02-29");
      assert.equal(detail.data.data.employee.employment.probationEndDate, "2020-05-31");
      assert.equal(detail.data.data.employee.personalEmail, "private-fixture@example.invalid");
      assert.doesNotMatch(JSON.stringify(detail.data), /passwordHash|csrfToken|tokenHash|sessions/);
    }
  });
  await t.test("list summaries omit contacts, account linkage and profile version", async () => {
    const result = await list("?pageSize=100");
    for (const employee of result.data.data.employees) {
      assert.deepEqual(Object.keys(employee).sort(), ["employeeCode", "employment", "fullName", "id"]);
    }
  });
  await t.test("unauthenticated and Manager/Employee requests cannot list, read or update", async () => {
    const before = await prisma.employee.findUnique({ where: { id: alpha.id } });
    for (const [session, status] of [[null, 401], [manager.session, 403], [employeeUser.session, 403]]) {
      assert.equal((await list("", session)).status, status);
      assert.equal((await get(alpha.id, session)).status, status);
      assert.equal((await patch(alpha.id, { version: 1, fullName: "Forbidden fixture" }, { session })).status, status);
    }
    assert.deepEqual(await prisma.employee.findUnique({ where: { id: alpha.id } }), before);
  });
  await t.test("pagination is bounded, deterministic and uses fullName then id for ties", async () => {
    const first = (await list("?page=1&pageSize=2")).data.data;
    const again = (await list("?page=1&pageSize=2")).data.data;
    assert.deepEqual(first, again);
    const all = (await list("?pageSize=100")).data.data;
    const pages = [];
    for (let page = 1; page <= 4; page++) pages.push(...(await list(`?page=${page}&pageSize=2`)).data.data.employees);
    assert.deepEqual(pages, all.employees);
    assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 8, totalPages: 4 });
    const twins = all.employees.filter(profile => [alpha.id, alphaTwin.id].includes(profile.id));
    assert.deepEqual(twins.map(profile => profile.id), [alpha.id, alphaTwin.id].sort());
    assert.equal((await list("?page=10000&pageSize=100")).data.data.employees.length, 0);
  });
  await t.test("case-insensitive code/name search and literal percent, underscore and backslash", async () => {
    const code = (await list("?q=" + encodeURIComponent(beta.employeeCode.toLowerCase()))).data.data;
    assert.equal(code.pagination.total, 1); assert.equal(code.employees[0].id, beta.id);
    const name = (await list("?q=read%20fixture%20aLpHa")).data.data;
    assert.equal(name.pagination.total, 2);
    for (const [q, id] of [["%", percent.id], ["_", underscore.id], ["\\", backslash.id]]) {
      const found = (await list("?q=" + encodeURIComponent(q))).data.data;
      assert.equal(found.pagination.total, 1, "Search must treat " + q + " literally");
      assert.equal(found.employees[0].id, id);
    }
  });
  await t.test("status filtering ignores old exits after rehire and latest selection uses startDate", async () => {
    const statusFixtures = {};
    for (const status of ["SUSPENDED", "NOTICE_PERIOD"]) {
      const profile = await fixture(`Status ${status} Fixture`);
      await prisma.employmentEpisode.update({ where: { id: profile.employment.id }, data: { status } });
      statusFixtures[status] = profile.id;
    }
    for (const status of ["ACTIVE", "PROBATION", "EXITED", "SUSPENDED", "NOTICE_PERIOD"]) {
      const found = (await list("?status=" + status)).data.data;
      for (const employee of found.employees) assert.equal(employee.employment.status, status);
      if (status === "EXITED") assert.deepEqual(found.employees.map(profile => profile.id), [exited.id]);
      if (status === "ACTIVE") assert.ok(found.employees.some(profile => profile.id === rehire.id));
      if (status === "PROBATION") assert.deepEqual(found.employees.map(profile => profile.id), [beta.id]);
      if (statusFixtures[status]) assert.deepEqual(found.employees.map(profile => profile.id), [statusFixtures[status]]);
    }
    const current = (await get(rehire.id)).data.data.employee;
    assert.equal(current.employment.id, latestEpisode.id);
    assert.equal(current.employment.startDate, "2025-01-01");
    assert.equal(current.userId, employeeUser.user.id);
    const combined = (await list("?q=rehired&status=EXITED")).data.data;
    assert.equal(combined.pagination.total, 0);
  });
  await t.test("empty results, malformed queries, invalid IDs and missing employees", async () => {
    const empty = (await list("?q=" + randomUUID())).data.data;
    assert.deepEqual(empty, { employees: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=10001", "?pageSize=101", "?pageSize=0", "?pageSize=x", "?page=1&page=2", "?status=DISABLED", "?userId=x", "?q=%00", "?q=" + "x".repeat(121)]) {
      const result = await list(query);
      assert.equal(result.status, 400, "Invalid query: " + query);
      assert.equal(result.data.code, "VALIDATION_ERROR");
    }
    assert.equal((await get("bad-id")).status, 400);
    assert.equal((await patch("bad-id", { version: 1, fullName: "Valid fixture" })).status, 400);
    const missing = randomUUID();
    assert.equal((await get(missing)).data.code, "EMPLOYEE_NOT_FOUND");
    const missingPatch = await patch(missing, { version: 1, fullName: "Missing fixture" });
    assert.equal(missingPatch.status, 404); assert.equal(missingPatch.data.code, "EMPLOYEE_NOT_FOUND");
  });
  await t.test("list count and rows share a repeatable-read snapshot during an actual concurrent insert", async () => {
    await fixture("Snapshot Fixture A");
    const originalMethod = prisma.$transaction;
    const originalTransaction = originalMethod.bind(prisma);
    let inserted = false;
    // Prisma exposes this method through a dynamic proxy, which Node's
    // descriptor-based mock.method cannot intercept. Restore it explicitly.
    prisma.$transaction = (callback, options) => originalTransaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key !== "employee") return Reflect.get(target, key);
        const model = target.employee;
        return new Proxy(model, { get(delegate, method) {
          if (method === "count") return async args => {
            const count = await delegate.count(args);
            // Commit a separate real write exactly between count and row read.
            if (!inserted) {
              inserted = true;
              await prisma.employee.create({ data: { employeeCode: "SNAPSHOT-SECOND", fullName: "Snapshot Fixture B" } });
            }
            return count;
          };
          const value = Reflect.get(delegate, method);
          return typeof value === "function" ? value.bind(delegate) : value;
        } });
      } });
      return callback(wrapped);
    }, options);
    try {
      const response = await list("?q=Snapshot%20Fixture");
      assert.equal(response.status, 200);
      assert.equal(response.data.data.pagination.total, 1);
      assert.equal(response.data.data.employees.length, 1);
      assert.ok(inserted);
    } finally { prisma.$transaction = originalMethod; }
    assert.equal((await list("?q=Snapshot%20Fixture")).data.data.pagination.total, 2);
  });
  await t.test("Admin/HR partial updates normalize fields, preserve omitted values and match detail shape", async () => {
    const profile = await fixture("Profile Update Fixture");
    for (const actor of [admin, hr]) {
      const before = (await get(profile.id)).data.data.employee;
      const result = await patch(profile.id, {
        version: before.version, fullName: `  Updated ${actor.user.role} Fixture  `,
        personalEmail: "  UPDATED.FIXTURE@EXAMPLE.INVALID  ",
      }, { session: actor.session });
      assert.equal(result.status, 200);
      const updated = result.data.data.employee;
      assert.equal(updated.version, before.version + 1);
      assert.equal(updated.fullName, `Updated ${actor.user.role} Fixture`);
      assert.equal(updated.personalEmail, "updated.fixture@example.invalid");
      for (const field of ["phone", "address", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employeeCode", "userId", "createdAt", "employment"]) {
        assert.deepEqual(updated[field], before[field]);
      }
      assert.deepEqual(updated, (await get(profile.id)).data.data.employee);
    }
  });
  await t.test("explicit null/blank clears all nullable fields while omitted fields remain unchanged", async () => {
    const profile = await fixture("Nullable Update Fixture");
    const result = await patch(profile.id, {
      version: 1, personalEmail: null, phone: "  ", address: null,
      emergencyContactName: "", emergencyContactPhone: null, emergencyContactRelationship: null,
    });
    assert.equal(result.status, 200);
    const updated = result.data.data.employee;
    for (const field of ["personalEmail", "phone", "address", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship"]) assert.equal(updated[field], null);
    assert.equal(updated.fullName, profile.fullName);
    assert.equal(updated.version, 2);
  });
  await t.test("PATCH rejects missing/invalid versions, empty updates and every protected field", async () => {
    const profile = await fixture("Validation Update Fixture");
    const before = await prisma.employee.findUnique({ where: { id: profile.id } });
    const invalid = [{}, { version: 1 }, { fullName: "No version" },
      ...[0, -1, 1.5, "1", null, 2147483648].map(version => ({ version, fullName: "Invalid version fixture" })),
      { version: 1, fullName: null }, { version: 1, fullName: " " }, { version: 1, fullName: "x".repeat(121) },
      { version: 1, fullName: "Invalid\u0000Name" }, { version: 1, personalEmail: "invalid" },
      { version: 1, phone: 123 }, { version: 1, phone: "letters" }, { version: 1, address: {} },
      ...["employeeCode", "userId", "role", "status", "employment", "id", "createdAt", "updatedAt", "employmentEpisodes", "startDate", "endDate", "passwordHash"].map(field => ({ version: 1, fullName: "Protected fixture", [field]: "forbidden" })),
      JSON.parse('{"version":1,"fullName":"Prototype fixture","__proto__":{}}'),
    ];
    for (const [index, body] of invalid.entries()) {
      const response = await patch(profile.id, body);
      assert.equal(response.status, 400, "Invalid patch case " + index);
      assert.equal(response.data.code, "VALIDATION_ERROR");
    }
    assert.deepEqual(await prisma.employee.findUnique({ where: { id: profile.id } }), before);
    assert.equal((await updateAudits(profile.id)).length, 0);
  });
  await t.test("PATCH requires valid CSRF and trusted origin", async () => {
    const body = { version: 1, fullName: "CSRF fixture" };
    for (const options of [{ csrf: false }, { headers: { "x-csrf-token": "0".repeat(64) } }, { headers: { Origin: "https://untrusted.example" } }]) {
      assert.equal((await patch(alpha.id, body, options)).status, 403);
    }
    assert.equal((await get(alpha.id)).data.data.employee.version, 1);
  });
  await t.test("stale updates and competing requests return conflicts without losing the winning write", async () => {
    const profile = await fixture("Concurrent Update Fixture");
    const responses = await Promise.all([
      patch(profile.id, { version: 1, fullName: "Concurrent Winner A Fixture" }),
      patch(profile.id, { version: 1, fullName: "Concurrent Winner B Fixture" }),
    ]);
    assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
    const winner = responses.find(result => result.status === 200).data.data.employee;
    const conflict = responses.find(result => result.status === 409);
    assert.equal(conflict.data.code, "EMPLOYEE_VERSION_CONFLICT");
    assert.equal(winner.version, 2);
    assert.deepEqual((await get(profile.id)).data.data.employee, winner);
    const stale = await patch(profile.id, { version: 1, phone: "+92 111 1111111" });
    assert.equal(stale.status, 409);
    assert.equal((await updateAudits(profile.id)).length, 1);
  });
  await t.test("profile update and audit roll back together when audit insertion fails", async () => {
    const profile = await fixture("Audit Rollback Fixture");
    const before = await prisma.employee.findUnique({ where: { id: profile.id } });
    const historyBefore = await history(profile.id);
    await sql.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "employee_test_reject_profile_audit" CHECK ("action" <> 'EMPLOYEE_PROFILE_UPDATED') NOT VALID`);
    try {
      const failed = await patch(profile.id, { version: 1, fullName: "Must Roll Back Fixture", personalEmail: "rollback@example.invalid" });
      assert.equal(failed.status, 500);
      assert.equal(failed.data.message, "Internal server error.");
      assert.deepEqual(await prisma.employee.findUnique({ where: { id: profile.id } }), before);
      assert.deepEqual(await history(profile.id), historyBefore);
      assert.equal((await updateAudits(profile.id)).length, 0);
    } finally {
      await sql.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "employee_test_reject_profile_audit"`);
    }
  });
  await t.test("profile audit contains only changed field names/versions; employee identity and full history stay intact", async () => {
    const before = (await get(rehire.id)).data.data.employee;
    const historyBefore = await history(rehire.id);
    const updated = await patch(rehire.id, { version: before.version, address: "  Updated private fixture address  ", phone: "+92 222 2222222", fullName: before.fullName });
    assert.equal(updated.status, 200);
    const profile = updated.data.data.employee;
    assert.equal(profile.employeeCode, before.employeeCode);
    assert.equal(profile.userId, before.userId);
    assert.deepEqual(profile.employment, before.employment);
    assert.deepEqual(await history(rehire.id), historyBefore);
    const audits = await updateAudits(rehire.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, admin.user.id);
    assert.equal(audits[0].success, true);
    assert.deepEqual(audits[0].metadata, { changedFields: ["phone", "address"], previousVersion: 1, version: 2 });
    assert.doesNotMatch(JSON.stringify(audits[0].metadata), /Updated private|2222222|private-fixture/);
  });
  await t.test("same-value edits still advance the version without inventing changed audit fields", async () => {
    const profile = await fixture("Same Value Update Fixture");
    const result = await patch(profile.id, { version: 1, fullName: profile.fullName });
    assert.equal(result.status, 200);
    assert.equal(result.data.data.employee.version, 2);
    assert.deepEqual((await updateAudits(profile.id))[0].metadata, { changedFields: [], previousVersion: 1, version: 2 });
  });
  await t.test("the maximum PostgreSQL integer version cannot overflow on update", async () => {
    const profile = await fixture("Version Limit Fixture");
    await prisma.employee.update({ where: { id: profile.id }, data: { version: 2147483647 } });
    const result = await patch(profile.id, { version: 2147483647, fullName: "Overflow Fixture" });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, "EMPLOYEE_VERSION_EXHAUSTED");
    assert.equal((await get(profile.id)).data.data.employee.version, 2147483647);
    assert.equal((await updateAudits(profile.id)).length, 0);
  });
  await t.test("forced password change, disabled accounts and changed roles block read and update", async () => {
    const forced = await account("ADMIN", { mustChangePassword: true });
    const disabled = await account("ADMIN");
    const demoted = await account("HR");
    await prisma.user.update({ where: { id: disabled.user.id }, data: { status: "DISABLED" } });
    await prisma.user.update({ where: { id: demoted.user.id }, data: { role: "MANAGER" } });
    for (const [actor, status] of [[forced, 403], [disabled, 401], [demoted, 403]]) {
      assert.equal((await list("", actor.session)).status, status);
      assert.equal((await get(alpha.id, actor.session)).status, status);
      assert.equal((await patch(alpha.id, { version: 1, fullName: "Forbidden fixture" }, { session: actor.session })).status, status);
    }
  });
});
