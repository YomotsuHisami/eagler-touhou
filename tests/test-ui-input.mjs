import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(resolve(tmpdir(), 'ui-input-'));
const alias = {name:'authored',setup(plugin){plugin.onResolve({filter:/\.mjs$/},args=>{
 const authored=resolve(args.resolveDir,args.path).replace(/\.mjs$/,'.mts');if(authored.startsWith(resolve(root,'src')+'/')&&existsSync(authored))return{path:authored};
});}};
try {
 const entry=resolve(temp,'input.mjs');
 await build({stdin:{contents:`export * from './app/runtime/input-controller.ts'; export * from './app/runtime/input-geometry.ts'; export * from './app/runtime/input-dom.ts'; export {DEFAULT_GAME_OPTIONS} from './src/launcher/game-preferences.mts';`,resolveDir:root},outfile:entry,bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[alias]});
 const {createRuntimeInput,joystickPoint,directTouchPoint,layoutPosition,bindInputContact,DEFAULT_GAME_OPTIONS}=await import(pathToFileURL(entry));
 let passed=0;
 const test=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
 function fixture(game='th06',overrides={}) {
  let options={...DEFAULT_GAME_OPTIONS,touchEnabled:true,...overrides};let messages=[];
  let context={target:{postMessage:(message,origin)=>messages.push({message,origin})},targetOrigin:'https://example.test',protocol:'eagler-touhou/1',game,epoch:1,launched:true,ready:true,spectator:false};
  const scheduled=new Map();let serial=0;
  const input=createRuntimeInput({getInputContext:()=>({...context}),getSnapshot:()=>({inputOptions:options,game})},{request:callback=>{scheduled.set(++serial,callback);return serial;},cancel:id=>scheduled.delete(id)});
  input.synchronizeSession();messages=[];
  return{input,messages:()=>messages.map(item=>item.message),clear:()=>{messages=[];},change:patch=>Object.assign(context,patch),options:patch=>Object.assign(options,patch),flush:()=>{for(const [id,fn] of scheduled){scheduled.delete(id);fn(0);}},pending:()=>scheduled.size};
 }
 const key=(type,code,key,keyCode,extra={})=>({type,code,key,keyCode,...extra});
 await test('canonical keyboard ownership releases original modifier side and suppresses stale repeat',()=>{
  const f=fixture();assert.equal(f.input.forwardKeyboard(key('keydown','ShiftRight','Shift',16),false),true);
  assert.equal(f.input.forwardKeyboard(key('keyup','','Shift',16,{location:2}),true),true);
  assert.equal(f.messages()[1].code,'ShiftRight');assert.equal(f.messages()[1].location,2);
  f.input.forwardKeyboard(key('keydown','KeyZ','z',90),false);f.input.clearKeyboard();f.clear();
  assert.equal(f.input.forwardKeyboard(key('keydown','KeyZ','z',90,{repeat:true}),false),false);
  assert.equal(f.messages().length,0);f.input.forwardKeyboard(key('keydown','KeyZ','z',90),false);assert.equal(f.messages().length,1);
 });
 await test('launcher controls cannot create gameplay key owners',()=>{
  const f=fixture();assert.equal(f.input.forwardKeyboard(key('keydown','KeyZ','z',90),true),false);
  f.input.forwardKeyboard(key('keydown','KeyZ','z',90),false);
  assert.equal(f.input.forwardKeyboard(key('keyup','KeyZ','z',90),true),true);assert.equal(f.messages().at(-1).down,false);
 });
 await test('TH09 holds Z for charging and never also enables auto-fire',()=>{
  const f=fixture('th09');f.input.fireDown(12);f.input.fireDown(13);
  assert.equal(f.messages().length,1);assert.equal(f.messages()[0].code,'KeyZ');assert.equal(f.messages()[0].down,true);
  f.input.action('bomb');assert.equal(f.messages().at(-1).fireEnabled,false);assert.equal(f.messages().at(-1).bombSerial,1);
  f.input.fireUp(13);assert.equal(f.input.getSnapshot().heldFire,true);
  f.input.fireUp(12);assert.equal(f.messages().at(-1).down,false);assert.equal(f.input.getSnapshot().heldFire,false);
 });
 await test('held charge released on blur/cancel and cannot leak into new epoch',()=>{
  const f=fixture('th09');f.input.fireDown(12);f.clear();f.input.clearKeyboard();
  assert.deepEqual(f.messages().map(m=>[m.command,m.down]),[['keyboard',false],['keyboard-clear',undefined]]);
  f.input.fireDown(12);f.clear();f.change({epoch:2});f.input.fireUp(12);assert.equal(f.messages().length,0);
  f.input.synchronizeSession();assert.equal(f.input.getSnapshot().heldFire,false);
 });
 await test('fire toggle and hold/toggle focus respect configured ownership',()=>{
  const f=fixture();f.input.fireDown(1);assert.equal(f.messages().at(-1).fireEnabled,false);
  f.input.focusDown(2);assert.equal(f.messages().at(-1).focusEnabled,true);f.input.focusUp(3);assert.equal(f.input.getSnapshot().focusEnabled,true);
  f.input.focusUp(2);assert.equal(f.input.getSnapshot().focusEnabled,false);
  f.options({touchFocusMode:'toggle-button'});f.input.focusDown(2);f.input.focusUp(2);assert.equal(f.input.getSnapshot().focusEnabled,true);
  f.options({touchFocusMode:'two-finger'});f.clear();assert.equal(f.input.focusDown(2),false);assert.equal(f.messages().length,0);
 });
 await test('direct touch forwards multi-contact normalized coordinates unchanged for Runtime gestures',()=>{
  const f=fixture('th06',{touchFocusMode:'two-finger',doubleTapBombEnabled:true,touchMovementMode:'touch-unlimited'});
  const first=directTouchPoint({left:30,top:20,width:640,height:480},{clientX:350,clientY:140});assert.deepEqual(first,{x:.5,y:.25});
  f.input.directDown(1,first);f.input.directDown(2,{x:.6,y:.7});f.input.directMove(1,{x:1.2,y:-.3});f.input.directUp(1);
  assert.deepEqual(f.messages().map(m=>m.type),['down','down','move','up']);assert.equal(f.messages()[0].id,-1000000);assert.equal(f.messages()[1].id,-1000001);
  assert.equal(f.messages()[2].x,1.2);assert.equal(f.messages()[2].y,-.3);assert.equal(f.messages()[3].id,f.messages()[0].id);
  assert.equal(f.messages().some(m=>m.command==='touch-controls'),false,'Runtime owns double-tap and two-finger semantics');
  f.input.cancelTransient();assert.equal(f.input.hasDirectTouches(),false);assert.equal(f.messages().at(-2).command,'touch-cancel');
 });
 await test('joystick modes share the canonical axes, one RAF and zero after cancellation',()=>{
  const f=fixture('th07',{touchMovementMode:'joystick-free'});const rect={left:0,top:0,width:100,height:100};
  assert.equal(f.input.directDown(1,{x:.5,y:.5}),false);f.input.joystickDown(2,{clientX:84,clientY:50},rect);
  f.input.joystickMove(2,{clientX:50,clientY:16},rect);assert.equal(f.pending(),1);f.flush();assert.equal(f.messages().at(-1).joystickY,-32767);
  f.input.joystickMove(2,{clientX:50,clientY:84},rect);f.input.cancelTransient();f.clear();f.flush();assert.equal(f.messages().length,0);
  assert.equal(f.input.getSnapshot().joystickY,0);assert.equal(f.pending(),0);
 });
 await test('all spectator input including cancellation and pulse keys is read-only',async()=>{
  const f=fixture('th09',{restartButtonEnabled:true,thpracEnabled:true,thpracTouchControlsEnabled:true,touchMovementMode:'joystick'});
  f.change({spectator:true});f.input.synchronizeSession();f.clear();
  f.input.forwardKeyboard(key('keydown','KeyZ','z',90),false);f.input.fireDown(1);f.input.focusDown(2);f.input.action('bomb');f.input.action('escape');f.input.action('restart');f.input.action('F1');
  f.input.directDown(1,{x:.2,y:.3});f.input.joystickDown(1,{clientX:84,clientY:50},{left:0,top:0,width:100,height:100});
  f.input.cancelTransient();f.input.clearKeyboard();f.input.setSuspended(true);f.input.setSuspended(false);f.flush();await new Promise(r=>setTimeout(r,85));assert.deepEqual(f.messages(),[]);
 });
 await test('overlay suspension releases owners and stops auto-fire while preserving intentional toggle',()=>{
  const f=fixture();f.input.forwardKeyboard(key('keydown','ArrowLeft','ArrowLeft',37),false);f.input.focusDown(2);f.input.setSuspended(true);
  assert.equal(f.messages().at(-1).fireEnabled,false);assert.equal(f.messages().at(-1).focusEnabled,false);f.clear();
  f.input.action('bomb');f.input.fireDown(3);f.input.directDown(4,{x:.5,y:.5});assert.equal(f.messages().length,0);
  f.input.setSuspended(false);assert.equal(f.messages().at(-1).fireEnabled,true);
 });
 await test('pulse releases are epoch-bound and retired on replacement',async()=>{
  const f=fixture('th06',{restartButtonEnabled:true});f.input.action('restart');assert.equal(f.messages()[0].down,true);
  f.change({epoch:2});f.input.synchronizeSession();f.clear();await new Promise(r=>setTimeout(r,85));assert.deepEqual(f.messages(),[]);
 });
 await test('transient cancellation releases pending pulse keys before cancelling their timers',async()=>{
  const f=fixture('th06',{restartButtonEnabled:true});f.input.action('restart');f.input.cancelTransient();
  assert.deepEqual(f.messages().filter(m=>m.command==='keyboard').map(m=>m.down),[true,false]);f.clear();await new Promise(r=>setTimeout(r,85));assert.equal(f.messages().length,0);
 });
 await test('touch protocol sends no presentation-only state fields',()=>{
  const f=fixture();f.input.action('escape');assert.deepEqual(Object.keys(f.messages()[0]).sort(),['bombSerial','command','epoch','escapeSerial','fireEnabled','focusEnabled','game','joystickX','joystickY','protocol','touchSensitivity'].sort());
 });
 await test('joystick geometry exactly matches former launcher mapping across edge and random points',async()=>{
  const old=await readFile(resolve(root,'src/launcher/app.mts'),'utf8');
  const implementation=old.slice(old.indexOf('function updateTouchJoystick(event: PointerEvent) {'),old.indexOf('touchJoystick.addEventListener("pointerdown"')).replace('event: PointerEvent','event');
  let seed=37;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  for(let i=0;i<300;i++){
   const rect={left:random()*100,top:random()*100,width:44+random()*180,height:44+random()*180};const point={clientX:random()*500-100,clientY:random()*500-100};const controls={};const knob={style:{}};
   const execute=new Function('touchJoystick','touchJoystickKnob','touchJoystickPointerId','touchControls','queueTouchControlsSync',`${implementation};return updateTouchJoystick;`)({getBoundingClientRect:()=>rect},knob,1,controls,()=>{});
   execute({pointerId:1,...point});const next=joystickPoint(rect,point);assert.equal(next.joystickX,controls.joystickX);assert.equal(next.joystickY,controls.joystickY);
   assert.equal(knob.style.transform,`translate(calc(-50% + ${next.visualX}px),calc(-50% + ${next.visualY}px))`);
  }
  assert.equal(joystickPoint({left:0,top:0,width:100,height:100},{clientX:50,clientY:50}).joystickX,0);
 });
 await test('saved layout placement preserves scale-aware safe edge clamping',()=>{
  assert.deepEqual(layoutPosition({x:0,y:1,scale:1.5},{width:100,height:80},{width:1000,height:500}),{x:.081,y:.868});
  assert.equal(directTouchPoint({left:0,top:0,width:0,height:100},{clientX:0,clientY:0}),null);
 });
 await test('native PointerEvent contact binding owns each pointer once and release/cancel cannot duplicate',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  const windowTarget=new EventTarget(),documentTarget=new EventTarget();documentTarget.hasFocus=()=>true;
  globalThis.window=windowTarget;globalThis.document=documentTarget;
  try {
   const element=new EventTarget();element.setPointerCapture=()=>{};const calls=[];
   const cleanup=bindInputContact(element,{down:c=>{calls.push(['down',c.id]);return true;},move:c=>calls.push(['move',c.id]),up:c=>calls.push(['up',c.id]),accessible:true},false);
   const send=(type,fields)=>{const event=Object.assign(new Event(type,{cancelable:true}),fields);element.dispatchEvent(event);return event;};
   assert.equal(send('pointerdown',{pointerId:7,pointerType:'touch',clientX:1,clientY:2}).defaultPrevented,true);
   send('pointerdown',{pointerId:7,pointerType:'touch',clientX:1,clientY:2});send('pointermove',{pointerId:7,clientX:3,clientY:4});send('pointercancel',{pointerId:7,clientX:3,clientY:4});send('lostpointercapture',{pointerId:7});
   assert.deepEqual(calls,[['down',7],['move',7],['up',7]]);
   send('keydown',{key:' ',repeat:false});send('keydown',{key:' ',repeat:true});send('keyup',{key:' '});assert.deepEqual(calls.slice(-2),[['down',-1],['up',-1]]);
   send('pointerdown',{pointerId:8,pointerType:'touch',clientX:1,clientY:2});windowTarget.dispatchEvent(new Event('pagehide'));assert.deepEqual(calls.at(-1),['up',8]);
   send('pointerdown',{pointerId:8,pointerType:'touch',clientX:1,clientY:2});assert.deepEqual(calls.at(-1),['down',8],'new gesture can reuse retired pointer identity');cleanup();
  } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
 });
 await test('iOS native touch family preserves simultaneous contacts and ignores compatibility pointers',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hasFocus:()=>true});
  try {
   const element=new EventTarget();const calls=[];const cleanup=bindInputContact(element,{down:c=>calls.push(['down',c.id]),move:c=>calls.push(['move',c.id]),up:c=>calls.push(['up',c.id])},true);
   const event=(type,ids)=>element.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{changedTouches:ids.map(identifier=>({identifier,clientX:10,clientY:20}))}));
   event('touchstart',[11,12]);element.dispatchEvent(Object.assign(new Event('pointerdown'),{pointerId:11,pointerType:'touch'}));event('touchmove',[12]);event('touchend',[11]);event('touchcancel',[12]);
   assert.deepEqual(calls,[['down',11],['down',12],['move',12],['up',11],['up',12]]);cleanup();
  } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
 });
 console.log(`${passed} input behavior tests passed`);
} finally {await rm(temp,{recursive:true,force:true});}
