// Writes/login only in a generated guarded database, with temporary private files.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../frontend/node_modules/playwright-core');
const { createIsolatedDatabase, assertTestDatabase } = require('./isolated-db');
(async () => {
  const db = await createIsolatedDatabase(); assertTestDatabase(db.url);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'officehr-browser-'));
  let prisma, server, vite, browser;
  const checks = [], errors = [];
  const checked = label => { checks.push(label); console.log('PASS: ' + label); };
  async function closeApi() { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
  try {
    process.env.DATABASE_URL = db.url; process.env.DOCUMENT_STORAGE_DIR = path.join(temporary, 'documents');
    process.env.NODE_ENV = 'development'; process.env.FRONTEND_ORIGIN = 'http://localhost:4181';
    const app = require('../app'); prisma = require('../src/config/prisma');
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port, api = `http://localhost:${port}/api`, origin = process.env.FRONTEND_ORIGIN;
    process.env.VITE_API_URL = api;
    const root = path.resolve(__dirname, '../../frontend');
    const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
    vite = await createServer({ root, cacheDir: path.join(temporary, 'vite-cache'), server: { host: 'localhost', port: 4181, strictPort: true } }); await vite.listen();
    const password = 'Browser-Phase2-123!', passwordHash = await require('../src/utils/password').hashPassword(password);
    const users = {};
    for (const role of ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']) users[role] = await prisma.user.create({ data: { email: `${role.toLowerCase()}-phase2@example.invalid`, displayName: `${role} fixture`, role, passwordHash, mustChangePassword: false } });
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    const panel = name => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).last();
    async function login(role, target = '/dashboard') {
      await page.goto(origin + '/login'); await page.getByLabel('Email address', { exact: true }).fill(users[role].email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      if(users[role].mustChangePassword){await page.waitForURL('**/account');await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByLabel('New password',{exact:true}).fill('Changed-browser-fixture-123!');await page.getByLabel('Confirm new password',{exact:true}).fill('Changed-browser-fixture-123!');await page.getByRole('button',{name:'Update password',exact:true}).click();await page.waitForURL('**/login');await page.goto(origin+'/dashboard');await page.waitForURL('**/login');await page.getByLabel('Email address',{exact:true}).fill(users[role].email);await page.getByLabel('Password',{exact:true}).fill('Changed-browser-fixture-123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/dashboard');assert.equal((await prisma.user.findUnique({where:{id:users[role].id}})).mustChangePassword,false);checked('Inline provisioned employee completes required first-login password change and logs in with the changed credential');}
      await page.waitForURL('**/dashboard'); if (target !== '/dashboard') await page.goto(origin + target);
    }
    await login('ADMIN', '/employees');
    await page.getByRole('link', { name: 'Add employee', exact: true }).click();
    await page.getByLabel('Employee code').fill('BROWSER-001'); await page.getByLabel('Full name').fill('Browser Employee');
    await page.getByLabel('Personal email').fill('personal@example.invalid'); await page.getByLabel('Joining date').fill('2020-01-01');
    await page.getByLabel('Initial status').selectOption('ACTIVE');
    await page.getByLabel(/^Login email/).fill('onboard-browser@example.invalid');await page.getByLabel(/^Password/).fill(password);await page.getByLabel(/^Confirm password/).fill(password);
    await page.getByRole('button', { name: 'Create employee & login', exact: true }).click(); await page.getByRole('heading', { name: 'Employee created successfully' }).waitFor();
    await page.getByRole('link', { name: 'View employee details' }).click(); await page.getByRole('heading', { name: 'Browser Employee', exact: true }).waitFor();
    const employee = await prisma.employee.findUnique({ where: { employeeCode: 'BROWSER-001' } });
    const episode=await prisma.employmentEpisode.findFirst({where:{employeeId:employee.id}});assert.equal(episode.status,'ACTIVE');
    const initialEvent=await prisma.employmentStatusEvent.findFirst({where:{employmentEpisodeId:episode.id}});assert.ok(initialEvent.reason.trim().length);assert.equal(initialEvent.actorUserId,users.ADMIN.id);
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click(); await page.getByLabel('Phone number').fill('+92 300 1111111');
    await page.getByRole('button', { name: 'Save profile changes' }).click(); await page.getByText('Profile changes saved.', { exact: true }).waitFor();
    assert.equal((await prisma.employee.findUnique({ where: { id: employee.id } })).phone, '+92 300 1111111');
    checked('Directory → creation → detail → profile edit persists through actual API');

    await page.getByRole('button', { name: 'Edit profile', exact: true }).click(); await page.getByLabel('Phone number').fill('+92 300 2222222');
    await prisma.employee.update({ where: { id: employee.id }, data: { version: { increment: 1 }, phone: '+92 300 3333333' } });
    await page.getByRole('button', { name: 'Save profile changes' }).click(); await page.getByText(/Someone changed this profile/).waitFor();
    assert.equal(await page.getByLabel('Phone number').inputValue(), '+92 300 2222222'); assert.equal(await page.getByRole('button', { name: 'Save profile changes' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Discard draft and load current profile' }).click(); await page.getByText(/Current profile loaded/).waitFor(); assert.equal(await page.getByLabel('Phone number').inputValue(), '+92 300 3333333');
    checked('409 preserves draft, blocks write and explicitly reloads current version');

    await page.route(`**/api/employees/${employee.id}`, async route => { if (route.request().method() === 'PATCH') { await route.fetch(); await route.abort('failed'); } else await route.continue(); });
    await page.getByLabel('Phone number').fill('+92 300 4444444'); await page.getByRole('button', { name: 'Save profile changes' }).click(); await page.getByText(/The save result is unconfirmed/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save profile changes' }).isDisabled(), true); assert.equal((await prisma.employee.findUnique({ where: { id: employee.id } })).phone, '+92 300 4444444');
    await page.unroute(`**/api/employees/${employee.id}`); await page.getByRole('button', { name: 'Discard draft and load current profile' }).click(); await page.getByText(/Current profile loaded/).waitFor();
    checked('Committed write with lost response is unconfirmed and cannot silently resubmit');

    await page.goto(origin + '/organization');
    async function createUnit(kind, name) {
      const form = panel('Create organization record'); await form.getByLabel('Record kind').selectOption(kind); await form.getByLabel('Name').fill(name);
      if (kind === 'TEAM') { await form.getByLabel('Department').selectOption({ label: 'Browser Department' }); await form.getByLabel('Campaign').selectOption({ label: 'Browser Campaign' }); }
      await form.getByLabel('Creation reason').fill('Approved browser organization');
      const response = page.waitForResponse(r => r.url() === api + '/organization' && r.request().method() === 'POST'); await form.getByRole('button', { name: 'Save', exact: true }).click(); assert.equal((await response).status(), 201);
      await panel('Organization records').getByRole('heading', { name: `${name} · ${kind}`, exact: true }).waitFor();
    }
    for (const [kind, name] of [['DEPARTMENT', 'Browser Department'], ['CAMPAIGN', 'Browser Campaign'], ['DESIGNATION', 'Browser Engineer'], ['TEAM', 'Browser Team']]) await createUnit(kind, name);
    const managerForm = panel('Assign team manager'); await managerForm.getByLabel('Team').selectOption({ label: 'Browser Team' }); await managerForm.getByLabel('Manager account UUID').fill(users.MANAGER.id); await managerForm.getByLabel('Manager effective from').fill('2020-01-01'); await managerForm.getByLabel('Manager change reason').fill('Approved browser manager');
    await managerForm.getByRole('button', { name: 'Save', exact: true }).click(); await panel('Manager assignment history').getByText(/MANAGER fixture/).waitFor();
    checked('Department, campaign, designation, team and dated manager created through UI');
    await page.goto(origin + `/employees/${employee.id}`);
    const assignmentForm = panel('Change organization assignment'); await assignmentForm.getByLabel('Team').selectOption({ label: 'Browser Team' }); await assignmentForm.getByLabel('Designation / job title').selectOption({ label: 'Browser Engineer' }); await assignmentForm.getByLabel('Effective from').fill('2020-01-01'); await assignmentForm.getByLabel('Assignment change reason').fill('Approved browser employee assignment');
    await assignmentForm.getByRole('button', { name: 'Save', exact: true }).click(); await panel('Employment and assignment history').getByText(/Browser Team · Browser Engineer/).waitFor();
    const legacy=await prisma.employee.create({data:{employeeCode:'LEGACY-LINK',fullName:'Legacy link fixture'}});await page.goto(origin+`/employees/${legacy.id}`);
    const accountForm = panel('Provision or link login account'); await accountForm.getByLabel('Account operation').selectOption('link'); await accountForm.getByLabel('Login email').fill(users.EMPLOYEE.email); await accountForm.getByRole('button', { name: 'Save account linkage' }).click(); await panel('Login account').getByText(/Linked account:/).waitFor();
    checked('Dated employee assignment/history and one-to-one existing account linkage through UI');
    users.EMPLOYEE=await prisma.user.findUnique({where:{email:'onboard-browser@example.invalid'}});await page.goto(origin+`/employees/${employee.id}`);

    const upload = panel('Upload document or replacement'); await upload.getByLabel('Document title').fill('Browser Text'); await upload.getByLabel(/File \(UTF-8/).setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('Private browser fixture content') }); await upload.getByLabel('Visibility').selectOption('true');
    await upload.getByRole('button', { name: 'Upload document' }).click(); await page.getByRole('button', { name: 'Download Browser Text' }).waitFor();
    const transfer = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download Browser Text' }).click(); const download = await transfer; await download.saveAs(path.join(temporary, 'download.txt')); assert.equal(await fs.readFile(path.join(temporary, 'download.txt'), 'utf8'), 'Private browser fixture content');
    checked('Private upload and streamed attachment download through UI');

    await page.goto(origin + '/employees?page=1&pageSize=10&q=Browser&status=ACTIVE'); await page.getByRole('link', { name: 'Browser Employee', exact: true }).filter({ visible: true }).click(); await page.getByRole('heading', { name: 'Browser Employee', exact: true }).waitFor();
    await page.goBack(); await page.getByLabel('Search employees').waitFor(); assert.equal(new URL(page.url()).searchParams.get('q'), 'Browser'); assert.equal(new URL(page.url()).searchParams.get('pageSize'), '10'); await page.goForward(); await page.getByRole('heading', { name: 'Browser Employee', exact: true }).waitFor();
    checked('Directory URL filters survive browser back and forward');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { localStorage.setItem('officehr-theme', t); }, theme); await page.reload(); await page.getByRole('heading', { name: 'Browser Employee', exact: true }).waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
      await page.screenshot({ path: path.join(path.resolve(__dirname,'../../artifacts/final-audit/employee'), `employee-mobile-${theme}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    checked('Mobile detail fits viewport in light/dark themes and supports keyboard focus');

    // Stop and restore only this test's ephemeral API.
    await closeApi(); await page.reload(); await page.getByRole('heading', { name: 'Unable to verify your session' }).waitFor(); server = app.listen(port, '127.0.0.1'); await once(server, 'listening'); await page.getByRole('button', { name: 'Try again' }).click(); await page.getByRole('heading', { name: 'Browser Employee', exact: true }).waitFor();
    checked('Real API outage hides private content; retry restores the cookie session');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/login'); assert.equal((await context.cookies(api)).length, 0);
    await login('MANAGER', '/my-employees'); await page.getByRole('heading', { name: 'Browser Employee · BROWSER-001', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: /Download/ }).count(), 0); assert.equal(await page.getByRole('link', { name: 'Organization', exact: true }).count(), 0);
    await page.goto(origin + '/employees'); await page.getByRole('heading', { name: 'Access restricted' }).waitFor();
    await page.goto(origin + '/dashboard'); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/login');
    await login('EMPLOYEE', '/my-employees'); await page.getByRole('heading', { name: 'Browser Employee · BROWSER-001', exact: true }).waitFor(); await page.getByRole('button', { name: 'Download Browser Text' }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Edit profile', exact: true }).count(), 0);
    checked('Manager/employee navigation, team scope, read-only self-service and permitted document visibility');
    assert.deepEqual(errors, []); checked('No browser runtime errors');
    await fs.writeFile(path.join(path.resolve(__dirname,'../../artifacts/final-audit/employee'), 'browser-results.json'), JSON.stringify({ checks, browser: browser.version(), runtimeErrors: errors, isolatedDatabase: true }, null, 2) + '\n');
  } finally {
    for (const cleanup of [() => browser?.close(), () => vite?.close(), closeApi, () => prisma?.$disconnect(), () => fs.rm(temporary, { recursive: true, force: true }), () => db.cleanup()]) await cleanup();
    console.log('Temporary browser database, private storage and owned processes removed; original Admin unchanged.');
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

