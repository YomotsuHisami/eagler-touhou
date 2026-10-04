/** Root-lifetime published game jobs. Selection is captured per click and never
 * inferred from the Router after asynchronous package/runtime work begins. */
import {createProgressiveOggController, type OggRuntimePort} from './ogg-progressive.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {inspectPublishedGame, preparePublishedGame, type PublishedGameOptions} from './game-launch.client';
import {createPreparationJobController, type PreparationRuntimeService} from './preparation-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {SampleLaunchDependencies} from './sample-launch.client';
export interface GameLaunchSelection {
  productId: string;
  preferences: PreferencesSnapshot | null;
  touchLayout?: TouchLayout | null;
}
export interface GameLaunchJobOptions extends Omit<PublishedGameOptions, 'productId' | 'signal' | 'dependencies'> {
  runtimeService: PreparationRuntimeService & Partial<Pick<OggRuntimePort, 'extendOggResources'>>;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  packageDependencies?: Partial<SampleLaunchDependencies>;
  dependencies?: {inspect?: typeof inspectPublishedGame; prepare?: typeof preparePublishedGame};
}
export function createGameLaunchJobController(options: GameLaunchJobOptions) {
  const shared = {baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    uiLocale: options.uiLocale, audioAvailable: options.audioAvailable, midiAvailable: options.midiAvailable,
    dependencies: options.packageDependencies, cacheStorage: options.cacheStorage, offlineStorage: options.offlineStorage};
  const ogg = options.runtimeService.extendOggResources ? createProgressiveOggController({...shared, runtime: options.runtimeService as OggRuntimePort}) : null;
  const controller = createPreparationJobController({runtimeService: options.runtimeService,
    key: (selection: GameLaunchSelection) => JSON.stringify(selection),
    inspect: (selection: GameLaunchSelection, signal) => (options.dependencies?.inspect ?? inspectPublishedGame)({...shared, productId: selection.productId, signal}),
    prepare: (selection: GameLaunchSelection, ports) => {
      if (!selection.preferences) throw new Error('Load the product settings before preparing a game');
      return (options.dependencies?.prepare ?? preparePublishedGame)({...shared, ...ports,
        progressiveOgg: !!ogg, onPreparedOgg: seed => ogg?.arm(seed),
        productId: selection.productId, preferences: selection.preferences, touchLayout: selection.touchLayout, prepareMidi: options.prepareMidi});
    },
  });
  const listeners = new Set<() => void>();
  let snapshot = Object.freeze({...controller.getSnapshot(), ogg: ogg?.getSnapshot() ?? null});
  const publish = () => {snapshot = Object.freeze({...controller.getSnapshot(), ogg: ogg?.getSnapshot() ?? null}); for (const fn of listeners) fn();};
  const offJob = controller.subscribe(publish), offOgg = ogg?.subscribe(publish);
  return Object.freeze({...controller,
    getSnapshot: () => snapshot, subscribe(fn: () => void) {listeners.add(fn); return () => {listeners.delete(fn);};},
    cancel() {controller.cancel(); ogg?.cancel();}, cancelOgg: () => ogg?.cancel(), retryOgg: () => ogg?.retry(),
    dispose() {offJob(); offOgg?.(); controller.dispose(); ogg?.dispose(); listeners.clear();},
    inspect: (productId: string) => controller.inspect({productId, preferences: null}),
    prepare: (productId: string, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null = null) => controller.prepare({productId, preferences, touchLayout}),
  });
}
export type GameLaunchJobController = ReturnType<typeof createGameLaunchJobController>;
