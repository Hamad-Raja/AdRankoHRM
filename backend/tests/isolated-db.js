const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { Client } = require("pg");

const TEST_NAME = /^officehr_phase1_test_[a-f0-9]{16}$/;

function assertTestDatabase(connectionString) {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!TEST_NAME.test(name) || name.toLowerCase() === "adrankohrm") {
    throw new Error("Refusing database-writing tests: expected a generated OfficeHR test database.");
  }
  return name;
}

async function createIsolatedDatabase(options = {}) {
  const normalUrl = require("dotenv").parse(
    fs.readFileSync(path.join(__dirname, "../.env"))
  ).DATABASE_URL;
  if (!normalUrl) throw new Error("The normal database URL is required for the read-only preservation check.");
  const normal = new Client({ connectionString: normalUrl });
  await normal.connect();
  await normal.query("SET default_transaction_read_only = on");
  const snapshot = async () => {
    const result = await normal.query('SELECT row_to_json(u) AS data FROM users u WHERE role = \'ADMIN\' ORDER BY id');
    return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex");
  };
  const originalAdmin = await snapshot();
  const maintenanceUrl = new URL(normalUrl);
  maintenanceUrl.pathname = "/postgres";
  const maintenance = new Client({ connectionString: maintenanceUrl.href });
  const testUrl = new URL(normalUrl);
  const name = "officehr_phase1_test_" + randomBytes(8).toString("hex");
  testUrl.pathname = "/" + name;
  assertTestDatabase(testUrl.href);
  let created = false;
  let setupClient;
  async function cleanup() {
    if (created) {
      assertTestDatabase(testUrl.href);
      await maintenance.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
      await maintenance.query(`DROP DATABASE "${name}"`);
      created = false;
    }
    try {
      if (await snapshot() !== originalAdmin) throw new Error("Original Admin snapshot changed during verification.");
    } finally {
      await normal.end();
      await maintenance.end();
    }
  }
  try {
    await maintenance.connect();
    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    setupClient = new Client({ connectionString: testUrl.href });
    await setupClient.connect();
    // Apply the existing, unmodified migration SQL only to a newly created DB.
    const migrations = path.join(__dirname, "../prisma/migrations");
    if (options.throughMigration && (!/^[0-9]{14}_[a-z0-9_]+$/.test(options.throughMigration) || !fs.existsSync(path.join(migrations, options.throughMigration, 'migration.sql')))) throw new Error('Invalid migration boundary.');
    for (const entry of fs.readdirSync(migrations).sort()) {
      if (options.throughMigration && entry > options.throughMigration) continue;
      const file = path.join(migrations, entry, "migration.sql");
      if (fs.existsSync(file)) await setupClient.query(fs.readFileSync(file, "utf8"));
    }
    await setupClient.end();
    setupClient = null;
    return { url: testUrl.href, cleanup };
  } catch (error) {
    if (setupClient) await setupClient.end();
    await cleanup();
    // Never include connection strings or SQL parameter values in errors.
    throw new Error("Isolated database setup failed (" + (error.code || error.name) + ").");
  }
}

module.exports = { assertTestDatabase, createIsolatedDatabase };
