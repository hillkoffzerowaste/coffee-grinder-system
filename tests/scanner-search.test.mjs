import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, useRef, useState } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { createRoot } = await import('react-dom/client');
const { useScannerInput, scannerDigit } = await import('../src/lib/scanner.ts');
const nativeValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
const thaiKeys = ['จ', 'ๅ', '/', '-', 'ภ', 'ถ', 'ุ', 'ึ', 'ค', 'ต'];
const thaiBurst = digits => [...digits].map(d => [thaiKeys[Number(d)], `Digit${d}`]);

async function setup(t, initial = '') {
  const submitted = [], enterSeen = [];
  function Harness({ enabled, visible = true }) {
    const ref = useRef(null), [value, setValue] = useState(initial);
    useScannerInput(ref, setValue, enabled);
    return React.createElement('form', { onSubmit(event) {
      event.preventDefault(); submitted.push({ dom: ref.current.value, state: value });
    } }, visible && React.createElement('input', {
      ref, value, onChange: e => setValue(e.target.value),
      onKeyDown(event) {
        if (event.key === 'Enter') {
          enterSeen.push({ dom: event.currentTarget.value, state: value, prevented: event.defaultPrevented });
          // jsdom has no keyboard default actions. Submit here to prove native
          // capture commits before even React's bubbling keydown handler runs.
          if (!event.defaultPrevented) event.currentTarget.form.requestSubmit();
        }
      },
    }), React.createElement('output', null, value));
  }
  const root = createRoot(document.getElementById('root'));
  const render = props => act(async () => root.render(React.createElement(Harness, props)));
  t.after(async () => { await act(async () => root.unmount()); });
  await render({});
  const input = () => document.querySelector('input');
  input().focus();
  function key(key, code, time, options = {}, target = input()) {
    const event = new dom.window.KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...options });
    Object.defineProperty(event, 'timeStamp', { value: time });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'hybrid hook must not prevent native typing or Enter');
  }
  function edit(value, inputType = 'insertText', target = input()) {
    nativeValue.call(target, value);
    target.setSelectionRange(value.length, value.length);
    target.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType }));
  }
  function type(keys, gap = 10, start = 100, target = input()) {
    keys.forEach(([character, code], index) => {
      key(character, code, start + index * gap, {}, target);
      const from = target.selectionStart, to = target.selectionEnd;
      edit(target.value.slice(0, from) + character + target.value.slice(to), 'insertText', target);
    });
    return start + keys.length * gap;
  }
  function expectSubmitted(value) {
    assert.deepEqual(submitted.at(-1), { dom: value, state: value });
    assert.deepEqual(enterSeen.at(-1), { dom: value, state: value, prevented: false });
    assert.equal(input().value, value);assert.equal(document.querySelector('output').textContent, value);
  }
  return { input, key, edit, type, render, submitted, expectSubmitted };
}

test('scannerDigit physical mapping and modifier contract remains unchanged', () => {
  for (const prefix of ['Digit', 'Numpad']) for (let digit = 0; digit < 10; digit++) {
    assert.equal(scannerDigit({ code: `${prefix}${digit}` }), String(digit));
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(scannerDigit({ code: `${prefix}${digit}`, [modifier]: true }), null);
  }
  assert.equal(scannerDigit({ code: 'KeyA' }), null);
});

test('Thai hardware burst stays raw until Enter then updates DOM and React before submit', async t => {
  const h = await setup(t);
  await act(async () => {
    const end = h.type(thaiBurst('001234567890'));
    assert.equal(h.input().value, 'จจๅ/-ภถุึคตจ');
    assert.equal(h.submitted.length, 0);
    h.key('Enter', 'Enter', end);
  });
  h.expectSubmitted('001234567890');
});

test('slow Thai digit-position typing remains Thai even with a fast suffix and immediate Enter', async t => {
  const h = await setup(t);
  for (const [index, pair] of thaiBurst('0123').entries()) await act(async () => h.type([pair], 100, 100 + index * 100));
  await act(async () => { const end = h.type(thaiBurst('4567'), 5, 410);h.key('Enter', 'Enter', end); });
  h.expectSubmitted('จๅ/-ภถุึ');
});

test('fast Thai mixed letters and English name/SKU are never normalized', async t => {
  for (const [name, keys] of [
    ['Thai name', [['จ','Digit0'],['ุ','Digit6'],['ล','KeyS'],['ภ','Digit4'],['า','KeyK']]],
    ['English SKU', [['R','KeyR'],['B','KeyB'],['-','Minus'],['0','Digit0'],['0','Digit0'],['1','Digit1'],['2','Digit2']]],
    ['Thai name with burst prefix', [...thaiBurst('0123'),['ก','KeyD']]],
  ]) await t.test(name, async t => {
    const h = await setup(t);
    await act(async () => h.type(keys, 5));
    await act(async () => h.key('Enter','Enter',100+keys.length*5));
    h.expectSubmitted(keys.map(([key])=>key).join(''));
  });
});

