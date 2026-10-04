/** Synthetic module/document/Runtime ports; real reload remains a CI browser gate. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `
  export {createPreparationDocumentOwner} from './app/runtime/preparation-document-owner';
  export {createDocumentRequestScope} from './app/services/document-request-scope';
  export {createTitleRoomEntry} from './app/services/title-room-entry.client';
`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'browser', format: 'esm', write: false});
const directory = await mkdtemp(join(tmpdir(), 'ui-title-document-')); after(() => rm(directory, {recursive: true, force: true}));
const modulePath = join(directory, 'title-document.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
const {createPreparationDocumentOwner, createDocumentRequestScope, createTitleRoomEntry} = await import(pathToFileURL(modulePath).href);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const drain = async () => {for (let index = 0; index < 30; index++) await Promise.resolve();};
function setup(t, ready = true) {
  const target = new EventTarget(), pending = [], owners = [], values = [], errors = [], requests = [], inputs = [];
  const subscriptions = new Set(), listeners = new Set();
  let runtime = ready ? runtimePort() : null;
  function runtimePort(epoch = 7) {
    return {getSnapshot: () => ({epoch, game: 'th09', runtimeVariant: 'normal', ready: true, launched: true}),
      subscribe: callback => {subscriptions.add(callback); return () => subscriptions.delete(callback);},
      subscribeEvents: callback => {listeners.add(callback); return () => listeners.delete(callback);},
      postInput: (...args) => {inputs.push(args); return true;}, close: async () => {throw Error('Document lifecycle must not close Runtime');}};
  }
  const scope = createDocumentRequestScope({target, fetchImpl: () => {throw Error('No title document metadata fetch');}});
  const owner = createPreparationDocumentOwner({target, ready: () => !!runtime, retainOnPagehide: true,
    load: async () => {
      await scope.run(() => {const module = deferred(); pending.push(module); return module.promise;});
      return () => {const controller = createTitleRoomEntry({runtime, onRequest: value => {if (owner.isActive()) requests.push(value);}, onRetired() {}}); owners.push(controller); return controller;};
    },
    onController: value => values.push(value), onError: error => errors.push(error),
  });
  t.after(() => {owner.dispose(); scope.dispose();});
  scope.attach(); owner.attach();
  return {target, scope, owner, pending, owners, values, errors, requests, inputs, subscriptions, listeners,
    event: type => target.dispatchEvent(new Event(type)),
    replaceRuntime(epoch = 8) {owner.detach(); runtime = runtimePort(epoch); owner.reset(); owner.attach();},
    emit(epoch = 7) {for (const callback of listeners) callback({event: 'network-request', game: 'th09', epoch});},
  };
}

test('Runtime becoming ready during beforeunload cannot start a title module before pagehide', async t => {
  const f = setup(t, false); await drain(); assert.equal(f.pending.length, 0);
  f.event('beforeunload'); f.replaceRuntime(); await drain(); assert.equal(f.pending.length, 0);
  f.event('pagehide'); await drain();
  assert.deepEqual(f.errors, []); assert.equal(f.owners.length, 0); assert.equal(f.listeners.size, 0);
  f.event('pageshow'); await drain(); assert.equal(f.pending.length, 1);
  f.pending[0].resolve(); await drain(); assert.equal(f.owners.length, 1);
  f.emit(8); assert.equal(f.requests[0].epoch, 8);
});

test('a cancelled departure resumes a held module without touching retained Runtime', async t => {
  const f = setup(t, false); f.event('beforeunload'); f.replaceRuntime(); await drain();
  assert.equal(f.pending.length, 0);
  f.scope.resumeFromTrustedInput({type: 'keydown', isTrusted: true}); await drain();
  assert.equal(f.pending.length, 1); f.pending[0].resolve(); await drain();
  assert.equal(f.owners.length, 1); assert.deepEqual(f.inputs, []); assert.deepEqual(f.errors, []);
});

test('a cancelled in-flight module rejection is handled after pagehide, and pageshow retries', async t => {
  const f = setup(t); await drain(); assert.equal(f.pending.length, 1);
  f.event('beforeunload'); f.event('pagehide'); f.pending[0].reject(new TypeError('Importing a module script failed.')); await drain();
  assert.deepEqual(f.errors, []); assert.equal(f.listeners.size, 0); assert.equal(f.owners.length, 0);
  f.event('pageshow'); await drain(); assert.equal(f.pending.length, 2);
  f.pending[1].resolve(); await drain(); assert.equal(f.listeners.size, 1); assert.equal(f.owners.length, 1);
});

test('a live module failure remains actionable and explicit retry can initialize its owner', async t => {
  const f = setup(t); await drain(); const failure = new TypeError('Importing a module script failed.');
  f.pending[0].reject(failure); await drain(); assert.deepEqual(f.errors, [failure]); assert.equal(f.owners.length, 0);
  f.owner.reset(); await drain(); assert.equal(f.pending.length, 2);
  f.pending[1].resolve(); await drain(); assert.equal(f.values.at(-1), f.owners[0]); assert.equal(f.listeners.size, 1);
});

for (const outcome of ['resolve', 'reject']) test(`a disposed title owner fences late module ${outcome}`, async t => {
  const f = setup(t); await drain(); f.owner.dispose();
  f.pending[0][outcome](new TypeError('Disposed module')); await drain(); f.event('pageshow');
  assert.deepEqual(f.errors, []); assert.equal(f.owners.length, 0); assert.equal(f.listeners.size, 0);
});

test('a late successful module cannot subscribe after pagehide; BFCache preserves a loaded native receipt', async t => {
  const f = setup(t); await drain(); f.event('pagehide'); f.pending[0].resolve(); await drain();
  assert.equal(f.owners.length, 0); assert.equal(f.subscriptions.size, 0);
  f.owner.detach(); f.owner.attach(); await drain(); assert.equal(f.owners.length, 0);
  f.event('pageshow'); await drain(); assert.equal(f.pending.length, 1); assert.equal(f.owners.length, 1);
  f.emit(); assert.equal(f.requests.length, 1); const receipt = f.owners[0].getSnapshot().source; f.event('pagehide');
  assert.equal(f.owner.isActive(), false); assert.equal(f.values.at(-1), null); assert.deepEqual(f.inputs, []);
  f.event('pageshow'); await drain(); assert.equal(f.owners.length, 1); assert.equal(f.values.at(-1), f.owners[0]);
  assert.equal(f.owners[0].getSnapshot().source, receipt, 'BFCache must not strand the retained native title request');
  assert.equal(f.listeners.size, 1); assert.equal(f.subscriptions.size, 1);
  f.owner.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.subscriptions.size, 0);

});

test('StrictMode replay and Runtime replacement while importing commit only the current owner', async t => {
  const f = setup(t); await drain(); f.owner.detach(); f.owner.attach(); f.replaceRuntime();
  f.pending[0].resolve(); await drain(); assert.equal(f.pending.length, 1); assert.equal(f.owners.length, 1);
  assert.equal(f.listeners.size, 1); assert.equal(f.subscriptions.size, 1); f.emit(7); f.emit(8);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].epoch, 8);
  f.owner.detach(); f.owner.attach(); await drain(); assert.equal(f.owners.length, 1);
});

test('title module wiring preserves document ownership, visible live failures and an explicit retry', async () => {
  const entry = await readFile(join(root, 'app/components/TitleRoomEntry.tsx'), 'utf8');
  assert.match(entry, /createPreparationDocumentOwner<TitleRoomEntryController>/);
  assert.match(entry, /ready:.*current\.current\.runtime/);
  assert.match(entry, /retainOnPagehide: true/);
  assert.match(entry, /if \(!documentOwner\.isActive\(\)\) return/);
  assert.match(entry, /scope\.run\(load\)/);
  assert.match(entry, /onError:.*setError/);
  assert.match(entry, /documentOwner\.detach\(\)/); assert.match(entry, /documentOwner\.dispose\(\)/);
  const provider = await readFile(join(root, 'app/components/MultiplayerRoomProvider.tsx'), 'utf8');
  assert.match(provider, /titleEntry\.error[\s\S]*role="alert"/);
  assert.match(provider, /onClick=\{titleEntry\.retry\}/);
  const telemetry = await readFile(join(root, 'tests/ui-main/refresh-telemetry.ts'), 'utf8');
  assert.match(telemetry, /addEventListener\('unhandledrejection'/); assert.match(telemetry, /addEventListener\('vite:preloadError'/);
  assert.doesNotMatch(telemetry, /\.preventDefault\(|\.stopPropagation\(/);
});
