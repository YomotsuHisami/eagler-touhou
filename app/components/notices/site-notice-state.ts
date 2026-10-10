import {parseSiteNoticeText, SITE_NOTICE_DURATION_MS, type SiteNoticeLine} from './site-notice-source';
import type {SitePreferencesModel} from '../../models/site-preferences';

export interface SiteNoticeEnvironment {
  fetchImpl?: typeof fetch;
  matchMediaImpl?: (query: string) => Pick<MediaQueryList, 'matches'>;
  setTimeoutImpl?: (callback: () => void, delay: number) => number;
  clearTimeoutImpl?: (timer: number) => void;
  baseUrl?: string;
  durationMs?: number;
}
export interface SiteNoticeSnapshot {
  readonly lines: ReadonlyArray<SiteNoticeLine>;
  readonly hidden: boolean;
  readonly closing: boolean;
  readonly scrollHidden: boolean;
  readonly optOutVisible: boolean;
  readonly durationMs: number | null;
}

/** Main site-notice.mts lifecycle expressed as a React-observable owner.
 * Content parsing remains the unchanged main http(s)-only parser. Presentation
 * never attaches fetched HTML, and this owner never mutates a React DOM node.
 */
export function createSiteNoticeState(preferences: SitePreferencesModel, environment: SiteNoticeEnvironment = {}) {
  const durationMs = environment.durationMs ?? SITE_NOTICE_DURATION_MS;
  const setTimer = environment.setTimeoutImpl ?? ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = environment.clearTimeoutImpl ?? (timer => window.clearTimeout(timer));
  const listeners = new Set<() => void>();
  let snapshot: SiteNoticeSnapshot = Object.freeze({lines: [], hidden: true, closing: false,
    scrollHidden: false, optOutVisible: false, durationMs: null});
  let active = false, requestSerial = 0;
  let timer: number | null = null, closeTimer: number | null = null;
  let unsubscribePreferences: (() => void) | null = null;
  const scrollPositions = new WeakMap<object, number>();
  const clear = (value: number | null) => {if (value !== null) clearTimer(value);};
  function publish(change: Partial<SiteNoticeSnapshot>) {
    snapshot = Object.freeze({...snapshot, ...change});
    for (const listener of listeners) listener();
  }
  function close() {
    ++requestSerial;
    clear(timer); timer = null;
    if (snapshot.hidden || snapshot.closing) return;
    const reducedMotion = environment.matchMediaImpl?.('(prefers-reduced-motion: reduce)').matches
      ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || snapshot.scrollHidden) {
      publish({hidden: true, scrollHidden: false, closing: false});
      return;
    }
    publish({closing: true});
    closeTimer = setTimer(() => {
      closeTimer = null;
      if (active) publish({hidden: true, scrollHidden: false, closing: false});
    }, 220);
  }
  async function load(): Promise<boolean> {
    if (!active || !preferences.getSnapshot().noticeEnabled) return false;
    const request = ++requestSerial;
    try {
      const response = await (environment.fetchImpl ?? globalThis.fetch)('NOTICE.txt', {cache: 'no-store'});
      if (!response.ok) return false;
      const text = (await response.text()).replace(/^\uFEFF/, '').trim();
      if (!text || !active || !preferences.getSnapshot().noticeEnabled || request !== requestSerial) return false;
      const baseUrl = environment.baseUrl ?? globalThis.location?.href ?? 'https://notice.invalid/';
      const lines = parseSiteNoticeText(text, baseUrl);
      clear(timer); clear(closeTimer); closeTimer = null;
      publish({lines, optOutVisible: preferences.getSnapshot().noticeDismissed,
        hidden: false, closing: false, scrollHidden: false, durationMs});
      timer = setTimer(close, durationMs);
      return true;
    } catch {return false;}
  }
  function rememberScroll(target: object, current: number) {scrollPositions.set(target, Math.max(0, current));}
  function scroll(target: object, position: number) {
    if (snapshot.hidden) return;
    const current = Math.max(0, position);
    const previous = scrollPositions.get(target) ?? current;
    scrollPositions.set(target, current);
    const delta = current - previous;
    if (Math.abs(delta) < 3) return;
    if (delta > 0 && current > 10) publish({scrollHidden: true});
    else if (delta < 0) publish({scrollHidden: false});
  }
  function destroy() {
    active = false; ++requestSerial;
    clear(timer); clear(closeTimer); timer = null; closeTimer = null;
    unsubscribePreferences?.(); unsubscribePreferences = null;
  }
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    connect() {
      active = true;
      let enabled = preferences.getSnapshot().noticeEnabled;
      unsubscribePreferences?.();
      unsubscribePreferences = preferences.subscribe(() => {
        const next = preferences.getSnapshot().noticeEnabled;
        if (next === enabled) return;
        enabled = next;
        if (enabled) void load(); else close();
      });
      return destroy;
    },
    load, close, scroll, rememberScroll, destroy,
    dismiss() {preferences.dismissNotice(); close();},
    optOut() {preferences.setNoticeEnabled(false);},
    isEnabled: () => preferences.getSnapshot().noticeEnabled,
    isOpen: () => !snapshot.hidden && !snapshot.closing,
  });
}