test('pasted numeric strings and Thai search text retain exact characters and leading zeros', async t => {
  for (const value of ['00000000000000000000000000000001', 'กาแฟ ซองแดง', 'RB-HK-0012']) await t.test(value, async t => {
    const h=await setup(t);
    await act(async()=>{h.input().dispatchEvent(new dom.window.Event('paste'));h.edit(value,'insertFromPaste');});
    await act(async()=>h.key('Enter','Enter',100));h.expectSubmitted(value);
  });
});

test('short bursts, late Enter and bursts beyond total time bound remain raw', async t => {
  for (const [name,digits,gap,enterDelay] of [['short','012',10,0],['late Enter','0123',10,40],['total time','0'.repeat(40),30,0]]) await t.test(name,async t=>{
    const h=await setup(t);let end;
    await act(async()=>{end=h.type(thaiBurst(digits),gap);});
    await act(async()=>h.key('Enter','Enter',end+enterDelay));
    h.expectSubmitted(thaiBurst(digits).map(([key])=>key).join(''));
  });
});

test('English and numpad bursts preserve long digit strings without numeric coercion', async t => {
  for (const prefix of ['Digit','Numpad']) await t.test(prefix,async t=>{
    const h=await setup(t),value='00012345678901234567890123456789';
    await act(async()=>{const end=h.type([...value].map(d=>[d,`${prefix}${d}`]),5);h.key('Enter','Enter',end);});
    h.expectSubmitted(value);
  });
});

test('whole-selection replacement can scan but appending to text cannot', async t => {
  for (const replace of [true,false]) await t.test(replace?'replace':'append',async t=>{
    const h=await setup(t,'Coffee');h.input().setSelectionRange(replace?0:6,6);
    await act(async()=>{const end=h.type(thaiBurst('0123'));h.key('Enter','Enter',end);});
    h.expectSubmitted(replace?'0123':'Coffeeจๅ/-');
  });
});

test('edits, paste, caret changes, repeat/modifiers and composition invalidate a burst', async t => {
  const interruptions=[
    ['paste',h=>h.input().dispatchEvent(new dom.window.Event('paste'))],
    ['cut',h=>h.input().dispatchEvent(new dom.window.Event('cut'))],
    ['drop',h=>h.input().dispatchEvent(new dom.window.Event('drop'))],
    ['pointer',h=>h.input().dispatchEvent(new dom.window.Event('pointerdown'))],
    ['blur',h=>h.input().dispatchEvent(new dom.window.Event('blur'))],
    ['arrow',h=>h.key('ArrowLeft','ArrowLeft',135)],
    ['repeat',h=>h.key('จ','Digit0',135,{repeat:true})],
    ['control',h=>h.key('c','KeyC',135,{ctrlKey:true})],
    ['shift Enter',h=>h.key('Shift','ShiftLeft',135,{shiftKey:true})],
    ['composition',h=>{h.input().dispatchEvent(new dom.window.Event('compositionstart'));h.input().dispatchEvent(new dom.window.Event('compositionend'));}],
    ['composing key',h=>h.key('จ','Digit0',135,{isComposing:true})],
    ['replacement input',h=>h.edit(h.input().value,'insertReplacementText')],
  ];
  for(const [name,interrupt] of interruptions)await t.test(name,async t=>{
    const h=await setup(t);
    await act(async()=>{h.type(thaiBurst('0123'));interrupt(h);});
    await act(async()=>h.key('Enter','Enter',140));h.expectSubmitted('จๅ/-');
  });
});

test('enabled=false detaches old input and enabled=true attaches replacement input',async t=>{
  const h=await setup(t);const old=h.input();
  await act(async()=>h.type(thaiBurst('0123')));
  await h.render({enabled:false,visible:false});assert.equal(h.input(),null);
  await act(async()=>h.key('Enter','Enter',140,{},old));assert.equal(old.value,'จๅ/-');
  await h.render({enabled:true});assert.notEqual(h.input(),old);
  h.input().focus();h.input().select();
  await act(async()=>{const end=h.type(thaiBurst('0012'),10,200);h.key('Enter','Enter',end);});
  h.expectSubmitted('0012');
  await h.render({enabled:false});h.input().select();
  await act(async()=>h.type(thaiBurst('3456'),10,300));
  await act(async()=>h.key('Enter','Enter',340));h.expectSubmitted('-ภถุ');
});
