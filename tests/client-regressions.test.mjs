import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { registerHooks } from 'node:module';

// Node does not load browser stylesheets; keep this shim local to client tests.
registerHooks({load(url,context,nextLoad){
  if(url.endsWith('/quantity-dialog.css'))return {format:'module',source:'export {};',shortCircuit:true};
  return nextLoad(url,context);
}});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,self:dom.window,sessionStorage:dom.window.sessionStorage,document:dom.window.document,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
class DefaultAudioContext {
  state='suspended';currentTime=0;destination={};
  async resume(){this.state='running';}async close(){this.state='closed';}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
}
window.AudioContext=DefaultAudioContext;
// jsdom has no top layer or layout engine. Exercise component lifecycle/focus,
// while leaving native form constraint validation intact.
Object.assign(dom.window.HTMLDialogElement.prototype,{
  showModal(){this.open=true;},
  close(){if(this.open){this.open=false;this.dispatchEvent(new dom.window.Event('close'));}},
});
Object.assign(dom.window.HTMLElement.prototype,{scrollTo(){},scrollIntoView(){}});
// jsdom does not implement media playback; keep routine hook cleanup silent.
Object.assign(dom.window.HTMLMediaElement.prototype,{pause(){},play(){return Promise.resolve();}});
const { createRoot } = await import('react-dom/client');
const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const { CounterWorkspace } = await import('../src/components/counter-workspace.tsx');
const { PackingWorkspace } = await import('../src/components/packing-workspace.tsx');
const { OrderMonitor } = await import('../src/components/order-monitor.tsx');
const { AdminPasswordReset } = await import('../src/components/admin-password-reset.tsx');
const { QuantityDialog } = await import('../src/components/quantity-dialog.tsx');
const { ProductSearch } = await import('../src/components/product-search.tsx');
const {barcodeBits}=await import('../src/lib/barcode.ts');
const {useQueueAlarm}=await import('../src/lib/use-queue-alarm.ts');
const {useSounds}=await import('../src/lib/use-sounds.ts');
const {Code128Reader,BitArray}=await import('@zxing/library');
const router = {replace(){},refresh(){},push(){},prefetch(){},back(){},forward(){}};
const product = {id:'e9b56600-31ae-48ca-8b4e-669a8794b460',sku:'RB-HK-TEST',name:'Coffee',size_grams:200,barcode:'001234567890',unit:'bag'};
const grind = {id:'c0db63ae-0bce-4483-b1d6-05fd627e9821',grind_value:'6',barcode:'990006'};
const profile = {id:'7d785dbc-14a0-4322-881a-8e72c7a7ab1d',username:'test',display_name:'Test',active:true,role:'admin',station:'packing'};
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const deferred = ()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
async function mount(Component,props={}) {
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(Component,{profile,...props}))));
  return async()=>{await act(async()=>root.unmount())};
}
async function input(id,value) {
  await act(async()=>{
    const el=document.getElementById(id);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);
    el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
}
async function scan(id,value) {
  await input(id,value);
  await act(async()=>document.getElementById(id).closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
}
async function clickText(text) {
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
  assert.ok(button,`Missing button ${text}`);
  await act(async()=>button.click());
}
async function select(id,value) {
  await act(async()=>{const el=document.getElementById(id);assert.ok(el);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
}
async function submitQuantity() {
  const form=document.getElementById('quantity')?.form;
  assert.ok(form,'quantity form is mounted');
  // jsdom does not synthesize implicit submission from a keyboard Enter event.
  await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
}
async function escapeDialog() {
  const dialog=document.querySelector('dialog[open]');assert.ok(dialog);
  const event=new dom.window.Event('cancel',{cancelable:true});
  await act(async()=>dialog.dispatchEvent(event));
  assert.equal(event.defaultPrevented,true,'parent controls dismissal');
}
async function settleFocus(){await act(async()=>new Promise(resolve=>setTimeout(resolve,0)));}

const orderId='64b6a8f2-88a1-46e4-9aab-739390b48544';
const otherOrderId='c54d6f81-0678-4d57-9a60-b17cef5e13c1';
const batchId='a78cdd0d-5906-48c1-8f44-df2b2a4f6a2d';
const wrongGrind={...grind,id:'4d96df31-6b9a-4b42-a756-d0b6f1093ad1',grind_value:'8',barcode:'990008'};
const uuid=/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function bag(overrides={}) {
  return {id:crypto.randomUUID(),order_id:orderId,grind_id:grind.id,claimed_by:null,grinding_batch_id:null,
    orders:{order_no:'HK-A'},queue_seq:1,bag_no:1,status:'QUEUED',product_name_snapshot:product.name,
    sku_snapshot:product.sku,size_grams_snapshot:product.size_grams,grind_value_snapshot:grind.grind_value,
    product_barcode_snapshot:product.barcode,created_at:new Date().toISOString(),...overrides};
}
function packingApi(t,jobs=[bag()]) {
  const state={jobs,calls:[],unexpected:[],start:null,complete:null,legacyJobId:null,grinds:[grind,wrongGrind]};
  const queue=items=>json({jobs:items,queuedCount:items.filter(j=>j.status==='QUEUED').length});
  state.commitStart=body=>{
    const selected=state.jobs.filter(j=>j.order_id===body.orderId&&j.product_barcode_snapshot===body.productBarcode&&j.grind_id===body.grindId&&(j.status==='QUEUED'||j.status==='CLAIMED')).slice(0,body.quantity);
    assert.equal(selected.length,body.quantity,'mock has the requested bags');
    state.jobs=state.jobs.map(j=>selected.includes(j)?{...j,status:'GRINDING',claimed_by:profile.id,grinding_batch_id:batchId,grinder_name_snapshot:'Operator'}:j);
    return json({batch:{batch_id:batchId,bag_ids:selected.map(j=>j.id)}});
  };
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const method=init?.method??'GET';state.calls.push({url,method,body:init?.body});
    if(method==='GET'){
      if(url==='/api/catalog/options')return json({grinds:state.grinds,grinders:[{id:profile.id,name:'Operator'}]});
      if(url===`/api/catalog/grind/${grind.barcode}`)return json({grind});
      if(url===`/api/catalog/grind/${wrongGrind.barcode}`)return json({grind:wrongGrind});
      if(url==='/api/catalog/grind/999999')return json({error:'Wrong barcode'},404);
      if(url==='/api/jobs')return queue(state.jobs);
      const parsed=new URL(url,'http://localhost');
      if(parsed.pathname==='/api/jobs'){
        if(parsed.searchParams.has('scan'))return queue(state.jobs.filter(j=>j.product_barcode_snapshot===parsed.searchParams.get('scan')));
        if(parsed.searchParams.has('orderId'))return queue(state.jobs.filter(j=>j.order_id===parsed.searchParams.get('orderId')));
        if(parsed.searchParams.has('batch'))return queue(state.jobs.filter(j=>j.grinding_batch_id===parsed.searchParams.get('batch')));
      }
    }
    if(method==='POST'&&url==='/api/jobs/start')return state.start?state.start(init.body):state.commitStart(JSON.parse(init.body));
    if(method==='POST'&&url==='/api/jobs/complete'){
      if(state.complete)return state.complete(init.body);
      const body=JSON.parse(init.body),selected=state.jobs.filter(j=>j.grinding_batch_id===body.batchId);
      assert.ok(selected.length);assert.ok(selected.every(j=>j.status==='GRINDING'));
      state.jobs=state.jobs.map(j=>selected.includes(j)?{...j,status:'COMPLETED'}:j);
      return json({batch:{batch_id:body.batchId,bag_ids:selected.map(j=>j.id)}});
    }
    if(method==='POST'&&state.legacyJobId&&url===`/api/jobs/${state.legacyJobId}/transition`){
      assert.deepEqual(JSON.parse(init.body),{expectedStatus:'GRINDING',nextStatus:'COMPLETED'});
      const job=state.jobs.find(j=>j.id===state.legacyJobId);assert.equal(job.status,'GRINDING');
      state.jobs=state.jobs.map(j=>j===job?{...j,status:'COMPLETED'}:j);
      return json({job:{...job,status:'COMPLETED'}});
    }
    state.unexpected.push({url,method});throw new Error(`Unexpected API ${method} ${url}`);
  });
  t.after(()=>{sessionStorage.removeItem(`coffee-packing-pending:${profile.id}`);assert.deepEqual(state.unexpected,[],'no separate claim or staged transition API');});
  state.posts=()=>state.calls.filter(c=>c.method==='POST');
  return state;
}

test('queue alarm starts immediately, repeats every three seconds and stops only when the queue clears',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const calls=[];const play=kind=>calls.push(kind);
 function Alarm({count,enabled}){useQueueAlarm(count>0,enabled,play);return null;}
 const root=createRoot(document.getElementById('root'));
 const render=async(count,enabled)=>act(async()=>root.render(React.createElement(Alarm,{count,enabled})));
 const tick=async(ms)=>act(async()=>t.mock.timers.tick(ms));
 try {
  await render(2,false);await tick(6000);assert.deepEqual(calls,[]);
  await render(2,true);await tick(0);assert.deepEqual(calls,['newJob']);
  await tick(2999);assert.deepEqual(calls,['newJob']);
  await tick(1);assert.deepEqual(calls,['newJob','newJob']);
  await render(1,true);await tick(3000);assert.deepEqual(calls,['newJob','newJob','newJob']);
  await render(0,true);await tick(9000);assert.deepEqual(calls,['newJob','newJob','newJob']);
 }finally{await act(async()=>root.unmount());}
 const count=calls.length;await tick(9000);assert.equal(calls.length,count);
});

test('sound opens automatically and the restored queue alert uses three tones at full gain',async()=>{
 const originalAudioContext=window.AudioContext,tones=[],gains=[];let sound;
 class FakeAudioContext {
  state='suspended';currentTime=0;destination={};
  async resume(){this.state='running';}async close(){this.state='closed';}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){tones.push(this.frequency.value);},stop(){}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(value){gains.push(value);}},connect(){},disconnect(){}};}
 }
 function Harness(){sound=useSounds();return null;}
 window.AudioContext=FakeAudioContext;
 const root=createRoot(document.getElementById('root'));
 try {
  await act(async()=>root.render(React.createElement(Harness)));
  assert.equal(sound.enabled,true);
  tones.length=0;gains.length=0;sound.play('newJob');
  assert.deepEqual(tones,[660,880,1100]);
  assert.equal(Math.max(...gains),1);
  assert.equal('mute' in sound,false);
 }finally{await act(async()=>root.unmount());window.AudioContext=originalAudioContext;}
});

