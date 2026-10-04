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
  type ResolvedPublishedGame, type SampleAssetCheck, type SampleLaunchReason, type Th06SampleOptions,
} from './sample-launch.client';
import {prepareStaticLanguagePack, type LanguagePackEnvironment} from './language-pack.client';
import {loadOfflineLanguageIndex} from '../../src/launcher/offline-language-index.mts';
import type { PreferencesContext, PreferencesSnapshot } from './preferences.client';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';
import type { PackageInstallProgress } from '../../package/package-installer.mjs';

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
  notice?: string;
  generationId: string | null;
  preferencesContext: PreferencesContext | null;
  limitations: readonly string[];
}
export interface PreparePublishedGameOptions extends PublishedGameOptions {
  preferences: PreferencesSnapshot;
  touchLayout?: TouchLayout | null;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  runtimeService: { prepare(plan: RuntimePlan): Promise<RuntimeSnapshot> };
  onProgress?: (progress: PackageInstallProgress) => void;
  onWarning?: (warning: string) => void;
  progressiveOgg?: boolean;
  onPreparedOgg?: (seed: PreparedOggSeed) => void;
}
const limitations = Object.freeze([
  'OGG acquisition completes before preparation; progressive in-game downloads are not yet connected.',
]);
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
      remoteOggAdvertised: oggIds.length >= 2 && catalog?.games[game]?.revision === descriptor.revision,
      remoteRevision: catalog?.games[game]?.revision ?? null,
      installed: generation ? { revision: descriptor.revision, oggFileIds: oggIds, files: generation.files } : null,
    },
  };
}
export async function inspectPublishedGame(options: PublishedGameOptions): Promise<PublishedGameInspection> {
  const checks: SampleAssetCheck[] = [];
  try {
    const resolved = await resolvePublishedGame({...options, runtimeVariant: 'normal'}, checks);
    return {productId: options.productId, game: resolved.game, available: true,
      status: resolved.generation ? 'installed' : 'installable', reason: null, checks,
      runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null,
      preferencesContext: publishedPreferencesContext(resolved, options), limitations};
  } catch (error) {
    const reason = error instanceof SampleLaunchError ? error : new SampleLaunchError('prepare-failed', sampleErrorText(error));
    if (reason.code === 'storage-repair-required' && isGameId(options.productId)) {
      return {productId: options.productId, game: options.productId, available: true, status: 'installable', reason: null, checks,
        runtimeVerified: false, packageVerified: false, generationId: null, preferencesContext: null,
        requiresStorageRepair: true, notice: reason.message, limitations};
    }
    return {productId: options.productId, game: null, available: false, status: 'unavailable',
      reason: {code: reason.code, message: reason.message}, checks, runtimeVerified: false,
      packageVerified: false, generationId: null, preferencesContext: null, limitations};
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

export type BuildPublishedGamePlanOptions = Omit<PreparePublishedGameOptions, 'runtimeService'>;
/** Exact click-time settings are isolated before network work. Never starts a game. */
async function buildPreparation(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer') {
  const options = {...input, preferences: structuredClone(input.preferences), touchLayout: structuredClone(input.touchLayout ?? null)};
  const prefs = options.preferences;
  const multiplayer = runtimeVariant === 'multiplayer';
  if (isMultiplayerProductId(options.productId) !== multiplayer || (!multiplayer && !isGameId(options.productId))) failure('unsupported-product', 'The selected product and Runtime variant disagree');
  const game = gameIdForProduct(options.productId);
  const expectedPreference = multiplayer && prefs.shareSingleplayerSettings ? game : options.productId;
  if (prefs.productId !== options.productId || prefs.preferenceId !== expectedPreference) {
    failure('unsupported-product', 'The preference snapshot does not belong to the requested product');
  }
  const resolved = await resolvePublishedGame({...options, productId: game, runtimeVariant, storageIntent: 'prepare'}, []);
  const metadata = publishedPreferencesContext(resolved, options);
  let language = prefs.language;
  if (!language) {
    failure('language-unavailable', 'Refresh the current language catalog before preparing the game');
  }
  if (prefs.music === null) failure('unsupported-music', 'Refresh the current music metadata before preparing the game');
  if (prefs.music === 'midi' && (options.midiAvailable !== true || !options.prepareMidi)) {
    failure('unsupported-music', 'MIDI synthesis is not connected in this entry. Select OGG or no music.');
  }
  const music = resolveEffectiveMusicMode({...metadata.musicAvailability!, requested: prefs.music, explicit: true});
  if (music !== prefs.music) failure('unsupported-music', 'The selected music is no longer available; refresh the resource catalog');
  const oggIds = music === 'ogg-stream' || music === 'ogg-full' ? componentFileIds(resolved.descriptor, 'ogg') : [];
  const mount = PRODUCT_GAMES[resolved.game].package.musicMounts.ogg;
  for (const id of oggIds) {
    const file = resolved.descriptor.files[id];
    const name = file?.source.split('/').at(-1);
    if (!file || !name || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ogg$/i.test(name) || (!resolved.generation?.files[id]?.objectId && file.source !== `games/${resolved.game}/music/ogg/${name}`) || file.target !== `${mount}/${name}`) {
      failure('unsupported-package', `${id}: OGG must use the canonical product music mount`);
    }
  }
  if (music !== 'none' && PRODUCT_GAMES[resolved.game].musicCapabilities.midi && options.midiAvailable === true) {
    if (!options.prepareMidi) failure('unsupported-music', 'The MIDI bridge is unavailable');
    await options.prepareMidi(options.signal); checkPublishedCancelled(options.signal);
  }
  const resourceIds = Object.entries(resolved.descriptor.components).filter(([,component]) => component.type === 'resource').flatMap(([id]) => componentFileIds(resolved.descriptor,id));
  const selectedOggIds = options.progressiveOgg ? oggIds.slice(0, 2) : oggIds;
  const generation = await acquirePublishedGeneration(options, resolved, [...resourceIds, ...selectedOggIds]);
  // Bind language acquisition to the exact generation returned by acquisition.
  const translated = await resolveLaunchLanguage({...resolved, generation, descriptor: generation.descriptor}, options, language, options.onWarning);
  language = translated.language;
  const runtimePack = translated.runtimePack;
  const features = resolved.host.games[resolved.game]!.features;
  const stored = prefs.options;
  const plan: RuntimePlan = { game: resolved.game, runtimeVariant, generation, entry: resolved.entry,
    publishedRuntime: true, launcherControls: {restartButtonEnabled: stored.restartButtonEnabled,
      thpracTouchControlsEnabled: stored.thpracTouchControlsEnabled, magnifierEnabled: stored.magnifierEnabled, touchLayout: options.touchLayout},
    resourceFileIds: [...resolved.baseIds.filter(id => id !== 'game-data'), ...resourceIds, ...selectedOggIds],
    configure: {music: oggIds.length ? 'ogg' : music === 'midi' ? 'midi' : 'none', language,
      resources: [], runtimeResources: [], sharedResources: [], runtimePack,
      options: {limitPresentationTo60: stored.frameLimit60Enabled, touchEnabled: stored.touchEnabled,
        touchMovementMode: stored.touchMovementMode, touchSensitivity: stored.touchSensitivity,
        touchFocusMode: stored.touchFocusMode, doubleTapBombEnabled: stored.doubleTapBombEnabled,
        alwaysHitbox: stored.alwaysHitbox, ...(multiplayer ? {multiplayerLocalPlayerVisibility: stored.multiplayerLocalPlayerVisibility} : {}), oggDecodeMode: music === 'ogg-full' ? 'full' : 'stream',
        ...(!multiplayer && productFeatureAvailable(resolved.game, 'thprac', features) ? {thpracEnabled: stored.thpracEnabled, thpracLocale: thpracLocaleForLanguage(language)} : {}),
        ...(productFeatureAvailable(resolved.game, 'focusHitbox', features) ? {focusHitboxEnabled: stored.focusHitboxEnabled} : {}),
      }},
  };
  checkPublishedCancelled(options.signal);
  return {plan, resolved: {...resolved, generation, descriptor: generation.descriptor}, oggIds};
}
/** Reusable by the room owner; that owner adds authoritative multiplayer options. */
export async function buildPublishedGamePlan(input: BuildPublishedGamePlanOptions, runtimeVariant: 'normal' | 'multiplayer' = 'normal'): Promise<RuntimePlan> {
  return (await buildPreparation(input, runtimeVariant)).plan;
}
export async function preparePublishedGame(options: PreparePublishedGameOptions): Promise<RuntimeSnapshot> {
  if (options.progressiveOgg && !options.onPreparedOgg) failure('prepare-failed', 'Progressive OGG requires its root acquisition owner');
  const {plan, resolved, oggIds} = await buildPreparation(options, 'normal');
  checkPublishedCancelled(options.signal);
  const result = await options.runtimeService.prepare(plan);
  checkPublishedCancelled(options.signal);
  if (options.progressiveOgg && oggIds.length && result.epoch !== null) options.onPreparedOgg?.({epoch: result.epoch, resolved, fileIds: oggIds});
  return result;
}
