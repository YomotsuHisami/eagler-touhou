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
const bundle = await build({ entryPoints: [join(root, 'app/services/game-launch-job.client.ts')], bundle: true,
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
const { createGameLaunchJobController } = await import(pathToFileURL(modulePath).href);

function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
async function drain() {for (let i=0;i<12;i++) await Promise.resolve();}
const prefs = (game = 'th06', sensitivity = 150) => ({productId: game, preferenceId: game, options: {touchSensitivity: sensitivity}, music: 'none', language: 'ja'});
const inspection = game => ({productId: game, game, available: true, status: 'installed', reason: null,
 checks: [{url: `https://example.test/${game}`, kind: 'runtime', available: true}], runtimeVerified: false,
 packageVerified: false, generationId: `gen-${game}`, preferencesContext: {languageCatalog: [{id: 'ja'}]}, limitations: ['synthetic']});
function fixture(t, dependencies = {}) {
 let live = {phase: 'idle', epoch: null, game: null, generationId: null, ready: false, launched: false};
 const listeners = new Set(), calls = [], cancels = [], pending = [], preparations = [], inspections = [];
 let serial = 0;
 function set(value) {live = Object.freeze({...live, ...value}); for (const listener of listeners) listener();}
 const runtime = {getSnapshot: () => live, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
  prepare(plan) {calls.push(plan); const wait = deferred(), epoch = ++serial; set({phase: 'loading', epoch, game: plan.game, generationId: plan.generation.id, ready: false, launched: false}); pending.push({...wait, epoch, game: plan.game}); return wait.promise;},
  cancel() {cancels.push(live.epoch); set({phase: 'idle', epoch: null, game: null, ready: false, launched: false});},
  launch() {throw new Error('No auto-launch allowed');},
 };
 const job = createGameLaunchJobController({baseUrl: 'https://example.test/', runtimeService: runtime,
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
