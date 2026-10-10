import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mainAssets} from '../../scripts/ui-rewrite/main-assets.ts';

test('main stylesheet load hook accepts native and Vite-normalized path separators', () => {
  const plugin = mainAssets();
  for (const file of ['styles.css', 'lobby.css']) {
    const native = resolve('public', file);
    const forward = native.replaceAll('\\', '/');
    const back = forward.replaceAll('/', '\\');
    const result = plugin.load.call({}, native);
    assert.equal(typeof result, 'string');
    assert.equal(plugin.load.call({}, forward + '?direct'), result);
    assert.equal(plugin.load.call({}, back), result);
    if (file === 'styles.css') assert.match(result, /chill-round-gothic-site-medium-critical/);
    else assert.ok(result.includes('[hidden]:not(:where([data-launcher-document],[data-launcher-document] *))'));
  }
  assert.equal(plugin.load.call({}, resolve('public/unrelated.css')), undefined);
});
