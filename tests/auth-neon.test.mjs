import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,checkPassword,hashToken} from '../src/lib/password.ts';
import {resetPasswordSchema,resetAccountPassword} from '../src/lib/reset-password.ts';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
test('passwords are salted, verified, and never stored in plaintext',async()=>{
 const first=await hashPassword('A-strong-password');const second=await hashPassword('A-strong-password');
 assert.notEqual(first,second);assert.equal(first.includes('A-strong-password'),false);
 assert.equal(await checkPassword('A-strong-password',first),true);
 assert.equal(await checkPassword('wrong',first),false);
 assert.equal(await checkPassword('wrong','malformed'),false);
 assert.equal(hashToken('session').length,64);
});

test('reset validates confirmation and length; never accepts extra role fields',()=>{
 for(const value of [null,{}, {password:'short',confirmPassword:'short'}, {password:'abcdefgh',confirmPassword:'different'}, {password:'abcdefgh',confirmPassword:'abcdefgh',role:'admin'}])assert.equal(resetPasswordSchema.safeParse(value).success,false);
 assert.equal(resetPasswordSchema.safeParse({password:'abcdefgh',confirmPassword:'abcdefgh'}).success,true);
});

test('password reset updates hash, revokes all target sessions, and audits without secrets',async()=>{
 const db=new PGlite();
 try {
  await db.exec(await readFile('database/migrations/001_neon.sql','utf8'));
  const actor=randomUUID(),target=randomUUID(),oldHash=await hashPassword('old-password'),newHash=await hashPassword('new-password');
  for(const [id,name,role] of [[actor,'admin','admin'],[target,'counter','counter']]){
   await db.query('insert into coffee.accounts(id,password_hash) values ($1,$2)',[id,oldHash]);
   await db.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,$2,$2,$3,'both')",[id,name,role]);
  }
  for(const [token,id] of [['one',target],['two',target],['admin-token',actor]])await db.query('insert into coffee.sessions(token_hash,user_id) values ($1,$2)',[hashToken(token),id]);
  const client={query:async(sql,values)=>{const result=await db.query(sql,values);return {...result,rowCount:result.rows.length};}};
  await db.exec('begin');assert.equal(await resetAccountPassword(client,actor,target,newHash),true);await db.exec('commit');
  const stored=(await db.query('select password_hash from coffee.accounts where id=$1',[target])).rows[0].password_hash;
  assert.equal(await checkPassword('old-password',stored),false);assert.equal(await checkPassword('new-password',stored),true);
  assert.equal((await db.query('select * from coffee.sessions where user_id=$1 and revoked_at is null',[target])).rows.length,0);
  assert.equal((await db.query('select * from coffee.sessions where user_id=$1 and revoked_at is null',[actor])).rows.length,1);
  const audit=(await db.query('select * from coffee.audit_log')).rows;assert.equal(audit[0].action,'RESET_PASSWORD');
  assert.equal(JSON.stringify(audit).includes(newHash),false);assert.equal(JSON.stringify(audit).includes('new-password'),false);
  assert.equal(await resetAccountPassword(client,actor,randomUUID(),newHash),false);
 }finally{await db.close();}
});
