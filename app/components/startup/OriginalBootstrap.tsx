import backgroundUrl from '../../../public/assets/launcher-background.webp?url';
import touhouFontUrl from '../../../public/assets/fonts/touhou98.woff2?url';
import yatraFontUrl from '../../../public/assets/fonts/yatra-one-latin.woff2?url';
import mediumFontUrl from '../../../public/assets/fonts/chill-round-gothic-site-medium-critical.woff2?url';
import boldFontUrl from '../../../public/assets/fonts/chill-round-gothic-site-bold-critical.woff2?url';
import {originalBootstrap as original} from 'virtual:original-bootstrap';
import {useSyncExternalStore} from 'react';
import {useLocation} from 'react-router';
import {isUiLocale, type UiLocale} from '../../../src/launcher/i18n.mts';
import {translate} from '../../i18n';

function subscribeLocale(listener: () => void) {
  window.addEventListener('eagler-ui-locale-change', listener);
  return () => window.removeEventListener('eagler-ui-locale-change', listener);
}

// ES5 dispatch only: the original compatibility gate must precede the modern
// bundle. Static SPA fallback HTML serves both original document contexts.
const dispatch = `(function(){var lobby=/\\/(?:lobby|lobby\\.html)\\/?$/.test(location.pathname);document.documentElement.setAttribute('data-original-entry',lobby?'lobby':'library');if(lobby){document.documentElement.setAttribute('data-lobby-boot','loading');}else{${original.library.compatibility}\n${original.library.script}\n}}());`;
const tail = `(function(){var module=document.querySelector('script[type="module"][data-eagler-entry]');if(module)module.id='lobbyModule';if(document.documentElement.getAttribute('data-original-entry')==='lobby'){${original.lobby.script}\n}}());`;
/** Source-extracted original pre-module safety gate and preload presentation. */
export function OriginalBootstrapHead() {
  const {pathname} = useLocation();
  const publishedLocale: UiLocale = /\/en\.html\/?$/.test(pathname) ? 'en' : 'zh-CN';
  const locale = useSyncExternalStore(subscribeLocale, () => {
    const value = document.documentElement.dataset.uiLocale;
    return isUiLocale(value) ? value : publishedLocale;
  }, () => publishedLocale);
  const lobby = /\/(?:lobby|lobby\.html)\/?$/.test(pathname);
  const title = lobby ? `${translate(locale, 'lobby.title')} ~ EAGLER TOUHOU` : translate(locale, 'site.documentTitle');
  const description = translate(locale, 'site.description');
  return <>
    <script dangerouslySetInnerHTML={{__html: dispatch}}/>
    <style dangerouslySetInnerHTML={{__html: original.library.css + '\n' + original.lobby.css +
      '\nhtml[data-original-entry="lobby"] #eaglerPreload,html:not([data-original-entry="lobby"]) #lobbyPreload{display:none}'}}/>
    <style id="launcherNavigationTransition">{'@view-transition{navigation:auto}'}</style>
    <title data-i18n={lobby ? undefined : 'site.documentTitle'}>{title}</title>
    <meta name="theme-color" content={lobby ? '#111210' : '#10100f'}/>
    {lobby ? <meta name="robots" content="noindex"/> : <>
      <meta name="color-scheme" content="dark"/>
      <meta name="description" content={description} data-i18n-content="site.description"/>
      <meta property="og:type" content="website"/>
      <meta property="og:site_name" content="EAGLER TOUHOU"/>
      <meta property="og:title" content={title} data-i18n-content="site.documentTitle"/>
      <meta property="og:description" content={description} data-i18n-content="site.description"/>
      <meta name="mobile-web-app-capable" content="yes"/>
      <meta name="apple-mobile-web-app-capable" content="yes"/>
      <meta name="apple-mobile-web-app-title" content="EAGLER TOUHOU"/>
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
      <link rel="manifest" href="site.webmanifest"/>
      <link rel="apple-touch-icon" sizes="180x180" href="assets/pwa/apple-touch-icon.png"/>
    </>}
    <link rel="icon" href={lobby ? 'th06.ico' : 'assets/th06.ico'} type={lobby ? undefined : 'image/x-icon'}/>
    <link rel="preload" href={backgroundUrl} as="image" fetchPriority="high"/>
    <link rel="preload" href={touhouFontUrl} as="font" type="font/woff2" crossOrigin="anonymous"/>
    <link rel="preload" href={yatraFontUrl} as="font" type="font/woff2" crossOrigin="anonymous"/>
    <link rel="preload" href={mediumFontUrl} as="font" type="font/woff2" crossOrigin="anonymous"/>
    <link rel="preload" href={boldFontUrl} as="font" type="font/woff2" crossOrigin="anonymous"/>
  </>;
}
export function OriginalPreloads() {
  // Trusted original markup only. The original boot owner removes its preload;
  // React does not own or reconcile descendants inside this static carrier.
  return <div style={{display: 'contents'}} dangerouslySetInnerHTML={{__html: original.library.preload + original.lobby.preload}}/>;
}
export function OriginalModuleRequestMark() {
  return <script dangerouslySetInnerHTML={{__html: 'window.__eaglerBoot && window.__eaglerBoot.mark("app-module-request");'}}/>;
}
export function OriginalBootstrapTail() {return <script dangerouslySetInnerHTML={{__html: tail}}/>;}
