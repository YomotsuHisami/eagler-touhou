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
    export {createMultiplayerIdentityStore,multiplayerDisplayNameStorageKey,multiplayerLobbyClientStorageKey} from './src/launcher/multiplayer-identity.mts';
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
const manifest = () => ({schema: 'eagler-touhou/site-manifest/1', protocol: 'eagler-touhou/1', profile: 'synthetic-test',
  shared: {resourceMode: 'hosted', vanillaFont: '../shared/msgothic.ttc', unicodeFont: '../shared/unifont.otf', netplayRelay: 'wss://relay.invalid/socket'},
  games: {th06: {runtime: 'runtime/th06/game.html', gameData: {version: `sha256-${hash}`, layout: `sha256-${hash}`, path: 'th06.data', bytes: 1, sha256: hash}, music: {midi: {files: []}}}}});
function directory(extra = {}) {
  const storage = stores(), clock = new Clock(), sockets = [], navigation = [], normalized = [];
  const service = owner.createLobbyDirectory({loadSiteManifest: async () => manifest(), createSocket: url => {const socket = new Socket(url); sockets.push(socket); return socket;},
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
  const blocked = directory({loadSiteManifest: () => new Promise(() => {})});
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
test('rollback products default to D0 for both room creation and restored invites',async()=>{
  for(const product of ['th06mp','th07mp','th08mp','th09mp','th10mp','th11mp']){
    const f=roomFixture();f.service.enterRoom(product,'1234',true);await flush();
    const rollback=product!=='th11mp';assert.equal(f.service.getSnapshot().rollbackEnabled,rollback,product);
    const socket=f.sockets[0],id=f.identity.lobbyClientId(product);socket.open();
    socket.message({type:'state',room:roomState(id,{predictionLimit:rollback?8:0,seats:[{clientId:id,name:'A',loadout:0,ready:true},{clientId:'guest12345',name:'B',loadout:1,ready:true}]})});
    f.service.setTimingChoice(7);f.service.start();const started=socket.sent.findLast(m=>m.type==='start');
    assert.ok(started,product);if(['th08mp','th09mp','th10mp'].includes(product)){assert.equal(started.adonisMode,0);assert.equal(started.inputDelay,0);assert.equal(started.inputDelayAuto,false);
      f.service.setRollbackEnabled(false);f.service.start();const delay=socket.sent.findLast(m=>m.type==='start');assert.equal(delay.adonisMode,1);assert.equal(delay.inputDelay,7);
    }
    if(product==='th11mp'){assert.equal(started.adonisMode,1);assert.equal(started.inputDelay,7);f.service.setRollbackEnabled(true);assert.equal(f.service.getSnapshot().rollbackEnabled,false);}
    f.service.dispose();
    const restored=roomFixture();assert.equal(restored.service.restoreInvite('https://launcher.invalid/?j='+fOwnerInvite(product),product),true);assert.equal(restored.service.getSnapshot().rollbackEnabled,rollback,product+' restore');restored.service.dispose();
  }
});
function fOwnerInvite(product){return owner.encodeRoomInvite({g:product,r:'1234',f:true,a:'create'});}

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
    getMetadata: () => ({siteManifest: host, releaseCatalog: noCatalog ? null : {games: {th06: {}}}}),
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

test('TH11 owner cannot enable rollback and preserves zero prediction through 2P/3P and Extra start',async()=>{
 for(const playerCount of [2,3]){
  const f=roomFixture(); f.service.enterRoom('th11mp','1234',true); await flush();
  const socket=f.sockets[0]; socket.open(); const id=f.identity.lobbyClientId('th11mp');
  const seats=Array.from({length:playerCount},(_,i)=>({clientId:i?`peer-seat${i}`:id,name:'A',loadout:i?4:0,ready:true}));
  socket.message({type:'state',room:roomState(id,{playerCount,difficulty:4,seats,predictionLimit:0,adonisMode:1})});
  f.service.setRollbackEnabled(true); assert.equal(f.service.getSnapshot().rollbackEnabled,false);
  f.service.start(); const start=socket.sent.findLast(m=>m.type==='start');
  assert.equal(start.adonisMode,1); assert.equal(start.predictionLimit,0); assert.equal(start.inputDelayAuto,true);
  socket.message({type:'state',room:roomState(id,{playerCount,difficulty:4,seats,phase:'running',predictionLimit:0,adonisMode:1,inputDelay:3})});
  const options=f.service.runtimeOptions(); assert.equal(options.netplayPredictionLimit,0);
  assert.equal(options.netplayAdonisMode,1); assert.equal(options.netplayDifficulty,4);
  assert.equal(options.netplayPlayerCount,playerCount); assert.equal(options.netplayLoadouts[1].shot,1);
  // A stale/modified relay cannot make the React room accept a hybrid run.
  socket.message({type:'state',room:roomState(id,{playerCount,difficulty:0,seats,phase:'running',predictionLimit:8,adonisMode:2})});
  assert.equal(f.service.getSnapshot().room.difficulty,4);
  assert.equal(f.service.runtimeOptions().netplayPredictionLimit,0); f.service.dispose();
 }
});

test('rapid loadout changes ignore stale snapshots and cannot ready/start until latest socket echo',async()=>{
 const f=await joinedRoom();const id=f.identity.lobbyClientId('th06mp'),socket=f.sockets[0];
 for(let i=0;i<4;i++) f.service.changeLoadout(1);
 assert.equal(f.service.getSnapshot().preferredLoadout,0); // TH06 wraps its four choices.
 f.service.changeLoadout(1);
 assert.equal(f.service.getSnapshot().preferredLoadout,1);
 socket.message({type:'state',room:roomState(id,{seats:[{clientId:id,name:'A',loadout:0,ready:true},{clientId:'peer_1234',name:'B',loadout:1,ready:true}]})});
 assert.equal(f.service.getSnapshot().preferredLoadout,1);assert.equal(f.service.getSnapshot().loadoutPending,true);
 assert.equal(f.service.getSnapshot().ready,false);const before=socket.sent.length;
 await f.service.toggleReady();f.service.start();assert.equal(socket.sent.length,before);
 assert.throws(()=>f.service.runtimeOptions(),/roomStateInvalid/);
 socket.message({type:'state',room:roomState(id,{seats:[{clientId:id,name:'A',loadout:1,ready:false},{clientId:'peer_1234',name:'B',loadout:1,ready:true}]})});
 assert.equal(f.service.getSnapshot().loadoutPending,false);await f.service.toggleReady();
 assert.equal(socket.sent.at(-1).type,'set-ready');assert.equal(socket.sent.at(-1).ready,true);f.service.dispose();
});

test('room product ACK keeps socket/seat identity, aborts old preparation and reconnects under the new product', async () => {
  const preparations=[];
  const f=roomFixture({prepareResources: (context,report)=>new Promise(resolve=>preparations.push({context,report,resolve}))});
  f.ports.routes.switchProduct=value=>f.events.push(['switch-product',value]);
  try {
    f.service.enterRoom('th06mp','1234',true);await flush();const socket=f.sockets[0];socket.open();
    const id=f.identity.lobbyClientId('th06mp');
    f.session.setItem(owner.multiplayerLobbyClientStorageKey('th08mp'),'different_client_id');
    assert.equal(f.identity.lobbyClientId('th08mp'),'different_client_id');
    const snapshot=(product,version,locked,patch={})=>socket.message({type:'state',roomDirectory:{version:1,roomProducts:1},
      room:roomState(id,{product,productVersion:version,directoryLocked:locked,productSwitchAvailable:true,...patch})});
    snapshot('th06mp',1,true);const before=f.service.getSnapshot().epoch;
    assert.equal(f.service.switchProduct('th08mp'),false,'locked service gate');
    assert.equal(f.service.setDirectoryLocked(false),true);assert.equal(f.service.getSnapshot().room.directoryLocked,true,'wait for server ACK');
    assert.equal(f.service.getSnapshot().productPending,true);assert.equal(f.service.setDirectoryLocked(false),false);
    snapshot('th06mp',2,false);assert.equal(f.service.getSnapshot().canSwitchProduct,true);
    assert.equal(f.service.switchProduct('th08mp'),true);assert.equal(f.service.switchProduct('th07mp'),false);
    assert.equal(f.service.getSnapshot().canStart,false);
    snapshot('th08mp',3,false);await flush();
    const current=f.service.getSnapshot();
    assert.equal(current.product,'th08mp');assert.equal(current.room.code,'1234');assert.equal(current.epoch,before+1);
    assert.equal(current.localClientId,id);assert.equal(current.seat,0);assert.equal(current.ready,false);assert.equal(current.productPending,false);
    assert.equal(f.sockets.length,1);assert.equal(f.identity.lobbyClientId('th08mp'),id);
    assert.equal(f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')),null);
    assert.equal(f.events.filter(([type])=>type==='switch-product').length,1);
    assert.equal(preparations.length,2);assert.equal(preparations[0].context.signal.aborted,true);
    preparations[1].report({status:'ready',stage:'runtime',percent:100,error:''});
    preparations[0].report({status:'failed',stage:'package',percent:null,error:'stale failure'});preparations[0].resolve();await flush();
    assert.equal(f.service.getSnapshot().preparation.status,'ready','old work cannot overwrite the new resource state');
    snapshot('th08mp',3,false,{seats:[{clientId:id,loadout:5,ready:false},null]});assert.equal(f.service.getSnapshot().preferredLoadout,5,'socket listener survives epoch change');
    socket.close(1006);f.clock.tick(650);const resumed=f.sockets.at(-1),url=new URL(resumed.url);
    assert.equal(f.sockets.length,2);assert.equal(url.searchParams.get('room'),'th08mp-1234');assert.equal(url.searchParams.get('lobby'),id);
    preparations[1].resolve();await flush();
  } finally {f.service.dispose();}
});

test('room product controls negotiate capability and recover from refusal, timeout and local busy state', async () => {
  const f=await joinedRoom();
  try {
    assert.equal(f.service.setDirectoryLocked(false),false);assert.equal(f.service.getSnapshot().productSwitchSupported,false);
    assert.equal(f.sockets[0].sent.some(m=>m.type==='product-busy'),false,'legacy relay receives no new control messages');
    const socket=f.sockets[0],id=f.identity.lobbyClientId('th06mp');
    socket.message({type:'state',roomDirectory:{version:1,roomProducts:1},room:roomState(id,{product:'th06mp',productVersion:1,directoryLocked:false,productSwitchAvailable:true})});
    f.service.setRoomProductBusy(true);assert.equal(f.service.getSnapshot().canSwitchProduct,false);assert.equal(socket.sent.at(-1).busy,true);
    f.service.setRoomProductBusy(false);assert.equal(f.service.getSnapshot().canSwitchProduct,true);
    assert.equal(f.service.switchProduct('th07mp'),true);
    socket.message({type:'error',code:'room-product',error:'refused by relay'});assert.equal(f.service.getSnapshot().productPending,false);assert.equal(f.service.getSnapshot().product,'th06mp');
    assert.equal(f.service.switchProduct('th07mp'),true);f.clock.tick(8000);
    assert.equal(f.service.getSnapshot().productPending,false);assert.ok(f.events.some(e=>e[1]==='room.switchTimeout'));
    socket.message({type:'state',room:{...roomState(id),product:'th06mp',productVersion:2,directoryLocked:true,productSwitchAvailable:true}});
    assert.equal(f.service.getSnapshot().canSwitchProduct,false);
    socket.message({type:'state',room:{...roomState(id),product:'th08mp',productVersion:1,directoryLocked:false,productSwitchAvailable:true}});
    assert.equal(f.service.getSnapshot().product,'th06mp','stale product revision is ignored');
  } finally {f.service.dispose();}
});

test('switchable room restores a saved seat after synchronization even from an old product invite', async () => {
  const f=roomFixture();
  try {
    const id=f.identity.lobbyClientId('th06mp');f.identity.adoptLobbyClientId('th08mp',id);
    f.sessions.save('th08mp',{room:{code:'1234',playerCount:2,difficulty:1,created:false,roomProducts:true},seat:1,ready:false,spectatorRequested:false,roomSettingsOpen:false});
    assert.equal(f.service.restoreInvite('https://launcher.invalid/?j='+owner.encodeRoomInvite({g:'th06mp',r:'1234',f:true})),true);
    await flush();const socket=f.sockets[0];socket.open();
    socket.message({type:'state',roomDirectory:{version:1,roomProducts:1},room:roomState('another_host_client',{product:'th08mp',productVersion:4,directoryLocked:true,productSwitchAvailable:true})});
    await flush();
    const claim=socket.sent.filter(m=>m.type==='take-seat'&&m.productVersion===4).at(-1);
    assert.equal(claim.seat,1);assert.equal(claim.loadout,0);assert.equal(f.service.getSnapshot().product,'th08mp');
    socket.message({type:'state',room:{...roomState('another_host_client'),product:'th08mp',productVersion:4,directoryLocked:true,productSwitchAvailable:true,
      seats:[{clientId:'another_host_client',loadout:0,ready:false},{clientId:id,loadout:0,ready:false}]}});
    assert.equal(f.service.getSnapshot().seat,1);assert.equal(f.service.getSnapshot().localClientId,id);
    const options=f.service.runtimeOptions();assert.equal(new URL(options.netplayUrl).searchParams.get('room'),'th08mp-1234');
  } finally {f.service.dispose();}
});


test('room card protocol blocks early Ready, preserves P2 owner permissions and keeps reload membership',async()=>{
  let complete,report;
  const f=await joinedRoom({prepareResources:(_context,progress)=>{report=progress;return new Promise(resolve=>complete=resolve);}});
  const socket=f.sockets[0], id=f.identity.lobbyClientId('th06mp');
  const sync=(patch={})=>socket.message({type:'state',roomDirectory:{version:1,roomCards:1},room:roomState(id,{hostClientId:id,seats:[null,{clientId:id,name:'A',loadout:0,ready:false}],...patch})});
  try {
    sync(); await f.service.toggleReady();
    assert.equal(socket.sent.some(m=>m.type==='set-ready'),false,'cannot prepare before real loading completes');
    f.service.setRoomSettings({playerCount:3});assert.equal(socket.sent.at(-1).playerCount,3);
    sync({playerCount:3,settingsVersion:7});f.service.removeEmptySeat(0);
    assert.deepEqual(socket.sent.at(-1),{type:'remove-seat',seat:0,settingsVersion:7});
    const count=socket.sent.length;f.service.removeEmptySeat(1);assert.equal(socket.sent.length,count,'cannot remove self');
    complete();await flush();await f.service.toggleReady();assert.equal(socket.sent.at(-1).type,'set-ready');assert.equal(socket.sent.at(-1).ready,true);
    sync({seats:[{clientId:'guest12345',loadout:0,ready:true},{clientId:id,loadout:0,ready:true}]});
    assert.equal(f.service.getSnapshot().canStart,true);f.service.start();assert.equal(socket.sent.at(-1).type,'start');
    sync({hostClientId:'guest12345',seats:[{clientId:id,loadout:0},{clientId:'guest12345',loadout:0}]});
    const before=socket.sent.length;f.service.setRoomSettings({playerCount:3});f.service.removeEmptySeat(2);assert.equal(socket.sent.length,before,'P1 is not automatically host');
    f.service.pageHide();assert.equal(socket.closes.at(-1).reason,'page suspended');
  } finally {f.service.dispose();}
});

function retentionSnapshot(f, overrides = {}) {
  const id = f.identity.lobbyClientId('th06mp');
  return {type:'state',roomDirectory:{version:1,roomRetention:1},room:roomState(id,{hostClientId:id,retainedHostId:null,...overrides})};
}
test('host returns to lobby only after acknowledgement and resumes the same room/seat/session', async () => {
  const f=await joinedRoom(), {service,sockets,events}=f, socket=sockets[0];
  const id=f.identity.lobbyClientId('th06mp');
  socket.message(retentionSnapshot(f,{seats:[null,{clientId:id,name:'A',loadout:2,ready:false}]}));
  const saved=f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp'));
  service.returnToLobby(); service.returnToLobby();
  assert.equal(socket.sent.filter(m=>m.type==='park-room').length,1);
  assert.equal(service.getSnapshot().retentionPending,true);
  assert.equal(events.filter(([kind])=>kind==='leave').length,0);
  socket.message(retentionSnapshot(f,{retainedHostId:id,seats:[null,{clientId:id,name:'A',loadout:2,ready:false}]}));
  assert.equal(service.getSnapshot().parked,true); assert.equal(service.getSnapshot().seat,1);
  assert.equal(service.getSnapshot().retentionPending,false); assert.equal(socket.readyState,1);
  assert.deepEqual(events.findLast(([kind])=>kind==='leave'),['leave',{product:'th06mp',fromDirectory:true}]);
  assert.equal(f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')),saved);
  service.resumeRoom(); assert.equal(service.getSnapshot().parked,false);
  assert.equal(socket.sent.findLast(m=>m.type==='resume-room').type,'resume-room');
  socket.message(retentionSnapshot(f)); assert.equal(service.getSnapshot().room.code,'1234');
  service.dispose();
});
test('retained-room navigation reclaims the private browser identity without clearing its session', async () => {
  const f=await liveDirectory(),id='retained_client_42';
  f.sockets[0].message(directoryState({mine:{product:'th06mp',code:'4321',clientId:id,retained:true,recoveryToken:'token'}}));
  f.sessions.save('th06mp',{code:'4321',seat:1,loadout:2,spectator:false});
  const saved=f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp'));
  assert.equal(f.service.returnToRoom(),true);
  assert.equal(f.identity.lobbyClientId('th06mp'),id);
  assert.equal(f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')),saved);
  assert.equal(f.navigation.length,1); assert.equal(f.service.returnToRoom(),false); f.service.dispose();
});
test('dissolve requires confirmation, cannot be duplicated, and terminal close releases the room', async () => {
  const f=await joinedRoom(),socket=f.sockets[0];socket.message(retentionSnapshot(f));
  let request=f.service.dissolveRoom(); assert.equal(f.decisions.getSnapshot().tone,'danger');
  assert.equal(socket.sent.some(m=>m.type==='dissolve-room'),false);
  f.decisions.resolve('cancel');await request;assert.equal(socket.sent.some(m=>m.type==='dissolve-room'),false);
  request=f.service.dissolveRoom();await f.service.dissolveRoom();
  f.decisions.resolve('confirm');await request;
  assert.equal(socket.sent.filter(m=>m.type==='dissolve-room').length,1);
  socket.emit('close',{code:4011});
  assert.equal(f.service.getSnapshot().room,null);
  assert.equal(f.session.getItem(owner.multiplayerRoomSessionStorageKey('th06mp')),null);
  assert.equal(f.events.findLast(([kind])=>kind==='leave')[1].message,'room.dissolved');f.service.dispose();
});
test('a stale dissolve confirmation cannot close the next room',async()=>{
  const f=await joinedRoom();f.sockets[0].message(retentionSnapshot(f));const request=f.service.dissolveRoom();
  f.service.leave();f.service.enterRoom('th06mp','5678',true);await flush();
  f.decisions.resolve('confirm');await request;
  assert.equal(f.sockets.flatMap(s=>s.sent).some(m=>m.type==='dissolve-room'),false);f.service.dispose();
});
test('guest return leaves; retained host expiry only notifies without redirecting another view',async()=>{
  const f=await joinedRoom();f.sockets[0].message(retentionSnapshot(f,{hostClientId:'other_host'}));
  f.service.returnToLobby();assert.equal(f.service.getSnapshot().room,null);assert.equal(f.sockets[0].sent.some(m=>m.type==='park-room'),false);f.service.dispose();
  const host=await joinedRoom(),socket=host.sockets[0],id=host.identity.lobbyClientId('th06mp');socket.message(retentionSnapshot(host));
  host.service.returnToLobby();socket.message(retentionSnapshot(host,{retainedHostId:id}));
  const leaves=host.events.filter(([kind])=>kind==='leave').length;socket.emit('close',{code:4004});
  assert.equal(host.service.getSnapshot().room,null);assert.equal(host.events.filter(([kind])=>kind==='leave').length,leaves);
  assert.deepEqual(host.events.at(-1),['notify','lobby.expired']);host.service.dispose();
});

function switchDirectoryState(mine, overrides={}) {
  return directoryState({mine,roomSwitch:1,rooms:[{product:'th06mp',code:'9876',capacity:2,phase:'lobby',difficulty:1,joinable:true,seats:[{initial:'B',online:true,ready:false},null]}],...overrides});
}
test('directory room switch confirms first, cancel keeps membership, and only matching relay ACK navigates',async()=>{
  const decisions=owner.createDecisionStore(),released=[];
  const f=await liveDirectory({decisions,onMembershipReplaced:mine=>released.push(mine)}),socket=f.sockets[0];
  const mine={product:'th06mp',code:'1234',host:true,retained:true,recoveryToken:'current-token'};
  socket.message(switchDirectoryState(mine));
  let joining=f.service.joinRoom('th06mp','9876');assert.equal(decisions.getSnapshot().message,'workspace.switchRoomConfirm');
  assert.equal(socket.sent.some(m=>m.type==='switch-room'),false);assert.equal(f.service.getSnapshot().switching,true);
  decisions.resolve('cancel');await joining;assert.equal(f.navigation.length,0);assert.equal(f.service.getSnapshot().mine.code,'1234');
  joining=f.service.joinRoom('th06mp','9876');decisions.resolve('confirm');await joining;
  const command=socket.sent.at(-1);assert.equal(command.type,'switch-room');assert.equal(command.dissolve,true);assert.equal(f.navigation.length,0);
  socket.message({type:'room-switch-result',requestId:command.requestId+1,product:'th06mp',code:'9876',ok:true});assert.equal(f.navigation.length,0);
  socket.message({type:'room-switch-result',requestId:command.requestId,product:'th06mp',code:'9876',ok:true});
  assert.equal(f.navigation.length,1);assert.equal(released.length,1);assert.equal(owner.decodeRoomInvite(new URL(f.navigation[0]).searchParams.get('j')).r,'9876');
  f.service.dispose();decisions.dispose();
});
test('directory switch preserves source when target fills, membership changes, or relay rejects; guests only leave',async()=>{
  const decisions=owner.createDecisionStore(),f=await liveDirectory({decisions}),socket=f.sockets[0];
  const mine={product:'th06mp',code:'1234',host:true,recoveryToken:'token'};
  socket.message(switchDirectoryState(mine));let joining=f.service.joinRoom('th06mp','9876');
  socket.message(switchDirectoryState(mine,{rooms:[]}));decisions.resolve('confirm');await joining;
  assert.equal(f.service.getSnapshot().notice,'workspace.roomSwitchUnavailable');assert.equal(socket.sent.some(m=>m.type==='switch-room'),false);
  socket.message(switchDirectoryState(mine));joining=f.service.joinRoom('th06mp','9876');
  socket.message(switchDirectoryState({...mine,recoveryToken:'new-token'}));decisions.resolve('confirm');await joining;
  assert.equal(f.service.getSnapshot().notice,'workspace.roomSwitchChanged');assert.equal(socket.sent.some(m=>m.type==='switch-room'),false);
  socket.message(switchDirectoryState({...mine,host:false}));joining=f.service.joinRoom('th06mp','9876');
  assert.equal(decisions.getSnapshot().message,'workspace.leaveRoomConfirm');decisions.resolve('confirm');await joining;
  const command=socket.sent.at(-1);assert.equal(command.dissolve,false);
  socket.message({type:'room-switch-result',requestId:command.requestId,ok:false,reason:'target-unavailable'});
  assert.equal(f.navigation.length,0);assert.equal(f.service.getSnapshot().mine.code,'1234');assert.equal(f.service.getSnapshot().switching,false);
  f.service.dispose();decisions.dispose();
});
test('directory code-join also confirms room replacement and teardown cancels stale confirmation',async()=>{
  const decisions=owner.createDecisionStore(),f=await liveDirectory({decisions}),socket=f.sockets[0];
  socket.message(switchDirectoryState({product:'th06mp',code:'1234',host:true,recoveryToken:'token'}));
  assert.equal(f.service.prepareForm('join'),true);f.service.updateForm({code:'9999'});
  assert.equal(f.service.submitForm(),'close');f.service.formDidClose();assert.ok(decisions.getSnapshot());
  f.service.pageHide();decisions.resolve('confirm');await flush();
  assert.equal(socket.sent.some(m=>m.type==='switch-room'),false);assert.equal(f.navigation.length,0);f.service.dispose();decisions.dispose();
});


test('room code lookup resolves an off-filter game and ignores unmatched/duplicate results',async()=>{
  const f=await liveDirectory({loadSiteManifest:async()=>{const m=manifest();m.games.th07={...m.games.th06,runtime:'runtime/th07/game.html',gameData:{...m.games.th06.gameData,path:'th07.data'}};return m;}}),socket=f.sockets[0];
  socket.message(directoryState({roomLookup:1}));f.service.joinByCode(' 8765 ');f.service.joinByCode('9999');
  const command=socket.sent.at(-1);assert.equal(command.type,'resolve-room');assert.equal(command.code,'8765');assert.equal(Object.hasOwn(command,'product'),false);
  assert.equal(f.service.createRoom(),false);assert.equal(f.service.prepareForm('create'),false);
  socket.message({type:'room-lookup-result',requestId:command.requestId+1,code:'8765',ok:true,product:'th07mp'});assert.equal(f.navigation.length,0);
  socket.message({type:'room-lookup-result',requestId:command.requestId,code:'8765',ok:true,product:'th07mp'});
  assert.equal(f.navigation.length,1);const invite=owner.decodeRoomInvite(new URL(f.navigation[0]).searchParams.get('j'));assert.equal(invite.g,'th07mp');assert.equal(invite.r,'8765');assert.equal(invite.a,'join');assert.equal(invite.f,true);
  socket.message({type:'room-lookup-result',requestId:command.requestId,code:'8765',ok:true,product:'th07mp'});assert.equal(f.navigation.length,1);f.service.dispose();
});
test('invalid/missing/full room code, lookup timeout, cancellation and disconnect keep current membership',async()=>{
  const f=await liveDirectory(),socket=f.sockets[0],mine={product:'th06mp',code:'1234',host:true,recoveryToken:'exact'};
  socket.message(directoryState({roomLookup:1,mine}));const before=socket.sent.length;
  f.service.joinByCode('bad');assert.equal(socket.sent.length,before);assert.equal(f.service.getSnapshot().codeError,'lobby.invalidCode');
  for(const reason of ['not-found','unavailable','ambiguous']) {
    f.service.joinByCode('8765');const m=socket.sent.at(-1);socket.message({type:'room-lookup-result',requestId:m.requestId,code:m.code,ok:false,reason});
    assert.ok(f.service.getSnapshot().codeError);assert.equal(f.service.getSnapshot().mine.code,'1234');
  }
  f.service.joinByCode('8765');const stale=socket.sent.at(-1);f.service.cancelCodeJoin();
  socket.message({type:'room-lookup-result',requestId:stale.requestId,code:'8765',ok:true,product:'th06mp'});assert.equal(f.navigation.length,0);
  f.service.joinByCode('8765');f.clock.tick(8000);assert.equal(f.service.getSnapshot().resolvingCode,false);assert.equal(f.service.getSnapshot().codeError,'workspace.roomCodeFailed');
  f.service.joinByCode('8765');socket.close();assert.equal(f.service.getSnapshot().resolvingCode,false);assert.equal(f.navigation.length,0);
  assert.equal(socket.sent.some(m=>m.type==='switch-room'),false);f.service.dispose();
});
test('resolved code requires existing host confirmation before switching and source release acknowledgement',async()=>{
  const decisions=owner.createDecisionStore(),f=await liveDirectory({decisions}),socket=f.sockets[0];
  socket.message(directoryState({roomLookup:1,roomSwitch:1,mine:{product:'th06mp',code:'1234',host:true,recoveryToken:'exact'}}));
  f.service.joinByCode('8765');let m=socket.sent.at(-1);socket.message({type:'room-lookup-result',requestId:m.requestId,code:'8765',ok:true,product:'th06mp'});
  assert.equal(decisions.getSnapshot().message,'workspace.switchRoomConfirm');decisions.resolve('cancel');await flush();assert.equal(f.navigation.length,0);
  f.service.joinByCode('8765');m=socket.sent.at(-1);socket.message({type:'room-lookup-result',requestId:m.requestId,code:'8765',ok:true,product:'th06mp'});
  decisions.resolve('confirm');await flush();m=socket.sent.at(-1);assert.equal(m.type,'switch-room');assert.equal(f.navigation.length,0);
  socket.message({type:'room-switch-result',requestId:m.requestId,code:'8765',product:'th06mp',ok:true});assert.equal(f.navigation.length,1);
  f.service.dispose();decisions.dispose();
});

test('settings activity is independent of resource progress, cancels Ready and resends after reconnect',async()=>{
 const f=await joinedRoom(),socket=f.sockets[0],id=f.identity.lobbyClientId('th06mp');
 const sync=(target=socket,ready=true)=>target.message({type:'state',roomDirectory:{version:1,roomProducts:1,roomCards:1,editingState:1},room:roomState(id,{product:'th06mp',productVersion:1,seats:[{clientId:id,loadout:0,selectionConfirmed:true,ready,resource:{status:'ready',stage:'runtime',percent:100}},null]})});
 try{
   sync();socket.sent.length=0;const progress=f.service.getSnapshot().preparation;
   f.service.setEditingSettings(true);assert.equal(f.service.getSnapshot().editingSettings,true);assert.equal(f.service.getSnapshot().ready,false);assert.deepEqual(f.service.getSnapshot().preparation,progress);
   assert.deepEqual(socket.sent.filter(m=>m.type==='set-ready').map(m=>m.ready),[false]);assert.deepEqual(socket.sent.filter(m=>m.type==='editing-settings').map(m=>m.editing),[true]);
   const count=socket.sent.length;f.service.setEditingSettings(true);await f.service.toggleReady();assert.equal(socket.sent.length,count,'same status is deduplicated and Ready is blocked while editing');
   f.service.setEditingSettings(false);assert.equal(f.service.getSnapshot().ready,false);assert.equal(socket.sent.at(-1).editing,false);
   f.service.setEditingSettings(true);socket.close(1006);f.service.reconnect();const resumed=f.sockets.at(-1);resumed.open();sync(resumed,false);assert.equal(resumed.sent.findLast(m=>m.type==='editing-settings').editing,true,'the current view is reannounced on the new socket');
   f.service.resetRoomWithoutNavigation();assert.equal(f.service.getSnapshot().editingSettings,false);
 }finally{f.service.dispose();}
});
