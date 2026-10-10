/** Pinned-main differential behavior + real React shelf lifecycles in synthetic
 * DOM only. Native layout, touch physics, artwork and browser QA remain separate. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, React, createRoot, work;
before(async () => {
  const bootstrap = installMountedDom();
  React = await import('react'); ({createRoot} = await import('react-dom/client')); bootstrap.close();
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/library-rail-'));
  const output = resolve(work, 'actual.mjs');
  const pinned = execFileSync('git', ['show', 'edee9633e5e3ee79cd2e1aa334f84f6caf755090:src/launcher/game-library.mts'], {cwd: project, encoding: 'utf8'});
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'tsx', contents: `
    export {initializeGameLibrary, bindLibraryRail, libraryIndexWidth} from './src/launcher/game-library.mts';
    export {initializeGameLibrary as pinnedLibrary, libraryIndexWidth as pinnedWidth} from 'pinned-library';
    export {LibraryCards} from './app/components/launcher/LibraryCards.tsx';
    export {LocaleProvider} from './app/i18n.tsx';
    export {createLibraryProducts} from './app/components/launcher/products.ts';
  `}, outfile: output, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [{
    name: 'pinned-library', setup(ctx) {
      ctx.onResolve({filter: /^pinned-library$/}, () => ({path: 'original', namespace: 'pinned'}));
      ctx.onLoad({filter: /.*/, namespace: 'pinned'}, () => ({loader: 'ts', contents: pinned}));
    },
  }]});
  api = await import(pathToFileURL(output).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const ids = ['th06', 'th07', 'th08', 'th09', 'th10', 'th11', 'th15', 'th20'];
function fixture({reduced = false, coarse = false, lessMotion = false} = {}) {
  const env = installMountedDom(), {window, document} = env;
  let now = 0, serial = 0, canvasReads = 0;
  const timers = new Map(), frames = new Map(), observers = new Set(), listeners = new Set(), scrolls = [], scrollEvents = new Set();
  const globalRestore = new Map();
  function expose(key, value) {globalRestore.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});}
  const originalAdd = window.EventTarget.prototype.addEventListener, originalRemove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    if (![...listeners].some(row => row.target === this && row.type === type && row.listener === listener && row.capture === capture)) listeners.add({target: this, type, listener, capture});
    return originalAdd.call(this, type, listener, options);
  };
  window.EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (const row of listeners) if (row.target === this && row.type === type && row.listener === listener && row.capture === capture) listeners.delete(row);
    return originalRemove.call(this, type, listener, options);
  };
  window.setTimeout = (callback, delay = 0) => {const id = ++serial; timers.set(id, {at: now + delay, callback}); return id;};
  window.clearTimeout = id => timers.delete(id); expose('clearTimeout', window.clearTimeout);
  const nativePerformance = globalThis.performance;
  expose('performance', new Proxy(nativePerformance, {get(target, key) {if (key === 'now') return () => now; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;}}));
  expose('requestAnimationFrame', callback => {const id = ++serial; frames.set(id, callback); return id;});
  expose('cancelAnimationFrame', id => frames.delete(id));
  window.matchMedia = query => ({matches: query.includes('prefers-reduced-motion') ? reduced : query.includes('pointer: coarse') && coarse}); expose('matchMedia', window.matchMedia);
  document.body.classList.toggle('less-motion', lessMotion);
  class ResizeObserver {
    constructor(callback) {this.callback = callback; this.targets = new Set(); observers.add(this);}
    observe(target) {this.targets.add(target);}
    disconnect() {this.targets.clear(); observers.delete(this);}
  }
  expose('ResizeObserver', ResizeObserver);
  const NativeMutationObserver = window.MutationObserver;
  class MutationObserver extends NativeMutationObserver {
    constructor(callback) {super(callback); observers.add(this);}
    disconnect() {super.disconnect(); observers.delete(this);}
  }
  expose('MutationObserver', MutationObserver);
  const oldComputed = globalThis.getComputedStyle;
  expose('getComputedStyle', node => node.classList.contains('minimap-dock') ? {columnGap: '2px', paddingLeft: '4px'} : oldComputed(node));
  const rect = (left, width, top = 10, height = 44) => new window.DOMRect(left, top, width, height);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hidden || this.closest('[hidden]')) return rect(0, 0, 0, 0);
    if (this.classList.contains('game')) {
      const rail = this.parentElement, index = [...rail.querySelectorAll('.game:not([hidden])')].indexOf(this);
      return rect(20 + index * 250 - rail.scrollLeft, 240, 70, 360);
    }
    if (this.classList.contains('minimap-toggle')) {
      const dock = this.parentElement, index = [...dock.querySelectorAll('.minimap-toggle:not([hidden])')].indexOf(this);
      return rect(24 + index * 46 - dock.scrollLeft, 44);
    }
    if (this.classList.contains('minimap-dock')) return rect(20, parseFloat(this.parentElement.style.width) || 260);
    return rect(20, 260);
  };
  window.HTMLElement.prototype.getClientRects = function () {return this.hidden || this.closest('[hidden]') ? [] : [this.getBoundingClientRect()];};
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {configurable: true, get() {
    if (this.classList.contains('game-rail')) return this.querySelectorAll('.game:not([hidden])').length * 250;
    if (this.classList.contains('minimap-dock')) return this.querySelectorAll('.minimap-toggle:not([hidden])').length * 46 + 6;
    return this.clientWidth;
  }});
  window.HTMLElement.prototype.scrollTo = function ({left, behavior}) {
    this.scrollLeft = Math.max(0, Math.min(Math.max(0, this.scrollWidth - this.clientWidth), left));
    scrolls.push({owner: this.className, left: this.scrollLeft, behavior});
    // Native scroll events are queued after scrollTo returns, never reentrant.
    scrollEvents.add(this);
  };
  window.HTMLElement.prototype.hasPointerCapture = function (id) {return this.captured === id;};
  window.HTMLElement.prototype.setPointerCapture = function (id) {this.captured = id;};
  window.HTMLElement.prototype.releasePointerCapture = function () {delete this.captured;};
  window.HTMLCanvasElement.prototype.getContext = function () {return {
    drawImage() {}, getImageData() {canvasReads++; return {data: new Uint8ClampedArray([255, 0, 0, 255, 240, 15, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255])};},
  };};
  function advance(ms) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 16);
      const scrolled = [...scrollEvents]; scrollEvents.clear(); for (const node of scrolled) node.dispatchEvent(new window.Event('scroll'));
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback();
      const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(now);
    }
  }
  const pointer = (target, type, x = 46, extra = {}) => target.dispatchEvent(new window.PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: x, clientY: 30, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra}));
  function close() {
    // The independent pinned page controller intentionally has no disposal API.
    // Remove its synthetic document listeners when retiring the fixture page.
    for (const row of listeners) originalRemove.call(row.target, row.type, row.listener, row.capture);
    for (const observer of observers) observer.disconnect();
    timers.clear(); frames.clear(); scrollEvents.clear();
    window.EventTarget.prototype.addEventListener = originalAdd; window.EventTarget.prototype.removeEventListener = originalRemove;
    for (const [key, value] of globalRestore) {if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];}
    const errors = env.errors.slice(); env.close(); assert.deepEqual(errors, []);
  }
  return {...env, timers, frames, observers, listeners, scrolls, advance, pointer, close, get canvasReads() {return canvasReads;},
    resize(target) {for (const observer of [...observers]) if (observer.targets?.has(target)) observer.callback([], observer);},
    count(target, type) {return [...listeners].filter(row => row.target === target && row.type === type).length;}};
}
function shelf(f, names = ids, {artwork = false} = {}) {
  const element = f.document.createElement('section'); element.className = 'game-shelf';
  element.innerHTML = `<div class="game-rail">${names.map(id => `<a class="game" data-product="${id}" href="/?game=${id}">${artwork ? `<span class="card-art"><img class="card-art-image" src="/fixtures/shared-cover.png"></span>` : ''}${id}</a>`).join('')}</div><div class="shelf-minimap"><div class="minimap-dock">${names.map(id => `<button class="minimap-toggle" data-minimap-preview="${id}">${id}</button>`).join('')}</div></div>`;
  f.document.body.append(element);
  if (artwork) for (const image of element.querySelectorAll('img')) Object.defineProperties(image, {naturalWidth: {value: 32}, complete: {value: true}});
  return element;
}
function nodes(element) {return {rail: element.querySelector('.game-rail'), root: element.querySelector('.shelf-minimap'), dock: element.querySelector('.minimap-dock'), cards: [...element.querySelectorAll('.game')], buttons: [...element.querySelectorAll('.minimap-toggle')]};}
function describe(f, element) {
  const {rail, root, dock, cards, buttons} = nodes(element);
  return {hidden: element.hidden, rail: {className: rail.className, left: rail.scrollLeft},
    index: {className: root.className, width: root.style.width, hidden: root.hidden, dockClass: dock.className, left: dock.scrollLeft},
    cards: cards.map(card => ({className: card.className, hidden: card.hidden, accent: card.style.getPropertyValue('--cover-accent')})),
    buttons: buttons.map(button => ({className: button.className, hidden: button.hidden, current: button.getAttribute('aria-current'), captured: button.captured ?? null})),
    focus: f.document.activeElement?.dataset.product ?? f.document.activeElement?.dataset.minimapPreview ?? '',
    timerDelays: [...f.timers.values()].map(value => value.at), frames: f.frames.size};
}
async function trace(kind, operation, options = {}) {
  const f = fixture(options), first = shelf(f, ids, {artwork: true}), second = shelf(f, ['th06mp', 'th07mp']);
  const events = [], opened = [];
  for (const card of f.document.querySelectorAll('.game')) card.addEventListener('click', event => {event.preventDefault(); opened.push(card.dataset.product);});
  const controller = (kind === 'pinned' ? api.pinnedLibrary : api.initializeGameLibrary)({onSelectionChange: id => events.push(id), ...options});
  try {return structuredClone(await operation(f, first, second, events, opened, controller));} finally {controller.dispose?.(); f.close();}
}
async function compare(operation, options) {
  const expected = await trace('pinned', operation, options), actual = await trace('canonical', operation, options);
  assert.deepEqual(actual, expected); return actual;
}
const key = (f, node, value, extra = {}) => node.dispatchEvent(new f.window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...extra}));

