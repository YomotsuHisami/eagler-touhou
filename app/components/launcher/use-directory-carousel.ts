import {useLayoutEffect, useRef, type RefObject} from 'react';
import {visibleDirectoryEntries, type DirectoryFilter} from './directory-categories';

/** Native touch scrolling owns movement; only a settled center commits selection. */
export function useDirectoryCarousel({directory, rail, selectedGame, revision, locked, interactive, onActivate, onSite, onCenter, filter = 'all', homeRequest = 0, selectionRequest = 0}: {
  directory: RefObject<HTMLElement | null>; rail: RefObject<HTMLDivElement | null>;
  selectedGame?: string; revision: string; locked: boolean; interactive: boolean;
  onActivate(id: string): void; onSite(): void; onCenter?(category: DirectoryFilter): void; filter?: DirectoryFilter;
  homeRequest?: number; selectionRequest?: number;
}) {
  const latest = useRef({locked,interactive,selectedGame,onActivate,onSite,onCenter,filter});
  latest.current = {locked,interactive,selectedGame,onActivate,onSite,onCenter,filter};
  const controller = useRef<{sync(home?: boolean, commit?: boolean): void} | null>(null), previousHome = useRef(homeRequest), previousSelection = useRef(selectionRequest);
  useLayoutEffect(() => {
    const node = directory.current, scroller = rail.current;
    if (!node || !scroller || !interactive) return;
    const portrait = matchMedia('(max-width:780px) and (orientation:portrait)');
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    let active = false, dragging = false, userScrolling = false, centering = false, commitAlignment = false, frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let centeredKey: string | undefined, alignmentKey: string | undefined, completedHomeKey: string | undefined;
    const cards = () => visibleDirectoryEntries(scroller);
    const key = (card: HTMLElement) => card.dataset.directoryPlaceholder ? `empty:${card.dataset.directoryPlaceholder}` : card.dataset.game ?? 'site';
    const reportCenter = (card: HTMLElement) => {centeredKey = key(card); latest.current.onCenter?.((card.dataset.directoryCategory ?? 'all') as DirectoryFilter);};
    const enabled = () => portrait.matches && latest.current.interactive && !latest.current.locked;
    const center = () => {const bounds = scroller.getBoundingClientRect(); return bounds.left + bounds.width / 2;};
    const distance = (card: HTMLElement) => {const bounds = card.getBoundingClientRect(); return bounds.left + bounds.width / 2 - center();};
    const lessMotion = () => reduced.matches || document.body.classList.contains('less-motion');
    const paint = () => {
      frame = 0;
      if (!enabled()) return;
      let nearest: HTMLElement | undefined, nearestDistance = Infinity;
      for (const card of cards()) {
        const radius = Math.max(1,card.offsetWidth * 1.65), delta = Math.abs(distance(card));
        if (delta < nearestDistance) {nearest = card; nearestDistance = delta;}
        const wave = lessMotion() ? card.getAttribute('aria-current') === 'true' ? .12 : 0 : delta >= radius ? 0 : .12 * (1 + Math.cos(Math.PI * delta / radius)) / 2;
        card.style.setProperty('--carousel-wave',wave.toFixed(4));
      }
      if (nearest) reportCenter(nearest);
    };
    const cancel = () => {clearTimeout(timer); cancelAnimationFrame(frame); frame = 0;};
    const align = (smooth: boolean, preserveCenter = false, home = false, commit = false) => {
      if (home) completedHomeKey = undefined;
      const preserveCommit = preserveCenter && centering && commitAlignment;
      const selected = (home ? cards()[0] : preserveCenter ? cards().find(card => key(card) === (centering ? alignmentKey : centeredKey)) : undefined)
        ?? cards().find(card=>card.getAttribute('aria-current') === 'true' && (latest.current.filter === 'all' || card.dataset.game))
        ?? cards().find(card=>card.dataset.game || card.dataset.directoryPlaceholder);
      if (!selected) return;
      centering = true; alignmentKey = key(selected);
      commitAlignment = (home || commit || preserveCommit) && selected.getAttribute('aria-disabled') !== 'true' && !selected.dataset.directoryPlaceholder;
      scroller.scrollTo({left:scroller.scrollLeft + distance(selected),behavior:smooth && !lessMotion() ? 'smooth' : 'instant'});
      paint();
      if (commitAlignment) {clearTimeout(timer);timer = setTimeout(settle,180);}
    };
    const settle = () => {
      clearTimeout(timer);
      if (!enabled() || dragging) return;
      let homeCommit = false;
      if (centering) {centering = false; paint(); homeCommit = commitAlignment;commitAlignment = false;if(!homeCommit)return;}
      // Resize, scroll restoration and screenshot capture can emit additional
      // scrollend events after a programmatic alignment. Only user input or an
      // explicit category choice may commit a different game/site route.
      if (!homeCommit && !userScrolling) return;
      userScrolling = false;
      if (node.closest('[inert]') || document.querySelector('dialog[open]') || document.body.classList.contains('player-active')) return;
      const nearest = cards().filter(card => card.getAttribute('aria-disabled') !== 'true').sort((a,b) => Math.abs(distance(a)) - Math.abs(distance(b)))[0];
      if (!nearest) return;
      reportCenter(nearest);
      if (nearest.dataset.directoryPlaceholder || nearest.getAttribute('aria-current') === 'true' || key(nearest) === completedHomeKey) return;
      if (homeCommit) completedHomeKey = key(nearest);
      if (nearest.dataset.siteEntry) latest.current.onSite();
      else if (nearest.dataset.directoryProduct) latest.current.onActivate(nearest.dataset.directoryProduct);
    };
    const scroll = () => {
      if (!enabled()) return;
      if (!frame) frame = requestAnimationFrame(paint);
      // scrollend covers native snapping; the quiet-period fallback also works
      // in browsers without that event and keeps inertia from changing routes.
      clearTimeout(timer); timer = setTimeout(settle,180);
    };
    const start = () => {dragging = true; userScrolling = true; centering = false; commitAlignment = false; completedHomeKey = undefined; clearTimeout(timer);};
    const end = () => {dragging = false; if (enabled()) scroll();};
    const wheel = () => {userScrolling = true;centering = false;commitAlignment = false;completedHomeKey = undefined;};
    const sync = (home = false, commit = false) => {
      const next = enabled(), wasActive = active; active = next;
      cancel(); dragging = userScrolling = false;
      if (next) align(wasActive,false,home,commit);
      else {
        centering = commitAlignment = false;
        if (wasActive) cards().forEach(card => card.style.removeProperty('--carousel-wave'));
        if (home && portrait.matches) scroller.scrollTo({left:0,behavior:lessMotion() ? 'instant' : 'smooth'});
      }
    };
    const resize = () => {if (enabled()) {cancel(); userScrolling = false; align(false,true);}};
    const mediaChange = () => sync();
    const preference = () => {if (enabled()) paint();};
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(scroller);
    const preferenceObserver = new MutationObserver(preference);
    preferenceObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    scroller.addEventListener('scroll',scroll,{passive:true});
    scroller.addEventListener('scrollend',settle);
    scroller.addEventListener('pointerdown',start,{passive:true});
    scroller.addEventListener('pointerup',end,{passive:true});
    scroller.addEventListener('pointercancel',end,{passive:true});
    scroller.addEventListener('wheel',wheel,{passive:true});
    portrait.addEventListener('change',mediaChange); reduced.addEventListener('change',preference);
    controller.current = {sync};
    return () => {
      cancel(); resizeObserver.disconnect(); preferenceObserver.disconnect();
      if (active) cards().forEach(card => card.style.removeProperty('--carousel-wave'));
      scroller.removeEventListener('scroll',scroll); scroller.removeEventListener('scrollend',settle);
      scroller.removeEventListener('pointerdown',start); scroller.removeEventListener('pointerup',end); scroller.removeEventListener('pointercancel',end); scroller.removeEventListener('wheel',wheel);
      portrait.removeEventListener('change',mediaChange); reduced.removeEventListener('change',preference); controller.current = null;
    };
  }, [directory,rail,interactive]);
  useLayoutEffect(() => {
    const home = previousHome.current !== homeRequest, commit = previousSelection.current !== selectionRequest;
    previousHome.current = homeRequest;previousSelection.current = selectionRequest;controller.current?.sync(home,commit);
  }, [selectedGame,revision,locked,interactive,homeRequest,selectionRequest]);
}
