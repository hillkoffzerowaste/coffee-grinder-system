import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// In-memory SQL integration tests only; never load environment files or connect to Neon.
test('scan batch migration and RPC contracts', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const file of ['001_neon.sql','002_manual_grinds.sql','003_thai_catalog.sql','004_complete_after_grinding.sql','005_scan_batch_grinding.sql']) {
    await db.exec(await readFile(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
  }
  const query = async (sql, values = []) => (await db.query(sql, values)).rows;
  const counter = randomUUID(), packer = randomUUID(), other = randomUUID(), admin = randomUUID(), wrongStation = randomUUID();
  for (const [id, name, role, station] of [
    [counter,'batch-counter','counter','counter'],[packer,'batch-packer','packer','packing'],
    [other,'batch-other','packer','both'],[admin,'batch-admin','admin','packing'],[wrongStation,'batch-wrong','packer','counter'],
  ]) {
    await query("insert into coffee.accounts(id,password_hash) values ($1,'fixture-only')", [id]);
    await query('insert into coffee.profiles(id,username,display_name,role,station) values ($1,$2,$2,$3,$4)', [id,name,role,station]);
  }
  const barcode = '001234567890123456789';
  const product = (await query("insert into coffee.products(sku,name,size_grams) values ('BATCH-TEST','Batch beans',250) returning id"))[0].id;
  await query('insert into coffee.product_barcodes(product_id,barcode) values ($1,$2)', [product,barcode]);
  const grind = (await query("select id from coffee.grind_size_codes where grind_value='6'"))[0].id;
  const grind8 = (await query("select id from coffee.grind_size_codes where grind_value='8'"))[0].id;
  const grinder = (await query("insert into coffee.grinder_users(name) values ('Batch grinder') returning id"))[0].id;
  const grinder2 = (await query("insert into coffee.grinder_users(name) values ('Batch grinder 2') returning id"))[0].id;
  const inactiveGrinder = (await query("insert into coffee.grinder_users(name,active) values ('Inactive batch grinder',false) returning id"))[0].id;
  const lines = (quantity = 3) => [{clientLineId:'line-1',productId:product,productBarcode:barcode,grindId:grind,grindBarcode:'990006',quantity}];
  async function rpc(actor, sql, values) {
    await query("select set_config('coffee.actor_id',$1,false)", [actor ?? '']);
    await db.exec('set role coffee_app');
    try { return (await query(sql,values))[0].result; }
    finally { await db.exec('reset role'); }
  }
  const create = (payload = lines(), actor = counter, key = randomUUID(), source = 'COUNTER') =>
    rpc(actor,'select coffee.create_order($1,$2,$3::jsonb) result',[key,source,JSON.stringify(payload)]);
  const start = (orderId, options = {}) => rpc(options.actor ?? packer,
    'select coffee.start_scan_batch($1,$2,$3,$4,$5,$6) result',[
      options.key === undefined ? randomUUID() : options.key,orderId,
      options.barcode === undefined ? barcode : options.barcode,
      options.grind === undefined ? grind : options.grind,
      options.quantity === undefined ? 2 : options.quantity,
      options.grinder === undefined ? grinder : options.grinder,
    ]);
  const manual = (payload = lines(), options = {}) => rpc(options.actor ?? packer,
    'select coffee.create_grinding_order($1,$2::jsonb,$3) result',[
      options.key === undefined ? randomUUID() : options.key,JSON.stringify(payload),
      options.grinder === undefined ? grinder : options.grinder,
    ]);
  const complete = (batchId, key = randomUUID(), actor = packer) =>
    rpc(actor,'select coffee.complete_scan_batch($1,$2) result',[key,batchId]);
  const transition = (id, expected, next, actor = admin) =>
    rpc(actor,'select coffee.transition_bag($1,$2,$3) result',[id,expected,next]);
  const bags = orderId => query('select * from coffee.bags where order_id=$1 order by queue_seq,id',[orderId]);
  async function snapshot() {
    const result = {};
    for (const table of ['orders','order_items','bags','job_events','print_jobs','outbox_events','audit_log','batch_requests']) {
      result[table] = await query(`select * from coffee.${table} order by ${table === 'batch_requests' ? 'request_id' : 'id'}`);
    }
    return result;
  }
  async function rejectsUnchanged(action, pattern) {
    const before = await snapshot();
    await assert.rejects(action, pattern);
    assert.deepEqual(await snapshot(),before,'failed command rolls back bags, orders, receipts and all side effects');
  }

  await t.test('selected order starts exactly earliest matching bags without changing global FIFO', async () => {
    const older = await create(lines(1));
    const order = await create([...lines(3),{...lines(1)[0],clientLineId:'eight',grindId:grind8,grindBarcode:'990008'}]);
    const before = await bags(order.id);
    await assert.rejects(transition(before[0].id,'QUEUED','CLAIMED',packer),/earliest/);
    const result = await start(order.id);
    assert.deepEqual(Object.keys(result).sort(),['bag_ids','batch_id','order_id','quantity']);
    assert.deepEqual(result.bag_ids,before.slice(0,2).map(b => b.id));
    assert.equal(result.order_id,order.id); assert.equal(result.quantity,2);
    assert.match(result.batch_id,/^[0-9a-f-]{36}$/);
    const after = await bags(order.id);
    for (const b of after.slice(0,2)) {
      assert.equal(b.status,'GRINDING'); assert.equal(b.claimed_by,packer);
      assert.equal(b.grinder_user_id,grinder); assert.equal(b.grinder_name_snapshot,'Batch grinder');
      assert.equal(b.grinding_batch_id,result.batch_id); assert.equal(b.version,2);
      assert.ok(b.started_at); assert.equal(b.lease_until,null);
    }
    assert.deepEqual(after.slice(2),before.slice(2));
    assert.equal((await bags(older.id))[0].status,'QUEUED');
    const events = await query("select from_status,to_status from coffee.job_events where bag_id=any($1::uuid[]) and to_status='GRINDING'",[result.bag_ids]);
    assert.equal(events.length,2); assert.ok(events.every(e => e.from_status==='QUEUED'));
    assert.equal((await query("select * from coffee.outbox_events where payload->>'batch_id'=$1",[result.batch_id])).length,2);
    assert.equal((await query("select * from coffee.audit_log where details->>'batch_id'=$1",[result.batch_id])).length,1);
    assert.equal((await query('select * from coffee.print_jobs where bag_id=any($1::uuid[])',[before.map(b => b.id)])).length,4);
  });

  await t.test('invalid quantities, barcode, grind, grinder and excess requests have no effects', async () => {
    const order = await create(lines(2));
    for (const quantity of [null,0,-1,501]) await rejectsUnchanged(() => start(order.id,{quantity}),/Invalid quantity/);
    await rejectsUnchanged(() => start(order.id,{quantity:3}),/Insufficient/);
    for (const value of [null,'123','RB-HK-TEST']) await rejectsUnchanged(() => start(order.id,{barcode:value}),/Invalid product barcode/);
    await rejectsUnchanged(() => start(order.id,{barcode:'999999'}),/Insufficient/);
    await rejectsUnchanged(() => start(order.id,{grind:grind8}),/Insufficient/);
    for (const value of [null,randomUUID()]) await rejectsUnchanged(() => start(order.id,{grind:value}),/Grind/);
    for (const value of [null,inactiveGrinder,randomUUID()]) await rejectsUnchanged(() => start(order.id,{grinder:value}),/active grinder/);
    await rejectsUnchanged(() => start(order.id,{key:null}),/Invalid request/);
    await rejectsUnchanged(() => start(randomUUID()),/Order not found/);
    await query('update coffee.grind_size_codes set active=false where id=$1',[grind]);
    await rejectsUnchanged(() => start(order.id),/Grind/);
    await query('update coffee.grind_size_codes set active=true where id=$1',[grind]);
  });

  await t.test('all three RPCs enforce active role and station inside SQL', async () => {
    const order = await create(lines(2));
    const batch = await start(order.id);
    for (const actor of [counter,wrongStation,randomUUID()]) {
      await rejectsUnchanged(() => start(order.id,{actor}),/FORBIDDEN/);
      await rejectsUnchanged(() => manual(lines(),{actor}),/FORBIDDEN/);
      await rejectsUnchanged(() => complete(batch.batch_id,randomUUID(),actor),/FORBIDDEN/);
    }
    await query('update coffee.profiles set active=false where id=$1',[packer]);
    await rejectsUnchanged(() => start(order.id),/FORBIDDEN/);
    await rejectsUnchanged(() => manual(),/FORBIDDEN/);
    await rejectsUnchanged(() => complete(batch.batch_id),/FORBIDDEN/);
    await query('update coffee.profiles set active=true where id=$1',[packer]);
  });

  await t.test('start receipt preserves result and rejects every altered fingerprint and actor', async () => {
    const order = await create(lines(5)), key = randomUUID();
    const result = await start(order.id,{key});
    const before = await snapshot();
    assert.deepEqual(await start(order.id,{key}),result);
    assert.deepEqual(await snapshot(),before);
    for (const changed of [{quantity:1},{barcode:'9999'},{grind:grind8},{grinder:grinder2},{actor:other}]) {
      await rejectsUnchanged(() => start(order.id,{key,...changed}),/Idempotency/);
    }
    await rejectsUnchanged(() => start(randomUUID(),{key}),/Idempotency/);
    await rejectsUnchanged(() => complete(result.batch_id,key),/Idempotency/);
    await rejectsUnchanged(() => manual(lines(),{key}),/Idempotency/);
    const second = await start(order.id,{quantity:2});
    assert.equal(new Set([...result.bag_ids,...second.bag_ids]).size,4);
    await query('update coffee.grinder_users set active=false where id=$1',[grinder]);
    assert.deepEqual(await start(order.id,{key}),result,'replay is independent of subsequent catalog changes');
    await query('update coffee.grinder_users set active=true where id=$1',[grinder]);
  });

  await t.test('legacy CLAIMED ownership is enforced and admin may adopt a claim', async () => {
    const order = await create(lines(3)), initial = await bags(order.id);
    await transition(initial[0].id,'QUEUED','CLAIMED');
    // Fixture represents pre-migration claims by two operators.
    await query('update coffee.bags set claimed_by=$1 where id=$2',[other,initial[0].id]);
    await transition(initial[1].id,'QUEUED','CLAIMED');
    await query('update coffee.bags set claimed_by=$1 where id=$2',[packer,initial[1].id]);
    const result = await start(order.id,{quantity:2});
    assert.deepEqual(result.bag_ids,initial.slice(1).map(b => b.id));
    await rejectsUnchanged(() => start(order.id,{quantity:1}),/Insufficient/);
    const adopted = await start(order.id,{quantity:1,actor:admin});
    assert.deepEqual(adopted.bag_ids,[initial[0].id]);
    assert.equal((await bags(order.id))[0].claimed_by,admin);
    const event = await query("select * from coffee.job_events where bag_id=$1 and to_status='GRINDING'",[initial[1].id]);
    assert.equal(event.length,1); assert.equal(event[0].from_status,'CLAIMED');
  });

  await t.test('manual order starts all lines and multiple grinds in one batch with immutable receipt', async () => {
    const payload = [...lines(2),{...lines(3)[0],clientLineId:'eight',grindId:grind8,grindBarcode:null}];
    const key = randomUUID(), result = await manual(payload,{key});
    assert.equal(result.source,'PACKING_MANUAL'); assert.equal(result.total_bags,5); assert.ok(result.order_no);
    const created = await bags(result.id);
    assert.equal(created.length,5); assert.ok(created.every(b => b.status==='GRINDING' && b.grinding_batch_id===result.batch_id && b.claimed_by===packer));
    assert.deepEqual(created.map(b => b.grind_id),[grind,grind,grind8,grind8,grind8]);
    assert.deepEqual(created.map(b => b.grind_value_snapshot),['6','6','8','8','8']);
    assert.equal((await query('select * from coffee.print_jobs where bag_id=any($1::uuid[])',[created.map(b => b.id)])).length,5);
    assert.equal((await query("select * from coffee.job_events where bag_id=any($1::uuid[]) and to_status='GRINDING'",[created.map(b => b.id)])).length,5);
    const before = await snapshot();
    assert.deepEqual(await manual(payload,{key}),result); assert.deepEqual(await snapshot(),before);
    await rejectsUnchanged(() => manual(payload,{key,grinder:grinder2}),/Idempotency/);
    await rejectsUnchanged(() => manual(lines(1),{key}),/Idempotency/);
    await rejectsUnchanged(() => manual(payload,{key,actor:other}),/Idempotency/);
    await complete(result.batch_id);
    assert.deepEqual(await manual(payload,{key}),result,'manual retry preserves original response after completion');
    assert.equal((await query('select status from coffee.orders where id=$1',[result.id]))[0].status,'COMPLETED');
  });

  await t.test('manual failures roll back the complete order and never adopt old pending orders', async () => {
    for (const quantity of [0,100,null,1.5,'2']) await rejectsUnchanged(() => manual(lines(quantity)),/Invalid quantity/);
    for (const payload of [null,[],{}]) await rejectsUnchanged(() => manual(payload),/Invalid lines/);
    await rejectsUnchanged(() => manual(lines(),{grinder:inactiveGrinder}),/active grinder/);
    await rejectsUnchanged(() => manual([...lines(),{...lines()[0],clientLineId:'bad',productBarcode:'9999'}]),/barcode mismatch/);
    await rejectsUnchanged(() => manual([{...lines()[0],grindBarcode:'990008'}]),/Grind/);
    await rejectsUnchanged(() => manual(Array.from({length:6},(_,i) => ({...lines(99)[0],clientLineId:String(i)}))),/Maximum 500/);
    const key = randomUUID();
    await create(lines(),packer,key,'PACKING_MANUAL');
    await rejectsUnchanged(() => manual(lines(),{key}),/existing order/);
    await rejectsUnchanged(() => manual(lines(),{key:null}),/Invalid request/);
    const recoveredKey = randomUUID();
    await assert.rejects(manual([{...lines()[0],productBarcode:'9999'}],{key:recoveredKey}),/barcode mismatch/);
    assert.ok((await manual(lines(),{key:recoveredKey})).batch_id,'failed receipt does not reserve request id');
  });

  await t.test('completion is atomic, owner-only, updates order and replays without events', async () => {
    const result = await manual(lines(3));
    await rejectsUnchanged(() => complete(result.batch_id,randomUUID(),other),/owned/);
    await rejectsUnchanged(() => complete(result.batch_id,randomUUID(),admin),/owned/);
    const initial = await bags(result.id);
    await query('update coffee.bags set claimed_by=$1 where id=$2',[other,initial[2].id]);
    await rejectsUnchanged(() => complete(result.batch_id),/owned/);
    await query('update coffee.bags set claimed_by=$1 where id=$2',[packer,initial[2].id]);
    const key = randomUUID(), done = await complete(result.batch_id,key);
    assert.deepEqual(done.bag_ids,initial.map(b => b.id)); assert.equal(done.quantity,3);
    const final = await bags(result.id);
    assert.ok(final.every(b => b.status==='COMPLETED' && b.claimed_by===null && b.completed_at && b.ground_at && b.version===3));
    assert.equal((await query('select status from coffee.orders where id=$1',[result.id]))[0].status,'COMPLETED');
    const before = await snapshot();
    assert.deepEqual(await complete(result.batch_id,key),done); assert.deepEqual(await snapshot(),before);
    await rejectsUnchanged(() => complete(randomUUID(),key),/Idempotency/);
    await rejectsUnchanged(() => complete(result.batch_id,key,other),/Idempotency/);
    const again = await complete(result.batch_id);
    assert.deepEqual(again.bag_ids,[]); assert.equal(again.quantity,0);
    await rejectsUnchanged(() => complete(randomUUID()),/Batch not found/);
    await rejectsUnchanged(() => complete(null),/Batch not found/);
    await rejectsUnchanged(() => complete(result.batch_id,null),/Invalid request/);
  });

  await t.test('cancelled/completed members stay terminal and blocked members prevent partial completion', async () => {
    const result = await manual(lines(3)), initial = await bags(result.id);
    await transition(initial[0].id,'GRINDING','CANCELLED');
    await transition(initial[1].id,'GRINDING','COMPLETED',packer);
    const done = await complete(result.batch_id);
    assert.deepEqual(done.bag_ids,[initial[2].id]);
    assert.deepEqual((await bags(result.id)).map(b => b.status),['CANCELLED','COMPLETED','COMPLETED']);
    const blocked = await manual(lines(2)), members = await bags(blocked.id);
    await transition(members[1].id,'GRINDING','BLOCKED');
    await rejectsUnchanged(() => complete(blocked.batch_id),/non-grinding/);
    await transition(members[1].id,'BLOCKED','CANCELLED');
    assert.equal((await complete(blocked.batch_id)).quantity,1);
    const cancelled = await manual(lines(1));
    await transition((await bags(cancelled.id))[0].id,'GRINDING','CANCELLED');
    assert.equal((await complete(cancelled.batch_id)).quantity,0);
    assert.equal((await query('select status from coffee.orders where id=$1',[cancelled.id]))[0].status,'CANCELLED');
  });

  await t.test('batch completion does not finish other batches or queued bags in same order', async () => {
    const order = await create(lines(5));
    const first = await start(order.id), second = await start(order.id);
    await complete(first.batch_id);
    assert.deepEqual((await bags(order.id)).map(b => b.status),['COMPLETED','COMPLETED','GRINDING','GRINDING','QUEUED']);
    assert.equal((await query('select status from coffee.orders where id=$1',[order.id]))[0].status,'OPEN');
    await complete(second.batch_id);
    assert.equal((await query('select status from coffee.orders where id=$1',[order.id]))[0].status,'OPEN');
  });

  await t.test('foreign key prevents mixing orders even through privileged writes', async () => {
    const result = await manual(lines(1)), another = await create(lines(1));
    await rejectsUnchanged(() => query('update coffee.bags set grinding_batch_id=$1 where order_id=$2',[result.batch_id,another.id]),/foreign key/);
  });

  await t.test('failure on the second event rolls back starts, manual creation and completion', async () => {
    // Fault injection after the first bag has been changed tests real transactional rollback.
    await db.exec(`create function coffee.test_batch_event_failure() returns trigger language plpgsql as $$
      begin
        if new.to_status=current_setting('coffee.test_fail_status',true) and exists(
          select 1 from coffee.job_events e join coffee.bags previous on previous.id=e.bag_id
          join coffee.bags current_bag on current_bag.id=new.bag_id
          where previous.order_id=current_bag.order_id and e.to_status=new.to_status
        ) then raise exception 'Injected second event failure'; end if;
        return new;
      end $$;
      create trigger test_batch_event_failure before insert on coffee.job_events
        for each row execute function coffee.test_batch_event_failure();`);
    try {
      const order = await create(lines(2)), startKey = randomUUID(), manualKey = randomUUID();
      await query("select set_config('coffee.test_fail_status','GRINDING',false)");
      await rejectsUnchanged(() => start(order.id,{key:startKey}),/Injected/);
      await rejectsUnchanged(() => manual(lines(2),{key:manualKey}),/Injected/);
      await query("select set_config('coffee.test_fail_status','',false)");
      const result = await start(order.id,{key:startKey});
      assert.ok((await manual(lines(2),{key:manualKey})).batch_id);
      const completeKey = randomUUID();
      await query("select set_config('coffee.test_fail_status','COMPLETED',false)");
      await rejectsUnchanged(() => complete(result.batch_id,completeKey),/Injected/);
      await query("select set_config('coffee.test_fail_status','',false)");
      assert.equal((await complete(result.batch_id,completeKey)).quantity,2);
    } finally {
      await query("select set_config('coffee.test_fail_status','',false)");
      await db.exec('drop trigger test_batch_event_failure on coffee.job_events; drop function coffee.test_batch_event_failure()');
    }
  });

  await t.test('receipts are private and guests cannot execute any new RPC', async () => {
    assert.equal((await query("select relrowsecurity from pg_class where oid='coffee.batch_requests'::regclass"))[0].relrowsecurity,true);
    await db.exec('set role coffee_app');
    try {
      for (const sql of ['select * from coffee.batch_requests', 'delete from coffee.batch_requests',
        "update coffee.batch_requests set response='{}'",'truncate coffee.batch_requests cascade',
        "insert into coffee.batch_requests(request_id) values (gen_random_uuid())",
        'update coffee.bags set grinding_batch_id=null']) await assert.rejects(query(sql),/permission denied/);
    } finally { await db.exec('reset role'); }
    await db.exec('set role coffee_guest');
    try {
      for (const sql of [
        'select coffee.start_scan_batch(null,null,null,null,null,null)',
        'select coffee.create_grinding_order(null,null,null)',
        'select coffee.complete_scan_batch(null,null)',
      ]) await assert.rejects(query(sql),/permission denied/);
    } finally { await db.exec('reset role'); }
  });
});