test('Code128 barcode images decode to exact configured values including leading zero',()=>{
 for(const value of ['990006','990008','990010','990012','990015','00123','00000000000000000000000000000001']){
  const bits='0'.repeat(20)+barcodeBits(value)+'0'.repeat(20),row=new BitArray(bits.length);
  [...bits].forEach((bit,i)=>{if(bit==='1')row.set(i);});
  assert.equal(new Code128Reader().decodeRow(0,row,null).getText(),value);
 }
});

test('sound unlock is mandatory when autoplay is blocked and has no mute control',async()=>{
 const originalFetch=globalThis.fetch,originalAudioContext=window.AudioContext;const tones=[],gains=[];let resumeCalls=0;
 class FakeAudio {
  state='suspended';currentTime=0;destination={};
  async resume(){resumeCalls++;if(resumeCalls>1)this.state='running';}async close(){this.state='closed';}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){tones.push(this.frequency.value);},stop(){}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(value){gains.push(value);}},connect(){},disconnect(){}};}
 }
 window.AudioContext=FakeAudio;
 const grinds=['6','8','10','12','15'].map(v=>({...grind,id:v,grind_value:v,barcode:'990'+v.padStart(3,'0')}));
 globalThis.fetch=async(url)=>{
  if(url==='/api/catalog/options')return json({grinds,grinders:[]});
  if(url.startsWith('/api/catalog/product/'))return url.endsWith('9999')?json({error:'Unknown'},404):json({product});
  return json({orders:[],jobs:[]});
 };
  let unmount=await mount(CounterWorkspace);
  try {
  assert.equal(document.querySelector('.barcode-drawer')?.firstElementChild?.getAttribute('aria-label'),'บาร์โค้ดเบอร์บด','counter renders the barcode panel in its original workspace position');
  assert.equal(document.querySelector('details.barcode-drawer'),null,'counter keeps grind barcodes visible without a disclosure');
  assert.equal(document.querySelectorAll('svg[data-barcode]').length,5);
  assert.equal(document.querySelector('dialog[open]')?.textContent.includes('เปิดเสียงเพื่อเริ่มงาน'),true);
  assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='ปิดเสียง'),false);
  await clickText('เปิดเสียงเพื่อเริ่มงาน');assert.deepEqual(tones,[880]);assert.equal(document.querySelector('dialog[open]'),null);assert.equal(document.activeElement?.id,'scan','counter restores scan focus after sound unlock');
  await scan('scan','9999');assert.deepEqual(tones.slice(-2),[220,220]);
  await scan('scan',product.barcode);assert.equal(tones.at(-1),880);assert.ok(gains.includes(1),'scan feedback reaches full Web Audio volume');
  assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='ปิดเสียง'),false);
  await clickText('ยกเลิกรายการนี้');
  await unmount();unmount=await mount(PackingWorkspace);assert.equal(document.querySelector('.barcode-drawer')?.firstElementChild?.getAttribute('aria-label'),'บาร์โค้ดเบอร์บด','packing renders the barcode panel in its original workspace position');assert.equal(document.querySelector('details.barcode-drawer'),null,'packing keeps grind barcodes visible without a disclosure');assert.equal(document.querySelectorAll('svg[data-barcode]').length,5);assert.ok(document.body.textContent.includes('ดังซ้ำทุก 3 วินาทีจนงานรอรับเหลือ 0 ถุง'),'packing clearly explains when the repeating alarm stops');await clickText('สแกนสินค้าใหม่');await settleFocus();assert.equal(document.activeElement?.id,'packing-scan','packing restores scan focus after an action');
 }finally{await unmount();globalThis.fetch=originalFetch;window.AudioContext=originalAudioContext;}
});

