/** Synthetic score policy/native-owner protocol tests. No real browser, IDBFS,
 * original save data, phone, or long-term persistence claims. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-saves-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: `
  export * from './app/services/saves.client.ts';
  export * from './app/components/SaveManager.tsx';
  export {createElement} from 'react';
  export {MemoryRouter} from 'react-router';
  export {renderToStaticMarkup} from 'react-dom/server';
`, resolveDir: root, loader: 'tsx'}, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false, jsx: 'automatic', loader: {'.css':'empty'},
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}]});
const modulePath = join(directory, 'saves.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
const {createSaveController, SaveManagerView, createElement, MemoryRouter, renderToStaticMarkup} = await import(pathToFileURL(modulePath).href);
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function upload(name, values) {const bytes = Uint8Array.from(values); return {name, size: bytes.length, async arrayBuffer() {return bytes.slice().buffer;}};}
async function drain() {for (let i = 0; i < 25; i++) await Promise.resolve();}
function fixture(initial = {}) {
  const persisted = new Map(Object.entries(initial).map(([path, values]) => [path, Uint8Array.from(values)]));
  const clone = () => new Map([...persisted].map(([path, bytes]) => [path, bytes.slice()]));
  let files = clone(), owner = null, overrides = {};
  let snapshot = {phase: 'prepared', fileOperationBusy: false, game: 'th06', epoch: 1, ready: true, launched: false, saveUnavailable: false};
  const calls = [], listeners = new Set();
  function change(patch) {snapshot = {...snapshot, ...patch}; for (const fn of [...listeners]) fn();}
  const runtime = {getSnapshot: () => snapshot, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    withFileSession(game, work) {
      if (owner || game !== snapshot.game || !snapshot.ready || snapshot.phase !== 'prepared' || snapshot.launched || snapshot.saveUnavailable) return Promise.reject(new Error('Runtime unavailable'));
      const current = owner = {};
      function access(epoch) {
        const check = () => {if (owner !== current || epoch !== snapshot.epoch || snapshot.phase !== 'prepared' || snapshot.launched || snapshot.saveUnavailable) throw new Error('Session replaced');};
        return {
          epoch,
          async sync() {check(); calls.push(['sync', epoch]); if (overrides.sync) await overrides.sync(); check();},
          async send(command, payload) {
            check(); calls.push([command, payload, epoch]);
            if (overrides[command]) {const result = await overrides[command](payload); check(); return result;}
            if (command === 'list') return {files: [...files].map(([path, bytes]) => ({path, size: bytes.length}))};
            if (command === 'read') {if (!files.has(payload.path)) throw new Error('Missing file'); return {bytes: [...files.get(payload.path)]};}
            if (command === 'write') {files.set(payload.path, Uint8Array.from(payload.bytes)); persisted.set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};}
            throw new Error('Unexpected command');
          },
          async restart() {
            check(); calls.push(['restart', epoch]);
            if (overrides.restart) {const result = await overrides.restart(epoch); check(); if (result) return result;}
            check(); change({phase: 'loading', ready: false}); files = clone();
            change({epoch: epoch + 1, phase: 'prepared', ready: true}); return access(epoch + 1);
          },
        };
      }
      change({fileOperationBusy: true});
      return Promise.resolve().then(() => work(access(snapshot.epoch))).finally(() => {if (owner === current) {owner = null; change({fileOperationBusy: false});}});
    }};
  return {runtime, persisted, calls, files: () => files, change, override(value) {overrides = value;}, listenerCount: () => listeners.size};
}
function setup(t, initial = {}, options = {}) {
  const h = fixture(initial), controller = createSaveController({runtimeService: h.runtime, ...options});
  t.after(() => controller.dispose()); controller.loadProduct('th06');
  return {...h, controller, state: (product = 'th06') => controller.getSnapshot(product)};
}
const mutations = h => h.calls.filter(([command]) => command === 'write');
const ticket = (h, name = 'backup.dat', bytes = [1, 2, 255], product = 'th06') => h.controller.requestImport(product, upload(name, bytes));

test('construction is inert and refresh reads only canonical score metadata through the existing owner', async t => {
  const h = setup(t, {'score.dat': [9, 8], 'replay/a.rpy': [7], 'th06.cfg': [6]});
  assert.deepEqual(h.calls, []); assert.equal(h.state().loaded, false);
  await h.controller.refresh('th06');
  assert.deepEqual(h.calls.map(([command]) => command), ['sync', 'list']);
  assert.equal(h.state().exists, true); assert.equal(h.state().size, 2); assert.ok(Object.isFrozen(h.state()));
  assert.equal(h.state().scoreFile, 'score.dat'); assert.equal(h.state().saveRoot, '/savesth06');
  h.controller.loadProduct('th06mp'); assert.equal(h.state('th06mp'), h.state());
});

test('export synchronizes and returns exact binary bytes and canonical filename without mutating storage', async t => {
  const h = setup(t, {'score.dat': [0, 1, 128, 255], 'th06.cfg': [9]});
  const result = await h.controller.exportFile('th06');
  assert.equal(result.name, 'score.dat'); assert.equal(result.type, 'application/octet-stream');
  assert.deepEqual([...result.bytes], [0, 1, 128, 255]); assert.deepEqual(mutations(h), []);
  assert.deepEqual(h.calls.map(([command]) => command), ['sync', 'list', 'read']);
});

test('canonical per-product names and roots cover TH06–11 and TH20, including multiplayer aliases', async t => {
  for (const [product, game, path] of [['th06', 'th06', 'score.dat'], ['th07mp', 'th07', 'score.dat'], ['th08', 'th08', 'score.dat'],
    ['th09mp', 'th09', 'score.dat'], ['th10', 'th10', 'scoreth10.dat'], ['th11', 'th11', 'scoreth11.dat'], ['th20', 'th20', 'scoreth20.dat']]) {
    const h = setup(t, {[path]: [9]}); h.change({game}); h.controller.loadProduct(product);
    assert.equal(h.state(product).saveRoot, `/saves${game}`);
    assert.equal((await h.controller.exportFile(product)).name, path);
    await h.controller.confirmImport(ticket(h, 'arbitrary.DAT', [5, 7], product));
    assert.equal(mutations(h)[0][1].path, path); assert.deepEqual([...h.persisted.get(path)], [5, 7]);
  }
});

test('replacement needs a genuine single-use confirmation bound to exact product, epoch and selected file', async t => {
  const h = setup(t, {'score.dat': [9]});
  const confirmation = ticket(h);
  assert.equal(confirmation.productId, 'th06'); assert.equal(confirmation.epoch, 1); assert.ok(Object.isFrozen(confirmation));
  assert.deepEqual(h.calls, [], 'selection and confirmation presentation do not read or write');
  await assert.rejects(h.controller.confirmImport({...confirmation}), /确认/);
  const cancelled = ticket(h); h.controller.cancelImport(cancelled); await assert.rejects(h.controller.confirmImport(cancelled), /确认/);
  await h.controller.confirmImport(confirmation);
  await assert.rejects(h.controller.confirmImport(confirmation), /确认/);
  assert.equal(mutations(h).length, 1); assert.deepEqual([...h.persisted.get('score.dat')], [1, 2, 255]);
});

test('successful import compares all bytes from a fresh owner, preserving unrelated files', async t => {
  const h = setup(t, {'score.dat': [9], 'th06.cfg': [6], 'replay/a.rpy': [7]});
  const before = h.files(); await h.controller.confirmImport(ticket(h));
  assert.notEqual(h.files(), before, 'restored memory is a new owner in this synthetic fixture');
  assert.deepEqual(h.calls.map(([command]) => command), ['sync', 'write', 'restart', 'read']);
  assert.equal(h.calls.at(-1)[2], 2); assert.equal(h.state().epoch, 2);
  assert.equal(h.state().loaded, true); assert.equal(h.state().size, 3); assert.match(h.state().notice, /核对全部字节/);
  assert.deepEqual([...h.persisted.get('th06.cfg')], [6]); assert.deepEqual([...h.persisted.get('replay/a.rpy')], [7]);
});

test('invalid names, empty/oversized files and changing input lengths cannot mutate the save', async t => {
  const h = setup(t, {'score.dat': [9]}, {limits: {importBytes: 20, fileBytes: 10}});
  for (const file of [upload('save.zip', [1]), upload('save.dat', []), upload('save.dat', new Uint8Array(11)), {...upload('save.dat', [1]), size: NaN}]) {
    assert.throws(() => h.controller.requestImport('th06', file));
  }
  const changed = h.controller.requestImport('th06', {...upload('save.dat', [1]), size: 2});
  await assert.rejects(h.controller.confirmImport(changed), /大小发生变化/);
  assert.deepEqual(mutations(h), []); assert.deepEqual([...h.persisted.get('score.dat')], [9]);
});

test('mutated file metadata and stale product/epoch confirmation fail before replacement', async t => {
  const h = setup(t, {'score.dat': [9]}), file = upload('save.dat', [1]);
  const changed = h.controller.requestImport('th06', file); file.name = 'other.dat';
  await assert.rejects(h.controller.confirmImport(changed), /文件已改变/);
  const stale = ticket(h); h.change({epoch: 2}); await assert.rejects(h.controller.confirmImport(stale), /会话已改变/);
  const other = ticket(h); h.change({game: 'th07'}); await assert.rejects(h.controller.confirmImport(other), /会话已改变/);
  assert.deepEqual(mutations(h), []); assert.equal(h.state().exists, null);
});

test('same-tick repeated imports, exports and cross-feature file work fail closed', async t => {
  const h = setup(t, {'score.dat': [9]}), gate = deferred();
  const first = h.controller.requestImport('th06', {name: 'one.dat', size: 1, arrayBuffer: () => gate.promise});
  const second = ticket(h); const task = h.controller.confirmImport(first);
  assert.equal(h.state().busy, 'import'); assert.equal(h.state().fileOperationBusy, true);
  await assert.rejects(h.controller.confirmImport(second), /等待/);
  await assert.rejects(h.controller.exportFile('th06'), /等待/);
  await assert.rejects(h.runtime.withFileSession('th06', async () => {}), /unavailable/);
  gate.resolve(Uint8Array.of(3).buffer); await task; assert.equal(mutations(h).length, 1);
  assert.equal(h.state().busy, null); assert.equal(h.state().fileOperationBusy, false);
  const external = deferred(), held = h.runtime.withFileSession('th06', () => external.promise);
  await assert.rejects(h.controller.refresh('th06'), /等待/); external.resolve(); await held;
});

test('terminal/replaced Runtime during local file decoding prevents late writes', async t => {
  const h = setup(t, {'score.dat': [9]}), gate = deferred();
  const confirmation = h.controller.requestImport('th06', {name: 'save.dat', size: 1, arrayBuffer: () => gate.promise});
  const task = h.controller.confirmImport(confirmation); await drain();
  h.change({phase: 'error', saveUnavailable: true, ready: false}); gate.resolve(Uint8Array.of(2).buffer);
  await assert.rejects(task, /会话已改变/); assert.deepEqual(mutations(h), []);
  assert.equal(h.state().available, false); assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null);
});

test('unsubscribing a dismissed view does not cancel an already accepted import', async t => {
  const h = setup(t), gate = deferred(); let notices = 0;
  const unsubscribe = h.controller.subscribe(() => notices++);
  const selected = h.controller.requestImport('th06', {name: 'save.dat', size: 1, arrayBuffer: () => gate.promise});
  const task = h.controller.confirmImport(selected); unsubscribe(); const atDetach = notices;
  gate.resolve(Uint8Array.of(3).buffer); await task;
  assert.equal(notices, atDetach); assert.equal(h.state().loaded, true); assert.deepEqual([...h.persisted.get('score.dat')], [3]);
});

test('dispose before decoded bytes stops an unstarted replacement and unsubscribes Runtime', async t => {
  const h = setup(t), gate = deferred();
  const selected = h.controller.requestImport('th06', {name: 'save.dat', size: 1, arrayBuffer: () => gate.promise});
  const task = h.controller.confirmImport(selected); await drain(); h.controller.dispose();
  gate.resolve(Uint8Array.of(3).buffer); await assert.rejects(task, /已关闭/);
  assert.deepEqual(mutations(h), []); assert.equal(h.listenerCount(), 0);
});

test('missing save is distinct from unavailable Runtime and offers import without guessing empty storage', async t => {
  const h = setup(t); await h.controller.refresh('th06');
  assert.equal(h.state().loaded, true); assert.equal(h.state().exists, false);
  await assert.rejects(h.controller.exportFile('th06'), /还没有存档/);
  h.change({phase: 'running', launched: true});
  await assert.rejects(h.controller.refresh('th06'), /结束游戏/);
  assert.equal(h.state().loaded, false); assert.equal(h.state().exists, null);
});

test('failure before writing leaves existing storage; ambiguous write or restore failure never claims success', async t => {
  for (const stage of ['sync', 'write', 'restart']) {
    const h = setup(t, {'score.dat': [9]}); h.override({[stage]: () => {throw new Error(`${stage} failed`);}});
    const task = h.controller.confirmImport(ticket(h));
    await assert.rejects(task, stage === 'sync' ? /sync failed/ : /可能已被替换/);
    assert.equal(h.state().notice, null); assert.equal(h.state().busy, null);
    if (stage === 'sync') {assert.deepEqual(mutations(h), []); assert.deepEqual([...h.persisted.get('score.dat')], [9]);}
  }
});

test('nonpersisted writes, different bytes, changed lengths, malformed data or reused owner fail verification', async t => {
  for (const mode of ['not-persisted', 'different-byte', 'different-length', 'malformed', 'same-owner']) {
    const h = setup(t, {'score.dat': [9]});
    h.override(mode === 'not-persisted' ? {write: payload => {h.files().set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};}}
      : mode === 'same-owner' ? {restart: epoch => ({epoch})}
        : {read: () => ({bytes: mode === 'different-byte' ? [1, 2, 254] : mode === 'different-length' ? [1, 2] : [1, 2, 256]})});
    await assert.rejects(h.controller.confirmImport(ticket(h)), /未通过重新载入校验/);
    assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null);
  }
});

test('malformed listings, invalid export bytes and sync failure invalidate stale metadata but allow retry', async t => {
  const h = setup(t, {'score.dat': [9]}); await h.controller.refresh('th06');
  for (const files of [null, [{path: 'score.dat', size: -1}], [{path: 'score.dat', size: 1}, {path: 'score.dat', size: 1}]]) {
    h.override({list: () => ({files})}); await assert.rejects(h.controller.refresh('th06'));
    assert.equal(h.state().loaded, false); assert.equal(h.state().exists, null);
  }
  h.override({read: () => ({bytes: [-1]})}); await assert.rejects(h.controller.exportFile('th06'), /内容无效/);
  h.override({sync: () => {throw new Error('sync failed');}}); await assert.rejects(h.controller.refresh('th06'), /sync failed/);
  assert.equal(h.state().loaded, false);
  h.override({}); await h.controller.refresh('th06'); assert.equal(h.state().error, null); assert.equal(h.state().exists, true);
});

test('view exposes truthful bounded import, backup, empty and unavailable states', async t => {
  const h = setup(t);
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SaveManagerView, {productId: 'th06', controller: h.controller, snapshot: h.state()})));
  h.change({phase: 'idle', ready: false, epoch: null}); let html = render();
  assert.match(html, /尚未准备 TH06/); assert.match(html, /不会判断存档的游戏版本兼容性/); assert.match(html, /64 MiB/);
  assert.match(html, /disabled/); assert.doesNotMatch(html, /此作品还没有存档/);
  h.change({phase: 'prepared', ready: true, epoch: 3}); await h.controller.refresh('th06'); html = render();
  assert.match(html, /此作品还没有存档/); assert.match(html, /导出存档/); assert.match(html, /选择存档导入/);
});
