import assert from "node:assert/strict";
import {
  buildMultiplayerGameplayRelayUrl,
  buildMultiplayerLobbyRelayUrl,
  multiplayerTransportRoomId,
} from "../.cache/build/browser/assets/launcher/multiplayer-relay-url.mjs";

assert.equal(multiplayerTransportRoomId("th06mp", "1234"), "th06mp-1234");
assert.notEqual(multiplayerTransportRoomId("th06mp", "1234"), multiplayerTransportRoomId("th07mp", "1234"),
  "display room codes must remain isolated by multiplayer product");

const contaminated = "wss://relay.example.test/netplay?token=keep&room=th07mp-9999&run=8&player=2&players=3&signal=1&spectator=c12345678";
const lobby = buildMultiplayerLobbyRelayUrl(contaminated, {
  product: "th06mp",
  roomCode: "1234",
  clientId: "c00000000000000",
});
assert.equal(lobby.roomId, "th06mp-1234");
const lobbyUrl = new URL(lobby.url);
assert.equal(lobbyUrl.searchParams.get("token"), "keep", "deployment-owned query parameters must survive role normalization");
assert.equal(lobbyUrl.searchParams.get("room"), "th06mp-1234");
assert.equal(lobbyUrl.searchParams.get("lobby"), "c00000000000000");
for (const key of ["run", "player", "players", "signal", "spectator"])
  assert.equal(lobbyUrl.searchParams.has(key), false, `lobby URL must not inherit gameplay parameter ${key}`);

const playerUrl = new URL(buildMultiplayerGameplayRelayUrl(
  "wss://relay.example.test/netplay?token=keep&lobby=cold&spectator=cold&players=3&signal=1",
  { product: "th07mp", roomCode: "4321", runId: 7.9, role: { player: 1 }, memberId: "private_member_1" },
));
assert.equal(playerUrl.searchParams.get("token"), "keep");
assert.equal(playerUrl.searchParams.get("room"), "th07mp-4321");
assert.equal(playerUrl.searchParams.get("run"), "7");
assert.equal(playerUrl.searchParams.get("player"), "1");
assert.equal(playerUrl.searchParams.get("member"), "private_member_1", "game transport must carry its private membership");
for (const key of ["lobby", "spectator", "players", "signal"])
  assert.equal(playerUrl.searchParams.has(key), false, `player gameplay URL must not inherit parameter ${key}`);

const spectatorUrl = new URL(buildMultiplayerGameplayRelayUrl(
  playerUrl.href,
  { product: "th07mp", roomCode: "4321", runId: -4, role: { spectator: "c12345678" }, memberId: "private_viewer_1" },
));
assert.equal(spectatorUrl.searchParams.get("run"), "0");
assert.equal(spectatorUrl.searchParams.get("spectator"), "c12345678");
assert.equal(spectatorUrl.searchParams.get("member"), "private_viewer_1", "a spectator must use its own membership");
assert.equal(spectatorUrl.searchParams.has("player"), false,
  "spectator and player roles must be mutually exclusive in the Launcher-owned relay URL");

assert.throws(() => buildMultiplayerLobbyRelayUrl("https://relay.example.test/", {
  product: "th06mp", roomCode: "1234", clientId: "c00000000000000",
}), /ws or wss/);
assert.throws(() => buildMultiplayerGameplayRelayUrl("not a url", {
  product: "th06mp", roomCode: "1234", runId: 1, role: { player: 0 },
}), /invalid multiplayer relay URL/);

console.log(JSON.stringify({
  multiplayerRelayUrl: "PASS",
  roomNamespace: "product-scoped",
  roleParams: "exclusive-and-normalized",
  deploymentQuery: "preserved",
}));
