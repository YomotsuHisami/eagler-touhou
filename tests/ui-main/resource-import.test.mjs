/** Real ZIP readers + synthetic Package ports; no browser or IndexedDB claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync, strToU8} from 'fflate';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'resource-import-'));
after(() => rm(folder, {recursive: true, force: true}));
const sourcePlugin = {name: 'source-contracts', setup(builder) {
  builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path);
    const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
    if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
    const authored = path.replace(/\.mjs$/, '.mts');
    if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
  });
}};
async function bundle(name, entry, plugins = []) {
  const result = await build({entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [...plugins, sourcePlugin]});
  assert.doesNotMatch(result.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
  const path = join(folder, `${name}.mjs`); await writeFile(path, result.outputFiles[0].text); return import(pathToFileURL(path).href);
}
const {createResourceImport} = await bundle('service', 'app/services/resource-import.client.ts');
const {detachCurrentPackageGeneration, stagePendingPackageGeneration, cancelPendingPackageGeneration, commitPendingPackageGeneration} = await bundle('store', 'package/package-store.mjs');
const storeNames = ['attachPendingPackageObject', 'attestPackageObjectSha256', 'cancelPendingPackageGeneration', 'commitPendingPackageGeneration',
  'garbageCollectPackageStore', 'putPendingPackageObject', 'refreshPendingPackageOperation', 'packageMimeType', 'readPackageObject', 'readCurrentPackageGeneration',
  'readVerifiedPackageObjectBySha256', 'readPackageObjectKeys', 'stagePendingPackageGeneration', 'detachCurrentPackageGeneration'];
const mockStorePlugin = {name: 'synthetic-package-store', setup(builder) {
  builder.onResolve({filter: /package-store\.mjs$/}, () => ({path: 'store', namespace: 'test-store'}));
  builder.onLoad({filter: /.*/, namespace: 'test-store'}, () => ({contents: storeNames.map(name => `export const ${name}=(...args)=>globalThis.__resourceCore.${name}(...args);`).join('\n'), loader: 'js'}));
}};
const core = await bundle('installer', 'package/package-installer.mjs', [mockStorePlugin]);
const hash = data => createHash('sha256').update(data).digest('hex');
const bytes = strToU8('abc');
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {resolve, promise};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function descriptor(game = 'th06') {
  return {schema: 'eagler-touhou/package/1', game, revision: 'package-one',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: game, dataFile: 'data', dataLayout: `sha256-${'a'.repeat(64)}`},
    files: {data: {source: `${game}.data`, target: `/${game}.data`, revision: 'data-one', bytes: 3, sha256: hash(bytes)},
      music: {source: 'bgm/track.ogg', target: '/bgm/track.ogg', revision: 'music-one', bytes: 3, sha256: hash(bytes)}},
    base: {files: ['data']}, components: {ogg: {type: 'ogg', files: ['music']}}};
}
function makeZip(data = descriptor(), extra = {}) {
  return new Blob([zipSync({'package.json': strToU8(JSON.stringify(data)), [data.files.data.source]: bytes, [data.files.music.source]: bytes, ...extra}, {level: 0})]);
}
function fixture(game = 'th06') {
  const original = descriptor(game);
  let current = {installation: {game, source: 'remote', currentGeneration: 'original', pendingGeneration: null},
    generation: {game, id: 'original', descriptor: original, files: {data: {objectId: 'data-object', revision: 'data-one'}}}};
  const imports = [], removals = [], network = [];
  const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release', shared: {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf'},
    games: {[game]: {runtime: `runtime/${game}/${game}.html`, gameData: {path: `${game}.data`, bytes: 3, sha256: hash(bytes), version: `sha256-${hash(bytes)}`, layout: original.runtimeRequirement.dataLayout}, music: {midi: {files: []}}}}};
  const options = {baseUrl: 'https://example.test/app/', fetchImpl: async url => {network.push(String(url)); return new Response(JSON.stringify(host), {headers: {'content-type': 'application/json'}});},
    dependencies: {readCurrent: async id => {assert.equal(id, game); return current;},
      install: async args => {
        imports.push(args); assert.equal(args.source, 'local'); assert.equal(args.reuseCurrent, false);
        if (args.expectedGenerationId !== current.installation.currentGeneration) throw Object.assign(Error('changed generation'), {name: 'PackageGenerationChangedError'});
        const files = {};
        for (const id of args.desiredFileIds) {const acquired = await args.acquire(id, args.descriptor.files[id]); assert.equal(new Uint8Array(acquired).length, args.descriptor.files[id].bytes ?? 3); files[id] = {objectId: `new-${id}`, revision: args.descriptor.files[id].revision};}
        current = {installation: {game, source: 'local', currentGeneration: 'imported', pendingGeneration: null}, generation: {game, id: 'imported', descriptor: args.descriptor, files}};
        return current;
      },
      remove: async (id, args) => {
        removals.push({id, ...args}); if (args.expectedGenerationId !== current.installation.currentGeneration) throw Error('changed generation');
        current = {installation: {...current.installation, currentGeneration: null}, generation: null}; return current.installation;
      },
    }};
  return {options, original, host, imports, removals, network, get current() {return current;}, set current(value) {current = value;}};
}

