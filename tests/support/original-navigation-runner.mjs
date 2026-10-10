import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';
import {STATIC_FRONTEND_PACKAGE_FILES} from '../../lib/frontend-static-manifest.mjs';
import {createLauncherStaticServer} from './launcher-static-server.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://fixture.invalid/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// These are existing test interfaces, not new scenarios. The first three files
// are byte-identical to pinned main edee9633; edge has only its reviewed server
// command adapter. Updating a source fence requires a separate adoption review.
export const ORIGINAL_NAVIGATION_CASES = Object.freeze({
  'touch-settings': {path: 'tests/test-touch-settings-browser.py', mode: 'positional', command: 'python',
    sha256: '79c4f62f6e3768d889b6194b94882737a7100ea2d728e8576a0681de4a9bdfb0'},
  'card-navigation': {path: 'tests/test-card-filter-browser.py', mode: 'positional', command: 'python',
    sha256: '1d87930a6d0b12fae07d6008bad046d2d0ae9297665fb537eccc43289f2e99fd'},
  'localized-entry': {path: 'tests/test-localized-entry-browser.mjs', mode: 'url-option', command: process.execPath,
    sha256: 'f312ee6236e6f97a9565e25a475c43fa1ae5a699da33880e1e7b1403b6e95b00'},
  'edge-drawers': {path: 'tests/browser/test-edge-drawers.py', mode: 'own-server', command: 'python',
    sha256: '46cc4fd6052392089ccc4c53a909e709c58831f5dceafd92067d2334eb592818'},
});

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) visit(child, callback);
}
function localPath(value) {
  if (!value || value.startsWith('#')) return null;
  const url = new URL(value, origin);
  return url.origin === new URL(origin).origin ? decodeURIComponent(url.pathname).replace(/^\//, '') : null;
}
async function confinedBytes(root, path) {
  try {
    const file = await realpath(resolve(root, path));
    if (!file.startsWith(root + sep)) throw new Error(`Navigation artifact escapes root: ${path}`);
    if (!(await stat(file)).isFile()) return null;
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}
async function inspectFile(root, path) {
  const bytes = await confinedBytes(root, path);
  return bytes === null ? null : {path, bytes: bytes.length, sha256: digest(bytes)};
}

/** Read-only setup inventory. It opens no socket, spawns no process and never
 * starts a browser. Missing artwork/metadata is reported, never fabricated. */
export async function prepareOriginalNavigation({root: selectedRoot, caseName}) {
  const entry = ORIGINAL_NAVIGATION_CASES[caseName];
  if (!entry) throw new Error(`Unknown original navigation case: ${caseName}`);
  if (!selectedRoot) throw new Error('An explicit built --root is required');
  const root = await realpath(resolve(project, selectedRoot));
  const testBytes = await readFile(resolve(project, entry.path));
  if (digest(testBytes) !== entry.sha256) throw new Error(`Original navigation source fence changed: ${entry.path}`);
  const required = new Set(STATIC_FRONTEND_PACKAGE_FILES), artwork = new Set();
  for (const name of ['index.html', 'en.html', 'lobby.html']) {
    const bytes = await confinedBytes(root, name);
    if (bytes === null) throw new Error(`Missing navigation entry: ${name}`);
    const document = parse(bytes.toString('utf8'));
    visit(document, node => {
      const attrs = Object.fromEntries((node.attrs || []).map(({name, value}) => [name, value]));
      if (node.tagName === 'meta' && attrs.name === 'eagler-react-app-shell') {
        throw new Error('Navigation runner needs the default non-App-Shell output; exact-origin PWA builds use the original PWA harness');
      }
      if (node.tagName === 'script' && attrs.src) {const path = localPath(attrs.src); if (path) required.add(path);}
      if (node.tagName === 'link' && ['stylesheet', 'modulepreload', 'preload', 'manifest'].includes(attrs.rel)) {
        const path = localPath(attrs.href); if (path) required.add(path);
      }
      const visitsDocument = name === 'index.html' || caseName === 'localized-entry' && name === 'en.html';
      if (visitsDocument && node.tagName === 'img' && attrs.src) {const path = localPath(attrs.src); if (path) artwork.add(path);}
      if (visitsDocument && node.tagName === 'link' && ['icon', 'apple-touch-icon'].includes(attrs.rel)) {
        const path = localPath(attrs.href); if (path) artwork.add(path);
      }
    });
  }
  const artifacts = await Promise.all([...required].sort().map(async path => ({path, file: await inspectFile(root, path)})));
  const images = await Promise.all([...artwork].sort().map(async path => ({path, file: await inspectFile(root, path)})));
  const metadata = await Promise.all(['host-manifest.json', 'release-catalog.json', 'runtime-manifest.json'].map(async path => ({path, file: await inspectFile(root, path)})));
  const missingRequiredArtifacts = artifacts.filter(item => !item.file).map(item => item.path);
  const missingArtwork = images.filter(item => !item.file).map(item => item.path);
  const missingMetadata = metadata.filter(item => !item.file && item.path !== 'runtime-manifest.json').map(item => item.path);
  const blockingReasons = missingRequiredArtifacts.map(path => `Missing canonical entry/static artifact: ${path}`);
  // Original locale test collects every console error (lines 12/45). The
  // other cases do not assert a clean console and never launch a Runtime: main and
  // React both retain local product/settings fallback when metadata is absent.
  if (caseName === 'localized-entry') {
    blockingReasons.push(...missingMetadata.map(path => `Original clean-console expectation needs the fetched metadata file: ${path}`));
    blockingReasons.push(...missingArtwork.map(path => `Clean-console fixture advertises missing document artwork: ${path}`));
  }
  return {caseName, root, entry: {...entry}, browserExecuted: false,
    staticInventoryComplete: missingRequiredArtifacts.length === 0,
    readyForExecution: false,
    readinessStatus: blockingReasons.length ? 'blocked-on-fixture-inputs' : 'browser-prerequisites-unverified',
    blockingReasons,
    readinessReasons: [...blockingReasons, 'Browser authorization, executable availability and full browser request graph are not checked by preflight'],
    metadataMode: missingMetadata.length ? 'local-product-settings-fallback' : 'metadata-files-present-content-not-validated',
    missingBusinessMetadata: missingMetadata,
    nativeRuntimeRequiredBySelectedScenario: false,
    requiredArtifacts: artifacts.filter(item => item.file).map(item => item.file),
    missingRequiredArtifacts,
    missingArtwork,
    metadata: metadata.map(item => ({path: item.path, present: !!item.file, ...(item.file || {})})),
    scope: 'Read-only entry/static artifact inventory. Artwork inventory covers document references only, not client-rendered cards. No rendering, full import-graph, History, browser, native input or PWA result'};
}

/** Close the owned loopback listener on callback failure as well as success. */
export async function withOriginalNavigationServer(root, action) {
  const server = await createLauncherStaticServer(root);
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {server.removeListener('error', reject); resolveReady();});
  });
  try {return await action(`http://127.0.0.1:${server.address().port}/`);}
  finally {
    await new Promise((resolveClosed, reject) => {
      server.close(error => error ? reject(error) : resolveClosed());
      server.closeAllConnections();
    });
  }
}

