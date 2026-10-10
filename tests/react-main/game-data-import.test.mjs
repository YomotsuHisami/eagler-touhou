import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Actual plain recovery model with synthetic picker/installer/Runtime/timers.
 * Main authorities: app1588–1605,3318–3488,9538–9605,9643–9740 and unchanged
 * test-launcher-lifecycle continuation assertions. No browser file picker,
 * download, native engine or durable Package Store behavior is established. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, work; const fixtures = [];
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-data-import-'));
  const outfile = resolve(work, 'actual-model.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createGameDataImportModel} from './app/models/game-data-import.ts';
    export {GameDataAcquisitionError} from './app/services/game-data-acquisition.ts';
    export {translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  }); api = await import(pathToFileURL(outfile).href);
});
afterEach(() => {for (const {model, timers} of fixtures.splice(0)) {model.dispose(); assert.equal(timers.pending.size, 0);}});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const t = (key, params) => api.translate('zh-CN', key, params);
const file = () => new Blob(['synthetic package']);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function timersFixture() {
  let now = 0, id = 0; const pending = new Map();
  return {pending, setTimeout(fn, delay) {pending.set(++id, {fn, at: now + delay}); return id;}, clearTimeout(id) {pending.delete(id);},
    advance(ms) {const end = now + ms; while (true) {
      const next = [...pending].filter(([,value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; pending.delete(next[0]); next[1].fn();
    } now = end;}};
}
function fixture({context: patch = {}, importPackage, portOverrides = {}} = {}) {
  const context = {product: 'th06', roomCode: null, replayViewer: false, runtimeReady: false, launched: false,
    playerOpen: false, importServer: false, fallback: null, ...patch};
  const calls = [], statuses = [], playerStatuses = [], toasts = [], timers = timersFixture();
  const installed = {id: 'fixture-generation', game: 'th06', files: {data: {objectId: 'fixture-data'}, font: {objectId: 'fixture-font'}}};
  let picked = null, blocking = null;
  const ports = {
    pickFile: async options => {calls.push(['pick', options]); return picked;},
    closePlayer: async () => {calls.push(['close']); context.playerOpen = false; return true;},
    resetUnlaunchedRuntime: async () => {calls.push(['reset']); context.runtimeReady = false;},
    openPlayer: product => {calls.push(['open', product]); context.playerOpen = true;},
    launchConfigured: async () => {calls.push(['launch']); context.launched = true;},
    feedback: {status: value => statuses.push(value), playerStatus: value => playerStatuses.push(value), toast: value => toasts.push(value)},
    beginBlockingDownload({label, onCancel}) {
      calls.push(['block', label]); let finished = false;
      blocking = {finish() {if (!finished) {finished = true; calls.push(['finish']);}},
        async cancel() {if (finished) return; calls.push(['abort']); blocking.finish(); await onCancel();}};
      return blocking;
    }, ...portOverrides,
  };
  const model = api.createGameDataImportModel({translate: t, getContext: () => context, timers, ports,
    acquisition: {importPackage: async input => {calls.push(['install', input.game]); return importPackage ? importPackage(input) : installed;}}});
  const result = {model, timers, context, calls, statuses, playerStatuses, toasts, installed, pick(value) {picked = value;}};
  fixtures.push(result); return result;
}

test('main manual import is install-only; success closes the window without prepare, fullscreen or launch', async () => {
  const f = fixture(); f.model.openManual();
  assert.equal(f.model.getSnapshot().importOpen, true); assert.equal(f.model.getSnapshot().attempt.continuation.kind, 'install-only');
  assert.equal(f.model.getSnapshot().reason, t('package.manualImportReason', {reason: t('package.manualImportIntro')}));
  await f.model.importFile(file());
  assert.deepEqual(f.calls, [['install', 'th06']]); assert.equal(f.model.getSnapshot().attempt, null);
  assert.deepEqual(f.statuses, [t('package.importedReady')]); assert.deepEqual(f.toasts, [t('package.imported', {count: 2})]);
});

test('main import-required resumes matching captured launch by reset → open → configured launch without another user step', async () => {
  const f = fixture({context: {importServer: true}}); f.model.beginImportRequired();
  assert.equal(f.model.getSnapshot().reason, t('package.importServerOnly', {reason: t('package.noLaunchableLocal')}));
  await f.model.importFile(file());
  assert.deepEqual(f.calls, [['install', 'th06'], ['reset'], ['open', 'th06'], ['launch']]);
  assert.deepEqual(f.playerStatuses, [t('package.continuing')]); assert.equal(f.model.getSnapshot().attempt, null);
});

for (const change of [{product: 'th07'}, {roomCode: 'OTHER'}, {replayViewer: true}]) test(`original lifecycle: captured launch does not cross ${Object.keys(change)[0]} change`, async () => {
  const pending = deferred(), f = fixture({context: {roomCode: 'ROOM'}, importPackage: () => pending.promise});
  f.model.beginImportRequired(); const importing = f.model.importFile(file());
  Object.assign(f.context, change); pending.resolve(f.installed); await importing;
  assert.equal(f.calls.some(([name]) => name === 'launch'), false); assert.deepEqual(f.statuses, [t('package.importedReady')]);
});

test('main fallback timers: unlock after 10s, dismiss survives 20s reason update, link close leaves import open', () => {
  let revealed = 0;
  const f = fixture({context: {fallback: {url: 'https://downloads.invalid/package.zip', hint: 'original hint'}},
    portOverrides: {showGameDataTransfer() {revealed++;}}});
  f.model.beginDirectDownload(); f.timers.advance(9999); assert.equal(f.model.getSnapshot().importOpen, false);
  f.timers.advance(1); assert.equal(f.model.getSnapshot().importOpen, true);
  assert.equal(revealed, 1);
  assert.equal(f.model.getSnapshot().reason, t('package.fallbackWaitOrImport', {reason: t('package.firstByteTimeout')}));
  f.model.openLink(); assert.equal(f.model.getSnapshot().linkOpen, true); f.model.closeLink(); assert.equal(f.model.getSnapshot().importOpen, true);
  f.model.dismissImport(); f.timers.advance(10000); assert.equal(f.model.getSnapshot().importOpen, false);
  assert.equal(revealed, 2, 'dismissed import stays dismissed, but original transfer is still revealed');
  assert.equal(f.model.getSnapshot().reason, t('package.fallbackWaitOrImport', {reason: t('package.downloadStartTimeout')}));
  f.model.openImport(); assert.equal(f.model.getSnapshot().importOpen, true);
});

test('main first-byte/completion timers ignore music and finish authoritatively at native ready', () => {
  const f = fixture(); f.model.beginDirectDownload(); f.model.noteTransfer({kind: 'music', loaded: 3, total: 3});
  assert.equal(f.model.getSnapshot().attempt.firstByte, false);
  f.model.noteTransfer({kind: 'game', loaded: 1, total: 3}); f.timers.advance(10000); assert.equal(f.model.getSnapshot().importOpen, false);
  f.timers.advance(10000); assert.equal(f.model.getSnapshot().reason, t('package.fallbackWaitOrImport', {reason: t('package.downloadSlow')}));
  f.model.finish(); assert.equal(f.model.getSnapshot().attempt, null); assert.equal(f.timers.pending.size, 0);
  f.model.beginDirectDownload(); f.model.noteTransfer({kind: 'game', loaded: 3, total: 3}); f.timers.advance(30000);
  assert.equal(f.model.getSnapshot().attempt.downloadComplete, true); assert.equal(f.model.getSnapshot().importOpen, false);
});

test('main direct cancellation captures launch; generic launch-button download cancellation opens install-only', async () => {
  const direct = fixture({context: {playerOpen: true}}); direct.model.beginDirectDownload(); await direct.model.cancelDirectDownload();
  assert.equal(direct.model.getSnapshot().attempt.continuation.kind, 'launch'); assert.equal(direct.model.getSnapshot().importOpen, true);
  assert.deepEqual(direct.statuses, [t('package.downloadCancelledImport')]); assert.ok(direct.calls.some(([name]) => name === 'close'));
  const generic = fixture({context: {playerOpen: true}});
  assert.equal(await generic.model.handleLaunchFailure(new DOMException('Cancelled', 'AbortError')), true);
  assert.equal(generic.model.getSnapshot().attempt.continuation.kind, 'install-only');
});

test('main cancelled close does not open replacement import flow', async () => {
  const f = fixture({context: {playerOpen: true}, portOverrides: {closePlayer: async () => false}});
  assert.equal(await f.model.handleLaunchFailure(new api.GameDataAcquisitionError('missing')), true);
  assert.equal(f.model.getSnapshot().attempt, null); assert.deepEqual(f.statuses, []);
});

test('main DATA errors have separate hosted/import-server recovery; engine/OGG errors do not offer a package', async () => {
  const hosted = fixture();
  assert.equal(await hosted.model.handleLaunchFailure(new Error('OGG decoder failed')), false); assert.equal(hosted.model.getSnapshot().attempt, null);
  assert.equal(await hosted.model.handleLaunchFailure(new api.GameDataAcquisitionError('missing data')), true);
  assert.equal(hosted.model.getSnapshot().reason, t('package.resourceFailureLocal')); assert.equal(hosted.model.getSnapshot().attempt.continuation.kind, 'launch');
  assert.deepEqual(hosted.statuses, [t('package.resourceFailureStatus')]);
  const imported = fixture({context: {importServer: true}});
  await imported.model.handleLaunchFailure(new api.GameDataAcquisitionError('missing data'));
  assert.equal(imported.model.getSnapshot().reason, t('package.importServerOnly', {reason: 'missing data'}));
  assert.deepEqual(imported.toasts, ['missing data']);
});

for (const [message, key, importServer] of [['bad ZIP', 'package.importInvalid', false], ['IndexedDB quota', 'package.importStorageFailed', false], ['bad ZIP', 'package.importServerMissing', true]]) {
  test(`main failed import reopens original ${key} reason and permits retry`, async () => {
    let count = 0; const f = fixture({context: {importServer}, importPackage: async () => {if (++count === 1) throw new Error(message); return {files: {one: {objectId: 'one'}}};}});
    f.model.openManual(); await f.model.importFile(file());
    assert.equal(f.model.getSnapshot().reason, t(key, {reason: message})); assert.equal(f.model.getSnapshot().busy, false); assert.equal(f.model.getSnapshot().importOpen, true);
    await f.model.importFile(file()); assert.equal(count, 2); assert.equal(f.model.getSnapshot().importOpen, false); assert.equal(f.calls.some(([name]) => name === 'launch'), false);
  });
}

test('main picker cancellation is inert; busy import disables dismiss and ignores duplicate submission', async () => {
  const pending = deferred(), f = fixture({importPackage: () => pending.promise}); f.model.openManual();
  await f.model.chooseFile(); assert.deepEqual(f.calls, [['pick', {accept: '.zip,.dat,application/zip'}]]);
  assert.equal(f.model.getSnapshot().importOpen, true);
  const importing = f.model.importFile(file()); assert.equal(f.model.getSnapshot().busy, true); f.model.dismissImport(); await f.model.importFile(file());
  assert.equal(f.model.getSnapshot().importOpen, true); assert.equal(f.calls.filter(([name]) => name === 'install').length, 1);
  pending.resolve(f.installed); await importing; assert.equal(f.model.getSnapshot().busy, false);
});

test('main stale import completion cannot clear/launch a newer attempt', async () => {
  const pending = deferred(), f = fixture({importPackage: () => pending.promise}); f.model.beginImportRequired();
  const importing = f.model.importFile(file()); f.model.beginManual({reason: 'new attempt'}); const id = f.model.getSnapshot().attempt.id;
  pending.resolve(f.installed); await importing;
  assert.equal(f.model.getSnapshot().attempt.id, id); assert.equal(f.model.getSnapshot().importOpen, true); assert.deepEqual(f.toasts, []);
  assert.equal(f.calls.some(([name]) => name === 'launch'), false);
});

test('main room install-only import resumes its captured preparation rather than launching gameplay', async () => {
  const calls = [], handle = {markImporting() {calls.push('importing');}, cancelIfImporting() {calls.push('cancelled');}, async resume() {calls.push('resume');}};
  const f = fixture({context: {product: 'th06mp', roomCode: 'ROOM'}, portOverrides: {roomPreparationForImport: value => value?.kind === 'install-only' ? handle : null}});
  f.model.beginManual(); await f.model.importFile(file());
  assert.deepEqual(calls, ['importing', 'resume']); assert.deepEqual(f.statuses, [t('package.continuing')]); assert.equal(f.calls.some(([name]) => name === 'launch'), false);
});

test('main direct fallback import replaces the loading Runtime and launches without opening a second Player', async () => {
  const f = fixture({context: {playerOpen: true}}); f.model.beginDirectDownload(); f.model.unlock('slow'); await f.model.importFile(file());
  assert.equal(f.calls.some(([name]) => name === 'open'), false);
  assert.deepEqual(f.calls.filter(([name]) => ['install', 'reset', 'launch'].includes(name)), [['install', 'th06'], ['reset'], ['launch']]);
  assert.deepEqual(f.playerStatuses, [t('package.localLaunching')]); assert.equal(f.model.getSnapshot().attempt, null);
});

test('asynchronous reset port cannot launch a changed product after the canonical continuation check', async () => {
  const reset = deferred(), f = fixture({portOverrides: {resetUnlaunchedRuntime: () => reset.promise}}); f.model.beginImportRequired();
  const importing = f.model.importFile(file()); await Promise.resolve(); await Promise.resolve();
  f.context.product = 'th07'; reset.resolve(); await importing;
  assert.equal(f.calls.some(([name]) => name === 'launch' || name === 'open'), false);
});
