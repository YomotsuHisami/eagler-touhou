/** Deterministic request/lifecycle ports, not a real-browser refresh claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `
  export {createDocumentRequestScope} from './app/services/document-request-scope.ts';
  export {createPreparationDocumentOwner} from './app/runtime/preparation-document-owner.ts';
  export {createGameLaunchJobController} from './app/services/game-launch-job.client.ts';
  export {createResourceManager} from './app/services/resources.client.ts';
`, resolveDir: root, loader: 'ts'}, bundle: true, format: 'esm', platform: 'browser', write: false,
  plugins: [{name: 'authored-browser-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path);
      const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
      if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
      const authored = path.replace(/\.mjs$/, '.mts');
      if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
    });
  }}]});
const directory = await mkdtemp(join(tmpdir(), 'ui-document-request-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const modulePath = join(directory, 'document-request.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const {createDocumentRequestScope, createPreparationDocumentOwner, createGameLaunchJobController, createResourceManager} = await import(pathToFileURL(modulePath).href);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const drain = async () => {for (let index = 0; index < 30; index++) await Promise.resolve();};
class Events {
  listeners = [];
  addEventListener(type, listener, capture = false) {this.listeners.push({type, listener, capture});}
  removeEventListener(type, listener, capture = false) {this.listeners = this.listeners.filter(item => item.type !== type || item.listener !== listener || item.capture !== capture);}
  emit(type, isTrusted = false) {
    const event = {type, isTrusted};
    for (const item of this.listeners.filter(item => item.type === type).sort((a, b) => Number(b.capture) - Number(a.capture))) item.listener(event);
  }
}
function fixture(t, fetchImpl = async () => new Response(null, {status: 404})) {
  const target = new Events(), calls = [];
  const scope = createDocumentRequestScope({target, fetchImpl: (...args) => {calls.push(args); return fetchImpl(...args);}});
  t.after(() => scope.dispose());
  return {target, scope, calls};
}
function runtimeFixture(phase = 'idle') {
  const snapshot = {phase, epoch: phase === 'idle' ? null : 7, ready: phase === 'prepared', launched: false};
  let cancels = 0;
  return {getSnapshot: () => snapshot, subscribe: () => () => {},
    prepare() {throw Error('Inspection cannot prepare a Runtime');}, cancel() {cancels++;}, get cancels() {return cancels;}};
}

test('the first root layout attachment releases requests without changing fetch arguments or errors', async t => {
  const f = fixture(t, async () => {throw Error('real active-document denial');});
  const init = {cache: 'no-store', signal: new AbortController().signal};
  const pending = f.scope.fetch('https://example.test/host-manifest.json', init);
  const checked = assert.rejects(pending, /real active-document denial/);
  assert.equal(f.calls.length, 0); f.scope.attach(); await checked;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1], init);
});

test('beforeunload holds new fetches until trusted input confirms a still-interactive document', async t => {
  const f = fixture(t); f.scope.attach(); f.target.emit('beforeunload');
  const pending = f.scope.fetch('https://example.test/host-manifest.json');
  await drain(); assert.equal(f.calls.length, 0);
  f.target.emit('pointerdown'); f.target.emit('keydown'); await drain(); assert.equal(f.calls.length, 0);
  f.target.emit('pointerdown', true); assert.equal((await pending).status, 404); assert.equal(f.calls.length, 1);
});

test('pagehide rejects held work and trusted input cannot revive it before pageshow', async t => {
  const f = fixture(t); f.scope.attach(); f.target.emit('beforeunload');
  const pending = f.scope.fetch('https://example.test/host-manifest.json');
  const checked = assert.rejects(pending, {name: 'AbortError'});
  f.target.emit('pagehide'); await checked;
  f.target.emit('keydown', true);
  await assert.rejects(f.scope.fetch('https://example.test/release-catalog.json'), {name: 'AbortError'});
  assert.equal(f.calls.length, 0);
  f.target.emit('pageshow'); await f.scope.fetch('https://example.test/host-manifest.json'); assert.equal(f.calls.length, 1);
});

test('an existing owner signal cancels held fetches, including Request-carried signals', async t => {
  const f = fixture(t); f.scope.attach(); f.target.emit('beforeunload');
  const first = new AbortController(), second = new AbortController();
  const a = f.scope.fetch('https://example.test/a', {signal: first.signal});
  const b = f.scope.fetch(new Request('https://example.test/b', {signal: second.signal}));
  const checks = [assert.rejects(a, {name: 'AbortError'}), assert.rejects(b, {name: 'AbortError'})];
  first.abort(); second.abort(); await Promise.all(checks);
  f.target.emit('keydown', true); await drain(); assert.equal(f.calls.length, 0);
});

test('an explicit null signal keeps the native RequestInit override while a fetch is held', async t => {
  const f = fixture(t), controller = new AbortController(); f.scope.attach(); f.target.emit('beforeunload');
  const request = new Request('https://example.test/a', {signal: controller.signal});
  controller.abort();
  const init = {signal: null}, pending = f.scope.fetch(request, init);
  f.target.emit('keydown', true); await pending;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], request); assert.equal(f.calls[0][1], init);
});

test('StrictMode detach/attach preserves departure state and final disposal cleans every listener', async t => {
  const f = fixture(t); f.scope.attach(); assert.equal(f.target.listeners.length, 5);
  f.target.emit('beforeunload');
  const pending = f.scope.fetch('https://example.test/host-manifest.json');
  const checked = assert.rejects(pending, {name: 'AbortError'});
  f.scope.detach(); assert.equal(f.target.listeners.length, 0);
  f.scope.attach(); f.scope.attach(); await drain();
  assert.equal(f.target.listeners.length, 5); assert.equal(f.calls.length, 0);
  f.scope.dispose(); await checked; assert.equal(f.target.listeners.length, 0);
  f.scope.attach(); f.target.emit('pageshow'); assert.equal(f.target.listeners.length, 0);
  await assert.rejects(f.scope.fetch('https://example.test/host-manifest.json'), {name: 'AbortError'});
});

test('a delayed game module resolving in the beforeunload/pagehide interval cannot start metadata', async t => {
  const f = fixture(t), module = deferred(), runtime = runtimeFixture(), controllers = [], tasks = [];
  const owner = createPreparationDocumentOwner({target: f.target, load: () => module.promise,
    onController(controller) {if (controller) {controllers.push(controller); const task = controller.inspect('th06'); void task.catch(() => {}); tasks.push(task);}},
    onError(error) {throw error;},
  });
  t.after(() => owner.dispose()); f.scope.attach(); owner.attach(); await drain();
  f.target.emit('beforeunload');
  module.resolve(() => createGameLaunchJobController({baseUrl: 'https://example.test/', runtimeService: runtime, fetchImpl: f.scope.fetch}));
  await drain(); assert.equal(controllers.length, 1); assert.equal(controllers[0].getSnapshot().inspecting, true);
  assert.equal(f.calls.length, 0);
  f.target.emit('pagehide'); await assert.rejects(tasks[0], {name: 'AbortError'});
  assert.equal(f.calls.length, 0); assert.equal(runtime.cancels, 0);
  f.target.emit('pageshow'); await drain(); await tasks[1];
  assert.equal(controllers.length, 2); assert.equal(f.calls.length, 2);
  assert.equal(controllers[1].getSnapshot().inspection.available, false, 'real 404 metadata still surfaces');
});

test('late resource storage inspection cannot start metadata after navigation begins', async t => {
  const f = fixture(t), stored = deferred(); f.scope.attach();
  const service = createResourceManager({baseUrl: 'https://example.test/', fetchImpl: f.scope.fetch,
    dependencies: {readCurrent: () => stored.promise, readKeys: async () => new Set()}});
  t.after(() => service.dispose());
  const pending = service.inspect('th06'); void pending.catch(() => {}); await drain();
  f.target.emit('beforeunload'); stored.resolve({installation: null, generation: null}); await drain();
  assert.equal(f.calls.length, 0);
  f.target.emit('pagehide'); service.dispose(); await assert.rejects(pending, error => error.code === 'cancelled');
  assert.equal(f.calls.length, 0);
});

test('capture pagehide gates cross-owner reads before ordinary listeners publish late inspection work', async t => {
  const f = fixture(t), runtime = runtimeFixture();
  const job = createGameLaunchJobController({baseUrl: 'https://example.test/', runtimeService: runtime, fetchImpl: f.scope.fetch});
  t.after(() => job.dispose());
  let inspection;
  f.target.addEventListener('pagehide', () => {inspection = job.inspect('th06'); void inspection.catch(() => {});});
  f.scope.attach(); f.target.emit('pagehide'); await drain(); await inspection;
  assert.equal(f.calls.length, 0); assert.equal(runtime.cancels, 0);
});

test('a cancelled beforeunload leaves a prepared Runtime and its controller intact', async t => {
  const f = fixture(t), runtime = runtimeFixture('prepared'), live = runtime.getSnapshot();
  const job = createGameLaunchJobController({baseUrl: 'https://example.test/', runtimeService: runtime, fetchImpl: f.scope.fetch});
  t.after(() => job.dispose()); f.scope.attach(); f.target.emit('beforeunload');
  const inspection = job.inspect('th06'); await drain();
  assert.equal(job.getSnapshot().inspecting, true); assert.equal(f.calls.length, 0);
  assert.equal(runtime.getSnapshot(), live); assert.equal(runtime.cancels, 0);
  f.target.emit('keydown', true); await inspection;
  assert.equal(f.calls.length, 2); assert.equal(runtime.getSnapshot(), live); assert.equal(runtime.cancels, 0);
});

test('beforeunload leaves an already-started fetch and its cancellation signal untouched', async t => {
  const response = deferred(), f = fixture(t, () => response.promise), controller = new AbortController();
  f.scope.attach(); const pending = f.scope.fetch('https://example.test/host-manifest.json', {signal: controller.signal});
  f.target.emit('beforeunload'); assert.equal(controller.signal.aborted, false); assert.equal(f.calls.length, 1);
  response.resolve(new Response(null, {status: 204})); assert.equal((await pending).status, 204);
});