test('desktop install button consumes the browser prompt and reports installation',async()=>{
 const pwaModule=await import('../src/components/pwa-install-button.tsx').catch(()=>({}));
 assert.equal(typeof pwaModule.PwaInstallButton,'function');
 const originalMatchMedia=window.matchMedia;let promptCalls=0;
 window.matchMedia=()=>({matches:false,media:'(display-mode: standalone)',onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}});
 const root=createRoot(document.getElementById('root'));
 try {
  await act(async()=>root.render(React.createElement(pwaModule.PwaInstallButton)));
  assert.ok(document.body.textContent.includes('ติดตั้งแอปบน Desktop'));
  const event=new window.Event('beforeinstallprompt');
  Object.assign(event,{prompt:async()=>{promptCalls++;},userChoice:Promise.resolve({outcome:'accepted',platform:'web'})});
  await act(async()=>window.dispatchEvent(event));
  await clickText('ติดตั้งแอปบน Desktop');
  assert.equal(promptCalls,1);
  assert.ok(document.body.textContent.includes('ติดตั้งแล้ว'));
 }finally{await act(async()=>root.unmount());window.matchMedia=originalMatchMedia;}
});

test('web app manifest is configured for the desktop grinding application',async()=>{
 const manifestModule=await import('../src/app/manifest.ts').catch(()=>({}));
 assert.equal(typeof manifestModule.default,'function');
 const value=manifestModule.default();
 assert.equal(value.display,'standalone');
 assert.equal(value.orientation,'landscape');
 assert.equal(value.start_url,'/login');
 assert.deepEqual(value.icons.map(icon=>icon.sizes),['192x192','512x512']);
});

test('order monitor shows queued wait summary and overdue warning',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  if(url==='/api/orders')return json({orders:[{id:'order-1',order_no:'HK-001',created_at:new Date(Date.now()-90000).toISOString(),total_bags:4,total_grams:500,grinding_started_at:new Date(Date.now()-90000).toISOString(),completed_at:null,status:'OPEN',queued_count:2,active_count:1,completed_count:1,oldest_queued_at:new Date(Date.now()-121000).toISOString(),overdue_queued_count:1,progress:{QUEUED:2,GRINDING:1,COMPLETED:1}}]});
  return json({bags:[]});
 };
 const unmount=await mount(OrderMonitor);
 try {
  await act(async()=>{});
  assert.ok(document.body.textContent.includes('รอรับ 2 ถุง'));
  assert.ok(document.body.textContent.includes('ค้างนานสุด 2 นาที'));
  assert.ok(document.body.textContent.includes('มี 1 ถุงรอรับเกิน 1 นาที'));
  assert.equal(document.querySelector('[role="alert"]')?.textContent.includes('เกิน 1 นาที'),true);
  assert.ok(document.body.textContent.includes('SLA 1:30 / 2:00'));
  assert.equal(document.querySelector('[role="alertdialog"]')?.textContent.includes('HK-001'),true);
  await clickText('รับทราบ');
  assert.equal(document.querySelector('[role="alertdialog"]'),null);
 } finally {await unmount();globalThis.fetch=originalFetch;}
});

test('monitor moves completed work out of active view, colors history and clears selection',async(t)=>{
 t.mock.timers.enable({apis:['setInterval']});
 const originalFetch=globalThis.fetch;
 let completed=false;
 const item={id:'order-moving',order_no:'HK-MOVING',created_at:new Date().toISOString(),total_bags:1,total_grams:250,grinding_started_at:null,completed_at:null,status:'OPEN',queued_count:1,active_count:0,completed_count:0,oldest_queued_at:null,overdue_queued_count:0,progress:{QUEUED:1}};
 globalThis.fetch=async(url)=>{
  if(url.startsWith('/api/orders?view=history'))return json({orders:[{...item,status:'COMPLETED',queued_count:0,completed_count:1,progress:{COMPLETED:1}}]});
  if(url==='/api/orders')return json({orders:completed?[]:[item]});
  return json({bags:[]});
 };
 const unmount=await mount(OrderMonitor);
 try{
  assert.ok(document.querySelector('.order-waiting'));
  assert.ok(document.querySelector('.status.warn'));
  await clickText('HK-MOVING');
  assert.ok(document.body.textContent.includes('ไม่มีรายละเอียดถุง'));
  completed=true;await act(async()=>t.mock.timers.tick(2000));
  assert.ok(!document.body.textContent.includes('HK-MOVING'));
  await clickText('ประวัติ');
  assert.ok(document.querySelector('.order-done'));
  assert.ok(document.querySelector('.status.ok'));
  assert.equal(document.querySelector('[aria-expanded="true"]'),null);
  await clickText('งานค้าง');assert.ok(!document.body.textContent.includes('HK-MOVING'));
 }finally{await unmount();globalThis.fetch=originalFetch;}
});

