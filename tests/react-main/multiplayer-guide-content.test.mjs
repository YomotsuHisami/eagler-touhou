/** Executed pinned transformation/sanitizer oracle. Synthetic DOM only: layout,
 * native details activation and browser XSS enforcement are separate gates. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
const pinned = name => execFileSync('git', ['show', `edee9633e5e3ee79cd2e1aa334f84f6caf755090:src/launcher/${name}`], {cwd: project, encoding: 'utf8'});
const original = pinned('multiplayer-guide.mts');
const originalBuilder = original.slice(original.indexOf('interface AuthoredGuideGroup'), original.indexOf('function isDialogElement'));
let api, work, inputs;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/shared-guide-content-'));
  const outfile = resolve(work, 'builders.mjs');
  const result = await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {buildRuleGuide, DEFAULT_GUIDE_GAME} from './src/launcher/multiplayer-guide-content.mts';
    export * as canonicalController from './src/launcher/multiplayer-guide.mts';
    export {renderContentFragment} from './src/launcher/content-fragment.mts';
    export {buildRuleGuide as pinnedBuilder} from 'pinned:multiplayer-guide.mts';
    export {renderContentFragment as pinnedSanitizer} from 'pinned:content-fragment.mts';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true, logLevel: 'silent', plugins: [{name: 'executed-pinned-guide', setup(ctx) {
    ctx.onResolve({filter: /^pinned:/}, args => ({path: args.path.slice(7), namespace: 'pinned'}));
    ctx.onResolve({filter: /^\.\/content-fragment\.mjs$/, namespace: 'pinned'}, () => ({path: 'content-fragment.mts', namespace: 'pinned'}));
    ctx.onLoad({filter: /.*/, namespace: 'pinned'}, args => ({loader: 'ts', resolveDir: resolve(project, 'src/launcher'),
      contents: pinned(args.path) + (args.path === 'multiplayer-guide.mts' ? '\nexport {buildRuleGuide};' : '')}));
  }}, authoredSourcesPlugin(project)]});
  inputs = Object.keys(result.metafile.inputs); api = await import(pathToFileURL(outfile).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

test('one framework-independent builder retains pinned bytes and original controller API/lifecycle', () => {
  const current = readFileSync(resolve(project, 'src/launcher/multiplayer-guide-content.mts'), 'utf8');
  const body = current.slice(current.indexOf('interface AuthoredGuideGroup')).replace('export const DEFAULT_GUIDE_GAME', 'const DEFAULT_GUIDE_GAME').replace('export function buildRuleGuide', 'function buildRuleGuide');
  assert.equal(body, originalBuilder);
  const controller = readFileSync(resolve(project, 'src/launcher/multiplayer-guide.mts'), 'utf8');
  assert.equal(controller, original.replace('import { renderContentFragment } from "./content-fragment.mjs";', 'import { renderContentFragment } from "./content-fragment.mjs";\nimport {buildRuleGuide, DEFAULT_GUIDE_GAME} from "./multiplayer-guide-content.mjs";').replace(originalBuilder, ''));
  assert.deepEqual(Object.keys(api.canonicalController).sort(), ['MULTIPLAYER_GUIDE_FILE', 'createMultiplayerGuideController']);
  assert.equal(api.DEFAULT_GUIDE_GAME, 'th07');
  assert.equal(readFileSync(resolve(project, 'src/launcher/content-fragment.mts'), 'utf8'), pinned('content-fragment.mts'));
  assert.equal(existsSync(resolve(project, 'app/components/notices/multiplayer-guide-content.ts')), false);
  assert.ok(readFileSync(resolve(project, 'app/components/notices/MultiplayerGuideDialog.tsx'), 'utf8').includes("from '../../../src/launcher/multiplayer-guide-content.mts'"));
  assert.equal(inputs.filter(path => path === 'src/launcher/multiplayer-guide-content.mts').length, 1);
  assert.doesNotMatch(current, /(?:from\s+['"]react|\bfetch\s*\(|\bshowModal\s*\(|\bhistory\.)/);
});

const cases = {
  authored: readFileSync(resolve(project, 'public/content/MULTIPLAYER.html'), 'utf8'),
  headings: '<p>Before any group</p><h2>  通用规则 \n </h2><h3>First</h3><p>Common A</p><h4>Nested</h4><p>Common B</p><h2>TH06 红魔乡</h2><h3>本作特有规则</h3><h4>Flattened</h4><p>Six</p><h3>Section</h3><h4>Nested section</h4><p>Six detail</p><h2>TH07 妖妖梦</h2><p>Direct child</p><h2>TH07 妖妖梦</h2><h3>Last duplicate wins</h3><p>Replacement</p><h2>Unknown group</h2><p>Not a game panel</p>',
  empty: '',
  noCommon: '<h2>TH06 红魔乡</h2><p>Kept sanitized without guide grouping</p>',
  hostile: '<h2>通用规则</h2><h3>Readable</h3><p id="Module" style="display:none" onclick="bad()" class="markdown-blockquote evil">Safe <strong>text</strong><a href="java&#x09;script:bad()">Unsafe</a><a href="/safe" target="_blank" rel="opener">Safe link</a></p><script>bad()</script><iframe srcdoc="bad"></iframe><svg><text>Bad</text></svg><math><mtext>Bad</mtext></math><img src="data:bad"><img src="/safe.png" onerror="bad()"><h2>TH08 永夜抄</h2><h3>本作特有规则</h3><ol start="-3"><li>Rule</li></ol><table><tr><td align="right" style="color:red">Cell</td></tr></table>' + '<div>'.repeat(70) + '<p>Too deep</p>' + '</div>'.repeat(70),
};
function execute(builder, sanitizer, html, initialGameId) {
  const dom = new JSDOM('<!doctype html><div id="content"></div>', {url: 'https://launcher.invalid/base/'});
  const {window} = dom, document = window.document, target = document.getElementById('content'), scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function (options) {scrolls.push([this.dataset.game, options]);};
  try {
    sanitizer(target, html, document); const sanitized = target.innerHTML;
    builder(target, document, initialGameId);
    const trace = [], capture = action => trace.push({action, html: target.innerHTML, scroll: target.scrollTop,
      focus: document.activeElement?.dataset.game ?? null, scrolls: structuredClone(scrolls)});
    capture('initial');
    const guide = target.querySelector('[data-mp-rule-guide]');
    if (guide) {
      const tabs = target.querySelector('.multiplayer-rule-game-tabs');
      const first = tabs.querySelector('button'); first.focus();
      const left = new window.KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true, cancelable: true}); first.dispatchEvent(left);
      assert.equal(left.defaultPrevented, true); capture('left wraps focus only');
      const right = new window.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}); document.activeElement.dispatchEvent(right);
      assert.equal(right.defaultPrevented, true); capture('right wraps focus only');
      for (const game of ['th06', 'th07', 'th08', 'th10']) {target.scrollTop = 123; tabs.querySelector(`[data-game="${game}"]`).click(); capture(`click ${game}`);}
      const disclosure = target.querySelector('.multiplayer-rule-panel[data-game="th10"] details'); disclosure.open = true; capture('native disclosure state');
      for (const game of ['th08', 'unknown', '', 'th10']) {target.scrollTop = 234; guide.dispatchEvent(new window.CustomEvent('mp-guide-select-game', {detail: game})); capture(`select ${game}`);}
    }
    return {sanitized, trace};
  } finally {window.close();}
}
for (const [name, html] of Object.entries(cases)) for (const game of ['th06', 'th07', 'th08', 'th10', 'unknown', '']) test(`pinned executed guide transformation: ${name}, initial=${game || '(empty)'}`, () => {
  const expected = execute(api.pinnedBuilder, api.pinnedSanitizer, html, game);
  const actual = execute(api.buildRuleGuide, api.renderContentFragment, html, game);
  assert.deepEqual(actual, expected);
  if (name === 'hostile') {
    assert.doesNotMatch(actual.sanitized, /<(?:script|iframe|svg|math)\b|\s(?:onclick|onerror|style|id)=/);
    assert.ok(actual.sanitized.includes('href="https://launcher.invalid/safe"'));
    assert.ok(actual.sanitized.includes('rel="noopener noreferrer"'));
    assert.ok(!actual.sanitized.includes('Too deep'));
  }
  if (['authored', 'headings', 'hostile'].includes(name)) {
    const initial = new JSDOM(actual.trace[0].html).window;
    try {
      assert.equal(initial.document.querySelectorAll('.multiplayer-rule-game-tab').length, 4);
      assert.equal(initial.document.querySelectorAll('details[open]').length, 0);
      assert.equal(initial.document.querySelector('[aria-selected="true"]').dataset.game, ['th06', 'th07', 'th08', 'th10'].includes(game) ? game : 'th07');
      if (name === 'headings') {
        assert.equal(initial.document.querySelector('.multiplayer-rule-panel[data-game="th07"] .multiplayer-rule-disclosure-specific').textContent, '本作特有规则Last duplicate winsReplacement');
        assert.equal(initial.document.querySelector('.multiplayer-rule-panel[data-game="th10"] .multiplayer-rule-disclosure-specific').textContent, '本作特有规则无');
      }
    } finally {initial.close();}
  }
});
