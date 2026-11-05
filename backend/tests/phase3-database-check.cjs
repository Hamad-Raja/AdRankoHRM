"use strict";

// Explicit standalone smoke check. NEVER applies fixtures or migration SQL to
// the database in DATABASE_URL. Creates and drops only its own random database.
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

const name = `officehr_phase3_test_${randomBytes(12).toString("hex")}`;
if (!/^officehr_phase3_test_[a-f0-9]{24}$/.test(name)) throw new Error("Unsafe generated database name.");
let admin, db, created = false;
let passed = 0;
const connections = [];
async function check(label, work) {
  await work(); passed += 1; console.log(`PASS ${label}`);
}
async function rejectsCode(work, codes) {
  await assert.rejects(work, error => codes.includes(error.code));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing. Run from backend with the existing environment configured.");
  const original = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(original.protocol)) throw new Error("Expected a PostgreSQL URL.");
  const normalName = decodeURIComponent(original.pathname.slice(1));
  if (!normalName || normalName === name) throw new Error("Unsafe source database configuration.");
  const adminUrl = new URL(original); adminUrl.pathname = "/postgres";
  const targetUrl = new URL(original); targetUrl.pathname = `/${name}`;
  if (decodeURIComponent(targetUrl.pathname.slice(1)) !== name) throw new Error("Temporary target validation failed.");
  admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  db = new Client({ connectionString: targetUrl.toString() });
  await db.connect();
  assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name, name);

  const migrationsPath = path.resolve(__dirname, "../prisma/migrations");
  const entries = await fs.readdir(migrationsPath, { withFileTypes: true });
  const migrations = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.ok(migrations.includes("20261022220000_shift_foundation"), "Shift migration is missing.");
  for (const migration of migrations) {
    const sql = await fs.readFile(path.join(migrationsPath, migration, "migration.sql"), "utf8");
    await db.query(sql);
  }
  await check("all migration SQL applies to a fresh guarded database", async () => {
    assert.equal((await db.query("SELECT to_regclass('employee_shift_assignments') AS name")).rows[0].name, "employee_shift_assignments");
  });

  const userId = randomUUID(), employeeId = randomUUID(), episodeId = randomUUID();
  await db.query(`INSERT INTO users (id,email,"displayName","passwordHash",role,status,"mustChangePassword","passwordChangedAt","updatedAt") VALUES ($1,$2,'Phase 3 fixture','not-a-real-password-hash','ADMIN','ACTIVE',false,now(),now())`, [userId, `${userId}@example.invalid`]);
  await db.query(`INSERT INTO employees (id,"employeeCode","fullName","updatedAt") VALUES ($1,'PHASE3-TEST','Phase 3 fixture',now())`, [employeeId]);
  await db.query(`INSERT INTO employment_episodes (id,"employeeId","startDate",status,"statusEffectiveDate","updatedAt") VALUES ($1,$2,'2026-01-01','ACTIVE','2026-01-01',now())`, [episodeId, employeeId]);

  async function insertShift(overrides = {}) {
    const values = { id: randomUUID(), name: `Fixture-${randomUUID()}`, timeZone: "Asia/Karachi", startTime: "20:00", endTime: "05:00", endsNextDay: true, workDays: [1,2,3,4,5], breakMinutes: 60, breakPaid: false, graceMinutes: 10, actorUserId: userId, reason: "Disposable fixture", ...overrides };
    const columns = Object.keys(values);
    await db.query(`INSERT INTO shift_definitions (${columns.map(column => `"${column}"`).join(",")}) VALUES (${columns.map((_, i) => `$${i+1}`).join(",")})`, Object.values(values));
    return values.id;
  }
  const shiftId = await insertShift();
  const assignmentId = randomUUID();
  const assignmentSql = `INSERT INTO employee_shift_assignments (id,"employeeId","employmentEpisodeId","shiftId","effectiveFrom","effectiveTo","actorUserId",reason) VALUES ($1,$2,$3,$4,$5,$6,$7,'Disposable fixture')`;
  const args = (id, from, to = null) => [id, employeeId, episodeId, shiftId, from, to, userId];
  await check("night definition and open employment assignment insert", async () => {
    await db.query(assignmentSql, args(assignmentId, "2026-10-01"));
  });
  await check("invalid and duplicate weekdays rejected by database", async () => {
    for (const workDays of [[1,1], [], [0], [8], [1,null]]) {
      await rejectsCode(() => insertShift({ workDays }), ["23514"]);
    }
  });
  await check("invalid duration and break policy rejected by database", async () => {
    for (const overrides of [{ endsNextDay: false }, { startTime: "20:00", endTime: "20:00" }, { breakMinutes: 540 }, { breakMinutes: 60, breakPaid: null }]) {
      await rejectsCode(() => insertShift(overrides), ["23514"]);
    }
  });
  await check("inclusive overlapping dates rejected directly by PostgreSQL", async () => {
    await rejectsCode(() => db.query(assignmentSql, args(randomUUID(), "2026-10-01", "2026-10-01")), ["23P01"]);
  });
  await check("assignment cannot precede its employment episode", async () => {
    await rejectsCode(() => db.query(assignmentSql, args(randomUUID(), "2025-01-01", "2025-01-02")), ["23514"]);
  });
  await check("definition cannot be rewritten or deleted", async () => {
    await rejectsCode(() => db.query(`UPDATE shift_definitions SET "endTime"='06:00' WHERE id=$1`, [shiftId]), ["23514"]);
    await rejectsCode(() => db.query("DELETE FROM shift_definitions WHERE id=$1", [shiftId]), ["23514"]);
  });
  await check("assignment closure requires actor/reason/time provenance", async () => {
    await rejectsCode(() => db.query(`UPDATE employee_shift_assignments SET "effectiveTo"='2026-10-21' WHERE id=$1`, [assignmentId]), ["23514"]);
  });
  await check("explicit closure and adjacent replacement preserve history", async () => {
    await db.query(`UPDATE employee_shift_assignments SET "effectiveTo"='2026-10-21',"closedByUserId"=$1,"closedReason"='Approved replacement',"closedAt"=now() WHERE id=$2`, [userId, assignmentId]);
    await db.query(assignmentSql, args(randomUUID(), "2026-10-22", "2026-11-01"));
    assert.equal((await db.query("SELECT count(*)::int AS count FROM employee_shift_assignments")).rows[0].count, 2);
  });
  await check("closed history cannot be changed or deleted", async () => {
    await rejectsCode(() => db.query(`UPDATE employee_shift_assignments SET reason='rewritten' WHERE id=$1`, [assignmentId]), ["23514"]);
    await rejectsCode(() => db.query("DELETE FROM employee_shift_assignments WHERE id=$1", [assignmentId]), ["23514"]);
  });
  await check("concurrent inserts allow only one assignment for the same dates", async () => {
    const clients = [new Client({ connectionString: targetUrl.toString() }), new Client({ connectionString: targetUrl.toString() })];
    connections.push(...clients);
    await Promise.all(clients.map(client => client.connect()));
    const results = await Promise.allSettled(clients.map(client => client.query(assignmentSql, args(randomUUID(), "2026-12-01", "2026-12-02"))));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.ok(["23P01", "40P01"].includes(rejected.reason.code));
  });
  await check("archive preserves existing rows and rejects new assignments", async () => {
    await db.query('UPDATE shift_definitions SET "archivedAt"=now() WHERE id=$1', [shiftId]);
    await rejectsCode(() => db.query(assignmentSql, args(randomUUID(), "2027-01-01")), ["23514"]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM employee_shift_assignments WHERE "shiftId"=$1', [shiftId])).rows[0].count, 3);
  });
  console.log(`${passed}/${passed} database smoke checks passed. No normal-database fixture writes were performed.`);
}

(async () => {
  try { await main(); }
  catch (error) {
    // Do not dump connection objects, URLs or environment variables.
    console.error(`Phase 3 database check failed: ${error.code || error.name}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    let cleanupFailed = false;
    for (const client of [...connections, db].filter(Boolean)) {
      try { await client.end(); } catch { cleanupFailed = true; }
    }
    if (created && admin) {
      try {
        if (!/^officehr_phase3_test_[a-f0-9]{24}$/.test(name)) throw new Error("Cleanup name guard failed.");
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        console.log("Temporary database removed.");
      } catch { console.error(`Cleanup failed. Remove only this generated database manually: ${name}`); cleanupFailed = true; }
    }
    if (admin) { try { await admin.end(); } catch { cleanupFailed = true; } }
    if (cleanupFailed) process.exitCode = 1;
  }
})();