import {HOST_PROTOCOL, isGameId, type GameId} from '../../src/contracts/product-catalog.mts';
import {garbageCollectPackageStore, readCurrentPackageGeneration} from '../../package/package-store.mjs';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';

type PackageFeature = Pick<typeof import('../../src/launcher/package-feature.mts'), 'installParsedPackageZip' | 'migrateLegacyStoredImport'>;
export interface LocalPackageMaintenanceOptions {
  getGames(): Partial<Record<GameId, {gameData?: unknown}>>;
  origin: string;
  onInstalled(game: GameId, generation: InstalledPackageGeneration): void;
  onHydrated?(): void;
  logger?: Pick<Console, 'info' | 'warn'>;
  scheduler?: {
    requestFrame(callback: () => void): number;
    cancelFrame(handle: number): void;
    setTimer(callback: () => void): number;
    clearTimer(handle: number): void;
  };
  dependencies?: {
    loadPackageFeature?(): Promise<PackageFeature>;
    readCurrent?: typeof readCurrentPackageGeneration;
    garbageCollect?: typeof garbageCollectPackageStore;
  };
}

/** Main app1396–1468: deferred compatibility maintenance, never a boot barrier.
 * Canonical migration owns install-before-cleanup. This adapter does not delete
 * legacy state, download releases, register workers, or own a second store. */
export function createLocalPackageMaintenance(options: LocalPackageMaintenanceOptions) {
  const readCurrent = options.dependencies?.readCurrent ?? readCurrentPackageGeneration;
  const garbageCollect = options.dependencies?.garbageCollect ?? garbageCollectPackageStore;
  const scheduler = options.scheduler ?? {
    requestFrame: (callback: () => void) => requestAnimationFrame(callback),
    cancelFrame: (handle: number) => cancelAnimationFrame(handle),
    setTimer: (callback: () => void) => window.setTimeout(callback, 0),
    clearTimer: (handle: number) => window.clearTimeout(handle),
  };
  const logger = options.logger ?? console;
  let feature: Promise<PackageFeature> | null = null;
  const loadFeature = () => feature ??= options.dependencies?.loadPackageFeature?.() ?? import('../../src/launcher/package-feature.mts');
  let running = false, scheduled = false, rerun = false, disposed = false;
  let frame: number | null = null, timer: number | null = null;
  const games = () => Object.keys(options.getGames()).filter(isGameId);
  async function readHint(game: GameId) {
    const installed = await readCurrent(game);
    if (!disposed && installed.generation) options.onInstalled(game, installed.generation);
  }
  async function migrate() {
    const {migrateLegacyStoredImport, installParsedPackageZip} = await loadFeature();
    for (const game of games()) {
      if (disposed) return;
      let currentRevision: string | null = null;
      try {currentRevision = (await readCurrent(game)).generation?.descriptor.revision || null;} catch {}
      if (disposed) return;
      try {
        const result = await migrateLegacyStoredImport(game, {
          protocol: HOST_PROTOCOL, fallbackGameData: options.getGames()[game]?.gameData || null,
          currentRevision, install: parsed => installParsedPackageZip(parsed), origin: options.origin,
        });
        // Already-started canonical installs are allowed to finish atomically
        // after disposal; only subsequent work and presentation are suppressed.
        if (disposed) return;
        if (result.status === 'migrated' || result.status === 'already-current') {
          await readHint(game);
          logger.info(`${game}: legacy imported storage ${result.status}; Package Store is authoritative`);
        } else if (result.status === 'incomplete') {
          logger.warn(`${game}: legacy imported storage is incomplete; compatibility state retained`, result.missing);
        }
      } catch (error) {
        if (!disposed) logger.warn(`${game}: legacy imported storage migration deferred`, error);
      }
    }
  }
  async function hydrate() {
    if (disposed) return;
    if (running) {rerun = true; return;}
    running = true;
    try {
      await migrate();
      if (disposed) return;
      await Promise.all(games().map(game => readHint(game).catch(() => {})));
      if (disposed) return;
      // Unchanged GC uses Package generation leases, including a Runtime that
      // starts after this background task was queued.
      try {await garbageCollect();} catch {}
      if (!disposed) options.onHydrated?.();
    } finally {
      running = false;
      if (rerun && !disposed) {rerun = false; schedule();}
    }
  }
  function schedule() {
    if (disposed || scheduled) return;
    scheduled = true;
    frame = scheduler.requestFrame(() => {
      frame = null;
      if (disposed) return;
      timer = scheduler.setTimer(() => {
        timer = null; scheduled = false;
        if (!disposed) void hydrate().catch(error => {if (!disposed) logger.warn('local Package Store hydration deferred', error);});
      });
    });
  }
  function dispose() {
    disposed = true; rerun = false; scheduled = false;
    if (frame !== null) scheduler.cancelFrame(frame);
    if (timer !== null) scheduler.clearTimer(timer);
    frame = timer = null;
  }
  return Object.freeze({schedule, dispose});
}
export type LocalPackageMaintenance = ReturnType<typeof createLocalPackageMaintenance>;
