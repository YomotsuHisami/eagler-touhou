import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Main-derived transport/model tests with synthetic sockets, clocks, storage,
 * preparation and Runtime ports. No live relay, game, networking or persistence
 * acceptance. Authorities: lobby.mts and app440–780/6796–6849/7552–7940. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, owner;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/room-owners-'));
  const file = resolve(work, 'owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createLobbyDirectory} from './app/services/lobby-directory.ts';
    export {createMultiplayerRoom} from './app/services/multiplayer-room.ts';
    export {createRoomPreparation} from './app/services/room-preparation.ts';
    export {createDecisionStore} from './app/models/decisions.ts';
    export {createMultiplayerIdentityStore,multiplayerDisplayNameStorageKey} from './src/launcher/multiplayer-identity.mts';
    export {createMultiplayerRoomSessionStore,multiplayerRoomSessionStorageKey} from './src/launcher/multiplayer-room-session.mts';
    export {createMultiplayerPreferenceStore} from './src/launcher/multiplayer-preferences.mts';
    export {encodeRoomInvite,decodeRoomInvite} from './src/launcher/room-invite.mts';
  `}, outfile: file, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
  plugins: [authoredSourcesPlugin(project)]});
  owner = await import(pathToFileURL(file).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const flush = async () => {for (let n = 0; n < 20; n++) await Promise.resolve();};
class Storage {
  values = new Map();
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.values.set(key, String(value));}
  removeItem(key) {this.values.delete(key);}
}
class Clock {
  now = 0; sequence = 0; tasks = new Map();
  setTimeout = (fn, delay) => {const id = ++this.sequence; this.tasks.set(id, {fn, at: this.now + delay}); return id;};
  clearTimeout = id => {this.tasks.delete(id);};
  tick(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.tasks].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.tasks.delete(next[0]); this.now = next[1].at; next[1].fn();
    }
    this.now = end;
  }
}
class Socket {
  readyState = 0; sent = []; listeners = new Map(); closes = [];
  constructor(url) {this.url = url;}
  addEventListener(type, fn) {this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);}
  emit(type, value = {}) {for (const fn of this.listeners.get(type) || []) fn(value);}
  open() {this.readyState = 1; this.emit('open');}
  message(value) {this.emit('message', {data: JSON.stringify(value)});}
  send(value) {assert.equal(this.readyState, 1); this.sent.push(JSON.parse(value));}
  close(code = 1000, reason = '') {this.readyState = 3; this.closes.push({code, reason}); this.emit('close', {code});}
}
function stores() {
  const persistent = new Storage(), session = new Storage();
  persistent.setItem(owner.multiplayerDisplayNameStorageKey, 'Alice Wonderland');
  return {persistent, session, identity: owner.createMultiplayerIdentityStore({persistentStorage: persistent, sessionStorage: session, randomWords: () => [1234567, 7654321]}),
    sessions: owner.createMultiplayerRoomSessionStore({storage: session}), preferences: owner.createMultiplayerPreferenceStore({storage: persistent})};
}
const hash = 'a'.repeat(64);
const manifest = () => ({schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'synthetic-test',
  shared: {resourceMode: 'hosted', vanillaFont: '../shared/msgothic.ttc', unicodeFont: '../shared/unifont.otf', netplayRelay: 'wss://relay.invalid/socket'},
  games: {th06: {runtime: 'runtime/th06/game.html', gameData: {version: `sha256-${hash}`, layout: `sha256-${hash}`, path: 'th06.data', bytes: 1, sha256: hash}, music: {midi: {files: []}}}}});
function directory(extra = {}) {
  const storage = stores(), clock = new Clock(), sockets = [], navigation = [], normalized = [];
  const service = owner.createLobbyDirectory({loadHostManifest: async () => manifest(), createSocket: url => {const socket = new Socket(url); sockets.push(socket); return socket;},
    memberId: () => 'member123456', ...storage, sessionStorage: storage.session, translate: key => key,
    launcherUrl: () => 'https://launcher.invalid/en.html', navigateToRoom: url => navigation.push(url),
    selectedProduct: 'th06mp', onSelectedProductNormalized: product => normalized.push(product), randomWord: () => 123,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...extra});
  return {service, clock, sockets, navigation, normalized, ...storage};
}
const directoryState = (overrides = {}) => ({type: 'directory', version: 1, rooms: [], product: 'th06mp', total: 0, ...overrides});
async function liveDirectory(extra) {
  const fixture = directory(extra); await fixture.service.initialize();
  fixture.sockets[0].open(); fixture.sockets[0].message(directoryState()); return fixture;
}

test('directory preserves main host-existence product subset and 3s retry without declaring socket offline', async () => {
  const fixture = await liveDirectory(); const {service, sockets, clock} = fixture, socket = sockets[0];
  assert.deepEqual(service.getSnapshot().products, ['th06mp'], 'directory does not require general metadata multiplayerRuntime field');
  assert.equal(new URL(socket.url).searchParams.get('member'), 'member123456');
  socket.message(directoryState({product: ''}));
  service.refreshRooms(); const sends = socket.sent.length;
  clock.tick(3000);
  assert.ok(socket.sent.length > sends); assert.equal(service.getSnapshot().connection, 'live'); assert.equal(socket.closes.length, 0);
  assert.ok(socket.sent.every(message => !Object.hasOwn(message, 'name')), 'directory never sends display name');
  clock.tick(17000);
  assert.equal(service.getSnapshot().connection, 'offline'); assert.equal(socket.closes.length, 1);
  clock.tick(1500); assert.equal(sockets.length, 2); service.dispose();
});

test('directory 10s manifest timeout and StrictMode-style suspend/resume do not strand leaving', async () => {
  const blocked = directory({loadHostManifest: () => new Promise(() => {})});
  const initializing = blocked.service.initialize(); blocked.clock.tick(10000); await initializing;
  assert.equal(blocked.service.getSnapshot().connection, 'offline'); blocked.service.dispose();
  const fixture = await liveDirectory(); fixture.service.pageHide(); assert.equal(fixture.service.getSnapshot().leaving, true);
  fixture.service.resumeView(); assert.equal(fixture.service.getSnapshot().leaving, false);
  assert.equal(fixture.sockets.length, 2); fixture.service.dispose();
});

test('directory retains form values across cancel and enters only after committed form close', async () => {
  const fixture = await liveDirectory(), {service, navigation} = fixture;
  assert.equal(service.prepareForm('create'), true);
  service.updateForm({code: '4567', visibility: 'private', disableCheatMovement: true, difficulty: 2});
  service.formDidClose(); assert.equal(navigation.length, 0);
  assert.equal(service.prepareForm('join'), true);
  const form = service.getSnapshot().form;
  assert.equal(form.code, '4567'); assert.equal(form.visibility, 'private'); assert.equal(form.disableCheatMovement, true); assert.equal(form.difficulty, 1);
  assert.equal(service.submitForm(), 'close'); assert.equal(navigation.length, 0);
  service.formDidClose(); assert.equal(navigation.length, 1);
  const invite = owner.decodeRoomInvite(new URL(navigation[0]).searchParams.get('j'));
  assert.deepEqual(invite, {g: 'th06mp', r: '4567', f: true, a: 'join', p: undefined, d: undefined, v: undefined, c: false});
  service.formDidClose(); assert.equal(navigation.length, 1); service.dispose();
});

test('directory release retains membership/session until authoritative removal and snapshots are bounded', async () => {
  const fixture = await liveDirectory(), {service, sockets, sessions, session} = fixture, socket = sockets[0];
  sessions.save('th06mp', {room: {code: '1234', playerCount: 2, difficulty: 1, created: true}, seat: 0, ready: false, spectatorRequested: false, roomSettingsOpen: false});
  const mine = {product: 'th06mp', code: '1234', recoveryToken: 'recovery-token'};
  socket.message(directoryState({mine, membershipRecovery: true,
    rooms: Array.from({length: 205}, (_, n) => ({product: 'th06mp', code: String(1000 + n), capacity: 2, phase: 'lobby', joinable: true, seats: ['Alice', null]}))}));
  assert.equal(service.getSnapshot().rooms.length, 200); assert.equal(service.getSnapshot().rooms[0].seats[0].initial, 'A');
  service.releaseMembership(); assert.ok(service.getSnapshot().mine); assert.ok(service.getSnapshot().recovering);
  assert.ok(session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')));
  socket.message(directoryState({mine, membershipRecovery: true})); assert.ok(service.getSnapshot().recovering);
  socket.message(directoryState({mine: null, membershipRecovery: true}));
  assert.equal(service.getSnapshot().mine, null); assert.equal(service.getSnapshot().recovering, null);
  assert.equal(session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')), null);
  assert.equal(service.getSnapshot().notice, 'lobby.released'); service.dispose();
});

function roomFixture(extra = {}) {
  const storage = stores(), clock = new Clock(), sockets = [], events = [], decisions = owner.createDecisionStore();
  const settings = {touchMovementMode: 'joystick', touchEnabled: false, mobileDevice: false, iceServers: []};
  const ports = {...storage, decisions, memberId: () => 'member123456', createSocket: url => {const socket = new Socket(url); sockets.push(socket); return socket;},
    relayUrl: () => 'wss://relay.invalid/socket', settings: () => settings, setMovementMode: mode => {settings.touchMovementMode = mode;},
    translate: key => key, notify: message => events.push(['notify', message]),
    prepareResources: async context => {events.push(['prepare', context]);}, preparationFailed: error => events.push(['prepare-error', error]),
    beginManualImport: context => events.push(['import', context]), launch: async context => {events.push(['launch', context]);},
    checkGame: async context => {events.push(['check', context]);}, operationFailed: (error, kind) => events.push(['operation-error', kind, error]),
    isLaunched: () => false, routes: {restore: value => events.push(['restore', value]), enter: value => events.push(['enter', value]),
      settleInvite: () => events.push(['settle']), leave: value => events.push(['leave', value])},
    network: {reset() {}, receive: message => events.push(['network', message]), minimumRtt: () => null},
    quickChat: {receive: message => events.push(['quick-chat', message])}, online: () => true, visible: () => true,
    now: () => clock.now, random: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...extra};
  const service = owner.createMultiplayerRoom(ports);
  return {service, ports, clock, sockets, events, decisions, settings, ...storage};
}
function roomState(clientId, overrides = {}) {
  return {code: '1234', playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
    seats: [{clientId, name: 'A', loadout: 0, ready: false}, null], spectators: [], ...overrides};
}
async function joinedRoom(extra = {}) {
  const fixture = roomFixture(extra); fixture.service.enterRoom('th06mp', '1234', true); await flush();
  const socket = fixture.sockets[0]; socket.open();
  socket.message({type: 'state', roomDirectory: {version: 1, controlModes: true}, room: roomState(fixture.identity.lobbyClientId('th06mp'))});
  return fixture;
}

test('room wire always minimizes names, keeps editable local name, and normalizes challenge/prank', async () => {
  const fixture = await joinedRoom(), {service, sockets, identity} = fixture, socket = sockets[0];
  assert.equal(socket.sent.find(message => message.type === 'take-seat').name, 'A');
  service.setDisplayName('Beatrice'); assert.equal(service.getSnapshot().displayName, 'Beatrice');
  assert.equal(socket.sent.findLast(message => message.type === 'set-name').name, 'B');
  service.standUp(); service.spectate(); assert.equal(socket.sent.findLast(message => message.type === 'spectate').name, 'B');
  service.sendControl({type: 'set-name', name: 'Charlie'}); assert.equal(socket.sent.at(-1).name, 'C');
  socket.message({type: 'state', room: roomState(identity.lobbyClientId('th06mp'), {challengeMode: true, prankMode: true})});
  assert.equal(service.getSnapshot().room.challengeMode, true); assert.equal(service.getSnapshot().room.prankMode, false);
  const runtime = service.runtimeOptions(); assert.equal(runtime.netplayChallengeMode, true);
  assert.equal(Object.hasOwn(runtime, 'netplayAdonisMode'), false, 'TH06 must not receive measured-title-only arguments');
  assert.equal(Object.hasOwn(runtime, 'netplayPredictionReserve'), false);
  assert.equal(new URL(runtime.netplayUrl).searchParams.get('member'), 'member123456'); service.dispose();
});

test('room take-seat commits only relay snapshot, and stale movement confirmation cannot seat in successor', async () => {
  const fixture = roomFixture(), {service, sockets, identity, decisions, settings} = fixture;
  service.enterRoom('th06mp', '1234', false); await flush(); const socket = sockets[0]; socket.open();
  socket.message({type: 'state', room: roomState('otherhost123')});
  await service.takeSeat(1); assert.equal(service.getSnapshot().seat, null);
  assert.equal(socket.sent.at(-1).type, 'take-seat');
  socket.message({type: 'state', room: roomState('otherhost123', {seats: [{clientId: 'otherhost123', name: 'H', loadout: 0},
    {clientId: identity.lobbyClientId('th06mp'), name: 'A', loadout: 1}]})});
  assert.equal(service.getSnapshot().seat, 1);
  service.standUp(); settings.touchMovementMode = 'touch-unlimited';
  socket.message({type: 'state', room: roomState('otherhost123', {disableCheatMovement: true})});
  const before = socket.sent.length, pending = service.takeSeat(1); assert.ok(decisions.getSnapshot());
  service.leave(); decisions.resolve('confirm'); await pending;
  assert.equal(socket.sent.length, before); assert.equal(settings.touchMovementMode, 'touch-unlimited'); service.dispose();
});

test('room restores created directory session and dispose preserves reload storage', async () => {
  const fixture = roomFixture(), {service, sessions, session} = fixture;
  sessions.save('th06mp', {room: {code: '4321', playerCount: 2, difficulty: 2, created: true, visibility: 'private', disableCheatMovement: true},
    seat: 0, ready: true, spectatorRequested: false, roomSettingsOpen: true});
  const token = owner.encodeRoomInvite({g: 'th06mp', r: '4321', f: true, a: 'create', p: 2, d: 1});
  assert.equal(service.restoreInvite(`https://launcher.invalid/?j=${token}`), true);
  assert.equal(service.getSnapshot().room.difficulty, 2); assert.equal(service.getSnapshot().seat, 0);
  assert.equal(service.getSnapshot().ready, true); assert.equal(service.getSnapshot().roomSettingsOpen, true);
  service.dispose(); assert.ok(session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')));
});

