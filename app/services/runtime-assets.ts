/** Resource preparation for the React launcher. No navigation or UI ownership. */
import { unzipSync } from 'fflate';
import { componentFileIds } from '../../package/package-generation.mjs';
import { installPublishedPackage } from '../../package/package-launcher.mjs';
import { migrateLegacyStoredImport } from '../../legacy/legacy-import-storage.mjs';
import { installPackageFromAcquisition, installParsedPackageZip } from '../../package/package-installer.mjs';
import { readCurrentPackageGeneration, readPackageObject } from '../../package/package-store.mjs';
import { PACKAGE_DESCRIPTOR_SCHEMA } from '../../package/package-descriptor.mjs';
import { HOST_PROTOCOL, PRODUCT_GAMES, languagePriority, type GameId } from '../../src/contracts/product-catalog.mts';
import type { HostManifest, HostGameManifest } from '../../src/contracts/host-manifest.mts';
import type { ReleaseCatalog } from '../../src/contracts/release-catalog.mts';
import type { InstalledPackageGeneration, PackageDescriptor } from '../../src/contracts/package-read-models.mts';
import { buildLanguageCatalog, resolveLanguagePackSource, type LanguageCatalogEntry } from '../../src/launcher/language-catalog.mts';
import { validateStaticLanguagePackEntries } from '../../src/launcher/language-pack-validation.mts';
import { loadOfflineLanguageIndex, rememberOfflineLanguage } from '../../src/launcher/offline-language-index.mts';
import { sha256Hex } from '../../src/launcher/sha256.mts';

export interface RuntimeMetadata {
  hostManifest: HostManifest | null;
  releaseCatalog: ReleaseCatalog | null;
  errors: readonly string[];
}
export interface AssetContext {
  game: GameId;
  metadata: RuntimeMetadata;
  baseUrl: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  storage?: Storage | null;
  cacheStorage?: CacheStorage;
  assertCurrent(): void;
  progress(value: { mode: string; loaded: number; total: number; label?: string }): void;
}
export class RuntimeDataUnavailableError extends Error {
  readonly code = 'DATA_UNAVAILABLE';
}
const packageProgress = (context: AssetContext) => (value: { completed: number; total: number; fileId: string }) => {
  context.assertCurrent();
  context.progress({ mode: 'package', loaded: value.completed, total: value.total, label: value.fileId });
};
export const catalogUrl = (baseUrl: string) => new URL('release-catalog.json', baseUrl).href;

export interface RuntimePackageRecoveryDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  migrateLegacy: typeof migrateLegacyStoredImport;
  installParsed: typeof installParsedPackageZip;
}
/** Preserve existing current packages and migrate historical imports in place.
 * The canonical migration owner alone cleans legacy bytes, only after commit.
 */
export async function recoverInstalledRuntimeGeneration(context: AssetContext, dependencies: Partial<RuntimePackageRecoveryDependencies> = {}): Promise<InstalledPackageGeneration | null> {
  const readCurrent = dependencies.readCurrent ?? readCurrentPackageGeneration;
  const migrateLegacy = dependencies.migrateLegacy ?? migrateLegacyStoredImport;
  const installParsed = dependencies.installParsed ?? installParsedPackageZip;
  const current = await readCurrent(context.game); context.assertCurrent();
  if (current.generation) return current.generation;
  const migrationOptions = {
    protocol: HOST_PROTOCOL, fallbackGameData: context.metadata.hostManifest?.games[context.game]?.gameData || null,
    currentRevision: null, origin: new URL(context.baseUrl).origin,
    storage: context.storage, cacheStorage: context.cacheStorage,
    install: async (parsed: Parameters<typeof installParsedPackageZip>[0]) => {
      context.assertCurrent();
      const result = await installParsed(parsed, { onProgress: packageProgress(context) });
      // A cancelled attempt must not discard the historical source, even if
      // its already-started Package transaction eventually committed.
      context.assertCurrent(); return result;
    },
  };
  const migration = await migrateLegacy(context.game, migrationOptions); context.assertCurrent();
  if (migration.status === 'incomplete') throw new RuntimeDataUnavailableError('历史导入的本地资源不完整。原始记录已保留，请修复或重新导入游戏包');
  if (migration.status === 'migrated' || migration.status === 'already-current') {
    const recovered = await readCurrent(context.game); context.assertCurrent();
    if (!recovered.generation) throw new RuntimeDataUnavailableError('本地资源迁移后未找到已提交的游戏包，请重试');
    return recovered.generation;
  }
  return null;
}

