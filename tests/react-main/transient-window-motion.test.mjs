/** Actual shared component + authored CSSOM reuse. This proves shared motion
 * configuration, not native rendering, animation timing or fullscreen paint. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import {JSDOM} from 'jsdom';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const project = fileURLToPath(new URL('../../', import.meta.url));
let work, api;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/transient-motion-'));
  const outfile = resolve(work, 'window.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents:
    `export {TransientWindow} from './app/components/TransientWindow.tsx';`},
    outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent'});
  api = await import(pathToFileURL(outfile).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

test('one authored entrance and reduced-motion rule drives both transient presentation variants', async () => {
  const authored = postcss.parse(await readFile(resolve(project, 'public/styles.css'), 'utf8'));
  const shared = postcss.root(), reduced = postcss.root();
  authored.walkRules(rule => {
    if (!/\.game-data-(?:import|link)-window\b/.test(rule.selector)) return;
    if (rule.parent.type === 'root') shared.append(rule.clone());
    else if (rule.parent.type === 'atrule' && rule.parent.name === 'media' && rule.parent.params === '(prefers-reduced-motion:reduce)') {
      // Apply the actual matched-media rules explicitly. jsdom does not emulate
      // a device's reduced-motion setting or claim to execute its animations.
      reduced.append(rule.clone());
    }
  });
  const entrances = shared.nodes.filter(rule => rule.selector === '.game-data-import-window,.game-data-link-window' &&
    rule.nodes.some(declaration => declaration.prop === 'animation'));
  assert.equal(entrances.length, 1, 'both aliases have one shared entrance owner');
  const entrance = entrances[0];
  const animation = entrance.nodes.find(declaration => declaration.prop === 'animation');
  assert.equal(animation.value, 'mizuki-centered-panel-in 230ms cubic-bezier(.4,0,.2,1) both');
  animation.value = animation.value.replace('230ms', '417ms');
  assert.equal(reduced.nodes.length, 1);
  assert.ok(reduced.nodes[0].selectors.includes('.game-data-import-window'));
  assert.ok(reduced.nodes[0].selectors.includes('.game-data-link-window'));

  const markup = ['standard', 'reference'].map(variant => renderToStaticMarkup(React.createElement(api.TransientWindow,
    {variant, id: `${variant}Window`, titleId: `${variant}Title`, title: 'Shared presentation', closeId: `${variant}Close`,
      closeLabel: 'Close', open: true, onClose() {}}, React.createElement('p', null, 'Content')))).join('');
  const dom = new JSDOM(`<!doctype html><head></head><body>${markup}</body>`);
  try {
    const {document} = dom.window, style = document.createElement('style');
    style.textContent = shared.toString(); document.head.append(style);
    const windows = [...document.querySelectorAll('section')]; assert.equal(windows.length, 2);
    for (const window of windows) assert.equal(dom.window.getComputedStyle(window).animation,
      'mizuki-centered-panel-in 417ms cubic-bezier(.4,0,.2,1) both', 'changing one shared rule changes both consumers');
    assert.equal(dom.window.getComputedStyle(windows[0]).zIndex, '45');
    assert.equal(dom.window.getComputedStyle(windows[1]).zIndex, '46', 'reference layering remains a real presentation difference');
    style.textContent += `\n${reduced.toString()}`;
    for (const window of windows) assert.equal(dom.window.getComputedStyle(window).animation, 'none', 'both variants share reduced-motion suppression');
  } finally {dom.window.close();}
});
