/** Synthetic policy/owner tests; not real Runtime, IDBFS, browser or phone evidence. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync, unzipSync} from 'fflate';
import {deferred, upload, runtimeFixture} from './replay-service-fixture.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-replays-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: `
  export * from './app/services/replays.client.ts';
  export * from './app/components/ReplayManager.tsx';
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
const modulePath = join(directory, 'replays.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
const {createReplayController, ReplayManagerView, createElement, MemoryRouter, renderToStaticMarkup} = await import(pathToFileURL(modulePath).href);
function setup(t, initial = {}, options = {}) {
  const h = runtimeFixture(initial), controller = createReplayController({runtimeService: h.runtime, ...options});
  t.after(() => controller.dispose()); controller.loadProduct('th06'); return {...h, controller, state: () => controller.getSnapshot('th06')};
}
const paths = h => h.state().files.map(file => file.path);
const writes = h => h.calls.filter(([command]) => command === 'write' || command === 'remove');
async function drain() {for (let i = 0; i < 20; i++) await Promise.resolve();}

test('construction and snapshots have no I/O; list synchronizes through Runtime and filters saves/sidecars', async t => {
  const h = setup(t, {'score.dat': [9], 'replay/th6_01.rpyx': [1, 2], 'replay/th6_01.rpy.thprac.json': [5], 'replay/th6_02.rpy': [3]});
  assert.deepEqual(h.calls, []); assert.equal(h.state().loaded, false);
  await h.controller.refresh('th06');
  assert.deepEqual(h.calls.map(([command]) => command), ['sync', 'list']);
  assert.deepEqual(paths(h), ['replay/th6_01.rpyx', 'replay/th6_02.rpy']);
  assert.equal(h.state().files[0].size, 2); assert.ok(Object.isFrozen(h.state())); assert.ok(Object.isFrozen(h.state().files));
  h.controller.loadProduct('th06mp'); assert.equal(h.controller.getSnapshot('th06mp'), h.state());
});

test('single ReplayX import uses canonical collision allocation and preserves existing saves/replays', async t => {
  const h = setup(t, {'score.dat': [9], 'replay/TH6_01.RPYX': [7]});
  const result = await h.controller.importFile('th06', upload('th6_01.rpyx', [1, 2, 255]));
  assert.deepEqual(result, ['replay/th6_ud0000.rpyx']);
  assert.deepEqual([...h.files.get('replay/TH6_01.RPYX')], [7]); assert.deepEqual([...h.files.get('score.dat')], [9]);
  assert.deepEqual([...h.files.get(result[0])], [1, 2, 255]); assert.match(h.state().notice, /已导入 1/);
  assert.equal(h.state().busy, null); assert.equal(h.state().loaded, true);
});

test('ZIP import uses only Replay identities, safely renames collisions, and keeps formats', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [9]});
  const zip = zipSync({'backup/th6_01.rpy': Uint8Array.of(1), 'backup/another.rpyx': Uint8Array.of(2),
    'score.dat': Uint8Array.of(8), 'backup/th6_01.rpy.thprac.json': Uint8Array.of(5)});
  const result = await h.controller.importFile('th06', upload('backup.zip', zip));
  assert.deepEqual(result, ['replay/th6_ud0000.rpyx', 'replay/th6_ud0000.rpy']);
  assert.equal(h.files.has('score.dat'), false); assert.equal(h.files.has('backup/th6_01.rpy.thprac.json'), false);
  assert.deepEqual([...h.files.get('replay/th6_01.rpy')], [9]);
});

test('unsafe, duplicate-case and over-expanded ZIPs reject before any mutation', async t => {
  for (const entries of [
    {'../escape.rpy': Uint8Array.of(1)},
    {'A/th6_01.rpy': Uint8Array.of(1), 'a/TH6_01.RPY': Uint8Array.of(2)},
    {'a.rpy': new Uint8Array(12)},
    {'a.rpy': new Uint8Array(8), 'b.rpyx': new Uint8Array(8)},
    {'score.dat': Uint8Array.of(4)},
  ]) {
    const h = setup(t, {}, {limits: {fileBytes: 10, expandedBytes: 14}});
    await assert.rejects(h.controller.importFile('th06', upload('input.zip', zipSync(entries))));
    assert.deepEqual(writes(h), []); assert.equal(h.state().busy, null);
  }
});

test('invalid names, empty files, oversized data and changed byte lengths never write', async t => {
  const h = setup(t, {}, {limits: {importBytes: 20, fileBytes: 10}});
  for (const file of [upload('score.dat', [1]), upload('empty.rpy', []), upload('huge.rpy', new Uint8Array(21)),
    upload('large.rpy', new Uint8Array(11)), {...upload('changed.rpy', [1]), size: 2}]) {
    await assert.rejects(h.controller.importFile('th06', file));
  }
  assert.deepEqual(writes(h), []);
});

test('repeated imports fail closed and view unsubscription does not cancel accepted work', async t => {
  const h = setup(t), reading = deferred();
  let notices = 0; const detach = h.controller.subscribe(() => notices++);
  const first = h.controller.importFile('th06', {name: 'one.rpy', size: 1, arrayBuffer: () => reading.promise});
  assert.equal(h.state().busy, 'import');
  await assert.rejects(h.controller.importFile('th06', upload('two.rpy', [2])), /等待/);
  detach(); const atDetach = notices; reading.resolve(Uint8Array.of(1).buffer); await first;
  assert.equal(notices, atDetach); assert.equal(writes(h).length, 1); assert.equal(h.state().loaded, true);
});

test('a replaced Runtime blocks late decoding and clears old file rows', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [9]}), gate = deferred();
  const importing = h.controller.importFile('th06', {name: 'a.rpy', size: 1, arrayBuffer: () => gate.promise});
  await drain(); assert.equal(h.state().loaded, true);
  h.change({epoch: 2, game: 'th07'}); assert.equal(h.state().available, false); assert.deepEqual(paths(h), []);
  gate.resolve(Uint8Array.of(2).buffer); await assert.rejects(importing, /Session replaced/); assert.deepEqual(writes(h), []);
});

test('export reads exact Replay bytes and ZIP excludes score/config/sidecar data', async t => {
  const h = setup(t, {'score.dat': [9], 'replay/th6_01.rpy': [1, 2], 'replay/th6_02.rpyx': [255], 'replay/th6_01.rpy.thprac.json': [8]}, {now: () => new Date('2026-10-04T00:00:00Z')});
  const single = await h.controller.exportFile('th06', 'replay/th6_02.rpyx');
  assert.equal(single.name, 'th6_02.rpyx'); assert.deepEqual([...single.bytes], [255]);
  const result = await h.controller.exportAll('th06'); assert.equal(result.name, 'th06-replay-2026-10-04.zip');
  const entries = unzipSync(result.bytes); assert.deepEqual(Object.keys(entries), ['replay/th6_01.rpy', 'replay/th6_02.rpyx']);
  assert.deepEqual([...entries['replay/th6_01.rpy']], [1, 2]);
  await assert.rejects(h.controller.exportFile('th06', 'score.dat')); assert.deepEqual(writes(h), []);
});

test('delete requires a genuine single-use confirmation bound to file and Runtime epoch', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1], 'score.dat': [9]});
  await h.controller.refresh('th06');
  assert.throws(() => h.controller.requestDelete('th06', 'score.dat'));
  const cancelled = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.controller.cancelDelete(cancelled);
  await assert.rejects(h.controller.confirmDelete(cancelled), /确认/);
  const stale = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.change({epoch: 2});
  await assert.rejects(h.controller.confirmDelete(stale), /会话已改变/);
  await h.controller.refresh('th06'); const ticket = h.controller.requestDelete('th06', 'replay/th6_01.rpy');
  await assert.rejects(h.controller.confirmDelete({...ticket}), /确认/); assert.equal(h.files.has(ticket.path), true);
  await h.controller.confirmDelete(ticket); assert.equal(h.files.has(ticket.path), false); assert.equal(h.files.has('score.dat'), true);
  await assert.rejects(h.controller.confirmDelete(ticket), /确认/); assert.deepEqual(paths(h), []);
});

test('changed file and running Runtime invalidate deletion without removing user data', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  const changed = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.files.set(changed.path, Uint8Array.of(2, 3));
  await assert.rejects(h.controller.confirmDelete(changed), /信息已改变/);
  const running = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.change({phase: 'running', launched: true});
  await assert.rejects(h.controller.confirmDelete(running), /结束游戏/); assert.deepEqual(writes(h), []);
  await assert.rejects(h.controller.refresh('th06')); assert.equal(h.state().loaded, false);
});

test('partial import reports confirmed files and leaves unacknowledged outcomes for explicit refresh', async t => {
  const h = setup(t); let count = 0;
  h.override({write: async payload => {
    if (++count === 2) throw new Error('injected persistence failure');
    h.files.set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};
  }});
  const zip = zipSync({'a.rpy': Uint8Array.of(1), 'b.rpy': Uint8Array.of(2)});
  await assert.rejects(h.controller.importFile('th06', upload('input.zip', zip)), /已有 1 个录像获得保存确认/);
  assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null); assert.equal(h.files.size, 1);
  h.override({}); await h.controller.refresh('th06'); assert.equal(paths(h).length, 1);
});

test('malformed Runtime responses fail closed; the owner can retry after an error', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]});
  h.override({list: () => ({files: [{path: '../escape.rpy', size: 1}]})});
  await assert.rejects(h.controller.refresh('th06'), /文件信息无效/);
  h.override({list: () => ({files: [{path: 'replay/a.rpy', size: 1}, {path: 'REPLAY/A.RPY', size: 1}]})});
  await assert.rejects(h.controller.refresh('th06'), /文件信息无效/);
  h.override({read: () => ({bytes: [1, -1]})});
  await assert.rejects(h.controller.exportFile('th06', 'replay/th6_01.rpy'), /内容无效/);
  h.override({}); await h.controller.refresh('th06'); assert.equal(h.state().error, null);
});

test('view clearly distinguishes unavailable storage, empty list and unimplemented playback', async t => {
  const h = setup(t); h.change({phase: 'idle', epoch: null, ready: false});
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReplayManagerView, {productId: 'th06', controller: h.controller, snapshot: h.state()})));
  let html = render(); assert.match(html, /尚未准备 TH06/); assert.match(html, /录像播放尚未接入/); assert.match(html, /disabled/); assert.doesNotMatch(html, /此作品还没有录像/);
  h.change({phase: 'prepared', epoch: 3, ready: true}); await h.controller.refresh('th06');
  html = render(); assert.match(html, /此作品还没有录像/); assert.match(html, /导出全部 ZIP/);
});

test('sync failure does not present an old list as current or falsely claim empty storage', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  assert.equal(h.state().loaded, true);
  h.override({sync: async () => {throw new Error('sync failed');}});
  await assert.rejects(h.controller.refresh('th06'), /sync failed/);
  assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null);
  h.override({}); await h.controller.refresh('th06'); assert.deepEqual(paths(h), ['replay/th6_01.rpy']);
});
