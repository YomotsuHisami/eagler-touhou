import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as catalog from '../src/contracts/product-catalog.mts';
import {normalizeRoomCode} from '../src/launcher/route-state.mts';
import {createMultiplayerRoomSessionStore} from '../src/launcher/multiplayer-room-session.mts';
import {navigationPatterns} from '../scripts/ui-routing.mjs';
import routes from '../app/routes.ts';
import {
  UI_DEPLOYMENT_SCHEMA, UI_LOCALE_QUERY, UI_RESOURCE_PREFIXES,
  createUiDeploymentContract, decodeUiDeploymentPath, isUiDeploymentNavigation,
  resolveLegacyUiEntry, uiNavigationFallback,
} from '../scripts/ui-deployment-contract.mjs';

const patterns = ['/', '/lobby', '/play/:productId', '/play/:productId/resources', '/play/:productId/replays'];
const root = createUiDeploymentContract({patterns});
const mounted = createUiDeploymentContract({patterns, mountPath: '/eagler/'});
const scopeUrl = 'https://play.example.test/';
const resolveLegacy = (input, options = {}) => resolveLegacyUiEntry(input, {
  baseUrl: scopeUrl, catalog, normalizeRoomCode, ...options,
});
const fallback = (path, extra = {}, contract = root, scope = scopeUrl) => uiNavigationFallback({url: path, method: 'GET', accept: 'text/html', ...extra}, {contract, scopeUrl: scope});

function frozenTree(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) if (child && typeof child === 'object') frozenTree(child);
}

test('contract derives from Framework routes and serializes without executable or duplicated game policy', () => {
  const derived = createUiDeploymentContract({patterns: navigationPatterns(routes)});
  assert.equal(derived.schema, UI_DEPLOYMENT_SCHEMA);
  assert.ok(derived.patterns.includes('/play/:productId'));
  assert.ok(derived.patterns.includes('/play/:productId/resources'));
  assert.ok(derived.patterns.includes('/play/:productId/replays'));
  assert.equal(derived.missingAssetPolicy, '404');
  assert.deepEqual(derived.externalResourcePrefixes, ['/games/', '/shared/']);
  assert.equal(isUiDeploymentNavigation('/play/th06', JSON.parse(JSON.stringify(derived))), true);
  assert.equal(JSON.stringify(derived).includes('th06'), false, 'route shape is not a second product catalog');
  frozenTree(derived);
});

test('route patterns are exact, deduplicated and prohibit resource namespace takeover', () => {
  assert.deepEqual(createUiDeploymentContract({patterns: ['/', '/play/:id', '/play/:id']}).patterns, ['/', '/play/:id']);
  for (const pattern of ['/games/:productId', '/games', '/shared/:path', '/runtime/:game', '/assets/:file', '/packages/:id', '/content/:name', '/legacy/:name', '/pwa/:name', '/vendor/:file', '/language-packs/:name', '/*', '/play/*', '/play/:id?', '/play/:', '/play/:id/', '/play//:id', '/play/../', '/missing.js']) {
    assert.throws(() => createUiDeploymentContract({patterns: ['/', pattern]}), /Invalid|reserved|exact/, pattern);
  }
  for (const invalid of [[], ['/play/:id'], null]) assert.throws(() => createUiDeploymentContract({patterns: invalid}), /library root/);
  assert.throws(() => createUiDeploymentContract({patterns, legacyEntries: ['/games/th06']}), /Unsupported legacy/);
  assert.throws(() => isUiDeploymentNavigation('/', {...root, schema: 'wrong'}), /Unsupported UI/);
});

test('mount and path handling reject hidden, traversal and filesystem-like URLs', () => {
  for (const path of ['/../secret', '/play/%2e%2e/', '/%2e/secret', '/.git/config', '/%bad', '/assets/%00', '/assets/%5csecret', 'play/th06']) assert.equal(decodeUiDeploymentPath(path), null, path);
  assert.equal(decodeUiDeploymentPath('//play//th06/?old=1#tail'), '/play/th06');
  for (const mountPath of ['eagler/', '/eagler//', '/eagler/../', '/%65agler/', '/eagler/?x=1']) assert.throws(() => createUiDeploymentContract({patterns, mountPath}), /mount/);
  assert.equal(createUiDeploymentContract({patterns, mountPath: '/eagler'}).mountPath, '/eagler/');
  for (const path of ['/eagler', '/eagler/', '/eagler/play/th06', '/eagler/en.html', '/eagler/lobby']) assert.equal(isUiDeploymentNavigation(path, mounted), true, path);
  for (const path of ['/', '/play/th06', '/eagler-other/play/th06', '/eagler/play/th06/extra', '/eagler/runtime/th06/th06.html']) assert.equal(isUiDeploymentNavigation(path, mounted), false, path);
});

