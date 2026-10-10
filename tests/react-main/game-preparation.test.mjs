import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Main-derived preparation adapter fixtures. The real adapter, Runtime owner,
 * descriptor parser and settings model are bundled below. Native messages,
 * Package Store transactions and network are synthetic explicit ports: this is
 * NOT a browser, engine, hardware MIDI or durable IndexedDB validation.
 * Authorities: main src/launcher/app.mts 3980–4110 (imports), 4114–4288 (order),
 * 5634–5983 (local-first/update/OGG/preload), 6137–6228 (language), 6263–6280
 * (file-only); original test-package-{descriptor,zip}, test-music-availability,
 * test-language-fallback-browser and test-legacy-package-app-runtime-browser.
 * Those original files/assertions remain unchanged. No candidate tests reused.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync, strToU8} from 'fflate';

const project = fileURLToPath(new URL('../../', import.meta.url));
const baseUrl = 'https://launcher.invalid/deploy/', origin = new URL(baseUrl).origin;
const bytes = new Uint8Array([1, 2, 3]), hash = createHash('sha256').update(bytes).digest('hex');
let work, api; const runtimeOwners = [];
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-preparation-'));
  const outfile = resolve(work, 'actual-owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createPackageAcquisition} from './app/services/package-acquisition.ts';
    export {prepareGame, prepareGameCheck, prepareFilePlan} from './app/services/game-preparation.ts';
    export {packageResourceIds, ensureOggStartup} from './app/services/game-resources.ts';
    export {validatePackageDescriptor} from './package/package-descriptor.mjs';
    export {createRuntimeService} from './app/services/runtime.ts';
    export {createGameSettingsModel} from './app/models/game-settings.ts';
    export {readManagedRuntimeData, readManagedRuntimeResource} from './src/launcher/runtime-preparation.mts';
    export {validateHostManifest} from './src/contracts/host-manifest.mts';
    export {PRODUCT_GAMES} from './src/contracts/product-catalog.mts';
    export {translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  });
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {for (const runtime of runtimeOwners.splice(0)) {await runtime.close({discardUnsaved: true}); runtime.dispose();}});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const t = (key, params) => api.translate('zh-CN', key, params);
const flush = async () => {for (let index = 0; index < 30; index++) await Promise.resolve();};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function snapshotWhen(runtime, predicate) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {unsubscribe(); reject(new Error(`Synthetic native endpoint did not reach expected phase: ${runtime.getSnapshot().phase}`));}, 1000);
    const changed = () => {if (predicate(runtime.getSnapshot())) {clearTimeout(timer); unsubscribe(); resolve(runtime.getSnapshot());}};
    unsubscribe = runtime.subscribe(changed); changed();
  });
}
const ref = id => ({objectId: `object-${id}`, revision: `${id}-r1`});
function generation({ogg = [], id = 'installed-1', revision = 'package-r1'} = {}) {
  const files = {
    'game-data': {source: 'th06.data', target: '/th06.data', revision: 'game-data-r1', bytes: bytes.length, sha256: hash},
    font: {source: 'msgothic.ttc', target: '/msgothic.ttc', revision: 'font-r1', bytes: bytes.length, sha256: hash},
    unicode: {source: 'unifont.otf', target: '/unifont.otf', revision: 'unicode-r1', bytes: bytes.length, sha256: hash},
  };
  const ids = ['track-1', 'track-2', 'track-3', 'track-4'];
  for (const id of ids) files[id] = {source: `ogg/${id}.ogg`, target: `/bgm/${id}.ogg`, revision: `${id}-r1`, bytes: bytes.length, sha256: hash};
  return {id, game: 'th06', descriptor: {schema: 'eagler-touhou/package/1', game: 'th06', revision,
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th06', dataFile: 'game-data'},
    files, base: {files: ['game-data', 'font', 'unicode']}, components: {ogg: {type: 'ogg', files: ids}}},
    files: Object.fromEntries(['game-data', 'font', 'unicode', ...ogg].map(id => [id, ref(id)]))};
}
function added(source, ids, id = `${source.id}-optional`) {
  return {...source, id, files: {...source.files, ...Object.fromEntries(ids.map(id => [id, ref(id)]))}};
}
function host(extra = {}) {
  return api.validateHostManifest({schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-validation-test',
    shared: {resourceMode: 'hosted', vanillaFont: 'msgothic.ttc', unicodeFont: 'unifont.otf'},
    games: {th06: {runtime: './runtime/th06/th06.html', gameData: {path: 'th06.data', bytes: bytes.length, sha256: hash,
      version: `sha256-${hash}`, layout: `sha256-${'b'.repeat(64)}`}, music: {midi: {files: []}}, ...extra}}});
}
function catalog(revision = 'package-r1') {return {schema: 'eagler-touhou/release-catalog/1', games: {th06: {revision, descriptor: 'games/th06/package.json'}}};}
function acquisitionFixture({current = generation(), hostValue = null, catalogValue = null, dependencies = {}, fetchImpl, network,
  initialize = async () => {}} = {}) {
  const calls = [], metadata = {hostManifest: hostValue, releaseCatalog: catalogValue};
  const installation = () => ({generation: current, installation: current ? {game: 'th06', currentGeneration: current.id,
    pendingGeneration: null, source: 'local'} : null});
  const acquisition = api.createPackageAcquisition({baseUrl, translate: t, indexedDBAvailable: () => true,
    network,
    fetchImpl: fetchImpl ?? (async () => {throw new Error('Unexpected real network path');}),
    metadata: {getSnapshot: () => metadata, initialize: async () => {calls.push('metadata'); await initialize();},
      refreshInstalled: async game => {calls.push(`refresh:${game}`);}},
    dependencies: {readCurrent: async game => {calls.push(`current:${game}`); return installation();},
      installPublished: async () => {throw new Error('Unexpected published installation');}, ...dependencies},
  });
  return {acquisition, calls, metadata, get current() {return current;}, setCurrent(value) {current = value;}};
}
function settingsFixture({productId = 'th06', music = 'none', language = 'ja', languages = [{id: 'ja', pack: null}]} = {}) {
  const storage = new Map();
  const model = api.createGameSettingsModel({storage: {getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)}});
  model.hydrate({productId, uiLocale: 'zh-CN', languages, mobile: false, webMidiAvailable: false,
    musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: true}});
  model.setMusic(music); model.setLanguage(language);
  return {model, storage, snapshot: model.getSnapshot()};
}
/** Actual Runtime owner. Only its native endpoint/FS and canonical store reads
 * are substituted. ACK/ready fixtures are not evidence of a running engine. */
