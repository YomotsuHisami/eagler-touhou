import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Actual transfer presentation owner, deterministic synthetic time/frames/ports.
 * Main app1206–1270,3288–3316,3445–3547,3577–3668,6068–6129,9632–9641.
 * No native network, rendering, browser animation or engine claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync, strToU8} from 'fflate';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, work; const owners = [];
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-transfer-'));
  const outfile = resolve(work, 'actual-model.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createTransferModel, transferPresentation, transferClock} from './app/models/transfer.ts';
    export {prepareLanguagePack} from './app/services/language-pack.ts';
    export {createPreparationNetwork, packageNetworkMetadata} from './app/services/preparation-network.ts';
    export {createNetworkActivityTracker} from './src/launcher/network-activity.mts';
    export {translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  }); api = await import(pathToFileURL(outfile).href);
});
afterEach(() => {for (const f of owners.splice(0)) {f.model.dispose(); assert.equal(f.pending.size, 0); assert.equal(f.frameQueue.size, 0);}});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const t = (key, params) => api.translate('zh-CN', key, params), MiB = 1048576;
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function fixture({retry = async () => {}, cancel = async () => {}} = {}) {
  let now = 1000, serial = 0; const pending = new Map(), frameQueue = new Map(), statuses = [], toasts = [], noted = [], retryTimeouts = [];
  const state = {epoch: 1, launched: false, iosWebKitTouch: false};
  const model = api.createTransferModel({translate: t, context: () => state, now: () => now,
    timers: {setTimeout(fn, delay) {pending.set(++serial, {fn, at: now + delay}); return serial;}, clearTimeout(id) {pending.delete(id);}},
    frames: {request(fn) {frameQueue.set(++serial, fn); return serial;}, cancel(id) {frameQueue.delete(id);}},
    ports: {retryMusic: async timeout => {retryTimeouts.push(timeout); await retry();}, cancelDownload: cancel,
      playerStatus: value => statuses.push(value), toast: value => toasts.push(value), noteGameDataTransfer: value => noted.push(value)},
  });
  const f = {model, state, pending, frameQueue, statuses, toasts, noted, retryTimeouts,
    frame() {const current = [...frameQueue.values()]; frameQueue.clear(); for (const fn of current) fn();},
    advance(ms) {const end = now + ms; while (true) {
      const next = [...pending].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; pending.delete(next[0]); next[1].fn();
    } now = end;},
  }; owners.push(f); return f;
}
const task = (extra = {}) => ({id: 'one', url: '/data', title: 'original title', label: 'original label', kind: 'game', phase: 'receiving',
  loaded: MiB, total: 3 * MiB, startedAt: 0, updatedAt: 1000, ...extra});
const net = (active, loaded = active.reduce((sum, value) => sum + value.loaded, 0), total = active.reduce((sum, value) => sum + value.total, 0)) => ({active, count: active.length, loaded, total});

test('main native transfer preserves MiB text, 72/28 speed smoothing, ceiling ETA and mode reset', () => {
  const f = fixture(); f.model.runtimeTransfer({kind: 'music', mode: 'ogg', loaded: MiB, total: 3 * MiB, speed: MiB});
  let state = f.model.getSnapshot(); assert.equal(state.amount, '1.0 / 3.0 MiB'); assert.equal(state.barWidth, '33.3%'); assert.equal(state.speedText, '1.0 MiB/s'); assert.equal(state.etaText, '00:02');
  f.model.runtimeTransfer({kind: 'music', mode: 'ogg', loaded: 2 * MiB, total: 3 * MiB, speed: 3 * MiB});
  state = f.model.getSnapshot(); assert.equal(state.speedText, '1.6 MiB/s'); assert.equal(state.etaText, '00:01');
  f.model.runtimeTransfer({kind: 'language', mode: 'language', loaded: MiB, total: 3 * MiB, speed: 2048});
  assert.equal(f.model.getSnapshot().speedText, '2 KiB/s'); assert.equal(f.noted.length, 3);
});