test('admin reset validates confirmation, blocks duplicate submits and clears secrets',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];const pending=deferred();
 globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return pending.promise;};
 const unmount=await mount(()=>React.createElement(AdminPasswordReset,{users:[{id:profile.id,username:'target'}]}));
 try {
  await act(async()=>{const select=document.getElementById('reset-user');select.value=profile.id;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await input('reset-password','new-password');await input('reset-confirm','different');
  const form=document.getElementById('reset-password').closest('form');
  const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await act(async()=>submit());assert.equal(calls.length,0);
  await input('reset-confirm','new-password');
  await act(async()=>{submit();submit();});assert.equal(calls.length,1);
  assert.equal(calls[0].url,`/api/admin/users/${profile.id}/password`);
  assert.equal(document.getElementById('reset-user').disabled,true);
  await act(async()=>pending.resolve(json({requiresLogin:false})));
  assert.equal(document.getElementById('reset-password').value,'');assert.equal(document.getElementById('reset-confirm').value,'');
  assert.ok(document.body.textContent.includes('เปลี่ยนรหัสผ่านสำเร็จ'));
 }finally{await unmount();globalThis.fetch=originalFetch;}
});

test('double confirmation and uncertain network result reuse one immutable order',async()=>{
  const originalFetch=globalThis.fetch; const calls=[]; const first=deferred(); let attempts=0;
  globalThis.fetch=async(url,init)=>{
    if(url==='/api/catalog/options')return json({grinds:[grind]});
    if(url.startsWith('/api/catalog/product/'))return json({product});
    if(url.startsWith('/api/catalog/grind/'))return json({grind});
    if(url==='/api/orders' && init?.method==='POST'){
      calls.push(init.body);attempts++;
      return attempts===1 ? first.promise : json({order:{order_no:'HK-TEST',total_bags:1}});
    }
    return json({orders:[]});
  };
  let unmount=await mount(CounterWorkspace);
  try {
    await scan('scan',product.barcode);assert.ok(document.body.textContent.includes('Coffee'));
    assert.equal(document.getElementById('quantity'),null);
    await scan('scan',grind.barcode);assert.equal(document.getElementById('quantity').value,'1');
    assert.equal(document.querySelector('dialog')?.open,true);
    assert.equal(document.activeElement?.id,'quantity');
    await clickText('ยืนยันจำนวน');
    assert.equal(document.querySelector('dialog'),null);
    await act(async()=>{
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'F10'}));
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'F10'}));
    });
    assert.equal(calls.length,1);
    await act(async()=>first.reject(new TypeError('Network lost after commit')));
    assert.equal(document.getElementById('scan').disabled,true);
    const edit=[...document.querySelectorAll('button')].find(b=>b.textContent==='แก้ไข');
    assert.equal(edit.disabled,true);
    await unmount();
    unmount=await mount(CounterWorkspace);
    assert.ok(document.body.textContent.includes('พบออเดอร์รอยืนยันผล'));
    await clickText('ยืนยัน');
    assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
    assert.ok(document.body.textContent.includes('HK-TEST'));
    assert.equal(document.getElementById('scan').disabled,false);
  } finally {await unmount();globalThis.fetch=originalFetch;}
});

test('Thai layout scanner digit positions preserve numeric barcode and leading zeros',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>json({grinds:[],orders:[]});
  const unmount=await mount(CounterWorkspace);
  try {
    const input=document.getElementById('scan');
    await act(async()=>{
      for(const [key,code] of [['จ','Digit0'],['ๅ','Digit1'],['/','Digit2'],['-','Digit3']]){
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true}));
        input.value+=key;input.setSelectionRange(input.value.length,input.value.length);
        input.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:key}));
      }
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    });
    assert.equal(input.value,'0123');
  } finally {await unmount();globalThis.fetch=originalFetch;}
});

test('packing scans product, grind and quantity to start a batch and completes without a separate claim',async(t)=>{
 const api=packingApi(t,[bag(),bag({queue_seq:2,bag_no:2,status:'CLAIMED',claimed_by:profile.id})]);
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  assert.equal(document.querySelector('.product-result .product-name')?.textContent,product.name);
  assert.equal(document.getElementById('quantity'),null);
  assert.deepEqual(api.posts(),[],'scanning a product does not claim bags');
  await scan('packing-scan',grind.barcode);
  assert.equal(document.querySelector('dialog')?.open,true);
  assert.equal(document.activeElement?.id,'quantity');
  assert.equal(document.getElementById('quantity').max,'2');
  await input('quantity','2');
  await clickText('ยืนยันจำนวน');assert.equal(api.posts().length,0,'grinder is required');
  await select('grinder',profile.id);
  await submitQuantity();
  assert.equal(api.posts().length,1);
  const body=JSON.parse(api.posts()[0].body);
  assert.match(body.clientRequestId,uuid);
  assert.deepEqual(body,{clientRequestId:body.clientRequestId,orderId,productBarcode:product.barcode,grindId:grind.id,quantity:2,grinderUserId:profile.id});
  assert.equal(document.querySelector('dialog'),null);
  assert.ok(document.body.textContent.includes('ยืนยันแล้ว — กำลังบด'));
  assert.ok(api.jobs.every(j=>j.status==='GRINDING'&&j.grinding_batch_id===batchId&&j.claimed_by===profile.id));
  await clickText('เสร็จสิ้น 2 ถุง');
  assert.deepEqual(api.posts().map(c=>c.url),['/api/jobs/start','/api/jobs/complete']);
  const completion=JSON.parse(api.posts()[1].body);
  assert.match(completion.clientRequestId,uuid);assert.deepEqual(completion,{clientRequestId:completion.clientRequestId,batchId});
  assert.ok(api.jobs.every(j=>j.status==='COMPLETED'));
  assert.ok(document.body.textContent.includes('เสร็จสิ้น — จัดเก็บในประวัติแล้ว'));
 }finally{await unmount();}
});

