/** One compatibility coordinator per document; Package core remains the only
 * writer. Historical bytes are released by the legacy owner only after a
 * committed Package generation has been read back and its real bytes checked.
 */
import {HOST_PROTOCOL, PRODUCT_GAMES, isGameId, type GameId} from '../../src/contracts/product-catalog.mts';
import {HOST_MANIFEST_FILE, validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import {RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, validateReleaseCatalog} from '../../src/contracts/release-catalog.mts';
import type {CurrentPackageGeneration, InstalledPackageGeneration, InstalledPackageResult, PackageDescriptor, StoredPackageObject} from '../../src/contracts/package-read-models.mts';
import {validatePackageDescriptor} from '../../package/package-descriptor.mjs';
import {installPackageFromAcquisition} from '../../package/package-installer.mjs';
import {garbageCollectPackageStore, readCurrentPackageGeneration, readPackageObject} from '../../package/package-store.mjs';
import type {ParsedPackageZip} from '../../package/package-zip.mjs';
import {importedGameDataMetadataKey, migrateLegacyStoredImport, readLegacyGameDataMetadata,
  type LegacyStorageOptions, type LegacyStoredImportState} from '../../legacy/legacy-import-storage.mjs';
import {sha256Hex} from '../../src/launcher/sha256.mts';

export type StorageCompatibilityIntent = 'background' | 'inspect' | 'prepare';
export interface StorageCompatibilityResult {
  readonly game: GameId;
  readonly status: 'absent' | 'current' | 'removed' | 'migrated' | 'upgraded' | 'needs-repair' | 'deferred' | 'superseded';
  readonly generationId: string | null;
  readonly warning: string | null;
  /** A pending legacy copy must never silently fall through to DATA download. */
  readonly legacyPresent: boolean;
  /** True only after local DATA hash/layout match a validated Host. */
  readonly repairable: boolean;
}
export interface StorageBootstrapDependencies {
  readCurrent: typeof readCurrentPackageGeneration;
  readObject: typeof readPackageObject;
  install: typeof installPackageFromAcquisition;
  migrate: typeof migrateLegacyStoredImport;
  collect: typeof garbageCollectPackageStore;
}
export interface StorageBootstrapOptions {
  baseUrl: string; fetchImpl?: typeof fetch; requestTimeoutMs?: number;
  legacyStorage?: LegacyStorageOptions;
  dependencies?: Partial<StorageBootstrapDependencies>;
}
export interface StorageCompatibilityRequest {
  intent?: StorageCompatibilityIntent; signal?: AbortSignal; host?: HostManifest;
}
export class StorageCompatibilityError extends Error {
  constructor(readonly code: 'needs-repair' | 'deferred', message: string, readonly repairable = false) {super(message); this.name = 'StorageCompatibilityError';}
}
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const fullHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
function aborted() {return new DOMException('Storage compatibility wait was cancelled', 'AbortError');}
function check(signal: AbortSignal) {if (signal.aborted) throw aborted();}
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort); reject(aborted());};
    signal.addEventListener('abort', abort, {once: true});
    promise.then(value => {signal.removeEventListener('abort', abort); resolve(value);}, error => {signal.removeEventListener('abort', abort); reject(error);});
  });
}
function fontFiles(game: GameId) {
  const product = PRODUCT_GAMES[game];
  const targets: readonly string[] = 'requiredShared' in product ? product.requiredShared : ['/msgothic.ttc', '/unifont.otf'];
  return targets.map(target => ({id: target === '/msgothic.ttc' ? 'shared-msgothic' : 'shared-unifont', target, source: `shared${target}`}));
}
function currentIdentity(current: CurrentPackageGeneration, game: GameId) {
  if (current.installation && current.installation.game !== game ||
      (current.installation?.currentGeneration ?? null) !== (current.generation?.id ?? null) ||
      current.generation && current.generation.game !== game) throw new Error('Package current-generation identity is inconsistent');
  return current;
}
async function objectBlob(value: StoredPackageObject | null, id: string) {
  if (value?.data instanceof ArrayBuffer) return new Blob([value.data]);
  if (value?.blob instanceof Blob) return value.blob;
  throw new Error(`${id}: the existing Package object is missing; the original copy is retained`);
}
function compatibilityShape(descriptor: PackageDescriptor, game: GameId) {
  validatePackageDescriptor(descriptor);
  const requirement = descriptor.runtimeRequirement, data = descriptor.files['game-data'];
  if (descriptor.game !== game || descriptor.runtime || descriptor.runtimes || requirement?.protocol !== HOST_PROTOCOL ||
      requirement.target !== game || requirement.dataFile !== 'game-data' || !/^sha256-[a-f0-9]{64}$/i.test(requirement.dataLayout ?? '') ||
      !descriptor.base.files.includes('game-data') || data?.target !== PRODUCT_GAMES[game].package.dataTarget) {
    throw new Error('Historical Package does not have a compatible DATA identity');
  }
  for (const font of fontFiles(game)) {
    const declaration = descriptor.files[font.id];
    if (!descriptor.base.files.includes(font.id) || declaration?.target !== font.target || !fullHash(declaration.sha256) ||
        !Number.isSafeInteger(declaration.bytes) || Number(declaration.bytes) <= 0) {
      throw new StorageCompatibilityError('needs-repair', `${game}: historical fonts need verified preparation; local DATA is retained`);
    }
  }
}
function needsUpgrade(generation: InstalledPackageGeneration) {
  // Compatibility upgrades cannot rewrite an arbitrary user Package or claim
  // that a modern publication with damaged metadata is historical content.
  const descriptor = generation.descriptor;
  if (!/^(?:legacy|raw)-/.test(descriptor.revision)) return false;
  return fontFiles(generation.game).some(font => !descriptor.base.files.includes(font.id) || !generation.files[font.id]?.objectId) ||
    Object.keys(generation.files).some(id => !fullHash(descriptor.files[id]?.sha256));
}

