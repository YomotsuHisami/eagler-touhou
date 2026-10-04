/** Synthetic owner-boundary tests. No browser, retail DATA, real Runtime,
 * IndexedDB or gameplay claims: small injected ports exercise the real service. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ensureLauncherBuild } from '../../lib/launcher-build.mjs';

await ensureLauncherBuild();
const root = fileURLToPath(new URL('../..', import.meta.url));
const compiled = await build({ entryPoints: ['app/services/runtime.client.ts'], bundle: true,
  format: 'esm', platform: 'browser', write: false, logLevel: 'silent', plugins: [{
    name: 'current-main-browser-contract', setup(builder) {
      builder.onResolve({ filter: /product-catalog\.mjs$/ }, args => {
        if (resolve(dirname(args.importer), args.path) === resolve(root, 'product-catalog.mjs')) {
          return { path: resolve(root, 'src/contracts/product-catalog.mts') };
        }
      });
    },
  }] });
const temporary = await mkdtemp(join(tmpdir(), 'ui-main-runtime-test-'));
after(() => rm(temporary, { recursive: true, force: true }));
const modulePath = join(temporary, 'runtime.mjs');
await writeFile(modulePath, compiled.outputFiles[0].text);
const { createRuntimeService, RuntimeSessionSupersededError } = await import(pathToFileURL(modulePath).href);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function drain() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function clock() {
  let now = 0, serial = 0;
  const jobs = new Map();
  const add = (callback, ms, interval) => { const id = ++serial; jobs.set(id, { callback, at: now + ms, interval }); return id; };
  return {
    timers: { setTimeout: (callback, ms) => add(callback, ms, 0), clearTimeout: id => jobs.delete(id),
      setInterval: (callback, ms) => add(callback, ms, ms), clearInterval: id => jobs.delete(id) },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due; now = job.at;
        if (job.interval) job.at += job.interval; else jobs.delete(id);
        job.callback();
      }
      now = end;
    },
    deadlines: () => [...jobs.values()].filter(job => !job.interval).map(job => job.at - now),
  };
}
function generation(game = 'th11', id = `package-${game}`) {
  return { id, game, descriptor: { schema: 'eagler-touhou/package/1', game, revision: 'r1',
    runtimeRequirement: { protocol: 'eagler-touhou/1', target: game, dataFile: 'game-data' },
    files: { 'game-data': { revision: 'r1', source: `${game}.dat`, target: `/${game}.dat`, bytes: 2 },
      font: { revision: 'r1', source: 'font.otf', target: '/unifont.otf', bytes: 2 } },
    base: { files: ['game-data', 'font'] }, components: {} },
    files: { 'game-data': { objectId: 'data-object', revision: 'r1' }, font: { objectId: 'font-object', revision: 'r1' } } };
}
function plan(overrides = {}) {
  return { game: 'th11', runtimeVariant: 'normal', generation: generation(),
    entry: './runtime/th11/th11.html', publishedRuntime: false,
    configure: { music: 'none', options: { limitPresentationTo60: true, thpracLocale: 'ja-JP' } }, ...overrides };
}
function setup(t, { dependencies = {}, options = {}, autoReady = true, autoResponse = true, autoFrame = true } = {}) {
  const scheduler = clock();
  const messages = [], navigations = [], replacements = [], retains = [], releases = [], writes = [], events = [];
  const listeners = new Set(), loadListeners = new Set();
  let service;
  const host = { location: { href: 'https://example.test/mount/games/th11', origin: 'https://example.test' },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener) };
  const runtime = { location: { href: 'about:blank', replace(value) {
      replacements.push(value); runtime.location.href = value; runtime.document = {};
      if (value !== 'about:blank') {
        navigations.push(value);
        if (autoReady) queueMicrotask(() => emit({ event: 'ready' }));
      }
    } }, document: {},
    FS: { mkdirTree() {}, writeFile: (...args) => writes.push(args) },
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
      if (typeof autoResponse === 'function') autoResponse(message, api);
      else if (autoResponse && message.request) queueMicrotask(() => reply(message));
      if (message.command === 'launch' && autoFrame) queueMicrotask(() => emit({ event: 'first-frame' }));
    } };
  const frame = { contentWindow: runtime, isConnected: true,
    set src(_value) { assert.fail('Runtime must use replacement navigation, not iframe src'); },
    removeAttribute() { assert.fail('Runtime must not remove src to navigate'); },
    addEventListener: (_type, listener) => loadListeners.add(listener),
    removeEventListener: (_type, listener) => loadListeners.delete(listener) };
  const envelope = () => ({ protocol: 'eagler-touhou/1', game: service.getSnapshot().game, epoch: service.getSnapshot().epoch });
  function emit(data, eventPatch = {}) {
    const event = { origin: host.location.origin, source: runtime, data: { ...envelope(), ...data }, ...eventPatch };
    for (const listener of listeners) listener(event);
  }
  function reply(message, patch = {}) { emit({ protocol: message.protocol, game: message.game,
    epoch: message.epoch, request: message.request, ok: true, ...patch }); }
  const api = { host, frame, runtime, messages, navigations, replacements, retains, releases, writes, events,
    emit, reply, scheduler, listenerCounts: () => ({ message: listeners.size, load: loadListeners.size }),
    load: () => { for (const listener of loadListeners) listener({ type: 'load' }); } };
  service = createRuntimeService({ frame, hostWindow: host, baseUrl: '/mount/', timers: scheduler.timers,
    onEvent: event => events.push(event), ...options,
    dependencies: {
      retainGeneration: async (game, id, { leaseId }) => { retains.push({ game, id, leaseId }); return leaseId; },
      releaseGeneration: async id => { releases.push(id); },
      readData: async () => ({ buffer: new Uint8Array([1, 2]).buffer, bytes: 2, fileId: 'game-data' }),
      readResource: async (_generation, id) => ({ buffer: new Uint8Array([3, 4]).buffer, bytes: 2, fileId: id, path: '/unifont.otf' }),
      prepareCode: async () => { throw new Error('Unexpected published-code preparation'); }, ...dependencies,
    } });
  t.after(async () => { await service.close({ discardUnsaved: true }); service.dispose(); });
  return { ...api, service };
}
const commands = h => h.messages.filter(item => item.message.request).map(item => item.message.command);

test('TH11 prepare/configure/first-frame/save-close uses the supplied direct frame and main metadata', async t => {
  const h = setup(t, { autoFrame: false });
  const prepared = await h.service.prepare(plan({ resourceFileIds: ['font'] }));
  assert.equal(prepared.phase, 'prepared'); assert.equal(prepared.ready, true); assert.equal(prepared.launched, false);
  assert.equal(prepared.runtimeVariant, 'normal');
  assert.equal(prepared.saveRoot, '/savesth11'); assert.equal(prepared.scoreFile, 'scoreth11.dat');
  assert.deepEqual(prepared.configFiles, ['th11.cfg']);
  assert.equal(h.navigations.length, 1); assert.equal(h.writes[0][0], '/unifont.otf');
  const source = new URL(h.runtime.location.href);
  assert.equal(source.pathname, '/mount/runtime/th11/th11.html');
  assert.equal(source.searchParams.get('gameGeneration'), 'package-th11');
  assert.equal(source.searchParams.get('runtimeEpoch'), String(prepared.epoch));
  await assert.rejects(h.service.prepare(plan()), /Close the current/);
  const launching = h.service.launch(); await drain();
  assert.equal(h.service.getSnapshot().phase, 'launching');
  assert.equal(h.service.getSnapshot().launched, true); assert.equal(h.service.getSnapshot().firstFrame, false);
  h.emit({ event: 'first-frame' }); assert.equal((await launching).phase, 'running');
  assert.equal(await h.service.close(), true); assert.equal(h.runtime.location.href, 'about:blank');
  assert.deepEqual(commands(h), ['configure', 'launch', 'sync']);
  assert.equal(h.retains.length, 1); assert.deepEqual(h.releases, [h.retains[0].leaseId]);
});

test('canonical Adonis fields pass unchanged and timing-only reports preserve renderer', async t => {
  const h = setup(t);
  const configure = { music: 'none', options: { netplayMode: 'lan', netplayAdonisMode: 2,
    netplayInputDelayAuto: true, netplayInputDelay: 3, netplayPredictionReserve: 2,
    netplayPredictionLimit: 16, netplayPlayer: 0, netplaySeed: 7, netplayPlayerCount: 2,
    netplayLoadouts: [{ character: 0, shot: 1 }, { character: 1, shot: 0 }] } };
  await h.service.prepare(plan({ game: 'th08', generation: generation('th08'), runtimeVariant: 'multiplayer',
    entry: './runtime/th08/th08mp.html', configure }));
  assert.deepEqual(h.messages[0].message.options, configure.options);
  assert.equal(h.service.getSnapshot().runtimeVariant, 'multiplayer');
  h.emit({ event: 'runtime-info', renderer: 'WebGL synthetic', architecture: 'wasm32' });
  const timing = { phase: 'measured', mode: 2, inputDelay: 4, reserve: 2 };
  h.emit({ event: 'runtime-info', netplayTiming: timing });
  assert.equal(h.service.getSnapshot().runtimeInfo.renderer, 'WebGL synthetic');
  assert.equal(h.service.getSnapshot().runtimeInfo.architecture, 'wasm32');
  assert.deepEqual(h.service.getSnapshot().netplayTiming, timing);
  assert.deepEqual(h.messages[0].message.options, configure.options, 'native report never rewrites Host configure proposal');
  h.emit({ event: 'runtime-info', renderer: undefined, version: 'synthetic-v1' });
  assert.equal(h.service.getSnapshot().runtimeInfo.renderer, 'WebGL synthetic');
});

test('messages require exact origin, iframe source, game, protocol, request and epoch', async t => {
  const h = setup(t, { autoResponse: (message, api) => { if (message.command === 'configure') queueMicrotask(() => api.reply(message)); } });
  await h.service.prepare(plan());
  let settled = false;
  const reading = h.service.send('read', { path: 'scoreth11.dat' }).then(result => { settled = true; return result; });
  const request = h.messages.at(-1).message;
  const response = { ...request, ok: true, bytes: [1, 2] };
  for (const data of [{ ...response, game: 'th10' }, { ...response, epoch: request.epoch + 1 },
    { ...response, epoch: undefined }, { ...response, protocol: 'wrong' }, { ...response, request: 'other' }]) h.emit(data);
  h.emit(response, { origin: 'https://other.test' }); h.emit(response, { source: {} });
  await drain(); assert.equal(settled, false);
  h.emit(response); assert.deepEqual((await reading).bytes, [1, 2]);
  const oldEpoch = request.epoch;
  await h.service.close({ discardUnsaved: true }); await h.service.prepare(plan());
  h.emit({ event: 'runtime-info', epoch: oldEpoch, renderer: 'stale renderer' });
  assert.deepEqual(h.service.getSnapshot().runtimeInfo, {});
});

test('one bounded health display tick coalesces telemetry without delaying info/RPC/lifecycle', async t => {
  const h = setup(t); await h.service.prepare(plan());
  let notifications = 0;
  const unsubscribe = h.service.subscribe(() => notifications++);
  for (let fps = 0; fps < 200; fps++) {
    h.emit({ event: 'frame-health', fps });
    h.emit({ event: 'audio-health', underruns: fps });
  }
  assert.equal(notifications, 0); assert.equal(h.service.getSnapshot().frameHealth, null);
  h.emit({ event: 'runtime-info', renderer: 'synthetic renderer' });
  h.emit({ event: 'runtime-info', netplayTiming: { phase: 'measured' } });
  assert.equal(notifications, 2);
  assert.equal(h.service.getSnapshot().frameHealth.fps, 199);
  assert.equal(h.service.getSnapshot().audioHealth.underruns, 199);
  assert.equal(h.service.getSnapshot().runtimeInfo.renderer, 'synthetic renderer');
  h.scheduler.advance(250); assert.equal(notifications, 2, 'immediate info flush cancels the pending display tick');
  h.emit({ event: 'frame-health', fps: 60 });
  h.scheduler.advance(249); assert.equal(notifications, 2);
  h.scheduler.advance(1); assert.equal(notifications, 3); assert.equal(h.service.getSnapshot().frameHealth.fps, 60);
  h.emit({ event: 'audio-health', underruns: 999 });
  await h.service.close({ discardUnsaved: true });
  const closed = notifications;
  h.scheduler.advance(250); assert.equal(notifications, closed);
  assert.equal(h.service.getSnapshot().audioHealth, null); unsubscribe();
});

test('save failure leaves the same frame/epoch alive; retry and explicit discard are distinct', async t => {
  let syncFails = true;
  const h = setup(t, { autoResponse: (message, api) => queueMicrotask(() =>
    api.reply(message, message.command === 'sync' && syncFails ? { ok: false, error: 'disk full', errno: 28 } : {})) });
  await h.service.prepare(plan()); await h.service.launch();
  const source = h.runtime.location.href, epoch = h.service.getSnapshot().epoch;
  const closing = h.service.close(); assert.equal(h.service.close(), closing);
  assert.equal(await closing, false);
  assert.equal(h.runtime.location.href, source); assert.equal(h.service.getSnapshot().epoch, epoch);
  assert.equal(h.service.getSnapshot().phase, 'running'); assert.equal(h.service.getSnapshot().saveError, 'disk full');
  assert.equal(h.releases.length, 0); assert.throws(() => h.service.cancel(), /Save and close/);
  assert.throws(() => h.service.dispose(), /Close the Runtime/);
  let decisions = 0;
  assert.equal(await h.service.close({ decide: async () => { decisions++; syncFails = false; return 'retry'; } }), true);
  assert.equal(decisions, 1); assert.equal(h.runtime.location.href, 'about:blank');
  await h.service.prepare(plan()); const before = commands(h).filter(x => x === 'sync').length;
  assert.equal(await h.service.close({ discardUnsaved: true }), true);
  assert.equal(commands(h).filter(x => x === 'sync').length, before);
});

test('exit skips a sync to the dead Runtime and a launch timeout preserves save-close recovery', async t => {
  const h = setup(t, { autoFrame: false });
  await h.service.prepare(plan());
  const launching = h.service.launch(); const rejected = assert.rejects(launching, /first-frame timed out/);
  await drain(); h.scheduler.advance(122_000); await rejected;
  assert.equal(h.service.getSnapshot().phase, 'error'); assert.notEqual(h.runtime.location.href, 'about:blank');
  assert.equal(await h.service.close(), true);
  await h.service.prepare(plan());
  const before = commands(h).filter(x => x === 'sync').length;
  h.emit({ event: 'exit', status: 'success' });
  assert.equal(h.service.getSnapshot().phase, 'exited'); assert.equal(h.runtime.location.href, 'about:blank');
  assert.equal(commands(h).filter(x => x === 'sync').length, before);
});

test('configure uses byte-advance inactivity rather than total duration or repeated progress', async t => {
  const h = setup(t, { options: { timeouts: { configure: 100 } }, autoResponse: false });
  const preparing = h.service.prepare(plan()); await drain();
  assert.equal(h.service.getSnapshot().phase, 'configuring');
  h.scheduler.advance(80); h.emit({ event: 'transfer', mode: 'ogg', loaded: 10 });
  h.scheduler.advance(80); h.emit({ event: 'transfer', mode: 'ogg', loaded: 20 });
  h.scheduler.advance(80);
  assert.equal(h.service.getSnapshot().phase, 'configuring', '240ms total is fine with advancing bytes');
  h.emit({ event: 'transfer', mode: 'ogg', loaded: 20 });
  const rejected = assert.rejects(preparing, /configure timed out/);
  h.scheduler.advance(20); await rejected;
  assert.equal(h.service.getSnapshot().phase, 'error');
});

test('nonzero or failed Runtime exits remain errors after the frame is closed', async t => {
  const h = setup(t);
  for (const exit of [{ status: 'error', code: 1 }, { status: 'success', code: 2 }, { code: 1 }]) {
    await h.service.prepare(plan());
    h.emit({ event: 'exit', ...exit });
    assert.equal(h.service.getSnapshot().phase, 'error');
    assert.equal(h.service.getSnapshot().error, 'Runtime exited abnormally');
    assert.equal(h.service.getSnapshot().exit.code, exit.code);
    assert.equal(h.runtime.location.href, 'about:blank');
  }
  assert.equal(commands(h).includes('sync'), false);
});

test('failed native exit during pending sync cannot turn close into a successful save', async t => {
  const h = setup(t, { autoResponse: (message, api) => {
    if (message.command !== 'sync') queueMicrotask(() => api.reply(message));
  } });
  for (const exit of [{ status: 'error', code: 1 }, { status: 'success', code: 2 }]) {
    await h.service.prepare(plan()); await h.service.launch();
    const closing = h.service.close(); await drain();
    const sync = h.messages.at(-1).message; assert.equal(sync.command, 'sync');
    h.emit({ event: 'exit', ...exit });
    assert.equal(await closing, false, 'abnormal terminal loss does not prove persistence');
    assert.equal(h.service.getSnapshot().phase, 'error');
    assert.equal(h.service.getSnapshot().error, 'Runtime exited abnormally');
    assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
    const terminal = h.service.getSnapshot();
    h.reply(sync); await drain(); assert.equal(h.service.getSnapshot(), terminal, 'late sync ACK cannot erase failure');
    assert.equal(await h.service.close(), false, 'repeated close does not silently erase the failure');
    assert.equal(h.service.getSnapshot(), terminal);
    assert.equal(await h.service.close({ discardUnsaved: true }), true);
  }
});

test('successful native exit during pending sync preserves ordinary exit/leave semantics', async t => {
  const h = setup(t, { autoResponse: (message, api) => {
    if (message.command !== 'sync') queueMicrotask(() => api.reply(message));
  } });
  await h.service.prepare(plan()); await h.service.launch();
  const closing = h.service.close(); await drain();
  h.emit({ event: 'exit', status: 'success', code: 0 });
  assert.equal(await closing, true);
  assert.equal(h.service.getSnapshot().phase, 'exited');
  assert.equal(h.service.getSnapshot().saveError, null);
});

test('concurrent prepares cannot navigate twice, and late rejected retain cannot reset a new session', async t => {
  const firstRetain = deferred(); let count = 0;
  const h = setup(t, { dependencies: { retainGeneration: async (_game, _id, { leaseId }) => ++count === 1 ? firstRetain.promise : leaseId } });
  const preparing = h.service.prepare(plan());
  const rejected = assert.rejects(preparing, RuntimeSessionSupersededError);
  await assert.rejects(h.service.prepare(plan()), /Close the current/);
  h.service.cancel(); await h.service.prepare(plan());
  firstRetain.reject(new Error('old retain transaction failed')); await rejected;
  assert.equal(h.navigations.length, 1); assert.equal(h.service.getSnapshot().phase, 'prepared');
});

test('published Runtime bootstrap retries a whole earlier code generation with a fresh epoch', async t => {
  const preparations = [];
  const h = setup(t, { autoReady: false, dependencies: { prepareCode: async (entry, options) => {
    preparations.push({ entry, exclude: [...options.exclude] });
    const id = String(preparations.length).repeat(64);
    return { url: `https://example.test/mount/runtime/th11/generations/${id}/th11.html`, generation: id, cached: true };
  } } });
  const preparing = h.service.prepare(plan({ publishedRuntime: true })); await drain();
  const first = h.service.getSnapshot().epoch;
  h.emit({ event: 'error', error: 'synthetic bootstrap failure' }); await drain();
  assert.equal(h.navigations.length, 2); assert.notEqual(h.service.getSnapshot().epoch, first);
  assert.deepEqual(preparations[1].exclude, ['1'.repeat(64)]);
  h.emit({ event: 'ready', epoch: first }); await drain(); assert.equal(h.service.getSnapshot().ready, false);
  h.emit({ event: 'ready' }); const prepared = await preparing;
  assert.equal(prepared.codeGeneration, '2'.repeat(64)); assert.equal(prepared.generationId, 'package-th11');
  assert.equal(h.retains.length, 2); assert.equal(h.releases.length, 1);
});

test('cancel during initial retain releases its late lease without navigating', async t => {
  const retaining = deferred();
  const h = setup(t, { dependencies: { retainGeneration: () => retaining.promise } });
  const preparing = h.service.prepare(plan()); const rejected = assert.rejects(preparing, RuntimeSessionSupersededError);
  h.service.cancel(); retaining.resolve('retained'); await rejected;
  assert.equal(h.navigations.length, 0); assert.equal(h.releases.length, 1);
  assert.equal(h.service.getSnapshot().phase, 'idle');
});

test('a late heartbeat cannot resurrect a generation after close', async t => {
  const heartbeat = deferred(); let count = 0, leaseId;
  const h = setup(t, { options: { timeouts: { lease: 100 } }, dependencies: {
    retainGeneration: async (_game, _generation, options) => { leaseId = options.leaseId; return ++count === 1 ? leaseId : heartbeat.promise; },
  } });
  await h.service.prepare(plan()); h.scheduler.advance(100); await drain();
  await h.service.close({ discardUnsaved: true }); assert.deepEqual(h.releases, [leaseId]);
  heartbeat.resolve(leaseId); await drain(); assert.deepEqual(h.releases, [leaseId, leaseId]);
});

test('managed DATA is bound to original generation, game, epoch and document', async t => {
  const data = deferred(); const seen = [];
  const h = setup(t, { dependencies: { readData: generation => { seen.push(generation.id); return data.promise; } } });
  await h.service.prepare(plan());
  const epoch = h.service.getSnapshot().epoch;
  const provider = h.host.__eaglerPrepareManagedRuntimeDataV1;
  await assert.rejects(provider({ game: 'th10', generation: 'package-th11', epoch }), /inactive game generation/);
  await assert.rejects(provider({ game: 'th11', generation: 'new-current-package', epoch }), /inactive game generation/);
  await assert.rejects(provider({ game: 'th11', generation: 'package-th11', epoch: epoch + 1 }), RuntimeSessionSupersededError);
  const read = provider({ game: 'th11', generation: 'package-th11', epoch });
  const rejected = assert.rejects(read, RuntimeSessionSupersededError);
  await h.service.close({ discardUnsaved: true }); await h.service.prepare(plan({ generation: generation('th11', 'new-current-package') }));
  data.resolve({ buffer: new ArrayBuffer(2), bytes: 2, fileId: 'game-data' }); await rejected;
  assert.deepEqual(seen, ['package-th11']); assert.equal(h.service.getSnapshot().phase, 'prepared');
});

test('a managed DATA rejection fails readiness immediately', async t => {
  const h = setup(t, { autoReady: false, dependencies: { readData: async () => { throw new Error('damaged DATA'); } } });
  const preparing = h.service.prepare(plan()); const rejected = assert.rejects(preparing, /damaged DATA/); await drain();
  const epoch = h.service.getSnapshot().epoch;
  await assert.rejects(h.host.__eaglerPrepareManagedRuntimeDataV1({ game: 'th11', generation: 'package-th11', epoch }), /damaged DATA/);
  await rejected; assert.equal(h.service.getSnapshot().phase, 'error'); assert.equal(h.runtime.location.href, 'about:blank');
});

test('late resource reads cannot write into a newer same-WindowProxy session', async t => {
  const resource = deferred();
  const h = setup(t, { dependencies: { readResource: () => resource.promise } });
  const preparing = h.service.prepare(plan({ resourceFileIds: ['font'] }));
  const rejected = assert.rejects(preparing, RuntimeSessionSupersededError); await drain();
  h.service.cancel(); await h.service.prepare(plan());
  resource.resolve({ buffer: new ArrayBuffer(2), bytes: 2, fileId: 'font', path: '/unifont.otf' }); await rejected;
  assert.equal(h.writes.length, 0); assert.equal(h.service.getSnapshot().phase, 'prepared');
});

test('unexpected document replacement invalidates the epoch and all pending RPCs', async t => {
  const h = setup(t, { autoResponse: (message, api) => { if (message.command === 'configure') queueMicrotask(() => api.reply(message)); } });
  await h.service.prepare(plan());
  const reading = h.service.send('read', { path: 'scoreth11.dat' }); const rejected = assert.rejects(reading, RuntimeSessionSupersededError);
  h.runtime.document = {}; h.load(); await rejected;
  assert.equal(h.service.getSnapshot().epoch, null); assert.equal(h.runtime.location.href, 'about:blank');
  assert.equal(h.service.getSnapshot().error, 'Runtime document was replaced');
});

test('live input boundary supports the current owner context without authorizing spectators', async t => {
  const h = setup(t);
  assert.equal(h.service.postInput('keyboard', { code: 'KeyZ', down: true }), false);
  await h.service.prepare(plan()); await h.service.launch();
  const context = h.service.getInputContext();
  assert.equal(context.target, h.runtime); assert.equal(context.epoch, h.service.getSnapshot().epoch);
  assert.equal(h.service.postInput('keyboard', { code: 'KeyZ', down: true, key: 'z', keyCode: 90, location: 0 }), true);
  assert.equal(h.messages.at(-1).message.keyCode, 90); assert.equal(h.messages.at(-1).targetOrigin, 'https://example.test');
  assert.equal(h.service.postInput('sync', {}), false);
  await h.service.close({ discardUnsaved: true });
  await h.service.prepare(plan({ configure: { music: 'none', options: { netplaySpectator: true } } })); await h.service.launch();
  assert.equal(h.service.getInputContext().spectator, true);
  assert.equal(h.service.postInput('keyboard', { code: 'KeyZ', down: true }), false);
});

test('the service rejects a second DATA owner and cross-origin entries', async t => {
  const h = setup(t);
  assert.throws(() => createRuntimeService({ frame: h.frame, hostWindow: h.host, baseUrl: '/mount/' }), /already installed/);
  await assert.rejects(h.service.prepare(plan({ entry: 'https://other.test/runtime.html' })), /share the Launcher origin/);
  assert.equal(h.navigations.length, 0); assert.equal(h.retains.length, 0);
  await assert.rejects(h.service.send('launch', {}), /Lifecycle commands/);
});

test('emergency disposal refuses connected and unknown frames without losing a live session', async t => {
  const h = setup(t); await h.service.prepare(plan()); await h.service.launch();
  const epoch = h.service.getSnapshot().epoch;
  assert.throws(() => h.service.disposeDetachedFrame(), /already removed iframe/);
  delete h.frame.isConnected;
  assert.throws(() => h.service.disposeDetachedFrame(), /already removed iframe/);
  assert.equal(h.service.getSnapshot().epoch, epoch); assert.equal(h.service.getSnapshot().phase, 'running');
  assert.equal(h.releases.length, 0); assert.equal(typeof h.host.__eaglerPrepareManagedRuntimeDataV1, 'function');
});

test('already detached cleanup rejects RPCs, retires timers/hooks/lease and never claims a successful save', async t => {
  const warnings = [];
  const h = setup(t, { options: { onWarning: error => warnings.push(error) },
    autoResponse: (message, api) => { if (message.command !== 'sync' && message.command !== 'read') queueMicrotask(() => api.reply(message)); } });
  await h.service.prepare(plan()); await h.service.launch();
  const reading = h.service.send('read', { path: 'scoreth11.dat' });
  const rejected = assert.rejects(reading, /removed before save\/close/);
  const closing = h.service.close(); await drain();
  h.emit({ event: 'frame-health', fps: 60 });
  const messageCount = h.messages.length;
  h.frame.isConnected = false; h.service.disposeDetachedFrame(); await rejected;
  assert.equal(await closing, false, 'a interrupted save must not report success');
  assert.equal(await h.service.close(), false);
  assert.equal(h.messages.length, messageCount, 'no postMessage or sync is attempted after removal');
  assert.deepEqual(h.listenerCounts(), { message: 0, load: 0 });
  assert.equal(h.host.__eaglerPrepareManagedRuntimeDataV1, undefined);
  assert.equal(h.releases.length, 1); assert.equal(warnings.length, 1);
  assert.equal(h.service.getSnapshot().phase, 'error');
  assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
  const snapshot = h.service.getSnapshot();
  h.scheduler.advance(600_000); await drain();
  assert.equal(h.service.getSnapshot(), snapshot); assert.equal(h.retains.length, 1);
  assert.deepEqual(h.scheduler.deadlines(), []);
  await assert.rejects(h.service.prepare(plan()), /disposed/);
});

test('detached cleanup preserves a previously reported abnormal status', async t => {
  const h = setup(t); await h.service.prepare(plan());
  h.emit({ event: 'error', error: 'native rendering failure' });
  h.frame.isConnected = false; h.service.disposeDetachedFrame();
  assert.equal(h.service.getSnapshot().phase, 'error');
  assert.equal(h.service.getSnapshot().error, 'native rendering failure');
  assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
});

test('job cancellation after DOM removal cannot clear input or navigate the detached frame', async t => {
  const h = setup(t); await h.service.prepare(plan());
  const count = h.messages.length, source = h.runtime.location.href;
  h.frame.isConnected = false;
  h.runtime.location.replace = () => assert.fail('must not navigate a detached frame');
  h.service.cancel();
  assert.equal(h.messages.length, count); assert.equal(h.runtime.location.href, source);
  assert.equal(h.service.getSnapshot().phase, 'error');
  assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
  assert.equal(h.releases.length, 1); assert.deepEqual(h.listenerCounts(), { message: 0, load: 0 });
  assert.equal(await h.service.close(), false);
});

test('known detached frames reject live RPC/input before deferred root cleanup', async t => {
  const h = setup(t); await h.service.prepare(plan()); await h.service.launch();
  const count = h.messages.length;
  h.frame.isConnected = false;
  h.runtime.location.replace = () => assert.fail('must not navigate a detached frame');
  assert.equal(h.service.getInputContext().target, null);
  assert.equal(h.service.postInput('keyboard', { code: 'KeyZ', down: true }), false);
  await assert.rejects(h.service.send('read', { path: 'scoreth11.dat' }), RuntimeSessionSupersededError);
  await assert.rejects(h.service.sync(), RuntimeSessionSupersededError);
  assert.equal(h.messages.length, count);
  assert.equal(await h.service.close(), false);
  assert.equal(h.messages.length, count); assert.equal(h.releases.length, 1);
});

test('detached frame cannot begin a preparation or launch', async t => {
  const idle = setup(t); idle.frame.isConnected = false;
  idle.runtime.location.replace = () => assert.fail('must not navigate a detached frame');
  await assert.rejects(idle.service.prepare(plan()), RuntimeSessionSupersededError);
  assert.equal(idle.retains.length, 0); assert.equal(idle.navigations.length, 0);
  const prepared = setup(t); await prepared.service.prepare(plan());
  const count = prepared.messages.length;
  prepared.frame.isConnected = false;
  prepared.runtime.location.replace = () => assert.fail('must not navigate a detached frame');
  await assert.rejects(prepared.service.launch(), RuntimeSessionSupersededError);
  assert.equal(prepared.messages.length, count); assert.equal(prepared.service.getSnapshot().phase, 'error');
});

test('connected or unknown frame cancellation preserves the existing prelaunch behavior', async t => {
  const h = setup(t);
  for (const connected of [true, undefined]) {
    h.frame.isConnected = connected;
    await h.service.prepare(plan());
    h.service.cancel();
    assert.equal(h.service.getSnapshot().phase, 'idle'); assert.equal(h.runtime.location.href, 'about:blank');
    assert.equal(typeof h.host.__eaglerPrepareManagedRuntimeDataV1, 'function');
  }
  await h.service.prepare(plan()); await h.service.launch();
  assert.throws(() => h.service.cancel(), /Save and close/);
});

test('prepare/launch/close/reprepare/cancel use only explicit replacement navigation on one frame', async t => {
  const h = setup(t); const frame = h.frame, proxy = h.runtime;
  await h.service.prepare(plan());
  const first = h.service.getSnapshot();
  await h.service.launch();
  assert.deepEqual(h.replacements, [first.source], 'launch is a protocol operation, not another navigation');
  assert.equal(await h.service.close(), true);
  await h.service.prepare(plan()); const second = h.service.getSnapshot();
  h.service.cancel();
  assert.deepEqual(h.replacements, [first.source, 'about:blank', second.source, 'about:blank']);
  assert.notEqual(first.epoch, second.epoch);
  assert.equal(h.frame, frame); assert.equal(h.frame.contentWindow, proxy);
  assert.equal(h.service.getSnapshot().phase, 'idle');
});

test('failed clear replacement keeps the connected session/lease and never falls back to src', async t => {
  const h = setup(t); await h.service.prepare(plan()); await h.service.launch();
  const before = h.service.getSnapshot(), replace = h.runtime.location.replace;
  h.runtime.location.replace = target => {
    if (target === 'about:blank') throw new Error('replacement blocked');
    replace(target);
  };
  assert.equal(await h.service.close(), false);
  assert.equal(h.service.getSnapshot().epoch, before.epoch);
  assert.equal(h.service.getSnapshot().ready, true); assert.equal(h.service.getSnapshot().launched, true);
  assert.equal(h.runtime.location.href, before.source); assert.equal(h.releases.length, 0);
  assert.equal(h.service.getSnapshot().saveError, null, 'successful sync is not a fabricated save failure');
  assert.equal(h.service.getSnapshot().saveUnavailable, false);
  assert.match(h.service.getSnapshot().closeError, /Could not clear Runtime iframe: replacement blocked/);
  assert.deepEqual(h.replacements, [before.source]);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close(), true); assert.equal(h.releases.length, 1);
});

test('cancel reports replacement failure and retains its prepared session for explicit retry', async t => {
  const h = setup(t); await h.service.prepare(plan());
  const epoch = h.service.getSnapshot().epoch, replace = h.runtime.location.replace;
  h.runtime.location.replace = () => { throw new Error('replacement unavailable'); };
  assert.throws(() => h.service.cancel(), /Could not clear Runtime iframe/);
  assert.equal(h.service.getSnapshot().epoch, epoch); assert.equal(h.releases.length, 0);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close(), true);
});

test('abnormal native exit warning survives failure to replace its document', async t => {
  const h = setup(t, { autoResponse: (message, api) => {
    if (message.command !== 'sync') queueMicrotask(() => api.reply(message));
  } });
  await h.service.prepare(plan()); await h.service.launch();
  const closing = h.service.close(); await drain();
  const replace = h.runtime.location.replace;
  h.runtime.location.replace = () => { throw new Error('replacement unavailable'); };
  h.emit({ event: 'exit', status: 'error', code: 9 });
  assert.equal(await closing, false);
  assert.equal(h.service.getSnapshot().error, 'Runtime exited abnormally');
  assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
  assert.equal(h.service.getSnapshot().exit.code, 9);
  assert.equal(h.service.getSnapshot().saveUnavailable, true);
  assert.equal(h.service.getSnapshot().ready, false); assert.equal(h.service.getSnapshot().launched, false);
  assert.match(h.service.getSnapshot().closeError, /replacement unavailable/);
  h.emit({ event: 'ready' }); assert.equal(h.service.getSnapshot().ready, false, 'dead native document cannot revive a cleanup-only epoch');
  assert.equal(await h.service.close(), false);
  assert.equal(await h.service.close({ discardUnsaved: true }), false, 'failed clear cannot pretend explicit discard finished');
  assert.equal(h.service.getSnapshot().exit.code, 9);
  assert.equal(h.service.getSnapshot().error, 'Runtime exited abnormally');
  assert.match(h.service.getSnapshot().saveError, /unsaved progress may be lost/);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close({ discardUnsaved: true }), true);
});

test('configure-time native loss survives a transient clear failure and automatic prepare cleanup', async t => {
  const h = setup(t, { autoResponse: false });
  const preparing = h.service.prepare(plan());
  const rejected = assert.rejects(preparing);
  await drain(); assert.equal(h.service.getSnapshot().phase, 'configuring');
  const replace = h.runtime.location.replace;
  let clears = 0;
  h.runtime.location.replace = target => {
    if (target === 'about:blank' && ++clears === 1) throw new Error('transient cleanup failure');
    replace(target);
  };
  h.emit({ event: 'exit', status: 'error', code: 17 });
  await rejected;
  const terminal = h.service.getSnapshot();
  assert.equal(clears, 2, 'prepare retries retiring the failed document');
  assert.equal(terminal.epoch, null); assert.equal(h.releases.length, 1);
  assert.equal(terminal.error, 'Runtime exited abnormally');
  assert.equal(terminal.exit?.code, 17); assert.equal(terminal.saveUnavailable, true);
  assert.match(terminal.saveError, /unsaved progress may be lost/);
  assert.equal(terminal.closeError, null, 'successful cleanup retires only the cleanup failure');
  assert.equal(await h.service.close(), false, 'cleanup is not acknowledgment of possible save loss');
  assert.equal(h.service.getSnapshot(), terminal);
  assert.equal(await h.service.close({ discardUnsaved: true }), true);
});

test('pre-ready native exit has no save-loss acknowledgment requirement after cleanup recovers', async t => {
  for (const transient of [false, true]) {
    const h = setup(t, { autoReady: false });
    const preparing = h.service.prepare(plan());
    const rejected = assert.rejects(preparing);
    await drain(); assert.equal(h.service.getSnapshot().phase, 'loading');
    const replace = h.runtime.location.replace;
    let clears = 0;
    h.runtime.location.replace = target => {
      if (target === 'about:blank' && (++clears === 1 || !transient)) throw new Error('pre-ready cleanup failure');
      replace(target);
    };
    h.emit({ event: 'exit', status: 'error', code: 18 });
    await rejected;
    const terminal = h.service.getSnapshot();
    assert.equal(terminal.error, 'Runtime exited abnormally');
    assert.equal(terminal.exit?.code, 18); assert.equal(terminal.saveUnavailable, true);
    assert.equal(terminal.ready, false); assert.equal(terminal.launched, false);
    assert.equal(terminal.saveError, null, 'the document never became save-ready');
    assert.equal(terminal.epoch === null, transient);
    if (!transient) {
      assert.match(terminal.closeError, /pre-ready cleanup failure/);
      assert.equal(await h.service.close(), false, 'cleanup failure still prevents leaving');
    }
    h.runtime.location.replace = replace;
    assert.equal(await h.service.close(), true, 'cleanup-only retry needs no fictional save-loss consent');
    assert.equal(h.releases.length, 1); assert.deepEqual(commands(h), []);
    assert.equal(h.service.getSnapshot().saveError, null);
  }
});

test('a retained cleanup-only epoch rejects late resource writes and cannot finish preparation', async t => {
  const resource = deferred();
  const h = setup(t, { dependencies: { readResource: () => resource.promise } });
  const preparing = h.service.prepare(plan({ resourceFileIds: ['font'] }));
  const rejected = assert.rejects(preparing, RuntimeSessionSupersededError);
  await drain(); assert.equal(h.service.getSnapshot().phase, 'configuring');
  const epoch = h.service.getSnapshot().epoch, replace = h.runtime.location.replace;
  h.runtime.location.replace = () => { throw new Error('cleanup unavailable'); };
  h.emit({ event: 'exit', status: 'error', code: 19 });
  resource.resolve({ buffer: new ArrayBuffer(2), bytes: 2, fileId: 'font', path: '/unifont.otf' });
  await rejected;
  assert.equal(h.writes.length, 0, 'unchanged document identity does not make exited native code live');
  const terminal = h.service.getSnapshot();
  assert.equal(terminal.epoch, epoch); assert.equal(terminal.phase, 'error');
  assert.equal(terminal.ready, false); assert.equal(terminal.saveUnavailable, true);
  assert.equal(terminal.error, 'Runtime exited abnormally'); assert.equal(terminal.exit?.code, 19);
  assert.match(terminal.saveError, /unsaved progress may be lost/);
  assert.equal(await h.service.close(), false);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close({ discardUnsaved: true }), true, 'ownership remains valid for cleanup alone');
  assert.equal(h.releases.length, 1);
});

test('late managed DATA completion cannot succeed or overwrite terminal loss in a cleanup-only epoch', async t => {
  for (const failure of [false, true]) {
    const data = deferred();
    const h = setup(t, { dependencies: { readData: () => data.promise } });
    await h.service.prepare(plan());
    const epoch = h.service.getSnapshot().epoch;
    const reading = h.host.__eaglerPrepareManagedRuntimeDataV1({ game: 'th11', generation: 'package-th11', epoch });
    const rejected = assert.rejects(reading, RuntimeSessionSupersededError);
    const replace = h.runtime.location.replace;
    h.runtime.location.replace = () => { throw new Error('cleanup unavailable'); };
    h.emit({ event: 'exit', status: 'error', code: 21 });
    const terminal = h.service.getSnapshot();
    if (failure) data.reject(new Error('late DATA read failure'));
    else data.resolve({ buffer: new ArrayBuffer(2), bytes: 2, fileId: 'game-data' });
    await rejected;
    assert.equal(h.service.getSnapshot(), terminal, 'late completion cannot overwrite the native terminal report');
    assert.equal(terminal.error, 'Runtime exited abnormally');
    assert.equal(terminal.saveUnavailable, true); assert.match(terminal.saveError, /unsaved progress may be lost/);
    h.runtime.location.replace = replace;
    assert.equal(await h.service.close({ discardUnsaved: true }), true);
  }
});

test('an acknowledged launch cannot resume live state after native exit leaves a cleanup-only epoch', async t => {
  const h = setup(t, { autoFrame: false, autoResponse: (message, api) => {
    if (message.command === 'configure') queueMicrotask(() => api.reply(message));
  } });
  await h.service.prepare(plan());
  const launching = h.service.launch();
  const rejected = assert.rejects(launching, RuntimeSessionSupersededError);
  const launch = h.messages.at(-1).message;
  assert.equal(launch.command, 'launch');
  const replace = h.runtime.location.replace;
  h.runtime.location.replace = () => { throw new Error('cleanup unavailable'); };
  // The ACK and frame report resolve native waits before their continuations run.
  h.reply(launch); h.emit({ event: 'first-frame' });
  h.emit({ event: 'exit', status: 'error', code: 20 });
  await rejected;
  const terminal = h.service.getSnapshot();
  assert.equal(terminal.phase, 'error'); assert.equal(terminal.launched, false);
  assert.equal(terminal.ready, false); assert.equal(terminal.saveUnavailable, true);
  assert.equal(terminal.error, 'Runtime exited abnormally'); assert.equal(terminal.exit?.code, 20);
  assert.match(terminal.saveError, /unsaved progress may be lost/);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close({ discardUnsaved: true }), true);
});

test('unexpected child traversal during sync preserves terminal save-risk instead of reporting success', async t => {
  const h = setup(t, { autoResponse: (message, api) => {
    if (message.command !== 'sync') queueMicrotask(() => api.reply(message));
  } });
  await h.service.prepare(plan()); await h.service.launch();
  const closing = h.service.close(); await drain();
  h.runtime.document = {}; h.runtime.location.href = 'about:blank'; h.load();
  assert.equal(await closing, false);
  assert.match(h.service.getSnapshot().saveError, /document was replaced; unsaved progress may be lost/);
  assert.equal(await h.service.close(), false);
});

test('document loss with failed clear retains cleanup identity but advertises saving as unavailable', async t => {
  const h = setup(t); await h.service.prepare(plan()); await h.service.launch();
  const before = h.service.getSnapshot(), replace = h.runtime.location.replace;
  h.runtime.document = {};
  h.runtime.location.replace = () => { throw new Error('cleanup blocked'); };
  h.load();
  const lost = h.service.getSnapshot();
  assert.equal(lost.epoch, before.epoch); assert.equal(h.releases.length, 0);
  assert.equal(lost.saveUnavailable, true); assert.equal(lost.ready, false); assert.equal(lost.launched, false);
  assert.match(lost.saveError, /unsaved progress may be lost/); assert.match(lost.closeError, /cleanup blocked/);
  assert.throws(() => h.service.cancel(), /Save and close/);
  assert.throws(() => h.service.dispose(), /Acknowledge the lost Runtime/);
  await assert.rejects(h.service.sync(), /not ready/);
  assert.equal(await h.service.close(), false);
  h.runtime.location.replace = replace;
  assert.equal(await h.service.close({ discardUnsaved: true }), true);
  assert.equal(h.service.getSnapshot().saveUnavailable, false);
});
