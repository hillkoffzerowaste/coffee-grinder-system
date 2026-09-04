import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('database migrations and operational invariants', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile('database/migrations/001_neon.sql','utf8'));
  await db.exec(await readFile('database/migrations/002_manual_grinds.sql','utf8'));
  await db.exec(await readFile('database/migrations/003_thai_catalog.sql','utf8'));
  await db.exec(await readFile('database/migrations/004_complete_after_grinding.sql','utf8'));
  await db.exec('set search_path=coffee,pg_catalog');
  assert.equal((await db.query('select * from coffee.grind_size_codes')).rows.length,13);
  assert.equal((await db.query('select * from coffee.grind_size_codes where barcode is null')).rows.length,8);
  await t.test('Thai red-bag bean SKUs are searchable by their configured barcodes',async()=>{
    const products=(await db.query("select sku,name,barcode from products join product_barcodes on product_barcodes.product_id=products.id where sku in ('RB-HK-0061','RB-HK-0015','RB-HK-0095','RB-HK-0060') order by sku")).rows;
    assert.deepEqual(products,[
      {sku:'RB-HK-0015',name:'กาแฟซองแดง French 500 กรัม',barcode:'8857109002754'},
      {sku:'RB-HK-0060',name:'กาแฟซองแดง Italian 500 กรัม',barcode:'8857109002730'},
      {sku:'RB-HK-0061',name:'กาแฟซองแดง French 250 กรัม',barcode:'8857109002741'},
      {sku:'RB-HK-0095',name:'กาแฟซองแดง Italian 250 กรัม',barcode:'8857109011237'},
    ]);
  });
  const counter = randomUUID(), packer = randomUUID(), other = randomUUID(), admin = randomUUID();
  for (const [id, name, role, station] of [[counter,'counter','counter','counter'],[packer,'packer','packer','packing'],[other,'other','packer','packing'],[admin,'admin','admin','packing']]) {
    await db.query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')", [id]);
    await db.query('insert into profiles(id,username,display_name,role,station) values ($1,$2,$2,$3,$4)',[id,name,role,station]);
  }
  const product = (await db.query("insert into products(sku,name,size_grams) values ('RB-HK-TEST','Test beans',200) returning id")).rows[0].id;
  await db.query('insert into product_barcodes(product_id,barcode) values ($1,$2)',[product,'001234567890123456789']);
  const grind = (await db.query("select id from grind_size_codes where grind_value='6'")).rows[0].id;
  const grinder = (await db.query("insert into grinder_users(name) values ('Operator') returning id")).rows[0].id;
  const lines = [{clientLineId:'line-1',productId:product,productBarcode:'001234567890123456789',grindId:grind,grindBarcode:'990006',quantity:2}];
  async function as(id) { await db.query("select set_config('coffee.actor_id',$1,false)",[id]); }
  async function create(key = randomUUID(), payload = lines, source = 'COUNTER') {
    return (await db.query('select create_order($1,$2,$3::jsonb) as result',[key,source,JSON.stringify(payload)])).rows[0].result;
  }
  async function transition(id, expected, next, grindId = null) {
    return (await db.query('select transition_bag($1,$2,$3,$4,$5) as result',[id,expected,next,grinder,grindId])).rows[0].result;
  }
  let order, bags;
  await t.test('manual dropdown accepts all 5–17 without barcodes and keeps idempotency',async()=>{
    await db.exec('begin');
    try{
      await as(counter);
      for(const g of (await db.query('select * from coffee.grind_size_codes')).rows){
        const key=randomUUID(),manual=[{...lines[0],grindId:g.id,grindBarcode:null,quantity:1}];
        const result=await create(key,manual);assert.equal((await create(key,manual)).id,result.id);
        assert.equal((await db.query('select grind_value_snapshot from coffee.bags where order_id=$1',[result.id])).rows[0].grind_value_snapshot,g.grind_value);
      }
    }finally{await db.exec('rollback');}
  });
  await t.test('one order creates one job and print job per bag; retry is idempotent', async () => {
    await as(counter); const key = randomUUID(); order = await create(key);
    assert.equal(order.total_bags,2); assert.equal((await create(key)).id,order.id);
    bags = (await db.query('select * from bags where order_id=$1 order by queue_seq',[order.id])).rows;
    assert.equal(bags.length,2); assert.equal(bags[0].product_barcode_snapshot,lines[0].productBarcode);
    assert.equal((await db.query('select * from print_jobs')).rows.length,2);
    await assert.rejects(create(key,[{...lines[0],quantity:3}]),/Idempotency/);
    await assert.rejects(create(key,null),/Idempotency/);
  });
  await t.test('invalid barcode rolls back the whole order', async () => {
    await assert.rejects(create(randomUUID(),[lines[0],{...lines[0],clientLineId:'bad',productBarcode:'9999'}]),/barcode mismatch/);
    assert.equal((await db.query('select * from orders')).rows.length,1);
  });
  await t.test('role restrictions and invalid quantities are enforced inside SQL', async () => {
    await assert.rejects(create(randomUUID(),lines,'PACKING_MANUAL'),/FORBIDDEN/);
    for (const quantity of [0,100,null]) await assert.rejects(create(randomUUID(),[{...lines[0],quantity}]),/Invalid quantity/);
    await assert.rejects(transition(bags[0].id,'QUEUED','CLAIMED'),/FORBIDDEN/);
  });
  await t.test('FIFO, stale status, wrong grinder scan and operator ownership', async () => {
    await as(packer);
    await assert.rejects(transition(bags[1].id,'QUEUED','CLAIMED'),/earliest/);
    await transition(bags[0].id,'QUEUED','CLAIMED');
    await assert.rejects(transition(bags[0].id,'QUEUED','CLAIMED'),/Status changed/);
    await assert.rejects(transition(bags[0].id,'CLAIMED','GRINDING',randomUUID()),/Grind mismatch/);
    await as(other);
    await assert.rejects(transition(bags[0].id,'CLAIMED','GRINDING',grind),/owned/);
    await as(packer);
    await transition(bags[0].id,'CLAIMED','GRINDING',grind);
    const completed = await transition(bags[0].id,'GRINDING','COMPLETED');
    assert.equal(completed.status,'COMPLETED');
    assert.ok(completed.ground_at);
    assert.ok(completed.completed_at);
  });
  await t.test('new lifecycle rejects legacy packaging transitions and completes its order', async () => {
    await as(packer);
    await assert.rejects(transition(bags[1].id,'QUEUED','GROUND'),/Invalid transition/);
    await transition(bags[1].id,'QUEUED','CLAIMED');
    await transition(bags[1].id,'CLAIMED','GRINDING',grind);
    await assert.rejects(transition(bags[1].id,'GRINDING','GROUND'),/Invalid transition/);
    await transition(bags[1].id,'GRINDING','COMPLETED');
    assert.equal((await db.query('select status from orders where id=$1',[order.id])).rows[0].status,'COMPLETED');
  });
  await t.test('NULL expected status cannot bypass optimistic concurrency', async () => {
    await as(packer);
    await assert.rejects(transition(bags[1].id,null,'CLAIMED'),/Status changed/);
  });
  await t.test('admin cancellation closes a new order after its only bag is terminal', async () => {
    await as(counter); const cancelledOrder = await create(randomUUID(),[{...lines[0],quantity:1}]);
    const [cancelledBag] = (await db.query('select * from bags where order_id=$1',[cancelledOrder.id])).rows;
    await as(admin);
    await transition(cancelledBag.id,'QUEUED','CANCELLED');
    assert.equal((await db.query('select status from orders where id=$1',[cancelledOrder.id])).rows[0].status,'CANCELLED');
    assert.equal((await db.query('select status from print_jobs where bag_id=$1',[cancelledBag.id])).rows[0].status,'CANCELLED');
  });
  await t.test('SQL rejects same-status admin transitions', async () => {
    await as(counter); const blockedOrder = await create(randomUUID(),[{...lines[0],quantity:1}]);
    const [blockedBag] = (await db.query('select * from bags where order_id=$1',[blockedOrder.id])).rows;
    await as(admin);
    await transition(blockedBag.id,'QUEUED','BLOCKED');
    await assert.rejects(transition(blockedBag.id,'BLOCKED','BLOCKED'),/Invalid transition/);
  });
  await t.test('SQL rejects missing parameters and empty lines', async () => {
    await as(counter);
    await assert.rejects(create(null),/Invalid request id/);
    await assert.rejects(create(randomUUID(),null),/Invalid lines/);
    await assert.rejects(create(randomUUID(),[]),/Invalid lines/);
    await assert.rejects(create(randomUUID(),lines,null),/Invalid source/);
  });
  await t.test('inactive users cannot create orders', async () => {
    await db.query('update profiles set active=false where id=$1',[counter]);
    await as(counter); await assert.rejects(create(),/UNAUTHORIZED/);
  });
  await t.test('anonymous RPC and direct authenticated writes are denied', async () => {
    await db.exec('set role coffee_guest');
    await assert.rejects(create(),/permission denied/);
    await db.exec('reset role; set role coffee_app');
    await assert.rejects(db.exec("update bags set status='COMPLETED'"),/permission denied/);
    assert.equal((await db.query('select * from orders')).rows.length,0);
    await as(packer);
    assert.equal((await db.query('select * from orders')).rows.length,3);
    assert.equal((await db.query('select * from audit_log')).rows.length,0);
    await as(admin);
    assert.ok((await db.query('select * from audit_log')).rows.length > 0);
    await db.exec('reset role');
  });
  await t.test('authenticated roles cannot TRUNCATE tables, which bypasses RLS', async () => {
    await db.exec('begin; set local role coffee_app');
    try { await assert.rejects(db.exec('truncate products cascade'),/permission denied/); }
    finally { await db.exec('rollback'); }
  });
});

