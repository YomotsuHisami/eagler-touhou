/** Pure owner forwarding and source lifecycle contracts. Browser stacking and
 * real focus are asserted separately in the authorized synthetic CI lanes. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'nested-dialog-dismissal-')); after(() => rm(folder, {recursive: true, force: true}));
const bundle = await build({entryPoints: [join(root, 'app/services/nested-dialog-dismissal.ts')], bundle: true, format: 'esm', write: false});
const file = join(folder, 'entry.mjs'); await writeFile(file, bundle.outputFiles[0].text);
const {dismissNestedDialog} = await import(pathToFileURL(file).href);
function event() {let prevented = 0;return {preventDefault() {prevented++;}, get prevented() {return prevented;}};}
test('the pending child close intent is delegated before its Radix layer registers', () => {
  const e = event();let closes = 0;
  assert.equal(dismissNestedDialog(e, [{open: true, present: false, dismiss: () => closes++}]), true);
  assert.equal(closes, 1);assert.equal(e.prevented, 1);
});
test('an exiting child consumes repeated Escape without another navigation or parent close', () => {
  const e = event();let closes = 0;
  for (let n = 0; n < 2; n++) assert.equal(dismissNestedDialog(e, [{open: false, present: true, dismiss: () => closes++}]), true);
  assert.equal(closes, 0);assert.equal(e.prevented, 2);
});
test('a newer query modal wins over the previous modal retained for exit', () => {
  const e = event(), calls = [];
  assert.equal(dismissNestedDialog(e, [{open: false, present: true, dismiss: () => calls.push('old')}, {open: true, present: true, dismiss: () => calls.push('new')}]), true);
  assert.deepEqual(calls, ['new']);assert.equal(e.prevented, 1);
});
test('fully closed children release dismissal to their parent', () => {
  const e = event();assert.equal(dismissNestedDialog(e, [null, undefined, {open: false, present: false, dismiss() {throw Error('closed');}}]), false);
  assert.equal(e.prevented, 0);
});
test('retained dialogs reject stale dismissal and nested portals wait for the lower Radix effects', async () => {
  const source = await readFile(join(root, 'app/components/AnimatedDialog.tsx'), 'utf8');
  assert.match(source, /props\.open && parentReady &&/);
  assert.match(source, /present && live\.current\.mounted && live\.current\.props\.open && live\.current\.surface === surface\.current/);
  assert.equal((source.match(/if \(!ownsDismissal\(\)\) event\.preventDefault\(\)/g) ?? []).length, 3);
  assert.match(source, /<ParentDialogReady\.Provider value=\{childrenReady\}>\{children\}/);
  assert.match(source, /onPresenceChange\?\.\(false\)/);
});
test('direct upper modals wait for the committed lower slot and retain its direct-link focus fallback', async () => {
  const slot = await readFile(join(root, 'app/components/ManagementSurface.tsx'), 'utf8');
  assert.match(slot, /useEffect\(\(\) => slot\.current \? register\?\.\(slot\.current, level\)/);
  for (const name of ['HelpPanel', 'DonationPanel']) {
    const source = await readFile(join(root, `app/components/${name}.tsx`), 'utf8');
    assert.match(source, /if \(!parent\.ready\) return null/);assert.match(source, /returnFocus=\{parent\.returnFocus\}/);assert.match(source, /onPresenceChange=/);
  }
});
test('synthetic immediate-input fixtures use the DOM Router provider that implements public flushSync', async () => {
  for (const name of ['runtime-controls', 'room-panels', 'title-room-entry']) {
    const source = await readFile(join(root, `tests/ui-main/${name}-fixture.tsx`), 'utf8');
    assert.match(source, /import \{RouterProvider\} from 'react-router\/dom'/, name);
    assert.doesNotMatch(source, /import \{[^}]*RouterProvider[^}]*\} from 'react-router'/, name);
  }
});
test('the standalone Runtime fixture does not require a management slot it never renders', async () => {
  const source = await readFile(join(root, 'tests/ui-main/runtime-controls-fixture.tsx'), 'utf8');
  assert.match(source, /managementSurface\s*\? <ManagementSurfaceProvider runtimeSnapshot=\{snapshot\}>\{content\}<\/ManagementSurfaceProvider>\s*: content/);
  assert.match(source, /managementSurface \? <AnimatedDialog[^\n]*<ManagementSurfaceSlot\/><\/AnimatedDialog> : <Outlet\/>/);
});
test('an explicitly local child shields lower callbacks before the Radix highest-layer effect settles', async () => {
  const source = await readFile(join(root, 'app/components/AnimatedDialog.tsx'), 'utf8');
  const handler = source.slice(source.indexOf('onEscapeKeyDown={event =>'), source.indexOf('onPointerDownOutside={event =>'));
  const shield = handler.indexOf('if (localScope && localScope !== content.current) {event.preventDefault();return;}');
  assert.ok(shield >= 0 && shield < handler.indexOf('live.current.props.onEscapeKeyDown?.(event)'));
  assert.match(handler, /event\.target\.closest\('\[data-animated-dialog\]'\) === content\.current/);
  assert.match(source, /data-dialog-local-escape=\{onContentEscapeKeyDown \? true : undefined\}/);
  assert.doesNotMatch(source, /(?:document|window)\.addEventListener\(['"]key/);
});
