/** Plain locale ownership. Existing catalog data remains authoritative; none of
 * the legacy DOM translation, global event or history helpers are executed. */
import {UI_LOCALE_STORAGE_KEY, UI_LOCALES, isUiLocale,
  type UiLocale, type UiMessageKey, type UiMessageParams} from '../../src/launcher/i18n.mts';
export {UI_LOCALES, UI_LOCALE_STORAGE_KEY, type UiLocale, type UiMessageKey, type UiMessageParams};
export interface LocaleStorage {getItem(key: string): string | null; setItem(key: string, value: string): void}
export interface LocaleSnapshot {
  readonly locale: UiLocale;
  readonly preferredLocale: UiLocale | null;
  readonly persistence: 'unknown' | 'local' | 'session';
}
export {routeUiLocale} from './locale-route';
export {formatUiMessage} from './locale-message';
import {formatUiMessage} from './locale-message';
export function createLocaleStore({initialLocale = 'zh-CN', storage = null}: {
  initialLocale?: UiLocale; storage?: LocaleStorage | null;
} = {}) {
  if (!isUiLocale(initialLocale)) throw new Error('Unsupported initial UI locale');
  let snapshot: LocaleSnapshot = Object.freeze({locale: initialLocale, preferredLocale: null, persistence: 'unknown'});
  let currentStorage = storage;
  const listeners = new Set<() => void>();
  function update(patch: Partial<LocaleSnapshot>) {
    const next = {...snapshot, ...patch};
    if (next.locale === snapshot.locale && next.preferredLocale === snapshot.preferredLocale && next.persistence === snapshot.persistence) return;
    snapshot = Object.freeze(next); for (const listener of [...listeners]) listener();
  }
  function hydrate(nextStorage = currentStorage) {
    currentStorage = nextStorage;
    try {
      const value = currentStorage?.getItem(UI_LOCALE_STORAGE_KEY);
      // A saved preference cannot override the published/explicit route locale.
      update({preferredLocale: isUiLocale(value) ? value : null, persistence: currentStorage ? 'local' : 'session'});
    } catch {update({persistence: 'session'});}
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    hydrate,
    setLocale(locale: UiLocale, {persist = true}: {persist?: boolean} = {}) {
      if (!isUiLocale(locale)) throw new Error('Unsupported UI locale');
      let persistence = snapshot.persistence;
      if (persist) {
        try {currentStorage?.setItem(UI_LOCALE_STORAGE_KEY, locale); persistence = currentStorage ? 'local' : 'session';}
        catch {persistence = 'session';}
      }
      update({locale, persistence, ...(persist ? {preferredLocale: locale} : {})});
    },
    format: (key: UiMessageKey, params?: UiMessageParams) => formatUiMessage(snapshot.locale, key, params),
  });
}
export type LocaleStore = ReturnType<typeof createLocaleStore>;
