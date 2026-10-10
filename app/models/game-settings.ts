import {
  applySharedTouchPreferences, loadOrInitializeSharedTouchPreferences,
  loadStoredGamePreferences, loadStoredLanguagePreference, persistSharedTouchPreferences,
  persistStoredGamePreferences, touchMovementUsesJoystick,
  type GameOptions, type GamePreferenceStorage, type MusicMode,
} from '../../src/launcher/game-preferences.mts';
import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, productFeatureAvailable,
  type ProductId, type GameId} from '../../src/contracts/product-catalog.mts';
import {createMultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import {resolvePreferredGameLanguage, type LanguageCatalogEntry} from '../../src/launcher/language-catalog.mts';
import {resolveEffectiveMusicMode, resolveMusicAvailability, type MusicAvailabilityInput} from '../../src/launcher/music-availability.mts';

export interface SettingsContext {
  productId: ProductId;
  uiLocale: string;
  hostFeatures?: Parameters<typeof productFeatureAvailable>[2];
  languages: readonly LanguageCatalogEntry[];
  musicAvailability: MusicAvailabilityInput;
  webMidiAvailable: boolean;
  /** Original mobile disclosure default, supplied by the browser host. */
  mobile: boolean;
  /** A seated player's room may prohibit touch-unlimited. */
  forbidUnlimitedMovement?: boolean;
}
export interface SettingsDisclosureState {touch: boolean; files: boolean; display: boolean; advanced: boolean}
export interface SettingsSnapshot {
  context: SettingsContext;
  gameId: GameId;
  preferenceId: ProductId;
  multiplayer: boolean;
  shareSingleplayerSettings: boolean;
  options: Readonly<GameOptions>;
  music: MusicMode;
  musicPreference: MusicMode;
  musicPreferenceExplicit: boolean;
  language: string;
  disclosure: Readonly<SettingsDisclosureState>;
  revision: number;
}
export interface SettingsChange {
  previous: SettingsSnapshot | null;
  current: SettingsSnapshot;
  reason: 'hydrate' | 'host-restore' | 'locale-restore' | 'context' | 'option' | 'music' | 'language' | 'sharing' | 'preview' | 'presentation';
}

/** Original settings event policy, independent of Runtime/save ownership.
 * Main app4880–4904 resets ordinary options, including the MIDI device4483.
 * Sensitivity/opacity8914–8943 are live; lobby language/music/frame limit
 * 6587–6603 only persist. Session MIDI enable/disable has its own successful
 * permission/switch boundary4446–4474 and is intentionally outside this model. */
export function settingsChangeResetsRuntime({previous, current, reason}: SettingsChange): boolean {
  if (!previous) return false;
  switch (reason) {
    case 'hydrate': return previous.context.productId !== current.context.productId;
    case 'sharing': return true;
    case 'language': return !current.multiplayer && previous.language !== current.language;
    case 'music': return !current.multiplayer && (previous.music !== current.music
      || previous.musicPreference !== current.musicPreference
      || previous.musicPreferenceExplicit !== current.musicPreferenceExplicit);
    case 'option': return (Object.keys(current.options) as (keyof GameOptions)[]).some(name =>
      previous.options[name] !== current.options[name]
      && name !== 'touchSensitivity' && name !== 'touchControlOpacity'
      && !(current.multiplayer && name === 'frameLimit60Enabled'));
    case 'host-restore': case 'locale-restore': case 'context': case 'preview': case 'presentation': return false;
  }
}
export interface GameSettingsModel {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SettingsSnapshot | null;
  hydrate(context: SettingsContext, options?: {resetDisclosure?: boolean}): void;
  /** Main first-Host/subset preference restoration does not reset Runtime. */
  restoreHostPreferences(context: SettingsContext): void;
  /** Main locale event rereads all preferences only while unlaunched. */
  restoreLocalePreferences(context: SettingsContext): void;
  /** Called once by document entry after routed preferences, before Host apply. */
  applyBootTouchPreview(): void;
  refreshContext(context: SettingsContext): void;
  setMovementRestriction(forbidden: boolean): void;
  setTouchSettingsPriority(mobile: boolean): void;
  setOption<K extends keyof GameOptions>(name: K, value: GameOptions[K]): void;
  previewSensitivity(value: number): void;
  commitPreferences(): void;
  setMusic(value: MusicMode): void;
  setLanguage(value: string): void;
  setShareSingleplayerSettings(enabled: boolean): void;
  setDisclosure(name: keyof SettingsDisclosureState, open: boolean): void;
}

/** One document-lived settings authority for library and lobby. Storage is an
 * explicit browser dependency; constructing this owner is safe during render. */
export function createGameSettingsModel({storage, onChange}: {
  storage: GamePreferenceStorage | null;
  onChange?: (change: SettingsChange) => void;
}): GameSettingsModel {
  const listeners = new Set<() => void>();
  const multiplayerPreferences = createMultiplayerPreferenceStore({storage});
  let snapshot: SettingsSnapshot | null = null;
  let revision = 0;
  const disclosures: Partial<Record<'singleplayer' | 'multiplayer', SettingsDisclosureState>> = {};
  function publish(next: Omit<SettingsSnapshot, 'revision'>, reason: SettingsChange['reason']) {
    const previous = snapshot;
    snapshot = Object.freeze({...next, options: Object.freeze({...next.options}), revision: ++revision});
    for (const listener of listeners) listener();
    onChange?.({previous, current: snapshot, reason});
  }
  function required() {
    if (!snapshot) throw new Error('Settings have not been hydrated');
    return snapshot;
  }
  function commitPreferences() {
    const state = required();
    persistSharedTouchPreferences(storage, {...state.options});
    persistStoredGamePreferences({storage, preferenceId: state.preferenceId,
      preferences: {...state, options: {...state.options}}, language: state.language});
  }
  function read(context: SettingsContext, reason: SettingsChange['reason'], sharing?: boolean) {
    const gameId = gameIdForProduct(context.productId), multiplayer = isMultiplayerProductId(context.productId);
    const shareSingleplayerSettings = sharing ?? multiplayerPreferences.load({product: context.productId, multiplayer, maxLoadout: 0}).shareSingleplayerSettings;
    const preferenceId = multiplayer && !shareSingleplayerSettings ? context.productId : gameId;
    const disclosureKey = multiplayer ? 'multiplayer' : 'singleplayer';
    const disclosure = disclosures[disclosureKey] ??= {touch: context.mobile, files: true, display: true, advanced: false};
    const normalized = loadStoredGamePreferences({storage, preferenceId,
      fallbackPreferenceId: multiplayer ? gameId : null,
      context: {uiLocale: context.uiLocale, thpracAvailable: productFeatureAvailable(gameId, 'thprac', context.hostFeatures),
        webAudioAvailable: context.musicAvailability.audio,
        externalMidiAvailable: PRODUCT_GAMES[gameId].musicCapabilities.midi && context.webMidiAvailable}});
    const options = applySharedTouchPreferences(normalized.options, loadOrInitializeSharedTouchPreferences(storage, normalized.options));
    if (multiplayer) options.thpracEnabled = false;
    const savedLanguage = loadStoredLanguagePreference({storage, preferenceId, fallbackPreferenceId: multiplayer ? gameId : null});
    publish({context, gameId, preferenceId, multiplayer, shareSingleplayerSettings, disclosure: {...disclosure}, options,
      music: resolveEffectiveMusicMode({...context.musicAvailability, requested: normalized.musicPreference, explicit: normalized.musicPreferenceExplicit}),
      musicPreference: normalized.musicPreference, musicPreferenceExplicit: normalized.musicPreferenceExplicit,
      language: resolvePreferredGameLanguage(context.languages, savedLanguage, context.uiLocale)}, reason);
  }
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    // Explicit preference reread. The root preserves main's same-card library
    // reopen without hydration; a fresh lobby iframe lifetime rereads settings
    // and resets only that lifetime's disclosure presentation.
    hydrate(context: SettingsContext, options?: {resetDisclosure?: boolean}) {
      if (options?.resetDisclosure) delete disclosures[isMultiplayerProductId(context.productId) ? 'multiplayer' : 'singleplayer'];
      read(context, 'hydrate');
    },
    restoreHostPreferences(context: SettingsContext) {
      // Main1500–1521 restores selected/subset preferences without resetRuntime,
      // even if the first Host selects a different product from the local catalog.
      read(context, 'host-restore');
    },
    restoreLocalePreferences(context: SettingsContext) {
      // Main4840–4845: the document host owns the !launched guard. Unlike an
      // ordinary metadata/hint render, this explicit event rereads preferences.
      read(context, 'locale-restore');
    },
    applyBootTouchPreview() {
      const state = required();
      if (state.options.touchEnabled) return;
      // Main9742–9751 is one session write, not a durable setting or a sticky
      // overlay. The document host owns the single entry call; later preference
      // restoration may replace this flag without reopening/reapplying preview.
      publish({...state, options: {...state.options, touchEnabled: true}}, 'preview');
    },
    refreshContext(context: SettingsContext) {
      const state = required();
      if (context.productId !== state.context.productId) {read(context, 'hydrate'); return;}
      const options = {...state.options};
      // Main4750–4751 has this one render-time option normalization. Other
      // choices, including language and disconnected MIDI output, stay in memory.
      if (state.multiplayer || !productFeatureAvailable(state.gameId, 'thprac', context.hostFeatures)) options.thpracEnabled = false;
      publish({...state, context, options,
        music: resolveEffectiveMusicMode({...context.musicAvailability, requested: state.musicPreference, explicit: state.musicPreferenceExplicit})}, 'context');
    },
    setMovementRestriction(forbidden: boolean) {
      const state = required();
      if (!!state.context.forbidUnlimitedMovement === forbidden) return;
      // Main room messages update the live rule (app552–554), then setOption
      // reads it synchronously (4881). A room rule/seat change must not reread
      // preferences, especially when durable storage rejected a session edit.
      publish({...state, context: {...state.context, forbidUnlimitedMovement: forbidden}}, 'context');
    },
    setTouchSettingsPriority(mobile: boolean) {
      const state = required();
      if (state.context.mobile === mobile) return;
      // Main9755–9771 reorders the existing groups only. A pointer change must
      // not reread preferences or reset the user's current disclosure state.
      publish({...state, context: {...state.context, mobile}}, 'context');
    },
    setOption<K extends keyof GameOptions>(name: K, value: GameOptions[K]) {
      const state = required();
      if (name === 'touchMovementMode' && value === 'touch-unlimited' && state.context.forbidUnlimitedMovement) throw new Error('room.movementRequired');
      if (name === 'thpracEnabled' && (state.multiplayer || !productFeatureAvailable(state.gameId, 'thprac', state.context.hostFeatures))) return;
      if (state.options[name] === value) return;
      const options = {...state.options, [name]: value};
      if (name === 'touchMovementMode' && touchMovementUsesJoystick(value) && options.touchFocusMode === 'two-finger') options.touchFocusMode = 'hold-button';
      if (name === 'touchSensitivity') options.touchSensitivity = Math.max(100, Math.min(300, Math.round(Number(value) || 100)));
      if (name === 'touchControlOpacity') options.touchControlOpacity = Math.max(20, Math.min(100, Math.round(Number(value) / 5) * 5 || 20));
      publish({...state, options}, 'option'); commitPreferences();
    },
    previewSensitivity(value: number) {
      const state = required();
      publish({...state, options: {...state.options, touchSensitivity: Math.max(100, Math.min(300, Math.round(value) || 100))}}, 'preview');
    },
    commitPreferences,
    setMusic(value: MusicMode) {
      const state = required(), availability = resolveMusicAvailability(state.context.musicAvailability);
      if (value === 'midi' && !availability.midi || value.startsWith('ogg-') && !availability.ogg) return;
      publish({...state, music: value, musicPreference: value, musicPreferenceExplicit: true}, 'music'); commitPreferences();
    },
    setLanguage(value: string) {
      const state = required();
      if (!state.context.languages.some(entry => entry.id === value)) return;
      publish({...state, language: value}, 'language'); commitPreferences();
    },
    setDisclosure(name: keyof SettingsDisclosureState, open: boolean) {
      const state = required();
      if (state.disclosure[name] === open) return;
      const disclosure = {...state.disclosure, [name]: open};
      disclosures[state.multiplayer ? 'multiplayer' : 'singleplayer'] = disclosure;
      publish({...state, disclosure}, 'presentation');
    },
    setShareSingleplayerSettings(enabled: boolean) {
      const state = required();
      if (!state.multiplayer || state.shareSingleplayerSettings === enabled) return;
      multiplayerPreferences.persistShareSingleplayerSettings(state.context.productId, enabled);
      read(state.context, 'sharing', enabled);
    },
  });
}
