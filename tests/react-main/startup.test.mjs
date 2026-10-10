/** Main head/bootstrap and app9770+ / lobby69–105 policy. Synthetic only. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {encodeRoomInvite} from '../../src/launcher/room-invite.mts';
import {readOriginalBootstrap} from '../../scripts/ui-rewrite/original-bootstrap.ts';
const root = fileURLToPath(new URL('../../', import.meta.url)); let env, work, createStartupController, active = [];
before(async () => {
  env = installMountedDom(); await mkdir(resolve(root, '.cache'), {recursive: true}); work = await mkdtemp(resolve(root, '.cache/startup-main-'));
  const outfile = resolve(work, 'startup.mjs');
  await build({entryPoints: [resolve(root, 'app/services/startup.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{name: 'authored-main', setup(ctx) {ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const path = resolve(dirname(args.importer), args.path), authored = path.slice(0, -4) + '.mts';
      if (path.startsWith(resolve(root, 'src') + '/') && existsSync(authored)) return {path: authored};
    });}}]}); ({createStartupController} = await import(pathToFileURL(outfile).href));
});
afterEach(() => {for (const x of active) x.owner.dispose(); active = []; env.document.body.replaceChildren(); env.document.documentElement.removeAttribute('data-lobby-boot'); env.document.documentElement.removeAttribute('data-original-entry'); assert.deepEqual(env.errors, []);});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
function fixture({path = '/', shown = false, continueVisit = true, warning = null, firstUse = null, directory = null, decode = null} = {}) {
  const events = [], fonts = [], decoded = [], timers = new Map(), frames = new Map(); let serial = 0;
  Object.defineProperty(env.document, 'fonts', {configurable: true, value: {load(font, text) {fonts.push([font, text]); return Promise.resolve([]);}}});
  const window = {addEventListener: env.window.addEventListener.bind(env.window), removeEventListener: env.window.removeEventListener.bind(env.window), innerHeight: 800, setTimeout(fn, delay) {const id = ++serial; timers.set(id, {fn, delay}); return id;}, clearTimeout(id) {timers.delete(id);},
    requestAnimationFrame(fn) {const id = ++serial; frames.set(id, fn); return id;}, cancelAnimationFrame(id) {frames.delete(id);}};
  const owner = createStartupController({document: env.document, window, baseUrl: 'https://launcher.invalid/mount/',
    decodeImage(source) {decoded.push(source); return decode?.promise ?? Promise.resolve();}});
  const ports = {context: path.startsWith('/lobby') ? 'lobby' : 'library', url: `https://launcher.invalid${path}`,
    boot: {ready() {events.push('ready');}}, async waitDirectoryRendered() {events.push('directory'); if (directory) await directory.promise;},
    async warnDiscouragedBrowser(isCurrent) {events.push('warning'); if (warning) await warning.promise; events.push(`warning-current:${isCurrent()}`); return continueVisit;},
    async showFirstUseAutomatically() {events.push('first-use'); if (firstUse) await firstUse.promise; return shown;},
    async loadSiteNotice() {events.push('site');}, onError(error) {events.push(error);}};
  const f = {owner, ports, events, fonts, decoded, timers, frames,
    raf() {const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn();},
    timeout(delay) {for (const [id, entry] of [...timers]) if (entry.delay === delay) {timers.delete(id); entry.fn();}},
  }; active.push(f); return f;
}
test('original boot script/CSS/preload are exact substrings, retaining diagnostic text and deadlines', async () => {
  const sources = readOriginalBootstrap();
  for (const [kind, filename] of [['library', 'index.html'], ['lobby', 'lobby.html']]) {
    const original = await readFile(resolve(root, 'public', filename), 'utf8');
    for (const field of ['script', 'compatibility', 'css', 'preload']) assert.ok(original.includes(sources[kind][field]));
  }
  assert.match(sources.library.compatibility, /var supportedChromium/);
  assert.match(sources.library.compatibility, /compat=continue/);
  assert.match(sources.library.script, /12000/); assert.match(sources.library.script, /EAGLER-BOOT\/1/);
  assert.match(sources.lobby.script, /25000/); assert.match(sources.lobby.preload, /大厅暂时未能加载。/);
});
test('StrictMode attach-cleanup-attach starts one actual ready and warning→first-use→site sequence', async () => {
  const f = fixture(); f.owner.attach(f.ports)(); f.owner.attach(f.ports); await tick();
  assert.deepEqual(f.events, ['ready', 'warning', 'warning-current:true', 'first-use', 'site']);
});
test('direct lobby entry returns to library without calling an absent library boot owner', async () => {
  const f = fixture({path: '/lobby.html'});
  env.document.documentElement.setAttribute('data-original-entry', 'lobby');
  f.ports.boot.ready = () => {throw new Error('Library bootstrap was not installed');};
  const leaveLobby = f.owner.attach(f.ports); await tick(); f.raf(); f.raf();
  leaveLobby();
  const leaveLibrary = f.owner.attach({...f.ports, context: 'library', url: 'https://launcher.invalid/'}); await tick();
  assert.deepEqual(f.events, ['directory', 'site', 'warning', 'warning-current:true', 'first-use', 'site']);
  assert.equal(env.document.documentElement.getAttribute('data-original-entry'), 'lobby');
  leaveLibrary(); f.owner.attach(f.ports); await tick();
  assert.equal(f.events.filter(event => event === 'directory').length, 1);
});
test('first-use shown suppresses site notice; no duplicate initialization after completed binding', async () => {
  const f = fixture({shown: true}); const detach = f.owner.attach(f.ports); await tick(); detach(); f.owner.attach(f.ports); await tick();
  assert.deepEqual(f.events, ['ready', 'warning', 'warning-current:true', 'first-use']);
});
test('FAQ choice ends entry notice sequence', async () => {
  const f = fixture({continueVisit: false}); f.owner.attach(f.ports); await tick();
  assert.deepEqual(f.events, ['ready', 'warning', 'warning-current:true']);
});
test('room entry still gets browser warning but neither first-use nor site notice', async () => {
  const f = fixture({path: `/?j=${encodeRoomInvite({g: 'th06mp', r: '1234'})}`}); f.owner.attach(f.ports); await tick();
  assert.deepEqual(f.events, ['ready', 'warning', 'warning-current:true']);
});
test('actual debug and any nonempty preview skip warning/first-use and load site notice', async () => {
  for (const path of ['/?debug=1', '/?preview=unrelated']) {
    const f = fixture({path}); f.owner.attach(f.ports); await tick(); assert.deepEqual(f.events, ['ready', 'site']);
  }
});
test('lobby embedded-options entry suppresses all automatic notices', async () => {
  const f = fixture(); f.ports.lobbyOptionsEmbed = true; f.owner.attach(f.ports); await tick(); assert.deepEqual(f.events, ['ready']);
});
test('retired warning continuation cannot open first-use or site notice', async () => {
  const warning = deferred(), f = fixture({warning}); const detach = f.owner.attach(f.ports); await tick(); detach(); warning.resolve(); await tick();
  assert.deepEqual(f.events, ['ready', 'warning', 'warning-current:false']);
});
test('retired first-use load cannot revive site notice', async () => {
  const firstUse = deferred(), f = fixture({firstUse}); const detach = f.owner.attach(f.ports); await tick(); detach(); firstUse.resolve(); await tick();
  assert.equal(f.events.includes('site'), false);
});
test('lobby waits for original render boundary, uses exact fonts, double RAF and200ms retirement', async () => {
  const directory = deferred(), f = fixture({path: '/lobby.html', directory});
  env.document.documentElement.dataset.lobbyBoot = 'loading'; env.document.body.innerHTML = '<main class="lobby-main" inert><img src="https://launcher.invalid/cover.webp"></main><div id="lobbyPreload"></div>';
  const main = env.document.querySelector('main'); main.inert = true;
  f.owner.attach(f.ports); await tick(); assert.equal(f.decoded.length, 1); assert.equal(f.frames.size, 0);
  assert.equal(f.events.includes('warning'), false); assert.equal(f.events.includes('first-use'), false); assert.equal(f.events.includes('site'), true);
  directory.resolve(); await tick(); assert.equal(f.fonts.length, 4); assert.match(f.fonts[0][0], /ET Yatra/); assert.equal(f.decoded.length, 2);
  f.raf(); assert.equal(main.inert, true); f.raf(); assert.equal(main.inert, false); assert.equal(env.document.documentElement.hasAttribute('data-lobby-boot'), false);
  assert.equal(env.document.getElementById('lobbyPreload').getAttribute('aria-hidden'), 'true'); f.timeout(200); assert.equal(env.document.getElementById('lobbyPreload'), null);
});
test('lobby3s timeout releases visual gate even with a never-resolving decode', async () => {
  const decode = deferred(), f = fixture({path: '/lobby.html', decode}); env.document.body.innerHTML = '<main class="lobby-main"></main><div id="lobbyPreload"></div>';
  f.owner.attach(f.ports); await tick(); assert.equal(f.frames.size, 0); f.timeout(3000); await tick(); f.raf(); f.raf(); assert.equal(env.document.getElementById('lobbyPreload').classList.contains('is-done'), true);
});
test('lobby cancelled gate cannot reveal a replacement binding', async () => {
  const directory = deferred(), f = fixture({path: '/lobby.html', directory}); env.document.documentElement.dataset.lobbyBoot = 'loading';
  const detach = f.owner.attach(f.ports); await tick(); detach(); directory.resolve(); await tick(); f.raf(); f.raf(); assert.equal(env.document.documentElement.dataset.lobbyBoot, 'loading');
});

test('library deferred fonts load only on first interaction and never duplicate', async () => {
  env.document.querySelectorAll('link[data-deferred-ui-fonts]').forEach(node => node.remove());
  const f = fixture(); f.owner.attach(f.ports); await tick();
  assert.equal(env.document.querySelectorAll('link[data-deferred-ui-fonts]').length, 0);
  env.window.dispatchEvent(new env.window.Event('pointerdown'));
  env.window.dispatchEvent(new env.window.Event('keydown'));
  assert.equal(env.document.querySelectorAll('link[data-deferred-ui-fonts]').length, 1);
  assert.equal(env.document.querySelector('link[data-deferred-ui-fonts]').href, 'https://launcher.invalid/mount/ui-fonts-deferred.css');
});

test('lobby notice completion cannot consume interrupted library first-use on return', async () => {
  const firstUse = deferred(), f = fixture({firstUse, shown: true});
  const leaveLibrary = f.owner.attach(f.ports); await tick();
  assert.equal(f.events.filter(event => event === 'first-use').length, 1);
  leaveLibrary();
  const leaveLobby = f.owner.attach({...f.ports, context: 'lobby', url: 'https://launcher.invalid/lobby.html'}); await tick();
  assert.equal(f.events.filter(event => event === 'site').length, 1);
  firstUse.resolve(); await tick();
  leaveLobby();
  const leaveReturnedLibrary = f.owner.attach(f.ports); await tick();
  assert.equal(f.events.filter(event => event === 'first-use').length, 2, 'unfinished library notice sequence resumes after a different context completes');
  assert.equal(f.events.filter(event => event === 'site').length, 1, 'returned first-use presentation still suppresses the library site notice');
  leaveReturnedLibrary(); f.owner.attach(f.ports); await tick();
  assert.equal(f.events.filter(event => event === 'first-use').length, 2, 'successfully completed library sequence remains once-only');
});
