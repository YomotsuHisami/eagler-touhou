import {useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import {useLocale} from '../../i18n';
import {directoryCategoryKey, type DirectoryCategory, type DirectoryFilter} from './directory-categories';
import {DirectoryCategoryOptions} from './DirectoryCategoryOptions';
export {directoryCategoryKey} from './directory-categories';

/** The last group's first entry reaching the viewport bottom announces its arrival. */
export function enteredDirectoryCategory(rail: HTMLElement): DirectoryCategory | null {
  const bounds = rail.getBoundingClientRect(), bottom = Math.min(window.innerHeight, bounds.bottom);
  let entered: DirectoryCategory | null = null;
  for (const group of rail.querySelectorAll<HTMLElement>('[data-directory-group]:not([hidden])')) {
    const first = group.querySelector<HTMLElement>('.game:not([hidden]),.directory-coming-soon');
    if (first && first.getBoundingClientRect().top < bottom) entered = group.dataset.directoryGroup as DirectoryCategory;
  }
  return entered;
}

const focusVisible = (target: EventTarget) => {try {return target instanceof Element && target.matches(':focus-visible');} catch {return false;}};

export function DesktopDirectoryMenu({directory, rail, category, onCategory, interactive, revision}: {
  directory: RefObject<HTMLElement | null>; rail: RefObject<HTMLDivElement | null>;
  category: DirectoryFilter; onCategory(category: DirectoryFilter): void; interactive: boolean; revision: string;
}) {
  const {t,locale} = useLocale(), menu = useRef<HTMLDivElement>(null), options = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true), [near, setNear] = useState(false), [focused, setFocused] = useState(false);
  const [keyboard, setKeyboard] = useState(false), [settled, setSettled] = useState(false);
  const [cue, setCue] = useState<DirectoryCategory | null>(null);
  const open = expanded || near || focused || cue !== null, openRef = useRef(open); openRef.current = open;
  // A pointer or keyboard visit unrolls every choice; picking one re-centres it while the visit lasts.
  const wide = open && cue === null && (near || keyboard), browsing = wide && !settled;
  const cueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const geometry = useRef({width:246, center:123}), place = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const node = directory.current;
    if (!node) return;
    const header = node.closest('.sheet')?.querySelector<HTMLElement>('.masthead') ?? document.querySelector<HTMLElement>('.masthead');
    const measure = () => {
      const bounds = node.getBoundingClientRect(), main = node.closest('.directory-layout');
      const gap = main ? Number.parseFloat(getComputedStyle(main).columnGap) || 28 : 28;
      const sheet = node.closest('.sheet');
      const spacing = sheet ? Number.parseFloat(getComputedStyle(sheet).rowGap) || 18 : 18;
      // Both the menu and workspace start one sheet gap below the Header.
      node.style.setProperty('--category-menu-top', `${(header?.getBoundingClientRect().height ?? 62) + spacing}px`);
      const width = Math.max(120,bounds.right + gap - 12), railBounds = rail.current?.getBoundingClientRect();
      node.style.setProperty('--category-menu-width', `${width}px`);
      geometry.current = {width, center:railBounds ? railBounds.left + railBounds.width/2 : bounds.left + bounds.width/2};
      place.current();
    };
    measure(); const resize = new ResizeObserver(measure); resize.observe(node);
    if (header) resize.observe(header);
    window.addEventListener('resize', measure);
    return () => {resize.disconnect(); window.removeEventListener('resize', measure); node.style.removeProperty('--category-menu-top'); node.style.removeProperty('--category-menu-width');};
  }, [directory,rail]);

  useLayoutEffect(() => {
    const node = menu.current, choices = options.current;
    if (!node || !choices) return;
    const update = () => {
      const active = choices.querySelector<HTMLElement>('[aria-pressed="true"]'), strip = choices.offsetWidth, {width, center} = geometry.current;
      // Choices left of the game column's axis stay put rather than leaving a gap at the screen edge.
      const shift = browsing || !active ? 0 : Math.max(0,active.offsetLeft + active.offsetWidth/2 - center);
      const visible = Math.max(0,strip - shift), frame = wide ? visible : Math.min(width,visible);
      node.style.setProperty('--category-shift', `${shift}px`);
      node.style.setProperty('--category-frame-width', `${frame}px`);
      node.dataset.clipStart = String(shift > 0.5); node.dataset.clipEnd = String(visible > frame + 0.5);
    };
    place.current = update; update();
    const resize = new ResizeObserver(update); resize.observe(choices);
    return () => {resize.disconnect(); place.current = () => {};};
  }, [category,browsing,wide,locale]);

  useEffect(() => {if (!wide) setSettled(false);}, [wide]);

  useEffect(() => {
    const scroller = rail.current, node = menu.current, choices = options.current;
    if (!scroller || !node || !choices || !interactive) return;
    let observed = enteredDirectoryCategory(scroller), userScroll = false;
    const clearSpace = () => {
      const frame = node.getBoundingClientRect(), railBounds = scroller.getBoundingClientRect();
      const top = Math.max(frame.top,railBounds.top,0), bottom = Math.min(frame.bottom,railBounds.bottom,window.innerHeight);
      return bottom <= top || ![...scroller.querySelectorAll<HTMLElement>('.game:not([hidden])')].some(card=>{
        const cover = card.getBoundingClientRect();
        return cover.bottom > top && cover.top < bottom && cover.right > 0 && cover.left < node.offsetWidth;
      });
    };
    clearTimeout(cueTimer.current); setCue(null); setExpanded(true);
    const intent = () => {userScroll = true;};
    const scroll = () => {
      const next = enteredDirectoryCategory(scroller);
      if (scroller.scrollTop <= 1) {
        clearTimeout(cueTimer.current);setCue(null);setExpanded(true);observed = next;return;
      }
      const empty = clearSpace();
      if (!userScroll) {if(empty)setExpanded(true);observed = next; return;}
      setExpanded(empty); setNear(false); setFocused(false);
      if (node.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (category === 'all' && next && next !== observed) {
        setCue(next); clearTimeout(cueTimer.current);
        cueTimer.current = setTimeout(() => setCue(null), 1600);
      }
      observed = next;
    };
    const proximity = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = node.getBoundingClientRect();
      const nearby = event.clientX >= 0 && event.clientX <= (openRef.current ? bounds.width + 16 : 64) && event.clientY >= bounds.top - 18 && event.clientY <= bounds.bottom + 18;
      setNear(nearby);
      if (nearby) {clearTimeout(cueTimer.current); setCue(null);}
    };
    const keyIntent = (event: KeyboardEvent) => {if (scroller.contains(event.target as Node) && ['ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) intent();};
    scroller.addEventListener('scroll', scroll, {passive:true});
    const vacancy = new ResizeObserver(scroll);vacancy.observe(scroller);
    window.addEventListener('resize',scroll);
    scroller.addEventListener('wheel', intent, {passive:true}); scroller.addEventListener('pointerdown', intent, {passive:true}); scroller.addEventListener('pointermove', intent, {passive:true});
    document.addEventListener('pointermove', proximity, {passive:true}); document.addEventListener('keydown', keyIntent);
    return () => {
      clearTimeout(cueTimer.current);vacancy.disconnect();window.removeEventListener('resize',scroll);scroller.removeEventListener('scroll', scroll); scroller.removeEventListener('wheel', intent); scroller.removeEventListener('pointerdown', intent); scroller.removeEventListener('pointermove', intent);
      document.removeEventListener('pointermove', proximity); document.removeEventListener('keydown', keyIntent);
    };
  }, [rail, category, interactive, revision]);

  const choose = (next: DirectoryFilter) => {if (!interactive) return; clearTimeout(cueTimer.current); setCue(null); setExpanded(true); setSettled(true); onCategory(next);};
  return <div className="desktop-directory-menu" ref={menu} data-open={open} data-wide={wide} data-cue={cue !== null} aria-label={t('directory.categories')} tabIndex={interactive ? 0 : -1}
    onFocus={event => {setFocused(true); if (focusVisible(event.target)) {setKeyboard(true); setSettled(false);}}}
    onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {setFocused(false); setKeyboard(false);}}}
    onKeyDown={event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); clearTimeout(cueTimer.current); setCue(null); setExpanded(false); setNear(false); event.currentTarget.focus({preventScroll:true}); setFocused(false); setKeyboard(false);}
      else if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); setExpanded(true); options.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({preventScroll:true});}
    }}>
    <DirectoryCategoryOptions options={options} filter={category} onCategory={choose} interactive={interactive} open={open}/>
    <span className="directory-category-cue" role="status" aria-live="polite">{cue ? t(directoryCategoryKey(cue)) : ''}</span>
    <span className="directory-category-frame" aria-hidden="true"/>
  </div>;
}
