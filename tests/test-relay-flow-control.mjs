// Owner behavior: memory/traffic budgets fail closed, including delayed sends
// and optional spectator history. Fake clocks avoid timing-dependent limits.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RELAY_LIMITS, createRelayMessageGate, acceptRelayMessage, createBoundedRelaySender,
  normalizeRelaySignal, appendSpectatorHistory, clearSpectatorHistory, hasPendingSpectators,
  validRelayControlMessage } from '../server/relay-flow-control.mjs';

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = []; closed = null;
  send(payload, options) { this.sent.push({ payload, options }); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(1006, 'terminated'); }
}

let time = 0;
const gate = createRelayMessageGate({ maxBytes: 100, messagesPerSecond: 2, bytesPerSecond: 100, now: () => time });
assert.equal(gate(100), null); assert.equal(gate(100), null);
assert.equal(gate(1).code, 1008, 'byte exhaustion cannot be bypassed by another small frame');
time = 1000; assert.equal(gate(100), null, 'budget refills without exceeding its burst ceiling');
assert.equal(gate(101).code, 1009);
for (const value of [NaN, Infinity, -1, undefined]) assert.equal(gate(value).code, 1009);
const tiny = createRelayMessageGate({ maxBytes: 100, messagesPerSecond: 2, bytesPerSecond: 100, now: () => 0 });
for (let i = 0; i < 4; i++) assert.equal(tiny(0), null);
assert.equal(tiny(0).code, 1008, 'empty frames still consume the message budget');
const utf8 = new Socket();
assert.equal(acceptRelayMessage(utf8, '汉汉', createRelayMessageGate({ maxBytes: 4, messagesPerSecond: 1, bytesPerSecond: 4 })), false);
assert.equal(utf8.closed.code, 1009, 'text limits count bytes, not UTF-16 characters');

const timers = new Map(); let nextTimer = 0;
const send = createBoundedRelaySender({ schedule: callback => { timers.set(++nextTimer, callback); return nextTimer; }, cancel: id => timers.delete(id) });
const slow = new Socket(); slow.bufferedAmount = RELAY_LIMITS.bufferedBytes - 4;
assert.equal(send(slow, Buffer.alloc(8), { binary: true }), false);
assert.equal(slow.sent.length, 0); assert.equal(slow.readyState, 3, 'slow peers are terminated to release queued buffers');
const combined = new Socket();
assert.equal(send(combined, Buffer.alloc(20), { binary: true, delayMs: 100, maxBufferedBytes: 64 }), true);
assert.equal(send(combined, Buffer.alloc(20), { binary: true, maxBufferedBytes: 64 }), false,
  'scheduled and immediate sends share one recipient budget');
assert.equal(timers.size, 0, 'termination releases retained delayed payloads');
const many = new Socket();
for (let i = 0; i < RELAY_LIMITS.delayedMessages; i++) assert.equal(send(many, Buffer.alloc(0), { delayMs: 100 }), true);
assert.equal(send(many, Buffer.alloc(0), { delayMs: 100 }), false, 'tiny delayed frames cannot create unlimited timers');
assert.equal(timers.size, 0);
const delayed = new Socket();
send(delayed, Buffer.from([1, 2]), { binary: true, delayMs: 100 });
const callback = [...timers.values()][0]; delayed.close(1000, 'left'); callback();
assert.equal(delayed.sent.length, 0, 'a stale timer cannot send after socket teardown');
const normal = new Socket(); send(normal, Buffer.from([3, 4]), { binary: true });
assert.deepEqual(normal.sent[0].payload, Buffer.from([3, 4]));
const inbound = Buffer.alloc(65536); const slice = inbound.subarray(0, 2); slice.set([5, 6]);
const exact = new Socket(); send(exact, slice, { binary: true });
assert.equal(exact.sent[0].payload.buffer.byteLength, 2, 'live sends cannot pin a large inbound TCP allocation');
const copied = new Socket(); send(copied, slice, { binary: true, delayMs: 100 });
slice.fill(0); const timerCallback = [...timers.values()][0]; timerCallback();
assert.deepEqual(copied.sent[0].payload, Buffer.from([5, 6]), 'delayed sends own an immutable exact-sized copy');

