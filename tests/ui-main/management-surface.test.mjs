/** Source ownership and SSR affordance checks, no browser/native Runtime claim. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(root, '.cache/management-surface-test-')); after(() => rm(folder, {recursive: true, force: true}));
const result = await build({stdin: {contents: `
  export {PreparedRuntimeStartForService} from './app/runtime/PreparedRuntimeStart';
  export {LocaleProvider} from './app/components/LocaleProvider';
  export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';
  export {createMemoryRouter, RouterProvider} from 'react-router';
`, resolveDir: root, loader: 'tsx'}, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', write: false, loader: {'.css': 'empty'}});
const path = join(folder, 'entry.mjs'); await writeFile(path, result.outputFiles[0].text);
const {PreparedRuntimeStartForService, LocaleProvider, createElement: h, renderToStaticMarkup, createMemoryRouter, RouterProvider} = await import(pathToFileURL(path).href);
function render(patch = {}) {
  const live = {phase: 'prepared', game: 'th06', epoch: 7, fileOperationBusy: false, ...patch};
  const service = {getSnapshot: () => live, getMidiEventContext: () => null, launch: async () => {throw Error('SSR must not launch');}};
  const router = createMemoryRouter([{path: '*', element: h(LocaleProvider, {initialLocale: 'en'}, h(PreparedRuntimeStartForService, {service, live, midi: null, audio: null}))}], {initialEntries: ['/play/th06?uiLocale=en']});
  try {return renderToStaticMarkup(h(RouterProvider, {router}));} finally {router.dispose();}
}
test('the original prepared Start stays explicit and file-operation gated', () => {
  assert.match(render(), /Start TH06/); assert.doesNotMatch(render(), /disabled=""/);
  assert.match(render({fileOperationBusy: true}), /disabled=""/);
  assert.equal(render({phase: 'launching'}), ''); assert.equal(render({runtimeVariant: 'multiplayer'}), '');
});
test('presentation destination never creates a Runtime, save writer, extra blocker or Start intent', async () => {
  const portal = await readFile(join(root, 'app/components/ManagementSurface.tsx'), 'utf8'), app = await readFile(join(root, 'app/root.tsx'), 'utf8');
  assert.match(portal, /createPortal\(children\(true\), target\)/);
  assert.doesNotMatch(portal, /\.launch\(|\.close\(|\.cancel\(|useBlocker|createRuntimeService|createGameLaunch/);
  assert.match(app, /<RuntimeProvider><ManagementSurfaceProvider><NavigationDraftProvider>/);
  const library = await readFile(join(root, 'app/routes/library.tsx'), 'utf8'); assert.match(library, /<ManagementSurfaceSlot floating=\{room\}\/>/);
  const controls = await readFile(join(root, 'app/runtime/RuntimeControls.tsx'), 'utf8');
  assert.equal((controls.match(/useBlocker\(shouldBlock\)/g) ?? []).length, 1); assert.match(controls, /toolbarVisible && <ManagementSurfacePortal>/);
  const launch = await readFile(join(root, 'app/components/GameLaunchProvider.tsx'), 'utf8');
  assert.equal((launch.match(/<PreparedRuntimeStart /g) ?? []).length, 1); assert.doesNotMatch(launch, /createPortal/);
});
test('each job notice portals only its existing returned view, retaining its hooks above the destination', async () => {
  for (const name of ['GameLaunchProvider', 'MidiProvider', 'ResourceManagerProvider', 'MultiplayerReplayProvider']) {
    const source = await readFile(join(root, `app/components/${name}.tsx`), 'utf8');
    assert.match(source, /return <ManagementSurfacePortal>\{(?:docked|\(\)) => <aside/, name);
    assert.doesNotMatch(source, /<ManagementSurfacePortal>[^;]*<ResourceJobNotice\/>/, 'resource dismissal state must not move inside a recreated portal subtree');
  }
});
