import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
const c=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000});await c.connect();
try {
 await c.query('begin');
 await c.query('set local search_path=coffee,pg_catalog');
 const actors=(await c.query('select id,username from coffee.profiles')).rows;
 const counter=actors.find(p=>p.username==='counter').id, admin=actors.find(p=>p.username==='admin').id;
 const product=(await c.query('select p.id,b.barcode from coffee.products p join coffee.product_barcodes b on b.product_id=p.id where p.active and b.active limit 1')).rows[0];
 const grind=(await c.query("select id,barcode from coffee.grind_size_codes where grind_value='6'")).rows[0];
 const grinder=(await c.query('insert into coffee.grinder_users(name) values ($1) returning id',['rollback-verification-'+randomUUID()])).rows[0].id;
 await c.query("select set_config('coffee.actor_id',$1,true)",[counter]);await c.query('set local role coffee_app');
 const key=randomUUID(),lines=JSON.stringify([{clientLineId:'verify',productId:product.id,productBarcode:product.barcode,grindId:grind.id,grindBarcode:grind.barcode,quantity:1}]);
 const create=async()=> (await c.query("select coffee.create_order($1,'COUNTER',$2::jsonb) as result",[key,lines])).rows[0].result;
 const order=await create();assert.equal((await create()).id,order.id);
 const bag=(await c.query('select id from coffee.bags where order_id=$1',[order.id])).rows[0];
 await c.query("select set_config('coffee.actor_id',$1,true)",[admin]);
 for(const [from,to] of [['QUEUED','CLAIMED'],['CLAIMED','GRINDING'],['GRINDING','GROUND'],['GROUND','PACKING'],['PACKING','COMPLETED']]){
   const result=(await c.query('select coffee.transition_bag($1,$2,$3,$4,$5) as result',[bag.id,from,to,grinder,grind.id])).rows[0].result;
   assert.equal(result.status,to);
 }
 assert.equal((await c.query('select status from coffee.orders where id=$1',[order.id])).rows[0].status,'COMPLETED');
 await c.query('reset role');
 await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values ($1,'VERIFY','orders',$2)",[admin,order.id]);
 console.log('Live Neon: role-scoped reads, idempotent order, all five transitions and audit insert passed; rolling back test data.');
} finally {await c.query('rollback');await c.end();}
