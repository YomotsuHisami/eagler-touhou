/** The right workspace exchanges through the Router. Settings use a vertical
 * Header/bottom exchange; game/lobby/room retain their original directions. */
export const workspaceCardSelector = '.workspace-column > .workspace-panel:not([hidden]), .workspace-column > .workspace-current:not([hidden]) > .workspace-panel';
export function workspaceMotionReduced(lessMotion = false): boolean {
  return lessMotion || typeof window === 'undefined' || typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('less-motion');
}

export function animateWorkspaceCard(card: HTMLElement | null, phase: 'exit' | 'entry', backwards: boolean, lessMotion = false, settings?: 'open' | 'close', files?: 'open' | 'close') {
  let animation: Animation | undefined, timer: ReturnType<typeof setTimeout> | undefined, frame = 0;
  let resolve: (completed: boolean) => void = () => {};
  const finished = new Promise<boolean>(done => {resolve = done;});
  let settled = false;
  const settle = (completed: boolean) => {if (!settled) {settled = true; clearTimeout(timer); resolve(completed);}};
  const originalInert = card?.inert ?? false;
  const cancel = () => {
    settle(false); if(frame)cancelAnimationFrame(frame); animation?.cancel();
    if (card) {card.inert = originalInert || card.dataset.roomSettingsOpen === 'true'; delete card.dataset.workspaceMotion;}
  };
  if (!card || workspaceMotionReduced(lessMotion) || typeof card.animate !== 'function') {
    settle(true); return {finished, cancel};
  }
  const start = () => {
    if(settled)return;
    const rect = card.getBoundingClientRect();
    const vertical = window.matchMedia('(max-width: 780px), (orientation: portrait)').matches;
    const offscreen = settings ? `0 ${settings === 'open' ? phase === 'exit' ? window.innerHeight - rect.top + 32 : -rect.bottom - 32 : phase === 'exit' ? -rect.bottom - 32 : window.innerHeight - rect.top + 32}px` : files
      ? `0 ${files === 'open' ? phase === 'exit' ? -rect.bottom - 32 : window.innerHeight - rect.top + 32 : phase === 'exit' ? window.innerHeight - rect.top + 32 : -rect.bottom - 32}px` : vertical
      ? `0 ${backwards ? phase === 'exit' ? '100%' : '-100%' : phase === 'exit' ? '-100%' : '100%'}`
      : backwards ? `${phase === 'exit' ? window.innerWidth - rect.left + 32 : -rect.right - 32}px 0`
        : phase === 'exit' ? '-100% 0' : `${window.innerWidth - rect.left + 32}px 0`;
    card.inert = true;
    card.dataset.workspaceMotion = phase;
    const visible = {translate: '0 0', opacity: 1}, hidden = {translate: offscreen, opacity: 0};
    try {
      animation = card.animate(phase === 'exit' ? [visible, hidden] : [hidden, visible], {
        duration: phase === 'exit' ? 220 : 280, easing: phase === 'exit' ? 'ease-in' : 'ease-out', fill: 'both',
      });
      // Own cancellation settles false first. An unexpected browser cancellation
      // must release the route, just like the timeout, rather than strand a card.
      animation.finished.then(() => settle(true), () => settle(true));
      // A background tab or interrupted animation must never lock navigation.
      timer = setTimeout(() => settle(true), 420);
    } catch {settle(true); cancel();}
  };
  if(phase === 'entry'){
    // Router restores scroll in layout after its Outlet. Measure the entering
    // card on the next frame, once that restoration and page reflow have settled.
    // Conceal the pending card so this deferral never flashes it in place.
    card.inert = true;card.dataset.workspaceMotion = 'entry-pending';
    frame = requestAnimationFrame(start);
  }else start();
  return {finished, cancel};
}