function runtimeFixture(order = [], overrides = {}) {
  const listeners = new Set(), outbound = [], writes = [], dataReads = [], retained = [], navigations = [];
  let service;
  const emit = data => {for (const listener of listeners) listener({origin, source: native, data});};
  const native = {document: {}, FS: {mkdirTree() {}, writeFile(path) {writes.push(path);}}, Module: {},
    location: {href: 'about:blank', replace(url) {
      navigations.push(url); native.location.href = url; native.document = {};
      if (url !== 'about:blank') queueMicrotask(() => {order.push('native-ready'); emit({protocol: 'eagler-touhou/1',
        game: service.getSnapshot().game, epoch: service.getSnapshot().epoch, event: 'ready'});});
    }},
    postMessage(message) {outbound.push(message); order.push(message.command);
      if (message.request) queueMicrotask(() => emit({protocol: message.protocol, game: message.game, epoch: message.epoch,
        request: message.request, ok: true}));},
  };
  service = api.createRuntimeService({translate: t, baseUrl,
    frame: {contentWindow: native, isConnected: true, addEventListener() {}, removeEventListener() {}},
    hostWindow: {location: {href: baseUrl, origin}, addEventListener(_type, fn) {listeners.add(fn);}, removeEventListener(_type, fn) {listeners.delete(fn);}},
    fetchImpl: async () => {throw new Error('Unexpected Runtime network');},
    onLocalResourceProgress: overrides.onLocalResourceProgress,
    dependencies: {
      prepareCode: async () => {throw new Error('No immutable code selection without Host capability');},
      readData: async value => {dataReads.push(value); return api.readManagedRuntimeData(value, {readObject: async () => ({data: bytes.buffer})});},
      readResource: overrides.readResource ?? (async (value, id) => api.readManagedRuntimeResource(value, id, {readObject: async () => ({data: bytes.buffer})})),
      retainGeneration: async (game, id) => {retained.push({game, id});}, releaseGeneration: async () => {},
    }});
  runtimeOwners.push(service);
  return {service, native, outbound, writes, dataReads, retained, navigations,
    firstFrame() {emit({protocol: 'eagler-touhou/1', game: service.getSnapshot().game, epoch: service.getSnapshot().epoch, event: 'first-frame'});}};
}
function gameInput(fixture, state = settingsFixture(), extra = {}) {
  return {productId: 'th06', settings: state.snapshot, acquisition: fixture.acquisition, baseUrl, translate: t,
    touchLayout: null, prepareMidi: async () => {}, ...extra};
}

test('main 5890: local current is chosen without initializing or waiting for remote metadata', async () => {
  const f = acquisitionFixture({initialize: async () => {throw new Error('Must not be reached');}});
  const result = await f.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja'});
  assert.equal(result.kind, 'managed'); assert.equal(result.generation, f.current);
  assert.deepEqual(f.calls, ['current:th06']);
});

test('main 490 and built-in manifest: a known Catalog can supply missing resource components while Host metadata is unavailable', async () => {
  const current = generation();
  current.descriptor.files.resource = {source: 'resources/bgm.dat', target: '/game/bgm.dat', revision: 'resource-r1', bytes: 3};
  current.descriptor.components.resource = {type: 'resource', files: ['resource']};
  const f = acquisitionFixture({current, catalogValue: catalog()}), r = runtimeFixture();
  const result = await api.prepareGame(gameInput(f, settingsFixture(), {runtime: r.service}));
  assert.equal(result.plan.localCatalogRuntime, true);
  assert.deepEqual(result.plan.configure.runtimeResources, [{url: `${baseUrl}games/th06/resources/bgm.dat`, path: '/game/bgm.dat', size: 3}]);
  assert.equal(f.calls.includes('metadata'), false);
});

test('main 458–483: a declared non-DATA resource with a .data suffix remains a valid native FS resource', async () => {
  const current = generation();
  current.descriptor.files.resource = {source: 'resources/table.data', target: '/game/table.data', revision: 'resource-r1', bytes: bytes.length, sha256: hash};
  current.descriptor.components.resource = {type: 'resource', files: ['resource']}; current.files.resource = {objectId: 'resource-object', revision: 'resource-r1'};
  api.validatePackageDescriptor(current.descriptor);
  const f = acquisitionFixture({current}), r = runtimeFixture();
  const result = await api.prepareGame(gameInput(f, settingsFixture(), {runtime: r.service}));
  assert.ok(result.plan.resourceFileIds.includes('resource')); assert.ok(r.writes.includes('/game/table.data'));
  assert.equal(r.writes.includes('/th06.data'), false, 'the descriptor-declared actual DATA remains native-pulled');
});

