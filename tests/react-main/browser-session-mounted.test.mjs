import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Actual BrowserLauncher -> BrowserSession -> canonical owners under synthetic
 * DOM/Memory Router (opt-in jsdom BrowserRouter)/native-message/network/storage edges. No browser, engine,
 * rendering, real transport or durable IndexedDB acceptance is claimed.
 * Main authorities: app.mts4114–4289 (Start order), 3033–3063 (input),
 * 6220–6440/6850–6889 (files), 8531/8638 (same-product settings lifetime),
 * runtime-session and launcher-lifecycle. All original main tests are retained.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, transformSync} from 'esbuild';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {Blob as NativeBlob, File as NativeFile} from 'node:buffer';
import {createHash} from 'node:crypto';
import {zipSync, strToU8} from 'fflate';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, hydrateRoot, renderToString, createMemoryRouter, createBrowserRouter, RouterProvider, mounted;
const originals = new Map(), nativeWindows = new WeakMap();
const originalWarn = console.warn;
function expose(key, value) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
before(async () => {
  env = installMountedDom();
  console.warn = (...args) => {mounted?.warnings.push({message: args.map(String).join(' '), stack: new Error().stack}); originalWarn(...args);};
  expose('location', env.window.location); expose('screen', env.window.screen); expose('Blob', NativeBlob); expose('File', NativeFile);
  Object.defineProperty(env.window.navigator, 'maxTouchPoints', {configurable: true, value: 0});
  env.window.HTMLImageElement.prototype.decode = async function () {};
  env.window.HTMLElement.prototype.scrollIntoView = function () {};
  env.window.scrollTo = options => mounted?.scrolls.push(options);
  const anchorClick = env.window.HTMLAnchorElement.prototype.click;
  env.window.HTMLAnchorElement.prototype.click = function () {if (this.download) {mounted.downloads.push({name: this.download, url: this.href}); return;} anchorClick.call(this);};
  env.window.HTMLElement.prototype.requestFullscreen = async function () {
    mounted.order.push('fullscreen-enter'); mounted.fullscreen = this;
    env.document.dispatchEvent(new env.window.Event('fullscreenchange'));
    if (mounted.fullscreenReady) await mounted.fullscreenReady;
  };
  Object.defineProperty(env.document, 'fullscreenElement', {configurable: true, get: () => mounted?.fullscreen ?? null});
  env.document.exitFullscreen = async () => {mounted.order.push('fullscreen-exit'); mounted.fullscreen = null; env.document.dispatchEvent(new env.window.Event('fullscreenchange'));};
  Object.defineProperty(env.window.HTMLIFrameElement.prototype, 'contentWindow', {configurable: true, get() {
    if (!nativeWindows.has(this)) nativeWindows.set(this, createNativeEndpoint(this));
    return nativeWindows.get(this);
  }});
  React = await import('react'); ({createRoot, hydrateRoot} = await import('react-dom/client')); ({renderToString} = await import('react-dom/server'));
  ({createMemoryRouter, createBrowserRouter, RouterProvider} = await import('react-router'));
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-browser-session-'));
  const outfile = resolve(work, 'actual-browser-entry.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {BrowserLauncher} from './app/BrowserLauncher.tsx';
    export {getTestSession} from 'captured-browser-session';
    export {getAcquisitionOptions} from 'captured-acquisition';
    export {setPackageReadGate} from 'gated-package-read';
    export {validateHostManifest} from './src/contracts/host-manifest.mts';
    export {PRODUCT_GAMES, multiplayerConfigForProduct} from './src/contracts/product-catalog.mts';
    export {encodeRoomInvite} from './src/launcher/room-invite.mts';
    export {validateReleaseCatalog} from './src/contracts/release-catalog.mts';
    export {readCurrentPackageGeneration} from './package/package-store.mjs';
    export {parsePackageZip} from './package/package-zip.mjs';
    export {installParsedPackageZip} from './package/package-installer.mjs';
    export {resolveRoomInvite} from './src/launcher/route-state.mts';
    export {gamePreferenceStorageKey, languagePreferenceStorageKey, sharedTouchPreferenceStorageKey} from './src/launcher/game-preferences.mts';
    export {touchLayoutStorageKey} from './src/launcher/touch-layout-model.mts';
    export {RUNTIME_EPOCH_QUERY_PARAMETER} from './src/contracts/runtime-protocol.mts';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    plugins: [{name: 'native-acquisition-scheduling', setup(ctx) {
      // Test-only references and a storage-read scheduling edge. Both wrappers
      // delegate to the authored owners; no preparation/queue policy is replaced.
      ctx.onResolve({filter: /^(captured-browser-session|gated-package-read|captured-acquisition)$/}, args => ({path: args.path, namespace: 'session-edge'}));
      ctx.onResolve({filter: /session\/browser-session$/}, args => args.importer.replaceAll('\\', '/').endsWith('/app/BrowserLauncher.tsx') ? {path: 'captured-browser-session', namespace: 'session-edge'} : undefined);
      ctx.onResolve({filter: /package-store\.mjs$/}, args => args.importer.replaceAll('\\', '/').endsWith('/app/services/package-acquisition.ts') ? {path: 'gated-package-read', namespace: 'session-edge'} : undefined);
      ctx.onResolve({filter: /services\/package-acquisition$/}, args => args.importer.replaceAll('\\', '/').endsWith('/app/session/browser-session.ts') ? {path:'captured-acquisition', namespace:'session-edge'} : undefined);
      ctx.onLoad({filter: /.*/, namespace: 'session-edge'}, args => ({loader: 'ts', resolveDir: project, contents: args.path === 'captured-browser-session' ? `
        import {createBrowserSession as create} from './app/session/browser-session.ts';
        let session; export const getTestSession = () => session;
        export function createBrowserSession(options) {return session = create(options);}
      ` : args.path === 'captured-acquisition' ? `
        import {createPackageAcquisition as create} from './app/services/package-acquisition.ts';
        let options; export const getAcquisitionOptions = () => options;
        export function createPackageAcquisition(value) {options = value; return create(value);}
      ` : `
        import {readCurrentPackageGeneration as readCurrent} from './package/package-store.mjs';
        let gate; export function setPackageReadGate(value) {gate = value;}
        export function readCurrentPackageGeneration(game) {const wait = gate?.(game); return wait ? Promise.resolve(wait).then(() => readCurrent(game)) : readCurrent(game);}
      `}));
    }}, authoredSourcesPlugin(project)],
  });
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  api?.setPackageReadGate(null);
  if (mounted?.root) {
    const current = mounted;
    await React.act(async () => {current.root.unmount(); current.releaseHost?.(); current.releaseFirstUse?.(); await Promise.resolve();});
    current.router.dispose();
    assert.equal(env.document.querySelectorAll('#gameFrame').length, 0);
    assert.equal(env.window.__eaglerPrepareManagedRuntimeDataV1, undefined, 'unmounted actual session releases its sole managed DATA host callback');
    assert.deepEqual(env.errors, [], 'actual BrowserLauncher emits no uncaught DOM/React errors');
  }
  mounted = null; env.document.body.replaceChildren();
});
after(async () => {
  console.warn = originalWarn;
  for (const [key, descriptor] of originals) {if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];}
  env?.close(); if (work) await rm(work, {recursive: true, force: true});
});
class MemoryStorage {
  values = new Map(); writes = []; removals = []; blocked = false;
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.writes.push([key, String(value)]); if (this.blocked) throw new Error('Synthetic blocked storage'); this.values.set(key, String(value));}
  removeItem(key) {this.removals.push(key); if (this.blocked) throw new Error('Synthetic blocked storage'); this.values.delete(key);}
}
/** Native transport edge only. The actual room owner parses/normalizes every
 * message and owns membership, preparation, persistence and leave semantics. */
function installSocketBoundary(enabled, directoryTransport = false) {
  class Socket extends env.window.EventTarget {
    readyState = 0; sent = []; closes = [];
    constructor(url) {
      super(); this.url = String(url);
      assert.equal(enabled, true, 'Unexpected WebSocket construction in this fixture');
      const target = new URL(this.url);
      assert.equal(target.hostname, 'relay.invalid'); assert.ok(target.searchParams.get('lobby') || directoryTransport && target.searchParams.get('directory') === '1', 'only the opted-in actual room/directory transport is accepted');
      mounted.sockets.push(this);
    }
    open() {this.readyState = 1; this.dispatchEvent(new env.window.Event('open'));}
    message(value) {this.dispatchEvent(new env.window.MessageEvent('message', {data: JSON.stringify(value)}));}
    send(value) {assert.equal(this.readyState, 1); this.sent.push(JSON.parse(value));}
    close(code = 1000, reason = '') {this.closes.push({code, reason}); this.readyState = 3; this.dispatchEvent(new env.window.CloseEvent('close', {code, reason}));}
  }
  env.window.WebSocket = Socket; expose('WebSocket', Socket);
}
function createNativeEndpoint(frame) {
  const owner = mounted, native = new env.window.EventTarget();
  native.HTMLIFrameElement = env.window.HTMLIFrameElement;
  native.document = env.document.implementation.createHTMLDocument('Synthetic native Runtime');
  native.focus = () => owner.order.push('native-focus');
  native.Module = {}; native.FS = {mkdirTree() {}, writeFile(path, bytes) {owner.nativeWrites.push({path, bytes: [...bytes]});}};
  native.location = {href: 'about:blank', replace(url) {
    owner.order.push(url === 'about:blank' ? 'native-retired' : 'native-navigation');
    owner.navigations.push(url); this.href = url;
    native.document = env.document.implementation.createHTMLDocument('Synthetic native Runtime');
    if (url !== 'about:blank') {
      const parsed = new URL(url); native.envelope = {protocol: 'eagler-touhou/1', game: parsed.pathname.match(/th\d{2}/)?.[0], epoch: Number(parsed.searchParams.get(api.RUNTIME_EPOCH_QUERY_PARAMETER))};
      if (owner.autoReady) queueMicrotask(async () => {
        if (parsed.searchParams.get('managedData') === '1') {
          const data = await env.window.__eaglerPrepareManagedRuntimeDataV1({game: native.envelope.game, generation: parsed.searchParams.get('gameGeneration'), epoch: native.envelope.epoch});
          owner.dataReads.push([...new Uint8Array(data.buffer)]);
        }
        native.emit('ready');
      });
    }
  }};
  native.emit = (event, extra = {}) => {
    const message = new env.window.Event('message');
    Object.defineProperties(message, {origin: {value: env.window.location.origin}, source: {value: native}, data: {value: {...native.envelope, event, ...extra}}});
    env.window.dispatchEvent(message);
  };
  native.respond = (message, values = {}) => {
    const event = new env.window.Event('message');
    Object.defineProperties(event, {origin: {value: env.window.location.origin}, source: {value: native}, data: {value: {protocol: message.protocol, game: message.game, epoch: message.epoch, request: message.request, ok: true, ...values}}});
    env.window.dispatchEvent(event);
  };
  native.postMessage = (message, target) => {
    assert.equal(target, env.window.location.origin);
    owner.outbound.push(message); owner.order.push(message.command);
    if (!message.request) return;
    if (message.command === 'sync' && owner.syncMode === 'hold') {owner.pendingSync.push(message); return;}
    if (message.command === 'write' && owner.writeMode === 'hold') {owner.pendingWrite.push(message); return;}
    if (message.command === 'list' && owner.holdImportedList && owner.storedFiles.size) {owner.pendingList.push(message); return;}
    if (message.command === 'write' && owner.writeMode !== 'fail') owner.storedFiles.set(message.path, [...message.bytes]);
    const response = message.command === 'configure' && owner.failConfigure ? {ok: false, error: 'Synthetic native configure failure'}
      : message.command === 'sync' && owner.syncMode === 'fail' ? {ok: false, error: 'Synthetic native sync failure'}
      : message.command === 'write' && owner.writeMode === 'fail' ? {ok: false, error: 'Synthetic native write failure'}
      : message.command === 'read' ? {bytes: owner.corruptRead ? [255] : owner.storedFiles.get(message.path) ?? [3, 4, 5]}
      : message.command === 'list' ? {files: [...owner.storedFiles].map(([path, bytes]) => ({path, size: bytes.length}))} : {};
    queueMicrotask(() => native.respond(message, response));
  };
  owner.native = native; owner.frame = frame; return native;
}
function hostManifest(mode = 'hosted') {
  const hash = createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex');
  return {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-validation-test',
    shared: mode === 'import' ? {resourceMode: mode} : {resourceMode: mode, vanillaFont: 'msgothic.ttc', unicodeFont: 'unifont.otf'},
    games: {th06: {runtime: 'runtime/th06/th06.html', multiplayerRuntime: 'runtime/th06mp/th06.html',
      gameData: {path: 'th06.data', bytes: 3, sha256: hash, version: `sha256-${hash}`, layout: `sha256-${'b'.repeat(64)}`},
      ...(mode === 'import' ? {offlineCompatibility: {schema: 'eagler-touhou/offline-game-pack/1', runtimeCompatibility: {protocol: 'eagler-touhou/1', dataLayout: `sha256-${'b'.repeat(64)}`, versionSource: 'offline-pack'}, requiredShared: ['/msgothic.ttc', '/unifont.otf'], languages: {source: 'offline-pack', baseline: ['ja']}}} : {}),
      languages: [], languageOptions: [{id: 'ja', title: '日本語', pack: null}], music: {midi: {files: []}}}}};
}
async function mountBrowser({initial = '/?game=th06&keep=a%20b', autoReady = true, strictMode = false, blockStorage = false, resourceMode = 'hosted', noticeEnabled = false,
  hydrate = false, host = hostManifest(resourceMode), holdHost = false, holdFirstUse = false, seedStorage = () => {}, seedPackages = [], socketBoundary = false, directoryTransport = false, actualHistory = false, fetchBoundary = () => null} = {}) {
  api.validateHostManifest(host); api.validateReleaseCatalog({schema: 'eagler-touhou/release-catalog/1', games: {}});
  env.errors.length = 0; env.window.history.replaceState(null, '', initial);
  const storage = new MemoryStorage(), sessionStorage = new MemoryStorage();
  storage.values.set('eagler-touhou-first-use-notice-seen-v1', '1');
  storage.values.set('eagler-touhou-site-notice-enabled-v1', noticeEnabled ? '1' : '0');
  storage.values.set('eagler-touhou-less-motion-v1', '1');
  storage.values.set('browser-warning-dismissed', '1');
  storage.values.set('eagler-touch-help-seen-v8', '1');
  storage.values.set(api.gamePreferenceStorageKey('th06'), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  seedStorage(storage, sessionStorage);
  storage.blocked = blockStorage;
  Object.defineProperty(env.window, 'localStorage', {configurable: true, value: storage}); expose('localStorage', storage);
  Object.defineProperty(env.window, 'sessionStorage', {configurable: true, value: sessionStorage}); expose('sessionStorage', sessionStorage);
  const idb = new IDBFactory(); expose('IDBKeyRange', IDBKeyRange); Object.defineProperty(env.window, 'indexedDB', {configurable: true, value: idb}); expose('indexedDB', idb);
  for (const game of seedPackages) await api.installParsedPackageZip(await api.parsePackageZip(importPackageFile(game)));
  installSocketBoundary(socketBoundary, directoryTransport);
  const fetches = [], order = [];
  let releaseHost;
  const hostReady = holdHost ? new Promise(resolve => {releaseHost = resolve;}) : Promise.resolve();
  let releaseFirstUse;
  const firstUseReady = holdFirstUse ? new Promise(resolve => {releaseFirstUse = resolve;}) : Promise.resolve();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input), env.window.location.href); fetches.push({url: url.href, init});
    const handled = fetchBoundary(url, init); if (handled) return handled;
    if (url.pathname.endsWith('/host-manifest.json')) {
      // The document Launcher starts first; the independent directory request
      // can finish while its metadata response is still outstanding.
      if (holdHost !== 'launcher' || fetches.filter(item => new URL(item.url).pathname.endsWith('/host-manifest.json')).length === 1) await hostReady;
      return Response.json(host);
    }
    if (url.pathname.endsWith('/release-catalog.json')) return Response.json({schema: 'eagler-touhou/release-catalog/1', games: {}});
    if (url.pathname.endsWith('/NOTICE.txt')) return new Response('');
    if (url.pathname.endsWith('/content/FIRST_USE_NOTICE.html')) {await firstUseReady; return new Response(await readFile(resolve(project, 'public/content/FIRST_USE_NOTICE.html'), 'utf8'));}
    if (url.pathname.endsWith('/content/MULTIPLAYER.html')) return new Response(await readFile(resolve(project, 'public/content/MULTIPLAYER.html'), 'utf8'));
    throw new Error(`Unexpected fixture network ${url.pathname}`);
  };
  env.window.fetch = fetchImpl; expose('fetch', fetchImpl);
  // Original public/index.html bootstrap mark semantics; this fixture does not
  // emulate its critical-visual/preload rendering or emergency UI.
  const boot = {done: false, stage: 'fixture',
    mark(stage) {if (boot.done) return; boot.stage = String(stage || boot.stage);},
    ready() {boot.done = true; order.push('boot-ready');},
    fail() {assert.fail('Original bootstrap failure is unexpected');}};
  env.window.__eaglerBoot = boot;
  mounted = {storage, sessionStorage, sockets: [], scrolls: [], order, fetches, releaseHost, releaseFirstUse, autoReady, syncMode: 'auto', pendingSync: [], writeMode: 'auto', pendingWrite: [], pendingList: [], holdImportedList: false, storedFiles: new Map(), corruptRead: false, outbound: [], navigations: [], nativeWrites: [], dataReads: [], downloads: [], fullscreen: null, routeEvents: [], warnings: []};
  const element = React.createElement(api.BrowserLauncher);
  const routes = [{path: '*', element: strictMode ? React.createElement(React.StrictMode, null, element) : element}];
  // Opt-in address integration for actual directory→room navigation. The
  // production session reads window.location after a committed Router change.
  const router = actualHistory ? createBrowserRouter(routes, {window: env.window})
    : createMemoryRouter(routes, {initialEntries: ['/?keep=a%20b', initial]});
  router.subscribe(state => mounted.routeEvents.push({action: state.historyAction, location: state.location}));
  const container = env.document.createElement('div'); env.document.body.append(container);
  const tree = React.createElement(RouterProvider, {router});
  let root;
  if (hydrate) {
    container.innerHTML = renderToString(tree);
    mounted.initialNodes = [...container.querySelectorAll('[id]')];
    assert.ok(container.querySelector('.game[data-game=th08]'), 'actual SSR entry retains original cards before hydration');
    assert.equal(container.querySelector('iframe'), null, 'initial presentation owns no Runtime');
    Object.assign(mounted, {router});
    await React.act(async () => {root = hydrateRoot(container, tree); mounted.root = root;});
  } else {
    root = createRoot(container); Object.assign(mounted, {root, router});
    await React.act(async () => {root.render(tree);});
  }
  await until(() => env.document.querySelector('#gameFrame') && (holdHost || (actualHistory && initial.startsWith('/lobby') ? api.getTestSession()?.directory.getSnapshot().initialized : mounted.order.includes('boot-ready'))), 'actual browser entry initialized');
  mounted.initialRouteCount = mounted.routeEvents.length;
  return mounted;
}
function node(selector) {const value = env.document.querySelector(selector); assert.ok(value, `Actual node missing: ${selector}`); return value;}
function playerOpen() {return env.document.querySelector('#player')?.getAttribute('aria-hidden') === 'false';}
function commands() {return mounted.outbound.map(value => value.command);}
function currentUrl() {const loc = mounted.router.state.location; return loc.pathname + loc.search + loc.hash;}
async function tick() {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 20));});}
async function until(predicate, message) {const deadline = Date.now() + 2500; while (!predicate() && Date.now() < deadline) await tick(); assert.ok(predicate(), `${message}; evidence=${JSON.stringify({url: currentUrl(), playerOpen: playerOpen(), routerState: mounted.router.state.location.state, order: mounted.order, fetches: mounted.fetches.map(x => x.url), status: env.document.querySelector('#status')?.textContent, startup: env.document.querySelector('#startupError')?.textContent, body: env.document.body.textContent.slice(-1600)})}`);}
async function click(selector) {await React.act(async () => {node(selector).click();}); await tick();}
async function back() {await React.act(async () => {void mounted.router.navigate(-1);}); await tick();}
async function start() {
  await click('#launch');
  assert.equal(node('#decisionDialog').open, true, 'main no-music warning gates launch');
  assert.equal(playerOpen(), false, 'Player stays closed before original input/music confirmation');
  await click('#decisionConfirm');
}

