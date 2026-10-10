/** Synthetic third-consumer contract, not browser keyboard/layout evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));

test('reusable choice groups retain caller values, capability/phase gates, focus and native button semantics', async () => {
  const env = installMountedDom(); const React = await import('react'), {createRoot} = await import('react-dom/client');
  const work = await mkdtemp(resolve(project, '.cache/room-choice-group-')), output = resolve(work, 'owner.mjs');
  let root;
  try {
    await build({absWorkingDir: project, entryPoints: ['app/components/room/RoomChoiceGroup.tsx'], outfile: output,
      bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent'});
    const {RoomChoiceGroup} = await import(pathToFileURL(output).href);
    const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
    const calls = []; let submits = 0;
    async function render(disabled, selected = 'a') {
      await React.act(async () => root.render(React.createElement('form', {onSubmit: event => {event.preventDefault(); submits++;}},
        React.createElement(RoomChoiceGroup, {title: 'Independent choices', name: 'third', valueAttribute: 'data-third-choice',
          choices: [{value: 'a', label: 'A', selected: selected === 'a', disabled}, {value: 'b', label: 'B', selected: selected === 'b', disabled: false},
            {value: 'unsupported', label: 'Unavailable', selected: false, hidden: true, disabled: true}], onSelect: value => calls.push(['third', value])}),
        React.createElement(RoomChoiceGroup, {title: React.createElement('strong', {id: 'fourthTitle'}, 'Numeric choices'), valueAttribute: 'data-fourth-choice',
          choices: [{value: 2, label: 'Two', selected: true, disabled: false}], onSelect: value => calls.push(['fourth', value])}))));
    }
    await render(false);
    const groups = [...container.querySelectorAll('.mp-room-choice-group')], a = container.querySelector('[data-third-choice="a"]'), b = container.querySelector('[data-third-choice="b"]');
    assert.equal(groups.length, 2); assert.equal(groups[0].previousElementSibling.className, 'mp-room-setting-title');
    assert.equal(groups[0].dataset.mpRoomChoice, 'third'); assert.equal(groups[1].hasAttribute('data-mp-room-choice'), false);
    assert.equal(groups[1].previousElementSibling.querySelector('strong').id, 'fourthTitle');
    assert.equal(a.className, 'selected'); assert.equal(a.getAttribute('aria-pressed'), 'true');
    assert.equal(a.hasAttribute('role'), false); assert.equal(a.type, 'button');
    a.click(); b.click(); container.querySelector('[data-fourth-choice]').click();
    assert.deepEqual(calls, [['third', 'a'], ['third', 'b'], ['fourth', 2]], 'selection itself does not invent a disable policy');
    assert.equal(submits, 0);
    const unsupported = container.querySelector('[data-third-choice="unsupported"]');
    assert.equal(unsupported.hidden, true); assert.equal(unsupported.disabled, true); assert.equal(groups[0].children.length, 3);
    b.focus(); await render(true, 'b');
    assert.equal(container.querySelector('[data-third-choice="a"]'), a); assert.equal(container.querySelector('[data-third-choice="b"]'), b);
    assert.equal(env.document.activeElement, b); assert.equal(b.getAttribute('aria-pressed'), 'true'); assert.equal(a.hasAttribute('class'), false);
    a.click(); assert.equal(calls.length, 3, 'caller-provided disabled state gates invocation');
    assert.deepEqual(env.errors, []);
  } finally {if (root) await React.act(async () => root.unmount()); env.close(); await rm(work, {recursive: true, force: true});}
});