test('main requesting/preparing unknown totals retain distinct copy and 34% indeterminate bar', () => {
  const f = fixture(); f.model.runtimeTransfer({phase: 'requesting'});
  assert.equal(f.model.getSnapshot().amount, t('transfer.waitingServer')); assert.equal(f.model.getSnapshot().speedText, t('transfer.waiting'));
  assert.equal(f.model.getSnapshot().barWidth, '34%'); assert.equal(f.model.getSnapshot().indeterminate, true);
  f.model.runtimeTransfer({phase: 'preparing', statusText: 'native supplied status'});
  assert.equal(f.model.getSnapshot().amount, 'native supplied status'); assert.equal(f.model.getSnapshot().speedText, t('transfer.preparingShort'));
  f.model.runtimeTransfer({}); assert.equal(f.model.getSnapshot().barWidth, '0%'); assert.equal(f.model.getSnapshot().amount, t('transfer.requesting'));
});

test('main clock clamps, rounds up and handles unknown/negative values exactly', () => {
  assert.equal(api.transferClock(-1), '--:--'); assert.equal(api.transferClock(Infinity), '--:--');
  assert.equal(api.transferClock(.1), '00:01'); assert.equal(api.transferClock(60.1), '01:01'); assert.equal(api.transferClock(99999), '99:59');
  const normalized = api.transferPresentation({kind: 'unknown', mode: 'arbitrary', loaded: '7', files: ['a'], completed: 1});
  assert.equal(normalized.kind, undefined); assert.equal(normalized.mode, undefined); assert.equal(normalized.loaded, 7); assert.equal(normalized.completed, false);
});

test('main ordinary progress retains a prior OGG warning; complete clears it and hides after exactly 2200ms', () => {
  const f = fixture(); f.model.musicFailure(3); assert.equal(f.model.getSnapshot().warningText, t('transfer.oggFailed', {count: 3}));
  f.model.runtimeTransfer({mode: 'ogg', loaded: 1, total: 2}); assert.equal(f.model.getSnapshot().warningVisible, true); assert.equal(f.model.getSnapshot().retryVisible, true);
  f.model.musicComplete({loaded: 2, total: 2}); assert.equal(f.model.getSnapshot().title, t('transfer.musicComplete')); assert.equal(f.model.getSnapshot().warningVisible, false);
  f.advance(2199); assert.equal(f.model.getSnapshot().hidden, false); f.advance(1); assert.equal(f.model.getSnapshot().hidden, true);
});

test('main fresh progress cancels completion hide; music errors after launch are not presented as startup failures', () => {
  const f = fixture(); f.model.musicComplete({}); f.advance(2100); f.model.runtimeTransfer({mode: 'ogg', loaded: 1}); f.advance(1000);
  assert.equal(f.model.getSnapshot().hidden, false); f.state.launched = true; f.model.musicFailure(8); assert.equal(f.model.getSnapshot().warningVisible, false);
});

test('main network snapshots coalesce per animation frame and prefer latest receiving task over requesting task', () => {
  const f = fixture(), receiving = task(), requesting = task({id: 'two', phase: 'requesting', loaded: 0, total: 0, title: 'new request'});
  f.model.networkSnapshot(net([requesting])); f.model.networkSnapshot(net([receiving, requesting], MiB, 0));
  assert.equal(f.frameQueue.size, 1); assert.equal(f.model.getSnapshot().hidden, true); f.frame();
  const state = f.model.getSnapshot(); assert.equal(state.title, receiving.title); assert.equal(state.label, `${receiving.label}  +1`);
  assert.equal(state.amount, t('transfer.received', {amount: '1.0 MiB'})); assert.equal(state.barWidth, '33.3%'); assert.equal(state.indeterminate, false);
  assert.equal(state.networkOwned, true); assert.equal(state.networkActive, true); assert.equal(state.etaText, '00:02');
});

test('main aggregate network bytes use per-number MiB units; unknown request uses count ETA', () => {
  const f = fixture(); f.model.networkSnapshot(net([task(), task({id: 'two'})])); f.frame();
  assert.equal(f.model.getSnapshot().amount, '2.0 MiB / 6.0 MiB'); assert.equal(f.model.getSnapshot().barWidth, '33.3%');
  f.model.networkSnapshot(net([task({phase: 'requesting', loaded: 0, total: 0})])); f.frame();
  assert.equal(f.model.getSnapshot().etaText, t('transfer.requestCount', {count: 1})); assert.equal(f.model.getSnapshot().speedText, t('transfer.waiting'));
});