test('packing scanner prioritizes queued work over a grinding batch with the same product barcode',async(t)=>{
 const running=bag({status:'GRINDING',grinding_batch_id:batchId,claimed_by:profile.id});
 const sameProductQueued=bag({queue_seq:2,bag_no:2,grind_id:wrongGrind.id,grind_value_snapshot:'8'});
 const otherProductQueued=bag({queue_seq:3,bag_no:3,product_barcode_snapshot:'001234567891',product_name_snapshot:'Other coffee'});
 const api=packingApi(t,[running,sameProductQueued,otherProductQueued]);const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  assert.equal(document.querySelector('.product-result .product-name')?.textContent,product.name,'the queued item opens directly instead of the running batch masking it');
  assert.equal(document.querySelectorAll('.detail-content button').length,0,'one queued order needs no manual choice');
  await clickText('สแกนสินค้าใหม่');await scan('packing-scan','001234567891');
  assert.equal(document.querySelector('.product-result .product-name')?.textContent,'Other coffee','a different product remains scannable while another batch is grinding');
  assert.equal(api.posts().length,0);
 }finally{await unmount();}
});

test('product name search ignores stale replies and requires an explicit choice',async(t)=>{
  const old=deferred(),selected=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const q=new URL(url,'http://localhost').searchParams.get('q');
    if(q==='ซอง')return old.promise;
    return json({products:[product]});
  });
  const root=createRoot(document.getElementById('root'));
  try{
    await act(async()=>root.render(React.createElement(ProductSearch,{query:'ซอง',onSelect:item=>selected.push(item)})));
    await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));
    await act(async()=>root.render(React.createElement(ProductSearch,{query:'ซองแดง',onSelect:item=>selected.push(item)})));
    await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));
    assert.equal(selected.length,0,'search never chooses a product automatically');
    assert.ok(document.body.textContent.includes(product.sku));
    await act(async()=>old.resolve(json({products:[{...product,sku:'STALE'}]})));
    assert.equal(document.body.textContent.includes('STALE'),false,'late response cannot replace current results');
    await clickText(product.name);assert.deepEqual(selected,[product]);
  }finally{await act(async()=>root.unmount());}
});

test('packing rejects a valid but wrong grind and a failed rescan cannot reuse cancelled verification',async(t)=>{
 const api=packingApi(t);const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  await scan('packing-scan',wrongGrind.barcode);
  assert.ok(document.body.textContent.includes('เบอร์บดไม่ตรง'));
  assert.equal(document.querySelector('dialog'),null);assert.equal(api.posts().length,0);
  await scan('packing-scan',grind.barcode);await select('grinder',profile.id);
  await escapeDialog();await settleFocus();
  assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement?.id,'packing-scan');
  await scan('packing-scan','999999');
  assert.ok(document.body.textContent.includes('Wrong barcode'));
  assert.equal(document.querySelector('dialog'),null);assert.equal(api.posts().length,0);
  await scan('packing-scan',grind.barcode);await submitQuantity();
  assert.equal(api.posts().length,1,'a fresh successful grind scan is required');
  assert.equal(JSON.parse(api.posts()[0].body).grindId,grind.id);
 }finally{await unmount();}
});

test('packing ambiguous product scan requires explicit order selection before grind and batch start',async(t)=>{
 const api=packingApi(t,[bag(),bag({queue_seq:2,bag_no:2}),bag({order_id:otherOrderId,orders:{order_no:'HK-B'},queue_seq:3})]);
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  assert.ok(document.body.textContent.includes('กรุณาเลือกออเดอร์ก่อนสแกนเบอร์บด'));
  const choices=[...document.querySelectorAll('.detail-content button')];
  assert.equal(choices.length,2,'bags in the same order/product form one choice');
  assert.ok(choices.some(b=>b.textContent.includes('HK-A')));assert.ok(choices.some(b=>b.textContent.includes('HK-B')));
  assert.equal(document.querySelector('.product-result'),null);assert.equal(document.querySelector('dialog'),null);
  assert.equal(api.calls.filter(c=>c.url.includes('/api/catalog/grind/')).length,0);assert.equal(api.posts().length,0);
  await clickText('HK-B');await scan('packing-scan',grind.barcode);
  assert.ok(document.querySelector('dialog').textContent.includes('HK-B'));assert.equal(document.getElementById('quantity').max,'1');
  await select('grinder',profile.id);await submitQuantity();
  assert.equal(api.posts().length,1);assert.equal(JSON.parse(api.posts()[0].body).orderId,otherOrderId);
  assert.ok(api.jobs.filter(j=>j.order_id===orderId).every(j=>j.status==='QUEUED'));
 }finally{await unmount();}
});

test('packing rejects blank, fractional and over-quantity input without clamping or counting other grinds/products',async(t)=>{
 const api=packingApi(t,[bag(),bag({queue_seq:2,bag_no:2}),bag({queue_seq:3,grind_id:wrongGrind.id,grind_value_snapshot:'8'}),bag({queue_seq:4,product_barcode_snapshot:'001234567891'})]);
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);await scan('packing-scan',grind.barcode);await select('grinder',profile.id);
  assert.equal(document.getElementById('quantity').max,'2');
  for(const value of ['', '0', '-1', '1.5', '3', '100']){
   await input('quantity',value);
   assert.equal(document.getElementById('quantity').checkValidity(),false,`invalid quantity ${value}`);
   await clickText('ยืนยันจำนวน');await submitQuantity();
   assert.equal(api.posts().length,0,`quantity ${value} must not submit`);assert.ok(document.querySelector('dialog[open]'));
  }
  await input('quantity','2');await submitQuantity();
  assert.equal(api.posts().length,1);assert.equal(JSON.parse(api.posts()[0].body).quantity,2);
 }finally{await unmount();}
});

