import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relayPath = resolve(root, 'server/netplay-relay.mjs');
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}
function waitListening(child) {
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('relay start timeout')), 8000);
    const onData = chunk => {
      if (!String(chunk).includes('listening')) return;
      clearTimeout(timer); child.stdout.off('data', onData); resolveReady();
    };
    child.stdout.on('data', onData);
    child.once('exit', code => {clearTimeout(timer); reject(new Error(`relay exited before listen: ${code}`));});
  });
}
function nextJson(socket, predicate, context) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => {cleanup(); reject(new Error(`${context} timeout`));}, 5000);
    const onMessage = event => {
      try {const message = JSON.parse(String(event.data)); if (predicate(message)) {cleanup(); resolveMessage(message);}}
      catch (error) {cleanup(); reject(error);}
    };
    const onError = () => {cleanup(); reject(new Error(`${context} socket failed`));};
    const cleanup = () => {clearTimeout(timer); socket.removeEventListener('message', onMessage); socket.removeEventListener('error', onError);};
    socket.addEventListener('message', onMessage); socket.addEventListener('error', onError);
  });
}
async function openLobby(port, room, clientId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${encodeURIComponent(room)}&lobby=${clientId}`);
  const initial = nextJson(socket, message => message.type === 'state', 'initial lobby state');
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, {once: true});
    socket.addEventListener('error', () => reject(new Error('lobby open failed')), {once: true});
  });
  assert.equal((await initial).type, 'state');
  return socket;
}
async function sendAndMatch(socket, message, predicate, context = message.type) {
  const response = nextJson(socket, predicate, context); socket.send(JSON.stringify(message)); return response;
}
async function noQuickChat(socket, send) {
  let seen = false;
  const listener = event => {try {seen ||= JSON.parse(String(event.data)).type === 'quick-chat';} catch {}};
  socket.addEventListener('message', listener);
  try {send(); await new Promise(resolveWait => setTimeout(resolveWait, 120));}
  finally {socket.removeEventListener('message', listener);}
  assert.equal(seen, false, 'rejected quick chat must not be relayed');
}

const port = await freePort();
const child = spawn(process.execPath, [relayPath], {cwd: root, env: {...process.env,
  EAGLER_NETPLAY_RELAY_HOST: '127.0.0.1', EAGLER_NETPLAY_RELAY_PORT: String(port),
  EAGLER_NETPLAY_STUN_URLS: '', EAGLER_NETPLAY_LOBBY_RECONNECT_GRACE_MS: '150'}});
child.stdout.on('data', () => {}); child.stderr.on('data', chunk => process.stderr.write(chunk));
let host, peer, unrelated;
try {
  await waitListening(child);
  const suffix = Date.now().toString(36);
  const room = `th06mp-chat${suffix}`;
  host = await openLobby(port, room, `chat_host_${suffix}`);
  peer = await openLobby(port, room, `chat_peer_${suffix}`);
  unrelated = await openLobby(port, `th06mp-other${suffix}`, `chat_other_${suffix}`);

  await sendAndMatch(host, {type: 'take-seat', seat: 0, loadout: 0, name: 'Host', movementMode: 'normal', touchEnabled: false},
    message => message.room?.seats?.[0]?.clientId === `chat_host_${suffix}`);
  await sendAndMatch(peer, {type: 'take-seat', seat: 1, loadout: 1, name: 'Peer', movementMode: 'normal', touchEnabled: false},
    message => message.room?.seats?.[1]?.clientId === `chat_peer_${suffix}`);
  await noQuickChat(peer, () => host.send(JSON.stringify({type: 'quick-chat', serial: 0, phrase: 'thanks'})));
  await sendAndMatch(host, {type: 'set-ready', ready: true, movementMode: 'normal', touchEnabled: false},
    message => message.room?.seats?.[0]?.ready === true);
  await sendAndMatch(peer, {type: 'set-ready', ready: true, movementMode: 'normal', touchEnabled: false},
    message => message.room?.seats?.[1]?.ready === true);
  const started = await sendAndMatch(host, {type: 'start', inputDelay: 0, predictionLimit: 8}, message => message.type === 'start');
  assert.equal(started.room.startSerial, started.serial);

  const accepted = nextJson(peer, message => message.type === 'quick-chat', 'valid quick chat');
  host.send(JSON.stringify({type: 'quick-chat', serial: started.serial, phrase: 'thanks', seat: 99, clientId: 'forged'}));
  const event = await accepted;
  assert.deepEqual({room: event.room, serial: event.serial, seat: event.seat, clientId: event.clientId, phrase: event.phrase},
    {room, serial: started.serial, seat: 0, clientId: `chat_host_${suffix}`, phrase: 'thanks'});

  await noQuickChat(peer, () => host.send(JSON.stringify({type: 'quick-chat', serial: started.serial - 1, phrase: 'follow-me'})));
  await noQuickChat(peer, () => host.send(JSON.stringify({type: 'quick-chat', serial: started.serial, phrase: 'arbitrary text'})));
  await noQuickChat(peer, () => host.send(JSON.stringify({type: 'quick-chat', serial: started.serial, phrase: 'follow-me'})));
  await new Promise(resolveWait => setTimeout(resolveWait, 520));
  const acceptedAgain = nextJson(peer, message => message.type === 'quick-chat', 'rate-limit window');
  host.send(JSON.stringify({type: 'quick-chat', serial: started.serial, phrase: 'follow-me'}));
  assert.equal((await acceptedAgain).phrase, 'follow-me');
  await new Promise(resolveWait => setTimeout(resolveWait, 520));
  const sameRoom = nextJson(peer, message => message.type === 'quick-chat', 'same-room delivery');
  await noQuickChat(unrelated, () => host.send(JSON.stringify({type: 'quick-chat', serial: started.serial, phrase: 'last-game'})));
  assert.equal((await sameRoom).phrase, 'last-game');
} finally {
  host?.close(1000); peer?.close(1000); unrelated?.close(1000);
  child.kill('SIGTERM');
  await new Promise(resolveExit => {if (child.exitCode !== null) resolveExit(); else child.once('exit', resolveExit);});
}
