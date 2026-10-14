import {pinnedUiAuthorityText, synchronizedMainAuthority} from './source-text.mjs';
/** Independent pinned-main component/service regression. SYNTHETIC DOM + MEMORY
 * ROUTER ONLY: not production-host wiring, browser top layer, CSS, relay or runtime QA. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {installMountedDom} from './mounted-dom-environment.mjs';

const here = dirname(fileURLToPath(import.meta.url)), project = resolve(here, '../..');
const require = createRequire(resolve(project, 'package.json'));
const {build, transform} = require('esbuild');
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => synchronizedMainAuthority(path, project, pinnedMain);
let env, work, owners, React, createRoot, createMemoryRouter, RouterProvider, originalHTML, originalRows;
const mounts = new Set(), fixtures = new Set();
const assetUrl = path => path;
const t = (locale, key, params) => owners.translate(locale, key, params);
const n = (selector, scope = env.document) => {const node = scope.querySelector(selector); assert.ok(node, `Missing ${selector}`); return node;};
const all = (selector, scope = env.document) => [...scope.querySelectorAll(selector)];
const flush = () => React.act(async () => {await Promise.resolve(); await Promise.resolve();});

before(async () => {
  env = installMountedDom();
  React = await import('react');
  ({createRoot} = await import('react-dom/client'));
  ({createMemoryRouter, RouterProvider} = await import('react-router'));
  for (const path of ['src/launcher/i18n.mts', 'src/contracts/product-catalog.mts']) {
    const source = pinnedUiAuthorityText(readFileSync(resolve(project, path), 'utf8'));
    // Directory copy stays pinned independently of newer launcher/room labels.
    const directoryKeys = new Set(['room.visibility', 'room.public', 'room.private', 'room.privateHint', 'room.cheatMovement', 'room.cheatAllowed', 'room.cheatDisabled', 'room.challengeMode']);
    const directoryCopy = text => text.split('\n').filter(line => {
      const key = /^  \["([^"]+)"/.exec(line)?.[1];
      return key && (key.startsWith('lobby.') || key.startsWith('multiplayer.control.') || directoryKeys.has(key));
    }).join('\n');
    assert.ok(path.endsWith('i18n.mts') ? directoryCopy(source) === directoryCopy(pinned(path)) : source === pinned(path), `Pinned directory authority changed: ${path}`);
  }
  originalHTML = pinned('public/lobby.html');
  const original = pinned('src/launcher/lobby.mts');
  const rowSource = original.slice(original.indexOf('function titleFor('), original.indexOf('\nfunction render()'));
  const {code} = await transform(rowSource, {loader: 'ts', target: 'es2022'});
  // Execute the original renderer, unchanged except TS erasure, in its own DOM.
  originalRows = new Function('document', 'rowTemplate', 'rowNodes', 'rooms', 'connection', 'mine', 'leaving',
    'PRODUCT_GAMES', 'gameIdForProduct', 'multiplayerConfigForProduct', 'getUiLocale', 't', 'enterRoom', `${code}; return rowFor;`);
  work = await mkdtemp(resolve(here, 'directory-views-build-'));
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export * from './app/components/directory/DirectoryRoomRows.tsx';
    export * from './app/components/directory/LobbyDirectoryView.tsx';
    export * from './app/components/directory/DirectoryRoomDialog.tsx';
    export * from './app/services/lobby-directory.ts';
    export * from './app/i18n.tsx';
    export * from './app/navigation/surface-navigation.tsx';
    export * from './app/components/launcher/products.ts';
    export * from './src/contracts/product-catalog.mts';
    export * from './src/launcher/room-invite.mts';
  `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: resolve(work, 'actual-bundle.mjs'), logLevel: 'silent',
    plugins: [{name: 'installed-deps-original-mts', setup(ctx) {
      ctx.onResolve({filter: /^[^./]/}, args => ({path: pathToFileURL(require.resolve(args.path)).href, external: true}));
      ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts'); if (existsSync(path)) return {path};});
    }}]});
  owners = await import(pathToFileURL(resolve(work, 'actual-bundle.mjs')));
});
afterEach(async () => {
  for (const m of mounts) {await React.act(async () => m.root.unmount()); m.router?.dispose();}
  mounts.clear();
  for (const f of fixtures) f.service.dispose();
  fixtures.clear(); env.document.body.replaceChildren();
  assert.deepEqual(env.errors.splice(0), [], 'No unexpected React/DOM errors');
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

function manifest({games = ['th06', 'th07', 'th08', 'th09', 'th10'], relay = true} = {}) {
  const hash = 'a'.repeat(64);
  return {schema: 'eagler-touhou/site-manifest/1', protocol: 'eagler-touhou/1', profile: 'synthetic-directory-views',
    shared: {resourceMode: 'hosted', testBuild: true, vanillaFont: 'font.ttf', unicodeFont: 'font.otf', ...(relay ? {netplayRelay: 'wss://relay.invalid/netplay'} : {})},
    games: Object.fromEntries(games.map(id => [id, {runtime: `runtime/${id}.html`, ...('multiplayerRuntime' in owners.PRODUCT_GAMES[id] ? {multiplayerRuntime: `runtime/${id}-mp.html`} : {}),
      gameData: {path: owners.PRODUCT_GAMES[id].package.dataTarget.slice(1), bytes: 1, sha256: hash, version: `sha256-${hash}`, layout: `sha256-${hash}`}, music: {midi: {files: []}}}]))};
}
class Socket {
  readyState = 1; listeners = new Map(); sent = []; closes = [];
  addEventListener(type, listener) {const entries = this.listeners.get(type) || []; entries.push(listener); this.listeners.set(type, entries);}
  send(data) {this.sent.push(JSON.parse(data));}
  close(...args) {this.closes.push(args); this.readyState = 3;}
  emit(type, data) {if (type === 'close') this.readyState = 3; for (const fn of this.listeners.get(type) || []) fn(type === 'message' ? {data: JSON.stringify(data)} : data);}
}
function fixture({locale = 'en', selectedProduct = 'th06mp', host = {}, loadError = false} = {}) {
  const sockets = [], timers = new Map(), events = [], sessionWrites = [], navigations = []; let timerId = 0, closeCalls = 0;
  const real = owners.createLobbyDirectory({selectedProduct,
    loadSiteManifest: async () => {if (loadError) throw Error('synthetic manifest failure'); return manifest(host);},
    createSocket: url => {const socket = new Socket(); socket.url = url; sockets.push(socket); return socket;},
    memberId: () => 'fixture-member', identity: {lobbyClientId: product => {events.push(`identity:${product}`); return 'fixture-client';}},
    sessions: {save: (...args) => sessionWrites.push(['save', ...args]), clear: product => sessionWrites.push(['clear', product])},
    sessionStorage: {getItem: () => null, removeItem() {}}, translate: (key, params) => t(locale, key, params),
    launcherUrl: () => 'https://launcher.invalid/index.html?keep=1#retained',
    navigateToRoom: url => {events.push('navigate'); navigations.push({url, dialogOpen: env.document.querySelector('#roomDialog')?.open}); f.onNavigate?.(url);},
    randomWord: () => 23, setTimeout: (fn, delay) => {timers.set(++timerId, {fn, delay}); return timerId;}, clearTimeout: id => timers.delete(id),
  });
  const service = {...real, formDidClose(...args) {closeCalls++; events.push('formDidClose'); real.formDidClose(...args);}};
  const f = {service, sockets, timers, events, sessionWrites, navigations, get closeCalls() {return closeCalls;},
    get socket() {assert.ok(sockets.length); return sockets.at(-1);},
    async start() {await React.act(async () => service.initialize()); return f;},
    async receive(rooms = [], patch = {}) {await React.act(async () => f.socket.emit('message', {type: 'directory', version: 1,
      product: service.getSnapshot().selectedProduct, rooms, total: rooms.length, ...patch}));},
    async live(rooms = [], patch = {}) {await f.start(); await f.receive(rooms, patch); return f;},
    async emit(type, data) {await React.act(async () => f.socket.emit(type, data));},
  };
  fixtures.add(f); return f;
}
function room(patch = {}) {return {product: 'th06mp', code: '1234', capacity: 3, players: 2, ready: 1, difficulty: 1, spectators: 0,
  phase: 'lobby', joinable: true, seats: [{initial: '霊', online: true, ready: true, controlMode: 'normal'}, {initial: 'M', online: false, ready: false, controlMode: 'touch'}, null],
  disableCheatMovement: false, challengeMode: false, ...patch};}
async function mount(Component, initial, {locale = 'en', strict = false} = {}) {
  let props = initial; const container = env.document.createElement('div'); env.document.body.append(container); const root = createRoot(container);
  async function render() {let tree = React.createElement(owners.LocaleProvider, {locale}, React.createElement(Component, props));
    if (strict) tree = React.createElement(React.StrictMode, null, tree); await React.act(async () => root.render(tree));}
  const m = {root, container, async update(patch) {props = {...props, ...patch}; await render();}, async setLocale(next) {locale = next; await render();},
    async unmount() {await React.act(async () => root.unmount()); mounts.delete(m);}};
  mounts.add(m); await render(); return m;
}
async function mountLobby(f, extra = {}, options = {}) {
  const opens = []; const m = await mount(owners.LobbyDirectoryView, {service: f.service, assetUrl,
    masthead: null, products: [], onSelect: () => {}, onActivate: () => {}, onGuide: () => {}, onNetwork: () => {},
    onOpenForm: mode => opens.push(mode), ...extra}, options); return {m, opens};
}
async function mountDialog(f, mode = 'create', extra = {}, options = {}) {
  await React.act(async () => assert.equal(f.service.prepareForm(mode), true)); let requests = 0;
  const m = await mount(owners.DirectoryRoomDialog, {service: f.service, open: true, onCloseRequest: () => requests++, ...extra}, options);
  return {m, get requests() {return requests;}};
}
async function click(selector, scope) {await React.act(async () => n(selector, scope).click());}
async function change(selector, value) {const node = n(selector); await React.act(async () => {
  if (node.localName === 'input') Object.getOwnPropertyDescriptor(env.window.HTMLInputElement.prototype, 'value').set.call(node, value); else node.value = value;
  node.dispatchEvent(new env.window.Event(node.localName === 'input' ? 'input' : 'change', {bubbles: true}));
});}
async function submit() {const event = new env.window.Event('submit', {bubbles: true, cancelable: true}); await React.act(async () => n('#roomForm').dispatchEvent(event)); assert.equal(event.defaultPrevented, true);}
function normalize(element) {
  if (element.nodeType === 3) return element.textContent.replace(/\s+/g, ' ').trim() || null;
  if (element.nodeType !== 1) return null;
  const attrs = [...element.attributes].filter(a => !a.name.startsWith('data-i18n') && a.name !== 'open' && !(a.name === 'value' && element.localName === 'input'))
    .map(a => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b));
  const children = []; let text = '';
  const flushText = () => {const value = text.replace(/\s+/g, ' ').trim(); if (value) children.push(value); text = '';};
  for (const child of element.childNodes) {if (child.nodeType === 3) text += child.textContent; else if (child.nodeType === 1) {flushText(); children.push(normalize(child));}}
  flushText(); return [element.localName, attrs, children];
}
function baselineDoc(locale) {
  const doc = new env.window.DOMParser().parseFromString(originalHTML, 'text/html');
  for (const el of all('[data-i18n]', doc)) el.textContent = t(locale, el.dataset.i18n);
  for (const el of all('[data-i18n-aria-label]', doc)) el.setAttribute('aria-label', t(locale, el.dataset.i18nAriaLabel));
  return doc;
}
function expectedRow(snapshot, room, locale, initial = false) {
  const doc = baselineDoc(locale); if (initial) doc.documentElement.setAttribute('data-lobby-boot', ''); else doc.documentElement.removeAttribute('data-lobby-boot');
  return originalRows(doc, n('#roomRowTemplate', doc), new Map(), snapshot.rooms, snapshot.connection, snapshot.mine, snapshot.leaving,
    owners.PRODUCT_GAMES, owners.gameIdForProduct, owners.multiplayerConfigForProduct, () => locale, (key, params) => t(locale, key, params), () => {})(room);
}
function expectedDialog(f, locale) {
  const doc = baselineDoc(locale), form = f.service.getSnapshot().form, create = form.mode === 'create', policy = owners.multiplayerConfigForProduct(form.product);
  const option = (value, text) => {const node = doc.createElement('option'); node.value = String(value); node.textContent = text; return node;};
  n('#gameSelect', doc).replaceChildren(...f.service.getSnapshot().products.map(product => {const game = owners.PRODUCT_GAMES[owners.gameIdForProduct(product)]; return option(product, locale === 'en' ? game.subtitle : game.title);}));
  n('#capacitySelect', doc).replaceChildren(...policy.playerCounts.map(count => option(count, t(locale, 'lobby.playersCount', {count}))));
  n('#difficultySelect', doc).replaceChildren(...policy.difficulties.map((name, index) => option(index, name)));
  n('#dialogTitle', doc).textContent = t(locale, create ? 'lobby.create' : 'lobby.byCode');
  n('#submitRoom', doc).textContent = t(locale, create ? 'lobby.create' : 'lobby.joinRoom');
  n('#createFields', doc).hidden = n('#policyFields', doc).hidden = !create; n('#codeField', doc).hidden = create;
  n('#roomCodeInput', doc).required = !create;
  n('#formNote', doc).textContent = t(locale, create ? form.visibility === 'private' ? 'room.privateHint' : 'lobby.publicRoom' : 'lobby.codeHint');
  return n('#roomDialog', doc);
}

for (const locale of ['zh-CN', 'en']) test(`Rows reproduce executed pinned renderer: ${locale} copy/classes/ARIA/seats/states`, async () => {
  const f = fixture({locale});
  await f.live([room(), room({code: '2345', capacity: 2, seats: [{initial: '魔', online: true, ready: false, controlMode: 'cheat'}, {initial: '咲', ready: true, online: true}], disableCheatMovement: true, challengeMode: true}),
    room({code: '3456', phase: 'playing', difficulty: 4, seats: [null, null, null]})]);
  const snapshot = f.service.getSnapshot();
  await mount(owners.DirectoryRoomRows, {snapshot, service: f.service, assetUrl, initialRows: true}, {locale});
  assert.deepEqual(all('.lobby-room-row').map(normalize), snapshot.visibleRooms.map(row => normalize(expectedRow(snapshot, row, locale, true))));
});
test('Rows preserve keyed identity, failed cover, and creation-time motion suppression across updates/reorder', async () => {
  const f = await fixture().live([room()]); const first = f.service.getSnapshot();
  const m = await mount(owners.DirectoryRoomRows, {snapshot: first, service: f.service, assetUrl: p => `/assets-base/${p}`, initialRows: true});
  const original = n('.lobby-room-row'), cover = n('.lobby-cover img'); assert.equal(cover.getAttribute('src'), '/assets-base/assets/th06-card.webp');
  await React.act(async () => cover.dispatchEvent(new env.window.Event('error'))); assert.equal(cover.hidden, true);
  await f.receive([room({code: '5678'}), room({difficulty: 3})]); await m.update({snapshot: f.service.getSnapshot(), initialRows: false});
  assert.equal(all('.lobby-room-row')[1], original); assert.equal(n('.lobby-cover img', original), cover); assert.equal(cover.hidden, true);
  assert.equal(original.classList.contains('lobby-room-initial'), true); assert.equal(all('.lobby-room-row')[0].classList.contains('lobby-room-initial'), false);
  await f.receive([room({code: '5678'})]); await m.update({snapshot: f.service.getSnapshot()}); assert.equal(original.isConnected, false);
});
test('Rows enforce live/recruiting/joinable/membership/leaving gates and use the latest service room', async () => {
  for (const patch of [{joinable: false}, {phase: 'playing'}, {capacity: 2, seats: [{initial: 'A'}, {initial: 'B'}]}]) {
    const f = await fixture().live([room(patch)]); const m = await mount(owners.DirectoryRoomRows, {snapshot: f.service.getSnapshot(), service: f.service, assetUrl});
    assert.equal(n('.lobby-join').disabled, true); await click('.lobby-join'); assert.equal(f.navigations.length, 0); await m.unmount();
  }
  const f = await fixture().live([room()], {mine: {product: 'th07mp', code: '7777', recoveryToken: 'membership-token'}});
  const m = await mount(owners.DirectoryRoomRows, {snapshot: f.service.getSnapshot(), service: f.service, assetUrl});
  assert.equal(n('.lobby-join').title, ''); assert.equal(n('.lobby-join').disabled, false);
  await f.receive([room()]); await m.update({snapshot: f.service.getSnapshot()}); assert.equal(n('.lobby-join').disabled, false);
  await f.receive([room({joinable: false})]); // Deliberately do not update snapshot: service must reject stale enabled UI.
  await click('.lobby-join'); assert.equal(f.navigations.length, 0);
  await f.receive([room()]); await m.update({snapshot: {...f.service.getSnapshot(), connection: 'offline'}}); assert.equal(n('.lobby-join').disabled, true);
  await m.update({snapshot: {...f.service.getSnapshot(), leaving: true}}); assert.equal(n('.lobby-join').disabled, true);
  await m.update({snapshot: f.service.getSnapshot()}); await click('.lobby-join'); assert.equal(f.navigations.length, 1);
  assert.equal(f.closeCalls, 0); assert.deepEqual(f.sessionWrites, [['clear', 'th06mp']]);
});

for (const locale of ['zh-CN', 'en']) test(`Lobby real loading/live/empty/list conditions and original static sections: ${locale}`, async () => {
  const f = fixture({locale}); const {opens} = await mountLobby(f, {}, {locale});
  assert.equal(n('#roomList').getAttribute('aria-busy'), 'true'); assert.equal(n('#listLoading').hidden, false);
  assert.equal(n('#listHead').hidden, true); assert.equal(env.document.querySelector('#emptyState'), null);
  assert.equal(n('#createButton').disabled, true); assert.equal(n('#codeButton').disabled, true); assert.equal(n('#roomCount').textContent, '');
  await f.live(); assert.equal(n('#roomList').getAttribute('aria-busy'), 'false'); assert.equal(n('#listLoading').hidden, true);
  assert.equal(n('#emptyTitle').textContent, t(locale, 'lobby.empty')); assert.equal(n('#emptyHint').textContent, t(locale, 'lobby.emptyHint'));
  assert.equal(n('#roomCount').textContent, t(locale, 'lobby.roomCount', {count: 0}));
  assert.equal(n('#connectionWarning').hidden, true); assert.equal(env.document.querySelector('#membership'),null);
  const survey = n('#lobbySurvey'), original = n('.lobby-survey-notice a', baselineDoc(locale));
  for (const attr of ['href','target','rel']) assert.equal(survey.getAttribute(attr),original.getAttribute(attr));
  assert.equal(survey.textContent,t(locale,'lobby.surveyAction'));
  assert.equal(env.document.querySelector('.lobby-support-menu'),null);
  assert.deepEqual(all('.lobby-header-actions > *').map(el=>el.id),['lobbyGuideOpen','lobbyNetworkCheck','lobbySurvey','refreshRooms']);
  assert.equal(env.document.querySelector('#emptyAction'), null, 'live empty state leaves creation to the footer action');
  await click('#createButton'); await click('#codeButton'); assert.deepEqual(opens, ['create']); assert.equal(n('#codeButton').getAttribute('aria-expanded'), 'true'); assert.equal(env.document.activeElement, n('#lobbyCodeInput')); assert.equal(env.document.querySelector('.lobby-context'),null);
  assert.equal(n('#refreshRooms').getAttribute('aria-label'), t(locale, 'lobby.refresh'));
  await f.receive([room()], {total: 45}); assert.equal(n('#listHead').hidden, false); assert.equal(env.document.querySelector('#emptyState'), null);
  assert.equal(n('#connectionNote').hidden, false); assert.equal(n('#connectionNote').textContent, t(locale, 'lobby.truncated', {count: 1}));
  assert.equal(n('#roomCount').getAttribute('aria-live'), 'polite'); assert.equal(n('#roomCount').textContent, t(locale, 'lobby.roomCount', {count: 1}));
  await click('#refreshRooms'); assert.equal(n('#roomList').getAttribute('aria-busy'), 'true'); assert.equal(n('#listHead').hidden, true);
  assert.equal(env.document.querySelector('#emptyState'), null); assert.deepEqual(f.socket.sent.at(-1), {type: 'refresh', product: 'th06mp'});
  await f.receive([room()]); assert.equal(n('#connectionNote').hidden, true);
});
for (const [kind, title, hint] of [['offline', 'lobby.offline', 'lobby.refreshHint'], ['missing', 'lobby.offline', 'lobby.noService'], ['unsupported', 'lobby.unsupported', 'lobby.unsupportedHint']]) {
  test(`Lobby real ${kind} warning suppresses empty state and retries through service`, async () => {
    const f = fixture({host: {relay: kind !== 'missing'}, loadError: kind === 'offline'}); await mountLobby(f); await f.start();
    if (kind === 'unsupported') await f.emit('close', {code: 1008});
    assert.equal(f.service.getSnapshot().connection, kind); assert.equal(n('#connectionWarning').hidden, false);
    assert.equal(n('#connectionWarningTitle').textContent, t('en', title)); assert.equal(n('#connectionWarningHint').textContent, t('en', hint));
    assert.equal(n('#connectionWarning').getAttribute('role'), 'alert'); assert.equal(env.document.querySelector('#emptyState'), null);
    assert.equal(n('#createButton').disabled, true); assert.equal(n('#codeButton').disabled, true);
    const before = f.sockets.length; await click('#connectionRefresh'); await flush();
    if (kind === 'unsupported') assert.equal(f.sockets.length, before + 1);
  });
}
test('Lobby failed live connection retains stale room warning, interrupted reconnect, and recovery', async () => {
  const f = await fixture().live([room()]); await mountLobby(f); await f.emit('error');
  assert.equal(n('#connectionWarningTitle').textContent, t('en', 'lobby.disconnected')); assert.equal(n('#connectionWarning').hidden, false);
  assert.equal(n('.lobby-join').disabled, true); assert.equal(env.document.querySelector('#emptyState'), null);
  await click('#connectionRefresh'); assert.equal(f.service.getSnapshot().connection, 'loading'); assert.equal(n('#connectionWarning').hidden, false);
  assert.equal(n('#listLoading').hidden, false); assert.equal(all('.lobby-room-row').length, 0);
  await f.receive(); assert.equal(n('#connectionWarning').hidden, true); assert.ok(n('#emptyState'));
});
for (const locale of ['zh-CN', 'en']) test(`Lobby removes membership banner but keeps return and code-join actions: ${locale}`, async () => {
  const mine = {product:'th06mp',code:'9876',recoveryToken:'fixture-token',host:true};
  const f=await fixture({locale}).live([],{mine});await mountLobby(f,{}, {locale});
  assert.equal(env.document.querySelector('#membership'),null);assert.equal(env.document.querySelector('#releaseMembership'),null);
  assert.equal(n('#createButton').textContent,t(locale,'room.returnRetained'));assert.equal(n('#createButton').disabled,false);
  assert.equal(n('#codeButton').disabled,false);
  await f.emit('error');assert.equal(n('#createButton').disabled,true);assert.equal(n('#codeButton').disabled,true);
});
test('Lobby test-build copy remains inside the room scroller and controls follow service connection',async()=>{
  const mine={product:'th08mp',code:'8888',recoveryToken:'token'};
  const f=await fixture({selectedProduct:'th08mp'}).live([],{mine});await mountLobby(f);
  assert.equal(n('#gameTestNotice').hidden,false);assert.ok(n('#gameTestNotice').closest('.lobby-list-surface'));
  await React.act(async()=>f.service.pageHide());assert.equal(n('#createButton').disabled,true);
});

for (const locale of ['zh-CN', 'en']) for (const mode of ['create', 'join']) test(`Dialog exact original DOM, labels, native selects, focus: ${locale}/${mode}`, async () => {
  const f = await fixture({locale}).live(); await mountDialog(f, mode, {}, {locale});
  assert.deepEqual(normalize(n('#roomDialog')), normalize(expectedDialog(f, locale)));
  assert.equal(n('#roomDialog').open, true); assert.equal(n('#roomDialog').getAttribute('aria-labelledby'), 'dialogTitle');
  assert.deepEqual(all('#roomDialog select').map(s => s.id), ['gameSelect', 'capacitySelect', 'difficultySelect', 'visibilitySelect', 'cheatSelect']);
  assert.equal(all('.mizuki-select, .mizuki-select-menu, [role="combobox"]').length, 0);
  assert.equal(n('#gameSelect').value, 'th06mp'); assert.equal(n('#capacitySelect').value, '2'); assert.equal(n('#difficultySelect').value, '1');
  assert.equal(n('#roomCodeInput').required, mode === 'join'); if (mode === 'join') assert.equal(env.document.activeElement, n('#roomCodeInput'));
  assert.equal(all('#roomDialog input, #roomDialog select').length, 6, 'No extra room-policy fields');
});
test('Dialog retains code/visibility/cheat fields while each open/game change resets capacity and difficulty', async () => {
  const f = await fixture().live(); const {m} = await mountDialog(f);
  await change('#capacitySelect', '3'); await change('#difficultySelect', '4'); await change('#visibilitySelect', 'private'); await change('#cheatSelect', '1'); await change('#roomCodeInput', '456789');
  assert.equal(n('#formNote').textContent, t('en', 'room.privateHint')); assert.equal(f.service.getSnapshot().form.code, '456789');
  await m.update({open: false}); assert.equal(f.closeCalls, 1);
  await React.act(async () => f.service.prepareForm('join')); await m.update({open: true});
  assert.equal(n('#roomCodeInput').value, '456789'); assert.equal(n('#visibilitySelect').value, 'private'); assert.equal(n('#cheatSelect').value, '1');
  assert.equal(n('#capacitySelect').value, '2'); assert.equal(n('#difficultySelect').value, '1');
  await change('#gameSelect', 'th07mp'); assert.equal(all('#difficultySelect option').at(-1).textContent, 'Phantasm');
  await change('#capacitySelect', '3'); await change('#difficultySelect', '5'); await change('#gameSelect', 'th09mp');
  assert.deepEqual(all('#capacitySelect option').map(x => x.value), ['2']); assert.equal(n('#difficultySelect').value, '1');
  assert.equal(n('#roomCodeInput').value, '456789'); assert.equal(n('#visibilitySelect').value, 'private'); assert.equal(n('#cheatSelect').value, '1');
  assert.equal(n('#formNote').textContent, t('en', 'lobby.codeHint'));
});
for (const locale of ['zh-CN', 'en']) test(`Dialog invalid code uses native validity and input clears localized error: ${locale}`, async () => {
  const f = await fixture({locale}).live(); const mounted = await mountDialog(f, 'join', {}, {locale});
  const input = n('#roomCodeInput'); let reports = 0; input.reportValidity = () => {reports++; return false;};
  await change('#roomCodeInput', 'abc'); await submit();
  assert.equal(input.validationMessage, t(locale, 'lobby.invalidCode')); assert.equal(reports, 1); assert.equal(mounted.requests, 0);
  assert.equal(f.closeCalls, 0); assert.equal(f.navigations.length, 0); assert.equal(n('#formError').hidden, true);
  await change('#roomCodeInput', '12345678'); assert.equal(input.validationMessage, ''); await submit();
  assert.equal(mounted.requests, 1); assert.equal(n('#roomDialog').open, true); assert.equal(f.navigations.length, 0);
  await mounted.m.update({open: false}); assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 1); assert.equal(f.navigations[0].dialogOpen, false);
});
test('Dialog unavailable service states disable submit and reject programmatic submit without closing', async () => {
  const f = await fixture().live(); const mounted = await mountDialog(f);
  await f.receive([], {mine: {product: 'th06mp', code: '1234', recoveryToken: 'token'}});
  assert.equal(n('#submitRoom').disabled, true); await submit(); assert.equal(mounted.requests, 0);
  await f.receive(); await f.emit('error'); assert.equal(n('#submitRoom').disabled, true); await submit(); assert.equal(mounted.requests, 0);
  await React.act(async () => f.service.retry()); await f.receive(); assert.equal(n('#submitRoom').disabled, false);
  await React.act(async () => f.service.pageHide()); assert.equal(n('#submitRoom').disabled, true); await submit();
  assert.equal(mounted.requests, 0); assert.equal(f.navigations.length, 0);
});
test('Dialog cancel is prevented; only target dialog with coordinates strictly outside closes', async () => {
  const f = await fixture().live(); const mounted = await mountDialog(f);
  const dialog = n('#roomDialog'); dialog.getBoundingClientRect = () => new env.window.DOMRect(100, 100, 200, 200);
  async function at(target, x, y) {await React.act(async () => target.dispatchEvent(new env.window.MouseEvent('click', {bubbles: true, clientX: x, clientY: y})));}
  for (const [x, y] of [[100, 100], [300, 300], [200, 200]]) await at(dialog, x, y);
  await at(n('#dialogTitle'), 99, 99); assert.equal(mounted.requests, 0);
  for (const [x, y] of [[99, 200], [301, 200], [200, 99], [200, 301]]) await at(dialog, x, y);
  assert.equal(mounted.requests, 4); assert.equal(dialog.open, true); assert.equal(f.closeCalls, 0);
  const cancel = new env.window.Event('cancel', {cancelable: true}); await React.act(async () => dialog.dispatchEvent(cancel));
  assert.equal(cancel.defaultPrevented, true); assert.equal(mounted.requests, 5); await click('#closeDialog'); assert.equal(mounted.requests, 6);
  await mounted.m.update({open: false}); await mounted.m.update({open: false}); assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 0);
});
test('Dialog StrictMode setup/cleanup and full unmount never execute pending entry', async () => {
  const f = await fixture().live(); f.service.prepareForm('create'); assert.equal(f.service.submitForm(), 'close');
  const m = await mount(owners.DirectoryRoomDialog, {service: f.service, open: true, onCloseRequest() {}}, {strict: true});
  assert.equal(n('#roomDialog').open, true); assert.equal(f.closeCalls, 0); assert.equal(f.navigations.length, 0);
  await m.unmount(); assert.equal(f.closeCalls, 0); assert.equal(f.navigations.length, 0); assert.equal(f.sessionWrites.length, 0);
});
test('Dialog controlled close calls formDidClose once, preserves native node, and reopening starts new lifetime', async () => {
  const f = await fixture().live(); const {m} = await mountDialog(f, 'create', {}, {strict: true}); const node = n('#roomDialog');
  await m.update({open: false}); await m.update({open: false}); await m.setLocale('zh-CN'); assert.equal(f.closeCalls, 1); assert.equal(n('#roomDialog'), node);
  await React.act(async () => f.service.prepareForm('join')); await m.update({open: true}); await m.update({open: false}); assert.equal(f.closeCalls, 2);
  assert.equal(f.navigations.length, 0);
});

async function mountRouter(f, {strict = false} = {}) {
  let nav; const locationAtNavigate = [], transitions = [];
  function Carrier() {
    nav = owners.useSurfaceNavigation();
    React.useLayoutEffect(() => {if (nav.directoryFormMode) f.service.restoreFormMode(nav.directoryFormMode);}, [nav.directoryFormMode]);
    return React.createElement(owners.DirectoryRoomDialog, {service: f.service, open: !!nav.directoryFormMode, onCloseRequest: nav.closeDirectoryForm});
  }
  let tree = React.createElement(owners.LocaleProvider, {locale: 'en'}, React.createElement(owners.SurfaceNavigationProvider,
    {dirty: false, isEditing: false, onDiscard() {}}, React.createElement(Carrier)));
  if (strict) tree = React.createElement(React.StrictMode, null, tree);
  const router = createMemoryRouter([{path: '*', element: tree}], {initialEntries: ['/lobby.html?game=th06mp&keep=1#retained']});
  router.subscribe(state => transitions.push({action: state.historyAction, location: state.location}));
  f.onNavigate = () => locationAtNavigate.push(router.state.location);
  const container = env.document.createElement('div'); env.document.body.append(container); const root = createRoot(container);
  const m = {root, router}; mounts.add(m); await React.act(async () => root.render(React.createElement(RouterProvider, {router})));
  return {router, transitions, locationAtNavigate, async open(mode) {await React.act(async () => {assert.equal(f.service.prepareForm(mode), true); nav.openDirectoryForm(mode);});},
    async back() {await React.act(async () => router.navigate(-1));}};
}
for (const mode of ['create', 'join']) test(`Actual navigation owner: ${mode} submit waits for same-URL Router close commit, then enters once`, async () => {
  const f = await fixture().live([room({code: '1023'})]); const h = await mountRouter(f, {strict: true}); const base = h.router.state.location;
  await h.open(mode); const opened = h.router.state.location; assert.notEqual(opened.key, base.key); assert.equal(opened.search, base.search); assert.equal(opened.hash, base.hash);
  assert.equal(n('#roomDialog').open, true); assert.equal(f.closeCalls, 0);
  if (mode === 'join') await change('#roomCodeInput', '5678'); else {await change('#capacitySelect', '3'); await change('#difficultySelect', '4'); await change('#visibilitySelect', 'private'); await change('#cheatSelect', '1');}
  await submit(); await flush();
  assert.equal(h.router.state.location.key, base.key); assert.equal(n('#roomDialog').open, false); assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 1);
  assert.equal(h.locationAtNavigate[0].key, base.key); assert.equal(f.navigations[0].dialogOpen, false);
  assert.deepEqual(f.events, ['formDidClose', 'identity:th06mp', 'navigate']);
  const url = new URL(f.navigations[0].url); assert.equal(url.searchParams.get('keep'), '1'); assert.equal(url.hash, '#retained');
  const invite = owners.decodeRoomInvite(url.searchParams.get(owners.ROOM_INVITE_KEY));
  assert.equal(invite.g, 'th06mp'); assert.equal(invite.r, mode === 'create' ? '1024' : '5678'); assert.equal(invite.a, mode); assert.equal(invite.f, true);
  if (mode === 'create') {assert.equal(invite.p, 3); assert.equal(invite.d, 4); assert.equal(invite.v, 'private'); assert.equal(invite.c, true); assert.equal(f.sessionWrites[0][0], 'save');}
  else assert.deepEqual(f.sessionWrites, [['clear', 'th06mp']]);
  await flush(); assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 1);
});
test('Actual navigation owner Back closes form once without entering a room; Forward restores mode and retained code', async () => {
  const f = await fixture().live(); const h = await mountRouter(f); await h.open('join'); await change('#roomCodeInput', '6789');
  await h.back(); assert.equal(n('#roomDialog').open, false); assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 0);
  await React.act(async () => h.router.navigate(1)); assert.equal(n('#roomDialog').open, true); assert.equal(n('#roomCodeInput').value, '6789');
  await h.back(); assert.equal(f.closeCalls, 2); assert.equal(f.navigations.length, 0);
});
for (const locale of ['zh-CN', 'en']) test(`Every published multiplayer product uses original row metadata and native game policy: ${locale}`, async () => {
  const f = await fixture({locale}).live();
  const rowsMount = await mount(owners.DirectoryRoomRows, {snapshot: f.service.getSnapshot(), service: f.service, assetUrl}, {locale});
  for (const product of f.service.getSnapshot().products) {
    await React.act(async () => f.service.selectProduct(product));
    await f.receive([room({product, capacity: 2, seats: [{initial: 'A', online: false, ready: true}, null]})]);
    await rowsMount.update({snapshot: f.service.getSnapshot()});
    const snapshot = f.service.getSnapshot();
    assert.deepEqual(normalize(n('.lobby-room-row')), normalize(expectedRow(snapshot, snapshot.visibleRooms[0], locale)));
    assert.equal(n('.lobby-seats').classList.contains('has-controls'), false);
  }
  await rowsMount.unmount();
  const {m} = await mountDialog(f, 'create', {}, {locale});
  for (const product of f.service.getSnapshot().products) {
    await change('#gameSelect', product);
    const policy = owners.multiplayerConfigForProduct(product);
    assert.deepEqual(all('#capacitySelect option').map(x => [x.value, x.textContent]), policy.playerCounts.map(count => [String(count), t(locale, 'lobby.playersCount', {count})]));
    assert.deepEqual(all('#difficultySelect option').map(x => [x.value, x.textContent]), policy.difficulties.map((name, index) => [String(index), name]));
  }
  await m.update({open: false});
});
test('No multiplayer products disables create/code/submit while keeping the original native field semantics', async () => {
  const f = await fixture({host: {games: ['th15']}}).live(); await mountLobby(f);
  assert.deepEqual(f.service.getSnapshot().products, []); assert.equal(n('#createButton').disabled, true); assert.equal(n('#codeButton').disabled, true);
  assert.equal(f.service.prepareForm('create'), false);
  await mount(owners.DirectoryRoomDialog, {service: f.service, open: true, onCloseRequest() {assert.fail('Unavailable form must not close');}});
  assert.equal(n('#submitRoom').disabled, true); assert.equal(all('#gameSelect option').length, 0);
  for (const select of all('#roomDialog select')) assert.equal(select.disabled, false, 'Main disables submit, not native form fields');
  await submit(); assert.equal(f.closeCalls, 0); assert.equal(f.navigations.length, 0);
});
test('Repeated submit in one turn issues one actual Router pop and one room entry', async () => {
  const f = await fixture().live(); const h = await mountRouter(f, {strict: true}); const base = h.router.state.location;
  await h.open('create'); h.transitions.length = 0;
  await React.act(async () => {for (let i = 0; i < 2; i++) n('#roomForm').dispatchEvent(new env.window.Event('submit', {bubbles: true, cancelable: true}));});
  assert.equal(h.router.state.location.key, base.key); assert.equal(h.transitions.filter(t => t.action === 'POP').length, 1);
  assert.equal(f.closeCalls, 1); assert.equal(f.navigations.length, 1); assert.equal(f.navigations[0].dialogOpen, false);
});
test('Directory views/service do not introduce a second history owner', () => {
  for (const file of ['DirectoryRoomRows', 'LobbyDirectoryView', 'DirectoryRoomDialog']) {
    const source = readFileSync(resolve(project, `app/components/directory/${file}.tsx`), 'utf8');
    assert.doesNotMatch(source, /\b(?:pushState|replaceState|popstate|history\s*\.|useNavigate|useBlocker)\b/);
  }
  assert.doesNotMatch(readFileSync(resolve(project, 'app/services/lobby-directory.ts'), 'utf8'), /\b(?:pushState|replaceState|popstate|history\s*\.|useNavigate|useBlocker)\b/);
});

for (const parentKey of ['original-parent', null]) test(`Dialog submission completes only its originating return context (parent=${parentKey})`, async () => {
  const f = await fixture().live();
  const completionContext = {locationKey: 'form-entry', parentKey, href: '/lobby.html?game=th06mp'};
  const {m} = await mountDialog(f, 'join', {completionContext}); await change('#roomCodeInput', '1234'); await submit();
  await m.update({open: false, completionContext: {...completionContext, locationKey: parentKey ?? 'replacement-entry'}});
  assert.equal(f.navigations.length, 1); assert.equal(f.navigations[0].dialogOpen, false);
});
for (const parentKey of ['original-parent', null]) test(`Dialog newer destination discards its submission (parent=${parentKey})`, async () => {
  const f = await fixture().live();
  const completionContext = {locationKey: 'form-entry', parentKey, href: '/lobby.html?game=th06mp'};
  const {m} = await mountDialog(f, 'join', {completionContext}); await change('#roomCodeInput', '1234'); await submit();
  await m.update({open: false, completionContext: {...completionContext, locationKey: 'newer-entry', href: '/lobby.html?game=th07mp'}});
  assert.equal(f.navigations.length, 0); assert.equal(f.sessionWrites.length, 0);
  await React.act(async () => {f.service.prepareForm('join'); f.service.updateForm({code: '5678'});});
  await m.update({open: true, completionContext: {locationKey: 'reopened-entry', parentKey: 'newer-entry', href: '/lobby.html?game=th07mp'}});
  await submit(); await m.update({open: false, completionContext: {locationKey: 'newer-entry', parentKey: null, href: '/lobby.html?game=th07mp'}});
  assert.equal(f.navigations.length, 1); assert.equal(owners.decodeRoomInvite(new URL(f.navigations[0].url).searchParams.get('j')).r, '5678');
});
for (const visibility of ['populated', 'empty']) test(`selected-game one-click create uses fresh defaults and retires stale dialog receipts: ${visibility}`, async () => {
  const f = await fixture({selectedProduct: 'th07mp'}).live([room({product: 'th07mp', code: '1023'})]), oldOwner = {};
  f.service.prepareForm('create'); f.service.updateForm({capacity: 3, difficulty: 3, visibility: 'private', disableCheatMovement: true});
  assert.equal(f.service.submitForm(oldOwner), 'close');
  // The populated list checks collisions; the empty case checks the same
  // immediate path when no room for this product is visible.
  const {opens} = await mountLobby(f, {onCreateRoom: () => f.service.createRoom()});
  if (visibility === 'empty') await f.receive([room({product: 'th06mp'})]);
  await click('#createButton');
  assert.deepEqual(opens, []); assert.equal(f.navigations.length, 1); assert.equal(f.closeCalls, 0);
  const invite = owners.decodeRoomInvite(new URL(f.navigations[0].url).searchParams.get('j'));
  assert.equal(invite.g, 'th07mp'); assert.equal(invite.a, 'create'); assert.equal(invite.p, 2); assert.equal(invite.d, 1);
  assert.equal(invite.v, 'public'); assert.equal(invite.c, false);
  assert.equal(invite.r, visibility === 'populated' ? '1024' : '1023');
  assert.equal(f.service.createRoom(), false, 'duplicate create is rejected while leaving');
  f.service.formDidClose(oldOwner); f.service.formDidClose();
  assert.equal(f.navigations.length, 1); assert.equal(f.sessionWrites.length, 1);
});
test('direct creation respects connection, membership, catalog and all-games chooser gates', async () => {
  const offline = fixture(); assert.equal(offline.service.createRoom(), false);
  const allGames = fixture({selectedProduct: ''}); allGames.service.selectProduct(''); await allGames.live(); assert.equal(allGames.service.createRoom(), false);
  assert.equal(allGames.service.prepareForm('create'), true, 'all-games directory can choose a product');
  const member = await fixture().live([], {mine: {product: 'th06mp', code: '1234', recoveryToken: 'owned'}});
  assert.equal(member.service.createRoom(), false);
  const unavailable = await fixture({host: {games: ['th15']}}).live(); assert.equal(unavailable.service.getSnapshot().connection, 'live');
  assert.equal(unavailable.service.createRoom(), false);
  for (const f of [offline, allGames, member, unavailable]) {assert.equal(f.navigations.length, 0); assert.equal(f.sessionWrites.length, 0);}
});
test('A retired dialog receipt cannot consume or discard a later form submission', async () => {
  const f = await fixture().live(), oldOwner = {}, newOwner = {};
  assert.equal(f.service.prepareForm('join'), true); f.service.updateForm({code: '1234'}); assert.equal(f.service.submitForm(oldOwner), 'close');
  assert.equal(f.service.prepareForm('join'), true); f.service.updateForm({code: '5678'}); assert.equal(f.service.submitForm(newOwner), 'close');
  f.service.formDidClose(oldOwner, false); f.service.formDidClose(oldOwner); f.service.formDidClose();
  assert.equal(f.navigations.length, 0); assert.equal(f.sessionWrites.length, 0);
  f.service.formDidClose(newOwner); f.service.formDidClose(newOwner);
  assert.equal(f.navigations.length, 1); assert.equal(owners.decodeRoomInvite(new URL(f.navigations[0].url).searchParams.get('j')).r, '5678');
});
test('Closing a dialog without submission cannot consume another form receipt', async () => {
  const f = await fixture().live(), {m} = await mountDialog(f, 'join'), newOwner = {};
  await React.act(async () => {f.service.updateForm({code: '5678'}); assert.equal(f.service.submitForm(newOwner), 'close');});
  await m.update({open: false}); await m.unmount(); assert.equal(f.navigations.length, 0);
  f.service.formDidClose(newOwner); assert.equal(f.navigations.length, 1);
});
test('Unmount discards only its submitted receipt before a later dialog can close', async () => {
  const f = await fixture().live(), {m} = await mountDialog(f, 'join'); await change('#roomCodeInput', '1234'); await submit();
  await m.unmount(); assert.equal(f.navigations.length, 0); assert.equal(f.sessionWrites.length, 0);
  f.service.formDidClose(); assert.equal(f.navigations.length, 0);
});


test('Redesign directory selects a filter once without opening settings or retaining the removed More menu', async () => {
  const f = await fixture().live([room()]);
  const products = owners.createLibraryProducts(['th06mp', 'th07mp'], assetUrl, id => `lobby.html?game=${id}`);
  const selections = [], activations = [];
  await mountLobby(f, {products, onSelect: id => {selections.push(id); f.service.selectProduct(id);}, onActivate: id => activations.push(id)});
  assert.equal(all('#lobbyGameRail .game[data-game]').length, 2);
  assert.equal(all('.directory-site').length, 1);
  await click('#lobbyGameRail [data-product="th07mp"]');
  assert.deepEqual(selections, ['th07mp']); assert.deepEqual(activations, []);
  assert.equal(n('#lobbyGameRail .selected').dataset.product, 'th07mp');
  assert.equal(env.document.querySelector('#lobbyGameOptions'),null);
  assert.equal(env.document.querySelector('.lobby-support-menu'),null);
  assert.deepEqual(selections, ['th07mp']);
});


test('Site card requests all products before initialization without being normalized back to the first game', async () => {
  const f = fixture(); f.service.selectProduct('');
  await f.live([room(), room({product: 'th07mp', code: '7140'})]);
  assert.equal(f.service.getSnapshot().selectedProduct, '');
  assert.equal(f.service.getSnapshot().visibleRooms.length, 2);
  const products = owners.createLibraryProducts(['th06mp', 'th07mp'], assetUrl, id => `?view=lobby&game=${id}`);
  await mountLobby(f, {products, onSite: () => f.service.selectProduct('')});
  assert.equal(n('.directory-site').getAttribute('aria-current'), 'true');
  assert.equal(all('.lobby-room-row').length, 2);
  await React.act(async () => f.service.selectProduct('th07mp')); await f.receive([room(), room({product: 'th07mp', code: '7140'})]);
  assert.equal(all('.lobby-room-row').length, 1);
  await click('.directory-site'); await f.receive([room(), room({product: 'th07mp', code: '7140'})]);
  assert.equal(f.service.getSnapshot().selectedProduct, ''); assert.equal(all('.lobby-room-row').length, 2);
  assert.ok(n('.lobby-workspace .lobby-room-tools #launcherLink')); assert.ok(n('.site-footer'));
});

for (const locale of ['zh-CN', 'en']) test(`Retained room replaces the primary action without creating or clearing a session: ${locale}`, async () => {
  const mine = {product:'th07mp',code:'4321',clientId:'retained_client',retained:true,recoveryToken:'owned'};
  const f = await fixture({locale,selectedProduct:'th06mp'}).live([], {mine,membershipRecovery:true});
  await mountLobby(f, {}, {locale});
  assert.equal(env.document.querySelector('#membership'),null);
  assert.equal(n('#createButton').textContent,t(locale,'room.returnRetained'));
  assert.equal(n('#createButton').disabled,false);
  assert.equal(n('#codeButton').disabled,false);
  await click('#createButton');
  assert.equal(f.navigations.length,1);
  const invite = JSON.parse(Buffer.from(new URL(f.navigations[0].url).searchParams.get('j'),'base64url').toString());
  assert.equal(invite.g,'th07mp'); assert.equal(invite.r,'4321'); assert.equal(invite.a,'join');
  assert.deepEqual(f.sessionWrites,[]);
  assert.equal(f.service.returnToRoom(),false,'duplicate navigation is rejected');
});


test('inline code disclosure closes outside, preserves arrow submission and cancels a departed lookup', async()=>{
  const f=await fixture({host:{games:['th06','th07']}}).live([], {roomLookup:1}); await mountLobby(f);
  assert.equal(n('#lobbyCodeInput').disabled,true); await click('#codeButton');
  assert.equal(env.document.activeElement,n('#lobbyCodeInput')); assert.equal(env.document.querySelector('#roomDialog'),null);
  await React.act(async()=>n('#lobbyCodeInput').dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'true','Escape is not the dismissal action');
  await React.act(async()=>n('#lobbyCodeSubmit').focus());
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'true','moving to the join arrow stays inside the input area');
  const submitCode=()=>React.act(async()=>n('#lobbyCodeForm').dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true})));
  await change('#lobbyCodeInput','12'); await submitCode();assert.equal(n('#lobbyCodeError').hidden,false);assert.equal(f.navigations.length,0);
  await change('#lobbyCodeInput','4321');assert.equal(n('#lobbyCodeError').hidden,true);await submitCode();
  const first=f.socket.sent.at(-1);assert.equal(first.type,'resolve-room'); assert.equal(n('#createButton').disabled,true);assert.equal(n('#lobbyCodeSubmit').disabled,true);
  const outside=env.document.createElement('button');env.document.body.append(outside);
  await React.act(async()=>{outside.dispatchEvent(new env.window.Event('pointerdown',{bubbles:true}));outside.focus();});
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'false');
  assert.equal(env.document.activeElement,outside,'dismissal leaves focus at the clicked control');
  await f.emit('message',{type:'room-lookup-result',requestId:first.requestId,code:'4321',product:'th07mp',ok:true});assert.equal(f.navigations.length,0);
  await click('#codeButton');await React.act(async()=>n('#lobbyCodeSubmit').focus());await click('#lobbyCodeSubmit');const next=f.socket.sent.at(-1);
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'true','submission stays open while the lookup runs');
  await f.emit('message',{type:'room-lookup-result',requestId:next.requestId,code:'4321',product:'th07mp',ok:true});
  assert.equal(f.navigations.length,1);const invite=JSON.parse(Buffer.from(new URL(f.navigations[0].url).searchParams.get('j'),'base64url'));
  assert.equal(invite.g,'th07mp');assert.equal(invite.r,'4321');assert.equal(invite.a,'join');
});

test('inline code input closes on keyboard focus departure or a non-focusable outside press',async()=>{
  const f=await fixture().live([], {roomLookup:1});await mountLobby(f);
  await click('#codeButton');await React.act(async()=>n('#refreshRooms').focus());
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'false');assert.equal(env.document.activeElement,n('#refreshRooms'));
  await click('#codeButton');
  await React.act(async()=>env.document.body.dispatchEvent(new env.window.Event('pointerdown',{bubbles:true})));
  assert.equal(n('#codeButton').getAttribute('aria-expanded'),'false');assert.equal(n('#lobbyCodeInput').disabled,true);
});
