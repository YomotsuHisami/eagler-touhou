import {loadGameVersion, persistGameVersion, GAME_VERSIONS} from "../../package/game-version.mjs";
import type {GameVersion} from "../../src/contracts/package-read-models.mts";
import {
  applySharedTouchPreferences, loadOrInitializeSharedTouchPreferences,
  loadStoredGamePreferences, loadStoredLanguagePreference, persistSharedTouchPreferences,
  persistStoredGamePreferences, touchMovementUsesJoystick,
  normalizeStoredGamePreferences,
  type GameOptions, type GamePreferenceStorage, type MusicMode,
} from '../../src/launcher/game-preferences.mts';
import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, productFeatureAvailable,
  type ProductId, type GameId} from '../../src/contracts/product-catalog.mts';
import {createMultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import {resolvePreferredGameLanguage, type LanguageCatalogEntry} from '../../src/launcher/language-catalog.mts';
import {resolveEffectiveMusicMode, resolveMusicAvailability, type MusicAvailabilityInput} from '../../src/launcher/music-availability.mts';
import {createScopedSettingsStore, type SettingsScope, type SettingsPatch} from './scoped-settings';

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
  editorScope?: SettingsScope;
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
  gameVersion: GameVersion;
  disclosure: Readonly<SettingsDisclosureState>;
  /** Game editors only: what this game would use if it followed global settings. */
  globalBaseline?: Readonly<{options: Readonly<GameOptions>; musicPreference: MusicMode; musicPreferenceExplicit: boolean}>;
  revision: number;
}
export interface SettingsChange {
  previous: SettingsSnapshot | null;
  current: SettingsSnapshot;
  reason: 'hydrate' | 'host-restore' | 'locale-restore' | 'context' | 'option' | 'music' | 'language' | 'sharing' | 'game-version' | 'preview' | 'presentation';
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
    case 'game-version': return previous.gameVersion !== current.gameVersion;
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
  createEditor(scope: SettingsScope): GameSettingsModel;
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
  setGameVersion(value: GameVersion): void;
  setShareSingleplayerSettings(enabled: boolean): void;
  setDisclosure(name: keyof SettingsDisclosureState, open: boolean): void;
  /** Game editors only: drop this game's own value so it follows global settings again. */
  resetToGlobal(name: keyof GameOptions | 'music'): void;
}

/** One document-lived settings authority for library and lobby. Storage is an
 * explicit browser dependency; constructing this owner is safe during render. */
