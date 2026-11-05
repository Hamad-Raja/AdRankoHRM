const {test}=require('node:test'),assert=require('node:assert/strict'),{Client}=require('pg'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createIsolatedDatabase}=require('./isolated-db');
test('additive migration preserves legacy formatted content, receipts and deliveries without inventing recipients',async()=>{
 const db=await createIsolatedDatabase({throughMigration:'20261031000000_announcements_notifications'}),sql=new Client({connectionString:db.url});await sql.connect();
 try{const user=randomUUID(),announcement=randomUUID(),read=randomUUID(),notification=randomUUID();await sql.query(`INSERT INTO users(id,email,"displayName","passwordHash",role,"updatedAt") VALUES($1,'legacy@example.invalid','Legacy fixture','test-only-hash','HR',now())`,[user]);
  const content='<p>Original <b>formatted</b> content</p>\n<script>literal legacy text</script>';
  await sql.query(`INSERT INTO announcements(id,title,content,"authorUserId","publishedAt") VALUES($1,'Legacy notice',$2,$3,now())`,[announcement,content,user]);await sql.query('INSERT INTO announcement_reads(id,"announcementId","userId") VALUES($1,$2,$3)',[read,announcement,user]);await sql.query(`INSERT INTO notifications(id,"userId",title,message,type,link) VALUES($1,$2,'Legacy announcement','Legacy message','ANNOUNCEMENT','/announcements')`,[notification,user]);
  const before=(await sql.query('SELECT id,title,content,status,"authorUserId","publishedAt","createdAt","updatedAt" FROM announcements WHERE id=$1',[announcement])).rows[0],readBefore=(await sql.query('SELECT * FROM announcement_reads')).rows;
  await sql.query(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261031120000_announcement_notification_integrity/migration.sql'),'utf8'));
  assert.deepEqual((await sql.query('SELECT id,title,content,status,"authorUserId","publishedAt","createdAt","updatedAt" FROM announcements WHERE id=$1',[announcement])).rows[0],before);assert.deepEqual((await sql.query('SELECT * FROM announcement_reads')).rows,readBefore);
  assert.equal((await sql.query('SELECT "legacyReview","audienceFrozen" FROM announcements')).rows[0].legacyReview,true);assert.equal((await sql.query('SELECT count(*) FROM announcement_recipients')).rows[0].count,'0');assert.equal((await sql.query('SELECT count(*) FROM notification_events')).rows[0].count,'0');assert.equal((await sql.query('SELECT count(*) FROM notifications')).rows[0].count,'1');
 }finally{await sql.end();await db.cleanup();}
});
