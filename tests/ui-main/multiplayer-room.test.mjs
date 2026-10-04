/** Injected control-transport/probe/Runtime-port tests; no live relay or gameplay. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url)), folder = await mkdtemp(join(tmpdir(), 'ui-mp-room-'));
after(() => rm(folder, {recursive: true, force: true}));
const plugin = {name: 'authored-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
  if (!args.path.startsWith('.')) return; const path=resolve(dirname(args.importer),args.path), facade=['product-catalog','release-catalog'].find(name=>path===resolve(root,`${name}.mjs`)); if(facade)return{path:resolve(root,`src/contracts/${facade}.mts`)}; const authored = path.replace(/\.mjs$/, '.mts');
  if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
});}};
async function bundled(name, source) {
  const result = await build({entryPoints: [join(root, source)], bundle: true, format: 'esm', platform: 'browser', write: false, loader:{'.css':'empty'}, plugins: [plugin]});
  assert.doesNotMatch(result.outputFiles[0].text, /src\/launcher\/(?:app|lobby)\.mts|node:/);
  const path = join(folder, `${name}.mjs`); await writeFile(path, result.outputFiles[0].text); return import(pathToFileURL(path).href);
}
const {createMultiplayerRoom, parseMultiplayerRoomRoute} = await bundled('service', 'app/services/multiplayer-room.client.ts');
const {createMultiplayerRoomDocumentOwner} = await bundled('owner', 'app/components/MultiplayerRoomProvider.tsx');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject};};
function clock() {let now=20_000, next=0;const tasks=new Map();return {now:()=>now,
  set(callback,delay){const id=++next;tasks.set(id,{callback,at:now+delay});return id;}, clear(id){tasks.delete(id);}, size:()=>tasks.size,
  advance(ms){const end=now+ms;for(;;){const [id,job]=[...tasks].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0]??[];if(!job||job.at>end)break;now=job.at;tasks.delete(id);job.callback();}now=end;}};}
class Socket {
  readyState=0;sent=[];closes=[];listeners=new Map();constructor(url){this.url=url;}
  addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
  emit(type,event){for(const listener of this.listeners.get(type)??[])listener(event);}
  open(){this.readyState=1;this.emit('open',{});}
  send(value){if(this.readyState!==1)throw Error('closed');this.sent.push(JSON.parse(value));}
  close(code,reason){this.readyState=3;this.closes.push({code,reason});}
  remoteClose(code=1006){this.readyState=3;this.emit('close',{code});}
  message(value){this.emit('message',{data:JSON.stringify(value)});}
  state(room,more={}){this.message({type:'state',room,roomDirectory:{version:1,controlModes:true},roomProbe:{iceServers:[]},...more});}
}
function manifest() {const game=id=>({runtime:`runtime/${id}/${id}.html`,multiplayerRuntime:`runtime/${id}/multiplayer/${id}.html`,gameData:{path:`${id}.data`,bytes:3,sha256:'a'.repeat(64),version:`sha256-${'a'.repeat(64)}`,layout:`sha256-${'b'.repeat(64)}`},music:{midi:{files:['01.mid']}},languages:[],languageOptions:[{id:'ja',pack:null}]});return {schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-release',shared:{resourceMode:'hosted',vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf',netplayRelay:'wss://relay.example.test/netplay?directory=1&member=old&key=public'},games:{th06:game('th06'),th08:game('th08'),th09:game('th09')}};}
const seat=(patch={})=>({clientId:'client_local_123',name:'玩家',loadout:0,ready:false,offline:false,controlMode:'normal',mobileDevice:false,...patch});
const room=(patch={})=>({playerCount:2,difficulty:1,visibility:'public',disableCheatMovement:false,inputDelay:0,adonisMode:0,inputDelayAuto:false,predictionReserve:2,timing:null,predictionLimit:8,settingsVersion:1,phase:'lobby',startSerial:0,seats:[null,null,null],spectators:[],spectatorCount:0,...patch});
function route(product='th06mp',code='1234',extra='') {return parseMultiplayerRoomRoute(`/play/${product}`,`?mpRoom=${code}${extra}`);}
function fixture({runtime,fetchImpl,saved=null}={}) {
  const timers=clock(),sockets=[],requests=[],saves=[],clears=[],networkCalls=[],prefWrites=[];
  let displayName='',locked=false;
  const network={update:value=>networkCalls.push(['update',value]),receive:async value=>networkCalls.push(['receive',value]),retry:id=>networkCalls.push(['retry',id]),suspend:()=>networkCalls.push(['suspend']),reset:value=>networkCalls.push(['reset',value]),minimumRtt:()=>987,capabilities:()=>({supported:true,rtcAvailable:true,turnConfigured:false}),metric:()=>({rtt:987,jitter:55,state:'connected',at:timers.now()})};
  const controller=createMultiplayerRoom({baseUrl:'https://example.test/review/',runtime,timers,now:timers.now,random:()=>0,getMemberId:()=> 'member_local_123',
    fetchImpl:async(url,init)=>{requests.push({url:String(url),init});return fetchImpl?fetchImpl(url,init):new Response(JSON.stringify(manifest()));},
    createSocket:url=>{const socket=new Socket(url);sockets.push(socket);return socket;},createNetwork:()=>network,
    identity:{loadDisplayName:()=>displayName,displayNameLocked:()=>locked,lobbyClientId:()=> 'client_local_123',storeDisplayNameOnce(value){if(locked)return{stored:false,name:displayName};displayName=[...value.trim()].slice(0,12).join('');locked=!!displayName;return{stored:locked,name:displayName};}},
    sessions:{load:()=>saved,save:(product,value)=>saves.push({product,value}),clear:product=>clears.push(product)},
    preferences:{load:()=>({shareSingleplayerSettings:true,preferredLoadout:1}),persistPreferredLoadout:(...args)=>prefWrites.push(args),persistShareSingleplayerSettings(){}}});
  after(()=>controller.dispose());
  return {controller,timers,sockets,requests,saves,clears,networkCalls,prefWrites,network,
    async live(next=room(),selected=route()){controller.setRoute(selected);await tick();const socket=sockets.at(-1);assert.ok(socket,JSON.stringify(controller.getSnapshot()));socket.open();socket.state(next);return socket;}};
}

const viewBuild = await build({stdin:{contents:`import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server.node';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {MultiplayerRoomView} from './app/components/MultiplayerRoom';
export function render(controller, snapshot) { const router = createMemoryRouter([{path:'*',element:createElement(MultiplayerRoomView,{controller,snapshot})}],{initialEntries:['/play/'+snapshot.route.productId+'?mpRoom='+snapshot.route.roomCode]});return renderToStaticMarkup(createElement(RouterProvider,{router})); }`,resolveDir:root,loader:'ts'},bundle:true,jsx:'automatic',format:'esm',platform:'node',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},write:false,loader:{'.css':'empty'},plugins:[plugin]});
const viewPath=join(folder,'room-view.mjs');await writeFile(viewPath,viewBuild.outputFiles[0].text);const view=await import(pathToFileURL(viewPath).href);

test('explicit room URL is the only activation; child/settings query changes retain one transport',async()=>{
  for(const path of ['/play/th06mp','/play/th06mp/resources','/play/th06mp/replays','/play/th06mp/saves']) assert.equal(parseMultiplayerRoomRoute(path,'?mpRoom=1234').roomCode,'1234');
  for(const [path,search] of [['/','?mpRoom=1234'],['/lobby','?mpRoom=1234'],['/play/th06','?mpRoom=1234'],['/play/th06mp','?mpRoom=12ab'],['/play/th06mp','']])assert.equal(parseMultiplayerRoomRoute(path,search),null);
  const f=fixture();assert.equal(f.requests.length,0);f.controller.retry();assert.equal(f.sockets.length,0);
  const socket=await f.live();const url=new URL(socket.url);assert.equal(url.searchParams.get('room'),'th06mp-1234');assert.equal(url.searchParams.get('lobby'),'client_local_123');assert.equal(url.searchParams.get('member'),'member_local_123');assert.equal(url.searchParams.get('intent'),'join');assert.equal(url.searchParams.has('directory'),false);assert.equal(url.searchParams.get('key'),'public');
  f.controller.setRoute(parseMultiplayerRoomRoute('/play/th06mp/resources','?mpRoom=1234&uiLocale=en&panel=help'));f.controller.setRoute(parseMultiplayerRoomRoute('/play/th06mp','?mpRoom=1234&roomOptions=1'));f.controller.setRoute(parseMultiplayerRoomRoute('/play/th06mp','?mpRoom=1234'));assert.equal(f.sockets.length,1);assert.equal(socket.closes.length,0);
});

test('create policy reaches real relay; server confirmation consumes intent and only then requests the host seat',async()=>{
  const f=fixture(),socket=await f.live(room(),route('th06mp','3456','&fromLobby=1&lobbyAction=create&lobbyPlayers=3&lobbyDifficulty=2&lobbyVisibility=private&lobbyDisableCheatMovement=1'));
  const url=new URL(socket.url);assert.equal(url.searchParams.get('intent'),'create');assert.equal(url.searchParams.get('players'),'3');assert.equal(url.searchParams.get('difficulty'),'2');assert.equal(url.searchParams.get('visibility'),'private');assert.equal(url.searchParams.get('disableCheatMovement'),'1');
  assert.equal(f.controller.getSnapshot().consumedIntent,true);assert.equal(f.controller.getSnapshot().room.localSeat,null);assert.equal(socket.sent[0].type,'take-seat');assert.equal(socket.sent[0].seat,0);
  socket.state(room({seats:[seat(),null,null]}));assert.equal(f.controller.getSnapshot().room.localSeat,0);
  socket.remoteClose();f.timers.advance(650);assert.equal(new URL(f.sockets[1].url).searchParams.get('intent'),'join');
});

test('directory join takes an empty seat once; direct-link joins do not invent a seat',async()=>{
  const f=fixture(),socket=await f.live(room({seats:[seat({clientId:'other_player_123'}),null,null]}),route('th06mp','1234','&fromLobby=1&lobbyAction=join'));
  assert.equal(socket.sent[0].seat,1);socket.state(room());assert.equal(socket.sent.filter(value=>value.type==='take-seat').length,1);
  const direct=fixture(),plain=await direct.live();assert.equal(plain.sent.length,0);
});

test('membership, seats, ready and settings change only when authoritative snapshots arrive',async()=>{
  const f=fixture(),socket=await f.live();f.controller.takeSeat(1);assert.equal(f.controller.getSnapshot().room.localSeat,null);assert.equal(f.controller.getSnapshot().pendingAction,'take-seat');
  socket.state(room({seats:[null,seat(),null]}));assert.equal(f.controller.getSnapshot().room.localSeat,1);assert.equal(f.controller.getSnapshot().pendingAction,null);
  f.controller.setLoadout(2);assert.equal(f.controller.getSnapshot().preferredLoadout,0);assert.deepEqual(f.prefWrites,[['th06mp',2]]);
  socket.state(room({seats:[null,seat({loadout:2}),null]}));assert.equal(f.controller.getSnapshot().preferredLoadout,2);
  assert.throws(()=>f.controller.setRoomSettings({playerCount:3,difficulty:1,visibility:'public',disableCheatMovement:false}),/P1/);
  f.controller.standUp();assert.equal(f.controller.getSnapshot().room.localSeat,1);socket.state(room());assert.equal(f.controller.getSnapshot().room.localSeat,null);
});

test('owner controls use current seat identities and validate room policy',async()=>{
  const f=fixture(),socket=await f.live(room({seats:[seat(),seat({clientId:'guest_player_123'}),null],spectators:[{clientId:'spectator_player_123',name:'观众'}]}));
  f.controller.setRoomSettings({playerCount:3,difficulty:2,visibility:'private',disableCheatMovement:true});assert.deepEqual(socket.sent.at(-1),{type:'settings',playerCount:3,difficulty:2,visibility:'private',disableCheatMovement:true});
  assert.equal(f.controller.getSnapshot().room.playerCount,2);assert.throws(()=>f.controller.removePlayer(1,'newer_player_123'),/已变化/);
  f.controller.removePlayer(1,'guest_player_123');assert.deepEqual(socket.sent.at(-1),{type:'remove-player',seat:1,clientId:'guest_player_123'});
  f.controller.removeSpectator('spectator_player_123');assert.deepEqual(socket.sent.at(-1),{type:'remove-spectator',clientId:'spectator_player_123'});
  assert.throws(()=>f.controller.removePlayer(0,'client_local_123'),/已变化/);assert.throws(()=>f.controller.setRoomSettings({playerCount:8,difficulty:1,visibility:'public'}),/无效/);
});

test('movement policy is enforced before seat/ready sends and preferences report actual control mode',async()=>{
  const f=fixture(),socket=await f.live(room({disableCheatMovement:true}));f.controller.setInput({movementMode:'touch-unlimited',touchEnabled:true,mobileDevice:true});assert.throws(()=>f.controller.takeSeat(0),/禁用无限移动/);assert.equal(socket.sent.length,0);
  f.controller.setInput({movementMode:'touch',touchEnabled:true,mobileDevice:true});f.controller.takeSeat(0);assert.equal(socket.sent.at(-1).movementMode,'touch');
  socket.state(room({seats:[seat(),null,null]}));f.controller.setInput({movementMode:'joystick-free',touchEnabled:true,mobileDevice:true});assert.equal(socket.sent.at(-1).type,'movement');assert.equal(socket.sent.at(-1).movementMode,'joystick-free');
});

test('absent Runtime adapter never permits ready or start and does not fabricate resource readiness',async()=>{
  const f=fixture(),socket=await f.live(room({seats:[seat({ready:true}),seat({clientId:'guest_player_123',ready:true}),null]}));
  assert.throws(()=>f.controller.setReady(true),/资源准备/);assert.throws(()=>f.controller.start(),/Runtime/);await assert.rejects(f.controller.prepare(),/尚未接入/);assert.equal(socket.sent.length,0);assert.equal(f.controller.getSnapshot().preparation,null);
});

test('resource preparation is single-flight, cancellable and fenced on room departure',async()=>{
  const waiting=deferred(),calls=[],f=fixture({runtime:{prepare:async(product,signal,progress)=>{calls.push({product,signal});progress({status:'preparing',stage:'runtime',percent:40});await waiting.promise;},launch:async()=>{}}});
  const socket=await f.live(room({seats:[seat(),null,null]}));const first=f.controller.prepare(),second=f.controller.prepare();await tick();assert.equal(calls.length,1);assert.equal(f.controller.getSnapshot().preparation.percent,40);
  f.controller.cancelPreparation();assert.equal(calls[0].signal.aborted,true);assert.equal(f.controller.getSnapshot().preparation.status,'cancelled');assert.equal(socket.sent.some(value=>value.type==='set-ready'&&value.ready===false),true);
  waiting.resolve();await Promise.all([first,second]);assert.equal(f.controller.getSnapshot().preparation.status,'cancelled');
  f.controller.setRoute(null);assert.equal(socket.closes.at(-1).reason,'leave room');assert.equal(f.timers.size(),0);
});

test('completed preparation permits explicit ready but a send never optimistically toggles readiness',async()=>{
  const f=fixture({runtime:{prepare:async()=>{},launch:async()=>{}}}),socket=await f.live(room({seats:[seat(),null,null]}));await f.controller.prepare();f.controller.setReady(true);
  assert.equal(socket.sent.at(-1).type,'set-ready');assert.equal(socket.sent.at(-1).ready,true);assert.equal(f.controller.getSnapshot().room.seats[0].ready,false);
  socket.state(room({seats:[seat({ready:true}),null,null]}));assert.equal(f.controller.getSnapshot().room.seats[0].ready,true);
});

test('measured titles preserve automatic/rollback/manual nine-frame policy without treating probe RTT as calibration',async()=>{
  const f=fixture({runtime:{prepare:async()=>{},launch:async()=>{}}}),socket=await f.live(room({seats:[seat({ready:true}),seat({clientId:'guest_player_123',ready:true}),null]}),route('th08mp'));
  await f.controller.prepare();f.controller.start();assert.deepEqual(socket.sent.at(-1),{type:'start',inputDelay:0,adonisMode:1,inputDelayAuto:true,predictionReserve:2,predictionLimit:8});
  f.controller.setTimingChoice({inputDelay:9,rollback:false});f.controller.setTimingChoice({inputDelay:9,rollback:true});f.controller.start();assert.deepEqual(socket.sent.at(-1),{type:'start',inputDelay:9,adonisMode:2,inputDelayAuto:false,predictionReserve:2,predictionLimit:8});
  assert.throws(()=>f.controller.setTimingChoice({inputDelay:10,rollback:true}),/无效/);assert.equal(f.controller.getSnapshot().measuredTiming,null);
});

test('authoritative start hands exact contract options once to the supplied single Runtime owner',async()=>{
  const launches=[],f=fixture({runtime:{prepare:async()=>{},launch:async(value,signal)=>{launches.push({value,signal});}}});
  const socket=await f.live(room({seats:[seat({ready:true}),seat({clientId:'guest_player_123',ready:true,loadout:3}),null]}));await f.controller.prepare();
  const started=room({phase:'starting',startSerial:1,seats:[seat({ready:true}),seat({clientId:'guest_player_123',ready:true,loadout:3}),null]});socket.message({type:'start',serial:1,room:started});await tick();
  assert.equal(launches.length,1);assert.equal(f.controller.getSnapshot().launch,'running');const launch=launches[0].value;assert.equal(launch.serial,1);assert.equal(launch.options.netplayMode,'lan');assert.equal(launch.options.netplaySeed,1234);assert.equal(launch.options.netplayPlayer,0);assert.deepEqual(launch.options.netplayLoadouts,[{character:0,shot:0},{character:1,shot:1}]);
  const url=new URL(launch.options.netplayUrl);assert.equal(url.searchParams.get('run'),'1');assert.equal(url.searchParams.get('player'),'0');assert.equal(url.searchParams.has('lobby'),false);
  socket.message({type:'start',serial:1,room:started});await tick();assert.equal(launches.length,1);assert.equal(f.sockets.length,1);
  socket.state(room({seats:[seat(),seat({clientId:'guest_player_123'}),null],startSerial:1}));assert.equal(f.controller.getSnapshot().launch,'idle');
});

test('measured result mirroring accepts only matching native contracts and never sends a changed result',async()=>{
  const f=fixture(),socket=await f.live(room({phase:'starting',startSerial:4,adonisMode:2,inputDelayAuto:true,inputDelay:0,seats:[seat(),seat({clientId:'guest_player_123'}),null]}),route('th08mp'));
  const timing={phase:'ready',automatic:true,adonisMode:2,inputDelay:1,fullDelay:3,predictionReserve:2,rttP95Us:100000,samples:100,lost:0,route:'rtc'};
  assert.equal(f.controller.acceptMeasuredTiming(timing,3),false);assert.equal(f.controller.acceptMeasuredTiming({...timing,inputDelay:9},4),false);
  assert.equal(f.controller.acceptMeasuredTiming(timing,4),true);assert.deepEqual(socket.sent.at(-1),{type:'timing-result',serial:4,timing});
  assert.equal(f.controller.acceptMeasuredTiming({...timing,route:'relay'},4),false);
});

test('spectator membership is confirmed by relay and gameplay uses spectator role only after start',async()=>{
  const launches=[],f=fixture({runtime:{prepare:async()=>{},launch:async request=>launches.push(request)}}),socket=await f.live();f.controller.spectate();assert.equal(f.controller.getSnapshot().room.localSpectator,false);
  const spectatorRoom=room({spectators:[{clientId:'client_local_123',name:'我'}],spectatorCount:1,seats:[seat({clientId:'other_player_123'}),seat({clientId:'other_guest_123'}),null]});socket.state(spectatorRoom);assert.equal(f.controller.getSnapshot().room.localSpectator,true);
  socket.message({type:'start',serial:1,room:{...spectatorRoom,phase:'starting',startSerial:1}});await tick();assert.equal(launches.length,1);assert.equal(launches[0].options.netplaySpectator,true);assert.equal(new URL(launches[0].options.netplayUrl).searchParams.get('spectator'),'client_local_123');
});

test('transport reconnect backoff and stale sockets cannot mutate a newer room',async()=>{
  const f=fixture(),old=await f.live(room({seats:[seat(),null,null]}));old.remoteClose();assert.equal(f.controller.getSnapshot().connection,'reconnecting');f.timers.advance(650);const next=f.sockets.at(-1);next.open();next.state(room({seats:[seat({name:'新'}),null,null]}));
  old.state(room({seats:[seat({name:'旧'}),null,null]}));old.remoteClose(4010);assert.equal(f.controller.getSnapshot().room.seats[0].name,'新');assert.equal(f.controller.getSnapshot().connection,'connected');
  f.controller.setRoute(route('th08mp','5678'));await tick();assert.equal(next.closes.at(-1).reason,'leave room');next.state(room());assert.equal(f.controller.getSnapshot().route.roomCode,'5678');assert.equal(f.controller.getSnapshot().room,null);
});

test('terminal room conflict is not automatically retried or silently converted to create',async()=>{
  const f=fixture(),socket=await f.live();socket.remoteClose(4009);assert.equal(f.controller.getSnapshot().connection,'unavailable');assert.match(f.controller.getSnapshot().error,/另一个房间/);f.timers.advance(120000);assert.equal(f.sockets.length,1);
});

test('page disposal preserves recovery session but deliberate leave clears membership and all timers',async()=>{
  const f=fixture(),socket=await f.live(room({seats:[seat(),null,null]}));f.controller.dispose();assert.equal(socket.closes.at(-1).reason,'suspend room');assert.equal(f.clears.length,0);assert.ok(f.saves.length);assert.equal(f.timers.size(),0);
  const g=fixture(),other=await g.live();g.controller.leave();assert.equal(other.closes.at(-1).reason,'leave room');assert.deepEqual(g.clears,['th06mp']);assert.equal(g.controller.getSnapshot().route,null);
});

test('late configuration and resource tasks cannot connect or launch a departed route',async()=>{
  const wait=deferred(),f=fixture({fetchImpl:()=>wait.promise});f.controller.setRoute(route());f.controller.setRoute(null);assert.equal(f.requests[0].init.signal.aborted,true);wait.resolve(new Response(JSON.stringify(manifest())));await tick();assert.equal(f.sockets.length,0);
  const calls=[],g=fixture({runtime:{prepare:async()=>calls.push('prepare'),launch:async()=>calls.push('launch')}});await g.live();const task=g.controller.prepare();g.controller.leave();await task;assert.deepEqual(calls,[]);
});

test('display name locks once and room probes stay separate from game input',async()=>{
  const f=fixture(),socket=await f.live(room({seats:[seat(),seat({clientId:'guest_player_123'}),null]}));f.controller.setDisplayName('名字');assert.equal(socket.sent.at(-1).type,'set-name');assert.throws(()=>f.controller.setDisplayName('别名'),/不能更改/);
  assert.equal(f.networkCalls.some(([type,value])=>type==='update'&&value.active),true);socket.message({type:'room-probe',from:'guest_player_123',lane:'relay',echo:'ping:1'});assert.equal(f.networkCalls.at(-1)[0],'receive');
  f.controller.noteActivity();f.controller.noteActivity();assert.equal(socket.sent.filter(value=>value.type==='activity').length,1);f.timers.advance(15000);f.controller.noteActivity();assert.equal(socket.sent.filter(value=>value.type==='activity').length,2);
});

test('root room owner rejects imports resolved after pagehide and recovers after pageshow',async()=>{
  const wait=deferred(),target=new EventTarget(),created=[];const owner=createMultiplayerRoomDocumentOwner({target,load:()=>wait.promise,onController(){},onError(error){throw error;}});
  owner.attach();await tick();target.dispatchEvent(new Event('pagehide'));wait.resolve(()=>{const item={disposeCount:0,dispose(){this.disposeCount++;}};created.push(item);return item;});await tick();assert.equal(created.length,0);
  target.dispatchEvent(new Event('pageshow'));await tick();assert.equal(created.length,1);owner.detach();owner.attach();await tick();assert.equal(created.length,1);owner.dispose();assert.equal(created[0].disposeCount,1);
});


test('React room view renders the real snapshot, accessible seats and honest unavailable gameplay controls',async()=>{
  const f=fixture();await f.live(room({seats:[seat(),seat({clientId:'guest_player_123',name:'来客',offline:true}),null]}),route('th08mp'));
  const html=view.render(f.controller,f.controller.getSnapshot());
  assert.match(html,/aria-label="联机房间"/);assert.match(html,/aria-label="P1 房主"/);assert.match(html,/来客/);assert.match(html,/正在重连/);
  assert.match(html,/多人资源准备与游戏启动尚未接入/);assert.match(html,/disabled=""[^>]*>准备<\/button>/);assert.match(html,/<option value="9">9 帧<\/option>/);
  assert.match(html,/独立探测连接/);assert.doesNotMatch(html,/<iframe/);
});

test('changing the Runtime port invalidates resource readiness and revokes outstanding ready state',async()=>{
  const f=fixture({runtime:{prepare:async()=>{},launch:async()=>{}}}),socket=await f.live(room({seats:[seat({ready:true}),null,null]}));await f.controller.prepare();
  f.controller.setRuntimePort(undefined);assert.equal(f.controller.getSnapshot().preparation,null);assert.equal(f.controller.getSnapshot().runtimeAvailable,false);
  assert.equal(socket.sent.at(-1).type,'set-ready');assert.equal(socket.sent.at(-1).ready,false);assert.throws(()=>f.controller.start(),/Runtime/);
});


test('old start events cannot regress a newer room and spectator admission may start the current serial once',async()=>{
  const launches=[],f=fixture({runtime:{prepare:async()=>{},launch:async request=>launches.push(request)}});
  const current=room({phase:'starting',startSerial:4,seats:[seat({clientId:'other_player_123'}),seat({clientId:'other_guest_123'}),null],spectators:[{clientId:'client_local_123',name:'我'}],spectatorCount:1});
  const socket=await f.live(current);socket.message({type:'start',serial:3,room:room()});assert.equal(f.controller.getSnapshot().room.phase,'starting');assert.equal(f.controller.getSnapshot().startSerial,4);
  socket.message({type:'spectator-start',serial:4,room:current});await tick();assert.equal(launches.length,1);socket.message({type:'spectator-start',serial:4,room:current});await tick();assert.equal(launches.length,1);
  f.controller.runtimeExited(3);assert.equal(f.controller.getSnapshot().launch,'running');f.controller.runtimeExited(4);assert.equal(f.controller.getSnapshot().launch,'idle');
});
