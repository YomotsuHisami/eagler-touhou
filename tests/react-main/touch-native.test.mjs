/** Main5048–5085 Player fullscreen recognition vs editor-owned cleanup.
 * All native objects below are synthetic ports; no browser fullscreen request,
 * orientation permission or native/fullscreen acceptance result is claimed. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, createTouchNativePorts;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-touch-native-'));
  const outfile = resolve(work, 'native.mjs');
  await build({entryPoints: [resolve(project, 'app/services/touch-native.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'});
  ({createTouchNativePorts} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

function fixture({webkit = false} = {}) {
  const calls = [], root = {}, foreign = {};
  const document = {documentElement: root, fullscreenElement: null, webkitFullscreenElement: null};
  const field = webkit ? 'webkitFullscreenElement' : 'fullscreenElement';
  document[webkit ? 'webkitExitFullscreen' : 'exitFullscreen'] = async () => {calls.push('exit'); document[field] = null;};
  const player = {[webkit ? 'webkitRequestFullscreen' : 'requestFullscreen'](options) {calls.push(['enter', options]); document[field] = player; return webkit ? undefined : Promise.resolve();}};
  const native = createTouchNativePorts({document, screen: {}, mobile: false, translate: key => key});
  return {native, document, player, root, foreign, calls, current(value) {document[field] = value;}};
}

test('preexisting root fullscreen survives editor exit and disposal', async () => {
  const f = fixture(); f.current(f.root);
  assert.equal(await f.native.enterFullscreen(f.player), false, 'editor did not acquire inherited root fullscreen');
  assert.equal(f.native.isFullscreen(), true);
  await f.native.exitFullscreen(); await f.native.dispose();
  assert.deepEqual(f.calls, []); assert.equal(f.document.fullscreenElement, f.root);
});

test('explicit Player exit closes inherited root fullscreen without acquiring it first', async () => {
  const f = fixture(); f.current(f.root);
  await f.native.exitPlayerFullscreen();
  assert.deepEqual(f.calls, ['exit']); assert.equal(f.native.isFullscreen(), false);
  await f.native.dispose(); assert.deepEqual(f.calls, ['exit']);
});

test('inherited dedicated Player fullscreen is recognized after target registration but not editor-owned', async () => {
  const f = fixture(); f.current(f.player);
  assert.equal(await f.native.enterFullscreen(f.player), false);
  await f.native.exitFullscreen(); assert.deepEqual(f.calls, []);
  await f.native.exitPlayerFullscreen(); assert.deepEqual(f.calls, ['exit']);
});

test('ordinary acquired fullscreen is released once by either explicit Player exit or editor cleanup', async () => {
  for (const exit of ['exitPlayerFullscreen', 'exitFullscreen']) {
    const f = fixture(); assert.equal(await f.native.enterFullscreen(f.player), true);
    assert.deepEqual(f.calls, [['enter', {navigationUI: 'hide'}]]);
    await f.native[exit](); await f.native.dispose();
    assert.deepEqual(f.calls, [['enter', {navigationUI: 'hide'}], 'exit']);
  }
});

test('explicit Player exit ignores unrelated fullscreen and clears any retired ownership marker', async () => {
  const f = fixture(); await f.native.enterFullscreen(f.player); f.current(f.foreign);
  await f.native.exitPlayerFullscreen(); assert.equal(f.document.fullscreenElement, f.foreign);
  f.current(f.player); await f.native.dispose();
  assert.equal(f.calls.filter(value => value === 'exit').length, 0, 'cleanup cannot claim a later foreign Player fullscreen');
});

test('WebKit inherited root follows the same explicit-exit/owned-cleanup distinction', async () => {
  const f = fixture({webkit: true}); f.current(f.root);
  assert.equal(await f.native.enterFullscreen(f.player), false);
  await f.native.exitFullscreen(); assert.deepEqual(f.calls, []);
  await f.native.exitPlayerFullscreen(); assert.deepEqual(f.calls, ['exit']);
  assert.equal(f.document.webkitFullscreenElement, null);
});
