import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Main-derived metadata service contract, synthetic fetch/readonly IDB ports.
 * This does not establish real network, IndexedDB persistence or browser behavior.
 * Main authorities: app:1395–1490,1924–1936,1988–1998,4299–4317;
 * original test-remote-metadata and test-language-catalog assertions stay intact.
 */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const project = fileURLToPath(new URL('../../', import.meta.url));
let work, createMetadataService;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-metadata-'));
  const outfile = resolve(work, 'actual-service.mjs');
  await build({absWorkingDir: project, entryPoints: ['app/services/metadata.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  });
  ({createMetadataService} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const flush = async () => {for (let i = 0; i < 15; i++) await Promise.resolve();};
const hash = 'a'.repeat(64);
const pack = {url: 'lang-en.zip', bytes: 123, sha256: hash, runtimeVersion: 'runtime-v1'};
const hostGame = (game, extra = {}) => ({runtime: `runtime/${game}/${game}.html`,
  gameData: {version: `sha256-${hash}`, layout: `sha256-${'b'.repeat(64)}`, path: `${game}.data`, bytes: 1, sha256: hash},
  music: {midi: {files: []}}, ...extra});
const host = (games = {th06: hostGame('th06')}, shared = {}) => ({schema: 'eagler-touhou/host-manifest/1',
  protocol: 'eagler-touhou/1', profile: 'web-validation-test',
  shared: {resourceMode: 'hosted', vanillaFont: '../shared/msgothic.ttc', unicodeFont: '../shared/unifont.otf', ...shared}, games});
const catalog = {schema: 'eagler-touhou/release-catalog/1', games: {th06: {revision: 'published-r1', descriptor: 'th06.package.json'}}};
function network(hostValue = host(), catalogValue = catalog) {
  const calls = [];
  return {calls, fetch: async (url, init) => {
    const file = new URL(url).pathname.split('/').at(-1); calls.push({url: String(url), init});
    const value = file === 'host-manifest.json' ? hostValue : catalogValue;
    if (value instanceof Error) throw value;
    return {ok: true, status: 200, json: async () => value};
  }};
}
function fixture(net = network(), extra = {}) {
  return createMetadataService({baseUrl: 'https://launcher.invalid/deploy/index.html?game=th06',
    fetchImpl: net.fetch, storage: null, indexedDBFactory: {open() {throw new Error('Synthetic IDB unavailable');}},
    translate: (locale, key, params) => `${locale}:${key}${params ? ':' + JSON.stringify(params) : ''}`,
    webAudioAvailable: true, webMidiAvailable: false, mobile: false, ...extra});
}
/** Only the actual Package Store read protocol is implemented. There is no write
 * API, migration, fake service replacement or claim of durable IDB behavior. */
function readonlyIdb() {
  const owner = {mode: 'auto', generation: null, requests: [], closed: 0, transactions: [],
    open() {
      if (owner.mode === 'error') throw new Error('Synthetic IDB read failure');
      const request = {}, generation = owner.generation;
      const db = {close() {owner.closed++;}, transaction(stores, mode) {
        assert.equal(mode, 'readonly'); owner.transactions.push({stores, mode});
        const transaction = {objectStore(name) {return {get(key) {
          const query = {};
          const value = name === 'installations'
            ? generation?.game === key ? {currentGeneration: generation.id} : null
            : Array.isArray(key) && key[0] === generation?.game && key[1] === generation?.id ? generation : null;
          queueMicrotask(() => {query.onsuccess?.({target: {result: value}}); queueMicrotask(() => transaction.oncomplete?.());});
          return query;
        }};}};
        return transaction;
      }};
      const pending = {succeed() {request.onsuccess?.({target: {result: db}});}, fail() {request.error = new Error('Synthetic IDB read failure'); request.onerror?.();}};
      owner.requests.push(pending);
      if (owner.mode === 'auto') queueMicrotask(pending.succeed);
      return request;
    },
  };
  return owner;
}
function generation(revision = 'installed-r1') {
  return {id: `gen-${revision}`, game: 'th06', descriptor: {schema: 'eagler-touhou/package/1', game: 'th06', revision,
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th06', dataFile: 'data'}, base: {files: ['data']},
    components: {ogg: {type: 'ogg', files: ['ogg-1']}, language: {type: 'language', entries: [{id: 'lang_zh-hant', file: 'lang-zh'}]}},
    files: {data: {source: 'game.data', target: '/game.data', revision: 'data-r1'},
      'ogg-1': {source: 'one.ogg', target: '/bgm/one.ogg', revision: 'ogg-r1', bytes: 1},
      'lang-zh': {source: 'lang-zh.zip', target: '/language/lang-zh.zip', revision: 'lang-r1', bytes: 456}}},
    files: {'ogg-1': {objectId: 'obj-ogg'}, 'lang-zh': {objectId: 'obj-zh'}}};
}

test('metadata: construction is side-effect free; concurrent initialize shares actual work', async () => {
  const net = network(), service = fixture(net);
  assert.equal(service.getSnapshot().phase, 'idle'); assert.equal(net.calls.length, 0);
  let notifications = 0; const unsubscribe = service.subscribe(() => notifications++);
  const first = service.initialize(), second = service.initialize(); assert.equal(first, second);
  await first; assert.equal(net.calls.length, 2); assert.equal(service.getSnapshot().phase, 'ready');
  assert.ok(notifications >= 2); unsubscribe(); service.dispose();
});
for (const fail of ['host', 'catalog', 'both']) test(`metadata: ${fail} failure preserves independent successful authority`, async () => {
  const net = network(fail === 'host' || fail === 'both' ? new Error('host offline') : host(),
    fail === 'catalog' || fail === 'both' ? new Error('catalog offline') : catalog);
  const service = fixture(net); await service.initialize(); const snapshot = service.getSnapshot();
  assert.equal(snapshot.phase, 'ready'); assert.equal(snapshot.hostManifest !== null, fail === 'catalog');
  assert.equal(snapshot.releaseCatalog !== null, fail === 'host'); assert.equal(snapshot.metadataErrors.length, fail === 'both' ? 2 : 1);
  for (const call of net.calls) {assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal instanceof AbortSignal); assert.match(call.url, /^https:\/\/launcher.invalid\/deploy\/(host-manifest|release-catalog).json$/);}
  service.dispose();
});

test('metadata: 12-second deadline aborts both requests and reports original localized timeout key', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const calls = [];
  const service = fixture({fetch: (url, init) => new Promise((_resolve, reject) => {
    calls.push({url, init}); init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })}, {locale: () => 'en'});
  const pending = service.initialize(); t.mock.timers.tick(11999); await flush();
  assert.equal(service.getSnapshot().phase, 'loading'); assert.ok(calls.every(call => !call.init.signal.aborted));
  t.mock.timers.tick(1); await pending;
  assert.equal(service.getSnapshot().metadataErrors.length, 2); assert.ok(calls.every(call => call.init.signal.aborted));
  for (const error of service.getSnapshot().metadataErrors) assert.match(error.message, /^en:runtime.requestTimeoutDetail:.*"seconds":12/);
  service.dispose();
});

test('metadata: slow local hints do not block remote ready; readonly results hydrate later', async () => {
  const idb = readonlyIdb(); idb.mode = 'hold'; idb.generation = generation();
  const service = fixture(network(), {indexedDBFactory: idb}); await service.initialize();
  assert.equal(service.getSnapshot().phase, 'ready'); assert.equal(service.getSnapshot().installed.size, 0);
  assert.ok(idb.requests.length > 1); for (const request of idb.requests) request.succeed(); await flush();
  assert.equal(service.getSnapshot().installed.get('th06').descriptor.revision, 'installed-r1');
  assert.ok(idb.transactions.every(transaction => transaction.mode === 'readonly')); service.dispose();
});

test('metadata: failed hint refresh preserves prior value; successful empty read removes it', async () => {
  const idb = readonlyIdb(); idb.generation = generation(); const service = fixture(network(), {indexedDBFactory: idb});
  await service.refreshInstalled('th06'); const prior = service.getSnapshot().installed.get('th06'); assert.ok(prior);
  idb.mode = 'error'; await service.refreshInstalled('th06'); assert.equal(service.getSnapshot().installed.get('th06'), prior);
  idb.mode = 'auto'; idb.generation = null; await service.refreshInstalled('th06'); assert.equal(service.getSnapshot().installed.has('th06'), false); service.dispose();
});

test('metadata: latest per-game read wins and dispose prevents stale read/network publication', async () => {
  const idb = readonlyIdb(); idb.mode = 'hold'; idb.generation = generation('old');
  const service = fixture(network(), {indexedDBFactory: idb}); const old = service.refreshInstalled('th06');
  idb.generation = generation('new'); const current = service.refreshInstalled('th06');
  idb.requests[1].succeed(); await current; idb.requests[0].succeed(); await old;
  assert.equal(service.getSnapshot().installed.get('th06').descriptor.revision, 'new');
  idb.generation = generation('after-dispose'); const stale = service.refreshInstalled('th06'), snapshot = service.getSnapshot();
  service.dispose(); idb.requests[2].succeed(); await stale; assert.equal(service.getSnapshot(), snapshot);
  const calls = [], deferred = [];
  const net = {fetch: (url, init) => new Promise(resolve => {calls.push({url, init}); deferred.push(() => resolve({ok: true, json: async () => String(url).includes('host-manifest') ? host() : catalog}));})};
  const other = fixture(net); const pending = other.initialize(); const loading = other.getSnapshot(); other.dispose();
  assert.ok(calls.every(call => call.init.signal.aborted)); deferred.forEach(resolve => resolve()); await pending;
  assert.equal(other.getSnapshot(), loading); await other.initialize(); assert.equal(calls.length, 2);
});

test('metadata: host publication, test-only product and multiplayer-runtime filters retain main policy', async () => {
  const published = host({th06: hostGame('th06'), th07: hostGame('th07', {multiplayerRuntime: 'runtime/th07/mp.html'}), th20: hostGame('th20')});
  const normal = fixture(network(published)); assert.equal(normal.getSnapshot().products.includes('th20'), false);
  await normal.initialize(); assert.deepEqual(normal.getSnapshot().products, ['th06', 'th07', 'th07mp']); normal.dispose();
  for (const extra of [{testBuild: true}, {baseUrl: 'https://launcher.invalid/deploy/?test'}]) {
    const service = fixture(network(published), extra); await service.initialize(); assert.ok(service.getSnapshot().products.includes('th20')); service.dispose();
  }
  const hostTest = fixture(network({...published, shared: {...published.shared, testBuild: true}})); await hostTest.initialize();
  assert.ok(hostTest.getSnapshot().products.includes('th20')); hostTest.dispose();
});

test('metadata: original language overlays and music context use current package hints', async () => {
  const idb = readonlyIdb(); idb.generation = generation();
  const published = host({th06: hostGame('th06', {
    languageOptions: [{id: 'ja', pack: null}, {id: 'lang_en', pack}], languages: [{id: 'lang_en', pack}],
    music: {midi: {files: [], supported: false}, wav: {files: ['one.wav']}},
  })});
  const offline = [{id: 'lang_zh-hans', pack: {...pack, url: 'cached-zh.zip'}}];
  const storage = {getItem(key) {return key === 'eagler-touhou-th06-offline-language-index-v1' ? JSON.stringify(offline) : null;}};
  const service = fixture(network(published), {indexedDBFactory: idb, storage, webAudioAvailable: false, webMidiAvailable: true, mobile: true});
  await service.initialize(); await service.refreshInstalled('th06'); const context = service.settingsContext('th06mp', 'en');
  assert.deepEqual(context.languages.map(entry => entry.id), ['ja', 'lang_zh-hans', 'lang_zh-hant', 'lang_en']);
  assert.equal(context.languages.find(entry => entry.id === 'lang_zh-hant').packageObjectId, 'obj-zh');
  assert.equal(context.languages.find(entry => entry.id === 'lang_en').title, 'en:gameLanguage.en');
  assert.deepEqual(context.musicAvailability, {audio: false, midiAvailable: false, importServer: false,
    publishedOggCapable: true, remoteOggAdvertised: false, remoteRevision: 'published-r1',
    installed: {revision: 'installed-r1', oggFileIds: ['ogg-1'], files: idb.generation.files}});
  assert.equal(context.productId, 'th06mp'); assert.equal(context.webMidiAvailable, true); assert.equal(context.mobile, true); service.dispose();
});
