import {useAppShell, AppShellStatus} from './AppShellProvider';
import {LocaleSelect, useLocale} from './LocaleProvider';
import {FirstUseNoticeButton, SiteNoticeToggle} from './Notices';
import {RuntimeDiagnosticsToggle} from './RuntimeDiagnosticsToggle';
import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode} from 'react';
import {Link, useHref, useLocation} from 'react-router';
import {useLibraryPanelNavigation} from './LibraryPanelNavigation';
import {useLibraryGestures} from './LibraryGestures';
import {libraryIndexWidth} from '../services/library-gestures';
import {useMotionPreference} from './MotionPreferenceProvider';
import {motionPreferenceStore} from '../services/motion-preference.client';
import {multiplayerDirectoryAddress} from '../services/library-panel-navigation';
import {ProductArtwork} from './ProductArtwork';
import {ThemeToggle} from './ThemeToggle';
import {coverAccentForImage} from '../browser/cover-accent';
import './game-library.css';
import {
  gameIdForProduct,
  isMultiplayerProductId,
  type ProductId,
} from '../../src/contracts/product-catalog.mts';
import {DonationPanel, DonationPanelNavigationProvider, useDonationPanel} from './DonationPanel';
import roomUsersIcon from '../../public/assets/room-users.svg';

/**
 * Visual sources: main@9899dff public/index.html masthead/footer;
 * public/styles.css immersive-library rules; lib/launcher-optimization.mjs
 * generateProductCards. This sample owns presentation only. React Router owns
 * navigation; no launcher bootstrap, Host, storage, or Runtime is imported.
 */
export {currentLibraryProducts, publishedLibraryProducts} from './library-products';
export type {LibraryProduct} from './library-products';
import {currentLibraryProducts, publishedLibraryProducts, type LibraryProduct} from './library-products';

// Main's compact masthead overrides (public/styles.css:161) are essential:
// the brand and controls share one row even on a portrait phone.
const mastheadControl = 'inline-flex min-h-[34px] min-w-0 items-center justify-center rounded-lg font-bold tracking-[.08em] text-nav transition-colors hover:bg-nav-hover hover:text-nav-ink focus-visible:bg-nav-hover focus-visible:text-nav-ink motion-reduce:transition-none library:min-h-9 library:tracking-[.17em]';
const mastheadLink = `${mastheadControl} px-1 py-0.5 library:px-3 library:py-0`;
const footerLink = 'text-paper/75 transition-colors hover:text-accent focus-visible:text-accent motion-reduce:transition-none';
const repository = 'https://github.com/YomotsuHisami/eagler-touhou';

type ShelfId = 'singleplayer' | 'multiplayer' | 'directory';
interface RailSnapshot {
  selectedId?: ProductId;
  restoreFocusId?: ProductId;
  scrollLeft: number;
  railWidth: number;
  cardWidth: number;
  catalogKey: string;
  anchorId?: ProductId;
  anchorFraction: number;
}

// Ephemeral presentation state belongs to the mounted shell, not history or
// browser storage. Leaving the app (or reloading it) deliberately resets it.
const LibraryRailRestoration = createContext<Map<ShelfId, RailSnapshot> | null>(null);

function GitHubIcon() {
  return <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.13c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>;
}

