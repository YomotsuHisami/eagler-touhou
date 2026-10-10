import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {resolveAuthoredSource} from '../../lib/authored-source-resolution.mjs';
for (const paths of [path.posix, path.win32]) {
  const root = paths === path.win32 ? 'D:\\workspace\\launcher' : '/workspace/launcher';
  const resolve = value => paths.resolve(root, value);
  const existing = new Set(['src/contracts/product-catalog.mts', 'src/launcher/settings.mts'].map(resolve));
  const find = (source, importer) => resolveAuthoredSource(root, source, resolve(importer), paths, value => existing.has(value));
  test(`${paths === path.win32 ? 'Windows' : 'POSIX'} authored imports preserve bounded resolution`, () => {
    assert.equal(find('./settings.mjs', 'src/launcher/app.mts'), resolve('src/launcher/settings.mts'));
    assert.equal(find('../product-catalog.mjs', 'legacy/legacy-game-pack.mjs'), resolve('src/contracts/product-catalog.mts'));
    assert.equal(find('./product-catalog.mjs', 'lib/contracts/index.mjs'), resolve('src/contracts/product-catalog.mts'));
    assert.equal(find('./missing.mjs', 'src/launcher/app.mts'), undefined);
    assert.equal(find('../package/product-catalog.mjs', 'legacy/legacy-game-pack.mjs'), undefined);
    assert.equal(find('node:path', 'src/launcher/app.mts'), undefined);
    assert.equal(find('./settings.ts', 'src/launcher/app.mts'), undefined);
  });
}