test('main hide yields to active network; empty network hides only its own panel, never a newer native transfer', () => {
  const f = fixture(); f.model.networkSnapshot(net([task()])); f.frame(); f.model.musicComplete({loaded: 1, total: 1});
  f.advance(2200); assert.equal(f.model.getSnapshot().hidden, false); assert.equal(f.model.getSnapshot().networkOwned, true);
  f.model.networkSnapshot(net([])); f.frame(); assert.equal(f.model.getSnapshot().hidden, true);
  f.model.networkSnapshot(net([task()])); f.frame(); f.model.runtimeTransfer({kind: 'game', phase: 'preparing'});
  f.model.networkSnapshot(net([])); f.frame(); assert.equal(f.model.getSnapshot().hidden, false); assert.equal(f.model.getSnapshot().networkOwned, false);
  assert.equal(f.model.getSnapshot().indeterminate, false, 'empty network clears the original shared bar class');
});

test('main local startup progress is not marked ready until launch ACK; remaining completion then uses the same 2200ms hide', () => {
  const f = fixture(), initial = {epoch: 1, game: 'th06', generationId: 'g1', phase: 'initial', loaded: 6, total: 6, completed: 2, files: 2, speed: 3};
  f.model.localProgress(initial); assert.equal(f.model.getSnapshot().title, t('transfer.musicPreparing')); assert.equal(f.pending.size, 0);
  f.state.launched = true; f.model.launchAcknowledged(); assert.equal(f.model.getSnapshot().title, t('transfer.musicReady')); f.advance(2200); assert.equal(f.model.getSnapshot().hidden, true);
  const remainder = fixture();
  remainder.model.localProgress({...initial, total: 12, files: 4}); remainder.state.launched = true; remainder.model.launchAcknowledged();
  assert.equal(remainder.model.getSnapshot().title, t('transfer.musicPreparing')); assert.equal(remainder.pending.size, 0);
  remainder.model.localProgress({...initial, phase: 'remaining', loaded: 9, total: 12, completed: 3, files: 4}); assert.equal(remainder.model.getSnapshot().title, t('transfer.musicPreparing'));
  remainder.model.localProgress({...initial, phase: 'remaining', loaded: 12, total: 12, completed: 4, files: 4}); assert.equal(remainder.model.getSnapshot().title, t('transfer.musicReady'));
  remainder.advance(2200); assert.equal(remainder.model.getSnapshot().hidden, true);
  const before = remainder.model.getSnapshot(); remainder.model.localProgress({...initial, epoch: 2}); assert.equal(remainder.model.getSnapshot(), before);
});

test('main local partial failure hides transfer and emits only the original toast', () => {
  const f = fixture(); f.model.runtimeTransfer({mode: 'ogg'}); f.model.localFailure(new Error('damaged object'));
  assert.equal(f.model.getSnapshot().hidden, true); assert.deepEqual(f.toasts, [t('transfer.localOggPartialFailed', {reason: 'damaged object'})]); assert.deepEqual(f.statuses, []);
});

test('main retry uses real 30-minute command port; rejection restores OGG failure and player status', async () => {
  const request = deferred(), f = fixture({retry: () => request.promise}); f.model.musicFailure();
  const retry = f.model.retry(); assert.equal(f.model.getSnapshot().retryVisible, false); assert.equal(f.model.getSnapshot().warningText, t('transfer.retryingOgg'));
  assert.deepEqual(f.retryTimeouts, [30 * 60 * 1000]); request.reject(new Error('retry failed')); await retry;
  assert.equal(f.model.getSnapshot().retryVisible, true); assert.deepEqual(f.statuses, ['retry failed']);
});