test('room serial/reconnect/terminal handling uses actual adapter calls and rejects old sockets', async () => {
  const fixture = await joinedRoom(), {service, sockets, clock, identity, events} = fixture;
  const snapshot = roomState(identity.lobbyClientId('th06mp'), {startSerial: 7});
  sockets[0].message({type: 'state', room: snapshot});
  sockets[0].message({type: 'start', serial: 7, room: snapshot}); await flush();
  assert.equal(events.filter(([kind]) => kind === 'launch').length, 0);
  sockets[0].message({type: 'start', serial: 8, room: snapshot}); await flush();
  assert.equal(events.filter(([kind]) => kind === 'launch').length, 1);
  const previous = sockets[0]; previous.close(1006); clock.tick(650);
  assert.equal(sockets.length, 2); sockets[1].open();
  const before = service.getSnapshot().startSerial; previous.message({type: 'start', serial: 1000, room: snapshot});
  assert.equal(service.getSnapshot().startSerial, before);
  sockets[1].close(4009); assert.equal(service.getSnapshot().room, null);
  assert.equal(events.findLast(([kind]) => kind === 'leave')[1].message, 'lobby.conflict');
  clock.tick(10000); assert.equal(sockets.length, 2); service.dispose();
});

test('room preflight waits the real preparation and check ports, coalesces clicks, and ignores stale completion', async () => {
  let finishPreparation, finishCheck;
  const preparation = new Promise(resolve => {finishPreparation = resolve;});
  const checking = new Promise(resolve => {finishCheck = resolve;});
  let checkCalls = 0;
  const fixture = await joinedRoom({prepareResources: () => preparation, checkGame: async context => {checkCalls++; assert.equal(context.isCurrent(), true); await checking;}});
  const {service, events} = fixture;
  const first = service.checkGame(), second = service.checkGame(); await flush();
  assert.equal(checkCalls, 0); assert.equal(service.getSnapshot().checkBusy, true);
  assert.equal(events.some(([kind, text]) => kind === 'notify' && text === 'multiplayer.checkGamePassed'), false);
  finishPreparation(); await flush(); assert.equal(checkCalls, 1);
  service.leave(); finishCheck(); await Promise.all([first, second]);
  assert.equal(events.some(([kind, text]) => kind === 'notify' && text === 'multiplayer.checkGamePassed'), false,
    'an old room check cannot announce success in its successor');
  assert.equal(service.getSnapshot().room, null); service.dispose();
});

