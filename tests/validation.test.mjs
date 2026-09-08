import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { orderSchema, loginSchema, transitionSchema, pendingOrderSchema } from '../src/lib/validation.ts';
import {dropdownGrinds} from '../src/lib/grind-options.ts';
import { canUseStation } from '../src/lib/permissions.ts';
import { stationLandingPath } from '../src/lib/auth.ts';
import { jobStatusLabels } from '../src/lib/job-status.ts';
import { canJoinBlendGroup, mergeBlendLine, blendLineSummary, productLine } from '../src/lib/blend-orders.ts';

const line = { clientLineId:'one', productId:randomUUID(), productBarcode:'001234567890123456789', grindId:randomUUID(), grindBarcode:'990006', quantity:1 };
const order = { clientRequestId:randomUUID(), source:'COUNTER', lines:[line] };
test('manual grind has explicit null barcode and survives persisted retry validation',()=>{
 const manual={...order,lines:[{...line,grindBarcode:null}]};
 assert.equal(orderSchema.safeParse(manual).success,true);
 const draft={clientLineId:line.clientLineId,quantity:1,product:{id:line.productId,sku:'TEST',name:'Beans',size_grams:200,unit:'bag',barcode:line.productBarcode},grind:{id:line.grindId,grind_value:'17',barcode:null}};
 assert.equal(pendingOrderSchema.safeParse({body:JSON.stringify(manual),lines:[draft]}).success,true);
 assert.equal(orderSchema.safeParse({...manual,lines:[{...line,grindBarcode:undefined}]}).success,false);
 assert.deepEqual(dropdownGrinds(Array.from({length:20},(_,i)=>({id:String(i),grind_value:String(i),barcode:null}))).map(g=>g.grind_value),Array.from({length:13},(_,i)=>String(i+5)));
});
test('numeric barcode retains leading zeros and digits beyond JS safe integer', () => {
  assert.equal(orderSchema.parse(order).lines[0].productBarcode,line.productBarcode);
});
test('reject malformed quantities, numeric barcode values and SKU in barcode field', () => {
  for (const quantity of [0,100,1.5,'1',null]) assert.equal(orderSchema.safeParse({...order,lines:[{...line,quantity}]}).success,false);
  for (const productBarcode of [123456,'RB-HK-123','12','1'.repeat(33)]) assert.equal(orderSchema.safeParse({...order,lines:[{...line,productBarcode}]}).success,false);
});
test('reject duplicate client line identifiers', () => {
  assert.equal(orderSchema.safeParse({...order,lines:[line,line]}).success,false);
});
test('reject more than 500 bags before contacting database', () => {
  assert.equal(orderSchema.safeParse({...order,lines:Array.from({length:6},(_,i)=>({...line,clientLineId:String(i),quantity:99}))}).success,false);
});
test('blend groups use one grind and merge duplicate SKU quantities inside a group', () => {
  const group = {id:'group-1',mode:'GROUND',grind:{id:line.grindId,grind_value:'6',barcode:'990006'}};
  const product = {id:line.productId,sku:'TEST',name:'Beans',size_grams:200,unit:'bag',barcode:line.productBarcode};
  assert.equal(canJoinBlendGroup(group,'GROUND',group.grind),true);
  assert.equal(canJoinBlendGroup(group,'GROUND',{...group.grind,id:randomUUID(),grind_value:'8'}),false);
  assert.equal(canJoinBlendGroup(group,'WHOLE_BEAN',null),false);
  const first=productLine(product,group.id,'GROUND',group.grind,2,'a');
  const second=productLine(product,group.id,'GROUND',group.grind,3,'b');
  const merged=mergeBlendLine([first],second);
  assert.equal(merged.length,1); assert.equal(merged[0].quantity,5);
  assert.equal(blendLineSummary(merged)[0].total,5);
});
test('whole-bean blend groups carry no grind and cannot mix with ground lines', () => {
  const whole={...line,clientLineId:'whole',blendGroupId:'beans',mode:'WHOLE_BEAN',grindId:null,grindBarcode:null};
  assert.equal(orderSchema.safeParse({...order,lines:[whole]}).success,true);
  assert.equal(orderSchema.safeParse({...order,lines:[whole,{...line,clientLineId:'ground',blendGroupId:'beans'}]}).success,false);
});
test('login requires username/password and a known station', () => {
  assert.equal(loginSchema.safeParse({username:'counter',password:'secret123',station:'counter'}).success,true);
  assert.equal(loginSchema.safeParse({username:'counter',password:'secret123',station:'admin'}).success,false);
});
test('terminal jobs cannot be used as expected status', () => {
  assert.equal(transitionSchema.safeParse({expectedStatus:'COMPLETED',nextStatus:'CLAIMED'}).success,false);
});
test('only the new grinding completion transition is accepted', () => {
  assert.equal(transitionSchema.safeParse({expectedStatus:'GRINDING',nextStatus:'COMPLETED'}).success,true);
  // เริ่มบดได้ทางเดียวคือ start_scan_batch ซึ่งเซ็ต batch ให้เสมอ สองเส้นทางนี้เคยสร้างถุงกำพร้าได้
  assert.equal(transitionSchema.safeParse({expectedStatus:'QUEUED',nextStatus:'CLAIMED'}).success,false);
  assert.equal(transitionSchema.safeParse({expectedStatus:'CLAIMED',nextStatus:'GRINDING',grinderUserId:randomUUID(),grindId:randomUUID()}).success,false);
  for (const nextStatus of ['GROUND','PACKING']) {
    assert.equal(transitionSchema.safeParse({expectedStatus:'GRINDING',nextStatus}).success,false);
  }
  assert.equal(transitionSchema.safeParse({expectedStatus:'GROUND',nextStatus:'PACKING'}).success,false);
});
test('legacy history statuses retain Thai labels', () => {
  assert.equal(jobStatusLabels.GROUND,'บดเสร็จ');
  assert.equal(jobStatusLabels.PACKING,'กำลังแพ็ค');
});
test('transition validation rejects same-status admin requests', () => {
  assert.equal(transitionSchema.safeParse({expectedStatus:'BLOCKED',nextStatus:'BLOCKED'}).success,false);
});
test('station access requires compatible role, assigned station and active account', () => {
  for (const role of ['counter','packer','admin']) {
    for (const station of ['counter','packing','both']) {
      for (const target of ['counter','packing']) {
        const expected = (station === target || station === 'both') && (target === 'counter' ? role === 'counter' : role !== 'counter');
        assert.equal(canUseStation({role,station,active:true},target),expected);
        assert.equal(canUseStation({role,station,active:false},target),false);
      }
    }
  }
});
test('a persisted session resumes at its assigned workstation', () => {
  assert.equal(stationLandingPath({station:'counter'}),'/counter');
  assert.equal(stationLandingPath({station:'packing'}),'/packing');
  assert.equal(stationLandingPath({station:'both'}),'/packing');
});
