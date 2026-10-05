import { TOUCH_SENSITIVITY_MAX, TOUCH_SENSITIVITY_MIN } from "../contracts/runtime-protocol.mjs";

export type TouchMovementMode = "touch" | "touch-unlimited" | "joystick" | "joystick-free";
export type TouchFocusMode = "two-finger" | "hold-button" | "toggle-button";
export type MusicMode = "ogg-stream" | "ogg-full" | "midi" | "none";

export interface GameOptions {
  thpracEnabled: boolean;
  thpracTouchControlsEnabled: boolean;
  magnifierEnabled: boolean;
  focusHitboxEnabled: boolean;
  frameLimit60Enabled: boolean;
  touchEnabled: boolean;
  touchMovementMode: TouchMovementMode;
  touchSensitivity: number;
  touchFocusMode: TouchFocusMode;
  doubleTapBombEnabled: boolean;
  restartButtonEnabled: boolean;
  alwaysHitbox: boolean;
  multiplayerLocalPlayerVisibility: boolean;
}

export const DEFAULT_GAME_OPTIONS: Readonly<GameOptions> = Object.freeze({
  thpracEnabled: false,
  thpracTouchControlsEnabled: false,
  magnifierEnabled: false,
  focusHitboxEnabled: false,
  frameLimit60Enabled: true,
  touchEnabled: false,
  touchMovementMode: "touch",
  touchSensitivity: 150,
  touchFocusMode: "hold-button",
  doubleTapBombEnabled: false,
  restartButtonEnabled: false,
  alwaysHitbox: false,
  multiplayerLocalPlayerVisibility: false,
});

export const TOUCH_MOVEMENT_MODES = new Set<TouchMovementMode>([
  "touch", "touch-unlimited", "joystick", "joystick-free",
]);
export const TOUCH_FOCUS_MODES = new Set<TouchFocusMode>([
  "two-finger", "hold-button", "toggle-button",
]);
export const MUSIC_MODES = new Set<MusicMode>(["ogg-stream", "ogg-full", "midi", "none"]);

export function isMusicMode(value: string): value is MusicMode {
  return value === "ogg-stream" || value === "ogg-full" || value === "midi" || value === "none";
}

export function isTouchMovementMode(value: string): value is TouchMovementMode {
  return value === "touch" || value === "touch-unlimited" || value === "joystick" || value === "joystick-free";
}

export function isTouchFocusMode(value: string): value is TouchFocusMode {
  return value === "two-finger" || value === "hold-button" || value === "toggle-button";
}

export const gamePreferenceStorageKey = (preferenceId: string): string =>
  `eagler-touhou-game-options-v1-${preferenceId}`;
export const languagePreferenceStorageKey = (preferenceId: string): string =>
  `eagler-touhou-language-v1-${preferenceId}`;
export const sharedTouchPreferenceStorageKey = "eagler-touhou-touch-options-v1";

export const SHARED_TOUCH_OPTION_NAMES = Object.freeze([
  "touchMovementMode",
  "touchSensitivity",
  "touchFocusMode",
  "doubleTapBombEnabled",
  "restartButtonEnabled",
  "thpracTouchControlsEnabled",
] as const);

export type SharedTouchOptionName = (typeof SHARED_TOUCH_OPTION_NAMES)[number];
export type SharedTouchOptions = Pick<GameOptions, SharedTouchOptionName>;

export interface GamePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sharedTouchOptionsFrom(options: GameOptions): SharedTouchOptions {
  return Object.fromEntries(SHARED_TOUCH_OPTION_NAMES.map(name => [name, options[name]])) as SharedTouchOptions;
}

export function normalizeSharedTouchPreferences(value: unknown, fallback: GameOptions): SharedTouchOptions {
  const saved = record(value);
  const normalized = normalizeStoredGamePreferences({ options: { ...fallback, ...saved } }, {
    thpracAvailable: true,
    webAudioAvailable: true,
  });
  return Object.freeze(sharedTouchOptionsFrom(normalized.options));
}

export function applySharedTouchPreferences(options: GameOptions, shared: SharedTouchOptions): GameOptions {
  // Launcher state intentionally mutates option fields before persisting and
  // rendering them. Keep only the standalone shared snapshot immutable.
  return { ...options, ...shared };
}

export function loadOrInitializeSharedTouchPreferences(
  storage: GamePreferenceStorage | null,
  fallback: GameOptions,
): SharedTouchOptions {
  const saved = readStoredJson(storage, sharedTouchPreferenceStorageKey);
  const normalized = normalizeSharedTouchPreferences(saved, fallback);
  if (saved == null && storage) {
    try { storage.setItem(sharedTouchPreferenceStorageKey, JSON.stringify(normalized)); } catch {}
  }
  return normalized;
}

