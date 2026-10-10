/** Main app.mts3065–3076,3200–3215,3358–3364,3396–3406,9653–9659.
 * Actual React views/models and custom-select owner in synthetic DOM only;
 * no browser/native top-layer/layout, file-picker or network claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, root, fixture;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/transient-select-dismissal-'));
  const outfile = resolve(work, 'components.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {MainSelect} from './app/components/launcher/MainSelect.tsx';
    export {Feedback} from './app/components/feedback/Feedback.tsx';
    export {StartupError} from './app/components/feedback/StartupError.tsx';
    export {GameDataImportWindows} from './app/components/player/GameDataImportWindows.tsx';
    export {createFeedbackModel} from './app/models/feedback.ts';
    export {createStartupErrorModel} from './app/models/startup-error.ts';
    export {createGameDataImportModel} from './app/models/game-data-import.ts';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) {await React.act(async () => root.unmount()); root = null;}
  if (fixture) {fixture.feedback.dispose(); fixture.error.dispose(); fixture.importer.dispose(); fixture = null;}
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 0);
  assert.deepEqual(env.errors.splice(0), []); env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const el = (...args) => React.createElement(...args);
function n(selector) {const node = env.document.querySelector(selector); assert.ok(node, selector); return node;}
const act = fn => React.act(async () => {await fn();});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
async function mount() {
  let serial = 0; const timers = {setTimeout: () => ++serial, clearTimeout() {}}, t = (key, values) => api.translate('en', key, values);
  const context = {product: 'th06', roomCode: null, replayViewer: false, runtimeReady: false, launched: false, playerOpen: false, importServer: false, fallback: {url: 'https://example.invalid/package.zip'}};
  const feedback = api.createFeedbackModel(timers), error = api.createStartupErrorModel({translate: t, launched: () => context.launched, copyText: async () => true, toast: feedback.toast});
  let install = async () => ({files: {data: {objectId: 'fixture-data'}}});
  const importer = api.createGameDataImportModel({translate: t, getContext: () => context, timers, acquisition: {importPackage: (...args) => install(...args)},
    ports: {pickFile: async () => null, closePlayer: async () => true, resetUnlaunchedRuntime() {}, openPlayer() {}, async launchConfigured() {}, feedback,
      beginBlockingDownload: () => ({finish() {}, async cancel() {}})}});
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  const render = (showImport = true) => root.render(el(React.StrictMode, null, el(api.LocaleProvider, {locale: 'en'},
    el(api.MainSelect, {id: 'settingsSelect', className: 'option-select', defaultValue: 'a'}, el('option', {value: 'a'}, 'A'), el('option', {value: 'b'}, 'B')),
    el(api.Feedback, {model: feedback}), el(api.StartupError, {model: error}), showImport && el(api.GameDataImportWindows, {model: importer, getRuntimeReady: () => context.runtimeReady}))));
  await act(() => render());
  fixture = {context, feedback, error, importer, setInstall: value => {install = value;}, renderImport: shown => act(() => render(shown))}; return fixture;
}
async function openMenu() {await act(() => n('.mizuki-select-trigger').click()); const menu = n('.mizuki-select-menu'); assert.equal(menu.hidden, false); return menu;}
const revision = f => f.importer.getSnapshot().presentationRevision;

test('Toast show and replacement dismiss the menu; status updates and dismissal do not', async () => {
  const f = await mount(); let menu = await openMenu();
  await act(() => f.feedback.toast('First toast')); assert.equal(menu.hidden, true);
  menu = await openMenu(); await act(() => f.feedback.toast('Second toast')); assert.equal(menu.hidden, true);
  menu = await openMenu(); await act(() => {f.feedback.status('Status only'); f.feedback.playerStatus('Runtime status');}); assert.equal(menu.hidden, false);
  await act(() => f.feedback.dismiss()); assert.equal(menu.hidden, false);
});

test('Startup error show/replacement dismiss menus; close and suppressed post-launch errors do not', async () => {
  const f = await mount(); let menu = await openMenu();
  await act(() => f.error.show(new Error('First error'))); assert.equal(menu.hidden, true);
  menu = await openMenu(); await act(() => f.error.show(new Error('Replacement error'))); assert.equal(menu.hidden, true);
  menu = await openMenu(); await act(() => f.error.close()); assert.equal(menu.hidden, false);
  f.context.launched = true; await act(() => f.error.show(new Error('Suppressed error'))); assert.equal(menu.hidden, false);
  await act(() => f.error.show(new Error('Allowed late error'), 'Runtime', true)); assert.equal(menu.hidden, true);
});

test('Import presentation and repeat-open dismiss menus; progress, metadata and dismissal preserve them', async () => {
  const f = await mount(); let menu = await openMenu();
  await act(() => f.importer.openManual()); assert.equal(menu.hidden, true); assert.equal(revision(f), 1);
  menu = await openMenu(); await act(() => f.importer.openImport()); assert.equal(menu.hidden, true); assert.equal(revision(f), 2);
  menu = await openMenu(); await act(() => {f.importer.noteTransfer({kind: 'game', loaded: 10, total: 100}); f.importer.refresh();});
  assert.equal(menu.hidden, false); assert.equal(revision(f), 2);
  await act(() => f.importer.dismissImport()); assert.equal(menu.hidden, false); assert.equal(revision(f), 2);
  await act(() => f.importer.openImport()); assert.equal(menu.hidden, true); assert.equal(revision(f), 3);
});

test('Link presentation and repeat-open dismiss menus; closeLink does not', async () => {
  const f = await mount(); await act(() => f.importer.openManual()); let menu = await openMenu();
  await act(() => f.importer.openLink()); assert.equal(menu.hidden, true); assert.equal(revision(f), 2);
  menu = await openMenu(); await act(() => f.importer.openLink()); assert.equal(menu.hidden, true); assert.equal(revision(f), 3);
  menu = await openMenu(); await act(() => f.importer.closeLink()); assert.equal(menu.hidden, false); assert.equal(revision(f), 3);
});

test('Remounting dismissed import windows does not replay an old presentation or dismiss an unrelated menu', async () => {
  const f = await mount();
  await act(() => {f.importer.openManual(); f.importer.openLink(); f.importer.dismissImport();});
  const presented = revision(f); assert.equal(presented, 2);
  await f.renderImport(false); const menu = await openMenu();
  await f.renderImport(true);
  assert.equal(n('#gameDataImportWindow').hidden, true); assert.equal(n('#gameDataLinkWindow').hidden, true);
  assert.equal(menu.hidden, false); assert.equal(n('.mizuki-select-menu'), menu); assert.equal(revision(f), presented);
});

test('Remounting a visible import presentation still dismisses the detached settings menu', async () => {
  const f = await mount(); await act(() => f.importer.openManual());
  const presented = revision(f);
  await f.renderImport(false); const menu = await openMenu();
  await f.renderImport(true);
  assert.equal(n('#gameDataImportWindow').hidden, false); assert.equal(menu.hidden, true);
  assert.equal(n('.mizuki-select-menu'), menu); assert.equal(revision(f), presented);
});

test('Only the first automatic import unlock presents; later reason/progress updates do not dismiss menus', async () => {
  const f = await mount(); let menu = await openMenu();
  await act(() => f.importer.beginDirectDownload()); assert.equal(menu.hidden, false); assert.equal(revision(f), 0);
  await act(() => f.importer.unlock('First timeout')); assert.equal(menu.hidden, true); assert.equal(revision(f), 1);
  menu = await openMenu(); await act(() => f.importer.unlock('Later timeout')); assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
  await act(() => {f.importer.dismissImport(); f.importer.unlock('Still downloading');}); assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
});

test('Unavailable import/link actions and busy/progress updates do not invent presentation events', async () => {
  const f = await mount(), pending = deferred(); let progress;
  let menu = await openMenu(); await act(() => {f.importer.openImport(); f.importer.openLink();}); assert.equal(menu.hidden, false); assert.equal(revision(f), 0);
  await act(() => f.importer.openManual()); menu = await openMenu(); f.context.runtimeReady = true;
  await act(() => {f.importer.openImport(); f.importer.openLink();}); assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
  f.context.runtimeReady = false; f.context.fallback = null;
  await act(() => f.importer.openLink()); assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
  f.context.fallback = {url: 'https://example.invalid/package.zip'};
  f.setInstall(input => {progress = input.onProgress; return pending.promise;});
  let importing; await act(() => {importing = f.importer.importFile(new env.window.File(['data'], 'game.zip'));});
  assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
  await act(() => {progress({message: 'Importing bytes'}); f.importer.openLink();}); assert.equal(menu.hidden, false); assert.equal(revision(f), 1);
  // Main’s failed import explicitly reopens the window. That open event and
  // the separately sourced toast are both retained; mere progress is not one.
  await act(async () => {pending.reject(new Error('Invalid package')); await importing;});
  assert.equal(menu.hidden, true); assert.equal(revision(f), 2); assert.equal(n('#gameDataImportWindow').hidden, false);
});
