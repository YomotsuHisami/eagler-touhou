/** Document lifecycle tests with delayed module/metadata ports. No browser run. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({ stdin: { contents: `
  export {createSamplePreparationDocumentOwner} from './app/components/SamplePreparation.tsx';
  export {createSampleJobController} from './app/services/sample-job.client.ts';
`, resolveDir: root, loader: 'ts' }, bundle: true, jsx: 'automatic',
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
const directory = await mkdtemp(join(tmpdir(), 'ui-sample-document-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'sample-document.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { createSamplePreparationDocumentOwner, createSampleJobController } = await import(pathToFileURL(modulePath).href);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function drain() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
function setup(t, { delayed = true, runtimePhase = 'idle', ready = true } = {}) {
  const target = new EventTarget(), module = deferred();
  const owners = [], signals = [], errors = [], deliveries = [], pending = [], runtimeCancels = [];
  let loads = 0;
  let runtimeReady = ready;
  const runtime = {
    getSnapshot: () => ({ phase: runtimePhase, epoch: runtimePhase === 'idle' ? null : 7,
      ready: runtimePhase === 'running', launched: runtimePhase === 'running' }),
    subscribe: () => () => {},
    cancel: () => runtimeCancels.push(7),
    prepare: () => { throw new Error('Inspection must not prepare a Runtime'); },
  };
  function factory() {
    const controller = createSampleJobController({ runtimeService: runtime, baseUrl: 'https://example.test/',
      dependencies: {
        inspect: ({ signal }) => {
          const request = deferred(); signals.push(signal); pending.push(request);
          signal.addEventListener('abort', () => request.reject(new DOMException('Aborted', 'AbortError')), { once: true });
          return request.promise;
        },
        prepare: () => { throw new Error('Unexpected Package preparation'); },
      } });
    owners.push(controller); return controller;
  }
  const document = createSamplePreparationDocumentOwner({ target,
    ready:()=>runtimeReady,
    load: () => { loads++; return delayed ? module.promise : Promise.resolve(factory); },
    onController(controller) { deliveries.push(controller); if (controller) void controller.inspect().catch(() => {}); },
    onError: error => errors.push(error),
  });
  t.after(() => document.dispose());
  return { document, target, module, factory, owners, signals, errors, deliveries, pending, runtimeCancels,
    setReady(value) { runtimeReady=value; },
    loads: () => loads, hide: () => target.dispatchEvent(new Event('pagehide')),
    show: () => target.dispatchEvent(new Event('pageshow')) };
}

test('pagehide fences a late module resolution before any controller or metadata request exists', async t => {
  const f = setup(t); f.document.attach(); await drain(); assert.equal(f.loads(), 1);
  f.hide(); f.module.resolve(f.factory); await drain();
  assert.equal(f.owners.length, 0); assert.equal(f.signals.length, 0); assert.deepEqual(f.errors, []);
  f.show(); await drain();
  assert.equal(f.loads(), 1, 'BFCache reuses the loaded module but creates a fresh document job owner');
  assert.equal(f.owners.length, 1); assert.equal(f.signals.length, 1); assert.equal(f.signals[0].aborted, false);
});

test('pagehide while Runtime is null remains authoritative when Runtime resolves and its effect reattaches', async t => {
  const f = setup(t, { delayed: false, ready: false });
  f.document.attach(); await drain(); assert.equal(f.loads(), 0);
  f.hide();
  // RuntimeProvider's import completes after departure. The runtime-dependent
  // effect replays, but it must not reset the document-active state.
  f.document.detach(); f.setReady(true); f.document.reset(); f.document.attach(); await drain();
  assert.equal(f.loads(), 0); assert.equal(f.owners.length, 0); assert.equal(f.signals.length, 0);
  f.show(); await drain();
  assert.equal(f.loads(), 1); assert.equal(f.owners.length, 1); assert.equal(f.signals.length, 1);
});

test('Runtime availability gates a pending factory again before committing its owner', async t => {
  const f = setup(t); f.document.attach(); await drain(); f.setReady(false);
  f.module.resolve(f.factory); await drain(); assert.equal(f.owners.length, 0); assert.equal(f.signals.length, 0);
  f.setReady(true); f.document.reset(); await drain();
  assert.equal(f.owners.length, 1); assert.equal(f.signals.length, 1);
});

test('pagehide aborts existing document metadata work without closing an active Runtime', async t => {
  const f = setup(t, { delayed: false, runtimePhase: 'running' }); f.document.attach(); await drain();
  const old = f.owners[0]; assert.equal(old.getSnapshot().inspecting, true); f.hide();
  assert.equal(f.signals[0].aborted, true); assert.equal(old.getSnapshot().inspecting, false);
  await drain(); assert.deepEqual(f.runtimeCancels, []); assert.deepEqual(f.errors, []);
  f.show(); await drain(); assert.equal(f.owners.length, 2); assert.notEqual(f.owners[1], old);
  assert.equal(f.signals[1].aborted, false); assert.deepEqual(f.runtimeCancels, []);
});

test('effect detach/attach preserves the current root job instead of cancelling route-window work', async t => {
  const f = setup(t, { delayed: false }); f.document.attach(); await drain();
  const owner = f.owners[0]; f.document.detach(); f.document.attach(); await drain();
  assert.equal(f.owners.length, 1); assert.equal(f.owners[0], owner); assert.equal(f.signals.length, 1);
  assert.equal(f.signals[0].aborted, false); assert.equal(owner.getSnapshot().inspecting, true);
});

test('effect replay during a pending import commits one owner only', async t => {
  const f = setup(t); f.document.attach(); await drain(); f.document.detach(); f.document.attach();
  f.module.resolve(f.factory); await drain();
  assert.equal(f.owners.length, 1); assert.equal(f.signals.length, 1); assert.equal(f.loads(), 1);
});

test('final disposal prevents late initialization and removes document listeners', async t => {
  const f = setup(t); f.document.attach(); await drain(); f.document.dispose();
  f.module.resolve(f.factory); f.show(); await drain(); f.document.attach();
  assert.equal(f.owners.length, 0); assert.equal(f.signals.length, 0); assert.deepEqual(f.errors, []);
});

test('pagehide before the provider receives its import result also blocks immediate show/hide races', async t => {
  const f = setup(t); f.document.attach(); f.hide(); f.show(); f.hide();
  f.module.resolve(f.factory); await drain(); assert.equal(f.owners.length, 0);
  f.show(); await drain(); assert.equal(f.owners.length, 1); assert.equal(f.signals.length, 1);
});

test('import rejection after departure is handled quietly and pageshow can retry', async t => {
  const target = new EventTarget(), first = deferred(); let loads = 0, creates = 0, disposes = 0;
  const errors = [];
  const document = createSamplePreparationDocumentOwner({ target,
    load: () => ++loads === 1 ? first.promise : Promise.resolve(() => { creates++; return { dispose() { disposes++; } }; }),
    onController() {}, onError: error => errors.push(error),
  });
  t.after(() => document.dispose()); document.attach(); await drain();
  target.dispatchEvent(new Event('pagehide')); first.reject(new Error('document import stopped')); await drain();
  assert.deepEqual(errors, []); target.dispatchEvent(new Event('pageshow')); await drain();
  assert.equal(loads, 2); assert.equal(creates, 1); document.dispose(); assert.equal(disposes, 1);
});

test('metadata denial while the document remains active is still surfaced, not filtered', async t => {
  const f = setup(t, { delayed: false }); f.document.attach(); await drain();
  f.pending[0].reject(new Error('Fetch access denied')); await drain();
  assert.match(f.owners[0].getSnapshot().error, /Fetch access denied/);
  assert.equal(f.signals[0].aborted, false);
});
