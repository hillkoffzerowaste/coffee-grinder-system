import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';

// Opt-in verifier for this exact disposable branch. No dotenv, migrations or fallback URL.
// Main supplies both environment variables and runs this file explicitly.
// Committed, uniquely tagged test fixtures remain on the branch for inspection.
const TEST_HOST = 'ep-bold-cloud-aukqpqls.c-10.us-east-1.aws.neon.tech';
const tag = `scan-batch-verify-${randomUUID()}`;
let stage = 'host guard';
const clients = [];
let connectionError = false;

function guardedConfig() {
  if (process.env.EXPECTED_TEST_HOST !== TEST_HOST) throw new Error('Expected host must match pinned branch');
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('Missing direct database URL');
  const url = new URL(process.env.DATABASE_URL_UNPOOLED);
  if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== TEST_HOST ||
      (url.port && url.port !== '5432') || url.hash || !url.username || !url.password ||
      !/^\/[^/]+$/.test(url.pathname)) throw new Error('Rejected database target');
  for (const key of url.searchParams.keys()) {
    if (!['sslmode','channel_binding'].includes(key)) throw new Error('Rejected connection override');
  }
  // Explicit fields prevent pg URL query parameters or PGHOST from overriding the guard.
  return {
    host: TEST_HOST, port: 5432, user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: TEST_HOST },
    enableChannelBinding: true, connectionTimeoutMillis: 15000,
    statement_timeout: 20000, query_timeout: 25000, application_name: tag,
  };
}

async function beginActor(client, actor) {
  await client.query('begin');
  await client.query("set local statement_timeout='20s'");
  await client.query("set local lock_timeout='15s'");
  await client.query("set local idle_in_transaction_session_timeout='30s'");
  await client.query("select set_config('coffee.actor_id',$1,true)", [actor]);
  await client.query('set local role coffee_app');
}

