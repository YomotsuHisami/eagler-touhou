/** Published singleplayer acquisition and configuration, independent of React/DOM.
 * No iframe, lease, launch, preference write or background transfer is owned here.
 * The canonical Package/Host/Runtime validators are shared with the bounded sample.
 */
import type {PreparedOggSeed} from './ogg-progressive.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import { PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, isGameId, languagePriority, productFeatureAvailable, type GameId } from '../../src/contracts/product-catalog.mts';
import { componentFileIds } from '../../package/package-generation.mjs';
import { buildLanguageCatalog, thpracLocaleForLanguage } from '../../src/launcher/language-catalog.mts';
import { resolveEffectiveMusicMode } from '../../src/launcher/music-availability.mts';
import { acquirePublishedGeneration, resolvePublishedGame,
  checkPublishedCancelled, SampleLaunchError, sampleErrorText,
  publishedLaunchFailure,
  type ResolvedPublishedGame, type SampleAssetCheck, type SampleLaunchReason, type Th06SampleOptions,
} from './sample-launch.client';
import {prepareStaticLanguagePack, type LanguagePackEnvironment} from './language-pack.client';
import {loadOfflineLanguageIndex} from '../../src/launcher/offline-language-index.mts';
import type { PreferencesContext, PreferencesSnapshot } from './preferences.client';
import type { RuntimePlan, RuntimeSnapshot, RuntimeReadyContinuation } from './runtime.client';
import type { PackageInstallProgress } from '../../package/package-installer.mjs';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import {GameDataAcquisitionError} from './game-data-acquisition';