test('main 507–532 and descriptor policy: an explicitly empty non-OGG resource may be materialized', async () => {
  const current = generation();
  current.descriptor.files.empty = {source: 'resources/empty.cfg', target: '/game/empty.cfg', revision: 'empty-r1', bytes: 0,
    sha256: createHash('sha256').update(new Uint8Array()).digest('hex')};
  current.descriptor.components.resource = {type: 'resource', files: ['empty']}; current.files.empty = {objectId: 'empty-object', revision: 'empty-r1'};
  api.validatePackageDescriptor(current.descriptor);
  const f = acquisitionFixture({current}), r = runtimeFixture([], {readResource: (value, id) => api.readManagedRuntimeResource(value, id,
    {readObject: async () => ({data: id === 'empty' ? new ArrayBuffer(0) : bytes.buffer})})});
  await api.prepareGame(gameInput(f, settingsFixture(), {runtime: r.service}));
  assert.ok(r.writes.includes('/game/empty.cfg'));
});

test('main 6263: file-only reaches native ready without configure, MIDI, language or gameplay', async () => {
  const f = acquisitionFixture({catalogValue: catalog('newer')}); let decisions = 0, midi = 0;
  const state = settingsFixture({music: 'ogg-full', language: 'lang_en', languages: [{id: 'ja', pack: null}, {id: 'lang_en', pack: {url: 'must-not-fetch.zip', bytes: 3, sha256: hash}}]});
  const plan = await api.prepareFilePlan(gameInput(f, state, {decideUpdate: async () => {decisions++; return 'confirm';}, prepareMidi: async () => {midi++;}}));
  assert.equal(plan.fileOnly, true); assert.equal(plan.localCatalogRuntime, true); assert.equal(plan.publishedRuntime, false);
  const r = runtimeFixture(); await r.service.prepare(plan);
  assert.equal(r.service.getSnapshot().ready, true); assert.equal(r.service.getSnapshot().launched, false);
  assert.equal(r.outbound.some(message => message.command === 'configure'), false);
  assert.equal(decisions, 0); assert.equal(midi, 0); assert.equal(r.writes.length, 0);
  await assert.rejects(r.service.launch());
  assert.equal(r.outbound.some(message => message.command === 'launch'), false);
});

for (const form of ['runtime', 'runtimes']) test(`main 4018 and original package/legacy tests: historical ${form} is accepted, executable files excluded from FS`, async () => {
  const original = generation(), descriptor = structuredClone(original.descriptor);
  descriptor.files.entry = {source: 'runtime/th06.html', target: '/runtime/th06.html', revision: 'html-r1', bytes: 4};
  descriptor.files.script = {source: 'runtime/th06.js', target: '/runtime/th06.js', revision: 'js-r1', bytes: 2};
  descriptor.base.files.push('entry', 'script');
  const declaration = {type: 'html', entry: 'entry', playerProtocol: 'eagler-touhou/player/1', bootstrap: ['entry', 'script', 'game-data']};
  if (form === 'runtime') descriptor.runtime = declaration;
  else {descriptor.defaultRuntime = 'normal'; descriptor.runtimes = {normal: declaration};}
  let parsed;
  const f = acquisitionFixture({dependencies: {installZip: async input => {parsed = input;
    return {generation: {...original, descriptor: input.descriptor, files: {...original.files, entry: ref('entry'), script: ref('script')}}, installation: null};}}});
  const zip = zipSync({'package.json': strToU8(JSON.stringify(descriptor)), 'runtime/th06.html': strToU8('html'), 'runtime/th06.js': strToU8('js')}, {level: 0});
  const installed = await f.acquisition.importPackage({game: 'th06', file: new Blob([zip])});
  assert.ok(parsed.descriptor[form]); assert.deepEqual(api.packageResourceIds(installed), ['font', 'unicode']);
  assert.ok(installed.descriptor[form], 'historical declaration remains import data; it is not silently deleted');
});

test('main 5948: hosted preload retains validated authority and asset URL without fake Package generation', async () => {
  const f = acquisitionFixture({current: null, hostValue: host()});
  const plan = await api.prepareFilePlan(gameInput(f));
  assert.equal(plan.generation, null); assert.equal(plan.directPreloadHost, f.metadata.hostManifest);
  const r = runtimeFixture(); await r.service.prepare(plan);
  const source = new URL(r.service.getSnapshot().source);
  assert.equal(source.searchParams.get('asset'), `sha256-${hash}`);
  assert.equal(source.searchParams.get('runtimeVariant'), 'normal'); assert.equal(source.searchParams.has('managedData'), false);
  assert.equal(r.retained.length, 0); assert.equal(r.dataReads.length, 0);
  const invalid = structuredClone(plan); invalid.directPreloadHost.shared.resourceMode = 'external';
  delete invalid.directPreloadHost.shared.vanillaFont; delete invalid.directPreloadHost.shared.unicodeFont;
  invalid.directPreloadHost.games.th06.package = {revision: '0123456789abcdef', descriptor: 'th06.package.json'};
  api.validateHostManifest(invalid.directPreloadHost);
  const other = runtimeFixture(); await assert.rejects(other.service.prepare(invalid), /preload|hosted/i);
});

