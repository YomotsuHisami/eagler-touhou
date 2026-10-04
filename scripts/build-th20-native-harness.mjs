/** Test-only native adapter assets. No publication output or original bytes. */
import {build} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './vite-contracts.ts';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
if (process.argv.length > 2) throw new Error('Native harness output is fixed outside all publication artifacts');
const output = resolve('.cache/th20-native-harness/__th20_native__');
await build({configFile: false, root: resolve('tests/native-th20'), base: './', publicDir: false,
  plugins: [browserContractSources(), tailwindcss()], oxc: {jsx: {runtime: 'automatic'}},
  build: {outDir: output, emptyOutDir: true, rolldownOptions: {input: resolve('tests/native-th20/index.html')}}});
await writeFile(resolve(output, 'fixture-manifest.json'), JSON.stringify({schema: 'eagler-touhou/th20-native-fixture/1',
  testOnly: true, scope: 'test-only-native-adapter', nativeRuns: 'unverified', productionProductSupport: false}));
console.log('TEST ONLY TH20 native adapter harness built separately. Native/browser runs remain unverified.');
