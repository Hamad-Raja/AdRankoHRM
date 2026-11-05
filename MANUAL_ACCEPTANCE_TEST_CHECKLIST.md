# OfficeHR manual acceptance checklist

Prepared 2026-11-06. Automated checks passed; this document records the human acceptance still to perform.

## Safe environment

Use a **disposable database**, not the ordinary application at ports 3000/5173. Do not activate attendance, create payroll/leave/corrections, upload personal files or send notifications in AdRankoHRM for these tests.

1. Open PowerShell and run:

   ```powershell
   cd E:\HRM\backend
   npm run acceptance:serve
   ```

2. Open `http://127.0.0.1:4200`. The terminal prints the path to a temporary `accounts.txt`. Read it locally; do not paste its passwords into reports, screenshots or chat. All accounts/data are synthetic. Database creation permission on the local PostgreSQL service and installed locked dependencies are required. If setup fails, report the error; do not reset or seed the normal database.
3. Available accounts: ADMIN (unlinked), HR and HR2 (linked, distinct reviewers), MANAGER (linked, QA Team manager), EMPLOYEE (linked to QA Team), SPARE (unlinked Employee login). `QA-LEGACY` is an unlinked employee profile for linking SPARE. Use separate browser profiles/private windows when comparing roles; do not share cookies between them.
4. Draft policy is present but **inactive**. All writable manual tests below belong to this isolated instance. Normal attendance must remain inactive until a separate approved operational decision.
5. Record the current Karachi calendar month as **M**, a future Monday-Friday date as **D**, and a clean future payroll month as **R**. Avoid mixing a paid-leave date with a day used for clock/correction tests. Some tests intentionally depend on records created in earlier cases.
6. Keep the terminal open. When finished, press Ctrl+C and wait for `Disposable QA database, documents, credentials, cache and listeners removed.` Closing the window forcibly can skip cleanup. If interrupted, report that fact; never delete AdRankoHRM or run a reset to recover.

Each case has a result field. Enter **PASS / FAIL / NOT RUN**, and a short observation. Do not count automated passes as manual passes. Navigation labels are stated alongside canonical routes where useful.

## Authentication and layout

- [ ] **A1 — Signed out, Login `/login`.** Open `/dashboard`, submit an incorrect synthetic password, then correct credentials; click once rapidly twice. Expected: protected destination requires login, failure is safe, one login completes and the correct role dashboard appears. **Result: ____ Notes: ____**
- [ ] **A2 — All roles, header/sidebar.** Log in separately as Admin, HR, Manager and Employee. Open each visible menu and browser back/forward. Expected: correct identity/active navigation; no management menus for Employee/Manager; direct unauthorized management URL is denied. Unlinked Admin gets an honest link-required own-data state. **Result: ____ Notes: ____**
- [ ] **A3 — Employee, Account `/account`.** Try wrong current password and mismatched new confirmation, then a valid change; log out and back in with changed password. Expected: invalid forms do not change credentials; success invalidates prior sessions and new login works. Use only the synthetic account. **Result: ____ Notes: ____**
- [ ] **A4 — Employee, network/session.** Use browser DevTools Offline, reload a protected screen, restore connectivity and Retry. Log out in another tab, then attempt a protected action/refresh. Expected: private content is hidden during verification failure; retry recovers a valid session; invalid session returns to login. **Result: ____ Notes: ____**
- [ ] **A5 — Any role, visual/accessibility.** Test desktop and 390px mobile width, light/dark/system themes, Tab/Shift+Tab, skip link, mobile drawer Escape/backdrop and navigation. Expected: no horizontal overflow, clear focus, dialog focus stays contained, drawer closes correctly and scroll restores. **Result: ____ Notes: ____**

## Employee onboarding, organization and documents

