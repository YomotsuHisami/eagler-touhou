import assert from "node:assert/strict";
import {
  DEFAULT_GAME_OPTIONS,
  applySharedTouchPreferences,
  gamePreferenceStorageKey,
  languagePreferenceStorageKey,
  loadStoredGamePreferences,
  loadStoredLanguagePreference,
  loadOrInitializeSharedTouchPreferences,
  normalizeStoredGamePreferences,
  persistStoredGamePreferences,
  persistSharedTouchPreferences,
  sharedTouchPreferenceStorageKey,
  serializeGamePreferences,
} from "../.cache/build/browser/assets/launcher/game-preferences.mjs";

assert.equal(gamePreferenceStorageKey("th06"), "eagler-touhou-game-options-v1-th06");
assert.equal(languagePreferenceStorageKey("th07mp"), "eagler-touhou-language-v1-th07mp");
assert.equal(sharedTouchPreferenceStorageKey, "eagler-touhou-touch-options-v1");
assert.equal(DEFAULT_GAME_OPTIONS.restartButtonEnabled, false, "R must be hidden by default");
assert.equal(DEFAULT_GAME_OPTIONS.touchSensitivity, 150, "new touch settings default to 150%");
assert.equal(DEFAULT_GAME_OPTIONS.frameLimit60Enabled, true, "high refresh must be off by default");
assert.equal(normalizeStoredGamePreferences(null, { thpracAvailable: true, webAudioAvailable: true }).options.frameLimit60Enabled, true);
for (const frameLimit60Enabled of [false, true]) {
  assert.equal(normalizeStoredGamePreferences({ options: { frameLimit60Enabled } }, { thpracAvailable: true, webAudioAvailable: true }).options.frameLimit60Enabled, frameLimit60Enabled,
    "renaming the switch must preserve an existing explicit refresh-rate choice");
}
assert.equal(normalizeStoredGamePreferences(null, { thpracAvailable: true, webAudioAvailable: true }).options.touchSensitivity, 150);
assert.equal(normalizeStoredGamePreferences({ options: { touchSensitivity: 100 } }, { thpracAvailable: true, webAudioAvailable: true }).options.touchSensitivity, 100,
  "an existing 100% preference remains explicit");

const legacyFrameLimit = normalizeStoredGamePreferences({
  music: "midi",
  options: {
    limitPresentationTo60: true,
    frameLimit60Enabled: false,
  },
}, { thpracAvailable: true, webAudioAvailable: true });
assert.equal(legacyFrameLimit.options.frameLimit60Enabled, false,
  "legacy host frame-limit preference must not resurrect into the renamed option");
assert.equal(legacyFrameLimit.storageRewriteRequired, true);
assert.equal(Object.hasOwn(legacyFrameLimit.sanitizedRecord.options, "limitPresentationTo60"), false,
  "legacy host frame-limit key must be physically removed from the persisted record");

const legacyFocusHitbox = normalizeStoredGamePreferences({
  options: { th06FocusHitbox: true },
}, { thpracAvailable: true, webAudioAvailable: true });
assert.equal(legacyFocusHitbox.options.focusHitboxEnabled, true,
  "legacy TH06-named focus-hitbox preference must migrate to the generic product capability");
assert.equal(legacyFocusHitbox.storageRewriteRequired, true);
assert.equal(Object.hasOwn(legacyFocusHitbox.sanitizedRecord.options, "th06FocusHitbox"), false,
  "legacy TH06-named focus-hitbox key must be removed after migration");
assert.equal(legacyFocusHitbox.sanitizedRecord.options.focusHitboxEnabled, true);

const legacyMultiplayerVisibility = normalizeStoredGamePreferences({
  options: { enhanceLocalPlayerVisibility: true },
}, { thpracAvailable: true, webAudioAvailable: true });
assert.equal(legacyMultiplayerVisibility.options.multiplayerLocalPlayerVisibility, true,
  "legacy local-player visibility preference must migrate into the Multiplayer profile");
assert.equal(legacyMultiplayerVisibility.storageRewriteRequired, true);
assert.equal(Object.hasOwn(legacyMultiplayerVisibility.sanitizedRecord.options, "enhanceLocalPlayerVisibility"), false);
assert.equal(legacyMultiplayerVisibility.sanitizedRecord.options.multiplayerLocalPlayerVisibility, true);

