/** Radix can focus the still-open parent container when a closing child's DOM
 * changes while body holds focus. That is a fallback, not a newer user intent.
 * Any other connected control, frame or modal remains a protected destination. */
export function dialogFocusMoved({active, body, documentElement, oldSurface, opener, returnFocus}: {
  active: HTMLElement | null; body: HTMLElement; documentElement: HTMLElement;
  oldSurface: HTMLElement | null; opener: HTMLElement | null; returnFocus?: HTMLElement | null;
}): boolean {
  if (!active || !active.isConnected || active === body || active === documentElement || oldSurface?.contains(active)) return false;
  const parentFallback = [opener, returnFocus].some(target => target?.closest('[data-animated-dialog]') === active);
  return !parentFallback;
}
