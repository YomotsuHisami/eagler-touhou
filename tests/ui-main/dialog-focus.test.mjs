/** Pure focus ownership policy; actual focus/animation runs only in CI. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const result = await build({entryPoints: ['app/browser/dialog-focus.ts'], bundle: true, format: 'esm', write: false});
const dir = await mkdtemp(join(tmpdir(), 'dialog-focus-')); after(() => rm(dir, {recursive: true, force: true}));
const file = join(dir, 'focus.mjs');await writeFile(file, result.outputFiles[0].text);
const {dialogFocusMoved} = await import(pathToFileURL(file).href);
function node(parent = null, dialog = false) {
  return {parent, dialog, isConnected: true,
    contains(other) {for (let n = other; n; n = n.parent) if (n === this) return true;return false;},
    closest(selector) {assert.equal(selector, '[data-animated-dialog]');for (let n = this; n; n = n.parent) if (n.dialog) return n;return null;}};
}
function scope() {const body = node(), documentElement = node(), parent = node(body, true), opener = node(parent), oldSurface = node(body, true);return {body, documentElement, parent, opener, oldSurface};}
test('the exact still-open parent container is a Radix fallback, not a new destination', () => {
  const s = scope();assert.equal(dialogFocusMoved({...s, active: s.parent}), false);
  assert.equal(dialogFocusMoved({...s, opener: null, returnFocus: s.parent, active: s.parent}), false);
});
test('another control, frame or newer dialog remains protected from delayed close autofocus', () => {
  const s = scope();for (const active of [node(s.parent), node(s.body), node(s.body, true), node(node(s.body, true))]) assert.equal(dialogFocusMoved({...s, active}), true);
});
test('body, document, detached and old-scope focus permit ordinary restoration', () => {
  const s = scope();for (const active of [null, s.body, s.documentElement, {...node(), isConnected: false}, node(s.oldSurface)]) assert.equal(dialogFocusMoved({...s, active}), false);
});
test('fallback exception does not remove stale-surface, reopen or unmount checks', async () => {
  const source = await readFile('app/components/AnimatedDialog.tsx', 'utf8');
  assert.match(source, /!current\.mounted \|\| current\.props\.open \|\| current\.surface !== surface\.current/);
  assert.match(source, /oldSurface instanceof HTMLElement && oldSurface\.isConnected/);
  assert.match(source, /if \(!stale && !focusMoved\)/);
});
