'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const {
  createIsolatedDatabase,
  assertTestDatabase,
} = require('./isolated-db');

test(
  'Reports API and exports in a guarded disposable PostgreSQL database',
  { timeout: 180000 },
  async t => {
    const database = await createIsolatedDatabase();

    let prisma;
    let server;

    try {
      process.env.DATABASE_URL = database.url;
      process.env.NODE_ENV = 'test';

      assertTestDatabase(process.env.DATABASE_URL);

      prisma = require('../src/config/prisma');

      const app = require('../app');
      const { hashPassword } = require('../src/utils/password');
      const {
        ALLOWED_ORIGINS,
      } = require('../src/config/auth');

      const password = 'Reports-fixture!123';
      const passwordHash = await hashPassword(password);

      let counter = 0;

      async function user(role, extra = {}) {
        return prisma.user.create({
          data: {
            email: `reports-${++counter}@example.invalid`,
            displayName: `Report ${role} fixture`,
            passwordHash,
            role,
            mustChangePassword: false,
            ...extra,
          },
        });
      }

      const admin = await user('ADMIN');
      const hr = await user('HR');
      const manager = await user('MANAGER');

      const accountA = await user('EMPLOYEE');
      const accountB = await user('EMPLOYEE');

      const forced = await user('EMPLOYEE', {
        mustChangePassword: true,
      });

      const at = date =>
        new Date(`${date}T00:00:00.000Z`);

      async function employee(account, code, fullName) {
        const result = await prisma.employee.create({
          data: {
            userId: account.id,
            employeeCode: code,
            fullName,
            personalEmail: 'private-contact@example.invalid',
            phone: '+923001234567',
          },
        });

        await prisma.employmentEpisode.create({
          data: {
            employeeId: result.id,
            startDate: at('2026-01-01'),
            status: 'ACTIVE',
            statusEffectiveDate: at('2026-01-01'),
          },
        });

        return result;
      }

      const a = await employee(
        accountA,
        '000123',
        '=Report A'
      );

      const b = await employee(
        accountB,
        '000456',
        'Private Other Team'
      );

      const ownManager = await employee(
        manager,
        'MGR001',
        'Manager Self'
      );

      async function unit(kind, name, extra = {}) {
        return prisma.organizationUnit.create({
          data: {
            kind,
            name,
            actorUserId: admin.id,
            reason: 'Disposable report fixture',
            ...extra,
          },
        });
      }

      const department = await unit(
        'DEPARTMENT',
        'Reports department'
      );

      const campaign = await unit(
        'CAMPAIGN',
        'Reports campaign'
      );

      const designation = await unit(
        'DESIGNATION',
        'Reports agent'
      );

      const teamA = await unit('TEAM', 'Reports team A', {
        departmentId: department.id,
        campaignId: campaign.id,
      });

      const teamB = await unit('TEAM', 'Reports team B', {
        departmentId: department.id,
        campaignId: campaign.id,
      });

      const assign = (
        employeeId,
        teamId,
        from,
        to = null
      ) =>
        prisma.organizationAssignment.create({
          data: {
            employeeId,
            teamId,
            designationId: designation.id,
            effectiveFrom: at(from),
            effectiveTo: to && at(to),
            actorUserId: admin.id,
            reason: 'Disposable report fixture',
          },
        });

      await assign(
        a.id,
        teamA.id,
        '2026-01-01',
        '2026-01-02'
      );

      await assign(a.id, teamB.id, '2026-01-03');
      await assign(b.id, teamB.id, '2026-01-01');

      await prisma.teamManagerAssignment.create({
        data: {
          teamId: teamA.id,
          managerUserId: manager.id,
          effectiveFrom: at('2026-01-02'),
          effectiveTo: at('2026-01-02'),
          actorUserId: admin.id,
          reason: 'One-day report fixture',
        },
      });

      server = app.listen(0, '127.0.0.1');

      await new Promise(resolve =>
        server.once('listening', resolve)
      );

      const base =
        `http://127.0.0.1:${server.address().port}/api`;

      async function request(path, session, options = {}) {
        return fetch(base + path, {
          ...options,
          headers: {
            ...(session
              ? { Cookie: session.cookie }
              : {}),
            ...options.headers,
          },
        });
      }

      async function login(account) {
        const response = await request(
          '/auth/login',
          null,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: account.email,
              password,
            }),
          }
        );

        assert.equal(response.status, 200);

        await response.json();

        return {
          cookie: response.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; '),
        };
      }

      const adminSession = await login(admin);
      const hrSession = await login(hr);
      const managerSession = await login(manager);
      const employeeSession = await login(accountA);
      const otherSession = await login(accountB);
      const forcedSession = await login(forced);

      const range =
        'dateFrom=2026-01-01&dateTo=2026-01-03';

      async function json(path, session, status = 200) {
        const response = await request(path, session);

        assert.equal(response.status, status);
        assert.equal(
          response.headers.get('cache-control'),
          'no-store'
        );

        return (await response.json()).data;
      }

      await t.test(
        'real authentication, forced password change and no-store on reports/downloads',
        async () => {
          for (const path of [
            '/reports/monthly',
            '/reports/attendance/export?format=csv',
          ]) {
            await json(path, null, 401);
            await json(path, forcedSession, 403);
          }

          await json(
            '/reports/attendance?month=2026-01',
            employeeSession
          );
        }
      );

      await t.test(
        'inactive settings never create ordinary missing attendance or database facts',
        async () => {
          const result = await json(
            `/reports/attendance?${range}`,
            adminSession
          );

          assert.equal(result.total, 9);
          assert.equal(result.totals.noClockIn, 0);
          assert.equal(
            result.meta.currentPolicyState,
            'NO_ACTIVATED_POLICY'
          );

          assert.ok(
            result.rows.every(
              row => row.classification === 'SETUP_REQUIRED'
            )
          );

          assert.equal(
            await prisma.attendanceRecord.count(),
            0
          );

          assert.equal(
            await prisma.attendanceCorrectionRequest.count(),
            0
          );

          assert.equal(
            await prisma.officeSchedule.count(),
            0
          );
        }
      );

      await t.test(
        'Admin/HR organization reads and employee owner isolation use real Prisma filters',
        async () => {
          const organization = await json(
            '/reports/monthly?month=2026-01',
            hrSession
          );

          assert.equal(organization.total, 3);

          const own = await json(
            `/reports/attendance?${range}`,
            employeeSession
          );

          assert.equal(own.total, 3);

          assert.ok(
            own.rows.every(
              row => row.employee.id === a.id
            )
          );

          assert.equal(
            JSON.stringify(own).includes(b.fullName),
            false
          );

          assert.equal(
            JSON.stringify(own).includes(
              'private-contact@example.invalid'
            ),
            false
          );

          await json(
            `/reports/attendance?${range}&employeeId=${b.id}`,
            employeeSession,
            403
          );
        }
      );

      await t.test(
        'historical manager scope intersects employee and organization filters on each date',
        async () => {
          const all = await json(
            `/reports/attendance?${range}`,
            managerSession
          );

          assert.equal(all.total, 4);

          assert.ok(
            all.rows.every(
              row =>
                row.employee.id === ownManager.id ||
                (
                  row.employee.id === a.id &&
                  row.shiftDate === '2026-01-02'
                )
            )
          );

          const otherEmployee = await json(
            `/reports/attendance?${range}&employeeId=${b.id}`,
            managerSession
          );

          assert.equal(otherEmployee.total, 0);

          const otherTeam = await json(
            `/reports/attendance?${range}&teamId=${teamB.id}`,
            managerSession
          );

          assert.equal(otherTeam.total, 0);

          await json(
            `/reports/corrections?month=2026-01&employeeId=${a.id}`,
            managerSession,
            403
          );

          const corrections = await json(
            '/reports/corrections?month=2026-01',
            managerSession
          );

          assert.equal(corrections.total, 0);
        }
      );

      await t.test(
        'monthly/details pagination and malformed queries are deterministic and bounded',
        async () => {
          const first = await json(
            `/reports/attendance?${range}&pageSize=2`,
            adminSession
          );

          const second = await json(
            `/reports/attendance?${range}&pageSize=2&page=2`,
            adminSession
          );

          assert.equal(first.total, 9);
          assert.equal(first.rows.length, 2);

          const identifiers = [
            ...first.rows,
            ...second.rows,
          ].map(
            row => `${row.employee.id}:${row.shiftDate}`
          );

          assert.equal(
            new Set(identifiers).size,
            4
          );

          for (const query of [
            'pageSize=101',
            'now=2026-01-01',
            'role=ADMIN',
            'month=2026-13',
            'employeeId=bad',
            'dateFrom=2026-02-30&dateTo=2026-03-01',
            `employeeId=${a.id}&employeeId=${b.id}`,
          ]) {
            await json(
              '/reports/attendance?' + query,
              adminSession,
              400
            );
          }

          await json(
            '/reports/attendance/export?page=1',
            adminSession,
            400
          );

          await json(
            '/reports/unknown/export',
            adminSession,
            404
          );
        }
      );

      await t.test(
        'CSV is attached, cross-origin readable and owner-scoped with text-protected codes',
        async () => {
          const response = await request(
            `/reports/attendance/export?${range}&format=csv`,
            employeeSession,
            {
              headers: {
                Origin: ALLOWED_ORIGINS[0],
              },
            }
          );

          assert.equal(response.status, 200);

          assert.match(
            response.headers.get('content-type'),
            /text\/csv/
          );

          assert.equal(
            response.headers.get('cache-control'),
            'no-store'
          );

          assert.match(
            response.headers.get('content-disposition'),
            /^attachment; filename="officehr-attendance-/
          );

          assert.match(
            response.headers.get(
              'access-control-expose-headers'
            ),
            /content-disposition/i
          );

          assert.equal(
            response.headers.get(
              'access-control-allow-origin'
            ),
            ALLOWED_ORIGINS[0]
          );

          const text = await response.text();

          assert.ok(text.includes("'000123"));
          assert.ok(text.includes("'=Report A"));

          assert.equal(
            text.includes(b.fullName),
            false
          );

          assert.equal(
            text.includes('private-contact@example.invalid'),
            false
          );
        }
      );

      await t.test(
        'XLSX download has complete authorized rows, metadata and no formulas',
        async () => {
          const response = await request(
            `/reports/attendance/export?${range}&format=xlsx`,
            managerSession
          );

          assert.equal(response.status, 200);

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          const zip = await JSZip.loadAsync(buffer, {
            checkCRC32: true,
          });

          const xml = await zip
            .file('xl/worksheets/sheet1.xml')
            .async('string');

          assert.equal(
            (xml.match(/<row r=/g) || []).length,
            5
          );

          assert.ok(xml.includes(a.fullName));
          assert.ok(xml.includes(ownManager.fullName));

          assert.equal(
            xml.includes(b.fullName),
            false
          );

          assert.doesNotMatch(xml, /<f(?:\s|>)/);

          assert.ok(
            zip.file('xl/worksheets/sheet3.xml')
          );
        }
      );

      await t.test(
        'empty exports and search/filter combinations do not leak other employees',
        async () => {
          const empty = await json(
            `/reports/attendance?${range}&search=NoSuchReportEmployee`,
            adminSession
          );

          assert.equal(empty.total, 0);

          const filtered = await json(
            `/reports/attendance?${range}&employeeId=${a.id}&teamId=${teamA.id}`,
            adminSession
          );

          assert.equal(filtered.total, 2);

          const response = await request(
            `/reports/attendance/export?${range}&employeeId=${b.id}&format=csv`,
            managerSession
          );

          assert.equal(response.status, 200);

          const text = await response.text();

          assert.equal(
            text.trim().split('\r\n').length,
            1
          );
        }
      );

      await t.test(
        'changed roles and disabled accounts are rechecked for reports and downloads',
        async () => {
          await prisma.user.update({
            where: { id: manager.id },
            data: { role: 'EMPLOYEE' },
          });

          const result = await json(
            `/reports/attendance?${range}`,
            managerSession
          );

          assert.ok(
            result.rows.every(
              row => row.employee.id === ownManager.id
            )
          );

          await prisma.user.update({
            where: { id: accountB.id },
            data: { status: 'DISABLED' },
          });

          await json(
            '/reports/monthly?month=2026-01',
            otherSession,
            401
          );

          await json(
            '/reports/monthly/export?month=2026-01&format=csv',
            otherSession,
            401
          );
        }
      );
    } finally {
      try {
        if (server?.listening) {
          await new Promise((resolve, reject) =>
            server.close(error =>
              error ? reject(error) : resolve()
            )
          );
        }
      } finally {
        try {
          if (prisma) {
            await prisma.$disconnect();
          }
        } finally {
          await database.cleanup();
        }
      }

      console.log(
        'Reports test database removed; original Admin preservation checked by the existing guard.'
      );
    }
  }
);