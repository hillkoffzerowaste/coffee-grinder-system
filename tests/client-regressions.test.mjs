import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,self:dom.window,sessionStorage:dom.window.sessionStorage,document:dom.window.document,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const { createRoot } = await import('react-dom/client');
const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const { CounterWorkspace } = await import('../src/components/counter-workspace.tsx');
const { PackingWorkspace } = await import('../src/components/packing-workspace.tsx');
const { AdminPasswordReset } = await import('../src/components/admin-password-reset.tsx');
const router = {replace(){},refresh(){},push(){},prefetch(){},back(){},forward(){}};
const product = {id:'e9b56600-31ae-48ca-8b4e-669a8794b460',sku:'RB-HK-TEST',name:'Coffee',size_grams:200,barcode:'001234567890',unit:'bag'};
const grind = {id:'c0db63ae-0bce-4483-b1d6-05fd627e9821',grind_value:'6',barcode:'990006'};
const profile = {id:'7d785dbc-14a0-4322-881a-8e72c7a7ab1d',username:'test',display_name:'Test',active:true,role:'admin',station:'packing'};
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const deferred = ()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
async function mount(Component) {
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(Component,{profile}))));
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
    await clickText('เพิ่มรายการ');
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
      for(const [key,code] of [['จ','Digit0'],['ๅ','Digit1'],['/','Digit2'],['-','Digit3']])input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true}));
    });
    assert.equal(input.value,'0123');
  } finally {await unmount();globalThis.fetch=originalFetch;}
});

test('failed grind rescan clears prior verification and cannot start grinding',async()=>{
  const originalFetch=globalThis.fetch;let scans=0,transitions=0;
  const job={id:'job-1',queue_seq:1,status:'CLAIMED',product_name_snapshot:'Coffee',sku_snapshot:'RB-HK-TEST',size_grams_snapshot:200,grind_value_snapshot:'6',product_barcode_snapshot:product.barcode};
  globalThis.fetch=async(url)=>{
    if(url==='/api/jobs')return json({jobs:[job]});
    if(url==='/api/catalog/options')return json({grinders:[{id:'operator-1',name:'Operator'}]});
    if(url.startsWith('/api/catalog/grind/'))return ++scans===1?json({grind}):json({error:'Wrong barcode'},404);
    transitions++;return json({});
  };
  const unmount=await mount(PackingWorkspace);
  try {
    await clickText('เปิดงาน');await scan('packing-scan','990006');
    assert.ok(document.body.textContent.includes('ตรวจเบอร์บดแล้ว'));
    await act(async()=>{const el=document.getElementById('grinder');el.value='operator-1';el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
    await scan('packing-scan','999999');
    assert.ok(document.body.textContent.includes('รอสแกนเบอร์บด'));
    await clickText('เริ่มบด');assert.equal(transitions,0);
  } finally {await unmount();globalThis.fetch=originalFetch;}
});
