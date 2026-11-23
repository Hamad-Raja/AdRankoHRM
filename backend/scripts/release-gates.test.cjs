'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createEmploymentWorker}=require('../src/utils/employment-worker');
const {getDocumentStorage,verifyDocumentStorage}=require('../src/config/document-storage');
const {connectionEnv,verifyBackup}=require('./lib/private-backup.cjs');
test('same-origin API paths resolve without changing absolute local API behavior',async()=>{
 const {resolveApiBaseUrl:r}=await import(pathToFileURL(path.resolve(__dirname,'../../frontend/src/lib/api-base-url.js')).href);
 assert.equal(r('/api','https://ad-ranko-hrm.vercel.app'),'https://ad-ranko-hrm.vercel.app/api');
 assert.equal(r('/api/','https://preview.example.test'),'https://preview.example.test/api');
 assert.equal(r('http://localhost:3000/api/','http://localhost:5173'),'http://localhost:3000/api');
 for(const value of ['//outside.test/api','/\\outside.test','https://user:password@outside.test/api','/api?token=x','/api#secret','javascript:bad',''])assert.throws(()=>r(value,'https://app.example.test'));
});
function worker(processDue){let time=0,tick,cleared=false;const logs=[];const w=createEmploymentWorker({processDue,now:()=>time,schedule:fn=>(tick=fn,{unref(){}}),unschedule:()=>{cleared=true;},log:e=>logs.push(e),intervalMs:60,staleAfterMs:180});return {w,logs,tick:()=>tick(),advance:n=>{time+=n;},cleared:()=>cleared};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('employment worker keeps its interval, prevents overlap and stops before disconnect',async()=>{
 let calls=0,complete;const h=worker(()=>{calls++;return new Promise(r=>{complete=r;});});
 assert.equal(h.w.health().healthy,false);h.w.start();h.w.start();assert.equal(calls,0);h.tick();h.tick();await flush();assert.equal(calls,1);
 let stopped=false;const wait=h.w.stop().then(()=>{stopped=true;});await flush();assert.equal(stopped,false);assert.equal(h.cleared(),true);complete({failed:0});await wait;assert.equal(h.w.health().state,'stopped');assert.equal(h.logs[0].outcome,'success');
});
test('worker readiness exposes failures/stalls and recovers without business-data logs',async()=>{
 let fail=true;const h=worker(async()=>{if(fail)throw Error('private employee value');return {failed:0,unprocessedCaseIds:['private-id']};});
 h.w.start();h.tick();await flush();assert.equal(h.w.health().state,'degraded');fail=false;h.tick();await flush();assert.equal(h.w.health().state,'healthy');
 h.advance(181);assert.equal(h.w.health().state,'stale');assert.ok(!JSON.stringify(h.logs).includes('private'));await h.w.stop();
});
test('reported failed cases make worker unready even when processDue resolves',async()=>{
 const h=worker(async()=>({failed:1}));h.w.start();h.tick();await flush();assert.equal(h.w.health().healthy,false);await h.w.stop();
});
test('storage defaults are stable, production override is optional, Render must select its mount',()=>{
 assert.equal(getDocumentStorage({NODE_ENV:'production'}).storageRoot,path.resolve('/var/lib/adrankohrm/uploads'));
 assert.throws(()=>getDocumentStorage({NODE_ENV:'production',DOCUMENT_STORAGE_DIR:'private/docs'}));
 assert.throws(()=>getDocumentStorage({NODE_ENV:'production',RENDER:'true'}),/Render requires/);
 const project=path.resolve(os.tmpdir(),'synthetic-project');assert.throws(()=>getDocumentStorage({NODE_ENV:'production',DOCUMENT_STORAGE_DIR:path.join(project,'frontend/public/docs')},project));
 assert.equal(getDocumentStorage({NODE_ENV:'test'},project).storageRoot,path.join(project,'backend/uploads'));
 assert.equal(getDocumentStorage({NODE_ENV:'development',DOCUMENT_STORAGE_DIR:'uploads/override'},project).storageRoot,path.join(project,'backend/uploads/override'));
 const original=process.cwd();try{process.chdir(os.tmpdir());assert.equal(getDocumentStorage({NODE_ENV:'development'},project).storageRoot,path.join(project,'backend/uploads'));}finally{process.chdir(original);}
 for(const unsafe of [project,path.parse(project).root,path.join(project,'frontend/dist'),path.join(project,'backend/src/private'),path.join(project,'.git/private')])assert.throws(()=>getDocumentStorage({DOCUMENT_STORAGE_DIR:unsafe},project));
});

test('invalid storage reports a useful initialization error without falling back',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adranko-storage-failure-'));
 try{const file=path.join(root,'not-a-directory');await fs.writeFile(file,'retain');await assert.rejects(verifyDocumentStorage({storageRoot:path.join(file,'uploads'),publicRoots:[]}),/initialization failed.*no fallback/);assert.equal(await fs.readFile(file,'utf8'),'retain');}finally{await fs.rm(root,{recursive:true});}
});

