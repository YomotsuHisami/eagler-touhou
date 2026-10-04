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
  let publishedSnapshot = snapshot;
  let browser: MotionBrowser | null = null;
  let storage: Storage | null = null;
  let media: MediaQueryList | null = null;
  let sessionChoice = false;
  let disconnect: (() => void) | null = null;
  const listeners = new Set<() => void>();
  function publish() {
    if (snapshot === publishedSnapshot) return;
    publishedSnapshot = snapshot;
    for (const listener of [...listeners]) listener();
  }
  function update(lessMotion: boolean, systemReducedMotion: boolean, notify = true) {
    if (snapshot.lessMotion !== lessMotion || snapshot.systemReducedMotion !== systemReducedMotion) {
      snapshot = Object.freeze({lessMotion, systemReducedMotion, reducedMotion: lessMotion || systemReducedMotion});
    }
    if (notify) publish();
  }
  function readSystemPreference() {
    // A fresh query observes browser state synchronously, before its queued
    // change event. A newly mounted dialog must not animate from a stale cache.
    try {return browser?.matchMedia(REDUCED_MOTION_QUERY).matches ?? false;}
    catch {return media?.matches ?? false;}
  }
  function readBrowser() {
    let lessMotion = snapshot.lessMotion;
    // A rejected write remains effective for this document. Do not overwrite it
    // with stale storage when StrictMode or a standalone dialog resubscribes.
    if (!sessionChoice && storage) {
      try {lessMotion = storage.getItem(LESS_MOTION_STORAGE_KEY) === '1';} catch {}
    }
    update(lessMotion, readSystemPreference());
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
    const changed = () => update(snapshot.lessMotion, readSystemPreference());
    const stored = (event: StorageEvent) => {
      if (event.key !== LESS_MOTION_STORAGE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== storage) return;
      sessionChoice = false;
      update(event.key === null ? false : event.newValue === '1', readSystemPreference());
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
    update(value, readSystemPreference());
  }
  return Object.freeze({
    getSnapshot() {
      initialize();
      if (!listeners.size && browser) readBrowser();
      // useSyncExternalStore reads during render: refresh the cached value but
      // leave notification to the event/subscription commit, never another view's render.
      else if (browser) update(snapshot.lessMotion, readSystemPreference(), false);
      return snapshot;
    },
    getServerSnapshot: () => DEFAULT_MOTION_PREFERENCE,
    subscribe(listener: () => void) {
      initialize(); listeners.add(listener); connect(); publish();
      return () => {listeners.delete(listener); if (!listeners.size) disconnect?.();};
    },
    setLessMotion,
    toggle() {initialize(); setLessMotion(!snapshot.lessMotion);},
  });
}
// Construction is SSR-safe. Browser APIs are read only on client access.
export const motionPreferenceStore = createMotionPreferenceStore();