test('ZIP inspection reads real CRC/SHA and stages an immutable review without importing', async () => {
  const f = fixture(), service = createResourceImport(f.options);
  const review = await service.inspectImport('th06mp', makeZip(), 'touhou.zip');
  assert.equal(review.gameId, 'th06'); assert.equal(review.format, 'package-zip'); assert.equal(review.sha256VerifiedFiles, 2);
  assert.equal(review.previousGenerationId, 'original'); assert.ok(Object.isFrozen(review));
  assert.equal(f.imports.length, 0); assert.equal(f.network.length, 0);
  await service.confirm(review.id);
  assert.equal(f.imports.length, 1); assert.equal(f.current.installation.source, 'local'); assert.equal(service.getSnapshot().review, null);
  assert.equal(service.getSnapshot().outcome.generationId, 'imported'); service.dispose();
});

test('wrong game, corrupt hash, missing base and missing required shared resources cannot receive confirmation', async () => {
  for (const [game, mutate] of [
    ['th06', data => {data.game = 'th07'; data.runtimeRequirement.target = 'th07';}],
    ['th06', data => {data.files.data.sha256 = 'f'.repeat(64);}],
    ['th06', data => {data.files.absent = {...data.files.data, source: 'absent'}; data.base.files.push('absent');}],
    ['th08', () => {}],
  ]) {
    const f = fixture(game), service = createResourceImport(f.options), data = descriptor(game); mutate(data);
    await assert.rejects(service.inspectImport(game, makeZip(data), 'bad.zip'));
    assert.equal(service.getSnapshot().review, null); assert.equal(f.imports.length, 0); service.dispose();
  }
});

test('modern Package without full SHA keeps compatibility but explicitly reports the weaker check', async () => {
  const f = fixture(), service = createResourceImport(f.options), data = descriptor(); delete data.files.music.sha256;
  const review = await service.inspectImport('th06', makeZip(data), 'old-package.zip');
  assert.equal(review.sha256VerifiedFiles, 1); assert.match(review.warnings.join(' '), /CRC32/); service.dispose();
});

test('raw DATA uses product filename whitelist plus validated Host bytes/hash', async () => {
  const f = fixture('th20'), service = createResourceImport(f.options);
  const review = await service.inspectImport('th20', new Blob([bytes]), 'TH20.DAT');
  assert.equal(review.format, 'raw-data'); assert.equal(review.files, 1); assert.equal(f.imports.length, 0);
  await service.confirm(review.id);
  assert.equal(f.imports[0].descriptor.files['game-data'].sha256, hash(bytes));
  assert.equal(f.imports[0].descriptor.files['game-data'].target, '/th20.data');
  assert.deepEqual(f.imports[0].desiredFileIds, ['game-data']); service.dispose();
});

