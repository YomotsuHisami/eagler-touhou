/** Synthetic protocol/lifetime checks; no live relay or browser QA claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'ui-lobby-directory-'));
after(() => rm(folder, {recursive: true, force: true}));
const plugin = {name: 'authored-browser-contracts', setup(builder) {
  builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path), authored = path.replace(/\.mjs$/, '.mts');
    if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
  });
}};
async function bundled(name, source) {
  const result = await build({entryPoints: [join(root, source)], bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [plugin]});
  assert.doesNotMatch(result.outputFiles[0].text, /src\/launcher\/(?:app|lobby)\.mts|node:/);
  const path = join(folder, `${name}.mjs`); await writeFile(path, result.outputFiles[0].text);
  return import(pathToFileURL(path).href);
}
const {createLobbyDirectory, parseLobbyRoom, lobbyRoomState} = await bundled('service', 'app/services/lobby-directory.client.ts');
const {createLobbyDirectoryDocumentOwner, isLobbyDirectoryRoute} = await bundled('owner', 'app/components/LobbyDirectoryProvider.tsx');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
function clock() {
  let now = 0, sequence = 0;
  const tasks = new Map();
  return {
    set(callback, delay) {const id = ++sequence; tasks.set(id, {callback, at: now + delay}); return id;},
    clear(id) {tasks.delete(id);},
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const [id, job] = [...tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0] ?? [];
        if (!job || job.at > end) break;
        now = job.at; tasks.delete(id); job.callback();
      }
      now = end;
    },
    size: () => tasks.size,
  };
}
class Socket {
  readyState = 0;
  sent = [];
  closes = [];
  listeners = new Map();
  constructor(url) {this.url = url;}
  addEventListener(type, listener) {const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list);}
  send(data) {if (this.readyState !== 1) throw Error('not open'); this.sent.push(JSON.parse(data));}
  close(code, reason) {this.readyState = 3; this.closes.push({code, reason});}
  emit(type, event) {for (const listener of this.listeners.get(type) ?? []) listener(event);}
  open() {this.readyState = 1;}
  snapshot(patch = {}) {this.emit('message', {data: JSON.stringify({type: 'directory', version: 1, membershipRecovery: true, product: 'th06mp', rooms: [], total: 0, mine: null, ...patch})});}
  remoteClose(code = 1006) {this.readyState = 3; this.emit('close', {code});}
}
function manifest({relay = 'wss://relay.example.test/netplay?key=public-site&room=wrong&player=1&lobby=old&diagnostic=1', testBuild = false} = {}) {
  const game = id => ({runtime: `runtime/${id}/${id}.html`, gameData: {path: `${id}.data`, bytes: 3, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}`}, music: {midi: {files: ['01.mid']}}, languages: [], languageOptions: [{id: 'ja', pack: null}]});
  return {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
    shared: {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf', ...(relay ? {netplayRelay: relay} : {}), testBuild},
    games: {th06: game('th06'), th07: game('th07'), th08: game('th08'), th09: game('th09')}};
}
const room = (patch = {}) => ({product: 'th06mp', code: '1234', capacity: 2, difficulty: 1, phase: 'lobby', joinable: true,
  seats: [{initial: '红', ready: true, online: true, controlMode: 'touch'}, null], ready: 1, spectators: 2, ...patch});
function fixture({host = manifest(), fetchImpl, randomWord = () => 234} = {}) {
  const timers = clock(), sockets = [], requests = [], saves = [], clears = [], identities = [];
  const controller = createLobbyDirectory({baseUrl: 'https://example.test/review/', timers, randomWord, getMemberId: () => 'member_test_123',
    fetchImpl: async (url, init) => {requests.push({url: String(url), init}); return fetchImpl ? fetchImpl(url, init) : new Response(JSON.stringify(host));},
    createSocket(url) {const socket = new Socket(url); sockets.push(socket); return socket;},
    identity: {lobbyClientId(product) {identities.push(product); return 'client_test_123';}},
    sessions: {save(product, snapshot) {saves.push({product, snapshot});}, clear(product) {clears.push(product);}},
  });
  after(() => controller.dispose());
  return {controller, timers, sockets, requests, saves, clears, identities,
    async live(patch = {}, product = 'th06mp') {controller.setActive(true, product); await tick(); const socket = sockets.at(-1); assert.ok(socket); socket.open(); socket.snapshot(patch); return socket;}};
}

test('directory is opt-in, uses the Host relay contract and never starts a room transport', async () => {
  const f = fixture(); assert.equal(f.controller.getSnapshot().connection, 'idle'); assert.equal(f.requests.length, 0);
  f.controller.setActive(false); f.controller.retry(); f.controller.refresh(); f.controller.networkChanged(); assert.equal(f.requests.length, 0);
  const socket = await f.live();
  assert.equal(f.requests[0].url, 'https://example.test/review/host-manifest.json'); assert.equal(f.requests[0].init.cache, 'no-store');
  assert.deepEqual(f.controller.getSnapshot().products, ['th06mp', 'th07mp', 'th08mp', 'th09mp']);
  const url = new URL(socket.url); assert.equal(url.protocol, 'wss:'); assert.equal(url.pathname, '/netplay'); assert.equal(url.searchParams.get('key'), 'public-site');
  assert.equal(url.searchParams.get('directory'), '1'); assert.equal(url.searchParams.get('member'), 'member_test_123');
  for (const role of ['room', 'run', 'player', 'lobby', 'diagnostic']) assert.equal(url.searchParams.has(role), false);
  const diagnostic = new URL(f.controller.getSnapshot().diagnosticRelayUrl);
  assert.equal(diagnostic.searchParams.get('diagnostic'), '1');assert.equal(diagnostic.searchParams.get('key'), 'public-site');
  for (const role of ['directory', 'member', 'room', 'run', 'player', 'lobby']) assert.equal(diagnostic.searchParams.has(role), false);
  assert.equal(f.sockets.length, 1, 'exposing diagnostic configuration does not run a probe');
  f.controller.setActive(true, 'th06mp'); f.controller.setActive(true, 'th06mp'); assert.equal(f.sockets.length, 1);
  assert.equal(f.identities.length, 0); assert.equal(f.saves.length, 0); assert.equal(f.clears.length, 0);
});

test('directory validates public metadata and derives players from the seat snapshot', async () => {
  const f = fixture();
  await f.live({rooms: [room({players: 999, ready: 99, spectators: 9999, difficulty: 999, disableCheatMovement: true, challengeMode: true,
    seats: [{initial: '\u0000🦊long', ready: true, online: false, controlMode: 'cheat'}, null]}), room({product: 'th09mp'}), room({code: 'bad'}), room({capacity: 8})], total: 500});
  const snapshot = f.controller.getSnapshot(); assert.equal(snapshot.connection, 'live'); assert.equal(snapshot.rooms.length, 1);
  const parsed = snapshot.rooms[0]; assert.equal(parsed.players, 1); assert.equal(parsed.ready, 2); assert.equal(parsed.spectators, 999); assert.equal(parsed.seats[0].initial, '🦊');
  assert.equal(parsed.seats[0].online, false); assert.equal(parsed.disableCheatMovement, true); assert.equal(parsed.challengeMode, true); assert.equal(parsed.seats[0].controlMode, 'cheat');
  assert.equal(parseLobbyRoom(room({product: 'th09mp', challengeMode: true}), ['th09mp']).challengeMode, false);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(parsed.seats)); assert.equal(lobbyRoomState(parsed), 'recruiting');
  assert.equal(lobbyRoomState({...parsed, players: 2}), 'full'); assert.equal(lobbyRoomState({...parsed, phase: 'playing'}), 'playing');
  const legacy = parseLobbyRoom(room({seats: undefined, initials: ['旧', null]}), ['th06mp']); assert.equal(legacy.seats[0].initial, '旧');
  assert.equal(parseLobbyRoom(room({product: {}}), ['th06mp']), null);
});

test('filters debounce, reject stale snapshots and retry missing filtered data without reconnecting', async () => {
  const f = fixture(), socket = await f.live({rooms: [room()]});
  f.controller.setActive(true, 'th07mp'); assert.equal(f.controller.getSnapshot().loadedProduct, null);
  f.timers.advance(179); assert.equal(socket.sent.length, 0); f.timers.advance(1);
  assert.deepEqual(socket.sent.at(-1), {type: 'refresh', product: 'th07mp'});
  socket.snapshot({rooms: [room({code: '5678'})]}); assert.equal(f.controller.getSnapshot().loadedProduct, null); assert.equal(f.controller.getSnapshot().rooms[0].code, '1234');
  f.timers.advance(3000); assert.equal(f.sockets.length, 1); assert.equal(socket.sent.length, 2);
  socket.snapshot({product: 'th07mp', rooms: [room({product: 'th07mp', code: '5678'}), room()], total: 1});
  assert.equal(f.controller.getSnapshot().loadedProduct, 'th07mp'); assert.deepEqual(f.controller.getSnapshot().rooms.map(row => row.code), ['5678']);
  f.timers.advance(20_000); assert.equal(f.sockets.length, 1);
});

test('first all-product snapshot requests the selected product and caps directory rows', async () => {
  const f = fixture(), socket = await f.live({product: '', rooms: [room()]});
  assert.equal(f.controller.getSnapshot().loadedProduct, null); assert.deepEqual(socket.sent.at(-1), {type: 'refresh', product: 'th06mp'});
  socket.snapshot({rooms: Array.from({length: 250}, (_, i) => room({code: String(1000 + i)})), total: 250});
  assert.equal(f.controller.getSnapshot().rooms.length, 200); assert.equal(f.controller.getSnapshot().total, 250);
});

test('disconnect reconnects once; old messages and closes cannot replace the new connection', async () => {
  const f = fixture(), first = await f.live({rooms: [room()]});
  first.remoteClose(); assert.equal(f.controller.getSnapshot().connection, 'loading');
  f.timers.advance(1499); assert.equal(f.sockets.length, 1); f.timers.advance(1); assert.equal(f.sockets.length, 2);
  const second = f.sockets.at(-1); second.open(); second.snapshot({rooms: [room({code: '5555'})]});
  first.snapshot({rooms: [room({code: '9999'})]}); first.remoteClose(1008); first.emit('error', {});
  assert.equal(f.controller.getSnapshot().connection, 'live'); assert.equal(f.controller.getSnapshot().rooms[0].code, '5555');
  f.timers.advance(30_000); assert.equal(f.sockets.length, 2);
});

test('only explicit pre-snapshot 1008 is unsupported and manual retry remains possible', async () => {
  const f = fixture(); f.controller.setActive(true); await tick(); f.sockets[0].remoteClose(1008);
  assert.equal(f.controller.getSnapshot().connection, 'unsupported'); f.timers.advance(120_000); assert.equal(f.sockets.length, 1);
  f.controller.retry(); assert.equal(f.sockets.length, 2); f.sockets[1].open(); f.sockets[1].snapshot();
  f.sockets[1].remoteClose(1008); assert.equal(f.controller.getSnapshot().connection, 'loading'); f.timers.advance(1500); assert.equal(f.sockets.length, 3);
});

test('silent handshake and an OPEN but unresponsive route are recoverable failures', async () => {
  const f = fixture(); f.controller.setActive(true); await tick();
  f.timers.advance(20_000); assert.equal(f.controller.getSnapshot().connection, 'offline'); assert.equal(f.sockets[0].closes.length, 1);
  f.timers.advance(1500); const second = f.sockets[1]; second.open(); second.snapshot();
  f.controller.refresh(); assert.equal(f.controller.getSnapshot().loadedProduct, null);
  f.timers.advance(20_000); assert.equal(f.controller.getSnapshot().connection, 'offline'); assert.equal(second.closes.length, 1);
});

test('recovery uses exactly the observed token and clears saved sessions only after confirmed release', async () => {
  const f = fixture(), mine = {product: 'th06mp', code: '1234', recoveryToken: 'session-one'};
  const socket = await f.live({mine});
  assert.throws(() => f.controller.joinRoomIntent('th06mp', '2345'), /另一个房间/);
  assert.equal(f.controller.releaseMembership(), true); assert.equal(f.controller.releaseMembership(), false);
  assert.deepEqual(socket.sent.at(-1), {type: 'release-membership', recoveryToken: 'session-one'}); assert.equal(f.clears.length, 0);
  socket.snapshot({mine}); assert.equal(f.controller.getSnapshot().recovering, true);
  socket.snapshot({mine: {...mine, recoveryToken: 'session-two'}}); assert.equal(f.controller.getSnapshot().recovering, false); assert.equal(f.clears.length, 0); assert.match(f.controller.getSnapshot().notice, /状态已经变化/);
  f.controller.releaseMembership(); socket.snapshot(); assert.deepEqual(f.clears, ['th06mp']); assert.equal(f.controller.getSnapshot().mine, null); assert.match(f.controller.getSnapshot().notice, /已释放/);
});

test('recovery timeout never claims release, and old servers cannot be sent recovery commands', async () => {
  const f = fixture(), socket = await f.live({mine: {product: 'th06mp', code: '1234', recoveryToken: 'session-one'}});
  f.controller.releaseMembership(); f.timers.advance(8000); assert.equal(f.controller.getSnapshot().recovering, false); assert.ok(f.controller.getSnapshot().mine); assert.equal(f.clears.length, 0); assert.match(f.controller.getSnapshot().notice, /未获确认/);
  socket.snapshot({membershipRecovery: false, mine: {product: 'th06mp', code: '1234', recoveryToken: 'session-one'}});
  assert.equal(f.controller.releaseMembership(), false);
});

test('create and join preserve room-session and route intent, never claim membership or open another socket', async () => {
  const f = fixture(), socket = await f.live({rooms: [room()]});
  const intent = f.controller.createRoomIntent({productId: 'th06mp', playerCount: 3, difficulty: 1, visibility: 'private', disableCheatMovement: true, challengeMode: true});
  assert.equal(intent.action, 'create'); assert.equal(intent.roomCode, '1235'); assert.equal(intent.productId, 'th06mp');
  const url = new URL(intent.href, 'https://example.test'); assert.equal(url.pathname, '/play/th06mp');
  assert.equal(url.searchParams.get('mpRoom'), '1235'); assert.equal(url.searchParams.get('room'), '1235'); assert.equal(url.searchParams.get('lobbyAction'), 'create'); assert.equal(url.searchParams.get('lobbyPlayers'), '3'); assert.equal(url.searchParams.get('lobbyVisibility'), 'private'); assert.equal(url.searchParams.get('lobbyDisableCheatMovement'), '1'); assert.equal(url.searchParams.get('lobbyChallengeMode'), '1');
  assert.deepEqual(f.saves[0], {product: 'th06mp', snapshot: {room: {code: '1235', playerCount: 3, difficulty: 1, created: true, visibility: 'private', disableCheatMovement: true, challengeMode: true}, seat: 0, ready: false, spectatorRequested: false, roomSettingsOpen: false}});
  assert.equal(f.controller.getSnapshot().mine, null); assert.equal(f.sockets.length, 1); assert.equal(socket.closes.length, 0); assert.equal(socket.sent.length, 0);
  const joined = f.controller.joinRoomIntent('th06mp', ' 98765432 '); assert.equal(joined.roomCode, '98765432'); assert.equal(new URL(joined.href, 'https://example.test').searchParams.has('lobbyPlayers'), false); assert.deepEqual(f.clears, ['th06mp']);
  f.controller.joinRoomIntent('th06mp', '1234', true);
  assert.throws(() => f.controller.joinRoomIntent('th06mp', '9999', true), /不能加入/);
  assert.throws(() => f.controller.joinRoomIntent('th06mp', 'abc'), /4 至 8/);
  assert.throws(() => f.controller.createRoomIntent({productId: 'th06mp', playerCount: 8, difficulty: 1, visibility: 'public'}), /无效/);
  assert.throws(() => f.controller.createRoomIntent({productId: 'th10mp', playerCount: 2, difficulty: 1, visibility: 'public'}), /不可用/);
});

test('leaving the explicit route aborts pending manifest work and ignores late resolutions', async () => {
  const pending = deferred(), f = fixture({fetchImpl: () => pending.promise});
  f.controller.setActive(true, 'th06mp'); assert.equal(f.requests.length, 1);
  f.controller.setActive(false); assert.equal(f.requests[0].init.signal.aborted, true); assert.equal(f.timers.size(), 0);
  pending.resolve(new Response(JSON.stringify(manifest()))); await tick(); assert.equal(f.sockets.length, 0); assert.equal(f.controller.getSnapshot().connection, 'idle');
});

test('leaving live route/disposal cancels retries and all late transport callbacks', async () => {
  const f = fixture(), socket = await f.live(); f.controller.refresh(); assert.ok(f.timers.size());
  f.controller.setActive(false); assert.equal(socket.closes.length, 1); assert.equal(f.timers.size(), 0);
  socket.snapshot(); socket.remoteClose(); f.timers.advance(120_000); assert.equal(f.sockets.length, 1); assert.equal(f.controller.getSnapshot().connection, 'idle');
  f.controller.setActive(true); await tick(); assert.equal(f.sockets.length, 2);
  f.controller.dispose(); f.controller.retry(); f.controller.setActive(true); f.timers.advance(120_000); assert.equal(f.sockets.length, 2); assert.equal(f.timers.size(), 0);
});

test('missing relay is explicit and available products follow validated Host visibility', async () => {
  const f = fixture({host: manifest({relay: '', testBuild: true})}); f.controller.setActive(true, 'th09mp'); await tick();
  assert.equal(f.controller.getSnapshot().connection, 'missing'); assert.deepEqual(f.controller.getSnapshot().products, ['th06mp', 'th07mp', 'th08mp', 'th09mp']); assert.equal(f.sockets.length, 0);
  assert.throws(() => f.controller.joinRoomIntent('th09mp', '1234'), /等待大厅连接/);
});

test('manifest timeout is cancelled safely and reconnect retries configuration', async () => {
  const pending = deferred(), f = fixture({fetchImpl: () => pending.promise}); f.controller.setActive(true);
  f.timers.advance(10_000); assert.equal(f.controller.getSnapshot().connection, 'offline'); assert.equal(f.requests[0].init.signal.aborted, true);
  f.timers.advance(1500); assert.equal(f.requests.length, 2);
  f.controller.dispose(); pending.resolve(new Response(JSON.stringify(manifest()))); await tick(); assert.equal(f.sockets.length, 0);
});

test('root document owner fences imports during pagehide and creates exactly once after BFCache return', async () => {
  const target = new EventTarget(), task = deferred(), created = [], values = [];
  const owner = createLobbyDirectoryDocumentOwner({target, load: () => task.promise, onController: value => values.push(value), onError: error => {throw error;}});
  owner.attach(); await tick(); target.dispatchEvent(new Event('pagehide'));
  task.resolve(() => {const item = {disposeCount: 0, dispose() {this.disposeCount++;}}; created.push(item); return item;}); await tick(); assert.equal(created.length, 0);
  target.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(created.length, 1);
  owner.detach(); owner.attach(); await tick(); assert.equal(created.length, 1);
  target.dispatchEvent(new Event('pagehide')); assert.equal(created[0].disposeCount, 1); assert.equal(values.at(-1), null);
  target.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(created.length, 2); owner.dispose(); assert.equal(created[1].disposeCount, 1);
});

test('directory route recognizer never activates networking for play, home, or prefix collisions', () => {
  for (const path of ['/lobby', '/lobby/']) assert.equal(isLobbyDirectoryRoute(path), true);
  for (const path of ['/', '/play/th06mp', '/play/th06mp?mpRoom=1234', '/lobby-other', '/lobby/settings']) assert.equal(isLobbyDirectoryRoute(path), false);
});


test('a subscriber cancelling activation cannot trigger network side effects afterward', async () => {
  const f = fixture();
  f.controller.subscribe(() => {if (f.controller.getSnapshot().connection === 'loading') f.controller.setActive(false);});
  f.controller.setActive(true); await tick();
  assert.equal(f.requests.length, 0); assert.equal(f.sockets.length, 0); assert.equal(f.timers.size(), 0);
});

test('malformed messages never establish a healthy directory connection', async () => {
  const f = fixture(); f.controller.setActive(true); await tick(); const socket = f.sockets[0]; socket.open();
  for (const data of ['not json', 'null', JSON.stringify({type: 'directory', version: 2, rooms: []}), JSON.stringify({type: 'directory', version: 1, rooms: {}})]) socket.emit('message', {data});
  assert.equal(f.controller.getSnapshot().connection, 'loading'); f.timers.advance(20_000); assert.equal(f.controller.getSnapshot().connection, 'offline');
});

test('listed joins reject full and playing snapshots while join-by-code remains a server-checked intent', async () => {
  const f = fixture(), socket = await f.live({rooms: [room({seats: ['A', 'B']})]});
  assert.throws(() => f.controller.joinRoomIntent('th06mp', '1234', true), /不能加入/);
  socket.snapshot({rooms: [room({phase: 'playing', joinable: true})]}); assert.throws(() => f.controller.joinRoomIntent('th06mp', '1234', true), /不能加入/);
  assert.equal(f.controller.joinRoomIntent('th06mp', '1234').action, 'join'); assert.equal(f.sockets.length, 1);
});
