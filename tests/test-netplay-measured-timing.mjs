import assert from 'node:assert/strict';
import {parseMeasuredNetplayTiming,resolveAdonisPredictionReserve} from '../lib/contracts/netplay-timing.mjs';
import {buildMultiplayerRuntimeOptions} from '../.cache/build/browser/assets/launcher/multiplayer-runtime-options.mjs';
import {normalizeMultiplayerLobbySnapshot} from '../.cache/build/browser/assets/launcher/multiplayer-lobby-snapshot.mjs';
import {isSpectatorFrameForRoom} from '../server/spectator-frame.mjs';

const timing={phase:'ready',automatic:true,adonisMode:2,inputDelay:1,fullDelay:3,
  predictionReserve:2,rttP95Us:90000,samples:117,lost:5,route:'rtc'};
assert.deepEqual(parseMeasuredNetplayTiming(timing),timing);
assert.equal(parseMeasuredNetplayTiming({...timing,adonisMode:1,predictionReserve:0,inputDelay:3}).inputDelay,3);
assert.equal(parseMeasuredNetplayTiming({...timing,predictionReserve:1,inputDelay:2}).inputDelay,2);
assert.equal(parseMeasuredNetplayTiming({...timing,rttP95Us:32000,adonisMode:1,predictionReserve:0,fullDelay:1,inputDelay:1}).inputDelay,1);
assert.equal(parseMeasuredNetplayTiming({...timing,rttP95Us:32000,predictionReserve:0,fullDelay:1,inputDelay:1}).inputDelay,1);
assert.equal(parseMeasuredNetplayTiming({...timing,rttP95Us:32000,predictionReserve:1,fullDelay:1,inputDelay:0}),null);
assert.equal(parseMeasuredNetplayTiming({...timing,rttP95Us:32000,automatic:false,predictionReserve:1,fullDelay:1,inputDelay:0}).inputDelay,0);
assert.equal(parseMeasuredNetplayTiming({...timing,automatic:false,inputDelay:0}).inputDelay,0);
for(const mutation of [{phase:'measuring'},{inputDelay:9},{fullDelay:4},{predictionReserve:0},{rttP95Us:0},
  {rttP95Us:'90000'},{samples:95},{samples:121},{lost:73},{automatic:1},{route:'guess'},{inputDelay:2.5}])
  assert.equal(parseMeasuredNetplayTiming({...timing,...mutation}),null,JSON.stringify(mutation));
const constraints={playerCounts:[2],difficulties:['Easy','Normal'],loadouts:[{character:0,shot:0},{character:1,shot:0}]};
const base={url:'ws://localhost/?room=th09mp-1234&run=1&player=0&players=2',player:0,playerCount:2,seed:100,difficulty:1,
  inputDelay:0,adonisMode:2,inputDelayAuto:true,predictionReserve:2,spectator:false,spectatorId:'',spectatorCount:0,iceServers:[],loadouts:constraints.loadouts};
for(const adonisMode of [1,2])for(const predictionReserve of [1,2]){
  const o=buildMultiplayerRuntimeOptions({...base,adonisMode,predictionReserve},constraints);
  assert.equal(o.netplayInputDelayAuto,true);assert.equal(o.netplayInputDelay,0);assert.equal(o.netplayPredictionReserve,predictionReserve);
}
for(const inputDelay of [0,1,9])assert.equal(buildMultiplayerRuntimeOptions({...base,inputDelay,inputDelayAuto:false},constraints).netplayInputDelay,inputDelay);
for(const mutation of [{inputDelayAuto:'true'},{predictionReserve:0},{predictionReserve:3},{adonisMode:0},
  {url:base.url.replace('th09mp','th07mp')}])assert.throws(()=>buildMultiplayerRuntimeOptions({...base,...mutation},constraints));
