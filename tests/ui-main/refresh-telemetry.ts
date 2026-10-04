import type {Page} from '@playwright/test';

export interface RefreshEvent {
  documentId: string;
  kind: string;
  phase: 'active' | 'leaving' | 'departed';
  time: number;
  path?: string;
  signalAborted?: boolean;
}
const storageKey = '__ui_refresh_lifecycle_v1';

/** Bounded test-only observation. Delegates every original fetch unchanged and
 * leaves pageerror collection/expectations in the navigation fixture intact.
 */
export async function installRefreshTelemetry(page: Page) {
  await page.addInitScript(key => {
    const documentId = `${Date.now()}-${Math.random()}`;
    let phase: RefreshEvent['phase'] = 'active';
    let records: RefreshEvent[] = [];
    try {records = JSON.parse(sessionStorage.getItem(key) ?? '[]') as RefreshEvent[];} catch {}
    const record = (kind: string, extra: Partial<RefreshEvent> = {}) => {
      records.push({documentId, kind, phase, time: Date.now(), ...extra});
      records = records.slice(-80);
      try {sessionStorage.setItem(key, JSON.stringify(records));} catch {}
    };
    window.addEventListener('beforeunload', () => {phase = 'leaving'; record('beforeunload');}, true);
    window.addEventListener('pagehide', () => {phase = 'departed'; record('pagehide');}, true);
    window.addEventListener('pageshow', () => {phase = 'active'; record('pageshow');}, true);
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      if (/(?:host-manifest|release-catalog)\.json$/.test(path)) {
        record('metadata-fetch', {path, signalAborted: !!(init?.signal ?? (input instanceof Request ? input.signal : null))?.aborted});
      }
      return originalFetch(input, init);
    };
    record('document');
  }, storageKey);
}

export async function readRefreshTelemetry(page: Page): Promise<RefreshEvent[]> {
  return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]') as RefreshEvent[], storageKey);
}