assert.deepEqual(normalizeRelaySignal({ description: { type: 'offer', sdp: 'v=0', extra: { nested: true } } }),
  { description: { type: 'offer', sdp: 'v=0' }, candidate: null });
assert.deepEqual(normalizeRelaySignal({ candidate: { candidate: 'ice', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'ufrag', unused: [] } }),
  { description: null, candidate: { candidate: 'ice', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'ufrag' } });
for (const input of [null, [], { description: { type: 'offer', sdp: [] } },
  { description: { type: 'offer', sdp: 'x'.repeat(16385) } }, { candidate: { candidate: 'x'.repeat(2049) } },
  { candidate: { candidate: 'ice', sdpMid: {} } }, { candidate: { candidate: 'ice', sdpMLineIndex: 9 } }])
  assert.equal(normalizeRelaySignal(input), null);
const hostile = JSON.parse('{"toString":null,"valueOf":null}');
for (const input of [{ type: 'signal', to: hostile }, { type: 'set-name', name: hostile },
  { type: 'refresh', product: hostile }, { type: 'take-seat', seat: [] }]) assert.equal(validRelayControlMessage(input), false);
assert.equal(validRelayControlMessage({ type: 'take-seat', seat: 0, loadout: '1', name: 'Player' }), true);

function run() {
  const player = new Socket(), viewer = new Socket();
  return { clients: new Map([[0, player]]), signalClients: new Map([[0, player]]),
    spectatorClients: new Map([['viewer', viewer]]), admittedSpectators: new Set(['viewer', 'pending']),
    claimedSpectators: new Set(['viewer']), spectatorHistory: [], spectatorHistoryBytes: 0,
    spectatorStopped: false, spectatorAdmissionOpen: true, spectatorGraceTimer: null };
}
const history = run(); const large = Buffer.alloc(65536); const view = large.subarray(0, 4);
view.fill(1); assert.equal(hasPendingSpectators(history), true);
assert.equal(appendSpectatorHistory(history, view, { historyFrames: 2, historyBytes: 10 }), true);
view.fill(9); assert.deepEqual([...history.spectatorHistory[0]], [1, 1, 1, 1]);
assert.equal(history.spectatorHistory[0].buffer.byteLength, 4, 'a small history frame owns only its own bytes');
assert.equal(appendSpectatorHistory(history, view, { historyFrames: 2, historyBytes: 10 }), true);
assert.equal(appendSpectatorHistory(history, view, { historyFrames: 2, historyBytes: 10 }), false);
assert.equal(history.spectatorStopped, true); assert.equal(history.spectatorHistory.length, 0); assert.equal(history.spectatorHistoryBytes, 0);
assert.equal(history.spectatorClients.get('viewer').closed.code, 1011);
assert.equal(history.clients.get(0).readyState, 1); assert.equal(history.signalClients.get(0).readyState, 1,
  'history overflow stops optional spectators, never gameplay/signaling');
assert.equal(appendSpectatorHistory(history, view), false);
const bytes = run(); appendSpectatorHistory(bytes, Buffer.alloc(6), { historyFrames: 10, historyBytes: 10 });
assert.equal(appendSpectatorHistory(bytes, Buffer.alloc(5), { historyFrames: 10, historyBytes: 10 }), false);
const clear = run(); appendSpectatorHistory(clear, view); clearSpectatorHistory(clear);
assert.equal(clear.spectatorHistoryBytes, 0); assert.equal(clear.spectatorHistory.length, 0);
clear.claimedSpectators.add('pending'); assert.equal(hasPendingSpectators(clear), false);
console.log('PASS payload/rate budgets, bounded live/delayed sends, signaling schema and complete-history overflow isolation');