test('main 5971: resolved Runtime plan hook precedes native navigation and distinguishes direct DATA from managed Package loading', async () => {
  for (const direct of [false, true]) {
    const order = [], f = acquisitionFixture(direct ? {current: null, hostValue: host()} : {}), r = runtimeFixture(order);
    let observed;
    const result = await api.prepareGame(gameInput(f, settingsFixture(), {runtime: r.service, onRuntimePlan(plan) {
      assert.equal(r.navigations.length, 0); observed = structuredClone(plan); order.push('resolved-plan');
      plan.entry = 'https://untrusted.invalid/mutation.html';
    }}));
    assert.equal(observed.generation === null, direct); assert.equal(!!observed.directPreloadHost, direct);
    assert.ok(order.indexOf('resolved-plan') < order.indexOf('native-ready'));
    assert.equal(result.plan.entry, './runtime/th06/th06.html', 'observer cannot change Runtime code authority');
  }
});

test('main 5682: optional update cancel keeps current, while whole-launch abort rejects', async () => {
  for (const wholeLaunch of [false, true]) {
    const optional = new AbortController(), launch = new AbortController(), warnings = [];
    const f = acquisitionFixture({catalogValue: catalog('newer'), dependencies: {installPublished: async (_game, options) => {
      (wholeLaunch ? launch : optional).abort(); assert.equal(options.signal.aborted, true);
      throw new DOMException('Cancelled', 'AbortError');
    }}});
    const pending = f.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja', signal: launch.signal,
      updateSignal: optional.signal, decideUpdate: async () => 'confirm', onWarning: value => warnings.push(value)});
    if (wholeLaunch) {await assert.rejects(pending, {name: 'AbortError'}); assert.deepEqual(warnings, []);}
    else {assert.equal((await pending).generation, f.current); assert.deepEqual(warnings, [t('package.updateCancelled')]);}
  }
});

test('main 5720: failed optional update reports original warning and uses current', async () => {
  const warnings = [], f = acquisitionFixture({catalogValue: catalog('newer'), dependencies: {installPublished: async () => {throw new Error('fixture download failed');}}});
  const result = await f.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja', decideUpdate: async () => 'confirm', onWarning: value => warnings.push(value)});
  assert.equal(result.generation, f.current); assert.deepEqual(warnings, [t('package.updateFailed', {reason: 'fixture download failed'})]);
});

test('main foreground update operation is active only during installation and finishes on success/failure/cancel', async () => {
  for (const mode of ['success', 'failure', 'cancel']) {
    const activity = [], update = new AbortController(); let f;
    f = acquisitionFixture({catalogValue: catalog('newer'), dependencies: {installPublished: async () => {
      activity.push('install');
      if (mode === 'failure') throw new Error('fixture failed update');
      if (mode === 'cancel') {update.abort(); throw new DOMException('Cancelled', 'AbortError');}
      const next = generation({id: 'updated', revision: 'newer'}); f.setCurrent(next); return {generation: next};
    }}});
    const r = runtimeFixture();
    await api.prepareGame(gameInput(f, settingsFixture(), {runtime: r.service, updateSignal: update.signal,
      decideUpdate: async () => {assert.deepEqual(activity, []); return 'confirm';},
      onUpdateActivity: active => activity.push(active)}));
    assert.deepEqual(activity, [true, 'install', false], mode);
    assert.equal(r.service.getSnapshot().generationId, mode === 'success' ? 'updated' : 'installed-1');
  }
});

test('main 5904: ordinary acquisition cancellation exists only during an actual install and always finishes', async () => {
  for (const mode of ['installed', 'direct', 'success', 'failure', 'cancel']) {
    const activity = [], controller = new AbortController();
    const f = acquisitionFixture({current: mode === 'installed' ? generation() : null,
      hostValue: mode === 'direct' ? host() : null, catalogValue: mode === 'installed' || mode === 'direct' ? null : catalog(),
      dependencies: {installPublished: async () => {
        activity.push('install');
        if (mode === 'failure') throw new Error('fixture failed acquisition');
        if (mode === 'cancel') {controller.abort(); throw new DOMException('Cancelled', 'AbortError');}
        return {generation: generation()};
      }}});
    const pending = api.prepareFilePlan(gameInput(f, settingsFixture(), {signal: controller.signal,
      onAcquisitionActivity: value => activity.push(value)}));
    if (mode === 'failure') await assert.rejects(pending, /fixture failed acquisition/);
    else if (mode === 'cancel') await assert.rejects(pending, {name: 'AbortError'});
    else await pending;
    assert.deepEqual(activity, mode === 'installed' || mode === 'direct' ? [] : [true, 'install', false], mode);
  }
});