for (const exitStatus of ['success', 'error']) test(`actual BrowserLauncher: original warning, fullscreen, ready/configure/ACK launch and native ${exitStatus} Exit preserve one frame`, async () => {
  const f = await mountBrowser(), frame = node('#gameFrame'), before = currentUrl();
  await start(); await until(() => commands().includes('launch'), 'actual Runtime issues launch');
  assert.equal(playerOpen(), true); assert.equal(node('#gameFrame'), frame); assert.equal(env.document.querySelectorAll('iframe').length, 1);
  assert.equal(currentUrl(), before, 'Start reuses the selected product entry');
  assert.ok(f.order.indexOf('fullscreen-enter') < f.order.indexOf('native-navigation'));
  assert.ok(f.order.indexOf('configure') < f.order.indexOf('launch'));
  const nativeDocument = f.native.document, source = f.native.location.href, locationKey = f.router.state.location.key, commandsBeforeEdit = commands();
  await React.act(async () => {node('#touchLayoutEdit').click();});
  assert.equal(node('#toastText').textContent, 'Exit the running game before editing the touch layout', 'main app7187/8711 and i18n317 keep the launched guard at the real Settings action');
  assert.equal(node('#status').textContent, 'Error: Exit the running game before editing the touch layout');
  assert.equal(node('#toast').classList.contains('show'), true);
  assert.equal(env.document.querySelector('#touchLayoutEditor'), null); assert.equal(playerOpen(), true);
  assert.equal(currentUrl(), before); assert.equal(f.router.state.location.key, locationKey);
  assert.equal(f.native.document, nativeDocument); assert.equal(f.native.location.href, source); assert.deepEqual(commands(), commandsBeforeEdit);
  await React.act(async () => {f.native.emit('exit', {status: exitStatus});});
  await until(() => !playerOpen() && currentUrl() === before, 'native Exit retires the completed engine and returns to its options');
  assert.equal(commands().includes('sync'), false, 'native Exit has no surviving sync receiver (main app5493–5522)'); assert.equal(node('#gameFrame'), frame);
  assert.equal(node('#decisionDialog').open, false, 'main app5502–5506 skips sync and save decisions for either native exit status');
  assert.equal(f.navigations.at(-1), 'about:blank');
});

for (const mode of ['background-live', 'background-retired', 'foreground-failure', 'foreground-cancel']) test(`actual BrowserLauncher: optional package update ${mode} retains pinned feedback and installed generation`, async () => {
  let rejectDescriptor, requestSignal;
  const descriptor = new Promise((_resolve, reject) => {rejectDescriptor = reject;});
  void descriptor.catch(() => {});
  const catalog = {schema: 'eagler-touhou/release-catalog/1', games: {th06: {revision: 'published-next', descriptor: 'th06.package.json'}}};
  const f = await mountBrowser({seedPackages: ['th06'], fetchBoundary(url, init) {
    if (url.pathname.endsWith('/release-catalog.json')) return Response.json(catalog);
    if (url.pathname.endsWith('/th06.package.json')) {requestSignal = init.signal; return descriptor;}
  }}), session = api.getTestSession(), frame = node('#gameFrame');
  let installed; await React.act(async () => {installed = await api.readCurrentPackageGeneration('th06');});
  try {
    await start(); await until(() => node('#decisionDialog').open && !node('#decisionSecondary').hidden, 'original optional-update decision appears');
    assert.equal(node('#decisionMessage').textContent, 'A newer game package is available from the server. Your imported local version can still be started directly.');
    assert.equal(node('#decisionConfirm').textContent, 'Update now'); assert.equal(node('#decisionSecondary').textContent, 'Download in background'); assert.equal(node('#decisionCancel').textContent, 'Keep current version');
    const background = mode.startsWith('background');
    await click(background ? '#decisionSecondary' : '#decisionConfirm');
    await until(() => requestSignal, 'real update installer requests the published descriptor');
    if (background) {
      await until(() => session.getRuntime().getSnapshot().launched, 'old installed generation launches before deferred update settles');
      const epoch = session.getRuntime().getSnapshot().epoch;
      assert.equal(session.getRuntime().getSnapshot().generationId, installed.generation.id);
      assert.equal(node('#transferCancel').hidden, true, 'background update never owns blocking Cancel');
      if (mode === 'background-retired') {await back(); await until(() => !playerOpen(), 'Runtime closes before background rejection');}
      const feedback = session.feedback.getSnapshot(), transfer = session.transfer.getSnapshot();
      await React.act(async () => {rejectDescriptor(new Error('fixture background descriptor unavailable'));}); await tick();
      assert.deepEqual(session.feedback.getSnapshot(), feedback, 'pinned main logs background failure without status or toast');
      assert.deepEqual(session.transfer.getSnapshot(), transfer, 'silent update never changes transfer presentation');
      assert.ok(f.warnings.some(value => value.message === 'th06: background Package update failed for local install Error: fixture background descriptor unavailable'));
      if (mode === 'background-live') {assert.equal(session.getRuntime().getSnapshot().epoch, epoch); assert.equal(session.getRuntime().getSnapshot().launched, true); assert.equal(playerOpen(), true);}
      else assert.equal(session.getRuntime().getSnapshot().epoch, null);
    } else {
      assert.equal(node('#transferCancel').hidden, false); assert.equal(node('#transferCancel').textContent, 'Cancel update');
      if (mode === 'foreground-cancel') {await click('#transferCancel'); assert.equal(requestSignal.aborted, true);}
      else await React.act(async () => {rejectDescriptor(new Error('fixture foreground descriptor unavailable'));});
      await until(() => session.getRuntime().getSnapshot().launched, 'foreground update failure/cancel continues the installed version');
      assert.equal(session.feedback.getSnapshot().toast, mode === 'foreground-cancel' ? 'Update cancelled; continuing with the current version.' : 'Game-resource update failed; continuing with the current version: fixture foreground descriptor unavailable');
      assert.equal(session.getRuntime().getSnapshot().generationId, installed.generation.id);
      assert.equal(node('#transferCancel').hidden, true); assert.equal(playerOpen(), true);
    }
    await React.act(async () => {assert.equal((await api.readCurrentPackageGeneration('th06')).generation.id, installed.generation.id, 'failed/cancelled update never replaces the canonical installed generation');});
    assert.equal(node('#gameFrame'), frame);
  } finally {await React.act(async () => {rejectDescriptor(new Error('fixture cleanup'));}); await tick();}
});

test('actual BrowserLauncher: Back waits for native sync; repeated Back does not create a second close', async () => {
  const f = await mountBrowser(); await start(); await until(() => commands().includes('launch'), 'launch ACK');
  f.syncMode = 'hold'; const previous = currentUrl();
  await back(); await until(() => f.pendingSync.length === 1, 'actual session requested one save sync');
  assert.equal(playerOpen(), true); assert.equal(currentUrl(), previous); assert.notEqual(f.native.location.href, 'about:blank');
  await back(); assert.equal(f.pendingSync.length, 1, 'repeated navigation shares the current close');
  await React.act(async () => {f.native.respond(f.pendingSync[0]);});
  await until(() => !playerOpen() && currentUrl() === previous, 'successful native sync returns to its options');
});

test('actual BrowserLauncher: Back during native preparation cancels before configure or launch', async () => {
  const f = await mountBrowser({autoReady: false}); await start();
  await until(() => f.navigations.some(url => url !== 'about:blank'), 'actual native preparation started');
  await back(); await until(() => !playerOpen(), 'Back closes unlaunched Player');
  await React.act(async () => {f.native.emit('ready');}); await tick();
  assert.equal(commands().includes('configure'), false); assert.equal(commands().includes('launch'), false);
  assert.equal(f.native.location.href, 'about:blank'); assert.equal(currentUrl(), '/?game=th06&keep=a%20b');
});

test('actual BrowserLauncher: warning cancel has no fullscreen/native side effect, repeated Start owns one launch', async () => {
  const f = await mountBrowser(); await click('#launch'); await click('#decisionCancel');
  assert.equal(playerOpen(), false); assert.equal(f.navigations.length, 0); assert.equal(f.order.includes('fullscreen-enter'), false);
  assert.equal(node('#launch').disabled, false);
  await React.act(async () => {node('#launch').click(); node('#launch').click();}); await tick();
  assert.equal(node('#decisionDialog').open, true); await click('#decisionConfirm');
  await until(() => commands().includes('launch'), 'one confirmed Start launches');
  assert.equal(commands().filter(command => command === 'launch').length, 1);
  await back(); await until(() => !playerOpen(), 'cleanup through actual close');
});

test('actual BrowserLauncher: failed native sync offers Stay and retry without retiring the save writer', async () => {
  const f = await mountBrowser(); await start(); await until(() => commands().includes('launch'), 'launch ACK');
  const source = f.native.location.href, frame = node('#gameFrame'), previous = currentUrl(); f.syncMode = 'fail';
  await back(); await until(() => node('#decisionDialog').open, 'original save-failure decision appears');
  assert.match(node('#decisionMessage').textContent, /Synthetic native sync failure/);
  assert.equal(node('#decisionCancel').textContent, 'Stay in game');
  await click('#decisionCancel'); assert.equal(playerOpen(), true); assert.equal(currentUrl(), previous);
  assert.equal(f.native.location.href, source); assert.equal(node('#gameFrame'), frame);
  f.syncMode = 'auto'; await back(); await until(() => !playerOpen(), 'retry sync allows navigation');
  assert.equal(commands().filter(command => command === 'sync').length, 2); assert.equal(node('#gameFrame'), frame);
});

test('actual BrowserLauncher: mounted player input is gated by launch and removed after native Exit', async () => {
  const f = await mountBrowser();
  const key = type => env.window.dispatchEvent(new env.window.KeyboardEvent(type, {code: 'KeyZ', key: 'z', keyCode: 90, bubbles: true, cancelable: true}));
  await React.act(async () => {key('keydown'); key('keyup');});
  assert.equal(commands().includes('keyboard'), false);
  await start(); await until(() => commands().includes('launch'), 'launch ACK');
  await React.act(async () => {key('keydown'); key('keyup');});
  assert.deepEqual(f.outbound.filter(message => message.command === 'keyboard').map(message => [message.code, message.down]), [['KeyZ', true], ['KeyZ', false]]);
  await React.act(async () => {f.native.emit('exit', {status: 'success'});}); await until(() => !playerOpen(), 'native Exit removed input owner');
  const count = f.outbound.filter(message => message.command === 'keyboard').length;
  await React.act(async () => {key('keydown'); key('keyup');});
  assert.equal(f.outbound.filter(message => message.command === 'keyboard').length, count);
});

test('actual BrowserLauncher: same-card reopen preserves session-only settings and disclosure when durable storage is blocked', async () => {
  const f = await mountBrowser({blockStorage: true});
  assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'false');
  await click('#focusHitboxToggle'); await click('#mobileOptionsToggle');
  assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true');
  assert.equal(node('#mobileOptionsToggle').getAttribute('aria-expanded'), 'true');
  await click('#libraryBack'); await until(() => !env.document.querySelector('.tools[aria-hidden="false"]'), 'options close');
  await click('.game[data-game="th06"]:not([data-product])');
  await until(() => !!env.document.querySelector('.tools[aria-hidden="false"]'), 'same selected product reopens');
  assert.equal(node('#status').textContent, 'Selected 東方紅魔郷', 'main app1790/8652 uses the product title for selection status');
  assert.equal(node('#toast').classList.contains('show'), false, 'status-only selection must not open an empty toast');
  assert.equal(node('#toastText').textContent, '');
  assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true', 'main same-product lifetime never rereads stale blocked storage');
  assert.equal(node('#mobileOptionsToggle').getAttribute('aria-expanded'), 'true');
  assert.equal(JSON.parse(f.storage.getItem(api.gamePreferenceStorageKey('th06'))).options.focusHitboxEnabled, undefined);
});

test('actual BrowserLauncher: cold save export owns file-only preparation and retires its temporary native writer', async () => {
  const f = await mountBrowser(), frame = node('#gameFrame'), previous = currentUrl();
  await click('[data-action="export-save"]');
  await until(() => f.downloads.length === 1 && f.navigations.at(-1) === 'about:blank', 'cold export downloaded and released prepared owner');
  assert.equal(f.downloads[0].name, 'score.dat');
  assert.equal(commands().includes('read'), true); assert.equal(commands().includes('sync'), true);
  assert.equal(commands().includes('configure'), false); assert.equal(commands().includes('launch'), false);
  assert.equal(playerOpen(), false); assert.equal(currentUrl(), previous); assert.equal(node('#gameFrame'), frame);
  assert.equal(node('#launch').disabled, false, 'launcher activity completes after cold-owner cleanup');
});

