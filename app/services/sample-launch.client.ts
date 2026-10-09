/** Shared published acquisition boundary plus the retained fixed TH06 sample.
 * Product catalog owns canonical DATA/font differences. Both callers reuse these
 * Host/Package/Runtime checks; the sample wrappers still select no optionals.
 * Package Store and RuntimeService retain mutation, lease and lifecycle ownership.
 */
import {ensureLocalPackageReady, type StorageCompatibilityIntent} from './storage-bootstrap.client';
import {hostMetadataAddress, readRetainedPublishedHost, retainPublishedHost, type HostMetadataCache} from './host-metadata.client';
import { sha256Hex } from '../../src/launcher/sha256.mts';
import { HOST_PROTOCOL, PRODUCT_GAMES, isGameId, productEnabledForBuild, productFeatureAvailable, type GameId } from '../../src/contracts/product-catalog.mts';
import { RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, validateReleaseCatalog, type ReleaseCatalog } from '../../src/contracts/release-catalog.mts';
import { validateHostManifest, type HostManifest } from '../../src/contracts/host-manifest.mts';
import {
  RUNTIME_MANIFEST_FILE, validateRuntimeManifest, findRuntimeGroup,
  canonicalRuntimePayload, runtimeGenerationBase, parseRuntimeGenerationPath,
} from '../../src/contracts/runtime-generations.mts';
import type { InstalledPackageGeneration, PackageDescriptor } from '../../src/contracts/package-read-models.mts';
import { validatePackageDescriptor } from '../../package/package-descriptor.mjs';
import { installPublishedPackage } from '../../package/package-launcher.mjs';
import { readCurrentPackageGeneration, readPackageObject, readPackageObjectKeys } from '../../package/package-store.mjs';
import {installPackageFromAcquisition, type PackageInstallProgress} from '../../package/package-installer.mjs';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';
import {GameDataAcquisitionError} from './game-data-acquisition';

export const TH06_SAMPLE_SCOPE = Object.freeze({ game: 'th06', runtimeVariant: 'normal', language: 'ja', music: 'none', input: 'keyboard' } as const);
export type SampleLaunchReasonCode = 'invalid-base-url' | 'host-unavailable' | 'game-unavailable' |
  'runtime-unavailable' | 'unpublished-runtime' | 'catalog-unavailable' | 'package-unavailable' |
  'unsupported-package' | 'conflicting-generation' | 'storage-unavailable' | 'missing-object' |
  'storage-repair-required' | 'integrity-failed' | 'asset-unavailable' | 'cancelled' | 'prepare-failed' | 'unsupported-product' | 'unsupported-music' | 'language-unavailable';