test('main 3953: development resource acquisition has the same actual-operation cancellation lifetime', async () => {
  for (const mode of ['success', 'failure', 'cancel']) {
    const activity = [], controller = new AbortController(), declared = host().games.th06;
    const development = api.validateHostManifest({...host(), profile: 'web-development', games: {th08: {
      ...declared, runtime: api.PRODUCT_GAMES.th08.runtime, gameData: {...declared.gameData, path: 'th08.data', source: 'development/th08.dat'},
    }}});
    let current = null;
    const acquisition = api.createPackageAcquisition({baseUrl, translate: t, metadata: {getSnapshot: () => ({hostManifest: development, releaseCatalog: null}),
      initialize: async () => {throw new Error('Development current must already be installed');}},
      fetchImpl: async (url, options) => {
        assert.equal(String(url), `${baseUrl}development/th08.dat`); assert.equal(options.signal, controller.signal); return new Response(bytes);
      }, dependencies: {readCurrent: async () => ({generation: current, installation: null}), installAcquired: async options => {
        activity.push('install');
        if (mode === 'failure') throw new Error('fixture development failed');
        if (mode === 'cancel') {controller.abort(); throw new DOMException('Cancelled', 'AbortError');}
        assert.deepEqual(new Uint8Array(await options.acquire('game-data', options.descriptor.files['game-data'])), bytes);
        current = {id: 'development', game: 'th08', descriptor: options.descriptor, files: {'game-data': ref('game-data')}};
        return {generation: current};
      }}});
    const pending = acquisition.acquire({productId: 'th08', music: 'none', language: 'ja', signal: controller.signal,
      onAcquisitionActivity: value => activity.push(value)});
    if (mode === 'failure') await assert.rejects(pending, /fixture development failed/);
    else if (mode === 'cancel') await assert.rejects(pending, {name: 'AbortError'});
    else assert.equal((await pending).generation, current);
    assert.deepEqual(activity, [true, 'install', false]);
  }
});

test('main 1392/5744: acquisition injects per-game foreground fetch and quiet background update fetch separately', async () => {
  const called = [];
  const network = {packageFetch: game => async () => {called.push(`foreground:${game}`); return new Response('');},
    backgroundFetch: async () => {called.push('background'); return new Response('');}};
  const dependencies = {installPublished: async (_game, options) => {await options.fetchImpl('https://launcher.invalid/package'); return {generation: generation()};}};
  const first = acquisitionFixture({current: null, catalogValue: catalog(), network, dependencies});
  await first.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja'});
  const update = acquisitionFixture({catalogValue: catalog('newer'), network, dependencies});
  await update.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja', decideUpdate: async () => 'confirm'});
  await update.acquisition.startBackgroundUpdate({generation: update.current, installation: {source: 'local'}}, {productId: 'th06', music: 'none', language: 'ja'});
  assert.deepEqual(called, ['foreground:th06', 'foreground:th06', 'background']);
});

test('main 4126 and language-fallback original: native ready precedes optional language; failure uses Japanese for this launch only', async () => {
  const order = [], warnings = [], languageActivity = [], languages = [{id: 'ja', pack: null}, {id: 'lang_en', title: 'English', pack: {url: 'language/en.zip', bytes: 3, sha256: hash, runtimeVersion: 'runtime-r1'}}];
  const f = acquisitionFixture({hostValue: host({languageOptions: languages, languages: languages.slice(1)}), fetchImpl: async () => {order.push('language'); return {ok: false, status: 404};}});
  const state = settingsFixture({language: 'lang_en', languages}), before = JSON.stringify([...state.storage]), r = runtimeFixture(order);
  const result = await api.prepareGame(gameInput(f, state, {runtime: r.service, onWarning: value => warnings.push(value),
    onLanguageDownloadActivity: value => languageActivity.push(value), prepareMidi: async () => {order.push('midi');}}));
  assert.equal(result.language, 'ja'); assert.equal(state.model.getSnapshot().language, 'lang_en'); assert.equal(JSON.stringify([...state.storage]), before);
  assert.ok(order.indexOf('native-ready') < order.indexOf('language')); assert.ok(order.indexOf('language') < order.indexOf('configure'));
  assert.equal(order.includes('midi'), false, 'music:none does not prepare MIDI');
  assert.deepEqual(warnings, [t('language.launchFallback', {language: 'English', reason: '/deploy/language/en.zip: HTTP 404'})]);
  assert.equal(result.plan.configure.runtimePack, null); assert.equal(result.plan.configure.options.thpracLocale, 'ja-JP');
  assert.deepEqual(languageActivity, [true, false]);
});

test('main 4126: cancelling language aborts launch rather than choosing optional Japanese fallback', async () => {
  const order = [], activity = [], warnings = [], controller = new AbortController();
  const languages = [{id: 'ja', pack: null}, {id: 'lang_en', title: 'English', pack: {url: 'language/en.zip', bytes: 3, sha256: hash}}];
  const f = acquisitionFixture({fetchImpl: async () => {order.push('language'); controller.abort(); throw new DOMException('Cancelled', 'AbortError');}});
  const state = settingsFixture({language: 'lang_en', languages}), r = runtimeFixture(order), before = JSON.stringify([...state.storage]);
  await assert.rejects(api.prepareGame(gameInput(f, state, {runtime: r.service, signal: controller.signal,
    onLanguageDownloadActivity: value => activity.push(value), onWarning: value => warnings.push(value)})), {name: 'AbortError'});
  assert.ok(order.indexOf('native-ready') < order.indexOf('language')); assert.equal(order.includes('configure'), false);
  assert.deepEqual(activity, [true, false]); assert.deepEqual(warnings, []); assert.equal(JSON.stringify([...state.storage]), before);
});

