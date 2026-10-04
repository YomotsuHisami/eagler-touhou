/** Injected geometry/persistence evidence only; does not prove browser or physical-device interaction. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-runtime-viewport-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({
  stdin: {contents: `
    export * from './app/services/runtime-viewport.ts';
    export {createGameZoomController} from './src/launcher/game-zoom.mts';
  `, resolveDir: root, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}],
});
const file = join(directory, 'touch-layout.mjs');
await writeFile(file, bundle.outputFiles[0].text);
const {createRuntimeViewportStore, createGameZoomController} = await import(pathToFileURL(file).href);
const host = {left: 0, top: 0, width: 800, height: 600};
const controls = Object.fromEntries(['focus', 'fire', 'bomb', 'escape'].map((name, i) => [name, {x: .1 * (i + 1), y: .5, scale: 1, priority: i}]));
const layout = {version: 6, profiles: {landscape: {controls, viewport: {x: .2}}, portrait: {controls, viewport: {x: -.15}}}};
function ready(overrides = {}) {
  const store = createRuntimeViewportStore();store.setGeometry(host);
  store.setSession({epoch: 1, touchLayout: layout, magnifierEnabled: true, touchCapable: true, live: true, ...overrides});return store;
}
function legacy() {
  const viewport = {style: {}}, directSurface = {}, noop = () => {};
  const player = {clientWidth: host.width, clientHeight: host.height, getBoundingClientRect: () => host, classList: {remove: noop}};
  const frame = {getBoundingClientRect() {
    const match = viewport.style.transform.match(/translate3d\(([^p]+)px,([^p]+)px,0\) scale\(([^)]+)\)/);
    const [x, y, scale] = match.slice(1).map(Number);return {left: x, top: y, width: host.width * scale, height: host.height * scale};
  }};
  const controller = createGameZoomController({player, frame, viewport, directSurface, toggle: {hidden: false, classList: {remove: noop}}, toggleLabel: {}, scaleLabel: {}, getBaseOffset: () => ({x: .2 * host.width, y: 0}), getResetLabel: () => 'Reset', isAvailable: () => true, minScale: 1, maxScale: 3});
  controller.applyTransform();
  return {controller, directSurface};
}

test('saved horizontal profile offsets follow actual orientation without changing the session', () => {
  const store = ready({magnifierEnabled: false});
  assert.equal(store.getSnapshot().baseX, 160);assert.equal(store.getSnapshot().transform, 'translate3d(160px,0px,0) scale(1)');
  store.setGeometry({left: 0, top: 0, width: 400, height: 800});
  assert.equal(store.getSnapshot().orientation, 'portrait');assert.equal(store.getSnapshot().baseX, -60);assert.equal(store.getSnapshot().epoch, 1);
  const before = store.getSnapshot();assert.equal(store.setGeometry({...host, width: 0}), false);assert.equal(store.getSnapshot(), before);
});

test('host pinch extraction matches main game-zoom transform for anchored moves, clamp and release', () => {
  const store = ready(), old = legacy();
  const events = [
    ['beginPointer', 1, 280, 250], ['beginPointer', 2, 380, 250],
    ['movePointer', 1, 230, 220], ['movePointer', 2, 450, 280],
    ['movePointer', 2, 750, 400], ['movePointer', 1, 500, 450],
  ];
  for (const [action, pointerId, clientX, clientY] of events) {
    store[action]('host', pointerId, clientX, clientY);
    old.controller[action]({pointerId, clientX, clientY, pointerType: 'touch', currentTarget: old.directSurface});
    const expected = old.controller.snapshot(), actual = store.getSnapshot();
    for (const key of ['scale', 'x', 'y', 'pointerCount']) assert.equal(actual[key], expected[key], `${action} ${key}`);
  }
  store.endPointer(1);old.controller.endPointer({pointerId: 1});assert.equal(store.getSnapshot().pointerCount, old.controller.snapshot().pointerCount);
  store.reset();old.controller.reset();assert.equal(store.getSnapshot().transform, 'translate3d(160px,0px,0) scale(1)');
});

test('iframe-local pinch coordinates match main without double-applying the current transform', () => {
  const store = ready(), old = legacy();
  for (const [action, pointerId, clientX, clientY] of [
    ['beginPointer', 1, 150, 200], ['beginPointer', 2, 250, 200], ['movePointer', 2, 350, 230], ['movePointer', 1, 100, 180],
  ]) {
    store[action]('frame', pointerId, clientX, clientY);
    old.controller[action]({pointerId, clientX, clientY, pointerType: 'touch', currentTarget: {}});
    const expected = old.controller.snapshot(), actual = store.getSnapshot();
    for (const key of ['scale', 'x', 'y']) assert.equal(actual[key], expected[key]);
  }
});

test('inactive, suspended, mouse and invalid gestures cannot zoom or leak into another epoch', () => {
  for (const flags of [{magnifierEnabled: false}, {touchCapable: false}, {live: false}]) {
    const store = ready(flags);assert.equal(store.beginPointer('host', 1, 100, 100), false);assert.equal(store.getSnapshot().scale, 1);
  }
  const store = ready();assert.equal(store.beginPointer('host', 1, 100, 100, 'mouse'), false);assert.equal(store.beginPointer('host', 1, NaN, 100), false);
  store.beginPointer('host', 1, 100, 100);store.beginPointer('host', 2, 200, 100);store.movePointer('host', 2, 300, 100);
  assert.equal(store.getSnapshot().scale, 2);store.suspend(true);assert.equal(store.getSnapshot().pointerCount, 0);assert.equal(store.getSnapshot().scale, 2);
  store.movePointer('host', 2, 700, 100);assert.equal(store.getSnapshot().scale, 2);
  store.setSession({epoch: 2, touchLayout: null, magnifierEnabled: true, touchCapable: true, live: true});
  assert.equal(store.getSnapshot().scale, 1);assert.equal(store.getSnapshot().baseX, 0);assert.equal(store.getSnapshot().pointerCount, 0);
});

test('same-epoch preference edits cannot alter captured layout or magnifier authority', () => {
  const captured = structuredClone(layout), store = ready({touchLayout: captured});
  captured.profiles.landscape.viewport.x = -.5;
  store.setSession({epoch: 1, touchLayout: captured, magnifierEnabled: false, touchCapable: true, live: true});
  assert.equal(store.getSnapshot().baseX, 160);assert.equal(store.getSnapshot().active, true);
  store.setSession(null);assert.equal(store.getSnapshot().epoch, null);assert.equal(store.getSnapshot().active, false);assert.equal(store.getSnapshot().baseX, 0);
});

test('measurement publishes one immutable system-controls rectangle shared with toolbar positioning', () => {
  const store = ready(), measured = {left: 688, top: 8, width: 104, height: 48};
  store.setSystemControls(measured);measured.left = 999;
  assert.deepEqual(store.getSnapshot().systemControls, {left: 688, top: 8, width: 104, height: 48});
  assert.ok(Object.isFrozen(store.getSnapshot().systemControls));
  const previous = store.getSnapshot();store.setSystemControls({...measured, width: 0});assert.equal(store.getSnapshot(), previous);
});
