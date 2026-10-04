/** Synthetic epoch/Router ports. No native game, relay or browser execution. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `export * from './app/services/title-room-entry.client'; export * from './app/services/multiplayer-room-route';`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'ui-title-entry-')); after(() => rm(folder, {recursive: true, force: true}));
const path = join(folder, 'entry.mjs'); await writeFile(path, bundle.outputFiles[0].text);
const {createTitleRoomEntry, parseMultiplayerRoomRoute} = await import(pathToFileURL(path).href);
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function fixture() {
  let snapshot = {epoch: 7, game: 'th09', runtimeVariant: 'normal', ready: true, launched: true, phase: 'running', saveError: null, closeError: null};
  const listeners = new Set(), events = new Set(), inputs = [], requested = [], retired = [], closes = [];
  let closing = async () => {update({epoch: null, ready: false, launched: false, phase: 'idle'}); return true;};
  const runtime = {getSnapshot: () => snapshot, subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);},
    subscribeEvents: callback => {events.add(callback); return () => events.delete(callback);},
    postInput: (...args) => {inputs.push(args);return true;}, close: (...args) => {closes.push({args, epoch: snapshot.epoch});return closing();}};
  function update(patch) {snapshot = {...snapshot, ...patch}; for (const callback of listeners) callback();}
  const owner = createTitleRoomEntry({runtime, onRequest: value => requested.push(value), onRetired: value => retired.push(value)}); after(() => owner.dispose());
  function emit(patch = {}) {for (const callback of events) callback({event: 'network-request', epoch: 7, game: 'th09', ...patch});}
  function select(code = '1234') {const route = parseMultiplayerRoomRoute('/play/th09', `?titleRoom=7&mpRoom=${code}`, 7); owner.setRoute(route); return route;}
  const request = {productId: 'th09mp', roomCode: '1234', serial: 1, options: {}};
  return {owner, runtime, update, emit, select, request, inputs, requested, retired, closes, setClose: callback => {closing = callback;}, retire: signal => owner.retire(request, signal ?? new AbortController().signal)};
}

test('only a live normal TH09 native epoch opens title entry; duplicate/stale requests are inert', () => {
  const f = fixture();
  f.emit({epoch: 6}); f.emit({game: 'th08'}); f.emit({event: 'first-frame'}); assert.equal(f.requested.length, 0);
  f.update({runtimeVariant: 'multiplayer'}); f.emit(); assert.equal(f.requested.length, 0);
  f.update({runtimeVariant: 'normal', launched: false}); f.emit(); assert.equal(f.requested.length, 0);
  f.update({launched: true}); f.emit(); f.emit(); assert.equal(f.requested.length, 1);
  assert.deepEqual(f.owner.getSnapshot().source, {epoch: 7, game: 'th09', productId: 'th09mp'});
  f.select(); assert.equal(f.owner.retains('th09mp'), true); assert.equal(f.owner.retains('th08mp'), false);
});
test('Router title aliases require the current request receipt; refresh/Forward cannot revive dismissed membership', () => {
  assert.equal(parseMultiplayerRoomRoute('/play/th09', '?titleRoom=7&mpRoom=1234'), null);
  assert.equal(parseMultiplayerRoomRoute('/play/th09', '?titleRoom=6&mpRoom=1234', 7), null);
  assert.equal(parseMultiplayerRoomRoute('/play/th08', '?titleRoom=7&mpRoom=1234', 7), null);
  assert.equal(parseMultiplayerRoomRoute('/play/th09', '?titleRoom=7&mpRoom=bad', 7), null);
  assert.equal(parseMultiplayerRoomRoute('/play/th09/replays', '?titleRoom=7&mpRoom=1234&panel=help', 7).productId, 'th09mp');
  assert.equal(parseMultiplayerRoomRoute('/play/th09mp', '?mpRoom=1234').productId, 'th09mp');
});
test('Back from room to entry releases retention; close resumes exactly the original title once', () => {
  const f = fixture(); f.emit(); f.select(); f.owner.setRoute(null);
  assert.equal(f.owner.retains('th09mp'), false); assert.equal(f.inputs.length, 0);
  f.owner.dismiss(); f.owner.dismiss(); assert.deepEqual(f.inputs, [['network-cancel', {}]]);
  assert.equal(f.owner.getSnapshot().source, null); assert.equal(f.closes.length, 0);
  f.emit(); f.select('5678'); assert.equal(f.requested.length, 2); assert.equal(f.owner.retains('th09mp'), true);
});
test('replaced, ended or lost Runtime cannot receive title cancel or confer launch authority', async () => {
  for (const replacement of [{epoch: 8}, {phase: 'exited', launched: false}, {saveUnavailable: true}]) {
    const f = fixture(); f.emit(); f.select(); f.update(replacement); f.owner.dismiss();
    assert.equal(f.owner.getSnapshot().source, null); assert.equal(f.inputs.length, 0); await assert.rejects(f.retire(), /no longer available/); assert.equal(f.closes.length, 0);
  }
});
test('server start save-closes the exact title before canonical room handoff; no discard flag or network cancel', async () => {
  const f = fixture(); f.emit(); f.select(); await f.retire();
  assert.deepEqual(f.closes, [{args: [], epoch: 7}]); assert.equal(f.retired.length, 1); assert.equal(f.inputs.length, 0); assert.equal(f.owner.getSnapshot().source, null);
});
test('save/close refusal preserves original title, receipt and retry path', async () => {
  const f = fixture(); f.emit(); f.select();
  f.setClose(async () => {f.update({saveError: 'save blocked'});return false;});
  await assert.rejects(f.retire(), /save blocked/); assert.equal(f.runtime.getSnapshot().epoch, 7); assert.equal(f.owner.getSnapshot().source.epoch, 7); assert.equal(f.owner.getSnapshot().retiring, false); assert.equal(f.retired.length, 0);
  f.setClose(async () => {f.update({epoch: null, ready: false, launched: false, saveError: null});return true;});
  await f.retire(); assert.equal(f.retired.length, 1);
});
test('unrelated room/product, repeated start and abort cannot retire or replace another epoch', async () => {
  const f = fixture(); f.emit(); f.select();
  await assert.rejects(f.owner.retire({...f.request, roomCode: '9999'}, new AbortController().signal), /superseded/);
  await assert.rejects(f.owner.retire({...f.request, productId: 'th08mp'}, new AbortController().signal), /no longer available/);
  const signal = new AbortController(); signal.abort(); await assert.rejects(f.retire(signal.signal), /superseded/); assert.equal(f.closes.length, 0);
  const gate = deferred(); f.setClose(() => gate.promise); const pending = f.retire(); await assert.rejects(f.retire(), /no longer available/);
  f.owner.setRoute(null); gate.resolve(true); await assert.rejects(pending, /superseded/); assert.equal(f.retired.length, 0);
});
test('abort or new Runtime while close is in flight never proceeds to multiplayer handoff', async () => {
  const f = fixture(), gate = deferred(), signal = new AbortController(); f.emit(); f.select(); f.setClose(() => gate.promise);
  const pending = f.retire(signal.signal); signal.abort(); f.update({epoch: 8}); gate.resolve(true);
  await assert.rejects(pending, /superseded/); assert.equal(f.retired.length, 0); f.owner.dismiss(); assert.equal(f.inputs.length, 0);
});
test('dispose only removes subscriptions; it never takes over Runtime lifecycle', () => {
  const f = fixture(); f.emit(); f.select(); f.owner.dispose(); f.emit(); assert.equal(f.requested.length, 1); assert.equal(f.inputs.length, 0); assert.equal(f.closes.length, 0);
});
test('fullscreen room reuses the existing AnimatedDialog focus and animation owner with unchanged default layout', async () => {
  const source = await readFile(join(root, 'app/components/AnimatedDialog.tsx'), 'utf8');
  assert.match(source, /layout = 'dialog'/); assert.match(source, /layout === 'fullscreen' \? 'fixed inset-0 overflow-y-auto/);
  const entry = await readFile(join(root, 'app/components/TitleRoomEntry.tsx'), 'utf8');
  assert.match(entry, /<AnimatedDialog/); assert.match(entry, /layout=\{inRoom \? 'fullscreen' : 'dialog'\}/); assert.doesNotMatch(entry, /<iframe|createMultiplayerRoom\(|createRuntimeService\(|pushState|replaceState/);
});
