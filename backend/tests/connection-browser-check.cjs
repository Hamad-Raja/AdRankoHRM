// Real browser/cookie verification against the existing app and a guarded
// disposable database. Does not send fixture logins to the normal API.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../../frontend/node_modules/playwright-core");
const { createIsolatedDatabase, assertTestDatabase } = require("./isolated-db");

(async () => {
  const database = await createIsolatedDatabase();
  let prisma, server, vite, browser;
  const checks = [];
  async function closeApi() {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
  try {
    assertTestDatabase(database.url);
    process.env.DATABASE_URL = database.url;
    process.env.NODE_ENV = "development";
    process.env.FRONTEND_ORIGIN = "http://localhost:4179";
    const app = require("../app");
    prisma = require("../src/config/prisma");
    const { hashPassword } = require("../src/utils/password");
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    const apiUrl = `http://localhost:${port}/api`;
    process.env.VITE_API_URL = apiUrl;
    const root = path.resolve(__dirname, "../../frontend");
    const { createServer } = await import(pathToFileURL(path.join(root, "node_modules/vite/dist/node/index.js")).href);
    vite = await createServer({ root, server: { host: "localhost", port: 4179, strictPort: true } });
    await vite.listen();
    const password = "Connection-fixture!123";
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({ data: {
      email: "connection-fixture@example.invalid", displayName: "Connection Test Fixture",
      role: "ADMIN", mustChangePassword: false, passwordHash,
    } });
    const forced = await prisma.user.create({ data: {
      email: "forced-connection-fixture@example.invalid", displayName: "Forced Connection Test Fixture",
      role: "ADMIN", mustChangePassword: true, passwordHash,
    } });
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", error => runtimeErrors.push(error.message));
    const checked = label => { checks.push(label); console.log("PASS: " + label); };

    await page.goto(process.env.FRONTEND_ORIGIN + "/dashboard");
    await page.waitForURL("**/login");
    await page.getByLabel("Email address", { exact: true }).waitFor();
    checked("reachable signed-out API redirects dashboard to login form");
    await page.getByLabel("Email address", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "Admin overview", exact: true }).waitFor();
    const cookies = await context.cookies(apiUrl);
    assert.equal(cookies.length, 2);
    for (const cookie of cookies) {
      assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, false);
      assert.equal(cookie.sameSite, "Lax"); assert.equal(cookie.path, "/");
    }
    checked("valid isolated fixture login reaches dashboard with real HttpOnly SameSite cookies");
    const restoredResponse = page.waitForResponse(response => response.url() === apiUrl + "/auth/me");
    await page.reload();
    const restored = await restoredResponse;
    assert.equal(restored.status(), 200);
    assert.equal((await restored.allHeaders())["access-control-allow-origin"], process.env.FRONTEND_ORIGIN);
    await page.getByRole("heading", { name: "Admin overview", exact: true }).waitFor();
    checked("browser sends fixture cookies and restores the session after refresh");

    // Stop only this test's ephemeral API, never the user's normal API/process.
    await closeApi();
    await page.reload();
    await page.getByRole("heading", { name: "Unable to verify your session" }).waitFor();
    await page.getByRole("button", { name: "Try again" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Admin overview", exact: true }).count(), 0);
    checked("actual test-API outage hides private content and preserves honest retry state");
    server = app.listen(port, "127.0.0.1");
    await once(server, "listening");
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Admin overview", exact: true }).waitFor();
    checked("restoring the same API and selecting Try again recovers the valid session");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL("**/login");
    await page.getByLabel("Email address", { exact: true }).waitFor();
    assert.equal((await context.cookies(apiUrl)).length, 0);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
    checked("shared-header logout revokes the fixture session and clears cookies");

    await page.getByLabel("Email address", { exact: true }).fill(forced.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/account");
    await page.getByLabel("Current password", { exact: true }).waitFor();
    await page.goto(process.env.FRONTEND_ORIGIN + "/dashboard");
    await page.waitForURL("**/account");
    await page.getByLabel("Current password", { exact: true }).waitFor();
    checked("forced password change still permits account and blocks dashboard");
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    assert.ok(storage.local.every(key => key === "officehr-theme"));
    assert.deepEqual(storage.session, []);
    assert.deepEqual(runtimeErrors, []);
    fs.writeFileSync(path.join(path.resolve(__dirname,'../../artifacts/final-audit/connection'), "fixture-results.json"), JSON.stringify({
      checks, runtimeErrors: 0, browser: browser.version(),
      frontend: process.env.FRONTEND_ORIGIN, api: apiUrl, isolatedDatabase: true,
      storageContainsNoAuthenticationMaterial: true,
    }, null, 2) + "\n");
    await context.close();
  } finally {
    const failures = [];
    for (const cleanup of [() => browser?.close(), () => vite?.close(), closeApi, () => prisma?.$disconnect(), () => database.cleanup()]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error("Connection fixture cleanup failed.");
    console.log("Temporary fixture database removed; original Admin snapshot unchanged.");
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