test('counter modal owns focus, blocks F10 and restores scanner on cancel and quantity confirmation',async(t)=>{
 const posts=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(init?.method==='POST'){posts.push(init.body);return json({order:{order_no:'UNEXPECTED',total_bags:1}});}
  if(url==='/api/catalog/options')return json({grinds:[grind]});
  if(url.startsWith('/api/catalog/product/'))return json({product});
  if(url.startsWith('/api/catalog/grind/'))return json({grind});
  return json({orders:[]});
 });
 const selection=t.mock.method(dom.window.HTMLInputElement.prototype,'select');
 const unmount=await mount(CounterWorkspace);
 try{
  await scan('scan',product.barcode);await scan('scan',grind.barcode);await settleFocus();
  assert.equal(document.activeElement?.id,'quantity');
  assert.ok(selection.mock.calls.some(c=>c.this?.id==='quantity'),'quantity is selected on open');
  const dialog=document.querySelector('dialog');
  assert.ok(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent);
  assert.ok(document.getElementById(dialog.getAttribute('aria-describedby'))?.textContent.includes(product.name));
  await act(async()=>{document.querySelector('dialog h2').click();window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'F10'}));});
  await settleFocus();assert.equal(document.activeElement?.id,'quantity');assert.equal(posts.length,0);
  await escapeDialog();await settleFocus();assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement?.id,'scan');
  await scan('scan',product.barcode);await scan('scan',grind.barcode);await input('quantity','2');await submitQuantity();await settleFocus();
  assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement?.id,'scan');
  assert.equal(document.querySelector('.counter-composer tbody tr td:nth-child(4)')?.textContent,'2');
  assert.equal(posts.length,0,'quantity confirmation adds a draft line, not an order');
 }finally{await unmount();}
});

test('locked quantity allows retry above the new max and cancellation, while busy blocks both',async()=>{
 const confirmed=[];let cancelled=0;
 const root=createRoot(document.getElementById('root'));
 const render=props=>act(async()=>root.render(React.createElement(QuantityDialog,{title:'Retry',description:'Saved quantity',max:5,initial:3,onConfirm:q=>confirmed.push(q),onCancel:()=>cancelled++,...props})));
 try{
  await render({});assert.equal(document.getElementById('quantity').disabled,false);await submitQuantity();assert.deepEqual(confirmed,[3]);
  await render({locked:true,max:0,error:'Network lost'});
  assert.equal(document.getElementById('quantity').disabled,true);assert.equal(document.getElementById('quantity').value,'3');
  assert.equal(document.querySelector('[role="alert"]').textContent,'Network lost');
  await submitQuantity();assert.deepEqual(confirmed,[3,3]);await escapeDialog();assert.equal(cancelled,1);
  await clickText('ยกเลิก');assert.equal(cancelled,2);
  await render({locked:true,busy:true,max:0});await submitQuantity();await escapeDialog();await clickText('ยกเลิก');
  assert.deepEqual(confirmed,[3,3]);assert.equal(cancelled,2);assert.equal(document.querySelector('dialog').open,true);
  await render({locked:false,max:2});await submitQuantity();assert.deepEqual(confirmed,[3,3],'unlocked quantities must still satisfy max');
 }finally{await act(async()=>root.unmount());}
});

test('packing pending network retry keeps identical body after queue disappears and across remount',async(t)=>{
 t.mock.timers.enable({apis:['setInterval']});
 const api=packingApi(t,[bag(),bag({queue_seq:2,bag_no:2})]);
 const first=deferred();let attempts=0;let savedBags=[];
 api.start=()=>{
  attempts++;
  if(attempts===1)return first.promise;
  if(attempts===2)throw new TypeError('Retry result also lost');
  api.jobs=savedBags;
  return json({batch:{batch_id:batchId,bag_ids:savedBags.map(j=>j.id)}});
 };
 let unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);await scan('packing-scan',grind.barcode);await input('quantity','2');await select('grinder',profile.id);
  const form=document.getElementById('quantity').form;
  await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(api.posts().length,1,'double Enter starts only one request');
  const original=api.posts()[0].body,body=JSON.parse(original),key=`coffee-packing-pending:${profile.id}`;
  assert.match(body.clientRequestId,uuid);assert.equal(body.quantity,2);assert.equal(body.grinderUserId,profile.id);
  assert.equal(JSON.parse(sessionStorage.getItem(key)).body,original,'persist before waiting for network');
  await escapeDialog();assert.ok(document.querySelector('dialog[open]'),'busy Escape must not dismiss');
  await act(async()=>first.reject(new TypeError('Network lost after commit')));
  savedBags=api.jobs.map(j=>({...j,status:'GRINDING',claimed_by:profile.id,grinding_batch_id:batchId,grinder_name_snapshot:'Operator'}));
  api.jobs=[];await act(async()=>t.mock.timers.tick(5000));
  assert.ok(document.body.textContent.includes('ไม่มีงานในคิวนี้'));
  assert.equal(document.getElementById('quantity').disabled,true);assert.equal(document.getElementById('quantity').value,'2');
  assert.equal(document.getElementById('grinder').disabled,true);assert.equal(document.getElementById('packing-scan').disabled,true);
  await clickText('ยกเลิก');assert.ok(document.querySelector('dialog[open]'),'parent refuses cancellation of uncertain request');
  await clickText('ยืนยันจำนวน');
  assert.equal(api.posts().length,2,'retry remains possible after polling reports zero available');assert.equal(api.posts()[1].body,original);
  await unmount();unmount=await mount(PackingWorkspace);
  assert.equal(document.querySelector('dialog'),null);assert.equal(document.getElementById('packing-scan').disabled,true);
  assert.equal(JSON.parse(sessionStorage.getItem(key)).body,original);
  await clickText('ยืนยันรายการค้างด้วยข้อมูลเดิม');
  assert.equal(api.posts().length,3);assert.ok(api.posts().every(c=>c.url==='/api/jobs/start'&&c.body===original));
  assert.equal(sessionStorage.getItem(key),null);assert.equal(document.getElementById('packing-scan').disabled,false);
  assert.ok(document.body.textContent.includes('ยืนยันแล้ว — กำลังบด'));
 }finally{await unmount();}
});

