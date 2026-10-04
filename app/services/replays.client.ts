/** Replay policy adapter over the ONE existing Runtime filesystem owner.
 * No React, DOM, browser persistence, background Runtime or score-file writer. */
import {gameIdForProduct, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {
  allocateReplayName, createReplayArchiveExtractionGuard, isReplayFilePath, isReplayImportFileName,
  isSafeReplayArchivePath, planReplayArchiveImport, ReplayArchiveScanError, replayImportAccept,
  selectReplayExportPaths,
} from '../../src/launcher/replay-files.mts';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from './runtime.client';
export {replayImportAccept};
export interface ReplayFile {readonly path: string; readonly name: string; readonly size: number}
export interface ReplayImportFile {readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>}
export interface ReplayDownload {readonly name: string; readonly type: string; readonly bytes: Uint8Array}
export interface ReplaySnapshot {
  readonly game: GameId;
  readonly epoch: number | null;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly busy: 'list' | 'import' | 'export' | 'delete' | null;
  readonly loaded: boolean;
  readonly files: readonly ReplayFile[];
  readonly error: string | null;
  readonly notice: string | null;
}
export interface ReplayDeleteConfirmation {
  readonly game: GameId; readonly epoch: number; readonly path: string; readonly name: string; readonly size: number;
}
type RuntimePort = Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession'>;
const defaultLimits = Object.freeze({importBytes: 128 * 1024 * 1024, fileBytes: 64 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const emptyFiles: readonly ReplayFile[] = Object.freeze([]);
function availability(live: RuntimeSnapshot, game: GameId) {
  const available = live.game === game && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable;
  const unavailableReason = available ? null : live.launched || live.phase === 'launching' || live.phase === 'saving'
    ? '请先结束游戏并完成保存，再准备此作品的资源以管理录像。'
    : live.saveUnavailable ? '当前 Runtime 已失去保存能力，请先处理退出提示。'
      : `尚未准备 ${game.toUpperCase()} 的文件服务。请在作品页准备资源，不必启动游戏。`;
  return {available, unavailableReason};
}

export function createReplayController({runtimeService: runtime, limits: overrides = {}, now = () => new Date()}: {
  runtimeService: RuntimePort; limits?: Partial<typeof defaultLimits>; now?: () => Date;
}) {
  const limits = {...defaultLimits, ...overrides};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid Replay size limit');
  const states = new Map<GameId, ReplaySnapshot>(), listeners = new Set<() => void>();
  const confirmations = new WeakSet<ReplayDeleteConfirmation>();
  let disposed = false, active: Promise<unknown> | null = null;
  function notify() {if (!disposed) for (const listener of [...listeners]) listener();}
  function update(game: GameId, patch: Partial<ReplaySnapshot>) {
    const previous = states.get(game); if (previous && !disposed) {states.set(game, Object.freeze({...previous, ...patch})); notify();}
  }
  function loadProduct(product: ProductId) {
    const game = gameIdForProduct(product); if (states.has(game)) return;
    const live = runtime.getSnapshot();
    states.set(game, Object.freeze({game, epoch: live.game === game ? live.epoch : null, ...availability(live, game),
      busy: null, loaded: false, files: emptyFiles, error: null, notice: null})); notify();
  }
  function state(product: ProductId) {loadProduct(product); return states.get(gameIdForProduct(product))!;}
  const unsubscribe = runtime.subscribe(() => {
    const live = runtime.getSnapshot();
    for (const [game, old] of states) {
      const epoch = live.game === game ? live.epoch : null;
      const status = availability(live, game);
      const invalidate = epoch !== old.epoch || !status.available;
      states.set(game, Object.freeze({...old, epoch, ...status,
        ...(invalidate ? {loaded: false, files: emptyFiles, notice: null} : {})}));
    }
    notify();
  });
  function run<T>(product: ProductId, kind: NonNullable<ReplaySnapshot['busy']>, operation: (access: RuntimeFileSession, game: GameId) => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('录像管理服务已关闭。'));
    const selected = state(product), game = selected.game;
    if (active) return Promise.reject(new Error('请等待当前录像操作完成。'));
    if (!selected.available) return Promise.reject(new Error(selected.unavailableReason ?? '录像文件服务尚未就绪。'));
    // Both owners acquire synchronously; same-tick repeated clicks cannot queue writes.
    const task = runtime.withFileSession(game, access => operation(access, game));
    const result = task.catch(error => {update(game, {error: message(error)}); throw error;})
      .finally(() => {if (active === result) active = null; update(game, {busy: null});});
    active = result; update(game, {busy: kind, error: null, notice: null});
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
  async function list(access: RuntimeFileSession, game: GameId) {
    // A failed refresh is not evidence that a previously displayed list is current.
    update(game, {loaded: false});
    await access.sync();
    const all = filesFrom(await access.send('list', {}));
    const files = Object.freeze(all.filter(file => isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path)));
    update(game, {files, loaded: true}); return all;
  }
  async function read(access: RuntimeFileSession, path: string): Promise<Uint8Array> {
    if (!isReplayFilePath(path) || !isSafeReplayArchivePath(path)) throw new Error('只能读取录像文件。');
    const result = await access.send('read', {path});
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
    loadProduct,
    getSnapshot: (product: ProductId) => states.get(gameIdForProduct(product)) ?? null,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh(product: ProductId) {return run(product, 'list', async (access, game) => {await list(access, game);});},
    importFile(product: ProductId, file: ReplayImportFile) {
      return run(product, 'import', async (access, game) => {
        const existing = await list(access, game);
        const entries = await importEntries(file, game, existing.map(entry => entry.path));
        const written: string[] = [];
        try {
          for (const entry of entries) {await access.send('write', {path: entry.path, bytes: Array.from(entry.bytes)}); written.push(entry.path);}
          await list(access, game);
        } catch (error) {
          update(game, {loaded: false});
          throw new Error(`导入未完成，已有 ${written.length} 个录像获得保存确认；请重新读取列表后检查。${message(error)}`);
        }
        update(game, {notice: `已导入 ${written.length} 个录像。重名文件已分配新名称，没有覆盖原录像。`});
        return Object.freeze(written);
      });
    },
    exportFile(product: ProductId, path: string) {
      return run(product, 'export', async (access, game): Promise<ReplayDownload> => {
        const files = await list(access, game), file = files.find(entry => entry.path === path && isReplayFilePath(entry.path));
        if (!file || file.size > limits.fileBytes) throw new Error('此录像不存在或超过大小限制。');
        return {name: file.name, type: 'application/octet-stream', bytes: await read(access, path)};
      });
    },
    exportAll(product: ProductId) {
      return run(product, 'export', async (access, game): Promise<ReplayDownload> => {
        const files = (await list(access, game)).filter(file => isReplayFilePath(file.path));
        if (!files.length) throw new Error('没有可导出的录像。');
        if (files.some(file => file.size > limits.fileBytes) || files.reduce((size, file) => size + file.size, 0) > limits.expandedBytes) throw new Error('录像总大小过大，请分开下载。');
        const entries: Record<string, Uint8Array> = Object.create(null); let size = 0;
        for (const path of selectReplayExportPaths(files.map(file => file.path))) {
          const bytes = await read(access, path); size += bytes.length;
          if (size > limits.expandedBytes) throw new Error('录像总大小过大，请分开下载。');
          entries[path] = bytes;
        }
        const {zipSync} = await import('fflate');
        return {name: `${game}-replay-${now().toISOString().slice(0, 10)}.zip`, type: 'application/zip', bytes: zipSync(entries, {level: 1})};
      });
    },
    requestDelete(product: ProductId, path: string): ReplayDeleteConfirmation {
      const selected = state(product), file = selected.files.find(entry => entry.path === path);
      if (active || !selected.available || !selected.loaded || selected.epoch === null || !file) throw new Error('请重新读取录像列表后再删除。');
      const ticket = Object.freeze({game: selected.game, epoch: selected.epoch, ...file}); confirmations.add(ticket); return ticket;
    },
    cancelDelete(ticket: ReplayDeleteConfirmation) {confirmations.delete(ticket);},
    confirmDelete(ticket: ReplayDeleteConfirmation) {
      if (!confirmations.delete(ticket)) return Promise.reject(new Error('删除需要先确认具体录像。'));
      const live = runtime.getSnapshot();
      if (live.game !== ticket.game || live.epoch !== ticket.epoch) return Promise.reject(new Error('游戏会话已改变，请重新确认删除。'));
      return run(ticket.game, 'delete', async (access, game) => {
        const current = (await list(access, game)).find(file => file.path === ticket.path && isReplayFilePath(file.path));
        if (!current || current.size !== ticket.size) throw new Error('录像信息已改变，请重新确认删除。');
        await access.send('remove', {path: ticket.path});
        update(game, {loaded: false});
        await list(access, game); update(game, {notice: `已删除 ${ticket.name}。`});
      });
    },
    dispose() {disposed = true; unsubscribe(); listeners.clear();},
  });
}
export type ReplayController = ReturnType<typeof createReplayController>;
