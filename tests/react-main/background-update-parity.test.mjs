/** Exact pinned-main differential for update/background feedback ownership.
 * The original app functions and copy are read with git show, not copied into
 * new expected behavior. Actual React preparation services run against explicit
 * Package Store, network, and live-session ports. This is not browser, engine,
 * or durable IndexedDB validation; the BrowserSession mounted fixture checks
 * that its diagnostics callback does not become visible status/toast feedback.
 */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, transform} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const mainRevision = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const baseUrl = 'https://launcher.invalid/deploy/';
let work, api, oracleMessages;
const oracleCode = {};
function pinned(path) {return execFileSync('git', ['show', `${mainRevision}:${path}`], {cwd: project, encoding: 'utf8'});}
function sourceBetween(source, first, next) {
  const start = source.indexOf(first), end = source.indexOf(next, start + first.length);
  assert.ok(start >= 0 && end > start, `Pinned source boundary ${first}`);
  return source.slice(start, end);
}
before(async () => {
  const main = pinned('src/launcher/app.mts');
  const boundaries = {
    foreground: ['async function maybeUpdateInstalledPackageBeforeLaunch(', 'function startBackgroundPackageUpdate('],
    package: ['function startBackgroundPackageUpdate(', 'async function ensureManagedOggStartupBarrier('],
    ogg: ['function startManagedOggProgressiveInstall(', 'async function ensureRuntime('],
  };
  for (const [name, [first, next]] of Object.entries(boundaries)) {
    oracleCode[name] = (await transform(sourceBetween(main, first, next), {loader: 'ts', format: 'esm'})).code;
  }
  const messagesCode = (await transform(pinned('src/launcher/i18n.mts'), {loader: 'ts', format: 'esm'})).code;
  oracleMessages = (await import(`data:text/javascript;base64,${Buffer.from(messagesCode).toString('base64')}`)).UI_MESSAGES;
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-background-parity-'));
  const outfile = resolve(work, 'actual-services.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createPackageAcquisition} from './app/services/package-acquisition.ts';
    export {startPreparedGameBackground} from './app/services/game-preparation-background.ts';
    export {componentFileIds} from './package/package-generation.mjs';
    export {translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

function mainTranslate(locale) {
  return (key, params = {}) => oracleMessages[locale][key].replace(/\{([A-Za-z0-9_]+)\}/g,
    (_, name) => String(params[name] ?? `{${name}}`));
}
const actualTranslate = locale => (key, params) => api.translate(locale, key, params);
function oracle(name, ports) {
  const functionName = {foreground: 'maybeUpdateInstalledPackageBeforeLaunch', package: 'startBackgroundPackageUpdate', ogg: 'startManagedOggProgressiveInstall'}[name];
  return Function(...Object.keys(ports), `${oracleCode[name]}\nreturn ${functionName};`)(...Object.values(ports));
}
function oldGeneration() {
  const ids = ['game-data', 'track-1', 'track-2', 'track-3'];
  return {id: 'installed-old', game: 'th06', descriptor: {
    schema: 'eagler-touhou/package/1', game: 'th06', revision: 'old',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th06', dataFile: 'game-data'},
    files: Object.fromEntries(ids.map(id => [id, {source: id === 'game-data' ? 'th06.data' : `${id}.ogg`,
      target: id === 'game-data' ? '/th06.data' : `/bgm/${id}.ogg`, revision: `${id}-r1`, bytes: 3, sha256: 'a'.repeat(64)}])),
    base: {files: ['game-data']}, components: {ogg: {type: 'ogg', files: ids.slice(1)}},
  }, files: Object.fromEntries(ids.slice(0, 3).map(id => [id, {objectId: `object-${id}`, revision: `${id}-r1`}])),
  };
}
function publication(revision) {return {schema: 'eagler-touhou/release-catalog/1', games: {th06: {revision, descriptor: 'th06.package.json'}}};}
function feedback() {
  const visible = [], diagnostics = [], status = [], activity = [], decisions = [];
  return {visible, diagnostics, status, activity, decisions,
    warn(message, error) {diagnostics.push([message, error.message]);},
    onBackgroundError(error, message) {diagnostics.push([message, error.message]);},
    toast(message) {visible.push(message);},
  };
}
function actualFixture({generation, catalog, locale, source = 'local', install}) {
  const current = {generation, installation: {source}}, metadata = {hostManifest: null, releaseCatalog: catalog};
  let refreshed = 0;
  const acquisition = api.createPackageAcquisition({baseUrl, translate: actualTranslate(locale),
    metadata: {getSnapshot: () => metadata, initialize: async () => {throw new Error('Installed launch must not wait for metadata');},
      refreshInstalled: async () => {refreshed++;}},
    dependencies: {readCurrent: async () => current, installPublished: install},
  });
  return {acquisition, current, get refreshed() {return refreshed;}};
}

for (const locale of ['zh-CN', 'en']) {
  test(`pinned main: background Package failure stays diagnostic-only and keeps current (${locale})`, async () => {
    for (const source of ['local', 'remote']) for (const cancelled of [false, true]) {
      const error = cancelled ? new DOMException('fixture cancelled update', 'AbortError') : new Error('fixture update fetch failed');
      const generation = oldGeneration(), catalog = publication('new'), expected = feedback(), actual = feedback();
      const tasks = new Map(); let originalInstalls = 0, actualInstalls = 0;
      oracle('package', {state: {game: 'th06'}, releaseCatalog: catalog, releaseCatalogUrl: `${baseUrl}release-catalog.json`,
        backgroundPackageUpdates: tasks, selectedLanguageEntriesForPackageUpdate: () => ({language: []}),
        installPublishedPackageLazy: async (_game, options) => {originalInstalls++; assert.equal(options.signal, undefined); throw error;},
        backgroundNetworkActivity: {xhrFetch() {}}, installedPackageSnapshots: new Map(),
        console: {warn: expected.warn, info() {}},
      })({generation, installation: {source}});
      await Promise.all([...tasks.values()]);
      const fixture = actualFixture({generation, catalog, locale, source, install: async (_game, options) => {
        actualInstalls++; assert.equal(options.signal, undefined); throw error;
      }});
      const acquired = await fixture.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja',
        decideUpdate: async () => 'secondary', onWarning: actual.toast, onUpdateActivity: value => actual.activity.push(value)});
      assert.equal(acquired.generation, generation);
      assert.equal(acquired.deferredUpdate, fixture.current);
      assert.equal(actualInstalls, 0, 'Choosing background does not install before post-launch background work');
      await api.startPreparedGameBackground({input: {productId: 'th06', settings: {language: 'ja'}, acquisition: fixture.acquisition,
        translate: actualTranslate(locale), runtime: {getSnapshot: () => ({epoch: 1, launched: true, game: 'th06', music: 'none'})},
        onBackgroundError: actual.onBackgroundError, onWarning: actual.toast},
      prepared: {music: 'none', plan: {game: 'th06', generation}}, epoch: 1, deferredUpdate: acquired.deferredUpdate});
      assert.deepEqual(actual.diagnostics, expected.diagnostics, `${source}, cancel-shaped=${cancelled}`);
      assert.deepEqual(actual.visible, expected.visible);
      assert.deepEqual(actual.visible, []);
      assert.deepEqual(actual.activity, [], 'Background work never opens foreground cancellation');
      assert.equal(actualInstalls, originalInstalls);
      assert.equal((await fixture.acquisition.readCurrent('th06')).generation, generation);
      assert.equal(fixture.refreshed, 0, 'A failed transaction cannot publish a replacement generation');
    }
  });

  test(`pinned main: progressive OGG failure has one live translated toast and no retired feedback (${locale})`, async () => {
    for (const retirement of ['live', 'closed', 'replaced']) {
      const generation = oldGeneration(), catalog = publication('old'), error = new Error('fixture third-track fetch failed');
      const expected = feedback(), actual = feedback(), tasks = new Map();
      const session = {revision: 'old'}; let activeSession = session;
      const state = {game: 'th06', launched: true, music: 'ogg-stream'};
      const originalInstall = async (_game, options) => {
        assert.deepEqual(options.addFileIds, ['track-3']);
        if (retirement === 'closed') state.launched = false;
        if (retirement === 'replaced') activeSession = {revision: 'old'};
        throw error;
      };
      oracle('ogg', {state, currentRuntimeSession: () => session, activeInstalledPackageGeneration: generation,
        runtimeSessionCurrent: value => value === activeSession,
        runtimeSessionAcceptsGenerationRevision: (a, b) => a === b, isOggMusicMode: () => true,
        backgroundOggInstalls: tasks, releaseCatalog: catalog, releaseCatalogUrl: `${baseUrl}release-catalog.json`,
        componentFileIds: api.componentFileIds, installPublishedPackageLazy: originalInstall, packageTrackedFetch: () => () => {},
        installedPackageSnapshots: new Map(), installManagedPackageResources: async () => assert.fail('Failed OGG cannot reach Runtime FS'),
        console: {warn: expected.warn, info() {}}, showToast: expected.toast, t: mainTranslate(locale), errorMessage: value => value.message,
      })();
      await Promise.all([...tasks.values()]);
      let snapshot = {epoch: 1, launched: true, game: 'th06', music: 'ogg'};
      const fixture = actualFixture({generation, catalog, locale, install: async (_game, options) => {
        assert.deepEqual(options.addFileIds, ['track-3']);
        if (retirement === 'closed') snapshot = {...snapshot, launched: false};
        if (retirement === 'replaced') snapshot = {...snapshot, epoch: 2};
        throw error;
      }});
      await api.startPreparedGameBackground({input: {productId: 'th06', settings: {language: 'ja'}, acquisition: fixture.acquisition,
        translate: actualTranslate(locale), runtime: {getSnapshot: () => snapshot,
          extendOggResources: async () => assert.fail('Failed OGG cannot reach Runtime FS')},
        onBackgroundError: actual.onBackgroundError, onWarning: actual.toast},
      prepared: {music: 'ogg-stream', plan: {game: 'th06', generation}}, epoch: 1, deferredUpdate: null});
      assert.deepEqual(actual.diagnostics, expected.diagnostics, retirement);
      assert.deepEqual(actual.visible, expected.visible, retirement);
      assert.equal(actual.visible.length, retirement === 'live' ? 1 : 0);
      assert.equal((await fixture.acquisition.readCurrent('th06')).generation, generation);
      assert.equal(fixture.refreshed, 0);
    }
  });

  test(`pinned main: foreground failure/cancel keeps its visible warning; declining stays quiet (${locale})`, async () => {
    for (const choice of ['confirm', 'cancel']) for (const cancelled of [false, true]) {
      const error = cancelled ? new DOMException('fixture cancelled update', 'AbortError') : new Error('fixture foreground update failed');
      const generation = oldGeneration(), catalog = publication('new'), expected = feedback(), actual = feedback();
      let originalInstalls = 0, actualInstalls = 0;
      const originalResult = await oracle('foreground', {state: {game: 'th06'}, releaseCatalog: catalog,
        releaseCatalogUrl: `${baseUrl}release-catalog.json`, selectedLanguageEntriesForPackageUpdate: () => ({language: []}),
        askDecision: async options => {expected.decisions.push(options); return choice;},
        beginBlockingNetworkOperation: () => {expected.activity.push(true); return {controller: new AbortController()};},
        finishBlockingNetworkOperation: () => expected.activity.push(false), setPlayerStatus: value => expected.status.push(value),
        installPublishedPackageLazy: async () => {originalInstalls++; throw error;}, installedPackageSnapshots: new Map(),
        packageTrackedFetch: () => () => {}, showToast: expected.toast, t: mainTranslate(locale), errorMessage: value => value.message,
        isCancelledDownload: value => value?.name === 'AbortError' || /已取消下载/.test(value?.message ?? String(value)),
      })({generation, installation: {source: 'local'}});
      const fixture = actualFixture({generation, catalog, locale, install: async () => {actualInstalls++; throw error;}});
      const acquired = await fixture.acquisition.acquire({productId: 'th06', music: 'none', language: 'ja',
        decideUpdate: async options => {actual.decisions.push(options); return choice;}, onWarning: actual.toast,
        onUpdateActivity: value => actual.activity.push(value), onProgress: value => actual.status.push(value.message)});
      assert.equal(originalResult, 'none');
      assert.deepEqual(actual.decisions, expected.decisions, 'All decision copy comes from pinned main');
      assert.deepEqual(actual.visible, expected.visible);
      assert.deepEqual(actual.status, expected.status);
      assert.deepEqual(actual.activity, expected.activity);
      assert.equal(actualInstalls, originalInstalls);
      assert.equal(acquired.generation, generation);
      assert.equal(acquired.deferredUpdate, null);
    }
  });
}
