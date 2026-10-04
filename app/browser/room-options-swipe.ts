import {createRoomOptionsSwipe} from '../services/room-options-swipe';
/** A current, uncovered options modal may retract from its passive content.
 * Form editing, nested Help/editor/draft scopes and player input keep ownership. */
export function bindRoomOptionsSwipe({element, current, close, documentObj = document, windowObj = window}: {
  element(): HTMLElement | null; current(): boolean; close(): void; documentObj?: Document; windowObj?: Window;
}) {
  function allowed() {
    const surface = element();
    return current() && !!surface?.isConnected && !surface.closest('[inert], [aria-hidden="true"]') &&
      !documentObj.hidden && !documentObj.body?.classList.contains('player-active') &&
      !documentObj.querySelector('[data-runtime-host][aria-hidden="false"]');
  }
  function canStart(target: unknown) {
    const surface = element(), node = target instanceof Element ? target : null;
    return !!surface && !!node && surface.contains(node) && node.closest('[role="dialog"]') === surface &&
      !node.closest('input,textarea,select,button,a,label,[contenteditable],[role="slider"],[data-gesture-owner],[data-touch-editor-scene],[data-resize]');
  }
  const swipe = createRoomOptionsSwipe({allowed, canStart, close: () => {if (allowed()) close();}});
  const down = (event: PointerEvent) => swipe.down(event);
  const move = (event: PointerEvent) => {if (swipe.move(event)) event.preventDefault();};
  const up = (event: PointerEvent) => {if (swipe.up(event)) event.preventDefault();};
  const drag = (event: DragEvent) => {if (swipe.drag(event.target)) event.preventDefault();};
  const visibility = () => {if (documentObj.hidden) swipe.cancel();};
  documentObj.addEventListener('pointerdown', down, {capture: true, passive: true});
  documentObj.addEventListener('pointermove', move, {capture: true, passive: false});
  documentObj.addEventListener('pointerup', up, {capture: true, passive: false});
  documentObj.addEventListener('pointercancel', swipe.cancel, true); documentObj.addEventListener('dragstart', drag, true);
  documentObj.addEventListener('visibilitychange', visibility); windowObj.addEventListener('blur', swipe.cancel); windowObj.addEventListener('pagehide', swipe.cancel);
  return () => {
    swipe.cancel(); documentObj.removeEventListener('pointerdown', down, true); documentObj.removeEventListener('pointermove', move, true); documentObj.removeEventListener('pointerup', up, true);
    documentObj.removeEventListener('pointercancel', swipe.cancel, true); documentObj.removeEventListener('dragstart', drag, true); documentObj.removeEventListener('visibilitychange', visibility);
    windowObj.removeEventListener('blur', swipe.cancel); windowObj.removeEventListener('pagehide', swipe.cancel);
  };
}