test('packing preserves pending start for malformed 2xx and authentication/rate-limit responses',async(t)=>{
 const cases=[
  ['empty success',200,{}],
  ['invalid batch UUID',200,{batch:{batch_id:'not-a-uuid',bag_ids:[]}}],
  ['missing bag_ids',200,{batch:{batch_id:batchId}}],
  ...[401,403,429].map(status=>[`HTTP ${status}`,status,{error:'Retry later'}]),
 ];
 for(const [name,status,payload] of cases)await t.test(name,async(t)=>{
  const api=packingApi(t);let attempts=0;
  api.start=body=>++attempts===1?json(payload,status):api.commitStart(JSON.parse(body));
  const unmount=await mount(PackingWorkspace);
  try{
   await scan('packing-scan',product.barcode);await scan('packing-scan',grind.barcode);await select('grinder',profile.id);await submitQuantity();
   const key=`coffee-packing-pending:${profile.id}`,original=api.posts()[0].body;
   assert.equal(JSON.parse(sessionStorage.getItem(key)).body,original);
   assert.equal(document.getElementById('quantity').disabled,true);assert.equal(document.getElementById('packing-scan').disabled,true);
   assert.ok(document.body.textContent.includes('ยังยืนยันผลไม่ได้'));assert.ok(!document.body.textContent.includes('ยืนยันแล้ว — กำลังบด'));
   await clickText('ยืนยันจำนวน');
   assert.equal(api.posts().length,2);assert.equal(api.posts()[1].body,original);assert.equal(sessionStorage.getItem(key),null);
   assert.equal(document.querySelector('dialog'),null);assert.ok(document.body.textContent.includes('ยืนยันแล้ว — กำลังบด'));
  }finally{await unmount();}
 });
});

test('packing definitive 400/409/422 rejection unlocks an editable retry with a new request ID',async(t)=>{
 for(const status of [400,409,422])await t.test(`HTTP ${status}`,async(t)=>{
  const api=packingApi(t);let attempts=0;
  api.start=body=>++attempts===1?json({error:'Definitively rejected'},status):api.commitStart(JSON.parse(body));
  const unmount=await mount(PackingWorkspace);
  try{
   await scan('packing-scan',product.barcode);await scan('packing-scan',grind.barcode);await select('grinder',profile.id);await submitQuantity();
   assert.equal(sessionStorage.getItem(`coffee-packing-pending:${profile.id}`),null);
   assert.equal(document.getElementById('quantity').disabled,false);assert.ok(document.body.textContent.includes('Definitively rejected'));
   await submitQuantity();assert.equal(api.posts().length,2);
   assert.notEqual(JSON.parse(api.posts()[0].body).clientRequestId,JSON.parse(api.posts()[1].body).clientRequestId);
  }finally{await unmount();}
 });
});

test('malformed batch completion success preserves persisted request and retries identical body',async(t)=>{
 const job=bag({status:'GRINDING',claimed_by:profile.id,grinding_batch_id:batchId});
 const api=packingApi(t,[job]);let attempts=0;
 api.complete=()=>++attempts===1?json({}):json({batch:{batch_id:batchId,bag_ids:[job.id]}});
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);await clickText('เสร็จสิ้น 1 ถุง');
  const original=api.posts()[0].body,key=`coffee-packing-pending:${profile.id}`;
  assert.equal(JSON.parse(sessionStorage.getItem(key)).body,original);
  assert.ok(!document.body.textContent.includes('เสร็จสิ้น — จัดเก็บในประวัติแล้ว'));
  await clickText('ยืนยันรายการค้างด้วยข้อมูลเดิม');
  assert.deepEqual(api.posts().map(c=>c.url),['/api/jobs/complete','/api/jobs/complete']);
  assert.equal(api.posts()[1].body,original);assert.equal(sessionStorage.getItem(key),null);
  assert.ok(document.body.textContent.includes('เสร็จสิ้น — จัดเก็บในประวัติแล้ว'));
 }finally{await unmount();}
});

test('legacy GRINDING jobs without batches remain distinct and complete only the selected job',async(t)=>{
 const jobs=[bag({status:'GRINDING',claimed_by:profile.id}),bag({status:'GRINDING',claimed_by:profile.id,queue_seq:2,bag_no:2})];
 const api=packingApi(t,jobs);api.legacyJobId=jobs[1].id;
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  const choices=[...document.querySelectorAll('.detail-content button')];assert.equal(choices.length,2);
  assert.ok(choices.some(b=>b.textContent.includes('คิว #1')));assert.ok(choices.some(b=>b.textContent.includes('คิว #2')));
  await clickText('คิว #2');assert.equal(document.querySelector('dialog'),null);assert.equal(api.posts().length,0);
  await clickText('เสร็จสิ้นรายการเดิม');
  assert.deepEqual(api.posts().map(c=>c.url),[`/api/jobs/${jobs[1].id}/transition`]);
  assert.deepEqual(JSON.parse(api.posts()[0].body),{expectedStatus:'GRINDING',nextStatus:'COMPLETED'});
  assert.equal(api.jobs[0].status,'GRINDING');assert.equal(api.jobs[1].status,'COMPLETED');
  assert.ok(document.body.textContent.includes('เสร็จสิ้นรายการเดิมแล้ว'));
 }finally{await unmount();}
});

