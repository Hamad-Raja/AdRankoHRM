// Run from backend: node --import tsx tests/phase4-browser-check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createIsolatedDatabase, assertTestDatabase } = require("./isolated-db");
const { chromium } = require("../../frontend/node_modules/playwright-core");
const { confirmedPolicy } = require("../src/validation/schedule-readiness.validation");

async function main() {
  const database = await createIsolatedDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_ORIGIN = "http://127.0.0.1:4188";
  assertTestDatabase(process.env.DATABASE_URL);

  delete require.cache[require.resolve("../src/config/prisma")];
  delete require.cache[require.resolve("../app")];

  const prisma = require("../src/config/prisma");
  const app = require("../app");
  const serverClock = require('../src/utils/attendance-clock');
  const originalClock = serverClock.now;
  let serverTime = new Date('2026-01-06T14:00:00Z');
  serverClock.now = () => new Date(serverTime);
  const { hashPassword } = require("../src/utils/password");

  const api = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => api.once("listening", resolve));
  process.env.VITE_API_URL = `http://127.0.0.1:${api.address().port}/api`;

  const frontendRoot = path.resolve(__dirname, "../../frontend");
  const artifacts = path.resolve(__dirname, "../../artifacts/phase4");
  fs.mkdirSync(artifacts, { recursive: true });

  let vite, browser;
  const password = "Phase4-Browser!123";
  const passwordHash = await hashPassword(password);

  // Setup schedule draft and active schedule
  const draft = await prisma.officeScheduleDraft.create({
    data: {
      revision: 1,
      policy: confirmedPolicy,
      reason: "Active schedule for Phase 4 browser verification",
      actorUserId: (await prisma.user.create({
        data: {
          email: "setup-actor@example.invalid",
          displayName: "Setup Actor",
          passwordHash,
          role: "ADMIN",
          mustChangePassword: false,
        },
      })).id,
    },
  });

  await prisma.officeSchedule.create({
    data: {
      draftId: draft.id,
      effectiveFrom: new Date("2025-12-01"),
      startTime: "19:00",
      endTime: "05:00",
      endsNextDay: true,
      policy: confirmedPolicy,
      reason: "Active schedule",
      actorUserId: draft.actorUserId,
    },
  });

  // Create HR user
  const hrUser = await prisma.user.create({
    data: {
      email: "hr-phase4@example.invalid",
      displayName: "HR Officer",
      passwordHash,
      role: "HR",
      mustChangePassword: false,
    },
  });

  // Create Employee user and profile
  const empUser = await prisma.user.create({
    data: {
      email: "emp-phase4@example.invalid",
      displayName: "Tariq Attendance",
      passwordHash,
      role: "EMPLOYEE",
      mustChangePassword: false,
    },
  });

  const empProfile = await prisma.employee.create({
    data: {
      employeeCode: "EMP-P4-001",
      fullName: "Tariq Attendance",
      userId: empUser.id,
      personalEmail: "tariq@example.invalid",
      employmentEpisodes: {
        create: {
          startDate: new Date("2020-01-01"),
          status: "ACTIVE",
          statusEffectiveDate: new Date("2020-01-01"),
        },
      },
    },
  });

  // Seed an existing attendance record for Tariq on 2026-01-05
  const pastRecord = await prisma.attendanceRecord.create({
    data: {
      employeeId: empProfile.id,
      employmentEpisodeId: (await prisma.employmentEpisode.findFirst({ where: { employeeId: empProfile.id } })).id,
      shiftDate: new Date("2026-01-05"),
      scheduledStart: new Date("2026-01-05T14:00:00.000Z"),
      scheduledEnd: new Date("2026-01-06T00:00:00.000Z"),
      scheduleTimeZone: "Asia/Karachi",
      graceMinutes: 30,
      clockInAt: new Date("2026-01-05T14:10:00.000Z"),
      clockOutAt: new Date("2026-01-05T23:45:00.000Z"),
      status: "COMPLETED",
      isLate: false,
      isEarlyDeparture: true,
      workedMinutes: 575,
      clockInRequestId: "seed_clockin_req_001",
      clockOutRequestId: "seed_clockout_req_001",
      clockInActorUserId: empUser.id,
      clockOutActorUserId: empUser.id,
      officeScheduleId: (await prisma.officeSchedule.findFirst()).id,
      scheduleSnapshot: {
        startTime: "19:00",
        endTime: "05:00",
        timeZone: "Asia/Karachi",
      },
    },
  });

  try {
    const { createServer } = await import(
      pathToFileURL(path.join(frontendRoot, "node_modules/vite/dist/node/index.js")).href
    );
    vite = await createServer({
      root: frontendRoot,
      configFile: path.join(frontendRoot, "vite.config.js"),
      server: { port: 4188, strictPort: true, host: "127.0.0.1" },
    });
    await vite.listen();

    const chromePaths = [
      process.env.OFFICEHR_TEST_CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ].filter(Boolean);
    const executablePath = chromePaths.find((file) => fs.existsSync(file));
    if (!executablePath) {
      throw new Error("No installed Chrome or Edge found; set OFFICEHR_TEST_CHROME.");
    }

    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({
      baseURL: process.env.FRONTEND_ORIGIN,
      viewport: { width: 1440, height: 950 },
    });
    const page = await context.newPage();

    async function signIn(user) {
      await page.goto("/login");
      await page.getByLabel("Email address", { exact: true }).fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard");
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    }

    console.log("1. Verifying Employee Dashboard with Duty Clock...");
    await signIn(empUser);
    await page.getByText("Attendance & Duty Clock").waitFor();
    await page.getByText("Official Shift: 19:00 → 05:00 next day (Asia/Karachi)").waitFor();
    await page.screenshot({ path: path.join(artifacts, "01_employee_dashboard_clock.png"), fullPage: true });
    console.log("   -> PASS: Attendance clock widget loaded on Employee dashboard.");

    console.log('1a. Actual punch, committed-but-unreadable response reconciliation, reload and exact checkout...');
    let writes = 0;
    await page.route('**/api/attendance/clock-in', async route => {
      writes++;
      const response = await route.fetch();
      assert.equal(response.status(),200);
      await route.fulfill({ status:200, contentType:'application/json', body:'unreadable' });
    });
    await page.getByRole('button',{name:'Clock In',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.getByText(/Punch outcome is unconfirmed/).waitFor();
    assert.equal(writes,1);
    assert.equal(await prisma.attendanceRecord.count({where:{employeeId:empProfile.id,shiftDate:new Date('2026-01-06')}}),1);
    await page.getByRole('button',{name:'Refresh attendance status',exact:true}).click();
    await page.getByText('Pending punch confirmed from server history.').waitFor();
    await page.unroute('**/api/attendance/clock-in');
    await page.reload();
    await page.getByRole('button',{name:'Clock Out',exact:true}).waitFor();
    serverTime = new Date('2026-01-07T00:15:00Z');
    await page.getByRole('button',{name:'Clock Out',exact:true}).click();
    await page.getByText(/Clock Out confirmed/).waitFor();
    const punched = await prisma.attendanceRecord.findUnique({where:{employeeId_shiftDate:{employeeId:empProfile.id,shiftDate:new Date('2026-01-06')}}});
    assert.equal(punched.clockInAt.toISOString(),'2026-01-06T14:00:00.000Z');
    assert.equal(punched.clockOutAt.toISOString(),'2026-01-07T00:15:00.000Z');
    assert.equal(punched.isAfterScheduleEnd,true);
    assert.equal(writes,1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
    await page.evaluate(()=>{document.documentElement.classList.add('dark');});
    await page.screenshot({path:path.join(artifacts,'08_mobile_dark_punched.png'),fullPage:true});
    await page.evaluate(()=>{document.documentElement.classList.remove('dark');});
    await page.screenshot({path:path.join(artifacts,'09_mobile_light_punched.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:950});
    console.log('   -> PASS: Actual punches, unknown outcome reconciliation without retry, reload, keyboard, mobile and themes.');

    console.log("2. Navigating to Employee Attendance page...");
    await page.goto("/attendance");
    await page.getByRole("heading", { name: "My Attendance", exact: true }).waitFor();
    await page.getByText("My Attendance Records & Requests").waitFor();
    await page.getByText("2026-01-05").waitFor();
    await page.screenshot({ path: path.join(artifacts, "02_employee_attendance_page.png"), fullPage: true });
    console.log("   -> PASS: Attendance history displayed with past duty log.");

    console.log("3. Submitting Attendance Correction Request...");
    await page.getByRole('row').filter({hasText:'2026-01-05'}).getByRole("button", { name: "Correct", exact: true }).click();
    const modal = page.locator("dialog[open]");
    await modal.getByRole("heading", { name: "Request Attendance Correction" }).waitFor();
    await modal.getByPlaceholder("Explain why this correction is needed...").fill("Badge reader missed my exit at 05:00 AM.");
    await modal.getByLabel('Proposed Clock Out (Asia/Karachi)',{exact:true}).fill('2026-01-06T05:00');
    await page.screenshot({ path: path.join(artifacts, "03_correction_modal.png") });
    await modal.getByRole("button", { name: "Submit Correction Request", exact: true }).click();
    await modal.getByText("Correction request submitted successfully!").waitFor();
    console.log("   -> PASS: Correction request submitted.");

    console.log("4. Signing in as HR to review Attendance Management...");
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(hrUser);
    await page.goto("/attendance");
    await page.getByRole("heading", { name: "Attendance Management", exact: true }).waitFor();
    await page.getByRole("button", { name: "Daily Summary", exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, "04_hr_attendance_daily_summary.png"), fullPage: true });
    console.log("   -> PASS: HR Daily summary and attendance metrics loaded.");

    console.log("5. Checking HR Correction Review Queue...");
    await page.getByRole("button", { name: /Corrections/ }).click();
    await page.getByText("Pending Correction Requests").waitFor();
    await page.getByText("Tariq Attendance").waitFor();
    await page.getByText("Badge reader missed my exit at 05:00 AM.").waitFor();
    await page.screenshot({ path: path.join(artifacts, "05_hr_corrections_queue.png"), fullPage: true });

    console.log("6. Approving Correction Request...");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const reviewDialog = page.locator("dialog[open]");
    await reviewDialog.getByRole("heading", { name: "Approve Correction" }).waitFor();
    await reviewDialog.getByPlaceholder("Enter review decision explanation...").fill("Verified against security sign-out sheet.");
    await page.screenshot({ path: path.join(artifacts, "06_hr_review_dialog.png") });
    await reviewDialog.getByRole("button", { name: "Confirm APPROVED" }).click();
    await page.waitForTimeout(1000);
    await page.getByText("No pending correction requests.").waitFor();
    await page.screenshot({ path: path.join(artifacts, "07_hr_after_approval.png"), fullPage: true });
    console.log("   -> PASS: Correction approved and queue updated.");
    const preserved=await prisma.attendanceRecord.findUnique({where:{id:pastRecord.id}});
    assert.equal(preserved.clockOutAt.toISOString(),pastRecord.clockOutAt.toISOString());
    assert.equal(preserved.approvedAdjustment.clockOutAt,'2026-01-06T00:00:00.000Z');
    await page.getByLabel('Correction status',{exact:true}).selectOption('APPROVED');
    await page.getByRole('heading',{name:'Correction decision history',exact:true}).waitFor();
    await page.getByText(/APPROVED: Verified against security sign-out sheet/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).isDisabled(),true);

    console.log('7. Manager UI and backend historical team restrictions...');
    const manager=await prisma.user.create({data:{email:'manager-phase4@example.invalid',displayName:'Manager Fixture',passwordHash,role:'MANAGER',mustChangePassword:false}});
    const unit=(kind,name,extra={})=>prisma.organizationUnit.create({data:{kind,name,actorUserId:hrUser.id,reason:'Browser fixture',...extra}});
    const department=await unit('DEPARTMENT','Browser department'), campaign=await unit('CAMPAIGN','Browser campaign'), designation=await unit('DESIGNATION','Browser role');
    const team=await unit('TEAM','Browser team',{departmentId:department.id,campaignId:campaign.id});
    await prisma.organizationAssignment.create({data:{employeeId:empProfile.id,teamId:team.id,designationId:designation.id,effectiveFrom:new Date('2026-01-01'),actorUserId:hrUser.id,reason:'Browser assignment'}});
    await prisma.teamManagerAssignment.create({data:{teamId:team.id,managerUserId:manager.id,effectiveFrom:new Date('2026-01-06'),effectiveTo:new Date('2026-01-06'),actorUserId:hrUser.id,reason:'One-day browser scope'}});
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await signIn(manager);
    await page.goto('/attendance');
    await page.getByRole('heading',{name:'Team & My Attendance',exact:true}).waitFor();
    await page.getByRole('cell',{name:'2026-01-06',exact:true}).waitFor();
    assert.equal(await page.getByRole('cell',{name:'2026-01-05',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Corrections',exact:true}).count(),0);
    const apiBase=process.env.VITE_API_URL;
    assert.equal((await context.request.get(apiBase+'/attendance/corrections/all',{headers:{Origin:process.env.FRONTEND_ORIGIN}})).status(),403);
    console.log('   -> PASS: Manager sees only authorized shift dates; no HR correction access.');

    console.log("\nALL PHASE 4 BROWSER CHECKS PASSED SUCCESSFULLY!");
  } finally {
    serverClock.now = originalClock;
    if (browser) await browser.close();
    if (vite) await vite.close();
    await new Promise((r) => api.close(r));
    await prisma.$disconnect();
    await database.cleanup();
  }
}

main().catch((err) => {
  console.error("Browser check failed:", err);
  process.exit(1);
});