test('main 5768 and music availability original: exactly two OGG tracks gate startup, DATA stays pinned, remaining tracks start after launch', async () => {
  const initial = generation(), order = [], installs = [], progress = [], third = deferred(), state = settingsFixture({music: 'ogg-full'});
  let f;
  f = acquisitionFixture({current: initial, catalogValue: catalog(), dependencies: {installPublished: async (_game, options) => {
    const ids = [...options.addFileIds]; installs.push(ids); order.push(`download:${ids.join(',')}`);
    if (ids.includes('track-3')) await third.promise;
    const next = added(f.current, ids); f.setCurrent(next); return {generation: next, installation: null};
  }}});
  const r = runtimeFixture(order, {onLocalResourceProgress: value => progress.push(value)}), before = JSON.stringify([...state.storage]);
  const result = await api.prepareGame(gameInput(f, state, {runtime: r.service, prepareMidi: async music => {order.push(`midi:${music}`);}}));
  assert.deepEqual(installs, [['track-1', 'track-2']]);
  assert.ok(order.indexOf('native-ready') < order.indexOf('download:track-1,track-2'));
  assert.ok(order.indexOf('download:track-1,track-2') < order.indexOf('midi:ogg-full'));
  assert.ok(order.indexOf('midi:ogg-full') < order.indexOf('configure'));
  assert.equal(result.plan.generation.id, initial.id); assert.notEqual(result.plan.resourceGeneration.id, initial.id);
  assert.deepEqual(result.plan.localOgg.fileIds, ['track-1', 'track-2']);
  // Main installs these with two Promise.all workers; completion order is unspecified.
  assert.deepEqual(r.writes.filter(path => path.endsWith('.ogg')).sort(), ['/bgm/track-1.ogg', '/bgm/track-2.ogg']);
  const localEvents = progress.length;
  await r.service.launch(); let complete = false; const background = result.startBackground().then(() => {complete = true;});
  await flush(); assert.equal(complete, false); assert.equal(r.service.getSnapshot().launched, true);
  assert.deepEqual(installs.at(-1), ['track-3']); third.resolve(); await background;
  assert.deepEqual(installs, [['track-1', 'track-2'], ['track-3'], ['track-4']]);
  assert.equal(JSON.stringify([...state.storage]), before); assert.equal(r.dataReads.length, 0, 'DATA bridge remains native-pulled; no optional task replaces it');
  assert.ok(r.retained.some(value => value.id === initial.id)); assert.ok(r.writes.includes('/bgm/track-4.ogg'));
  assert.ok(localEvents > 0); assert.equal(progress.length, localEvents,
    'main 5858 remote progressive FS attachment never emits local-OGG ready/progress');
});

test('main concurrent OGG startup waits for both tracks even when the second finishes first', async () => {
  const order = [], first = deferred(), secondWritten = deferred();
  const f = acquisitionFixture({current: generation({ogg: ['track-1', 'track-2']}), catalogValue: catalog()});
  const r = runtimeFixture(order, {readResource: async (value, id) => {
    if (id === 'track-1') await first.promise;
    return api.readManagedRuntimeResource(value, id, {readObject: async () => ({data: bytes.buffer})});
  }});
  const write = r.native.FS.writeFile;
  r.native.FS.writeFile = path => {write(path); if (path === '/bgm/track-2.ogg') secondWritten.resolve();};
  let prepared = false;
  const pending = api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-full'}), {runtime: r.service}))
    .then(result => {prepared = true; return result;});
  await secondWritten.promise;
  assert.deepEqual(r.writes.filter(path => path.endsWith('.ogg')), ['/bgm/track-2.ogg']);
  assert.equal(prepared, false);
  // Main configures its MIDI sentinel before installing local OGG, then gates launch.
  assert.equal(order.includes('configure'), true);
  assert.equal(order.includes('launch'), false);
  first.resolve(); await pending;
  assert.deepEqual(r.writes.filter(path => path.endsWith('.ogg')), ['/bgm/track-2.ogg', '/bgm/track-1.ogg']);
  assert.equal(prepared, true);
  assert.equal(order.includes('configure'), true);
});

test('main 5807: cancelling optional OGG selects launch-only MIDI without rewriting explicit OGG preference', async () => {
  const optional = new AbortController(), warnings = [], state = settingsFixture({music: 'ogg-full'});
  const f = acquisitionFixture({catalogValue: catalog(), dependencies: {installPublished: async () => {optional.abort(); throw new DOMException('Cancelled', 'AbortError');}}});
  const before = JSON.stringify([...state.storage]), modes = [], r = runtimeFixture();
  const result = await api.prepareGame(gameInput(f, state, {runtime: r.service, musicDownloadSignal: optional.signal,
    prepareMidi: async mode => modes.push(mode), onWarning: message => warnings.push(message)}));
  assert.equal(result.music, 'midi'); assert.equal(result.plan.localOgg, undefined); assert.deepEqual(modes, ['midi']);
  assert.deepEqual(warnings, []); assert.equal(state.model.getSnapshot().musicPreference, 'ogg-full'); assert.equal(JSON.stringify([...state.storage]), before);
});

