import {componentFileIds} from '../../package/package-generation.mjs';
import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
import type {HostManifest} from '../../src/contracts/host-manifest.mts';
import {releaseCatalogEntryUrl, type ReleaseCatalog} from '../../src/contracts/release-catalog.mts';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import type {MusicMode} from '../../src/launcher/game-preferences.mts';
import type {Translate} from '../i18n';
import {GameDataAcquisitionError} from './game-data-acquisition';
import {checkPreparationAbort, preparationErrorText, type PackageAcquisition, type PreparationProgress} from './package-acquisition';

export const oggMusic = (mode: MusicMode) => mode === 'ogg-stream' || mode === 'ogg-full';
export const musicTransport = (mode: MusicMode): 'ogg' | 'midi' | 'none' => oggMusic(mode) ? 'ogg' : mode === 'midi' ? 'midi' : 'none';
export function packageResourceIds(generation: InstalledPackageGeneration): string[] {
  const descriptor = generation.descriptor, runtimeOwned = new Set<string>();
  const runtimes = descriptor.runtimes || (descriptor.runtime ? {normal: descriptor.runtime} : {});
  for (const runtime of Object.values(runtimes)) for (const id of runtime.bootstrap || [runtime.entry]) if (id) runtimeOwned.add(id);
  const resourceIds = Object.keys(descriptor.components).filter(id => descriptor.components[id].type === 'resource')
    .flatMap(id => componentFileIds(descriptor, id));
  return [...new Set([...descriptor.base.files, ...resourceIds])].filter(id => {
    const declaration = descriptor.files[id];
    return !!declaration && !runtimeOwned.has(id) && id !== descriptor.runtimeRequirement?.dataFile &&
      !!generation.files[id]?.objectId && !/\.(?:html|m?js|wasm)$/i.test(declaration.source || '');
  });
}
export function remoteRuntimeResources(generation: InstalledPackageGeneration | null, host: HostManifest | null,
  catalog: ReleaseCatalog | null, catalogUrl: string, t: Translate) {
  // Main's built-in manifest defaults to hosted while metadata is unavailable.
  // A known Catalog can still supply a missing resource in that local-first path.
  if (!generation || (host && host.shared.resourceMode !== 'hosted') || !catalog?.games[generation.game]) return [];
  const ids = Object.keys(generation.descriptor.components).filter(id => generation.descriptor.components[id].type === 'resource')
    .flatMap(id => componentFileIds(generation.descriptor, id)).filter(id => !generation.files[id]?.objectId);
  if (!ids.length) return [];
  const descriptorUrl = releaseCatalogEntryUrl(catalogUrl, catalog, generation.game);
  if (!descriptorUrl) throw new Error(t('music.packageUrlInvalid'));
  return ids.map(id => {
    const declaration = generation.descriptor.files[id];
    if (!declaration || typeof declaration.source !== 'string' || typeof declaration.target !== 'string') throw new Error(t('music.packageResourceInvalid'));
    return {url: new URL(declaration.source, descriptorUrl).href, path: declaration.target, size: Number(declaration.bytes) || 0};
  });
}
export function sharedResources({game, generation, host, language, thprac, baseUrl, translate: t}: {
  game: GameId; generation: InstalledPackageGeneration | null; host: HostManifest | null;
  language: string; thprac: boolean; baseUrl: string; translate: Translate;
}) {
  const product = PRODUCT_GAMES[game];
  if ('requiredShared' in product && product.requiredShared.length === 0) return [];
  const targets = new Set(generation?.descriptor.base.files.filter(id => !!generation.files[id]?.objectId).map(id => generation.descriptor.files[id]?.target) ?? []);
  const result: {url: string; path: string}[] = [];
  function add(path: string, source: unknown) {
    if (typeof source !== 'string' || !source) throw new GameDataAcquisitionError(generation
      ? t('package.missingRequiredResource', {resource: path.slice(1)}) : t('runtime.sharedFontManifestInvalid'));
    result.push({url: new URL(source, baseUrl).href, path});
  }
  if (language === 'ja' && (!('requiredShared' in product) || product.requiredShared.some(path => path === '/msgothic.ttc')) && !targets.has('/msgothic.ttc')) add('/msgothic.ttc', host?.shared.vanillaFont);
  if ((language !== 'ja' || thprac) && !targets.has('/unifont.otf')) add('/unifont.otf', host?.shared.unicodeFont);
  return result;
}
export function remoteMusicResources(game: GameId, music: MusicMode, host: HostManifest | null, baseUrl: string, t: Translate) {
  if (!oggMusic(music)) return [];
  const pack = host?.games[game]?.music.ogg;
  if (!pack || !Array.isArray(pack.files)) throw new Error(t('music.manifestInvalid'));
  const mount = typeof pack.mount === 'string' ? pack.mount.replace(/\/$/, '') : '';
  const base = typeof pack.base === 'string' ? pack.base : './';
  return pack.files.map((name, index) => {
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\')) throw new Error(t('music.fileNameInvalid'));
    const url = new URL(name, new URL(base, baseUrl));
    if (typeof pack.version === 'string' && pack.version) url.searchParams.set('v', pack.version);
    return {url: url.href, path: `${mount}/${name}`, size: Number(pack.sizes[index]) || 0};
  });
}
/** Main 5768–5815: only the first TWO OGG objects gate startup. An unavailable
 * optional soundtrack chooses the launch-only MIDI sentinel, never rewrites prefs. */
