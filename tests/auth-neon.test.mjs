import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,checkPassword,hashToken} from '../src/lib/password.ts';
test('passwords are salted, verified, and never stored in plaintext',async()=>{
 const first=await hashPassword('A-strong-password');const second=await hashPassword('A-strong-password');
 assert.notEqual(first,second);assert.equal(first.includes('A-strong-password'),false);
 assert.equal(await checkPassword('A-strong-password',first),true);
 assert.equal(await checkPassword('wrong',first),false);
 assert.equal(await checkPassword('wrong','malformed'),false);
 assert.equal(hashToken('session').length,64);
});
