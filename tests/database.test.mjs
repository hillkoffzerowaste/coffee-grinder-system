import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('database migrations and operational invariants', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Only emulate Supabase identity plumbing; execute the real application SQL.
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;
    grant usage on schema public to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
    // gen_random_uuid is built into PostgreSQL; PGlite does not bundle pgcrypto.
    await db.exec(sql.replace('create extension if not exists pgcrypto;', ''));
  }
  const counter = randomUUID(), packer = randomUUID(), other = randomUUID(), admin = randomUUID();
  for (const [id, name, role, station] of [[counter,'counter','counter','counter'],[packer,'packer','packer','packing'],[other,'other','packer','packing'],[admin,'admin','admin','packing']]) {
    await db.query('insert into auth.users values ($1)', [id]);
    await db.query('insert into profiles(id,username,display_name,role,station) values ($1,$2,$2,$3,$4)',[id,name,role,station]);
  }
  const product = (await db.query("insert into products(sku,name,size_grams) values ('RB-HK-TEST','Test beans',200) returning id")).rows[0].id;
  await db.query('insert into product_barcodes(product_id,barcode) values ($1,$2)',[product,'001234567890123456789']);
  const grind = (await db.query("select id from grind_size_codes where grind_value='6'")).rows[0].id;
  const grinder = (await db.query("insert into grinder_users(name) values ('Operator') returning id")).rows[0].id;
  const lines = [{clientLineId:'line-1',productId:product,productBarcode:'001234567890123456789',grindId:grind,grindBarcode:'990006',quantity:2}];
  async function as(id) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
  async function create(key = randomUUID(), payload = lines, source = 'COUNTER') {
    return (await db.query('select create_order($1,$2,$3::jsonb) as result',[key,source,JSON.stringify(payload)])).rows[0].result;
  }
  async function transition(id, expected, next, grindId = null) {
    return (await db.query('select transition_bag($1,$2,$3,$4,$5) as result',[id,expected,next,grinder,grindId])).rows[0].result;
  }
  let order, bags;
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
    await transition(bags[0].id,'GRINDING','GROUND');
  });
  await t.test('packing records its owner and rejects another operator completing it', async () => {
    await as(other);
    const packing = await transition(bags[0].id,'GROUND','PACKING');
    assert.equal(packing.claimed_by,other);
    await as(packer);
    await assert.rejects(transition(bags[0].id,'PACKING','COMPLETED'),/owned/);
    await as(other); await transition(bags[0].id,'PACKING','COMPLETED');
  });
  await t.test('NULL expected status cannot bypass optimistic concurrency', async () => {
    await as(packer);
    await assert.rejects(transition(bags[1].id,null,'CLAIMED'),/Status changed/);
  });
  await t.test('admin cancellation closes an order only after every bag is terminal', async () => {
    await as(admin);
    await transition(bags[1].id,'QUEUED','CANCELLED');
    assert.equal((await db.query('select status from orders where id=$1',[order.id])).rows[0].status,'COMPLETED');
    assert.equal((await db.query('select status from print_jobs where bag_id=$1',[bags[1].id])).rows[0].status,'CANCELLED');
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
    await db.exec('set role anon');
    await assert.rejects(create(),/permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.exec("update bags set status='COMPLETED'"),/permission denied/);
    assert.equal((await db.query('select * from orders')).rows.length,0);
    await as(packer);
    assert.equal((await db.query('select * from orders')).rows.length,1);
    assert.equal((await db.query('select * from audit_log')).rows.length,0);
    await as(admin);
    assert.ok((await db.query('select * from audit_log')).rows.length > 0);
    await db.exec('reset role');
  });
  await t.test('authenticated roles cannot TRUNCATE tables, which bypasses RLS', async () => {
    await db.exec('begin; set local role authenticated');
    try { await assert.rejects(db.exec('truncate products cascade'),/permission denied/); }
    finally { await db.exec('rollback'); }
  });
});