test('retired retry cannot change a new Runtime; cancel delegates only the current visible operation', async () => {
  const request = deferred(); let cancelled = 0; const f = fixture({retry: () => request.promise, cancel: async () => {cancelled++;}});
  const retry = f.model.retry(); f.state.epoch = 2; request.reject(new Error('retired')); await retry; assert.deepEqual(f.statuses, []);
  await f.model.cancel(); assert.equal(cancelled, 0); f.model.setCancellation('original operation label'); assert.equal(f.model.getSnapshot().cancelLabel, 'original operation label');
  await f.model.cancel(); assert.equal(cancelled, 1); assert.equal(f.model.getSnapshot().cancelVisible, false);
});

test('main MIDI fallback notice restarts after one frame and lasts 2000ms', () => {
  const f = fixture(); f.model.midiFallback(); assert.equal(f.model.getSnapshot().midiNoticeVisible, false); f.frame();
  assert.equal(f.model.getSnapshot().midiNoticeVisible, true); f.advance(1999); f.model.midiFallback(); f.frame(); f.advance(1);
  assert.equal(f.model.getSnapshot().midiNoticeVisible, true); assert.equal(f.model.getSnapshot().midiNoticeRevision, 2); f.advance(1999); assert.equal(f.model.getSnapshot().midiNoticeVisible, false);
});

test('main iOS debug block stays gated and hide clears its exact lines', () => {
  const f = fixture(), value = {debug: {note: 'test', stage: 'DATA', loadSeen: true, hostReadySeen: false, lastError: 'fixture'}};
  f.model.playerDebug(value); assert.equal(f.model.getSnapshot().debugVisible, false); f.state.iosWebKitTouch = true; f.model.playerDebug(value);
  assert.equal(f.model.getSnapshot().debugText, 'EAGLER-RUNTIME/1 debug\nnote=test\nstage=DATA\nnav=\nload=yes hostReady=no\nreadyState=- document=no\nmount=-\niframe=-\nhref=-\nerror=fixture');
  f.model.hide(); assert.equal(f.model.getSnapshot().debugText, ''); assert.equal(f.model.getSnapshot().debugVisible, false);
});

test('authenticated Runtime ready hides game DATA only; other event kinds retain original owners', () => {
  const f = fixture(); f.model.runtimeTransfer({kind: 'game'}); f.model.runtimeEvent({epoch: 2, event: 'ready'}); assert.equal(f.model.getSnapshot().hidden, false);
  f.model.runtimeEvent({epoch: 1, event: 'ready'}); assert.equal(f.model.getSnapshot().hidden, true);
  f.model.runtimeTransfer({kind: 'music', mode: 'ogg'}); f.model.runtimeEvent({epoch: 1, event: 'ready'}); assert.equal(f.model.getSnapshot().hidden, false);
});

test('main 3390: DATA timeout reveals transfer without replacing its byte metrics', () => {
  const f = fixture(); f.model.runtimeTransfer({kind: 'game', loaded: MiB, total: 2 * MiB, speed: 1024}); f.model.hide();
  const before = f.model.getSnapshot(); f.model.revealGameData(); const after = f.model.getSnapshot();
  assert.equal(after.hidden, false); assert.equal(after.kind, 'game');
  for (const key of ['title', 'label', 'amount', 'barWidth', 'speedText', 'etaText']) assert.equal(after[key], before[key]);
});

test('main code/DATA preparing labels remain distinct for local-managed and direct-preload identity', () => {
  const f = fixture(); f.model.beginRuntime({game: 'th06', generation: {id: 'installed'}});
  assert.equal(f.model.getSnapshot().title, t('runtime.preparingLocal')); assert.equal(f.model.getSnapshot().label, t('runtime.localGameLabel', {game: 'TH06'}));
  f.model.beginRuntime({game: 'th06', generation: null}); assert.equal(f.model.getSnapshot().title, t('runtime.requestingComponent'));
  assert.deepEqual(f.statuses, [t('runtime.preparingLocal'), t('runtime.loadingGameData')]);
});

