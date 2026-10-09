import {useLayoutEffect, useRef, type RefObject} from 'react';
/** Main app.mts8506–8530, scoped to this options node with listener/RAF teardown.
 * Only the options layer follows visualViewport; pinch zoom is left untouched.
 */
export function useOptionsViewport(ref: RefObject<HTMLElement | null>) {
  const update = () => {
    const node = ref.current;
    if (!node) return;
    const viewport = window.visualViewport;
    if (viewport && viewport.scale !== 1) return;
    const width = viewport?.width || document.documentElement.clientWidth;
    const height = viewport?.height || window.innerHeight;
    node.style.setProperty('--options-view-width', `${width}px`);
    node.style.setProperty('--options-view-height', `${height}px`);
    node.style.setProperty('--options-view-top', `${viewport?.offsetTop || 0}px`);
    node.style.setProperty('--options-view-left', `${viewport?.offsetLeft || 0}px`);
    node.classList.toggle('options-compact', height < 520);
  };
  const latest = useRef(update); latest.current = update;
  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {if (!frame) frame = requestAnimationFrame(() => {frame = 0; latest.current();});};
    window.addEventListener('resize', schedule, {passive: true});
    window.visualViewport?.addEventListener('resize', schedule, {passive: true});
    window.visualViewport?.addEventListener('scroll', schedule, {passive: true});
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, []);
  useLayoutEffect(update);
}
