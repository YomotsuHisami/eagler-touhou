/** Multiplayer Replay uses the published multiplayer Runtime without a room.
 * Package acquisition, MIDI preferences and file policy remain in their owners;
 * only this explicit launch intent adds the canonical replayViewer flag.
 */
import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {buildPublishedGamePlan, publishedPreferencesContext, type BuildPublishedGamePlanOptions, type PreparePublishedGameOptions, type PublishedGameInspection, type PublishedGameOptions} from './game-launch.client';
import {checkPublishedCancelled, resolvePublishedGame, sampleErrorText, SampleLaunchError, type SampleAssetCheck, type SampleLaunchDependencies} from './sample-launch.client';
import {createPreparationJobController, type PreparationRuntimeService} from './preparation-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {RuntimeLauncherControlContext, RuntimeMidiEventContext, RuntimeSnapshot} from './runtime.client';
import type {MidiController} from './midi.client';

function assertReplayProduct(productId: string): asserts productId is MultiplayerProductId {
  if (!isMultiplayerProductId(productId)) throw new SampleLaunchError('unsupported-product', 'Select a multiplayer product to open its Replay viewer');
}
export async function inspectMultiplayerReplay(options: PublishedGameOptions): Promise<PublishedGameInspection> {
  const checks: SampleAssetCheck[] = [];
  const limitations = Object.freeze([] as string[]);
  try {
    assertReplayProduct(options.productId);
    const resolved = await resolvePublishedGame({...options, productId: gameIdForProduct(options.productId), runtimeVariant: 'multiplayer'}, checks);
    return {productId: options.productId, game: resolved.game, available: true,
      status: resolved.generation ? 'installed' : 'installable', reason: null, checks,
      runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null,
      preferencesContext: publishedPreferencesContext(resolved, options), limitations};
  } catch (error) {
    checkPublishedCancelled(options.signal);
    const reason = error instanceof SampleLaunchError ? error : new SampleLaunchError('prepare-failed', sampleErrorText(error));
    if (reason.code === 'storage-repair-required' && isMultiplayerProductId(options.productId)) {
      return {productId: options.productId, game: gameIdForProduct(options.productId), available: true,
        status: 'installable', reason: null, checks, runtimeVerified: false, packageVerified: false,
        generationId: null, preferencesContext: null, requiresStorageRepair: true, notice: reason.message, limitations};
    }
    return {productId: options.productId, game: null, available: false, status: 'unavailable', reason: {code: reason.code, message: reason.message},
      checks, runtimeVerified: false, packageVerified: false, generationId: null, preferencesContext: null, limitations};
  }
}
/** Capture settings before any awaits; never borrow room/normal launch intent. */
export async function buildMultiplayerReplayPlan(options: BuildPublishedGamePlanOptions) {
  assertReplayProduct(options.productId);
  const plan = await buildPublishedGamePlan({...options, progressiveOgg: false}, 'multiplayer');
  checkPublishedCancelled(options.signal);
  plan.configure.options = {...plan.configure.options, replayViewer: true};
  return plan;
}
export async function prepareMultiplayerReplay(options: PreparePublishedGameOptions) {
  const plan = await buildMultiplayerReplayPlan(options);
  checkPublishedCancelled(options.signal);
  const prepared = await options.runtimeService.prepare(plan);
  checkPublishedCancelled(options.signal);
  return prepared;
}
export interface MultiplayerReplaySelection {
  productId: MultiplayerProductId;
  preferences: PreferencesSnapshot | null;
  touchLayout: TouchLayout | null;
}
export interface MultiplayerReplayJobOptions extends Omit<PublishedGameOptions, 'productId' | 'signal' | 'dependencies'> {
  runtimeService: PreparationRuntimeService;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  packageDependencies?: Partial<SampleLaunchDependencies>;
  dependencies?: {inspect?: typeof inspectMultiplayerReplay; prepare?: typeof prepareMultiplayerReplay};
}
export function createMultiplayerReplayJob(options: MultiplayerReplayJobOptions) {
  const shared = {baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    uiLocale: options.uiLocale, audioAvailable: options.audioAvailable, midiAvailable: options.midiAvailable,
    dependencies: options.packageDependencies, cacheStorage: options.cacheStorage, offlineStorage: options.offlineStorage};
  const controller = createPreparationJobController({runtimeService: options.runtimeService,
    key: (selection: MultiplayerReplaySelection) => JSON.stringify(selection),
    inspect: (selection: MultiplayerReplaySelection, signal) => (options.dependencies?.inspect ?? inspectMultiplayerReplay)({...shared, productId: selection.productId, signal}),
    prepare: (selection: MultiplayerReplaySelection, ports) => {
      assertReplayProduct(selection.productId);
      if (!selection.preferences) throw new Error('Load the multiplayer settings before preparing the Replay viewer');
      return (options.dependencies?.prepare ?? prepareMultiplayerReplay)({...shared, ...ports,
        productId: selection.productId, preferences: selection.preferences, touchLayout: selection.touchLayout, prepareMidi: options.prepareMidi});
    },
  });
  return Object.freeze({...controller,
    inspect: (productId: MultiplayerProductId) => controller.inspect({productId, preferences: null, touchLayout: null}),
    prepare: (productId: MultiplayerProductId, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null = null) => controller.prepare({productId, preferences, touchLayout}),
  });
}
export type MultiplayerReplayJob = ReturnType<typeof createMultiplayerReplayJob>;
export type MultiplayerReplaySnapshot = ReturnType<MultiplayerReplayJob['getSnapshot']>;

