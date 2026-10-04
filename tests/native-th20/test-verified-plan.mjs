/** Synthetic source/VM identity tests only. No browser/server, IndexedDB, actual
 * Package content, native WASM execution, gameplay or product-support evidence. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, writeFile, rm, mkdir, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync} from 'fflate';
import {createTh20NativeHarnessServer, nativeFixtureResourceResolver} from '../../scripts/serve-th20-native-harness.mjs';
import {createUiDeploymentContract} from '../../scripts/ui-deployment-contract.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({entryPoints: [resolve(root, 'tests/native-th20/verified-plan.ts')], bundle: true,
  platform: 'browser', format: 'esm', write: false, plugins: [{name: 'authored-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path);
      for (const name of ['product-catalog', 'release-catalog', 'host-manifest', 'runtime-protocol', 'resource-mode']) {
        if ([resolve(root, `${name}.mjs`), resolve(root, `lib/contracts/${name}.mjs`)].includes(path)) return {path: resolve(root, `src/contracts/${name}.mts`)};
      }
      const authored = path.replace(/\.mjs$/, '.mts');
      if (authored.startsWith(resolve(root, 'src') + '/') && existsSync(authored)) return {path: authored};
    });
  }}]});
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const temporary = await mkdtemp(resolve(tmpdir(), 'th20-native-plan-'));
after(() => rm(temporary, {recursive: true, force: true}));
const compiledPath = resolve(temporary, 'verified-plan.mjs');
await writeFile(compiledPath, bundle.outputFiles[0].text);
const {verifyNativePublication, verifyNativePackage} = await import(pathToFileURL(compiledPath).href);
const sha = value => createHash('sha256').update(value).digest('hex');
const baseUrl = 'http://127.0.0.1:4198/nested/';
const previousFetch = globalThis.fetch, previousLocation = globalThis.location;
after(() => {globalThis.fetch = previousFetch;if (previousLocation === undefined) delete globalThis.location;else globalThis.location = previousLocation;});
function setup() {
  const files = [
    {path: 'th20-sdl.wasm', bytes: 9, sha256: sha('synthetic wasm marker')},
    {path: 'th20.html', bytes: 20, sha256: sha('synthetic html marker')},
  ];
  const generation = sha(JSON.stringify(['eagler-touhou/runtime-generation/1', 'th20.html', files.map(f => [f.path, f.bytes, f.sha256])]));
  const gameData = {path: 'th20.data', bytes: 3, sha256: sha(new Uint8Array([1,2,3])), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}`};
  const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
    shared: {resourceMode: 'hosted', runtimeManifest: 'runtime-manifest.json', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf'},
    games: {th20: {runtime: `runtime/th20/${generation}/th20.html`, gameData, music: {midi: {files: []}},
      languages: [], languageOptions: [{id: 'ja', title: '日本語', pack: null}]}}};
  const runtime = {schema: 'eagler-touhou/runtime-manifest/1', protocol: 'eagler-touhou/1', groups: [{root: 'runtime/th20/',
    current: {generation, entry: 'th20.html', files}, previous: []}]};
  const marker = {schema: 'eagler-touhou/ui-publication/1', status: 'react-main', mountPath: '/nested/', uiBuild: {sha256: 'c'.repeat(64)}};
  const values = {'host-manifest.json': host, 'runtime-manifest.json': runtime, 'ui-publication.json': marker};
  const pins = {baseUrl, hostSha256: sha(JSON.stringify(host)), runtimeGeneration: generation, packageSha256: 'd'.repeat(64)};
  const requested = [];
  globalThis.location = new URL(baseUrl);
  globalThis.fetch = async (input, options) => {
    const url = new URL(input), path = url.href.slice(baseUrl.length);requested.push(path);
    assert.ok(url.href.startsWith(baseUrl));assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(values[path]), {status: path in values ? 200 : 404, headers: {'content-type': 'application/json'}});
  };
  return {host, runtime, marker, pins, requested, repin: () => {pins.hostSha256 = sha(JSON.stringify(host));}};
}
function syntheticPackage(fixture, change = () => {}) {
  const descriptor = {schema: 'eagler-touhou/package/1', game: 'th20', revision: '1234567890abcdef',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th20', dataFile: 'game-data', dataLayout: fixture.host.games.th20.gameData.layout},
    files: {}, base: {files: ['game-data', 'shared-msgothic', 'shared-unifont']}, components: {ogg: {type: 'ogg', files: ['ogg:one', 'ogg:two']}}};
  const payload = {};
  for (const [id, source, target] of [['game-data', 'games/th20/th20.data', '/th20.data'], ['shared-msgothic', 'shared/msgothic.ttc', '/msgothic.ttc'],
    ['shared-unifont', 'shared/unifont.otf', '/unifont.otf'], ['ogg:one', 'games/th20/music/ogg/one.ogg', '/bgm-ogg/one.ogg'], ['ogg:two', 'games/th20/music/ogg/two.ogg', '/bgm-ogg/two.ogg']]) {
    const bytes = new Uint8Array([1,2,3]);payload[source] = bytes;
    descriptor.files[id] = {revision: `rev-${id}`, source, target, bytes: bytes.length, sha256: sha(bytes)};
  }
  change(descriptor, payload);
  payload['package.json'] = new TextEncoder().encode(JSON.stringify(descriptor));
  const bytes = zipSync(payload, {level: 0}), file = new File([bytes], 'synthetic-th20.zip');
  fixture.pins.packageSha256 = sha(bytes);
  return file;
}
test('fixture boundary accepts exact synthetic identities without changing hidden public-product gate', async () => {
  const f = setup(), result = await verifyNativePublication(f.pins);
  assert.equal(result.entry, baseUrl + f.host.games.th20.runtime);
  assert.deepEqual(f.requested, ['ui-publication.json', 'host-manifest.json', 'runtime-manifest.json']);
});
test('remote, cross-origin, unpinned and mismounted inputs fail closed', async () => {
  const f = setup();
  for (const patch of [{baseUrl: 'https://remote.test/'}, {baseUrl: 'http://localhost:4198/nested/'}, {packageSha256: ''}, {runtimeGeneration: ''}]) {
    await assert.rejects(verifyNativePublication({...f.pins, ...patch}));
  }
  f.marker.mountPath = '/';await assert.rejects(verifyNativePublication(f.pins), /assembled current React publication/);
});
test('changed Host, mutable Runtime, wrong exact generation and corrupt sealed manifest are rejected', async () => {
  let f = setup();f.host.profile = 'changed';await assert.rejects(verifyNativePublication(f.pins), /Host identity changed/);
  f = setup();f.host.games.th20.runtime = 'runtime/th20/th20.html';f.repin();await assert.rejects(verifyNativePublication(f.pins), /immutable generation/);
  f = setup();await assert.rejects(verifyNativePublication({...f.pins, runtimeGeneration: 'a'.repeat(64)}), /explicitly selected TH20 generation/);
  f = setup();f.runtime.groups[0].current.files[0].sha256 = 'e'.repeat(64);await assert.rejects(verifyNativePublication(f.pins), /Runtime generation identity mismatch/);
});
test('synthetic local ZIP verifies all declared DATA/font/OGG bytes before any store installation', async () => {
  const f = setup(), file = syntheticPackage(f), publication = await verifyNativePublication(f.pins);
  const parsed = await verifyNativePackage(file, publication);
  assert.equal(parsed.files.size, 5);assert.equal(parsed.descriptor.game, 'th20');
});
test('a changed ZIP, incorrect Host DATA and modified or missing imported OGG are rejected', async () => {
  let f = setup(), file = syntheticPackage(f);f.pins.packageSha256 = 'e'.repeat(64);
  await assert.rejects(verifyNativePackage(file, await verifyNativePublication(f.pins)), /does not match/);
  f = setup();file = syntheticPackage(f, descriptor => {descriptor.files['game-data'].sha256 = 'e'.repeat(64);});
  await assert.rejects(verifyNativePackage(file, await verifyNativePublication(f.pins)), /does not match the current Host/);
  f = setup();file = syntheticPackage(f, (_descriptor, payload) => {payload['games/th20/music/ogg/one.ogg'] = new Uint8Array([4,5,6]);});
  await assert.rejects(verifyNativePackage(file, await verifyNativePublication(f.pins)), /Package SHA-256 mismatch/);
  f = setup();file = syntheticPackage(f, (_descriptor, payload) => {delete payload['games/th20/music/ogg/one.ogg'];});
  await assert.rejects(verifyNativePackage(file, await verifyNativePublication(f.pins)), /imported OGG component/);
});
test('fixture graph is separate from app/production inputs and native lanes retain unique assertions', async () => {
  const walk = async directory => (await Promise.all((await readdir(directory, {withFileTypes: true})).map(entry => entry.isDirectory()
    ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
  for (const file of await walk(resolve(root, 'app'))) assert.doesNotMatch(await readFile(file, 'utf8'), /native-th20|__th20_native__|__th20NativeFixture/);
  const builder = await readFile(resolve(root, 'scripts/build-th20-native-harness.mjs'), 'utf8');
  assert.match(builder, /\.cache\/th20-native-harness\/__th20_native__/);assert.match(builder, /publicDir: false/);
  const fixture = await readFile(resolve(root, 'tests/native-th20/native-fixture.tsx'), 'utf8');
  assert.match(fixture, /createRuntimeService\(/);assert.match(fixture, /RuntimeViewport/);assert.match(fixture, /RuntimeTouchOverlayForContext/);assert.match(fixture, /RuntimeControlsForService/);
  assert.doesNotMatch(fixture, /__th20Runtime\s*=|ready:\s*true|firstFrame:\s*true/);
  const helper = await readFile(resolve(root, 'tests/support/th20_native.py'), 'utf8');
  assert.match(helper, /FRAME_TARGET = 120/);assert.match(helper, /instanceof WebAssembly.Memory/);assert.match(helper, /managedData/);
  for (const name of ['test-th20-import-launch-browser.py', 'test-th20-touch-browser.py']) {
    const text = await readFile(resolve(root, 'tests', name), 'utf8');
    assert.doesNotMatch(text, /__eaglerBoot|#touchEscape|#gameFrame|#gameDataImport|#musicSelect|subprocess|scripts\/serve\.mjs/);
  }
  const touch = await readFile(resolve(root, 'tests/test-th20-touch-browser.py'), 'utf8');
  for (const evidence of ['sdl_touch_probe', 'sdl_player_state', 'CONFIRM_PULSES', 'ESCAPE_PULSES', 'DIALOGUE', 'PAUSE_CURSOR', 'UNLIMITED_USED', 'first_ratio', 'page.keyboard.down']) assert.ok(touch.includes(evidence), evidence);
});

test('unbound portable fixture factory accepts root and nested publication markers without private build files', async () => {
  const fixtureRoot = resolve(temporary, 'separate-fixture');
  await mkdir(resolve(fixtureRoot, '__th20_native__'), {recursive: true});
  await writeFile(resolve(fixtureRoot, '__th20_native__/fixture-manifest.json'), JSON.stringify({
    schema: 'eagler-touhou/th20-native-fixture/1', testOnly: true, scope: 'test-only-native-adapter', productionProductSupport: false}));
  for (const [name, mountPath] of [['root', '/'], ['nested', '/preview/']]) {
    const publicationRoot = resolve(temporary, `unbound-${name}`);
    await mkdir(publicationRoot);
    await writeFile(resolve(publicationRoot, 'ui-publication.json'), JSON.stringify({schema: 'eagler-touhou/ui-publication/1',
      status: 'react-main', mountPath, navigation: createUiDeploymentContract({mountPath, patterns: ['/']})}));
    await assert.rejects(access(resolve(publicationRoot, 'ui-ownership.json')), {code: 'ENOENT'});
    const server = await createTh20NativeHarnessServer({publicationRoot, fixtureRoot});
    assert.equal(server.uiMountPath, mountPath);
    assert.equal(server.listening, false);assert.equal(server.address(), null);
    // Construction only. Never call listen or emit requests in this source-only gate.
  }
});
test('separate resource resolver cannot shadow publication assets or expose either root’s private files', async () => {
  const publicationRoot = resolve(temporary, 'resolver-publication'), fixtureRoot = resolve(temporary, 'resolver-fixture');
  await mkdir(resolve(publicationRoot, 'assets'), {recursive: true});
  await mkdir(resolve(fixtureRoot, 'assets'), {recursive: true});
  await mkdir(resolve(fixtureRoot, '__th20_native__'), {recursive: true});
  await writeFile(resolve(publicationRoot, 'assets/app.js'), 'synthetic publication');
  await writeFile(resolve(fixtureRoot, 'assets/app.js'), 'synthetic shadow');
  await writeFile(resolve(fixtureRoot, '__th20_native__/index.html'), 'synthetic fixture');
  for (const [directory, name] of [[publicationRoot, 'ui-ownership.json'], [publicationRoot, 'ui-artifact.json'],
    [fixtureRoot, '__th20_native__/ui-ownership.json'], [fixtureRoot, '__th20_native__/ui-artifact.json']]) {
    await writeFile(resolve(directory, name), 'synthetic private metadata');
  }
  const resource = nativeFixtureResourceResolver(publicationRoot, fixtureRoot);
  assert.equal((await resource('/assets/app.js')).path, resolve(publicationRoot, 'assets/app.js'));
  assert.equal((await resource('/__th20_native__/index.html')).path, resolve(fixtureRoot, '__th20_native__/index.html'));
  for (const path of ['/ui-ownership.json', '/ui-artifact.json', '/__th20_native__/ui-ownership.json', '/__th20_native__/ui-artifact.json', '/missing.js']) assert.equal(await resource(path), null);
});
