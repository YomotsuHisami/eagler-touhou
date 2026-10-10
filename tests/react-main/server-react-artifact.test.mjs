/** Real Node package/verification entrypoints with synthetic Runtime/DATA only.
 * This is structural publication evidence, never browser or gameplay parity. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_GAMES} from '../../lib/contracts/product-catalog.mjs';
import {createPublicationHostSeed} from '../../lib/publication-host-seed.mjs';
import {writeReleaseManifest, verifyReleaseManifest} from '../../lib/release-manifest.mjs';
import {verifyRuntimePublication} from '../../lib/runtime-generations.mjs';
import {readReactFrontendArtifact} from '../../lib/react-frontend-artifact.mjs';
import {writeSyntheticRuntimeRelease} from '../support/runtime-release-fixture.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const cleanEnvironment = {...process.env};
for (const key of ['EAGLER_FRONTEND', 'EAGLER_REACT_BUILD_DIRECTORY', 'EAGLER_REACT_MOUNT_PATH', 'EAGLER_REACT_APP_SHELL', 'EAGLER_REACT_APP_SHELL_ORIGIN']) delete cleanEnvironment[key];
const command = (args, environment = {}) => execute(process.execPath, args, {cwd: project,
  env: {...cleanEnvironment, ...environment}, maxBuffer: 16 * 1024 * 1024});

async function fileHashes(root, directory = root, files = {}) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await fileHashes(root, path, files);
    else files[path.slice(root.length + 1).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return files;
}

async function resign(directory, change) {
  const deployment = await json(resolve(directory, 'deployment.json'));
  const release = await json(resolve(directory, 'release-manifest.json'));
  await change(deployment, release);
  for (const item of deployment.files) {
    const bytes = await readFile(resolve(directory, item.path));
    item.bytes = bytes.length; item.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(resolve(directory, 'deployment.json'), JSON.stringify(deployment));
  await writeReleaseManifest(directory, release);
}

test('opt-in React artifacts use the actual server packager and generic verifier', async t => {
  // React Router's prerendered server resolves installed React from this checkout.
  const cache = resolve(project, '.cache/tests');
  await mkdir(cache, {recursive: true});
  const temporary = await mkdtemp(resolve(cache, 'eagler-react-server-'));
  try {
    const defaultBuild = resolve(temporary, 'default-build'), isolatedBuild = resolve(temporary, 'isolated-build');
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: defaultBuild});
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: isolatedBuild,
      EAGLER_REACT_MOUNT_PATH: '/react-review/', EAGLER_REACT_APP_SHELL: 'isolated', EAGLER_REACT_APP_SHELL_ORIGIN: 'https://review.invalid'});
    const runtimeRelease = await writeSyntheticRuntimeRelease(resolve(temporary, 'runtime'));
    const seed = createPublicationHostSeed('web-validation-react-server');
    seed.schema = 'eagler-touhou/host-manifest/1';
    seed.shared = {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc?v=f', unicodeFont: 'shared/unifont.otf?v=g'};
    for (const [game, product] of Object.entries(PRODUCT_GAMES)) Object.assign(seed.games[game], {
      runtime: `runtime/${game}/${game}.html?hosted=1&v=old`,
      ...(product.multiplayerRuntime ? {multiplayerRuntime: `runtime/${game}/multiplayer/${game}.html?hosted=1&v=old`} : {}),
      gameData: {path: product.package.dataTarget.slice(1), bytes: 4, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: runtimeRelease.games[game].dataLayout},
      features: {thprac: false, focusHitbox: false}, music: {midi: {files: [], ...(product.musicCapabilities.midi ? {} : {supported: false})}},
    });
    const features = {schema: 'eagler-touhou/server-features/1', resourceMode: 'import', games: Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([game, product]) => [game, {
      ...(product.features.languages ? {languages: ['ja']} : {}), ...(product.features.thprac ? {thprac: false} : {}),
    }]))};
    await writeFile(resolve(temporary, 'host-seed.json'), JSON.stringify(seed));
    await writeFile(resolve(temporary, 'features.json'), JSON.stringify(features));
    const packageSite = (output, build, extra = [], selection = 'react') => command(['scripts/package-server.mjs', `--output=${output}`,
      `--runtime-release=${resolve(temporary, 'runtime')}`, `--host-manifest=${resolve(temporary, 'host-seed.json')}`,
      `--feature-config=${resolve(temporary, 'features.json')}`, '--profile=web-validation-react-server', '--games=th06,th07,th08,th10', '--music=midi', ...extra],
    {...(selection === null ? {} : {EAGLER_FRONTEND: selection}), EAGLER_REACT_BUILD_DIRECTORY: build});
    // Neither the verifier's selection nor a nonexistent build can override
    // the deployment's embedded, provenance-covered frontend graph.
    const verify = directory => command(['scripts/verify-server-build.mjs', directory],
      {EAGLER_FRONTEND: 'invalid-verifier-environment', EAGLER_REACT_BUILD_DIRECTORY: resolve(temporary, 'missing')});
    const main = resolve(temporary, 'main-site'), plain = resolve(temporary, 'plain-site'), isolated = resolve(temporary, 'isolated-site');
    await t.test('unset selection preserves original main and verifies independently of caller selection', async () => {
      await packageSite(main, resolve(temporary, 'missing-react-build'), [], null);
      const deployment = await json(resolve(main, 'deployment.json'));
      assert.equal(Object.hasOwn(deployment, 'frontend'), false);
      assert.ok(deployment.appShell.buildId);
      assert.ok(deployment.files.some(item => item.path === 'app.js'));
      await verify(main);
    });
    await t.test('default React publication omits SW, legacy UI, and public graph metadata', async () => {
      await packageSite(plain, defaultBuild);
      await verify(plain);
      const deployment = await json(resolve(plain, 'deployment.json'));
      assert.equal(deployment.appShell, null);
      assert.equal(deployment.frontend.kind, 'react');
      assert.equal(deployment.frontend.mountPath, '/');
      assert.ok(!deployment.files.some(item => item.path === 'app-shell-sw.js' || item.path === 'app.js' || item.path.startsWith('assets/launcher/') || item.path.startsWith('.vite/')));
      const artifact = await readReactFrontendArtifact({directory: plain, metadata: deployment.frontend.validationMetadata});
      assert.ok(artifact.packageFiles.every(path => deployment.files.some(item => item.path === path)));
      assert.equal((await verifyReleaseManifest(plain)).parameters.frontend.kind, 'react');
      const runtime = await verifyRuntimePublication(plain, await json(resolve(plain, 'host-manifest.json')));
      assert.equal(runtime.groups.length, ['th06', 'th07', 'th08', 'th10'].reduce((count, game) => count + 1 + Number(Boolean(PRODUCT_GAMES[game].multiplayerRuntime)), 0));
    });
    await t.test('isolated React publication rebuilds its SW against final Host bytes and actual graph', async () => {
      await packageSite(isolated, isolatedBuild, ['--site-url=https://review.invalid/react-review/']);
      await verify(isolated);
      const deployment = await json(resolve(isolated, 'deployment.json'));
      const graph = deployment.frontend.validationMetadata.graph;
      assert.ok(graph.shellFiles.every(path => deployment.appShell.entries.includes(path)));
      assert.ok(deployment.appShell.entries.every(path => !path.startsWith('runtime/') && path !== 'runtime-manifest.json'));
      assert.equal(deployment.appShell.runtimeManifest.sha256, createHash('sha256').update(await readFile(resolve(isolated, 'runtime-manifest.json'))).digest('hex'));
      assert.notEqual(await readFile(resolve(isolated, 'app-shell-sw.js'), 'utf8'), await readFile(resolve(isolatedBuild, 'client/app-shell-sw.js'), 'utf8'));
    });
    await t.test('cross-UI frontend refresh rejects without changing any deployment file', async () => {
      for (const target of [plain, isolated]) {
        const before = await fileHashes(target);
        await assert.rejects(command(['scripts/refresh-deployment-app-shell.mjs', target, '--frontend'],
          {EAGLER_FRONTEND: 'main'}), /React frontend refresh requires explicit EAGLER_FRONTEND=react/);
        assert.deepEqual(await fileHashes(target), before);
      }
      const before = await fileHashes(main);
      for (const flags of [[], ['--frontend']]) {
        await assert.rejects(command(['scripts/refresh-deployment-app-shell.mjs', main, ...flags],
          {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: defaultBuild}), /cannot refresh a main deployment with the React frontend/);
        assert.deepEqual(await fileHashes(main), before);
      }
    });
    await t.test('wrong or absent isolated site URL and unknown selection preserve existing output', async () => {
      const output = resolve(temporary, 'preserved'); await mkdir(output); await writeFile(resolve(output, 'sentinel'), 'keep');
      for (const extra of [[], ['--site-url=https://other.invalid/react-review/'], ['--site-url=https://review.invalid/']]) {
        await assert.rejects(packageSite(output, isolatedBuild, extra), /React (?:App Shell|frontend artifact mount)/);
        assert.equal(await readFile(resolve(output, 'sentinel'), 'utf8'), 'keep');
      }
      await assert.rejects(packageSite(output, defaultBuild, [], 'typo'), /EAGLER_FRONTEND must be main or react/);
      await assert.rejects(packageSite(output, resolve(temporary, 'not-built')), /React frontend artifact is missing/);
      assert.deepEqual(await readdir(output), ['sentinel']);
    });
    const hosted = resolve(temporary, 'hosted-site');
    await t.test('hosted React publication preserves DATA, package, and shared-font ownership', async () => {
      const assets = resolve(temporary, 'synthetic-assets'), artwork = resolve(temporary, 'empty-artwork');
      await mkdir(assets); await mkdir(artwork);
      await writeFile(resolve(assets, 'th08.dat'), 'synthetic retail DATA');
      await writeFile(resolve(assets, 'msgothic.ttc'), 'synthetic font');
      await writeFile(resolve(assets, 'unifont.otf'), 'synthetic font');
      await writeFile(resolve(temporary, 'hosted-features.json'), JSON.stringify({...features, resourceMode: 'hosted'}));
      await command(['scripts/package-server.mjs', `--output=${hosted}`, `--runtime-release=${resolve(temporary, 'runtime')}`,
        `--feature-config=${resolve(temporary, 'hosted-features.json')}`, '--profile=web-validation-react-server', '--games=th08', '--music=midi',
        `--artwork-dir=${artwork}`, `--th08-assets=${assets}`, `--font=${resolve(assets, 'unifont.otf')}`, `--vanilla-font=${resolve(assets, 'msgothic.ttc')}`],
      {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: defaultBuild});
      await verify(hosted);
      const deployment = await json(resolve(hosted, 'deployment.json'));
      assert.equal(deployment.resourceMode, 'hosted');
      assert.ok(deployment.files.some(item => item.path === 'th08.package.json'));
      assert.ok(deployment.files.some(item => item.path === 'shared/msgothic.ttc'));
    });
    await t.test('external React publication preserves remote package identities without payloads', async () => {
      const external = resolve(temporary, 'external-site');
      await writeFile(resolve(temporary, 'external-features.json'), JSON.stringify({...features, resourceMode: 'external'}));
      await command(['scripts/package-server.mjs', `--output=${external}`, `--runtime-release=${resolve(temporary, 'runtime')}`,
        `--host-manifest=${resolve(hosted, 'host-manifest.json')}`, `--feature-config=${resolve(temporary, 'external-features.json')}`,
        '--profile=web-validation-react-server', '--games=th08', '--music=midi'],
      {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: defaultBuild});
      await verify(external);
      const deployment = await json(resolve(external, 'deployment.json'));
      assert.equal(deployment.resourceMode, 'external');
      assert.ok(deployment.files.some(item => item.path === 'th08.package.json'));
      assert.ok(deployment.files.every(item => !/^(?:games|shared)\//.test(item.path)));
    });
    async function rejectsMutation(name, source, mutation, expected) {
      await t.test(name, async () => {
        const directory = resolve(temporary, name.replaceAll(/[^a-z0-9]+/gi, '-'));
        await cp(source, directory, {recursive: true});
        await resign(directory, (deployment, release) => mutation(directory, deployment, release));
        await assert.rejects(verify(directory), expected);
      });
    }
    await rejectsMutation('graph omission fails despite fresh release hashes', plain, async (_, deployment) => {
      deployment.frontend.validationMetadata.graph.shellFiles.pop();
    }, /React App Shell graph differs/);
    await rejectsMutation('frontend provenance mismatch fails', plain, async (_, __, release) => {
      release.parameters.frontend.mountPath = '/other/';
    }, /frontend does not match Release Manifest provenance/);
    await rejectsMutation('disabled worker cannot be introduced by packaging', plain, async (directory, deployment) => {
      await writeFile(resolve(directory, 'app-shell-sw.js'), '// unexpected worker');
      deployment.files.push({path: 'app-shell-sw.js'});
    }, /disabled React App Shell/);
    await rejectsMutation('isolated permission cannot move to another origin', isolated, async (_, deployment) => {
      deployment.siteUrl = 'https://other.invalid/react-review/';
    }, /exact isolated origin and mount/);
    await rejectsMutation('missing inert React migration entry fails structural verification', plain, async (directory, deployment) => {
      for (const item of deployment.files.filter(item => /^assets\/.+\.js$/.test(item.path))) {
        const source = await readFile(resolve(directory, item.path), 'utf8');
        if (source.includes('originMigrationOpen')) await writeFile(resolve(directory, item.path), source.replaceAll('originMigrationOpen', 'missingMigrationOpen'));
      }
    }, /React UI is missing its inert Host Manifest governed origin migration entry/);
    await rejectsMutation('hosted shared-font targets remain a required React UI contract', hosted, async (directory, deployment) => {
      for (const item of deployment.files.filter(item => /^assets\/.+\.js$/.test(item.path))) {
        const source = await readFile(resolve(directory, item.path), 'utf8');
        await writeFile(resolve(directory, item.path), source.replaceAll('/msgothic.ttc', '/wrong-font.ttc'));
      }
    }, /host shared font target mismatch: \/msgothic.ttc/);
    await rejectsMutation('Runtime identity is still checked with React SW disabled', plain, async (directory, deployment) => {
      const file = deployment.files.find(item => /^runtime\/.+\.wasm$/.test(item.path));
      await writeFile(resolve(directory, file.path), 'changed-runtime');
    }, /(?:Runtime|runtime).*(?:mismatch|identity)|(?:mismatch|identity).*(?:Runtime|runtime)/);
    await rejectsMutation('DATA identity is still checked with React SW disabled', plain, async directory => {
      const host = await json(resolve(directory, 'host-manifest.json'));
      host.games.th06.gameData.bytes = 0;
      await writeFile(resolve(directory, 'host-manifest.json'), JSON.stringify(host));
    }, /(?:game data identity|gameData|data identity|invalid Host Manifest games)/);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});
