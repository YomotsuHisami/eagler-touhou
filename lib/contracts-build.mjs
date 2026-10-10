import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {relative, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';

const defaultProject = resolve(fileURLToPath(new URL('..', import.meta.url)));
const activeBuilds = new Map();
const workerName = 'runtime-generations-worker.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sources(path));
    else if (entry.isFile() && entry.name.endsWith('.mts')) result.push(path);
  }
  return result.sort();
}
async function identity(project) {
  const inputs = [...await sources(resolve(project, 'src/contracts')),
    resolve(project, 'tsconfig.launcher.json'), resolve(project, 'tsconfig.contracts.json'),
    resolve(project, 'lib/contracts-build.mjs'), resolve(project, 'lib/launcher-optimization.mjs'),
    resolve(project, 'node_modules/typescript/package.json'), resolve(project, 'node_modules/esbuild/package.json')];
  const entries = await Promise.all(inputs.map(async path => [relative(project, path).replaceAll('\\', '/'), digest(await readFile(path))]));
  return {hash: digest(JSON.stringify(entries)), entries,
    outputs: inputs.filter(path => path.startsWith(resolve(project, 'src/contracts') + '/') || path.startsWith(resolve(project, 'src/contracts') + '\\'))
      .map(path => relative(resolve(project, 'src'), path).replaceAll('\\', '/').replace(/\.mts$/, '.mjs')).sort()};
}
async function valid(root, input) {
  try {
    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
    if (manifest.schema !== 'eagler-touhou/contracts-build/1' || manifest.inputHash !== input.hash) return false;
    const expected = [...input.outputs.map(path => `assets/${path}`), `assets/contracts/${workerName}`].sort();
    if (JSON.stringify(Object.keys(manifest.outputs).sort()) !== JSON.stringify(expected)) return false;
    for (const path of expected) {
      const bytes = await readFile(resolve(root, path));
      if (!bytes.length || digest(bytes) !== manifest.outputs[path]) return false;
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) return false;
    throw error;
  }
}
async function lock(path) {
  const started = Date.now();
  while (true) {
    try {await mkdir(path); return;}
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() - started > 120000) throw new Error(`Timed out waiting for contracts-only build lock: ${path}`);
      await delay(25);
    }
  }
}
async function compile(project, staging) {
  const compiler = resolve(project, 'node_modules/typescript/bin/tsc');
  if (!existsSync(compiler)) throw new Error('Contracts-only TypeScript compiler is missing; install source-checkout dependencies first');
  await new Promise((yes, no) => {
    const child = spawn(process.execPath, [compiler, '-p', resolve(project, 'tsconfig.contracts.json'), '--outDir', resolve(staging, 'assets'), '--pretty', 'false'], {cwd: project, stdio: 'pipe'});
    let output = ''; child.stdout.on('data', data => {output += data;}); child.stderr.on('data', data => {output += data;});
    child.once('error', no); child.once('exit', code => code === 0 ? yes() : no(new Error(`Contracts-only TypeScript build failed (${code}):\n${output}`)));
  });
  // This existing pure helper compiles only the canonical worker contract. It
  // never initializes the Launcher module graph or calls optimizeLauncher.
  const {buildRuntimeGenerationWorkerSource} = await import(pathToFileURL(resolve(project, 'lib/launcher-optimization.mjs')).href);
  await writeFile(resolve(staging, 'assets/contracts', workerName), await buildRuntimeGenerationWorkerSource({project}));
}
async function outputFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await outputFiles(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unexpected contracts-only output: ${name}`);
  }
  return files.sort();
}
async function prepare(project) {
  const sourceRoot = resolve(project, 'src/contracts');
  if (!existsSync(sourceRoot)) return Object.freeze({mode: 'prebuilt', root: project, contractsDirectory: resolve(project, 'assets/contracts'), inputHash: null});
  const cache = resolve(project, '.cache/build/contracts'); await mkdir(cache, {recursive: true});
  const lockPath = resolve(cache, '.build.lock'); await lock(lockPath);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const input = await identity(project), root = resolve(cache, input.hash);
      if (await valid(root, input)) {
        if ((await identity(project)).hash !== input.hash) continue;
        return Object.freeze({mode: 'source', root, contractsDirectory: resolve(root, 'assets/contracts'), inputHash: input.hash});
      }
      // Immutable generations keep already-imported relative dependencies
      // coherent while another process builds a newer source generation.
      if (existsSync(root)) throw new Error(`Contracts-only cache is corrupt: ${root}`);
      const staging = await mkdtemp(resolve(cache, '.staging-'));
      try {
        await compile(project, staging);
        if ((await identity(project)).hash !== input.hash) continue;
        const expected = [...input.outputs.map(path => `assets/${path}`), `assets/contracts/${workerName}`].sort();
        if (JSON.stringify(await outputFiles(staging)) !== JSON.stringify(expected)) throw new Error('Contracts-only compiler emitted files outside its canonical contract source set');
        const outputHashes = {};
        for (const path of expected) {
          const bytes = await readFile(resolve(staging, path));
          if (!bytes.length) throw new Error(`Empty compiled contract: ${path}`);
          outputHashes[path] = digest(bytes);
        }
        await writeFile(resolve(staging, 'manifest.json'), JSON.stringify({schema: 'eagler-touhou/contracts-build/1', inputHash: input.hash, inputs: input.entries, outputs: outputHashes}) + '\n');
        await rename(staging, root);
        return Object.freeze({mode: 'source', root, contractsDirectory: resolve(root, 'assets/contracts'), inputHash: input.hash});
      } finally {await rm(staging, {recursive: true, force: true});}
    }
    throw new Error('Contract sources changed repeatedly during compilation; no mixed generation was published');
  } finally {await rm(lockPath, {recursive: true, force: true});}
}
/** Maintainer-only source fallback; prebuilt Node 22+ installs need no compiler. */
export function ensureContractsBuild({project = defaultProject} = {}) {
  project = resolve(project);
  const current = activeBuilds.get(project); if (current) return current;
  const pending = prepare(project).finally(() => {if (activeBuilds.get(project) === pending) activeBuilds.delete(project);});
  activeBuilds.set(project, pending); return pending;
}
/** Classic worker authority for a selected frontend, independent of old UI. */
export async function resolveRuntimeGenerationWorkerSource({project = defaultProject} = {}) {
  const selectedReactSource = process.env.EAGLER_FRONTEND === 'react' && existsSync(resolve(project, 'src/contracts/runtime-generations.mts'));
  if (!selectedReactSource) {
    for (const path of [resolve(project, '.cache/build/browser/assets/contracts', workerName), resolve(project, 'assets/contracts', workerName)]) {
      if (existsSync(path) && (await stat(path)).isFile()) return path;
    }
  }
  const build = await ensureContractsBuild({project}), path = resolve(build.contractsDirectory, workerName);
  if (!existsSync(path)) throw new Error(`Prebuilt runtime worker contract is missing: ${path}`);
  return path;
}
