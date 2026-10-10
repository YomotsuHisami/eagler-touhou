/** Third-consumer mounted contracts for shared presentation owners.
 * Synthetic DOM only; no browser layout, animation pixels or native runtime. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, React, createRoot, owners, root;
const act = async callback => React.act(async () => {callback(); await new Promise(resolve => setTimeout(resolve, 0));});
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  work = await mkdtemp(resolve(project, '.cache/settings-primitives-'));
  const output = resolve(work, 'owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {SettingsBody} from './app/components/settings/SettingsBody.tsx';
    export {createGameSettingsModel} from './app/models/game-settings.ts';
    export {LocaleProvider} from './app/i18n.tsx';
    export {LaunchActions} from './app/components/launcher/LaunchActions.tsx';
    export {OptionsGroup} from './app/components/settings/OptionsGroup.tsx';
    export {OptionRow} from './app/components/settings/OptionRow.tsx';
    export {OptionSwitch} from './app/components/settings/TouchSettingsFields.tsx';
  `}, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [authoredSourcesPlugin(project)], logLevel: 'silent'});
  owners = await import(pathToFileURL(output).href);
});
afterEach(async () => {if (root) await act(() => root.unmount()); root = null; assert.deepEqual(env.errors, []); env.document.body.replaceChildren();});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
async function render(tree) {if (!root) {const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);} await act(() => root.render(tree));}
const n = selector => {const node = env.document.querySelector(selector); assert.ok(node, selector); return node;};

test('third launch consumer shares shell/icon order and retains current intent, disabled and label ownership', async () => {
  const calls = []; let submits = 0;
  async function update(label, disabled = false) {
    await render(React.createElement('form', {onSubmit: event => {event.preventDefault(); submits++;}}, React.createElement(owners.LaunchActions, {
      placement: 'compact', primary: {id: 'thirdPlay', textId: 'thirdText', label, disabled, onClick: () => calls.push(label)},
      secondary: {id: 'thirdImport', label: 'Import', onClick: () => calls.push('import')},
    })));
  }
  await update('Preview');
  const play = n('#thirdPlay'), secondary = n('#thirdImport');
  assert.equal(play.parentElement.className, 'launch-wrap launch-actions launch-actions-compact');
  assert.equal(play.className, 'launch'); assert.equal(secondary.className, 'launch launch-secondary');
  assert.equal(play.firstElementChild.id, 'thirdText'); assert.equal(play.lastElementChild.className, 'launch-icon');
  assert.equal(secondary.firstElementChild.className, 'launch-icon'); assert.equal(secondary.lastElementChild.textContent, 'Import');
  assert.equal(play.querySelector('path').getAttribute('d'), 'm9 6 9 6-9 6Z');
  for (const button of [play, secondary]) {assert.equal(button.type, 'button'); assert.equal(button.querySelector('.launch-icon').getAttribute('aria-hidden'), 'true');}
  play.click(); secondary.click(); assert.deepEqual(calls, ['Preview', 'import']); assert.equal(submits, 0);
  await update('Busy', true); assert.equal(n('#thirdPlay'), play); play.click(); assert.deepEqual(calls, ['Preview', 'import']);
  await update('Retry'); play.click(); assert.deepEqual(calls, ['Preview', 'import', 'Retry']); assert.equal(submits, 0);
});

test('third native group keeps model-owned disclosure and same child/focus through repeated close/reopen', async () => {
  const changes = [];
  const input = React.createElement('input', {defaultValue: 'draft', id: 'draft'});
  async function update(open, prefix = 'first') {await render(React.createElement(owners.OptionsGroup, {id: 'thirdGroup', title: 'Third group', open,
    onOpenChange: value => changes.push([prefix, value]), bodyClassName: 'file-tools-grid'}, input));}
  await update(true);
  const group = n('#thirdGroup'), draft = n('#draft'), summary = n('summary');
  assert.equal(group.className, 'options-group'); assert.equal(summary.className, 'options-group-head');
  assert.equal(summary.querySelector('i').textContent, '⌄'); assert.equal(summary.querySelector('i').getAttribute('aria-hidden'), 'true');
  assert.equal(draft.parentElement.className, 'file-tools-grid'); draft.value = 'edited'; draft.focus();
  await act(() => summary.click()); assert.equal(changes.at(-1)[1], false, 'native toggle reports actual details state');
  await update(false, 'latest'); await update(true, 'latest');
  assert.equal(n('#thirdGroup'), group); assert.equal(n('#draft'), draft); assert.equal(draft.value, 'edited');
  assert.equal(env.document.activeElement, draft, 'presentation did not invent a focus lifecycle');
  await act(() => summary.click()); assert.deepEqual(changes.at(-1), ['latest', false]);
});

test('third option row preserves label/hint structure, linked switch and hidden/disabled gates', async () => {
  const changes = [];
  async function update({hidden = false, disabled = false, checked = false, inlineLabel = false, hint = 'Reason'} = {}) {
    await render(React.createElement(owners.OptionRow, {id: 'thirdRow', className: 'item option-frame-limit', label: 'Third switch', hint,
      hintId: 'thirdHint', inlineLabel, hidden, control: React.createElement(owners.OptionSwitch, {id: 'thirdSwitch', label: 'Third switch', describedBy: 'thirdHint', title: 'Capability reason',
        disabled, checked, onChange: () => changes.push(!checked)})}));
  }
  await update(); const row = n('#thirdRow'), button = n('#thirdSwitch');
  assert.equal(row.firstElementChild.className, 'itemtop'); assert.equal(n('#thirdHint').parentElement.firstElementChild.textContent, 'Third switch');
  assert.equal(button.getAttribute('aria-describedby'), 'thirdHint'); assert.equal(button.title, 'Capability reason');
  button.click(); assert.deepEqual(changes, [true]);
  await update({disabled: true, checked: true, hidden: true}); assert.equal(n('#thirdSwitch'), button); assert.equal(row.hidden, true);
  assert.equal(button.getAttribute('aria-checked'), 'true'); assert.equal(button.className, 'option-switch on'); button.click(); assert.deepEqual(changes, [true]);
  await update({inlineLabel: true}); assert.equal(n('#thirdHint').parentElement.firstChild.nodeType, env.window.Node.TEXT_NODE);
  await render(React.createElement(owners.OptionRow, {className: 'item', label: 'Plain', control: React.createElement('button', {type: 'button'}, 'Control')}));
  assert.equal(env.document.querySelector('small'), null); assert.equal(n('.itemtop>span').textContent, 'Plain');
});

for (const productId of ['th06', 'th06mp']) test(`${productId}: grouped settings retain one touch section across mobile reorder`, async () => {
  const values = new Map();
  const model = owners.createGameSettingsModel({storage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value))}});
  const context = {productId, uiLocale: 'en', languages: [{id: 'ja', title: 'Japanese'}],
    musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: false}, webMidiAvailable: false, mobile: false};
  model.hydrate(context); model.setDisclosure('touch', true);
  const midi = Object.freeze({enabled: false, granted: false, busy: false, supported: false, outputs: [], selectedId: '', hint: 'Unavailable'});
  const unexpected = () => {throw new Error('Unexpected domain action');};
  const actions = {confirm: unexpected, file: unexpected, showAppleNotice: unexpected, feedback() {}, reportError: unexpected,
    externalMidi: {subscribe: () => () => {}, getSnapshot: () => midi, setEnabled: unexpected, selectOutput: unexpected}};
  await render(React.createElement(owners.LocaleProvider, {locale: 'en'}, React.createElement(owners.SettingsBody, {model, actions, onOpenTouchLayout: unexpected})));
  const prefix = productId.endsWith('mp') ? 'mpMobile' : 'mobile';
  const section = n(`#${prefix}Options`), toggle = n(`#${prefix}OptionsToggle`), body = n(`#${prefix}OptionsBody`);
  const groups = [...env.document.querySelectorAll('details.options-group')];
  toggle.focus();
  for (const mobile of [true, false, true, false]) {
    await act(() => model.refreshContext({...context, mobile}));
    assert.equal(n(`#${prefix}Options`), section); assert.equal(n(`#${prefix}OptionsToggle`), toggle); assert.equal(n(`#${prefix}OptionsBody`), body);
    assert.equal(env.document.querySelectorAll(`#${prefix}Options`).length, 1);
    assert.deepEqual([...env.document.querySelectorAll('details.options-group')], groups);
    assert.equal(model.getSnapshot().disclosure.touch, true); assert.equal(body.hasAttribute('inert'), false);
    assert.equal(env.document.activeElement, toggle);
    const siblings = [...section.parentElement.children];
    assert.equal(mobile ? siblings.indexOf(section) < siblings.indexOf(groups[0]) : siblings.indexOf(section) > siblings.indexOf(groups.at(-1)), true);
  }
});
