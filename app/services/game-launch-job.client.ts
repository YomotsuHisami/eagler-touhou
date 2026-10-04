/** Root-lifetime published game jobs. Selection is captured per click and never
 * inferred from the Router after asynchronous package/runtime work begins. */
import {inspectPublishedGame, preparePublishedGame, type PublishedGameOptions} from './game-launch.client';
import {createPreparationJobController, type PreparationRuntimeService} from './preparation-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {SampleLaunchDependencies} from './sample-launch.client';
export interface GameLaunchSelection {
  productId: string;
  preferences: PreferencesSnapshot | null;
}
export interface GameLaunchJobOptions extends Omit<PublishedGameOptions, 'productId' | 'signal' | 'dependencies'> {
  runtimeService: PreparationRuntimeService;
  packageDependencies?: Partial<SampleLaunchDependencies>;
  dependencies?: {inspect?: typeof inspectPublishedGame; prepare?: typeof preparePublishedGame};
}
export function createGameLaunchJobController(options: GameLaunchJobOptions) {
  const shared = {baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    uiLocale: options.uiLocale, audioAvailable: options.audioAvailable, midiAvailable: options.midiAvailable,
    dependencies: options.packageDependencies};
  const controller = createPreparationJobController({runtimeService: options.runtimeService,
    key: (selection: GameLaunchSelection) => JSON.stringify(selection),
    inspect: (selection: GameLaunchSelection, signal) => (options.dependencies?.inspect ?? inspectPublishedGame)({...shared, productId: selection.productId, signal}),
    prepare: (selection: GameLaunchSelection, ports) => {
      if (!selection.preferences) throw new Error('Load the product settings before preparing a game');
      return (options.dependencies?.prepare ?? preparePublishedGame)({...shared, ...ports,
        productId: selection.productId, preferences: selection.preferences});
    },
  });
  return Object.freeze({...controller,
    inspect: (productId: string) => controller.inspect({productId, preferences: null}),
    prepare: (productId: string, preferences: PreferencesSnapshot) => controller.prepare({productId, preferences}),
  });
}
export type GameLaunchJobController = ReturnType<typeof createGameLaunchJobController>;
