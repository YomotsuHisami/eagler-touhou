import assert from "node:assert/strict";
import { PRODUCT_IDS } from "../lib/contracts/product-catalog.mjs";
import {
  MP_ROOM_HISTORY_KEY,
  MP_ROOM_URL_KEY,
  PLAYER_HISTORY_KEY,
  TOUCH_LAYOUT_HISTORY_KEY,
  directRoomHistorySeed,
  initialRoutedHistoryOperations,
  launcherHomeHistoryOperation,
  launcherHomeHistoryState,
  launcherHomeUrl,
  normalizeRoomCode,
  playerRouteHistoryOperation,
  returnToRoomHistoryOperation,
  resolveRoomInvite,
  roomCodeFromUrl,
  roomRouteHistoryOperation,
  roomRouteUrl,
  routedProductFromUrl,
  touchLayoutEditorHistoryOperation,
} from "../.cache/build/browser/assets/launcher/route-state.mjs";
import { ROOM_INVITE_KEY, decodeRoomInvite, encodeRoomInvite } from "../.cache/build/browser/assets/launcher/room-invite.mjs";

const products = new Set(PRODUCT_IDS);

assert.equal(normalizeRoomCode(" 12-34abc567890 "), "12345678");
assert.equal(normalizeRoomCode(null), "");
assert.equal(routedProductFromUrl("https://launcher.invalid/?game=th06mp", products), "th06mp");
assert.equal(routedProductFromUrl("https://launcher.invalid/?game=th10", products), "th10");
assert.equal(routedProductFromUrl("https://launcher.invalid/?game=unknown", products), null);

// Opaque room-invite token round-trips product + room + transient create settings.
const inviteToken = encodeRoomInvite({ g: "th06mp", r: "4079", f: true, a: "create", p: 3, d: 2, v: "private", c: true });
assert.deepEqual(decodeRoomInvite(inviteToken), { g: "th06mp", r: "4079", f: true, a: "create", p: 3, d: 2, v: "private", c: true });
assert.equal(decodeRoomInvite("not-a-valid-token!!"), null);
assert.equal(decodeRoomInvite(""), null);
assert.equal(routedProductFromUrl(`https://launcher.invalid/?${ROOM_INVITE_KEY}=${inviteToken}`, products), "th06mp");
assert.equal(roomCodeFromUrl(`https://launcher.invalid/?${ROOM_INVITE_KEY}=${inviteToken}`), "4079");
assert.equal(resolveRoomInvite(`https://launcher.invalid/?${ROOM_INVITE_KEY}=${inviteToken}`)?.g, "th06mp");

// Legacy plain parameters still resolve for old shared links.
const legacyInvite = resolveRoomInvite("https://launcher.invalid/?game=th06mp&mpRoom=4079&fromLobby=1&lobbyAction=create&lobbyPlayers=3&lobbyDifficulty=2&lobbyVisibility=private&lobbyDisableCheatMovement=1");
assert.deepEqual(legacyInvite, { g: "th06mp", r: "4079", f: true, a: "create", p: 3, d: 2, v: "private", c: true });

