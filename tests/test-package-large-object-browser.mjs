/** Browser storage gate with synthetic bytes, no retail data or game Runtime.
 * Proves large ArrayBuffer/Blob acquisition, committed-generation reload and
 * exact offline IndexedDB reads. Does not prove offline App Shell/game boot. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";

const project = resolve(import.meta.dirname, "..");
const browserRoot = resolve(process.env.LOCALAPPDATA || "", "ms-playwright");
const installations = existsSync(browserRoot)
  ? readdirSync(browserRoot).filter(name => /^chromium-\d+$/.test(name)).sort().reverse() : [];
const executablePath = process.env.EAGLER_CHROMIUM ||
  resolve(browserRoot, installations[0] || "", "chrome-win64/chrome.exe");
if (!existsSync(executablePath)) throw new Error("Set EAGLER_CHROMIUM to a Chromium executable");
const bytes = 150943726;
const fixture = Buffer.alloc(bytes, 0x5a);
fixture[0] = 0x12; fixture[bytes - 1] = 0x34;
const expectedHash = createHash("sha256").update(fixture).digest("hex");
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Package Store test</title>"); return; }
    const file = path === '/product-catalog.mjs'
      ? resolve(project, '.cache/build/browser/assets/contracts/product-catalog.mjs')
      : resolve(project, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(project + sep)) { res.writeHead(403).end(); return; }
    res.setHeader("Content-Type", extname(file) === ".mjs" ? "text/javascript" : "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const installed = await page.evaluate(async bytes => {
    const store = await import('/package/package-store.mjs');
    const descriptor = {
      schema: 'eagler-touhou/package/1', game: 'th20', revision: 'synthetic-r1',
      runtimeRequirement: { protocol: 'eagler-touhou/1', target: 'th20', dataFile: 'data', dataLayout: 'layout-test' },
      files: Object.fromEntries(['data', 'large-blob', 'small'].map(id => [id, {
        source: `${id}.bin`, target: `/${id}.bin`, revision: 'r1', bytes: id === 'small' ? 4 : bytes,
      }])), base: { files: ['data', 'large-blob', 'small'] }, components: {},
    };
    const generation = { id: 'large-object-test', game: 'th20', descriptor, files: {} };
    const options = { operationId: 'large-object-operation' };
    await store.stagePendingPackageGeneration(generation, options);
    const makeBytes = () => { const data = new Uint8Array(bytes); data.fill(0x5a); data[0] = 0x12; data[bytes - 1] = 0x34; return data; };
    await store.putPendingPackageObject('th20', generation.id, 'data', makeBytes().buffer, options);
    const blob = new Blob([makeBytes()]);
    blob.arrayBuffer = () => { throw new Error('large Blob acquisition was materialized'); };
    await store.putPendingPackageObject('th20', generation.id, 'large-blob', blob, options);
    await store.putPendingPackageObject('th20', generation.id, 'small', new Uint8Array([1, 2, 3, 4]), options);
    await store.commitPendingPackageGeneration('th20', generation.id, options);
    const current = await store.readCurrentPackageGeneration('th20');
    const db = await store.openPackageStore();
    try {
      const rows = await Promise.all(Object.entries(current.generation.files).map(([id, ref]) => new Promise((resolve, reject) => {
        const request = db.transaction(store.PACKAGE_OBJECTS).objectStore(store.PACKAGE_OBJECTS).get(ref.objectId);
        request.onsuccess = () => resolve({ id, blob: request.result.blob instanceof Blob, arraybuffer: request.result.data instanceof ArrayBuffer });
        request.onerror = () => reject(request.error);
      })));
      return rows;
    } finally { db.close(); }
  }, bytes);
  assert.deepEqual(installed, [
    { id: 'data', blob: true, arraybuffer: false },
    { id: 'large-blob', blob: true, arraybuffer: false },
    { id: 'small', blob: false, arraybuffer: true },
  ]);
  await page.reload();
  await page.evaluate(async () => { globalThis.testStore = await import('/package/package-store.mjs'); });
  await page.setOfflineMode(true);
  const restored = await page.evaluate(async () => {
    const store = globalThis.testStore;
    const { installation, generation } = await store.readCurrentPackageGeneration('th20');
    const files = [];
    for (const [id, ref] of Object.entries(generation.files)) {
      const object = await store.readPackageObject(ref.objectId);
      const data = await object.blob.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
      files.push({ id, bytes: data.byteLength, digest });
    }
    return { current: installation.currentGeneration, pending: installation.pendingGeneration, files };
  });
  assert.equal(restored.current, 'large-object-test');
  assert.equal(restored.pending, null);
  for (const file of restored.files) {
    assert.equal(file.bytes, file.id === 'small' ? 4 : bytes);
    assert.equal(file.digest, file.id === 'small' ? createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex') : expectedHash);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ packageLargeObjectBrowser: 'PASS', browser: await browser.version(), bytes,
    inputs: ['ArrayBuffer', 'Blob', 'small TypedArray'], reload: true, offlineRead: true, sha256: expectedHash }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