test('actual language service emits explicit original label/bytes/completion and failed-download presentation', async () => {
  const path = 'thcrap/th06/localization/strings.etl', payload = strToU8('ETL1');
  const manifest = {schema: 'eagler-touhou/thcrap-static-pack/1', game: 'th06', language: 'lang_en', runtimeVersion: 'test', files: [{path: `/${path}`, bytes: payload.length}]};
  const zip = zipSync({'manifest.json': strToU8(JSON.stringify(manifest)), [path]: payload}, {level: 0});
  const hash = createHash('sha256').update(zip).digest('hex'), entry = {id: 'lang_en', title: 'English', pack: {url: 'en.zip', sha256: hash, bytes: zip.length}};
  const f = fixture(); f.model.musicFailure();
  await api.prepareLanguagePack({game: 'th06', entry, baseUrl: 'https://launcher.invalid/', translate: t,
    fetchImpl: async () => new Response(zip), onProgress: f.model.preparationProgress});
  assert.equal(f.model.getSnapshot().title, t('language.downloadComplete')); assert.equal(f.model.getSnapshot().label, 'English');
  assert.deepEqual(f.statuses, [], 'language transfer progress does not replace the original Player status');
  assert.equal(f.model.getSnapshot().barWidth, '100.0%'); assert.equal(f.model.getSnapshot().warningVisible, false); assert.equal(f.model.getSnapshot().retryVisible, false);
  f.advance(2200); assert.equal(f.model.getSnapshot().hidden, true);
  await assert.rejects(api.prepareLanguagePack({game: 'th06', entry, baseUrl: 'https://launcher.invalid/', translate: t,
    fetchImpl: async () => ({ok: false, status: 404}), onProgress: f.model.preparationProgress}), /HTTP 404/);
  assert.equal(f.model.getSnapshot().title, t('transfer.languageFailed')); assert.equal(f.model.getSnapshot().warningText, t('transfer.languageFailedDetail', {reason: '/en.zip: HTTP 404'}));
  assert.equal(f.model.getSnapshot().retryVisible, false);
  assert.deepEqual(f.statuses, [], 'language download failure presentation belongs to transfer/fallback owners');
});

test('main 1372: Package network copy retains every original file-kind label in both locales', () => {
  for (const locale of ['zh-CN', 'en']) {
    const tr = (key, params) => api.translate(locale, key, params), game = 'TH06';
    for (const [file, title, label, kind] of [
      ['th06.package.json', tr('transfer.fetchingGameInfo'), tr('transfer.versionDescriptor', {game}), 'descriptor'],
      ['th06.data', tr('transfer.gameDownloading'), 'TH06 th06.data', 'game'],
      ['game.wasm', tr('transfer.runtimeDownloading'), 'TH06 WebAssembly', 'runtime'],
      ['game.js', tr('transfer.runtimeDownloading'), tr('transfer.runtimeScript', {game}), 'runtime'],
      ['game.html', tr('transfer.runtimeDownloading'), tr('transfer.runtimePage', {game}), 'runtime'],
      ['track%20one.ogg', tr('transfer.musicDownloading'), 'track one.ogg', 'music'],
      ['font.ttc', tr('transfer.resourceDownloading'), tr('transfer.font', {file: 'font.ttc'}), 'font'],
      ['font.otf', tr('transfer.resourceDownloading'), tr('transfer.font', {file: 'font.otf'}), 'font'],
      ['font.woff2', tr('transfer.resourceDownloading'), tr('transfer.font', {file: 'font.woff2'}), 'font'],
      ['pack.zip', tr('transfer.packageDownloading'), 'pack.zip', 'package'],
      ['resources.json', tr('transfer.serverRequesting'), 'TH06 resources.json', 'network'],
    ]) assert.deepEqual(api.packageNetworkMetadata('th06', file, 'https://launcher.invalid/', tr), {title, label, kind});
    assert.deepEqual(api.packageNetworkMetadata('th06', new Request('https://launcher.invalid/game.wasm'), 'https://launcher.invalid/', tr),
      api.packageNetworkMetadata('th06', new URL('https://launcher.invalid/game.wasm'), 'https://launcher.invalid/', tr));
  }
});

