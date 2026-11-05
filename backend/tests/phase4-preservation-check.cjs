// Read-only normal-database inventory. Never prints connection strings or user data.
const { Client } = require('pg');
const fs = require('node:fs');
const crypto = require('node:crypto');
(async () => {
  const url = require('dotenv').parse(fs.readFileSync(require('node:path').join(__dirname, '../.env'))).DATABASE_URL;
  const sql = new Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query('SET default_transaction_read_only = on');
    const migrations = await sql.query('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    const counts = {};
    for (const table of ['users','employees','office_schedule_drafts','office_schedules','attendance_records','attendance_correction_requests']) {
      const rows = (await sql.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
      counts[table] = { count: rows.length, sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    }
    if (process.argv[2]) {
      const text=fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'').split(/\r?\nTemporary databases remaining:/)[0];
      require('node:assert/strict').deepEqual(counts,JSON.parse(text).tables);
      console.log('PASS: Normal user, employee, inactive draft and attendance snapshots unchanged.');
    }
    console.log(JSON.stringify({ migrations: migrations.rows.map(r => ({ name:r.migration_name, checksumMatches:crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,'../prisma/migrations',r.migration_name,'migration.sql'))).digest('hex') === r.checksum })), tables: counts }, null, 2));
    const leftovers = await sql.query("SELECT datname FROM pg_database WHERE datname LIKE 'officehr_phase%_test_%'");
    console.log('Temporary databases remaining:', leftovers.rowCount);
  } finally { await sql.end(); }
})().catch(e => { console.error(e.code || e.name); process.exitCode = 1; });