export function LauncherShell({children, versionLabel}: {
  children: ReactNode;
  versionLabel?: string;
}) {
  const {t} = useLocale();
  const railSnapshots = useRef(new Map<ShelfId, RailSnapshot>());
  const donation = useDonationPanel();
  const {lessMotion} = useMotionPreference();
  const faqHref = useHref('/faq.html'), aboutHref = useHref('/about.html');
  const menu = useRef<HTMLDetailsElement>(null), menuTrigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, []);
  function menuKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape' || !menu.current?.open) return;
    event.preventDefault(); event.stopPropagation();
    menu.current.open = false;
    menuTrigger.current?.focus({preventScroll: true});
  }
  const shell = useAppShell().snapshot;
  const publication = shell?.gate;
  const migrationHref = publication?.originMigration?.mode === 'http-to-https' && new URL(publication.scope).protocol === 'https:' ? new URL('migrate.html', publication.scope).href : null;
  return <div className="launcher-shell relative isolate min-h-svh">
    <PublicationHeadLinks webApp={publication?.webApp}/>
    <div className="launcher-background pointer-events-none fixed inset-0 -z-20" aria-hidden="true"/>
    <Link to="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-paper focus:px-4 focus:py-3 focus:text-ink">{t('react.shell.skip')}</Link>

    <div className="grid min-h-svh grid-rows-[auto_1fr] gap-[22px] px-[18px] pb-5 library:gap-6 library:px-[clamp(18px,3.5vw,56px)] library:pb-8">
      <header className="relative z-10 -mx-[18px] grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-3 rounded-b-[16px] border-b border-[#848a863d] bg-[#161716b3] px-[18px] pt-[11px] pb-2 text-[10px] tracking-[.17em] shadow-masthead max-[480px]:text-[9px] library:-mx-[clamp(18px,3.5vw,56px)] library:grid-cols-[1fr_auto_1fr] library:rounded-b-masthead library:px-[clamp(18px,3.5vw,56px)] library:pt-[max(12px,env(safe-area-inset-top))] library:pb-3.5">
        <Link to="/" aria-label={t('react.shell.libraryAria')} className="relative inline-flex items-start justify-self-start pb-[8.5px] text-[7.5px] text-paper library:text-[10px]">
          <span className="font-brand leading-none">EAGLER</span>
          <span className="inline-flex min-w-[1.2em] justify-center font-brand leading-none" aria-hidden="true">☯</span>
          <span className="font-brand leading-none">TOUHOU</span>
          <BrandUpdateAge snapshot={shell} versionLabel={versionLabel}/>
        </Link>
        <nav aria-label={t('nav.siteInfo')} className="col-start-2 flex min-w-0 flex-nowrap items-center justify-end justify-self-end gap-px library:col-start-3 library:gap-2">
          <ThemeToggle className={`${mastheadControl} w-[34px] library:w-[38px]`}/>
          {migrationHref && <a href={migrationHref} className={mastheadLink}>{t('nav.oldSitePart1')}<wbr/>{t('nav.migrationPart2')}</a>}
          <button type="button" hidden={!donation.available} onClick={event => {event.currentTarget.focus({preventScroll: true}); donation.openPanel();}} className={mastheadLink}>{t('nav.donate')}</button>
          <a href={faqHref} aria-label={t('react.shell.faqAria')} className={mastheadLink}><span className="text-center leading-[1.05]">{t('nav.faqFirst')}<wbr/>{t('nav.faqSecond')}</span></a>
          <Link to={repository} target="_blank" rel="noopener noreferrer" aria-label={t('react.shell.repository')} className={`${mastheadControl} w-[38px] px-1 py-0.5 library:p-0`}><GitHubIcon/></Link>
          <details ref={menu} onKeyDown={menuKeyDown} className="group relative">
            <summary ref={menuTrigger} aria-label={t('react.shell.more')} className={`${mastheadControl} w-10 list-none px-1 py-0.5 library:p-0 [&::-webkit-details-marker]:hidden`}>
              <svg viewBox="0 0 24 24" className="size-[21px] fill-none stroke-current stroke-2 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true"><path d="m7 9 5-5 5 5M7 15l5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </summary>
            <div className="masthead-menu-panel">
              <button id="lessMotionToggle" type="button" aria-pressed={lessMotion} title={t(lessMotion ? 'nav.motionFullTitle' : 'nav.motionLessTitle')}
                onClick={motionPreferenceStore.toggle} className="masthead-menu-item"><MenuIcon path="M3 5h18v2H3zm0 6h12v2H3zm0 6h6v2H3z"/><span>{t('nav.lessMotion')}</span><i className="masthead-menu-state" aria-hidden="true"/></button>
              <SiteNoticeToggle className="masthead-menu-item"><MenuIcon path="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z"/><span>{t('notice.label')}</span><i className="masthead-menu-state" aria-hidden="true"/></SiteNoticeToggle>
              <RuntimeDiagnosticsToggle className="masthead-menu-item" testBuild={publication?.testBuild === true}/>
              <LocaleSelect className="masthead-menu-language" menu/>
              <FirstUseNoticeButton className="masthead-menu-item"><MenuIcon path="M12 21q-3.45 0-6.012-2.287T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z"/><span>{t('nav.firstUseNotice')}</span></FirstUseNoticeButton>
              <a href={aboutHref} className="masthead-menu-item"><MenuIcon path="M9.175 10.825Q8 9.65 8 8t1.175-2.825T12 4t2.825 1.175T16 8t-1.175 2.825T12 12t-2.825-1.175M4 20v-2.8q0-.85.438-1.562T5.6 14.55q1.55-.775 3.15-1.162T12 13t3.25.388t3.15 1.162q.725.375 1.163 1.088T20 17.2V20z"/><span>{t('nav.about')}</span></a>
            </div>
          </details>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="min-w-0 content-start focus:outline-none"><DonationPanelNavigationProvider panel={donation}><LibraryRailRestoration.Provider value={railSnapshots.current}>{children}</LibraryRailRestoration.Provider></DonationPanelNavigationProvider></main>
    </div>

    <DonationPanel panel={donation}/>
    <AppShellStatus/>
    <footer className="relative grid min-w-0 justify-items-end px-[clamp(18px,3.5vw,56px)] pt-3 pb-[calc(28px+env(safe-area-inset-bottom))] text-right text-[8px] leading-[1.45] font-medium tracking-[.025em] text-nav/65">
      <div className="footer-divider mb-[7px] h-px w-[min(360px,45vw)] portrait:w-[min(280px,78vw)]" aria-hidden="true"/>
      <div className="grid gap-1.5">
        <p>{t('react.shell.creditBefore')} <Link className={footerLink} to="https://b23.tv/x3IIf0k" target="_blank" rel="noopener noreferrer">Ritosa</Link>{t('react.shell.creditSeparator')}<Link className={footerLink} to="https://github.com/Goan114" target="_blank" rel="noopener noreferrer">Goan114</Link>{t('react.shell.creditSeparator')}<Link className={footerLink} to="https://b23.tv/kmhLOQb" target="_blank" rel="noopener noreferrer">Grass1337</Link>{t('react.shell.creditSeparator')}<Link className={footerLink} to="https://github.com/Patchouli-CN" target="_blank" rel="noopener noreferrer">Patchouli-CN</Link>{t('react.shell.creditSeparator')}<Link className={footerLink} to="https://b23.tv/WOQhahY" target="_blank" rel="noopener noreferrer">SteinsGateON</Link> {t('react.shell.creditAfter')}</p>
        <p>{t('react.shell.license')}<Link className={footerLink} to={repository} target="_blank" rel="noopener noreferrer">{t('react.shell.github')}</Link><span className="mx-2 text-nav/30" aria-hidden="true">/</span><Link className={footerLink} to="https://qm.qq.com/q/eeUrxIltug" target="_blank" rel="noopener noreferrer">{t('react.shell.qq')}</Link><span className="mx-2 text-nav/30" aria-hidden="true">/</span><button type="button" hidden={!donation.available} className={footerLink} onClick={event => {event.currentTarget.focus({preventScroll: true}); donation.openPanel();}}>{t('react.shell.donateHosting')}</button></p>
        <p><Link className={footerLink} to="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer"><span lang="zh-CN">赣ICP备2025074288号-1</span></Link></p>
      </div>
    </footer>
  </div>;
}

