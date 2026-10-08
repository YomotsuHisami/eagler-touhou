/** Injected-clock/pointer policy tests; real pointer capture is covered only in CI. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundled = await build({entryPoints: [join(root, 'app/services/library-gestures.ts')], bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'library-gestures-')); after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'entry.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const {createLibraryGestures, createLibraryRailMotion, libraryIndexWidth} = await import(pathToFileURL(file).href);
const pointer = (patch = {}) => ({pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 100, clientY: 30, ...patch});
test('compact minimap fits short indexes and leaves half of the next 44px target visible', () => {
  assert.equal(libraryIndexWidth(3, 400), 144);
  assert.equal(libraryIndexWidth(6, 400), 282);
  assert.equal(libraryIndexWidth(12, 400), 302);
  assert.equal(libraryIndexWidth(12, 240), 210);
  assert.equal(libraryIndexWidth(12, 90), 72);
});
function fixture(dockChoices = [{id: 'first', center: 100}, {id: 'middle', center: 152}, {id: 'last', center: 204}]) {
  let now = 0, next = 0, selected = 'first', left = 0, visible = true;
  const timers = new Map(), selections = [], opens = [], captures = [], releases = [], states = [];
  let cancels = 0;
  const owner = createLibraryGestures({clock: {now: () => now, set: (callback, delay) => {const id = ++next; timers.set(id, {callback, at: now + delay}); return id;}, clear: id => timers.delete(id)},
    selected: () => selected, select: (id, focus, instant) => {selected = id; selections.push({id, focus, instant});}, open: (id, instant) => opens.push({id, instant}),
    scrollLeft: () => left, scrollTo: value => {left = Math.max(0, Math.min(800, value));}, cancelMotion: () => {cancels++;},
    visible: () => visible, capture: (...args) => captures.push(args), release: (...args) => releases.push(args),
    dockBounds: () => ({top: 10, bottom: 120}), dockChoices: () => dockChoices, changed: state => states.push(state)});
  function advance(ms) {const until = now + ms; for (;;) {const [id, item] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? []; if (!item || item.at > until) break; now = item.at; timers.delete(id); item.callback();} now = until;}
  return {owner, advance, selections, opens, captures, releases, states, timers, visible: value => {visible = value;}, get selected() {return selected;}, get left() {return left;}, get cancels() {return cancels;}};
}
test('mouse rail holds 180ms, captures the original pointer and preserves displacement when dragging starts', () => {
  const f = fixture(); f.owner.railDown(pointer()); f.advance(179); assert.equal(f.captures.length, 0); f.advance(1);
  assert.deepEqual(f.captures, [['rail', 7]]); assert.equal(f.states.at(-1).dragging, true);
  assert.equal(f.owner.move(pointer({clientX: 30})), true); assert.equal(f.left, 70);
  f.owner.up(pointer({clientX: 30, buttons: 0})); assert.equal(f.states.at(-1).dragging, false);
  assert.equal(f.owner.cardClick('first', {}), 'suppressed'); assert.equal(f.opens.length, 0);
});
test('horizontal intent captures immediately; a new short rail press clears the previous release guard', () => {
  const f = fixture(); f.owner.railDown(pointer()); f.owner.move(pointer({clientX: 90})); assert.equal(f.left, 10); assert.equal(f.captures.length, 1);
  f.owner.up(pointer({clientX: 90})); assert.equal(f.owner.cardClick('first', {}), 'suppressed');
  f.owner.railDown(pointer()); f.owner.up(pointer()); assert.equal(f.owner.cardClick('first', {}), 'open');
});
test('native touch rail scrolling and modified clicks never acquire mouse capture', () => {
  const f = fixture(); f.owner.railDown(pointer({pointerType: 'touch'})); f.advance(500); assert.equal(f.captures.length, 0); assert.equal(f.cancels, 1);
  f.owner.railDown(pointer({ctrlKey: true})); f.advance(500); assert.equal(f.captures.length, 0);
  assert.equal(f.owner.cardClick('last', {metaKey: true}), 'native'); assert.equal(f.selected, 'first');
});
test('horizontal/Shift wheels are suppressed, vertical page wheels and browser pinch/zoom are retained', () => {
  const f = fixture();
  assert.equal(f.owner.suppressWheel({ctrlKey: false, shiftKey: false, deltaX: 20}), true);
  assert.equal(f.owner.suppressWheel({ctrlKey: false, shiftKey: true, deltaX: 0}), true);
  assert.equal(f.owner.suppressWheel({ctrlKey: false, shiftKey: false, deltaX: 0}), false);
  assert.equal(f.owner.suppressWheel({ctrlKey: true, shiftKey: true, deltaX: 20}), false);
});
test('solo cards select first and open second; main multiplayer first-click policy is retained', () => {
  const f = fixture(); assert.equal(f.owner.cardClick('last', {}), 'selected'); assert.equal(f.selected, 'last');
  assert.equal(f.owner.cardClick('last', {}), 'open'); assert.equal(f.owner.cardClick('first', {}, true), 'open');
});
test('number hold waits 350ms and captures; scrubbing uses nearest centers through gaps, drift and reverse travel', () => {
  const f = fixture(); f.owner.dockDown('first', pointer()); f.advance(349); assert.equal(f.captures.length, 0); f.advance(1);
  assert.deepEqual(f.captures, [['dock', 7, 'first']]); assert.equal(f.states.at(-1).scrubbing, true);
  f.owner.move(pointer({clientX: 180, clientY: 70})); assert.equal(f.selected, 'last');
  f.owner.move(pointer({clientX: 100, clientY: 70})); assert.equal(f.selected, 'first');
  f.owner.move(pointer({clientX: 204, clientY: 70})); f.owner.up(pointer({clientX: 204, clientY: 70})); assert.equal(f.selected, 'last');
  assert.deepEqual(f.selections.at(-1), {id: 'last', focus: true, instant: false}); f.owner.dockClick('last'); assert.equal(f.opens.length, 0);
});
test('immediate horizontal scrub includes the first movement; excessive vertical drift stays native and cannot click', () => {
  const f = fixture(); f.owner.dockDown('first', pointer()); f.owner.move(pointer({clientX: 204})); assert.equal(f.selected, 'last'); assert.equal(f.captures.length, 1);
  f.owner.up(pointer({clientX: 204})); f.owner.dockDown('first', pointer({pointerId: 8, pointerType: 'touch'}));
  assert.equal(f.owner.move(pointer({pointerId: 8, pointerType: 'touch', clientY: 60})), false); assert.equal(f.states.at(-1).holding, false);
  f.owner.dockClick('last', true); assert.equal(f.opens.length, 0);
});
test('horizontal number scrub selects the nearest visible number despite vertical pointer drift', () => {
  const choices = [{id: 'a', center: 100}, {id: 'b', center: 148}, {id: 'c', center: 196}, {id: 'd', center: 244}];
  const f = fixture(choices);
  f.owner.dockDown('a', pointer({clientX: 100, clientY: 30}));
  assert.equal(f.owner.move(pointer({clientX: 101, clientY: 40})), false);
  assert.equal(f.selected, 'first');
  assert.equal(f.states.at(-1).scrubbing, false);
  f.owner.move(pointer({clientX: 180, clientY: 78}));
  assert.equal(f.selected, 'c', 'horizontal strip chooses the nearest x position');
  assert.equal(f.states.at(-1).scrubbing, true);
  f.owner.up(pointer({clientX: 180, clientY: 78, buttons: 0}));
});
test('new short number press clears scrub suppression, selects a new choice then opens the current choice', () => {
  const f = fixture(); f.owner.dockDown('first', pointer()); f.advance(350); f.owner.move(pointer({clientX: 204})); f.owner.up(pointer({clientX: 204}));
  f.owner.dockDown('first', pointer()); f.owner.up(pointer()); f.owner.dockClick('first'); assert.equal(f.selected, 'first'); assert.equal(f.opens.length, 0);
  f.owner.dockDown('first', pointer()); f.owner.up(pointer()); f.owner.dockClick('first'); assert.deepEqual(f.opens, [{id: 'first', instant: false}]);
});
test('touch scrub settles on release, lost capture suppresses stale click, and all suspension paths cancel timers', () => {
  const f = fixture(); f.owner.dockDown('first', pointer({pointerType: 'touch'})); f.owner.move(pointer({pointerType: 'touch', clientX: 204})); f.owner.up(pointer({pointerType: 'touch', clientX: 204}));
  assert.equal(f.selections.at(-1).instant, true);
  f.owner.dockDown('last', pointer()); f.advance(350); f.owner.lostDock(7); f.owner.dockClick('last'); assert.equal(f.opens.length, 0);
  f.owner.railDown(pointer()); f.owner.suspend(); f.advance(1000); assert.equal(f.timers.size, 0);
  f.owner.dockDown('last', pointer()); f.owner.dispose(); f.advance(1000); assert.equal(f.timers.size, 0); assert.equal(f.states.at(-1).scrubbing, false);
});
test('hidden or removed surfaces cannot begin a delayed capture', () => {
  const f = fixture(); f.owner.dockDown('first', pointer()); f.visible(false); f.advance(350); assert.equal(f.captures.length, 0);
  f.owner.railDown(pointer()); f.advance(180); assert.equal(f.captures.length, 0); f.owner.dispose();
});
test('rail animation retargets from current position, fences cancelled frames and honors live reduced motion', () => {
  let now = 0, value = 0, reduced = false, next = 0; const frames = new Map();
  const motion = createLibraryRailMotion({read: () => value, write: next => {value = next;}, maximum: () => 500, reduced: () => reduced, now: () => now,
    requestFrame: callback => {const id = ++next; frames.set(id, callback); return id;}, cancelFrame: id => frames.delete(id)});
  const frame = at => {now = at; const entries = [...frames]; frames.clear(); for (const [, callback] of entries) callback(now);};
  motion.move(400); frame(120); assert.ok(value > 0 && value < 400); const interrupted = value, stale = [...frames.values()][0];
  motion.move(0); assert.equal(value, interrupted); stale(9999); assert.equal(value, interrupted, 'old frame is fenced'); frame(200); assert.ok(value < interrupted && value > 0);
  reduced = true; frame(201); assert.equal(value, 0); motion.move(999); assert.equal(value, 500); assert.equal(frames.size, 0);
  reduced = false; motion.move(0); motion.settle(-50); frame(9999); assert.equal(value, 0);
});