// Main app6320–6399: only successful import completion hides Player. Earlier
// write/reopen/verification failures and picker cancellation keep its visibility.
// These use the real mounted BrowserSession; only native file replies are faked.
const storageImportCases = [
  {kind: 'save', game: 'th06', name: 'import.dat', path: 'score.dat', accept: '.dat'},
  {kind: 'hint', game: 'th10', name: 'import.txt', path: 'hint/hint_user.txt', accept: '.txt'},
  {kind: 'replay', game: 'th06', name: 'th6_01.rpy', path: 'replay/th6_01.rpy', accept: '.zip,.rpy,.rpyx'},
];
async function runningStorageImport({kind, game}) {
  const f = await mountBrowser({initial: `/?game=${game}&keep=a%20b`, host: subsetHost([game], {multiplayer: false}), seedPackages: game === 'th10' ? [game] : [], seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey(game), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  }});
  await start(); await until(() => commands().includes('launch'), 'real owner is running before import');
  if (kind === 'replay') {
    await click('[data-action="manage-replay"]');
    await until(() => node('#replayDialog').open && !env.document.querySelector('.replay-loading'), 'actual replay manager read the running owner');
  }
  return f;
}
async function openStoragePicker({kind, accept}) {
  await click(`[data-action="import-${kind}"]`);
  if (kind === 'save') {assert.equal(node('#decisionDialog').open, true); await click('#decisionConfirm');}
  assert.equal(node('#fileInput').accept, accept);
}
async function chooseStorageFile(entry) {
  const input = node('#fileInput');
  Object.defineProperty(input, 'files', {configurable: true, value: [new NativeFile([new Uint8Array([3, 7, 9])], entry.name)]});
  await React.act(async () => {input.dispatchEvent(new env.window.Event('change', {bubbles: true}));}); await tick();
}
for (const entry of storageImportCases) {
  test(`actual BrowserLauncher: running ${entry.kind} import hides Player only after successful original transaction`, async () => {
    const f = await runningStorageImport(entry), frame = node('#gameFrame'), locationKey = f.router.state.location.key, previous = currentUrl();
    const startIndex = f.order.length;
    f.writeMode = 'hold'; await openStoragePicker(entry); await chooseStorageFile(entry);
    await until(() => f.pendingWrite.length === 1, 'actual importer awaits native write acknowledgement');
    assert.equal(playerOpen(), true, 'an unfinished import must not hide Player');
    assert.equal(node('#player').classList.contains('open'), true);
    const write = f.pendingWrite.shift(); assert.equal(write.path, entry.path); assert.deepEqual(write.bytes, [3, 7, 9]);
    await React.act(async () => {f.storedFiles.set(write.path, [...write.bytes]); f.native.respond(write);});
    await until(() => node('#status').textContent === 'Imported 1 file(s); restart with Start Game to apply them', 'original import success feedback');
    assert.equal(playerOpen(), false, 'main6396–6397 hides Player after successful Runtime retirement');
    assert.equal(node('#player').classList.contains('open'), false);
    assert.equal(node('#toastText').textContent, node('#status').textContent);
    assert.equal(node('#gameFrame'), frame, 'the same React-owned iframe survives file Runtime retirement');
    assert.equal(currentUrl(), previous); assert.equal(f.router.state.location.key, locationKey, 'import success adds no navigation');
    const lifecycle = f.order.slice(startIndex).filter(value => ['sync', 'list', 'write', 'read', 'native-retired', 'native-navigation', 'launch', 'configure', 'fullscreen-exit'].includes(value));
    if (entry.kind === 'replay') {
      assert.deepEqual(lifecycle, ['list', 'write', 'native-retired', 'native-navigation', 'sync', 'list']);
      assert.equal(node('#replayDialog').open, true, 'main keeps the open Replay manager and refreshes it after retirement');
      assert.equal(node('.replay-name').textContent, 'th6_01.rpy');
    } else {
      assert.deepEqual(lifecycle, ['sync', 'native-retired', 'native-navigation', 'write', 'native-retired', 'native-navigation', 'read', 'native-retired']);
      assert.equal(f.native.location.href, 'about:blank');
      assert.equal(node('#replayDialog').open, false);
    }
  });
  test(`actual BrowserLauncher: running ${entry.kind} import picker cancellation preserves Player and its native owner`, async () => {
    const f = await runningStorageImport(entry), frame = node('#gameFrame'), source = f.native.location.href, previous = currentUrl(), before = [...f.order];
    await openStoragePicker(entry);
    await React.act(async () => {node('#fileInput').dispatchEvent(new env.window.Event('cancel'));}); await tick();
    assert.equal(playerOpen(), true); assert.equal(node('#player').classList.contains('open'), true);
    assert.equal(node('#gameFrame'), frame); assert.equal(f.native.location.href, source); assert.equal(currentUrl(), previous);
    assert.deepEqual(f.order, before, 'cancellation cannot sync, write or retire the running owner');
  });
  test(`actual BrowserLauncher: running ${entry.kind} import write failure does not use the success visibility boundary`, async () => {
    const f = await runningStorageImport(entry), frame = node('#gameFrame'), previous = currentUrl();
    f.writeMode = 'fail'; await openStoragePicker(entry); await chooseStorageFile(entry);
    await until(() => node('#status').textContent.includes('Synthetic native write failure'), 'native write error reaches original feedback');
    assert.equal(playerOpen(), true); assert.equal(node('#player').classList.contains('open'), true);
    assert.equal(node('#gameFrame'), frame); assert.equal(currentUrl(), previous);
    assert.equal(f.native.location.href === 'about:blank', false, 'failed import retains its current native owner');
    assert.equal(node('#status').textContent.includes('Imported'), false);
  });
  if (entry.kind !== 'replay') test(`actual BrowserLauncher: running ${entry.kind} import verification failure keeps Player open after the real reopen`, async () => {
    const f = await runningStorageImport(entry), before = f.navigations.length;
    f.corruptRead = true; await openStoragePicker(entry); await chooseStorageFile(entry);
    await until(() => node('#status').textContent === 'Error: The saved file could not be read back intact from browser storage', 'exact readback failure');
    assert.equal(playerOpen(), true); assert.equal(node('#player').classList.contains('open'), true);
    assert.deepEqual(f.storedFiles.get(entry.path), [3, 7, 9]);
    assert.equal(f.navigations.length - before, 4, 'running retirement and verification reopen happened, without final success retirement');
    assert.equal(f.native.location.href === 'about:blank', false);
  });
}
for (const outcome of ['launch', 'failure', 'fullscreen']) test(`actual BrowserLauncher: Replay import completion cannot hide a newer Start (${outcome}) waiting on its manager refresh`, async () => {
  const entry = storageImportCases[2], f = await runningStorageImport(entry), frame = node('#gameFrame'), previous = currentUrl(), music = node('#musicSelect').value;
  f.holdImportedList = true; await openStoragePicker(entry); await chooseStorageFile(entry);
  await until(() => f.pendingList.length === 1, 'import retired gameplay and awaits the refreshed Replay listing');
  assert.equal(playerOpen(), true);
  await click('[data-replay-close]'); await until(() => !node('#replayDialog').open, 'manager closes during its pending refresh');
  let releaseFullscreen;
  if (outcome === 'fullscreen') f.fullscreenReady = new Promise(resolve => {releaseFullscreen = resolve;});
  if (outcome === 'failure') f.failConfigure = true;
  await click('#launch'); assert.equal(node('#decisionDialog').open, true); await click('#decisionConfirm');
  assert.equal(commands().filter(command => command === 'launch').length, 1, 'new Start waits for fullscreen or the actual existing file owner');
  await React.act(async () => {f.holdImportedList = false; f.native.respond(f.pendingList.shift(), {files: [...f.storedFiles].map(([path, bytes]) => ({path, size: bytes.length}))});});
  if (outcome === 'fullscreen') {
    await until(() => node('#status').textContent.startsWith('Imported 1 file(s)'), 'old import completes before the newer Start has a Runtime epoch');
    assert.equal(playerOpen(), true, 'same-value Player open intent survives old completion before native preparation');
    await React.act(async () => {releaseFullscreen();});
  }
  if (outcome === 'failure') await until(() => node('#startupError').textContent.includes('Synthetic native configure failure'), 'newer accepted Start reports its own failure');
  else await until(() => commands().filter(command => command === 'launch').length === 2, 'new Start acquires and launches its next Runtime');
  await tick();
  assert.equal(playerOpen(), true, 'the completed old import must not hide the newer Player intent, including its error view');
  assert.equal(node('#player').classList.contains('open'), true); assert.equal(node('#gameFrame'), frame);
  assert.equal(currentUrl(), previous); assert.equal(node('#musicSelect').value, music, 'old completion cannot replace current settings');
});
test('actual BrowserLauncher: two queued Replay imports followed by accepted Start respect the actual Runtime queue', async () => {
  const entry = storageImportCases[2], f = await runningStorageImport(entry), frame = node('#gameFrame');
  f.holdImportedList = true; await openStoragePicker(entry); await chooseStorageFile(entry);
  await until(() => f.pendingList.length === 1, 'first import waits for its post-retirement manager refresh');
  await openStoragePicker(entry); await chooseStorageFile({...entry, name: 'th6_02.rpy'});
  assert.equal(commands().filter(command => command === 'write').length, 1, 'second actual import is queued');
  await click('[data-replay-close]'); await until(() => !node('#replayDialog').open, 'manager closed');
  await click('#launch'); await click('#decisionConfirm');
  await React.act(async () => {f.holdImportedList = false; f.native.respond(f.pendingList.shift(), {files: [...f.storedFiles].map(([path, bytes]) => ({path, size: bytes.length}))});});
  await until(() => commands().filter(command => command === 'launch').length === 2, 'new Start owns the next Runtime');
  await tick();
  assert.equal(playerOpen(), true); assert.equal(node('#gameFrame'), frame);
  assert.equal(commands().filter(command => command === 'write').length, 2, 'both serialized imports finish their writes');
  const secondWrite = f.order.lastIndexOf('write'), lastRetirement = f.order.lastIndexOf('native-retired');
  assert.ok(secondWrite < lastRetirement && lastRetirement < f.order.lastIndexOf('native-navigation'));
  assert.ok(f.order.lastIndexOf('native-navigation') < f.order.lastIndexOf('configure') && f.order.lastIndexOf('configure') < f.order.lastIndexOf('launch'),
    'the second import retires its file-only owner before the newer Start acquires its running epoch');
  assert.notEqual(f.native.location.href, 'about:blank');
});
for (const {launchedGame, phase} of [{launchedGame: 'th06', phase: 'running'}, {launchedGame: 'th07', phase: 'running'}, {launchedGame: 'th06', phase: 'loading'}]) test(`actual BrowserLauncher: acquisition-delayed queued Replay import cannot retire a newer accepted ${launchedGame} ${phase} Runtime`, async () => {
  const f = await mountBrowser({initial: `/?game=${launchedGame}&keep=a%20b`, host: subsetHost(['th06', 'th07']), seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey(launchedGame), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  }}), session = api.getTestSession(), frame = node('#gameFrame');
  let releaseRead, held = false;
  const readGate = new Promise(resolve => {releaseRead = resolve;});
  api.setPackageReadGate(async game => {if (game === 'th06' && !held) {held = true; await readGate;}});
  const outcomes = [];
  const observe = promise => promise.then(() => {outcomes.push({status: 'fulfilled'});}, error => {outcomes.push({status: 'rejected', name: error.name, message: error.message});});
  let first, second;
  try {
    await React.act(async () => {
      // Same real entry as Replay drop import, before either operation owns an epoch.
      first = observe(session.importFile('replay', new NativeFile([new Uint8Array([1])], 'th6_01.rpy'), 'th06'));
      second = observe(session.importFile('replay', new NativeFile([new Uint8Array([2])], 'th6_02.rpy'), 'th06'));
    });
    await until(() => held, 'first queued import waits at the real acquisition storage read');
    assert.equal(session.getRuntime().getSnapshot().epoch, null); assert.equal(commands().includes('write'), false);
    if (phase === 'loading') f.autoReady = false;
    await start(); await until(() => session.getRuntime().getSnapshot().phase === phase, 'newer accepted Start acquires its Runtime while old file preparation is outside native ownership');
    const running = session.getRuntime().getSnapshot(), beforeRelease = [...f.order], previous = currentUrl(), transfer = session.transfer.getSnapshot();
    assert.equal(running.launched, phase === 'running'); assert.equal(playerOpen(), true);
    f.autoReady = true; // Only subsequent navigations auto-ready; the held document still waits.
    await React.act(async () => {releaseRead(); await Promise.all([first, second]);}); await tick();
    assert.equal(outcomes[0].status, 'rejected', 'first stale preparation is rejected before it can acquire native ownership');
    assert.equal(outcomes[0].name, 'AbortError');
    assert.equal(outcomes[0].message, 'EAGLER_RUNTIME_SESSION_SUPERSEDED');
    assert.equal(outcomes[1].status, 'rejected', 'queued import explicitly rejects rather than reporting a false import success');
    assert.equal(outcomes[1].name, 'AbortError');
    assert.equal(outcomes[1].message, 'EAGLER_RUNTIME_SESSION_SUPERSEDED');
    assert.equal(node('#gameFrame'), frame); assert.equal(currentUrl(), previous);
    assert.deepEqual(f.order, beforeRelease, 'neither stale preparation nor the queued import may list/write/sync/retire the newer Runtime');
    assert.deepEqual(session.transfer.getSnapshot(), transfer, 'late onRuntimePlan/error cleanup cannot replace or hide the newer transfer view');
    const current = session.getRuntime().getSnapshot();
    assert.equal(current.epoch, running.epoch, `stale second import cannot retire newer epoch; ${JSON.stringify({outcomes, order: f.order, current, playerOpen: playerOpen()})}`);
    assert.equal(current.game, launchedGame); assert.equal(current.launched, phase === 'running'); assert.equal(playerOpen(), true);
    assert.equal(commands().includes('write'), false);
    if (phase === 'loading') {
      await React.act(async () => {f.native.emit('ready');});
      await until(() => session.getRuntime().getSnapshot().launched, 'the preserved newer startup can finish its own launch');
      assert.equal(session.getRuntime().getSnapshot().epoch, running.epoch); assert.equal(playerOpen(), true);
    }
  } finally {releaseRead(); api.setPackageReadGate(null); await Promise.all([first, second].filter(Boolean));}
});
// Real development acquisition, paused only at the authored fetch/storage edges.
function developmentAcquisitionHost(ids) {
  const host = subsetHost(ids); host.profile = 'web-development';
  for (const game of ids) {
    const product = api.PRODUCT_GAMES[game];
    host.games[game].gameData.path = product.package.dataTarget.slice(1);
    if (!('multiplayerRuntime' in product)) delete host.games[game].multiplayerRuntime;
    if (product.dataProvider === 'retail-memory') host.games[game].gameData.source = `fixture-${game}.data`;
  }
  return host;
}
function heldPackageFetch() {
  const requests = new Map(), pending = new Map(), held = new Set();
  let releasing = false;
  return {requests, fetchBoundary(url, init) {
    const game = url.pathname.match(/fixture-(th\d{2})\.data$/)?.[1]; if (!game) return null;
    let release; const promise = new Promise(resolve => {release = resolve;});
    const request = {signal: init.signal, released: false, release() {
      if (request.released) return;
      request.released = true; held.delete(request);
      release(new Response(new Uint8Array([1, 2, 3])));
    }};
    requests.set(game, request); held.add(request);
    for (const resolve of pending.get(game) ?? []) resolve(request);
    // Teardown can begin before asynchronous Package Store work reaches fetch.
    // Drain both already-held requests and any request registered afterwards.
    if (releasing) request.release();
    return promise;
  }, async waitForRequest(game, operation, {timeoutMs = 10_000} = {}) {
    if (requests.has(game)) return requests.get(game);
    let registered, timer;
    const registration = new Promise(resolve => {registered = resolve;});
    const listeners = pending.get(game) ?? new Set(); pending.set(game, listeners); listeners.add(registered);
    try {
      return await Promise.race([registration,
        new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(`Package fetch ${game} was not registered`)), timeoutMs);}),
        ...(operation ? [operation.then(() => {throw new Error(`Operation completed before package fetch ${game} was registered`);})] : []),
      ]);
    } finally {clearTimeout(timer); listeners.delete(registered); if (!listeners.size) pending.delete(game);}
  }, releaseAll() {releasing = true; for (const request of held) request.release();}};
}
test('held package fetch fixture drains current and future requests without releasing an active acquisition early', {timeout: 3000}, async () => {
  const edge = heldPackageFetch(), controller = new AbortController();
  const registered = edge.waitForRequest('th10');
  let completed = false;
  const response = edge.fetchBoundary(new URL('https://launcher.invalid/fixture-th10.data'), {signal: controller.signal}).then(value => {completed = true; return value;});
  const request = await registered;
  assert.equal(request, edge.requests.get('th10')); assert.equal(request.signal, controller.signal);
  assert.equal(request.released, false); assert.equal(completed, false, 'registration does not release the held fetch');
  edge.releaseAll();
  assert.deepEqual([...new Uint8Array(await (await response).arrayBuffer())], [1, 2, 3]);
  const late = edge.fetchBoundary(new URL('https://launcher.invalid/fixture-th11.data'), {signal: controller.signal});
  assert.equal((await edge.waitForRequest('th11')).released, true);
  assert.deepEqual([...new Uint8Array(await (await late).arrayBuffer())], [1, 2, 3]);
  edge.releaseAll();
});
test('held package fetch registration rejects an operation failure, early completion and a bounded missing request', {timeout: 3000}, async () => {
  const edge = heldPackageFetch(), failure = new Error('Synthetic acquisition failure before fetch');
  await assert.rejects(edge.waitForRequest('th10', Promise.reject(failure)), error => error === failure);
  await assert.rejects(edge.waitForRequest('th10', Promise.resolve()), /Operation completed before package fetch th10/);
  await assert.rejects(edge.waitForRequest('th10', undefined, {timeoutMs: 10}), /Package fetch th10 was not registered/);
  edge.releaseAll();
});
for (const oldResult of ['success', 'failure', 'native-error']) test(`actual BrowserLauncher: old file preparation ${oldResult} preserves a newer epoch-null TH10 acquisition and its Cancel receiver`, async () => {
  const edge = heldPackageFetch(), host = developmentAcquisitionHost(['th06', 'th10']);
  const f = await mountBrowser({initial: '/?game=th10&keep=a%20b', host, fetchBoundary: edge.fetchBoundary, seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey('th10'), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  }}), session = api.getTestSession();
  let releaseRead, rejectRead, held = false, imported, outcome, unsubscribe;
  const readGate = new Promise((resolve, reject) => {releaseRead = resolve; rejectRead = reject;});
  api.setPackageReadGate(game => {if (game === 'th06' && !held) {held = true; return readGate;}});
  const transfers = [];
  try {
    await React.act(async () => {imported = session.importFile('replay', new NativeFile([new Uint8Array([1])], 'th6_01.rpy'), 'th06').then(() => {outcome = 'success';}, error => {outcome = error.message;});});
    await until(() => held, 'old Replay import waits outside native ownership');
    await start();
    await React.act(async () => {await edge.waitForRequest('th10');});
    await until(() => edge.requests.has('th10') && !session.transfer.getSnapshot().hidden, 'new Start owns real package acquisition');
    assert.equal(session.getRuntime().getSnapshot().epoch, null);
    const before = session.transfer.getSnapshot();
    assert.equal(before.label, 'TH10 fixture-th10.data'); assert.equal(before.cancelVisible, true); assert.equal(node('#transferCancel').hidden, false);
    unsubscribe = session.transfer.subscribe(() => transfers.push(session.transfer.getSnapshot()));
    f.autoReady = false;
    await React.act(async () => {if (oldResult === 'failure') rejectRead(new Error('Held old acquisition failure')); else releaseRead();});
    if (oldResult !== 'failure') {
      await until(() => session.getRuntime().getSnapshot().phase === 'loading', 'old task acquires only its file-only Runtime');
      assert.equal(session.getRuntime().getSnapshot().fileOnly, true);
      await React.act(async () => {f.native.emit('transfer', {kind: 'game', mode: 'base', loaded: 1, total: 3});});
      assert.equal(session.getRuntime().getSnapshot().progress.loaded, 1, 'genuine native file progress still reaches the canonical Runtime owner');
      await React.act(async () => {if (oldResult === 'native-error') f.native.emit('error', {error: 'Held file native failure'}); else f.native.emit('ready');});
    }
    await React.act(async () => {await imported;}); await tick();
    assert.equal(outcome, oldResult === 'success' ? 'success' : oldResult === 'native-error' ? 'Held file native failure' : 'Held old acquisition failure');
    assert.deepEqual(session.transfer.getSnapshot(), before, 'old progress/plan/native ready/failure cleanup must preserve newer transfer presentation');
    assert.deepEqual(transfers, [], 'no transient stale TH06 transfer label or cancellation publication');
    assert.equal(session.getRuntime().getSnapshot().epoch, null); assert.equal(playerOpen(), true);
    assert.equal(commands().filter(value => value === 'write').length, oldResult === 'success' ? 1 : 0, 'background file work keeps its authentic outcome');
    assert.equal(edge.requests.get('th10').released, false, 'newer acquisition stays held until the actual Cancel click');
    assert.equal(edge.requests.get('th10').signal.aborted, false);
    await click('#transferCancel');
    await until(() => edge.requests.get('th10').signal.aborted, 'the visible Cancel reaches the newer TH10 acquisition');
    assert.equal(node('#transferCancel').hidden, true);
  } finally {unsubscribe?.(); releaseRead(); api.setPackageReadGate(null); edge.releaseAll(); if (imported) await React.act(async () => {await imported;}); await tick();}
});
for (const startState of ['none', 'warning', 'accepted']) test(`actual BrowserLauncher: file acquisition Cancel with ${startState} newer Start targets its visible owner`, {timeout: 30_000}, async () => {
  const edge = heldPackageFetch(), host = developmentAcquisitionHost(['th10', 'th11']);
  await mountBrowser({initial: '/?game=th11&keep=a%20b', host, fetchBoundary: edge.fetchBoundary, seedStorage(storage) {
    for (const game of ['th10', 'th11']) storage.values.set(api.gamePreferenceStorageKey(game), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  }});
  const session = api.getTestSession(), newerStart = startState === 'accepted'; let preparing, imported, outcome;
  try {
    await React.act(async () => {preparing = session.importFile('replay', new NativeFile([new Uint8Array([1])], 'th10_01.rpy'), 'th10'); imported = preparing.then(() => {outcome = 'success';}, error => {outcome = error.name;});});
    await React.act(async () => {await edge.waitForRequest('th10', preparing);});
    await until(() => !node('#transferCancel').hidden, 'file task owns an actual cancellable package acquisition');
    if (newerStart) {
      await start(); await React.act(async () => {await edge.waitForRequest('th11');});
      await until(() => session.transfer.getSnapshot().label.startsWith('TH11 '), 'new Start owns the visible network request');
    }
    if (startState === 'warning') {await click('#launch'); assert.equal(node('#decisionDialog').open, true); await click('#decisionCancel');}
    assert.equal(session.getRuntime().getSnapshot().epoch, null); assert.equal(node('#transferCancel').hidden, false);
    const cancelledGame = newerStart ? 'th11' : 'th10';
    assert.equal(edge.requests.get(cancelledGame).released, false, 'the visible acquisition remains held until the actual Cancel click');
    assert.equal(edge.requests.get(cancelledGame).signal.aborted, false);
    await click('#transferCancel');
    await until(() => edge.requests.get(cancelledGame).signal.aborted, 'visible cancellation reaches its real fetch signal');
    assert.equal(edge.requests.get('th10').signal.aborted, !newerStart, 'hidden older file acquisition must not receive a newer launch Cancel');
    if (newerStart) edge.requests.get('th10').release();
    await React.act(async () => {await imported;});
    assert.equal(outcome, newerStart ? 'success' : 'AbortError');
    assert.equal(commands().filter(value => value === 'write').length, newerStart ? 1 : 0);
  } finally {edge.releaseAll(); if (imported) await React.act(async () => {await imported;}); await tick();}
});
test('actual BrowserLauncher: queued import captured before held fullscreen cannot reclaim a cancelled newer Start recovery', async () => {
  const edge = heldPackageFetch();
  const f = await mountBrowser({initial: '/?game=th10', host: developmentAcquisitionHost(['th06', 'th10']), fetchBoundary: edge.fetchBoundary, seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey('th10'), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
  }}), session = api.getTestSession();
  let firstRead, secondRead, fullscreen, calls = 0, first, second;
  const gate1 = new Promise(resolve => {firstRead = resolve;}), gate2 = new Promise(resolve => {secondRead = resolve;});
  f.fullscreenReady = new Promise(resolve => {fullscreen = resolve;});
  api.setPackageReadGate(game => game === 'th06' ? (++calls === 1 ? gate1 : gate2) : null);
  try {
    await React.act(async () => {
      first = session.importFile('replay', new NativeFile([new Uint8Array([1])], 'th6_01.rpy'), 'th06').catch(error => error);
      second = session.importFile('replay', new NativeFile([new Uint8Array([2])], 'th6_02.rpy'), 'th06').catch(error => error);
    });
    await until(() => calls === 1, 'first queued import waits before native ownership');
    await start();
    await React.act(async () => {firstRead(); assert.equal(await first, undefined);});
    await until(() => calls === 2, 'second older import begins preparation during newer fullscreen wait');
    assert.equal(session.getRuntime().getSnapshot().epoch, null);
    await React.act(async () => {fullscreen();});
    await until(() => edge.requests.has('th10') && !node('#transferCancel').hidden, 'newer Start owns real TH10 acquisition');
    await click('#transferCancel');
    await until(() => session.gameData.getSnapshot().attempt?.manual === true && !playerOpen(), 'cancelled newer Start owns manual-import recovery');
    const recovery = session.gameData.getSnapshot(), transfer = session.transfer.getSnapshot(), previous = currentUrl();
    assert.equal(recovery.importOpen, true); assert.equal(node('#gameDataImportWindow').hidden, false);
    f.autoReady = false; await React.act(async () => {secondRead();});
    await until(() => session.getRuntime().getSnapshot().phase === 'loading', 'second import still acquires its own file Runtime');
    assert.deepEqual(session.gameData.getSnapshot(), recovery, 'old onRuntimePlan cannot replace newer recovery with a direct-download attempt');
    await React.act(async () => {f.native.emit('ready'); assert.equal(await second, undefined);}); await tick();
    assert.equal(commands().filter(command => command === 'write').length, 2, 'both original queued imports retain their successful native writes');
    assert.deepEqual(session.gameData.getSnapshot(), recovery, 'old native ready cannot clear the newer recovery window');
    assert.deepEqual(session.transfer.getSnapshot(), transfer, 'old work cannot reclaim cancellation or transfer presentation after launch flags clear');
    assert.equal(node('#gameDataImportWindow').hidden, false); assert.equal(node('#transferCancel').hidden, !transfer.cancelVisible);
    assert.equal(currentUrl(), previous); assert.equal(playerOpen(), false); assert.equal(session.getRuntime().getSnapshot().epoch, null);
  } finally {firstRead(); secondRead(); fullscreen(); api.setPackageReadGate(null); edge.releaseAll();
    if (f.native && session.getRuntime().getSnapshot().phase === 'loading') f.native.emit('ready');
    await React.act(async () => {await Promise.all([first, second].filter(Boolean));}); await tick();}
});
for (const newerStart of [false, true]) test(`actual BrowserLauncher: authenticated file-only exit ${newerStart ? 'preserves newer TH10 acquisition' : 'closes its current visible Player'}`, async () => {
  const edge = heldPackageFetch();
  const f = await mountBrowser({initial: newerStart ? '/?game=th10' : '/?game=th06&preview=touch', autoReady: false,
    host: developmentAcquisitionHost(['th06', 'th10']), fetchBoundary: edge.fetchBoundary, seedStorage(storage) {
      storage.values.set(api.gamePreferenceStorageKey('th10'), JSON.stringify({music: 'none', options: {touchEnabled: false, thpracEnabled: false}}));
    }}), session = api.getTestSession();
  let releaseRead, held = false, imported, outcome;
  const readGate = new Promise(resolve => {releaseRead = resolve;});
  api.setPackageReadGate(game => {if (game === 'th06' && !held) {held = true; return readGate;}});
  try {
    await React.act(async () => {imported = session.importFile('replay', new NativeFile([new Uint8Array([1])], 'th6_01.rpy'), 'th06').then(() => {outcome = 'success';}, error => {outcome = error;});});
    await until(() => held, 'file preparation paused before native ownership');
    if (newerStart) {await start(); await until(() => edge.requests.has('th10') && !session.transfer.getSnapshot().hidden, 'newer acquisition owns transfer');}
    assert.equal(playerOpen(), true);
    const transfer = session.transfer.getSnapshot();
    await React.act(async () => {releaseRead();});
    await until(() => session.getRuntime().getSnapshot().phase === 'loading', 'file-only carrier begins');
    assert.equal(session.getRuntime().getSnapshot().fileOnly, true);
    const epoch = session.getRuntime().getSnapshot().epoch, delivered = [];
    const unsubscribe = session.getRuntime().subscribeEvents(message => delivered.push(message));
    await React.act(async () => {f.native.emit('exit', {status: 'success', code: 0}); await imported;}); await tick(); unsubscribe();
    assert.equal(outcome.name, 'AbortError'); assert.equal(outcome.message, 'EAGLER_RUNTIME_SESSION_SUPERSEDED');
    assert.equal(delivered.at(-1).event, 'exit'); assert.equal(delivered.at(-1).epoch, epoch, 'genuine native exit remains delivered');
    assert.equal(session.getRuntime().getSnapshot().epoch, null); assert.equal(session.getRuntime().getSnapshot().fileOnly, false);
    assert.equal(commands().includes('write'), false, 'terminal file task never writes or falsely reports success');
    assert.equal(playerOpen(), newerStart);
    if (newerStart) {
      assert.equal(edge.requests.get('th10').signal.aborted, false, 'old file exit cannot cancel newer acquisition');
      assert.deepEqual(session.transfer.getSnapshot(), transfer, 'old file exit cannot replace, hide or cancel newer transfer');
      f.autoReady = true; await React.act(async () => {edge.requests.get('th10').release();});
      await until(() => session.getRuntime().getSnapshot().launched, 'preserved TH10 acquisition finishes and launches');
      assert.equal(session.getRuntime().getSnapshot().game, 'th10'); assert.equal(playerOpen(), true);
    }
  } finally {releaseRead(); api.setPackageReadGate(null); edge.releaseAll(); if (imported) await React.act(async () => {await imported;}); await tick();}
});
test('actual BrowserLauncher: an unaccepted newer Start warning does not suppress the old import success close', async () => {
  const entry = storageImportCases[2], f = await runningStorageImport(entry);
  f.holdImportedList = true; await openStoragePicker(entry); await chooseStorageFile(entry);
  await until(() => f.pendingList.length === 1, 'post-import Replay refresh is pending');
  await click('[data-replay-close]'); await until(() => !node('#replayDialog').open, 'manager closed');
  await click('#launch'); assert.equal(node('#decisionDialog').open, true);
  await React.act(async () => {f.holdImportedList = false; f.native.respond(f.pendingList.shift(), {files: []});});
  await until(() => node('#status').textContent.startsWith('Imported 1 file(s)'), 'original import succeeded while warning is undecided');
  assert.equal(playerOpen(), false, 'only an accepted Player presentation supersedes old import completion');
  await click('#decisionCancel'); assert.equal(playerOpen(), false);
  assert.equal(commands().filter(command => command === 'launch').length, 1);
});
test('actual BrowserLauncher: running save import overwrite refusal leaves the picker and native owner untouched', async () => {
  const f = await runningStorageImport(storageImportCases[0]), before = [...f.order], accept = node('#fileInput').accept;
  await click('[data-action="import-save"]'); await click('#decisionCancel');
  assert.equal(playerOpen(), true); assert.equal(node('#player').classList.contains('open'), true);
  assert.equal(node('#fileInput').accept, accept); assert.deepEqual(f.order, before);
});

