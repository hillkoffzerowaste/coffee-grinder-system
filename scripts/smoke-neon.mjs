import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.SMOKE_URL||'http://127.0.0.1:3001';
const accounts=JSON.parse(await readFile('.production-accounts.json','utf8')).accounts;
assert.equal((await fetch(base+'/login')).status,200);
assert.equal((await fetch(base+'/api/orders')).status,401);
for(const account of accounts){
 const station=account.station==='both'?'packing':account.station;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:account.username,password:account.password,station})});
 assert.equal(login.status,200,`${account.username} login`);
 const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const options=await fetch(base+'/api/catalog/options',{headers:{cookie}});assert.equal(options.status,200);
 const catalog=await options.json();assert.equal(catalog.grinds.length,13);assert.equal(catalog.grinds.filter(g=>g.barcode).length,5);
 const products=await fetch(base+'/api/admin/products',{headers:{cookie}});
 assert.equal(products.status,account.username==='admin'?200:403);
 if(products.status===200)assert.equal((await products.json()).items.length,143);
 const product=await fetch(base+'/api/catalog/product/2005002940000',{headers:{cookie}});
 assert.equal(product.status,200);assert.equal((await product.json()).product.size_grams,500);
 const jobs=await fetch(base+'/api/jobs',{headers:{cookie}});assert.equal(jobs.status,station==='packing'?200:403);
 const bad=await fetch(base+'/api/orders',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});assert.equal(bad.status,400);
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,200);
 assert.equal((await fetch(base+'/api/auth/me',{headers:{cookie}})).status,401);
 console.log(`${account.username}: login/catalog/permissions/validation/logout verified`);
}
const foreign=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:'https://foreign.example','content-type':'application/json'},body:'{}'});
assert.equal(foreign.status,403);
console.log('Neon authenticated HTTP smoke passed. No orders or catalog data were modified.');
