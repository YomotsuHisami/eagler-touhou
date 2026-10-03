import assert from "node:assert/strict";
import {
  createMultiplayerRoomSessionStore,
  multiplayerRoomSessionStorageKey,
} from "../.cache/build/browser/assets/launcher/multiplayer-room-session.mjs";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

assert.notEqual(multiplayerRoomSessionStorageKey("th06mp"), multiplayerRoomSessionStorageKey("th07mp"),
  "multiplayer products must not share a room session key");

const storage = new MemoryStorage();
const store = createMultiplayerRoomSessionStore({ storage });
store.save("th06mp", {
  room: { code: "1234", playerCount: 3, difficulty: 9, created: true },
  seat: 2,
  ready: true,
  spectatorRequested: true,
  roomSettingsOpen: true,
});

assert.deepEqual(store.load({ product: "th06mp", roomCode: "1234", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3"] }), {
  product: "th06mp",
  room: { code: "1234", playerCount: 3, difficulty: 3, created: true, visibility: "public", disableCheatMovement: false },
  seat: 2,
  ready: true,
  spectatorRequested: false,
  roomSettingsOpen: true,
}, "restored room state must normalize catalog-bounded fields and never restore spectator intent for a seated player");
assert.equal(store.load({ product: "th06mp", roomCode: "9999", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3"] }), null,
  "a room session must not bleed into another room code");

storage.setItem(multiplayerRoomSessionStorageKey("th07mp"), JSON.stringify({
  product: "th06mp",
  room: { code: "4321", playerCount: 3, difficulty: 2 },
}));
assert.equal(store.load({ product: "th07mp", roomCode: "4321", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3", "4"] }), null,
  "the payload product must agree with the product-scoped storage key");
storage.setItem(multiplayerRoomSessionStorageKey("th07mp"), JSON.stringify({
  room: { code: "4321", playerCount: 3, difficulty: 2 },
}));
assert.equal(store.load({ product: "th07mp", roomCode: "4321", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3", "4"] }), null,
  "unpublished product-less room payloads are not a supported compatibility format");

storage.setItem(multiplayerRoomSessionStorageKey("th07mp"), JSON.stringify({
  product: "th07mp",
  room: { code: "4321", playerCount: "3", difficulty: "bad", created: 0 },
  seat: 4,
  ready: 1,
  spectatorRequested: 1,
  roomSettingsOpen: "yes",
}));
assert.deepEqual(store.load({ product: "th07mp", roomCode: "4321", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3", "4"] }), {
  product: "th07mp",
  room: { code: "4321", playerCount: 3, difficulty: 0, created: false, visibility: "public", disableCheatMovement: false },
  seat: null,
  ready: true,
  spectatorRequested: true,
  roomSettingsOpen: true,
});

store.clear("th06mp");
assert.equal(storage.getItem(multiplayerRoomSessionStorageKey("th06mp")), null);

const hostile = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};
const hostileStore = createMultiplayerRoomSessionStore({ storage: hostile });
assert.doesNotThrow(() => hostileStore.save("th06mp", {
  room: { code: "1234", playerCount: 2, difficulty: 1, created: false },
  seat: null, ready: false, spectatorRequested: false, roomSettingsOpen: false,
}));
assert.equal(hostileStore.load({ product: "th06mp", roomCode: "1234", playerCounts: [2, 3], difficulties: ["0", "1", "2", "3"] }), null);
assert.doesNotThrow(() => hostileStore.clear("th06mp"));

console.log(JSON.stringify({
  multiplayerRoomSession: "PASS",
  scope: "product-tab-session",
  restore: "room-and-product-bound",
  storageFailure: "non-fatal",
}));
