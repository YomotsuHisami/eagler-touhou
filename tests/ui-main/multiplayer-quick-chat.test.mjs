import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-quick-chat-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: "export * from './app/services/multiplayer-quick-chat.client.ts';", resolveDir: root}, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}]});
const modulePath = join(directory, 'quick-chat.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const {createMultiplayerQuickChatState, multiplayerQuickChatRuntimeMatches} = await import(pathToFileURL(modulePath).href);

function clock() {
  let now = 0, nextId = 0;
  const jobs = new Map();
  return {timers: {
    set(callback, ms) {const id = ++nextId; jobs.set(id, {callback, at: now + ms}); return id;},
    clear(id) {jobs.delete(id);},
  },
  advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; jobs.delete(next[0]); next[1].callback();
    }
    now = end;
  }, get size() {return jobs.size;}};
}
const baseContext = (patch = {}) => ({visible: true, room: 'th08mp-1234', sessionSerial: 7, serial: 3,
  localSeat: 0, seats: [{clientId: 'client-host', name: 'Host'}, {clientId: 'client-peer', name: 'Peer'}, null],
  connected: true, language: 'ja', lessMotion: true, ...patch});
const validEvent = (patch = {}) => ({room: 'th08mp-1234', sessionSerial: 7, serial: 3,
  seat: 1, clientId: 'client-peer', phrase: {id: 'thanks', zh: 'forged', en: 'forged'}, ...patch});

test('shows chat only for the exact active multiplayer Runtime, room, and run serial', () => {
  const request = {launched: true, ready: true, runtimeVariant: 'multiplayer', runtimeEpoch: 14,
    launcherVariant: 'multiplayer', launcherEpoch: 14, launcherGame: 'th08', expectedGame: 'th08', replayViewer: false,
    netplayUrl: 'wss://relay.example.test/netplay?room=th08mp-1234&run=3&player=0', roomId: 'th08mp-1234', serial: 3};
  assert.equal(multiplayerQuickChatRuntimeMatches(request), true);
  for (const patch of [
    {launched: false}, {ready: false}, {runtimeVariant: 'normal'}, {runtimeEpoch: 13},
    {launcherEpoch: 13}, {launcherGame: 'th10'}, {replayViewer: true},
    {netplayUrl: 'wss://relay.example.test/netplay?room=th07mp-1234&run=3'},
    {netplayUrl: 'wss://relay.example.test/netplay?room=th08mp-1234&run=2'},
  ]) assert.equal(multiplayerQuickChatRuntimeMatches({...request, ...patch}), false);
});

test('accepts only canonical current-session phrases and derives the author from the current seat', () => {
  const state = createMultiplayerQuickChatState();
  state.update(baseContext());
  assert.equal(state.receive(validEvent({name: 'forged'})), true);
  assert.deepEqual(state.getSnapshot().entries.map(({name, phrase}) => [name, phrase.zh]), [['Peer', '谢谢指教']]);
  for (const event of [
    validEvent({room: 'th07mp-1234'}),
    validEvent({sessionSerial: 6}),
    validEvent({serial: 2}),
    validEvent({serial: 0}),
    validEvent({phrase: {id: 'arbitrary-text'}}),
    validEvent({seat: 0, clientId: 'client-peer'}),
    validEvent({seat: 2, clientId: 'client-peer'}),
    validEvent({seat: 1.5}),
  ]) assert.equal(state.receive(event), false);
  state.update(baseContext({visible: false}));
  assert.equal(state.receive(validEvent()), false);
  state.update(baseContext({serial: 0}));
  assert.equal(state.receive(validEvent({serial: 0})), false);
  assert.equal(state.getSnapshot().entries.length, 0);
  state.dispose();
});

test('resets transient messages, mutes and menus across room/session generations and gates sending', () => {
  const state = createMultiplayerQuickChatState();
  state.update(baseContext());
  state.receive(validEvent());
  state.setMuted('client-peer', true);
  assert.deepEqual(state.visibleEntries(), []);
  state.togglePicker();
  assert.equal(state.getSnapshot().pickerOpen, true);
  state.update(baseContext({room: 'th08mp-5678', sessionSerial: 8, serial: 1}));
  assert.equal(state.getSnapshot().entries.length, 0);
  assert.deepEqual(state.getSnapshot().muted, []);
  assert.equal(state.getSnapshot().pickerOpen, false);

  let sent = 0;
  state.update(baseContext({visible: false}));
  assert.equal(state.send('thanks', () => {sent++; return true;}), false);
  state.update(baseContext({localSeat: null}));
  assert.equal(state.send('thanks', () => {sent++; return true;}), false, 'spectators may mute but cannot send');
  state.update(baseContext({connected: false}));
  assert.equal(state.send('thanks', () => {sent++; return true;}), false);
  state.update(baseContext());
  state.togglePicker();
  assert.equal(state.send('not-canonical', () => {sent++; return true;}), false);
  assert.equal(state.send('thanks', id => {assert.equal(id, 'thanks'); sent++; return true;}), true);
  assert.equal(sent, 1);
  assert.equal(state.getSnapshot().pickerOpen, false);
  state.dispose();
});

test('caps the transient log, expires entries, honors reduced motion and clears timers on dispose', () => {
  const time = clock(), state = createMultiplayerQuickChatState({timers: time.timers, maxEntries: 2});
  state.update(baseContext({lessMotion: false}));
  assert.equal(state.receive(validEvent({phrase: {id: '1'}})), true);
  assert.equal(state.receive(validEvent({phrase: {id: 'follow-me'}})), true);
  assert.equal(state.receive(validEvent({phrase: {id: 'thanks'}})), true);
  assert.deepEqual(state.getSnapshot().entries.map(entry => entry.phrase.id), ['follow-me', 'thanks']);
  assert.equal(time.size, 2, 'discarding the oldest entry cancels its timer');
  time.advance(3000);
  assert.ok(state.getSnapshot().entries.every(entry => entry.fading));
  assert.equal(state.getSnapshot().entries.length, 2);
  time.advance(280);
  assert.equal(state.getSnapshot().entries.length, 0);

  state.update(baseContext({lessMotion: true}));
  state.receive(validEvent());
  time.advance(3000);
  assert.equal(state.getSnapshot().entries.length, 0, 'reduced motion expires without a fade delay');
  state.receive(validEvent());
  assert.equal(time.size, 1);
  state.dispose();
  assert.equal(time.size, 0);
});