test('room package cancel aborts only package work, unreaddies, prevents launch, and permits explicit retry', async () => {
  let report, finish, preparationContext, attempts = 0;
  const fixture = await joinedRoom({prepareResources: async (context, progress) => {
    attempts++; preparationContext = context; report = progress;
    if (attempts === 1) await new Promise(resolve => {finish = resolve;});
  }});
  const {service, sockets, events} = fixture, socket = sockets[0];
  await service.toggleReady(); assert.equal(service.getSnapshot().ready, true);
  service.cancelPreparation();
  assert.equal(preparationContext.signal.aborted, true); assert.equal(service.getSnapshot().preparation.status, 'cancelled');
  assert.equal(service.getSnapshot().ready, false); assert.equal(socket.sent.findLast(message => message.type === 'set-ready').ready, false);
  assert.equal(events.filter(([kind]) => kind === 'import').length, 1);
  const launch = service.launch(); finish(); await launch;
  assert.equal(events.some(([kind]) => kind === 'launch'), false);
  report({status: 'ready', stage: 'runtime', percent: 100, error: ''});
  assert.equal(service.getSnapshot().preparation.status, 'cancelled', 'late aborted progress cannot overwrite cancellation');
  service.retryPreparation(); await flush(); assert.equal(attempts, 2);
  assert.equal(service.getSnapshot().preparation.status, 'ready');
  await service.launch(); assert.equal(events.filter(([kind]) => kind === 'launch').length, 1); service.dispose();
});

