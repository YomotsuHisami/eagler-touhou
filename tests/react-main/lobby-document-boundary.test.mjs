/** Original document ownership, not browser rendering: parse the actual adapted
 * stylesheet and match its selectors against mounted production components.
 * Authority: pinned edee9633 main iframe/body styles and transient host rules. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import {mainAssets} from '../../scripts/ui-rewrite/main-assets.ts';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
const pinned = path => execFileSync('git', ['show', `edee9633e5e3ee79cd2e1aa334f84f6caf755090:${path}`], {cwd: project, encoding: 'utf8'});
const read = path => readFileSync(resolve(project, path), 'utf8').replaceAll('\r\n', '\n');
const boundary = ':not(:where([data-launcher-document],[data-launcher-document] *))';
const selectors = [
  '.lobby-page [hidden]', '.lobby-page :is(.lobby-button,input,select)',
  '.lobby-page button,.lobby-page a', '.lobby-page :is(button,a,input,select):focus-visible',
  '.lobby-page.less-motion *', '.lobby-page *',
];
const replacements = new Map(selectors.map(selector => [selector,
  selector === selectors[2] ? `.lobby-page button${boundary},.lobby-page a${boundary}` :
  selector === selectors[3] ? `.lobby-page :is(button,a,input,select)${boundary}:focus-visible` : selector + boundary]));
const adapted = mainAssets().load.call({}, resolve(project, 'public/lobby.css')).replaceAll('\r\n', '\n');
const adaptedTree = postcss.parse(adapted);
const rule = selector => {let result; adaptedTree.walkRules(candidate => {if (candidate.selector === replacements.get(selector)) result = candidate;}); assert.ok(result, selector); return result;};
const matches = (node, selector) => node.matches(selector.replaceAll(':focus-visible', ''));
let env, work, api, React, createRoot, root, disposables = [];
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/lobby-document-boundary-'));
  const outfile = resolve(work, 'components.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {LobbyOptionsHost} from './app/components/launcher/LobbyOptionsHost.tsx';
    export {MainSelect} from './app/components/launcher/MainSelect.tsx';
    export {createMainSelectController} from './app/components/launcher/main-select-controller.ts';
    export {OptionSwitch} from './app/components/settings/TouchSettingsFields.tsx';
    export {PlayerSurface} from './app/components/player/PlayerSurface.tsx';
    export {FullscreenTransient} from './app/components/FullscreenTransient.tsx';
    export {ConfirmationDialog} from './app/components/ConfirmationDialog.tsx';
    export {Feedback} from './app/components/feedback/Feedback.tsx';
    export {StartupError} from './app/components/feedback/StartupError.tsx';
    export {AppleRefreshDialog} from './app/components/notices/AppleRefreshDialog.tsx';
    export {ReplayDialog} from './app/components/notices/ReplayDialog.tsx';
    export {DonationDialog} from './app/components/notices/DonationDialog.tsx';
    export {MultiplayerGuideDialog} from './app/components/notices/MultiplayerGuideDialog.tsx';
    export {NetplayCalibrationReport} from './app/components/NetplayCalibrationReport.tsx';
    export {createNetplayCalibration} from './app/models/netplay-calibration.ts';
    export {createFeedbackModel} from './app/models/feedback.ts';
    export {createStartupErrorModel} from './app/models/startup-error.ts';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) {await React.act(async () => root.unmount()); root = null;}
  for (const dispose of disposables.splice(0)) dispose();
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu,[data-launcher-transient-host]').length, 0);
  assert.deepEqual(env.errors.splice(0), []);
  env.document.body.replaceChildren(); env.document.body.className = ''; delete env.document.fullscreenElement;
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const el = (...args) => React.createElement(...args), act = fn => React.act(async () => {await fn();});
const n = selector => {const node = env.document.querySelector(selector); assert.ok(node, selector); return node;};
const noop = () => {};
async function mount({lessMotion = false} = {}) {
  env.document.body.className = `lobby-page${lessMotion ? ' less-motion' : ''}`;
  const timers = {setTimeout: () => 1, clearTimeout() {}}, t = (key, values) => api.translate('en', key, values);
  const feedback = api.createFeedbackModel(timers), error = api.createStartupErrorModel({translate: t, launched: () => false, copyText: async () => true, toast: feedback.toast});
  const calibration = api.createNetplayCalibration({timers, userAgent: 'synthetic'});
  disposables.push(feedback.dispose, error.dispose, calibration.dispose);
  const replayState = {phase: 'ready', rows: [], animateRows: false};
  const replay = {subscribe: () => noop, getSnapshot: () => replayState, close: noop};
  const select = id => el(api.MainSelect, {id, className: 'option-select', defaultValue: 'a'}, el('option', {value: 'a'}, 'A'), el('option', {value: 'b'}, 'B'));
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  const render = (foregroundActive = false) => root.render(el(React.StrictMode, null, el(api.LocaleProvider, {locale: 'en'},
    el('header', {className: 'ui-language-control'}, select('lobbyLanguage')),
    el('button', {id: 'lobbyAction', className: 'lobby-button'}, 'Lobby'),
    el(api.LobbyOptionsHost, {open: true, foregroundActive, onCloseRequest: noop}, el('aside', {className: 'tools'},
      el(api.OptionSwitch, {id: 'settingsSwitch', checked: false, onChange: noop}), select('settingsSelect'))),
    el(api.PlayerSurface, {open: true, editing: false, onElement: noop}, el(api.OptionSwitch, {id: 'playerSwitch', checked: false, onChange: noop})),
    el(api.FullscreenTransient, null,
      el(api.ConfirmationDialog, {open: false, title: 'Confirm', message: 'Message', confirmText: 'Yes', cancelText: 'No', onConfirm: noop, onCancel: noop}),
      el(api.Feedback, {model: feedback}), el(api.StartupError, {model: error})),
    el(api.AppleRefreshDialog, {open: true, onCloseRequest: noop}),
    el(api.ReplayDialog, {model: replay, open: false, onCloseRequest: noop, onImportRequest: noop, onDropFile: async () => {}, onImportError: noop}),
    el(api.NetplayCalibrationReport, {model: calibration, english: true, currentNetwork: () => ''}),
    el(api.DonationDialog, {open: false, onCloseRequest: noop, assetUrl: value => value, onArtworkUnavailable: noop}),
    el(api.MultiplayerGuideDialog, {open: false, onCloseRequest: noop, gameId: 'th06', contentUrl: 'content/MULTIPLAYER.html'}))));
  await act(() => render()); return {render: value => act(() => render(value))};
}
async function openMenu(id) {await act(() => n(`#${id}`).closest('.mizuki-select').querySelector('button').click()); return n('.mizuki-select-menu:not([hidden])');}
async function fullscreen(target, event = 'fullscreenchange') {
  Object.defineProperty(env.document, 'fullscreenElement', {configurable: true, value: target});
  await act(() => env.document.dispatchEvent(new env.window.Event(event)));
}

test('pinned main keeps the complete settings/Player/overlay document outside lobby CSS', () => {
  assert.equal(read('public/lobby.css'), pinned('public/lobby.css'));
  assert.equal(read('public/styles.css'), pinned('public/styles.css'));
  const lobby = pinned('src/launcher/lobby.mts'), app = pinned('src/launcher/app.mts');
  assert.match(lobby, /url\.searchParams\.set\("lobbyOptions", "1"\)/);
  assert.match(pinned('public/lobby.html'), /<iframe[^>]*id="lobbyOptionsFrame"/);
  assert.match(app, /for \(const id of \["toast", "startupError", "decisionDialog", "gameDataImportWindow", "gameDataLinkWindow"\]\)/);
  assert.ok(app.includes('from "./netplay-calibration-report.mjs"'));
  assert.ok(!lobby.includes('netplay-calibration-report'));
  assert.match(pinned('src/launcher/netplay-calibration-report.mts'), /document\.body\.append\(dialog\); dialog\.showModal\(\)/);
  for (const id of ['player', 'appleRefreshDialog', 'replayDialog']) {
    assert.ok(pinned('public/index.html').includes(`id="${id}"`));
    assert.ok(!pinned('public/lobby.html').includes(`id="${id}"`));
  }
});

test('adapter changes only six generic selectors and adds zero specificity to actual lobby controls', () => {
  const expected = postcss.parse(read('public/lobby.css')), found = new Set();
  expected.walkRules(candidate => {if (replacements.has(candidate.selector)) {found.add(candidate.selector); candidate.selector = replacements.get(candidate.selector);}});
  assert.deepEqual([...found], selectors);
  assert.equal(adapted, expected.toString());
  // :where has zero specificity; removing only that exclusion reconstructs
  // every pinned selector, including header focus and native form controls.
  for (const selector of selectors) assert.equal(rule(selector).selector.replaceAll(boundary, ''), selector);
  assert.equal(rule(selectors[5]).parent.params, '(prefers-reduced-motion:reduce)');
  for (const selector of selectors.slice(4)) assert.deepEqual(rule(selector).nodes.map(({prop, value, important}) => [prop, value, important]), [['animation', 'none', true], ['transition', 'none', true]]);
});

test('marked root inheritance comes only from pinned main body and embedded root, without overriding component declarations', () => {
  const original = postcss.parse(pinned('public/styles.css'));
  const declarations = selector => {const values = {}; original.walkRules(node => {if (node.selector === selector) node.walkDecls(({prop, value}) => {values[prop] = value;});}); return values;};
  assert.equal(declarations('html,body').color, 'var(--paper)');
  assert.equal(declarations('body')['font-family'], 'var(--ui-font)');
  for (const selector of [':root', 'html,body', 'body']) {
    const values = declarations(selector);
    assert.equal(values.font, undefined); assert.equal(values['font-size'], undefined); assert.equal(values['line-height'], undefined);
  }
  assert.equal(declarations('html.lobby-options-embed')['color-scheme'], 'only light');
  const inherited = postcss.parse(read('app/components/launcher/lobby-options.css')).nodes.find(node => node.selector === ':where(.lobby-page [data-launcher-document])');
  assert.deepEqual(inherited.nodes.map(({prop, value}) => [prop, value]), [['color-scheme', 'only light'], ['color', 'var(--paper)'], ['font', 'medium/normal var(--ui-font)']]);
  assert.equal(declarations('.mizuki-select-menu').color, '#e7e1d9');
  assert.equal(declarations('.replay-window').font, '13px/1.4 var(--ui-font)');
});

test('real settings, Player and main-only dialog controls escape lobby focus and motion; lobby controls retain both', async () => {
  await mount({lessMotion: true});
  const focus = rule(selectors[3]).selector, motions = selectors.slice(4).map(selector => rule(selector).selector);
  for (const selector of ['.lobby-options-document', '#player', '#appleRefreshDialog', '#replayDialog', '#netplayCalibrationDialog', '[data-launcher-transient-host]']) {
    const owner = n(selector); assert.ok(owner.hasAttribute('data-launcher-document'), selector);
    for (const motion of motions) assert.equal(matches(owner, motion), false, `${selector} root`);
    for (const button of owner.querySelectorAll('button')) {
      assert.equal(matches(button, focus), false, `${selector} focus`);
      for (const motion of motions) assert.equal(matches(button, motion), false, `${selector} motion`);
    }
  }
  for (const selector of ['#lobbyAction', '#lobbyLanguage', '#donationClose', '#mpGuideClose']) {
    const button = n(selector); assert.equal(button.closest('[data-launcher-document]'), null);
    assert.equal(matches(button, focus), true, selector);
    for (const motion of motions) assert.equal(matches(button, motion), true, selector);
  }
  // Pin the original winning switch and focus declarations. A DOM selector
  // test establishes exclusion, not pixels or the browser's CSS cascade.
  const main = postcss.parse(pinned('public/styles.css'));
  for (const [selector, value] of [['.less-motion .option-switch', 'border-color .14s ease,background-color .14s ease'], ['.less-motion .option-switch i', 'transform .16s ease-out,background-color .14s ease']]) {
    let transition; main.walkRules(candidate => {if (candidate.selector === selector) transition = candidate.nodes.find(node => node.prop === 'transition');});
    assert.equal(transition.value, value); assert.equal(transition.important, true);
    assert.ok(n(selector.includes(' i') ? '#settingsSwitch i' : '#settingsSwitch').matches(selector));
  }
  assert.ok(pinned('public/styles.css').includes('.ui-language-control .mizuki-select-trigger:focus-visible{outline:2px solid rgba(217,77,85,.72);outline-offset:2px}'));
});

test('settings menu retains document ownership in outer dialog, body and fullscreen Player carriers', async () => {
  const mounted = await mount({lessMotion: true});
  const settings = await openMenu('settingsSelect');
  assert.equal(settings.parentElement, n('#lobbyOptionsDialog'));
  assert.ok(settings.hasAttribute('data-launcher-document'));
  assert.equal(settings.closest('.lobby-options-document'), null);
  const focus = rule(selectors[3]).selector, motion = rule(selectors[4]).selector;
  for (const node of [settings, settings.querySelector('button')]) assert.equal(matches(node, motion), false);
  assert.equal(matches(settings.querySelector('button'), focus), false);
  await mounted.render(true); // Original outer modal is suspended for Player.
  await act(() => n('#settingsSelect').closest('.mizuki-select').querySelector('button').click()); // close
  const bodyMenu = await openMenu('settingsSelect'); assert.equal(bodyMenu, settings); assert.equal(settings.parentElement, env.document.body);
  await fullscreen(n('#player'));
  await act(() => n('#settingsSelect').closest('.mizuki-select').querySelector('button').click()); // close before opening in the new host
  const playerMenu = await openMenu('settingsSelect'); assert.equal(playerMenu, settings); assert.equal(settings.parentElement, n('#player'));
  assert.ok(settings.hasAttribute('data-launcher-document'));
  await fullscreen(null);
  const lobbyMenu = await openMenu('lobbyLanguage');
  assert.equal(lobbyMenu.parentElement, env.document.body); assert.equal(lobbyMenu.hasAttribute('data-launcher-document'), false);
  assert.equal(matches(lobbyMenu.querySelector('button'), focus), true); assert.equal(matches(lobbyMenu, motion), true);
});

test('menu ownership is recomputed when a native select changes document owner', () => {
  const owner = env.document.createElement('div'); owner.dataset.launcherDocument = '';
  const select = env.document.createElement('select'); select.innerHTML = '<option>A</option>'; owner.append(select); env.document.body.append(owner);
  const controller = api.createMainSelectController({translate: key => key});
  try {
    controller.installCustomSelect(select); select.parentElement.querySelector('button').click();
    const menu = n('.mizuki-select-menu'), wrapper = select.parentElement;
    assert.ok(menu.hasAttribute('data-launcher-document'));
    controller.closeOtherCustomSelects(); env.document.body.append(wrapper); wrapper.querySelector('button').click();
    assert.equal(n('.mizuki-select-menu'), menu); assert.equal(menu.hasAttribute('data-launcher-document'), false);
    owner.append(wrapper); controller.syncAllCustomSelects(); assert.ok(menu.hasAttribute('data-launcher-document'));
  } finally {controller.dispose();}
});

test('fullscreen transient carrier and original dialog nodes keep ownership and identity on both fullscreen events', async () => {
  await mount({lessMotion: true});
  const host = n('[data-launcher-transient-host]'), decision = n('#decisionDialog'), toast = n('#toast'), error = n('#startupError');
  for (const [target, event] of [[n('#player'), 'fullscreenchange'], [null, 'webkitfullscreenchange'], [n('#player'), 'webkitfullscreenchange'], [null, 'fullscreenchange']]) {
    await fullscreen(target, event);
    assert.equal(host.parentElement, target || env.document.body); assert.ok(host.hasAttribute('data-launcher-document'));
    for (const node of [decision, toast, error]) {
      assert.equal(n(`#${node.id}`), node); assert.equal(node.closest('[data-launcher-transient-host]'), host);
      assert.equal(matches(node, rule(selectors[4]).selector), false);
    }
    assert.equal(matches(n('#decisionConfirm'), rule(selectors[3]).selector), false);
  }
});
