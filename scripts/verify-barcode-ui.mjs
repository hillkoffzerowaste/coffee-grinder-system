import {chromium,expect} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {hashPassword,hashToken} from '../src/lib/password.ts';
import assert from 'node:assert/strict';
const base=process.env.SMOKE_URL||'http://127.0.0.1:3003';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const credentials={username:'ui-'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('hex')};
const target=randomUUID();
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
const db=new Client({connectionString:url.toString()});await db.connect();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const grinds=Array.from({length:13},(_,i)=>String(i+5)).map(v=>({id:v,grind_value:v,barcode:['6','8','10','12','15'].includes(v)?'990'+v.padStart(3,'0'):null}));
let queuedCount=0;
let testJobs=[],showOrder=false;
const orderId=randomUUID(),bagId=randomUUID();
try{
 await db.query('begin');
 await db.query('insert into coffee.accounts(id,password_hash) values ($1,$2)',[target,await hashPassword(credentials.password)]);
 await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,$2,'UI verification','admin','both')",[target,credentials.username]);
 await db.query('commit');
 const login=await context.request.post(base+'/api/auth/login',{data:{username:credentials.username,password:credentials.password,station:'packing'}});
 assert.equal(login.status(),200);
 const token=login.headers()['set-cookie'].split(';')[0].split('=')[1];
 await context.clearCookies();
 await context.addCookies([{name:'coffee_session',value:token,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:base.startsWith('https:')}]);
 assert.equal((await context.request.get(base+'/api/auth/me')).status(),200,'Browser session must be valid');
 const realQueue=await context.request.get(base+'/api/jobs');
 assert.equal(realQueue.status(),200);
 assert.equal(Number.isInteger((await realQueue.json()).queuedCount),true,'Real queue API must report global unclaimed count');
 await page.addInitScript(()=>{
  window.toneFrequencies=[];window.audioContexts=[];
  const Original=window.AudioContext;
  window.AudioContext=class extends Original{
   constructor(...args){super(...args);window.audioContexts.push(this);}
   createOscillator(){const osc=super.createOscillator();const start=osc.start.bind(osc);osc.start=(...args)=>{window.toneFrequencies.push(osc.frequency.value);return start(...args);};return osc;}
  };
 });
 await page.route('**/api/catalog/options',route=>route.fulfill({json:{grinds,grinders:[]}}));
 await page.route('**/api/orders',route=>route.fulfill({json:{orders:showOrder?[{id:orderId,order_no:'UI-ORDER',total_bags:1,status:'OPEN',progress:{[testJobs[0]?.status||'QUEUED']:1}}]:[]}}));
 await page.route('**/api/orders/*',route=>route.fulfill({json:{bags:testJobs.map(job=>({...job,bag_no:1,grinder_name_snapshot:'Operator',events:[{status:job.status,at:new Date().toISOString()}]}))}}));
 await page.route('**/api/jobs',route=>route.fulfill({json:{jobs:testJobs,queuedCount}}));
 await page.route('**/api/jobs/*/transition',async route=>{
  const data=route.request().postDataJSON();assert.equal(data.expectedStatus,testJobs[0].status);
  if(data.nextStatus==='GRINDING'){assert.equal(data.grindId,'6');assert.ok(data.grinderUserId);}
  testJobs=[{...testJobs[0],status:data.nextStatus}];queuedCount=0;await route.fulfill({json:{job:testJobs[0]}});
 });
 await page.route('**/api/catalog/product/**',route=>route.fulfill({status:404,json:{error:'บาร์โค้ดทดสอบไม่ถูกต้อง'}}));
 for(const path of ['/counter','/packing/new','/packing']){
  await db.query('update coffee.profiles set role=$1 where id=$2',[path==='/counter'?'counter':'admin',target]);
  if(path==='/counter'){
   const live=await context.request.get(base+'/api/orders');assert.equal(live.status(),200);
   const orders=(await live.json()).orders;
   if(orders.length){assert.equal(typeof orders[0].progress,'object');const detail=await context.request.get(base+'/api/orders/'+orders[0].id);assert.equal(detail.status(),200);assert.ok(Array.isArray((await detail.json()).bags));}
  }
  await page.goto(base+path);await expect(page.locator('svg[data-barcode]')).toHaveCount(5);
  await page.getByText('แสดงบาร์โค้ดเบอร์บด',{exact:true}).click();
  for(const width of [375,768,1280]){
   await page.setViewportSize({width,height:1000});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(overflow,0,`${path} overflow at ${width}`);
   for(const code of grinds.filter(g=>g.barcode))await expect(page.locator(`svg[data-barcode="${code.barcode}"]`)).toBeVisible();
  }
  await page.getByText('แสดงบาร์โค้ดเบอร์บด',{exact:true}).click();
  await page.getByRole('button',{name:'เปิดเสียงแจ้งเตือน',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.toneFrequencies.length)).toBe(1);
  assert.equal(await page.evaluate(()=>window.audioContexts[0].state),'running');
  const scan=page.locator(path==='/packing'?'#packing-scan':'#scan');await scan.fill('9999');await scan.press('Enter');
  await expect.poll(()=>page.evaluate(()=>window.toneFrequencies.slice(-2))).toEqual([220,220]);
  if(path==='/packing'){
   const count=await page.evaluate(()=>window.toneFrequencies.length);queuedCount=2;
   await expect.poll(()=>page.evaluate(()=>window.toneFrequencies.length),{timeout:12000}).toBe(count+3);
   assert.deepEqual(await page.evaluate(()=>window.toneFrequencies.slice(-3)),[660,880,1100]);
   await expect.poll(()=>page.evaluate(()=>window.toneFrequencies.length),{timeout:6000}).toBeGreaterThanOrEqual(count+6);
   queuedCount=1;const partial=await page.evaluate(()=>window.toneFrequencies.length);
   await expect.poll(()=>page.evaluate(()=>window.toneFrequencies.length),{timeout:6000}).toBeGreaterThan(partial);
   queuedCount=0;await page.waitForTimeout(6000);
   const stopped=await page.evaluate(()=>window.toneFrequencies.length);await page.waitForTimeout(4000);
   assert.equal(await page.evaluate(()=>window.toneFrequencies.length),stopped);
  }
  await page.getByRole('button',{name:'ปิดเสียง',exact:true}).click();
  const count=await page.evaluate(()=>window.toneFrequencies.length);await scan.fill('9999');await scan.press('Enter');
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.toneFrequencies.length),count);
  console.log(`${path}: five visible barcodes, widths 375/768/1280, real AudioContext activation/error/mute verified`);
 }
 testJobs=[{id:bagId,bag_no:1,queue_seq:1,status:'QUEUED',product_name_snapshot:'Coffee long product name for one-screen verification',sku_snapshot:'RB-HK-TEST',size_grams_snapshot:200,grind_value_snapshot:'6',product_barcode_snapshot:'123456'}];queuedCount=1;
 await page.unroute('**/api/catalog/options');await page.route('**/api/catalog/options',route=>route.fulfill({json:{grinds,grinders:[{id:target,name:'Operator'}]}}));
 await page.goto(base+'/packing');await page.getByRole('button',{name:'เปิดงาน',exact:true}).click();
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:800});
  const button=await page.getByTestId('job-action').boundingBox();assert.ok(button.y>=0&&button.y+button.height<=800,`Action out of viewport at ${width}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
 }
 await page.getByTestId('job-action').click();await expect(page.getByTestId('job-action')).toHaveText('เริ่มบด');
 await expect(page.locator('#packing-grind-select option')).toHaveCount(14);
 await page.getByRole('button',{name:'เบอร์ 8',exact:true}).click();await expect(page.locator('.packing-detail [role="alert"]')).toContainText('เบอร์บดไม่ตรง');
 await page.getByRole('button',{name:'เบอร์ 6',exact:true}).click();await page.locator('#grinder').selectOption(target);
 await page.screenshot({path:'.vercel/operations-packing.png',fullPage:true});
 for(const label of ['เริ่มบด','บดเสร็จ','เริ่มแพ็ค','แพ็คเสร็จ']){
  await expect(page.getByTestId('job-action')).toHaveText(label);
  const button=await page.getByTestId('job-action').boundingBox();assert.ok(button.y+button.height<=800);
  await page.getByTestId('job-action').click();
 }
 await expect(page.getByTestId('job-action')).toHaveCount(0);
 showOrder=true;testJobs=[{...testJobs[0],status:'GRINDING'}];
 await db.query("update coffee.profiles set role='counter' where id=$1",[target]);
 await page.goto(base+'/counter');await expect(page.getByLabel('สถานะ UI-ORDER')).toContainText('กำลังบด');
 await page.getByRole('button',{name:'UI-ORDER · 1 ถุง'}).click();await expect(page.locator('.order-monitor')).toContainText('Operator');
 testJobs=[{...testJobs[0],status:'COMPLETED'}];await expect(page.getByLabel('สถานะ UI-ORDER')).toContainText('เสร็จแล้ว',{timeout:6000});
 await page.screenshot({path:'.vercel/operations-counter.png',fullPage:true});
 console.log('Manual grind selection, all action buttons within viewport, and live counter status/detail updates verified.');
 assert.deepEqual(errors,[]);
 console.log('Browser verification passed; no orders written. Alarm repeats with pending work, continues after partial claims and stops when queue is fully claimed.');
}catch(error){console.log({url:page.url(),errors,screen:(await page.locator('body').innerText()).slice(0,1200)});throw error;}finally{
 await db.query('rollback');
 await db.query('begin');
 await db.query('delete from coffee.sessions where user_id=$1',[target]);
 await db.query('delete from coffee.profiles where id=$1 and username=$2',[target,credentials.username]);
 await db.query('delete from coffee.accounts where id=$1',[target]);
 await db.query('delete from coffee.login_attempts where key=$1',[hashToken('login:'+credentials.username)]);
 await db.query('commit');await db.end();await browser.close();
 console.log('Temporary UI account removed; real account credentials untouched.');
}
