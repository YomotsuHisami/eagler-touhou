/** Synthetic mounted DOM interaction contracts only, not browser/layout evidence. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, React, createRoot, owners, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  // Explicit visible geometry fixture, not rendered browser geometry.
  env.window.HTMLElement.prototype.getClientRects = function () {return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()];};
  work = await mkdtemp(resolve(project, '.cache/options-interactions-'));
  const output = resolve(work, 'owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {OptionsBackdrop} from './app/components/launcher/OptionsBackdrop.tsx';
    export {useOptionsInteractions} from './app/components/launcher/use-options-interactions.ts';
    export {OptionsOwnership, useOptionsTarget} from './app/components/launcher/options-ownership.ts';
    export {optionsTransformDuration} from './app/components/launcher/use-library-options-presence.ts';
    export {RoomSettingsDrawer} from './app/components/room/RoomSettingsDrawer.tsx';
    export {LocaleProvider} from './app/i18n.tsx';
  `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: output, packages: 'external', logLevel: 'silent'});
  owners = await import(pathToFileURL(output).href);
});
afterEach(async () => {if (root) await React.act(async () => root.unmount()); root = null; assert.deepEqual(env.errors, []); env.document.body.replaceChildren();});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
async function render(children) {
  if (!root) {const node = env.document.createElement('div'); env.document.body.append(node); root = createRoot(node);}
  await React.act(async () => root.render(React.createElement(owners.LocaleProvider, {locale: 'en'}, children)));
}
function key(node, key, shiftKey = false) {const event = new env.window.KeyboardEvent('keydown', {key, shiftKey, bubbles: true, cancelable: true}); node.dispatchEvent(event); return event;}

test('independent shared backdrops suppress wheel and route dismissal to their own host after rerender', async () => {
  const calls = [];
  await render([React.createElement(owners.OptionsBackdrop, {key: 'a', onBack: () => calls.push('a')}), React.createElement(owners.OptionsBackdrop, {key: 'b', onBack: () => calls.push('b')})]);
  const [a, b] = env.document.querySelectorAll('.library-backdrop');
  for (const node of [a, b]) {const wheel = new env.window.WheelEvent('wheel', {cancelable: true}); node.dispatchEvent(wheel); assert.equal(wheel.defaultPrevented, true);}
  a.click(); b.click(); assert.deepEqual(calls, ['a', 'b']);
  await render(React.createElement(owners.OptionsBackdrop, {key: 'b', onBack: () => calls.push('reopened')}));
  env.document.querySelector('.library-backdrop').click(); assert.deepEqual(calls, ['a', 'b', 'reopened']);
  const wheel = new env.window.WheelEvent('wheel', {cancelable: true}); a.dispatchEvent(wheel); assert.equal(wheel.defaultPrevented, false, 'unmounted listener released');
});

for (const carrier of ['options', 'room']) test(`${carrier} shares boundary focus cycling, disabled filtering and native relocated-key ownership`, async () => {
  let closes = 0;
  function Panel() {const ref = React.useRef(null); owners.useOptionsInteractions(ref, true, () => closes++); return React.createElement('aside', {ref, id: 'fixture-panel'});}
  await render(carrier === 'room' ? React.createElement(owners.RoomSettingsDrawer, {open: true, roomOpen: true, onCloseRequest: () => closes++}) : React.createElement(Panel));
  const node = env.document.querySelector(carrier === 'room' ? '#mpSettingsRoomDrawer' : '#fixture-panel');
  // Native DOM relocation has no React event ancestry under the destination.
  const controls = env.document.createElement('div');
  controls.innerHTML = '<button id="first">First</button><button disabled>Disabled</button><div hidden><button>Hidden</button></div><button style="visibility:hidden">Invisible</button><textarea id="middle"></textarea><div tabindex="2" id="last">Last</div>';
  node.append(controls);
  const first = controls.querySelector('#first'), middle = controls.querySelector('#middle'), last = controls.querySelector('#last');
  first.focus(); assert.equal(key(first, 'Tab', true).defaultPrevented, true); assert.equal(env.document.activeElement, last);
  last.focus(); assert.equal(key(last, 'Tab').defaultPrevented, true); assert.equal(env.document.activeElement, first);
  middle.focus(); assert.equal(key(middle, 'Tab').defaultPrevented, false);
  assert.equal(key(middle, 'Escape').defaultPrevented, true); assert.equal(closes, 1);
});

test('scoped registration isolates multiple owners and cleans local refs without clearing newer nodes', async () => {
  const a = {panel: null, selectedCard: null}, b = {panel: null, selectedCard: null};
  const locals = [], callbacks = [];
  function Port({index}) {const ref = React.useRef(null); locals[index] = ref; const register = owners.useOptionsTarget('panel', ref); callbacks[index] = register; return React.createElement('aside', {ref: register, 'data-port': index});}
  await render([React.createElement(owners.OptionsOwnership, {key: 'a', value: a}, React.createElement(Port, {index: 0})), React.createElement(owners.OptionsOwnership, {key: 'b', value: b}, React.createElement(Port, {index: 1}))]);
  assert.notEqual(a.panel, b.panel); assert.equal(a.panel.dataset.port, '0'); assert.equal(b.panel.dataset.port, '1');
  const older = env.document.createElement('aside'), newer = env.document.createElement('aside');
  const retireOlder = callbacks[0](older), retireNewer = callbacks[0](newer);
  retireOlder(); assert.equal(a.panel, newer); assert.equal(locals[0].current, newer);
  retireNewer(); assert.equal(a.panel, null); assert.equal(locals[0].current, null);
  await render(null); assert.equal(b.panel, null); assert.equal(locals[1].current, null);
});

test('transform timing handles CSS lists, all overrides, negative delays and explicit no motion', () => {
  const node = env.document.createElement('aside'); env.document.body.append(node);
  assert.equal(owners.optionsTransformDuration(node), null, 'no stylesheets/inline source');
  for (const [property, duration, delay, expected] of [
    ['opacity, transform', '9s, 200ms', '0s', 200],
    ['opacity, color, transform', '100ms, .48s', '0s, 20ms', 100],
    ['all, transform', '500ms, 200ms', '10ms', 210],
    ['transform, all', '200ms, 480ms', '-.08s', 400],
    ['transform', '0s', '0s', 0], ['none', '480ms', '0s', 0], ['opacity', '480ms', '0s', 0],
  ]) {node.style.transitionProperty = property; node.style.transitionDuration = duration; node.style.transitionDelay = delay; assert.equal(owners.optionsTransformDuration(node), expected);}
});
