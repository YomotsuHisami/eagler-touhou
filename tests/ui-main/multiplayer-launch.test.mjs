/** Synthetic Host/Package acquisition + exact Runtime/calibration ports only. */
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
const bundle=await build({stdin:{contents:`export * from './app/services/multiplayer-launch.client';
export * from './app/services/netplay-calibration.client';
export {PRODUCT_GAMES} from './src/contracts/product-catalog.mts';
export {DEFAULT_GAME_OPTIONS} from './src/launcher/game-preferences.mts';
export {buildMultiplayerRuntimeOptions} from './src/launcher/multiplayer-runtime-options.mts';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,
plugins:[{name:'sources',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{if(!args.path.startsWith('.'))return;const path=resolve(dirname(args.importer),args.path),facade=['product-catalog','release-catalog'].find(name=>path===resolve(root,`${name}.mjs`));if(facade)return{path:resolve(root,`src/contracts/${facade}.mts`)};const authored=path.replace(/\.mjs$/,'.mts');if(authored.startsWith(join(root,'src')+'/')&&existsSync(authored))return{path:authored};});}}]});
assert.doesNotMatch(bundle.outputFiles[0].text,/src\/launcher\/app\.mts|netplay-calibration-(?:report|connection)\.mts|node:/);
const folder=await mkdtemp(join(tmpdir(),'ui-mp-launch-'));after(()=>rm(folder,{recursive:true,force:true}));const path=join(folder,'module.mjs');await writeFile(path,bundle.outputFiles[0].text);
const {createMultiplayerLaunch,validateRoomLaunchRequest,createCalibrationOwner,parseCalibrationProgress,parseCalibrationReport,PRODUCT_GAMES,DEFAULT_GAME_OPTIONS,buildMultiplayerRuntimeOptions}=await import(pathToFileURL(path).href);
const hash=value=>createHash('sha256').update(value).digest('hex'),baseUrl='https://example.test/review/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
class Runtime {
  snapshot={phase:'idle',epoch:null,game:null,runtimeVariant:undefined,ready:false,launched:false,firstFrame:false,fileOperationBusy:false,saveError:null,netplayTiming:null};
  listeners=new Set();plans=[];launches=0;cancels=0;serial=0;launchGate=null;
  getSnapshot=()=>this.snapshot;subscribe=callback=>{this.listeners.add(callback);return()=>this.listeners.delete(callback);};
  update(patch){this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)listener();}
  async prepare(plan){this.plans.push(plan);this.update({phase:'prepared',epoch:++this.serial,game:plan.game,runtimeVariant:plan.runtimeVariant,ready:true,launched:false,firstFrame:false,netplayTiming:null});return this.snapshot;}
  async launch(){this.launches++;this.update({phase:'launching',launched:true});if(this.launchGate)await this.launchGate;this.update({phase:'running',firstFrame:true});return this.snapshot;}
  async close(){this.update({phase:'idle',epoch:null,game:null,runtimeVariant:undefined,ready:false,launched:false,firstFrame:false,netplayTiming:{phase:'closed'}});return true;}
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
  const runtime=new Runtime(),requests=[],installs=[],timing=[],progress=[];
  const options={baseUrl,runtimeService:runtime,confirmInputWarnings:async()=>true,getPreferences:()=>preferences,getTouchLayout:()=>null,onTiming:(serial,value)=>timing.push({serial,value}),
    fetchImpl:async(input,init={})=>{requests.push({url:String(input),...init});const item=responses.get(new URL(input).pathname.slice(new URL(baseUrl).pathname.length));if(!item)return new Response(null,{status:404});return new Response(init.method==='HEAD'?null:JSON.stringify(item.json),{headers:item.json?{'content-type':'application/json'}:{'content-length':String(item.length)}});},
    dependencies:{readCurrent:async()=>({installation:null,generation:null}),readKeys:async keys=>new Set(keys),readObject:async id=>({data:buffers.get(id)}),install:async(game,args)=>{installs.push({game,args});return{generation,descriptor,installation:{game,currentGeneration:generation.id,source:'remote'}};}}};
  const controller=createMultiplayerLaunch(options);after(()=>controller.dispose());
  const makeRequest=({serial=1,spectator=false,delay='auto',rollback=false}={})=>({productId:`${game}mp`,roomCode:'1234',serial,options:buildMultiplayerRuntimeOptions({url:`wss://relay.example.test/netplay?room=${game}mp-1234&run=${serial}&${spectator?'spectator=client_spectator_123':'player=0'}`,player:spectator?null:0,playerCount:2,seed:1234,difficulty:1,inputDelay:delay==='auto'?0:delay,adonisMode:game==='th08'||game==='th09'?rollback?2:1:0,inputDelayAuto:game==='th08'||game==='th09'?delay==='auto':undefined,predictionReserve:game==='th08'||game==='th09'?2:undefined,predictionLimit:8,spectator,spectatorId:spectator?'client_spectator_123':'',spectatorCount:spectator?1:0,iceServers:[],loadouts:[{character:0,shot:0},{character:1,shot:0}]},product.multiplayer)});
  return{controller,options,preferences,runtime,requests,installs,timing,progress,host,runtimeManifest,responses,descriptor,generation,makeRequest,
    prepare:signal=>controller.prepare(`${game}mp`,signal??new AbortController().signal,value=>progress.push(value))};
}

test('real shared builder resolves dedicated immutable multiplayer group and acquires verified resources without touching Runtime',async()=>{
  const f=fixture();await f.prepare();assert.equal(f.runtime.plans.length,0);assert.equal(f.runtime.launches,0);assert.equal(f.installs.length,1);assert.equal(f.progress.at(-1).status,'ready');assert.equal(f.controller.getSnapshot().prepared,true);
  assert.equal(f.requests.some(item=>item.url.includes('/runtime/th08/multiplayer/')),true);assert.equal(f.requests.some(item=>/\/runtime\/th08\/[a-f0-9]{64}\//.test(item.url)),false);
});

test('missing dedicated Host entry or wrong Runtime group blocks resource-ready instead of falling back to normal',async()=>{
  const f=fixture();delete f.host.games.th08.multiplayerRuntime;await assert.rejects(f.prepare(),/multiplayer|Runtime/);assert.equal(f.controller.getSnapshot().prepared,false);assert.equal(f.runtime.plans.length,0);
  const g=fixture();g.runtimeManifest.groups[0].root='runtime/th08/';await assert.rejects(g.prepare(),/Runtime/);assert.equal(g.runtime.plans.length,0);
});

test('launch overlays only authoritative network options, binds current code/data epoch and waits for first frame',async()=>{
  const f=fixture(),gate=deferred();await f.prepare();f.runtime.launchGate=gate.promise;const request=f.makeRequest({delay:9,rollback:true}),launch=f.controller.launch(request,new AbortController().signal);let finished=false;void launch.then(()=>{finished=true;});await tick();
  assert.equal(f.runtime.plans.length,1);assert.equal(f.runtime.plans[0].runtimeVariant,'multiplayer');assert.equal(f.runtime.plans[0].generation.id,'gen-th08');assert.equal(f.runtime.plans[0].configure.options.netplayInputDelay,9);assert.equal(f.runtime.plans[0].configure.options.netplayAdonisMode,2);assert.equal(f.runtime.plans[0].configure.options.netplayInputDelayAuto,false);assert.equal(finished,false);
  gate.resolve();await launch;assert.equal(finished,true);assert.equal(f.runtime.snapshot.firstFrame,true);assert.equal(f.controller.getSnapshot().active.epoch,1);
});

test('captured preferences cannot drift between resource preparation and authoritative start',async()=>{
  const f=fixture();await f.prepare();f.preferences.options.touchEnabled=true;await assert.rejects(f.controller.launch(f.makeRequest(),new AbortController().signal),/设置已变化/);assert.equal(f.runtime.plans.length,0);
});

test('another prepared/running Runtime is never cancelled or replaced implicitly',async()=>{
  const f=fixture();f.runtime.update({epoch:99,ready:true,phase:'prepared',game:'th06',runtimeVariant:'normal'});await assert.rejects(f.prepare(),/保存并关闭/);assert.equal(f.runtime.cancels,0);assert.equal(f.runtime.plans.length,0);
});

test('room/run/player URL binding is checked before handing any options to Runtime',async()=>{
  const f=fixture(),request=f.makeRequest();assert.equal(validateRoomLaunchRequest(request).netplayInputDelayAuto,true);
  for(const options of [{netplayUrl:request.options.netplayUrl.replace('run=1','run=2')},{netplayUrl:request.options.netplayUrl+'&lobby=other'},{netplayUrl:request.options.netplayUrl.replace('player=0','player=1')},{netplayInputDelay:10}])assert.throws(()=>validateRoomLaunchRequest({...request,options:{...request.options,...options}}));
});

test('challenge mode crosses only cooperative multiplayer Runtime contracts',()=>{
  const makeInput=game=>({url:`wss://relay.example.test/netplay?room=${game}mp-1234&run=1&player=0`,player:0,playerCount:2,seed:1234,difficulty:0,
    spectator:false,spectatorId:'',spectatorCount:0,iceServers:[],loadouts:PRODUCT_GAMES[game].multiplayer.loadouts.slice(0,2).map(({character,shot})=>({character,shot}))});
  const cooperative=buildMultiplayerRuntimeOptions({...makeInput('th08'),challengeMode:true},PRODUCT_GAMES.th08.multiplayer);
  assert.equal(cooperative.netplayChallengeMode,true);
  assert.throws(()=>buildMultiplayerRuntimeOptions({...makeInput('th09'),challengeMode:true},PRODUCT_GAMES.th09.multiplayer),/不支持挑战模式/);
  assert.equal(buildMultiplayerRuntimeOptions({...makeInput('th09'),challengeMode:false},PRODUCT_GAMES.th09.multiplayer).netplayChallengeMode,undefined);
});

test('only current Runtime epoch calibration reaches report and room timing mirror',async()=>{
  const f=fixture(),gate=deferred();await f.prepare();f.runtime.launchGate=gate.promise;const launch=f.controller.launch(f.makeRequest({rollback:true}),new AbortController().signal);await tick();
  f.runtime.update({netplayTiming:{phase:'measuring',probes:42,replies:35}});assert.equal(f.controller.getSnapshot().calibration.progress.probes,42);
  const timing={phase:'ready',automatic:true,adonisMode:2,inputDelay:1,fullDelay:3,predictionReserve:2,rttP95Us:100000,samples:100,lost:0,route:'rtc',calibration:{game:'th08mp',localPlayer:0,build:'native-test',players:[{player:0,p95Us:100000,samples:100,lost:20,minUs:30000,maxUs:140000,meanUs:75000},{player:1,p95Us:95000,samples:100,lost:20,minUs:25000,maxUs:130000,meanUs:70000}]}};
  f.runtime.update({netplayTiming:timing});assert.equal(f.controller.getSnapshot().calibration.report.game,'th08mp');assert.equal(f.timing.at(-1).serial,1);assert.match(f.controller.reportText(),/native-test/);
  const previous=f.timing.length;f.runtime.update({epoch:999,netplayTiming:{phase:'measuring',probes:5}});assert.equal(f.controller.getSnapshot().active,null);assert.equal(f.timing.length,previous);
  gate.resolve();await assert.rejects(launch,/首帧|替换/);
});

test('abort before resource work resolves cannot publish ready or prepare a frame',async()=>{
  const waiting=deferred(),f=fixture(),signal=new AbortController();f.controller.dispose();const controller=createMultiplayerLaunch({...f.options,buildPlan:async()=>waiting.promise});after(()=>controller.dispose());
  const preparing=controller.prepare('th08mp',signal.signal,()=>{});signal.abort();waiting.resolve({game:'th08',runtimeVariant:'multiplayer',publishedRuntime:true});await assert.rejects(preparing,/cancelled/);assert.equal(controller.getSnapshot().prepared,false);assert.equal(f.runtime.plans.length,0);
});

test('calibration reports validate native timing and expected product; lifecycle remains display-only',()=>{
  assert.equal(parseCalibrationProgress({phase:'ready',inputDelay:9}),null);assert.equal(parseCalibrationProgress({phase:'measuring',probes:999,replies:-4}).probes,129);
  const timing={phase:'ready',automatic:true,adonisMode:1,inputDelay:3,fullDelay:3,predictionReserve:0,rttP95Us:100000,samples:100,lost:0,route:'relay',calibration:{game:'th08mp',players:[{player:0,p95Us:100000,samples:100,lost:20},{player:1,p95Us:99999,samples:100,lost:20}]}};
  assert.ok(parseCalibrationReport(timing,'th08mp'));assert.equal(parseCalibrationReport(timing,'th09mp'),null);assert.equal(parseCalibrationReport({...timing,route:'spectator'},'th08mp'),null);
  let now=0;const owner=createCalibrationOwner({now:()=>now});owner.begin(4,'th08mp');assert.equal(owner.receive(3,timing),false);assert.equal(owner.receive(4,timing),true);now=7999;assert.equal(owner.expire(),false);now=8000;assert.equal(owner.expire(),true);assert.equal(owner.getSnapshot().dismissed,true);assert.ok(owner.getSnapshot().report);owner.reset();assert.equal(owner.getSnapshot().epoch,null);
});

test('calibration retry/suspend/unavailable phases are bounded and return-to-room preserves the last report',async()=>{
  const retry=parseCalibrationProgress({phase:'retrying',attempt:3,maxAttempts:4});assert.equal(retry.attempt,3);assert.equal(retry.maxAttempts,4);
  assert.equal(parseCalibrationProgress({phase:'suspended'}).phase,'suspended');assert.equal(parseCalibrationProgress({phase:'unavailable',reason:8}).reason,8);
  assert.equal(parseCalibrationProgress({phase:'unavailable',reason:'<img>'}).reason,0);
  const f=fixture(),gate=deferred();await f.prepare();f.runtime.launchGate=gate.promise;
  const task=f.controller.launch(f.makeRequest(),new AbortController().signal);await tick();
  const measured={phase:'ready',automatic:true,adonisMode:1,inputDelay:3,fullDelay:3,predictionReserve:0,rttP95Us:100000,samples:100,lost:0,route:'relay',calibration:{game:'th08mp',localPlayer:0,build:'native-test',players:[{player:0,p95Us:100000,samples:100,lost:20},{player:1,p95Us:99999,samples:100,lost:20}]}};
  f.runtime.update({netplayTiming:measured});gate.resolve();await task;const active=f.controller.getSnapshot().active;
  f.runtime.update({netplayTiming:{phase:'suspended'}});assert.equal(f.controller.getSnapshot().calibration.progress.phase,'suspended');
  assert.equal(await f.controller.returnToRoom(active),true);assert.equal(f.controller.getSnapshot().active,null);assert.equal(f.controller.getSnapshot().calibration.progress,null);
  assert.equal(f.controller.getSnapshot().calibration.report.game,'th08mp');assert.match(f.controller.reportText(),/native-test/);
});

test('cancellation during native preparation cancels only the matching unlaunched Runtime epoch',async()=>{
  const f=fixture(),waiting=deferred(),signal=new AbortController();await f.prepare();
  f.runtime.prepare=async plan=>{f.runtime.plans.push(plan);f.runtime.update({phase:'configuring',epoch:7,game:plan.game,runtimeVariant:'multiplayer',ready:true});await waiting.promise;return{...f.runtime.snapshot,phase:'prepared'};};
  const task=f.controller.launch(f.makeRequest(),signal.signal);await tick();signal.abort();assert.equal(f.runtime.cancels,1);assert.equal(f.runtime.launches,0);waiting.resolve();await assert.rejects(task,/cancelled/);
});

test('cancellation after launch starts preserves the running Runtime for the root save/close owner',async()=>{
  const f=fixture(),waiting=deferred(),signal=new AbortController();await f.prepare();f.runtime.launchGate=waiting.promise;
  const task=f.controller.launch(f.makeRequest(),signal.signal);await tick();signal.abort();assert.equal(f.runtime.cancels,0);assert.equal(f.runtime.snapshot.launched,true);waiting.resolve();await assert.rejects(task,/cancelled/);
});

test('repeated room resource preparation reuses one captured plan until settings change',async()=>{
  const f=fixture();await f.prepare();const count=f.requests.length;await f.prepare();assert.equal(f.requests.length,count);f.preferences.options.alwaysHitbox=!f.preferences.options.alwaysHitbox;await f.prepare();assert.ok(f.requests.length>count);
});

test('native title preparation retains its exact epoch and authoritative launch retires it before multiplayer prepare',async()=>{
  const f=fixture('th09');f.controller.dispose();f.runtime.update({epoch:7,game:'th09',runtimeVariant:'normal',ready:true,launched:true,phase:'running'});
  const retired=[];
  const controller=createMultiplayerLaunch({...f.options,retainedTitle:{retains:product=>product==='th09mp'&&f.runtime.snapshot.epoch===7,
    async retire(request,signal){assert.equal(signal.aborted,false);retired.push(request);assert.equal(f.runtime.plans.length,0);assert.equal(f.runtime.snapshot.epoch,7);f.runtime.update({epoch:null,ready:false,launched:false,phase:'idle'});}}});after(()=>controller.dispose());
  await controller.prepare('th09mp',new AbortController().signal,()=>{});assert.equal(f.runtime.snapshot.epoch,7);assert.equal(f.runtime.plans.length,0);assert.equal(f.runtime.cancels,0);
  await controller.launch(f.makeRequest(),new AbortController().signal);assert.equal(retired.length,1);assert.equal(retired[0].roomCode,'1234');assert.equal(f.runtime.plans.length,1);assert.equal(f.runtime.plans[0].runtimeVariant,'multiplayer');assert.equal(f.runtime.launches,1);
});
test('invalid room binding and changed preferences never close title; refusal and post-close abort never launch',async()=>{
  const f=fixture('th09');f.controller.dispose();let refusal=true,retireCalls=0,abortOnClose=null;
  f.runtime.update({epoch:7,game:'th09',runtimeVariant:'normal',ready:true,launched:true,phase:'running'});
  const controller=createMultiplayerLaunch({...f.options,retainedTitle:{retains:product=>product==='th09mp'&&f.runtime.snapshot.epoch===7,
    async retire(){retireCalls++;if(refusal)throw Error('title save refused');f.runtime.update({epoch:null,ready:false,launched:false,phase:'idle'});abortOnClose?.abort();}}});after(()=>controller.dispose());
  await controller.prepare('th09mp',new AbortController().signal,()=>{});
  await assert.rejects(controller.launch({...f.makeRequest(),roomCode:'9999'},new AbortController().signal),/不一致/);assert.equal(retireCalls,0);
  f.preferences.options.alwaysHitbox=!f.preferences.options.alwaysHitbox;await assert.rejects(controller.launch(f.makeRequest(),new AbortController().signal),/设置已变化/);assert.equal(retireCalls,0);
  f.preferences.options.alwaysHitbox=!f.preferences.options.alwaysHitbox;await assert.rejects(controller.launch(f.makeRequest(),new AbortController().signal),/title save refused/);assert.equal(f.runtime.snapshot.epoch,7);assert.equal(f.runtime.plans.length,0);
  refusal=false;abortOnClose=new AbortController();await assert.rejects(controller.launch(f.makeRequest(),abortOnClose.signal),/cancelled/);assert.equal(f.runtime.plans.length,0);assert.equal(f.runtime.launches,0);
});

function warningFixture(confirm, {music = 'none', retainedTitle, prepareMidiAtLaunch} = {}) {
  const f = fixture(); f.controller.dispose();
  const controller = createMultiplayerLaunch({...f.options, confirmInputWarnings: confirm, retainedTitle, prepareMidiAtLaunch,
    buildPlan: async () => ({game: 'th08', runtimeVariant: 'multiplayer', publishedRuntime: true,
      configure: {music, options: {touchEnabled: false}}})});
  after(() => controller.dispose());
  return {...f, controller, prepare: () => controller.prepare('th08mp', new AbortController().signal, () => {})};
}
test('seated MIDI launch awaits owner output preparation from the prepared-epoch confirmation before native launch', async () => {
  const calls = [], output = deferred();
  const f = warningFixture(async (...args) => {
    const [, , , current, stage, epoch, onAccept] = args;calls.push(`confirm:${stage}`);
    assert.equal(current(), true);
    if (stage === 'launch') {assert.equal(epoch, 1);await onAccept?.();}
    return true;
  }, {music: 'midi', prepareMidiAtLaunch: async (epoch, current) => {
    assert.equal(epoch, 1);assert.equal(current(), true);calls.push('resume-and-open');return output.promise;
  }});
  await f.prepare();
  const task = f.controller.launch(f.makeRequest(), new AbortController().signal);await tick();
  assert.deepEqual(calls, ['confirm:preparation', 'confirm:launch', 'resume-and-open']);
  assert.equal(f.runtime.launches, 0, 'native Runtime waits while external output preparation is pending');
  output.resolve();await task;assert.equal(f.runtime.launches, 1);
});
test('seated launch warnings gate exact captured settings after resource readiness; spectators are excluded', async () => {
  const calls = [], wait = deferred();
  const f = warningFixture((...args) => {calls.push(args); return wait.promise;});
  await f.prepare(); assert.equal(calls.length, 0); assert.equal(f.controller.getSnapshot().prepared, true);
  const launch = f.controller.launch(f.makeRequest(), new AbortController().signal);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0][0], {music: 'none', touchEnabled: false});
  assert.equal(calls[0][1].serial, 1); assert.equal(calls[0][3](), true);
  assert.equal(f.runtime.plans.length, 0); assert.equal(f.runtime.launches, 0);
  wait.resolve(true); await launch; assert.equal(f.runtime.launches, 1);
  const spectator = warningFixture(() => {throw Error('Spectators must not be prompted');});
  await spectator.prepare(); await spectator.controller.launch(spectator.makeRequest({spectator: true}), new AbortController().signal);
  assert.equal(spectator.runtime.launches, 1);
});
test('canceling a seated warning preserves a retained title without saving, preparing or starting', async () => {
  let retire = 0;
  const f = warningFixture(async () => false, {retainedTitle: {retains: () => true, retire: async () => {retire++;}}});
  f.runtime.update({phase: 'running', epoch: 3, ready: true, launched: true});
  await f.prepare(); await assert.rejects(f.controller.launch(f.makeRequest(), new AbortController().signal), /cancelled/);
  assert.equal(retire, 0); assert.equal(f.runtime.snapshot.epoch, 3); assert.equal(f.runtime.plans.length, 0); assert.equal(f.runtime.launches, 0);
});
test('late room warning acceptance cannot bypass changes to preferences, epoch, file lock, save guard or disposal', async () => {
  for (const replace of [f => {f.preferences.options.touchEnabled = true;}, f => f.runtime.update({epoch: 99}),
    f => f.runtime.update({fileOperationBusy: true}), f => f.runtime.update({saveError: 'unsaved'}), f => f.controller.dispose()]) {
    const wait = deferred(), f = warningFixture(() => wait.promise); await f.prepare();
    const task = f.controller.launch(f.makeRequest(), new AbortController().signal); replace(f); wait.resolve(true);
    await assert.rejects(task, /替换/); assert.equal(f.runtime.plans.length, 0); assert.equal(f.runtime.launches, 0);
  }
});
test('aborted and superseded room runs cannot consume a newer warning acceptance', async () => {
  const waits = [], f = warningFixture(() => {const value = deferred(); waits.push(value); return value.promise;});
  await f.prepare(); const signal = new AbortController();
  const first = f.controller.launch(f.makeRequest(), signal.signal); signal.abort(); waits[0].resolve(true);
  await assert.rejects(first, /cancelled/); assert.equal(f.runtime.launches, 0);
  const second = f.controller.launch(f.makeRequest({serial: 2}), new AbortController().signal);
  const third = f.controller.launch(f.makeRequest({serial: 3}), new AbortController().signal);
  waits[1].resolve(true); await assert.rejects(second, /替换/); assert.equal(f.runtime.launches, 0);
  waits[2].resolve(true); await third; assert.equal(f.runtime.launches, 1);
});
test('late local-OGG fallback gets its own effective-MIDI warning without changing saved music or re-warning touch', async () => {
  const calls = [], wait = deferred(), f = warningFixture((...args) => {calls.push(args); return calls.length === 1 ? Promise.resolve(true) : wait.promise;}, {music: 'ogg'});
  f.preferences.music = 'ogg-stream';
  const prepare = f.runtime.prepare.bind(f.runtime);
  f.runtime.prepare = async plan => {await prepare(plan); f.runtime.update({music: 'midi'}); return f.runtime.snapshot;};
  await f.prepare(); const task = f.controller.launch(f.makeRequest(), new AbortController().signal); await tick();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1][0], {music: 'midi', touchEnabled: true}); assert.equal(calls[1][3](), true);
  assert.equal(f.runtime.launches, 0); wait.resolve(true); await task;
  assert.equal(f.runtime.launches, 1); assert.equal(f.preferences.music, 'ogg-stream');
});
test('canceling late fallback retires only the matching unlaunched prepared epoch', async () => {
  let confirms = 0; const f = warningFixture(async () => ++confirms === 1, {music: 'ogg'});
  const prepare = f.runtime.prepare.bind(f.runtime);
  f.runtime.prepare = async plan => {await prepare(plan); f.runtime.update({music: 'midi'}); return f.runtime.snapshot;};
  await f.prepare(); await assert.rejects(f.controller.launch(f.makeRequest(), new AbortController().signal), /cancelled/);
  assert.equal(f.runtime.cancels, 1); assert.equal(f.runtime.launches, 0);
});

