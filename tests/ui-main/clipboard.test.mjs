/** DOM ports are synthetic. No browser/clipboard is used by these unit tests. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({entryPoints: [join(root, 'app/browser/clipboard.ts')], bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'ui-clipboard-'));after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'copy.mjs');await writeFile(file, bundle.outputFiles[0].text);const {copyText} = await import(pathToFileURL(file).href);
function fixture({modern = 'missing', fallback = true, modal = false, fullscreen = false, input = false, connected = true} = {}) {
  const calls = {modern: [], created: 0, removed: 0, focus: 0, copied: [], selections: [], parent: null};
  class Element {isConnected = connected; focus(options) {calls.focus++;assert.equal(options.preventScroll, true);} closest(selector) {assert.equal(selector, '[role="dialog"]');return modal ? dialog : null;}}
  class Input extends Element {selectionStart = 1; selectionEnd = 3; selectionDirection = 'backward';setSelectionRange(...args) {calls.selections.push(args);}}
  class TextArea extends Input {value = '';readOnly = false;style = {};select() {doc.activeElement = this;}remove() {calls.removed++;}}
  const body = {append(node) {calls.parent = 'body';area = node;}}, dialog = {append(node) {calls.parent = 'dialog';area = node;}}, full = {append(node) {calls.parent = 'fullscreen';area = node;}};
  let area = null;const active = input ? new Input() : new Element();
  const range = {cloneRange() {return this;}};const selection = {rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange(value) {assert.equal(value, range);}};
  const doc = {body, activeElement: active, fullscreenElement: fullscreen ? full : null, getSelection: () => selection,
    createElement(name) {assert.equal(name, 'textarea');calls.created++;return new TextArea();},
    execCommand(command) {assert.equal(command, 'copy');assert.equal(area.readOnly, true);calls.copied.push(area.value);if (fallback === 'throw') throw Error('blocked');return fallback;},
  };
  const clipboard = modern === 'missing' ? undefined : {async writeText(text) {calls.modern.push(text);if (modern === 'reject') throw Error('denied');}};
  for (const [key, value] of Object.entries({navigator: {clipboard}, document: doc, HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: TextArea})) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);Object.defineProperty(globalThis, key, {configurable: true, value});
    after(() => {if (before) Object.defineProperty(globalThis, key, before);else delete globalThis[key];});
  }
  return calls;
}
test('modern Clipboard API success avoids DOM fallback', async () => {const c = fixture({modern: 'success'});assert.equal(await copyText('1234'), true);assert.deepEqual(c.modern, ['1234']);assert.equal(c.created, 0);});
test('HTTP/missing Clipboard API selects copied text and removes the textarea', async () => {const c = fixture();assert.equal(await copyText('1234'), true);assert.deepEqual(c.copied, ['1234']);assert.deepEqual(c.selections, [[0, 4]]);assert.equal(c.parent, 'body');assert.equal(c.removed, 1);assert.equal(c.focus, 1);});
test('rejected Clipboard API falls back inside the active dialog without disturbing selection', async () => {const c = fixture({modern: 'reject', modal: true, fullscreen: true, input: true});assert.equal(await copyText('{"report":true}'), true);assert.equal(c.parent, 'dialog');assert.deepEqual(c.selections.at(-1), [1, 3, 'backward']);assert.equal(c.focus, 1);});
test('fullscreen fallback stays inside the fullscreen element', async () => {const c = fixture({fullscreen: true});assert.equal(await copyText('1234'), true);assert.equal(c.parent, 'fullscreen');});
test('failure or throw reports false, cleans up and does not focus a detached opener', async () => {
  for (const fallback of [false, 'throw']) {const c = fixture({fallback, connected: false});assert.equal(await copyText('1234'), false);assert.equal(c.removed, 1);assert.equal(c.focus, 0);}
});
test('room code and calibration report use the same guarded adapter', async () => {
  for (const path of ['app/components/MultiplayerRoom.tsx', 'app/components/MultiplayerCalibration.tsx']) {
    const source = await readFile(join(root, path), 'utf8');assert.match(source, /from '\.\.\/browser\/clipboard'/);assert.doesNotMatch(source, /navigator\.clipboard/);
  }
});
