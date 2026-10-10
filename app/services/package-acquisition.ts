import {PACKAGE_DESCRIPTOR_SCHEMA} from '../../package/package-descriptor.mjs';
import {componentFileIds} from '../../package/package-generation.mjs';
import {installPublishedPackage} from '../../package/package-launcher.mjs';
import {installPackageFromAcquisition, installParsedPackageZip} from '../../package/package-installer.mjs';
import {parsePackageZip} from '../../package/package-zip.mjs';
import {readCurrentPackageGeneration} from '../../package/package-store.mjs';
import {adaptLegacyGamePackToPackage} from '../../legacy/legacy-package-adapter.mjs';
import {parseStoredGameDataPack} from '../../legacy/legacy-game-pack.mjs';
import {HOST_PROTOCOL, PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, productEnabledForBuild, productFeatureAvailable,
  type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {HostManifest, HostGameData} from '../../src/contracts/host-manifest.mts';
import {RELEASE_CATALOG_FILE, type ReleaseCatalog} from '../../src/contracts/release-catalog.mts';
import type {CurrentPackageGeneration, InstalledPackageGeneration, PackageDescriptor, InstalledPackageResult} from '../../src/contracts/package-read-models.mts';
import type {MusicMode} from '../../src/launcher/game-preferences.mts';
import type {TransferPresentation} from '../../src/launcher/app-types.mts';
import {createRawDataImportPackageDescriptor, rawDataImportHashMatches, rawDataImportMatchesFileName, rawDataImportSizeMatches} from '../../src/launcher/raw-data-import.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import type {Translate} from '../i18n';
import {GameDataAcquisitionError} from './game-data-acquisition';
import type {PreparationNetwork} from './preparation-network';

export interface PreparationMetadataSnapshot {
  hostManifest: HostManifest | null;
  releaseCatalog: ReleaseCatalog | null;
  metadataErrors?: unknown;
  releaseCatalogError?: unknown;
}
export interface PreparationMetadata {
  getSnapshot(): PreparationMetadataSnapshot;
  initialize(): Promise<unknown>;
  refreshInstalled?(game?: GameId): Promise<unknown>;
}
export interface PreparationProgress {
  stage: 'package' | 'language' | 'music';
  message: string;
  completed?: number;
  total?: number;
  loaded?: number;
  totalBytes?: number;
  /** Original transfer presentation, separate from player-status prose. */
  presentation?: TransferPresentation;
  completion?: 'language' | 'local-music';
  failure?: {kind: 'language'; label: string; reason: string};
}
export interface AcquisitionRequest {
  productId: ProductId;
  music: MusicMode;
  language: string;
  signal?: AbortSignal;
  /** A cancelled optional update returns to current; a cancelled launch does
   * not. Hosts must not conflate these two original cancellation intents. */
  updateSignal?: AbortSignal;
  /** Foreground update only; selection/cancellation policy stays with root. */
  onUpdateActivity?(active: boolean): void;
  /** Ordinary foreground Package/development download, not metadata or import. */
  onAcquisitionActivity?(active: boolean): void;
  onProgress?(progress: PreparationProgress): void;
  onWarning?(message: string): void;
  decideUpdate?(input: {message: string; confirmText: string; secondaryText: string; cancelText: string}): Promise<'confirm' | 'secondary' | 'cancel'>;
}
export type PackageAcquisitionResult =
  | {kind: 'managed'; generation: InstalledPackageGeneration; deferredUpdate: CurrentPackageGeneration | null}
  | {kind: 'direct-preload'; host: HostManifest; entry: string; gameData: HostGameData};
export interface PackageAcquisitionDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  installPublished: typeof installPublishedPackage;
  installAcquired: typeof installPackageFromAcquisition;
  installZip: typeof installParsedPackageZip;
  parseZip: typeof parsePackageZip;
  parseLegacy: typeof parseStoredGameDataPack;
  hash: typeof sha256Hex;
}
export function checkPreparationAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
export const preparationErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isOgg = (music: MusicMode) => music === 'ogg-stream' || music === 'ogg-full';
function requiredShared(game: GameId) {const product = PRODUCT_GAMES[game]; return 'requiredShared' in product ? product.requiredShared : [];}

/** Main app 3887–3978, 3980–4110, 5678–5953. Canonical Package Store and
 * installer remain sole mutation owners; this adapter does not invent a store,
 * a descriptor policy, or permission for an imported executable Runtime. */
