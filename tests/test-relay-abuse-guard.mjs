import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createRelayAbuseGuard, relayAbuseConfig, relayClientAddress } from '../server/relay-abuse-guard.mjs';

const defaults = relayAbuseConfig({});
assert.equal(defaults.maxRoomsPerIp, 2);
const request = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': forwarded } });
assert.equal(relayClientAddress(request('::ffff:127.0.0.1', '203.0.113.7')), '127.0.0.1');
assert.equal(relayClientAddress(request('127.0.0.1', '203.0.113.7'), new Set(['127.0.0.1'])), '203.0.113.7');
assert.equal(relayClientAddress(request('127.0.0.1', 'bad'), new Set(['127.0.0.1'])), null);
assert.equal(relayClientAddress(request('127.0.0.1', '203.0.113.7, 203.0.113.8'), new Set(['127.0.0.1'])), null);
assert.throws(() => relayAbuseConfig({ EAGLER_NETPLAY_MAX_ROOMS: '0' }));
assert.throws(() => relayAbuseConfig({ EAGLER_NETPLAY_TRUSTED_PROXIES: '*' }));

let time = 0;
const guard = createRelayAbuseGuard({ ...defaults, now: () => time, maxConnectionsPerIp: 1, maxConnections: 2,
  attemptsPerMinute: 2, maxRoomsPerIp: 2, maxRooms: 2, maxAddresses: 2 });
assert(guard.allowHandshake('a'));
const socket = new EventEmitter();
assert(guard.trackSocket('a', socket));
assert(!guard.allowHandshake('a'));
socket.emit('close');
assert(guard.allowHandshake('a'));
assert(!guard.allowHandshake('a'));
assert(guard.createRoom('one', 'a'));
assert(guard.createRoom('two', 'a'));
assert(!guard.createRoom('three', 'a'));
assert(!guard.createRoom('other', 'b'));
guard.releaseRoom('one');
assert(guard.createRoom('three', 'a'));
for (let i = 0; i < 100; ++i) {
  guard.releaseRoom('three');
  assert(guard.createRoom('three', 'a')); // No creation cooldown, even at the same timestamp.
}
guard.releaseRoom('two'); guard.releaseRoom('three');
assert(guard.allowHandshake('b'));
assert(!guard.allowHandshake('c'));
time = 60_001;
guard.sweep();
assert(guard.allowHandshake('c'));
const totalGuard = createRelayAbuseGuard({ ...defaults, maxConnections: 1 });
assert(totalGuard.trackSocket('a', new EventEmitter()));
assert(!totalGuard.allowHandshake('b'));

// Reproduce the supplied script locally. Never contact the public deployment.
const env = { ...process.env, EAGLER_NETPLAY_RELAY_HOST: '127.0.0.1', EAGLER_NETPLAY_RELAY_PORT: '0',
  EAGLER_NETPLAY_STUN_URLS: '', EAGLER_NETPLAY_TRUSTED_PROXIES: '',
  EAGLER_NETPLAY_MAX_ROOMS_PER_IP: '2', EAGLER_NETPLAY_LOBBY_RECONNECT_GRACE_MS: '100',
  EAGLER_NETPLAY_CONNECTIONS_PER_MINUTE: '11', EAGLER_NETPLAY_MAX_CONNECTIONS_PER_IP: '32' };
for (const key of ['TH07_RELAY_HOST', 'TH07_RELAY_PORT', 'TH07_STUN_URLS']) delete env[key];
const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
relay.stderr.on('data', chunk => { output += chunk; });
const sockets = [];
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay startup timeout: ${output}`)), 5000);
    relay.stdout.on('data', chunk => {
      const match = /listening ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    relay.once('exit', code => { clearTimeout(timer); reject(new Error(`relay exited ${code}: ${output}`)); });
  });
  let id = 0;
  async function first(params) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?${params}`, { headers: { 'X-Real-IP': `203.0.113.${++id}`, Origin: 'https://touhou.vip' } });
    sockets.push(socket);
    const timer = setTimeout(() => socket.terminate(), 3000);
    try {
      const [data] = await once(socket, 'message');
      return { socket, message: JSON.parse(String(data)) };
    } finally { clearTimeout(timer); }
  }
  const lobby = (code, intent = 'create') => `room=th09mp-${code}&lobby=c${String(id + 1).padStart(15, '0')}&member=m${String(id + 1).padStart(28, '0')}&intent=${intent}&players=2&difficulty=1`;
  for (const code of ['0001', '0002']) {
    const host = await first(lobby(code));
    assert.equal(host.message.type, 'state');
    const taken = once(host.socket, 'message');
    host.socket.send(JSON.stringify({ type: 'take-seat', seat: 0, loadout: 1, name: 'py' }));
    assert.equal(JSON.parse(String((await taken)[0])).room.seats[0].name, 'py');
    assert.equal((await first(lobby(code, 'join'))).message.type, 'state');
  }
  assert.equal((await first(lobby('0003'))).message.code, 'rate-limited');
  assert.equal((await first(lobby('0005').replace('&intent=create', ''))).message.code, 'rate-limited');
  assert.equal((await first('room=th09mp-0006&run=1&player=0&players=2&signal=1')).message.code, 'rate-limited');
  assert.equal((await first('room=th09mp-0007&run=1&player=0&players=2')).message.code, 'rate-limited');
  const extraJoin = await first(lobby('0001', 'join'));
  assert.equal(extraJoin.message.type, 'state');
  const directory = await first('directory=1&member=directory_member');
  assert.equal(directory.message.type, 'directory');
  assert.equal(directory.message.total, 2);
  const released = new Promise(resolve => {
    directory.socket.on('message', function onMessage(data) {
      const value = JSON.parse(String(data));
      if (value.type === 'directory' && value.total === 1) {
        directory.socket.off('message', onMessage);
        resolve();
      }
    });
  });
  sockets[0].close(1000, 'leave room'); sockets[1].close(1000, 'leave room'); extraJoin.socket.close(1000, 'leave room');
  await released;
  assert.equal((await first(lobby('0003'))).message.type, 'state'); // Immediately reusable after room deletion.
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/?directory=1&member=another_member`, { headers: { 'X-Real-IP': '203.0.113.200' } });
  sockets.push(rejected);
  rejected.on('error', () => {});
  const [, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 429);
  response.resume();
  rejected.terminate();
} finally {
  for (const socket of sockets) socket.terminate();
  const exited = once(relay, 'exit');
  relay.kill();
  await exited;
}
console.log(JSON.stringify({ relayAbuseGuard: 'PASS', heldRoomLimit: 2, recreation: 'no cooldown', spoofedAddress: 'ignored', transports: ['lobby', 'signaling', 'relay'] }));