export async function ensureOggStartup({generation, music, acquisition, signal, downloadSignal, translate: t, onProgress, onWarning, onMusicDownloadActivity}: {
  generation: InstalledPackageGeneration | null; music: MusicMode; acquisition: PackageAcquisition;
  signal?: AbortSignal; downloadSignal?: AbortSignal; translate: Translate;
  onProgress?(progress: PreparationProgress): void; onWarning?(message: string): void;
  onMusicDownloadActivity?(active: boolean): void;
}): Promise<{generation: InstalledPackageGeneration | null; music: MusicMode}> {
  if (!generation || !oggMusic(music)) return {generation, music};
  checkPreparationAbort(signal);
  const initial = componentFileIds(generation.descriptor, 'ogg').slice(0, 2);
  if (initial.length < 2) return {generation, music: 'midi'};
  if (initial.every(id => !!generation.files[id]?.objectId)) return {generation, music};
  const metadata = acquisition.getMetadata(), catalog = metadata.releaseCatalog;
  if (metadata.hostManifest?.shared.resourceMode === 'import' || catalog?.games[generation.game]?.revision !== generation.descriptor.revision) {
    onWarning?.(t('music.initialOggIncomplete')); return {generation, music: 'midi'};
  }
  try {
    onMusicDownloadActivity?.(true);
    onProgress?.({stage: 'music', message: t('music.preparingInitialOgg')});
    const result = await acquisition.installPublished(generation.game, {catalog, catalogUrl: acquisition.catalogUrl,
      addFileIds: initial, preserveLocalSource: true,
      signal: signal && downloadSignal ? AbortSignal.any([signal, downloadSignal]) : downloadSignal ?? signal,
      fetchImpl: acquisition.getPackageFetch(generation.game),
      onProgress: progress => onProgress?.({stage: 'music', message: t('music.preparingInitialOggProgress', {...progress}), completed: progress.completed, total: progress.total})});
    checkPreparationAbort(signal);
    if (!initial.every(id => !!result.generation.files[id]?.objectId)) throw new Error(t('music.initialOggPersistFailed'));
    // The running DATA stays pinned. A newer publication/current cannot be
    // silently attached as optional resources for an older native document.
    if (JSON.stringify(result.generation.descriptor) !== JSON.stringify(generation.descriptor) || generation.descriptor.base.files.some(id => JSON.stringify(result.generation.files[id]) !== JSON.stringify(generation.files[id]))) throw new Error(t('music.initialOggPersistFailed'));
    await acquisition.refreshInstalled(generation.game);
    return {generation: result.generation, music};
  } catch (error) {
    checkPreparationAbort(signal);
    if (!downloadSignal?.aborted && !(error instanceof Error && error.name === 'AbortError')) onWarning?.(t('music.initialOggFailed', {reason: preparationErrorText(error)}));
    return {generation, music: 'midi'};
  } finally {onMusicDownloadActivity?.(false);}
}
