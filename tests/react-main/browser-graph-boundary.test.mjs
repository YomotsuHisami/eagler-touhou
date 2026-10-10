import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build as compile} from 'esbuild';
import {build} from 'vite';

const project = resolve('.');
let directory, authoredSources;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  directory = await mkdtemp(resolve(project, '.cache/browser-graph-boundary-'));
  const source = resolve(project, 'scripts/ui-rewrite/authored-sources.ts');
  const outfile = resolve(directory, 'plugin.mjs');
  await compile({entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    define: {'import.meta.url': JSON.stringify(pathToFileURL(source).href)}, logLevel: 'silent'});
  ({authoredSources} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (directory) await rm(directory, {recursive: true, force: true});});

function inspect(ids, consumer = 'client') {
  const plugin = authoredSources();
  plugin.generateBundle.call({environment: {config: {consumer}}, error(message) {throw new Error(message);}}, {}, {
    'entry.js': {type: 'chunk', modules: Object.fromEntries(ids.map(id => [id, {}]))},
  });
}
for (const suffix of ['tests/support/original-content-fixture.tsx', 'tests/react-main/fixture.ts?worker']) {
  test(`production graph rejects repository test source: ${suffix}`, () => {
    assert.throws(() => inspect([resolve(project, suffix)]), /Test fixture entered/);
    assert.throws(() => inspect([resolve(project, suffix).replaceAll('/', '\\')]), /Test fixture entered/);
  });
}
test('production modules and unrelated dependency test-named directories remain allowed', () => {
  inspect([resolve(project, 'app/BrowserLauncher.tsx'), resolve(project, 'src/launcher/game-library.mts'),
    resolve(project, 'node_modules/example/tests/runtime.js'), resolve(project, 'tests-helper.js')]);
});
test('server graph and existing browser boundary policies remain distinct', () => {
  inspect([resolve(project, 'tests/support/fixture.tsx')], 'server');
  assert.throws(() => inspect([resolve(project, 'src/launcher/app.mts')]), /Legacy DOM\/history owner/);
  assert.throws(() => inspect(['node:fs']), /Node-only code/);
});
test('actual Vite client bundling fails when a live fixture enters the graph', async () => {
  const fixture = resolve(project, 'tests/support/boundary-probe.ts');
  await assert.rejects(() => build({configFile: false, root: project, logLevel: 'silent', publicDir: false,
    plugins: [{name: 'boundary-probe', resolveId(id) {if (id === 'boundary-entry') return fixture;},
      load(id) {if (id === fixture) return 'globalThis.__boundaryProbe = true;';}}, authoredSources()],
    build: {write: false, minify: false, rollupOptions: {input: 'boundary-entry'}}}), /Test fixture entered/);
});