/** Retains existing Package IDs and only downloads when local recovery is absent. */
export async function acquireRuntimeGeneration(context: AssetContext, includeOgg: boolean): Promise<InstalledPackageGeneration | null> {
  const installed = await recoverInstalledRuntimeGeneration(context);
  context.assertCurrent();
  if (installed) return installed;
  const { hostManifest: host, releaseCatalog: catalog } = context.metadata;
  if (catalog?.games[context.game]) {
    const result = await installPublishedPackage(context.game, {
      catalog, catalogUrl: catalogUrl(context.baseUrl), fetchImpl: context.fetchImpl,
      signal: context.signal, onProgress: packageProgress(context),
    });
    context.assertCurrent();
    return result.generation;
  }
  const declaration = host?.games[context.game];
  if (declaration?.gameData.source && host?.profile === 'web-development') {
    const { gameData: data, music } = declaration;
    const product = PRODUCT_GAMES[context.game];
    const files: PackageDescriptor['files'] = {
      'game-data': { revision: data.version, source: 'game-data', target: product.package.dataTarget, bytes: data.bytes, sha256: data.sha256 },
    };
    const ogg = music.ogg;
    const oggIds: string[] = [];
    if (ogg) for (const [index, name] of ogg.files.entries()) {
      const id = `ogg:${name}`;
      files[id] = { revision: ogg.version, source: name, target: `${product.package.musicMounts.ogg}/${name}`, bytes: ogg.sizes[index], sha256: ogg.sha256[index] };
      oggIds.push(id);
    }
    const descriptor: PackageDescriptor = {
      schema: PACKAGE_DESCRIPTOR_SCHEMA, game: context.game, revision: data.version,
      runtimeRequirement: { protocol: HOST_PROTOCOL, target: context.game, dataFile: 'game-data', dataLayout: data.layout },
      files, base: { files: ['game-data'] }, components: oggIds.length ? { ogg: { type: 'ogg', files: oggIds } } : {},
    };
    const result = await installPackageFromAcquisition({
      descriptor, desiredFileIds: ['game-data', ...(includeOgg ? oggIds : [])], source: 'remote',
      acquire: async (fileId, file) => {
        context.assertCurrent();
        const source = fileId === 'game-data' ? data.source! : `${typeof ogg?.base === 'string' ? ogg.base : ''}${file.source}`;
        const response = await context.fetchImpl(new URL(source, context.baseUrl), { signal: context.signal, cache: 'no-store' });
        if (!response.ok) throw new RuntimeDataUnavailableError(`${source}: HTTP ${response.status}`);
        const bytes = await response.arrayBuffer(); context.assertCurrent(); return bytes;
      },
      onProgress: packageProgress(context),
    });
    context.assertCurrent();
    return result.generation;
  }
  if (!declaration || host?.shared.resourceMode !== 'hosted' || PRODUCT_GAMES[context.game].dataProvider === 'retail-memory') {
    throw new RuntimeDataUnavailableError('本机没有可用游戏数据。请导入合法持有的游戏包，或检查资源服务器后重试');
  }
  // Emscripten-preload development adapters may own their declared DATA URL.
  return null;
}

export async function completeInitialOgg(context: AssetContext, generation: InstalledPackageGeneration): Promise<InstalledPackageGeneration> {
  const initial = componentFileIds(generation.descriptor, 'ogg').slice(0, 2);
  if (initial.length !== 2) throw new Error('游戏包未包含可用 OGG 音乐');
  if (initial.every(id => generation.files[id]?.objectId)) return generation;
  const catalog = context.metadata.releaseCatalog;
  if (context.metadata.hostManifest?.shared.resourceMode === 'import' || catalog?.games[context.game]?.revision !== generation.descriptor.revision) {
    throw new Error('开场音乐不完整，且没有同版本下载来源');
  }
  const result = await installPublishedPackage(context.game, {
    catalog, catalogUrl: catalogUrl(context.baseUrl), addFileIds: initial,
    preserveLocalSource: true, fetchImpl: context.fetchImpl, signal: context.signal, onProgress: packageProgress(context),
  });
  context.assertCurrent();
  if (result.generation.descriptor.revision !== generation.descriptor.revision || !initial.every(id => result.generation.files[id]?.objectId)) {
    throw new Error('音乐资源版本在准备期间发生变化，请重试');
  }
  return result.generation;
}

export function runtimeResourceIds(generation: InstalledPackageGeneration): string[] {
  const descriptor = generation.descriptor;
  const executable = new Set(Object.values(descriptor.runtimes || (descriptor.runtime ? { normal: descriptor.runtime } : {}))
    .flatMap(runtime => runtime.bootstrap || [runtime.entry]));
  const ids = [...descriptor.base.files, ...Object.entries(descriptor.components)
    .filter(([, component]) => component.type === 'resource').flatMap(([id]) => componentFileIds(descriptor, id))];
  return [...new Set(ids)].filter(id => id !== descriptor.runtimeRequirement?.dataFile && id !== 'game-data' &&
    !executable.has(id) && !!generation.files[id]?.objectId && !/\.(?:html|m?js|wasm)$/i.test(descriptor.files[id]?.source || ''));
}

