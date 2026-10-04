import {
  PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct,
  productEnabledForBuild, productFeatureAvailable, type GameId, type HostRuntimeFeatures, type ProductId,
} from '../../src/contracts/product-catalog.mts';
import {
  DEFAULT_GAME_OPTIONS, applySharedTouchPreferences, languagePreferenceStorageKey,
  loadOrInitializeSharedTouchPreferences, loadStoredGamePreferences, loadStoredLanguagePreference,
  normalizeStoredGamePreferences, persistSharedTouchPreferences, persistStoredGamePreferences,
  type GameOptions, type GamePreferenceStorage, type MusicMode, type NormalizedGamePreferences,
} from '../../src/launcher/game-preferences.mts';
import {createMultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import {resolvePreferredGameLanguage, type LanguageCatalogEntry} from '../../src/launcher/language-catalog.mts';
import {
  resolveEffectiveMusicMode, resolveMusicAvailability, type MusicAvailabilityInput,
} from '../../src/launcher/music-availability.mts';

/** Supply resolved metadata from the existing Host/Package owners, never guessed UI options. */
export interface PreferencesContext {
  readonly uiLocale?: string;
  /** Undefined means Host metadata is unresolved. A known legacy Host may supply {}. */
  readonly hostFeatures?: HostRuntimeFeatures;
  readonly languageCatalog?: readonly LanguageCatalogEntry[];
  readonly musicAvailability?: MusicAvailabilityInput;
}
export type PreferencesContextSource = (game: GameId) => PreferencesContext;
export interface PreferencesSnapshot {
  readonly productId: ProductId;
  readonly preferenceId: ProductId;
  readonly shareSingleplayerSettings: boolean;
  readonly options: Readonly<GameOptions>;
  readonly features: Readonly<{thprac: boolean; focusHitbox: boolean}>;
  readonly language: string | null;
  readonly languages: readonly Readonly<{id: string; title: string}>[];
  readonly music: MusicMode | null;
  readonly musicPreference: MusicMode;
  readonly musicModes: readonly MusicMode[];
}
export interface PreferencesStore {
  /** Load after mount; snapshot reads never perform storage I/O. */
  loadProduct(product: ProductId): void;
  getSnapshot(product: ProductId): PreferencesSnapshot | null;
  subscribe(listener: () => void): () => void;
  setOption<K extends keyof GameOptions>(product: ProductId, name: K, value: GameOptions[K]): void;
  setShareSingleplayerSettings(product: ProductId, enabled: boolean): void;
  setLanguage(product: ProductId, language: string): void;
  setMusic(product: ProductId, music: MusicMode): void;
  setContext(context: PreferencesContextSource): void;
}

interface ProductState {
  readonly snapshot: PreferencesSnapshot;
  readonly preferences: NormalizedGamePreferences;
  readonly storedLanguage: string | null;
}
const emptyContext: PreferencesContextSource = () => ({});

/**
 * One owner per mounted launcher, shared by every form. No DOM, runtime, global
 * storage access, fetch, or background listeners. Canonical owners retain all
 * keys, migration, serialization, MP policy and option normalization.
 */
export function createPreferencesStore({storage = null, context = emptyContext}: {
  storage?: GamePreferenceStorage | null;
  context?: PreferencesContextSource;
} = {}): PreferencesStore {
  let contextSource = context;
  // Write-through memory preserves same-session changes when storage is denied
  // or full. Reads are owner-local so sibling forms cannot see partial writes.
  const values = new Map<string, string | null>();
  const sessionStorage: GamePreferenceStorage = {
    getItem(key) {
      if (!values.has(key)) {
        let value: string | null = null;
        try { value = storage?.getItem(key) ?? null; } catch { /* Memory-only session. */ }
        values.set(key, value);
      }
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
      try { storage?.setItem(key, value); } catch { /* Memory-only session. */ }
    },
  };
  const multiplayer = createMultiplayerPreferenceStore({storage: sessionStorage});
  const states = new Map<ProductId, ProductState>();
  const listeners = new Set<() => void>();

  function read(productId: ProductId): ProductState {
    if (!productEnabledForBuild(productId, false)) throw new Error('Product settings are unavailable');
    const game = gameIdForProduct(productId);
    const multiplayerProduct = isMultiplayerProductId(productId);
    const {shareSingleplayerSettings} = multiplayer.load({
      product: productId, multiplayer: multiplayerProduct,
      maxLoadout: multiplayerConfigForProduct(productId)?.loadouts.length ?? 0,
    });
    const preferenceId = multiplayerProduct && !shareSingleplayerSettings ? productId : game;
    const metadata = contextSource(game);
    // Normalize saved intent against the catalog ceiling. View-only Host/MP
    // gates below must not erase SP practice or music choices on an FPS edit.
    const restored = loadStoredGamePreferences({
      storage: sessionStorage, preferenceId,
      fallbackPreferenceId: isMultiplayerProductId(preferenceId) ? game : null,
      context: {uiLocale: metadata.uiLocale, thpracAvailable: productFeatureAvailable(game, 'thprac'), webAudioAvailable: true},
    });
    const preferences = {...restored, options: applySharedTouchPreferences(restored.options,
      loadOrInitializeSharedTouchPreferences(sessionStorage, restored.options))};
    const features = Object.freeze({
      thprac: !multiplayerProduct && metadata.hostFeatures !== undefined && productFeatureAvailable(game, 'thprac', metadata.hostFeatures),
      focusHitbox: metadata.hostFeatures !== undefined && productFeatureAvailable(game, 'focusHitbox', metadata.hostFeatures),
    });
    const options = Object.freeze({...preferences.options,
      thpracEnabled: features.thprac && preferences.options.thpracEnabled,
      focusHitboxEnabled: features.focusHitbox && preferences.options.focusHitboxEnabled,
      multiplayerLocalPlayerVisibility: multiplayerProduct && preferences.options.multiplayerLocalPlayerVisibility,
    });
    const storedLanguage = loadStoredLanguagePreference({
      storage: sessionStorage, preferenceId,
      fallbackPreferenceId: isMultiplayerProductId(preferenceId) ? game : null,
    });
    const languages = Object.freeze((metadata.languageCatalog ?? []).map(entry => Object.freeze({id: entry.id, title: entry.title || entry.id})));
    const language = languages.length ? resolvePreferredGameLanguage(languages, storedLanguage, metadata.uiLocale ?? '') : null;
    // MIDI also has a product ceiling; OGG provenance/revision stays with the
    // canonical music availability owner and the injected Package/Host data.
    const musicInput = metadata.musicAvailability && {...metadata.musicAvailability,
      midiAvailable: metadata.musicAvailability.midiAvailable && PRODUCT_GAMES[game].musicCapabilities.midi,
    };
    const availability = musicInput && resolveMusicAvailability(musicInput);
    const musicModes: MusicMode[] = availability ? [
      ...(availability.ogg ? ['ogg-stream', 'ogg-full'] as const : []),
      ...(availability.midi ? ['midi'] as const : []), 'none',
    ] : [];
    const music = musicInput ? resolveEffectiveMusicMode({...musicInput,
      requested: preferences.musicPreference, explicit: preferences.musicPreferenceExplicit,
    }) : null;
    const snapshot = Object.freeze({productId, preferenceId, shareSingleplayerSettings, options, features,
      language, languages, music, musicPreference: preferences.musicPreference, musicModes: Object.freeze(musicModes)});
    return {snapshot, preferences, storedLanguage};
  }

  function state(product: ProductId): ProductState {
    let value = states.get(product);
    if (!value) { value = read(product); states.set(product, value); }
    return value;
  }

  function publish() {
    // Complete every snapshot before notifying any form; global touch and
    // shared SP/MP consumers observe the same committed preference generation.
    for (const product of states.keys()) states.set(product, read(product));
    for (const listener of [...listeners]) listener();
  }

  function persist(current: ProductState, preferences = current.preferences, language = current.storedLanguage) {
    persistSharedTouchPreferences(sessionStorage, preferences.options);
    const languageKey = languagePreferenceStorageKey(current.snapshot.preferenceId);
    persistStoredGamePreferences({
      storage: {
        getItem: sessionStorage.getItem,
        setItem(key, value) {
          // An unresolved catalog is not permission to replace a user's saved
          // language with a fabricated default (or write an empty language).
          if (key !== languageKey || language !== null) sessionStorage.setItem(key, value);
        },
      },
      preferenceId: current.snapshot.preferenceId,
      preferences, language: language ?? '',
    });
  }

  return Object.freeze({
    loadProduct(product: ProductId) {
      if (states.has(product)) return;
      state(product);
      for (const listener of [...listeners]) listener();
    },
    getSnapshot: (product: ProductId) => states.get(product)?.snapshot ?? null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setOption<K extends keyof GameOptions>(product: ProductId, name: K, value: GameOptions[K]) {
      if (!Object.hasOwn(DEFAULT_GAME_OPTIONS, name)) return;
      const current = state(product);
      if ((name === 'thpracEnabled' && !current.snapshot.features.thprac) ||
        (name === 'focusHitboxEnabled' && !current.snapshot.features.focusHitbox) ||
        (name === 'multiplayerLocalPlayerVisibility' && !isMultiplayerProductId(product))) return;
      const preferences = normalizeStoredGamePreferences({
        music: current.preferences.musicPreference,
        musicPreferenceExplicit: current.preferences.musicPreferenceExplicit,
        options: {...current.preferences.options, [name]: value},
      }, {uiLocale: contextSource(gameIdForProduct(product)).uiLocale,
        thpracAvailable: productFeatureAvailable(gameIdForProduct(product), 'thprac'), webAudioAvailable: true});
      if (JSON.stringify(preferences.options) === JSON.stringify(current.preferences.options)) return;
      persist(current, preferences);
      publish();
    },
    setShareSingleplayerSettings(product: ProductId, enabled: boolean) {
      if (!isMultiplayerProductId(product)) return;
      const current = state(product);
      if (current.snapshot.shareSingleplayerSettings === enabled) return;
      persist(current);
      multiplayer.persistShareSingleplayerSettings(product, enabled);
      publish();
    },
    setLanguage(product: ProductId, language: string) {
      const current = state(product);
      if (!current.snapshot.languages.some(entry => entry.id === language)) return;
      persist(current, current.preferences, language);
      publish();
    },
    setMusic(product: ProductId, music: MusicMode) {
      const current = state(product);
      if (!current.snapshot.musicModes.includes(music)) return;
      persist(current, {...current.preferences, music, musicPreference: music, musicPreferenceExplicit: true});
      publish();
    },
    setContext(next: PreferencesContextSource) { contextSource = next; publish(); },
  });
}