for(const game of ['th06','th07','th08','th09'])test(`${game}: multiplayer accepts only explicit validated development Host Runtime plans`,async()=>{
 const f=fixture(game);f.host.profile='web-development';f.host.shared.testBuild=true;delete f.host.shared.runtimeManifest;
 f.host.games[game].runtime=`workspace/${game}/normal/${game}.html?hosted=1`;
 f.host.games[game].multiplayerRuntime=`workspace/${game}/multiplayer/${game}.html?hosted=1`;
 f.options.dependencies.readCurrent=async()=>({installation:{game,source:'local',currentGeneration:f.generation.id},generation:f.generation});
 await f.prepare();assert.equal(f.controller.getSnapshot().prepared,true);assert.equal(f.installs.length,0);
 await f.controller.launch(f.makeRequest(),new AbortController().signal);
 const plan=f.runtime.plans.at(-1);assert.equal(plan.publishedRuntime,false);assert.equal(plan.developmentRuntimeHost.profile,'web-development');
 assert.equal(plan.entry,baseUrl+f.host.games[game].multiplayerRuntime);assert.equal(plan.runtimeVariant,'multiplayer');
});
test('unpublished multiplayer plans without validated development authority fail before touching the Runtime',async()=>{
 for(const host of [undefined,{profile:'web-development'},{profile:'web-release'}]){
  const f=fixture('th08');f.options.buildPlan=async()=>({game:'th08',runtimeVariant:'multiplayer',publishedRuntime:false,developmentRuntimeHost:host,entry:baseUrl+'workspace/th08.html'});
  await assert.rejects(f.prepare(),/Runtime/);assert.equal(f.runtime.plans.length,0);assert.equal(f.controller.getSnapshot().prepared,false);
 }
});