export interface PublishedGameOptions extends Th06SampleOptions, LanguagePackEnvironment {
  productId: string;
  uiLocale?: string;
  audioAvailable?: boolean;
  /** Supply only when the root Runtime MIDI synth/bridge owner is installed. */
  midiAvailable?: boolean;
}
export interface PublishedGameInspection {
  productId: string;
  game: GameId | null;
  available: boolean;
  status: 'installed' | 'installable' | 'unavailable';
  reason: SampleLaunchReason | null;
  checks: readonly SampleAssetCheck[];
  runtimeVerified: false;
  packageVerified: false;
  requiresStorageRepair?: boolean;
  installedRevision?: string | null;
  publishedRevision?: string | null;
  updateAvailable?: boolean;
  source?: 'local' | 'remote' | null;
  gameDataFallback?: Readonly<{url: string; hint: string}> | null;
  notice?: string;
  generationId: string | null;
  preferencesContext: PreferencesContext | null;
  limitations: readonly string[];
}
export interface PreparePublishedGameOptions extends PublishedGameOptions {
  preferences: PreferencesSnapshot;
  touchLayout?: TouchLayout | null;
  /** Click-time identity; never silently switch the selected installed Package. */
  expectedGenerationId?: string;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  runtimeService: { prepare(plan: RuntimePlan, signal?: AbortSignal): Promise<RuntimeSnapshot>; prepareWithReady?(plan: RuntimePlan, onReady: RuntimeReadyContinuation, signal?: AbortSignal): Promise<RuntimeSnapshot> };
  onProgress?: (progress: PackageInstallProgress) => void;
  onWarning?: (warning: string) => void;
  progressiveOgg?: boolean;
  onPreparedOgg?: (seed: PreparedOggSeed) => void;
  /** The current startup download may be cancelled without cancelling Start. */
  onInitialOggDownload?: (cancel: (() => void) | null) => void;
}
const limitations = Object.freeze([] as string[]);
function failure(code: ConstructorParameters<typeof SampleLaunchError>[0], message: string): never {
  throw new SampleLaunchError(code, message);
}
export function publishedPreferencesContext(resolved: ResolvedPublishedGame, options: PublishedGameOptions): PreferencesContext {
  const {game, host, generation, descriptor, catalog} = resolved;
  const published = host.games[game]!;
  const oggIds = componentFileIds(descriptor, 'ogg');
  return {
    uiLocale: options.uiLocale ?? 'zh-CN', hostFeatures: published.features ?? {},
    languageCatalog: buildLanguageCatalog({languageOptions: published.languageOptions,
      legacyLanguages: published.languages, generation, offlineEntries: loadOfflineLanguageIndex(options.offlineStorage ?? null, game), priority: languagePriority}),
    musicAvailability: {
      audio: options.audioAvailable !== false,
      midiAvailable: options.midiAvailable === true && PRODUCT_GAMES[game].musicCapabilities.midi && published.music.midi.supported !== false,
      importServer: host.shared.resourceMode === 'import',
      remoteOggAdvertised: oggIds.length >= 2 && (!!resolved.development || catalog?.games[game]?.revision === descriptor.revision),
      remoteRevision: resolved.development ? descriptor.revision : catalog?.games[game]?.revision ?? null,
      installed: generation ? { revision: descriptor.revision, oggFileIds: oggIds, files: generation.files } : null,
    },
  };
}
export async function inspectPublishedGame(options: PublishedGameOptions): Promise<PublishedGameInspection> {
  const checks: SampleAssetCheck[] = [];
  let gameDataFallback: PublishedGameInspection['gameDataFallback'] = null;
  try {
    const resolved = await resolvePublishedGame({...options, runtimeVariant: 'normal'}, checks, host => {
      const fallback = host.shared.gameDataFallback;
      if (!fallback) return;
      try {
        const url = new URL(fallback.url, options.baseUrl);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) gameDataFallback = {url: url.href, hint: fallback.hint ?? ''};
      } catch { /* A recovery link must not invalidate otherwise usable resources. */ }
    });
    return {productId: options.productId, game: resolved.game, available: true,
      status: resolved.generation ? 'installed' : 'installable', reason: null, checks, gameDataFallback, source: resolved.source ?? null,
      installedRevision: resolved.generation?.descriptor.revision ?? null,
      publishedRevision: resolved.catalog?.games[resolved.game]?.revision ?? null,
      updateAvailable: !!resolved.generation && !!resolved.catalog?.games[resolved.game] && resolved.descriptor.revision !== resolved.catalog.games[resolved.game]!.revision,
      runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null,
      preferencesContext: publishedPreferencesContext(resolved, options), limitations};
  } catch (error) {
    const reason = publishedLaunchFailure(error);
    if (reason.code === 'storage-repair-required' && isGameId(options.productId)) {
      return {productId: options.productId, game: options.productId, available: true, status: 'installable', reason: null, checks,
        runtimeVerified: false, packageVerified: false, generationId: null, preferencesContext: null,
        requiresStorageRepair: true, notice: reason.message, gameDataFallback, limitations};
    }
    return {productId: options.productId, game: null, available: false, status: 'unavailable',
      reason: {code: reason.code, message: reason.message}, checks, runtimeVerified: false,
      packageVerified: false, generationId: null, preferencesContext: null, gameDataFallback, limitations};
  }
}

