// Local WebSocket integration: oversized/reassembled frames and malformed
// signaling never reach peers; rejection does not terminate the relay service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { RELAY_LIMITS } from '../server/relay-flow-control.mjs';

const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, EAGLER_NETPLAY_RELAY_HOST: '127.0.0.1', EAGLER_NETPLAY_RELAY_PORT: '0',
    EAGLER_NETPLAY_STUN_URLS: '', EAGLER_NETPLAY_MAX_ROOMS_PER_IP: '10' },
});
let log = ''; const clients = [];
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('relay startup timeout\n' + log)), 5000);
  relay.stderr.on('data', data => { log += data; });
  relay.stdout.on('data', data => {
    log += data; const match = /listening ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);
    if (match) { clearTimeout(timer); resolve(Number(match[1])); }
  });
  relay.once('exit', () => { clearTimeout(timer); reject(Error('relay exited\n' + log)); });
});
function open(query) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${new URLSearchParams(query)}`);
  const json = [], binary = []; clients.push(socket);
  socket.on('error', () => {});
  socket.on('message', (data, isBinary) => { (isBinary ? binary : json).push(isBinary ? data : JSON.parse(String(data))); });
  return { socket, json, binary, ready: once(socket, 'open', { signal: AbortSignal.timeout(5000) }) };
}
const ended = socket => once(socket, 'close', { signal: AbortSignal.timeout(5000) });
async function pair(room, signal = false) {
  const a = open({ room, run: '1', player: '0', players: '2', ...(signal ? { signal: '1' } : {}) });
  const b = open({ room, run: '1', player: '1', players: '2', ...(signal ? { signal: '1' } : {}) });
  await Promise.all([a.ready, b.ready]); return [a, b];
}
try {
  const [source, target] = await pair('payload-gameplay');
  const rejected = ended(source.socket);
  source.socket.send(Buffer.alloc(RELAY_LIMITS.gameplayBytes + 1));
  assert.equal((await rejected)[0], 1009); assert.equal(target.binary.length, 0);

  const lobby = open({ room: 'payload-lobby', lobby: 'payload_lobby_id', member: 'private_payload_member' }); await lobby.ready;
  const lobbyClose = ended(lobby.socket); lobby.socket.send('x'.repeat(RELAY_LIMITS.controlBytes + 1));
  assert.equal((await lobbyClose)[0], 1009);

  const fragmented = open({ diagnostic: '1' }); await fragmented.ready;
  const fragmentClose = ended(fragmented.socket);
  fragmented.socket.send(Buffer.alloc(40 * 1024), { fin: false });
  fragmented.socket.send(Buffer.alloc(40 * 1024), { fin: true });
  assert.equal((await fragmentClose)[0], 1009, 'global maxPayload covers reassembled messages');

  const [signal, peer] = await pair('payload-signal', true);
  const delivered = once(peer.socket, 'message', { signal: AbortSignal.timeout(5000) });
  signal.socket.send(JSON.stringify({ type: 'signal', to: 1, description: { type: 'offer', sdp: 'v=0', unused: {} } }));
  let message = JSON.parse(String((await delivered)[0]));
  while (message.type !== 'signal') message = JSON.parse(String((await once(peer.socket, 'message', { signal: AbortSignal.timeout(5000) }))[0]));
  assert.deepEqual(message.description, { type: 'offer', sdp: 'v=0' });
  const invalid = ended(signal.socket);
  signal.socket.send(JSON.stringify({ type: 'signal', to: 1, candidate: { candidate: { nested: [] } } }));
  assert.equal((await invalid)[0], 1008);
  assert.equal(peer.json.filter(value => value.type === 'signal').length, 1, 'malformed signaling is not forwarded');

  const [oversize] = await pair('payload-signal-size', true);
  const oversizeClose = ended(oversize.socket); oversize.socket.send('x'.repeat(RELAY_LIMITS.controlBytes + 1));
  assert.equal((await oversizeClose)[0], 1009);
  const [badTarget] = await pair('payload-signal-target', true);
  const targetClose = ended(badTarget.socket);
  badTarget.socket.send('{"type":"signal","to":{"toString":null,"valueOf":null},"candidate":{"candidate":"ice"}}');
  assert.equal((await targetClose)[0], 1008, 'untrusted target values cannot crash numeric coercion');
  const directory = open({ directory: '1', member: 'payload_directory' }); await directory.ready;
  const directoryClose = ended(directory.socket);
  directory.socket.send('{"type":"refresh","product":{"toString":null,"valueOf":null}}');
  assert.equal((await directoryClose)[0], 1008);
  const [flood] = await pair('payload-signal-flood', true);
  const floodClose = ended(flood.socket);
  for (let i = 0; i < 1024; i++) flood.socket.send('{"type":"rtc-ready"}');
  assert.equal((await floodClose)[0], 1008);

  const [healthy, receiver] = await pair('payload-healthy');
  const received = once(receiver.socket, 'message', { signal: AbortSignal.timeout(5000) });
  healthy.socket.send(Buffer.from([0xe7, 1, 11, 22, 33]));
  assert.deepEqual((await received)[0], Buffer.from([11, 22, 33]));
  assert.equal(relay.exitCode, null);
  console.log('PASS real relay payload caps, fragmented-message cap, signaling validation/rate limit and healthy targeted forwarding');
} finally {
  for (const socket of clients) socket.terminate();
  const exit = once(relay, 'exit'); relay.kill(); await exit;
}