for(const game of ['th08mp','th10mp']){
  const o=buildMultiplayerRuntimeOptions({...base,url:base.url.replace('th09mp',game)},constraints);
  assert.equal(o.netplayInputDelayAuto,true);assert.equal(o.netplayAdonisMode,2);
  const watcher=buildMultiplayerRuntimeOptions({...base,url:base.url.replace('th09mp',game),inputDelay:3,
    spectator:true,spectatorId:'watcher123'},constraints);
  assert.equal(watcher.netplayInputDelay,0,'Automatic spectator starts unresolved and applies stream metadata exactly once');
}
assert.equal(parseMeasuredNetplayTiming({...timing,lost:72}).lost,72,'Three participant reports may each lose 24 accepted samples');
const context={localClientId:'timing_test_p1',...constraints};
const room={playerCount:2,difficulty:1,inputDelay:1,inputDelayAuto:true,predictionReserve:2,adonisMode:2,timing,phase:'running'};
for(const [rttP95Us,fullDelay] of [[32000,1],[60000,2],[90000,3],[120000,4],[150000,5]]) {
  const predictionReserve=resolveAdonisPredictionReserve(fullDelay,2,true),inputDelay=fullDelay-predictionReserve;
  const resolved={...timing,rttP95Us,fullDelay,predictionReserve,inputDelay};
  assert.equal(inputDelay,Math.max(1,fullDelay-2));
  assert.deepEqual(parseMeasuredNetplayTiming(resolved),resolved);
  assert.deepEqual(normalizeMultiplayerLobbySnapshot({...room,inputDelay,timing:resolved},context).timing,resolved);
  assert.equal(isSpectatorFrameForRoom('th09mp-1234',packet(resolved),2),true);
}
assert.equal(normalizeMultiplayerLobbySnapshot({...room,predictionReserve:1},context),null);
assert.deepEqual(normalizeMultiplayerLobbySnapshot(room,context).timing,timing);
assert.equal(normalizeMultiplayerLobbySnapshot({...room,timing:{...timing,inputDelay:7}},context),null);
assert.equal(normalizeMultiplayerLobbySnapshot({...room,inputDelayAuto:1},context),null);
assert.equal(normalizeMultiplayerLobbySnapshot({...room,inputDelay:3},context),null);
assert.equal(normalizeMultiplayerLobbySnapshot({...room,inputDelayAuto:false},context),null);
function packet(t){const b=new Uint8Array(40),v=new DataView(b.buffer);b.set([84,57,84,77,1,t.adonisMode,t.inputDelay,t.predictionReserve]);
  v.setUint32(8,t.fullDelay,true);v.setUint32(24,t.rttP95Us,true);v.setUint32(28,t.lost,true);v.setUint32(32,+t.automatic,true);v.setUint32(36,t.samples,true);return b;}
assert.equal(isSpectatorFrameForRoom('th09mp-1234',packet(timing),2),true);
assert.equal(isSpectatorFrameForRoom('th08mp-1234',packet(timing),2),false);
assert.equal(isSpectatorFrameForRoom('th09mp-1234',packet(timing),3),false);
for(const mutation of [{inputDelay:7},{rttP95Us:0},{samples:20},{lost:73},{adonisMode:1}])
  assert.equal(isSpectatorFrameForRoom('th09mp-1234',packet({...timing,...mutation}),2),false);
console.log('Measured timing types, auto/manual ownership, prediction reserve and spectator metadata PASS');
for(const [game,code] of [['th08mp',56],['th10mp',65]])for(const count of [2,3]){
  const bytes=packet(timing);bytes.set([69,code,84,77]);
  assert.equal(isSpectatorFrameForRoom(game+'-1234',bytes,count),true);
  assert.equal(isSpectatorFrameForRoom((game==='th08mp'?'th10mp':'th08mp')+'-1234',bytes,count),false);
  bytes[6]=7;assert.equal(isSpectatorFrameForRoom(game+'-1234',bytes,count),false);
}
