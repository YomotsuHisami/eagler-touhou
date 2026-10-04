/** Shared published acquisition boundary plus the retained fixed TH06 sample.
 * Product catalog owns canonical DATA/font differences. Both callers reuse these
 * Host/Package/Runtime checks; the sample wrappers still select no optionals.
 * Package Store and RuntimeService retain mutation, lease and lifecycle ownership.
 */
import { loadRemoteMetadata } from '../../src/launcher/remote-metadata.mts';
import { sha256Hex } from '../../src/launcher/sha256.mts';
import { HOST_PROTOCOL, PRODUCT_GAMES, isGameId, productEnabledForBuild, productFeatureAvailable, type GameId } from '../../src/contracts/product-catalog.mts';
import { RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, type ReleaseCatalog } from '../../src/contracts/release-catalog.mts';
import type { HostManifest } from '../../src/contracts/host-manifest.mts';
import {
  RUNTIME_MANIFEST_FILE, validateRuntimeManifest, findRuntimeGroup,
  canonicalRuntimePayload, runtimeGenerationBase,
} from '../../src/contracts/runtime-generations.mts';
import type { InstalledPackageGeneration, PackageDescriptor } from '../../src/contracts/package-read-models.mts';
import { validatePackageDescriptor } from '../../package/package-descriptor.mjs';
import { installPublishedPackage } from '../../package/package-launcher.mjs';
import { readCurrentPackageGeneration, readPackageObject, readPackageObjectKeys } from '../../package/package-store.mjs';
import type { PackageInstallProgress } from '../../package/package-installer.mjs';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';