test('main optional startup music operation has a distinct bounded cancellation lifetime and always finishes', async () => {
  for (const mode of ['installed', 'success', 'failure', 'optional-cancel', 'launch-abort']) {
    const activity = [], optional = new AbortController(), launch = new AbortController(); let f;
    f = acquisitionFixture({current: generation({ogg: mode === 'installed' ? ['track-1', 'track-2'] : []}), catalogValue: catalog(),
      dependencies: {installPublished: async () => {
        activity.push('install');
        if (mode === 'failure') throw new Error('fixture optional music failed');
        if (mode === 'optional-cancel') {optional.abort(); throw new DOMException('Cancelled', 'AbortError');}
        if (mode === 'launch-abort') {launch.abort(); throw new DOMException('Cancelled', 'AbortError');}
        const next = added(f.current, ['track-1', 'track-2']); f.setCurrent(next); return {generation: next};
      }}});
    const r = runtimeFixture(), pending = api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-full'}), {runtime: r.service,
      signal: launch.signal, musicDownloadSignal: optional.signal, onMusicDownloadActivity: value => activity.push(value)}));
    if (mode === 'launch-abort') await assert.rejects(pending, {name: 'AbortError'});
    else assert.equal((await pending).music, mode === 'failure' || mode === 'optional-cancel' ? 'midi' : 'ogg-full');
    assert.deepEqual(activity, mode === 'installed' ? [] : [true, 'install', false], mode);
  }
});

test('loaded Package cannot be replaced by optional resources from another DATA generation', async () => {
  // Strengthens the same-session assertion in main 5780–5804 with the existing
  // canonical generation pin; it does not change import format acceptance.
  const initial = generation(), warnings = [];
  const f = acquisitionFixture({current: initial, catalogValue: catalog(), dependencies: {installPublished: async () => {
    const different = added(initial, ['track-1', 'track-2']); different.files['game-data'] = {...ref('game-data'), objectId: 'other-data'};
    return {generation: different, installation: null};
  }}});
  const r = runtimeFixture(), result = await api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-full'}), {runtime: r.service, onWarning: message => warnings.push(message)}));
  assert.equal(result.music, 'midi'); assert.equal(result.plan.generation.id, initial.id); assert.equal(result.plan.resourceGeneration, undefined);
  assert.deepEqual(warnings, [t('music.initialOggFailed', {reason: t('music.initialOggPersistFailed')})]);
});

test('main 5850: in-flight background OGG may persist after close but never writes into a replacement/native-closed document', async () => {
  const third = deferred(), initial = generation({ogg: ['track-1', 'track-2']}); let installedAfterClose = false, f;
  f = acquisitionFixture({current: initial, catalogValue: catalog(), dependencies: {installPublished: async (_game, options) => {
    assert.deepEqual(options.addFileIds, ['track-3']); assert.equal(options.signal, undefined);
    await third.promise; const next = added(initial, ['track-3']); f.setCurrent(next); installedAfterClose = true;
    return {generation: next, installation: null};
  }}});
  const r = runtimeFixture(), result = await api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-stream'}), {runtime: r.service}));
  await r.service.launch(); const background = result.startBackground(); await flush();
  await r.service.close(); third.resolve(); await background;
  assert.equal(installedAfterClose, true); assert.equal(f.current.files['track-3'].objectId, ref('track-3').objectId);
  assert.equal(r.writes.includes('/bgm/track-3.ogg'), false); assert.equal(r.writes.includes('/bgm/track-4.ogg'), false);
});

test('main 1048 and 4114: multiplayer game check uses native-ready continuation, waits for a frame, retires without gameplay transport or save', async () => {
  const order = [], languages = [{id: 'ja', pack: null}, {id: 'lang_en', title: 'English', pack: {url: 'language/en.zip', bytes: 3, sha256: hash}}];
  const f = acquisitionFixture({fetchImpl: async () => {order.push('language'); return {ok: false, status: 404};}});
  const state = settingsFixture({productId: 'th06mp', language: 'lang_en', languages}), r = runtimeFixture(order);
  let done = false;
  const check = api.prepareGameCheck(gameInput(f, state, {productId: 'th06mp', runtime: r.service,
    signal: new AbortController().signal, multiplayer: {kind: 'preflight'}})).then(value => {done = true; return value;});
  void check.catch(() => {});
  await snapshotWhen(r.service, snapshot => snapshot.launched);
  assert.equal(done, false); assert.equal(r.service.getSnapshot().launched, true);
  assert.ok(order.indexOf('native-ready') < order.indexOf('language')); assert.ok(order.indexOf('language') < order.indexOf('configure'));
  const configure = r.outbound.find(message => message.command === 'configure');
  assert.equal(Object.keys(configure.options).some(key => key.startsWith('netplay')), false);
  r.firstFrame(); const prepared = await check;
  assert.equal(prepared.language, 'ja'); assert.equal(done, true); assert.equal(r.service.getSnapshot().ready, false);
  assert.equal(r.outbound.some(message => message.command === 'sync'), false, 'native dry run never creates a save session');
  assert.equal(r.navigations.at(-1), 'about:blank');
});

test('historical OGG: optional size/hash and descriptor-declared target remain accepted like main createLocalMusicInstall', async () => {
  // Original test-package-descriptor explicitly permits missing byte length and
  // custom targets; app 3598–3632 verifies the declared target and optional size.
  const current = generation({ogg: ['track-1', 'track-2']});
  for (const id of ['track-1', 'track-2']) {
    delete current.descriptor.files[id].bytes; delete current.descriptor.files[id].sha256;
    current.descriptor.files[id].target = `/historical-music/${id}.ogg`;
  }
  const f = acquisitionFixture({current}), r = runtimeFixture();
  const result = await api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-stream'}), {runtime: r.service}));
  assert.equal(result.music, 'ogg-stream');
  assert.deepEqual(r.writes.filter(path => path.endsWith('.ogg')), ['/historical-music/track-1.ogg', '/historical-music/track-2.ogg']);
  await r.service.launch(); assert.equal(r.service.getSnapshot().launched, true);
});