function importPackageFile(game = 'th06') {
  const data = new Uint8Array([1, 2, 3]), hash = createHash('sha256').update(data).digest('hex');
  const files = Object.fromEntries([['game-data', `${game}.data`, `/${game}.data`], ['font', 'msgothic.ttc', '/msgothic.ttc'], ['unicode', 'unifont.otf', '/unifont.otf']]
    .map(([id, source, target]) => [id, {source, target, revision: `${id}-r1`, bytes: data.length, sha256: hash}]));
  const descriptor = {schema: 'eagler-touhou/package/1', game, revision: 'synthetic-import-r1',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: game, dataFile: 'game-data', dataLayout: `sha256-${'b'.repeat(64)}`},
    files, base: {files: ['game-data', 'font', 'unicode']}, components: {}};
  const archive = zipSync({'package.json': strToU8(JSON.stringify(descriptor)), [`${game}.data`]: data, 'msgothic.ttc': data, 'unifont.otf': data}, {level: 0});
  return new NativeFile([archive], `${game}.zip`, {type: 'application/zip'});
}
async function selectImport(file) {
  await click('#transferImport');
  const input = node('#fileInput'); assert.equal(input.accept, '.zip,.dat,application/zip');
  Object.defineProperty(input, 'files', {configurable: true, value: [file]});
  await React.act(async () => {input.dispatchEvent(new env.window.Event('change', {bubbles: true}));}); await tick();
}

test('actual BrowserLauncher: import-only Start → invalid file → valid canonical ZIP retries the captured launch without a second warning/fullscreen', async () => {
  const f = await mountBrowser({resourceMode: 'import'});
  await click('#launch'); await until(() => !node('#gameDataImportWindow').hidden, 'main import-required window opens');
  assert.equal(node('#decisionDialog').open, false); assert.equal(playerOpen(), false); assert.equal(f.navigations.length, 0);
  await selectImport(new NativeFile([], 'empty.zip'));
  assert.equal(node('#gameDataImportWindow').hidden, false); assert.equal(node('#gameDataImportWindow').getAttribute('aria-busy'), 'false');
  assert.equal((await api.readCurrentPackageGeneration('th06')).generation, null, 'invalid input cannot install a partial current generation');
  await selectImport(importPackageFile());
  await until(() => commands().includes('launch'), 'validated canonical import resumes the original launch');
  assert.equal(playerOpen(), true); assert.equal(node('#decisionDialog').open, false); assert.equal(f.order.includes('fullscreen-enter'), false);
  const current = await api.readCurrentPackageGeneration('th06');
  assert.equal(current.generation.descriptor.revision, 'synthetic-import-r1');
  assert.deepEqual(f.dataReads, [[1, 2, 3]], 'actual managed DATA callback reads the installed canonical object');
  assert.deepEqual(f.nativeWrites.map(item => item.path).sort(), ['/msgothic.ttc', '/unifont.otf']);
  assert.equal(commands().filter(command => command === 'launch').length, 1);
  await back(); await until(() => !playerOpen(), 'imported session closes through actual save boundary');
});

test('actual BrowserLauncher: StrictMode initialization owns one notice request, iframe, DATA callback and player input lifetime', async () => {
  const f = await mountBrowser({strictMode: true, noticeEnabled: true}); await tick();
  assert.equal(f.order.filter(value => value === 'boot-ready').length, 1);
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/NOTICE.txt')).length, 1);
  assert.equal(env.document.querySelectorAll('#gameFrame').length, 1);
  assert.equal(typeof env.window.__eaglerPrepareManagedRuntimeDataV1, 'function');
  await start(); await until(() => commands().includes('launch'), 'StrictMode real session launches');
  await React.act(async () => {
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', {code: 'KeyZ', key: 'z', keyCode: 90}));
    env.window.dispatchEvent(new env.window.KeyboardEvent('keyup', {code: 'KeyZ', key: 'z', keyCode: 90}));
  });
  assert.equal(f.outbound.filter(message => message.command === 'keyboard').length, 2, 'strict remount does not duplicate input forwarding');
  await back(); await until(() => !playerOpen(), 'StrictMode owner closes normally');
});

// These are supplemental owner-integration checks derived from main1493–1521,
// 4840–4845 and9742–9751. The original browser scenarios remain unchanged.
function subsetHost(ids, {multiplayer = true} = {}) {
  const value = hostManifest(), template = value.games.th06;
  value.games = Object.fromEntries(ids.map(id => [id, {...structuredClone(template), runtime: `runtime/${id}/${id}.html`,
    multiplayerRuntime: multiplayer ? `runtime/${id}mp/${id}.html` : undefined,
    gameData: {...template.gameData, path: `${id}.data`}}]));
  return value;
}
async function acceptHeldHost(f) {
  await React.act(async () => {f.releaseHost();});
  await until(() => f.order.includes('boot-ready'), 'first real Host finished');
}
function visibleOptions() {return env.document.querySelector('.tools[aria-hidden="false"]');}

for (const preview of ['touch', 'touch-hud']) test(`actual BrowserLauncher: boot ${preview} is a one-time preference override before Host, with no native or history side effects`, async () => {
  const initial = `/?game=th07&preview=${preview}&keep=a%20b#retained`;
  const f = await mountBrowser({initial, holdHost: true, host: subsetHost(['th07']), seedStorage(storage) {
    storage.values.delete('eagler-touch-help-seen-v8');
    storage.values.set(api.gamePreferenceStorageKey('th07'), JSON.stringify({music: 'none', options: {touchEnabled: false, focusHitboxEnabled: true}}));
  }});
  const frame = node('#gameFrame'), player = node('#player'), help = node('#touchHelp'), image = player.style.getPropertyValue('--touch-preview-image');
  assert.equal(node('#touchToggle').getAttribute('aria-checked'), 'true');
  assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true', 'routed TH07 preferences precede preview');
  assert.equal(playerOpen(), true); assert.equal(player.classList.contains('touch-preview'), true);
  assert.equal(player.classList.contains('touch-enabled'), true); assert.match(image, /th07-card\.webp/);
  assert.equal(help.hidden, preview !== 'touch');
  assert.equal(currentUrl(), initial); assert.equal(f.routeEvents.length, f.initialRouteCount);
  assert.deepEqual(f.navigations, []); assert.deepEqual(commands(), []); assert.equal(f.fullscreen, null);
  assert.equal(f.storage.getItem('eagler-touch-help-seen-v8'), null);
  assert.equal(f.storage.writes.some(([key, value]) => key === api.sharedTouchPreferenceStorageKey && JSON.parse(value).touchEnabled), false, 'preview never persists the enabled override');
  await acceptHeldHost(f);
  assert.equal(node('#touchToggle').getAttribute('aria-checked'), 'false', 'first Host restores the saved disabled preference');
  assert.equal(node('#gameFrame'), frame); assert.equal(node('#player'), player); assert.equal(node('#touchHelp'), help);
  assert.equal(playerOpen(), true); assert.equal(player.classList.contains('touch-preview'), true);
  assert.equal(player.classList.contains('touch-enabled'), false);
  assert.equal(player.style.getPropertyValue('--touch-preview-image'), image); assert.equal(help.hidden, preview !== 'touch');
  assert.equal(currentUrl(), initial); assert.equal(f.routeEvents.length, f.initialRouteCount);
  assert.deepEqual(f.navigations, []); assert.deepEqual(commands(), []); assert.equal(f.order.includes('fullscreen-enter'), false);
  assert.equal(f.storage.getItem('eagler-touch-help-seen-v8'), null);
  await React.act(async () => {for (const type of ['keydown', 'keyup']) env.window.dispatchEvent(new env.window.KeyboardEvent(type, {code: 'KeyZ', key: 'z', keyCode: 90, bubbles: true}));});
  assert.deepEqual(commands(), [], 'static preview never creates a gameplay input owner');
});

