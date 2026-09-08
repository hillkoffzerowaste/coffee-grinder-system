import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

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
  await db.exec(`create schema coffee;
    create table coffee.orders(id uuid primary key,order_no text);
    create table coffee.bags(id uuid primary key,order_id uuid,status text,size_grams_snapshot int,
      grinder_name_snapshot text,completed_at timestamptz);`);
  const actor=randomUUID(),state={auth:{profile:{id:actor}},calls:[]};
  const daily=await loadRoute('../src/app/api/jobs/daily/route.ts',state,db);
  const orderA=randomUUID(),orderB=randomUUID();
  await db.query('insert into coffee.orders values($1,$2),($3,$4)',[orderA,'HK-A',orderB,'HK-B']);
  const bag=async(order,status,grams,who,completedSql)=>
    db.query(`insert into coffee.bags values($1,$2,$3,$4,$5,${completedSql})`,[randomUUID(),order,status,grams,who]);
  const bkkMidnight = "date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'";

  await bag(orderA,'COMPLETED',250,'สมชาย',`${bkkMidnight} + interval '3 hours'`);
  await bag(orderA,'COMPLETED',500,'สมชาย',`${bkkMidnight} + interval '4 hours'`);
  await bag(orderB,'COMPLETED',250,'มานี',`${bkkMidnight} + interval '5 hours'`);
  // ก่อนเที่ยงคืนไทยหนึ่งวินาที ต้องไม่ถูกนับเป็นงานของวันนี้
  await bag(orderB,'COMPLETED',250,'มานี',`${bkkMidnight} - interval '1 second'`);
  // ยังไม่เสร็จ ไม่ว่าเวลาไหนก็ไม่นับ
  await bag(orderB,'GRINDING',250,'มานี',`${bkkMidnight} + interval '6 hours'`);

  const call=async q=>(await daily(new Request(`http://localhost/api/jobs/daily${q}`))).json();
  const body=await call('');
  assert.deepEqual(state.roles,['packer','admin'],'counter role must not reach the packing history');
  assert.equal(body.daily.bags,3);
  assert.equal(body.daily.grams,1000);
  assert.equal(body.daily.orders,2);
  assert.deepEqual(body.daily.by_grinder,[{name:'สมชาย',bags:2},{name:'มานี',bags:1}]);
  assert.deepEqual(body.daily.orders_list.map(o=>[o.order_no,o.bags]),[['HK-B',1],['HK-A',2]]);

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
