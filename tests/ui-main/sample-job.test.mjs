/** Root-lifetime job/epoch tests with injected ports, not game/browser evidence. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({ entryPoints: [join(root, 'app/services/sample-job.client.ts')], bundle: true,
  format: 'esm', platform: 'browser', write: false, plugins: [{ name: 'authored-browser-contracts', setup(builder) {
    builder.onResolve({ filter: /\.mjs$/ }, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path);
      const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
      if (facade) return { path: resolve(root, `src/contracts/${facade}.mts`) };
      const authored = path.replace(/\.mjs$/, '.mts');
      if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return { path: authored };
    });
  } }] });
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const directory = await mkdtemp(join(tmpdir(), 'ui-sample-job-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'sample-job.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { createSampleJobController } = await import(pathToFileURL(modulePath).href);

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const inspection = (label = 'available') => ({ available: true, status: 'installed', reason: null,
  scope: { game: 'th06', runtimeVariant: 'normal', language: 'ja', music: 'none', input: 'keyboard' },
  checks: [{ url: label, kind: 'runtime', available: true }], runtimeVerified: false, packageVerified: false, generationId: 'gen-sample' });
const plan = () => ({ game: 'th06', generation: { id: 'gen-sample' }, runtimeVariant: 'normal' });

function fixture(t, overrides = {}) {
  let live = Object.freeze({ phase: 'idle', epoch: null, game: null, generationId: null, ready: false, launched: false });
  const runtimeListeners = new Set(), calls = [], cancels = [], pending = [], inspections = [], preparations = [];
  let serial = 0, job;
  function set(next) { live = Object.freeze({ ...live, ...next }); for (const callback of runtimeListeners) callback(); }
  const runtime = {
    getSnapshot: () => live,
    subscribe(callback) { runtimeListeners.add(callback); return () => runtimeListeners.delete(callback); },
    prepare(value) {
      calls.push(value); const wait = deferred(); const epoch = ++serial;
      set({ epoch, phase: 'loading', game: value.game, generationId: value.generation.id, ready: false, launched: false });
      pending.push({ ...wait, epoch }); return wait.promise;
    },
    cancel() {
      assert.ok(['loading', 'configuring', 'prepared'].includes(live.phase));
      assert.equal(live.launched, false);
      cancels.push(live.epoch); set({ phase: 'idle', epoch: null, ready: false, launched: false });
    },
    launch() { throw new Error('The job controller must never launch'); },
  };
  const deps = {
    inspect: async options => { inspections.push(options); return inspection(); },
    prepare: async options => { preparations.push(options); return options.runtimeService.prepare(plan()); },
    ...overrides,
  };
  job = createSampleJobController({ runtimeService: runtime, baseUrl: 'https://example.test/review/', dependencies: deps });
  t.after(() => job.dispose());
  function complete(index = pending.length - 1, { setLive = true, epoch = pending[index].epoch } = {}) {
    const result = Object.freeze({ phase: 'prepared', epoch, game: 'th06', generationId: 'gen-sample', ready: true, launched: false });
    if (setLive) set(result); pending[index].resolve(result); return result;
  }
  return { job, runtime, runtimeListeners, calls, cancels, pending, preparations, inspections, set, complete,
    replace(phase = 'loading') { const epoch = ++serial; set({ epoch, phase, ready: phase === 'prepared', launched: phase === 'running' }); return epoch; } };
}

test('root jobs survive unsubscribing views and never auto-launch after preparation', async t => {
  const f = fixture(t); let notifications = 0;
  const unsubscribe = f.job.subscribe(() => notifications++);
  const initial = f.job.getSnapshot(); assert.equal(initial, f.job.getSnapshot()); assert.equal(Object.isFrozen(initial), true);
  const preparing = f.job.prepare(); await drain(); const during = notifications; unsubscribe();
  assert.equal(f.job.getSnapshot().preparing, true); assert.equal(f.calls.length, 1);
  const result = f.complete(); assert.equal(await preparing, result);
  assert.equal(notifications, during); assert.equal(f.job.getSnapshot().preparedEpoch, result.epoch);
  assert.equal(f.job.getSnapshot().preparing, false); assert.equal(f.cancels.length, 0);
  let remounted; const detach = f.job.subscribe(() => { remounted = f.job.getSnapshot(); });
  assert.equal(f.job.getSnapshot().preparedEpoch, result.epoch);
  f.set({ phase: 'launching' }); assert.equal(remounted.preparedEpoch, null); detach();
  assert.equal('launch' in f.job, false);
});

test('duplicate inspect and prepare clicks share the identical pending promise', async t => {
  const wait = deferred(); let count = 0;
  const f = fixture(t, { inspect: async () => { count++; return wait.promise; } });
  const a = f.job.inspect(), b = f.job.inspect(); assert.equal(a, b); await drain(); assert.equal(count, 1);
  wait.resolve(inspection()); await a;
  const c = f.job.prepare(), d = f.job.prepare(); assert.equal(c, d); await drain(); assert.equal(f.calls.length, 1);
  const result = f.complete(); await c;
  assert.deepEqual(await f.job.prepare(), result); assert.equal(f.calls.length, 1);
});

test('inspection snapshots and progress are immutable owned copies', async t => {
  const value = inspection(); let progress;
  const f = fixture(t, { inspect: async () => value,
    prepare: async options => { progress = { completed: 1, total: 3, fileId: 'game-data', found: true }; options.onProgress(progress); return options.runtimeService.prepare(plan()); } });
  const result = await f.job.inspect(); value.checks[0].url = 'mutated'; value.scope.language = 'changed';
  assert.equal(result.checks[0].url, 'available'); assert.equal(result.scope.language, 'ja');
  assert.equal(Object.isFrozen(result.checks[0]), true); assert.equal(Object.isFrozen(result.checks), true); assert.equal(Object.isFrozen(result.scope), true);
  const task = f.job.prepare(); await drain(); progress.completed = 2;
  assert.equal(f.job.getSnapshot().progress.completed, 1); assert.equal(Object.isFrozen(f.job.getSnapshot().progress), true);
  f.complete(); await task; assert.equal(f.job.getSnapshot().progress, null);
});

test('starting preparation aborts and invalidates an old inspection, including its late result', async t => {
  const wait = deferred(); let signal;
  const f = fixture(t, { inspect: async options => { signal = options.signal; return wait.promise; } });
  const old = f.job.inspect(); await drain(); const preparing = f.job.prepare(); await drain();
  assert.equal(signal.aborted, true); assert.equal(f.job.getSnapshot().inspection, null);
  f.complete(); await preparing; const preparedEpoch = f.job.getSnapshot().preparedEpoch;
  wait.resolve(inspection('stale')); await assert.rejects(old, { name: 'AbortError' });
  assert.equal(f.job.getSnapshot().preparedEpoch, preparedEpoch); assert.equal(f.job.getSnapshot().inspection, null);
});

test('cancelled inspection cannot overwrite a newer inspection or its error', async t => {
  const first = deferred(), second = deferred(); let count = 0;
  const f = fixture(t, { inspect: async () => (++count === 1 ? first.promise : second.promise) });
  const old = f.job.inspect(); await drain(); f.job.cancel(); const next = f.job.inspect(); await drain();
  second.resolve(inspection('new')); await next;
  first.resolve({ ...inspection('old'), available: false, reason: { code: 'host-unavailable', message: 'stale failure' } });
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(f.job.getSnapshot().inspection.checks[0].url, 'new'); assert.equal(f.job.getSnapshot().error, null);
});

test('cancel during acquisition/verification prevents the wrapped Runtime boundary from starting', async t => {
  const verify = deferred(); let options;
  const f = fixture(t, { prepare: async input => { options = input; await verify.promise; return input.runtimeService.prepare(plan()); } });
  const task = f.job.prepare(); await drain(); f.job.cancel();
  assert.equal(options.signal.aborted, true); assert.equal(f.job.getSnapshot().preparing, false);
  verify.resolve(); await assert.rejects(task, { name: 'AbortError' });
  assert.equal(f.calls.length, 0); assert.equal(f.cancels.length, 0); assert.equal(f.job.getSnapshot().error, null);
});

test('cancel captures and stops only the synchronously started preparation epoch', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const epoch = f.pending[0].epoch;
  f.job.cancel(); assert.deepEqual(f.cancels, [epoch]); assert.equal(f.runtime.getSnapshot().epoch, null);
  f.complete(0, { setLive: false }); await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(f.cancels, [epoch]); assert.equal(f.job.getSnapshot().preparedEpoch, null);
});

test('synchronous Runtime subscription cancellation captures the preparation boundary safely', async t => {
  const f = fixture(t); let cancelled = false;
  const unsubscribe = f.runtime.subscribe(() => {
    if (!cancelled && f.runtime.getSnapshot().phase === 'loading') { cancelled = true; f.job.cancel(); }
  });
  const task = f.job.prepare(); await drain();
  assert.equal(cancelled, true); assert.deepEqual(f.cancels, [f.pending[0].epoch]);
  f.complete(0, { setLive: false }); await assert.rejects(task, { name: 'AbortError' }); unsubscribe();
});

test('a later synchronous Runtime subscriber cannot make cancellation adopt its replacement epoch', async t => {
  const f = fixture(t); let replacement = null;
  const unsubscribe = f.runtime.subscribe(() => {
    if (replacement === null && f.runtime.getSnapshot().phase === 'loading') {
      replacement = -1; f.runtime.cancel(); replacement = f.replace('prepared');
    }
  });
  const task = f.job.prepare(); await drain(); f.job.cancel();
  assert.deepEqual(f.cancels, [f.pending[0].epoch]); assert.equal(f.runtime.getSnapshot().epoch, replacement);
  f.complete(0, { setLive: false }); await assert.rejects(task, { name: 'AbortError' });
  assert.equal(f.runtime.getSnapshot().epoch, replacement); unsubscribe();
});

test('a newer Runtime epoch survives cancellation and the old preparation completion', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const next = f.replace('prepared');
  f.job.cancel(); assert.deepEqual(f.cancels, []);
  f.complete(0, { setLive: false }); await assert.rejects(task, { name: 'AbortError' });
  assert.equal(f.runtime.getSnapshot().epoch, next); assert.equal(f.runtime.getSnapshot().phase, 'prepared');
  assert.deepEqual(f.cancels, []);
});

test('late superseded completion without explicit cancellation never grants Start for a newer epoch', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const next = f.replace('prepared');
  f.complete(0, { setLive: false }); await assert.rejects(task, /replaced/);
  assert.equal(f.job.getSnapshot().preparedEpoch, null); assert.equal(f.runtime.getSnapshot().epoch, next); assert.deepEqual(f.cancels, []);
});

test('acquisition cannot overwrite an unrelated session that starts before its Runtime boundary', async t => {
  const wait = deferred();
  const f = fixture(t, { prepare: async input => { await wait.promise; return input.runtimeService.prepare(plan()); } });
  const task = f.job.prepare(); await drain(); const next = f.replace('running'); wait.resolve();
  await assert.rejects(task, /session started/); assert.equal(f.calls.length, 0);
  assert.equal(f.runtime.getSnapshot().epoch, next); assert.deepEqual(f.cancels, []);
});

test('prepare rejects a current or running Runtime without acquisition or cancellation', async t => {
  for (const phase of ['loading', 'configuring', 'prepared', 'launching', 'running', 'saving', 'error']) {
    const f = fixture(t); f.replace(phase);
    await assert.rejects(f.job.prepare(), /Save and close/);
    assert.equal(f.preparations.length, 0); assert.equal(f.calls.length, 0); assert.deepEqual(f.cancels, []);
  }
});

test('launching or saving an owned prepared epoch invalidates Start and cannot be cancelled by this controller', async t => {
  for (const phase of ['launching', 'running', 'saving']) {
    const f = fixture(t); const task = f.job.prepare(); await drain(); f.complete(); await task;
    const epoch = f.runtime.getSnapshot().epoch; f.set({ phase, launched: phase === 'running' });
    assert.equal(f.job.getSnapshot().preparedEpoch, null); f.job.cancel();
    assert.equal(f.runtime.getSnapshot().epoch, epoch); assert.deepEqual(f.cancels, []);
  }
});

test('an explicit cancel after preparation cleans up its prepared epoch', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const result = f.complete(); await task;
  f.job.cancel(); assert.deepEqual(f.cancels, [result.epoch]); assert.equal(f.job.getSnapshot().preparedEpoch, null);
});

test('internal Runtime retry final epoch is adopted only from the original prepare promise', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const retry = f.replace('loading');
  f.complete(0, { epoch: retry }); await task;
  assert.equal(f.job.getSnapshot().preparedEpoch, retry); f.job.cancel(); assert.deepEqual(f.cancels, [retry]);
});

test('cancel during an internal retry defers cleanup until its authoritative result, preserving any newer session', async t => {
  const own = fixture(t); const task = own.job.prepare(); await drain(); const retry = own.replace('loading'); own.job.cancel();
  assert.deepEqual(own.cancels, []); own.complete(0, { epoch: retry }); await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(own.cancels, [retry]);
  const newer = fixture(t); const old = newer.job.prepare(); await drain(); const olderRetry = newer.replace('loading');
  newer.job.cancel(); const unrelated = newer.replace('prepared'); newer.complete(0, { epoch: olderRetry, setLive: false });
  await assert.rejects(old, { name: 'AbortError' }); assert.deepEqual(newer.cancels, []); assert.equal(newer.runtime.getSnapshot().epoch, unrelated);
});

test('completion-time subscription cancellation uses the returned retry epoch', async t => {
  const f = fixture(t); f.job.subscribe(() => { if (f.job.getSnapshot().preparedEpoch !== null) f.job.cancel(); });
  const task = f.job.prepare(); await drain(); const retry = f.replace('loading'); f.complete(0, { epoch: retry });
  await assert.rejects(task, { name: 'AbortError' }); assert.deepEqual(f.cancels, [retry]);
});

test('late progress/error after cancellation cannot poison a newer job', async t => {
  const first = deferred(); let count = 0, stale;
  const f = fixture(t, { prepare: async input => {
    if (++count === 1) { stale = input; return first.promise; }
    return input.runtimeService.prepare(plan());
  } });
  const old = f.job.prepare(); await drain(); f.job.cancel(); const next = f.job.prepare(); await drain();
  stale.onProgress({ completed: 99, total: 99, fileId: 'late', found: true });
  first.reject(new Error('old download failed')); await assert.rejects(old, { name: 'AbortError' });
  assert.equal(f.job.getSnapshot().preparing, true); assert.equal(f.job.getSnapshot().progress, null); assert.equal(f.job.getSnapshot().error, null);
  f.complete(); await next;
});

test('dispose cleans up jobs and subscriptions but never an unrelated or launched Runtime', async t => {
  const f = fixture(t); const task = f.job.prepare(); await drain(); const epoch = f.runtime.getSnapshot().epoch;
  f.job.dispose(); assert.deepEqual(f.cancels, [epoch]); assert.equal(f.runtimeListeners.size, 0);
  f.complete(0, { setLive: false }); await assert.rejects(task, { name: 'AbortError' });
  await assert.rejects(f.job.inspect(), /disposed/); await assert.rejects(f.job.prepare(), /disposed/);
  f.job.dispose(); assert.deepEqual(f.cancels, [epoch]);
  const other = fixture(t); const live = other.replace('running'); other.job.dispose();
  assert.equal(other.runtime.getSnapshot().epoch, live); assert.deepEqual(other.cancels, []);
});

test('unavailable inspection and preparation rejection are reported without auto-retry', async t => {
  const f = fixture(t, { inspect: async () => ({ ...inspection(), available: false, status: 'unavailable', reason: { code: 'host-unavailable', message: 'No Host Manifest' } }),
    prepare: async () => { throw new Error('Checksum failed'); } });
  await f.job.inspect(); assert.equal(f.job.getSnapshot().error, 'No Host Manifest');
  await assert.rejects(f.job.prepare(), /Checksum failed/); assert.equal(f.job.getSnapshot().error, 'Checksum failed');
  assert.equal(f.job.getSnapshot().preparing, false); assert.equal(f.job.getSnapshot().preparedEpoch, null); assert.equal(f.calls.length, 0);
});
