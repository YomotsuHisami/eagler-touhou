/** Existing static language pack contract and cache identity, without UI ownership. */
import {unzipSync} from 'fflate';
import {resolveLanguagePackSource, type LanguageCatalogEntry} from '../../src/launcher/language-catalog.mts';
import {rememberOfflineLanguage} from '../../src/launcher/offline-language-index.mts';
import {validateStaticLanguagePackEntries} from '../../src/launcher/language-pack-validation.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import {publishedDependencies, checkPublishedCancelled, SampleLaunchError, type ResolvedPublishedGame, type Th06SampleOptions} from './sample-launch.client';
export interface LanguagePackEnvironment {
  cacheStorage?: Pick<CacheStorage, 'open'> | null;
  offlineStorage?: Storage | null;
}
export interface LanguagePackOptions extends Th06SampleOptions, LanguagePackEnvironment {
  resolved: ResolvedPublishedGame;
  language: string;
  entry: LanguageCatalogEntry | null;
}
function error(code: ConstructorParameters<typeof SampleLaunchError>[0], text: string): never {throw new SampleLaunchError(code, text);}
export const LANGUAGE_PACK_CACHE = 'eagler-touhou-language-packs-v1';
/** Idle-based timeout matches the existing launcher; chunk traffic extends it. */
async function download(options: LanguagePackOptions, url: string, expectedBytes: number, cache: RequestCache) {
  const controller = new AbortController(), signal = options.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {clearTimeout(timer); timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 15_000);};
  const abort = () => controller.abort(signal?.reason);
  checkPublishedCancelled(signal);
  signal?.addEventListener('abort', abort, {once: true}); arm();
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(url, {cache, signal: controller.signal});
    if (!response.ok) error('language-unavailable', `Language pack HTTP ${response.status}`);
    arm();
    if (!response.body) return new Uint8Array(await response.arrayBuffer());
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); checkPublishedCancelled(signal);
        if (chunk.done) break;
        arm(); length += chunk.value.byteLength;
        if (length > expectedBytes) {void reader.cancel(); error('integrity-failed', 'The language pack exceeds its published byte count');}
        chunks.push(chunk.value);
      }
    } finally {reader.releaseLock();}
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength;}
    return result;
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort); checkPublishedCancelled(signal);}
}
export async function prepareStaticLanguagePack(options: LanguagePackOptions) {
  const {resolved, language, entry} = options;
  if (language === 'ja') return null;
  if (!entry) error('language-unavailable', 'The selected language is not in the current Host/Package catalog');
  const source = resolveLanguagePackSource(entry, resolved.baseUrl);
  if (!source) error('language-unavailable', 'The selected translation has no published or installed language pack');
  let archive: Uint8Array, url: string;
  if (source.packageLocal === true) {
    const id = source.packageFile, declaration = id ? resolved.descriptor.files[id] : undefined, ref = id ? resolved.generation?.files[id] : undefined;
    if (!declaration?.sha256 || ref?.objectId !== source.packageObjectId || ref.revision !== declaration.revision) error('integrity-failed', 'The installed language pack identity is inconsistent');
    const object = await publishedDependencies(options).readObject(source.packageObjectId); checkPublishedCancelled(options.signal);
    const buffer = object?.data instanceof ArrayBuffer ? object.data : object?.blob instanceof Blob ? await object.blob.arrayBuffer() : null;
    if (!buffer || buffer.byteLength !== declaration.bytes || await sha256Hex(buffer) !== declaration.sha256.toLowerCase()) error('integrity-failed', 'The installed language pack failed byte/SHA-256 verification');
    archive = new Uint8Array(buffer);
    url = new URL(`__eagler/package-language/${resolved.game}/${encodeURIComponent(language)}`, resolved.baseUrl).href;
  } else {
    const remote = new URL(source.url), base = new URL(resolved.baseUrl);
    if (remote.origin !== base.origin || !remote.pathname.startsWith(base.pathname)) error('language-unavailable', 'Language packs must be inside the same-origin application mount');
    url = remote.href;
    let cache: Cache | null = null, cached = false;
    const key = new Request(`${base.origin}/__eagler-language/${resolved.game}/${language}/${source.sha256}`);
    let bytes: Uint8Array | null = null;
    try {
      cache = await (options.cacheStorage === undefined ? globalThis.caches : options.cacheStorage)?.open(LANGUAGE_PACK_CACHE) ?? null;
      const value = await cache?.match(key); if (value) {bytes = new Uint8Array(await value.arrayBuffer()); cached = true;}
    } catch {cache = null;}
    checkPublishedCancelled(options.signal);
    const valid = async (value: Uint8Array) => value.byteLength === source.bytes && await sha256Hex(value) === source.sha256.toLowerCase();
    if (bytes && !await valid(bytes)) {
      try {await cache?.delete(key);} catch {}
      bytes = null;
    }
    if (!bytes) bytes = await download(options, url, source.bytes, cached ? 'no-store' : 'force-cache');
    if (!await valid(bytes)) error('integrity-failed', 'The published language pack failed byte/SHA-256 verification');
    archive = bytes;
    checkPublishedCancelled(options.signal);
    if (cache) try {
      const copy = new Uint8Array(archive.length); copy.set(archive);
      await cache.put(key, new Response(copy.buffer));
      rememberOfflineLanguage(options.offlineStorage ?? null, resolved.game, entry, source);
    } catch { /* Cache refusal is not a reason to discard verified playable bytes. */ }
  }
  checkPublishedCancelled(options.signal);
  const pack = validateStaticLanguagePackEntries(unzipSync(archive), {game: resolved.game, language});
  checkPublishedCancelled(options.signal);
  return {language, url, bytes: archive.byteLength, runtimeVersion: pack.manifest.runtimeVersion, ...pack};
}