for (const editing of [false, true]) test(`actual BrowserLauncher: late Host fallback preserves ${editing ? 'dirty editor/fullscreen/artwork' : 'selected options'} and raw address`, async () => {
  const initial = '/?game=th06&keep=a%20b#retained';
  const f = await mountBrowser({initial, holdHost: true, host: subsetHost(['th09', 'th07']), seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey('th07'), JSON.stringify({music: 'none', options: {focusHitboxEnabled: true}}));
  }});
  const frame = node('#gameFrame');
  let editor, image, bombStyle, fullscreen;
  if (editing) {
    await click('#mobileOptionsToggle'); await click('#touchLayoutEdit');
    await until(() => env.document.querySelector('#touchLayoutSave')?.disabled === false, 'actual editor draft initialized before Host');
    editor = node('#touchLayoutEditor'); image = node('#player').style.getPropertyValue('--touch-preview-image');
    const bomb = node('#touchBomb');
    await React.act(async () => {
      bomb.dispatchEvent(new env.window.PointerEvent('pointerdown', {bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: 175, clientY: 225}));
      env.document.dispatchEvent(new env.window.PointerEvent('pointermove', {bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: 207, clientY: 241}));
      env.document.dispatchEvent(new env.window.PointerEvent('pointerup', {bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: 207, clientY: 241}));
    });
    bombStyle = bomb.getAttribute('style'); fullscreen = f.fullscreen;
    assert.equal(fullscreen, node('#player')); assert.match(image, /th06-card\.webp/);
  }
  const locationKey = f.router.state.location.key, routes = f.routeEvents.length;
  await acceptHeldHost(f);
  assert.equal(node('#gameId').dataset.game, 'th07', 'fallback follows PRODUCT_GAMES order rather than Host property insertion');
  assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true', 'fallback restores the selected game preferences');
  assert.ok(visibleOptions()); assert.equal(currentUrl(), initial); assert.equal(f.router.state.location.key, locationKey); assert.equal(f.routeEvents.length, routes);
  assert.equal(node('#gameFrame'), frame); assert.deepEqual(f.navigations, []); assert.deepEqual(commands(), []);
  if (editing) {
    assert.equal(node('#touchLayoutEditor'), editor); assert.equal(f.fullscreen, fullscreen);
    assert.equal(node('#player').style.getPropertyValue('--touch-preview-image'), image);
    assert.equal(node('#touchBomb').getAttribute('style'), bombStyle, 'draft placement survives metadata fallback');
    assert.equal(f.order.filter(value => value === 'fullscreen-enter').length, 1); assert.equal(f.order.includes('fullscreen-exit'), false);
    assert.equal(f.storage.getItem(api.touchLayoutStorageKey), null, 'draft is still uncommitted');
    await click('#touchLayoutExit'); assert.equal(node('#decisionDialog').open, true, 'draft remains dirty after Host fallback');
    await click('#decisionCancel'); assert.equal(node('#touchLayoutEditor'), editor);
    await click('#touchLayoutSave');
    assert.ok(JSON.parse(f.storage.getItem(api.touchLayoutStorageKey)).profiles.landscape);
  } else assert.equal(playerOpen(), false);
});

test('actual BrowserLauncher: absent default base falls back inside Host without opening home options', async () => {
  const initial = '/?keep=a%20b#retained', f = await mountBrowser({initial, holdHost: true, host: subsetHost(['th09', 'th07'])});
  const frame = node('#gameFrame'); assert.equal(visibleOptions(), null);
  await acceptHeldHost(f);
  assert.equal(visibleOptions(), null); assert.equal(playerOpen(), false); assert.equal(currentUrl(), initial); assert.equal(f.routeEvents.length, f.initialRouteCount);
  assert.equal(node('#gameFrame'), frame); assert.deepEqual(f.navigations, []);
  await click('.game[data-game="th07"]:not([data-product])');
  assert.equal(visibleOptions(), null, 'main game-library350–357: first different-cover click only previews it');
  await click('.game[data-game="th07"]:not([data-product])');
  assert.equal(node('#status').textContent, 'Selected 東方妖々夢', 'Host fallback already selected TH07 business preferences while home stayed closed');
  assert.equal(node('#gameId').dataset.game, 'th07');
});

for (const room of [false, true]) test(`actual BrowserLauncher: same-base missing MP Runtime ${room ? 'retains the restored room' : 'hides options but retains catalog content'}`, async () => {
  const initial = `/?game=th06mp${room ? '&mpRoom=1234' : ''}&keep=a%20b#retained`;
  const f = await mountBrowser({initial, holdHost: true, host: subsetHost(['th06'], {multiplayer: false})});
  const frame = node('#gameFrame');
  if (room) await until(() => !!env.document.querySelector('#mpRoomCode'), 'room restored before Host');
  else assert.ok(visibleOptions());
  const code = env.document.querySelector('#mpRoomCode'), address = currentUrl(), routes = f.routeEvents.length;
  if (room) {
    assert.equal(code.textContent, '1234');
    assert.deepEqual(f.warnings, [], 'main app7604–7618 must seed direct-room history after Router activation');
    assert.equal(f.router.state.location.state?.eaglerTouhouMpRoom, '1234', 'main direct-room history marker is committed before Host');
  }
  await acceptHeldHost(f);
  assert.equal(visibleOptions(), null); assert.equal(node('#gameId').textContent, 'TH06 MP', 'removed card does not substitute a different retained panel');
  assert.equal(currentUrl(), address); assert.equal(f.routeEvents.length, routes); assert.equal(node('#gameFrame'), frame);
  assert.deepEqual(f.navigations, []); assert.equal(playerOpen(), false);
  if (room) {
    assert.equal(node('#mpRoomCode'), code); assert.equal(code.textContent, '1234');
    assert.equal(node('#mpRoomView').hidden, false); assert.equal(env.document.body.classList.contains('mp-room-active'), true);
  }
});

test('actual BrowserLauncher: canonical installed hint preserves session-only language/options after first Host', async () => {
  const host = hostManifest(), language = {id: 'en', title: 'English', pack: {url: 'lang/en.zip', bytes: 3, sha256: 'c'.repeat(64), runtimeVersion: 'fixture', files: 1}};
  host.games.th06.languages.push(language); host.games.th06.languageOptions.push(language);
  const f = await mountBrowser({host, seedStorage(storage) {storage.values.set(api.languagePreferenceStorageKey('th06'), 'ja');}});
  f.storage.blocked = true;
  await React.act(async () => {const language = node('#languageSelect'); language.value = 'en'; language.dispatchEvent(new env.window.Event('change', {bubbles: true}));});
  await click('#focusHitboxToggle');
  assert.equal(node('#languageSelect').value, 'en'); assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true');
  await click('#gamePackageImport'); await until(() => !node('#gameDataImportWindow').hidden, 'manual canonical import window opens');
  await selectImport(importPackageFile());
  await until(() => node('#gameDataImportWindow').hidden, 'manual import completes without launch');
  assert.equal((await api.readCurrentPackageGeneration('th06')).generation.descriptor.revision, 'synthetic-import-r1');
  await tick();
  assert.equal(node('#languageSelect').value, 'en'); assert.equal(node('#focusHitboxToggle').getAttribute('aria-checked'), 'true');
  assert.equal(f.storage.getItem(api.languagePreferenceStorageKey('th06')), 'ja');
  assert.equal(playerOpen(), false); assert.deepEqual(f.navigations, []);
});

for (const close of ['Exit', 'Back']) test(`actual BrowserLauncher: original touch-settings144–151 hidden retained editor opens from home and ${close} returns home`, async () => {
  const f = await mountBrowser({host: subsetHost(['th06', 'th07'])}), frame = node('#gameFrame');
  await click('#mobileOptionsToggle'); await click('#touchLayoutEdit');
  await until(() => env.document.querySelector('#touchLayoutSave')?.disabled === false, 'first retained-product editor initialized');
  await click('#touchLayoutExit');
  if (node('#decisionDialog').open) await click('#decisionConfirm');
  await until(() => !env.document.querySelector('#touchLayoutEditor'), 'first editor closes, as original lines136–143');

  // Preserve the original sequence, including its programmatic hidden-button
  // click. A single different-cover click previews TH07; it does not actually
  // select TH07 business settings (main game-library350–357).
  await click('#libraryBack');
  await until(() => !visibleOptions(), 'Back returns to home');
  const home = currentUrl(), homeKey = f.router.state.location.key, retainedButton = node('#touchLayoutEdit');
  await click('.game[data-game="th07"]:not([data-product])');
  assert.equal(visibleOptions(), null); assert.equal(currentUrl(), home);
  assert.equal(node('#gameId').dataset.game, 'th06', 'the original sequence still owns the previously selected TH06 settings');
  if (!node('#mobileOptions').classList.contains('open')) await click('#mobileOptionsToggle');
  assert.equal(node('#mobileOptions').classList.contains('open'), true);
  await React.act(async () => {node('#touchLayoutEdit').click();});
  await until(() => env.document.querySelector('#touchLayoutSave')?.disabled === false, 'original programmatic hidden-button click opens its retained editor');
  assert.equal(node('#touchLayoutEditor').hidden, false, 'original test-touch-settings-browser.py151 assertion');
  assert.equal(node('#touchLayoutEdit'), retainedButton); assert.equal(node('#gameId').dataset.game, 'th06');
  assert.match(node('#player').style.getPropertyValue('--touch-preview-image'), /th06-card\.webp/);
  assert.equal(visibleOptions(), null, 'home-parent editor does not invent an open options surface behind itself');
  assert.equal(currentUrl(), home); assert.notEqual(f.router.state.location.key, homeKey);
  assert.equal(node('#gameFrame'), frame); assert.deepEqual(f.navigations, []);

  if (close === 'Exit') await click('#touchLayoutExit'); else await back();
  if (node('#decisionDialog').open) await click('#decisionConfirm');
  await until(() => !env.document.querySelector('#touchLayoutEditor') && !playerOpen(), `${close} closes only the editor`);
  assert.equal(visibleOptions(), null); assert.equal(currentUrl(), home); assert.equal(f.router.state.location.key, homeKey);
  assert.equal(node('#gameFrame'), frame); assert.equal(node('#gameId').dataset.game, 'th06');
});

for (const game of ['th06', 'th07']) test(`actual BrowserLauncher: ${game} MP stale/current native Exit preserves the canonical room, then room Back leaves once`, async () => {
  const product = `${game}mp`, host = subsetHost([game]);
  host.shared.netplayRelay = 'wss://relay.invalid/socket';
  host.games[game].multiplayerRuntime = `runtime/${game}/multiplayer/${game}.html?hosted=1&v=test-multiplayer`;
  const f = await mountBrowser({initial: `/?game=${product}&keep=a%20b`, host, socketBoundary: true, seedPackages: [game]});
  const frame = node('#gameFrame');
  // Original test-mp-runtime-exit-room.py152–159 expects an old visible home
  // card/online-fold route that final main no longer exposes. This fixture
  // enters direct MP options and invokes the retained native DOM action only;
  // it does not certify that superseded original browser setup as passing.
  assert.equal(node('#mpCreateRoom').disabled, false);
  await click('#mpCreateRoom');
  await until(() => f.sockets.length === 1 && !!env.document.querySelector('#mpRoomCode'), 'actual room owner creates its lobby transport');
  const socket = f.sockets[0], endpoint = new URL(socket.url), code = node('#mpRoomCode').textContent;
  assert.equal(endpoint.searchParams.get('room'), `${product}-${code}`);
  const localClientId = endpoint.searchParams.get('lobby'); assert.ok(localClientId);
  await React.act(async () => {
    socket.open();
    socket.message({type: 'state', roomDirectory: {version: 1, controlModes: true}, room: {
      code, playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
      seats: [{clientId: localClientId, name: 'A', loadout: 0, ready: false, offline: false}, null], spectators: [],
    }});
  });
  assert.equal(node('#mpLocalPlayer').hidden, false); assert.equal(socket.sent.filter(message => message.type === 'take-seat').length, 1);
  const roomElement = node('#mpRoomView');
  await click('[data-mp-seat="0"] .mp-seat-edit');
  await until(() => node('#mpRoomPanel').open, 'actual personal panel opens');
  assert.equal(node('#mpCheckGame').disabled, false, 'original MP Exit171');
  await click('#mpCheckGame');
  await until(() => commands().includes('launch'), 'canonical preparation and actual Runtime preflight reach launch ACK');
  const configure = f.outbound.find(message => message.command === 'configure');
  assert.equal(configure.options.multiplayerPreflight === true, false, 'original181–183: TH06/TH07 omit TH08-only preflight role');
  assert.equal(!!configure.options.netplayMode, false, 'original184–186: game check cannot join gameplay transport');
  assert.match(f.native.location.href, new RegExp(`/runtime/${game}/multiplayer/${game}\\.html`));
  assert.match(f.native.location.href, /runtimeVariant=multiplayer/);
  assert.deepEqual(f.dataReads, [[1, 2, 3]], 'actual managed preparation reads canonical installed DATA');
  const epoch = f.native.envelope.epoch, documentBefore = f.native.document;
  await React.act(async () => {f.native.emit('exit', {epoch: epoch - 1, status: 'error'});}); await tick();
  assert.equal(playerOpen(), true, 'original188–190: stale native exit is ignored');
  assert.equal(f.native.document, documentBefore); assert.equal(node('#gameFrame'), frame);
  const roomKey = `eagler-touhou-${product}-room-v1`, removals = f.sessionStorage.removals.filter(key => key === roomKey).length;
  await React.act(async () => {f.native.emit('exit', {status: 'error'});});
  await until(() => !playerOpen(), 'current authenticated native error Exit closes Player');
  assert.equal(commands().includes('sync'), false, 'main5502–5506 native Exit has no surviving save receiver');
  assert.equal(node('#decisionDialog').open, false);
  assert.equal(node('#mpRoomView').hidden, false); assert.equal(node('#mpRoomCode').textContent, code);
  assert.equal(node('#mpLocalPlayer').hidden, false); assert.equal(node('#gameId').textContent, `${game.toUpperCase()} MP`);
  // Original201 requires has-selection, but pinned main4569/4593 expressly
  // removes it for index349's library-layout. Keep that original assertion
  // unchanged and unresolved for paired browser execution; do not add a class
  // to production merely to satisfy its obsolete presentation premise.
  assert.equal(node('#main').classList.contains('has-selection'), false, 'pinned main library-layout presentation');
  assert.equal(env.document.body.classList.contains('mp-room-active'), true);
  // Original202–203 assert obsolete raw game/mpRoom query keys. Keep those
  // original bytes unchanged; here read the actual main token via its parser.
  const invite = api.resolveRoomInvite(new URL(currentUrl(), env.window.location.href));
  assert.equal(invite?.g, product); assert.equal(invite?.r, code);
  assert.equal(JSON.parse(f.sessionStorage.getItem(roomKey)).room.code, code, 'original204–210 retains room session');
  assert.equal(f.sessionStorage.removals.filter(key => key === roomKey).length, removals);
  assert.equal(socket.closes.length, 0); assert.equal(f.sockets.length, 1); assert.equal(node('#gameFrame'), frame);

  // Preserve the original212–213 personal-panel layer before exercising the
  // next system Back as a supplemental room-leave variant of original214–216.
  if (node('#mpRoomPanel').open) await click('#mpRoomPanelClose');
  await until(() => !node('#mpRoomPanel').open, 'only the personal panel closes');
  assert.equal(socket.closes.length, 0); assert.equal(node('#mpRoomCode').textContent, code);
  await back();
  await until(() => api.resolveRoomInvite(new URL(currentUrl(), env.window.location.href)) === null, 'next Back clears the room route');
  assert.equal(api.resolveRoomInvite(new URL(currentUrl(), env.window.location.href)), null);
  assert.equal(f.sessionStorage.getItem(roomKey), null);
  assert.equal(f.sessionStorage.removals.filter(key => key === roomKey).length, removals + 1);
  assert.deepEqual(socket.closes, [{code: 1000, reason: 'leave room'}]); assert.equal(f.sockets.length, 1);
  assert.equal(node('#gameFrame'), frame); assert.equal(commands().includes('sync'), false);
  assert.ok(!env.document.querySelector('#mpRoomView') || node('#mpRoomView').hidden,
    `original215: room is hidden after leave; DOM=${JSON.stringify({count: env.document.querySelectorAll('#mpRoomView').length, sameNode: env.document.querySelector('#mpRoomView') === roomElement, connected: roomElement.isConnected, hidden: roomElement.hidden, parent: roomElement.parentElement?.id, parentClass: roomElement.parentElement?.className, roomActive: env.document.body.classList.contains('mp-room-active'), saved: f.sessionStorage.getItem(roomKey), closes: socket.closes})}`);
  await click('#mpCreateRoom');
  await until(() => f.sockets.length === 2 && !!env.document.querySelector('#mpRoomCode'), 'new room can enter after actual leave');
  const nextSocket = f.sockets[1], nextCode = node('#mpRoomCode').textContent;
  await React.act(async () => {
    nextSocket.open(); nextSocket.message({type: 'state', roomDirectory: {version: 1, controlModes: true}, room: {
      code: nextCode, playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
      seats: [{clientId: new URL(nextSocket.url).searchParams.get('lobby'), name: 'A', loadout: 0, ready: false}, null], spectators: [],
    }});
  });
  assert.equal(env.document.querySelectorAll('#mpRoomView').length, 1); assert.notEqual(node('#mpRoomView'), roomElement);
  assert.equal(roomElement.isConnected, false); assert.equal(node('#mpRoomView').hidden, false); assert.equal(node('#mpLocalPlayer').hidden, false);
  assert.equal(JSON.parse(f.sessionStorage.getItem(roomKey)).room.code, nextCode);
  assert.equal(socket.closes.length, 1); assert.equal(nextSocket.closes.length, 0); assert.equal(node('#gameFrame'), frame);
});

