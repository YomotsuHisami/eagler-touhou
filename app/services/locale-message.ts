import {UI_MESSAGES, type UiLocale, type UiMessageKey, type UiMessageParams} from '../../src/launcher/i18n.mts';

/** Pure formatting also used by Framework's server-side error boundary. */
export function formatUiMessage(locale: UiLocale, key: UiMessageKey, params: UiMessageParams = {}): string {
  const value = UI_MESSAGES[locale][key] ?? UI_MESSAGES['zh-CN'][key];
  return String(value ?? key).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
