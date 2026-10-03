import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'eagler-replay-ui-'));
try {
  const entry = resolve(temporary, 'replay-files.mjs');
  await build({ entryPoints: [resolve(root, 'app/services/replay-files.client.ts')], outfile: entry,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
  const { createReplayFileService } = await import(pathToFileURL(entry).href);
  const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const preferences = () => ({ language: 'lang_en', music: 'ogg-stream', options: { touchEnabled: true } });
  function fake({ product = null, launched = false, ready = false } = {}) {
    const files = new Map(); const calls = []; let epoch = ready ? 1 : 0;
    let snapshot = { phase: launched ? 'running' : ready ? 'prepared' : 'idle', productId: product, epoch: ready ? epoch : null, ready, launched };
    const runtime = {
      getSnapshot: () => snapshot,
      set: patch => { snapshot = { ...snapshot, ...patch }; },
      prepare: async request => { calls.push(['prepare', request]); snapshot = { phase: 'prepared', productId: request.productId, epoch: ++epoch, ready: true, launched: false }; return snapshot; },
      launch: async request => { calls.push(['launch', request]); snapshot = { phase: 'running', productId: request.productId, epoch: ++epoch, ready: true, launched: true }; return snapshot; },
      close: async () => { calls.push(['close']); snapshot = { ...snapshot, phase: 'idle', epoch: null, ready: false, launched: false }; },
      sync: async () => { calls.push(['sync']); },
      list: async () => { calls.push(['list']); return { files: [...files].map(([path, bytes]) => ({ path, size: bytes.length })) }; },
      read: async path => { calls.push(['read', path]); if (!files.has(path)) throw new Error('missing'); return new Uint8Array(files.get(path)); },
      write: async (path, bytes) => { calls.push(['write', path]); files.set(path, new Uint8Array(bytes)); return {}; },
      remove: async path => { calls.push(['remove', path]); files.delete(path); return {}; },
    };
    return { runtime, calls, files };
  }
  const serviceFor = (runtime, productId = 'th06', confirm = async () => true) => createReplayFileService({ runtime, productId, getLaunchRequest: preferences, confirm });
  let passed = 0;
  async function scenario(name, test) { await test(); passed++; console.log(`PASS ${name}`); }

  await scenario('list prepares exact MP product and filters user Replay identities', async () => {
    const { runtime, calls, files } = fake(); files.set('replay/th7_01.rpy', strToU8('a')); files.set('score.dat', strToU8('score'));
    const service = serviceFor(runtime, 'th07mp'); const rows = await service.list();
    assert.deepEqual(rows, [{ path: 'replay/th7_01.rpy', size: 1 }]);
    assert.deepEqual(calls[0][1], { ...preferences(), productId: 'th07mp', replayViewer: true, music: 'none' });
    await service.dispose(); assert.equal(calls.at(-1)[0], 'close');
  });
  await scenario('different running game cannot be silently switched', async () => {
    const { runtime, calls } = fake({ product: 'th07', ready: true, launched: true }); let request;
    const service = serviceFor(runtime, 'th06', async value => { request = value; return false; });
    await assert.rejects(service.list(), /未切换/);
    assert.equal(request.kind, 'close-runtime'); assert.equal(request.productId, 'th07'); assert.equal(calls.length, 0);
    await service.dispose(); assert.equal(runtime.getSnapshot().launched, true);
  });
  await scenario('delayed save-close confirmation cannot close a newer epoch', async () => {
    const { runtime, calls } = fake({ product: 'th07', ready: true, launched: true }); const decision = defer();
    const service = serviceFor(runtime, 'th06', () => decision.promise); const loading = service.list(); await Promise.resolve();
    runtime.set({ epoch: 88, productId: 'th08' }); decision.resolve(true);
    await assert.rejects(loading, { name: 'AbortError' }); assert.equal(calls.length, 0);
  });
  await scenario('late file response is rejected after session replacement', async () => {
    const { runtime, files } = fake({ product: 'th06', ready: true }); files.set('replay/th6_01.rpy', strToU8('old'));
    const service = serviceFor(runtime); await service.list(); const response = defer(); const started = defer();
    runtime.read = async () => { started.resolve(); return response.promise; };
    const exportFile = service.exportOne('replay/th6_01.rpy'); await started.promise;
    runtime.set({ epoch: 7 }); response.resolve(strToU8('old'));
    await assert.rejects(exportFile, { name: 'AbortError' });
  });
  await scenario('concurrent imports allocate distinct slots and synchronize each write', async () => {
    const { runtime, files, calls } = fake({ product: 'th06', ready: true }); files.set('replay/th6_01.rpy', strToU8('existing'));
    const service = serviceFor(runtime); await service.list();
    await Promise.all([service.importFile(new File(['first'], 'th6_01.rpy')), service.importFile(new File(['second'], 'th6_01.rpy'))]);
    assert.equal(new TextDecoder().decode(files.get('replay/th6_ud0000.rpy')), 'first');
    assert.equal(new TextDecoder().decode(files.get('replay/th6_ud0001.rpy')), 'second');
    const firstWrite = calls.findIndex(call => call[0] === 'write');
    assert.deepEqual(calls.slice(firstWrite, firstWrite + 3).map(call => call[0]), ['write', 'sync', 'read']);
  });
  await scenario('separate mounted views share one allocation and mutation queue', async () => {
    const { runtime, files } = fake({ product: 'th06', ready: true });
    const first = serviceFor(runtime), second = serviceFor(runtime); await first.list(); await second.list();
    await Promise.all([first.importFile(new File(['one'], 'th6_01.rpy')), second.importFile(new File(['two'], 'th6_01.rpy'))]);
    assert.equal(files.size, 2); assert.equal(new TextDecoder().decode(files.get('replay/th6_01.rpy')), 'one');
    assert.equal(new TextDecoder().decode(files.get('replay/th6_ud0000.rpy')), 'two');
  });
  await scenario('StrictMode-style immediate dispose and recreation preserves new preparation', async () => {
    const { runtime } = fake(); const first = serviceFor(runtime); const abandoned = first.list();
    void abandoned.catch(() => {}); const closing = first.dispose();
    const second = serviceFor(runtime); const listing = second.list();
    await assert.rejects(abandoned, { name: 'AbortError' }); await closing; await listing;
    assert.equal(runtime.getSnapshot().ready, true); await second.dispose(); assert.equal(runtime.getSnapshot().ready, false);
  });
  await scenario('guarded ZIP import retains extensions and excludes non-Replay data', async () => {
    const { runtime, files } = fake({ product: 'th06', ready: true }); const service = serviceFor(runtime); await service.list();
    const archive = zipSync({ 'nested/record.rpyx': strToU8('motion'), 'th6_02.rpy': strToU8('retail'), 'score.dat': strToU8('ignore') });
    assert.equal(await service.importFile(new File([archive], 'replays.zip')), 2);
    assert.equal(files.size, 2); assert.ok([...files.keys()].some(path => path.endsWith('.rpyx'))); assert.equal(files.has('score.dat'), false);
    const exported = await service.exportArchive(); const unpacked = unzipSync(exported.bytes);
    assert.deepEqual(Object.keys(unpacked).sort(), [...files.keys()].sort());
  });
  await scenario('unsafe archive, duplicate paths and invalid data fail before writes', async () => {
    const { runtime, files } = fake({ product: 'th06', ready: true }); const service = serviceFor(runtime); await service.list();
    await assert.rejects(service.importFile(new File([zipSync({ '../bad.rpy': strToU8('a') })], 'bad.zip')), /unsafe-path/);
    await assert.rejects(service.importFile(new File([zipSync({ 'same.rpy': strToU8('a'), 'SAME.RPY': strToU8('b') })], 'duplicates.zip')), /duplicate-path/);
    await assert.rejects(service.importFile(new File([], 'empty.rpy')), /128 MiB/);
    await assert.rejects(service.importFile(new File(['abc'], 'score.dat')), /请选择/);
    assert.equal(files.size, 0);
  });
  await scenario('rename replacement requires confirmation and durable verification before remove', async () => {
    const { runtime, files, calls } = fake({ product: 'th06', ready: true }); files.set('replay/th6_01.rpy', strToU8('first')); files.set('replay/TH6_02.RPY', strToU8('second'));
    let accept = false; let decision;
    const service = serviceFor(runtime, 'th06', async request => { decision = request; return accept; }); await service.list();
    await service.rename('replay/th6_01.rpy', 'th6_02.rpy'); assert.equal(decision.kind, 'replace'); assert.equal(files.size, 2);
    accept = true; calls.length = 0; await service.rename('replay/th6_01.rpy', 'th6_02.rpy');
    assert.equal(files.size, 1); assert.equal(new TextDecoder().decode(files.get('replay/TH6_02.RPY')), 'first');
    assert.deepEqual(calls.slice(calls.findIndex(call => call[0] === 'write')).map(call => call[0]), ['write', 'sync', 'read', 'remove', 'sync']);
  });
  await scenario('failed renamed-file verification leaves original intact', async () => {
    const { runtime, files } = fake({ product: 'th06', ready: true }); files.set('replay/th6_01.rpy', strToU8('source'));
    const service = serviceFor(runtime); await service.list();
    const read = runtime.read; runtime.read = async path => path === 'replay/th6_02.rpy' ? strToU8('corrupt') : read(path);
    await assert.rejects(service.rename('replay/th6_01.rpy', 'th6_02.rpy'), /校验失败/); assert.equal(files.has('replay/th6_01.rpy'), true);
  });
  await scenario('delete requires confirmation and sync; stale confirmation cannot mutate new game', async () => {
    const { runtime, files, calls } = fake({ product: 'th06', ready: true }); files.set('replay/th6_01.rpy', strToU8('save'));
    let accept = false; const service = serviceFor(runtime, 'th06', async () => accept); await service.list();
    await service.remove('replay/th6_01.rpy'); assert.equal(files.size, 1);
    accept = true; await service.remove('replay/th6_01.rpy'); assert.equal(files.size, 0); assert.deepEqual(calls.slice(-2).map(call => call[0]), ['remove', 'sync']);
    files.set('replay/th6_01.rpy', strToU8('new')); const delayed = defer(); const other = serviceFor(runtime, 'th06', () => delayed.promise); await other.list();
    const removing = other.remove('replay/th6_01.rpy'); await Promise.resolve(); runtime.set({ epoch: 55 }); delayed.resolve(true);
    await assert.rejects(removing, { name: 'AbortError' }); assert.equal(files.size, 1);
  });
  await scenario('live same-product mutation first obtains save-close approval', async () => {
    const { runtime, calls, files } = fake({ product: 'th06', ready: true, launched: true });
    let accept = false; const service = serviceFor(runtime, 'th06', async request => { assert.equal(request.kind, 'close-runtime'); return accept; }); await service.list();
    await assert.rejects(service.importFile(new File(['replay'], 'th6_01.rpy')), /未修改/); assert.equal(files.size, 0);
    accept = true; await service.importFile(new File(['replay'], 'th6_01.rpy'));
    assert.ok(calls.findIndex(call => call[0] === 'close') < calls.findIndex(call => call[0] === 'prepare')); assert.equal(files.size, 1);
  });
  await scenario('temporary Runtime lease is retained by a replacement view and never closes a newer game', async () => {
    const { runtime, calls } = fake(); const first = serviceFor(runtime); await first.list();
    const second = serviceFor(runtime); await second.list(); await first.dispose(); assert.equal(calls.some(call => call[0] === 'close'), false);
    runtime.set({ epoch: 77, launched: true, productId: 'th07' }); await second.dispose();
    assert.equal(calls.some(call => call[0] === 'close'), false);
  });
  await scenario('panel disposal waits for mutation durability before temporary Runtime teardown', async () => {
    const { runtime, calls } = fake(); const service = serviceFor(runtime); await service.list();
    const block = defer(), entered = defer(); const write = runtime.write;
    runtime.write = async (...args) => { entered.resolve(); await block.promise; return write(...args); };
    const importing = service.importFile(new File(['content'], 'th6_01.rpy')); await entered.promise;
    const disposing = service.dispose(); assert.equal(calls.some(call => call[0] === 'close'), false);
    block.resolve(); await importing; await disposing;
    assert.deepEqual(calls.slice(-4).map(call => call[0]), ['write', 'sync', 'read', 'close']);
  });
  await scenario('MP Replay startup uses exact product without room configure options', async () => {
    const { runtime, calls } = fake(); const service = serviceFor(runtime, 'th07mp'); await service.list();
    const result = await service.play(); const request = calls.find(call => call[0] === 'launch')[1];
    assert.equal(request.productId, 'th07mp'); assert.equal(request.replayViewer, true); assert.equal(request.configureOptions, undefined);
    assert.equal(request.music, 'ogg-stream'); assert.equal(result.launched, true);
    const closes = calls.filter(call => call[0] === 'close').length; await service.dispose(); assert.equal(calls.filter(call => call[0] === 'close').length, closes);
  });
  console.log(`Replay service: ${passed} scenarios PASS`);
} finally { await rm(temporary, { recursive: true, force: true }); }
