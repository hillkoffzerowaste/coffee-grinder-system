import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
const CRLF=new RegExp(String.fromCharCode(13)+String.fromCharCode(10),'g');
const LF=String.fromCharCode(10);

const require = createRequire(import.meta.url);
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

test('packing daily history counts a Bangkok day, accepts a picked day and stays closed to the counter',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  // ยึดสคีมาจริงจาก migration ไม่ประกาศตารางเอง fixture จะได้ไม่ drift จาก production
  for(const file of ['001_neon','002_manual_grinds','003_thai_catalog','004_complete_after_grinding','005_scan_batch_grinding',
    '006_admin_control_center','007_blend_groups','008_drop_legacy_start_scan_batch','009_grinding_requires_batch','010_order_notes']){
    await db.exec((await readFile(new URL(`../database/migrations/${file}.sql`,import.meta.url),'utf8')).replace(CRLF,LF));
  }
  await db.exec('set search_path=coffee,pg_catalog');
  await db.exec('delete from coffee.product_barcodes; delete from coffee.products;');

  const actor=randomUUID(),state={auth:{profile:{id:actor}},calls:[]};
  const daily=await loadRoute('../src/app/api/jobs/daily/route.ts',state,db);

  const counter=randomUUID();
  await db.query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')",[counter]);
  await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,'counter','counter','counter','counter')",[counter]);
  await db.query("select set_config('coffee.actor_id',$1,false)",[counter]);
  const grind=(await db.query("select id,barcode from coffee.grind_size_codes where grind_value='6'")).rows[0];
  async function product(sku,grams,barcode){
    const id=(await db.query('insert into coffee.products(sku,name,size_grams) values($1,$2,$3) returning id',[sku,sku,grams])).rows[0].id;
    await db.query('insert into coffee.product_barcodes(product_id,barcode) values($1,$2)',[id,barcode]);
    return {id,barcode};
  }
  const small=await product('DAILY-250',250,'001111111111'),large=await product('DAILY-500',500,'002222222222');
  const line=(p,quantity,id)=>({clientLineId:id,productId:p.id,productBarcode:p.barcode,grindId:grind.id,grindBarcode:grind.barcode,quantity});
  const order=async lines=>(await db.query('select coffee.create_order($1,$2,$3::jsonb) result',
    [randomUUID(),'COUNTER',JSON.stringify(lines)])).rows[0].result;
  const orderA=await order([line(small,1,'a1'),line(large,1,'a2')]);
  const orderB=await order([line(small,3,'b1')]);
  const bagsOf=async o=>(await db.query('select id from coffee.bags where order_id=$1 order by queue_seq',[o.id])).rows.map(r=>r.id);
  const [a1,a2]=await bagsOf(orderA),[b1,b2]=await bagsOf(orderB);
  const bkkMidnight="date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'";
  const finish=(id,who,offset)=>db.query(
    `update coffee.bags set status='COMPLETED',grinder_name_snapshot=$2,completed_at=${bkkMidnight} + $3::interval where id=$1`,[id,who,offset]);

  await finish(a1,'สมชาย','3 hours');
  await finish(a2,'สมชาย','4 hours');
  await finish(b1,'มานี','5 hours');
  // ก่อนเที่ยงคืนไทยหนึ่งวินาที ต้องไม่ถูกนับเป็นงานของวันนี้
  await finish(b2,'มานี','-1 second');
  // ถุงที่สามของออเดอร์ B ยังไม่เสร็จ จึงไม่ถูกนับไม่ว่าเวลาไหน

  const call=async q=>(await daily(new Request(`http://localhost/api/jobs/daily${q}`))).json();
  const body=await call('');
  assert.deepEqual(state.roles,['packer','admin'],'counter role must not reach the packing history');
  assert.equal(body.daily.bags,3);
  assert.equal(body.daily.grams,1000);
  assert.equal(body.daily.orders,2);
  assert.deepEqual(body.daily.by_grinder,[{name:'สมชาย',bags:2},{name:'มานี',bags:1}]);
  assert.deepEqual(body.daily.orders_list.map(o=>[o.order_no,o.bags]),[[orderB.order_no,1],[orderA.order_no,2]]);

  // เลือกวันย้อนหลังต้องมีขอบบนด้วย ไม่งั้นจะกวาดงานของวันถัด ๆ ไปมารวม
  const today=body.daily.day;
  const yesterday=new Date(`${today}T00:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const past=await call(`?day=${yesterday.toISOString().slice(0,10)}`);
  assert.equal(past.daily.day,yesterday.toISOString().slice(0,10));
  assert.equal(past.daily.bags,1,'only the bag finished just before Bangkok midnight belongs to yesterday');
  assert.equal(past.daily.grams,250);

  for (const bad of ['2026-13-01','2026-02-30','8/9/2026','today',"2026-09-08' or '1"]) {
    assert.equal((await daily(new Request(`http://localhost/api/jobs/daily?day=${encodeURIComponent(bad)}`))).status,400,bad);
  }

  state.fail=true;
  const failed=await daily(new Request('http://localhost/api/jobs/daily'));
  assert.equal(failed.status,503);
});
