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
const grinds=['6','8','10','12','15'].map(v=>({id:v,grind_value:v,barcode:'990'+v.padStart(3,'0')}));
let queuedCount=0;
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
 await page.route('**/api/orders',route=>route.fulfill({json:{orders:[]}}));
 await page.route('**/api/jobs',route=>route.fulfill({json:{jobs:[],queuedCount}}));
 await page.route('**/api/catalog/product/**',route=>route.fulfill({status:404,json:{error:'บาร์โค้ดทดสอบไม่ถูกต้อง'}}));
 for(const path of ['/counter','/packing/new','/packing']){
  await db.query('update coffee.profiles set role=$1 where id=$2',[path==='/counter'?'counter':'admin',target]);
  await page.goto(base+path);await expect(page.locator('svg[data-barcode]')).toHaveCount(5);
  for(const width of [375,768,1280]){
   await page.setViewportSize({width,height:1000});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(overflow,0,`${path} overflow at ${width}`);
   for(const code of grinds)await expect(page.locator(`svg[data-barcode="${code.barcode}"]`)).toBeVisible();
  }
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
 await page.screenshot({path:'.vercel/barcodes-packing.png',fullPage:true});
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
