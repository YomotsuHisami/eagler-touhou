import {createContext, useContext, useMemo, type ReactNode} from 'react';
import {UI_MESSAGES, type UiLocale, type UiMessageKey, type UiMessageParams} from '../src/launcher/i18n.mts';

export type Translate = (key: UiMessageKey, params?: UiMessageParams) => string;

/** The existing catalog is the copy owner; React never runs its DOM/history mutator. */
export function translate(locale: UiLocale, key: UiMessageKey, params: UiMessageParams = {}): string {
  return UI_MESSAGES[locale][key].replace(/\{([A-Za-z0-9_]+)\}/g,
    (_, name: string) => String(params[name] ?? `{${name}}`));
}

const LocaleContext = createContext<{locale: UiLocale; t: Translate}>({
  locale: 'zh-CN', t: (key, params) => translate('zh-CN', key, params),
});

export function LocaleProvider({locale, children}: {locale: UiLocale; children: ReactNode}) {
  const value = useMemo(() => ({locale, t: (key: UiMessageKey, params?: UiMessageParams) => translate(locale, key, params)}), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {return useContext(LocaleContext);}
