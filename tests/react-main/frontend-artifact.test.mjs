/** Publication source/artifact contracts only. No server, browser or deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {STATIC_FRONTEND_PACKAGE_FILES, STATIC_APP_SHELL_FILES} from '../../lib/frontend-static-manifest.mjs';
import {frontendSelection, readReactFrontendArtifact, reactFrontendArtifactDirectory} from '../../lib/react-frontend-artifact.mjs';

async function fixture(run, {appShell = null, mountPath = '/review/'} = {}) {
  const work = await mkdtemp(resolve(tmpdir(), 'react-publication-'));
  const directory = resolve(work, 'client');
  async function put(path, text) {await mkdir(dirname(resolve(directory, path)), {recursive: true}); await writeFile(resolve(directory, path), text);}
  const manifest = {
    entry: {file: 'assets/entry-abcd.js', isEntry: true, dynamicImports: ['lazy'], css: ['assets/entry-abcd.css']},
    lazy: {file: 'assets/lazy-abcd.js', isDynamicEntry: true},
  };
  const generated = ['assets/entry-abcd.js', 'assets/entry-abcd.css', 'assets/lazy-abcd.js', 'assets/manifest-abcd.js'];
  const graph = {schema: 'eagler-touhou/react-app-shell-graph/1', mountPath, appShell,
    shellFiles: [...STATIC_APP_SHELL_FILES.filter(path => !['lobby.css', 'touch-guide.css'].includes(path)), ...generated].sort()};
  const metadata = {manifest, graph};
  try {
    for (const path of [...STATIC_FRONTEND_PACKAGE_FILES, ...generated]) await put(path, 'fixture');
    for (const path of STATIC_FRONTEND_PACKAGE_FILES.filter(path => path.startsWith('legacy/'))) await put(path, "export {value} from './chunks/shared.mjs';\n");
    await put('legacy/chunks/shared.mjs', 'export const value = 1;\n');
    const declaration = appShell ? `<meta name="eagler-react-app-shell" content="${JSON.stringify(appShell).replaceAll('"', '&quot;')}">` : '';
    const html = `<!doctype html><html><head>${declaration}<link rel="modulepreload" href="${mountPath}assets/manifest-abcd.js"><script type="module" src="${mountPath}assets/entry-abcd.js"></script><link rel="stylesheet" href="${mountPath}assets/entry-abcd.css"></head><body></body></html>`;
    for (const path of ['index.html', 'en.html', 'lobby.html']) await put(path, html);
    await put('.vite/manifest.json', JSON.stringify(manifest));
    await put('.vite/react-app-shell-graph.json', JSON.stringify(graph));
    await run({work, directory, metadata, put, html});
  } finally {await rm(work, {recursive: true, force: true});}
}

test('frontend selection is explicit and never coerces invalid values to main', () => {
  assert.equal(frontendSelection({}), 'main');
  assert.equal(frontendSelection({EAGLER_FRONTEND: 'main'}), 'main');
  assert.equal(frontendSelection({EAGLER_FRONTEND: 'react'}), 'react');
  for (const value of ['', 'React', 'legacy', 'react ', 'auto']) assert.throws(() => frontendSelection({EAGLER_FRONTEND: value}), /EAGLER_FRONTEND/);
});

test('artifact directory follows the maintainer source versus packaged prebuilt boundary', async () => {
  await fixture(async ({work}) => {
    const project = resolve(work, 'operator'); await mkdir(resolve(project, 'src'), {recursive: true});
    await writeFile(resolve(project, 'src/app-shell-sw.js'), '// classic worker');
    assert.equal(reactFrontendArtifactDirectory({project, environment: {}}), project);
    await writeFile(resolve(project, 'src/contract.mts'), 'export const version = 1;');
    assert.equal(reactFrontendArtifactDirectory({project, environment: {}}), resolve(project, '.cache/build/ui-rewrite/client'));
    assert.equal(reactFrontendArtifactDirectory({project, environment: {EAGLER_REACT_BUILD_DIRECTORY: 'candidate'}}), resolve(project, 'candidate/client'));
  });
});

test('publication derives complete static, Vite and compatibility closures separately from precache', async () => {
  await fixture(async ({directory, put}) => {
    await put('private.txt', 'unowned artifact file'); await put('app.js', 'retired controller must never be selected');
    const artifact = await readReactFrontendArtifact({directory});
    assert.equal(artifact.kind, 'react'); assert.equal(artifact.appShell, null);
    for (const path of [...STATIC_FRONTEND_PACKAGE_FILES, 'legacy/chunks/shared.mjs', 'assets/lazy-abcd.js', 'assets/manifest-abcd.js']) assert.ok(artifact.packageFiles.includes(path), path);
    for (const path of ['migrate.html', 'legacy/chunks/shared.mjs', 'lobby.css', 'touch-guide.css']) assert.equal(artifact.shellFiles.includes(path), false, path);
    assert.equal(artifact.packageFiles.includes('app.js'), false);
    assert.equal(artifact.packageFiles.some(path => path.startsWith('.vite/')), false);
    assert.equal(artifact.resolveSource('legacy/chunks/shared.mjs'), resolve(directory, 'legacy/chunks/shared.mjs'));
    for (const path of ['private.txt', 'app.js', '.vite/manifest.json', '../client/index.html']) assert.throws(() => artifact.resolveSource(path), /unknown React/);
    assert.ok(Object.isFrozen(artifact.metadata.graph.shellFiles));
    // The deployment verifier can consume identical embedded values without
    // publishing the private build metadata directory.
    await rm(resolve(directory, '.vite'), {recursive: true});
    const packaged = await readReactFrontendArtifact({directory, metadata: artifact.metadata});
    assert.deepEqual(packaged.packageFiles, artifact.packageFiles);
    await assert.rejects(readReactFrontendArtifact({directory}), /run npm run build:ui-rewrite/);
  });
});

test('missing output, malformed dependency graphs and foreign source paths fail closed', async () => {
  await fixture(async ({directory, metadata}) => {
    await assert.rejects(readReactFrontendArtifact({directory: resolve(directory, 'absent')}), /run npm run build:ui-rewrite/);
    await assert.rejects(readReactFrontendArtifact({directory, expectedMountPath: '/other/'}), /selected mount/);
    const bad = mutate => {const copy = structuredClone(metadata); mutate(copy); return readReactFrontendArtifact({directory, metadata: copy});};
    await assert.rejects(bad(value => value.manifest.entry.imports = ['absent']), /Missing Vite module dependency/);
    await assert.rejects(bad(value => value.manifest.entry.assets = '../outside'), /Invalid Vite manifest/);
    for (const path of ['../outside.js', '/assets/out.js', 'assets/../outside.js', 'assets/contracts/old.js', 'app.js']) await assert.rejects(bad(value => value.manifest.entry.file = path), /Invalid React publication|Forbidden React generated/);
    await assert.rejects(bad(value => value.graph.shellFiles.push('private.txt')), /publication ownership/);
    await assert.rejects(bad(value => value.graph.shellFiles.pop()), /publication ownership/);
    await assert.rejects(bad(value => delete value.graph.appShell), /Invalid React frontend artifact metadata/);
    await rm(resolve(directory, 'assets/lazy-abcd.js'));
    await assert.rejects(readReactFrontendArtifact({directory}), /ENOENT/);
  });
});

test('bounded compatibility closure rejects external modules and symlink escapes', async () => {
  await fixture(async ({work, directory, put}) => {
    await put('legacy/legacy-game-pack.mjs', "export * from 'node:fs';");
    await assert.rejects(readReactFrontendArtifact({directory}), /local relative imports/);
    await put('legacy/legacy-game-pack.mjs', "export * from '../private.mjs';"); await put('private.mjs', 'export const secret = 1;');
    await assert.rejects(readReactFrontendArtifact({directory}), /bounded legacy publication/);
    await put('legacy/legacy-game-pack.mjs', "export * from './chunks/shared.mjs';");
    await mkdir(resolve(work, 'outside-chunks'));
    await writeFile(resolve(work, 'outside-chunks/shared.mjs'), 'export const value = 1;');
    await rm(resolve(directory, 'legacy/chunks'), {recursive: true});
    await symlink(resolve(work, 'outside-chunks'), resolve(directory, 'legacy/chunks'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(readReactFrontendArtifact({directory}), /escapes artifact root/);
  });
});

test('generated JavaScript imports must agree with the official Vite publication graph', async () => {
  await fixture(async ({directory, put}) => {
    await put('assets/entry-abcd.js', "export * from './unlisted.js';");
    await put('assets/unlisted.js', 'export const value = 1;');
    await assert.rejects(readReactFrontendArtifact({directory}), /absent from the Vite publication graph/);
    await put('assets/entry-abcd.js', "import 'unpublished-package';");
    await assert.rejects(readReactFrontendArtifact({directory}), /local relative imports/);
  });
});

test('comments and script text cannot masquerade as active document entrypoints or configuration', async () => {
  await fixture(async ({directory, put, html}) => {
    await put('index.html', `<!doctype html><html><head><!-- ${html} --></head><body></body></html>`);
    await assert.rejects(readReactFrontendArtifact({directory}), /no browser entrypoint/);
    await put('index.html', `<!doctype html><html><head><script type="application/json">${html.replaceAll('</script>', '<\\/script>')}</script></head><body></body></html>`);
    await assert.rejects(readReactFrontendArtifact({directory}), /no browser entrypoint/);
  });
  const appShell = {schema: 'eagler-touhou/react-app-shell/1', origin: 'https://isolated.invalid', mountPath: '/review/'};
  await fixture(async ({directory, put, html}) => {
    await put('index.html', html.replace(/(<meta[^>]+>)/, '<!-- $1 -->'));
    await assert.rejects(readReactFrontendArtifact({directory}), /metadata mismatch/);
  }, {appShell});
});

test('artifact and document share the unchanged isolated origin/mount policy', async () => {
  const appShell = {schema: 'eagler-touhou/react-app-shell/1', origin: 'https://isolated.invalid', mountPath: '/review/'};
  await fixture(async ({directory, metadata, put, html}) => {
    assert.deepEqual((await readReactFrontendArtifact({directory})).appShell, appShell);
    const copy = structuredClone(metadata); copy.graph.appShell.mountPath = '/';
    await assert.rejects(readReactFrontendArtifact({directory, metadata: copy}), /isolated non-root/);
    copy.graph.appShell = {...appShell, origin: 'http://isolated.invalid'};
    await assert.rejects(readReactFrontendArtifact({directory, metadata: copy}), /secure deployment origin/);
    await put('en.html', html.replace('isolated.invalid', 'different.invalid'));
    await assert.rejects(readReactFrontendArtifact({directory}), /metadata mismatch/);
    await put('en.html', html.replace('/review/assets/entry-abcd.js', '/assets/entry-abcd.js'));
    await assert.rejects(readReactFrontendArtifact({directory}), /escapes its graph\/mount/);
  }, {appShell});
});

test('packaged artifact reader uses operator parsers without compiler or React dependencies', async () => {
  await fixture(async ({work, directory}) => {
    const operator = resolve(work, 'operator');
    for (const file of ['react-frontend-artifact.mjs', 'browser-module-graph.mjs', 'frontend-static-manifest.mjs', 'react-app-shell-deployment.mjs']) {
      await mkdir(resolve(operator, 'lib'), {recursive: true}); await cp(resolve('lib', file), resolve(operator, 'lib', file));
    }
    await mkdir(resolve(operator, 'node_modules'), {recursive: true});
    for (const dependency of ['acorn', 'parse5', 'entities']) await cp(resolve('node_modules', dependency), resolve(operator, 'node_modules', dependency), {recursive: true});
    const script = `import {readReactFrontendArtifact} from ${JSON.stringify(pathToFileURL(resolve(operator, 'lib/react-frontend-artifact.mjs')).href)}; const artifact = await readReactFrontendArtifact({directory:${JSON.stringify(directory)}}); if (artifact.packageFiles.includes('app.js')) throw new Error('legacy fallback'); console.log(artifact.kind);`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: operator, encoding: 'utf8'}).trim(), 'react');
  });
});

test('operator selector loads before any npm dependencies are installed', async () => {
  await fixture(async ({work}) => {
    const operator = resolve(work, 'before-install'); await mkdir(resolve(operator, 'lib'), {recursive: true});
    for (const file of ['react-frontend-artifact.mjs', 'frontend-static-manifest.mjs', 'react-app-shell-deployment.mjs']) await cp(resolve('lib', file), resolve(operator, 'lib', file));
    const script = `import {frontendSelection, reactFrontendArtifactDirectory} from './lib/react-frontend-artifact.mjs'; console.log(JSON.stringify({selection:frontendSelection({}), root:reactFrontendArtifactDirectory({project:process.cwd(),environment:{}})}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: operator, encoding: 'utf8'}));
    assert.deepEqual(result, {selection: 'main', root: operator});
  });
});
