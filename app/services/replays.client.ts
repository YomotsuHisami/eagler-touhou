/** Replay policy adapter over the ONE existing Runtime filesystem owner.
 * No React, DOM, browser persistence, background Runtime or score-file writer. */
import {gameIdForProduct, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {
  allocateReplayName, createReplayArchiveExtractionGuard, isReplayFilePath, isReplayImportFileName,
  isSafeReplayArchivePath, isReplayTargetAvailable, isValidReplayName, planReplayArchiveImport, ReplayArchiveScanError, replayImportAccept,
  selectReplayExportPaths,
} from '../../src/launcher/replay-files.mts';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from './runtime.client';
import {productRuntimeFileIdentity, runtimeMatchesProductFileIdentity} from './file-preparation.client';
import type {UiMessageKey, UiMessageParams} from './locale.client';
export {replayImportAccept};
export interface ReplayFile {readonly path: string; readonly name: string; readonly size: number}
export interface ReplayImportFile {readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>}
export interface ReplayDownload {readonly name: string; readonly type: string; readonly bytes: Uint8Array}
export class ReplayFilesMissingError extends Error {constructor() {super('file.noReplayToExport');}}
export type ReplayMessage = string | {readonly key: UiMessageKey; readonly params?: UiMessageParams};
class ReplayRenameError extends Error {
  constructor(readonly detail: Exclude<ReplayMessage, string>) {super(detail.key);}
}
function replayErrorMessage(error: unknown): ReplayMessage {
  if (error instanceof ReplayFilesMissingError) return {key: 'file.noReplayToExport'};
  return error instanceof ReplayRenameError ? error.detail : message(error);
}
export interface ReplaySnapshot {
  readonly productId: ProductId;
  readonly game: GameId;
  readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly epoch: number | null;
  readonly available: boolean;
  readonly readAvailable: boolean;
  readonly unavailableReason: string | null;
  readonly fileOperationBusy: boolean;
  readonly busy: 'list' | 'import' | 'export' | 'delete' | 'rename' | null;
  readonly loaded: boolean;
  readonly files: readonly ReplayFile[];
  readonly error: ReplayMessage | null;
  readonly notice: ReplayMessage | null;
}
export interface ReplayDeleteConfirmation {
  readonly productId: ProductId; readonly game: GameId; readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly epoch: number; readonly path: string; readonly name: string; readonly size: number;
}
export interface ReplayRenameRequest extends ReplayDeleteConfirmation {readonly prefix: string}
type RuntimePort = Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession' | 'close'>;
type ProductPreparer = (productId: ProductId, signal?: AbortSignal) => Promise<unknown>;
const defaultLimits = Object.freeze({importBytes: 128 * 1024 * 1024, fileBytes: 64 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const emptyFiles: readonly ReplayFile[] = Object.freeze([]);
function availability(live: RuntimeSnapshot, product: ProductId) {
  const identity = productRuntimeFileIdentity(product), game = identity.game;
  const matches = runtimeMatchesProductFileIdentity(live, identity);
  const available = matches && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable;
  const readAvailable = matches && live.ready && (available || live.phase === 'running' && live.launched) && !live.saveUnavailable;
  const unavailableReason = available ? null : live.game === game && live.runtimeVariant !== identity.runtimeVariant ? '当前 Runtime 的普通/多人文件身份与所选作品不一致。'
    : readAvailable ? '游戏正在运行：可读取和导出，修改录像需要安全重载 Runtime。' : live.launched || live.phase === 'launching' || live.phase === 'saving'
    ? '请先结束游戏并完成保存，再准备此作品的资源以管理录像。'
    : live.saveUnavailable ? '当前 Runtime 已失去保存能力，请先处理退出提示。'
      : `尚未准备 ${game.toUpperCase()} 的文件服务。请在作品页准备资源，不必启动游戏。`;
  return {available, readAvailable, unavailableReason};
}

export function createReplayController({runtimeService: runtime, limits: overrides = {}, now = () => new Date(), prepareProduct, isManagerOpen = () => false}: {
  runtimeService: RuntimePort; limits?: Partial<typeof defaultLimits>; now?: () => Date; prepareProduct?: ProductPreparer; isManagerOpen?(product: ProductId): boolean;
}) {
  const limits = {...defaultLimits, ...overrides};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid Replay size limit');
  const states = new Map<ProductId, ReplaySnapshot>(), listeners = new Set<() => void>();
  const confirmations = new WeakSet<ReplayDeleteConfirmation>();
  const renameRequests = new WeakSet<ReplayRenameRequest>();
  let disposed = false, active: Promise<unknown> | null = null;
  let managerOwner: {productId: ProductId; epoch: number} | null = null;
  function notify() {if (!disposed) for (const listener of [...listeners]) listener();}
  function update(product: ProductId, patch: Partial<ReplaySnapshot>) {
    const previous = states.get(product); if (previous && !disposed) {states.set(product, Object.freeze({...previous, ...patch})); notify();}
  }
  function loadProduct(product: ProductId) {
    if (disposed) return;
    const identity = productRuntimeFileIdentity(product), game = identity.game; if (states.has(product)) return;
    const live = runtime.getSnapshot();
    states.set(product, Object.freeze({productId: product, game, runtimeVariant: identity.runtimeVariant,
      epoch: runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null, ...availability(live, product),
      fileOperationBusy: live.fileOperationBusy, busy: null, loaded: false, files: emptyFiles, error: null, notice: null})); notify();
  }
  function state(product: ProductId) {
    if (disposed) throw new Error('录像管理服务已关闭。');
    loadProduct(product); return states.get(product)!;
  }
  async function prepareFiles(product: ProductId) {
    if (state(product).available) return;
    if (!prepareProduct) throw new Error(state(product).unavailableReason ?? '录像文件服务尚未就绪。');
    await prepareProduct(product);
    const current = state(product);
    if (!current.available) throw new Error(current.unavailableReason ?? '录像文件服务尚未就绪。');
  }
  function assertCurrent(access: RuntimeFileSession, product: ProductId) {
    const live = runtime.getSnapshot();
    if (live.epoch !== access.epoch || !availability(live, product).readAvailable) throw new ReplayRenameError({key: 'react.replays.sessionChanged'});
  }
  const unsubscribe = runtime.subscribe(() => {
    const live = runtime.getSnapshot();
    for (const [product, old] of states) {
      const identity = productRuntimeFileIdentity(product);
      const epoch = runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null;
      const status = availability(live, product);
      const invalidate = epoch !== old.epoch || !status.readAvailable;
      states.set(product, Object.freeze({...old, epoch, ...status, fileOperationBusy: live.fileOperationBusy,
        ...(invalidate ? {loaded: false, files: emptyFiles} : {}), notice: epoch !== old.epoch ? null : old.notice}));
    }
    notify();
  });
  async function retireTemporaryExportOwner(product: ProductId, expectedEpoch: number) {
    const identity = productRuntimeFileIdentity(product), live = runtime.getSnapshot();
    if (!runtimeMatchesProductFileIdentity(live, identity) || live.epoch !== expectedEpoch || !live.ready || live.phase !== 'prepared' || live.launched || live.saveUnavailable || live.fileOperationBusy) return;
    try {
      if (!await runtime.close()) update(product, {notice: {key: 'react.files.temporaryRuntimeCloseFailed'}});
    } catch (error) {
      update(product, {notice: {key: 'react.files.temporaryRuntimeCloseFailedReason', params: {reason: message(error)}}});
    }
  }
  function run<T>(product: ProductId, kind: NonNullable<ReplaySnapshot['busy']>, operation: (access: RuntimeFileSession, game: GameId, product: ProductId) => Promise<T>, prepareIfNeeded = true): Promise<T> {
    if (disposed) return Promise.reject(new Error('录像管理服务已关闭。'));
    const selected = state(product), game = selected.game;
    if (active || selected.fileOperationBusy) return Promise.reject(new Error('请等待当前文件操作完成。'));
    const entry = runtime.getSnapshot(), identity = productRuntimeFileIdentity(product);
    const hadMatchingPreparedOwner = runtimeMatchesProductFileIdentity(entry, identity) && entry.epoch !== null && entry.ready && entry.phase === 'prepared' && !entry.launched && !entry.saveUnavailable;
    const readOnly = kind === 'list' || kind === 'export';
    const alreadyAvailable = selected.readAvailable;
    if (!alreadyAvailable && (!prepareIfNeeded || !prepareProduct)) return Promise.reject(new Error(selected.unavailableReason ?? '录像文件服务尚未就绪。'));
    // Reserve this controller synchronously before any async package preparation.
    const task = alreadyAvailable
      ? runtime.withFileSession(game, access => operation(access, game, product), {readOnly, replayMutation: !readOnly, runtimeVariant: selected.runtimeVariant, epoch: selected.epoch ?? undefined})
      : Promise.resolve().then(async () => {
        await prepareFiles(product);
        if (disposed) throw new Error('录像管理服务已关闭。');
        const prepared = state(product);
        if (!prepared.available || prepared.epoch === null) throw new Error(prepared.unavailableReason ?? '录像文件服务尚未就绪。');
        if ((kind === 'list' || kind === 'import') && isManagerOpen(product) && !hadMatchingPreparedOwner) managerOwner = {productId: product, epoch: prepared.epoch};
        const temporaryEpoch = kind === 'export' && !alreadyAvailable && !hadMatchingPreparedOwner ? prepared.epoch : null;
        try {
          return await runtime.withFileSession(game, access => operation(access, game, product), {readOnly, replayMutation: !readOnly, runtimeVariant: prepared.runtimeVariant, epoch: prepared.epoch});
        } finally {
          if (temporaryEpoch !== null) await retireTemporaryExportOwner(product, temporaryEpoch);
        }
      });
    const result = task.catch(error => {update(product, {error: error instanceof ReplayFilesMissingError ? null : replayErrorMessage(error)}); throw error;})
      .finally(() => {if (active === result) active = null; update(product, {busy: null});});
    active = result; update(product, {busy: kind, error: null, notice: null});
    void result.catch(() => {}); return result;
  }
  function filesFrom(value: unknown): ReplayFile[] {
    const response = value as {files?: unknown};
    if (!Array.isArray(response?.files)) throw new Error('Runtime 返回的文件列表无效。');
    const paths = new Set<string>();
    return response.files.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new Error('Runtime 返回的文件信息无效。');
      const {path, size} = entry as {path?: unknown; size?: unknown};
      if (typeof path !== 'string' || !isSafeReplayArchivePath(path) || !Number.isSafeInteger(size) || (size as number) < 0 || paths.has(path.toLowerCase())) throw new Error('Runtime 返回的文件信息无效。');
      paths.add(path.toLowerCase());
      return Object.freeze({path, name: path.slice(path.lastIndexOf('/') + 1), size: size as number});
    });
  }
  async function list(access: RuntimeFileSession, game: GameId, product: ProductId) {
    // A failed refresh is not evidence that a previously displayed list is current.
    update(product, {loaded: false});
    await access.sync();
    const all = filesFrom(await access.send('list', {}));
    assertCurrent(access, product);
    const files = Object.freeze(all.filter(file => isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path)));
    update(product, {files, loaded: true}); return all;
  }
  async function read(access: RuntimeFileSession, path: string, product: ProductId): Promise<Uint8Array> {
    if (!isReplayFilePath(path) || !isSafeReplayArchivePath(path)) throw new Error('只能读取录像文件。');
    const result = await access.send('read', {path});
    assertCurrent(access, product);
    if (!Array.isArray(result.bytes) || result.bytes.length > limits.fileBytes || !result.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('Runtime 返回的录像内容无效或过大。');
    return Uint8Array.from(result.bytes);
  }
  async function importEntries(file: ReplayImportFile, game: GameId, existingPaths: string[]) {
    if (!isReplayImportFileName(file.name)) throw new Error('请选择 .rpy、.rpyx 或 .zip 文件。');
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('不能导入空文件。');
    if (file.size > limits.importBytes) throw new Error('导入文件过大。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > limits.importBytes) throw new Error('导入文件大小发生变化。');
    const prefix = PRODUCT_GAMES[game].replay.prefix;
    let entries: Array<{path: string; bytes: Uint8Array}>;
    if (/\.rpyx?$/i.test(file.name)) {
      const name = allocateReplayName(prefix, existingPaths, file.name);
      if (!name) throw new Error('没有可用的录像文件名。');
      entries = [{path: `replay/${name}`, bytes}];
    } else {
      const {unzipSync} = await import('fflate');
      const guard = createReplayArchiveExtractionGuard({maxFileBytes: limits.fileBytes, maxExpandedBytes: limits.expandedBytes});
      let archive: Record<string, Uint8Array>;
      try {archive = unzipSync(bytes, {filter: guard.filter});}
      catch (error) {
        if (error instanceof ReplayArchiveScanError) throw new Error(error.reason === 'unsafe-path' ? 'ZIP 包含不安全的文件路径。'
          : error.reason === 'duplicate-path' ? 'ZIP 包含重复的文件路径。' : 'ZIP 解压后的录像超过大小限制。');
        throw new Error('无法读取此 ZIP 文件。');
      }
      const plan = planReplayArchiveImport(prefix, guard.paths, existingPaths);
      if (!plan.ok) throw new Error('ZIP 的路径或录像文件名无效。');
      entries = plan.entries.map(entry => ({path: entry.targetPath, bytes: archive[entry.sourcePath]}));
    }
    if (!entries.length) throw new Error('此文件中没有可导入的录像。');
    if (entries.some(entry => !entry.bytes?.length || entry.bytes.length > limits.fileBytes) || entries.reduce((size, entry) => size + entry.bytes.length, 0) > limits.expandedBytes) throw new Error('录像为空或超过大小限制。');
    return entries;
  }
  return Object.freeze({
    errorMessage: replayErrorMessage,
    loadProduct,
    prepareFiles,
    getSnapshot: (product: ProductId) => states.get(product) ?? null,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh(product: ProductId) {return run(product, 'list', async (access, game, ownerProduct) => {await list(access, game, ownerProduct);});},
    async closeManager(product: ProductId) {
      if (active) await active.catch(() => {});
      if (managerOwner?.productId !== product) return;
      const owner = managerOwner;managerOwner = null;const live = runtime.getSnapshot();
      if (live.epoch !== owner.epoch || !runtimeMatchesProductFileIdentity(live, productRuntimeFileIdentity(product)) || live.phase !== 'prepared' || live.launched || live.fileOperationBusy) return;
      if (!await runtime.close({discardUnsaved: true})) update(product, {notice: {key: 'react.files.temporaryRuntimeCloseFailed'}});
    },
    importFile(product: ProductId, file: ReplayImportFile) {
      return run(product, 'import', async (access, game, ownerProduct) => {
        const existing = await list(access, game, ownerProduct);
        const entries = await importEntries(file, game, existing.map(entry => entry.path));
        const written: string[] = [];
        try {
          for (const entry of entries) {await access.send('write', {path: entry.path, bytes: Array.from(entry.bytes)}); written.push(entry.path);}
          if (isManagerOpen(ownerProduct)) {
            const restored = await access.restart({sync: false});
            if (managerOwner?.productId === ownerProduct && managerOwner.epoch === access.epoch) managerOwner = {productId: ownerProduct, epoch: restored.epoch};
            await list(restored, game, ownerProduct);
          } else {await access.retire();if (managerOwner?.productId === ownerProduct) managerOwner = null;}
        } catch (error) {
          update(ownerProduct, {loaded: false});
          throw new Error(`导入未完成，已有 ${written.length} 个录像获得保存确认；请重新读取列表后检查。${message(error)}`);
        }
        update(ownerProduct, {notice: `已导入 ${written.length} 个录像。重名文件已分配新名称，没有覆盖原录像。`});
        return Object.freeze(written);
      }, true);
    },
    exportFile(product: ProductId, path: string) {
      return run(product, 'export', async (access, game, ownerProduct): Promise<ReplayDownload> => {
        const files = await list(access, game, ownerProduct), file = files.find(entry => entry.path === path && isReplayFilePath(entry.path));
        if (!file || file.size > limits.fileBytes) throw new Error('此录像不存在或超过大小限制。');
        return {name: file.name, type: 'application/octet-stream', bytes: await read(access, path, ownerProduct)};
      });
    },
    exportAll(product: ProductId) {
      return run(product, 'export', async (access, game, ownerProduct): Promise<ReplayDownload> => {
        const files = (await list(access, game, ownerProduct)).filter(file => isReplayFilePath(file.path));
        if (!files.length) throw new ReplayFilesMissingError();
        if (files.some(file => file.size > limits.fileBytes) || files.reduce((size, file) => size + file.size, 0) > limits.expandedBytes) throw new Error('录像总大小过大，请分开下载。');
        const entries: Record<string, Uint8Array> = Object.create(null); let size = 0;
        for (const path of selectReplayExportPaths(files.map(file => file.path))) {
          const bytes = await read(access, path, ownerProduct); size += bytes.length;
          if (size > limits.expandedBytes) throw new Error('录像总大小过大，请分开下载。');
          entries[path] = bytes;
        }
        const {zipSync} = await import('fflate');
        return {name: `${game}-replay-${now().toISOString().slice(0, 10)}.zip`, type: 'application/zip', bytes: zipSync(entries, {level: 1})};
      });
    },
    requestRename(product: ProductId, path: string): ReplayRenameRequest {
      const selected = state(product), file = selected.files.find(entry => entry.path === path);
      if (active || selected.fileOperationBusy || !selected.readAvailable || !selected.loaded || selected.epoch === null || !file) throw new ReplayRenameError({key: 'react.replays.renameRefresh'});
      const ticket = Object.freeze({productId: product, game: selected.game, runtimeVariant: selected.runtimeVariant,
        epoch: selected.epoch, ...file, prefix: PRODUCT_GAMES[selected.game].replay.prefix});
      renameRequests.add(ticket); return ticket;
    },
    cancelRename(ticket: ReplayRenameRequest) {renameRequests.delete(ticket);},
    renameFile(ticket: ReplayRenameRequest, newName: string) {
      if (!renameRequests.has(ticket)) return Promise.reject(new ReplayRenameError({key: 'react.replays.renameRefresh'}));
      const name = newName.trim(), target = `replay/${name}`;
      if (!name) return Promise.reject(new ReplayRenameError({key: 'replay.nameEmpty'}));
      if (!isValidReplayName(ticket.prefix, name)) return Promise.reject(new ReplayRenameError({key: 'replay.nameInvalid', params: {prefix: ticket.prefix}}));
      const live = runtime.getSnapshot();
      if (!runtimeMatchesProductFileIdentity(live, productRuntimeFileIdentity(ticket.productId)) || live.epoch !== ticket.epoch || live.runtimeVariant !== ticket.runtimeVariant) return Promise.reject(new ReplayRenameError({key: 'react.replays.sessionChanged'}));
      // A draft can retry validation/collision failures. Accepted work survives
      // view dismissal, while cancellation prevents accepting that draft again.
      return run(ticket.productId, 'rename', async (access, game, product) => {
        if (ticket.runtimeVariant !== productRuntimeFileIdentity(product).runtimeVariant) throw new ReplayRenameError({key: 'react.replays.sessionChanged'});
        const current = await list(access, game, product), source = current.find(file => file.path === ticket.path && isReplayFilePath(file.path));
        if (!source || source.size !== ticket.size || source.size > limits.fileBytes) throw new ReplayRenameError({key: 'react.replays.renameChanged'});
        if (target.toLowerCase() === ticket.path.toLowerCase()) {renameRequests.delete(ticket); return ticket.name;}
        if (!isReplayTargetAvailable(current.map(file => file.path), target)) throw new ReplayRenameError({key: 'replay.nameExists'});
        const bytes = await read(access, ticket.path, product); assertCurrent(access, product);
        if (bytes.length !== ticket.size) throw new ReplayRenameError({key: 'react.replays.renameChanged'});
        let destinationConfirmed = false;
        try {
          // The existing Runtime owns durable writes. Never remove the source
          // before the destination acknowledges persistence, or overwrite it.
          await access.send('write', {path: target, bytes: Array.from(bytes)}); assertCurrent(access, product);
          destinationConfirmed = true;
          await access.send('remove', {path: ticket.path}); assertCurrent(access, product);
          await list(access, game, product);
        } catch (error) {
          update(product, {loaded: false});
          throw new ReplayRenameError({key: destinationConfirmed ? 'react.replays.renameRemoveUnconfirmed' : 'react.replays.renameWriteUnconfirmed', params: {name, reason: error instanceof ReplayRenameError ? '' : message(error)}});
        }
        renameRequests.delete(ticket);
        update(product, {notice: {key: 'react.replays.renamed', params: {name}}});
        return name;
      }, false);
    },
    requestDelete(product: ProductId, path: string): ReplayDeleteConfirmation {
      const selected = state(product), file = selected.files.find(entry => entry.path === path);
      if (active || selected.fileOperationBusy || !selected.readAvailable || !selected.loaded || selected.epoch === null || !file) throw new Error('请重新读取录像列表后再删除。');
      const ticket = Object.freeze({productId: product, game: selected.game, runtimeVariant: selected.runtimeVariant,
        epoch: selected.epoch, ...file}); confirmations.add(ticket); return ticket;
    },
    cancelDelete(ticket: ReplayDeleteConfirmation) {confirmations.delete(ticket);},
    confirmDelete(ticket: ReplayDeleteConfirmation) {
      if (!confirmations.delete(ticket)) return Promise.reject(new Error('删除需要先确认具体录像。'));
      const live = runtime.getSnapshot();
      if (!runtimeMatchesProductFileIdentity(live, productRuntimeFileIdentity(ticket.productId)) || live.epoch !== ticket.epoch || live.runtimeVariant !== ticket.runtimeVariant) return Promise.reject(new Error('游戏会话或普通/多人文件身份已改变，请重新确认删除。'));
      return run(ticket.productId, 'delete', async (access, game, product) => {
        const current = (await list(access, game, product)).find(file => file.path === ticket.path && isReplayFilePath(file.path));
        if (!current || current.size !== ticket.size) throw new Error('录像信息已改变，请重新确认删除。');
        await access.send('remove', {path: ticket.path});
        update(product, {loaded: false});
        await list(access, game, product); update(product, {notice: `已删除 ${ticket.name}。`});
      }, false);
    },
    dispose() {disposed = true; unsubscribe(); listeners.clear();},
  });
}
export type ReplayController = ReturnType<typeof createReplayController>;
