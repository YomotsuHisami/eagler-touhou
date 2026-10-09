/** Injected API/service evidence only. No browser, Runtime, relay, or phone performance is exercised. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-player-tools-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: `export * from './app/services/player-tools.client.ts';export * from './app/services/player-tools-diagnostics.ts';export {HostedKeyboard} from './src/launcher/hosted-keyboard.mts';`, resolveDir: root, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
    if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
  });}}]});
const file = join(directory, 'player-tools.mjs');await writeFile(file, bundle.outputFiles[0].text);
const {HostedKeyboard, createPlayerFullscreenKeySequence, bindPlayerFullscreenShortcut, createPlayerDiagnosticsPreference, createPlayerSchedulingSampler, PLAYER_DIAGNOSTICS_STORAGE_KEY, canRestorePlayerHelpFocus, createPlayerFullscreenController, createPlayerEscapeController, createPlayerInputHelpGate, createPlayerDiagnosticReport,
  readPlayerNativeDiagnostics, playerDiagnosticReportText, createPlayerReportTransfer, PLAYER_KEYBOARD_LOCK_CODES} = await import(pathToFileURL(file).href);
const deferred = () => {let resolve, reject;const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};};
const tick = async () => {for (let i=0;i<8;i++) await Promise.resolve();};
function clock() {let serial=0;const jobs=new Map();return {schedule(fn){jobs.set(++serial,fn);return serial;}, cancel(id){jobs.delete(id);}, next(){const [id,fn]=jobs.entries().next().value ?? [];if(fn){jobs.delete(id);fn();}}, size:()=>jobs.size};}
function fullscreen({webkit=false, keyboard=true} = {}) {
  const events=new EventTarget(), timers=clock(), calls={request:0,exit:0,lock:0,unlock:0,focus:0,gesture:0};
  let request=async()=>{doc.fullscreenElement=target;events.dispatchEvent(new Event(webkit?'webkitfullscreenchange':'fullscreenchange'));};
  let lock=async()=>{};
  const target={[webkit?'webkitRequestFullscreen':'requestFullscreen'](){calls.request++;return request();}};
  const doc={fullscreenElement:null,documentElement:{}, addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),
    exitFullscreen:async()=>{calls.exit++;doc.fullscreenElement=null;events.dispatchEvent(new Event('fullscreenchange'));}};
  const controller=createPlayerFullscreenController({document:doc,target:()=>target,
    keyboard:keyboard?{lock(codes){assert.deepEqual(codes,PLAYER_KEYBOARD_LOCK_CODES);calls.lock++;return lock();},unlock(){calls.unlock++;}}:undefined,
    focus(){calls.focus++;},cancelGesture(){calls.gesture++;},schedule:timers.schedule,cancel:timers.cancel});
  controller.setSession(1,true);
  return {controller,doc,target,calls,timers,events,setRequest(fn){request=fn;},setLock(fn){lock=fn;}};
}
test('fullscreen requests synchronously from gesture, verifies state, locks keys and exits owned root', async()=>{
  const f=fullscreen(), operation=f.controller.toggle();assert.equal(f.calls.request,1);assert.equal(await operation,true);
  assert.equal(f.controller.getSnapshot().fullscreen,true);assert.equal(f.controller.getSnapshot().keyboard,'locked');assert.equal(f.calls.focus,1);
  assert.equal(await f.controller.toggle(),true);assert.equal(f.calls.exit,1);assert.equal(f.controller.getSnapshot().keyboard,'off');f.controller.dispose();
});
test('rejected fullscreen preserves failure and explicit retry succeeds without duplicate requests',async()=>{
  const f=fullscreen(), pending=deferred();f.setRequest(()=>pending.promise);const first=f.controller.toggle();
  assert.equal(await f.controller.toggle(),false);assert.equal(f.calls.request,1);pending.reject(new Error('NotAllowedError'));assert.equal(await first,false);
  assert.equal(f.controller.getSnapshot().reason,'NotAllowedError');assert.equal(f.controller.getSnapshot().fullscreen,false);
  f.setRequest(async()=>{f.doc.fullscreenElement=f.target;f.events.dispatchEvent(new Event('fullscreenchange'));});assert.equal(await f.controller.toggle(),true);f.controller.dispose();
});
test('promise resolution is not proof of fullscreen and prefixed events are supported',async()=>{
  const f=fullscreen({webkit:true});f.setRequest(()=>undefined);const pending=f.controller.toggle();await tick();
  assert.equal(f.controller.getSnapshot().busy,true);f.timers.next();assert.equal(await pending,false);assert.equal(f.controller.getSnapshot().failure,'unconfirmed');
  const retry=f.controller.toggle();await tick();f.doc.fullscreenElement=f.target;f.events.dispatchEvent(new Event('webkitfullscreenchange'));assert.equal(await retry,true);f.controller.dispose();
});
test('foreign fullscreen is never exited and unsupported API is never called success',async()=>{
  const f=fullscreen();f.doc.fullscreenElement={foreign:true};assert.equal(await f.controller.toggle(),false);assert.equal(f.controller.getSnapshot().failure,'foreign');assert.equal(f.calls.exit,0);f.controller.dispose();assert.equal(f.calls.exit,0);
  const g=fullscreen();delete g.target.requestFullscreen;assert.equal(await g.controller.toggle(),false);assert.equal(g.controller.getSnapshot().failure,'unsupported');g.controller.dispose();
});
test('native Escape/fullscreen change unlocks optional keyboard without inventing fullscreen success',async()=>{
  const f=fullscreen({keyboard:false});await f.controller.toggle();assert.equal(f.controller.getSnapshot().keyboard,'unavailable');
  f.doc.fullscreenElement=null;f.events.dispatchEvent(new Event('fullscreenchange'));assert.equal(f.controller.getSnapshot().fullscreen,false);assert.equal(f.controller.getSnapshot().keyboard,'off');f.controller.dispose();
});
test('keyboard denial is an honest progressive-enhancement failure and does not invalidate fullscreen',async()=>{
  const f=fullscreen();f.setLock(()=>Promise.reject(new Error('Permission denied')));assert.equal(await f.controller.toggle(),true);await tick();
  assert.equal(f.controller.getSnapshot().fullscreen,true);assert.equal(f.controller.getSnapshot().keyboard,'failed');assert.equal(f.controller.getSnapshot().keyboardReason,'Permission denied');f.controller.dispose();
});
test('retired epoch ignores a late grant, exits only owned target and never focuses replacement',async()=>{
  const f=fullscreen(), pending=deferred();f.setRequest(()=>pending.promise);const result=f.controller.toggle();f.controller.setSession(2,false);
  f.doc.fullscreenElement=f.target;pending.resolve();assert.equal(await result,false);assert.equal(f.calls.focus,0);assert.equal(f.calls.exit,1);f.controller.dispose();
});
test('first session publication does not retire a fullscreen request already owned by the player surface', async () => {
  const f = fullscreen();
  f.controller.setSession(null, true);
  const pending = deferred();
  f.setRequest(() => pending.promise);
  const operation = f.controller.toggle();
  f.controller.setSession(1, true);
  f.doc.fullscreenElement = f.target;
  f.events.dispatchEvent(new Event('fullscreenchange'));
  pending.resolve();
  assert.equal(await operation, true);
  assert.equal(f.calls.exit, 0);
  assert.equal(f.controller.getSnapshot().fullscreen, true);
  f.controller.dispose();
});
test('disposing a pending prefixed request retires timeout and event subscribers',async()=>{
  const f=fullscreen({webkit:true});f.setRequest(()=>undefined);let changes=0;f.controller.subscribe(()=>changes++);
  const result=f.controller.toggle();await tick();assert.equal(f.timers.size(),1);f.controller.dispose();assert.equal(await result,false);assert.equal(f.timers.size(),0);
  const old=changes;f.events.dispatchEvent(new Event('fullscreenchange'));assert.equal(changes,old);
});
test('Escape sends native key pulses with sampled UP, never a synthetic pause state',()=>{
  const timer=clock(), target={}, sent=[];let current={target,epoch:1,ready:true,launched:true,spectator:false};
  const owner=createPlayerEscapeController({getInputContext:()=>current,postInput:(command,payload)=>{sent.push([command,payload]);return true;}},timer.schedule,timer.cancel);
  assert.equal(owner.activate(),true);assert.equal(owner.activate(),true);assert.equal(sent.length,1);assert.equal(sent[0][1].code,'Escape');assert.equal(sent[0][1].down,true);
  timer.next();assert.equal(sent[1][1].down,false);timer.next();assert.equal(sent[2][1].down,true);timer.next();assert.equal(sent[3][1].down,false);
  current={...current,epoch:2};owner.dispose();assert.equal(sent.length,4);assert.equal(timer.size(),0);
});
test('Escape blocks spectators and stale release never reaches another Runtime document',()=>{
  const timer=clock(), sent=[];let current={target:{},epoch:1,ready:true,launched:true,spectator:true};
  const owner=createPlayerEscapeController({getInputContext:()=>current,postInput:(...args)=>{sent.push(args);return true;}},timer.schedule,timer.cancel);
  assert.equal(owner.activate(),false);current={...current,spectator:false};assert.equal(owner.activate(),true);current={...current,target:{}};timer.next();assert.equal(sent.length,1);owner.dispose();
});
test('first touch help follows existing seen key, blocks spectators and survives unavailable storage in document session',()=>{
  const writes=[], storage={getItem:()=>null,setItem:(...args)=>writes.push(args)}, gate=createPlayerInputHelpGate(storage);
  assert.equal(gate.shouldOpen({launched:true,spectator:true,touchEnabled:true}),false);assert.equal(gate.shouldOpen({launched:true,spectator:false,touchEnabled:true}),true);
  assert.deepEqual(writes,[['eagler-touch-help-seen-v8','1']]);assert.equal(gate.shouldOpen({launched:true,spectator:false,touchEnabled:true}),false);
  assert.equal(createPlayerInputHelpGate({getItem:()=> '1',setItem(){throw Error();}}).shouldOpen({launched:true,spectator:false,touchEnabled:true}),false);
  const denied=createPlayerInputHelpGate({getItem(){throw Error();},setItem(){throw Error();}});assert.equal(denied.shouldOpen({launched:true,spectator:false,touchEnabled:true}),true);assert.equal(denied.shouldOpen({launched:true,spectator:false,touchEnabled:true}),false);
});
const runtime=()=>({phase:'running',game:'th06',runtimeVariant:'multiplayer',epoch:9,ready:true,launched:true,firstFrame:true,spectator:false,runtimeInfo:{renderer:'ANGLE (vendor, SwiftShader, backend)',architecture:'wasm32',privateToken:'do-not-export'},frameHealth:{fps:59.6,maxGapMs:90},audioHealth:{queuedMs:50,minQueuedMs:3,backend:'worklet',underruns:2,robust:true},netplayTiming:null});
const network=()=>({count:1,loaded:20,total:100,active:[{url:'wss://private/?token=secret',label:'private member',kind:'data',phase:'download',loaded:20,total:100}]});
test('diagnostics exports only measured allowlisted fields and no relay URL/tokens or invented host FPS',()=>{
  const native=readPlayerNativeDiagnostics({Module:{eaglerOptions:{netplayMode:'lan'}},__eaglerNetplayTransport:'rtc',__eaglerNetplayPath:'direct',__eaglerNetplayLanActive:true,__eaglerNetplayLanFrame:120,__eaglerNetplayRtcPaths:[{peer:1,path:'direct',protocol:'udp',family:'IPv6',address:'secret-ip'}]},true);
  const report=createPlayerDiagnosticReport({runtime:runtime(),network:network(),native,capturedAt:'now',browser:{userAgent:'Mozilla Chrome/131.0'}}), json=playerDiagnosticReportText(report);
  assert.equal(report.health,'bad');assert.equal(report.renderer.compact,'SwiftShader');assert.equal(report.frame.fps,59.6);assert.equal(report.network.native.frame,120);assert.equal(report.network.timing,null);
  assert(!/secret|private|token/.test(json));assert.deepEqual(report.browserScheduling,{hostRafHz:null,childRafHz:null});assert.equal(report.audio.minQueuedMs,3);
});
test('missing or invalid telemetry stays null, normal session has no multiplayer diagnostics, getter denial is safe',()=>{
  const report=createPlayerDiagnosticReport({runtime:{...runtime(),runtimeVariant:'normal',runtimeInfo:{},frameHealth:{fps:NaN,maxGapMs:Infinity},audioHealth:null},network:{count:0,loaded:0,total:0,active:[]},native:{frame:200}});
  assert.equal(report.frame.fps,null);assert.equal(report.frame.maxGapMs,null);assert.equal(report.network.native,null);assert.equal(report.audio.underruns,null);
  assert.equal(readPlayerNativeDiagnostics({get Module(){throw Error('denied');}},true),null);assert.equal(readPlayerNativeDiagnostics({},false),null);
});
test('copy is single-flight, closes/reopens without stale completion and download URLs retire on replacement',async()=>{
  const pending=deferred(), revoked=[];let urls=0,copies=0;
  const transfer=createPlayerReportTransfer({copy:()=>{copies++;return pending.promise;},createUrl:()=>`blob:${++urls}`,revokeUrl:url=>revoked.push(url)});
  transfer.setReport('session1');const operation=transfer.copy('original');assert.equal(await transfer.copy('duplicate'),false);assert.equal(copies,1);
  assert.equal(transfer.download('{}'),'blob:1');assert.equal(transfer.download('{}'),'blob:2');assert.deepEqual(revoked,['blob:1']);
  transfer.setReport(null);transfer.setReport('session2');pending.resolve();assert.equal(await operation,false);assert.equal(transfer.getSnapshot().status,'idle');assert.deepEqual(revoked,['blob:1','blob:2']);
  transfer.download('{}');transfer.dispose();assert.deepEqual(revoked,['blob:1','blob:2','blob:3']);assert.equal(await transfer.copy('{}'),false);
});
test('clipboard errors leave the original report available for manual copy and an explicit retry works',async()=>{
  let fail=true;const transfer=createPlayerReportTransfer({copy:async()=>{if(fail)throw Error('Denied');},createUrl:()=>'',revokeUrl(){}});transfer.setReport('report');
  assert.equal(await transfer.copy('{}'),false);assert.deepEqual(transfer.getSnapshot(),{status:'failed',error:'Denied'});fail=false;assert.equal(await transfer.copy('{}'),true);assert.equal(transfer.getSnapshot().status,'copied');transfer.dispose();
});

 test('Help focus requires original history entry and native frame epoch, and never steals newer navigation',()=>{
  const frame={},target={},captured={sourceKey:'origin',frame,target,epoch:5},current={navigationIdle:true,locationKey:'origin',helpOpen:false,frame,frameConnected:true,input:{target,epoch:5,launched:true,ready:true}};
  assert.equal(canRestorePlayerHelpFocus(captured,current),true);
  for(const patch of [{navigationIdle:false},{locationKey:'new-route'},{helpOpen:true},{frame:{}},{frameConnected:false},{input:{...current.input,epoch:6}},{input:{...current.input,target:{}}},{input:{...current.input,launched:false}},{input:null}])assert.equal(canRestorePlayerHelpFocus(captured,{...current,...patch}),false);
  assert.equal(canRestorePlayerHelpFocus(null,current),false);
});

test('late fullscreen grant cannot exit a newer successful request on the same permanent player surface',async()=>{
  const f=fullscreen(), pending=deferred();f.setRequest(()=>pending.promise);const obsolete=f.controller.toggle();f.controller.setSession(2,true);
  f.setRequest(async()=>{f.doc.fullscreenElement=f.target;f.events.dispatchEvent(new Event('fullscreenchange'));});assert.equal(await f.controller.toggle(),true);
  pending.resolve();assert.equal(await obsolete,false);assert.equal(f.calls.exit,0);assert.equal(f.controller.getSnapshot().fullscreen,true);f.controller.dispose();
});

test('debug preference keeps the exact old storage key and tri-state default without inventing a test build',()=>{
  const store=createPlayerDiagnosticsPreference();assert.deepEqual(store.getSnapshot(),{preference:null,persistence:'unknown'});
  let saved='0';const writes=[],storage={getItem:key=>{assert.equal(key,PLAYER_DIAGNOSTICS_STORAGE_KEY);return saved;},setItem:(...args)=>writes.push(args)};
  store.hydrate(storage);assert.equal(store.getSnapshot().preference,false);store.setEnabled(true);assert.deepEqual(writes,[['eagler-touhou-runtime-diagnostics-v1','1']]);assert.equal(store.getSnapshot().preference,true);
  saved='invalid';store.hydrate(storage);assert.equal(store.getSnapshot().preference,null);
  store.hydrate({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});store.setEnabled(false);assert.deepEqual(store.getSnapshot(),{preference:false,persistence:'session'});
});
test('one scheduling owner counts host and child separately, publishes at 500ms and cancels on hidden/stale epoch',()=>{
  let time=0,current=true;const makeRaf=()=>{let id=0;const jobs=new Map(),all=new Map();return {requestAnimationFrame(fn){jobs.set(++id,fn);all.set(id,fn);return id;},cancelAnimationFrame(id){jobs.delete(id);},step(){const batch=[...jobs];jobs.clear();for(const [,fn] of batch)fn(time);},capture:()=>[...jobs.values()][0],count:()=>jobs.size};};
  const host=makeRaf(),child=makeRaf(),owner=createPlayerSchedulingSampler({host,child,current:()=>current,now:()=>time});let notifications=0;owner.subscribe(()=>notifications++);
  owner.start();owner.start();assert.equal(host.count(),1);assert.equal(child.count(),1);
  for(let i=1;i<=9;i++){time=i*50;child.step();if(i%2===0)host.step();}assert.equal(notifications,0);
  time=500;child.step();host.step();assert.equal(notifications,1);assert.equal(owner.getSnapshot().hostRafHz,10);assert.equal(owner.getSnapshot().childRafHz,20);
  const old=host.capture();owner.stop();assert.equal(host.count(),0);assert.equal(child.count(),0);assert.deepEqual(owner.getSnapshot(),{hostRafHz:null,childRafHz:null});
  owner.start();old(time);assert.equal(host.count(),1);assert.equal(child.count(),1);
  current=false;time=550;host.step();assert.equal(host.count(),0);assert.equal(child.count(),0);owner.dispose();
});
test('browser scheduler samples never substitute native presentation FPS in report',()=>{
  const report=createPlayerDiagnosticReport({runtime:runtime(),network:network(),scheduling:{hostRafHz:120,childRafHz:60}});
  assert.deepEqual(report.browserScheduling,{hostRafHz:120,childRafHz:60});assert.equal(report.frame.fps,59.6);
});

test('Escape delivery denial or a replaced native input port never claims input acceptance',()=>{
  const timer=clock(),input={target:{},epoch:1,ready:true,launched:true,spectator:false};
  for(const postInput of [()=>false,()=>{throw Error('lost input port');}]) {
    const owner=createPlayerEscapeController({getInputContext:()=>input,postInput},timer.schedule,timer.cancel);
    assert.equal(owner.activate(),false);assert.equal(timer.size(),0);owner.dispose();
  }
});

function fullscreenKey(type, patch={}) {const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({code:'Enter',key:'Enter',keyCode:13,altKey:true,ctrlKey:false,metaKey:false,repeat:false,...patch}))Object.defineProperty(event,key,{value});return event;}
test('iframe-local Alt+Enter toggles once, suppresses repeats and consumes Enter UP after Alt releases first',()=>{
  const host=new EventTarget(),child=new EventTarget();let toggles=0,native=0;
  const owner=bindPlayerFullscreenShortcut({host,child,current:()=>true,toggle:()=>toggles++});
  child.addEventListener('keydown',()=>native++);child.addEventListener('keyup',()=>native++);
  const down=fullscreenKey('keydown');child.dispatchEvent(down);assert.equal(down.defaultPrevented,true);assert.equal(toggles,1);assert.equal(native,0);
  child.dispatchEvent(fullscreenKey('keydown',{repeat:true}));assert.equal(toggles,1);assert.equal(native,0);
  child.dispatchEvent(fullscreenKey('keyup',{code:'AltLeft',altKey:false}));
  const up=fullscreenKey('keyup',{altKey:false});child.dispatchEvent(up);assert.equal(up.defaultPrevented,true);assert.equal(native,1);
  child.dispatchEvent(fullscreenKey('keydown'));assert.equal(toggles,2);owner.dispose();
});
test('shared parent/child binding ignores already-handled or duplicate events and disposes all listeners',()=>{
  const host=new EventTarget(),child=new EventTarget();let toggles=0;
  const owner=bindPlayerFullscreenShortcut({host,child,current:()=>true,toggle:()=>toggles++});
  const down=fullscreenKey('keydown');host.dispatchEvent(down);child.dispatchEvent(down);assert.equal(toggles,1);
  host.dispatchEvent(fullscreenKey('keyup'));const foreign=fullscreenKey('keydown');foreign.preventDefault();child.dispatchEvent(foreign);assert.equal(toggles,1);
  child.dispatchEvent(fullscreenKey('keyup'));child.dispatchEvent(fullscreenKey('keydown'));assert.equal(toggles,2);
  owner.dispose();host.dispatchEvent(fullscreenKey('keyup'));host.dispatchEvent(fullscreenKey('keydown'));child.dispatchEvent(fullscreenKey('keydown'));assert.equal(toggles,2);
});
test('frame/document/epoch mismatch and modal ownership fence shortcut events before any toggle',()=>{
  const host=new EventTarget(),child=new EventTarget(),frame={},document={},epoch=4;let current={frame,document,epoch,modal:false},toggles=0;
  const owner=bindPlayerFullscreenShortcut({host,child,current:()=>current.frame===frame&&current.document===document&&current.epoch===epoch&&!current.modal,toggle:()=>toggles++});
  for(const patch of [{frame:{}},{document:{}},{epoch:5},{modal:true}]){current={frame,document,epoch,modal:false,...patch};const event=fullscreenKey('keydown');child.dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.equal(toggles,0);}
  current={frame,document,epoch,modal:false};child.dispatchEvent(fullscreenKey('keydown'));assert.equal(toggles,1);child.dispatchEvent(new Event('blur'));child.dispatchEvent(fullscreenKey('keydown',{repeat:true}));assert.equal(toggles,1);
  child.dispatchEvent(fullscreenKey('keyup'));child.dispatchEvent(fullscreenKey('keydown'));assert.equal(toggles,2);owner.dispose();
});
test('parent input guard excludes both fullscreen key edges while ordinary Enter and blur reset retain existing native behavior',()=>{
  const sequence=createPlayerFullscreenKeySequence(),keyboard=new HostedKeyboard(),context={target:{},game:'th06',epoch:1,launched:true,spectator:false};
  const forward=event=>sequence.accept(event).handled?[]:keyboard.forward(event,context,false);
  assert.deepEqual(forward(fullscreenKey('keydown')),[]);
  assert.deepEqual(forward(fullscreenKey('keyup',{code:'AltLeft',altKey:false,key:'Alt',keyCode:18})),[]);
  assert.deepEqual(forward(fullscreenKey('keyup',{altKey:false})),[]);
  assert.equal(forward(fullscreenKey('keydown',{altKey:false})).length,1);assert.equal(forward(fullscreenKey('keyup',{altKey:false})).length,1);
  forward(fullscreenKey('keydown'));sequence.reset();keyboard.clear();
  assert.equal(forward(fullscreenKey('keydown',{altKey:false})).length,1);assert.equal(forward(fullscreenKey('keyup',{altKey:false})).length,1);
  for(const patch of [{ctrlKey:true},{metaKey:true},{isComposing:true}])assert.equal(sequence.accept(fullscreenKey('keydown',patch)).handled,false);
});

test('fullscreen focus transfer from parent to child cannot leak an orphan Enter UP after blur',()=>{
  const host=new EventTarget(),child=new EventTarget();let toggles=0,native=0;
  const owner=bindPlayerFullscreenShortcut({host,child,current:()=>true,toggle:()=>toggles++});child.addEventListener('keyup',event=>{if(event.code==='Enter')native++;});
  host.dispatchEvent(fullscreenKey('keydown'));host.dispatchEvent(new Event('blur'));
  child.dispatchEvent(fullscreenKey('keyup',{code:'AltLeft',altKey:false}));const release=fullscreenKey('keyup',{altKey:false});child.dispatchEvent(release);
  assert.equal(release.defaultPrevented,true);assert.equal(native,0);assert.equal(toggles,1);
  child.dispatchEvent(fullscreenKey('keydown',{altKey:false}));child.dispatchEvent(fullscreenKey('keyup',{altKey:false}));assert.equal(native,1);owner.dispose();
});
