type Domain = 'singleplayer' | 'multiplayer';
type Group = 'files' | 'display' | 'advanced' | 'touch';
interface SettingsDisclosureSnapshot {readonly files: boolean; readonly display: boolean; readonly advanced: boolean; readonly touch: boolean | null}
const initial: SettingsDisclosureSnapshot = Object.freeze({files: true, display: true, advanced: false, touch: null});
const states: Record<Domain, SettingsDisclosureSnapshot> = {singleplayer: initial, multiplayer: initial};
const listeners = new Set<() => void>();
// Main keeps these groups mounted while closing or changing the selected game.
// Preserve that document-local presentation state without writing preferences.
export const settingsDisclosure = {
  getSnapshot: (domain: Domain) => states[domain],
  getServerSnapshot: () => initial,
  subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
  setOpen(domain: Domain, group: Group, open: boolean) {
    if (states[domain][group] === open) return;
    states[domain] = Object.freeze({...states[domain], [group]: open});
    for (const listener of listeners) listener();
  },
  initializeTouch(domain: Domain, open: boolean) {if (states[domain].touch === null) this.setOpen(domain, 'touch', open);},
};
