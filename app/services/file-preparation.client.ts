import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeService, RuntimeSnapshot} from './runtime.client';

export interface ProductRuntimeFileIdentity {
  readonly productId: ProductId;
  readonly game: GameId;
  readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly saveRoot: string;
  readonly scoreFile: string;
}

/** The game id alone is not a file-owner identity: ordinary and MP Runtime
 * owners can share a game id while belonging to different runtime variants. */
export function productRuntimeFileIdentity(productId: ProductId): ProductRuntimeFileIdentity {
  const game = gameIdForProduct(productId), storage = PRODUCT_GAMES[game].storage;
  return Object.freeze({productId, game, runtimeVariant: isMultiplayerProductId(productId) ? 'multiplayer' : 'normal',
    saveRoot: storage.saveRoot, scoreFile: storage.scoreFile});
}

export function runtimeMatchesProductFileIdentity(live: RuntimeSnapshot, identity: ProductRuntimeFileIdentity): boolean {
  return live.game === identity.game && live.runtimeVariant === identity.runtimeVariant &&
    live.saveRoot === identity.saveRoot && live.scoreFile === identity.scoreFile;
}

export interface FilePreparationResult {
  readonly identity: ProductRuntimeFileIdentity;
  readonly epoch: number;
}
export type FileProductPreparer = (productId: ProductId, signal: AbortSignal) => Promise<unknown>;
export interface FilePreparationSnapshot {
  readonly phase: 'idle' | 'preparing' | 'error';
  readonly canPrepare: boolean;
  readonly productId: ProductId | null;
  readonly epoch: number | null;
  readonly error: string | null;
}
type RuntimePort = Pick<RuntimeService, 'getSnapshot'>;
const initial = (): FilePreparationSnapshot => Object.freeze({phase: 'idle', canPrepare: false, productId: null, epoch: null, error: null});
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * A narrow bridge from root-owned file managers to the existing launch job.
 * It can prepare the current product, but it never owns a package or Runtime
 * and never starts gameplay.
 */
export function createFilePreparationController({runtimeService: runtime}: {runtimeService: RuntimePort}) {
  let disposed = false, registration = 0, preparer: FileProductPreparer | null = null;
  let active: {productId: ProductId; controller: AbortController; promise: Promise<FilePreparationResult>} | null = null;
  let snapshot = initial();
  const listeners = new Set<() => void>();
  function publish(next: FilePreparationSnapshot) {
    if (disposed) return;
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }
  function liveFor(productId: ProductId): FilePreparationResult | null {
    const identity = productRuntimeFileIdentity(productId), live = runtime.getSnapshot();
    return runtimeMatchesProductFileIdentity(live, identity) && live.epoch !== null && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable
      ? Object.freeze({identity, epoch: live.epoch}) : null;
  }
  function assertReady(productId: ProductId): FilePreparationResult {
    const result = liveFor(productId);
    if (!result) {
      const live = runtime.getSnapshot();
      if (live.fileOperationBusy) throw new Error('请等待当前 Runtime 文件操作完成。');
      if (live.saveUnavailable) throw new Error('当前 Runtime 已失去保存能力，请先处理退出提示。');
      if (live.launched || ['launching', 'running', 'saving'].includes(live.phase)) throw new Error('请先结束游戏并完成保存，再准备此作品的文件服务。');
      const identity = productRuntimeFileIdentity(productId);
      if (live.game === identity.game && live.runtimeVariant !== identity.runtimeVariant) throw new Error('当前 Runtime 的普通/多人文件身份与所选作品不一致。');
      throw new Error(`尚未准备 ${identity.game.toUpperCase()} 的文件服务。`);
    }
    return result;
  }
  function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('File preparation request cancelled', 'AbortError'));
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException('File preparation request cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, {once: true});
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    registerPreparer(next: FileProductPreparer) {
      if (disposed) throw new Error('File preparation controller is disposed');
      const id = ++registration;
      preparer = next;
      publish({...snapshot, canPrepare: true, error: null});
      return () => {
        if (registration !== id) return;
        preparer = null;
        publish({...snapshot, canPrepare: false});
      };
    },
    async ensurePrepared(productId: ProductId, signal?: AbortSignal): Promise<FilePreparationResult> {
      if (disposed) throw new Error('文件准备服务已关闭。');
      if (signal?.aborted) throw new DOMException('File preparation request cancelled', 'AbortError');
      const current = liveFor(productId);
      if (current) return current;
      const identity = productRuntimeFileIdentity(productId), live = runtime.getSnapshot();
      if (live.fileOperationBusy) throw new Error('请等待当前 Runtime 文件操作完成。');
      if (live.game === identity.game && live.runtimeVariant !== identity.runtimeVariant) throw new Error('当前 Runtime 的普通/多人文件身份与所选作品不一致。');
      if (live.launched || ['launching', 'running', 'saving'].includes(live.phase)) throw new Error('请先结束游戏并完成保存，再准备文件服务。');
      if (active) {
        if (active.productId !== productId) throw new Error('另一个作品正在准备，请等待或取消后重试。');
        return withSignal(active.promise, signal);
      }
      if (!preparer) throw new Error('作品准备服务尚未连接。');
      const run = preparer;
      const controller = new AbortController();
      const request = {productId, controller, promise: Promise.resolve(null as unknown as FilePreparationResult)};
      request.promise = Promise.resolve().then(async () => {
        publish({phase: 'preparing', canPrepare: preparer !== null, productId, epoch: null, error: null});
        await run(productId, controller.signal);
        if (controller.signal.aborted || disposed) throw new DOMException('File preparation request cancelled', 'AbortError');
        const prepared = assertReady(productId);
        publish({phase: 'idle', canPrepare: preparer !== null, productId, epoch: prepared.epoch, error: null});
        return prepared;
      }).catch(error => {
        if (!disposed && active === request) publish({phase: 'error', canPrepare: preparer !== null, productId, epoch: null, error: failure(error)});
        throw error;
      }).finally(() => {if (active === request) active = null;});
      active = request;
      return withSignal(request.promise, signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true; active?.controller.abort(); active = null; preparer = null;
      listeners.clear();
    },
  });
}
export type FilePreparationController = ReturnType<typeof createFilePreparationController>;
export type PreparedFileRuntimeSnapshot = RuntimeSnapshot;
