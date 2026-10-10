/** Run from repository root: node tests/react-main/site-notice.run.mjs */
import {builtinModules, createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';

const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, '../..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const {build} = requireFromRepo('esbuild');
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
// Build only from repository inputs; isolate and remove each run's generated bundle.
const buildDirectory = await mkdtemp(join(directory, 'site-notice-build-'));
const output = join(buildDirectory, 'checks.mjs');
try {
  const result = await build({
    absWorkingDir: repo,
    entryPoints: [join(directory, 'site-notice.checks.tsx')],
    bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
    plugins: [{name: 'read-only-repository-inputs', setup(build) {
      build.onResolve({filter: /^@source\//}, args => ({path: join(repo, args.path.slice('@source/'.length))}));
      build.onResolve({filter: /^[^./]/}, args => {
        if (args.path.startsWith('@source/')) return;
        return {path: builtins.has(args.path) ? args.path : requireFromRepo.resolve(args.path), external: true};
      });
    }}],
  });
  await writeFile(output, result.outputFiles[0].text);
  const {runChecks} = await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
  const results = await runChecks(repo);
  console.log(`PASS ${results.cases.length} site-notice cases; pinned main: ${results.pinnedMain}`);
  console.log(`Source SHA-256: ${results.sourceSha256}`);
} finally {
  await rm(buildDirectory, {recursive: true, force: true});
}
