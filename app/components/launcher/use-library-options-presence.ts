import {useLayoutEffect, useRef, useState} from 'react';
import {closeMainSelectMenus} from './MainSelect';
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
  openedProduct: LibraryProduct['id'] | undefined;
}

type Presence = Omit<LibraryOptionsPresence, 'openedProduct'>;
const mobileLibraryMotion = '(max-width: 780px), (hover: none), (pointer: coarse)';

/** Main app.mts8544–8580: visual lifetime after the sole Router commits close.
 * The existing final CSS owns the mobile transform; no second route or history
 * lifetime is introduced. Lobby's native dialog remains its own close owner.
 */
export function useLibraryOptionsPresence({open, context, product, lessMotion, concealed = false}: LibraryOptionsPresenceInput): LibraryOptionsPresence {
  const [presence, setPresence] = useState<Presence>(() => ({open, closing: false, product}));
  const previous = useRef({open, context});
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const pendingFocus = useRef<HTMLElement | null>(null);

  function cancelClose() {
    generation.current++;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
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
    if (open || context !== 'library' || before.context !== context) {
      if (before.open && (!open || before.context !== context)) closeMainSelectMenus();
      cancelClose();
      setPresence(current => {
        const nextProduct = product ?? current.product;
        return current.open === open && !current.closing && current.product === nextProduct
          ? current : {open, closing: false, product: nextProduct};
      });
      return;
    }
    if (timer.current !== null) return;
    if (!before.open) {
      // Catalog arrival at home may supply the initial retained panel. It must
      // not replace a selected panel while an exit is still in progress.
      if (product) setPresence(current => current.product === product ? current : {...current, product});
      return;
    }

    // During this first committed close render, the retained selection is still
    // present, just as it is when original main captures .game.selected.
    const selected = document.querySelector<HTMLElement>('.game.selected');
    closeMainSelectMenus();
    const completion = ++generation.current;
    const finish = () => {
      if (!mounted.current || generation.current !== completion) return;
      timer.current = null;
      pendingFocus.current = concealed ? null : selected;
      setPresence(current => ({...current, open: false, closing: false}));
    };
    if (concealed || !window.matchMedia(mobileLibraryMotion).matches || lessMotion ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    setPresence(current => ({...current, closing: true}));
    timer.current = window.setTimeout(finish, 240);
  }, [open, context, product, lessMotion, concealed]);

  useLayoutEffect(() => {
    document.body.classList.toggle('library-tools-open', presence.open && !concealed);
    document.body.classList.toggle('library-tools-closing', presence.closing && !concealed);
    // React has now removed selection, dialog semantics and library inertness.
    // Restoring focus earlier would target a still-inert card on real browsers.
    if (!concealed && !open && !presence.open && context === 'library' && pendingFocus.current) {
      const selected = pendingFocus.current;
      pendingFocus.current = null;
      if (selected.isConnected) selected.focus({preventScroll: true});
    }
  }, [presence, open, context, concealed]);

  return {...presence, open: presence.open && !concealed, closing: presence.closing && !concealed, openedProduct: presence.open && !concealed ? presence.product?.id : undefined};
}