test('document-wide shared owner preserves pinned initialization, callback order, external selection, filtering and cover palette', async () => {
  const result = await compare(async (f, first, second, selected, opened, owner) => {
    const snapshots = [describe(f, first), describe(f, second)];
    owner.selectProduct('th07'); snapshots.push(describe(f, first), describe(f, second));
    owner.selectProduct('th07mp'); snapshots.push(describe(f, first), describe(f, second));
    const {cards} = nodes(first); cards[1].hidden = true; await Promise.resolve(); snapshots.push(describe(f, first));
    return {snapshots, selected, opened, scrolls: f.scrolls};
  }, {initialProduct: 'th07'});
  assert.deepEqual(result.selected, ['th07', 'th06mp', 'th07mp', 'th06']);
  assert.equal(result.snapshots[0].cards[0].accent, 'hsl(2 62% 78%)');
});

for (const options of [{}, {reduced: true}, {lessMotion: true}, {alignSelectionOnResize: true}]) test(`pinned browsing, keyboard, resize and native scroll timing ${JSON.stringify(options)}`, async () => {
  await compare((f, first, second, selected, opened) => {
    const {rail, cards, buttons, dock} = nodes(first), snapshots = [];
    cards[1].click(); snapshots.push(describe(f, first)); cards[1].click();
    cards[2].dispatchEvent(new f.window.MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true}));
    cards[1].focus(); key(f, rail, 'ArrowRight'); snapshots.push(describe(f, first));
    key(f, rail, 'End'); key(f, rail, 'Home');
    buttons[0].focus(); key(f, buttons[0], 'End'); snapshots.push(describe(f, first)); key(f, buttons[7], 'ArrowLeft'); key(f, buttons[6], 'Home'); key(f, buttons[0], 'Escape');
    f.advance(64); rail.dispatchEvent(new f.window.Event('scroll')); f.advance(112); snapshots.push(describe(f, first)); f.advance(16); snapshots.push(describe(f, first));
    rail.scrollLeft = 125; f.resize(rail); snapshots.push(describe(f, first));
    dock.scrollTo({left: 60, behavior: 'instant'}); f.advance(128); snapshots.push(describe(f, first));
    const wheel = values => {const event = new f.window.WheelEvent('wheel', {cancelable: true, ...values}); rail.dispatchEvent(event); return event.defaultPrevented;};
    return {selected, opened, snapshots, scrolls: f.scrolls, wheels: [{deltaY: 20}, {deltaX: 20}, {shiftKey: true}, {ctrlKey: true, deltaX: 20}].map(wheel)};
  }, options);
});
for (const end of ['release', 'cancel', 'blur', 'pagehide', 'lostcapture']) test(`pinned long-hold edge scrub and ${end} retirement`, async () => {
  await compare((f, first, second, selected, opened) => {
    const {buttons, root} = nodes(first), snapshots = [];
    f.pointer(buttons[0], 'pointerdown'); f.advance(336); snapshots.push(describe(f, first)); f.advance(16); snapshots.push(describe(f, first));
    f.pointer(f.document, 'pointermove', 276); f.advance(1200); snapshots.push(describe(f, first));
    f.pointer(f.document, 'pointermove', 21); f.advance(1200); f.pointer(f.document, 'pointermove', 276); f.advance(160);
    if (end === 'release') f.pointer(f.document, 'pointerup', 276);
    else if (end === 'cancel') f.pointer(f.document, 'pointercancel', 276);
    else if (end === 'lostcapture') f.pointer(buttons[0], 'lostpointercapture');
    else f.window.dispatchEvent(new f.window.Event(end));
    snapshots.push(describe(f, first)); f.advance(400); snapshots.push(describe(f, first));
    buttons.find(button => button.getAttribute('aria-current') === 'true').click();
    return {selected, opened, snapshots, frames: f.frames.size, holding: root.classList.contains('is-holding'), scrolls: f.scrolls};
  });
});
for (const movement of ['horizontal', 'vertical', 'mouse-drag']) test(`pinned ${movement} intent and post-gesture activation suppression`, async () => {
  await compare((f, first, second, selected, opened) => {
    const {buttons, cards, rail} = nodes(first), snapshots = [];
    if (movement === 'mouse-drag') {
      f.pointer(rail, 'pointerdown', 180, {pointerType: 'mouse', clientY: 90}); f.advance(176); snapshots.push(describe(f, first)); f.advance(16);
      f.pointer(f.document, 'pointermove', 70, {pointerType: 'mouse', clientY: 90}); f.pointer(f.document, 'pointerup', 70, {pointerType: 'mouse', clientY: 90}); cards[1].click();
    } else {
      f.pointer(buttons[0], 'pointerdown'); f.pointer(f.document, 'pointermove', movement === 'horizontal' ? 180 : 46, movement === 'vertical' ? {clientY: 90} : {});
      f.advance(352); snapshots.push(describe(f, first)); f.pointer(f.document, 'pointerup', 180); buttons[3].click();
    }
    snapshots.push(describe(f, first)); f.advance(512); cards[1].click(); cards[1].click();
    return {selected, opened, snapshots, scrolls: f.scrolls};
  });
});

