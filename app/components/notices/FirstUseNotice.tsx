import {useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref} from 'react';
import {renderContentFragment} from '../../../src/launcher/content-fragment.mts';
import {createEdgeDrawerGesture} from '../../../src/launcher/edge-drawer-gesture.mts';
import {useLocale} from '../../i18n';
import {useMainDialog, type MainDialogProps} from './use-main-dialog';

// Original first-use-notice.mts3–10; legacy presence migrates, not just value "1".
export const FIRST_USE_NOTICE_FILE = 'content/FIRST_USE_NOTICE.html';
export const FIRST_USE_NOTICE_SEEN_STORAGE_KEY = 'eagler-touhou-first-use-notice-seen-v1';
const legacySeenKeys = ['eagler-touhou-new-player-notice-seen-v1', 'eagler-touhou-changelog-seen-v2', 'eagler-touhou-changelog-seen-20260822-1'];
export type NoticeLoadResult = {kind: 'available'} | {kind: 'empty'} | {kind: 'error'; error: unknown};
export interface FirstUseNoticeHandle {
  load(): Promise<NoticeLoadResult>;
  showManual(): Promise<NoticeLoadResult>;
  maybeShowAutomatically(isCurrent?: () => boolean): Promise<boolean>;
  hasSeenNotice(): boolean;
  isOpen(): boolean;
  close(): void;
}
export interface FirstUseNoticeProps extends MainDialogProps {
  onOpenRequest(): void;
  contentUrl?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetchImpl?: typeof fetch;
  /** Main launcher has right-edge gesture; main lobby has no such binding. */
  edgeGestures?: boolean;
  ref?: Ref<FirstUseNoticeHandle>;
}
function defaultStorage() {try {return globalThis.localStorage ?? null;} catch {return null;}}
/** Main first-use-notice.mts load/seen contract and index.html758–776 markup.
 * Sanitized content is the only imperative subtree; React owns its container.
 */
