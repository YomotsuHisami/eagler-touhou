import {authoredSourcesPlugin} from './authored-sources.mjs';
/** SYNTHETIC Runtime service boundary. No browser, engine, save durability or
 * first rendered pixel claim. Main app:4241–4289,5948–5983 and unchanged
 * runtime-session/generation-lease/preparation tests supply the expectations.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://launcher.invalid', baseUrl = `${origin}/deploy/`;
let work, owners; const fixtures = [];
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-runtime-'));
  const outfile = resolve(work, 'actual-service.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createRuntimeService} from './app/services/runtime.ts';
    export {readManagedRuntimeData} from './src/launcher/runtime-preparation.mts';
    export {RUNTIME_EPOCH_QUERY_PARAMETER} from './src/contracts/runtime-protocol.mts';
    export {PRODUCT_GAMES} from './src/contracts/product-catalog.mts';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  }); owners = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {for (const fixture of fixtures.splice(0)) {await fixture.service.close({discardUnsaved: true}); fixture.service.dispose(); assert.equal(fixture.timers.pending.size, 0);}});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};
function deterministicTimers() {
  let now = 0, serial = 0; const pending = new Map();
  const add = (callback, ms, interval = false) => {const id = ++serial; pending.set(id, {callback, at: now + ms, ms, interval}); return id;};
  return {pending, setTimeout: (fn, ms) => add(fn, ms), clearTimeout: id => pending.delete(id),
    setInterval: (fn, ms) => add(fn, ms, true), clearInterval: id => pending.delete(id),
    advance(ms) {const target = now + ms; while (true) {
      const next = [...pending.entries()].filter(([,item]) => item.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break; const [id,item] = next; now = item.at; pending.delete(id);
      if (item.interval) pending.set(id, {...item, at: now + item.ms}); item.callback();
    } now = target;},
  };
}
const hash = 'a'.repeat(64);
function directPlan(game = 'th06', options = {}) {
  const entry = `runtime/${game}/${game}.html`;
  const gameInfo = {runtime: entry, gameData: {path: owners.PRODUCT_GAMES[game].package.dataTarget.slice(1), bytes: 1, sha256: hash,
    version: `sha256-${hash}`, layout: `sha256-${'b'.repeat(64)}`}, music: {midi: {files: []}}};
  return {game, runtimeVariant: 'normal', generation: null, entry, publishedRuntime: false,
    directPreloadHost: {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-validation-test',
      shared: {resourceMode: 'hosted', vanillaFont: 'msgothic.ttc', unicodeFont: 'unifont.otf'}, games: {[game]: gameInfo}},
    configure: {music: 'none', options}};
}
function managedPlan(game = 'th10', options = {}) {
  return {game, runtimeVariant: 'normal', entry: `runtime/${game}/${game}.html`, publishedRuntime: true,
    generation: {id: `installed-${game}`, game, descriptor: {schema: 'eagler-touhou/package/1', game, revision: 'package-r1',
      runtimeRequirement: {protocol: 'eagler-touhou/1', target: game, dataFile: 'data'},
      files: {data: {source: `${game}.data`, target: `/${game}.data`, revision: 'data-r1', bytes: 3}},
      base: {files: ['data']}, components: {}}, files: {data: {objectId: `obj-${game}-data`, revision: 'data-r1'}}},
    configure: {music: 'none', options}};
}
function fixture(overrides = {}) {
  const messageListeners = new Set(), loadListeners = new Set(), eventContexts = [], outbound = [], navigations = [], retained = [], released = [], codeCalls = [], dataReads = [];
  const timers = deterministicTimers();
  const host = {location: {origin, href: `${baseUrl}?game=th06`},
    addEventListener(type, listener) {assert.equal(type, 'message'); messageListeners.add(listener);},
    removeEventListener(_type, listener) {messageListeners.delete(listener);}};
  const runtime = {document: {}, location: {href: 'about:blank', replace(href) {navigations.push(href); runtime.location.href = href; runtime.document = {};}},
    postMessage(data, target) {assert.equal(target, origin); outbound.push(data);},
    addEventListener() {}, removeEventListener() {}};
  const frame = {contentWindow: runtime, isConnected: true,
    addEventListener(type, listener) {assert.equal(type, 'load'); loadListeners.add(listener);}, removeEventListener(_type, listener) {loadListeners.delete(listener);}};
  const service = owners.createRuntimeService({translate: key => key, frame, hostWindow: host, baseUrl, timers,
    fetchImpl: async () => {throw new Error('Unexpected network in deterministic service fixture');},
    onEvent: (message, context) => eventContexts.push({message, context, snapshot: service.getSnapshot()}),
    dependencies: {
      async prepareCode(entry, options) {codeCalls.push({entry, options}); return {url: `${baseUrl}__runtime/test-generation/entry.html`, generation: 'code-r1'};},
      async readData(generation) {dataReads.push(generation); return owners.readManagedRuntimeData(generation, {readObject: async id => {
        assert.equal(id, generation.files.data.objectId); return {data: new Uint8Array([1,2,3]).buffer};
      }});},
      async readResource() {throw new Error('Unexpected resource in lifecycle fixture');},
      async retainGeneration(game, generation, options) {retained.push({game, generation, options});},
      async releaseGeneration(id) {released.push(id);}, ...overrides,
    }});
  const emit = (data, envelope = {}) => {for (const listener of messageListeners) listener({origin, source: runtime, data, ...envelope});};
  const event = (type, extra = {}, envelope = {}) => emit({protocol: 'eagler-touhou/1', game: service.getSnapshot().game,
    epoch: service.getSnapshot().epoch, event: type, ...extra}, envelope);
  const ack = (command, extra = {}) => {const message = [...outbound].reverse().find(item => item.command === command && item.request); assert.ok(message, `actual ${command} request exists`);
    emit({protocol: message.protocol, game: message.game, epoch: message.epoch, request: message.request, ok: true, ...extra}); return message;};
  async function prepare(plan) {
    const pending = service.prepare(plan); await flush(); assert.equal(service.getSnapshot().phase, 'loading');
    event('ready'); await flush(); assert.equal(service.getSnapshot().phase, 'configuring'); ack('configure'); await pending;
    assert.equal(service.getSnapshot().phase, 'prepared');
  }
  const result = {service, host, frame, runtime, timers, eventContexts, outbound, navigations, retained, released, codeCalls, dataReads, emit, event, ack, prepare, loadListeners};
  fixtures.push(result); return result;
}

test('runtime: validated direct preload uses original asset URL, one frame and ACK-based ordinary launch', async () => {
  const f = fixture(), frame = f.frame; assert.equal(f.service.getSnapshot().fileOnly, false); const plan = directPlan(); await f.prepare(plan);
  assert.equal(f.service.getSnapshot().fileOnly, false, 'ordinary prepare does not inherit a file-only role');
  const source = new URL(f.service.getSnapshot().source);
  assert.equal(source.pathname, '/deploy/runtime/th06/th06.html'); assert.equal(source.searchParams.get('asset'), `sha256-${hash}`);
  assert.equal(source.searchParams.get('runtimeVariant'), 'normal'); assert.equal(source.searchParams.has('managedData'), false);
  assert.equal(f.codeCalls.length, 0); assert.equal(f.retained.length, 0);
  let resolved = false; const launch = f.service.launch().then(value => {resolved = true; return value;}); await flush();
  assert.equal(resolved, false); f.ack('launch'); const running = await launch;
  assert.equal(running.launched, true); assert.equal(running.firstFrame, false); assert.equal(running.phase, 'running');
  f.timers.advance(11999); assert.equal(f.service.getSnapshot().firstFrameTimedOut, false);
  f.timers.advance(1); assert.equal(f.service.getSnapshot().firstFrameTimedOut, true); assert.equal(f.service.getSnapshot().phase, 'running');
  assert.equal(f.service.getSnapshot().error, null); assert.equal(f.frame, frame);
  f.event('first-frame'); assert.equal(f.service.getSnapshot().firstFrame, true); assert.equal(f.service.getSnapshot().firstFrameTimedOut, false);
  const closing = f.service.close(); await flush(); f.ack('sync'); assert.equal(await closing, true);
  assert.equal(f.navigations.at(-1), 'about:blank'); assert.equal(f.frame, frame);
});

test('runtime: optional first-frame wait remains pending after ACK; 14-second failure keeps acknowledged runtime alive', async () => {
  const f = fixture(); await f.prepare(directPlan());
  let settled = false; const launch = f.service.launch({awaitFirstFrame: true}).finally(() => {settled = true;});
  const rejected = assert.rejects(launch, /runtime\.firstFrameLate/); f.ack('launch'); await flush();
  assert.equal(settled, false); assert.equal(f.service.getSnapshot().launched, true);
  f.timers.advance(13999); await flush(); assert.equal(settled, false);
  f.timers.advance(1); await rejected;
  assert.equal(f.service.getSnapshot().phase, 'running'); assert.equal(f.service.getSnapshot().ready, true);
  assert.equal(f.service.getSnapshot().source, f.navigations[0]);
});

test('runtime: optional first-frame event settles the actual waiter without advancing a timer', async () => {
  const f = fixture(); await f.prepare(directPlan()); const launch = f.service.launch({awaitFirstFrame: true});
  f.ack('launch'); await flush(); f.event('first-frame'); const snapshot = await launch;
  assert.equal(snapshot.firstFrame, true); assert.equal(snapshot.phase, 'running');
});

test('runtime: directory wait is 122 seconds while post-ACK diagnostic is nonfatal at 12 seconds', async () => {
  const f = fixture(); await f.prepare(managedPlan('th10'));
  let settled = false; const launch = f.service.launch({awaitFirstFrame: true}).finally(() => {settled = true;});
  const rejected = assert.rejects(launch, /runtime\.firstFrameLate/); f.ack('launch'); await flush();
  f.timers.advance(12000); await flush(); assert.equal(f.service.getSnapshot().firstFrameTimedOut, true); assert.equal(settled, false);
  f.timers.advance(109999); await flush(); assert.equal(settled, false);
  f.timers.advance(1); await rejected; assert.equal(f.service.getSnapshot().phase, 'running');
});

test('runtime: networked launch has no local first-frame diagnostic watchdog', async () => {
  const f = fixture(); await f.prepare(managedPlan('th06', {netplayMode: 'lan'}));
  const launch = f.service.launch(); f.ack('launch'); await launch;
  f.timers.advance(122001); await flush();
  assert.equal(f.service.getSnapshot().firstFrameTimedOut, false); assert.equal(f.service.getSnapshot().firstFrame, false);
  assert.equal(f.service.getSnapshot().phase, 'running');
});

test('runtime: no-generation path requires exact hosted preload authority and cannot claim managed resources', async () => {
  const f = fixture();
  await assert.rejects(f.service.prepare({...directPlan(), directPreloadHost: undefined}), /validated Host authority/);
  await assert.rejects(f.service.prepare(directPlan('th15')), /does not authorize this preload Runtime/);
  await assert.rejects(f.service.prepare({...directPlan(), entry: 'runtime/other.html'}), /Invalid direct preload Runtime source/);
  await assert.rejects(f.service.prepare({...directPlan(), resourceFileIds: ['data']}), /cannot claim managed Package resources/);
  await assert.rejects(f.service.prepare({...managedPlan(), publishedRuntime: false}), /Host authority/);
  assert.equal(f.navigations.length, 0); assert.equal(f.retained.length, 0);
});

test('runtime: managed code and DATA stay separately leased and bound to exact generation/epoch', async () => {
  const f = fixture(), plan = managedPlan('th06'); await f.prepare(plan);
  assert.equal(f.codeCalls.length, 1); assert.equal(f.codeCalls[0].entry, `${baseUrl}runtime/th06/th06.html`);
  assert.equal(f.retained.length, 1); assert.equal(f.retained[0].generation, plan.generation.id);
  const source = new URL(f.service.getSnapshot().source), epoch = f.service.getSnapshot().epoch;
  assert.equal(source.pathname, '/deploy/__runtime/test-generation/entry.html'); assert.equal(source.searchParams.get('managedData'), '1');
  assert.equal(source.searchParams.get('gameGeneration'), plan.generation.id); assert.equal(source.searchParams.get(owners.RUNTIME_EPOCH_QUERY_PARAMETER), String(epoch));
  const provide = f.host.__eaglerPrepareManagedRuntimeDataV1;
  await assert.rejects(provide({game: 'th07', generation: plan.generation.id, epoch}), /inactive game generation/);
  await assert.rejects(provide({game: plan.game, generation: 'other', epoch}), /inactive game generation/);
  await assert.rejects(provide({game: plan.game, generation: plan.generation.id, epoch: epoch + 1}), {name: 'AbortError'});
  const data = await provide({game: plan.game, generation: plan.generation.id, epoch}); assert.deepEqual([...new Uint8Array(data.buffer)], [1,2,3]);
  assert.equal(f.dataReads.length, 1); await f.service.close({discardUnsaved: true});
  assert.equal(f.released.length, 1); await assert.rejects(provide({game: plan.game, generation: plan.generation.id, epoch}), {name: 'AbortError'});
});

test('runtime: stale epoch, foreign source and foreign origin cannot settle current commands', async () => {
  const f = fixture(); await f.prepare(directPlan()); const oldEpoch = f.service.getSnapshot().epoch;
  await f.service.close({discardUnsaved: true}); await f.prepare(directPlan()); assert.notEqual(f.service.getSnapshot().epoch, oldEpoch);
  let settled = false; const launch = f.service.launch().then(value => {settled = true; return value;});
  const command = f.outbound.at(-1), data = {protocol: command.protocol, game: command.game, epoch: command.epoch, request: command.request, ok: true};
  f.emit({...data, epoch: oldEpoch}); f.emit(data, {origin: 'https://foreign.invalid'}); f.emit(data, {source: {}}); await flush();
  assert.equal(settled, false); f.ack('launch'); await launch; assert.equal(settled, true);
});

test('runtime: cancellation fences pending DATA from the successor even with one stable iframe', async () => {
  let resolveData; const f = fixture({readData: () => new Promise(resolve => {resolveData = resolve;})});
  await f.prepare(managedPlan('th06')); const epoch = f.service.getSnapshot().epoch, provider = f.host.__eaglerPrepareManagedRuntimeDataV1;
  const oldRead = provider({game: 'th06', generation: 'installed-th06', epoch}); const rejected = assert.rejects(oldRead, {name: 'AbortError'});
  await f.service.close({discardUnsaved: true}); await f.prepare(directPlan()); const successor = f.service.getSnapshot();
  resolveData({buffer: new Uint8Array([9]).buffer, bytes: 1, fileId: 'data'}); await rejected;
  assert.equal(f.service.getSnapshot(), successor); assert.equal(f.service.getSnapshot().phase, 'prepared');
});

test('runtime: replacement document cannot authenticate a ready session or receive stale work', async () => {
  const f = fixture(); await f.prepare(directPlan()); const pending = f.service.send('read', {path: 'score.dat'});
  // Session invalidation rejects pending work with AbortError; the separate
  // terminal snapshot, asserted below, carries the loss diagnostic.
  const rejected = assert.rejects(pending, {name: 'AbortError'}); f.runtime.document = {};
  f.ack('read', {bytes: [1]}); await rejected;
  assert.equal(f.service.getSnapshot().saveUnavailable, true); assert.equal(f.service.getSnapshot().phase, 'error');
  assert.match(f.service.getSnapshot().saveError, /unsaved progress may be lost/); assert.equal(f.navigations.at(-1), 'about:blank');
});


for (const authority of ['catalog', 'host']) test(`runtime: main live ${authority} entry keeps managed DATA without requiring unpublished code manifest`, async () => {
  // Main app5639–5655 chooses immutable code only when Host declares that
  // capability; installed packages may use unchanged catalog or Host URLs.
  const f = fixture(), plan = managedPlan('th06'); plan.publishedRuntime = false;
  if (authority === 'catalog') {plan.localCatalogRuntime = true; plan.entry = owners.PRODUCT_GAMES.th06.runtime;}
  else plan.runtimeHost = directPlan().directPreloadHost;
  await assert.rejects(f.service.prepare({...plan, entry: 'runtime/unapproved.html'}), /Host authority/);
  assert.equal(f.navigations.length, 0); await f.prepare(plan);
  const source = new URL(f.service.getSnapshot().source);
  assert.equal(source.pathname, new URL(plan.entry, baseUrl).pathname); assert.equal(source.searchParams.get('managedData'), '1');
  assert.equal(source.searchParams.get('gameGeneration'), plan.generation.id); assert.equal(f.codeCalls.length, 0);
  assert.equal(f.retained.length, 1); assert.equal(f.service.getSnapshot().ready, true);
});

test('runtime: file-only readiness skips configure/resources and cannot launch gameplay', async () => {
  // Main ensureRuntime(false) is a filesystem carrier, not startGame's
  // configure/language/music pipeline. No native game claim is made here.
  const f = fixture(), plan = {...managedPlan('th06'), fileOnly: true};
  const prepared = f.service.prepare(plan);
  assert.equal(f.service.getSnapshot().fileOnly, true, 'file-only role is derived at synchronous token allocation');
  await flush(); f.event('ready'); await prepared;
  assert.equal(f.service.getSnapshot().fileOnly, true);
  assert.equal(f.service.getSnapshot().phase, 'prepared'); assert.equal(f.outbound.some(item => item.command === 'configure'), false);
  await assert.rejects(f.service.launch(), /Prepare the Runtime before launch/);
  const read = f.service.withFileSession('th06', async access => {
    const value = await access.send('read', {path: 'score.dat'}); await access.retire(); return value.bytes;
  });
  await flush(); f.ack('read', {bytes: [4,5,6]}); assert.deepEqual(await read, [4,5,6]);
  assert.equal(f.service.getSnapshot().phase, 'idle'); assert.equal(f.navigations.at(-1), 'about:blank');
  assert.equal(f.service.getSnapshot().fileOnly, false, 'retirement resets the derived role');
  await f.prepare(directPlan()); assert.equal(f.service.getSnapshot().fileOnly, false);
});

test('runtime: optional network first-frame wait lasts 122 seconds without a local diagnostic', async () => {
  const f = fixture(); await f.prepare(managedPlan('th06', {netplayMode: 'lan'}));
  let settled = false; const launch = f.service.launch({awaitFirstFrame: true}).finally(() => {settled = true;});
  const rejected = assert.rejects(launch, /runtime\.firstFrameLate/); f.ack('launch'); await flush();
  f.timers.advance(121999); await flush(); assert.equal(settled, false); assert.equal(f.service.getSnapshot().firstFrameTimedOut, false);
  f.timers.advance(1); await rejected; assert.equal(f.service.getSnapshot().phase, 'running');
  assert.equal(f.service.getSnapshot().firstFrameTimedOut, false);
});

test('runtime: main nonterminal error preserves live save RPC and native writer', async () => {
  const f = fixture(); await f.prepare(directPlan());
  const launching = f.service.launch(); f.ack('launch'); await launching;
  const before = f.service.getSnapshot();
  const syncing = f.service.sync();
  f.event('error', {error: 'original diagnostic'});
  assert.equal(f.service.getSnapshot().phase, 'running');
  assert.equal(f.service.getSnapshot().epoch, before.epoch);
  assert.equal(f.service.getSnapshot().launched, true);
  assert.equal(f.service.getSnapshot().error, 'original diagnostic');
  f.ack('sync'); await syncing;
  assert.equal(f.service.getSnapshot().saveUnavailable, false);
});

test('runtime: main runtime-error still rejects the optional first-frame waiter', async () => {
  const f = fixture(); await f.prepare(directPlan());
  const launching = f.service.launch({awaitFirstFrame: true});
  const rejected = assert.rejects(launching, /first-frame diagnostic/);
  f.ack('launch'); await flush(); f.event('error', {error: 'first-frame diagnostic'});
  await rejected;
  assert.equal(f.service.getSnapshot().launched, true);
  assert.equal(f.service.getSnapshot().phase, 'running');
});

// Main app5389–5403/5538–5608: these are catalog messages, not new service prose.
test('runtime: original readiness, RPC timeout and response fallback keys remain authoritative', async () => {
  const f = fixture();
  await assert.rejects(f.service.sync(), {message: 'runtime.notReady'});
  const preparing = f.service.prepare(directPlan());
  const readyFailure = assert.rejects(preparing, {message: 'runtime.gameLoadTimeout'});
  await flush(); f.timers.advance(120000); await readyFailure;
  await f.prepare(directPlan());
  const syncing = f.service.sync(), timeout = assert.rejects(syncing, {message: 'runtime.operationTimeout'});
  f.timers.advance(10000); await timeout;
  const retry = f.service.sync(), failed = assert.rejects(retry, {message: 'runtime.operationFailed'});
  f.ack('sync', {ok: false}); await failed;
});

test('runtime: native file lock is acquired before its deferred callback and blocks same-tick launch', async () => {
  const f = fixture(); await f.prepare(directPlan());
  const epoch = f.service.getSnapshot().epoch;
  let entered = false;
  const files = f.service.withFileSession('th06', async access => {entered = true; return access.send('list', {});});
  assert.equal(entered, false); assert.equal(f.service.getSnapshot().fileOperationBusy, true);
  await assert.rejects(f.service.launch(), /Prepare the Runtime before launch/);
  await assert.rejects(f.service.prepare(directPlan('th07')), /Close the current Runtime before preparing another/);
  await flush(); assert.equal(entered, true); assert.equal(f.service.getSnapshot().epoch, epoch);
  const listing = f.ack('list', {files: []}); assert.equal(listing.epoch, epoch); await files;
  assert.equal(f.service.getSnapshot().fileOperationBusy, false);
});
test('runtime: terminal invalidation before a deferred file callback cannot grant it a replacement epoch', async () => {
  const f = fixture(); await f.prepare(directPlan());
  let entered = false;
  const files = f.service.withFileSession('th06', async access => {entered = true; return access.send('write', {path: 'replay/th6_01.rpy', bytes: [1]});});
  const rejected = assert.rejects(files, {name: 'AbortError', message: 'EAGLER_RUNTIME_SESSION_SUPERSEDED'});
  f.event('exit', {status: 'success'});
  await rejected; assert.equal(entered, false); assert.equal(f.outbound.some(message => message.command === 'write'), false);
  await f.service.close({discardUnsaved: true});
  await f.prepare(directPlan('th07'));
  assert.equal(f.service.getSnapshot().game, 'th07'); assert.equal(entered, false);
});

for (const outcome of ['ready', 'failure']) test(`runtime: published file preparation retries retain canonical epoch ownership through ${outcome}`, async () => {
  const f = fixture(), preparing = f.service.prepare({...managedPlan('th06'), fileOnly: true});
  const firstEpoch = f.service.getSnapshot().epoch;
  const rejected = outcome === 'failure' ? assert.rejects(preparing, /failed retry 3/) : null;
  await flush(); f.event('error', {error: 'failed retry 1'}); await flush();
  assert.ok(f.service.getSnapshot().epoch > firstEpoch, 'the same prepare call can acquire another retry epoch');
  assert.equal(f.service.getSnapshot().fileOnly, true, 'each retry token keeps its authored file-only role');
  if (outcome === 'ready') {
    const finalEpoch = f.service.getSnapshot().epoch;
    f.event('ready'); const ready = await preparing;
    assert.equal(ready.epoch, finalEpoch); assert.equal(ready.phase, 'prepared'); assert.equal(ready.fileOnly, true);
    const retired = f.service.withFileSession('th06', access => access.retire()); await retired;
    assert.equal(f.service.getSnapshot().epoch, null);
  } else {
    f.event('error', {error: 'failed retry 2'}); await flush();
    assert.ok(f.service.getSnapshot().epoch > firstEpoch);
    f.event('error', {error: 'failed retry 3'}); await rejected;
    assert.equal(f.service.getSnapshot().epoch, null, 'canonical prepare resets its own final failed retry before rejecting');
    assert.equal(f.service.getSnapshot().phase, 'error');
  }
  assert.equal(f.navigations.at(-1), 'about:blank');
  assert.equal(f.outbound.some(message => message.command === 'configure'), false);
  assert.equal(f.service.getSnapshot().fileOnly, false, 'success/failure reset clears the role');
});
test('runtime: failed retirement on a later preparation retry retains its original error and current owner', async () => {
  const f = fixture(), preparing = f.service.prepare({...managedPlan('th06'), fileOnly: true});
  const firstEpoch = f.service.getSnapshot().epoch;
  const rejected = assert.rejects(preparing, /blocked retry retirement/);
  await flush(); f.event('error', {error: 'failed retry 1'}); await flush();
  const retryEpoch = f.service.getSnapshot().epoch; assert.ok(retryEpoch > firstEpoch);
  const replace = f.runtime.location.replace;
  f.runtime.location.replace = href => {if (href === 'about:blank') throw new Error('blocked retry retirement'); replace(href);};
  f.event('error', {error: 'failed retry 2'}); await rejected;
  assert.equal(f.service.getSnapshot().epoch, retryEpoch);
  assert.equal(f.service.getSnapshot().fileOnly, true, 'blocked retirement retains the same token role');
  assert.match(f.service.getSnapshot().closeError, /blocked retry retirement/);
  f.runtime.location.replace = replace;
});

for (const fileOnly of [false, true]) test(`runtime: authenticated ${fileOnly ? 'file-only' : 'ordinary'} terminal context survives reset without changing the wire event`, async () => {
  const f = fixture(), received = [];
  const unsubscribe = f.service.subscribeEvents(message => received.push(message));
  const preparing = f.service.prepare({...directPlan(), fileOnly}), rejected = assert.rejects(preparing, {name: 'AbortError'});
  await flush(); const epoch = f.service.getSnapshot().epoch;
  f.event('exit', {status: 'success'}); await rejected;
  assert.equal(f.service.getSnapshot().epoch, null); assert.equal(f.service.getSnapshot().fileOnly, false);
  assert.equal(f.eventContexts.length, 1); const event = f.eventContexts[0];
  assert.deepEqual(event.context, {epoch, fileOnly}); assert.equal(Object.isFrozen(event.context), true);
  assert.equal(event.snapshot.fileOnly, false, 'terminal snapshot reset still precedes callback dispatch');
  assert.equal(event.snapshot.epoch, null);
  assert.deepEqual(event.message, {protocol: 'eagler-touhou/1', game: 'th06', epoch, event: 'exit', status: 'success'});
  assert.deepEqual(received, [event.message], 'genuine file/gameplay events still reach subscribers unchanged'); unsubscribe();
});
