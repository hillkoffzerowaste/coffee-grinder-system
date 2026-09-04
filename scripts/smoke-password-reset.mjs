import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {hashToken} from '../src/lib/password.ts';
const base=process.env.SMOKE_URL||'http://127.0.0.1:3002';
const admin=JSON.parse(await readFile('.production-accounts.json','utf8')).accounts.find(a=>a.username==='admin');
const username='verify-'+randomBytes(8).toString('hex'),oldPassword=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex');
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
const c=new Client({connectionString:url.toString()});await c.connect();let target,adminCookie;
const send=(path,method,body,cookie)=>fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
async function login(username,password,station){return send('/api/auth/login','POST',{username,password,station});}
try {
 const a=await login(admin.username,admin.password,'packing');assert.equal(a.status,200);adminCookie=a.headers.get('set-cookie').split(';')[0];
 const create=await send('/api/admin/users','POST',{username,password:oldPassword,displayName:'Temporary reset verification',role:'counter',station:'counter'},adminCookie);
 assert.equal(create.status,201);target=(await create.json()).id;
 const user=await login(username,oldPassword,'counter');assert.equal(user.status,200);const cookie=user.headers.get('set-cookie').split(';')[0];
 const path=`/api/admin/users/${target}/password`,body={password:newPassword,confirmPassword:newPassword};
 assert.equal((await send(path,'PATCH',body,cookie)).status,403);
 assert.equal((await send(path,'PATCH',{...body,confirmPassword:'wrong'},adminCookie)).status,400);
 assert.equal((await send(path,'PATCH',body,adminCookie)).status,200);
 assert.equal((await fetch(base+'/api/auth/me',{headers:{cookie}})).status,401);
 assert.equal((await login(username,oldPassword,'counter')).status,401);
 assert.equal((await login(username,newPassword,'counter')).status,200);
 console.log('Password reset HTTP passed: admin-only, confirmation, old password rejected, new password accepted, old session revoked.');
} finally {
 // Delete only this randomly named verification account and its test records.
 await c.query('begin');
 if(target){
  await c.query("delete from coffee.audit_log where entity='profiles' and entity_id=$1",[target]);
  await c.query('delete from coffee.sessions where user_id=$1',[target]);
  await c.query('delete from coffee.profiles where id=$1 and username=$2',[target,username]);
  await c.query('delete from coffee.accounts where id=$1',[target]);
 }
 await c.query('delete from coffee.login_attempts where key=$1',[hashToken('login:'+username)]);
 await c.query('commit');await c.end();
 if(adminCookie)await send('/api/auth/logout','POST',{},adminCookie);
 console.log('Temporary verification account removed. Existing account passwords unchanged.');
}
