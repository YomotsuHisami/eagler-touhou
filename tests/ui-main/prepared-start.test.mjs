import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const result=await build({entryPoints:['app/runtime/prepared-start.ts'],bundle:true,format:'esm',platform:'browser',write:false});
const dir=await mkdtemp(join(tmpdir(),'prepared-runtime-start-'));after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'start.mjs');await writeFile(path,result.outputFiles[0].text);
const {startPreparedRuntime,preparedRuntimeNeedsMidi}=await import(pathToFileURL(path).href);
function setup(){let state={phase:'prepared',epoch:2,fileOperationBusy:false},launches=0,resumes=0,ready=true,loads=0;const context={epoch:2,game:'th06',music:'midi'};
 const runtime={getSnapshot:()=>state,getMidiEventContext:()=>context,launch:async()=>{launches++;return {...state,phase:'running'};}};
 const midi={getSnapshot:()=>({ready,activeEpoch:1}),ensureReady:async()=>{loads++;ready=true;},resumeForGesture:async()=>{resumes++;}};
 return {runtime,midi,context,get launches(){return launches;},get resumes(){return resumes;},get loads(){return loads;},set(value){state={...state,...value};},setReady(value){ready=value;}};}
test('new restart epoch requires MIDI from exact plan despite stale audio activeEpoch snapshot',async()=>{const f=setup();assert.equal(preparedRuntimeNeedsMidi(f.runtime,2),true);assert.equal(await startPreparedRuntime({...f,epoch:2}),'started');assert.equal(f.resumes,1);assert.equal(f.launches,1);});
test('uninitialized bridge blocks Start; synth loading never automatically launches',async()=>{const f=setup();await assert.rejects(startPreparedRuntime({runtime:f.runtime,midi:null,epoch:2}),/MIDI bridge/);assert.equal(f.launches,0);f.setReady(false);assert.equal(await startPreparedRuntime({...f,epoch:2}),'audio-prepared');assert.equal(f.loads,1);assert.equal(f.resumes,0);assert.equal(f.launches,0);});
test('late resume cannot start replacement epoch, file operation or cancelled click',async()=>{for(const replace of [f=>f.set({epoch:3}),f=>f.set({fileOperationBusy:true}),f=>f.set({phase:'saving'})]){const f=setup();let resolve;f.midi.resumeForGesture=()=>new Promise(yes=>resolve=yes);const task=startPreparedRuntime({...f,epoch:2});replace(f);resolve();assert.equal(await task,'superseded');assert.equal(f.launches,0);}const f=setup();let current=true;f.midi.resumeForGesture=async()=>{current=false;};await startPreparedRuntime({...f,epoch:2,currentIntent:()=>current});assert.equal(f.launches,0);});
test('audio resume is requested synchronously inside the gesture and denial cannot launch',async()=>{const f=setup();let resolve;f.midi.resumeForGesture=()=>{f.called=true;return new Promise(yes=>resolve=yes);};const pending=startPreparedRuntime({...f,epoch:2});assert.equal(f.called,true);assert.equal(f.launches,0);resolve();await pending;assert.equal(f.launches,1);const denied=setup();denied.midi.resumeForGesture=async()=>{throw new Error('denied');};await assert.rejects(startPreparedRuntime({...denied,epoch:2}),/denied/);assert.equal(denied.launches,0);});
test('no-music and non-MIDI products do not wait for a synthesizer',async()=>{for(const patch of [{music:'none'},{game:'th11',music:'ogg'}]){const f=setup();Object.assign(f.context,patch);assert.equal(await startPreparedRuntime({runtime:f.runtime,midi:null,epoch:2}),'started');assert.equal(f.launches,1);}});

test('generic explicit Start never bypasses multiplayer room authority',async()=>{const f=setup();f.set({runtimeVariant:'multiplayer'});assert.equal(await startPreparedRuntime({...f,epoch:2}),'superseded');assert.equal(f.resumes,0);assert.equal(f.launches,0);});

test('a save failure before or during MIDI activation cannot be bypassed by Start', async () => {
  for (const during of [false, true]) {
    const f = setup();
    if (during) f.midi.resumeForGesture = async () => f.set({saveError: 'Persist failed'});
    else f.set({saveError: 'Persist failed'});
    assert.equal(await startPreparedRuntime({...f, epoch: 2}), 'superseded'); assert.equal(f.launches, 0);
  }
});
