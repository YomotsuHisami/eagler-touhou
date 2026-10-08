/** Synthetic calibration SSR and provider source checks; no browser/runtime claims. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {parse} from '@babel/parser';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-provider-labels-'));
after(() => rm(directory, {recursive: true, force: true}));
const result = await build({stdin: {contents: `
  import {createElement} from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {createMemoryRouter, RouterProvider} from 'react-router';
  import {LocaleProvider} from './app/components/LocaleProvider';
  import {MultiplayerCalibration} from './app/components/MultiplayerCalibration';
  import {setLaunchState} from 'provider-test-launch';
  export {providerUiEntries} from './src/launcher/i18n-provider-ui.mts';
  export {UI_MESSAGES} from './src/launcher/i18n.mts';
  export function render(snapshot, locale = 'en') {
    setLaunchState({controller: {reportText: () => '{"sample":true}'}, snapshot});
    const element = createElement(LocaleProvider, {initialLocale: locale}, createElement(MultiplayerCalibration));
    const router = createMemoryRouter([{path: '*', element}], {initialEntries: ['/?uiLocale=' + locale]});
    try {return renderToStaticMarkup(createElement(RouterProvider, {router}));}
    finally {router.dispose();}
  }
`, resolveDir: root, loader: 'tsx'}, bundle: true, jsx: 'automatic', format: 'esm', platform: 'node',
packages: 'external', write: false, plugins: [{name: 'synthetic-launch-snapshot', setup(builder) {
  builder.onResolve({filter: /^(?:provider-test-launch|\.\/MultiplayerRoomProvider)$/}, args => {
    if (args.path === 'provider-test-launch' || args.importer.split(String.fromCharCode(92)).join('/').endsWith('/MultiplayerCalibration.tsx')) return {path: 'provider-test-launch', namespace: 'fixture'};
  });
  builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: `
    let state; export function setLaunchState(value) {state = value;}
    export function useMultiplayerLaunch() {return state;}
  `, loader: 'js'}));
  builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
    if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
  });
}}]});
const modulePath = join(directory, 'provider-labels.mjs');
await writeFile(modulePath, result.outputFiles[0].text);
const {providerUiEntries, UI_MESSAGES, render} = await import(pathToFileURL(modulePath).href);
const files = ['ResourceManagerProvider', 'GameLaunchProvider', 'MidiProvider', 'SaveProvider',
  'MultiplayerRoomProvider', 'LobbyDirectoryProvider', 'MultiplayerCalibration'];
function walk(node, parents, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parents);
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc'].includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) walk(item, [...parents, node], visit);
    else if (value && typeof value === 'object') walk(value, [...parents, node], visit);
  }
}
test('provider copy exists in both catalogs with matching interpolation parameters', () => {
  const seen = new Set();
  const params = value => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
  for (const [key, zh, en] of providerUiEntries) {
    assert.ok(!seen.has(key), key); seen.add(key);
    assert.equal(UI_MESSAGES['zh-CN'][key], zh, key);
    assert.equal(UI_MESSAGES.en[key], en, key);
    assert.deepEqual(params(zh), params(en), key);
  }
});
test('provider Chinese literals are only unchanged technical thrown errors', async () => {
  const errors = [];
  for (const file of files) {
    const source = await readFile(join(root, `app/components/${file}.tsx`), 'utf8');
    const ast = parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx']});
    assert.doesNotMatch(source, /initUiLocale|applyStaticTranslations|MutationObserver/);
    walk(ast, [], (node, parents) => {
      if (['StringLiteral', 'JSXText'].includes(node.type) && /\p{Script=Han}/u.test(node.value)) {
        assert.ok(parents.some(parent => parent.type === 'ThrowStatement'), `${file}: untranslated ${node.value}`);
        errors.push(node.value);
      }
      if (node.type === 'StringLiteral' && node.value.startsWith('ui.providers.')) {
        assert.ok(Object.hasOwn(UI_MESSAGES.en, node.value), `${file}: missing ${node.value}`);
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'useLocale') {
        const enclosing = [...parents].reverse().find(parent => parent.type === 'FunctionDeclaration');
        assert.ok(enclosing && enclosing.body.body[0].declarations?.[0]?.init === node, `${file}: locale hook must precede all early returns`);
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && ['useEffect', 'useLayoutEffect'].includes(node.callee.name)) {
        assert.doesNotMatch(source.slice(node.start, node.end), /\bt\(|\buseLocale\(|\[.*\bt\b.*\]/, `${file}: locale must not enter service lifecycle effects`);
      }
    });
  }
  assert.deepEqual(errors.sort(), ['Runtime 尚未就绪', '多人 Runtime 依赖尚未就绪', 'MIDI 服务尚未就绪'].sort());
});
test('calibration copy status stores message keys and translates them at render time', async () => {
  const source = await readFile(join(root, 'app/components/MultiplayerCalibration.tsx'), 'utf8');
  const ast = parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx']});
  const branches = [];
  walk(ast, [], node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'setCopyStatus') return;
    const value = node.arguments[0];
    if (value?.type === 'ConditionalExpression') branches.push([value.consequent.value, value.alternate.value]);
  });
  assert.deepEqual(branches, [['ui.providers.calibration.copied', 'ui.providers.calibration.copyFailed']]);
  assert.match(source, /copyText\(controller\.reportText\(\) \?\? ''\)\.then\(copied => setCopyStatus\(copied \?/);
  assert.doesNotMatch(source, /navigator\.clipboard/);
  assert.match(source, /\{t\(copyStatus\)\}/);
  assert.doesNotMatch(source, /setCopyStatus\(t\(/);
});
const snapshot = progress => ({active: {}, calibration: {progress, report: {sample: true}, dismissed: false}});
for (const locale of ['en', 'zh-CN']) {
  test(`${locale} calibration phases and accessible progress labels render translated`, () => {
    for (const phase of ['waiting', 'stabilizing', 'measuring', 'negotiating', 'ready']) {
      const html = render(snapshot({phase, probes: 50, replies: 41}), locale);
      assert.ok(html.includes(UI_MESSAGES[locale][`ui.providers.calibration.${phase}`]), phase);
      assert.ok(html.includes(UI_MESSAGES[locale]['ui.providers.calibration.aria']));
      assert.ok(html.includes(UI_MESSAGES[locale]['ui.providers.calibration.report']));
      assert.doesNotMatch(html, /ui\.providers\.|\{probes\}|\{replies\}/);
      if (phase === 'measuring') {assert.match(html, /50\/129/); assert.match(html, /41\/120/);}
    }
  });
  test(`${locale} calibration timing preserves rollback state and dismiss label`, () => {
    for (const mode of [0, 2]) {
      const html = render(snapshot({phase: 'ready', timing: {inputDelay: 3, adonisMode: mode}}), locale);
      const rollback = UI_MESSAGES[locale][`ui.providers.calibration.${mode === 2 ? 'enabled' : 'disabled'}`];
      const expected = UI_MESSAGES[locale]['ui.providers.calibration.timing'].replace('{frames}', '3').replace('{rollback}', rollback);
      assert.ok(html.includes(expected), expected);
      assert.ok(html.includes(UI_MESSAGES[locale]['ui.providers.dismiss']));
    }
  });
}
test('calibration rendering preserves inactive and dismissed gates', () => {
  assert.equal(render(null), '');
  assert.equal(render({active: null}), '');
  const state = snapshot({phase: 'waiting'});
  state.calibration.dismissed = true;
  assert.doesNotMatch(render(state), /<aside/);
  assert.match(render(state), /Calibration report/);
});
