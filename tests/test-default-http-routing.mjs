import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublishedSiteServer } from '../scripts/serve-static.mjs';
import { safeSiteFile } from '../server/ui-static-server.mjs';
import { createDevelopmentServer } from '../scripts/serve.mjs';
import { createUiDeploymentContract } from '../scripts/ui-deployment-contract.mjs';

const patterns = ['/', '/lobby', '/play/:productId', '/play/:productId/resources', '/play/:productId/replays', '/play/:productId/saves', '/index.html', '/en.html', '/lobby.html'];
const html = '<!doctype html><title>Synthetic React shell</title>';
const project = fileURLToPath(new URL('..', import.meta.url));
const json = value => JSON.stringify(value);

async function fixture(t, mountPath = '/', marked = true) {
  const directory = await mkdtemp(join(tmpdir(), 'eagler-http-'));
  const root = join(directory, 'site');
  const navigation = createUiDeploymentContract({ mountPath, patterns });
  const files = {
    'index.html': html, 'assets/entry-abcdefgh.js': 'export const synthetic = true;',
    'assets/large.js': '/* synthetic */'.repeat(256), 'runtime/game.wasm': '0123456789',
    'games/th06/game.data': 'synthetic-data', 'shared/font.otf': 'synthetic-font',
    'host-manifest.json': json({ schema: 'synthetic-host' }), 'release-catalog.json': '{}',
    'th06.package.json': '{}', 'about.html': '<title>Authored page</title>',
    'legacy-mount-retirement-sw.js': 'self.registration.unregister();', 'app-shell-sw.js': '/* actual scoped worker */',
    'ui-ownership.json': 'private', 'ui-artifact.json': 'private',
    'manual/index.html': '<title>Existing directory index</title>',
  };
  if (marked) files['ui-publication.json'] = json({ schema: 'eagler-touhou/ui-publication/1', status: 'react-main', mountPath, navigation });
  for (const [name, bytes] of Object.entries(files)) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), bytes); }
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { root, directory, navigation };
}
async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function rawGet(base, path) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(base, { path }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject); request.end();
  });
}

for (const factory of [createPublishedSiteServer, createDevelopmentServer]) test(`${factory.name}: root publication has bounded navigation, file precedence and legacy compatibility`, async t => {
  const { root, directory } = await fixture(t);
  // A concrete file matching a route wins over the SPA.
  await mkdir(join(root, 'play'), { recursive: true }); await writeFile(join(root, 'play/existing'), 'existing route bytes');
  await writeFile(join(directory, 'secret.txt'), 'private'); await symlink(join(directory, 'secret.txt'), join(root, 'assets/escape.js'));
  const base = await listen(t, await factory({ root }));
  for (const path of ['/', '/play/th06', '/play/th06/resources', '/play/th06/replays', '/play/th06/saves', '/lobby', '/index.html', '/en.html?game=th06', '/lobby.html']) {
    const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200, path); assert.equal(await response.text(), html, path);
  }
  assert.equal(await (await fetch(base + '/play/existing', { headers: { Accept: 'text/html' } })).text(), 'existing route bytes');
  assert.equal(await (await fetch(base + '/about.html')).text(), '<title>Authored page</title>');
  for (const path of ['/unknown', '/games/th06', '/shared/missing', '/play/a.b', '/play/th06/missing.wasm', '/assets/missing.js', '/runtime/missing.wasm', '/games/th06/missing.data', '/missing.html', '/ui-ownership.json', '/ui-artifact.json', '/assets/escape.js']) {
    const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 404, path); assert.equal(response.headers.get('cache-control'), 'no-store', path); assert.doesNotMatch(await response.text(), /React shell/);
  }
  for (const accept of ['*/*', 'application/json', 'text/html;q=0', 'text/html;q=0, */*;q=1']) assert.equal((await fetch(base + '/play/th06', { headers: { Accept: accept } })).status, 404, accept);
  assert.equal((await fetch(base + '/play/th06', { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'script' } })).status, 404);
  assert.equal((await fetch(base + '/play/th06', { method: 'POST', headers: { Accept: 'text/html' } })).status, 405);
  assert.equal((await fetch(base + '/assets/entry-abcdefgh.js', { method: 'POST' })).status, 405);
  const head = await fetch(base + '/play/th06', { method: 'HEAD', headers: { Accept: 'text/html' } });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html))); assert.equal(await head.text(), '');
  for (const path of ['/eagler-touhou', '/eagler-touhou/']) {
    const response = await fetch(base + path + '?game=th06', { redirect: 'manual' });
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/?game=th06');
  }
  assert.equal((await fetch(base + '/eagler-touhou/host-manifest.json')).status, 200);
  const retired = await fetch(base + '/eagler-touhou/app-shell-sw.js');
  assert.equal(retired.status, 200); assert.equal(retired.headers.get('cache-control'), 'no-store'); assert.equal(retired.headers.get('service-worker-allowed'), '/eagler-touhou/'); assert.match(await retired.text(), /unregister/);
  const directoryRedirect = await fetch(base + '/manual?x=1', { redirect: 'manual' });
  assert.equal(directoryRedirect.status, 308); assert.equal(directoryRedirect.headers.get('location'), '/manual/?x=1');
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%5cescape.js', '/assets/%00', '/%bad', '/.git/config', '/play/th06%3fmissing.js', '/play/th06%23missing.js', '/play/%0dth06']) assert.equal(await rawGet(base, path), 400, path);
});

