/** Resource jobs belong to the document, not to a route or a dialog.
 * The Package installer owns the mutation queue, staging, integrity checks and
 * atomic commit. This service never writes IndexedDB or owns Runtime leases.
 */
import { gameIdForProduct, isProductId, HOST_PROTOCOL, languagePriority, PRODUCT_GAMES, type GameId, type ProductId } from '../../src/contracts/product-catalog.mts';
import { RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, validateReleaseCatalog, type ReleaseCatalog } from '../../src/contracts/release-catalog.mts';
import { HOST_MANIFEST_FILE, validateHostManifest, type HostManifest } from '../../src/contracts/host-manifest.mts';
import { buildLanguageCatalog } from '../../src/launcher/language-catalog.mts';
import type { PreferencesContext } from './preferences.client';
import type { CurrentPackageGeneration, InstalledPackageGeneration, InstalledPackageResult, PackageDescriptor } from '../../src/contracts/package-read-models.mts';
import { validatePackageDescriptor } from '../../package/package-descriptor.mjs';
import { componentFileIds } from '../../package/package-generation.mjs';
import { desiredFilesForPublishedPackage } from '../../package/package-launcher.mjs';
import { installPackageFromAcquisition, type PackageInstallProgress } from '../../package/package-installer.mjs';
import { readCurrentPackageGeneration, readPackageObjectKeys } from '../../package/package-store.mjs';

export type ResourceErrorCode = 'invalid-product' | 'invalid-base-url' | 'metadata-unavailable' | 'invalid-package' |
  'storage-unavailable' | 'unknown-component' | 'not-removable' | 'changed-generation' | 'busy' | 'cancelled' | 'disposed' | 'operation-failed';
