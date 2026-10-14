import {DEFAULT_GAME_OPTIONS, isMusicMode, isTouchFocusMode, isTouchMovementMode, type GameOptions, type GamePreferenceStorage, type MusicMode} from '../../src/launcher/game-preferences.mts';

export type SettingsScope = 'global' | 'game';
export const globalSettingsStorageKey = 'eagler-touhou-global-settings-v1';
export const localSettingsStorageKey = (product: string) => `eagler-touhou-local-settings-v1-${product}`;
export interface SettingsPatch {options?: Partial<GameOptions>; music?: MusicMode; language?: string}

/** Sparse defaults and explicit game overrides; legacy complete records stay intact. */
export function createScopedSettingsStore(storage: GamePreferenceStorage | null) {
  const unsaved = new Map<string, SettingsPatch>();
  const key = (scope: SettingsScope, product: string) => scope === 'global' ? globalSettingsStorageKey : localSettingsStorageKey(product);
  function read(scope: SettingsScope, product: string): SettingsPatch {
    const id = key(scope,product), pending = unsaved.get(id);
    if (pending) return pending;
    let raw: SettingsPatch | null = null;
    try {raw = JSON.parse(storage?.getItem(id) ?? 'null');} catch {}
    if (!raw || typeof raw !== 'object') return {};
    const options: Partial<GameOptions> = {};
    for (const name of Object.keys(DEFAULT_GAME_OPTIONS) as (keyof GameOptions)[]) {
      const value = raw.options?.[name];
      if (typeof value !== typeof DEFAULT_GAME_OPTIONS[name]) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      if (name === 'touchMovementMode' && !isTouchMovementMode(String(value)) || name === 'touchFocusMode' && !isTouchFocusMode(String(value))) continue;
      Object.assign(options,{[name]:value});
    }
    return {options, ...(typeof raw.music === 'string' && isMusicMode(raw.music) ? {music:raw.music} : {}), ...(typeof raw.language === 'string' ? {language:raw.language} : {})};
  }
  function save(id: string, next: SettingsPatch) {
    unsaved.set(id,next);
    try {if(storage){storage.setItem(id,JSON.stringify(next));unsaved.delete(id);}} catch {}
  }
  return {
    read,
    write(scope: SettingsScope, product: string, patch: SettingsPatch) {
      const previous = read(scope,product);
      save(key(scope,product),{...previous,...patch,options:{...previous.options,...patch.options}});
    },
    clear(scope: SettingsScope, product: string, fields: {options?: readonly (keyof GameOptions)[]; music?: boolean}) {
      const previous = read(scope,product), options = {...previous.options};
      for (const name of fields.options ?? []) delete options[name];
      const next: SettingsPatch = {...previous, options};
      if (fields.music) delete next.music;
      save(key(scope,product),next);
    },
  };
}
