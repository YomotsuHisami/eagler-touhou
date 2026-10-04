/** Opt-in, offline-capable React publication assembly. Never modifies its input
 * deployment, deploys bytes, registers a worker, or migrates browser storage. */
import {createHash, randomUUID} from 'node:crypto';
import {cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve, sep} from 'node:path';
import {installUiFrontend,UI_PUBLICATION_SCHEMA} from './ui-frontend.mjs';
import {readUiArtifact} from './ui-artifact.mjs';
import {verifyReleaseManifest, writeReleaseManifest} from './release-manifest.mjs';
import {verifyRuntimePublication} from './runtime-generations.mjs';
import {createUiDeploymentContract,uiNginxNavigation} from '../scripts/ui-deployment-contract.mjs';
import {normalizeUiBuildMountPath} from '../scripts/ui-build-config.mjs';

export {UI_PUBLICATION_SCHEMA};
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
export {uiNginxNavigation} from '../scripts/ui-deployment-contract.mjs';

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
  if (deployment.format !== 'eagler-touhou-deployment/1' || !['hosted', 'external', 'import'].includes(deployment.resourceMode)) throw new Error('Source must be an existing hosted/external/import deployment');
  const expected = sourceFiles.filter(file => !metadata.has(file.path));
  if (JSON.stringify(expected) !== JSON.stringify([...deployment.files].sort((a, b) => a.path.localeCompare(b.path, 'en')))) throw new Error('Source deployment inventory does not match its tree');
  const host = JSON.parse(await readFile(resolve(sourceRoot, 'host-manifest.json'), 'utf8'));
  await verifyRuntimePublication(sourceRoot, host);
  if (deployment.resourceMode === 'external' && sourceFiles.some(file => /^(games|shared)\//.test(file.path))) throw new Error('External input contains redirect-owned resource bytes');
  const artifact=await readUiArtifact(uiRoot);
  if(artifact.mountPath!==mountPath)throw Error('UI build mount metadata does not match publication mount');
  const contract=artifact.navigation;
  const candidate = resolve(dirname(outputRoot), `.${basename(outputRoot)}.ui-${randomUUID()}`);
  try {
    await cp(sourceRoot, candidate, {recursive: true, errorOnExist: true, force: false});
    // Build-owned files only. Preserve host artwork even when the UI contains a
    // same-name generic asset, and refuse executable collisions with the host.
    const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]));
    for (const file of artifact.files) {
      const existing=sourceByPath.get(file.path);
      if(file.path.startsWith('assets/') && existing && existing.sha256!==file.sha256)throw Error(`UI asset collides with preserved host file: ${file.path}`);
    }
    const shell=await installUiFrontend(candidate,{artifact,hostManifest:host,status:'experimental-opt-in',baseReleaseId:base.releaseId,siteUrl:deployment.siteUrl,supplementalShellFiles:[]});
    // Loopback preview consumes this private report; default host output omits it.
    await cp(resolve(uiRoot,'ui-ownership.json'),resolve(candidate,'ui-ownership.json'));
    const publication=shell.publication;
    // Prove every source file outside the explicit shell overlay is unchanged.
    const replaced = new Set([...uiFiles.map(file => file.path), ...contract.legacyEntries.map(path => path.slice(1)), 'app-shell-sw.js','ui-publication.json','ui-navigation.nginx.conf']);
    const files = await inventory(candidate);
    const resultByPath = new Map(files.map(file => [file.path, file]));
    for (const file of artifact.files.filter(file=>file.path!=='index.html')) if (resultByPath.get(file.path)?.sha256 !== file.sha256) throw new Error(`UI input changed during assembly: ${file.path}`);
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