for (const mountPath of ['/nested/ui/', '/eagler-touhou/']) test(`actual ${mountPath} mount keeps all bytes scoped and does not retire its worker`, async t => {
  const { root } = await fixture(t, mountPath);
  const base = await listen(t, await createPublishedSiteServer({ root }));
  const redirect = await fetch(base + mountPath.slice(0, -1) + '?game=th06', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), mountPath + '?game=th06');
  for (const path of ['', 'play/th06', 'play/th06/resources', 'en.html', 'lobby.html']) {
    const response = await fetch(base + mountPath + path, { headers: { Accept: 'text/html' } }); assert.equal(response.status, 200, path); assert.equal(await response.text(), html);
  }
  for (const path of ['assets/entry-abcdefgh.js', 'runtime/game.wasm', 'games/th06/game.data', 'shared/font.otf', 'host-manifest.json', 'release-catalog.json', 'th06.package.json', 'ui-publication.json']) assert.equal((await fetch(base + mountPath + path)).status, 200, path);
  for (const path of ['/', '/play/th06', '/assets/entry-abcdefgh.js', '/ui-publication.json', '/games/th06/game.data', '/shared/font.otf', mountPath + 'games/th06/missing.data', mountPath + 'shared/missing.otf', mountPath + 'unknown']) assert.equal((await fetch(base + path, { headers: { Accept: 'text/html' } })).status, 404, path);
  const worker = await fetch(base + mountPath + 'app-shell-sw.js');
  assert.equal(worker.status, 200); assert.equal(worker.headers.get('service-worker-allowed'), null); assert.notEqual(worker.headers.get('cache-control'), 'no-store'); assert.match(await worker.text(), /actual scoped worker/);
});