test('raw DATA mismatch or unsupported product filename cannot import', async () => {
  for (const [game, body, name] of [['th20', 'abd', 'th20.dat'], ['th20', 'a', 'th20.dat'], ['th06', 'abc', 'th06.dat']]) {
    const f = fixture(game), service = createResourceImport(f.options);
    await assert.rejects(service.inspectImport(game, new Blob([body]), name)); assert.equal(f.imports.length, 0); service.dispose();
  }
});

test('legacy missing-package fallback uses the real read-only adapter and canonical local writer', async () => {
  const f = fixture(), service = createResourceImport(f.options);
  const manifest = {schema: 'eagler-touhou/game-data-pack/1', game: 'th06', version: `sha256-${hash(bytes)}`,
    data: {path: 'th06.data', layout: `sha256-${'a'.repeat(64)}`, bytes: 3, sha256: hash(bytes)}};
  const zip = new Blob([zipSync({'manifest.json': strToU8(JSON.stringify(manifest)), 'th06.data': bytes}, {level: 0})]);
  const review = await service.inspectImport('th06', zip, 'legacy.zip');
  assert.equal(review.format, 'legacy-zip'); assert.match(review.warnings.join(' '), /Runtime/);
  await service.confirm(review.id); assert.deepEqual(f.imports[0].desiredFileIds, ['game-data']); service.dispose();
});

test('malformed modern Package does not fall back to legacy manifest', async () => {
  const f = fixture(); let legacyReads = 0;
  const service = createResourceImport({...f.options, dependencies: {...f.options.dependencies, parseLegacy: async () => {legacyReads++; throw Error('unexpected');}}});
  const zip = new Blob([zipSync({'package.json': strToU8('{broken'), 'manifest.json': strToU8('{}')}, {level: 0})]);
  await assert.rejects(service.inspectImport('th06', zip, 'broken.zip')); assert.equal(legacyReads, 0); service.dispose();
});

test('replacement review invalidates the old token and preserves newer installation on confirmation conflict', async () => {
  const f = fixture(), service = createResourceImport(f.options);
  const first = await service.inspectImport('th06', makeZip(), 'one.zip');
  const second = await service.inspectImport('th06', makeZip(), 'two.zip');
  await assert.rejects(service.confirm(first.id), error => error.code === 'stale-review'); assert.equal(f.imports.length, 0);
  f.current = {installation: {...f.current.installation, currentGeneration: 'another'}, generation: {...f.current.generation, id: 'another'}};
  await assert.rejects(service.confirm(second.id), /changed generation/); assert.equal(f.current.generation.id, 'another'); service.dispose();
});

test('cancel fences delayed parsing, holds busy ownership until settlement and drops input/review', async () => {
  const f = fixture(), gate = deferred(); let parsed;
  const source = createResourceImport(f.options); const preliminary = await source.inspectImport('th06', makeZip(), 'one.zip'); source.cancel();
  assert.equal(source.getSnapshot().review, null); await assert.rejects(source.confirm(preliminary.id), error => error.code === 'stale-review'); source.dispose();
  const service = createResourceImport({...f.options, dependencies: {...f.options.dependencies, parseZip: async () => {await gate.promise; return parsed;}}});
  const task = service.inspectImport('th06', makeZip(), 'two.zip'); await tick(); service.cancel();
  await assert.rejects(service.inspectImport('th06', makeZip(), 'other.zip'), error => error.code === 'busy'); gate.resolve();
  await assert.rejects(task, error => error.code === 'cancelled'); assert.equal(f.imports.length, 0); assert.equal(service.getSnapshot().review, null); service.dispose();
});

