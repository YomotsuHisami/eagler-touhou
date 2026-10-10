/** Pinned main app.mts4504–4510,6933–6945,7433–7449,9490–9527: native
 * fullscreen menu hosts, workbench dismissal and editor lifecycle. Synthetic DOM only;
 * not evidence of real fullscreen top-layer paint or browser focus behavior. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, root, fullscreen, webkitFullscreen;
before(async () => {
  env = installMountedDom();
  React = await import('react'); ({createRoot} = await import('react-dom/client'));
  Object.defineProperty(env.document, 'fullscreenElement', {configurable: true, get: () => fullscreen});
  Object.defineProperty(env.document, 'webkitFullscreenElement', {configurable: true, get: () => webkitFullscreen});
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/touch-editor-selects-'));
  const outfile = resolve(work, 'components.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {MainSelect} from './app/components/launcher/MainSelect.tsx';
    export {TouchLayoutEditor} from './app/components/settings/TouchLayoutEditor.tsx';
    export {createGameSettingsModel} from './app/models/game-settings.ts';
    export {createTouchLayoutModel} from './app/models/touch-layout.ts';
    export {touchLayoutControlNames, touchLayoutControlMeta, normalizeTouchLayoutPriorityOrder} from './src/launcher/touch-layout-model.mts';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) {await React.act(async () => root.unmount()); root = null;}
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 0);
  assert.equal(env.document.querySelectorAll('.mizuki-select').length, 0);
  assert.deepEqual(env.errors.splice(0), []);
  fullscreen = null; webkitFullscreen = null; env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const el = (...args) => React.createElement(...args);
function n(selector) {const node = env.document.querySelector(selector); assert.ok(node, selector); return node;}
async function mount(children) {
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(el(React.StrictMode, null, children)));
}
async function click(target) {await React.act(async () => (typeof target === 'string' ? n(target) : target).click());}
function select() {return el(api.MainSelect, {id: 'hostSelect', className: 'option-select', defaultValue: 'a'}, el('option', {value: 'a'}, 'A'), el('option', {value: 'b'}, 'B'));}

for (const target of ['body', 'player', 'webkit-player', 'root', 'foreign', 'dialog']) test(`Main custom select chooses original ${target} host`, async () => {
  await mount(el('section', {id: 'player'}, target === 'dialog' ? el('dialog', {open: true, id: 'nativeDialog'}, select()) : select()));
  if (target === 'player' || target === 'dialog') fullscreen = n('#player');
  if (target === 'webkit-player') webkitFullscreen = n('#player');
  if (target === 'root') fullscreen = env.document.documentElement;
  if (target === 'foreign') {fullscreen = env.document.createElement('section'); env.document.body.append(fullscreen);}
  await click('.mizuki-select-trigger');
  const menu = n('.mizuki-select-menu:not([hidden])');
  assert.equal(menu.parentElement, target === 'dialog' ? n('#nativeDialog') : ['player', 'webkit-player'].includes(target) ? n('#player') : env.document.body);
  await click(menu.querySelector('[data-value="b"]'));
  assert.equal(n('#hostSelect').value, 'b'); assert.equal(menu.hidden, true);
  assert.equal(env.document.activeElement, n('.mizuki-select-trigger'));
});

test('Main select reopens the same menu in the current fullscreen host', async () => {
  await mount(el('section', {id: 'player'}, select()));
  await click('.mizuki-select-trigger'); const menu = n('.mizuki-select-menu'); assert.equal(menu.parentElement, env.document.body);
  await click('.mizuki-select-trigger'); fullscreen = n('#player');
  await click('.mizuki-select-trigger'); assert.equal(menu.parentElement, n('#player'));
  await click('.mizuki-select-trigger'); fullscreen = null;
  await click('.mizuki-select-trigger'); assert.equal(menu.parentElement, env.document.body);
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 1);
});

async function editor({storage = null} = {}) {
  const player = env.document.createElement('section'); player.id = 'player'; player.innerHTML = '<div id="gameViewport"></div>'; env.document.body.append(player);
  const settings = api.createGameSettingsModel({storage: null});
  settings.hydrate({productId: 'th06', uiLocale: 'en', mobile: false, webMidiAvailable: false, languages: [{id: 'ja'}], musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: false}});
  const model = api.createTouchLayoutModel({storage}); model.hydrate();
  const errors = [], feedback = [];
  const controls = Object.fromEntries(api.touchLayoutControlNames.map((name, index) => [name, {x: .15 + index % 5 * .12, y: .25 + Math.floor(index / 5) * .3, scale: name === 'bomb' ? 1.5 : 1, priority: api.touchLayoutControlMeta[name].priority}]));
  await mount(el(api.TouchLayoutEditor, {playerElement: player, model, settings, actions: {feedback: (...args) => feedback.push(args), reportError: error => errors.push(error), async confirm() {return false;}}, native: {
    async enterFullscreen() {fullscreen = player; return true;}, async exitFullscreen() {fullscreen = null;}, canSwitchOrientation: () => false,
    measureDefaults: () => ({controls: api.normalizeTouchLayoutPriorityOrder(structuredClone(controls)), viewport: {x: 0}}),
  }, onCloseIntent() {throw new Error('Unexpected close');}}));
  for (let i = 0; i < 20 && !model.getSnapshot().isEditing; i++) await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 10));});
  assert.equal(model.getSnapshot().isEditing, true); assert.deepEqual(errors, []);
  return {player, model, settings, errors};
}
async function openMovementMenu() {await click(n('#touchMovementMode').closest('.mizuki-select').querySelector('.mizuki-select-trigger')); return n('.mizuki-select-menu:not([hidden])');}

test('Keyboard-style workbench collapse closes the real fullscreen menu and expansion does not resurrect it', async () => {
  const f = await editor(), menu = await openMovementMenu();
  assert.equal(menu.parentElement, f.player); assert.equal(menu.hidden, false);
  // HTMLElement.click emits no pointerdown: the workbench itself must dismiss
  // the detached menu, rather than relying on the document pointer listener.
  await click('#touchLayoutCollapse');
  assert.equal(n('#touchWorkbenchBody').hidden, true); assert.equal(menu.hidden, true);
  assert.equal(n('#touchMovementMode').closest('.mizuki-select').querySelector('.mizuki-select-trigger').getAttribute('aria-expanded'), 'false');
  await click('#touchLayoutCollapse'); assert.equal(n('#touchWorkbenchBody').hidden, false); assert.equal(menu.hidden, true);
  assert.equal(await openMovementMenu(), menu); assert.deepEqual(f.errors, []);
});

test('Restoring the workbench after viewport adjustment closes its detached select', async () => {
  const f = await editor();
  await click('#touchViewportAdjust'); assert.equal(n('#touchLayoutEditor').hidden, true);
  // A retained/programmatically reopened menu must follow main's explicit
  // syncTouchLayoutWorkbench close when viewport editing finishes.
  const menu = await openMovementMenu(); assert.equal(menu.hidden, false);
  await click('#touchViewportDone'); assert.equal(n('#touchLayoutEditor').hidden, false); assert.equal(menu.hidden, true);
  assert.deepEqual(f.errors, []);
});

async function pointer(type, target, x, y, pointerId = 7) {
  await React.act(async () => target.dispatchEvent(new env.window.PointerEvent(type, {bubbles: true, pointerId, pointerType: 'mouse', button: 0, clientX: x, clientY: y})));
}
for (const reason of ['hidden', 'fullscreen']) test(`Main editor cancels an active control drag on ${reason} transition`, async () => {
  const f = await editor();
  await pointer('pointerdown', n('#touchBomb'), 175, 225);
  await pointer('pointermove', env.document, 207, 241);
  assert.equal(f.player.classList.contains('touch-layout-manipulating'), true);
  const before = structuredClone(f.model.getSnapshot().draft), descriptor = Object.getOwnPropertyDescriptor(env.document, 'hidden');
  try {
    if (reason === 'hidden') Object.defineProperty(env.document, 'hidden', {configurable: true, value: true});
    await React.act(async () => env.document.dispatchEvent(new env.window.Event(reason === 'hidden' ? 'visibilitychange' : 'fullscreenchange')));
    assert.equal(f.player.classList.contains('touch-layout-manipulating'), false);
    await pointer('pointermove', env.document, 300, 320);
    assert.deepEqual(f.model.getSnapshot().draft, before, 'a retired pointer cannot continue moving the draft');
    await pointer('pointerup', env.document, 300, 320);
    assert.deepEqual(f.errors, []);
  } finally {if (descriptor) Object.defineProperty(env.document, 'hidden', descriptor); else delete env.document.hidden;}
});

test('A visibility event while still visible retains main’s active drag', async () => {
  const f = await editor(), descriptor = Object.getOwnPropertyDescriptor(env.document, 'hidden');
  try {
    Object.defineProperty(env.document, 'hidden', {configurable: true, value: false});
    await pointer('pointerdown', n('#touchBomb'), 175, 225);
    const before = structuredClone(f.model.getSnapshot().draft);
    await React.act(async () => env.document.dispatchEvent(new env.window.Event('visibilitychange')));
    await pointer('pointermove', env.document, 207, 241);
    assert.notDeepEqual(f.model.getSnapshot().draft, before);
    await pointer('pointerup', env.document, 207, 241);
    assert.deepEqual(f.errors, []);
  } finally {if (descriptor) Object.defineProperty(env.document, 'hidden', descriptor); else delete env.document.hidden;}
});

test('Same-orientation resize clamps the current workbench position rather than resetting it', async () => {
  const f = await editor(), panel = n('#touchLayoutEditor');
  panel.style.left = '120px'; panel.style.top = '140px';
  panel.getBoundingClientRect = () => new env.window.DOMRect(parseFloat(panel.style.left), parseFloat(panel.style.top), 260, 400);
  await React.act(async () => env.window.dispatchEvent(new env.window.Event('resize')));
  assert.equal(panel.style.left, '120px'); assert.equal(panel.style.top, '140px');
  panel.style.left = '1400px'; panel.style.top = '900px';
  await React.act(async () => env.window.dispatchEvent(new env.window.Event('resize')));
  assert.equal(panel.style.left, '1004px'); assert.equal(panel.style.top, '384px');
  assert.deepEqual(f.errors, []);
});

test('Safe-zone resize and orientation events refresh the real draft; teardown releases both observers', async () => {
  const previousObserver = globalThis.ResizeObserver, orientationDescriptor = Object.getOwnPropertyDescriptor(env.window.screen, 'orientation');
  const width = Object.getOwnPropertyDescriptor(env.document.documentElement, 'clientWidth'), height = Object.getOwnPropertyDescriptor(env.document.documentElement, 'clientHeight');
  const observed = [], orientation = new env.window.EventTarget();
  globalThis.ResizeObserver = class {constructor(callback) {this.callback = callback; observed.push(this);} observe(node) {this.node = node;} disconnect() {this.disconnected = true;}};
  Object.defineProperty(env.window.screen, 'orientation', {configurable: true, value: orientation});
  try {
    const f = await editor(), observer = observed.findLast(value => !value.disconnected);
    assert.equal(observer.node, n('#touchLayoutSafeZone'));
    let revision = f.model.getSnapshot().revision;
    await React.act(async () => observer.callback([]));
    assert.ok(f.model.getSnapshot().revision > revision);
    Object.defineProperty(env.document.documentElement, 'clientWidth', {configurable: true, value: 800});
    Object.defineProperty(env.document.documentElement, 'clientHeight', {configurable: true, value: 1280});
    await React.act(async () => orientation.dispatchEvent(new env.window.Event('change')));
    assert.equal(f.model.getSnapshot().orientation, 'portrait');
    assert.ok(f.model.getSnapshot().draft.profiles.portrait);
    await React.act(async () => root.unmount()); root = null;
    assert.ok(observed.every(value => value.disconnected), 'including the StrictMode-replayed owner');
    revision = f.model.getSnapshot().revision;
    await React.act(async () => {observer.callback([]); orientation.dispatchEvent(new env.window.Event('change'));});
    assert.equal(f.model.getSnapshot().revision, revision, 'retired callbacks cannot mutate the draft');
    assert.deepEqual(f.errors, []);
  } finally {
    globalThis.ResizeObserver = previousObserver;
    if (orientationDescriptor) Object.defineProperty(env.window.screen, 'orientation', orientationDescriptor); else delete env.window.screen.orientation;
    for (const [name, descriptor] of [['clientWidth', width], ['clientHeight', height]]) {if (descriptor) Object.defineProperty(env.document.documentElement, name, descriptor); else delete env.document.documentElement[name];}
  }
});


test('Viewport Done restores the current orientation’s saved workbench position after a hidden rotation', async () => {
  const values = new Map(), storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  const f = await editor({storage}), panel = n('#touchLayoutEditor');
  const width = Object.getOwnPropertyDescriptor(env.document.documentElement, 'clientWidth'), height = Object.getOwnPropertyDescriptor(env.document.documentElement, 'clientHeight');
  panel.getBoundingClientRect = () => panel.hidden ? new env.window.DOMRect(0, 0, 0, 0) : new env.window.DOMRect(parseFloat(panel.style.left), parseFloat(panel.style.top), 260, 400);
  panel.style.left = '120px'; panel.style.top = '140px';
  f.model.windowPositions.set('portrait', 'editor', {x: .25, y: .5});
  try {
    await click('#touchViewportAdjust');
    Object.defineProperty(env.document.documentElement, 'clientWidth', {configurable: true, value: 800});
    Object.defineProperty(env.document.documentElement, 'clientHeight', {configurable: true, value: 1280});
    await React.act(async () => env.window.dispatchEvent(new env.window.Event('resize')));
    assert.equal(f.model.getSnapshot().orientation, 'portrait'); assert.equal(panel.hidden, true);
    await click('#touchViewportDone');
    assert.equal(panel.hidden, false);
    assert.equal(panel.style.left, '263px'); assert.equal(panel.style.top, '200px');
    assert.deepEqual(f.errors, []);
  } finally {
    for (const [name, descriptor] of [['clientWidth', width], ['clientHeight', height]]) {if (descriptor) Object.defineProperty(env.document.documentElement, name, descriptor); else delete env.document.documentElement[name];}
  }
});
