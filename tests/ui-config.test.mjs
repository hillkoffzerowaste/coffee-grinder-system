import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultUiConfig, parseUiConfig } from '../src/lib/ui-config.ts';

test('safe UI configuration accepts declared tokens and rejects executable styling',()=>{
 const valid={...defaultUiConfig,theme:{...defaultUiConfig.theme,accent:'#123456'},menus:defaultUiConfig.menus.map((menu,index)=>({...menu,order:index}))};
 assert.equal(parseUiConfig(valid).success,true);
 for(const unsafe of [
  {...valid,customCss:'body{display:none}'},
  {...valid,menus:[{id:'counter',label:'หน้าร้าน',visible:true,order:0,href:'https://foreign.example'}]},
  {...valid,theme:{...valid.theme,accent:'url(https://foreign.example)'}},
 ]) assert.equal(parseUiConfig(unsafe).success,false);
});