export function persistSharedTouchPreferences(
  storage: GamePreferenceStorage | null,
  options: GameOptions,
): void {
  if (!storage) return;
  try {
    storage.setItem(sharedTouchPreferenceStorageKey, JSON.stringify(sharedTouchOptionsFrom(options)));
  } catch {}
}

export function touchMovementUsesJoystick(mode: unknown): boolean {
  return mode === "joystick" || mode === "joystick-free";
}

type StoredRecord = Record<string, unknown>;

function record(value: unknown): StoredRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as StoredRecord
    : null;
}

function booleanOption(source: StoredRecord | null, name: keyof GameOptions, fallback: boolean): boolean {
  const value = source?.[name];
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMusicMode(value: unknown): MusicMode {
  const legacy = value === "ogg" || value === "wav" ? "ogg-stream" : value;
  return typeof legacy === "string" && MUSIC_MODES.has(legacy as MusicMode)
    ? legacy as MusicMode
    : "ogg-stream";
}

export interface NormalizeGamePreferencesContext {
  uiLocale?: string;
  thpracAvailable: boolean;
  webAudioAvailable: boolean;
}

export interface NormalizedGamePreferences {
  options: GameOptions;
  musicPreferenceExplicit: boolean;
  musicPreference: MusicMode;
  music: MusicMode;
  sanitizedRecord: StoredRecord | null;
  storageRewriteRequired: boolean;
}

export function normalizeStoredGamePreferences(
  savedValue: unknown,
  context: NormalizeGamePreferencesContext,
): NormalizedGamePreferences {
  const saved = record(savedValue);
  const savedOptions = record(saved?.options);

  let sanitizedRecord = saved;
  let storageRewriteRequired = false;
  if (saved && savedOptions) {
    const sanitizedOptions = { ...savedOptions };
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(sanitizedOptions, "limitPresentationTo60")) {
      delete sanitizedOptions.limitPresentationTo60;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(sanitizedOptions, "th06FocusHitbox")) {
      if (!Object.prototype.hasOwnProperty.call(sanitizedOptions, "focusHitboxEnabled")) {
        sanitizedOptions.focusHitboxEnabled = sanitizedOptions.th06FocusHitbox;
      }
      delete sanitizedOptions.th06FocusHitbox;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(sanitizedOptions, "enhanceLocalPlayerVisibility")) {
      if (!Object.prototype.hasOwnProperty.call(sanitizedOptions, "multiplayerLocalPlayerVisibility")) {
        sanitizedOptions.multiplayerLocalPlayerVisibility = sanitizedOptions.enhanceLocalPlayerVisibility;
      }
      delete sanitizedOptions.enhanceLocalPlayerVisibility;
      changed = true;
    }
    if (changed) {
      sanitizedRecord = { ...saved, options: sanitizedOptions };
      storageRewriteRequired = true;
    }
  }

  const rawOptions = record(sanitizedRecord?.options);
  const movementCandidate = rawOptions?.touchMovementMode;
  const migratedMovement: TouchMovementMode = typeof movementCandidate === "string" &&
    TOUCH_MOVEMENT_MODES.has(movementCandidate as TouchMovementMode)
    ? movementCandidate as TouchMovementMode
    : rawOptions?.unlimitedTouch === true ? "touch-unlimited" : "touch";

  const focusCandidate = rawOptions?.touchFocusMode;
  let focusMode: TouchFocusMode = typeof focusCandidate === "string" &&
    TOUCH_FOCUS_MODES.has(focusCandidate as TouchFocusMode)
    ? focusCandidate as TouchFocusMode
    : "hold-button";
  if (touchMovementUsesJoystick(migratedMovement) && focusMode === "two-finger") focusMode = "hold-button";

  const sensitivityCandidate = rawOptions?.touchSensitivity;
  const touchSensitivity = typeof sensitivityCandidate === "number" && Number.isFinite(sensitivityCandidate)
    ? Math.min(TOUCH_SENSITIVITY_MAX, Math.max(TOUCH_SENSITIVITY_MIN, Math.round(sensitivityCandidate)))
    : DEFAULT_GAME_OPTIONS.touchSensitivity;

  const options: GameOptions = {
    thpracEnabled: context.thpracAvailable && booleanOption(rawOptions, "thpracEnabled", /^zh(?:-|$)/i.test(context.uiLocale || "") || DEFAULT_GAME_OPTIONS.thpracEnabled),
    thpracTouchControlsEnabled: booleanOption(rawOptions, "thpracTouchControlsEnabled", DEFAULT_GAME_OPTIONS.thpracTouchControlsEnabled),
    magnifierEnabled: booleanOption(rawOptions, "magnifierEnabled", DEFAULT_GAME_OPTIONS.magnifierEnabled),
    focusHitboxEnabled: booleanOption(rawOptions, "focusHitboxEnabled", DEFAULT_GAME_OPTIONS.focusHitboxEnabled),
    frameLimit60Enabled: booleanOption(rawOptions, "frameLimit60Enabled", DEFAULT_GAME_OPTIONS.frameLimit60Enabled),
    touchEnabled: booleanOption(rawOptions, "touchEnabled", DEFAULT_GAME_OPTIONS.touchEnabled),
    touchMovementMode: migratedMovement,
    touchSensitivity,
    touchFocusMode: focusMode,
    doubleTapBombEnabled: booleanOption(rawOptions, "doubleTapBombEnabled", DEFAULT_GAME_OPTIONS.doubleTapBombEnabled),
    restartButtonEnabled: booleanOption(rawOptions, "restartButtonEnabled", DEFAULT_GAME_OPTIONS.restartButtonEnabled),
    alwaysHitbox: booleanOption(rawOptions, "alwaysHitbox", DEFAULT_GAME_OPTIONS.alwaysHitbox),
    multiplayerLocalPlayerVisibility: booleanOption(rawOptions, "multiplayerLocalPlayerVisibility", DEFAULT_GAME_OPTIONS.multiplayerLocalPlayerVisibility),
  };

  const musicPreference = normalizeMusicMode(sanitizedRecord?.music);
  const musicPreferenceExplicit = sanitizedRecord?.musicPreferenceExplicit === true;
  return Object.freeze({
    options,
    musicPreferenceExplicit,
    musicPreference,
    music: context.webAudioAvailable ? musicPreference : "none",
    sanitizedRecord,
    storageRewriteRequired,
  });
}

