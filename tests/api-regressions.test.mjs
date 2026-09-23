import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminEntity, parseAdminPayload, pickAllowed } from '../src/lib/admin-entities.ts';
import { apiFetch, ApiError } from '../src/lib/api.ts';
import { isAllowedMutation } from '../src/lib/request-origin.ts';

test('admin allowlist rejects prototype properties and malformed payloads',()=>{
  for(const key of ['constructor','__proto__','toString'])assert.equal(isAdminEntity(key),false);
  for(const payload of [null,[],false,42,'products',{}]){
    assert.deepEqual(pickAllowed('products',payload),{});
    assert.equal(parseAdminPayload('products',payload,true).success,false);
  }
  assert.equal(parseAdminPayload('products',{sku:'TEST',name:'Coffee',size_grams:199}).success,false);
  assert.equal(parseAdminPayload('products',{sku:'TEST',name:'Coffee',size_grams:200}).success,true);
  assert.equal(parseAdminPayload('products',{active:'false'},true).success,false);
  assert.equal(parseAdminPayload('product_barcodes',{product_id:'bad-id',barcode:123456}).success,false);
  assert.equal(parseAdminPayload('app_settings',{key:'setting'}).success,false);
});
test('cross-site mutation requests including login and logout are rejected',()=>{
  const request=(headers)=>new Request('https://coffee.example/api/auth/login',{method:'POST',headers});
  assert.equal(isAllowedMutation(request({origin:'https://coffee.example'})),true);
  assert.equal(isAllowedMutation(request({origin:'https://attacker.example'})),false);
  assert.equal(isAllowedMutation(request({'sec-fetch-site':'cross-site'})),false);
  assert.equal(isAllowedMutation(request({origin:'null'})),false);
});

test('configured App Hosting public origin is allowed when the platform request URL is internal',()=>{
 const previous=process.env.APP_PUBLIC_ORIGIN;
 process.env.APP_PUBLIC_ORIGIN='https://coffee-grinder--esg-hillkoff.us-east4.hosted.app';
 try {
  const request=new Request('https://internal-app-hosting-service/api/auth/login',{method:'POST',headers:{origin:process.env.APP_PUBLIC_ORIGIN,'sec-fetch-site':'same-origin'}});
  assert.equal(isAllowedMutation(request),true);
 } finally {
  if(previous===undefined)delete process.env.APP_PUBLIC_ORIGIN; else process.env.APP_PUBLIC_ORIGIN=previous;
 }
});
test('malformed successful HTTP response is not reported as saved; preserve Headers',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async(_,init)=>{assert.equal(init.headers.get('x-test'),'yes');return new Response('not json',{status:200})};
    await assert.rejects(apiFetch('/test',{headers:new Headers({'x-test':'yes'})}),e=>e instanceof ApiError&&e.status===502);
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'Denied'}),{status:403});
    await assert.rejects(apiFetch('/test'),e=>e instanceof ApiError&&e.status===403);
  }finally{globalThis.fetch=originalFetch;}
});
