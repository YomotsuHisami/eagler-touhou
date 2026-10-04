/** Exact fixture-wiring regression for CI run 37234481444. No browser/listener. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importUiModule} from '../support/import-ui-module.mjs';
import {createRoomPanelClock} from './room-panels-clock.ts';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
// The production-only importer deliberately excludes fixture modules. Bundle
// this shared test input directly without broadening that source boundary.
const fixture = await build({entryPoints: [resolve(root, 'tests/ui-main/multiplayer-preflight-model.ts')], bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{name: 'preflight-fixture-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
    if (!args.path.startsWith('.')) return;
    const path = resolve(dirname(args.importer), args.path), authored = path.replace(/\.mjs$/, '.mts');
    if (path === resolve(root, 'product-catalog.mjs')) return {path: resolve(root, 'src/contracts/product-catalog.mts')};
    if (authored.startsWith(resolve(root, 'src') + '/') && existsSync(authored)) return {path: authored};
  });}}]});
const {createPreflightRoomFixture, preflightHost, preflightPlan, preflightLocalId} = await import('data:text/javascript;base64,' + Buffer.from(fixture.outputFiles[0].text).toString('base64'));
const {validateHostManifest} = await importUiModule('src/contracts/host-manifest.mts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const route = {productId: 'th08mp', roomCode: '1234', search: '?uiLocale=en&mpRoom=1234&kept=a%2Bb'};

test('browser fixture Host and exact plan share canonical TH08 DATA and immutable Runtime declarations', () => {
  assert.doesNotThrow(() => validateHostManifest(preflightHost));
  assert.match(preflightHost.games.th08.runtime, /^runtime\/th08\/[a-f0-9]{64}\/th08.html$/);
  assert.match(preflightHost.games.th08.multiplayerRuntime, /^runtime\/th08\/multiplayer\/[a-f0-9]{64}\/th08.html$/);
  assert.equal(preflightHost.games.th08.gameData.path, 'th08.data');
  assert.equal(preflightPlan.generation.descriptor.files['game-data'].target, '/th08.data');
  assert.equal(preflightPlan.generation.descriptor.files['game-data'].source, preflightHost.games.th08.gameData.path);
});
for (const attach of ['before room boot', 'after room boot']) test(`actual browser room fixture reaches eligible unready seat with Runtime attached ${attach}`, async t => {
  const clock = createRoomPanelClock(), f = createPreflightRoomFixture({baseUrl: 'https://synthetic.invalid/', timers: clock});
  t.after(() => f.room.dispose());
  let checks = 0;
  const runtime = {prepare: async () => {}, launch: async () => assert.fail('No gameplay launch'), checkGame: async () => {checks++;}};
  if (attach === 'before room boot') f.room.setRuntimePort(runtime);
  f.room.setRoute(route); await tick();
  if (attach === 'after room boot') f.room.setRuntimePort(runtime);
  const state = f.room.getSnapshot();
  assert.equal(state.error, null); assert.equal(state.connection, 'connected'); assert.equal(state.room.phase, 'lobby');
  assert.equal(state.clientId, preflightLocalId); assert.equal(state.room.localSeat, 0); assert.equal(state.room.seats[0].ready, false);
  assert.equal(state.pendingAction, null); assert.equal(state.launch, 'idle'); assert.equal(state.gameCheckAvailable, true);
  assert.ok(f.getSocket()); assert.deepEqual(clock.pending(), []);
  await f.room.checkGame(); assert.equal(checks, 1); assert.equal(f.room.getSnapshot().gameCheck.status, 'passed');
  assert.equal(f.sent.some(message => ['start', 'set-ready'].includes(message.type)), false);
});
for (const [label, mutate, message] of [
  ['mutable Runtime URL with runtimeManifest', host => {host.games.th08.runtime = 'runtime/th08/th08.html';}, 'Host Runtime URL must name an immutable generation'],
  ['wrong TH08 DATA mount', host => {host.games.th08.gameData.path = 'th08.dat';}, 'invalid Host Manifest games'],
]) test(`original CI fixture defect: ${label} rejects Host before socket creation, keeping room ineligible`, async t => {
  const host = structuredClone(preflightHost); mutate(host);
  const clock = createRoomPanelClock(), f = createPreflightRoomFixture({baseUrl: 'https://synthetic.invalid/', timers: clock, hostManifest: host});
  t.after(() => f.room.dispose()); f.room.setRoute(route); await tick();
  const state = f.room.getSnapshot();
  assert.equal(state.error, message); assert.equal(state.connection, 'reconnecting'); assert.equal(state.room, null);
  assert.equal(f.getSocket(), null); assert.equal(f.sent.length, 0); assert.equal(clock.pending().length, 1);
});
