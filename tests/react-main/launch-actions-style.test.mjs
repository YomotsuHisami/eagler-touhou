/** Resolved authored-rule contract, not rendered browser or device evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import postcss from 'postcss';
import {JSDOM} from 'jsdom';
const read = path => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const legacyCss = read('public/styles.css'), sharedCss = read('app/components/launcher/shared-options.css');
const dom = new JSDOM('<!doctype html><body></body>');
// Specificity for the actual class/ID/type selectors, including nested selector
// lists. Pseudo-elements are excluded from this element-only proof.
function specificity(selector) {
  let value = selector, functional = 0;
  while (true) {
    const match = /:(is|not|has|where)\(/.exec(value); if (!match) break;
    const start = match.index, content = start + match[0].length;
    let end = content, depth = 1;
    while (depth && end < value.length) {if (value[end] === '(') depth++; if (value[end] === ')') depth--; end++;}
    assert.equal(depth, 0);
    if (match[1] !== 'where') functional += Math.max(...postcss.list.comma(value.slice(content, end - 1)).map(specificity));
    value = value.slice(0, start) + value.slice(end);
  }
  assert.doesNotMatch(value, /:[\w-]+\(/, 'unsupported functional selector');
  const ids = (value.match(/#[\w-]+/g) || []).length;
  const classes = (value.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const types = (value.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, '').match(/[a-z][\w-]*/gi) || []).length;
  return functional + ids * 10000 + classes * 100 + types;
}
function rules(css) {
  const result = [];
  postcss.parse(css).walkRules(rule => {
    for (const selector of rule.selectors) {
      if (!/\.(?:launch(?:\b|-)|mp-replay-launch-wrap)/.test(selector) || /::|:before|:after/.test(selector)) continue;
      const media = []; for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {if (parent.name !== 'media') return; media.push(parent.params);}
      result.push({selector, media, weight: specificity(selector), declarations: rule.nodes.filter(node => node.type === 'decl')});
    }
  });
  return result;
}
function mediaMatches(query, mode) {
  return postcss.list.comma(query).some(branch => branch.split(/\s+and\s+/).every(part => {
    const match = /^\((max-width|min-width|hover|pointer|prefers-reduced-motion):\s*([^)]*)\)$/.exec(part.trim());
    assert.ok(match, part); const [, feature, value] = match;
    if (feature === 'max-width') return mode.width <= parseInt(value);
    if (feature === 'min-width') return mode.width >= parseInt(value);
    return feature === 'prefers-reduced-motion' ? mode.reduce === (value === 'reduce') : mode[feature] === value;
  }));
}
const properties = new Set(['width','height','fill','stroke','order','margin','padding','padding-inline','font-size','gap','transition','transform']);
function resolved(source, node, mode, state = '') {
  node.setAttribute('data-probe-state', state);
  const winners = new Map(); let order = 0;
  for (const rule of source) {
    if (!rule.media.every(query => mediaMatches(query, mode)) || !node.matches(rule.selector.replace(/:(hover|active|focus-visible)/g, '[data-probe-state~="$1"]'))) continue;
    for (const declaration of rule.declarations) {
      let prop = declaration.prop, value = declaration.value;
      if (prop === 'font') {prop = 'font-size'; value = value.match(/\b(\d+(?:\.\d+)?px)\//)?.[1]; assert.ok(value, declaration.value);}
      if (!properties.has(prop)) continue;
      const rank = [declaration.important ? 1 : 0, rule.weight, ++order], old = winners.get(prop);
      if (!old || rank[0] > old.rank[0] || rank[0] === old.rank[0] && (rank[1] > old.rank[1] || rank[1] === old.rank[1] && rank[2] > old.rank[2])) winners.set(prop, {value, rank});
    }
  }
  return Object.fromEntries([...winners].map(([key, entry]) => [key, entry.value]).sort(([a],[b]) => a.localeCompare(b)));
}
function fixture({id = 'launch', compact = false, legacy = false, carrier = 'library-layout'} = {}) {
  const root = dom.window.document.createElement('div'); root.className = carrier;
  root.innerHTML = `<aside class="tools"><div class="launch-wrap launch-actions${compact ? legacy ? ' mp-replay-launch-wrap' : ' launch-actions-compact' : ''}"><button class="launch" id="${id}"><span>Play</span><span class="launch-icon"><svg><path/></svg></span></button><button class="launch launch-secondary"><span class="launch-icon"><svg><path/></svg></span><span>Import</span></button></div></aside>`;
  return root;
}
const modes = [
  {width:1200,hover:'hover',pointer:'fine',reduce:false}, {width:600,hover:'none',pointer:'coarse',reduce:false},
  {width:1200,hover:'hover',pointer:'fine',reduce:true}, {width:1200,hover:'hover',pointer:'fine',reduce:false,less:true},
];
const oldRules = rules(legacyCss), newRules = rules(legacyCss + '\n' + sharedCss);

test('semantic standard and compact action pairs resolve to existing launcher/replay presentation and shared motion', () => {
  for (const compact of [false, true]) for (const carrier of ['library-layout', 'mp-settings-room-drawer']) for (const mode of modes) {
    const before = fixture({id: compact ? 'mpReplayViewer' : 'launch', compact, legacy: true, carrier});
    const after = fixture({id: compact ? 'mpReplayViewer' : 'launch', compact, carrier});
    if (mode.less) {before.classList.add('less-motion'); after.classList.add('less-motion');}
    for (const state of ['', 'hover', 'active', 'focus-visible']) for (const target of ['.launch-actions', '.launch:not(.launch-secondary)', '.launch-secondary', '.launch:not(.launch-secondary) .launch-icon', '.launch:not(.launch-secondary) svg']) {
      assert.deepEqual(resolved(newRules, after.querySelector(target), mode, state), resolved(oldRules, before.querySelector(target), mode, state), `${compact}/${carrier}/${JSON.stringify(mode)}/${state}/${target}`);
    }
  }
});

test('third consumer arbitrary IDs inherit full primary icon style and shared motion; one common change reaches every consumer', () => {
  const mode = modes[0], reference = fixture();
  const changed = rules(legacyCss + '\n' + sharedCss.replace('width:22px!important', 'width:26px!important'));
  for (const id of ['launch', 'mpReplayViewer', 'thirdPlay']) {
    const root = fixture({id});
    for (const target of ['.launch:not(.launch-secondary)', '.launch:not(.launch-secondary) .launch-icon', '.launch:not(.launch-secondary) svg']) assert.deepEqual(resolved(newRules, root.querySelector(target), mode), resolved(newRules, reference.querySelector(target), mode));
    assert.equal(resolved(changed, root.querySelector('.launch:not(.launch-secondary) svg'), mode).width, '26px');
  }
  assert.doesNotMatch(read('app/components/room/MultiplayerSettingsControls.tsx'), /mp-replay-launch-wrap/);
  assert.doesNotMatch(read('app/components/launcher/LaunchActions.tsx'), /setTimeout|transition|animation/);
});
