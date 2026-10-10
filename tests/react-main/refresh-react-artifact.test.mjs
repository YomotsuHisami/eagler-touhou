/** Node-only refresh of actual React artifacts and synthetic Runtime/DATA.
 * No browser, deployment endpoint, or gameplay acceptance is exercised. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReleaseManifest, verifyReleaseManifestDeclaration} from '../../lib/release-manifest.mjs';
import {publishRuntimeManifest, readRuntimeManifest, verifyRuntimePublication, writeRuntimeGeneration} from '../../lib/runtime-generations.mjs';
import {readReactFrontendArtifact} from '../../lib/react-frontend-artifact.mjs';
import {ensureContractsBuild} from '../../lib/contracts-build.mjs';
import {writeSyntheticRuntimeRelease} from '../support/runtime-release-fixture.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile), json = async path => JSON.parse(await readFile(path, 'utf8'));
const environment = {...process.env};
for (const key of ['EAGLER_FRONTEND', 'EAGLER_REACT_BUILD_DIRECTORY', 'EAGLER_REACT_MOUNT_PATH', 'EAGLER_REACT_APP_SHELL', 'EAGLER_REACT_APP_SHELL_ORIGIN']) delete environment[key];
const command = (args, extra = {}) => execute(process.execPath, args, {cwd: project, env: {...environment, ...extra}, maxBuffer: 16 * 1024 * 1024});
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
async function hashes(root, directory = root, values = {}) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await hashes(root, path, values);
    else if (entry.isSymbolicLink()) values[path.slice(root.length + 1)] = 'symlink:' + await readlink(path);
    else values[path.slice(root.length + 1)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return values;
}
const protectedFiles = entries => Object.fromEntries(Object.entries(entries).filter(([path]) => /^(?:runtime\/|games\/|shared\/)|^(?:host-manifest|release-catalog|th08\.package|runtime-manifest)\.json$/.test(path)));

test('React refresh stages and verifies a coherent artifact before replacing any target bytes', async t => {
  const cache = resolve(project, '.cache/tests'); await mkdir(cache, {recursive: true});
  const temporary = await mkdtemp(resolve(cache, 'react-refresh-'));
  try {
    const build = resolve(temporary, 'default-build'), enabledBuild = resolve(temporary, 'isolated-build');
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: build});
    await command(['node_modules/@react-router/dev/bin.cjs', 'build'], {EAGLER_REACT_BUILD_DIRECTORY: enabledBuild,
      EAGLER_REACT_MOUNT_PATH: '/refresh-review/', EAGLER_REACT_APP_SHELL: 'isolated', EAGLER_REACT_APP_SHELL_ORIGIN: 'https://refresh.invalid'});
    const nextBuild = resolve(temporary, 'next-default'), nextEnabled = resolve(temporary, 'next-isolated');
    for (const [source, target] of [[build, nextBuild], [enabledBuild, nextEnabled]]) {
      await cp(resolve(source, 'client'), resolve(target, 'client'), {recursive: true});
      const notice = resolve(target, 'client/content/FIRST_USE_NOTICE.html');
      await writeFile(notice, await readFile(notice, 'utf8') + '\n<!-- bounded refresh fixture -->\n');
    }
    // A prior build-owned generated asset, deliberately absent from the next
    // artifact. Only this declared obsolete owner may be pruned on refresh.
    const oldManifest = await json(resolve(build, 'client/.vite/manifest.json'));
    oldManifest['refresh-old-css'] = {file: 'assets/refresh-retired.css'};
    const oldGraph = await json(resolve(build, 'client/.vite/react-app-shell-graph.json'));
    oldGraph.shellFiles.push('assets/refresh-retired.css'); oldGraph.shellFiles.sort();
    await writeFile(resolve(build, 'client/assets/refresh-retired.css'), '/* prior generated stylesheet */');
    await writeJson(resolve(build, 'client/.vite/manifest.json'), oldManifest);
    await writeJson(resolve(build, 'client/.vite/react-app-shell-graph.json'), oldGraph);
    await readReactFrontendArtifact({directory: resolve(build, 'client')});

    await writeSyntheticRuntimeRelease(resolve(temporary, 'runtime-release'));
    const assets = resolve(temporary, 'synthetic-assets'), artwork = resolve(temporary, 'empty-artwork');
    await mkdir(assets); await mkdir(artwork);
    for (const [name, contents] of [['th08.dat', 'synthetic retail DATA'], ['msgothic.ttc', 'synthetic font'], ['unifont.otf', 'synthetic font']]) await writeFile(resolve(assets, name), contents);
    await writeJson(resolve(temporary, 'features.json'), {schema: 'eagler-touhou/server-features/1', resourceMode: 'hosted', games: {th08: {languages: ['ja'], thprac: false}}});
    async function packageSite(output, selected, site = null) {
      await command(['scripts/package-server.mjs', `--output=${output}`, `--runtime-release=${resolve(temporary, 'runtime-release')}`,
        `--feature-config=${resolve(temporary, 'features.json')}`, '--profile=web-validation-react-refresh', '--games=th08', '--music=midi',
        `--artwork-dir=${artwork}`, `--th08-assets=${assets}`, `--font=${resolve(assets, 'unifont.otf')}`, `--vanilla-font=${resolve(assets, 'msgothic.ttc')}`,
        ...(site ? [`--site-url=${site}`] : [])], {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: selected});
    }
    const plain = resolve(temporary, 'plain'), isolated = resolve(temporary, 'isolated');
    await packageSite(plain, build);
    await packageSite(isolated, enabledBuild, 'https://refresh.invalid/refresh-review/');
    const refresh = (target, flags = [], extra = {}) => command(['scripts/refresh-deployment-app-shell.mjs', target, ...flags], extra);
    const verify = target => command(['scripts/verify-server-build.mjs', target], {EAGLER_FRONTEND: 'invalid-verifier-environment'});
    const selected = directory => ({EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: directory});

    await t.test('unset shell-only React refresh ignores inherited main contracts and uses current source without an artifact', async () => {
      const maintenance = resolve(temporary, 'maintenance-source'), target = resolve(temporary, 'stale-contract-target');
      for (const path of ['lib', 'package', 'product-catalog.mjs', 'config/workspace.json', 'host/lib/process.mjs',
        'scripts/refresh-deployment-app-shell.mjs', 'scripts/verify-server-build.mjs', 'src/contracts', 'src/app-shell-sw.js',
        'src/runtime-cache-sw.js', 'legacy/runtime-generation-reader.js',
        'tsconfig.launcher.json', 'tsconfig.contracts.json', 'package.json']) {
        await mkdir(resolve(maintenance, path, '..'), {recursive: true});
        await cp(resolve(project, path), resolve(maintenance, path), {recursive: true});
      }
      await symlink(resolve(project, 'node_modules'), resolve(maintenance, 'node_modules'), 'dir');
      const compiled = await ensureContractsBuild({project: maintenance});
      const inherited = resolve(maintenance, '.cache/build/browser/assets/contracts');
      await mkdir(resolve(inherited, '..'), {recursive: true});
      await cp(compiled.contractsDirectory, inherited, {recursive: true});
      const staleFacade = resolve(inherited, 'runtime-generations.mjs');
      await writeFile(staleFacade, await readFile(staleFacade, 'utf8') + '\nthrow new Error("STALE_MAIN_CONTRACT_CACHE");\n');
      await writeFile(resolve(inherited, 'runtime-generations-worker.js'), 'throw new Error("STALE_MAIN_WORKER_CACHE");');
      const inheritedBytes = await hashes(inherited);
      const canonical = resolve(maintenance, 'src/contracts/runtime-generations.mts');
      await writeFile(canonical, await readFile(canonical, 'utf8') + '\nexport const REACT_REFRESH_SOURCE_PROBE = "current-contracts";\n');
      const launcher = (await json(resolve(maintenance, 'config/workspace.json'))).repositories.launcher;
      await writeJson(resolve(maintenance, 'self-host-provenance.json'), {
        schema: 'eagler-touhou/self-host-bundle-provenance/1', launcherRepository: launcher,
        launcherSource: (await verifyReleaseManifest(isolated)).sources[launcher],
      });
      await cp(isolated, target, {recursive: true});
      const before = await hashes(target), deployment = await json(resolve(target, 'deployment.json'));
      const runMaintenance = args => execute(process.execPath, args, {cwd: maintenance,
        env: {...environment, EAGLER_REACT_BUILD_DIRECTORY: 'missing-source-artifact'}, maxBuffer: 16 * 1024 * 1024});
      await runMaintenance(['scripts/refresh-deployment-app-shell.mjs', target]);
      await verify(target);
      assert.match(await readFile(resolve(target, 'app-shell-sw.js'), 'utf8'), /REACT_REFRESH_SOURCE_PROBE/);
      assert.deepEqual(protectedFiles(await hashes(target)), protectedFiles(before));
      assert.deepEqual((await json(resolve(target, 'deployment.json'))).frontend, deployment.frontend);
      assert.deepEqual(await hashes(inherited), inheritedBytes, 'React must not rewrite inherited main cache bytes');
      await assert.rejects(lstat(resolve(maintenance, '.cache/build/ui-rewrite')), {code: 'ENOENT'});
      await assert.rejects(runMaintenance(['--input-type=module', '-e', "await import('./lib/contracts/runtime-generations.mjs')"]),
        /STALE_MAIN_CONTRACT_CACHE/, 'default main facade still prefers its existing full-Launcher cache');
    });

    await t.test('shell-only refresh uses the target graph and preserves disabled SW and game resources', async () => {
      const before = await hashes(plain), release = await verifyReleaseManifest(plain);
      await refresh(plain, [], {EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: resolve(temporary, 'missing-source')});
      await verify(plain);
      const deployment = await json(resolve(plain, 'deployment.json'));
      assert.equal(deployment.appShell, null);
      assert.ok(!deployment.files.some(item => item.path === 'app-shell-sw.js'));
      assert.deepEqual(protectedFiles(await hashes(plain)), protectedFiles(before));
      assert.deepEqual((await verifyReleaseManifest(plain)).parameters, release.parameters);
    });
    await t.test('explicit frontend refresh replaces only its owned graph and preserves Runtime DATA and provenance', async () => {
      const before = await hashes(plain), release = await verifyReleaseManifest(plain);
      await refresh(plain, ['--frontend'], selected(nextBuild));
      await verify(plain);
      const after = await hashes(plain), deployment = await json(resolve(plain, 'deployment.json'));
      assert.equal(after['assets/refresh-retired.css'], undefined);
      assert.notEqual(after['content/FIRST_USE_NOTICE.html'], before['content/FIRST_USE_NOTICE.html']);
      assert.deepEqual(protectedFiles(after), protectedFiles(before));
      assert.deepEqual((await verifyReleaseManifest(plain)).parameters, release.parameters);
      assert.equal(deployment.appShell, null);
      assert.deepEqual(deployment.frontend.validationMetadata, (await readReactFrontendArtifact({directory: resolve(nextBuild, 'client')})).metadata);
    });
    await t.test('isolated frontend refresh rebuilds its worker without changing origin mount or Runtime generation', async () => {
      const before = await hashes(isolated), old = await json(resolve(isolated, 'deployment.json'));
      await refresh(isolated, ['--frontend'], selected(nextEnabled));
      await verify(isolated);
      const current = await json(resolve(isolated, 'deployment.json'));
      assert.notEqual(current.appShell.buildId, old.appShell.buildId);
      assert.equal(current.siteUrl, old.siteUrl);
      assert.deepEqual(current.frontend.validationMetadata.graph.appShell, old.frontend.validationMetadata.graph.appShell);
      assert.deepEqual(protectedFiles(await hashes(isolated)), protectedFiles(before));
    });
    await t.test('publisher retained-generation pointer changes are validated then included in a coherent refreshed release', async () => {
      const retained = resolve(temporary, 'previous-release'), program = resolve(temporary, 'previous-program');
      await cp(isolated, retained, {recursive: true});
      const pointer = await readRuntimeManifest(isolated), group = pointer.groups[0];
      await cp(resolve(retained, group.root, group.current.generation), program, {recursive: true});
      const script = group.current.files.find(file => /\.[cm]?js$/.test(file.path)).path;
      await writeFile(resolve(program, script), await readFile(resolve(program, script), 'utf8') + '\n// another immutable Runtime generation\n');
      const previous = await writeRuntimeGeneration({site: retained, root: group.root, source: program,
        entry: group.current.entry, names: group.current.files.map(file => file.path)});
      await publishRuntimeManifest(retained, pointer.groups.map(value => value.root === group.root ? {...value, current: previous} : value));
      // Match the actual existing deployStaticSite caller: pointer/archive
      // retention precedes app-shell refresh, so old file hashes are stale.
      await publishRuntimeManifest(isolated, pointer.groups, {previousSite: retained});
      await verifyReleaseManifestDeclaration(isolated);
      await assert.rejects(verifyReleaseManifest(isolated), /release file mismatch: runtime-manifest.json/);
      const before = await hashes(isolated);
      await refresh(isolated);
      await verify(isolated);
      const current = await verifyRuntimePublication(isolated, await json(resolve(isolated, 'host-manifest.json')));
      assert.ok(current.groups.find(value => value.root === group.root).previous.some(value => value.generation === previous.generation));
      assert.deepEqual(protectedFiles(await hashes(isolated)), protectedFiles(before));
    });

    async function rejectsUntouched(name, source, {flags = [], extra = {}, mutate = async () => {}, after = async () => {}, expected, prefix = []}) {
      await t.test(name, async () => {
        const target = resolve(temporary, name.replaceAll(/[^a-z0-9]+/gi, '-'));
        await cp(source, target, {recursive: true}); await mutate(target);
        const before = await hashes(target);
        await assert.rejects(command([...prefix, 'scripts/refresh-deployment-app-shell.mjs', target, ...flags],
          {...extra, FAIL_REFRESH_ROOT: target}), expected);
        assert.deepEqual(await hashes(target), before);
        await after(target);
        assert.ok((await readdir(temporary)).every(name => !name.startsWith('.' + target.split('/').at(-1) + '.refresh-')));
      });
    }
    await rejectsUntouched('frontend replacement requires explicit React selection', plain, {flags: ['--frontend'], expected: /requires explicit EAGLER_FRONTEND=react/});
    await rejectsUntouched('wrong isolated site URL cannot change the target', isolated, {flags: ['--frontend', '--site-url=https://other.invalid/refresh-review/'], extra: selected(nextEnabled), expected: /exact isolated origin and mount/});
    await rejectsUntouched('different artifact mount cannot replace frontend', plain, {flags: ['--frontend'], extra: selected(nextEnabled), expected: /does not match the selected mount/});
    await rejectsUntouched('missing artifact cannot modify deployment', plain, {flags: ['--frontend'], extra: selected(resolve(temporary, 'missing')), expected: /artifact is missing/});
    async function permissionArtifact(source, destination, permission) {
      await cp(resolve(source, 'client'), resolve(destination, 'client'), {recursive: true});
      const graph = await json(resolve(destination, 'client/.vite/react-app-shell-graph.json'));
      graph.appShell = permission; await writeJson(resolve(destination, 'client/.vite/react-app-shell-graph.json'), graph);
      for (const entry of ['index.html', 'en.html', 'lobby.html']) {
        const path = resolve(destination, 'client', entry);
        let html = (await readFile(path, 'utf8')).replace(/<meta[^>]+name="eagler-react-app-shell"[^>]*>/g, '');
        const encoded = JSON.stringify(permission).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        html = html.replace('</head>', `<meta name="eagler-react-app-shell" content="${encoded}"></head>`);
        await writeFile(path, html);
      }
      await readReactFrontendArtifact({directory: resolve(destination, 'client')});
    }
    const enabledRoot = resolve(temporary, 'unexpected-worker-permission');
    await permissionArtifact(nextBuild, enabledRoot, {schema: 'eagler-touhou/react-app-shell/1', origin: 'http://localhost:4173', mountPath: '/'});
    await rejectsUntouched('frontend refresh cannot silently enable a disabled worker', plain, {flags: ['--frontend'], extra: selected(enabledRoot), expected: /must preserve the deployment's App Shell permission/});
    const movedOrigin = resolve(temporary, 'unexpected-worker-origin');
    await permissionArtifact(nextEnabled, movedOrigin, {schema: 'eagler-touhou/react-app-shell/1', origin: 'https://other.invalid', mountPath: '/refresh-review/'});
    await rejectsUntouched('frontend refresh cannot change the isolated worker origin', isolated, {flags: ['--frontend'], extra: selected(movedOrigin), expected: /must preserve the deployment's App Shell permission/});

    await rejectsUntouched('unowned mutable frontend input cannot be blessed by refresh', plain, {mutate: target => writeFile(resolve(target, 'unexpected.js'), 'globalThis.unowned=true'), expected: /unowned refresh source file/});
    for (const temporaryPath of ['.tmp', 'assets/.tmp']) {
      const outside = resolve(temporary, 'outside-' + temporaryPath.replaceAll('/', '-'));
      await mkdir(outside); await writeFile(resolve(outside, 'sentinel'), 'outside remains unchanged');
      const before = await hashes(outside);
      await rejectsUntouched('temporary symlink ' + temporaryPath + ' cannot escape staging', isolated, {mutate: async target => {
        await rm(resolve(target, temporaryPath), {recursive: true, force: true});
        await symlink(outside, resolve(target, temporaryPath), 'dir');
      }, after: async () => assert.deepEqual(await hashes(outside), before), expected: /temporary path must be an ordinary directory/});
    }
    await rejectsUntouched('fake Runtime archive cannot borrow another generation descriptor', isolated, {mutate: async target => {
      const group = (await readRuntimeManifest(target)).groups[0];
      const fake = resolve(target, group.root, '0'.repeat(64)); await mkdir(fake);
      await cp(resolve(target, group.root, group.current.generation, 'runtime-generation.json'), resolve(fake, 'runtime-generation.json'));
      await writeFile(resolve(fake, 'unowned.js'), 'globalThis.unowned=true');
    }, expected: /Runtime archive directory identity mismatch/});
    await rejectsUntouched('extra file inside a valid Runtime generation is rejected', isolated, {mutate: async target => {
      const group = (await readRuntimeManifest(target)).groups[0];
      await writeFile(resolve(target, group.root, group.current.generation, 'unowned.js'), 'globalThis.unowned=true');
    }, expected: /Unexpected Runtime generation file/});
    await rejectsUntouched('existing immutable Runtime byte drift cannot be blessed by refresh', plain, {mutate: async target => {
      const deployment = await json(resolve(target, 'deployment.json'));
      const path = deployment.files.find(item => /^runtime\/.+\.wasm$/.test(item.path)).path;
      await writeFile(resolve(target, path), 'corrupt immutable Runtime');
      await verifyReleaseManifestDeclaration(target);
      await assert.rejects(verifyReleaseManifest(target), /release file mismatch/);
    }, expected: /refresh source file differs from Release Manifest/});
    await rejectsUntouched('original release declaration corruption is rejected before writes', plain, {mutate: async target => {
      const release = await json(resolve(target, 'release-manifest.json')); release.parameters.resourceMode = 'external';
      await writeJson(resolve(target, 'release-manifest.json'), release);
      await assert.rejects(verifyReleaseManifestDeclaration(target), /release manifest identity mismatch/);
      await assert.rejects(verifyReleaseManifest(target), /release manifest identity mismatch/);
    }, expected: /release manifest identity mismatch/});

    const invalid = resolve(temporary, 'structurally-invalid-artifact'); await cp(resolve(nextBuild, 'client'), resolve(invalid, 'client'), {recursive: true});
    for (const entry of await readdir(resolve(invalid, 'client/assets'))) if (entry.endsWith('.js')) {
      const path = resolve(invalid, 'client/assets', entry), contents = await readFile(path, 'utf8');
      if (contents.includes('originMigrationOpen')) await writeFile(path, contents.replaceAll('originMigrationOpen', 'missingMigrationOpen'));
    }
    await rejectsUntouched('candidate verifier failure preserves the complete original deployment', plain, {flags: ['--frontend'], extra: selected(invalid), expected: /React UI is missing its inert Host Manifest governed origin migration entry/});
    const preload = resolve(temporary, 'fail-final-rename.mjs');
    await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\nconst rename = fs.promises.rename; fs.promises.rename = async (from, to) => {if (String(from).includes('.refresh-candidate-') && String(to) === process.env.FAIL_REFRESH_ROOT) throw new Error('injected final refresh rename failure'); return rename(from, to);}; syncBuiltinESMExports();\n`);
    await rejectsUntouched('failed candidate rename restores every original deployment byte', plain, {prefix: ['--import', preload], expected: /injected final refresh rename failure/});
    await t.test('failed rollback preserves the original backup and reports its recovery path', async () => {
      const target = resolve(temporary, 'double-rename-failure'); await cp(plain, target, {recursive: true});
      const before = await hashes(target), failBoth = resolve(temporary, 'fail-both-renames.mjs');
      await writeFile(failBoth, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const rename = fs.promises.rename; fs.promises.rename = async (from, to) => {if (String(to) === process.env.FAIL_REFRESH_ROOT && /\\.refresh-(?:candidate|previous)-/.test(String(from))) throw new Error('injected replacement and rollback failure'); return rename(from, to);}; syncBuiltinESMExports();\n`);
      await assert.rejects(command(['--import', failBoth, 'scripts/refresh-deployment-app-shell.mjs', target], {FAIL_REFRESH_ROOT: target}), /original deployment retained at/);
      await assert.rejects(lstat(target), {code: 'ENOENT'});
      const names = (await readdir(temporary)).filter(name => name.startsWith('.double-rename-failure.refresh-'));
      assert.equal(names.length, 1); assert.match(names[0], /refresh-previous-/);
      assert.deepEqual(await hashes(resolve(temporary, names[0])), before);
      await rename(resolve(temporary, names[0]), target);
    });
  } finally {await rm(temporary, {recursive: true, force: true});}
});
