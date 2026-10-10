/** Pinned-main network dialog parity: synthetic DOM/MemoryRouter and fake IO.
 * No browser, server, live WebSocket/ICE/TURN, native top-layer or pixel claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${pinnedMain}:${path}`], {cwd: project, encoding: 'utf8'});
let env, work, api, React, createRoot, createMemoryRouter, RouterProvider, originalHTML, io, pinnedApi;
const mounts = new Set(), models = new Set();
const relayUrl = 'wss://relay.invalid/netplay?diagnostic=1&keep=fixture';
const iceServers = [{urls: 'turn:turn.invalid:3478', username: 'synthetic', credential: 'not-a-secret'}];
const n = (selector, scope = env.document) => {const node = scope.querySelector(selector); assert.ok(node, `Missing ${selector}`); return node;};
const t = (locale, key, params) => api.translate(locale, key, params);
// Bounded microtask drains only; fake time never advances implicitly.
async function step(action = () => {}) {
  await React.act(async () => {action(); for (let index = 0; index < 40; index++) await Promise.resolve();});
}
function operation(run) {
  const result = {settled: false, error: null};
  result.promise = run().then(() => {result.settled = true;}, error => {result.settled = true; result.error = error;});
  return result;
}
function complete(result) {assert.equal(result.settled, true, 'Operation settled within the explicit fixture steps'); assert.equal(result.error, null);}

before(async () => {
  env = installMountedDom();
  React = await import('react'); ({createRoot} = await import('react-dom/client'));
  ({createMemoryRouter, RouterProvider} = await import('react-router'));
  // These are the executed owners, not copies of their probe/translation logic.
  assert.equal(readFileSync(resolve(project, 'src/launcher/i18n.mts'), 'utf8'), pinned('src/launcher/i18n.mts'));
  const original = pinned('src/launcher/network-diagnostics.mts');
  const current = readFileSync(resolve(project, 'src/launcher/network-diagnostics.mts'), 'utf8');
  // Shared-state extraction deliberately changes presentation ownership. Every
  // probe/helper and the actual per-run orchestration remain pinned bytes.
  assert.equal(current.slice(current.indexOf('type CandidateSummary'), current.indexOf('/** Shared probe state.')),
    original.slice(original.indexOf('type CandidateSummary'), original.indexOf('export function createNetworkDiagnosticsController')));
  const runAlgorithm = source => source.slice(source.indexOf('      const relayUrl = options.getRelayUrl();'), source.indexOf('    } finally {', source.indexOf('      const relayUrl = options.getRelayUrl();')));
  assert.equal(runAlgorithm(current), runAlgorithm(original));
  originalHTML = pinned('public/lobby.html');
  work = await mkdtemp(resolve(project, 'tests/react-main/network-dialog-build-'));
  const outfile = resolve(work, 'actual.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export * from './app/components/directory/NetworkDiagnosticsDialog.tsx';
    export * from './app/components/room/MultiplayerDiagnostics.tsx';
    export * from './app/components/directory/network-diagnostics-model.ts';
    export {createNetworkDiagnosticsState, createNetworkDiagnosticsController} from './src/launcher/network-diagnostics.mts';
    export * from './app/navigation/surface-navigation.tsx';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
  plugins: [{name: 'original-authored-mts', setup(context) {
    context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
      return source.startsWith(resolve(project, 'src') + '/') && existsSync(authored) ? {path: authored} : undefined;
    });
  }}]});
  api = await import(pathToFileURL(outfile).href);
  const pinnedOutput = resolve(work, 'pinned-controller.mjs');
  await build({stdin: {contents: original, loader: 'ts'}, outfile: pinnedOutput,
    platform: 'node', format: 'esm', logLevel: 'silent'});
  pinnedApi = await import(pathToFileURL(pinnedOutput).href);
});
afterEach(async () => {
  try {
    for (const m of mounts) {await step(() => m.root.unmount()); m.router?.dispose();}
    mounts.clear(); for (const model of models) model.dispose(); models.clear();
    if (io) {
      await io.drain();
      assert.equal(io.timers.size, 0, 'Every installed fake timeout was cleared or consumed');
      assert.ok(io.sockets.every(socket => socket.closes.length === 1), 'Original finally closes every started socket');
      assert.ok(io.peers.every(peer => peer.closed === 1), 'Original finally closes every started peer');
      assert.equal(io.fetchCalls, 0, 'No fetch IO');
      assert.deepEqual(io.historyCalls, [], 'The dialog/model never writes a second native History owner');
    }
    assert.deepEqual(env.errors.splice(0), [], 'No unexpected React/DOM errors');
  } finally {io?.restore(); io = null; env.document.body.replaceChildren();}
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

class Events {
  listeners = new Map();
  addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn);}
  removeEventListener(type, fn) {this.listeners.get(type)?.delete(fn);}
  emit(type, event = {}) {for (const fn of [...(this.listeners.get(type) || [])]) fn(event);}
}
function transport() {
  assert.ok(io == null); // One isolated IO world per test.
  const sockets = [], peers = [], timers = new Map(), observers = [], restorations = [], historyCalls = [];
  let now = 0, sequence = 0, fetchCalls = 0;
  function replace(target, key, value) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, {configurable: true, writable: true, value});
    restorations.push(() => descriptor ? Object.defineProperty(target, key, descriptor) : delete target[key]);
  }
  class Socket extends Events {
    sent = []; closes = [];
    constructor(url) {super(); this.url = url; sockets.push(this);}
    send(data) {this.sent.push(JSON.parse(data));}
    receive(data) {this.emit('message', {data: typeof data === 'string' ? data : JSON.stringify(data)});}
    close(...args) {this.closes.push(args);}
  }
  class Channel extends Events {
    readyState = 'connecting'; sent = []; closed = 0;
    send(data) {this.sent.push(data);}
    close() {this.closed++; this.readyState = 'closed';}
    open() {this.readyState = 'open'; this.emit('open');}
  }
  class Peer extends Events {
    iceGatheringState = 'new'; channels = []; closed = 0; localDescription = null; statsCalls = 0;
    constructor(configuration) {super(); this.configuration = structuredClone(configuration); peers.push(this);}
    createDataChannel(name) {const channel = new Channel(); channel.label = name; this.channels.push(channel); return channel;}
    async createOffer() {return {type: 'offer', sdp: 'v=0\r\n'};}
    async createAnswer() {return {type: 'answer', sdp: 'v=0\r\n'};}
    async setLocalDescription(value) {this.localDescription = value; this.iceGatheringState = 'gathering';}
    async setRemoteDescription(value) {this.remoteDescription = value;}
    async getStats() {
      this.statsCalls++;
      return new Map([['transport', {type: 'transport', selectedCandidatePairId: 'pair'}],
        ['pair', {type: 'candidate-pair', localCandidateId: 'left', remoteCandidateId: 'right'}],
        ['left', {candidateType: 'relay'}], ['right', {candidateType: 'relay'}]]);
    }
    gather(candidates = [], {relay = false} = {}) {
      assert.ok(this.localDescription, 'The real controller supplied a local description');
      if (relay) this.localDescription = {...this.localDescription, sdp: 'v=0\r\na=candidate:1 1 udp 1 203.0.113.9 5000 typ relay raddr 10.0.0.1 rport 9000\r\n'};
      for (const candidate of candidates) this.emit('icecandidate', {candidate});
      this.iceGatheringState = 'complete'; this.emit('icegatheringstatechange');
    }
    close() {this.closed++;}
  }
  const NativeObserver = env.window.MutationObserver;
  class Observer extends NativeObserver {
    disconnected = false;
    constructor(callback) {super(callback); this.callback = callback; observers.push(this);}
    disconnect() {this.disconnected = true; super.disconnect();}
  }
  for (const target of [globalThis, env.window]) {
    replace(target, 'WebSocket', Socket); replace(target, 'RTCPeerConnection', Peer);
    replace(target, 'fetch', () => {fetchCalls++; throw Error('Live fetch is forbidden in this synthetic suite');});
  }
  replace(env.window, 'MutationObserver', Observer);
  for (const method of ['pushState', 'replaceState', 'back', 'forward', 'go']) {
    replace(env.window.history, method, (...args) => historyCalls.push([method, ...args]));
  }
  replace(globalThis.performance, 'now', () => now);
  replace(globalThis, 'setTimeout', (fn, delay = 0, ...args) => {
    const id = ++sequence; timers.set(id, {fn: () => fn(...args), delay, at: now + delay}); return id;
  });
  replace(globalThis, 'clearTimeout', id => timers.delete(id));
  const f = {sockets, peers, timers, observers, historyCalls, get fetchCalls() {return fetchCalls;},
    async timeout(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `Expected original ${delay} ms timeout`);
      const [id, timer] = entry; timers.delete(id); now = Math.max(now, timer.at); await step(timer.fn);
    },
    async drain() {
      for (let count = 0; timers.size && count < 32; count++) {
        const [id, timer] = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
        timers.delete(id); now = Math.max(now, timer.at); await step(timer.fn);
      }
      assert.equal(timers.size, 0, 'Cleanup is bounded by 32 explicit fake-timer steps');
    },
    async ready(socket = sockets.at(-1), servers = iceServers, latency = 40) {
      await step(() => socket.receive({type: 'diagnostic-ready', iceServers: servers}));
      for (let index = 0; index < 3; index++) {
        const ping = socket.sent[index]; assert.equal(ping?.type, 'diagnostic-ping');
        await step(() => {now += latency; socket.receive({type: 'diagnostic-pong', nonce: ping.nonce});});
      }
      assert.deepEqual(socket.closes, [[1000, 'diagnostic complete']]);
    },
    async turn(left = peers.at(-2), right = peers.at(-1), latency = 80) {
      assert.equal(left.configuration.iceTransportPolicy, 'relay'); assert.equal(right.configuration.iceTransportPolicy, 'relay');
      await step(() => left.gather([], {relay: true})); await step(() => right.gather([], {relay: true}));
      const channel = left.channels[0]; await step(() => channel.open());
      for (let index = 0; index < 3; index++) {
        assert.match(channel.sent[index], /^turn-/);
        await step(() => {now += latency; channel.emit('message', {data: channel.sent[index]});});
      }
      assert.equal(left.statsCalls, 1); assert.equal(channel.closed, 1); assert.equal(left.closed, 1); assert.equal(right.closed, 1);
    },
    restore() {for (const restore of restorations.reverse()) restore();},
  };
  io = f; return f;
}
function candidate(address, {type = 'srflx', port = 4000, relatedAddress = '10.0.0.2', relatedPort = 5000} = {}) {
  return {candidate: `candidate:1 1 udp 1 ${address} ${port} typ ${type} raddr ${relatedAddress} rport ${relatedPort}`,
    type, address, port, relatedAddress, relatedPort};
}
const directCandidates = () => [candidate('198.51.100.8'), candidate('2001:db8::8')];
function modelFixture(locale = 'en', options = {}) {
  const calls = {relay: 0, fallback: 0}, publications = [];
  const model = api.createNetworkDiagnosticsModel({
    getRelayUrl: () => {calls.relay++; return relayUrl;},
    getFallbackIceServers: () => {calls.fallback++; return [{urls: 'stun:stun.invalid:3478'}];},
    translate: (key, params) => t(locale, key, params), ...options});
  models.add(model); model.subscribe(() => publications.push(model.getSnapshot()));
  return {model, calls, publications};
}
async function mount(initial = {}, {locale = 'en', strict = false} = {}) {
  const ref = React.createRef(), running = [], closeRequests = [], closed = [];
  let props = {open: true, ref, getRelayUrl: () => relayUrl, onRunningChange: value => running.push(value),
    onCloseRequest: () => closeRequests.push('close'), onClosed: () => closed.push('closed'), ...initial};
  const container = env.document.createElement('div'); env.document.body.append(container); const root = createRoot(container);
  async function render() {
    let tree = React.createElement(api.LocaleProvider, {locale}, React.createElement(api.NetworkDiagnosticsDialog, props));
    if (strict) tree = React.createElement(React.StrictMode, null, tree);
    await step(() => root.render(tree));
  }
  const m = {root, ref, running, closeRequests, closed, container,
    async update(patch) {props = {...props, ...patch}; await render();},
    async locale(value) {locale = value; await render();},
    async unmount() {await step(() => root.unmount()); mounts.delete(m);},
  };
  mounts.add(m); await render(); return m;
}
function normalized(node) {
  const attrs = [...node.attributes].filter(attr => !attr.name.startsWith('data-i18n') && attr.name !== 'open')
    .map(attr => [attr.name, attr.value]).sort(([a], [b]) => a.localeCompare(b));
  const children = []; let text = '';
  const flush = () => {const value = text.replace(/\s+/g, ' ').trim(); if (value) children.push(value); text = '';};
  for (const child of node.childNodes) {if (child.nodeType === 3) text += child.textContent; else if (child.nodeType === 1) {flush(); children.push(normalized(child));}}
  flush(); return [node.localName, attrs, children];
}
function originalDialog(locale) {
  const doc = new env.window.DOMParser().parseFromString(originalHTML, 'text/html'), dialog = n('#lobbyNetworkDialog', doc);
  for (const element of dialog.querySelectorAll('[data-i18n]')) element.textContent = t(locale, element.dataset.i18n);
  for (const element of dialog.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(locale, element.dataset.i18nAriaLabel));
  return dialog;
}
function rows() {return Object.fromEntries([...n('#mpNetworkResults').querySelectorAll('[data-network-result]')]
  .map(row => [row.dataset.networkResult, {state: row.dataset.state, value: row.querySelector('output').value}]));}
const pendingRows = locale => Object.fromEntries(['ws', 'turn', 'nat', 'ipv6'].map(kind => [kind, {state: 'pending', value: t(locale, 'networkCheck.checking')}]));

for (const locale of ['zh-CN', 'en']) test(`original dialog copy/classes/IDs/ARIA and inert open lifetime (${locale})`, async () => {
  const f = transport(), m = await mount({open: false}, {locale});
  assert.deepEqual(normalized(n('#lobbyNetworkDialog')), normalized(originalDialog(locale)));
  await m.update({open: true}); assert.equal(n('#lobbyNetworkDialog').open, true);
  await m.update({open: false}); await m.update({open: true});
  assert.equal(n('#mpNetworkResults').hidden, true); assert.deepEqual(f.sockets, []); assert.deepEqual(f.peers, []);
  assert.equal(m.ref.current.isRunning(), false);
});

for (const locale of ['zh-CN', 'en']) test(`original inline MP diagnostics reuses one real probe owner and exact controls (${locale})`, async () => {
  const f = transport(), ref = React.createRef(), container = env.document.createElement('div');
  env.document.body.append(container); const root = createRoot(container); mounts.add({root}); let guides = 0;
  await step(() => root.render(React.createElement(React.StrictMode, null, React.createElement(api.LocaleProvider, {locale},
    React.createElement(api.MultiplayerDiagnostics, {ref, getRelayUrl: () => relayUrl, onGuide: () => guides++})))));
  const original = new env.window.DOMParser().parseFromString(pinned('public/index.html'), 'text/html');
  const expected = n('#mpNetworkDiagnostics', original);
  for (const node of expected.querySelectorAll('[data-i18n]')) node.textContent = t(locale, node.dataset.i18n);
  assert.deepEqual(normalized(n('#mpNetworkDiagnostics')), normalized(expected));
  assert.equal(env.document.querySelectorAll('#mpNetworkResults').length, 1); assert.equal(f.sockets.length, 0);
  await step(() => n('#mpGuideOpen').click()); assert.equal(guides, 1); assert.equal(f.sockets.length, 0);
  await step(() => {n('#mpNetworkCheck').click(); n('#mpNetworkCheck').click();});
  assert.equal(f.sockets.length, 1); assert.equal(ref.current.isRunning(), true);
  assert.equal(n('#mpNetworkCheck').classList.contains('running'), true); assert.equal(n('#mpNetworkCheck').getAttribute('aria-disabled'), 'true');
  assert.equal(n('#mpNetworkCheck').disabled, false, 'Original guards duplicate execution without native disabling');
  await f.ready(undefined, []); await step(() => f.peers[0].gather(directCandidates()));
  assert.equal(ref.current.isRunning(), false); assert.equal(n('#mpNetworkCheck').hasAttribute('aria-disabled'), false);
  assert.equal(n('#mpNetworkResults').hidden, false); assert.equal(rows().ws.value, '40 ms');
});

test('document-lived borrowed probe model retains pending/results across inline, absent and modal presentations', async () => {
  const f = transport(), {model} = modelFixture('en'), container = env.document.createElement('div'), ref = React.createRef();
  env.document.body.append(container); const root = createRoot(container); const mounted = {root}; mounts.add(mounted);
  await step(() => root.render(React.createElement(React.StrictMode, null, React.createElement(api.LocaleProvider, {locale: 'en'},
    React.createElement(api.MultiplayerDiagnostics, {model, ref, getRelayUrl: () => relayUrl, onGuide() {}})))));
  await step(() => n('#mpNetworkCheck').click()); assert.equal(model.getSnapshot().running, true); assert.equal(f.sockets.length, 1);
  await step(() => root.unmount()); mounts.delete(mounted);
  const modal = await mount({model}, {strict: true});
  assert.equal(modal.ref.current.isRunning(), true); assert.equal(n('#mpNetworkResults').hidden, false); assert.equal(f.sockets.length, 1);
  await f.ready(undefined, []); await step(() => f.peers[0].gather(directCandidates()));
  const cached = model.getSnapshot(); assert.equal(cached.running, false); assert.equal(cached.rows.ws.value, '40 ms');
  await modal.unmount(); const reopened = await mount({model});
  assert.equal(model.getSnapshot(), cached); assert.deepEqual(rows(), cached.rows); assert.equal(f.sockets.length, 1);
  await reopened.unmount(); assert.equal(model.getSnapshot(), cached, 'Views do not dispose the supplied session model');
});

for (const locale of ['zh-CN', 'en']) test(`unchanged controller forwards pending, WS, direct and TURN phases (${locale})`, async () => {
  const f = transport(), m = await mount({}, {locale}); let run;
  await step(() => {run = operation(() => m.ref.current.run());});
  assert.equal(m.ref.current.isRunning(), true); assert.equal(n('#mpNetworkResults').hidden, false); assert.deepEqual(rows(), pendingRows(locale));
  assert.equal(f.sockets[0].url, relayUrl); assert.equal(f.peers[0].channels[0].label, 'network-check');
  await f.ready();
  assert.deepEqual(rows(), {...pendingRows(locale), ws: {state: 'good', value: '40 ms'}});
  await step(() => f.peers[0].gather(directCandidates()));
  assert.deepEqual(rows(), {ws: {state: 'good', value: '40 ms'}, turn: pendingRows(locale).turn,
    nat: {state: 'good', value: 'NAT3'}, ipv6: {state: 'good', value: t(locale, 'networkCheck.ipv6Available')}});
  await f.turn(); complete(run);
  assert.deepEqual(rows().turn, {state: 'good', value: '40 ms'}); assert.equal(m.ref.current.isRunning(), false);
  assert.equal(m.running[0], true); assert.equal(m.running.at(-1), false); assert.equal(f.timers.size, 0);
});

test('duplicate runs settle as original no-ops while the original run remains pending; later run is fresh', async () => {
  const f = transport(), {model, calls, publications} = modelFixture(); let first, duplicate;
  const idle = model.getSnapshot(); assert.equal(idle, model.getSnapshot()); assert.equal(idle, api.initialNetworkDiagnosticsSnapshot);
  await step(() => {first = operation(() => model.run()); duplicate = operation(() => model.run());});
  complete(duplicate); assert.equal(first.settled, false); assert.equal(model.getSnapshot().running, true);
  assert.deepEqual(calls, {relay: 1, fallback: 1}); assert.equal(f.sockets.length, 1); assert.equal(f.peers.length, 1);
  const pending = model.getSnapshot(); assert.ok(Object.isFrozen(pending)); assert.ok(Object.isFrozen(pending.rows)); assert.ok(Object.isFrozen(pending.rows.ws));
  assert.equal(publications.length, 1, 'The duplicate-run no-op does not republish a snapshot');
  await f.ready(undefined, []); await step(() => f.peers[0].gather([])); complete(first);
  assert.deepEqual(pending.rows, pendingRows('en'), 'Earlier snapshots remain unchanged after later results');
  assert.deepEqual(model.getSnapshot().rows.turn, {state: 'bad', value: 'Unavailable'});
  let next; await step(() => {next = operation(() => model.run());});
  assert.deepEqual(model.getSnapshot().rows, pendingRows('en')); assert.equal(model.getSnapshot().running, true);
  assert.deepEqual(calls, {relay: 2, fallback: 2}); assert.equal(f.sockets.length, 2);
  await f.ready(undefined, []); await step(() => f.peers[1].gather([])); complete(next);
});

test('original threshold, NAT4 and IPv6 failure results pass through without view reclassification', async () => {
  const f = transport(), m = await mount(); let run; await step(() => {run = operation(() => m.ref.current.run());});
  await f.ready(undefined, iceServers, 180);
  await step(() => f.peers[0].gather([candidate('198.51.100.8', {port: 4000}), candidate('198.51.100.8', {port: 4001})]));
  await f.turn(undefined, undefined, 360); complete(run);
  assert.deepEqual(rows(), {ws: {state: 'bad', value: '180 ms'}, turn: {state: 'bad', value: '180 ms'},
    nat: {state: 'bad', value: 'NAT4'}, ipv6: {state: 'bad', value: 'Unavailable'}});
});

test('dedicated timeout uses original isolated legacy handshake and reports missing TURN', async () => {
  const f = transport(), {model} = modelFixture(); let run; await step(() => {run = operation(() => model.run());});
  await f.timeout(3000);
  assert.equal(f.sockets.length, 2); assert.deepEqual(f.sockets[0].closes, [[1000, 'diagnostic complete']]);
  const legacy = new URL(f.sockets[1].url); assert.match(legacy.searchParams.get('room'), /^diagnostic-/);
  assert.equal(legacy.searchParams.has('diagnostic'), false); assert.equal(legacy.searchParams.get('players'), '2');
  assert.equal(legacy.searchParams.get('player'), '0'); assert.equal(legacy.searchParams.get('signal'), '1'); assert.equal(legacy.searchParams.get('keep'), 'fixture');
  await step(() => f.sockets[1].receive({type: 'peers', iceServers: []}));
  await step(() => f.peers[0].gather([candidate('203.0.113.8', {type: 'host'})])); complete(run);
  assert.deepEqual(model.getSnapshot().rows, {ws: {state: 'good', value: '1 ms'}, turn: {state: 'bad', value: 'Unavailable'},
    nat: {state: 'good', value: 'NAT1'}, ipv6: {state: 'bad', value: 'Unavailable'}});
});

test('original WS ping, legacy handshake and ICE timeouts settle failure and release all fake resources', async () => {
  const f = transport(), m = await mount({}, {locale: 'zh-CN'}); let run; await step(() => {run = operation(() => m.ref.current.run());});
  await step(() => f.sockets[0].receive({type: 'diagnostic-ready', iceServers}));
  assert.equal(f.sockets[0].sent.length, 1); await f.timeout(2000); await f.timeout(6000); await f.timeout(8000); complete(run);
  assert.deepEqual(rows(), {ws: {state: 'bad', value: '连接失败'}, turn: {state: 'bad', value: '不可用'},
    nat: {state: 'bad', value: '连接失败'}, ipv6: {state: 'bad', value: '不可用'}});
  assert.equal(m.ref.current.isRunning(), false); assert.equal(f.timers.size, 0);
});

test('TURN payload timeout is a failed probe, not unavailable, and closes both original relay peers', async () => {
  const f = transport(), {model} = modelFixture(); let run; await step(() => {run = operation(() => model.run());});
  await f.ready(); await step(() => f.peers[0].gather(directCandidates()));
  await step(() => f.peers[1].gather([], {relay: true})); await step(() => f.peers[2].gather([], {relay: true}));
  const channel = f.peers[1].channels[0]; await step(() => channel.open());
  await step(() => channel.emit('message', {data: 'wrong-nonce'})); assert.equal(run.settled, false);
  await f.timeout(2500); complete(run);
  assert.deepEqual(model.getSnapshot().rows.turn, {state: 'bad', value: 'Connection failed'});
  assert.equal(channel.closed, 1); assert.equal(f.peers[1].closed, 1); assert.equal(f.peers[2].closed, 1);
});

for (const phase of ['ICE allocation', 'data-channel opening']) test(`original TURN ${phase} timeout closes both peers and publishes failure`, async () => {
  const f = transport(), {model} = modelFixture(); let run; await step(() => {run = operation(() => model.run());});
  await f.ready(); await step(() => f.peers[0].gather(directCandidates()));
  if (phase === 'data-channel opening') {
    await step(() => f.peers[1].gather([], {relay: true})); await step(() => f.peers[2].gather([], {relay: true}));
  }
  await f.timeout(12000); complete(run);
  assert.deepEqual(model.getSnapshot().rows.turn, {state: 'bad', value: 'Connection failed'});
  assert.equal(f.peers[1].channels[0].closed, 1); assert.equal(f.peers[1].closed, 1); assert.equal(f.peers[2].closed, 1);
});

for (const intent of ['button', 'cancel', 'backdrop']) test(`${intent} dismissal issues one central request; controlled Back never issues another`, async () => {
  transport(); const m = await mount();
  await step(() => n('#lobbyNetworkTitle').click()); assert.deepEqual(m.closeRequests, []);
  const cancel = new env.window.Event('cancel', {cancelable: true});
  const dismiss = () => intent === 'button' ? n('#lobbyNetworkClose').click() : intent === 'cancel'
    ? n('#lobbyNetworkDialog').dispatchEvent(cancel) : n('#lobbyNetworkDialog').click();
  await step(() => {dismiss(); dismiss();});
  if (intent === 'cancel') assert.equal(cancel.defaultPrevented, true);
  assert.equal(n('#lobbyNetworkDialog').open, false); assert.deepEqual(m.closeRequests, ['close']); assert.deepEqual(m.closed, ['closed']);
  await m.update({open: false}); assert.deepEqual(m.closeRequests, ['close']); assert.deepEqual(m.closed, ['closed']);
  await m.update({open: true}); await m.update({open: false});
  assert.deepEqual(m.closeRequests, ['close']); assert.deepEqual(m.closed, ['closed', 'closed']);
});

test('real Router: explicit click runs once; close and Back/Forward retain same-URL cached results without probing', async () => {
  const f = transport(), controls = {requests: 0, navigation: null, operations: []}, ref = React.createRef();
  function Contents() {
    const navigation = api.useSurfaceNavigation(); controls.navigation = navigation;
    // Thin click-intent seam matching BrowserLauncher.Directory. The actual
    // dialog/model/provider run; this is not a production BrowserLauncher mount.
    return React.createElement(React.Fragment, null,
      React.createElement('button', {id: 'fixtureNetworkClick', onClick() {
        navigation.openInfoDialog('lobbyNetworkDialog'); controls.operations.push(operation(() => ref.current.run()));
      }}, 'Check network'),
      React.createElement(api.NetworkDiagnosticsDialog, {ref, getRelayUrl: () => relayUrl,
        open: navigation.infoDialogOpen('lobbyNetworkDialog'), onCloseRequest() {controls.requests++; navigation.closeInfoDialog('lobbyNetworkDialog');}}));
  }
  const tree = React.createElement(api.LocaleProvider, {locale: 'en'}, React.createElement(api.SurfaceNavigationProvider,
    {dirty: false, isEditing: false, onDiscard() {}}, React.createElement(Contents)));
  const initial = {pathname: '/lobby.html', search: '?game=th06mp&keep=a%20b', hash: '#retained', state: {unrelated: 7}};
  const router = createMemoryRouter([{path: '*', element: tree}], {initialEntries: [initial]});
  const container = env.document.createElement('div'); env.document.body.append(container); const root = createRoot(container);
  mounts.add({root, router}); await step(() => root.render(React.createElement(RouterProvider, {router})));
  const home = router.state.location.key, href = () => {const {pathname, search, hash} = router.state.location; return pathname + search + hash;};
  const address = href(); assert.equal(f.sockets.length, 0);
  await step(() => {n('#fixtureNetworkClick').click(); n('#fixtureNetworkClick').click();});
  const networkEntry = router.state.location.key; assert.notEqual(networkEntry, home); assert.equal(href(), address);
  assert.equal(router.state.location.state.unrelated, 7); assert.equal(f.sockets.length, 1); complete(controls.operations[1]);
  await step(() => n('#lobbyNetworkClose').click());
  assert.equal(controls.requests, 1); assert.equal(router.state.location.key, home); assert.equal(ref.current.isRunning(), true);
  await f.ready(undefined, []); await step(() => f.peers[0].gather(directCandidates())); complete(controls.operations[0]);
  const cached = rows(); assert.equal(n('#lobbyNetworkDialog').open, false);
  await step(() => {void router.navigate(1);});
  assert.equal(router.state.location.key, networkEntry); assert.equal(n('#lobbyNetworkDialog').open, true);
  assert.deepEqual(rows(), cached); assert.equal(f.sockets.length, 1); assert.equal(f.peers.length, 1);
  await step(() => {void router.navigate(-1);}); await step(() => {void router.navigate(1);});
  assert.equal(controls.requests, 1); assert.equal(f.sockets.length, 1); assert.equal(href(), address);
});

test('latest locale/getter/callback props drive the next explicit run without recreating the owner', async () => {
  const f = transport(), m = await mount({open: false}, {locale: 'zh-CN'}), latest = [];
  const count = f.observers.length, nextUrl = 'wss://new-relay.invalid/?diagnostic=1';
  await m.locale('en'); await m.update({open: true, getRelayUrl: () => nextUrl,
    getFallbackIceServers: () => [{urls: 'stun:new-stun.invalid'}], onRunningChange: value => latest.push(value)});
  assert.equal(f.observers.length, count); assert.equal(f.sockets.length, 0); assert.equal(n('#lobbyNetworkTitle').textContent, 'Network status');
  let run; await step(() => {run = operation(() => m.ref.current.run());});
  assert.equal(f.sockets[0].url, nextUrl); assert.equal(f.peers[0].configuration.iceServers[0].urls, 'stun:new-stun.invalid');
  assert.deepEqual(rows(), pendingRows('en')); await f.ready(undefined, []); await step(() => f.peers[0].gather([])); complete(run);
  assert.equal(latest[0], true); assert.equal(latest.at(-1), false); assert.deepEqual(m.running, []);
});

test('disposed model fences state and finally publication while original timeout cleanup still finishes', async () => {
  const f = transport(), {model, publications} = modelFixture(); let run; await step(() => {run = operation(() => model.run());});
  const cached = model.getSnapshot(), count = publications.length; model.dispose();
  assert.equal(f.observers.length, 0, 'Pure state installs no presentation observer'); assert.equal(f.sockets[0].closes.length, 0); assert.equal(f.peers[0].closed, 0);
  await model.run();
  assert.equal(f.sockets.length, 1, 'Calling a retired model cannot launch another probe');
  await f.timeout(3000); await f.timeout(8000); await f.timeout(6000); complete(run);
  assert.equal(model.getSnapshot(), cached); assert.equal(publications.length, count);
  assert.equal(f.sockets.length, 2, 'Already-started original probe retains its legacy fallback after disposal');
});

test('StrictMode uses pure state and unmount fences callbacks, old handles and later remount state', async () => {
  const f = transport(), first = await mount({}, {strict: true});
  assert.equal(f.observers.length, 0, 'Neither StrictMode lifetime manufactures a detached DOM observer');
  assert.equal(f.sockets.length, 0); assert.deepEqual(first.closeRequests, []); assert.deepEqual(first.closed, []);
  const oldHandle = first.ref.current; let run; await step(() => {run = operation(() => oldHandle.run());});
  assert.equal(f.sockets.length, 1); await first.unmount(); assert.equal(first.running.at(-1), false); assert.equal(oldHandle.isRunning(), false);
  await assert.rejects(oldHandle.run(), /not mounted/); const afterUnmount = first.running.length;
  const second = await mount({}, {strict: true}); const newCallbacks = [...second.running];
  // Old successful WS/ICE/TURN callbacks, not only timeout failures, must be
  // unable to publish into either the retired mount or the new empty owner.
  await f.ready(); await step(() => f.peers[0].gather(directCandidates())); await f.turn(); complete(run);
  assert.equal(first.running.length, afterUnmount); assert.deepEqual(second.running, newCallbacks);
  assert.equal(n('#mpNetworkResults').hidden, true); assert.equal(second.ref.current.isRunning(), false);
  assert.deepEqual(first.closeRequests, []); assert.deepEqual(first.closed, []);
});

function nativeDiagnostics(factory, options) {
  const document = new env.window.DOMParser().parseFromString(originalHTML, 'text/html');
  const button = n('#lobbyNetworkCheck', document), panel = n('#mpNetworkResults', document);
  const controller = factory({...options, button, panel});
  return {...controller, panel, read() {
    return {hidden: panel.hidden, running: controller.isRunning(),
      ariaDisabled: button.getAttribute('aria-disabled'), runningClass: button.classList.contains('running'),
      rows: Object.fromEntries([...panel.querySelectorAll('[data-network-result]')].map(row =>
        [row.dataset.networkResult, {state: row.dataset.state, value: row.querySelector('output').value}]))};
  }};
}
function reactDiagnostics(options) {
  const model = api.createNetworkDiagnosticsModel(options); models.add(model);
  return {...model, read() {const snapshot = model.getSnapshot(); return {...snapshot,
    ariaDisabled: snapshot.running ? 'true' : null, runningClass: snapshot.running};}};
}

test('shared state and React adapter allocate no detached DOM or observation and deeply freeze idle snapshots', () => {
  const f = transport(), originalCreate = env.document.createElement;
  env.document.createElement = () => {throw Error('Pure diagnostics must not allocate presentation nodes');};
  try {
    const {model} = modelFixture();
    const snapshot = model.getSnapshot();
    assert.equal(snapshot, api.initialNetworkDiagnosticsSnapshot);
    assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.rows));
    for (const row of Object.values(snapshot.rows)) assert.ok(Object.isFrozen(row));
    assert.equal(f.observers.length, 0); assert.equal(f.sockets.length, 0); assert.equal(f.peers.length, 0);
    assert.doesNotMatch(readFileSync(resolve(project, 'app/components/directory/network-diagnostics-model.ts'), 'utf8'), /createElement|querySelector|MutationObserver|documentObj/);
  } finally {env.document.createElement = originalCreate;}
});

test('current main controller and React model match the executed pinned controller through captured inputs and live translated settlement', async () => {
  const f = transport(), results = [];
  for (const factory of [options => nativeDiagnostics(pinnedApi.createNetworkDiagnosticsController, options),
    options => nativeDiagnostics(api.createNetworkDiagnosticsController, options), reactDiagnostics]) {
    let locale = 'zh-CN', relay = relayUrl, fallback = [{urls: 'stun:first.invalid'}];
    const calls = {relay: 0, fallback: 0}, checking = [], phases = [];
    const owner = factory({getRelayUrl: () => {calls.relay++; return relay;},
      getFallbackIceServers: () => {calls.fallback++; return fallback;},
      translate: (key, params) => {if (key === 'networkCheck.checking') checking.push(key); return t(locale, key, params);}});
    const socketIndex = f.sockets.length, peerIndex = f.peers.length;
    let run, duplicate;
    await step(() => {run = operation(owner.run); duplicate = operation(owner.run);});
    complete(duplicate); assert.equal(run.settled, false); phases.push(owner.read());
    // Main captures URL/ICE once per run, while result copy deliberately uses
    // the latest translation callback at the moment that phase settles.
    relay = 'wss://replacement.invalid/?diagnostic=1'; fallback = [{urls: 'stun:replacement.invalid'}]; locale = 'en';
    assert.equal(f.sockets[socketIndex].url, relayUrl);
    assert.equal(f.peers[peerIndex].configuration.iceServers[0].urls, 'stun:first.invalid');
    await f.ready(f.sockets[socketIndex], iceServers, 180); phases.push(owner.read());
    assert.deepEqual(f.peers[peerIndex + 1].configuration.iceServers, iceServers);
    await step(() => f.peers[peerIndex].gather([candidate('198.51.100.8', {port: 4000}), candidate('198.51.100.8', {port: 4001})]));
    phases.push(owner.read());
    await f.turn(f.peers[peerIndex + 1], f.peers[peerIndex + 2], 360); complete(run); phases.push(owner.read());
    assert.deepEqual(calls, {relay: 1, fallback: 1}); assert.equal(checking.length, 4);
    results.push(phases);
  }
  assert.deepEqual(results[1], results[0], 'Main DOM adapter preserves every pinned visible phase');
  assert.deepEqual(results[2], results[0], 'React snapshots preserve every pinned visible phase');
});

test('current main controller and React model retain pinned getter-error finally state', async () => {
  transport(); const results = [];
  for (const factory of [options => nativeDiagnostics(pinnedApi.createNetworkDiagnosticsController, options),
    options => nativeDiagnostics(api.createNetworkDiagnosticsController, options), reactDiagnostics]) {
    const owner = factory({getRelayUrl: () => {throw Error('synthetic relay getter failure');},
      getFallbackIceServers: () => {throw Error('fallback must not be read');}, translate: (key, params) => t('en', key, params)});
    await assert.rejects(owner.run(), /synthetic relay getter failure/); await step(); results.push(owner.read());
  }
  assert.deepEqual(results[1], results[0]); assert.deepEqual(results[2], results[0]);
  assert.equal(results[0].running, false); assert.equal(results[0].hidden, false);
});

test('main DOM adapter reopens manually hidden results on each explicit run like pinned main', async () => {
  const f = transport();
  for (const factory of [pinnedApi.createNetworkDiagnosticsController, api.createNetworkDiagnosticsController]) {
    const owner = nativeDiagnostics(factory, {getRelayUrl: () => relayUrl, getFallbackIceServers: () => [], translate: (key, params) => t('en', key, params)});
    for (let index = 0; index < 2; index++) {
      owner.panel.hidden = true; const peerIndex = f.peers.length; let run;
      await step(() => {run = operation(owner.run);}); assert.equal(owner.panel.hidden, false);
      await f.ready(undefined, []); await step(() => f.peers[peerIndex].gather([])); complete(run);
    }
  }
});
