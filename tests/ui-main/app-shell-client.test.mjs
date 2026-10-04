import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createUiDeploymentContract} from '../../scripts/ui-deployment-contract.mjs';
const folder=await mkdtemp(join(tmpdir(),'ui-shell-client-'));after(()=>rm(folder,{recursive:true,force:true}));
const bundled=await build({stdin:{contents:"export * from './app/services/app-shell.client.ts'; export {createAppShellClient} from './src/launcher/app-shell-client.mts';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false});
await writeFile(join(folder,'client.mjs'),bundled.outputFiles[0].text);
const {createUiAppShell,validateUiPublicationGate,uiShellActivityBlocks,createAppShellClient}=await import(pathToFileURL(join(folder,'client.mjs')).href);
const tick=()=>new Promise(done=>setImmediate(done));
function marker(mountPath='/'){return {schema:'eagler-touhou/ui-publication/1',status:'experimental-opt-in',mountPath,worker:'app-shell-sw.js',uiBuild:{sha256:'a'.repeat(64)},navigation:createUiDeploymentContract({patterns:['/','/play/:productId','/lobby'],mountPath})};}
class Worker extends EventTarget{state='activated';messages=[];constructor(scriptURL){super();this.scriptURL=scriptURL;}postMessage(message){this.messages.push(message); } setState(state){this.state=state;this.dispatchEvent(new Event('statechange'));}}
class Registration extends EventTarget{waiting=null;installing=null;updates=0;updateError=null;constructor(scope){super();this.scope=scope;this.active=new Worker(scope+'app-shell-sw.js');}async update(){this.updates++;if(this.updateError)throw this.updateError;}}
function fixture({mount='/',waiting=false,fetchImpl,existing,options={}}={}){
 const scope='https://example.test'+mount,registration=new Registration(scope),calls=[],requests=[],scheduled=[];let busy=false,reloads=0;
 if(waiting){registration.waiting=new Worker(scope+'app-shell-sw.js');registration.waiting.state='installed';}
 const container={controller:waiting?{scriptURL:scope+'app-shell-sw.js'}:null,async getRegistration(){return existing??registration;},async register(url,config){calls.push({url,config});return registration;}};
 const service=createUiAppShell({baseUrl:scope,documentUrl:scope+'play/th06',serviceWorker:container,secureContext:true,shouldDefer:()=>busy,readStatus:async()=>true,
  fetchImpl:fetchImpl??(async(input)=>{requests.push(String(input));return Response.json(marker(mount));}),reload:()=>reloads++,clientOptions:{activationRetryMs:0,schedule:callback=>scheduled.push(callback)},...options});
 return {service,container,registration,calls,requests,scheduled,setBusy:value=>busy=value,get reloads(){return reloads;}};
}
test('ordinary preview and missing opt-in marker never register a Service Worker',async()=>{
 for(const status of [404,410]){const f=fixture({fetchImpl:async()=>new Response('missing',{status})});await f.service.start();assert.equal(f.calls.length,0);assert.equal(f.service.getSnapshot().phase,'disabled');f.service.dispose();}
});
test('same-origin root and nested marker scopes must match actual document and navigation',()=>{
 for(const mount of ['/','/launcher/']){const baseUrl='https://example.test'+mount;assert.equal(validateUiPublicationGate(marker(mount),{baseUrl,documentUrl:baseUrl+'play/th06'}).workerUrl,baseUrl+'app-shell-sw.js');}
 for(const patch of [{status:'production'},{mountPath:'/elsewhere/'},{worker:'https://other.test/sw.js'},{uiBuild:{sha256:'invalid'}},{navigation:createUiDeploymentContract({patterns:['/'],mountPath:'/other/'})}])assert.throws(()=>validateUiPublicationGate({...marker(),...patch},{baseUrl:'https://example.test/',documentUrl:'https://example.test/play/th06'}));
 for(const baseUrl of ['https://other.test/','https://example.test/launcher','https://user@example.test/','https://example.test/?x=1'])assert.throws(()=>validateUiPublicationGate(marker(),{baseUrl,documentUrl:'https://example.test/play/th06'}));
});
test('invalid JSON, redirects, unsupported context and conflicting worker never claim a scope',async()=>{
 for(const response of [new Response('<html>',{headers:{'content-type':'text/html'}}),Response.json({...marker(),worker:'other-sw.js'}),new Response('down',{status:503})]){const f=fixture({fetchImpl:async()=>response});await f.service.start();assert.equal(f.calls.length,0);assert.equal(f.service.getSnapshot().phase,'error');f.service.dispose();}
 const unsupported=fixture({options:{secureContext:false}});await unsupported.service.start();assert.equal(unsupported.calls.length,0);assert.equal(unsupported.service.getSnapshot().phase,'unsupported');unsupported.service.dispose();
 const foreign=new Registration('https://example.test/');foreign.active.scriptURL='https://example.test/foreign-worker.js';const f=fixture({existing:foreign});await f.service.start();assert.equal(f.calls.length,0);assert.match(f.service.getSnapshot().error,/Another Service Worker/);f.service.dispose();
 let fetched=0;const cross=fixture({options:{baseUrl:'https://other.test/',fetchImpl:async()=>{fetched++;return Response.json(marker());}}});await cross.service.start();assert.equal(fetched,0);cross.service.dispose();
});
test('valid nested first install is idempotent, verifies offline status and permits a parent controller without claiming it',async()=>{
 const f=fixture({mount:'/launcher/',existing:new Registration('https://example.test/')});await Promise.all([f.service.start(),f.service.start()]);
 assert.deepEqual(f.calls,[{url:'https://example.test/launcher/app-shell-sw.js',config:{scope:'https://example.test/launcher/',updateViaCache:'none'}}]);
 assert.equal(f.service.getSnapshot().offlineReady,true);assert.equal(f.service.getSnapshot().phase,'ready');assert.equal(f.registration.updates,0);f.service.dispose();
});
test('existing owner defers update while busy and rechecks before activation and scheduled reload',async()=>{
 const f=fixture({waiting:true});f.setBusy(true);await f.service.start();assert.equal(f.registration.waiting.messages.length,0);assert.equal(f.service.getSnapshot().client.updateWaiting,true);
 f.setBusy(false);f.service.activityChanged();f.setBusy(true);await tick();assert.equal(f.registration.waiting.messages.length,0,'activity starts before activation microtask');
 f.setBusy(false);f.service.activityChanged();await tick();assert.equal(f.registration.waiting.messages.length,1);assert.equal(f.registration.waiting.messages[0].type,'ACTIVATE_APP_SHELL');
 f.registration.waiting.setState('activated');assert.equal(f.scheduled.length,1);f.setBusy(true);f.scheduled.shift()();assert.equal(f.reloads,0,'activity starts before reload task');
 f.setBusy(false);f.service.activityChanged();f.scheduled.shift()();assert.equal(f.reloads,1);f.service.dispose();
});
test('all explicit activity ports block; idle/background metadata does not',()=>{
 assert.equal(uiShellActivityBlocks({runtime:{epoch:null,ready:false,phase:'idle'}}),false);
 for(const activity of [{runtime:{epoch:5}},{runtime:{ready:true}},{runtime:{launched:true}},{runtime:{saveError:'write failed'}},{runtime:{fileOperationBusy:true}},{runtime:{phase:'loading'}},{operation:{}},{importOperation:{}},{importReview:{}},{preparing:true},{downloading:true},{room:{}},{dirtyDrafts:1},{decisionOpen:true},{filePickerOpen:true}])assert.equal(uiShellActivityBlocks(activity),true,JSON.stringify(activity));
});
test('offline update errors preserve cached-ready truth, recovery verifies status, incomplete installation is not labelled ready',async()=>{
 const f=fixture();await f.service.start();f.registration.updateError=Error('offline');assert.equal(await f.service.checkForUpdate(),false);assert.equal(f.service.getSnapshot().offlineReady,true);assert.match(f.service.getSnapshot().error,/offline/);
 f.registration.updateError=null;assert.equal(await f.service.checkForUpdate(),true);assert.equal(f.service.getSnapshot().error,null);f.service.dispose();
 const missing=fixture({options:{readStatus:async()=>false}});await missing.service.start();assert.equal(missing.service.getSnapshot().offlineReady,false);assert.equal(missing.service.getSnapshot().phase,'error');missing.service.dispose();
});
test('suspend and disposal fence stale marker continuations, activation events and scheduled reloads',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),f=fixture({fetchImpl:()=>pending});const start=f.service.start();f.service.dispose();resolve(Response.json(marker()));await start;assert.equal(f.calls.length,0);
 const live=fixture({waiting:true});live.service.suspend();await live.service.start();assert.equal(live.registration.waiting.messages.length,0);live.service.resume();await tick();live.registration.waiting.setState('activated');live.service.dispose();for(const callback of live.scheduled)callback();assert.equal(live.reloads,0);
});
test('sole app-shell owner disposal removes worker and registration listeners and first-install waiter',async()=>{
 const registration=new Registration('https://example.test/');registration.active=null;registration.installing=new Worker('https://example.test/app-shell-sw.js');registration.installing.state='installing';
 let notifications=0;const client=createAppShellClient({serviceWorker:{controller:null,async register(){return registration;},async getRegistration(){return registration;}},secureContext:true,onChange:()=>notifications++,activationTimeoutMs:60000});
 await tick();client.dispose();await client.ready;const before=notifications;registration.installing.setState('activated');registration.dispatchEvent(new Event('updatefound'));assert.equal(notifications,before);assert.equal(await client.maybeActivateWaiting(),false);assert.equal(client.maybeReload(),false);
});

test('marker artwork stays catalog-owned and mounted; origin migration exposes only the existing supported policy',()=>{
 const baseUrl='https://example.test/launcher/',documentUrl=baseUrl+'play/th06';
 const input={...marker('/launcher/'),artwork:{th07:{path:'assets/th07-card.webp',bytes:12,sha256:'b'.repeat(64)}},originMigration:{mode:'http-to-https'}};
 const gate=validateUiPublicationGate(input,{baseUrl,documentUrl});assert.equal(gate.artwork.th07,baseUrl+'assets/th07-card.webp');assert.deepEqual(gate.originMigration,{mode:'http-to-https'});
 for(const path of ['https://elsewhere.test/card.webp','/assets/th07-card.webp','assets/other.webp','../assets/th07-card.webp'])assert.throws(()=>validateUiPublicationGate({...input,artwork:{th07:{...input.artwork.th07,path}}},{baseUrl,documentUrl}),/catalog-owned/);
 for(const policy of [{mode:'other'},{mode:'http-to-https',url:'https://other.test'},[]])assert.throws(()=>validateUiPublicationGate({...input,originMigration:policy},{baseUrl,documentUrl}),/migration policy/);
});
