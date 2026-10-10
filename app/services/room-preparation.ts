import {gameIdForProduct} from '../../src/contracts/product-catalog.mts';
import {createNetworkActivityTracker} from '../../src/launcher/network-activity.mts';
import {prepareRuntimeLaunch} from '../../src/launcher/runtime-launch.mts';
import type {Translate} from '../i18n';
import {GameDataAcquisitionError} from './game-data-acquisition';
import {preparationErrorText, type PackageAcquisition} from './package-acquisition';
import {packageNetworkMetadata} from './preparation-network';
import type {RoomOperationContext, RoomPreparationProgress} from './multiplayer-room';

type RuntimeWorker = Exclude<NonNullable<Parameters<typeof prepareRuntimeLaunch>[1]>['worker'], PromiseLike<unknown> | null | undefined>;
export interface RoomPreparationOptions {
  acquisition: PackageAcquisition;
  metadataReady(): Promise<unknown>;
  baseUrl: string;
  translate: Translate;
  /** Host awaits its real app-shell readiness, then reads only the explicitly
   * selected deployment scope. No scope/worker means no duplicate HTTP precache. */
  activeWorker(): Promise<RuntimeWorker | null>;
  dependencies?: {
    createTracker?: typeof createNetworkActivityTracker;
    prepareRuntime?: typeof prepareRuntimeLaunch;
  };
}

/** Main app800–858: package-only install followed by worker-aware Runtime
 * precache. This adapter never starts a game, changes options, selects optional
 * music/language, or creates another Package Store. Room owner holds the task. */
export function createRoomPreparation(options: RoomPreparationOptions) {
  const {acquisition, translate: t} = options;
  const createTracker = options.dependencies?.createTracker ?? createNetworkActivityTracker;
  const prepareRuntime = options.dependencies?.prepareRuntime ?? prepareRuntimeLaunch;
  async function prepare(context: RoomOperationContext, report: (value: RoomPreparationProgress) => void): Promise<void> {
    const game = gameIdForProduct(context.product);
    let stage: 'package' | 'runtime' = 'package';
    const tracker = createTracker({fetchImpl: acquisition.fetchImpl, onChange: snapshot => {
      if (!context.isCurrent() || stage !== 'package') return;
      // Original UI and wire use the last active request, not the aggregate.
      const active = snapshot.active.at(-1), loaded = active?.loaded || 0, total = active?.total || 0;
      report({status: 'preparing', stage, percent: total > 0 ? Math.min(100, loaded / total * 100) : null,
        error: '', loaded, total, title: active?.title || t('room.preparingResources')});
    }});
    let installed = await acquisition.readCurrent(game);
    if (!context.isCurrent()) return;
    if (!installed.generation) {
      if (!acquisition.getMetadata().releaseCatalog) {try {await options.metadataReady();} catch {}}
      if (!context.isCurrent()) return;
      const catalog = acquisition.getMetadata().releaseCatalog;
      if (!catalog?.games[game]) throw new Error(t('package.releaseNotReadyNoLocal', {game: game.toUpperCase()}));
      try {
        await acquisition.installPublished(game, {catalog, catalogUrl: acquisition.catalogUrl, addComponents: [],
          fetchImpl: (input, init) => tracker.xhrFetch(input, init, packageNetworkMetadata(game, input, options.baseUrl, t)),
          signal: context.signal});
      } catch (error) {
        if (context.signal.aborted || (error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError') || /已取消下载/.test(preparationErrorText(error))) throw error;
        throw new GameDataAcquisitionError(preparationErrorText(error), {cause: error});
      }
      installed = await acquisition.readCurrent(game);
      if (!installed.generation) throw new Error(t('package.objectNotPersisted'));
    }
    if (!context.isCurrent()) return;
    // Publication is a hint read; canonical committed generation stays authority.
    void acquisition.refreshInstalled(game).catch(() => {});
    stage = 'runtime';
    report({status: 'preparing', stage, percent: null, error: '', title: t('room.preparingRuntime')});
    if (!acquisition.getMetadata().hostManifest) {try {await options.metadataReady();} catch {}}
    if (!context.isCurrent()) return;
    const host = acquisition.getMetadata().hostManifest;
    const runtime = host?.games[game]?.multiplayerRuntime;
    if (typeof runtime === 'string' && runtime && host?.shared.runtimeManifest) {
      let worker: RuntimeWorker | null = null;
      try {worker = await options.activeWorker();} catch {}
      if (!context.isCurrent()) return;
      if (worker) await prepareRuntime(runtime, {worker, baseUrl: options.baseUrl, fetchImpl: acquisition.fetchImpl});
    }
    // The owning room service publishes ready only after this real task resolves
    // and its epoch/abort check still passes.
  }
  return Object.freeze({prepare});
}
