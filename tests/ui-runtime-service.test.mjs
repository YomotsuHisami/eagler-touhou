/** Runtime business boundary tests. The transport is a deterministic frame port;
 * these prove orchestration and race handling, not WASM gameplay/device behavior. */
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), 'ui-runtime-service-'));
const bundle = resolve(directory, 'service.mjs');
await build({ entryPoints: { service: resolve(root, 'app/services/runtime.client.ts'), assets: resolve(root, 'app/services/runtime-assets.ts') }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: directory, outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'authored-browser-contracts', setup(build) { build.onResolve({ filter: /^\./ }, args => {
    const path = resolve(args.resolveDir, args.path);
    if (/^(product-catalog|release-catalog|runtime-protocol|host-manifest|resource-mode)\.mjs$/.test(args.path.split('/').at(-1)) &&
        (dirname(path) === root || dirname(path) === resolve(root, 'lib/contracts'))) {
      return { path: resolve(root, 'src/contracts', args.path.split('/').at(-1).replace(/\.mjs$/, '.mts')) };
    }
    if (path.startsWith(resolve(root, 'src') + '/') && path.endsWith('.mjs') && existsSync(path.replace(/\.mjs$/, '.mts'))) return { path: path.replace(/\.mjs$/, '.mts') };
  }); } }],
});
const { createRuntimeService, RuntimeSaveError } = await import(pathToFileURL(bundle));
const { recoverInstalledRuntimeGeneration } = await import(pathToFileURL(resolve(directory, 'assets.mjs')));
after(() => rm(directory, { recursive: true, force: true }));
const protocol = 'eagler-touhou/1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function generation(game = 'th06', id = 'gen-existing') {
  return { id, game, descriptor: { schema: 'eagler-touhou/package/1', game, revision: 'r1',
    runtimeRequirement: { protocol, target: game, dataFile: 'game-data' },
    files: { 'game-data': { revision: 'r1', source: `${game}.data`, target: `/${game}.data`, bytes: 3 },
      font: { revision: 'r1', source: 'msgothic.ttc', target: '/msgothic.ttc', bytes: 1 },
      unicode: { revision: 'r1', source: 'unifont.otf', target: '/unifont.otf', bytes: 1 } },
    base: { files: ['game-data', 'font', 'unicode'] }, components: {} },
    files: { 'game-data': { objectId: 'data', revision: 'r1' }, font: { objectId: 'font', revision: 'r1' }, unicode: { objectId: 'unicode', revision: 'r1' } } };
}
function fixture({ dependencies = {}, timeouts = {}, autoReady = true, response = null, fetchResponse = null, realLanguage = false } = {}) {
  const messages = [], events = [], writes = [], retained = [], released = [], saved = [];
  let onMessage;
  const host = { location: { href: 'https://launcher.test/games/th06', origin: 'https://launcher.test' },
    addEventListener(type, listener) { assert.equal(type, 'message'); onMessage = listener; },
    removeEventListener() { onMessage = null; } };
  const runtime = Object.assign(new EventTarget(), {
    location: { href: 'about:blank' }, document: {}, Module: {},
    FS: { mkdirTree() {}, writeFile(path, bytes) { writes.push([path, Array.from(bytes)]); } },
    postMessage(message, origin) {
      assert.equal(origin, host.location.origin); messages.push(message);
      queueMicrotask(() => {
        const result = response?.(message);
        if (result === false) return;
        if (message.command === 'launch') emit({ event: 'first-frame' });
        if (message.request) emit({ request: message.request, ok: true, ...(message.command === 'read' ? { bytes: [1, 2] } : {}), ...result });
      });
    },
  });
  const frame = {
    contentWindow: runtime, _src: '', get src() { return this._src; },
    set src(value) { this._src = value; runtime.location.href = value; runtime.document = {}; events.push('navigate'); if (autoReady) queueMicrotask(() => emit({ event: 'ready', saveRoot: `/saves${game()}` })); },
    removeAttribute(name) { assert.equal(name, 'src'); this._src = ''; events.push('reset'); },
    addEventListener() {}, removeEventListener() {},
  };
  const epoch = () => Number(new URL(frame.src || 'https://launcher.test/').searchParams.get('runtimeEpoch'));
  const game = () => /\/runtime\/(th\d+)\//.exec(frame.src)?.[1] || 'th06';
  function emit(data, override = {}) { onMessage?.({ data: { protocol, game: game(), epoch: epoch(), ...data }, origin: host.location.origin, source: runtime, ...override }); }
  const service = createRuntimeService({ hostWindow: host, storage: null, baseUrl: 'https://launcher.test/',
    fetchImpl: async input => fetchResponse?.(input) || (new URL(input).pathname.endsWith('release-catalog.json') ? Response.json({ schema: 'eagler-touhou/release-catalog/1', games: {} }) : new Response('No host metadata', { status: 404 })),
    dependencies: {
      acquireGeneration: async context => generation(context.game),
      retainGeneration: async (game, id, lease) => { retained.push([game, id, lease.leaseId]); return lease.leaseId; },
      releaseGeneration: async id => { released.push(id); },
      readData: async () => ({ buffer: new Uint8Array([1, 2, 3]).buffer, bytes: 3, fileId: 'game-data' }),
      readResource: async (generation, id) => ({ buffer: new Uint8Array([9]).buffer, bytes: 1, fileId: id, path: generation.descriptor.files[id].target }),
      ...(!realLanguage ? { prepareLanguage: async () => null } : {}),
      applyPendingSave: async () => { events.push('apply-slot'); },
      updateActiveSave: async (product, bytes) => saved.push([product, [...bytes]]),
      readSavedScore: async () => new Uint8Array([3, 4]),
      ...dependencies,
    }, timeouts: { ready: 200, configure: 100, launch: 100, firstFrame: 200, command: 100, ...timeouts },
  });
  service.bindFrame(frame);
  return { service, frame, runtime, host, emit, epoch, messages, events, writes, retained, released, saved };
}

