/** Wrap only a boundary Tab. Native listeners keep working after DOM relocation. */
export function cycleFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const controls = [...container.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')]
    .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0 && container.ownerDocument.defaultView?.getComputedStyle(control).visibility !== 'hidden');
  const active = container.ownerDocument.activeElement;
  const destination = event.shiftKey && active === controls[0] ? controls.at(-1)
    : !event.shiftKey && active === controls.at(-1) ? controls[0] : null;
  if (destination) {event.preventDefault(); destination.focus();}
}
