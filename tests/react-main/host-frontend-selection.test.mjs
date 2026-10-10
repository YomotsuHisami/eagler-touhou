/** Host preflight/cache contracts: synthetic frontend only, no original game data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {STATIC_FRONTEND_PACKAGE_FILES, STATIC_APP_SHELL_FILES} from '../../lib/frontend-static-manifest.mjs';
import {ensureContractsBuild} from '../../lib/contracts-build.mjs';
import {writeSiteMetadata} from '../../lib/site-metadata.mjs';
import {PRODUCT_GAMES} from '../../lib/contracts/product-catalog.mjs';
import {resolveHostFrontend, reusableHostedBase, buildHostedSite, buildImportArtifacts} from '../../host/lib/site-builder.mjs';

async function fixture(run, {mountPath = '/', appShell = null} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'host-react-selection-'));
  const put = async (path, value) => {await mkdir(dirname(resolve(root, path)), {recursive: true}); await writeFile(resolve(root, path), value);};
  const environment = {EAGLER_FRONTEND: 'react'};
  try {
    for (const path of [...STATIC_FRONTEND_PACKAGE_FILES, 'assets/entry-abcd.js']) await put(path, 'fixture');
    for (const path of STATIC_FRONTEND_PACKAGE_FILES.filter(path => path.startsWith('legacy/'))) await put(path, 'export const value = 1;');
    const declaration = appShell ? `<meta name="eagler-react-app-shell" content="${JSON.stringify(appShell).replaceAll('"', '&quot;')}">` : '';
    for (const path of ['index.html', 'en.html', 'lobby.html']) await put(path, `<html><head>${declaration}<script type="module" src="${mountPath}assets/entry-abcd.js"></script></head></html>`);
    await put('.vite/manifest.json', JSON.stringify({entry: {file: 'assets/entry-abcd.js', isEntry: true}}));
    await put('.vite/react-app-shell-graph.json', JSON.stringify({schema: 'eagler-touhou/react-app-shell-graph/1', mountPath, appShell,
      shellFiles: [...STATIC_APP_SHELL_FILES.filter(path => !['lobby.css', 'touch-guide.css'].includes(path)), 'assets/entry-abcd.js'].sort()}));
    await run({root, put, environment});
  } finally {await rm(root, {recursive: true, force: true});}
}

async function withFrontend(value, run) {
  const previous = process.env.EAGLER_FRONTEND;
  const directory = process.env.EAGLER_REACT_BUILD_DIRECTORY;
  const mount = process.env.EAGLER_REACT_MOUNT_PATH;
  process.env.EAGLER_FRONTEND = value;
  delete process.env.EAGLER_REACT_BUILD_DIRECTORY;
  delete process.env.EAGLER_REACT_MOUNT_PATH;
  try {await run();} finally {
    for (const [key, old] of [['EAGLER_FRONTEND', previous], ['EAGLER_REACT_BUILD_DIRECTORY', directory], ['EAGLER_REACT_MOUNT_PATH', mount]]) {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  }
}

test('main remains the default and invalid selection fails before host inspection', async () => {
  assert.equal((await resolveHostFrontend({projectRoot: '/absent', environment: {}})).kind, 'main');
  await withFrontend('invalid', async () => {
    for (const build of [buildHostedSite, buildImportArtifacts]) await assert.rejects(build({projectRoot: '/absent', hostRoot: '/absent'}), /EAGLER_FRONTEND/);
  });
  await withFrontend('react', async () => {
    for (const build of [buildHostedSite, buildImportArtifacts]) await assert.rejects(build({projectRoot: '/absent', hostRoot: '/absent'}), /React frontend artifact is missing/);
  });
});

test('root React keeps App Shell disabled; mounted React is build-only', async () => {
  await fixture(async ({root, environment}) => {
    const selected = await resolveHostFrontend({projectRoot: root, environment, serve: true});
    assert.equal(selected.artifact.appShell, null);
    assert.equal(selected.siteUrl, null);
    await assert.rejects(resolveHostFrontend({projectRoot: root, environment, siteUrl: 'https://review.example/other/'}), /artifact mount/);
  });
  await fixture(async ({root, environment}) => {
    await resolveHostFrontend({projectRoot: root, environment});
    await assert.rejects(resolveHostFrontend({projectRoot: root, environment, serve: true}), /--build-only/);
  }, {mountPath: '/review/'});
});

test('isolated App Shell requires explicit exact origin and mount before preparation', async () => {
  const appShell = {schema: 'eagler-touhou/react-app-shell/1', origin: 'https://review.example', mountPath: '/review/'};
  await fixture(async ({root, environment}) => {
    for (const siteUrl of [undefined, 'https://other.example/review/', 'https://review.example/']) {
      await assert.rejects(resolveHostFrontend({projectRoot: root, environment, siteUrl}), /exact isolated origin|artifact mount/);
    }
    const selected = await resolveHostFrontend({projectRoot: root, environment, siteUrl: 'https://review.example/review/'});
    assert.equal(selected.siteUrl, 'https://review.example/review/');
    await assert.rejects(resolveHostFrontend({projectRoot: root, environment, siteUrl: selected.siteUrl, serve: true}), /--build-only/);
    await withFrontend('react', async () => {
      for (const build of [buildHostedSite, buildImportArtifacts]) await assert.rejects(build({projectRoot: root, hostRoot: '/absent'}), /exact isolated origin/);
    });
  }, {mountPath: appShell.mountPath, appShell});
});

test('cache reuse binds frontend kind, mount, artifact bytes, metadata, and deployment', async () => {
  await fixture(async ({root, put, environment}) => {
    const selected = await resolveHostFrontend({projectRoot: root, environment});
    const games = Object.keys(PRODUCT_GAMES);
    const site = resolve(root, 'site');
    const layout = {site, music: ['ogg'], runtimeRelease: resolve(root, 'runtime'), shared: resolve(root, 'shared'), config: resolve(root, 'host-config.json'), games: Object.fromEntries(games.map(game => [game, resolve(root, game)]))};
    await put('scripts/verify-server-build.mjs', 'process.exit(0);');
    await put('site/host-manifest.json', JSON.stringify({games: Object.fromEntries(games.map(game => [game, {languageOptions: ['ja', 'lang_zh-hans', 'lang_en'].map(id => ({id, pack: id === 'ja' ? null : {url: `${id}.zip`}}))}]))}));
    const deployment = {format: 'eagler-touhou-deployment/1', profile: 'web-validation-self-host', resourceMode: 'hosted', games, music: ['ogg'], generatedAt: new Date(Date.now() + 60000).toISOString(), frontend: {kind: 'react', mountPath: '/', validationMetadata: selected.artifact.metadata}};
    await mkdir(site, {recursive: true});
    for (const path of selected.artifact.packageFiles) {
      await mkdir(dirname(resolve(site, path)), {recursive: true});
      await cp(selected.artifact.resolveSource(path), resolve(site, path));
    }
    await writeSiteMetadata(site, null);
    deployment.files = await Promise.all(selected.artifact.packageFiles.map(async path => {
      const bytes = await readFile(resolve(site, path));
      return {path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    }));
    const save = () => put('site/deployment.json', JSON.stringify(deployment));
    await save();
    await withFrontend('main', async () => assert.equal(await reusableHostedBase(root, layout), false));
    await withFrontend('react', async () => {
      assert.equal(await reusableHostedBase(root, layout), true);
      assert.equal(await reusableHostedBase(root, layout, {siteUrl: 'https://example.test/'}), false);
      await put('assets/entry-abcd.js', 'const changed = true;');
      assert.equal(await reusableHostedBase(root, layout), false, 'same graph with changed bytes cannot reuse');
      await put('assets/entry-abcd.js', 'fixture');
      deployment.frontend.mountPath = '/wrong/'; await save();
      assert.equal(await reusableHostedBase(root, layout), false);
      deployment.frontend.mountPath = '/'; await save();
      deployment.files[0].sha256 = 'invalid'; await save();
      assert.equal(await reusableHostedBase(root, layout), false, 'all selected source bytes are checked');
      delete deployment.frontend; await save();
      assert.equal(await reusableHostedBase(root, layout), false, 'React cannot reuse a main site');
    });
  });
});


test('both host CLIs reject invalid frontend before workspace or dependency preparation', () => {
  const project = fileURLToPath(new URL('../../', import.meta.url));
  for (const script of ['host/build.mjs', 'host/build-import.mjs']) {
    const result = spawnSync(process.execPath, [resolve(project, script), '--root=/absent'], {
      cwd: project, env: {...process.env, EAGLER_FRONTEND: 'invalid'}, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EAGLER_FRONTEND must be main or react/);
    assert.doesNotMatch(result.stdout, /Preparing|Validating self-host/);
  }
});


async function copyHostCode(root) {
  const project = fileURLToPath(new URL('../../', import.meta.url));
  await cp(resolve(project, 'lib'), resolve(root, 'lib'), {recursive: true});
  await mkdir(resolve(root, 'config'), {recursive: true});
  await cp(resolve(project, 'config/workspace.json'), resolve(root, 'config/workspace.json'));
  const contracts = await ensureContractsBuild({project});
  await mkdir(resolve(root, 'assets'), {recursive: true});
  await cp(contracts.contractsDirectory, resolve(root, 'assets/contracts'), {recursive: true});
  await mkdir(resolve(root, 'host'), {recursive: true});
  await cp(resolve(project, 'host/lib'), resolve(root, 'host/lib'), {recursive: true});
  return project;
}

test('fresh React operator CLIs set up dependencies before full artifact parsing', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'host-bootstrap-order-'));
  try {
    const project = await copyHostCode(root);
    await writeFile(resolve(root, 'lib/host-workspace.mjs'), 'export async function inspectHostWorkspace() { return {}; }');
    await writeFile(resolve(root, 'host/lib/node-environment.mjs'), `
      import {existsSync} from 'node:fs';
      import {symlink} from 'node:fs/promises';
      import {resolve} from 'node:path';
      export function assertSupportedNode() {}
      export async function ensureNodeDependencies(root) {
        if (existsSync(resolve(root, 'node_modules'))) throw new Error('expected fresh operator');
        await symlink(${JSON.stringify(resolve(project, 'node_modules'))}, resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        console.log('DEPENDENCIES_READY');
      }
    `);
    for (const script of ['build.mjs', 'build-import.mjs']) {
      await cp(resolve(project, 'host', script), resolve(root, 'host', script));
      const result = spawnSync(process.execPath, [resolve(root, 'host', script), '--build-only'], {
        cwd: root, env: {...process.env, EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: 'missing-artifact'}, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /DEPENDENCIES_READY/);
      assert.match(result.stderr, /React frontend artifact is missing/);
      assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
      await rm(resolve(root, 'node_modules'));
    }
  } finally {await rm(root, {recursive: true, force: true});}
});

test('cache uses synthetic private override bytes without modifying artifact or private input', async () => {
  await fixture(async ({root, put, environment}) => {
    const project = await copyHostCode(root);
    await symlink(resolve(project, 'node_modules'), resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const isolated = await import(pathToFileURL(resolve(root, 'host/lib/site-builder.mjs')).href);
    const selected = await isolated.resolveHostFrontend({projectRoot: root, environment});
    const games = Object.keys(PRODUCT_GAMES), site = resolve(root, 'site');
    const layout = {site, music: ['ogg'], runtimeRelease: resolve(root, 'runtime'), shared: resolve(root, 'shared'), config: resolve(root, 'config.json'), games: Object.fromEntries(games.map(game => [game, resolve(root, game)]))};
    await put('scripts/verify-server-build.mjs', 'process.exit(0);');
    for (const path of selected.artifact.packageFiles) {
      await mkdir(dirname(resolve(site, path)), {recursive: true});
      await cp(selected.artifact.resolveSource(path), resolve(site, path));
    }
    await put('private-assets/donation.webp', 'synthetic override');
    await put('site/assets/donation.webp', 'synthetic override');
    await writeSiteMetadata(site, null);
    const files = await Promise.all(selected.artifact.packageFiles.map(async path => {
      const bytes = await readFile(resolve(site, path));
      return {path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    }));
    await put('site/deployment.json', JSON.stringify({format: 'eagler-touhou-deployment/1', profile: 'web-validation-self-host', resourceMode: 'hosted', games, music: ['ogg'], generatedAt: new Date(Date.now() + 60000).toISOString(), files, frontend: {kind: 'react', mountPath: '/', validationMetadata: selected.artifact.metadata}}));
    await put('site/host-manifest.json', JSON.stringify({games: Object.fromEntries(games.map(game => [game, {languageOptions: ['ja', 'lang_zh-hans', 'lang_en'].map(id => ({id, pack: id === 'ja' ? null : {url: `${id}.zip`}}))}]))}));
    await withFrontend('react', async () => {
      assert.equal(await isolated.reusableHostedBase(root, layout), true);
      assert.equal(await readFile(resolve(root, 'private-assets/donation.webp'), 'utf8'), 'synthetic override');
      assert.equal(await readFile(resolve(root, 'assets/donation.webp'), 'utf8'), 'fixture');
      await put('private-assets/donation.webp', 'changed synthetic override');
      assert.equal(await isolated.reusableHostedBase(root, layout), false);
      await rm(resolve(root, 'private-assets/donation.webp'));
      assert.equal(await isolated.reusableHostedBase(root, layout), false, 'fallback artifact differs from published override');
    });
  });
});
