import {finalizeUiArtifact} from '../scripts/finalize-ui-artifact.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import vm from 'node:vm';
import {once} from 'node:events';
import {assembleUiPublication, uiNginxNavigation} from '../lib/ui-publication.mjs';
import {verifyReleaseManifest} from '../lib/release-manifest.mjs';
import {createSyntheticPublicationBase,put,files} from './publication/fixtures.mjs';
import {createUiServer} from '../scripts/serve-ui.mjs';
import routes from '../app/routes.ts';
import {navigationPatterns} from '../scripts/ui-routing.mjs';
import {buildCurrentProtocolFixture,protocolFixtureScript} from './support/build-current-protocol-fixture.mjs';
import {buildPackageBrowserFixture} from './support/build-package-browser-fixture.mjs';
import {ensureCachedUiArtifact} from '../lib/ui-build.mjs';
import './publication/fixture-servers.test.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const html = '<!DOCTYPE html><html><head><link rel="modulepreload" href="/assets/manifest-12345678.js"><script type="module" src="/assets/entry-12345678.js"></script></head><body><main>React fixture</main><script>window.__reactRouterContext = {"basename":"/","isSpaMode":true};</script></body></html>';
async function fixture(t, mode='hosted') {
  const root=await mkdtemp(join(tmpdir(),'eagler-ui-publication-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const {source,current}=await createSyntheticPublicationBase(root,mode),ui=join(root,'ui'),output=join(root,'output');
  await put(ui,'index.html',html);await put(ui,'assets/entry-12345678.js','export const ready = true;');
  await put(ui,'assets/manifest-12345678.js','window.__reactRouterManifest = {};');
  await put(ui,'content/FIRST_USE_NOTICE.html','synthetic notice');await put(ui,'NOTICE.txt','synthetic license');
  await put(ui,'ui-ownership.json',json({schema:'eagler-touhou/ui-ownership/1',legacyLauncherIncluded:false,nodeBuiltinsIncluded:false,assets:['assets/entry-12345678.js'],chunks:['assets/entry-12345678.js']}));
  await put(ui,'ui-build.json',json({schema:'eagler-touhou/ui-build/1',mountPath:'/'}));
  await put(ui,'ui-navigation.json',json({schema:'eagler-touhou/ui-navigation/1',patterns:navigationPatterns(routes)}));
  return {root,source,ui,output,current,assemble:async options=>{if(!options?.uiRoot)await finalizeUiArtifact(ui);return assembleUiPublication({sourceRoot:source,uiRoot:ui,outputRoot:output,...options});}};
}
class MemoryCache {
  entries=new Map(); key(input){return typeof input==='string'?input:input.url;}
  async put(input,response){this.entries.set(this.key(input),response.clone());}
  async match(input){return this.entries.get(this.key(input))?.clone();}
  async keys(){return [...this.entries.keys()].map(url=>new Request(url));}
}
async function worker(root,{stores=new Map(),offline=false,corrupt=false,scope='https://fixture.test/'}={}) {
  const events=new Map(),requests=[];let skipped=0,claimed=0;
  const caches={async keys(){return [...stores.keys()];},async open(name){if(!stores.has(name))stores.set(name,new MemoryCache());return stores.get(name);},async delete(name){return stores.delete(name);}};
  const self={registration:{scope},addEventListener(type,callback){events.set(type,callback);},async skipWaiting(){skipped++;},clients:{async claim(){claimed++;},async matchAll(){return [];}}};
  vm.runInNewContext(await readFile(join(root,'app-shell-sw.js'),'utf8'),{self,caches,URL,Request,Response,Date,Promise,console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,Uint8Array,TextEncoder,Map,Set,
    fetch:async request=>{requests.push(request.url);if(offline)throw Error('offline');const path=new URL(request.url).pathname.slice(new URL(scope).pathname.length)||'index.html';try {const bytes=await readFile(join(root,path));return new Response(corrupt && path.endsWith('.js')?'corrupt':bytes);}catch{return new Response('not found',{status:404});}}});
  async function lifecycle(type){let task;events.get(type)({waitUntil(value){task=value;}});await task;}
  async function request(path,headers={Accept:'text/html'}){let task;events.get('fetch')({request:new Request(new URL(path,scope),{headers}),respondWith(value){task=value;}});return task?await task:null;}
  async function message(data){let task,result;events.get('message')({data,ports:[{postMessage(value){result=value;}}],waitUntil(value){task=value;}});await task;return result;}
  return {stores,caches,requests,lifecycle,request,message,forced:()=>({skipped,claimed})};
}

test('opt-in staged assembly preserves data, immutable Runtime and legacy source; aliases and Framework manifest are offline',async t=>{
  const f=await fixture(t),before=await files(f.source),result=await f.assemble();
  assert.deepEqual(await files(f.source),before,'input and rollback source remain byte-identical');
  assert.equal(result.publication.status,'experimental-opt-in');
  assert.equal(result.publication.artwork.th07.path,'assets/th07-card.webp');
  assert.ok(result.publication.appShell.entries.includes('assets/th07-card.webp'));
  assert.ok(result.publication.appShell.entries.includes('ui-publication.json'));
  assert.ok(result.publication.appShell.entries.includes('assets/manifest-12345678.js'),'late Framework manifest is included despite ownership snapshot omission');
  for(const path of ['runtime-manifest.json','host-manifest.json','release-catalog.json','th06.package.json','games/th06/th06.data','shared/unifont.otf','app.js','legacy-mount-retirement-sw.js']) assert.deepEqual(await readFile(join(f.output,path)),await readFile(join(f.source,path)),path);
  for(const path of ['index.html','en.html','lobby.html']) assert.equal(await readFile(join(f.output,path),'utf8'),html);
  for(const path of result.publication.appShell.entries) assert.doesNotMatch(path,/^(runtime\/|games\/|shared\/|packages\/|host-manifest\.json|runtime-manifest\.json|release-catalog\.json|th06\.package\.json|app\.js$)/);
  await verifyReleaseManifest(f.output);
  const sw=await worker(f.output);await sw.lifecycle('install');await sw.lifecycle('activate');
  assert.deepEqual(sw.forced(),{skipped:0,claimed:0});
  assert.equal(sw.requests.some(url=>url.includes('/runtime/')),false,'shell install does not prepare Runtime');
  const offline=await worker(f.output,{stores:sw.stores,offline:true});
  for(const path of ['play/th06','play/th06/resources','play/th06/replays','play/th06/saves','lobby','en.html?game=th06','lobby.html']) assert.match(await (await offline.request(path)).text(),/React fixture/,path);
  for(const path of ['games/th06','games/th06/missing.data','shared/missing.otf','assets/missing.js','play/th06/missing.wasm','host-manifest.json','unknown']) assert.equal(await offline.request(path),null,path);
  assert.equal(await offline.request('play/th06',{Accept:'application/json'}),null);
  assert.equal((await offline.message({type:'GET_RUNTIME_GENERATION_CAPABILITIES'})).ok,true,'the same worker retains Runtime protocol');
  assert.equal((await offline.message({type:'ACTIVATE_APP_SHELL'})).ok,true);assert.equal(offline.forced().skipped,1);
});

test('generated worker update integrity failure preserves old shell, Package cache and existing Runtime cache',async t=>{
  const f=await fixture(t);await f.assemble();const old=await worker(f.output);await old.lifecycle('install');
  const packageCache=await old.caches.open('eagler-package-fixture');await packageCache.put('https://fixture.test/save',new Response('do not delete'));
  const runtimeCache=await old.caches.open('eagler-touhou-runtime-v2-%2F-existing');await runtimeCache.put('https://fixture.test/runtime-sentinel',new Response('do not delete'));
  await put(f.ui,'assets/entry-12345678.js','export const ready = "replacement";');
  const nextRoot=join(f.root,'next');await f.assemble({outputRoot:nextRoot});
  const before=[...old.stores.keys()].sort(),bad=await worker(nextRoot,{stores:old.stores,corrupt:true});
  await assert.rejects(bad.lifecycle('install'),/integrity mismatch/);assert.deepEqual([...old.stores.keys()].sort(),before);
  assert.match(await (await old.request('play/th06')).text(),/React fixture/);
  const next=await worker(nextRoot,{stores:old.stores});await next.lifecycle('install');await next.lifecycle('activate');
  assert.deepEqual(next.forced(),{skipped:0,claimed:0});
  assert.equal(await (await packageCache.match('https://fixture.test/save')).text(),'do not delete');
  assert.equal(await (await runtimeCache.match('https://fixture.test/runtime-sentinel')).text(),'do not delete');
  assert.match(await (await old.request('assets/entry-12345678.js')).text(),/ready = true/,'prior worker retains its own bytes');
});

test('HTTP publication serves deep links/aliases and preserves 404 plus Runtime ranges',async t=>{
  const f=await fixture(t);await f.assemble();const server=await createUiServer({root:f.output});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(done=>server.close(done)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/play/th06','/play/th06/saves','/en.html','/lobby.html']){const response=await fetch(base+path,{headers:{Accept:'text/html'}});assert.equal(response.status,200);assert.match(await response.text(),/React fixture/);}
  for(const path of ['/games/th06/missing.data','/assets/missing.js','/play/th06/missing.wasm','/unknown','/ui-ownership.json']){const response=await fetch(base+path,{headers:{Accept:'text/html'}});assert.equal(response.status,404,path);assert.doesNotMatch(await response.text(),/React fixture/);}
  const wasm=await fetch(`${base}/runtime/th06/${f.current.generation}/th06.wasm`,{headers:{Range:'bytes=0-3'}});assert.equal(wasm.status,206);assert.equal(await wasm.text(),'synt');
});

test('external publication leaves redirect-owned routes absent and generates bounded nginx navigation',async t=>{
  const f=await fixture(t,'external'),result=await f.assemble();
  assert.equal((await files(f.output)).some(file=>/^(games|shared)\//.test(file.path)),false);
  const sw=await worker(f.output);await sw.lifecycle('install');
  assert.equal(await sw.request('/games/th06/th06.data?v=fixture'),null);assert.equal(await sw.request('/shared/unifont.otf'),null);
  assert.match(result.nginxNavigation,/play\/\[A-Za-z0-9_-\]\+/);
  assert.doesNotMatch(result.nginxNavigation,/location[^\n]*games|location[^\n]*shared|try_files \$uri \$uri\/ \/index/);
  assert.match(uiNginxNavigation({...result.publication.navigation,mountPath:'/nested/'}),/try_files \$uri \/nested\/index.html/);
});

test('assembly rejects mismatched mounts, path collisions, symlinks, extra resource owners and incomplete SPA inputs',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.assemble({mountPath:'/nested/'}),/mount metadata/);
  await assert.rejects(f.assemble({outputRoot:f.source}),/separate/);
  await assert.rejects(f.assemble({outputRoot:join(f.source,'nested')}),/separate/);
  await put(f.ui,'games/th06/data','synthetic');await assert.rejects(f.assemble(),/Unexpected UI artifact owner/);await rm(join(f.ui,'games'),{recursive:true});
  await put(f.ui,'assets/host-card.webp','changed artwork');await assert.rejects(f.assemble(),/collides/);await rm(join(f.ui,'assets/host-card.webp'));
  await symlink(join(f.source,'host-manifest.json'),join(f.ui,'assets/escape.json'));await assert.rejects(f.assemble(),/ordinary files/);await rm(join(f.ui,'assets/escape.json'));
  await rm(join(f.ui,'assets/manifest-12345678.js'));await assert.rejects(f.assemble(),/Missing Framework asset/);
});


test('nested publication requires matching actual Framework basename/assets and scopes offline navigation',async t=>{
  const f=await fixture(t),mountPath='/nested-launcher/';
  const nestedHtml=html.replaceAll('/assets/',mountPath+'assets/').replace('"basename":"/"',`"basename":"${mountPath}"`);
  await put(f.ui,'ui-build.json',json({schema:'eagler-touhou/ui-build/1',mountPath}));
  await assert.rejects(f.assemble({mountPath}),/Framework HTML/);
  await put(f.ui,'index.html',nestedHtml);
  const result=await f.assemble({mountPath});
  assert.equal(result.publication.mountPath,mountPath);
  const sw=await worker(f.output,{scope:'https://fixture.test'+mountPath});await sw.lifecycle('install');
  for(const path of ['play/th06','lobby','en.html']) assert.match(await (await sw.request(path)).text(),/React fixture/);
  for(const path of ['/play/th06','/nested-launcher-other/play/th06','/nested-launcher/games/th06/missing.data']) assert.equal(await sw.request(path),null,path);
  assert.equal(sw.requests.every(url=>new URL(url).pathname.startsWith(mountPath)),true);
});

test('real Framework artifact can be assembled without omitting late manifest or root/nested asset references', {skip:!process.env.EAGLER_UI_FRAMEWORK_ARTIFACT}, async t=>{
  const f=await fixture(t),uiRoot=process.env.EAGLER_UI_FRAMEWORK_ARTIFACT,mountPath=process.env.EAGLER_UI_MOUNT_PATH || '/';
  const result=await f.assemble({uiRoot,mountPath});
  const built=await readFile(join(uiRoot,'index.html'),'utf8');
  assert.equal(await readFile(join(f.output,'index.html'),'utf8'),built);
  assert.ok(result.publication.appShell.entries.some(path=>/^assets\/manifest-.*\.js$/.test(path)));
  const sw=await worker(f.output,{scope:'https://fixture.test'+mountPath});await sw.lifecycle('install');
  const offline=await worker(f.output,{stores:sw.stores,offline:true,scope:'https://fixture.test'+mountPath});
  for(const path of ['play/th06','play/th06/resources','en.html?game=th06']) assert.equal(await (await offline.request(path)).text(),built);
  assert.equal(sw.requests.every(url=>new URL(url).pathname.startsWith(mountPath)),true);
  const server=await createUiServer({root:f.output});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['play/th06','play/th06/resources','en.html']) {
    const response=await fetch(origin+mountPath+path,{headers:{Accept:'text/html'}});
    assert.equal(response.status,200,path);assert.equal(await response.text(),built);
  }
  for(const match of built.matchAll(/(?:src|href)="([^"#]+)(?:#[^"]*)?"/g)) if(match[1].startsWith(mountPath+'assets/')) {
    const response=await fetch(origin+match[1]);assert.equal(response.status,200,match[1]);
    assert.doesNotMatch(response.headers.get('content-type') || '',/text\/html/);
  }
  for(const path of ['assets/missing.js','play/th06/missing.wasm','games/th06/missing.data']) assert.equal((await fetch(origin+mountPath+path,{headers:{Accept:'text/html'}})).status,404,path);
  if(mountPath!=='/') assert.equal((await fetch(origin+'/play/th06',{headers:{Accept:'text/html'}})).status,404);
});

test('shared build config validates mount syntax and preserves root defaults',async()=>{
  const {uiBuildConfig,normalizeUiBuildMountPath}=await import('../scripts/ui-build-config.mjs');
  assert.equal(uiBuildConfig({}).mountPath,'/');assert.equal(uiBuildConfig({}).buildDirectory,'.cache/build/ui-main');
  const nested=uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/nested-launcher/'});
  assert.notEqual(nested.buildDirectory,uiBuildConfig({}).buildDirectory,'mount-only CI imports cannot overwrite root output');
  assert.equal(nested.buildDirectory,uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/nested-launcher'}).buildDirectory);
  assert.notEqual(nested.buildDirectory,uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/nested/launcher/'}).buildDirectory);
  assert.notEqual(uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/a__b/'}).buildDirectory,uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/a/b/'}).buildDirectory);
  assert.equal(uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/nested-launcher/',EAGLER_UI_BUILD_DIRECTORY:'.cache/build/ui-main-nested'}).buildDirectory,'.cache/build/ui-main-nested');
  assert.equal(uiBuildConfig({EAGLER_UI_MOUNT_PATH:'/nested/app',EAGLER_UI_BUILD_DIRECTORY:'.cache/nested'}).mountPath,'/nested/app/');
  for(const value of ['', 'relative', '//nested/', '/a/../b/', '/a%2fb/', '/a?b/', '/a";bad/', '/a\nb/']) assert.throws(()=>normalizeUiBuildMountPath(value),/safe absolute/);
});

test('sealed Framework input cannot silently change before candidate installation',async t=>{
 const f=await fixture(t);await finalizeUiArtifact(f.ui);
 const before=await files(f.source);
 await put(f.ui,'assets/entry-12345678.js','tampered after finalization');
 await assert.rejects(assembleUiPublication({sourceRoot:f.source,uiRoot:f.ui,outputRoot:f.output}),/changed after build/);
 assert.deepEqual(await files(f.source),before);
});

test('nested artifact rejects a basename-only rewrite with root-relative executable URLs',async t=>{
 const f=await fixture(t);
 await put(f.ui,'ui-build.json',json({schema:'eagler-touhou/ui-build/1',mountPath:'/nested/'}));
 await put(f.ui,'index.html',html.replace('"basename":"/"','"basename":"/nested/"'));
 await assert.rejects(finalizeUiArtifact(f.ui),/executable\/style URL/);
});

test('current browser fixture seals real publication identities while declaring synthetic protocol evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'current-protocol-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const output=join(root,'site');const fixture=await buildCurrentProtocolFixture({output,games:['th06','th09'],relay:'ws://127.0.0.1:21991/',ogg:false});
 assert.equal(fixture.nativeRuntime,false);
 const evidence=JSON.parse(await readFile(join(output,'protocol-fixture.json'),'utf8'));
 assert.equal(evidence.nativeRuntime,false);assert.equal(evidence.retailData,false);assert.equal(evidence.persistentSaveEvidence,false);
 await verifyReleaseManifest(output);
 await assert.rejects(buildCurrentProtocolFixture({output,games:['th06']}),/already exist/);
 await assert.rejects(buildCurrentProtocolFixture({output:join(root,'foreign'),games:['th06'],relay:'wss://relay.example/'}),/loopback/);
 for(const variant of ['normal','multiplayer']){
  const messages=[],handlers=new Map(),parent={postMessage:(message,origin)=>messages.push({message,origin})};
  const context={parent,location:{origin:'https://fixture.example',search:'?runtimeEpoch=4'},URLSearchParams,structuredClone,
   addEventListener:(name,handler)=>handlers.set(name,handler),setTimeout:callback=>callback()};
  vm.runInNewContext(protocolFixtureScript('th09',variant),context);
  assert.equal(context.__th09Runtime,undefined,'synthetic peer must never counterfeit a native Runtime probe');
  const send=(patch={},source=parent,origin='https://fixture.example')=>handlers.get('message')({source,origin,data:{protocol:'eagler-touhou/1',game:'th09',epoch:4,request:'r1',command:'configure',options:{music:'none'},...patch}});
  const before=messages.length;send({},{});send({},parent,'https://foreign.example');send({epoch:3});
  assert.equal(messages.length,before);assert.equal(context.__eaglerTestMessages.length,0);
  send();send({command:'launch'});assert.equal(context.__eaglerTestMessages.length,2);
  assert.ok(messages.some(({message})=>message.event==='first-frame'&&message.epoch===4));
  context.__eaglerSendStaleExit();context.__eaglerSendCurrentExit();
  assert.deepEqual(messages.filter(({message})=>message.event==='exit').map(({message})=>message.epoch),[3,4]);
  context.__eaglerTestRequestTitleRoom();assert.equal(messages.some(({message})=>message.event==='network-request'),variant==='normal');
 }
});

test('Package browser storage fixture publishes complete canonical modules without a development Host',async t=>{
 const root=await mkdtemp(join(tmpdir(),'current-package-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const result=await buildPackageBrowserFixture(join(root,'site'));
 for(const path of ['package/package-installer.mjs','package/package-launcher.mjs','package/package-store.mjs','assets/contracts/product-catalog.mjs','release-catalog.mjs'])assert.ok(result.modules.includes(path),path);
 for(const path of result.modules)assert.ok((await readFile(join(result.root,path))).length,path);
 assert.equal(result.modules.some(path=>/launcher\/(?:app|lobby)\.mjs|app\.js/.test(path)),false);
 await assert.rejects(readFile(join(result.root,'host-manifest.json')),{code:'ENOENT'});
});

async function writeFixtureMount(root,mountPath){
 await put(root,'ui-build.json',json({schema:'eagler-touhou/ui-build/1',mountPath}));
 await put(root,'index.html',html.replaceAll('/assets/',mountPath+'assets/').replace('"basename":"/"',`"basename":"${mountPath}"`));
 return finalizeUiArtifact(root);
}

test('source artifact cache requires matching input, state identity and sealed mount',async t=>{
 const f=await fixture(t),options={root:f.ui,mountPath:'/',lockRoot:join(f.root,'locks'),inputIdentity:async()=>'source-a'};
 let builds=0;
 const build=async()=>{builds++;await writeFixtureMount(f.ui,'/');};
 const first=await ensureCachedUiArtifact({...options,build});
 assert.equal((await ensureCachedUiArtifact({...options,build})).artifactId,first.artifactId);assert.equal(builds,1);
 await ensureCachedUiArtifact({...options,inputIdentity:async()=>'source-b',build});assert.equal(builds,2);
 // Reproduce a poisoned prior root output while the source-input hash matches.
 const nested=await writeFixtureMount(f.ui,'/nested-launcher/');
 await writeFile(join(f.ui,'../ui-build-state.json'),json({schema:'eagler-touhou/ui-build-state/1',inputs:'source-a',mountPath:'/',artifactId:nested.artifactId}));
 assert.equal((await ensureCachedUiArtifact({...options,build})).mountPath,'/');assert.equal(builds,3);
 await writeFile(join(f.ui,'../ui-build-state.json'),json({inputs:'source-a'}));
 await ensureCachedUiArtifact({...options,build});assert.equal(builds,4,'unscoped old cache state cannot prove a matching artifact');
 await assert.rejects(ensureCachedUiArtifact({...options,inputIdentity:async()=>'wrong-build',build:()=>writeFixtureMount(f.ui,'/nested-launcher/')}),/Built UI artifact mount differs/);
 assert.equal(JSON.parse(await readFile(join(f.ui,'../ui-build-state.json'),'utf8')).inputs,'source-a','failed build does not acknowledge new inputs');
});

test('source artifact cache serializes different mounts that explicitly share an output',async t=>{
 const f=await fixture(t);let active=0,maxActive=0;
 const artifacts=await Promise.all(['/','/nested-launcher/'].map(mountPath=>ensureCachedUiArtifact({root:f.ui,mountPath,lockRoot:join(f.root,'locks'),inputIdentity:async()=>'same-source',build:async()=>{
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(done=>setTimeout(done,30));await writeFixtureMount(f.ui,mountPath);active--;
 }})));
 assert.equal(maxActive,1,'lock ownership is the output path, not requested mount');
 assert.deepEqual(artifacts.map(artifact=>artifact.mountPath),['/','/nested-launcher/']);
 assert.deepEqual(await readdir(join(f.root,'locks')),[],'successful and failed builds release their output locks');
});

test('manual first-frame fixture controls only transport-free MP checks and cannot imply native evidence',()=>{
 for(const [variant,options,held] of [['normal',{},false],['multiplayer',{netplayMode:'lan'},false],['multiplayer',{replayViewer:true},false],['multiplayer',{multiplayerPreflight:true},true],['multiplayer',{},true]]){
  const observed=[],handlers=new Map(),parent={postMessage:message=>observed.push(message)};
  const context={parent,location:{origin:'https://fixture.example',search:'?runtimeEpoch=9'},URLSearchParams,structuredClone,
   addEventListener:(type,handler)=>handlers.set(type,handler),setTimeout:callback=>callback()};
  vm.runInNewContext(protocolFixtureScript('th08',variant,{manualPreflightFrame:true}),context);
  const send=command=>handlers.get('message')({source:parent,origin:'https://fixture.example',data:{protocol:'eagler-touhou/1',game:'th08',epoch:9,request:command,command,options}});
  send('configure');send('launch');
  assert.equal(observed.filter(message=>message.event==='first-frame').length,held?0:1,JSON.stringify({variant,options}));
  assert.equal(context.__th08Runtime,undefined,'controlled protocol peer never counterfeits native WASM identity');
  if(held){context.__eaglerSendStaleExit();context.__eaglerSendFirstFrame();context.__eaglerSendCurrentExit();
   assert.deepEqual(observed.filter(message=>['first-frame','exit'].includes(message.event)).map(message=>[message.event,message.epoch]),[['exit',8],['first-frame',9],['exit',9]]);}
 }
});
