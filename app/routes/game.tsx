import {useLayoutEffect} from 'react';
import {Link, NavLink, Outlet, useParams, useLocation} from 'react-router';
import {useAnimate} from 'motion/react';
import {productManagementSearch} from '../runtime/route-session.mts';
import {useLocale} from '../components/LocaleProvider';
import {useMotionPreference} from '../components/MotionPreferenceProvider';
import {useLibraryPanelNavigation} from '../components/LibraryPanelNavigation';
import {HelpLink} from '../components/HelpPanel';
import {isMultiplayerProductId, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';

/** The persistent parent owns the cover/sheet. This one nested outlet owns the
 * management view; changing it never creates a second service or Runtime. */
export default function Game() {
  const {productId = ''} = useParams(), {t} = useLocale();
  const location = useLocation(), panel = useLibraryPanelNavigation(), {reducedMotion} = useMotionPreference();
  const [content, animate] = useAnimate<HTMLDivElement>();
  useLayoutEffect(() => {
    if (!content.current) return;
    const animation = animate(content.current, {opacity: [reducedMotion ? 1 : .45, 1], x: [reducedMotion ? 0 : 12, 0]}, {duration: reducedMotion ? 0 : .22, ease: [.22, .8, .22, 1]});
    return () => animation.stop();
  }, [location.pathname, reducedMotion, animate, content]);
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return <section><h1>{t('react.routes.gameUnavailable')}</h1><Link to="/">{t('library.back')}</Link></section>;
  const home = `/play/${productId}`;
  if (isMultiplayerProductId(productId) && location.pathname.replace(/\/$/, '') === home && new URLSearchParams(location.search).has('mpRoom')) return <Outlet/>;
  return <div data-product-management={productId}>
    <nav aria-label={t('react.routes.management')} className="library-panel-navigation">
      {[[t('settings.title'), home], [t('react.resources.title'), `${home}/resources`], ['Replay', `${home}/replays`], [t('nav.oldSitePart1'), `${home}/saves`]].map(([label,to]) => {
        const target = {pathname: to, search: productManagementSearch(location.search), hash: location.hash};
        return <NavLink key={to} to={target} preventScrollReset end onClick={event => {
          if (!panel || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          event.preventDefault(); panel.open(target);
        }} className={({isActive}) => `library-panel-tab ${isActive ? 'is-current' : ''}`}>{label}</NavLink>;
      })}
    </nav>
    <div ref={content} data-product-management-view=""><Outlet/></div>
    <HelpLink className="mb-5 inline-flex min-h-11 items-center rounded-full border border-line bg-ink px-4 py-2 text-sm focus-visible:outline-2">{t('help.controlsTitle')}</HelpLink>
  </div>;
}