export function createGameSettingsModel({storage, onChange, editorScope, scopedStore = createScopedSettingsStore(storage), onPreferencesCommitted}: {
  storage: GamePreferenceStorage | null;
  onChange?: (change: SettingsChange) => void;
  editorScope?: SettingsScope;
  scopedStore?: ReturnType<typeof createScopedSettingsStore>;
  onPreferencesCommitted?(reason: SettingsChange['reason']): void;
}): GameSettingsModel {
  const listeners = new Set<() => void>();
  const multiplayerPreferences = createMultiplayerPreferenceStore({storage});
  let snapshot: SettingsSnapshot | null = null;
  let revision = 0;
  const disclosures: Partial<Record<'singleplayer' | 'multiplayer', SettingsDisclosureState>> = {};
  const touched = new Set<keyof GameOptions>();
  let musicTouched = false, languageTouched = false;
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
  function commitPreferences(reason: SettingsChange['reason'] = 'option') {
    const state = required();
    const global = scopedStore.read('global',state.preferenceId);
    const fields = [...touched].filter(name => editorScope || global.options?.[name] !== undefined);
    const patch: SettingsPatch = {options:Object.fromEntries(fields.map(name=>[name,state.options[name]])),
      ...(musicTouched && (editorScope || global.music !== undefined) ? {music:state.musicPreference} : {}),
      ...(languageTouched && (editorScope || global.language !== undefined) ? {language:state.language} : {})};
    if (fields.length || patch.music !== undefined || patch.language !== undefined) scopedStore.write(editorScope ?? 'game',state.preferenceId,patch);
    if (editorScope !== 'global') {
      if (editorScope !== 'game') persistSharedTouchPreferences(storage, {...state.options});
      persistStoredGamePreferences({storage, preferenceId: state.preferenceId,
        preferences: {...state, options: {...state.options}}, language: state.language});
    }
    touched.clear();musicTouched = languageTouched = false;
    onPreferencesCommitted?.(reason);
  }
  function read(context: SettingsContext, reason: SettingsChange['reason'], sharing?: boolean) {
    const gameId = gameIdForProduct(context.productId), product = PRODUCT_GAMES[gameId], multiplayer = isMultiplayerProductId(context.productId);
    const shareSingleplayerSettings = sharing ?? multiplayerPreferences.load({product: context.productId, multiplayer, maxLoadout: 0}).shareSingleplayerSettings;
    const preferenceId = multiplayer && !shareSingleplayerSettings ? context.productId : gameId;
    const disclosureKey = multiplayer ? 'multiplayer' : 'singleplayer';
    const disclosure = disclosures[disclosureKey] ??= {touch: context.mobile, files: true, display: true, advanced: false};
    const normalizationContext = {uiLocale: context.uiLocale, thpracAvailable: editorScope === 'global' || productFeatureAvailable(gameId, 'thprac', context.hostFeatures),
      webAudioAvailable: context.musicAvailability.audio, externalMidiAvailable: editorScope === 'global' || PRODUCT_GAMES[gameId].musicCapabilities.midi && context.webMidiAvailable};
    const normalized = editorScope === 'global' ? normalizeStoredGamePreferences(null,normalizationContext) : loadStoredGamePreferences({storage, preferenceId,
      fallbackPreferenceId: multiplayer ? gameId : null,
      context: normalizationContext});
    const global = scopedStore.read('global',preferenceId), local = editorScope === 'global' ? {} : scopedStore.read('game',preferenceId);
    const sharedTouch = loadOrInitializeSharedTouchPreferences(storage, normalized.options);
    const baseOptions = applySharedTouchPreferences(normalized.options, sharedTouch);
    const desiredMusic = local.music ?? global.music ?? normalized.musicPreference;
    const explicitMusic = local.music !== undefined || global.music !== undefined || normalized.musicPreferenceExplicit;
    const combined = normalizeStoredGamePreferences({options:{...baseOptions,...global.options,...local.options},music:desiredMusic,musicPreferenceExplicit:explicitMusic},normalizationContext);
    const options = combined.options;
    if (multiplayer && editorScope !== 'global') options.thpracEnabled = false;
    if (editorScope !== 'global' && (global.options?.frameLimit60Enabled !== undefined || local.options?.frameLimit60Enabled !== undefined) && !product.support.highRefreshRate) options.frameLimit60Enabled = true;
    if (editorScope !== 'global' && (global.options?.focusHitboxEnabled !== undefined || local.options?.focusHitboxEnabled !== undefined) && !productFeatureAvailable(gameId,'focusHitbox',context.hostFeatures)) options.focusHitboxEnabled = false;
    if (editorScope !== 'global' && (global.options?.faithBarEnabled !== undefined || local.options?.faithBarEnabled !== undefined) && !('display' in product && product.display.faithBar)) options.faithBarEnabled = false;
    if (context.forbidUnlimitedMovement && options.touchMovementMode === 'touch-unlimited' && editorScope !== 'global' && (global.options?.touchMovementMode !== undefined || local.options?.touchMovementMode !== undefined)) options.touchMovementMode = 'touch';
    const savedLanguage = editorScope === 'global' ? null : loadStoredLanguagePreference({storage, preferenceId, fallbackPreferenceId: multiplayer ? gameId : null});
    let globalBaseline: SettingsSnapshot['globalBaseline'];
    if (editorScope === 'game') {
      // Mirrors the global editor's own read, so both editors agree on the global value.
      const globalContext = {...normalizationContext, thpracAvailable: true, externalMidiAvailable: true};
      const defaults = normalizeStoredGamePreferences(null,globalContext);
      const baseline = normalizeStoredGamePreferences({options:{...applySharedTouchPreferences(defaults.options,sharedTouch),...global.options},
        music:global.music ?? defaults.musicPreference,musicPreferenceExplicit:global.music !== undefined || defaults.musicPreferenceExplicit},globalContext);
      globalBaseline = Object.freeze({options:Object.freeze({...baseline.options}),musicPreference:baseline.musicPreference,musicPreferenceExplicit:baseline.musicPreferenceExplicit});
    }
    publish({...(editorScope ? {editorScope} : {}),...(globalBaseline ? {globalBaseline} : {}),context, gameId, preferenceId, multiplayer, shareSingleplayerSettings, disclosure: {...disclosure}, options,
      music: resolveEffectiveMusicMode({...context.musicAvailability, requested: combined.musicPreference, explicit: combined.musicPreferenceExplicit}),
      musicPreference: combined.musicPreference, musicPreferenceExplicit: combined.musicPreferenceExplicit,
      gameVersion: loadGameVersion(storage, gameId),
      language: resolvePreferredGameLanguage(context.languages, local.language ?? global.language ?? savedLanguage, context.uiLocale)}, reason);
  }
  return Object.freeze({
    createEditor(scope: SettingsScope) {
      return createGameSettingsModel({storage,editorScope:scope,scopedStore,onPreferencesCommitted:reason=>{if(snapshot)read(snapshot.context,reason);}});
    },
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
      if (editorScope !== 'global' && (state.multiplayer || !productFeatureAvailable(state.gameId, 'thprac', context.hostFeatures))) options.thpracEnabled = false;
      publish({...state, context, options,
        music: resolveEffectiveMusicMode({...context.musicAvailability, requested: state.musicPreference, explicit: state.musicPreferenceExplicit})}, 'context');
    },
    setMovementRestriction(forbidden: boolean) {
      const state = required();
      if (!!state.context.forbidUnlimitedMovement === forbidden) return;
      // Main room messages update the live rule (app552–554), then setOption
      // reads it synchronously (4881). A room rule/seat change must not reread
      // preferences, especially when durable storage rejected a session edit.
      const global = scopedStore.read('global',state.preferenceId), local = scopedStore.read('game',state.preferenceId);
      const requested = local.options?.touchMovementMode ?? global.options?.touchMovementMode;
      const options = editorScope !== 'global' && requested === 'touch-unlimited'
        ? {...state.options,touchMovementMode:forbidden ? 'touch' as const : 'touch-unlimited' as const} : state.options;
      publish({...state, options,context: {...state.context, forbidUnlimitedMovement: forbidden}}, 'context');
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
      if (name === 'touchMovementMode' && value === 'touch-unlimited' && state.context.forbidUnlimitedMovement && editorScope !== 'global') throw new Error('room.movementRequired');
      if (name === 'thpracEnabled' && editorScope !== 'global' && (state.multiplayer || !productFeatureAvailable(state.gameId, 'thprac', state.context.hostFeatures))) return;
      if (state.options[name] === value) return;
      const options = {...state.options, [name]: value};
      if (name === 'touchMovementMode' && touchMovementUsesJoystick(value) && options.touchFocusMode === 'two-finger') options.touchFocusMode = 'hold-button';
      if (name === 'touchSensitivity') options.touchSensitivity = Math.max(100, Math.min(300, Math.round(Number(value) || 100)));
      if (name === 'touchControlOpacity') options.touchControlOpacity = Math.max(20, Math.min(100, Math.round(Number(value) / 5) * 5 || 20));
      touched.add(name);if(name === 'touchMovementMode' && options.touchFocusMode !== state.options.touchFocusMode)touched.add('touchFocusMode');
      publish({...state, options}, 'option'); commitPreferences();
    },
    previewSensitivity(value: number) {
      const state = required();
      touched.add('touchSensitivity');
      publish({...state, options: {...state.options, touchSensitivity: Math.max(100, Math.min(300, Math.round(value) || 100))}}, 'preview');
    },
    commitPreferences: () => commitPreferences(),
    setMusic(value: MusicMode) {
      const state = required(), availability = resolveMusicAvailability(state.context.musicAvailability);
      if (editorScope !== 'global' && (value === 'midi' && !availability.midi || value.startsWith('ogg-') && !availability.ogg)) return;
      musicTouched = true;publish({...state, music: value, musicPreference: value, musicPreferenceExplicit: true}, 'music'); commitPreferences('music');
    },
    setLanguage(value: string) {
      const state = required();
      if (!state.context.languages.some(entry => entry.id === value)) return;
      languageTouched = true;publish({...state, language: value}, 'language'); commitPreferences('language');
    },
    setGameVersion(value: GameVersion) {
      const state = required();
      if (!GAME_VERSIONS.includes(value) || state.gameVersion === value) return;
      // Persist before publishing: metadata/import readers see the same selection.
      persistGameVersion(storage, state.gameId, value);
      publish({...state, gameVersion: value}, 'game-version');
    },
    setDisclosure(name: keyof SettingsDisclosureState, open: boolean) {
      const state = required();
      if (state.disclosure[name] === open) return;
      const disclosure = {...state.disclosure, [name]: open};
      disclosures[state.multiplayer ? 'multiplayer' : 'singleplayer'] = disclosure;
      publish({...state, disclosure}, 'presentation');
    },
    resetToGlobal(name: keyof GameOptions | 'music') {
      const state = required(), baseline = state.globalBaseline;
      if (editorScope !== 'game' || !baseline) return;
      const reason = name === 'music' ? 'music' : 'option';
      scopedStore.clear('game',state.preferenceId,name === 'music' ? {music:true} : {options:[name]});
      if (name === 'music') musicTouched = false; else touched.delete(name);
      // The legacy per-game record sits below global values, so it must stop
      // carrying the old choice too or the game would keep using it.
      const next = name === 'music'
        ? {...state, musicPreference:baseline.musicPreference, musicPreferenceExplicit:baseline.musicPreferenceExplicit}
        : {...state, options:{...state.options,[name]:baseline.options[name]}};
      persistStoredGamePreferences({storage, preferenceId: state.preferenceId, preferences: {...next, options: {...next.options}}, language: next.language});
      read(state.context, reason);
      onPreferencesCommitted?.(reason);
    },
    setShareSingleplayerSettings(enabled: boolean) {
      const state = required();
      if (!state.multiplayer || state.shareSingleplayerSettings === enabled) return;
      multiplayerPreferences.persistShareSingleplayerSettings(state.context.productId, enabled);
      read(state.context, 'sharing', enabled);
      onPreferencesCommitted?.('sharing');
    },
  });
}
