/** Synthetic Host/Package acquisition and exact Replay Runtime ports only. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../..',import.meta.url));
const bundle=await build({stdin:{contents:`export * from './app/services/multiplayer-replay.client';
export {PRODUCT_GAMES} from './src/contracts/product-catalog.mts';
export {DEFAULT_GAME_OPTIONS} from './src/launcher/game-preferences.mts';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,
plugins:[{name:'sources',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{if(!args.path.startsWith('.'))return;const path=resolve(dirname(args.importer),args.path),facade=['product-catalog','release-catalog'].find(name=>path===resolve(root,`${name}.mjs`));if(facade)return{path:resolve(root,`src/contracts/${facade}.mts`)};const authored=path.replace(/\.mjs$/,'.mts');if(authored.startsWith(join(root,'src')+'/')&&existsSync(authored))return{path:authored};});}}]});
assert.doesNotMatch(bundle.outputFiles[0].text,/src\/launcher\/app\.mts|netplay-calibration-(?:report|connection)\.mts|node:/);
const folder=await mkdtemp(join(tmpdir(),'ui-mp-launch-'));after(()=>rm(folder,{recursive:true,force:true}));const path=join(folder,'module.mjs');await writeFile(path,bundle.outputFiles[0].text);
const {createMultiplayerReplayJob,preparedMultiplayerReplayEpoch,startMultiplayerReplay,multiplayerReplayNeedsMidi,PRODUCT_GAMES,DEFAULT_GAME_OPTIONS}=await import(pathToFileURL(path).href);
const hash=value=>createHash('sha256').update(value).digest('hex'),baseUrl='https://example.test/review/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
class Runtime {
  snapshot={phase:'idle',epoch:null,game:null,runtimeVariant:undefined,ready:false,launched:false,firstFrame:false,fileOperationBusy:false,saveError:null,netplayTiming:null};
  listeners=new Set();plans=[];launches=0;cancels=0;serial=0;launchGate=null;
  getSnapshot=()=>this.snapshot;subscribe=callback=>{this.listeners.add(callback);return()=>this.listeners.delete(callback);};
  update(patch){this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)listener();}
  async prepare(plan){this.plans.push(plan);this.update({generationId:plan.generation.id,phase:'prepared',epoch:++this.serial,game:plan.game,runtimeVariant:plan.runtimeVariant,ready:true,launched:false,firstFrame:false,netplayTiming:null});return this.snapshot;}
  async launch(){this.launches++;this.update({phase:'launching',launched:true});if(this.launchGate)await this.launchGate;this.update({phase:'running',firstFrame:true});return this.snapshot;}
  cancel(){this.cancels++;this.update({phase:'idle',epoch:null,ready:false});}
}
function fixture(game='th08') {
  const product=PRODUCT_GAMES[game],ids=['game-data','shared-msgothic','shared-unifont'],targets=[product.package.dataTarget,'/msgothic.ttc','/unifont.otf'],buffers=new Map();
  const files=Object.fromEntries(ids.map((id,index)=>{const data=new Uint8Array([index+1,2,3]).buffer;buffers.set(`obj-${id}`,data);return[id,{revision:`r-${id}`,source:index?`shared${targets[index]}`:`games/${game}${targets[0]}`,target:targets[index],bytes:3,sha256:hash(new Uint8Array(data))}];}));
  const descriptor={schema:'eagler-touhou/package/1',game,revision:'1234567890abcdef',runtimeRequirement:{protocol:'eagler-touhou/1',target:game,dataFile:'game-data',dataLayout:`sha256-${'a'.repeat(64)}`},files,base:{files:ids},components:{}};
  const generation={id:`gen-${game}`,game,descriptor,files:Object.fromEntries(ids.map(id=>[id,{objectId:`obj-${id}`,revision:files[id].revision}]))};
  const code=[`${game}.html`,'shell.mjs',`${game}.wasm`].sort().map(path=>({path,bytes:4,sha256:hash(path)}));
  const codeId=hash(JSON.stringify(['eagler-touhou/runtime-generation/1',`${game}.html`,code.map(file=>[file.path,file.bytes,file.sha256])]));
  const runtimeManifest={schema:'eagler-touhou/runtime-manifest/1',protocol:'eagler-touhou/1',groups:[{root:`runtime/${game}/multiplayer/`,current:{generation:codeId,entry:`${game}.html`,files:code},previous:[]}]};
  const host={schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-release',shared:{resourceMode:'hosted',runtimeManifest:'runtime-manifest.json',vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf',netplayRelay:'wss://relay.example.test/netplay'},
    games:{[game]:{runtime:`runtime/${game}/${codeId}/${game}.html`,multiplayerRuntime:`runtime/${game}/multiplayer/${codeId}/${game}.html`,gameData:{path:targets[0].slice(1),bytes:3,sha256:files['game-data'].sha256,version:`sha256-${files['game-data'].sha256}`,layout:descriptor.runtimeRequirement.dataLayout},music:{midi:{files:[]}},features:{thprac:product.features.thprac,focusHitbox:product.features.focusHitbox},languages:[],languageOptions:[{id:'ja',pack:null}]}}};
  const catalog={schema:'eagler-touhou/release-catalog/1',games:{[game]:{revision:descriptor.revision,descriptor:`${game}.package.json`}}};
  const responses=new Map([['host-manifest.json',{json:host}],['release-catalog.json',{json:catalog}],['runtime-manifest.json',{json:runtimeManifest}],[`${game}.package.json`,{json:descriptor}],...code.map(file=>[`runtime/${game}/multiplayer/${codeId}/${file.path}`,{length:file.bytes}]),...Object.values(files).map(file=>[file.source,{length:file.bytes}])]);
  const preferences={productId:`${game}mp`,preferenceId:game,shareSingleplayerSettings:true,persistence:'local',options:{...DEFAULT_GAME_OPTIONS},features:{thprac:false,focusHitbox:false},language:'ja',languages:[{id:'ja',title:'日本語'}],music:'none',musicPreference:'none',musicPreferenceExplicit:true,musicModes:['none']};
  const runtime=new Runtime(),requests=[],installs=[];
  const options={baseUrl,runtimeService:runtime,
    fetchImpl:async(input,init={})=>{requests.push({url:String(input),...init});const item=responses.get(new URL(input).pathname.slice(new URL(baseUrl).pathname.length));if(!item)return new Response(null,{status:404});return new Response(init.method==='HEAD'?null:JSON.stringify(item.json),{headers:item.json?{'content-type':'application/json'}:{'content-length':String(item.length)}});},
    dependencies:{readCurrent:async()=>({installation:null,generation:null}),readKeys:async keys=>new Set(keys),readObject:async id=>({data:buffers.get(id)}),install:async(game,args)=>{installs.push({game,args});return{generation,descriptor,installation:{game,currentGeneration:generation.id,source:'remote'}};}}};
  options.packageDependencies=options.dependencies;delete options.dependencies;const controller=createMultiplayerReplayJob(options);after(()=>controller.dispose());
  return{controller,options,preferences,runtime,requests,installs,host,runtimeManifest,responses,descriptor,generation,
    prepare:()=>controller.prepare(`${game}mp`,preferences)};
}


test('Replay inspection selects only the published multiplayer code group and never opens a room or Runtime',async()=>{
  const f=fixture();const result=await f.controller.inspect('th08mp');
  assert.equal(result.available,true);assert.equal(result.productId,'th08mp');assert.equal(result.game,'th08');
  assert.equal(result.runtimeVerified,false);assert.equal(result.packageVerified,false);assert.equal(f.runtime.plans.length,0);
  assert.ok(f.requests.some(item=>item.url.includes('/runtime/th08/multiplayer/')));
  assert.equal(f.requests.some(item=>/\/runtime\/th08\/[a-f0-9]{64}\//.test(item.url)),false);
  assert.equal(f.requests.some(item=>item.url.startsWith('ws')),false);
});

for(const game of ['th06','th07','th08','th09','th10'])test(`${game} Replay prepares dedicated multiplayer Runtime with canonical Replay flag and no room configuration`,async()=>{
  const f=fixture(game);await f.prepare();
  assert.equal(f.runtime.plans.length,1);assert.equal(f.runtime.launches,0);assert.equal(f.controller.getSnapshot().preparedEpoch,1);
  const plan=f.runtime.plans[0];assert.equal(plan.game,game);assert.equal(plan.runtimeVariant,'multiplayer');assert.equal(plan.publishedRuntime,true);
  assert.equal(plan.configure.options.replayViewer,true);assert.equal(plan.generation.id,`gen-${game}`);
  assert.deepEqual(Object.keys(plan.configure.options).filter(key=>key.startsWith('netplay')),[]);
  assert.equal(plan.configure.options.multiplayerPreflight,undefined);assert.equal(plan.configure.options.thpracEnabled,undefined);
  assert.equal(plan.configure.options.multiplayerLocalPlayerVisibility,f.preferences.options.multiplayerLocalPlayerVisibility);
});

test('missing multiplayer publication never falls back to normal Runtime',async()=>{
  const f=fixture();delete f.host.games.th08.multiplayerRuntime;
  const result=await f.controller.inspect('th08mp');assert.equal(result.available,false);assert.equal(result.reason.code,'runtime-unavailable');
  await assert.rejects(f.prepare(),/Runtime/);assert.equal(f.runtime.plans.length,0);
});

test('normal product and mismatched multiplayer preferences are rejected without preparing an iframe',async()=>{
  const f=fixture();const result=await f.controller.inspect('th08');assert.equal(result.available,false);assert.equal(result.reason.code,'unsupported-product');
  await assert.rejects(f.controller.prepare('th08',f.preferences),/multiplayer product/);
  await assert.rejects(f.controller.prepare('th07mp',f.preferences),/snapshot/);assert.equal(f.runtime.plans.length,0);
});

test('repeat clicks share preparation and capture exact pre-await settings without changing preferences',async()=>{
  const f=fixture(),original=structuredClone(f.preferences),a=f.prepare(),b=f.prepare();assert.equal(a,b);
  f.preferences.options.alwaysHitbox=!f.preferences.options.alwaysHitbox;await a;
  assert.equal(f.runtime.plans[0].configure.options.alwaysHitbox,original.options.alwaysHitbox);
  assert.equal(f.controller.getSnapshot().selection.productId,'th08mp');assert.equal(f.controller.getSnapshot().selection.preferences.options.alwaysHitbox,original.options.alwaysHitbox);
});

test('missing resources keep Replay intent, and explicit post-import retry remains multiplayer Replay',async()=>{
  const f=fixture();const data=f.descriptor.files['game-data'].source,saved=f.responses.get(data);f.responses.delete(data);
  await assert.rejects(f.prepare(),/HTTP 404/);assert.equal(f.controller.getSnapshot().selection.productId,'th08mp');assert.equal(f.runtime.plans.length,0);
  f.responses.set(data,saved);await f.prepare();assert.equal(f.runtime.plans[0].configure.options.replayViewer,true);assert.equal(f.runtime.plans[0].runtimeVariant,'multiplayer');
});

test('another current Runtime is never cancelled or replaced by Replay preparation',async()=>{
  const f=fixture();f.runtime.update({epoch:77,phase:'running',ready:true,launched:true});
  await assert.rejects(f.prepare(),/Save and close/);assert.equal(f.runtime.cancels,0);assert.equal(f.runtime.plans.length,0);
});

test('late acquisition is fenced after cancel, and cannot prepare a frame',async()=>{
  const f=fixture(),gate=deferred();f.controller.dispose();
  const controller=createMultiplayerReplayJob({...f.options,dependencies:{prepare:async options=>{await gate.promise;return options.runtimeService.prepare({game:'th08',runtimeVariant:'multiplayer',generation:{id:'synthetic'},configure:{options:{replayViewer:true}}});}}});after(()=>controller.dispose());
  const task=controller.prepare('th08mp',f.preferences);await tick();controller.cancel();gate.resolve();await assert.rejects(task,/cancelled/);assert.equal(f.runtime.plans.length,0);
});

function startFixture({music='none',replay=true}={}){
  const runtime=new Runtime();runtime.update({phase:'prepared',epoch:4,game:'th08',runtimeVariant:'multiplayer',ready:true});
  let context={epoch:4,game:'th08',runtimeVariant:'multiplayer',options:{replayViewer:replay},launcherControls:{}};
  runtime.getLauncherControlContext=()=>context;
  runtime.getMidiEventContext=()=>({epoch:runtime.snapshot.epoch,game:'th08',music});
  return {runtime,setContext:value=>{context=value;},context};
}

test('Start recognizes only exact prepared Replay configure intent, never a room/spectator/preflight/normal Runtime',()=>{
  const f=startFixture();assert.equal(preparedMultiplayerReplayEpoch(f.runtime),4);
  for(const patch of [{options:{replayViewer:false}},{options:{replayViewer:true,netplayUrl:'wss://example.test'}},{options:{replayViewer:true,netplaySpectator:true}},{options:{replayViewer:true,multiplayerPreflight:true}},{epoch:5},{game:'th07'},{runtimeVariant:'normal'}]){
    f.setContext({...f.context,...patch});assert.equal(preparedMultiplayerReplayEpoch(f.runtime),null);
  }
  f.setContext(f.context);for(const patch of [{phase:'running'},{epoch:5},{runtimeVariant:'normal'}]){f.runtime.update({phase:'prepared',epoch:4,runtimeVariant:'multiplayer',...patch});assert.equal(preparedMultiplayerReplayEpoch(f.runtime),null);}
});

test('Replay Start waits for native first-frame launch promise, shares root Runtime and performs no audio work for none',async()=>{
  const f=startFixture(),gate=deferred();f.runtime.launchGate=gate.promise;
  let completed=false;const task=startMultiplayerReplay({runtime:f.runtime,midi:null,epoch:4});void task.then(()=>{completed=true;});await tick();
  assert.equal(f.runtime.launches,1);assert.equal(completed,false);gate.resolve();assert.equal(await task,'started');assert.equal(f.runtime.snapshot.firstFrame,true);
});

test('MIDI is resumed in the initiating gesture and stale epoch after audio resume never launches',async()=>{
  const f=startFixture({music:'midi'}),gate=deferred(),calls=[];
  const midi={getSnapshot:()=>({ready:true}),resumeForGesture:epoch=>{calls.push(epoch);return gate.promise;}};
  assert.equal(multiplayerReplayNeedsMidi(f.runtime,4),true);
  const task=startMultiplayerReplay({runtime:f.runtime,midi,epoch:4});assert.deepEqual(calls,[4]);
  f.runtime.update({epoch:5});gate.resolve();assert.equal(await task,'superseded');assert.equal(f.runtime.launches,0);
});

test('cold MIDI preparation needs another explicit gesture; stale gesture and busy files cannot start',async()=>{
  const f=startFixture({music:'midi'}),calls=[];
  const midi={getSnapshot:()=>({ready:false}),ensureReady:async()=>{calls.push('ready');},resumeForGesture:async()=>{calls.push('resume');}};
  assert.equal(await startMultiplayerReplay({runtime:f.runtime,midi,epoch:4}),'audio-prepared');assert.deepEqual(calls,['ready']);assert.equal(f.runtime.launches,0);
  assert.equal(await startMultiplayerReplay({runtime:f.runtime,midi,epoch:4,currentIntent:()=>false}),'superseded');
  f.runtime.update({fileOperationBusy:true});assert.equal(await startMultiplayerReplay({runtime:f.runtime,midi,epoch:4}),'superseded');assert.equal(f.runtime.launches,0);
});

test('starting twice cannot issue a second launch once Runtime leaves prepared phase',async()=>{
  const f=startFixture(),gate=deferred();f.runtime.launchGate=gate.promise;
  const first=startMultiplayerReplay({runtime:f.runtime,midi:null,epoch:4});
  assert.equal(await startMultiplayerReplay({runtime:f.runtime,midi:null,epoch:4}),'superseded');assert.equal(f.runtime.launches,1);gate.resolve();await first;
});
