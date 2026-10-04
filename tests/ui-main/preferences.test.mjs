/** Owner-boundary tests with injected storage/metadata, not browser or Runtime evidence. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-preferences-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({
  stdin: {contents: `
    export * from './app/services/preferences.client.ts';
    export * from './app/components/GameSettings.tsx';
    export * from './src/launcher/game-preferences.mts';
    export * from './src/launcher/multiplayer-preferences.mts';
    export {createElement} from 'react';
    export {renderToStaticMarkup} from 'react-dom/server';
  `, resolveDir: root, loader: 'tsx'},
  bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false, jsx: 'automatic',
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}],
});
const modulePath = join(directory, 'preferences.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const {
  createPreferencesStore, GameSettingsProvider, GameSettings, GameSettingsForm, createElement, renderToStaticMarkup,
  gamePreferenceStorageKey, languagePreferenceStorageKey, sharedTouchPreferenceStorageKey,
  multiplayerShareSettingsStorageKey, SHARED_TOUCH_OPTION_NAMES,
} = await import(pathToFileURL(modulePath).href);

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); this.reads = []; this.writes = []; }
  getItem(key) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes.push([key, value]); this.values.set(key, value); }
  json(key) { return JSON.parse(this.values.get(key)); }
}
const context = () => ({uiLocale: 'en', hostFeatures: {thprac: true, focusHitbox: true}});
function load(store, product) { store.loadProduct(product); return store.getSnapshot(product); }

test('creating, subscribing and snapshot reads have no storage I/O; SSR does not read browser globals', () => {
  const storage = new MemoryStorage();
  const store = createPreferencesStore({storage, context});
  const unsubscribe = store.subscribe(() => {});
  assert.equal(store.getSnapshot('th06'), null);
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.writes, []);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('SSR localStorage access'); }});
  try {
    const html = renderToStaticMarkup(createElement(GameSettingsProvider, {storage}, createElement(GameSettings, {productId: 'th06'})));
    assert.match(html, /role="status"/);
    assert.deepEqual(storage.reads, []);
    assert.deepEqual(storage.writes, []);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
    unsubscribe();
  }
});

test('uses canonical storage keys and first-selected product to initialize shared touch', () => {
  const storage = new MemoryStorage({
    [gamePreferenceStorageKey('th11')]: JSON.stringify({music: 'midi', options: {touchSensitivity: 212, touchEnabled: true, restartButtonEnabled: true}}),
    [languagePreferenceStorageKey('th11')]: 'lang_en',
  });
  const store = createPreferencesStore({storage, context});
  assert.equal(load(store, 'th11').options.touchSensitivity, 212);
  assert.equal(storage.json(sharedTouchPreferenceStorageKey).touchSensitivity, 212);
  assert.deepEqual(Object.keys(storage.json(sharedTouchPreferenceStorageKey)), [...SHARED_TOUCH_OPTION_NAMES]);
  const other = load(store, 'th06');
  assert.equal(other.options.touchSensitivity, 212);
  assert.equal(other.options.restartButtonEnabled, true);
  assert.equal(other.options.touchEnabled, false);
  store.setOption('th11', 'frameLimit60Enabled', true);
  assert.equal(storage.json('eagler-touhou-game-options-v1-th11').options.frameLimit60Enabled, true);
  assert.equal(storage.values.get('eagler-touhou-language-v1-th11'), 'lang_en');
  assert.equal(storage.json(gamePreferenceStorageKey('th11')).music, 'midi', 'unresolved music metadata must preserve saved intent');
  assert.equal(storage.values.has(gamePreferenceStorageKey('th06')), false);
});

test('MP defaults to SP sharing; separate mode falls back once then stays isolated', () => {
  const storage = new MemoryStorage();
  const store = createPreferencesStore({storage, context});
  load(store, 'th07'); load(store, 'th07mp'); load(store, 'th06mp');
  store.setOption('th07', 'frameLimit60Enabled', true);
  assert.equal(store.getSnapshot('th07mp').preferenceId, 'th07');
  assert.equal(store.getSnapshot('th07mp').options.frameLimit60Enabled, true);
  store.setShareSingleplayerSettings('th07mp', false);
  assert.equal(storage.values.get(multiplayerShareSettingsStorageKey('th07mp')), '0');
  assert.equal(store.getSnapshot('th07mp').preferenceId, 'th07mp');
  assert.equal(store.getSnapshot('th07mp').options.frameLimit60Enabled, true, 'missing MP profile falls back to SP');
  store.setOption('th07mp', 'frameLimit60Enabled', false);
  assert.equal(store.getSnapshot('th07').options.frameLimit60Enabled, true);
  assert.equal(storage.json(gamePreferenceStorageKey('th07mp')).options.frameLimit60Enabled, false);
  store.setShareSingleplayerSettings('th07mp', true);
  assert.equal(store.getSnapshot('th07mp').options.frameLimit60Enabled, true);
  store.setShareSingleplayerSettings('th07mp', false);
  assert.equal(store.getSnapshot('th07mp').options.frameLimit60Enabled, false);
  assert.equal(store.getSnapshot('th06mp').shareSingleplayerSettings, true, 'sharing flag is product-specific');
});

test('global touch edits publish one coherent snapshot generation to repeated forms', () => {
  const store = createPreferencesStore({storage: new MemoryStorage(), context});
  load(store, 'th06'); load(store, 'th07mp'); load(store, 'th11');
  const initial = store.getSnapshot('th06');
  assert.equal(store.getSnapshot('th06'), initial, 'snapshot identity is stable until mutation');
  assert.ok(Object.isFrozen(initial.options));
  const observations = [];
  const readForms = () => observations.push(['th06', 'th07mp', 'th11'].map(product => store.getSnapshot(product).options.touchSensitivity));
  const stopFirst = store.subscribe(readForms);
  const stopSecond = store.subscribe(readForms);
  store.setOption('th07mp', 'touchSensitivity', 237.6);
  assert.deepEqual(observations, [[238, 238, 238]], 'Set deduplicates the same callback');
  assert.notEqual(store.getSnapshot('th06'), initial);
  store.setOption('th06', 'touchEnabled', true);
  assert.equal(store.getSnapshot('th07mp').options.touchEnabled, false);
  assert.equal(store.getSnapshot('th11').options.touchEnabled, false);
  stopFirst(); stopSecond();
  const count = observations.length;
  store.setOption('th11', 'touchSensitivity', 500);
  assert.equal(store.getSnapshot('th06').options.touchSensitivity, 300);
  assert.equal(observations.length, count);
});

test('repeated independent subscribers all observe global touch changes and unsubscribe cleanly', () => {
  const store = createPreferencesStore({context});
  load(store, 'th06'); load(store, 'th06mp');
  const first = [], second = [];
  const stopFirst = store.subscribe(() => first.push(store.getSnapshot('th06').options.touchFocusMode));
  const stopSecond = store.subscribe(() => second.push(store.getSnapshot('th06mp').options.touchFocusMode));
  store.setOption('th06', 'touchFocusMode', 'two-finger');
  assert.deepEqual(first, ['two-finger']); assert.deepEqual(second, ['two-finger']);
  stopFirst();
  store.setOption('th06mp', 'touchMovementMode', 'joystick');
  assert.deepEqual(first, ['two-finger']); assert.deepEqual(second, ['two-finger', 'hold-button']);
  stopSecond();
});

test('canonical joystick/focus normalization, clamping and retired-key cleanup remain authoritative', () => {
  const storage = new MemoryStorage({
    [gamePreferenceStorageKey('th06')]: JSON.stringify({options: {
      limitPresentationTo60: true, th06FocusHitbox: true, enhanceLocalPlayerVisibility: true,
      unlimitedTouch: true, touchSensitivity: 450, touchFocusMode: 'two-finger',
    }}),
  });
  const store = createPreferencesStore({storage, context});
  const initial = load(store, 'th06');
  assert.equal(initial.options.frameLimit60Enabled, false);
  assert.equal(initial.options.focusHitboxEnabled, true);
  assert.equal(initial.options.touchSensitivity, 300);
  assert.equal(initial.options.touchMovementMode, 'touch-unlimited');
  store.setOption('th06', 'touchMovementMode', 'joystick-free');
  assert.equal(store.getSnapshot('th06').options.touchFocusMode, 'hold-button');
  store.setOption('th06', 'touchSensitivity', 12);
  assert.equal(store.getSnapshot('th06').options.touchSensitivity, 100);
  store.setOption('th06', 'limitPresentationTo60', true);
  const saved = storage.json(gamePreferenceStorageKey('th06')).options;
  for (const retired of ['limitPresentationTo60', 'th06FocusHitbox', 'enhanceLocalPlayerVisibility', 'unlimitedTouch']) assert.equal(Object.hasOwn(saved, retired), false);
});

test('unresolved Host fails closed; concrete Host and catalog ceiling both gate features', () => {
  const storage = new MemoryStorage({[gamePreferenceStorageKey('th06')]: JSON.stringify({options: {thpracEnabled: true, focusHitboxEnabled: true}})});
  const store = createPreferencesStore({storage, context: () => ({uiLocale: 'zh-CN'})});
  assert.deepEqual(load(store, 'th06').features, {thprac: false, focusHitbox: false});
  assert.equal(store.getSnapshot('th06').options.thpracEnabled, false);
  store.setOption('th06', 'thpracEnabled', true);
  store.setContext(() => ({uiLocale: 'zh-CN', hostFeatures: {thprac: false, focusHitbox: false}}));
  assert.equal(store.getSnapshot('th06').features.thprac, false);
  store.setContext(() => ({uiLocale: 'zh-CN', hostFeatures: {thprac: true, focusHitbox: true}}));
  assert.equal(store.getSnapshot('th06').options.thpracEnabled, true);
  assert.equal(store.getSnapshot('th06').features.focusHitbox, true);
  assert.equal(load(store, 'th09').features.thprac, false, 'Host cannot raise the product ceiling');
  assert.equal(load(store, 'th07').features.focusHitbox, false);
  assert.equal(load(store, 'th06mp').features.thprac, false, 'MP cannot expose practice');
  store.setOption('th06mp', 'frameLimit60Enabled', true);
  assert.equal(store.getSnapshot('th06').options.thpracEnabled, true, 'MP edits must not erase shared SP practice preference');
  store.setContext(() => ({hostFeatures: {}}));
  assert.equal(store.getSnapshot('th06').features.thprac, true, 'known legacy Host keeps canonical missing-field compatibility');
  assert.throws(() => store.loadProduct('th20'), /unavailable/, 'hidden products stay hidden');
});

test('language and music remain unresolved until injected real metadata; unsupported choices never persist', () => {
  const storage = new MemoryStorage({[languagePreferenceStorageKey('th07')]: 'lang_en'});
  const store = createPreferencesStore({storage, context});
  const unresolved = load(store, 'th07');
  assert.equal(unresolved.language, null); assert.equal(unresolved.music, null);
  assert.deepEqual(unresolved.languages, []); assert.deepEqual(unresolved.musicModes, []);
  store.setLanguage('th07', 'made-up'); store.setMusic('th07', 'midi');
  store.setOption('th07', 'frameLimit60Enabled', true);
  assert.equal(storage.values.get(languagePreferenceStorageKey('th07')), 'lang_en');
  assert.equal(storage.json(gamePreferenceStorageKey('th07')).musicPreferenceExplicit, false);
  store.setContext(() => ({...context(),
    languageCatalog: [{id: 'ja', title: '日本語'}, {id: 'lang_en', title: 'English'}],
    musicAvailability: {audio: true, midiAvailable: true, importServer: true, remoteOggAdvertised: true},
  }));
  assert.equal(store.getSnapshot('th07').language, 'lang_en');
  assert.deepEqual(store.getSnapshot('th07').musicModes, ['midi', 'none'], 'import mode cannot invent remote OGG');
  store.setMusic('th07', 'ogg-full');
  assert.equal(storage.json(gamePreferenceStorageKey('th07')).musicPreferenceExplicit, false);
  store.setMusic('th07', 'midi'); store.setLanguage('th07', 'ja');
  assert.equal(storage.json(gamePreferenceStorageKey('th07')).music, 'midi');
  assert.equal(storage.json(gamePreferenceStorageKey('th07')).musicPreferenceExplicit, true);
  assert.equal(storage.values.get(languagePreferenceStorageKey('th07')), 'ja');
  assert.deepEqual(load(store, 'th11').musicModes, ['none'], 'MIDI is bounded by current product metadata');
});

test('no language key is fabricated while metadata is unknown; MP language uses canonical fallback', () => {
  const storage = new MemoryStorage();
  const store = createPreferencesStore({storage, context});
  load(store, 'th06'); store.setOption('th06', 'touchEnabled', true);
  assert.equal(storage.values.has(languagePreferenceStorageKey('th06')), false);
  const seeded = new MemoryStorage({
    [languagePreferenceStorageKey('th07')]: 'lang_en',
    [multiplayerShareSettingsStorageKey('th07mp')]: '0',
  });
  const other = createPreferencesStore({storage: seeded, context: () => ({languageCatalog: [{id: 'ja'}, {id: 'lang_en'}]})});
  assert.equal(load(other, 'th07mp').language, 'lang_en');
  other.setLanguage('th07mp', 'ja');
  assert.equal(seeded.values.get(languagePreferenceStorageKey('th07mp')), 'ja');
  assert.equal(seeded.values.get(languagePreferenceStorageKey('th07')), 'lang_en');
});

test('storage failures and corrupt JSON preserve usable, coherent in-memory preferences', () => {
  const storage = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }};
  const store = createPreferencesStore({storage, context});
  load(store, 'th06'); load(store, 'th07mp');
  assert.doesNotThrow(() => store.setOption('th06', 'touchSensitivity', 189));
  assert.equal(store.getSnapshot('th07mp').options.touchSensitivity, 189);
  store.setShareSingleplayerSettings('th07mp', false);
  assert.equal(store.getSnapshot('th07mp').preferenceId, 'th07mp');
  const corrupt = createPreferencesStore({storage: new MemoryStorage({[gamePreferenceStorageKey('th06')]: '{invalid', [sharedTouchPreferenceStorageKey]: '[]'})});
  assert.equal(load(corrupt, 'th06').options.touchSensitivity, 150);
});

test('controlled repeated forms have unique labeled native controls and reflect normalized shared state', () => {
  const store = createPreferencesStore({context});
  load(store, 'th06'); load(store, 'th06mp');
  store.setOption('th06', 'touchMovementMode', 'joystick');
  const html = renderToStaticMarkup(createElement('div', null,
    ...['th06', 'th06mp'].map(product => createElement(GameSettingsForm, {key: product, store, settings: store.getSnapshot(product)}))));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'repeated forms never reuse control IDs');
  for (const id of [...html.matchAll(/<(?:input|select) id="([^"]+)"/g)].map(match => match[1])) {
    assert.ok(html.includes(`<label for="${id}"`), `missing label for ${id}`);
  }
  assert.equal((html.match(/<form /g) ?? []).length, 2);
  assert.equal((html.match(/<legend /g) ?? []).length, 4);
  assert.equal((html.match(/type="range" min="100" max="300" step="1" disabled=""/g) ?? []).length, 2);
  assert.equal((html.match(/<option value="two-finger" disabled=""/g) ?? []).length, 2);
  assert.equal((html.match(/启用 thprac/g) ?? []).length, 1, 'MP form hides practice capability');
  assert.equal((html.match(/与单机共用设置/g) ?? []).length, 1);
  assert.doesNotMatch(html, /limitPresentationTo60|unlimitedTouch|th06FocusHitbox|enhanceLocalPlayerVisibility/);
});
