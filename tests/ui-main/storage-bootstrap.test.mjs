/** Real legacy adapter/cleanup + injected Package ports. These tests establish
 * coordination and byte validation, not browser IndexedDB durability. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'storage-compatibility-'));
after(() => rm(folder, {recursive: true, force: true}));
const sourcePlugin = {name: 'source-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
  if (!args.path.startsWith('.')) return;
  const path = resolve(dirname(args.importer), args.path);
  const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
  if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
  const authored = path.replace(/\.mjs$/, '.mts');
  if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
});}};
const bundle = await build({stdin: {contents: `export * from './app/services/storage-bootstrap.client.ts';
 export * from './legacy/legacy-import-storage.mjs';
 export {createStorageBootstrapDocumentOwner} from './app/components/StorageBootstrapProvider.tsx';`, resolveDir: root, loader: 'ts'}, bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [sourcePlugin]});
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const path = join(folder, 'storage.mjs'); await writeFile(path, bundle.outputFiles[0].text);
const {createStorageBootstrapDocumentOwner, createStorageBootstrap, importedGameDataMetadataKey, importedOggMetadataKey, localGameDataCacheUrl, localOggCacheUrl, migrateLegacyStoredImport} = await import(pathToFileURL(path).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => new TextEncoder().encode(value);
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {resolve, promise};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(game = 'th07', {fonts = true, ogg = true, current = null} = {}) {
  const origin = 'https://example.test', baseUrl = `${origin}/app/`;
  const payload = {data: bytes(`DATA:${game}`), msgothic: bytes('msgothic font'), unifont: bytes('unifont font'), ogg: bytes('ogg real bytes')};
  const dataHash = hash(payload.data), layout = `sha256-${'a'.repeat(64)}`;
  const fontDeclarations = [
    {target: '/msgothic.ttc', key: `/.eagler-local/offline/${game}/0123456789abcdef/shared/msgothic.ttc`, bytes: payload.msgothic.length, sha256: hash(payload.msgothic)},
    {target: '/unifont.otf', key: `/.eagler-local/offline/${game}/0123456789abcdef/shared/unifont.otf`, bytes: payload.unifont.length, sha256: hash(payload.unifont)},
  ];
  const metadata = {source: 'local-import', game, version: `sha256-${dataHash}`, layout, sha256: dataHash, bytes: payload.data.length,
    legacyAssets: fonts ? {runtimeVersion: '0123456789abcdef', shared: fontDeclarations, languages: []} : null};
  const oggMetadata = {source: 'local-import', game, version: `sha256-${'b'.repeat(64)}`, files: [`${game}_01.ogg`]};
  const dataKey = localGameDataCacheUrl(origin, game, metadata.version);
  const values = new Map([[importedGameDataMetadataKey(game), JSON.stringify(metadata)]]);
  if (ogg) values.set(importedOggMetadataKey(game), JSON.stringify(oggMetadata));
  const cached = new Map([[dataKey, new Blob([payload.data])]]);
  if (fonts) {cached.set(fontDeclarations[0].key, new Blob([payload.msgothic])); cached.set(fontDeclarations[1].key, new Blob([payload.unifont]));}
  if (ogg) cached.set(localOggCacheUrl(origin, game, oggMetadata.version, oggMetadata.files[0]), new Blob([payload.ogg]));
  const storage = {getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key)};
  const cacheStorage = {match: async key => cached.has(key) ? new Response(cached.get(key)) : undefined,
    open: async () => ({delete: async key => cached.delete(key)}), delete: async () => true};
  const declarations = {
    'game-data': {revision: metadata.version, source: `games/${game}/${game}.data`, target: `/${game}.data`, bytes: payload.data.length, sha256: dataHash},
    'shared-msgothic': {revision: 'font-one', source: 'shared/msgothic.ttc', target: '/msgothic.ttc', bytes: payload.msgothic.length, sha256: hash(payload.msgothic)},
    'shared-unifont': {revision: 'font-two', source: 'shared/unifont.otf', target: '/unifont.otf', bytes: payload.unifont.length, sha256: hash(payload.unifont)},
  };
  const descriptor = {schema: 'eagler-touhou/package/1', game, revision: 'published-one', runtimeRequirement: {protocol: 'eagler-touhou/1', target: game, dataFile: 'game-data', dataLayout: layout},
    files: declarations, base: {files: Object.keys(declarations)}, components: {}};
  const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
    shared: {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf'},
    games: {[game]: {runtime: `runtime/${game}/${game}.html`, gameData: {path: `${game}.data`, bytes: payload.data.length, sha256: dataHash, version: metadata.version, layout}, music: {midi: {files: []}}}}};
  const catalog = {schema: 'eagler-touhou/release-catalog/1', games: {[game]: {revision: descriptor.revision, descriptor: `${game}.package.json`}}};
  let stored = current ?? {installation: null, generation: null}, serial = 0, collected = 0;
  const objects = new Map(), requests = [], installs = [];
  const responses = new Map([['host-manifest.json', host], ['release-catalog.json', catalog], [`${game}.package.json`, descriptor],
    ['shared/msgothic.ttc', payload.msgothic], ['shared/unifont.otf', payload.unifont]]);
  const dependencies = {
    readCurrent: async id => id === game ? stored : {installation: null, generation: null},
    readObject: async id => objects.get(id) ?? null,
    collect: async () => {collected++; return {generationsDeleted: 0, objectsDeleted: 0};},
    install: async input => {
      installs.push(input);
      assert.equal(input.expectedGenerationId, stored.installation?.currentGeneration ?? null, 'simulated Package generation fence');
      const id = `generation-${++serial}`, files = {};
      for (const fileId of input.desiredFileIds) {
        const data = await input.acquire(fileId, input.descriptor.files[fileId]);
        assert.ok(data instanceof ArrayBuffer);
        const declaration = input.descriptor.files[fileId];
        assert.equal(data.byteLength, declaration.bytes); assert.equal(hash(new Uint8Array(data)), declaration.sha256);
        const objectId = `${id}-${fileId}`; objects.set(objectId, {data}); files[fileId] = {objectId, revision: declaration.revision};
      }
      stored = {installation: {game, source: input.source, currentGeneration: id, pendingGeneration: null},
        generation: {game, id, descriptor: input.descriptor, files}};
      return stored;
    },
  };
  const options = {baseUrl, legacyStorage: {storage, cacheStorage, indexedDBFactory: null}, dependencies,
    fetchImpl: async input => {const path = new URL(input).pathname.slice('/app/'.length); requests.push(path);
      const result = responses.get(path); return result === undefined ? new Response(null, {status: 404})
        : result instanceof Uint8Array ? new Response(result) : new Response(JSON.stringify(result));}};
  return {game, options, metadata, oggMetadata, values, cached, dataKey, payload, descriptor, host, catalog, responses, requests, installs, dependencies, objects,
    get current() {return stored;}, set current(value) {stored = value;}, get collected() {return collected;}};
}
function existingRaw(f, {withFonts = false, withOgg = false} = {}) {
  const descriptor = structuredClone(f.descriptor); descriptor.revision = `raw-${f.metadata.sha256.slice(0, 16)}`;
  delete descriptor.files['game-data'].sha256;
  descriptor.base.files = withFonts ? descriptor.base.files : ['game-data'];
  if (!withFonts) {delete descriptor.files['shared-msgothic']; delete descriptor.files['shared-unifont'];}
  const files = {'game-data': {objectId: 'old-data', revision: descriptor.files['game-data'].revision}};
  f.objects.set('old-data', {data: f.payload.data.slice().buffer});
  if (withFonts) for (const [id, key] of [['shared-msgothic', 'msgothic'], ['shared-unifont', 'unifont']]) {
    files[id] = {objectId: `old-${id}`, revision: descriptor.files[id].revision}; f.objects.set(`old-${id}`, {data: f.payload[key].slice().buffer});
  }
  if (withOgg) {
    descriptor.revision = 'legacy-old'; descriptor.files.ogg = {revision: 'old-ogg', source: 'track.ogg', target: '/bgm/track.ogg', bytes: f.payload.ogg.length};
    descriptor.components.ogg = {type: 'ogg', files: ['ogg']}; files.ogg = {objectId: 'old-ogg', revision: 'old-ogg'}; f.objects.set('old-ogg', {data: f.payload.ogg.slice().buffer});
  }
  f.current = {installation: {game: f.game, source: 'local', currentGeneration: 'old', pendingGeneration: null}, generation: {game: f.game, id: 'old', descriptor, files}};
}

test('complete CacheStorage imports migrate through the existing owner with real OGG attestation and verified cleanup', async () => {
  const f = fixture(), install = f.dependencies.install;
  f.dependencies.install = async input => {assert.ok(f.cached.has(f.dataKey)); return install(input);};
  const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game, {intent: 'background'});
  assert.equal(result.status, 'migrated'); assert.equal(f.installs.length, 1); assert.equal(f.installs[0].expectedGenerationId, null);
  assert.equal(f.installs[0].reuseCurrent, false); assert.equal(f.requests.length, 0);
  assert.equal(f.current.generation.descriptor.files[`ogg:${f.game}_01.ogg`].sha256, hash(f.payload.ogg));
  assert.equal(f.cached.size, 0); assert.equal(f.values.size, 0); bootstrap.dispose();
});

test('migration failure, corrupt source and corrupt committed bytes all retain the complete historical copy', async () => {
  for (const failure of ['install', 'source', 'readback']) {
    const f = fixture();
    if (failure === 'install') f.dependencies.install = async () => {throw Error('quota exhausted');};
    if (failure === 'source') f.cached.set(f.dataKey, new Blob([bytes('X'.repeat(f.payload.data.length))]));
    if (failure === 'readback') f.dependencies.readObject = async () => ({data: bytes('damaged').buffer});
    const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game);
    assert.equal(result.status, 'deferred'); assert.ok(f.values.has(importedGameDataMetadataKey(f.game))); assert.ok(f.cached.has(f.dataKey));
    if (failure === 'source') assert.equal(f.installs.length, 0);
    bootstrap.dispose();
  }
});

test('revision equality never authorizes discarding an unverified old copy in the new coordinator', async () => {
  const f = fixture();
  f.current = {installation: {game: f.game, source: 'local', currentGeneration: 'newer', pendingGeneration: null},
    generation: {game: f.game, id: 'newer', descriptor: f.descriptor, files: {}}};
  const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game);
  assert.equal(result.status, 'current'); assert.equal(f.installs.length, 0); assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size); bootstrap.dispose();
});

test('a competing new installation wins the expected-generation fence and legacy bytes are not removed', async () => {
  const f = fixture();
  f.dependencies.install = async input => {assert.equal(input.expectedGenerationId, null);
    f.current = {installation: {game: f.game, source: 'local', currentGeneration: 'user-new', pendingGeneration: null}, generation: {game: f.game, id: 'user-new', descriptor: f.descriptor, files: {}}};
    throw Object.assign(Error('current changed'), {name: 'PackageGenerationChangedError'});
  };
  const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game);
  assert.equal(result.status, 'superseded'); assert.equal(f.current.generation.id, 'user-new'); assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size); bootstrap.dispose();
});

test('DATA-only migration: background/inspection never download fonts; explicit prepare restores fonts without downloading DATA', async () => {
  const f = fixture('th08', {fonts: false, ogg: false}), bootstrap = createStorageBootstrap(f.options);
  const background = await bootstrap.ensure(f.game, {intent: 'background'});
  assert.equal(background.status, 'needs-repair'); assert.equal(background.repairable, false); assert.equal(f.requests.length, 0);
  const inspection = await bootstrap.ensure(f.game, {intent: 'inspect', host: f.host});
  assert.equal(inspection.status, 'needs-repair'); assert.equal(inspection.repairable, true); assert.equal(f.requests.length, 0); assert.equal(f.installs.length, 0);
  const prepared = await bootstrap.ensure(f.game, {intent: 'prepare', host: f.host});
  assert.equal(prepared.status, 'migrated'); assert.deepEqual(f.requests, ['release-catalog.json', 'th08.package.json', 'shared/msgothic.ttc', 'shared/unifont.otf']);
  assert.deepEqual(f.current.generation.descriptor.base.files, ['game-data', 'shared-msgothic', 'shared-unifont']); assert.equal(f.values.size, 0); bootstrap.dispose();
});

test('previously installed raw DATA is attested from actual bytes and retains its source through a fenced upgrade', async () => {
  const f = fixture('th07', {fonts: false, ogg: false}); existingRaw(f);
  const bootstrap = createStorageBootstrap(f.options);
  assert.equal((await bootstrap.ensure(f.game, {host: f.host})).repairable, true); assert.equal(f.installs.length, 0);
  const result = await bootstrap.ensure(f.game, {intent: 'prepare', host: f.host});
  assert.equal(result.status, 'upgraded'); assert.equal(f.installs[0].expectedGenerationId, 'old'); assert.equal(f.installs[0].reuseCurrent, true);
  assert.equal(f.current.generation.descriptor.files['game-data'].sha256, hash(f.payload.data)); assert.equal(f.current.installation.source, 'local');
  assert.ok(f.cached.has(f.dataKey), 'unrelated historical copy is not cleaned by a current-generation upgrade');
  assert.ok(!f.requests.some(path => /\.data$/.test(path))); bootstrap.dispose();
});

test('complete previously installed legacy OGG gets a full hash from stored bytes with no network request', async () => {
  const f = fixture(); existingRaw(f, {withFonts: true, withOgg: true});
  const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game, {intent: 'background'});
  assert.equal(result.status, 'upgraded'); assert.equal(f.requests.length, 0); assert.equal(f.current.generation.descriptor.files.ogg.sha256, hash(f.payload.ogg)); bootstrap.dispose();
});

test('missing DATA/OGG and DATA hash/layout conflicts cannot become actionable font repair or trigger a download', async () => {
  for (const problem of ['data-missing', 'ogg-missing', 'hash', 'layout']) {
    const f = fixture('th07', {fonts: false});
    if (problem === 'data-missing') f.cached.delete(f.dataKey);
    if (problem === 'ogg-missing') f.cached.delete(localOggCacheUrl(new URL(f.options.baseUrl).origin, f.game, f.oggMetadata.version, f.oggMetadata.files[0]));
    if (problem === 'hash') f.cached.set(f.dataKey, new Blob([bytes('X'.repeat(f.payload.data.length))]));
    if (problem === 'layout') f.host.games[f.game].gameData.layout = `sha256-${'c'.repeat(64)}`;
    const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game, {intent: 'prepare', host: f.host});
    assert.equal(result.status, 'deferred', problem); assert.equal(result.repairable, false); assert.equal(f.requests.length, 0); assert.equal(f.installs.length, 0);
    assert.ok(f.values.size); bootstrap.dispose();
  }
});

test('font SHA failure or escaping publication cannot commit or discard legacy bytes', async () => {
  for (const problem of ['hash', 'source', 'catalog']) {
    const f = fixture('th07', {fonts: false});
    if (problem === 'hash') f.responses.set('shared/msgothic.ttc', bytes('bad font'));
    if (problem === 'source') f.descriptor.files['shared-msgothic'].source = 'other/font.ttc';
    if (problem === 'catalog') f.catalog.games[f.game].descriptor = '../elsewhere.json';
    const bootstrap = createStorageBootstrap(f.options), result = await bootstrap.ensure(f.game, {intent: 'prepare', host: f.host});
    assert.equal(result.status, 'deferred'); assert.equal(f.installs.length, 0); assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size); bootstrap.dispose();
  }
});

test('games coordinate independently, repeated calls coalesce, and cancelling a waiter does not kill maintenance', async () => {
  const f = fixture(), held = deferred(); let reads = 0;
  const read = f.dependencies.readCurrent;
  f.dependencies.readCurrent = async game => {if (game === 'th06') {reads++; await held.promise;} return read(game);};
  const bootstrap = createStorageBootstrap(f.options), controller = new AbortController();
  const waiting = bootstrap.ensure('th06', {signal: controller.signal}), joined = bootstrap.ensure('th06');
  controller.abort(); await assert.rejects(waiting, {name: 'AbortError'});
  const available = await bootstrap.ensure(f.game); assert.equal(available.status, 'migrated'); assert.equal(reads, 1);
  held.resolve(); assert.equal((await joined).status, 'absent'); bootstrap.dispose();
});

test('explicit prepare joins a pending same-game migration then upgrades missing fonts', async () => {
  const f = fixture('th07', {fonts: false}), held = deferred(); const read = f.dependencies.readCurrent;
  let first = true; f.dependencies.readCurrent = async game => {if (first) {first = false; await held.promise;} return read(game);};
  const bootstrap = createStorageBootstrap(f.options), background = bootstrap.ensure(f.game, {intent: 'background'});
  const prepare = bootstrap.ensure(f.game, {intent: 'prepare', host: f.host}); held.resolve();
  assert.equal((await background).status, 'needs-repair'); assert.equal((await prepare).status, 'migrated'); assert.equal(f.installs.length, 1); bootstrap.dispose();
});

test('legacy cleanup hook rejects same-revision assertions unless the new caller verifies installed bytes', async () => {
  const f = fixture('th07', {fonts: false, ogg: false});
  await assert.rejects(migrateLegacyStoredImport(f.game, {...f.options.legacyStorage, origin: new URL(f.options.baseUrl).origin,
    protocol: 'eagler-touhou/1', currentRevision: `legacy-${f.metadata.sha256.slice(0, 16)}-noogg-data`,
    install: async () => {throw Error('must not install');}, verifyInstalled: async () => {throw Error('not verified');}}), /not verified/);
  assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size);
});

test('background maintenance does not gate root rendering and waits for Package jobs before garbage collection', async () => {
  const f = fixture(), held = deferred(), read = f.dependencies.readCurrent;
  f.dependencies.readCurrent = async game => {if (game === f.game) await held.promise; return read(game);};
  const bootstrap = createStorageBootstrap(f.options), job = bootstrap.startBackground();
  await tick(); assert.equal(f.collected, 0);
  const provider = await readFile(join(root, 'app/components/StorageBootstrapProvider.tsx'), 'utf8');
  assert.match(provider, /useEffect\(/); assert.match(provider, /requestAnimationFrame/); assert.match(provider, /setTimeout/); assert.match(provider, /return children/);
  assert.doesNotMatch(provider, /await .*startBackground/);
  held.resolve(); await job; assert.equal(f.collected, 1); bootstrap.dispose();
});


test('document bootstrap waits until after scheduled paint; StrictMode, pagehide and delayed chunks cannot start duplicate maintenance', async () => {
  const target = new EventTarget(), scheduled = [], loading = deferred(); let starts = 0, disposals = 0, errors = 0;
  const owner = createStorageBootstrapDocumentOwner({target, schedule(fn) {const job = {fn, cancelled: false}; scheduled.push(job); return () => {job.cancelled = true;};},
    load: () => loading.promise, onError: () => {errors++;}});
  owner.attach(); assert.equal(starts, 0, 'render/mount does not start storage work');
  owner.detach(); owner.attach(); assert.equal(scheduled[0].cancelled, true);
  scheduled[0].fn(); scheduled[1].fn(); await tick();
  target.dispatchEvent(new Event('pagehide'));
  loading.resolve(() => ({startBackground: async () => {starts++;}, dispose: () => {disposals++;}})); await tick();
  assert.equal(starts, 0, 'late import after departure is fenced');
  target.dispatchEvent(new Event('pageshow')); scheduled.at(-1).fn(); await tick(); assert.equal(starts, 1);
  owner.detach(); owner.attach(); assert.equal(starts, 1, 'effect replay retains existing maintenance');
  target.dispatchEvent(new Event('pagehide')); assert.equal(disposals, 1);
  target.dispatchEvent(new Event('pageshow')); scheduled.at(-1).fn(); await tick(); assert.equal(starts, 2);
  owner.dispose(); assert.equal(disposals, 2); assert.equal(errors, 0);
});


test('inspection joining background font discovery rechecks actual DATA against Host before enabling Prepare', async () => {
  const f = fixture('th07', {fonts: false}), held = deferred(); const read = f.dependencies.readCurrent;
  let first = true; f.dependencies.readCurrent = async game => {if (first) {first = false; await held.promise;} return read(game);};
  const bootstrap = createStorageBootstrap(f.options), background = bootstrap.ensure(f.game, {intent: 'background'});
  const inspect = bootstrap.ensure(f.game, {intent: 'inspect', host: f.host}); held.resolve();
  assert.equal((await background).repairable, false); assert.equal((await inspect).repairable, true);
  assert.equal(f.installs.length, 0); assert.equal(f.requests.length, 0); bootstrap.dispose();
});

test('cancelling explicit font acquisition stops its writer and retains local DATA and metadata', async () => {
  const f = fixture('th07', {fonts: false}), held = deferred(), requested = deferred(), controller = new AbortController();
  const originalFetch = f.options.fetchImpl; let fontSignal;
  f.options.fetchImpl = async (url, init) => {if (String(url).endsWith('/shared/msgothic.ttc')) {fontSignal = init.signal; requested.resolve(); await held.promise;}
    return originalFetch(url, init);};
  const bootstrap = createStorageBootstrap(f.options), job = bootstrap.ensure(f.game, {intent: 'prepare', host: f.host, signal: controller.signal});
  await requested.promise; controller.abort(); await assert.rejects(job, {name: 'AbortError'});
  assert.equal(fontSignal.aborted, true); held.resolve(); await tick();
  assert.equal(f.installs.length, 0); assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size); bootstrap.dispose();
});

test('cancelled preparation waiting behind maintenance never starts a later font download', async () => {
  const f = fixture('th07', {fonts: false}), held = deferred(), controller = new AbortController(); const read = f.dependencies.readCurrent;
  let first = true; f.dependencies.readCurrent = async game => {if (first) {first = false; await held.promise;} return read(game);};
  const bootstrap = createStorageBootstrap(f.options), background = bootstrap.ensure(f.game, {intent: 'background'});
  const prepare = bootstrap.ensure(f.game, {intent: 'prepare', host: f.host, signal: controller.signal});
  controller.abort(); await assert.rejects(prepare, {name: 'AbortError'}); held.resolve(); await background; await tick();
  assert.equal(f.requests.length, 0); assert.equal(f.installs.length, 0); bootstrap.dispose();
});


test('confirmed uninstall marker suppresses historical resurrection without deleting retained bytes', async () => {
  const f = fixture();
  f.current = {installation: {game: f.game, source: 'local', currentGeneration: null, pendingGeneration: null, removedGenerationId: 'user-removed'}, generation: null};
  const bootstrap = createStorageBootstrap(f.options);
  for (const intent of ['background', 'inspect', 'prepare']) assert.equal((await bootstrap.ensure(f.game, {intent})).status, 'removed');
  assert.equal(f.installs.length, 0); assert.equal(f.requests.length, 0); assert.ok(f.cached.has(f.dataKey)); assert.ok(f.values.size); bootstrap.dispose();
});

test('fresh migration forwards the removal marker fence in addition to the expected generation', async () => {
  const f = fixture(), bootstrap = createStorageBootstrap(f.options);
  assert.equal((await bootstrap.ensure(f.game)).status, 'migrated');
  assert.equal(f.installs[0].expectedGenerationId, null); assert.equal(f.installs[0].rejectRemovedInstallation, true); bootstrap.dispose();
});

test('explicit development preparation repairs legacy fonts through the same writer without Catalog or DATA acquisition',async()=>{
 for(const raw of [false,true]){
  const f=fixture('th07',{fonts:false,ogg:false});if(raw)existingRaw(f);
  f.host.profile='web-development';f.host.shared.testBuild=true;
  f.host.shared.vanillaFont='workspace/fonts/msgothic.ttc';f.host.shared.unicodeFont='workspace/fonts/unifont.otf';
  f.responses.delete('release-catalog.json');f.responses.delete('th07.package.json');
  f.responses.set('workspace/fonts/msgothic.ttc',f.payload.msgothic);f.responses.set('workspace/fonts/unifont.otf',f.payload.unifont);
  const bootstrap=createStorageBootstrap(f.options);
  const inspect=await bootstrap.ensure('th07',{intent:'inspect',host:f.host});assert.equal(inspect.status,'needs-repair');assert.equal(inspect.repairable,true);assert.equal(f.installs.length,0);
  const result=await bootstrap.ensure('th07',{intent:'prepare',host:f.host});
  assert.equal(result.status,raw?'upgraded':'migrated',result.warning);assert.equal(f.installs.length,1);assert.equal(f.current.installation.source,'local');
  assert.equal(f.current.generation.descriptor.files['game-data'].sha256,hash(f.payload.data));
  assert.equal(f.requests.includes('release-catalog.json'),false);assert.equal(f.requests.some(path=>path.endsWith('.data')),false);
  assert.equal(f.requests.filter(path=>path.startsWith('workspace/fonts/')).length,2);bootstrap.dispose();
 }
});
test('development font repair cannot escape the application mount or accept HTML fallback',async()=>{
 for(const source of ['../font.otf','https://foreign.example/font.otf']){
  const f=fixture('th07',{fonts:false,ogg:false});existingRaw(f);f.host.profile='web-development';f.host.shared.testBuild=true;f.host.shared.vanillaFont=source;
  const bootstrap=createStorageBootstrap(f.options),result=await bootstrap.ensure('th07',{intent:'prepare',host:f.host});
  assert.equal(result.status,'deferred');assert.equal(f.installs.length,0);assert.equal(f.requests.length,0);bootstrap.dispose();
 }
});

test('development font HTML responses do not become attested font bytes',async()=>{
 const f=fixture('th07',{fonts:false,ogg:false});existingRaw(f);f.host.profile='web-development';f.host.shared.testBuild=true;
 f.options.fetchImpl=async()=>new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}});
 const bootstrap=createStorageBootstrap(f.options),result=await bootstrap.ensure('th07',{intent:'prepare',host:f.host});
 assert.equal(result.status,'deferred');assert.equal(f.installs.length,0);assert.equal(f.current.generation.id,'old');bootstrap.dispose();
});
