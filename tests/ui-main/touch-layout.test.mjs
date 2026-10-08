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
const directory = await mkdtemp(join(root, '.cache/ui-touch-layout-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({
  stdin: {contents: `
    export * from './app/services/touch-layout.client.ts';
    export * from './src/launcher/touch-layout-model.mts';
    export {touchLayoutWindowPositionsStorageKey} from './src/launcher/touch-layout-editor-state.mts';
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
const {createTouchLayoutStore, measuredDefaultTouchProfile, effectiveTouchPlacement, touchRectOverlap,
  canEditTouchLayout, touchLayoutStorageKey, touchLayoutControlNames, touchLayoutWindowPositionsStorageKey} = await import(pathToFileURL(file).href);
class MemoryStorage {
  constructor(seed = {}) {this.values = new Map(Object.entries(seed));this.reads = [];this.writes = [];this.removes = [];}
  getItem(key) {this.reads.push(key);return this.values.get(key) ?? null;}
  setItem(key, value) {this.writes.push([key, value]);this.values.set(key, value);}
  removeItem(key) {this.removes.push(key);this.values.delete(key);}
  json(key) {return JSON.parse(this.values.get(key));}
}
function geometry(orientation = 'landscape') {
  return {orientation, safe: {left: 8, top: 8, width: orientation === 'landscape' ? 984 : 484, height: orientation === 'landscape' ? 684 : 884},
    controls: Object.fromEntries(touchLayoutControlNames.map((name, index) => [name, {left: 20 + index * 70, top: 200 + index * 40, width: 50, height: 40}]))};
}
function ready(storage = new MemoryStorage()) {const store = createTouchLayoutStore({storage});store.load();store.setGeometry(geometry());return store;}

test('layout editing follows launch state and leaves a prepared Runtime editable', () => {
  assert.equal(canEditTouchLayout(null), true);
  assert.equal(canEditTouchLayout({phase: 'prepared', launched: false}), true);
  assert.equal(canEditTouchLayout({phase: 'loading', launched: false}), true);
  assert.equal(canEditTouchLayout({phase: 'configuring', launched: false}), true);
  assert.equal(canEditTouchLayout({phase: 'launching', launched: false}), false);
  assert.equal(canEditTouchLayout({phase: 'running', launched: true}), false);
  assert.equal(canEditTouchLayout({phase: 'error', launched: false}), true);
});

test('construction and snapshot observation never read storage; geometry is measured, complete and immutable', () => {
  const storage = new MemoryStorage(), store = createTouchLayoutStore({storage});
  assert.equal(store.getSnapshot().loaded, false);
  assert.deepEqual(storage.reads, []);
  const stop = store.subscribe(() => {});
  assert.deepEqual(storage.reads, []);
  store.load();
  const measured = geometry();store.setGeometry(measured);
  assert.equal(store.getSnapshot().profile.controls.focus.x, (20 + 25 - 8) / 984);
  assert.equal(store.getSnapshot().profile.controls.focus.y, (200 + 20 - 8) / 684);
  assert.equal(store.getSnapshot().dirty, false, 'measuring an unmodified default must not dirty the layout');
  assert.equal(store.getSnapshot().saved, null);
  assert.deepEqual(storage.writes, []);
  assert.ok(Object.isFrozen(store.getSnapshot().profile.controls.focus));
  const old = store.getSnapshot();store.setGeometry(measured);assert.equal(store.getSnapshot(), old);
  stop();
});

test('invalid or hidden geometry fails closed and leaves the previous snapshot usable', () => {
  const store = ready(), previous = store.getSnapshot();
  const invalid = geometry();invalid.controls.fire.width = 0;
  assert.throws(() => store.setGeometry(invalid), /尺寸不可用/);
  assert.equal(store.getSnapshot(), previous);
  assert.throws(() => measuredDefaultTouchProfile({...geometry(), safe: {left: 0, top: 0, width: 0, height: 100}}), /尺寸不可用/);
});

test('dragging and scaling use main safe bounds and persist only the canonical shared layout key', () => {
  const storage = new MemoryStorage({'unrelated-settings': 'preserved'}), store = ready(storage);
  store.moveControl('fire', 1e5, -1e5);
  store.updateControl('fire', {scale: 10});
  const current = store.getSnapshot(), item = current.profile.controls.fire;
  assert.equal(item.scale, 1.8);
  assert.equal(item.x, 1 - (50 * 1.8 / 2 + 6) / 984);
  assert.equal(item.y, (40 * 1.8 / 2 + 6) / 684);
  assert.equal(current.dirty, true);
  assert.equal(store.save(), true);
  assert.equal(store.getSnapshot().dirty, false);
  assert.deepEqual(storage.writes.map(([key]) => key), [touchLayoutStorageKey]);
  const saved = storage.json(touchLayoutStorageKey);
  assert.equal(saved.version, 6);
  assert.equal(saved.profiles.portrait, null);
  assert.equal(storage.values.get('unrelated-settings'), 'preserved');
  const reopened = ready(storage);
  assert.deepEqual(reopened.getSnapshot().profile.controls.fire, item);
});

test('orientation profiles stay isolated and reset removes the override only after the last profile is default', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.moveControl('bomb', 80, 0);store.setViewport(.25);store.save();
  const landscape = store.getSnapshot().saved.profiles.landscape;
  store.setGeometry(geometry('portrait'));store.moveControl('bomb', -30, 20);store.setViewport(-.3);store.save();
  assert.deepEqual(store.getSnapshot().saved.profiles.landscape, landscape);
  store.resetOrientation();assert.equal(store.getSnapshot().dirty, true);store.save();
  assert.equal(store.getSnapshot().saved.profiles.portrait, null);
  assert.deepEqual(store.getSnapshot().saved.profiles.landscape, landscape);
  store.setGeometry(geometry());store.resetOrientation();store.save();
  assert.equal(store.getSnapshot().saved, null);
  assert.deepEqual(storage.removes, [touchLayoutStorageKey]);
});

test('preview orientation selection edits each saved profile without overwriting its counterpart', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.moveControl('bomb', 80, 0);store.save();
  const landscape = store.getSnapshot().saved.profiles.landscape;
  store.setPreviewOrientation('portrait');
  assert.equal(store.getSnapshot().orientation, 'portrait');
  store.moveControl('bomb', -30, 20);store.save();
  const portrait = store.getSnapshot().saved.profiles.portrait;
  assert.notDeepEqual(portrait, landscape);
  store.setPreviewOrientation('landscape');
  assert.deepEqual(store.getSnapshot().profile, landscape);
  store.moveControl('bomb', -10, 0);store.save();
  const updatedLandscape = store.getSnapshot().saved.profiles.landscape;
  assert.deepEqual(store.getSnapshot().saved.profiles.portrait, portrait);
  store.setPreviewOrientation('portrait');
  assert.deepEqual(store.getSnapshot().profile, portrait);
  assert.notDeepEqual(updatedLandscape, portrait);
});

test('legacy missing optional controls adopt measured geometry without moving saved buttons or falsely dirtying', () => {
  const controls = Object.fromEntries(['focus', 'fire', 'bomb', 'escape'].map((name, index) => [name, {x: .3 + index / 10, y: .5, scale: 1.2, priority: index}]));
  const storage = new MemoryStorage({[touchLayoutStorageKey]: JSON.stringify({version: 3, profiles: {landscape: {controls, viewport: {x: .1}}, portrait: null}})});
  const store = ready(storage), initial = store.getSnapshot();
  assert.equal(initial.dirty, false);
  assert.equal(initial.profile.controls.fire.x, .4);
  assert.equal(initial.profile.controls.fire.scale, 1.2);
  assert.ok(initial.profile.controls.function);
  assert.deepEqual(storage.writes, []);
  store.moveControl('function', 10, 0);store.save();
  assert.equal(storage.json(touchLayoutStorageKey).version, 6);
  assert.equal(storage.json(touchLayoutStorageKey).profiles.landscape.controls.fire.x, .4);
  assert.deepEqual(Object.keys(storage.json(touchLayoutStorageKey).profiles.landscape.controls).sort(), [...touchLayoutControlNames].sort());
});

test('bringing buttons forward keeps the canonical thprac internal ordering and normalizes all priorities', () => {
  const store = ready();
  store.bringToFront('thpracTab');
  let controls = store.getSnapshot().profile.controls;
  assert.ok(controls.thpracMenu.priority > controls.thpracTab.priority);
  store.bringToFront('bomb');controls = store.getSnapshot().profile.controls;
  assert.equal(controls.bomb.priority, Object.keys(controls).length - 1);
  assert.ok(controls.thpracMenu.priority > controls.thpracTab.priority);
  assert.deepEqual(Object.values(controls).map(item => item.priority).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('failed save retains dirty draft and prior baseline so navigation cannot discard on a failed write', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.moveControl('fire', 10, 0);store.save();
  const saved = store.getSnapshot().saved;
  store.moveControl('fire', 80, 0);
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = () => {throw new Error('quota');};
  assert.equal(store.save(), false);
  assert.equal(store.getSnapshot().dirty, true);
  assert.equal(store.getSnapshot().persistence, 'session');
  assert.deepEqual(store.getSnapshot().saved, saved);
  const draft = store.getSnapshot().draft;
  storage.setItem = originalSet;
  assert.equal(store.save(), true);
  assert.equal(store.getSnapshot().dirty, false);
  assert.deepEqual(store.getSnapshot().saved, draft);
  store.moveControl('fire', 50, 0);store.discard();
  assert.deepEqual(store.getSnapshot().saved, draft);
  assert.deepEqual(store.getSnapshot().draft, draft);
});

test('failed reset removal remains dirty and session-only memory never claims a durable save', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.moveControl('fire', 10, 0);store.save();store.resetOrientation();
  storage.removeItem = () => {throw new Error('denied');};
  assert.equal(store.save(), false);assert.equal(store.getSnapshot().dirty, true);
  store.discard();assert.equal(store.getSnapshot().dirty, false);
  const memory = createTouchLayoutStore();memory.load();memory.setGeometry(geometry());memory.moveControl('fire', 10, 0);
  assert.equal(memory.save(), false);assert.equal(memory.getSnapshot().dirty, true);
});

test('invalid mutations, selecting a control, and viewport resize do not alter saved layout', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.select('fire');store.updateControl('fire', {scale: NaN});store.moveControl('bomb', Infinity, 0);store.setViewport(NaN);
  const bigger = geometry();bigger.safe.width *= 2;store.setGeometry(bigger);
  assert.equal(store.getSnapshot().dirty, false);assert.deepEqual(storage.writes, []);
  store.setViewport(50);assert.equal(store.getSnapshot().profile.viewport.x, .5);
  store.setViewport(-50);assert.equal(store.getSnapshot().profile.viewport.x, -.5);
});

test('overlap warnings use rendered clamped rectangles and only the visible control set', () => {
  const store = ready();
  store.updateControl('fire', {x: .5, y: .5});store.updateControl('bomb', {x: .5, y: .5});
  assert.deepEqual(new Set(store.overlappingControls(['fire', 'bomb'])), new Set(['fire', 'bomb']));
  assert.deepEqual(store.overlappingControls(['fire']), []);
  const next = geometry();next.reserved = store.getSnapshot().controls.fire.rect;store.setGeometry(next);
  assert.deepEqual(store.overlappingControls(['fire']), ['fire']);
  assert.equal(touchRectOverlap({left: 0, top: 0, width: 10, height: 10}, {left: 20, top: 20, width: 10, height: 10}), 0);
  const clamped = effectiveTouchPlacement({x: 0, y: 1, scale: 1, priority: 0}, {left: 0, top: 0, width: 1000, height: 1000}, {left: 0, top: 0, width: 100, height: 100});
  assert.equal(clamped.x, .48);assert.equal(clamped.y, .52);
});

test('workbench movement reuses canonical orientation-scoped storage without dirtying the layout', () => {
  const storage = new MemoryStorage(), store = ready(storage);
  store.setWorkbenchPosition({x: .2, y: .3});
  assert.equal(store.getSnapshot().dirty, false);
  assert.deepEqual(storage.json(touchLayoutWindowPositionsStorageKey).profiles.landscape.editor, {x: .2, y: .3});
  store.setGeometry(geometry('portrait'));assert.equal(store.getSnapshot().workbench, null);
  store.setWorkbenchPosition({x: 2, y: -2});
  assert.deepEqual(store.getSnapshot().workbench, {x: 1, y: 0});
  store.setGeometry(geometry());assert.deepEqual(store.getSnapshot().workbench, {x: .2, y: .3});
  assert.equal(storage.values.has(touchLayoutStorageKey), false);
});
