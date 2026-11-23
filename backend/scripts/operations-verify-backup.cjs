'use strict';
const {verifyBackup}=require('./lib/private-backup.cjs');
if(require.main===module){
 if(!process.argv[2]){console.error('Usage: node scripts/operations-verify-backup.cjs <private-backup-directory>');process.exitCode=1;}
 else verifyBackup(process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Backup verification failed. Do not restore or mark it complete.');process.exitCode=1;});
}

