/** Root-lifetime job/epoch tests with injected ports, not game/browser evidence. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({ entryPoints: [join(root, 'app/services/midi.client.ts')], bundle: true,
  format: 'esm', platform: 'browser', write: false, plugins: [{ name: 'authored-browser-contracts', setup(builder) {
    builder.onResolve({ filter: /\.mjs$/ }, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path);
      const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
      if (facade) return { path: resolve(root, `src/contracts/${facade}.mts`) };
      const authored = path.replace(/\.mjs$/, '.mts');
      if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return { path: authored };
    });
  } }] });
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const directory = await mkdtemp(join(tmpdir(), 'ui-midi-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'midi.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { createMidiController } = await import(pathToFileURL(modulePath).href);

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function drain(){for(let n=0;n<12;n++)await Promise.resolve();}
class MidiTarget extends EventTarget {
 history=[]; listeners=new Map();
 addEventListener(type,fn){super.addEventListener(type,fn);this.history.push({type,fn});const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
 removeEventListener(type,fn){super.removeEventListener(type,fn);this.listeners.get(type)?.delete(fn);}
 packet(bytes){const event=new CustomEvent('touhou-midi',{detail:{bytes}});this.dispatchEvent(event);return event;}
 count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function fakeExternalMidi({outputs=1, permission, sendFailure=false}={}){
 const state={supported:true,granted:false,sysexEnabled:false,selected:'',sent:[],panics:0,releases:0,opens:0};
 return {state,get supported(){return state.supported;},get granted(){return state.granted;},get sysexEnabled(){return state.sysexEnabled;},
  outputCount(){return outputs;},outputInfo(){return Array.from({length:outputs},(_,index)=>({id:`out-${index+1}`,name:`Output ${index+1}`}));},
  selectedId(){return state.selected;},effectiveOutputId(){return outputs?(state.selected||'out-1'):'';},setSelectedId(id){state.selected=id;},
  ensureAccess(){return permission?permission.then(()=>{state.granted=true;state.sysexEnabled=true;}):(state.granted=true,state.sysexEnabled=true,Promise.resolve());},
  async openOutputs(){state.opens++;return outputs;},send(bytes){if(sendFailure)return 0;state.sent.push([...bytes]);return outputs?1:0;},panic(){state.panics++;},release(){state.releases++;state.granted=false;state.sysexEnabled=false;}};
}
function fixture(t,{load,game='th06',music='midi',externalMidi}={}){
 const target=new MidiTarget(), subscribers=new Set(), sent=[], resumes=[], suspends=[], resets=[];
 let context={epoch:1,game,document:{},target,music}, live={phase:'prepared',epoch:1,game,ready:true,launched:false};
 let activity={visible:true,focused:true,runtimeFocused:true}, loads=0;
 const audio={state:'suspended',resume(){resumes.push(1);audio.state='running';return Promise.resolve();},suspend(){suspends.push(1);audio.state='suspended';return Promise.resolve();}};
 const synth={send(bytes){sent.push([...bytes]);if(audio.state==='suspended')void audio.resume();},reset(){resets.push(1);},getAudioContext:()=>audio};
 const runtime={getSnapshot:()=>live,getMidiEventContext:()=>context,subscribe(fn){subscribers.add(fn);return ()=>subscribers.delete(fn);}};
 const controller=createMidiController({runtime,loadSynth:async()=>{loads++;return load?load(synth):synth;},getActivity:()=>activity,externalMidi});
 t.after(()=>controller.dispose());
 function set(next={},nextContext){live={...live,...next};if(nextContext!==undefined)context=nextContext;for(const fn of subscribers)fn();}
 return {controller,target,runtime,synth,audio,sent,resumes,suspends,resets,subscribers,get loads(){return loads;},set,
  activity(next){activity={...activity,...next};controller.activityChanged();},
  async launch(){await controller.ensureReady();const resume=controller.resumeForGesture(context.epoch),opening=controller.prepareExternalMidi(context.epoch);await resume;await opening;set({phase:'running',launched:true});},
  replace({epoch=2,game='th07',document={},music='midi',sameTarget=true}={}){const next={epoch,game,document,music,target:sameTarget?target:new MidiTarget()};set({epoch,game,phase:'prepared',launched:false},next);return next;},
 };
}
test('preparation lazily coalesces synthesizer loading and never starts/resumes a Runtime',async t=>{
 const wait=deferred(),f=fixture(t,{load:synth=>wait.promise.then(()=>synth)});
 const a=f.controller.ensureReady(),b=f.controller.ensureReady();assert.equal(f.loads,1);assert.equal(f.controller.getSnapshot().loading,true);
 wait.resolve();await Promise.all([a,b]);assert.equal(f.controller.getSnapshot().ready,true);assert.equal(f.resumes.length,0);
 assert.equal(f.runtime.getSnapshot().phase,'prepared');assert.equal('launch' in f.controller,false);
});
test('native MIDI is accepted only from the current prepared document after explicit resume/launch',async t=>{
 const f=fixture(t);f.target.packet([0x90,60,100]);assert.equal(f.sent.length,0);await f.launch();
 f.target.packet([0xc0,7,0]);f.target.packet([0x90,60,100]);f.target.packet([0x80,60,0]);f.target.packet([0xf0,0x7e,0x7f,9,1,0xf7]);
 assert.deepEqual(f.sent,[[0xc0,7,0],[0x90,60,100],[0x80,60,0],[0xf0,0x7e,0x7f,9,1,0xf7]]);
 const reset=f.resets.length;f.target.dispatchEvent(new Event('touhou-midi-close'));assert.equal(f.resets.length,reset+1);
});
test('external MIDI requests SysEx from the switch gesture, prepares the chosen output and replaces the synth sink',async t=>{
 const externalMidi=fakeExternalMidi(),f=fixture(t,{externalMidi});
 await f.controller.setExternalMidiEnabled(true);assert.equal(externalMidi.state.granted,true);assert.equal(f.controller.getSnapshot().externalMidiEnabled,true);
 f.controller.setExternalMidiDeviceId('out-1');await f.launch();assert.equal(externalMidi.state.opens,1);
 f.target.packet([0xc0,7,0]);f.target.packet([0x90,60,100]);
 assert.deepEqual(externalMidi.state.sent,[[0xc0,7,0],[0x90,60,100]]);assert.deepEqual(f.sent,[]);assert.ok(f.resets.length>0);
 const newController=fixture(t,{externalMidi:fakeExternalMidi()});assert.equal(newController.controller.getSnapshot().externalMidiEnabled,false,'the enable switch is session-only');
});
test('synth preparation does not open external outputs before the gesture-bound launch gate',async t=>{
 const externalMidi=fakeExternalMidi(),f=fixture(t,{externalMidi});
 await f.controller.setExternalMidiEnabled(true);await f.controller.ensureReady();assert.equal(externalMidi.state.opens,0);
 const resume=f.controller.resumeForGesture(1),opening=f.controller.prepareExternalMidi(1);await resume;await opening;
 assert.equal(externalMidi.state.opens,1);
});
test('external output is limited to MIDI music and falls back to the built-in synth when no output exists',async t=>{
 const oggOutput=fakeExternalMidi(),ogg=fixture(t,{music:'ogg',externalMidi:oggOutput});await ogg.controller.setExternalMidiEnabled(true);await ogg.launch();
 ogg.target.packet([0x90,60,100]);assert.deepEqual(oggOutput.state.sent,[]);assert.deepEqual(ogg.sent,[[0x90,60,100]]);
 const noOutput=fakeExternalMidi({outputs:0}),fallback=fixture(t,{externalMidi:noOutput});await fallback.controller.setExternalMidiEnabled(true);await fallback.launch();
 fallback.target.packet([0x90,61,100]);assert.deepEqual(noOutput.state.sent,[]);assert.deepEqual(fallback.sent,[[0x90,61,100]]);
});
test('external output send failure records status and falls back to the existing synth sink',async t=>{
 const externalMidi=fakeExternalMidi({sendFailure:true}),f=fixture(t,{externalMidi});
 await f.controller.setExternalMidiEnabled(true);await f.launch();f.target.packet([0x90,62,100]);
 assert.deepEqual(externalMidi.state.sent,[]);assert.deepEqual(f.sent,[[0x90,62,100]]);
 assert.equal(f.controller.getSnapshot().externalMidiError,'web-midi-no-device');
});
test('external output completion is ignored when the launch intent changes while opening',async t=>{
 const gate=deferred(),externalMidi=fakeExternalMidi(),f=fixture(t,{externalMidi});
 externalMidi.openOutputs=()=>{externalMidi.state.opens++;return gate.promise;};
 await f.controller.setExternalMidiEnabled(true);let current=true;
 const opening=f.controller.prepareExternalMidi(1,()=>current);current=false;gate.resolve(1);await opening;
 assert.equal(externalMidi.state.opens,1);assert.equal(f.controller.getSnapshot().externalMidiError,null);
});
test('late external MIDI permission completion cannot enable a replaced Runtime epoch',async t=>{
 const permission=deferred(),externalMidi=fakeExternalMidi({permission:permission.promise}),f=fixture(t,{externalMidi});
 const enabling=f.controller.setExternalMidiEnabled(true);const replacement=f.replace();permission.resolve();await assert.rejects(enabling,{name:'AbortError'});
 assert.equal(f.controller.getSnapshot().externalMidiEnabled,false);assert.equal(replacement.epoch,f.controller.getSnapshot().activeEpoch);
});
test('byte validation prevents malformed, huge or non-MIDI packets reaching the official synth',async t=>{
 const f=fixture(t);await f.launch();for(const bytes of [null,{},[],[1,2,3],[0x90,60],[0x90,300,1],[0x90,60,NaN],[0x90,-1,2],[0x90,128,1],[0xf0,1],[0xf0,255,0xf7],Array(65537).fill(1)])f.target.packet(bytes);
 assert.deepEqual(f.sent,[]);
});
test('old listener callbacks cannot adopt a replacement document, even when Window identity is reused',async t=>{
 const f=fixture(t);await f.launch();const old=f.target.history.find(x=>x.type==='touhou-midi').fn;
 const event=f.target.packet([0x90,60,100]);f.sent.length=0;const context=f.replace();await f.controller.resumeForGesture(context.epoch);f.set({phase:'running',launched:true});
 old(event);assert.deepEqual(f.sent,[]);f.target.packet([0x90,61,100]);assert.deepEqual(f.sent,[[0x90,61,100]]);
});
test('focus/visibility loss suspends and does not let TinySynth.send implicitly restart background audio',async t=>{
 const f=fixture(t);await f.launch();f.target.packet([0xc0,4,0]);f.sent.length=0;
 f.activity({visible:false});const resumes=f.resumes.length;f.target.packet([0x90,60,100]);f.target.packet([0xc0,6,0]);f.target.packet([0x80,60,0]);
 assert.equal(f.audio.state,'suspended');assert.equal(f.resumes.length,resumes);assert.deepEqual(f.sent,[]);
 f.activity({visible:true});await drain();assert.equal(f.audio.state,'running');assert.deepEqual(f.sent,[[0xc0,6,0]],'only channel state is replayed, never background notes');
});
test('document departure fences pending synth load, BFCache return can retry without automatic launch',async t=>{
 const wait=deferred(),f=fixture(t,{load:synth=>wait.promise.then(()=>synth)});const task=f.controller.ensureReady();f.controller.pagehide();wait.resolve();await assert.rejects(task,{name:'AbortError'});
 assert.equal(f.controller.getSnapshot().ready,false);assert.equal(f.target.count(),0);assert.equal(f.audio.state,'suspended');
 f.controller.pageshow();await f.controller.ensureReady();assert.equal(f.controller.getSnapshot().ready,true);assert.equal(f.resumes.length,0);assert.equal(f.runtime.getSnapshot().phase,'prepared');
});
test('late audio resume cannot revive a departed document or suspend a newly resumed epoch',async t=>{
 const f=fixture(t);await f.controller.ensureReady();const old=deferred();f.audio.resume=()=>old.promise.then(()=>{f.audio.state='running';});
 const first=f.controller.resumeForGesture(1);f.controller.pagehide();old.resolve();await first;await drain();assert.equal(f.audio.state,'suspended');
 f.controller.pageshow();const prior=deferred();f.audio.resume=()=>prior.promise.then(()=>{f.audio.state='running';});const stale=f.controller.resumeForGesture(1);
 const next=f.replace();f.audio.resume=async()=>{f.audio.state='running';};await f.controller.resumeForGesture(next.epoch);f.set({phase:'running',launched:true});
 prior.resolve();await stale;assert.equal(f.audio.state,'running');assert.equal(f.controller.getSnapshot().activeEpoch,2);
});
test('abort during load does not prepare Runtime; denied resume is visible and does not auto-start',async t=>{
 const wait=deferred(),f=fixture(t,{load:synth=>wait.promise.then(()=>synth)}),abort=new AbortController();const loading=f.controller.ensureReady(abort.signal);abort.abort();wait.resolve();await assert.rejects(loading,{name:'AbortError'});
 f.audio.resume=()=>Promise.reject(new Error('gesture denied'));await assert.rejects(f.controller.resumeForGesture(1),/gesture denied/);
 assert.match(f.controller.getSnapshot().error,/gesture denied/);assert.equal(f.runtime.getSnapshot().phase,'prepared');assert.equal(f.audio.state,'suspended');
});
test('MIDI ceiling, no-music and replaced Runtime never retain event listeners',async t=>{
 const unsupported=fixture(t,{game:'th11'});await unsupported.controller.ensureReady();assert.equal(unsupported.target.count(),0);
 const none=fixture(t,{music:'none'});await none.controller.ensureReady();assert.equal(none.target.count(),0);
 const f=fixture(t);await f.launch();assert.equal(f.target.count(),4);f.set({phase:'idle',epoch:null,ready:false,launched:false},null);assert.equal(f.target.count(),0);assert.equal(f.audio.state,'suspended');
});
test('dispose removes all subscriptions/listeners and ignores queued events',async t=>{
 const f=fixture(t);await f.launch();const event=f.target.packet([0x90,60,100]),old=f.target.history.find(x=>x.type==='touhou-midi').fn;f.sent.length=0;f.controller.dispose();
 assert.equal(f.target.count(),0);assert.equal(f.subscribers.size,0);old(event);assert.deepEqual(f.sent,[]);assert.equal(f.audio.state,'suspended');
});
