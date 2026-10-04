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
const bundle = await build({ entryPoints: [join(root, 'app/services/ogg-progressive.client.ts')], bundle: true,
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
const directory = await mkdtemp(join(tmpdir(), 'ui-ogg-progressive-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'ogg.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { createProgressiveOggController } = await import(pathToFileURL(modulePath).href);

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function drain(){for(let i=0;i<35;i++)await Promise.resolve();}
function fixture(t,{installed=false}={}){
 const listeners=new Set(),installs=[],attachments=[],baseUrl='https://example.test/app/';
 const baseIds=['game-data','shared-unifont'],fileIds=['ogg:1','ogg:2','ogg:3','ogg:4'];
 const files=Object.fromEntries([...baseIds,...fileIds].map(id=>[id,{revision:`rev-${id}`,source:id==='game-data'?'games/th11/th11.dat':id==='shared-unifont'?'shared/unifont.otf':`games/th11/music/ogg/${id.slice(-1)}.ogg`,target:id==='game-data'?'/th11.dat':id==='shared-unifont'?'/unifont.otf':`/music/${id.slice(-1)}.ogg`,bytes:3,sha256:'a'.repeat(64)}]));
 const descriptor={schema:'eagler-touhou/package/1',game:'th11',revision:'rev-one',files,base:{files:baseIds},components:{ogg:{type:'ogg',files:fileIds}},runtimeRequirement:{protocol:'eagler-touhou/1',target:'th11',dataFile:'game-data',dataLayout:`sha256-${'b'.repeat(64)}`}};
 let generation={id:'initial',game:'th11',descriptor,files:Object.fromEntries([...baseIds,...fileIds.slice(0,installed?4:2)].map(id=>[id,{revision:files[id].revision,objectId:`object-${id}`}]))};
 let current={installation:{game:'th11',currentGeneration:generation.id,source:'local'},generation},live={epoch:1,game:'th11',phase:'prepared',launched:false};
 const host={games:{th11:{gameData:{bytes:3,sha256:'a'.repeat(64),layout:descriptor.runtimeRequirement.dataLayout}}}};
 const seed={epoch:1,fileIds,resolved:{game:'th11',baseIds,baseUrl,host,catalog:{schema:'eagler-touhou/release-catalog/1',games:{th11:{revision:'rev-one',descriptor:'th11.package.json'}}},descriptor,generation,entry:`${baseUrl}runtime/th11/entry.html`}};
 const deps={readCurrent:async()=>current,install:async(game,args)=>{installs.push({game,args});assert.equal(args.expectedGenerationId,current.generation.id);assert.equal(args.expectedCurrentRevision,'rev-one');assert.ok(args.expectedFileDeclarations['game-data']);
  generation=structuredClone(current.generation);generation.id=`next-${installs.length}`;for(const id of args.addFileIds)generation.files[id]={revision:files[id].revision,objectId:`object-${id}`};
  current={installation:{...current.installation,currentGeneration:generation.id},generation};return current;}};
 const runtime={getSnapshot:()=>live,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},extendOggResources:async(epoch,g,ids)=>{attachments.push({epoch,generation:g,ids});}};
 const job=createProgressiveOggController({baseUrl,dependencies:deps,runtime});t.after(()=>job.dispose());
 return {job,runtime,seed,deps,installs,attachments,get current(){return current;},set current(next){current=next;},set(patch){live={...live,...patch};for(const fn of listeners)fn();}};
}
test('first two tracks form the barrier; background work begins only after actual running',async t=>{
 const f=fixture(t);f.job.arm(f.seed);await drain();assert.equal(f.installs.length,0);assert.equal(f.job.getSnapshot().phase,'waiting');
 f.set({phase:'launching',launched:true});await drain();assert.equal(f.installs.length,0);
 f.set({phase:'running'});await drain();assert.equal(f.installs.length,2);assert.deepEqual(f.installs.map(x=>x.args.addFileIds),[['ogg:3'],['ogg:4']]);
 assert.deepEqual(f.installs.map(x=>x.args.expectedGenerationId),['initial','next-1']);assert.equal(f.job.getSnapshot().phase,'complete');assert.equal(f.attachments.length,2);
 f.set({phase:'running'});await drain();assert.equal(f.installs.length,2);assert.equal(f.attachments.length,2);
});
test('already installed later tracks attach without any remote mutation',async t=>{
 const f=fixture(t,{installed:true});f.job.arm(f.seed);f.set({phase:'running',launched:true});await drain();assert.equal(f.installs.length,0);assert.deepEqual(f.attachments.map(x=>x.ids),[['ogg:3'],['ogg:4']]);
});
test('close or a newer epoch cancels acquisition and late success cannot attach to any Runtime',async t=>{
 for(const replacement of [{phase:'saving'},{epoch:2,game:'th06',phase:'running'}]){
  const f=fixture(t),wait=deferred();let pendingOptions;f.deps.install=async(_game,options)=>{pendingOptions=options;return wait.promise;};
  // Dependencies are copied at construction, so use a fresh explicitly injected controller.
  f.job.dispose();const job=createProgressiveOggController({baseUrl:f.seed.resolved.baseUrl,runtime:f.runtime,dependencies:f.deps});t.after(()=>job.dispose());
  job.arm(f.seed);f.set({phase:'running',launched:true});await drain();f.set(replacement);assert.equal(pendingOptions.signal.aborted,true);
  wait.resolve(f.current);await drain();assert.equal(f.attachments.length,0);assert.equal(job.getSnapshot().phase,'cancelled');
 }
});
test('a new local generation, even same public revision, stops background work without overwriting it',async t=>{
 const f=fixture(t);f.job.arm(f.seed);f.current={...f.current,installation:{...f.current.installation,currentGeneration:'imported'},generation:{...f.current.generation,id:'imported'}};
 f.set({phase:'running',launched:true});await drain();assert.equal(f.installs.length,0);assert.equal(f.attachments.length,0);assert.equal(f.job.getSnapshot().phase,'error');
 f.set({phase:'running'});await drain();assert.equal(f.installs.length,0,'Runtime health updates never auto-retry a failed mutation');
});
test('conflicting fetched declarations never attach, and errors require explicit retry',async t=>{
 const f=fixture(t);let calls=0;f.deps.install=async()=>{calls++;const result=structuredClone(f.current);result.generation.descriptor.files['ogg:3'].sha256='c'.repeat(64);return result;};f.job.dispose();
 const job=createProgressiveOggController({baseUrl:f.seed.resolved.baseUrl,runtime:f.runtime,dependencies:f.deps});t.after(()=>job.dispose());job.arm(f.seed);f.set({phase:'running',launched:true});await drain();
 assert.equal(job.getSnapshot().phase,'error');assert.equal(f.attachments.length,0);f.set({phase:'running'});await drain();assert.equal(calls,1);job.retry();await drain();assert.equal(calls,2);
});
test('root view unsubscribe never aborts OGG, but dispose and explicit stop do',async t=>{
 const f=fixture(t);f.job.arm(f.seed);const off=f.job.subscribe(()=>{});off();f.set({phase:'running',launched:true});await drain();assert.equal(f.job.getSnapshot().phase,'complete');
 const g=fixture(t);g.job.arm(g.seed);g.job.cancel();g.set({phase:'running',launched:true});await drain();assert.equal(g.installs.length,0);assert.equal(g.job.getSnapshot().phase,'cancelled');
});
