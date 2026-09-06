import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSla } from '../src/lib/order-sla.ts';

test('SLA starts only after packing begins grinding and allows 500 grams per two minutes', () => {
  const startedAt = '2026-09-06T03:00:00.000Z';
  assert.equal(orderSla({totalGrams:500,startedAt:null,now:'2026-09-06T03:00:00.000Z'}),null);
  assert.deepEqual(orderSla({totalGrams:500,startedAt,now:'2026-09-06T03:01:30.000Z'}),{elapsedSeconds:90,targetSeconds:120,tone:'warn'});
  assert.deepEqual(orderSla({totalGrams:500,startedAt,now:'2026-09-06T03:02:01.000Z'}),{elapsedSeconds:121,targetSeconds:120,tone:'danger'});
});

test('SLA uses the finishing time after an order is completed', () => {
  assert.deepEqual(orderSla({totalGrams:250,startedAt:'2026-09-06T03:00:00.000Z',finishedAt:'2026-09-06T03:01:05.000Z',now:'2026-09-06T03:10:00.000Z'}),{elapsedSeconds:65,targetSeconds:60,tone:'danger'});
});
