/** Real local HTTP routing; fixture metadata only, no upstream game downloads. */
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PRODUCT_GAMES } from '../lib/contracts/product-catalog.mjs';
import { localModuleClosure } from '../lib/browser-module-graph.mjs';
import { resolveBrowserPublicationSource } from '../lib/launcher-build.mjs';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = 'a'.repeat(64); // Test identities only; never written to a deployment.
const host = {
  schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1',
  profile: 'web-development',
  shared: { resourceMode: 'hosted', vanillaFont: 'shared/test.otf', unicodeFont: 'shared/test.otf' },
  games: Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([id, product]) => [id, {
    runtime: product.runtime, multiplayerRuntime: product.multiplayerRuntime,
    gameData: { path: product.package.dataTarget.slice(1), bytes: 1,
      sha256: hash, version: `sha256-${hash}`, layout: `sha256-${hash}` },
    music: { midi: { files: [] } }, features: { thprac: product.features.thprac },
  }])),
};
const upstreamRequests = [];
const upstream = createServer((request, response) => {
  upstreamRequests.push(request.url);
  const value = request.url === '/host-manifest.json' ? host :
    request.url === '/release-catalog.json' ? { schema: 'eagler-touhou/release-catalog/1', games: {} } : null;
  response.writeHead(value ? 200 : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
let logs = '';
const child = spawn(process.execPath, [process.env.EAGLER_TEST_PREVIEW || 'eagler-local-preview.mjs', `--port=${port}`,
  `--upstream=http://127.0.0.1:${upstream.address().port}/`], {
  cwd: project, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = new Promise(resolve => child.once('exit', resolve));
child.stdout.on('data', bytes => { logs += bytes; });
child.stderr.on('data', bytes => { logs += bytes; });
try {
  for (let i = 0; i < 200 && !logs.includes('打开：'); i++) {
    assert.equal(child.exitCode, null, logs);
    await delay(100);
  }
  assert.ok(logs.includes('打开：'), `Preview did not start:\n${logs}`);
  const base = `http://127.0.0.1:${port}/`;
  const modules = await localModuleClosure({ root: project, entries: ['dev-lobby.mjs'],
    resolveFile: resolveBrowserPublicationSource });
  assert.ok(modules.includes('assets/contracts/product-catalog.mjs'));
  const checked = [];
  for (const path of ['dev-lobby.html', 'dev-lobby.css', ...modules]) {
    const response = await fetch(base + path + '?game=th07');
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-cache', path);
    if (/\.m?js$/.test(path)) assert.match(response.headers.get('content-type'), /javascript/, path);
    const actual = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(actual, await readFile(resolveBrowserPublicationSource(path)), path);
    const head = await fetch(base + path, { method: 'HEAD' });
    assert.equal(head.status, 200, `HEAD ${path}`);
    assert.equal((await head.text()).length, 0);
    checked.push(path);
  }
  const html = await (await fetch(base + 'dev-lobby.html')).text();
  assert.match(html, /href="assets\/th06.ico"/);
  // The public/source boundaries stay closed: adding previews is not a wildcard file server.
  for (const path of ['.git/config', 'package.json', 'src/launcher/app.mts', 'lib/launcher-build.mjs', 'dev-lobby.mjs.bak']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + 'dev-lobby.html', { method: 'POST' })).status, 405);
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(base + 'dev-lobby.html', { headers: { Host: 'external.invalid' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.once('error', reject); request.end();
  });
  assert.equal(badHostStatus, 403);
  const servedHost = await (await fetch(base + 'host-manifest.json')).json();
  assert.deepEqual(Object.keys(servedHost.games), Object.keys(PRODUCT_GAMES));
  assert.equal(servedHost.shared.netplayRelay, undefined);
  assert.deepEqual(upstreamRequests, ['/host-manifest.json', '/release-catalog.json']);
  console.log(JSON.stringify({ result: 'PASS', routes: checked,
    blocked: 'source/private paths, foreign Host, POST', upstream: 'fixture metadata only' }, null, 2));
} finally {
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
}
