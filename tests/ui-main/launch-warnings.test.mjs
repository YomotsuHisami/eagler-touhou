/** Pure acknowledgment gate tests; no browser or native Runtime is started. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const result = await build({entryPoints: ['app/services/launch-warnings.ts'], bundle: true, format: 'esm', platform: 'browser', write: false});
const dir = await mkdtemp(join(tmpdir(), 'launch-warnings-')); after(() => rm(dir, {recursive: true, force: true}));
const path = join(dir, 'gate.mjs'); await writeFile(path, result.outputFiles[0].text);
const {launchInputWarnings, createLaunchWarningGate} = await import(pathToFileURL(path).href);
const desktop = {maxTouchPoints: 0, anyFinePointer: true, userAgent: 'Desktop'};
const touch = 'touch.disabledInputWarning', none = 'music.noneLaunchWarning', midi = 'music.midiLaunchWarning';
test('current-main mobile/pure-touch detection and warning order are preserved', () => {
  for (const device of [{maxTouchPoints: 1, anyFinePointer: false}, {userAgent: 'Android', anyFinePointer: true},
    {userAgent: 'iPhone'}, {userAgent: 'Macintosh', maxTouchPoints: 5}, {mobile: true}]) {
    assert.deepEqual(launchInputWarnings({touchEnabled: false, music: 'midi'}, {...desktop, ...device}), [touch, midi]);
    assert.deepEqual(launchInputWarnings({touchEnabled: true, music: 'none'}, {...desktop, ...device}), [none]);
  }
  assert.deepEqual(launchInputWarnings({touchEnabled: false, music: 'ogg'}, {...desktop, maxTouchPoints: 10}), []);
  assert.deepEqual(launchInputWarnings({touchEnabled: false, music: 'ogg'}, desktop), []);
  assert.deepEqual(launchInputWarnings({touchEnabled: true, music: 'midi'}, desktop), [midi]);
});
test('each warning requires acknowledgment; the final button invokes Start synchronously exactly once', async () => {
  const gate = createLaunchWarningGate(); let starts = 0, finish;
  const task = gate.request({warnings: [touch, midi], current: () => true, accept: () => {starts++; return new Promise(resolve => {finish = resolve;});}});
  const first = gate.getSnapshot(); gate.accept(first); assert.equal(starts, 0);
  const second = gate.getSnapshot(); assert.equal(second.warning, midi);
  gate.accept(first); assert.equal(gate.getSnapshot(), second);
  gate.accept(second); assert.equal(starts, 1); assert.equal(gate.getSnapshot(), null);
  gate.accept(second); assert.equal(starts, 1); finish(); assert.equal(await task, true);
});
test('Cancel, Escape/dismiss, replacement and abort never approve a later intent', async () => {
  for (const end of ['cancel', 'dismiss', 'abort', 'replace']) {
    const gate = createLaunchWarningGate(), signal = new AbortController(); let starts = 0;
    const request = {warnings: [none], current: () => true, accept: () => {starts++;}, signal: signal.signal};
    const first = gate.request(request), old = gate.getSnapshot();
    let next;
    if (end === 'cancel') gate.cancel();
    if (end === 'dismiss') gate.dismiss(old);
    if (end === 'abort') signal.abort();
    if (end === 'replace') next = gate.request({...request, signal: undefined});
    gate.accept(old); gate.dismiss(old); assert.equal(await first, false); assert.equal(starts, 0);
    if (next) {assert.ok(gate.getSnapshot()); gate.accept(gate.getSnapshot()); assert.equal(await next, true); assert.equal(starts, 1);}
  }
});
test('invalidated epoch/settings/file lock/save guard and unavailable sources fail closed', async () => {
  for (const throws of [false, true]) {
    const gate = createLaunchWarningGate(); let valid = true, starts = 0;
    const task = gate.request({warnings: [none], current: () => {if (!valid && throws) throw Error('source gone'); return valid;}, accept: () => {starts++;}});
    const prompt = gate.getSnapshot(); valid = false; gate.accept(prompt); assert.equal(await task, false); assert.equal(starts, 0);
  }
});
test('recheck dismisses an invalid prompt; empty warnings retain the original gesture stack', async () => {
  const gate = createLaunchWarningGate(); let valid = true, starts = 0;
  const task = gate.request({warnings: [none], current: () => valid, accept: () => {starts++;}});
  valid = false; gate.recheck(); assert.equal(gate.getSnapshot(), null); assert.equal(await task, false);
  const direct = gate.request({warnings: [], current: () => true, accept: () => {starts++;}});
  assert.equal(starts, 1); assert.equal(await direct, true);
});
test('MIDI refusal rejects only that request and never leaves a reusable approval', async () => {
  const gate = createLaunchWarningGate(); const task = gate.request({warnings: [midi], current: () => true, accept: () => {throw Error('Audio denied');}});
  const prompt = gate.getSnapshot(); gate.accept(prompt); await assert.rejects(task, /Audio denied/); assert.equal(gate.getSnapshot(), null);
  let starts = 0; const next = gate.request({warnings: [midi], current: () => true, accept: () => {starts++;}});
  gate.accept(prompt); assert.equal(starts, 0); gate.cancel(); assert.equal(await next, false);
});
test('warning views reuse dialog/focus ownership and never persist options or launch a room themselves', async () => {
  const view = await readFile('app/components/LaunchWarnings.tsx', 'utf8');
  assert.match(view, /<AnimatedDialog/); assert.match(view, /initialFocus=\{cancel\}/);
  assert.doesNotMatch(view, /localStorage|setOptions|\.launch\(|\.start\(|useBlocker|history\./);
  const provider = await readFile('app/components/MultiplayerRoomProvider.tsx', 'utf8');
  assert.match(provider, /selected\.startSerial === request\.serial/);
  assert.match(provider, /selected\.room\?\.localSeat === request\.options\.netplayPlayer/);
  assert.match(provider, /selected\.preparation\?\.status === 'ready'/);
});
