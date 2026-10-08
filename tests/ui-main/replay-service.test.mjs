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
const {createReplayController, ReplayFilesMissingError, ReplayManagerView, createElement, MemoryRouter, renderToStaticMarkup} = await import(pathToFileURL(modulePath).href);
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
  h.controller.loadProduct('th06mp');
  assert.notEqual(h.controller.getSnapshot('th06mp'), h.state());
  assert.equal(h.controller.getSnapshot('th06mp').runtimeVariant, 'multiplayer');
  assert.equal(h.controller.getSnapshot('th06mp').available, false);
  await assert.rejects(h.controller.refresh('th06mp'), /普通\/多人文件身份/);
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

test('settings-row Replay download prepares once, exports existing files and never starts the game', async t => {
  const h = runtimeFixture({'replay/th6_01.rpy': [1, 2, 3]}); h.change({phase: 'idle', game: null, epoch: null, ready: false, launched: false}); let preparations = 0;
  const controller = createReplayController({runtimeService: h.runtime, prepareProduct: async product => {
    assert.equal(product, 'th06'); preparations++; h.change({phase: 'prepared', game: 'th06', epoch: 8, ready: true, launched: false});
  }});
  t.after(() => controller.dispose()); controller.loadProduct('th06');
  const result = await controller.exportAll('th06');
  assert.equal(result.name.startsWith('th06-replay-'), true); assert.equal(preparations, 1);
  assert.equal(h.runtime.getSnapshot().phase, 'idle'); assert.equal(h.runtime.getSnapshot().launched, false);
  assert.deepEqual(h.calls.map(([command]) => command), ['sync', 'list', 'read', 'close']);
});

test('temporary missing-Replay export retires its owner, but a running read-only export keeps its owner', async t => {
  const temporary = runtimeFixture(); temporary.change({phase: 'idle', game: null, epoch: null, ready: false, launched: false});
  const controller = createReplayController({runtimeService: temporary.runtime, prepareProduct: async () => {
    temporary.change({phase: 'prepared', game: 'th06', epoch: 9, ready: true, launched: false});
  }});
  t.after(() => controller.dispose()); controller.loadProduct('th06');
  await assert.rejects(controller.exportAll('th06'), ReplayFilesMissingError);
  assert.equal(temporary.runtime.getSnapshot().phase, 'idle');
  assert.equal(controller.getSnapshot('th06').error, null, 'an expected empty-library result is not an operation failure');
  assert.deepEqual(temporary.calls.map(([command]) => command), ['sync', 'list', 'close']);

  const running = runtimeFixture({'replay/th6_01.rpy': [1, 2]}); running.change({phase: 'running', launched: true});
  const readOnly = createReplayController({runtimeService: running.runtime});
  t.after(() => readOnly.dispose()); readOnly.loadProduct('th06');
  const result = await readOnly.exportAll('th06');
  assert.equal(result.name.startsWith('th06-replay-'), true);
  assert.equal(running.runtime.getSnapshot().phase, 'running');
  assert.equal(running.calls.some(([command]) => command === 'close'), false);
});

test('Replay management operations prepare before acquiring the same Runtime file session', async t => {
  const h = runtimeFixture(); h.change({phase: 'idle', game: null, epoch: null, ready: false, launched: false}); let preparations = 0;
  const controller = createReplayController({runtimeService: h.runtime, prepareProduct: async () => {
    preparations++; h.change({phase: 'prepared', game: 'th06', epoch: 5, ready: true, launched: false});
  }});
  t.after(() => controller.dispose()); controller.loadProduct('th06');
  await controller.prepareFiles('th06');
  await controller.importFile('th06', upload('th6_01.rpyx', [8, 9]));
  assert.equal(preparations, 1); assert.deepEqual([...h.files.get('replay/th6_01.rpyx')], [8, 9]);
  assert.equal(h.runtime.getSnapshot().launched, false);
});

test('delete requires a genuine single-use confirmation bound to file and Runtime epoch', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1], 'score.dat': [9]});
  await h.controller.refresh('th06');
  assert.throws(() => h.controller.requestDelete('th06', 'score.dat'));
  const cancelled = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.controller.cancelDelete(cancelled);
  await assert.rejects(h.controller.confirmDelete(cancelled), /确认/);
  const stale = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.change({epoch: 2});
  await assert.rejects(h.controller.confirmDelete(stale), /文件身份已改变/);
  await h.controller.refresh('th06'); const ticket = h.controller.requestDelete('th06', 'replay/th6_01.rpy');
  await assert.rejects(h.controller.confirmDelete({...ticket}), /确认/); assert.equal(h.files.has(ticket.path), true);
  await h.controller.confirmDelete(ticket); assert.equal(h.files.has(ticket.path), false); assert.equal(h.files.has('score.dat'), true);
  await assert.rejects(h.controller.confirmDelete(ticket), /确认/); assert.deepEqual(paths(h), []);
});