test('room runtime-stage preparation cannot take package cancellation path and progress is socket-deduplicated', async () => {
  let report, finish;
  const fixture = await joinedRoom({prepareResources: async (_context, progress) => {report = progress; await new Promise(resolve => {finish = resolve;});}});
  const {service, sockets, events} = fixture, socket = sockets[0];
  const progress = {status: 'preparing', stage: 'package', percent: null, loaded: 13, total: 100, error: ''};
  report(progress); report({...progress, loaded: 14});
  assert.equal(socket.sent.filter(message => message.type === 'resource-progress' && message.percent === 10).length, 1);
  report({...progress, stage: 'runtime'}); service.cancelPreparation();
  assert.equal(service.getSnapshot().preparation.status, 'preparing'); assert.equal(events.some(([kind]) => kind === 'import'), false);
  finish(); await flush(); assert.equal(service.getSnapshot().preparation.status, 'ready'); service.dispose();
});

function preparationFixture({installed = true, worker = null, installError, noCatalog = false} = {}) {
  const events = [], progress = [], controller = new AbortController(); let onChange;
  let generation = installed ? {game: 'th06'} : null;
  const host = {games: {th06: {multiplayerRuntime: 'runtime/th06/mp.html'}}, shared: {runtimeManifest: 'runtime-manifest.json'}};
  const acquisition = {fetchImpl: async () => {throw new Error('fixture must not fetch');}, catalogUrl: 'https://launcher.invalid/releases.json',
    getMetadata: () => ({hostManifest: host, releaseCatalog: noCatalog ? null : {games: {th06: {}}}}),
    readCurrent: async game => {events.push(['read', game]); return {generation};},
    installPublished: async (game, options) => {events.push(['install', game, options]); if (installError) throw installError; generation = {game};},
    refreshInstalled: async game => {events.push(['publish', game]);},
  };
  const context = {product: 'th06mp', roomCode: '1234', epoch: 1, signal: controller.signal, isCurrent: () => !controller.signal.aborted};
  const service = owner.createRoomPreparation({acquisition, metadataReady: async () => {events.push(['metadata']);},
    baseUrl: 'https://launcher.invalid/', translate: key => key,
    activeWorker: async () => {events.push(['worker']); return worker;}, dependencies: {
      createTracker: options => {onChange = options.onChange; return {xhrFetch: async () => {throw new Error('fixture installer does not request bytes');}};},
      prepareRuntime: async (...args) => {events.push(['runtime', ...args]); return {url: '', generation: '', cached: true};},
    }});
  return {service, events, progress, controller, context, report: value => progress.push(value), emit: snapshot => onChange(snapshot)};
}

