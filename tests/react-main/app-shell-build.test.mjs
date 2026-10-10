/** Real build output contracts only. These tests never start a browser/server. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'parse5';
import {buildReactAppShell} from '../../scripts/ui-rewrite/app-shell-build.ts';
import {STATIC_FRONTEND_PACKAGE_FILES} from '../../lib/frontend-static-manifest.mjs';
import {readReactAppShellDeployment} from '../../app/services/app-shell-deployment.ts';
let work, coldSource;
const outputs = new Map();
const origin = 'http://127.0.0.1:43219';
const configuration = mountPath => ({schema: 'eagler-touhou/react-app-shell/1', origin, mountPath});
const exists = path => stat(path).then(() => true, error => {if (error.code === 'ENOENT') return false; throw error;});
before(async () => {
  await mkdir(resolve('.cache'), {recursive: true});
  work = await mkdtemp(resolve('.cache/react-pwa-contract-'));
  coldSource = resolve(work, 'source'); await mkdir(coldSource);
  // Exercise the supported build from authored inputs, never a warm ignored
  // launcher cache. Keep dependency installation shared; copy no build output.
  for (const path of ['app', 'src', 'lib', 'legacy', 'package', 'public', 'config', 'scripts', 'host', 'server', 'integrations',
    'content', 'docs/FAQ.md', 'docs/SELF_HOSTING.md', 'docs/SELF_HOSTING_REFERENCE.md', 'docs/EXTERNAL_RESOURCE_MODE.md',
    'NOTICE.txt', 'README.md', 'ASSETS.md', 'THIRD_PARTY.md', 'package.json', 'package-lock.json', 'tsconfig.launcher.json', 'tsconfig.contracts.json',
    'tsconfig.ui-rewrite.json', 'tsconfig.ui-rewrite.tools.json', 'vite.config.ts', 'react-router.config.ts']) {
    await cp(resolve(path), resolve(coldSource, path), {recursive: true});
  }
  // Change only authored Markdown. Pre-generated HTML deliberately remains
  // stale so the real build must use main's content compiler, not copy it.
  for (const file of ['docs/FAQ.md', 'content/FIRST_USE_NOTICE.md', 'content/MULTIPLAYER.md']) {
    const path = resolve(coldSource, file);
    await writeFile(path, await readFile(path, 'utf8') + '\n\nReact build authored-content freshness probe\n');
  }
  await symlink(resolve('node_modules'), resolve(coldSource, 'node_modules'), 'dir');
  assert.equal(await exists(resolve(coldSource, '.cache/build/browser')), false);
  assert.equal(await exists(resolve(coldSource, 'assets/contracts')), false);
  for (const [name, mountPath, enabled] of [['default', '/', false], ['root', '/', true], ['nested', '/nested/', true]]) {
    const output = resolve(work, name);
    const env = {...process.env, EAGLER_REACT_BUILD_DIRECTORY: output, EAGLER_REACT_MOUNT_PATH: mountPath,
      EAGLER_REACT_APP_SHELL: enabled ? 'isolated' : '', EAGLER_REACT_APP_SHELL_ORIGIN: enabled ? origin : ''};
    try {execFileSync(process.execPath, ['node_modules/@react-router/dev/bin.cjs', 'build'], {cwd: coldSource, env, encoding: 'utf8', stdio: 'pipe', timeout: 120000});}
    catch (error) {throw new Error(`React ${name} build failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, {cause: error});}
    outputs.set(name, {directory: resolve(output, 'client'), mountPath, enabled});
    assert.equal(await exists(resolve(coldSource, '.cache/build/browser')), false, `${name}: must not build the legacy Launcher`);
    assert.equal(await exists(resolve(coldSource, '.cache/build/optimized')), false, `${name}: must not optimize the legacy Launcher`);
    assert.equal(await exists(resolve(coldSource, 'assets/contracts')), false, `${name}: must not copy compiled contracts`);
  }
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
function nodes(html) {
  const result = []; const visit = node => {if (node.tagName) result.push(node); for (const child of node.childNodes ?? []) visit(child);};
  visit(parse(html)); return result;
}
test('default actual build publishes neither App Shell metadata nor worker', async () => {
  const {directory} = outputs.get('default');
  assert.equal(await exists(resolve(directory, 'app-shell-sw.js')), false);
  for (const file of ['index.html', 'en.html', 'lobby.html']) assert.doesNotMatch(await readFile(resolve(directory, file), 'utf8'), /name="eagler-react-app-shell"/);
});
for (const name of ['root', 'nested']) test(`${name} output uses actual React chunks, exact mount, canonical worker and byte identities`, async () => {
  const {directory, mountPath} = outputs.get(name), appShell = configuration(mountPath);
  const result = await buildReactAppShell({clientDirectory: directory, mountPath, appShell});
  assert.ok(result); assert.equal(result.warnings.length, 0);
  const files = result.contract.entries;
  assert.ok(files.includes('./')); assert.ok(files.includes('about.html')); assert.ok(files.includes('faq.html')); assert.ok(files.includes('styles.css'));
  assert.equal(await exists(resolve(directory, 'migrate.html')), true); assert.equal(files.includes('migrate.html'), false);
  assert.equal(files.some(path => path.startsWith('legacy/')), false);
  assert.ok(files.some(path => /^assets\/manifest-.+\.js$/.test(path)));
  assert.ok(files.some(path => /^assets\/root-.+\.js$/.test(path)));
  assert.ok(files.some(path => /^assets\/root-.+\.css$/.test(path)));
  for (const path of files) assert.doesNotMatch(path, /^(?:app\.js$|assets\/(?:launcher|contracts)\/|runtime\/|runtime-manifest\.json$|docs\/|tests\/|src\/|app\/|\.cache\/)/);
  for (const entry of result.manifestEntries) {
    assert.match(entry.revision, /^[a-f0-9]{64}$/);
    const bytes = await readFile(resolve(directory, entry.url === './' ? 'index.html' : entry.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.revision, entry.url);
  }
  for (const path of ['index.html', 'en.html', 'lobby.html']) {
    const html = await readFile(resolve(directory, path), 'utf8'), elements = nodes(html);
    assert.equal((await stat(resolve(directory, path))).isFile(), true, 'original flat document URL');
    assert.equal(elements.find(node => node.tagName === 'html').attrs.find(attr => attr.name === 'lang').value, path === 'en.html' ? 'en' : 'zh-CN');
    assert.match(html, path === 'en.html' ? /<title[^>]*>Touhou Project Original STGs ~ EAGLER TOUHOU<\/title>/ : path === 'lobby.html' ? /<title>联机大厅 ~ EAGLER TOUHOU<\/title>/ : /<title[^>]*>东方Project 原作 STG ~ EAGLER TOUHOU<\/title>/);
    assert.ok(html.includes(`"basename":${JSON.stringify(mountPath)}`));
    const metadata = elements.filter(node => node.tagName === 'meta' && node.attrs.some(attr => attr.name === 'name' && attr.value === 'eagler-react-app-shell'));
    const doc = {querySelectorAll: () => metadata.map(node => ({getAttribute: name => node.attrs.find(attr => attr.name === name)?.value}))};
    assert.deepEqual(readReactAppShellDeployment(doc, {href: origin + mountPath + path}), {workerUrl: origin + mountPath + 'app-shell-sw.js', scope: origin + mountPath});
    assert.equal(readReactAppShellDeployment(doc, {href: 'https://production.invalid' + mountPath + path}), undefined);
    for (const node of elements) for (const attr of node.attrs) if (['src', 'href'].includes(attr.name) && attr.value.startsWith('/') && attr.value.includes('/assets/')) {
      assert.ok(attr.value.startsWith(mountPath + 'assets/'), attr.value);
      assert.ok(files.includes(attr.value.slice(mountPath.length)), attr.value);
    }
  }
  const worker = await readFile(resolve(directory, 'app-shell-sw.js'), 'utf8');
  assert.ok(worker.includes(`encodeURIComponent(scopeUrl.pathname)`));
  assert.ok(worker.includes('App Shell integrity mismatch'));
  assert.ok(worker.includes('createRuntimeCache('));
  assert.doesNotMatch(worker, /self\.clients\.claim\s*\(/);
});
test('mismatched graph mount, forbidden additions and missing graph inputs fail closed', async () => {
  const {directory, mountPath} = outputs.get('nested'), appShell = configuration(mountPath);
  await assert.rejects(buildReactAppShell({clientDirectory: directory, mountPath: '/', appShell}), /does not match this mount/);
  for (const file of ['migrate.html', 'legacy/legacy-game-pack.mjs', 'runtime/unused.js', 'docs/private.md', '.cache/private.md', '../private.md']) await assert.rejects(buildReactAppShell({clientDirectory: directory, mountPath, appShell, additionalShellFiles: [file]}), /Forbidden/);
  const graphPath = resolve(directory, '.vite/react-app-shell-graph.json'), original = await readFile(graphPath, 'utf8'), graph = JSON.parse(original);
  try {
    graph.shellFiles.push('assets/absent-real-chunk.js'); await writeFile(graphPath, JSON.stringify(graph));
    await assert.rejects(buildReactAppShell({clientDirectory: directory, mountPath, appShell}), /ENOENT/);
  } finally {await writeFile(graphPath, original);}
});

test('actual build keeps canonical public URLs including bounded legacy readers', async () => {
  for (const {directory} of outputs.values()) {
    for (const file of STATIC_FRONTEND_PACKAGE_FILES) assert.equal(await exists(resolve(directory, file)), true, file);
    for (const file of ['README.md', 'ASSETS.md', 'THIRD_PARTY.md', 'NOTICE.txt']) {
      assert.deepEqual(await readFile(resolve(directory, file)), await readFile(resolve(file)));
    }
    for (const file of ['faq.html', 'content/FIRST_USE_NOTICE.html', 'content/MULTIPLAYER.html']) {
      assert.match(await readFile(resolve(directory, file), 'utf8'), /React build authored-content freshness probe/);
    }
    const touch = await readFile(resolve(directory, 'touch-guide.css'));
    assert.equal(createHash('sha256').update(touch).digest('hex'), 'c205a923d1ad5b439fbd5d8dc0237766bfdcc528c321aae4bd840ce8f8e90407');
    for (const file of STATIC_FRONTEND_PACKAGE_FILES.filter(file => file.startsWith('legacy/'))) {
      const source = await readFile(resolve(directory, file), 'utf8');
      assert.doesNotMatch(source, /node:|__vite-browser-external/);
      // Loading every published entry in Node catches unresolved browser ESM
      // imports; this is a module-closure check, never a browser-run claim.
      await import(pathToFileURL(resolve(directory, file)).href);
    }
  }
});

test('original legacy compatibility assertions pass unchanged against published modules', async () => {
  const original = await readFile(resolve('tests/test-legacy-game-pack.mjs'), 'utf8');
  for (const [name, {directory}] of outputs) {
    let replacements = 0;
    const adapted = original.replace(/"\.\.\/(legacy\/[^"\n]+\.mjs)"/g, (_match, file) => {
      replacements++; return JSON.stringify(pathToFileURL(resolve(directory, file)).href);
    });
    assert.equal(replacements, 3, 'only the three subject imports are adapted');
    const fixture = resolve(work, `original-legacy-${name}.mjs`);
    await writeFile(fixture, adapted);
    execFileSync(process.execPath, [fixture], {cwd: resolve('.'), encoding: 'utf8', stdio: 'pipe', timeout: 30000});
  }
});

test('selected self-host bundle consumes prebuilt React and private graph inputs without a compiler', async () => {
  const {directory} = outputs.get('default');
  const sourceEnvironment = {...process.env, EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: resolve(directory, '..'), EAGLER_REACT_MOUNT_PATH: '/'};
  const rules = JSON.parse(execFileSync(process.execPath, ['scripts/list-self-host-bundle-files.mjs'], {cwd: coldSource, env: sourceEnvironment, encoding: 'utf8', timeout: 60000}));
  assert.deepEqual(rules.filter(rule => rule.target.startsWith('.vite/')).map(rule => rule.target).sort(), ['.vite/manifest.json', '.vite/react-app-shell-graph.json']);
  assert.equal(rules.some(rule => rule.target === 'app.js' || rule.target.startsWith('assets/launcher/')), false);
  assert.equal(rules.some(rule => /\.mts$/.test(rule.target)), false);
  assert.equal(await exists(resolve(coldSource, '.cache/build/browser')), false);
  assert.equal(await exists(resolve(coldSource, '.cache/build/optimized')), false);
  const operator = await mkdtemp(resolve(tmpdir(), 'react-self-host-prebuilt-'));
  try {
    for (const rule of rules) {
      await mkdir(resolve(operator, rule.target, '..'), {recursive: true});
      await cp(resolve(coldSource, rule.source), resolve(operator, rule.target));
    }
    // These are declared operator parsers and their locked transitive decoder,
    // not the maintainer's TS/React Router/esbuild dependency environment.
    for (const dependency of ['acorn', 'parse5', 'entities']) await cp(resolve('node_modules', dependency), resolve(operator, 'node_modules', dependency), {recursive: true});
    const environment = {...process.env, EAGLER_FRONTEND: 'react'};
    delete environment.EAGLER_REACT_BUILD_DIRECTORY; delete environment.EAGLER_REACT_MOUNT_PATH;
    const script = `import {FRONTEND_SELECTION, FRONTEND_PACKAGE_FILES, REACT_FRONTEND_ARTIFACT} from './lib/frontend-manifest.mjs';
      import {ensureContractsBuild} from './lib/contracts-build.mjs';
      const contracts = await ensureContractsBuild();
      console.log(JSON.stringify({selection: FRONTEND_SELECTION, frontend: REACT_FRONTEND_ARTIFACT.kind, mode: contracts.mode,
        legacy: FRONTEND_PACKAGE_FILES.includes('app.js'), metadataPublic: FRONTEND_PACKAGE_FILES.some(path => path.startsWith('.vite/'))}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: operator, env: environment, encoding: 'utf8', timeout: 30000}));
    assert.deepEqual(result, {selection: 'react', frontend: 'react', mode: 'prebuilt', legacy: false, metadataPublic: false});
    assert.equal(await exists(resolve(operator, 'node_modules/typescript')), false);
    assert.equal(await exists(resolve(operator, '.cache')), false);
  } finally {await rm(operator, {recursive: true, force: true});}
});

// Same actual CLI used by maintainers; no browser or worker registration.
test('standalone App Shell command respects selected React permission and graph', async () => {
  const output = resolve(work, 'standalone-worker.js');
  await writeFile(output, 'unchanged-output');
  const command = ['scripts/build-app-shell.mjs', `--output=${output}`];
  const environment = name => ({...process.env, EAGLER_FRONTEND: 'react',
    EAGLER_REACT_BUILD_DIRECTORY: resolve(outputs.get(name).directory, '..'),
    EAGLER_REACT_MOUNT_PATH: outputs.get(name).mountPath});
  assert.throws(() => execFileSync(process.execPath, command, {cwd: coldSource, env: environment('default'), stdio: 'pipe'}), /disabled/);
  assert.equal(await readFile(output, 'utf8'), 'unchanged-output');
  execFileSync(process.execPath, command, {cwd: coldSource, env: environment('nested'), stdio: 'pipe'});
  const worker = await readFile(output, 'utf8');
  assert.match(worker, /App Shell integrity mismatch/);
  assert.match(worker, /assets\/root-/);
  assert.doesNotMatch(worker, /assets\/launcher\/app\.mjs/);
  assert.equal(await exists(resolve(coldSource, '.cache/build/browser')), false);
});
