import assert from "node:assert/strict";
import {
  canonicalTouchLayout,
  cloneTouchLayout,
  emptyTouchLayout,
  loadTouchLayoutFromStorage,
  normalizeTouchLayout,
  normalizeTouchLayoutPriorityOrder,
  persistTouchLayoutResult,
  persistTouchLayoutToStorage,
  touchLayoutControlMeta,
  touchLayoutOrientations,
  touchLayoutScaleMax,
  touchLayoutScaleMin,
  touchLayoutStorageKey,
  touchLayoutVersion,
} from "../.cache/build/browser/assets/launcher/touch-layout-model.mjs";

const placement = (priority, overrides = {}) => ({ x: 0.25, y: 0.5, scale: 1, priority, ...overrides });
const requiredControls = () => ({
  focus: placement(0),
  fire: placement(1),
  bomb: placement(2),
  escape: placement(4),
});

assert.equal(touchLayoutStorageKey, "eagler-touhou-touch-layout-v1");
assert.equal(touchLayoutVersion, 4);
assert.deepEqual([...touchLayoutOrientations], ["landscape", "portrait"]);
assert.equal(touchLayoutScaleMin, 0.6);
assert.equal(touchLayoutScaleMax, 1.8);
assert.deepEqual(Object.keys(touchLayoutControlMeta), [
  "focus", "fire", "bomb", "joystick", "escape", "thpracInput", "thpracTab", "thpracMenu",
]);

const v1 = normalizeTouchLayout({ version: 1, controls: requiredControls() });
assert.equal(v1.version, 4);
assert.notEqual(v1.profiles.landscape, v1.profiles.portrait);
assert.deepEqual(v1.profiles.landscape, v1.profiles.portrait);
v1.profiles.landscape.controls.fire.x = 0.9;
assert.equal(v1.profiles.portrait.controls.fire.x, 0.25, "orientation migration must deep-clone profiles");

for (const version of [2, 3, 4]) {
  const normalized = normalizeTouchLayout({
    version,
    profiles: {
      landscape: { controls: requiredControls(), viewport: { x: 0.2 } },
      portrait: null,
    },
  });
  assert.equal(normalized.version, 4);
  assert.equal(normalized.profiles.landscape.viewport.x, 0.2);
  assert.equal(normalized.profiles.portrait, null);
}

assert.equal(normalizeTouchLayout({ version: 4, profiles: {
  landscape: { controls: requiredControls(), viewport: { x: 0.51 } },
  portrait: null,
} }), null, "viewport offset outside the persisted contract must fail closed");
assert.equal(normalizeTouchLayout({ version: 4, profiles: {
  landscape: { controls: requiredControls(), viewport: { x: 0 } },
  portrait: { controls: { ...requiredControls(), fire: placement(1, { scale: 1.81 }) }, viewport: { x: 0 } },
} }), null, "invalid control scale must invalidate the whole saved layout");

const oldLayoutWithoutLaterOptionalControls = normalizeTouchLayout({
  version: 4,
  profiles: {
    landscape: { controls: requiredControls(), viewport: { x: 0 } },
    portrait: null,
  },
});
assert.ok(oldLayoutWithoutLaterOptionalControls);
assert.equal(oldLayoutWithoutLaterOptionalControls.profiles.landscape.controls.joystick, undefined);

const ordered = {
  focus: placement(0),
  fire: placement(1),
  bomb: placement(2),
  joystick: placement(3),
  escape: placement(4),
  thpracInput: placement(7),
  thpracTab: placement(5),
  thpracMenu: placement(6),
};
normalizeTouchLayoutPriorityOrder(ordered);
assert.equal(ordered.thpracMenu.priority, 7, "cheat menu must occupy the highest existing thprac slot");
assert.equal(ordered.escape.priority, 4, "thprac reordering must not promote the thprac set over ordinary controls");

const empty = emptyTouchLayout();
assert.deepEqual(empty, { version: 4, profiles: { landscape: null, portrait: null } });
const cloned = cloneTouchLayout(v1);
assert.deepEqual(cloned, v1);
assert.notEqual(cloned.profiles.landscape, v1.profiles.landscape);

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

assert.equal(canonicalTouchLayout(emptyTouchLayout()), null,
  "an all-default layout must not become a persisted override");
const storage = new MemoryStorage({
  [touchLayoutStorageKey]: JSON.stringify({
    version: 3,
    profiles: {
      landscape: { controls: requiredControls(), viewport: { x: 0.1 } },
      portrait: null,
    },
  }),
});
const loaded = loadTouchLayoutFromStorage(storage);
assert.equal(loaded.version, touchLayoutVersion);
assert.equal(loaded.profiles.landscape.viewport.x, 0.1);

const persisted = persistTouchLayoutToStorage(storage, loaded);
assert.deepEqual(JSON.parse(storage.getItem(touchLayoutStorageKey)), persisted,
  "persisted gameplay layout must use the canonical current schema");
persistTouchLayoutToStorage(storage, emptyTouchLayout());
assert.equal(storage.getItem(touchLayoutStorageKey), null,
  "clearing all custom profiles must remove the stored override");

const hostileStorage = {
  getItem() { throw new Error("storage unavailable"); },
  setItem() { throw new Error("storage unavailable"); },
  removeItem() { throw new Error("storage unavailable"); },
};
assert.equal(loadTouchLayoutFromStorage(hostileStorage), null,
  "storage read failure must not break Launcher startup");
assert.deepEqual(persistTouchLayoutToStorage(hostileStorage, loaded), loaded,
  "storage write failure must not discard the current in-memory layout");

console.log(JSON.stringify({
  touchLayoutModel: "PASS",
  version: touchLayoutVersion,
  orientations: touchLayoutOrientations,
  controls: Object.keys(touchLayoutControlMeta).length,
  persistence: "canonical-non-fatal",
}));

const failedPersist = persistTouchLayoutResult(hostileStorage, loaded);
assert.equal(failedPersist.persisted, false);
assert.deepEqual(failedPersist.value, loaded);
assert.ok(failedPersist.error);
console.log("Touch layout persistence result: PASS");