test('a storage symlink into a frontend public tree is rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adranko-storage-symlink-'));
 try{const publicDir=path.join(root,'frontend/public');await fs.mkdir(publicDir,{recursive:true});const link=path.join(root,'private-link');await fs.symlink(publicDir,link,process.platform==='win32'?'junction':'dir');await assert.rejects(verifyDocumentStorage(getDocumentStorage({DOCUMENT_STORAGE_DIR:link},root)),/UNSAFE_PATH/);assert.deepEqual(await fs.readdir(publicDir),[]);}finally{await fs.rm(root,{recursive:true});}
});

test('startup reports denied writes without leaking filesystem details or choosing a fallback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adranko-storage-denied-'));
 try{t.mock.method(fs,'open',async()=>{throw Object.assign(Error('private path must not be logged'),{code:'EACCES'});});await assert.rejects(verifyDocumentStorage({storageRoot:root,publicRoots:[]}),error=>/EACCES/.test(error.message)&&!/private path/.test(error.message)&&/no fallback/.test(error.message));assert.deepEqual(await fs.readdir(root),[]);}finally{t.mock.restoreAll();await fs.rm(root,{recursive:true});}
});

test('Vercel API routing precedes the SPA and deployment build forces the same-origin base',async()=>{
 const root=path.resolve(__dirname,'../..'),config=JSON.parse(await fs.readFile(path.join(root,'frontend/vercel.json'),'utf8'));
 assert.deepEqual(config.rewrites[0],{source:'/api/:path*',destination:'https://adrankohrm.onrender.com/api/:path*'});
 const spa=new RegExp('^'+config.rewrites[1].source+'$');assert.equal(spa.test('/api'),false);assert.equal(spa.test('/api/auth/me'),false);assert.equal(spa.test('/assets/main.js'),false);assert.equal(spa.test('/reports/attendance/employee'),true);
 assert.equal(config.buildCommand,'npm run build:vercel');
});
test('storage startup probe leaves existing private files unchanged and removes only its canary',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adranko-storage-unit-'));
 try{await fs.writeFile(path.join(root,'existing.txt'),'retain');assert.deepEqual(await verifyDocumentStorage({storageRoot:root,publicRoots:[]}),{writable:true});assert.deepEqual(await fs.readdir(root),['existing.txt']);assert.equal(await fs.readFile(path.join(root,'existing.txt'),'utf8'),'retain');}
 finally{await fs.rm(root,{recursive:true});}
});
test('backup subprocess receives credentials through environment, requires remote TLS',()=>{
 const env=connectionEnv('postgresql://test:synthetic@127.0.0.1:55439/test_database');assert.equal(env.PGDATABASE,'test_database');assert.equal(env.PGSSLMODE,'disable');
 assert.throws(()=>connectionEnv('postgresql://test:synthetic@remote.example.test/db'));
 assert.equal(connectionEnv('postgresql://test:synthetic@remote.example.test/db?sslmode=require').PGSSLMODE,'verify-full');
});
test('incomplete backup cannot pass verification',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adranko-backup-unit-'));try{await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({version:1,complete:false}));await assert.rejects(verifyBackup(root));}finally{await fs.rm(root,{recursive:true});}
});