export interface SampleLaunchReason { code: SampleLaunchReasonCode; message: string }
export interface SampleAssetCheck { url: string; kind: 'metadata' | 'runtime' | 'package'; available: boolean; status?: number }
export interface Th06SampleInspection {
  available: boolean;
  status: 'installed' | 'installable' | 'unavailable';
  reason: SampleLaunchReason | null;
  scope: typeof TH06_SAMPLE_SCOPE;
  checks: readonly SampleAssetCheck[];
  /** Availability probes are not Runtime hash verification or gameplay evidence. */
  runtimeVerified: false;
  /** Installed bytes are hashed by prepare, never by lightweight inspection. */
  packageVerified: false;
  generationId: string | null;
}
export class SampleLaunchError extends Error {
  constructor(readonly code: SampleLaunchReasonCode, message: string, options?: ErrorOptions) {
    super(message, options); this.name = code === 'cancelled' ? 'AbortError' : 'SampleLaunchError';
  }
}
export function publishedLaunchFailure(error: unknown): SampleLaunchError {
  if (error instanceof SampleLaunchError) return error;
  if (error instanceof GameDataAcquisitionError) {
    const code: SampleLaunchReasonCode = error.code === 'catalog-unavailable' || error.code === 'package-unavailable' || error.code === 'missing-object' ? error.code : 'missing-object';
    return new SampleLaunchError(code, error.message, {cause: error});
  }
  return new SampleLaunchError('prepare-failed', sampleErrorText(error));
}
/** A byte failure is distinct from Package identity/declaration rejection. */
export class PublishedResourceBytesError extends SampleLaunchError {
  constructor(readonly fileId: string, code: 'integrity-failed' | 'storage-unavailable', message: string, options?: ErrorOptions) {
    super(code, message, options); this.name = 'PublishedResourceBytesError';
  }
}
export interface SampleLaunchDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  readKeys: typeof readPackageObjectKeys;
  readObject: typeof readPackageObject;
  install: typeof installPublishedPackage;
  installDevelopment: typeof installPackageFromAcquisition;
  ensureStorage: typeof ensureLocalPackageReady;
}
export interface Th06SampleOptions {
  /** Explicit same-origin application mount, with a trailing slash. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  dependencies?: Partial<SampleLaunchDependencies>;
  /** Metadata cache only; never an alternate Package or executable store. */
  hostMetadataCache?: HostMetadataCache | null;
  /** Only explicit preparation may acquire missing compatibility fonts. */
  storageIntent?: StorageCompatibilityIntent;
}
export interface PrepareTh06SampleOptions extends Th06SampleOptions {
  runtimeService: { prepare(plan: RuntimePlan): Promise<RuntimeSnapshot> };
  onProgress?: (progress: PackageInstallProgress) => void;
}
export interface ResolvedPublishedGame {
  game: GameId; baseIds: string[]; strictSample?: boolean;
  baseUrl: string; host: HostManifest; catalog: ReleaseCatalog | null; descriptor: PackageDescriptor;
  development?: {sources: Record<string, string>; objects: Record<string, ArrayBuffer>};
  generation: InstalledPackageGeneration | null; entry: string; source?: 'local' | 'remote' | null;
}
export const sampleErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function fail(code: SampleLaunchReasonCode, message: string): never { throw new SampleLaunchError(code, message); }
export function checkPublishedCancelled(signal?: AbortSignal) {
  if (signal?.aborted) fail('cancelled', 'Game preparation was cancelled');
}
export function publishedDependencies(options: Th06SampleOptions): SampleLaunchDependencies {
  return { readCurrent: readCurrentPackageGeneration, readKeys: readPackageObjectKeys,
    readObject: readPackageObject, install: installPublishedPackage, installDevelopment: installPackageFromAcquisition, ensureStorage: ensureLocalPackageReady, ...options.dependencies };
}
function mountUrl(value: string) {
  let url: URL;
  try { url = new URL(value, globalThis.location?.href); }
  catch { return fail('invalid-base-url', 'An explicit application mount URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith('/') || url.search || url.hash ||
      url.username || url.password || (globalThis.location && url.origin !== globalThis.location.origin)) {
    fail('invalid-base-url', 'Published launch requires a same-origin HTTP application mount ending in /');
  }
  return url.href;
}
export function publishedIO(options: Th06SampleOptions, checks: SampleAssetCheck[]) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async <T>(url: string, kind: SampleAssetCheck['kind'], read: (response: Response) => Promise<T>, method = 'GET'): Promise<T> => {
    checkPublishedCancelled(options.signal);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 12_000);
    const check: SampleAssetCheck = { url, kind, available: false }; checks.push(check);
    try {
      const response = await fetchImpl(url, { method, cache: 'no-store', redirect: 'error', signal: controller.signal });
      check.status = response.status;
      if (!response.ok) fail('asset-unavailable', `${url}: HTTP ${response.status}`);
      const result = await read(response);
      checkPublishedCancelled(options.signal);
      check.available = true; return result;
    } catch (error) {
      checkPublishedCancelled(options.signal);
      if (error instanceof SampleLaunchError) throw error;
      throw new SampleLaunchError('asset-unavailable', `${url}: ${sampleErrorText(error)}`, { cause: error });
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  };
}
export function publishedBaseFiles(game: GameId) {
  const product = PRODUCT_GAMES[game];
  const shared: readonly string[] = 'requiredShared' in product ? product.requiredShared : ['/msgothic.ttc', '/unifont.otf'];
  return Object.fromEntries([
    [product.package.dataFileId, { source: `games/${game}${product.package.dataTarget}`, target: product.package.dataTarget }],
    ...shared.map(target => [target === '/msgothic.ttc' ? 'shared-msgothic' : 'shared-unifont', { source: `shared${target}`, target }]),
  ]) as Record<string, { source: string; target: string }>;
}
export function canonicalPublishedDescriptor(value: unknown, host: HostManifest, game: GameId = 'th06', {installed = false, strictSample = false}: {installed?: boolean; strictSample?: boolean} = {}): PackageDescriptor {
  const base = publishedBaseFiles(game), baseIds = Object.keys(base);
  let descriptor: PackageDescriptor;
  try { descriptor = validatePackageDescriptor(value); }
  catch (error) { throw new SampleLaunchError('unsupported-package', `Invalid Game Package: ${sampleErrorText(error)}`, { cause: error }); }
  const data = host.games[game]!.gameData, requirement = descriptor.runtimeRequirement;
  if (descriptor.game !== game || descriptor.runtime || descriptor.runtimes ||
      (strictSample && descriptor.base.files.length !== baseIds.length) || !baseIds.every(id => descriptor.base.files.includes(id)) ||
      requirement?.protocol !== HOST_PROTOCOL || requirement.target !== game || requirement.dataFile !== 'game-data' ||
      requirement.dataLayout !== data.layout || strictSample && Object.values(descriptor.components).some(component => component.type === 'resource')) {
    fail('unsupported-package', 'This launch requires the canonical Game DATA and shared-font Package base');
  }
  for (const [id, expected] of Object.entries(base)) {
    const file = descriptor.files[id];
    if (!file || (!installed || strictSample) && file.source !== expected.source || file.target !== expected.target ||
        !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || !file.sha256 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      fail('unsupported-package', `${id}: a canonical path, byte count and full SHA-256 are required`);
    }
  }
  const resourceIds = new Set([...descriptor.base.files.filter(id => id !== 'game-data'),
    ...Object.values(descriptor.components).filter(component => component.type === 'resource').flatMap(component => component.files ?? component.entries?.map(entry => entry.file) ?? [])]);
  const targets = new Set<string>();
  for (const id of resourceIds) {
    const file = descriptor.files[id], saveRoot = PRODUCT_GAMES[game].storage.saveRoot;
    if (!file || file.target === PRODUCT_GAMES[game].package.dataTarget || file.target === saveRoot || file.target.startsWith(`${saveRoot}/`) ||
        /\.(?:html|m?js|wasm|data|cfg|rpy)$/i.test(file.target) || /\.(?:html|m?js|wasm|data)$/i.test(file.source) ||
        !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '') || targets.has(file.target)) {
      fail('unsupported-package', `${id}: resources must be unique verified non-executable files outside save/DATA paths`);
    }
    targets.add(file.target);
  }
  if (descriptor.files['game-data'].bytes !== data.bytes ||
      descriptor.files['game-data'].sha256!.toLowerCase() !== data.sha256.toLowerCase()) {
    fail('conflicting-generation', 'Installed or published Game DATA does not match the current Host Manifest');
  }
  return descriptor;
}
export function canonicalPublishedGeneration(generation: InstalledPackageGeneration, host: HostManifest, game: GameId = 'th06', strictSample = false) {
  const baseIds = generation.descriptor?.base?.files ?? [];
  if (!generation?.id || generation.game !== game) fail('conflicting-generation', 'The installed generation is not Game');
  const descriptor = canonicalPublishedDescriptor(generation.descriptor, host, game, {installed: true, strictSample});
  for (const id of baseIds) {
    if (!generation.files[id]?.objectId || generation.files[id]?.revision !== descriptor.files[id].revision) {
      if (id === 'game-data') throw new GameDataAcquisitionError(`${id}: the installed DATA is missing or has a conflicting revision`, undefined, 'missing-object');
      fail('missing-object', `${id}: the installed base resource is missing or has a conflicting revision`);
    }
  }
  return descriptor;
}
export async function resolvePublishedGame(options: Th06SampleOptions & { productId?: string; runtimeVariant?: 'normal' | 'multiplayer'; strictSample?: boolean }, checks: SampleAssetCheck[], onHost?: (host: HostManifest) => void): Promise<ResolvedPublishedGame> {
  const game = options.productId ?? 'th06';
  if (!isGameId(game) || !productEnabledForBuild(game, true)) fail('unsupported-product', 'Choose a published singleplayer product from the product catalog');
  const variant = options.runtimeVariant ?? 'normal';
  if (variant !== 'normal' && variant !== 'multiplayer') fail('unsupported-product', 'Unknown Runtime variant');
  if (variant === 'multiplayer' && !('multiplayerRuntime' in PRODUCT_GAMES[game])) fail('unsupported-product', 'This product has no multiplayer Runtime');
  checkPublishedCancelled(options.signal);
  const baseUrl = mountUrl(options.baseUrl), request = publishedIO(options, checks), deps = publishedDependencies(options);
  // Observe Package Store before publication work. The installed branch below
  // never probes executable URLs: only RuntimeService may establish code readiness.
  let observed;
  try { observed = await deps.readCurrent(game); }
  catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package Store unavailable: ${sampleErrorText(error)}`, { cause: error }); }
  // Catalog refresh is optional for keep-current. Its timeout must never hold
  // the installed branch hostage; acquisition explicitly waits when it needs it.
  let catalog: ReleaseCatalog | null = null;
  const catalogReady = loadPublishedCatalog(options, baseUrl, checks).then(value => {catalog = value; return value;});
  const hostUrl = hostMetadataAddress(baseUrl);
  let host: HostManifest | undefined;
  let body: string | undefined;
  try { body = await request(hostUrl, 'metadata', response => response.text()); }
  catch (error) {
    checkPublishedCancelled(options.signal);
    const hostCheck = [...checks].reverse().find(check => check.url === hostUrl);
    // An explicit removal/denial is not an offline condition.
    if (hostCheck?.status && hostCheck.status >= 400 && hostCheck.status < 500) {
      throw new SampleLaunchError('host-unavailable', `Game Host Manifest refused: ${sampleErrorText(error)}`, {cause: error});
    }
    const publication = observed.generation ? await request(new URL('ui-publication.json', baseUrl).href, 'metadata', response => response.json()).catch(() => null) : null;
    const retained = publication ? await readRetainedPublishedHost(baseUrl, publication, options.hostMetadataCache) : null;
    checkPublishedCancelled(options.signal);
    if (!retained) throw new SampleLaunchError('host-unavailable', `Game Host Manifest unavailable: ${sampleErrorText(error)}`, {cause: error});
    host = retained;
  }
  if (body !== undefined) {
    // A fetched invalid Host is authoritative failure, never a cache fallback.
    try { host = validateHostManifest(JSON.parse(body)); }
    catch (error) { throw new SampleLaunchError('host-unavailable', `Invalid Game Host Manifest: ${sampleErrorText(error)}`, {cause: error}); }
    await retainPublishedHost(baseUrl, host, body, options.hostMetadataCache);
  }
  checkPublishedCancelled(options.signal);
  if (!host) fail('host-unavailable', 'Game Host Manifest unavailable');
  const hostGame = host.games[game];
  onHost?.(host);
  if (!productEnabledForBuild(game, host.shared.testBuild === true)) fail('unsupported-product', 'The Host does not enable this test product');
  if (!hostGame) fail('game-unavailable', 'The Host Manifest does not publish Game');
  const development = host.profile === 'web-development' && host.shared.resourceMode === 'hosted' && host.shared.testBuild === true && host.shared.runtimeManifest == null;
  if (!development && host.shared.runtimeManifest !== RUNTIME_MANIFEST_FILE) {
    fail('unpublished-runtime', 'Launch requires a published Runtime Manifest or an explicit hosted web-development Host');
  }
  const runtimeEntry = variant === 'multiplayer' ? hostGame.multiplayerRuntime : hostGame.runtime;
  if (!runtimeEntry) fail('runtime-unavailable', 'The Host does not publish the selected Runtime variant');
  const entry = new URL(runtimeEntry, baseUrl), base = new URL(baseUrl);
  if (entry.origin !== base.origin || !entry.pathname.startsWith(base.pathname)) fail('runtime-unavailable', 'Game Runtime must be inside the same-origin application mount');
  const runtimePath = entry.pathname.slice(base.pathname.length);
  const expectedRoot = `runtime/${game}/${variant === 'multiplayer' ? 'multiplayer/' : ''}`;
  const codeIdentity = parseRuntimeGenerationPath(runtimePath);
  if (development ? entry.hash || entry.username || entry.password || decodeURIComponent(entry.pathname.split('/').at(-1)!) !== `${game}.html` : codeIdentity ? codeIdentity.root !== expectedRoot || codeIdentity.file !== `${game}.html`
    : runtimePath !== `${expectedRoot}${game}.html`) fail('runtime-unavailable', 'The Host Runtime does not match the selected game and variant');
  const compatibility = await deps.ensureStorage(game, {baseUrl, fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs, signal: options.signal, intent: options.storageIntent ?? 'inspect', host});
  checkPublishedCancelled(options.signal);
  if (compatibility.status === 'needs-repair' && compatibility.repairable) {
    fail('storage-repair-required', compatibility.warning ?? 'Verified local DATA needs shared-font preparation');
  }
  if (['needs-repair', 'deferred'].includes(compatibility.status) && (compatibility.legacyPresent || compatibility.generationId)) {
    fail('storage-unavailable', compatibility.warning ?? 'Historical local resources are retained while compatibility preparation is deferred');
  }
  let current;
  try { current = await deps.readCurrent(game); }
  catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package Store unavailable: ${sampleErrorText(error)}`, { cause: error }); }
  checkPublishedCancelled(options.signal);
  const developmentSources = development ? developmentSourceUrls(host, game, baseUrl) : undefined;
  if (current.generation) {
    const generation = current.generation;
    if (current.installation?.game !== game || current.installation.currentGeneration !== generation.id) fail('conflicting-generation', 'Package Store current-generation identity is inconsistent');
    const descriptor = canonicalPublishedGeneration(generation, host, game, options.strictSample);
    const baseIds = descriptor.base.files;
    let keys: Set<string>;
    try { keys = await deps.readKeys(baseIds.map(id => generation.files[id]!.objectId)); }
    catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package objects unavailable: ${sampleErrorText(error)}`, { cause: error }); }
    if (!keys.has(generation.files['game-data']!.objectId)) throw new GameDataAcquisitionError('The installed DATA object has been evicted or is missing', undefined, 'missing-object');
    if (baseIds.some(id => !keys.has(generation.files[id]!.objectId))) fail('missing-object', 'The installed Game base has evicted or missing objects');
    checkPublishedCancelled(options.signal);
    return { game, baseIds, strictSample: options.strictSample, baseUrl, host, catalog, descriptor, generation, entry: entry.href, source: current.installation?.source ?? null, ...(developmentSources ? {development: {sources: developmentSources, objects: {}}} : {}) };
  }
  if (developmentSources) {
    const prepared = await developmentDescriptor(host, game, developmentSources, request);
    const descriptor = canonicalPublishedDescriptor(prepared.descriptor, host, game, {strictSample: options.strictSample});
    await request(entry.href, 'runtime', async () => {}, 'HEAD');
    await probe(developmentSources['game-data'], hostGame.gameData.bytes, 'package', request);
    return {game, baseIds: descriptor.base.files, strictSample: options.strictSample, baseUrl, host, catalog: null,
      descriptor, generation: null, entry: entry.href, development: {sources: developmentSources, objects: prepared.objects}};
  }
  // Availability probes remain useful for a fresh install, but cannot reject
  // an installed Package before canonical verified-cache Runtime fallback.
  let runtime;
  try { runtime = validateRuntimeManifest(await request(new URL(RUNTIME_MANIFEST_FILE, baseUrl).href, 'metadata', response => response.json())); }
  catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('runtime-unavailable', `Game Runtime Manifest unavailable: ${sampleErrorText(error)}`, { cause: error }); }
  const group = findRuntimeGroup(runtime, entry.pathname.slice(base.pathname.length));
  if (!group || group.root !== `runtime/${game}/${variant === 'multiplayer' ? 'multiplayer/' : ''}` || group.current.entry !== `${game}.html`) fail('runtime-unavailable', 'The manifest does not contain the normal Game Runtime');
  let runtimeAvailable = false;
  for (const candidate of [group.current, ...group.previous]) {
    try {
      if (await sha256Hex(new TextEncoder().encode(canonicalRuntimePayload(candidate.entry, candidate.files))) !== candidate.generation) {
        fail('runtime-unavailable', 'Game Runtime generation identity is invalid');
      }
      for (const file of candidate.files) {
        await probe(new URL(runtimeGenerationBase(group.root, candidate.generation) + file.path, baseUrl).href, file.bytes, 'runtime', request);
      }
      runtimeAvailable = true; break;
    } catch (error) { checkPublishedCancelled(options.signal); if (candidate === group.previous.at(-1) || !group.previous.length) throw error; }
  }
  if (!runtimeAvailable) fail('runtime-unavailable', 'No complete Game Runtime is available');
  catalog = await catalogReady;
  checkPublishedCancelled(options.signal);
  if (!catalog) fail('catalog-unavailable', 'No installed Game generation and no valid Release Catalog');
  const descriptorUrl = releaseCatalogEntryUrl(new URL(RELEASE_CATALOG_FILE, baseUrl).href, catalog, game);
  if (!descriptorUrl) fail('package-unavailable', 'No installed Game generation or published Game Package');
  const descriptor = canonicalPublishedDescriptor(await request(descriptorUrl, 'metadata', response => response.json()), host, game, {strictSample: options.strictSample});
  if (descriptor.revision !== catalog.games[game]!.revision) fail('conflicting-generation', 'Release Catalog and Game Package revisions disagree');
  for (const id of descriptor.base.files) await probe(new URL(descriptor.files[id].source, descriptorUrl).href, descriptor.files[id].bytes!, 'package', request);
  return { game, baseIds: descriptor.base.files, strictSample: options.strictSample, baseUrl, host, catalog, descriptor, generation: null, entry: entry.href };
}
/** Catalog authority is optional until a missing resource needs acquisition. */
export async function loadPublishedCatalog(options: Th06SampleOptions, baseUrl: string, checks: SampleAssetCheck[] = []): Promise<ReleaseCatalog | null> {
  try {return validateReleaseCatalog(await publishedIO(options, checks)(new URL(RELEASE_CATALOG_FILE, baseUrl).href, 'metadata', response => response.json()));}
  catch {return null;}
}
function developmentUrl(source: unknown, baseUrl: string) {
  if (typeof source !== 'string' || !source || source.includes('\\')) fail('unsupported-package', 'Development resources need an explicit Host source');
  const url = new URL(source, baseUrl), base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.search || url.hash) {
    fail('unsupported-package', 'Development resources must stay inside the same-origin application mount');
  }
  return url.href;
}
function developmentSourceUrls(host: HostManifest, game: GameId, baseUrl: string) {
  const entry = host.games[game]!, sources: Record<string, string> = {};
  if (entry.gameData.source != null) sources['game-data'] = developmentUrl(entry.gameData.source, baseUrl);
  for (const [id] of Object.entries(publishedBaseFiles(game))) {
    if (id !== 'game-data') sources[id] = developmentUrl(id === 'shared-msgothic' ? host.shared.vanillaFont : host.shared.unicodeFont, baseUrl);
  }
  const ogg = entry.music.ogg;
  if (ogg) {
    const mount = PRODUCT_GAMES[game].package.musicMounts.ogg;
    if (ogg.mount !== mount || typeof ogg.base !== 'string' || !ogg.base.endsWith('/')) fail('unsupported-package', 'Development OGG must use the catalog-owned music mount and explicit Host base');
    for (const name of ogg.files) sources[`ogg:${name}`] = developmentUrl(ogg.base + name, baseUrl);
  }
  return sources;
}
async function developmentDescriptor(host: HostManifest, game: GameId, sources: Record<string, string>, request: ReturnType<typeof publishedIO>) {
  if (!sources['game-data']) fail('package-unavailable', 'This development Host declares DATA identity only; import the matching local Game Package');
  const entry = host.games[game]!, files: PackageDescriptor['files'] = {}, objects: Record<string, ArrayBuffer> = {};
  for (const [id, file] of Object.entries(publishedBaseFiles(game))) {
    const identity = id === 'game-data' ? entry.gameData : await (async () => {
      const bytes = await request(sources[id], 'package', response => {
        if (/text\/html/i.test(response.headers.get('content-type') ?? '')) fail('asset-unavailable', 'Development font URL returned HTML');
        return response.arrayBuffer();
      });
      if (!bytes.byteLength) fail('asset-unavailable', 'Development font is empty');
      objects[id] = bytes;
      return {bytes: bytes.byteLength, sha256: await sha256Hex(bytes)};
    })();
    files[id] = {...file, revision: `sha256-${identity.sha256}`, bytes: identity.bytes, sha256: identity.sha256};
  }
  const ogg = entry.music.ogg, oggIds: string[] = [];
  if (ogg) for (const [index, name] of ogg.files.entries()) {
    const id = `ogg:${name}`; oggIds.push(id);
    files[id] = {revision: ogg.version, source: `games/${game}/music/ogg/${name}`, target: `${PRODUCT_GAMES[game].package.musicMounts.ogg}/${name}`, bytes: ogg.sizes[index], sha256: ogg.sha256[index]};
  }
  const descriptor: PackageDescriptor = {schema: 'eagler-touhou/package/1', game, revision: 'development',
    runtimeRequirement: {protocol: HOST_PROTOCOL, target: game, dataFile: 'game-data', dataLayout: entry.gameData.layout},
    files, base: {files: Object.keys(publishedBaseFiles(game))}, components: oggIds.length ? {ogg: {type: 'ogg', files: oggIds}} : {}};
  descriptor.revision = `development-${await sha256Hex(new TextEncoder().encode(JSON.stringify(descriptor)))}`;
  return {descriptor, objects};
}
async function installDevelopmentSelection(options: Th06SampleOptions & {onProgress?: (progress: PackageInstallProgress) => void}, resolved: ResolvedPublishedGame, ids: string[]) {
  const host = validateHostManifest(resolved.host);
  if (host.profile !== 'web-development' || host.shared.testBuild !== true || host.shared.resourceMode !== 'hosted' || host.shared.runtimeManifest != null) {
    fail('unsupported-package', 'Development acquisition requires explicit development Host authority');
  }
  const sources = developmentSourceUrls(host, resolved.game, resolved.baseUrl);
  const development = resolved.development!, descriptor = structuredClone(resolved.descriptor), deps = publishedDependencies(options);
  const request = publishedIO(options, []);
  const sourceFor = (id: string) => {
    const file = descriptor.files[id];
    if (resolved.baseIds.includes(id)) return sources[id];
    const ogg = host.games[resolved.game]!.music.ogg;
    const name = file.target.split('/').at(-1)!, index = ogg?.files.indexOf(name) ?? -1;
    if (!ogg || index < 0 || file.target !== `${PRODUCT_GAMES[resolved.game].package.musicMounts.ogg}/${name}` ||
        file.bytes !== ogg.sizes[index] || file.sha256?.toLowerCase() !== ogg.sha256[index].toLowerCase()) return undefined;
    return sources[`ogg:${name}`];
  };
  // Keep mutations and lease-aware atomic preservation in the existing writer.
  return deps.installDevelopment({descriptor, expectedGenerationId: resolved.generation?.id ?? null, reuseCurrent: true,
    source: current => current.installation?.source === 'local' ? 'local' : 'remote',
    desiredFileIds: current => [...new Set([...ids, ...Object.keys(current.generation?.files ?? {}).filter(id => !!descriptor.files[id])])],
    signal: options.signal, onProgress: options.onProgress,
    acquire: async id => {
      checkPublishedCancelled(options.signal);
      const source = sourceFor(id);
      if (!source) fail('package-unavailable', `${id}: no matching development Host source; import the missing resource`);
      return development.objects[id] ?? request(source, 'package', async response => {
        if (/text\/html/i.test(response.headers.get('content-type') ?? '')) fail('asset-unavailable', `${id}: development source returned HTML`);
        return response.arrayBuffer();
      });
    }});
}
async function probe(url: string, bytes: number, kind: 'runtime' | 'package', request: ReturnType<typeof publishedIO>) {
  await request(url, kind, async response => {
    const length = response.headers.get('content-length');
    if (length !== null && !response.headers.has('content-encoding') && Number(length) !== bytes) fail('asset-unavailable', `${url}: published byte length is unavailable or conflicting`);
    if (!url.endsWith('.html') && /text\/html/i.test(response.headers.get('content-type') ?? '')) fail('asset-unavailable', `${url}: received an HTML fallback instead of a published asset`);
  }, 'HEAD');
}

export async function inspectTh06Sample(options: Th06SampleOptions): Promise<Th06SampleInspection> {
  const checks: SampleAssetCheck[] = [];
  try {
    const resolved = await resolvePublishedGame({...options, productId: 'th06', runtimeVariant: 'normal', strictSample: true}, checks);
    return { available: true, status: resolved.generation ? 'installed' : 'installable', reason: null,
      scope: TH06_SAMPLE_SCOPE, checks, runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null };
  } catch (error) {
    const failure = publishedLaunchFailure(error);
    return { available: false, status: 'unavailable', reason: { code: failure.code, message: failure.message },
      scope: TH06_SAMPLE_SCOPE, checks, runtimeVerified: false, packageVerified: false, generationId: null };
  }
}

/** The caller still owns route/Close protection and the explicit launch action.
 * signal cancels acquisition/verification; Runtime preparation cancellation is
 * owned by runtimeService and must be coordinated by the caller's lifecycle.
 */
export async function prepareTh06Sample(options: PrepareTh06SampleOptions): Promise<RuntimeSnapshot> {
  const resolved = await resolvePublishedGame({...options, productId: 'th06', runtimeVariant: 'normal', strictSample: true, storageIntent: 'prepare'}, []);
  const generation = await acquirePublishedGeneration(options, resolved);
  const features = resolved.host.games.th06!.features;
  const plan: RuntimePlan = { game: 'th06', runtimeVariant: 'normal', generation, entry: resolved.entry,
    publishedRuntime: !resolved.development, ...(resolved.development ? {developmentRuntimeHost: resolved.host} : {}), resourceFileIds: ['shared-msgothic', 'shared-unifont'],
    configure: { music: 'none', resources: [], runtimeResources: [], sharedResources: [], runtimePack: null,
      options: { limitPresentationTo60: false, touchEnabled: false, touchMovementMode: 'touch',
        touchSensitivity: 150, touchFocusMode: 'hold-button', doubleTapBombEnabled: false,
        alwaysHitbox: false, oggDecodeMode: 'stream',
        ...(productFeatureAvailable('th06', 'thprac', features) ? { thpracEnabled: false, thpracLocale: 'ja-JP' } : {}),
        ...(productFeatureAvailable('th06', 'focusHitbox', features) ? { focusHitboxEnabled: false } : {}) } } };
  checkPublishedCancelled(options.signal);
  return options.runtimeService.prepare(plan);
}

/** One acquisition/integrity boundary shared by sample and general launch. Optional
 * files are explicit selections; the Package installer owns atomic preservation. */
export async function acquirePublishedGeneration(
  options: Th06SampleOptions & { onProgress?: (progress: PackageInstallProgress) => void },
  resolved: ResolvedPublishedGame,
  selectedIds: readonly string[] = [],
): Promise<InstalledPackageGeneration> {
  const deps = publishedDependencies(options);
  const expectedDescriptor = structuredClone(resolved.descriptor);
  const ids = [...new Set([...resolved.baseIds, ...selectedIds])];
  for (const id of ids) {
    const file = expectedDescriptor.files[id];
    if (!file || !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || !file.sha256 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      fail('unsupported-package', `${id}: a byte count and full SHA-256 are required`);
    }
  }
  let generation = resolved.generation;
  if (!generation || ids.some(id => !generation!.files[id]?.objectId)) {
    checkPublishedCancelled(options.signal);
    if (!resolved.development) resolved.catalog ??= await loadPublishedCatalog(options, resolved.baseUrl, []);
    if (!resolved.development && (!resolved.catalog || resolved.catalog.games[resolved.game]?.revision !== expectedDescriptor.revision)) {
      fail('package-unavailable', 'Missing selected resources cannot be acquired from a different Package revision');
    }
    const result = resolved.development ? await installDevelopmentSelection(options, resolved, ids) : await deps.install(resolved.game, { catalog: resolved.catalog!,
      catalogUrl: new URL(RELEASE_CATALOG_FILE, resolved.baseUrl).href,
      addComponents: [], addFileIds: [...selectedIds], preserveLocalSource: true,
      fetchImpl: options.fetchImpl, signal: options.signal, onProgress: options.onProgress });
    generation = result.generation;
    if (!generation?.descriptor || generation.descriptor.revision !== expectedDescriptor.revision || ids.some(id =>
      ['revision', 'source', 'target', 'bytes', 'sha256'].some(field =>
        generation!.descriptor.files[id]?.[field] !== expectedDescriptor.files[id][field]))) {
      fail('conflicting-generation', 'Package publication changed during preparation; inspect again');
    }
  }
  checkPublishedCancelled(options.signal);
  canonicalPublishedGeneration(generation, resolved.host, resolved.game, resolved.strictSample);
  for (const id of ids) {
    const declaration = generation.descriptor.files[id], ref = generation.files[id];
    if (!ref?.objectId || ref.revision !== declaration.revision) fail('missing-object', `${id}: the selected resource is missing or has a conflicting revision`);
    let bytes: ArrayBuffer | null;
    try {
      const object = await deps.readObject(ref.objectId);
      checkPublishedCancelled(options.signal);
      bytes = object?.data instanceof ArrayBuffer ? object.data : object?.blob instanceof Blob ? await object.blob.arrayBuffer() : null;
    } catch (error) {
      checkPublishedCancelled(options.signal);
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new PublishedResourceBytesError(id, 'storage-unavailable', `${id}: installed resource could not be read: ${sampleErrorText(error)}`, {cause: error});
    }
    checkPublishedCancelled(options.signal);
    if (!bytes || bytes.byteLength !== declaration.bytes || await sha256Hex(bytes) !== declaration.sha256!.toLowerCase()) {
      throw new PublishedResourceBytesError(id, 'integrity-failed', `${id}: installed resource failed byte/SHA-256 verification`);
    }
    checkPublishedCancelled(options.signal);
  }
  return generation;
}
