import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { orderSchema, loginSchema, transitionSchema } from '../src/lib/validation.ts';
import { canUseStation } from '../src/lib/permissions.ts';

const line = { clientLineId:'one', productId:randomUUID(), productBarcode:'001234567890123456789', grindId:randomUUID(), grindBarcode:'990006', quantity:1 };
const order = { clientRequestId:randomUUID(), source:'COUNTER', lines:[line] };
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
test('login requires username/password and a known station', () => {
  assert.equal(loginSchema.safeParse({username:'counter',password:'secret123',station:'counter'}).success,true);
  assert.equal(loginSchema.safeParse({username:'counter',password:'secret123',station:'admin'}).success,false);
});
test('terminal jobs cannot be used as expected status', () => {
  assert.equal(transitionSchema.safeParse({expectedStatus:'COMPLETED',nextStatus:'CLAIMED'}).success,false);
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
