/** Presentation state only. Native select.value remains the selection owner;
 * these immutable descriptors are its current projected label/option data. */
export interface CustomSelectOption {
  readonly value: string; readonly text: string; readonly disabled: boolean; readonly index: number;
}
export interface CustomSelectDescription {
  readonly value: string; readonly label: string; readonly ariaLabel: string;
  readonly disabled: boolean; readonly signature: string; readonly options: readonly CustomSelectOption[];
}
export interface CustomSelectSnapshot {
  readonly open: boolean; readonly description: CustomSelectDescription | null;
}
export function createCustomSelectState() {
  let snapshot: CustomSelectSnapshot = Object.freeze({open: false, description: null});
  const listeners = new Set<() => void>();
  function publish(next: CustomSelectSnapshot) {snapshot = Object.freeze(next); for (const listener of listeners) listener();}
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    setOpen(open: boolean) {if (open !== snapshot.open) publish({...snapshot, open});},
    sync(next: CustomSelectDescription) {
      const old = snapshot.description;
      if (old && old.value === next.value && old.label === next.label && old.ariaLabel === next.ariaLabel &&
        old.disabled === next.disabled && old.signature === next.signature) return;
      const options = old?.signature === next.signature ? old.options : Object.freeze(next.options.map(option => Object.freeze({...option})));
      publish({...snapshot, description: Object.freeze({...next, options})});
    },
  };
}
export type CustomSelectState = ReturnType<typeof createCustomSelectState>;
