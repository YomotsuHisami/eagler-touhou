/** Synthetic browser ports and source assertions; no browser execution. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'ui-motion-preference-'));
after(() => rm(folder, {recursive: true, force: true}));
const bundled = await build({entryPoints: [join(root, 'app/services/motion-preference.client.ts')], bundle: true, platform: 'browser', format: 'esm', write: false});
const file = join(folder, 'motion.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const {createMotionPreferenceStore, DEFAULT_MOTION_PREFERENCE, LESS_MOTION_STORAGE_KEY, REDUCED_MOTION_QUERY} = await import(pathToFileURL(file).href);
function fixture({stored = null, reduced = false, storageDenied = false, readDenied = false, writeDenied = false} = {}) {
  const calls = {writes: [], queries: [], reads: 0}, events = new Map(), mediaEvents = new Set();
  const values = new Map(stored === null ? [] : [[LESS_MOTION_STORAGE_KEY, stored]]);
  const storage = {getItem(key) {calls.reads++;if (readDenied) throw Error('read denied');return values.get(key) ?? null;},
    setItem(key, value) {calls.writes.push([key, value]);if (writeDenied) throw Error('write denied');values.set(key, value);}};
  const media = {matches: reduced, addEventListener(type, fn) {assert.equal(type, 'change');mediaEvents.add(fn);}, removeEventListener(type, fn) {mediaEvents.delete(fn);}};
  const browser = {get localStorage() {if (storageDenied) throw Error('storage denied');return storage;},
    matchMedia(query) {calls.queries.push(query);return media;},
    addEventListener(type, fn) {assert.equal(type, 'storage');events.set(fn, type);}, removeEventListener(type, fn) {events.delete(fn);}};
  return {store: createMotionPreferenceStore({getBrowser: () => browser}), values, calls, events, mediaEvents, storage,
    system(value, notify = true) {media.matches = value;if (notify) for (const fn of mediaEvents) fn();},
    stored(value, key = LESS_MOTION_STORAGE_KEY, storageArea = storage) {
      if (storageArea === storage) {if (key === null) values.clear();else if (value === null) values.delete(key);else values.set(key, value);}
      for (const fn of events.keys()) fn({key, newValue: value, storageArea});
    }};
}
test('SSR snapshot is stable, immutable and never accesses browser globals', () => {
  let accesses = 0;const store = createMotionPreferenceStore({getBrowser() {accesses++;return null;}});
  assert.equal(store.getServerSnapshot(), DEFAULT_MOTION_PREFERENCE);assert.equal(accesses, 0);
  assert.equal(Object.isFrozen(store.getServerSnapshot()), true);assert.equal(store.getSnapshot().reducedMotion, false);
});
test('legacy key accepts only 1; full motion is the default with no viewport sniffing', () => {
  assert.equal(LESS_MOTION_STORAGE_KEY, 'eagler-touhou-less-motion-v1');
  for (const stored of [null, '', '0', 'true', 'garbage', '1']) {
    const f = fixture({stored});const snapshot = f.store.getSnapshot();
    assert.equal(snapshot.lessMotion, stored === '1');assert.equal(snapshot.reducedMotion, stored === '1');
    assert.ok(f.calls.queries.length > 0);assert.ok(f.calls.queries.every(query => query === REDUCED_MOTION_QUERY));assert.equal(f.calls.writes.length, 0);
    assert.equal(f.store.getSnapshot(), snapshot);
  }
});
test('user toggles persist 1/0, notify once, and reload from the existing storage', () => {
  const f = fixture();let changes = 0;const unsubscribe = f.store.subscribe(() => changes++);
  f.store.toggle();assert.equal(f.store.getSnapshot().lessMotion, true);f.store.setLessMotion(true);assert.equal(changes, 1);
  assert.equal(fixture({stored: f.values.get(LESS_MOTION_STORAGE_KEY)}).store.getSnapshot().lessMotion, true);
  f.store.toggle();assert.equal(changes, 2);assert.deepEqual(f.calls.writes.at(-1), [LESS_MOTION_STORAGE_KEY, '0']);unsubscribe();
});
test('OS reduction always wins, changes live and never rewrites the saved user choice', () => {
  const f = fixture({stored: '1'});const unsubscribe = f.store.subscribe(() => {});
  f.system(true);f.store.setLessMotion(false);
  assert.deepEqual(f.store.getSnapshot(), {lessMotion: false, systemReducedMotion: true, reducedMotion: true});
  f.system(false);assert.equal(f.store.getSnapshot().reducedMotion, false);
  assert.deepEqual(f.calls.writes, [[LESS_MOTION_STORAGE_KEY, '0']]);unsubscribe();
});
test('cross-tab updates and clears synchronize, unrelated keys/session storage do not', () => {
  const f = fixture();let changes = 0;const unsubscribe = f.store.subscribe(() => changes++);
  f.stored('1');assert.equal(f.store.getSnapshot().lessMotion, true);assert.equal(changes, 1);
  f.stored('0', 'other');f.stored('0', LESS_MOTION_STORAGE_KEY, {});assert.equal(changes, 1);
  f.system(true);f.stored(null, null);
  assert.deepEqual(f.store.getSnapshot(), {lessMotion: false, systemReducedMotion: true, reducedMotion: true});
  assert.equal(f.calls.writes.length, 0);unsubscribe();
});
test('blocked access/read/write preserves a working document-only toggle across resubscriptions', () => {
  for (const options of [{storageDenied: true}, {readDenied: true}, {writeDenied: true}]) {
    const f = fixture(options);let unsubscribe = f.store.subscribe(() => {});
    f.store.setLessMotion(true);assert.equal(f.store.getSnapshot().reducedMotion, true);unsubscribe();
    unsubscribe = f.store.subscribe(() => {});assert.equal(f.store.getSnapshot().lessMotion, true);
    f.system(true);f.store.setLessMotion(false);assert.equal(f.store.getSnapshot().reducedMotion, true);unsubscribe();
  }
});
test('subscribers share one listener pair and clean up completely; remount refreshes missed external changes', () => {
  const f = fixture();const first = f.store.subscribe(() => {}), second = f.store.subscribe(() => {});
  assert.equal(f.events.size, 1);assert.equal(f.mediaEvents.size, 1);first();assert.equal(f.events.size, 1);second();
  assert.equal(f.events.size, 0);assert.equal(f.mediaEvents.size, 0);
  f.stored('1');f.system(true);const third = f.store.subscribe(() => {});
  assert.deepEqual(f.store.getSnapshot(), {lessMotion: true, systemReducedMotion: true, reducedMotion: true});third();
});
test('React Motion, retained dialogs, library utilities and localized header share the same owner', async () => {
  const read = path => readFile(join(root, path), 'utf8');
  const [rootSource, adapter, dialog, shell, css] = await Promise.all(['app/root.tsx', 'app/components/MotionPreferenceProvider.tsx', 'app/components/AnimatedDialog.tsx', 'app/components/LauncherShell.tsx', 'app/styles.css'].map(read));
  assert.match(rootSource, /<MotionPreferenceProvider>/);assert.match(rootSource, /browser-compatibility-gate/);
  assert.match(adapter, /useSyncExternalStore\(motionPreferenceStore\.subscribe, motionPreferenceStore\.getSnapshot, motionPreferenceStore\.getServerSnapshot\)/);
  assert.match(adapter, /reducedMotion=\{preference\.reducedMotion \? 'always' : 'user'\}/);
  assert.match(adapter, /documentElement\.dataset\.reducedMotion = String\(preference\.reducedMotion\)/);
  assert.match(dialog, /const \{reducedMotion\} = useMotionPreference\(\)/);assert.doesNotMatch(dialog, /matchMedia\(['"]\(prefers-reduced-motion|key=\{reducedMotion/);
  assert.match(dialog, /const panelMedia = '\(max-width: 780px\)'/, 'the independent geometry query does not replace the shared motion preference');
  assert.match(dialog, /data-dialog-layout=\{layout\}/);assert.match(dialog, /duration: reducedMotion \? 0 : panel \? \.48 : \.18/);
  assert.match(shell, /id="lessMotionToggle"[^>]*aria-pressed=\{lessMotion\}/);assert.match(shell, /'nav.motionFullTitle' : 'nav.motionLessTitle'/);
  assert.match(shell, /onClick=\{motionPreferenceStore\.toggle\}/);assert.match(shell, /t\('nav.lessMotion'\)/);
  assert.match(css, /@custom-variant motion-reduce/);assert.match(css, /@custom-variant motion-safe/);assert.match(css, /data-reduced-motion="true"/);
  assert.doesNotMatch(bundled.outputFiles[0].text, /innerWidth|userAgent|pointer:|hover:|max-width/);
});

test('Runtime toolbar has a live explicit motion policy without Runtime or child remount keys', async () => {
  const source = await readFile(join(root, 'app/runtime/RuntimeControls.tsx'), 'utf8');
  assert.match(source, /const \{reducedMotion\} = useMotionPreference\(\)/);
  assert.match(source, /toolbarAnimation\.start\(\{opacity: 1, y: 0, transition: \{duration: reducedMotion \? 0 : \.18\}\}\)/);
  assert.match(source, /y: reducedMotion \? 0 : -8/);
  assert.match(source, /data-reduced-motion=\{reducedMotion\}/);
  assert.doesNotMatch(source, /key=\{reducedMotion/);
});


test('a persistent subscriber does not make new dialog reads wait for the queued OS change event', () => {
  const f = fixture({reduced: true});let notifications = 0;
  const unsubscribe = f.store.subscribe(() => notifications++);
  const reduced = f.store.getSnapshot();
  f.system(false, false); // Browser state changed; MediaQueryList change is still queued.
  const restored = f.store.getSnapshot();
  assert.deepEqual(restored, {lessMotion: false, systemReducedMotion: false, reducedMotion: false});
  assert.notEqual(restored, reduced);assert.equal(f.store.getSnapshot(), restored);
  assert.equal(notifications, 0, 'render-time reads must not notify other React subscribers');
  f.system(false);
  assert.equal(notifications, 1, 'the queued event still publishes a synchronously observed snapshot');
  f.system(true, false);
  assert.equal(f.store.getSnapshot().reducedMotion, true, 'reduction is also immediate in the opposite direction');
  assert.equal(notifications, 1);
  const unsubscribeNewDialog = f.store.subscribe(() => {});
  assert.equal(notifications, 2, 'a new subscription publishes pending reads during commit');
  f.system(true);assert.equal(notifications, 2, 'the later event does not duplicate the published update');
  unsubscribeNewDialog();unsubscribe();
});
