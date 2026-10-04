import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `export * from './app/services/room-panel-route'; export * from './app/services/room-panel-navigation'; export * from './app/services/multiplayer-room-route';`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'ui-room-panels-')); after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'entry.mjs'); await writeFile(file, bundle.outputFiles[0].text);
const {roomPanelKind, roomPanelAddress, sameRoomPanelAddress, parseMultiplayerRoomRoute, createRoomPanelNavigation} = await import(pathToFileURL(file).href);
const base = {pathname: '/play/th09', search: '?uiLocale=en&titleRoom=7&mpRoom=1234&room=1234&extra=a%2Bb&extra=two', hash: '#room', key: 'room', state: {keep: 'state'}};
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function fixture(location = base) {
  const calls = [];let current = {location, navigation: {state: 'idle'}};
  const nav = createRoomPanelNavigation('fixture', (target, options) => {const gate = deferred();calls.push({target, options, gate});return gate.promise;}, current);
  function update(next) {current = next; nav.update(next);}
  function entry(index = calls.length - 1) {const call = calls[index];return {...call.target, key: `entry-${index}`, state: call.options.state};}
  function pending(index = calls.length - 1) {update({location: current.location, navigation: {state: 'loading', location: entry(index)}});}
  async function commit(index = calls.length - 1) {const location = entry(index);update({location, navigation: {state: 'idle'}});calls[index].gate.resolve();await Promise.resolve();}
  return {nav, calls, update, entry, pending, commit};
}
test('all room sheets and legacy roomOptions share one exact query contract', () => {
  for (const kind of ['personal', 'game', 'network', 'spectators', 'options']) {
    const opened = roomPanelAddress(base, kind);assert.equal(roomPanelKind(opened.search), kind);
    assert.deepEqual(roomPanelAddress(opened, null), {pathname: base.pathname, search: base.search, hash: base.hash});
    assert.equal(parseMultiplayerRoomRoute(opened.pathname, opened.search, 7).roomCode, '1234');
    assert.equal(parseMultiplayerRoomRoute(opened.pathname, opened.search, 7).productId, 'th09mp');
    assert.equal(sameRoomPanelAddress(opened, {...opened, search: opened.search.slice(1)}), true);
  }
  assert.equal(roomPanelKind('?roomPanel=unknown'), null);
  assert.equal(roomPanelKind('?roomOptions=1&roomPanel=personal'), 'options');
  assert.equal(roomPanelKind('?roomPanel=options'), null);
});
test('opening and repeated clicks create one entry; Escape returns once without leaving room', async () => {
  const f = fixture();f.nav.open('personal');f.nav.open('personal');assert.equal(f.calls.length, 1);assert.equal(f.calls[0].options.replace, false);
  f.pending();f.nav.close();f.nav.close();assert.equal(f.calls.length, 1);
  await f.commit();assert.equal(f.calls.length, 2);assert.equal(f.calls[1].target, -1);
  f.nav.close();assert.equal(f.calls.length, 2);
});
test('a navigation promise before React commit still waits for the exact committed receipt', async () => {
  const f = fixture();f.nav.open('network');f.pending();f.nav.close();f.calls[0].gate.resolve();await Promise.resolve();assert.equal(f.calls.length, 1);
  await f.commit(0);assert.equal(f.calls[1].target, -1);
});
test('a newer navigation or disposal cancels a held close rather than going Back over it', async () => {
  for (const action of ['newer', 'dispose']) {
    const f = fixture();f.nav.open('game');f.pending();f.nav.close();
    if (action === 'dispose') f.nav.dispose();
    else f.update({location: base, navigation: {state: 'loading', location: {...base, pathname: '/lobby', search: '?uiLocale=en', key: 'newer'}}});
    f.calls[0].gate.resolve();await Promise.resolve();assert.equal(f.calls.length, 1);
  }
});
test('direct links and untrusted stale history state close with replace and preserve all unrelated data', () => {
  for (const state of [null, {keep: 'state', roomPanelRequestId: 'old-document-1', roomOptionsParent: '/lobby'}]) {
    const location = {...base, ...roomPanelAddress(base, 'network'), state};const f = fixture(location);f.nav.close();
    assert.equal(f.calls.length, 1);assert.equal(f.calls[0].options.replace, true);assert.deepEqual(f.calls[0].target, roomPanelAddress(base, null));
    assert.equal(f.calls[0].options.state.roomPanelRequestId, undefined);assert.equal(f.calls[0].options.state.keep, state?.keep);
  }
});
test('section switching and roomOptions reuse the panel slot; Forward remains dismissible', async () => {
  const f = fixture();f.nav.open('personal');await f.commit();f.nav.open('options');await f.commit();
  assert.equal(f.calls[1].options.replace, true);assert.equal(roomPanelKind(f.calls[1].target.search), 'options');
  f.nav.close();assert.equal(f.calls[2].target, -1);
  f.update({location: base, navigation: {state: 'idle'}});f.update({location: f.entry(1), navigation: {state: 'idle'}});f.nav.close();
  assert.equal(f.calls[3].target, -1);
});
test('superseding an uncommitted panel push never replaces the room entry', async () => {
  const f = fixture();f.nav.open('personal');f.pending();f.nav.open('network');assert.equal(f.calls[1].options.replace, false);
  f.calls[0].gate.resolve();await f.commit(1);f.nav.close();assert.equal(f.calls[2].target, -1);
});
test('reopening before held close acknowledgment cancels that dismissal', async () => {
  const f = fixture();f.nav.open('personal');f.pending();f.nav.close();f.nav.open('personal');await f.commit();assert.equal(f.calls.length, 1);
  f.nav.close();assert.equal(f.calls[1].target, -1);
});
test('changed query under an old receipt is cleaned locally instead of following stale history', async () => {
  const f = fixture();f.nav.open('personal');await f.commit();const location = {...f.entry(0), search: f.entry(0).search + '&newer=1', key: 'changed'};
  f.update({location, navigation: {state: 'idle'}});f.nav.close();assert.equal(f.calls[1].options.replace, true);
  assert.equal(new URLSearchParams(f.calls[1].target.search).get('newer'), '1');assert.equal(new URLSearchParams(f.calls[1].target.search).get('mpRoom'), '1234');
});
test('room and embedded title reuse existing dialog/forms rather than a second room/Runtime owner', async () => {
  const room = await readFile(join(root, 'app/components/MultiplayerRoom.tsx'), 'utf8');
  assert.doesNotMatch(room, /<details|navigator\.clipboard|createMultiplayerRoom\(|createRuntimeService\(/);
  assert.equal((room.match(/<AnimatedDialog\s/g) ?? []).length, 1);assert.match(room, /<GameSettings productId=\{route.productId\}/);assert.match(room, /<HelpLink/);
  const entry = await readFile(join(root, 'app/components/TitleRoomEntry.tsx'), 'utf8');assert.doesNotMatch(entry, /<GameSettings/);assert.match(entry, /<MultiplayerRoomView/);
  const route = await readFile(join(root, 'app/routes/game-settings.tsx'), 'utf8');assert.match(route, /if \(room\) return <MultiplayerRoom\/>/);
});
