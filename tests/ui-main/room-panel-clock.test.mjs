/** Deterministic reproduction of the CI request counter failure; no browser. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRoomPanelClock} from './room-panels-clock.ts';
import {importUiModule} from '../support/import-ui-module.mjs';
const {createMultiplayerRoom, parseMultiplayerRoomRoute} = await importUiModule('app/services/multiplayer-room.client.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('room fixture clock never arms wall-clock timers and runs explicit advances in deadline order', () => {
  const clock = createRoomPanelClock(), calls = [];
  const cancelled = clock.set(() => calls.push('cancelled'), 5);clock.clear(cancelled);
  clock.set(() => {calls.push(['first', clock.now()]);clock.set(() => calls.push(['nested', clock.now()]), 2);}, 10);
  clock.set(() => calls.push(['second', clock.now()]), 10);
  assert.deepEqual(calls, []);clock.advance(9);assert.deepEqual(calls, []);
  clock.advance(3);assert.deepEqual(calls, [['first', 10], ['second', 10], ['nested', 12]]);assert.deepEqual(clock.pending(), []);
  assert.throws(() => clock.advance(-1), /nonnegative/);assert.throws(() => clock.advance(Infinity), /finite/);
});

test('404 Host schedules the observed second request at 650 ms, independently of room-panel/StrictMode route repeats', async t => {
  const clock = createRoomPanelClock(), requests = [], sockets = [];
  const controller = createMultiplayerRoom({baseUrl: 'https://synthetic.invalid/', timers: clock, now: clock.now, random: () => 0,
    fetchImpl: async url => {requests.push({at: clock.now(), url: String(url)});return new Response(null, {status: 404});},
    createSocket: url => {sockets.push(url);throw Error('No relay may be connected');}, getMemberId: () => 'member_synthetic_123',
    identity: {loadDisplayName: () => '', displayNameLocked: () => false, lobbyClientId: () => 'client_synthetic_123', storeDisplayNameOnce: name => ({stored: false, name})},
    sessions: {load: () => null, save() {}, clear() {}},
    preferences: {load: () => ({shareSingleplayerSettings: true, preferredLoadout: 0}), persistPreferredLoadout() {}, persistShareSingleplayerSettings() {}},
  });
  t.after(() => controller.dispose());
  const route = parseMultiplayerRoomRoute('/play/th06mp', '?uiLocale=en&mpRoom=1234&room=1234');
  controller.setRoute(route);controller.setRoute(route); // Same effect replay is intentionally a no-op.
  await tick();assert.equal(requests.length, 1);assert.equal(controller.getSnapshot().connection, 'reconnecting');
  assert.deepEqual(clock.pending(), [650]);
  for (const suffix of ['&roomPanel=personal', '&roomOptions=1', '&panel=help', '']) {
    controller.setRoute({...route, search: route.search + suffix});
    assert.equal(controller.getSnapshot().route, route);
    assert.equal(requests.length, 1);assert.deepEqual(clock.pending(), [650]);
  }
  clock.advance(649);await tick();assert.equal(requests.length, 1);
  clock.advance(1);await tick();assert.deepEqual(requests.map(request => request.at), [0, 650]);
  assert.equal(controller.getSnapshot().route, route);assert.equal(controller.getSnapshot().connection, 'reconnecting');
  assert.deepEqual(clock.pending(), [1950]);assert.deepEqual(sockets, []);
  clock.advance(1299);await tick();assert.equal(requests.length, 2);
  clock.advance(1);await tick();assert.deepEqual(requests.map(request => request.at), [0, 650, 1950]);
  controller.setRoute(null);assert.deepEqual(clock.pending(), []);
  clock.advance(100_000);await tick();assert.equal(requests.length, 3);assert.deepEqual(sockets, []);
});