export const TH06_SAMPLE_SCOPE = Object.freeze({ game: 'th06', runtimeVariant: 'normal', language: 'ja', music: 'none', input: 'keyboard' } as const);
export type SampleLaunchReasonCode = 'invalid-base-url' | 'host-unavailable' | 'game-unavailable' |
  'runtime-unavailable' | 'unpublished-runtime' | 'catalog-unavailable' | 'package-unavailable' |
  'unsupported-package' | 'conflicting-generation' | 'storage-unavailable' | 'missing-object' |
  'integrity-failed' | 'asset-unavailable' | 'cancelled' | 'prepare-failed' | 'unsupported-product' | 'unsupported-music' | 'language-unavailable';
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
export interface SampleLaunchDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  readKeys: typeof readPackageObjectKeys;
  readObject: typeof readPackageObject;
  install: typeof installPublishedPackage;
}
export interface Th06SampleOptions {
  /** Explicit same-origin application mount, with a trailing slash. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  dependencies?: Partial<SampleLaunchDependencies>;
}
export interface PrepareTh06SampleOptions extends Th06SampleOptions {
  runtimeService: { prepare(plan: RuntimePlan): Promise<RuntimeSnapshot> };
  onProgress?: (progress: PackageInstallProgress) => void;
}
export interface ResolvedPublishedGame {
  game: GameId; baseIds: string[]; strictSample?: boolean;
  baseUrl: string; host: HostManifest; catalog: ReleaseCatalog | null; descriptor: PackageDescriptor;
  generation: InstalledPackageGeneration | null; entry: string;
}
export const sampleErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function fail(code: SampleLaunchReasonCode, message: string): never { throw new SampleLaunchError(code, message); }
export function checkPublishedCancelled(signal?: AbortSignal) {
  if (signal?.aborted) fail('cancelled', 'Game preparation was cancelled');
}
export function publishedDependencies(options: Th06SampleOptions): SampleLaunchDependencies {
  return { readCurrent: readCurrentPackageGeneration, readKeys: readPackageObjectKeys,
    readObject: readPackageObject, install: installPublishedPackage, ...options.dependencies };
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
      const response = await fetchImpl(url, { method, cache: 'no-store', signal: controller.signal });
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
      fail('missing-object', `${id}: the installed base resource is missing or has a conflicting revision`);
    }
  }
  return descriptor;
}
export async function resolvePublishedGame(options: Th06SampleOptions & { productId?: string; runtimeVariant?: 'normal' | 'multiplayer'; strictSample?: boolean }, checks: SampleAssetCheck[]): Promise<ResolvedPublishedGame> {
  const game = options.productId ?? 'th06';
  if (!isGameId(game) || !productEnabledForBuild(game)) fail('unsupported-product', 'Choose a published singleplayer product from the product catalog');
  const baseIds = Object.keys(publishedBaseFiles(game));
  const variant = options.runtimeVariant ?? 'normal';
  if (variant !== 'normal' && variant !== 'multiplayer') fail('unsupported-product', 'Unknown Runtime variant');
  if (variant === 'multiplayer' && !('multiplayerRuntime' in PRODUCT_GAMES[game])) fail('unsupported-product', 'This product has no multiplayer Runtime');
  checkPublishedCancelled(options.signal);
  const baseUrl = mountUrl(options.baseUrl), request = publishedIO(options, checks), deps = publishedDependencies(options);
  const metadata = await loadRemoteMetadata(file => request(new URL(file, baseUrl).href, 'metadata', response => response.json()));
  checkPublishedCancelled(options.signal);
  if (!metadata.hostManifest.ok) fail('host-unavailable', `Game Host Manifest unavailable: ${sampleErrorText(metadata.hostManifest.error)}`);
  const host = metadata.hostManifest.value, hostGame = host.games[game];
  if (!hostGame) fail('game-unavailable', 'The Host Manifest does not publish Game');
  if (host.shared.runtimeManifest !== RUNTIME_MANIFEST_FILE) {
    fail('unpublished-runtime', 'Published launch requires a published Runtime Manifest; live development Runtime discovery is not implemented');
  }
  const runtimeEntry = variant === 'multiplayer' ? hostGame.multiplayerRuntime : hostGame.runtime;
  if (!runtimeEntry) fail('runtime-unavailable', 'The Host does not publish the selected Runtime variant');
  const entry = new URL(runtimeEntry, baseUrl), base = new URL(baseUrl);
  if (entry.origin !== base.origin || !entry.pathname.startsWith(base.pathname)) fail('runtime-unavailable', 'Game Runtime must be inside the same-origin application mount');
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
  let current;
  try { current = await deps.readCurrent(game); }
  catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package Store unavailable: ${sampleErrorText(error)}`, { cause: error }); }
  checkPublishedCancelled(options.signal);
  const catalog = metadata.releaseCatalog.ok ? metadata.releaseCatalog.value : null;
  if (current.generation) {
    const generation = current.generation;
    if (current.installation?.game !== game || current.installation.currentGeneration !== generation.id) fail('conflicting-generation', 'Package Store current-generation identity is inconsistent');
    const descriptor = canonicalPublishedGeneration(generation, host, game, options.strictSample);
    const baseIds = descriptor.base.files;
    let keys: Set<string>;
    try { keys = await deps.readKeys(baseIds.map(id => generation.files[id]!.objectId)); }
    catch (error) { checkPublishedCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package objects unavailable: ${sampleErrorText(error)}`, { cause: error }); }
    if (baseIds.some(id => !keys.has(generation.files[id]!.objectId))) fail('missing-object', 'The installed Game base has evicted or missing objects');
    checkPublishedCancelled(options.signal);
    return { game, baseIds, strictSample: options.strictSample, baseUrl, host, catalog, descriptor, generation, entry: entry.href };
  }
  if (!catalog) fail('catalog-unavailable', 'No installed Game generation and no valid Release Catalog');
  const descriptorUrl = releaseCatalogEntryUrl(new URL(RELEASE_CATALOG_FILE, baseUrl).href, catalog, game);
  if (!descriptorUrl) fail('package-unavailable', 'No installed Game generation or published Game Package');
  const descriptor = canonicalPublishedDescriptor(await request(descriptorUrl, 'metadata', response => response.json()), host, game, {strictSample: options.strictSample});
  if (descriptor.revision !== catalog.games[game]!.revision) fail('conflicting-generation', 'Release Catalog and Game Package revisions disagree');
  for (const id of descriptor.base.files) await probe(new URL(descriptor.files[id].source, descriptorUrl).href, descriptor.files[id].bytes!, 'package', request);
  return { game, baseIds: descriptor.base.files, strictSample: options.strictSample, baseUrl, host, catalog, descriptor, generation: null, entry: entry.href };
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
    const failure = error instanceof SampleLaunchError ? error : new SampleLaunchError('prepare-failed', sampleErrorText(error));
    return { available: false, status: 'unavailable', reason: { code: failure.code, message: failure.message },
      scope: TH06_SAMPLE_SCOPE, checks, runtimeVerified: false, packageVerified: false, generationId: null };
  }
}

/** The caller still owns route/Close protection and the explicit launch action.
 * signal cancels acquisition/verification; Runtime preparation cancellation is
 * owned by runtimeService and must be coordinated by the caller's lifecycle.
 */
export async function prepareTh06Sample(options: PrepareTh06SampleOptions): Promise<RuntimeSnapshot> {
  const resolved = await resolvePublishedGame({...options, productId: 'th06', runtimeVariant: 'normal', strictSample: true}, []);
  const generation = await acquirePublishedGeneration(options, resolved);
  const features = resolved.host.games.th06!.features;
  const plan: RuntimePlan = { game: 'th06', runtimeVariant: 'normal', generation, entry: resolved.entry,
    publishedRuntime: true, resourceFileIds: ['shared-msgothic', 'shared-unifont'],
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
    if (!resolved.catalog || resolved.catalog.games[resolved.game]?.revision !== expectedDescriptor.revision) {
      fail('package-unavailable', 'Missing selected resources cannot be acquired from a different Package revision');
    }
    const result = await deps.install(resolved.game, { catalog: resolved.catalog,
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
    const object = await deps.readObject(ref.objectId);
    checkPublishedCancelled(options.signal);
    const bytes = object?.data instanceof ArrayBuffer ? object.data : object?.blob instanceof Blob ? await object.blob.arrayBuffer() : null;
    if (!bytes || bytes.byteLength !== declaration.bytes || await sha256Hex(bytes) !== declaration.sha256!.toLowerCase()) fail('integrity-failed', `${id}: installed resource failed byte/SHA-256 verification`);
    checkPublishedCancelled(options.signal);
  }
  return generation;
}