test('Check game uses the captured exact multiplayer plan and remains separate from launch/calibration', async () => {
  const f = fixture(), waiting = deferred(), checks = []; await f.prepare();
  f.runtime.checkMultiplayer = async (plan, signal) => {checks.push({plan, signal}); await waiting.promise;};
  const check = f.controller.checkGame('th08mp', new AbortController().signal); await tick();
  assert.equal(checks.length, 1); assert.equal(checks[0].plan.game, 'th08'); assert.equal(checks[0].plan.runtimeVariant, 'multiplayer');
  assert.equal(checks[0].plan.generation.id, 'gen-th08'); assert.match(checks[0].plan.entry, /th08\/multiplayer/);
  assert.equal(Object.keys(checks[0].plan.configure.options).some(key => key.startsWith('netplay')), false);
  assert.equal(f.controller.getSnapshot().active, null); assert.equal(f.runtime.launches, 0);
  await assert.rejects(f.controller.launch(f.makeRequest(), new AbortController().signal), /检查清理/);
  waiting.resolve(); await check; assert.equal(f.controller.getSnapshot().prepared, true);
  await f.controller.launch(f.makeRequest(), new AbortController().signal); assert.equal(f.runtime.launches, 1);
});
test('Check game cannot replace retained title, changed preferences or an unprepared plan', async () => {
  const f = fixture(); f.runtime.checkMultiplayer = async () => assert.fail('Must not enter engine');
  await assert.rejects(f.controller.checkGame('th08mp', new AbortController().signal), /重新准备/);
  await f.prepare(); f.preferences.options.touchEnabled = !f.preferences.options.touchEnabled;
  await assert.rejects(f.controller.checkGame('th08mp', new AbortController().signal), /重新准备/);
  f.runtime.update({epoch: 4, phase: 'running', ready: true, launched: true});
  await assert.rejects(f.controller.checkGame('th08mp', new AbortController().signal), /保存并关闭/);
  assert.equal(f.runtime.cancels, 0);
});
test('Check game cancellation and disposal reach the owned engine signal and never report a stale success', async () => {
  for (const cancel of ['signal', 'dispose', 'preferences']) {
    const f = fixture(), waiting = deferred(), signal = new AbortController(); await f.prepare(); let actual;
    f.runtime.checkMultiplayer = async (_plan, selected) => {actual = selected; await waiting.promise;};
    const task = f.controller.checkGame('th08mp', signal.signal); await tick();
    if (cancel === 'signal') signal.abort(); else if (cancel === 'dispose') f.controller.dispose(); else f.preferences.music = 'midi';
    if (cancel !== 'preferences') assert.equal(actual.aborted, true);
    waiting.resolve(); await assert.rejects(task, /cancelled|替换/);
    assert.equal(f.controller.getSnapshot().active, null); assert.equal(f.runtime.launches, 0);
  }
});