test('HTML fallback accepts only declared route shapes and explicit legacy aliases', () => {
  for (const path of ['/', '/index.html', '/en.html', '/lobby.html', '/lobby', '/play/th06', '/play/th11/replays', '/play/th09mp/resources?x=1#tab']) assert.equal(fallback(path), `${scopeUrl}index.html`, path);
  assert.equal(fallback('/play/th06', {method: 'HEAD'}), `${scopeUrl}index.html`);
  assert.equal(fallback('/play/th06', {accept: '', mode: 'navigate', destination: 'document'}), `${scopeUrl}index.html`);
  assert.equal(fallback('/play/th06', {accept: 'application/xhtml+xml,text/html;q=0.9,*/*;q=0.8'}), `${scopeUrl}index.html`);
  assert.equal(fallback('/play/th06', {accept: 'TEXT/HTML; Q = 0.5'}), `${scopeUrl}index.html`);
  for (const accept of ['', '*/*', 'application/json', 'text/html;q=0', 'text/html;q=0.0,*/*;q=1', 'text/htmljunk', 'application/x-text/html']) assert.equal(fallback('/play/th06', {accept}), null, accept);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal(fallback('/play/th06', {method}), null, method);
  for (const destination of ['script', 'style', 'font', 'image', 'worker', 'serviceworker']) assert.equal(fallback('/play/th06', {destination, mode: 'navigate'}), null, destination);
  assert.equal(fallback('/en.html', {}, createUiDeploymentContract({patterns, legacyEntries: []})), null);
  assert.equal(fallback('/eagler/play/th06', {}, mounted, 'https://play.example.test/eagler/'), 'https://play.example.test/eagler/index.html');
  assert.equal(fallback('/play/th06', {}, mounted, scopeUrl), null, 'scope and declared mount must agree');
});

test('missing asset, metadata, Package and Runtime URLs never become successful shell HTML', () => {
  const missing = ['/assets/missing.js', '/assets/missing.wasm', '/play/missing.js', '/play/th06/missing.wasm', '/host-manifest.json', '/runtime-manifest.json', '/release-catalog.json', '/th06.package.json', '/app-shell-sw.js', '/ui-ownership.json', '/ui-navigation.json', '/games/th06', '/games/th06/resources', '/games/th06/th06.data', '/shared/unifont.otf', '/runtime/th06/th06.html', '/packages/th06.zip', '/unknown', '/play/th06/unknown', '/play/a.b', '/play/a%2eb', '/play/%2e%2e/'];
  for (const path of missing) assert.equal(fallback(path, {mode: 'navigate'}), null, path);
  for (const prefix of UI_RESOURCE_PREFIXES) assert.equal(fallback(prefix + 'missing', {mode: 'navigate'}), null, prefix);
  for (const prefix of root.externalResourcePrefixes) assert.equal(fallback(prefix + 'th06', {mode: 'navigate'}), null, `existing external redirect still owns ${prefix}`);
});

test('SW fallback is origin-scoped and accepts Request-like input without browser globals', () => {
  for (const url of ['https://assets.example.test/play/th06', 'http://play.example.test/play/th06', 'https://user:password@play.example.test/play/th06', 'ftp://play.example.test/play/th06', 'javascript:alert(1)', 'https://play.example.test/play/%2e%2e/']) assert.equal(fallback(url), null, url);
  const request = new Request('https://play.example.test/play/th06', {headers: {'Accept': 'text/html'}});
  assert.equal(uiNavigationFallback(request, {contract: root, scopeUrl}), `${scopeUrl}index.html`);
  assert.equal(fallback('/eagler/play/th06', {}, mounted, 'https://play.example.test/eagler/?bad=1'), null);
  assert.equal(fallback('/eagler/play/th06', {}, mounted, 'https://play.example.test/eagler'), null);
  const tampered = {...root, shellPath: 'https://attacker.example/' };
  assert.equal(fallback('/play/th06', {}, tampered), `${scopeUrl}index.html`, 'deserialized shell key is derived, never trusted');
});