export function FirstUseNotice({open, onCloseRequest, onOpenRequest, contentUrl = FIRST_USE_NOTICE_FILE, storage, fetchImpl = fetch, edgeGestures = true, ref}: FirstUseNoticeProps) {
  const {t} = useLocale(), dialog = useMainDialog({open, onCloseRequest}, 220);
  const content = useRef<HTMLDivElement>(null);
  const cached = useRef<NoticeLoadResult | null>(null), pending = useRef<Promise<NoticeLoadResult> | null>(null);
  const active = useRef(false), generation = useRef(0);
  const failedManualOpen = useRef(false);
  const latest = useRef({t, onOpenRequest, storage, fetchImpl, contentUrl}); latest.current = {t, onOpenRequest, storage, fetchImpl, contentUrl};
  const getStorage = () => latest.current.storage === undefined ? defaultStorage() : latest.current.storage;
  function hasSeenNotice() {
    try {
      const store = getStorage();
      if (store?.getItem(FIRST_USE_NOTICE_SEEN_STORAGE_KEY) === '1') return true;
      for (const key of legacySeenKeys) if (store?.getItem(key)) {store.setItem(FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1'); return true;}
    } catch {}
    return false;
  }
  function markSeen() {try {getStorage()?.setItem(FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1');} catch {}}
  function status(text: string, className: string) {
    const target = content.current;
    if (!active.current || !target) return;
    const paragraph = target.ownerDocument.createElement('p'); paragraph.className = className; paragraph.textContent = text;
    target.replaceChildren(paragraph);
  }
  async function load(): Promise<NoticeLoadResult> {
    if (cached.current?.kind === 'available' || cached.current?.kind === 'empty') return cached.current;
    if (pending.current) return pending.current;
    const token = generation.current;
    const request = (async (): Promise<NoticeLoadResult> => {
      try {
        const response = await latest.current.fetchImpl(latest.current.contentUrl, {cache: 'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = String(await response.text()).trim();
        if (!active.current || token !== generation.current) return {kind: 'error', error: new Error('Notice unmounted')};
        if (!html) {cached.current = {kind: 'empty'}; status(latest.current.t('firstUseNotice.empty'), 'first-use-notice-empty');}
        else {
          if (content.current) renderContentFragment(content.current, html, content.current.ownerDocument);
          cached.current = {kind: 'available'};
        }
        return cached.current;
      } catch (error) {
        if (active.current && token === generation.current) status(latest.current.t('firstUseNotice.readFailed', {reason: error instanceof Error ? error.message : String(error)}), 'first-use-notice-error');
        return {kind: 'error', error};
      }
    })();
    pending.current = request;
    try {return await request;} finally {if (pending.current === request) pending.current = null;}
  }
  async function showManual() {
    const token = generation.current;
    const result = await load();
    if (active.current && token === generation.current) {
      if (result.kind === 'empty') status(latest.current.t('firstUseNotice.empty'), 'first-use-notice-empty');
      // Main opens a failed manual load as-is; that open transition must not
      // automatically retry and replace its error before another user request.
      failedManualOpen.current = result.kind === 'error';
      dialog.cancelPendingClose(); latest.current.onOpenRequest(); if (result.kind === 'available') markSeen();
    }
    return result;
  }
  async function maybeShowAutomatically(isCurrent: () => boolean = () => true) {
    if (!isCurrent() || hasSeenNotice()) return false;
    const token = generation.current;
    const result = await load();
    if (!active.current || token !== generation.current || !isCurrent() || result.kind !== 'available') return false;
    dialog.cancelPendingClose(); latest.current.onOpenRequest(); markSeen(); return true;
  }
  useImperativeHandle(ref, () => ({load, showManual, maybeShowAutomatically, hasSeenNotice, isOpen: () => !!dialog.ref.current?.open, close: dialog.requestClose}));
  useLayoutEffect(() => {
    active.current = true;
    if (!content.current?.childNodes.length) status(latest.current.t('firstUseNotice.loading'), 'first-use-notice-loading');
    return () => {active.current = false; generation.current++; pending.current = null; failedManualOpen.current = false;};
  }, []);
  useLayoutEffect(() => {
    if (content.current?.firstElementChild?.className === 'first-use-notice-loading') status(t('firstUseNotice.loading'), 'first-use-notice-loading');
  }, [t]);
  useEffect(() => {
    const alreadyFailed = failedManualOpen.current; failedManualOpen.current = false;
    if (open && !alreadyFailed) void load().then(result => {if (active.current && result.kind === 'available') markSeen();});
  }, [open]);
  const operations = useRef({showManual, close: dialog.requestClose}); operations.current = {showManual, close: dialog.requestClose};
  useEffect(() => {
    const node = dialog.ref.current;
    if (!edgeGestures || !node) return;
    const gesture = createEdgeDrawerGesture({side: 'right', drawer: node, isOpen: () => node.open,
      open: () => operations.current.showManual(), close: () => operations.current.close()});
    return () => gesture.destroy();
  }, [edgeGestures]);
  return <dialog ref={dialog.ref} className="first-use-notice-dialog" id="firstUseNoticeDialog" aria-labelledby="firstUseNoticeTitle" onCancel={dialog.onCancel} onClick={dialog.onClick}>
    <article className="first-use-notice-window"><header><h1 id="firstUseNoticeTitle">{t('firstUseNotice.title')}</h1><button id="firstUseNoticeClose" type="button" aria-label={t('firstUseNotice.close')} onClick={dialog.requestClose}>×</button></header>
      <div ref={content} className="first-use-notice-text" id="firstUseNoticeText"/>
      <footer><button className="edge-drawer-swipe-hint" id="firstUseNoticeCloseHint" type="button" aria-label={t('firstUseNotice.close')} onClick={dialog.requestClose}><span>{t('firstUseNotice.swipeToClose')}</span><span className="edge-drawer-swipe-visual"><svg viewBox="0 0 280 26"><path d="M6 13h260m-10-9 10 9-10 9"/></svg></span></button></footer>
    </article>
  </dialog>;
}
