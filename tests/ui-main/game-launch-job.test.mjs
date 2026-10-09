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
const bundle = await build({ stdin: {contents: "export * from './app/services/game-launch-job.client.ts'; export * from './app/services/entry-package-update.client.ts';", resolveDir: root, loader: 'ts'}, bundle: true,
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
const directory = await mkdtemp(join(tmpdir(), 'ui-game-launch-job-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'game-job.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { createGameLaunchJobController, updatePackageForLaunch, prepareEntryPackageUpdate } = await import(pathToFileURL(modulePath).href);

function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
async function drain() {for (let i=0;i<12;i++) await Promise.resolve();}
const prefs = (game = 'th06', sensitivity = 150) => ({productId: game, preferenceId: game, options: {touchSensitivity: sensitivity}, music: 'none', language: 'ja'});
const inspection = game => ({productId: game, game, available: true, status: 'installed', reason: null,
 checks: [{url: `https://example.test/${game}`, kind: 'runtime', available: true}], runtimeVerified: false,
 packageVerified: false, generationId: `gen-${game}`, preferencesContext: {languageCatalog: [{id: 'ja'}]}, limitations: ['synthetic']});
function fixture(t, dependencies = {}, extras = {}) {
 let live = {phase: 'idle', epoch: null, game: null, generationId: null, ready: false, launched: false};
 const listeners = new Set(), calls = [], cancels = [], pending = [], preparations = [], inspections = [];
 let serial = 0;
 function set(value) {live = Object.freeze({...live, ...value}); for (const listener of listeners) listener();}
 const runtime = {getSnapshot: () => live, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
  prepare(plan) {calls.push(plan); const wait = deferred(), epoch = ++serial; set({phase: 'loading', epoch, game: plan.game, generationId: plan.generation.id, ready: false, launched: false}); pending.push({...wait, epoch, game: plan.game}); return wait.promise;},
  cancel() {cancels.push(live.epoch); set({phase: 'idle', epoch: null, game: null, ready: false, launched: false});},
  launch() {throw new Error('No auto-launch allowed');},
 };
 const job = createGameLaunchJobController({baseUrl: 'https://example.test/', runtimeService: runtime, ...extras,
  dependencies: {
   inspect: async options => {inspections.push(options); return inspection(options.productId);},
   prepare: async options => {preparations.push(options); return options.runtimeService.prepare({game: options.productId, generation: {id: `gen-${options.productId}`}, runtimeVariant: 'normal'});},
   ...dependencies,
  }});
 t.after(() => job.dispose());
 function complete(index = pending.length-1, {epoch = pending[index].epoch, setLive = true} = {}) {
  const result = {phase: 'prepared', epoch, game: pending[index].game, generationId: `gen-${pending[index].game}`, ready: true, launched: false};
  if (setLive) set(result); pending[index].resolve(result); return result;
 }
 return {job, runtime, calls, cancels, pending, preparations, inspections, set, complete,
  replace(game='th11', phase='loading') {const epoch=++serial; set({epoch, game, phase, generationId:`gen-${game}`, ready:phase==='prepared', launched:phase==='running'}); return epoch;}};
}
test('product inspection switch aborts old request and fences its late metadata', async t => {
 const first=deferred(), second=deferred(), requests=[];
 const f=fixture(t,{inspect: options => {requests.push(options); return options.productId==='th06'?first.promise:second.promise;}});
 const old=f.job.inspect('th06'); await drain(); const next=f.job.inspect('th11'); await drain();
 assert.equal(requests[0].signal.aborted,true); second.resolve(inspection('th11')); await next;
 first.resolve(inspection('th06')); await assert.rejects(old,{name:'AbortError'});
 assert.equal(f.job.getSnapshot().inspection.productId,'th11');
});
test('duplicate same-selection prepare coalesces, differing product or settings never adopts it', async t => {
 const f=fixture(t), settings=prefs(), first=f.job.prepare('th06',settings), duplicate=f.job.prepare('th06',structuredClone(settings));
 assert.equal(first,duplicate); await assert.rejects(f.job.prepare('th07',prefs('th07')),/Another preparation/);
 await assert.rejects(f.job.prepare('th06',prefs('th06',200)),/Another preparation/);
 await drain(); assert.equal(f.calls.length,1); f.complete(); await first;
 assert.equal(f.job.getSnapshot().selection.productId,'th06'); assert.equal(f.job.getSnapshot().preparedEpoch,1);
 await assert.rejects(f.job.prepare('th07',prefs('th07')),/Save and close/); assert.equal(f.calls.length,1);
});
test('click-time selection is immutable and route unsubscribe does not cancel or launch', async t => {
 const f=fixture(t), settings=prefs(), task=f.job.prepare('th08', {...settings,productId:'th08',preferenceId:'th08'});
 settings.options.touchSensitivity=200; const off=f.job.subscribe(()=>{}); off(); await drain();
 assert.equal(f.preparations[0].preferences.options.touchSensitivity,150);
 assert.equal(Object.isFrozen(f.job.getSnapshot().selection.preferences.options),true);
 const result=f.complete(); await task; assert.equal(f.job.getSnapshot().preparedEpoch,result.epoch);
 assert.equal('launch' in f.job,false); assert.equal(f.cancels.length,0);
});
test('cancelled acquisition cannot create a Runtime or publish errors into replacement work', async t => {
 const wait=deferred(); let oldOptions;
 const f=fixture(t,{prepare:async options=>{
  if(options.productId==='th06'){oldOptions=options; await wait.promise;}
  return options.runtimeService.prepare({game:options.productId,generation:{id:`gen-${options.productId}`},runtimeVariant:'normal'});
 }});
 const old=f.job.prepare('th06',prefs()); await drain(); f.job.cancel();
 const next=f.job.prepare('th09',prefs('th09')); await drain(); const value=f.complete(); await next;
 assert.equal(oldOptions.signal.aborted,true); wait.resolve(); await assert.rejects(old,{name:'AbortError'});
 assert.equal(f.calls.length,1); assert.equal(f.job.getSnapshot().preparedEpoch,value.epoch); assert.equal(f.job.getSnapshot().error,null);
});
test('cancel never touches unrelated epoch or a launching/running/saving session', async t => {
 for(const phase of ['launching','running','saving']) {
  const f=fixture(t), task=f.job.prepare('th10',prefs('th10')); await drain(); f.complete(); await task;
  f.set({phase,launched:phase==='running'||phase==='saving'}); f.job.cancel(); assert.deepEqual(f.cancels,[]); assert.equal(f.job.getSnapshot().preparedEpoch,null);
 }
 const f=fixture(t), task=f.job.prepare('th06',prefs()); await drain(); const newer=f.replace(); f.job.cancel();
 f.complete(0,{setLive:false}); await assert.rejects(task,{name:'AbortError'}); assert.deepEqual(f.cancels,[]); assert.equal(f.runtime.getSnapshot().epoch,newer);
});
test('internal retry completion adopts only returned exact epoch, not newer current', async t => {
 const f=fixture(t), task=f.job.prepare('th11',prefs('th11')); await drain();
 f.set({epoch:2,phase:'loading'}); const value=f.complete(0,{epoch:2}); await task;
 assert.equal(f.job.getSnapshot().preparedEpoch,2); assert.deepEqual(await f.job.prepare('th11',prefs('th11')),value);
 f.job.cancel(); assert.deepEqual(f.cancels,[2]);
 const other=fixture(t), stale=other.job.prepare('th07',prefs('th07')); await drain(); other.replace('th09','prepared'); other.complete(0,{setLive:false});
 await assert.rejects(stale,/replaced/); assert.equal(other.job.getSnapshot().preparedEpoch,null);
});
test('inspection and progress are deep-owned copies and preparation never changes settings', async t => {
 const value=inspection('th06'); let progress;
 const f=fixture(t,{inspect:async()=>value,prepare:async options=>{
  progress={completed:1,total:3};options.onProgress(progress);
  return options.runtimeService.prepare({game:'th06',generation:{id:'gen-th06'},runtimeVariant:'normal'});
 }});
 const result=await f.job.inspect('th06'); value.preferencesContext.languageCatalog[0].id='changed';
 assert.equal(result.preferencesContext.languageCatalog[0].id,'ja'); assert.equal(Object.isFrozen(result.preferencesContext.languageCatalog[0]),true);
 const settings=prefs(), before=structuredClone(settings), task=f.job.prepare('th06',settings); await drain(); progress.completed=2;
 assert.equal(f.job.getSnapshot().progress.completed,1); f.complete(); await task; assert.deepEqual(settings,before);
});
test('another Runtime appearing during acquisition is preserved', async t => {
 const wait=deferred(); const f=fixture(t,{prepare:async options=>{await wait.promise;return options.runtimeService.prepare({game:'th06',generation:{id:'gen-th06'},runtimeVariant:'normal'});}});
 const task=f.job.prepare('th06',prefs()); await drain(); const epoch=f.replace('th11','prepared'); wait.resolve();
 await assert.rejects(task,/started while/); assert.equal(f.calls.length,0); assert.equal(f.runtime.getSnapshot().epoch,epoch); assert.deepEqual(f.cancels,[]);
});

const updatable = game => ({...inspection(game), updateAvailable: true, installedRevision: 'old', publishedRevision: 'new'});
test('update now uses the existing update port before preparation, with both click-time fences', async t => {
 const updates=[], wait=deferred();
 const f=fixture(t,{inspect:async options=>updatable(options.productId)}, {updatePackage: request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06');
 const task=f.job.prepare('th06',prefs(),null,'update-now'); await drain();
 assert.equal(f.calls.length,0); assert.equal(updates.length,1);
 assert.equal(updates[0].expectedGenerationId,'gen-th06'); assert.equal(updates[0].expectedPublishedRevision,'new');
 wait.resolve({generationId:'updated'}); await drain();
 assert.equal(f.preparations[0].expectedGenerationId,'updated'); f.complete(); await task;
 assert.equal(f.job.getSnapshot().packageUpdate,null);
});
test('keep current never invokes an update, and a cancelled update now never starts Runtime', async t => {
 const updates=[], wait=deferred();
 const f=fixture(t,{inspect:async options=>updatable(options.productId)}, {updatePackage:request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06'); const keep=f.job.prepare('th06',prefs()); await drain();
 assert.equal(updates.length,0); assert.equal(f.preparations[0].expectedGenerationId,'gen-th06'); f.complete(); await keep;
 f.job.cancel(); await f.job.inspect('th06'); const update=f.job.prepare('th06',prefs(),null,'update-now'); await drain();
 f.job.cancel(); assert.equal(updates[0].signal.aborted,true); wait.resolve({generationId:'updated'});
 await assert.rejects(update,{name:'AbortError'}); assert.equal(f.calls.length,1);
});

test('initial OGG cancellation belongs to the current preparation and an old cleanup cannot erase its replacement',async t=>{
 const old=deferred(),next=deferred(),ports=[];let cancellations=0;
 const f=fixture(t,{prepare:async options=>{
  ports.push(options);options.onInitialOggDownload(()=>{cancellations++;(options.productId==='th06'?old:next).resolve();});
  await (options.productId==='th06'?old:next).promise;options.onInitialOggDownload(null);
  return options.runtimeService.prepare({game:options.productId,generation:{id:`gen-${options.productId}`},runtimeVariant:'normal'});
 }});
 const first=f.job.prepare('th06',prefs());await drain();assert.equal(f.job.getSnapshot().musicDownloading,true);f.job.cancel();
 const second=f.job.prepare('th07',prefs('th07'));await drain();old.resolve();await assert.rejects(first,{name:'AbortError'});
 assert.equal(f.job.getSnapshot().musicDownloading,true);f.job.cancelMusicDownload();await drain();assert.equal(cancellations,1);assert.equal(ports[1].signal.aborted,false);f.complete();await second;assert.equal(f.job.getSnapshot().musicDownloading,false);
});
test('a failed update falls back to the captured current generation and continues preparation',async t=>{
 const f=fixture(t,{inspect:async options=>updatable(options.productId)},{updatePackage:async()=>{throw Error('Update network unavailable');}});
 await f.job.inspect('th06');const task=f.job.prepare('th06',prefs(),null,'update-now');await drain();
 assert.equal(f.preparations[0].expectedGenerationId,'gen-th06');assert.equal(f.job.getSnapshot().packageUpdate.error,'Update network unavailable');f.complete();await task;
});
test('multiplayer entries use the known catalog, shared update port and current-version fallback',async()=>{
 for(const choice of ['keep-current','background','update-now']) {
  const calls=[],inspection={generationId:'current-th08',publishedRevision:'new',source:'local',updateAvailable:true};
  const owner={getSnapshot:()=>({inspections:{th08:inspection},operation:null}),installBase:async(...args)=>{calls.push(args);throw Error('update failed');},cancel(){}};
  const failures=[];const result=await prepareEntryPackageUpdate({productId:'th08mp',owner,signal:new AbortController().signal,current:()=>true,choose:async source=>{assert.equal(source,'local');return choice;},onFailure:error=>failures.push(error.message)});
  if(choice==='background') assert.deepEqual(result,{productId:'th08',expectedPublishedRevision:'new'});else assert.equal(result,null);
  assert.equal(calls.length,choice==='update-now'?1:0);assert.deepEqual(failures,choice==='update-now'?['update failed']:[]);
  if(calls.length){assert.equal(calls[0][0],'th08');assert.equal(calls[0][1].expectedGenerationId,'current-th08');}
 }
 const wait=deferred(),signal=new AbortController();let current=true,installs=0;
 const owner={getSnapshot:()=>({inspections:{th08:{generationId:'old',publishedRevision:'new',source:'remote',updateAvailable:true}},operation:null}),installBase:async()=>{installs++;},cancel(){}};
 const task=prepareEntryPackageUpdate({productId:'th08mp',owner,signal:signal.signal,current:()=>current,choose:()=>wait.promise});current=false;wait.resolve('update-now');await assert.rejects(task,{name:'AbortError'});assert.equal(installs,0);
});
test('the shared background update owner accepts a multiplayer epoch and starts at native acknowledgment before first frame',async t=>{
 const updates=[],wait=deferred(),f=fixture(t,{}, {updatePackage:request=>{updates.push(request);return wait.promise;}});
 const preparation=f.job.prepare('th06',prefs());await drain();f.complete();await preparation;f.set({runtimeVariant:'multiplayer'});
 assert.equal(f.job.armPackageUpdate({productId:'th06',expectedGenerationId:'gen-th06',expectedPublishedRevision:'new'},1),true);
 f.set({phase:'launching',launched:false});await drain();assert.equal(updates.length,0);
 f.set({launched:true});await drain();assert.equal(updates.length,1);assert.equal(f.runtime.getSnapshot().phase,'launching');wait.resolve({generationId:'next'});await drain();assert.equal(f.job.getSnapshot().packageUpdate.phase,'complete');
});
test('cancel only the update continues current; cancel the whole Start remains separate',async t=>{
 const wait=deferred(),updates=[];const f=fixture(t,{inspect:async options=>updatable(options.productId)},{updatePackage:request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06');const task=f.job.prepare('th06',prefs(),null,'update-now');await drain();f.job.cancelUpdate();assert.equal(updates[0].signal.aborted,true);wait.resolve({generationId:'ignored'});await drain();
 assert.equal(f.preparations[0].expectedGenerationId,'gen-th06');assert.equal(f.job.getSnapshot().packageUpdate.phase,'cancelled');f.complete();await task;
});
test('background update waits for explicit Start, retains the active epoch, and uses the prepared Package fence', async t => {
 const updates=[], wait=deferred();
 const f=fixture(t,{inspect:async options=>updatable(options.productId)}, {updatePackage:request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06'); const task=f.job.prepare('th06',prefs(),null,'background'); await drain();
 f.complete(); await task; assert.equal(updates.length,0); assert.equal(f.job.getSnapshot().packageUpdate.phase,'waiting');
 f.set({phase:'launching'}); await drain(); assert.equal(updates.length,0);
 f.set({phase:'running',launched:true}); await drain(); assert.equal(updates.length,1);
 assert.equal(updates[0].expectedGenerationId,'gen-th06'); assert.equal(updates[0].expectedPublishedRevision,'new');
 wait.resolve({generationId:'next-launch'}); await drain();
 assert.equal(f.job.getSnapshot().packageUpdate.phase,'complete'); assert.equal(f.runtime.getSnapshot().generationId,'gen-th06');
 assert.equal(f.runtime.getSnapshot().epoch,1); assert.equal(f.calls.length,1); assert.deepEqual(f.cancels,[]);
});
test('closing or cancelling a prepared background choice cannot later launch its update', async t => {
 for(const close of [false,true]) {
  const updates=[],f=fixture(t,{inspect:async options=>updatable(options.productId)}, {updatePackage:async request=>{updates.push(request);return {generationId:'next'};}});
  await f.job.inspect('th06'); const task=f.job.prepare('th06',prefs(),null,'background'); await drain();f.complete();await task;
  if(close)f.set({epoch:null,phase:'exited',ready:false});else f.job.cancelUpdate();
  f.set({epoch:1,phase:'running',launched:true});await drain();
  assert.equal(updates.length,0);assert.equal(f.job.getSnapshot().packageUpdate.phase,'cancelled');
 }
});
test('background failure and disposal are fenced without replacing or cancelling a running Runtime', async t => {
 const wait=deferred(),updates=[],f=fixture(t,{inspect:async options=>updatable(options.productId)}, {updatePackage:request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06');const task=f.job.prepare('th06',prefs(),null,'background');await drain();f.complete();await task;
 f.set({phase:'running',launched:true});await drain();f.job.dispose();assert.equal(updates[0].signal.aborted,true);
 wait.reject(new Error('late failure'));await drain();assert.deepEqual(f.cancels,[]);assert.equal(f.runtime.getSnapshot().phase,'running');
});

test('launch update cancellation owns only its exact root resource operation, including synchronous cancellation',async()=>{
 const abort=new AbortController(),wait=deferred(),calls=[];
 const owner={getSnapshot:()=>({operation:null}),installBase(productId,fence){calls.push({productId,fence});abort.abort();return wait.promise;},cancel(){calls.push('cancel');}};
 const pending=updatePackageForLaunch(owner,{productId:'th06',expectedGenerationId:'current',expectedPublishedRevision:'new',signal:abort.signal});
 assert.equal(calls[1],'cancel');wait.resolve({generation:{id:'committed'}});assert.deepEqual(await pending,{generationId:'committed'});
 const blocked={...owner,getSnapshot:()=>({operation:{kind:'install-base'}})};
 await assert.rejects(updatePackageForLaunch(blocked,{productId:'th06',expectedGenerationId:'current',expectedPublishedRevision:'new',signal:new AbortController().signal}),/current resource task/);
 assert.equal(calls.length,2);
});
test('background update errors remain visible and dismissible without affecting gameplay',async t=>{
 const f=fixture(t,{inspect:async options=>updatable(options.productId)},{updatePackage:async()=>{throw new Error('Package changed');}});
 await f.job.inspect('th06');const task=f.job.prepare('th06',prefs(),null,'background');await drain();f.complete();await task;
 f.set({phase:'running',launched:true});await drain();assert.equal(f.job.getSnapshot().packageUpdate.error,'Package changed');
 f.job.dismissUpdate();assert.equal(f.job.getSnapshot().packageUpdate,null);assert.deepEqual(f.cancels,[]);
});

test('closing a running session cannot let a second background choice overwrite its still-active update',async t=>{
 const wait=deferred(),updates=[],f=fixture(t,{inspect:async options=>updatable(options.productId)},{updatePackage:request=>{updates.push(request);return wait.promise;}});
 await f.job.inspect('th06');const first=f.job.prepare('th06',prefs(),null,'background');await drain();f.complete();await first;
 f.set({phase:'running',launched:true});await drain();
 f.set({epoch:null,phase:'exited',launched:false,ready:false});await f.job.inspect('th06');
 await assert.rejects(f.job.prepare('th06',prefs(),null,'background'),/already active/);
 assert.equal(f.job.getSnapshot().packageUpdate.epoch,1);assert.equal(f.job.getSnapshot().packageUpdate.phase,'updating');assert.equal(updates.length,1);
 const keep=f.job.prepare('th06',prefs());await drain();f.complete();await keep;
 wait.resolve({generationId:'next'});await drain();assert.equal(f.job.getSnapshot().packageUpdate.epoch,1);assert.equal(f.runtime.getSnapshot().epoch,2);
});
