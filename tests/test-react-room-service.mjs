/** Real relay integration for the React store; no game assets or iframe needed. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import net from 'node:net';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'react-room-'));
await build({ entryPoints: [join(root, 'app/services/room.client.ts')], outfile: join(temporary, 'room.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { createRoomService } = await import(pathToFileURL(join(temporary, 'room.mjs')));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const port = await freePort();
const child = spawn(process.execPath, ['server/netplay-relay.mjs'], { cwd: root, env: { ...process.env, EAGLER_NETPLAY_RELAY_HOST: '127.0.0.1', EAGLER_NETPLAY_RELAY_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await pause(15); }
  throw new Error(`${label} timed out\n${output}`);
}
const makeStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
// The probe owner uses browser timers, with native WebSocket and no RTC in this test.
const previousWindow = globalThis.window;
globalThis.window = { setInterval, addEventListener() {}, removeEventListener() {} };
const manifest = {
  schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-validation-test',
  shared: { resourceMode: 'hosted', testBuild: true, vanillaFont: '/msgothic.ttc', unicodeFont: '/unifont.otf', netplayRelay: `ws://127.0.0.1:${port}/` },
  games: Object.fromEntries(['th06', 'th08', 'th09'].map(game => [game, {
    runtime: `runtime/${game}/${game}.html`, multiplayerRuntime: `runtime/${game}/multiplayer/${game}.html`,
    gameData: { path: `${game}.data`, bytes: 1, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}` }, music: { midi: { files: [] } },
  }])),
};
const services = [], launches = [], sockets = [];
const create = (name, movement = { movementMode: 'touch', touchEnabled: false, mobileDevice: false }) => {
  const ownSockets = [];
  const service = createRoomService({ baseUrl: 'https://example.invalid/', memberId: `member_${name}_test`, persistentStorage: makeStorage(), sessionStorage: makeStorage(),
    getMovement: () => movement, createSocket: url => { const socket = new WebSocket(url); ownSockets.push(socket); return socket; },
    onLaunch: handoff => launches.push({ name, ...handoff }),
  });
  services.push(service); sockets.push(ownSockets); service.configureManifest(manifest); return service;
};
try {
  await waitFor(() => output.includes('listening'), 'relay listen');
  const host = create('host'), guest = create('guest'), spectator = create('viewer');
  await waitFor(() => services.every(service => service.getSnapshot().connection === 'live'), 'directory connects');
  assert.equal(host.getSnapshot(), host.getSnapshot(), 'snapshot reference remains stable between changes');
  assert.ok(Object.isFrozen(host.getSnapshot()));
  assert.equal(await host.create({ product: 'th09mp', playerCount: 3 }), null, 'TH09 cannot use three-player settings');
  assert.equal(host.getSnapshot().errorCode, 'settings');
  const code = await host.create({ product: 'th08mp', playerCount: 2, difficulty: 1, visibility: 'public', disableCheatMovement: false });
  assert.match(code, /^\d{4,8}$/);
  await waitFor(() => host.getSnapshot().room?.localSeat === 0, 'host joins P1');
  assert.ok(host.getSnapshot().permissions.owner);
  assert.equal(host.setReady(true), false, 'unverified resources must not advertise readiness');
  assert.equal(host.getSnapshot().permissions.canReady, false);
  await guest.join('th08mp', code);
  await waitFor(() => guest.getSnapshot().room?.localSeat === 1, 'guest auto joins P2');
  await waitFor(() => host.getSnapshot().room.seats[1], 'host receives guest');
  assert.equal(guest.setSettings({ difficulty: 2 }), false, 'only host can alter settings');
  assert.equal(guest.kick(host.getSnapshot().room.clientId), false, 'guest cannot kick host');
  assert.equal(host.setLoadout(999), false, 'loadout is contract-bounded');
  assert.equal(host.reportResources({ status: 'ready', stage: 'runtime', percent: 100 }, 'th06mp', code), false, 'stale product preparation cannot mark ready');
  assert.equal(host.reportResources({ status: 'ready', stage: 'runtime', percent: 100 }, 'th08mp', code, -1), false, 'stale room generation cannot mark ready');
  assert.equal(host.reportResources({ status: 'ready', stage: 'package', percent: 100 }), true);
  assert.equal(host.getSnapshot().permissions.canReady, false, 'package-only preparation is insufficient');
  host.reportResources({ status: 'ready', stage: 'runtime', percent: 100 });
  guest.reportResources({ status: 'ready', stage: 'runtime', percent: 100 });
  host.setReady(true); guest.setReady(true);
  await waitFor(() => host.getSnapshot().permissions.canStart, 'both ready');
  const before = host.getSnapshot();
  host.setSettings({ difficulty: 2 });
  await waitFor(() => host.getSnapshot().room.difficulty === 2 && !host.getSnapshot().room.seats[0].ready, 'settings invalidate readiness');
  assert.equal(before.room.difficulty, 1, 'older snapshots remain immutable');
  assert.equal(before.room.seats[0].ready, true);
  assert.ok(Object.isFrozen(before.room.seats));
  assert.equal(host.getSnapshot().permissions.canStart, false);
  await spectator.join('th08mp', code, { spectator: true });
  await waitFor(() => spectator.getSnapshot().room?.localSpectator, 'spectator admission');
  assert.equal(spectator.getSnapshot().room.localSeat, null);
  assert.equal(host.kick(spectator.getSnapshot().room.clientId), true);
  await waitFor(() => spectator.getSnapshot().errorCode === '4010', 'host kick acknowledged by relay');
  spectator.leave();
  host.setReady(true); guest.setReady(true);
  await waitFor(() => host.getSnapshot().permissions.canStart, 'ready after settings');
  assert.equal(host.setInputDelay(2), true);
  assert.equal(host.requestStart(), true);
  await waitFor(() => launches.length === 2, 'real start handoff');
  for (const handoff of launches) {
    assert.equal(handoff.product, 'th08mp'); assert.equal(handoff.code, code); assert.equal(handoff.runId, 1);
    assert.equal(handoff.options.netplayInputDelay, 2); assert.equal(handoff.options.netplayPredictionLimit, 8);
    assert.equal(handoff.options.netplayDifficulty, 2); assert.equal(handoff.options.netplayPlayerCount, 2);
    assert.equal(new URL(handoff.options.netplayUrl).searchParams.get('run'), '1');
    assert.equal(handoff.options.netplayLoadouts.length, 2);
  }
  assert.equal(host.getSnapshot().launchPending, false);
  assert.equal(host.getSnapshot().permissions.canStart, false, 'no duplicate start while running');
  guest.leave(); host.leave();
  assert.equal(host.getSnapshot().room, null);
  await waitFor(() => services.slice(0, 2).every(service => service.getSnapshot().mine === null), 'explicit leave releases membership');
  await guest.join('th06mp', '99999999');
  await waitFor(() => guest.getSnapshot().errorCode === '4007', 'expired room surfaces exact terminal error');
  guest.leave();
  const nextCode = await host.create({ product: 'th06mp', playerCount: 2 });
  await waitFor(() => host.getSnapshot().room?.localSeat === 0, 'next room starts cleanly');
  const oldSocket = sockets[0].findLast(socket => new URL(socket.url).searchParams.has('lobby'));
  oldSocket.close(1000, 'network test');
  await waitFor(() => host.getSnapshot().room?.connection === 'reconnecting', 'reconnect state');
  await waitFor(() => host.getSnapshot().room?.connection === 'connected' && host.getSnapshot().room.localSeat === 0, 'same room reconnects');
  assert.equal(host.getSnapshot().room.code, nextCode);
  host.leave();
  await pause(750);
  assert.equal(host.getSnapshot().room, null, 'leave cancels pending reconnect');
  console.log('PASS React room service: real directory, create/join/leave, contracts, authoritative ready/settings, resource gate, spectator/host kick, launch options, immutable snapshots and reconnect');
} finally {
  for (const service of services) service.dispose();
  child.kill('SIGTERM');
  globalThis.window = previousWindow;
  await rm(temporary, { recursive: true, force: true });
}
