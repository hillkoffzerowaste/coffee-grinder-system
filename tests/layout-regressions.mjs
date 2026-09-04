// Real components + synthetic responses. All API and external requests are intercepted.
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profileId = uuid(1), grinderId = uuid(2), orderId = uuid(3), batchId = uuid(4);
const product = { id: uuid(5), sku: 'ซองแดง-RB-HK-0060', name: 'กาแฟซองแดง ภาษาไทย ชื่อสินค้ายาวสำหรับตรวจการตัดข้อความและการใช้งาน', size_grams: 500, barcode: '001234567890', unit: 'bag' };
const grinds = ['6', '8', '10', '12', '15'].map((v, i) => ({ id: uuid(10 + i), grind_value: v, barcode: `990${v.padStart(3, '0')}` }));
const jobs = [1, 2, 3].map(n => ({ id: uuid(20 + n), order_id: orderId, grind_id: grinds[1].id, queue_seq: n, bag_no: n, status: 'QUEUED', claimed_by: null, grinding_batch_id: null, orders: { order_no: 'HK-TEST-1' }, product_name_snapshot: product.name, sku_snapshot: product.sku, product_barcode_snapshot: product.barcode, size_grams_snapshot: 500, grind_value_snapshot: '8', created_at: new Date().toISOString() }));
const output = await mkdtemp(join(tmpdir(), 'grinder-layout-'));
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {CounterWorkspace} from './src/components/counter-workspace';
    import {PackingWorkspace} from './src/components/packing-workspace';
    const profile={id:${JSON.stringify(profileId)},username:'test',display_name:'ผู้ทดสอบ',role:'admin',station:'both',active:true};
    const root=createRoot(document.getElementById('root'));
    function render(){root.render(location.pathname==='/packing'?<PackingWorkspace profile={profile}/>:<CounterWorkspace key={location.pathname} profile={profile} source={location.pathname==='/packing/new'?'PACKING_MANUAL':'COUNTER'}/>);}
    window.addEventListener('popstate',render);render();`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, outfile: 'bundle.js', write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-router', setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'test-router' }));
    b.onLoad({ filter: /.*/, namespace: 'test-router' }, args => ({ contents: args.path.endsWith('link')
      ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
      : `window.__routerPushes=[];const router={push(url){window.__routerPushes.push(url);history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));},replace(url){history.replaceState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));},refresh(){}};export const useRouter=()=>router;`, resolveDir: process.cwd() }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js'));
const dialogCss = bundle.outputFiles.find(file => file.path.endsWith('.css'));
assert.ok(script && dialogCss, 'bundle must include JS and imported dialog CSS');
const css = await readFile('src/app/globals.css', 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script.text); }
  else if (req.url === '/bundle.css') { res.setHeader('Content-Type', 'text/css'); res.end(dialogCss.text); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(`<html lang="th"><head><meta charset="utf-8"><style>${css}</style><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function scan(page, selector, value) {
  await expect(page.locator(selector)).toBeEnabled();
  await page.locator(selector).fill(value); await page.locator(selector).press('Enter');
}
async function productAboveScanner(page, selector) {
  await expect(page.locator('.product-result')).toBeVisible();
  const bounds = await page.evaluate(selector => {
    const product = document.querySelector('.product-result').getBoundingClientRect();
    return { top: product.top, bottom: product.bottom, scannerTop: document.querySelector(selector).getBoundingClientRect().top, height: innerHeight };
  }, selector);
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height && bounds.bottom <= bounds.scannerTop, 'product must be visible above scanner');
}
async function screenshot(page, name) { await page.screenshot({ path: join(output, `${name}.png`) }); }
async function modal(page, name) {
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect(page.locator('#quantity')).toBeFocused();
  await screenshot(page, `${name}-modal`);
}
async function invalidQuantity(page, value, flag) {
  await page.locator('#quantity').fill(value);
  await page.getByRole('button', { name: 'ยืนยันจำนวน', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  assert.equal(await page.locator('#quantity').evaluate((input, flag) => input.validity[flag], flag), true);
}
async function confirmQuantity(page, quantity, selector) {
  await page.locator('#quantity').fill(String(quantity)); await page.locator('#quantity').press('Enter');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator(selector)).toBeFocused();
  await page.locator(selector).press('Enter'); // Trailing Enter must not repeat or submit an order.
}
try {
  for (const size of [{ width: 1366, height: 768 }, { width: 1707, height: 710 }, { width: 1920, height: 1080 }]) {
    for (const station of ['counter', 'packing', 'packingmanual']) {
      const page = await browser.newPage({ viewport: size }); page.setDefaultTimeout(10000);
      const errors = [], unexpected = [], posts = [], queries = [];
      page.on('pageerror', error => errors.push(error.message));
      let currentJobs = jobs.map(job => ({ ...job }));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { unexpected.push(request.url()); await route.abort(); return; }
        if (!path.startsWith('/api/')) { await route.continue(); return; }
        let data;
        if (request.method() === 'POST') posts.push({ path, body: JSON.parse(request.postData()) });
        if (path === '/api/catalog/options') data = { grinds, grinders: [{ id: grinderId, name: 'ผู้ทดสอบ' }] };
        else if (path === `/api/catalog/product/${product.barcode}`) data = { product };
        else if (path.startsWith('/api/catalog/grind/')) data = { grind: grinds.find(grind => path.endsWith(grind.barcode)) };
        else if (path === '/api/jobs') {
          queries.push(url.search);
          let filtered = currentJobs.filter(job => job.status !== 'COMPLETED');
          if (url.searchParams.has('scan')) filtered = filtered.filter(job => job.product_barcode_snapshot === url.searchParams.get('scan') || String(job.queue_seq) === url.searchParams.get('scan'));
          if (url.searchParams.has('orderId')) filtered = filtered.filter(job => job.order_id === url.searchParams.get('orderId'));
          if (url.searchParams.has('batch')) filtered = currentJobs.filter(job => job.grinding_batch_id === url.searchParams.get('batch'));
          data = { jobs: filtered, queuedCount: currentJobs.filter(job => job.status === 'QUEUED').length, hasMore: false };
        } else if (path === '/api/jobs/start') {
          const body = posts.at(-1).body;
          const selected = currentJobs.filter(job => job.status === 'QUEUED' && job.order_id === body.orderId && job.product_barcode_snapshot === body.productBarcode && job.grind_id === body.grindId).slice(0, body.quantity);
          for (const job of selected) Object.assign(job, { status: 'GRINDING', grinding_batch_id: batchId, claimed_by: profileId, grinder_name_snapshot: 'ผู้ทดสอบ' });
          data = { batch: { batch_id: batchId, bag_ids: selected.map(job => job.id) } };
        } else if (path === '/api/jobs/complete') {
          const selected = currentJobs.filter(job => job.grinding_batch_id === posts.at(-1).body.batchId);
          for (const job of selected) job.status = 'COMPLETED';
          data = { batch: { batch_id: batchId, bag_ids: selected.map(job => job.id) } };
        } else if (path === '/api/orders' && request.method() === 'POST') {
          const body = posts.at(-1).body, manual = body.source === 'PACKING_MANUAL';
          if (manual) currentJobs = jobs.slice(0, body.lines[0].quantity).map(job => ({ ...job, status: 'GRINDING', grinding_batch_id: batchId, claimed_by: profileId, grinder_name_snapshot: 'ผู้ทดสอบ' }));
          data = { order: { id: orderId, order_no: 'HK-TEST-NEW', total_bags: body.lines.reduce((sum, line) => sum + line.quantity, 0), batch_id: manual ? batchId : null } };
        } else if (path === '/api/orders') {
          const summary = { id: orderId, order_no: 'HK-TEST-1', total_bags: 3, status: 'OPEN', queued_count: 3, active_count: 0, completed_count: 0, oldest_queued_at: new Date(Date.now() - 120000).toISOString(), overdue_queued_count: 3, progress: { QUEUED: 3 } };
          data = { orders: url.searchParams.get('view') === 'history' ? [{ ...summary, status: 'COMPLETED', queued_count: 0, completed_count: 3, overdue_queued_count: 0, oldest_queued_at: null, progress: { COMPLETED: 3 } }] : [summary], hasMore: false };
        } else { unexpected.push(`${request.method()} ${path}${url.search}`); await route.fulfill({ status: 500, json: { error: 'Unexpected mocked request' } }); return; }
        await route.fulfill({ json: data });
      });
      const name = `${station}-${size.width}`;
      await page.goto(`${origin}/${station === 'packingmanual' ? 'packing/new' : station}`);
      await page.locator('svg[data-barcode]').last().waitFor();
      const metrics = await page.evaluate(() => {
        const drawer = document.querySelector('.barcode-drawer'), table = document.querySelector('.data-table-wrap');
        const area = document.querySelector('.composer-content') ?? document.querySelector('.packing-queue');
        return { drawerHeight: drawer.clientHeight, drawerScroll: drawer.scrollHeight, tableHeight: table.clientHeight, cardBottom: Math.max(...[...drawer.querySelectorAll('figure')].map(e => e.getBoundingClientRect().bottom)), areaBottom: area.getBoundingClientRect().bottom, barcodeHeights: [...drawer.querySelectorAll('svg')].map(e => e.getBoundingClientRect().height) };
      });
      assert.ok(metrics.tableHeight >= 130, `${name}: table cannot collapse`);
      assert.ok(metrics.drawerScroll <= metrics.drawerHeight + 2, `${name}: barcode drawer cannot clip`);
      assert.ok(metrics.barcodeHeights.every(height => height === 88), `${name}: original barcode height`);
      assert.ok(metrics.cardBottom <= metrics.areaBottom, `${name}: entire barcode cards must be visible initially`);
      await screenshot(page, `${name}-initial`);
      if (station !== 'packing') {
        if (station === 'counter') {
          await page.getByRole('button', { name: 'ประวัติ', exact: true }).click(); await page.locator('.order-done').waitFor();
          await screenshot(page, `${name}-history`);
          await page.getByRole('button', { name: 'งานค้าง', exact: true }).click();
        }
        await scan(page, '#scan', product.barcode); await productAboveScanner(page, '#scan'); await screenshot(page, `${name}-product`);
        await scan(page, '#scan', grinds[1].barcode); await modal(page, name);
        await invalidQuantity(page, '0', 'rangeUnderflow'); await invalidQuantity(page, '100', 'rangeOverflow');
        await page.keyboard.press('F10'); assert.equal(posts.length, 0, 'invalid quantity and modal F10 cannot post');
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toHaveCount(0); await expect(page.locator('#scan')).toBeFocused();
        await expect(page.locator('.data-table tbody tr')).toHaveCount(0);
        await scan(page, '#scan', product.barcode); await scan(page, '#scan', grinds[1].barcode);
        await confirmQuantity(page, 2, '#scan'); await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
        if (station === 'counter') {
          await scan(page, '#scan', product.barcode); await page.locator('#grind-select').selectOption(grinds[2].id);
          await modal(page, `${name}-dropdown`); await confirmQuantity(page, 3, '#scan');
          await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
          await page.getByRole('button', { name: 'แก้ไข', exact: true }).first().click();
          await expect(page.locator('#quantity')).toHaveValue('2'); await modal(page, `${name}-edit`);
          await confirmQuantity(page, 4, '#scan'); await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
          await expect(page.locator('.data-table tbody tr').first().locator('td').nth(3)).toHaveText('4');
          await expect(page.locator('.data-table tbody tr').last().locator('td').nth(3)).toHaveText('3');
          await screenshot(page, `${name}-draft`); assert.equal(posts.length, 0, 'modal Enter must not auto-submit order');
          await page.getByRole('button', { name: 'ยืนยัน 7 ถุง · F10', exact: true }).click();
          await expect(page.locator('.data-table tbody tr')).toHaveCount(0);
          assert.equal(posts.length, 1); assert.equal(posts[0].body.source, 'COUNTER');
          assert.deepEqual(posts[0].body.lines.map(line => line.quantity), [4, 3]);
          assert.equal(posts[0].body.lines[1].grindId, grinds[2].id); assert.equal(posts[0].body.lines[1].grindBarcode, null);
          assert.deepEqual(await page.evaluate(() => window.__routerPushes), []);
          assert.ok(currentJobs.every(job => job.status === 'QUEUED'));
        } else {
          const confirm = page.getByRole('button', { name: 'ยืนยัน 2 ถุง · F10', exact: true });
          await expect(confirm).toBeDisabled(); await page.keyboard.press('F10'); assert.equal(posts.length, 0, 'manual requires grinder');
          await page.locator('#grinder-select').selectOption(grinderId); await expect(confirm).toBeEnabled(); await confirm.click();
          await expect(page).toHaveURL(`${origin}/packing?batch=${batchId}`); await expect(page.getByTestId('job-action')).toBeEnabled();
          assert.equal(posts.length, 1); assert.equal(posts[0].path, '/api/orders');
          assert.equal(posts[0].body.source, 'PACKING_MANUAL'); assert.equal(posts[0].body.grinderUserId, grinderId);
          assert.deepEqual(await page.evaluate(() => window.__routerPushes), [`/packing?batch=${batchId}`]);
          assert.ok(queries.includes(`?batch=${batchId}`)); await screenshot(page, `${name}-batch`);
        }
      } else {
        await page.getByRole('link', { name: 'เปิดออเดอร์เอง', exact: true }).waitFor();
        await scan(page, '#packing-scan', product.barcode); await productAboveScanner(page, '#packing-scan'); await screenshot(page, `${name}-product`);
        await scan(page, '#packing-scan', grinds[1].barcode); await modal(page, name);
        await page.locator('#grinder').selectOption(grinderId);
        await invalidQuantity(page, '0', 'rangeUnderflow'); await invalidQuantity(page, '4', 'rangeOverflow'); assert.equal(posts.length, 0);
        await page.keyboard.press('Escape'); await expect(page.locator('dialog[open]')).toHaveCount(0); await expect(page.locator('#packing-scan')).toBeFocused();
        await scan(page, '#packing-scan', grinds[1].barcode); await expect(page.locator('#quantity')).toBeFocused();
        await page.locator('#grinder').selectOption(grinderId); await confirmQuantity(page, 2, '#packing-scan');
        await expect(page.getByTestId('job-action')).toBeEnabled(); assert.equal(posts.length, 1);
        assert.equal(posts[0].path, '/api/jobs/start'); assert.equal(posts[0].body.orderId, orderId);
        assert.equal(posts[0].body.grinderUserId, grinderId); assert.equal(posts[0].body.quantity, 2);
        assert.ok(queries.includes(`?scan=${product.barcode}`)); assert.ok(queries.includes(`?orderId=${orderId}`)); assert.ok(queries.includes(`?batch=${batchId}`));
        await screenshot(page, `${name}-grinding`); await page.getByTestId('job-action').click();
        await expect(page.getByText('เสร็จสิ้น — จัดเก็บในประวัติแล้ว', { exact: true })).toBeVisible();
        assert.equal(posts.length, 2); assert.equal(posts[1].path, '/api/jobs/complete'); assert.equal(posts[1].body.batchId, batchId);
        assert.equal(currentJobs.filter(job => job.status === 'COMPLETED').length, 2); assert.equal(currentJobs.filter(job => job.status === 'QUEUED').length, 1);
      }
      for (const { body } of posts) assert.match(body.clientRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      await expect(page.locator(station === 'counter' ? '#scan' : '#packing-scan')).toBeFocused();
      assert.deepEqual(errors, [], `${name}: runtime errors`); assert.deepEqual(unexpected, [], `${name}: unexpected requests`);
      console.log(`${name}: layout, modal, focus and request checks passed`); await page.close();
    }
  }
  console.log(`Layout checks passed. Screenshots: ${output}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