export function runtimeLanguages(context: Pick<AssetContext, 'game' | 'metadata'>, generation: InstalledPackageGeneration | null, storage: Storage | null): LanguageCatalogEntry[] {
  const host = context.metadata.hostManifest?.games[context.game];
  return buildLanguageCatalog({ languageOptions: host?.languageOptions, legacyLanguages: host?.languages,
    offlineEntries: loadOfflineLanguageIndex(storage, context.game), generation, priority: languagePriority });
}

export async function prepareRuntimeLanguage(context: AssetContext, language: string, generation: InstalledPackageGeneration | null, storage: Storage | null, cacheStorage?: CacheStorage) {
  if (language === 'ja') return null;
  const entry = runtimeLanguages(context, generation, storage).find(item => item.id === language);
  if (!entry) throw new Error('所选语言当前不可用');
  const pack = resolveLanguagePackSource(entry, context.baseUrl);
  if (!pack) throw new Error('所选语言包当前不可用');
  let bytes: Uint8Array | null = null;
  let cache: Cache | undefined;
  let key: Request | undefined;
  if (pack.packageLocal) {
    const object = await readPackageObject(pack.packageObjectId); context.assertCurrent();
    if (object?.data instanceof ArrayBuffer) bytes = new Uint8Array(object.data);
    else if (object?.blob) bytes = new Uint8Array(await object.blob.arrayBuffer());
    context.assertCurrent();
    if (!bytes || (pack.bytes > 0 && bytes.length !== pack.bytes)) throw new Error('本地语言包缺失或损坏，请重新导入');
  } else {
    try { cache = await cacheStorage?.open('eagler-touhou-language-packs-v1'); } catch { /* Cache storage can be denied. */ }
    context.assertCurrent();
    key = new Request(`${new URL(context.baseUrl).origin}/__eagler-language/${context.game}/${language}/${pack.sha256}`);
    const cached = await cache?.match(key); context.assertCurrent();
    if (cached) bytes = new Uint8Array(await cached.arrayBuffer());
    context.assertCurrent();
    const valid = async (value: Uint8Array) => value.length === pack.bytes && (await sha256Hex(value)).toLowerCase() === pack.sha256.toLowerCase();
    if (bytes && !await valid(bytes)) { context.assertCurrent(); await cache?.delete(key); bytes = null; }
    context.assertCurrent();
    if (!bytes) {
      const response = await context.fetchImpl(pack.url, { signal: context.signal, cache: cached ? 'no-store' : 'force-cache' });
      if (!response.ok) throw new Error(`语言包 HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer()); context.assertCurrent();
      if (!await valid(bytes)) throw new Error('语言包大小或 SHA-256 校验失败');
      context.assertCurrent();
    }
    if (cache) try { await cache.put(key, new Response(new Uint8Array(bytes))); context.assertCurrent(); rememberOfflineLanguage(storage, context.game, entry, pack); } catch (error) { context.assertCurrent(); }
  }
  context.assertCurrent();
  const validated = validateStaticLanguagePackEntries(unzipSync(bytes), { game: context.game, language });
  const url = !pack.packageLocal ? pack.url : new URL(`/__eagler/package-language/${context.game}/${encodeURIComponent(language)}`, context.baseUrl).href;
  return { ...pack, url, runtimeVersion: validated.manifest.runtimeVersion, bytes: bytes.length, ...validated };
}

export function sharedRuntimeResources(host: HostGameManifest | undefined, manifest: HostManifest | null, game: GameId, generation: InstalledPackageGeneration | null, language: string, thprac: boolean, baseUrl: string) {
  const product = PRODUCT_GAMES[game];
  if ('requiredShared' in product && !product.requiredShared.length) return [];
  const targets = new Set(generation ? runtimeResourceIds(generation).map(id => generation.descriptor.files[id]?.target) : []);
  const resources: { path: string; url: string }[] = [];
  for (const [needed, path, source] of [
    [language === 'ja', '/msgothic.ttc', manifest?.shared.vanillaFont],
    [language !== 'ja' || thprac, '/unifont.otf', manifest?.shared.unicodeFont],
  ] as const) {
    if (!needed || targets.has(path)) continue;
    if (!source) throw new RuntimeDataUnavailableError(`缺少必需资源 ${path}，请修复游戏包或资源服务器`);
    resources.push({ path, url: new URL(source, baseUrl).href });
  }
  return resources;
}