// Small transaction port drives actual store logic without claiming IndexedDB
// conformance. It records exactly which stores/writes were requested.
function transactionPort(initial, {onGet, onPut} = {}) {
  const stores = new Map([['installations', new Map([['th06', structuredClone(initial)]])], ['generations', new Map()], ['objects', new Map()], ['leases', new Map()]]);
  const log = [];
  const keyOf = key => Array.isArray(key) ? JSON.stringify(key) : key;
  const db = {close() {}, transaction(names, mode) {
    log.push({names, mode}); const pending = []; let aborted = false;
    const tx = {objectStore(name) {return {get(key) {const request = {}; queueMicrotask(() => {onGet?.(); request.onsuccess?.({target: {result: structuredClone(stores.get(name).get(keyOf(key)))}});}); return request;},
      put(value, key) {pending.push(() => stores.get(name).set(keyOf(key), structuredClone(value))); onPut?.();},
      delete(key) {pending.push(() => stores.get(name).delete(keyOf(key)));}};},
      abort() {aborted = true; queueMicrotask(() => tx.onabort?.());}};
    setTimeout(() => {if (!aborted) {pending.forEach(apply => apply()); tx.oncomplete?.();}}, 0); return tx;
  }};
  return {stores, log, factory: {open() {const request = {}; queueMicrotask(() => request.onsuccess?.({target: {result: db}})); return request;}}};
}

test('core detach atomically clears only the current pointer and never touches leased objects/generations', async () => {
  const initial = {game: 'th06', currentGeneration: 'original', pendingGeneration: null, source: 'local'};
  const f = transactionPort(initial);
  f.stores.get('leases').set('runtime', {generationId: 'original'}); f.stores.get('objects').set('data', bytes); f.stores.get('generations').set('original', {id: 'original'});
  const result = await detachCurrentPackageGeneration('th06', {expectedGenerationId: 'original', indexedDBFactory: f.factory});
  assert.equal(result.currentGeneration, null); assert.equal(result.source, 'local'); assert.equal(result.removedGenerationId, 'original');
  assert.deepEqual(f.log, [{names: ['installations'], mode: 'readwrite'}]);
  for (const name of ['leases', 'objects', 'generations']) assert.equal(f.stores.get(name).size, 1);
});

test('core detach rejects cancelled, stale, and pending-install attempts without writes', async () => {
  for (const mode of ['before', 'during-read', 'stale', 'pending']) {
    const controller = new AbortController(), initial = {game: 'th06', currentGeneration: 'original', pendingGeneration: mode === 'pending' ? 'pending' : null, source: 'local'};
    if (mode === 'before') controller.abort();
    const f = transactionPort(initial, {onGet: mode === 'during-read' ? () => controller.abort() : undefined});
    await assert.rejects(detachCurrentPackageGeneration('th06', {expectedGenerationId: mode === 'stale' ? 'different' : 'original', signal: controller.signal, indexedDBFactory: f.factory}));
    await tick(); assert.deepEqual(f.stores.get('installations').get('th06'), initial);
  }
});

function corePort() {
  const data = descriptor(); let staged = null;
  let current = {installation: {game: 'th06', currentGeneration: 'original', pendingGeneration: null, source: 'local'},
    generation: {id: 'original', game: 'th06', descriptor: data, files: {data: {objectId: 'old', revision: 'data-one'}}}};
  const detachCalls = [], stageCalls = [], gcCalls = [];
  globalThis.__resourceCore = {
    readCurrentPackageGeneration: async () => current, readPackageObjectKeys: async () => new Set(), readVerifiedPackageObjectBySha256: async () => null,
    stagePendingPackageGeneration: async (generation, args) => {stageCalls.push(args); staged = generation;},
    refreshPendingPackageOperation: async () => {},
    putPendingPackageObject: async (_game, _id, fileId) => {staged = {...staged, files: {...staged.files, [fileId]: {objectId: 'new', revision: data.files[fileId].revision}}}; return {generation: staged};},
    commitPendingPackageGeneration: async () => {current = {installation: {...current.installation, currentGeneration: staged.id}, generation: staged}; return current.installation;},
    packageMimeType: () => 'application/octet-stream',
    cancelPendingPackageGeneration: async () => {}, garbageCollectPackageStore: async () => {gcCalls.push(true);},
    detachCurrentPackageGeneration: async (_game, args) => {detachCalls.push(args); if (current.installation.currentGeneration !== args.expectedGenerationId) throw Object.assign(Error('changed'), {name: 'PackageGenerationChangedError'}); current = {installation: {...current.installation, currentGeneration: null}, generation: null}; return current.installation;},
  };
  return {data, detachCalls, stageCalls, gcCalls, get current() {return current;}, set current(value) {current = value;}};
}