- [ ] **E1 — HR, Employees -> New `/employees/new`.** Create a synthetic employee with unique code/email, required employment fields and inline login credentials; choose an allowed Employee role. Expected: one persisted profile, linked account and employment history after reload; password value is not returned/displayed. Record the synthetic employee ID/code. **Result: ____ Notes: ____**
- [ ] **E2 — New employee, Login.** Sign in with E1 credentials. Try direct Dashboard before changing password, complete required password change, then explicitly open `/dashboard`; log out/in with changed password. Expected: mandatory change blocks other protected flows until complete; own profile/dashboard belongs to E1 and original password no longer works. **Result: ____ Notes: ____**
- [ ] **E3 — HR, New employee.** Repeat E1 code or email, and try incomplete required fields. Expected: readable validation/conflict, no duplicate profile/account or orphan partial creation; entered safe draft fields remain usable. API rollback/concurrency is additionally covered by automated tests. **Result: ____ Notes: ____**
- [ ] **E4 — HR, employee detail.** Edit profile with reason; inspect history and reload. Open same record in two windows, save in the first, then save stale second version. Expected: saved data/history persists; stale write is rejected and explicit reload is required before another write. **Result: ____ Notes: ____**
- [ ] **E5 — Admin, `QA-LEGACY` detail -> existing account link.** Link SPARE login to the unlinked profile. Reload and log in as SPARE. Expected: one-to-one linkage and own dashboard; already-linked/elevated accounts cannot be reassigned through this form. Do not unlink or alter real accounts. **Result: ____ Notes: ____**
- [ ] **O1 — HR, Organization `/organization`.** Create synthetic department, campaign, designation and team; assign the Manager and E1 with explicit dated effective records and reasons. Inspect history. Expected: dated records persist, mandatory reasons validated, earlier history remains available. **Result: ____ Notes: ____**
- [ ] **O2 — HR then Manager, organization/`/my-employees`.** Move E1 to another team from a later date; change Manager ownership with effective date. Compare report dates before/after the boundary. Expected: historical scope follows dated assignment; Manager sees permitted own/team fields only, with no payroll/private HR data. **Result: ____ Notes: ____**
- [ ] **D1 — HR, employee detail -> Documents.** Upload a small synthetic `.txt` and valid `.png`, select permitted visibility, download and compare contents. Expected: attachment download through authenticated API, retained metadata and private storage; no publicly accessible storage URL. **Result: ____ Notes: ____**
- [ ] **D2 — Employee/Manager, scoped employee detail.** Try allowed document, HR-private document and another employee's copied document link. Expected: only explicitly authorized visibility succeeds; modified IDs do not bypass authorization. Do not use real file IDs. **Result: ____ Notes: ____**
- [ ] **D3 — HR, upload validation.** Try a file exceeding 5 MiB, unsupported PDF/executable, renamed invalid PNG and empty invalid content. Expected: supported content restrictions enforced without creating a usable invalid attachment. Current upload formats are text and validated PNG, not arbitrary office documents. **Result: ____ Notes: ____**

## Settings and attendance

- [ ] **T1 — HR, Attendance Settings `/attendance-settings`; Employee, Attendance `/attendance`.** Inspect/save inactive draft, reload and inspect employee summary. Expected: Karachi, Mon-Fri 19:00-05:00 next day, 30-minute grace, weekends off, no breaks; setup-required/unknown status with no false absence or clock action. Saving draft does not activate it. **Result: ____ Notes: ____**
- [ ] **T2 — HR, Settings -> company holidays.** Announce a future weekday D with reason, reload, cancel with reason and inspect history. Expected: revision history remains; cancel does not delete history or recreate schedule. An Announcement of type holiday alone does not create a company-holiday event. **Result: ____ Notes: ____**
- [ ] **T3 — HR, isolated Settings -> Activate.** Only at port 4200, select an explicit test effective date/draft and confirm. Expected: separate deliberate activation, date validation and future-start status when appropriate. Never do this in the normal instance. Record selected date: ____. **Result: ____ Notes: ____**
- [ ] **T4 — Employee, isolated Attendance.** When the actual Karachi time is within an eligible 19:00-05:00 duty, Clock In then Clock Out; rapidly double-click and refresh. Expected: at most one punch per request/session, server times and shift-start date, raw elapsed duration with no break deduction. At 02:00 Saturday, Friday's duty remains Friday; weekend starts are off. Outside the window, expect a reasoned unavailable state. **Result: ____ Notes: ____**
- [ ] **T5 — Employee then HR, attendance history/corrections.** For a suitable synthetic date/record submit a reasoned correction; test cancel/Escape/reopen, duplicate submit, review/approve/reject from HR. Expected: form starts for selected record, one request, restricted review, preserved raw punch plus explicit approved adjustment/history. **Result: ____ Notes: ____**
- [ ] **T6 — HR/Employee, summary, report and dashboard.** Compare one selected duty date across all screens, including setup/off/holiday/paid-leave/no-clock states and missing checkout when eligible. Expected: matching classification, overnight ownership by start date, no invented punches or automatic payroll deduction. **Result: ____ Notes: ____**

Do not change your PC clock or add an HTTP clock override to simulate boundaries. Exact grace/month/weekend, missing-checkout and approval-versus-clock concurrency are executed by internal controlled-clock tests. To rerun those checks safely:

