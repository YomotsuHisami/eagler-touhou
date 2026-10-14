import {type ProductId} from '../../src/contracts/product-catalog.mts';
import {MAX_SCORE_BYTES} from '../../src/launcher/score-dat.mts';
import {createSaveLibraryStorage, SaveLibraryError, type SaveLibraryErrorCode, type SaveArchive, type SaveLibraryStorage, type SaveBinding, type SaveBackup} from '../services/save-library';
import {readStoredScore, supportsScore, type StoredScore} from '../services/score-storage';

export interface SaveLibrarySnapshot {
  product: ProductId | null;
  phase: 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported';
  entries: readonly SaveArchive[];
  current: StoredScore | null;
  currentPhase: 'loading' | 'ready' | 'empty' | 'unavailable' | 'busy';
  busy: boolean;
  runtimeBusy: boolean;
  binding: SaveBinding | null;
  backups: readonly SaveBackup[];
  error: SaveLibraryErrorCode | null;
  result: 'added' | 'duplicate' | 'renamed' | 'deleted' | 'selected' | 'recovered' | null;
}
/** Dialog-owned selection over document-lived storage. Native saves are read
 * only; imported archives cannot change the file consumed by a game. */
export function createSaveLibrary({storage = createSaveLibraryStorage(), read = readStoredScore, download, onChange, recover}: {storage?: SaveLibraryStorage; read?: typeof readStoredScore; download?(name: string, bytes: ArrayBuffer, mime: string): void; onChange?(product: ProductId): void; recover?(product: ProductId, action: 'keep' | 'restore'): Promise<boolean | void>} = {}) {
  const listeners = new Set<() => void>();
  const empty = (): SaveLibrarySnapshot => ({product: null, phase: 'idle', entries: [], current: null, currentPhase: 'empty', busy: false, runtimeBusy: suspended, binding: null, backups: [], error: null, result: null});
  let suspended = false;
  let snapshot = empty(), serial = 0, language = 'ja', disposed = false;
  const publish = (next: SaveLibrarySnapshot) => {if (!disposed) {snapshot = Object.freeze(next); listeners.forEach(listener => listener());}};
  const owns = (ticket: number, product: ProductId) => !disposed && ticket === serial && snapshot.product === product;
  async function refresh() {
    const product = snapshot.product;
    if (!product || disposed || !supportsScore(product) || snapshot.busy) return;
    const ticket = ++serial;
    publish({...snapshot, phase: 'loading', currentPhase: suspended ? 'busy' : 'loading', current: null});
    const [entries, current, binding, backups] = await Promise.allSettled([storage.list(product), suspended ? Promise.resolve(null) : read(product, language), storage.state(product), storage.backups(product)]);
    if (!owns(ticket, product)) return;
    publish({...snapshot, phase: entries.status === 'fulfilled' && binding.status === 'fulfilled' && backups.status === 'fulfilled' ? 'ready' : 'unavailable', binding: binding.status === 'fulfilled' ? binding.value : null, backups: backups.status === 'fulfilled' ? backups.value : [], entries: entries.status === 'fulfilled' ? entries.value : [], current: current.status === 'fulfilled' && !suspended ? current.value : null, currentPhase: suspended ? 'busy' : current.status === 'rejected' ? 'unavailable' : current.value ? 'ready' : 'empty'});
  }
  async function mutate(action: (product: ProductId) => Promise<SaveLibrarySnapshot['result']>) {
    const product = snapshot.product;
    if (disposed || !product || snapshot.busy) return;
    const ticket = ++serial;
    publish({...snapshot, busy: true, error: null, result: null});
    try {
      const result = await action(product);
      const selected = result === 'selected' ? await storage.state(product) : undefined;
      onChange?.(product);
      if (owns(ticket, product)) {publish({...snapshot, busy: false, result, ...(selected ? {binding: selected} : {})}); await refresh();}
    } catch (error) {if (owns(ticket, product)) publish({...snapshot, busy: false, error: error instanceof SaveLibraryError ? error.code : 'storage'});}
  }
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    select(product: ProductId, preferredLanguage: string) {
      if (disposed || snapshot.product === product && preferredLanguage === language) return;
      serial++; language = preferredLanguage;
      publish({...empty(), product, phase: supportsScore(product) ? 'loading' : 'unsupported'}); void refresh();
    },
    clear(product?: ProductId) {if (product && snapshot.product !== product) return; serial++; publish(empty());},
    refresh,
    invalidate(product?: ProductId) {if (!product || snapshot.product === product) void refresh();},
    suspend(value: boolean) {
      if (suspended === value || disposed) return;
      suspended = value;
      publish({...snapshot, runtimeBusy: value});
      // Archive work is independent of Runtime work; do not cancel a pending
      // archive mutation merely because a native file operation starts.
      if (!snapshot.busy) void refresh();
    },
    importFile(file: {name: string; size: number; arrayBuffer(): Promise<ArrayBuffer>}) {
      return mutate(async product => {
        if (!/\.dat$/i.test(file.name) || file.size <= 0 || file.size > MAX_SCORE_BYTES) throw new SaveLibraryError('invalid');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await storage.add(product, file.name.replace(/\.dat$/i, '').slice(0, 80), file.name, bytes);
        return result.duplicate ? 'duplicate' : 'added';
      });
    },
    capture() {
      return mutate(async product => {
        if (suspended) throw new SaveLibraryError('busy');
        const current = await read(product, language);
        if (suspended) throw new SaveLibraryError('busy');
        if (!current) throw new SaveLibraryError('missing');
        const result = await storage.add(product, `${product}-${new Date().toISOString().replace(/[:.]/g, '-')}`, `${product}.dat`, current.bytes);
        return result.duplicate ? 'duplicate' : 'added';
      });
    },
    rename(id: string, name: string) {return mutate(async product => {await storage.rename(product, id, name); return 'renamed';});},
    remove(id: string) {return mutate(async product => {if(suspended)throw new SaveLibraryError('busy');await storage.remove(product,id);return 'deleted';});},
    choose(id: string | null) {return mutate(async product => {if (suspended) throw new SaveLibraryError('busy'); await storage.choose(product, id); return 'selected';});},
    recover(action: 'keep' | 'restore') {return mutate(async product => {if (suspended) throw new SaveLibraryError('busy'); if (!recover) throw new SaveLibraryError('unsupported'); return await recover(product, action) === false ? null : 'recovered';});},
    downloadBackup(id: string, kind: 'before' | 'archive' = 'before') {
      const backup = snapshot.backups.find(entry => entry.id === id && entry.product === snapshot.product);
      const data = kind === 'archive' ? backup?.archiveBytes : backup?.bytes;
      if (!data || !download || snapshot.busy) {publish({...snapshot, error: 'download'}); return;}
      try {const bytes = new Uint8Array(data); download(`${backup!.product}-backup-${kind}-${id}.dat`, bytes.buffer, 'application/octet-stream');} catch {publish({...snapshot, error: 'download'});}
    },
    download(id: string) {
      if (disposed || snapshot.busy) return;
      const entry = snapshot.entries.find(entry => entry.id === id && entry.product === snapshot.product);
      if (!entry) {publish({...snapshot, error: 'missing'}); return;}
      try {
        if (!download) throw new Error('Download port missing');
        const bytes = new Uint8Array(entry.bytes);
        download(`${entry.product}-${entry.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.dat`, bytes.buffer, 'application/octet-stream');
      } catch {publish({...snapshot, error: 'download'});}
    },
    dispose() {disposed = true; serial++; listeners.clear();},
  };
}
export type SaveLibraryModel = ReturnType<typeof createSaveLibrary>;
