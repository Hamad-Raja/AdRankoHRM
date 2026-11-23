'use strict';
// Explicit opt-in maintenance command. Never loads the application's .env.
// The operator must stop ALL writers before using --writes-paused.
const {backup}=require('./lib/private-backup.cjs');
if(require.main===module){
 backup({databaseUrl:process.env.BACKUP_DATABASE_URL,documentsDir:process.env.BACKUP_DOCUMENT_STORAGE_DIR,
  destination:process.env.BACKUP_DESTINATION,writesPaused:process.argv.includes('--writes-paused'),
  pgDumpBinary:process.env.PG_DUMP_BIN||'pg_dump'})
 .then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Coordinated backup failed; preserve any incomplete output and inspect privately.');process.exitCode=1;});
}

