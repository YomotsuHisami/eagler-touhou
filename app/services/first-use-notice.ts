import {
  FIRST_USE_NOTICE_FILE,
  getFirstUseNoticeStorage,
  hasSeenFirstUseNotice,
  markFirstUseNoticeSeen,
  type FirstUseNoticeStorage,
} from '../../src/launcher/first-use-notice.mts';

export type FirstUseNoticeContent =
  | Readonly<{ kind: 'available'; html: string }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'error'; error: unknown }>;

export interface FirstUseNoticeServiceOptions {
  storage?: FirstUseNoticeStorage | null;
  fetchImpl?: typeof fetch;
}

/** Content and seen-state only. The view owns display, acknowledgement and close. */
export function createFirstUseNoticeService(options: FirstUseNoticeServiceOptions = {}) {
  const storage = options.storage === undefined ? getFirstUseNoticeStorage() : options.storage;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let cached: FirstUseNoticeContent | null = null;
  let pending: Promise<FirstUseNoticeContent> | null = null;

  async function read(): Promise<FirstUseNoticeContent> {
    try {
      // This repository-generated fragment is escaped/protocol-filtered by the
      // content build. Never fetch arbitrary HTML or resolve from a child route.
      const response = await fetchImpl(`/${FIRST_USE_NOTICE_FILE}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = String(await response.text()).trim();
      cached = html ? Object.freeze({ kind: 'available', html }) : Object.freeze({ kind: 'empty' });
      return cached;
    } catch (error) {
      return Object.freeze({ kind: 'error', error });
    }
  }

  return Object.freeze({
    hasSeen: () => hasSeenFirstUseNotice(storage),
    markSeen: () => markFirstUseNoticeSeen(storage),
    load(): Promise<FirstUseNoticeContent> {
      if (cached) return Promise.resolve(cached);
      if (!pending) pending = read().finally(() => { pending = null; });
      return pending;
    },
  });
}