test('actual service runs prepare/configure/resources/save-slot/launch and successful synced close', async () => {
  const f = fixture();
  try {
    const result = await f.service.launch({ productId: 'th06', music: 'none' });
    assert.equal(result.phase, 'running'); assert.equal(result.firstFrame, true);
    assert.equal(result.generationId, 'gen-existing');
    assert.equal(new URL(f.frame.src).searchParams.get('gameGeneration'), 'gen-existing');
    assert.deepEqual(f.messages.map(item => item.command), ['configure', 'launch']);
    assert.equal(f.messages[0].music, 'none'); assert.equal(f.messages[0].language, 'ja');
    assert.equal(f.messages[0].epoch, result.epoch);
    assert.deepEqual(f.writes.map(([path]) => path), ['/msgothic.ttc', '/unifont.otf']);
    assert.ok(f.events.indexOf('apply-slot') > f.events.indexOf('navigate'));
    await f.service.close();
    assert.deepEqual(f.messages.slice(-2).map(item => item.command), ['sync', 'read']);
    assert.deepEqual(f.saved, [['th06', [1, 2]]]);
    assert.equal(f.service.getSnapshot().phase, 'idle'); assert.equal(f.frame.src, '');
    assert.equal(f.released.length, 1);
  } finally { f.service.dispose(); }
});

test('single carrier refuses replacement; source, origin, game, and epoch gate ready', async () => {
  const f = fixture({ autoReady: false });
  try {
    const launch = f.service.prepare({ productId: 'th06', music: 'none' });
    await tick();
    assert.throws(() => f.service.bindFrame({ ...f.frame }), /single stable/);
    for (const [data, override] of [
      [{ event: 'ready', epoch: f.epoch() - 1 }, {}], [{ event: 'ready', game: 'th07' }, {}],
      [{ event: 'ready' }, { origin: 'https://other.test' }], [{ event: 'ready' }, { source: {} }],
    ]) f.emit(data, override);
    assert.equal(f.service.getSnapshot().ready, false);
    f.emit({ event: 'ready' }); await launch;
    assert.equal(f.service.getSnapshot().phase, 'prepared');
    assert.equal(f.messages.some(message => message.command === 'launch'), false);
  } finally { f.service.dispose(); }
});

