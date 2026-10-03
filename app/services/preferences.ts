import {
  applySharedTouchPreferences, loadGlobalGamePreferences, loadOrInitializeSharedTouchPreferences,
  loadStoredGamePreferences, loadStoredLanguagePreference, persistGlobalGamePreferences,
  persistSharedTouchPreferences, persistStoredGamePreferences, globalLanguagePreferenceStorageKey,
  type GameOptions, type MusicMode, type GamePreferenceStorage,
} from '../../src/launcher/game-preferences.mts';
import {gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';

export interface Preferences { options: GameOptions; music: MusicMode; musicPreference: MusicMode; musicPreferenceExplicit: boolean; language: string }
/** The existing keys and explicit product identities remain authoritative. */
export function createPreferenceStore(storage: GamePreferenceStorage | null) {
  const cache = new Map<ProductId, Preferences>();
  const listeners = new Set<() => void>();
  const read = (id: ProductId): Preferences => {
    const known = cache.get(id); if (known) return known;
    const game = gameIdForProduct(id);
    const old = loadStoredGamePreferences({storage, preferenceId:id,
      fallbackPreferenceId:isMultiplayerProductId(id)?game:null,
      context:{uiLocale:'zh-CN', thpracAvailable:true, webAudioAvailable:true}});
    const migrated = {...old, options:applySharedTouchPreferences(old.options,loadOrInitializeSharedTouchPreferences(storage,old.options))};
    const value = loadGlobalGamePreferences(storage,migrated,'zh-CN');
    let language: string | null = null;
    try {language=storage?.getItem(globalLanguagePreferenceStorageKey) ?? null;} catch { /* restrictive browser storage */ }
    language ||= loadStoredLanguagePreference({storage,preferenceId:id,fallbackPreferenceId:isMultiplayerProductId(id)?game:null}) || 'ja';
    const snapshot = {...value,options:{...value.options},language}; cache.set(id,snapshot); return snapshot;
  };
  return {
    read,
    subscribe(listener:()=>void) {listeners.add(listener); return ()=>{listeners.delete(listener);};},
    invalidate() {cache.clear(); listeners.forEach(listener=>listener());},
    update(id:ProductId, change:Partial<Preferences>) {
      const before=read(id); const after={...before,...change,options:change.options?{...change.options}:before.options};
      persistSharedTouchPreferences(storage,after.options);
      persistGlobalGamePreferences(storage,after);
      persistStoredGamePreferences({storage,preferenceId:id,preferences:after,language:after.language});
      if(change.language!==undefined) {try {storage?.setItem(globalLanguagePreferenceStorageKey,after.language);} catch {}}
      cache.clear(); cache.set(id,after); listeners.forEach(listener=>listener());
    },
  };
}
export type PreferenceStore=ReturnType<typeof createPreferenceStore>;