test('room preparation uses canonical package-only install and skips duplicate Runtime HTTP without active worker', async () => {
  const fixture = preparationFixture({installed: false}); await fixture.service.prepare(fixture.context, fixture.report);
  const install = fixture.events.find(([kind]) => kind === 'install');
  assert.deepEqual(install[2].addComponents, []); assert.equal(install[2].signal, fixture.context.signal);
  assert.equal(install[2].selectedComponentEntries, undefined, 'room preparation does not acquire optional language/music');
  assert.equal(fixture.events.filter(([kind]) => kind === 'read').length, 2, 'canonical install is re-read before ready');
  assert.equal(fixture.events.some(([kind]) => kind === 'runtime'), false);
  assert.equal(fixture.progress.at(-1).stage, 'runtime');
  assert.equal(fixture.progress.some(value => value.status === 'ready'), false, 'room owner alone publishes final readiness');
});

test('room preparation precaches only with real worker port and ignores aborted tracker callbacks', async () => {
  const worker = {postMessage() {}}; const fixture = preparationFixture({worker});
  await fixture.service.prepare(fixture.context, fixture.report);
  assert.equal(fixture.events.some(([kind]) => kind === 'install'), false);
  const runtime = fixture.events.find(([kind]) => kind === 'runtime');
  assert.equal(runtime[1], 'runtime/th06/mp.html'); assert.equal(runtime[2].worker, worker);
  assert.equal(runtime[2].baseUrl, 'https://launcher.invalid/');
  const count = fixture.progress.length; fixture.controller.abort();
  fixture.emit({active: [{loaded: 50, total: 100, title: 'late'}]});
  assert.equal(fixture.progress.length, count);
});

