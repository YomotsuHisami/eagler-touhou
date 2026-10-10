/** Main7088–7095/9523–9526, actual Player layout-update binding. Synthetic
 * event targets/ResizeObserver/RAF only; not device geometry or browser proof. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, bindPlayerLayoutUpdates;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-player-layout-'));
  const outfile = resolve(work, 'layout.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts',
    contents: "export {bindPlayerLayoutUpdates} from './app/services/player-input.ts';"}, outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{name: 'main-authored-mts', setup(context) {context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
      return source.replaceAll('\\', '/').startsWith(resolve(project, 'src').replaceAll('\\', '/') + '/') && existsSync(authored) ? {path: authored} : undefined;
    });}}],
  });
  ({bindPlayerLayoutUpdates} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

function fixture({optional = true, fail = false} = {}) {
  const window = new EventTarget(), viewport = new EventTarget(), orientation = new EventTarget();
  const safeZone = {}, frames = new Map(), measured = [], observers = []; let serial = 0, current = 'portrait';
  Object.assign(window, {visualViewport: optional ? viewport : null, screen: {orientation: optional ? orientation : undefined},
    requestAnimationFrame(callback) {const id = ++serial; frames.set(id, callback); return id;}, cancelAnimationFrame(id) {frames.delete(id);}});
  if (optional) window.ResizeObserver = class {
    constructor(callback) {this.callback = callback; this.target = null; this.disconnected = false; observers.push(this);}
    observe(target) {this.target = target;}
    disconnect() {this.disconnected = true;}
  };
  const owner = bindPlayerLayoutUpdates({window, safeZone, applyLayout() {if (fail) throw new Error('layout failed'); measured.push(current);}});
  return {owner, window, viewport, orientation, safeZone, frames, measured, observers,
    setMetrics(value) {current = value;}, frame() {const batch = [...frames]; frames.clear(); for (const [,callback] of batch) callback(0);}};
}

test('window, visual viewport, screen orientation and observed safe-zone changes apply current layout', () => {
  const f = fixture(); assert.equal(f.observers[0].target, f.safeZone);
  f.window.dispatchEvent(new Event('resize')); f.viewport.dispatchEvent(new Event('resize'));
  f.setMetrics('landscape'); f.orientation.dispatchEvent(new Event('change')); f.observers[0].callback();
  assert.deepEqual(f.measured, ['portrait', 'portrait', 'landscape', 'landscape']);
  f.owner.dispose(); assert.equal(f.observers[0].disconnected, true);
});

test('successful explicit orientation continuation waits exactly two RAFs and uses then-current metrics', async () => {
  const f = fixture(); let settled = false;
  const result = f.owner.relayoutAfterOrientation().then(value => {settled = true; return value;});
  assert.equal(f.frames.size, 1); assert.deepEqual(f.measured, []);
  f.frame(); await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(f.measured, []);
  f.setMetrics('landscape'); f.frame(); assert.equal(await result, true);
  assert.deepEqual(f.measured, ['landscape']); assert.equal(f.frames.size, 0); f.owner.dispose();
});

test('cleanup cancels either pending frame and settles every waiting orientation caller without late writes', async () => {
  for (const firstFrameCompleted of [false, true]) {
    const f = fixture(), first = f.owner.relayoutAfterOrientation(), second = f.owner.relayoutAfterOrientation();
    if (firstFrameCompleted) f.frame();
    f.owner.dispose(); assert.equal(await first, false); assert.equal(await second, false); assert.equal(f.frames.size, 0);
    f.window.dispatchEvent(new Event('resize')); f.viewport.dispatchEvent(new Event('resize')); f.orientation.dispatchEvent(new Event('change'));
    f.observers[0].callback(); f.frame(); assert.deepEqual(f.measured, []);
    assert.equal(await f.owner.relayoutAfterOrientation(), false); f.owner.dispose();
  }
});

test('optional orientation/observer/visual viewport absence retains window and two-frame behavior', async () => {
  const f = fixture({optional: false}); f.window.dispatchEvent(new Event('resize'));
  const result = f.owner.relayoutAfterOrientation(); f.frame(); f.frame();
  assert.equal(await result, true); assert.deepEqual(f.measured, ['portrait', 'portrait']); f.owner.dispose();
});

test('explicit relayout errors reject the awaiting original orientation failure owner', async () => {
  const f = fixture({fail: true}), result = f.owner.relayoutAfterOrientation();
  f.frame(); f.frame(); await assert.rejects(result, /layout failed/);
  assert.equal(f.frames.size, 0); f.owner.dispose();
});
