import assert from 'node:assert/strict';
import {parseMeasuredNetplayTiming} from '../lib/contracts/netplay-timing.mjs';
import {buildMultiplayerRuntimeOptions} from '../.cache/build/browser/assets/launcher/multiplayer-runtime-options.mjs';
import {normalizeMultiplayerLobbySnapshot} from '../.cache/build/browser/assets/launcher/multiplayer-lobby-snapshot.mjs';
import {isSpectatorFrameForRoom} from '../server/spectator-frame.mjs';

const timing={phase:'ready',automatic:true,adonisMode:2,inputDelay:2,fullDelay:4,
  predictionReserve:2,rttP95Us:90000,samples:117,lost:5,route:'rtc'};
assert.deepEqual(parseMeasuredNetplayTiming(timing),timing);
assert.equal(parseMeasuredNetplayTiming({...timing,adonisMode:1,predictionReserve:0,inputDelay:4}).inputDelay,4);
assert.equal(parseMeasuredNetplayTiming({...timing,predictionReserve:1,inputDelay:3}).inputDelay,3);
assert.equal(parseMeasuredNetplayTiming({...timing,automatic:false,inputDelay:0}).inputDelay,0);
for(const mutation of [{phase:'measuring'},{inputDelay:9},{fullDelay:3},{predictionReserve:0},{rttP95Us:0},
  {rttP95Us:'90000'},{samples:95},{samples:121},{lost:49},{automatic:1},{route:'guess'},{inputDelay:2.5}])
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
  {url:base.url.replace('th09mp','th08mp')}])assert.throws(()=>buildMultiplayerRuntimeOptions({...base,...mutation},constraints));
const context={localClientId:'timing_test_p1',...constraints};
const room={playerCount:2,difficulty:1,inputDelay:2,inputDelayAuto:true,predictionReserve:2,adonisMode:2,timing,phase:'running'};
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
for(const mutation of [{inputDelay:7},{rttP95Us:0},{samples:20},{lost:49},{adonisMode:1}])
  assert.equal(isSpectatorFrameForRoom('th09mp-1234',packet({...timing,...mutation}),2),false);
console.log('Measured timing types, auto/manual ownership, prediction reserve and spectator metadata PASS');