test('scoped binding leaves the other shelf untouched and disposal retires observers, timers, captures and listeners', () => {
  const f = fixture(), first = shelf(f), second = shelf(f), selections = [];
  const original = describe(f, second), controller = api.bindLibraryRail(first, {onSelectionChange: id => selections.push(id)});
  try {
    assert.deepEqual({...describe(f, second), timerDelays: []}, original, 'scoped binding cannot initialize a different shelf');
    const {buttons} = nodes(first); f.pointer(buttons[0], 'pointerdown'); f.advance(352); f.pointer(f.document, 'pointermove', 276); f.advance(160);
    assert.equal(buttons[0].hasPointerCapture(1), true); assert.ok(f.frames.size); assert.ok(f.observers.size);
    controller.dispose(); const retired = describe(f, first), count = selections.length;
    assert.equal(buttons[0].hasPointerCapture(1), false); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0, [...f.timers.values()].map(row => String(row.callback)).join('\n')); assert.equal(f.observers.size, 0);
    assert.equal(f.count(f.document, 'pointermove'), 0); assert.equal(f.count(f.window, 'blur'), 0);
    f.advance(1000); f.pointer(f.document, 'pointermove', 21); buttons[1].click();
    assert.deepEqual(describe(f, first), retired); assert.equal(selections.length, count); controller.dispose();
  } finally {controller.dispose(); f.close();}
});

