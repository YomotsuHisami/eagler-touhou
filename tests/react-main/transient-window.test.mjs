/** Shared nonmodal presentation in synthetic DOM only. No browser layout,
 * native focus/fullscreen or popup/file-picker acceptance is claimed. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, api, React, createRoot, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/transient-window-'));
  const outfile = resolve(work, 'window.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents:
    `export {TransientWindow} from './app/components/TransientWindow.tsx';`},
    outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent'});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) {await React.act(async () => root.unmount()); root = null;}
  assert.deepEqual(env.errors.splice(0), []); env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

async function mount(variant, strictMode) {
  const host = env.document.createElement('div'), outside = env.document.createElement('button'), calls = [];
  outside.textContent = 'Outside'; env.document.body.append(outside, host); outside.focus();
  root = createRoot(host);
  let props = {id: 'thirdWindow', titleId: 'thirdTitle', title: 'Reusable content', closeId: 'thirdClose',
    closeLabel: 'Close reusable content', open: false, variant, onClose: () => calls.push('initial')};
  const render = async changes => {
    props = {...props, ...changes};
    await React.act(async () => root.render(React.createElement(strictMode ? React.StrictMode : React.Fragment, null,
      React.createElement(api.TransientWindow, props, React.createElement('input', {id: 'thirdInput', defaultValue: 'retained'})))));
  };
  await render({});
  return {outside, calls, render, section: host.querySelector('section'), close: host.querySelector('button'), input: host.querySelector('input')};
}

for (const strictMode of [false, true]) for (const variant of ['standard', 'reference']) {
  test(`shared ${variant} shell supports a third consumer without new structure or close handlers (StrictMode=${strictMode})`, async () => {
    const f = await mount(variant, strictMode), {section, close, input} = f;
    assert.equal(section.className, variant === 'standard' ? 'game-data-import-window' : 'game-data-link-window');
    assert.equal(section.hidden, true); assert.equal(section.tagName, 'SECTION');
    assert.equal(section.getAttribute('role'), 'dialog'); assert.equal(section.getAttribute('aria-modal'), 'false');
    assert.equal(section.getAttribute('aria-labelledby'), 'thirdTitle'); assert.equal(section.hasAttribute('aria-busy'), false);
    assert.equal(section.querySelector('header > div > strong').id, 'thirdTitle');
    assert.equal(close.textContent, '×'); assert.equal(close.type, 'button');
    assert.equal(close.getAttribute('aria-label'), 'Close reusable content');
    assert.equal(env.document.querySelector('dialog'), null);

    await f.render({open: true}); assert.equal(env.document.activeElement, f.outside);
    input.focus(); input.value = 'user-edited content';
    await f.render({open: true, title: 'Updated content'});
    assert.equal(env.document.activeElement, input); assert.equal(input.value, 'user-edited content');
    assert.equal(section.querySelector('input'), input); assert.equal(section.querySelector('button'), close);
    assert.equal(section.querySelector('strong').textContent, 'Updated content');
    await React.act(async () => {
      input.dispatchEvent(new env.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      f.outside.click();
    });
    assert.equal(section.hidden, false); assert.deepEqual(f.calls, [], 'no modal Escape/outside dismissal is introduced');

    await f.render({busy: true}); assert.equal(section.getAttribute('aria-busy'), 'true'); assert.equal(close.disabled, true);
    await React.act(async () => close.click()); assert.deepEqual(f.calls, []);
    await f.render({busy: false, onClose: () => f.calls.push('latest')});
    await React.act(async () => close.click()); assert.deepEqual(f.calls, ['latest']);
    assert.equal(section.hidden, false, 'visibility stays controlled by the caller');
    await f.render({open: false}); assert.equal(section.hidden, true);
    await f.render({open: true}); assert.equal(section.hidden, false);
    assert.equal(section.querySelector('input'), input); assert.equal(input.value, 'user-edited content');
    assert.equal(section.querySelector('button'), close);
    await React.act(async () => root.unmount()); root = null;
    assert.deepEqual(f.calls, ['latest'], 'unmount does not invent a close decision');
  });
}
