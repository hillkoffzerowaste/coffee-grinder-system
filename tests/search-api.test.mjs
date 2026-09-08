import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
// Execute actual route handlers with isolated auth/DB adapters; no Next server or env files.
async function loadRoute(path, state, db) {
  const source = await readFile(new URL(path,import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  const imports = {
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/auth':{requireApiUser:async roles => {state.roles=roles;return state.auth;}},
    '@/lib/db':{
      readRows:async(actor,sql,values)=>{state.calls.push({actor,sql,values});if(state.fail)throw new Error('fixture');return (await db.query(sql,values)).rows;},
      databaseError:()=>({message:'Database unavailable',status:503}),
    },
  };
  new Function('require','exports',compiled)(name => imports[name] ?? require(name),exports);
  return exports.GET;
}

test('catalog and jobs search routes',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  // ยึดสคีมาจริงจาก migration ไม่ประกาศตารางเอง ไม่งั้น fixture จะ drift จาก production เงียบ ๆ
  for(const file of ['001_neon','002_manual_grinds','003_thai_catalog','004_complete_after_grinding','005_scan_batch_grinding',
    '006_admin_control_center','007_blend_groups','008_drop_legacy_start_scan_batch','009_grinding_requires_batch','010_order_notes']){
    await db.exec((await readFile(new URL(`../database/migrations/${file}.sql`,import.meta.url),'utf8')).replace(/\r\n/g,'\n'));
  }
  await db.exec('set search_path=coffee,pg_catalog');
  // แคตตาล็อกที่ seed มาจะไปปนผลค้นหา จึงเคลียร์ให้เหลือเฉพาะของกรณีทดสอบ
  await db.exec('delete from coffee.product_barcodes; delete from coffee.products;');

  const actor=randomUUID(),state={auth:{profile:{id:actor}},calls:[]};
  const catalog=await loadRoute('../src/app/api/catalog/search/route.ts',state,db);
  const jobs=await loadRoute('../src/app/api/jobs/route.ts',state,db);
  const request=params=>new Request(`http://localhost/api/test?${new URLSearchParams(params)}`);
  let barcodeSeq=100000;
  async function product(name,sku,active=true,barcodes=null){
    const id=randomUUID();
    barcodes??=[[String(++barcodeSeq),true]]; // สคีมาจริงบังคับบาร์โค้ดไม่ซ้ำ
    await db.query('insert into coffee.products(id,sku,name,size_grams,active) values($1,$2,$3,250,$4)',[id,sku,name,active]);
    for(const [barcode,enabled] of barcodes)await db.query('insert into coffee.product_barcodes(product_id,barcode,active) values($1,$2,$3)',[id,barcode,enabled]);
    return id;
  }
  const thai=await product('กาแฟ French Roast','RB-HK-THAI',true,[['009999',true],['001234',true],['000001',false]]);
  await product('Hidden French','INACTIVE',false,[['001240',true]]);
  await product('Hidden French','NO-BARCODE',true,[]);
  await product('Hidden French','DISABLED-BARCODE',true,[['001235',false]]);
  const literal=await product('100%_Coffee','LITERAL',true,[['001241',true]]);

  // ออเดอร์และถุงสร้างผ่านฟังก์ชันจริง ทุก NOT NULL และ FK จึงถูกบังคับเหมือน production
  const counter=randomUUID();
  await db.query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')",[counter]);
  await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,'counter','counter','counter','counter')",[counter]);
  await db.query("select set_config('coffee.actor_id',$1,false)",[counter]);
  const grind=(await db.query("select id,barcode from coffee.grind_size_codes where grind_value='6'")).rows[0];
  const created=(await db.query('select coffee.create_order($1,$2,$3::jsonb,$4) result',[randomUUID(),'COUNTER',
    JSON.stringify([{clientLineId:'l1',productId:thai,productBarcode:'001234',grindId:grind.id,grindBarcode:grind.barcode,quantity:3}]),
    'ลูกค้าขอบดหยาบ'])).rows[0].result;
  const order=created.id,orderNo=created.order_no;
  const bagIds=(await db.query('select id from coffee.bags where order_id=$1 order by queue_seq',[order])).rows.map(r=>r.id);
  const first=bagIds[0];
  // ชุดงานต้องมาจาก start_scan_batch จริง เพราะ grinding_batch_id มี FK ผูกกับออเดอร์
  const packer=randomUUID();
  await db.query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')",[packer]);
  await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,'packer','packer','packer','packing')",[packer]);
  const grinderId=(await db.query("insert into coffee.grinder_users(name) values ('ผู้ทดสอบ') returning id")).rows[0].id;
  await db.query("select set_config('coffee.actor_id',$1,false)",[packer]);
  const batch=(await db.query('select coffee.start_scan_batch($1,$2,$3,$4,$5,$6,$7) result',
    [randomUUID(),order,'001234',grind.id,3,grinderId,1])).rows[0].result.batch_id;
  await db.query("update coffee.bags set status='QUEUED' where id=$1",[first]);
  await db.query("update coffee.bags set status='COMPLETED' where id=$1",[bagIds[2]]);

  await t.test('auth is identical to catalog product and packing jobs permissions',async()=>{
    state.auth={error:Response.json({error:'UNAUTHORIZED'},{status:401})};state.calls=[];
    assert.equal((await catalog(request({q:'French'}))).status,401);assert.equal(state.roles,undefined);
    assert.equal((await jobs(request({search:'French'}))).status,401);assert.deepEqual(state.roles,['packer','admin']);
    assert.equal(state.calls.length,0);state.auth={profile:{id:actor}};
  });
  await t.test('bounds and null bytes reject before any database call',async()=>{
    state.calls=[];
    for(const value of ['', '   ','x'.repeat(101),'bad\0query']){
      assert.equal((await catalog(request({q:value}))).status,400);
      assert.equal((await jobs(request({search:value}))).status,400);
    }
    assert.equal((await catalog(request({}))).status,400);assert.equal(state.calls.length,0);
    assert.equal((await catalog(request({q:'x'.repeat(100)}))).status,200);
  });
  await t.test('Thai, case-insensitive English and SKU match one active barcode per product',async()=>{
    for(const q of ['กาแฟ',' fReNcH ','rb-hk-thai']){
      const response=await catalog(request({q}));assert.equal(response.status,200);
      assert.deepEqual((await response.json()).products,[{id:thai,sku:'RB-HK-THAI',name:'กาแฟ French Roast',size_grams:250,unit:'Pcs',barcode:'001234'}]);
      assert.equal(state.calls.at(-1).actor,actor);
      assert.deepEqual(state.calls.at(-1).values,[q.trim()]);
    }
  });
  await t.test('wildcards and injection text are literal bound parameters',async()=>{
    assert.deepEqual((await (await catalog(request({q:'%_'}))).json()).products.map(p=>p.id),[literal]);
    const injection="' OR true --";
    assert.deepEqual((await (await catalog(request({q:injection}))).json()).products,[]);
    assert.equal(state.calls.at(-1).sql.includes(injection),false);
    assert.deepEqual(state.calls.at(-1).values,[injection]);
    assert.deepEqual((await (await jobs(request({search:injection}))).json()).jobs,[]);
    assert.deepEqual((await (await jobs(request({search:'%'}))).json()).jobs,[]);
  });
  await t.test('catalog is deterministically capped at twenty products',async()=>{
    for(let n=0;n<25;n++)await product(`Bounded ${String(n).padStart(2,'0')}`,`BOUND-${n}`);
    const one=(await (await catalog(request({q:'bounded'}))).json()).products;
    const two=(await (await catalog(request({q:'bounded'}))).json()).products;
    assert.equal(one.length,20);assert.deepEqual(one,two);assert.equal(one[0].name,'Bounded 00');assert.equal(one[19].name,'Bounded 19');
  });
  await t.test('jobs match snapshots and order number, never terminal jobs during search',async()=>{
    for(const search of ['กาแฟ',' fReNcH ','rb-hk-thai',orderNo.toLowerCase()]){
      const result=await (await jobs(request({search}))).json();
      assert.equal(result.jobs.length,2);assert.equal(result.queuedCount,1);
      assert.ok(result.jobs.every(j=>j.status!=='COMPLETED'));
    }
    assert.deepEqual((await (await jobs(request({search:'French',status:'COMPLETED'}))).json()).jobs,[]);
    // Existing explicit history retrieval remains unchanged when search is absent.
    assert.equal((await (await jobs(request({status:'COMPLETED'}))).json()).jobs.length,1);
  });
  await t.test('scan barcode, queue, UUID and order/batch predicates retain intersection semantics',async()=>{
    for(const scan of ['001234','1',first]){
      const result=await (await jobs(request({scan}))).json();
      assert.ok(result.jobs.some(j=>j.id===first));
      assert.equal(result.jobs.find(j=>j.id===first).orders.note,'ลูกค้าขอบดหยาบ','packing queue carries the counter note');
    }
    assert.equal((await (await jobs(request({search:'French',scan:'1',orderId:order,batch}))).json()).jobs.length,1);
    assert.deepEqual((await (await jobs(request({search:'French',scan:'9999'}))).json()).jobs,[]);
    assert.deepEqual((await (await jobs(request({search:'French',orderId:randomUUID()}))).json()).jobs,[]);
    assert.equal((await jobs(request({scan:'invalid-scan'}))).status,400);
  });
  await t.test('database errors retain established API error mapping',async()=>{
    state.fail=true;
    try{assert.equal((await catalog(request({q:'French'}))).status,503);assert.equal((await jobs(request({search:'French'}))).status,503);}
    finally{state.fail=false;}
  });
});
