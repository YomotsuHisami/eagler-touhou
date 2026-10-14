import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useLocale} from '../../i18n';
import {useOptionsTarget} from './options-ownership';
import type {LibraryProduct} from './products';
import {useDirectoryCarousel} from './use-directory-carousel';
import {directoryCategory, directoryGroups, visibleDirectoryEntries, type DirectoryFilter} from './directory-categories';
import {DesktopDirectoryMenu, directoryCategoryKey} from './DesktopDirectoryMenu';
import {NarrowDirectoryMenu} from './NarrowDirectoryMenu';

/** A game occupies one directory slot; its available modes retain catalog authority. */
export function directoryProducts(products: readonly LibraryProduct[]) {
  const games = new Map<string, LibraryProduct>();
  for (const product of products) {
    const previous = games.get(product.gameId);
    if (!previous || previous.hidden && !product.hidden || previous.hidden === product.hidden && previous.multiplayer && !product.multiplayer) games.set(product.gameId, product);
  }
  return [...games.values()];
}

export function GameDirectory({products, selectedProduct, onActivate, onSite, siteHref, locked = false, siteDisabled = false, interactive = true, showSite = true, railId}: {
  products: readonly LibraryProduct[]; selectedProduct?: string; onActivate(id: string): void;
  onSite(): void; siteHref: string; locked?: boolean; siteDisabled?: boolean; interactive?: boolean; showSite?: boolean; railId?: string;
}) {
  const {t} = useLocale();
  const directory = useRef<HTMLElement>(null), rail = useRef<HTMLDivElement>(null);
  const selectedCard = useOptionsTarget('selectedCard');
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [desktop, setDesktop] = useState(false), [category, setCategory] = useState<DirectoryFilter>('all');
  const [homeRequest,setHomeRequest] = useState(0);
  const [selectionRequest,setSelectionRequest] = useState(0);
  const [centerCategory,setCenterCategory] = useState<DirectoryFilter>('all');
  const entries = directoryProducts(products);
  const selectedGame = products.find(product => product.id === selectedProduct)?.gameId;
  const selectedEntry = entries.find(product => product.gameId === selectedGame);
  const narrowHighlight = category !== 'all' ? category : locked && selectedEntry ? directoryCategory(selectedEntry) : centerCategory;
  const revision = entries.map(product=>`${product.id}:${product.hidden}:${product.number}:${product.directoryCategory}`).join('|');
  useLayoutEffect(() => {
    const media = matchMedia('(min-width:781px) and (orientation:landscape)');
    const sync = () => setDesktop(media.matches); sync(); media.addEventListener('change',sync);
    return () => media.removeEventListener('change',sync);
  }, []);
  useLayoutEffect(() => {if (desktop) rail.current?.scrollTo({top:0,behavior:'instant'});}, [desktop,category,homeRequest]);
  useDirectoryCarousel({directory,rail,selectedGame,revision:revision+`:${desktop}:${category}:${showSite}:${siteDisabled}`,locked,interactive,onActivate,onSite,onCenter:setCenterCategory,filter:category,homeRequest,selectionRequest});
  const chooseCategory = (next: DirectoryFilter) => {
    setCategory(next);
    if(next === 'all')setHomeRequest(request=>request+1);
    else {
      setSelectionRequest(request=>request+1);
      const first = entries.find(product=>!product.hidden && directoryCategory(product) === next);
      if(desktop && !selectedGame && !locked && interactive && first)onActivate(first.id);
    }
  };
  useLayoutEffect(() => {
    if (!interactive) return;
    if (!locked && matchMedia('(max-width:780px) and (orientation:portrait)').matches) return;
    const active = rail.current ? visibleDirectoryEntries(rail.current).find(card=>card.getAttribute('aria-current') === 'true') : undefined;
    active?.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  }, [selectedGame, interactive, locked, desktop]);
  useEffect(() => {
    const node = directory.current, scroller = rail.current;
    if (!node || !scroller || !interactive) return;
    const desktop = matchMedia('(min-width:781px) and (orientation:landscape) and (hover:hover) and (pointer:fine)');
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    let frame = 0, y: number | null = null, last = 0;
    // Locking selection does not disable the directory's hover wave.
    const cards = () => visibleDirectoryEntries(scroller).filter(card=>card.matches('.game'));
    const enabled = () => desktop.matches && !reduced.matches && !document.body.classList.contains('less-motion');
    const reset = () => {cancelAnimationFrame(frame); frame = 0; y = null; last = 0; cards().forEach(card => card.style.removeProperty('--dock-wave'));};
    const update = (time: number) => {
      frame = 0;
      if (!enabled() || y === null) {reset(); return;}
      const elapsed = last ? Math.min(time - last, 32) : 16; last = time;
      const bounds = scroller.getBoundingClientRect(), top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
      const edge = Math.min(72, Math.max(0, bottom - top) / 3);
      const speed = !edge || y < top || y > bottom ? 0 : y < top + edge ? -360 * (1 - (y - top) / edge) : y > bottom - edge ? 360 * (1 - (bottom - y) / edge) : 0;
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + speed * elapsed / 1000));
      const targets = cards(), waves = targets.map(card => {
        const rect = card.getBoundingClientRect(), radius = Math.max(1, card.offsetHeight * 1.65);
        const distance = Math.abs(y! - (rect.top + rect.height / 2));
        return distance >= radius ? 0 : .12 * (1 + Math.cos(Math.PI * distance / radius)) / 2;
      });
      targets.forEach((card, index) => card.style.setProperty('--dock-wave', waves[index]!.toFixed(4)));
      if (speed && Math.abs(before - scroller.scrollTop) > .1) frame = requestAnimationFrame(update);
      else last = 0;
    };
    const move = (event: PointerEvent) => {if ((event.target as Element)?.closest('.desktop-directory-menu') || event.pointerType !== 'mouse' || !enabled()) {reset(); return;} y = event.clientY; if (!frame) frame = requestAnimationFrame(update);};
    const key = (event: KeyboardEvent) => {
      if (locked || node.closest('[inert]') || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || document.body.classList.contains('player-active') || document.querySelector('dialog[open]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('input,textarea,select,button,summary,.desktop-directory-menu,.narrow-directory-menu,.room-workspace,.clear-matrix-wrap,.score-table-wrap,.lobby-list-surface,.lobby-header-actions,[contenteditable="true"],[role="listbox"],[role="dialog"]')) return;
      const horizontal = matchMedia('(max-width:780px) and (orientation:portrait)').matches;
      const previousKey = horizontal ? 'ArrowLeft' : 'ArrowUp', nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
      if (horizontal && !node.contains(target) || ![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); if (event.repeat) return;
      const targets = cards().filter(card => card.getAttribute('aria-disabled') !== 'true'), focused = targets.indexOf(document.activeElement as HTMLElement);
      const current = focused >= 0 ? focused : Math.max(0, targets.findIndex(card => card.getAttribute('aria-current') === 'true'));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : Math.max(0, Math.min(targets.length - 1, current + (event.key === nextKey ? 1 : -1)));
      if (next !== current) {targets[next]?.focus({preventScroll: true}); targets[next]?.click();}
    };
    const observer = new MutationObserver(() => {if (!enabled()) reset();}); observer.observe(document.body, {attributes: true, attributeFilter: ['class']});
    node.addEventListener('pointermove', move); node.addEventListener('pointerleave', reset); node.addEventListener('pointercancel', reset);
    document.addEventListener('keydown', key);
    desktop.addEventListener('change', reset); reduced.addEventListener('change', reset);
    return () => {reset(); observer.disconnect(); node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', reset); node.removeEventListener('pointercancel', reset); document.removeEventListener('keydown', key); desktop.removeEventListener('change', reset); reduced.removeEventListener('change', reset);};
  }, [interactive, locked]);
  const card = (product: LibraryProduct) => {
    const selected = product.gameId === selectedGame;
    return <a key={product.gameId} ref={selected && (category === 'all' || directoryCategory(product) === category) ? selectedCard : undefined} className={`game${selected ? ' selected' : ''}${failed.has(product.id) || !product.artwork ? ' card-art-missing' : ''}`} data-game={product.gameId} data-directory-category={directoryCategory(product)} data-directory-product={product.id} data-product={product.multiplayer ? product.id : undefined} href={locked ? undefined : product.href} aria-disabled={locked || undefined} tabIndex={locked ? -1 : undefined} hidden={product.hidden} aria-current={selected ? 'true' : undefined} aria-label={`${product.title} · ${product.subtitle}`} onClick={event => {
      if (locked || product.hidden || category !== 'all' && directoryCategory(product) !== category) {event.preventDefault(); return;}
      if (!interactive || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); onActivate(product.id);
    }}>
      {product.artwork && <span className="card-art" aria-hidden="true"><img className="card-art-image" src={product.artwork} alt="" width="256" height="256" decoding="async" draggable={false} onError={() => setFailed(previous => new Set(previous).add(product.id))}/></span>}
      <span className="no"><span className="no-label">{product.number}</span></span><span className="game-copy"><h2>{product.title}</h2><small>{product.subtitle}</small></span>
    </a>;
  };
  return <nav className="game-library redesign-directory" ref={directory} aria-label={t('workspace.directory')}>
    {desktop ? <DesktopDirectoryMenu directory={directory} rail={rail} category={category} onCategory={chooseCategory} interactive={interactive} revision={revision}/>
      : <NarrowDirectoryMenu filter={category} highlight={narrowHighlight} onCategory={chooseCategory} interactive={interactive}/>}
    <div className="directory-rail-shell" data-center-select={!locked && interactive}>
    <div className="game-rail" id={railId} ref={rail} tabIndex={locked ? 0 : undefined}>
      {showSite && <a className={`game directory-site game-site${!selectedGame ? ' selected' : ''}`} href={siteDisabled || locked ? undefined : siteHref} data-site-entry="true" aria-disabled={siteDisabled || locked ? true : undefined} tabIndex={siteDisabled || locked ? -1 : undefined} aria-current={!selectedGame ? 'true' : undefined} onClick={event => {if (siteDisabled || locked) {event.preventDefault(); return;} if (interactive && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {event.preventDefault(); onSite();}}}>
        <span className="site-card-wordmark" aria-hidden="true"><span>EAGLER</span><span>TOUHOU</span></span><span className="site-card-caption">Eagler Touhou</span>
      </a>}
      {directoryGroups(entries,'all').map(group => <section className="directory-group" key={group.category} hidden={category !== 'all' && category !== group.category} data-directory-group={group.category} aria-label={t(directoryCategoryKey(group.category))}>
        {(category === 'all' && group.category !== 'mainline' || showSite && group.category === 'mainline') && <div className={`directory-group-divider${group.category === 'mainline' ? ' directory-site-divider' : ''}`} aria-hidden="true"><span>{t(directoryCategoryKey(group.category))}</span></div>}
        {group.products.map(card)}
        {!group.products.some(product => !product.hidden) && <div className="directory-coming-soon" data-directory-category={group.category} data-directory-placeholder={group.category} role="status" aria-label={`${t(directoryCategoryKey(group.category))} · ${t('directory.comingSoon')}`}><span>{t('directory.comingSoon')}</span></div>}
      </section>)}
    </div>
    <span className="directory-selector" aria-hidden="true"/>
    </div>
  </nav>;
}