export class ResourceError extends Error {
  constructor(readonly code: ResourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options); this.name = code === 'cancelled' ? 'AbortError' : 'ResourceError';
  }
}
export interface ResourceIssue { readonly code: ResourceErrorCode; readonly message: string }
export interface ResourceComponent {
  readonly id: string; readonly type: string; readonly title: string;
  readonly fileCount: number; readonly bytes: number | null;
  readonly installedFileCount: number; readonly status: 'absent' | 'partial' | 'installed' | 'update';
  readonly canInstall: boolean; readonly canRemove: boolean;
  readonly installReason: string | null; readonly removeReason: string | null;
}
export interface ResourceInspection {
  readonly gameId: GameId; readonly generationId: string | null;
  readonly installedRevision: string | null; readonly publishedRevision: string | null;
  readonly source: 'local' | 'remote' | null; readonly updateAvailable: boolean;
  readonly baseFileCount: number; readonly installedBaseFileCount: number;
  readonly components: readonly ResourceComponent[];
  readonly warning: string | null;
  /** Presence checks do not rehash already installed bytes or validate a Runtime. */
  readonly integrityVerified: false;
}
export type ResourceJobKind = 'inspect' | 'install' | 'install-base' | 'remove';
export interface ResourceOperation {
  readonly kind: ResourceJobKind; readonly productId: ProductId; readonly gameId: GameId;
  readonly componentId: string | null; readonly cancelRequested: boolean;
  readonly progress: Readonly<PackageInstallProgress> | null;
}
export interface ResourceOutcome {
  readonly kind: ResourceJobKind; readonly gameId: GameId; readonly componentId: string | null;
  readonly status: 'completed' | 'cancelled' | 'failed';
  readonly generationId: string | null;
}
export interface ResourceSnapshot {
  readonly inspections: Readonly<Partial<Record<GameId, ResourceInspection>>>;
  readonly errors: Readonly<Partial<Record<GameId, ResourceIssue>>>;
  readonly operation: ResourceOperation | null;
  readonly outcome: ResourceOutcome | null;
  readonly preferences: Readonly<Partial<Record<GameId, PreferencesContext>>>;
}
export interface ResourceDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  readKeys: typeof readPackageObjectKeys;
  install: typeof installPackageFromAcquisition;
}
export interface ResourceManagerOptions {
  /** Explicit same-origin application mount ending in a slash. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  audioAvailable?: boolean;
  dependencies?: Partial<ResourceDependencies>;
}
interface Publication { descriptor: PackageDescriptor; descriptorUrl: string }
interface Resolved {
  gameId: GameId; current: CurrentPackageGeneration; keys: Set<string>;
  publication: Publication | null; warning: string | null; host: HostManifest | null;
}
interface Job {
  kind: ResourceJobKind; productId: ProductId; gameId: GameId; componentId: string | null;
  controller: AbortController; promise: Promise<ResourceInspection | InstalledPackageResult>;
  committed: boolean;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const issue = (error: unknown): ResourceIssue => Object.freeze({
  code: error instanceof ResourceError ? error.code : 'operation-failed', message: message(error),
});
function fail(code: ResourceErrorCode, text: string): never { throw new ResourceError(code, text); }
function cancelled(signal: AbortSignal) { if (signal.aborted) fail('cancelled', '资源操作已取消；已提交的资源不会回滚'); }
function identity(productId: ProductId): GameId {
  if (!isProductId(productId)) fail('invalid-product', '未知作品标识');
  return gameIdForProduct(productId);
}
function applicationUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { return fail('invalid-base-url', '资源服务需要完整的应用目录 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith('/') || url.search || url.hash || url.username || url.password ||
      (globalThis.location && url.origin !== globalThis.location.origin)) fail('invalid-base-url', '资源必须来自同源的应用目录');
  return url;
}
function insideMount(url: URL, mount: URL) {
  if (url.origin !== mount.origin || !url.pathname.startsWith(mount.pathname) || url.username || url.password || url.search || url.hash) {
    fail('invalid-package', '资源地址必须位于同源应用目录内');
  }
  return url.href;
}
function checkedDescriptor(value: unknown, game: GameId): PackageDescriptor {
  try {
    const descriptor = validatePackageDescriptor(value);
    const requirement = descriptor.runtimeRequirement;
    if (descriptor.game !== game || (requirement && (requirement.target !== game || requirement.protocol !== HOST_PROTOCOL ||
        !descriptor.base.files.includes(requirement.dataFile) ||
        descriptor.files[requirement.dataFile]?.target !== PRODUCT_GAMES[game].package.dataTarget))) throw new Error('Package 的作品或基础资源标识不匹配');
    return descriptor;
  } catch (error) { throw new ResourceError('invalid-package', message(error), { cause: error }); }
}
function checkedCurrent(current: CurrentPackageGeneration, game: GameId): CurrentPackageGeneration {
  const { installation, generation } = current;
  if (installation && installation.game !== game || generation && (generation.game !== game || !generation.id ||
      installation?.currentGeneration !== generation.id) || !generation && installation?.currentGeneration) {
    fail('invalid-package', '本机 Package 的当前版本标识不一致');
  }
  if (generation) checkedDescriptor(generation.descriptor, game);
  return current;
}
function removableIds(generation: InstalledPackageGeneration, componentId: string): string[] {
  const descriptor = generation.descriptor;
  const protectedIds = new Set(descriptor.base.files);
  // One object can serve multiple optional components. Removing a component
  // must not destroy another component or the required base.
  for (const other of Object.keys(descriptor.components)) {
    if (other === componentId) continue;
    for (const id of componentFileIds(descriptor, other)) if (generation.files[id]?.objectId) protectedIds.add(id);
  }
  return componentFileIds(descriptor, componentId).filter(id => !!generation.files[id]?.objectId && !protectedIds.has(id));
}
function describe(resolved: Resolved): ResourceInspection {
  const { gameId, current: { generation, installation }, publication, keys, warning } = resolved;
  const installed = generation?.descriptor, published = publication?.descriptor;
  const present = (id: string) => !!generation?.files[id]?.objectId && keys.has(generation.files[id]!.objectId);
  const componentIds = new Set([...Object.keys(published?.components ?? {}), ...Object.keys(installed?.components ?? {})]);
  const components = [...componentIds].map(id => {
    const descriptor = published?.components[id] ? published : installed!;
    const component = descriptor.components[id];
    const fileIds = componentFileIds(descriptor, id);
    const previousIds = installed?.components[id] ? componentFileIds(installed, id) : [];
    const installedFileCount = previousIds.filter(present).length;
    const matching = fileIds.filter(fileId => present(fileId) && generation!.files[fileId]!.revision === descriptor.files[fileId].revision &&
      installed?.files[fileId]?.bytes === descriptor.files[fileId].bytes &&
      installed?.files[fileId]?.sha256?.toLowerCase() === descriptor.files[fileId].sha256?.toLowerCase()).length;
    const status = matching === fileIds.length && fileIds.length > 0 ? 'installed'
      : installedFileCount > 0 && installed?.revision !== published?.revision && published ? 'update'
      : installedFileCount > 0 ? 'partial' : 'absent';
    const lengths = fileIds.map(fileId => descriptor.files[fileId].bytes);
    const bytes = lengths.every(value => Number.isSafeInteger(value) && Number(value) >= 0)
      ? lengths.reduce<number>((total, value) => total + value!, 0) : null;
    const canInstall = !!published?.components[id] && fileIds.length > 0 && status !== 'installed';
    const canRemove = !!generation && previousIds.length > 0 && removableIds(generation, id).length > 0;
    return Object.freeze({ id, type: component.type,
      title: typeof component.title === 'string' ? component.title : id,
      fileCount: fileIds.length, bytes, installedFileCount, status,
      canInstall, canRemove,
      installReason: canInstall ? null : !published?.components[id] ? '当前站点没有发布此组件' : status === 'installed' ? '已安装当前声明的资源' : '此组件未声明资源文件',
      removeReason: canRemove ? null : previousIds.some(fileId => generation?.files[fileId]?.objectId)
        ? '这些文件仍属于基础资源或其他组件' : '本机没有可移除的此组件资源',
    } satisfies ResourceComponent);
  });
  const base = installed?.base.files ?? published?.base.files ?? [];
  return Object.freeze({ gameId, generationId: generation?.id ?? null,
    installedRevision: installed?.revision ?? null, publishedRevision: published?.revision ?? null,
    source: installation?.source ?? null, updateAvailable: !!installed && !!published && installed.revision !== published.revision,
    baseFileCount: base.length, installedBaseFileCount: base.filter(present).length,
    components: Object.freeze(components), warning, integrityVerified: false });
}

export function createResourceManager(options: ResourceManagerOptions) {
  const mount = applicationUrl(options.baseUrl);
  const deps: ResourceDependencies = { readCurrent: readCurrentPackageGeneration, readKeys: readPackageObjectKeys,
    install: installPackageFromAcquisition, ...options.dependencies };
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let snapshot: ResourceSnapshot = Object.freeze({ inspections: Object.freeze({}), errors: Object.freeze({}), operation: null, outcome: null, preferences: Object.freeze({}) });
  let active: Job | null = null, disposed = false;
  const listeners = new Set<() => void>();
  const metadata = new Map<GameId, Pick<Resolved, 'publication' | 'host'>>();
  function update(patch: Partial<ResourceSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  function publishInspection(resolved: Resolved) {
    const value = describe(resolved), host = resolved.host?.games[value.gameId];
    const generation = resolved.current.generation;
    const files = Object.fromEntries(Object.entries(generation?.files ?? {}).filter(([, file]) => !!file?.objectId && resolved.keys.has(file.objectId)));
    const languages = buildLanguageCatalog({languageOptions: host?.languageOptions, legacyLanguages: host?.languages,
      generation: generation ? {...generation, files} : null, priority: languagePriority});
    const context: PreferencesContext = Object.freeze({
      uiLocale: 'zh-CN',
      ...(host ? {hostFeatures: Object.freeze({...host.features})} : {}),
      ...(host || generation ? {languageCatalog: Object.freeze(languages.map(({id, title}) => Object.freeze({id, title})))} : {}),
      ...(host ? {musicAvailability: Object.freeze({audio: options.audioAvailable ?? true,
        midiAvailable: PRODUCT_GAMES[value.gameId].musicCapabilities.midi && host.music.midi.supported !== false,
        importServer: resolved.host!.shared.resourceMode === 'import',
        remoteOggAdvertised: !!host.music.ogg,
        remoteRevision: resolved.publication?.descriptor.revision ?? null,
        installed: generation ? Object.freeze({revision: generation.descriptor.revision,
          oggFileIds: Object.freeze(componentFileIds(generation.descriptor, 'ogg')),
          files: Object.freeze(Object.fromEntries(Object.entries(files).map(([id, file]) => [id, Object.freeze({objectId: file!.objectId})])))}) : null,
      })} : {}),
    });
    update({ inspections: Object.freeze({ ...snapshot.inspections, [value.gameId]: value }),
      preferences: Object.freeze({...snapshot.preferences, [value.gameId]: context}) });
    return value;
  }
  async function request<T>(url: string, signal: AbortSignal, read: (response: Response) => Promise<T>): Promise<T> {
    cancelled(signal);
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 15_000);
    try {
      const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
      const result = await read(response); cancelled(signal); return result;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async function publication(game: GameId, signal: AbortSignal): Promise<Publication> {
    try {
      const catalogUrl = new URL(RELEASE_CATALOG_FILE, mount).href;
      const catalog: ReleaseCatalog = validateReleaseCatalog(await request(catalogUrl, signal, response => response.json()));
      const address = releaseCatalogEntryUrl(catalogUrl, catalog, game);
      if (!address) fail('metadata-unavailable', '当前站点没有发布此作品的 Package');
      const descriptorUrl = insideMount(new URL(address), mount);
      const descriptor = checkedDescriptor(await request(descriptorUrl, signal, response => response.json()), game);
      if (descriptor.revision !== catalog.games[game]!.revision) fail('invalid-package', '发布目录与 Package 版本不一致');
      for (const file of Object.values(descriptor.files)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(file.source)) fail('invalid-package', '资源来源必须是相对文件路径');
        insideMount(new URL(file.source, descriptorUrl), mount);
        if (!Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0 || !file.sha256) fail('invalid-package', '已发布资源必须声明文件大小与完整 SHA-256');
      }
      return { descriptor, descriptorUrl };
    } catch (error) {
      cancelled(signal);
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('metadata-unavailable', `发布资源不可用：${message(error)}`, { cause: error });
    }
  }
  async function local(game: GameId) {
    try {
      const current = checkedCurrent(await deps.readCurrent(game), game);
      const ids = Object.values(current.generation?.files ?? {}).flatMap(file => file?.objectId ? [file.objectId] : []);
      const keys = await deps.readKeys(ids);
      return { current, keys };
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('storage-unavailable', `本机资源存储不可用：${message(error)}`, { cause: error });
    }
  }
  async function resolve(game: GameId, signal: AbortSignal): Promise<Resolved> {
    const stored = await local(game); cancelled(signal);
    let host: HostManifest | null = null;
    let hostWarning: string | null = null;
    try { host = validateHostManifest(await request(new URL(HOST_MANIFEST_FILE, mount).href, signal, response => response.json())); }
    catch (error) { cancelled(signal); hostWarning = `Host 元数据不可用：${message(error)}`; }
    let published: Publication | null = null, warning: string | null = null;
    try { published = await publication(game, signal); }
    catch (error) { cancelled(signal); warning = message(error); }
    cancelled(signal);
    metadata.set(game, {publication: published, host});
    return { gameId: game, ...stored, publication: published, host, warning: [warning, hostWarning].filter(Boolean).join('；') || null };
  }
  function reject(error: ResourceError): Promise<never> {
    const promise = Promise.reject<never>(error); void promise.catch(() => {}); return promise;
  }
  function run(kind: ResourceJobKind, productId: ProductId, componentId: string | null): Promise<ResourceInspection | InstalledPackageResult> {
    if (disposed) return reject(new ResourceError('disposed', '资源服务已关闭'));
    let gameId: GameId;
    try { gameId = identity(productId); } catch (error) { return reject(error as ResourceError); }
    if (active) {
      // SP/MP address the same installed game; repeated clicks share one job.
      if (active.kind === kind && active.gameId === gameId && active.componentId === componentId) return active.promise;
      return reject(new ResourceError('busy', '请等待当前资源任务结束，或先取消它'));
    }
    const job = { kind, productId, gameId, componentId, controller: new AbortController(), committed: false } as Job;
    const signal = job.controller.signal;
    job.promise = Promise.resolve().then(async () => {
      cancelled(signal);
      if (kind === 'inspect') {
        const resolved = await resolve(gameId, signal); cancelled(signal);
        return publishInspection(resolved);
      }
      // Removal only reads local metadata. It works without a publication and
      // deliberately does not fetch replacements for broken preserved files.
      const resolved: Resolved = kind === 'remove'
        ? { gameId, ...await local(gameId), publication: metadata.get(gameId)?.publication ?? null, host: metadata.get(gameId)?.host ?? null, warning: null }
        : await resolve(gameId, signal);
      cancelled(signal);
      const generation = resolved.current.generation;
      const installing = kind === 'install' || kind === 'install-base';
      const published = resolved.publication;
      const descriptor = installing ? published?.descriptor : generation?.descriptor;
      if (installing && !published) fail('metadata-unavailable', resolved.warning ?? '当前站点没有发布此作品的资源');
      if (!descriptor || kind !== 'install-base' && (!componentId || !Object.hasOwn(descriptor.components, componentId))) {
        fail('unknown-component', installing ? '当前站点没有发布此组件，请重新检查资源' : '本机没有此组件');
      }
      const remove = kind === 'remove' && generation ? new Set(removableIds(generation, componentId!)) : new Set<string>();
      if (kind === 'remove' && !remove.size) fail('not-removable', '此组件未安装，或文件仍属于基础资源或其他组件');
      if (kind === 'install' && !componentFileIds(descriptor, componentId!).length) fail('unknown-component', '此组件没有可安装的文件');
      const result = await deps.install({ descriptor, reuseCurrent: true, signal,
        source(current) { checkedCurrent(current, gameId); return current.installation?.source ?? 'remote'; },
        desiredFileIds(current) {
          cancelled(signal); checkedCurrent(current, gameId);
          if (installing) return desiredFilesForPublishedPackage(descriptor, { current: current.generation, addComponents: kind === 'install' ? [componentId!] : [] });
          // The descriptor was read before entering the installer's queue. A
          // concurrent importer may have advanced current while we waited.
          if (current.generation?.id !== generation!.id) fail('changed-generation', '本机资源已被其他任务更新，请重新检查后移除');
          return [...new Set([...descriptor.base.files, ...Object.keys(current.generation.files).filter(id =>
            !!current.generation!.files[id]?.objectId && !remove.has(id))])];
        },
        acquire: async (_id, declaration) => {
          cancelled(signal);
          if (kind === 'remove') fail('storage-unavailable', '保留的本机文件缺失；移除已停止，请先修复或重新导入资源');
          return request(insideMount(new URL(declaration.source, published!.descriptorUrl), mount), signal, response => response.arrayBuffer());
        },
        onProgress(progress) {
          if (active === job && !disposed) update({ operation: Object.freeze({ ...snapshot.operation!, progress: Object.freeze({ ...progress }) }) });
        },
      });
      // Core returns only after commit. A late Cancel must not claim rollback.
      job.committed = true;
      try { publishInspection({ ...resolved, ...await local(gameId) }); }
      catch (error) {
        const inspections = { ...snapshot.inspections }; delete inspections[gameId];
        update({ inspections: Object.freeze(inspections), errors: Object.freeze({ ...snapshot.errors,
          [gameId]: issue(new ResourceError('storage-unavailable', `资源已提交，但重新读取失败：${message(error)}`)) }) });
      }
      return result;
    }).then(result => {
      update({ outcome: Object.freeze({ kind, gameId, componentId, status: 'completed',
        generationId: 'generation' in result ? result.generation.id : result.generationId }) });
      return result;
    }).catch(error => {
      const aborted = signal.aborted && !job.committed;
      const failure = aborted ? new ResourceError('cancelled', '资源操作已取消') : error;
      update({ errors: Object.freeze({ ...snapshot.errors, [gameId]: issue(failure) }),
        outcome: Object.freeze({ kind, gameId, componentId, status: aborted ? 'cancelled' : 'failed', generationId: null }) });
      throw failure;
    }).finally(() => { if (active === job) { active = null; update({ operation: null }); } });
    void job.promise.catch(() => {});
    active = job;
    const errors = { ...snapshot.errors }; delete errors[gameId];
    update({ errors: Object.freeze(errors), outcome: null,
      operation: Object.freeze({ kind, productId, gameId, componentId, cancelRequested: false, progress: null }) });
    return job.promise;
  }
  function cancel() {
    if (!active || active.committed) return;
    active.controller.abort();
    update({ operation: Object.freeze({ ...snapshot.operation!, cancelRequested: true }) });
    // Keep the owner busy until the core has cancelled its pending generation
    // or confirmed a commit; a second writer must not be started optimistically.
  }
  return Object.freeze({ getSnapshot: () => snapshot,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    inspect: (productId: ProductId) => run('inspect', productId, null) as Promise<ResourceInspection>,
    installBase: (productId: ProductId) => run('install-base', productId, null) as Promise<InstalledPackageResult>,
    install: (productId: ProductId, componentId: string) => run('install', productId, componentId) as Promise<InstalledPackageResult>,
    remove: (productId: ProductId, componentId: string) => run('remove', productId, componentId) as Promise<InstalledPackageResult>,
    cancel,
    dispose() { if (disposed) return; cancel(); disposed = true; listeners.clear(); },
  });
}
export type ResourceManagerController = ReturnType<typeof createResourceManager>;
