/** Cold maintainer contracts and compiler-free distribution boundary. No UI,
 * browser, published endpoint or native game is initialized by these checks. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const project = fileURLToPath(new URL('../../', import.meta.url));
let work, cold, api, built;
function run(cwd, code, environment = {}) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {cwd, stdio: 'pipe', env: {...process.env, ...environment}});
    let output = '', errors = '';
    child.stdout.on('data', data => {output += data;}); child.stderr.on('data', data => {errors += data;});
    child.once('error', no); child.once('exit', code => code === 0 ? yes(output.trim()) : no(new Error(`Child exited ${code}: ${errors}\n${output}`)));
  });
}
before(async () => {
  work = await mkdtemp(resolve(project, '.cache/contracts-only-test-')); cold = resolve(work, 'source');
  for (const path of ['src/contracts', 'lib/contracts', 'lib/contracts-build.mjs', 'lib/launcher-optimization.mjs', 'lib/atomic-file.mjs', 'tsconfig.launcher.json', 'tsconfig.contracts.json', 'package.json']) {
    await mkdir(resolve(cold, path, '..'), {recursive: true});
    await cp(resolve(project, path), resolve(cold, path), {recursive: true});
  }
  await symlink(resolve(project, 'node_modules'), resolve(cold, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  api = await import(pathToFileURL(resolve(cold, 'lib/contracts-build.mjs')).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

test('concurrent cold Node facade imports publish one verified contracts-only generation', async () => {
  const code = `const [p,h,r] = await Promise.all([import('./lib/contracts/product-catalog.mjs'),import('./lib/contracts/host-manifest.mjs'),import('./lib/contracts/runtime-generations.mjs')]);
    const b=await import('./lib/contracts-build.mjs'); const result=await b.ensureContractsBuild(); console.log(JSON.stringify({product:p.DEFAULT_PRODUCT_ID,host:h.HOST_MANIFEST_SCHEMA,runtime:r.RUNTIME_MANIFEST_FILE,hash:result.inputHash}));`;
  const results = await Promise.all(Array.from({length: 3}, () => run(cold, code).then(JSON.parse)));
  assert.ok(results.every(value => value.product === 'th06' && value.runtime === 'runtime-manifest.json'));
  assert.equal(new Set(results.map(value => value.hash)).size, 1);
  built = await api.ensureContractsBuild(); assert.equal(built.inputHash, results[0].hash);
  assert.deepEqual((await readdir(resolve(cold, '.cache/build/contracts'))).filter(name => !name.startsWith('.')), [built.inputHash]);
  for (const path of ['src/launcher', '.cache/build/browser', '.cache/build/optimized', 'assets/contracts']) assert.equal(existsSync(resolve(cold, path)), false, path);
  const manifest = JSON.parse(await readFile(resolve(built.root, 'manifest.json'), 'utf8'));
  for (const [path, hash] of Object.entries(manifest.outputs)) assert.equal(createHash('sha256').update(await readFile(resolve(built.root, path))).digest('hex'), hash);
  assert.equal(existsSync(resolve(cold, '.cache/build/contracts/.build.lock')), false);
});

test('classic worker resolver uses the exact shared canonical compiler and exports its contract', async () => {
  const path = await api.resolveRuntimeGenerationWorkerSource();
  assert.equal(path, resolve(built.contractsDirectory, 'runtime-generations-worker.js'));
  const source = await readFile(path, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), 'fae3b9da9ae6a1b6046c435d75d9621a09d2323fcc21a22986750ec3e1614a56', 'frozen canonical main worker bytes');
  const {buildRuntimeGenerationWorkerSource} = await import('../../lib/launcher-optimization.mjs');
  assert.equal(source, await buildRuntimeGenerationWorkerSource({project: cold}));
  const helperUrl = pathToFileURL(resolve(cold, 'lib/launcher-optimization.mjs')).href;
  const otherCwd = await run(work, `import{buildRuntimeGenerationWorkerSource}from${JSON.stringify(helperUrl)};process.stdout.write(await buildRuntimeGenerationWorkerSource({project:${JSON.stringify(cold)}}));`);
  assert.equal(otherCwd, source.trim(), 'worker bytes do not depend on the caller working directory');
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(context.EaglerRuntimeGenerations.RUNTIME_MANIFEST_FILE, 'runtime-manifest.json');
});

test('source changes produce a new immutable generation while the old import stays coherent', async () => {
  const old = await api.ensureContractsBuild(), source = resolve(cold, 'src/contracts/product-catalog.mts');
  await writeFile(source, await readFile(source, 'utf8') + '\nexport const CONTRACTS_ONLY_REFRESH_PROBE = "fresh";\n');
  const next = await api.ensureContractsBuild();
  assert.notEqual(next.inputHash, old.inputHash); assert.equal(existsSync(old.contractsDirectory), true);
  const {loadCompiledContract} = await import(pathToFileURL(resolve(cold, 'lib/contracts/load-compiled-contract.mjs')).href);
  assert.equal((await loadCompiledContract('product-catalog')).CONTRACTS_ONLY_REFRESH_PROBE, 'fresh');
  assert.equal((await import(pathToFileURL(resolve(old.contractsDirectory, 'product-catalog.mjs')).href)).CONTRACTS_ONLY_REFRESH_PROBE, undefined);
  const host = await loadCompiledContract('host-manifest'); assert.match(host.HOST_MANIFEST_SCHEMA, /^eagler-touhou/);
});

test('existing full-Launcher cache and published contract precedence remain unchanged', async () => {
  const cached = resolve(cold, '.cache/build/browser/assets/contracts'), published = resolve(cold, 'assets/contracts');
  await mkdir(cached, {recursive: true}); await mkdir(published, {recursive: true});
  await writeFile(resolve(cached, 'precedence.mjs'), 'export const source = "cached";');
  await writeFile(resolve(published, 'precedence.mjs'), 'export const source = "published";');
  assert.equal(await run(cold, `import{loadCompiledContract}from'./lib/contracts/load-compiled-contract.mjs';console.log((await loadCompiledContract('precedence')).source);`), 'cached');
  await rm(resolve(cached, 'precedence.mjs'));
  assert.equal(await run(cold, `import{loadCompiledContract}from'./lib/contracts/load-compiled-contract.mjs';console.log((await loadCompiledContract('precedence')).source);`), 'published');
  await rm(resolve(cold, '.cache/build/browser'), {recursive: true}); await rm(resolve(cold, 'assets'), {recursive: true});
});

test('source drift during compilation discards staging rather than publishing mixed bytes', async () => {
  const cache = resolve(cold, '.cache/build/contracts'), source = resolve(cold, 'src/contracts/product-catalog.mts');
  const previous = (await readdir(cache)).filter(name => !name.startsWith('.'));
  await writeFile(source, await readFile(source, 'utf8') + '\nexport const CONTRACTS_ONLY_DRIFT_START = true;\n');
  const compiling = run(cold, `import{ensureContractsBuild}from'./lib/contracts-build.mjs';import{loadCompiledContract}from'./lib/contracts/load-compiled-contract.mjs';const result=await ensureContractsBuild();const contract=await loadCompiledContract('product-catalog');console.log(JSON.stringify({hash:result.inputHash,drift:contract.CONTRACTS_ONLY_DRIFT_END}));`);
  const deadline = Date.now() + 10000;
  while (!(await readdir(cache)).some(name => name.startsWith('.staging-'))) {
    if (Date.now() > deadline) throw new Error('Contracts compiler did not create private staging');
    await new Promise(yes => setTimeout(yes, 5));
  }
  await writeFile(source, await readFile(source, 'utf8') + '\nexport const CONTRACTS_ONLY_DRIFT_END = "latest";\n');
  const result = JSON.parse(await compiling);
  assert.equal(result.drift, 'latest');
  const after = (await readdir(cache)).filter(name => !name.startsWith('.'));
  assert.equal(after.length, previous.length + 1, 'only the stable final source generation was published');
  assert.ok(after.includes(result.hash));
});

test('published-only Node distribution reads contracts and worker without source or dev dependencies', async () => {
  const distribution = resolve(work, 'distribution');
  await mkdir(resolve(distribution, 'lib'), {recursive: true}); await mkdir(resolve(distribution, 'assets'), {recursive: true});
  await cp(resolve(cold, 'lib/contracts'), resolve(distribution, 'lib/contracts'), {recursive: true});
  await cp(resolve(cold, 'lib/contracts-build.mjs'), resolve(distribution, 'lib/contracts-build.mjs'));
  await cp(built.contractsDirectory, resolve(distribution, 'assets/contracts'), {recursive: true});
  const result = JSON.parse(await run(distribution, `import{readFile}from'node:fs/promises';import{DEFAULT_PRODUCT_ID}from'./lib/contracts/product-catalog.mjs';import{resolveRuntimeGenerationWorkerSource,ensureContractsBuild}from'./lib/contracts-build.mjs';console.log(JSON.stringify({product:DEFAULT_PRODUCT_ID,worker:(await readFile(await resolveRuntimeGenerationWorkerSource(),'utf8')).includes('EaglerRuntimeGenerations'),mode:(await ensureContractsBuild()).mode}));`, {EAGLER_FRONTEND: 'react'}));
  assert.deepEqual(result, {product: 'th06', worker: true, mode: 'prebuilt'});
  for (const path of ['src', 'node_modules', 'lib/launcher-optimization.mjs', '.cache']) assert.equal(existsSync(resolve(distribution, path)), false);
});

test('selected React source ignores stale inherited main contracts and worker after canonical edits', async () => {
  const inherited = resolve(cold, '.cache/build/browser/assets/contracts');
  await mkdir(resolve(inherited, '..'), {recursive: true}); await cp(built.contractsDirectory, inherited, {recursive: true});
  const source = resolve(cold, 'src/contracts/runtime-generations.mts');
  await writeFile(source, await readFile(source, 'utf8') + '\nexport const CONTRACTS_ONLY_WORKER_REFRESH_PROBE = "current-worker";\n');
  const result = JSON.parse(await run(cold, `import{readFile}from'node:fs/promises';import vm from'node:vm';import{loadCompiledContract}from'./lib/contracts/load-compiled-contract.mjs';import{resolveRuntimeGenerationWorkerSource}from'./lib/contracts-build.mjs';const catalog=await loadCompiledContract('product-catalog');const path=await resolveRuntimeGenerationWorkerSource();const context=vm.createContext({});vm.runInContext(await readFile(path,'utf8'),context);console.log(JSON.stringify({catalog:catalog.CONTRACTS_ONLY_REFRESH_PROBE,worker:context.EaglerRuntimeGenerations.CONTRACTS_ONLY_WORKER_REFRESH_PROBE,path}));`, {EAGLER_FRONTEND: 'react'}));
  assert.equal(result.catalog, 'fresh'); assert.equal(result.worker, 'current-worker');
  assert.ok(result.path.startsWith(resolve(cold, '.cache/build/contracts')));
  assert.equal(await readFile(resolve(inherited, 'runtime-generations-worker.js'), 'utf8'), await readFile(resolve(built.contractsDirectory, 'runtime-generations-worker.js'), 'utf8'), 'inherited main output remains untouched');
  await rm(resolve(cold, '.cache/build/browser'), {recursive: true});
});

test('invalid names and corrupted cached outputs fail closed', async () => {
  const {loadCompiledContract} = await import(pathToFileURL(resolve(cold, 'lib/contracts/load-compiled-contract.mjs')).href);
  await assert.rejects(loadCompiledContract('../outside'), /invalid compiled contract name/);
  const current = await api.ensureContractsBuild();
  await writeFile(resolve(current.contractsDirectory, 'product-catalog.mjs'), 'export const damaged = true;');
  await assert.rejects(api.ensureContractsBuild(), /cache is corrupt/);
});
