/** Bounded published TH06 sample: Japanese, music-none, normal Runtime, keyboard.
 * Inspection never installs. Package Store and RuntimeService keep their existing
 * mutation, integrity, generation, lease, and lifecycle ownership. No preferences
 * are changed and no optional Package components are selected by this seam.
 */
import { loadRemoteMetadata } from '../../src/launcher/remote-metadata.mts';
import { sha256Hex } from '../../src/launcher/sha256.mts';
import { HOST_PROTOCOL, productFeatureAvailable } from '../../src/contracts/product-catalog.mts';
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

const BASE = Object.freeze({
  'game-data': { source: 'games/th06/th06.data', target: '/th06.data' },
  'shared-msgothic': { source: 'shared/msgothic.ttc', target: '/msgothic.ttc' },
  'shared-unifont': { source: 'shared/unifont.otf', target: '/unifont.otf' },
});
const BASE_IDS = Object.keys(BASE);
export const TH06_SAMPLE_SCOPE = Object.freeze({ game: 'th06', runtimeVariant: 'normal', language: 'ja', music: 'none', input: 'keyboard' } as const);
export type SampleLaunchReasonCode = 'invalid-base-url' | 'host-unavailable' | 'game-unavailable' |
  'runtime-unavailable' | 'unpublished-runtime' | 'catalog-unavailable' | 'package-unavailable' |
  'unsupported-package' | 'conflicting-generation' | 'storage-unavailable' | 'missing-object' |
  'integrity-failed' | 'asset-unavailable' | 'cancelled' | 'prepare-failed';
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
interface ResolvedSample {
  baseUrl: string; host: HostManifest; catalog: ReleaseCatalog | null; descriptor: PackageDescriptor;
  generation: InstalledPackageGeneration | null; entry: string;
}
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
function fail(code: SampleLaunchReasonCode, message: string): never { throw new SampleLaunchError(code, message); }
function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) fail('cancelled', 'TH06 sample preparation was cancelled');
}
function dependencies(options: Th06SampleOptions): SampleLaunchDependencies {
  return { readCurrent: readCurrentPackageGeneration, readKeys: readPackageObjectKeys,
    readObject: readPackageObject, install: installPublishedPackage, ...options.dependencies };
}
function mountUrl(value: string) {
  let url: URL;
  try { url = new URL(value, globalThis.location?.href); }
  catch { return fail('invalid-base-url', 'An explicit application mount URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith('/') || url.search || url.hash ||
      url.username || url.password || (globalThis.location && url.origin !== globalThis.location.origin)) {
    fail('invalid-base-url', 'The sample requires a same-origin HTTP application mount ending in /');
  }
  return url.href;
}
function io(options: Th06SampleOptions, checks: SampleAssetCheck[]) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async <T>(url: string, kind: SampleAssetCheck['kind'], read: (response: Response) => Promise<T>, method = 'GET'): Promise<T> => {
    checkCancelled(options.signal);
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
      checkCancelled(options.signal);
      check.available = true; return result;
    } catch (error) {
      checkCancelled(options.signal);
      if (error instanceof SampleLaunchError) throw error;
      throw new SampleLaunchError('asset-unavailable', `${url}: ${text(error)}`, { cause: error });
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  };
}
function canonicalDescriptor(value: unknown, host: HostManifest): PackageDescriptor {
  let descriptor: PackageDescriptor;
  try { descriptor = validatePackageDescriptor(value); }
  catch (error) { throw new SampleLaunchError('unsupported-package', `Invalid TH06 Package: ${text(error)}`, { cause: error }); }
  const data = host.games.th06!.gameData, requirement = descriptor.runtimeRequirement;
  if (descriptor.game !== 'th06' || descriptor.runtime || descriptor.runtimes ||
      descriptor.base.files.length !== BASE_IDS.length || !BASE_IDS.every(id => descriptor.base.files.includes(id)) ||
      requirement?.protocol !== HOST_PROTOCOL || requirement.target !== 'th06' || requirement.dataFile !== 'game-data' ||
      requirement.dataLayout !== data.layout || Object.values(descriptor.components).some(component => component.type === 'resource')) {
    fail('unsupported-package', 'This sample requires the canonical TH06 DATA and shared-font Package base');
  }
  for (const [id, expected] of Object.entries(BASE)) {
    const file = descriptor.files[id];
    if (!file || file.source !== expected.source || file.target !== expected.target ||
        !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || !file.sha256 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      fail('unsupported-package', `${id}: a canonical path, byte count and full SHA-256 are required`);
    }
  }
  if (descriptor.files['game-data'].bytes !== data.bytes ||
      descriptor.files['game-data'].sha256!.toLowerCase() !== data.sha256.toLowerCase()) {
    fail('conflicting-generation', 'Installed or published TH06 DATA does not match the current Host Manifest');
  }
  return descriptor;
}
function canonicalGeneration(generation: InstalledPackageGeneration, host: HostManifest) {
  if (!generation?.id || generation.game !== 'th06') fail('conflicting-generation', 'The installed generation is not TH06');
  const descriptor = canonicalDescriptor(generation.descriptor, host);
  for (const id of BASE_IDS) {
    if (!generation.files[id]?.objectId || generation.files[id]?.revision !== descriptor.files[id].revision) {
      fail('missing-object', `${id}: the installed base resource is missing or has a conflicting revision`);
    }
  }
  return descriptor;
}
async function resolveSample(options: Th06SampleOptions, checks: SampleAssetCheck[]): Promise<ResolvedSample> {
  checkCancelled(options.signal);
  const baseUrl = mountUrl(options.baseUrl), request = io(options, checks), deps = dependencies(options);
  const metadata = await loadRemoteMetadata(file => request(new URL(file, baseUrl).href, 'metadata', response => response.json()));
  checkCancelled(options.signal);
  if (!metadata.hostManifest.ok) fail('host-unavailable', `TH06 Host Manifest unavailable: ${text(metadata.hostManifest.error)}`);
  const host = metadata.hostManifest.value, game = host.games.th06;
  if (!game) fail('game-unavailable', 'The Host Manifest does not publish TH06');
  if (host.shared.runtimeManifest !== RUNTIME_MANIFEST_FILE) {
    fail('unpublished-runtime', 'This bounded sample requires a published Runtime Manifest; live development Runtime discovery is not implemented');
  }
  const entry = new URL(game.runtime, baseUrl), base = new URL(baseUrl);
  if (entry.origin !== base.origin || !entry.pathname.startsWith(base.pathname)) fail('runtime-unavailable', 'TH06 Runtime must be inside the same-origin application mount');
  let runtime;
  try { runtime = validateRuntimeManifest(await request(new URL(RUNTIME_MANIFEST_FILE, baseUrl).href, 'metadata', response => response.json())); }
  catch (error) { checkCancelled(options.signal); throw new SampleLaunchError('runtime-unavailable', `TH06 Runtime Manifest unavailable: ${text(error)}`, { cause: error }); }
  const group = findRuntimeGroup(runtime, entry.pathname.slice(base.pathname.length));
  if (!group || group.root !== 'runtime/th06/' || group.current.entry !== 'th06.html') fail('runtime-unavailable', 'The manifest does not contain the normal TH06 Runtime');
  let runtimeAvailable = false;
  for (const candidate of [group.current, ...group.previous]) {
    try {
      if (await sha256Hex(new TextEncoder().encode(canonicalRuntimePayload(candidate.entry, candidate.files))) !== candidate.generation) {
        fail('runtime-unavailable', 'TH06 Runtime generation identity is invalid');
      }
      for (const file of candidate.files) {
        await probe(new URL(runtimeGenerationBase(group.root, candidate.generation) + file.path, baseUrl).href, file.bytes, 'runtime', request);
      }
      runtimeAvailable = true; break;
    } catch (error) { checkCancelled(options.signal); if (candidate === group.previous.at(-1) || !group.previous.length) throw error; }
  }
  if (!runtimeAvailable) fail('runtime-unavailable', 'No complete TH06 Runtime is available');
  let current;
  try { current = await deps.readCurrent('th06'); }
  catch (error) { checkCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package Store unavailable: ${text(error)}`, { cause: error }); }
  checkCancelled(options.signal);
  const catalog = metadata.releaseCatalog.ok ? metadata.releaseCatalog.value : null;
  if (current.generation) {
    const generation = current.generation;
    if (current.installation?.game !== 'th06' || current.installation.currentGeneration !== generation.id) fail('conflicting-generation', 'Package Store current-generation identity is inconsistent');
    const descriptor = canonicalGeneration(generation, host);
    let keys: Set<string>;
    try { keys = await deps.readKeys(BASE_IDS.map(id => generation.files[id]!.objectId)); }
    catch (error) { checkCancelled(options.signal); throw new SampleLaunchError('storage-unavailable', `Package objects unavailable: ${text(error)}`, { cause: error }); }
    if (BASE_IDS.some(id => !keys.has(generation.files[id]!.objectId))) fail('missing-object', 'The installed TH06 base has evicted or missing objects');
    checkCancelled(options.signal);
    return { baseUrl, host, catalog, descriptor, generation, entry: entry.href };
  }
  if (!catalog) fail('catalog-unavailable', 'No installed TH06 generation and no valid Release Catalog');
  const descriptorUrl = releaseCatalogEntryUrl(new URL(RELEASE_CATALOG_FILE, baseUrl).href, catalog, 'th06');
  if (!descriptorUrl) fail('package-unavailable', 'No installed TH06 generation or published TH06 Package');
  const descriptor = canonicalDescriptor(await request(descriptorUrl, 'metadata', response => response.json()), host);
  if (descriptor.revision !== catalog.games.th06!.revision) fail('conflicting-generation', 'Release Catalog and TH06 Package revisions disagree');
  for (const id of BASE_IDS) await probe(new URL(descriptor.files[id].source, descriptorUrl).href, descriptor.files[id].bytes!, 'package', request);
  return { baseUrl, host, catalog, descriptor, generation: null, entry: entry.href };
}
async function probe(url: string, bytes: number, kind: 'runtime' | 'package', request: ReturnType<typeof io>) {
  await request(url, kind, async response => {
    const length = response.headers.get('content-length');
    if (length !== null && !response.headers.has('content-encoding') && Number(length) !== bytes) fail('asset-unavailable', `${url}: published byte length is unavailable or conflicting`);
    if (!url.endsWith('.html') && /text\/html/i.test(response.headers.get('content-type') ?? '')) fail('asset-unavailable', `${url}: received an HTML fallback instead of a published asset`);
  }, 'HEAD');
}

export async function inspectTh06Sample(options: Th06SampleOptions): Promise<Th06SampleInspection> {
  const checks: SampleAssetCheck[] = [];
  try {
    const resolved = await resolveSample(options, checks);
    return { available: true, status: resolved.generation ? 'installed' : 'installable', reason: null,
      scope: TH06_SAMPLE_SCOPE, checks, runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null };
  } catch (error) {
    const failure = error instanceof SampleLaunchError ? error : new SampleLaunchError('prepare-failed', text(error));
    return { available: false, status: 'unavailable', reason: { code: failure.code, message: failure.message },
      scope: TH06_SAMPLE_SCOPE, checks, runtimeVerified: false, packageVerified: false, generationId: null };
  }
}

/** The caller still owns route/Close protection and the explicit launch action.
 * signal cancels acquisition/verification; Runtime preparation cancellation is
 * owned by runtimeService and must be coordinated by the caller's lifecycle.
 */
export async function prepareTh06Sample(options: PrepareTh06SampleOptions): Promise<RuntimeSnapshot> {
  const deps = dependencies(options), resolved = await resolveSample(options, []);
  let generation = resolved.generation;
  if (!generation) {
    checkCancelled(options.signal);
    const result = await deps.install('th06', { catalog: resolved.catalog!,
      catalogUrl: new URL(RELEASE_CATALOG_FILE, resolved.baseUrl).href,
      addComponents: [], addFileIds: [], preserveLocalSource: true,
      fetchImpl: options.fetchImpl, signal: options.signal, onProgress: options.onProgress });
    generation = result.generation;
    if (!generation?.descriptor) fail('conflicting-generation', 'The installer did not return a TH06 Package generation');
    if (generation.descriptor.revision !== resolved.descriptor.revision || BASE_IDS.some(id =>
      ['revision', 'source', 'target', 'bytes', 'sha256'].some(field =>
        generation!.descriptor.files[id]?.[field] !== resolved.descriptor.files[id][field]))) {
      fail('conflicting-generation', 'TH06 Package publication changed during preparation; inspect again');
    }
  }
  checkCancelled(options.signal);
  canonicalGeneration(generation, resolved.host);
  // Read-only adoption check for an existing generation, including corruption
  // after the installer's original verification. Never repair or fabricate IDs.
  for (const id of BASE_IDS) {
    const declaration = generation.descriptor.files[id];
    const object = await deps.readObject(generation.files[id]!.objectId);
    checkCancelled(options.signal);
    const bytes = object?.data instanceof ArrayBuffer ? object.data : object?.blob instanceof Blob ? await object.blob.arrayBuffer() : null;
    if (!bytes || bytes.byteLength !== declaration.bytes || await sha256Hex(bytes) !== declaration.sha256!.toLowerCase()) fail('integrity-failed', `${id}: installed TH06 resource failed byte/SHA-256 verification`);
    checkCancelled(options.signal);
  }
  const features = resolved.host.games.th06!.features;
  const plan: RuntimePlan = { game: 'th06', runtimeVariant: 'normal', generation, entry: resolved.entry,
    publishedRuntime: true, resourceFileIds: ['shared-msgothic', 'shared-unifont'],
    configure: { music: 'none', resources: [], runtimeResources: [], sharedResources: [], runtimePack: null,
      options: { limitPresentationTo60: false, touchEnabled: false, touchMovementMode: 'touch',
        touchSensitivity: 150, touchFocusMode: 'hold-button', doubleTapBombEnabled: false,
        alwaysHitbox: false, oggDecodeMode: 'stream',
        ...(productFeatureAvailable('th06', 'thprac', features) ? { thpracEnabled: false, thpracLocale: 'ja-JP' } : {}),
        ...(productFeatureAvailable('th06', 'focusHitbox', features) ? { focusHitboxEnabled: false } : {}) } } };
  checkCancelled(options.signal);
  return options.runtimeService.prepare(plan);
}
