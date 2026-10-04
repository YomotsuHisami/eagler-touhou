/** One framework-independent owner for the existing decorative-motion choice. */
export const LESS_MOTION_STORAGE_KEY = 'eagler-touhou-less-motion-v1';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export interface MotionPreferenceSnapshot {
  readonly lessMotion: boolean;
  readonly systemReducedMotion: boolean;
  readonly reducedMotion: boolean;
}
export const DEFAULT_MOTION_PREFERENCE: MotionPreferenceSnapshot = Object.freeze({
  lessMotion: false, systemReducedMotion: false, reducedMotion: false,
});
type MotionBrowser = Pick<Window, 'localStorage' | 'matchMedia' | 'addEventListener' | 'removeEventListener'>;

export function createMotionPreferenceStore({getBrowser = () => typeof window === 'undefined' ? null : window}: {
  getBrowser?: () => MotionBrowser | null;
} = {}) {
  let snapshot = DEFAULT_MOTION_PREFERENCE;
  let browser: MotionBrowser | null = null;
  let storage: Storage | null = null;
  let media: MediaQueryList | null = null;
  let sessionChoice = false;
  let disconnect: (() => void) | null = null;
  const listeners = new Set<() => void>();
  function update(lessMotion: boolean, systemReducedMotion: boolean) {
    if (snapshot.lessMotion === lessMotion && snapshot.systemReducedMotion === systemReducedMotion) return;
    snapshot = Object.freeze({lessMotion, systemReducedMotion, reducedMotion: lessMotion || systemReducedMotion});
    for (const listener of [...listeners]) listener();
  }
  function readBrowser() {
    let lessMotion = snapshot.lessMotion;
    // A rejected write remains effective for this document. Do not overwrite it
    // with stale storage when StrictMode or a standalone dialog resubscribes.
    if (!sessionChoice && storage) {
      try {lessMotion = storage.getItem(LESS_MOTION_STORAGE_KEY) === '1';} catch {}
    }
    update(lessMotion, media?.matches ?? false);
  }
  function initialize() {
    if (browser) return;
    browser = getBrowser();
    if (!browser) return;
    try {storage = browser.localStorage;} catch {storage = null;}
    try {media = browser.matchMedia(REDUCED_MOTION_QUERY);} catch {media = null;}
    readBrowser();
  }
  function connect() {
    if (!browser || disconnect) return;
    const target = browser;
    const changed = () => update(snapshot.lessMotion, media?.matches ?? false);
    const stored = (event: StorageEvent) => {
      if (event.key !== LESS_MOTION_STORAGE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== storage) return;
      sessionChoice = false;
      update(event.key === null ? false : event.newValue === '1', media?.matches ?? false);
    };
    target.addEventListener('storage', stored);
    media?.addEventListener('change', changed);
    disconnect = () => {
      target.removeEventListener('storage', stored);
      media?.removeEventListener('change', changed);
      disconnect = null;
    };
    // Catch external changes while no view was subscribed, without extra owners.
    readBrowser();
  }
  function setLessMotion(value: boolean) {
    initialize();
    sessionChoice = true;
    try {
      if (storage) {storage.setItem(LESS_MOTION_STORAGE_KEY, value ? '1' : '0'); sessionChoice = false;}
    } catch {}
    update(value, media?.matches ?? false);
  }
  return Object.freeze({
    getSnapshot() {initialize(); if (!listeners.size && browser) readBrowser(); return snapshot;},
    getServerSnapshot: () => DEFAULT_MOTION_PREFERENCE,
    subscribe(listener: () => void) {
      initialize(); listeners.add(listener); connect();
      return () => {listeners.delete(listener); if (!listeners.size) disconnect?.();};
    },
    setLessMotion,
    toggle() {initialize(); setLessMotion(!snapshot.lessMotion);},
  });
}
// Construction is SSR-safe. Browser APIs are read only on client access.
export const motionPreferenceStore = createMotionPreferenceStore();
