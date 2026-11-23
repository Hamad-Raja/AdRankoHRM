'use strict';
const fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pipeline}=require('node:stream/promises'),{Client}=require('pg');
const {getDocumentStorage,verifyDocumentStorage}=require('../../src/config/document-storage');
const filename=/^[a-f0-9-]{36}\.(txt|png)$/;
async function hash(file){const digest=crypto.createHash('sha256');for await(const bytes of native.createReadStream(file))digest.update(bytes);return digest.digest('hex');}
function connectionEnv(value){
 const u=new URL(value);if(!['postgres:','postgresql:'].includes(u.protocol)||!u.username||!u.pathname.slice(1))throw Error('Use an explicit PostgreSQL backup target.');
 const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname),ssl=u.searchParams.get('sslmode');
 if(!local&&!['require','verify-ca','verify-full'].includes(ssl))throw Error('Remote backups require verified TLS.');
 return {...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),
  PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),
  PGSSLMODE:local?(ssl||'disable'):'verify-full',...(!local?{PGSSLROOTCERT:'system'}:{}),PGCONNECT_TIMEOUT:'15'};
}
async function run(binary,args,env){await new Promise((resolve,reject)=>{const child=spawn(binary,args,{env,stdio:['ignore','ignore','ignore'],windowsHide:true});child.once('error',()=>reject(Error('Backup executable unavailable.')));child.once('exit',code=>code===0?resolve():reject(Error('pg_dump failed; backup is incomplete.')));});}
async function backup({databaseUrl,documentsDir,destination,writesPaused=false,pgDumpBinary='pg_dump'}){
 if(!databaseUrl||!documentsDir||!destination||!writesPaused)throw Error('Explicit database, storage, destination and writes-paused acknowledgement are required.');
 const env=connectionEnv(databaseUrl),root=await fs.realpath(documentsDir),output=path.resolve(destination);
 const relative=path.relative(root,output);if(!relative||relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Backup output must be outside document storage.');
 getDocumentStorage({NODE_ENV:'production',DOCUMENT_STORAGE_DIR:output});
 // New destination only: never overwrite or delete an earlier backup.
 await fs.mkdir(output,{mode:0o700});await verifyDocumentStorage(getDocumentStorage({NODE_ENV:'production',DOCUMENT_STORAGE_DIR:output}));await fs.mkdir(path.join(output,'documents'),{mode:0o700});
 const manifest={version:1,complete:false,createdAt:new Date().toISOString(),writesPausedAcknowledged:true,documents:[]};
 const client=new Client({connectionString:databaseUrl,connectionTimeoutMillis:15000});
 try{
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity=(await client.query('SELECT current_database() name,pg_export_snapshot() snapshot')).rows[0];
  manifest.database=identity.name;
  const docs=(await client.query('SELECT "storageName","byteLength" FROM employee_documents ORDER BY "storageName"')).rows;
  await run(pgDumpBinary,['--format=custom','--no-owner','--no-privileges','--snapshot='+identity.snapshot,'--file='+path.join(output,'database.dump')],env);
  for(const doc of docs){
   if(!filename.test(doc.storageName))throw Error('Unsafe stored document name; backup incomplete.');
   const input=await fs.open(path.join(root,doc.storageName),native.constants.O_RDONLY|(native.constants.O_NOFOLLOW||0));
   try{
    const stat=await input.stat();if(!stat.isFile()||stat.size!==doc.byteLength)throw Error('Missing or inconsistent document; backup incomplete.');
    if((await fs.lstat(path.join(root,doc.storageName))).isSymbolicLink())throw Error('Document symlinks are not supported.');
    await pipeline(input.createReadStream({autoClose:false}),native.createWriteStream(path.join(output,'documents',doc.storageName),{flags:'wx',mode:0o600}));
   }finally{await input.close();}
   const copied=path.join(output,'documents',doc.storageName);
   if((await fs.stat(copied)).size!==doc.byteLength)throw Error('Copied document length differs; backup incomplete.');
   manifest.documents.push({name:doc.storageName,bytes:doc.byteLength,sha256:await hash(copied)});
  }
  manifest.databaseDumpSha256=await hash(path.join(output,'database.dump'));manifest.complete=true;
  await client.query('ROLLBACK');
 }finally{
  await client.end().catch(()=>{});
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
 }
 return {directory:output,documents:manifest.documents.length,complete:manifest.complete};
}
async function verifyBackup(directory){
 const root=path.resolve(directory),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.complete!==true||!Array.isArray(manifest.documents))throw Error('Backup is incomplete or unsupported.');
 if(await hash(path.join(root,'database.dump'))!==manifest.databaseDumpSha256)throw Error('Database dump checksum differs.');
 const names=new Set();
 for(const doc of manifest.documents){
  if(!filename.test(doc.name)||names.has(doc.name))throw Error('Invalid backup document name.');names.add(doc.name);
  const file=path.join(root,'documents',doc.name),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size!==doc.bytes||await hash(file)!==doc.sha256)throw Error('Document checksum/length differs.');
 }
 return {complete:true,documents:manifest.documents.length};
}
module.exports={backup,verifyBackup,connectionEnv};