export function BrandUpdateAge({snapshot, versionLabel}: {
  snapshot?: Pick<import('../services/app-shell.client').UiAppShellSnapshot, 'gate' | 'appliedUpdateAt' | 'appliedUpdateAge'> | null;
  versionLabel?: string;
}) {
  const {t} = useLocale();
  const publication = snapshot?.gate, shell = snapshot;
  return <time id="brandUpdateAge" dateTime={publication && shell?.appliedUpdateAt != null ? new Date(shell.appliedUpdateAt).toISOString() : undefined} className="absolute top-[calc(100%_-_8.5px)] left-0 mt-0.5 whitespace-nowrap text-[6.5px] leading-none tracking-[.04em] text-nav/55">{publication ? shell?.appliedUpdateAge != null ? t('brand.updatedAgo', {age: shell.appliedUpdateAge}) : t('brand.neverUpdated') : versionLabel ?? t('brand.neverUpdated')}</time>;
}

function GameShelf({products, multiplayer, routeActive, directory = false, selectedProduct, onSelectionChange, onActivate}: {
  products: readonly LibraryProduct[]; multiplayer: boolean; routeActive: boolean; directory?: boolean;
  selectedProduct?: ProductId; onSelectionChange?(id: ProductId): void; onActivate?(id: ProductId): void;
}) {
  const {t} = useLocale();
  const panel = useLibraryPanelNavigation(), location = useLocation();
  const shelfId: ShelfId = directory ? 'directory' : multiplayer ? 'multiplayer' : 'singleplayer';
  const localSnapshots = useRef(new Map<ShelfId, RailSnapshot>());
  const snapshots = useContext(LibraryRailRestoration) ?? localSnapshots.current;
  const [selectedId, setSelectedId] = useState<ProductId | undefined>(() => selectedProduct ?? snapshots.get(shelfId)?.selectedId ?? products[0]?.id);
  const shelf = useRef<HTMLElement>(null);
  const minimap = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<ProductId, HTMLAnchorElement>());
  const dock = useRef<HTMLDivElement>(null), toggles = useRef(new Map<ProductId, HTMLButtonElement>());
  const selected = products.some(product => product.id === selectedId) ? selectedId : products[0]?.id;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const catalogKey = products.map(product => product.id).join('|');
  const catalogRef = useRef(catalogKey);
  catalogRef.current = catalogKey;
  const firstMount = useRef(true);
  const heading = multiplayer ? t('library.multiplayer') : t('library.singleplayer');
  const {gestures, state: gestureState, select: selectProduct} = useLibraryGestures({rail, dock, cards, toggles, selected: selectedRef, remember: rememberSelection, routeActive});
  useLayoutEffect(() => {
    if (directory && selectedProduct && products.some(product => product.id === selectedProduct) && (firstMount.current || selectedRef.current !== selectedProduct)) selectProduct(selectedProduct, false, true);
  }, [directory, selectedProduct, catalogKey]);
  const {reducedMotion} = useMotionPreference();
  const minimapStep = useRef(46), minimapSettleTimer = useRef<number | null>(null);
  const minimapGestureActive = useRef(gestureState.scrubbing);
  minimapGestureActive.current = gestureState.scrubbing;

  function clearMinimapSettleTimer() {
    if (minimapSettleTimer.current !== null) window.clearTimeout(minimapSettleTimer.current);
    minimapSettleTimer.current = null;
  }

  function fitMinimap() {
    const root = minimap.current, viewport = shelf.current, owner = dock.current;
    if (!root || !viewport || !owner) return;
    const available = [...toggles.current.values()].filter(button => !button.hidden);
    const target = available[0]?.offsetWidth || 44;
    const style = getComputedStyle(owner);
    const gap = parseFloat(style.columnGap) || 0, padding = parseFloat(style.paddingLeft) || 0;
    minimapStep.current = target + gap || 46;
    root.style.width = `${libraryIndexWidth(available.length, viewport.clientWidth, target, gap, padding)}px`;
  }

  function snapMinimap() {
    const owner = dock.current;
    if (minimapGestureActive.current || !owner?.getClientRects().length) return;
    const step = minimapStep.current || 46;
    const maximum = Math.max(0, owner.scrollWidth - owner.clientWidth);
    const left = Math.max(0, Math.min(maximum, Math.round(owner.scrollLeft / step) * step));
    if (Math.abs(left - owner.scrollLeft) > .5) owner.scrollTo({left, behavior: 'instant'});
  }

  function updateMinimapEdges() {
    const owner = dock.current;
    if (!owner) return;
    owner.classList.toggle('can-scroll-left', owner.scrollLeft > 1);
    owner.classList.toggle('can-scroll-right', owner.scrollLeft + owner.clientWidth < owner.scrollWidth - 1);
  }

  function revealMinimap(id: ProductId, instant = false) {
    const owner = dock.current, button = toggles.current.get(id);
    if (!owner || !button) return;
    const bounds = owner.getBoundingClientRect(), target = button.getBoundingClientRect();
    const delta = target.left < bounds.left + 18 ? target.left - bounds.left - 18
      : target.right > bounds.right - 18 ? target.right - bounds.right + 18 : 0;
    if (delta) {
      const destination = owner.scrollLeft + delta, step = minimapStep.current || 46;
      const left = delta > 0 ? Math.ceil(destination / step) * step : Math.floor(destination / step) * step;
      owner.scrollTo({left, behavior: instant || reducedMotion ? 'instant' : 'smooth'});
    }
  }

  useLayoutEffect(() => {
    if (minimapGestureActive.current) clearMinimapSettleTimer();
  }, [gestureState.holding, gestureState.scrubbing]);

  useLayoutEffect(() => {
    const owner = dock.current;
    if (!owner) return;
    const update = () => {
      fitMinimap(); updateMinimapEdges();
      if (selectedRef.current) revealMinimap(selectedRef.current, true);
      snapMinimap();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(owner);
    return () => {observer.disconnect(); clearMinimapSettleTimer();};
  }, [products.length]);

  function onMinimapScroll() {
    updateMinimapEdges();
    clearMinimapSettleTimer();
    if (!minimapGestureActive.current) {
      minimapSettleTimer.current = window.setTimeout(() => {
        minimapSettleTimer.current = null;
        snapMinimap();
      }, 120);
    }
  }

  function savePosition() {
    const owner = rail.current;
    // Ref cleanup may run after a route has detached the DOM. In that case
    // keep the last real scroll/click snapshot rather than writing zeroes.
    if (!owner?.isConnected || !owner.clientWidth) return;
    const ownerLeft = owner.getBoundingClientRect().left;
    const anchor = products.find(product => {
      const card = cards.current.get(product.id);
      return card && card.getBoundingClientRect().right > ownerLeft + 6;
    }) ?? products.at(-1);
    const anchorBounds = anchor && cards.current.get(anchor.id)?.getBoundingClientRect();
    snapshots.set(shelfId, {
      selectedId: selectedRef.current,
      restoreFocusId: snapshots.get(shelfId)?.restoreFocusId,
      scrollLeft: Math.max(0, owner.scrollLeft),
      railWidth: owner.clientWidth,
      cardWidth: (products[0] && cards.current.get(products[0].id)?.getBoundingClientRect().width) || 0,
      catalogKey,
      anchorId: anchor?.id,
      anchorFraction: anchorBounds?.width ? (ownerLeft + 6 - anchorBounds.left) / anchorBounds.width : 0,
    });
  }

  useLayoutEffect(() => {
    setSelectedId(previous => products.some(product => product.id === previous) ? previous : products[0]?.id);
    const owner = rail.current;
    if (!owner) {
      snapshots.delete(shelfId);
      return;
    }
    function restorePosition(geometryOnly = false) {
      const saved = snapshots.get(shelfId);
      if (!saved || !owner || !owner.clientWidth) return;
      const firstWidth = (products[0] && cards.current.get(products[0].id)?.getBoundingClientRect().width) || 0;
      const geometryChanged = saved.catalogKey !== catalogKey || Math.abs(saved.railWidth - owner.clientWidth) > .5 || Math.abs(saved.cardWidth - firstWidth) > .5;
      if (geometryOnly && !geometryChanged) return;
      let left = saved.scrollLeft;
      if (geometryChanged && directory) {
        const target = selectedRef.current && cards.current.get(selectedRef.current);
        const bounds = target?.getBoundingClientRect();
        if (bounds) left = owner.scrollLeft + bounds.left - owner.getBoundingClientRect().left - 6;
      } else if (geometryChanged) {
        // Preserve the visible card and fractional offset across orientation
        // or catalog changes; if it disappeared, use the valid selection.
        const anchor = saved.anchorId && cards.current.get(saved.anchorId);
        const target = anchor || (selectedRef.current && cards.current.get(selectedRef.current));
        const bounds = target && target.getBoundingClientRect();
        left = bounds ? owner.scrollLeft + bounds.left - owner.getBoundingClientRect().left - 6
          + (anchor ? saved.anchorFraction * bounds.width : 0) : 0;

        // A wide rail may have shown several cards after its left anchor.
        // On a narrower return, keep the card being returned to visible too;
        // focus({preventScroll:true}) deliberately cannot do this for us.
        // Unfocused manual browsing still restores only its visible anchor.
        const selectedCard = selectedRef.current && cards.current.get(selectedRef.current);
        const focusTarget = (saved.restoreFocusId && cards.current.get(saved.restoreFocusId))
          || (selectedCard === document.activeElement ? selectedCard : undefined);
        const focusBounds = focusTarget && focusTarget.getBoundingClientRect();
        if (focusBounds) {
          const cardLeft = owner.scrollLeft + focusBounds.left - owner.getBoundingClientRect().left;
          if (focusBounds.width >= owner.clientWidth - 12 || cardLeft < left + 6) left = cardLeft - 6;
          else if (cardLeft + focusBounds.width > left + owner.clientWidth - 6) left = cardLeft + focusBounds.width - owner.clientWidth + 6;
        }
      }
      const clamped = Math.max(0, Math.min(owner.scrollWidth - owner.clientWidth, Number.isFinite(left) ? left : 0));
      // Route restoration must not animate from the beginning of the rail.
      owner.scrollTo({left: clamped, behavior: 'instant'});
      savePosition();
    }
    restorePosition();
    savePosition();
    if (firstMount.current) {
      firstMount.current = false;
      const saved = snapshots.get(shelfId);
      if (saved?.restoreFocusId) {
        // Consume the one-shot activation marker before focus emits onFocus.
        // Ordinary first visits, number browsing and new-tab links never set it.
        snapshots.set(shelfId, {...saved, restoreFocusId: undefined});
        if (products.some(product => product.id === saved.restoreFocusId)) {
          cards.current.get(saved.restoreFocusId)?.focus({preventScroll: true});
        }
      }
    }
    const resize = new ResizeObserver(() => restorePosition(true));
    resize.observe(owner);
    const firstCard = products[0] && cards.current.get(products[0].id);
    if (firstCard) resize.observe(firstCard);
    return () => {
      resize.disconnect();
      // A changed catalog has already invalidated this effect's old card list.
      if (catalogRef.current === catalogKey) savePosition();
    };
  }, [catalogKey, shelfId, snapshots]);

  function rememberSelection(id: ProductId) {
    const changed = selectedRef.current !== id;
    selectedRef.current = id;
    setSelectedId(id);
    revealMinimap(id);
    savePosition();
    if (changed) onSelectionChange?.(id);
  }

  function activateProduct(event: MouseEvent<HTMLAnchorElement>, id: ProductId) {
    if (event.defaultPrevented || event.button !== 0) return;
    const multiplayerProduct = isMultiplayerProductId(id);
    const action = gestures.cardClick(id, event, multiplayerProduct);
    if (action === 'native') return;
    if (action === 'selected' || action === 'suppressed') {event.preventDefault(); return;}
    if (onActivate) {event.preventDefault();event.currentTarget.focus({preventScroll: true});onActivate(id);return;}
    // Main sends Multiplayer product activation straight to its filtered room
    // directory. It does not change the independent home minimap preview.
    if (multiplayerProduct) return;
    rememberSelection(id);
    const saved = snapshots.get(shelfId);
    if (saved) snapshots.set(shelfId, {...saved, restoreFocusId: id});
    if (panel) {
      event.preventDefault(); event.currentTarget.focus({preventScroll: true});
      panel.open({pathname: `/play/${id}`, search: location.search, hash: location.hash});
    }
  }

  function navigateCards(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? products.length - 1
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'ArrowRight' ? Math.min(products.length - 1, index + 1) : undefined;
    if (destination === undefined) return;
    event.preventDefault();
    selectProduct(products[destination].id, true);
  }

  function navigateMinimap(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); gestures.cancelDock();
      if (selectedRef.current) toggles.current.get(selectedRef.current)?.focus({preventScroll: true});
      return;
    }
    const choices = [...toggles.current.entries()].filter(([, button]) => !!button.getClientRects().length);
    const index = Math.max(0, choices.findIndex(([, button]) => button === document.activeElement));
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'ArrowRight' ? Math.min(choices.length - 1, index + 1) : undefined;
    if (destination === undefined) return;
    if (!choices.length) return;
    event.preventDefault(); const [id] = choices[destination];
    toggles.current.get(id)?.focus({preventScroll: true}); selectProduct(id); revealMinimap(id);
  }

  if (!products.length) return null;

  return <section ref={shelf} data-library-shelf={shelfId} data-directory-library={directory ? '' : undefined} aria-labelledby={`${shelfId}-heading`} className="min-w-0">
    <div className={directory ? 'sr-only' : 'flex min-h-[38px] items-center gap-2.5 px-1.5 pb-1.5 library:min-h-11 library:gap-[18px] library:pb-2.5'}>
      <h2 id={`${shelfId}-heading`} className="text-xl leading-[1.3] font-bold tracking-[.04em] library:text-[22px]">{heading}</h2>
      {multiplayer && !directory && <Link to="/lobby" className="ml-auto inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-[#f1e4e6] px-[15px] py-[9px] text-[13px] leading-[1.3] font-bold text-[#a93243] transition-opacity hover:opacity-[.88] motion-reduce:transition-none">
        <img src={roomUsersIcon} width={18} height={18} alt="" className="brightness-0 opacity-[.65]"/>
        {t('lobby.title')}
      </Link>}
    </div>
    <div ref={rail} id={`${shelfId}-rail`} data-library-dragging={gestureState.dragging} onScroll={savePosition}
      onPointerDown={event => gestures.railDown(event)} onLostPointerCapture={event => gestures.lostRail(event.pointerId)}
      onDragStart={event => event.preventDefault()} role="group" aria-labelledby={`${shelfId}-heading`} className="library-gesture-rail scrollbar-none flex min-w-0 gap-3.5 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-1.5 p-1.5 pb-3.5 max-library:-mr-[18px] max-library:pr-[18px] library:gap-5">
      {products.map((product, index) => {
        const active = selected === product.id;
        const target = isMultiplayerProductId(product.id)
          ? multiplayerDirectoryAddress(product.id, location.search)
          : {pathname: `/play/${product.id}`, search: location.search, hash: location.hash};
        return <Link key={product.id} to={target} data-library-product={product.id} data-library-selected={active} draggable={false} preventScrollReset state={{returnTo: '/'}} ref={element => {
          if (element) cards.current.set(product.id, element);
          else cards.current.delete(product.id);
        }} onClick={event => activateProduct(event, product.id)} onKeyDown={event => navigateCards(event, index)}
          aria-label={directory ? t('ui.multiplayer.settingsForGame', {game: product.title}) : t(multiplayer ? 'react.library.openMultiplayer' : 'react.library.openGame', {title:product.title})}
          className="main-library-card group relative isolate flex h-[clamp(220px,31svh,290px)] w-[62vw] shrink-0 flex-col justify-between overflow-hidden rounded-[22px] border border-white/15 bg-panel p-[18px] text-paper no-underline shadow-card transition-colors hover:border-paper/60 motion-reduce:transition-none max-library:portrait:h-[clamp(210px,29svh,260px)] max-library:portrait:w-[clamp(186px,52vw,260px)] library:h-[clamp(220px,32vh,350px)] library:w-[clamp(230px,24vw,360px)] library:rounded-card library:p-[22px]">
          <span className={`main-cover-fallback pointer-events-none absolute inset-0 -z-10 transition-transform duration-300 motion-reduce:transition-none ${active ? 'scale-[1.018]' : ''}`} aria-hidden="true">
            <ProductArtwork product={product} eager={index === 0} onLoad={image => {
              const accent = coverAccentForImage(image);
              if (accent) image.closest<HTMLElement>('.main-library-card')?.style.setProperty('--cover-accent', accent);
            }}/>
            <span className={`main-cover-shade absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${active ? 'opacity-30' : ''}`}/>
          </span>
          <span className={`main-library-card-number main-card-text-shadow origin-top-left text-[42px] leading-none font-medium tracking-[-.055em] tabular-nums transition-transform duration-300 ease-main motion-reduce:transition-none library:text-[52px] ${active ? 'scale-[1.08] text-paper' : 'text-white/75'}`} aria-hidden="true">{product.number}</span>
          <span className="main-library-card-copy min-w-0 pt-6">
            <span lang="ja" className={`main-library-card-title main-card-text-shadow block origin-bottom-left text-[27px] leading-[1.2] font-bold tracking-[.01em] whitespace-nowrap transition-transform duration-300 ease-main motion-reduce:transition-none max-library:portrait:text-[clamp(22px,6vw,27px)] library:text-[clamp(25px,2.2vw,34px)] ${active ? '-translate-y-[3px] scale-[1.025]' : 'translate-y-[3px]'}`}>{product.title}</span>
            <span className={`main-library-card-subtitle mt-2 block text-[11px] leading-[1.4] tracking-[.02em] transition-opacity motion-reduce:transition-none library:text-xs ${active ? 'opacity-100' : 'opacity-55'}`}>{product.subtitle}</span>
          </span>
        </Link>;
      })}
    </div>
    {products.length > 1 && <nav ref={minimap} data-library-minimap={shelfId} data-library-holding={gestureState.holding} data-library-scrubbing={gestureState.scrubbing}
      onKeyDown={navigateMinimap} onContextMenu={event => event.preventDefault()} aria-label={t('react.library.quickNav', {shelf:heading})}
      className="main-library-minimap mx-auto w-max max-w-full">
      <div ref={dock} onScroll={onMinimapScroll} className="main-library-minimap-dock">
        {products.map(product => <button key={product.id} ref={element => {if (element) toggles.current.set(product.id, element); else toggles.current.delete(product.id);}} type="button" data-library-preview={product.id}
          onPointerDown={event => gestures.dockDown(product.id, event)} onLostPointerCapture={event => gestures.lostDock(event.pointerId)}
          aria-label={directory ? t('ui.multiplayer.roomsForGame', {game: product.title}) : t('react.library.browseGame', {title:product.title})} aria-controls={`${shelfId}-rail`} aria-pressed={selected === product.id} aria-current={selected === product.id}
          onClick={event => gestures.dockClick(product.id, (event.nativeEvent as PointerEvent).pointerType === 'touch' || matchMedia('(pointer: coarse)').matches)} className="main-library-minimap-toggle">{product.number}</button>)}
      </div>
    </nav>}
  </section>;
}


