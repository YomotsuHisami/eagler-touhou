import type {MetadataService} from './metadata';

export interface MetadataRetryOptions {
  metadata: Pick<MetadataService, 'getSnapshot' | 'subscribe' | 'initialize'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;
  shell: {setRemoteState(state: 'ready' | 'unavailable' | 'retrying', error?: unknown): void; checkForUpdate(): Promise<unknown>};
  /** Original delayed selection/render boundary; owner keeps current selection,
   * launched state and Host subset policy. This owner invents no fallback. */
  onSettled(): void;
  markBoot?(phase: string): void;
}
/** Main app1536–1587: offline/online/focus retry, independently from local
 * package readiness. A failed Host alone does not mark a successful catalog
 * unavailable; the original status banner is catalog-owned. */
export function createMetadataRetry(options: MetadataRetryOptions) {
  const {metadata, window: win, shell} = options;
  let disposed = false, remoteState: 'unknown' | 'ready' | 'unavailable' | 'retrying' = 'unknown';
  let remoteError: unknown = null, hostError: unknown = null;
  const timers = new Set<number>();
  let lastReady = false, lastResult: readonly unknown[] | null = null;
  const settled = () => {
    if (disposed) return;
    const snapshot = metadata.getSnapshot();
    if (snapshot.phase !== 'ready') {lastReady = false; return;}
    const result = [snapshot.hostManifest, snapshot.releaseCatalog, snapshot.hostManifestError, snapshot.releaseCatalogError];
    if (lastReady && lastResult?.every((value, index) => value === result[index])) return;
    lastReady = true; lastResult = result;
    remoteError = snapshot.releaseCatalogError; hostError = snapshot.hostManifestError;
    remoteState = remoteError ? 'unavailable' : 'ready'; shell.setRemoteState(remoteState, remoteError);
    options.markBoot?.(remoteError ? 'catalog-unavailable' : 'catalog-ok');
    const timer = win.setTimeout(() => {timers.delete(timer); if (!disposed) options.onSettled();}, 0); timers.add(timer);
  };
  async function refresh() {
    if (disposed) return;
    options.markBoot?.('catalog-request');
    await metadata.initialize();
  }
  function retry() {
    if (disposed) return;
    if (remoteState === 'unavailable' || remoteError || hostError) {
      if (remoteState === 'unavailable' || remoteError) {remoteState = 'retrying'; shell.setRemoteState('retrying', remoteError);}
      void refresh();
    }
    void shell.checkForUpdate();
  }
  const offline = () => {
    if (disposed) return;
    remoteError ||= new Error('offline');
    if (!metadata.getSnapshot().hostManifest) hostError ||= new Error('offline');
    remoteState = 'unavailable'; shell.setRemoteState('unavailable', remoteError);
  };
  const focus = () => {if (disposed) return; if (remoteError || hostError) retry(); else void shell.checkForUpdate();};
  const unsubscribe = metadata.subscribe(settled);
  win.addEventListener('offline', offline); win.addEventListener('online', retry); win.addEventListener('focus', focus);
  if (metadata.getSnapshot().phase === 'ready') settled();
  return {
    initialize: refresh, retry,
    dispose() {disposed = true; unsubscribe(); win.removeEventListener('offline', offline); win.removeEventListener('online', retry); win.removeEventListener('focus', focus); for (const timer of timers) win.clearTimeout(timer); timers.clear();},
  };
}