for (const game of ['th06', 'th07', 'th08', 'th09', 'th10']) test(`actual BrowserLauncher: original ${game} multiplayer Replay Runtime path and configure contract`, async () => {
  const product = `${game}mp`, host = subsetHost([game]), runtimePath = `runtime/${game}/multiplayer/${game}.html`;
  host.games[game].multiplayerRuntime = `${runtimePath}?hosted=1&v=test-multiplayer`;
  // Same explicit setup boundary as above: the old home-card activation is
  // baseline-conflicted, so it is not counted as original browser acceptance.
  const f = await mountBrowser({initial: `/?game=${product}&keep=a%20b`, host, seedPackages: [game]});
  const frame = node('#gameFrame');
  await click('#mpReplayViewer'); await until(() => commands().includes('launch'), 'actual Replay action configures and launches the multiplayer Runtime');
  const source = f.native.location.href, configure = f.outbound.find(message => message.command === 'configure');
  // Original test-multiplayer-replay-launcher-browser.py170–174, observing
  // the actual navigated document rather than Runtime model bookkeeping.
  assert.ok(source.includes(`/${runtimePath}`), source);
  assert.ok(source.includes('runtimeVariant=multiplayer'), source);
  assert.ok(configure); assert.equal(configure.options.replayViewer, true);
  assert.equal(Object.keys(configure.options).some(key => key.startsWith('netplay')), false);
  assert.equal(playerOpen(), true); assert.equal(node('#gameFrame'), frame); assert.deepEqual(f.dataReads, [[1, 2, 3]]);
  assert.equal(f.sockets.length, 0, 'Replay viewer never creates room/gameplay transport');
  await back(); await until(() => !playerOpen(), 'Replay viewer closes through its actual Runtime owner');
  assert.equal(node('#gameFrame'), frame);
});

// Main1499–1521 may replace business selection while Start's existing input
// warning is open. Main9560–9569 then opens/starts the current selected game.
for (const boundary of ['warning', 'fullscreen']) test(`actual BrowserLauncher: late Host fallback during Start ${boundary} launches the current selected product`, async () => {
  const initial = '/?game=th07&keep=a%20b#retained';
  const f = await mountBrowser({initial, holdHost: true, host: subsetHost(['th06']), seedStorage(storage) {
    storage.values.set(api.gamePreferenceStorageKey('th07'), JSON.stringify({music: 'none', options: {touchEnabled: false}}));
  }});
  const frame = node('#gameFrame');
  await click('#launch');
  assert.equal(node('#decisionDialog').open, true); assert.equal(playerOpen(), false);
  let releaseFullscreen;
  if (boundary === 'fullscreen') {
    f.fullscreenReady = new Promise(resolve => {releaseFullscreen = resolve;});
    await click('#decisionConfirm');
    assert.equal(f.order.includes('fullscreen-enter'), true); assert.deepEqual(f.navigations, []);
  }
  await acceptHeldHost(f);
  assert.equal(node('#gameId').dataset.game, 'th06'); assert.equal(currentUrl(), initial);
  if (boundary === 'warning') {
    assert.equal(node('#decisionDialog').open, true, 'Host arrival preserves the already-open warning');
    await click('#decisionConfirm');
  } else await React.act(async () => {releaseFullscreen();});
  await until(() => commands().includes('launch'), 'Start continues with Host-selected TH06');
  assert.match(f.native.location.href, /\/runtime\/th06\/th06\.html/);
  assert.equal(f.outbound.find(message => message.command === 'configure').game, 'th06');
  assert.equal(node('#gameFrame'), frame); assert.equal(playerOpen(), true);
  assert.equal(f.order.filter(value => value === 'fullscreen-enter').length, 1);
  await back(); await until(() => !playerOpen(), 'selected fallback Runtime closes normally');
});

// Main4928–4949 reads music after the touch-input confirmation, not before it.
test('actual BrowserLauncher: late Host fallback between input warnings uses the current music warning', async () => {
  env.window.AudioContext = class {};
  Object.defineProperty(env.window.navigator, 'maxTouchPoints', {configurable: true, value: 1});
  try {
    const f = await mountBrowser({initial: '/?game=th07', holdHost: true, host: subsetHost(['th06']), seedStorage(storage) {
      storage.values.set(api.gamePreferenceStorageKey('th07'), JSON.stringify({music: 'midi', musicPreferenceExplicit: true, options: {touchEnabled: false}}));
      storage.values.set(api.gamePreferenceStorageKey('th06'), JSON.stringify({music: 'none', musicPreferenceExplicit: true, options: {touchEnabled: false}}));
    }});
    assert.equal(node('#musicSelect').value, 'midi');
    await click('#launch');
    assert.match(node('#decisionMessage').textContent, /touch controls.*disabled/i);
    await acceptHeldHost(f);
    assert.equal(node('#musicSelect').value, 'none');
    await click('#decisionConfirm');
    assert.equal(node('#decisionDialog').open, true); assert.match(node('#decisionMessage').textContent, /without music/i);
    assert.equal(playerOpen(), false); assert.deepEqual(f.navigations, []);
    await click('#decisionCancel');
  } finally {
    delete env.window.AudioContext;
    Object.defineProperty(env.window.navigator, 'maxTouchPoints', {configurable: true, value: 0});
  }
});

// Main lobby.mts113 gives the directory guide its filter product. The Launcher
// Host's independently retained business selection is not the directory filter.
for (const timing of ['together', 'after-directory']) test(`actual BrowserLauncher: lobby guide follows directory filter and settings stay explicit (Host ${timing})`, async () => {
  const f = await mountBrowser({initial: '/lobby.html?game=th07mp&keep=a%20b', holdHost: timing === 'after-directory' ? 'launcher' : true, host: subsetHost(['th06', 'th07'])});
  if (timing === 'after-directory') await until(() => env.document.querySelector('#lobbyGameRail .game.nav-preview[data-product="th07mp"]'), 'actual directory applies TH07 filter before Launcher Host');
  await React.act(async () => {f.releaseHost();}); await tick();
  await until(() => env.document.querySelector('#lobbyGameRail .game.nav-preview[data-product="th07mp"]'), 'actual directory applies TH07 filter');
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/host-manifest.json')).length, 2);
  assert.equal(node('#lobbyOptionsDialog').open, false, 'the directory filter is not an instruction to open game settings');
  await click('#lobbyGuideOpen');
  await until(() => env.document.querySelector('#mpGuideContent .multiplayer-rule-game-tab.selected'), 'authored guide content loads');
  assert.equal(node('#mpGuideContent .multiplayer-rule-game-tab.selected').dataset.game, 'th07');
  assert.equal(node('#mpGuideContent .multiplayer-rule-panel:not([hidden])').dataset.game, 'th07');
  assert.equal(new URL(currentUrl(), env.window.location.href).searchParams.get('game'), 'th07mp');
  assert.equal(playerOpen(), false); assert.deepEqual(f.navigations, []);
  await click('#mpGuideClose'); await until(() => !node('#mpGuideDialog').open, 'guide closes its own entry');
  await click('#lobbyGameRail .game[data-product="th07mp"]');
  await until(() => node('#lobbyOptionsDialog').open, 'explicit card click still opens its original settings carrier');
  assert.equal(node('#gameId').textContent, 'TH07 MP');
  assert.equal(new URL(currentUrl(), env.window.location.href).searchParams.get('game'), 'th07mp', 'options product does not replace the independent filter');
  await click('#libraryBack'); await until(() => !node('#lobbyOptionsDialog').open, 'settings Back returns to the same directory');
  await click('#lobbyGameRail .game[data-product="th06mp"]');
  assert.equal(node('#lobbyOptionsDialog').open, false, 'browsing another cover changes only the filter');
  await click('#lobbyGuideOpen'); await until(() => node('#mpGuideDialog').open, 'directory guide reopens after another product settings');
  assert.equal(node('#mpGuideContent .multiplayer-rule-game-tab.selected').dataset.game, 'th06');
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/content/MULTIPLAYER.html')).length, 1, 'cached authored guide follows the filter on reopen');
});

// Main lobby.mts has no automatic first-use presentation. A route-owned shared
// component must not let the previous Launcher request appear over that page.
test('actual BrowserLauncher: delayed automatic first-use cannot open or mark seen after entering lobby', async () => {
  const f = await mountBrowser({initial: '/?keep=a%20b', holdFirstUse: true, host: subsetHost(['th06', 'th07']), seedStorage(storage) {
    storage.values.delete('eagler-touhou-first-use-notice-seen-v1');
  }});
  await until(() => f.fetches.some(item => new URL(item.url).pathname.endsWith('/content/FIRST_USE_NOTICE.html')), 'Launcher begins automatic first-use read');
  await click('.game[data-product="th07mp"]');
  await until(() => currentUrl().startsWith('/lobby.html'), 'MP card enters the original directory surface');
  await React.act(async () => {f.releaseFirstUse();}); await tick(); await tick();
  assert.equal(node('#firstUseNoticeDialog').open, false, 'retired Launcher request cannot open a modal on the directory');
  assert.equal(f.storage.getItem('eagler-touhou-first-use-notice-seen-v1'), null, 'unshown content is not marked seen');
  await click('#firstUseNoticeOpen');
  await until(() => node('#firstUseNoticeDialog').open, 'manual directory help still opens the already-loaded content');
  assert.equal(f.storage.getItem('eagler-touhou-first-use-notice-seen-v1'), '1');
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/content/FIRST_USE_NOTICE.html')).length, 1);
});

// Main app9784–9793 applies first-use gating on the Launcher independently of
// the lobby's site-notice-only entry. An interrupted load remains unseen.
test('actual BrowserLauncher: unseen first-use resumes automatically on library return after lobby', async () => {
  const f = await mountBrowser({initial: '/?keep=a%20b', holdFirstUse: true, host: subsetHost(['th06', 'th07']), seedStorage(storage) {
    storage.values.delete('eagler-touhou-first-use-notice-seen-v1');
  }});
  await until(() => f.fetches.some(item => new URL(item.url).pathname.endsWith('/content/FIRST_USE_NOTICE.html')), 'Launcher begins first-use read');
  await click('.game[data-product="th07mp"]');
  await until(() => currentUrl().startsWith('/lobby.html'), 'directory replaces the pending Launcher startup context');
  await React.act(async () => {f.releaseFirstUse();}); await tick(); await tick();
  assert.equal(node('#firstUseNoticeDialog').open, false);
  assert.equal(f.storage.getItem('eagler-touhou-first-use-notice-seen-v1'), null);
  await back();
  await until(() => node('#firstUseNoticeDialog').open, 'returning Launcher automatically presents the still-unseen cached notice');
  assert.equal(currentUrl(), '/?keep=a%20b');
  assert.equal(f.storage.getItem('eagler-touhou-first-use-notice-seen-v1'), '1');
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/content/FIRST_USE_NOTICE.html')).length, 1);
  await click('#firstUseNoticeClose'); await until(() => !node('#firstUseNoticeDialog').open, 'closing consumes only the notice entry');
  await click('#firstUseNoticeOpen'); await until(() => node('#firstUseNoticeDialog').open, 'manual reopening still works after automatic presentation');
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/content/FIRST_USE_NOTICE.html')).length, 1);
});


test('actual BrowserLauncher hydrates shared static cards into one live session without duplicate IDs or initial owners', async () => {
  const f = await mountBrowser({initial: '/?keep=a%20b', hydrate: true, noticeEnabled: true}); await tick();
  assert.ok(f.initialNodes.length > 0); assert.ok(f.initialNodes.every(node => !node.isConnected));
  const ids = [...env.document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(env.document.querySelectorAll('#gameFrame').length, 1);
  assert.equal(f.order.filter(value => value === 'boot-ready').length, 1);
  assert.equal(f.fetches.filter(item => new URL(item.url).pathname.endsWith('/NOTICE.txt')).length, 1);
  assert.equal(typeof env.window.__eaglerPrepareManagedRuntimeDataV1, 'function');
  const frame = node('#gameFrame');
  await click('.shelf-lobby-link'); await tick();
  assert.equal(node('#gameFrame'), frame, 'shared route navigation retains the sole live iframe');
  assert.equal(env.document.querySelectorAll('#mastheadMenu').length, 1);
});

for (const locale of ['en', 'zh-CN']) test(`actual BrowserLauncher: room Cancel/Retry owns manual recovery and preserves ${locale} main copy`, async () => {
  const releases = [];
  api.setPackageReadGate(() => new Promise(resolve => {releases.push(resolve);}));
  const host = hostManifest(); host.shared.netplayRelay = 'wss://relay.invalid/socket';
  host.shared.gameDataFallback = {url: 'https://downloads.invalid/package.zip', hint: 'original hint'};
  const f = await mountBrowser({initial: '/?game=th06mp&mpRoom=1234', host, socketBoundary: true,
    seedStorage(storage) {storage.values.set('eagler-touhou-ui-locale-v1', locale);}});
  const session = api.getTestSession();
  await React.act(async () => {session.setLocale(locale);});
  await until(() => releases.length === 1 && !node('#mpRoomResourceCancel').hidden, 'canonical room preparation waits on its first Package Store read');
  await click('#mpRoomResourceCancel');
  // Pinned app6824 calls beginManualGamePackageImport's cancelled-download
  // default (app3377 / i18n346–347), not the generic Import button's intro.
  const reason = locale === 'en'
    ? 'Game-data download from the server was cancelled.\nChoose a local game package to import. If the server provides a fallback download address, you can also use Open link to get the package.'
    : '已取消从服务器下载游戏资源。\n请选择本地游戏包导入；如果服务器提供了备用下载地址，也可以点击「打开链接」取得游戏包。';
  assert.equal(node('#gameDataImportReason').textContent, reason);
  assert.equal(node('#mpRoomResourceProgress').dataset.status, 'cancelled');
  assert.equal(session.gameData.getSnapshot().attempt.continuation.kind, 'install-only');
  await click('#transferDownload'); assert.equal(node('#gameDataLinkWindow').hidden, false);
  const retryStates = [], unsubscribe = session.room.service.subscribe(() => {
    if (session.room.service.getSnapshot().preparation?.status === 'preparing') retryStates.push(session.gameData.getSnapshot().attempt);
  });
  await click('#mpRoomResourceRetry');
  await until(() => releases.length === 2, 'accepted Retry starts a new canonical preparation');
  unsubscribe(); assert.ok(retryStates.length); assert.ok(retryStates.every(attempt => attempt === null), 'main6830 clears recovery before publishing the replacement preparation');
  assert.equal(session.gameData.getSnapshot().attempt, null);
  assert.equal(node('#gameDataImportWindow').hidden, true); assert.equal(node('#gameDataLinkWindow').hidden, true);
  await React.act(async () => {releases[0]();}); await tick();
  assert.equal(node('#mpRoomResourceProgress').dataset.status, 'preparing', 'old cancelled read cannot settle the replacement');
  assert.equal(session.gameData.getSnapshot().attempt, null);
  await React.act(async () => {session.gameData.openManual();});
  const manual = session.gameData.getSnapshot().attempt;
  await React.act(async () => {session.room.service.retryPreparation();});
  assert.deepEqual(session.gameData.getSnapshot().attempt, manual, 'ineligible Retry while preparing cannot clear a valid manual window');
  assert.equal(node('#gameDataImportWindow').hidden, false); assert.equal(releases.length, 2);
  await click('#mpRoomResourceCancel');
  assert.equal(node('#gameDataImportReason').textContent, reason);
  await React.act(async () => {session.gameData.beginManual({kind: 'launch'});});
  const launchAttempt = session.gameData.getSnapshot().attempt;
  await click('#mpRoomResourceRetry'); await until(() => releases.length === 3, 'second accepted Retry starts its own preparation');
  assert.deepEqual(session.gameData.getSnapshot().attempt, launchAttempt, 'main6830 does not clear a launch continuation');
  assert.equal(node('#gameDataImportWindow').hidden, false);
  assert.deepEqual(f.navigations, [], 'resource preparation never launches or replaces Runtime');
  await React.act(async () => {session.room.service.leave(); for (const release of releases) release();});
});

let pinnedRoomImportSource;
function pinnedRoomImportEligible(status, kind) {
  if (!pinnedRoomImportSource) {
    const source = execFileSync('git', ['show', 'edee9633e5e3ee79cd2e1aa334f84f6caf755090:src/launcher/app.mts'], {cwd: project, encoding: 'utf8'});
    const start = source.indexOf('function roomPreparationForImport('), end = source.indexOf('\n}', start);
    assert.ok(start > 0 && end > start);
    pinnedRoomImportSource = transformSync(source.slice(start, end + 2), {loader: 'ts', format: 'cjs'}).code;
  }
  const room = {}, preparation = {room, game: 'th06', status}, sandbox = {roomPreparation: preparation, mpUiState: {room}, state: {game: 'th06'}};
  runInNewContext(pinnedRoomImportSource, sandbox);
  return sandbox.roomPreparationForImport(kind ? {kind} : undefined) === preparation;
}

for (const status of ['ready', 'preparing', 'cancelled', 'failed']) for (const outcome of ['success', 'failure']) {
  test(`actual BrowserLauncher: manual package ${outcome} preserves pinned ${status} room eligibility`, async () => {
    let releaseRead, reads = 0;
    if (status === 'preparing' || status === 'cancelled') {
      const pending = new Promise(resolve => {releaseRead = resolve;});
      api.setPackageReadGate(() => ++reads === 1 ? pending : null);
    }
    const host = hostManifest(); host.shared.netplayRelay = 'wss://relay.invalid/socket';
    const f = await mountBrowser({initial: '/en.html?game=th06mp&mpRoom=1234', host, socketBoundary: true, seedPackages: status === 'ready' ? ['th06'] : []});
    const session = api.getTestSession();
    await until(() => session.room.service.getSnapshot().preparation?.status === (status === 'cancelled' ? 'preparing' : status), 'canonical room preparation reaches the test state');
    if (status === 'cancelled') await click('#mpRoomResourceCancel');
    await React.act(async () => {session.gameData.openManual();});
    const events = [], unsubscribe = session.room.service.subscribe(() => events.push(session.room.service.getSnapshot().preparation?.status));
    const eligible = pinnedRoomImportEligible(status, 'install-only');
    let importing;
    await React.act(async () => {
      importing = session.gameData.importFile(outcome === 'success' ? importPackageFile() : new NativeFile(['invalid fixture ZIP'], 'bad.zip'));
      assert.equal(session.gameData.getSnapshot().busyText, eligible ? 'Importing game package…' : 'Validating and installing game package…');
      assert.equal(session.room.service.getSnapshot().preparation.status, eligible ? 'importing' : status);
      if (eligible) {
        assert.equal(pinnedRoomImportEligible('importing', 'install-only'), true, 'pinned selector admits the same importing preparation on completion');
        const attempt = session.gameData.getSnapshot().attempt;
        session.room.service.retryPreparation();
        assert.deepEqual(session.gameData.getSnapshot().attempt, attempt, 'ineligible Retry during import cannot clear the busy operation');
      }
    });
    await React.act(async () => {await importing;});
    if (outcome === 'success') {
      if (eligible) await until(() => session.room.service.getSnapshot().preparation?.status === 'ready', 'interrupted room resumes real preparation against the committed package');
      assert.equal(node('#status').textContent, eligible ? 'Game package imported; continuing the previous action…' : 'Game package imported; the game is ready to start');
      assert.equal(session.gameData.getSnapshot().attempt, null); assert.equal(node('#gameDataImportWindow').hidden, true);
    } else {
      assert.equal(session.gameData.getSnapshot().busy, false); assert.equal(node('#gameDataImportWindow').hidden, false);
      assert.match(node('#gameDataImportReason').textContent, /ZIP/);
      assert.equal(session.room.service.getSnapshot().preparation.status, eligible ? 'cancelled' : status);
    }
    if (!eligible) {
      assert.ok(events.every(value => value === status), 'ordinary manual import does not publish room importing/cancelled/preparing transitions');
      assert.equal(session.room.service.getSnapshot().preparation.status, status);
    }
    unsubscribe(); assert.deepEqual(f.navigations, [], 'manual install-only recovery does not start Runtime');
    await React.act(async () => {session.room.service.leave(); releaseRead?.();});
  });
}

for (const kind of ['launch', undefined]) test(`actual BrowserLauncher: failed-room import rejects ${kind ?? 'absent'} continuation as a room resume handle`, async () => {
  const host = hostManifest(); host.shared.netplayRelay = 'wss://relay.invalid/socket';
  await mountBrowser({initial: '/en.html?game=th06mp&mpRoom=1234', host, socketBoundary: true});
  const session = api.getTestSession(); await until(() => session.room.service.getSnapshot().preparation?.status === 'failed', 'canonical room preparation fails without a local or published package');
  assert.equal(pinnedRoomImportEligible('failed', kind), false);
  await React.act(async () => {if (kind) session.gameData.beginManual({kind}); else {session.gameData.beginDirectDownload(); session.gameData.unlock('slow');}});
  let importing;
  await React.act(async () => {
    importing = session.gameData.importFile(new NativeFile(['invalid fixture ZIP'], 'bad.zip'));
    assert.equal(session.gameData.getSnapshot().busyText, 'Validating and installing game package…');
    assert.equal(session.room.service.getSnapshot().preparation.status, 'failed');
  });
  await React.act(async () => {await importing;});
  assert.equal(session.room.service.getSnapshot().preparation.status, 'failed');
  assert.equal(node('#gameDataImportWindow').hidden, false);
  await React.act(async () => {session.room.service.leave();});
});

function capturePreparationTimers() {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (![10_000, 20_000, 120_000].includes(delay)) return originalSet(callback, delay, ...args);
    const id = originalSet(() => {}, 2_147_483_647); id.unref?.();
    timers.push({id, delay, callback: () => callback(...args), active: true}); return id;
  };
  globalThis.clearTimeout = id => {const timer = timers.find(value => value.id === id); if (timer) timer.active = false; originalClear(id);};
  return {live: delay => timers.filter(value => value.delay === delay && value.active),
    fire(timer) {assert.ok(timer?.active, 'only an active original timer can fire'); timer.active = false; originalClear(timer.id); timer.callback();},
    restore() {globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; for (const timer of timers) originalClear(timer.id);},
  };
}
let pinnedDirectTimeoutSource;
async function pinnedDirectTimeoutUnlocks(message, current = true) {
  if (!pinnedDirectTimeoutSource) {
    const source = execFileSync('git', ['show', 'edee9633e5e3ee79cd2e1aa334f84f6caf755090:src/launcher/app.mts'], {cwd: project, encoding: 'utf8'});
    const start = source.indexOf('const runtimeReady = waitForRuntimeReady(runtimeSession, t("runtime.gameLoadTimeout")).catch(error => {');
    const end = source.indexOf('\n  });', start); assert.ok(start > 0 && end > start);
    pinnedDirectTimeoutSource = source.slice(start, end + '\n  });'.length);
  }
  const events = [], error = new Error(message), sandbox = {runtimeSession: {}, t: key => key,
    waitForRuntimeReady: () => Promise.reject(error), runtimeSessionCurrent: () => current,
    errorMessage: value => value.message, unlockGameDataImport: value => events.push(value)};
  runInNewContext(`${pinnedDirectTimeoutSource}\nglobalThis.pending = runtimeReady;`, sandbox);
  await assert.rejects(sandbox.pending, value => value === error);
  return events;
}

