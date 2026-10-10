import {pinnedUiAuthorityText} from './source-text.mjs';
/** Mounted synthetic DOM only. No browser, authored-CSS, rendering or device claim. */
import test, {before, beforeEach, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {installMountedDom} from './mounted-dom-environment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const require = createRequire(resolve(project, 'package.json'));
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${pinnedMain}:${path}`], {cwd: project, encoding: 'utf8'});
const originalTimers = Object.fromEntries(['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map(key => [key, globalThis[key]]));
const mounts = new Set();
let env, React, createRoot, owners, buildDirectory, baselineHTML, clock;
let reduced = false, documentHidden = false, stageWidth = 320, stageHeight = 200, animations = [];

before(async () => {
  env = installMountedDom();
  globalThis.matchMedia = env.window.matchMedia = query => ({matches: reduced, media: query, addEventListener() {}, removeEventListener() {}});
  Object.defineProperty(env.document, 'hidden', {configurable: true, get: () => documentHidden});
  const originalRect = env.window.HTMLElement.prototype.getBoundingClientRect;
  env.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('focus-stage')) return new env.window.DOMRect(100, 200, stageWidth, stageHeight);
    if (this.classList.contains('demo-player')) return new env.window.DOMRect(160, 300, 20, 20);
    return originalRect.call(this);
  };
  env.window.HTMLElement.prototype.animate = function (frames, options) {
    const record = {node: this, frames, options, onfinish: null, cancelled: false, finished: false,
      cancel() {this.cancelled = true;},
      finish() {if (this.cancelled || this.finished) return; this.finished = true; this.onfinish?.();}};
    animations.push(record);
    return record;
  };
  React = await import(pathToFileURL(require.resolve('react')));
  ({createRoot} = await import(pathToFileURL(require.resolve('react-dom/client'))));
  // The baseline translation helper is valid only while the copy catalog is unchanged.
  assert.equal(pinnedUiAuthorityText(readFileSync(resolve(project, 'src/launcher/i18n.mts'), 'utf8')), pinned('src/launcher/i18n.mts'));
  baselineHTML = pinned('public/index.html');
  buildDirectory = await mkdtemp(resolve(here, 'touch-help-build-'));
  await require('esbuild').build({absWorkingDir: project,
    stdin: {resolveDir: project, loader: 'ts', contents: `
      export * from './app/components/player/TouchHelp.tsx';
      export * from './app/i18n.tsx';
    `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    outfile: resolve(buildDirectory, 'bundle.mjs'), logLevel: 'silent',
    plugins: [{name: 'dependencies-and-existing-mts', setup(context) {
      context.onResolve({filter: /^[^./]/}, args => ({path: pathToFileURL(require.resolve(args.path)).href, external: true}));
      context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
        const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
        if (existsSync(path)) return {path};
      });
    }}],
  });
  owners = await import(pathToFileURL(resolve(buildDirectory, 'bundle.mjs')));
});

beforeEach(() => {
  reduced = false; documentHidden = false; stageWidth = 320; stageHeight = 200; animations = [];
  clock = installClock();
});
afterEach(async () => {
  try {
    for (const mount of [...mounts]) await mount.unmount();
    assert.equal(clock.timers.size, 0, 'Unmount must release every tutorial timer and interval');
    assert.equal(animations.filter(animation => !animation.cancelled && !animation.finished).length, 0, 'Unmount must cancel unfinished shot animations');
    assert.deepEqual(env.errors.splice(0), [], 'No React or synthetic DOM errors');
  } finally {
    Object.assign(globalThis, originalTimers);
    env.document.body.replaceChildren();
  }
});
after(async () => {
  env?.close();
  if (buildDirectory) await rm(buildDirectory, {recursive: true, force: true});
});

function installClock() {
  let now = 0, serial = 0;
  const timers = new Map(), created = [];
  const schedule = (kind, fn, delay = 0, args) => {
    const id = ++serial, timer = {id, kind, fn: () => fn(...args), delay: Number(delay), at: now + Number(delay)};
    timers.set(id, timer); created.push(timer); return id;
  };
  globalThis.setTimeout = (fn, delay, ...args) => schedule('timeout', fn, delay, args);
  globalThis.setInterval = (fn, delay, ...args) => schedule('interval', fn, delay, args);
  globalThis.clearTimeout = globalThis.clearInterval = id => timers.delete(id);
  return {timers, created, get now() {return now;}, async advance(ms) {
    const end = now + ms;
    await React.act(async () => {
      let iterations = 0;
      while (true) {
        const next = [...timers.values()].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        assert.ok(++iterations <= 1000, 'Bounded synthetic timer advancement');
        now = next.at;
        if (next.kind === 'interval') next.at += next.delay;
        else timers.delete(next.id);
        next.fn();
      }
      now = end;
    });
  }};
}

const el = (...args) => React.createElement(...args);
function n(selector, scope = env.document) {const node = scope.querySelector(selector); assert.ok(node, `Missing ${selector}`); return node;}
const panel = name => n(`[data-guide-panel="${name}"]`);
const body = name => n('.guide-demo-body', panel(name));
const tab = name => n(`[data-guide-tab="${name}"]`);
const shotNodes = () => [...env.document.querySelectorAll('.demo-shot')];
async function click(selector) {await React.act(async () => n(selector).click());}
async function openGuide(name) {await click(`[data-guide-tab="${name}"]`);}
async function replay(name) {await click(`[data-guide-panel="${name}"] .guide-replay`);}
function expanded(name) {
  for (const element of env.document.querySelectorAll('[data-guide-panel]')) {
    const selected = element.dataset.guidePanel === name;
    assert.equal(n('.guide-tab-card', element).getAttribute('aria-expanded'), String(selected));
    assert.equal(n('.guide-demo-body', element).hidden, !selected);
  }
}
async function mount(initial = {}, {locale = 'en', strict = false, controlledClose = false} = {}) {
  let props = {open: true, touchEnabled: true, focusMode: 'hold-button', showIosFullscreenHelp: false, ...initial};
  const container = env.document.createElement('section'); container.id = 'player'; container.className = 'player-fixture';
  env.document.body.append(container);
  const root = createRoot(container);
  const result = {root, container, closes: 0, get props() {return props;},
    async update(next) {props = {...props, ...next}; await render();},
    async locale(next) {locale = next; await render();},
    async unmount() {await React.act(async () => root.unmount()); mounts.delete(result);},
  };
  function content() {
    let tree = el(owners.LocaleProvider, {locale}, el(owners.TouchHelp, {...props, onCloseRequest() {
      result.closes++; props.onCloseRequest?.();
      if (controlledClose) {props = {...props, open: false}; root.render(content());}
    }}));
    if (strict) tree = el(React.StrictMode, null, tree);
    return tree;
  }
  async function render() {await React.act(async () => root.render(content()));}
  mounts.add(result); await render(); return result;
}
function normalize(element) {
  if (element.nodeType === 3) return element.textContent.replace(/\s+/g, ' ').trim() || null;
  if (element.nodeType !== 1) return null;
  return [element.localName, [...element.attributes].map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)),
    [...element.childNodes].map(normalize).filter(Boolean)];
}
function originalHelp(locale, {open, touchEnabled, focusMode, showIosFullscreenHelp}) {
  const doc = new env.window.DOMParser().parseFromString(baselineHTML, 'text/html');
  const help = n('#touchHelp', doc), t = key => owners.translate(locale, key);
  for (const node of help.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attribute of ['aria-label', 'title']) for (const node of help.querySelectorAll(`[data-i18n-${attribute}]`)) {
    node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
  }
  help.hidden = !open;
  help.classList.toggle('touch-help-touch-input', touchEnabled);
  if (showIosFullscreenHelp) {
    n('#guideOrientationTitle', help).textContent = t('help.iphoneFullscreen');
    n('#guideOrientationSummary', help).textContent = t('help.iphoneFullscreenSummary');
    n('#guideOrientationAndroid', help).hidden = true;
    n('#guideOrientationIos', help).hidden = false;
  }
  n('[data-guide-panel="focus"]', help).dataset.focusMode = focusMode;
  const keys = focusMode === 'two-finger' ? ['help.focusTwoFingerSummary', 'help.focusTwoFingerLabel', null]
    : focusMode === 'toggle-button' ? ['help.focusToggleSummary', 'help.focusToggleLabel', 'help.toggle']
      : ['help.focusHoldSummary', 'help.holdFocus', 'help.hold'];
  for (const [index, selector] of ['#guideFocusSummary', '#guideFocusLabel', '#guideFocusControlHint'].entries()) {
    n(selector, help).textContent = keys[index] ? t(keys[index]) : '';
  }
  return help;
}

for (const locale of ['zh-CN', 'en']) for (const [device, touchEnabled, showIosFullscreenHelp] of [
  ['desktop', false, false], ['touch', true, false], ['iOS', true, true],
]) for (const focusMode of ['hold-button', 'toggle-button', 'two-finger']) {
  test(`Original full translated DOM: ${locale}, ${device}, ${focusMode}, closed/open`, async () => {
    const props = {open: false, touchEnabled, focusMode, showIosFullscreenHelp};
    const mounted = await mount(props, {locale});
    assert.deepEqual(normalize(n('#touchHelp')), normalize(originalHelp(locale, props)));
    await mounted.update({open: true}); props.open = true;
    assert.deepEqual(normalize(n('#touchHelp')), normalize(originalHelp(locale, props)));
    assert.equal(clock.timers.size, 0);
    assert.equal(animations.length, 0);
  });
}

test('Live locale, touch, iOS and all focus-mode props retain original translated DOM', async () => {
  const mounted = await mount({touchEnabled: false});
  for (const locale of ['zh-CN', 'en']) for (const focusMode of ['two-finger', 'toggle-button', 'hold-button']) {
    await mounted.locale(locale);
    await mounted.update({touchEnabled: true, showIosFullscreenHelp: true, focusMode});
    assert.deepEqual(normalize(n('#touchHelp')), normalize(originalHelp(locale, mounted.props)));
    await mounted.update({touchEnabled: false, showIosFullscreenHelp: false});
    assert.deepEqual(normalize(n('#touchHelp')), normalize(originalHelp(locale, mounted.props)));
  }
});

for (const name of ['orientation', 'game-controls', 'thprac']) test(`Static ${name}: actual toggle/collapse never starts timers or animations`, async () => {
  await mount(); await openGuide(name); expanded(name);
  assert.equal(panel(name).classList.contains('is-playing'), false);
  assert.equal(panel(name).classList.contains('is-finished'), false);
  assert.equal(clock.created.length, 0); assert.equal(animations.length, 0);
  await clock.advance(12000); expanded(name);
  await openGuide(name); expanded(null);
});

for (const [name, duration] of [['focus', 7000], ['menu', 12000], ['dialogue', 4000]]) {
  test(`${name}: exact ${duration}ms terminal state and real replay resets deadline`, async () => {
    await mount(); await openGuide(name); expanded(name);
    assert.equal(panel(name).classList.contains('is-playing'), true);
    assert.equal(panel(name).classList.contains('is-finished'), false);
    assert.deepEqual([...clock.timers.values()].filter(timer => timer.kind === 'timeout').map(timer => timer.delay), [duration]);
    await clock.advance(duration - 1);
    assert.equal(panel(name).classList.contains('is-finished'), false);
    await clock.advance(1); expanded(name);
    assert.equal(panel(name).classList.contains('is-finished'), true);
    assert.equal(panel(name).classList.contains('is-playing'), true, 'Original keeps playing class alongside terminal class');
    assert.equal(clock.timers.size, 0); assert.equal(shotNodes().length, 0);
    await replay(name); expanded(name);
    assert.equal(panel(name).classList.contains('is-finished'), false);
    await clock.advance(1000); const oldDeadline = [...clock.timers.values()].find(timer => timer.kind === 'timeout').at;
    await replay(name);
    assert.equal([...clock.timers.values()].filter(timer => timer.kind === 'timeout').length, 1);
    assert.equal([...clock.timers.values()].find(timer => timer.kind === 'timeout').at, oldDeadline + 1000);
    await clock.advance(duration - 1); assert.equal(panel(name).classList.contains('is-finished'), false);
    await clock.advance(1); assert.equal(panel(name).classList.contains('is-finished'), true);
  });
  test(`${name}: reduced motion goes directly to terminal state, including replay`, async () => {
    reduced = true; await mount(); await openGuide(name); expanded(name);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal(panel(name).classList.contains('is-finished'), true);
      assert.equal(panel(name).classList.contains('is-playing'), false);
      assert.equal(clock.created.length, 0); assert.equal(animations.length, 0);
      await replay(name);
    }
    await openGuide(name); expanded(null);
    assert.equal(panel(name).classList.contains('is-finished'), false);
  });
}

test('Switching guides and repeated toggles collapse the actual previous panel and clear effects', async () => {
  await mount(); await openGuide('focus'); const old = [...animations];
  await openGuide('menu'); expanded('menu');
  assert.equal(shotNodes().length, 0); assert.ok(old.every(animation => animation.cancelled && animation.onfinish === null));
  assert.equal(panel('focus').classList.contains('is-playing'), false);
  assert.deepEqual([...clock.timers.values()].map(timer => [timer.kind, timer.delay]), [['timeout', 12000]]);
  await openGuide('menu'); expanded(null); assert.equal(clock.timers.size, 0);
  await openGuide('dialogue'); await openGuide('orientation'); expanded('orientation');
  assert.equal(clock.timers.size, 0); assert.equal(panel('dialogue').classList.contains('is-playing'), false);
});

test('Focus paired shots: immediate/140ms cadence, relative geometry, exact 760ms keyframes and finish removal', async () => {
  await mount(); n('.finger-focus').style.opacity = '.45'; await openGuide('focus');
  assert.equal(animations.length, 2);
  assert.deepEqual(shotNodes().map(shot => [shot.localName, shot.className, shot.style.left, shot.style.top]), [
    ['i', 'demo-shot', '61px', '103px'], ['i', 'demo-shot', '79px', '103px'],
  ]);
  for (const animation of animations) {
    assert.deepEqual(animation.options, {duration: 760, easing: 'linear'});
    assert.deepEqual(animation.frames, [
      {transform: 'translate(-50%,-50%) rotate(45deg)', opacity: 0},
      {offset: .08, transform: 'translate(-50%,-50%) rotate(105deg)', opacity: 1},
      {transform: 'translate(-50%,-121px) rotate(765deg)', opacity: 1},
    ]);
  }
  await clock.advance(139); assert.equal(animations.length, 2);
  n('.finger-focus').style.opacity = '.4501';
  await clock.advance(1); assert.equal(animations.length, 4);
  assert.deepEqual(shotNodes().slice(-2).map(shot => shot.style.left), ['67px', '73px']);
  const first = animations[0]; first.finish(); assert.equal(first.node.isConnected, false);
  assert.equal(shotNodes().length, 3);
  await clock.advance(140); assert.equal(animations.length, 6);
  await replay('focus');
  assert.equal(first.cancelled, false, 'Completed animations were removed from live cleanup set');
  assert.ok(animations.slice(1, 6).every(animation => animation.cancelled));
  assert.equal(shotNodes().length, 2);
});

for (const [gate, block, unblock] of [
  ['hidden help', () => {n('#touchHelp').hidden = true;}, () => {n('#touchHelp').hidden = false;}],
  ['hidden guide body', () => {body('focus').hidden = true;}, () => {body('focus').hidden = false;}],
  ['missing playing class', () => {panel('focus').classList.remove('is-playing');}, () => {panel('focus').classList.add('is-playing');}],
  ['finished class', () => {panel('focus').classList.add('is-finished');}, () => {panel('focus').classList.remove('is-finished');}],
  ['hidden document', () => {documentHidden = true;}, () => {documentHidden = false;}],
  ['live reduced motion', () => {reduced = true;}, () => {reduced = false;}],
  ['zero stage width', () => {stageWidth = 0;}, () => {stageWidth = 320;}],
  ['zero stage height', () => {stageHeight = 0;}, () => {stageHeight = 200;}],
]) test(`Original emission gate: ${gate} suppresses new shots and permits recovery`, async () => {
  await mount(); await openGuide('focus'); assert.equal(animations.length, 2);
  block(); await clock.advance(280); assert.equal(animations.length, 2);
  unblock(); await clock.advance(140); assert.equal(animations.length, 4);
});

test('No initial shots with zero geometry or a background document', async () => {
  stageWidth = 0; const mounted = await mount(); await openGuide('focus'); assert.equal(animations.length, 0);
  stageWidth = 320; documentHidden = true; await clock.advance(140); assert.equal(animations.length, 0);
  documentHidden = false; await clock.advance(140); assert.equal(animations.length, 2);
  await mounted.update({open: false}); expanded(null); assert.equal(clock.timers.size, 0);
});

test('Focus-mode and locale changes update copy without duplicating active playback', async () => {
  const mounted = await mount(); await openGuide('focus');
  const timerIds = [...clock.timers.keys()];
  await mounted.update({focusMode: 'two-finger'}); await mounted.locale('zh-CN');
  expanded('focus'); assert.deepEqual([...clock.timers.keys()], timerIds); assert.equal(animations.length, 2);
  assert.equal(panel('focus').dataset.focusMode, 'two-finger');
  assert.equal(n('#guideFocusControlHint').textContent, '');
  assert.equal(n('#guideFocusSummary').textContent, owners.translate('zh-CN', 'help.focusTwoFingerSummary'));
  await clock.advance(140); assert.equal(animations.length, 4);
});

for (const strict of [false, true]) test(`Close/reopen/unmount cleanup and player root class${strict ? ' under StrictMode' : ''}`, async () => {
  const mounted = await mount({open: false}, {strict});
  assert.equal(mounted.container.classList.contains('help-visible'), false);
  await mounted.update({open: true}); assert.equal(mounted.container.classList.contains('help-visible'), true);
  await openGuide('focus'); await clock.advance(140);
  const active = [...animations]; assert.equal(active.length, 4);
  await mounted.update({open: false}); expanded(null);
  assert.equal(n('#touchHelp').hidden, true); assert.equal(clock.timers.size, 0); assert.equal(shotNodes().length, 0);
  assert.ok(active.every(animation => animation.cancelled && animation.onfinish === null));
  assert.equal(mounted.container.classList.contains('help-visible'), false);
  await clock.advance(12000); assert.equal(animations.length, 4);
  await mounted.update({open: true}); expanded(null); assert.equal(clock.timers.size, 0);
  await openGuide('focus'); assert.equal(shotNodes().length, 2);
  await mounted.unmount(); assert.equal(clock.timers.size, 0);
  assert.equal(mounted.container.className, 'player-fixture');
  assert.ok(animations.every(animation => animation.cancelled));
});

for (const target of ['#touchHelpClose', '#touchHelp']) test(`${target}: real close callback collapses guides and owner closes without navigation`, async () => {
  const historyLength = env.window.history.length, href = env.window.location.href;
  const mounted = await mount({}, {controlledClose: true}); await openGuide('focus');
  await click('.touch-help-window'); assert.equal(mounted.closes, 0); expanded('focus');
  await click(target); assert.equal(mounted.closes, 1); expanded(null);
  assert.equal(n('#touchHelp').hidden, true); assert.equal(clock.timers.size, 0); assert.equal(shotNodes().length, 0);
  assert.equal(mounted.container.classList.contains('help-visible'), false);
  assert.equal(n('#touchHelp').localName, 'div'); assert.equal(env.document.querySelector('dialog'), null);
  assert.equal(env.window.history.length, historyLength); assert.equal(env.window.location.href, href);
});

test('Playback cleanup is scoped to its help root and leaves unrelated DOM untouched', async () => {
  const mounted = await mount({}, {strict: true});
  assert.equal(mounted.container.classList.contains('help-visible'), true);
  const unrelated = env.document.createElement('aside');
  unrelated.innerHTML = '<article data-guide-panel="unrelated" class="is-playing is-finished"><span class="shot-stream"><i class="external-shot"></i></span></article>';
  env.document.body.append(unrelated);
  const original = unrelated.innerHTML;
  await openGuide('focus'); await replay('focus'); await openGuide('thprac');
  await mounted.update({open: false}); await mounted.unmount();
  assert.equal(unrelated.innerHTML, original);
});
