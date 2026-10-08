import {UI_MESSAGES} from '../../src/launcher/i18n.mts';
import {routeUiLocale} from './locale-route';

/** Route-owned document identity, including the pre-hydration static shell.
 * Public origin/canonical links remain the publication pipeline's authority. */
export function launcherDocumentMetadata(pathname = '/', search = '') {
  const locale = routeUiLocale(pathname, search) ?? 'zh-CN';
  const title = UI_MESSAGES[locale]['site.documentTitle'];
  const description = UI_MESSAGES[locale]['site.description'];
  return [
    {title}, {name: 'description', content: description},
    {property: 'og:type', content: 'website'},
    {property: 'og:site_name', content: 'EAGLER TOUHOU'},
    {property: 'og:title', content: title},
    {property: 'og:description', content: description},
    {name: 'color-scheme', content: 'dark', id: 'colorSchemeMeta'},
    {name: 'theme-color', content: '#10100f', id: 'themeColorMeta'},
    {name: 'mobile-web-app-capable', content: 'yes'},
    {name: 'apple-mobile-web-app-capable', content: 'yes'},
  ];
}
