import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Mounted actual recovery model + original-window React view in jsdom.
 * Authority: main public/index838–864, app3328–3367,9643–9740.
 * No CSS pixels, fullscreen, browser popup/file picker or native engine claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, mounted;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-import-view-'));
  const outfile = resolve(work, 'actual-view.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createGameDataImportModel} from './app/models/game-data-import.ts';
    export {GameDataImportWindows} from './app/components/player/GameDataImportWindows.tsx';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  }); api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (mounted) {await React.act(async () => mounted.root.unmount()); mounted.model.dispose(); mounted = null;}
  assert.deepEqual(env.errors, []); env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
async function mount({locale = 'zh-CN', fallback = null, install} = {}) {
  env.errors.length = 0; const picked = [], installed = [], effects = [];
  const context = {product: 'th06', roomCode: null, replayViewer: false, runtimeReady: false, launched: false, playerOpen: false, importServer: false, fallback};
  const model = api.createGameDataImportModel({translate: (key, params) => api.translate(locale, key, params), getContext: () => context,
    acquisition: {importPackage: async value => {installed.push(value); return install ? install(value) : {files: {data: {objectId: 'data'}}};}},
    ports: {pickFile: async options => {picked.push(options); return null;}, closePlayer: async () => {effects.push('close'); return true;},
      resetUnlaunchedRuntime: () => {effects.push('reset');}, openPlayer: () => {effects.push('open');}, launchConfigured: async () => {effects.push('launch');},
      feedback: {status() {}, playerStatus() {}, toast() {}},
      beginBlockingDownload: () => {throw new Error('No download is started by rendering the import view');}},
  });
  const host = env.document.createElement('div'); env.document.body.append(host); const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(api.LocaleProvider, {locale},
    React.createElement(api.GameDataImportWindows, {model, getRuntimeReady: () => context.runtimeReady}))));
  mounted = {model, root};
  return {model, root, host, context, picked, installed, effects, text: (key, params) => api.translate(locale, key, params)};
}
const element = id => {const value = env.document.getElementById(id); assert.ok(value, `original #${id} exists`); return value;};
async function click(id) {await React.act(async () => element(id).click());}

for (const locale of ['zh-CN', 'en']) test(`original import-window structure/copy and missing-link state (${locale})`, async () => {
  const f = await mount({locale});
  assert.equal(element('gameDataImportWindow').hidden, true); assert.equal(element('gameDataLinkWindow').hidden, true);
  await React.act(async () => f.model.openManual());
  assert.equal(element('gameDataImportWindow').hidden, false);
  assert.equal(element('gameDataImportWindow').getAttribute('role'), 'dialog'); assert.equal(element('gameDataImportWindow').getAttribute('aria-modal'), 'false');
  assert.equal(element('gameDataImportTitle').textContent, f.text('package.importTitle'));
  assert.equal(element('gameDataImportClose').getAttribute('aria-label'), f.text('package.closeImport'));
  assert.equal(element('transferImport').textContent, f.text('action.import')); assert.equal(element('transferDownload').textContent, f.text('action.openLink'));
  assert.equal(element('transferDownload').disabled, true); assert.equal(element('transferDownload').title, f.text('package.fallbackLinkUnavailableTitle'));
  assert.equal(element('gameDataFallbackUrl').hasAttribute('href'), false); assert.equal(element('gameDataFallbackHint').textContent, f.text('common.none'));
  assert.equal(element('gameDataImportInput').accept, '.zip,.dat,application/zip'); assert.equal(element('gameDataImportInput').hidden, true);
  await click('transferImport'); assert.deepEqual(f.picked, [{accept: '.zip,.dat,application/zip'}]); assert.equal(element('gameDataImportWindow').hidden, false);
  await click('gameDataImportClose'); assert.equal(element('gameDataImportWindow').hidden, true); assert.equal(f.model.getSnapshot().attempt.dialogDismissed, true);
  assert.deepEqual(f.effects, []);
});

