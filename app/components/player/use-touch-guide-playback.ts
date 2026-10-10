import {useCallback, useLayoutEffect, useState, type RefObject} from 'react';

export type TouchGuideName = 'orientation' | 'game-controls' | 'menu' | 'focus' | 'dialogue' | 'thprac';
const durations = {focus: 7000, menu: 12000, dialogue: 4000} as const;
/** Main app3674–3782: one expanded guide, unchanged CSS playback classes,
 * 140ms paired shots and 760ms shot flight. Only transient animation leaves are
 * imperative; React retains ownership of the panel markup and expansion state. */
export function useTouchGuidePlayback(root: RefObject<HTMLDivElement | null>, open: boolean) {
  const [playback, setPlayback] = useState<{active: TouchGuideName | null; revision: number}>({active: null, revision: 0});
  const collapse = useCallback(() => setPlayback(value => value.active === null ? value : {active: null, revision: value.revision + 1}), []);
  const play = useCallback((active: TouchGuideName) => setPlayback(value => ({active, revision: value.revision + 1})), []);
  const toggle = useCallback((active: TouchGuideName) => setPlayback(value => ({active: value.active === active ? null : active, revision: value.revision + 1})), []);
  useLayoutEffect(() => {if (!open) collapse();}, [open, collapse]);
  useLayoutEffect(() => {
    const help = root.current;
    if (!help) return;
    const documentObj = help.ownerDocument, windowObj = documentObj.defaultView!;
    let timer: ReturnType<typeof setTimeout> | null = null, shotTimer: ReturnType<typeof setInterval> | null = null;
    const animations = new Set<Animation>();
    const layer = help.querySelector<HTMLElement>('.shot-stream')!;
    const panels = help.querySelectorAll<HTMLElement>('[data-guide-panel]');
    for (const panel of panels) panel.classList.remove('is-playing', 'is-finished');
    layer.replaceChildren();
    const name = playback.active;
    const panel = name ? help.querySelector<HTMLElement>(`[data-guide-panel="${name}"]`) : null;
    const clearShots = () => {
      if (shotTimer !== null) clearInterval(shotTimer);
      shotTimer = null;
      for (const animation of animations) {animation.onfinish = null; animation.cancel();}
      animations.clear(); layer.replaceChildren();
    };
    const reduced = () => windowObj.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const emit = () => {
      const body = panel?.querySelector<HTMLElement>('.guide-demo-body');
      if (!panel || help.hidden || body?.hidden || !panel.classList.contains('is-playing') || panel.classList.contains('is-finished') || documentObj.hidden || reduced()) return;
      const stage = help.querySelector<HTMLElement>('.focus-stage')!, player = help.querySelector<HTMLElement>('.demo-player')!;
      const playerRect = player.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height) return;
      const focused = Number.parseFloat(windowObj.getComputedStyle(help.querySelector<HTMLElement>('.finger-focus')!).opacity) > .45;
      const centerX = playerRect.left - stageRect.left + playerRect.width / 2, startY = playerRect.top - stageRect.top + 3;
      const columnGap = focused ? 3 : 9;
      for (const side of [-1, 1]) {
        const shot = documentObj.createElement('i'); shot.className = 'demo-shot';
        shot.style.left = `${centerX + side * columnGap}px`; shot.style.top = `${startY}px`; layer.append(shot);
        const animation = shot.animate([
          {transform: 'translate(-50%,-50%) rotate(45deg)', opacity: 0},
          {offset: .08, transform: 'translate(-50%,-50%) rotate(105deg)', opacity: 1},
          {transform: `translate(-50%,-${startY + 18}px) rotate(765deg)`, opacity: 1},
        ], {duration: 760, easing: 'linear'});
        animations.add(animation); animation.onfinish = () => {animations.delete(animation); shot.remove();};
      }
    };
    if (open && panel && name && name in durations) {
      if (reduced()) panel.classList.add('is-finished');
      else {
        void panel.offsetWidth; panel.classList.add('is-playing');
        if (name === 'focus') {emit(); shotTimer = setInterval(emit, 140);}
        timer = setTimeout(() => {panel.classList.add('is-finished'); if (name === 'focus') clearShots(); timer = null;}, durations[name as keyof typeof durations]);
      }
    }
    return () => {
      if (timer !== null) clearTimeout(timer);
      clearShots();
      for (const panel of panels) panel.classList.remove('is-playing', 'is-finished');
    };
  }, [root, open, playback]);
  return {active: playback.active, collapse, play, toggle};
}