async function mountShelf(f, {variant = 'singleplayer', products = api.createLibraryProducts(ids, () => '', id => `/?game=${id}`).map(product => ({...product, artwork: null})), strict = false, selectedProduct, ...callbacks} = {}) {
  const host = f.document.createElement('div'); f.document.body.append(host); const root = createRoot(host), selected = [], activated = [];
  const render = (changes = {}) => {
    const view = React.createElement(api.LocaleProvider, {locale: 'en'}, React.createElement(api.LibraryCards, {products, variant, selectedProduct,
      onSelect: id => selected.push(id), onActivate: id => activated.push(id), ...callbacks, ...changes}));
    return strict ? React.createElement(React.StrictMode, null, view) : view;
  };
  await React.act(async () => {root.render(render());});
  return {host, root, selected, activated, element: host.querySelector('.game-shelf'), async update(props) {await React.act(async () => {root.render(render(props));});},
    async unmount() {await React.act(async () => {root.unmount();}); host.remove();}};
}
test('launcher and directory render identical cards and retain identity when the page context changes', async () => {
  const f = fixture(); let owner;
  try {
    const products = api.createLibraryProducts(['th06mp', 'th07mp'], path => `https://launcher.invalid/${path}`, id => `/?game=${id}`);
    owner = await mountShelf(f, {products, variant: 'multiplayer', selectedProduct: 'th06mp'});
    const originals = nodes(owner.element).cards;
    const markup = originals.map(card => card.outerHTML);
    assert.ok(originals.every(card => card.querySelector('.card-art-shade') && card.querySelector('.game-title') && card.querySelector('.no-label')));
    for (const variant of ['lobby', 'singleplayer', 'multiplayer']) {
      await owner.update({variant});
      assert.deepEqual(nodes(owner.element).cards.map(card => card.outerHTML), markup, variant);
      assert.equal(nodes(owner.element).cards[0], originals[0], 'same cover keeps its DOM owner');
      assert.equal(f.count(f.document, 'pointermove'), 2, 'context changes keep one interaction owner');
      for (const button of nodes(owner.element).buttons) assert.ok(f.document.getElementById(button.getAttribute('aria-describedby')));
    }
  } finally {await owner?.unmount(); f.close();}
});
for (const variant of ['multiplayer', 'lobby']) test(`directory filtering is an explicit interaction purpose, independent of card appearance (${variant})`, async () => {
  const f = fixture(); let owner;
  try {
    const products = api.createLibraryProducts(['th06mp', 'th07mp'], () => '', id => `/?game=${id}`).map(product => ({...product, artwork: null}));
    owner = await mountShelf(f, {products, variant, selectBeforeActivate: true, selectedProduct: 'th06mp'});
    const card = nodes(owner.element).cards[1];
    await React.act(async () => card.click()); assert.deepEqual(owner.selected, ['th07mp']); assert.deepEqual(owner.activated, []);
    await React.act(async () => card.click()); assert.deepEqual(owner.activated, ['th07mp']);
  } finally {await owner?.unmount(); f.close();}
});
for (const strict of [false, true]) test(`actual React two-root shelf isolation, selection and teardown, StrictMode=${strict}`, async () => {
  const f = fixture(); let first, second;
  try {
    first = await mountShelf(f, {strict}); second = await mountShelf(f, {strict, variant: 'lobby', selectedProduct: 'th08'});
    assert.deepEqual(first.selected, [], 'startup preview must not overwrite host business selection'); assert.deepEqual(second.selected, []);
    assert.equal(f.count(f.document, 'pointermove'), 4, 'two native pointer owners per mounted shelf'); assert.equal(f.count(f.window, 'blur'), 2);
    const firstNodes = nodes(first.element), secondNodes = nodes(second.element), secondBefore = describe(f, second.element);
    await React.act(async () => {firstNodes.cards[1].click();});
    assert.deepEqual(first.selected, ['th07']); assert.deepEqual(first.activated, []); assert.deepEqual(describe(f, second.element).cards, secondBefore.cards);
    await React.act(async () => {firstNodes.cards[1].click();}); assert.deepEqual(first.activated, ['th07']);
    const card = firstNodes.cards[1]; await first.update({selectedProduct: 'th08'}); assert.equal(nodes(first.element).cards[1], card, 'selection keeps React card identity');
    assert.equal(first.element.querySelector('.nav-preview').dataset.game, 'th08'); assert.deepEqual(second.selected, []);
    await React.act(async () => {f.pointer(firstNodes.buttons[0], 'pointerdown'); f.advance(352); f.pointer(f.document, 'pointermove', 276); f.advance(160);});
    assert.ok(f.frames.size); await first.unmount(); first = null;
    assert.equal(f.frames.size, 0); assert.equal(f.count(f.document, 'pointermove'), 2); assert.equal(f.count(f.window, 'blur'), 1);
    await React.act(async () => {secondNodes.buttons[3].click();}); assert.deepEqual(second.selected, ['th09']);
    await second.unmount(); second = null;
    assert.equal(f.timers.size, 0, [...f.timers.values()].map(row => String(row.callback)).join('\n')); assert.equal(f.frames.size, 0); assert.equal(f.observers.size, 0); assert.equal(f.count(f.document, 'pointermove'), 0); assert.equal(f.count(f.window, 'blur'), 0);
  } finally {await first?.unmount(); await second?.unmount(); f.close();}
});