export function PublicationHeadLinks({webApp}: {webApp?: import('../services/app-shell.client').UiPublicationGate['webApp']}) {
  return <>{webApp?.manifest && <link rel="manifest" href={webApp.manifest}/>}
    {webApp?.favicon && <link rel="icon" href={webApp.favicon}/>}
    {webApp?.apple && <link rel="apple-touch-icon" href={webApp.apple}/>}</>;
}

export function GameLibrary({products = currentLibraryProducts, activeProductId}: {products?: readonly LibraryProduct[]; activeProductId?: ProductId}) {
  const {t} = useLocale();
  const shell = useAppShell().snapshot;
  const publication = shell?.gate;
  const visible = publishedLibraryProducts(products, publication);
  return <div className="grid min-w-0 gap-[22px] library:gap-7">
    <h1 className="sr-only">{t('site.documentTitle')}</h1>
    <GameShelf products={visible.filter(product => !isMultiplayerProductId(product.id))} multiplayer={false} routeActive={!!activeProductId}/>
    <GameShelf products={visible.filter(product => isMultiplayerProductId(product.id))} multiplayer routeActive={!!activeProductId}/>
  </div>;
}

/** The directory reuses the same rail selection, drag and horizontal quick index. */
export function DirectoryLibrary({products, selectedProduct, blocked = false, onSelectionChange, onActivate}: {
  products: readonly LibraryProduct[]; selectedProduct?: ProductId; blocked?: boolean;
  onSelectionChange(id: ProductId): void; onActivate(id: ProductId): void;
}) {
  return <GameShelf products={products} multiplayer routeActive={blocked} directory selectedProduct={selectedProduct} onSelectionChange={onSelectionChange} onActivate={onActivate}/>;
}

function MenuIcon({path}: {path: string}) {return <svg className="masthead-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg>;}
