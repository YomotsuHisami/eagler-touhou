import {componentFileIds} from '../../package/package-generation.mjs';
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, languagePriority, productFeatureAvailable,
  type ProductId} from '../../src/contracts/product-catalog.mts';
import type {HostManifest} from '../../src/contracts/host-manifest.mts';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import type {RuntimeConfigureOptions} from '../../src/contracts/runtime-protocol.mts';
import {buildLanguageCatalog, selectLanguageEntry, thpracLocaleForLanguage} from '../../src/launcher/language-catalog.mts';
import {resolveEffectiveMusicMode} from '../../src/launcher/music-availability.mts';
import type {MusicMode} from '../../src/launcher/game-preferences.mts';
import type {MultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import type {Translate} from '../i18n';
import type {SettingsSnapshot} from '../models/game-settings';
import {prepareLanguagePack, type PreparedLanguagePack} from './language-pack';
import {checkPreparationAbort, preparationErrorText, type AcquisitionRequest, type PackageAcquisition,
  type PackageAcquisitionResult, type PreparationProgress} from './package-acquisition';
import {ensureOggStartup, musicTransport, oggMusic, packageResourceIds, remoteMusicResources,
  remoteRuntimeResources, sharedResources} from './game-resources';
import {startPreparedGameBackground} from './game-preparation-background';
import type {RuntimePlan, RuntimeService, RuntimeSnapshot} from './runtime';

export type MultiplayerPreparation =
  | {kind: 'room'; options: MultiplayerRuntimeOptions}
  | {kind: 'replay'}
  | {kind: 'preflight'};
export interface FilePreparationInput {
  productId: ProductId;
  settings: SettingsSnapshot;
  acquisition: PackageAcquisition;
  baseUrl: string;
  translate: Translate;
  signal?: AbortSignal;
  onAcquisitionActivity?(active: boolean): void;
  onProgress?(progress: PreparationProgress): void;
  /** Identity is resolved; native navigation has not started. The host starts
   * main's DATA fallback timers only for the null-generation direct plan. */
  onRuntimePlan?(plan: Readonly<RuntimePlan>): void;
}
export interface GamePreparationInput extends FilePreparationInput {
  /** Click-time Launcher controls. Root owns gameplay, input and navigation. */
  touchLayout: TouchLayout | null;
  updateSignal?: AbortSignal;
  onUpdateActivity?(active: boolean): void;
  musicDownloadSignal?: AbortSignal;
  onMusicDownloadActivity?(active: boolean): void;
  onLanguageDownloadActivity?(active: boolean): void;
  decideUpdate?: AcquisitionRequest['decideUpdate'];
  onWarning?(message: string): void;
  onStatus?(message: string): void;
  /** Console diagnostics only. Main's current-session visible warnings use onWarning. */
  onBackgroundError?(error: unknown, message?: string): void;
  /** Main hides the transient transfer before optional-language/native-OGG fallback. */
  onTransferHide?(): void;
  /** The original local-partial failure hides transfer and displays its toast. */
  onLocalMusicFailure?(error: unknown): void;
  /** The one document-lived MIDI owner prepares built-in and selected external
   * output for MIDI AND OGG, exactly as main's prepareMidi does. */
  prepareMidi(music: MusicMode): Promise<void>;
  multiplayer?: MultiplayerPreparation;
  debugHarness?: string;
  language?: Pick<Parameters<typeof prepareLanguagePack>[0], 'caches' | 'storage' | 'dependencies'>;
}
export interface PreparedGamePlan {
  plan: RuntimePlan;
  language: string;
  music: MusicMode;
}
export interface PreparedGame extends PreparedGamePlan {
  runtimeSnapshot: RuntimeSnapshot;
  /** Call only after this exact Runtime has launched. Does not delay launch.
   * Repeated calls share one task. A completed in-flight download may persist
   * after close, but can never attach to a replacement Runtime. */
  startBackground(): Promise<void>;
}

function requestFor(input: FilePreparationInput, withUpdate: boolean): AcquisitionRequest {
  if (input.settings.context.productId !== input.productId || input.settings.gameId !== gameIdForProduct(input.productId)) throw new Error('Settings product changed before preparation');
  const game = input as GamePreparationInput;
  return {productId: input.productId, music: input.settings.music, language: input.settings.language,
    signal: input.signal, onProgress: input.onProgress, onAcquisitionActivity: input.onAcquisitionActivity,
    ...(withUpdate ? {updateSignal: game.updateSignal, onUpdateActivity: game.onUpdateActivity, decideUpdate: game.decideUpdate, onWarning: game.onWarning} : {})};
}
function identityPlan(input: FilePreparationInput, acquired: PackageAcquisitionResult): RuntimePlan {
  const game = gameIdForProduct(input.productId), product = PRODUCT_GAMES[game];
  const runtimeVariant = isMultiplayerProductId(input.productId) ? 'multiplayer' : 'normal';
  const host = input.acquisition.getMetadata().hostManifest;
  if (acquired.kind === 'direct-preload') return {game, runtimeVariant, generation: null,
    directPreloadHost: acquired.host, entry: acquired.entry, publishedRuntime: false, configure: {music: 'none'}};
  const hosted = host?.games[game];
  if (host && !hosted) throw new Error(input.translate('runtime.hostManifestMissingGame', {game}));
  const entry = runtimeVariant === 'normal' ? hosted?.runtime ?? product.runtime
    : hosted ? hosted.multiplayerRuntime : 'multiplayerRuntime' in product ? product.multiplayerRuntime : undefined;
  if (!entry) throw new Error(input.translate('runtime.multiplayerRuntimeMissing', {game: game.toUpperCase()}));
  const publishedRuntime = !!host?.shared.runtimeManifest;
  return {game, runtimeVariant, generation: acquired.generation, entry, publishedRuntime,
    ...(!host ? {localCatalogRuntime: true} : !publishedRuntime ? {runtimeHost: host} : {}), configure: {music: 'none'}};
}
function effectiveMusic(input: GamePreparationInput, generation: InstalledPackageGeneration | null, host: HostManifest | null) {
  const {settings, acquisition} = input, hosted = host?.games[settings.gameId];
  return resolveEffectiveMusicMode({audio: settings.context.musicAvailability.audio,
    midiAvailable: PRODUCT_GAMES[settings.gameId].musicCapabilities.midi && hosted?.music.midi.supported !== false,
    importServer: host?.shared.resourceMode === 'import', remoteOggAdvertised: !!hosted?.music.ogg,
    remoteRevision: acquisition.getMetadata().releaseCatalog?.games[settings.gameId]?.revision ?? null,
    installed: generation ? {revision: generation.descriptor.revision, oggFileIds: componentFileIds(generation.descriptor, 'ogg'), files: generation.files} : null,
    requested: settings.musicPreference, explicit: settings.musicPreferenceExplicit});
}
/** Original app 4163–4198. Room timing is supplied by the validated room owner,
 * never recomputed, filled with guesses, or inferred from a Replay. */
export function gameRuntimeOptions(input: GamePreparationInput, language: string, music: MusicMode, host: HostManifest | null): RuntimeConfigureOptions {
  const {settings, multiplayer} = input, {gameId: game, options} = settings, product = PRODUCT_GAMES[game];
  const isMultiplayer = isMultiplayerProductId(input.productId), features = host?.games[game]?.features;
  if (isMultiplayer && !multiplayer) throw new Error('Multiplayer launch requires a room, Replay or game-check intent');
  if (!isMultiplayer && multiplayer) throw new Error('A single-player Runtime cannot use multiplayer launch options');
  return {limitPresentationTo60: !product.support.highRefreshRate || options.frameLimit60Enabled,
    touchEnabled: options.touchEnabled, touchMovementMode: options.touchMovementMode, touchSensitivity: options.touchSensitivity,
    touchFocusMode: options.touchFocusMode, doubleTapBombEnabled: options.doubleTapBombEnabled, alwaysHitbox: options.alwaysHitbox,
    oggDecodeMode: music === 'ogg-full' ? 'full' : 'stream',
    ...(!isMultiplayer && productFeatureAvailable(game, 'thprac', features)
      ? {thpracEnabled: options.thpracEnabled, thpracLocale: thpracLocaleForLanguage(language)} : {}),
    ...(productFeatureAvailable(game, 'focusHitbox', features) ? {focusHitboxEnabled: options.focusHitboxEnabled} : {}),
    ...('display' in product && product.display.faithBar ? {faithBarEnabled: options.faithBarEnabled} : {}),
    ...(isMultiplayer ? {multiplayerLocalPlayerVisibility: options.multiplayerLocalPlayerVisibility,
      ...(multiplayer?.kind === 'replay' ? {replayViewer: true} : {}),
      ...(multiplayer?.kind === 'preflight' && 'multiplayer' in product && 'preflightWithoutRoom' in product.multiplayer ? {multiplayerPreflight: true} : {}),
      ...(multiplayer?.kind === 'room' ? multiplayer.options : {})} : {}),
    ...(input.debugHarness ? {debugHarness: input.debugHarness} : {})};
}
async function finishPlan(input: GamePreparationInput, initial: RuntimePlan, guard: () => void): Promise<PreparedGamePlan> {
  const {settings, acquisition, translate: t} = input, metadata = acquisition.getMetadata(), host = metadata.hostManifest;
  let generation = initial.generation, music = effectiveMusic(input, generation, host), language = settings.language;
  const catalog = buildLanguageCatalog({languageOptions: host?.games[settings.gameId]?.languageOptions,
    legacyLanguages: host?.games[settings.gameId]?.languages, offlineEntries: settings.context.languages,
    generation, translate: t, priority: languagePriority});
  const entry = selectLanguageEntry(catalog, language);
  let runtimePack: PreparedLanguagePack = null;
  try {
    runtimePack = await prepareLanguagePack({game: settings.gameId, entry, baseUrl: input.baseUrl,
      signal: input.signal, translate: t, fetchImpl: acquisition.fetchImpl, onProgress: input.onProgress,
      onLanguageDownloadActivity: input.onLanguageDownloadActivity, network: acquisition.languageNetwork, ...input.language});
  } catch (error) {
    guard();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    language = 'ja';
    input.onTransferHide?.();
    input.onWarning?.(t('language.launchFallback', {language: entry?.title || entry?.id || t('language.fallbackName'), reason: preparationErrorText(error)}));
  }
  guard();
  ({generation, music} = await ensureOggStartup({generation, music, acquisition, signal: input.signal,
    downloadSignal: input.musicDownloadSignal, onMusicDownloadActivity: input.onMusicDownloadActivity,
    translate: t, onProgress: input.onProgress, onWarning: input.onWarning}));
  guard();
  if (music !== 'none') await input.prepareMidi(music);
  guard();
  const ids = generation && oggMusic(music) ? componentFileIds(generation.descriptor, 'ogg').filter(id => !!generation!.files[id]?.objectId) : [];
  const options = gameRuntimeOptions(input, language, music, host);
  const shared = sharedResources({game: settings.gameId, generation, host, language,
    thprac: settings.options.thpracEnabled, baseUrl: input.baseUrl, translate: t});
  const plan: RuntimePlan = {...initial, ...(generation && generation !== initial.generation ? {resourceGeneration: generation} : {}),
    configure: {music: musicTransport(music), resources: ids.length ? [] : remoteMusicResources(settings.gameId, music, host, input.baseUrl, t),
      runtimeResources: remoteRuntimeResources(generation, host, metadata.releaseCatalog, acquisition.catalogUrl, t), runtimePack, sharedResources: shared, options},
    ...(generation ? {resourceFileIds: packageResourceIds(generation)} : {}),
    ...(ids.length ? {localOgg: {fileIds: ids.slice(0, 2), fallbackToMidi: true}} : {}),
    launcherControls: {restartButtonEnabled: settings.options.restartButtonEnabled,
      thpracTouchControlsEnabled: settings.options.thpracTouchControlsEnabled, magnifierEnabled: settings.options.magnifierEnabled,
      touchControlOpacity: settings.options.touchControlOpacity, touchLayout: input.touchLayout ? structuredClone(input.touchLayout) : null}};
  const resource = runtimePack ? `${entry?.title || entry?.id || t('language.fallbackName')} ${t('settings.language')}`
    : `${music === 'ogg-stream' ? t('settings.music.oggStream') : music === 'ogg-full' ? t('settings.music.oggFull') : music === 'none' ? t('settings.music.none') : 'midi'} ${t('settings.music')}`;
  input.onStatus?.(t('runtime.preparingResources', {resource}));
  return {plan, language, music};
}
/** File operations stop at native ready. No update prompt, optional content,
 * configure command, gameplay or MIDI setup is performed. */
export async function prepareFilePlan(input: FilePreparationInput): Promise<RuntimePlan> {
  const acquired = await input.acquisition.acquire(requestFor(input, false)); checkPreparationAbort(input.signal);
  const plan = {...identityPlan(input, acquired), fileOnly: true};
  input.onRuntimePlan?.(structuredClone(plan)); checkPreparationAbort(input.signal); return plan;
}
function applyNativeMusicResult(result: PreparedGamePlan, snapshot: RuntimeSnapshot, input: GamePreparationInput) {
  if (snapshot.musicWarning) {input.onTransferHide?.(); input.onWarning?.(snapshot.musicWarning);}
  if (snapshot.music === 'midi' && result.music !== 'midi') {
    result.music = 'midi'; result.plan = {...result.plan, configure: {...result.plan.configure, music: 'midi'}}; delete result.plan.localOgg;
  }
}
/** Main 1048–1090 uses the same ready→resources→launch chain as Play, but
 * the exclusive game-check owner confirms a frame and retires without sync.
 * Its short-lived snapshot subscription only starts post-ACK optional work;
 * Runtime remains the one native message/input/save owner. */
export async function prepareGameCheck(input: GamePreparationInput & {
  runtime: RuntimeService; signal: AbortSignal; multiplayer: {kind: 'preflight'};
}): Promise<PreparedGamePlan> {
  const acquired = await input.acquisition.acquire(requestFor(input, true)); checkPreparationAbort(input.signal);
  const initial = identityPlan(input, acquired);
  input.onRuntimePlan?.(structuredClone(initial)); checkPreparationAbort(input.signal);
  let prepared: PreparedGamePlan | null = null, epoch: number | null = null, backgroundStarted = false;
  const unsubscribe = input.runtime.subscribe(() => {
    const snapshot = input.runtime.getSnapshot();
    if (backgroundStarted || !prepared || epoch == null || snapshot.epoch !== epoch || !snapshot.launched) return;
    backgroundStarted = true;
    void startPreparedGameBackground({input, prepared, epoch,
      deferredUpdate: acquired.kind === 'managed' ? acquired.deferredUpdate : null}).catch(error => input.onBackgroundError?.(error));
  });
  try {
    await input.runtime.checkMultiplayer(initial, input.signal, snapshot => {
      if (!prepared) throw new Error('Game check did not complete its native-ready continuation');
      applyNativeMusicResult(prepared, snapshot, input);
    }, async value => {
      epoch = value;
      const guard = () => {checkPreparationAbort(input.signal); if (input.runtime.getSnapshot().epoch !== value) throw new Error(input.translate('runtime.offlineReplaced'));};
      guard(); prepared = await finishPlan(input, initial, guard); guard(); return prepared.plan;
    });
    if (!prepared) throw new Error('Game check did not prepare resources');
    return prepared;
  } finally {unsubscribe();}
}
/** Main app 4114–4288: DATA and native ready first, then optional language,
 * first-two-track OGG barrier, MIDI, configure and local FS writes. Root still
 * owns the actual Launch intent and its first-frame policy. */
export async function prepareGame(input: GamePreparationInput & {runtime: RuntimeService}): Promise<PreparedGame> {
  if (!input.runtime.prepareWithReady) throw new Error('Game preparation requires the native-ready Runtime continuation');
  if (input.multiplayer?.kind === 'preflight') throw new Error('Use the exclusive Runtime game-check owner for preflight');
  const acquired = await input.acquisition.acquire(requestFor(input, true)); checkPreparationAbort(input.signal);
  const initial = identityPlan(input, acquired);
  input.onRuntimePlan?.(structuredClone(initial)); checkPreparationAbort(input.signal);
  let prepared: PreparedGamePlan | null = null;
  const runtimeSnapshot = await input.runtime.prepareWithReady(initial, async epoch => {
    const guard = () => {checkPreparationAbort(input.signal); if (input.runtime.getSnapshot().epoch !== epoch) throw new Error(input.translate('runtime.offlineReplaced'));};
    guard(); prepared = await finishPlan(input, initial, guard); guard(); return prepared.plan;
  }, input.signal);
  checkPreparationAbort(input.signal);
  if (!prepared || runtimeSnapshot.epoch == null) throw new Error('Runtime did not complete its native-ready continuation');
  const result = prepared as PreparedGamePlan;
  applyNativeMusicResult(result, runtimeSnapshot, input);
  let background: Promise<void> | null = null;
  return {...result, runtimeSnapshot, startBackground() {
    if (background) return background;
    const snapshot = input.runtime.getSnapshot();
    if (snapshot.epoch !== runtimeSnapshot.epoch || !snapshot.launched) return Promise.reject(new Error('Launch this prepared Runtime before starting background resources'));
    background = startPreparedGameBackground({input, prepared: result, epoch: runtimeSnapshot.epoch!,
      deferredUpdate: acquired.kind === 'managed' ? acquired.deferredUpdate : null});
    return background;
  }};
}