test('main Package foreground uses XHR metadata while background updates stay outside the visible tracker', async () => {
  const foregroundCalls = [], rawCalls = [];
  const adapter = api.createPreparationNetwork({baseUrl: 'https://launcher.invalid/', translate: t, xhrFactory: null,
    foreground: {xhrFetch: async (...args) => {foregroundCalls.push(args); return new Response('foreground');},
      begin() {throw new Error('Unexpected foreground task');}, update() {}, finish() {}},
    fetchImpl: async (input, init) => {rawCalls.push({input, init}); return new Response('background');}});
  const signal = new AbortController().signal;
  assert.equal(await (await adapter.packageFetch('th06')('https://launcher.invalid/game.data', {signal})).text(), 'foreground');
  assert.equal(foregroundCalls[0][1].signal, signal);
  assert.deepEqual(foregroundCalls[0][2], {title: t('transfer.gameDownloading'), label: 'TH06 game.data', kind: 'game'});
  assert.equal(await (await adapter.backgroundFetch('https://launcher.invalid/update.package.json')).text(), 'background');
  assert.equal(foregroundCalls.length, 1); assert.equal(rawCalls.length, 1);
});

test('main language cancellation/task lifetime brackets only downloads, closes on every outcome, and leaves cached/local reads inert', async () => {
  const path = 'thcrap/th06/localization/strings.etl', payload = strToU8('ETL1');
  const manifest = {schema: 'eagler-touhou/thcrap-static-pack/1', game: 'th06', language: 'lang_en', runtimeVersion: 'test', files: [{path: `/${path}`, bytes: payload.length}]};
  const zip = zipSync({'manifest.json': strToU8(JSON.stringify(manifest)), [path]: payload}, {level: 0});
  const hash = createHash('sha256').update(zip).digest('hex'), remote = {id: 'lang_en', title: 'English', pack: {url: 'en.zip', sha256: hash, bytes: zip.length}};
  for (const mode of ['success', 'failure', 'cancel', 'cached', 'local']) {
    const activity = [], snapshots = [], controller = new AbortController();
    const foreground = api.createNetworkActivityTracker({fetchImpl: async () => {throw new Error('Language must own its native stream');}, onChange: value => snapshots.push(value)});
    const network = api.createPreparationNetwork({foreground, baseUrl: 'https://launcher.invalid/', translate: t,
      fetchImpl: async () => {throw new Error('No background fetch in language fixture');}, xhrFactory: null});
    const pending = api.prepareLanguagePack({game: 'th06', entry: mode === 'local' ? {...remote, packageObjectId: 'fixture-local'} : remote,
      baseUrl: 'https://launcher.invalid/', translate: t, signal: controller.signal, network,
      dependencies: {readObject: async () => ({data: Uint8Array.from(zip).buffer})},
      caches: mode === 'cached' ? {open: async () => ({match: async () => new Response(zip), put: async () => {}})} : null,
      onLanguageDownloadActivity: value => activity.push(value), fetchImpl: async () => {
        activity.push('fetch');
        if (mode === 'failure') return new Response('', {status: 404});
        if (mode === 'cancel') {controller.abort(); throw new DOMException('Cancelled', 'AbortError');}
        return new Response(zip);
      }});
    if (mode === 'failure') await assert.rejects(pending, /HTTP 404/);
    else if (mode === 'cancel') await assert.rejects(pending, {name: 'AbortError'});
    else assert.ok((await pending).files.length);
    if (mode === 'local' || mode === 'cached') {assert.deepEqual(activity, []); assert.deepEqual(snapshots, []);}
    else {
      assert.deepEqual(activity, [true, 'fetch', false]); assert.equal(snapshots.at(-1).count, 0);
      const request = snapshots[0].active[0]; assert.equal(request.title, t('language.downloading'));
      assert.equal(request.label, t('language.requesting', {language: 'English'})); assert.equal(request.kind, 'language');
      if (mode === 'success') assert.ok(snapshots.some(value => value.active[0]?.loaded === zip.length && value.active[0].label === 'English'));
    }
  }
});

test('dispose clears pending frames and timers, and late completion does not rearm them', () => {
  const f = fixture(); f.model.musicComplete({}); f.model.midiFallback(); f.model.networkSnapshot(net([task()])); f.model.dispose();
  f.model.musicComplete({}); f.model.midiFallback(); f.model.launchAcknowledged(); f.model.beginRuntime({game: 'th06', generation: null});
  assert.equal(f.pending.size, 0); assert.equal(f.frameQueue.size, 0); assert.deepEqual(f.statuses, []);
});
