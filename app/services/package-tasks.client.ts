/** Package jobs outlive their panels. Canonical installers remain the only storage writers. */
import { parsePackageZip, type ParsedPackageZip } from '../../package/package-zip.mjs';
import { installParsedPackageZip, installPackageFromAcquisition, type PackageInstallProgress } from '../../package/package-installer.mjs';
import { installPublishedPackage, type InstallPublishedPackageOptions } from '../../package/package-launcher.mjs';
import { parseStoredGameDataPack } from '../../legacy/legacy-game-pack.mjs';
import { adaptLegacyGamePackToPackage } from '../../legacy/legacy-package-adapter.mjs';
import { HOST_PROTOCOL, PRODUCT_GAMES, type GameId } from '../../src/contracts/product-catalog.mts';
import type { HostGameData } from '../../src/contracts/host-manifest.mts';
import type { InstalledPackageResult } from '../../src/contracts/package-read-models.mts';
import { rawDataImportMatchesFileName, rawDataImportSizeMatches, rawDataImportHashMatches, createRawDataImportPackageDescriptor } from '../../src/launcher/raw-data-import.mts';
import { sha256Hex } from '../../src/launcher/sha256.mts';

export type PackageTaskStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export type PackageTaskPhase = 'parsing' | 'validating' | 'installing' | 'cancelling' | 'finished';
export interface PackageTaskSnapshot {
  readonly id: string;
  readonly game: GameId;
  readonly kind: 'import' | 'published';
  readonly status: PackageTaskStatus;
  readonly phase: PackageTaskPhase;
  readonly cancellable: boolean;
  readonly progress: Readonly<PackageInstallProgress> | null;
  readonly error: string | null;
  readonly generationId: string | null;
}
export interface PackageTaskHandle {
  readonly id: string;
  readonly done: Promise<InstalledPackageResult>;
}
export interface PackageImportRequest {
  game: GameId;
  file: Blob & { readonly name?: string };
  /** Required only for retail raw DATA; also constrains legacy package DATA paths. */
  expectedData?: HostGameData;
  resourceMode?: 'hosted' | 'external' | 'import';
}
export interface PublishedPackageRequest extends Omit<InstallPublishedPackageOptions, 'catalogUrl' | 'fetchImpl' | 'onProgress' | 'signal'> {
  game: GameId;
}

const defaultDependencies = {
  parsePackageZip, parseStoredGameDataPack, adaptLegacyGamePackToPackage,
  installParsedPackageZip, installPackageFromAcquisition, installPublishedPackage, sha256Hex,
};
export type PackageTaskDependencies = typeof defaultDependencies;
export interface PackageTaskServiceOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Owner-level dependency seam for deterministic tests, not a parallel storage implementation. */
  dependencies?: Partial<PackageTaskDependencies>;
}

const maxImportBytes = 256 * 1024 * 1024;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
function aborted(): Error {
  const error = new Error('Package operation cancelled');
  error.name = 'AbortError';
  return error;
}
function requiredShared(game: GameId): readonly string[] {
  const product = PRODUCT_GAMES[game];
  return 'requiredShared' in product ? product.requiredShared : [];
}
function checkPackageGame(parsed: ParsedPackageZip, game: GameId): void {
  if (parsed.descriptor.game !== game) {
    throw new Error(`Package is for ${parsed.descriptor.game.toUpperCase()}, not ${game.toUpperCase()}`);
  }
}
function checkSharedResources(parsed: ParsedPackageZip, game: GameId): void {
  const targets = new Set(parsed.descriptor.base.files.map(id => parsed.descriptor.files[id]?.target));
  const missing = requiredShared(game).find(target => !targets.has(target));
  if (missing) throw new Error(`Package is missing required resource: ${missing}`);
}