export function createPackageAcquisition({metadata, baseUrl, translate: t, fetchImpl = globalThis.fetch,
  network, dependencies, indexedDBAvailable = () => !!globalThis.indexedDB?.open, requestPersistence, testBuild = new URL(baseUrl).searchParams.has('test')}: {
  metadata: PreparationMetadata;
  baseUrl: string;
  translate: Translate;
  fetchImpl?: typeof fetch;
  network?: PreparationNetwork;
  dependencies?: Partial<PackageAcquisitionDependencies>;
  indexedDBAvailable?: () => boolean;
  /** Optional browser eviction-policy hint, never awaited by import success. */
  requestPersistence?: () => Promise<unknown>;
  testBuild?: boolean;
}) {
  const deps: PackageAcquisitionDependencies = {readCurrent: readCurrentPackageGeneration, installPublished: installPublishedPackage,
    installAcquired: installPackageFromAcquisition, installZip: installParsedPackageZip, parseZip: parsePackageZip,
    parseLegacy: parseStoredGameDataPack, hash: sha256Hex, ...dependencies};
  const catalogUrl = new URL(RELEASE_CATALOG_FILE, baseUrl).href;
  const getPackageFetch = (game: GameId) => network?.packageFetch(game) ?? fetchImpl;
  const background = new Map<GameId, Promise<void>>();
  const selectedLanguages = (game: GameId, language: string): Readonly<Record<string, readonly string[]>> => productFeatureAvailable(game, 'languages', metadata.getSnapshot().hostManifest?.games[game]?.features)
    ? {language: language === 'ja' ? [] : [language]} : {};
  function progress(request: Pick<AcquisitionRequest, 'onProgress'>, key: Parameters<Translate>[0], values: Record<string, unknown> = {}) {
    request.onProgress?.({stage: 'package', message: t(key, values),
      ...(typeof values.completed === 'number' ? {completed: values.completed} : {}),
      ...(typeof values.total === 'number' ? {total: values.total} : {})});
  }
  async function installedChanged(game: GameId) {
    // Metadata publication is secondary to the committed canonical transaction.
    try {await metadata.refreshInstalled?.(game);} catch {}
  }
  function developmentDescriptor(game: GameId, host: HostManifest): PackageDescriptor | null {
    const hosted = host.games[game], data = hosted?.gameData;
    if (!hosted || !data?.source) return null;
    const files: PackageDescriptor['files'] = {'game-data': {revision: data.version, source: 'game-data', target: `/${data.path}`, bytes: data.bytes, sha256: data.sha256}};
    const ogg = hosted.music.ogg, mount = PRODUCT_GAMES[game].package.musicMounts.ogg || '/bgm-ogg';
    const entries = Array.isArray(ogg?.files) && Array.isArray(ogg?.sizes) && Array.isArray(ogg?.sha256)
      ? ogg.files.map((name, index) => ({name, bytes: Number(ogg.sizes[index]), sha256: String(ogg.sha256[index] || '')}))
        .filter(item => item.name && Number.isSafeInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/i.test(item.sha256)) : [];
    for (const item of entries) files[`ogg:${item.name}`] = {revision: ogg?.version || data.version, source: item.name,
      target: `${mount.replace(/\/$/, '')}/${item.name}`, bytes: item.bytes, sha256: item.sha256};
    const ids = entries.map(item => `ogg:${item.name}`);
    return {schema: PACKAGE_DESCRIPTOR_SCHEMA, game, revision: data.version,
      runtimeRequirement: {protocol: HOST_PROTOCOL, target: game, dataFile: 'game-data', dataLayout: data.layout},
      files, base: {files: ['game-data']}, components: ids.length ? {ogg: {type: 'ogg', files: ids}} : {}};
  }
  async function installDevelopment(game: GameId, host: HostManifest, request: AcquisitionRequest): Promise<InstalledPackageResult | null> {
    if (PRODUCT_GAMES[game].dataProvider !== 'retail-memory') return null;
    const descriptor = developmentDescriptor(game, host), hosted = host.games[game];
    if (!descriptor || !hosted?.gameData.source) return null;
    checkPreparationAbort(request.signal);
    try {
      request.onAcquisitionActivity?.(true);
      progress(request, 'package.installingResources');
      const result = await deps.installAcquired({descriptor, source: 'remote',
        desiredFileIds: ['game-data', ...(isOgg(request.music) ? componentFileIds(descriptor, 'ogg') : [])],
        acquire: async (id, declaration) => {
          checkPreparationAbort(request.signal);
          const source = id === 'game-data' ? hosted.gameData.source! : `${typeof hosted.music.ogg?.base === 'string' ? hosted.music.ogg.base : ''}${declaration.source}`;
          const response = await getPackageFetch(game)(new URL(source, baseUrl), {cache: 'no-store', signal: request.signal});
          if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
          const bytes = await response.arrayBuffer(); checkPreparationAbort(request.signal); return bytes;
        }, onProgress: value => progress(request, 'package.installingResourcesProgress', {...value}),
      });
      checkPreparationAbort(request.signal); await installedChanged(game); return result;
    } finally {request.onAcquisitionActivity?.(false);}
  }
  async function maybeUpdate(game: GameId, installed: CurrentPackageGeneration, request: AcquisitionRequest) {
    const catalog = metadata.getSnapshot().releaseCatalog, current = installed.generation, publication = catalog?.games[game];
    if (!current || !publication || current.descriptor.revision === publication.revision || !request.decideUpdate) return 'none' as const;
    const local = installed.installation?.source === 'local';
    const choice = await request.decideUpdate({message: t(local ? 'package.updateAvailableLocal' : 'package.updateAvailableRemote'),
      confirmText: t('package.updateNow'), secondaryText: t('action.backgroundDownload'), cancelText: t('package.keepCurrent')});
    checkPreparationAbort(request.signal);
    if (choice === 'cancel') return 'none' as const;
    if (choice === 'secondary') return 'background' as const;
    try {
      request.onUpdateActivity?.(true);
      progress(request, local ? 'package.updatingLocal' : 'package.updatingRemote');
      await deps.installPublished(game, {catalog, catalogUrl, addComponents: [],
        selectedComponentEntries: selectedLanguages(game, request.language), preserveLocalSource: true, fetchImpl: getPackageFetch(game),
        signal: request.signal && request.updateSignal ? AbortSignal.any([request.signal, request.updateSignal]) : request.updateSignal ?? request.signal,
        onProgress: value => progress(request, local ? 'package.updatingLocalProgress' : 'package.updatingRemoteProgress', {...value})});
      checkPreparationAbort(request.signal); await installedChanged(game); request.onWarning?.(t('package.updated')); return 'updated' as const;
    } catch (error) {
      checkPreparationAbort(request.signal);
      request.onWarning?.(t(request.updateSignal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'package.updateCancelled' : 'package.updateFailed', {reason: preparationErrorText(error)}));
      return 'none' as const;
    } finally {request.onUpdateActivity?.(false);}
  }
  async function acquire(request: AcquisitionRequest): Promise<PackageAcquisitionResult> {
    checkPreparationAbort(request.signal);
    const game = gameIdForProduct(request.productId);
    let metadataSnapshot = metadata.getSnapshot();
    if (!productEnabledForBuild(request.productId, testBuild || metadataSnapshot.hostManifest?.shared.testBuild === true)) throw new Error('该游戏仅在测试版开启');
    // Development materializes the currently selected OGG before reusing current,
    // exactly as main does. Ordinary installed launches never await metadata.
    if (metadataSnapshot.hostManifest?.profile === 'web-development') await installDevelopment(game, metadataSnapshot.hostManifest, request);
    let installed = await deps.readCurrent(game); checkPreparationAbort(request.signal);
    if (installed.generation) {
      const mode = await maybeUpdate(game, installed, request); checkPreparationAbort(request.signal);
      if (mode === 'updated') installed = await deps.readCurrent(game);
      if (installed.generation) return {kind: 'managed', generation: installed.generation, deferredUpdate: mode === 'background' ? installed : null};
    }
    if (!metadataSnapshot.releaseCatalog) {try {await metadata.initialize();} catch {} checkPreparationAbort(request.signal); metadataSnapshot = metadata.getSnapshot();}
    const {hostManifest: host, releaseCatalog: catalog} = metadataSnapshot;
    if (catalog?.games[game]) {
      try {
        request.onAcquisitionActivity?.(true);
        progress(request, 'package.installingResources');
        const result = await deps.installPublished(game, {catalog, catalogUrl, addComponents: [], fetchImpl: getPackageFetch(game), signal: request.signal,
          onProgress: value => progress(request, 'package.installingResourcesProgress', {...value})});
        checkPreparationAbort(request.signal); await installedChanged(game);
        return {kind: 'managed', generation: result.generation, deferredUpdate: null};
      } catch (error) {
        checkPreparationAbort(request.signal);
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new GameDataAcquisitionError(preparationErrorText(error), {cause: error});
      } finally {request.onAcquisitionActivity?.(false);}
    }
    if (!host) throw new GameDataAcquisitionError(metadataSnapshot.releaseCatalogError
      ? t('package.remoteUnavailableNoLocal', {game: game.toUpperCase(), reason: preparationErrorText(metadataSnapshot.releaseCatalogError)})
      : t('package.releaseNotReadyNoLocal', {game: game.toUpperCase()}));
    if (host.shared.resourceMode === 'import') throw new GameDataAcquisitionError(t('package.importServerNoFiles'));
    if (host.shared.resourceMode === 'external') throw new GameDataAcquisitionError('外部游戏资源当前不可用，请检查网络 / CDN，或导入本地游戏包');
    if (PRODUCT_GAMES[game].dataProvider === 'retail-memory') {
      try {
        const result = await installDevelopment(game, host, request);
        if (result) return {kind: 'managed', generation: result.generation, deferredUpdate: null};
      } catch (error) {checkPreparationAbort(request.signal); throw new GameDataAcquisitionError(preparationErrorText(error), {cause: error});}
      throw new GameDataAcquisitionError(t('package.importServerNoFiles'));
    }
    const hosted = host.games[game];
    if (!hosted) throw new Error(t('runtime.hostManifestMissingGame', {game}));
    const entry = isMultiplayerProductId(request.productId) ? hosted.multiplayerRuntime : hosted.runtime;
    if (!entry) throw new Error(t('runtime.multiplayerRuntimeMissing', {game: game.toUpperCase()}));
    return {kind: 'direct-preload', host, entry, gameData: hosted.gameData};
  }
  async function importPackage({game, file, signal, onProgress}: {
    game: GameId; file: Blob & {name?: string}; signal?: AbortSignal; onProgress?: AcquisitionRequest['onProgress'];
  }): Promise<InstalledPackageGeneration> {
    const request = {onProgress};
    checkPreparationAbort(signal);
    if (!(file instanceof Blob) || file.size <= 0 || file.size > 256 * 1024 * 1024) throw new Error(t('package.invalidDataSize'));
    if (!indexedDBAvailable()) throw new Error(t('package.indexedDbUnavailable'));
    const host = metadata.getSnapshot().hostManifest, expected = host?.games[game]?.gameData;
    function expectedData() {if (!expected) throw new Error(t('runtime.dataDescriptorMissing', {game})); return expected;}
    async function done(result: InstalledPackageResult) {
      checkPreparationAbort(signal); await installedChanged(game);
      try {void requestPersistence?.().catch(() => {});} catch {}
      return result.generation;
    }
    if (typeof file.name === 'string' && rawDataImportMatchesFileName(game, file.name)) {
      const data = expectedData(), label = game.toUpperCase();
      if (!rawDataImportSizeMatches(data, file.size)) throw new Error(t('package.rawDataSizeMismatch', {game: label, actual: file.size, expected: data.bytes}));
      progress(request, 'package.validatingRawData', {game: label});
      const bytes = await file.arrayBuffer(), hash = await deps.hash(new Uint8Array(bytes)); checkPreparationAbort(signal);
      if (!rawDataImportHashMatches(data, hash)) throw new Error(t('package.rawDataHashMismatch', {game: label}));
      const descriptor = createRawDataImportPackageDescriptor(game, data, hash), id = descriptor.runtimeRequirement!.dataFile;
      progress(request, 'package.installingRawData', {game: label});
      return done(await deps.installAcquired({descriptor, desiredFileIds: [id], source: 'local', reuseCurrent: false,
        acquire: async fileId => {checkPreparationAbort(signal); return fileId === id ? bytes : null;},
        onProgress: value => progress(request, 'package.installingRawDataProgress', {game: label, ...value})}));
    }
    try {
      const parsed = await deps.parseZip(file); checkPreparationAbort(signal);
      if (parsed.descriptor.game !== game) throw new Error(t('package.wrongGame', {actual: parsed.descriptor.game.toUpperCase(), expected: game.toUpperCase()}));
      const targets = new Set(parsed.descriptor.base.files.map(id => parsed.descriptor.files[id]?.target));
      const missing = requiredShared(game).find(path => !targets.has(path));
      if (missing) throw new Error(t('package.missingRequiredResource', {resource: missing.slice(1)}));
      // Historical modern-format ZIPs can carry runtime/runtimes. Accept the
      // descriptor; App-managed execution and FS code exclusion are separate.
      progress(request, 'package.importingSimple');
      return done(await deps.installZip(parsed, {onProgress: value => progress(request, 'package.importingProgress', {...value})}));
    } catch (error) {if (!/Package ZIP is missing package\.json/.test(preparationErrorText(error))) throw error;}
    const data = expectedData(), legacy = await deps.parseLegacy(file); checkPreparationAbort(signal);
    if (legacy.manifest.game !== game) throw new Error(t('package.legacyWrongGame', {actual: legacy.manifest.game.toUpperCase(), expected: game.toUpperCase()}));
    if (legacy.manifest.data.path !== data.path) throw new Error(t('package.dataPathMismatch'));
    if (host?.shared.resourceMode === 'import' && !legacy.offline) throw new Error(t('package.serverNoContent'));
    if (legacy.offline) {
      const missing = requiredShared(game).find(target => !legacy.offline!.shared.some(item => item.target === target));
      if (missing) throw new Error(t('package.missingRequiredResource', {resource: missing.slice(1)}));
    }
    progress(request, 'package.validatingLocalData');
    if ((await deps.hash(new Uint8Array(await legacy.data.blob.arrayBuffer()))).toLowerCase() !== legacy.manifest.data.sha256.toLowerCase()) throw new Error(t('package.dataHashFailed'));
    checkPreparationAbort(signal);
    for (let index = 0; index < legacy.music.length; index++) {
      const item = legacy.music[index]; progress(request, 'package.validatingLocalOgg', {completed: index + 1, total: legacy.music.length});
      if ((await deps.hash(new Uint8Array(await item.blob.arrayBuffer()))).toLowerCase() !== item.sha256) throw new Error(t('package.shaFailed', {name: item.name})); checkPreparationAbort(signal);
    }
    for (const item of legacy.offline?.shared ?? []) {
      progress(request, 'package.validatingLegacyResource', {resource: item.target.slice(1)});
      if ((await deps.hash(new Uint8Array(await item.blob.arrayBuffer()))).toLowerCase() !== item.sha256) throw new Error(t('package.shaFailed', {name: item.path})); checkPreparationAbort(signal);
    }
    for (const item of legacy.offline?.languages ?? []) {
      progress(request, 'package.validatingLegacyLanguage', {language: item.title});
      if ((await deps.hash(new Uint8Array(await item.blob.arrayBuffer()))).toLowerCase() !== item.sha256) throw new Error(t('package.shaFailed', {name: item.path})); checkPreparationAbort(signal);
    }
    progress(request, 'package.migratingLegacy');
    return done(await deps.installZip(adaptLegacyGamePackToPackage(legacy, {protocol: HOST_PROTOCOL}), {
      onProgress: value => progress(request, 'package.migratingLegacyProgress', {...value})}));
  }
  function startBackgroundUpdate(installed: CurrentPackageGeneration, request: AcquisitionRequest): Promise<void> {
    const game = gameIdForProduct(request.productId);
    const existing = background.get(game); if (existing) return existing;
    const catalog = metadata.getSnapshot().releaseCatalog;
    if (!catalog || !installed.generation) return Promise.resolve();
    const task = deps.installPublished(game, {catalog, catalogUrl, addComponents: [], preserveLocalSource: true, fetchImpl: network?.backgroundFetch ?? fetchImpl,
      selectedComponentEntries: selectedLanguages(game, request.language)})
      .then(async () => {await installedChanged(game);})
      .finally(() => {if (background.get(game) === task) background.delete(game);});
    background.set(game, task); return task;
  }
  return Object.freeze({acquire, importPackage, startBackgroundUpdate, catalogUrl, fetchImpl, getPackageFetch, languageNetwork: network, installPublished: deps.installPublished,
    readCurrent: deps.readCurrent, getMetadata: () => metadata.getSnapshot(), refreshInstalled: installedChanged});
}
export type PackageAcquisition = ReturnType<typeof createPackageAcquisition>;
