/** Test-only constructor facades. Content and sanitization remain production-owned. */
import {createRef, useEffect, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FirstUseNotice, type FirstUseNoticeHandle} from '../../app/components/notices/FirstUseNotice';
import {MultiplayerGuideDialog} from '../../app/components/notices/MultiplayerGuideDialog';

function originalPlaceholder(id: string) {
  const placeholder = document.getElementById(id);
  if (!placeholder) throw new Error(`Original content carrier is missing #${id}`);
  const host = document.createElement('div'); placeholder.replaceWith(host);
  return host;
}

export function createFirstUseNoticeController({fetchImpl = fetch, storage}: {fetchImpl?: typeof fetch; storage?: Pick<Storage, 'getItem' | 'setItem'> | null} = {}) {
  const root = createRoot(originalPlaceholder('firstUseNoticeDialog'));
  const ref = createRef<FirstUseNoticeHandle>(); let open = false;
  const render = () => flushSync(() => root.render(<FirstUseNotice ref={ref} open={open} fetchImpl={fetchImpl} storage={storage}
    onOpenRequest={() => {open = true; render();}} onCloseRequest={() => {open = false; render();}}/>));
  render();
  window.addEventListener('pagehide', () => root.unmount(), {once: true});
  return {showManual: () => ref.current!.showManual(), close: () => ref.current!.close()};
}

/** Parent passive effects run after the actual guide's loading effect. This
 * bridges its committed load to the original awaited show() interface without
 * adding a delay, replacing content, or claiming that fetch completion is render. */
function AfterGuideEffects({onCommit, children}: {onCommit(): void; children: ReactNode}) {
  useEffect(onCommit);
  return children;
}

export function createMultiplayerGuideController({getGameId = () => 'th07', fetchImpl = fetch}: {getGameId?: () => string; fetchImpl?: typeof fetch} = {}) {
  const host = originalPlaceholder('mpGuideDialog'), root = createRoot(host);
  let open = false;
  let latestLoad: Promise<void> | null = null;
  const pending = new Set<{observer: MutationObserver; reject(error: Error): void}>();
  const observedFetch: typeof fetch = (...args) => {
    const content = host.querySelector('#mpGuideContent');
    if (!content) throw new Error('Original guide carrier content container is missing');
    // The production load replaces the actual content on success or failure.
    // Observe that commit, not the expected payload or sanitizer result.
    latestLoad = new Promise<void>((resolve, reject) => {
      const record = {observer: new MutationObserver(() => {record.observer.disconnect(); pending.delete(record); resolve();}), reject};
      pending.add(record); record.observer.observe(content, {childList: true});
    });
    // Keep cleanup rejection handled even if page teardown precedes show await.
    void latestLoad.catch(() => {});
    return fetchImpl(...args);
  };
  function render(onCommit: () => void = () => {}) {
    flushSync(() => root.render(<AfterGuideEffects onCommit={onCommit}><MultiplayerGuideDialog open={open} gameId={getGameId()} fetchImpl={observedFetch}
      onCloseRequest={() => {open = false; render();}}/></AfterGuideEffects>));
  }
  render();
  window.addEventListener('pagehide', () => {
    root.unmount();
    for (const record of pending) {record.observer.disconnect(); record.reject(new Error('Original guide carrier unmounted'));}
    pending.clear();
  }, {once: true});
  return {show(): Promise<void> {
    return new Promise((resolve, reject) => {
      open = true;
      render(() => {
        if (!latestLoad) {reject(new Error('Original guide carrier did not start its production load')); return;}
        void latestLoad.then(resolve, reject);
      });
    });
  }};
}