for (const locale of ['zh-CN', 'en']) test(`actual BrowserLauncher: completed direct preload retains pinned ${locale} timeout recovery and startup error order`, async () => {
  const timers = capturePreparationTimers();
  try {
    const f = await mountBrowser({autoReady: false}), session = api.getTestSession();
    await React.act(async () => {session.setLocale(locale);});
    await start(); await until(() => timers.live(120_000).length === 1 && session.getRuntime().getSnapshot().phase === 'loading', 'real direct Runtime waits the unchanged 120s ready deadline');
    assert.equal(session.getRuntime().getSnapshot().generationId, null);
    await React.act(async () => {f.native.emit('transfer', {kind: 'game', mode: 'runtime', loaded: 100, total: 100});});
    const attempt = session.gameData.getSnapshot().attempt;
    assert.equal(attempt.firstByte, true); assert.equal(attempt.downloadComplete, true); assert.equal(attempt.unlocked, false);
    assert.equal(timers.live(10_000).length, 0); assert.equal(timers.live(20_000).length, 0);
    const events = [], stopImport = session.gameData.subscribe(() => {if (session.gameData.getSnapshot().importOpen) events.push('import');});
    const stopError = session.startupError.subscribe(() => {if (session.startupError.getSnapshot().open) events.push('startup');});
    await React.act(async () => {timers.fire(timers.live(120_000)[0]);}); await tick(); stopImport(); stopError();
    const message = locale === 'zh-CN' ? '游戏加载超时' : 'Game load timed out';
    const expected = await pinnedDirectTimeoutUnlocks(message);
    assert.equal(session.getRuntime().getSnapshot().phase, 'error'); assert.equal(session.getRuntime().getSnapshot().epoch, null);
    assert.equal(session.gameData.getSnapshot().attempt.id, attempt.id);
    assert.equal(session.gameData.getSnapshot().attempt.unlocked, expected.length > 0);
    assert.equal(node('#gameDataImportWindow').hidden, expected.length === 0);
    assert.equal(session.startupError.getSnapshot().open, true); assert.match(node('#startupErrorText').textContent, new RegExp(message));
    assert.equal(node('#playerStatus').textContent, message);
    if (expected.length) {
      assert.ok(events.indexOf('import') >= 0 && events.indexOf('import') < events.indexOf('startup'));
      assert.equal(node('#gameDataImportReason').textContent, '游戏运行组件加载已超时。\n你可以继续等待；如果当前下载太慢，也可以点击「打开链接」取得游戏包后导入。手动导入的本地版本不会被服务器自动替换，只有你主动选择更新时才会更新。');
      await click('#startupErrorClose'); f.autoReady = true;
      await React.act(async () => {await session.gameData.importFile(importPackageFile());});
      await until(() => session.getRuntime().getSnapshot().launched, 'the recovered import commits locally and starts the same Player without another Start click');
      assert.equal(session.gameData.getSnapshot().attempt, null); assert.equal(playerOpen(), true);
    } else assert.deepEqual(events, ['startup'], 'pinned main only matches its literal Chinese timeout expression');
  } finally {timers.restore();}
});

test('actual BrowserLauncher: direct timeout refreshes dismissed recovery reason without reopening it', async () => {
  const timers = capturePreparationTimers();
  try {
    const f = await mountBrowser({autoReady: false}), session = api.getTestSession();
    await React.act(async () => {session.setLocale('zh-CN');}); await start();
    await until(() => timers.live(120_000).length === 1, 'real direct Runtime ready wait');
    await React.act(async () => {f.native.emit('transfer', {kind: 'game', loaded: 1, total: 100}); timers.fire(timers.live(20_000)[0]);});
    assert.equal(node('#gameDataImportWindow').hidden, false); const originalReason = node('#gameDataImportReason').textContent;
    await click('#gameDataImportClose'); assert.equal(node('#gameDataImportWindow').hidden, true);
    await React.act(async () => {timers.fire(timers.live(120_000)[0]);}); await tick();
    assert.equal(session.gameData.getSnapshot().attempt.unlocked, true); assert.equal(session.gameData.getSnapshot().attempt.dialogDismissed, true);
    assert.equal(node('#gameDataImportWindow').hidden, true); assert.notEqual(node('#gameDataImportReason').textContent, originalReason);
    assert.match(node('#gameDataImportReason').textContent, /^游戏运行组件加载已超时。/);
    assert.equal(session.startupError.getSnapshot().open, true);
  } finally {timers.restore();}
});

for (const scenario of ['managed timeout', 'native error', 'closed timeout']) test(`actual BrowserLauncher: ${scenario} cannot unlock unrelated direct import recovery`, async () => {
  const timers = capturePreparationTimers();
  try {
    const f = await mountBrowser({autoReady: false, seedPackages: scenario === 'managed timeout' ? ['th06'] : []}), session = api.getTestSession();
    await React.act(async () => {session.setLocale('zh-CN');}); await start();
    await until(() => timers.live(120_000).length === 1, 'actual native-ready deadline');
    if (scenario === 'native error') await React.act(async () => {f.native.emit('error', {error: 'fixture engine failed'});});
    else if (scenario === 'closed timeout') {
      let closing;
      await React.act(async () => {timers.fire(timers.live(120_000)[0]); closing = session.requestRuntimeClose(); await closing;});
    } else await React.act(async () => {timers.fire(timers.live(120_000)[0]);});
    await tick();
    assert.equal(node('#gameDataImportWindow').hidden, true);
    assert.notEqual(session.gameData.getSnapshot().attempt?.unlocked, true);
    assert.equal(session.startupError.getSnapshot().open, scenario !== 'closed timeout');
    if (scenario === 'closed timeout') {
      assert.deepEqual(await pinnedDirectTimeoutUnlocks('游戏加载超时', false), []);
      assert.equal(session.gameData.getSnapshot().attempt, null); assert.equal(playerOpen(), false);
    }
  } finally {timers.restore();}
});

let pinnedDirectoryEntrySource;
function pinnedDirectoryEntry({product, code, created}) {
  if (!pinnedDirectoryEntrySource) {
    const source = execFileSync('git', ['show', 'edee9633e5e3ee79cd2e1aa334f84f6caf755090:src/launcher/lobby.mts'], {cwd: project, encoding: 'utf8'});
    const start = source.indexOf('function enterRoom('), end = source.indexOf('\n// The launcher link', start);
    assert.ok(start > 0 && end > start);
    pinnedDirectoryEntrySource = transformSync(source.slice(start, end), {loader: 'ts', format: 'cjs'}).code;
  }
  const events = [], sandbox = {connection: 'live', leaving: false, mine: null, URL,
    multiplayerConfigForProduct: api.multiplayerConfigForProduct, encodeRoomInvite: api.encodeRoomInvite, ROOM_INVITE_KEY: 'j',
    launcherUrl: new URL('en.html', env.window.location.href).href,
    identity: {lobbyClientId: value => events.push(['identity', value])},
    sessions: {save: (...args) => events.push(['save', ...args]), clear: value => events.push(['clear', value])},
    render: () => events.push(['render']), disconnect: () => events.push(['disconnect']), location: {assign: url => events.push(['navigate', url])},
  };
  runInNewContext(pinnedDirectoryEntrySource, sandbox);
  sandbox.enterRoom(product, code, created, 2, 2, 'private', true);
  return JSON.parse(JSON.stringify(events));
}
async function liveActualDirectory({strictMode = false} = {}) {
  const host = subsetHost(['th06', 'th07']); host.shared.netplayRelay = 'wss://relay.invalid/socket';
  const f = await mountBrowser({initial: '/lobby.html?game=th06mp', host, socketBoundary: true,
    directoryTransport: true, actualHistory: true, strictMode, seedPackages: ['th06', 'th07']});
  const session = api.getTestSession();
  await React.act(async () => {session.setLocale('en');});
  await until(() => f.sockets.some(socket => new URL(socket.url).searchParams.has('directory')), 'actual directory transport exists');
  const directorySocket = f.sockets.findLast(socket => new URL(socket.url).searchParams.has('directory'));
  await React.act(async () => {directorySocket.open(); directorySocket.message({type: 'directory', version: 1, product: 'th06mp', rooms: [], total: 0});});
  return {f, session, directorySocket};
}
for (const strictMode of [false, true]) for (const action of ['create', 'join by code', 'join row']) {
  test(`actual BrowserLauncher directory ${action} closes before pinned entry and returns (StrictMode=${strictMode})`, async () => {
    const {f, session, directorySocket} = await liveActualDirectory({strictMode}), frame = node('#gameFrame');
    const navigationObservations = [], unsubscribe = f.router.subscribe(state => {
      if (new URLSearchParams(state.location.search).has('j') && !navigationObservations.some(item => item.location.key === state.location.key)) navigationObservations.push({location: state.location, dialogOpen: env.document.querySelector('#roomDialog')?.open === true});
    });
    if (action === 'join row') {
      await React.act(async () => {session.directory.selectProduct('th07mp'); directorySocket.message({type: 'directory', version: 1, product: 'th07mp', total: 1,
        rooms: [{product: 'th07mp', code: '4321', capacity: 2, phase: 'lobby', joinable: true, seats: [{initial: 'R'}, null], difficulty: 2}]});});
      await click('.lobby-join');
    } else {
      await click(action === 'create' ? '#createButton' : '#codeButton'); assert.equal(node('#roomDialog').open, true);
      await React.act(async () => session.directory.updateForm({product: 'th07mp', code: '4321', difficulty: 2, visibility: 'private', disableCheatMovement: true}));
      await click('#submitRoom');
    }
    await until(() => f.sockets.some(socket => new URL(socket.url).searchParams.has('lobby')), 'actual room transport follows accepted entry');
    unsubscribe();
    const roomSocket = f.sockets.find(socket => new URL(socket.url).searchParams.has('lobby'));
    const endpoint = new URL(roomSocket.url), state = session.room.service.getSnapshot(), code = state.room.code;
    const oracle = pinnedDirectoryEntry({product: 'th07mp', code, created: action === 'create'});
    const expectedUrl = new URL(oracle.find(event => event[0] === 'navigate')[1]);
    assert.equal(new Set(navigationObservations.map(item => item.location.pathname + item.location.search)).size, 1, 'entry and original room-history seeding share one canonical invite target');
    assert.equal(navigationObservations[0].location.pathname + navigationObservations[0].location.search, expectedUrl.pathname + expectedUrl.search);
    assert.equal(navigationObservations[0].dialogOpen, false, 'main closes the dialog before navigation');
    assert.equal(endpoint.searchParams.get('room'), `th07mp-${code}`);
    assert.equal(endpoint.searchParams.get('intent'), action === 'create' ? 'create' : 'join');
    assert.equal(session.settings.getSnapshot().context.productId, 'th07mp', 'form/row selection replaces the different directory filter for room settings');
    assert.equal(state.fromDirectory, true); assert.equal(env.document.querySelector('#roomDialog'), null, 'main room document owns no directory form');
    assert.deepEqual(directorySocket.closes, [{code: 1000, reason: 'leave directory'}]);
    if (action === 'create') {
      const expectedRoom = oracle.find(event => event[0] === 'save')[2].room;
      assert.deepEqual(Object.fromEntries(Object.keys(expectedRoom).map(key => [key, state.room[key]])), expectedRoom);
      assert.equal(endpoint.searchParams.get('visibility'), 'private'); assert.equal(endpoint.searchParams.get('disableCheatMovement'), '1');
    } else assert.equal(code, '4321');
    const client = endpoint.searchParams.get('lobby');
    await React.act(async () => {roomSocket.open(); roomSocket.message({type: 'state', roomDirectory: {version: 1, controlModes: true},
      room: {code, playerCount: 2, difficulty: 2, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
        seats: [{clientId: action === 'create' ? client : 'other-host', name: 'R', loadout: 0, ready: false}, null], spectators: []}});});
    if (action !== 'create') assert.equal(roomSocket.sent.findLast(message => message.type === 'take-seat')?.seat, 1);
    await click('#mpLeaveRoom'); await until(() => currentUrl().startsWith('/lobby.html'), 'full leave returns to directory');
    assert.equal(currentUrl(), '/lobby.html?game=th07mp'); assert.equal(session.room.service.getSnapshot().room, null);
    assert.equal(session.directory.getSnapshot().selectedProduct, 'th07mp'); assert.equal(node('#gameFrame'), frame);
    assert.equal(f.sockets.filter(socket => new URL(socket.url).searchParams.has('lobby')).length, 1);
    assert.equal(node('#roomDialog').open, false);
  });
}
for (const strictMode of [false, true]) for (const dismissal of ['cancel', 'Back', 'newer destination', 'newer lobby', 'newer same product', 'unmount']) {
  test(`actual BrowserLauncher directory ${dismissal} never consumes a stale form intent (StrictMode=${strictMode})`, async t => {
    const {f, session} = await liveActualDirectory({strictMode});
    await click('#codeButton'); await React.act(async () => session.directory.updateForm({code: '4321'}));
    if (dismissal === 'cancel') await click('#closeDialog');
    else if (dismissal === 'Back') await back();
    else if (dismissal.startsWith('newer')) {
      await React.act(async () => {node('#submitRoom').click(); void f.router.navigate(dismissal === 'newer lobby' ? '/lobby.html?game=th07mp&newer=1' : dismissal === 'newer same product' ? '/lobby.html?game=th06mp&newer=1' : '/en.html?game=th06&newer=1');});
      await tick(); assert.equal(new URL(currentUrl(), env.window.location.href).searchParams.get('newer'), '1');
    } else {
      // Keep the submitted navigation pending for every stale-intent/unmount
      // assertion below. Only afterward drain its known jsdom history traversal
      // so it cannot reach the next test's Router on this shared window.
      let onPop;
      const traversal = new Promise(resolve => {onPop = resolve; env.window.addEventListener('popstate', onPop, {once: true});});
      t.after(async () => {
        let deadline;
        try {await Promise.race([traversal, new Promise((_, reject) => {deadline = setTimeout(() => reject(new Error('Submitted history traversal did not finish after unmount')), 10000);})]);}
        finally {clearTimeout(deadline); env.window.removeEventListener('popstate', onPop);}
      });
      await React.act(async () => {node('#submitRoom').click(); f.root.unmount();});
      f.root = null; f.router.dispose();
      assert.throws(() => session.setLocale('en'), /Launcher Router is not attached/, 'actual unmount releases the last committed Router port');
      assert.equal(env.document.querySelector('#gameFrame'), null); assert.deepEqual(env.errors, []);
    }
    assert.equal(session.room.service.getSnapshot().room, null);
    assert.equal(f.sockets.filter(socket => new URL(socket.url).searchParams.has('lobby')).length, 0);
    if (dismissal !== 'unmount' && dismissal !== 'newer destination') {
      assert.equal(node('#roomDialog').open, false);
      await click('#codeButton'); await click('#closeDialog');
      assert.equal(f.sockets.filter(socket => new URL(socket.url).searchParams.has('lobby')).length, 0, 'later close cannot replay a retired form');
      if (dismissal === 'newer lobby' || dismissal === 'newer same product') {
        await click('#codeButton'); await React.act(async () => session.directory.updateForm({code: '5678'})); await click('#submitRoom');
        await until(() => f.sockets.some(socket => new URL(socket.url).searchParams.has('lobby')), 'reopened form accepts its own newer submission');
        const roomSocket = f.sockets.find(socket => new URL(socket.url).searchParams.has('lobby'));
        assert.equal(new URL(roomSocket.url).searchParams.get('room'), `${dismissal === 'newer lobby' ? 'th07mp' : 'th06mp'}-5678`);
        assert.equal(session.room.service.getSnapshot().room.code, '5678');
      }
    }
  });
}

