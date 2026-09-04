import assert from 'node:assert/strict';

// Run against an unconfigured local production build, never a live customer site.
const base='http://127.0.0.1:3217';
const login=await fetch(`${base}/login`);
assert.equal(login.status,200);
const html=await login.text();
assert.match(html,/autocomplete="current-password"/i);
assert.ok(html.includes('id="main"'));
for(const path of ['/counter','/packing','/admin']){
  const response=await fetch(base+path,{redirect:'manual'});
  assert.equal(response.status,307);
  assert.ok(response.headers.get('location').endsWith('/login'));
}
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
assert.equal((await post('/api/auth/login',{})).status,400);
const unavailable=await post('/api/auth/login',{username:'counter',password:'not-a-real-password',station:'counter'});
assert.equal(unavailable.status,503);
assert.ok((await unavailable.json()).error.includes('ฐานข้อมูล'));
assert.equal((await post('/api/auth/login',{}, {origin:'https://foreign.example'})).status,403);
assert.equal((await fetch(base+'/api/orders')).status,503);
assert.equal((await post('/api/auth/logout',{})).status,503);
console.log('Production HTTP checks passed: login, guarded redirects, validation, configuration errors, and cross-origin rejection.');