test('legacy root/index/en product selection preserves query/hash without auto-start or history writes', () => {
  for (const entry of ['/', '/index.html', '/en.html']) {
    const result = resolveLegacy(`${entry}?game=th11&keep=1&keep=2#controls`);
    const target = new URL(result.href);
    assert.equal(result.kind, 'product'); assert.equal(result.productId, 'th11');
    assert.equal(target.pathname, '/play/th11'); assert.deepEqual(target.searchParams.getAll('keep'), ['1', '2']);
    assert.equal(target.searchParams.has('game'), false); assert.equal(target.hash, '#controls');
    assert.equal(result.autoLaunch, false); assert.equal(result.replace, true);
    assert.equal(result.locale, entry === '/en.html' ? 'en' : 'zh-CN');
    assert.equal(target.searchParams.get(UI_LOCALE_QUERY), entry === '/en.html' ? 'en' : null);
    frozenTree(result);
  }
  assert.equal(resolveLegacy('/en.html?uiLocale=zh-CN').locale, 'en', 'explicit English entry wins');
  assert.equal(resolveLegacy('/?uiLocale=en').locale, 'en');
  assert.equal(resolveLegacy('/?game=th06&lobbyOptions=1&lobbyOptionsRequest=old').kind, 'product', 'old embed hints cannot create another iframe');
});

test('catalog remains the authority for every enabled product and hidden/invalid selections', () => {
  for (const id of catalog.PRODUCT_IDS.filter(id => catalog.productEnabledForBuild(id, false))) {
    const result = resolveLegacy(`/?game=${id}`);
    assert.equal(result.productId, id); assert.equal(new URL(result.href).pathname, `/play/${id}`);
  }
  for (const id of ['th20', 'not-a-product', '../../assets', '']) {
    const result = resolveLegacy(`/?game=${encodeURIComponent(id)}&keep=1`);
    assert.equal(result.kind, 'library'); assert.equal(result.to, '/?keep=1');
  }
  assert.equal(resolveLegacy('/?game=th20', {testBuild: true}).kind, 'library', 'hidden is not testOnly');
  assert.equal(resolveLegacy('/play/th06?game=th07'), null, 'canonical navigation is idempotent');
  assert.equal(resolveLegacy('/games/th06?game=th07'), null, 'resource paths are never legacy UI aliases');
  assert.equal(resolveLegacy('https://other.example/en.html?game=th06'), null);
});

test('directory links keep a valid MP filter and do not derive a room or launch', () => {
  const good = resolveLegacy('/lobby.html?game=th09mp&keep=1#room');
  assert.equal(good.kind, 'lobby'); assert.equal(good.to, '/lobby?game=th09mp&keep=1#room');
  assert.equal(good.autoLaunch, false); assert.equal(good.productId, 'th09mp');
  for (const id of ['th06', 'th20', 'invalid']) assert.equal(resolveLegacy(`/lobby.html?game=${id}`).to, '/lobby');
  assert.equal(resolveLegacy('/lobby.html?game=th06mp&mpRoom=1234').kind, 'lobby', 'directory document does not consume launcher room hints');
});

test('direct room links use canonical room policy and never trust redundant room alone', () => {
  const result = resolveLegacy('/?game=th09mp&mpRoom=12-34abc567890&room=9999&keep=1#panel');
  assert.equal(result.kind, 'room'); assert.equal(result.productId, 'th09mp');
  assert.equal(result.room.code, '12345678'); assert.equal(result.returnToDirectory, false);
  assert.equal(result.room.playerCount, 2); assert.equal(result.room.difficulty, 1); assert.equal(result.room.seat, null);
  assert.equal(result.autoSeat, false); assert.equal(result.directoryAction, null); assert.equal(result.autoLaunch, false);
  const target = new URL(result.href);
  assert.equal(target.pathname, '/play/th09mp'); assert.equal(target.searchParams.get('mpRoom'), '12345678');
  assert.equal(target.searchParams.get('room'), '9999'); assert.equal(target.hash, '#panel');
  for (const game of ['th06', 'invalid', 'th20', '']) assert.equal(resolveLegacy(`/?game=${game}&mpRoom=1234`).productId, catalog.DEFAULT_MULTIPLAYER_PRODUCT_ID);
  assert.equal(resolveLegacy('/?game=th06mp&room=1234').kind, 'product', 'room alias alone was not the old restorer authority');
  assert.equal(resolveLegacy('/?game=th06mp&mpRoom=abc').kind, 'product');
  frozenTree(result);
});

