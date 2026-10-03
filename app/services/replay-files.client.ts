/** Serialized Replay operations over the existing Runtime file protocol. */
import { unzipSync, zipSync } from 'fflate';
import { PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId } from '../../src/contracts/product-catalog.mts';
import { allocateReplayName, createReplayArchiveExtractionGuard, createReplayMutationQueue, isReplayFilePath,
  isReplayImportFileName, isReplayTargetAvailable, isValidReplayName, planReplayArchiveImport, selectReplayExportPaths,
} from '../../src/launcher/replay-files.mts';
import type { RuntimeLaunchRequest, RuntimeService, RuntimeSnapshot } from './runtime.client';

export interface ReplayFile { path: string; size: number }
export interface ReplayDownload { name: string; bytes: Uint8Array; type: string }
export type ReplayConfirmation =
  | { kind: 'close-runtime'; productId: ProductId; requestedProductId: ProductId; purpose: 'manage' | 'change' | 'play' }
  | { kind: 'delete'; path: string }
  | { kind: 'replace'; path: string };
export interface ReplayRuntimePort extends Pick<RuntimeService, 'getSnapshot' | 'prepare' | 'launch' | 'close' | 'list' | 'read' | 'write' | 'remove' | 'sync'> {}
interface Lease { productId: ProductId; epoch: number }
interface LeaseUsers { lease: Lease; temporary: boolean; users: Set<symbol> }
interface SharedOwner { queue: ReturnType<typeof createReplayMutationQueue>; leases: Map<number, LeaseUsers> }
const owners = new WeakMap<ReplayRuntimePort, SharedOwner>();
const maxImportBytes = 128 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
const maxExpandedBytes = 128 * 1024 * 1024;
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export class ReplaySessionChangedError extends Error {
  override name = 'AbortError';
  constructor() { super('游戏会话已变化，请重新读取 Replay 列表'); }
}
function sameSession(snapshot: RuntimeSnapshot, lease: Lease) {
  return snapshot.ready && snapshot.productId === lease.productId && snapshot.epoch === lease.epoch;
}
function filesFromResponse(response: Awaited<ReturnType<ReplayRuntimePort['list']>>): ReplayFile[] {
  if (!Array.isArray(response.files)) throw new Error('Runtime 返回了无效的文件列表');
  return response.files.map(value => {
    if (!value || typeof value !== 'object' || typeof (value as { path?: unknown }).path !== 'string') throw new Error('Runtime 返回了无效的文件记录');
    const item = value as { path: string; size?: unknown };
    return { path: item.path, size: Math.max(0, Number(item.size) || 0) };
  });
}
export function createReplayFileService({ runtime, productId, getLaunchRequest, confirm }: {
  runtime: ReplayRuntimePort;
  productId: ProductId;
  getLaunchRequest: () => Pick<RuntimeLaunchRequest, 'language' | 'music' | 'options'>;
  confirm: (request: ReplayConfirmation) => Promise<boolean>;
}) {
  let shared = owners.get(runtime);
  if (!shared) { shared = { queue: createReplayMutationQueue(), leases: new Map() }; owners.set(runtime, shared); }
  const owner = shared;
  const user = Symbol('Replay view');
  const game = gameIdForProduct(productId);
  const prefix = PRODUCT_GAMES[game].replay.prefix;
  let lease: Lease | null = null;
  let disposed = false;
  function assertLease(expected: Lease) {
    if (!sameSession(runtime.getSnapshot(), expected)) throw new ReplaySessionChangedError();
  }
  async function step<T>(expected: Lease, action: () => Promise<T>): Promise<T> {
    assertLease(expected); const result = await action(); assertLease(expected); return result;
  }
  function claim(next: Lease, temporary: boolean) {
    if (lease && lease.epoch !== next.epoch) {
      const previous = owner.leases.get(lease.epoch); previous?.users.delete(user);
      if (previous && !previous.users.size) owner.leases.delete(lease.epoch);
    }
    lease = next;
    const entry = owner.leases.get(next.epoch) ?? { lease: next, temporary, users: new Set<symbol>() };
    entry.temporary ||= temporary; entry.users.add(user); owner.leases.set(next.epoch, entry);
    return next;
  }
  async function approvedClose(purpose: 'manage' | 'change' | 'play') {
    const current = runtime.getSnapshot();
    if (current.launched) {
      if (!current.productId || !await confirm({ kind: 'close-runtime', productId: current.productId, requestedProductId: productId, purpose })) return false;
      // A delayed confirmation must never close a newly launched game.
      const now = runtime.getSnapshot();
      if (now.productId !== current.productId || now.epoch !== current.epoch) throw new ReplaySessionChangedError();
    }
    await runtime.close(); // A save failure preserves the Runtime and reaches the UI.
    return true;
  }
  async function prepare(): Promise<Lease> {
    const current = runtime.getSnapshot();
    if (current.ready && current.productId === productId && current.epoch != null) return claim({ productId, epoch: current.epoch }, false);
    if (['preparing', 'loading', 'configuring', 'launching', 'saving'].includes(current.phase)) throw new Error('游戏正在执行操作，请稍后重试');
    if (current.ready || current.launched) {
      if (!await approvedClose('manage')) throw new Error('已保留当前游戏，未切换 Replay 列表');
    }
    const prepared = await runtime.prepare({ ...getLaunchRequest(), music: 'none', productId, replayViewer: isMultiplayerProductId(productId) });
    if (!prepared.ready || prepared.productId !== productId || prepared.epoch == null || !sameSession(runtime.getSnapshot(), { productId, epoch: prepared.epoch })) throw new ReplaySessionChangedError();
    return claim({ productId, epoch: prepared.epoch }, true);
  }
  async function writable(expected: Lease): Promise<Lease> {
    assertLease(expected);
    if (!runtime.getSnapshot().launched) return expected;
    if (!await approvedClose('change')) throw new Error('已保留当前游戏，未修改 Replay');
    return prepare();
  }
  function run<T>(operation: (expected: Lease) => Promise<T>, mutation = false): Promise<T> {
    const requestedLease = lease;
    return owner.queue.run(async () => {
      if (disposed) throw new ReplaySessionChangedError();
      let expected = requestedLease;
      if (expected) assertLease(expected); else expected = await prepare();
      if (mutation) expected = await writable(expected);
      return operation(expected);
    });
  }
  async function allFiles(expected: Lease): Promise<ReplayFile[]> {
    await step(expected, () => runtime.sync());
    return filesFromResponse(await step(expected, () => runtime.list()));
  }
  function pathAllowed(path: string) {
    if (!isReplayFilePath(path) || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) throw new Error('无效 Replay 文件路径');
  }
  async function verify(expected: Lease, path: string, bytes: Uint8Array) {
    const actual = await step(expected, () => runtime.read(path));
    if (actual.length !== bytes.length || actual.some((byte, index) => byte !== bytes[index])) throw new Error('Replay 写入校验失败，请重新读取列表');
  }
  return {
    productId,
    /** Refresh can deliberately acquire a new exact product session after navigation. */
    list() {
      return owner.queue.run(async () => {
        if (disposed) throw new ReplaySessionChangedError();
        const expected = await prepare();
        return (await allFiles(expected)).filter(file => isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
      });
    },
    exportOne(path: string): Promise<ReplayDownload> {
      pathAllowed(path);
      return run(async expected => {
        await step(expected, () => runtime.sync());
        return { name: basename(path), bytes: await step(expected, () => runtime.read(path)), type: 'application/octet-stream' };
      });
    },
    exportArchive(): Promise<ReplayDownload> {
      return run(async expected => {
        const paths = selectReplayExportPaths((await allFiles(expected)).map(file => file.path));
        if (!paths.length) throw new Error('没有可导出的 Replay');
        const entries: Record<string, Uint8Array> = Object.create(null);
        for (const path of paths) entries[path] = await step(expected, () => runtime.read(path));
        return { name: `${productId}-replay-${new Date().toISOString().slice(0, 10)}.zip`, bytes: zipSync(entries, { level: 1 }), type: 'application/zip' };
      });
    },
    importFile(file: File): Promise<number> {
      return run(async expected => {
        if (!isReplayImportFileName(file.name)) throw new Error('请选择 .rpy、.rpyx 或 .zip 文件');
        if (!file.size || file.size > maxImportBytes) throw new Error('导入文件必须为 1 字节至 128 MiB');
        const bytes = new Uint8Array(await step(expected, () => file.arrayBuffer()));
        const existing = (await allFiles(expected)).map(item => item.path);
        let files: Array<{ path: string; bytes: Uint8Array }>;
        if (/\.rpyx?$/i.test(file.name)) {
          const name = allocateReplayName(prefix, existing, file.name);
          if (!name) throw new Error('Replay 槽位已用完');
          files = [{ path: `replay/${name}`, bytes }];
        } else {
          const guard = createReplayArchiveExtractionGuard({ maxFileBytes: maxStoredFileBytes, maxExpandedBytes });
          const archive = unzipSync(bytes, { filter: guard.filter });
          const plan = planReplayArchiveImport(prefix, guard.paths, existing);
          if (!plan.ok) throw new Error(`Replay ZIP 无法导入：${plan.reason}`);
          files = plan.entries.map(item => ({ path: item.targetPath, bytes: archive[item.sourcePath]! }));
        }
        if (!files.length) throw new Error('ZIP 中没有 Replay 文件');
        if (files.some(item => !item.bytes.length || item.bytes.length > maxStoredFileBytes)) throw new Error('每个 Replay 必须为 1 字节至 64 MiB');
        for (const file of files) await step(expected, () => runtime.write(file.path, file.bytes));
        await step(expected, () => runtime.sync());
        for (const file of files) await verify(expected, file.path, file.bytes);
        return files.length;
      }, true);
    },
    rename(path: string, name: string): Promise<void> {
      pathAllowed(path);
      const targetName = name.trim();
      if (!isValidReplayName(prefix, targetName)) return Promise.reject(new Error(`名称格式应为 ${prefix}_01.rpy 或 ${prefix}_ud0000.rpyx`));
      const target = `replay/${targetName}`;
      return run(async expected => {
        if (target.toLowerCase() === path.toLowerCase()) return;
        const existing = (await allFiles(expected)).map(item => item.path);
        const destination = existing.find(item => item.toLowerCase() === target.toLowerCase()) ?? target;
        if (!isReplayTargetAvailable(existing, target)) {
          if (!await confirm({ kind: 'replace', path: target })) return;
          assertLease(expected);
        }
        const bytes = await step(expected, () => runtime.read(path));
        await step(expected, () => runtime.write(destination, bytes));
        // Keep the original until the target is durable and read-back verified.
        await step(expected, () => runtime.sync()); await verify(expected, destination, bytes);
        await step(expected, () => runtime.remove(path)); await step(expected, () => runtime.sync());
      }, true);
    },
    remove(path: string): Promise<void> {
      pathAllowed(path);
      return run(async expected => {
        if (!await confirm({ kind: 'delete', path })) return;
        assertLease(expected);
        await step(expected, () => runtime.remove(path)); await step(expected, () => runtime.sync());
      }, true);
    },
    play(): Promise<RuntimeSnapshot> {
      return owner.queue.run(async () => {
        if (disposed) throw new ReplaySessionChangedError();
        const current = runtime.getSnapshot();
        if (['preparing', 'loading', 'configuring', 'launching', 'saving'].includes(current.phase)) throw new Error('游戏正在执行操作，请稍后重试');
        if (!await approvedClose('play')) throw new Error('已保留当前游戏');
        // Existing protocol opens the title's Replay menu, not a host-invented file-play command.
        return runtime.launch({ ...getLaunchRequest(), productId, replayViewer: isMultiplayerProductId(productId) });
      });
    },
    dispose(): Promise<void> {
      disposed = true;
      return owner.queue.run(async () => {
        const previous = lease; lease = null;
        if (!previous) return;
        const entry = owner.leases.get(previous.epoch);
        entry?.users.delete(user);
        if (!entry || entry.users.size) return;
        owner.leases.delete(previous.epoch);
        if (entry.temporary && sameSession(runtime.getSnapshot(), previous) && !runtime.getSnapshot().launched) await runtime.close();
      });
    },
  };
}
export type ReplayFileService = ReturnType<typeof createReplayFileService>;