test('changed Replay metadata or a refused running-owner close leaves user data intact', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  const changed = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.files.set(changed.path, Uint8Array.of(2, 3));
  await assert.rejects(h.controller.confirmDelete(changed), /信息已改变/);
  const running = h.controller.requestDelete('th06', 'replay/th6_01.rpy'); h.change({phase: 'running', launched: true});
  h.setCloseResult(false);
  await assert.rejects(h.controller.confirmDelete(running), /安全保存并退出/); assert.deepEqual(writes(h), []);
  await h.controller.refresh('th06'); assert.equal(h.state().loaded, true); assert.deepEqual(writes(h), []);
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
  html = render(); assert.match(html, /此作品还没有录像/); assert.match(html, /导出全部 ZIP/); assert.match(html, /导入录像/);
  const exportButton = html.slice(html.lastIndexOf('<button', html.indexOf('导出全部 ZIP')), html.indexOf('导出全部 ZIP'));
  assert.doesNotMatch(exportButton, /\sdisabled(?:\s|=|>)/);
});

test('sync failure does not present an old list as current or falsely claim empty storage', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  assert.equal(h.state().loaded, true);
  h.override({sync: async () => {throw new Error('sync failed');}});
  await assert.rejects(h.controller.refresh('th06'), /sync failed/);
  assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null);
  h.override({}); await h.controller.refresh('th06'); assert.deepEqual(paths(h), ['replay/th6_01.rpy']);
});

test('rename reuses canonical product filenames and preserves exact bytes under one Runtime session', async t => {
  for (const name of ['th6_02.rpy', 'TH6_udBEEF.RPYX']) {
    const h = setup(t, {'replay/th6_01.rpy': [0, 128, 255], 'score.dat': [9], 'replay/th6_01.rpy.thprac.json': [7]});
    await h.controller.refresh('th06');
    const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy');
    assert.equal(ticket.prefix, 'th6'); assert.equal(ticket.epoch, 1); assert.ok(Object.isFrozen(ticket));
    const offset = h.calls.length;
    const result = await h.controller.renameFile(ticket, ` ${name} `);
    assert.equal(result, name);
    assert.deepEqual(h.calls.slice(offset).map(([command]) => command), ['sync', 'list', 'read', 'write', 'remove', 'sync', 'list']);
    assert.deepEqual([...h.files.get(`replay/${name}`)], [0, 128, 255]);
    assert.equal(h.files.has(ticket.path), false);
    assert.deepEqual([...h.files.get('score.dat')], [9]); assert.deepEqual([...h.files.get('replay/th6_01.rpy.thprac.json')], [7]);
    assert.deepEqual(h.state().notice, {key: 'react.replays.renamed', params: {name}});
    assert.equal(h.state().busy, null); assert.equal(h.state().fileOperationBusy, false); assert.equal(h.state().loaded, true);
    await assert.rejects(h.controller.renameFile(ticket, 'th6_03.rpy'), /renameRefresh/);
  }
});

test('rename rejects invalid product names and paths without I/O; a draft can correct its name', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy'), offset = h.calls.length;
  for (const name of ['', '   ', 'th7_02.rpy', 'th6_custom.rpy', '../th6_02.rpy', 'replay/th6_02.rpy', 'th6_02.rpy/child', 'th6_02.rpy.thprac.json', 'th6_02.dat', 'th6_02.rpy\0']) {
    await assert.rejects(h.controller.renameFile(ticket, name), /replay.name(?:Empty|Invalid)/);
  }
  assert.equal(h.calls.length, offset); assert.deepEqual(writes(h), []);
  await h.controller.renameFile(ticket, 'th6_02.rpy'); assert.deepEqual(paths(h), ['replay/th6_02.rpy']);
});

test('rename rechecks collisions at acceptance and refuses overwrites case-insensitively', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy');
  h.files.set('REPLAY/TH6_02.RPY', Uint8Array.of(9));
  await assert.rejects(h.controller.renameFile(ticket, 'th6_02.rpy'), /replay.nameExists/);
  assert.deepEqual(writes(h), []); assert.deepEqual([...h.files.get('REPLAY/TH6_02.RPY')], [9]);
  await h.controller.renameFile(ticket, 'th6_03.rpy');
  assert.deepEqual([...h.files.get('replay/th6_03.rpy')], [1]);
});

test('same-name and case-only rename are no-ops and do not rewrite the source', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
  const result = await h.controller.renameFile(h.controller.requestRename('th06', 'replay/th6_01.rpy'), ' TH6_01.RPY ');
  assert.equal(result, 'th6_01.rpy'); assert.deepEqual(writes(h), []); assert.equal(h.state().notice, null);
});

test('rename requires a live genuine draft and blocks cancellation, forgery and replacement epochs', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1], 'score.dat': [9]}); await h.controller.refresh('th06');
  assert.throws(() => h.controller.requestRename('th06', 'score.dat'), /renameRefresh/);
  const cancelled = h.controller.requestRename('th06', 'replay/th6_01.rpy'); h.controller.cancelRename(cancelled);
  await assert.rejects(h.controller.renameFile(cancelled, 'th6_02.rpy'), /renameRefresh/);
  const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy');
  await assert.rejects(h.controller.renameFile({...ticket}, 'th6_02.rpy'), /renameRefresh/);
  h.change({epoch: 2}); await assert.rejects(h.controller.renameFile(ticket, 'th6_02.rpy'), /sessionChanged/);
  assert.deepEqual(writes(h), []); assert.equal(h.state().loaded, false);
});

