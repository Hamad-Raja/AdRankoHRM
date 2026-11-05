const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createIsolatedDatabase, assertTestDatabase } = require("./isolated-db");

test("Phase 1 authentication against a disposable PostgreSQL database", { timeout: 120000 }, async t => {
  const database = await createIsolatedDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = "test";
  assertTestDatabase(process.env.DATABASE_URL);
  const prisma = require("../src/config/prisma");
  const app = require("../app");
  const authenticate = require("../src/middleware/authenticate");
  const { hashPassword, verifyPassword } = require("../src/utils/password");
  const { hashToken, generateToken } = require("../src/utils/token");
  const { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, ALLOWED_ORIGINS } = require("../src/config/auth");
  const { loginLimiter, passwordChangeLimiter } = require("../src/middleware/rateLimit");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const password = "Phase1-fixture!123";
  const passwordHash = await hashPassword(password);
  let fixtureNumber = 0;
  const fixture = overrides => prisma.user.create({ data: {
    email: `phase1-fixture-${++fixtureNumber}@example.invalid`, displayName: "Phase 1 Test Fixture",
    passwordHash, role: "EMPLOYEE", mustChangePassword: false, ...overrides,
  } });
  async function request(path, { method = "GET", body, session, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method, headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Cookie: session.cookie } : {}), ...headers,
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { response, data };
  }
  async function login(user, suppliedPassword = password) {
    const result = await request("/auth/login", { method: "POST", body: { email: user.email, password: suppliedPassword } });
    const cookies = result.response.headers.getSetCookie();
    return { ...result, cookie: cookies.map(cookie => cookie.split(";")[0]).join("; "), cookies, csrf: result.data.data?.csrfToken };
  }
  const authenticated = async user => {
    const session = await login(user);
    assert.equal(session.response.status, 200);
    return session;
  };
  const rowFor = session => prisma.userSession.findUnique({ where: { tokenHash: hashToken(session.cookie.match(new RegExp(SESSION_COOKIE_NAME + "=([a-f0-9]+)"))[1]) } });
  try {
    await t.test("login, refresh, cookie flags, hash-only storage, public response and no caching", async () => {
      const user = await fixture({ role: "ADMIN" });
      const session = await authenticated(user);
      assert.equal(session.cookies.length, 2);
      for (const cookie of session.cookies) {
        assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i);
        assert.doesNotMatch(cookie, /; Secure/i); assert.match(cookie, /Expires=/i);
      }
      const row = await rowFor(session);
      const raw = session.cookie.match(new RegExp(SESSION_COOKIE_NAME + "=([a-f0-9]+)"))[1];
      assert.notEqual(row.tokenHash, raw);
      assert.equal(row.csrfTokenHash, hashToken(session.csrf));
      assert.ok(Math.abs(row.expiresAt - row.createdAt - 12 * 3600000) < 2000);
      assert.deepEqual(Object.keys(session.data.data).sort(), ["csrfToken", "expiresAt", "user"]);
      assert.deepEqual(Object.keys(session.data.data.user).sort(), ["displayName", "email", "id", "mustChangePassword", "role", "status"]);
      const restored = await request("/auth/me", { session });
      assert.equal(restored.response.status, 200);
      assert.equal(restored.data.data.user.id, user.id);
      assert.equal(restored.data.data.csrfToken, session.csrf);
    });
    await t.test("validation rejects malformed bodies, unknown fields, oversized and invalid JSON", async () => {
      for (const body of [{}, { email: "no-email", password: "x" }, { email: "a@example.com", password: "a".repeat(73) }, { email: "a@example.com", password, role: "ADMIN" }]) {
        assert.equal((await request("/auth/login", { method: "POST", body })).response.status, 400);
      }
      for (const [body, expected] of [["{", 400], ["x".repeat(110000), 413]]) {
        const response = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store");
      }
    });
    await t.test("generic login errors, five-attempt lockout, unlock, disabled and missing accounts", async () => {
      const user = await fixture();
      const unknown = await login({ email: "phase1-missing@example.invalid" }, "Wrong!123");
      assert.equal(unknown.response.status, 401);
      for (let attempt = 0; attempt < 5; attempt++) {
        const bad = await login(user, "Wrong!123");
        assert.equal(bad.response.status, 401);
        assert.deepEqual(bad.data, unknown.data);
      }
      const locked = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(locked.failedLoginAttempts, 5); assert.ok(locked.lockedUntil > new Date());
      assert.deepEqual((await login(user)).data, unknown.data);
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1) } });
      await authenticated(user);
      const unlocked = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(unlocked.failedLoginAttempts, 0); assert.equal(unlocked.lockedUntil, null);
      const disabled = await fixture({ status: "DISABLED" });
      assert.deepEqual((await login(disabled)).data, unknown.data);
    });
    await t.test("CSRF and origin rejection, valid logout and replay of previous cookies", async () => {
      const user = await fixture(); const session = await authenticated(user);
      for (const headers of [{}, { "x-csrf-token": generateToken() }, { "x-csrf-token": session.csrf, Origin: "https://evil.example" }]) {
        assert.equal((await request("/auth/logout", { method: "POST", session, headers })).response.status, 403);
      }
      const untrusted = await request("/auth/login", { method: "POST", body: { email: user.email, password }, headers: { Origin: "https://evil.example" } });
      assert.equal(untrusted.response.status, 403);
      assert.equal((await request("/auth/login", { method: "POST", body: {}, headers: { "Sec-Fetch-Site": "cross-site" } })).response.status, 403);
      const loggedOut = await request("/auth/logout", { method: "POST", session, headers: { "x-csrf-token": session.csrf, Origin: ALLOWED_ORIGINS[0] } });
      assert.equal(loggedOut.response.status, 200);
      assert.equal(loggedOut.response.headers.getSetCookie().length, 2);
      // Deliberately replay the captured pre-logout cookie header.
      assert.equal((await request("/auth/me", { session })).response.status, 401);
      assert.ok((await rowFor(session)).revokedAt);
    });
    await t.test("credentialed CORS allows the configured origin and excludes others", async () => {
      const trusted = await fetch(base + "/auth/me", { method: "OPTIONS", headers: { Origin: ALLOWED_ORIGINS[0], "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token" } });
      assert.equal(trusted.status, 204);
      assert.equal(trusted.headers.get("access-control-allow-origin"), ALLOWED_ORIGINS[0]);
      assert.equal(trusted.headers.get("access-control-allow-credentials"), "true");
      assert.match(trusted.headers.get("access-control-allow-headers"), /x-csrf-token/);
      const rejected = await fetch(base + "/auth/me", { headers: { Origin: "https://evil.example" } });
      assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    });
    await t.test("invalid/missing tokens, missing CSRF cookie, disabled existing session", async () => {
      for (const cookie of ["", SESSION_COOKIE_NAME + "=bad", SESSION_COOKIE_NAME + "=" + generateToken()]) {
        const result = await request("/auth/me", { session: { cookie } });
        assert.equal(result.response.status, 401);
        assert.equal(result.response.headers.getSetCookie().length, 2);
      }
      const user = await fixture(); const session = await authenticated(user);
      const missingCsrf = { cookie: session.cookie.split("; ").filter(c => !c.startsWith(CSRF_COOKIE_NAME + "=")).join("; ") };
      assert.equal((await request("/auth/me", { session: missingCsrf })).data.code, "CSRF_UNAVAILABLE");
      await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
      assert.equal((await request("/auth/me", { session })).response.status, 401);
      assert.ok((await rowFor(session)).revokedAt);
    });
    await t.test("exact inactivity and absolute expiry boundaries with a controlled clock", async () => {
      const user = await fixture();
      const now = new Date("2030-01-01T12:00:00.000Z");
      async function check({ idle, expiry, expected }) {
        const token = generateToken();
        const row = await prisma.userSession.create({ data: { userId: user.id, tokenHash: hashToken(token), csrfTokenHash: hashToken(generateToken()), lastSeenAt: new Date(now - idle), expiresAt: new Date(now.getTime() + expiry) } });
        let error;
        t.mock.timers.enable({ apis: ["Date"], now });
        try {
          await authenticate()({ cookies: { [SESSION_COOKIE_NAME]: token } }, { setHeader() {}, clearCookie() {} }, value => { error = value; });
        } finally { t.mock.timers.reset(); }
        assert.equal(error?.statusCode || 200, expected);
        const after = await prisma.userSession.findUnique({ where: { id: row.id } });
        assert.equal(after.expiresAt.getTime(), row.expiresAt.getTime());
        if (expected === 200 && idle >= 60000) assert.equal(after.lastSeenAt.getTime(), now.getTime());
        if (expected === 401) assert.ok(after.revokedAt);
      }
      await check({ idle: 3599999, expiry: 3600000, expected: 200 });
      await check({ idle: 3600000, expiry: 3600000, expected: 401 });
      await check({ idle: 3600001, expiry: 3600000, expected: 401 });
      await check({ idle: 0, expiry: 1, expected: 200 });
      await check({ idle: 0, expiry: 0, expected: 401 });
      await check({ idle: 0, expiry: -1, expected: 401 });
    });
    await t.test("forced password change allows account access and blocks normal authentication middleware", async () => {
      const user = await fixture({ mustChangePassword: true }); const session = await authenticated(user);
      const me = await request("/auth/me", { session });
      assert.equal(me.response.status, 200); assert.equal(me.data.data.user.mustChangePassword, true);
      const raw = session.cookie.match(new RegExp(SESSION_COOKIE_NAME + "=([a-f0-9]+)"))[1];
      let error;
      await authenticate()({ cookies: { [SESSION_COOKIE_NAME]: raw } }, { setHeader() {}, clearCookie() {} }, value => { error = value; });
      assert.equal(error.code, "PASSWORD_CHANGE_REQUIRED");
    });
    await t.test("password validation, wrong current password, update and replay of ALL old sessions", async () => {
      const user = await fixture({ mustChangePassword: true });
      const first = await authenticated(user); const second = await authenticated(user);
      const change = body => request("/auth/change-password", { method: "POST", session: first, body, headers: { "x-csrf-token": first.csrf } });
      for (const newPassword of [password, "short", "😀".repeat(19)]) {
        assert.equal((await change({ currentPassword: password, newPassword })).response.status, 400);
      }
      const wrong = await change({ currentPassword: "Incorrect!123", newPassword: "New-fixture!456" });
      assert.equal(wrong.data.code, "INVALID_CURRENT_PASSWORD");
      const changed = await change({ currentPassword: password, newPassword: "New-fixture!456" });
      assert.equal(changed.response.status, 200);
      assert.equal(changed.response.headers.getSetCookie().length, 2);
      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      assert.notEqual(updated.passwordHash, passwordHash);
      assert.ok(await verifyPassword("New-fixture!456", updated.passwordHash));
      assert.equal(updated.mustChangePassword, false);
      assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
      // Both cookies are the originals captured BEFORE password change.
      for (const session of [first, second]) assert.equal((await request("/auth/me", { session })).response.status, 401);
      assert.equal((await login(user)).response.status, 401);
      assert.equal((await login(user, "New-fixture!456")).response.status, 200);
    });
    await t.test("all four roles can use shared auth routes", async () => {
      for (const role of ["ADMIN", "HR", "MANAGER", "EMPLOYEE"]) {
        const user = await fixture({ role }); const session = await authenticated(user);
        const me = await request("/auth/me", { session });
        assert.equal(me.data.data.user.role, role);
      }
    });
    await t.test("password and login rate limits enforce their configured thresholds", async () => {
      const user = await fixture(); const session = await authenticated(user);
      passwordChangeLimiter.resetKey(user.id);
      for (let i = 0; i < 11; i++) {
        const result = await request("/auth/change-password", { method: "POST", session, body: {}, headers: { "x-csrf-token": session.csrf } });
        assert.equal(result.response.status, i < 10 ? 400 : 429);
      }
      loginLimiter.resetKey("127.0.0.1");
      for (let i = 0; i < 101; i++) {
        const result = await request("/auth/login", { method: "POST", body: {} });
        assert.equal(result.response.status, i < 100 ? 400 : 429);
      }
      loginLimiter.resetKey("127.0.0.1");
    });
    await t.test("authentication/password audit records exist without credential metadata", async () => {
      const logs = await prisma.auditLog.findMany();
      for (const action of ["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGOUT", "PASSWORD_CHANGE_FAILED", "PASSWORD_CHANGED"]) {
        assert.ok(logs.some(log => log.action === action), "Missing audit action " + action);
      }
      for (const log of logs) {
        assert.doesNotMatch(JSON.stringify(log.metadata), /passwordHash|sessionToken|csrfToken|cookie/i);
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
    await database.cleanup();
    console.log("Isolated database removed; original Admin snapshot unchanged.");
  }
});
