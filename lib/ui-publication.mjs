/** Opt-in, offline-capable React publication assembly. Never modifies its input
 * deployment, deploys bytes, registers a worker, or migrates browser storage. */
import {createHash, randomUUID} from 'node:crypto';
import {cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parse} from 'parse5';
import {buildAppShell} from './app-shell-build.mjs';
import {verifyReleaseManifest, writeReleaseManifest} from './release-manifest.mjs';
import {verifyRuntimePublication} from './runtime-generations.mjs';
import {createUiDeploymentContract} from '../scripts/ui-deployment-contract.mjs';
import {normalizeUiBuildMountPath} from '../scripts/ui-build-config.mjs';
import {PRODUCT_GAMES} from './contracts/product-catalog.mjs';

export const UI_PUBLICATION_SCHEMA = 'eagler-touhou/ui-publication/1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const metadata = new Set(['deployment.json', 'release-manifest.json', 'checksums.txt']);
function safePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) || path.split('/').some(part => !part || part.startsWith('.'))) throw new Error(`Unsafe publication path: ${path}`);
  return path;
}
async function inventory(root) {
  const files = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      // Runtime freezing leaves an empty staging directory, never publish its
      // contents or overlook an interrupted writer.
      if (entry.name === '.tmp' && !prefix && entry.isDirectory() && !(await readdir(resolve(directory, entry.name))).length) continue;
      const path = safePath(prefix + entry.name);
      if (entry.isDirectory()) await visit(resolve(directory, entry.name), path + '/');
      else {
        if (!entry.isFile()) throw new Error(`Publication requires ordinary files: ${path}`);
        const bytes = await readFile(resolve(root, path));
        files.push({path, bytes: bytes.length, sha256: sha(bytes)});
      }
    }
  }
  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function frameworkBuild(html, files, mountPath) {
  // Audit actual emitted Framework state, not a separate helper's mount tests.
  const context = /window\.__reactRouterContext\s*=\s*(\{[\s\S]*?\});/.exec(html);
  let state;
  try { state = JSON.parse(context?.[1]); } catch { /* Fail closed below. */ }
  if (state?.basename !== mountPath || state?.isSpaMode !== true) throw new Error('UI input must be a React Router Framework SPA built for the requested mount');
  const paths = new Set(files.map(file => file.path));
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs || []).map(({name, value}) => [name, value]));
    for (const value of [attrs.src, attrs.href].filter(Boolean)) {
      if (value.startsWith(`${mountPath}assets/`)) {
        const path = new URL(value, 'https://ui.invalid/').pathname.slice(mountPath.length);
        if (!paths.has(path)) throw new Error(`Framework HTML references missing asset: ${path}`);
      } else if ((node.tagName === 'script' && attrs.src) || (node.tagName === 'link' && ['stylesheet', 'modulepreload'].includes(attrs.rel))) {
        throw new Error(`Framework executable/style URL must match its build mount: ${value}`);
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
}

/** Nginx include fragment, deliberately not installed by the assembler.
 * Keep existing /games/, /shared/, immutable Runtime and missing-file policies.
 * Include before broad regex locations, inside the same root server block. */
export function uiNginxNavigation(contract) {
  const checked = createUiDeploymentContract(contract);
  normalizeUiBuildMountPath(checked.mountPath);
  const patterns = checked.patterns.filter(path => path !== '/' && !path.endsWith('.html'));
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = checked.mountPath.slice(0, -1);
  const route = patterns.map(path => (prefix + path).split('/').map(part => part.startsWith(':') ? '[A-Za-z0-9_-]+' : escape(part)).join('/')).join('|');
  return '# Opt-in UI only; do not replace /games/, /shared/, or Runtime locations.\n' +
    `location = ${checked.mountPath}ui-ownership.json { return 404; }\n` +
    `location ~ "^(?:${route})/?$" {\n    limit_except GET HEAD { deny all; }\n    if ($http_accept !~* "text/html") { return 404; }\n    add_header Cache-Control "no-cache";\n    try_files $uri ${checked.mountPath}index.html;\n}\n`;
}

export async function assembleUiPublication({sourceRoot, uiRoot, outputRoot, mountPath = '/'} = {}) {
  if (!sourceRoot || !uiRoot || !outputRoot) throw new Error('Explicit sourceRoot, uiRoot and outputRoot are required');
  mountPath = normalizeUiBuildMountPath(mountPath);
  sourceRoot = await realpath(resolve(sourceRoot)); uiRoot = await realpath(resolve(uiRoot));
  outputRoot = resolve(outputRoot);
  outputRoot = resolve(await realpath(dirname(outputRoot)), basename(outputRoot));
  for (const input of [sourceRoot, uiRoot]) if (outputRoot === input || outputRoot.startsWith(input + sep) || input.startsWith(outputRoot + sep)) throw new Error('Publication output must be separate from both inputs');
  try { await lstat(outputRoot); throw new Error('Publication output already exists; choose a fresh directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Enumerate before reading manifests so symlinks cannot expand input scope.
  const [sourceFiles, uiFiles] = await Promise.all([inventory(sourceRoot), inventory(uiRoot)]);
  const base = await verifyReleaseManifest(sourceRoot);
  const deployment = JSON.parse(await readFile(resolve(sourceRoot, 'deployment.json'), 'utf8'));
  if (deployment.format !== 'eagler-touhou-deployment/1' || !['hosted', 'external', 'import'].includes(deployment.resourceMode) || deployment.uiPublication) throw new Error('Source must be an existing legacy hosted/external/import deployment');
  const expected = sourceFiles.filter(file => !metadata.has(file.path));
  if (JSON.stringify(expected) !== JSON.stringify([...deployment.files].sort((a, b) => a.path.localeCompare(b.path, 'en')))) throw new Error('Source deployment inventory does not match its tree');
  const host = JSON.parse(await readFile(resolve(sourceRoot, 'host-manifest.json'), 'utf8'));
  await verifyRuntimePublication(sourceRoot, host);
  if (deployment.resourceMode === 'external' && sourceFiles.some(file => /^(games|shared)\//.test(file.path))) throw new Error('External input contains redirect-owned resource bytes');
  const ownership = JSON.parse(await readFile(resolve(uiRoot, 'ui-ownership.json'), 'utf8'));
  if (ownership.schema !== 'eagler-touhou/ui-ownership/1' || ownership.legacyLauncherIncluded !== false || ownership.nodeBuiltinsIncluded !== false) throw new Error('UI ownership proof missing');
  const navigation = JSON.parse(await readFile(resolve(uiRoot, 'ui-navigation.json'), 'utf8'));
  if (navigation.schema !== 'eagler-touhou/ui-navigation/1') throw new Error('UI navigation proof missing');
  const contract = createUiDeploymentContract({patterns: navigation.patterns, mountPath});
  let buildMetadata;
  try {buildMetadata = JSON.parse(await readFile(resolve(uiRoot, 'ui-build.json'), 'utf8'));}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  if ((buildMetadata && (buildMetadata.schema !== 'eagler-touhou/ui-build/1' || buildMetadata.mountPath !== mountPath)) || (!buildMetadata && mountPath !== '/')) throw new Error('UI build mount metadata does not match publication mount');
  for (const file of uiFiles) if (!['index.html', 'ui-build.json', 'ui-ownership.json', 'ui-navigation.json', 'NOTICE.txt', 'content/FIRST_USE_NOTICE.html', 'content/MULTIPLAYER.html'].includes(file.path) && !file.path.startsWith('assets/')) throw new Error(`UI build attempts to own non-UI file: ${file.path}`);
  const names = new Set(uiFiles.map(file => file.path));
  for (const path of [...ownership.assets || [], ...ownership.chunks || []]) if (!names.has(safePath(path))) throw new Error(`Owned UI asset missing: ${path}`);
  const html = await readFile(resolve(uiRoot, 'index.html'), 'utf8');
  frameworkBuild(html, uiFiles, mountPath);
  const candidate = resolve(dirname(outputRoot), `.${basename(outputRoot)}.ui-${randomUUID()}`);
  try {
    await cp(sourceRoot, candidate, {recursive: true, errorOnExist: true, force: false});
    // Build-owned files only. Preserve host artwork even when the UI contains a
    // same-name generic asset, and refuse executable collisions with the host.
    const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]));
    for (const file of uiFiles) {
      const existing = sourceByPath.get(file.path);
      if (file.path.startsWith('assets/') && existing && existing.sha256 !== file.sha256) throw new Error(`UI asset collides with preserved host file: ${file.path}`);
      await mkdir(dirname(resolve(candidate, file.path)), {recursive: true});
      await cp(resolve(uiRoot, file.path), resolve(candidate, file.path));
    }
    for (const alias of contract.legacyEntries) await writeFile(resolve(candidate, alias.slice(1)), html);
    // The registration gate must itself be integrity-cached for offline boot.
    // Its identity is independent of the worker to avoid a circular SW hash.
    const marker = {
      schema: UI_PUBLICATION_SCHEMA, status: 'experimental-opt-in', mountPath, worker: 'app-shell-sw.js',
      baseReleaseId: base.releaseId, uiBuild: {sha256: sha(json(uiFiles)), files: uiFiles},
      navigation: contract,
      originMigration: host.shared?.originMigration?.mode === 'http-to-https' ? {mode: 'http-to-https'} : null,
      artwork: Object.fromEntries(Object.entries(PRODUCT_GAMES).flatMap(([game, product]) => {
        const path = product.cardArtwork && `assets/${product.cardArtwork}`, identity = path && sourceByPath.get(path);
        return identity ? [[game, {path, bytes: identity.bytes, sha256: identity.sha256}]] : [];
      })),
      storage: {runtime: 'unchanged', packages: 'unchanged', saves: 'unchanged'},
    };
    await writeFile(resolve(candidate, 'ui-publication.json'), json(marker));
    const shellFiles = [...new Set([...uiFiles.map(file => file.path).filter(path => path !== 'ui-ownership.json'), ...contract.legacyEntries.map(path => path.slice(1)), 'ui-publication.json', ...Object.values(marker.artwork).map(item => item.path)])];
    // Keep Framework tooling out of the portable legacy self-host dependency
    // closure. Only this opt-in assembler bundles the existing pure resolver.
    const navigation = await build({
      stdin: {contents: `import {uiNavigationFallback} from './scripts/ui-deployment-contract.mjs';\nself.__EAGLER_UI_NAVIGATION_FALLBACK = (request, scopeUrl) => uiNavigationFallback(request, {contract:${JSON.stringify(contract)}, scopeUrl});`, resolveDir: fileURLToPath(new URL('../', import.meta.url))},
      bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    });
    const shell = await buildAppShell({globDirectory: candidate, swDest: resolve(candidate, 'app-shell-sw.js'), appShellFiles: shellFiles, workerPrelude: navigation.outputFiles[0].text, quiet: true});
    if (shell.warnings.length) throw new Error(`Incomplete UI precache: ${shell.warnings.join('; ')}`);
    const entryNames = new Set(shell.manifestEntries.map(entry => entry.url));
    if (shellFiles.some(path => !entryNames.has(path))) throw new Error('UI file omitted from generated precache');
    const publication = {...marker, appShell: shell.contract};
    // Prove every source file outside the explicit shell overlay is unchanged.
    const replaced = new Set([...uiFiles.map(file => file.path), ...contract.legacyEntries.map(path => path.slice(1)), 'app-shell-sw.js']);
    const files = await inventory(candidate);
    const resultByPath = new Map(files.map(file => [file.path, file]));
    for (const file of uiFiles) if (resultByPath.get(file.path)?.sha256 !== file.sha256) throw new Error(`UI input changed during assembly: ${file.path}`);
    for (const file of sourceFiles) if (!replaced.has(file.path) && !metadata.has(file.path) && resultByPath.get(file.path)?.sha256 !== file.sha256) throw new Error(`Publication changed preserved file: ${file.path}`);
    deployment.generatedAt = new Date().toISOString(); deployment.appShell = shell.contract;
    deployment.uiPublication = {schema: UI_PUBLICATION_SCHEMA, manifest: 'ui-publication.json', status: 'experimental-opt-in'};
    deployment.files = files.filter(file => !metadata.has(file.path));
    await writeFile(resolve(candidate, 'deployment.json'), json(deployment));
    await writeReleaseManifest(candidate, {profile: base.profile, sources: base.sources,
      parameters: {...base.parameters, experimentalUi: {baseReleaseId: base.releaseId, artifactSha256: publication.uiBuild.sha256}}});
    await verifyReleaseManifest(candidate);
    await verifyRuntimePublication(candidate, host);
    await rename(candidate, outputRoot);
    return {outputRoot, buildId: shell.buildId, shellFiles: shell.count, publication, nginxNavigation: uiNginxNavigation(contract)};
  } finally { await rm(candidate, {recursive: true, force: true}); }
}