test('migration 004 retires legacy packing bags with events, audit records, and completed orders', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const file of ['001_neon.sql','002_manual_grinds.sql','003_thai_catalog.sql']) {
    await db.exec(await readFile(`database/migrations/${file}`,'utf8'));
  }
  const admin = randomUUID();
  const order = randomUUID();
  const ground = randomUUID();
  const packing = randomUUID();
  await db.query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')", [admin]);
  await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,'migration-admin','Migration admin','admin','both')", [admin]);
  const product=(await db.query("insert into coffee.products(sku,name,size_grams) values ('RB-HK-LEGACY','Legacy beans',200) returning id")).rows[0].id;
  const grind=(await db.query("select id from coffee.grind_size_codes where grind_value='6'")).rows[0].id;
  const item=randomUUID();
  await db.query("insert into coffee.orders(id,client_request_id,request_payload,source,status,total_bags,created_by) values ($1,$2,'{}','COUNTER','OPEN',2,$3)",[order,randomUUID(),admin]);
  await db.query("insert into coffee.order_items(id,order_id,product_id,grind_id,quantity,client_line_id) values ($1,$2,$3,$4,2,'legacy')",[item,order,product,grind]);
  for (const [bagNo, id, status] of [[1,ground,'GROUND'],[2,packing,'PACKING']]) {
    await db.query("insert into coffee.bags(id,order_id,order_item_id,product_id,grind_id,bag_no,status,product_name_snapshot,sku_snapshot,size_grams_snapshot,product_barcode_snapshot,grind_value_snapshot) values ($1,$2,$3,$4,$5,$6,$7,'Legacy beans','RB-HK-LEGACY',200,'001234567890123456789','6')",[id,order,item,product,grind,bagNo,status]);
  }
  await db.exec(await readFile('database/migrations/004_complete_after_grinding.sql','utf8'));
  const bags=(await db.query('select id,status,completed_at,claimed_by from coffee.bags where order_id=$1 order by id',[order])).rows;
  assert.deepEqual(bags.map(({id,status,completed_at,claimed_by})=>({id,status,hasCompletedAt:Boolean(completed_at),claimed_by})),[
    {id:ground,status:'COMPLETED',hasCompletedAt:true,claimed_by:null},
    {id:packing,status:'COMPLETED',hasCompletedAt:true,claimed_by:null},
  ].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal((await db.query('select status from coffee.orders where id=$1',[order])).rows[0].status,'COMPLETED');
  assert.equal((await db.query("select count(*)::int as count from coffee.job_events where bag_id in ($1,$2) and to_status='COMPLETED'",[ground,packing])).rows[0].count,2);
  assert.equal((await db.query("select count(*)::int as count from coffee.audit_log where action='RETIRE_PACKAGING_WORKFLOW' and entity='bags'",[])).rows[0].count,2);
});
