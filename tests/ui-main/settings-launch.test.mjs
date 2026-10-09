import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importUiModule} from '../support/import-ui-module.mjs';
const {createSettingsLaunchController} = await importUiModule('app/services/settings-launch.client.ts');
const {createLaunchWarningGate} = await importUiModule('app/services/launch-warnings.ts');
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const drain = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
const selection = (music='ogg-stream') => ({productId:'th06', preferences:{productId:'th06', options:{touchEnabled:true}, music}, touchLayout:null});
function fixture({music='ogg', hold=null, existing=false, close=true, midi=null}={}) {
  let live={game:existing?'th06':null,epoch:existing?1:null,phase:existing?'prepared':'idle',runtimeVariant:'normal',launched:false,ready:existing,music,fileOperationBusy:false,saveError:null};
  let owned=null, selected=true;
  const events=[], warnings=createLaunchWarningGate();
  const runtime={getSnapshot:()=>live, getLauncherControlContext:()=>({epoch:live.epoch,game:live.game,runtimeVariant:'normal',options:{touchEnabled:true}}),
    getMidiEventContext:()=>music==='midi'?{epoch:live.epoch,game:'th06',music:'midi'}:null,
    async close(){events.push('close');if(close)live={...live,phase:'exited',epoch:null,ready:false};return close;},
    async launch(){events.push('launch');live={...live,phase:'running',launched:true};return live;}};
  const job={getSnapshot:()=>({selection:owned}), cancel(){events.push('cancel');live={...live,epoch:null,phase:'idle',ready:false};},
    prepare(productId,preferences){owned={productId,preferences};events.push('prepare');return (async()=>{if(hold)await hold.promise;live={...live,game:productId,epoch:2,phase:'prepared',ready:true};return live;})();}};
  const controller=createSettingsLaunchController({job,runtime,midi,warnings,device:()=>({maxTouchPoints:0,anyFinePointer:true,userAgent:'Desktop'}),current:()=>selected});
  return {controller,warnings,events,runtime,job,replace(){selected=false;controller.recheck();},setLive(value){live={...live,...value};}};
}
test('one ordinary Start prepares and launches without a second UI action',async()=>{
  const f=fixture();assert.equal(await f.controller.launch(selection()),true);assert.deepEqual(f.events,['prepare','launch']);assert.equal(f.controller.getSnapshot().phase,'idle');
});

test('ordinary Start offers replacement DATA only for a DATA acquisition failure',async()=>{
  for(const [error,recover] of [
    [Object.assign(Error('DATA missing'),{code:'game-data-acquisition'}),true],
    [Object.assign(Error('Runtime missing'),{code:'runtime-unavailable'}),false],
    [Object.assign(Error('language missing'),{code:'language-unavailable'}),false],
    [Object.assign(Error('audio corrupt'),{code:'integrity-failed',fileId:'ogg-1'}),false],
  ]) {
    const f=fixture();f.job.prepare=async()=>{throw error;};assert.equal(await f.controller.launch(selection()),false);
    assert.equal(f.controller.getSnapshot().dataRecovery,recover);assert.equal(f.controller.getSnapshot().error,error.message);assert.equal(f.events.includes('launch'),false);
  }
});
test('input acknowledgment precedes Player/fullscreen, update choice, resource preparation and launch',async()=>{
  const f=fixture({music:'none'});f.controller.dispose();
  const prepare=f.job.prepare.bind(f.job);f.job.prepare=(...args)=>{f.events.push(`prepare-choice:${args[3]}`);return prepare(...args);};
  const controller=createSettingsLaunchController({job:f.job,runtime:f.runtime,midi:null,warnings:f.warnings,device:()=>({maxTouchPoints:0,anyFinePointer:true,userAgent:'Desktop'}),current:()=>true,
    acquireStart:()=>{f.events.push('open-player');return()=>f.events.push('release-player');},enterPlayer:async()=>{f.events.push('fullscreen');},chooseUpdate:async()=>{f.events.push('choose-update');return 'update-now';}});
  const task=controller.launch(selection('none'));assert.deepEqual(f.events,[]);f.warnings.accept(f.warnings.getSnapshot());assert.equal(await task,true);
  assert.deepEqual(f.events,['open-player','fullscreen','choose-update','prepare-choice:update-now','prepare','launch','release-player']);controller.dispose();
});
test('a late update choice after navigation cannot prepare or launch another product',async()=>{
  const f=fixture(),wait=deferred();f.controller.dispose();let current=true;
  const controller=createSettingsLaunchController({job:f.job,runtime:f.runtime,midi:null,warnings:f.warnings,device:()=>({maxTouchPoints:0,anyFinePointer:true,userAgent:'Desktop'}),current:()=>current,chooseUpdate:()=>wait.promise});
  const task=controller.launch(selection());await drain();current=false;controller.recheck();wait.resolve('update-now');assert.equal(await task,false);assert.deepEqual(f.events,[]);controller.dispose();
});
test('canceling the original none-MIDI acknowledgment does not prepare or start',async()=>{
  const f=fixture({music:'none'}), pending=f.controller.launch(selection('none'));
  assert.equal(f.warnings.getSnapshot().warning,'music.noneLaunchWarning');f.warnings.dismiss(f.warnings.getSnapshot());
  assert.equal(await pending,false);assert.deepEqual(f.events,[]);
});
test('main optional music fallback continues the same Start without a second input confirmation',async()=>{
  const f=fixture({music:'none'});assert.equal(await f.controller.launch(selection()),true);
  assert.equal(f.warnings.getSnapshot(),null);assert.deepEqual(f.events,['prepare','launch']);
});
test('a replaced route cannot start a late prepared Runtime',async()=>{
  const hold=deferred(), f=fixture({hold});const pending=f.controller.launch(selection());await drain();f.replace();hold.resolve();
  assert.equal(await pending,false);assert.equal(f.events.includes('launch'),false);assert.equal(f.events.includes('cancel'),true);
});
test('repeat clicks share one Start request while preparation is pending',async()=>{
  const hold=deferred(),f=fixture({hold});const first=f.controller.launch(selection()),second=f.controller.launch(selection());
  assert.equal(first,second);hold.resolve();assert.equal(await first,true);assert.deepEqual(f.events,['prepare','launch']);
});
test('a failed save/close never replaces the existing prepared session',async()=>{
  const f=fixture({existing:true,close:false});assert.equal(await f.controller.launch(selection()),false);
  assert.deepEqual(f.events,['close']);assert.equal(f.runtime.getSnapshot().epoch,1);assert.match(f.controller.getSnapshot().error,/saved and closed/);
});
test('an epoch replaced after preparation is not launched',async()=>{
  const f=fixture(),prepare=f.job.prepare.bind(f.job);f.job.prepare=async(...args)=>{const ready=await prepare(...args);f.setLive({epoch:9});return ready;};const pending=f.controller.launch(selection());
  assert.equal(await pending,false);assert.deepEqual(f.events,['prepare']);
});

