import assert from "node:assert/strict";

import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { normalizeMultiplayerLobbySnapshot } from "../.cache/build/browser/assets/launcher/multiplayer-lobby-snapshot.mjs";

const localClientId = "local_client_01";

const th06 = PRODUCT_GAMES.th06.multiplayer;
const th06Snapshot = normalizeMultiplayerLobbySnapshot({
  playerCount: 2,
  difficulty: th06.difficulties.length,
  spectatorCount: -1,
  spectators: [
    { clientId: "watcher_client_02", name: "  观众\u0000甲  " },
    { clientId: "bad", name: "ignored" },
  ],
  seats: [
    { clientId: localClientId, name: " P1 ", loadout: th06.loadouts.length - 1, ready: true },
    { clientId: "remote_client_03", name: "P2", loadout: th06.loadouts.length, ready: true },
    null,
  ],
}, {
  localClientId,
  playerCounts: th06.playerCounts,
  difficulties: th06.difficulties,
  loadouts: th06.loadouts,
});

assert.ok(th06Snapshot);
assert.equal(th06Snapshot.difficulty, th06.difficulties.length - 1);
assert.equal(th06Snapshot.seats[0]?.loadout, th06.loadouts.length - 1);
assert.equal(th06Snapshot.seats[1], null, "TH06 must fail closed on a TH07-only loadout index");
assert.equal(th06Snapshot.localSeat, 0);
assert.equal(th06Snapshot.localSpectator, false);
assert.deepEqual(th06Snapshot.spectators, [{ clientId: "watcher_client_02", name: "观众甲" }]);
assert.equal(th06Snapshot.spectatorCount, 1, "invalid negative count must not under-report the normalized list");
assert.equal(th06Snapshot.inputDelay, 0);
assert.equal(th06Snapshot.predictionLimit, 8);

const adonisContext={localClientId,playerCounts:th06.playerCounts,difficulties:th06.difficulties,loadouts:th06.loadouts};
const adonisSnapshot=normalizeMultiplayerLobbySnapshot({playerCount:2,adonisMode:1,inputDelay:9},adonisContext);
assert.equal(adonisSnapshot.adonisMode,1);assert.equal(adonisSnapshot.inputDelay,9);
assert.equal(normalizeMultiplayerLobbySnapshot({playerCount:2,adonisMode:3,inputDelay:3},adonisContext),null);
assert.equal(normalizeMultiplayerLobbySnapshot({playerCount:2,adonisMode:2,inputDelay:10},adonisContext),null);

const th07 = PRODUCT_GAMES.th07.multiplayer;
const th07Snapshot = normalizeMultiplayerLobbySnapshot({
  playerCount: 3,
  difficulty: th07.difficulties.length - 1,
  spectators: [{ clientId: localClientId, name: "Watcher" }],
  spectatorCount: 4,
  seats: [
    null,
    { clientId: "remote_client_04", name: "P2", loadout: th07.loadouts.length - 1, ready: false, offline: true },
    null,
  ],
}, {
  localClientId,
  playerCounts: th07.playerCounts,
  difficulties: th07.difficulties,
  loadouts: th07.loadouts,
});

assert.ok(th07Snapshot);
assert.equal(th07Snapshot.seats[1]?.loadout, th07.loadouts.length - 1);
assert.equal(th07Snapshot.seats[1]?.offline, true);
assert.equal(th07Snapshot.localSeat, null);
assert.equal(th07Snapshot.localSpectator, true);
assert.equal(th07Snapshot.spectatorCount, 4);
const timing = normalizeMultiplayerLobbySnapshot({
  playerCount: 2, inputDelay: 4, predictionLimit: 2,
  seats: [{ clientId: localClientId, loadout: 0, mobileDevice: true }, null],
}, { localClientId, playerCounts: th06.playerCounts, difficulties: th06.difficulties, loadouts: th06.loadouts });
assert.equal(timing?.inputDelay, 4);
assert.equal(timing?.predictionLimit, 2);
assert.equal(timing?.seats[0]?.mobileDevice, true);

function resourceSnapshot(resource) {
  return normalizeMultiplayerLobbySnapshot({ playerCount: 2,
    seats: [{ clientId: localClientId, loadout: 0, resource }, null] },
  { localClientId, playerCounts: th06.playerCounts, difficulties: th06.difficulties, loadouts: th06.loadouts })?.seats[0]?.resource;
}
assert.deepEqual(resourceSnapshot({ status: "preparing", stage: "package", percent: 42.6 }),
  { status: "preparing", stage: "package", percent: 43 });
assert.deepEqual(resourceSnapshot({ status: "importing", stage: "package", percent: null }),
  { status: "importing", stage: "package", percent: null });
assert.equal(resourceSnapshot({ status: "unexpected", stage: "package", percent: 50 }), null);
assert.equal(resourceSnapshot({ status: "ready", stage: "invalid", percent: 100 }), null);
assert.equal(resourceSnapshot({ status: "preparing", stage: "runtime", percent: 101 })?.percent, null);
assert.equal(resourceSnapshot(undefined), null, "legacy peers need no progress declaration");

const inactiveSeat = normalizeMultiplayerLobbySnapshot({
  playerCount: 2,
  seats: [null, null, { clientId: localClientId, name: "P3", loadout: 0 }],
}, { localClientId, playerCounts: th07.playerCounts, difficulties: th07.difficulties, loadouts: th07.loadouts });
assert.ok(inactiveSeat);
assert.equal(inactiveSeat.localSeat, null, "inactive P3 must not become the local seat in a 2P room");

assert.equal(normalizeMultiplayerLobbySnapshot({ playerCount: 3 }, {
  localClientId, playerCounts: [2], difficulties: th06.difficulties, loadouts: th06.loadouts,
}), null, "a product that declares only 2P must reject a 3P lobby snapshot");

assert.equal(normalizeMultiplayerLobbySnapshot(null, {
  localClientId, playerCounts: th06.playerCounts, difficulties: th06.difficulties, loadouts: th06.loadouts,
}), null);

console.log(JSON.stringify({
  multiplayerLobbySnapshot: "PASS",
  productBounds: ["playerCount", "difficulty", "loadout"],
  identity: "shared-owner",
  inactiveSeat: "ignored",
}));