async function command(client, actor, sql, values) {
  await beginActor(client, actor);
  try {
    const result = (await client.query(sql, values)).rows[0].result;
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function main() {
  const config = guardedConfig(); // Must precede constructing or connecting any client.
  for (let i=0;i<3;i++) {
    const client = new Client(config);
    client.on('error', () => { connectionError = true; }); // Never print raw driver errors.
    clients.push(client);
  }
  const [observer, first, second] = clients;
  stage = 'connect guarded test branch';
  await Promise.all(clients.map(c => c.connect()));
  const pids = await Promise.all(clients.map(async c => (await c.query('select pg_backend_pid() pid')).rows[0].pid));
  assert.equal(new Set(pids).size,3);
  stage = 'verify migration and fixture prerequisites';
  const functions = (await observer.query(`select
    to_regprocedure('coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid)') is not null as start,
    to_regprocedure('coffee.create_grinding_order(uuid,jsonb,uuid)') is not null as manual,
    to_regprocedure('coffee.complete_scan_batch(uuid,uuid)') is not null as complete`)).rows[0];
  assert.ok(functions.start && functions.manual && functions.complete);
  const actors = (await observer.query(`select id,role from coffee.profiles where active and
    ((role='counter' and station in ('counter','both')) or
     (role in ('packer','admin') and station in ('packing','both'))) order by role,id`)).rows;
  const counter = actors.find(a => a.role==='counter')?.id;
  const packer = actors.find(a => a.role==='packer')?.id ?? actors.find(a => a.role==='admin')?.id;
  assert.ok(counter && packer);
  const product = (await observer.query(`select p.id,pb.barcode from coffee.products p
    join coffee.product_barcodes pb on pb.product_id=p.id
    where p.active and pb.active and p.size_grams>=200 order by p.id,pb.id limit 1`)).rows[0];
  const grinds = (await observer.query(`select id,barcode from coffee.grind_size_codes
    where active and grind_value in ('6','8') order by grind_value`)).rows;
  assert.ok(product); assert.equal(grinds.length,2);
  const line = (grind, quantity, suffix) => ({clientLineId:`${tag}-${suffix}`,productId:product.id,
    productBarcode:product.barcode,grindId:grind.id,grindBarcode:grind.barcode,quantity});

  stage = 'commit isolated grinder and three-bag order';
  await observer.query('begin');
  let grinder, order;
  try {
    grinder = (await observer.query('insert into coffee.grinder_users(name) values ($1) returning id',[tag])).rows[0].id;
    await observer.query("select set_config('coffee.actor_id',$1,true)",[counter]);
    await observer.query('set local role coffee_app');
    order = (await observer.query("select coffee.create_order($1,'COUNTER',$2::jsonb) result",
      [randomUUID(),JSON.stringify([line(grinds[0],3,'race')])])).rows[0].result;
    await observer.query('commit');
  } catch (error) { await observer.query('rollback').catch(() => {}); throw error; }
  const members = (await observer.query('select id from coffee.bags where order_id=$1 order by queue_seq,id',[order.id])).rows.map(b => b.id);
  assert.equal(members.length,3);
  const startSql = 'select coffee.start_scan_batch($1,$2,$3,$4,$5,$6) result';
  const winnerKey = randomUUID(), loserKey = randomUUID();
  const startArgs = key => [key,order.id,product.barcode,grinds[0].id,2,grinder];

  stage = 'competing starts: observe actual parent-order lock contention';
  await beginActor(first,packer);
  const winner = (await first.query(startSql,startArgs(winnerKey))).rows[0].result;
  // Hold the successful transaction uncommitted; prove the second backend really waits.
  await beginActor(second,packer);
  const waiting = second.query(startSql,startArgs(loserKey)).then(
    result => ({result}), error => ({error}),
  );
  let blocked = false;
  try {
    const deadline = Date.now()+8000;
    while (Date.now()<deadline) {
      blocked = (await observer.query('select $1::int=any(pg_blocking_pids($2::int)) blocked',[pids[1],pids[2]])).rows[0].blocked;
      if (blocked) break;
      await delay(25);
    }
    assert.ok(blocked,'second client must be observed waiting for first');
    await first.query('commit');
  } finally {
    if (!blocked) await first.query('rollback').catch(() => {});
  }
  const losing = await waiting;
  await second.query('rollback');
  assert.ok(losing.error);
  assert.equal(losing.error.code,'P0001');
  assert.match(losing.error.message,/Insufficient matching eligible bags/);
  assert.deepEqual(winner.bag_ids,members.slice(0,2));
  const afterRace = (await observer.query('select id,status,grinding_batch_id from coffee.bags where order_id=$1 order by queue_seq,id',[order.id])).rows;
  assert.deepEqual(afterRace.map(b => b.status),['GRINDING','GRINDING','QUEUED']);
  assert.equal(afterRace[2].grinding_batch_id,null);
  assert.equal((await observer.query('select count(*)::int n from coffee.batch_requests where request_id=$1',[loserKey])).rows[0].n,0);

  stage = 'retry winning request on both independent clients';
  const replays = await Promise.all([first,second].map(c => command(c,packer,startSql,startArgs(winnerKey))));
  for (const replay of replays) assert.deepEqual(replay,winner);
  assert.equal((await observer.query("select count(*)::int n from coffee.job_events where bag_id=any($1::uuid[]) and to_status='GRINDING'",[members])).rows[0].n,2);
  assert.equal((await observer.query('select count(*)::int n from coffee.batch_requests where order_id=$1',[order.id])).rows[0].n,1);

  stage = 'concurrent manual multi-grind creation with same request';
  const manualSql = 'select coffee.create_grinding_order($1,$2::jsonb,$3) result';
  const manualArgs = [randomUUID(),JSON.stringify([line(grinds[0],2,'manual-six'),line(grinds[1],1,'manual-eight')]),grinder];
  const manuals = await Promise.all([first,second].map(c => command(c,packer,manualSql,manualArgs)));
  assert.deepEqual(manuals[0],manuals[1]);
  const manual = manuals[0];
  assert.equal(manual.total_bags,3); assert.ok(manual.order_no && manual.batch_id);
  const manualBags = (await observer.query('select id,status,grind_id,grinding_batch_id,claimed_by from coffee.bags where order_id=$1 order by queue_seq,id',[manual.id])).rows;
  assert.equal(manualBags.length,3);
  assert.ok(manualBags.every(b => b.status==='GRINDING' && b.claimed_by===packer && b.grinding_batch_id===manual.batch_id));
  assert.deepEqual(manualBags.map(b => b.grind_id),[grinds[0].id,grinds[0].id,grinds[1].id]);
  assert.equal((await observer.query('select count(*)::int n from coffee.print_jobs where bag_id=any($1::uuid[])',[manualBags.map(b => b.id)])).rows[0].n,3);

  stage = 'concurrent completion and immutable completion replay';
  const completeSql = 'select coffee.complete_scan_batch($1,$2) result';
  const completeArgs = [randomUUID(),manual.batch_id];
  const completed = await Promise.all([first,second].map(c => command(c,packer,completeSql,completeArgs)));
  assert.deepEqual(completed[0],completed[1]);
  assert.deepEqual(completed[0].bag_ids,manualBags.map(b => b.id));
  assert.equal(completed[0].quantity,3);
  assert.deepEqual(await command(first,packer,completeSql,completeArgs),completed[0]);
  assert.deepEqual(await command(second,packer,manualSql,manualArgs),manual);
  assert.equal((await observer.query('select status from coffee.orders where id=$1',[manual.id])).rows[0].status,'COMPLETED');
  assert.equal((await observer.query("select count(*)::int n from coffee.bags where order_id=$1 and status='COMPLETED' and completed_at is not null and claimed_by is null",[manual.id])).rows[0].n,3);
  assert.equal((await observer.query("select count(*)::int n from coffee.job_events where bag_id=any($1::uuid[]) and to_status='COMPLETED'",[manualBags.map(b => b.id)])).rows[0].n,3);
  assert.equal((await observer.query('select count(*)::int n from coffee.batch_requests where order_id=$1',[manual.id])).rows[0].n,2);
  assert.equal(connectionError,false);
  console.log(JSON.stringify({status:'passed',tag,checks:['observed-lock-contention','exact-two-of-three','immutable-start-replay','multi-grind-manual-single-batch','concurrent-completion-replay'],fixtures:'retained on test branch'}));
}

try { await main(); }
catch (error) {
  // Never log messages, stacks, connection objects, query parameters or credentials.
  const sqlstate = typeof error?.code==='string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({status:'failed',stage,tag,...(sqlstate ? {sqlstate} : {}),fixtures:'committed test fixtures may remain'}));
  process.exitCode=1;
} finally {
  await Promise.allSettled(clients.map(async c => {
    try { await c.query('rollback'); } catch {}
    await c.end();
  }));
}
