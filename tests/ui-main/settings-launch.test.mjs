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
test('canceling the original none-MIDI acknowledgment does not prepare or start',async()=>{
  const f=fixture({music:'none'}), pending=f.controller.launch(selection('none'));
  assert.equal(f.warnings.getSnapshot().warning,'music.noneLaunchWarning');f.warnings.dismiss(f.warnings.getSnapshot());
  assert.equal(await pending,false);assert.deepEqual(f.events,[]);
});
test('a real acquisition fallback gets its missing warning before the same Start launches',async()=>{
  const f=fixture({music:'none'}),pending=f.controller.launch(selection());await drain();
  assert.equal(f.warnings.getSnapshot().warning,'music.noneLaunchWarning');assert.deepEqual(f.events,['prepare']);
  f.warnings.accept(f.warnings.getSnapshot());assert.equal(await pending,true);assert.deepEqual(f.events,['prepare','launch']);
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
test('an epoch replaced during the effective warning is not launched',async()=>{
  const f=fixture({music:'none'}),pending=f.controller.launch(selection());await drain();f.setLive({epoch:9});f.warnings.recheck();
  assert.equal(await pending,false);assert.deepEqual(f.events,['prepare']);
});
