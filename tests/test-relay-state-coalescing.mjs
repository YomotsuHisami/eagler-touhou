// Repository-local WebSocket integration: lobby state snapshots coalesce per
// tick, so a burst of legal mutations cannot multiply broadcast fan-out by the
// member count. Final state still converges, and event-like payloads (start)
// stay immediate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, EAGLER_NETPLAY_RELAY_HOST: '127.0.0.1',
    EAGLER_NETPLAY_RELAY_PORT: '0', EAGLER_NETPLAY_STUN_URLS: '' },
});
const sockets = [];
let log = '';
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`relay startup timeout: ${log}`)), 5000);
  relay.stderr.on('data', data => { log += data; });
  relay.stdout.on('data', data => {
    log += data;
    const match = /listening ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);
    if (match) { clearTimeout(timer); resolve(Number(match[1])); }
  });
  relay.once('exit', () => { clearTimeout(timer); reject(new Error(`relay exited: ${log}`)); });
});

function connect(params) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${new URLSearchParams(params)}`);
  sockets.push(socket);
  const messages = [], waiters = [];
  socket.on('message', (data, binary) => {
    if (binary) return;
    const message = JSON.parse(String(data)); messages.push(message);
    for (const waiter of [...waiters]) if (waiter.test(message)) waiter.resolve(message);
  });
  return { socket, messages, wait(test) {
    const found = messages.find(test); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`relay message timeout: ${log}`)), 5000);
      const waiter = { test, resolve(value) { clearTimeout(timer); waiters.splice(waiters.indexOf(waiter), 1); resolve(value); } };
      waiters.push(waiter);
    });
  } };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const room = 'th09mp-6432';
const host = connect({ room, lobby: 'public_host_id', member: 'private_host_member' });
const guest = connect({ room, lobby: 'public_guest_id', member: 'private_guest_member' });
const watcher = connect({ room, lobby: 'public_watcher_id', member: 'private_watcher_member' });
await host.wait(message => message.type === 'state');
await guest.wait(message => message.type === 'state');
await watcher.wait(message => message.type === 'state');

host.socket.send(JSON.stringify({ type: 'take-seat', seat: 0, loadout: 0, name: 'host', movementMode: 'keyboard' }));
guest.socket.send(JSON.stringify({ type: 'take-seat', seat: 1, loadout: 0, name: 'guest', movementMode: 'keyboard' }));
await watcher.wait(message => message.type === 'state' && message.room.seats.filter(Boolean).length === 2);

// 60 legal toggles per player (well inside the per-connection budget) land
// within roughly one coalesce tick.
const mutations = 60;
for (let i = 0; i < mutations; i++) {
  const ready = i === mutations - 1;
  host.socket.send(JSON.stringify({ type: 'set-ready', ready, movementMode: 'keyboard' }));
  guest.socket.send(JSON.stringify({ type: 'set-ready', ready, movementMode: 'keyboard' }));
}
await sleep(700);

const states = watcher.messages.filter(message => message.type === 'state');
assert.ok(states.length >= 1, 'coalesced ticks must still deliver the final state');
assert.ok(states.length <= 15,
  `${mutations * 2} mutations must coalesce below the tick ceiling, got ${states.length}`);
const finalSeats = states.at(-1).room.seats;
assert.equal(finalSeats[0].ready, true, 'coalescing must not lose the final state');
assert.equal(finalSeats[1].ready, true, 'coalescing must not lose the final state');

// Isolated mutations keep the original sync speed: the leading edge is
// immediate, with no coalescing delay added to ordinary updates.
await sleep(700);
const statesBeforeLatency = watcher.messages.filter(message => message.type === 'state').length;
const latencyStart = Date.now();
guest.socket.send(JSON.stringify({ type: 'set-ready', ready: false, movementMode: 'keyboard' }));
let latency = null;
while (Date.now() - latencyStart < 2000) {
  await sleep(20);
  const now = watcher.messages.filter(message => message.type === 'state').length;
  if (now > statesBeforeLatency) { latency = Date.now() - latencyStart; break; }
}
assert.ok(latency !== null, 'an isolated mutation must broadcast');
assert.ok(latency < 250, `an isolated mutation must broadcast immediately, took ${latency}ms`);
guest.socket.send(JSON.stringify({ type: 'set-ready', ready: true, movementMode: 'keyboard' }));
await sleep(300);

// Event-like payloads are not coalesced: start reaches clients immediately.
host.socket.send(JSON.stringify({ type: 'start', inputDelay: 2 }));
const start = await host.wait(message => message.type === 'start');
assert.equal(String(start.serial), '1');
await guest.wait(message => message.type === 'start');

for (const socket of sockets) socket.close();
relay.kill();
console.log(`state-coalescing: ${mutations * 2} mutations -> ${states.length} broadcasts on watcher (converged), start immediate`);
