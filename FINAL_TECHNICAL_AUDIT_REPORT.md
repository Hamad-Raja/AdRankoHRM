# OfficeHR final integrated technical audit

Date: 2026-11-06. Workspace: `E:\HRM`.

## Status

The executed automated acceptance checks pass after the corrections below. The application is ready for **human acceptance testing in the disposable environment**, not certified production-ready. Normal attendance remains inactive: one draft, zero active office schedules. No real activation date was selected.

Final results: **261/261 backend tests**, **11/11 frontend utility tests**, **108 passing browser scenario groups across 10 distinct suites**, and **12/12 standalone migration/database smoke checks**. Backend and utility test runs have zero failed, cancelled, skipped or TODO tests. Browser runners completed their scenario assertions and runtime-error checks. Lint has **16 warnings, zero errors**, down from 20 warnings. Six frontend development-dependency package findings remain, representing two underlying advisories; production-dependency and backend audits report zero findings.

No normal-data writes, migration application, migration edits, account changes, notifications, salary/payment records, attendance activation, resets, seeds, major upgrades, external messages, staging, commits, pushes or deployment were performed by this audit.

## Baseline and evidence

Applicable repository/ancestor `AGENTS.md` discovery found none. Current source, scripts, migration SQL, ignore diagnostics and previous completion documents were inspected; old reports were not counted as executed verification. Initially both `node_modules` directories were missing. Commands that initially failed for missing dependencies are not passes. Exact lockfile installations used `npm ci --no-audit --no-fund` in backend and frontend; no dependency upgrade was part of restoration.

Newly executed baseline: backend 258/258 passed; frontend lint 20 warnings, zero errors. Original read-only inventory covered 27 public business tables and 12 applied migrations. The initial audit status was clean; a subsequent existing Git commit reinstated blanket test-directory ignores. The final correction removes those exclusions without resetting that commit or staging files.

Generated evidence is deliberately ignored under `artifacts/final-audit/`. It includes baseline/final test logs, browser logs, audit JSON, hashed database inventories, migration checks and benchmark results. These local artifacts are not release source and must not be published wholesale. No real row contents or credential values are included in this report.

## Confirmed problems and corrections

| Trigger / root cause | Correction and verification |
| --- | --- |
| Daily summary queried employment/legacy assignment information per employee: 87 Prisma model calls for 40 employees. Separate classification logic could disagree with dated report employment/setup states. | Batched reads and keyed lookups in `backend/src/services/attendance.service.js`; reuse the existing pure report classifier. Added dashboard/report/summary consistency assertions, including inactive policy and future/exited/no-episode states. Reject oversized summaries rather than returning partial results. Final focused 32 tests and complete 261 tests pass. |
| Attendance lists accepted an extreme page number, allowing unnecessary offsets. Reproduced response was 200, not a claimed server crash. | Common attendance pagination validation caps page at 10,000 and page size at 100. New regression checks three list endpoints reject an excessive page with validation error before database pagination. |
| `--trace-deprecation` showed Prisma scheduling relation reads concurrently on one interactive PostgreSQL transaction connection. | New `serialized-pg.js` adapter wrapper queues SQL operations per transaction, including rollback after a rejected operation. Pool queries and separate transactions remain concurrent. Two regression tests cover these properties. Dashboard plus driver tests pass 17/17; final complete log contains no pg concurrency deprecation. Existing UTC session option remains intact. No dependency patching or warning suppression. |
| Redundant initial auth loading updates; clock refresh sources could overlap and retain prior account state. | Separate initial session verification from explicit refresh loading. Key clock state by account, coalesce status reads, abort on unmount and ignore aborted results. Retain session request versions, punch request IDs, write locks and uncertain-outcome reconciliation. Core, connection and attendance browser checks pass. |
| Correction form reset depended on an effect; duplicate same-event submissions needed a synchronous lock. | Key/mount the dialog per open record and initialize form at mount; use a submit ref. Browser testing caught and corrected an introduced StrictMode cleanup-close problem. Final attendance browser suite passes; original punches remain immutable. |
| Notification filter/account transitions could display prior-query state. | Key results to owner/filter/page; abort obsolete reads and derive loading from query identity. Preserve action reconciliation and explicit errors. Announcement/inbox and dashboard browser suites pass. |
| Blanket ignore rules hid required tests and fixtures; several older browser sources lived inside ignored artifacts. | Keep test source includable; retain generated results, dependencies, private storage, environments and inventories as ignored. Move canonical employee, schedule and connection browser sources to `backend/tests/`; repair imports/output paths and package scripts. Update stale selectors for current onboarding/password-change and unlinked-dashboard behavior without weakening assertions. |
| Reports lacked equivalent integrated download coverage. | New reports browser suite checks 27 employees across two pages, applied/dirty filters, downloaded CSV and actual XLSX contents, formula protection, Manager/Employee scope, mobile/themes/keyboard. Eight scenario groups pass. |
| Frontend toolchain included vulnerable body-parser 2.3.0. | Reviewed compatible transitive update to 2.4.0 inside the existing 2.x range. One lockfile package changed. Final frontend build and production-dependency audit pass. Details below. |

