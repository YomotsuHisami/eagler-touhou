/** Pure gesture policy and adapter ownership checks; native events run in CI. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({entryPoints: [join(root, 'app/services/room-options-swipe.ts')], bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'room-options-swipe-')); after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'entry.mjs'); await writeFile(file, bundle.outputFiles[0].text);
const {createRoomOptionsSwipe} = await import(pathToFileURL(file).href);
const point = (x = 0, y = 0, more = {}) => ({pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, target: 'content', ...more});
function fixture() {let allowed = true, closes = 0;const swipe = createRoomOptionsSwipe({allowed: () => allowed, canStart: target => target === 'content', close: () => {closes++;}});return {swipe, allow: value => {allowed = value;}, get closes() {return closes;}};}
test('8px recognition, strict horizontal dominance, and exact 54px rightward close preserve main thresholds', () => {
  const f = fixture();f.swipe.down(point());assert.equal(f.swipe.move(point(7, 0)), false);assert.equal(f.swipe.move(point(8, 0)), true);assert.equal(f.swipe.up(point(53)), false);assert.equal(f.closes, 0);
  f.swipe.down(point());f.swipe.move(point(8));assert.equal(f.swipe.up(point(54)), true);assert.equal(f.closes, 1);assert.equal(f.swipe.up(point(100)), false);assert.equal(f.closes, 1);
  f.swipe.down(point());assert.equal(f.swipe.move(point(12, 10)), false);f.swipe.move(point(100));f.swipe.up(point(100));assert.equal(f.closes, 1);
});
test('vertical, wrong-way, short and cancelled streams never close; a recognized horizontal gesture tolerates later drift', () => {
  const f = fixture();for (const [x,y] of [[3,20],[-80,0],[53,0]]) {f.swipe.down(point());f.swipe.move(point(x,y));f.swipe.up(point(x,y));}assert.equal(f.closes, 0);
  f.swipe.down(point());f.swipe.move(point(20));f.swipe.cancel();f.swipe.up(point(80));assert.equal(f.closes, 0);
  f.swipe.down(point());f.swipe.move(point(20));f.swipe.move(point(60,100));f.swipe.up(point(60,100));assert.equal(f.closes, 1);
});
test('editable/owned/outside targets, secondary pointers, and closed surfaces keep their input', () => {
  const f = fixture();for (const target of ['input','slider','nested-help','editor','outside']) {f.swipe.down(point(0,0,{target}));assert.equal(f.swipe.move(point(80)), false);f.swipe.up(point(80));}assert.equal(f.closes, 0);
  f.swipe.down(point(0,0,{isPrimary:false}));f.swipe.up(point(80));assert.equal(f.closes,0);
  f.allow(false);f.swipe.down(point());f.swipe.move(point(80));f.swipe.up(point(80));assert.equal(f.closes,0);
});
test('a new dialog, route or exit invalidates an already recognized swipe before further input or close', () => {
  const f = fixture();f.swipe.down(point());f.swipe.move(point(20));f.allow(false);assert.equal(f.swipe.move(point(70)), false);f.allow(true);f.swipe.up(point(80));assert.equal(f.closes,0);
  f.swipe.down(point());f.swipe.move(point(20));f.allow(false);assert.equal(f.swipe.up(point(80)),false);assert.equal(f.closes,0);
});
test('pointer identity is exact and native drag suppression applies only to an active eligible target', () => {
  const f = fixture();f.swipe.down(point());assert.equal(f.swipe.drag('content'),true);assert.equal(f.swipe.drag('input'),false);
  assert.equal(f.swipe.move(point(80,0,{pointerId:2})),false);assert.equal(f.swipe.up(point(80,0,{pointerId:2})),false);assert.equal(f.closes,0);
  f.swipe.move(point(80));f.swipe.up(point(80));assert.equal(f.closes,1);assert.equal(f.swipe.drag('content'),false);
});
test('only room options opt in, and the adapter never navigates or captures another owner pointer', async () => {
  const room = await readFile(join(root,'app/components/MultiplayerRoom.tsx'),'utf8'), dialog = await readFile(join(root,'app/components/AnimatedDialog.tsx'),'utf8'), adapter = await readFile(join(root,'app/browser/room-options-swipe.ts'),'utf8');
  assert.match(room,/swipeToClose=\{panels\.kind === 'options' && !upperActive \? 'right' : undefined\}/);
  assert.match(room,/swipeCloseKey=\{panels\.key\}/);assert.match(dialog,/live\.current\.props\.swipeCloseKey === swipeCloseKey/);
  assert.match(dialog,/close: \(\) => live\.current\.props\.onOpenChange\(false\)/);
  assert.match(adapter,/node\.closest\('\[role="dialog"\]'\) === surface/);assert.match(adapter,/\[aria-hidden="true"\]/);assert.match(adapter,/\[data-touch-editor-scene\]/);
  assert.doesNotMatch(adapter,/navigate\(|history\.|setPointerCapture|touchAction/);
});
