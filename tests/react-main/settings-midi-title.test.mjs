import {pinnedUiAuthorityText} from './source-text.mjs';
/** Original app.mts4415–4423 MIDI help/disabled presentation and
 * public/index.html447/544 music labels after original static translations.
 * Synthetic DOM and fake device availability only; no browser permission,
 * native MIDI, rendered tooltip or gameplay claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${baseline}:${path}`], {cwd: project, encoding: 'utf8'});
let env, React, createRoot, owners, work, root, originalHTML, originalSync;
const step = callback => React.act(async () => {callback?.(); await Promise.resolve();});
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  assert.equal(pinnedUiAuthorityText(await readFile(resolve(project, 'src/launcher/i18n.mts'), 'utf8')), pinned('src/launcher/i18n.mts'));
  originalHTML = pinned('public/index.html');
  const source = pinned('src/launcher/app.mts'), start = source.indexOf('function syncExternalMidiOptions() {');
  const code = source.slice(start, source.indexOf('// Device hotplug', start));
  originalSync = new Function('scope', `with (scope) {${code}; syncExternalMidiOptions();}`);
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/settings-midi-title-'));
  const outfile = resolve(work, 'owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {SettingsBody} from './app/components/settings/SettingsBody.tsx';
    export {createGameSettingsModel} from './app/models/game-settings.ts';
    export {LocaleProvider, translate} from './app/i18n.tsx';
    export {setUiLocale, applyStaticTranslations} from './src/launcher/i18n.mts';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external',
    plugins: [authoredSourcesPlugin(project)], logLevel: 'silent'});
  owners = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {if (root) await step(() => root.unmount()); root = null; env.document.body.replaceChildren(); assert.deepEqual(env.errors.splice(0), []);});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
function expected({visible, supported, locale, prefix}) {
  const document = new env.window.DOMParser().parseFromString(originalHTML, 'text/html');
  const ids = ['externalMidi', 'mpExternalMidi'];
  const hint = owners.translate(locale, supported ? 'settings.externalMidiHint' : 'settings.externalMidiUnsupported');
  originalSync({$: selector => document.querySelector(selector), externalMidiEnabled: false,
    externalMidiOptionVisible: () => visible, externalMidiOptionApplicable: () => visible && supported,
    externalMidiStatusText: () => hint, webMidiSupported: supported, state: {options: {externalMidiDeviceId: ''}},
    externalMidi: {panic() {}, setSelectedId() {}, granted: false, outputInfo: () => []},
    externalMidiOptionRows: ids.map(id => ({option: `#${id}Option`, toggle: `#${id}Toggle`, hint: `#${id}Hint`, device: `#${id}DeviceOption`, select: `#${id}DeviceSelect`})),
    populateExternalMidiDeviceSelect() {}, t: (key, params) => owners.translate(locale, key, params),
  });
  const button = document.querySelector(`#${prefix}Toggle`);
  return {title: button.title, disabled: button.disabled, hidden: document.querySelector(`#${prefix}Option`).hidden};
}
for (const locale of ['zh-CN', 'en']) for (const productId of ['th06', 'th06mp']) test(`${locale} ${productId}: music label and MIDI title/disabled follow main across locale/support/visibility`, async () => {
  owners.setUiLocale(locale, {persist: false, notify: false});
  const originalDocument = new env.window.DOMParser().parseFromString(originalHTML, 'text/html');
  owners.applyStaticTranslations(originalDocument);
  const musicId = productId.endsWith('mp') ? 'mpMusicSelect' : 'musicSelect';
  const originalMusicLabel = originalDocument.getElementById(musicId).getAttribute('aria-label');
  const values = new Map(), storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value))};
  const model = owners.createGameSettingsModel({storage});
  model.hydrate({productId, uiLocale: locale, languages: [{id: 'ja', title: '日本語'}],
    musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: false}, webMidiAvailable: false, mobile: false});
  const listeners = new Set(), calls = [];
  let midi = Object.freeze({enabled: false, granted: false, busy: false, supported: false, outputs: [], selectedId: '', hint: owners.translate(locale, 'settings.externalMidiUnsupported')});
  const unavailable = () => {throw new Error('Unexpected non-MIDI fixture action');};
  const actions = {confirm: unavailable, file: unavailable, showAppleNotice: unavailable, feedback: unavailable, reportError: unavailable,
    externalMidi: {subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);}, getSnapshot: () => midi,
      setEnabled: async value => calls.push(value), selectOutput: unavailable}};
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await step(() => root.render(React.createElement(owners.LocaleProvider, {locale}, React.createElement(owners.SettingsBody, {model, actions, onOpenTouchLayout: unavailable}))));
  assert.equal(container.querySelector('.mp-setting-item,.mp-mobile-options,.mp-file-tools-grid'), null, 'common settings do not opt into separate MP spacing');
  const practice = container.querySelector(productId.endsWith('mp') ? '#mpThpracToggle' : '#thpracToggle');
  assert.ok(practice, 'practice row exists in both versions');
  assert.equal(practice.disabled, productId.endsWith('mp'));
  const prefix = productId.endsWith('mp') ? 'mpExternalMidi' : 'externalMidi';
  const button = env.document.getElementById(`${prefix}Toggle`);
  const musicSelect = env.document.getElementById(musicId);
  assert.equal(musicSelect.getAttribute('aria-label'), originalMusicLabel, 'Preserve the actual original native label, including absence');
  // Original custom-select.mts falls back to common.selectOption when the
  // native select has neither aria-label nor a linked label element.
  assert.equal(musicSelect.parentElement.querySelector('.mizuki-select-trigger').getAttribute('aria-label'),
    originalMusicLabel || owners.translate(locale, 'common.selectOption'));
  function compare() {
    const visible = model.getSnapshot().music === 'midi', actual = {title: button.title, disabled: button.disabled, hidden: env.document.getElementById(`${prefix}Option`).hidden};
    assert.deepEqual(actual, expected({visible, supported: midi.supported, locale, prefix}));
    assert.equal(env.document.getElementById(`${prefix}Toggle`), button, 'Same shared control survives availability updates');
    assert.equal(button.getAttribute('aria-describedby'), `${prefix}Hint`);
    assert.equal(button.getAttribute('aria-checked'), 'false');
  }
  compare(); await step(() => button.click()); assert.deepEqual(calls, []);
  await step(() => {midi = Object.freeze({...midi, supported: true, hint: owners.translate(locale, 'settings.externalMidiHint')}); for (const listener of listeners) listener();});
  compare(); await step(() => button.click()); assert.deepEqual(calls, [true]);
  await step(() => model.setMusic('none')); compare();
  await step(() => model.setMusic('midi')); compare();
  await step(() => {midi = Object.freeze({...midi, supported: false, hint: owners.translate(locale, 'settings.externalMidiUnsupported')}); for (const listener of listeners) listener();});
  compare(); assert.equal(button.title, owners.translate(locale, 'settings.externalMidiUnsupported'));
});
