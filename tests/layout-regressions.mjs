// Real components + synthetic API responses. Never connects to the live database.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const output = await mkdtemp(join(tmpdir(), 'grinder-layout-'));
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {CounterWorkspace} from './src/components/counter-workspace';
    import {PackingWorkspace} from './src/components/packing-workspace';
    const profile={id:'test',display_name:'ผู้ทดสอบ',role:'admin',station:'both',active:true};
    createRoot(document.getElementById('root')).render(location.pathname==='/packing'?<PackingWorkspace profile={profile}/>:<CounterWorkspace profile={profile}/>);`,
    loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-router', setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'test-router' }));
    b.onLoad({ filter: /.*/, namespace: 'test-router' }, args => ({ contents: args.path.endsWith('link')
      ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
      : `export const useRouter=()=>({replace(){},refresh(){}});`, resolveDir: process.cwd() }));
  } }],
});
const css = await readFile('src/app/globals.css', 'utf8');
const server = createServer((req, res) => {
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
  else {res.setHeader('Content-Type','text/html');res.end(`<html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'chrome',headless:true});
const product={id:'product-1',sku:'ซองแดง-RB-HK-0060',name:'กาแฟซองแดง ภาษาไทย ชื่อสินค้ายาวสำหรับตรวจการตัดข้อความและการใช้งาน',size_grams:500,barcode:'001234567890',unit:'bag'};
const grinds=['6','8','10','12','15'].map(v=>({id:`grind-${v}`,grind_value:v,barcode:`990${v.padStart(3,'0')}`}));
const job={id:'job-1',queue_seq:1,bag_no:1,status:'QUEUED',product_name_snapshot:product.name,sku_snapshot:product.sku,product_barcode_snapshot:product.barcode,size_grams_snapshot:500,grind_value_snapshot:'8',created_at:new Date().toISOString()};
try {
 for(const size of [{width:1366,height:768},{width:1707,height:710},{width:1920,height:1080}]){
  for(const station of ['counter','packing']){
   const page=await browser.newPage({viewport:size});
   let currentJob={...job};
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path==='/api/catalog/options')data={grinds,grinders:[{id:'grinder-1',name:'ผู้ทดสอบ'}]};
    else if(path.startsWith('/api/catalog/product/'))data={product};
    else if(path.startsWith('/api/catalog/grind/'))data={grind:grinds[1]};
    else if(path==='/api/jobs')data={jobs:currentJob.status==='COMPLETED'?[]:[currentJob],queuedCount:currentJob.status==='QUEUED'?1:0};
    else if(path.endsWith('/transition')){currentJob={...currentJob,status:JSON.parse(route.request().postData()).nextStatus};data={};}
    else if(path==='/api/orders'){
     const summary={id:'order-1',order_no:'HK-TEST-1',total_bags:2,status:'OPEN',queued_count:2,active_count:0,completed_count:0,oldest_queued_at:new Date(Date.now()-120000).toISOString(),overdue_queued_count:2,progress:{QUEUED:2}};
     data={orders:new URL(route.request().url()).searchParams.get('view')==='history'
      ?[{...summary,status:'COMPLETED',queued_count:0,completed_count:2,overdue_queued_count:0,oldest_queued_at:null,progress:{COMPLETED:2}}]
      :[summary,{...summary,id:'order-2',order_no:'HK-TEST-2',overdue_queued_count:0,oldest_queued_at:new Date().toISOString()}],hasMore:false};
    }
    await route.fulfill({json:data});
   });
   await page.goto(`http://127.0.0.1:${server.address().port}/${station}`);
   await page.locator('svg[data-barcode]').last().waitFor();
   const metrics=await page.evaluate(()=>{
    const drawer=document.querySelector('.barcode-drawer'),table=document.querySelector('.data-table-wrap');
    const scrollArea=document.querySelector('.composer-content')??document.querySelector('.packing-queue');
    return {drawerHeight:drawer.clientHeight,drawerScroll:drawer.scrollHeight,tableHeight:table.clientHeight,cardBottom:Math.max(...[...drawer.querySelectorAll('figure')].map(e=>e.getBoundingClientRect().bottom)),areaBottom:scrollArea.getBoundingClientRect().bottom,barcodes:[...drawer.querySelectorAll('svg')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,bottom:e.getBoundingClientRect().bottom})),viewport:innerHeight};
   });
   assert.ok(metrics.tableHeight>=130,`${station}: table cannot collapse`);
   assert.ok(metrics.drawerScroll<=metrics.drawerHeight+2,`${station}: barcode drawer cannot clip`);
   assert.ok(metrics.barcodes.every(b=>b.height===88),`${station}: original barcode height`);
   assert.ok(metrics.cardBottom<=metrics.areaBottom,`${station}: entire barcode cards including captions must be visible initially`);
   await page.screenshot({path:join(output,`${station}-${size.width}-initial.png`)});
   console.log(station,size,metrics);
   if(station==='counter'){
    await page.getByRole('button',{name:'ประวัติ',exact:true}).click();
    await page.locator('.order-done').waitFor();
    await page.screenshot({path:join(output,`${station}-${size.width}-history.png`)});
    await page.getByRole('button',{name:'งานค้าง',exact:true}).click();
    await page.locator('#scan').fill(product.barcode);await page.locator('#scan').press('Enter');
    await page.locator('.product-result').waitFor();
    await page.locator('#scan').fill('990008');await page.locator('#scan').press('Enter');
    await page.locator('#quantity').fill('3');
    await page.getByRole('button',{name:'เพิ่มรายการ',exact:true}).click();
    await page.getByRole('button',{name:'แก้ไข',exact:true}).click();
    await page.locator('#quantity').fill('4');
    await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
    await page.getByRole('button',{name:'ยืนยัน 4 ถุง · F10',exact:true}).waitFor();
    await page.locator('.data-table').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,`${station}-${size.width}-draft.png`)});
    assert.ok(await page.getByRole('button',{name:'ลบ',exact:true}).isVisible());
   }else{
    await page.getByRole('link',{name:'เปิดออเดอร์เอง',exact:true}).waitFor();
    await page.getByRole('button',{name:'เปิดงาน',exact:true}).click();
    await page.getByTestId('job-action').click();
    await page.locator('#grinder').selectOption('grinder-1');
    await page.locator('#packing-scan').fill('990008');await page.locator('#packing-scan').press('Enter');
    await page.getByText('ตรวจเบอร์บดแล้ว',{exact:true}).waitFor();
    assert.ok(await page.locator('#grinder').evaluate(e=>e.getBoundingClientRect().bottom<=e.closest('.detail-content').getBoundingClientRect().bottom),'packing grinder selector must not be covered by the action footer');
    await page.screenshot({path:join(output,`${station}-${size.width}-claimed.png`)});
    await page.getByTestId('job-action').click();
    await page.getByRole('button',{name:'บดเสร็จ',exact:true}).click();
    await page.getByText('สแกนหรือเลือกงานจากคิว',{exact:true}).waitFor();
   }
   assert.equal(await page.evaluate(()=>document.activeElement?.id),station==='counter'?'scan':'packing-scan');
   await page.close();
  }
 }
 console.log(`Layout checks passed. Screenshots: ${output}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
