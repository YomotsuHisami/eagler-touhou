import assert from 'node:assert/strict';
import { createRoomNetwork, recordProbeSample, freshProbeMetric } from '../.cache/build/browser/assets/launcher/room-network.mjs';
import { roomProbeEnvelope } from '../server/room-probe-policy.mjs';

const blank = { rtt: null, jitter: null, state: 'checking', at: 0 };
const first = recordProbeSample(blank, 24, 0);
assert.equal(first.jitter, null);
assert.equal(recordProbeSample(first, 31, 100).jitter, 7);
for (const invalid of [-1, Infinity, NaN, 10001]) assert.equal(recordProbeSample(first, invalid, 10), first);
assert.equal(freshProbeMetric(first, 8001).rtt, null, 'stale samples cannot remain green');

const targets = new Set(['peer']);
const envelope = { type: 'room-probe', to: 'peer', from: 'spoof', lane: 'relay', echo: 'ping:1' };
assert.deepEqual(roomProbeEnvelope(envelope, 'me', targets), { type: 'room-probe', from: 'me', lane: 'relay', echo: 'ping:1' });
for (const patch of [{to:'other'}, {to:'me'}, {lane:'input'}, {echo:'ping:1:extra'}, {echo:'pong:NaN'}])
  assert.equal(roomProbeEnvelope({...envelope,...patch}, 'me', targets), null);
assert.equal(roomProbeEnvelope({...envelope,lane:'direct',token:'a',description:{type:'offer',sdp:'x'.repeat(16385)}},'me',targets),null);
assert.equal(roomProbeEnvelope({...envelope,lane:'direct',token:'a',candidate:{candidate:'x',sdpMLineIndex:9}},'me',targets),null);
assert.equal(roomProbeEnvelope({...envelope,lane:'turn',token:'a',restart:true},'me',targets).restart,true);

// A fake clock/RTC endpoint checks resource ownership and measured RTT, without a browser or game Runtime.
const saved = { performance: globalThis.performance, window: globalThis.window, RTCPeerConnection: globalThis.RTCPeerConnection, clearInterval: globalThis.clearInterval };
let now = 0, interval, pcs = [], sent = [];
globalThis.performance = { now: () => now };
globalThis.window = { setInterval: callback => { interval = callback; return 1; } };
globalThis.clearInterval = () => { interval = null; };
class FakePC {
  constructor(config) { this.config=config; pcs.push(this); }
  createDataChannel() { return this.channel = { readyState:'connecting', send: value => { this.lastPing=value; }, close: () => { this.channel.readyState='closed'; } }; }
  async createOffer() { return {type:'offer',sdp:'test'}; }
  async createAnswer() { return {type:'answer',sdp:'test'}; }
  async setLocalDescription(value) { this.localDescription = {toJSON:()=>value}; }
  async setRemoteDescription(value) { this.remoteDescription=value; }
  async addIceCandidate() {}
  close() { this.closed=true; }
}
globalThis.RTCPeerConnection=FakePC;
const network=createRoomNetwork({send:message=>{sent.push(message);return true;},changed:()=>{}});
const settle=async()=>{for(let i=0;i<6;i++) await Promise.resolve();};
try {
  network.update({localId:'a',peers:['b'],active:true});
  assert.equal(pcs.length,0,'old relays must not start unsupported probes');
  await network.receive({type:'room-probe-config',iceServers:[{urls:['stun:example.test','turn:example.test'],username:'test',credential:'test'}]});
  network.update({localId:'a',peers:['b'],active:true}); await settle();
  assert.equal(pcs.length,2);
  assert.deepEqual(pcs[0].config.iceServers[0].urls,['stun:example.test']);
  assert.equal(pcs[1].config.iceTransportPolicy,'relay');
  assert.deepEqual(pcs[1].config.iceServers[0].urls,['turn:example.test']);
  const echo=sent.find(message=>message.lane==='relay').echo;
  now=42; await network.receive({type:'room-probe',from:'b',lane:'relay',echo:echo.replace('ping:','pong:')});
  assert.equal(network.metric('b','relay').rtt,42);
  pcs[0].channel.readyState='open'; pcs[0].channel.onopen();
  now=58; pcs[0].channel.onmessage({data:pcs[0].lastPing.replace('ping:','pong:')});
  assert.equal(network.metric('b','direct').rtt,16);
  assert.equal(network.minimumRtt(['b']),16,'minimum spans the whole room session and all measured lanes');
  now=100; interval();
  now=150; pcs[0].channel.onmessage({data:pcs[0].lastPing.replace('ping:','pong:')});
  assert.equal(network.metric('b','direct').rtt,50);
  assert.equal(network.minimumRtt(['b']),16,'later slower samples do not replace the minimum');
  network.update({localId:'a',peers:['b','c'],active:true}); await settle();
  interval();
  const cEcho=sent.findLast(message=>message.to==='c'&&message.lane==='relay').echo;
  now+=30; await network.receive({type:'room-probe',from:'c',lane:'relay',echo:cEcho.replace('ping:','pong:')});
  assert.equal(network.minimumRtt(['b','c']),30,'three players use the greater of the other two player minima');
  const cPCs=pcs.slice(2);
  network.retry('c');
  assert.ok(cPCs.every(pc=>pc.closed),'retry closes only the selected peer');
  assert.ok(!pcs[0].closed,'retry keeps other peer connections alive');
  assert.equal(network.metric('b','direct').rtt,50,'retry preserves other peer measurements');
  assert.equal(network.minimumRtt(['b','c']),30,'retry preserves session minima');
  network.update({localId:'a',peers:['b'],active:true});
  const oldPC=pcs[0];
  network.update({localId:'a',peers:['b'],active:false});
  assert.ok(pcs.every(pc=>pc.closed)); assert.equal(interval,null,'no probes during a run or spectating');
  oldPC.channel.onmessage({data:'pong:1'}); assert.equal(network.metric('b','direct').rtt,null);
  assert.equal(network.minimumRtt(['b']),16,'pausing probes during a run retains session minimum');
  network.reset(true);
  assert.equal(network.minimumRtt(['b']),16,'socket reconnect retains session minimum');
  await network.receive({type:'room-probe-config',iceServers:[]});
  network.update({localId:'z',peers:['b'],active:true});
  now+=13000; interval();
  assert.equal(network.metric('b','direct').state,'unavailable','missing offers have a bounded wait');
  network.retry();
  assert.ok(sent.some(message=>message.restart===true&&message.to==='b'),'answerer requests an offer on retry');
  network.reset();
  assert.equal(network.minimumRtt(['b']),null,'leaving the room clears session minima');
  assert.equal(network.metric('b','relay').state,'unavailable');
} finally { Object.assign(globalThis,saved); }
console.log('PASS room probe policy, RTT freshness, lane separation, retry and lifecycle');
