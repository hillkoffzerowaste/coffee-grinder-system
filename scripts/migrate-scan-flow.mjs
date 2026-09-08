// Explicit additive migration only; no catalog reseed or account changes.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
const url=new URL(process.env.DATABASE_URL_UNPOOLED);
if(!process.env.MIGRATION_TARGET_HOST||url.hostname!==process.env.MIGRATION_TARGET_HOST||url.hostname.includes('-pooler'))throw new Error('Explicit direct migration host required');
url.searchParams.set('sslmode','verify-full');
const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000});
await client.connect();
try{
 await client.query('begin');
 await client.query("set local lock_timeout='10s'");
 await client.query("select pg_advisory_xact_lock(hashtext('coffee-neon-bootstrap'))");
 for(const name of ['001_neon','002_manual_grinds','003_thai_catalog','004_complete_after_grinding','005_scan_batch_grinding','006_admin_control_center','007_blend_groups']){
  const sql=(await readFile(`database/migrations/${name}.sql`,'utf8')).replace(/\r\n/g,'\n');
  const checksum=createHash('sha256').update(sql).digest('hex');
  const previous=(await client.query('select checksum from coffee.schema_migrations where version=$1',[name])).rows[0];
  if(previous){if(previous.checksum!==checksum)throw new Error(`Checksum mismatch: ${name}`);continue;}
  const required={'002_manual_grinds':'001_neon','003_thai_catalog':'002_manual_grinds','004_complete_after_grinding':'003_thai_catalog','005_scan_batch_grinding':'004_complete_after_grinding','006_admin_control_center':'005_scan_batch_grinding','007_blend_groups':'006_admin_control_center'}[name];
  if(required && !(await client.query('select 1 from coffee.schema_migrations where version=$1',[required])).rowCount) throw new Error(`Required prior migration missing: ${required}`);
  await client.query(sql);
  await client.query('insert into coffee.schema_migrations(version,checksum) values($1,$2)',[name,checksum]);
 }
 await client.query('commit');
 console.log('Latest coffee migrations applied and checksums verified on '+url.hostname);
}catch(error){await client.query('rollback');console.error('Migration failed:',error.code??error.message);process.exitCode=1;}
finally{await client.end();}
