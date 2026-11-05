const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { assertTestDatabase } = require("./isolated-db");
const authorize = require("../src/middleware/authorize");
const { loginSchema, changePasswordSchema } = require("../src/validation/auth.validation");
const { generateToken, hashToken, verifyToken, isValidToken } = require("../src/utils/token");
const { hashPassword, verifyPassword } = require("../src/utils/password");

test("database guard refuses application DB and arbitrary test URLs", () => {
  for (const name of ["AdRankoHRM", "adrankohrm", "postgres", "test", "officehr_phase1_test_bad"]) {
    assert.throws(() => assertTestDatabase("postgresql://localhost/" + name));
  }
  assert.equal(assertTestDatabase("postgresql://localhost/officehr_phase1_test_0123456789abcdef"), "officehr_phase1_test_0123456789abcdef");
});

test("authorization checks every allowed/disallowed role pairing and missing auth", () => {
  const roles = ["ADMIN", "HR", "MANAGER", "EMPLOYEE"];
  for (const allowed of roles) {
    const middleware = authorize(allowed);
    middleware({}, {}, error => assert.equal(error.statusCode, 401));
    for (const actual of roles) {
      middleware({ auth: { user: { role: actual } } }, {}, error => {
        if (actual === allowed) assert.equal(error, undefined);
        else assert.equal(error.statusCode, 403);
      });
    }
  }
  authorize(...roles)({ auth: { user: { role: "EMPLOYEE" } } }, {}, error => assert.equal(error, undefined));
  assert.throws(() => authorize());
  assert.throws(() => authorize("OWNER"));
});

test("tokens are random 256-bit values, hashed and compared safely", () => {
  const tokens = Array.from({ length: 100 }, generateToken);
  assert.equal(new Set(tokens).size, 100);
  for (const token of tokens) {
    assert.ok(isValidToken(token));
    assert.notEqual(hashToken(token), token);
    assert.ok(verifyToken(token, hashToken(token)));
  }
  assert.equal(verifyToken(tokens[0], hashToken(tokens[1])), false);
  for (const invalid of [null, "", "x".repeat(64), "a".repeat(63)]) {
    assert.equal(isValidToken(invalid), false);
    assert.equal(verifyToken(invalid, hashToken(tokens[0])), false);
  }
});

test("validation normalizes email, rejects unknown fields, enforces Unicode and byte limits", async () => {
  assert.equal(loginSchema.parse({ email: " USER@EXAMPLE.COM ", password: "valid123" }).email, "user@example.com");
  for (const body of [{}, { email: "bad", password: "x" }, { email: "u@example.com", password: "x", role: "ADMIN" }]) {
    assert.equal(loginSchema.safeParse(body).success, false);
  }
  const parse = newPassword => changePasswordSchema.safeParse({ currentPassword: "Previous!123", newPassword }).success;
  assert.equal(parse("😀".repeat(8)), true);
  assert.equal(parse("😀".repeat(7)), false);
  assert.equal(parse("😀".repeat(18)), true);
  assert.equal(parse("😀".repeat(19)), false);
  assert.equal(parse("Previous!123"), false);
  assert.equal(parse("a".repeat(72)), true);
  assert.equal(parse("a".repeat(73)), false);
  const hash = await hashPassword("😀".repeat(8));
  assert.ok(await verifyPassword("😀".repeat(8), hash));
  assert.equal(await verifyPassword("incorrect", hash), false);
  await assert.rejects(hashPassword("😀".repeat(7)), RangeError);
  await assert.rejects(hashPassword("😀".repeat(19)), RangeError);
});

test("development and production cookie contracts", () => {
  const source = fs.readFileSync(require.resolve("../src/config/auth"), "utf8");
  for (const production of [false, true]) {
    const context = { module: { exports: {} }, require() {}, URL, process: { env: { NODE_ENV: production ? "production" : "development" } } };
    vm.runInNewContext(source, context);
    const config = context.module.exports;
    assert.equal(config.SESSION_COOKIE_OPTIONS.httpOnly, true);
    assert.equal(config.SESSION_COOKIE_OPTIONS.secure, production);
    assert.equal(config.SESSION_COOKIE_OPTIONS.sameSite, "lax");
    assert.equal(config.SESSION_COOKIE_OPTIONS.path, "/");
    assert.equal(config.SESSION_COOKIE_OPTIONS.domain, undefined);
    assert.equal(config.SESSION_COOKIE_NAME.startsWith("__Host-"), production);
    assert.equal(config.CSRF_COOKIE_NAME.startsWith("__Host-"), production);
    assert.equal(config.SESSION_IDLE_TIMEOUT_MS, 3600000);
  }
});
