/** L3/module + local relay protocol. No game engine, browser or public-network evidence. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {PRODUCT_GAMES, multiplayerConfigForProduct, multiplayerInputTimingPolicy,
  isMultiplayerProductId, gameIdForProduct} from '../lib/contracts/product-catalog.mjs';
import {buildMultiplayerRuntimeOptions} from '../.cache/build/browser/assets/launcher/multiplayer-runtime-options.mjs';
import {normalizeMultiplayerLobbySnapshot} from '../.cache/build/browser/assets/launcher/multiplayer-lobby-snapshot.mjs';
import {isSpectatorFrameForRoom} from '../server/spectator-frame.mjs';
import {loadRuntimeBuildConfig, getRuntimeBuildProfile} from '../lib/runtime-build-profiles.mjs';
import {DEVELOPMENT_CONTENT} from '../lib/development-content.mjs';
import {projectRelativeWorkspacePath} from '../lib/workspace-layout.mjs';

const game=PRODUCT_GAMES.th11, policy=multiplayerConfigForProduct('th11mp');
assert.equal(isMultiplayerProductId('th11mp'),true);
assert.equal(gameIdForProduct('th11mp'),'th11');
assert.equal(game.multiplayerRuntime,'./runtime/th11/multiplayer/th11.html');
assert.equal(policy.peerTransportGlobal,'__th11PeerTransport');
assert.deepEqual(policy.playerCounts,[2,3]);
assert.deepEqual(policy.difficulties,['Easy','Normal','Hard','Lunatic','Extra']);
assert.deepEqual(policy.loadouts.map(x=>[x.character,x.shot]),[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
assert.equal(policy.spectator,true);
assert.equal(policy.titleRoomEntry,false);
assert.equal(policy.gameplay,'cooperative');
assert.equal(Object.hasOwn(policy,'challengeMode'),false,'challenge is a shared cooperative room rule, not a per-title capability');
assert.deepEqual(multiplayerInputTimingPolicy(policy),{measuredStartup:true,rollback:false,manualDelayLimit:9,predictionLimit:0});
for(const id of ['th06mp','th07mp','th08mp','th10mp']) assert.equal(multiplayerConfigForProduct(id).gameplay,'cooperative');
for(const id of ['th08mp','th09mp','th10mp']) assert.equal(multiplayerInputTimingPolicy(multiplayerConfigForProduct(id)).rollback,true);
assert.equal(game.replay.prefix,'th11');
const builds=await loadRuntimeBuildConfig();
assert.equal(builds.games.th11.builder,'prebuilt');
assert.equal(builds.games.th11.workspaceRepository,'th11');
assert.deepEqual(builds.games.th11.variants.multiplayer,{workspaceRepository:'th11mp',features:{thcrap:true,thprac:false},cache:{}});
assert.equal((await getRuntimeBuildProfile('th11','normal')).workspaceRepository,'th11');
assert.equal((await getRuntimeBuildProfile('th11','multiplayer')).workspaceRepository,'th11mp');
assert.equal(DEVELOPMENT_CONTENT.games.th11.runtime,projectRelativeWorkspacePath('th11','build-eagler','th11.html')+'?hosted=1');
assert.equal(DEVELOPMENT_CONTENT.games.th11.multiplayerRuntime,projectRelativeWorkspacePath('th11mp','build-eagler-multiplayer','th11.html')+'?hosted=1');
const guide=await readFile(new URL('../content/MULTIPLAYER.md',import.meta.url),'utf8');
assert.match(guide,/## TH11 地灵殿/);assert.match(guide,/高危/);assert.match(guide,/不启用预测或回滚/);
assert.match(guide,/挑战模式遵循上文通用规则，默认关闭/);assert.doesNotMatch(guide,/不提供挑战模式/);

const base={url:'ws://localhost/?room=th11mp-1234&run=1&player=0&players=2&member=member_test_1234',
  player:0,playerCount:2,seed:1234,difficulty:4,loadouts:[{character:0,shot:0},{character:1,shot:2}],
  inputDelay:0,inputDelayAuto:true,adonisMode:1,predictionReserve:2,predictionLimit:0,challengeMode:false,
  spectator:false,spectatorId:'',spectatorCount:0,iceServers:[]};
const configured=buildMultiplayerRuntimeOptions(base,policy);
assert.equal(configured.netplayAdonisMode,1);assert.equal(configured.netplayPredictionLimit,0);
assert.equal(configured.netplayPredictionReserve,2);assert.equal(configured.netplayInputDelay,0);
assert.equal(configured.netplayChallengeMode,false);assert.equal(configured.netplayDifficulty,4);
assert.deepEqual(configured.netplayLoadouts,base.loadouts);
for(const challengeMode of [false,true]) for(const d of [0,1,9]){
  const options=buildMultiplayerRuntimeOptions({...base,challengeMode,inputDelayAuto:false,inputDelay:d},policy);
  assert.equal(options.netplayChallengeMode,challengeMode);assert.equal(options.netplayInputDelay,d);
  assert.equal(options.netplayAdonisMode,1);assert.equal(options.netplayPredictionLimit,0);
}
for(const patch of [{adonisMode:0},{adonisMode:2},{adonisMode:undefined},{predictionLimit:1},
  {predictionReserve:0},{inputDelay:10,inputDelayAuto:false},{challengeMode:'true'},
  {difficulty:5},{loadouts:[{character:0,shot:0},{character:2,shot:0}]}])
  assert.throws(()=>buildMultiplayerRuntimeOptions({...base,...patch},policy),JSON.stringify(patch));
assert.throws(()=>buildMultiplayerRuntimeOptions({...base,challengeMode:true,adonisMode:2},policy),/纯延迟/);
assert.throws(()=>buildMultiplayerRuntimeOptions({...base,adonisMode:2},PRODUCT_GAMES.th10.multiplayer),
  /纯延迟/,'URL product policy cannot be bypassed with unrelated permissive constraints');
const watcher=buildMultiplayerRuntimeOptions({...base,challengeMode:true,player:null,spectator:true,spectatorId:'watcher_test_123'},policy);
assert.equal(watcher.netplayPlayer,null);assert.equal(watcher.netplayPredictionLimit,0);assert.equal(watcher.netplayChallengeMode,true);

const timing={phase:'ready',automatic:true,adonisMode:1,inputDelay:3,fullDelay:3,predictionReserve:0,
  rttP95Us:90000,samples:117,lost:5,route:'rtc'};
const room={playerCount:2,difficulty:4,inputDelay:3,inputDelayAuto:true,predictionReserve:2,predictionLimit:0,
  adonisMode:1,challengeMode:false,phase:'running',timing};
const context={localClientId:'member_test_1234',...policy};
assert.deepEqual(normalizeMultiplayerLobbySnapshot(room,context).timing,timing);
for(const challengeMode of [false,true]) assert.equal(normalizeMultiplayerLobbySnapshot({...room,challengeMode},context).challengeMode,challengeMode);
for(const patch of [{adonisMode:2},{adonisMode:0},{predictionLimit:1},
  {timing:{...timing,adonisMode:2,predictionReserve:2,inputDelay:1}}])
  assert.equal(normalizeMultiplayerLobbySnapshot({...room,challengeMode:true,...patch},context),null);
function timingPacket(value,marker=0x42) {
  const bytes=new Uint8Array(40),view=new DataView(bytes.buffer);
  bytes.set([0x45,marker,0x54,0x4d,1,value.adonisMode,value.inputDelay,value.predictionReserve]);
  for(const [offset,key] of [[8,'fullDelay'],[24,'rttP95Us'],[28,'lost'],[32,'automatic'],[36,'samples']])view.setUint32(offset,Number(value[key]),true);
  return bytes;
}
for(const count of [2,3]){
  const packet=timingPacket(timing);
  assert.equal(isSpectatorFrameForRoom('th11mp-1234',packet,count),true);
  for(const other of ['th08mp-1234','th10mp-1234','th09mp-1234'])assert.equal(isSpectatorFrameForRoom(other,packet,count),false);
  for(const marker of [0x38,0x41])assert.equal(isSpectatorFrameForRoom('th11mp-1234',timingPacket(timing,marker),count),false);
  assert.equal(isSpectatorFrameForRoom('th11mp-1234',timingPacket({...timing,adonisMode:2,predictionReserve:2,inputDelay:1}),count),false);
  assert.equal(isSpectatorFrameForRoom('th11mp-1234',timingPacket({...timing,predictionReserve:1}),count),false);
  const frame=new Uint8Array(24+count*12);frame.set([0x45,0x42,0x4e,0x50,4,3,count,0]);
  assert.equal(isSpectatorFrameForRoom('th11mp-1234',frame,count),true);
  assert.equal(isSpectatorFrameForRoom('th10mp-1234',frame,count),false);
  assert.equal(isSpectatorFrameForRoom('th11mp-1234',frame,count===2?3:2),false);
  frame[7]=1;assert.equal(isSpectatorFrameForRoom('th11mp-1234',frame,count),false);
}
assert.equal(isSpectatorFrameForRoom('th11mp-1234',timingPacket(timing),1),false);

const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;server.close(error=>error?reject(error):resolve(port));
  });
});
const root=fileURLToPath(new URL('..',import.meta.url));
const relay=spawn(process.execPath,[fileURLToPath(new URL('../server/netplay-relay.mjs',import.meta.url))],{
  cwd:root,env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(port),EAGLER_NETPLAY_STUN_URLS:''},
  stdio:['ignore','pipe','pipe'],
});
let relayLog='';relay.stdout.on('data',chunk=>{relayLog+=String(chunk);});relay.stderr.on('data',chunk=>{relayLog+=String(chunk);});
const sockets=[];
function nextJson(socket,predicate=()=>true){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('relay response timeout\n'+relayLog));},5000);
    const onMessage=event=>{try{const message=JSON.parse(String(event.data));if(predicate(message)){cleanup();resolve(message);}}catch(error){cleanup();reject(error);}};
    const onClose=()=>{cleanup();reject(Error('relay closed before response\n'+relayLog));};
    function cleanup(){clearTimeout(timer);socket.removeEventListener('message',onMessage);socket.removeEventListener('close',onClose);}
    socket.addEventListener('message',onMessage);socket.addEventListener('close',onClose);
  });
}
async function connect(code,index,count,challenge){
  const query=new URLSearchParams({room:'th11mp-'+code,lobby:'th11_client_'+code+'_'+index,member:'private_th11_'+code+'_'+index,
    intent:index===0?'create':'join',players:String(count),difficulty:'4',...(challenge===undefined?{}:{challengeMode:challenge?'1':'0'})});
  const socket=new WebSocket('ws://127.0.0.1:'+port+'/?'+query);sockets.push(socket);
  const first=await nextJson(socket);
  assert.equal(first.type,'state',`room ${code} player ${index}: ${JSON.stringify(first)}`);assert.equal(first.room.adonisMode,1);assert.equal(first.room.predictionLimit,0);
  assert.equal(first.room.challengeMode,challenge??false);
  return socket;
}
async function send(socket,message,predicate){const result=nextJson(socket,predicate);socket.send(JSON.stringify(message));return result;}
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('relay listen timeout\n'+relayLog)),5000);
    const receive=chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);relay.stdout.off('data',receive);resolve();}};
    relay.stdout.on('data',receive);relay.once('exit',code=>{clearTimeout(timer);reject(Error('relay exited '+code+'\n'+relayLog));});
  });
  for(const [count,automatic,code] of [[2,true,'9101'],[3,false,'9102']]){
    const peers=[];
    for(let index=0;index<count;index++){
      const peer=await connect(code,index,count,count===3?true:undefined);peers.push(peer);
      await send(peer,{type:'take-seat',seat:index,loadout:index===0?3:5},reply=>!!reply.room?.seats[index]);
    }
    if(count===3) await send(peers[0],{type:'settings',playerCount:count,difficulty:4,challengeMode:false},reply=>reply.room?.challengeMode===false);
    for(let index=0;index<count;index++) await send(peers[index],{type:'set-ready',ready:true},reply=>reply.room?.seats[index]?.ready===true);
    const changed=await send(peers[0],{type:'settings',playerCount:count,difficulty:4,challengeMode:true},reply=>reply.room?.challengeMode===true);
    assert.equal(changed.room.seats.slice(0,count).every(seat=>seat?.ready===false),true,'changing challenge invalidates every player readiness');
    assert.equal(normalizeMultiplayerLobbySnapshot(changed.room,context).challengeMode,true);
    for(let index=0;index<count;index++) await send(peers[index],{type:'set-ready',ready:true},reply=>reply.room?.seats[index]?.ready===true);
    for(const patch of [{adonisMode:0},{adonisMode:2},{adonisMode:undefined},{predictionLimit:1},{predictionReserve:0},{inputDelay:10,inputDelayAuto:false}]){
      await send(peers[0],{type:'start',adonisMode:1,inputDelay:0,inputDelayAuto:true,predictionReserve:2,...patch},reply=>reply.type==='error'&&/timing/.test(reply.error));
    }
    const started=await send(peers[0],{type:'start',adonisMode:1,inputDelay:automatic?0:3,inputDelayAuto:automatic,predictionReserve:2},reply=>reply.type==='start');
    assert.equal(started.room.adonisMode,1);assert.equal(started.room.predictionLimit,0);assert.equal(started.room.challengeMode,true);
    const running=normalizeMultiplayerLobbySnapshot(started.room,context);
    const runtime=buildMultiplayerRuntimeOptions({...base,playerCount:count,challengeMode:running.challengeMode,
      loadouts:started.room.seats.slice(0,count).map(seat=>policy.loadouts[seat.loadout])},policy);
    assert.equal(runtime.netplayChallengeMode,true);assert.equal(runtime.netplayPredictionLimit,0);
    const result={...timing,automatic,route:'relay'};
    await send(peers[0],{type:'timing-result',serial:started.serial,timing:{...result,adonisMode:2,inputDelay:1,predictionReserve:2}},reply=>reply.type==='error');
    const confirmed=await send(peers[0],{type:'timing-result',serial:started.serial,timing:result},reply=>!!reply.room?.timing);
    assert.equal(confirmed.room.timing.predictionReserve,0);assert.equal(confirmed.room.timing.adonisMode,1);
    assert.equal(confirmed.room.inputDelay,3);assert.equal(confirmed.room.playerCount,count);assert.equal(confirmed.room.challengeMode,true);
  }
}finally{
  for(const socket of sockets) socket.close();
  relay.kill();
}
console.log('TH11 MP catalog, shared cooperative challenge, P0 timing, EBTM/EBNP and local 2P/3P relay policy PASS');
