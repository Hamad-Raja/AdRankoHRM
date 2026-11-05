"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

const {
  createIsolatedDatabase,
  assertTestDatabase,
} = require("./isolated-db");

async function closeServer(server) {
  if (!server || !server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    server.closeAllConnections();
  });
}

test(
  "Employee creation against a disposable PostgreSQL database",
  { timeout: 120000 },
  async (t) => {
    const database = await createIsolatedDatabase();

    const previousEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
    };

    let prisma;
    let sql;
    let server;

    // Register cleanup before importing application modules or creating fixtures.
    t.after(async () => {
      const failures = [];

      const cleanupOperations = [
        () => closeServer(server),
        () => prisma?.$disconnect(),
        () => sql?.end(),
        () => database.cleanup(),
      ];

      for (const cleanup of cleanupOperations) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }

      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Employee test cleanup failed."
        );
      }

      t.diagnostic(
        "Temporary database removed; original Admin snapshot unchanged."
      );
    });

    assertTestDatabase(database.url);

    process.env.DATABASE_URL = database.url;
    process.env.NODE_ENV = "test";

    prisma = require("../src/config/prisma");

    const app = require("../app");
    const { hashPassword } = require("../src/utils/password");

    const {
      ALLOWED_ORIGINS,
      CSRF_HEADER_NAME,
    } = require("../src/config/auth");

    assert.ok(
      Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.length > 0,
      "At least one allowed origin must be configured."
    );

    sql = new Client({ connectionString: database.url });
    await sql.connect();

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const trustedOrigin = ALLOWED_ORIGINS[0];

    const password = "Phase2-fixture!123";
    const passwordHash = await hashPassword(password);

    let userSequence = 0;
    let employeeSequence = 0;

    async function request(
      route,
      { body, session, headers = {} } = {}
    ) {
      const response = await fetch(baseUrl + route, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Origin: trustedOrigin,
          ...(session ? { Cookie: session.cookie } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      assert.equal(
        response.headers.get("cache-control"),
        "no-store"
      );

      return { response, data };
    }

    async function createAccount(role, overrides = {}) {
      userSequence += 1;

      const user = await prisma.user.create({
        data: {
          email: `phase2-fixture-${userSequence}@example.invalid`,
          displayName: "Phase 2 Test Fixture",
          passwordHash,
          role,
          mustChangePassword: false,
          ...overrides,
        },
      });

      const result = await request("/auth/login", {
        body: {
          email: user.email,
          password,
        },
      });

      assert.equal(
        result.response.status,
        200,
        "Fixture account login must succeed."
      );

      const csrf = result.data.data?.csrfToken;
      const cookies = result.response.headers.getSetCookie();

      assert.ok(
        typeof csrf === "string" && /^[a-f0-9]{64}$/.test(csrf),
        "Login must provide a valid CSRF token."
      );

      assert.equal(cookies.length, 2);

      return {
        user,
        session: {
          csrf,
          cookie: cookies
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
        },
      };
    }

    function employeeBody() {
      employeeSequence += 1;

      return {
        employeeCode: `p2-test-${employeeSequence}`,
        fullName: "Phase 2 Test Fixture",
        employment: {
          startDate: "2026-10-01",
          status: "ACTIVE",
          reason: "Isolated employee API test fixture.",
        },
      };
    }

    const admin = await createAccount("ADMIN");
    const hr = await createAccount("HR");
    const manager = await createAccount("MANAGER");
    const employeeAccount = await createAccount("EMPLOYEE");

    const forcedChange = await createAccount("ADMIN", {
      mustChangePassword: true,
    });

    const disabled = await createAccount("ADMIN");

    async function create(
      body,
      {
        session = admin.session,
        includeCsrf = true,
        headers = {},
      } = {}
    ) {
      return request("/employees", {
        body,
        session,
        headers: {
          ...(session && includeCsrf
            ? { [CSRF_HEADER_NAME]: session.csrf }
            : {}),
          ...headers,
        },
      });
    }

    async function counts() {
      const [employees, episodes, events, audits] =
        await Promise.all([
          prisma.employee.count(),
          prisma.employmentEpisode.count(),
          prisma.employmentStatusEvent.count(),
          prisma.auditLog.count({
            where: { action: "EMPLOYEE_CREATED" },
          }),
        ]);

      return { employees, episodes, events, audits };
    }

    function assertOneCreation(before, after) {
      assert.deepEqual(after, {
        employees: before.employees + 1,
        episodes: before.episodes + 1,
        events: before.events + 1,
        audits: before.audits + 1,
      });
    }

    let createdEmployee;

    await t.test("rejects unauthenticated creation", async () => {
      const before = await counts();

      const result = await create(employeeBody(), {
        session: null,
      });

      assert.equal(result.response.status, 401);
      assert.deepEqual(await counts(), before);
    });

    await t.test(
      "Admin creates a profile, employment history and audit together",
      async () => {
        const before = await counts();
        const body = employeeBody();

        body.fullName = "  Phase 2 Test Fixture  ";
        body.personalEmail = "  PROFILE.TEST@EXAMPLE.INVALID  ";

        const result = await create(body);

        assert.equal(result.response.status, 201);
        assert.equal(result.data.success, true);

        createdEmployee = result.data.data.employee;

        assert.equal(
          createdEmployee.employeeCode,
          body.employeeCode.toUpperCase()
        );
        assert.equal(
          createdEmployee.fullName,
          "Phase 2 Test Fixture"
        );
        assert.equal(
          createdEmployee.personalEmail,
          "profile.test@example.invalid"
        );
        assert.equal(createdEmployee.userId, null);
        assert.equal(createdEmployee.phone, null);
        assert.equal(createdEmployee.version, 1);

        assert.equal(
          createdEmployee.employment.startDate,
          "2026-10-01"
        );
        assert.equal(
          createdEmployee.employment.statusEffectiveDate,
          "2026-10-01"
        );
        assert.equal(createdEmployee.employment.status, "ACTIVE");
        assert.equal(createdEmployee.employment.endDate, null);

        assert.doesNotMatch(
          JSON.stringify(result.data),
          /passwordHash|tokenHash|csrfTokenHash/
        );

        const events =
          await prisma.employmentStatusEvent.findMany({
            where: {
              employmentEpisodeId:
                createdEmployee.employment.id,
            },
          });

        assert.equal(events.length, 1);
        assert.equal(events[0].fromStatus, null);
        assert.equal(events[0].toStatus, "ACTIVE");
        assert.equal(events[0].actorUserId, admin.user.id);
        assert.equal(events[0].reason, body.employment.reason);
        assert.equal(events[0].approvedByUserId, null);
        assert.equal(events[0].approvedAt, null);

        const audit = await prisma.auditLog.findFirst({
          where: {
            action: "EMPLOYEE_CREATED",
            targetId: createdEmployee.id,
          },
        });

        assert.ok(audit);
        assert.equal(audit.actorUserId, admin.user.id);
        assert.equal(audit.targetType, "Employee");
        assert.equal(audit.success, true);
        assert.equal(
          audit.metadata.employmentEpisodeId,
          createdEmployee.employment.id
        );
        assert.equal(
          Object.hasOwn(audit.metadata, "personalEmail"),
          false
        );

        assertOneCreation(before, await counts());
      }
    );

    await t.test(
      "HR creates an employee with explicit probation dates",
      async () => {
        const body = employeeBody();

        body.employment.status = "PROBATION";
        body.employment.probationEndDate = "2026-12-31";

        const result = await create(body, {
          session: hr.session,
        });

        assert.equal(result.response.status, 201);

        const profile = result.data.data.employee;

        assert.equal(profile.employment.status, "PROBATION");
        assert.equal(
          profile.employment.probationEndDate,
          "2026-12-31"
        );
        assert.equal(profile.employment.confirmedOn, null);

        const event =
          await prisma.employmentStatusEvent.findFirst({
            where: {
              employmentEpisodeId: profile.employment.id,
            },
          });

        assert.equal(event.actorUserId, hr.user.id);
      }
    );

    await t.test(
      "Manager and Employee accounts cannot create employees",
      async () => {
        const before = await counts();

        for (const account of [manager, employeeAccount]) {
          const result = await create(employeeBody(), {
            session: account.session,
          });

          assert.equal(result.response.status, 403);
        }

        assert.deepEqual(await counts(), before);
      }
    );

    await t.test(
      "rejects missing CSRF, incorrect CSRF and hostile origins",
      async () => {
        const before = await counts();

        const missing = await create(employeeBody(), {
          includeCsrf: false,
        });

        const incorrect = await create(employeeBody(), {
          headers: {
            [CSRF_HEADER_NAME]: "0".repeat(64),
          },
        });

        const hostile = await create(employeeBody(), {
          headers: {
            Origin: "https://untrusted.example",
          },
        });

        for (const result of [missing, incorrect, hostile]) {
          assert.equal(result.response.status, 403);
        }

        assert.deepEqual(await counts(), before);
      }
    );

    await t.test(
      "rejects invalid dates, invalid profiles and protected fields",
      async () => {
        const before = await counts();
        const valid = employeeBody();

        const invalidBodies = [
          {},
          { ...valid, employeeCode: " " },
          { ...valid, fullName: " " },
          { ...valid, fullName: "Invalid\u0000Name" },
          { ...valid, personalEmail: "invalid-email" },
          { ...valid, role: "ADMIN" },
          { ...valid, userId: admin.user.id },
          {
            ...valid,
            employment: {
              ...valid.employment,
              startDate: "2026-02-30",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              startDate: "01-10-2026",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              probationEndDate: "2026-09-30",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              confirmedOn: "2026-09-30",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              status: "PROBATION",
              confirmedOn: "2026-10-02",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              status: "EXITED",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              reason: " ",
            },
          },
          {
            ...valid,
            employment: {
              ...valid.employment,
              approvedByUserId: admin.user.id,
            },
          },
        ];

        for (const [index, body] of invalidBodies.entries()) {
          const result = await create(body);

          assert.equal(
            result.response.status,
            400,
            `Invalid body case ${index + 1} must be rejected.`
          );
        }

        assert.deepEqual(await counts(), before);
      }
    );

    await t.test(
      "duplicate and concurrent employee codes create only one record",
      async () => {
        const body = employeeBody();

        const first = await create(body);
        assert.equal(first.response.status, 201);

        const beforeDuplicate = await counts();

        const duplicate = await create({
          ...body,
          employeeCode: body.employeeCode.toUpperCase(),
        });

        assert.equal(duplicate.response.status, 409);
        assert.deepEqual(await counts(), beforeDuplicate);

        const concurrentBody = employeeBody();
        const beforeConcurrent = await counts();

        const results = await Promise.all([
          create(concurrentBody),
          create(concurrentBody),
        ]);

        const statuses = results
          .map((result) => result.response.status)
          .sort((left, right) => left - right);

        assert.deepEqual(statuses, [201, 409]);
        assertOneCreation(beforeConcurrent, await counts());
      }
    );

    await t.test(
      "forced changes, disabled accounts and changed roles block writes",
      async () => {
        const before = await counts();

        const forced = await create(employeeBody(), {
          session: forcedChange.session,
        });

        assert.equal(forced.response.status, 403);

        await prisma.user.update({
          where: { id: disabled.user.id },
          data: { status: "DISABLED" },
        });

        const disabledResult = await create(employeeBody(), {
          session: disabled.session,
        });

        assert.equal(disabledResult.response.status, 401);

        await prisma.user.update({
          where: { id: hr.user.id },
          data: { role: "MANAGER" },
        });

        const changedRole = await create(employeeBody(), {
          session: hr.session,
        });

        assert.equal(changedRole.response.status, 403);
        assert.deepEqual(await counts(), before);
      }
    );

    await t.test(
      "audit failure rolls back the complete employee creation",
      async () => {
        const before = await counts();

        // This temporary constraint deliberately rejects new employee audits.
        // NOT VALID allows previously created audit fixtures to remain.
        await sql.query(`
          ALTER TABLE "audit_logs"
          ADD CONSTRAINT "phase2_test_reject_employee_audit"
          CHECK ("action" <> 'EMPLOYEE_CREATED') NOT VALID
        `);

        try {
          const result = await create(employeeBody());

          assert.equal(result.response.status, 500);
          assert.equal(result.data.success, false);
          assert.deepEqual(await counts(), before);
        } finally {
          await sql.query(`
            ALTER TABLE "audit_logs"
            DROP CONSTRAINT "phase2_test_reject_employee_audit"
          `);
        }
      }
    );

    await t.test(
      "database rejects invalid dates and overlapping employment periods",
      async () => {
        assert.ok(createdEmployee);

        // Direct SQL is used only to exercise database constraints
        // against disposable test fixtures.
        async function insertEpisode({
          startDate,
          endDate = null,
          status = "ACTIVE",
          statusEffectiveDate = startDate,
        }) {
          return sql.query(
            `
              INSERT INTO "employment_episodes" (
                "id",
                "employeeId",
                "startDate",
                "endDate",
                "status",
                "statusEffectiveDate",
                "updatedAt"
              )
              VALUES (
                $1,
                $2,
                $3::date,
                $4::date,
                $5::"EmploymentStatus",
                $6::date,
                CURRENT_TIMESTAMP
              )
              RETURNING "id"
            `,
            [
              randomUUID(),
              createdEmployee.id,
              startDate,
              endDate,
              status,
              statusEffectiveDate,
            ]
          );
        }

        await assert.rejects(
          () =>
            insertEpisode({
              startDate: "2026-11-01",
              endDate: "2026-10-31",
              status: "EXITED",
              statusEffectiveDate: "2026-10-31",
            }),
          (error) => error.code === "23514"
        );

        await assert.rejects(
          () =>
            insertEpisode({
              startDate: "2026-11-01",
              status: "EXITED",
            }),
          (error) => error.code === "23514"
        );

        await assert.rejects(
          () =>
            insertEpisode({
              startDate: "2026-11-01",
              statusEffectiveDate: "2026-10-31",
            }),
          (error) => error.code === "23514"
        );

        await assert.rejects(
          () =>
            insertEpisode({
              startDate: "2026-11-01",
            }),
          (error) =>
            error.code === "23P01" &&
            error.constraint === "employment_episodes_no_overlap"
        );

        await sql.query(
          `
            UPDATE "employment_episodes"
            SET
              "status" = 'EXITED',
              "endDate" = DATE '2026-10-10',
              "statusEffectiveDate" = DATE '2026-10-10',
              "version" = "version" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = $1
          `,
          [createdEmployee.employment.id]
        );

        // The old episode includes its last working day.
        await assert.rejects(
          () =>
            insertEpisode({
              startDate: "2026-10-10",
            }),
          (error) =>
            error.code === "23P01" &&
            error.constraint === "employment_episodes_no_overlap"
        );

        // A new episode can start on the following calendar date.
        const nextEpisode = await insertEpisode({
          startDate: "2026-10-11",
        });

        assert.equal(nextEpisode.rowCount, 1);
      }
    );
  }
);