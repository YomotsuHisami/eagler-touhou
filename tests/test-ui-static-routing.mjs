import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createUiServer, decodeUiPath, isUiNavigation, uiByteRange, uiCacheControl } from '../scripts/serve-ui.mjs';
import { navigationPatterns } from '../scripts/build-ui.mjs';
import routes from '../app/routes.ts';

const patterns = navigationPatterns(routes);
test('navigation is derived from nested Framework routes and excludes asset-like paths', () => {
  for (const path of ['/', '/settings', '/en.html', '/lobby.html', '/components', '/games/th08mp', '/games/th08mp/resources', '/games/th06/replays', '/games/th10/help', '/lobby', '/rooms/abc_123']) {
    assert.ok(isUiNavigation(path, patterns), path);
  }
  for (const path of ['/other', '/games/game.js', '/games/th06/missing.wasm', '/assets/font.woff2', '/games/th06/missing', '/rooms/a/b']) {
    assert.equal(isUiNavigation(path, patterns), false, path);
  }
  for (const path of ['/../secret', '/%2e%2e/secret', '/assets/%00', '/assets/%5csecret', '/.git/config', '/%bad']) assert.equal(decodeUiPath(path), null);
  assert.equal(decodeUiPath('/games/th06?from=library'), '/games/th06');
});

test('cache and byte-range policies preserve resource semantics', () => {
  assert.match(uiCacheControl('/assets/root-abcd1234.js', new Set(['assets/root-abcd1234.js'])), /immutable/);
  assert.doesNotMatch(uiCacheControl('/host-manifest.json'), /immutable/);
  assert.doesNotMatch(uiCacheControl('/assets/fonts-deferred.css'), /immutable/);
  assert.doesNotMatch(uiCacheControl('/games/th06'), /immutable/);
  assert.deepEqual(uiByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(uiByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(uiByteRange('bytes=7-', 10), { start: 7, end: 9 });
  for (const invalid of ['bytes=11-12', 'bytes=5-3', 'bytes=-0', 'bytes=1-2,4-5', 'other']) assert.equal(uiByteRange(invalid, 10), false);
});

test('preview rewrites only known HTML navigation and serves public/runtime artifacts safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eagler-ui-static-'));
  const root = join(directory, 'client'); const publicRoot = join(directory, 'public'); const assetsRoot = join(directory, 'artifacts');
  for (const folder of [root, publicRoot, assetsRoot, join(root, 'assets'), join(assetsRoot, 'runtime'), join(publicRoot, 'assets')]) await mkdir(folder, { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>React SPA</title>');
  await writeFile(join(root, 'ui-navigation.json'), JSON.stringify({ schema: 'eagler-touhou/ui-navigation/1', patterns }));
  await writeFile(join(root, 'ui-ownership.json'), JSON.stringify({assets:['assets/root-abcd1234.js']}));
  await writeFile(join(root, 'assets/root-abcd1234.js'), 'export const ready = true;');
  await writeFile(join(publicRoot, 'assets/font.woff2'), 'fixture-font');
  await writeFile(join(publicRoot, 'lobby.html'), '<title>Legacy launcher must not load</title>');
  await writeFile(join(publicRoot, 'en.html'), '<title>Legacy launcher must not load</title>');
  await writeFile(join(assetsRoot, 'runtime/game.wasm'), '0123456789');
  await writeFile(join(assetsRoot, 'host-manifest.json'), '{"schema":"fixture"}');
  await writeFile(join(directory, 'secret.txt'), 'private');
  await symlink(join(directory, 'secret.txt'), join(root, 'assets/escape.txt'));
  const server = await createUiServer({ root, publicRoot, assetsRoot });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/', '/settings', '/en.html', '/lobby.html', '/games/th08mp', '/games/th08mp/resources', '/lobby', '/rooms/room-1', '/components']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, path); assert.match(response.headers.get('content-type'), /^text\/html/);
      assert.match(await response.text(), /React SPA/);
    }
    for (const path of ['/assets/missing.js', '/runtime/missing.wasm', '/assets/missing.woff2', '/games/th08mp/missing.js', '/unmapped', '/ui-ownership.json', '/assets/escape.txt']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 404, path); assert.doesNotMatch(await response.text(), /React SPA/);
    }
    assert.equal((await fetch(base + '/games/th06', { headers: { Accept: 'application/json' } })).status, 404);
    assert.equal((await fetch(base + '/games/th06', { method: 'POST' })).status, 405);
    const js = await fetch(base + '/assets/root-abcd1234.js');
    assert.match(js.headers.get('content-type'), /javascript/); assert.match(js.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(base + '/assets/root-abcd1234.js', { headers: { 'If-None-Match': js.headers.get('etag') } })).status, 304);
    const font = await fetch(base + '/assets/font.woff2'); assert.equal(font.headers.get('content-type'), 'font/woff2');
    const wasm = await fetch(base + '/runtime/game.wasm', { headers: { Range: 'bytes=2-5' } });
    assert.equal(wasm.status, 206); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(wasm.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await wasm.text(), '2345');
    const head = await fetch(base + '/runtime/game.wasm', { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/runtime/game.wasm', { headers: { Range: 'bytes=22-' } })).status, 416);
    const metadata = await fetch(base + '/host-manifest.json'); assert.equal(metadata.status, 200); assert.match(metadata.headers.get('content-type'), /json/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