```powershell
node --import tsx --test --test-concurrency=1 tests/attendance.integration.test.js tests/leave.integration.test.js
```

Mark time-dependent manual cases NOT RUN if the real window is unavailable; automated coverage is separately recorded in the technical report.

## Leave and cross-module behavior

- [ ] **L1 — Employee, Leave `/leaves`.** In a clean month choose a future eligible duty date (after isolated schedule activation), submit one full paid day and reason. Expected: pending reserves the month's one slot; another date in that month is blocked. No half-day/unpaid/extra/carry-forward controls. If inactive, setup error is honest. **Result: ____ Notes: ____**
- [ ] **L2 — HR then HR2, Leave review.** HR submits their own leave; attempt self-review, then review with HR2. Review Employee request separately. Expected: only distinct HR can approve/reject; Admin or Manager authority alone does not bypass HR-only review. Reasons/history preserved. **Result: ____ Notes: ____**
- [ ] **L3 — Employee/HR, Leave.** Withdraw a pending request, resubmit within that clean slot, reject with HR, and test permitted cancellation of a future approved leave. Expected: correct allowance release/reuse, version conflict safety, no retrospective cancellation that destroys history. **Result: ____ Notes: ____**
- [ ] **L4 — Employee/HR, notifications -> leave -> Attendance -> Payroll.** Approve a clean future request, follow its notification, inspect that date in reports/summary and compare existing payroll inputs. Expected: scoped notification/exact destination, paid-leave classification when applicable, no fabricated clock record or changed payroll days/money. **Result: ____ Notes: ____**
- [ ] **L5 — Employee, next calendar month selection.** Compare this month's reserved/used slot with another month. Expected: separate monthly allowance, unused day expires without accumulation. **Result: ____ Notes: ____**

## Salary, payroll, payment and payslip

- [ ] **P1 — HR, Payroll `/payroll` -> Salary.** Set synthetic E1 basic PKR 44,000 effective R, add a later revision with reason, reload history and select each period. Expected: dated append-only salary version, correct effective selection; no automatic changes from attendance/leave. **Result: ____ Notes: ____**
- [ ] **P2 — HR, payroll preview/draft for clean R.** Enter payable 22, worked 20, earning 1,000 and deduction 250. Expected: basic earned 40,000, net 40,750; preview/create/reload agree. Edit worked to 20.5: earned 41,000, net 41,750. Test zero worked separately, recording explicitly entered adjustments. **Result: ____ Notes: ____**
- [ ] **P3 — HR, salary/payroll in two windows.** Change applicable salary version after opening preview, or save draft in one window before the other. Expected: stale salary/version rejected; no silent approval/payment of an outdated amount, explicit reload/review required. **Result: ____ Notes: ____**
- [ ] **P4 — HR then Admin, approval.** HR approve a correct draft; attempt Admin action as HR, then open same record as Admin and approve. Test reasoned return-to-draft where offered before final approval. Expected: DRAFT -> HR_APPROVED -> APPROVED; distinct final Admin, correct history, frozen final finances. **Result: ____ Notes: ____**
- [ ] **P5 — Admin, approved payroll -> Record payment.** Record one full manual payment with safe synthetic reference; double-click/retry and attempt duplicate. Expected: single atomic payment, PAID, no partial/double payment. This records an event; it sends no money. **Result: ____ Notes: ____**
- [ ] **P6 — Employee, My payslips `/my-payslips`.** Open own final R, compare exact totals; Print -> Save as PDF. Try another synthetic employee's payslip ID; check Manager own payslip versus team member payslip. Expected: own final documents only, no draft/private management fields; legible PDF/mobile layout; foreign financial access denied. **Result: ____ Notes: ____**
- [ ] **P7 — HR/Employee, Leave and Attendance after P5.** Make an allowed unrelated leave/correction change; re-open paid payslip. Expected: approved financial snapshot/payment unchanged; any new salary revision remains append-only. **Result: ____ Notes: ____**

## Announcements and private notifications