// Main app747–774 owns terminal lobby closure. Execute that pinned listener,
// then compare the actual document-lived session, BrowserRouter and feedback.
// Transport/Runtime endpoints remain synthetic; no native browser is exercised.
const terminalPinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
let pinnedTerminalCloseSource, pinnedTerminalMessages;
function pinnedTerminalClose({code, fromDirectory, launched = false, locale = 'en', storageBlocked = false}) {
  if (!pinnedTerminalCloseSource) {
    const source = execFileSync('git', ['show', `${terminalPinnedMain}:src/launcher/app.mts`], {cwd: project, encoding: 'utf8'});
    const start = source.indexOf('  socket.addEventListener("close", event => {', source.indexOf('function mpConnectLobby('));
    const end = source.indexOf('\n  socket.addEventListener("error",', start);
    assert.ok(start > 0 && end > start); pinnedTerminalCloseSource = source.slice(start, end);
    const i18n = execFileSync('git', ['show', `${terminalPinnedMain}:src/launcher/i18n.mts`], {cwd: project, encoding: 'utf8'});
    pinnedTerminalMessages = Object.fromEntries([...i18n.matchAll(/^\s*(\["lobby\.(?:expired|gone|replaced|conflict|removed)".*?\]),?$/gm)]
      .map(match => {const row = JSON.parse(match[1]); return [row[0], {'zh-CN': row[1], en: row[2]}];}));
    assert.equal(Object.keys(pinnedTerminalMessages).length, 5);
  }
  const result = {toasts: [], storageWrites: [], destination: null, retained: true, stopped: false};
  const room = {code: '1234'}, socket = {addEventListener(kind, listener) {assert.equal(kind, 'close'); this.listener = listener;}};
  const sandbox = {socket, room, mpLobby: {socket, connected: true}, mpUiState: {room}, state: {launched, product: 'th06mp'},
    roomNetwork: {reset() {}}, mpLobbyStopped: false,
    t: key => {assert.ok(pinnedTerminalMessages[key]); return pinnedTerminalMessages[key][locale];},
    mpResetRoomState() {sandbox.mpUiState.room = null; result.retained = false;}, mpFromDirectory: () => fromDirectory,
    sessionStorage: {setItem(key, message) {result.storageWrites.push([key, message]); if (storageBlocked) throw new Error('Synthetic blocked session storage');}},
    mpReturnToDirectory() {result.destination = 'directory';},
    launcherOptionsHistoryOperation: () => ({}), applyHistoryOperations() {result.destination = 'options';},
    history: {state: null}, location: {href: 'https://launcher.invalid/'}, render() {}, renderMpRoom() {},
    showToast(message) {result.toasts.push(message);}, mpScheduleLobbyReconnect() {assert.fail('terminal main close cannot schedule reconnect');},
  };
  runInNewContext(pinnedTerminalCloseSource, sandbox); socket.listener({code}); result.stopped = sandbox.mpLobbyStopped;
  return result;
}
async function actualTerminalRoom({fromDirectory, locale = 'en', strictMode = false} = {}) {
  const host = hostManifest(); host.shared.netplayRelay = 'wss://relay.invalid/socket';
  const f = await mountBrowser({initial: `${locale === 'en' ? '/en.html' : '/'}?game=th06mp&mpRoom=1234${fromDirectory ? '&fromLobby=1' : ''}`,
    host, socketBoundary: true, directoryTransport: true, actualHistory: true, strictMode, seedPackages: ['th06'],
    seedStorage(storage) {storage.values.set('eagler-touhou-ui-locale-v1', locale);}});
  const session = api.getTestSession();
  await React.act(async () => {session.setLocale(locale);});
  await until(() => f.sockets.some(value => new URL(value.url).searchParams.has('lobby')), 'actual room transport exists before terminal closure');
  const socket = f.sockets.find(value => new URL(value.url).searchParams.has('lobby'));
  await React.act(async () => {socket.open(); socket.message({type: 'state', roomDirectory: {version: 1, controlModes: true}, room: {
    code: '1234', playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
    seats: [{clientId: new URL(socket.url).searchParams.get('lobby'), name: 'A', loadout: 0, ready: false}, null], spectators: [],
  }});});
  await until(() => session.room.service.getSnapshot().preparation?.status === 'ready', 'canonical local resources are ready');
  return {f, session, socket};
}
function captureTerminalFeedback(session) {
  const initial = session.feedback.getSnapshot(), toasts = [];
  let revision = initial.toastRevision;
  const unsubscribe = session.feedback.subscribe(() => {
    const value = session.feedback.getSnapshot();
    if (value.toastRevision !== revision) {revision = value.toastRevision; toasts.push(value.toast);}
  });
  return {initial, toasts, unsubscribe};
}
for (const locale of ['en', 'zh-CN']) for (const code of [4004, 4007, 4008, 4009, 4010]) for (const fromDirectory of [false, true]) {
  test(`actual BrowserLauncher terminal ${code} ${locale} ${fromDirectory ? 'directory notice' : 'single toast'} matches pinned close`, async () => {
    const {f, session, socket} = await actualTerminalRoom({fromDirectory, locale});
    const expected = pinnedTerminalClose({code, fromDirectory: true, locale}), feedback = captureTerminalFeedback(session);
    const writesBefore = f.sessionStorage.writes.length, removesBefore = f.sessionStorage.removals.length;
    await React.act(async () => {socket.close(code);});
    await until(() => session.room.service.getSnapshot().room === null && currentUrl().startsWith('/lobby.html'), 'terminal departure returns to its fixed lobby parent');
    await tick(); feedback.unsubscribe();
    assert.equal(session.room.service.getSnapshot().connected, false); assert.equal(expected.retained, false); assert.equal(expected.stopped, true);
    assert.equal(f.sessionStorage.getItem('eagler-touhou-th06mp-room-v1'), null);
    assert.equal(f.sessionStorage.removals.slice(removesBefore).filter(key => key === 'eagler-touhou-th06mp-room-v1').length, 1);
    assert.deepEqual(feedback.toasts, expected.toasts, 'one feedback owner; directory departure has no transient toast');
    assert.equal(session.feedback.getSnapshot().toastRevision - feedback.initial.toastRevision, expected.toasts.length);
    assert.deepEqual(f.sessionStorage.writes.slice(writesBefore).filter(([key]) => key === 'eagler-lobby-message'), expected.storageWrites);
    const message = expected.storageWrites[0][1];
    assert.equal(session.directory.getSnapshot().notice, message); assert.equal(node('#notice').textContent, message); assert.equal(node('#notice').hidden, false);
    assert.equal(f.sessionStorage.getItem('eagler-lobby-message'), null, 'directory consumes the committed return message once');
    assert.equal(session.feedback.getSnapshot().toastOpen, feedback.initial.toastOpen);
    const socketCount = f.sockets.filter(value => new URL(value.url).searchParams.has('lobby')).length;
    await React.act(async () => {
      env.window.dispatchEvent(new env.window.Event('online'));
      env.window.dispatchEvent(new env.window.PageTransitionEvent('pageshow', {persisted: true}));
      env.document.dispatchEvent(new env.window.Event('visibilitychange'));
      socket.message({type: 'state', room: {code: '1234'}});
    });
    assert.equal(session.room.service.getSnapshot().room, null);
    assert.equal(f.sockets.filter(value => new URL(value.url).searchParams.has('lobby')).length, socketCount, 'terminal closes cannot be revived by reconnect wakes or stale socket messages');
  });
}
for (const fromDirectory of [false, true]) test(`actual BrowserLauncher terminal launched ${fromDirectory ? 'directory' : 'direct'} room retains one pinned toast and membership`, async () => {
  const {f, session, socket} = await actualTerminalRoom({fromDirectory}), code = 4009;
  await click('[data-mp-seat="0"] .mp-seat-edit'); await click('#mpCheckGame');
  await until(() => session.getRuntime().getSnapshot().launched, 'actual multiplayer preflight Runtime has launched');
  const expected = pinnedTerminalClose({code, fromDirectory, launched: true}), feedback = captureTerminalFeedback(session), before = currentUrl();
  const room = session.room.service.getSnapshot().room, saved = f.sessionStorage.getItem('eagler-touhou-th06mp-room-v1'), writesBefore = f.sessionStorage.writes.length;
  await React.act(async () => {socket.close(code);}); feedback.unsubscribe();
  assert.equal(currentUrl(), before); assert.equal(session.getRuntime().getSnapshot().launched, true); assert.equal(playerOpen(), true);
  assert.equal(session.room.service.getSnapshot().room.code, room.code); assert.equal(session.room.service.getSnapshot().connected, false);
  assert.equal(f.sessionStorage.getItem('eagler-touhou-th06mp-room-v1'), saved);
  assert.deepEqual(feedback.toasts, expected.toasts); assert.equal(session.feedback.getSnapshot().toastRevision - feedback.initial.toastRevision, 1);
  assert.deepEqual(f.sessionStorage.writes.slice(writesBefore).filter(([key]) => key === 'eagler-lobby-message'), expected.storageWrites);
  assert.equal(expected.retained, true); assert.equal(expected.destination, null);
  const sockets = f.sockets.length; await React.act(async () => {session.room.service.reconnect(); session.room.service.pageShow(true);});
  assert.equal(f.sockets.length, sockets, 'retained terminal room still has reconnect stopped');
  await React.act(async () => {f.native.emit('exit', {status: 'error'});});
  await until(() => !playerOpen(), 'authenticated Runtime Exit finishes the synthetic preflight');
});
for (const strictMode of [false, true]) test(`actual BrowserLauncher terminal warm directory return preserves notice (StrictMode=${strictMode})`, async () => {
  const {f, session, directorySocket} = await liveActualDirectory({strictMode});
  assert.equal(session.directory.getSnapshot().initialized, true);
  await click('#createButton'); await click('#submitRoom');
  await until(() => f.sockets.some(value => new URL(value.url).searchParams.has('lobby')), 'actual directory Create enters its room');
  const socket = f.sockets.find(value => new URL(value.url).searchParams.has('lobby')), roomCode = session.room.service.getSnapshot().room.code;
  await React.act(async () => {socket.open(); socket.message({type: 'state', room: {
    code: roomCode, playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
    seats: [{clientId: new URL(socket.url).searchParams.get('lobby'), name: 'A', loadout: 0, ready: false}, null], spectators: [],
  }});});
  const feedback = captureTerminalFeedback(session), expected = pinnedTerminalClose({code: 4010, fromDirectory: true}), writesBefore = f.sessionStorage.writes.length;
  await React.act(async () => {socket.close(4010);});
  await until(() => currentUrl().startsWith('/lobby.html') && !node('#notice').hidden, 'retained directory consumes the terminal return notice');
  feedback.unsubscribe();
  assert.deepEqual(feedback.toasts, expected.toasts); assert.equal(session.room.service.getSnapshot().room, null);
  assert.deepEqual(f.sessionStorage.writes.slice(writesBefore).filter(([key]) => key === 'eagler-lobby-message'), expected.storageWrites);
  assert.equal(node('#notice').textContent, expected.storageWrites[0][1]); assert.equal(session.directory.getSnapshot().notice, expected.storageWrites[0][1]);
  assert.equal(f.sessionStorage.getItem('eagler-lobby-message'), null);
  assert.deepEqual(directorySocket.closes, [{code: 1000, reason: 'leave directory'}]);
  assert.equal(f.sockets.filter(value => new URL(value.url).searchParams.has('lobby')).length, 1);
});
test('actual BrowserLauncher terminal blocked return-message storage preserves pinned departure and no toast', async () => {
  const {f, session, socket} = await actualTerminalRoom({fromDirectory: true});
  const expected = pinnedTerminalClose({code: 4004, fromDirectory: true, storageBlocked: true}), feedback = captureTerminalFeedback(session), writesBefore = f.sessionStorage.writes.length;
  f.sessionStorage.blocked = true;
  await React.act(async () => {socket.close(4004);});
  await until(() => currentUrl().startsWith('/lobby.html') && session.room.service.getSnapshot().room === null, 'storage denial cannot prevent terminal departure');
  feedback.unsubscribe();
  assert.deepEqual(feedback.toasts, expected.toasts);
  assert.deepEqual(f.sessionStorage.writes.slice(writesBefore).filter(([key]) => key === 'eagler-lobby-message'), expected.storageWrites);
  assert.equal(session.directory.getSnapshot().notice, ''); assert.equal(node('#notice').hidden, true);
  f.sessionStorage.blocked = false;
});

for (const origin of ['directory create', 'directory join', 'direct']) test(`actual BrowserLauncher: ${origin} native Exit keeps its room, then Leave returns to lobby`, async () => {
  let f, session, socket, code;
  const fromDirectory = origin !== 'direct';
  if (fromDirectory) {
    ({f, session} = await liveActualDirectory());
    await click(origin === 'directory create' ? '#createButton' : '#codeButton');
    if (origin === 'directory join') await React.act(async () => session.directory.updateForm({code: '5678'}));
    await click('#submitRoom');
    await until(() => f.sockets.some(value => new URL(value.url).searchParams.has('lobby')), 'directory action enters one room');
    socket = f.sockets.find(value => new URL(value.url).searchParams.has('lobby')); code = session.room.service.getSnapshot().room.code;
    await React.act(async () => {socket.open(); socket.message({type: 'state', roomDirectory: {version: 1, controlModes: true}, room: {
      code, playerCount: 2, difficulty: 1, phase: 'lobby', inputDelay: 0, predictionLimit: 8, startSerial: 0,
      seats: [{clientId: new URL(socket.url).searchParams.get('lobby'), name: 'A', loadout: 0, ready: false}, null], spectators: [],
    }});});
    await until(() => session.room.service.getSnapshot().preparation?.status === 'ready', 'room resources prepared');
  } else {({f, session, socket} = await actualTerminalRoom({fromDirectory: false})); code = '1234';}
  const frame = node('#gameFrame'), savedRoom = session.room.service.getSnapshot().room;
  await click('[data-mp-seat="0"] .mp-seat-edit'); await click('#mpCheckGame');
  await until(() => session.getRuntime().getSnapshot().launched, 'actual multiplayer preflight Runtime launched');
  const socketCount = f.sockets.length, sentCount = socket.sent.length;
  await React.act(async () => f.native.emit('exit', {status: 'success'}));
  await until(() => !playerOpen(), 'authenticated Runtime Exit closes Player');
  const invite = api.resolveRoomInvite(new URL(currentUrl(), env.window.location.href));
  assert.equal(invite.g, 'th06mp'); assert.equal(invite.r, code);
  assert.equal(invite.f === true, fromDirectory, 'authorized correction: same-room native return retains directory origin');
  assert.equal(invite.a, undefined, 'native return never repeats create/join');
  for (const key of ['p', 'd', 'v']) assert.equal(invite[key], undefined);
  assert.equal(invite.c, false); assert.equal(session.room.service.getSnapshot().room.code, savedRoom.code);
  assert.equal(session.room.service.getSnapshot().fromDirectory, fromDirectory);
  assert.equal(f.sockets.length, socketCount); assert.equal(socket.sent.length, sentCount); assert.equal(node('#gameFrame'), frame);
  assert.equal(session.getRuntime().getSnapshot().launched, false);
  await click('#mpLeaveRoom');
  await until(() => session.room.service.getSnapshot().room === null, 'subsequent Leave clears membership');
  assert.equal(currentUrl(), '/lobby.html?game=th06mp', 'every room leaves to its fixed lobby parent');
  assert.equal(f.sockets.filter(value => new URL(value.url).searchParams.has('lobby')).length, 1);
});

for (const testBuild of [false, true]) test(`BrowserSession preserves entry test-build flag for acquisition (${testBuild})`, async () => {
  await mountBrowser({initial:`/?game=th06${testBuild ? '&test' : ''}`});
  assert.equal(api.getAcquisitionOptions().testBuild, testBuild);
  assert.equal(new URL(api.getAcquisitionOptions().baseUrl).search, '');
});
