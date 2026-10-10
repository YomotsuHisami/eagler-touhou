import {readPackageObject} from '../../package/package-store.mjs';
import {resolveLanguagePackSource, type LanguageCatalogEntry, type RemoteLanguagePackSource} from '../../src/launcher/language-catalog.mts';
import {validateStaticLanguagePackEntries} from '../../src/launcher/language-pack-validation.mts';
import {rememberOfflineLanguage} from '../../src/launcher/offline-language-index.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import type {Translate} from '../i18n';
import {checkPreparationAbort, type PreparationProgress} from './package-acquisition';
import type {PreparationNetwork} from './preparation-network';

export interface LanguagePackDependencies {
  readObject: typeof readPackageObject;
  hash: typeof sha256Hex;
  unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>>;
}
/** Main app 6061–6228: one optional launch asset, never a durable language
 * preference mutation. An invalid cached object gets one verified redownload. */
export async function prepareLanguagePack({game, entry, baseUrl, signal, translate: t, fetchImpl = globalThis.fetch,
  caches = null, storage = null, onProgress, onLanguageDownloadActivity, network, dependencies}: {
  game: GameId;
  entry: LanguageCatalogEntry | null;
  baseUrl: string;
  signal?: AbortSignal;
  translate: Translate;
  fetchImpl?: typeof fetch;
  caches?: Pick<CacheStorage, 'open'> | null;
  storage?: Storage | null;
  onProgress?(progress: PreparationProgress): void;
  /** Main 6112–6145: actual remote download only; cache/local reads are inert. */
  onLanguageDownloadActivity?(active: boolean): void;
  network?: Pick<PreparationNetwork, 'beginLanguage'>;
  dependencies?: Partial<LanguagePackDependencies>;
}) {
  checkPreparationAbort(signal);
  const pack = resolveLanguagePackSource(entry, baseUrl);
  if (!pack) return null;
  const deps: LanguagePackDependencies = {readObject: readPackageObject, hash: sha256Hex,
    unzip: async bytes => {const zip = await import('fflate'); if (!zip.unzipSync) throw new Error(t('file.zipComponentMissing')); return zip.unzipSync(bytes);}, ...dependencies};
  let archive: Uint8Array | null = null, cache: Cache | null = null, cacheKey: Request | null = null;
  let fromCache = false, durableCache = false;
  const label = entry?.title || entry?.id || t('language.fallbackName');
  function progress(message: string, loaded?: number, totalBytes?: number, speed = 0, complete = false) {
    onProgress?.({stage: 'language', message, loaded, totalBytes,
      ...(loaded !== undefined ? {presentation: {kind: 'language', mode: 'language', label, loaded, total: totalBytes, speed}} : {}),
      ...(complete ? {completion: 'language'} : {})});
  }
  async function download(remote: RemoteLanguagePackSource, mode: RequestCache) {
    const controller = new AbortController(); let timedOut = false;
    let task: ReturnType<PreparationNetwork['beginLanguage']> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {clearTimeout(timer); timer = setTimeout(() => {timedOut = true; controller.abort();}, 15_000);};
    const cancel = () => controller.abort(signal?.reason);
    checkPreparationAbort(signal);
    signal?.addEventListener('abort', cancel, {once: true});
    arm();
    try {
      onLanguageDownloadActivity?.(true);
      task = network?.beginLanguage(label) ?? null;
      progress(t('language.requesting', {language: label}));
      const response = await fetchImpl(remote.url, {cache: mode, signal: controller.signal});
      if (!response.ok) throw new Error(`${new URL(remote.url).pathname}: HTTP ${response.status}`);
      arm(); const total = Number(response.headers.get('Content-Length')) || remote.bytes || 0, started = performance.now();
      task?.received(0, total);
      if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer()); arm(); checkPreparationAbort(signal);
        task?.received(bytes.length, total || bytes.length);
        progress(t('language.downloadComplete'), bytes.length, total || bytes.length, 0, true); return bytes;
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let loaded = 0;
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          arm(); checkPreparationAbort(signal); chunks.push(value); loaded += value.length;
          task?.received(loaded, total);
          progress(t('language.downloading'), loaded, total, loaded / Math.max((performance.now() - started) / 1000, .1));
        }
      } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
      const bytes = new Uint8Array(loaded); let offset = 0;
      for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
      progress(t('language.downloadComplete'), loaded, total || loaded, 0, true); return bytes;
    } catch (error) {
      checkPreparationAbort(signal);
      if (timedOut) throw new Error(t('language.streamTimeout', {path: new URL(remote.url).pathname}));
      throw error;
    } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel); task?.finish(); onLanguageDownloadActivity?.(false);}
  }
  async function downloadArchive(remote: RemoteLanguagePackSource, mode: RequestCache) {
    try {return await download(remote, mode);}
    catch (error) {
      onProgress?.({stage: 'language', message: '', failure: {kind: 'language', label, reason: error instanceof Error ? error.message : String(error)}});
      throw error;
    }
  }
  if (pack.packageLocal === true) {
    const object = await deps.readObject(pack.packageObjectId); checkPreparationAbort(signal);
    if (object?.data instanceof ArrayBuffer) archive = new Uint8Array(object.data);
    else if (object?.blob) archive = new Uint8Array(await object.blob.arrayBuffer());
    else throw new Error(t('language.localMissing'));
  } else {
    try {cache = await caches?.open('eagler-touhou-language-packs-v1') ?? null;} catch {}
    cacheKey = new Request(new URL(`/__eagler-language/${game}/${pack.language}/${pack.sha256}`, new URL(baseUrl).origin));
    const cached = cache ? await cache.match(cacheKey) : null; checkPreparationAbort(signal);
    if (cached) {archive = new Uint8Array(await cached.arrayBuffer()); fromCache = true; durableCache = true;}
    if (!archive) archive = await downloadArchive(pack, 'force-cache');
  }
  checkPreparationAbort(signal);
  if (!archive) throw new Error(t('language.empty'));
  let hash = pack.packageLocal === true ? null : await deps.hash(archive); checkPreparationAbort(signal);
  if (pack.packageLocal !== true && (archive.length !== pack.bytes || hash?.toLowerCase() !== pack.sha256.toLowerCase()) && fromCache) {
    durableCache = false; if (cache && cacheKey) try {await cache.delete(cacheKey);} catch {}
    archive = await downloadArchive(pack, 'no-store'); hash = await deps.hash(archive); checkPreparationAbort(signal);
  }
  if (pack.packageLocal !== true && archive.length !== pack.bytes) throw new Error(t('language.sizeError'));
  if (pack.packageLocal !== true && hash?.toLowerCase() !== pack.sha256.toLowerCase()) throw new Error(t('language.hashError'));
  if (cache && cacheKey) {
    try {await cache.put(cacheKey, new Response(new Uint8Array(archive).buffer)); durableCache = true;} catch {}
  }
  if (pack.packageLocal !== true && durableCache) rememberOfflineLanguage(storage, game, entry, pack);
  checkPreparationAbort(signal);
  const entries = await deps.unzip(archive); checkPreparationAbort(signal);
  const {manifest, files} = validateStaticLanguagePackEntries(entries, {game, language: pack.language});
  const url = 'url' in pack && typeof pack.url === 'string' && pack.url ? pack.url
    : pack.packageObjectId ? new URL(`/__eagler/package-language/${game}/${encodeURIComponent(pack.language)}`, new URL(baseUrl).origin).href : '';
  return {...pack, runtimeVersion: manifest.runtimeVersion, bytes: archive.length, url, manifest, files};
}
export type PreparedLanguagePack = Awaited<ReturnType<typeof prepareLanguagePack>>;