- [ ] **N1 — HR/Admin, Announcements `/announcements`.** Create plain-text draft including `<b>QA</b>` and a suspicious link-like string; preview and reload without publishing. Expected: draft not delivered; text stays literal, no executed HTML/unsafe link. Explicitly publish to a selected synthetic team/audience. **Result: ____ Notes: ____**
- [ ] **N2 — Employee/HR, announcement readership.** Read as included Employee, then change team membership and compare included versus excluded users. Expected: recipients frozen at publication; no new audience from later moves, protected published history. Reader/management receipts agree. **Result: ____ Notes: ____**
- [ ] **N3 — HR, expiry/archive.** Set a near-future valid expiry on a test draft before publication; wait for expiry, inspect banner/inbox and archived management history. Archive another published item. Expected: expiry/archive removes active presentation without deleting history or leaking content. If wait is impractical mark NOT RUN; automated expiry tests remain separate. **Result: ____ Notes: ____**
- [ ] **N4 — Employee, Notifications `/notifications` and bell.** Toggle unread/all, paginate if available, mark one/all read, clear using offered action and reload. Read linked announcement from inbox and from banner in separate trials. Expected: own-only consistent counts, safe read synchronization, published receipt history retained after inbox clear. **Result: ____ Notes: ____**
- [ ] **N5 — Employee/HR/Admin, workflow event routing.** Follow notifications produced by leave review, attendance correction and payroll cases. Expected: correct recipient and exact resource; generic message avoids private reason/salary leakage; repeated action/retry produces no duplicate event. **Result: ____ Notes: ____**
- [ ] **N6 — Two roles, account switch/hidden tab.** Leave inbox open, hide tab, restore; log out and sign in as another synthetic user. Rapidly change filters. Expected: no previous user's messages or stale filter results; hidden-tab polling pauses and visible state refreshes. Never publish real messages for this check. **Result: ____ Notes: ____**

## Dashboard, reports and exports

- [ ] **R1 — All four roles, Dashboard `/dashboard`.** Compare selected periods/counts with their permitted underlying lists; follow every card/action. Expected: correct role-specific destinations, setup/unknown distinguished from zero, no unauthorized aggregate/private data. Admin is deliberately unlinked; linked accounts have own widgets. **Result: ____ Notes: ____**
- [ ] **R2 — Any linked role, one widget network failure.** With DevTools request blocking, block only one dashboard data request and refresh; then unblock/retry. Expected: local widget error, independent widgets remain usable, recovery without stale other-account content. Do not stop the normal API or change production settings. **Result: ____ Notes: ____**
- [ ] **R3 — Admin/HR, Reports `/reports`.** Choose month/name/status, Apply, change an unapplied filter and inspect export controls; navigate pages/back/forward. Expected: displayed result matches applied filters, export disabled while dirty, correct totals and disabled pagination at boundaries. Small fixtures may have one page; the automated reports runner separately tests 27 employees/two pages. **Result: ____ Notes: ____**
- [ ] **R4 — HR, Reports exports.** Use a synthetic employee name beginning `=2+3`; export filtered CSV and XLSX, open with a spreadsheet viewer in protected mode. Expected: literal text, no evaluated formula, correct scope/period, no private leave reasons. Do not enable macros or external content. **Result: ____ Notes: ____**
- [ ] **R5 — Manager then Employee, Reports.** Compare dated team selection with own-only view; alter an employee ID to another synthetic employee. Expected: Manager only permitted dated team/own data and no financial/private HR fields; Employee own-only; foreign override denied by API. **Result: ____ Notes: ____**
- [ ] **R6 — Any role, mobile/themes/keyboard.** Repeat key dialogs, reports filters, notification navigation and payslip at narrow width in light/dark/system, using keyboard only. Expected: visible labels/focus, usable controls and no clipped financial totals or horizontal page overflow. **Result: ____ Notes: ____**

## Completion and issue reporting

- [ ] Record each NOT RUN separately; do not declare full acceptance while material workflow failures remain. **Result: ____ Notes: ____**
- [ ] Log out, close test tabs, Ctrl+C the acceptance terminal and wait for cleanup confirmation. Port 4200 should stop serving; generated credential/document directory is removed. Normal attendance remains unactivated. **Result: ____ Notes: ____**
- [ ] Keep production approval separate: attendance effective date, HTTPS/origins/cookies/secrets, storage access, backup/restore, dependency risk decision, deployment/rollback and monitoring. Automated/manual success alone does not approve release. **Result: ____ Notes: ____**

Issue template:

```text
Case ID / title:
Role and synthetic account label (no password):
Disposable environment URL and Karachi date/time:
Exact steps and safe synthetic record code:
Expected behavior:
Actual behavior / safe error code:
PASS / FAIL / NOT RUN:
Screenshot and browser console error, if useful:
Did cleanup complete?:
```

Redact passwords, cookies, CSRF/session tokens, connection strings and personal data. Screenshots should contain only synthetic fixtures. Report an interrupted cleanup explicitly; do not attempt broad database or process deletion.
