import {APP_SHELL_UPDATE_STATUS_PATH, appliedAppShellUpdateAt,
  formatRelativeUpdateAge, nextRelativeUpdateRefresh} from '../../src/launcher/relative-update-time.mts';

export interface BrandUpdateAgeSnapshot {text: string; dateTime?: string}
export interface BrandUpdateAgeOptions {
  baseUrl: string;
  translate(key: string, params?: Record<string, string | number>): string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timers: Pick<Window, 'setTimeout' | 'clearTimeout'>;
}
/** Main app303–334/1175: age of an applied app-shell update, not a release or
 * source commit date. The app-shell owner supplies its real readiness boundary. */
export function createBrandUpdateAge(options: BrandUpdateAgeOptions) {
  const now = options.now ?? Date.now, fetchImpl = options.fetchImpl ?? fetch;
  const listeners = new Set<() => void>();
  let appliedAt: number | null = null, timer: number | null = null;
  let disposed = false, generation = 0;
  let snapshot: Readonly<BrandUpdateAgeSnapshot> = Object.freeze({text: options.translate('brand.neverUpdated')});
  function render() {
    if (disposed) return;
    if (timer !== null) options.timers.clearTimeout(timer);
    timer = null;
    const next: BrandUpdateAgeSnapshot = appliedAt === null
      ? {text: options.translate('brand.neverUpdated')}
      : {text: options.translate('brand.updatedAgo', {age: formatRelativeUpdateAge(now() - appliedAt)}),
        dateTime: new Date(appliedAt).toISOString()};
    if (next.text !== snapshot.text || next.dateTime !== snapshot.dateTime) {
      snapshot = Object.freeze(next); for (const listener of listeners) listener();
    }
    if (appliedAt !== null) timer = options.timers.setTimeout(render, nextRelativeUpdateRefresh(now() - appliedAt));
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    /** Call once for each actual app-shell owner; superseded owners cannot
     * publish late results. No service worker is installed by this model. */
    async bind(ready: Promise<unknown>, isControlled: () => boolean) {
      const id = ++generation;
      try {
        await ready;
        if (disposed || id !== generation || !isControlled()) return;
        const response = await fetchImpl(new URL(APP_SHELL_UPDATE_STATUS_PATH, options.baseUrl), {cache: 'no-store'});
        if (!response.ok) return;
        const status: unknown = await response.json();
        if (disposed || id !== generation) return;
        appliedAt = appliedAppShellUpdateAt(status);
      } catch { /* Main leaves the neutral age on unavailable status. */ }
      if (!disposed && id === generation) render();
    },
    refreshLocale: render,
    dispose() {
      disposed = true; generation++;
      if (timer !== null) options.timers.clearTimeout(timer);
      timer = null; listeners.clear();
    },
  };
}