test('canceling an awaited package retain releases its eventual lease without navigating', async () => {
  const late = deferred(); let captured;
  const f = fixture({ dependencies: { retainGeneration: async (...args) => { captured = args; return late.promise; } } });
  try {
    const launch = f.service.launch({ productId: 'th06', music: 'none' });
    const rejected = assert.rejects(launch, { name: 'AbortError' });
    await tick(); f.service.cancel(); late.resolve(captured[2].leaseId); await rejected;
    assert.equal(f.frame.src, ''); assert.deepEqual(f.released, [captured[2].leaseId]);
    assert.equal(f.service.getSnapshot().phase, 'idle');
  } finally { f.service.dispose(); }
});

test('stale DATA provider awaits cannot return bytes to a new session', async () => {
  const read = deferred(); const f = fixture({ dependencies: { readData: () => read.promise } });
  try {
    await f.service.prepare({ productId: 'th06', music: 'none' });
    const provider = f.host.__eaglerPrepareManagedRuntimeDataV1;
    const oldEpoch = f.epoch();
    const data = provider({ game: 'th06', generation: 'gen-existing', epoch: oldEpoch });
    const rejected = assert.rejects(data, { name: 'AbortError' });
    await f.service.prepare({ productId: 'th06', music: 'none' });
    read.resolve({ buffer: new ArrayBuffer(3), bytes: 3, fileId: 'game-data' }); await rejected;
    await assert.rejects(provider({ game: 'th06', generation: 'gen-existing', epoch: oldEpoch }), { name: 'AbortError' });
    await assert.rejects(provider({ game: 'th06', generation: 'other-generation', epoch: f.epoch() }), /inactive game generation/);
  } finally { f.service.dispose(); }
});

test('late same-WindowProxy resource read cannot write into a replaced document', async () => {
  const read = deferred();
  const f = fixture({ dependencies: { readResource: () => read.promise } });
  try {
    const launch = f.service.prepare({ productId: 'th06', music: 'none' });
    const rejected = assert.rejects(launch, { name: 'AbortError' });
    await tick(); f.runtime.document = {};
    read.resolve({ buffer: new ArrayBuffer(1), bytes: 1, fileId: 'font', path: '/msgothic.ttc' });
    await rejected; assert.equal(f.writes.length, 0);
  } finally { f.service.dispose(); }
});

test('failed save preserves live iframe and offers retry or explicitly discarded close', async () => {
  let failSync = true;
  const f = fixture({ response: message => message.command === 'sync' && failSync ? { ok: false, error: 'IDBFS quota' } : undefined });
  try {
    await f.service.launch({ productId: 'th06', music: 'none' }); const source = f.frame.src;
    await assert.rejects(f.service.close(), RuntimeSaveError);
    assert.equal(f.frame.src, source); assert.equal(f.service.getSnapshot().launched, true);
    assert.match(f.service.getSnapshot().saveError, /quota/);
    failSync = false; await f.service.close(); assert.equal(f.frame.src, '');
    await f.service.launch({ productId: 'th06', music: 'none' }); failSync = true;
    await f.service.close({ discardUnsaved: true }); assert.equal(f.service.getSnapshot().phase, 'idle');
  } finally { f.service.dispose(); }
});

test('localized fallback preserves preference input while selecting effective TH10 save identity', async () => {
  const f = fixture({ dependencies: { prepareLanguage: async () => { throw Error('missing translation'); } } });
  try {
    const request = { productId: 'th10', language: 'lang_zh-hans', music: 'none' };
    await f.service.launch(request);
    assert.equal(request.language, 'lang_zh-hans');
    assert.equal(f.service.getSnapshot().language, 'ja');
    assert.equal(f.service.getSnapshot().storageFile, 'jp/scoreth10.dat');
    assert.match(f.service.getSnapshot().warnings.join(' '), /missing translation/);
    assert.equal(f.messages[0].runtimePack, null);
  } finally { f.service.dispose(); }
});

test('exit waits on Runtime-owned persisted save and refreshes current slot', async () => {
  const f = fixture();
  try {
    await f.service.launch({ productId: 'th06', music: 'none' });
    f.emit({ event: 'exit', status: 'success', code: 0 }); await tick();
    assert.equal(f.service.getSnapshot().phase, 'exited');
    assert.equal(f.frame.src, ''); assert.deepEqual(f.saved, [['th06', [3, 4]]]);
  } finally { f.service.dispose(); }
});