export interface ReplayStartRuntime {
  getSnapshot(): Pick<RuntimeSnapshot, 'phase' | 'epoch' | 'game' | 'runtimeVariant' | 'fileOperationBusy'>;
  getLauncherControlContext(): RuntimeLauncherControlContext | null;
  getMidiEventContext(): RuntimeMidiEventContext | null;
  launch(): Promise<RuntimeSnapshot>;
}
/** Reading configure intent distinguishes Replay from a room waiting to start.
 * Never infer it from a URL, a previous preparation result or variant alone.
 */
export function preparedMultiplayerReplayEpoch(runtime: ReplayStartRuntime): number | null {
  const live = runtime.getSnapshot(), context = runtime.getLauncherControlContext();
  if (live.phase !== 'prepared' || live.epoch === null || live.runtimeVariant !== 'multiplayer' ||
      context?.epoch !== live.epoch || context.game !== live.game || context.runtimeVariant !== 'multiplayer' ||
      context.options.replayViewer !== true || context.options.multiplayerPreflight === true ||
      Object.keys(context.options).some(key => key.startsWith('netplay'))) return null;
  return live.epoch;
}
export function multiplayerReplayNeedsMidi(runtime: ReplayStartRuntime, epoch: number) {
  const context = runtime.getMidiEventContext();
  return !!context && context.epoch === epoch && context.music !== 'none' && PRODUCT_GAMES[context.game].musicCapabilities.midi;
}
/** Explicit gesture-only Start, with epoch recheck after resuming audio. */
export async function startMultiplayerReplay({runtime, midi, epoch, currentIntent = () => true}: {
  runtime: ReplayStartRuntime; midi: MidiController | null; epoch: number; currentIntent?: () => boolean;
}): Promise<'started' | 'audio-prepared' | 'superseded'> {
  const current = () => currentIntent() && preparedMultiplayerReplayEpoch(runtime) === epoch && !runtime.getSnapshot().fileOperationBusy;
  if (!current()) return 'superseded';
  if (multiplayerReplayNeedsMidi(runtime, epoch)) {
    if (!midi) throw new Error('Wait for the MIDI bridge before starting the Replay viewer');
    if (!midi.getSnapshot().ready) {await midi.ensureReady(); return current() ? 'audio-prepared' : 'superseded';}
    await midi.resumeForGesture(epoch);
  }
  if (!current()) return 'superseded';
  await runtime.launch();
  return 'started';
}