const migratedTouch = normalizeStoredGamePreferences({
  music: "ogg",
  musicPreferenceExplicit: true,
  options: {
    unlimitedTouch: true,
    touchSensitivity: 450.4,
    touchFocusMode: "two-finger",
    thpracEnabled: true,
  },
}, { thpracAvailable: false, webAudioAvailable: true });
assert.equal(migratedTouch.options.touchMovementMode, "touch-unlimited",
  "old unlimitedTouch must migrate into the mutually-exclusive movement mode");
assert.equal(migratedTouch.options.touchSensitivity, 300, "touch sensitivity must remain bounded");
const migratedLowSensitivity = normalizeStoredGamePreferences({
  options: { touchSensitivity: 50 },
}, { thpracAvailable: true, webAudioAvailable: true });
assert.equal(migratedLowSensitivity.options.touchSensitivity, 100,
  "legacy touch sensitivity below 100% must clamp to the new minimum");
assert.equal(migratedTouch.options.thpracEnabled, false, "unavailable thprac cannot be restored as enabled");
assert.equal(migratedTouch.musicPreference, "ogg-stream", "legacy OGG/WAV preference maps to the canonical OGG mode");
assert.equal(migratedTouch.music, "ogg-stream");

const joystick = normalizeStoredGamePreferences({
  options: { touchMovementMode: "joystick", touchFocusMode: "two-finger" },
}, { thpracAvailable: true, webAudioAvailable: false });
assert.equal(joystick.options.touchFocusMode, "hold-button",
  "two-finger focus is invalid for wheel movement and must normalize to hold-button");
assert.equal(joystick.music, "none", "missing WebAudio forces runtime music off without destroying the saved preference");
assert.equal(joystick.musicPreference, "ogg-stream");

const serialized = serializeGamePreferences({
  options: { ...DEFAULT_GAME_OPTIONS, frameLimit60Enabled: true },
  music: "midi",
  musicPreference: "ogg-full",
  musicPreferenceExplicit: true,
});
assert.equal(serialized.music, "ogg-full");
assert.equal(serialized.options.frameLimit60Enabled, true);
assert.equal(Object.hasOwn(serialized.options, "limitPresentationTo60"), false,
  "new preference writes must never reintroduce the retired host key");
assert.equal(Object.hasOwn(serialized.options, "th06FocusHitbox"), false,
  "new preference writes must use the generic focus-hitbox capability key");
assert.equal(Object.hasOwn(serialized.options, "enhanceLocalPlayerVisibility"), false,
  "new preference writes must use the Multiplayer-profile visibility key");

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage({
  [gamePreferenceStorageKey("th07")]: JSON.stringify({
    music: "midi",
    options: { limitPresentationTo60: true, touchEnabled: true },
  }),
  [languagePreferenceStorageKey("th07")]: "lang_en",
});
const initializedSharedTouch = loadOrInitializeSharedTouchPreferences(storage, {
  ...DEFAULT_GAME_OPTIONS,
  touchMovementMode: "joystick-free",
  touchSensitivity: 175,
  touchFocusMode: "toggle-button",
  doubleTapBombEnabled: true,
  restartButtonEnabled: false,
  thpracTouchControlsEnabled: true,
});
assert.deepEqual(JSON.parse(storage.getItem(sharedTouchPreferenceStorageKey)), initializedSharedTouch,
  "the first selected game's existing touch settings must initialize the cross-game record");
const sharedAppliedToAnotherGame = applySharedTouchPreferences(
  { ...DEFAULT_GAME_OPTIONS, touchMovementMode: "touch", touchSensitivity: 50 },
  initializedSharedTouch,
);
assert.equal(sharedAppliedToAnotherGame.touchMovementMode, "joystick-free");
assert.equal(sharedAppliedToAnotherGame.touchSensitivity, 175);
assert.equal(sharedAppliedToAnotherGame.doubleTapBombEnabled, true);
assert.equal(sharedAppliedToAnotherGame.restartButtonEnabled, false);
assert.equal(sharedAppliedToAnotherGame.thpracTouchControlsEnabled, true);
assert.equal(sharedAppliedToAnotherGame.touchEnabled, false,
  "the touch enable switch remains a per-game option because it is outside the layout/settings dialog");