test('room preparation classifies install errors while preserving original cancellation identity', async () => {
  const failure = new Error('checksum failed'); const fixture = preparationFixture({installed: false, installError: failure});
  await assert.rejects(fixture.service.prepare(fixture.context, fixture.report), error => error.gameDataAcquisition === true && error.cause === failure);
  const cancelled = {name: 'AbortError', message: 'cancel'};
  const aborted = preparationFixture({installed: false, installError: cancelled});
  await assert.rejects(aborted.service.prepare(aborted.context, aborted.report), error => error === cancelled);
  const missing = preparationFixture({installed: false, noCatalog: true});
  await assert.rejects(missing.service.prepare(missing.context, missing.report), /package.releaseNotReadyNoLocal/);
  assert.equal(missing.events.some(([kind]) => kind === 'metadata'), true); assert.equal(missing.events.some(([kind]) => kind === 'install'), false);
});

test('room import failure cancels the existing import without opening a second modal or sending ready', async () => {
  const fixture = await joinedRoom(), {service, events, sockets} = fixture;
  service.setImporting(true); const sent = sockets[0].sent.filter(message => message.type === 'set-ready').length;
  service.cancelImport(); assert.equal(service.getSnapshot().preparation.status, 'cancelled');
  assert.equal(events.some(([kind]) => kind === 'import'), false); assert.equal(sockets[0].sent.filter(message => message.type === 'set-ready').length, sent);
  service.cancelImport(); assert.equal(service.getSnapshot().preparation.status, 'cancelled'); service.dispose();
});

test('room original count/difficulty actions retain their distinct phase policy from rule buttons', async () => {
  const fixture = await joinedRoom(), {service, sockets, identity} = fixture;
  sockets[0].message({type: 'state', room: roomState(identity.lobbyClientId('th06mp'), {phase: 'running'})});
  const before = sockets[0].sent.length;
  service.setRoomSettings({difficulty: 2}); assert.equal(service.getSnapshot().room.difficulty, 2);
  assert.equal(sockets[0].sent.length, before + 1);
  service.setRoomSettings({challengeMode: true}); assert.equal(sockets[0].sent.length, before + 1);
  service.dispose();
});

test('room failure awaits actual Player cleanup before clearing busy and shows check failure for4000ms', async () => {
  let finishFailure; const failure = new Promise(resolve => {finishFailure = resolve;}), notices = [];
  const fixture = await joinedRoom({checkGame: async () => {throw new Error('preflight failure');},
    operationFailed: async () => {await failure;}, notify: (message, duration) => notices.push({message, duration})});
  const check = fixture.service.checkGame(); await flush();
  assert.equal(fixture.service.getSnapshot().checkBusy, true); assert.equal(fixture.service.getSnapshot().launchBusy, true);
  assert.equal(notices.some(notice => notice.message === 'multiplayer.checkGameFailed'), false);
  finishFailure(); await check;
  assert.equal(fixture.service.getSnapshot().checkBusy, false); assert.equal(fixture.service.getSnapshot().launchBusy, false);
  assert.deepEqual(notices.at(-1), {message: 'multiplayer.checkGameFailed', duration: 4000}); fixture.service.dispose();
});