test('DATA import resumes once without repeating input/fullscreen and rejects a forged continuation',async()=>{
  const f=fixture({music:'none'});f.controller.dispose();let attempts=0,fullscreens=0;
  const prepare=f.job.prepare.bind(f.job);f.job.prepare=(...args)=>++attempts===1?Promise.reject(Object.assign(Error('DATA missing'),{code:'game-data-acquisition'})):prepare(...args);
  const controller=createSettingsLaunchController({job:f.job,runtime:f.runtime,midi:null,warnings:f.warnings,device:()=>({maxTouchPoints:0,anyFinePointer:true,userAgent:'Desktop'}),current:()=>true,enterPlayer:()=>{fullscreens++;}});
  const input={...selection('none'),contextKey:'original-page'};
  const first=controller.launch(input);f.warnings.accept(f.warnings.getSnapshot());assert.equal(await first,false);assert.equal(fullscreens,1);
  assert.equal(await controller.resume(input),true);assert.equal(f.warnings.getSnapshot(),null);assert.equal(fullscreens,1);assert.equal(await controller.resume(input),false);assert.deepEqual(f.events,['prepare','launch']);controller.dispose();
});

test('first import-only Start resumes directly, but dismissal/settings/scope changes cannot use that continuation',async()=>{
  for(const replacement of [null,{contextKey:'other-page'},{preferences:selection('midi').preferences},'cancel']) {
    const f=fixture({music:'none'}),input={...selection('none'),contextKey:'original-page'};
    assert.equal(f.controller.deferForImport(input),true);if(replacement==='cancel')f.controller.cancel();
    const resumed=await f.controller.resume(replacement&&typeof replacement==='object'?{...input,...replacement}:input);
    assert.equal(resumed,replacement===null);assert.equal(f.warnings.getSnapshot(),null);assert.deepEqual(f.events,replacement===null?['prepare','launch']:[]);f.controller.dispose();
  }
});

test('user download cancellation offers local import, while route cancellation never authorizes continuation',async()=>{
 for(const userCancel of [true,false]) {
  const hold=deferred(),f=fixture();let busy=false,reject;
  const prepare=f.job.prepare.bind(f.job);f.job.prepare=(...args)=>{prepare(...args);busy=true;return new Promise((_,fail)=>{reject=fail;});};
  const snapshot=f.job.getSnapshot;f.job.getSnapshot=()=>({...snapshot(),preparing:busy});const cancel=f.job.cancel;f.job.cancel=()=>{busy=false;cancel();reject?.(new DOMException('Cancelled','AbortError'));};
  const input=selection();const task=f.controller.launch(input);await drain();
  if(userCancel)assert.equal(f.controller.cancelDownload(),true);else f.replace();
  assert.equal(await task,false);assert.equal(f.controller.getSnapshot().dataRecovery,userCancel);assert.equal(f.events.includes('launch'),false);
  f.job.prepare=prepare;if(userCancel)assert.equal(await f.controller.resume(input),true);else assert.equal(await f.controller.resume(input),false);f.controller.dispose();
 }
});
