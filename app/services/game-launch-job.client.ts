/** Root-lifetime published game jobs. Selection is captured per click and never
 * inferred from the Router after asynchronous package/runtime work begins. */
import {createProgressiveOggController, type OggRuntimePort, type PreparedOggSeed} from './ogg-progressive.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {inspectPublishedGame, preparePublishedGame, preparePublishedFiles, type PublishedGameOptions} from './game-launch.client';
import {createPreparationJobController, type PreparationRuntimeService} from './preparation-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {SampleLaunchDependencies} from './sample-launch.client';
import type {ResourceManagerController} from './resources.client';
import {isGameId} from '../../src/contracts/product-catalog.mts';
export type LaunchUpdateChoice = 'keep-current' | 'update-now' | 'background';
export interface LaunchPackageUpdateRequest {
  productId: string;
  expectedGenerationId: string;
  expectedPublishedRevision: string;
  signal: AbortSignal;
}
/** Bridge cancellation only to the resource operation this request starts. */
export async function updatePackageForLaunch(owner: Pick<ResourceManagerController, 'getSnapshot' | 'installBase' | 'cancel'> | null,
  {productId, expectedGenerationId, expectedPublishedRevision, signal}: LaunchPackageUpdateRequest) {
  if (!owner || !isGameId(productId)) throw new Error('The Package update owner is unavailable');
  if (signal.aborted) throw new DOMException('Package update cancelled', 'AbortError');
  if (owner.getSnapshot().operation) throw new Error('Wait for the current resource task before updating');
  const pending = owner.installBase(productId, {expectedGenerationId, expectedPublishedRevision});
  let owned = true;
  const cancel = () => {if (owned) owner.cancel();};
  signal.addEventListener('abort', cancel, {once: true});
  // installBase publishes synchronously; a subscriber may cancel this launch
  // while that publication is still on the stack.
  if (signal.aborted) cancel();
  try {return {generationId: (await pending).generation.id};}
  finally {owned = false; signal.removeEventListener('abort', cancel);}
}
export interface LaunchPackageUpdateSnapshot {
  readonly productId: string;
  readonly epoch: number;
  readonly phase: 'waiting' | 'updating' | 'complete' | 'cancelled' | 'error';
  readonly error: string | null;
}
export interface GameLaunchSelection {
  productId: string;
  preferences: PreferencesSnapshot | null;
  touchLayout?: TouchLayout | null;
  updateChoice?: LaunchUpdateChoice;
  expectedGenerationId?: string;
  expectedPublishedRevision?: string;
  purpose?: 'game' | 'files';
}
export interface GameLaunchJobOptions extends Omit<PublishedGameOptions, 'productId' | 'signal' | 'dependencies'> {
  runtimeService: PreparationRuntimeService & Partial<Pick<OggRuntimePort, 'extendOggResources'>>;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  /** The existing document ResourceManager remains the sole update job owner. */
  updatePackage?: (request: LaunchPackageUpdateRequest) => Promise<{generationId: string}>;
  packageDependencies?: Partial<SampleLaunchDependencies>;
  dependencies?: {inspect?: typeof inspectPublishedGame; prepare?: typeof preparePublishedGame; prepareFiles?: typeof preparePublishedFiles};
}
export function createGameLaunchJobController(options: GameLaunchJobOptions) {
  const runtime = options.runtimeService;
  const shared = {baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    uiLocale: options.uiLocale, audioAvailable: options.audioAvailable, midiAvailable: options.midiAvailable,
    dependencies: options.packageDependencies, cacheStorage: options.cacheStorage, offlineStorage: options.offlineStorage};
  const ogg = runtime.extendOggResources ? createProgressiveOggController({...shared, runtime: runtime as OggRuntimePort}) : null;
  const listeners = new Set<() => void>();
  let disposed = false;
  let initialOggCancel: (() => void) | null = null;
  let initialOggOwner: AbortSignal | null = null;
  let packageUpdate: LaunchPackageUpdateSnapshot | null = null;
  let updateAbort: AbortController | null = null;
  let deferredUpdate: Omit<LaunchPackageUpdateRequest, 'signal'> | null = null;
  const controller = createPreparationJobController({runtimeService: runtime,
    key: (selection: GameLaunchSelection) => JSON.stringify(selection),
    inspect: (selection: GameLaunchSelection, signal) => (options.dependencies?.inspect ?? inspectPublishedGame)({...shared, productId: selection.productId, signal}),
    prepare: async (selection: GameLaunchSelection, ports) => {
      if (!selection.preferences) throw new Error('Load the product settings before preparing a game');
      if (selection.purpose === 'files') return (options.dependencies?.prepareFiles ?? preparePublishedFiles)({...shared, ...ports,
        productId: selection.productId, preferences: selection.preferences, touchLayout: selection.touchLayout});
      const choice = selection.updateChoice ?? 'keep-current';
      if (!['keep-current', 'update-now', 'background'].includes(choice)) throw new Error('Unknown Package update choice');
      if (choice !== 'keep-current' && updateAbort) throw new Error('A background Package update is already active; wait for it or keep the current version');
      let expectedGenerationId = selection.expectedGenerationId;
      if (choice !== 'keep-current' && (!expectedGenerationId || !selection.expectedPublishedRevision || !options.updatePackage)) {
        throw new Error('Inspect the installed and published Package before choosing an update');
      }
      if (choice === 'update-now') {
        const abort = new AbortController(); updateAbort = abort;
        const cancel = () => abort.abort(ports.signal.reason);
        ports.signal.addEventListener('abort', cancel, {once: true});
        packageUpdate = Object.freeze({productId: selection.productId, epoch: 0, phase: 'updating', error: null}); publish();
        try {
          if (ports.signal.aborted) cancel();
          const updated = await options.updatePackage!({productId: selection.productId, expectedGenerationId: expectedGenerationId!,
            expectedPublishedRevision: selection.expectedPublishedRevision!, signal: abort.signal});
          if (abort.signal.aborted) throw new DOMException('Package update cancelled', 'AbortError');
          expectedGenerationId = updated.generationId;
          packageUpdate = null; publish();
        } catch (error) {
          if (ports.signal.aborted) throw new DOMException('Game preparation was cancelled', 'AbortError');
          // Main retains current DATA when just the update fails/cancels.
          packageUpdate = Object.freeze({productId: selection.productId, epoch: 0,
            phase: abort.signal.aborted || error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error',
            error: abort.signal.aborted || error instanceof Error && error.name === 'AbortError' ? null : error instanceof Error ? error.message : String(error)}); publish();
        } finally {ports.signal.removeEventListener('abort', cancel);if (updateAbort === abort) updateAbort = null;}
      }
      if (ports.signal.aborted) throw new DOMException('Game preparation was cancelled', 'AbortError');
      const prepared = await (options.dependencies?.prepare ?? preparePublishedGame)({...shared, ...ports,
        onInitialOggDownload: cancel => {
          if (cancel && !ports.signal.aborted) {initialOggOwner=ports.signal;initialOggCancel=cancel;}
          else if (!cancel && initialOggOwner===ports.signal) {initialOggOwner=null;initialOggCancel=null;}
          publish();
        },
        progressiveOgg: !!ogg, onPreparedOgg: seed => ogg?.arm(seed), expectedGenerationId,
        productId: selection.productId, preferences: selection.preferences, touchLayout: selection.touchLayout, prepareMidi: options.prepareMidi});
      if (choice === 'background' && !disposed && !ports.signal.aborted && prepared.epoch !== null && prepared.generationId && runtime.getSnapshot().epoch === prepared.epoch && runtime.getSnapshot().phase === 'prepared') {
        // The prepared Runtime has leased this exact generation. A later update
        // is for the next launch and must never replace the active plan/epoch.
        deferredUpdate = {productId: selection.productId, expectedGenerationId: prepared.generationId,
          expectedPublishedRevision: selection.expectedPublishedRevision!};
        packageUpdate = Object.freeze({productId: selection.productId, epoch: prepared.epoch, phase: 'waiting', error: null});
        publish();
      }
      return prepared;
    },
  });
  let snapshot = Object.freeze({...controller.getSnapshot(), musicDownloading:false as boolean, ogg: ogg?.getSnapshot() ?? null, packageUpdate: packageUpdate as LaunchPackageUpdateSnapshot | null});
  function publish() {
    if (disposed) return;
    snapshot = Object.freeze({...controller.getSnapshot(), musicDownloading:initialOggCancel!==null, ogg: ogg?.getSnapshot() ?? null, packageUpdate});
    for (const fn of listeners) fn();
  }
  function cancelUpdate() {
    deferredUpdate = null;
    const pending = updateAbort; updateAbort = null; pending?.abort();
    if (packageUpdate && ['waiting', 'updating'].includes(packageUpdate.phase)) {
      packageUpdate = Object.freeze({...packageUpdate, phase: 'cancelled', error: null}); publish();
    }
  }
  const offJob = controller.subscribe(publish), offOgg = ogg?.subscribe(publish);
  const offRuntime = runtime.subscribe(() => {
    if (!deferredUpdate || !packageUpdate || packageUpdate.phase !== 'waiting') return;
    const live = runtime.getSnapshot();
    if (live.epoch !== packageUpdate.epoch || ['idle', 'saving', 'error', 'exited'].includes(live.phase)) {cancelUpdate(); return;}
    if (!live.launched || !['launching', 'running'].includes(live.phase)) return;
    const request = deferredUpdate, abort = new AbortController();
    deferredUpdate = null; updateAbort = abort;
    // Do not race progressive acquisition of the superseded Package revision.
    ogg?.cancel();
    packageUpdate = Object.freeze({...packageUpdate, phase: 'updating'}); publish();
    void Promise.resolve().then(() => {
      if (abort.signal.aborted) throw new DOMException('Package update cancelled', 'AbortError');
      return options.updatePackage!({...request, signal: abort.signal});
    }).then(() => {
      if (disposed || updateAbort !== abort) return;
      packageUpdate = Object.freeze({...packageUpdate!, phase: 'complete', error: null}); publish();
    }, error => {
      if (disposed || updateAbort !== abort) return;
      packageUpdate = Object.freeze({...packageUpdate!, phase: abort.signal.aborted ? 'cancelled' : 'error',
        error: abort.signal.aborted ? null : error instanceof Error ? error.message : String(error)}); publish();
    }).finally(() => {if (updateAbort === abort) updateAbort = null;});
  });
  return Object.freeze({...controller,
    armOgg(seed: PreparedOggSeed) {if (!ogg) throw new Error('The shared OGG acquisition owner is unavailable');ogg.arm(seed);},
    armPackageUpdate(request: Omit<LaunchPackageUpdateRequest, 'signal'>, epoch: number) {
      if (disposed || !options.updatePackage || updateAbort || deferredUpdate || runtime.getSnapshot().epoch !== epoch || runtime.getSnapshot().phase !== 'prepared') return false;
      deferredUpdate = structuredClone(request);
      packageUpdate = Object.freeze({productId: request.productId, epoch, phase: 'waiting', error: null});publish();return true;
    },
    getSnapshot: () => snapshot, subscribe(fn: () => void) {listeners.add(fn); return () => {listeners.delete(fn);};},
    cancelMusicDownload() {initialOggCancel?.();},
    cancel() {initialOggOwner=null;initialOggCancel=null;controller.cancel(); ogg?.cancel(); cancelUpdate();}, cancelOgg: () => ogg?.cancel(), retryOgg: () => ogg?.retry(), cancelUpdate,
    dismissUpdate() {if (packageUpdate && !['waiting', 'updating'].includes(packageUpdate.phase)) {packageUpdate = null; publish();}},
    dispose() {cancelUpdate(); disposed = true; offRuntime(); offJob(); offOgg?.(); controller.dispose(); ogg?.dispose(); listeners.clear();},
    inspect: (productId: string) => controller.inspect({productId, preferences: null}),
    prepareFiles: (productId: string, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null = null) => controller.prepare({productId, preferences, touchLayout, purpose: 'files'}),
    prepare(productId: string, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null = null, updateChoice: LaunchUpdateChoice = 'keep-current') {
      const current = controller.getSnapshot(), inspection = current.inspection?.productId === productId ? current.inspection : null;
      const prior = current.selection?.productId === productId ? current.selection : null;
      return controller.prepare({productId, preferences, touchLayout, updateChoice,
        expectedGenerationId: inspection?.generationId ?? prior?.expectedGenerationId,
        expectedPublishedRevision: inspection?.publishedRevision ?? prior?.expectedPublishedRevision});
    },
  });
}
export type GameLaunchJobController = ReturnType<typeof createGameLaunchJobController>;
