/** Synthetic service and document-lifetime tests. No browser/IndexedDB/game claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'ui-resource-service-'));
after(() => rm(folder, {recursive: true, force: true}));
const plugin = {name: 'authored-browser-contracts', setup(builder) {
  builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path);
    const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
    if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
    const authored = path.replace(/\.mjs$/, '.mts');
    if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
  });
}};
async function bundled(name, source) {
  const result = await build({entryPoints: [join(root, source)], bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [plugin]});
  assert.doesNotMatch(result.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
  const path = join(folder, `${name}.mjs`); await writeFile(path, result.outputFiles[0].text);
  return import(pathToFileURL(path).href);
}
const {createResourceManager} = await bundled('resource', 'app/services/resources.client.ts');
const {createResourceDocumentOwner} = await bundled('provider', 'app/components/ResourceManagerProvider.tsx');
const baseUrl = 'https://example.test/review/';
const hash = text => createHash('sha256').update(text).digest('hex');
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({installed = true} = {}) {
  const ids = ['game-data', 'track-1', 'track-2', 'lang-en', 'shared-optional', 'other-file'];
  const files = Object.fromEntries(ids.map(id => [id, {revision: `r-${id}`, source: `data/${id}.bin`, target: id === 'game-data' ? '/th06.data' : `/${id}.bin`, bytes: 3, sha256: hash('abc')}]));
  const descriptor = {schema: 'eagler-touhou/package/1', game: 'th06', revision: 'revision-one',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th06', dataFile: 'game-data', dataLayout: `sha256-${'a'.repeat(64)}`},
    files, base: {files: ['game-data']}, components: {
      ogg: {type: 'ogg', files: ['track-1', 'track-2']},
      language: {type: 'language', entries: [{id: 'lang_en', title: 'English', file: 'lang-en'}]},
      extra: {type: 'resource', files: ['game-data', 'shared-optional', 'other-file']},
      shared: {type: 'resource', files: ['shared-optional']},
    }};
  const generation = {id: 'generation-one', game: 'th06', descriptor,
    files: Object.fromEntries(ids.map(id => [id, {objectId: `object-${id}`, revision: files[id].revision}]))};
  let current = installed ? {installation: {game: 'th06', source: 'local', currentGeneration: generation.id, pendingGeneration: null}, generation}
    : {installation: null, generation: null};
  const keys = new Set(ids.map(id => `object-${id}`));
  const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
    shared: {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf'},
    games: {th06: {runtime: 'runtime/th06/th06.html', gameData: {path: 'th06.data', bytes: 3, sha256: hash('abc'),
      version: `sha256-${hash('abc')}`, layout: descriptor.runtimeRequirement.dataLayout},
      music: {midi: {files: ['01.mid']}}, features: {thprac: true, focusHitbox: true},
      languages: [], languageOptions: [{id: 'ja', pack: null}]}}};
  const catalog = {schema: 'eagler-touhou/release-catalog/1', games: {th06: {revision: descriptor.revision, descriptor: 'th06.package.json'}}};
  const responses = new Map([['host-manifest.json', host], ['release-catalog.json', catalog], ['th06.package.json', descriptor]]);
  const requests = [], calls = [], reads = [];
  let beforeInstall = null, installer = null;
  async function install(args) {
    calls.push(args);
    if (beforeInstall) await beforeInstall(args);
    if (installer) return installer(args);
    const source = await args.source(current);
    const desired = await args.desiredFileIds(current);
    const next = {...generation, id: `generation-${calls.length + 1}`, descriptor: args.descriptor,
      files: Object.fromEntries(desired.map(id => [id, {objectId: `object-${id}`, revision: args.descriptor.files[id].revision}]))};
    args.onProgress?.({completed: desired.length, total: desired.length, fileId: desired.at(-1), found: true});
    current = {installation: {game: 'th06', source, currentGeneration: next.id, pendingGeneration: null}, generation: next};
    return current;
  }
  const options = {baseUrl, fetchImpl: async (input, init) => {
    const url = new URL(input); requests.push({url: url.href, ...init});
    assert.ok(url.href.startsWith(baseUrl));
    if (!responses.has(url.href.slice(baseUrl.length))) return new Response(null, {status: 404});
    const value = responses.get(url.href.slice(baseUrl.length));
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
  }, dependencies: {
    readCurrent: async game => {reads.push(game); return current;},
    readKeys: async objectIds => new Set(objectIds.filter(id => keys.has(id))),
    install,
  }};
  return {options, descriptor, generation, catalog, host, responses, requests, calls, reads, keys,
    get current() {return current;}, set current(value) {current = value;},
    set beforeInstall(value) {beforeInstall = value;}, set installer(value) {installer = value;}};
}

test('inspection uses canonical SP/MP identity, immutable snapshots, real metadata and no mutations', async () => {
  const f = fixture(), service = createResourceManager(f.options);
  const inspected = await service.inspect('th06mp');
  assert.equal(inspected.gameId, 'th06'); assert.equal(inspected.source, 'local');
  assert.deepEqual(f.reads, ['th06']); assert.equal(f.calls.length, 0);
  assert.equal(inspected.integrityVerified, false); assert.equal(inspected.installedBaseFileCount, 1);
  assert.equal(inspected.components.find(item => item.id === 'ogg').status, 'installed');
  assert.ok(Object.isFrozen(inspected.components[0])); assert.ok(Object.isFrozen(service.getSnapshot().inspections));
  assert.equal(inspected.warning, null);
  const metadata = service.getSnapshot().preferences.th06;
  assert.deepEqual(metadata.hostFeatures, {thprac: true, focusHitbox: true});
  assert.deepEqual(metadata.languageCatalog.map(item => item.id), ['ja', 'lang_en']);
  assert.equal(metadata.musicAvailability.installed.revision, 'revision-one');
  service.dispose();
});

test('missing/evicted objects are partial, unavailable publication still permits safe local removal', async () => {
  const f = fixture(); f.keys.delete('object-track-2'); f.keys.delete('object-lang-en');
  f.responses.set('release-catalog.json', new Error('offline'));
  const service = createResourceManager(f.options), result = await service.inspect('th06');
  assert.match(result.warning, /offline/);
  const ogg = result.components.find(item => item.id === 'ogg');
  assert.equal(ogg.status, 'partial'); assert.equal(ogg.canInstall, false); assert.equal(ogg.canRemove, true);
  assert.deepEqual(service.getSnapshot().preferences.th06.languageCatalog.map(item => item.id), ['ja']);
  assert.equal(service.getSnapshot().preferences.th06.musicAvailability.installed.files['track-2'], undefined);
  const requestCount = f.requests.length;
  await service.remove('th06mp', 'ogg');
  assert.equal(f.requests.length, requestCount, 'local removal never fetches');
  assert.equal(f.current.generation.files['track-1'], undefined); assert.equal(f.current.installation.source, 'local');
  service.dispose();
});

test('remove protects base/shared/other component refs and delegates the transaction to the existing installer', async () => {
  const f = fixture(), service = createResourceManager(f.options);
  await service.remove('th06', 'extra');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].reuseCurrent, true);
  assert.ok(f.calls[0].signal instanceof AbortSignal);
  assert.equal(f.current.generation.files['other-file'], undefined);
  for (const id of ['game-data', 'shared-optional', 'track-1', 'track-2', 'lang-en']) assert.ok(f.current.generation.files[id], id);
  await assert.rejects(service.remove('th06', 'shared'), error => error.code === 'not-removable');
  assert.equal(f.calls.length, 1); service.dispose();
});

test('install fills a component, preserves current optionals and local source inside the core queue', async () => {
  const f = fixture(); delete f.generation.files['track-2'];
  const service = createResourceManager(f.options);
  await service.install('th06mp', 'ogg');
  assert.equal(f.calls.length, 1); assert.equal(f.current.installation.source, 'local');
  assert.deepEqual(Object.keys(f.current.generation.files).sort(), Object.keys(f.descriptor.files).sort());
  assert.equal(service.getSnapshot().outcome.status, 'completed');
  assert.equal(service.getSnapshot().inspections.th06.components.find(item => item.id === 'ogg').status, 'installed');
  service.dispose();
});

test('fresh installation requests base plus chosen component only', async () => {
  const f = fixture({installed: false}), service = createResourceManager(f.options);
  await service.install('th06', 'ogg');
  assert.deepEqual(Object.keys(f.current.generation.files).sort(), ['game-data', 'track-1', 'track-2']);
  assert.equal(f.current.installation.source, 'remote'); service.dispose();
});

test('queued removal rejects a replacement current generation before changing it', async () => {
  const f = fixture(), service = createResourceManager(f.options);
  f.beforeInstall = async () => {f.current = {installation: {...f.current.installation, currentGeneration: 'imported-new'}, generation: {...f.current.generation, id: 'imported-new'}};};
  await assert.rejects(service.remove('th06', 'ogg'), error => error.code === 'changed-generation');
  assert.equal(f.current.generation.id, 'imported-new'); assert.ok(f.current.generation.files['track-1']); service.dispose();
});

test('broken retained files cannot be silently downloaded or discarded during removal', async () => {
  const f = fixture(), service = createResourceManager(f.options);
  f.installer = async args => {await args.desiredFileIds(f.current); return args.acquire('game-data', f.descriptor.files['game-data']);};
  await assert.rejects(service.remove('th06', 'ogg'), error => error.code === 'storage-unavailable');
  assert.equal(f.requests.length, 0); assert.equal(f.current.generation.id, 'generation-one'); service.dispose();
});

test('invalid descriptor identity, hashes, catalog revisions and escaping URLs never start a mutation', async () => {
  for (const modify of [
    f => {f.descriptor.game = 'th07';},
    f => {f.descriptor.runtimeRequirement.target = 'th07';},
    f => {delete f.descriptor.files['track-1'].sha256;},
    f => {f.catalog.games.th06.revision = 'other-revision';},
    f => {f.descriptor.files['track-1'].source = 'https:evil.example/resource';},
    f => {f.descriptor.files['track-1'].source = '%2e%2e/%2e%2e/outside.bin';},
  ]) {
    const f = fixture({installed: false}); modify(f); const service = createResourceManager(f.options);
    await assert.rejects(service.install('th06', 'ogg'), modify.toString());
    assert.equal(f.calls.length, 0); service.dispose();
  }
});

test('unknown product/components and invalid mount fail without a Package writer', async () => {
  assert.throws(() => createResourceManager({baseUrl: 'https://example.test/no-slash'}), error => error.code === 'invalid-base-url');
  const f = fixture(), service = createResourceManager(f.options);
  await assert.rejects(service.inspect('th06fake'), error => error.code === 'invalid-product');
  assert.equal(f.reads.length, 0);
  await assert.rejects(service.install('th06', 'missing'), error => error.code === 'unknown-component');
  assert.equal(f.calls.length, 0); service.dispose();
});

test('duplicate SP/MP clicks coalesce; cancel keeps the owned mutation busy until it settles', async () => {
  const f = fixture(), gate = deferred(), service = createResourceManager(f.options);
  f.installer = async args => {await gate.promise; await args.desiredFileIds(f.current); throw Error('unreachable');};
  const first = service.remove('th06', 'ogg');
  assert.equal(first, service.remove('th06mp', 'ogg'));
  await tick(); service.cancel();
  assert.equal(service.getSnapshot().operation.cancelRequested, true);
  await assert.rejects(service.inspect('th06'), error => error.code === 'busy');
  gate.resolve(); await assert.rejects(first, error => error.code === 'cancelled');
  assert.equal(f.current.generation.id, 'generation-one'); assert.equal(service.getSnapshot().operation, null);
  assert.equal(service.getSnapshot().outcome.status, 'cancelled'); service.dispose();
});

test('abort during an already committed core result reports completed, not a fictitious rollback', async () => {
  const f = fixture(), service = createResourceManager(f.options);
  f.installer = async () => {service.cancel(); return f.current;};
  await service.remove('th06', 'ogg');
  assert.equal(service.getSnapshot().outcome.status, 'completed'); assert.equal(service.getSnapshot().errors.th06, undefined);
  service.dispose();
});

test('dispose aborts only its own job, removes subscriptions, and rejects later calls', async () => {
  const f = fixture(), gate = deferred(), service = createResourceManager(f.options);
  f.installer = async args => {await gate.promise; await args.desiredFileIds(f.current); throw Error('unreachable');};
  let notifications = 0; service.subscribe(() => notifications++);
  const task = service.remove('th06', 'ogg'); await tick(); service.dispose(); const final = notifications;
  gate.resolve(); await assert.rejects(task, error => error.code === 'cancelled');
  assert.equal(notifications, final);
  await assert.rejects(service.inspect('th06'), error => error.code === 'disposed');
});

test('storage errors surface without claiming an installed state or starting downloads', async () => {
  const f = fixture(), service = createResourceManager({...f.options, dependencies: {...f.options.dependencies, readCurrent: async () => {throw Error('denied');}}});
  await assert.rejects(service.inspect('th06'), error => error.code === 'storage-unavailable');
  assert.equal(service.getSnapshot().inspections.th06, undefined); assert.equal(f.requests.length, 0); service.dispose();
});

test('document lifetime fences delayed imports after pagehide and survives effect replay', async () => {
  const events = new EventTarget(), load = deferred(), controllers = [], reported = [];
  const owner = createResourceDocumentOwner({target: events, load: () => load.promise, onController: value => reported.push(value), onError: error => {throw error;}});
  const make = () => {const controller = {disposals: 0, dispose() {this.disposals++;}}; controllers.push(controller); return controller;};
  owner.attach(); await tick(); events.dispatchEvent(new Event('pagehide')); load.resolve(make); await tick();
  assert.equal(controllers.length, 0);
  owner.detach(); owner.attach(); await tick(); assert.equal(controllers.length, 0, 'effect replay cannot revive a departed document');
  events.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(controllers.length, 1);
  owner.detach(); owner.attach(); await tick(); assert.equal(controllers.length, 1, 'route/effect replay retains owner');
  assert.equal(controllers[0].disposals, 0);
  events.dispatchEvent(new Event('pagehide')); assert.equal(controllers[0].disposals, 1);
  events.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(controllers.length, 2);
  owner.dispose(); assert.equal(controllers[1].disposals, 1);
  events.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(controllers.length, 2);
});


test('published base installation supports packages with no optionals and does not opt in to resources', async () => {
  const f = fixture({installed: false}); f.descriptor.components = {};
  const service = createResourceManager(f.options);
  await service.installBase('th06mp');
  assert.equal(f.calls.length, 1); assert.deepEqual(Object.keys(f.current.generation.files), ['game-data']);
  assert.equal(service.getSnapshot().outcome.kind, 'install-base'); service.dispose();
});

test('base update preserves current optional selections through the canonical selection helper', async () => {
  const f = fixture(); delete f.generation.files['track-2'];
  const service = createResourceManager(f.options);
  await service.installBase('th06');
  assert.ok(f.current.generation.files['track-1']); assert.equal(f.current.generation.files['track-2'], undefined);
  assert.ok(f.current.generation.files['lang-en']); assert.equal(f.current.installation.source, 'local'); service.dispose();
});

test('resource inspection reports retained legacy repair work; explicit install cannot bypass failed migration into DATA download', async () => {
  const f = fixture({installed: false}), intents = [];
  f.options.dependencies.ensureStorage = async (game, options) => {intents.push(options.intent); return {game,
    status: options.intent === 'prepare' ? 'deferred' : 'needs-repair', generationId: null, legacyPresent: true,
    repairable: options.intent !== 'prepare', warning: 'Existing DATA is retained while shared fonts are unavailable'};};
  const manager = createResourceManager(f.options), inspection = await manager.inspect('th06');
  assert.match(inspection.warning, /Existing DATA is retained/); assert.equal(f.calls.length, 0);
  await assert.rejects(manager.installBase('th06'), /Existing DATA is retained/);
  assert.deepEqual(intents, ['inspect', 'prepare']); assert.equal(f.calls.length, 0); manager.dispose();
});

test('resource inspection waits only for the requested game compatibility before reading its current generation', async () => {
  const f = fixture(), held = deferred();
  f.options.dependencies.ensureStorage = async game => {assert.equal(game, 'th06'); await held.promise;
    return {game, status: 'current', generationId: 'generation-one', legacyPresent: false, repairable: false, warning: null};};
  const manager = createResourceManager(f.options), inspecting = manager.inspect('th06mp');
  await tick(); assert.equal(f.reads.length, 0); held.resolve(); await inspecting;
  assert.deepEqual(f.reads, ['th06']); manager.dispose();
});

test('HUD test-build default is derived only from a validated Host publication',async()=>{
 const f=fixture();const service=createResourceManager(f.options);
 assert.equal(service.getSnapshot().hostPublication,null);
 f.host.shared.testBuild=true;await service.inspect('th06');assert.deepEqual(service.getSnapshot().hostPublication,{testBuild:true});
 f.responses.set('host-manifest.json',new Error('offline'));await service.inspect('th06');assert.equal(service.getSnapshot().hostPublication,null);
 f.host.shared.testBuild=false;f.responses.set('host-manifest.json',f.host);await service.inspect('th06');assert.deepEqual(service.getSnapshot().hostPublication,{testBuild:false});service.dispose();
});