test('link window preserves original URL/hint, separate close and successful-popup null-opener policy', async () => {
  const fallback = {url: 'https://downloads.invalid/main-package.zip', hint: 'fixture-code'}, f = await mount({fallback});
  await React.act(async () => f.model.openManual()); await click('transferDownload');
  assert.equal(element('gameDataLinkWindow').hidden, false); assert.equal(element('gameDataImportWindow').hidden, false);
  const anchor = element('gameDataFallbackUrl');
  assert.equal(anchor.href, fallback.url); assert.equal(anchor.textContent, fallback.url); assert.equal(anchor.target, '_blank'); assert.equal(anchor.rel, 'noopener noreferrer');
  assert.equal(element('gameDataFallbackHint').textContent, fallback.hint);
  const opened = {opener: 'synthetic-parent'}, calls = []; env.window.open = (...args) => {calls.push(args); return opened;};
  const event = new env.window.MouseEvent('click', {bubbles: true, cancelable: true});
  await React.act(async () => anchor.dispatchEvent(event));
  assert.deepEqual(calls, [[fallback.url, '_blank']]); assert.equal(opened.opener, null); assert.equal(event.defaultPrevented, true);
  await click('gameDataLinkClose'); assert.equal(element('gameDataLinkWindow').hidden, true); assert.equal(element('gameDataImportWindow').hidden, false);
});

test('blocked synthetic popup leaves native anchor fallback unprevented; ready Runtime does not call window.open', async () => {
  const f = await mount({fallback: {url: 'https://downloads.invalid/main-package.zip'}}); await React.act(async () => f.model.openManual()); await click('transferDownload');
  const calls = []; env.window.open = (...args) => {calls.push(args); return null;};
  const prevented = [];
  // Observe React's decision after its delegated handler. Then prevent jsdom's
  // default navigation; no external URL is opened by this fixture.
  f.host.addEventListener('click', event => {prevented.push(event.defaultPrevented); event.preventDefault();});
  await click('gameDataFallbackUrl'); assert.deepEqual(prevented, [false]); assert.equal(calls.length, 1);
  f.context.runtimeReady = true; await click('gameDataFallbackUrl'); assert.deepEqual(prevented, [false, false]); assert.equal(calls.length, 1);
});

test('busy import disables original close/import/download actions and restores them after a failed import', async () => {
  const pending = deferred(), f = await mount({fallback: {url: 'https://downloads.invalid/main-package.zip'}, install: () => pending.promise});
  await React.act(async () => f.model.openManual());
  let importing; await React.act(async () => {importing = f.model.importFile(new env.window.File(['fixture'], 'game.zip'));});
  assert.equal(element('gameDataImportWindow').getAttribute('aria-busy'), 'true'); assert.equal(element('gameDataImportBusy').hidden, false);
  assert.equal(element('gameDataImportBusy').getAttribute('role'), 'status'); assert.equal(element('gameDataImportBusy').getAttribute('aria-live'), 'polite');
  assert.equal(element('gameDataImportBusyText').textContent, f.text('package.importing'));
  for (const id of ['gameDataImportClose', 'transferImport', 'transferDownload']) assert.equal(element(id).disabled, true);
  await click('gameDataImportClose'); assert.equal(element('gameDataImportWindow').hidden, false);
  await React.act(async () => {pending.resolve(Promise.reject(new Error('fixture bad ZIP'))); await importing;});
  assert.equal(element('gameDataImportReason').textContent, f.text('package.importInvalid', {reason: 'fixture bad ZIP'}));
  assert.equal(element('gameDataImportWindow').getAttribute('aria-busy'), 'false'); assert.equal(element('gameDataImportBusy').hidden, true);
  for (const id of ['gameDataImportClose', 'transferImport', 'transferDownload']) assert.equal(element(id).disabled, false);
});

test('original hidden input change consumes its first file and clears the native input value', async () => {
  const f = await mount(); await React.act(async () => f.model.openManual());
  const input = element('gameDataImportInput'), selected = new env.window.File(['fixture'], 'game.zip');
  Object.defineProperty(input, 'files', {configurable: true, value: [selected]});
  await React.act(async () => input.dispatchEvent(new env.window.Event('change', {bubbles: true})));
  assert.equal(input.value, ''); assert.equal(f.installed.length, 1); assert.equal(f.installed[0].file, selected);
  assert.equal(element('gameDataImportWindow').hidden, true); assert.deepEqual(f.effects, []);
});