test('actual React membership changes rebind one owner, preserve remaining cards and never duplicate selection callbacks', async () => {
  const f = fixture(); let owner;
  try {
    const products = api.createLibraryProducts(['th06', 'th07', 'th08'], () => '', id => `/?game=${id}`).map(product => ({...product, artwork: null}));
    owner = await mountShelf(f, {strict: true, products, selectedProduct: 'th06'});
    const card = nodes(owner.element).cards[1];
    await owner.update({products: products.map(product => ({...product, hidden: product.id === 'th06'})), selectedProduct: 'th07'});
    assert.equal(nodes(owner.element).cards[1], card); assert.equal(owner.element.querySelector('.nav-preview').dataset.game, 'th07');
    assert.equal(f.count(f.document, 'pointermove'), 2); assert.equal(f.observers.size, 3);
    await React.act(async () => {nodes(owner.element).cards[2].click();}); assert.deepEqual(owner.selected, ['th08']); assert.deepEqual(owner.activated, []);
    await React.act(async () => {nodes(owner.element).cards[2].click();}); assert.deepEqual(owner.activated, ['th08']);
    await owner.unmount(); owner = null; assert.equal(f.observers.size, 0); assert.equal(f.timers.size, 0, [...f.timers.values()].map(row => String(row.callback)).join('\n'));
  } finally {await owner?.unmount(); f.close();}
});
