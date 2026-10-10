import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {createReplayMutationQueue, isReplayFilePath, isValidReplayName, isReplayTargetAvailable,
  type ReplayMutationQueue} from '../../src/launcher/replay-files.mts';
import type {RuntimeService, RuntimeFileSession} from '../services/runtime';
import type {RuntimeResponseMessage} from '../../src/contracts/runtime-protocol.mts';
import type {SettingsDecision} from '../components/settings/types';

export interface ReplayRow {readonly path: string; readonly name: string; readonly size: number}
export interface ReplaySnapshot {
  readonly open: boolean;
  readonly phase: 'idle' | 'loading' | 'ready' | 'error';
  readonly productId: ProductId | null;
  readonly rows: readonly ReplayRow[];
  readonly animateRows: boolean;
}
export interface ReplayModelOptions {
  runtime: RuntimeService;
  prepareFiles(product: ProductId): Promise<void>;
  /** Host must recheck product/epoch before retiring an owned idle preload. */
  releasePrepared(product: ProductId, epoch: number): Promise<void>;
  translate(key: string, params?: Record<string, string | number>): string;
  prompt(message: string, initial: string): string | null | Promise<string | null>;
  confirm(decision: SettingsDecision): Promise<boolean>;
  download(name: string, bytes: ArrayBuffer, mime: string): void;
  toast(message: string): void;
  afterPaint(): Promise<void>;
  afterClose(): void;
  mutations?: ReplayMutationQueue;
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && !Array.isArray(error) && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error ?? '');
}
export const formatReplayBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Original Replay manager state. The dialog view owns only presentation and
 * calls close after its original exit animation/native-dialog close completes. */
