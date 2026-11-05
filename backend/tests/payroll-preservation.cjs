// Read-only inventory. Values are hashed, never printed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Client}=require('pg');
(async()=>{
 const url=require('dotenv').parse(fs.readFileSync(path.join(__dirname,'../.env'))).DATABASE_URL;
 const sql=new Client({connectionString:url});await sql.connect();
 try{
  await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables={};
  for(const {tablename} of (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows){
   const rows=(await sql.query(`SELECT row_to_json(t) AS data FROM "${tablename.replaceAll('"','""')}" t ORDER BY row_to_json(t)::text`)).rows;
   tables[tablename]={count:rows.length,hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  const migrations=(await sql.query('SELECT migration_name,checksum,finished_at FROM _prisma_migrations ORDER BY migration_name')).rows.map(m=>({name:m.migration_name,applied:!!m.finished_at,checksumMatches:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../prisma/migrations',m.migration_name,'migration.sql'))).digest('hex')===m.checksum}));
  if(process.argv[2]){
   const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
   for(const name of Object.keys(before.tables))assert.deepEqual(tables[name],before.tables[name],`Preservation failed: ${name}`);
   for(const name of Object.keys(tables).filter(n=>!before.tables[n]))assert.equal(tables[name].count,0);
  }
  const temporaryDatabases=(await sql.query("SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'officehr_phase%_test_%'")).rows[0].count;
  const holidayIndexes=(await sql.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='company_holiday_events' ORDER BY indexname")).rows.map(r=>r.indexname);
  assert.ok(holidayIndexes.includes('company_holiday_events_date_revision_key'));
  assert.ok(migrations.every(m=>m.applied&&m.checksumMatches));
  console.log(JSON.stringify({tables,migrations,temporaryDatabases,holidayIndexes},null,2));await sql.query('COMMIT');
 }finally{await sql.end();}
})().catch(e=>{console.error('Preservation check failed:',e.code||e.name);process.exitCode=1;});