test('directory create and join hints preserve limits, transient fields and return origin', () => {
  const created = resolveLegacy('/?game=th09mp&mpRoom=1234&fromLobby=1&lobbyAction=create&lobbyPlayers=3&lobbyDifficulty=99&lobbyVisibility=private&lobbyDisableCheatMovement=1');
  assert.deepEqual(created.room, {code:'1234', playerCount:2, difficulty:3, created:true, visibility:'private', disableCheatMovement:true, seat:0, ready:false, spectatorRequested:false, roomSettingsOpen:false});
  assert.equal(created.returnToDirectory, true); assert.equal(created.directoryAction, 'create'); assert.equal(created.autoSeat, false);
  const params = new URL(created.href).searchParams;
  for (const key of ['lobbyAction', 'lobbyPlayers', 'lobbyDifficulty', 'lobbyVisibility', 'lobbyDisableCheatMovement']) assert.equal(params.has(key), true, 'only room join acknowledgment can clear ' + key);
  const joining = resolveLegacy('/?game=th08mp&mpRoom=4321&fromLobby=1&lobbyAction=join&lobbyPlayers=3&lobbyDifficulty=4');
  assert.equal(joining.autoSeat, true); assert.equal(joining.room.seat, null); assert.equal(joining.room.playerCount, 2); assert.equal(joining.room.difficulty, 1);
  const direct = resolveLegacy('/?game=th08mp&mpRoom=4321&lobbyAction=create&lobbyPlayers=3');
  assert.equal(direct.directoryAction, null); assert.equal(direct.room.created, false); assert.equal(direct.room.seat, null);
});

test('normalized matching saved room state outranks requested room setup, other sessions do not', () => {
  const entries = new Map(), storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key)};
  const sessions = createMultiplayerRoomSessionStore({storage});
  sessions.save('th08mp', {room:{code:'1234', playerCount:3, difficulty:2, created:false, visibility:'public', disableCheatMovement:false}, seat:1, ready:true, spectatorRequested:false, roomSettingsOpen:true});
  const policy = catalog.multiplayerConfigForProduct('th08mp');
  const savedRoom = sessions.load({product:'th08mp', roomCode:'1234', playerCounts:policy.playerCounts, difficulties:policy.difficulties});
  const input = '/?game=th08mp&mpRoom=1234&fromLobby=1&lobbyAction=create&lobbyPlayers=2&lobbyDifficulty=4&lobbyVisibility=private&lobbyDisableCheatMovement=1';
  const restored = resolveLegacy(input, {savedRoom});
  assert.deepEqual(restored.room, {code:'1234', playerCount:3, difficulty:2, created:true, visibility:'public', disableCheatMovement:false, seat:1, ready:true, spectatorRequested:false, roomSettingsOpen:true});
  assert.equal(resolveLegacy(input, {savedRoom:{...savedRoom, product:'th07mp'}}).room.playerCount, 2);
  assert.equal(resolveLegacy(input, {savedRoom:{...savedRoom, room:{...savedRoom.room, code:'9876'}}}).room.difficulty, 4);
});

test('legacy adapters honor nested mount and preserve explicit English identity', () => {
  const baseUrl = 'https://play.example.test/eagler/';
  const result = resolveLegacy('/eagler/en.html?game=th11&keep=yes#settings', {baseUrl});
  assert.equal(result.to, '/eagler/play/th11?keep=yes&uiLocale=en#settings');
  assert.equal(resolveLegacy('/eagler/lobby.html?game=th10mp', {baseUrl}).to, '/eagler/lobby?game=th10mp');
  assert.equal(resolveLegacy('/en.html?game=th11', {baseUrl}), null);
  assert.equal(resolveLegacy('/eagler-other/en.html?game=th11', {baseUrl}), null);
});

test('module is inert deployment support, with no Node/DOM/global history or SW registration owner', async () => {
  const source = await readFile(new URL('../scripts/ui-deployment-contract.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s|\bfetch\s*\(|\b(?:window|document|history|navigator|caches|indexedDB)\s*\.|\.register\s*\(|\.addEventListener\s*\(/);
  assert.throws(() => resolveLegacyUiEntry('/', {baseUrl:scopeUrl}), /policy owners/);
});