export function createReplayModel(options: ReplayModelOptions) {
  const {runtime, translate: t} = options;
  const mutations = options.mutations ?? createReplayMutationQueue();
  const listeners = new Set<() => void>();
  let snapshot: ReplaySnapshot = Object.freeze({open: false, phase: 'idle', productId: null, rows: [], animateRows: false});
  let generation = 0, readVersion = 0, disposed = false;
  let ownsRuntime = false;
  function publish(patch: Partial<ReplaySnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch});
    for (const listener of listeners) listener();
  }
  function valid(token: number, product: ProductId) {return !disposed && snapshot.open && generation === token && snapshot.productId === product;}
  function responseBytes(response: RuntimeResponseMessage): number[] {
    if (!Array.isArray(response.bytes) || !response.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error(t('runtime.invalidFileContent'));
    return response.bytes as number[];
  }
  function responseFiles(response: RuntimeResponseMessage): ReplayRow[] {
    if (!Array.isArray(response.files)) throw new Error(t('runtime.invalidFileList'));
    return response.files.map(value => {
      if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string' || !value.path) throw new Error(t('runtime.invalidFileEntry'));
      return {path: value.path, name: value.path.split('/').pop() || value.path,
        size: Math.max(0, Number('size' in value ? value.size : 0) || 0)};
    });
  }
  async function withFiles<T>(product: ProductId, operation: (access: RuntimeFileSession) => Promise<T>, mutation = false): Promise<T> {
    await options.prepareFiles(product);
    return runtime.withFileSession(gameIdForProduct(product), operation, {
      runtimeVariant: isMultiplayerProductId(product) ? 'multiplayer' : 'normal',
      readOnly: !mutation, replayMutation: mutation,
    });
  }
  async function cleanup(product: ProductId, epoch: number | null, token: number): Promise<void> {
    await mutations.idle();
    if (disposed || snapshot.open || generation !== token || epoch === null) return;
    const current = runtime.getSnapshot();
    if (!current.launched && current.epoch === epoch && current.game === gameIdForProduct(product)) await options.releasePrepared(product, epoch);
  }
  async function refresh({animateRows = false}: {animateRows?: boolean} = {}): Promise<void> {
    const product = snapshot.productId, token = generation, version = ++readVersion;
    if (!product || !snapshot.open || disposed) return;
    const ownedAtStart = ownsRuntime;
    let acquiredEpoch: number | null = null;
    try {
      const rows = await withFiles(product, async access => {
        acquiredEpoch = access.epoch;
        await access.sync();
        return responseFiles(await access.send('list', {})).filter(file => isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
      });
      if (valid(token, product) && readVersion === version) publish({phase: 'ready', rows: Object.freeze(rows), animateRows});
    } finally {
      // A dialog can close while its cold native preload is still preparing.
      // Retire only the epoch actually acquired by this read, never a newer game.
      if (ownedAtStart && !snapshot.open && generation === token + 1 && acquiredEpoch !== null) {
        void cleanup(product, acquiredEpoch, generation).catch(error => {
          if (!snapshot.open && generation === token + 1) options.toast(t('replay.operationFailed', {reason: errorMessage(error)}));
        });
      }
    }
  }
  async function open(product: ProductId): Promise<void> {
    if (disposed) return;
    const token = ++generation;
    const current = runtime.getSnapshot();
    ownsRuntime = ownsRuntime || (!current.ready && current.epoch === null);
    publish({open: true, phase: 'loading', productId: product, rows: [], animateRows: false});
    await options.afterPaint();
    if (!valid(token, product)) return;
    try {await refresh({animateRows: true});}
    catch (error) {
      if (valid(token, product)) publish({phase: 'error', rows: [], animateRows: false});
      throw error;
    }
  }
  function close(): void {
    if (!snapshot.open || disposed) return;
    const product = snapshot.productId;
    const token = ++generation;
    const epoch = runtime.getSnapshot().epoch;
    const release = ownsRuntime;
    ownsRuntime = false;
    publish({open: false});
    if (release && product) {
      void cleanup(product, epoch, token).catch(error => options.toast(t('replay.operationFailed', {reason: errorMessage(error)}))).finally(options.afterClose);
    } else options.afterClose();
  }
  async function download(path: string): Promise<void> {
    const product = snapshot.productId, token = generation;
    if (!product || !valid(token, product)) return;
    try {
      const content = await withFiles(product, async access => responseBytes(await access.send('read', {path})));
      if (!valid(token, product)) return;
      const bytes = new Uint8Array(content);
      options.download(path.split('/').pop() || 'replay.rpy', bytes.buffer, 'application/octet-stream');
    } catch (error) {if (valid(token, product)) options.toast(t('replay.downloadFailed', {reason: errorMessage(error)}));}
  }
  async function rename(path: string, suppliedName?: string): Promise<void> {
    const product = snapshot.productId, token = generation;
    if (!product || !valid(token, product)) return;
    try {
      const name = path.split('/').pop() || path;
      const renamed = suppliedName ?? await options.prompt(t('replay.renamePrompt'), name);
      if (renamed === null || !valid(token, product)) return;
      if (!renamed.trim()) throw new Error(t('replay.nameEmpty'));
      const prefix = PRODUCT_GAMES[gameIdForProduct(product)].replay?.prefix;
      if (!prefix) throw new Error(t('replay.unsupported'));
      if (!isValidReplayName(prefix, renamed.trim())) throw new Error(t('replay.nameInvalid', {prefix}));
      const target = `replay/${renamed.trim()}`;
      if (target.toLowerCase() === path.toLowerCase()) return;
      await mutations.run(async () => {
        // Once the user committed this mutation, closing the manager waits for
        // its queue; it must not silently cancel the requested file operation.
        if (disposed) return;
        await withFiles(product, async access => {
          await access.sync();
          const currentPaths = responseFiles(await access.send('list', {})).map(file => file.path);
          if (!isReplayTargetAvailable(currentPaths, target)) throw new Error(t('replay.nameExists'));
          const content = responseBytes(await access.send('read', {path}));
          await access.send('write', {path: target, bytes: content});
          await access.send('remove', {path});
        }, true);
      });
      if (valid(token, product)) await refresh();
    } catch (error) {if (valid(token, product)) options.toast(t('replay.operationFailed', {reason: errorMessage(error)}));}
  }
  async function remove(path: string): Promise<void> {
    const product = snapshot.productId, token = generation;
    if (!product || !valid(token, product)) return;
    try {
      if (!await options.confirm({message: t('replay.deleteConfirm', {name: path.split('/').pop() || path}), confirmText: t('action.delete'), tone: 'danger'})) return;
      if (!valid(token, product)) return;
      await mutations.run(async () => {
        // Once the user committed this mutation, closing the manager waits for
        // its queue; it must not silently cancel the requested file operation.
        if (disposed) return;
        await withFiles(product, async access => {await access.send('remove', {path});}, true);
      });
      if (valid(token, product)) await refresh();
    } catch (error) {if (valid(token, product)) options.toast(t('replay.deleteFailed', {reason: errorMessage(error)}));}
  }
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot, isOpen: () => snapshot.open,
    open, refresh, close, download, rename, remove, mutations,
    dispose() {disposed = true; generation++; listeners.clear();},
  };
}
export type ReplayModel = ReturnType<typeof createReplayModel>;
