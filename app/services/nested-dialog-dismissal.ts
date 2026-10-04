/** Explicit parent/child intent forwarding. Radix remains the modal stack;
 * this only covers the short interval before its new layer effect commits. */
export interface NestedDialogDismissal {open: boolean; present: boolean; dismiss(): void}
export function dismissNestedDialog(event: Pick<Event, 'preventDefault'>, owners: ReadonlyArray<NestedDialogDismissal | null | undefined>): boolean {
  // A newer query modal wins over the retained exit of the previous one.
  const current = owners.find(owner => owner?.open);
  if (current) {event.preventDefault();current.dismiss();return true;}
  if (owners.some(owner => owner?.present)) {event.preventDefault();return true;}
  return false;
}
