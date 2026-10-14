import {pinnedUiAuthorityText, synchronizedMainAuthority} from './source-text.mjs';
/** Pinned-main room view regression: SYNTHETIC DOM, relay, preparation, metrics,
 * clocks and animation promises. No native browser/network/runtime/layout claim.
 * Expected rendering executes main's original functions after TypeScript erasure.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url)), require = createRequire(resolve(project, 'package.json'));
const {build, transform} = require('esbuild'), pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => synchronizedMainAuthority(path, project, pinnedMain);
let env, React, createRoot, MemoryRouter, owners, work, originalHTML, originalRender;
const mounts = new Set(), fixtures = new Set();
const n = (selector, scope = env.document) => {const node = scope.querySelector(selector); assert.ok(node, `Missing ${selector}`); return node;};
const all = (selector, scope = env.document) => [...scope.querySelectorAll(selector)];
const t = (locale, key, params) => owners.translate(locale, key, params);
const act = fn => React.act(async () => {await fn?.(); for (let i = 0; i < 12; i++) await Promise.resolve();});
const defaultContext = {launched: false, th09NetworkOverlayOpen: false, launchStage: null, touchEnabled: false, touchMovementMode: 'joystick'};
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client')); ({MemoryRouter} = await import('react-router'));
  for (const file of ['src/launcher/i18n.mts', 'src/contracts/product-catalog.mts']) {
    let expected=pinned(file);
    if(file==='src/launcher/i18n.mts')expected=expected
      .replace(/^  \["room.enableRollback".*$/m,'  ["room.enableRollback", "启用回滚(降低输入延迟，需要更高的性能)", "Enable rollback (lower input delay, requires higher performance)"],')
      .replace(/^  \["room.rollbackHint".*$/m,'  ["room.rollbackHint", "开启后输入延迟固定为 0 帧；关闭后使用所选输入延迟。开局后设置固定。", "When enabled, input delay is fixed at 0 frames. When disabled, use the selected input delay. Settings are fixed once the game starts."],');
    const actual = pinnedUiAuthorityText(readFileSync(resolve(project,file),'utf8'));
    if(file==='src/launcher/i18n.mts') {
      // Preserve committed room copy authority; new redesign namespaces do not
      // require byte equality with the entire historical launcher dictionary.
      const rows = text => new Map([...text.matchAll(/\["([^"]+)",\s*"(?:\\.|[^"\\])*",\s*"(?:\\.|[^"\\])*"\]/g)].map(match => [match[1],match[0]]));
      const current = rows(actual);
      for(const [key,value] of rows(expected)) if(key.startsWith('room.') || key.startsWith('multiplayer.') || key.startsWith('lobby.')) assert.equal(current.get(key),value,`Pinned room copy changed: ${key}`);
    } else assert.equal(actual,expected,`Pinned authority changed: ${file}`);
  }
  originalHTML = pinned('public/index.html'); const mainSource = execFileSync('git', ['show', '8bdf6dbf4a81032f0725cc841b86d03e1465fe07:src/launcher/app.mts'], {cwd: project, encoding: 'utf8'});
  // Retain origin/main's separately accepted editable-name block with main's
  // updated room timing renderer. Both inputs are committed legacy authorities.
  const nameBlock = text => text.slice(text.indexOf('  const nameInput = $("#mpDisplayName");', text.indexOf('function renderMpRoom()')), text.indexOf('  const spectator = $("#mpUnseatedNote");', text.indexOf('function renderMpRoom()')));
  const source = mainSource.replace(nameBlock(mainSource), nameBlock(pinned('src/launcher/app.mts')));
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const original = section('function renderRoomPreparationProgress()', 'function packageNetworkMeta(') + '\n' +
    section('function renderRoomNetwork()', '// FLIP: read the visible geometry once');
  const {code} = await transform(original, {loader: 'ts', target: 'es2022'});
  originalRender = new Function('scope', `with (scope) { ${code}; renderMpRoom(); }`);
  work = await mkdtemp(resolve(project, '.cache/room-views-'));
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export * from './app/components/room/index.ts';
    export * from './app/components/room/RoomPanel.tsx';
    export * from './app/components/room/presentation.ts';
    export * from './app/components/room/room-loadouts.ts';
    export * from './app/components/launcher/use-room-card-departure.ts';
    export * from './app/components/launcher/OptionsPanel.tsx';
    export * from './app/components/launcher/products.ts';
    export * from './app/components/launcher/GameDirectory.tsx';
    export * from './app/components/settings/SettingsBody.tsx';
    export * from './app/models/game-settings.ts';
    export * from './app/services/multiplayer-room.ts';
    export * from './app/models/decisions.ts';
    export * from './app/i18n.tsx';
    export * from './src/contracts/product-catalog.mts';
    export * from './src/launcher/multiplayer-identity.mts';
    export * from './src/launcher/multiplayer-room-session.mts';
    export * from './src/launcher/multiplayer-preferences.mts';
    export * from './src/launcher/game-preferences.mts';
  `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: resolve(work, 'actual.mjs'), logLevel: 'silent',
  plugins: [{name: 'installed-deps-authored-mts', setup(ctx) {
    ctx.onResolve({filter: /^[^./]/}, args => ({path: pathToFileURL(require.resolve(args.path)).href, external: true}));
    ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts'); if (existsSync(path)) return {path};});
  }}]}); owners = await import(pathToFileURL(resolve(work, 'actual.mjs')));
});
afterEach(async () => {
  for (const m of mounts) await act(() => m.root.unmount()); mounts.clear();
  for (const f of fixtures) {f.service.dispose(); f.decisions.dispose();} fixtures.clear();
  env.document.body.replaceChildren(); env.document.body.className = '';
  env.window.matchMedia = query => ({matches: query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {}}); globalThis.matchMedia = env.window.matchMedia;
  delete env.window.HTMLElement.prototype.animate;
  assert.deepEqual(env.errors.splice(0), [], 'No unexpected React or DOM errors');
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
class Storage {values = new Map(); getItem(key) {return this.values.get(key) ?? null;} setItem(key, value) {this.values.set(key, String(value));} removeItem(key) {this.values.delete(key);}}
test('Room connection distinguishes initial connect, synchronization and actual reconnect', async () => {
  const f = await fixture({product: 'th11mp', locale: 'zh-CN'}).enter();
  const message = () => owners.roomConnectionMessage(f.service.getSnapshot(), key => t('zh-CN', key));
  assert.equal(message(), t('zh-CN', 'multiplayer.connectingRoom'));
  await act(() => f.socket.open());
  assert.equal(message(), t('zh-CN', 'multiplayer.syncingMembers'));
  await f.receive({predictionLimit: 8, adonisMode: 0});
  assert.equal(f.service.getSnapshot().room.synced, false);
  assert.equal(message(), t('zh-CN', 'multiplayer.syncingMembers'));
  await f.receive();
  assert.equal(f.service.getSnapshot().room.synced, true);
  await act(() => f.socket.close(1006));
  assert.equal(message(), t('zh-CN', 'multiplayer.reconnecting'));
});
class Socket {
  readyState = 0; sent = []; listeners = new Map(); closes = [];
  addEventListener(type, fn) {this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);}
  emit(type, value = {}) {for (const fn of this.listeners.get(type) || []) fn(value);}
  open() {this.readyState = 1; this.emit('open');}
  message(room, features = {}) {this.emit('message', {data: JSON.stringify({type: 'state', roomDirectory: {version: 1, controlModes: true, ...features}, room})});}
  send(value) {assert.equal(this.readyState, 1); this.sent.push(JSON.parse(value));}
  close(code = 1000) {this.readyState = 3; this.closes.push(code); this.emit('close', {code});}
}
function deferred() {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
function syntheticNetwork() {
  const listeners = new Set(), values = new Map(), retries = []; let revision = 0;
  const capabilities = {supported: true, rtcAvailable: true, turnConfigured: true};
  return {subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}, getSnapshot: () => revision,
    metric: (peer, lane) => values.get(`${peer}:${lane}`) || {state: 'checking', rtt: null, jitter: null}, capabilities: () => capabilities,
    retry(peer) {retries.push(peer);}, retries, values, flags: capabilities, get subscriberCount() {return listeners.size;},
    async publish() {await act(() => {revision++; for (const fn of listeners) fn();});}};
}
function fixture({product = 'th06mp', locale = 'en', created = true} = {}) {
  const persistent = new Storage(), session = new Storage(), sockets = [], events = [], preparations = [], timers = new Map(), decisions = owners.createDecisionStore(); let timer = 0;
  persistent.setItem(owners.multiplayerDisplayNameStorageKey, 'Alice');
  const identity = owners.createMultiplayerIdentityStore({persistentStorage: persistent, sessionStorage: session, randomWords: () => [1234567, 7654321]});
  const settings = {touchMovementMode: 'joystick', touchEnabled: false, mobileDevice: false, iceServers: []}, network = syntheticNetwork();
  const service = owners.createMultiplayerRoom({identity, sessions: owners.createMultiplayerRoomSessionStore({storage: session}), preferences: owners.createMultiplayerPreferenceStore({storage: persistent}), decisions,
    memberId: () => 'synthetic-member', createSocket: () => {const socket = new Socket(); sockets.push(socket); return socket;}, relayUrl: () => 'wss://relay.invalid/socket',
    settings: () => settings, setMovementMode: value => {settings.touchMovementMode = value;}, translate: (key, params) => t(locale, key, params), notify: message => events.push(['notify', message]),
    prepareResources: (context, report) => {const task = deferred(); preparations.push({context, report, ...task}); return task.promise;},
    preparationFailed: error => events.push(['prepare-error', error]), beginManualImport: context => events.push(['import', context]),
    launch: async context => events.push(['launch', context]), checkGame: async context => events.push(['check', context]), operationFailed: (...args) => events.push(['operation-error', ...args]),
    isLaunched: () => false, routes: Object.fromEntries(['restore', 'enter', 'settleInvite', 'leave'].map(kind => [kind, value => events.push([kind, value])])),
    network: {reset: reconnecting => events.push(['network-reset', reconnecting]), receive: value => events.push(['network-receive', value]), minimumRtt: () => 43},
    online: () => true, visible: () => true, random: () => 0, setTimeout: (fn, delay) => {timers.set(++timer, {fn, delay}); return timer;}, clearTimeout: id => timers.delete(id)});
  const f = {service, network, decisions, sockets, settings, events, preparations, product, locale, timers,
    get id() {return identity.lobbyClientId(product);}, get socket() {return sockets.at(-1);},
    async enter() {await act(() => service.enterRoom(product, '1234', created)); return f;},
    async receive(patch = {}) {await act(() => f.socket.message({code: '1234', playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, startSerial: 0,
      ...(product === 'th11mp' ? {adonisMode: 1, predictionLimit: 0} : {}),
      seats: [{clientId: f.id, name: 'A', loadout: 0, ready: false, controlMode: 'normal'}, null], spectators: [], ...patch})); return f;},
    async live(patch = {}) {await f.enter(); await act(() => f.socket.open()); await f.receive(patch); return f;},
    async report(progress) {await act(() => preparations.at(-1).report({status: 'preparing', stage: 'package', percent: null, error: '', ...progress}));},
  }; fixtures.add(f); return f;
}
async function mount(Component, initial, {locale = 'en', strict = false} = {}) {
  let props = initial; const container = env.document.createElement('div'); env.document.body.append(container); const root = createRoot(container);
  const render = () => act(() => {let tree = React.createElement(owners.LocaleProvider, {locale}, React.createElement(Component, props)); if (strict) tree = React.createElement(React.StrictMode, null, tree); root.render(tree);});
  const m = {root, container, async update(patch) {props = {...props, ...patch}; await render();}, async unmount() {await act(() => root.unmount()); mounts.delete(m);}};
  mounts.add(m); await render(); return m;
}
async function mountRoom(f, extra = {}, options = {}) {
  const intents = []; const m = await mount(owners.RoomView, {service: f.service, network: f.network, context: defaultContext, assetUrl: path => path,
    onLeave: () => {intents.push(['leave']); f.service.leave();}, onCopyRoomCode: code => intents.push(['copy', code]), onGuide: () => intents.push(['guide']),
    onOpenSettings: () => intents.push(['settings']), settingsOpen: false, panel: null, onOpenPanel: (...args) => intents.push(['panel', ...args]), onClosePanel: () => intents.push(['close']), ...extra}, {locale: f.locale, ...options}); return {m, intents};
}
const click = (selector, scope) => act(() => n(selector, scope).click());
function baseline(f, {panel = null, context = defaultContext} = {}) {
  const doc = new env.window.DOMParser().parseFromString(originalHTML, 'text/html'), snapshot = f.service.getSnapshot(), room = snapshot.room && {...snapshot.room};
  for (const el of all('[data-i18n]', doc)) el.textContent = t(f.locale, el.dataset.i18n);
  for (const attr of ['aria-label', 'placeholder', 'title']) for (const el of all(`[data-i18n-${attr}]`, doc)) el.setAttribute(attr, t(f.locale, el.getAttribute(`data-i18n-${attr}`)));
  const config = owners.multiplayerConfigForProduct(snapshot.product), game = owners.PRODUCT_GAMES[owners.gameIdForProduct(snapshot.product)], q = selector => n(selector, doc), roomPanel = q('#mpRoomPanel');
  roomPanel.open = !!panel; roomPanel.dataset.panel = panel?.kind || 'personal'; if (panel?.peerId) roomPanel.dataset.networkPeer = panel.peerId;
  for (const node of all('[data-room-panel]', doc)) node.hidden = node.dataset.roomPanel !== (panel?.kind || 'personal');
  q('#mpRoomView').hidden = false; q('#mpSettingsRoomDrawerToggle').hidden = false;
  const preparation = snapshot.preparation && {...snapshot.preparation, room, tracker: {snapshot: () => ({active: [snapshot.preparation]})}};
  const player = doc.createElement('div'); if (context.launchStage) player.className = 'mp-room-launch-cover';
  originalRender({document: doc, $: q, t: (key, params) => t(f.locale, key, params), mpUiState: {...snapshot, room}, mpLobby: {connected: snapshot.connected, clientId: snapshot.localClientId, socket: null},
    roomPreparation: preparation, roomPanel, roomNetwork: {...f.network, update() {}}, state: {game: owners.gameIdForProduct(snapshot.product), launched: context.launched, options: context}, player,
    roomLaunchStage: context.launchStage, th09NetworkOverlayOpen: () => context.th09NetworkOverlayOpen, game: () => game,
    mpRoomOwnerLocal: () => room.synced === true && snapshot.seat === 0, mpLoadouts: () => config.loadouts, mpLoadoutLabel: loadout => t(f.locale, loadout.labelKey),
    mpNormalizeLoadoutIndex: value => ((Number(value) || 0) % config.loadouts.length + config.loadouts.length) % config.loadouts.length,
    mpPlayerCounts: () => config.playerCounts, mpDifficultyMax: () => config.difficulties.length - 1, mpInputTimingPolicy: () => config.inputTiming,
    mpAdonisSupported: () => config.inputTiming?.measuredStartup === true, mpRollbackSupported: () => config.inputTiming?.measuredStartup === true && owners.multiplayerInputTimingPolicy(config).rollback, mpInputTimingRecommendation: () => f.service.timingRecommendation(), mpRollbackEnabled: snapshot.rollbackEnabled, mpPendingLoadout: snapshot.loadoutPending ? {index:snapshot.preferredLoadout} : null,
    multiplayerDisplayInitial: owners.multiplayerDisplayInitial, touchMovementUsesJoystick: owners.touchMovementUsesJoystick,
    networkMiB: value => `${(Math.max(0, Number(value) || 0) / 1048576).toFixed(1)} MiB`, mpGameCheckInFlight: snapshot.checkBusy, mpLaunchInFlight: snapshot.launchBusy,
    updateMpQuickChat() {}, mpPersistRoomState() {}, mpAnimateSeatContents() {}, syncCustomSelect() {},
    requiredDescendant: (scope, selector) => n(selector, scope), HTMLElement: env.window.HTMLElement,
  });
  return doc;
}
// Attribute order, empty class/style, translation hooks, select serialization and
// closed/hidden stale descendant text are not rendering semantics. We compare
// each functional region independently: main appends resource rows before other
// seat additions, whereas React declares the same nodes in a stable tree.
function canonical(element) {
  const attrs = [...element.attributes].filter(a => !a.name.startsWith('data-i18n') && !(element.hidden && element.classList.contains('mp-seat-resource') && a.name === 'data-status') && !['open', 'selected', 'value'].includes(a.name) && !(['class', 'style'].includes(a.name) && !a.value))
    .map(a => [a.name, a.name === 'style' ? a.value.replace(/\.0+(?=%)/g, '') : a.value]).sort(([a], [b]) => a.localeCompare(b));
  const children = []; let text = '';
  const finish = () => {if (text.trim()) children.push(text.replace(/\s+/g, ' ').trim()); text = '';};
  for (const child of element.childNodes) {if (child.nodeType === 3) text += child.textContent; else if (child.nodeType === 1) {finish(); children.push(canonical(child));}} finish();
  return [element.localName, attrs, element.hidden ? [] : children];
}
function compare(f, options = {}) {
  const doc = baseline(f, options);
  const selectors = ['#mpRoomConnection', '#mpCopyRoomCode', '#mpRoomTitle', '.mp-room-tags', '#mpRoomResourceProgress', '#mpRoomSettingsDrawer', '#mpInputTiming',
    '#mpSpectatorAvatars', '#mpSpectatorCount', '.mp-room-footer', '#mpNameEditor', '#mpUnseatedNote', '#mpLocalPlayer', '#mpCheckGame',
    '#mpRoomSettings', '#mpSpectatorContent', '[data-room-panel="network"]'];
  for (const selector of selectors) {
    const actual = n(selector).cloneNode(true);
    // Timing deliberately moved here; its values/permissions have their own
    // exercised check below. Every other original room field stays identical.
    if (selector === '#mpRoomSettings') actual.querySelector('#mpInputDelaySetting')?.remove();
    if (selector === '#mpRoomConnection' && (!f.service.getSnapshot().connected || !f.service.getSnapshot().room.synced)) {
      assert.equal(actual.textContent, owners.roomConnectionMessage(f.service.getSnapshot(), key => t(f.locale, key)));
      continue;
    }
    assert.deepEqual(canonical(actual), canonical(n(selector, doc)), `Executed pinned main: ${selector}`);
  }
  for (const [index, actual] of all('[data-mp-seat]').entries()) {
    const expected = n(`[data-mp-seat="${index}"]`, doc);
    for (const attr of ['class', 'hidden', 'title']) assert.equal(actual.getAttribute(attr), expected.getAttribute(attr), `Seat ${index}: ${attr}`);
    for (const selector of ['.mp-seat-face', '.mp-seat-name', '.mp-seat-state', '.mp-seat-me', '.mp-seat-control', '.mp-seat-edit', ...(index ? ['.mp-seat-remove'] : []), '.mp-seat-resource'])
      assert.deepEqual(canonical(n(selector, actual)), canonical(n(selector, expected)), `Executed pinned main seat ${index}: ${selector}`);
    if (!n('.mp-seat-latency', expected).hidden) assert.deepEqual(canonical(n('.mp-seat-latency', actual)), canonical(n('.mp-seat-latency', expected)), `Pinned latency ${index}`);
  }
  assert.equal(n('#mpRoomView').getAttribute('aria-label'), n('#mpRoomView', doc).getAttribute('aria-label'));
  assert.equal(n('#mpNetworkToggle').hidden, true);
  const ids = all('[id]').map(node => node.id); assert.equal(new Set(ids).size, ids.length, 'No duplicate mounted IDs');
}
for (const locale of ['zh-CN', 'en']) test(`Pinned original rendering: ${locale}, unsynced/owner/offline/unseated/spectator/ready/running`, async () => {
  const f = await fixture({locale}).enter(), {m} = await mountRoom(f, {panel: {kind: 'game'}});
  compare(f, {panel: {kind: 'game'}});
  await act(() => f.socket.open()); await f.receive(); compare(f, {panel: {kind: 'game'}});
  await f.receive({playerCount: 3, seats: [{clientId: f.id, name: 'A', loadout: 0, ready: true}, {clientId: 'peer-b123', name: '魔', loadout: 3, ready: true, offline: true, controlMode: 'touch', resource: {status: 'failed', stage: 'package', percent: null}}, null], spectators: [{clientId: 'watch-c123', name: '幽'}], spectatorCount: 4});
  compare(f, {panel: {kind: 'game'}});
  await f.receive({seats: [{clientId: 'host12345', name: 'H', loadout: 1, ready: false}, null]}); compare(f, {panel: {kind: 'game'}});
  await f.receive({seats: [{clientId: 'host12345', name: 'H', loadout: 1}, null], spectators: [{clientId: f.id, name: 'A'}, {clientId: 'watch12345', name: 'W'}]});
  await m.update({panel: {kind: 'spectators'}}); compare(f, {panel: {kind: 'spectators'}});
  await f.receive({phase: 'running', seats: [{clientId: f.id, name: 'A', loadout: 0, ready: true}, {clientId: 'peer12345', name: 'B', loadout: 2, ready: true}]}); compare(f, {panel: {kind: 'spectators'}});
  await act(() => f.socket.close(1006)); compare(f, {panel: {kind: 'spectators'}});
});
for (const locale of ['zh-CN', 'en']) test(`All catalog multiplayer products preserve exact ${locale} roster, controls, difficulty and timing`, async () => {
  for (const product of owners.PRODUCT_IDS.filter(owners.isMultiplayerProductId)) {
    const f = await fixture({product, locale}).live(); const {m} = await mountRoom(f, {panel: {kind: 'game'}});
    const config = owners.multiplayerConfigForProduct(product);
    for (const loadout of [0, config.loadouts.length - 1]) {await f.receive({difficulty: config.difficulties.length - 1, seats: [{clientId: f.id, name: 'A', loadout, ready: false}, {clientId: 'peer12345', name: 'B', loadout: -1, ready: false, controlMode: 'cheat'}]}); compare(f, {panel: {kind: 'game'}});}
    await m.unmount();
  }
});

for (const locale of ['zh-CN', 'en']) test(`Original ${locale} preparation rendering uses exact local percent, status precedence and real cancellation/retry`, async () => {
  const f = await fixture({locale}).live(), {m} = await mountRoom(f, {panel: {kind: 'personal'}});
  const originalInput = n('#mpDisplayName'), originalReady = n('#mpReady');
  for (const progress of [
    {loaded: 137 * 1048576, total: 1000 * 1048576, title: 'Synthetic package'},
    {loaded: 1048576, total: 0, title: ''}, {loaded: 0, total: 0},
    {loaded: 999, total: 1}, {stage: 'runtime', loaded: 1, total: 2},
    {status: 'failed', error: 'Synthetic preparation error'}, {status: 'ready', stage: 'runtime'},
    {status: 'importing'}, {status: 'cancelled'},
  ]) {await f.report(progress); compare(f, {panel: {kind: 'personal'}}); assert.ok(n('#mpDisplayName') === originalInput); assert.ok(n('#mpReady') === originalReady);}
  await f.report({loaded: 137, total: 1000});
  assert.equal(n('.mp-seat-resource-label').textContent, t(locale, 'room.peerDownloading', {percent: 14}));
  assert.equal(f.socket.sent.findLast(message => message.type === 'resource-progress').percent, 10, 'Wire percent buckets do not replace local precise display');
  await click('#mpReady'); assert.equal(f.service.getSnapshot().ready, true);
  await click('#mpRoomResourceCancel'); assert.equal(f.preparations[0].context.signal.aborted, true); assert.equal(f.events.filter(([kind]) => kind === 'import').length, 1);
  assert.equal(f.service.getSnapshot().ready, false); assert.equal(n('#mpReady').disabled, true); compare(f, {panel: {kind: 'personal'}});
  await click('#mpRoomResourceRetry'); assert.equal(f.preparations.length, 2); assert.equal(n('#mpReady').disabled, false);
  await act(() => f.preparations.at(-1).reject(Error('Synthetic transfer rejected'))); assert.equal(n('#mpRoomPhase').title, 'Synthetic transfer rejected');
  await click('#mpRoomResourceRetry'); assert.equal(f.preparations.length, 3);
  await act(() => f.preparations.at(-1).resolve()); assert.equal(n('#mpRoomPhase').textContent, t(locale, 'room.resourcesReady'));
  for (const launchStage of ['preparing', 'path']) {await m.update({context: {...defaultContext, launchStage}}); compare(f, {panel: {kind: 'personal'}, context: {...defaultContext, launchStage}});}
});

test('Room header and panel triggers reach required host edges with original code and peer identity', async () => {
  const f = await fixture().live({seats: null}); await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'peer12345', name: 'B', loadout: 2}]});
  const {m, intents} = await mountRoom(f);
  await click('#mpCopyRoomCode'); await click('#mpRoomGuideOpen'); await click('#mpSettingsRoomDrawerToggle'); await click('#mpRoomSettingsToggle'); await click('#mpSpectatorToggle');
  await click('[data-mp-seat="0"] .mp-seat-edit'); await click('[data-mp-seat="1"] .mp-seat-latency');
  assert.deepEqual(intents, [['copy', '1234'], ['guide'], ['settings'], ['panel', 'game', undefined], ['panel', 'spectators', undefined], ['panel', 'personal', undefined], ['panel', 'network', 'peer12345']]);
  await m.update({settingsOpen: true}); assert.equal(n('#mpRoomView').hasAttribute('inert'), true); assert.equal(n('#mpSettingsRoomDrawerToggle').hidden, true);
  await m.update({settingsOpen: false, settingsClosing: true}); assert.equal(n('#mpRoomView').hasAttribute('inert'), false); assert.equal(n('#mpSettingsRoomDrawerToggle').hidden, true);
  await m.update({settingsClosing: false}); assert.equal(n('#mpSettingsRoomDrawerToggle').hidden, false);
  await click('#mpLeaveRoom'); assert.equal(f.service.getSnapshot().room, null); assert.equal(f.events.at(-1)[0], 'leave'); assert.equal(env.document.querySelector('#mpRoomView'), null);
});

test('Real join, stand, spectator, loadout and become-host button ports retain relay authority', async () => {
  const f = await fixture({created: false}).live({seats: [null, null]}), {m} = await mountRoom(f, {panel: {kind: 'personal'}});
  await click('[data-mp-seat="1"] .mp-seat-drop button'); assert.equal(f.socket.sent.at(-1).type, 'take-seat'); assert.equal(f.socket.sent.at(-1).seat, 1);
  assert.equal(f.service.getSnapshot().seat, null, 'Seating waits for relay snapshot');
  await f.receive({seats: [null, {clientId: f.id, name: 'A', loadout: 0}]});
  await click('#mpLoadoutNextSeat'); assert.deepEqual(f.socket.sent.at(-1), {type: 'set-loadout', loadout: 1});
  await click('#mpLoadoutPrevSeat'); assert.deepEqual(f.socket.sent.at(-1), {type: 'set-loadout', loadout: 0});
  await click('#mpStandUp'); assert.deepEqual(f.socket.sent.at(-1), {type: 'stand-up'}); assert.equal(f.service.getSnapshot().seat, null);
  await m.update({panel: {kind: 'spectators'}}); await click('#mpSpectatorJoin'); assert.deepEqual(f.socket.sent.at(-1), {type: 'spectate', name: 'A'});
  assert.equal(n('#mpSpectatorJoin').textContent, t('en', 'multiplayer.leaveSpectator'));
  await click('#mpSpectatorJoin'); assert.deepEqual(f.socket.sent.at(-1), {type: 'leave-spectator'});
  await m.update({panel: {kind: 'game'}}); await click('#mpTakeHostSeat'); assert.equal(f.socket.sent.at(-1).seat, 0); assert.equal(f.socket.sent.at(-1).type, 'take-seat');
  await m.update({panel: {kind: 'personal'}}); await click('#mpLoadoutNext'); assert.equal(f.service.getSnapshot().preferredLoadout, 1);
  await click('#mpLoadoutPrev'); assert.equal(f.service.getSnapshot().preferredLoadout, 0);
});

test('Real game-settings buttons preserve optimistic count/difficulty, synchronized rules and owner changes without closing panel', async () => {
  const f = await fixture().live(), {m} = await mountRoom(f, {panel: {kind: 'game'}});
  await click('[data-mp-player-count="3"]'); assert.equal(f.service.getSnapshot().room.playerCount, 3); assert.equal(n('#mpSeatStage').dataset.playerCount, '3');
  await click('[data-mp-difficulty="3"]'); assert.equal(f.service.getSnapshot().room.difficulty, 3); assert.equal(n('#mpRoomDifficultyText').textContent, 'Lunatic');
  for (const [selector, key, value] of [['[data-room-visibility="private"]', 'visibility', 'private'], ['[data-room-rule="cheat"]', 'disableCheatMovement', true], ['[data-room-rule="challenge"]', 'challengeMode', true]]) {
    await click(selector); assert.equal(f.socket.sent.at(-1).type, 'settings'); assert.equal(f.socket.sent.at(-1)[key], value); assert.notEqual(f.service.getSnapshot().room[key], value, 'Rule display waits for synchronized snapshot');
  }
  await f.receive({phase: 'running'}); assert.equal(n('[data-mp-player-count="3"]').disabled, false); await click('[data-mp-player-count="3"]'); assert.equal(f.service.getSnapshot().room.playerCount, 3);
  assert.equal(n('[data-room-visibility="private"]').disabled, true); assert.equal(n('[data-room-rule="cheat"]').disabled, true);
  await f.receive({seats: [{clientId: 'other12345', name: 'O', loadout: 1}, {clientId: f.id, name: 'A', loadout: 0}]});
  assert.equal(n('#mpRoomPanel').open, true); assert.equal(n('#mpRoomSettings').hidden, false); assert.equal(n('[data-mp-player-count="3"]').disabled, true); assert.equal(f.service.getSnapshot().roomSettingsOpen, true);
  await f.receive(); assert.equal(n('#mpRoomPanel').open, true); assert.equal(n('[data-mp-player-count="3"]').disabled, false);
  await m.update({panel: null}); assert.equal(f.service.getSnapshot().roomSettingsOpen, false);
});

test('Ready/start gates use synchronized occupied seats and check-game calls real preparation/runtime port', async () => {
  const f = await fixture().live(), {m} = await mountRoom(f, {panel: {kind: 'personal'}});
  assert.equal(n('#mpReady').disabled, false, 'Preparation alone must not disable ready');
  await click('#mpReady'); assert.equal(f.socket.sent.at(-1).type, 'set-ready'); assert.equal(n('#mpStartGame').hidden, false); assert.equal(n('#mpStartGame').disabled, true);
  assert.equal(n('#mpCheckGame').disabled, true);
  await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0, ready: true}, {clientId: 'peer12345', name: 'B', loadout: 2, ready: true}]});
  assert.equal(n('#mpStartGame').disabled, false); await click('#mpStartGame'); assert.equal(f.socket.sent.at(-1).type, 'start');
  await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0, ready: true}, {clientId: 'peer12345', name: 'B', loadout: 2, ready: true, offline: true}]}); assert.equal(n('#mpStartGame').disabled, true);
  await f.receive(); await click('#mpCheckGame'); assert.equal(f.service.getSnapshot().checkBusy, true); assert.equal(n('#mpReady').disabled, true); assert.equal(n('#mpCheckGame').textContent, t('en', 'multiplayer.checkingGame'));
  await act(() => f.preparations[0].resolve()); assert.equal(f.events.filter(([kind]) => kind === 'check').length, 1); assert.equal(f.service.getSnapshot().checkBusy, false);
  await m.update({context: {...defaultContext, th09NetworkOverlayOpen: true}}); assert.equal(n('#mpCheckGame').hidden, true);
  await act(() => f.socket.close(1006)); assert.equal(n('#mpReady').disabled, true); assert.equal(n('#mpStandUp').disabled, false); assert.equal(n('#mpLoadoutNextSeat').disabled, false);
});

test('Seat/spectator removal calls real danger decisions and rejects a departed stale target', async () => {
  const f = await fixture().live({seats: null});
  const room = {seats: [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'peer12345', name: 'B', loadout: 1}], spectators: [{clientId: 'watch12345', name: 'W'}]};
  await f.receive(room); await mountRoom(f, {panel: {kind: 'spectators'}});
  await click('[data-mp-seat="1"] .mp-seat-remove'); assert.equal(f.decisions.getSnapshot().tone, 'danger');
  assert.equal(f.decisions.getSnapshot().message, t('en', 'room.removePlayerConfirm', {seat: 2}));
  await act(() => f.decisions.resolve('confirm')); assert.deepEqual(f.socket.sent.at(-1), {type: 'remove-player', seat: 1, clientId: 'peer12345'});
  await click('.mp-spectator-remove'); assert.equal(f.decisions.getSnapshot().message, t('en', 'room.removeSpectatorConfirm'));
  await act(() => f.decisions.resolve('confirm')); assert.deepEqual(f.socket.sent.at(-1), {type: 'remove-spectator', clientId: 'watch12345'});
  await click('[data-mp-seat="1"] .mp-seat-remove'); await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'successor', name: 'S', loadout: 2}]});
  const count = f.socket.sent.filter(message => message.type === 'remove-player').length; await act(() => f.decisions.resolve('confirm'));
  assert.equal(f.socket.sent.filter(message => message.type === 'remove-player').length, count);
});

test('Nickname preserves focused draft, commits native change/blur with normalization, stays mounted and editable offline', async () => {
  const f = await fixture().live(); await mountRoom(f, {panel: {kind: 'personal'}}, {strict: true}); const input = n('#mpDisplayName');
  await act(() => {input.focus(); input.value = 'Draft name'; input.dispatchEvent(new env.window.Event('input', {bubbles: true}));});
  assert.equal(f.service.getSnapshot().displayName, 'Alice');
  await act(() => f.service.setDisplayName('External name')); assert.equal(input.value, 'Draft name');
  await f.report({loaded: 5, total: 100}); await f.network.publish(); assert.ok(n('#mpDisplayName') === input); assert.equal(input.value, 'Draft name'); assert.ok(env.document.activeElement === input);
  await act(() => {input.value = '  Beatrice  '; input.dispatchEvent(new env.window.Event('change', {bubbles: true}));});
  assert.equal(f.service.getSnapshot().displayName, 'Beatrice'); assert.equal(input.value, 'Beatrice'); assert.deepEqual(f.socket.sent.at(-1), {type: 'set-name', name: 'B'});
  const before = f.socket.sent.filter(message => message.type === 'set-name').length;
  await act(() => {input.value = 'Charlie'; n('#mpRoomPanelClose').focus();});
  assert.equal(f.service.getSnapshot().displayName, 'Charlie'); assert.equal(f.socket.sent.filter(message => message.type === 'set-name').length, before + 1, 'StrictMode did not duplicate native change listener');
  await act(() => f.socket.close(1006)); assert.equal(input.disabled, false);
  await act(() => {input.focus(); input.value = 'Offline'; input.blur();}); assert.equal(f.service.getSnapshot().displayName, 'Offline');
  await act(() => f.service.setDisplayName('Restored')); assert.equal(input.value, 'Restored');
});

for (const locale of ['zh-CN', 'en']) test(`Synthetic network metrics match executed original ${locale} RTT/jitter/quality, selected peer, empty states and retry ports`, async () => {
  const f = await fixture({locale}).live({seats: null});
  const seats = [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'peer12345', name: 'B', loadout: 2}, {clientId: 'peer67890', name: 'C', loadout: 3}];
  await f.receive({playerCount: 3, seats});
  for (const [lane, rtt, jitter] of [['direct', 0.4, 2.7], ['turn', 100.4, 5.1], ['relay', 201.8, null]]) f.network.values.set(`peer12345:${lane}`, {state: 'connected', rtt, jitter});
  const panel = {kind: 'network', peerId: 'peer12345'}, {m} = await mountRoom(f, {panel}); compare(f, {panel});
  assert.deepEqual(all('.mp-network-metric').map(node => node.dataset.quality), ['good', 'fair', 'poor']);
  assert.deepEqual(all('.mp-network-metric strong').map(node => node.textContent), ['1 ms', '100 ms', '202 ms']);
  await click('#mpRoomNetworkRetry'); assert.deepEqual(f.network.retries, ['peer12345']);
  const latency = n('[data-mp-seat="1"] .mp-seat-latency'), input = n('#mpDisplayName'); await act(() => latency.focus());
  f.network.values.set('peer12345:direct', {state: 'connected', rtt: 77.6, jitter: 1.2}); await f.network.publish();
  assert.ok(n('[data-mp-seat="1"] .mp-seat-latency') === latency); assert.ok(n('#mpDisplayName') === input); assert.ok(env.document.activeElement === latency); compare(f, {panel});
  await m.update({panel: {kind: 'network'}}); await click('#mpRoomNetworkRetry'); assert.deepEqual(f.network.retries, ['peer12345', undefined]);
  for (const flags of [{supported: false, rtcAvailable: true, turnConfigured: true}, {supported: true, rtcAvailable: false, turnConfigured: true}, {supported: true, rtcAvailable: true, turnConfigured: false}]) {
    Object.assign(f.network.flags, flags); await f.network.publish(); compare(f, {panel: {kind: 'network'}});
  }
  await m.update({panel: {kind: 'network', peerId: 'departed123'}}); compare(f, {panel: {kind: 'network', peerId: 'departed123'}}); assert.equal(n('.mp-network-empty').textContent, t(locale, 'room.peerLeft'));
  await m.update({panel}); await f.receive({playerCount: 3, seats: [seats[0], {...seats[1], offline: true}, seats[2]]}); compare(f, {panel});
  assert.deepEqual(all('.mp-network-metric strong').map(node => node.textContent), Array(3).fill(t(locale, 'room.unavailable')));
  for (const context of [{...defaultContext, launched: true}, {...defaultContext, launched: true, th09NetworkOverlayOpen: true}]) {await m.update({context}); compare(f, {panel, context});}
  await m.update({context: defaultContext}); await f.receive({seats: [null, seats[1]]}); compare(f, {panel}); assert.equal(n('#mpRoomNetworkRetry').disabled, true);
  await f.receive(); compare(f, {panel}); assert.equal(n('.mp-network-empty').textContent, t(locale, 'room.waitPeer'));
  await act(() => f.socket.close(1006)); compare(f, {panel}); assert.equal(n('.mp-network-empty').textContent, t(locale, 'multiplayer.reconnecting'));
});

test('Measured rollback button routes through real room owner without overwriting selected delay; applied running value wins', async () => {
  const product = owners.PRODUCT_IDS.find(id => owners.isMultiplayerProductId(id) && owners.multiplayerConfigForProduct(id).inputTiming?.measuredStartup);
  assert.ok(product, 'Measured product must exist'); const f = await fixture({product}).live(); await mountRoom(f);
  assert.equal(f.service.getSnapshot().rollbackEnabled,true);await click('#mpRollbackToggle');
  await act(() => f.service.setTimingChoice(7)); await click('#mpRollbackToggle'); assert.equal(f.service.getSnapshot().rollbackEnabled, true); assert.equal(f.service.getSnapshot().timingChoice, 7);
  assert.equal(n('#mpRollbackToggle').getAttribute('aria-checked'), 'true'); await click('#mpRollbackToggle'); assert.equal(f.service.getSnapshot().rollbackEnabled, false);
  await f.receive({phase: 'running', adonisMode: 2}); assert.equal(n('#mpRollbackToggle').getAttribute('aria-checked'), 'true'); assert.equal(n('#mpRollbackToggle').disabled, true);
  await f.receive({phase: 'running', adonisMode: 1}); assert.equal(n('#mpRollbackToggle').getAttribute('aria-checked'), 'false');
  await f.receive({seats: [{clientId: 'host12345', name: 'H', loadout: 0}, {clientId: f.id, name: 'A', loadout: 1}]}); assert.equal(n('#mpInputTiming').hidden, true);
});
function animationFixture() {
  globalThis.matchMedia = env.window.matchMedia = query => ({matches: false, media: query, addEventListener() {}, removeEventListener() {}});
  const animations = []; env.window.HTMLElement.prototype.animate = function (keyframes, options) {const done = deferred(), record = {node: this, keyframes, options, cancelled: false, finished: done.promise, cancel() {record.cancelled = true; done.reject(Error('Synthetic animation cancelled'));}, finish: done.resolve}; done.promise.catch(() => {}); animations.push(record); return record;}; return animations;
}
async function panelFixture({strict = false} = {}) {
  const trigger = env.document.createElement('button'); trigger.textContent = 'Original trigger'; env.document.body.append(trigger); let requests = 0, closures = 0;
  const m = await mount(owners.RoomPanel, {open: true, kind: 'personal', onCloseRequest: () => requests++, onClosed: () => closures++, trigger: {current: trigger}, children: React.createElement('button', {id: 'child-action'}, 'Child')}, {strict});
  return {m, trigger, get requests() {return requests;}, get closures() {return closures;}, node: n('#mpRoomPanel')};
}
test('Native modal Escape/backdrop request close; committed 160ms closure restores the exact original trigger', async () => {
  const animations = animationFixture(), h = await panelFixture(); assert.equal(h.node.open, true);
  const cancel = new env.window.Event('cancel', {cancelable: true}); await act(() => h.node.dispatchEvent(cancel)); assert.equal(cancel.defaultPrevented, true); assert.equal(h.requests, 1); assert.equal(h.node.open, true);
  await click('#child-action'); assert.equal(h.requests, 1);
  for (const [clientX, clientY, expected] of [[0, 0, 1], [1280, 800, 1], [-1, 20, 2], [1281, 20, 3]]) {
    await act(() => h.node.dispatchEvent(new env.window.MouseEvent('click', {bubbles: true, clientX, clientY}))); assert.equal(h.requests, expected, 'Only strictly outside dialog bounds dismisses');
  }
  await h.m.update({open: false}); assert.equal(h.node.open, true); assert.equal(h.closures, 0); assert.equal(animations.length, 1);
  assert.deepEqual(animations[0].options, {duration: 160, easing: 'cubic-bezier(.4,0,1,1)'});
  assert.deepEqual(animations[0].keyframes, [{opacity: 1, transform: 'translateY(0) scale(1)'}, {opacity: 0, transform: 'translateY(14px) scale(.985)'}]);
  await act(() => animations[0].finish()); assert.equal(h.node.open, false); assert.equal(h.closures, 1); assert.ok(env.document.activeElement === h.trigger);
});
test('Reopen during native close cancels stale animation; StrictMode subscriptions and closing promise clean up on unmount', async () => {
  const animations = animationFixture(), h = await panelFixture({strict: true}); assert.equal(h.node.open, true);
  await h.m.update({open: false}); assert.equal(animations.length, 1);
  await h.m.update({open: true, kind: 'network', peerId: 'peer12345'}); assert.equal(animations[0].cancelled, true); assert.equal(h.node.open, true); assert.equal(h.closures, 0);
  await act(() => animations[0].finish()); assert.equal(h.node.open, true); assert.equal(h.closures, 0);
  await h.m.update({open: false}); await h.m.unmount(); assert.equal(animations[1].cancelled, true); await act(() => animations[1].finish()); assert.equal(h.closures, 0);
  const f = await fixture().live(), {m} = await mountRoom(f, {}, {strict: true}); assert.equal(f.network.subscriberCount, 1); await m.unmount(); assert.equal(f.network.subscriberCount, 0);
});
test('Reduced-motion modal closes synchronously; room trigger focus and settings state settle together', async () => {
  const f = await fixture().live(), {m} = await mountRoom(f); const trigger = n('#mpRoomSettingsToggle');
  await click('#mpRoomSettingsToggle'); await m.update({panel: {kind: 'game'}}); assert.equal(f.service.getSnapshot().roomSettingsOpen, true);
  await act(() => n('#mpRoomPanelClose').focus()); await m.update({panel: null}); assert.equal(n('#mpRoomPanel').open, false); assert.equal(f.service.getSnapshot().roomSettingsOpen, false);
  assert.ok(env.document.activeElement === trigger); assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(n('#mpSpectatorToggle').getAttribute('aria-expanded'), 'false');
});
test('Seat occupant changes animate only existing contents for 180ms and preserve mounted controls', async () => {
  const animations = animationFixture(), f = await fixture().live(), {m} = await mountRoom(f); const seat = n('[data-mp-seat="1"]');
  await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'peer12345', name: 'B', loadout: 1}]});
  const changes = animations.filter(item => seat.contains(item.node)); assert.equal(changes.length, 4);
  assert.ok(changes.every(item => item.options.duration === 180 && ['mp-seat-face', 'mp-seat-index', 'mp-seat-name', 'mp-seat-state'].some(name => item.node.classList.contains(name))));
  assert.ok(changes.every(item => !JSON.stringify(item.keyframes).includes('transform'))); const count = animations.length;
  await f.receive({seats: [{clientId: f.id, name: 'A', loadout: 0}, {clientId: 'peer12345', name: 'B', loadout: 2, ready: true}]}); assert.equal(animations.length, count); assert.ok(n('[data-mp-seat="1"]') === seat);
  await m.unmount(); assert.ok(changes.every(item => item.cancelled));
});
test('Room views and domain owner add no independent History/Router controller', () => {
  for (const file of ['RoomView.tsx', 'RoomPanel.tsx', 'RoomSeats.tsx', 'RoomPersonal.tsx', 'RoomProgress.tsx', 'RoomNetwork.tsx', 'RoomSpectators.tsx', 'RoomGameSettings.tsx', 'RoomSettingsDrawer.tsx', 'MultiplayerSettingsControls.tsx'])
    assert.doesNotMatch(readFileSync(resolve(project, 'app/components/room', file), 'utf8'), /\b(?:pushState|replaceState|popstate|history\s*\.|useNavigate|useBlocker)\b/, file);
  assert.doesNotMatch(readFileSync(resolve(project, 'app/services/multiplayer-room.ts'), 'utf8'), /\b(?:pushState|replaceState|popstate|history\s*\.|useNavigate|useBlocker)\b/);
});
test('Native dialog close event clears room settings state and restores trigger as in pinned main', async () => {
  const f = await fixture().live(), {m, intents} = await mountRoom(f); const trigger = n('#mpRoomSettingsToggle');
  await click('#mpRoomSettingsToggle'); await m.update({panel: {kind: 'game'}}); await act(() => n('#mpRoomPanelClose').focus());
  await act(() => n('#mpRoomPanel').close()); assert.equal(f.service.getSnapshot().roomSettingsOpen, false); assert.ok(env.document.activeElement === trigger); assert.equal(intents.filter(([kind]) => kind === 'close').length, 1);
});
test('Unmount retires an open native modal synchronously', async () => {
  const h = await panelFixture(); await h.m.unmount(); assert.equal(h.node.open, false);
});

for (const locale of ['zh-CN', 'en']) test(`room game settings own ${locale} timing while local options retain replay/import for every product`, async () => {
  for (const product of owners.PRODUCT_IDS.filter(owners.isMultiplayerProductId)) {
    const f = fixture({product, locale}), events = [], m = await mount(owners.MultiplayerSettingsControls, {product, service: f.service, onReplayViewer: () => events.push('replay-viewer'), onImport: () => events.push('import')}, {locale});
    assert.equal(all('#mpInputDelay').length, 0, 'local options never contain a room-wide timing field');
    for (const selector of ['#mpReplayViewer', '#mpGamePackageImport']) assert.equal(n(selector).disabled, false);
    await click('#mpReplayViewer'); await click('#mpGamePackageImport'); assert.deepEqual(events, ['replay-viewer', 'import']);
    await f.live(); const h = await mountRoom(f, {panel: {kind: 'game'}}, {locale});
    const config = owners.multiplayerConfigForProduct(product), select = n('#mpInputDelay'), original = baseline(f);
    assert.ok(n('#mpRoomSettings').contains(select));
    assert.equal(n('#mpInputDelaySetting').hidden, !config.inputTiming);
    if (config.inputTiming) assert.deepEqual([...select.options].map(node => [node.value, node.textContent, node.disabled]), [...n('#mpInputDelay', original).options].map(node => [node.value, node.textContent, node.disabled]));
    for (const selector of ['#mpReplayViewer', '#mpGamePackageImport']) assert.deepEqual(canonical(n(selector)), canonical(n(selector, original)));
    if (config.inputTiming) {
      if(owners.multiplayerInputTimingPolicy(config).rollback){assert.equal(select.value,'0');assert.equal(select.disabled,true);await act(()=>f.service.setRollbackEnabled(false));assert.equal(select.disabled,false);}
      await act(() => {select.value = '5'; select.dispatchEvent(new env.window.Event('change', {bubbles: true}));}); assert.equal(f.service.getSnapshot().timingChoice, 5); assert.equal(select.value, '5');
      const trigger = select.closest('.mizuki-select').querySelector('.mizuki-select-trigger'); assert.match(trigger.textContent, /5f/);
      await f.receive({seats: [{clientId: 'host12345', name: 'H', loadout: 0}, {clientId: f.id, name: 'A', loadout: 1}]});
      assert.equal(select.disabled, true); assert.equal(select.dataset.triggerI18n, 'room.inputDelayHost'); assert.equal(trigger.textContent, t(locale, 'room.inputDelayHost'));
      await f.receive({phase: 'running', inputDelay: 4, inputDelayAuto: false}); assert.equal(select.value, '4'); assert.equal(select.disabled, true); assert.equal(select.dataset.triggerI18n, undefined);
      assert.equal(select.options[0].textContent, n('#mpInputDelay', baseline(f)).options[0].textContent);
      if (config.inputTiming.measuredStartup) {
        await f.receive({phase: 'running', inputDelay: 3, inputDelayAuto: true, adonisMode: 1}); assert.equal(select.value, 'auto');
        assert.equal(select.options[0].textContent, n('#mpInputDelay', baseline(f)).options[0].textContent);
        // The real normalizer accepts the full measured-timing contract below.
        const timing = {phase: 'ready', route: 'rtc', inputDelay: 3, fullDelay: 3, predictionReserve: 0, rttP95Us: 100000, samples: 100, lost: 0, adonisMode: 1, automatic: true};
        await f.receive({phase: 'running', inputDelay: 3, inputDelayAuto: true, adonisMode: 1, timing});
        assert.ok(f.service.getSnapshot().room.timing); assert.equal(select.options[0].textContent, t(locale, 'room.inputDelayMeasured', {frames: 3}));
      }
      await act(() => f.socket.close(1006)); assert.equal(select.disabled, true);
    }
    await h.m.unmount(); await m.unmount(); assert.equal(all('.mizuki-select-menu').length, 0);
  }
});
function settingsContext(productId, patch = {}) {return {productId, uiLocale: 'en', languages: [{id: 'ja', title: '日本語'}], musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: false}, webMidiAvailable: false, mobile: false, ...patch};}
async function sharedDrawer(f, {strict = false, roomOpen = true, open = true} = {}) {
  const model = owners.createGameSettingsModel({storage: new Storage()}), events = []; model.hydrate(settingsContext(f.product));
  const midi = {enabled: false, granted: false, busy: false, supported: false, outputs: [], selectedId: '', hint: ''};
  const actions = {confirm: async () => false, file: async (...args) => events.push(['file', ...args]), showAppleNotice: () => events.push(['apple']), feedback: (...args) => events.push(['feedback', ...args]), reportError: error => {throw error;},
    externalMidi: {subscribe: () => () => {}, getSnapshot: () => midi, setEnabled: async () => {}, selectOutput: async () => {}}};
  function Fixture({product = f.product, roomOpen, open, foregroundActive = false}) {
    const [closing, setClosing] = React.useState(false), requestClose = () => events.push(['close']);
    return React.createElement(MemoryRouter, null,
      React.createElement(owners.RoomView, {service: f.service, network: f.network, context: defaultContext, assetUrl: path => path, onLeave: () => {}, onCopyRoomCode: () => {}, onGuide: () => {}, onOpenSettings: () => {}, settingsOpen: open && !foregroundActive, settingsClosing: closing, panel: null, onOpenPanel: () => {}, onClosePanel: () => {}}),
      React.createElement(owners.RoomSettingsDrawer, {roomOpen, open, foregroundActive, onCloseRequest: requestClose, onClosingChange: setClosing}),
      React.createElement(owners.OptionsPanel, {product: owners.createLibraryProducts([product], path => path, id => `/?game=${id}`)[0], open: !roomOpen, roomDrawer: roomOpen, onBack: requestClose, assetUrl: path => path, lobbyHref: '/lobby.html',
        multiplayerDiagnostics: React.createElement('section', {id: 'mpNetworkDiagnostics'}, 'Synthetic diagnostics slot'), actions: React.createElement('div', {className: 'launch-wrap launch-actions', id: 'ordinary-launch-actions'}, 'Synthetic ordinary launch slot')},
      React.createElement(owners.SettingsBody, {model, actions, onOpenTouchLayout: () => events.push(['editor']), multiplayerControls: React.createElement(owners.MultiplayerSettingsControls, {product, service: f.service, onReplayViewer: () => events.push(['replay-viewer']), onImport: () => events.push(['import'])})})));
  }
  const m = await mount(Fixture, {roomOpen, open}, {locale: f.locale, strict}); return {m, model, events};
}
function fakeTimers() {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, tasks = new Map(); let time = 0, serial = 0;
  globalThis.setTimeout = (fn, delay = 0, ...args) => {const id = ++serial; tasks.set(id, {at: time + delay, delay, fn: () => fn(...args)}); return id;}; globalThis.clearTimeout = id => tasks.delete(id);
  return {tasks, async tick(ms) {const end = time + ms; for (;;) {const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; tasks.delete(next[0]); time = next[1].at; await act(next[1].fn);} time = end;}, restore() {globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;}};
}
function sharedNodes() {return Object.fromEntries(['#mpSettingsFold', '.tools-head', '.mp-settings-body', '#mpShareSettingsToggle', '#mpReplayViewer', '#mpGamePackageImport', '#mpTouchLayoutEdit'].map(selector => [selector, n(selector)]));}
function assertSharedNodes(nodes) {for (const [selector, node] of Object.entries(nodes)) {assert.ok(n(selector) === node, `Preserve original node: ${selector}`); assert.equal(all(selector).length, 1);} const ids = all('[id]').map(node => node.id); assert.equal(new Set(ids).size, ids.length);}

test('Real shared SettingsBody moves one header/fold into drawer and back across StrictMode, rerender, product/context switches', async () => {
  const f = await fixture().live(); const h = await sharedDrawer(f, {strict: true, roomOpen: false, open: false}), nodes = sharedNodes();
  assert.equal(nodes['#mpSettingsFold'].parentElement.id, 'mpShell'); assert.equal(nodes['.tools-head'].parentElement.classList.contains('tools'), true);
  await h.m.update({roomOpen: true, open: true}); assertSharedNodes(nodes);
  const drawer = n('#mpSettingsRoomDrawer'); assert.ok(nodes['.tools-head'].parentElement === drawer); assert.equal(nodes['#mpSettingsFold'].parentElement.id, 'mpSettingsRoomDrawerContent'); assert.equal(nodes['#mpSettingsFold'].classList.contains('mp-room-drawer-mounted'), true);
  assert.ok(env.document.activeElement === n('#libraryBack'), 'Drawer opening focuses original libraryBack'); assert.equal(n('#libraryBack').getAttribute('aria-label'), t('en', 'settings.drawerClose'));
  assert.equal(drawer.querySelector('#mpInputDelaySetting'), null, 'room-wide timing stays out of the local options drawer');
  const actions = n('#mpReplayViewer').closest('.launch-actions');
  assert.ok(actions.previousElementSibling.classList.contains('mp-shared-settings')); assert.equal(actions.classList.contains('mp-replay-launch-wrap'), false, 'compact placement uses the shared semantic variant');
  for (const selector of ['#optionsLobbyLink', '#mpNetworkDiagnostics', '#ordinary-launch-actions']) {assert.ok(n(selector)); assert.equal(drawer.contains(n(selector)), false);}
  await click('#mpReplayViewer'); await click('#mpGamePackageImport'); await click('#mpTouchLayoutEdit'); assert.deepEqual(h.events.slice(-3), [['replay-viewer'], ['import'], ['editor']]);
  const before = h.model.getSnapshot().shareSingleplayerSettings; await click('#mpShareSettingsToggle'); assert.equal(h.model.getSnapshot().shareSingleplayerSettings, !before); assertSharedNodes(nodes);
  await act(() => h.model.refreshContext(settingsContext(f.product, {mobile: true}))); assertSharedNodes(nodes);
  await act(() => h.model.hydrate(settingsContext('th07mp'))); await h.m.update({product: 'th07mp'}); assertSharedNodes(nodes); assert.equal(n('#gameId').dataset.game, 'th07');
  await h.m.update({roomOpen: false, open: false}); assertSharedNodes(nodes); assert.equal(nodes['#mpSettingsFold'].parentElement.id, 'mpShell'); assert.equal(nodes['#mpSettingsFold'].classList.contains('mp-room-drawer-mounted'), false);
  await h.m.unmount(); assert.equal(all('.mizuki-select-menu').length, 0); assert.equal(all('.mizuki-select').length, 0);
});

test('Drawer preserves shared controls through editor foreground suspension and resumes the same focused field', async () => {
  const f = await fixture().live(), h = await sharedDrawer(f), nodes = sharedNodes(), focused = n('#mpTouchLayoutEdit');
  await act(() => focused.focus()); await h.m.update({foregroundActive: true}); assert.equal(n('#mpSettingsRoomDrawer').hidden, true); assert.equal(n('#mpSettingsRoomDrawer').hasAttribute('inert'), true); assert.equal(n('#mpSettingsRoomBackdrop').hidden, true); assertSharedNodes(nodes);
  await act(() => n('#mpCopyRoomCode').focus()); await h.m.update({foregroundActive: false}); assert.equal(n('#mpSettingsRoomDrawer').hidden, false); assert.equal(n('#mpSettingsRoomDrawer').hasAttribute('inert'), false); assert.ok(env.document.activeElement === focused, 'Restores exact focused control'); assertSharedNodes(nodes);
});

test('Drawer close uses 220ms completion, retained fading backdrop and immediate inert release and then visible cue focus; reopen retires stale timer', async () => {
  animationFixture(); const f = await fixture().live(), h = await sharedDrawer(f), clock = fakeTimers();
  try {
    const cue = n('#mpSettingsRoomDrawerToggle'), focusCalls = [], originalFocus = cue.focus.bind(cue); cue.focus = options => {focusCalls.push({hidden: cue.hidden, roomInert: n('#mpRoomView').hasAttribute('inert')}); originalFocus(options);};
    await h.m.update({open: false}); assert.equal(n('#mpSettingsRoomBackdrop').hidden, false); assert.equal(n('#mpSettingsRoomBackdrop').classList.contains('closing'), true); assert.equal(n('#mpRoomView').hasAttribute('inert'), false); assert.equal(n('#mpSettingsRoomDrawer').hidden, false); assert.equal(n('#mpSettingsRoomDrawer').classList.contains('closing'), true); assert.equal(cue.hidden, true);
    assert.equal([...clock.tasks.values()].filter(task => task.delay === 220).length, 1); await clock.tick(219); assert.equal(n('#mpSettingsRoomDrawer').hidden, false); await clock.tick(1);
    assert.equal(n('#mpSettingsRoomDrawer').hidden, true); assert.equal(n('#mpSettingsRoomBackdrop').hidden, true); assert.equal(cue.hidden, false); assert.deepEqual(focusCalls, [{hidden: false, roomInert: false}]);
    await h.m.update({open: true}); await h.m.update({open: false}); const stale = [...clock.tasks.values()].find(task => task.delay === 220); await h.m.update({open: true}); assert.equal([...clock.tasks.values()].some(task => task === stale), false);
    await act(stale.fn); assert.equal(n('#mpSettingsRoomDrawer').hidden, false); assert.equal(n('#mpSettingsRoomDrawer').classList.contains('closing'), false);
    await h.m.update({open: false}); await h.m.update({roomOpen: false}); assert.equal(n('#mpSettingsRoomDrawer').hidden, true); assert.equal(clock.tasks.size, 0);
    await h.m.unmount();
  } finally {clock.restore();}
});
test('Relocated shared settings controls retain Escape/backdrop close and cyclic Tab containment', async () => {
  const f = await fixture().live(), h = await sharedDrawer(f, {strict: true}), drawer = n('#mpSettingsRoomDrawer');
  const handled = new env.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}); handled.preventDefault(); await act(() => n('#libraryBack').dispatchEvent(handled)); assert.equal(h.events.filter(([kind]) => kind === 'close').length, 0);
  const escape = new env.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
  await act(() => n('#libraryBack').dispatchEvent(escape)); assert.equal(escape.defaultPrevented, true); assert.equal(h.events.filter(([kind]) => kind === 'close').length, 1);
  await click('#mpSettingsRoomBackdrop'); assert.equal(h.events.filter(([kind]) => kind === 'close').length, 2);
  const controls = all('button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]', drawer).filter(node => node.tabIndex >= 0 && !node.closest('[hidden]'));
  // Explicit synthetic visibility rectangles, not a browser layout assertion.
  for (const node of controls) node.getClientRects = () => [node.getBoundingClientRect()];
  const [first] = controls, last = controls.at(-1); assert.ok(first && last && first !== last);
  const backward = new env.window.KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}); await act(() => {first.focus(); first.dispatchEvent(backward);});
  assert.equal(backward.defaultPrevented, true); assert.ok(env.document.activeElement === last);
  const forward = new env.window.KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}); await act(() => last.dispatchEvent(forward));
  assert.equal(forward.defaultPrevented, true); assert.ok(env.document.activeElement === first);
});
test('Drawer departure and unmount cancel retained 220ms timers with no stale focus or detached selects', async () => {
  animationFixture(); const f = await fixture().live(), h = await sharedDrawer(f, {strict: true}), clock = fakeTimers();
  try {
    await h.m.update({open: false}); const task = [...clock.tasks.values()].find(task => task.delay === 220); assert.ok(task);
    await h.m.unmount(); assert.equal(clock.tasks.size, 0); await act(task.fn); assert.equal(env.document.querySelector('#mpSettingsRoomDrawer'), null); assert.equal(all('.mizuki-select-menu').length, 0);
  } finally {clock.restore();}
});

test('TH11 rollback is hidden and disabled even for a ready host', async()=>{
 const f=await fixture({product:'th11mp'}).live(); const {m}=await mountRoom(f);
 assert.equal(n('#mpRollbackToggle').hidden,true); assert.equal(n('#mpRollbackToggle').disabled,true);
 await act(()=>f.service.setRollbackEnabled(true)); assert.equal(f.service.getSnapshot().rollbackEnabled,false);
 await m.unmount();
});


test('redesign room uses canonical grouped choices, waits for loadout acknowledgement and confirms before Ready', async () => {
  const f = await fixture({locale: 'zh-CN'}).live(); await mountRoom(f, {redesigned: true});
  const seat = n('.room-workspace-seat.is-local');
  assert.equal(n('#mpReady').disabled, true);
  const key = key => act(() => seat.dispatchEvent(new env.window.KeyboardEvent('keydown', {key, bubbles:true, cancelable:true})));
  await key('ArrowRight');
  assert.equal(f.service.getSnapshot().preferredLoadout, 2, 'next character is Marisa A, not Reimu B');
  assert.equal(f.service.getSnapshot().loadoutPending, true); assert.equal(n('#mpReady').disabled,true);
  await key('Enter'); assert.ok(n('.room-select-phase').textContent.includes('选择主人公'), 'pending acknowledgement blocks confirmation');
  await f.receive({seats:[{clientId:f.id,name:'A',loadout:2,ready:false},null]});
  await key('Enter'); assert.ok(n('.room-select-phase').textContent.includes('选择武器'));
  await key('ArrowRight'); assert.equal(f.service.getSnapshot().preferredLoadout,3);
  await f.receive({seats:[{clientId:f.id,name:'A',loadout:3,ready:false},null]}); await key('Enter');
  await f.receive({seats:[{clientId:f.id,name:'A',loadout:3,ready:false},null]});
  assert.equal(n('#mpReady').disabled,true, 'character confirmation still waits for resources');
  await act(() => f.preparations[0].resolve());
  assert.equal(n('#mpReady').disabled,false);
  assert.equal(n('.room-character-art [data-character]').dataset.character,'marisa');
  await key('Escape'); assert.equal(n('#mpReady').disabled,true);
});

test('redesign room focuses a late assigned P2 after entry unlocks, without stealing focus on progress updates', async () => {
  const f = await fixture().enter(); const {m} = await mountRoom(f,{redesigned:true},{strict:true});
  m.container.setAttribute('inert','');
  await act(() => f.socket.open());
  await f.receive({seats:[{clientId:'peer12345',loadout:0},{clientId:f.id,loadout:0}]});
  const seat = n('[data-mp-seat="1"]');
  assert.notEqual(env.document.activeElement,seat,'entry animation still blocks the seat');
  await act(() => m.container.removeAttribute('inert'));
  assert.equal(env.document.activeElement,seat);
  await act(() => env.document.activeElement.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
  assert.equal(f.service.getSnapshot().preferredLoadout,2,'keyboard works without an extra click');
  await act(() => n('#mpCopyRoomCode').focus());
  await f.report({percent:50}); await f.receive({seats:[{clientId:'peer12345',loadout:0},{clientId:f.id,loadout:2}]});
  assert.equal(env.document.activeElement,n('#mpCopyRoomCode'),'preparation and relay updates preserve the chosen focus');
});

test('redesign direct room entry focuses once, defers behind settings, and restores on visible return', async () => {
  const f = await fixture().live(); const {m} = await mountRoom(f,{redesigned:true,settingsOpen:true},{strict:true});
  assert.notEqual(env.document.activeElement,n('.room-workspace-seat.is-local'));
  await m.update({settingsOpen:false});
  assert.equal(env.document.activeElement,n('.room-workspace-seat.is-local'));
  await act(() => n('#mpCopyRoomCode').focus());
  await m.update({settingsOpen:true}); await m.update({settingsOpen:false});
  assert.equal(env.document.activeElement,n('#mpCopyRoomCode'),'reopening settings does not repeat room-entry focus');
  await m.update({visible:false}); await m.update({visible:true});
  assert.equal(env.document.activeElement,n('.room-workspace-seat.is-local'));
});

test('locked redesign directory keeps a scroll focus target while blocking clicks and selection keys', async () => {
  const selected = [], products = owners.createLibraryProducts(['th06mp','th07mp'],path=>path,id=>`/?game=${id}`);
  const m = await mount(owners.GameDirectory,{products,selectedProduct:'th06mp',locked:true,onActivate:id=>selected.push(id),onSite:()=>selected.push('site'),siteHref:'/'});
  assert.equal(n('.redesign-directory').hasAttribute('inert'),false);
  assert.equal(n('.game-rail').tabIndex,0);
  const target = n('.game[data-game="th07"]');
  assert.equal(target.getAttribute('aria-disabled'),'true'); assert.equal(target.tabIndex,-1); assert.equal(target.hasAttribute('href'),false);
  await click('.game[data-game="th07"]'); await click('.directory-site');
  const key = new env.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});
  await act(()=>{n('.game-rail').focus(); n('.game-rail').dispatchEvent(key);});
  assert.equal(key.defaultPrevented,false,'native rail scrolling is allowed'); assert.deepEqual(selected,[]);
  await m.update({locked:false}); await click('.game[data-game="th07"]');
  assert.deepEqual(selected,['th07mp']); assert.equal(target.getAttribute('aria-disabled'),null); assert.equal(target.getAttribute('href'),'/?game=th07mp');
});

test('portrait directory commits the settled center once and programmatic centering never changes the route', async () => {
  const originalRect = env.window.HTMLElement.prototype.getBoundingClientRect;
  env.window.matchMedia = query => ({matches:query.includes('orientation:portrait'),media:query,addEventListener(){},removeEventListener(){}}); globalThis.matchMedia = env.window.matchMedia;
  env.window.HTMLElement.prototype.getBoundingClientRect = function() {
    if (this.classList.contains('game-rail')) return new env.window.DOMRect(18,80,354,160);
    if (this.classList.contains('game')) {
      const rail=this.closest('.game-rail'), index=[...rail.querySelectorAll('.game')].indexOf(this);
      return new env.window.DOMRect(18+111+index*154-rail.scrollLeft,94,132,132);
    }
    return originalRect.call(this);
  };
  try {
    const selected=[], products=owners.createLibraryProducts(['th06mp','th07mp'],path=>path,id=>`/?game=${id}`);
    const m=await mount(owners.GameDirectory,{products,selectedProduct:'th06mp',locked:false,onActivate:id=>selected.push(id),onSite:()=>selected.push('site'),siteHref:'/'},{strict:true});
    const rail=n('.game-rail'), scroll=left=>act(()=>{rail.dispatchEvent(new env.window.Event('wheel'));rail.scrollLeft=left;rail.dispatchEvent(new env.window.Event('scroll'));});
    assert.equal(rail.scrollLeft,154,'initial TH06 centers without activating another card'); assert.deepEqual(selected,[]);
    await scroll(200); await scroll(308);
    assert.deepEqual(selected,[],'moving past intermediate cards does not change the route');
    await act(()=>rail.dispatchEvent(new env.window.Event('scrollend')));
    assert.deepEqual(selected,['th07mp']);
    await m.update({selectedProduct:'th07mp'});
    await act(()=>rail.dispatchEvent(new env.window.Event('scrollend')));
    assert.deepEqual(selected,['th07mp'],'route-driven alignment does not activate again');
    assert.equal(n('.game[data-game="th07"]').style.getPropertyValue('--carousel-wave'),'0.1200');
    assert.ok(Number(n('.game[data-game="th06"]').style.getPropertyValue('--carousel-wave'))>0,'neighbor participates in the wave');
    await scroll(0); await act(()=>new Promise(resolve=>setTimeout(resolve,200)));
    assert.deepEqual(selected,['th07mp','site'],'the site card can also reach the center');
    await scroll(154); await m.update({locked:true});
    await act(()=>rail.dispatchEvent(new env.window.Event('scrollend')));
    assert.deepEqual(selected,['th07mp','site'],'locking cancels a pending selection');
    assert.equal(n('.directory-rail-shell').dataset.centerSelect,'false');
    assert.equal(n('.game[data-game="th07"]').style.getPropertyValue('--carousel-wave'),'');
  } finally {env.window.HTMLElement.prototype.getBoundingClientRect=originalRect;}
});

test('redesign touch selection leaves vertical gestures to page scrolling and retains horizontal swipe and tap', async () => {
  const f = await fixture({locale:'zh-CN'}).live(); await mountRoom(f,{redesigned:true});
  const seat = n('.room-workspace-seat.is-local');
  seat.setPointerCapture = () => {};
  const pointer = (type,x,y) => act(() => {
    const event = new env.window.Event(type,{bubbles:true,cancelable:true});
    Object.assign(event,{pointerType:'touch',isPrimary:true,pointerId:1,clientX:x,clientY:y});
    seat.dispatchEvent(event);
  });
  for (const [x,y] of [[100,20],[100,190],[145,190]]) {
    await pointer('pointerdown',100,100); await pointer('pointerup',x,y);
    assert.equal(f.service.getSnapshot().preferredLoadout,0,'vertical and mostly vertical drags do not change character');
    assert.equal(f.service.getSnapshot().loadoutPending,false);
    assert.ok(n('.room-select-phase').textContent.includes('选择主人公'));
  }
  await pointer('pointerdown',100,100); await pointer('pointerup',40,110);
  assert.equal(f.service.getSnapshot().preferredLoadout,2,'left swipe still selects the next character');
  await f.receive({seats:[{clientId:f.id,name:'A',loadout:2,ready:false},null]});
  await pointer('pointerdown',100,100); await pointer('pointercancel',100,120); await pointer('pointerup',40,100);
  assert.equal(f.service.getSnapshot().preferredLoadout,2,'browser scroll cancellation retires the gesture');
  await pointer('pointerdown',100,100); await pointer('pointerup',103,102);
  assert.ok(n('.room-select-phase').textContent.includes('选择武器'),'tap still confirms the character');
});

test('redesign room remote portraits and ready badges follow server state, with phase and owner gates intact', async () => {
  const f = fixture(); await f.live({seats:[{clientId:f.id,name:'A',loadout:0,ready:false},{clientId:'peer12345',name:'B',loadout:3,ready:true}]});
  await mountRoom(f,{redesigned:true});
  assert.equal(n('[data-mp-seat="1"] [data-character]').dataset.character,'marisa');
  assert.equal(n('[data-mp-seat="1"] .room-ready-badge').classList.contains('ready'),true);
  assert.equal(n('#mpStartGame').disabled,true, 'a ready peer cannot make an unready local player start');
  await f.receive({seats:[{clientId:'host12345',name:'H',loadout:0,ready:false},{clientId:f.id,name:'A',loadout:1,ready:false}]});
  assert.equal(n('#roomDifficultyPicker').disabled,true); assert.equal(n('#roomVisibilityToggle').disabled,true);
  await act(() => f.socket.close(1006)); assert.equal(n('#mpReady').disabled,true);
});

test('redesign artwork and grouping cover the real catalog once each, including TH08 solo and native TH09 order', async () => {
  for(const product of owners.PRODUCT_IDS.filter(owners.isMultiplayerProductId)) {
    const config = owners.multiplayerConfigForProduct(product), groups = owners.roomLoadoutGroups(product);
    assert.deepEqual(groups.flat().slice().sort((a,b)=>a-b),config.loadouts.map((_,i)=>i));
    for(let i=0;i<config.loadouts.length;i++) assert.ok(owners.roomLoadoutArt(product,i).length, `${product}:${i} needs actual artwork metadata`);
  }
  assert.deepEqual(owners.roomLoadoutArt('th08mp',0),['reimu','yukari']);
  assert.deepEqual(owners.roomLoadoutArt('th08mp',5),['yukari']);
  assert.deepEqual(owners.roomLoadoutArt('th09mp',7),['mystia']);
  assert.deepEqual(owners.roomLoadoutArt('th09mp',14),['merlin']);
});

test('redesign room supported third seat and visibility controls use the original service actions', async () => {
  const f = await fixture().live(); await mountRoom(f,{redesigned:true});
  await click('#roomAddPlayer');
  assert.ok(f.socket.sent.some(message => message.type==='settings' && message.playerCount===3));
  await f.receive({playerCount:3,seats:[{clientId:f.id,name:'A',loadout:0,ready:false},null,null]});
  assert.equal(env.document.querySelectorAll('.room-workspace-seat').length,3);
  assert.equal(env.document.querySelector('#roomAddPlayer'),null);
  await click('#roomVisibilityToggle');
  assert.ok(f.socket.sent.some(message => message.type==='settings' && message.visibility==='private'));
});


test('room departure holds the outgoing card after service retirement until the Router replaces it', async () => {
  const animations=animationFixture(), f=await fixture().live();
  function Harness({lobby=false}) {
    const leave=owners.useRoomCardDeparture(f.service,false);
    return React.createElement('div',{className:'workspace-column'},lobby ? React.createElement('section',{className:'workspace-panel lobby-workspace'},'Fixture committed lobby route') : React.createElement(owners.RoomView,{redesigned:true,service:f.service,network:f.network,context:defaultContext,assetUrl:path=>path,settingsOpen:false,panel:null,onOpenPanel(){},onClosePanel(){},onCopyRoomCode(){},onGuide(){},onOpenSettings(){},onLeave:()=>leave(()=>f.service.leave())}));
  }
  const m=await mount(Harness,{}); const card=n('#mpRoomView');
  await click('#mpLeaveRoom'); const outgoing=animations.at(-1);
  assert.equal(outgoing.options.duration,220); assert.notEqual(f.service.getSnapshot().room,null);
  await act(()=>outgoing.finish());
  assert.equal(f.service.getSnapshot().room,null);
  assert.equal(card.dataset.workspaceMotion,'exit','no visible flash between membership cleanup and route commit');
  assert.equal(outgoing.cancelled,false);
  await m.update({lobby:true});
  assert.equal(card.isConnected,false); assert.equal(outgoing.cancelled,true);
});

test('redesign directory lock is a real owner action, waits for ACK and resets selection on product switch', async () => {
  const f=await fixture({locale:'zh-CN'}).live();await mountRoom(f,{redesigned:true});
  assert.equal(n('#roomDirectoryLock').disabled,true,'old relay capability gate');
  const seats=[{clientId:f.id,loadout:0,ready:false},null];
  await act(()=>f.socket.message({code:'1234',product:'th06mp',productVersion:1,directoryLocked:true,productSwitchAvailable:true,playerCount:2,difficulty:1,phase:'lobby',seats,spectators:[]},{roomProducts:1}));
  assert.equal(n('#roomDirectoryLock').disabled,false);assert.equal(n('#roomDirectoryLock').getAttribute('aria-pressed'),'true');
  await click('#roomDirectoryLock');
  assert.equal(f.socket.sent.at(-1).type,'directory-lock');assert.equal(f.socket.sent.at(-1).locked,false);
  assert.equal(n('#roomDirectoryLock').disabled,true);assert.equal(n('#roomDirectoryLock').getAttribute('aria-pressed'),'true');
  await f.receive({product:'th06mp',productVersion:2,directoryLocked:false,productSwitchAvailable:true});
  assert.equal(n('#roomDirectoryLock').getAttribute('aria-pressed'),'false');assert.equal(f.service.getSnapshot().canSwitchProduct,true);
  await act(()=>f.service.switchProduct('th08mp'));
  await f.receive({product:'th08mp',productVersion:3,directoryLocked:false,productSwitchAvailable:true});
  assert.equal(f.service.getSnapshot().product,'th08mp');assert.equal(n('.room-character-details h4').textContent,'结界组');
  assert.equal(all('.room-workspace-seat.is-local .character-portrait img').length,2);
  await f.receive({product:'th08mp',productVersion:3,directoryLocked:false,productSwitchAvailable:true,phase:'running'});
  assert.equal(n('#roomDirectoryLock').disabled,true);assert.equal(f.service.setDirectoryLocked(true),false);
});


test('redesign seat capsule follows real preparation, remote reports, retry and device identity', async () => {
  const f=fixture({locale:'zh-CN'});await f.live({seats:[{clientId:'peer12345',loadout:0,deviceType:'tablet',resource:{status:'preparing',stage:'package',percent:40}},{clientId:f.id,loadout:0}]});
  await mountRoom(f,{redesigned:true});
  assert.equal(env.document.querySelector('.room-choice-hint'),null);
  assert.equal(n('[data-mp-seat="0"] [role="progressbar"]').getAttribute('aria-valuenow'),'40');
  assert.equal(n('[data-mp-seat="0"] .room-seat-device').getAttribute('aria-label'),'P1 · 平板');
  assert.equal(n('[data-mp-seat="1"] .room-seat-device').dataset.device,'desktop');
  await f.report({loaded:512,total:1024});
  assert.equal(n('[data-mp-seat="1"] [role="progressbar"]').getAttribute('aria-valuenow'),'50');
  await f.report({stage:'runtime'});
  assert.equal(n('[data-mp-seat="1"] [role="progressbar"]').getAttribute('aria-valuenow'),null);
  assert.equal(n('[data-mp-seat="1"] .room-seat-progress').classList.contains('indeterminate'),true);
  await f.report({status:'failed',error:'synthetic transfer failed'});
  assert.equal(n('#mpReady').disabled,true);
  assert.ok(n('[data-mp-seat="1"] .room-seat-progress-label').textContent.includes('重试'));
  await click('[data-mp-seat="1"] .room-seat-progress-label button');
  assert.equal(f.preparations.length,2);
  await act(()=>f.preparations[1].resolve());
  assert.equal(n('[data-mp-seat="1"] .room-seat-progress-label').textContent,'选择角色');
  assert.equal(n('[data-mp-seat="1"] [role="progressbar"]').getAttribute('aria-valuenow'),'100');
});

test('room host can add a third seat from P2, remove either other empty slot and kick P1', async () => {
  const f=await fixture({locale:'zh-CN'}).live();await mountRoom(f,{redesigned:true});
  const update=async (playerCount,seats,settingsVersion=5)=>act(()=>f.socket.message({playerCount,difficulty:1,phase:'lobby',hostClientId:f.id,settingsVersion,seats},{roomCards:1}));
  await update(2,[null,{clientId:f.id,loadout:0}]);
  assert.ok(n('[data-mp-seat="1"] .room-player-name').textContent.includes('房主'));
  assert.equal(n('#roomAddPlayer').disabled,false);
  await click('#roomAddPlayer');
  assert.equal(f.socket.sent.at(-1).playerCount,3);
  await update(3,[null,{clientId:f.id,loadout:0},null]);
  assert.equal(env.document.querySelectorAll('.room-player-remove').length,2);
  await click('[data-mp-seat="0"] .room-player-remove');
  assert.deepEqual(f.socket.sent.at(-1),{type:'remove-seat',seat:0,settingsVersion:5});
  assert.equal(env.document.querySelectorAll('.room-workspace-seat').length,3,'wait for server ACK');
  await click('[data-mp-seat="2"] .room-player-remove');
  assert.equal(f.socket.sent.at(-1).seat,2);
  await update(2,[{clientId:'peer12345',loadout:0},{clientId:f.id,loadout:0}],6);
  await click('[data-mp-seat="0"] .room-player-remove');
  assert.equal(f.decisions.getSnapshot().tone,'danger');
  await act(()=>f.decisions.resolve('confirm'));
  assert.equal(f.socket.sent.at(-1).type,'remove-player');assert.equal(f.socket.sent.at(-1).seat,0);
  await act(()=>f.socket.message({playerCount:2,difficulty:1,phase:'lobby',hostClientId:'peer12345',seats:[{clientId:f.id,loadout:0},{clientId:'peer12345',loadout:0}]},{roomCards:1}));
  assert.equal(env.document.querySelector('.room-player-remove'),null);
  assert.equal(env.document.querySelector('#roomAddPlayer'),null);
});

test('device classification distinguishes tablets from phones without treating touch computers as phones',()=>{
  const detect=owners.multiplayerDeviceType;
  assert.equal(detect({userAgent:'Mozilla Macintosh',maxTouchPoints:5}),'tablet');
  assert.equal(detect({userAgent:'Mozilla iPad Mobile'}),'tablet');
  assert.equal(detect({userAgent:'Mozilla Android 14 Tablet'}),'tablet');
  assert.equal(detect({userAgent:'Mozilla Android 14 Mobile'}),'phone');
  assert.equal(detect({userAgent:'Mozilla iPhone Mobile'}),'phone');
  assert.equal(detect({userAgent:'Mozilla Windows NT',maxTouchPoints:10}),'desktop');
  assert.equal(detect({userAgent:'Mozilla X11 Linux'}),'desktop');
});


test('redesign progress separates device and reflects authoritative choice, load, ready and reselect on both seats', async () => {
  const f=await fixture({locale:'zh-CN'}).live(); await mountRoom(f,{redesigned:true});
  const local=(patch={})=>({clientId:f.id,loadout:0,selectionConfirmed:false,...patch});
  const peer=(patch={})=>({clientId:'peer12345',loadout:2,selectionConfirmed:false,resource:{status:'ready',stage:'runtime',percent:100},...patch});
  const update=async (own={},other={})=>act(()=>f.socket.message({playerCount:2,difficulty:1,phase:'lobby',seats:[local(own),peer(other)]},{roomCards:1,selectionState:1}));
  const text=i=>n(`[data-mp-seat="${i}"] .room-seat-progress-label`).textContent;
  const key=value=>act(()=>n('.room-workspace-seat.is-local').dispatchEvent(new env.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})));
  await update(); await act(()=>f.preparations[0].resolve());
  assert.equal(text(0),'选择角色');assert.equal(text(1),'选择角色中');assert.equal(n('#mpReady').disabled,true);
  assert.equal(n('.room-seat-device').parentElement.className,'room-seat-bottom');
  assert.equal(n('.room-seat-progress').parentElement.className,'room-seat-capsule');
  await key('Enter');await click('.room-shot-options button');
  assert.equal(f.socket.sent.at(-1).selectionConfirmed,true);
  await update({},{}); // an unrelated snapshot before the confirm ACK must not clear the pending choice
  assert.equal(n('#mpReady').disabled,true);assert.equal(text(0),'选择角色');
  await update({selectionConfirmed:true},{selectionConfirmed:true});
  assert.equal(text(0),'加载完成');assert.equal(text(1),'加载完成');assert.equal(n('#mpReady').disabled,false);
  await click('#mpReady');await update({selectionConfirmed:true,ready:true},{selectionConfirmed:true,ready:true});
  for(const i of [0,1]) {assert.equal(text(i),'已准备');assert.equal(n(`[data-mp-seat="${i}"] .room-seat-bottom`).dataset.status,'prepared');}
  await click('#mpReady');await update({selectionConfirmed:true},{selectionConfirmed:true});
  assert.equal(text(0),'加载完成');
  await key('Escape');assert.equal(f.socket.sent.at(-1).selectionConfirmed,false);
  await update({},{});assert.equal(text(0),'选择角色');assert.equal(text(1),'选择角色中');
  await f.report({stage:'runtime'});
  await key('Enter');await update({selectionConfirmed:true});
  assert.equal(text(0),t('zh-CN','room.preparingRuntime'));assert.equal(n('#mpReady').disabled,true);
  await f.report({status:'ready',stage:'runtime',percent:100});assert.equal(text(0),'加载完成');assert.equal(n('#mpReady').disabled,false);
  await update({selectionConfirmed:true,ready:true},{selectionConfirmed:true,ready:true,offline:true});
  assert.equal(text(1),t('zh-CN','multiplayer.playerReconnecting'));assert.equal(n('[data-mp-seat="1"] .room-seat-bottom').dataset.status,'offline');
});

test('redesigned host has adjacent return and confirmed dissolve actions, including P2', async () => {
  const f=await fixture({locale:'zh-CN'}).live();
  const retained={...f.service.getSnapshot().room,hostClientId:f.id,seats:[null,{clientId:f.id,name:'A',loadout:0,ready:false}]};
  await act(()=>f.socket.message(retained,{roomRetention:1}));
  await mountRoom(f,{redesigned:true,onLeave:()=>f.service.returnToLobby()});
  const remove=n('#mpDissolveRoom');assert.equal(remove.disabled,false);
  assert.equal(remove.parentElement.children.length,2);
  assert.equal(remove.parentElement.firstElementChild.textContent,t('zh-CN','room.returnLobby'));
  await click('#mpDissolveRoom'); assert.equal(f.decisions.getSnapshot().tone,'danger');
  await act(()=>f.decisions.resolve('cancel'));assert.equal(f.socket.sent.some(m=>m.type==='dissolve-room'),false);
  await click('#mpDissolveRoom');await act(()=>f.decisions.resolve('confirm'));
  assert.equal(f.socket.sent.filter(m=>m.type==='dissolve-room').length,1);assert.equal(n('#mpDissolveRoom').disabled,true);
  await act(()=>f.socket.close(4011));assert.equal(f.service.getSnapshot().room,null);
});
test('redesigned guest cannot dissolve the room and old relays do not expose a working destructive action',async()=>{
  const f=await fixture().live({hostClientId:'another_host'});await mountRoom(f,{redesigned:true});
  assert.equal(env.document.querySelector('#mpDissolveRoom'),null);
  await f.receive({hostClientId:f.id});assert.equal(n('#mpDissolveRoom').disabled,true);
  await click('#mpDissolveRoom');assert.equal(f.decisions.getSnapshot(),null);
});

test('settings activity replaces local and peer capsule text, cancels only local Ready, and restores the prior progress',async()=>{
 const f=await fixture({locale:'zh-CN'}).live();await act(()=>f.preparations[0].resolve());
 const room={playerCount:2,difficulty:1,phase:'lobby',seats:[{clientId:f.id,loadout:0,selectionConfirmed:true,ready:true},{clientId:'peer12345',loadout:2,selectionConfirmed:true,ready:false,editingSettings:true,resource:{status:'ready',stage:'runtime',percent:100}}]};
 await act(()=>f.socket.message(room,{roomCards:1,selectionState:1,editingState:1}));
 const {m}=await mountRoom(f,{redesigned:true});const label=i=>n(`[data-mp-seat="${i}"] .room-seat-progress-label`).textContent;
 assert.equal(label(0),'已准备');assert.equal(label(1),'修改设置中');
 await m.update({settingsOpen:true});assert.equal(label(0),'修改设置中');assert.equal(f.service.getSnapshot().ready,false);assert.equal(f.service.getSnapshot().preparation.status,'ready');assert.equal(n('[data-mp-seat="0"] .room-seat-progress').getAttribute('aria-valuenow'),'100');
 assert.equal(f.socket.sent.some(message=>message.type==='set-ready'&&message.ready===false),true);assert.equal(f.socket.sent.findLast(message=>message.type==='editing-settings').editing,true);
 await m.update({settingsOpen:false});assert.equal(label(0),'加载完成');assert.equal(label(1),'修改设置中');assert.equal(f.service.getSnapshot().ready,false,'return does not re-ready automatically');
 await act(()=>f.socket.message({...room,seats:[{...room.seats[0],ready:false},{...room.seats[1],editingSettings:false}]},{roomCards:1,selectionState:1,editingState:1}));assert.equal(label(1),'加载完成');
 await m.update({panel:{kind:'game'}});assert.equal(label(0),'修改设置中');await m.update({panel:null});assert.equal(label(0),'加载完成');
});
