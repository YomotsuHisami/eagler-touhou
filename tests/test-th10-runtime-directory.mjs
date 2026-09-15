import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runtimeFileNames} from '../lib/runtime-release.mjs';
import {PRODUCT_GAMES} from '../lib/contracts/product-catalog.mjs';
import {runtimeAppShellPaths} from '../lib/app-shell-policy.mjs';
const assets = PRODUCT_GAMES.th10.runtimeAssets;
const directory = process.argv[2] ? resolve(process.argv[2]) : null;
let names;
if (directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'runtime-files.json'), 'utf8'));
  names = runtimeFileNames('th10', manifest.files);
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name));
    assert.equal(bytes.length, manifest.files[name].bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name].sha256);
  }
} else {
  const identities = Object.fromEntries(assets.map(name => [name, {bytes: 1, sha256: '0'.repeat(64)}]));
  names = runtimeFileNames('th10', identities);
}
assert.deepEqual(names, assets);
for (const path of ['../outside.js', 'runtime/../../outside.js', 'data/th10.exe', 'native/any.dll', '/runtime/a.js', 'runtime/any.data', 'extra.mjs']) {
  const identities = Object.fromEntries(assets.map(name => [name, {bytes: 1, sha256: '0'.repeat(64)}]));
  identities[path] = {bytes: 1, sha256: '0'.repeat(64)};
  assert.throws(() => runtimeFileNames('th10', identities));
}
const incomplete = Object.fromEntries(assets.map(name => [name, {bytes: 1, sha256: '0'.repeat(64)}]));
delete incomplete['th10-sdl.wasm'];
assert.throws(() => runtimeFileNames('th10', incomplete));
assert.throws(() => runtimeFileNames('th06', {'th06.html': {}, 'th06.js': {}, 'th06.wasm': {}, 'runtime/x.js': {}}));
assert.deepEqual(runtimeFileNames('th06', {'th06.html': {}, 'th06.js': {}, 'th06.wasm': {}}), ['th06.html', 'th06.js', 'th06.wasm']);
assert.deepEqual(PRODUCT_GAMES.th10.requiredShared, []);
const files = runtimeAppShellPaths({games: {th10: {runtime: 'runtime/th10/th10.html?hosted=1&v=test'}}});
for (const path of assets) assert.ok(files.includes(`runtime/th10/${path}`));
assert.ok(!files.includes('runtime/th10/th10.js'));
console.log(JSON.stringify({th10DirectoryRuntime: 'PASS', verifiedFiles: names.length, executableContentRejected: true, exactAllowList: true}));