test('missing, changed and oversized source metadata or changed read length cannot rename', async t => {
  for (const mode of ['missing', 'changed', 'oversized', 'bytes']) {
    const h = setup(t, {'replay/th6_01.rpy': mode === 'oversized' ? [1, 2] : [1]}, {limits: {fileBytes: 1}});
    await h.controller.refresh('th06'); const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy');
    if (mode === 'missing') h.files.delete(ticket.path);
    if (mode === 'changed') h.files.set(ticket.path, Uint8Array.of(1, 2));
    if (mode === 'bytes') h.override({read: () => ({bytes: []})});
    await assert.rejects(h.controller.renameFile(ticket, 'th6_02.rpy'), /renameChanged/);
    assert.deepEqual(writes(h), []);
  }
});

test('rename acquires the shared file lock immediately; repeated clicks and competing file owners cannot queue writes', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}), gate = deferred(); await h.controller.refresh('th06');
  const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy');
  h.override({read: () => gate.promise});
  const task = h.controller.renameFile(ticket, 'th6_02.rpy');
  assert.equal(h.state().busy, 'rename'); assert.equal(h.state().fileOperationBusy, true);
  await assert.rejects(h.controller.renameFile(ticket, 'th6_03.rpy'), /等待/);
  await assert.rejects(h.runtime.withFileSession('th06', async () => {}), /unavailable/);
  assert.throws(() => h.controller.requestRename('th06', ticket.path), /renameRefresh/);
  assert.throws(() => h.controller.requestDelete('th06', ticket.path), /重新读取/);
  gate.resolve({bytes: [1]}); await task; assert.equal(writes(h).length, 2);
  const externalGate = deferred(), external = h.runtime.withFileSession('th06', () => externalGate.promise);
  assert.equal(h.state().fileOperationBusy, true);
  await assert.rejects(h.controller.refresh('th06'), /等待/);
  assert.throws(() => h.controller.requestRename('th06', 'replay/th6_02.rpy'), /renameRefresh/);
  externalGate.resolve(); await external; assert.equal(h.state().fileOperationBusy, false);
});

test('accepted rename survives view dismissal but its cancelled draft cannot accept new work', async t => {
  const h = setup(t, {'replay/th6_01.rpy': [1]}), gate = deferred(); await h.controller.refresh('th06');
  const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy'); h.override({read: () => gate.promise});
  const task = h.controller.renameFile(ticket, 'th6_02.rpy'); await drain(); h.controller.cancelRename(ticket);
  gate.resolve({bytes: [1]}); await task;
  assert.deepEqual(paths(h), ['replay/th6_02.rpy']);
  await assert.rejects(h.controller.renameFile(ticket, 'th6_03.rpy'), /renameRefresh/);
});

test('Runtime replacement during read or write cannot remove the source or publish success', async t => {
  for (const stage of ['read', 'write']) {
    const h = setup(t, {'replay/th6_01.rpy': [1]}), gate = deferred(); await h.controller.refresh('th06');
    const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy'); h.override({[stage]: () => gate.promise});
    const task = h.controller.renameFile(ticket, 'th6_02.rpy'); await drain(); h.change({epoch: 2});
    gate.resolve(stage === 'read' ? {bytes: [1]} : {ok: true}); await assert.rejects(task);
    assert.equal(h.calls.some(([command]) => command === 'remove'), false); assert.equal(h.files.has(ticket.path), true);
    assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null); assert.deepEqual(paths(h), []);
  }
});

test('write failure preserves the source; remove or final refresh failure reports partial work and requires rereading', async t => {
  for (const stage of ['write', 'remove', 'refresh']) {
    const h = setup(t, {'replay/th6_01.rpy': [1]}); await h.controller.refresh('th06');
    const ticket = h.controller.requestRename('th06', 'replay/th6_01.rpy'); let syncs = 0;
    h.override(stage === 'refresh' ? {sync: () => {if (++syncs > 1) throw new Error('refresh failed');}}
      : {[stage]: () => {throw new Error(`${stage} failed`);}});
    await assert.rejects(h.controller.renameFile(ticket, 'th6_02.rpy'), stage === 'write' ? /renameWriteUnconfirmed/ : /renameRemoveUnconfirmed/);
    assert.equal(h.state().loaded, false); assert.equal(h.state().notice, null); assert.equal(h.state().busy, null);
    assert.equal(h.files.has(ticket.path), stage !== 'refresh');
    assert.equal(h.files.has('replay/th6_02.rpy'), stage !== 'write');
    if (stage === 'write') assert.equal(h.calls.some(([command]) => command === 'remove'), false);
    h.override({}); await h.controller.refresh('th06'); assert.equal(h.state().loaded, true);
  }
});