export function originalNavigationCommand(plan, url) {
  if (plan.entry.mode !== 'own-server' && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url || '')) throw new Error('Original navigation target must be its allocated loopback URL');
  const args = [plan.entry.path];
  if (plan.entry.mode === 'positional') args.push(url);
  else if (plan.entry.mode === 'url-option') args.push(`--url=${url}`);
  return {command: plan.entry.command, args};
}
async function execute(plan, url) {
  const {command, args} = originalNavigationCommand(plan, url);
  const env = {...process.env, EAGLER_LAUNCHER_TEST_ROOT: plan.root};
  // Supplied root is already assembled. Do not inherit a hidden second fixture
  // generator for the edge test's own server or alter browser executable options.
  delete env.EAGLER_LAUNCHER_FIXTURE_INPUTS;
  await new Promise((resolveDone, reject) => {
    const child = spawn(command, args, {cwd: project, env, stdio: 'inherit', shell: false});
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const cleanup = () => {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);};
    child.once('error', error => {cleanup(); reject(error);});
    child.once('exit', (code, signal) => {cleanup(); code === 0 ? resolveDone() : reject(new Error(`${plan.entry.path} failed (${signal || code})`));});
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !arg.startsWith('--root=') && !arg.startsWith('--case=') && arg !== '--run')) throw new Error('usage: original-navigation-runner.mjs --root=BUILT_ROOT --case=CASE [--run]');
  const plan = await prepareOriginalNavigation({root: args.find(arg => arg.startsWith('--root='))?.slice(7), caseName: args.find(arg => arg.startsWith('--case='))?.slice(7)});
  if (!args.includes('--run')) {
    console.log(JSON.stringify({...plan, mode: 'preflight-only', execution: 'not_run'}, null, 2));
    if (plan.blockingReasons.length) process.exitCode = 1;
  }
  else {
    if (plan.blockingReasons.length) throw new Error(plan.blockingReasons.join('\n'));
    if (plan.missingBusinessMetadata.length) console.warn(`Original UI-only case uses local product/settings fallback; metadata absent: ${plan.missingBusinessMetadata.join(', ')}`);
    if (plan.missingArtwork.length) console.warn(`Original artwork is missing; no replacement supplied: ${plan.missingArtwork.join(', ')}`);
    if (plan.entry.mode === 'own-server') await execute(plan);
    else await withOriginalNavigationServer(plan.root, url => execute(plan, url));
  }
}
