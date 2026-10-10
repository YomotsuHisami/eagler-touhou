/** Actual shared Package modules at their original browser URLs. Test setup
 * only: no Launcher entry, Host declaration, fake game, or storage substitute. */
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, posix, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';
import {ensureContractsBuild} from '../../lib/contracts-build.mjs';
import {browserModuleClosure} from '../../lib/browser-module-graph.mjs';
import {assertSafeDevelopmentServerScope} from '../../lib/development-server-scope.mjs';

const defaultProject = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const entries = ['package/package-installer.mjs', 'package/package-launcher.mjs', 'package/package-store.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function relativePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid Package fixture path: ${path}`);
  }
  return path;
}
async function ordinaryBytes(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`Package fixture input must be an ordinary file: ${path}`);
  return readFile(path);
}
function resourcePath(from, value) {
  if (/^(?:data:|https?:|#)/i.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0];
  return relativePath(posix.normalize(posix.join(posix.dirname(from), path)));
}

export async function preparePackageModuleFixture({project = defaultProject} = {}) {
  project = resolve(project);
  // Uses canonical current source identity, including a verified cache when
  // current. It never reads the inherited full-Launcher compiler cache.
  const contracts = await ensureContractsBuild({project});
  if (contracts.mode !== 'source' || !contracts.inputHash) throw new Error('Package module fixture requires verified canonical source contracts');
  const contractNames = new Set((await readdir(contracts.contractsDirectory)).filter(name => name.endsWith('.mjs')));
  const resolveModule = path => {
    relativePath(path);
    if (path.startsWith('package/')) return resolve(project, path);
    if (contractNames.has(path)) return resolve(contracts.contractsDirectory, path);
    throw new Error(`Package fixture dependency is outside the canonical module scope: ${path}`);
  };
  const modules = await browserModuleClosure({root: project, entries, resolveFile: resolveModule});
  const inputs = new Map(), optionalMissing = [];
  for (const path of modules) inputs.set(path, {source: resolveModule(path), bytes: await ordinaryBytes(resolveModule(path))});
  const document = 'faq.html', source = resolve(project, 'public', document);
  const html = await ordinaryBytes(source); inputs.set(document, {source, bytes: html});
  const pending = [];
  function visit(node) {
    if (node.tagName === 'link') {
      const attributes = Object.fromEntries((node.attrs || []).map(item => [item.name, item.value]));
      if (attributes.href && ['stylesheet', 'preload', 'icon'].includes(attributes.rel)) {
        const path = resourcePath(document, attributes.href);
        if (path) pending.push({path, optional: attributes.rel === 'icon'});
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html.toString('utf8')));
  while (pending.length) {
    const {path, optional} = pending.shift(); if (inputs.has(path)) continue;
    const source = resolve(project, 'public', relativePath(path));
    let bytes;
    try {bytes = await ordinaryBytes(source);}
    catch (error) {if (optional && error.code === 'ENOENT') {optionalMissing.push(path); continue;} throw error;}
    inputs.set(path, {source, bytes});
    if (path.endsWith('.css')) {
      for (const match of bytes.toString('utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const dependency = resourcePath(path, match[1].trim()); if (dependency) pending.push({path: dependency, optional: false});
      }
    }
  }
  const work = await mkdtemp(resolve(tmpdir(), 'eagler-package-modules-')), root = resolve(work, 'site');
  const dispose = () => rm(work, {recursive: true, force: true});
  try {
    const files = [];
    for (const [path, {source, bytes}] of inputs) {
      const target = resolve(root, relativePath(path));
      if (!target.startsWith(root + sep)) throw new Error('Package fixture staging path escaped its root');
      await mkdir(dirname(target), {recursive: true}); await writeFile(target, bytes, {flag: 'wx'});
      files.push({path, source, bytes: bytes.length, sha256: hash(bytes)});
    }
    return {root, modules, files, optionalMissing, contracts: {mode: contracts.mode, inputHash: contracts.inputHash, root: contracts.root, directory: contracts.contractsDirectory}, dispose};
  } catch (error) {await dispose(); throw error;}
}

export async function runPackageModuleFixtureServer(port, {project = defaultProject, environment = process.env} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Package fixture port must be between 1 and 65535');
  const host = environment.EAGLER_TOUHOU_HOST || '127.0.0.1';
  // Reject a non-loopback request before compilation or staging begins.
  assertSafeDevelopmentServerScope({host, project, root: resolve(tmpdir(), 'eagler-package-modules')});
  let fixture, child, stopping = false;
  const stop = () => {stopping = true; child?.kill();};
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    fixture = await preparePackageModuleFixture({project});
    assertSafeDevelopmentServerScope({host, project, root: fixture.root});
    if (stopping) return;
    child = spawn(process.execPath, [resolve(project, 'scripts/serve-static.mjs'), fixture.root, String(port)], {
      cwd: project, env: {...environment, EAGLER_TOUHOU_HOST: host}, stdio: ['ignore', 'inherit', 'inherit'], shell: false,
    });
    console.log(JSON.stringify({packageModuleFixture: fixture.root, contractsInputHash: fixture.contracts.inputHash}));
    await new Promise((yes, no) => {
      child.once('error', no);
      child.once('exit', (code, signal) => stopping || code === 0 ? yes() : no(new Error(`Package fixture static server exited (${signal || code})`)));
    });
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    child?.kill(); await fixture?.dispose();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: package-module-fixture.mjs PORT');
  await runPackageModuleFixtureServer(Number(process.argv[2]));
}
