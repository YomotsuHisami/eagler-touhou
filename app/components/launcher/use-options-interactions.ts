import {useLayoutEffect, useRef, type RefObject} from 'react';
import {cycleFocus} from '../cycle-focus';
/** Main app.mts8585–8616: scroll ownership and cyclic keyboard focus.
 * Close remains an intent port into the single Router owner.
 */
export function useOptionsInteractions(ref: RefObject<HTMLElement | null>, open: boolean, onBack: () => void) {
  const current = useRef({open, onBack}); current.current = {open, onBack};
  useLayoutEffect(() => {
    const panel = ref.current; if (!panel) return;
    const wheel = (event: WheelEvent) => {
      if (current.current.open && event.target instanceof Element && !event.target.closest('.options-scroll')) event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!current.current.open || event.defaultPrevented) return;
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key) && event.target instanceof Element && !event.target.closest('.options-scroll,input,select,textarea')) {
        event.preventDefault();
        const scroll = panel.querySelector<HTMLElement>('.options-scroll'); if (!scroll) return;
        if (event.key === 'Home') scroll.scrollTop = 0;
        else if (event.key === 'End') scroll.scrollTop = scroll.scrollHeight;
        else scroll.scrollTop += (event.key === 'PageUp' || event.key === 'ArrowUp' ? -1 : 1) * (event.key.startsWith('Page') ? scroll.clientHeight : 40);
      } else if (event.key === 'Escape') {event.preventDefault(); current.current.onBack();}
      else cycleFocus(panel, event);
    };
    panel.addEventListener('wheel', wheel, {passive: false}); panel.addEventListener('keydown', keydown);
    return () => {panel.removeEventListener('wheel', wheel); panel.removeEventListener('keydown', keydown);};
  }, [ref]);
}
export function useBackdropWheel(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const prevent = (event: WheelEvent) => event.preventDefault();
    node.addEventListener('wheel', prevent, {passive: false});
    return () => node.removeEventListener('wheel', prevent);
  }, [ref]);
}
