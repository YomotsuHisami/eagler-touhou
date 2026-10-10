import {DEFAULT_PRODUCT_ID, DEFAULT_MULTIPLAYER_PRODUCT_ID, PRODUCT_IDS, PRODUCT_GAMES, createLocalProductManifest, productEnabledForBuild, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {HostManifest} from '../../src/contracts/host-manifest.mts';
import {detectUiLocale, isUiMessageKey, UI_LOCALE_STORAGE_KEY, type UiLocale} from '../../src/launcher/i18n.mts';
import {replayImportAccept} from '../../src/launcher/replay-files.mts';
import {discouragedBrowserId} from '../../src/launcher/browser-support.mts';
import {createMultiplayerIdentityStore, multiplayerMemberId} from '../../src/launcher/multiplayer-identity.mts';
import {createMultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {buildMultiplayerDiagnosticRelayUrl} from '../../src/launcher/multiplayer-relay-url.mts';
import {createNetworkDiagnosticsModel} from '../components/directory/network-diagnostics-model';
import {createLobbyDirectory} from '../services/lobby-directory';
import {translate, type Translate} from '../i18n';
import {createGameSettingsModel, settingsChangeResetsRuntime, type SettingsSnapshot} from '../models/game-settings';
import {createTouchLayoutModel, type TouchLayoutOrientation} from '../models/touch-layout';
import {createDecisionStore} from '../models/decisions';
import {createTransferModel} from '../models/transfer';
import {createNetworkActivityTracker} from '../../src/launcher/network-activity.mts';
import {createGameDataImportModel} from '../models/game-data-import';
import {readCurrentPackageGeneration} from '../../package/package-store.mjs';
import {roomCodeFromUrl, resolveRoomInvite, routedProductFromUrl} from '../../src/launcher/route-state.mts';
import {createStartupErrorModel} from '../models/startup-error';
import {createFeedbackModel} from '../models/feedback';
import {createRuntimeDiagnostics} from '../models/runtime-diagnostics';
import {createGameplayNetwork} from '../models/gameplay-network';
import {createNetplayCalibration} from '../models/netplay-calibration';
import {createTitleNetwork} from '../models/title-network';
import {describeBrowserEnvironment} from '../../src/launcher/runtime-diagnostics-model.mts';
import {createSitePreferencesModel, bindSitePreferencesToDocument} from '../models/site-preferences';
import {createReplayModel, type ReplayModel} from '../models/replays';
import {createMetadataService} from '../services/metadata';
import {createPackageAcquisition} from '../services/package-acquisition';
import {prepareFilePlan, prepareGame, prepareGameCheck, type MultiplayerPreparation, type GamePreparationInput} from '../services/game-preparation';
import {createPreparationNetwork} from '../services/preparation-network';
import {createRoomPreparation} from '../services/room-preparation';
import {createRoomSession, type RoomSession} from './room-session';
import type {RoomLaunchContext, RoomOperationContext} from '../services/multiplayer-room';
import {isGameDataAcquisitionFailure} from '../services/game-data-acquisition';
import {createRuntimeService, RuntimeSessionSupersededError, type RuntimeService, type RuntimeSnapshot} from '../services/runtime';
import {createExternalMidiPort} from '../services/external-midi';
import {createMidiBridge} from '../services/midi-bridge';
import {createTouchNativePorts} from '../services/touch-native';
import {createStartupController} from '../services/startup';
import {createLocalPackageMaintenance} from '../services/local-package-maintenance';
import {createMetadataRetry} from '../services/metadata-retry';
import {createAppShellService, type AppShellOptions} from '../services/app-shell';
import {createBrowserPorts} from '../services/browser-ports';
import {createFileActions, type ImportFileKind} from '../services/files';
import {errorText} from '../services/error-text';
import type {SettingsActions} from '../components/settings/types';
import type {InformationDialogId, HostSelection, SurfaceContext, Surface} from '../navigation/surface-navigation';

export interface BrowserNavigationPorts {
  hasSelection: boolean;
  applyHostSelection(selection: HostSelection): void;
  syncSelectionFromRoute(): ProductId | null;
  openPlayer(product: ProductId): void;
  openDirectory(product: ProductId): void;
  closeSurface(): void;
  completeRuntimeClose(context?: {titleOverlayWasOpen?: boolean}): void;
  openInfoDialog(id: InformationDialogId): void;
  closeInfoDialog(id?: InformationDialogId): void;
  selectLobbyProduct(product: ProductId): void;
  navigateToRoom(url: string): void;
  setLocaleAddress(locale: UiLocale): void;
  restoreRoomRoute(input: {product: ProductId; code: string; fromDirectory: boolean}): void;
  enterRoomRoute(input: {product: ProductId; code: string}): void;
  settleRoomInvite(): void;
  leaveTitleRoomRoute(baseProduct: ProductId): void;
  leaveRoomRoute(input: {product: ProductId; fromDirectory: boolean; message?: string}): 'options' | 'directory';
  closeRoomPanel(): void;
  closeRoomSettings(): void;
}
export interface BrowserSessionSnapshot {
  locale: UiLocale;
  runtime: RuntimeSnapshot | null;
  playerOpen: boolean;
  touchHelpOpen: boolean;
  activity: number;
  metadataRevision: number;
  startupError: unknown | null;
  roomLaunchStage: 'runtime' | 'path' | null;
  replayViewer: boolean;
  th09NetworkOverlayOpen: boolean;
  bootTouchPreview: 'touch' | 'touch-hud' | null;
  bootTouchPreviewImage: string | undefined;
}
/** One document owner. Construction is browser-only and intentionally separate
 * from React render. The permanent iframe is attached once by its callback ref. */
export function createBrowserSession({document, window, appShellDeployment}: {document: Document; window: Window; appShellDeployment?: AppShellOptions['deployment']}) {
  const baseUrl = new URL('./', window.location.href).href;
  let storage: Storage | null = null;
  try {storage = window.localStorage;} catch {}
  const mobile = (window.navigator as Navigator & {userAgentData?: {mobile?: boolean}}).userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent) || window.navigator.maxTouchPoints > 1 && /Macintosh/i.test(window.navigator.userAgent);
  const primaryTouchPointer = window.matchMedia('(pointer: coarse)');
  const preferTouchSettings = () => mobile || primaryTouchPointer.matches;
  const audio = 'AudioContext' in window || 'webkitAudioContext' in window;
  const listeners = new Set<() => void>();
  let snapshot: BrowserSessionSnapshot = Object.freeze({locale: window.location.pathname.endsWith('/en.html') ? 'en' : detectUiLocale(), runtime: null, playerOpen: false, touchHelpOpen: false, activity: 0, metadataRevision: 0, startupError: null, roomLaunchStage: null, replayViewer: false, th09NetworkOverlayOpen: false, bootTouchPreview: null, bootTouchPreviewImage: undefined});
  let helpSeen = false; try {helpSeen = storage?.getItem('eagler-touch-help-seen-v8') === '1';} catch {}
  let touchFireEnabled = true;
  const touchFireState = {getEnabled: () => touchFireEnabled, setEnabled(value: boolean) {touchFireEnabled = value;}};
  let roomReturnTimer: number | null = null, pendingRoomReturnProduct: ProductId | null = null;
  let playerOrientationPending = false;
  let playerRelayout: (() => Promise<boolean>) | null = null;
  let disposed = false, navigation: BrowserNavigationPorts | null = null;
  let pendingHostSelection: HostSelection | null = null;
  let appliedHost: HostManifest | null = null;
  let runtime: RuntimeService | null = null, frame: HTMLIFrameElement | null = null;
  let replays: ReplayModel | null = null, files: ReturnType<typeof createFileActions> | null = null;
  let midi: ReturnType<typeof createMidiBridge> | null = null;
  let diagnostics: ReturnType<typeof createRuntimeDiagnostics> | null = null;
  let gameplayNetwork: ReturnType<typeof createGameplayNetwork> | null = null;
  let roomSession: RoomSession | null = null;
  let activeSettings: SettingsSnapshot | null = null;
  let invalidatedSettingsEpoch: number | null = null;
  let launchAbort: AbortController | null = null, launchPending: Promise<void> | null = null;
  let updateAbort: AbortController | null = null, musicAbort: AbortController | null = null, updating = false, downloadingMusic = false, downloadingPackage = false, downloadingLanguage = false;
  let fileDownload: {controller: AbortController; ownsPresentation(): boolean} | null = null;
  let fileRuntimePresentation: (() => boolean) | null = null;
  let appShell: ReturnType<typeof createAppShellService> | null = null;
  let blockingDownload: {label: string; cancel(): Promise<void>} | null = null;
  let unsubscribeRuntime: (() => void) | null = null;
  const temporaryFiles = new Map<ProductId, number>();
  // A repeated open is a new presentation intent even if Player was already open.
  // Completion guards retain identity after launch/preparation busy flags settle.
  let playerIntentRevision = 0;
  function publish(patch: Partial<BrowserSessionSnapshot>) {
    if (disposed) return;
    if (patch.playerOpen === true) playerIntentRevision++;
    snapshot = Object.freeze({...snapshot, ...patch}); for (const listener of listeners) listener(); appShell?.notifyActivityChanged();
  }
  const t: Translate = (key, params) => translate(snapshot.locale, key, params);
  const stringTranslate = (key: string, params?: Record<string, string | number>) => {
    if (!isUiMessageKey(key)) throw new Error(`Unknown main translation key: ${key}`);
    return t(key, params);
  };
  const feedback = createFeedbackModel(), decisions = createDecisionStore();
  feedback.translatedStatus(() => t('status.selectGame'));
  const calibration = createNetplayCalibration({timers: window, userAgent: window.navigator.userAgent});
  function retireChangedSettings() {
    const owner = runtime, current = owner?.getSnapshot();
    if (!owner || !current || invalidatedSettingsEpoch === null) return;
    if (current.epoch !== invalidatedSettingsEpoch || current.launched) {invalidatedSettingsEpoch = null; return;}
    // The sole file owner finishes its transaction before a cold configuration
    // is retired. Never add a second writer or clear a saving game underneath it.
    if (current.fileOperationBusy || current.phase === 'saving' || current.phase === 'launching') return;
    invalidatedSettingsEpoch = null;
    try {owner.cancel(); gameData.clear(); transfer.hide(); midi?.reset();}
    catch (error) {reportError(error);}
  }
  const settings = createGameSettingsModel({storage, onChange: change => {
    if (!settingsChangeResetsRuntime(change)) return;
    if (change.reason === 'sharing') {const key = change.current.shareSingleplayerSettings ? 'status.shareSettings' : 'status.separateSettings'; feedback.translatedStatus(() => t(key));}
    if (!change.current.multiplayer && change.reason === 'music') {
      const mode = change.current.music;
      feedback.status(t('status.musicMode', {music: mode === 'midi' ? 'midi' : t(mode === 'ogg-stream' ? 'settings.music.oggStream' : mode === 'ogg-full' ? 'settings.music.oggFull' : 'settings.music.none')}));
    }
    if (!change.current.multiplayer && change.reason === 'language') {
      const entry = change.current.context.languages.find(value => value.id === change.current.language);
      feedback.status(t('status.selectedLanguage', {language: entry?.title || entry?.id || t('language.fallbackName')}));
    }
    if (!runtime) return;
    const current = runtime.getSnapshot();
    if (current.epoch === null || current.launched) return;
    invalidatedSettingsEpoch = current.epoch;
    launchAbort?.abort(new RuntimeSessionSupersededError()); fileDownload?.controller.abort(new RuntimeSessionSupersededError());
    queueMicrotask(retireChangedSettings);
  }});
  const touchLayout = createTouchLayoutModel({storage}); touchLayout.hydrate();
  const preferences = createSitePreferencesModel({storage});
  const unbindPreferences = bindSitePreferencesToDocument(preferences, { windowObj: window});
  const ports = createBrowserPorts({document, window, baseUrl});
  const startup = createStartupController({document, window, baseUrl});
  const startupError = createStartupErrorModel({translate: t, launched: () => runtime?.getSnapshot().launched === true, copyText: ports.copyText, toast: feedback.toast});
  const transfer = createTransferModel({translate: t,
    context: () => ({epoch: runtime?.getSnapshot().epoch ?? null, launched: runtime?.getSnapshot().launched === true,
      iosWebKitTouch: /iPad|iPhone|iPod/i.test(window.navigator.userAgent) || /Macintosh/i.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1}),
    frames: {request: callback => window.requestAnimationFrame(callback), cancel: id => window.cancelAnimationFrame(id)},
    ports: {retryMusic: timeout => requiredRuntime().send('retry-music', {}, timeout),
      cancelDownload: async () => {if (fileDownload?.ownsPresentation()) fileDownload.controller.abort(new DOMException('已取消下载', 'AbortError')); else if (updating) updateAbort?.abort(); else if (downloadingMusic) musicAbort?.abort(); else if (downloadingPackage || downloadingLanguage) launchAbort?.abort(new DOMException('已取消下载', 'AbortError')); else if (blockingDownload) await blockingDownload.cancel(); else launchAbort?.abort(new DOMException('已取消下载', 'AbortError'));},
      playerStatus: feedback.playerStatus, toast: feedback.toast, noteGameDataTransfer: message => gameData.noteTransfer(message)},
  });
  const network = createNetworkActivityTracker({fetchImpl: window.fetch.bind(window), onChange: transfer.networkSnapshot});
  const metadata = createMetadataService({baseUrl, storage, indexedDBFactory: window.indexedDB,
    translate: (locale, key, params) => {if (!isUiMessageKey(key)) throw new Error(`Unknown main translation key: ${key}`); return translate(locale === 'en' ? 'en' : 'zh-CN', key, params);},
    webAudioAvailable: audio, webMidiAvailable: 'requestMIDIAccess' in window.navigator, mobile: preferTouchSettings(), locale: () => snapshot.locale,
    testBuild: new URL(window.location.href).searchParams.has('test')});
  function settingsContext(product: ProductId, locale: string) {const room = roomSession?.service.getSnapshot(); return {...metadata.settingsContext(product, locale), mobile: preferTouchSettings(), forbidUnlimitedMovement: !!room?.room?.disableCheatMovement && room.seat != null};}
  const entryUrl = new URL(window.location.href), directoryEntry = /\/lobby(?:\.html)?\/?$/.test(entryUrl.pathname);
  const rawInitialProduct = directoryEntry ? null : routedProductFromUrl(entryUrl, new Set(PRODUCT_IDS));
  const initialProduct = rawInitialProduct && productEnabledForBuild(rawInitialProduct, entryUrl.searchParams.has('test')) ? rawInitialProduct : DEFAULT_PRODUCT_ID;
  settings.hydrate(settingsContext(DEFAULT_PRODUCT_ID, snapshot.locale));
  if (initialProduct !== DEFAULT_PRODUCT_ID) settings.hydrate(settingsContext(initialProduct, snapshot.locale));
  // Main9742: one boot-only, non-persisted preview write after routed preferences
  // and before the first real Host reread. It opens no Runtime/history/fullscreen.
  const touchPreview = directoryEntry ? null : entryUrl.searchParams.get('preview');
  if (touchPreview === 'touch' || touchPreview === 'touch-hud') {
    settings.applyBootTouchPreview();
    const game = PRODUCT_GAMES[gameIdForProduct(initialProduct)];
    const artwork = 'cardArtwork' in game && game.cardArtwork ? `url(${JSON.stringify(new URL(`assets/${game.cardArtwork}`, baseUrl).href)})` : 'none';
    publish({bootTouchPreview: touchPreview, bootTouchPreviewImage: artwork, playerOpen: true, touchHelpOpen: touchPreview === 'touch'});
  }
  const syncTouchSettingsOrder = () => settings.setTouchSettingsPriority(preferTouchSettings());
  primaryTouchPointer.addEventListener('change', syncTouchSettingsOrder);
  const unsubscribeMetadata = metadata.subscribe(() => {
    const current = metadata.getSnapshot();
    if (current.hostManifest && !current.hostManifestError && current.hostManifest !== appliedHost) {
      const firstHost = appliedHost === null, host = current.hostManifest;
      const previousProduct = settings.getSnapshot()!.context.productId;
      let product = previousProduct;
      if (!Object.hasOwn(host.games, gameIdForProduct(product))) {
        const fallback = Object.keys(PRODUCT_GAMES).find(game => Object.hasOwn(host.games, game)) as ProductId | undefined;
        if (!fallback) throw new Error('Host Manifest 没有可用游戏');
        product = fallback;
        settings.restoreHostPreferences(settingsContext(product, snapshot.locale));
        publish({replayViewer: false});
      }
      if (firstHost && !runtime?.getSnapshot().launched) settings.restoreHostPreferences(settingsContext(product, snapshot.locale));
      appliedHost = host;
      localPackageMaintenance.schedule();
      const hadSelection = pendingHostSelection?.hasSelection ?? navigation?.hasSelection ?? (!!rawInitialProduct && productEnabledForBuild(rawInitialProduct, entryUrl.searchParams.has('test')));
      pendingHostSelection = {productId: product, hasSelection: hadSelection && current.products.includes(product)};
      if (navigation) {navigation.applyHostSelection(pendingHostSelection); pendingHostSelection = null;}
      if (roomSession?.service.getSnapshot().room && host.shared.netplayRelay) roomSession.service.reconnect();
    }
    diagnostics?.refresh();
    publish({metadataRevision: snapshot.metadataRevision + 1});
  });
  const localManifest = createLocalProductManifest();
  const localPackageMaintenance = createLocalPackageMaintenance({
    getGames: () => metadata.getSnapshot().hostManifest?.games ?? localManifest.games,
    origin: window.location.origin, onInstalled: metadata.acceptInstalledHint,
    onHydrated: () => publish({metadataRevision: snapshot.metadataRevision + 1}),
    scheduler: {requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id),
      setTimer: callback => window.setTimeout(callback, 0), clearTimer: id => window.clearTimeout(id)},
  });
  const preparationNetwork = createPreparationNetwork({foreground: network, baseUrl, translate: t, fetchImpl: window.fetch.bind(window)});
  const acquisition = createPackageAcquisition({metadata, baseUrl, translate: t, fetchImpl: window.fetch.bind(window), network: preparationNetwork,
    requestPersistence: async () => {try {await window.navigator.storage?.persist?.();} catch {}}});
  let sessionStorage: Storage | null = null; try {sessionStorage = window.sessionStorage;} catch {}
  const identity = createMultiplayerIdentityStore({persistentStorage: storage, sessionStorage});
  const sessions = createMultiplayerRoomSessionStore({storage: sessionStorage});
  const directory = createLobbyDirectory({
    loadHostManifest: async signal => {const response = await window.fetch(new URL('host-manifest.json', baseUrl), {cache: 'no-store', signal}); if (!response.ok) throw new Error(String(response.status)); return response.json();},
    createSocket: url => new WebSocket(url), memberId: multiplayerMemberId,
    identity, sessions, sessionStorage, translate: t,
    launcherUrl: () => new URL(snapshot.locale === 'en' ? 'en.html' : './', baseUrl).href,
    navigateToRoom: url => requiredNavigation().navigateToRoom(url),
    selectedProduct: new URL(window.location.href).searchParams.get('game') ?? undefined,
    onSelectedProductNormalized: product => requiredNavigation().selectLobbyProduct(product),
  });
  const networkDiagnostics = createNetworkDiagnosticsModel({ translate: stringTranslate,
    getRelayUrl: () => {const host = /\/lobby(?:\.html)?\/?$/.test(window.location.pathname) ? directory.getSnapshot().hostManifest : metadata.getSnapshot().hostManifest; const relay = host?.shared.netplayRelay; return relay ? buildMultiplayerDiagnosticRelayUrl(relay) : '';},
    getFallbackIceServers: () => [{urls: ['stun:stun.cloudflare.com:3478']}]});
  const nativeTouch = createTouchNativePorts({document, screen: window.screen, mobile, translate: t});
  const playerGestureTypes = ['contextmenu', 'selectstart', 'dragstart', 'gesturestart', 'gesturechange', 'gestureend'];
  const preventPlayerBrowserGesture = (event: Event) => {
    const player = document.getElementById('player'), target = event.target;
    if (!player?.classList.contains('open') || target instanceof Element && target.closest('#gameDataLinkWindow')) return;
    if (target === player || target instanceof Node && player.contains(target)) event.preventDefault();
  };
  for (const type of playerGestureTypes) document.addEventListener(type, preventPlayerBrowserGesture, {capture: true, passive: false});
  function requiredRuntime() {if (!runtime) throw new Error('Launcher Runtime frame is not attached'); return runtime;}
  function requiredNavigation() {if (!navigation) throw new Error('Launcher Router is not attached'); return navigation;}
  function reportError(error: unknown) {if (error instanceof RuntimeSessionSupersededError) return; feedback.status(errorText(error)); feedback.toast(errorText(error));}
  const externalMidi = createExternalMidiPort({settings, navigator: window.navigator, translate: t, feedback: feedback.toast,
    beforeExternalTakeover: () => midi?.resetSynth(),
    onConfigurationChange() {if (runtime && !runtime.getSnapshot().launched && runtime.getSnapshot().epoch !== null) runtime.cancel();}});
  async function activity<T>(operation: () => Promise<T>): Promise<T> {
    publish({activity: snapshot.activity + 1});
    try {return await operation();} finally {publish({activity: Math.max(0, snapshot.activity - 1)});}
  }
  function capturedSettings(product: ProductId) {
    const current = settings.getSnapshot();
    if (current?.context.productId === product) return current;
    // File operations keep their captured product without rehydrating another
    // visible product's shared settings or overwriting current edits.
    const capture = createGameSettingsModel({storage}); capture.hydrate(settingsContext(product, snapshot.locale));
    return capture.getSnapshot()!;
  }
  function captureFilePresentation(playerIntent = playerIntentRevision) {
    const launchOwnedAtCapture = !!launchAbort;
    return () => !disposed && !launchOwnedAtCapture && playerIntent === playerIntentRevision && !launchAbort;
  }
  async function prepareFiles(product: ProductId, options: {retireRunning?: boolean; ownsPresentation?: () => boolean} = {}) {
    const owner = requiredRuntime(), before = owner.getSnapshot(), game = gameIdForProduct(product);
    const variant = isMultiplayerProductId(product) ? 'multiplayer' : 'normal';
    // Imports retain their enqueue-time context across the Replay queue. Other
    // file tasks capture here. Progress, native UI and Cancel share this owner.
    const ownsPresentation = options.ownsPresentation ?? captureFilePresentation();
    if (before.ready && before.game === game && before.runtimeVariant === variant && !(options.retireRunning && before.launched)) return;
    if (before.epoch !== null && !await owner.close({decide: closeDecision})) throw new RuntimeSessionSupersededError();
    const controller = new AbortController();
    let preparationEpoch: number | null = null;
    const ownsCurrentEpoch = () => {
      const current = owner.getSnapshot();
      return current.epoch === null || current.epoch === preparationEpoch && current.game === game && current.runtimeVariant === variant;
    };
    const requireIdle = () => {if (owner.getSnapshot().epoch !== null) throw new RuntimeSessionSupersededError();};
    try {
      const plan = await prepareFilePlan({productId: product, settings: capturedSettings(product), acquisition, baseUrl, translate: t,
        signal: controller.signal, onAcquisitionActivity: active => {
          if (active) {requireIdle(); fileDownload = {controller, ownsPresentation}; if (ownsPresentation()) transfer.setCancellation(t('package.cancelDownload'));}
          else if (fileDownload?.controller === controller) {fileDownload = null; if (ownsCurrentEpoch() && ownsPresentation()) transfer.setCancellation(blockingDownload?.label ?? null);}
        },
        onRuntimePlan: plan => {requireIdle(); if (ownsPresentation()) {transfer.beginRuntime(plan); if (!plan.generation && plan.directPreloadHost) gameData.beginDirectDownload();}},
        onProgress: progress => {if (ownsCurrentEpoch() && ownsPresentation()) transfer.preparationProgress(progress);}});
      // Acquisition owns no native epoch. A newer Start may have acquired one
      // while it waited; never cancel that owner in this operation's catch.
      requireIdle();
      fileRuntimePresentation = ownsPresentation;
      const preparing = owner.prepare(plan, controller.signal);
      preparationEpoch = owner.getSnapshot().epoch;
      const ready = await preparing;
      if (ready.epoch !== owner.getSnapshot().epoch) throw new RuntimeSessionSupersededError();
      if (ready.epoch !== null) temporaryFiles.set(product, ready.epoch);
    } catch (error) {
      // A published-code retry may have advanced this prepare to a later epoch.
      // Runtime owns its failure reset; do not cancel an unproven current owner
      // or replace the original error if a later retry could not retire itself.
      if (error instanceof RuntimeSessionSupersededError || !ownsCurrentEpoch()) throw error;
      if (!owner.getSnapshot().launched) {try {owner.cancel();} catch {} if (ownsPresentation()) {gameData.clear(); transfer.hide();}}
      throw error;
    } finally {if (fileDownload?.controller === controller) {fileDownload = null; if (ownsCurrentEpoch() && ownsPresentation()) transfer.setCancellation(null);}}
  }
  async function releasePrepared(product: ProductId, expectedEpoch = temporaryFiles.get(product)) {
    const owner = requiredRuntime(), current = owner.getSnapshot();
    if (expectedEpoch === undefined || current.epoch !== expectedEpoch || current.game !== gameIdForProduct(product) || current.launched) return;
    if (await owner.close({decide: closeDecision})) temporaryFiles.delete(product);
  }
  async function closeDecision(error: unknown): Promise<'retry' | 'leave' | 'stay'> {
    const choice = await decisions.askDecision({message: t('dialog.saveSyncFailed', {reason: errorText(error)}),
      confirmText: t('action.retrySave'), secondaryText: t('action.leaveAnyway'), cancelText: t('action.stayInGame'), tone: 'danger'});
    return choice === 'confirm' ? 'retry' : choice === 'secondary' ? 'leave' : 'stay';
  }
  async function requestRuntimeClose({nativeExit = false}: {nativeExit?: boolean} = {}): Promise<boolean> {
    const owner = requiredRuntime();
    // Pending preparation cancellation is fenced before asynchronous acquisition
    // can publish another document. A launched writer remains intact until sync.
    if (!owner.getSnapshot().launched) launchAbort?.abort(new RuntimeSessionSupersededError());
    // Main native exit (including failure status) has no surviving sync receiver.
    // Only the authenticated event owner supplies this completed-engine flag.
    if (!await owner.close({decide: closeDecision, discardUnsaved: nativeExit})) return false;
    await nativeTouch.exitPlayerFullscreen().catch(() => {});
    gameData.clear(); if (titleNetwork.getSnapshot().open) roomSession?.service.resetRoomWithoutNavigation(); titleNetwork.close(false); transfer.hide(); startupError.close(); midi?.reset(); activeSettings = null; publish({playerOpen: false, touchHelpOpen: false, startupError: null, roomLaunchStage: null, replayViewer: false}); return true;
  }
  const gameData = createGameDataImportModel({acquisition, translate: t,
    getContext: () => ({product: settings.getSnapshot()?.context.productId ?? DEFAULT_PRODUCT_ID,
      roomCode: roomCodeFromUrl(window.location.href) || null, replayViewer: snapshot.replayViewer,
      runtimeReady: runtime?.getSnapshot().ready === true, launched: runtime?.getSnapshot().launched === true,
      playerOpen: snapshot.playerOpen, importServer: metadata.getSnapshot().hostManifest?.shared.resourceMode === 'import',
      fallback: metadata.getSnapshot().hostManifest?.shared.gameDataFallback ?? null}),
    ports: {
      pickFile: ({accept}) => ports.pickFile(accept), feedback, showGameDataTransfer: transfer.revealGameData,
      closePlayer: async () => {const titleOverlayWasOpen = titleNetwork.getSnapshot().open; if (!await requestRuntimeClose()) return false; requiredNavigation().completeRuntimeClose({titleOverlayWasOpen}); return true;},
      resetUnlaunchedRuntime: () => {if (runtime && !runtime.getSnapshot().launched && runtime.getSnapshot().epoch !== null) runtime.cancel();},
      openPlayer(product) {requiredNavigation().openPlayer(product); publish({playerOpen: true});},
      launchConfigured: () => configuredLaunch(settings.getSnapshot()?.context.productId ?? DEFAULT_PRODUCT_ID, {multiplayer: snapshot.replayViewer ? {kind: 'replay'} : roomSession?.service.getSnapshot().room ? {kind: 'room', options: roomSession.service.runtimeOptions()} : undefined}),
      roomPreparationForImport(continuation) {
        const owner = roomSession?.service, captured = owner?.getSnapshot();
        if (!owner || !captured?.room || (continuation?.kind === 'launch')) return null;
        const current = () => owner.getSnapshot().epoch === captured.epoch && owner.getSnapshot().room?.code === captured.room?.code;
        return {markImporting() {if (current()) owner.setImporting(true);}, cancelIfImporting() {if (current() && owner.getSnapshot().preparation?.status === 'importing') owner.cancelImport();}, async resume() {if (current()) {owner.setImporting(false); await owner.prepareResources();}}};
      },
      beginBlockingDownload({label, onCancel}) {
        const operation = {label, async cancel() {if (blockingDownload !== operation) return; blockingDownload = null; transfer.setCancellation(null); launchAbort?.abort(new DOMException('已取消下载', 'AbortError')); runtime?.postInput('network-cancel', {}); await onCancel();}};
        blockingDownload = operation; transfer.setCancellation(label);
        return {finish() {if (blockingDownload === operation) {blockingDownload = null; transfer.setCancellation(null);}}, cancel: operation.cancel};
      },
      onActivityChange: () => publish({}),
    },
  });
  const titleNetwork = createTitleNetwork({context: () => ({game: runtime?.getSnapshot().game ?? activeSettings?.gameId ?? 'th06',
    product: roomSession?.service.getSnapshot().product ?? activeSettings?.context.productId ?? DEFAULT_PRODUCT_ID,
    launched: runtime?.getSnapshot().launched === true, relayUrl: metadata.getSnapshot().hostManifest?.shared.netplayRelay ?? ''}),
    translate: stringTranslate, toast: feedback.toast, randomValues: value => {const bytes = new Uint32Array(value.length); window.crypto.getRandomValues(bytes); value.set(bytes); return value;},
    sendNetworkCancel: () => requiredRuntime().cancelTitleNetwork(),
    enterRoom(product, code, created) {if (isMultiplayerProductId(product)) roomSession!.service.enterRoom(product, code, created);},
    leaveRoom() {const game = runtime?.getSnapshot().game; roomSession?.service.resetRoomWithoutNavigation(); if (game) requiredNavigation().leaveTitleRoomRoute(game);},
  });
  const unsubscribeTitle = titleNetwork.subscribe(() => {const state = titleNetwork.getSnapshot(); document.getElementById('player')?.classList.toggle('th09-network-open', state.open); publish({th09NetworkOverlayOpen: state.open}); roomSession?.sync();});
  const fullscreenChanged = () => {publish({}); if (nativeTouch.isFullscreen()) void nativeTouch.probeOrientation().then(() => publish({}));};
  document.addEventListener('fullscreenchange', fullscreenChanged); document.addEventListener('webkitfullscreenchange', fullscreenChanged);
  const settingsActions: SettingsActions = {
    confirm: decisions.askConfirmation, externalMidi, reportError,
    showAppleNotice: () => requiredNavigation().openInfoDialog('appleRefreshDialog'),
    feedback(message, status) {if (message) feedback.toast(message); if (status) feedback.status(status);},
    file: (action, product) => activity(async () => {if (!files) throw new Error('File service is not attached'); await files.run(action, product);}),
  };
  function attachFrame(element: HTMLIFrameElement | null) {
    if (!element || element === frame) return;
    if (frame) throw new Error('Launcher cannot replace its live Runtime iframe');
    frame = element;
    runtime = createRuntimeService({frame: element, hostWindow: window, baseUrl, translate: t, network, worker: appShellDeployment ? appShell!.activeWorker() : null, onLocalResourceProgress: transfer.localProgress, onWarning: reportError, onEvent: (message, context) => {const ownsPresentation = !context.fileOnly || fileRuntimePresentation?.() !== false; if (ownsPresentation) transfer.runtimeEvent(message); if (ownsPresentation && message.event === 'ready') {gameData.finish(); feedback.playerStatus(t('runtime.readyStatus')); const selected = activeSettings ?? settings.getSnapshot(); if (selected) feedback.status(t('runtime.readyWithMusic', {game: selected.gameId.toUpperCase(), music: selected.music === 'midi' ? 'midi' : t(selected.music === 'none' ? 'settings.music.none' : selected.music === 'ogg-full' ? 'settings.music.oggFull' : 'settings.music.oggStream')}));}
      if (message.event === 'network-request') titleNetwork.open();
      if (message.event === 'runtime-info' && message.netplayTiming) {calibration.record(message.netplayTiming, runtime!.getSnapshot().epoch ?? 0); roomSession?.service.acceptMeasuredTiming(message.netplayTiming);}
      if (message.event === 'notice' && typeof message.message === 'string' && message.message) feedback.toast(message.message);
      if (ownsPresentation && message.event === 'error') feedback.playerStatus(errorText(message.error || t('runtime.startFailed')));
      if (ownsPresentation && message.event === 'exit') {feedback.playerStatus(t(message.status === 'success' ? 'runtime.gameExited' : 'runtime.gameExitedAbnormally')); const titleOverlayWasOpen = titleNetwork.getSnapshot().open; void requestRuntimeClose({nativeExit: true}).then(closed => {if (closed) requiredNavigation().completeRuntimeClose({titleOverlayWasOpen});});}}});
    const browser = describeBrowserEnvironment({userAgent: window.navigator.userAgent, platform: window.navigator.platform,
      userAgentDataPlatform: (window.navigator as Navigator & {userAgentData?: {platform?: string}}).userAgentData?.platform,
      mobile, brave: !!(window.navigator as Navigator & {brave?: unknown}).brave});
    diagnostics = createRuntimeDiagnostics({runtime, frame: element, window, storage, translate: stringTranslate,
      browser: () => browser.browser, testBuild: () => metadata.getSnapshot().hostManifest?.shared.testBuild === true,
      frameLimit60: () => activeSettings?.options.frameLimit60Enabled === true});
    gameplayNetwork = createGameplayNetwork({runtime, timers: window, english: () => snapshot.locale === 'en', translate: stringTranslate,
      context: () => {
        const control = runtime?.getLauncherControlContext(), config = control?.options;
        const room = roomSession?.service.getSnapshot();
        const product = activeSettings?.context.productId ?? DEFAULT_PRODUCT_ID;
        return {product, runtimeVariant: control?.runtimeVariant ?? 'normal', roomCode: room?.room?.code ?? null,
          player: config?.netplayPlayer ?? 0, playerCount: config?.netplayPlayerCount ?? 2,
          inputDelay: config?.netplayInputDelay ?? 0, adonisMode: config?.netplayAdonisMode ?? 0,
          adonisSupported: multiplayerConfigForProduct(product)?.inputTiming?.measuredStartup === true,
          replayViewer: snapshot.replayViewer, spectator: config?.netplaySpectator === true};
      }});
    midi = createMidiBridge({runtime, external: externalMidi, loadSynth: ports.loadSynth, webAudioAvailable: audio, translate: t,
      frame: element, window, document, playerOpen: () => snapshot.playerOpen});
    unsubscribeRuntime = runtime.subscribe(() => {const current = runtime!.getSnapshot(); if (calibration.getSnapshot().epoch !== (current.epoch ?? 0)) calibration.reset(current.epoch ?? 0); publish({runtime: current}); roomSession?.sync(); if (invalidatedSettingsEpoch !== null) queueMicrotask(retireChangedSettings);});
    replays = createReplayModel({runtime, prepareFiles, releasePrepared, translate: stringTranslate,
      prompt: (message, initial) => window.prompt(message, initial), confirm: decisions.askConfirmation,
      download: ports.download, toast: feedback.toast, afterPaint: ports.afterPaint,
      afterClose: () => {if (snapshot.playerOpen) frame?.focus({preventScroll: true});}});
    files = createFileActions({runtime, prepareFiles, releasePrepared, translate: stringTranslate, confirm: decisions.askConfirmation,
      pickFile: ports.pickFile, download: ports.download, feedback, replayMutations: replays.mutations,
      replayManager: {open: async product => {requiredNavigation().openInfoDialog('replayDialog'); await replays!.open(product);},
        refresh: () => replays!.refresh(), isOpen: () => replays!.getSnapshot().open, close: () => requiredNavigation().closeInfoDialog('replayDialog')},
      captureImportContext: product => {
        const playerIntent = playerIntentRevision;
        return {
          ownsPresentation: captureFilePresentation(playerIntent),
          assertRuntimeOwnership() {
            const current = requiredRuntime().getSnapshot();
            const ownsFileRuntime = current.epoch !== null && temporaryFiles.get(product) === current.epoch &&
              current.game === gameIdForProduct(product) && current.runtimeVariant === (isMultiplayerProductId(product) ? 'multiplayer' : 'normal') && !current.launched;
            if (disposed || playerIntent !== playerIntentRevision && current.epoch !== null && !ownsFileRuntime) throw new RuntimeSessionSupersededError();
          },
          complete() {
            if (disposed) return;
            // Main app6393–6397 hides Player only after retirement and Replay
            // refresh succeed. An awaited refresh cannot hide a newer Start.
            if (playerIntent === playerIntentRevision) publish({playerOpen: false});
            void metadata.refreshInstalled(gameIdForProduct(product));
          },
        };
      }});
    publish({runtime: runtime.getSnapshot()});
  }
  async function confirmInputWarnings() {
    const state = settings.getSnapshot(); if (!state) return false;
    const pureTouch = window.navigator.maxTouchPoints > 0 && !window.matchMedia('(any-pointer: fine)').matches;
    if (!state.options.touchEnabled && (pureTouch || mobile) && !await decisions.askConfirmation({message: t('touch.disabledInputWarning'), confirmText: t('touch.startAnyway')})) return false;
    const music = settings.getSnapshot()?.music;
    if (music === 'none' || music === 'midi') return decisions.askConfirmation({message: t(music === 'none' ? 'music.noneLaunchWarning' : 'music.midiLaunchWarning'), confirmText: t('music.startAnyway')});
    return true;
  }
  function preparationIntent(product: ProductId, multiplayer?: MultiplayerPreparation, externalSignal?: AbortSignal) {
    const owner = requiredRuntime(), clickSettings = capturedSettings(product), controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    launchAbort = controller; activeSettings = clickSettings; updateAbort = new AbortController(); musicAbort = new AbortController();
    startupError.close();
    const cancellation = () => {if (launchAbort === controller) {transfer.setCancellation(updating ? t('package.cancelUpdate') : downloadingMusic ? t('music.cancelDownload') : downloadingPackage || downloadingLanguage ? t('package.cancelDownload') : blockingDownload?.label ?? null); publish({});}};
    const input: GamePreparationInput & {runtime: RuntimeService; signal: AbortSignal} = {productId: product, settings: clickSettings, acquisition, baseUrl, translate: t,
      signal, multiplayer, updateSignal: updateAbort.signal, musicDownloadSignal: musicAbort.signal,
      onUpdateActivity: value => {if (launchAbort === controller) {updating = value; cancellation();}},
      onMusicDownloadActivity: value => {if (launchAbort === controller) {downloadingMusic = value; cancellation();}},
      onAcquisitionActivity: value => {if (launchAbort === controller) {downloadingPackage = value; cancellation();}},
      onLanguageDownloadActivity: value => {if (launchAbort === controller) {downloadingLanguage = value; cancellation();}},
      onTransferHide: transfer.hide, onLocalMusicFailure: transfer.localFailure, touchLayout: touchLayout.getSnapshot().saved, runtime: owner,
      onRuntimePlan: plan => {updating = false; transfer.beginRuntime(plan); if (!plan.generation && plan.directPreloadHost) gameData.beginDirectDownload();},
      prepareMidi: music => midi!.prepare(music), decideUpdate: value => decisions.askDecision(value),
      onProgress: transfer.preparationProgress, onWarning: feedback.toast, onStatus: feedback.playerStatus,
      onBackgroundError: (error, message) => {if (message) console.warn(message, error); else console.warn(error);}};
    return {owner, clickSettings, controller, input, finish() {if (launchAbort === controller) {launchAbort = null; updateAbort = null; musicAbort = null; updating = false; downloadingMusic = false; downloadingPackage = false; downloadingLanguage = false; transfer.setCancellation(null); publish({});}}};
  }
  async function configuredLaunch(product: ProductId, intent: {multiplayer?: MultiplayerPreparation; signal?: AbortSignal; awaitFirstFrame?: boolean; throwErrors?: boolean} = {}) {
    const operation = preparationIntent(product, intent.multiplayer, intent.signal), {owner, clickSettings, controller} = operation;
    try {
      if (owner.getSnapshot().epoch !== null && !await owner.close({decide: closeDecision})) return;
      const prepared = await prepareGame(operation.input);
      // Main publishes readiness and starts optional background work on ACK,
      // before the distinct first-frame wait used by room launch covers.
      let acknowledged = false;
      const onAcknowledged = () => {
        const current = owner.getSnapshot();
        if (acknowledged || disposed || controller.signal.aborted || current.epoch !== prepared.runtimeSnapshot.epoch || !current.launched) return;
        acknowledged = true; transfer.launchAcknowledged(); feedback.playerStatus(t('runtime.ready')); frame?.focus({preventScroll: true}); transfer.setCancellation(null);
        void prepared.startBackground().catch(error => {if (!disposed && owner.getSnapshot().epoch === current.epoch) reportError(error);});
      };
      const unsubscribe = owner.subscribe(onAcknowledged);
      try {await owner.launch({awaitFirstFrame: intent.awaitFirstFrame}); onAcknowledged();} finally {unsubscribe();}
    } catch (error) {
      if (error instanceof RuntimeSessionSupersededError || controller.signal.reason instanceof RuntimeSessionSupersededError) return;
      if (intent.throwErrors) throw error;
      if (await gameData.handleLaunchFailure(error)) return;
      publish({startupError: error}); startupError.show(error, `${clickSettings.gameId.toUpperCase()} / ${clickSettings.music === 'midi' ? 'midi' : t(clickSettings.music === 'none' ? 'settings.music.none' : clickSettings.music === 'ogg-full' ? 'settings.music.oggFull' : 'settings.music.oggStream')}`); feedback.playerStatus(errorText(error)); feedback.toast(errorText(error));
    } finally {operation.finish();}
  }
  async function showRoomPlayer(context: RoomOperationContext, fullscreen: boolean, allowHelp = false) {
    if (!context.isCurrent()) throw new RuntimeSessionSupersededError();
    activeSettings = capturedSettings(context.product); requiredNavigation().openPlayer(context.product);
    let touchHelpOpen = false; if (allowHelp && activeSettings.options.touchEnabled && !helpSeen) {helpSeen = true; touchHelpOpen = true; try {storage?.setItem('eagler-touch-help-seen-v8', '1');} catch {}}
    publish({playerOpen: true, touchHelpOpen, replayViewer: false, startupError: null});
    const player = document.querySelector<HTMLElement>('#player');
    if (!player) throw new Error('Launcher Player is not mounted');
    player.classList.add('open'); player.setAttribute('aria-hidden', 'false'); document.body.classList.add('player-active');
    if (fullscreen) {try {await nativeTouch.enterFullscreen(player);} catch (error) {feedback.toast(t('fullscreen.autoBlocked', {reason: errorText(error)}));}}
    if (!context.isCurrent()) throw new RuntimeSessionSupersededError();
  }
  async function launchRoom(context: RoomLaunchContext) {
    if (context.snapshot.seat != null && !await confirmInputWarnings()) return;
    if (!context.isCurrent()) throw new RuntimeSessionSupersededError();
    const ios = /iPad|iPhone|iPod/i.test(window.navigator.userAgent) || /Macintosh/i.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1;
    const fromTitle = snapshot.th09NetworkOverlayOpen;
    const cover = !fromTitle && !ios;
    if (fromTitle) {await requiredRuntime().sync(); if (!context.isCurrent()) throw new RuntimeSessionSupersededError(); titleNetwork.close(false); await requiredRuntime().close({discardUnsaved: true});}
    requiredNavigation().closeRoomPanel(); requiredNavigation().closeRoomSettings();
    publish({roomLaunchStage: cover ? 'runtime' : null});
    await showRoomPlayer(context, true, context.snapshot.seat != null);
    await configuredLaunch(context.product, {signal: context.signal, multiplayer: {kind: 'room', options: context.runtimeOptions}, awaitFirstFrame: cover, throwErrors: true});
    if (!context.isCurrent()) throw new RuntimeSessionSupersededError();
    if (cover) {publish({roomLaunchStage: 'path'}); await gameplayNetwork!.waitForGameplayPath({isCurrent: context.isCurrent});}
    publish({roomLaunchStage: null});
  }
  async function checkRoom(context: RoomOperationContext) {
    const owner = requiredRuntime();
    if (owner.getSnapshot().epoch !== null && !await owner.close({decide: closeDecision})) return;
    await showRoomPlayer(context, false); feedback.playerStatus(t('multiplayer.checkingGame'));
    const operation = preparationIntent(context.product, {kind: 'preflight'}, context.signal);
    try {
      await prepareGameCheck({...operation.input, multiplayer: {kind: 'preflight'}});
      if (context.isCurrent()) feedback.status(t('multiplayer.checkGamePassed'));
    } finally {operation.finish(); if (context.isCurrent()) {await nativeTouch.exitPlayerFullscreen().catch(() => {}); activeSettings = null; publish({playerOpen: false, roomLaunchStage: null});}}
  }
  async function closeRoomPlayerWithoutSync() {
    launchAbort?.abort(new RuntimeSessionSupersededError());
    await requiredRuntime().close({discardUnsaved: true}); await nativeTouch.exitPlayerFullscreen().catch(() => {});
    gameData.clear(); transfer.hide(); midi?.reset(); activeSettings = null;
    publish({playerOpen: false, touchHelpOpen: false, roomLaunchStage: null});
  }
  async function roomOperationFailed(error: unknown, kind: 'launch' | 'check', context: RoomOperationContext) {
    if (error instanceof RuntimeSessionSupersededError || !context.isCurrent()) return;
    const reason = errorText(error), owner = requiredRuntime();
    if (kind === 'check') {
      await closeRoomPlayerWithoutSync();
      if (isGameDataAcquisitionFailure(error)) gameData.beginManual({reason, kind: 'install-only'});
      else startupError.show(error, t('multiplayer.checkGame'));
      feedback.status(t('multiplayer.checkGameFailed', {reason})); return; // Room owner emits the original 4000 ms check toast once.
    }
    const cancelled = !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError' || /已取消下载/.test(reason);
    if (!owner.getSnapshot().launched && cancelled) {await closeRoomPlayerWithoutSync(); feedback.status(t('runtime.downloadCancelled')); return;}
    if (!owner.getSnapshot().launched && isGameDataAcquisitionFailure(error)) {
      publish({roomLaunchStage: null}); feedback.playerStatus(t('runtime.missingResourcesPlayer'));
      gameData.beginManual({reason, kind: 'launch'}); feedback.status(t('runtime.missingResourcesLauncher')); feedback.toast(reason); return;
    }
    if (snapshot.roomLaunchStage && snapshot.playerOpen) await closeRoomPlayerWithoutSync(); else publish({roomLaunchStage: null});
    feedback.status(reason); feedback.playerStatus(reason); feedback.toast(reason);
    const seat = roomSession?.service.getSnapshot().seat;
    startupError.show(error, seat == null ? t('runtime.multiplayerContext', {game: gameIdForProduct(context.product).toUpperCase()}) : t('runtime.multiplayerPlayerContext', {game: gameIdForProduct(context.product).toUpperCase(), player: seat + 1}));
  }
  function openReplayViewer(product: ProductId): Promise<void> {
    if (!isMultiplayerProductId(product) || launchPending || roomSession?.service.getSnapshot().launchBusy) return Promise.resolve();
    launchPending = activity(async () => {
      const owner = requiredRuntime(); if (owner.getSnapshot().launched) return;
      activeSettings = capturedSettings(product); requiredNavigation().openPlayer(product);
      let touchHelpOpen = false; if (activeSettings.options.touchEnabled && !helpSeen) {helpSeen = true; touchHelpOpen = true; try {storage?.setItem('eagler-touch-help-seen-v8', '1');} catch {}}
      publish({playerOpen: true, replayViewer: true, touchHelpOpen});
      try {
        await configuredLaunch(product, {multiplayer: {kind: 'replay'}, throwErrors: true});
        feedback.status(t('multiplayer.replayMenuOpened', {game: gameIdForProduct(product).toUpperCase()}));
      } catch (error) {
        if (error instanceof RuntimeSessionSupersededError) return;
        const reason = errorText(error);
        if (!owner.getSnapshot().launched && isGameDataAcquisitionFailure(error)) {
          feedback.playerStatus(t('runtime.missingResourcesPlayer')); gameData.beginManual({reason, kind: 'launch'});
          feedback.status(t('runtime.missingResourcesLauncher')); feedback.toast(reason);
        } else {startupError.show(error, t('multiplayer.replayContext', {game: gameIdForProduct(product).toUpperCase()})); feedback.toast(reason);}
      }
    }).finally(() => {launchPending = null; publish({});});
    return launchPending;
  }
  function launch(product: ProductId): Promise<void> {
    if (launchPending) return launchPending;
    product = navigation?.syncSelectionFromRoute() ?? settings.getSnapshot()?.context.productId ?? product;
    launchPending = activity(async () => {
      const owner = requiredRuntime();
      if (owner.getSnapshot().launched) {frame?.focus({preventScroll: true}); return;}
      if (isMultiplayerProductId(product)) {await roomSession!.service.launch(); return;}
      if (metadata.getSnapshot().hostManifest?.shared.resourceMode === 'import' && !(await readCurrentPackageGeneration(gameIdForProduct(product))).generation) {
        publish({startupError: null}); feedback.status(t('package.needImport')); gameData.beginImportRequired(); return;
      }
      if (!await confirmInputWarnings()) return;
      // Main9560–9569 reads business selection again after each awaited UI
      // boundary. A first Host may have replaced the provisional game while
      // its warning/fullscreen request was pending; the raw URL stays intact.
      product = settings.getSnapshot()?.context.productId ?? product;
      activeSettings = capturedSettings(product);
      requiredNavigation().openPlayer(product);
      let touchHelpOpen = false; if (activeSettings.options.touchEnabled && !helpSeen) {helpSeen = true; touchHelpOpen = true; try {storage?.setItem('eagler-touch-help-seen-v8', '1');} catch {}}
      publish({playerOpen: true, touchHelpOpen, startupError: null});
      const player = document.querySelector<HTMLElement>('#player');
      if (!player) throw new Error('Launcher Player is not mounted');
      player.classList.add('open'); player.setAttribute('aria-hidden', 'false'); document.body.classList.add('player-active');
      try {await nativeTouch.enterFullscreen(player);} catch (error) {feedback.toast(t('fullscreen.autoBlocked', {reason: errorText(error)}));}
      await configuredLaunch(settings.getSnapshot()?.context.productId ?? product);
    }).finally(() => {launchPending = null;});
    return launchPending;
  }
  document.documentElement.lang = snapshot.locale; document.documentElement.dataset.uiLocale = snapshot.locale;
  window.dispatchEvent(new CustomEvent('eagler-ui-locale-change', {detail: {locale: snapshot.locale}}));
  appShell = createAppShellService({baseUrl, deployment: appShellDeployment, serviceWorker: window.navigator.serviceWorker,
    secureContext: window.isSecureContext, translate: stringTranslate, online: () => window.navigator.onLine,
    reload: () => window.location.reload(), timers: window, fetchImpl: window.fetch.bind(window),
    activity: () => ({launched: runtime?.getSnapshot().launched === true, runtimeReady: runtime?.getSnapshot().ready === true,
      runtimeSessionActive: runtime?.getSnapshot().epoch != null, touchLayoutEditing: touchLayout.getSnapshot().isEditing,
      blockingOperation: !!blockingDownload || !!fileDownload || updating || downloadingMusic || downloadingPackage || downloadingLanguage, gameDataAttempt: !!gameData.getSnapshot().attempt,
      launchInFlight: snapshot.activity > 0 || !!launchPending || roomSession?.service.getSnapshot().launchBusy === true,
      decisionOpen: document.querySelector('dialog[open]') !== null, replayOpen: replays?.getSnapshot().open === true}),
  });
  const appShellOwner = appShell;
  const shellChanged = () => document.body.classList.toggle('app-shell-activation-pending', appShellOwner.getSnapshot().state.activationPending);
  const unsubscribeAppShell = appShellOwner.subscribe(shellChanged); shellChanged();
  const activityObserver = new MutationObserver(() => appShellOwner.notifyActivityChanged());
  activityObserver.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['open']});
  const unsubscribeTouchActivity = touchLayout.subscribe(() => {
    if (touchLayout.getSnapshot().isEditing && snapshot.bootTouchPreview) publish({bootTouchPreview: null, bootTouchPreviewImage: undefined, playerOpen: false, touchHelpOpen: false});
    appShellOwner.notifyActivityChanged();
  });
  const metadataRetry = createMetadataRetry({metadata, window, shell: appShellOwner,
    markBoot: phase => (window as Window & {__eaglerBoot?: {mark(value: string): void}}).__eaglerBoot?.mark(phase),
    onSettled: () => {if (!runtime?.getSnapshot().launched && navigation && !navigation.hasSelection) navigation.syncSelectionFromRoute(); publish({metadataRevision: snapshot.metadataRevision + 1});},
  });
  const roomPreparation = createRoomPreparation({acquisition, metadataReady: metadata.initialize, baseUrl, translate: t,
    activeWorker: () => appShellOwner.activeWorker()});
  roomSession = createRoomSession({document, window, storage, identity, sessions, memberId: multiplayerMemberId,
    createSocket: url => new WebSocket(url), relayUrl: () => metadata.getSnapshot().hostManifest?.shared.netplayRelay ?? '',
    settingsModel: settings, sitePreferences: preferences, runtime: () => runtime, replayViewer: () => snapshot.replayViewer,
    titleOverlayOpen: () => snapshot.th09NetworkOverlayOpen,
    settings: () => ({touchEnabled: settings.getSnapshot()?.options.touchEnabled === true, touchMovementMode: settings.getSnapshot()?.options.touchMovementMode ?? 'touch', mobileDevice: mobile, iceServers: [{urls: ['stun:stun.cloudflare.com:3478']}]}),
    setMovementMode: mode => settings.setOption('touchMovementMode', mode), decisions, translate: t, notify: feedback.toast,
    prepareResources: roomPreparation.prepare,
    preparationFailed(error) {if (isGameDataAcquisitionFailure(error)) gameData.beginManual({reason: errorText(error), kind: 'install-only'}); else feedback.toast(errorText(error), 4000);},
    beginManualImport: () => gameData.openManual(), launch: launchRoom, checkGame: checkRoom,
    canLaunchFromTitle: () => titleNetwork.getSnapshot().open, operationFailed: roomOperationFailed, isLaunched: () => runtime?.getSnapshot().launched === true,
    routes: {restore: input => requiredNavigation().restoreRoomRoute(input), enter: input => {requiredNavigation().enterRoomRoute(input); feedback.translatedStatus(() => t(input.created ? 'status.roomCreated' : 'status.roomJoined', {code: input.code}));},
      settleInvite: () => requiredNavigation().settleRoomInvite(), leave: input => {
        const destination = requiredNavigation().leaveRoomRoute(input);
        if (!input.message && destination === 'options') {
          pendingRoomReturnProduct = settings.getSnapshot()!.context.productId;
          if (roomReturnTimer !== null) window.clearTimeout(roomReturnTimer);
          roomReturnTimer = null;
          const reduced = preferences.getSnapshot().lessMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          document.body.classList.toggle('mp-room-returning', !reduced);
          if (!reduced) roomReturnTimer = window.setTimeout(() => {document.body.classList.remove('mp-room-returning'); roomReturnTimer = null;}, 180);
          publish({});
        }
        if (input.message) feedback.toast(input.message);
      }},
  });
  const room = roomSession;
  const unsubscribeRoom = room.service.subscribe(() => {
    const current = room.service.getSnapshot();
    settings.setMovementRestriction(!!current.room?.disableCheatMovement && current.seat != null);
    publish({});
  });
  function restoreRoomFromUrl(url: string): Promise<void> {
    const expected = resolveRoomInvite(url); if (!expected?.r) return Promise.resolve();
    const existing = room.service.getSnapshot();
    // Retained membership is independent of later Host business fallback.
    if (existing.room?.code === expected.r) return Promise.resolve();
    const businessProduct = settings.getSnapshot()!.context.productId;
    const selected = isMultiplayerProductId(businessProduct) ? businessProduct : DEFAULT_MULTIPLAYER_PRODUCT_ID;
    if (!disposed) {
      settings.hydrate(settingsContext(selected, snapshot.locale));
      room.service.restoreInvite(url, selected);
    }
    return Promise.resolve();
  }
  let initializationPromise: Promise<void> | null = null;
  function initialize() {
    if (initializationPromise) return initializationPromise;
    // Initial main room restoration is synchronous and precedes the first
    // asynchronous Host application; the metadata owner reconnects afterward.
    if (!directoryEntry) void restoreRoomFromUrl(window.location.href);
    localPackageMaintenance.schedule();
    initializationPromise = metadataRetry.initialize();
    return initializationPromise;
  }
  return {
    room, titleNetwork, calibration, networkDiagnostics, appShell: appShellOwner, baseUrl, storage, mobile, metadata, settingsContext, acquisition, directory, gameData, transfer, startupError, startup, settings, touchLayout, preferences, feedback, decisions, nativeTouch, settingsActions,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
    initialize, attachFrame, requestRuntimeClose, launch, openReplayViewer,
    restoreRoomFromUrl,
    requestRoomLeave: () => {if (titleNetwork.getSnapshot().open) titleNetwork.leave(); else room.service.leave();},
    async leaveRoom() {
      if (titleNetwork.getSnapshot().open) {titleNetwork.leave(); return;}
      if (snapshot.roomLaunchStage && snapshot.playerOpen) {launchAbort?.abort(new RuntimeSessionSupersededError()); await requiredRuntime().close({discardUnsaved: true}); await nativeTouch.exitPlayerFullscreen().catch(() => {}); activeSettings = null; publish({playerOpen: false, roomLaunchStage: null});}
      room.service.leave();
    },
    async copyRoomCode(code: string) {feedback.toast(await ports.copyText(code) ? t('status.roomCodeCopied') : t('status.roomCode', {code}));},
    bindNavigation(value: BrowserNavigationPorts) {navigation = value; if (pendingHostSelection) {value.applyHostSelection(pendingHostSelection); pendingHostSelection = null;} return () => {if (navigation === value) navigation = null;};},
    productAvailable: (product: ProductId) => metadata.getSnapshot().products.includes(product),
    reportProductSelection(product: ProductId, changed: boolean) {
      const title = PRODUCT_GAMES[gameIdForProduct(product)].title;
      feedback.translatedStatus(() => t(changed ? 'status.switchedProduct' : 'status.selectedProduct', {product: title}));
    },
    selectRouteProduct(product: ProductId, context?: SurfaceContext) {
      if (settings.getSnapshot()?.context.productId !== product || context === 'lobby') settings.hydrate(settingsContext(product, snapshot.locale), {resetDisclosure: context === 'lobby'});
    },
    settleRoomReturnPresentation(surface: Surface, product: ProductId | null) {
      if (!pendingRoomReturnProduct || surface === 'room' || surface === 'touch') return;
      const expected = pendingRoomReturnProduct; pendingRoomReturnProduct = null;
      if (surface !== 'options' || product !== expected) return;
      document.getElementById('libraryBack')?.focus({preventScroll: true});
      window.scrollTo({top: 0, left: 0, behavior: 'instant'});
      feedback.translatedStatus(() => t('status.roomLeft'));
    },
    getActiveSettings: () => activeSettings, touchFireState,
    openTouchHelp: () => publish({touchHelpOpen: true}),
    closeTouchHelp() {publish({touchHelpOpen: false}); if (document.activeElement !== frame) frame?.focus({preventScroll: true});},
    bindPlayerRelayout(value: () => Promise<boolean>) {playerRelayout = value; return () => {if (playerRelayout === value) playerRelayout = null;};},
    async switchPlayerOrientation(orientation: TouchLayoutOrientation) {
      if (!runtime?.getSnapshot().launched || playerOrientationPending || !nativeTouch.canSwitchOrientation()) return;
      playerOrientationPending = true;
      try {await nativeTouch.switchOrientation(orientation); if (!disposed) {feedback.toast(t('touch.orientationRequested', {orientation: t(orientation === 'landscape' ? 'touch.landscape' : 'touch.portrait')})); await playerRelayout?.();}}
      catch {if (!disposed) feedback.toast(t('touch.orientationFailed'));}
      finally {playerOrientationPending = false; publish({});}
    },
    async togglePlayerFullscreen() {try {if (nativeTouch.isFullscreen()) await nativeTouch.exitPlayerFullscreen(); else {const player = document.querySelector<HTMLElement>('#player'); if (player) await nativeTouch.enterFullscreen(player);}} catch (error) {feedback.playerStatus(t('fullscreen.switchFailed', {reason: errorText(error)}));}},
    getRuntime: () => runtime, getReplays: () => replays, getDiagnostics: () => diagnostics, getGameplayNetwork: () => gameplayNetwork,
    async chooseReplayFile(product: ProductId) {const file = await ports.pickFile(replayImportAccept); if (file) {if (!files) throw new Error('File service is not attached'); await activity(() => files!.importFile('replay', file, product));}},
    async warnDiscouragedBrowser(isCurrent: () => boolean = () => true): Promise<boolean> {
      let dismissed = false; try {dismissed = storage?.getItem('browser-warning-dismissed') === '1';} catch {}
      if (dismissed || !discouragedBrowserId(window.navigator.userAgent)) return !disposed && isCurrent();
      const choice = await decisions.askDecision({title: t('browserWarning.title'), message: t('browserWarning.message'),
        secondaryText: t('action.viewFaq'), confirmText: t('action.continueVisit'), hideCancel: true, variant: 'browser-warning'});
      if (disposed || !isCurrent()) return false;
      try {storage?.setItem('browser-warning-dismissed', '1');} catch {}
      if (choice === 'secondary') {window.location.href = new URL('faq.html', baseUrl).href; return false;}
      return true;
    },
    importFile: (kind: ImportFileKind, file: File, product: ProductId) => activity(async () => {if (!files) throw new Error('File service is not attached'); await files.importFile(kind, file, product);}),
    setLocale(locale: UiLocale) {try {storage?.setItem(UI_LOCALE_STORAGE_KEY, locale);} catch {} requiredNavigation().setLocaleAddress(locale); if (!runtime?.getSnapshot().launched) settings.restoreLocalePreferences(settingsContext(settings.getSnapshot()!.context.productId, locale)); publish({locale}); feedback.refreshLocale(); externalMidi.refreshLocale(t); document.documentElement.lang = locale; document.documentElement.dataset.uiLocale = locale; window.dispatchEvent(new CustomEvent('eagler-ui-locale-change', {detail: {locale}})); appShellOwner.refreshLocale(); diagnostics?.refresh(); gameplayNetwork?.refresh(); const canonical = document.querySelector<HTMLLinkElement>('link[rel=canonical]'); if (canonical) canonical.href = new URL(locale === 'en' ? 'en.html' : './', canonical.href).href;},
    reportError,
    async dispose() {
      if (disposed) return; disposed = true; launchAbort?.abort(); if (roomReturnTimer !== null) window.clearTimeout(roomReturnTimer); document.body.classList.remove('mp-room-returning'); for (const type of playerGestureTypes) document.removeEventListener(type, preventPlayerBrowserGesture, true); primaryTouchPointer.removeEventListener('change', syncTouchSettingsOrder); activityObserver.disconnect(); unsubscribeTouchActivity(); unsubscribeAppShell(); metadataRetry.dispose(); localPackageMaintenance.dispose(); appShellOwner.dispose(); document.body.classList.remove('app-shell-activation-pending'); unsubscribeRoom(); room.dispose(); networkDiagnostics.dispose(); metadata.dispose(); directory.dispose(); startup.dispose(); unsubscribeMetadata(); unbindPreferences();
      document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('webkitfullscreenchange', fullscreenChanged); unsubscribeTitle(); titleNetwork.dispose(); calibration.dispose(); gameData.dispose(); transfer.dispose(); startupError.dispose(); decisions.dispose(); feedback.dispose(); replays?.dispose(); unsubscribeRuntime?.(); diagnostics?.dispose(); gameplayNetwork?.dispose(); midi?.dispose(); externalMidi.dispose();
      await nativeTouch.dispose();
      if (runtime && frame?.isConnected === false) runtime.disposeDetachedFrame();
      listeners.clear();
    },
  };
}
export type BrowserSession = ReturnType<typeof createBrowserSession>;