test('both shared import/link shells keep caller focus, stable nodes and independent close semantics across repeated opens', async () => {
  const f = await mount({fallback: {url: 'https://downloads.invalid/main-package.zip'}});
  const outside = env.document.createElement('button'); env.document.body.append(outside); outside.focus();
  const importer = element('gameDataImportWindow'), link = element('gameDataLinkWindow'), input = element('gameDataImportInput');
  await React.act(async () => f.model.openManual());
  assert.equal(env.document.activeElement, outside, 'nonmodal presentation does not take focus');
  element('transferDownload').focus(); await click('transferDownload');
  assert.equal(env.document.activeElement, element('transferDownload'));
  assert.equal(link.getAttribute('role'), 'dialog'); assert.equal(link.getAttribute('aria-modal'), 'false');
  assert.equal(link.hasAttribute('aria-busy'), false);
  assert.equal(link.getAttribute('aria-labelledby'), element('gameDataLinkTitle').id);
  assert.equal(element('gameDataLinkClose').getAttribute('aria-label'), f.text('package.closeLink'));
  await React.act(async () => {
    element('gameDataLinkClose').dispatchEvent(new env.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    outside.click();
  });
  assert.equal(importer.hidden, false); assert.equal(link.hidden, false);
  await click('gameDataLinkClose'); assert.equal(link.hidden, true); assert.equal(importer.hidden, false);
  await click('transferDownload'); await click('gameDataImportClose');
  assert.equal(importer.hidden, true); assert.equal(link.hidden, true);
  await React.act(async () => {f.model.openManual(); f.model.openImport(); f.model.openLink(); f.model.openLink();});
  assert.equal(element('gameDataImportWindow'), importer); assert.equal(element('gameDataLinkWindow'), link);
  assert.equal(element('gameDataImportInput'), input); assert.equal(importer.hidden, false); assert.equal(link.hidden, false);
  assert.deepEqual(f.effects, []);
});

for (const staleOutcome of ['success', 'failure']) test(`stale ${staleOutcome} cannot unlock or close a newer busy import/reference presentation`, async () => {
  const old = deferred(), current = deferred(); let installs = 0;
  const f = await mount({fallback: {url: 'https://downloads.invalid/main-package.zip'}, install: () => ++installs === 1 ? old.promise : current.promise});
  await React.act(async () => f.model.openManual());
  let oldImport, currentImport;
  await React.act(async () => {oldImport = f.model.importFile(new env.window.File(['old'], 'old.zip'));});
  await React.act(async () => {f.model.beginManual({reason: 'New import owns the window'}); f.model.openLink();});
  await React.act(async () => {currentImport = f.model.importFile(new env.window.File(['new'], 'new.zip'));});
  const snapshot = f.model.getSnapshot(), importer = element('gameDataImportWindow'), link = element('gameDataLinkWindow');
  await React.act(async () => {
    old.resolve(staleOutcome === 'success' ? {files: {data: {objectId: 'old'}}} : Promise.reject(new Error('Stale invalid package')));
    await oldImport;
  });
  assert.equal(f.model.getSnapshot(), snapshot); assert.equal(importer.getAttribute('aria-busy'), 'true');
  assert.equal(importer.hidden, false); assert.equal(link.hidden, false);
  for (const id of ['gameDataImportClose', 'transferImport', 'transferDownload']) assert.equal(element(id).disabled, true);
  await click('gameDataImportClose'); assert.equal(importer.hidden, false); assert.equal(link.hidden, false);
  await click('gameDataLinkClose'); assert.equal(link.hidden, true); assert.equal(importer.hidden, false);
  assert.equal(importer.getAttribute('aria-busy'), 'true', 'reference close does not cancel its busy task');
  await React.act(async () => {current.resolve({files: {data: {objectId: 'new'}}}); await currentImport;});
  assert.equal(importer.hidden, true); assert.equal(link.hidden, true); assert.equal(element('gameDataImportClose').disabled, false);
  assert.deepEqual(f.effects, []);
});
