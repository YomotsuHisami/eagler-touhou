import {useLayoutEffect, useRef, useState, type RefObject} from 'react';
import {createLibraryGestures, createLibraryRailMotion, type LibraryGestureState} from '../services/library-gestures';
import {useMotionPreference} from './MotionPreferenceProvider';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
export function useLibraryGestures({rail, dock, cards, toggles, selected, remember, activeProductId}: {
  rail: RefObject<HTMLDivElement | null>; dock: RefObject<HTMLElement | null>;
  cards: RefObject<Map<ProductId, HTMLAnchorElement>>; toggles: RefObject<Map<ProductId, HTMLButtonElement>>;
  selected: RefObject<ProductId | undefined>; remember(id: ProductId): void; activeProductId?: ProductId;
}) {
  const {reducedMotion} = useMotionPreference();
  const preference = useRef(reducedMotion), rememberCurrent = useRef(remember);
  preference.current = reducedMotion; rememberCurrent.current = remember;
  const [state, setState] = useState<LibraryGestureState>({dragging: false, holding: false, scrubbing: false});
  const motion = useRef<ReturnType<typeof createLibraryRailMotion> | null>(null);
  motion.current ??= createLibraryRailMotion({read: () => rail.current?.scrollLeft ?? 0, write: left => rail.current?.scrollTo({left, behavior: 'instant'}),
    maximum: () => Math.max(0, (rail.current?.scrollWidth ?? 0) - (rail.current?.clientWidth ?? 0)), reduced: () => preference.current,
    now: () => performance.now(), requestFrame: callback => requestAnimationFrame(callback), cancelFrame: frame => cancelAnimationFrame(frame)});
  function select(id: string, focus = false, instant = false) {
    const card = cards.current.get(id as ProductId), owner = rail.current;
    if (!card || !owner) return;
    rememberCurrent.current(id as ProductId);
    const left = owner.scrollLeft + card.getBoundingClientRect().left - owner.getBoundingClientRect().left - 6;
    if (instant) motion.current!.settle(left); else motion.current!.move(left);
    if (focus) card.focus({preventScroll: true});
  }
  const selectCurrent = useRef(select); selectCurrent.current = select;
  const gestures = useRef<ReturnType<typeof createLibraryGestures> | null>(null);
  const element = (owner: 'rail' | 'dock', id?: string) => owner === 'rail' ? rail.current : toggles.current.get(id as ProductId);
  gestures.current ??= createLibraryGestures({
    clock: {now: () => performance.now(), set: (callback, delay) => window.setTimeout(callback, delay), clear: handle => window.clearTimeout(handle as number)},
    selected: () => selected.current, select: (...args) => selectCurrent.current(...args),
    open: (id, instant) => {selectCurrent.current(id, false, instant); cards.current.get(id as ProductId)?.click();},
    scrollLeft: () => rail.current?.scrollLeft ?? 0, scrollTo: left => rail.current?.scrollTo({left, behavior: 'instant'}), cancelMotion: () => motion.current!.cancel(),
    visible: (owner, id) => !document.hidden && !!element(owner, id)?.getClientRects().length,
    capture: (owner, pointerId, id) => {const node = element(owner, id); if (node && !node.hasPointerCapture(pointerId)) node.setPointerCapture(pointerId);},
    release: (owner, pointerId, id) => {const node = element(owner, id); if (node?.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);},
    dockBounds: () => dock.current?.getBoundingClientRect() ?? {top: 0, bottom: 0},
    dockChoices: () => [...toggles.current].filter(([, button]) => !!button.getClientRects().length).map(([id, button]) => {const bounds = button.getBoundingClientRect(); return {id, center: bounds.left + bounds.width / 2};}),
    changed: setState,
  });
  const owner = gestures.current;
  useLayoutEffect(() => {
    const move = (event: PointerEvent) => {if (owner.move(event)) event.preventDefault();};
    const up = (event: PointerEvent) => owner.up(event);
    const cancel = (event: PointerEvent) => owner.cancel(event.pointerId);
    const outside = (event: PointerEvent) => {if (!(event.target instanceof Node) || !dock.current?.contains(event.target)) owner.outsideDock();};
    const suspend = () => owner.suspend();
    const visibility = () => {if (document.hidden) suspend();};
    const wheel = (event: WheelEvent) => {if (owner.suppressWheel(event)) event.preventDefault();};
    const element = rail.current;
    element?.addEventListener('wheel', wheel, {passive: false});
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('pointerdown', outside);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', suspend); window.addEventListener('pagehide', suspend);
    return () => {
      element?.removeEventListener('wheel', wheel);
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('pointerdown', outside);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', suspend); window.removeEventListener('pagehide', suspend); owner.dispose();
    };
  }, [owner, rail, dock]);
  useLayoutEffect(() => {if (activeProductId) owner.suspend(false);}, [owner, activeProductId]);
  return {state, select, gestures: owner};
}