test('TH09 title-room reset clears membership without invoking ordinary departure route', async () => {
  const fixture = await joinedRoom(); const before = fixture.events.filter(([kind]) => kind === 'leave').length;
  fixture.service.resetRoomWithoutNavigation();
  assert.equal(fixture.service.getSnapshot().room, null);
  assert.equal(fixture.events.filter(([kind]) => kind === 'leave').length, before);
  assert.equal(fixture.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')), null); fixture.service.dispose();
});

test('original initial non-MP invite fallback selects default MP without changing supplied token', async () => {
  const fixture = roomFixture(), token = owner.encodeRoomInvite({g: 'th20', r: '4321', f: true, a: 'join'});
  const source = `https://launcher.invalid/?j=${token}&keep=a%20b#original`;
  assert.equal(fixture.service.restoreInvite(source, 'th07mp'), true);
  assert.equal(fixture.service.getSnapshot().product, 'th07mp');
  assert.equal(new URL(fixture.sockets[0].url).searchParams.get('room'), 'th07mp-4321');
  assert.deepEqual(fixture.events.find(([kind]) => kind === 'restore')[1], {product: 'th07mp', code: '4321', fromDirectory: true});
  assert.equal(owner.decodeRoomInvite(token).g, 'th20'); fixture.service.dispose();
});

const pinnedMainRevision = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
function pinnedRoomRetry({status, attempt, present = true}) {
  const source = execFileSync('git', ['show', `${pinnedMainRevision}:src/launcher/app.mts`], {cwd: project, encoding: 'utf8'});
  const start = source.indexOf('$("#mpRoomResourceRetry").addEventListener("click", () => {');
  assert.ok(start > 0); const end = source.indexOf('\n});', start); assert.ok(end > start);
  const events = [], room = {}, sandbox = {mpUiState: {room: present ? room : null},
    roomPreparation: {room, status}, gameDataAttempt: structuredClone(attempt),
    clearGameDataAttempt() {events.push('clear'); sandbox.gameDataAttempt = null;},
    prepareRoomResources(value) {assert.equal(value, room); events.push('prepare');},
    $: selector => {assert.equal(selector, '#mpRoomResourceRetry'); return {addEventListener(type, listener) {assert.equal(type, 'click'); sandbox.retry = listener;}};},
  };
  runInNewContext(source.slice(start, end + '\n});'.length), sandbox); sandbox.retry();
  return {events, attempt: sandbox.gameDataAttempt};
}

test('room Retry matches pinned handler eligibility, cleanup order and continuation filtering', async t => {
  for (const status of ['cancelled', 'failed', 'preparing', 'ready', 'importing']) {
    for (const attempt of [null, {manual: true, continuation: {kind: 'install-only'}},
      {manual: true, continuation: {kind: 'launch'}}, {manual: false, continuation: {kind: 'install-only'}}]) {
      await t.test(`${status} / ${JSON.stringify(attempt)}`, async () => {
        let report, currentAttempt = structuredClone(attempt), cleanupCalls = 0;
        const events = [], finish = [];
        const fixture = await joinedRoom({
          prepareResources: async (_context, progress) => {events.push('prepare'); report = progress; await new Promise(resolve => {finish.push(resolve);});},
          beforePreparationRetry() {cleanupCalls++; if (currentAttempt?.manual && currentAttempt.continuation?.kind === 'install-only') {events.push('clear'); currentAttempt = null;}},
        });
        report({status, stage: 'package', percent: null, error: ''}); events.length = 0;
        const expected = pinnedRoomRetry({status, attempt});
        fixture.service.retryPreparation(); await flush();
        assert.deepEqual(events, expected.events);
        assert.deepEqual(currentAttempt, expected.attempt);
        assert.equal(cleanupCalls, expected.events.includes('prepare') ? 1 : 0, 'ineligible Retry never reaches the cleanup port');
        fixture.service.dispose(); for (const resolve of finish) resolve(); await flush();
      });
    }
  }
  await t.test('absent room', async () => {
    let cleanupCalls = 0; const fixture = await joinedRoom({beforePreparationRetry() {cleanupCalls++;}});
    fixture.service.leave(); const expected = pinnedRoomRetry({status: 'cancelled', attempt: {manual: true, continuation: {kind: 'install-only'}}, present: false});
    fixture.service.retryPreparation(); assert.equal(cleanupCalls, 0); assert.deepEqual(expected.events, []); fixture.service.dispose();
  });
});
