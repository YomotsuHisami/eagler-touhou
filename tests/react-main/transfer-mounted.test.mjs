import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Mounted actual TransferPanel + model, synthetic jsdom/time/command ports.
 * Main public/index822–837 and app3489–3547 own the expected markup/behavior.
 * This does not validate authored CSS pixels or native transfer/permissions. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url)); let env, work, api, React, createRoot, mounted;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-transfer-view-'));
  const outfile = resolve(work, 'actual-view.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createTransferModel} from './app/models/transfer.ts';
    export {TransferPanel} from './app/components/player/TransferPanel.tsx';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  }); api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {if (mounted) {await React.act(async () => mounted.root.unmount()); mounted.model.dispose(); mounted = null;} assert.deepEqual(env.errors, []); env.document.body.replaceChildren();});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
const element = id => {const node = env.document.getElementById(id); assert.ok(node, `original #${id} exists`); return node;};
async function mount(locale = 'zh-CN') {
  env.errors.length = 0; let id = 0; const frames = new Map(), timers = new Map(), calls = [];
  const context = {epoch: 1, launched: false, iosWebKitTouch: true};
  const model = api.createTransferModel({translate: (key, params) => api.translate(locale, key, params), context: () => context,
    frames: {request(fn) {frames.set(++id, fn); return id;}, cancel(id) {frames.delete(id);}},
    timers: {setTimeout(fn, delay) {timers.set(++id, {fn, delay}); return id;}, clearTimeout(id) {timers.delete(id);}},
    ports: {retryMusic: async timeout => {calls.push(['retry', timeout]);}, cancelDownload: async () => {calls.push(['cancel']);}, playerStatus() {}, toast() {}}, now: () => 1000});
  const host = env.document.createElement('div'); env.document.body.append(host); const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(api.LocaleProvider, {locale}, React.createElement(api.TransferPanel, {model}))));
  mounted = {root, model};
  return {model, calls, frames, timers, context, text: (key, params) => api.translate(locale, key, params), frame() {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());}};
}
for (const locale of ['zh-CN', 'en']) test(`original transfer/MIDI copy, IDs and real cancel/retry controls (${locale})`, async () => {
  const f = await mount(locale); assert.equal(element('transfer').hidden, true); assert.equal(element('transfer').getAttribute('aria-live'), 'polite');
  assert.equal(element('musicNotice').getAttribute('role'), 'status'); assert.equal(element('musicNotice').querySelector('strong').textContent, f.text('player.oggNotReady'));
  assert.equal(element('musicNotice').querySelector('span').textContent, f.text('player.oggFallback'));
  await React.act(async () => {f.model.runtimeTransfer({mode: 'ogg', loaded: 1048576, total: 2097152, speed: 2048}); f.model.setCancellation(f.text('music.cancelDownload'));});
  assert.equal(element('transfer').hidden, false); assert.equal(element('transferAmount').textContent, '1.0 / 2.0 MiB');
  assert.equal(element('transferBar').style.width, '50%'); assert.equal(element('transferSpeed').textContent, '2 KiB/s'); assert.equal(element('transferEta').textContent, '08:32');
  assert.equal(element('transferCancel').hidden, false); assert.equal(element('transferCancel').textContent, f.text('music.cancelDownload'));
  await React.act(async () => element('transferCancel').click()); assert.deepEqual(f.calls, [['cancel']]); assert.equal(element('transferCancel').hidden, true);
  await React.act(async () => f.model.musicFailure(2)); assert.equal(element('transferWarning').hidden, false); assert.equal(element('transferWarning').textContent, f.text('transfer.oggFailed', {count: 2}));
  assert.equal(element('transferRetry').textContent, f.text('action.retry')); await React.act(async () => element('transferRetry').click());
  assert.deepEqual(f.calls.at(-1), ['retry', 1800000]); assert.equal(element('transferRetry').hidden, true); assert.equal(element('transferWarning').textContent, f.text('transfer.retryingOgg'));
});

test('original network datasets/bar class and iOS debug text reflect actual transfer owner', async () => {
  const f = await mount();
  await React.act(async () => f.model.runtimeTransfer({phase: 'requesting'}));
  assert.equal(element('transferBar').parentElement.classList.contains('indeterminate'), true); assert.equal(element('transferBar').style.width, '34%');
  const task = {id: 'one', url: '/fixture', title: 'source title', label: 'source label', kind: 'metadata', phase: 'requesting', loaded: 0, total: 0, startedAt: 0, updatedAt: 0};
  await React.act(async () => {f.model.networkSnapshot({active: [task], count: 1, loaded: 0, total: 0}); f.frame();});
  assert.equal(element('transfer').dataset.networkOwned, '1'); assert.equal(element('transfer').dataset.networkActive, '1');
  assert.equal(element('transferTitle').textContent, 'source title'); assert.equal(element('transferLabel').textContent, 'source label');
  await React.act(async () => {f.model.networkSnapshot({active: [], count: 0, loaded: 0, total: 0}); f.frame();});
  assert.equal(element('transfer').hidden, true); assert.equal(element('transfer').dataset.networkOwned, '0'); assert.equal(element('transfer').hasAttribute('data-network-active'), false);
  await React.act(async () => {f.model.runtimeTransfer({mode: 'runtime'}); f.model.playerDebug({debug: {note: 'fixture'}});});
  assert.equal(element('playerDebug').hidden, false); assert.match(element('playerDebug').textContent, /^EAGLER-RUNTIME\/1 debug\nnote=fixture/);
  await React.act(async () => f.model.hide()); assert.equal(element('playerDebug').hidden, true); assert.equal(element('playerDebug').textContent, '');
});

test('original MIDI notice toggles .show only after scheduled frame and completion timer', async () => {
  const f = await mount(); await React.act(async () => f.model.midiFallback()); assert.equal(element('musicNotice').classList.contains('show'), false);
  await React.act(async () => f.frame()); assert.equal(element('musicNotice').classList.contains('show'), true);
  const entry = [...f.timers].find(([, value]) => value.delay === 2000); assert.ok(entry);
  await React.act(async () => {f.timers.delete(entry[0]); entry[1].fn();}); assert.equal(element('musicNotice').classList.contains('show'), false);
});
