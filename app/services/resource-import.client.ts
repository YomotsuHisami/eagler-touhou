/** Review/confirm local inputs without DOM, Runtime or a second storage writer.
 * ZIP parsing remains with existing readers; all mutations use Package ownership.
 */
import {gameIdForProduct, isProductId, PRODUCT_GAMES, HOST_PROTOCOL, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {HOST_MANIFEST_FILE, validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import type {CurrentPackageGeneration, InstalledPackageResult, PackageDescriptor, PackageInstallation} from '../../src/contracts/package-read-models.mts';
import {rawDataImportFileNames, rawDataImportMatchesFileName, rawDataImportSizeMatches, rawDataImportHashMatches, createRawDataImportPackageDescriptor} from '../../src/launcher/raw-data-import.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import {parsePackageZip, type ParsedPackageZip} from '../../package/package-zip.mjs';
import {validatePackageDescriptor} from '../../package/package-descriptor.mjs';
import {installPackageFromAcquisition, removeInstalledPackage, type PackageInstallProgress} from '../../package/package-installer.mjs';
import {readCurrentPackageGeneration} from '../../package/package-store.mjs';
import {parseStoredGameDataPack} from '../../legacy/legacy-game-pack.mjs';
import {adaptLegacyGamePackToPackage} from '../../legacy/legacy-package-adapter.mjs';

export const MAX_RESOURCE_IMPORT_BYTES = 256 * 1024 * 1024;
export interface ResourceImportReview {
  readonly id: string; readonly kind: 'import' | 'remove'; readonly productId: ProductId; readonly gameId: GameId;
  readonly format: 'package-zip' | 'legacy-zip' | 'raw-data' | null;
  readonly fileName: string | null; readonly revision: string; readonly previousGenerationId: string | null;
  readonly files: number; readonly bytes: number; readonly sha256VerifiedFiles: number;
  readonly warnings: readonly string[];
}
export interface ResourceImportSnapshot {
  readonly review: ResourceImportReview | null;
  readonly operation: Readonly<{kind: 'inspect' | 'commit'; productId: ProductId; cancelRequested: boolean; progress: Readonly<PackageInstallProgress> | null}> | null;
  readonly error: string | null;
  readonly errorGameId: GameId | null;
  readonly outcome: Readonly<{kind: 'import' | 'remove'; gameId: GameId; generationId: string | null}> | null;
}
export interface ResourceImportDependencies {
  parseZip: typeof parsePackageZip; parseLegacy: typeof parseStoredGameDataPack; adaptLegacy: typeof adaptLegacyGamePackToPackage;
  readCurrent: typeof readCurrentPackageGeneration; install: typeof installPackageFromAcquisition; remove: typeof removeInstalledPackage;
}
export interface ResourceImportOptions {
  baseUrl: string; fetchImpl?: typeof fetch; requestTimeoutMs?: number;
  dependencies?: Partial<ResourceImportDependencies>;
}
interface Prepared {review: ResourceImportReview; parsed: ParsedPackageZip | null}
interface Job {controller: AbortController; productId: ProductId; key: unknown; promise: Promise<unknown>; committed: boolean}
export class ResourceImportError extends Error {
  constructor(readonly code: 'cancelled' | 'busy' | 'invalid-input' | 'invalid-package' | 'stale-review' | 'host-unavailable' | 'disposed', message: string) {
    super(message); this.name = code === 'cancelled' ? 'AbortError' : 'ResourceImportError';
  }
}
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
function fail(code: ResourceImportError['code'], message: string): never {throw new ResourceImportError(code, message);}
function cancelled(signal: AbortSignal) {if (signal.aborted) fail('cancelled', '资源操作已取消');}
function gameFor(productId: ProductId): GameId {
  if (!isProductId(productId)) fail('invalid-input', '未知作品标识');
  return gameIdForProduct(productId);
}
function validateCurrent(current: CurrentPackageGeneration, game: GameId) {
  const {installation, generation} = current;
  if (installation && installation.game !== game || (installation?.currentGeneration ?? null) !== (generation?.id ?? null) ||
      generation && generation.game !== game) fail('invalid-package', '当前 Package 安装标识不一致');
  if (generation) {
    const descriptor = validatePackageDescriptor(generation.descriptor);
    if (descriptor.game !== game) fail('invalid-package', '已安装 Package 的作品不匹配');
  }
  return current;
}
function validateParsed(parsed: ParsedPackageZip, game: GameId, requireShared: boolean) {
  const descriptor = validatePackageDescriptor(parsed.descriptor);
  if (descriptor.game !== game) fail('invalid-package', `此资源属于 ${descriptor.game.toUpperCase()}，不能导入 ${game.toUpperCase()}`);
  const requirement = descriptor.runtimeRequirement;
  if (requirement && (requirement.target !== game || requirement.protocol !== HOST_PROTOCOL || !descriptor.base.files.includes(requirement.dataFile) ||
      descriptor.files[requirement.dataFile]?.target !== PRODUCT_GAMES[game].package.dataTarget)) fail('invalid-package', 'Package 的基础数据与作品标识不匹配');
  for (const id of descriptor.base.files) if (!(parsed.files.get(id)?.blob instanceof Blob)) fail('invalid-package', `缺少基础资源：${id}`);
  if (requireShared) {
    const product = PRODUCT_GAMES[game];
    const required = 'requiredShared' in product ? product.requiredShared : [];
    const targets = new Set(descriptor.base.files.map(id => descriptor.files[id].target));
    for (const target of required) if (!targets.has(target)) fail('invalid-package', `缺少基础资源：${target}`);
  }
  for (const [id, file] of parsed.files) if (!Object.hasOwn(descriptor.files, id) || !(file.blob instanceof Blob)) fail('invalid-package', 'ZIP 含有未声明的资源文件');
}

export function resourceImportFileNames(productId: ProductId) {return rawDataImportFileNames(gameFor(productId));}

export function createResourceImport(options: ResourceImportOptions) {
  const base = new URL(options.baseUrl);
  if (!['https:', 'http:'].includes(base.protocol) || !base.pathname.endsWith('/') || base.username || base.password || base.search || base.hash ||
      globalThis.location && base.origin !== globalThis.location.origin) fail('invalid-input', '资源导入需要同源应用目录');
  const deps: ResourceImportDependencies = {parseZip: parsePackageZip, parseLegacy: parseStoredGameDataPack, adaptLegacy: adaptLegacyGamePackToPackage,
    readCurrent: readCurrentPackageGeneration, install: installPackageFromAcquisition, remove: removeInstalledPackage, ...options.dependencies};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<() => void>();
  let snapshot: ResourceImportSnapshot = Object.freeze({review: null, operation: null, error: null, errorGameId: null, outcome: null});
  let prepared: Prepared | null = null, active: Job | null = null, serial = 0, disposed = false;
  function update(patch: Partial<ResourceImportSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch}); for (const listener of listeners) listener();
  }
  async function host(signal: AbortSignal): Promise<HostManifest> {
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, options.requestTimeoutMs ?? 15_000);
    try {
      cancelled(signal);
      const response = await fetchImpl(new URL(HOST_MANIFEST_FILE, base), {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = validateHostManifest(await response.json()); cancelled(signal); return result;
    } catch (error) {cancelled(signal); fail('host-unavailable', `无法验证站点的原版数据声明：${text(error)}`);}
    finally {clearTimeout(timer); signal.removeEventListener('abort', abort);}
  }
  function rejected(error: unknown): Promise<never> {const promise = Promise.reject<never>(error); void promise.catch(() => {}); return promise;}
  function run<T>(productId: ProductId, kind: 'inspect' | 'commit', key: unknown, work: (job: Job) => Promise<T>): Promise<T> {
    if (disposed) return rejected(new ResourceImportError('disposed', '资源导入服务已关闭'));
    try {gameFor(productId);} catch (error) {return rejected(error);}
    if (active) return active.productId === productId && active.key === key ? active.promise as Promise<T>
      : rejected(new ResourceImportError('busy', '请等待或取消当前资源导入任务'));
    const job = {controller: new AbortController(), productId, key, committed: false} as Job;
    job.promise = Promise.resolve().then(() => {cancelled(job.controller.signal); return work(job);}).catch(error => {
      const failure = job.controller.signal.aborted && !job.committed ? new ResourceImportError('cancelled', '资源操作已取消') : error;
      if (job.controller.signal.aborted) {prepared = null; update({review: null});}
      update({error: text(failure), errorGameId: gameFor(productId)}); throw failure;
    }).finally(() => {if (active === job) {active = null; update({operation: null});}});
    void job.promise.catch(() => {}); active = job;
    update({error: null, errorGameId: null, outcome: null, operation: Object.freeze({kind, productId, cancelRequested: false, progress: null})});
    return job.promise as Promise<T>;
  }
  function inspectImport(productId: ProductId, file: Blob, fileName: string): Promise<ResourceImportReview> {
    return run(productId, 'inspect', file, async job => {
      prepared = null; update({review: null});
      const gameId = gameFor(productId), signal = job.controller.signal;
      if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_RESOURCE_IMPORT_BYTES || typeof fileName !== 'string' || !fileName) {
        fail('invalid-input', '请选择不大于 256 MiB 的 Package ZIP 或此作品支持的原版 DATA 文件');
      }
      let parsed: ParsedPackageZip, format: ResourceImportReview['format'];
      const warnings: string[] = [];
      const raw = rawDataImportMatchesFileName(gameId, fileName);
      if (raw) {
        const manifest = await host(signal), expected = manifest.games[gameId]?.gameData;
        if (!expected) fail('host-unavailable', '当前站点没有此作品的数据声明');
        if (!rawDataImportSizeMatches(expected, file.size)) fail('invalid-input', '原版 DATA 文件大小与当前站点声明不匹配');
        const bytes = await file.arrayBuffer(); cancelled(signal);
        const hash = await sha256Hex(new Uint8Array(bytes)); cancelled(signal);
        if (!rawDataImportHashMatches(expected, hash)) fail('invalid-input', '原版 DATA 的 SHA-256 与当前站点声明不匹配');
        const descriptor = createRawDataImportPackageDescriptor(gameId, expected, hash);
        const id = descriptor.runtimeRequirement!.dataFile;
        // The raw acquisition contract already verified this authoritative hash;
        // retain it so Package core can verify again before committing.
        descriptor.files[id] = {...descriptor.files[id], sha256: hash};
        parsed = {descriptor, files: new Map([[id, {blob: new Blob([bytes])}]])}; format = 'raw-data';
        warnings.push('原版 DATA 只替换基础数据；不会包含音乐、语言包或站点 Runtime。');
      } else {
        try {parsed = await deps.parseZip(file); format = 'package-zip';}
        catch (error) {
          cancelled(signal);
          // A malformed modern Package must never silently become a legacy
          // import. Only the reader's exact missing-descriptor case can adapt.
          if (!/^Package ZIP is missing package\.json$/.test(text(error))) throw error;
          const legacy = await deps.parseLegacy(file); cancelled(signal);
          if (legacy.manifest.game !== gameId) fail('invalid-package', '历史资源包的作品标识不匹配');
          if (!legacy.offline) {
            const manifest = await host(signal);
            if (manifest.shared.resourceMode === 'import') fail('invalid-package', '此离线站点需要包含共享资源的离线包');
          }
          parsed = deps.adaptLegacy(legacy, {protocol: HOST_PROTOCOL}); format = 'legacy-zip';
          warnings.push('历史 ZIP 仅作为输入读取；其中的可执行 Runtime 不会导入。');
        }
      }
      cancelled(signal); validateParsed(parsed, gameId, !raw);
      let bytes = 0, verified = 0, completed = 0;
      for (const [id, entry] of parsed.files) {
        const declaration = parsed.descriptor.files[id]; bytes += entry.blob.size;
        if (bytes > MAX_RESOURCE_IMPORT_BYTES) fail('invalid-input', '展开后的资源超过 256 MiB');
        if (declaration.bytes !== undefined && declaration.bytes !== entry.blob.size) fail('invalid-package', `${id}：文件大小不匹配`);
        if (declaration.sha256) {
          const digest = await sha256Hex(new Uint8Array(await entry.blob.arrayBuffer())); cancelled(signal);
          if (digest !== declaration.sha256.toLowerCase()) fail('invalid-package', `${id}：SHA-256 校验失败`);
          verified++;
        }
        completed++; update({operation: Object.freeze({...snapshot.operation!, progress: Object.freeze({completed, total: parsed.files.size, fileId: id, found: true})})});
      }
      if (verified < parsed.files.size) warnings.push('部分旧版文件未声明 SHA-256；只能校验 ZIP CRC32 与已声明的长度。');
      const current = validateCurrent(await deps.readCurrent(gameId), gameId); cancelled(signal);
      const review: ResourceImportReview = Object.freeze({id: `review-${++serial}`, kind: 'import', productId, gameId, format,
        fileName, revision: parsed.descriptor.revision, previousGenerationId: current.generation?.id ?? null,
        files: parsed.files.size, bytes, sha256VerifiedFiles: verified, warnings: Object.freeze(warnings)});
      // Never expose mutable parsed descriptors, Blob maps, or input references
      // through the public review. Later imports cannot mutate an older review.
      prepared = {review, parsed: {descriptor: structuredClone(parsed.descriptor), files: new Map(parsed.files)}};
      update({review}); return review;
    });
  }
  function inspectRemoval(productId: ProductId): Promise<ResourceImportReview> {
    return run(productId, 'inspect', `remove:${productId}`, async job => {
      prepared = null; update({review: null});
      const gameId = gameFor(productId), current = validateCurrent(await deps.readCurrent(gameId), gameId);
      cancelled(job.controller.signal);
      if (!current.generation) fail('invalid-input', '此浏览器没有此作品的已安装资源');
      const {generation} = current;
      const ids = Object.keys(generation.files).filter(id => !!generation.files[id]?.objectId);
      const review: ResourceImportReview = Object.freeze({id: `review-${++serial}`, kind: 'remove', productId, gameId, format: null,
        fileName: null, revision: generation.descriptor.revision, previousGenerationId: generation.id, files: ids.length,
        bytes: ids.reduce((total, id) => total + Number(generation.descriptor.files[id]?.bytes ?? 0), 0), sha256VerifiedFiles: 0,
        warnings: Object.freeze(['这会解除此作品全部基础与可选资源的安装；单机和联机入口共用此安装。', '存档不会删除。正在运行的会话保留其资源；磁盘空间不保证立即释放。'])});
      prepared = {review, parsed: null}; update({review}); return review;
    });
  }
  function confirm(reviewId: string): Promise<InstalledPackageResult | PackageInstallation> {
    const selected = prepared;
    if (!selected || selected.review.id !== reviewId) return rejected(new ResourceImportError('stale-review', '资源预览已失效，请重新选择并检查'));
    return run(selected.review.productId, 'commit', reviewId, async job => {
      const {review, parsed} = selected, signal = job.controller.signal;
      if (prepared !== selected) fail('stale-review', '资源预览已被替换');
      const result = review.kind === 'remove' ? await deps.remove(review.gameId, {expectedGenerationId: review.previousGenerationId!, signal})
        : await deps.install({descriptor: parsed!.descriptor, desiredFileIds: [...parsed!.files.keys()],
          source: 'local', reuseCurrent: false, expectedGenerationId: review.previousGenerationId, signal,
          acquire: async id => {cancelled(signal); const bytes = await parsed!.files.get(id)!.blob.arrayBuffer(); cancelled(signal); return bytes;},
          onProgress(progress) {if (active === job) update({operation: Object.freeze({...snapshot.operation!, progress: Object.freeze({...progress})})});},
        });
      job.committed = true; prepared = null;
      update({review: null, outcome: Object.freeze({kind: review.kind, gameId: review.gameId,
        generationId: review.kind === 'import' ? (result as InstalledPackageResult).generation.id : null})});
      return result;
    });
  }
  function cancel() {
    if (active && !active.committed) {active.controller.abort(); update({operation: Object.freeze({...snapshot.operation!, cancelRequested: true})});}
    else if (!active) {prepared = null; update({review: null, error: null, errorGameId: null});}
  }
  return Object.freeze({getSnapshot: () => snapshot,
    subscribe(listener: () => void) {if (disposed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    inspectImport, inspectRemoval, confirm, cancel,
    dispose() {if (disposed) return; cancel(); prepared = null; disposed = true; listeners.clear();},
  });
}
export type ResourceImportController = ReturnType<typeof createResourceImport>;
