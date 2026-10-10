/** Synthetic third-consumer reuse; no browser, layout or native top-layer claim. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, React, createRoot, LobbyDialogHeader;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  work = await mkdtemp(resolve(project, '.cache/lobby-dialog-header-'));
  const output = resolve(work, 'header.mjs');
  await build({absWorkingDir: project, entryPoints: ['app/components/directory/LobbyDialogHeader.tsx'], outfile: output,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent'});
  ({LobbyDialogHeader} = await import(pathToFileURL(output).href));
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

test('a third form consumer retains its own lifecycle, IDs, labels and close callback across rerenders', async () => {
  const container = env.document.createElement('div'); env.document.body.append(container);
  const root = createRoot(container); const calls = []; let submissions = 0;
  const render = props => React.act(async () => root.render(React.createElement('form', {onSubmit: event => {event.preventDefault(); submissions++;}},
    React.createElement(LobbyDialogHeader, {titleId: 'thirdTitle', closeId: 'thirdClose', ...props}), React.createElement('input', {defaultValue: 'retained draft'}))));
  try {
    await render({title: 'Third title', closeContent: 'Cancel', onCloseRequest: () => calls.push('first')});
    const button = container.querySelector('button'), title = container.querySelector('h2'), input = container.querySelector('input');
    assert.equal(button.className, 'lobby-close'); assert.equal(button.type, 'button'); assert.equal(button.id, 'thirdClose');
    assert.equal(button.hasAttribute('aria-label'), false); assert.equal(title.id, 'thirdTitle');
    assert.equal(title.parentElement.className, 'lobby-dialog-head');
    input.value = 'edited draft'; button.click(); button.click(); assert.deepEqual(calls, ['first', 'first']); assert.equal(submissions, 0);
    // Header cannot consume carrier Escape/outside click or invent dismissal.
    input.dispatchEvent(new env.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); container.querySelector('form').click();
    assert.deepEqual(calls, ['first', 'first']);
    await render({title: React.createElement('span', null, 'Updated title'), closeContent: '×', closeLabel: 'Dismiss third', onCloseRequest: () => calls.push('updated')});
    assert.equal(container.querySelector('button'), button); assert.equal(container.querySelector('h2'), title);
    assert.equal(input.value, 'edited draft'); assert.equal(title.textContent, 'Updated title'); assert.equal(button.textContent, '×'); assert.equal(button.getAttribute('aria-label'), 'Dismiss third');
    button.click(); assert.deepEqual(calls, ['first', 'first', 'updated']); assert.equal(submissions, 0);
    assert.deepEqual(env.errors, []);
  } finally {await React.act(async () => root.unmount()); container.remove();}
});
