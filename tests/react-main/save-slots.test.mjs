/** Synthetic persistence/Runtime ownership gates; no private player saves. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {score6} from './save-library-fixtures.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, work;
before(async()=>{
  work=await mkdtemp(resolve(project,'.cache/save-slots-test-'));const outfile=resolve(work,'slots.mjs');
  await build({stdin:{contents:`export * from './app/services/save-slots.ts'; export * from './app/services/save-library.ts'; export * from './app/models/save-library.ts';`,loader:'ts',resolveDir:project},outfile,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
  api=await import(pathToFileURL(outfile).href);
});
after(async()=>rm(work,{recursive:true,force:true}));
function lockManager(){const held=new Set();return {held,request(name,_options,callback){if(held.has(name))return Promise.resolve(callback(null));held.add(name);return Promise.resolve().then(()=>callback({name})).finally(()=>held.delete(name));}};}
async function fixture({before=score6('BASE'),selected=score6('SLOT'),factory=new IDBFactory(),locks=lockManager(),storageHook=store=>store}={}){
 const originalStore=api.createSaveLibraryStorage(factory),storage=storageHook(originalStore);
 const {archive}=await originalStore.add('th06','Selected','selected.dat',selected);await originalStore.choose('th06',archive.id);
 const native={phase:'prepared',epoch:1,game:'th06',launched:false},controls={mem:before===null?null:new Uint8Array(before),disk:before===null?null:new Uint8Array(before),writes:0,removes:0,failWrite:false,skipPersist:false};
 const runtime={getSnapshot:()=>({...native}),async withFileSession(game,operation,options){assert.equal(game,'th06');assert.equal(options.runtimeVariant,'normal');return operation({async sync(){},async send(command,payload){
  if(command==='read'){if(controls.mem===null)throw Object.assign(Error('missing'),{errno:44});return {bytes:Array.from(controls.mem)};}
  if(command==='write'){assert.equal(!!(await originalStore.state('th06')).run,true,'backup ledger is committed before a native write');controls.writes++;if(controls.failWrite)throw Error('native write failed');controls.mem=Uint8Array.from(payload.bytes);if(!controls.skipPersist)controls.disk=new Uint8Array(controls.mem);return {};}
  if(command==='remove'){controls.removes++;controls.mem=controls.disk=null;return {};}
  throw Error('Unexpected native command '+command);
 }});}};
 const runner=api.createSaveSlotRunner({storage,runtime:()=>runtime,locks,read:async()=>controls.disk===null?null:{bytes:new Uint8Array(controls.disk),edition:null,modified:1}});
 return {runner,storage,originalStore,archive,native,controls,locks,factory};
}
test('schema upgrade preserves version-one archives and adds durable selection and recovery stores',async()=>{
 const factory=new IDBFactory();const original={id:'legacy',product:'th06',name:'Legacy',filename:'score.dat',bytes:new Uint8Array(score6()),created:1};
 const db=await new Promise(resolve=>{const r=factory.open(api.SAVE_LIBRARY_DATABASE,1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('archives',{keyPath:'id'});s.createIndex('product','product');};r.onsuccess=()=>resolve(r.result);});
 await new Promise(resolve=>{const t=db.transaction('archives','readwrite');t.objectStore('archives').add(original);t.oncomplete=resolve;});db.close();
 const store=api.createSaveLibraryStorage(factory);assert.deepEqual((await store.list('th06'))[0].bytes,original.bytes);assert.equal((await store.state('th06')).selectedId,'legacy');
 await store.choose('th06',null);assert.equal((await store.state('th06')).selectedId,null);assert.equal((await factory.databases())[0].version,2);
});
test('backup is durable before application and successful exit updates only the chosen archive',async()=>{
 const f=await fixture();const other=await f.storage.add('th06','Other','other.dat',score6('OTHER'));
 await f.runner.apply('th06',null,f.archive.id);assert.deepEqual(f.controls.disk,f.archive.bytes);const run=(await f.storage.state('th06')).run;
 const backup=await f.storage.backup('th06',run.id);assert.deepEqual(backup.bytes,new Uint8Array(score6('BASE')));assert.deepEqual(backup.archiveBytes,f.archive.bytes);
 await f.runner.launched('th06');f.controls.disk=new Uint8Array(score6('PROGRESS'));f.native.epoch=null;f.native.phase='idle';await f.runner.finish();
 const entries=await f.storage.list('th06');assert.deepEqual(entries.find(e=>e.id===f.archive.id).bytes,f.controls.disk);assert.equal(entries.find(e=>e.id===f.archive.id).revision,1);assert.deepEqual(entries.find(e=>e.id===other.archive.id).bytes,other.archive.bytes);assert.equal((await f.storage.state('th06')).run,null);
 assert.deepEqual((await f.storage.backups('th06'))[0].bytes,new Uint8Array(score6('BASE')));f.runner.dispose();
});
test('backup persistence failure blocks all native writes',async()=>{
 const f=await fixture({storageHook:store=>({...store,begin:async()=>{throw new api.SaveLibraryError('storage');}})});
 await assert.rejects(f.runner.apply('th06',null),e=>e.code==='storage');assert.equal(f.controls.writes,0);assert.deepEqual(f.controls.disk,new Uint8Array(score6('BASE')));f.runner.dispose();
});
test('failed durable verification restores original bytes under the same native lock and retains the backup',async()=>{
 const f=await fixture();f.controls.skipPersist=true;
 await assert.rejects(f.runner.apply('th06',null),e=>e.code==='verify');assert.equal(f.controls.writes,2);assert.deepEqual(f.controls.mem,new Uint8Array(score6('BASE')));assert.equal((await f.storage.state('th06')).run,null);assert.equal((await f.storage.backups('th06')).length,1);f.runner.dispose();
});
test('failed write and rollback preserve a pending ledger; explicit restore recovers opaque originals',async()=>{
 const f=await fixture({before:new Uint8Array([1,2,3])});f.controls.failWrite=true;
 await assert.rejects(f.runner.apply('th06',null));assert.equal((await f.storage.state('th06')).run.stage,'pending');await assert.rejects(f.storage.choose('th06',null),e=>e.code==='pending');
 f.controls.failWrite=false;await f.runner.recover('th06','restore',async()=>null);assert.deepEqual(f.controls.disk,new Uint8Array([1,2,3]));assert.equal((await f.storage.state('th06')).run,null);assert.deepEqual((await f.storage.list('th06'))[0].bytes,f.archive.bytes);f.runner.dispose();
});
test('library writeback failure preserves durable progress and can be retried after reload',async()=>{
 let rejectUpdate=true;const f=await fixture({storageHook:store=>({...store,complete:async(p,id,bytes)=>{if(bytes&&rejectUpdate)throw new api.SaveLibraryError('storage');return store.complete(p,id,bytes);}})});
 await f.runner.apply('th06',null);await f.runner.launched('th06');f.controls.disk=new Uint8Array(score6('PLAYED'));f.native.epoch=null;
 await assert.rejects(f.runner.finish(),e=>e.code==='storage');assert.equal((await f.storage.state('th06')).run.stage,'pending');assert.deepEqual((await f.storage.list('th06'))[0].bytes,f.archive.bytes);
 f.runner.dispose();rejectUpdate=false;const reloaded=api.createSaveSlotRunner({storage:f.storage,runtime:()=>({getSnapshot:()=>({epoch:null,launched:false})}),locks:f.locks,read:async()=>({bytes:f.controls.disk,edition:null,modified:1})});
 await assert.rejects(reloaded.assertResolved('th06'),e=>e.code==='pending');await reloaded.recover('th06','keep',async()=>{throw Error('Read-back does not prepare a Runtime');});assert.deepEqual((await f.storage.list('th06'))[0].bytes,f.controls.disk);assert.equal((await f.storage.state('th06')).run,null);reloaded.dispose();
});
test('unacknowledged launch and discarded saves never overwrite archive progress',async()=>{
 const f=await fixture();await f.runner.apply('th06',null);f.native.epoch=null;await f.runner.finish();assert.equal((await f.storage.state('th06')).run.stage,'pending');assert.equal((await f.storage.list('th06'))[0].revision,undefined);f.runner.dispose();
 const discarded=await fixture();await discarded.runner.apply('th06',null);await discarded.runner.launched('th06');discarded.native.epoch=null;await discarded.runner.finish(false);assert.equal((await discarded.storage.state('th06')).run.stage,'pending');discarded.runner.dispose();
});
test('cross-tab native ownership blocks a second writer, then permits recovery after the first is retired',async()=>{
 const locks=lockManager(), factory=new IDBFactory(),a=await fixture({factory,locks});await a.runner.apply('th06',null);await a.runner.launched('th06');
 const b=api.createSaveSlotRunner({storage:a.storage,runtime:()=>({getSnapshot:()=>({epoch:null,launched:false})}),locks,read:async()=>({bytes:a.controls.disk,edition:null,modified:1})});
 await assert.rejects(b.acquire('th06'),e=>e.code==='busy');a.runner.dispose();await new Promise(resolve=>setImmediate(resolve));await b.recover('th06','keep',async()=>null);assert.equal((await a.storage.state('th06')).run,null);b.dispose();
});
test('stale selection is rejected before changing native files and unsupported lock environments fail closed',async()=>{
 const f=await fixture();await assert.rejects(f.runner.apply('th06',null,'another-archive'),e=>e.code==='conflict');assert.equal(f.controls.writes,0);f.runner.dispose();
 const unsafe=api.createSaveSlotRunner({storage:f.storage,runtime:()=>({getSnapshot:()=>({epoch:null})})});await assert.rejects(unsafe.acquire('th06'),e=>e.code==='unsupported');unsafe.dispose();
});
test('restoring a first-launch backup removes only the score that did not previously exist',async()=>{
 const f=await fixture({before:null});await f.runner.apply('th06',null);await f.runner.finish(false);await f.runner.recover('th06','restore',async()=>null);assert.equal(f.controls.disk,null);assert.equal(f.controls.removes,1);assert.equal((await f.storage.state('th06')).run,null);f.runner.dispose();
});
test('TH10 writeback uses the captured edition, not the most recently modified opposite-language save',async()=>{
 const f=await fixture();const run=await f.storage.begin('th06',f.archive.id,new Uint8Array(score6('BASE')),null);await f.storage.complete('th06',run.run.id,null);f.runner.dispose();
 let edition;const store=api.createSaveLibraryStorage(new IDBFactory());
 // Product validation is covered by DAT tests; use a ledger dependency to
 // isolate the exact-edition read contract from the score codec.
 const storage={...store,state:async()=>({product:'th10',selectedId:'slot',run:{id:'run',archiveId:'slot',revision:0,edition:'chs',stage:'pending'}}),complete:async()=>{},stage:async()=>{}};
 const runner=api.createSaveSlotRunner({storage,runtime:()=>({getSnapshot:()=>({epoch:null,launched:false})}),locks:lockManager(),read:async(_product,_language,_factory,_timeout,exact)=>{edition=exact;return {bytes:new Uint8Array(score6()),edition:exact,modified:1};}});
 await runner.recover('th10','keep',async()=>null);assert.equal(edition,'chs');runner.dispose();
});
