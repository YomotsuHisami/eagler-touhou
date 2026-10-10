import assert from "node:assert/strict";
import {
  createMultiplayerIdentityStore,
  multiplayerDisplayInitial,
  multiplayerDisplayNameLockedStorageKey,
  multiplayerDisplayNameStorageKey,
  multiplayerLobbyClientStorageKey,
  normalizeMultiplayerDisplayName,
  validMultiplayerClientId,
} from "../.cache/build/browser/assets/launcher/multiplayer-identity.mjs";

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

assert.equal(normalizeMultiplayerDisplayName("  A\u0000B\nC  "), "ABC");
assert.equal(normalizeMultiplayerDisplayName("一二三四五六七八九十十一十二十三"), "一二三四五六七八九十十一");
assert.equal(multiplayerDisplayInitial("  琪露诺  "), "琪");
assert.equal(multiplayerDisplayInitial("", "P"), "P");
// Every Unicode Bidi_Control is removed, including the Arabic letter mark
// and isolate controls that previously became invisible avatar initials.
const bidiControls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
  0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map(point => String.fromCodePoint(point));
for (const control of bidiControls) {
  const name = `${control}Alice${control}`;
  assert.equal(normalizeMultiplayerDisplayName(name), "Alice");
  assert.equal(multiplayerDisplayInitial(name), "A");
}
const invisibleControls = "\u200b\u200c\u200d\u2060\u2061\u2062\u2063\u2064\ufeff";
assert.equal(normalizeMultiplayerDisplayName(`${invisibleControls}Alice${invisibleControls}`), "Alice");
assert.equal(multiplayerDisplayInitial(bidiControls.join("") + invisibleControls), "观");
assert.equal(normalizeMultiplayerDisplayName("🦊琪露诺"), "🦊琪露诺");
assert.equal(normalizeMultiplayerDisplayName("\u2067".repeat(12) + "🦊".repeat(13)), "🦊".repeat(12));
assert.ok(validMultiplayerClientId("client_01"));
assert.ok(!validMultiplayerClientId("short"));

const persistent = new MemoryStorage([[multiplayerDisplayNameStorageKey, "  Alice  "]]);
const session = new MemoryStorage();
const identity = createMultiplayerIdentityStore({
  persistentStorage: persistent,
  sessionStorage: session,
  randomWords: () => [0x12345678, 0x9abcdef0],
  fallbackClientId: () => "fallback_client",
});
assert.equal(identity.loadDisplayName(), "Alice");
assert.equal(persistent.getItem(multiplayerDisplayNameLockedStorageKey), "1");
assert.deepEqual(identity.updateDisplayName("Bob"), { updated: true, name: "Bob" });
assert.equal(persistent.getItem(multiplayerDisplayNameStorageKey), "Bob");
assert.equal(identity.loadDisplayName(), "Bob");
assert.deepEqual(identity.updateDisplayName("   ", "Bob"), { updated: true, name: "Bob" });
assert.equal(persistent.getItem(multiplayerDisplayNameStorageKey), "Bob");

const freshPersistent = new MemoryStorage();
const freshIdentity = createMultiplayerIdentityStore({
  persistentStorage: freshPersistent,
  sessionStorage: session,
  randomWords: () => [0x12345678, 0x9abcdef0],
});
assert.deepEqual(freshIdentity.updateDisplayName("  Bob  "), { updated: true, name: "Bob" });
assert.equal(freshPersistent.getItem(multiplayerDisplayNameStorageKey), "Bob");
assert.equal(freshPersistent.getItem(multiplayerDisplayNameLockedStorageKey), "1");
assert.deepEqual(freshIdentity.updateDisplayName("", ""), { updated: false, name: "" });
assert.equal(freshPersistent.getItem(multiplayerDisplayNameStorageKey), "Bob");

const clientId = identity.lobbyClientId("th06mp");
assert.ok(validMultiplayerClientId(clientId));
assert.equal(session.getItem(multiplayerLobbyClientStorageKey("th06mp")), clientId);
assert.equal(identity.lobbyClientId("th06mp"), clientId);
assert.notEqual(multiplayerLobbyClientStorageKey("th06mp"), multiplayerLobbyClientStorageKey("th07mp"));

const zeroSession = new MemoryStorage();
const zeroIdentity = createMultiplayerIdentityStore({
  persistentStorage: new MemoryStorage(),
  sessionStorage: zeroSession,
  randomWords: () => [0, 0],
});
assert.equal(zeroIdentity.lobbyClientId("th06mp"), "c00000000000000");
assert.ok(validMultiplayerClientId(zeroIdentity.lobbyClientId("th06mp")));

const hostile = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
const hostileIdentity = createMultiplayerIdentityStore({
  persistentStorage: hostile,
  sessionStorage: hostile,
  fallbackClientId: () => "fallback_client",
});
assert.deepEqual(hostileIdentity.updateDisplayName("Alice", ""), { updated: true, name: "Alice" });
assert.deepEqual(hostileIdentity.updateDisplayName("Bob", "Alice"), { updated: true, name: "Bob" });
assert.equal(hostileIdentity.lobbyClientId("th07mp"), "fallback_client");

console.log(JSON.stringify({
  multiplayerIdentity: "PASS",
  displayName: "editable-anytime",
  maxCodePoints: 12,
  lobbyClient: "product-tab-scoped",
  storageFailure: "non-fatal",
}));

// Reconnection must not create a new participant when storage is unavailable.
for (const sessionStorage of [null, hostile, {
  getItem() { return null; },
  setItem() { throw new Error("write unavailable"); },
}]) {
  let serial = 0;
  const isolated = createMultiplayerIdentityStore({
    persistentStorage: null,
    sessionStorage,
    randomWords: () => [++serial, 0],
    fallbackClientId: () => `fallback_${++serial}`,
  });
  const first = isolated.lobbyClientId("th06mp");
  assert.equal(isolated.lobbyClientId("th06mp"), first);
  const other = isolated.lobbyClientId("th07mp");
  assert.notEqual(other, first);
  assert.equal(isolated.lobbyClientId("th07mp"), other);
}
console.log("Multiplayer identity without session storage: PASS");