test('input is epoch-bound, direct bridge consumes once, and spectators cannot inject input', async () => {
  const f = fixture();
  try {
    await f.service.launch({ productId: 'th06', music: 'none', options: { touchEnabled: true } });
    let direct = 0;
    f.runtime.__eaglerDirectInputBridge = { schema: 'eagler-touhou/direct-input/1', protocol, game: 'th06', epoch: f.epoch(), origin: f.host.location.origin, submit() { direct++; return true; } };
    assert.equal(f.service.postInput('keyboard', { down: true, code: 'KeyZ' }), true);
    assert.equal(direct, 1); assert.equal(f.messages.filter(message => message.command === 'keyboard').length, 0);
    assert.equal(f.service.getSnapshot().inputOptions.touchEnabled, true);
    await f.service.close({ discardUnsaved: true });
    await f.service.launch({ productId: 'th06mp', music: 'none', configureOptions: { netplayMode: 'lan', netplaySpectator: true } });
    assert.equal(f.service.getInputContext().spectator, true);
    assert.equal(f.service.postInput('keyboard', { down: true, code: 'KeyZ' }), false);
  } finally { f.service.dispose(); }
});

test('replay launch removes room netplay payload and preserves multiplayer runtime identity', async () => {
  const f = fixture();
  try {
    await f.service.launch({ productId: 'th06mp', music: 'none', replayViewer: true, configureOptions: { netplayMode: 'lan', netplayPlayer: 1 } });
    assert.equal(new URL(f.frame.src).searchParams.get('runtimeVariant'), 'multiplayer');
    assert.equal(f.messages[0].options.replayViewer, true);
    assert.equal(Object.keys(f.messages[0].options).some(key => key.startsWith('netplay')), false);
  } finally { f.service.dispose(); }
});

