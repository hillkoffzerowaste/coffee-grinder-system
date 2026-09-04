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
  await db.exec(`create schema coffee;
    create table coffee.products(id uuid primary key,sku text,name text,size_grams int,unit text,active boolean);
    create table coffee.product_barcodes(product_id uuid,barcode text,active boolean);
    create table coffee.orders(id uuid primary key,order_no text);
    create table coffee.bags(id uuid primary key,order_id uuid,grind_id uuid,claimed_by uuid,grinding_batch_id uuid,
      bag_no int,queue_seq bigint,status text,product_name_snapshot text,sku_snapshot text,size_grams_snapshot int,
      grind_value_snapshot text,product_barcode_snapshot text,grinder_name_snapshot text,created_at timestamptz);`);
  const actor=randomUUID(),state={auth:{profile:{id:actor}},calls:[]};
  const catalog=await loadRoute('../src/app/api/catalog/search/route.ts',state,db);
  const jobs=await loadRoute('../src/app/api/jobs/route.ts',state,db);
  const request=params=>new Request(`http://localhost/api/test?${new URLSearchParams(params)}`);
  async function product(name,sku,active=true,barcodes=[['001234',true]]){
    const id=randomUUID();
    await db.query('insert into coffee.products values($1,$2,$3,250,\'bag\',$4)',[id,sku,name,active]);
    for(const [barcode,enabled] of barcodes)await db.query('insert into coffee.product_barcodes values($1,$2,$3)',[id,barcode,enabled]);
    return id;
  }
  const thai=await product('กาแฟ French Roast','RB-HK-THAI',true,[['009999',true],['001234',true],['000001',false]]);
  await product('Hidden French','INACTIVE',false);
  await product('Hidden French','NO-BARCODE',true,[]);
  await product('Hidden French','DISABLED-BARCODE',true,[['001235',false]]);
  const literal=await product('100%_Coffee','LITERAL');
  const order=randomUUID(),batch=randomUUID(),first=randomUUID();
  await db.query('insert into coffee.orders values($1,\'HK-SEARCH-0001\')',[order]);
  for(const [id,seq,status] of [[first,1,'QUEUED'],[randomUUID(),2,'GRINDING'],[randomUUID(),3,'COMPLETED']]){
    await db.query(`insert into coffee.bags(id,order_id,grinding_batch_id,queue_seq,status,product_name_snapshot,sku_snapshot,product_barcode_snapshot)
      values($1,$2,$3,$4,$5,'กาแฟ French Roast','RB-HK-THAI','001234')`,[id,order,batch,seq,status]);
  }

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
      assert.deepEqual((await response.json()).products,[{id:thai,sku:'RB-HK-THAI',name:'กาแฟ French Roast',size_grams:250,unit:'bag',barcode:'001234'}]);
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
    for(const search of ['กาแฟ',' fReNcH ','rb-hk-thai','hk-search-0001']){
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
