/** Save slots are the single save UI; solo and multiplayer keep their replay tools. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tree = parse(await readFile(process.env.EAGLER_TEST_HTML || resolve(root, 'public/index.html'), 'utf8'));
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function all(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]; }
for (const id of ['fileOptions', 'mpFileOptions']) {
  const section = all(tree, n => attr(n, 'id') === id)[0];
  assert.ok(section, id);
  assert.equal(all(section, n => ['import-save', 'export-save'].includes(attr(n, 'data-action'))).length, 0, `${id}: legacy save actions must not remain in the DOM`);
  assert.equal(all(section, n => attr(n, 'data-i18n') === 'settings.save').length, 0, `${id}: no duplicate save heading`);
  for (const action of ['manage-replay', 'export-replay']) {
    assert.equal(all(section, n => attr(n, 'data-action') === action).length, 1, `${id}: preserve ${action}`);
  }
}
for (const id of ['scoreFilesDialog', 'scoreFilesContent', 'scoreFilesOpen', 'scoreFilesClose', 'fileInput']) {
  assert.equal(all(tree, n => attr(n, 'id') === id).length, 1, `${id} must stay unique`);
}
console.log('Save dialog DOM: one slot-library entry point; solo/MP replay tools preserved: PASS');
