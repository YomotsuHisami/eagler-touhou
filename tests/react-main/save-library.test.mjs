import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {score6} from './save-library-fixtures.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, work, env, React, createRoot, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  work = await mkdtemp(resolve(project, '.cache/save-library-test-'));
  const output = resolve(work, 'library.mjs');
  await build({stdin:{contents:`export * from './app/services/save-library.ts'; export * from './app/models/save-library.ts'; export * from './app/components/launcher/SaveLibraryPanel.tsx'; export * from './app/i18n.tsx';`,resolveDir:project,loader:'tsx'},outfile:output,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(output).href);
});
afterEach(async()=>{if(root){await React.act(async()=>root.unmount()); root=null;} env.document.body.replaceChildren(); assert.equal(env.errors.length,0);});
after(async()=>{env.close();await rm(work,{recursive:true,force:true});});
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function settled(model) {for(let i=0;i<80&&(model.getSnapshot().phase==='loading'||model.getSnapshot().busy);i++)await tick();}
const file = (name='one.dat',bytes=score6()) => ({name,size:bytes.length,async arrayBuffer(){return new Uint8Array(bytes).buffer;}});

test('archive storage persists exact private copies in its own database and deduplicates concurrent imports',async()=>{
  const factory=new IDBFactory(), store=api.createSaveLibraryStorage(factory), other=api.createSaveLibraryStorage(factory);
  const bytes=score6(), expected=new Uint8Array(bytes);
  const results=await Promise.all([store.add('th06','Original','06.dat',bytes),other.add('th06','Another','other.dat',bytes)]);
  assert.equal(results.filter(v=>v.duplicate).length,1);
  bytes.fill(0);
  const entries=await other.list('th06');assert.equal(entries.length,1);assert.deepEqual(entries[0].bytes,expected);
  assert.deepEqual((await factory.databases()).map(v=>v.name),[api.SAVE_LIBRARY_DATABASE]);
  await store.rename('th06',entries[0].id,'Renamed');assert.equal((await other.list('th06'))[0].name,'Renamed');
  assert.deepEqual((await other.list('th06'))[0].bytes,expected);
  await assert.rejects(store.rename('th07',entries[0].id,'Wrong context'),e=>e.code==='missing');
  assert.equal((await store.list('th07')).length,0);
});
test('invalid, mismatched, oversized and multiplayer inputs do not create or modify archive storage',async()=>{
  const factory=new IDBFactory(), store=api.createSaveLibraryStorage(factory);
  await assert.rejects(store.add('th07','Wrong','06.dat',score6()),e=>e.code==='invalid');
  await assert.rejects(store.add('th06','Broken','bad.dat',new Uint8Array([1,2])),e=>e.code==='invalid');
  await assert.rejects(store.add('th06','Huge','big.dat',new Uint8Array(2_000_001)),e=>e.code==='invalid');
  await assert.rejects(store.add('th06','  ','06.dat',score6()),e=>e.code==='name');
  await assert.rejects(store.list('th06mp'),e=>e.code==='unsupported');
  assert.deepEqual(await factory.databases(),[]);
});
test('capacity is enforced atomically while duplicate archives remain accessible',async()=>{
  const store=api.createSaveLibraryStorage(new IDBFactory());
  for(let i=0;i<20;i++)await store.add('th06',String(i),`${i}.dat`,score6(String(i)));
  await assert.rejects(store.add('th06','Overflow','21.dat',score6('unique')),e=>e.code==='full');
  assert.equal((await store.add('th06','Duplicate','0.dat',score6('0'))).duplicate,true);
  assert.equal((await store.list('th06')).length,20);
});
test('blocked storage times out and closes a late database connection',async()=>{
  let request, closed=0;
  const store=api.createSaveLibraryStorage({open(){return request={};}},10);
  await assert.rejects(store.list('th06'),e=>e.code==='storage');
  request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);
});
test('model keeps list usable when native save reads fail and pauses native reads during game work',async()=>{
  let reads=0;
  const model=api.createSaveLibrary({storage:api.createSaveLibraryStorage(new IDBFactory()),read:async()=>{reads++;throw Error('Storage unavailable');}});
  model.select('th06','ja');await settled(model);assert.equal(model.getSnapshot().phase,'ready');assert.equal(model.getSnapshot().currentPhase,'unavailable');
  model.suspend(true);await settled(model);const count=reads;await model.refresh();assert.equal(reads,count);assert.equal(model.getSnapshot().currentPhase,'busy');
  await model.importFile(file());assert.equal(model.getSnapshot().entries.length,1);
  await model.capture();assert.equal(model.getSnapshot().error,'busy');
  model.suspend(false);await settled(model);assert.equal(reads>count,true);model.dispose();
});
test('late product selection cannot publish an old save and close clears the dialog model',async()=>{
  const pending=new Map(), store=api.createSaveLibraryStorage(new IDBFactory());
  const model=api.createSaveLibrary({storage:store,read:product=>new Promise(resolve=>pending.set(product,resolve))});
  model.select('th06','ja');model.select('th07','ja');pending.get('th07')(null);await settled(model);
  pending.get('th06')({bytes:score6(),edition:null,modified:0});await tick();assert.equal(model.getSnapshot().product,'th07');assert.equal(model.getSnapshot().current,null);
  model.clear();assert.equal(model.getSnapshot().phase,'idle');model.dispose();
});
test('capture and import retain duplicate content, rename validation and exact bytes without native writes',async()=>{
  const exported=[];
  const bytes=new Uint8Array(score6()), model=api.createSaveLibrary({storage:api.createSaveLibraryStorage(new IDBFactory()),read:async()=>({bytes,edition:null,modified:0}),download:(name,buffer,mime)=>exported.push({name,bytes:new Uint8Array(buffer),mime})});
  model.select('th06','ja');await settled(model);await model.capture();assert.equal(model.getSnapshot().result,'added');
  await model.importFile(file());assert.equal(model.getSnapshot().result,'duplicate');assert.equal(model.getSnapshot().entries.length,1);
  const id=model.getSnapshot().entries[0].id;await model.rename(id,'  Personal  ');assert.equal(model.getSnapshot().entries[0].name,'Personal');assert.deepEqual(model.getSnapshot().entries[0].bytes,bytes);
  model.download(id);assert.equal(exported[0].name,'th06-Personal.dat');assert.deepEqual(exported[0].bytes,bytes);assert.equal(exported[0].mime,'application/octet-stream');
  await model.rename(id,' ');assert.equal(model.getSnapshot().error,'name');assert.equal(model.getSnapshot().entries[0].name,'Personal');
  await model.importFile(file('wrong.txt'));assert.equal(model.getSnapshot().error,'invalid');model.dispose();
});
test('compact file panel renders all save names as safe read-only text',async()=>{
  const bytes=new Uint8Array(score6()), store=api.createSaveLibraryStorage(new IDBFactory());
  await store.add('th06','<script>','06.dat',bytes);
  const model=api.createSaveLibrary({storage:store,read:async()=>({bytes,edition:null,modified:0})});
  const target=env.document.createElement('main');env.document.body.append(target);root=createRoot(target);
  await React.act(async()=>{root.render(React.createElement(api.LocaleProvider,{locale:'en'},React.createElement(api.SaveLibraryPanel,{model,product:'th06',language:'ja',active:true})));});
  await React.act(async()=>{await settled(model);});
  assert.equal(env.document.querySelectorAll('script').length,0);assert.equal(env.document.querySelector('.file-name-action'),null);assert.equal(env.document.querySelector('.save-library-entry .file-library-name').textContent,'<script>');assert.equal(env.document.querySelectorAll('.save-library-match').length,0);
  await React.act(async()=>env.document.querySelector('.save-library-entry .file-library-name').click());assert.equal(env.document.querySelector('form input'),null);
  await React.act(async()=>{root.render(React.createElement(api.LocaleProvider,{locale:'en'},React.createElement(api.SaveLibraryPanel,{model,product:'th06',language:'ja',active:false})));});assert.equal(model.getSnapshot().phase,'idle');model.dispose();
});
test('backup exports distinguish pre-launch game bytes from the original archive bytes',async()=>{
  const store=api.createSaveLibraryStorage(new IDBFactory()), before=new Uint8Array(score6('BEFORE')), original=new Uint8Array(score6('ARCHIVE'));
  const added=await store.add('th06','Selected','slot.dat',original);await store.choose('th06',added.archive.id);
  const started=await store.begin('th06',added.archive.id,before,null), output=[];
  const model=api.createSaveLibrary({storage:store,read:async()=>null,download:(name,buffer)=>output.push({name,bytes:new Uint8Array(buffer)})});
  model.select('th06','ja');await settled(model);model.downloadBackup(started.run.id);model.downloadBackup(started.run.id,'archive');
  assert.deepEqual(output[0].bytes,before);assert.deepEqual(output[1].bytes,original);assert.equal(output[0].name.includes('-before-'),true);assert.equal(output[1].name.includes('-archive-'),true);model.dispose();
});