persistSharedTouchPreferences(storage, { ...sharedAppliedToAnotherGame, touchSensitivity: 225 });
assert.equal(JSON.parse(storage.getItem(sharedTouchPreferenceStorageKey)).touchSensitivity, 225);
const fallback = loadStoredGamePreferences({
  storage,
  preferenceId: "th07mp",
  fallbackPreferenceId: "th07",
  context: { thpracAvailable: true, webAudioAvailable: true },
});
assert.equal(fallback.options.touchEnabled, true,
  "a separate multiplayer preference may inherit the base game until it has its own record");
assert.equal(Object.hasOwn(
  JSON.parse(storage.getItem(gamePreferenceStorageKey("th07mp"))).options,
  "limitPresentationTo60",
), false, "legacy cleanup discovered through fallback must rewrite the active preference id");
assert.equal(loadStoredLanguagePreference({
  storage,
  preferenceId: "th07mp",
  fallbackPreferenceId: "th07",
}), "lang_en");

persistStoredGamePreferences({
  storage,
  preferenceId: "th07mp",
  preferences: {
    options: { ...DEFAULT_GAME_OPTIONS, touchEnabled: true },
    music: "midi",
    musicPreference: "ogg-full",
    musicPreferenceExplicit: true,
  },
  language: "lang_zh-hans",
});
assert.equal(JSON.parse(storage.getItem(gamePreferenceStorageKey("th07mp"))).music, "ogg-full");
assert.equal(storage.getItem(languagePreferenceStorageKey("th07mp")), "lang_zh-hans");

const hostileStorage = {
  getItem() { throw new Error("storage unavailable"); },
  setItem() { throw new Error("storage unavailable"); },
};
const storageFailure = loadStoredGamePreferences({
  storage: hostileStorage,
  preferenceId: "th06",
  context: { thpracAvailable: true, webAudioAvailable: true },
});
assert.deepEqual(storageFailure.options, DEFAULT_GAME_OPTIONS,
  "storage read failure must degrade to defaults without breaking Launcher startup");
assert.doesNotThrow(() => persistStoredGamePreferences({
  storage: hostileStorage,
  preferenceId: "th06",
  preferences: {
    options: { ...DEFAULT_GAME_OPTIONS },
    music: "none",
    musicPreference: "none",
    musicPreferenceExplicit: true,
  },
  language: "ja",
}), "storage write failure must remain non-fatal");

console.log(JSON.stringify({
  gamePreferences: "PASS",
  legacyFrameLimit: "removed",
  legacyTouchMovement: "migrated",
  persistenceKeys: "game-language-shared-touch",
  storage: "primary-fallback-non-fatal",
}));

const chineseContext = { uiLocale: "zh-CN", thpracAvailable: true, webAudioAvailable: true };
const chineseDefaults = normalizeStoredGamePreferences(null, chineseContext);
assert.equal(chineseDefaults.options.thpracEnabled, true);
assert.equal(chineseDefaults.music, "ogg-stream");
assert.equal(normalizeStoredGamePreferences(null, { ...chineseContext, thpracAvailable: false }).options.thpracEnabled, false);
assert.equal(normalizeStoredGamePreferences(null, { ...chineseContext, uiLocale: "en" }).options.thpracEnabled, false);
const explicitChinese = normalizeStoredGamePreferences({ options: { thpracEnabled: false }, music: "ogg-full", musicPreferenceExplicit: true }, chineseContext);
assert.equal(explicitChinese.options.thpracEnabled, false, "explicitly disabled thprac must survive locale defaults");
assert.equal(explicitChinese.musicPreference, "ogg-full", "saved music must survive locale defaults");
const chineseInherited = loadStoredGamePreferences({ storage, preferenceId: "th07mp", fallbackPreferenceId: "th07", context: chineseContext });
assert.equal(chineseInherited.musicPreference, "ogg-full");
assert.equal(chineseInherited.options.thpracEnabled, false, "existing multiplayer preferences still win");
