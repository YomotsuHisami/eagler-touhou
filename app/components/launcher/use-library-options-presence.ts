import {useLayoutEffect, useRef, useState} from 'react';
import {closeMainSelectMenus} from './MainSelect';
import type {OptionsTargets} from './options-ownership';
import type {LibraryProduct} from './products';

export interface LibraryOptionsPresenceInput {
  /** The Router has already committed this state; this hook never navigates. */
  open: boolean;
  context: 'library' | 'lobby';
  product: LibraryProduct | undefined;
  /** The document-lived site preference, supplied by its existing owner. */
  lessMotion: boolean;
  /** Running game conceals its retained settings without a home-close motion. */
  concealed?: boolean;
}

export interface LibraryOptionsPresence {
  /** Keep the panel, selected card and inert library together until exit settles. */
  open: boolean;
  closing: boolean;
  product: LibraryProduct | undefined;
  targets: OptionsTargets;
  openedProduct: LibraryProduct['id'] | undefined;
}

type Presence = Omit<LibraryOptionsPresence, 'openedProduct' | 'targets'>;
const mobileLibraryMotion = '(max-width: 780px), (hover: none), (pointer: coarse)';

/** Main app.mts8544–8580: visual lifetime after the sole Router commits close.
 * The existing final CSS owns the mobile transform; no second route or history
 * lifetime is introduced. The directory's native carrier follows this same
 * visual lifetime rather than running a second animation or close timer.
 */
export function useLibraryOptionsPresence({open, context, product, lessMotion, concealed = false}: LibraryOptionsPresenceInput): LibraryOptionsPresence {
  const [presence, setPresence] = useState<Presence>(() => ({open, closing: false, product}));
  const targets = useRef<OptionsTargets>({selectedCard: null, panel: null});
  const pendingClose = useRef<(() => void) | null>(null);
  const previous = useRef({open, context});
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const pendingFocus = useRef<HTMLElement | null>(null);

  function cancelClose() {
    generation.current++;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pendingClose.current = null;
    pendingFocus.current = null;
  }

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelClose();
      document.body.classList.remove('library-tools-open', 'library-tools-closing');
    };
  }, []);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = {open, context};
    // Changing documents/surfaces must not finish an old library animation or
    // move focus into the now-hidden library. Reopening retires its completion.
    if (open || before.context !== context) {
      if (before.open && (!open || before.context !== context)) closeMainSelectMenus();
      cancelClose();
      setPresence(current => {
        const nextProduct = product ?? current.product;
        return current.open === open && !current.closing && current.product === nextProduct
          ? current : {open, closing: false, product: nextProduct};
      });
      return;
    }
    if (pendingClose.current) return;
    if (!before.open) {
      // Catalog arrival at home may supply the initial retained panel. It must
      // not replace a selected panel while an exit is still in progress.
      if (product) setPresence(current => current.product === product ? current : {...current, product});
      return;
    }

    // During this first committed close render, the retained selection is still
    // present, just as it is when original main captures .game.selected.
    const selected = targets.current.selectedCard;
    closeMainSelectMenus();
    const completion = ++generation.current;
    const finish = () => {
      if (!mounted.current || generation.current !== completion) return;
      timer.current = null;
      pendingClose.current = null;
      pendingFocus.current = concealed ? null : selected;
      setPresence(current => ({...current, open: false, closing: false}));
    };
    if (concealed || lessMotion ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    pendingClose.current = finish;
    setPresence(current => ({...current, closing: true}));

  }, [open, context, product, lessMotion, concealed]);

  useLayoutEffect(() => {
    // A native carrier becomes visible in its child's layout effect. Commit
    // the shared closed transform before opening, as for the retained home
    // panel, so both surfaces animate through the full entrance distance.
    if (presence.open && !concealed && !document.body.classList.contains('library-tools-open')) {
      targets.current.panel?.getBoundingClientRect();
    }
    document.body.classList.toggle('library-tools-open', presence.open && !concealed);
    document.body.classList.toggle('library-tools-closing', presence.closing && !concealed);
    // Read the closing transform after its class commit: mobile entrance and
    // exit have different durations. CSS is the authoritative motion source.
    if (presence.closing && pendingClose.current && timer.current === null) {
      const duration = optionsTransformDuration(targets.current.panel);
      const finish = pendingClose.current;
      if (duration === 0) finish();
      else timer.current = window.setTimeout(finish, (duration ?? (window.matchMedia(mobileLibraryMotion).matches ? 200 : 480)) + 40);
    }
    // React has now removed selection, dialog semantics and library inertness.
    // Restoring focus earlier would target a still-inert card on real browsers.
    if (!concealed && !open && !presence.open && pendingFocus.current) {
      const selected = pendingFocus.current;
      pendingFocus.current = null;
      if (selected.isConnected) selected.focus({preventScroll: true});
    }
  }, [presence, open, context, concealed]);

  return {...presence, targets: targets.current, open: presence.open && !concealed, closing: presence.closing && !concealed, openedProduct: presence.open && !concealed ? presence.product?.id : undefined};
}

/** Null means no authored/computed transition (e.g. a synthetic DOM without CSS).
 * Zero is a real no-motion transition and must never trigger fallback timing. */
export function optionsTransformDuration(panel: HTMLElement | null): number | null {
  if (!panel) return null;
  // A document with no stylesheets or inline transition has no CSS motion source.
  if (!panel.ownerDocument.styleSheets.length && !panel.style.transition && !panel.style.transitionProperty && !panel.style.transitionDuration) return null;
  const style = panel.ownerDocument.defaultView?.getComputedStyle(panel);
  if (!style) return null;
  if (!style.transitionProperty && !style.transitionDuration && !style.transition) return null;
  if (style.transition === 'none' || style.transitionProperty === 'none') return 0;
  const properties = (style.transitionProperty || 'all').split(',').map(value => value.trim());
  const milliseconds = (value: string) => {const n = parseFloat(value) || 0; return value.trim().endsWith('ms') ? n : n * 1000;};
  const durations = (style.transitionDuration || '0s').split(',').map(milliseconds);
  const delays = (style.transitionDelay || '0s').split(',').map(milliseconds);
  // CSS repeats shorter duration/delay lists and the last matching property wins.
  let duration = 0;
  properties.forEach((property, index) => {
    if (property === 'transform' || property === 'all') duration = Math.max(0, durations[index % durations.length]! + delays[index % delays.length]!);
  });
  return duration;
}
