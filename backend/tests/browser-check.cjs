// Run from backend: npm run test:browser. Uses installed Chrome, not a downloaded browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createIsolatedDatabase, assertTestDatabase } = require("./isolated-db");
const { chromium } = require("../../frontend/node_modules/playwright-core");

async function main() {
  const database = await createIsolatedDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_ORIGIN = "http://127.0.0.1:4179";
  assertTestDatabase(process.env.DATABASE_URL);
  const prisma = require("../src/config/prisma");
  const app = require("../app");
  const { hashPassword } = require("../src/utils/password");
  const api = app.listen(0, "127.0.0.1");
  await new Promise(resolve => api.once("listening", resolve));
  process.env.VITE_API_URL = `http://127.0.0.1:${api.address().port}/api`;
  const frontendRoot = path.resolve(__dirname, "../../frontend");
  const artifacts = path.resolve(__dirname, "../../artifacts/phase1");
  fs.mkdirSync(artifacts, { recursive: true });
  let vite, browser;
  let count = 0;
  let fixtureNumber = 0;
  const password = "Browser-fixture!123";
  const passwordHash = await hashPassword(password);
  const fixture = overrides => prisma.user.create({ data: {
    email: `phase1-browser-${++fixtureNumber}@example.invalid`, displayName: "Phase 1 Browser Fixture",
    passwordHash, mustChangePassword: false, role: "ADMIN", ...overrides,
  } });
  const errors = [];
  async function check(label, callback) {
    await callback(); count++; console.log("PASS: " + label);
  }
  async function pageContext(viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ baseURL: process.env.FRONTEND_ORIGIN, viewport, colorScheme: "light" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    return { context, page };
  }
  async function signIn(page, user, destination = "/dashboard") {
    await page.goto(destination);
    await page.getByLabel("Email address", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(user.mustChangePassword ? "**/account" : "**" + destination);
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  async function noOverflow(page) {
    const layout = await page.evaluate(() => ({
      viewport: innerWidth, width: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("body *")].filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.right > innerWidth + 1;
      }).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className })),
    }));
    assert.ok(layout.width <= layout.viewport, "Unexpected horizontal overflow: " + JSON.stringify(layout));
  }
  try {
    const { createServer } = await import(pathToFileURL(path.join(frontendRoot, "node_modules/vite/dist/node/index.js")).href);
    vite = await createServer({ root: frontendRoot, server: { host: "127.0.0.1", port: 4179, strictPort: true } });
    await vite.listen();
    const chromePaths = [process.env.OFFICEHR_TEST_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
    const executablePath = chromePaths.find(file => fs.existsSync(file));
    if (!executablePath) throw new Error("No installed Chrome/Edge found; set OFFICEHR_TEST_CHROME.");
    browser = await chromium.launch({ executablePath, headless: true });
    const user = await fixture();
    const { context, page } = await pageContext();
    await check("signed-out protected route, failed login, duplicate submission, allowed return path", async () => {
      await page.goto("/account");
      await page.waitForURL("**/login");
      assert.equal(await page.getByRole("heading", { name: "Account details" }).count(), 0);
      await page.getByLabel("Email address", { exact: true }).fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill("Incorrect!123");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
      let loginRequests = 0;
      await page.route("**/api/auth/login", async route => {
        loginRequests++;
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.continue();
      });
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await page.waitForURL("**/account");
      await page.getByRole("heading", { name: "Account details" }).waitFor();
      assert.equal(loginRequests, 1);
      await page.unroute("**/api/auth/login");
    });
    await check("one shared header/main, active navigation, account identity, refresh and guest redirect", async () => {
      assert.equal(await page.locator("header").count(), 1);
      assert.equal(await page.locator("main").count(), 1);
      assert.equal(await page.locator("aside a[aria-current=page]").innerText(), "My account");
      await page.reload();
      await page.getByRole("heading", { name: "Account details" }).waitFor();
      await page.goto("/login"); await page.waitForURL("**/dashboard");
      await page.getByRole("heading", { name: "Admin overview" }).waitFor();
      assert.equal(await page.locator("header").count(), 1);
      assert.equal(await page.locator("main").count(), 1);
      assert.equal(await page.locator("aside a[aria-current=page]").innerText(), "Dashboard");
      assert.ok(await page.locator("header").innerText().then(text => text.includes(user.displayName) && text.includes("Administrator")));
      await page.screenshot({ path: path.join(artifacts, "desktop-light.png") });
    });
    await check("light/dark/system selection, OS changes, saved theme and no browser token storage", async () => {
      await page.getByLabel("Theme", { exact: true }).selectOption("dark");
      await page.reload();
      await page.getByRole("heading", { name: "Admin overview" }).waitFor();
      assert.equal(await page.locator("html").getAttribute("class"), "dark");
      await page.locator("aside").getByRole("link", { name: "My account", exact: true }).click();
      await page.getByRole("heading", { name: "Account details" }).waitFor();
      await page.screenshot({ path: path.join(artifacts, "account-dark.png") });
      await page.getByLabel("Theme", { exact: true }).selectOption("system");
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(() => document.documentElement.classList.contains("light"));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
      await page.reload(); await page.getByRole("heading", { name: "Account details" }).waitFor();
      assert.equal(await page.getByLabel("Theme", { exact: true }).inputValue(), "system");
      const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      assert.deepEqual(storage.local, ["officehr-theme"]); assert.deepEqual(storage.session, []);
    });
    await check("desktop/tablet/narrow mobile layout without horizontal overflow", async () => {
      await prisma.user.update({ where: { id: user.id }, data: { displayName: "W".repeat(120), email: "w".repeat(230) + "@example.invalid" } });
      await page.reload(); await page.getByRole("heading", { name: "Account details" }).waitFor();
      for (const destination of ["/dashboard", "/account"]) {
        await page.goto(destination);
        await page.getByRole("heading", { name: destination === "/account" ? "Account details" : "Admin overview" }).waitFor();
        for (const width of [1440, 1024, 768, 375, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await noOverflow(page);
          assert.equal(await page.getByRole("button", { name: "Open navigation" }).isVisible(), width < 1024);
        }
      }
      await page.screenshot({ path: path.join(artifacts, "mobile-account.png") });
    });
    await check("mobile dialog focus trap, Escape, close button, inner clicks and backdrop dismissal", async () => {
      const trigger = page.getByRole("button", { name: "Open navigation" });
      const dialog = page.getByRole("dialog");
      await trigger.click();
      await dialog.waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "hidden");
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < 10; index++) {
          await page.keyboard.press(key);
          assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
        }
      }
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      // Native dialog closure precedes the queued close event and React effect cleanup.
      // Wait for the required observable result; keep the scroll/focus assertions intact.
      await page.waitForFunction(() => document.documentElement.style.overflow === "", null, { timeout: 2000 });
      assert.ok(await trigger.evaluate(element => element === document.activeElement));
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
      await trigger.click();
      // Header padding remains noninteractive as navigation gains new modules.
      // The former y=500 coordinate now hits a navigation link and correctly closes it.
      await dialog.click({ position: { x: 12, y: 12 } });
      assert.ok(await dialog.isVisible(), "Click inside drawer must not dismiss it");
      await dialog.getByRole("button", { name: "Close navigation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.documentElement.style.overflow === "", null, { timeout: 2000 });
      await trigger.click();
      await page.mouse.click(310, 450);
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.documentElement.style.overflow === "", null, { timeout: 2000 });
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
    });
    await check("drawer closes on navigation, desktop resize and unmount; scroll and keyboard skip restored", async () => {
      const trigger = page.getByRole("button", { name: "Open navigation" });
      const dialog = page.getByRole("dialog");
      await trigger.click();
      await dialog.getByRole("link", { name: "Dashboard", exact: true }).click();
      await page.getByRole("heading", { name: "Admin overview" }).waitFor();
      await dialog.waitFor({ state: "hidden" });
      assert.ok(await page.locator("main").evaluate(element => element === document.activeElement));
      await trigger.click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(() => !document.querySelector("dialog").open && document.documentElement.style.overflow === "");
      assert.ok(await page.getByRole("button", { name: "Sign out", exact: true }).isEnabled());
      await page.reload(); await page.getByRole("heading", { name: "Admin overview" }).waitFor();
      const skip = page.getByRole("link", { name: "Skip to content" });
      // Route navigation intentionally focuses main. Reach the preceding skip
      // link using the keyboard rather than assuming initial focus is body.
      const focusableBound = await page.locator('a[href], button').count() + 2;
      for (let index = 0; index < focusableBound; index++) {
        await page.keyboard.press("Shift+Tab");
        if (await skip.evaluate(element => element === document.activeElement)) break;
      }
      assert.ok(await skip.evaluate(element => element === document.activeElement));
      assert.ok((await skip.boundingBox()).y >= 0);
      assert.notEqual(await skip.evaluate(element => getComputedStyle(element).outlineStyle), "none");
      await page.keyboard.press("Enter");
      assert.ok(await page.locator("main").evaluate(element => element === document.activeElement));
      await page.setViewportSize({ width: 375, height: 900 });
      await trigger.click();
      await page.evaluate(() => {
        history.pushState(null, "", "/phase1-unknown");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.getByRole("heading", { name: /not found/i }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
    });
    await check("unknown routes and shared-header logout", async () => {
      await page.goto("/dashboard"); await page.getByRole("heading", { name: "Admin overview" }).waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForURL("**/login");
      await page.goto("/dashboard"); await page.waitForURL("**/login");
    });
    await context.close();

    await check("network failure shows retry, hides private content, and retry restores the session", async () => {
      const retryUser = await fixture();
      const { context: retryContext, page: retryPage } = await pageContext();
      await signIn(retryPage, retryUser);
      await retryPage.route("**/api/auth/me", route => route.abort("connectionrefused"));
      await retryPage.reload();
      await retryPage.getByRole("heading", { name: "Unable to verify your session" }).waitFor();
      assert.equal(await retryPage.getByRole("heading", { name: "Admin overview" }).count(), 0);
      assert.equal(new URL(retryPage.url()).pathname, "/dashboard");
      await retryPage.unroute("**/api/auth/me");
      await retryPage.getByRole("button", { name: "Try again" }).click();
      await retryPage.getByRole("heading", { name: "Admin overview" }).waitFor();
      await retryContext.close();
    });
    await check("external redirect state is ignored", async () => {
      const redirectUser = await fixture();
      const { context: redirectContext, page: redirectPage } = await pageContext();
      await redirectPage.goto("/login");
      await redirectPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
      await redirectPage.evaluate(() => history.replaceState({ usr: { from: "https://evil.example" }, key: "test", idx: 0 }, "", "/login"));
      await redirectPage.reload();
      await redirectPage.getByLabel("Email address", { exact: true }).fill(redirectUser.email);
      await redirectPage.getByLabel("Password", { exact: true }).fill(password);
      await redirectPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await redirectPage.waitForURL("**/dashboard");
      assert.equal(new URL(redirectPage.url()).origin, process.env.FRONTEND_ORIGIN);
      await redirectContext.close();
    });
    await check("all-role navigation visibility and role-specific dashboard headings", async () => {
      for (const [role, heading] of [["ADMIN", "Admin overview"], ["HR", "HR overview"], ["MANAGER", "Manager overview"], ["EMPLOYEE", "My overview"]]) {
        const roleUser = await fixture({ role });
        const { context: roleContext, page: rolePage } = await pageContext();
        await signIn(rolePage, roleUser);
        await rolePage.getByRole("heading", { name: heading, exact: true }).waitFor();
        // The independently added Attendance link is available to all four roles.
        assert.equal(await rolePage.locator("aside nav a").count(), ["ADMIN", "HR"].includes(role) ? 12 : 9);
        assert.equal(await rolePage.locator('aside nav a[href="/leaves"]').count(),1);
        for (const label of ['Announcements','Notifications']) assert.equal(await rolePage.getByRole('link',{name:label,exact:true}).count(),1);
        assert.equal(await rolePage.getByRole('link',{name:'Payroll',exact:true}).count(),['ADMIN','HR'].includes(role)?1:0);
        assert.equal(await rolePage.getByRole('link',{name:'My payslips',exact:true}).count(),1);
        assert.equal(await rolePage.getByRole('link', { name: 'Attendance', exact: true }).count(), 1);
        assert.equal(await rolePage.getByRole('link', { name: 'Attendance Settings', exact: true }).count(), ['ADMIN','HR'].includes(role) ? 1 : 0);
        assert.equal(await rolePage.getByRole('link', { name: 'Shifts', exact: true }).count(), 0);
        await roleContext.close();
      }
    });
    await check("forced password change, confirmation and Unicode limits, current password, all-session logout and notice", async () => {
      const forced = await fixture({ mustChangePassword: true });
      const { context: forcedContext, page: forcedPage } = await pageContext();
      await signIn(forcedPage, forced);
      assert.equal(await forcedPage.locator("aside nav a").count(), 1);
      await forcedPage.goto("/dashboard"); await forcedPage.waitForURL("**/account");
      await forcedPage.getByLabel("Current password", { exact: true }).fill(password);
      await forcedPage.getByLabel("New password", { exact: true }).fill("New-browser!456");
      await forcedPage.getByLabel("Confirm new password", { exact: true }).fill("Mismatch!456");
      await forcedPage.getByRole("button", { name: "Update password" }).click();
      await forcedPage.getByRole("alert").filter({ hasText: "New passwords do not match" }).waitFor();
      for (const [value, error] of [["😀".repeat(7), "at least 8"], ["😀".repeat(19), "too long"], [password, "different"]]) {
        await forcedPage.getByLabel("New password", { exact: true }).fill(value);
        await forcedPage.getByLabel("Confirm new password", { exact: true }).fill(value);
        await forcedPage.getByRole("button", { name: "Update password" }).click();
        await forcedPage.getByRole("alert").filter({ hasText: error }).waitFor();
      }
      await forcedPage.getByLabel("Current password", { exact: true }).fill("Incorrect!123");
      await forcedPage.getByLabel("New password", { exact: true }).fill("New-browser!456");
      await forcedPage.getByLabel("Confirm new password", { exact: true }).fill("New-browser!456");
      await forcedPage.getByRole("button", { name: "Update password" }).click();
      await forcedPage.getByRole("alert").filter({ hasText: "Current password is incorrect" }).waitFor();
      await forcedPage.getByLabel("Current password", { exact: true }).fill(password);
      await forcedPage.getByRole("button", { name: "Update password" }).click();
      await forcedPage.waitForURL("**/login");
      await forcedPage.getByRole("status").filter({ hasText: "Password changed successfully" }).waitFor();
      await forcedPage.getByLabel("Email address", { exact: true }).fill(forced.email);
      await forcedPage.getByLabel("Password", { exact: true }).fill(password);
      await forcedPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await forcedPage.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
      await forcedPage.getByLabel("Password", { exact: true }).fill("New-browser!456");
      await forcedPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await forcedPage.waitForURL("**/account");
      await forcedPage.locator("aside").getByRole("link", { name: "Dashboard", exact: true }).click();
      await forcedPage.getByRole("heading", { name: "Admin overview" }).waitFor();
      await forcedContext.close();
    });
    await check("revoked session on password submission clears private UI", async () => {
      const expired = await fixture();
      const { context: expiredContext, page: expiredPage } = await pageContext();
      await signIn(expiredPage, expired, "/account");
      await expiredPage.getByRole("button", { name: "Change password", exact: true }).click();
      await prisma.userSession.updateMany({ where: { userId: expired.id }, data: { revokedAt: new Date() } });
      await expiredPage.getByLabel("Current password", { exact: true }).fill(password);
      await expiredPage.getByLabel("New password", { exact: true }).fill("New-browser!456");
      await expiredPage.getByLabel("Confirm new password", { exact: true }).fill("New-browser!456");
      await expiredPage.getByRole("button", { name: "Update password" }).click();
      await expiredPage.waitForURL("**/login");
      await expiredPage.getByRole("status").filter({ hasText: "session has expired" }).waitFor();
      await expiredContext.close();
    });
    assert.deepEqual(errors, [], "Browser runtime errors");
    fs.writeFileSync(path.join(artifacts, "browser-results.json"), JSON.stringify({
      checksPassed: count, runtimeErrors: errors.length, browser: browser.version(),
      widths: [1440, 1024, 768, 375, 320], pages: ["/dashboard", "/account"],
      storage: "Theme preference only; authentication stays in memory/HttpOnly cookies",
    }, null, 2) + "\n");
    console.log(`Browser checks passed: ${count}; browser runtime errors: 0.`);
  } finally {
    if (browser) await browser.close();
    if (vite) await vite.close();
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
    await prisma.$disconnect();
    await database.cleanup();
    console.log("Browser fixtures/database removed; original Admin snapshot unchanged.");
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
