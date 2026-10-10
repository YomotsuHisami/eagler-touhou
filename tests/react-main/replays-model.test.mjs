/** Original main6440–6580 Replay behavior through synthetic native ports only. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url));
let work, createReplayModel, formatReplayBytes;
before(async () => {
  await mkdir(resolve(root, '.cache'), {recursive: true}); work = await mkdtemp(resolve(root, '.cache/replays-main-'));
  const outfile = resolve(work, 'replays.mjs');
  await build({entryPoints: [resolve(root, 'app/models/replays.ts')], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{name: 'authored-main', setup(ctx) {ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const path = resolve(dirname(args.importer), args.path), source = path.slice(0, -4) + '.mts';
      if (path.startsWith(resolve(root, 'src') + '/') && existsSync(source)) return {path: source};
    });}}]});
  ({createReplayModel, formatReplayBytes} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({cold = false, launched = false, prepareGate = null, broken = false} = {}) {
  const files = new Map([['replay/th6_02.rpy', [2]], ['replay/th6_01.rpy', [1, 1]], ['score.dat', [9]]]);
  const events = [], toasts = [], downloads = [], confirms = [];
  const state = {ready: !cold, epoch: cold ? null : 1, launched, game: 'th06'};
  let answer = null, confirmed = true;
  const model = createReplayModel({
    runtime: {getSnapshot: () => state, async withFileSession(game, op) {
      events.push('lock');
      try {return await op({epoch: state.epoch, async sync() {events.push('sync');}, async send(command, payload) {
        events.push(`${command}:${payload.path ?? ''}`);
        if (broken) throw new Error('fixture read failure');
        if (command === 'list') return {files: [...files].map(([path, bytes]) => ({path, size: bytes.length}))};
        if (command === 'read') return {bytes: files.get(payload.path)};
        if (command === 'write') files.set(payload.path, payload.bytes);
        if (command === 'remove') files.delete(payload.path);
        return {};
      }});} finally {events.push('unlock');}
    }},
    async prepareFiles() {events.push('prepare'); if (prepareGate) await prepareGate.promise; state.ready = true; state.epoch ??= 1;},
    async releasePrepared(product, epoch) {events.push(`release:${product}:${epoch}`); state.ready = false; state.epoch = null;},
    translate: (key, params) => key + (params ? JSON.stringify(params) : ''),
    prompt(message, name) {events.push(`prompt:${message}:${name}`); return answer;},
    async confirm(decision) {confirms.push(decision); return confirmed;},
    download(name, bytes, mime) {downloads.push({name, bytes: [...new Uint8Array(bytes)], mime});},
    toast(message) {toasts.push(message);}, async afterPaint() {events.push('paint');}, afterClose() {events.push('afterClose');},
  });
  return {model, files, events, toasts, downloads, confirms, state, answer(value) {answer = value;}, confirm(value) {confirmed = value;}};
}
test('opens original loading state before paint, lists only sorted replay files, initial animation only', async () => {
  const f = fixture(); const opening = f.model.open('th06');
  assert.equal(f.model.getSnapshot().phase, 'loading'); await opening;
  assert.deepEqual(f.model.getSnapshot().rows.map(x => x.path), ['replay/th6_01.rpy', 'replay/th6_02.rpy']);
  assert.equal(f.model.getSnapshot().animateRows, true);
  assert.deepEqual(f.events.slice(0, 5), ['paint', 'prepare', 'lock', 'sync', 'list:']);
  await f.model.refresh(); assert.equal(f.model.getSnapshot().animateRows, false);
  assert.equal(formatReplayBytes(2), '0.0 KiB'); assert.equal(formatReplayBytes(1048576), '1.00 MiB');
});
test('load failure leaves original failure phase and propagates to action feedback', async () => {
  const f = fixture({broken: true}); await assert.rejects(f.model.open('th06'), /fixture read failure/);
  assert.equal(f.model.getSnapshot().phase, 'error'); assert.deepEqual(f.model.getSnapshot().rows, []);
});
test('rename refreshes current collision list, writes new bytes before removing old path', async () => {
  const f = fixture(); await f.model.open('th06'); f.events.length = 0; f.answer('th6_03.rpy');
  await f.model.rename('replay/th6_01.rpy');
  assert.ok(f.events[0].startsWith('prompt:replay.renamePrompt:th6_01.rpy'));
  assert.deepEqual(f.events.slice(1, 9), ['prepare', 'lock', 'sync', 'list:', 'read:replay/th6_01.rpy', 'write:replay/th6_03.rpy', 'remove:replay/th6_01.rpy', 'unlock']);
  assert.deepEqual(f.files.get('replay/th6_03.rpy'), [1, 1]); assert.equal(f.files.has('replay/th6_01.rpy'), false);
});
test('rename cancellation/empty/invalid/case-only no-op never mutates file storage', async () => {
  const f = fixture(); await f.model.open('th06'); f.events.length = 0;
  await f.model.rename('replay/th6_01.rpy');
  await f.model.rename('replay/th6_01.rpy', ' ');
  await f.model.rename('replay/th6_01.rpy', 'evil.rpy');
  await f.model.rename('replay/th6_01.rpy', 'TH6_01.RPY');
  assert.equal(f.events.some(x => x.startsWith('write:') || x.startsWith('remove:') || x === 'prepare'), false);
  assert.ok(f.toasts.some(x => x.includes('replay.nameEmpty'))); assert.ok(f.toasts.some(x => x.includes('replay.nameInvalid')));
});
test('rename collision fails before read/write/remove', async () => {
  const f = fixture(); await f.model.open('th06'); f.events.length = 0;
  await f.model.rename('replay/th6_01.rpy', 'th6_02.rpy');
  assert.equal(f.events.some(x => x.startsWith('read:') || x.startsWith('write:') || x.startsWith('remove:')), false);
  assert.ok(f.toasts.some(x => x.includes('replay.nameExists')));
});
test('delete danger confirmation cancellation leaves stored replay untouched', async () => {
  const f = fixture(); await f.model.open('th06'); f.confirm(false); f.events.length = 0;
  await f.model.remove('replay/th6_01.rpy');
  assert.deepEqual(f.events, []); assert.equal(f.confirms[0].tone, 'danger'); assert.equal(f.files.has('replay/th6_01.rpy'), true);
});
test('download uses original filename and bytes without replay mutation', async () => {
  const f = fixture({launched: true}); await f.model.open('th06'); await f.model.download('replay/th6_01.rpy');
  assert.deepEqual(f.downloads, [{name: 'th6_01.rpy', bytes: [1, 1], mime: 'application/octet-stream'}]);
  f.model.close(); await tick(); assert.equal(f.events.some(x => x.startsWith('release:')), false);
});
test('owned cold preload closes only after shared mutation queue settles', async () => {
  const f = fixture({cold: true}); await f.model.open('th06'); const gate = deferred();
  const pending = f.model.mutations.run(() => gate.promise); f.model.close(); await tick();
  assert.equal(f.events.some(x => x.startsWith('release:')), false);
  gate.resolve(); await pending; await tick(); assert.equal(f.events.includes('release:th06:1'), true);
});
test('late close cleanup cannot retire a newer Runtime epoch', async () => {
  const f = fixture({cold: true}); await f.model.open('th06'); const gate = deferred();
  const pending = f.model.mutations.run(() => gate.promise); f.model.close(); f.state.epoch = 2;
  gate.resolve(); await pending; await tick(); assert.equal(f.events.some(x => x.startsWith('release:')), false);
});
test('close during cold preparation never republishes rows and retires only acquired epoch', async () => {
  const gate = deferred(), f = fixture({cold: true, prepareGate: gate});
  const opening = f.model.open('th06'); await tick(); f.model.close(); gate.resolve(); await opening; await tick();
  assert.equal(f.model.getSnapshot().open, false); assert.deepEqual(f.model.getSnapshot().rows, []);
  assert.equal(f.events.includes('release:th06:1'), true);
});

test('closing manager waits for an already committed queued rename rather than cancelling it', async () => {
  const f = fixture({cold: true}); await f.model.open('th06');
  const gate = deferred(); const blocker = f.model.mutations.run(() => gate.promise);
  const renamed = f.model.rename('replay/th6_01.rpy', 'th6_03.rpy');
  f.model.close(); gate.resolve(); await blocker; await renamed; await tick();
  assert.deepEqual(f.files.get('replay/th6_03.rpy'), [1, 1]);
  assert.equal(f.files.has('replay/th6_01.rpy'), false);
  assert.equal(f.events.includes('release:th06:1'), true);
});
