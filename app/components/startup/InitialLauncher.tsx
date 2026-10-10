import {useLocation} from 'react-router';
import {useRef, type ReactNode} from 'react';
import {PRODUCT_IDS, productEnabledForBuild} from '../../../src/contracts/product-catalog.mts';
import {LocaleProvider, useLocale} from '../../i18n';
import {LibrarySurface} from '../launcher/LibrarySurface';
import {LobbySurface} from '../launcher/LobbySurface';
import {LauncherMasthead} from '../launcher/LauncherMasthead';
import {SiteFooter} from '../launcher/SiteFooter';
import {createLibraryProducts} from '../launcher/products';
import {LobbyRoomTools} from '../directory/LobbyRoomTools';

const assetUrl = (path: string) => path;
const inactive = () => {};
// Main's static compiler uses the default catalog gate, before Host/query policy.
const products = createLibraryProducts(PRODUCT_IDS, assetUrl, id => `?game=${id}`)
  .map(product => ({...product, hidden: !productEnabledForBuild(product.id)}));

/** Published main chrome/cards, using the same view components as the live
 * session. No storage, network, settings owner or Runtime exists in this phase. */
export function InitialLauncher() {
  const {pathname} = useLocation();
  const lobby = /\/(?:lobby|lobby\.html)\/?$/.test(pathname);
  const locale = /\/en\.html\/?$/.test(pathname) ? 'en' : 'zh-CN';
  return <LocaleProvider locale={locale}><InitialSurface lobby={lobby}/></LocaleProvider>;
}

function InitialSurface({lobby}: {lobby: boolean}) {
  const {locale, t} = useLocale();
  const masthead = <LauncherMasthead interactive={false} variant={lobby ? 'lobby' : 'library'} assetUrl={assetUrl}
    launcherHref={locale === 'en' ? 'en.html' : './'} faqHref="faq.html" aboutHref="about.html"
    menuOpen={false} onMenuOpenChange={inactive} lessMotion={false} onToggleMotion={inactive}
    noticeEnabled diagnosticsEnabled={false} onToggleNotice={inactive} onToggleDiagnostics={inactive}
    onDonation={inactive} onFirstUse={inactive}
    languageControl={<select className="option-select ui-language-select" id="uiLanguageSelect" aria-label={t('ui.language')} data-trigger-i18n="ui.language.menu" defaultValue={locale}><option value="zh-CN">{t('ui.language.zhCN')}</option><option value="en">{t('ui.language.en')}</option></select>}/>;
  return lobby ? <LobbySurface masthead={masthead} products={[]} interactive={false} onSelect={inactive} onActivate={inactive}
    onGuide={inactive} onNetwork={inactive} roomTools={<LobbyRoomTools disabled/>} roomList={null} hasRooms={false}
    loading emptyState={null} roomCount="" roomUsersArtwork="assets/room-users.svg"/>
    : <LibrarySurface masthead={masthead} footer={<SiteFooter onDonation={inactive}/>} products={products}
      interactive={false} onSelect={inactive} onActivate={inactive} optionsOpen={false} onBack={inactive}
      lobbyHref="lobby.html" roomUsersArtwork="assets/room-users.svg"/>;
}

/** These two intentionally untranslated fallbacks are original document copy. */
export function OriginalNoscript({lobby}: {lobby: boolean}) {
  return lobby ? <noscript><style>{'#lobbyPreload{display:none}'}</style><p>联机大厅需要启用 JavaScript。<a href="./">返回启动器</a></p></noscript>
    : <noscript><p className="noscript-message">此启动器需要 JavaScript。你仍可查看<a href="faq.html">常见问题</a>和<a href="about.html">项目说明</a>。</p></noscript>;
}

/** Static class seed only. LauncherApplication owns the live lobby-page token;
 * replacing body.className on navigation would erase other services' classes. */
export function InitialDocumentBody({lobby, children}: {lobby: boolean; children: ReactNode}) {
  const initialClassName = useRef(lobby ? 'lobby-page' : undefined).current;
  return <body className={initialClassName}>{children}</body>;
}