test('resource MIME, conditional requests, range bytes and compression survive the routing migration', async t => {
  const { root } = await fixture(t); const base = await listen(t, await createPublishedSiteServer({ root }));
  const response = await fetch(base + '/runtime/game.wasm', { headers: { Range: 'bytes=2-5', 'Accept-Encoding': 'br' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'application/wasm'); assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(response.headers.get('content-encoding'), null); assert.equal(await response.text(), '2345');
  const tag = response.headers.get('etag'); assert.ok(tag);
  assert.equal((await fetch(base + '/runtime/game.wasm', { headers: { 'If-None-Match': tag } })).status, 304);
  const head = await fetch(base + '/runtime/game.wasm', { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/runtime/game.wasm', { headers: { Range: 'bytes=11-' } })).status, 416);
  const whole = await fetch(base + '/runtime/game.wasm', { headers: { Range: 'bytes=2-5', 'If-Range': '"old"' } }); assert.equal(whole.status, 200); assert.equal(await whole.text(), '0123456789');
  assert.equal((await fetch(base + '/assets/large.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } })).headers.get('content-encoding'), 'br');
  assert.equal((await fetch(base + '/assets/large.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'br;q=0,gzip;q=0' } })).headers.get('content-encoding'), null);
  const font = await fetch(base + '/shared/font.otf'); assert.equal(font.headers.get('content-type'), 'font/otf'); assert.doesNotMatch(font.headers.get('cache-control'), /immutable/);
});

test('unmarked legacy trees stay file-only and malformed markers fail closed', async t => {
  const { root } = await fixture(t, '/', false); const base = await listen(t, await createPublishedSiteServer({ root }));
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/play/th06', { headers: { Accept: 'text/html' } })).status, 404);
  await writeFile(join(root, 'ui-publication.json'), json({ schema: 'wrong' }));
  await assert.rejects(createPublishedSiteServer({ root }), /Invalid UI publication/);
  await rm(join(root, 'ui-publication.json'));
  await symlink(join(root, 'missing-marker'), join(root, 'ui-publication.json'));
  await assert.rejects(createPublishedSiteServer({ root }), /readable in-root file/);
  await rm(join(root, 'ui-publication.json'));
  await mkdir(join(root, 'ui-publication.json'));
  await writeFile(join(root, 'ui-publication.json/index.html'), '{}');
  await assert.rejects(createPublishedSiteServer({ root }), /marker must be a file/);
});

test('unassembled source resources cannot expose a publication marker or root worker', async t => {
  const { root, navigation } = await fixture(t);
  const base = await listen(t, await createPublishedSiteServer({ root, publication: false, navigation,
    resolveResource: path => safeSiteFile(root, path),
  }));
  assert.equal(await (await fetch(base + '/play/th06', { headers: { Accept: 'text/html' } })).text(), html);
  for (const path of ['/ui-publication.json', '/app-shell-sw.js', '/eagler-touhou/ui-publication.json']) assert.equal((await fetch(base + path)).status, 404);
  assert.match(await (await fetch(base + '/eagler-touhou/app-shell-sw.js')).text(), /unregister/);
});

test('external games/shared network handlers keep their redirect and query policy', async t => {
  const { root } = await fixture(t);
  const base = await listen(t, await createPublishedSiteServer({ root, middleware: async (request, response, url) => {
    if (!/^\/(games|shared)\//.test(url.pathname)) return false;
    response.writeHead(307, { Location: 'https://assets.example.invalid' + url.pathname + url.search, 'Cache-Control': 'no-store' }); response.end(); return true;
  } }));
  for (const path of ['/games/th06/game.data?v=fixture', '/shared/font.otf?v=fixture']) {
    const response = await fetch(base + path, { redirect: 'manual', headers: { Accept: 'text/html' } }); assert.equal(response.status, 307); assert.equal(response.headers.get('location'), 'https://assets.example.invalid' + path);
  }
});

test('portable static CLI boots from its local module closure without package.json or a frontend toolchain', async t => {
  const { root, directory } = await fixture(t, '/portable/');
  const portable = join(directory, 'portable-server');
  for (const file of ['scripts/serve-static.mjs', 'server/ui-static-server.mjs', 'server/static-content-policy.mjs', 'scripts/ui-deployment-contract.mjs']) {
    await mkdir(dirname(join(portable, file)), { recursive: true }); await copyFile(join(project, file), join(portable, file));
  }
  const probe = createNetServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [join(portable, 'scripts/serve-static.mjs'), root, String(port)], { env: { ...process.env, EAGLER_TOUHOU_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Portable server start timed out: ${stderr}`)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Portable server exited ${code}: ${stderr}`)); });
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('Eagler Touhou host:')) { clearTimeout(timer); resolve(); } });
  });
  const response = await fetch(`http://127.0.0.1:${port}/portable/play/th06`, { headers: { Accept: 'text/html' } }); assert.equal(response.status, 200); assert.equal(await response.text(), html);
});
