import {gameIdForProduct, PRODUCT_GAMES, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from './runtime.client';
import {productRuntimeFileIdentity, runtimeMatchesProductFileIdentity, type FilePreparationResult} from './file-preparation.client';

export interface HintImportFile {readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>}
export interface HintSnapshot {
  readonly productId: ProductId;
  readonly game: GameId;
  readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly epoch: number | null;
  readonly supported: boolean;
  readonly hintFiles: readonly string[];
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly fileOperationBusy: boolean;
  readonly busy: 'import' | 'delete' | null;
  readonly error: string | null;
  readonly notice: 'imported' | 'deleted' | null;
}
type RuntimePort = Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession' | 'close'>;
type ProductPreparer = (productId: ProductId, signal?: AbortSignal) => Promise<FilePreparationResult | unknown>;
const maxHintBytes = 16 * 1024 * 1024;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function pathsFor(game: GameId): readonly string[] {
  const storage = PRODUCT_GAMES[game].storage;
  return 'hintFiles' in storage ? storage.hintFiles : [];
}
function availability(live: RuntimeSnapshot, product: ProductId) {
  const identity = productRuntimeFileIdentity(product), game = identity.game;
  const available = runtimeMatchesProductFileIdentity(live, identity) && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable;
  const unavailableReason = available ? null : live.game === game && live.runtimeVariant !== identity.runtimeVariant ? '当前 Runtime 的普通/多人文件身份与所选作品不一致。'
    : live.saveUnavailable ? '当前 Runtime 已失去保存能力，请先处理退出提示。'
    : live.launched || ['launching', 'running', 'saving'].includes(live.phase) ? '请先结束游戏并完成保存，再管理本机提示文件。'
      : `尚未准备 ${game.toUpperCase()} 的文件服务。`;
  return {available, unavailableReason};
}

/** TH10's original hint_user/hint_auto files, accessed through the existing Runtime session. */
export function createHintController({runtimeService: runtime, prepareProduct}: {runtimeService: RuntimePort; prepareProduct?: ProductPreparer}) {
  const states = new Map<ProductId, HintSnapshot>(), listeners = new Set<() => void>();
  let disposed = false, active: Promise<unknown> | null = null;
  function notify() {if (!disposed) for (const listener of [...listeners]) listener();}
  function update(product: ProductId, patch: Partial<HintSnapshot>) {
    const old = states.get(product); if (old && !disposed) {states.set(product, Object.freeze({...old, ...patch})); notify();}
  }
  function loadProduct(product: ProductId) {
    if (disposed) return;
    const identity = productRuntimeFileIdentity(product), game = identity.game; if (states.has(product)) return;
    const live = runtime.getSnapshot(), hintFiles = pathsFor(game);
    states.set(product, Object.freeze({productId: product, game, runtimeVariant: identity.runtimeVariant,
      epoch: runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null, supported: hintFiles.length > 0,
      hintFiles, ...availability(live, product), fileOperationBusy: live.fileOperationBusy, busy: null, error: null, notice: null})); notify();
  }
  function state(product: ProductId) {
    if (disposed) throw new Error('提示文件服务已关闭。');
    loadProduct(product); return states.get(product)!;
  }
  function assertCurrent(access: RuntimeFileSession, product: ProductId) {
    const live = runtime.getSnapshot();
    if (live.epoch !== access.epoch || !availability(live, product).available) throw new Error('游戏会话或普通/多人文件身份已改变，提示文件操作没有完成。');
  }
  const unsubscribe = runtime.subscribe(() => {
    const live = runtime.getSnapshot();
    for (const [product, old] of states) {
      const identity = productRuntimeFileIdentity(product);
      const epoch = runtimeMatchesProductFileIdentity(live, identity) ? live.epoch : null, status = availability(live, product);
      const invalidate = epoch !== old.epoch || !status.available;
      states.set(product, Object.freeze({...old, epoch, ...status, fileOperationBusy: live.fileOperationBusy,
        ...(invalidate ? {error: null} : {}), notice: epoch !== old.epoch ? null : old.notice}));
    }
    notify();
  });
  async function ensurePrepared(product: ProductId) {
    const selected = state(product);
    if (!selected.supported) throw new Error('此作品没有可管理的提示文件。');
    const game = selected.game, identity = productRuntimeFileIdentity(product), live = runtime.getSnapshot();
    if (live.fileOperationBusy) throw new Error('请等待当前 Runtime 文件操作完成。');
    if (runtimeMatchesProductFileIdentity(live, identity) && live.ready && live.phase === 'prepared' && !live.launched && !live.saveUnavailable) return;
    if (live.game === game && live.runtimeVariant !== identity.runtimeVariant) throw new Error('当前 Runtime 的普通/多人文件身份与所选作品不一致。');
    if (live.game !== null && live.game !== game && !['idle', 'exited', 'error'].includes(live.phase)) throw new Error('请先结束当前作品，再管理提示文件。');
    if (live.game === game && runtimeMatchesProductFileIdentity(live, identity) && (live.launched || ['launching', 'running', 'saving'].includes(live.phase))) {
      if (live.phase === 'running' && live.launched && live.epoch !== null) {
        await runtime.withFileSession(game, access => access.sync(), {readOnly: true, runtimeVariant: identity.runtimeVariant, epoch: live.epoch});
        const current = runtime.getSnapshot();
        if (!runtimeMatchesProductFileIdentity(current, identity) || current.epoch !== live.epoch || current.phase !== 'running' || !current.launched) {
          throw new Error('游戏会话已改变，提示文件没有更改。');
        }
      }
      if (!await runtime.close()) throw new Error(runtime.getSnapshot().saveError ?? '当前游戏未能安全退出，提示文件没有更改。');
    }
    if (!prepareProduct) throw new Error(selected.unavailableReason ?? '作品准备服务尚未连接。');
    await prepareProduct(product);
    const ready = state(product);
    if (!ready.available) throw new Error(ready.unavailableReason ?? '提示文件服务尚未就绪。');
  }
  function run<T>(product: ProductId, kind: NonNullable<HintSnapshot['busy']>, operation: (access: RuntimeFileSession, game: GameId) => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('提示文件服务已关闭。'));
    const selected = state(product), game = selected.game;
    if (!selected.supported) return Promise.reject(new Error('此作品没有可管理的提示文件。'));
    if (active || selected.fileOperationBusy) return Promise.reject(new Error('请等待当前文件操作完成。'));
    const task = Promise.resolve().then(async () => {
      await ensurePrepared(product);
      if (disposed) throw new Error('提示文件服务已关闭。');
      return runtime.withFileSession(game, access => operation(access, game),
        {runtimeVariant: selected.runtimeVariant, epoch: runtime.getSnapshot().epoch ?? undefined});
    });
    const result = task.catch(error => {update(product, {error: message(error)}); throw error;})
      .finally(() => {if (active === result) active = null; update(product, {busy: null});});
    active = result; update(product, {busy: kind, error: null, notice: null}); void result.catch(() => {}); return result;
  }
  async function listPaths(access: RuntimeFileSession, product: ProductId) {
    await access.sync();
    const listed = await access.send('list', {}); assertCurrent(access, product);
    if (!Array.isArray(listed.files)) throw new Error('Runtime 返回的文件列表无效。');
    const paths = new Set<string>();
    for (const file of listed.files) {
      if (!file || typeof file !== 'object' || typeof (file as {path?: unknown}).path !== 'string') throw new Error('Runtime 返回的文件信息无效。');
      paths.add((file as {path: string}).path);
    }
    return paths;
  }
  async function verifyFile(access: RuntimeFileSession, product: ProductId, path: string, expected: Uint8Array) {
    const restored = await access.restart({sync: false});
    if (restored.epoch === access.epoch) throw new Error('Runtime 未重新载入，无法验证提示文件。');
    const result = await restored.send('read', {path}); assertCurrent(restored, product);
    if (!Array.isArray(result.bytes) || result.bytes.length !== expected.length || result.bytes.some((byte, index) => byte !== expected[index])) {
      throw new Error('重新载入后的提示文件内容不一致。');
    }
    await restored.retire();update(product, {epoch: null, notice: 'imported'});
  }
  return Object.freeze({
    loadProduct,
    getSnapshot: (product: ProductId) => states.get(product) ?? null,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    importFile(product: ProductId, file: HintImportFile) {
      if (!/\.txt$/i.test(file.name)) return Promise.reject(new Error('请选择 .txt 提示文件。'));
      if (!Number.isSafeInteger(file.size) || file.size <= 0) return Promise.reject(new Error('不能导入空提示文件。'));
      if (file.size > maxHintBytes) return Promise.reject(new Error('提示文件超过 16 MiB 大小限制。'));
      return run(product, 'import', async (access, game) => {
        const path = pathsFor(game)[0]; if (!path) throw new Error('此作品没有可上传的用户提示文件。');
        const bytes = new Uint8Array(await file.arrayBuffer()); assertCurrent(access, product);
        if (bytes.length !== file.size || bytes.length > maxHintBytes) throw new Error('提示文件大小发生变化。');
        await access.sync(); assertCurrent(access, product);
        await access.send('write', {path, bytes: Array.from(bytes)}); assertCurrent(access, product);
        await verifyFile(access, product, path, bytes);
        return path;
      });
    },
    deleteFiles(product: ProductId) {
      return run(product, 'delete', async (access, game) => {
        const paths = pathsFor(game); if (!paths.length) throw new Error('此作品没有可删除的提示文件。');
        const existing = await listPaths(access, product);
        for (const path of paths) if (existing.has(path)) {await access.send('remove', {path}); assertCurrent(access, product);}
        const restored = await access.restart({sync: false});
        const remaining = await listPaths(restored, product);
        if (paths.some(path => remaining.has(path))) throw new Error('提示文件删除后仍然存在，请重新检查。');
        await restored.retire();update(product, {epoch: null, notice: 'deleted'});
        return paths;
      });
    },
    dispose() {disposed = true; unsubscribe(); listeners.clear();},
  });
}
export type HintController = ReturnType<typeof createHintController>;