export function createStorageBootstrap(options: StorageBootstrapOptions) {
  const mount = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(mount.protocol) || !mount.pathname.endsWith('/') || mount.search || mount.hash || mount.username || mount.password ||
      globalThis.location && globalThis.location.origin !== mount.origin) throw new Error('Storage compatibility requires a same-origin application mount');
  const deps: StorageBootstrapDependencies = {readCurrent: readCurrentPackageGeneration, readObject: readPackageObject,
    install: installPackageFromAcquisition, migrate: migrateLegacyStoredImport, collect: garbageCollectPackageStore, ...options.dependencies};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let storage: LegacyStorageOptions['storage'] = null;
  try {storage = globalThis.localStorage ?? null;} catch {}
  const legacy: LegacyStorageOptions = {storage, origin: mount.origin, ...options.legacyStorage};
  const lifetime = new AbortController();
  const jobs = new Map<GameId, {intent: StorageCompatibilityIntent; promise: Promise<StorageCompatibilityResult>}>();
  let background: Promise<void> | null = null;
  function inside(url: URL) {
    if (url.origin !== mount.origin || !url.pathname.startsWith(mount.pathname) || url.username || url.password || url.search || url.hash) {
      throw new Error('Compatibility resources must stay in the same-origin application mount');
    }
    return url.href;
  }
  async function request<T>(url: string, read: (response: Response) => Promise<T>, signal: AbortSignal) {
    check(signal);
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    const timeout = setTimeout(abort, options.requestTimeoutMs ?? 12_000);
    try {
      const response = await fetchImpl(inside(new URL(url)), {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
      const value = await read(response); check(signal); return value;
    } finally {clearTimeout(timeout); signal.removeEventListener('abort', abort);}
  }
  async function host(signal: AbortSignal) {return validateHostManifest(await request(new URL(HOST_MANIFEST_FILE, mount).href, response => response.json(), signal));}
  async function verifyDataCandidate(blob: Blob | undefined, descriptor: {bytes?: number; sha256?: string}, layout: string | undefined, game: GameId, suppliedHost: HostManifest | undefined, signal: AbortSignal) {
    if (!(blob instanceof Blob) || blob.size <= 0 || descriptor.bytes !== undefined && descriptor.bytes !== blob.size) throw new Error('Historical DATA bytes are missing or incomplete; original storage is retained');
    const manifest = suppliedHost ? validateHostManifest(suppliedHost) : await host(signal);
    const expected = manifest.games[game]?.gameData;
    const actual = await sha256Hex(await blob.arrayBuffer()); check(signal);
    if (!expected || blob.size !== expected.bytes || actual !== expected.sha256.toLowerCase() || layout !== expected.layout ||
        descriptor.sha256 && actual !== descriptor.sha256.toLowerCase()) throw new Error('Existing DATA hash or layout conflicts with the Host; original storage is retained');
    return manifest;
  }
  async function publishedFonts(game: GameId, suppliedHost: HostManifest | undefined, signal: AbortSignal) {
    const manifest = suppliedHost ? validateHostManifest(suppliedHost) : await host(signal);
    const expected = manifest.games[game]?.gameData;
    if (!expected) throw new Error('The Host does not declare this game DATA');
    const catalogUrl = new URL(RELEASE_CATALOG_FILE, mount).href;
    const catalog = validateReleaseCatalog(await request(catalogUrl, response => response.json(), signal));
    const address = releaseCatalogEntryUrl(catalogUrl, catalog, game);
    if (!address) throw new Error('No published Package declares the missing shared fonts');
    inside(new URL(address));
    const descriptor = validatePackageDescriptor(await request(address, response => response.json(), signal));
    compatibilityShape(descriptor, game);
    const data = descriptor.files['game-data'];
    if (descriptor.revision !== catalog.games[game]!.revision || descriptor.runtimeRequirement?.dataLayout !== expected.layout ||
        data.bytes !== expected.bytes || !fullHash(data.sha256) || data.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
      throw new Error('Published fonts are not bound to the validated Host DATA declaration');
    }
    for (const font of fontFiles(game)) if (descriptor.files[font.id].source !== font.source) throw new Error('Published font has a noncanonical source');
    return {descriptor, address, manifest};
  }
  async function attest(parsed: ParsedPackageZip, game: GameId, manifest: HostManifest | undefined, signal: AbortSignal) {
    const descriptor = structuredClone(parsed.descriptor);
    for (const [id, entry] of parsed.files) {
      check(signal);
      const declaration = descriptor.files[id];
      if (!declaration || !(entry.blob instanceof Blob) || entry.blob.size <= 0 || declaration.bytes !== undefined && declaration.bytes !== entry.blob.size) {
        throw new Error(`${id}: historical payload size is invalid`);
      }
      const hash = await sha256Hex(await entry.blob.arrayBuffer()); check(signal);
      if (declaration.sha256 && declaration.sha256.toLowerCase() !== hash) throw new Error(`${id}: historical payload SHA-256 mismatch`);
      descriptor.files[id] = {...declaration, bytes: entry.blob.size, sha256: hash};
    }
    compatibilityShape(descriptor, game);
    if (manifest) {
      const expected = manifest.games[game]?.gameData, data = descriptor.files['game-data'];
      if (!expected || data.sha256 !== expected.sha256.toLowerCase() || data.bytes !== expected.bytes || descriptor.runtimeRequirement?.dataLayout !== expected.layout) {
        throw new Error('Existing DATA does not match the validated Host; its original copy is retained');
      }
    }
    return {...parsed, descriptor};
  }
  async function verifyCommitted(parsed: ParsedPackageZip, result: unknown, game: GameId, signal: AbortSignal) {
    const installed = result as InstalledPackageResult | null;
    if (!installed?.generation?.id) throw new Error('Migration did not return a committed Package generation');
    const current = currentIdentity(await deps.readCurrent(game), game);
    if (current.generation?.id !== installed.generation.id) throw new Error('Package changed before migration verification; historical bytes are retained');
    for (const [id, entry] of parsed.files) {
      const declaration = parsed.descriptor.files[id], ref = current.generation.files[id];
      const committed = current.generation.descriptor.files[id];
      if (!ref?.objectId || ref.revision !== declaration.revision || committed?.target !== declaration.target ||
          committed.bytes !== entry.blob.size || committed.sha256?.toLowerCase() !== declaration.sha256?.toLowerCase()) {
        throw new Error(`${id}: committed Package identity could not be verified`);
      }
      const blob = await objectBlob(await deps.readObject(ref.objectId), id);
      if (blob.size !== entry.blob.size || await sha256Hex(await blob.arrayBuffer()) !== declaration.sha256) {
        throw new Error(`${id}: committed Package bytes could not be verified; historical bytes are retained`);
      }
      check(signal);
    }
  }
  async function install(parsed: ParsedPackageZip, expectedGenerationId: string | null, source: 'local' | 'remote', reuseCurrent: boolean, signal: AbortSignal) {
    check(signal);
    return deps.install({descriptor: parsed.descriptor, desiredFileIds: [...parsed.files.keys()], source, reuseCurrent,
      expectedGenerationId, rejectRemovedInstallation: expectedGenerationId === null, signal,
      acquire: async id => {check(signal); const blob = parsed.files.get(id)?.blob; return blob ? blob.arrayBuffer() : null;}});
  }
  async function upgrade(current: CurrentPackageGeneration, game: GameId, intent: StorageCompatibilityIntent, suppliedHost: HostManifest | undefined, signal: AbortSignal) {
    const generation = current.generation!;
    const missing = fontFiles(game).filter(font => !generation.descriptor.base.files.includes(font.id) || !generation.files[font.id]?.objectId);
    if (missing.length && intent === 'background') throw new StorageCompatibilityError('needs-repair', `${game}: shared fonts need preparation; existing DATA is retained`);
    const descriptor = structuredClone(generation.descriptor), files: ParsedPackageZip['files'] = new Map();
    for (const [id, ref] of Object.entries(generation.files)) {
      if (!ref?.objectId) continue;
      files.set(id, {blob: await objectBlob(await deps.readObject(ref.objectId), id)});
    }
    let manifest = suppliedHost;
    if (missing.length) {
      manifest = await verifyDataCandidate(files.get('game-data')?.blob, descriptor.files['game-data'], descriptor.runtimeRequirement?.dataLayout, game, manifest, signal);
      if (intent !== 'prepare') throw new StorageCompatibilityError('needs-repair', `${game}: verified local DATA is available; prepare the game to restore shared fonts`, true);
      const published = await publishedFonts(game, suppliedHost, signal); manifest = published.manifest;
      for (const font of missing) {
        descriptor.files[font.id] = structuredClone(published.descriptor.files[font.id]);
        if (!descriptor.base.files.includes(font.id)) descriptor.base.files.push(font.id);
        const blob = await request(new URL(descriptor.files[font.id].source, published.address).href, response => response.blob(), signal);
        files.set(font.id, {blob});
      }
    }
    const parsed = await attest({descriptor, files}, game, manifest, signal);
    // Identity follows actual declarations; existing objects may be reused only
    // after core's own byte-attestation check against these full SHA-256 values.
    parsed.descriptor.revision = `legacy-verified-${(await sha256Hex(new TextEncoder().encode(JSON.stringify(parsed.descriptor)))).slice(0, 32)}`;
    const result = await install(parsed, generation.id, current.installation!.source, true, signal);
    return result.generation.id;
  }
  async function run(game: GameId, intent: StorageCompatibilityIntent, suppliedHost: HostManifest | undefined, signal: AbortSignal): Promise<StorageCompatibilityResult> {
    let legacyPresent = false, generationId: string | null = null, repairable = false;
    const result = (status: StorageCompatibilityResult['status'], warning: string | null = null): StorageCompatibilityResult =>
      Object.freeze({game, status, generationId, warning, legacyPresent, repairable});
    try {
      check(signal);
      legacyPresent = !!legacy.storage?.getItem(importedGameDataMetadataKey(game));
      const current = currentIdentity(await deps.readCurrent(game), game); generationId = current.generation?.id ?? null;
      if (current.generation) {
        if (!needsUpgrade(current.generation)) return result('current');
        generationId = await upgrade(current, game, intent, suppliedHost, signal);
        return result('upgraded');
      }
      if (current.installation?.removedGenerationId) return result('removed');
      if (!legacyPresent) return result('absent');
      let manifest = suppliedHost;
      if (!readLegacyGameDataMetadata(game, {storage: legacy.storage, fallbackGameData: manifest?.games[game]?.gameData})) {
        // Old metadata without a layout can use a validated Host attestation;
        // malformed records must not be treated as permission to redownload.
        manifest ??= await host(signal);
      }
      let migratedGeneration: string | null = null;
      const migrated = await deps.migrate(game, {...legacy, protocol: HOST_PROTOCOL, fallbackGameData: manifest?.games[game]?.gameData,
        prepareState: async original => {
          const missingFonts = fontFiles(game).filter(font => !original.gameData.legacyAssets?.shared.some(asset => asset.target === font.target && original.assets.has(asset.key)));
          if (!missingFonts.length) return original;
          if (intent === 'background') throw new StorageCompatibilityError('needs-repair', `${game}: historical fonts need verified preparation; local DATA is retained`);
          // Missing DATA, OGG or language bytes are not silently replaced by a
          // published package. Only required shared fonts may be hydrated.
          const sharedKeys = new Set(original.gameData.legacyAssets?.shared.map(item => item.key) ?? []);
          if (original.missing?.some(key => !sharedKeys.has(key))) return original;
          manifest = await verifyDataCandidate(original.assets.get(original.dataKey), original.gameData, original.gameData.layout, game, manifest, signal);
          if (intent !== 'prepare') throw new StorageCompatibilityError('needs-repair', `${game}: verified local DATA is available; prepare the game to restore shared fonts`, true);
          const published = await publishedFonts(game, manifest, signal); manifest = published.manifest;
          const state: LegacyStoredImportState = {...original, assets: new Map(original.assets), gameData: structuredClone(original.gameData)};
          state.gameData.legacyAssets ??= {shared: [], languages: []};
          for (const font of missingFonts) {
            const declaration = published.descriptor.files[font.id];
            const blob = await request(new URL(declaration.source, published.address).href, response => response.blob(), signal);
            if (blob.size !== declaration.bytes || await sha256Hex(await blob.arrayBuffer()) !== declaration.sha256!.toLowerCase()) throw new Error(`${font.id}: published font integrity failed`);
            const previous = state.gameData.legacyAssets.shared.find(item => item.target === font.target);
            const key = previous?.key ?? `/.eagler-local/compatibility/${game}/${font.id}`;
            state.gameData.legacyAssets.shared = state.gameData.legacyAssets.shared.filter(item => item.target !== font.target);
            state.gameData.legacyAssets.shared.push({target: font.target, key, bytes: blob.size, sha256: declaration.sha256!});
            state.assets.set(key, blob);
          }
          state.missing = (state.missing ?? []).filter(key => !state.assets.has(key));
          state.incomplete = state.missing[0];
          return state;
        },
        prepareParsed: parsed => attest(parsed, game, manifest, signal),
        install: async parsed => {const installed = await install(parsed, null, 'local', false, signal); migratedGeneration = installed.generation.id; return installed;},
        verifyInstalled: (parsed, installed) => verifyCommitted(parsed, installed, game, signal),
      });
      if (migrated.status === 'incomplete') return result('deferred', `${game}: historical local files are incomplete; original storage is retained`);
      if (migrated.status === 'absent') return result('deferred', `${game}: historical metadata cannot yet be verified; original storage is retained`);
      generationId = migratedGeneration; legacyPresent = false; return result('migrated');
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (error instanceof Error && error.name === 'PackageGenerationChangedError') return result('superseded');
      repairable = error instanceof StorageCompatibilityError && error.repairable;
      return result(error instanceof StorageCompatibilityError ? error.code : 'deferred', text(error));
    }
  }
  function ensure(game: GameId, request: StorageCompatibilityRequest = {}): Promise<StorageCompatibilityResult> {
    if (!isGameId(game)) return Promise.reject(new Error('Unknown compatibility game'));
    if (lifetime.signal.aborted || request.signal?.aborted) return Promise.reject(aborted());
    const intent = request.intent ?? 'inspect', existing = jobs.get(game);
    if (existing) {
      // A preparation can join local migration, but may then upgrade fonts.
      // Other games never wait for this game's database or network activity.
      const rank = {background: 0, inspect: 1, prepare: 2};
      const task = rank[intent] > rank[existing.intent]
        ? existing.promise.then(result => ['needs-repair', 'deferred'].includes(result.status) ? ensure(game, request) : result) : existing.promise;
      return waitFor(task, request.signal);
    }
    const controller = new AbortController(), abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, {once: true});
    // A cancelled observer does not kill background migration. The initiating
    // explicit preparation does own its new font acquisition and can cancel it.
    if (intent === 'prepare') request.signal?.addEventListener('abort', abort, {once: true});
    const promise = run(game, intent, request.host, controller.signal).finally(() => {
      lifetime.signal.removeEventListener('abort', abort);
      request.signal?.removeEventListener('abort', abort);
      if (jobs.get(game)?.promise === promise) jobs.delete(game);
    });
    jobs.set(game, {intent, promise});
    void promise.catch(() => {});
    return waitFor(promise, request.signal);
  }
  return Object.freeze({ensure,
    startBackground() {
      if (background) return background;
      background = Promise.all(Object.keys(PRODUCT_GAMES).filter(isGameId).map(game => ensure(game, {intent: 'background'})))
        .then(async () => {if (!lifetime.signal.aborted) try {await deps.collect();} catch {}}).finally(() => {background = null;});
      void background.catch(() => {}); return background;
    },
    dispose() {lifetime.abort();},
  });
}
export type StorageBootstrapController = ReturnType<typeof createStorageBootstrap>;
const documents = new Map<string, StorageBootstrapController>();
export function documentStorageBootstrap(options: StorageBootstrapOptions) {
  const key = new URL(options.baseUrl).href;
  let controller = documents.get(key);
  if (!controller) {controller = createStorageBootstrap(options); documents.set(key, controller);}
  return controller;
}
export function disposeDocumentStorageBootstrap(baseUrl: string) {
  const key = new URL(baseUrl).href, controller = documents.get(key);
  controller?.dispose(); documents.delete(key);
}
export async function ensureLocalPackageReady(game: GameId, options: StorageBootstrapOptions & StorageCompatibilityRequest) {
  return documentStorageBootstrap(options).ensure(game, options);
}
