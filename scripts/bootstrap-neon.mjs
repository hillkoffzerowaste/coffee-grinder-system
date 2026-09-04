import { readFile, writeFile, readdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import { hashPassword } from '../src/lib/password.ts';

// Explicit deployment operation. Never log connection strings or generated passwords.
const url = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
url.searchParams.set('sslmode','verify-full');
const client = new Client({connectionString:url.toString(),connectionTimeoutMillis:15000});
function csv(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if(ch==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift();return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
await client.connect();
try {
 await client.query('begin');
 await client.query("select pg_advisory_xact_lock(hashtext('coffee-neon-bootstrap'))");
 const migration=(await readFile('database/migrations/001_neon.sql','utf8')).replace(/\r\n/g,'\n');
 const checksum=createHash('sha256').update(migration).digest('hex');
 const exists=(await client.query("select to_regnamespace('coffee') as schema")).rows[0].schema;
 if(!exists) {
   await client.query(migration);
   await client.query('create table coffee.schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())');
   await client.query('insert into coffee.schema_migrations(version,checksum) values ($1,$2)',['001_neon',checksum]);
 } else {
   const current=(await client.query("select checksum from coffee.schema_migrations where version='001_neon'")).rows[0];
   if(current?.checksum!==checksum)throw new Error('Existing schema migration checksum mismatch; refusing changes');
 }
 for(const file of (await readdir('database/migrations')).filter(f=>f.endsWith('.sql')&&f!=='001_neon.sql').sort()){
   const sql=(await readFile('database/migrations/'+file,'utf8')).replace(/\r\n/g,'\n');
   const digest=createHash('sha256').update(sql).digest('hex'),version=file.slice(0,-4);
   const previous=(await client.query('select checksum from coffee.schema_migrations where version=$1',[version])).rows[0];
   if(previous){if(previous.checksum!==digest)throw new Error('Migration checksum mismatch: '+version);continue;}
   await client.query(sql);await client.query('insert into coffee.schema_migrations(version,checksum) values ($1,$2)',[version,digest]);
 }
 const seeded=(await client.query("select version from coffee.schema_migrations where version='seed_catalog_v1'")).rowCount;
 if(!seeded){
   const items=csv(await readFile('data/sku-coffee-beans-200g-plus.csv','utf8'));
   if(items.length!==139||new Set(items.map(i=>i.sku)).size!==139)throw new Error('Unexpected catalog size');
   for(const item of items){
     if(!(Number(item.size_grams)>=200))throw new Error('Invalid size');
     const product=(await client.query('insert into coffee.products(sku,name,size_grams,unit) values ($1,$2,$3,$4) returning id',[item.sku,item.product_name,Number(item.size_grams),item.unit])).rows[0];
     for(const code of item.barcode.split(',').map(s=>s.trim()).filter(Boolean))await client.query('insert into coffee.product_barcodes(product_id,barcode) values ($1,$2)',[product.id,code]);
   }
   await client.query("insert into coffee.schema_migrations(version,checksum) values ('seed_catalog_v1',$1)",[checksum]);
 }
 let saved;
 try {saved=JSON.parse(await readFile('.production-accounts.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;saved={accounts:[]};}
 for(const [username,role,station,displayName] of [['admin','admin','both','ผู้ดูแลระบบ'],['counter','counter','counter','หน้าร้าน'],['packing','packer','packing','ห้องแพ็ค']]){
   if((await client.query('select id from coffee.profiles where username=$1',[username])).rowCount)continue;
   let credential=saved.accounts.find(a=>a.username===username);
   if(!credential){credential={username,password:randomBytes(24).toString('base64url'),station};saved.accounts.push(credential);}
   // Persist before commit so interruption cannot lose generated credentials.
   await writeFile('.production-accounts.json',JSON.stringify(saved,null,2),{mode:0o600});
   const account=(await client.query('insert into coffee.accounts(password_hash) values ($1) returning id',[await hashPassword(credential.password)])).rows[0];
   await client.query('insert into coffee.profiles(id,username,display_name,role,station) values ($1,$2,$3,$4,$5)',[account.id,username,displayName,role,station]);
 }
 await client.query('commit');
 const counts=(await client.query('select (select count(*) from coffee.products) products,(select count(*) from coffee.product_barcodes) barcodes,(select count(*) from coffee.profiles) users')).rows[0];
 console.log(JSON.stringify({migration:'ready',...counts,credentialsFile:'.production-accounts.json'}));
} catch(error){await client.query('rollback').catch(()=>{});console.error('Bootstrap failed:',error.code||error.message);process.exitCode=1;}
finally{await client.end();}