/** Own this once at application scope; closing a dialog only unsubscribes its view. */
export function createPackageTaskService(options: PackageTaskServiceOptions) {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const catalogUrl = new URL('release-catalog.json', options.baseUrl).href;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const listeners = new Set<() => void>();
  const active = new Map<string, { controller: AbortController; handle: PackageTaskHandle; game: GameId }>();
  let snapshot: readonly PackageTaskSnapshot[] = Object.freeze([]);
  let serial = 0;
  let disposed = false;
  function notify() {
    for (const listener of [...listeners]) {
      // Rendering failures must not turn a committed installation into a reported failure.
      try { listener(); } catch (error) { console.error('Package task subscriber failed', error); }
    }
  }
  function update(id: string, patch: Partial<PackageTaskSnapshot>) {
    snapshot = Object.freeze(snapshot.map(task => task.id === id ? Object.freeze({ ...task, ...patch }) : task));
    notify();
  }
  function start(game: GameId, kind: PackageTaskSnapshot['kind'], operation: (
    signal: AbortSignal,
    phase: (phase: PackageTaskPhase, cancellable?: boolean) => void,
    progress: (value: PackageInstallProgress) => void,
  ) => Promise<InstalledPackageResult>): PackageTaskHandle {
    if (disposed) throw new Error('Package task service is disposed');
    if ([...active.values()].some(task => task.game === game)) throw new Error(`${game.toUpperCase()} already has an active package operation`);
    const id = `package-task-${++serial}`;
    const controller = new AbortController();
    const phase = (value: PackageTaskPhase, cancellable = true) => {
      if (controller.signal.aborted) throw aborted();
      update(id, { phase: value, cancellable });
    };
    const progress = (value: PackageInstallProgress) => {
      if (active.has(id)) update(id, { progress: Object.freeze({ ...value }) });
    };
    // Defer execution one microtask so callers can immediately subscribe/cancel.
    const done = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw aborted();
      return operation(controller.signal, phase, progress);
    }).then(result => {
      // Cancellation after the installer's atomic commit is successful completion.
      active.delete(id);
      update(id, { status: 'completed', phase: 'finished', cancellable: false, generationId: result.generation.id });
      return result;
    }, error => {
      active.delete(id);
      update(id, { status: isAbort(error) ? 'cancelled' : 'failed', phase: 'finished', cancellable: false,
        error: isAbort(error) ? null : messageOf(error) });
      throw error;
    });
    const handle = Object.freeze({ id, done });
    active.set(id, { controller, handle, game });
    snapshot = Object.freeze([...snapshot, Object.freeze({ id, game, kind, status: 'running' as const,
      phase: kind === 'import' ? 'parsing' as const : 'installing' as const, cancellable: true,
      progress: null, error: null, generationId: null })]);
    notify();
    // The notification panel may observe a failure without awaiting this optional handle.
    void done.catch(() => {});
    return handle;
  }

  const service = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    startPublished(request: PublishedPackageRequest): PackageTaskHandle {
      // Capture mutable UI arrays now; later edits must not retarget an in-flight job.
      const { game, ...input } = request;
      const selection = {
        ...input,
        ...(input.addComponents ? { addComponents: [...input.addComponents] } : {}),
        ...(input.addFileIds ? { addFileIds: [...input.addFileIds] } : {}),
        ...(input.selectedComponentEntries ? { selectedComponentEntries: Object.fromEntries(
          Object.entries(input.selectedComponentEntries).map(([key, values]) => [key, [...values]]),
        ) } : {}),
      };
      return start(game, 'published', async (signal, phase, onProgress) => {
        phase('installing');
        return dependencies.installPublishedPackage(game, { ...selection, catalogUrl, fetchImpl, signal, onProgress });
      });
    },
    startImport(request: PackageImportRequest): PackageTaskHandle {
      const { game, file, resourceMode } = request;
      const expectedData = request.expectedData ? { ...request.expectedData } : undefined;
      return start(game, 'import', async (signal, phase, onProgress) => {
        const checkCancelled = () => { if (signal.aborted) throw aborted(); };
        if (!(file instanceof Blob) || file.size <= 0 || file.size > maxImportBytes) {
          throw new Error('Game package must contain between 1 byte and 256 MiB');
        }
        if (file.name && rawDataImportMatchesFileName(game, file.name)) {
          if (!expectedData) throw new Error('Verified Host DATA identity is required for raw DATA import');
          if (!rawDataImportSizeMatches(expectedData, file.size)) throw new Error('Raw DATA size does not match the Host Manifest');
          phase('validating');
          const bytes = await file.arrayBuffer(); checkCancelled();
          const hash = await dependencies.sha256Hex(new Uint8Array(bytes)); checkCancelled();
          if (!rawDataImportHashMatches(expectedData, hash)) throw new Error('Raw DATA SHA-256 does not match the Host Manifest');
          const descriptor = createRawDataImportPackageDescriptor(game, expectedData, hash);
          const dataFile = descriptor.runtimeRequirement!.dataFile;
          phase('installing');
          // The existing JS owner supports this signal; its temporary .d.mts omits it.
          const acquisition = { descriptor, desiredFileIds: [dataFile], source: 'local' as const,
            reuseCurrent: false, signal, acquire: async (id: string) => id === dataFile ? bytes : null, onProgress };
          return dependencies.installPackageFromAcquisition(acquisition);
        }
        let parsed: ParsedPackageZip;
        try {
          parsed = await dependencies.parsePackageZip(file);
          checkCancelled();
          checkPackageGame(parsed, game);
          checkSharedResources(parsed, game);
        } catch (error) {
          checkCancelled();
          // Only the absent canonical descriptor selects the bounded historical reader.
          if (!/^Package ZIP is missing package\.json$/.test(messageOf(error))) throw error;
          phase('validating');
          const legacy = await dependencies.parseStoredGameDataPack(file); checkCancelled();
          if (legacy.manifest.game !== game) throw new Error(`Legacy package is for ${legacy.manifest.game.toUpperCase()}, not ${game.toUpperCase()}`);
          const expectedPath = expectedData?.path ?? PRODUCT_GAMES[game].package.dataTarget.replace(/^\//, '');
          if (legacy.manifest.data.path !== expectedPath) throw new Error('Legacy DATA path does not match this game');
          if (resourceMode === 'import' && !legacy.offline) throw new Error('Import-only hosts require a complete offline game package');
          if (legacy.offline) {
            const missing = requiredShared(game).find(target => !legacy.offline!.shared.some(item => item.target === target));
            if (missing) throw new Error(`Package is missing required resource: ${missing}`);
          }
          // The adapter carries hashes for all DATA/music/shared/language entries;
          // the canonical installer verifies them. Historical Runtime code is excluded.
          parsed = dependencies.adaptLegacyGamePackToPackage(legacy, { protocol: HOST_PROTOCOL });
          checkPackageGame(parsed, game);
        }
        checkCancelled();
        // Existing ZIP installation has no AbortSignal contract. Do not offer a
        // cosmetic cancel or misreport an atomic commit as rolled back.
        phase('installing', false);
        return dependencies.installParsedPackageZip(parsed, { onProgress });
      });
    },
    cancel(id: string): boolean {
      const task = active.get(id);
      if (!task || !snapshot.find(item => item.id === id)?.cancellable) return false;
      update(id, { phase: 'cancelling', cancellable: false });
      task.controller.abort();
      return true;
    },
    dismiss(id: string): boolean {
      if (active.has(id) || !snapshot.some(task => task.id === id)) return false;
      snapshot = Object.freeze(snapshot.filter(task => task.id !== id));
      notify();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const id of active.keys()) service.cancel(id);
    },
  };
  return service;
}
export type PackageTaskService = ReturnType<typeof createPackageTaskService>;
