import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {MAX_SCORE_BYTES} from '../../src/launcher/score-dat.mts';
import {SaveLibraryError, sameSaveBytes, type SaveLibraryStorage, type SaveRun, type SaveBackup} from './save-library';
import {readStoredScore, supportsScore} from './score-storage';
import type {RuntimeService} from './runtime';
import type {RuntimeResponseMessage} from '../../src/contracts/runtime-protocol.mts';

type Edition = SaveBackup['edition'];
function bytes(response: RuntimeResponseMessage) {
  if (!Array.isArray(response.bytes) || response.bytes.length > MAX_SCORE_BYTES || !response.bytes.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new SaveLibraryError('invalid');
  return Uint8Array.from(response.bytes as number[]);
}
function missing(error: unknown) {return !!error && typeof error === 'object' && 'errno' in error && error.errno === 44;}

/** The Runtime remains the IDBFS writer. The ledger/backup commit happens before
 * its first write; verified durable bytes are the only source of slot updates. */
export function createSaveSlotRunner({storage, runtime, locks, read = readStoredScore, onChange}: {
  storage: SaveLibraryStorage; runtime(): RuntimeService; locks?: LockManager;
  read?: typeof readStoredScore; onChange?(product: ProductId): void;
}) {
  let lease: {product: ProductId; release(): void} | null = null;
  let active: {product: ProductId; run: SaveRun; started: boolean} | null = null;
  let acquiring: Promise<void> | null = null;
  let finishing: Promise<void> | null = null;
  let disposed = false;
  async function acquire(product: ProductId) {
    if (!supportsScore(product)) return;
    if (disposed) throw new SaveLibraryError('busy');
    if (lease) {if (lease.product !== product) throw new SaveLibraryError('busy'); return;}
    if (acquiring) {await acquiring; if ((lease as {product: ProductId; release(): void} | null)?.product !== product) throw new SaveLibraryError('busy'); return;}
    if (!locks) {
      const state = await storage.state(product);
      if (state.selectedId || state.run) throw new SaveLibraryError('unsupported');
      return;
    }
    const task = new Promise<void>((resolve, reject) => {
      void locks.request(`eagler-touhou-native-save:${product}`, {ifAvailable: true}, lock => {
        if (!lock || disposed) {reject(new SaveLibraryError('busy')); return;}
        return new Promise<void>(release => {lease = {product, release}; resolve();});
      }).catch(reject);
    });
    acquiring = task;
    try {await task;} finally {if (acquiring === task) acquiring = null;}
  }
  function release() {const current = lease; lease = null; current?.release();}
  function releaseIfIdle() {if (runtime().getSnapshot().epoch === null) release();}
  async function durable(product: ProductId, edition: Edition) {
    return read(product, edition === 'chs' ? 'lang_zh-hans' : 'ja', undefined, 8000, edition ?? undefined);
  }
  async function apply(product: ProductId, edition: Edition, expectedChoice?: string | null) {
    if (!supportsScore(product)) return;
    await acquire(product);
    const selected = await storage.state(product);
    if (expectedChoice !== undefined && selected.selectedId !== expectedChoice) throw new SaveLibraryError('conflict');
    if (selected.run) throw new SaveLibraryError('pending');
    if (!selected.selectedId) return;
    const owner = runtime(), path = PRODUCT_GAMES[gameIdForProduct(product)].storage.scoreFile;
    await owner.withFileSession(gameIdForProduct(product), async access => {
      await access.sync();
      let before: Uint8Array | null;
      try {before = bytes(await access.send('read', {path}));} catch (error) {if (!missing(error)) throw error; before = null;}
      const saved = await storage.begin(product, selected.selectedId!, before, edition);
      active = {product, run: saved.run, started: false}; onChange?.(product);
      try {
        await access.send('write', {path, bytes: Array.from(saved.archive.bytes)});
        await access.sync();
        const persisted = await durable(product, edition);
        if (!persisted || !sameSaveBytes(persisted.bytes, saved.archive.bytes)) throw new SaveLibraryError('verify');
        const native = bytes(await access.send('read', {path}));
        if (!sameSaveBytes(native, saved.archive.bytes)) throw new SaveLibraryError('verify');
      } catch (error) {
        // The same exclusive native owner may restore immediately. Loss of that
        // owner leaves the committed ledger/backup for explicit recovery.
        try {
          if (before === null) {try {await access.send('remove', {path});} catch (failure) {if (!missing(failure)) throw failure;}}
          else await access.send('write', {path, bytes: Array.from(before)});
          await access.sync();
          const restored = await durable(product, edition);
          if (before === null ? restored !== null : !restored || !sameSaveBytes(before, restored.bytes)) throw new SaveLibraryError('verify');
          await storage.complete(product, saved.run.id, null); active = null;
        } catch {await storage.stage(product, saved.run.id, 'pending').catch(() => {});}
        onChange?.(product); throw error;
      }
    }, {runtimeVariant: 'normal'});
  }
  async function launched(product: ProductId) {
    if (active?.product !== product) return;
    const captured = active; captured.started = true;
    try {await storage.stage(product, captured.run.id, 'running');} catch (error) {if (active === captured) throw error;}
    onChange?.(product);
  }
  function finish(saved = true): Promise<void> {
    if (finishing) return finishing;
    const captured = active;
    if (!captured) {releaseIfIdle(); return Promise.resolve();}
    const task = (async () => {
      try {
        if (!saved || !captured.started) {await storage.stage(captured.product, captured.run.id, 'pending'); return;}
        const stored = await durable(captured.product, captured.run.edition);
        if (!stored) throw new SaveLibraryError('missing');
        await storage.complete(captured.product, captured.run.id, stored.bytes);
      } catch (error) {
        await storage.stage(captured.product, captured.run.id, 'pending').catch(() => {});
        throw error;
      } finally {if (active === captured) active = null; releaseIfIdle(); onChange?.(captured.product);}
    })();
    finishing = task;
    void task.finally(() => {if (finishing === task) finishing = null;}).catch(() => {});
    return task;
  }
  async function recover(product: ProductId, action: 'keep' | 'restore', prepare: (product: ProductId, edition: Edition) => Promise<Edition>) {
    await acquire(product);
    try {
      if (runtime().getSnapshot().launched) throw new SaveLibraryError('busy');
      const state = await storage.state(product), run = state.run;
      if (!run) return;
      if (action === 'keep') {
        const current = await durable(product, run.edition);
        if (!current) throw new SaveLibraryError('missing');
        await storage.complete(product, run.id, current.bytes);
      } else {
        const backup = await storage.backup(product, run.id);
        if (await prepare(product, run.edition) !== run.edition) throw new SaveLibraryError('verify');
        const path = PRODUCT_GAMES[gameIdForProduct(product)].storage.scoreFile;
        await runtime().withFileSession(gameIdForProduct(product), async access => {
          if (backup.bytes === null) {try {await access.send('remove', {path});} catch (error) {if (!missing(error)) throw error;}}
          else await access.send('write', {path, bytes: Array.from(backup.bytes)});
          await access.sync();
          const actual = await durable(product, run.edition);
          if (backup.bytes === null ? actual !== null : !actual || !sameSaveBytes(backup.bytes, actual.bytes)) throw new SaveLibraryError('verify');
          await storage.complete(product, run.id, null);
        }, {runtimeVariant: 'normal'});
      }
      active = null; onChange?.(product);
    } finally {releaseIfIdle();}
  }
  return {
    acquire, apply, launched, finish, recover, releaseIfIdle,
    acknowledged(product: ProductId) {if (active?.product === product) active.started = true;},
    async assertResolved(product: ProductId) {if (supportsScore(product) && (await storage.state(product)).run && !(active?.product === product && active.started)) throw new SaveLibraryError('pending');},
    async fileOperation<T>(product: ProductId, operation: () => Promise<T>): Promise<T> {
      if (!supportsScore(product)) return operation();
      await acquire(product);
      try {await this.assertResolved(product); return await operation();} finally {releaseIfIdle();}
    },
    dispose() {disposed = true; release();},
  };
}
export type SaveSlotRunner = ReturnType<typeof createSaveSlotRunner>;
