import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSla } from '../src/lib/order-sla.ts';

test('SLA uses three minutes for 500 grams and scales by bag weight', () => {
  const startedAt = '2026-09-06T03:00:00.000Z';
  assert.equal(orderSla({totalGrams:500,startedAt:null,now:'2026-09-06T03:00:00.000Z'}),null);
  assert.deepEqual(orderSla({totalGrams:500,startedAt,now:'2026-09-06T03:02:15.000Z'}),{elapsedSeconds:135,targetSeconds:180,tone:'warn'});
  assert.deepEqual(orderSla({totalGrams:500,startedAt,now:'2026-09-06T03:03:01.000Z'}),{elapsedSeconds:181,targetSeconds:180,tone:'danger'});
  assert.equal(orderSla({totalGrams:250,startedAt,now:'2026-09-06T03:01:30.000Z'}).targetSeconds,90);
});

test('SLA can use the published operations rate when it is provided', () => {
  assert.equal(orderSla({totalGrams:500,slaGrams:500,slaSeconds:240,startedAt:'2026-09-06T03:00:00.000Z',now:'2026-09-06T03:04:00.000Z'}).targetSeconds,240);
});

test('SLA uses the finishing time after an order is completed', () => {
  assert.deepEqual(orderSla({totalGrams:250,startedAt:'2026-09-06T03:00:00.000Z',finishedAt:'2026-09-06T03:01:35.000Z',now:'2026-09-06T03:10:00.000Z'}),{elapsedSeconds:95,targetSeconds:90,tone:'danger'});
});

test('SLA includes the wait in the grinding queue before packing starts', () => {
  assert.deepEqual(orderSla({totalGrams:500,queuedAt:'2026-09-06T03:00:00.000Z',now:'2026-09-06T03:02:15.000Z'}),{elapsedSeconds:135,targetSeconds:180,tone:'warn'});
});
test('work already queued ahead extends the target instead of counting as this order being late',()=>{
  // ห้องแพ็คบดไล่ตามลำดับคิว ออเดอร์ที่ต่อท้ายคิว 1 กก. จึงยังไม่สายในนาทีแรก
  const queuedAt='2026-09-06T03:00:00.000Z';
  assert.deepEqual(orderSla({totalGrams:500,queueAheadGrams:1000,queuedAt,now:'2026-09-06T03:01:30.000Z'}),{elapsedSeconds:90,targetSeconds:540,tone:'ok'});
  assert.equal(orderSla({totalGrams:500,queueAheadGrams:0,queuedAt,now:'2026-09-06T03:01:30.000Z'}).tone,'ok');
  assert.equal(orderSla({totalGrams:500,queueAheadGrams:null,queuedAt,now:'2026-09-06T03:01:30.000Z'}).targetSeconds,180);
});
