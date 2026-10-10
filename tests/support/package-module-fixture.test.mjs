/** Canonical module/staging/HTTP setup only. No browser or IndexedDB scenario
 * is executed; the original browser's synthetic package bytes stay original. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {preparePackageModuleFixture, runPackageModuleFixtureServer} from './package-module-fixture.mjs';
import {browserModuleClosure} from '../../lib/browser-module-graph.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const originalPath = 'tests/test-package-update-atomicity-browser.py';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const python = source => JSON.parse(execFileSync('python', ['-c', source], {cwd: project, encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}}));
let work, cold, fixture, coldInitially;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/package-module-setup-')); cold = resolve(work, 'source');
  for (const path of ['src/contracts', 'package', 'lib/contracts-build.mjs', 'lib/launcher-optimization.mjs', 'lib/atomic-file.mjs', 'lib/browser-module-graph.mjs', 'lib/development-server-scope.mjs',
    'tsconfig.launcher.json', 'tsconfig.contracts.json', 'package.json', 'scripts/serve-static.mjs', 'server/static-content-policy.mjs', 'tests/support/package-module-fixture.mjs',
    'public/faq.html', 'public/styles.css', 'public/about.css', 'public/assets/fonts', 'public/assets/launcher-background.webp']) {
    await mkdir(dirname(resolve(cold, path)), {recursive: true}); await cp(resolve(project, path), resolve(cold, path), {recursive: true});
  }
  await symlink(resolve(project, 'node_modules'), resolve(cold, 'node_modules'), 'dir');
  coldInitially = ['.cache/build/contracts', '.cache/build/browser', '.cache/build/optimized', 'src/launcher', 'assets/contracts'].every(path => !existsSync(resolve(cold, path)));
  fixture = await preparePackageModuleFixture({project: cold});
});
after(async () => {await fixture?.dispose(); if (work) await rm(work, {recursive: true, force: true});});

test('explicit selector preserves exact default object/argv, rejects unknown modes and selects only the module staging runner', () => {
  const results = python(`import json,os,sys\nfrom pathlib import Path\nsys.path.insert(0,'tests')\nfrom support.package_module_fixture import package_module_server_command\noriginal=['node','original-server','1234','workspace'];rows=[]\nfor mode in (None,'source','isolated'):\n if mode is None:os.environ.pop('EAGLER_PACKAGE_TEST_FIXTURE',None)\n else:os.environ['EAGLER_PACKAGE_TEST_FIXTURE']=mode\n result=package_module_server_command(Path.cwd(),1234,original);rows.append({'same':result is original,'command':result})\nos.environ['EAGLER_PACKAGE_TEST_FIXTURE']='react'\ntry:package_module_server_command(Path.cwd(),1234,original)\nexcept ValueError:rows.append('rejected')\nprint(json.dumps(rows))`);
  assert.deepEqual(results.slice(0, 2), [{same: true, command: ['node', 'original-server', '1234', 'workspace']}, {same: true, command: ['node', 'original-server', '1234', 'workspace']}]);
  assert.deepEqual(results[2], {same: false, command: ['node', resolve(project, 'tests/support/package-module-fixture.mjs'), '1234']}); assert.equal(results[3], 'rejected');
});

test('original whole file reverses to pinned; all 69 assertions and the full 26,622-character evaluated scenario remain verbatim', async () => {
  const source = await readFile(resolve(project, originalPath), 'utf8');
  const original = execFileSync('git', ['show', `${baseline}:${originalPath}`], {cwd: project, encoding: 'utf8'});
  const restored = source.replace('\nfrom support.package_module_fixture import package_module_server_command\n', '')
    .replace('package_module_server_command(PROJECT, http_port, ["node", str(PROJECT / "scripts" / "serve.mjs"), str(http_port), str(WORKSPACE)])', '["node", str(PROJECT / "scripts" / "serve.mjs"), str(http_port), str(WORKSPACE)]');
  assert.equal(restored, original);
  const result = python(`import ast,json,subprocess\nfrom pathlib import Path\na=subprocess.check_output(['git','show','${baseline}:${originalPath}'],text=True);b=Path('${originalPath}').read_text()\ndef assertions(s):return [ast.get_source_segment(s,n) for n in ast.walk(ast.parse(s)) if isinstance(n,ast.Assert)]\ndef scenarios(s):return [n.args[0].value for n in ast.walk(ast.parse(s)) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='evaluate']\nprint(json.dumps({'assertions':len(assertions(a)),'assertionsEqual':assertions(a)==assertions(b),'scenarios':len(scenarios(a)),'characters':len(scenarios(a)[0]),'scenariosEqual':scenarios(a)==scenarios(b)}))`);
  assert.deepEqual(result, {assertions: 69, assertionsEqual: true, scenarios: 1, characters: 26622, scenariosEqual: true});
  const scenarioStart = '    try:\n        wait_http(url)'; assert.equal(source.slice(source.indexOf(scenarioStart)), original.slice(original.indexOf(scenarioStart)));
});

test('cold isolated source builds current canonical contracts and stages the actual eleven-module closure without a Launcher graph', async t => {
  assert.equal(coldInitially, true); assert.equal(fixture.contracts.mode, 'source'); assert.match(fixture.contracts.inputHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(fixture.modules, ['package/package-descriptor.mjs', 'package/package-generation.mjs', 'package/package-installer.mjs', 'package/package-integrity.mjs', 'package/package-launcher.mjs', 'package/package-mutation-queue.mjs', 'package/package-store.mjs', 'package/package-zip.mjs', 'package/stored-zip.mjs', 'product-catalog.mjs', 'release-catalog.mjs']);
  assert.deepEqual(await browserModuleClosure({root: fixture.root, entries: ['package/package-installer.mjs', 'package/package-launcher.mjs', 'package/package-store.mjs']}), fixture.modules);
  const manifest = JSON.parse(await readFile(resolve(fixture.contracts.root, 'manifest.json'), 'utf8'));
  for (const file of fixture.files) {
    const bytes = await readFile(resolve(fixture.root, file.path)); assert.equal(digest(bytes), file.sha256); assert.deepEqual(bytes, await readFile(file.source));
  }
  for (const name of ['product-catalog.mjs', 'release-catalog.mjs']) {
    const item = fixture.files.find(file => file.path === name); assert.equal(item.source, resolve(fixture.contracts.directory, name));
    assert.equal(item.sha256, manifest.outputs['assets/contracts/' + name]);
  }
  for (const path of ['.cache/build/browser', '.cache/build/optimized', 'src/launcher']) assert.equal(existsSync(resolve(cold, path)), false, path);
  for (const path of ['index.html', 'app.js', 'host-manifest.json', 'release-catalog.json', 'app-shell-sw.js', 'runtime-manifest.json']) assert.equal(existsSync(resolve(fixture.root, path)), false, path);
  const store = await import(pathToFileURL(resolve(fixture.root, 'package/package-store.mjs')).href);
  const installer = await import(pathToFileURL(resolve(fixture.root, 'package/package-installer.mjs')).href);
  assert.equal(store.PACKAGE_STORE_DB, 'eagler-touhou-package-store-v1'); assert.equal(typeof installer.installPackageFromAcquisition, 'function');
  t.diagnostic(JSON.stringify({contractsInputHash: fixture.contracts.inputHash, moduleHashes: Object.fromEntries(fixture.files.filter(file => fixture.modules.includes(file.path)).map(file => [file.path, file.sha256]))}));
});

test('FAQ and its actual local styles/fonts are copied unchanged; absent optional artwork remains absent instead of fabricated', async () => {
  for (const path of ['faq.html', 'styles.css', 'about.css', 'assets/fonts/yatra-one-latin.woff2', 'assets/fonts/chill-round-gothic-site-medium.woff2']) assert.deepEqual(await readFile(resolve(fixture.root, path)), await readFile(resolve(cold, 'public', path)));
  assert.ok(fixture.optionalMissing.includes('assets/th06.ico')); assert.equal(existsSync(resolve(fixture.root, 'assets/th06.ico')), false);
});

test('missing source/modules and corrupted compiled contracts fail closed without using inherited Launcher cache', async () => {
  await assert.rejects(preparePackageModuleFixture({project: resolve(work, 'missing-source')}), /verified canonical source contracts/);
  const missing = resolve(cold, 'package/package-integrity.mjs'), saved = await readFile(missing); await rm(missing);
  try {await assert.rejects(preparePackageModuleFixture({project: cold}), /browser module is missing: package\/package-integrity/);}
  finally {await writeFile(missing, saved);}
  const catalog = resolve(fixture.contracts.directory, 'product-catalog.mjs'), bytes = await readFile(catalog);
  const inherited = resolve(cold, '.cache/build/browser/assets/contracts/product-catalog.mjs'); await mkdir(dirname(inherited), {recursive: true}); await writeFile(inherited, 'export const WRONG_INHERITED_CONTRACT = true;');
  const next = await preparePackageModuleFixture({project: cold});
  try {assert.deepEqual(await readFile(resolve(next.root, 'product-catalog.mjs')), bytes);}
  finally {await next.dispose();}
  await writeFile(catalog, 'export const BROKEN_CANONICAL_CONTRACT = true;');
  try {await assert.rejects(preparePackageModuleFixture({project: cold}), /Contracts-only cache is corrupt/);}
  finally {await writeFile(catalog, bytes);}
});

test('module server rejects non-loopback exposure and invalid ports before staging', async () => {
  await assert.rejects(runPackageModuleFixtureServer(1234, {project: cold, environment: {EAGLER_TOUHOU_HOST: '0.0.0.0'}}), /non-loopback/);
  await assert.rejects(runPackageModuleFixtureServer(0, {project: cold}), /port must be/);
});

async function freePort() {
  const server = createServer(); await new Promise((yes, no) => {server.once('error', no); server.listen(0, '127.0.0.1', yes);});
  const port = server.address().port; await new Promise(yes => server.close(yes)); return port;
}

test('CLI serves original module URLs with canonical HTTP headers, no Host/worker fallback, and cleans its owned temp root on termination', {timeout: 30000}, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [resolve(cold, 'tests/support/package-module-fixture.mjs'), String(port)], {cwd: cold,
    env: {...process.env, EAGLER_PACKAGE_TEST_FIXTURE: 'isolated', EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: '/nonexistent-ui-is-not-this-module-subject', EAGLER_TOUHOU_HOST: '127.0.0.1', EAGLER_LAUNCHER_FIXTURE_INPUTS: '/never-consumed-host.json'}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '', selectedRoot;
  child.stdout.on('data', data => {output += data;}); child.stderr.on('data', data => {output += data;});
  const exited = new Promise(yes => child.once('exit', (code, signal) => yes({code, signal})));
  try {
    await new Promise((yes, no) => {
      const timer = setTimeout(() => finish(new Error('Module fixture did not listen: ' + output)), 20000);
      const ready = () => {if (output.includes(`Eagler Touhou host: http://127.0.0.1:${port}/`)) finish();};
      const failed = () => finish(new Error('Module fixture exited: ' + output));
      const finish = error => {clearTimeout(timer); child.stdout.off('data', ready); child.off('exit', failed); child.off('error', finish); error ? no(error) : yes();};
      child.stdout.on('data', ready); child.once('exit', failed); child.once('error', finish);
    });
    selectedRoot = JSON.parse(output.split('\n').find(line => line.startsWith('{"packageModuleFixture":'))).packageModuleFixture;
    assert.equal(existsSync(selectedRoot), true);
    const base = `http://127.0.0.1:${port}`;
    for (const path of ['faq.html', ...fixture.modules]) {
      const response = await fetch(base + '/' + path); assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-type'), path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate'); assert.ok(response.headers.get('etag')); assert.ok(response.headers.get('last-modified')); assert.equal(response.headers.get('vary'), 'Accept-Encoding');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve(selectedRoot, path)));
      const head = await fetch(base + '/' + path, {method: 'HEAD'}); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal((await fetch(base + '/' + path, {headers: {'If-None-Match': response.headers.get('etag')}})).status, 304);
    }
    for (const path of ['index.html', 'app.js', 'assets/launcher/app.mjs', 'host-manifest.json', 'release-catalog.json', 'app-shell-sw.js', 'runtime-manifest.json', 'missing.mjs']) {
      const response = await fetch(base + '/' + path); assert.equal(response.status, 404, path); assert.equal(await response.text(), 'Not found');
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
  assert.ok(selectedRoot); assert.equal(existsSync(selectedRoot), false, 'runner must clean its private fixture after the original harness terminates it');
  assert.equal(existsSync(resolve(cold, 'public/faq.html')), true, 'source inputs must remain untouched');
});
