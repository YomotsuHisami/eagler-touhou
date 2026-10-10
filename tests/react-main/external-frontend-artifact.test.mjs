/** Actual hosted -> external commands with synthetic Runtime/DATA only.
 * Proves publication ownership/integrity; no browser or gameplay claim. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReleaseManifest, writeReleaseManifest} from '../../lib/release-manifest.mjs';
import {readReactFrontendArtifact} from '../../lib/react-frontend-artifact.mjs';
import {writeRuntimeGeneration} from '../../lib/runtime-generations.mjs';
import {verifyRuntimeRelease} from '../../lib/runtime-release.mjs';
import {writeSyntheticRuntimeRelease} from '../support/runtime-release-fixture.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const environment = {...process.env};
for (const key of ['EAGLER_FRONTEND', 'EAGLER_REACT_BUILD_DIRECTORY', 'EAGLER_REACT_MOUNT_PATH', 'EAGLER_REACT_APP_SHELL', 'EAGLER_REACT_APP_SHELL_ORIGIN']) delete environment[key];
const command = (args, env = {}) => execute(process.execPath, args, {cwd: project, env: {...environment, ...env}, maxBuffer: 16 * 1024 * 1024});
async function hashes(root, directory = root, result = {}) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await hashes(root, path, result);
    else result[path.slice(root.length + 1)] = entry.isSymbolicLink() ? `symlink:${await readlink(path)}` : createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}

test('external source/output ownership rejects ancestors, descendants and existing parent aliases before writes', async () => {
  const work = await mkdtemp(resolve(tmpdir(), 'external-path-ownership-'));
  try {
    const source = resolve(work, 'hosted'), child = resolve(source, 'existing-output'), alias = resolve(work, 'source-alias');
    await mkdir(child, {recursive: true});
    await writeFile(resolve(work, 'owner'), 'preserve ancestor');
    await writeFile(resolve(source, 'owner'), 'preserve source');
    await writeFile(resolve(child, 'owner'), 'preserve descendant');
    await symlink(source, alias, 'dir');
    const before = await hashes(work);
    for (const [input, output] of [[source, work], [source, child], [source, resolve(source, 'new/child')],
      [source, resolve(alias, 'new/child')], [alias, work]]) {
      await assert.rejects(command(['scripts/package-external-site.mjs', `--source=${input}`, `--output=${output}`,
        `--runtime-release=${resolve(work, 'not-required')}`, '--profile=web-validation-external-frontend']), /directories must not overlap/);
      assert.deepEqual(await hashes(work), before);
    }
  } finally {await rm(work, {recursive: true, force: true});}
});

test('external conversion preserves the verified source frontend rather than caller selection', async t => {
  const cache = resolve(project, '.cache/tests'); await mkdir(cache, {recursive: true});
  const work = await mkdtemp(resolve(cache, 'external-frontend-'));
  try {
    const plainBuild = resolve(work, 'plain-build'), isolatedBuild = resolve(work, 'isolated-build');
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: plainBuild});
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: isolatedBuild,
      EAGLER_REACT_MOUNT_PATH: '/review/', EAGLER_REACT_APP_SHELL: 'isolated', EAGLER_REACT_APP_SHELL_ORIGIN: 'https://review.invalid'});
    const runtime = resolve(work, 'runtime'); await writeSyntheticRuntimeRelease(runtime);
    const assets = resolve(work, 'assets'), artwork = resolve(work, 'empty-artwork'); await mkdir(assets); await mkdir(artwork);
    await writeFile(resolve(assets, 'th08.dat'), 'bounded synthetic retail DATA');
    for (const name of ['msgothic.ttc', 'unifont.otf']) await writeFile(resolve(assets, name), 'synthetic font');
    const features = resolve(work, 'features.json');
    await writeFile(features, JSON.stringify({schema: 'eagler-touhou/server-features/1', resourceMode: 'hosted', games: {th08: {languages: ['ja'], thprac: false}}}));
    const hosted = {};
    for (const [kind, build, site] of [['main', null, null], ['plain', plainBuild, null], ['isolated', isolatedBuild, 'https://review.invalid/review/']]) {
      const output = hosted[kind] = resolve(work, `hosted-${kind}`);
      await command(['scripts/package-server.mjs', `--output=${output}`, `--runtime-release=${runtime}`, `--feature-config=${features}`,
        '--profile=web-validation-external-frontend', '--games=th08', '--music=midi', `--artwork-dir=${artwork}`, `--th08-assets=${assets}`,
        `--font=${resolve(assets, 'unifont.otf')}`, `--vanilla-font=${resolve(assets, 'msgothic.ttc')}`, ...(site ? [`--site-url=${site}`] : [])],
      build ? {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: build} : {});
    }
    // Conversion must consume the verified hosted artifact, not a warm source
    // build, and deployed sites intentionally publish no private .vite inputs.
    await rm(plainBuild, {recursive: true}); await rm(isolatedBuild, {recursive: true});
    const hostedBytes = new Map(await Promise.all(Object.values(hosted).map(async path => [path, await hashes(path)])));
    const convert = (source, output, env = {}, extra = [], runtimeInput = runtime) => command(['scripts/package-external-site.mjs', `--source=${source}`,
      `--output=${output}`, `--runtime-release=${runtimeInput}`, '--profile=web-validation-external-frontend', ...extra], env);
    const verify = directory => command(['scripts/verify-server-build.mjs', directory], {EAGLER_FRONTEND: 'invalid-caller-selection'});

    await t.test('React source remains React with unset selection and unavailable checkout artifact', async () => {
      const output = resolve(work, 'external-plain');
      await convert(hosted.plain, output);
      await verify(output);
      const source = await json(resolve(hosted.plain, 'deployment.json')), target = await json(resolve(output, 'deployment.json'));
      assert.equal(target.frontend?.kind, 'react');
      assert.equal(target.appShell, null);
      assert.deepEqual(target.frontend, source.frontend);
      assert.ok(target.files.every(file => file.path !== 'app.js' && !file.path.startsWith('assets/launcher/') && !file.path.startsWith('.vite/')));
      const artifact = await readReactFrontendArtifact({directory: output, metadata: target.frontend.validationMetadata});
      for (const path of artifact.packageFiles) assert.deepEqual(await readFile(resolve(output, path)), await readFile(resolve(hosted.plain, path)), path);
      assert.deepEqual(await hashes(resolve(output, 'runtime')), await hashes(resolve(hosted.plain, 'runtime')));
      assert.equal((await verifyReleaseManifest(output)).parameters.runtimeBuildProvenance, 'verified-runtime-release');
      assert.ok(target.files.every(file => !/^(?:games|shared)\//.test(file.path)));
    });
    await t.test('isolated source preserves exact origin, mount and rebuilt Runtime-bound worker', async () => {
      const output = resolve(work, 'external-isolated');
      await convert(hosted.isolated, output, {EAGLER_FRONTEND: 'main', EAGLER_REACT_BUILD_DIRECTORY: resolve(work, 'missing')});
      await verify(output);
      const source = await json(resolve(hosted.isolated, 'deployment.json')), target = await json(resolve(output, 'deployment.json'));
      assert.equal(target.frontend?.kind, 'react');
      assert.equal(target.siteUrl, 'https://review.invalid/review/');
      assert.deepEqual(target.frontend, source.frontend);
      assert.ok(target.appShell.buildId);
      assert.equal(target.appShell.runtimeManifest.sha256, createHash('sha256').update(await readFile(resolve(output, 'runtime-manifest.json'))).digest('hex'));
      assert.deepEqual(await hashes(resolve(output, 'runtime')), await hashes(resolve(hosted.isolated, 'runtime')));
    });
    await t.test('main source keeps main even when caller requests an unavailable React artifact', async () => {
      const output = resolve(work, 'external-main');
      await convert(hosted.main, output, {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: resolve(work, 'missing')});
      await verify(output);
      const deployment = await json(resolve(output, 'deployment.json'));
      assert.equal(Object.hasOwn(deployment, 'frontend'), false);
      assert.ok(deployment.files.some(file => file.path === 'app.js'));
    });
    await t.test('unsupported isolated relocation fails before replacing existing output', async () => {
      const output = resolve(work, 'preserved'); await mkdir(output); await writeFile(resolve(output, 'sentinel'), 'keep');
      for (const url of ['https://different.invalid/review/', 'https://review.invalid/']) {
        await assert.rejects(convert(hosted.isolated, output, {}, [`--site-url=${url}`]), /React.*(?:origin|mount|relocation)/);
        assert.deepEqual(await readdir(output), ['sentinel']);
      }
    });
    await t.test('missing frontend bytes or isolated origin cannot fall back to main or replace output', async () => {
      const output = resolve(work, 'preserved-invalid'); await mkdir(output); await writeFile(resolve(output, 'sentinel'), 'keep');
      const broken = resolve(work, 'broken'); await cp(hosted.plain, broken, {recursive: true});
      const deployment = await json(resolve(broken, 'deployment.json'));
      await rm(resolve(broken, deployment.files.find(file => /^assets\/root-.+\.js$/.test(file.path)).path));
      await assert.rejects(convert(broken, output), /ENOENT|release file mismatch/);
      const noOrigin = resolve(work, 'missing-origin'); await cp(hosted.isolated, noOrigin, {recursive: true});
      const noOriginDeployment = await json(resolve(noOrigin, 'deployment.json'));
      delete noOriginDeployment.siteUrl;
      await writeFile(resolve(noOrigin, 'deployment.json'), JSON.stringify(noOriginDeployment));
      await writeReleaseManifest(noOrigin, await json(resolve(noOrigin, 'release-manifest.json')));
      await assert.rejects(convert(noOrigin, output), /exact isolated origin and mount/);
      assert.deepEqual(await readdir(output), ['sentinel']);
      assert.equal(await readFile(resolve(output, 'sentinel'), 'utf8'), 'keep');
    });
    await t.test('a valid but different Runtime Release cannot replace the hosted Runtime identity', async () => {
      const different = resolve(work, 'different-runtime'); await cp(runtime, different, {recursive: true});
      const manifest = await json(resolve(different, 'runtime-release.json')), entry = manifest.games.th08.runtime;
      const original = resolve(different, entry.root), wasm = Object.keys(entry.files).find(name => name.endsWith('.wasm'));
      await writeFile(resolve(original, wasm), 'different but hash-verified Runtime fixture');
      const generation = await writeRuntimeGeneration({site: different, root: 'runtime/th08/', source: original,
        entry: 'th08.html', names: Object.keys(entry.files)});
      await rm(original, {recursive: true});
      manifest.games.th08.runtime = {root: `runtime/th08/${generation.generation}`, generation: generation.generation,
        files: Object.fromEntries(generation.files.map(({path, ...identity}) => [path, identity]))};
      await writeFile(resolve(different, 'runtime-release.json'), JSON.stringify(manifest));
      await verifyRuntimeRelease(different);
      const output = resolve(work, 'preserved-runtime'); await mkdir(output); await writeFile(resolve(output, 'sentinel'), 'keep');
      await assert.rejects(convert(hosted.plain, output, {}, [], different), /external Runtime (?:file set|identity) does not match/);
      assert.deepEqual(await readdir(output), ['sentinel']);
    });
    for (const [path, before] of hostedBytes) assert.deepEqual(await hashes(path), before, 'hosted source must stay immutable');
    assert.equal((await readdir(work)).some(path => /\.external-[a-f0-9-]+$/.test(path)), false, 'failed candidates must be cleaned up');
  } finally {await rm(work, {recursive: true, force: true});}
});
