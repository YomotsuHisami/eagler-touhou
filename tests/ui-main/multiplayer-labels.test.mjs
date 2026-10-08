/** Synthetic SSR localization checks; no browser, live relay or gameplay claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'ui-multiplayer-labels-'));
after(() => rm(folder, {recursive: true, force: true}));
const plugin = {name: 'authored-contracts', setup(builder) {
  // SSR does not mount DOM portals. Render the unchanged room form children
  // through a transparent shell for label/gate checks; CI exercises real Radix.
  builder.onResolve({filter: /^\.\/AnimatedDialog$/}, args => args.importer.split(String.fromCharCode(92)).join('/').endsWith('/MultiplayerRoom.tsx') ? {path: 'room-portal', namespace: 'synthetic-room-portal'} : undefined);
  builder.onLoad({filter: /.*/, namespace: 'synthetic-room-portal'}, () => ({contents: 'export const AnimatedDialog = ({children}) => children;', loader: 'js'}));
  builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path);
    const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
    if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
    const authored = path.replace(/\.mjs$/, '.mts');
    if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
  });
}};
const result = await build({stdin: {contents: `
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server.node';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {LocaleProvider} from './app/components/LocaleProvider';
import {HelpProvider} from './app/components/HelpPanel';
import {LobbyDirectoryView} from './app/components/LobbyDirectory';
import {MultiplayerRoomView} from './app/components/MultiplayerRoom';
export {UI_MESSAGES} from './src/launcher/i18n.mts';
export {multiplayerUiEntries} from './src/launcher/i18n-multiplayer-ui.mts';
export function render(kind, snapshot, locale = 'en') {
  const component = kind === 'directory' ? LobbyDirectoryView : MultiplayerRoomView;
  const element = createElement(LocaleProvider, {initialLocale: locale}, createElement(HelpProvider, null, createElement(component, {controller: {}, snapshot})));
  const router = createMemoryRouter([{path: '*', element}], {initialEntries: [
    '/' + (kind === 'directory' ? 'lobby' : 'play/' + snapshot.route.productId) + '?uiLocale=' + locale
  ]});
  return renderToStaticMarkup(createElement(RouterProvider, {router}));
}`, resolveDir: root, loader: 'tsx'}, bundle: true, jsx: 'automatic', format: 'esm', platform: 'node',
  banner: {js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"},
  write: false, loader: {'.css': 'empty', '.webp': 'dataurl', '.svg': 'dataurl'}, plugins: [plugin]});
const viewPath = join(folder, 'views.mjs');
await writeFile(viewPath, result.outputFiles[0].text);
const {render, UI_MESSAGES, multiplayerUiEntries} = await import(pathToFileURL(viewPath).href);
const seat = (patch = {}) => ({clientId: 'local', name: 'Alice', loadout: 0, ready: false, offline: false,
  resource: {status: 'preparing', percent: 25}, controlMode: 'touch', ...patch});
const room = (patch = {}) => ({playerCount: 2, difficulty: 1, visibility: 'public', disableCheatMovement: true,
  phase: 'lobby', localSeat: 0, seats: [seat(), null], spectators: [{clientId: 'visitor', name: 'Visitor'}], spectatorCount: 1, ...patch});
const roomSnapshot = (patch = {}) => ({sessionSerial: 1, input: {movementMode: 'touch', touchEnabled: true, mobileDevice: true}, route: {productId: 'th08mp', roomCode: '1234'}, connection: 'connected', room: room(),
  clientId: 'local', displayName: 'Alice', nameLocked: false, preferredLoadout: 0, runtimeAvailable: true,
  preparation: {status: 'preparing', stage: 'package', percent: 42}, launch: 'idle',
  peers: [{clientId: 'visitor', seat: 1, metrics: {direct: {state: 'connected', rtt: 25}, turn: {state: 'checking'}, relay: {state: 'unavailable'}}}],
  timingChoice: {inputDelay: 'auto', rollback: false}, measuredTiming: {inputDelay: 3}, pendingAction: null, ...patch});
const listingRoom = (patch = {}) => ({product: 'th08mp', code: '5678', capacity: 2, players: 1, ready: 0,
  difficulty: 1, spectators: 2, phase: 'lobby', joinable: true, seats: [{initial: 'A', online: true, ready: false, controlMode: 'cheat'}, null], disableCheatMovement: true, ...patch});
const directorySnapshot = (patch = {}) => ({active: true, connection: 'live', products: ['th08mp'], selectedProduct: 'th08mp',
  loadedProduct: 'th08mp', rooms: [listingRoom()], total: 9, mine: null, supportsRecovery: true, recovering: false,
  notice: null, error: null, ...patch});
function containsAll(html, phrases) {for (const phrase of phrases) assert.ok(html.includes(phrase), phrase);}

test('multiplayer entries are in both typed catalogs with identical parameter sets', () => {
  const keys = new Set();
  const params = text => [...text.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
  for (const [key, zh, en] of multiplayerUiEntries) {
    assert.ok(!keys.has(key), `duplicate key: ${key}`); keys.add(key);
    assert.equal(UI_MESSAGES['zh-CN'][key], zh, key); assert.equal(UI_MESSAGES.en[key], en, key);
    assert.deepEqual(params(zh), params(en), key);
  }
});

test('both React multiplayer views have no hardcoded Chinese UI labels or default-global translator', async () => {
  for (const file of ['LobbyDirectory.tsx', 'MultiplayerRoom.tsx']) {
    const source = await readFile(join(root, 'app/components', file), 'utf8');
    assert.doesNotMatch(source, /\p{Script=Han}/u, file);
    assert.match(source, /useLocale\(\)/, file);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n/, file);
  }
});

test('English room SSR translates loadouts, controls, timing, status and accessible seats', () => {
  const html = render('room', roomSnapshot());
  containsAll(html, ['Multiplayer room', 'P1 Host', 'Personal settings / Loadout', 'Preparing Game resources 42%',
    'Resources: Preparing 25%', 'Reimu &amp; Yukari', 'Waiting to ready up', 'Unlimited movement disabled',
    'Join P2', 'P2 · Direct 25 ms', 'Measured by Runtime at launch',
    'Runtime-measured input delay for this match: 3 frames', 'Spectators (1)']);
  assert.match(html, /<h1 lang="ja"[^>]*>東方永夜抄<\/h1>/);
  assert.doesNotMatch(html, /ui\.multiplayer\.|联机|房间|准备|机体|输入|复制|观战/);
});

test('Chinese room SSR retains original labels and Japanese game identity', () => {
  const html = render('room', roomSnapshot(), 'zh-CN');
  containsAll(html, ['联机房间', 'P1 房主', '正在准备游戏资源 42%', '资源：准备中 25%',
    '等待准备', '本局 Runtime 实测输入延迟：3 帧', '观战成员（1）']);
  assert.match(html, /<h1 lang="ja"[^>]*>東方永夜抄<\/h1>/);
});

test('room connection, preparation and resource branches use translated labels', () => {
  for (const [connection, expected] of Object.entries({idle: 'Waiting for room', loading: 'Reading configuration',
    connecting: 'Connecting to room', connected: 'Connected', reconnecting: 'Reconnecting', unavailable: 'Connection unavailable'})) {
    assert.ok(render('room', roomSnapshot({connection})).includes(expected), connection);
  }
  for (const [status, expected] of Object.entries({ready: 'Multiplayer resources ready', preparing: 'Preparing Runtime…',
    failed: 'Resource preparation failed', cancelled: 'Resource preparation cancelled'})) {
    assert.ok(render('room', roomSnapshot({preparation: {status, stage: 'runtime', percent: null}})).includes(expected), status);
  }
  for (const [status, expected] of Object.entries({ready: 'Resources: Ready', preparing: 'Resources: Preparing',
    failed: 'Resources: Failed', cancelled: 'Resources: Cancelled', importing: 'Resources: Importing'})) {
    assert.ok(render('room', roomSnapshot({room: room({seats: [seat({resource: {status, percent: null}}), null]})})).includes(expected), status);
  }
  assert.match(render('room', roomSnapshot({preparation: null})), /Prepare resources before you ready up/);
  assert.match(render('room', roomSnapshot({pendingAction: 'set-ready'})), /Waiting for server confirmation…/);
});

test('unavailable Runtime, spectator, offline and ready branches preserve their gates', () => {
  const unavailable = render('room', roomSnapshot({runtimeAvailable: false, preparation: null}));
  assert.match(unavailable, /Multiplayer resource preparation and game launch are not connected yet/);
  assert.match(unavailable, /disabled=""[^>]*>Ready<\/button>/);
  assert.match(unavailable, /<option value="9">9 frames<\/option>/);
  const spectator = render('room', roomSnapshot({room: room({localSeat: null, localSpectator: true,
    visibility: 'private', seats: [seat({offline: true}), null], spectators: [], spectatorCount: 0})}));
  containsAll(spectator, ['Private room', 'Reconnecting', 'Stop spectating', 'Waiting for host', 'No spectators yet']);
  const ready = render('room', roomSnapshot({room: room({seats: [seat({ready: true}), null]})}));
  assert.match(ready, /Cancel ready status/);
  assert.doesNotMatch(unavailable, /<iframe/);
});

test('directory SSR localizes room counts, seats, control badges and both locales', () => {
  const en = render('directory', directorySnapshot());
  containsAll(en, ['Multiplayer', 'Create room', '1 rooms',
    '1 / 2 players, 0 ready, 2 spectators', 'Seat 1: A, Waiting to ready up, Unlimited movement',
    'Seat 2: Empty', 'No limit', 'Showing only the first 1 rooms.']);
  assert.match(en, /<h2 lang="ja"[^>]*>東方永夜抄<\/h2>/);
  assert.doesNotMatch(en, /ui\.multiplayer\.|房间|联机|准备|人数|难度|状态/);
  const zh = render('directory', directorySnapshot(), 'zh-CN');
  containsAll(zh, ['联机', '创建房间', '1 个房间', '座位 1：A，等待准备，无限移动', '当前仅显示前 1 个房间']);
});

test('directory loading, empty, stale, membership and unavailable branches translate', () => {
  assert.match(render('directory', directorySnapshot({connection: 'loading'})), /Connecting and synchronizing rooms…/);
  assert.match(render('directory', directorySnapshot({rooms: []})), /No public rooms right now/);
  assert.match(render('directory', directorySnapshot({connection: 'offline', rooms: []})), /Rooms are temporarily unavailable/);
  for (const [connection, expected] of Object.entries({unsupported: 'Lobby connection is not supported',
    missing: 'Lobby connection is not configured', offline: 'Lobby connection is temporarily unavailable'})) {
    assert.ok(render('directory', directorySnapshot({connection, error: '服务未支持'})).includes(expected), connection);
  }
  const membership = render('directory', directorySnapshot({mine: {product: 'th08mp', code: '1234', recoveryToken: 'token'}, recovering: true}));
  containsAll(membership, ['You are already in room #1234', 'Releasing…']);
  const unsupported = render('directory', directorySnapshot({mine: {product: 'th08mp', code: '1234'}, supportsRecovery: false}));
  assert.match(unsupported, /This server cannot release membership from the lobby/);
  const full = render('directory', directorySnapshot({rooms: [listingRoom({players: 2})]}));
  assert.match(full, /disabled=""[^>]*aria-label="Join [^"]+"[^>]*>Full<\/button>/);
  const playing = render('directory', directorySnapshot({rooms: [listingRoom({phase: 'playing'})]}));
  assert.match(playing, /disabled=""[^>]*aria-label="Join [^"]+"[^>]*>In game<\/button>/);
});

test('raw room and directory diagnostics explicitly retain their original language', () => {
  const roomError = render('room', roomSnapshot({error: '原始服务错误'}));
  assert.match(roomError, /<p lang="zh-CN" role="alert"[^>]*>原始服务错误<\/p>/);
  const roomNotice = render('room', roomSnapshot({notice: '房间通知'}));
  assert.match(roomNotice, /<p lang="zh-CN" role="status"[^>]*>房间通知<\/p>/);
  const directoryError = render('directory', directorySnapshot({connection: 'unsupported', error: '服务未支持'}));
  assert.match(directoryError, /<p lang="zh-CN"[^>]*>服务未支持<\/p>/);
  const directoryNotice = render('directory', directorySnapshot({notice: '房间通知'}));
  assert.match(directoryNotice, /<p lang="zh-CN" role="status"[^>]*>房间通知<\/p>/);
});