export interface SerializeGamePreferencesInput {
  options: GameOptions;
  music: MusicMode;
  musicPreference: MusicMode;
  musicPreferenceExplicit: boolean;
}

export function serializeGamePreferences(input: SerializeGamePreferencesInput): StoredRecord {
  return {
    music: input.musicPreferenceExplicit ? input.musicPreference : input.music,
    musicPreferenceExplicit: input.musicPreferenceExplicit,
    options: Object.fromEntries(Object.keys(DEFAULT_GAME_OPTIONS).map(name => [
      name,
      input.options[name as keyof GameOptions],
    ])),
  };
}

function readStoredJson(storage: GamePreferenceStorage | null, key: string): unknown {
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(key) || "null"); }
  catch { return null; }
}

function readStoredString(storage: GamePreferenceStorage | null, key: string): string | null {
  if (!storage) return null;
  try { return storage.getItem(key); }
  catch { return null; }
}

export function loadStoredGamePreferences({
  storage,
  preferenceId,
  fallbackPreferenceId = null,
  context,
}: {
  storage: GamePreferenceStorage | null;
  preferenceId: string;
  fallbackPreferenceId?: string | null;
  context: NormalizeGamePreferencesContext;
}): NormalizedGamePreferences {
  let saved = readStoredJson(storage, gamePreferenceStorageKey(preferenceId));
  if (!saved && fallbackPreferenceId) {
    saved = readStoredJson(storage, gamePreferenceStorageKey(fallbackPreferenceId));
  }
  const normalized = normalizeStoredGamePreferences(saved, context);
  if (normalized.storageRewriteRequired && storage) {
    try {
      storage.setItem(gamePreferenceStorageKey(preferenceId), JSON.stringify(normalized.sanitizedRecord));
    } catch {}
  }
  return normalized;
}

export function loadStoredLanguagePreference({
  storage,
  preferenceId,
  fallbackPreferenceId = null,
}: {
  storage: GamePreferenceStorage | null;
  preferenceId: string;
  fallbackPreferenceId?: string | null;
}): string | null {
  let saved = readStoredString(storage, languagePreferenceStorageKey(preferenceId));
  if (!saved && fallbackPreferenceId) {
    saved = readStoredString(storage, languagePreferenceStorageKey(fallbackPreferenceId));
  }
  return saved;
}

export function persistStoredGamePreferences({
  storage,
  preferenceId,
  preferences,
  language,
}: {
  storage: GamePreferenceStorage | null;
  preferenceId: string;
  preferences: SerializeGamePreferencesInput;
  language: string;
}): void {
  if (!storage) return;
  try {
    storage.setItem(gamePreferenceStorageKey(preferenceId), JSON.stringify(serializeGamePreferences(preferences)));
  } catch {}
  try { storage.setItem(languagePreferenceStorageKey(preferenceId), language); } catch {}
}