function hostManifest({ languagePack = null, runtimeManifest = false } = {}) {
  return { schema: 'eagler-touhou/host-manifest/1', protocol, profile: 'web-validation-test',
    shared: { resourceMode: 'hosted', vanillaFont: '/font.ttf', unicodeFont: '/unicode.ttf', ...(runtimeManifest ? { runtimeManifest: 'runtime-manifest.json' } : {}) },
    games: { th06: { runtime: runtimeManifest ? `runtime/th06/g/${'a'.repeat(64)}/th06.html` : 'runtime/th06/th06.html',
      gameData: { path: 'th06.data', bytes: 3, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}` },
      music: { midi: { files: [] } },
      languages: languagePack ? [{ id: 'lang_en', pack: languagePack }] : [],
      languageOptions: [{ id: 'ja', pack: null }, ...(languagePack ? [{ id: 'lang_en', pack: languagePack }] : [])] } } };
}

test('production language preparation verifies real ZIP SHA/size and passes validated inline pack', async () => {
  const path = '/thcrap/th06/strings.js';
  const payload = new TextEncoder().encode('hello');
  const manifest = { schema: 'eagler-touhou/thcrap-static-pack/1', game: 'th06', language: 'lang_en', runtimeVersion: 'test-v1', files: [{ path, bytes: payload.length }] };
  const zip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), [path.slice(1)]: payload });
  const hash = createHash('sha256').update(zip).digest('hex');
  const host = hostManifest({ languagePack: { url: '/language.zip', bytes: zip.length, sha256: hash, runtimeVersion: 'test-v1' } });
  let downloads = 0;
  const f = fixture({ realLanguage: true, fetchResponse: input => {
    const pathname = new URL(input).pathname;
    if (pathname === '/host-manifest.json') return Response.json(host);
    if (pathname === '/language.zip') { downloads++; return new Response(zip); }
  } });
  try {
    await f.service.launch({ productId: 'th06', language: 'lang_en', music: 'none' });
    assert.equal(downloads, 1);
    assert.equal(f.service.getSnapshot().language, 'lang_en');
    assert.equal(f.messages[0].runtimePack.manifest.runtimeVersion, 'test-v1');
    assert.deepEqual([...f.messages[0].runtimePack.files[0].bytes], [...payload]);
  } finally { f.service.dispose(); }
});

test('corrupted real remote ZIP fails integrity before configure and uses Japanese fallback', async () => {
  const host = hostManifest({ languagePack: { url: '/language.zip', bytes: 3, sha256: 'f'.repeat(64), runtimeVersion: 'test-v1' } });
  const f = fixture({ realLanguage: true, fetchResponse: input => {
    const pathname = new URL(input).pathname;
    if (pathname === '/host-manifest.json') return Response.json(host);
    if (pathname === '/language.zip') return new Response(new Uint8Array([1, 2, 3]));
  } });
  try {
    await f.service.launch({ productId: 'th06', language: 'lang_en', music: 'none' });
    assert.equal(f.service.getSnapshot().language, 'ja');
    assert.match(f.service.getSnapshot().warnings.join(' '), /SHA-256/);
    assert.equal(f.messages[0].runtimePack, null);
  } finally { f.service.dispose(); }
});

test('managed DATA failure rejects readiness immediately and preserves actionable error', async () => {
  const f = fixture({ autoReady: false, dependencies: { readData: async () => { throw Error('damaged DATA'); } } });
  try {
    const launch = f.service.launch({ productId: 'th06', music: 'none' });
    const rejected = assert.rejects(launch, /damaged DATA/);
    await tick();
    await assert.rejects(f.host.__eaglerPrepareManagedRuntimeDataV1({ game: 'th06', generation: 'gen-existing', epoch: f.epoch() }), /damaged DATA/);
    await rejected;
    assert.equal(f.service.getSnapshot().phase, 'error');
    assert.match(f.service.getSnapshot().error, /重新导入或修复/);
    assert.equal(f.frame.src, '');
  } finally { f.service.dispose(); }
});

test('command timeout does not abandon a live save or accept a stale ACK', async () => {
  const f = fixture({ timeouts: { command: 10 }, response: message => message.command === 'read' ? false : undefined });
  try {
    await f.service.launch({ productId: 'th06', music: 'none' });
    await assert.rejects(f.service.read('score.dat'), /read 操作超时/);
    assert.equal(f.service.getSnapshot().launched, true);
    const request = f.messages.at(-1).request;
    f.emit({ request, ok: true, bytes: [1] });
    assert.equal(f.service.getSnapshot().phase, 'running');
  } finally { f.service.dispose(); }
});

function legacyRecoveryFixture() {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const version = `sha256-${sha256}`;
  const metadataKey = 'eagler-touhou-game-data-import-v1-th06';
  const musicKey = 'eagler-touhou-ogg-import-v1-th06';
  const values = new Map([[metadataKey, JSON.stringify({ source: 'local-import', game: 'th06', version, sha256, bytes: 3, layout: `sha256-${'b'.repeat(64)}` })],
    [musicKey, JSON.stringify({ source: 'local-import', game: 'th06', version, files: ['theme.ogg'] })]]);
  const assets = new Map([
    [`https://launcher.test/.eagler-local/game-data/th06/${version}/th06.data`, new Response(bytes)],
    [`https://launcher.test/.eagler-local/ogg/th06/${version}/theme.ogg`, new Response(new Uint8Array([7, 8]))],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) };
  const cacheStorage = { match: async key => assets.get(key)?.clone(), open: async () => ({ delete: async key => assets.delete(key) }), delete: async () => { assets.clear(); return true; } };
  const context = { game: 'th06', metadata: { hostManifest: null, releaseCatalog: null, errors: [] }, baseUrl: 'https://launcher.test/', signal: new AbortController().signal,
    fetchImpl: async () => { throw Error('recovery must not download'); }, assertCurrent() {}, progress() {}, storage, cacheStorage };
  return { context, values, assets, metadataKey, musicKey };
}

test('canonical legacy DATA/OGG migration commits same local bytes before removing compatibility source', async () => {
  const f = legacyRecoveryFixture(); let current = null; let calls = 0;
  const recovered = await recoverInstalledRuntimeGeneration(f.context, {
    readCurrent: async () => ({ installation: null, generation: current }),
    installParsed: async parsed => {
      calls++;
      assert.equal(f.values.has(f.metadataKey), true, 'legacy source must still exist during commit');
      assert.equal(f.assets.size, 2);
      assert.equal(parsed.descriptor.runtimeRequirement.dataFile, 'game-data');
      assert.deepEqual([...new Uint8Array(await parsed.files.get('game-data').blob.arrayBuffer())], [1, 2, 3]);
      assert.deepEqual([...new Uint8Array(await parsed.files.get('ogg:theme.ogg').blob.arrayBuffer())], [7, 8]);
      current = { id: 'gen-migrated', game: 'th06', descriptor: parsed.descriptor, files: {} };
      return { generation: current, installation: { game: 'th06', source: 'local', currentGeneration: current.id, pendingGeneration: null } };
    },
  });
  assert.equal(recovered.id, 'gen-migrated'); assert.equal(calls, 1);
  assert.equal(f.values.has(f.metadataKey), false); assert.equal(f.values.has(f.musicKey), false); assert.equal(f.assets.size, 0);
});

test('failed canonical legacy migration preserves every original byte and metadata record', async () => {
  const f = legacyRecoveryFixture();
  await assert.rejects(recoverInstalledRuntimeGeneration(f.context, {
    readCurrent: async () => ({ installation: null, generation: null }),
    installParsed: async () => { throw Error('Package commit denied'); },
  }), /Package commit denied/);
  assert.equal(f.values.has(f.metadataKey), true); assert.equal(f.values.has(f.musicKey), true); assert.equal(f.assets.size, 2);
});

test('existing canonical package is returned unchanged without migration or redownload', async () => {
  const f = legacyRecoveryFixture(); const current = generation();
  const recovered = await recoverInstalledRuntimeGeneration(f.context, {
    readCurrent: async () => ({ installation: null, generation: current }),
    migrateLegacy: async () => { throw Error('must not replace current'); },
  });
  assert.equal(recovered, current); assert.equal(f.assets.size, 2);
});

test('cancelled post-commit migration keeps compatibility source for a safe later cleanup', async () => {
  const f = legacyRecoveryFixture(); let active = true;
  f.context.assertCurrent = () => { if (!active) throw new DOMException('cancelled', 'AbortError'); };
  await assert.rejects(recoverInstalledRuntimeGeneration(f.context, {
    readCurrent: async () => ({ installation: null, generation: null }),
    installParsed: async () => { active = false; return { generation: generation(), installation: null }; },
  }), { name: 'AbortError' });
  assert.equal(f.values.has(f.metadataKey), true); assert.equal(f.assets.size, 2);
});

test('frame/audio/debug and transfer bursts coalesce to four display notifications per second', async t => {
  const f = fixture();
  try {
    await f.service.launch({ productId: 'th06', music: 'none' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let notifications = 0;
    f.service.subscribe(() => notifications++);
    for (let window = 0; window < 4; window++) {
      for (let i = 0; i < 120; i++) {
        const sequence = window * 120 + i;
        f.emit({ event: 'frame-health', fps: sequence });
        f.emit({ event: 'audio-health', queuedMs: sequence });
        f.emit({ event: 'player-debug', sequence });
        f.emit({ event: 'transfer', mode: 'ogg', loaded: sequence, total: 480 });
        f.emit({ event: 'first-frame' }); // A duplicate event cannot turn into a render loop.
      }
      assert.equal(notifications, window, 'no per-message React store notifications');
      t.mock.timers.tick(249); assert.equal(notifications, window);
      t.mock.timers.tick(1); assert.equal(notifications, window + 1);
      const latest = window * 120 + 119;
      assert.equal(f.service.getSnapshot().diagnostics['frame-health'].fps, latest);
      assert.equal(f.service.getSnapshot().diagnostics['audio-health'].queuedMs, latest);
      assert.equal(f.service.getSnapshot().diagnostics['player-debug'].sequence, latest);
      assert.equal(f.service.getSnapshot().progress.loaded, latest);
    }
    assert.equal(notifications, 4);
  } finally { f.service.dispose(); }
});

test('critical Runtime error flushes latest telemetry immediately without a delayed overwrite', async t => {
  const f = fixture();
  try {
    await f.service.launch({ productId: 'th06', music: 'none' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let notifications = 0; f.service.subscribe(() => notifications++);
    f.emit({ event: 'frame-health', fps: 59 });
    f.emit({ event: 'transfer', mode: 'ogg', loaded: 12, total: 20 });
    assert.equal(notifications, 0);
    f.emit({ event: 'error', error: 'render failure' });
    assert.equal(notifications, 1);
    assert.equal(f.service.getSnapshot().phase, 'error');
    assert.equal(f.service.getSnapshot().error, 'render failure');
    assert.equal(f.service.getSnapshot().diagnostics['frame-health'].fps, 59);
    assert.equal(f.service.getSnapshot().progress, null);
    t.mock.timers.tick(1_000);
    assert.equal(notifications, 1); assert.equal(f.service.getSnapshot().error, 'render failure');
  } finally { f.service.dispose(); }
});

test('reset and dispose cancel telemetry ticks and cannot publish late old-epoch state', async t => {
  const f = fixture();
  try {
    await f.service.prepare({ productId: 'th06', music: 'none' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let notifications = 0; f.service.subscribe(() => notifications++);
    f.emit({ event: 'frame-health', fps: 20 });
    f.emit({ event: 'transfer', mode: 'runtime', loaded: 2, total: 10 });
    f.service.cancel();
    assert.equal(notifications, 1); assert.equal(f.service.getSnapshot().phase, 'idle');
    assert.equal(f.service.getSnapshot().progress, null);
    t.mock.timers.tick(1_000); assert.equal(notifications, 1);
    await f.service.prepare({ productId: 'th06', music: 'none' });
    f.emit({ event: 'frame-health', fps: 42 });
    f.service.dispose();
    const atDispose = notifications, snapshot = f.service.getSnapshot();
    t.mock.timers.tick(1_000);
    assert.equal(notifications, atDispose); assert.equal(f.service.getSnapshot(), snapshot);
    assert.equal(snapshot.phase, 'idle');
  } finally { f.service.dispose(); }
});

test('transfer display throttling does not defer configure inactivity renewal or ACKs', async t => {
  const f = fixture({ response: message => message.command === 'configure' ? false : undefined });
  try {
    const preparing = f.service.prepare({ productId: 'th06', music: 'none' });
    await tick();
    // The first timer was made before mocked time. Its first progress update
    // renews it onto the deterministic clock, preserving the real protocol path.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let notifications = 0; f.service.subscribe(() => notifications++);
    f.emit({ event: 'transfer', mode: 'ogg', loaded: 1, total: 4 });
    t.mock.timers.tick(75);
    f.emit({ event: 'transfer', mode: 'ogg', loaded: 2, total: 4 });
    t.mock.timers.tick(75);
    f.emit({ event: 'transfer', mode: 'ogg', loaded: 3, total: 4 });
    assert.equal(notifications, 0);
    const configure = f.messages.find(message => message.command === 'configure');
    f.emit({ request: configure.request, ok: true });
    await preparing;
    assert.equal(f.service.getSnapshot().phase, 'prepared');
    assert.equal(notifications, 1);
    t.mock.timers.tick(1_000); assert.equal(notifications, 1);
  } finally { f.service.dispose(); }
});

test('input snapshot reflects the effective configure payload rather than mutable preferences', async () => {
  const f = fixture();
  try {
    const request = { productId: 'th06mp', music: 'none', replayViewer: true,
      options: { thpracEnabled: true, touchMovementMode: 'touch', touchSensitivity: 150 },
      configureOptions: { touchEnabled: true, touchMovementMode: 'joystick', touchSensitivity: 230, touchFocusMode: 'toggle-button', netplaySpectator: true } };
    await f.service.launch(request);
    const snapshot = f.service.getSnapshot();
    assert.equal(snapshot.inputOptions.thpracEnabled, false, 'multiplayer does not expose unsupported thprac controls');
    assert.equal(snapshot.inputOptions.touchEnabled, true);
    assert.equal(snapshot.inputOptions.touchMovementMode, 'joystick');
    assert.equal(snapshot.inputOptions.touchSensitivity, 230);
    assert.equal(snapshot.inputOptions.touchFocusMode, 'toggle-button');
    assert.equal(snapshot.spectator, false, 'Replay removes room-only fields before input authority is captured');
    assert.equal(snapshot.replayViewer, true);
    request.options.touchSensitivity = 100;
    assert.equal(snapshot.inputOptions.touchSensitivity, 230);
    assert.equal(Object.isFrozen(snapshot.inputOptions), true);
  } finally { f.service.dispose(); }
});
