/** Injected native-animation lifecycle plus authored geometry checks only. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({entryPoints: [join(root, 'app/services/touch-editor-motion.ts')], bundle: true, format: 'esm', platform: 'browser', write: false});
const folder = await mkdtemp(join(tmpdir(), 'touch-editor-motion-')); after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'entry.mjs'); await writeFile(file, bundle.outputFiles[0].text);
const {createTouchEditorEntryMotion} = await import(pathToFileURL(file).href);
function fixture() {
  const animations = [];
  const entry = createTouchEditorEntryMotion(() => {
    let resolve, reject; const finished = new Promise((yes, no) => {resolve = yes; reject = no;});
    const animation = {finished, cancels: 0, cancel() {this.cancels++; reject(Error('cancelled'));}, resolve, reject};
    animations.push(animation); return animation;
  });
  return {entry, animations};
}
test('the scene enters once after ready and releases its native animation after finish', async () => {
  const f = fixture(); f.entry.ready(false); f.entry.ready(false); assert.equal(f.animations.length, 1);
  f.animations[0].resolve(); await Promise.resolve(); assert.equal(f.animations[0].cancels, 1);
  f.entry.ready(false); assert.equal(f.animations.length, 1);
});
test('reduced motion skips entry and enabling full motion later does not replay it', () => {
  const f = fixture(); f.entry.ready(true); f.entry.preferenceChanged(false); f.entry.ready(false); assert.equal(f.animations.length, 0);
});
test('live reduction cancels without leaving a finished fill or restarting after the preference changes', async () => {
  const f = fixture(); f.entry.ready(false); f.entry.preferenceChanged(true); await Promise.resolve(); assert.equal(f.animations[0].cancels, 1);
  f.entry.preferenceChanged(false); f.entry.ready(false); assert.equal(f.animations.length, 1);
});
test('cleanup fences old completion and allows effect-replay attachment on the same scene', async () => {
  const f = fixture(); f.entry.ready(false); f.entry.dispose(); f.entry.ready(false); assert.equal(f.animations.length, 2);
  f.animations[0].resolve(); await Promise.resolve(); assert.equal(f.animations[1].cancels, 0);
  f.entry.dispose(); await Promise.resolve(); assert.equal(f.animations[1].cancels, 1);
});
test('workbench preserves final compact main geometry, pinned footer, shared preference, and one draft owner', async () => {
  const component = await readFile(join(root, 'app/components/TouchLayoutEditor.tsx'), 'utf8'), css = await readFile(join(root, 'app/components/touch-layout-editor.css'), 'utf8');
  assert.match(css, /width: min\(288px, calc\(100% - 32px\)\)/); assert.match(css, /max-height: min\(470px, calc\(100% - 32px\)\)/); assert.match(css, /max-height: min\(430px, 50dvh\)/);
  assert.match(css, /\.layout-workbench-scroll \{[^}]*overflow: auto/); assert.match(css, /\.layout-workbench-footer \{[^}]*flex: none/);
  assert.match(component, /root\.current!\.animate\(\[\{opacity: 0\}, \{opacity: 1\}\], \{duration: 340, easing: 'cubic-bezier\(\.2,0,\.2,1\)'\}\)/);
  assert.doesNotMatch(component, /workbench\.current[^;]*\.animate|matchMedia|useBlocker|createRuntimeService/);
  assert.equal((component.match(/useNavigationDraftGuard\(/g) ?? []).length, 1); assert.match(component, /const \{reducedMotion\} = useMotionPreference\(\)/);
  assert.match(component, /data-touch-manipulating=\{manipulating\}/); assert.match(component, /data-collapsed=\{collapsed\}/); assert.match(component, /data-touch-workbench-body="" hidden=\{collapsed\}/);
});
