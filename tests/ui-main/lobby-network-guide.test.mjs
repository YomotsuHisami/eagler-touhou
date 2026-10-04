/** Synthetic probe/React SSR checks only; no live networking or browser QA. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(root, '.cache/ui-network-guide-'));
after(() => rm(folder, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: `
export * from './src/launcher/network-diagnostics.mts';
export * from './app/services/lobby-network-diagnostics.client';
export * from './app/services/multiplayer-guide-content';
export * from './app/services/notices.client';
export * from './app/services/locale.client';
export {MultiplayerGuideContent} from './app/components/MultiplayerGuideContent';
export {LocaleProvider} from './app/components/LocaleProvider';
export {createElement} from 'react';
export {renderToStaticMarkup} from 'react-dom/server';
export {createMemoryRouter, RouterProvider} from 'react-router';
`, resolveDir: root, loader: 'tsx'}, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', write: false,
plugins: [{name: 'authored-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
  if (!args.path.startsWith('.')) return;
  const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
  if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
});}}]});
const modulePath = join(folder, 'api.mjs');await writeFile(modulePath, bundle.outputFiles[0].text);
const {runNetworkDiagnostics, probeRelay, turnServerLatencyFromLoopback, createLobbyNetworkDiagnostics, multiplayerGuideGroups,
 multiplayerGuideGameId, createNoticesService, parsePackagedContent, formatUiMessage,
 MultiplayerGuideContent, LocaleProvider, createElement, renderToStaticMarkup, createMemoryRouter, RouterProvider} = await import(pathToFileURL(modulePath).href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject;const promise = new Promise((a, b) => {resolve = a;reject = b;});return {promise, resolve, reject};};
class Events {
  listeners = new Map();
  addEventListener(type, callback) {const list = this.listeners.get(type) ?? new Set();list.add(callback);this.listeners.set(type, list);}
  removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}
  emit(type, value = {}) {for (const callback of [...this.listeners.get(type) ?? []]) callback(value);}
}
function probeFixture(t, {legacy = false, holdHandshake = false, holdPing = false, holdOffer = false, holdChannel = false, turn = true, failedTurnPair = false, webRtc = true} = {}) {
  const sockets = [], peers = [], channels = [], pendingTimers = new Set();
  const saved = {WebSocket: globalThis.WebSocket, RTCPeerConnection: globalThis.RTCPeerConnection, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  globalThis.setTimeout = (callback, ms) => {const timer = saved.setTimeout(callback, ms);pendingTimers.add(timer);return timer;};
  globalThis.clearTimeout = timer => {pendingTimers.delete(timer);saved.clearTimeout(timer);};
  class Socket extends Events {
    closed = false;sent = [];
    constructor(url) {
      super();this.url = url;sockets.push(this);
      queueMicrotask(() => {
        if (holdHandshake) return;
        if (legacy && new URL(url).searchParams.has('diagnostic')) this.emit('close');
        else this.emit('message', {data: JSON.stringify({type: new URL(url).searchParams.has('diagnostic') ? 'diagnostic-ready' : 'peers', iceServers: turn ? [{urls: 'turn:turn.example:3478', username: 'ephemeral', credential: 'synthetic'}] : []})});
      });
    }
    send(raw) {const message = JSON.parse(raw);this.sent.push(message);if (!holdPing) queueMicrotask(() => this.emit('message', {data: JSON.stringify({type: 'diagnostic-pong', nonce: message.nonce})}));}
    close() {this.closed = true;this.emit('close');}
  }
  class Channel extends Events {
    readyState = holdChannel ? 'connecting' : 'open';closed = false;
    constructor() {super();channels.push(this);}
    send(data) {queueMicrotask(() => this.emit('message', {data}));}
    close() {this.closed = true;this.readyState = 'closed';}
  }
  class Peer extends Events {
    closed = false;iceGatheringState = 'complete';localDescription = null;
    constructor(config) {super();this.config = config;peers.push(this);}
    createDataChannel() {return new Channel();}
    createOffer() {return holdOffer ? new Promise(() => {}) : Promise.resolve({type: 'offer', sdp: 'candidate typ relay candidate'});}
    createAnswer() {return Promise.resolve({type: 'answer', sdp: 'candidate typ relay candidate'});}
    async setLocalDescription(value) {
      this.localDescription = value;
      if (this.config.iceTransportPolicy !== 'relay') {
        this.emit('icecandidate', {candidate: {candidate: 'candidate 1 udp 1 203.0.113.2 9000 typ srflx raddr 192.168.1.1 rport 9000', type: 'srflx'}});
        this.emit('icecandidate', {candidate: {candidate: 'candidate 1 udp 1 2001:db8::1 9000 typ srflx', type: 'srflx'}});
      }
    }
    async setRemoteDescription() {}
    async getStats() {return new Map([['transport', {type: 'transport', selectedCandidatePairId: 'pair'}], ['pair', {localCandidateId: 'local', remoteCandidateId: 'remote'}], ['local', {candidateType: failedTurnPair ? 'host' : 'relay'}], ['remote', {candidateType: 'relay'}]]);}
    close() {this.closed = true;}
  }
  globalThis.WebSocket = Socket;globalThis.RTCPeerConnection = webRtc ? Peer : undefined;
  t.after(() => {for (const timer of pendingTimers) saved.clearTimeout(timer);Object.assign(globalThis, saved);});
  return {sockets, peers, channels, pendingTimers};
}

test('shared pipeline reports real probe results, preserves TURN topology normalization and releases resources', async t => {
  const f = probeFixture(t), results = [];
  await runNetworkDiagnostics({relayUrl: 'wss://relay.example/?diagnostic=1', onResult: value => results.push(value)});
  const byKind = Object.fromEntries(results.map(row => [row.kind, row]));
  assert.deepEqual(Object.keys(byKind).sort(), ['ipv6', 'nat', 'turn', 'ws']);
  assert.equal(byKind.nat.value, 'NAT3');assert.equal(byKind.ipv6.message, 'networkCheck.ipv6Available');
  assert.equal(byKind.turn.message, 'networkCheck.turnLatency');assert.ok(byKind.turn.params.latency >= 1);
  assert.equal(f.sockets.length, 1);assert.equal(f.sockets[0].sent.length, 3);assert.equal(f.peers.length, 3);
  assert.ok(f.peers.slice(1).every(peer => peer.config.iceTransportPolicy === 'relay'));
  assert.ok(f.sockets.every(socket => socket.closed));assert.ok(f.peers.every(peer => peer.closed));assert.equal(f.pendingTimers.size, 0);
  assert.equal(turnServerLatencyFromLoopback(86), 43);
});
test('a non-relay selected pair is not advertised as a working TURN path', async t => {
  probeFixture(t, {failedTurnPair: true});const results = [];
  await runNetworkDiagnostics({relayUrl: 'wss://relay.example/?diagnostic=1', onResult: row => results.push(row)});
  assert.equal(results.find(row => row.kind === 'turn').message, 'networkCheck.failed');
});
test('old relay fallback is retained and isolated from user rooms', async t => {
  const f = probeFixture(t, {legacy: true});const result = await probeRelay('wss://relay.example/?diagnostic=1&deployment=blue');
  assert.equal(f.sockets.length, 2);const url = new URL(f.sockets[1].url);
  assert.equal(url.searchParams.get('signal'), '1');assert.match(url.searchParams.get('room'), /^diagnostic-/);
  assert.equal(url.searchParams.get('diagnostic'), null);assert.equal(url.searchParams.get('deployment'), 'blue');
  assert.equal(result.iceServers[0].username, 'ephemeral');assert.ok(f.sockets.every(socket => socket.closed));assert.equal(f.pendingTimers.size, 0);
});
for (const stage of ['handshake', 'ping', 'offer', 'channel']) test(`abort during ${stage} closes probes and timers without fallback or stale results`, async t => {
  const f = probeFixture(t, {holdHandshake: stage === 'handshake', holdPing: stage === 'ping', holdOffer: stage === 'offer', holdChannel: stage === 'channel'});
  const request = new AbortController(), results = [];
  const running = runNetworkDiagnostics({relayUrl: 'wss://relay.example/?diagnostic=1', signal: request.signal, onResult: row => results.push(row)});
  await tick();const count = results.length;request.abort();await assert.rejects(running, {name: 'AbortError'});
  assert.equal(results.length, count);assert.equal(f.sockets.length, 1);assert.ok(f.sockets.every(socket => socket.closed));assert.ok(f.peers.every(peer => peer.closed));
  assert.equal(f.pendingTimers.size, 0);assert.ok(f.channels.every(channel => !channel.listeners.get('open')?.size && !channel.listeners.get('message')?.size));
});
test('unavailable WebRTC does not reject early or mask working WebSocket results', async t => {
  const f = probeFixture(t, {webRtc: false, turn: false}), results = [];
  await runNetworkDiagnostics({relayUrl: 'wss://relay.example/?diagnostic=1', onResult: row => results.push(row)});
  assert.equal(results.find(row => row.kind === 'nat').message, 'networkCheck.failed');
  assert.equal(results.find(row => row.kind === 'turn').message, 'networkCheck.unavailable');
  assert.equal(results.find(row => row.kind === 'ws').message, 'networkCheck.wsLatency');assert.equal(f.pendingTimers.size, 0);
});
test('construction is inert, repeated clicks coalesce, cancelled results cannot overwrite a newer run', async () => {
  const tasks = [];const service = createLobbyNetworkDiagnostics({probe: options => {const job = deferred();tasks.push({options, job});return job.promise;}});
  assert.equal(tasks.length, 0);const first = service.run('wss://one.example/');await service.run('wss://one.example/');assert.equal(tasks.length, 1);
  tasks[0].options.onResult({kind: 'ws', good: true, message: 'networkCheck.wsLatency', params: {latency: 22}});
  assert.equal(service.getSnapshot().results.ws.params.latency, 22);assert.equal(service.getSnapshot().running, true);
  service.cancel();assert.equal(tasks[0].options.signal.aborted, true);assert.equal(service.getSnapshot().running, false);
  const second = service.run('wss://two.example/');assert.equal(tasks.length, 2);
  tasks[0].options.onResult({kind: 'nat', good: true, value: 'NAT1'});tasks[0].job.resolve();await first;
  assert.equal(service.getSnapshot().results.nat, null);assert.equal(service.getSnapshot().running, true);
  tasks[1].options.onResult({kind: 'turn', good: false, message: 'networkCheck.unavailable'});tasks[1].job.resolve();await second;
  assert.equal(service.getSnapshot().running, false);assert.equal(service.getSnapshot().results.turn.message, 'networkCheck.unavailable');
  assert.equal(formatUiMessage('en', service.getSnapshot().results.turn.message), 'Unavailable');assert.equal(formatUiMessage('zh-CN', service.getSnapshot().results.turn.message), '不可用');
  assert.ok(Object.isFrozen(service.getSnapshot().results.turn));service.reset();assert.equal(service.getSnapshot().results.turn, null);
});
test('unexpected probe failure settles all missing rows and can be retried', async () => {
  const service = createLobbyNetworkDiagnostics({probe: async () => {throw Error('synthetic failure');}});
  await service.run(null);assert.equal(service.getSnapshot().running, false);
  assert.ok(Object.values(service.getSnapshot().results).every(row => row?.message === 'networkCheck.failed'));
  await service.run(null);assert.equal(service.getSnapshot().running, false);
});

test('actual authored guide is grouped without new fetches or invented game rules', async () => {
  const nodes = await parsePackagedContent(await readFile(join(root, 'public/content/MULTIPLAYER.html'), 'utf8'), 'https://site.example/mount/');
  const groups = multiplayerGuideGroups(nodes);assert.ok(groups);assert.deepEqual(groups.games.map(game => game.id), ['th06', 'th07', 'th08', 'th10']);
  assert.ok(groups.common.length);assert.ok(groups.intro.length);assert.ok(groups.games.find(game => game.id === 'th07').nodes.length);
  assert.equal(multiplayerGuideGameId('th08'), 'th08');assert.equal(multiplayerGuideGameId('th09'), 'th07');
  assert.equal(multiplayerGuideGroups(await parsePackagedContent('<p>Alternate authored guide</p>', 'https://site.example/')), null);
  const content = {kind: 'multiplayer', status: 'available', nodes, html: '', error: null};
  const router = createMemoryRouter([{path: '*', element: createElement(LocaleProvider, {initialLocale: 'en'}, createElement(MultiplayerGuideContent, {content, gameId: 'th08', request: 1}))}], {initialEntries: ['/lobby?uiLocale=en']});
  const markup = renderToStaticMarkup(createElement(RouterProvider, {router}));
  assert.match(markup, /Common rules/);assert.match(markup, /Game-specific rules/);assert.equal((markup.match(/role="tab"/g) ?? []).length, 4);
  assert.match(markup, /-tab-th08" aria-controls="[^"]*-panel-th08" aria-selected="true"/);assert.match(markup, /lang="zh-CN"/);
  assert.doesNotMatch(markup, /<details[^>]*\sopen[=>\s]/);
});
test('guide opens while loading, dismisses pending content, caches once and preserves latest requested game', async t => {
  const pending = deferred(), calls = [];
  const service = createNoticesService({baseUrl: 'https://site.example/mount/', fetchImpl: (url, init) => {calls.push({url, init});return pending.promise;}});t.after(() => service.dispose());
  const first = service.showMultiplayer('th08');assert.equal(service.getSnapshot().multiplayerOpen, true);assert.equal(service.getSnapshot().contents.multiplayer.status, 'loading');
  service.closeMultiplayer();const second = service.showMultiplayer('th10');
  assert.equal(calls.length, 1);assert.equal(calls[0].url, 'https://site.example/mount/content/MULTIPLAYER.html');
  pending.resolve(new Response('<h2>通用规则</h2><p>Authored rules</p>'));
  assert.equal(await first, false);assert.equal(await second, true);assert.equal(service.getSnapshot().multiplayerGameId, 'th10');
  service.closeMultiplayer();await service.showMultiplayer('th06');assert.equal(calls.length, 1);assert.equal(service.getSnapshot().multiplayerGameId, 'th06');
  const pending2 = deferred(), other = createNoticesService({baseUrl: 'https://site.example/', fetchImpl: () => pending2.promise});t.after(() => other.dispose());
  const cancelled = other.showMultiplayer('th07');other.closeMultiplayer();pending2.resolve(new Response('<p>Late guide</p>'));assert.equal(await cancelled, false);assert.equal(other.getSnapshot().multiplayerOpen, false);
});
test('guide read failure is localized, retry uses the sole content owner without reopening a dismissed dialog', async t => {
  let attempts = 0;const service = createNoticesService({baseUrl: 'https://site.example/', fetchImpl: async () => new Response(++attempts === 1 ? 'failure' : '<p>Ready guide</p>', {status: attempts === 1 ? 503 : 200})});t.after(() => service.dispose());
  await service.showMultiplayer('th08');assert.equal(service.getSnapshot().contents.multiplayer.status, 'error');
  service.closeMultiplayer();await service.loadContent('multiplayer');assert.equal(service.getSnapshot().contents.multiplayer.status, 'available');assert.equal(service.getSnapshot().multiplayerOpen, false);assert.equal(attempts, 2);
});
