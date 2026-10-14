/** Mounted workspace with real save/replay models and synthetic file ports.
 * No browser geometry, native game, or durable user-data claims. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {score6} from './save-library-fixtures.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, api, React, createRoot, createMemoryRouter, RouterProvider, work, mounted;
before(async()=>{
 env=installMountedDom(); React=await import('react'); ({createRoot}=await import('react-dom/client')); ({createMemoryRouter,RouterProvider}=await import('react-router'));
 work=await mkdtemp(resolve(project,'.cache/files-workspace-test-'));const output=resolve(work,'workspace.mjs');
 await build({stdin:{contents:`export {FilesWorkspace} from './app/components/launcher/FilesWorkspace.tsx'; export {createSaveLibrary} from './app/models/save-library.ts'; export {createSaveLibraryStorage} from './app/services/save-library.ts'; export {createReplayModel} from './app/models/replays.ts'; export {LocaleProvider,translate} from './app/i18n.tsx'; export {SurfaceNavigationProvider,useSurfaceNavigation} from './app/navigation/surface-navigation.tsx';`,resolveDir:project,loader:'tsx'},outfile:output,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
 api=await import(pathToFileURL(output).href);
});
afterEach(async()=>{if(mounted){const current=mounted;mounted=null;await React.act(async()=>current.root.unmount());current.router.dispose();current.save.dispose();current.replays.dispose();}env.document.body.replaceChildren();assert.deepEqual(env.errors,[]);});
after(async()=>{env.close();await rm(work,{recursive:true,force:true});});
async function tick(){await React.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});}
async function until(predicate){for(let i=0;i<80&&!predicate();i++)await tick();assert.ok(predicate());}
const n=selector=>{const el=env.document.querySelector(selector);assert.ok(el,selector);return el;};
async function click(selector){await React.act(async()=>n(selector).click());await tick();}
function Fixture({f}){
 const navigation=api.useSurfaceNavigation();
 return navigation.infoDialogOpen('scoreFilesDialog')?React.createElement(api.FilesWorkspace,{product:f.product,language:'ja',saveLibrary:f.save,replays:f.replays,replayActions:f.replayActions,actions:f.actions}):React.createElement('button',{id:'fixtureOpen',onClick:()=>navigation.openInfoDialog('scoreFilesDialog')},'Open files');
}
async function mount({product='th06',many=false,broken=false,gate=null}={}){
 const downloads=[],events=[],errors=[],fileActions=[],imports=[],decisions=[];let confirmed=false;
 const files=new Map([['replay/th6_01.rpy',[4,5]],['score.dat',[8]]]);if(many)for(let i=2;i<=60;i++)files.set(`replay/th6_${String(i).padStart(2,'0')}.rpy`,[i]);
 const runtimeState={ready:false,epoch:null,launched:false,game:'th06'};
 const store=api.createSaveLibraryStorage(new IDBFactory());if(product==='th06')await store.add('th06','Archive','imported.dat',new Uint8Array(score6()));
 const save=api.createSaveLibrary({storage:store,read:async()=>({bytes:new Uint8Array(score6()),edition:null,modified:1}),download:(name,bytes)=>downloads.push({name,bytes:[...new Uint8Array(bytes)]})});
 const replays=api.createReplayModel({runtime:{getSnapshot:()=>runtimeState,async withFileSession(game,operation){return operation({epoch:7,async sync(){events.push('sync');},async send(command,payload){events.push(command);if(gate&&command==='list')await gate.promise;if(broken)throw Error('read failed');if(command==='list')return {files:[...files].map(([path,bytes])=>({path,size:bytes.length}))};if(command==='read')return {bytes:files.get(payload.path)};return {};}});}},async prepareFiles(){events.push('prepare');runtimeState.ready=true;runtimeState.epoch=7;},async releasePrepared(p,epoch){events.push(`release:${p}:${epoch}`);runtimeState.ready=false;runtimeState.epoch=null;},translate:(key,params)=>api.translate('en',key,params),prompt(){throw Error('unexpected rename');},async confirm(){throw Error('unexpected delete');},download:(name,bytes)=>downloads.push({name,bytes:[...new Uint8Array(bytes)]}),toast:message=>errors.push(message),async afterPaint(){},afterClose(){events.push('close');}});
 const f={product,save,replays,store,downloads,events,errors,fileActions,imports,files,decisions,confirm(value){confirmed=value;},actions:{async confirm(decision){decisions.push(decision);return confirmed;},async file(action,p){fileActions.push({action,product:p});},reportError:error=>errors.push(error.message)},replayActions:{async importFile(p){imports.push(p);await replays.mutations.run(async()=>files.set('replay/th6_99.rpy',[99]));await replays.refresh();},async dropFile(file,p){imports.push([file.name,p]);await replays.mutations.run(async()=>files.set('replay/th6_98.rpy',[98]));await replays.refresh();}}};
 const root=createRoot(env.document.body.appendChild(env.document.createElement('div')));
 const router=createMemoryRouter([{path:'*',element:React.createElement(api.LocaleProvider,{locale:'en'},React.createElement(api.SurfaceNavigationProvider,{dirty:false,isEditing:false,onDiscard(){}},React.createElement(Fixture,{f})))}],{initialEntries:[`/?game=${product}`]});
 mounted={...f,root,router};await React.act(async()=>root.render(React.createElement(RouterProvider,{router})));await click('#fixtureOpen');return mounted;
}

test('workspace lists current and archived saves plus only replay files, and each export uses its own bytes',async()=>{
 const f=await mount();await until(()=>f.save.getSnapshot().phase==='ready'&&f.replays.getSnapshot().phase==='ready');
 assert.equal(n('#scoreFilesDialog').tagName,'ASIDE');assert.equal(env.document.querySelectorAll('.file-library-scroll').length,2);assert.equal(env.document.querySelectorAll('.save-library-list>li').length,2);assert.equal(env.document.querySelectorAll('.replay-library .file-library-row').length,1);
 await click('.save-library-entry .save-library-download');assert.deepEqual(f.downloads[0].bytes,[...new Uint8Array(score6())]);
 await click('.replay-library .file-library-row button');assert.deepEqual(f.downloads[1],{name:'th6_01.rpy',bytes:[4,5]});
 assert.equal(f.files.has('score.dat'),true);assert.equal(f.events.includes('write'),false);
 await click('#scoreFilesClose');await until(()=>f.events.includes('release:th06:7'));assert.equal(f.replays.getSnapshot().open,false);assert.equal(n('#fixtureOpen').textContent,'Open files');
});
test('many replay rows stay in their own scroll region; import refreshes only replay files',async()=>{
 const f=await mount({many:true});await until(()=>f.replays.getSnapshot().phase==='ready'&&f.save.getSnapshot().phase==='ready');
 const saves=n('.save-library-scroll'),before=f.save.getSnapshot().entries;
 assert.equal(n('.replay-library-scroll').querySelectorAll('li').length,60);assert.equal(saves.querySelectorAll('li').length,2);
 await click('[data-action="import-replay"]');assert.deepEqual(f.imports,['th06']);assert.equal(n('.replay-library-scroll').querySelectorAll('li').length,61);assert.equal(n('.save-library-scroll'),saves);assert.deepEqual(f.save.getSnapshot().entries,before);
});
test('invalid replay drop reports an error without changing the file list',async()=>{
 const f=await mount();await until(()=>f.replays.getSnapshot().phase==='ready');const panel=n('.replay-library'),event=new env.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[{name:'bad.dat'}]}});
 await React.act(async()=>panel.dispatchEvent(event));await tick();assert.equal(f.imports.length,0);assert.equal(f.files.size,2);assert.equal(f.errors.length,1);assert.equal(f.replays.getSnapshot().rows.length,1);
});
test('closing a pending replay read releases only its original owner and leaves no stale error',async()=>{
 let release;const gate={promise:new Promise(resolve=>{release=resolve;})};const f=await mount({gate});await until(()=>f.save.getSnapshot().phase==='ready'&&f.events.includes('list'));
 assert.equal(n('.replay-library [data-action="import-replay"]').disabled,true);assert.equal(n('.save-library-entry .save-library-download').disabled,false);
 await click('#scoreFilesClose');assert.equal(f.replays.getSnapshot().open,false);await React.act(async()=>release());await until(()=>f.events.includes('release:th06:7'));assert.equal(env.document.querySelector('.files-workspace'),null);assert.deepEqual(f.errors,[]);
});
test('replay read failure keeps save exports available and offers a local retry',async()=>{
 const f=await mount({broken:true});await until(()=>f.replays.getSnapshot().phase==='error'&&f.save.getSnapshot().phase==='ready');
 assert.equal(n('.save-library-entry .save-library-download').disabled,false);
 assert.equal(n('.replay-library .file-library-empty button').textContent,'Retry');
 assert.deepEqual(f.errors,['read failed']);assert.equal(f.replays.getSnapshot().rows.length,0);
});
test('unsupported archive titles retain original native save import and export actions',async()=>{
 const f=await mount({product:'th11'});await until(()=>f.save.getSnapshot().phase==='unsupported');
 await click('[data-action="import-save"]');await click('[data-action="export-save"]');assert.deepEqual(f.fileActions,[{action:'import-save',product:'th11'},{action:'export-save',product:'th11'}]);assert.equal(n('#saveLibraryTitle').textContent,'Save');
});


test('archive delete asks once, cancellation preserves data, and confirmation removes only the copy',async()=>{
 const f=await mount();await until(()=>f.save.getSnapshot().phase==='ready'&&f.replays.getSnapshot().phase==='ready');
 const original=f.save.getSnapshot().entries[0],native=f.save.getSnapshot().current.bytes;await click('.save-library-entry .file-delete-action');assert.equal(f.decisions.length,1);assert.equal(f.decisions[0].tone,'danger');assert.equal(f.save.getSnapshot().entries.length,1);
 f.confirm(true);await click('.save-library-entry .file-delete-action');await until(()=>f.save.getSnapshot().entries.length===0);assert.equal((await f.store.state('th06')).selectedId,null);assert.deepEqual(f.save.getSnapshot().current.bytes,native);assert.equal(n('[data-native-save] .file-library-name').textContent,'Native save');assert.equal(f.files.has('score.dat'),true);assert.equal(f.files.has('replay/th6_01.rpy'),true);assert.equal((await f.store.list('th06')).some(row=>row.id===original.id),false);
});
test('all save names remain fixed when clicked, while export and native-clear actions remain available',async()=>{
 const f=await mount();await until(()=>f.save.getSnapshot().phase==='ready');const bytes=f.save.getSnapshot().entries[0].bytes;
 await click('[data-native-save] .file-library-name');await click('.save-library-entry .file-library-name');await click('.save-library-entry');
 assert.equal(env.document.querySelector('.file-name-action'),null);assert.equal(env.document.querySelector('.save-library-rename'),null);assert.equal(f.save.getSnapshot().entries[0].name,'Archive');assert.equal(n('.save-library-entry .file-library-name').getAttribute('title'),'Archive');assert.deepEqual(f.save.getSnapshot().entries[0].bytes,bytes);
 await click('.save-library-entry .save-library-download');assert.deepEqual(f.downloads[0].bytes,[...bytes]);
 await click('[data-action="clear-save"]');assert.deepEqual(f.fileActions,[{action:'clear-save',product:'th06'}]);assert.equal(n('[data-native-save] .file-library-name').textContent,'Native save');
});
