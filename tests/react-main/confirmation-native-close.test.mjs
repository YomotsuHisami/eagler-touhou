/** Source authority: main app.mts3114–3152,3178–3207,8957–8981 and
 * tests/browser/test-pwa-boot.py's direct decisionDialog.close() step.
 * Mounted synthetic DOM only; no native browser or PWA result is claimed. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, root, store, reduce = true;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  env.window.matchMedia = query => ({matches: query.includes('prefers-reduced-motion') && reduce}); globalThis.matchMedia = env.window.matchMedia;
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/confirmation-native-close-'));
  const outfile = resolve(work, 'components.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {ConfirmationDialog} from './app/components/ConfirmationDialog.tsx';
    export {createDecisionStore} from './app/models/decisions.ts';
    export {MainSelect} from './app/components/launcher/MainSelect.tsx';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) {await React.act(async () => root.unmount()); root = null;}
  store?.dispose(); store = null; reduce = true;
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 0);
  assert.deepEqual(env.errors.splice(0), []); env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const el = (...args) => React.createElement(...args);
function n(selector) {const node = env.document.querySelector(selector); assert.ok(node, selector); return node;}
async function mount(locale = 'en') {
  store = api.createDecisionStore(); const settled = [], focus = env.document.createElement('button'); focus.textContent = 'Original trigger'; env.document.body.append(focus); focus.focus();
  function Owner() {
    const request = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const settle = choice => {settled.push(choice); store.resolve(choice);};
    return el(api.LocaleProvider, {locale},
      el(api.MainSelect, {id: 'settingsSelect', className: 'option-select', defaultValue: 'a'}, el('option', {value: 'a'}, 'A'), el('option', {value: 'b'}, 'B')),
      request && el(api.ConfirmationDialog, {key: request.requestId, ...request, open: true,
        title: request.title || api.translate(locale, 'dialog.confirmTitle'), message: request.message || '',
        confirmText: request.confirmText || api.translate(locale, 'action.confirm'), cancelText: request.cancelText || api.translate(locale, 'action.cancel'),
        onConfirm: () => settle('confirm'), onSecondary: () => settle('secondary'), onCancel: () => settle('cancel')}));
  }
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(el(React.StrictMode, null, el(Owner))));
  return {settled, focus};
}
async function ask(options = {}) {let result; await React.act(async () => {result = store.askDecision(options);}); return {result, dialog: n('#decisionDialog')};}
async function nativeClose(dialog, value) {await React.act(async () => value === undefined ? dialog.close() : dialog.close(value));}
for (const [value, expected] of [[undefined, 'cancel'], ['confirm', 'confirm'], ['secondary', 'secondary'], ['unknown', 'cancel']]) test(`Native dialog.close(${String(value)}) resolves once and releases the real decision store`, async () => {
  const f = await mount(), {result, dialog} = await ask({message: 'Original native-close contract', secondaryText: 'Other'});
  assert.equal(await store.askDecision({message: 'Competing'}), 'cancel');
  await nativeClose(dialog, value);
  assert.equal(await result, expected); assert.deepEqual(f.settled, [expected]); assert.equal(store.getSnapshot(), null);
  assert.equal(env.document.activeElement, f.focus);
  dialog.dispatchEvent(new env.window.Event('close')); assert.deepEqual(f.settled, [expected]);
  const next = await ask({message: 'Next operation'}); assert.equal(next.dialog.open, true);
  await nativeClose(next.dialog); assert.equal(await next.result, 'cancel');
});

test('Native close supersedes an in-progress decision animation without duplicate settlement', async () => {
  reduce = false; const f = await mount(), {result, dialog} = await ask();
  await React.act(async () => n('#decisionConfirm').click());
  assert.equal(dialog.open, true); assert.equal(dialog.classList.contains('closing'), true); assert.deepEqual(f.settled, []);
  await nativeClose(dialog, 'cancel'); assert.equal(await result, 'cancel'); assert.deepEqual(f.settled, ['cancel']);
  await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 250));});
  assert.deepEqual(f.settled, ['cancel']); assert.equal(dialog.classList.contains('closing'), false);
});

test('Own animated button close resolves through a queued native close event exactly once', async () => {
  const f = await mount(), {result, dialog} = await ask();
  const queued = [];
  dialog.close = function (value = '') {this.returnValue = value; this.open = false; queued.push(() => this.dispatchEvent(new env.window.Event('close')));};
  await React.act(async () => n('#decisionConfirm').click());
  assert.deepEqual(f.settled, [], 'native event remains the settlement boundary'); assert.notEqual(store.getSnapshot(), null);
  await React.act(async () => {queued[0](); queued[0]();});
  assert.equal(await result, 'confirm'); assert.deepEqual(f.settled, ['confirm']); assert.equal(env.document.activeElement, f.focus);
});

test('StrictMode replay, stray close on an open dialog, and unmount do not answer the decision', async () => {
  const f = await mount(), {dialog} = await ask();
  assert.equal(dialog.open, true); assert.deepEqual(f.settled, []);
  await React.act(async () => dialog.dispatchEvent(new env.window.Event('close'))); assert.deepEqual(f.settled, []);
  await React.act(async () => root.unmount()); root = null;
  assert.equal(dialog.open, false); assert.deepEqual(f.settled, []); assert.notEqual(store.getSnapshot(), null);
});

for (const locale of ['zh-CN', 'en']) test(`Original default decision copy and button ordering (${locale})`, async () => {
  await mount(locale); const {dialog} = await ask();
  assert.equal(n('#decisionTitle').textContent, api.translate(locale, 'dialog.confirmTitle'));
  assert.deepEqual([...dialog.querySelectorAll('footer button')].map(button => [button.id, button.textContent, button.hidden]), [
    ['decisionCancel', api.translate(locale, 'action.cancel'), false],
    ['decisionSecondary', api.translate(locale, 'action.backgroundDownload'), true],
    ['decisionConfirm', api.translate(locale, 'action.confirm'), false],
  ]);
  assert.equal(env.document.activeElement, n('#decisionCancel')); await nativeClose(dialog);
});

test('Opening a decision closes the existing settings select without relying on pointerdown', async () => {
  await mount(); await React.act(async () => n('.mizuki-select-trigger').click());
  const menu = n('.mizuki-select-menu'); assert.equal(menu.hidden, false);
  const {dialog} = await ask(); assert.equal(menu.hidden, true); assert.equal(n('.mizuki-select-trigger').getAttribute('aria-expanded'), 'false');
  await nativeClose(dialog);
});
