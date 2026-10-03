// Job-lifecycle tests. Package Store atomicity remains in its real IndexedDB browser lane.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'eagler-package-jobs-'));
try {
  const entry = resolve(temporary, 'package-tasks.mjs');
  await build({ entryPoints: [resolve(root, 'app/services/package-tasks.client.ts')], outfile: entry,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'authored-contracts', setup(plugin) {
      plugin.onResolve({ filter: /^\./ }, args => {
        const path = resolve(args.resolveDir, args.path);
        const facade = /^(?:lib\/contracts\/)?(product-catalog|release-catalog|runtime-protocol|host-manifest|resource-mode)\.mjs$/.exec(path.slice(root.length + 1));
        if (facade) return { path: resolve(root, `src/contracts/${facade[1]}.mts`) };
        const authored = path.replace(/\.mjs$/, '.mts');
        if (path.startsWith(resolve(root, 'src') + '/') && existsSync(authored)) return { path: authored };
      });
    } }],
  });
  const { createPackageTaskService } = await import(pathToFileURL(entry).href);
  const baseUrl = 'https://launcher.example/mount/';
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const descriptor = (game = 'th06', extra = {}) => ({
    schema: 'eagler-touhou/package/1', game, revision: 'revision-1',
    runtimeRequirement: { protocol: 'eagler-touhou/1', target: game, dataFile: 'game-data', dataLayout: 'retail-memory' },
    files: { 'game-data': { revision: 'data-1', source: `${game}.data`, target: `/${game}.data`, bytes: 3 }, ...extra },
    base: { files: ['game-data', ...Object.keys(extra)] }, components: {},
  });
  const parsed = game => ({ descriptor: descriptor(game), files: new Map([['game-data', { blob: new Blob(['abc']) }]]) });
  const installed = value => ({ installation: { game: value.descriptor.game, source: 'local', currentGeneration: 'generation-1', pendingGeneration: null },
    generation: { id: 'generation-1', game: value.descriptor.game, descriptor: value.descriptor, files: { 'game-data': { objectId: 'object-1', revision: 'data-1' } } } });
  const zip = game => new Blob([zipSync({ 'package.json': strToU8(JSON.stringify(descriptor(game))), [`${game}.data`]: strToU8('abc') }, { level: 0 })]);
  let checked = 0;
  async function scenario(name, test) { await test(); checked++; console.log(`PASS ${name}`); }

  await scenario('canonical parser and installer reused; panel unsubscription does not cancel', async () => {
    const completion = deferred();
    let installation;
    const service = createPackageTaskService({ baseUrl, dependencies: { installParsedPackageZip: async (value, options) => {
      installation = value;
      options.onProgress({ completed: 1, total: 1, fileId: 'game-data', found: true });
      await completion.promise;
      return installed(value);
    } } });
    let notifications = 0;
    const unsubscribe = service.subscribe(() => notifications++);
    const handle = service.startImport({ game: 'th06', file: zip('th06') });
    // Wait for real ZIP parsing before simulating panel dismissal.
    while (!installation) await new Promise(resolve => setImmediate(resolve));
    const during = service.getSnapshot();
    assert.equal(during[0].phase, 'installing'); assert.equal(during[0].cancellable, false);
    assert.equal(during[0].progress.completed, 1); assert.equal(service.cancel(handle.id), false);
    assert.equal(service.dismiss(handle.id), false); assert.throws(() => service.startImport({ game: 'th06', file: zip('th06') }), /active package/);
    unsubscribe(); const before = notifications; completion.resolve(); await handle.done;
    assert.equal(notifications, before); assert.equal(service.getSnapshot()[0].status, 'completed');
    assert.equal(service.getSnapshot()[0].generationId, 'generation-1');
    assert.equal(during[0].status, 'running', 'snapshots remain immutable');
    assert.equal(await installation.files.get('game-data').blob.text(), 'abc');
    assert.equal(service.dismiss(handle.id), true); assert.equal(service.getSnapshot().length, 0);
  });

  await scenario('published signal, selections, progress and explicit cancellation', async () => {
    let received;
    const waiting = deferred();
    const service = createPackageTaskService({ baseUrl, dependencies: { installPublishedPackage: async (game, options) => {
      received = options;
      options.onProgress({ completed: 2, total: 5, fileId: 'ogg-1', found: true });
      options.signal.addEventListener('abort', () => waiting.reject(abortError()), { once: true });
      return waiting.promise;
    } } });
    const selected = ['english'];
    const handle = service.startPublished({ game: 'th06', catalog: { games: {} }, selectedComponentEntries: { language: selected } });
    selected.push('chinese'); await Promise.resolve();
    assert.equal(received.catalogUrl, `${baseUrl}release-catalog.json`);
    assert.deepEqual(received.selectedComponentEntries.language, ['english']);
    assert.equal(service.getSnapshot()[0].progress.total, 5);
    assert.equal(service.cancel(handle.id), true); assert.equal(received.signal.aborted, true);
    assert.equal(service.cancel(handle.id), false);
    await assert.rejects(handle.done, { name: 'AbortError' });
    assert.equal(service.getSnapshot()[0].status, 'cancelled'); assert.equal(service.getSnapshot()[0].error, null);
  });

  await scenario('completed atomic commit wins a late cancellation', async () => {
    const completion = deferred();
    const service = createPackageTaskService({ baseUrl, dependencies: { installPublishedPackage: () => completion.promise } });
    const handle = service.startPublished({ game: 'th06', catalog: {} }); await Promise.resolve();
    completion.resolve(installed(parsed('th06'))); service.cancel(handle.id);
    await handle.done; assert.equal(service.getSnapshot()[0].status, 'completed');
  });

  await scenario('cancel during parse never starts storage installation', async () => {
    const parsing = deferred(); let calls = 0;
    const service = createPackageTaskService({ baseUrl, dependencies: { parsePackageZip: () => parsing.promise,
      installParsedPackageZip: async value => { calls++; return installed(value); } } });
    const handle = service.startImport({ game: 'th06', file: new Blob(['zip']) }); await Promise.resolve();
    service.cancel(handle.id); parsing.resolve(parsed('th06'));
    await assert.rejects(handle.done, { name: 'AbortError' }); assert.equal(calls, 0);
  });

  await scenario('canonical errors never fall back to legacy; wrong game fails closed', async () => {
    let legacyCalls = 0, installCalls = 0;
    const service = createPackageTaskService({ baseUrl, dependencies: { parseStoredGameDataPack: async () => { legacyCalls++; throw new Error('unexpected legacy'); },
      installParsedPackageZip: async value => { installCalls++; return installed(value); } } });
    await assert.rejects(service.startImport({ game: 'th06', file: zip('th07') }).done, /TH07, not TH06/);
    const bad = new Blob([zipSync({ 'package.json': strToU8('{bad json') }, { level: 0 })]);
    await assert.rejects(service.startImport({ game: 'th06', file: bad }).done, /invalid Package Descriptor JSON/);
    assert.equal(legacyCalls, 0); assert.equal(installCalls, 0);
  });

  await scenario('canonical required shared resources are checked before mutation', async () => {
    let called = false;
    const service = createPackageTaskService({ baseUrl, dependencies: { installParsedPackageZip: async value => { called = true; return installed(value); } } });
    await assert.rejects(service.startImport({ game: 'th08', file: zip('th08') }).done, /missing required resource/);
    assert.equal(called, false);
  });

  await scenario('legacy reader/adaptor reuse; import-only host rejects incomplete historical pack', async () => {
    let adapts = 0, installs = 0;
    const legacy = { manifest: { game: 'th06', data: { path: 'th06.data' } }, offline: null };
    const service = createPackageTaskService({ baseUrl, dependencies: {
      parsePackageZip: async () => { throw new Error('Package ZIP is missing package.json'); },
      parseStoredGameDataPack: async () => legacy,
      adaptLegacyGamePackToPackage: (value, options) => { assert.equal(value, legacy); assert.equal(options.protocol, 'eagler-touhou/1'); adapts++; return parsed('th06'); },
      installParsedPackageZip: async value => { installs++; return installed(value); },
    } });
    await service.startImport({ game: 'th06', file: new Blob(['legacy']), resourceMode: 'hosted' }).done;
    assert.equal(adapts, 1); assert.equal(installs, 1);
    await assert.rejects(service.startImport({ game: 'th06', file: new Blob(['legacy']), resourceMode: 'import' }).done, /complete offline/);
    assert.equal(installs, 1);
  });

  await scenario('raw DATA retains declared target, verified identity and canonical acquisition', async () => {
    let acquired;
    const bytes = new TextEncoder().encode('retail-data');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const file = new File([bytes], 'TH11.DAT');
    const expectedData = { path: 'th11.dat', version: hash.slice(0, 16), bytes: bytes.length, sha256: hash, layout: 'retail-memory' };
    const service = createPackageTaskService({ baseUrl, dependencies: { installPackageFromAcquisition: async options => {
      acquired = options; const data = await options.acquire('game-data');
      assert.deepEqual(new Uint8Array(data), bytes); return installed({ descriptor: options.descriptor });
    } } });
    await service.startImport({ game: 'th11', file, expectedData }).done;
    assert.equal(acquired.source, 'local'); assert.equal(acquired.reuseCurrent, false);
    assert.equal(acquired.descriptor.files['game-data'].target, '/th11.dat');
    assert.ok(acquired.signal instanceof AbortSignal);
    await assert.rejects(service.startImport({ game: 'th11', file }).done, /Verified Host DATA identity/);
    await assert.rejects(service.startImport({ game: 'th11', file, expectedData: { ...expectedData, sha256: '0'.repeat(64) } }).done, /SHA-256/);
  });

  await scenario('dispose aborts cancellable jobs and rejects new work', async () => {
    const service = createPackageTaskService({ baseUrl });
    const handle = service.startImport({ game: 'th06', file: zip('th06') });
    service.dispose(); await assert.rejects(handle.done, { name: 'AbortError' });
    assert.throws(() => service.startImport({ game: 'th06', file: zip('th06') }), /disposed/);
  });
  console.log(`Package task service: ${checked} scenarios PASS`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
