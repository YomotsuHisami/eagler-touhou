import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createUiServer, decodeUiPath, isUiNavigation, uiByteRange, uiCacheControl } from '../scripts/serve-ui.mjs';
import { navigationPatterns } from '../scripts/ui-routing.mjs';
import routes from '../app/routes.ts';

const patterns = navigationPatterns(routes);
test('navigation is derived from nested Framework routes and excludes asset-like paths', () => {
  for (const path of ['/', '/games/th08mp', '/games/th06', '/games/th10']) {
    assert.ok(isUiNavigation(path, patterns), path);
  }
  for (const path of ['/other', '/games/game.js', '/games/th06/missing.wasm', '/assets/font.woff2', '/games/th06/missing', '/rooms/a/b']) {
    assert.equal(isUiNavigation(path, patterns), false, path);
  }
  for (const path of ['/../secret', '/%2e%2e/secret', '/assets/%00', '/assets/%5csecret', '/.git/config', '/%bad']) assert.equal(decodeUiPath(path), null);
  assert.equal(decodeUiPath('/games/th06?from=library'), '/games/th06');
  assert.equal(decodeUiPath('//games//th06/'), '/games/th06');
  assert.equal(decodeUiPath('/%2fui-ownership.json///'), '/ui-ownership.json');
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
  for (const folder of [root, publicRoot, assetsRoot, join(root, 'assets'), join(publicRoot, 'assets'), ...['runtime', 'games/th06/language', 'games/th06/music/ogg', 'shared', 'games-private', 'shared-private'].map(path => join(assetsRoot, path))]) await mkdir(folder, { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>React SPA</title>');
  await writeFile(join(root, 'ui-navigation.json'), JSON.stringify({ schema: 'eagler-touhou/ui-navigation/1', patterns }));
  await writeFile(join(root, 'ui-ownership.json'), JSON.stringify({assets:['assets/root-abcd1234.js']}));
  await writeFile(join(root, 'assets/root-abcd1234.js'), 'export const ready = true;');
  await writeFile(join(publicRoot, 'assets/font.woff2'), 'fixture-font');
  await writeFile(join(publicRoot, 'lobby.html'), '<title>Legacy launcher must not load</title>');
  await writeFile(join(publicRoot, 'en.html'), '<title>Legacy launcher must not load</title>');
  await writeFile(join(assetsRoot, 'runtime/game.wasm'), '0123456789');
  await writeFile(join(assetsRoot, 'games/th06/th06.data'), 'synthetic-data');
  await writeFile(join(assetsRoot, 'games/th06/language/lang_en.zip'), 'synthetic-language');
  await writeFile(join(assetsRoot, 'games/th06/music/ogg/th06_01.ogg'), 'synthetic-music');
  await writeFile(join(assetsRoot, 'shared/unifont.otf'), 'synthetic-font');
  await writeFile(join(assetsRoot, 'shared/msgothic.ttc'), 'synthetic-font-collection');
  await writeFile(join(assetsRoot, 'th06.package.json'), JSON.stringify({ files: {
    'game-data': { source: 'games/th06/th06.data' },
    'shared-unifont': { source: 'shared/unifont.otf' },
    'shared-msgothic': { source: 'shared/msgothic.ttc' },
    'language:lang_en': { source: 'games/th06/language/lang_en.zip' },
    'ogg:th06_01.ogg': { source: 'games/th06/music/ogg/th06_01.ogg' },
  } }));
  await writeFile(join(assetsRoot, 'private.txt'), 'must-not-serve');
  for (const path of ['games-private/data.bin', 'shared-private/font.otf', 'th06.package.json.bak', 'notes.package.json', 'index.html', 'en.html']) {
    await writeFile(join(assetsRoot, path), 'must-not-serve');
  }
  await writeFile(join(assetsRoot, 'host-manifest.json'), '{"schema":"fixture"}');
  await writeFile(join(directory, 'secret.txt'), 'private');
  await symlink(join(directory, 'secret.txt'), join(root, 'assets/escape.txt'));
  await symlink(join(directory, 'secret.txt'), join(publicRoot, 'assets/public-escape.txt'));
  await symlink(join(directory, 'secret.txt'), join(assetsRoot, 'games/th06/escape.data'));
  await symlink(join(directory, 'secret.txt'), join(assetsRoot, 'shared/escape.otf'));
  await symlink(join(directory, 'secret.txt'), join(assetsRoot, 'th07.package.json'));
  const server = await createUiServer({ root, publicRoot, assetsRoot });
  const unmounted = await createUiServer({ root, publicRoot });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    unmounted.listen(0, '127.0.0.1'); await once(unmounted, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const unmountedBase = `http://127.0.0.1:${unmounted.address().port}`;
    for (const path of ['/', '/games/th08mp', '/games/th06', '/games/th11']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, path); assert.match(response.headers.get('content-type'), /^text\/html/);
      assert.match(await response.text(), /React SPA/);
    }
    for (const path of ['/assets/missing.js', '/runtime/missing.wasm', '/assets/missing.woff2', '/games/th08mp/missing.js', '/games/th06/missing.data', '/shared/missing.otf', '/th08.package.json', '/unmapped', '/ui-ownership.json', '//ui-ownership.json', '/ui-ownership.json/', '/%2fui-ownership.json///', '/assets/escape.txt', '/assets/public-escape.txt', '/games/th06/escape.data', '/shared/escape.otf', '/th07.package.json', '/private.txt', '/games-private/data.bin', '/shared-private/font.otf', '/th06.package.json.bak', '/notes.package.json']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 404, path); assert.doesNotMatch(await response.text(), /React SPA/);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
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
    const descriptor = await fetch(base + '/th06.package.json?v=fixture');
    assert.equal(descriptor.status, 200); assert.match(descriptor.headers.get('content-type'), /json/);
    assert.doesNotMatch(descriptor.headers.get('cache-control'), /immutable/);
    for (const { source } of Object.values((await descriptor.json()).files)) {
      const response = await fetch(`${base}/${source}?v=fixture`);
      assert.equal(response.status, 200, source); assert.match(await response.text(), /^synthetic-/);
      assert.equal((await fetch(`${unmountedBase}/${source}`, { headers: { Accept: 'text/html' } })).status, 404, source);
    }
    for (const path of ['/th06.package.json', '/runtime/game.wasm', '/host-manifest.json']) {
      assert.equal((await fetch(unmountedBase + path, { headers: { Accept: 'text/html' } })).status, 404, path);
    }
    const metadata = await fetch(base + '/host-manifest.json'); assert.equal(metadata.status, 200); assert.match(metadata.headers.get('content-type'), /json/);
  } finally {
    await Promise.all([server, unmounted].map(instance => new Promise(resolve => instance.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});

await test('CLI accepts both argument forms and rejects a silently missing port',async()=>{
 const {parseUiArguments}=await import('../scripts/serve-ui.mjs');
 assert.deepEqual(parseUiArguments(['--port=5174']),{port:'5174'});
 assert.deepEqual(parseUiArguments(['--port','5174']),{port:'5174'});
 assert.throws(()=>parseUiArguments(['--port']),/Missing value/);
 assert.throws(()=>parseUiArguments(['--unknown=1']),/Unknown preview option/);
});