No account-management privilege redesign was made. Existing legacy profile APIs can represent an employee without a portal account; current onboarding UI requires inline account creation. Existing account linking remains supported for an eligible unlinked profile/account. That distinction is preserved, not silently treated as a new permission rule.

## Workflow and security review

Frontend forms/services were traced through route validation, session/role/ownership checks, transactional services and public response formatting. Browser results below exercise real UI/API/database paths; backend tests also exercise forged requests and concurrent transactions that cannot be established by hidden buttons alone.

| Area | Checks / preserved behavior |
| --- | --- |
| Authentication | Cookie sessions, safe return paths, CSRF/trusted origin, password hashing and Unicode limits, mandatory password change, disabled/revoked sessions, logout and all-session invalidation; private UI hidden during session/network failure. No browser token storage introduced. |
| Employees and account provisioning | Persisted profile/episode/status event, optimistic versions and uncertain-response locks, duplicate email/code, transactional rollback/no orphan, inline credentials and first-login change, supported existing-account link. Admin/HR permissions and current role restrictions preserved; Employee/Manager cannot elevate through request fields. |
| Organization | Dated team membership and Manager ownership, current/historical scope, employee moves, audit actor/reason, no organization-wide financial/private fields in Manager responses. |
| Documents | Private storage outside public roots, UUID storage paths, authenticated streamed attachments, owner/team/HR visibility, size/type/content validation and safe path handling. Supported uploads are validated text and PNG, maximum 5 MiB; this is not a general PDF/document upload service. Production storage permissions/backups remain operational work. |
| Settings/attendance | Karachi Mon-Fri shift-start dates, 19:00-05:00 overnight, weekend starts off, 30-minute grace, no break deduction. Draft versus activation separated; holiday revision history retained. Active schedule, Friday/weekend/month edges, duplicate/concurrent punches, missing checkout and correction review exercised only in isolated DBs. Raw punches are not fabricated by summary classification. Server time is authoritative; controlled clocks are internal test seams, not client/HTTP inputs. |
| Leave | One full paid day per calendar month; pending reservation, one-slot concurrency, HR-only distinct review, self-review rejection, withdrawal/future cancellation and leave-versus-clock races. No half/unpaid/extra/carry-forward allowance or automatic payroll mutation. |
| Payroll | Calendar month, fixed PKR basic salary, manually supplied payable/worked days, integer-paisa rounding, fractional/zero days and adjustments. Salary versions/stale revisions, HR then distinct Admin approval, immutable approved snapshot and atomic full manual payment. Own final payslip/printable PDF; Manager team access excludes others' finances. Payment recording does not transfer money. No tax/overtime/automatic attendance or leave deductions added. |
| Announcements/inbox | Explicit publication, frozen recipients, immutable published history, expiry/archive and read synchronization, plain-text content, private owner-scoped inbox, generic event messages, transaction rollback/deduplication, mark-all cutoffs, membership/account changes and hidden-tab polling. No external messages. |
| Dashboards/reports | Four roles; scoped counts/periods/destinations, unlinked/setup/unknown versus zero, independently failing widgets, filtered/paginated reports and CSV/XLSX output. Foreign employee IDs and caller-supplied privileged fields are tested at backend boundaries. Exports escape formula-like text; downloaded workbook inspected for formulas/macros/external links. |

These checks establish the tested cases, not a penetration-test certification or proof against every possible attack. No confirmed unresolved authorization failure was observed in the executed suites.

## Executed verification

Commands below are relative to `E:\HRM\backend` unless frontend/root is specified. Final application changes were exercised by the complete backend run and affected browser suites. Later changes only add package aliases, manual QA fixtures, query-plan evidence and ignore/documentation changes; their direct checks were executed separately.

