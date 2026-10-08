/** Synthetic bridge tests. These assert ownership and route-cancellation policy, not a real Runtime launch. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-file-preparation-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: "export * from './app/services/file-preparation.client.ts';", resolveDir: root}, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}]});
const modulePath = join(directory, 'file-preparation.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
const {createFilePreparationController} = await import(pathToFileURL(modulePath).href);
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function fixture() {
  const listeners = new Set(); let live = {game: null, runtimeVariant: null, saveRoot: null, scoreFile: null, epoch: null, ready: false, phase: 'idle', launched: false, saveUnavailable: false, fileOperationBusy: false};
  const runtime = {getSnapshot: () => live, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);}};
  return {runtime, get live() {return live;}, change(patch) {live = {...live, ...patch}; for (const listener of [...listeners]) listener();}};
}
function setup(t) {const h = fixture(), controller = createFilePreparationController({runtimeService: h.runtime}); t.after(() => controller.dispose()); return {h, controller};}

test('file action prepares its selected product once and returns the exact prepared epoch without starting gameplay', async t => {
  const {h, controller} = setup(t); let calls = 0;
  controller.registerPreparer(async (product, signal) => {
    calls++; assert.equal(product, 'th06'); assert.equal(signal.aborted, false);
    h.change({game: 'th06', runtimeVariant: 'normal', saveRoot: '/savesth06', scoreFile: 'score.dat', epoch: 9, ready: true, phase: 'prepared', launched: false});
  });
  assert.equal(controller.getSnapshot().canPrepare, true);
  const ready = await controller.ensurePrepared('th06');
  assert.deepEqual(ready, {identity: {productId: 'th06', game: 'th06', runtimeVariant: 'normal', saveRoot: '/savesth06', scoreFile: 'score.dat'}, epoch: 9});
  assert.equal(calls, 1);
  assert.equal(h.live.launched, false);
  assert.equal(controller.getSnapshot().phase, 'idle');
});

test('same product requests share the active preparation and a cancelled view cannot continue its file action', async t => {
  const {h, controller} = setup(t), gate = deferred(); let calls = 0;
  controller.registerPreparer(async product => {calls++; assert.equal(product, 'th07'); await gate.promise; h.change({game: 'th07', runtimeVariant: 'normal', saveRoot: '/savesth07', scoreFile: 'score.dat', epoch: 4, ready: true, phase: 'prepared', launched: false});});
  const abort = new AbortController();
  const dismissed = controller.ensurePrepared('th07', abort.signal);
  const stillNeeded = controller.ensurePrepared('th07');
  assert.equal(calls, 0); await Promise.resolve(); assert.equal(calls, 1);
  abort.abort(); await assert.rejects(dismissed, {name: 'AbortError'});
  gate.resolve(); assert.deepEqual(await stillNeeded, {identity: {productId: 'th07', game: 'th07', runtimeVariant: 'normal', saveRoot: '/savesth07', scoreFile: 'score.dat'}, epoch: 4});
  assert.equal(h.live.launched, false);
});

test('it refuses a different product during preparation and rejects a result from a stale or launched Runtime', async t => {
  const {h, controller} = setup(t), gate = deferred();
  controller.registerPreparer(async () => gate.promise);
  const first = controller.ensurePrepared('th06'); await Promise.resolve();
  await assert.rejects(controller.ensurePrepared('th10'), /另一个作品正在准备/);
  h.change({game: 'th06', epoch: 5, ready: true, phase: 'running', launched: true});
  gate.resolve(); await assert.rejects(first, /结束游戏/);
  assert.equal(h.live.launched, true);
});

test('a removed bridge and preparation failure never claim files are ready', async t => {
  const {h, controller} = setup(t);
  const unregister = controller.registerPreparer(async () => {throw new Error('package preparation failed');});
  await assert.rejects(controller.ensurePrepared('th10'), /package preparation failed/);
  assert.equal(controller.getSnapshot().phase, 'error');
  unregister(); assert.equal(controller.getSnapshot().canPrepare, false);
  await assert.rejects(controller.ensurePrepared('th10'), /尚未连接/);
  assert.equal(h.live.phase, 'idle');
});

test('same game and epoch cannot satisfy a different SP/MP storage identity', async t => {
  const {h, controller} = setup(t); let calls = 0;
  controller.registerPreparer(async product => {
    calls++;
    assert.equal(product, 'th08mp');
    h.change({game: 'th08', runtimeVariant: 'multiplayer', saveRoot: '/savesth08', scoreFile: 'score.dat', epoch: 13, ready: true, phase: 'prepared', launched: false});
  });
  const result = await controller.ensurePrepared('th08mp');
  assert.equal(result.identity.runtimeVariant, 'multiplayer');
  assert.equal(result.identity.productId, 'th08mp');
  assert.equal(calls, 1);
  await assert.rejects(controller.ensurePrepared('th08'), /普通\/多人文件身份/);
});
