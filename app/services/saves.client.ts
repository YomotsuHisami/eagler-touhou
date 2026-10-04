/** Score-file policy over the single existing Runtime owner. No DOM or IDB writer.
 * Import success requires a newly restored native owner and exact-byte readback. */
import {gameIdForProduct, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from './runtime.client';
export interface SaveImportFile {readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>}
export interface SaveDownload {readonly name: string; readonly type: string; readonly bytes: Uint8Array}
export interface SaveSnapshot {
  readonly game: GameId; readonly epoch: number | null; readonly scoreFile: string; readonly saveRoot: string;
  readonly available: boolean; readonly unavailableReason: string | null; readonly fileOperationBusy: boolean;
  readonly busy: 'read' | 'import' | 'export' | null; readonly loaded: boolean;
  readonly exists: boolean | null; readonly size: number | null; readonly error: string | null; readonly notice: string | null;
}
export interface SaveImportConfirmation {
  readonly productId: ProductId; readonly game: GameId; readonly epoch: number;
  readonly name: string; readonly size: number; readonly scoreFile: string; readonly saveRoot: string;
}
type RuntimePort = Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession'>;
// Same bounded input/storage limits as the established launcher. A .dat extension
// is the format contract; no invented game-signature or compatibility guarantee.
const defaultLimits = Object.freeze({importBytes: 128 * 1024 * 1024, fileBytes: 64 * 1024 * 1024});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function availability(live: RuntimeSnapshot, game: GameId) {
  const available = live.game === game && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable;
  const unavailableReason = available ? null : live.launched || live.phase === 'launching' || live.phase === 'saving'
    ? '请先结束游戏并完成保存，再准备此作品的资源以管理存档。'
    : live.saveUnavailable ? '当前 Runtime 已失去保存能力，请先处理退出提示。'
      : `尚未准备 ${game.toUpperCase()} 的文件服务。请在作品页准备资源，不必启动游戏。`;
  return {available, unavailableReason};
}
export function createSaveController({runtimeService: runtime, limits: overrides = {}}: {
  runtimeService: RuntimePort; limits?: Partial<typeof defaultLimits>;
}) {
  const limits = {...defaultLimits, ...overrides};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid save size limit');
  const states = new Map<GameId, SaveSnapshot>(), listeners = new Set<() => void>();
  const confirmations = new WeakMap<SaveImportConfirmation, SaveImportFile>();
  let disposed = false, active: Promise<unknown> | null = null;
  function notify() {if (!disposed) for (const listener of [...listeners]) listener();}
  function update(game: GameId, patch: Partial<SaveSnapshot>) {
    const old = states.get(game); if (old && !disposed) {states.set(game, Object.freeze({...old, ...patch})); notify();}
  }
  function assertCurrent(access: RuntimeFileSession, game: GameId) {
    const live = runtime.getSnapshot();
    if (live.game !== game || live.epoch !== access.epoch || !availability(live, game).available) throw new Error('游戏会话已改变，操作没有完成。');
  }
  function loadProduct(product: ProductId) {
    if (disposed) return;
    const game = gameIdForProduct(product); if (states.has(game)) return;
    const live = runtime.getSnapshot();
    states.set(game, Object.freeze({game, epoch: live.game === game ? live.epoch : null, ...PRODUCT_GAMES[game].storage,
      ...availability(live, game), fileOperationBusy: live.fileOperationBusy, busy: null, loaded: false,
      exists: null, size: null, error: null, notice: null})); notify();
  }
  function state(product: ProductId) {
    if (disposed) throw new Error('存档管理服务已关闭。');
    loadProduct(product); return states.get(gameIdForProduct(product))!;
  }
  const unsubscribe = runtime.subscribe(() => {
    const live = runtime.getSnapshot();
    for (const [game, old] of states) {
      const epoch = live.game === game ? live.epoch : null, status = availability(live, game);
      const invalidate = epoch !== old.epoch || !status.available;
      states.set(game, Object.freeze({...old, epoch, ...status, fileOperationBusy: live.fileOperationBusy,
        ...(invalidate ? {loaded: false, exists: null, size: null, notice: null} : {})}));
    }
    notify();
  });
  function run<T>(product: ProductId, kind: NonNullable<SaveSnapshot['busy']>, operation: (access: RuntimeFileSession, game: GameId) => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('存档管理服务已关闭。'));
    const selected = state(product), game = selected.game;
    if (active || selected.fileOperationBusy) return Promise.reject(new Error('请等待当前文件操作完成。'));
    if (!selected.available) return Promise.reject(new Error(selected.unavailableReason ?? '存档文件服务尚未就绪。'));
    const task = runtime.withFileSession(game, access => operation(access, game));
    const result = task.catch(error => {update(game, {error: message(error)}); throw error;})
      .finally(() => {if (active === result) active = null; update(game, {busy: null});});
    active = result; update(game, {busy: kind, error: null, notice: null});
    void result.catch(() => {}); return result;
  }
  async function inspect(access: RuntimeFileSession, game: GameId) {
    update(game, {loaded: false, exists: null, size: null});
    await access.sync();
    const result = await access.send('list', {}); assertCurrent(access, game);
    if (!Array.isArray(result.files)) throw new Error('Runtime 返回的文件列表无效。');
    const path = PRODUCT_GAMES[game].storage.scoreFile;
    let size: number | null = null;
    for (const entry of result.files) {
      if (!entry || typeof entry !== 'object') throw new Error('Runtime 返回的文件信息无效。');
      const item = entry as {path?: unknown; size?: unknown};
      if (typeof item.path !== 'string' || !item.path || !Number.isSafeInteger(item.size) || (item.size as number) < 0) throw new Error('Runtime 返回的文件信息无效。');
      if (item.path === path) {
        if (size !== null) throw new Error('Runtime 返回了重复的存档信息。');
        size = item.size as number;
      }
    }
    update(game, {loaded: true, exists: size !== null, size}); return size;
  }
  async function read(access: RuntimeFileSession, game: GameId) {
    const result = await access.send('read', {path: PRODUCT_GAMES[game].storage.scoreFile}); assertCurrent(access, game);
    if (!Array.isArray(result.bytes) || result.bytes.length > limits.fileBytes || !result.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('Runtime 返回的存档内容无效或过大。');
    return Uint8Array.from(result.bytes);
  }
  function validate(file: Pick<SaveImportFile, 'name' | 'size'>) {
    if (typeof file.name !== 'string' || !/\.dat$/i.test(file.name)) throw new Error('请选择此作品的 .dat 存档文件。');
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('不能导入空文件。');
    if (file.size > limits.importBytes || file.size > limits.fileBytes) throw new Error('存档超过大小限制。');
  }
  return Object.freeze({
    loadProduct,
    getSnapshot: (product: ProductId) => states.get(gameIdForProduct(product)) ?? null,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh(product: ProductId) {return run(product, 'read', async (access, game) => {await inspect(access, game);});},
    exportFile(product: ProductId) {
      return run(product, 'export', async (access, game): Promise<SaveDownload> => {
        const size = await inspect(access, game);
        if (size === null) throw new Error('此作品还没有存档。可先导入已有的 .dat 文件，或在游戏中保存后再导出。');
        if (size > limits.fileBytes) throw new Error('存档超过大小限制。');
        return {name: PRODUCT_GAMES[game].storage.scoreFile, type: 'application/octet-stream', bytes: await read(access, game)};
      });
    },
    requestImport(product: ProductId, file: SaveImportFile): SaveImportConfirmation {
      const selected = state(product);
      if (active || selected.fileOperationBusy || !selected.available || selected.epoch === null) throw new Error('请准备此作品并等待当前文件操作完成，再选择存档。');
      validate(file);
      const ticket = Object.freeze({productId: product, game: selected.game, epoch: selected.epoch, name: file.name,
        size: file.size, scoreFile: selected.scoreFile, saveRoot: selected.saveRoot});
      confirmations.set(ticket, file); return ticket;
    },
    cancelImport(ticket: SaveImportConfirmation) {confirmations.delete(ticket);},
    confirmImport(ticket: SaveImportConfirmation) {
      const file = confirmations.get(ticket); confirmations.delete(ticket);
      if (!file) return Promise.reject(new Error('导入需要先确认具体存档及覆盖目标。'));
      const live = runtime.getSnapshot();
      if (live.game !== ticket.game || live.epoch !== ticket.epoch) return Promise.reject(new Error('游戏会话已改变，请重新选择存档并确认覆盖。'));
      return run(ticket.productId, 'import', async (access, game) => {
        let writeStarted = false;
        try {
          if (access.epoch !== ticket.epoch) throw new Error('游戏会话已改变，请重新确认覆盖。');
          validate(file);
          if (file.name !== ticket.name || file.size !== ticket.size) throw new Error('导入文件已改变，请重新选择并确认。');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (disposed) throw new Error('存档管理服务已关闭。');
          assertCurrent(access, game);
          if (bytes.length !== ticket.size || bytes.length > limits.importBytes || bytes.length > limits.fileBytes) throw new Error('导入文件大小发生变化。');
          await access.sync(); assertCurrent(access, game);
          writeStarted = true;
          await access.send('write', {path: ticket.scoreFile, bytes: Array.from(bytes)});
          // Native write acknowledgement includes persistence. Retire that owner,
          // restore a new owner under the same exclusive lease, then verify bytes.
          const restored = await access.restart();
          if (restored.epoch === access.epoch) throw new Error('Runtime 未重新载入，无法验证存档。');
          const persisted = await read(restored, game);
          if (persisted.length !== bytes.length || persisted.some((byte, index) => byte !== bytes[index])) throw new Error('重新载入后的存档内容不一致。');
          update(game, {loaded: true, exists: true, size: bytes.length,
            notice: '存档已导入，并已重新载入 Runtime 核对全部字节。下次启动将使用此存档。'});
        } catch (error) {
          if (writeStarted) {
            update(game, {loaded: false, exists: null, size: null});
            throw new Error(`导入未通过重新载入校验；当前存档可能已被替换，请保留原始文件并重新检查。${message(error)}`);
          }
          throw error;
        }
      });
    },
    dispose() {disposed = true; unsubscribe(); listeners.clear();},
  });
}
export type SaveController = ReturnType<typeof createSaveController>;
