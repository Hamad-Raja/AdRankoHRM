'use strict';
const fs=require('fs'),path=require('path'),{createHash}=require('crypto');
require('dotenv').config({quiet:true});
const {Client}=require('pg');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'reports/release-audit');
(async()=>{
 const u=new URL(process.env.DATABASE_URL),client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000});
 fs.mkdirSync(out,{recursive:true});
 const result={target:{host:u.hostname,database:decodeURIComponent(u.pathname.slice(1))},mode:'PostgreSQL enforced READ ONLY'};
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  result.database=(await client.query('SELECT current_database() name')).rows[0].name;
  result.transportTls={encrypted:client.connection.stream.encrypted===true,authorized:client.connection.stream.authorized===true};
  result.tls=(await client.query('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
  const migrations=(await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
  result.migrations=migrations.map(row=>{const file=path.join(root,'backend/prisma/migrations',row.migration_name,'migration.sql');return {name:row.migration_name,finished:!!row.finished_at,rolledBack:!!row.rolled_back_at,filePresent:fs.existsSync(file),checksumMatches:fs.existsSync(file)&&createHash('sha256').update(fs.readFileSync(file)).digest('hex')===row.checksum,lineEndingEquivalent:fs.existsSync(file)&&[fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n')].some(text=>createHash('sha256').update(text).digest('hex')===row.checksum)};});
  const local=fs.readdirSync(path.join(root,'backend/prisma/migrations'),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  result.pending=local.filter(name=>!migrations.some(m=>m.migration_name===name&&m.finished_at&&!m.rolled_back_at));
  result.roleCounts=(await client.query('SELECT role,status,count(*)::int count FROM users GROUP BY role,status ORDER BY role,status')).rows;
  result.protections=(await client.query("SELECT (SELECT count(*)::int FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace) foreign_keys,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled<>'D') enabled_user_triggers")).rows[0];
  await client.query('ROLLBACK');result.result='PASS_READ_ONLY_INSPECTION';console.log(JSON.stringify(result));
 }catch(e){result.result='UNVERIFIED';process.exitCode=1;result.errorCode=e.code||e.name;console.log(JSON.stringify({result:result.result,errorCode:result.errorCode}));}
 finally{await client.end();fs.writeFileSync(path.join(out,'normal-database-readonly.json'),JSON.stringify(result,null,2));}
})();