const homeUrl = launcherHomeUrl("https://launcher.invalid/?game=th07mp&mpRoom=1234&keep=1");
assert.equal(homeUrl.searchParams.get("game"), null);
assert.equal(homeUrl.searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(homeUrl.searchParams.get("keep"), "1");
assert.deepEqual(launcherHomeHistoryState({
  [PLAYER_HISTORY_KEY]: true,
  [MP_ROOM_HISTORY_KEY]: "1234",
  game: "th07mp",
  keep: 1,
}), {
  [PLAYER_HISTORY_KEY]: false,
  [MP_ROOM_HISTORY_KEY]: false,
  keep: 1,
});
const homeOperation = launcherHomeHistoryOperation({
  currentUrl: "https://launcher.invalid/?game=th07mp&mpRoom=1234&keep=1",
  currentState: { [PLAYER_HISTORY_KEY]: true, [MP_ROOM_HISTORY_KEY]: "1234", game: "th07mp", keep: 1 },
});
assert.equal(homeOperation.kind, "replace");
assert.equal(new URL(homeOperation.url).searchParams.get("game"), null);
assert.equal(new URL(homeOperation.url).searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(homeOperation.state.keep, 1);

const reloadSingle = initialRoutedHistoryOperations({
  currentUrl: "https://launcher.invalid/?game=th07&keep=1",
  currentState: { [PLAYER_HISTORY_KEY]: true, game: "th07", keep: 1 },
  routedProduct: "th07",
  navigationType: "reload",
  multiplayerProduct: false,
});
assert.equal(reloadSingle.length, 1);
assert.equal(reloadSingle[0].kind, "replace");
assert.equal(new URL(reloadSingle[0].url).searchParams.get("game"), "th07",
  "refresh preserves the selected product options and their existing Back entry");
assert.equal(reloadSingle[0].state[PLAYER_HISTORY_KEY], true);
assert.equal(reloadSingle[0].state.game, "th07");

const reloadRoom = initialRoutedHistoryOperations({
  currentUrl: "https://launcher.invalid/?game=th06mp&mpRoom=9876",
  currentState: { [PLAYER_HISTORY_KEY]: true },
  routedProduct: "th06mp",
  navigationType: "reload",
  multiplayerProduct: true,
});
assert.equal(reloadRoom.length, 1);
assert.equal(new URL(reloadRoom[0].url).searchParams.get("game"), "th06mp");
assert.equal(reloadRoom[0].state.game, "th06mp");
assert.equal(reloadRoom[0].state[MP_ROOM_HISTORY_KEY], "9876",
  "room refresh preserves the multiplayer product and room marker");

const directPlayer = initialRoutedHistoryOperations({
  currentUrl: "https://launcher.invalid/?game=th06",
  currentState: null,
  routedProduct: "th06",
  navigationType: "navigate",
  multiplayerProduct: false,
});
assert.deepEqual(directPlayer.map(operation => operation.kind), ["replace", "push"]);
assert.equal(new URL(directPlayer[0].url).searchParams.get("game"), null);
assert.equal(directPlayer[1].state[PLAYER_HISTORY_KEY], true);
assert.equal(directPlayer[1].state.game, "th06");
assert.deepEqual(initialRoutedHistoryOperations({
  currentUrl: "https://launcher.invalid/?game=th06",
  currentState: { [PLAYER_HISTORY_KEY]: true, game: "th06" },
  routedProduct: "th06",
  navigationType: "navigate",
  multiplayerProduct: false,
}), []);

const pushPlayer = playerRouteHistoryOperation({
  currentUrl: "https://launcher.invalid/",
  currentState: { keep: 1 },
  routedProduct: null,
  product: "th07",
});
assert.equal(pushPlayer?.kind, "push");
assert.equal(new URL(pushPlayer.url).searchParams.get("game"), "th07");
assert.equal(pushPlayer.state.keep, 1);

const replacePlayer = playerRouteHistoryOperation({
  currentUrl: "https://launcher.invalid/?game=th06",
  currentState: { [PLAYER_HISTORY_KEY]: true, game: "th06" },
  routedProduct: "th06",
  product: "th07",
});
assert.equal(replacePlayer?.kind, "replace");
assert.equal(playerRouteHistoryOperation({
  currentUrl: "https://launcher.invalid/?game=th07",
  currentState: { [PLAYER_HISTORY_KEY]: true, game: "th07" },
  routedProduct: "th07",
  product: "th07",
}), null);

const touchLayoutEditor = touchLayoutEditorHistoryOperation({
  currentUrl: "https://launcher.invalid/?game=th07&keep=1",
  currentState: { [PLAYER_HISTORY_KEY]: true, game: "th07", keep: 1 },
});
assert.equal(touchLayoutEditor.kind, "push");
assert.equal(touchLayoutEditor.url, "https://launcher.invalid/?game=th07&keep=1");
assert.equal(touchLayoutEditor.state[TOUCH_LAYOUT_HISTORY_KEY], true);
assert.equal(touchLayoutEditor.state[PLAYER_HISTORY_KEY], true);
assert.equal(touchLayoutEditor.state.game, "th07");
assert.equal(touchLayoutEditor.state.keep, 1);

const roomUrl = roomRouteUrl("https://launcher.invalid/?keep=1", "th06mp", "4321");
assert.equal(roomUrl.searchParams.get("game"), null);
assert.equal(roomUrl.searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(decodeRoomInvite(roomUrl.searchParams.get(ROOM_INVITE_KEY))?.r, "4321");
assert.equal(roomUrl.searchParams.get("keep"), "1");

const pushRoom = roomRouteHistoryOperation({
  currentUrl: "https://launcher.invalid/?keep=1",
  currentState: { keep: 1 },
  product: "th06mp",
  roomCode: "4321",
  push: true,
});
assert.equal(pushRoom.kind, "push");
assert.equal(new URL(pushRoom.url).searchParams.get("game"), null);
assert.equal(new URL(pushRoom.url).searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(decodeRoomInvite(new URL(pushRoom.url).searchParams.get(ROOM_INVITE_KEY))?.r, "4321");
assert.equal(pushRoom.state[MP_ROOM_HISTORY_KEY], "4321");

const clearRoom = roomRouteHistoryOperation({
  currentUrl: pushRoom.url,
  currentState: pushRoom.state,
  product: "th06mp",
  roomCode: "",
});
assert.equal(clearRoom.kind, "replace");
assert.equal(new URL(clearRoom.url).searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(new URL(clearRoom.url).searchParams.get(ROOM_INVITE_KEY), null);
assert.equal(new URL(clearRoom.url).searchParams.get("game"), "th06mp",
  "clearing a room marker alone does not silently rewrite the selected product route");
assert.equal(clearRoom.state[MP_ROOM_HISTORY_KEY], false);

const returnToRoom = returnToRoomHistoryOperation({
  currentUrl: "https://launcher.invalid/?game=th06mp",
  currentState: { [PLAYER_HISTORY_KEY]: true, keep: 1 },
  product: "th06mp",
  roomCode: "4321",
});
assert.equal(returnToRoom.kind, "replace");
assert.equal(decodeRoomInvite(new URL(returnToRoom.url).searchParams.get(ROOM_INVITE_KEY))?.r, "4321");
assert.equal(returnToRoom.state[PLAYER_HISTORY_KEY], false);
assert.equal(returnToRoom.state[MP_ROOM_HISTORY_KEY], "4321");
assert.equal(returnToRoom.state.game, "th06mp");
assert.equal(returnToRoom.state.keep, 1);

// Room snapshots, game exit and Back must retain the directory destination.
// Keep only the origin marker, without replaying the create/join operation.
for (const product of PRODUCT_IDS.filter(id => id.endsWith("mp"))) {
  for (const source of [
    `https://launcher.invalid/?j=${encodeRoomInvite({ g: product, r: "4321", f: true, a: "create", p: 3 })}`,
    `https://launcher.invalid/?game=${product}&mpRoom=4321&fromLobby=1&lobbyAction=join`,
  ]) {
    const synced = roomRouteHistoryOperation({ currentUrl: source, currentState: {}, product, roomCode: "4321" });
    assert.deepEqual(resolveRoomInvite(synced.url), decodeRoomInvite(encodeRoomInvite({ g: product, r: "4321", f: true })));
    const exited = returnToRoomHistoryOperation({ currentUrl: synced.url, currentState: { [PLAYER_HISTORY_KEY]: true }, product, roomCode: "4321" });
    assert.equal(resolveRoomInvite(exited.url)?.f, true, `${product} game exit keeps the directory destination`);
    assert.equal(exited.state[PLAYER_HISTORY_KEY], false);
    assert.equal(resolveRoomInvite(roomRouteUrl(source, product, "1234"))?.f, false, "another room cannot inherit this origin");
    assert.equal(resolveRoomInvite(roomRouteUrl(source, "th11", "4321"))?.f, false, "another product cannot inherit this origin");
  }
}

const seed = directRoomHistorySeed({
  currentUrl: "https://launcher.invalid/?game=th06mp&mpRoom=4321&keep=1",
  currentState: { other: true },
  roomCode: "4321",
});
assert.deepEqual(seed.map(operation => operation.kind), ["replace", "push"]);
assert.equal(new URL(seed[0].url).searchParams.get("game"), null);
assert.equal(new URL(seed[0].url).searchParams.get(MP_ROOM_URL_KEY), null);
assert.equal(new URL(seed[1].url).searchParams.get("game"), "th06mp");
assert.equal(new URL(seed[1].url).searchParams.get(MP_ROOM_URL_KEY), "4321");
assert.equal(seed[1].state[MP_ROOM_HISTORY_KEY], "4321");
assert.deepEqual(directRoomHistorySeed({
  currentUrl: "https://launcher.invalid/?game=th06mp&mpRoom=4321",
  currentState: { [MP_ROOM_HISTORY_KEY]: "4321" },
  roomCode: "4321",
}), []);

console.log(JSON.stringify({
  routeState: "PASS",
  reload: ["product-options", "multiplayer-room"],
  playerHistory: ["push", "replace", "stable"],
  directRoomBackPredecessor: true,
}));