| Command | Actual result |
| --- | --- |
| `npm test` baseline / final | 258/258 -> 261/261; final 0 failed/cancelled/skipped/TODO, 120.10 seconds |
| `node --import tsx --test --test-concurrency=1 tests/attendance-pagination.test.js tests/dashboard.integration.test.js tests/attendance.integration.test.js` | 32/32 passed, zero failures/skips |
| `node --trace-deprecation --import tsx --test tests/dashboard.integration.test.js` | Initial trace identified the transaction call site; retained as diagnostic evidence |
| `node --import tsx --test tests/pg-serialization.test.js tests/dashboard.integration.test.js` | 17/17 passed; no pg deprecation after correction |
| Frontend: `node --test tests/reports.test.mjs` | 11/11 passed; zero failures/skips |
| Frontend: `npm run lint` | Exit 0, 16 warnings, zero errors |
| Frontend: `npm run build` | Passed after compatible dependency patch; main JS 449.03 kB / gzip 126.50 kB, no chunk size warning |
| Root: `npm --prefix backend run check` | Passed |
| `node --check` over backend JS/CJS source/tests | Final sweep: 108 files, zero syntax failures, including the final attendance route and updated manual/benchmark tools |
| `npx prisma validate --config prisma7.config.ts` | Valid schema |
| `npx prisma migrate status --config prisma7.config.ts` | 12 migrations; up to date |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma7.config.ts` | No difference, exit 0; read-only comparison |
| `node tests/phase3-database-check.cjs` | 12/12 smoke checks; disposable database removed |
| `node --import tsx tests/manual-acceptance.cjs --smoke` | Final six-account environment served health/UI successfully, then removed its DB, credentials, documents, cache and listeners |
| `node tests/payroll-preservation.cjs ../artifacts/final-audit/normal-before.json` | All 27 original tables unchanged; all 12 applied SQL checksums match; zero temporary databases |

Browser commands all use `node --import tsx tests/<file>`:

| File / npm alias | Passing scenario groups | Key evidence |
| --- | ---: | --- |
| `browser-check.cjs` / `test:browser` | 12 | Auth, password restriction/logout, return routes, shared layout, responsive/themes/keyboard |
| `employee-browser-check.cjs` / `test:phase2-browser` | 12 | Create/edit persistence, conflict/lost-response handling, org/linking, private upload/download, first-login change and login with changed password |
| `schedule-browser-check.cjs` / `test:schedule-browser` | 8 | Draft reload, separate isolated activation, holiday/cancel history, roles/mobile/themes |
| `phase4-browser-check.cjs` / `test:phase4-browser` | 7 | Clock/corrections, locks/reconciliation, scoped UI and setup states |
| `payroll-browser-check.cjs` / `test:payroll-browser` | 11 | Revisions, preview/edit, approvals/payment, own payslip and generated PDF |
| `announcements-browser-check.cjs` / `test:announcements-browser` | 15 | Publication, frozen recipients, private inbox and read/account/polling behavior |
| `leave-browser-check.cjs` / `test:leave-browser` | 13 | Monthly reservation/review/withdrawal/cancel and scoped navigation |
| `dashboard-browser-check.cjs` / `test:dashboard-browser` | 15 | Four-role summaries, exact links, independent errors and privacy |
| `connection-browser-check.cjs` / `test:connection-browser` | 7 | Reachability, session outage/retry, roles and responsive behavior |
| `reports-browser-check.cjs` / `test:reports-browser` | 8 | Two-page fixture, real downloads, formula checks and role scope |
| **Total** | **108** | Zero asserted browser runtime errors; each runner completed cleanup |

The old common-schedule artifact script is a compatibility alias for the executed readiness/schedule suite, not an additional independent suite. Focused/backend/browser counts overlap in coverage and must not be added into a fictitious unique test total. No human manual acceptance is claimed completed.

## Lint and maintainability limits

Warnings fell from 20 to 16 without disabling rules or adding timers/microtasks to disguise effects. Four remaining Fast Refresh warnings concern mixed public exports in `auth-context.jsx`, `theme-provider.jsx`, `ui/button.jsx`, `ui/badge.jsx`. Existing import contracts were preserved. An experimental export split was reverted because it did not resolve the warnings with those contracts intact.

Twelve remaining effect-state warnings: announcement banner (1), notification bell (1), attendance history (1), leaves page (2), attendance page (3), announcements page (2), payroll page (2). They concern existing request/reset effects. Broader state refactors were deferred to avoid changing verified stale-response, write-lock and reconciliation behavior in this audit. Passing regression coverage does not make the warnings resolved. They remain maintenance work, not observed blockers to tested workflows.

## Dependency triage

Executed `npm audit --json` in both projects and frontend `npm audit --omit=dev --json`; repeated frontend audits after remediation. Backend: 0. Frontend initially: 7 affected package entries (2 low, 4 moderate, 1 high). Final: **6 entries (2 low, 4 moderate), 0 high/critical**. Frontend production-dependency audit: 0 before and after. Package counts include inherited parent entries; they are not six independent advisories.

Authoritative advisory details were checked against GitHub's advisory database:

| Advisory | Installed / affected versions and path | Exploit conditions / remediation |
| --- | --- | --- |
| [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), body-parser, high; **resolved** | 2.3.0 -> 2.4.0. Affected 2.x range >=2.0.0 <2.4.0 (separate 1.x fix 1.20.9). `shadcn@4.22.1 -> @modelcontextprotocol/sdk@1.32.1 -> express@5.3.0 -> body-parser`. | Compressed request body plus trailing bytes can cause an uncaught decoder error/DoS when served by the affected parser. Tooling servers must not be presumed harmless. `npm update body-parser --ignore-scripts --no-audit --no-fund` selected the supported 2.4.0 patch, changing one frontend lockfile entry. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), minimatch, moderate; **remaining** | 10.2.6; affected >=7.0.0 <11.0.1. `shadcn@4.22.1 -> ts-morph@26.0.0 -> @ts-morph/common@0.27.0 -> minimatch`. | Untrusted glob plus optimizationLevel >=2 can amplify preprocessing/consume CPU and memory. Advisory fix 11.0.1 is outside the installed parent's ^10.0.1 range. Review a supported upstream parent release before updating; no forced major, override or downgrade applied. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), deepmerge, low; **remaining** | 4.3.1; affected >=4.2.0 through current 4.3.1. `shadcn@4.22.1 -> deepmerge` and `shadcn -> @shadcn/registry@0.2.0 -> deepmerge`. | Untrusted source keys can poison the returned merged object's prototype; this is not a claim of global Object.prototype pollution. Advisory has no patched release. Avoid untrusted merge inputs; evaluate supported upstream removal/replacement/fix. |

The six remaining package entries are minimatch 10.2.6, @ts-morph/common 0.27.0, ts-morph 26.0.0, deepmerge 4.3.1, @shadcn/registry 0.2.0 and shadcn 4.22.1. Parent findings inherit the two advisories above. npm's generic fix suggestion is not evidence of a safe parent update; no unreviewed downgrade was accepted.

`shadcn` is correctly in devDependencies, but **its CSS is used** by `@import "shadcn/tailwind.css"`; removing it as allegedly unused would break the build. No shadcn CLI JS entry is imported into application runtime or invoked by the checked build script. That limits observed runtime reachability, but untrusted registry/config/glob inputs or an exposed CLI/MCP server remain developer/CI attack paths. Do not expose these services or run untrusted code-generation inputs. Reclassification does not remediate vulnerabilities. Record a toolchain risk decision and revisit supported upstream fixes before release. No claim that future compatible parent fixes cannot exist is made.

The backend's already-existing express/body-parser override was not introduced or changed by this audit. No new override or forced audit fix was used.

## Measured performance and limits

Daily-summary fixture: 40 synthetic active employees, isolated active policy, no punches. Three samples each, measuring Prisma model calls and whole service duration:

| Measurement | Before | After |
| --- | --- | --- |
| Queries each run | 87 | 7 |
| Elapsed ms, three samples | 146.13 / 67.42 / 63.92 | 71.20 / 11.28 / 11.02 |
| Median ms | 67.42 | 11.28 |

A later final run still used seven queries but measured 227.47 / 38.16 / 41.23 ms while other verification was active. Thus the stable result is elimination of per-employee SQL; the small local timing sample is not a production SLA, p95 or load-test claim. No real database was load-tested.

`attendance-summary-benchmark.cjs` optionally records index metadata and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in its disposable DB. Actual attendance date lookup used `attendance_records_shiftDate_idx`; execution 0.049 ms on **zero attendance rows**, so it establishes index availability, not production selectivity. Employee/date uniqueness, unresolved-session constraint, holiday revision uniqueness, leave monthly-slot/status/date, payroll month/status and inbox-owner/read indexes were inspected. No evidence justified an index migration.

Clock status now shares simultaneous refresh reads and aborts abandoned reads; inbox requests use query identity. Existing hidden-tab polling and independent dashboard loading were verified. No new cross-user cache was introduced. Summary reads now reject oversized datasets; paginated endpoints reject extreme offsets. Existing lazy chunks for payroll, leave, announcements and notifications were retained; no speculative bundle redesign or unrelated dependency removal. Browser runners and manual smoke close listeners, timers/cache owners, API connections and Prisma clients; final cleanup checks are below.

## Database preservation and cleanup

All writes used generated guarded disposable databases. The helper rejects AdRankoHRM and arbitrary database names; fixtures apply existing migration SQL only to a newly created generated target. The ordinary database was queried in read-only transactions for inventories/status/diff. No additive migration was necessary.

Final hash comparison: **all original rows in all 27 public business tables unchanged**, including original Admin/accounts, sessions, employee/organization/employment records and audit history. All **12 applied migration file checksums match** their stored checksums; schema diff is empty. Holiday revision unique index exists. Normal attendance draft/activation counts remain 1/0.

After the final fixture runs, preservation was repeated. Temporary databases matching the test naming family: **0**. No test listeners remain on 4179, 4181, 4183, 4188, 4190, 4195, 4196, 4197, 4199 or 4200. Each browser runner reports its owned API/cache/storage/download cleanup. Manual QA smoke confirms deletion of its temporary credentials, documents, cache and database. Existing ordinary ports/processes were not killed. A hard-killed future human-QA process still requires cleanup investigation; do not delete a normal database to recover it.

## Files and canonical structure

Meaningful application corrections: `backend/src/config/prisma.js`, new `backend/src/utils/serialized-pg.js`, `backend/src/services/attendance.service.js`, `backend/routes/attendance.routes.js`; frontend `src/context/auth-context.jsx`, `src/components/attendance-clock.jsx`, `src/components/attendance-correction-modal.jsx`, `src/pages/notifications-page.jsx`; `frontend/package-lock.json` compatible patch.

Verification/maintenance: `.gitignore`, `backend/package.json`; new focused `pg-serialization.test.js`, `attendance-pagination.test.js`, summary benchmark and report-browser runner; dashboard integration assertions; relocated/adapted employee, schedule and connection browser runners; new `manual-acceptance.cjs`; these two documents. Required existing test/fixture files are now includable rather than hidden by directory exclusions. `git check-ignore -v` confirms test source is not ignored while backend `.env`, private storage and artifact inventories remain ignored. No files were staged.

Canonical shared layout directory: **`E:\HRM\frontend\src\layout`**, containing `portal-layout.jsx`, `portal-header.jsx`, `portal-sidebar.jsx`. Backend auth routes: **`E:\HRM\backend\routes\auth.routes.js`**. Actual working structure is preserved; no move to earlier suggested alternative directories.

## Startup and remaining decisions

For disposable acceptance, run from backend:

```powershell
npm run acceptance:serve
```

Open `http://127.0.0.1:4200`. Read synthetic credentials from the local file path printed by the runner; passwords are not logged. Admin, HR, HR2, Manager, Employee and spare Employee accounts are provided, plus an unlinked legacy employee for account-link testing. Attendance initially stays inactive. Keep that terminal open; Ctrl+C and wait for cleanup confirmation. See the separate checklist before creating requests or financial records.

Ordinary application startup, only when intentionally using the normal environment: run `npm run dev` once in `E:\HRM\backend` and once in `E:\HRM\frontend`. Existing config uses backend port 3000 and frontend strict port 5173. If a port is occupied, identify the existing process and reuse/stop the intended instance; do not start duplicates or kill unrelated services. Do not use the ordinary database for this checklist's fixture writes.

No confirmed product defect from the executed cases blocks continued module development or disposable manual acceptance. Remaining limits: 16 lint warnings, six development-toolchain package findings, finite fixture/browser coverage and human acceptance not yet performed. The development advisories require controlled inputs and a tracked upstream remediation/risk decision; they are not evidence that runtime is exploitable, nor an automatic waiver.

Production release still requires human acceptance, an explicitly approved attendance activation date, production secrets/cookie/HTTPS/origin configuration, service/storage permissions, tested backup and restore, dependency risk disposition, capacity monitoring and a reviewed deployment/rollback process. None of those operational decisions was invented or executed here.