/** Optional translation fallback is launch-local and never rewrites saved intent. */
export async function resolveLaunchLanguage(resolved: ResolvedPublishedGame, options: PublishedGameOptions, requested: string, onWarning?: (warning: string) => void) {
  let language = requested;
  let runtimePack: Awaited<ReturnType<typeof prepareStaticLanguagePack>> = null;
  try {
    runtimePack = await prepareStaticLanguagePack({...options, language, resolved,
      entry: publishedPreferencesContext(resolved, options).languageCatalog?.find(item => item.id === language) ?? null,
    });
  } catch (error) {
    checkPublishedCancelled(options.signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    onWarning?.(`${language} translation is unavailable; using the built-in Japanese language for this launch. ${sampleErrorText(error)}`);
    language = 'ja';
  }
  return {language, runtimePack};
}

type PreparedGameResult = {plan: RuntimePlan; resolved: ResolvedPublishedGame; oggIds: string[]};
type RuntimeReadyHook = (basePlan: RuntimePlan, finish: () => Promise<PreparedGameResult>) => Promise<PreparedGameResult>;
export type BuildPublishedGamePlanOptions = Omit<PreparePublishedGameOptions, 'runtimeService'> & {prepareRuntime?: RuntimeReadyHook};
/** Exact click-time settings are isolated before network work. Never starts a game. */
async function buildPreparation(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer', fileOnly = false) {
  const options = {...input, preferences: structuredClone(input.preferences), touchLayout: structuredClone(input.touchLayout ?? null)};
  const prefs = options.preferences;
  const multiplayer = runtimeVariant === 'multiplayer';
  if (isMultiplayerProductId(options.productId) !== multiplayer || (!multiplayer && !isGameId(options.productId))) failure('unsupported-product', 'The selected product and Runtime variant disagree');
  const game = gameIdForProduct(options.productId);
  const expectedPreference = multiplayer && prefs.shareSingleplayerSettings ? game : options.productId;
  if (prefs.productId !== options.productId || prefs.preferenceId !== expectedPreference) {
    failure('unsupported-product', 'The preference snapshot does not belong to the requested product');
  }
  let resolved: ResolvedPublishedGame;
  try {resolved = await resolvePublishedGame({...options, productId: game, runtimeVariant, storageIntent: 'prepare'}, []);}
  catch (error) {
    checkPublishedCancelled(options.signal);
    if (error instanceof SampleLaunchError && ['catalog-unavailable', 'package-unavailable'].includes(error.code)) throw new GameDataAcquisitionError(error.message, {cause: error}, error.code);
    throw error;
  }
  if (options.expectedGenerationId !== undefined && resolved.generation?.id !== options.expectedGenerationId) failure('conflicting-generation', 'The installed Package changed; inspect again before preparing');
  const metadata = publishedPreferencesContext(resolved, options);
  if (!prefs.language) {
    failure('language-unavailable', 'Refresh the current language catalog before preparing the game');
  }
  let language: string = prefs.language;
  if (prefs.music === null) failure('unsupported-music', 'Refresh the current music metadata before preparing the game');
  if (prefs.music === 'midi' && (options.midiAvailable !== true || !options.prepareMidi)) {
    failure('unsupported-music', 'MIDI synthesis is not connected in this entry. Select OGG or no music.');
  }
  const music = fileOnly ? 'none' : resolveEffectiveMusicMode({...metadata.musicAvailability!, requested: prefs.musicPreference ?? prefs.music, explicit: prefs.musicPreferenceExplicit ?? true});
  const oggIds = music === 'ogg-stream' || music === 'ogg-full' ? componentFileIds(resolved.descriptor, 'ogg') : [];
  const mount = PRODUCT_GAMES[resolved.game].package.musicMounts.ogg;
  for (const id of oggIds) {
    const file = resolved.descriptor.files[id];
    const name = file?.source.split('/').at(-1);
    if (!file || !name || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ogg$/i.test(name) || (!resolved.generation?.files[id]?.objectId && file.source !== `games/${resolved.game}/music/ogg/${name}`) || file.target !== `${mount}/${name}` || !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '')) {
      failure('unsupported-package', `${id}: OGG must use the canonical product music mount`);
    }
  }
  const resourceIds = fileOnly ? [] : Object.entries(resolved.descriptor.components).filter(([,component]) => component.type === 'resource')
    .flatMap(([id]) => componentFileIds(resolved.descriptor,id))
    .filter(id => !!resolved.generation?.files[id]?.objectId || resolved.host.shared.resourceMode === 'hosted');
  let selectedOggIds = options.progressiveOgg ? oggIds.slice(0, 2) : oggIds;
  // main's transient fallback is a native MIDI sentinel. Actual synth/hardware
  // setup remains guarded separately by the product's playback capability.
  const fallbackToMidi = true;
  let effectiveMusic = music;
  let generation: InstalledPackageGeneration;
  try {
    // main ensures mandatory DATA first. Optional initial OGG has its own
    // failure/cancellation boundary and must never make DATA replacement fail.
    generation = await acquirePublishedGeneration(options, resolved);
  } catch (error) {
    checkPublishedCancelled(options.signal);
    if (!resolved.generation || resolved.baseIds.some(id => !resolved.generation!.files[id]?.objectId)) {
      throw new GameDataAcquisitionError(sampleErrorText(error), {cause: error}, error instanceof SampleLaunchError ? error.code : 'game-data-acquisition');
    }
    throw error;
  }
  const finish = async (): Promise<PreparedGameResult> => {
  if (resourceIds.length) generation = await acquirePublishedGeneration(options, {...resolved,generation,descriptor:generation.descriptor}, resourceIds);
  // Bind language acquisition to the exact generation returned by acquisition.
  const translated = await resolveLaunchLanguage({...resolved, generation, descriptor: generation.descriptor}, options, language, options.onWarning);
  language = translated.language;
  const runtimePack = translated.runtimePack;
  if (selectedOggIds.length) {
    for (const id of selectedOggIds) {
      const ref=generation.files[id];
      if (ref && ref.revision !== generation.descriptor.files[id]?.revision) failure('missing-object', `${id}: installed reference has a conflicting revision`);
    }
    const download=new AbortController(), abort=()=>download.abort(options.signal?.reason);
    options.signal?.addEventListener('abort',abort,{once:true});
    options.onInitialOggDownload?.(()=>download.abort());
    try {
      checkPublishedCancelled(options.signal);
      generation = await acquirePublishedGeneration({...options,signal:download.signal}, {...resolved,generation,descriptor:generation.descriptor}, [...resourceIds,...selectedOggIds]);
    } catch (error) {
      checkPublishedCancelled(options.signal);
      // Declaration/generation conflicts retain their diagnosis. Network,
      // missing/corrupt optional bytes and cancelling only OGG follow main's
      // transient fallback, preserving saved music and already-valid DATA.
      if (error instanceof SampleLaunchError && ['unsupported-package','conflicting-generation'].includes(error.code)) throw error;
      effectiveMusic='midi';selectedOggIds=[];
      if (!download.signal.aborted) options.onWarning?.(`Initial OGG could not be prepared; using MIDI for this launch. Your saved OGG preference is unchanged. ${sampleErrorText(error)}`);
    } finally {options.signal?.removeEventListener('abort',abort);options.onInitialOggDownload?.(null);}
  }
  if (effectiveMusic !== 'none' && PRODUCT_GAMES[resolved.game].musicCapabilities.midi && options.midiAvailable === true) {
    if (!options.prepareMidi) failure('unsupported-music', 'The MIDI bridge is unavailable');
    await options.prepareMidi(options.signal);checkPublishedCancelled(options.signal);
  }
  const features = resolved.host.games[resolved.game]!.features;
  const product = PRODUCT_GAMES[resolved.game];
  const stored = prefs.options;
  const plan: RuntimePlan = { game: resolved.game, runtimeVariant, generation, entry: resolved.entry,
    publishedRuntime: !resolved.development, ...(resolved.development ? {developmentRuntimeHost: resolved.host} : {}), launcherControls: {restartButtonEnabled: stored.restartButtonEnabled,
      thpracTouchControlsEnabled: stored.thpracTouchControlsEnabled, magnifierEnabled: stored.magnifierEnabled, touchLayout: options.touchLayout, touchControlOpacity: stored.touchControlOpacity},
    resourceFileIds: [...resolved.baseIds.filter(id => id !== 'game-data'), ...resourceIds, ...selectedOggIds],
    ...(selectedOggIds.length ? {localOgg: {fileIds: selectedOggIds, fallbackToMidi}} : {}),
    configure: {music: selectedOggIds.length ? 'ogg' : effectiveMusic === 'midi' ? 'midi' : 'none', language,
      resources: [], runtimeResources: [], sharedResources: [], runtimePack,
      options: {limitPresentationTo60: !product.support.highRefreshRate || stored.frameLimit60Enabled, touchEnabled: stored.touchEnabled,
        touchMovementMode: stored.touchMovementMode, touchSensitivity: stored.touchSensitivity,
        touchFocusMode: stored.touchFocusMode, doubleTapBombEnabled: stored.doubleTapBombEnabled,
        alwaysHitbox: stored.alwaysHitbox, ...(multiplayer ? {multiplayerLocalPlayerVisibility: stored.multiplayerLocalPlayerVisibility} : {}), oggDecodeMode: music === 'ogg-full' ? 'full' : 'stream',
        ...('display' in product && product.display.faithBar ? {faithBarEnabled: stored.faithBarEnabled} : {}),
        ...(!multiplayer && productFeatureAvailable(resolved.game, 'thprac', features) ? {thpracEnabled: stored.thpracEnabled, thpracLocale: thpracLocaleForLanguage(language)} : {}),
        ...(productFeatureAvailable(resolved.game, 'focusHitbox', features) ? {focusHitboxEnabled: stored.focusHitboxEnabled} : {}),
      }},
  };
  checkPublishedCancelled(options.signal);
  return {plan, resolved: {...resolved, generation, descriptor: generation.descriptor}, oggIds: selectedOggIds.length ? oggIds : []};
  };
  if (options.prepareRuntime) {
    const basePlan: RuntimePlan = {game: resolved.game, runtimeVariant, generation,
      entry: resolved.entry, publishedRuntime: !resolved.development,
      ...(resolved.development ? {developmentRuntimeHost: resolved.host} : {}),
      configure: {music: 'none', language: 'ja', resources: [], runtimeResources: [], sharedResources: [], options: {}}};
    return options.prepareRuntime(basePlan, finish);
  }
  return finish();
}
/** Reusable by the room owner; that owner adds authoritative multiplayer options. */
export async function buildPublishedGamePlan(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer' = 'normal'): Promise<RuntimePlan> {
  return (await buildPreparation(input, runtimeVariant)).plan;
}
export async function buildPublishedGamePreparation(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer' = 'normal') {
  const {plan, resolved, oggIds} = await buildPreparation(input, runtimeVariant);
  return {plan, ogg: input.progressiveOgg && oggIds.length ? {resolved, fileIds: oggIds} : null};
}
export async function buildPublishedFilePlan(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer' = 'normal'): Promise<RuntimePlan> {
  return (await buildPreparation({...input, preferences: {...input.preferences, music: 'none', language: 'ja'}, progressiveOgg: false}, runtimeVariant, true)).plan;
}
export async function preparePublishedFiles(options: PreparePublishedGameOptions): Promise<RuntimeSnapshot> {
  const plan = await buildPublishedFilePlan(options);
  checkPublishedCancelled(options.signal);const prepared = await options.runtimeService.prepare(plan);checkPublishedCancelled(options.signal);return prepared;
}
export async function preparePublishedGame(options: PreparePublishedGameOptions, runtimeVariant: 'normal' | 'multiplayer' = 'normal',
  configureOptions: RuntimePlan['configure']['options'] = {}): Promise<RuntimeSnapshot> {
  if (options.progressiveOgg && !options.onPreparedOgg) failure('prepare-failed', 'Progressive OGG requires its root acquisition owner');
  let prepared: RuntimeSnapshot | undefined;
  const staged = options.runtimeService.prepareWithReady;
  const {plan, resolved, oggIds} = await buildPreparation({...options, ...(staged ? {prepareRuntime: async (basePlan: RuntimePlan, finish: () => Promise<PreparedGameResult>) => {
    let final: PreparedGameResult | undefined;
    basePlan.configure.options = {...configureOptions};
    prepared = await staged(basePlan, async () => {
      checkPublishedCancelled(options.signal);
      final = await finish();
      final.plan.configure.options = {...final.plan.configure.options, ...configureOptions};
      checkPublishedCancelled(options.signal);
      return final.plan;
    }, options.signal);
    if (!final) throw new Error('Runtime did not complete its native-ready continuation');
    return final;
  }} : {})}, runtimeVariant);
  checkPublishedCancelled(options.signal);
  plan.configure.options = {...plan.configure.options, ...configureOptions};
  const result = prepared ?? await options.runtimeService.prepare(plan, options.signal);
  checkPublishedCancelled(options.signal);
  if (options.progressiveOgg && oggIds.length && result.music !== 'midi' && result.epoch !== null) options.onPreparedOgg?.({epoch: result.epoch, resolved, fileIds: oggIds});
  return result;
}