test('barcode-less grind selector shows eligible grinds and refreshes availability before opening modal',async(t)=>{
 const eligible=bag();const api=packingApi(t,[eligible,bag({status:'COMPLETED',grind_id:wrongGrind.id,grind_value_snapshot:'8'})]);
 api.grinds=[{...grind,barcode:null},wrongGrind];
 const unmount=await mount(PackingWorkspace);
 try{
  await scan('packing-scan',product.barcode);
  assert.deepEqual([...document.getElementById('packing-grind-select').options].map(o=>o.value),['',grind.id]);
  const before=api.calls.filter(c=>c.url===`/api/jobs?orderId=${orderId}`).length;
  api.jobs=[];await select('packing-grind-select',grind.id);
  assert.ok(api.calls.filter(c=>c.url===`/api/jobs?orderId=${orderId}`).length>before,'selection performs a fresh order fetch');
  assert.equal(document.querySelector('dialog'),null);assert.ok(document.body.textContent.includes('ไม่มีถุงรอรับสำหรับเบอร์นี้แล้ว'));
  assert.equal(api.posts().length,0);
  api.jobs=[eligible];await clickText('สแกนสินค้าใหม่');await scan('packing-scan',product.barcode);
  await select('packing-grind-select',grind.id);
  assert.ok(document.querySelector('dialog[open]'));assert.equal(document.activeElement?.id,'quantity');
  await select('grinder',profile.id);await submitQuantity();
  assert.equal(api.posts().length,1);assert.equal(JSON.parse(api.posts()[0].body).grindId,grind.id);
  assert.equal(api.calls.filter(c=>c.url.includes('/api/catalog/grind/')).length,0,'manual choice works without a grind barcode');
 }finally{await unmount();}
});

test('counter and manual orders retain identical recovery requests for malformed success and 401/403/429',async(t)=>{
 const cases=[
  ['COUNTER','empty success',200,{}],
  ...[401,403,429].map(status=>['COUNTER',`HTTP ${status}`,status,{error:'Retry later'}]),
  ['PACKING_MANUAL','empty success',200,{}],
  ['PACKING_MANUAL','missing batch',200,{order:{order_no:'HK-MANUAL',total_bags:1}}],
  ['PACKING_MANUAL','invalid batch UUID',200,{order:{order_no:'HK-MANUAL',total_bags:1,batch_id:'------------------------------------'}}],
  ['PACKING_MANUAL','invalid total',200,{order:{order_no:'HK-MANUAL',total_bags:1.5,batch_id:batchId}}],
  ['PACKING_MANUAL','missing order number',200,{order:{total_bags:1,batch_id:batchId}}],
 ];
 for(const [source,name,status,payload] of cases)await t.test(`${source} ${name}`,async(t)=>{
  const calls=[],navigations=[],key=`coffee-pending:${profile.id}:${source}`;
  t.mock.method(router,'push',url=>navigations.push(url));
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   if(url==='/api/catalog/options')return json({grinds:[grind],grinders:[{id:profile.id,name:'Operator'}]});
   if(url.startsWith('/api/catalog/product/'))return json({product});
   if(url.startsWith('/api/catalog/grind/'))return json({grind});
   if(url==='/api/orders'&&init?.method==='POST'){
    calls.push(init.body);return calls.length===1?json(payload,status):json({order:{id:orderId,order_no:'HK-SAVED',total_bags:1,batch_id:source==='PACKING_MANUAL'?batchId:null}});
   }
   assert.equal(url,'/api/orders');return json({orders:[]});
  });
  let unmount=await mount(CounterWorkspace,{source});
  try{
   await scan('scan',product.barcode);await scan('scan',grind.barcode);
   if(source==='PACKING_MANUAL')await select('manual-grinder',profile.id);
   await submitQuantity();
   if(source==='COUNTER')await clickText('ยืนยัน 1 ถุง');
   assert.equal(calls.length,1);
   const original=calls[0];assert.equal(JSON.parse(original).source,source);
   if(source==='PACKING_MANUAL')assert.equal(JSON.parse(original).grinderUserId,profile.id);
   const saved=sessionStorage.getItem(key);
   assert.ok(saved,'an unverified order response must retain its recovery record');
   assert.equal(JSON.parse(saved).body,original);assert.equal(document.getElementById('scan').disabled,true);
   assert.equal(document.querySelector('.counter-composer tbody tr button').disabled,true);assert.deepEqual(navigations,[]);
   await unmount();unmount=await mount(CounterWorkspace,{source});
   assert.ok(document.body.textContent.includes('พบออเดอร์รอยืนยันผล'));
   await clickText('ยืนยัน 1 ถุง');assert.deepEqual(calls,[original,original]);
   assert.equal(sessionStorage.getItem(key),null);assert.equal(document.getElementById('scan').disabled,false);
   assert.ok(document.body.textContent.includes('HK-SAVED'));
   assert.deepEqual(navigations,source==='PACKING_MANUAL'?[`/packing?batch=${batchId}`]:[]);
  }finally{await unmount();sessionStorage.removeItem(key);}
 });
});

test('counter storage cleanup failure keeps the committed order recoverable with its original body',async(t)=>{
 const calls=[],key=`coffee-pending:${profile.id}:COUNTER`;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url==='/api/catalog/options')return json({grinds:[grind]});
  if(url.startsWith('/api/catalog/product/'))return json({product});
  if(url.startsWith('/api/catalog/grind/'))return json({grind});
  if(url==='/api/orders'&&init?.method==='POST'){calls.push(init.body);return json({order:{id:orderId,order_no:'HK-SAVED',total_bags:1,batch_id:null}});}
  assert.equal(url,'/api/orders');return json({orders:[]});
 });
 const remove=dom.window.Storage.prototype.removeItem;let fail=true;
 const removal=t.mock.method(dom.window.Storage.prototype,'removeItem',function(name){if(name===key&&fail){fail=false;throw new Error('Storage unavailable');}return remove.call(this,name);});
 const unmount=await mount(CounterWorkspace);
 try{
  await scan('scan',product.barcode);await scan('scan',grind.barcode);await submitQuantity();await clickText('ยืนยัน 1 ถุง');
  assert.equal(calls.length,1);assert.equal(JSON.parse(sessionStorage.getItem(key)).body,calls[0]);
  assert.equal(document.getElementById('scan').disabled,true);assert.equal(document.querySelector('.counter-composer tbody tr td:nth-child(4)').textContent,'1');
  assert.ok(!document.body.textContent.includes('บันทึก HK-SAVED สำเร็จ'));
  await clickText('ยืนยัน 1 ถุง');assert.equal(calls.length,2);assert.equal(calls[1],calls[0]);assert.equal(sessionStorage.getItem(key),null);
  assert.ok(document.body.textContent.includes('บันทึก HK-SAVED สำเร็จ'));
 }finally{await unmount();removal.mock.restore();sessionStorage.removeItem(key);}
});
