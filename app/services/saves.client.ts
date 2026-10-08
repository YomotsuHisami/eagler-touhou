/** Score-file policy over the single existing Runtime owner. No DOM or IDB writer.
 * Import success requires a newly restored native owner and exact-byte readback. */
import {gameIdForProduct, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from './runtime.client';
import {productRuntimeFileIdentity, runtimeMatchesProductFileIdentity} from './file-preparation.client';
import type {UiMessageKey, UiMessageParams} from './locale.client';
export interface SaveImportFile {readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>}
export interface SaveDownload {readonly name: string; readonly type: string; readonly bytes: Uint8Array}
export class SaveFileMissingError extends Error {
  constructor() {super('file.missingSavePrompt');}
}
export type SaveNotice = string | {readonly key: UiMessageKey; readonly params?: UiMessageParams};
export interface SaveSnapshot {
  readonly productId: ProductId; readonly game: GameId; readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly epoch: number | null; readonly scoreFile: string; readonly saveRoot: string;
  readonly available: boolean; readonly readAvailable: boolean; readonly unavailableReason: string | null; readonly fileOperationBusy: boolean;
  readonly busy: 'read' | 'import' | 'export' | null; readonly loaded: boolean;
  readonly exists: boolean | null; readonly size: number | null; readonly error: string | null; readonly notice: SaveNotice | null;
}
export interface SaveImportConfirmation {
  readonly productId: ProductId; readonly game: GameId; readonly epoch: number;
  readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly name: string; readonly size: number; readonly scoreFile: string; readonly saveRoot: string;
}
type RuntimePort = Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession' | 'close'>;
type ProductPreparer = (productId: ProductId, signal?: AbortSignal) => Promise<unknown>;
// Same bounded input/storage limits as the established launcher. A .dat extension
// is the format contract; no invented game-signature or compatibility guarantee.
const defaultLimits = Object.freeze({importBytes: 128 * 1024 * 1024, fileBytes: 64 * 1024 * 1024});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function availability(live: RuntimeSnapshot, product: ProductId) {
  const identity = productRuntimeFileIdentity(product), game = identity.game;
  const matches = runtimeMatchesProductFileIdentity(live, identity);
  const available = matches && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable;
  const readAvailable = matches && live.ready && (available || live.phase === 'running' && live.launched) && !live.saveUnavailable;
  const unavailableReason = available ? null : live.game === game && live.runtimeVariant !== identity.runtimeVariant ? '当前 Runtime 的普通/多人文件身份与所选作品不一致。'
    : readAvailable ? '游戏正在运行：可读取和导出，导入会在确认后安全重载 Runtime。' : live.launched || live.phase === 'launching' || live.phase === 'saving'
    ? '请先结束游戏并完成保存，再准备此作品的资源以管理存档。'
    : live.saveUnavailable ? '当前 Runtime 已失去保存能力，请先处理退出提示。'
      : `尚未准备 ${game.toUpperCase()} 的文件服务。请在作品页准备资源，不必启动游戏。`;
  return {available, readAvailable, unavailableReason};
}
export function createSaveController({runtimeService: runtime, limits: overrides = {}, prepareProduct}: {
  runtimeService: RuntimePort; limits?: Partial<typeof defaultLimits>; prepareProduct?: ProductPreparer;
}) {
  const limits = {...defaultLimits, ...overrides};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid save size limit');
  const states = new Map<ProductId, SaveSnapshot>(), listeners = new Set<() => void>();
  const confirmations = new WeakMap<SaveImportConfirmation, SaveImportFile>();
  let disposed = false, active: Promise<unknown> | null = null;
  function notify() {if (!disposed) for (const listener of [...listeners]) listener();}
  function update(product: ProductId, patch: Partial<SaveSnapshot>) {
    const old = states.get(product); if (old && !disposed) {states.set(product, Object.freeze({...old, ...patch})); notify();}
  }
  function assertCurrent(access: RuntimeFileSession, product: ProductId) {
    const live = runtime.getSnapshot();
    if (live.epoch !== access.epoch || !availability(live, product).readAvailable) throw new Error('游戏会话或普通/多人文件身份已改变，操作没有完成。');
  }
  function loadProduct(product: ProductId) {
    if (disposed) return;
    const identity = productRuntimeFileIdentity(product), game = identity.game; if (states.has(product)) return;
    const live = runtime.getSnapshot();
    states.set(product, Object.freeze({productId: product, game, runtimeVariant: identity.runtimeVariant,
      epoch: runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null, ...PRODUCT_GAMES[game].storage,
      ...availability(live, product), fileOperationBusy: live.fileOperationBusy, busy: null, loaded: false,
      exists: null, size: null, error: null, notice: null})); notify();
  }
  function state(product: ProductId) {
    if (disposed) throw new Error('存档管理服务已关闭。');
    loadProduct(product); return states.get(product)!;
  }
  async function prepareFiles(product: ProductId) {
    if (state(product).available) return;
    if (!prepareProduct) throw new Error(state(product).unavailableReason ?? '存档文件服务尚未就绪。');
    await prepareProduct(product);
    const current = state(product);
    if (!current.available) throw new Error(current.unavailableReason ?? '存档文件服务尚未就绪。');
  }
  const unsubscribe = runtime.subscribe(() => {
    const live = runtime.getSnapshot();
    for (const [product, old] of states) {
      const identity = productRuntimeFileIdentity(product);
      const epoch = runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null, status = availability(live, product);
      const invalidate = epoch !== old.epoch || !status.readAvailable;
      states.set(product, Object.freeze({...old, epoch, ...status, fileOperationBusy: live.fileOperationBusy,
        ...(invalidate ? {loaded: false, exists: null, size: null, notice: null} : {})}));
    }
    notify();
  });
  async function retireRunningOwner(product: ProductId, expectedEpoch: number) {
    const identity = productRuntimeFileIdentity(product), before = runtime.getSnapshot();
    if (!runtimeMatchesProductFileIdentity(before, identity) || before.epoch !== expectedEpoch || !before.ready || !before.launched || before.phase !== 'running' || before.saveUnavailable) {
      throw new Error('游戏会话已改变，请重新确认存档导入。');
    }
    await runtime.withFileSession(identity.game, access => access.sync(), {readOnly: true, runtimeVariant: identity.runtimeVariant, epoch: expectedEpoch});
    const current = runtime.getSnapshot();
    if (!runtimeMatchesProductFileIdentity(current, identity) || current.epoch !== expectedEpoch || current.phase !== 'running' || !current.launched) throw new Error('游戏会话已改变，存档没有更改。');
    if (!await runtime.close()) throw new Error(runtime.getSnapshot().saveError ?? '当前游戏未能安全保存并退出，存档没有更改。');
    await prepareFiles(product);
    const prepared = state(product);
    if (!prepared.available || prepared.epoch === null || prepared.runtimeVariant !== identity.runtimeVariant) throw new Error(prepared.unavailableReason ?? '存档文件服务尚未就绪。');
  }
  async function retireTemporaryExportOwner(product: ProductId, expectedEpoch: number) {
    const identity = productRuntimeFileIdentity(product), live = runtime.getSnapshot();
    if (!runtimeMatchesProductFileIdentity(live, identity) || live.epoch !== expectedEpoch || !live.ready || live.phase !== 'prepared' || live.launched || live.saveUnavailable || live.fileOperationBusy) return;
    try {
      if (!await runtime.close()) update(product, {notice: {key: 'react.files.temporaryRuntimeCloseFailed'}});
    } catch (error) {
      update(product, {notice: {key: 'react.files.temporaryRuntimeCloseFailedReason', params: {reason: message(error)}}});
    }
  }
  function run<T>(product: ProductId, kind: NonNullable<SaveSnapshot['busy']>, operation: (access: RuntimeFileSession, game: GameId, product: ProductId) => Promise<T>, prepareIfNeeded = true, retireRunning = false): Promise<T> {
    if (disposed) return Promise.reject(new Error('存档管理服务已关闭。'));
    const selected = state(product), game = selected.game;
    if (active || selected.fileOperationBusy) return Promise.reject(new Error('请等待当前文件操作完成。'));
    const entry = runtime.getSnapshot(), identity = productRuntimeFileIdentity(product);
    const hadMatchingPreparedOwner = runtimeMatchesProductFileIdentity(entry, identity) && entry.epoch !== null && entry.ready && entry.phase === 'prepared' && !entry.launched && !entry.saveUnavailable;
    const readOnly = kind === 'read' || kind === 'export';
    const alreadyAvailable = readOnly ? selected.readAvailable : selected.available;
    const mayRetire = retireRunning && selected.readAvailable && !selected.available;
    if (!alreadyAvailable && !mayRetire && (!prepareIfNeeded || !prepareProduct)) return Promise.reject(new Error(selected.unavailableReason ?? '存档文件服务尚未就绪。'));
    const sessionOptions = {readOnly, runtimeVariant: selected.runtimeVariant, epoch: selected.epoch ?? undefined};
    const task = alreadyAvailable
      ? runtime.withFileSession(game, access => operation(access, game, product), sessionOptions)
      : Promise.resolve().then(async () => {
        if (mayRetire) await retireRunningOwner(product, selected.epoch!);
        else await prepareFiles(product);
        if (disposed) throw new Error('存档管理服务已关闭。');
        const prepared = state(product);
        if (!prepared.available || prepared.epoch === null) throw new Error(prepared.unavailableReason ?? '存档文件服务尚未就绪。');
        const temporaryEpoch = kind === 'export' && !alreadyAvailable && !hadMatchingPreparedOwner ? prepared.epoch : null;
        try {
          return await runtime.withFileSession(game, access => operation(access, game, product), {readOnly, runtimeVariant: prepared.runtimeVariant, epoch: prepared.epoch});
        } finally {
          if (temporaryEpoch !== null) await retireTemporaryExportOwner(product, temporaryEpoch);
        }
      });
    const result = task.catch(error => {update(product, {error: error instanceof SaveFileMissingError ? null : message(error)}); throw error;})
      .finally(() => {if (active === result) active = null; update(product, {busy: null});});
    active = result; update(product, {busy: kind, error: null, notice: null});
    void result.catch(() => {}); return result;
  }
  async function inspect(access: RuntimeFileSession, game: GameId, product: ProductId) {
    update(product, {loaded: false, exists: null, size: null});
    await access.sync();
    const result = await access.send('list', {}); assertCurrent(access, product);
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
    update(product, {loaded: true, exists: size !== null, size}); return size;
  }
  async function read(access: RuntimeFileSession, game: GameId, product: ProductId) {
    const result = await access.send('read', {path: PRODUCT_GAMES[game].storage.scoreFile}); assertCurrent(access, product);
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
    prepareFiles,
    getSnapshot: (product: ProductId) => states.get(product) ?? null,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh(product: ProductId) {return run(product, 'read', async (access, game, ownerProduct) => {await inspect(access, game, ownerProduct);});},
    exportFile(product: ProductId) {
      return run(product, 'export', async (access, game, ownerProduct): Promise<SaveDownload> => {
        const size = await inspect(access, game, ownerProduct);
        if (size === null) throw new SaveFileMissingError();
        if (size > limits.fileBytes) throw new Error('存档超过大小限制。');
        return {name: PRODUCT_GAMES[game].storage.scoreFile, type: 'application/octet-stream', bytes: await read(access, game, ownerProduct)};
      });
    },
    requestImport(product: ProductId, file: SaveImportFile): SaveImportConfirmation {
      const selected = state(product);
      if (active || selected.fileOperationBusy || !selected.readAvailable || selected.epoch === null) throw new Error('请先准备文件服务并等待当前文件操作完成，再选择存档。');
      validate(file);
      const ticket = Object.freeze({productId: product, game: selected.game, epoch: selected.epoch, runtimeVariant: selected.runtimeVariant, name: file.name,
        size: file.size, scoreFile: selected.scoreFile, saveRoot: selected.saveRoot});
      confirmations.set(ticket, file); return ticket;
    },
    cancelImport(ticket: SaveImportConfirmation) {confirmations.delete(ticket);},
    confirmImport(ticket: SaveImportConfirmation) {
      const file = confirmations.get(ticket); confirmations.delete(ticket);
      if (!file) return Promise.reject(new Error('导入需要先确认具体存档及覆盖目标。'));
      const live = runtime.getSnapshot();
      if (!runtimeMatchesProductFileIdentity(live, productRuntimeFileIdentity(ticket.productId)) || live.epoch !== ticket.epoch || live.runtimeVariant !== ticket.runtimeVariant) return Promise.reject(new Error('游戏会话或普通/多人文件身份已改变，请重新选择存档并确认覆盖。'));
      return run(ticket.productId, 'import', async (access, game, product) => {
        let writeStarted = false;
        try {
          const identity = productRuntimeFileIdentity(product);
          if (ticket.runtimeVariant !== identity.runtimeVariant || ticket.saveRoot !== identity.saveRoot || ticket.scoreFile !== identity.scoreFile) throw new Error('存档目标或普通/多人文件身份已改变，请重新确认覆盖。');
          validate(file);
          if (file.name !== ticket.name || file.size !== ticket.size) throw new Error('导入文件已改变，请重新选择并确认。');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (disposed) throw new Error('存档管理服务已关闭。');
          assertCurrent(access, product);
          if (bytes.length !== ticket.size || bytes.length > limits.importBytes || bytes.length > limits.fileBytes) throw new Error('导入文件大小发生变化。');
          await access.sync(); assertCurrent(access, product);
          writeStarted = true;
          await access.send('write', {path: ticket.scoreFile, bytes: Array.from(bytes)});
          // Native write acknowledgement includes persistence. Retire that owner,
          // restore a new owner under the same exclusive lease, then verify bytes.
          const restored = await access.restart();
          if (restored.epoch === access.epoch) throw new Error('Runtime 未重新载入，无法验证存档。');
          const persisted = await read(restored, game, product);
          if (persisted.length !== bytes.length || persisted.some((byte, index) => byte !== bytes[index])) throw new Error('重新载入后的存档内容不一致。');
          update(product, {loaded: true, exists: true, size: bytes.length,
            notice: '存档已导入，并已重新载入 Runtime 核对全部字节。下次启动将使用此存档。'});
        } catch (error) {
          if (writeStarted) {
            update(product, {loaded: false, exists: null, size: null});
            throw new Error(`导入未通过重新载入校验；当前存档可能已被替换，请保留原始文件并重新检查。${message(error)}`);
          }
          throw error;
        }
      }, false, true);
    },
    dispose() {disposed = true; unsubscribe(); listeners.clear();},
  });
}
export type SaveController = ReturnType<typeof createSaveController>;