test('real installer queue serializes install/removal and does not remove a newly committed generation', async () => {
  const f = corePort(), gate = deferred();
  const installing = core.installPackageFromAcquisition({descriptor: f.data, desiredFileIds: ['data'], source: 'local', reuseCurrent: false,
    expectedGenerationId: 'original', acquire: async () => {await gate.promise; return bytes;}});
  await tick(); const removing = core.removeInstalledPackage('th06', {expectedGenerationId: 'original'});
  await tick(); assert.equal(f.detachCalls.length, 0); gate.resolve(); await installing;
  await assert.rejects(removing, error => error.name === 'PackageGenerationChangedError');
  assert.ok(f.current.generation); assert.equal(f.stageCalls[0].expectedGenerationId, 'original'); assert.equal(f.gcCalls.length, 0);
});

test('cancelled queued removal never reaches store; expected import generation is checked with reuse disabled', async () => {
  const f = corePort(), gate = deferred(), controller = new AbortController();
  const installing = core.installPackageFromAcquisition({descriptor: f.data, desiredFileIds: ['data'], source: 'local', reuseCurrent: false,
    acquire: async () => {await gate.promise; return bytes;}});
  await tick(); const removing = core.removeInstalledPackage('th06', {expectedGenerationId: 'original', signal: controller.signal});
  controller.abort(); gate.resolve(); await installing; await assert.rejects(removing, error => error.name === 'AbortError');
  assert.equal(f.detachCalls.length, 0);
  const count = f.stageCalls.length;
  await assert.rejects(core.installPackageFromAcquisition({descriptor: f.data, desiredFileIds: ['data'], source: 'local', reuseCurrent: false,
    expectedGenerationId: 'original', acquire: async () => bytes}), error => error.name === 'PackageGenerationChangedError');
  assert.equal(f.stageCalls.length, count);
});

test('atomic stage fence rejects a current change after queue inspection before touching generations', async () => {
  const initial = {game: 'th06', currentGeneration: 'newer', pendingGeneration: null, source: 'local'};
  const f = transactionPort(initial), data = descriptor();
  await assert.rejects(stagePendingPackageGeneration({game: 'th06', id: 'candidate', descriptor: data, files: {}},
    {operationId: 'op-confirmed', expectedGenerationId: 'original', indexedDBFactory: f.factory}), error => error.name === 'PackageGenerationChangedError');
  assert.equal(f.stores.get('generations').size, 0); assert.deepEqual(f.stores.get('installations').get('th06'), initial);
});


test('late cancellation after detach write began returns the committed detached state', async () => {
  const controller = new AbortController();
  const f = transactionPort({game: 'th06', currentGeneration: 'original', pendingGeneration: null, source: 'remote'}, {onPut: () => controller.abort()});
  const result = await detachCurrentPackageGeneration('th06', {expectedGenerationId: 'original', signal: controller.signal, indexedDBFactory: f.factory});
  assert.equal(result.currentGeneration, null); assert.equal(f.stores.get('installations').get('th06').currentGeneration, null);
});

test('confirmed removal requests the same per-game exclusive WebLock as installation', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const f = corePort(), calls = [], controller = new AbortController();
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {locks: {request: async (name, options, work) => {
    calls.push({name, options}); return work();
  }}}});
  try {
    await core.removeInstalledPackage('th06', {expectedGenerationId: 'original', signal: controller.signal});
    assert.equal(calls[0].name, 'eagler-touhou-package:th06'); assert.equal(calls[0].options.mode, 'exclusive');
    assert.equal(calls[0].options.signal, controller.signal); assert.equal(f.detachCalls.length, 1); assert.equal(f.gcCalls.length, 0);
  } finally {if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator;}
});


