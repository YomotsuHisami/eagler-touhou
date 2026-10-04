import {isUiLocale, type UiLocale} from '../../src/launcher/i18n.mts';

/** Pure route identity shared by metadata prerender and browser locale state. */
export function routeUiLocale(pathname: string, search: string): UiLocale | null {
  if (/(?:^|\/)en\.html$/.test(pathname)) return 'en';
  const requested = new URLSearchParams(search).get('uiLocale');
  return isUiLocale(requested) ? requested : null;
}
