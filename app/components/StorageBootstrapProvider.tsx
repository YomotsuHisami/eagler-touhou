import {useEffect, useRef, type ReactNode} from 'react';
import {useDocumentRequestFetch} from './DocumentRequestProvider';

interface MaintenancePort {startBackground(): Promise<unknown>; dispose(): void}
/** The scheduler and Package port are injected for document-lifecycle tests. */
export function createStorageBootstrapDocumentOwner(options: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  schedule(callback: () => void): () => void;
  load(): Promise<() => MaintenancePort>;
  onError(error: unknown): void;
}) {
  let attached = false, active = true, disposed = false, serial = 0;
  let cancel: (() => void) | null = null, port: MaintenancePort | null = null;
  let loading: Promise<() => MaintenancePort> | null = null;
  function activate() {
    if (!attached || !active || disposed || cancel || port) return;
    const ticket = ++serial;
    cancel = options.schedule(() => {
      cancel = null;
      if (!attached || !active || disposed || serial !== ticket) return;
      const task = loading ?? (loading = Promise.resolve().then(options.load));
      void task.then(create => {
        if (!attached || !active || disposed || serial !== ticket) return;
        port = create();
        return port.startBackground();
      }).catch(error => {
        if (loading === task) loading = null;
        if (attached && active && !disposed && serial === ticket) options.onError(error);
      });
    });
  }
  const hide = () => {active = false; serial++; cancel?.(); cancel = null; port?.dispose(); port = null;};
  const show = () => {active = true; activate();};
  function detach() {
    if (!attached) return;
    attached = false; serial++; cancel?.(); cancel = null;
    options.target.removeEventListener('pagehide', hide); options.target.removeEventListener('pageshow', show);
  }
  return Object.freeze({
    attach() {if (attached || disposed) return; attached = true; options.target.addEventListener('pagehide', hide); options.target.addEventListener('pageshow', show); activate();},
    detach,
    dispose() {if (disposed) return; disposed = true; detach(); port?.dispose(); port = null;},
  });
}

/** Compatibility is maintenance after first paint, never a boot prerequisite.
 * Explicit game requests share the coordinator and wait only for their game.
 */
export function StorageBootstrapProvider({children}: {children: ReactNode}) {
  const fetchImpl = useDocumentRequestFetch();
  const retained = useRef<ReturnType<typeof createStorageBootstrapDocumentOwner> | null>(null), epoch = useRef(0);
  useEffect(() => {
    const effect = ++epoch.current;
    const baseUrl = new URL(import.meta.env.BASE_URL, location.origin).href;
    const owner = retained.current ?? createStorageBootstrapDocumentOwner({target: window,
      schedule(callback) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const frame = requestAnimationFrame(() => {timer = setTimeout(callback, 0);});
        return () => {cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer);};
      },
      load: async () => {
        const {documentStorageBootstrap, disposeDocumentStorageBootstrap} = await import('../services/storage-bootstrap.client');
        return () => ({startBackground: () => documentStorageBootstrap({baseUrl, fetchImpl}).startBackground(),
          dispose: () => disposeDocumentStorageBootstrap(baseUrl)});
      },
      onError: error => console.warn('Local Package compatibility maintenance was deferred', error),
    });
    retained.current = owner; owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});
    };
  }, [fetchImpl]);
  return children;
}
