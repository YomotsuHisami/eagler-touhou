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
  reason: 'hydrate' | 'context' | 'option' | 'music' | 'language' | 'sharing' | 'preview' | 'presentation';
}
export interface GameSettingsModel {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SettingsSnapshot | null;
  hydrate(context: SettingsContext): void;
  refreshContext(context: SettingsContext): void;
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
    // Deliberately reread on every actual selection/re-entry, including previously
    // visited products. A persistent per-product cache would overwrite tab edits.
    hydrate(context: SettingsContext) {read(context, 'hydrate');},
    refreshContext(context: SettingsContext) {
      const state = required();
      if (context.productId !== state.context.productId) {read(context, 'hydrate'); return;}
      const options = {...state.options};
      if (state.multiplayer || !productFeatureAvailable(state.gameId, 'thprac', context.hostFeatures)) options.thpracEnabled = false;
      if (!context.webMidiAvailable || !PRODUCT_GAMES[state.gameId].musicCapabilities.midi) options.externalMidiDeviceId = '';
      publish({...state, context, options,
        language: resolvePreferredGameLanguage(context.languages, state.language, context.uiLocale),
        music: resolveEffectiveMusicMode({...context.musicAvailability, requested: state.musicPreference, explicit: state.musicPreferenceExplicit})}, 'context');
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