test('archive deletion is scoped, clears the selected binding and retains independent backups',async()=>{
 const store=api.createSaveLibraryStorage(new IDBFactory()),a=await store.add('th06','A','a.dat',score6('A')),b=await store.add('th06','B','b.dat',score6('B'));
 await store.choose('th06',a.archive.id);await assert.rejects(store.remove('th07',a.archive.id),error=>error.code==='missing');
 await store.remove('th06',b.archive.id);assert.equal((await store.state('th06')).selectedId,a.archive.id);
 const started=await store.begin('th06',a.archive.id,new Uint8Array(score6('Native')),null);await assert.rejects(store.remove('th06',a.archive.id),error=>error.code==='pending');
 await store.complete('th06',started.run.id,null);await store.remove('th06',a.archive.id);assert.equal((await store.list('th06')).length,0);assert.equal((await store.state('th06')).selectedId,null);
 assert.equal((await store.backups('th06')).length,1);assert.deepEqual((await store.backup('th06',started.run.id)).archiveBytes,a.archive.bytes);
 await store.add('th06','New','new.dat',score6('New'));assert.equal((await store.state('th06')).selectedId,null,'a new import cannot reactivate a removed launch choice');
});
test('deletion and native application contend in the same binding transaction',async()=>{
 const store=api.createSaveLibraryStorage(new IDBFactory()),a=await store.add('th06','A','a.dat',score6());await store.choose('th06',a.archive.id);
 const results=await Promise.allSettled([store.begin('th06',a.archive.id,null,null),store.remove('th06',a.archive.id)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'pending');assert.equal((await store.list('th06')).length,1);
});