test('main 1506/2001: metadata arrival resolves default language from saved choice, not a temporary Japanese-only catalog', () => {
  const values = new Map(), model = api.createGameSettingsModel({storage: {getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)}});
  const context = {...settingsFixture().snapshot.context, uiLocale: 'zh-CN', languages: [{id: 'ja', pack: null}]};
  model.hydrate(context); assert.equal(model.getSnapshot().language, 'ja');
  const available = {...context, languages: [...context.languages, {id: 'lang_zh-hans', pack: null}]};
  model.restoreHostPreferences(available); assert.equal(model.getSnapshot().language, 'lang_zh-hans');
  model.setLanguage('ja'); model.refreshContext(available);
  assert.equal(model.getSnapshot().language, 'ja', 'an explicit durable Japanese preference still wins');
});

test('main disclosure lifetime: ordinary product changes preserve folds; a fresh lobby options lifetime restores its defaults only', () => {
  const model = api.createGameSettingsModel({storage: null}), context = settingsFixture().snapshot.context;
  model.hydrate({...context, mobile: true}); model.setDisclosure('touch', false); model.setDisclosure('advanced', true);
  model.hydrate({...context, productId: 'th07', mobile: true});
  assert.deepEqual(model.getSnapshot().disclosure, {touch: false, files: true, display: true, advanced: true});
  const lobby = {...context, productId: 'th06mp', mobile: true};
  model.hydrate(lobby); model.setDisclosure('files', false); model.setDisclosure('advanced', true);
  model.hydrate(lobby);
  assert.deepEqual(model.getSnapshot().disclosure, {touch: true, files: false, display: true, advanced: true});
  model.hydrate(lobby, {resetDisclosure: true});
  assert.deepEqual(model.getSnapshot().disclosure, {touch: true, files: true, display: true, advanced: false});
  model.hydrate({...context, mobile: true});
  assert.deepEqual(model.getSnapshot().disclosure, {touch: false, files: true, display: true, advanced: true});
});

test('main 3630: initial two OGG reads run together; failure fences a sibling that completes after MIDI fallback', async () => {
  const current = generation({ogg: ['track-1', 'track-2']}), first = deferred(), second = deferred(), both = deferred();
  const reads = [], progress = [], f = acquisitionFixture({current});
  const r = runtimeFixture([], {onLocalResourceProgress: value => progress.push(value), readResource: async (value, id) => {
    if (id === 'track-1' || id === 'track-2') {
      reads.push(id); if (reads.length === 2) both.resolve();
      return id === 'track-1' ? first.promise : second.promise;
    }
    return api.readManagedRuntimeResource(value, id, {readObject: async () => ({data: bytes.buffer})});
  }});
  const pending = api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-stream'}), {runtime: r.service}));
  void pending.catch(() => {}); await both.promise;
  assert.deepEqual(reads, ['track-1', 'track-2'], 'both startup reads are in flight before either settles');
  first.resolve(null); const result = await pending; assert.equal(result.music, 'midi');
  second.resolve({buffer: bytes.buffer, bytes: bytes.length, fileId: 'track-2', path: '/bgm/track-2.ogg'}); await flush();
  assert.equal(r.writes.some(path => path.endsWith('.ogg')), false);
  assert.ok(progress.length > 0); assert.ok(progress.every(value => value.completed === 0 && value.loaded === 0));
  assert.equal(r.native.Module.touhouMusicMode, 'midi', 'late sibling must not restore OGG or revive transfer progress');
});

test('main 3630–3668: remaining local reads use concurrency two and stop sibling writes/progress after failure', async () => {
  const current = generation({ogg: ['track-1', 'track-2', 'track-3', 'track-4']}), third = deferred(), fourth = deferred(), both = deferred();
  const reads = [], progress = [], warnings = [], f = acquisitionFixture({current});
  const r = runtimeFixture([], {onLocalResourceProgress: value => progress.push(value), readResource: async (value, id) => {
    if (id === 'track-3' || id === 'track-4') {
      reads.push(id); if (reads.length === 2) both.resolve(); return id === 'track-3' ? third.promise : fourth.promise;
    }
    return api.readManagedRuntimeResource(value, id, {readObject: async () => ({data: bytes.buffer})});
  }});
  const result = await api.prepareGame(gameInput(f, settingsFixture({music: 'ogg-stream'}), {runtime: r.service, onWarning: message => warnings.push(message)}));
  assert.deepEqual({...progress.at(-1), speed: 0}, {epoch: result.runtimeSnapshot.epoch, game: 'th06', generationId: current.id,
    phase: 'initial', loaded: 6, total: 12, completed: 2, files: 4, speed: 0});
  await r.service.launch(); const background = result.startBackground(); void background.catch(() => {}); await both.promise;
  assert.deepEqual(reads, ['track-3', 'track-4']); third.reject(new Error('fixture remaining read failed')); await background;
  const before = progress.length;
  fourth.resolve({buffer: bytes.buffer, bytes: bytes.length, fileId: 'track-4', path: '/bgm/track-4.ogg'}); await flush();
  assert.deepEqual(warnings, [t('transfer.localOggPartialFailed', {reason: 'fixture remaining read failed'})]);
  assert.equal(r.writes.includes('/bgm/track-3.ogg'), false); assert.equal(r.writes.includes('/bgm/track-4.ogg'), false);
  assert.equal(progress.length, before); assert.equal(progress.at(-1).completed, 2); assert.equal(progress.at(-1).phase, 'remaining');
});