test('durable removal marker survives staging, cancelled/failed imports, and clears only on successful explicit commit', async () => {
  const initial = {game: 'th06', currentGeneration: null, pendingGeneration: null, source: 'local', removedGenerationId: 'removed-old'};
  const f = transactionPort(initial), data = descriptor();
  f.stores.get('leases').set('runtime', {generationId: 'removed-old'}); f.stores.get('objects').set('retained', bytes);
  const generation = id => ({game: 'th06', id, descriptor: data, files: {data: {objectId: 'retained', revision: 'data-one'}}});
  await stagePendingPackageGeneration(generation('cancelled-import'), {operationId: 'op-one', expectedGenerationId: null, indexedDBFactory: f.factory});
  assert.equal(f.stores.get('installations').get('th06').removedGenerationId, 'removed-old');
  await cancelPendingPackageGeneration('th06', {generationId: 'cancelled-import', operationId: 'op-one', indexedDBFactory: f.factory});
  assert.equal(f.stores.get('installations').get('th06').removedGenerationId, 'removed-old');
  await stagePendingPackageGeneration(generation('explicit-new'), {operationId: 'op-two', expectedGenerationId: null, indexedDBFactory: f.factory});
  await assert.rejects(commitPendingPackageGeneration('th06', 'explicit-new', {operationId: 'wrong-owner', indexedDBFactory: f.factory}), /ownership/);
  assert.equal(f.stores.get('installations').get('th06').removedGenerationId, 'removed-old');
  const committed = await commitPendingPackageGeneration('th06', 'explicit-new', {operationId: 'op-two', indexedDBFactory: f.factory});
  assert.equal(committed.currentGeneration, 'explicit-new'); assert.equal(committed.removedGenerationId, undefined);
  assert.equal(f.stores.get('objects').size, 1); assert.equal(f.stores.get('leases').size, 1);
});

test('atomic compatibility stage fence rejects an install-then-remove ABA even when current is null again', async () => {
  const initial = {game: 'th06', currentGeneration: null, pendingGeneration: null, source: 'local', removedGenerationId: 'user-removed'};
  const f = transactionPort(initial), data = descriptor();
  await assert.rejects(stagePendingPackageGeneration({game: 'th06', id: 'legacy-candidate', descriptor: data, files: {}},
    {operationId: 'op-legacy', expectedGenerationId: null, rejectRemovedInstallation: true, indexedDBFactory: f.factory}), error => error.name === 'PackageGenerationChangedError');
  assert.deepEqual(f.stores.get('installations').get('th06'), initial); assert.equal(f.stores.get('generations').size, 0);
});

test('real installer checks removal marker before acquisition and forwards its compatibility fence to staging', async () => {
  const f = corePort();
  f.current = {installation: {game: 'th06', currentGeneration: null, pendingGeneration: null, source: 'local', removedGenerationId: 'user-removed'}, generation: null};
  let acquired = false;
  await assert.rejects(core.installPackageFromAcquisition({descriptor: f.data, desiredFileIds: ['data'], source: 'local', reuseCurrent: false,
    expectedGenerationId: null, rejectRemovedInstallation: true, acquire: async () => {acquired = true; return bytes;}}), error => error.name === 'PackageGenerationChangedError');
  assert.equal(acquired, false); assert.equal(f.stageCalls.length, 0);
  f.current = {installation: null, generation: null};
  await core.installPackageFromAcquisition({descriptor: f.data, desiredFileIds: ['data'], source: 'local', reuseCurrent: false,
    expectedGenerationId: null, rejectRemovedInstallation: true, acquire: async () => bytes});
  assert.equal(f.stageCalls[0].rejectRemovedInstallation, true);
});
