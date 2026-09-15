import { parseStoredGameDataPack } from "../../legacy/legacy-game-pack.mjs";
import { parsePackageZip } from "../../package/package-zip.mjs";
import { installPackageFromAcquisition, installParsedPackageZip } from "../../package/package-installer.mjs";
import { adaptLegacyGamePackToPackage } from "../../legacy/legacy-package-adapter.mjs";
import {
  migrateLegacyStoredImport,
} from "../../legacy/legacy-import-storage.mjs";
import { PACKAGE_DESCRIPTOR_SCHEMA } from "../../package/package-descriptor.mjs";
import { installPublishedPackage } from "../../package/package-launcher.mjs";
import { componentFileIds } from "../../package/package-generation.mjs";
import {
  garbageCollectPackageStore,
  readCurrentPackageGeneration,
  readPackageObject,
  releasePackageGeneration,
  retainPackageGeneration,
} from "../../package/package-store.mjs";
import {
  InstalledGameDataError,
  managedRuntimeUrl,
  readManagedRuntimeData,
  readManagedRuntimeResource,
} from "./runtime-preparation.mjs";
import { createManagedRuntimeGenerationLease } from "./runtime-generation-lease.mjs";
import { createRuntimeSessionOwner } from "./runtime-session.mjs";
import type { RuntimeSessionToken } from "./runtime-session.mjs";
import { validateStaticLanguagePackEntries } from "./language-pack-validation.mjs";
import { sha256Hex } from "./sha256.mjs";
import {
  buildLanguageCatalog,
  resolveLanguagePackSource,
  selectLanguageEntry,
  thpracLocaleForLanguage,
} from "./language-catalog.mjs";
import { createNetworkActivityTracker } from "./network-activity.mjs";
import { loadOfflineLanguageIndex, rememberOfflineLanguage } from "./offline-language-index.mjs";
import {
  HOST_PROTOCOL,
  PRODUCT_GAMES,
  PRODUCT_IDS,
  createLocalProductManifest,
  gameIdForProduct,
  isGameId,
  isProductId,
  isMultiplayerProductId,
  languagePriority,
  multiplayerConfigForProduct,
  multiplayerProductIdForGame,
  productFeatureAvailable,
  productEnabledForBuild,
} from "../contracts/product-catalog.mjs";
import { resolveEffectiveMusicMode, resolveMusicAvailability } from "./music-availability.mjs";
import {
  RELEASE_CATALOG_FILE,
  releaseCatalogEntryUrl,
} from "../contracts/release-catalog.mjs";
import { hostOriginMigrationAvailable, validateHostManifest } from "../contracts/host-manifest.mjs";
import { isRuntimeResponseMessage, parseRuntimeInboundMessage } from "../contracts/runtime-protocol.mjs";
import { loadRemoteMetadata } from "./remote-metadata.mjs";
import { getUiLocale, initUiLocale, isUiMessageKey, t } from "./i18n.mjs";
import type { UiMessageKey } from "./i18n.mjs";
import { createAppShellClient } from "./app-shell-client.mjs";
import {
  APP_SHELL_UPDATE_STATUS_PATH,
  appliedAppShellUpdateAt,
  formatRelativeUpdateAge,
  nextRelativeUpdateRefresh,
} from "./relative-update-time.mjs";
import {
  confirmRuntimeClose,
  createGameDataContinuation,
  gameDataContinuationMatches,
  runtimeSessionAcceptsGenerationRevision,
  shouldDeferAppShellReload as lifecycleShouldDeferReload,
} from "./launcher-lifecycle.mjs";
import type { GameDataContinuation } from "./launcher-lifecycle.mjs";
import {
  canonicalTouchLayout,
  cloneTouchLayout,
  emptyTouchLayout,
  loadTouchLayoutFromStorage,
  normalizeTouchLayoutPriorityOrder,
  persistTouchLayoutResult,
  persistTouchLayoutToStorage,
  touchLayoutControlMeta,
  touchLayoutControlNames,
  touchLayoutScaleMax,
  touchLayoutScaleMin,
} from "./touch-layout-model.mjs";
import { createTouchLayoutWindowPositionStore } from "./touch-layout-editor-state.mjs";
import type { TouchLayoutWindowKind } from "./touch-layout-editor-state.mjs";
import { createSiteNoticeController } from "./site-notice.mjs";
import { createFirstUseNoticeController } from "./first-use-notice.mjs";
import { createMultiplayerGuideController } from "./multiplayer-guide.mjs";
import { createEdgeDrawerGesture } from "./edge-drawer-gesture.mjs";
import {
  DEFAULT_GAME_OPTIONS as defaultOptions,
  MUSIC_MODES as musicModes,
  TOUCH_FOCUS_MODES as touchFocusModes,
  TOUCH_MOVEMENT_MODES as touchMovementModes,
  applySharedTouchPreferences,
  loadStoredGamePreferences,
  loadStoredLanguagePreference,
  loadOrInitializeSharedTouchPreferences,
  isMusicMode,
  isTouchMovementMode,
  isTouchFocusMode,
  persistStoredGamePreferences,
  persistSharedTouchPreferences,
  touchMovementUsesJoystick,
} from "./game-preferences.mjs";
import {
  postDirectTouch as postRuntimeDirectTouch,
  postHostedKey as postRuntimeHostedKey,
  postThpracMouse as postRuntimeThpracMouse,
  postTouchCancel as postRuntimeTouchCancel,
  postTouchControls as postRuntimeTouchControls,
} from "./touch-runtime-protocol.mjs";
import { createGameZoomController } from "./game-zoom.mjs";
import type { GameZoomPointerInput } from "./game-zoom.mjs";
import {
  allocateReplayName,
  createReplayArchiveExtractionGuard,
  createReplayMutationQueue,
  isReplayFilePath,
  isReplayImportFileName,
  ReplayArchiveScanError,
  isReplayTargetAvailable,
  isValidReplayName,
  planReplayArchiveImport,
  replayImportAccept,
  selectReplayExportPaths,
} from "./replay-files.mjs";
import {
  appendRttSample,
  compactDiagnosticText,
  compactRendererLabel,
  describeBrowserEnvironment,
  describeNetplayConnection,
  runtimeDiagnosticsVisibleByDefault,
  selectedRtcPair,
} from "./runtime-diagnostics-model.mjs";
import {
  createMultiplayerIdentityStore,
  multiplayerDisplayInitial as mpDisplayInitial,
  normalizeMultiplayerDisplayName as mpNormalizeDisplayName,
} from "./multiplayer-identity.mjs";
import { normalizeMultiplayerLobbySnapshot } from "./multiplayer-lobby-snapshot.mjs";
import { createNetworkDiagnosticsController } from "./network-diagnostics.mjs";
import { createMultiplayerPreferenceStore } from "./multiplayer-preferences.mjs";
import {
  buildMultiplayerDiagnosticRelayUrl,
  buildMultiplayerGameplayRelayUrl,
  buildMultiplayerLobbyRelayUrl,
} from "./multiplayer-relay-url.mjs";
import { buildMultiplayerRuntimeOptions } from "./multiplayer-runtime-options.mjs";
import { createMultiplayerRoomSessionStore } from "./multiplayer-room-session.mjs";
import { createMultiplayerSpectatorRailPositionStore } from "./multiplayer-spectator-rail-position.mjs";
import {
  MP_ROOM_HISTORY_KEY as mpRoomHistoryKey,
  MP_ROOM_URL_KEY as mpRoomUrlKey,
  PLAYER_HISTORY_KEY as playerHistoryKey,
  applyHistoryOperations,
  directRoomHistorySeed,
  initialRoutedHistoryOperations,
  launcherHomeHistoryOperation,
  normalizeRoomCode as mpNormalizeRoomCode,
  playerRouteHistoryOperation,
  returnToRoomHistoryOperation,
  roomRouteHistoryOperation,
  routedProductFromUrl,
} from "./route-state.mjs";
import type {
  GameId,
  ProductFeatureId,
  ProductId,
} from "../contracts/product-catalog.mjs";
import type {
  HostGameData,
  HostMidiManifest,
  HostOggManifest,
  HostManifest,
} from "../contracts/host-manifest.mjs";
import type {
  ReleaseCatalog,
} from "../contracts/release-catalog.mjs";
import type {
  InstalledPackageGeneration,
  CurrentPackageGeneration,
  PackageDescriptor,
} from "../contracts/package-read-models.mjs";
import type {
  RuntimeProtocolCommand,
  RuntimeResponseMessage,
} from "../contracts/runtime-protocol.mjs";
import type {
  LauncherNavigator,
  LauncherDocument,
  LauncherFullscreenElement,
  LauncherState,
  LauncherWindow,
  PendingRuntimeRequest,
  MultiplayerRoomState,
  MultiplayerUiState,
  RuntimeDiagnosticState,
  RuntimeWindow,
  MidiSynth,
  TransferPresentation,
  TransferKind,
  TransferMode,
} from "./app-types.mjs";
import type { AppShellClientState } from "./app-shell-client.mjs";
import type { NetworkActivitySnapshot } from "./network-activity.mjs";
import type { NormalizedMultiplayerLobbySnapshot } from "./multiplayer-lobby-snapshot.mjs";
import type { GameOptions, MusicMode, TouchMovementMode } from "./game-preferences.mjs";
import type { LanguageCatalogEntry, RemoteLanguagePackSource } from "./language-catalog.mjs";
import type {
  TouchLayout,
  TouchLayoutControlName,
  TouchLayoutControlPlacement,
  TouchLayoutOrientation,
  TouchLayoutProfile,
} from "./touch-layout-model.mjs";
import type { DirectTouchPoint, DirectTouchType } from "./touch-runtime-protocol.mjs";

const launcherWindow = window as LauncherWindow;
const launcherNavigator = navigator as LauncherNavigator;
const launcherDocument = document as LauncherDocument;
const bootWatchdog = launcherWindow.__eaglerBoot || null;
bootWatchdog?.mark("app-module-executing");
initUiLocale();

function loadDeferredUiFonts() {
  if (document.querySelector('link[data-deferred-ui-fonts]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "ui-fonts-deferred.css";
  stylesheet.dataset.deferredUiFonts = "true";
  document.head.append(stylesheet);
}

for (const event of ["pointerdown", "keydown"] as const) {
  window.addEventListener(event, loadDeferredUiFonts, { capture: true, once: true, passive: true });
}

const brandUpdateAge = document.querySelector<HTMLTimeElement>("#brandUpdateAge");
let appliedAppShellUpdatedAt: number | null = null;
let brandUpdateTimer: number | null = null;

function renderBrandUpdateAge() {
  if (!brandUpdateAge) return;
  if (appliedAppShellUpdatedAt == null) {
    brandUpdateAge.textContent = t("brand.neverUpdated");
    brandUpdateAge.removeAttribute("datetime");
    return;
  }
  const elapsed = Math.max(0, Date.now() - appliedAppShellUpdatedAt);
  brandUpdateAge.textContent = t("brand.updatedAgo", { age: formatRelativeUpdateAge(elapsed) });
  brandUpdateAge.dateTime = new Date(appliedAppShellUpdatedAt).toISOString();
}

function scheduleBrandUpdateAge() {
  if (brandUpdateTimer != null) window.clearTimeout(brandUpdateTimer);
  renderBrandUpdateAge();
  if (appliedAppShellUpdatedAt == null) return;
  brandUpdateTimer = window.setTimeout(scheduleBrandUpdateAge,
    nextRelativeUpdateRefresh(Date.now() - appliedAppShellUpdatedAt));
}

async function loadAppliedAppShellUpdateTime() {
  try {
    const response = await fetch(APP_SHELL_UPDATE_STATUS_PATH, { cache: "no-store" });
    if (response.ok) appliedAppShellUpdatedAt = appliedAppShellUpdateAt(await response.json());
  } catch {}
  scheduleBrandUpdateAge();
}

scheduleBrandUpdateAge();

let appShellClient: ReturnType<typeof createAppShellClient> | null = null;
let serverUpdateState = "unknown";
const vendorLoads = new Map<string, Promise<void>>();

function loadVendor(path: string, ready: () => boolean, label: string): Promise<void> {
  if (ready()) return Promise.resolve();
  const pending = vendorLoads.get(path);
  if (pending) return pending;
  const task = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`${label} 加载超时，请重试`)), 30_000);
    script.src = path;
    script.async = true;
    script.onload = () => finish(ready() ? undefined : new Error(`${label} 加载后没有注册组件`));
    script.onerror = () => finish(new Error(`${label} 加载失败`));
    document.head.append(script);
  }).catch(error => {
    vendorLoads.delete(path);
    throw error;
  });
  vendorLoads.set(path, task);
  return task;
}

async function ensureFflate() {
  await loadVendor("vendor/fflate.min.js", () => Boolean(launcherWindow.fflate), "ZIP 组件");
  return launcherWindow.fflate;
}

async function ensureTinySynth() {
  await loadVendor("vendor/webaudio-tinysynth.min.js", () => Boolean(launcherWindow.WebAudioTinySynth), "MIDI 合成器");
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = record(error)?.message;
  return typeof message === "string" ? message : String(error ?? "");
}

class RuntimeOperationError extends Error {
  errno?: number;
}

function clearOptionalTimeout(handle: ReturnType<typeof setTimeout> | null | undefined): void {
  if (handle != null) globalThis.clearTimeout(handle);
}

function clearOptionalInterval(handle: ReturnType<typeof setInterval> | null | undefined): void {
  if (handle != null) globalThis.clearInterval(handle);
}

function remoteFailureReason(error: unknown) {
  if (navigator.onLine === false) return t("status.deviceOffline");
  const message = errorMessage(error);
  const httpStatus = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (httpStatus) return `HTTP ${httpStatus}`;
  if (/超时|timeout|timed out|没有完成请求/i.test(message)) return t("status.requestTimeout");
  return t("status.connectionFailed");
}

function showPlayerDebug(message: unknown) {
  if (!iosWebKitTouch) return;
  const box = $("#playerDebug");
  const debug = record(record(message)?.debug) ?? {};
  const lines = [
    "EAGLER-RUNTIME/1 debug",
    `note=${debug.note || ""}`,
    `stage=${debug.stage || ""}`,
    `nav=${debug.nav || ""}`,
    `load=${debug.loadSeen ? "yes" : "no"} hostReady=${debug.hostReadySeen ? "yes" : "no"}`,
    `readyState=${debug.readyState || "-"} document=${debug.documentPresent ? "yes" : "no"}`,
    `mount=${debug.mountType || "-"}`,
    `iframe=${debug.iframeSrc || "-"}`,
    `href=${debug.href || "-"}`,
  ];
  if (debug.lastError) lines.push(`error=${debug.lastError}`);
  if (debug.lastRejection) lines.push(`rejection=${debug.lastRejection}`);
  box.textContent = lines.join("\n");
  box.hidden = false;
}

function mpLobbySend(message: UnknownRecord) {
  if (!mpLobby.connected || mpLobby.socket?.readyState !== WebSocket.OPEN) return false;
  mpLobby.socket.send(JSON.stringify(message));
  return true;
}

async function installedPackageRuntimeResources() {
  const generation = activeInstalledPackageGeneration;
  if (!generation) return [];
  const runtimeOwned = new Set<string>();
  const runtimes = generation.descriptor.runtimes || (generation.descriptor.runtime ? { normal: generation.descriptor.runtime } : {});
  for (const runtime of Object.values(runtimes)) {
    for (const fileId of runtime?.bootstrap || [runtime?.entry]) {
      if (fileId) runtimeOwned.add(fileId);
    }
  }
  const resources: Array<{ fileId: string; path: string; size: number }> = [];
  for (const fileId of generation.descriptor.base?.files || []) {
    if (runtimeOwned.has(fileId) || fileId === generation.descriptor.runtimeRequirement?.dataFile ||
        !generation.files?.[fileId]?.objectId) continue;
    const declaration = generation.descriptor.files[fileId];
    if (!declaration) continue;
    // Old generations may still declare executable Runtime files. They are
    // migration input only and must never be materialized into the live FS.
    if (/\.(?:html|m?js|wasm)$/i.test(declaration.source || "")) continue;
    resources.push({ fileId, path: declaration.target, size: Number(declaration.bytes) || 0 });
  }
  return resources;
}

async function installManagedPackageResources(
  resources: ReadonlyArray<{ fileId: string; path: string; size: number }>,
  generation: InstalledPackageGeneration | null = activeInstalledPackageGeneration,
  session: RuntimeSessionToken | null = currentRuntimeSession(),
) {
  if (!resources.length) return;
  if (!generation || !runtimeSessionCurrent(session)) throw new Error("Runtime session is no longer active");
  const runtimeWindow = currentRuntimeWindow();
  let runtimeDocument: Document | null = null;
  try { runtimeDocument = runtimeWindow?.document || null; } catch {}
  const fs = runtimeWindow?.FS || runtimeWindow?.Module?.FS;
  if (!runtimeWindow || !runtimeDocument || !fs?.writeFile || !fs?.mkdirTree) {
    throw new Error(t("runtime.fsUnavailable"));
  }
  for (const resource of resources) {
    const prepared = await readManagedRuntimeResource(generation, resource.fileId);
    if (!runtimeSessionCurrent(session) || currentRuntimeWindow() !== runtimeWindow) throw new Error("Runtime session is no longer active");
    try { if (runtimeWindow.document !== runtimeDocument) throw new Error("Runtime document was replaced"); }
    catch { throw new Error("Runtime session is no longer active"); }
    if (!prepared || prepared.path !== resource.path) throw new Error(t("runtime.localResourceMissing", { file: resource.fileId }));
    const slash = prepared.path.lastIndexOf("/");
    if (slash > 0) fs.mkdirTree(prepared.path.slice(0, slash));
    fs.writeFile(prepared.path, new Uint8Array(prepared.buffer), { canOwn: true });
  }
}

function mpApplyLobbyRoom(next: unknown) {
  if (!mpUiState.room) return;
  const normalized = normalizeMultiplayerLobbySnapshot(next, {
    localClientId: mpLobby.clientId,
    maxDifficulty: mpDifficultyMax(),
    loadoutCount: mpLoadoutCount(),
  });
  if (!normalized) return;
  mpUiState.room.synced = true;
  mpUiState.room.connection = "connected";
  mpUiState.room.playerCount = normalized.playerCount;
  mpUiState.room.difficulty = normalized.difficulty;
  mpUiState.room.settingsVersion = normalized.settingsVersion;
  mpUiState.room.phase = normalized.phase;
  mpUiState.room.spectators = normalized.spectators;
  mpUiState.room.spectatorCount = normalized.spectatorCount;
  mpUiState.room.seats = normalized.seats;
  mpUiState.seat = normalized.localSeat;
  if (normalized.localSeat != null) {
    const localSeat = normalized.seats[normalized.localSeat];
    if (!localSeat) return;
    mpUiState.spectatorRequested = false;
    mpUiState.preferredLoadout = localSeat.loadout;
    mpUiState.ready = localSeat.ready;
  } else {
    if (normalized.localSpectator) mpUiState.spectatorRequested = true;
    mpUiState.ready = false;
  }
  renderMpRoom();
}

function mpDisconnectLobby() {
  clearOptionalTimeout(mpLobby.reconnectTimer);
  mpLobby.reconnectTimer = null;
  mpLobby.reconnectAttempt = 0;
  const socket = mpLobby.socket;
  mpLobby.socket = null;
  mpLobby.connected = false;
  mpLobby.roomCode = "";
  if (socket && socket.readyState < WebSocket.CLOSING) {
    try { socket.close(1000, "leave room"); } catch {}
  }
}

function mpScheduleLobbyReconnect(roomCode: string) {
  if (mpLobby.reconnectTimer || !mpUiState.room || mpUiState.room.code !== roomCode) return;
  if (navigator.onLine === false) return;
  const attempt = mpLobby.reconnectAttempt++;
  const delay = Math.min(5000, 650 * (2 ** Math.min(attempt, 3))) + Math.floor(Math.random() * 250);
  mpLobby.reconnectTimer = window.setTimeout(() => {
    mpLobby.reconnectTimer = null;
    if (!mpUiState.room || mpUiState.room.code !== roomCode || mpLobby.connected) return;
    mpConnectLobby(true);
  }, delay);
}

function mpReconnectLobbyNow() {
  if (!mpUiState.room || mpLobby.connected) return;
  clearOptionalTimeout(mpLobby.reconnectTimer);
  mpLobby.reconnectTimer = null;
  mpConnectLobby(true);
}

function mpConnectLobby(reconnecting = false) {
  const room = mpUiState.room;
  if (!room || typeof WebSocket !== "function") return;
  mpLobby.clientId = multiplayerIdentity.lobbyClientId(isMultiplayerProduct(state.product) ? state.product : "th07mp");
  let lobbyRelay;
  try {
    lobbyRelay = buildMultiplayerLobbyRelayUrl(state.netplay.url, {
      product: state.product,
      roomCode: room.code,
      clientId: mpLobby.clientId,
    });
  } catch { return; }
  const transportRoomId = lobbyRelay.roomId;
  if (mpLobby.socket && mpLobby.roomCode === transportRoomId && mpLobby.socket.readyState <= WebSocket.OPEN) return;
  clearOptionalTimeout(mpLobby.reconnectTimer);
  mpLobby.reconnectTimer = null;
  if (!reconnecting) mpLobby.reconnectAttempt = 0;
  const previous = mpLobby.socket;
  mpLobby.socket = null;
  mpLobby.connected = false;
  if (previous && previous.readyState < WebSocket.CLOSING) {
    try { previous.close(1000, "replace lobby socket"); } catch {}
  }
  const socket = new WebSocket(lobbyRelay.url);
  mpLobby.socket = socket;
  mpLobby.roomCode = transportRoomId;
  room.connection = reconnecting ? "reconnecting" : "connecting";
  renderMpRoom();
  socket.addEventListener("open", () => {
    if (mpLobby.socket !== socket || !mpUiState.room || mpUiState.room.code !== room.code) return;
    mpLobby.connected = true;
    mpLobby.reconnectAttempt = 0;
    room.connection = room.synced ? "connected" : "syncing";
    if (mpUiState.seat != null) {
      mpLobbySend({ type: "take-seat", seat: mpUiState.seat, loadout: mpUiState.preferredLoadout, ready: mpUiState.ready, name: mpUiState.displayName });
      if (mpUiState.seat === 0) mpLobbySend({ type: "settings", playerCount: mpUiState.room.playerCount, difficulty: mpUiState.room.difficulty });
    } else if (mpUiState.spectatorRequested) {
      mpLobbySend({ type: "spectate", name: mpUiState.displayName });
    }
    renderMpRoom();
  });
  socket.addEventListener("message", event => {
    if (mpLobby.socket !== socket) return;
    let message: UnknownRecord | null;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    message = record(message);
    if (!message) return;
    if (message.type === "state") {
      // The relay snapshot is authoritative for the current room generation.
      // This also prevents a serial remembered from a previous, deleted room
      // with the same code from suppressing the next start event.
      mpLobby.startSerial = Math.max(0, Number(record(message.room)?.startSerial) || 0);
      mpApplyLobbyRoom(message.room);
      return;
    }
    if (message.type === "start") {
      mpApplyLobbyRoom(message.room);
      const serial = Number(message.serial) || 0;
      if (serial > mpLobby.startSerial) {
        mpLobby.startSerial = serial;
        if (mpUiState.seat != null || mpUiState.spectatorRequested) void mpLaunchRoomGame();
      }
      return;
    }
    if (message.type === "spectator-start") {
      mpApplyLobbyRoom(message.room);
      const serial = Number(message.serial) || 0;
      mpLobby.startSerial = Math.max(mpLobby.startSerial, serial);
      if (mpUiState.spectatorRequested && !state.launched) void mpLaunchRoomGame();
      return;
    }
    if (message.type === "error" && message.error) {
      showToast(String(message.error));
    }
  });
  socket.addEventListener("close", () => {
    if (mpLobby.socket !== socket) return;
    mpLobby.socket = null;
    mpLobby.connected = false;
    if (mpUiState.room?.code === room.code) {
      room.connection = "reconnecting";
      mpScheduleLobbyReconnect(room.code);
    }
    renderMpRoom();
  });
  socket.addEventListener("error", () => {
    // The room page remains usable as a local/mock UI when the relay is not
    // running, which keeps static previews and visual tests independent.
  });
}

let mpLaunchInFlight = false;
let mpGameCheckInFlight = false;
let launcherOperationDepth = 0;
let serverConfigurationWarning = "";
async function mpLaunchRoomGame() {
  if (mpLaunchInFlight || state.launched) return;
  mpLaunchInFlight = true;
  try {
    mpConfigureRuntimeSession();
    if (mpUiState.seat != null && !await confirmInputWarnings()) return;
    openPlayerView();
    try { await enterPlayerFullscreen({ focusGame: false }); }
    catch (error) { showToast(t("fullscreen.autoBlocked", { reason: errorMessage(error) })); }
    await launchConfiguredRuntime();
    if (isPlayerFullscreen()) await lockEscapeForGame();
  } catch (error) {
    if (!state.launched && isCancelledDownload(error)) {
      if (player.classList.contains("open")) {
        if (!await closePlayerView()) return;
      } else resetRuntime();
      setStatus(t("runtime.downloadCancelled"));
      return;
    }
    if (!state.launched && isResourceLoadFailure(error)) {
      const message = errorMessage(error);
      // Keep the Player/fullscreen host and multiplayer session intact.
      // syncTransientOverlayHost() moves the import surface into Player while
      // fullscreen, and a successful import resumes launchConfiguredRuntime().
      setPlayerStatus(t("runtime.missingResourcesPlayer"));
      beginManualGamePackageImport(message, captureGameDataContinuation("launch"));
      setStatus(t("runtime.missingResourcesLauncher"));
      showToast(message);
      return;
    }
    const message = errorMessage(error);
    setPlayerStatus(message);
    showStartupError(error, mpUiState.seat == null ? t("runtime.multiplayerContext", { game: state.game.toUpperCase() }) : t("runtime.multiplayerPlayerContext", { game: state.game.toUpperCase(), player: mpUiState.seat + 1 }));
    showToast(message);
  } finally {
    mpLaunchInFlight = false;
    maybeApplyDeferredAppShellUpdate();
  }
}

async function mpCheckGame() {
  const room = mpUiState.room;
  if (!room || (room.phase && room.phase !== "lobby") || mpUiState.seat == null || mpUiState.ready ||
      mpGameCheckInFlight || mpLaunchInFlight || state.launched) return;
  mpGameCheckInFlight = true;
  mpLaunchInFlight = true;
  renderMpRoom();
  try {
    // Exercise the exact multiplayer Runtime and selected resources without
    // attaching this preflight run to the room's gameplay transport.
    state.runtimeVariant = "multiplayer";
    state.replayViewer = false;
    resetRuntime();
    openPlayerView();
    setPlayerStatus(t("multiplayer.checkingGame"));
    await launchConfiguredRuntime({ awaitFirstFrame: true, omitNetplay: true });
    await closePlayerView(false, { skipSync: true, returnToMpRoom: true });
    setStatus(t("multiplayer.checkGamePassed"));
    showToast(t("multiplayer.checkGamePassed"));
  } catch (error) {
    const reason = errorMessage(error);
    if (player.classList.contains("open")) {
      await closePlayerView(false, { skipSync: true, returnToMpRoom: true });
    } else {
      resetRuntime();
    }
    if (isResourceLoadFailure(error)) {
      beginManualGamePackageImport(reason, captureGameDataContinuation("install-only"));
    } else {
      showStartupError(error, t("multiplayer.checkGame"));
    }
    setStatus(t("multiplayer.checkGameFailed", { reason }));
    showToast(t("multiplayer.checkGameFailed", { reason }), 4000);
  } finally {
    mpGameCheckInFlight = false;
    mpLaunchInFlight = false;
    renderMpRoom();
    maybeApplyDeferredAppShellUpdate();
  }
}

function renderServerStatusNote(_snapshot?: Readonly<AppShellClientState>) {
  const note = document.getElementById("serverStatusNote");
  if (!note) return;
  const appShell = appShellClient?.snapshot();
  let text = "";
  let kind = "";
  if (serverConfigurationWarning) {
    kind = "offline";
    text = serverConfigurationWarning;
  } else if (appShell?.updateReady) {
    kind = "update";
    text = state.launched === true
      ? t("status.siteUpdateAfterExit")
      : t("status.applyingSiteUpdate");
  } else if (serverUpdateState === "unavailable") {
    kind = "offline";
    text = t("status.remoteUnavailable", { reason: remoteFailureReason(remoteCatalogError) });
  } else if (serverUpdateState === "retrying") {
    kind = "checking";
    text = t("status.connectionRestored");
  } else if (appShell?.updateCheckFailed) {
    kind = "offline";
    text = t("status.updateCheckFailed", { reason: remoteFailureReason(appShell.updateError) });
  }
  note.hidden = !text;
  if (!text) {
    note.removeAttribute("data-kind");
    note.textContent = "";
    return;
  }
  note.dataset.kind = kind;
  note.textContent = text;
}

// The App Shell client owns Service Worker registration/update lifecycle. It is
// independent of game/package loading; the Launcher only supplies UI callbacks
// and the rule that an already-running Runtime blocks automatic page reload.
function shouldDeferAppShellReload() {
  return lifecycleShouldDeferReload({
    launched: state.launched === true,
    runtimeReady: state.ready === true,
    runtimeSessionActive: currentRuntimeSession() !== null,
    touchLayoutEditing,
    blockingOperation: !!blockingNetworkOperation,
    gameDataAttempt: !!gameDataAttempt,
    launchInFlight: mpLaunchInFlight || launcherOperationDepth > 0,
    decisionOpen: document.querySelector<HTMLDialogElement>("#decisionDialog")?.open === true,
    replayOpen: document.querySelector<HTMLDialogElement>("#replayDialog")?.open === true,
  });
}

appShellClient = createAppShellClient({
  shouldDeferReload: shouldDeferAppShellReload,
  onChange: renderServerStatusNote,
});
void appShellClient.ready.then(() => {
  if (navigator.serviceWorker?.controller) return loadAppliedAppShellUpdateTime();
});
function maybeApplyDeferredAppShellUpdate() {
  queueMicrotask(() => appShellClient?.maybeReload());
}
async function withLauncherActivity<T>(operation: () => Promise<T>): Promise<T> {
  launcherOperationDepth++;
  try {
    return await operation();
  } finally {
    launcherOperationDepth = Math.max(0, launcherOperationDepth - 1);
    maybeApplyDeferredAppShellUpdate();
  }
}

const protocol = HOST_PROTOCOL;
let manifest: ReturnType<typeof createLocalProductManifest> | HostManifest = createLocalProductManifest();
let releaseCatalog: ReleaseCatalog | null = null;
let releaseCatalogUrl = new URL(RELEASE_CATALOG_FILE, location.href).href;
let hostManifestAvailable = false;
let hostManifestError: unknown = null;
let remoteCatalogError: unknown = null;
let netplayConfigurationWasReady = false;
let gameDataFallback: { url: string; hint?: string; [key: string]: unknown } | null = null;
let serverResourceMode = "hosted";
let importServer = false;

let networkActivitySnapshot: NetworkActivitySnapshot = { active: [], count: 0, loaded: 0, total: 0 };
let networkActivityRenderQueued = false;
function networkMiB(bytes: unknown) { return `${(Math.max(0, Number(bytes) || 0) / 1048576).toFixed(1)} MiB`; }
function renderNetworkActivity(snapshot: NetworkActivitySnapshot) {
  networkActivitySnapshot = snapshot;
  const panel = document.getElementById("transfer");
  if (!panel) return;
  if (!snapshot.count) {
    panel.removeAttribute("data-network-active");
    panel.querySelector<HTMLElement>(".transfer-bar")?.classList.remove("indeterminate");
    if (panel.dataset.networkOwned === "1") {
      panel.hidden = true;
      panel.dataset.networkOwned = "0";
    }
    return;
  }
  const active = snapshot.active;
  const current = [...active].reverse().find(task => task.phase === "receiving" && task.loaded > 0) || active.at(-1);
  if (!current) return;
  const elapsed = Math.max((performance.now() - current.startedAt) / 1000, 0.1);
  const speed = current.loaded / elapsed;
  const knownTotal = snapshot.total > 0;
  const currentKnownTotal = current.total > 0;
  panel.hidden = false;
  panel.dataset.networkActive = "1";
  panel.dataset.networkOwned = "1";
  const title = document.getElementById("transferTitle");
  const label = document.getElementById("transferLabel");
  const amount = document.getElementById("transferAmount");
  const bar = document.getElementById("transferBar");
  const barTrack = bar?.parentElement;
  const speedNode = document.getElementById("transferSpeed");
  const eta = document.getElementById("transferEta");
  const warning = document.getElementById("transferWarning");
  const retry = document.getElementById("transferRetry");
  if (title) title.textContent = current.title || t("transfer.serverRequesting");
  if (label) label.textContent = snapshot.count > 1 ? `${current.label}  +${snapshot.count - 1}` : current.label;
  if (amount) amount.textContent = knownTotal
    ? `${networkMiB(snapshot.loaded)} / ${networkMiB(snapshot.total)}`
    : current.phase === "requesting" ? t("transfer.waitingServer") : current.loaded > 0 ? t("transfer.received", { amount: networkMiB(current.loaded) }) : t("transfer.receiving");
  if (bar) bar.style.width = knownTotal ? `${Math.min(100, snapshot.loaded / snapshot.total * 100).toFixed(1)}%`
    : currentKnownTotal ? `${Math.min(100, current.loaded / current.total * 100).toFixed(1)}%` : "34%";
  barTrack?.classList.toggle("indeterminate", !knownTotal && !currentKnownTotal);
  if (speedNode) speedNode.textContent = current.phase === "requesting" ? t("transfer.waiting") : speed >= 1048576
    ? `${(speed / 1048576).toFixed(1)} MiB/s` : `${Math.round(speed / 1024)} KiB/s`;
  if (eta) eta.textContent = currentKnownTotal && speed > 1024
    ? clock((current.total - current.loaded) / speed) : t("transfer.requestCount", { count: snapshot.count });
  if (warning) warning.hidden = true;
  if (retry) retry.hidden = true;
}
function scheduleNetworkActivityRender(snapshot: NetworkActivitySnapshot) {
  networkActivitySnapshot = snapshot;
  if (networkActivityRenderQueued) return;
  networkActivityRenderQueued = true;
  requestAnimationFrame(() => {
    networkActivityRenderQueued = false;
    renderNetworkActivity(networkActivitySnapshot);
  });
}
const networkActivity = createNetworkActivityTracker({ onChange: scheduleNetworkActivityRender });
const backgroundNetworkActivity = createNetworkActivityTracker();

function packageNetworkMeta(gameId: GameId, input: RequestInfo | URL) {
  let pathname = "";
  try {
    const value = typeof input === "string" ? input
      : input instanceof Request ? input.url
      : input.href;
    pathname = new URL(value, location.href).pathname;
  } catch {}
  const file = decodeURIComponent(pathname.split("/").at(-1) || pathname || t("transfer.resourceFallback"));
  const game = String(gameId || "game").toUpperCase();
  if (/\.package\.json$/i.test(pathname)) return { title: t("transfer.fetchingGameInfo"), label: t("transfer.versionDescriptor", { game }), kind: "descriptor" };
  if (/\.data$/i.test(pathname)) return { title: t("transfer.gameDownloading"), label: `${game} ${file}`, kind: "game" };
  if (/\.wasm$/i.test(pathname)) return { title: t("transfer.runtimeDownloading"), label: `${game} WebAssembly`, kind: "runtime" };
  if (/\.js$/i.test(pathname)) return { title: t("transfer.runtimeDownloading"), label: t("transfer.runtimeScript", { game }), kind: "runtime" };
  if (/\.html$/i.test(pathname)) return { title: t("transfer.runtimeDownloading"), label: t("transfer.runtimePage", { game }), kind: "runtime" };
  if (/\.ogg$/i.test(pathname)) return { title: t("transfer.musicDownloading"), label: file, kind: "music" };
  if (/\.(?:ttc|otf|woff2?)$/i.test(pathname)) return { title: t("transfer.resourceDownloading"), label: t("transfer.font", { file }), kind: "font" };
  if (/\.zip$/i.test(pathname)) return { title: t("transfer.packageDownloading"), label: file, kind: "package" };
  return { title: t("transfer.serverRequesting"), label: `${game} ${file}`, kind: "network" };
}
const packageTrackedFetch = (gameId: GameId) => (input: RequestInfo | URL, init?: RequestInit) =>
  networkActivity.xhrFetch(input, init, packageNetworkMeta(gameId, input));

const installedPackageSnapshots = new Map<GameId, InstalledPackageGeneration>();
async function migrateLegacyStoredImports() {
  for (const gameId of Object.keys(manifest.games).filter(isGameId)) {
    let currentRevision = null;
    try { currentRevision = (await readCurrentPackageGeneration(gameId))?.generation?.descriptor?.revision || null; } catch {}
    try {
      const result = await migrateLegacyStoredImport(gameId, {
        protocol: HOST_PROTOCOL,
        fallbackGameData: record(manifest.games[gameId])?.gameData || null,
        currentRevision,
        install: parsed => installParsedPackageZip(parsed),
        origin: location.origin,
      });
      if (result.status === "migrated" || result.status === "already-current") {
        const installed = await readCurrentPackageGeneration(gameId);
        if (installed?.generation) installedPackageSnapshots.set(gameId, installed.generation);
        console.info(`${gameId}: legacy imported storage ${result.status}; Package Store is authoritative`);
      } else if (result.status === "incomplete") {
        console.warn(`${gameId}: legacy imported storage is incomplete; compatibility state retained`, result.missing);
      }
    } catch (error) {
      // Migration is one-way and cleanup occurs only after Package commit. A
      // failed migration therefore leaves the historical compatibility state
      // intact instead of making an old user's only local copy disappear.
      console.warn(`${gameId}: legacy imported storage migration deferred`, error);
    }
  }
}
// Storage maintenance must never hold the Launcher boot screen hostage. Edge
// can take seconds to open or recover a large IndexedDB database. Hydrate the
// installed-package hints in the background; launch paths still read the
// authoritative Package Store before using a generation.
void (async () => {
  await migrateLegacyStoredImports();
  await Promise.all(Object.keys(manifest.games).filter(isGameId).map(async gameId => {
    try {
      const installed = await readCurrentPackageGeneration(gameId);
      if (installed?.generation) installedPackageSnapshots.set(gameId, installed.generation);
    } catch {}
  }));
  // No Player/Runtime existed when this maintenance task was queued. Package
  // leases still protect a Runtime that starts before the task reaches GC.
  try { await garbageCollectPackageStore(); } catch {}
  render();
})().catch(error => console.warn("local Package Store hydration deferred", error));

async function fetchJsonWithTimeout(path: string, timeoutMs = 12000, meta: UnknownRecord = {}): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await networkActivity.fetch(path, { cache: "no-store", signal: controller.signal }, {
      title: t("runtime.requestingServer"),
      label: path,
      kind: "metadata",
      ...meta,
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (timedOut || record(error)?.name === "AbortError") throw new Error(t("runtime.requestTimeoutDetail", { path, seconds: Math.round(timeoutMs / 1000) }));
    throw error;
  } finally {
    clearOptionalTimeout(timer);
  }
}

const originMigrationOpen = document.getElementById("originMigrationOpen");

function firstAvailableHostGame(host: Pick<HostManifest, "games">): GameId {
  const gameId = Object.keys(PRODUCT_GAMES).find(candidate => Object.hasOwn(host.games, candidate));
  if (!gameId || !isGameId(gameId)) throw new Error("Host Manifest 没有可用游戏");
  return gameId;
}

function selectAvailableHostProduct(host: Pick<HostManifest, "games">) {
  if (Object.hasOwn(host.games, state.game)) return;
  const gameId = firstAvailableHostGame(host);
  state.game = gameId;
  state.product = gameId;
  state.runtimeVariant = "normal";
  state.replayViewer = false;
  restoreGamePreferences(gameId, gameId);
}

function applyHostManifest(value: unknown) {
  const nextManifest = validateHostManifest(value);
  manifest = nextManifest;
  // A hosted site may intentionally publish a game subset (for example a
  // TH10-only review package). Keep the Launcher state inside that subset
  // before render() asks game() for music and feature capabilities.
  selectAvailableHostProduct(nextManifest);
  if (originMigrationOpen) {
    originMigrationOpen.dataset.policy = "host-manifest-origin-migration-policy/1";
    originMigrationOpen.hidden = !hostOriginMigrationAvailable(manifest, location.protocol);
  }
  serverResourceMode = manifest.shared?.resourceMode || "hosted";
  importServer = serverResourceMode === "import";
  gameDataFallback = manifest.shared?.gameDataFallback || null;
  state.netplay.url = typeof manifest.shared?.netplayRelay === "string" ? manifest.shared.netplayRelay : "";
  serverConfigurationWarning = importServer && !gameDataFallback
    ? t("package.noExternalLink")
    : "";
  if (mpUiState.room && state.netplay.url) mpReconnectLobbyNow();
  hostManifestAvailable = true;
  renderServerStatusNote();
  render();
}

async function refreshRemoteReleaseState() {
  bootWatchdog?.mark("catalog-request");
  const metadata = await loadRemoteMetadata((file, kind) => fetchJsonWithTimeout(file, 12000, {
    label: kind === "host-manifest" ? t("runtime.readingHostManifest") : t("runtime.checkingRelease"),
  }));
  if (metadata.hostManifest.ok) {
    applyHostManifest(metadata.hostManifest.value);
    await migrateLegacyStoredImports();
    hostManifestError = null;
  } else {
    hostManifestError = metadata.hostManifest.error;
    console.warn("remote Host Manifest unavailable; local product defaults remain available", hostManifestError);
  }
  if (metadata.releaseCatalog.ok) {
    releaseCatalog = metadata.releaseCatalog.value;
    releaseCatalogUrl = new URL(RELEASE_CATALOG_FILE, location.href).href;
    remoteCatalogError = null;
    serverUpdateState = "ready";
  } else {
    remoteCatalogError = metadata.releaseCatalog.error;
    serverUpdateState = "unavailable";
    console.warn("remote Release Catalog unavailable; installed game startup remains available", remoteCatalogError);
  }
  renderServerStatusNote();
  bootWatchdog?.mark(metadata.releaseCatalog.ok ? "catalog-ok" : "catalog-unavailable");
  setTimeout(() => { try { if (!state.launched && !state.hasSelection) syncSelectionFromPlayerRoute(); render(); } catch {} }, 0);
}
let remoteReleasePromise = refreshRemoteReleaseState();

function retryRemoteUpdateChecks() {
  if (serverUpdateState === "unavailable" || remoteCatalogError || hostManifestError) {
    if (serverUpdateState === "unavailable" || remoteCatalogError) serverUpdateState = "retrying";
    renderServerStatusNote();
    remoteReleasePromise = refreshRemoteReleaseState();
  }
  void appShellClient?.checkForUpdate();
}

window.addEventListener("offline", () => {
  remoteCatalogError = remoteCatalogError || new Error("offline");
  if (!hostManifestAvailable) hostManifestError = hostManifestError || new Error("offline");
  serverUpdateState = "unavailable";
  renderServerStatusNote();
});
window.addEventListener("online", retryRemoteUpdateChecks);
window.addEventListener("focus", () => {
  if (remoteCatalogError || hostManifestError) retryRemoteUpdateChecks();
  else void appShellClient?.checkForUpdate();
});
function captureGameDataContinuation(kind: "install-only" | "launch" = "launch"): GameDataContinuation {
  return createGameDataContinuation({
    kind, product: state.product, roomCode: mpUiState.room?.code || null, replayViewer: state.replayViewer,
  });
}
function continuationStillValid(value: GameDataContinuation | undefined): boolean {
  return gameDataContinuationMatches(value, {
    product: state.product, roomCode: mpUiState.room?.code || null, replayViewer: state.replayViewer,
  });
}

function beginImportAttempt() {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false, startTimer: null, completeTimer: null, importFlow: true, continuation: captureGameDataContinuation("launch") };
  $("#gameDataImportReason").textContent = gameDataFallbackText(t("package.noLaunchableLocal"));
  updateGameDataLinkWindow();
  openGameDataImportWindow();
}

let thpracMouseInputWindow: RuntimeWindow | null = null;
let thpracMousePointerId: number | null = null;
let thpracMouseMode = false;
let thpracMenuOpen = false;
let runtimeCustomEventWindow: RuntimeWindow | null = null;

function thpracTouchControlsAvailable() {
  return !!state.options.touchEnabled && !!state.options.thpracEnabled && !!state.options.thpracTouchControlsEnabled;
}

function thpracTouchControlsVisible() {
  return !!state.options.thpracEnabled && !!state.options.thpracTouchControlsEnabled &&
    (touchLayoutEditing || !!state.options.touchEnabled);
}

function thpracMouseModeActive() {
  return state.launched && thpracTouchControlsAvailable() && thpracMouseMode;
}

function touchRuntimeMessageContext() {
  return {
    target: frame?.contentWindow || null,
    targetOrigin: location.origin,
    protocol,
    game: state.game,
    launched: state.launched,
    ready: state.ready,
    spectator: state.netplay.spectator,
  };
}

function postThpracMouseEvent(event: PointerEvent, type: "move" | "down" | "up") {
  postRuntimeThpracMouse(touchRuntimeMessageContext(), type, event.clientX, event.clientY);
}

function beginThpracMousePointer(event: PointerEvent) {
  if (!thpracMouseModeActive() || event.pointerType !== "touch" || thpracMousePointerId != null) return;
  thpracMousePointerId = event.pointerId;
  try { if (event.target instanceof Element) event.target.setPointerCapture?.(event.pointerId); } catch {}
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
  postThpracMouseEvent(event, "down");
}

function moveThpracMousePointer(event: PointerEvent) {
  if (!thpracMouseModeActive() || event.pointerId !== thpracMousePointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
}

function endThpracMousePointer(event: PointerEvent) {
  if (event.pointerId !== thpracMousePointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
  postThpracMouseEvent(event, "up");
  try { if (event.target instanceof Element) event.target.releasePointerCapture?.(event.pointerId); } catch {}
  thpracMousePointerId = null;
}

function uninstallThpracMouseInputBridge() {
  if (!thpracMouseInputWindow) return;
  thpracMouseInputWindow.removeEventListener("pointerdown", beginThpracMousePointer, true);
  thpracMouseInputWindow.removeEventListener("pointermove", moveThpracMousePointer, true);
  thpracMouseInputWindow.removeEventListener("pointerup", endThpracMousePointer, true);
  thpracMouseInputWindow.removeEventListener("pointercancel", endThpracMousePointer, true);
  thpracMouseInputWindow = null;
  thpracMousePointerId = null;
}

function bindThpracMouseInputWindow(win: RuntimeWindow | null) {
  uninstallThpracMouseInputBridge();
  if (!win) return;
  thpracMouseInputWindow = win;
  win.addEventListener("pointerdown", beginThpracMousePointer, true);
  win.addEventListener("pointermove", moveThpracMousePointer, true);
  win.addEventListener("pointerup", endThpracMousePointer, true);
  win.addEventListener("pointercancel", endThpracMousePointer, true);
}

function currentRuntimeWindow(): RuntimeWindow | null {
  return frame.contentWindow as RuntimeWindow | null;
}

function bindGameKeyWindow(win: RuntimeWindow | null) {
  if (gameKeyWindow) {
    try { gameKeyWindow.removeEventListener("keydown", handleGameFullscreenKey, true); } catch {}
    try { gameKeyWindow.removeEventListener("keyup", handleGameFullscreenKey, true); } catch {}
  }
  gameKeyWindow = win || null;
  if (!gameKeyWindow) return;
  gameKeyWindow.addEventListener("keydown", handleGameFullscreenKey, true);
  gameKeyWindow.addEventListener("keyup", handleGameFullscreenKey, true);
}

function handleRuntimeThpracMenu(event: Event) {
  thpracMenuOpen = record(record(event)?.detail)?.open === true;
  touchThpracFunctionKeys.hidden = !thpracMenuOpen;
}

function handleRuntimeMidi(event: Event) {
  const bytes = record(record(event)?.detail)?.bytes;
  if ((state.music === "midi" || isOggMusicMode(state.music)) && midiSynth && Array.isArray(bytes)) {
    midiSynth.send(bytes.filter((value): value is number => typeof value === "number"));
  }
}

function handleRuntimeMidiClose() {
  midiSynth?.reset();
}

function bindRuntimeCustomEventWindow(win: RuntimeWindow | null) {
  if (runtimeCustomEventWindow) {
    try { runtimeCustomEventWindow.removeEventListener("eagler-thprac-menu", handleRuntimeThpracMenu); } catch {}
    try { runtimeCustomEventWindow.removeEventListener("touhou-midi", handleRuntimeMidi); } catch {}
    try { runtimeCustomEventWindow.removeEventListener("touhou-midi-close", handleRuntimeMidiClose); } catch {}
  }
  runtimeCustomEventWindow = win || null;
  if (!runtimeCustomEventWindow) return;
  runtimeCustomEventWindow.addEventListener("eagler-thprac-menu", handleRuntimeThpracMenu);
  runtimeCustomEventWindow.addEventListener("touhou-midi", handleRuntimeMidi);
  runtimeCustomEventWindow.addEventListener("touhou-midi-close", handleRuntimeMidiClose);
}

function rebindRuntimeDomBridges() {
  const win = currentRuntimeWindow();
  gameZoom.bindInputWindow(win);
  bindThpracMouseInputWindow(win);
  bindGameKeyWindow(win);
  bindRuntimeCustomEventWindow(win);
}

function uninstallRuntimeDomBridges() {
  gameZoom.uninstallInputBridge();
  uninstallThpracMouseInputBridge();
  bindGameKeyWindow(null);
  bindRuntimeCustomEventWindow(null);
}

function installRuntimeDomBridges() {
  uninstallRuntimeDomBridges();
  if (!frame.contentWindow) return;
  // Single carrier: Launcher -> Runtime. Bind realm-sensitive DOM bridges
  // directly to #gameFrame after its navigation commits.
  rebindRuntimeDomBridges();
}

function updatePlayerOrientationUi() {
  const available = (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing;
  orientationToggle.hidden = !available;
  if (!available) return;
  const targetLandscape = touchLayoutOrientation() !== "landscape";
  const targetTitle = t(targetLandscape ? "touch.landscape" : "touch.portrait");
  $("#orientationTarget").textContent = targetTitle;
  orientationToggle.setAttribute("aria-label", t(targetLandscape ? "player.switchLandscape" : "player.switchPortrait"));
  orientationToggle.title = t("player.switchOrientationTitle");
}

if (typeof window.AudioContext !== "function" && typeof launcherWindow.webkitAudioContext === "function") {
  try { window.AudioContext = launcherWindow.webkitAudioContext; } catch {}
}
const webAudioAvailable = typeof window.AudioContext === "function";

const state: LauncherState = {
  game: "th06", hasSelection: false, music: "ogg-stream", ready: false, launched: false, replayViewer: false,
  musicPreferenceExplicit: false,
  musicPreference: "ogg-stream",
  request: 0, pending: new Map(), source: "", sourceIdentity: "", mobileOpen: false,
  product: "th06", options: { ...defaultOptions }, language: "ja", lessMotion: false, runtimeVariant: "normal",
  netplay: {
    url: "",
    player: 0, playerCount: 2, seed: 19005, difficulty: 1,
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    loadouts: [{ character: 0, shot: 0 }, { character: 1, shot: 0 }, { character: 2, shot: 0 }],
    spectator: false, spectatorId: "", spectatorCount: 0,
  }
};
const productIds = new Set<ProductId>(PRODUCT_IDS);
const isMultiplayerProduct = (product: ProductId = state.product) => isMultiplayerProductId(product);
const mpDifficultyMax = (product: ProductId = state.product) => multiplayerConfigForProduct(product)?.difficultyMax ?? 0;
const productTitle = (product: ProductId) => isMultiplayerProductId(product) ? t(`game.title.${product}`) : game().title;
const mpUiState: MultiplayerUiState = {
  room: null,
  seat: null,
  ready: false,
  folds: { settings: false, online: true },
  mobileOpen: false,
  roomSettingsOpen: false,
  preferredLoadout: 0,
  spectatorRequested: false,
  displayName: "",
};
const multiplayerIdentity = createMultiplayerIdentityStore();
const multiplayerPreferences = createMultiplayerPreferenceStore();
const multiplayerRoomSessions = createMultiplayerRoomSessionStore();
const multiplayerSpectatorRailPositions = createMultiplayerSpectatorRailPositionStore();
let mpShareSingleplayerSettings = true;
function restoreMpProductPreferences(product: ProductId = state.product) {
  const maxLoadout = multiplayerConfigForProduct(product)?.loadoutCount ?? 0;
  const restored = multiplayerPreferences.load({
    product,
    multiplayer: isMultiplayerProduct(product),
    maxLoadout,
  });
  mpShareSingleplayerSettings = restored.shareSingleplayerSettings;
  if (restored.preferredLoadout != null) mpUiState.preferredLoadout = restored.preferredLoadout;
}
let activeInstalledPackageGeneration: InstalledPackageGeneration | null = null;
// Package installs may atomically advance the current generation while an
// already-loaded Runtime still owns the generation encoded in its URL. Keep
// that Runtime lease stable until reset instead of making late DATA requests
// depend on whichever optional-resource generation happens to be current.
const managedRuntimeGenerationLease = createManagedRuntimeGenerationLease();
const runtimeSessions = createRuntimeSessionOwner();
let activeRuntimeLeaseId: string | null = null;
let activeRuntimeLeaseTimer: ReturnType<typeof setInterval> | null = null;

function currentRuntimeSession(): RuntimeSessionToken | null { return runtimeSessions.current(); }
function runtimeSessionCurrent(token: RuntimeSessionToken | null | undefined): boolean { return runtimeSessions.isCurrent(token); }
async function bindRuntimePackageSession(generation: InstalledPackageGeneration): Promise<RuntimeSessionToken> {
  const gameId = state.game;
  const token = runtimeSessions.begin({
    game: gameId, runtimeVariant: state.runtimeVariant, generationId: generation.id,
    revision: generation.descriptor?.revision || null,
  });
  const leaseId = `runtime-${gameId}-${token.id}-${Math.random().toString(36).slice(2)}`;
  try {
    await retainPackageGeneration(gameId, generation.id, { leaseId });
  } catch (error) {
    if (runtimeSessionCurrent(token)) runtimeSessions.clear();
    throw error;
  }
  if (!runtimeSessionCurrent(token)) {
    void releasePackageGeneration(leaseId).catch(() => {});
    throw new Error("Runtime session was replaced while preparing local data");
  }
  activeRuntimeLeaseId = leaseId;
  clearOptionalInterval(activeRuntimeLeaseTimer);
  activeRuntimeLeaseTimer = setInterval(() => {
    if (!runtimeSessionCurrent(token)) return;
    void retainPackageGeneration(gameId, generation.id, { leaseId }).then(() => {
      // resetRuntime() can release the lease while an already-started
      // heartbeat transaction is still in flight. If that stale write
      // completes afterwards, remove it again instead of reviving the
      // old generation lease until its long stale-expiry window.
      if (!runtimeSessionCurrent(token)) return releasePackageGeneration(leaseId);
    }).catch(() => {});
  }, 5 * 60 * 1000);
  return token;
}
function releaseRuntimePackageSession(): void {
  clearOptionalInterval(activeRuntimeLeaseTimer);
  activeRuntimeLeaseTimer = null;
  const leaseId = activeRuntimeLeaseId;
  activeRuntimeLeaseId = null;
  if (leaseId) void releasePackageGeneration(leaseId).catch(() => {});
}
// A failed local OGG startup is a launch-scoped fallback. Keep the durable
// preference so the user can retry after repairing the Package, but do not let
// an unrelated render promote the already-running Runtime back to OGG.
let launchMusicFallback: MusicMode | null = null;
const touchControls = { fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0 };
const isOggMusicMode = (mode: MusicMode): mode is "ogg-stream" | "ogg-full" => mode === "ogg-stream" || mode === "ogg-full";
const musicTransportMode = (mode: MusicMode) => isOggMusicMode(mode) ? "ogg" : mode === "midi" ? "midi" : mode === "none" ? "none" : null;
const oggDecodeMode = (mode: MusicMode) => mode === "ogg-full" ? "full" : "stream";
const musicModeLabel = (mode: MusicMode) => mode === "ogg-stream" ? t("settings.music.oggStream")
  : mode === "ogg-full" ? t("settings.music.oggFull")
  : mode === "midi" ? "midi"
  : t("settings.music.none");
const touchSensitivityPresets = new Set([50, 100, 200]);
const touchLayoutControlTitle = (name: TouchLayoutControlName) => {
  const meta = touchLayoutControlMeta[name];
  return "titleKey" in meta ? t(meta.titleKey) : meta.title;
};
let touchLayout = loadTouchLayoutFromStorage(localStorage);
let touchLayoutDraft: TouchLayout | null = null;
let touchLayoutEditing = false;
let touchLayoutSelected: TouchLayoutControlName = "fire";
type PointerDrag = { pointerId: number; x: number; y: number };
type TouchLayoutDrag =
  | ({ kind: "move"; name: TouchLayoutControlName } & PointerDrag)
  | { kind: "resize"; name: TouchLayoutControlName; pointerId: number; anchorX: number; anchorY: number; baseWidth: number; baseHeight: number; startScale: number };
let touchLayoutDrag: TouchLayoutDrag | null = null;
let touchLayoutEditorDrag: PointerDrag | null = null;
let touchLayoutSettingsDrag: PointerDrag | null = null;
let touchViewportEditing = false;
let touchViewportDrag: { pointerId: number; x: number } | null = null;
let touchSensitivityPreviewGesture: { pointerId: number; startX: number; startY: number } | null = null;
let touchSensitivityCustomOpen = false;
let touchLayoutEditorEnteredFullscreen = false;
const touchHelpSeenKey = "eagler-touch-help-seen-v8";
let touchHelpSeenInSession = false;
const mobileDevice = launcherNavigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
const iosWebKitTouch = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
const iosHelpPreview = new URLSearchParams(location.search).get("iosHelpPreview") === "1";
const showIosFullscreenHelp = iosWebKitTouch || iosHelpPreview;
// Experimental only: allow an Android browser/WebView to opt into the same
// host-document direct-touch bridge used on iOS.  The normal Android path is
// intentionally unchanged unless the explicit URL flag is present.
const androidDirectTouchTrial = /\bAndroid\b/i.test(navigator.userAgent || "") &&
  new URLSearchParams(location.search).get("androidDirectTouch") === "1";
const hostDirectTouch = iosWebKitTouch || androidDirectTouchTrial;
const lessMotionStorageKey = "eagler-touhou-less-motion-v1";
const runtimeDiagnosticsStorageKey = "eagler-touhou-runtime-diagnostics-v1";
let runtimeDiagnosticsPreference: boolean | null = null;
try {
  const saved = localStorage.getItem(runtimeDiagnosticsStorageKey);
  if (saved === "1" || saved === "0") runtimeDiagnosticsPreference = saved === "1";
} catch {}
const cardFilterStorageKey = "eagler-touhou-card-filter-v1";
type CardFilter = "all" | "original" | "multiplayer";
const cardFilters = new Set<CardFilter>(["all", "original", "multiplayer"]);
function isCardFilter(value: string | undefined): value is CardFilter {
  return value === "all" || value === "original" || value === "multiplayer";
}
let cardFilter: CardFilter = "all";
try {
  const saved = localStorage.getItem(cardFilterStorageKey);
  if (saved && isCardFilter(saved)) cardFilter = saved;
} catch {}
function productEnabled(product: string) {
  if (!productEnabledForBuild(product, manifest.shared.testBuild === true)) return false;
  if (!hostManifestAvailable) return true;
  const gameId = gameIdForProduct(product);
  return isGameId(gameId) && Object.hasOwn(manifest.games, gameId);
}
function matchesCardFilter(product: ProductId) {
  if (!productEnabled(product)) return false;
  return cardFilter === "all" || isMultiplayerProduct(product) === (cardFilter === "multiplayer");
}
const currentPreferenceId = () => isMultiplayerProduct() && !mpShareSingleplayerSettings ? state.product : state.game;
const mpLobby: {
  socket: WebSocket | null;
  roomCode: string;
  connected: boolean;
  clientId: string;
  startSerial: number;
  reconnectTimer: number | null;
  reconnectAttempt: number;
} = {
  socket: null,
  roomCode: "",
  connected: false,
  clientId: "",
  startSerial: 0,
  reconnectTimer: null,
  reconnectAttempt: 0,
};
window.addEventListener("online", mpReconnectLobbyNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") mpReconnectLobbyNow();
});
const gameFeatureAvailable = (gameId: GameId, featureId: ProductFeatureId) =>
  productFeatureAvailable(gameId, featureId, manifest.games[gameId]?.features);
const gameStorage = () => PRODUCT_GAMES[state.game].storage;
const languageCatalog = (gameId: GameId) => {
  const gameManifest = game(gameId);
  return buildLanguageCatalog({
    languageOptions: gameManifest?.languageOptions,
    legacyLanguages: gameManifest?.languages,
    offlineEntries: loadOfflineLanguageIndex(localStorage, gameId),
    generation: installedPackageSnapshots.get(gameId),
    translate: t,
    priority: languagePriority,
  });
};
const languageEntry = () => selectLanguageEntry(languageCatalog(state.game), state.language);
const languageCacheName = "eagler-touhou-language-packs-v1";
function restoreGamePreferences(gameId: GameId, preferenceId: ProductId = gameId) {
  const fallbackPreferenceId = isMultiplayerProductId(preferenceId) ? gameIdForProduct(preferenceId) : null;
  const normalized = loadStoredGamePreferences({
    storage: localStorage,
    preferenceId,
    fallbackPreferenceId,
    context: {
      thpracAvailable: gameFeatureAvailable(gameId, "thprac"),
      webAudioAvailable,
    },
  });
  state.options = applySharedTouchPreferences(
    normalized.options,
    loadOrInitializeSharedTouchPreferences(localStorage, normalized.options),
  );
  state.musicPreferenceExplicit = normalized.musicPreferenceExplicit;
  state.musicPreference = normalized.musicPreference;
  state.music = normalized.music;
  const available = languageCatalog(gameId);
  const savedLanguage = loadStoredLanguagePreference({
    storage: localStorage,
    preferenceId,
    fallbackPreferenceId,
  });
  state.language = savedLanguage && available.some(item => item.id === savedLanguage) ? savedLanguage : "ja";
}
function saveGamePreferences() {
  const preferenceId = currentPreferenceId();
  persistSharedTouchPreferences(localStorage, state.options);
  persistStoredGamePreferences({
    storage: localStorage,
    preferenceId,
    preferences: {
      music: state.music,
      musicPreference: state.musicPreference,
      musicPreferenceExplicit: state.musicPreferenceExplicit,
      options: state.options,
    },
    language: state.language,
  });
}
const inputElementSelectors = [
  "#fileInput", "#gameDataImportInput", "#mpJoinCode", "#mpDisplayName",
  "#touchLayoutScale", "#touchSensitivity",
] as const;
const selectElementSelectors = [
  "#uiLanguageSelect", "#mpLanguageSelect", "#mpMusicSelect", "#musicSelect",
  "#languageSelect", "#mpRoomPlayerCount", "#mpRoomDifficulty", "#touchMovementMode",
  "#touchFocusMode",
] as const;
const dialogElementSelectors = [
  "#decisionDialog", "#firstUseNoticeDialog", "#mpGuideDialog", "#appleRefreshDialog", "#replayDialog",
] as const;
const anchorElementSelectors = ["#originMigrationOpen", "#gameDataFallbackUrl", "#gameNoticeRepo"] as const;
const outputElementSelectors = ["#touchLayoutScaleValue", "#touchSensitivityValue"] as const;
const buttonElementSelectors = [
  "#siteNoticeOptOut", "#siteNoticeClose", "#lessMotionToggle", "#mastheadMenuToggle",
  "#siteNoticeToggle", "#runtimeDiagnosticsToggle", "#firstUseNoticeOpen", "#mpShareSettingsToggle", "#mpFrameLimitAppleNote",
  "#mpFrameLimitToggle", "#mpTh06HitboxToggle", "#mpLocalPlayerVisibilityToggle", "#mpMobileOptionsToggle",
  "#mpTouchToggle", "#mpTouchLayoutEdit", "#mpAlwaysHitboxToggle", "#mpMagnifierToggle",
  "#mpReplayViewer", "#mpCreateRoom", "#mpJoinRoom", "#frameLimitAppleNote",
  "#mpGuideOpen", "#mpNetworkCheck",
  "#frameLimitToggle", "#th06HitboxToggle", "#thpracToggle", "#mobileOptionsToggle",
  "#touchToggle", "#touchLayoutEdit", "#alwaysHitboxToggle", "#magnifierToggle",
  "#launch", "#gamePackageImport", "#mpLeaveRoom", "#mpSpectatorJoin",
  "#mpLoadoutPrev", "#mpLoadoutNext", "#mpStandUp", "#mpLoadoutPrevSeat",
  "#mpLoadoutNextSeat", "#mpCopyRoomCode", "#mpReady", "#mpCheckGame", "#mpStartGame",
  "#mpRoomSettingsToggle", "#toastClose", "#startupErrorClose", "#decisionCancel",
  "#mpSettingsRoomDrawerToggle", "#mpSettingsRoomDrawerCloseHint",
  "#decisionSecondary", "#decisionConfirm", "#firstUseNoticeClose", "#firstUseNoticeCloseHint", "#mpGuideClose",
  "#appleRefreshClose", "#transferCancel", "#transferRetry", "#gameDataImportClose",
  "#transferImport", "#transferDownload", "#gameDataLinkClose", "#touchLayoutOrientationHelpOpen",
  "#touchLayoutReset", "#touchLayoutSave", "#touchLayoutExit", "#doubleTapBombToggle",
  "#restartButtonToggle", "#thpracTouchControlsToggle", "#touchSensitivityCustomToggle", "#touchViewportAdjust",
  "#touchViewportReset", "#touchViewportDone", "#touchFocus", "#touchFire",
  "#touchBomb", "#touchEscape", "#touchRestart", "#touchThpracInput", "#touchThpracTab",
  "#touchThpracBackspace", "#touchHelpOpen", "#touchHelpClose", "#guideTabOrientation",
  "#guideTabGameControls", "#guideTabFocus", "#guideTabMenu", "#guideTabDialogue",
  "#guideTabThprac", "#orientationToggle", "#gameZoomToggle", "#fullscreenToggle",
] as const;

type InputElementSelector = (typeof inputElementSelectors)[number];
type SelectElementSelector = (typeof selectElementSelectors)[number];
type DialogElementSelector = (typeof dialogElementSelectors)[number];
type AnchorElementSelector = (typeof anchorElementSelectors)[number];
type OutputElementSelector = (typeof outputElementSelectors)[number];
type ButtonElementSelector = (typeof buttonElementSelectors)[number];
type LauncherElementForSelector<S extends string> =
  S extends "#gameFrame" ? HTMLIFrameElement :
  S extends InputElementSelector ? HTMLInputElement :
  S extends SelectElementSelector ? HTMLSelectElement :
  S extends DialogElementSelector ? HTMLDialogElement :
  S extends AnchorElementSelector ? HTMLAnchorElement :
  S extends OutputElementSelector ? HTMLOutputElement :
  S extends ButtonElementSelector ? HTMLButtonElement :
  HTMLElement;

const inputElementSelectorSet = new Set<string>(inputElementSelectors);
const selectElementSelectorSet = new Set<string>(selectElementSelectors);
const dialogElementSelectorSet = new Set<string>(dialogElementSelectors);
const anchorElementSelectorSet = new Set<string>(anchorElementSelectors);
const outputElementSelectorSet = new Set<string>(outputElementSelectors);
const buttonElementSelectorSet = new Set<string>(buttonElementSelectors);

function $<S extends string>(selector: S): LauncherElementForSelector<S> {
  const element = document.querySelector<HTMLElement>(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing Launcher DOM contract: ${selector}`);
  const expected = selector === "#gameFrame" ? HTMLIFrameElement
    : anchorElementSelectorSet.has(selector) ? HTMLAnchorElement
    : outputElementSelectorSet.has(selector) ? HTMLOutputElement
    : inputElementSelectorSet.has(selector) ? HTMLInputElement
    : selectElementSelectorSet.has(selector) ? HTMLSelectElement
    : dialogElementSelectorSet.has(selector) ? HTMLDialogElement
    : buttonElementSelectorSet.has(selector) ? HTMLButtonElement
    : null;
  if (expected && !(element instanceof expected)) throw new Error(`invalid Launcher DOM contract: ${selector}`);
  return element as LauncherElementForSelector<S>;
}

let mpSettingsRoomDrawerOpen = false;
let mpSettingsRoomDrawerClosing = false;
let mpSettingsRoomDrawerCloseGeneration = 0;
function setMpSettingsRoomDrawerOpen(open: boolean) {
  const roomOpen = !!mpUiState.room;
  const drawer = $("#mpSettingsRoomDrawer");
  const cue = $("#mpSettingsRoomDrawerToggle");
  const generation = ++mpSettingsRoomDrawerCloseGeneration;
  if (roomOpen && open) {
    mpSettingsRoomDrawerOpen = true;
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    drawer.hidden = false;
    cue.hidden = true;
    cue.setAttribute("aria-expanded", "true");
    return;
  }
  mpSettingsRoomDrawerOpen = false;
  cue.setAttribute("aria-expanded", "false");
  if (drawer.hidden) {
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    cue.hidden = !roomOpen;
    return;
  }
  if (!roomOpen || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    drawer.hidden = true;
    cue.hidden = !roomOpen;
    return;
  }
  mpSettingsRoomDrawerClosing = true;
  drawer.classList.add("closing");
  cue.hidden = true;
  setTimeout(() => {
    if (generation !== mpSettingsRoomDrawerCloseGeneration) return;
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    drawer.hidden = true;
    cue.hidden = !mpUiState.room;
  }, 220);
}

function syncMpSettingsRoomDrawer(roomOpen: boolean) {
  const fold = $("#mpSettingsFold");
  const body = document.querySelector<HTMLElement>('[data-mp-fold-body="settings"]');
  const head = document.querySelector<HTMLElement>('[data-mp-fold="settings"]');
  const cue = $("#mpSettingsRoomDrawerToggle");
  const drawer = $("#mpSettingsRoomDrawer");
  const drawerContent = $("#mpSettingsRoomDrawerContent");
  const shell = $("#mpShell");
  const onlineFold = $("#mpOnlineFold");
  cue.hidden = !roomOpen || mpSettingsRoomDrawerOpen || mpSettingsRoomDrawerClosing;
  if (roomOpen) {
    if (fold.parentElement !== drawerContent) drawerContent.append(fold);
    fold.classList.add("mp-room-drawer-mounted");
    if (head) head.hidden = true;
    if (body) {
      body.hidden = false;
      body.inert = false;
      body.setAttribute("aria-hidden", "false");
    }
    return;
  }
  setMpSettingsRoomDrawerOpen(false);
  if (fold.parentElement !== shell) shell.insertBefore(fold, onlineFold);
  fold.classList.remove("mp-room-drawer-mounted");
  if (head) head.hidden = false;
  mpSetFold("settings", mpUiState.folds.settings);
}

function requiredDescendant<T extends HTMLElement>(root: ParentNode, selector: string, expected: { new(): T }): T {
  const element = root.querySelector<HTMLElement>(selector);
  if (!(element instanceof expected)) throw new Error(`missing Launcher DOM contract: ${selector}`);
  return element;
}
const guideOrientationTitle = $("#guideOrientationTitle");
const guideOrientationSummary = $("#guideOrientationSummary");
const guideOrientationAndroid = $("#guideOrientationAndroid");
const guideOrientationIos = $("#guideOrientationIos");
if (showIosFullscreenHelp) {
  guideOrientationTitle.textContent = t("help.iphoneFullscreen");
  guideOrientationSummary.textContent = t("help.iphoneFullscreenSummary");
  guideOrientationAndroid.hidden = true;
  guideOrientationIos.hidden = false;
}
const frame = $("#gameFrame");
const gameViewport = $("#gameViewport");
const player = $("#player");
const playerFullscreenElement: LauncherFullscreenElement = player;
const runtimeDiagnostics = $("#runtimeDiagnostics");
const runtimeDiagnosticsToggle = $("#runtimeDiagnosticsToggle");
const runtimeBrowserDiag = $("#runtimeBrowserDiag");
const runtimeGapDiag = $("#runtimeGapDiag");
const runtimeAudioDiag = $("#runtimeAudioDiag");
const runtimeRendererDiag = $("#runtimeRendererDiag");
const runtimeNetplaySessionDiag = $("#runtimeNetplaySessionDiag");
const runtimeNetplayRouteDiag = $("#runtimeNetplayRouteDiag");
const runtimeNetplayFrameDiag = $("#runtimeNetplayFrameDiag");
const runtimeNetplayRollbackDiag = $("#runtimeNetplayRollbackDiag");
const runtimeNetplayQualityDiag = $("#runtimeNetplayQualityDiag");
const runtimeNetplayIceDiag = $("#runtimeNetplayIceDiag");
const runtimeDiagnosticState: RuntimeDiagnosticState = {
  fps: null,
  maxGapMs: null,
  hostRafHz: null,
  childRafHz: null,
  minQueuedMs: null,
  backend: "",
  underruns: 0,
  robust: false,
  renderer: ""
};
function runtimeDiagnosticsEnabled() {
  return runtimeDiagnosticsPreference ?? manifest.shared.testBuild === true;
}
function syncRuntimeDiagnosticsToggle() {
  runtimeDiagnosticsToggle.setAttribute("aria-checked", String(runtimeDiagnosticsEnabled()));
}
let runtimeSchedulingProbeSerial = 0;
let runtimeSchedulingProbeTimer: ReturnType<typeof setInterval> | null = null;

function stopRuntimeSchedulingProbe() {
  runtimeSchedulingProbeSerial++;
  clearOptionalInterval(runtimeSchedulingProbeTimer);
  runtimeSchedulingProbeTimer = null;
}

function startRuntimeSchedulingProbe() {
  stopRuntimeSchedulingProbe();
  const serial = runtimeSchedulingProbeSerial;
  const runtimeWindow = currentRuntimeWindow();
  if (!runtimeWindow?.requestAnimationFrame) return;
  let hostWindowStart = performance.now();
  let hostFrames = 0;
  let childWindowStart = performance.now();
  let childFrames = 0;

  const hostFrame = () => {
    if (serial !== runtimeSchedulingProbeSerial || !state.launched) return;
    const now = performance.now();
    hostFrames++;
    const elapsed = now - hostWindowStart;
    if (elapsed >= 500) {
      runtimeDiagnosticState.hostRafHz = hostFrames * 1000 / elapsed;
      hostFrames = 0;
      hostWindowStart = now;
    }
    requestAnimationFrame(hostFrame);
  };

  const childFrame = () => {
    if (serial !== runtimeSchedulingProbeSerial || !state.launched || frame.contentWindow !== runtimeWindow) return;
    const now = performance.now();
    childFrames++;
    const elapsed = now - childWindowStart;
    if (elapsed >= 500) {
      runtimeDiagnosticState.childRafHz = childFrames * 1000 / elapsed;
      childFrames = 0;
      childWindowStart = now;
    }
    runtimeWindow.requestAnimationFrame(childFrame);
  };

  requestAnimationFrame(hostFrame);
  runtimeWindow.requestAnimationFrame(childFrame);
  runtimeSchedulingProbeTimer = setInterval(() => {
    if (serial !== runtimeSchedulingProbeSerial || !state.launched || frame.contentWindow !== runtimeWindow) return;
    updateRuntimeDiagnostics();
  }, 500);
}
interface RuntimePeer {
  pc?: RTCPeerConnection | null;
}

interface RuntimePeerCollection extends Iterable<[number, RuntimePeer]> {
  size: number;
  get(player: number): RuntimePeer | undefined;
}

interface RuntimePeerTransport {
  peers: RuntimePeerCollection;
  relay?: { readyState?: unknown } | null;
  rtcReadySent?: boolean;
  failed?: boolean;
  error?: string;
}

interface RuntimeNetplayEntry extends UnknownRecord {
  player?: unknown;
  gap?: unknown;
  predicted?: unknown;
  rollbacks?: unknown;
  peer?: unknown;
  path?: unknown;
  protocol?: unknown;
  family?: unknown;
}

interface RuntimeNetplaySnapshot {
  mode: string;
  active: boolean;
  spectator: boolean;
  transport: string;
  path: string;
  frame: number | null;
  confirmed: number | null;
  rollback: number | null;
  resimulated: number | null;
  advantage: number | null;
  pacing: number | null;
  rtcPaths: RuntimeNetplayEntry[];
  lanPeers: RuntimeNetplayEntry[];
  peerCount: number | null;
  rtcReady: boolean;
  failed: boolean;
  error: string;
  peerState: RuntimePeerTransport | null;
}

interface RuntimePeerQuality {
  samples: number[];
  rttMs: number | null;
  variationMs: number | null;
  connectionState: string;
  iceState: string;
}

const runtimeNetplayQualityState: {
  peerTransport: RuntimePeerTransport | null;
  sampling: boolean;
  peers: Map<number, RuntimePeerQuality>;
  confirmed: number | null;
  confirmedAt: number | null;
} = {
  peerTransport: null,
  sampling: false,
  peers: new Map<number, RuntimePeerQuality>(),
  confirmed: null,
  confirmedAt: null,
};
const netplayConnectionUiState: {
  transport: RuntimePeerTransport | null;
  connectedOnce: boolean;
  routeWarningShown: boolean;
} = { transport: null, connectedOnce: false, routeWarningShown: false };
const browserEnvironment = describeBrowserEnvironment({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  userAgentDataPlatform: launcherNavigator.userAgentData?.platform,
  mobile: launcherNavigator.userAgentData?.mobile,
  brave: !!launcherNavigator.brave,
});
function setRuntimeDiagnostic(element: HTMLElement, value: unknown) {
  element.textContent = compactDiagnosticText(value);
}
function resetRuntimeDiagnostics() {
  stopRuntimeSchedulingProbe();
  Object.assign(runtimeDiagnosticState, {
    fps: null, maxGapMs: null,
    hostRafHz: null, childRafHz: null,
    minQueuedMs: null,
    backend: "", underruns: 0, robust: false, renderer: ""
  });
  setRuntimeDiagnostic(runtimeBrowserDiag, t("diagnostics.browser", { value: browserEnvironment.browser }));
  setRuntimeDiagnostic(runtimeGapDiag, t("diagnostics.maxGap", { value: "--" }));
  setRuntimeDiagnostic(runtimeAudioDiag, t("diagnostics.audio", { value: "--" }));
  setRuntimeDiagnostic(runtimeRendererDiag, t("diagnostics.graphics", { value: "--" }));
  for (const line of [runtimeNetplaySessionDiag, runtimeNetplayRouteDiag, runtimeNetplayFrameDiag, runtimeNetplayRollbackDiag, runtimeNetplayQualityDiag, runtimeNetplayIceDiag]) {
    line.hidden = true;
  }
  runtimeDiagnostics.classList.remove("warn", "bad");
  runtimeDiagnostics.hidden = true;
  resetRuntimeNetplayQuality();
  netplayConnectionUiState.transport = null;
  netplayConnectionUiState.connectedOnce = false;
  netplayConnectionUiState.routeWarningShown = false;
  const connectionWindow = $("#netplayConnectionWindow");
  if (connectionWindow) connectionWindow.hidden = true;
}
function resetRuntimeNetplayQuality(peerTransport: RuntimePeerTransport | null = null) {
  runtimeNetplayQualityState.peerTransport = peerTransport;
  runtimeNetplayQualityState.sampling = false;
  runtimeNetplayQualityState.peers.clear();
  runtimeNetplayQualityState.confirmed = null;
  runtimeNetplayQualityState.confirmedAt = null;
}
function runtimeGlobal(runtime: RuntimeWindow | null, name: string): unknown {
  if (!runtime) return undefined;
  try { return (runtime as unknown as UnknownRecord)[name]; }
  catch { return undefined; }
}

function runtimePeerTransport(value: unknown): RuntimePeerTransport | null {
  const source = record(value);
  const peers = record(source?.peers);
  const iterable = peers as object as { [Symbol.iterator]?: unknown };
  if (!source || !peers || typeof peers.get !== "function" || typeof iterable[Symbol.iterator] !== "function") return null;
  return source as unknown as RuntimePeerTransport;
}

function runtimeNetplayEntries(value: unknown, limit: number): RuntimeNetplayEntry[] {
  return Array.isArray(value)
    ? value.flatMap(entry => {
        const item = record(entry);
        return item ? [item as RuntimeNetplayEntry] : [];
      }).slice(0, limit)
    : [];
}

function runtimeNetplaySnapshot(): RuntimeNetplaySnapshot | null {
  // Product selection alone is not proof that the running game is the LAN
  // Runtime. Never show multiplayer diagnostics over an ordinary game, but
  // keep probing a dedicated multiplayer product even if runtimeVariant was
  // accidentally downgraded - that mismatch is itself diagnostic evidence.
  const multiplayerSurface = state.runtimeVariant === "multiplayer" || isMultiplayerProduct();
  const multiplayer = multiplayerConfigForProduct(state.product);
  if (!multiplayer || !multiplayerSurface) return null;
  let runtime = null;
  try { runtime = currentRuntimeWindow(); } catch {}
  const value = (name: string) => runtimeGlobal(runtime, name);
  const number = (name: string) => {
    const parsed = Number(value(name));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rawRtcPaths = value("__eaglerNetplayRtcPaths");
  const rtcPaths = runtimeNetplayEntries(rawRtcPaths, 2);
  const rawLanPeers = value("__eaglerNetplayLanPeers");
  const lanPeers = runtimeNetplayEntries(rawLanPeers, 3);
  const peerState = runtimePeerTransport(value(multiplayer.peerTransportGlobal));
  let mode = "";
  try { mode = String(runtime?.Module?.eaglerOptions?.netplayMode || ""); } catch {}
  if (mode !== "lan") return null;
  const peerSize = Number(peerState?.peers?.size);
  return {
    mode,
    active: value("__eaglerNetplayLanActive") === true,
    spectator: value("__eaglerNetplaySpectator") === true || state.netplay.spectator === true,
    transport: String(value("__eaglerNetplayTransport") || "connecting"),
    path: String(value("__eaglerNetplayPath") || "connecting"),
    frame: number("__eaglerNetplayLanFrame"),
    confirmed: number("__eaglerNetplayLanConfirmed"),
    rollback: number("__eaglerNetplayLanRollback"),
    resimulated: number("__eaglerNetplayLanResimulated"),
    advantage: number("__eaglerNetplayLanFrameAdvantage"),
    pacing: number("__eaglerNetplayLanPacingScale"),
    rtcPaths,
    lanPeers,
    peerCount: Number.isFinite(peerSize) && peerSize >= 0 ? peerSize : null,
    rtcReady: peerState?.rtcReadySent === true,
    failed: peerState?.failed === true,
    error: typeof peerState?.error === "string" ? peerState.error : "",
    peerState,
  };
}
function updateNetplayConnectionWindow(net: RuntimeNetplaySnapshot | null) {
  const windowElement = $("#netplayConnectionWindow");
  if (!windowElement) return;
  if (!net || state.replayViewer || !net.peerState) {
    windowElement.hidden = true;
    return;
  }
  if (!net.spectator && netplayConnectionUiState.transport !== net.peerState) {
    netplayConnectionUiState.transport = net.peerState;
    netplayConnectionUiState.connectedOnce = false;
    netplayConnectionUiState.routeWarningShown = false;
  }
  const view = describeNetplayConnection({
    spectator: net.spectator,
    failed: net.failed,
    error: net.error,
    transport: net.transport,
    path: net.path,
    peerState: net.peerState,
    playerCount: state.netplay.playerCount,
    localPlayer: state.netplay.player,
    connectedOnce: netplayConnectionUiState.connectedOnce,
    routeWarningShown: netplayConnectionUiState.routeWarningShown,
    webSocketOpenState: WebSocket.OPEN,
  });
  netplayConnectionUiState.connectedOnce = view.connectedOnce;
  if (view.showRouteWarning) {
    netplayConnectionUiState.routeWarningShown = true;
    showToast(t("multiplayer.directConnectionFailed"), 8000);
  }
  windowElement.hidden = view.hidden;
  windowElement.classList.toggle("reconnecting", view.reconnecting);
  if (view.hidden) return;
  $("#netplayConnectionTitle").textContent = view.title;
  $("#netplayConnectionSummary").textContent = view.summary;
  const peersElement = $("#netplayConnectionPeers");
  peersElement.replaceChildren(...view.peerRows.map(row => {
    const item = document.createElement("div");
    item.className = "netplay-connection-peer";
    const label = document.createElement("span"); label.textContent = `P${row.player + 1} ${row.status}`;
    const detail = document.createElement("span"); detail.textContent = row.detail;
    item.append(label, detail);
    return item;
  }));
  const warning = $("#netplayConnectionWarning");
  warning.hidden = !view.warning;
  warning.textContent = view.warning;
}
async function sampleRuntimeNetplayQuality() {
  const net = runtimeNetplaySnapshot();
  const transport = net?.peerState;
  if (!net || net.transport !== "rtc" || !transport?.peers) {
    if (runtimeNetplayQualityState.peerTransport) resetRuntimeNetplayQuality();
    return;
  }
  if (runtimeNetplayQualityState.peerTransport !== transport) resetRuntimeNetplayQuality(transport);
  if (runtimeNetplayQualityState.sampling) return;
  runtimeNetplayQualityState.sampling = true;
  try {
      const seenPeers = new Set<number>();
    for (const [peerId, peer] of transport.peers) {
      if (!peer?.pc || typeof peer.pc.getStats !== "function") continue;
      seenPeers.add(peerId);
      const stats = await peer.pc.getStats();
      const pair = selectedRtcPair(stats);
      const rttMs = Number(pair?.currentRoundTripTime) * 1000;
      let quality = runtimeNetplayQualityState.peers.get(peerId);
      if (!quality) {
        quality = { samples: [], rttMs: null, variationMs: null, connectionState: "", iceState: "" };
        runtimeNetplayQualityState.peers.set(peerId, quality);
      }
      quality.connectionState = String(peer.pc.connectionState || "");
      quality.iceState = String(peer.pc.iceConnectionState || "");
      if (Number.isFinite(rttMs) && rttMs >= 0) {
        const next = appendRttSample(quality.samples, rttMs);
        quality.samples = next.samples;
        quality.rttMs = next.rttMs;
        quality.variationMs = next.variationMs;
      }
    }
    for (const peerId of runtimeNetplayQualityState.peers.keys()) {
      if (!seenPeers.has(peerId)) runtimeNetplayQualityState.peers.delete(peerId);
    }
  } catch {
    // A peer can disappear between the snapshot and getStats. The next
    // one-second sample will either observe its replacement or clear state.
  } finally {
    runtimeNetplayQualityState.sampling = false;
  }
}
function updateNetplayDiagnostics() {
  const net = runtimeNetplaySnapshot();
  updateNetplayConnectionWindow(net);
  const lines = [runtimeNetplaySessionDiag, runtimeNetplayRouteDiag, runtimeNetplayFrameDiag, runtimeNetplayRollbackDiag, runtimeNetplayQualityDiag, runtimeNetplayIceDiag];
  for (const line of lines) line.hidden = !net;
  if (!net) return;

  const room = String(mpUiState.room?.code || "--");
  const playerIndex = Math.max(0, Number(state.netplay.player) || 0);
  const playerCount = Math.max(2, Number(state.netplay.playerCount) || 2);
  const role = net.spectator ? t("diagnostics.netplayRoleSpectator", { players: playerCount }) : `P${playerIndex + 1}/${playerCount}`;
  setRuntimeDiagnostic(runtimeNetplaySessionDiag, t("diagnostics.netplayRuntime", {
    room, role, runtime: `${state.runtimeVariant}/${net.mode || "--"}`,
  }));

  const transport = net.transport === "rtc" ? "RTC" : net.transport === "relay" ? "WS Relay" : net.transport === "spectator"
    ? t("diagnostics.transportSpectator") : t("diagnostics.transportConnecting");
  const route = net.transport === "relay" ? "relay" : net.path;
  const expectedPeers = Math.max(1, playerCount - 1);
  const peerStatus = net.spectator ? t("diagnostics.peerSpectator") : net.peerCount == null ? "peers --" : `peers ${net.peerCount}/${expectedPeers}${net.rtcReady ? " ready" : ""}`;
  setRuntimeDiagnostic(runtimeNetplayRouteDiag, t("diagnostics.network", {
    transport, route,
    peers: peerStatus,
    failure: net.failed ? ` - FAIL ${net.error || "transport"}` : "",
  }));

  const frame = net.active && net.frame != null ? Math.max(0, Math.trunc(net.frame)) : null;
  const confirmed = net.confirmed != null && net.confirmed >= 0 && net.confirmed < 0xffffffff
    ? Math.trunc(net.confirmed) : null;
  if (confirmed != null && confirmed !== runtimeNetplayQualityState.confirmed) {
    runtimeNetplayQualityState.confirmed = confirmed;
    runtimeNetplayQualityState.confirmedAt = performance.now();
  }
  const peerFrames = net.lanPeers
    .map(peer => `P${Number(peer.player) + 1} gap ${Math.max(0, Math.trunc(Number(peer.gap) || 0))}/pred ${Math.max(0, Math.trunc(Number(peer.predicted) || 0))}/rb ${Math.max(0, Math.trunc(Number(peer.rollbacks) || 0))}`)
    .join(" - ");
  setRuntimeDiagnostic(runtimeNetplayFrameDiag, net.active
    ? t("diagnostics.sync", { frame: frame ?? "--", confirmed: confirmed ?? "--", peers: peerFrames ? ` - ${peerFrames}` : "" })
    : t("diagnostics.syncWaiting"));

  const rollback = net.rollback != null ? Math.max(0, Math.trunc(net.rollback)) : 0;
  const resimulated = net.resimulated != null ? Math.max(0, Math.trunc(net.resimulated)) : 0;
  const advantage = net.advantage != null ? `${net.advantage >= 0 ? "+" : ""}${net.advantage.toFixed(2)}` : "--";
  const pacing = net.pacing != null ? net.pacing.toFixed(4) : "--";
  setRuntimeDiagnostic(runtimeNetplayRollbackDiag, net.spectator
    ? t("diagnostics.spectatorRollback")
    : t("diagnostics.rollback", { rollback, resimulated, advantage, pacing }));

  const confirmedAgeMs = runtimeNetplayQualityState.confirmedAt == null
    ? null : Math.max(0, performance.now() - runtimeNetplayQualityState.confirmedAt);
  const qualities = [...runtimeNetplayQualityState.peers.values()];
  const rttValues = qualities.map(quality => quality.rttMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const variationValues = qualities.map(quality => quality.variationMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const iceStates = [...new Set(qualities
    .map(quality => quality.iceState || quality.connectionState)
    .filter(Boolean))];
  setRuntimeDiagnostic(runtimeNetplayQualityDiag, t("diagnostics.quality", {
    rtt: rttValues.length ? `${Math.round(Math.max(...rttValues))}ms` : "--",
    variation: variationValues.length ? `${Math.round(Math.max(...variationValues))}ms` : "--",
    stall: net.active && confirmedAgeMs != null ? `${(confirmedAgeMs / 1000).toFixed(1)}s` : "--",
  }) + ` - ICE ${iceStates.join("/") || "--"}`);
  setRuntimeDiagnostic(runtimeNetplayIceDiag, net.rtcPaths.length
    ? `ICE ${net.rtcPaths.map(entry => `P${Number(entry.peer) + 1} ${entry.path || "?"}/${String(entry.protocol || "?").toLowerCase()}/${entry.family || "?"}`).join(" - ")}`
    : net.transport === "relay" ? t("diagnostics.iceFallback") : t("diagnostics.iceCandidates"));
}
function updateRuntimeDiagnostics() {
  const diag = runtimeDiagnosticState;
  setRuntimeDiagnostic(runtimeBrowserDiag, t("diagnostics.browser", { value: browserEnvironment.browser }));
  const hz = (value: number | null) => value != null && Number.isFinite(value) ? Math.round(value) : "--";
  setRuntimeDiagnostic(runtimeGapDiag, [
    t("diagnostics.frameShort", { hz: hz(diag.hostRafHz), age: "" }),
    `C${hz(diag.childRafHz)}`,
    `P${hz(diag.fps)}`,
    `gap ${diag.maxGapMs != null && Number.isFinite(diag.maxGapMs) ? `${Math.round(diag.maxGapMs)}ms` : "--"}`,
    `lock ${state.options.frameLimit60Enabled ? "60" : "off"}`
  ].join(" - "));
  const backend = diag.backend === "worklet" ? "AW" : diag.backend === "script" ? "SP" : "";
  const audioParts = [
    diag.minQueuedMs != null && Number.isFinite(diag.minQueuedMs) ? `${Math.max(0, Math.round(diag.minQueuedMs))}ms` : "--",
    backend,
    diag.robust ? t("diagnostics.audioRobust") : "",
    diag.underruns > 0 ? t("diagnostics.audioUnderruns", { count: diag.underruns }) : ""
  ].filter(Boolean);
  setRuntimeDiagnostic(runtimeAudioDiag, t("diagnostics.audio", { value: audioParts.join(" ") }));
  setRuntimeDiagnostic(runtimeRendererDiag, t("diagnostics.graphics", { value: compactRendererLabel(diag.renderer) }));
  updateNetplayDiagnostics();

  const softwareRenderer = /SwiftShader|llvmpipe|software raster/i.test(diag.renderer);
  const audioBad = diag.underruns > 0 || (diag.minQueuedMs != null && Number.isFinite(diag.minQueuedMs) && diag.minQueuedMs < 5);
  const frameBad = diag.maxGapMs != null && Number.isFinite(diag.maxGapMs) && diag.maxGapMs >= 80;
  const audioWarn = diag.minQueuedMs != null && Number.isFinite(diag.minQueuedMs) && diag.minQueuedMs < 20;
  const frameWarn = diag.maxGapMs != null && Number.isFinite(diag.maxGapMs) && diag.maxGapMs >= 35;
  runtimeDiagnostics.classList.toggle("bad", softwareRenderer || audioBad || frameBad);
  runtimeDiagnostics.classList.toggle("warn", !softwareRenderer && !audioBad && !frameBad && (audioWarn || frameWarn));
  runtimeDiagnostics.hidden = !runtimeDiagnosticsVisibleByDefault(manifest.shared.testBuild, state.launched, runtimeDiagnosticsPreference);
}
window.setInterval(() => {
  if (state.launched && (isMultiplayerProduct() || state.runtimeVariant === "multiplayer")) updateRuntimeDiagnostics();
}, 250);
window.setInterval(() => {
  if (state.launched && (isMultiplayerProduct() || state.runtimeVariant === "multiplayer")) sampleRuntimeNetplayQuality();
}, 1000);
const gameZoomToggle = $("#gameZoomToggle");
const orientationToggle = $("#orientationToggle");
const touchThpracInput = $("#touchThpracInput");
const touchThpracTab = $("#touchThpracTab");
const touchThpracMenu = $("#touchThpracMenu");
const touchThpracFunctionKeys = $("#touchThpracFunctionKeys");
const touchDirectSurface = $("#touchDirectSurface");
const touchLayoutSafeZone = $("#touchLayoutSafeZone");
const touchSensitivityPreview = $("#touchSensitivityPreview");
const touchLayoutElement = (name: TouchLayoutControlName) => $("#" + touchLayoutControlMeta[name].id);
function touchLayoutOrientation(): TouchLayoutOrientation {
  const width = window.visualViewport?.width || document.documentElement.clientWidth || player.clientWidth;
  const height = window.visualViewport?.height || document.documentElement.clientHeight || player.clientHeight;
  return width >= height ? "landscape" : "portrait";
}
function currentTouchLayout(): TouchLayout | null { return touchLayoutEditing ? touchLayoutDraft : touchLayout; }
function currentTouchViewportPosition(layout: TouchLayout | null = currentTouchLayout()) {
  return layout?.profiles?.[touchLayoutOrientation()]?.viewport || { x: 0 };
}
function gameViewportBaseOffsetPx(layout: TouchLayout | null = currentTouchLayout()) {
  const viewport = currentTouchViewportPosition(layout);
  return { x: viewport.x * player.clientWidth, y: 0 };
}
const gameZoom = createGameZoomController({
  player,
  frame,
  viewport: gameViewport,
  toggle: gameZoomToggle,
  toggleLabel: requiredDescendant(gameZoomToggle, "strong", HTMLElement),
  scaleLabel: $("#gameZoomScale"),
  directSurface: touchDirectSurface,
  getBaseOffset: () => gameViewportBaseOffsetPx(),
  getResetLabel: () => t("action.reset"),
  isAvailable: () => state.options.magnifierEnabled &&
    (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing,
  minScale: 1,
  maxScale: 3,
});
function clearTouchLayoutStyles() {
  player.classList.remove("touch-layout-custom");
  for (const name of touchLayoutControlNames) {
    const element = touchLayoutElement(name);
    element.style.removeProperty("--touch-layout-x");
    element.style.removeProperty("--touch-layout-y");
    element.style.removeProperty("--touch-layout-scale");
    element.style.removeProperty("z-index");
  }
}
function effectiveTouchLayoutPosition(element: HTMLElement, item: TouchLayoutControlPlacement) {
  const safeRect = touchLayoutSafeZone.getBoundingClientRect();
  const width = safeRect.width;
  const height = safeRect.height;
  if (!width || !height) return { x: item.x, y: item.y };
  const marginX = Math.min(.48, ((element.offsetWidth * item.scale) / 2 + 6) / width);
  const marginY = Math.min(.48, ((element.offsetHeight * item.scale) / 2 + 6) / height);
  return {
    x: Math.max(marginX, Math.min(1 - marginX, item.x)),
    y: Math.max(marginY, Math.min(1 - marginY, item.y))
  };
}
function applyTouchLayout(layout: TouchLayout | null = currentTouchLayout()) {
  const profile = layout?.profiles?.[touchLayoutOrientation()] || null;
  if (!profile) {
    clearTouchLayoutStyles();
    if (state.launched || touchLayoutEditing) gameZoom.applyTransform();
    return;
  }
  const hostRect = player.getBoundingClientRect();
  const safeRect = touchLayoutSafeZone.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height || !safeRect.width || !safeRect.height) return;
  player.classList.add("touch-layout-custom");
  for (const name of touchLayoutControlNames) {
    const item = profile.controls[name];
    if (!item) continue;
    const element = touchLayoutElement(name);
    const position = effectiveTouchLayoutPosition(element, item);
    const x = safeRect.left - hostRect.left + position.x * safeRect.width;
    const y = safeRect.top - hostRect.top + position.y * safeRect.height;
    element.style.setProperty("--touch-layout-x", `${x}px`);
    element.style.setProperty("--touch-layout-y", `${y}px`);
    element.style.setProperty("--touch-layout-scale", String(item.scale));
    element.style.zIndex = String(31 + (Number.isFinite(item.priority) ? item.priority : touchLayoutControlMeta[name].priority));
  }
  if (state.launched || touchLayoutEditing) gameZoom.applyTransform();
}
function captureDefaultTouchLayoutProfile() {
  const hiddenStates = new Map(touchLayoutControlNames.map(name => [name, touchLayoutElement(name).hidden]));
  player.classList.add("touch-layout-capturing");
  for (const name of touchLayoutControlNames) touchLayoutElement(name).hidden = false;
  clearTouchLayoutStyles();
  try {
    const safe = touchLayoutSafeZone.getBoundingClientRect();
    if (safe.width <= 0 || safe.height <= 0) throw new Error(t("touch.previewUnavailable"));
    const controls: Partial<Record<TouchLayoutControlName, TouchLayoutControlPlacement>> = {};
    for (const name of touchLayoutControlNames) {
      const rect = touchLayoutElement(name).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error(t("touch.controlHidden", { control: touchLayoutControlTitle(name) }));
      controls[name] = {
        x: Math.max(0, Math.min(1, (rect.left + rect.width / 2 - safe.left) / safe.width)),
        y: Math.max(0, Math.min(1, (rect.top + rect.height / 2 - safe.top) / safe.height)),
        scale: 1,
        priority: touchLayoutControlMeta[name].priority
      };
    }
    return { controls: normalizeTouchLayoutPriorityOrder(controls), viewport: { x: 0 } };
  } finally {
    for (const [name, hidden] of hiddenStates) touchLayoutElement(name).hidden = hidden;
    player.classList.remove("touch-layout-capturing");
  }
}
function ensureTouchLayoutDraftProfile() {
  if (!touchLayoutDraft) touchLayoutDraft = emptyTouchLayout();
  const orientation = touchLayoutOrientation();
  if (!touchLayoutDraft.profiles[orientation]) {
    touchLayoutDraft.profiles[orientation] = captureDefaultTouchLayoutProfile();
  } else {
    const profile = touchLayoutDraft.profiles[orientation];
    if (!profile) throw new Error("touch layout profile was not created");
    const missing = touchLayoutControlNames.filter(name => !profile.controls[name]);
    if (missing.length) {
      const defaults = captureDefaultTouchLayoutProfile();
      for (const name of missing) {
        const defaultItem = defaults.controls[name];
        if (defaultItem) profile.controls[name] = { ...defaultItem };
      }
      normalizeTouchLayoutPriorityOrder(profile.controls);
      // Missing fields here are schema-extension migration (not an editor
      // action): mirror them into the saved baseline so merely opening an old
      // four-control layout does not create a false "unsaved changes" prompt.
      if (touchLayout?.profiles?.[orientation]) {
        const savedProfile = touchLayout.profiles[orientation];
        if (savedProfile) {
          for (const name of missing) {
            const defaultItem = defaults.controls[name];
            if (defaultItem) savedProfile.controls[name] = { ...defaultItem };
          }
          normalizeTouchLayoutPriorityOrder(savedProfile.controls);
        }
        touchLayout = persistTouchLayoutToStorage(localStorage, touchLayout);
      }
      applyTouchLayout(touchLayoutDraft);
    }
  }
  const profile = touchLayoutDraft.profiles[orientation];
  if (!profile) throw new Error("touch layout profile was not created");
  return profile;
}
function requiredTouchLayoutPlacement(profile: TouchLayoutProfile, name: TouchLayoutControlName): TouchLayoutControlPlacement {
  const item = profile.controls[name];
  if (!item) throw new Error(t("touch.layoutControlMissing", { name }));
  return item;
}
function commitTouchLayout(layout: TouchLayout) {
  const result = persistTouchLayoutResult(localStorage, layout);
  touchLayout = result.value;
  applyTouchLayout(touchLayout);
  return result;
}
function touchLayoutHasUnsavedChanges() {
  return JSON.stringify(canonicalTouchLayout(touchLayoutDraft)) !== JSON.stringify(touchLayout);
}
const maxImportBytes = 128 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
const maxReplayArchiveExpandedBytes = 128 * 1024 * 1024;
let midiSynth: MidiSynth | null = null;
let gameKeyWindow: RuntimeWindow | null = null;
let fullscreenChordActive = false;
const routedGameFromLocation = () => routedProductFromUrl(location.href, productIds);
function replaceLauncherHomeHistory() {
  applyHistoryOperations(history, [launcherHomeHistoryOperation({
    currentUrl: location.href,
    currentState: history.state,
  })]);
}
function showLauncherHome() {
  if ($("#main").classList.contains("card-filter-motion")) cancelCardFilterMotion();
  if ($("#main").classList.contains("card-layout-motion")) cancelCardLayoutMotion();
  state.hasSelection = false;
  if (isMultiplayerProduct()) {
    state.product = state.game;
    state.runtimeVariant = "normal";
  }
  render();
  animateMobileHomeCards();
}
const routedGame = routedGameFromLocation();
const navigationEntry = performance.getEntriesByType?.("navigation")?.[0];
const navigationType = navigationEntry && "type" in navigationEntry && typeof navigationEntry.type === "string"
  ? navigationEntry.type
  : "";
const debugHarness = new URLSearchParams(location.search).get("debug");
restoreGamePreferences(state.game);
if (routedGame) {
  state.product = routedGame;
  state.game = gameIdForProduct(routedGame);
  state.runtimeVariant = isMultiplayerProduct(routedGame) ? "multiplayer" : "normal";
  restoreMpProductPreferences(routedGame);
  restoreGamePreferences(state.game, currentPreferenceId());
  state.hasSelection = true;
  applyHistoryOperations(history, initialRoutedHistoryOperations({
    currentUrl: location.href,
    currentState: history.state,
    routedProduct: routedGame,
    navigationType,
    multiplayerProduct: isMultiplayerProduct(routedGame),
  }));
}
let currentStatusMessage: { key: UiMessageKey; params: Record<string, unknown> } | null = null;
const setStatus = (text: string) => { currentStatusMessage = null; $("#status").textContent = text; };
const setTranslatedStatus = (key: UiMessageKey, params: Record<string, unknown> = {}) => {
  currentStatusMessage = { key, params };
  $("#status").textContent = t(key, params);
};
const setPlayerStatus = (text: string) => { $("#playerStatus").textContent = text; };
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toastDurationMs = 2000;
type DecisionChoice = "confirm" | "cancel" | "secondary";
let decisionResolver: ((choice: DecisionChoice) => void) | null = null;
let decisionFocusReturn: HTMLElement | null = null;
let transferSpeed = 0;
let transferMode: TransferMode = "";
let transferKind: TransferKind = "";
let transferHideTimer: ReturnType<typeof setTimeout> | null = null;
interface BlockingNetworkOperation { controller: AbortController; label: string; onCancel: (() => void) | null }
let blockingNetworkOperation: BlockingNetworkOperation | null = null;
const backgroundPackageUpdates = new Map<GameId, Promise<unknown>>();
const backgroundOggInstalls = new Map<GameId, Promise<unknown>>();
let deferredBackgroundPackageUpdate: CurrentPackageGeneration | null = null;
let musicNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let guidePlaybackTimer: ReturnType<typeof setTimeout> | null = null;
let guideShotTimer: ReturnType<typeof setInterval> | null = null;
const gameDataStartFallbackMs = 10_000;
const gameDataCompleteFallbackMs = 20_000;
const firstFrameFallbackMs = 12_000;
let gameDataAttemptSerial = 0;
interface GameDataAttempt {
  id: number;
  firstByte: boolean;
  downloadComplete: boolean;
  unlocked: boolean;
  dialogDismissed: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
  completeTimer: ReturnType<typeof setTimeout> | null;
  importFlow: boolean;
  continuation?: GameDataContinuation;
  manual?: boolean;
  blockingOperation?: BlockingNetworkOperation;
}
let gameDataAttempt: GameDataAttempt | null = null;
let firstFrameWatchdogSerial = 0;
let firstFrameWatchdog: ReturnType<typeof setTimeout> | null = null;
let firstFrameExpected = false;
let firstFrameTimedOut = false;
const androidBrowsingContextFocus = /\bAndroid\b/i.test(navigator.userAgent || "");
let playerFocusTimer: ReturnType<typeof setInterval> | null = null;
let playerFocusDeadline = 0;

function focusPlayerBrowsingContext() {
  if (!androidBrowsingContextFocus || !player.classList.contains("open") || !frame.contentWindow) return;
  try { frame.focus({ preventScroll: true }); } catch { try { frame.focus(); } catch {} }
  try { frame.contentWindow.focus(); } catch {}
}

function stopPlayerFocusRelay() {
  clearOptionalInterval(playerFocusTimer);
  playerFocusTimer = null;
  playerFocusDeadline = 0;
}

function keepPlayerFocusedDuringStartup() {
  if (!playerFocusDeadline || performance.now() >= playerFocusDeadline) {
    stopPlayerFocusRelay();
    return;
  }
  if (document.visibilityState !== "hidden") focusPlayerBrowsingContext();
}

function startPlayerFocusRelay() {
  if (!androidBrowsingContextFocus) return;
  stopPlayerFocusRelay();
  playerFocusDeadline = performance.now() + 15000;
  keepPlayerFocusedDuringStartup();
  playerFocusTimer = setInterval(keepPlayerFocusedDuringStartup, 100);
}
function hideToast() {
  clearOptionalTimeout(toastTimer);
  toastTimer = null;
  $("#toast").classList.remove("show");
}
function showToast(text: string, requestedDurationMs = toastDurationMs) {
  syncTransientOverlayHost();
  const toast = $("#toast");
  $("#toastText").textContent = text;
  clearOptionalTimeout(toastTimer);
  // Restart the fixed two-second progress bar when a toast replaces another toast.
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  toastTimer = setTimeout(hideToast, requestedDurationMs);
}
function isCancelledDownload(error: unknown) {
  return record(error)?.name === "AbortError" || /已取消下载/.test(errorMessage(error));
}
function syncTransferCancelButton() {
  const button = $("#transferCancel");
  if (!button) return;
  button.hidden = !blockingNetworkOperation;
  button.textContent = blockingNetworkOperation?.label || t("player.cancelDownload");
}
function beginBlockingNetworkOperation({ label = t("player.cancelDownload"), onCancel = null }: { label?: string; onCancel?: (() => void) | null } = {}): BlockingNetworkOperation {
  const operation = { controller: new AbortController(), label, onCancel };
  blockingNetworkOperation = operation;
  syncTransferCancelButton();
  return operation;
}
function finishBlockingNetworkOperation(operation: BlockingNetworkOperation) {
  if (blockingNetworkOperation !== operation) return;
  blockingNetworkOperation = null;
  syncTransferCancelButton();
  maybeApplyDeferredAppShellUpdate();
}
function cancelBlockingNetworkOperation() {
  const operation = blockingNetworkOperation;
  if (!operation) return;
  blockingNetworkOperation = null;
  syncTransferCancelButton();
  operation.controller.abort();
  maybeApplyDeferredAppShellUpdate();
  try { operation.onCancel?.(); } catch (error) { console.warn("blocking download cancel handler failed", error); }
}
function askDecision({ message = "", confirmText = "", cancelText = "", secondaryText = "", tone = "normal", confirmOnEnter = false }: {
  message?: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  tone?: string;
  confirmOnEnter?: boolean;
} = {}): Promise<DecisionChoice> {
  syncTransientOverlayHost();
  const dialog = $("#decisionDialog");
  if (decisionResolver || dialog.open) return Promise.resolve("cancel");
  $("#decisionTitle").textContent = t("dialog.confirmTitle");
  $("#decisionMessage").textContent = message;
  $("#decisionConfirm").textContent = confirmText || t("action.confirm");
  $("#decisionCancel").textContent = cancelText || t("action.cancel");
  const secondary = $("#decisionSecondary");
  secondary.hidden = !secondaryText;
  secondary.textContent = secondaryText || t("action.backgroundDownload");
  dialog.dataset.tone = tone;
  dialog.dataset.options = secondaryText ? "3" : "2";
  dialog.dataset.confirmOnEnter = String(!!confirmOnEnter);
  dialog.classList.remove("closing");
  decisionFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise<DecisionChoice>(resolve => {
    decisionResolver = resolve;
    dialog.returnValue = "cancel";
    dialog.showModal();
    $("#decisionCancel").focus({ preventScroll: true });
  });
}
function askConfirmation(options = {}) {
  return askDecision(options).then(value => value === "confirm");
}
function closeDecisionDialog(value = "cancel") {
  const dialog = $("#decisionDialog");
  if (!dialog.open || dialog.classList.contains("closing")) return;
  dialog.returnValue = value;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    dialog.close(value);
    return;
  }
  dialog.classList.add("closing");
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.classList.remove("closing");
    if (dialog.open) dialog.close(value);
  };
  dialog.addEventListener("animationend", event => {
    if (event.animationName === "decision-card-out") finish();
  }, { once: true });
  setTimeout(finish, 220);
}
function syncTransientOverlayHost() {
  closeOtherCustomSelects();
  const fullscreenElement = document.fullscreenElement || launcherDocument.webkitFullscreenElement;
  const host = fullscreenElement === player ? player : document.body;
  for (const id of ["toast", "startupError", "decisionDialog", "gameDataImportWindow", "gameDataLinkWindow"]) {
    const element = $("#" + id);
    if (element && element.parentNode !== host) host.append(element);
  }
}
function showStartupError(error: unknown, context = t("startup.failed"), allowAfterLaunch = false) {
  if (state.launched && !allowAfterLaunch) return;
  syncTransientOverlayHost();
  const detail = error instanceof Error ? error.stack || error.message : errorMessage(error);
  $("#startupErrorText").textContent = `[${new Date().toLocaleString()}] ${context}\n${detail}`;
  $("#startupError").hidden = false;
}
function clearFirstFrameWatchdog() {
  stopPlayerFocusRelay();
  if (firstFrameWatchdog) clearOptionalTimeout(firstFrameWatchdog);
  firstFrameWatchdog = null;
  firstFrameExpected = false;
  firstFrameTimedOut = false;
  firstFrameWatchdogSerial++;
}
function armFirstFrameWatchdog(timeoutMs = firstFrameFallbackMs) {
  clearFirstFrameWatchdog();
  const serial = firstFrameWatchdogSerial;
  const gameId = state.game;
  const startedAt = performance.now();
  firstFrameExpected = true;
  firstFrameWatchdog = setTimeout(() => {
    if (!firstFrameExpected || serial !== firstFrameWatchdogSerial || state.game !== gameId || !state.ready) return;
    firstFrameWatchdog = null;
    firstFrameTimedOut = true;
    const diagnostic = [
      "EAGLER-RUNTIME/1",
      "stage=first-frame-timeout",
      `game=${gameId}`,
      `elapsed_ms=${Math.round(performance.now() - startedAt)}`,
      `runtime_ready=${state.ready}`,
      `launch_ack=${state.launched}`,
      `online=${typeof navigator.onLine === "boolean" ? navigator.onLine : "unknown"}`,
      `visibility=${document.visibilityState || "unknown"}`,
      `source=${state.sourceIdentity || state.source || "-"}`,
      `ua=${String(navigator.userAgent || "-").slice(0, 320)}`
    ].join("\n");
    setPlayerStatus(t("runtime.firstFrameLate"));
    showStartupError(new Error(t("runtime.firstFrameDiagnostic", { diagnostic })), t("runtime.firstFrameContext", { game: gameId.toUpperCase() }), true);
  }, timeoutMs);
}
function noteFirstFrame() {
  stopPlayerFocusRelay();
  if (!firstFrameExpected) return;
  if (firstFrameWatchdog) clearOptionalTimeout(firstFrameWatchdog);
  firstFrameWatchdog = null;
  firstFrameExpected = false;
  firstFrameWatchdogSerial++;
  if (firstFrameTimedOut) clearStartupError();
  firstFrameTimedOut = false;
}
// Only the DATA acquisition stage may offer a replacement game package.
// Runtime, language and audio failures must retain their actual diagnosis.
class GameDataAcquisitionError extends Error {}
function isResourceLoadFailure(error: unknown) {
  return error instanceof GameDataAcquisitionError;
}
function clearStartupError() { $("#startupError").hidden = true; $("#startupErrorText").textContent = ""; }
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const value = Math.min(Math.ceil(seconds), 99 * 60 + 59);
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
function hideTransfer() {
  if (networkActivity.activeCount > 0) {
    renderNetworkActivity(networkActivity.snapshot());
    return;
  }
  clearOptionalTimeout(transferHideTimer);
  transferHideTimer = null;
  $("#transfer").hidden = true;
  $("#transfer").dataset.networkOwned = "0";
  $("#transfer").querySelector<HTMLElement>(".transfer-bar")?.classList.remove("indeterminate");
  $("#transferWarning").hidden = true;
  $("#playerDebug").hidden = true;
  $("#playerDebug").textContent = "";
  $("#transferRetry").hidden = true;
  syncTransferCancelButton();
  transferKind = "";
  transferMode = "";
  transferSpeed = 0;
}
function closeGameDataLinkWindow() {
  $("#gameDataLinkWindow").hidden = true;
}
function closeGameDataImportWindow(markDismissed = false) {
  $("#gameDataImportWindow").hidden = true;
  closeGameDataLinkWindow();
  if (markDismissed && gameDataAttempt) gameDataAttempt.dialogDismissed = true;
}
function closeGameDataFallbackWindows() {
  closeGameDataImportWindow(false);
}
function updateGameDataLinkWindow() {
  const open = $("#transferDownload");
  const url = $("#gameDataFallbackUrl");
  const hint = $("#gameDataFallbackHint");
  if (gameDataFallback) {
    open.disabled = false;
    open.title = t("package.fallbackLinkTitle");
    url.href = gameDataFallback.url;
    url.textContent = gameDataFallback.url;
    hint.textContent = gameDataFallback.hint || t("common.none");
  } else {
    open.disabled = true;
    open.title = t("package.fallbackLinkUnavailableTitle");
    url.removeAttribute("href");
    url.textContent = t("package.fallbackLinkUnavailable");
    hint.textContent = t("common.none");
  }
}
function setGameDataImportBusy(busy: boolean, text = t("package.importing")) {
  const window = $("#gameDataImportWindow");
  const indicator = $("#gameDataImportBusy");
  const label = $("#gameDataImportBusyText");
  const active = !!busy;
  window.setAttribute("aria-busy", String(active));
  indicator.hidden = !active;
  if (active && label) label.textContent = text;
  $("#transferImport").disabled = active;
  $("#transferDownload").disabled = active || !gameDataFallback;
  $("#gameDataImportClose").disabled = active;
}
function openGameDataImportWindow() {
  if (!gameDataAttempt?.unlocked || state.ready) return;
  gameDataAttempt.dialogDismissed = false;
  syncTransientOverlayHost();
  updateGameDataLinkWindow();
  $("#gameDataImportWindow").hidden = false;
}
function clearGameDataAttempt() {
  setGameDataImportBusy(false);
  if (gameDataAttempt) {
    clearOptionalTimeout(gameDataAttempt.startTimer);
    clearOptionalTimeout(gameDataAttempt.completeTimer);
    if (gameDataAttempt.blockingOperation) finishBlockingNetworkOperation(gameDataAttempt.blockingOperation);
  }
  gameDataAttempt = null;
  closeGameDataFallbackWindows();
  maybeApplyDeferredAppShellUpdate();
}
function beginManualGamePackageImport(
  reason = t("package.manualCancelledReason"),
  continuation: GameDataContinuation = captureGameDataContinuation("install-only"),
) {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false, startTimer: null, completeTimer: null, importFlow: true, continuation, manual: true };
  $("#gameDataImportReason").textContent = t("package.manualImportReason", { reason });
  updateGameDataLinkWindow();
  openGameDataImportWindow();
}
function gameDataFallbackText(reason: string) {
  if (importServer) {
    return t("package.importServerOnly", { reason });
  }
  return t("package.fallbackWaitOrImport", { reason });
}
function unlockGameDataImport(reason: string) {
  const attempt = gameDataAttempt;
  if (!attempt || state.ready || attempt.id !== gameDataAttemptSerial) return;
  const firstUnlock = !attempt.unlocked;
  attempt.unlocked = true;
  const panel = $("#transfer"); panel.hidden = false;
  transferKind = "game";
  $("#gameDataImportReason").textContent = gameDataFallbackText(reason);
  updateGameDataLinkWindow();
  if (firstUnlock && !attempt.dialogDismissed) openGameDataImportWindow();
}
function beginGameDataAttempt() {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  const blockingOperation = beginBlockingNetworkOperation({
    label: t("player.cancelDownload"),
    onCancel() {
      void (async () => {
        if (player.classList.contains("open")) {
          if (!await closePlayerView()) return;
        } else resetRuntime();
        beginManualGamePackageImport(undefined, captureGameDataContinuation("launch"));
        setStatus(t("package.downloadCancelledImport"));
      })();
    },
  });
  const attempt: GameDataAttempt = {
    id,
    firstByte: false,
    downloadComplete: false,
    unlocked: false,
    dialogDismissed: false,
    startTimer: null,
    completeTimer: null,
    importFlow: false,
    blockingOperation,
  };
  gameDataAttempt = attempt;
  attempt.startTimer = setTimeout(() => {
    if (gameDataAttempt?.id === id && !gameDataAttempt.firstByte) {
      unlockGameDataImport(t("package.firstByteTimeout"));
    }
  }, gameDataStartFallbackMs);
  attempt.completeTimer = setTimeout(() => {
    if (gameDataAttempt?.id === id && !gameDataAttempt.downloadComplete && !state.ready) {
      unlockGameDataImport(gameDataAttempt.firstByte
        ? t("package.downloadSlow")
        : t("package.downloadStartTimeout"));
    }
  }, gameDataCompleteFallbackMs);
}
function transferPresentationFromRuntime(value: unknown): TransferPresentation {
  const source = record(value) ?? {};
  const kind = source.kind === "game" || source.kind === "music" || source.kind === "language" ? source.kind : undefined;
  const mode = source.mode === "runtime" || source.mode === "base" || source.mode === "ogg" || source.mode === "language" || source.mode === ""
    ? source.mode : undefined;
  return {
    kind,
    mode,
    title: typeof source.title === "string" ? source.title : undefined,
    label: typeof source.label === "string" ? source.label : undefined,
    loaded: Number(source.loaded) || 0,
    total: Number(source.total) || 0,
    speed: Number(source.speed) || 0,
    phase: typeof source.phase === "string" ? source.phase : undefined,
    statusText: typeof source.statusText === "string" ? source.statusText : undefined,
    indeterminate: source.indeterminate === true,
    failed: source.failed === true,
    completed: source.completed === true,
    files: Array.isArray(source.files) ? source.files : Number(source.files) || 0,
  };
}

function noteGameDataTransfer(message: TransferPresentation) {
  const attempt = gameDataAttempt;
  if (!attempt || attempt.id !== gameDataAttemptSerial || state.ready) return;
  const kind = message.kind || (message.mode === "ogg" ? "music" : "game");
  if (kind !== "game") return;
  const loaded = Number(message.loaded) || 0;
  const total = Number(message.total) || 0;
  if (loaded > 0 && !attempt.firstByte) {
    attempt.firstByte = true;
    clearOptionalTimeout(attempt.startTimer);
    attempt.startTimer = null;
  }
  if (total > 0 && loaded >= total && !attempt.downloadComplete) {
    attempt.downloadComplete = true;
    clearOptionalTimeout(attempt.completeTimer);
    attempt.completeTimer = null;
  }
}
function finishGameDataAttempt() {
  closeGameDataFallbackWindows();
  clearGameDataAttempt();
}
function showTransfer(message: TransferPresentation) {
  noteGameDataTransfer(message);
  const panel = $("#transfer");
  clearOptionalTimeout(transferHideTimer); panel.hidden = false;
  panel.dataset.networkOwned = "0";
  panel.querySelector<HTMLElement>(".transfer-bar")?.classList.toggle("indeterminate", !!message.indeterminate || (!!message.phase && !Number(message.total)));
  transferKind = message.kind || (message.mode === "ogg" ? "music" : "game");
  const loaded = Number(message.loaded) || 0;
  const total = Number(message.total) || 0;
  const instant = Number(message.speed) || 0;
  const nextMode = message.mode ?? "";
  if (transferMode !== nextMode) { transferMode = nextMode; transferSpeed = 0; }
  transferSpeed = transferSpeed ? transferSpeed * .72 + instant * .28 : instant;
  const profile = message.mode === "ogg"
    ? { title: t("transfer.musicDownloading"), label: t("transfer.oggMusic") }
    : message.mode === "language"
      ? { title: t("transfer.languageDownloading"), label: t("transfer.language") }
      : { title: t("transfer.loading"), label: t("transfer.gameResources") };
  $("#transferTitle").textContent = message.title || profile.title;
  $("#transferLabel").textContent = message.label || profile.label;
  $("#transferAmount").textContent = message.phase === "requesting" && !total
    ? t("transfer.waitingServer")
    : message.phase === "preparing" && !total
      ? (message.statusText || t("transfer.preparing"))
    : total
    ? `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB`
    : loaded ? `${(loaded / 1048576).toFixed(1)} MiB` : t("transfer.requesting");
  $("#transferBar").style.width = total ? `${Math.min(100, loaded / total * 100).toFixed(1)}%` : message.phase ? "34%" : "0%";
  $("#transferSpeed").textContent = message.phase === "requesting" ? t("transfer.waiting")
    : message.phase === "preparing" ? t("transfer.preparingShort")
    : transferSpeed >= 1048576
    ? `${(transferSpeed / 1048576).toFixed(1)} MiB/s`
    : `${Math.round(transferSpeed / 1024)} KiB/s`;
  $("#transferEta").textContent = total && transferSpeed > 1024 ? clock((total - loaded) / transferSpeed) : "--:--";
  syncTransferCancelButton();
}
function languageTransferFailure(label: string, error: unknown) {
  const panel = $("#transfer"); panel.hidden = false;
  transferKind = "language";
  $("#transferTitle").textContent = t("transfer.languageFailed");
  $("#transferLabel").textContent = label || t("transfer.language");
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = t("transfer.languageFailedDetail", { reason: errorMessage(error) });
  $("#transferRetry").hidden = true;
}
function transferFailure(message: { failed?: number }) {
  if (state.launched) return;
  const panel = $("#transfer"); panel.hidden = false;
  transferKind = "music";
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = t("transfer.oggFailed", { count: message.failed || 1 });
  $("#transferRetry").hidden = false;
}
function transferComplete(message: TransferPresentation) {
  showTransfer({ ...message, mode: "ogg", speed: 0 });
  $("#transferTitle").textContent = t("transfer.musicComplete");
  $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
  transferHideTimer = setTimeout(hideTransfer, 2200);
}
function showMidiFallback() {
  const notice = $("#musicNotice");
  clearOptionalTimeout(musicNoticeTimer);
  notice.classList.remove("show");
  requestAnimationFrame(() => {
    notice.classList.add("show");
    musicNoticeTimer = setTimeout(() => notice.classList.remove("show"), 2000);
  });
}

interface LocalMusicResource {
  packageFileId: string;
  path: string;
  size: number;
}

interface RemoteMusicResource {
  url: string;
  path: string;
  size: number;
}

type MusicResource = LocalMusicResource | RemoteMusicResource;
let activeLocalMusicInstall: ReturnType<typeof createLocalMusicInstall> | null = null;

function isLocalMusicResource(resource: MusicResource): resource is LocalMusicResource {
  return "packageFileId" in resource && typeof resource.packageFileId === "string";
}

function createLocalMusicInstall(
  resources: readonly LocalMusicResource[],
  generation: InstalledPackageGeneration,
) {
  const runtimeWindow = currentRuntimeWindow();
  let runtimeDocument = null;
  try { runtimeDocument = runtimeWindow?.document || null; } catch {}
  const fs = runtimeWindow?.FS || runtimeWindow?.Module?.FS;
  if (!runtimeDocument || !runtimeWindow || !fs?.writeFile || !fs?.mkdirTree) {
    throw new Error(t("runtime.offlineFsUnavailable"));
  }
  const allowedTargets = new Map<string, string>();
  for (const fileId of componentFileIds(generation.descriptor, "ogg")) {
    const target = generation.descriptor.files[fileId]?.target;
    if (typeof target === "string" && target) allowedTargets.set(fileId, target);
  }
  const total = resources.reduce((sum, resource) => sum + (Number(resource.size) || 0), 0);
  const startedAt = performance.now();
  let loaded = 0;
  let completed = 0;
  let cancelled = false;
  let failed = false;
  const emitProgress = () => {
    const seconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
    showTransfer({
      kind: "music", mode: "ogg", title: t("transfer.musicPreparing"), label: t("transfer.localOgg"),
      loaded, total, speed: loaded / seconds, files: resources.length
    });
  };
  const checkRuntime = () => {
    let currentDocument = null;
    const currentWindow = currentRuntimeWindow();
    try { currentDocument = currentWindow?.document || null; } catch {}
    if (cancelled || failed || currentWindow !== runtimeWindow || currentDocument !== runtimeDocument) throw new Error(t("runtime.offlineReplaced"));
  };
  const installOne = async (resource: LocalMusicResource) => {
    checkRuntime();
    if (typeof resource.packageFileId !== "string" || typeof resource.path !== "string" ||
        allowedTargets.get(resource.packageFileId) !== resource.path) throw new Error(t("runtime.localOggDescriptorInvalid"));
    const packaged = await readManagedRuntimeResource(generation, resource.packageFileId);
    checkRuntime();
    if (!packaged || packaged.buffer.byteLength <= 0 ||
        (resource.size > 0 && packaged.buffer.byteLength !== resource.size)) {
      throw new Error(t("runtime.resourceDamaged", { path: resource.path }));
    }
    const slash = resource.path.lastIndexOf("/");
    if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
    // readManagedRuntimeResource already returns an independent ArrayBuffer.
    // Hand that buffer to Emscripten directly instead of wrapping it in a Blob
    // and materializing a second full-size ArrayBuffer on memory-constrained devices.
    fs.writeFile(resource.path, new Uint8Array(packaged.buffer), { canOwn: true });
    loaded += packaged.buffer.byteLength;
    completed++;
    emitProgress();
  };
  const run = async (list: readonly LocalMusicResource[]) => {
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < list.length) await installOne(list[next++]);
    };
    try {
      await Promise.all(Array.from({ length: Math.min(2, list.length) }, worker));
    } catch (error) {
      // Stop sibling reads before they can write or revive a failed transfer.
      failed = true;
      throw error;
    }
  };
  const initial = resources.slice(0, Math.min(2, resources.length));
  const remaining = resources.slice(initial.length);
  return {
    cancel() { cancelled = true; },
    async installInitial() {
      emitProgress();
      await run(initial);
    },
    installRemaining() {
      checkRuntime();
      if (!remaining.length) {
        $("#transferTitle").textContent = t("transfer.musicReady");
        transferHideTimer = setTimeout(hideTransfer, 2200);
        return;
      }
      run(remaining).then(() => {
        if (cancelled) return;
        emitProgress();
        $("#transferTitle").textContent = t("transfer.musicReady");
        $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
        transferHideTimer = setTimeout(hideTransfer, 2200);
      }).catch(error => {
        if (cancelled) return;
        hideTransfer();
        showToast(t("transfer.localOggPartialFailed", { reason: error.message }));
      });
    }
  };
}

function emitGuideShotPair() {
  const help = $("#touchHelp");
  const panel = $(".focus-demo");
    const body = requiredDescendant(panel, ".guide-demo-body", HTMLElement);
  if (help.hidden || body.hidden || !panel.classList.contains("is-playing") ||
      panel.classList.contains("is-finished") || document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const stage = $(".focus-stage");
  const layer = $(".shot-stream");
  const playerRect = $(".demo-player").getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return;

  const focused = Number.parseFloat(getComputedStyle($(".finger-focus")).opacity) > .45;
  const centerX = playerRect.left - stageRect.left + playerRect.width / 2;
  const startY = playerRect.top - stageRect.top + 3;
  const columnGap = focused ? 3 : 9;
  for (const side of [-1, 1]) {
    const shot = document.createElement("i");
    shot.className = "demo-shot";
    shot.style.left = `${centerX + side * columnGap}px`;
    shot.style.top = `${startY}px`;
    layer.append(shot);
    const animation = shot.animate([
      { transform: "translate(-50%,-50%) rotate(45deg)", opacity: 0 },
      { offset: .08, transform: "translate(-50%,-50%) rotate(105deg)", opacity: 1 },
      { transform: `translate(-50%,-${startY + 18}px) rotate(765deg)`, opacity: 1 }
    ], { duration: 760, easing: "linear" });
    animation.onfinish = () => shot.remove();
  }
}

function startGuideShots() {
  clearOptionalInterval(guideShotTimer);
  emitGuideShotPair();
  guideShotTimer = setInterval(emitGuideShotPair, 140);
}

function stopGuideShots() {
  clearOptionalInterval(guideShotTimer);
  guideShotTimer = null;
}

const guideDurations = { focus: 7000, menu: 12000, dialogue: 4000 };

function syncTouchGuideFocusMode() {
  const panel = document.querySelector<HTMLElement>('[data-guide-panel="focus"]');
  const summary = $("#guideFocusSummary");
  const label = $("#guideFocusLabel");
  const controlHint = $("#guideFocusControlHint");
  if (!panel || !summary || !label || !controlHint) return;
  const mode = state.options.touchFocusMode;
  panel.dataset.focusMode = mode;
  if (mode === "two-finger") {
    summary.textContent = t("help.focusTwoFingerSummary");
    label.textContent = t("help.focusTwoFingerLabel");
    controlHint.textContent = "";
    return;
  }
  if (mode === "toggle-button") {
    summary.textContent = t("help.focusToggleSummary");
    label.textContent = t("help.focusToggleLabel");
    controlHint.textContent = t("help.toggle");
    return;
  }
  summary.textContent = t("help.focusHoldSummary");
  label.textContent = t("help.holdFocus");
  controlHint.textContent = t("help.hold");
}

function collapseTouchGuides() {
  clearOptionalTimeout(guidePlaybackTimer);
  guidePlaybackTimer = null;
  stopGuideShots();
  $(".shot-stream").replaceChildren();
  document.querySelectorAll<HTMLElement>("[data-guide-tab]").forEach(tab => tab.setAttribute("aria-expanded", "false"));
  document.querySelectorAll<HTMLElement>("[data-guide-panel]").forEach(panel => {
    requiredDescendant(panel, ".guide-demo-body", HTMLElement).hidden = true;
    panel.classList.remove("is-playing", "is-finished");
  });
}

function playTouchGuide(name: string) {
  collapseTouchGuides();
  const tab = document.querySelector<HTMLElement>(`[data-guide-tab="${name}"]`);
  const panel = document.querySelector<HTMLElement>(`[data-guide-panel="${name}"]`);
  if (!tab || !panel) return;
  tab.setAttribute("aria-expanded", "true");
  requiredDescendant(panel, ".guide-demo-body", HTMLElement).hidden = false;
  // Static help sections expand without starting an animated tutorial replay timer.
  if (!(name in guideDurations)) return;
  const duration = guideDurations[name as keyof typeof guideDurations];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-finished");
    return;
  }
  void panel.offsetWidth;
  panel.classList.add("is-playing");
  if (name === "focus") startGuideShots();
  guidePlaybackTimer = setTimeout(() => {
    panel.classList.add("is-finished");
    if (name === "focus") {
      stopGuideShots();
      $(".shot-stream").replaceChildren();
    }
    guidePlaybackTimer = null;
  }, duration);
}

interface LauncherGameView {
  title: string;
  runtime: string;
  multiplayerRuntime?: string;
  multiplayer?: {
    difficultyMax: number;
    characterMax: number;
    loadoutCount: number;
    peerTransportGlobal: string;
  };
  storage: {
    saveRoot: string;
    scoreFile: string;
    configFiles: readonly string[];
  };
  package: {
    dataFileId: string;
    dataTarget: string;
    musicSourceDirectories: Readonly<Record<string, string>>;
    musicMounts: Readonly<Record<string, string>>;
  };
  replay?: { prefix: string };
  features: Readonly<Record<ProductFeatureId, boolean>>;
  music: {
    midi: HostMidiManifest;
    ogg?: HostOggManifest | null;
    wav?: HostOggManifest | null;
    [key: string]: unknown;
  };
  gameData?: HostGameData;
  languageOptions?: unknown;
  languages?: unknown;
}

function game(gameId: GameId = state.game): LauncherGameView {
  const hosted = manifest.games[gameId];
  if (!hosted) throw new Error(t("runtime.hostManifestMissingGame", { game: gameId }));
  // Product metadata supplies static identity/storage policy; the validated
  // Host entry supplies the concrete Runtime/content capability for this host.
  const product = PRODUCT_GAMES[gameId];
  return {
    title: product.title,
    runtime: hosted.runtime,
    multiplayerRuntime: "multiplayerRuntime" in hosted ? hosted.multiplayerRuntime : undefined,
    multiplayer: "multiplayer" in product ? product.multiplayer : undefined,
    storage: product.storage,
    package: product.package,
    replay: "replay" in product ? product.replay : undefined,
    features: product.features,
    music: hosted.music,
    gameData: "gameData" in hosted ? hosted.gameData : undefined,
    languageOptions: hosted.languageOptions,
    languages: "languages" in hosted ? hosted.languages : undefined,
  };
}
function runtimeUrl() {
  const entry = game();
  if (state.runtimeVariant === "multiplayer") {
    if (typeof entry.multiplayerRuntime !== "string" || !entry.multiplayerRuntime) {
      throw new Error(t("runtime.multiplayerRuntimeMissing", { game: state.game.toUpperCase() }));
    }
    return entry.multiplayerRuntime;
  }
  return entry.runtime;
}

function offlineRuntimePaths(gameId: GameId): string[] {
  const runtime = manifest.games[gameId]?.runtime;
  if (typeof runtime !== "string" || !runtime) return [];
  const url = new URL(runtime, location.href);
  const product = PRODUCT_GAMES[gameId];
  if ("runtimeFileLayout" in product && product.runtimeFileLayout === "directory" && "runtimeAssets" in product) {
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    return product.runtimeAssets.map((name: string) => `${directory}${name}`);
  }
  return ["html", "js", "wasm"].map(extension => url.pathname.replace(/\.html$/i, `.${extension}`));
}

async function cacheRuntimeForOffline(gameId: GameId) {
  if (!("serviceWorker" in navigator)) return;
  await appShellClient?.ready;
  const registration = await navigator.serviceWorker.getRegistration("./").catch(() => null);
  const worker = navigator.serviceWorker.controller || registration?.active;
  const paths = offlineRuntimePaths(gameId);
  if (!worker || !paths.length) return;
  const channel = new MessageChannel();
  const result = new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${gameId}: Runtime offline cache timed out`)), 120_000);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer);
      resolve(event.data || {});
    };
  });
  worker.postMessage({ type: "CACHE_APP_SHELL_PATHS", paths }, [channel.port2]);
  const response = await result;
  if (!response.ok) throw new Error(response.error || `${gameId}: Runtime offline cache failed`);
}

function musicPackage() {
  const transport = musicTransportMode(state.music);
  return !transport || transport === "none" ? { files: [] } : game().music[transport];
}
function gameDataDescriptor(gameId: GameId = state.game): HostGameData {
  const descriptor = game(gameId).gameData;
  if (!descriptor) throw new Error(t("runtime.dataDescriptorMissing", { game: gameId }));
  return descriptor;
}

function developmentPackageDescriptor(gameId: GameId): PackageDescriptor | null {
  const hosted = game(gameId);
  const data = hosted.gameData;
  const dataSource = typeof data?.source === "string" && data.source ? data.source : null;
  if (!data || !dataSource) return null;
  const files: PackageDescriptor["files"] = {
    "game-data": {
      revision: data.version,
      source: "game-data",
      target: `/${data.path}`,
      bytes: data.bytes,
      sha256: data.sha256,
    },
  };
  const ogg = hosted.music?.ogg;
  const oggMount = hosted.package.musicMounts.ogg || "/bgm-ogg";
  const oggFiles = Array.isArray(ogg?.files) && Array.isArray(ogg?.sizes) && Array.isArray(ogg?.sha256)
    ? ogg.files.map((name, index) => ({
      name,
      bytes: Number(ogg.sizes[index]),
      sha256: String(ogg.sha256[index] || ""),
    })).filter(item => item.name && Number.isSafeInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/i.test(item.sha256))
    : [];
  for (const item of oggFiles) {
    const fileId = `ogg:${item.name}`;
    files[fileId] = {
      revision: ogg?.version || data.version,
      source: item.name,
      target: `${oggMount.replace(/\/$/, "")}/${item.name}`,
      bytes: item.bytes,
      sha256: item.sha256,
    };
  }
  const oggIds = oggFiles.map(item => `ogg:${item.name}`);
  return {
    schema: PACKAGE_DESCRIPTOR_SCHEMA,
    game: gameId,
    revision: data.version,
    runtimeRequirement: {
      protocol: HOST_PROTOCOL,
      target: gameId,
      dataFile: "game-data",
      dataLayout: data.layout,
    },
    files,
    base: { files: ["game-data"] },
    components: oggIds.length ? { ogg: { type: "ogg", files: oggIds } } : {},
  } as PackageDescriptor;
}

async function installDevelopmentPackage(show = true) {
  if (PRODUCT_GAMES[state.game].dataProvider !== "retail-memory") return null;
  const descriptor = developmentPackageDescriptor(state.game);
  if (!descriptor) return null;
  const dataSource = gameDataDescriptor().source;
  if (!dataSource) return null;
  const ogg = game().music?.ogg;
  const oggIds = componentFileIds(descriptor, "ogg");
  const desiredFileIds = ["game-data", ...(isOggMusicMode(state.music) ? oggIds : [])];
  const operation = beginBlockingNetworkOperation({ label: t("package.cancelDownload") });
  try {
    if (show) openPlayerView();
    setPlayerStatus(t("package.installingResources"));
    const installed = await installPackageFromAcquisition({
      descriptor,
      desiredFileIds,
      source: "remote",
      acquire: async (fileId, declaration) => {
        const source = fileId === "game-data"
          ? dataSource
          : `${typeof ogg?.base === "string" ? ogg.base : ""}${declaration?.source || ""}`;
        const response = await networkActivity.xhrFetch(new URL(source, location.href), { cache: "no-store", signal: operation.controller.signal }, packageNetworkMeta(state.game, source));
        if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
        return response.arrayBuffer();
      },
      onProgress(progress) {
        setPlayerStatus(t("package.installingResourcesProgress", { completed: progress.completed, total: progress.total }));
      },
    });
    if (installed?.generation) installedPackageSnapshots.set(state.game, installed.generation);
    return installed;
  } finally {
    finishBlockingNetworkOperation(operation);
  }
}

async function installImportedGameData(file: File | Blob) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > maxImportBytes) throw new Error(t("package.invalidDataSize"));
  if (!globalThis.indexedDB?.open) throw new Error(t("package.indexedDbUnavailable"));
  if (state.game === "th08" && file instanceof File && /^th08\.dat$/i.test(file.name)) {
    const expected = gameDataDescriptor();
    if (file.size !== expected.bytes) throw new Error(t("package.th08SizeMismatch", { actual: file.size, expected: expected.bytes }));
    setPlayerStatus(t("package.validatingTh08"));
    const bytes = await file.arrayBuffer();
    const actualHash = await sha256Hex(new Uint8Array(bytes));
    if (actualHash.toLowerCase() !== expected.sha256.toLowerCase()) throw new Error(t("package.th08HashMismatch"));

    // The retail filename is only an acquisition concern. Once accepted by
    // eagler-touhou, TH08 occupies the same Package/DB namespace as TH06/TH07:
    // game-data -> /th08.data. The stored bytes remain the untouched retail
    // th08.dat payload so future App-managed WASM Runtimes can reuse them.
    const descriptor: PackageDescriptor = {
      schema: PACKAGE_DESCRIPTOR_SCHEMA,
      game: "th08",
      revision: `raw-${actualHash.slice(0, 16)}`,
      runtimeRequirement: {
        protocol: HOST_PROTOCOL,
        target: "th08",
        dataFile: "game-data",
        dataLayout: expected.layout,
      },
      files: {
        "game-data": {
          revision: expected.version,
          source: "th08.data",
          target: "/th08.data",
          bytes: expected.bytes,
        },
      },
      base: { files: ["game-data"] },
      components: {},
    };
    setPlayerStatus(t("package.installingTh08"));
    const installed = await installPackageFromAcquisition({
      descriptor,
      desiredFileIds: ["game-data"],
      source: "local",
      reuseCurrent: false,
      acquire: async fileId => fileId === "game-data" ? bytes : null,
      onProgress(progress) {
        setPlayerStatus(t("package.installingTh08Progress", { completed: progress.completed, total: progress.total }));
      },
    });
    if (installed?.generation) installedPackageSnapshots.set(state.game, installed.generation);
    try { void navigator.storage?.persist?.().catch?.(() => {}); } catch {}
    return {
      files: Object.keys(installed.generation?.files || {}).length,
    };
  }
  try {
    const packageZip = await parsePackageZip(file);
    if (packageZip.descriptor.game !== state.game) {
      throw new Error(t("package.wrongGame", { actual: packageZip.descriptor.game.toUpperCase(), expected: state.game.toUpperCase() }));
    }
    setPlayerStatus(t("package.importingSimple"));
    const installed = await installParsedPackageZip(packageZip, {
      onProgress(progress) {
        setPlayerStatus(t("package.importingProgress", { completed: progress.completed, total: progress.total }));
      }
    });
    if (installed?.generation) installedPackageSnapshots.set(state.game, installed.generation);
    // Persistence permission is an eviction-policy hint, not part of the
    // Package transaction. Firefox may leave the request pending awaiting a
    // browser decision, so it must never hold import or launch completion.
    try { void navigator.storage?.persist?.().catch?.(() => {}); } catch {}
    return {
      files: Object.keys(installed.generation?.files || {}).length,
    };
  } catch (error) {
    if (!/Package ZIP is missing package\.json/.test(errorMessage(error))) throw error;
  }
  const expected = gameDataDescriptor();
  const pack = await parseStoredGameDataPack(file);
  if (pack.manifest.game !== state.game) throw new Error(t("package.legacyWrongGame", { actual: pack.manifest.game.toUpperCase(), expected: state.game.toUpperCase() }));
  if (pack.manifest.data.path !== expected.path) throw new Error(t("package.dataPathMismatch"));
  if (importServer) {
    if (!pack.offline) throw new Error(t("package.serverNoContent"));
    for (const target of ["/msgothic.ttc", "/unifont.otf"]) {
      if (!pack.offline.shared.some(item => item.target === target)) throw new Error(t("package.legacyMissingResource", { resource: target.slice(1) }));
    }
  }
  setPlayerStatus(t("package.validatingLocalData"));
  const actualHash = await sha256Hex(new Uint8Array(await pack.data.blob.arrayBuffer()));
  if (actualHash.toLowerCase() !== pack.manifest.data.sha256.toLowerCase()) throw new Error(t("package.dataHashFailed"));

  if (pack.manifest.music) {
    for (let i = 0; i < pack.music.length; i++) {
      setPlayerStatus(t("package.validatingLocalOgg", { completed: i + 1, total: pack.music.length }));
      const item = pack.music[i];
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(t("package.shaFailed", { name: item.name }));
    }
  }

  if (pack.offline) {
    for (const item of pack.offline.shared) {
      setPlayerStatus(t("package.validatingLegacyResource", { resource: item.target.slice(1) }));
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(t("package.shaFailed", { name: item.path }));
    }
    for (const item of pack.offline.languages) {
      setPlayerStatus(t("package.validatingLegacyLanguage", { language: item.title }));
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(t("package.shaFailed", { name: item.path }));
    }
  }
  // Historical ZIP is only an acquisition format. New imports cross the same
  // Package Store boundary as current Package ZIPs, so no fresh legacy
  // localStorage/Cache/custom-IDB state is created. Historical Runtime files
  // are deliberately ignored by the adapter.
  const adapted = adaptLegacyGamePackToPackage(pack, {
    protocol: HOST_PROTOCOL,
  });
  setPlayerStatus(t("package.migratingLegacy"));
  const installed = await installParsedPackageZip(adapted, {
    onProgress(progress) {
      setPlayerStatus(t("package.migratingLegacyProgress", { completed: progress.completed, total: progress.total }));
    }
  });
  if (installed?.generation) installedPackageSnapshots.set(state.game, installed.generation);
  try { void navigator.storage?.persist?.().catch?.(() => {}); } catch {}
  return {
    files: Object.keys(installed.generation?.files || {}).length,
  };
}
const selectedLanguagePack = () => resolveLanguagePackSource(languageEntry(), location.href);
interface LaunchConfiguredRuntimeOptions {
  awaitFirstFrame?: boolean;
  omitNetplay?: boolean;
}
async function launchConfiguredRuntime(options: LaunchConfiguredRuntimeOptions = {}) {
  return withLauncherActivity(() => launchConfiguredRuntimeImpl(options));
}
async function launchConfiguredRuntimeImpl(options: LaunchConfiguredRuntimeOptions = {}) {
  clearStartupError();
  await ensureRuntime(true);
  const session = runtimeSessions.assertCurrent(currentRuntimeSession());
  const assertSession = () => runtimeSessions.assertCurrent(session);
  try {
    launchMusicFallback = null;
    chooseDefaultMusic();
    let launchLanguage = state.language;
    let runtimePack: Awaited<ReturnType<typeof prepareLanguagePack>> = null;
    try {
      runtimePack = await prepareLanguagePack();
    } catch (error) {
      if (isCancelledDownload(error)) throw error;
      const requestedLanguage = entryTitle(languageEntry());
      // A translation is optional content. Keep the durable preference so a
      // later online launch can retry it, but never let a missing CDN object or
      // an incomplete local Package prevent otherwise-valid game DATA from
      // starting in the built-in Japanese language.
      launchLanguage = "ja";
      hideTransfer();
      showToast(t("language.launchFallback", {
        language: requestedLanguage,
        reason: errorMessage(error),
      }));
      console.warn(`${state.game}: language pack unavailable; using Japanese for this launch`, error);
    }
    assertSession();
    await ensureManagedOggStartupBarrier();
    assertSession();
    await prepareMidi();
    assertSession();
    const musicResources = await selectedMusicResources();
    assertSession();
    const localMusicResources = isOggMusicMode(state.music) && musicResources.length > 0 &&
      musicResources.every(isLocalMusicResource) ? musicResources : null;
    const localMusicGeneration = localMusicResources ? activeInstalledPackageGeneration : null;
    const shared = await selectedSharedResources(launchLanguage);
    const packageResources = await installedPackageRuntimeResources();
    assertSession();
    setPlayerStatus(t("runtime.preparingResources", { resource: runtimePack ? `${entryTitle(languageEntry())} ${t("settings.language")}` : `${musicModeLabel(state.music)} ${t("settings.music")}` }));
    const netplayOptions = state.runtimeVariant === "multiplayer" && !state.replayViewer && !options.omitNetplay
      ? validatedNetplayOptions() : {};
    await send("configure", {
      // Imported OGG is already in the host's IndexedDB.  Do not route those
      // bytes back through blob: URLs and fetch() inside the iframe: on mobile
      // and ordinary HTTP origins that duplicates the whole audio payload and
      // can keep configure blocked long enough to look like a dead launch.
      // Configure as MIDI first, then write the local OGG buffers directly into
      // the same-origin runtime FS before callMain().
      music: localMusicResources ? "midi" : musicTransportMode(state.music),
      resources: localMusicResources ? [] : musicResources,
      runtimeResources: [],
      runtimePack: runtimePack ? { ...runtimePack, manifest: runtimePack.manifest, files: runtimePack.files } : null,
      sharedResources: shared,
      options: { ...state.options, thpracEnabled: state.runtimeVariant === "normal" && state.options.thpracEnabled,
        limitPresentationTo60: state.options.frameLimit60Enabled, debugHarness, thpracLocale: thpracLocaleForLanguage(launchLanguage),
        oggDecodeMode: oggDecodeMode(state.music),
        unlimitedTouch: state.options.touchMovementMode === "touch-unlimited",
        touchBombZoneEnabled: false,
        th06FocusHitbox: gameFeatureAvailable(state.game, "focusHitbox") && state.options.th06FocusHitbox,
        replayViewer: !!state.replayViewer,
        ...netplayOptions }
    }, 120_000);
    assertSession();
    if (packageResources.length) {
      await installManagedPackageResources(packageResources);
    }
    let localMusicInstall = null;
    if (localMusicResources) {
      try {
        if (!localMusicGeneration) throw new Error(t("runtime.localMusicGenerationUnavailable"));
        localMusicInstall = createLocalMusicInstall(localMusicResources, localMusicGeneration);
        activeLocalMusicInstall = localMusicInstall;
        await localMusicInstall.installInitial();
        assertSession();
        const runtimeWindow = currentRuntimeWindow();
        if (!runtimeWindow?.Module) throw new Error(t("runtime.unavailable"));
        runtimeWindow.Module.touhouMusicMode = "ogg";
      } catch (error) {
        localMusicInstall?.cancel();
        localMusicInstall = null;
        activeLocalMusicInstall = null;
        assertSession();
        // Keep the durable preference intact, but make this launch's effective
        // state match the Runtime after a corrupt or unavailable local object.
        activateLaunchMusicFallback();
        const runtimeWindow = currentRuntimeWindow();
        if (runtimeWindow?.Module) runtimeWindow.Module.touhouMusicMode = "midi";
        hideTransfer();
        showToast(t("runtime.localOggFallbackMidi", { reason: errorMessage(error) }));
      }
    }
    const selectedProduct = PRODUCT_GAMES[state.game];
    const directoryRuntime = "runtimeFileLayout" in selectedProduct &&
      selectedProduct.runtimeFileLayout === "directory";
    const firstFramePromise = options.awaitFirstFrame
      ? waitForRuntimeFirstFrame(session, directoryRuntime ? 122_000 : firstFrameFallbackMs + 2000)
      : null;
    // Session invalidation owns cancellation. Observe rejection immediately so
    // an earlier launch failure cannot leave a transient unhandled promise.
    if (firstFramePromise) void firstFramePromise.catch(() => {});
    armFirstFrameWatchdog(directoryRuntime ? 122_000 : firstFrameFallbackMs);
    // The Runtime is once again the direct child browsing context. Keep the
    // bounded Android focus relay that fixed the historical first-frame stall,
    // but there is no longer a Player -> Runtime focus hop.
    startPlayerFocusRelay();
    try {
      // Directory Runtimes such as TH10 may intentionally wait for a real
      // WebKit user gesture before creating Web Audio/worker-owned rendering.
      // Keep the request alive while that in-Runtime start gate is visible.
      await send("launch", {}, directoryRuntime ? 120_000 : 15_000);
      assertSession();
      if (directoryRuntime && firstFrameExpected) {
        armFirstFrameWatchdog();
        startPlayerFocusRelay();
      }
    } catch (error) {
      clearFirstFrameWatchdog();
      localMusicInstall?.cancel();
      activeLocalMusicInstall = null;
      hideTransfer();
      throw error;
    }
    state.launched = true; clearStartupError();
    syncDirectTouchSurfaceVisibility();
    const backgroundUpdate = deferredBackgroundPackageUpdate;
    deferredBackgroundPackageUpdate = null;
    if (backgroundUpdate) startBackgroundPackageUpdate(backgroundUpdate);
    updateRuntimeDiagnostics();
    // resetRuntime() can run while #player is still hidden, when clientWidth is 0.
    // Re-apply the persisted orientation-specific viewport offset only after the
    // live player has been opened and the runtime has actually launched.
    gameZoom.applyTransform(1, 0, 0);
    updatePlayerOrientationUi();
    pushTouchControlsLive();
    setPlayerStatus(t("runtime.ready")); refocusGameIfNeeded();
    if (localMusicInstall) localMusicInstall.installRemaining();
    startManagedOggProgressiveInstall();
    if (firstFramePromise) await firstFramePromise;
  } catch (error) {
    if (runtimeSessionCurrent(session) && !state.launched) resetRuntime();
    throw error;
  }
}
function entryTitle(entry: LanguageCatalogEntry | null | undefined): string {
  return typeof entry?.title === "string" && entry.title ? entry.title : entry?.id || t("language.fallbackName");
}
function musicAvailabilityContext() {
  const packages = game().music || {};
  const installedGeneration = activeInstalledPackageGeneration || installedPackageSnapshots.get(state.game) || null;
  return {
    audio: webAudioAvailable,
    midiAvailable: state.game !== "th10" && !!packages.midi,
    importServer: !!importServer,
    publishedOggCapable: !!(packages.ogg || packages.wav),
    remoteOggAdvertised: !!packages.ogg,
    remoteRevision: releaseCatalog?.games?.[state.game]?.revision ?? null,
    installed: installedGeneration ? {
      revision: installedGeneration.descriptor.revision,
      oggFileIds: componentFileIds(installedGeneration.descriptor, "ogg"),
      files: installedGeneration.files || {},
    } : null,
  };
}
function chooseDefaultMusic() {
  if (launchMusicFallback) {
    state.music = launchMusicFallback;
    return;
  }
  const availabilityContext = musicAvailabilityContext();
  // Effective fallback is transient. Keep explicit preference separate so a
  // later completed install (or saving an unrelated option) cannot erase it.
  state.music = resolveEffectiveMusicMode({
    requested: state.musicPreferenceExplicit ? state.musicPreference : state.music,
    explicit: state.musicPreferenceExplicit,
    ...availabilityContext,
  });
}

function activateLaunchMusicFallback() {
  launchMusicFallback = "midi";
  state.music = launchMusicFallback;
  render();
}

function syncMusicSelectAvailability(select: HTMLSelectElement, availability = resolveMusicAvailability(musicAvailabilityContext())) {
  select.value = state.music;
  for (const option of select.options) {
    option.disabled = option.value === "none" ? false
      : option.value === "midi" ? !availability.midi
      : isOggMusicMode(option.value as MusicMode) ? !availability.ogg
      : true;
  }
  select.title = availability.audio ? "" : t("settings.webAudioUnavailable");
}

interface CustomSelectUi {
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  value: HTMLSpanElement;
  arrow: HTMLElement;
  menu: HTMLDivElement;
  signature: string;
}
const customSelects = new Map<HTMLSelectElement, CustomSelectUi>();
function customSelectHost() {
  const fullscreenElement = document.fullscreenElement || launcherDocument.webkitFullscreenElement;
  return fullscreenElement === player ? player : document.body;
}
function closeCustomSelect(select: HTMLSelectElement, { restoreFocus = false }: { restoreFocus?: boolean } = {}) {
  const ui = customSelects.get(select);
  if (!ui) return;
  if (ui.menu.hidden && ui.trigger.getAttribute("aria-expanded") === "false" && !ui.root.classList.contains("open")) {
    if (restoreFocus) ui.trigger.focus({ preventScroll: true });
    return;
  }
  ui.trigger.setAttribute("aria-expanded", "false");
  ui.menu.hidden = true;
  ui.root.classList.remove("open");
  if (restoreFocus) ui.trigger.focus({ preventScroll: true });
}
function closeOtherCustomSelects(except: HTMLSelectElement | null = null) {
  for (const select of customSelects.keys()) if (select !== except) closeCustomSelect(select);
}
function positionCustomSelectMenu(select: HTMLSelectElement) {
  const ui = customSelects.get(select);
  if (!ui || ui.menu.hidden) return;
  const rect = ui.trigger.getBoundingClientRect();
  const gap = 7;
  const viewportGap = 10;
  const width = Math.min(Math.max(rect.width, 192), Math.min(280, window.innerWidth - viewportGap * 2));
  ui.menu.style.minWidth = `${Math.round(rect.width)}px`;
  ui.menu.style.width = `${Math.round(width)}px`;
  ui.menu.style.left = `${Math.round(Math.max(viewportGap, Math.min(rect.left, window.innerWidth - width - viewportGap)))}px`;
  ui.menu.style.top = `${Math.round(rect.bottom + gap)}px`;
  ui.menu.style.maxHeight = `${Math.max(120, Math.round(window.innerHeight - rect.bottom - gap - viewportGap))}px`;
  const menuRect = ui.menu.getBoundingClientRect();
  if (menuRect.bottom > window.innerHeight - viewportGap && rect.top > window.innerHeight - rect.bottom) {
    const aboveHeight = Math.max(120, Math.round(rect.top - gap - viewportGap));
    ui.menu.style.maxHeight = `${aboveHeight}px`;
    ui.menu.style.top = `${Math.round(Math.max(viewportGap, rect.top - Math.min(menuRect.height, aboveHeight) - gap))}px`;
  }
}
function syncCustomSelect(select: HTMLSelectElement) {
  const ui = customSelects.get(select);
  if (!ui) return;
  const selected = select.selectedOptions[0] || select.options[0];
  const triggerI18n = select.dataset.triggerI18n;
  ui.value.textContent = isUiMessageKey(triggerI18n) ? t(triggerI18n) : (selected?.textContent || "");
  const explicitLabel = select.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`)?.textContent?.trim() : "";
  const ariaLabel = select.getAttribute("aria-label") || explicitLabel || t("common.selectOption");
  ui.trigger.setAttribute("aria-label", ariaLabel);
  ui.menu.setAttribute("aria-label", ariaLabel);
  ui.trigger.disabled = select.disabled;
  ui.trigger.setAttribute("aria-disabled", String(select.disabled));
  const signature = Array.from(select.options, option => `${option.value}\u0000${option.textContent}\u0000${option.disabled}`).join("\u0001");
  if (signature !== ui.signature) {
    ui.signature = signature;
    ui.menu.replaceChildren(...Array.from(select.options, (option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "mizuki-select-item";
      item.dataset.value = option.value;
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      item.disabled = option.disabled;
      const label = document.createElement("span");
      label.textContent = option.textContent;
      const check = document.createElement("i");
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      item.append(label, check);
      return item;
    }));
  }
  ui.menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item").forEach(item => {
    const selectedItem = item.dataset.value === select.value;
    item.classList.toggle("selected", selectedItem);
    item.setAttribute("aria-selected", String(selectedItem));
  });
  if (!ui.menu.hidden) positionCustomSelectMenu(select);
}
function openCustomSelect(select: HTMLSelectElement) {
  const ui = customSelects.get(select);
  if (!ui || select.disabled) return;
  closeOtherCustomSelects(select);
  syncCustomSelect(select);
  const host = customSelectHost();
  if (ui.menu.parentNode !== host) host.append(ui.menu);
  ui.menu.hidden = false;
  ui.root.classList.add("open");
  ui.trigger.setAttribute("aria-expanded", "true");
  positionCustomSelectMenu(select);
}
function installCustomSelect(select: HTMLSelectElement) {
  if (!select || customSelects.has(select)) return;
  const root = document.createElement("div");
  root.className = "mizuki-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mizuki-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", select.getAttribute("aria-label") || t("common.selectOption"));
  const value = document.createElement("span");
  value.className = "mizuki-select-value";
  const arrow = document.createElement("i");
  arrow.className = "mizuki-select-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg>';
  trigger.append(value, arrow);
  const prefixTemplate = select.parentElement?.querySelector<HTMLTemplateElement>(":scope > template[data-select-trigger-prefix]");
  if (prefixTemplate) trigger.prepend(prefixTemplate.content.cloneNode(true));
  select.before(root);
  root.append(trigger, select);
  select.classList.add("custom-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  if (select.id) {
    document.querySelectorAll<HTMLElement>(`label[for="${CSS.escape(select.id)}"]`).forEach(label => {
      label.addEventListener("click", event => {
        event.preventDefault();
        trigger.focus({ preventScroll: true });
        openCustomSelect(select);
      });
    });
  }
  const menu = document.createElement("div");
  menu.className = "mizuki-select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", select.getAttribute("aria-label") || t("common.selectOption"));
  menu.hidden = true;
  customSelects.set(select, { root, trigger, value, arrow, menu, signature: "" });
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    if (trigger.getAttribute("aria-expanded") === "true") closeCustomSelect(select);
    else openCustomSelect(select);
  });
  trigger.addEventListener("keydown", event => {
    if (!["Enter", " ", "ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
    if (event.key === "Escape") { closeCustomSelect(select); return; }
    event.preventDefault();
    if (trigger.getAttribute("aria-expanded") !== "true") openCustomSelect(select);
    if (event.key === "Enter" || event.key === " ") return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
    const selectedIndex = Math.max(0, items.findIndex(item => item.dataset.value === select.value));
    items[event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : Math.min(items.length - 1, selectedIndex + 1)]?.focus();
  });
  menu.addEventListener("click", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
    if (!item || item.disabled) return;
    const changed = select.value !== item.dataset.value;
    select.value = item.dataset.value ?? "";
    closeCustomSelect(select, { restoreFocus: true });
    syncCustomSelect(select);
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  menu.addEventListener("keydown", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
    if (!item) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
    const index = items.indexOf(item);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeCustomSelect(select, { restoreFocus: true });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  });
  syncCustomSelect(select);
}
function syncAllCustomSelects() {
  for (const select of customSelects.keys()) syncCustomSelect(select);
}
for (const select of document.querySelectorAll<HTMLSelectElement>("select.option-select")) installCustomSelect(select);
document.addEventListener("pointerdown", event => {
  for (const [select, ui] of customSelects) {
    if (event.target instanceof Node && (ui.root.contains(event.target) || ui.menu.contains(event.target))) continue;
    closeCustomSelect(select);
  }
}, true);
window.addEventListener("resize", () => {
  for (const select of customSelects.keys()) positionCustomSelectMenu(select);
});
window.addEventListener("scroll", () => {
  for (const select of customSelects.keys()) positionCustomSelectMenu(select);
}, true);

function renderTouchFocusState(updateCopy = true) {
  const focusButton = $("#touchFocus");
  const focusButtonMode = state.options.touchFocusMode !== "two-finger";
  if (focusButton.hidden === focusButtonMode) focusButton.hidden = !focusButtonMode;
  focusButton.classList.toggle("is-on", touchControls.focusEnabled);
  const pressed = String(touchControls.focusEnabled);
  if (focusButton.getAttribute("aria-pressed") !== pressed) focusButton.setAttribute("aria-pressed", pressed);
  if (!updateCopy) return;
  const copy = t(state.options.touchFocusMode === "hold-button" ? "touch.holdFocus" : "touch.tapToggle");
  const small = requiredDescendant(focusButton, "small", HTMLElement);
  if (small.textContent !== copy) small.textContent = copy;
}
function renderTouchFireState(updateCopy = true) {
  const fireButton = $("#touchFire");
  fireButton.classList.toggle("is-on", touchControls.fireEnabled);
  const pressed = String(touchControls.fireEnabled);
  if (fireButton.getAttribute("aria-pressed") !== pressed) fireButton.setAttribute("aria-pressed", pressed);
  if (!updateCopy) return;
  const copy = t("touch.tapToggle");
  const small = requiredDescendant(fireButton, "small", HTMLElement);
  if (small.textContent !== copy) small.textContent = copy;
}
function renderTouchActionState() {
  renderTouchFocusState();
  renderTouchFireState();
}
function syncDirectTouchSurfaceVisibility() {
  const spectatorRuntime = isMultiplayerProduct() && state.netplay.spectator === true;
  const wheelMovement = touchMovementUsesJoystick(state.options.touchMovementMode);
  touchDirectSurface.hidden = !(state.launched && hostDirectTouch && !spectatorRuntime &&
    state.options.touchEnabled && !wheelMovement && !touchLayoutEditing && !thpracMouseMode);
}
function render() {
  if (!productEnabled(state.product)) state.hasSelection = false;
  chooseDefaultMusic();
  syncRuntimeDiagnosticsToggle();
  const multiplayerProduct = isMultiplayerProduct();
  document.body.classList.toggle("less-motion", state.lessMotion);
  document.querySelectorAll<HTMLElement>('[role="switch"]:not([aria-label]):not([aria-labelledby])').forEach(control => {
    const row = control.closest(".itemtop, .mobile-option, .touch-layout-setting-row");
    const label = row?.querySelector<HTMLElement>("[data-i18n]");
    if (label?.textContent?.trim()) control.setAttribute("aria-label", label.textContent.trim());
  });
  const lessMotionToggle = $("#lessMotionToggle");
  lessMotionToggle.setAttribute("aria-pressed", String(state.lessMotion));
  lessMotionToggle.title = t(state.lessMotion ? "nav.motionFullTitle" : "nav.motionLessTitle");
  $("#main").classList.toggle("has-selection", state.hasSelection);
  const tools = $(".tools");
  tools.classList.toggle("mobile-open", state.mobileOpen);
  tools.classList.toggle("mp-mode", multiplayerProduct);
  tools.setAttribute("aria-hidden", String(!state.hasSelection));
  tools.inert = !state.hasSelection;
  document.querySelectorAll<HTMLElement>(".game").forEach(card => {
    const candidate = card.dataset.product || card.dataset.game || "";
    if (!isProductId(candidate)) return;
    const product = candidate;
    card.hidden = !matchesCardFilter(product);
    const selected = state.hasSelection && product === state.product;
    card.classList.toggle("selected", selected);
    if (card instanceof HTMLAnchorElement) card.setAttribute("aria-current", selected ? "page" : "false");
  });
  $("#gameId").textContent = multiplayerProduct ? `${state.game.toUpperCase()} MP` : state.game.toUpperCase();
  $("#gameId").dataset.game = state.game;
  $("#gameTitle").textContent = game().title;
  $("#mpTitleBadge").hidden = !multiplayerProduct;
  const noticeGame = (state.game === "th08" || state.game === "th10") && !multiplayerProduct;
  $("#gameNoticeCallout").hidden = !noticeGame;
  if (noticeGame) {
    $("#gameNoticeRepo").href = state.game === "th08"
      ? "https://github.com/YomotsuHisami/th08"
      : "https://github.com/YomotsuHisami/th10";
  }
  $("#mpShell").hidden = !multiplayerProduct;
  const netplayConfigurationReady = hostManifestAvailable && !!state.netplay.url;
  const mpOnlineHead = document.querySelector<HTMLButtonElement>('[data-mp-fold="online"]');
  if (!netplayConfigurationReady && mpUiState.folds.online) mpSetFold("online", false);
  else if (netplayConfigurationReady && !netplayConfigurationWasReady) mpSetFold("online", true);
  netplayConfigurationWasReady = netplayConfigurationReady;
  if (mpOnlineHead) {
    mpOnlineHead.disabled = !netplayConfigurationReady;
    mpOnlineHead.title = netplayConfigurationReady ? "" : t(hostManifestAvailable ? "multiplayer.serviceMissing" : "multiplayer.configLoading");
  }
  $("#mpCreateRoom").disabled = !netplayConfigurationReady;
  $("#mpJoinRoom").disabled = !netplayConfigurationReady;
  $("#mpJoinCode").toggleAttribute("disabled", !netplayConfigurationReady);
  if (multiplayerProduct && state.hasSelection) {
    for (const [name, open] of Object.entries(mpUiState.folds)) {
      if (open && isMpFoldName(name)) mpRefreshFoldHeight(name);
    }
  }
  const multiplayerRoomOpen = multiplayerProduct && !!mpUiState.room;
  if (multiplayerRoomOpen && $("#main").classList.contains("card-layout-motion")) cancelCardLayoutMotion();
  $("#cardFilterBar").hidden = multiplayerRoomOpen;
  document.querySelectorAll<HTMLElement>("[data-card-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.cardFilter === cardFilter));
  });
  $("#main").classList.toggle("mp-room-open", multiplayerRoomOpen);
  document.body.classList.toggle("mp-room-active", multiplayerRoomOpen);
  $("#mpRoomView").hidden = !multiplayerRoomOpen;
  syncMpSettingsRoomDrawer(multiplayerRoomOpen);
  const hasInstalledPackage = installedPackageSnapshots.has(state.game);
  const installedGeneration = installedPackageSnapshots.get(state.game) || null;
  const multiplayerAvailable = (
    !!installedGeneration?.descriptor?.runtimes?.multiplayer ||
    typeof game().multiplayerRuntime === "string"
  );
  if (multiplayerProduct && multiplayerAvailable) state.runtimeVariant = "multiplayer";
  $("#launchText").textContent = !hasInstalledPackage && importServer
    ? t("action.importGameData") : state.runtimeVariant === "multiplayer" ? t("action.startMultiplayer") : t("action.start");
  // Keep one explicit import entry in every publication mode. A hosted
  // release may still be paired with a user-provided content generation and
  // then offer the matching remote update through the normal launch flow.
  $("#gamePackageImport").hidden = false;
  const musicAvailability = resolveMusicAvailability(musicAvailabilityContext());
  const musicSelect = $("#musicSelect");
  syncMusicSelectAvailability(musicSelect, musicAvailability);
  const languageEntries = languageCatalog(state.game);
  const languageSelect = $("#languageSelect");
  languageSelect.replaceChildren(...languageEntries.map(entry => {
    const option = document.createElement("option"); option.value = entry.id; option.textContent = entryTitle(entry); return option;
  }));
  languageSelect.value = state.language;
  $("#musicOption").hidden = !musicAvailability.ogg;
  $("#languageOption").hidden = languageEntries.length <= 1;
  $("#replayFileTool").hidden = !gameFeatureAvailable(state.game, "replayManagement");
  const mpLanguageSelect = $("#mpLanguageSelect");
  mpLanguageSelect.replaceChildren(...languageEntries.map(entry => {
    const option = document.createElement("option"); option.value = entry.id; option.textContent = entryTitle(entry); return option;
  }));
  mpLanguageSelect.value = state.language;
  $("#mpShareSettingsToggle").setAttribute("aria-checked", String(mpShareSingleplayerSettings));
  $("#mpShareSettingsToggle").classList.toggle("on", mpShareSingleplayerSettings);
  syncMusicSelectAvailability($("#mpMusicSelect"), musicAvailability);
  $("#mpFrameLimitToggle").setAttribute("aria-checked", String(state.options.frameLimit60Enabled));
  $("#mpFrameLimitToggle").classList.toggle("on", state.options.frameLimit60Enabled);
  $("#mpTh06HitboxOption").hidden = !gameFeatureAvailable(state.game, "focusHitbox");
  $("#mpTh06HitboxToggle").setAttribute("aria-checked", String(state.options.th06FocusHitbox));
  $("#mpTh06HitboxToggle").classList.toggle("on", state.options.th06FocusHitbox);
  $("#mpTouchToggle").setAttribute("aria-checked", String(state.options.touchEnabled));
  $("#mpTouchToggle").classList.toggle("on", state.options.touchEnabled);
  $("#mpAlwaysHitboxToggle").setAttribute("aria-checked", String(state.options.alwaysHitbox));
  $("#mpAlwaysHitboxToggle").classList.toggle("on", state.options.alwaysHitbox);
  $("#mpLocalPlayerVisibilityToggle").setAttribute("aria-checked", String(state.options.enhanceLocalPlayerVisibility));
  $("#mpLocalPlayerVisibilityToggle").classList.toggle("on", state.options.enhanceLocalPlayerVisibility);
  $("#mpMagnifierToggle").setAttribute("aria-checked", String(state.options.magnifierEnabled));
  $("#mpMagnifierToggle").classList.toggle("on", state.options.magnifierEnabled);
  $("#mpMagnifierConflict").hidden = state.options.touchFocusMode !== "two-finger";
  $("#mpMobileOptions").classList.toggle("open", mpUiState.mobileOpen);
  $("#mpMobileOptionsToggle").setAttribute("aria-expanded", String(mpUiState.mobileOpen));
  const selectedLanguage = languageEntry();
  const selectedPack = record(selectedLanguage.offlinePack) || record(selectedLanguage.pack);
  $("#languagePackSize").textContent = selectedPack ? formatBytes(Number(selectedPack.bytes) || 0) : t("settings.builtin");
  const thpracAvailable = gameFeatureAvailable(state.game, "thprac");
  if (!thpracAvailable || multiplayerProduct) state.options.thpracEnabled = false;
  $("#thpracOption").hidden = !thpracAvailable || multiplayerProduct;
  $("#th06HitboxOption").hidden = !gameFeatureAvailable(state.game, "focusHitbox");
  $("#mobileOptions").classList.toggle("open", state.mobileOpen);
  $("#mobileOptionsToggle").setAttribute("aria-expanded", String(state.mobileOpen));
  const switches = { thpracToggle: state.options.thpracEnabled, thpracTouchControlsToggle: state.options.thpracTouchControlsEnabled, restartButtonToggle: state.options.restartButtonEnabled, magnifierToggle: state.options.magnifierEnabled, frameLimitToggle: state.options.frameLimit60Enabled, th06HitboxToggle: state.options.th06FocusHitbox, touchToggle: state.options.touchEnabled, doubleTapBombToggle: state.options.doubleTapBombEnabled, alwaysHitboxToggle: state.options.alwaysHitbox };
  for (const [id, enabled] of Object.entries(switches)) {
    $("#" + id).setAttribute("aria-checked", String(enabled));
    $("#" + id).classList.toggle("on", enabled);
  }
  const thpracToggle = $("#thpracToggle");
  thpracToggle.disabled = !thpracAvailable || multiplayerProduct || state.runtimeVariant === "multiplayer";
  thpracToggle.title = multiplayerProduct || state.runtimeVariant === "multiplayer" ? t("settings.thpracUnavailableMultiplayer") : "";
  const frameLimitToggle = $("#frameLimitToggle");
  frameLimitToggle.disabled = false;
  frameLimitToggle.title = "";
  const frameLimitHint = $("#frameLimitHint");
  $("#frameLimitHintText").textContent = t("settings.frameLimitHint");
  frameLimitHint.classList.add("option-warning");
  const touchMovementMode = $("#touchMovementMode");
  touchMovementMode.value = state.options.touchMovementMode;
  touchMovementMode.disabled = false;
  $("#doubleTapBombToggle").disabled = false;
  $("#thpracTouchControlsToggle").disabled = !state.options.thpracEnabled;
  const touchFocusMode = $("#touchFocusMode");
  touchFocusMode.value = state.options.touchFocusMode;
  touchFocusMode.disabled = false;
  syncTouchGuideFocusMode();
  $("#magnifierConflict").hidden = state.options.touchFocusMode !== "two-finger";
  const twoFingerFocusOption = touchFocusMode.querySelector<HTMLOptionElement>('option[value="two-finger"]');
  const wheelMovement = touchMovementUsesJoystick(state.options.touchMovementMode);
  const touchSensitivity = $("#touchSensitivity");
  const touchSensitivityValue = $("#touchSensitivityValue");
  const touchSensitivityCustom = $("#touchSensitivityCustom");
  const touchSensitivityCustomToggle = $("#touchSensitivityCustomToggle");
  const customSensitivitySelected = touchSensitivityCustomOpen || !touchSensitivityPresets.has(state.options.touchSensitivity);
  touchSensitivity.value = String(state.options.touchSensitivity);
  touchSensitivity.disabled = wheelMovement;
  touchSensitivityValue.textContent = `${state.options.touchSensitivity}%`;
  touchSensitivityCustom.hidden = !customSensitivitySelected;
  touchSensitivityCustomToggle.disabled = wheelMovement;
  touchSensitivityCustomToggle.classList.toggle("selected", customSensitivitySelected);
  touchSensitivityCustomToggle.setAttribute("aria-pressed", String(customSensitivitySelected));
  touchSensitivityCustomToggle.setAttribute("aria-expanded", String(customSensitivitySelected));
  document.querySelectorAll<HTMLButtonElement>("[data-touch-sensitivity-preset]").forEach(button => {
    const selected = !customSensitivitySelected && Number(button.dataset.touchSensitivityPreset) === state.options.touchSensitivity;
    button.disabled = wheelMovement;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  touchSensitivityPreview.hidden = !touchLayoutEditing || wheelMovement;
  if (!touchLayoutEditing || wheelMovement) cancelTouchSensitivityPreview();
  // Touch layout management is a preview/editor surface, not the live input
  // enable switch.  Keep the full applicable control set visible while the
  // editor is open even when gameplay touch input itself is disabled.
  const spectatorRuntime = isMultiplayerProduct() && state.netplay.spectator === true;
  const touchSurfaceVisible = (!spectatorRuntime && state.options.touchEnabled) || touchLayoutEditing;
  if (twoFingerFocusOption) twoFingerFocusOption.disabled = wheelMovement;
  player.classList.toggle("touch-enabled", touchSurfaceVisible);
  player.classList.toggle("touch-joystick-enabled", wheelMovement && touchSurfaceVisible);
  $("#touchJoystick").hidden = !(wheelMovement && touchSurfaceVisible);
  $("#touchRestart").hidden = !state.options.restartButtonEnabled;
  syncDirectTouchSurfaceVisibility();
  renderTouchActionState();
  const thpracControlsVisible = !spectatorRuntime && thpracTouchControlsVisible();
  touchThpracInput.hidden = !thpracControlsVisible;
  touchThpracTab.hidden = !thpracControlsVisible;
  touchThpracMenu.hidden = !thpracControlsVisible;
  touchThpracInput.classList.toggle("is-on", thpracMouseMode);
  touchThpracInput.setAttribute("aria-pressed", String(thpracMouseMode));
  requiredDescendant(touchThpracInput, "strong", HTMLElement).textContent = t("touch.mouse");
  touchThpracFunctionKeys.hidden = !thpracMenuOpen;
  applyTouchLayout();
  if (touchLayoutEditing) updateTouchLayoutEditorUi();
  gameZoom.refreshUi();
  updatePlayerOrientationUi();
  syncAllCustomSelects();
}

window.addEventListener("eagler-ui-locale-change", () => {
  document.documentElement.lang = getUiLocale();
  renderBrandUpdateAge();
  render();
  renderServerStatusNote();
  if (currentStatusMessage) setTranslatedStatus(currentStatusMessage.key, currentStatusMessage.params);
});

function validatedNetplayOptions() {
  const multiplayer = game().multiplayer;
  if (!multiplayer) throw new Error(t("runtime.multiplayerUnsupported"));
  return buildMultiplayerRuntimeOptions({
    url: state.netplay.url,
    player: state.netplay.player,
    playerCount: state.netplay.playerCount,
    seed: state.netplay.seed,
    difficulty: state.netplay.difficulty,
    spectator: state.netplay.spectator === true,
    spectatorId: state.netplay.spectatorId,
    spectatorCount: state.netplay.spectatorCount,
    iceServers: state.netplay.iceServers,
    loadouts: state.netplay.loadouts,
  }, {
    difficultyMax: multiplayer.difficultyMax,
    characterMax: multiplayer.characterMax,
  });
}

function setOption<K extends keyof GameOptions>(name: K, value: GameOptions[K]) {
  if (name === "thpracEnabled" && !gameFeatureAvailable(state.game, "thprac")) return;
  if (state.options[name] === value) return;
  state.options[name] = value;
  if ((name === "touchEnabled" || name === "thpracEnabled" || name === "thpracTouchControlsEnabled") && !thpracTouchControlsAvailable()) {
    thpracMouseMode = false;
    thpracMousePointerId = null;
    thpracMenuOpen = false;
  }
  if (name === "touchEnabled" && !value) {
    touchControls.focusEnabled = false;
    touchControls.joystickX = 0;
    touchControls.joystickY = 0;
  }
  if (name === "touchMovementMode") {
    touchControls.joystickX = 0;
    touchControls.joystickY = 0;
    if (touchMovementUsesJoystick(value) && state.options.touchFocusMode === "two-finger") state.options.touchFocusMode = "hold-button";
  }
  if (name === "touchFocusMode") touchControls.focusEnabled = false;
  saveGamePreferences();
  resetRuntime();
  render();
}

function touchModeConfirmationText(mode: TouchMovementMode | "touch") {
  if (mode === "touch") {
    return t("touch.replayWarning");
  }
  if (mode === "touch-unlimited") {
    return t("touch.unlimitedWarning");
  }
  if (mode === "joystick-free") {
    return t("touch.freeStickWarning");
  }
  return "";
}

async function confirmTouchModeBeforeEnable(mode: TouchMovementMode | "touch") {
  const message = touchModeConfirmationText(mode);
  return !message || await askConfirmation({
    message,
    confirmText: t("touch.enableConfirm")
  });
}

async function confirmInputWarnings() {
  const pureTouch = navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches;
  if (!state.options.touchEnabled && (pureTouch || mobileDevice)) {
    return askConfirmation({
      message: t("touch.disabledInputWarning"),
      confirmText: t("touch.startAnyway")
    });
  }
  return true;
}

function resetRuntime() {
  activeLocalMusicInstall?.cancel();
  activeLocalMusicInstall = null;
  cancelBlockingNetworkOperation();
  cancelDirectTouches(false);
  clearOptionalTimeout(musicNoticeTimer); $("#musicNotice").classList.remove("show");
  clearFirstFrameWatchdog();
  clearGameDataAttempt();
  hideTransfer();
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(t("runtime.switched")));
  }
  state.pending.clear(); state.ready = false; state.launched = false; state.source = ""; state.sourceIdentity = "";
  syncDirectTouchSurfaceVisibility();
  launchMusicFallback = null;
  deferredBackgroundPackageUpdate = null;
  releaseRuntimePackageSession();
  runtimeSessions.clear();
  activeInstalledPackageGeneration = null;
  managedRuntimeGenerationLease.clear();
  resetRuntimeDiagnostics();
  touchControls.focusEnabled = false;
  touchControls.bombSerial = 0;
  touchControls.escapeSerial = 0;
  touchControls.joystickX = 0;
  touchControls.joystickY = 0;
  thpracMouseMode = false;
  thpracMousePointerId = null;
  thpracMenuOpen = false;
  uninstallRuntimeDomBridges();
  gameZoom.reset();
  updatePlayerOrientationUi();
  midiSynth?.reset();
  frame.removeAttribute("src");
}

async function prepareMidi() {
  if (state.music !== "midi" && !isOggMusicMode(state.music)) return;
  if (!webAudioAvailable) throw new Error(t("music.webAudioUnsupported"));
  await ensureTinySynth();
  if (!launcherWindow.WebAudioTinySynth) throw new Error(t("music.synthMissing"));
  if (!midiSynth) midiSynth = new launcherWindow.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 64 });
  const context = midiSynth.getAudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
}

function suspendHostedMidi() {
  const context = midiSynth?.getAudioContext?.();
  if (context?.state === "running") context.suspend().catch(() => {});
}

function resumeHostedMidi() {
  if (!state.launched || !player.classList.contains("open") || document.hidden ||
      !document.hasFocus() || document.activeElement !== frame) return;
  const context = midiSynth?.getAudioContext?.();
  if (context?.state === "suspended") context.resume().catch(() => {});
}

frame.addEventListener("blur", suspendHostedMidi);
frame.addEventListener("focus", resumeHostedMidi);
window.addEventListener("blur", suspendHostedMidi);
window.addEventListener("focus", resumeHostedMidi);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspendHostedMidi(); else resumeHostedMidi();
});

frame.addEventListener("load", () => {
  if (!frame.contentWindow) return;
  installRuntimeDomBridges();
});

const gameKeyboardLockCodes = [
  "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyZ", "KeyX", "ShiftLeft", "ShiftRight", "Enter",
  "Tab", "Backspace", "F1", "F2", "F3", "F4", "F5", "F6", "F7"
];
async function lockEscapeForGame() {
  if (!isPlayerFullscreen() || !launcherNavigator.keyboard?.lock) return;
  try {
    // On Android this API is optional, but some browsers may expose it when a
    // physical keyboard is connected. Treat it as best-effort protection
    // against browser-level key consumption in fullscreen; the host OS still
    // has final say over reserved shortcuts.
    await launcherNavigator.keyboard.lock(gameKeyboardLockCodes);
  } catch {
    // Keyboard Lock is a progressive enhancement. Unsupported browsers retain
    // their normal browser/system key handling.
  }
}

function isPlayerFullscreen() {
  const current = document.fullscreenElement || launcherDocument.webkitFullscreenElement;
  // New requests always fullscreen the dedicated player element. Keep the
  // document root accepted only as a legacy/foreign fullscreen state so we
  // can still exit it cleanly if a browser preserved an older session.
  return current === player || current === document.documentElement;
}

async function exitPlayerFullscreen() {
  if (document.exitFullscreen) await document.exitFullscreen();
  else if (launcherDocument.webkitExitFullscreen) await launcherDocument.webkitExitFullscreen();
}

async function enterPlayerFullscreen({ focusGame = true } = {}) {
  if (isPlayerFullscreen()) {
    if (focusGame && state.launched) {
      await lockEscapeForGame();
      refocusGameIfNeeded();
    }
    return true;
  }
  const current = document.fullscreenElement || launcherDocument.webkitFullscreenElement;
  if (current) await exitPlayerFullscreen();
  const target = playerFullscreenElement;
  if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: "hide" });
  else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  else throw new Error(t("fullscreen.unsupported"));
  if (focusGame && state.launched) {
    await lockEscapeForGame();
    refocusGameIfNeeded();
  }
  return isPlayerFullscreen();
}

async function togglePlayerFullscreen() {
  try {
    if (isPlayerFullscreen()) {
      await exitPlayerFullscreen();
      return;
    }
    await enterPlayerFullscreen({ focusGame: true });
  } catch (error) {
    setPlayerStatus(t("fullscreen.switchFailed", { reason: errorMessage(error) }));
  }
}

function handleGameFullscreenKey(event: KeyboardEvent) {
  if (event.type === "keydown" && event.code === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat && !fullscreenChordActive) {
      fullscreenChordActive = true;
      togglePlayerFullscreen();
    }
    return;
  }
  if (event.type === "keyup" && event.code === "Enter" && fullscreenChordActive) {
    event.preventDefault();
    event.stopImmediatePropagation();
    fullscreenChordActive = false;
  }
}

function handleFullscreenChange() {
  syncTransientOverlayHost();
  gameZoom.cancelGesture();
  cancelTouchLayoutGestures();
  const fullscreenButton = $("#fullscreenToggle");
  const isFullscreen = isPlayerFullscreen();
  fullscreenButton.setAttribute("aria-label", t(isFullscreen ? "player.exitFullscreen" : "player.enterFullscreen"));
  fullscreenButton.title = t(isFullscreen ? "player.exitFullscreenTitle" : "player.enterFullscreenTitle");
  if (isFullscreen) {
    if (state.launched) {
      lockEscapeForGame();
      refocusGameIfNeeded();
    }
  } else {
    fullscreenChordActive = false;
    launcherNavigator.keyboard?.unlock?.();
  }
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("fullscreenerror", () => {
  gameZoom.cancelGesture();
  cancelTouchLayoutGestures();
});

const hostedGameKeyCodes = new Set([
  "KeyZ", "KeyX", "ShiftLeft", "ShiftRight", "Escape",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Numpad8", "Numpad2", "Numpad4", "Numpad6", "Numpad7", "Numpad9", "Numpad1", "Numpad3",
  "ControlLeft", "ControlRight", "KeyQ", "KeyS", "Home", "Enter", "NumpadEnter", "KeyD", "KeyR",
  "Tab", "Backspace", "F1", "F2", "F3", "F4", "F5", "F6", "F7"
]);
const hostedGameKeys = new Set([
  "z", "x", "shift", "escape", "esc", "arrowup", "arrowdown", "arrowleft", "arrowright",
  "control", "q", "s", "home", "enter", "d", "r", "tab", "backspace", "f1", "f2", "f3", "f4", "f5", "f6", "f7"
]);
// Legacy DOM keyCode fallback for old/vendor WebViews where code/key can be
// empty or Unidentified. These are DOM virtual-key values, not Android's raw
// KEYCODE_DPAD_* 19..22 values; Chromium converts the latter before Web events.
const hostedGameLegacyKeyCodes = new Set([8, 9, 13, 16, 17, 27, 36, 37, 38, 39, 40, 68, 81, 82, 83, 88, 90, 112, 113, 114, 115, 116, 117, 118]);
function forwardHostedKeyboard(event: KeyboardEvent) {
  if (!state.launched || !player.classList.contains("open") || !frame.contentWindow) return;
  if (event.metaKey || event.altKey) return;
  const key = String(event.key || "").toLowerCase();
  const keyCode = Number.isInteger(event.keyCode) ? event.keyCode : 0;
  if (!hostedGameKeyCodes.has(event.code || "") && !hostedGameKeys.has(key) && !hostedGameLegacyKeyCodes.has(keyCode)) return;
  frame.contentWindow.postMessage({
    protocol, game: state.game, command: "keyboard", down: event.type === "keydown",
    code: event.code || "", key: event.key || "", keyCode,
    location: Number.isInteger(event.location) ? event.location : 0
  }, location.origin);
  event.preventDefault();
}
window.addEventListener("keydown", forwardHostedKeyboard, true);
window.addEventListener("keyup", forwardHostedKeyboard, true);
function clearHostedKeyboard() {
  if (!state.launched || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ protocol, game: state.game, command: "keyboard-clear" }, location.origin);
}
window.addEventListener("blur", clearHostedKeyboard);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") clearHostedKeyboard();
});

function preventPlayerBrowserGesture(event: Event) {
  if (!player.classList.contains("open")) return;
  const target = event.target;
  if (target instanceof Element && target.closest("#gameDataLinkWindow")) return;
  if (target === player || (target instanceof Node && player.contains(target))) event.preventDefault();
}
for (const type of ["contextmenu", "selectstart", "dragstart", "gesturestart", "gesturechange", "gestureend"])
  document.addEventListener(type, preventPlayerBrowserGesture, { capture: true, passive: false });

function openPlayerView() {
  if (!player.classList.contains("open")) {
    const operation = playerRouteHistoryOperation({
      currentUrl: location.href,
      currentState: history.state,
      routedProduct: routedGameFromLocation(),
      product: state.product,
    });
    if (operation) applyHistoryOperations(history, [operation]);
  }
  document.body.classList.add("player-active");
  player.classList.add("open");
  player.setAttribute("aria-hidden", "false");
  if (networkActivitySnapshot.count) renderNetworkActivity(networkActivitySnapshot);
  applyTouchLayout(touchLayout);
  let touchHelpSeen = touchHelpSeenInSession;
  if (!touchHelpSeen) {
    try { touchHelpSeen = localStorage.getItem(touchHelpSeenKey) === "1"; } catch {}
  }
  if (!mpGameCheckInFlight && state.options.touchEnabled && !state.netplay.spectator && !touchHelpSeen) {
    touchHelpSeenInSession = true;
    try { localStorage.setItem(touchHelpSeenKey, "1"); } catch {}
    $("#touchHelp").hidden = false;
    player.classList.add("help-visible");
  }
}

function closeTouchHelp() {
  collapseTouchGuides();
  $("#touchHelp").hidden = true;
  player.classList.remove("help-visible");
  refocusGameIfNeeded();
}

async function syncTouchControls() {
  if (!state.launched) return;
  // Touch state is a live control snapshot, not a transactional operation.
  // After launch the Runtime main loop may not service request/reply traffic
  // synchronously, so never turn a harmless missing ACK into a startup error.
  pushTouchControlsLive();
}
function pushTouchControlsLive() {
  return postRuntimeTouchControls(touchRuntimeMessageContext(), touchControls, state.options.touchSensitivity);
}
function refocusGameIfNeeded() {
  // Keep the historical gameplay hot path: HUD pointerdown handlers prevent
  // default focus transfer, so while the game iframe still owns focus this is
  // intentionally a no-op.  Do not force the Android Player -> Runtime focus
  // relay here; doing so on every fire/focus/bomb/escape input cancels active
  // pointer streams and causes visible frame hitches on mobile WebView.
  // On iOS the gameplay finger is intentionally owned by the host document's
  // direct-touch surface. Re-focusing the iframe while that TouchEvent sequence
  // is still active can make WebKit terminate or re-route the gesture. HUD
  // controls must only change their own state until the gameplay touches end.
  if (iosWebKitTouch && directTouchPointers.size) return;
  if (document.activeElement !== frame) frame.focus({ preventScroll: true });
}

function resetGameZoomFromControl() {
  if (!state.launched) return;
  gameZoom.reset();
  refocusGameIfNeeded();
}

async function confirmRuntimeSyncBeforeClose(): Promise<boolean> {
  return confirmRuntimeClose({
    runtimeReady: () => state.ready,
    sync: () => send("sync", {}, 10000),
    decide: async error => {
      const choice = await askDecision({
        message: t("dialog.saveSyncFailed", { reason: errorMessage(error) }),
        confirmText: t("action.retrySave"),
        secondaryText: t("action.leaveAnyway"),
        cancelText: t("action.stayInGame"),
        tone: "danger",
      });
      return choice === "confirm" ? "retry" : choice === "secondary" ? "leave" : "stay";
    },
  });
}

async function closePlayerView(fromHistory = false, { skipSync = false, returnToMpRoom = false } = {}) {
  gameZoom.cancelGesture();
  cancelTouchLayoutGestures();
  // Once the Runtime has already emitted exit there may be nobody left to
  // answer a sync RPC. Normal/manual closes keep the current Player (including
  // fullscreen state) intact until persistence has either succeeded or the
  // user explicitly chooses to leave without it.
  if (!skipSync && !await confirmRuntimeSyncBeforeClose()) return false;
  if (isPlayerFullscreen()) await exitPlayerFullscreen().catch(() => {});
  $("#touchHelp").hidden = true;
  collapseTouchGuides();
  player.classList.remove("help-visible");
  player.classList.remove("open");
  document.body.classList.remove("player-active");
  player.setAttribute("aria-hidden", "true");
  resetRuntime();
  state.replayViewer = false;
  if (returnToMpRoom && mpUiState.room && isMultiplayerProduct()) {
    state.hasSelection = true;
    state.runtimeVariant = "multiplayer";
    const roomCode = mpUiState.room.code;
    applyHistoryOperations(history, [returnToRoomHistoryOperation({
      currentUrl: location.href,
      currentState: history.state,
      product: state.product,
      roomCode,
    })]);
    renderMpRoom();
    render();
    if (!mpLobby.connected) mpReconnectLobbyNow();
    appShellClient?.maybeReload();
    return true;
  }
  if (!fromHistory) replaceLauncherHomeHistory();
  showLauncherHome();
  appShellClient?.maybeReload();
  return true;
}

function syncSelectionFromPlayerRoute() {
  const routed = routedGameFromLocation();
  if (!routed || !productEnabled(routed)) return false;
  const nextGame = gameIdForProduct(routed);
  if (state.game !== nextGame || state.product !== routed) {
    state.product = routed;
    state.game = nextGame;
    state.runtimeVariant = isMultiplayerProduct(routed) ? "multiplayer" : "normal";
    restoreMpProductPreferences(routed);
    restoreGamePreferences(state.game, currentPreferenceId());
    resetRuntime();
  }
  state.hasSelection = true;
  render();
  return true;
}

window.addEventListener("popstate", async () => {
  if (mpUiState.room) {
    const routedRoom = mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
    if (!routedRoom || routedRoom !== mpUiState.room.code) {
      mpLeaveRoom(true);
      return;
    }
  }
  if (player.classList.contains("open") && !await closePlayerView(true)) {
    const restore = playerRouteHistoryOperation({
      currentUrl: location.href, currentState: history.state,
      routedProduct: routedGameFromLocation(), product: state.product,
    });
    if (restore) applyHistoryOperations(history, [restore]);
    return;
  }
  if (!syncSelectionFromPlayerRoute()) showLauncherHome();
});
window.addEventListener("pageshow", event => {
  if (event.persisted && !mpUiState.room && !syncSelectionFromPlayerRoute()) showLauncherHome();
});

function send(command: RuntimeProtocolCommand, payload: UnknownRecord = {}, timeout = 15000): Promise<RuntimeResponseMessage> {
  const runtime = frame.contentWindow;
  if (!state.ready || !runtime) return Promise.reject(new Error(t("runtime.notReady")));
  const request = `${Date.now().toString(36)}-${++state.request}`;
  return new Promise<RuntimeResponseMessage>((resolve, reject) => {
    const expire = () => { state.pending.delete(request); reject(new Error(t("runtime.operationTimeout", { command }))); };
    const pending: PendingRuntimeRequest = { resolve, reject, timer: setTimeout(expire, timeout) };
    if (command === "configure") {
      const loadedByMode = new Map<string, number>();
      pending.noteProgress = (mode, loaded) => {
        if (loaded <= (loadedByMode.get(mode) || 0)) return;
        loadedByMode.set(mode, loaded);
        clearTimeout(pending.timer);
        pending.timer = setTimeout(expire, timeout);
      };
    }
    state.pending.set(request, pending);
    runtime.postMessage({ protocol, game: state.game, command, request, ...payload }, location.origin);
  });
}

launcherWindow.__eaglerPrepareManagedRuntimeDataV1 = async request => {
  const generation = managedRuntimeGenerationLease.resolve(request);
  const session = currentRuntimeSession();
  setPlayerStatus(t("runtime.handingLocalData"));
  try {
    return await readManagedRuntimeData(generation);
  } catch (error) {
    const failure = error instanceof InstalledGameDataError
      ? new GameDataAcquisitionError(`本地游戏数据不完整，请重新导入或修复：${error.message}`, { cause: error })
      : error;
    // Older Runtime shells only print provider rejection inside their iframe.
    // Notify the readiness owner directly instead of waiting for its watchdog.
    if (runtimeSessionCurrent(session)) frame.dispatchEvent(new CustomEvent("runtime-error", { detail: failure }));
    throw failure;
  }
};

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const message = parseRuntimeInboundMessage(event.data, state.game);
  if (!message) return;
  if (message.event === "player-debug") {
    showPlayerDebug(message);
    return;
  }
  if (message.event === "ready") {
    // Emscripten reports the final GAME DATA progress event, but the hosted
    // shell has no separate completion event for that preload. The runtime's
    // ready notification is the authoritative boundary: hide only the base
    // transfer here so an OGG transfer can still be displayed afterwards.
    finishGameDataAttempt();
    if (transferKind === "game") hideTransfer();
    state.ready = true;
    setPlayerStatus(t("runtime.readyStatus")); setStatus(t("runtime.readyWithMusic", { game: state.game.toUpperCase(), music: musicModeLabel(state.music) }));
    render();
    frame.dispatchEvent(new CustomEvent("runtime-ready")); return;
  }
  if (message.event === "first-frame") {
    noteFirstFrame();
    // The Runtime main loop is now definitely live. Push the current touch
    // snapshot here instead of racing another message against launch/unwind.
    if (state.launched) pushTouchControlsLive();
    startRuntimeSchedulingProbe();
    updateRuntimeDiagnostics();
    frame.dispatchEvent(new CustomEvent("runtime-first-frame"));
    return;
  }
  if (message.event === "runtime-info") {
    runtimeDiagnosticState.renderer = typeof message.renderer === "string" ? message.renderer : "";
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "frame-health") {
    runtimeDiagnosticState.fps = Number.isFinite(Number(message.fps)) ? Number(message.fps) : null;
    runtimeDiagnosticState.maxGapMs = Number.isFinite(Number(message.maxGapMs)) ? Number(message.maxGapMs) : null;
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "audio-health") {
    runtimeDiagnosticState.minQueuedMs = Number.isFinite(Number(message.minQueuedMs)) ? Number(message.minQueuedMs) : null;
    runtimeDiagnosticState.backend = message.backend === "worklet" ? "worklet" : message.backend === "script" ? "script" : "";
    runtimeDiagnosticState.underruns = Math.max(0, Number(message.underruns) || 0);
    runtimeDiagnosticState.robust = !!message.robust;
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "exit") {
    setPlayerStatus(message.status === "success" ? t("runtime.gameExited") : t("runtime.gameExitedAbnormally"));
    closePlayerView(false, {
      skipSync: true,
      returnToMpRoom: !!mpUiState.room && isMultiplayerProduct(),
    }); return;
  }
  if (message.event === "error") {
    const error = String(message.error || t("runtime.startFailed"));
    setPlayerStatus(error);
    frame.dispatchEvent(new CustomEvent("runtime-error", { detail: error }));
    return;
  }
  if (message.event === "transfer") {
    const progress = transferPresentationFromRuntime(message);
    for (const pending of state.pending.values()) pending.noteProgress?.(progress.mode || "", Number(progress.loaded) || 0);
    showTransfer(progress);
    return;
  }
  if (message.event === "music-error" || message.event === "music-incomplete") {
    if (!state.launched) transferFailure({ failed: Number(message.failed) || 0 });
    return;
  }
  if (message.event === "music-complete") { transferComplete(transferPresentationFromRuntime(message)); return; }
  if (message.event === "midi-fallback") { showMidiFallback(); return; }
  if (!isRuntimeResponseMessage(message)) return;
  const pending = state.pending.get(message.request);
  if (!pending) return;
  clearOptionalTimeout(pending.timer); state.pending.delete(message.request);
  if (message.ok) pending.resolve(message); else {
    const error = new RuntimeOperationError(typeof message.error === "string" ? message.error : t("runtime.operationFailed"));
    if (Number.isInteger(message.errno)) error.errno = Number(message.errno);
    pending.reject(error);
  }
});

function waitForRuntimeReady(session: RuntimeSessionToken, timeoutMessage: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const cleanup = () => {
      clearOptionalTimeout(timer);
      frame.removeEventListener("runtime-ready", ready);
      frame.removeEventListener("runtime-error", failed);
      unsubscribe();
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const ready = () => {
      if (!runtimeSessionCurrent(session)) return;
      finish(resolve);
    };
    const failed = (event: Event) => {
      if (!runtimeSessionCurrent(session)) return;
      const detail = event instanceof CustomEvent ? event.detail : t("runtime.startFailed");
      finish(() => reject(detail instanceof Error ? detail : new Error(typeof detail === "string" ? detail : t("runtime.startFailed"))));
    };
    const timer = setTimeout(() => {
      if (!runtimeSessionCurrent(session)) {
        finish(() => reject(new Error(t("runtime.switched"))));
        return;
      }
      finish(() => reject(new Error(timeoutMessage)));
    }, 120000);
    unsubscribe = runtimeSessions.subscribe(() => {
      if (!runtimeSessionCurrent(session)) finish(() => reject(new Error(t("runtime.switched"))));
    });
    frame.addEventListener("runtime-ready", ready);
    frame.addEventListener("runtime-error", failed);
  });
}

function waitForRuntimeFirstFrame(session: RuntimeSessionToken, timeoutMs = firstFrameFallbackMs + 2000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const cleanup = () => {
      clearOptionalTimeout(timer);
      frame.removeEventListener("runtime-first-frame", firstFrame);
      frame.removeEventListener("runtime-error", failed);
      unsubscribe();
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const firstFrame = () => {
      if (runtimeSessionCurrent(session)) finish(resolve);
    };
    const failed = (event: Event) => {
      if (!runtimeSessionCurrent(session)) return;
      const detail = event instanceof CustomEvent ? event.detail : t("runtime.startFailed");
      finish(() => reject(detail instanceof Error ? detail : new Error(String(detail || t("runtime.startFailed")))));
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(t("runtime.firstFrameLate"))));
    }, timeoutMs);
    unsubscribe = runtimeSessions.subscribe(() => {
      if (!runtimeSessionCurrent(session)) finish(() => reject(new Error(t("runtime.switched"))));
    });
    frame.addEventListener("runtime-first-frame", firstFrame);
    frame.addEventListener("runtime-error", failed);
  });
}

async function ensureInstalledPackageRuntime(show = true) {
  const installed = await readCurrentPackageGeneration(state.game);
  const generation = installed?.generation;
  if (!generation?.id) { activeInstalledPackageGeneration = null; return false; }
  installedPackageSnapshots.set(state.game, generation);
  const requestedIdentity = `package:${state.game}:${generation.id}:${state.runtimeVariant}:${state.replayViewer ? "replay" : "game"}`;
  if (state.ready && state.sourceIdentity === requestedIdentity) return true;

  resetRuntime();
  // Package Store remains the source of truth, but the game itself runs
  // directly in #gameFrame. The intermediate Player/about:blank carrier was
  // removed because real iOS WebKit regressed under the extra iframe/WebGL
  // lifecycle even though the same Runtime worked in the historical
  // single-iframe topology.
  activeInstalledPackageGeneration = generation;
  const runtimeSession = await bindRuntimePackageSession(generation);
  managedRuntimeGenerationLease.bind(state.game, generation);
  state.sourceIdentity = requestedIdentity;
  clearGameDataAttempt();
  setPlayerStatus(t("runtime.preparingLocal"));
  showTransfer({
    kind: "game",
    mode: "runtime",
    title: t("runtime.preparingLocal"),
    label: t("runtime.localGameLabel", { game: state.game.toUpperCase() }),
    phase: "preparing",
    indeterminate: true,
  });
  // Runtime HTML/JS/WASM are Launcher-managed ordinary static resources.
  // Only the selected immutable DATA bytes cross from Package Store into the
  // generated Emscripten loader through Module.getPreloadedPackage.
  state.source = managedRuntimeUrl(runtimeUrl(), generation, state.runtimeVariant, location.href);
  if (show) openPlayerView();
  // Offline readiness is a background enhancement. A newly installed or slow
  // Service Worker must never delay iframe creation for an already-local
  // Package; the Runtime's ordinary request can populate the same cache.
  void cacheRuntimeForOffline(state.game).catch(error =>
    console.warn(`${state.game}: Runtime background offline cache failed`, error));
  const runtimeReady = waitForRuntimeReady(runtimeSession, t("runtime.localLoadTimeout"));
  // App-owned same-origin Runtime URLs can commit and execute immediately.
  // Arm readiness/error listeners before navigation so a fast local Runtime
  // cannot emit `ready` in the gap after frame.src changes.
  frame.src = state.source;
  try { await runtimeReady; }
  catch (error) {
    if (runtimeSessionCurrent(runtimeSession)) resetRuntime();
    throw error;
  }
  return true;
}

function selectedLanguageEntriesForPackageUpdate(): Readonly<Record<string, readonly string[]>> {
  if (!gameFeatureAvailable(state.game, "languages")) return {};
  return { language: state.language === "ja" ? [] : [state.language] };
}

async function maybeUpdateInstalledPackageBeforeLaunch(installed: CurrentPackageGeneration) {
  const generation = installed?.generation;
  const publication = releaseCatalog?.games?.[state.game];
  if (!generation?.id || !publication || generation.descriptor?.revision === publication.revision) return "none";

  const localInstall = installed.installation?.source === "local";
  const choice = await askDecision({
    message: localInstall
      ? t("package.updateAvailableLocal")
      : t("package.updateAvailableRemote"),
    confirmText: t("package.updateNow"),
    secondaryText: t("action.backgroundDownload"),
    cancelText: t("package.keepCurrent"),
  });
  if (choice === "cancel") return "none";
  if (choice === "secondary") return "background";

  const operation = beginBlockingNetworkOperation({ label: t("package.cancelUpdate") });
  try {
    setPlayerStatus(t(localInstall ? "package.updatingLocal" : "package.updatingRemote"));
    const updated = await installPublishedPackage(state.game, {
      catalog: releaseCatalog,
      catalogUrl: releaseCatalogUrl,
      addComponents: [],
      selectedComponentEntries: selectedLanguageEntriesForPackageUpdate(),
      preserveLocalSource: true,
      fetchImpl: packageTrackedFetch(state.game),
      signal: operation.controller.signal,
      onProgress(progress) {
        setPlayerStatus(localInstall
          ? t("package.updatingLocalProgress", { completed: progress.completed, total: progress.total })
          : t("package.updatingRemoteProgress", { completed: progress.completed, total: progress.total }));
      },
    });
    if (updated?.generation) installedPackageSnapshots.set(state.game, updated.generation);
    showToast(t("package.updated"));
    return "updated";
  } catch (error) {
    if (isCancelledDownload(error)) {
      showToast(t("package.updateCancelled"));
      return "none";
    }
    showToast(t("package.updateFailed", { reason: errorMessage(error) }));
    return "none";
  } finally {
    finishBlockingNetworkOperation(operation);
  }
}

function startBackgroundPackageUpdate(installed: CurrentPackageGeneration) {
  const game = state.game;
  if (backgroundPackageUpdates.has(game)) return;
  const catalog = releaseCatalog;
  const catalogUrl = releaseCatalogUrl;
  const addComponents: string[] = [];
  const selectedComponentEntries = selectedLanguageEntriesForPackageUpdate();
  const localInstall = installed?.installation?.source === "local";
  const task = installPublishedPackage(game, {
    catalog,
    catalogUrl,
    addComponents,
    selectedComponentEntries,
    preserveLocalSource: true,
    // Background updates deliberately stay out of the blocking transfer UI.
    fetchImpl: (input, init) => backgroundNetworkActivity.xhrFetch(input, init),
  }).then(updated => {
    if (updated?.generation) {
      installedPackageSnapshots.set(game, updated.generation);
      const session = currentRuntimeSession();
      if (state.game === game && state.launched && runtimeSessionCurrent(session) &&
          runtimeSessionAcceptsGenerationRevision(session?.revision, updated.generation.descriptor?.revision)) {
        // Same-revision optional resources may extend the live session. A
        // cross-revision background update is for the next launch only.
        activeInstalledPackageGeneration = updated.generation;
        startManagedOggProgressiveInstall();
      }
    }
    console.info(`${game}: background Package update complete`);
  }).catch(error => {
    console.warn(`${game}: background Package update failed${localInstall ? " for local install" : ""}`, error);
  }).finally(() => {
    if (backgroundPackageUpdates.get(game) === task) backgroundPackageUpdates.delete(game);
  });
  backgroundPackageUpdates.set(game, task);
}

async function ensureManagedOggStartupBarrier() {
  if (!isOggMusicMode(state.music) || !activeInstalledPackageGeneration) return;
  const session = runtimeSessions.assertCurrent(currentRuntimeSession());
  const gameId = state.game;
  let generation = activeInstalledPackageGeneration;
  const oggIds = componentFileIds(generation.descriptor, "ogg");
  const initialIds = oggIds.slice(0, 2);
  if (initialIds.length < 2) {
    activateLaunchMusicFallback();
    return;
  }
  const missing = initialIds.filter(fileId => !generation.files?.[fileId]?.objectId);
  if (!missing.length) return;
  const publication = releaseCatalog?.games?.[state.game];
  if (importServer || !publication || publication.revision !== generation.descriptor.revision) {
    activateLaunchMusicFallback();
    showToast(t("music.initialOggIncomplete"));
    return;
  }
  const operation = beginBlockingNetworkOperation({ label: t("music.cancelDownload") });
  try {
    setPlayerStatus(t("music.preparingInitialOgg"));
    const updated = await installPublishedPackage(gameId, {
      catalog: releaseCatalog,
      catalogUrl: releaseCatalogUrl,
      addFileIds: initialIds,
      preserveLocalSource: true,
      fetchImpl: packageTrackedFetch(gameId),
      signal: operation.controller.signal,
      onProgress(progress) {
        if (!runtimeSessionCurrent(session)) return;
        setPlayerStatus(t("music.preparingInitialOggProgress", { completed: progress.completed, total: progress.total }));
      },
    });
    runtimeSessions.assertCurrent(session);
    if (!initialIds.every(fileId => !!updated.generation?.files?.[fileId]?.objectId)) {
      throw new Error(t("music.initialOggPersistFailed"));
    }
    generation = updated.generation;
    activeInstalledPackageGeneration = generation;
    installedPackageSnapshots.set(gameId, generation);
  } catch (error) {
    runtimeSessions.assertCurrent(session);
    if (!isCancelledDownload(error)) showToast(t("music.initialOggFailed", { reason: errorMessage(error) }));
    activateLaunchMusicFallback();
  } finally {
    finishBlockingNetworkOperation(operation);
  }
}

function startManagedOggProgressiveInstall() {
  const gameId = state.game;
  const session = currentRuntimeSession();
  const generation = activeInstalledPackageGeneration;
  if (!isOggMusicMode(state.music) || !state.launched || !generation || !runtimeSessionCurrent(session) ||
      !runtimeSessionAcceptsGenerationRevision(session?.revision, generation.descriptor?.revision)) return;
  const existing = backgroundOggInstalls.get(gameId);
  if (existing) {
    // A closing Runtime may still be finishing one persisted track. Once its
    // worker releases the per-game slot, resume for this exact newer Runtime
    // instead of silently waiting for another full launch cycle.
    const resume = () => {
      if (state.launched && state.game === gameId && runtimeSessionCurrent(session)) {
        startManagedOggProgressiveInstall();
      }
    };
    void existing.then(resume, resume);
    return;
  }
  const publication = releaseCatalog?.games?.[gameId];
  if (!publication || publication.revision !== generation.descriptor.revision) return;
  const remaining = componentFileIds(generation.descriptor, "ogg")
    .slice(2)
    .filter(fileId => !generation.files?.[fileId]?.objectId);
  if (!remaining.length) return;
  const task = (async () => {
    for (const fileId of remaining) {
      if (!state.launched || state.game !== gameId || !runtimeSessionCurrent(session)) return;
      try {
        const updated = await installPublishedPackage(gameId, {
          catalog: releaseCatalog,
          catalogUrl: releaseCatalogUrl,
          addFileIds: [fileId],
          preserveLocalSource: true,
          fetchImpl: packageTrackedFetch(gameId),
        });
        if (!updated.generation?.files?.[fileId]?.objectId) throw new Error(t("package.objectNotPersisted"));
        installedPackageSnapshots.set(gameId, updated.generation);
        // The in-flight fetch may outlive a close or game switch. Preserve the
        // completed Package bytes, but never attach them to a different live
        // Runtime or write into its filesystem.
        if (!state.launched || state.game !== gameId || !runtimeSessionCurrent(session)) return;
        activeInstalledPackageGeneration = updated.generation;
        const declaration = updated.generation.descriptor.files[fileId];
        await installManagedPackageResources([{
          fileId,
          path: declaration.target,
          size: Number(declaration.bytes) || 0,
        }], updated.generation, session);
        console.info(`${gameId}: OGG ready ${fileId}`);
      } catch (error) {
        console.warn(`${gameId}: OGG progressive install failed ${fileId}`, error);
        if (state.launched && state.game === gameId && runtimeSessionCurrent(session)) {
          showToast(t("music.backgroundInterrupted", { reason: errorMessage(error) }));
        }
        return;
      }
    }
  })().finally(() => {
    if (backgroundOggInstalls.get(gameId) === task) backgroundOggInstalls.delete(gameId);
  });
  backgroundOggInstalls.set(gameId, task);
}

async function ensureRuntime(show = true) {
  if (!productEnabled(state.product)) throw new Error("该游戏仅在测试版开启");
  // Development has no publication catalog. Materialize its selected music
  // through the same Package Store before considering a reusable generation.
  if ("profile" in manifest && manifest.profile === "web-development" && PRODUCT_GAMES[state.game].dataProvider === "retail-memory") {
    await installDevelopmentPackage(show);
  }
  const localInstalled = await readCurrentPackageGeneration(state.game);
  if (localInstalled?.generation) {
    // Never wait for the network merely to decide whether a local current may
    // launch. If the background Catalog is already known, apply update policy;
    // otherwise start current immediately and learn remote state later.
    const updateMode = show && releaseCatalog ? await maybeUpdateInstalledPackageBeforeLaunch(localInstalled) : "none";
    if (await ensureInstalledPackageRuntime(show)) {
      if (updateMode === "background") deferredBackgroundPackageUpdate = localInstalled;
      return;
    }
  }
  if (!releaseCatalog) {
    try { await remoteReleasePromise; } catch {}
  }
  if (releaseCatalog?.games?.[state.game]) {
    const operation = beginBlockingNetworkOperation({ label: t("package.cancelDownload") });
    try {
      if (show) openPlayerView();
      setPlayerStatus(t("package.installingResources"));
      await installPublishedPackage(state.game, {
        catalog: releaseCatalog,
        catalogUrl: releaseCatalogUrl,
        addComponents: [],
        fetchImpl: packageTrackedFetch(state.game),
        signal: operation.controller.signal,
        onProgress(progress) {
          setPlayerStatus(t("package.installingResourcesProgress", { completed: progress.completed, total: progress.total }));
        }
      });
    } catch (error) {
      if (isCancelledDownload(error)) throw error;
      throw new GameDataAcquisitionError(errorMessage(error), { cause: error });
    } finally {
      finishBlockingNetworkOperation(operation);
    }
    if (await ensureInstalledPackageRuntime(show)) return;
  }
  if (!hostManifestAvailable) {
    throw new GameDataAcquisitionError(remoteCatalogError
      ? t("package.remoteUnavailableNoLocal", { game: state.game.toUpperCase(), reason: errorMessage(remoteCatalogError) })
      : t("package.releaseNotReadyNoLocal", { game: state.game.toUpperCase() }));
  }
  if (importServer) throw new GameDataAcquisitionError(t("package.importServerNoFiles"));
  if (serverResourceMode === "external") {
    throw new GameDataAcquisitionError("外部游戏资源当前不可用，请检查网络 / CDN，或导入本地游戏包");
  }
  // The local development server intentionally publishes an empty Release
  // Catalog. Seed the same Package Store used by published releases from the
  // development Host Manifest's source paths before opening a Runtime that
  // requires managed DATA (TH08/TH10 retail-memory).
  if (!releaseCatalog?.games?.[state.game] && PRODUCT_GAMES[state.game].dataProvider === "retail-memory") {
    try {
      await installDevelopmentPackage(show);
      if (await ensureInstalledPackageRuntime(show)) return;
    } catch (error) {
      if (isCancelledDownload(error)) throw error;
      throw new GameDataAcquisitionError(errorMessage(error), { cause: error });
    }
  }
  const expectedData = gameDataDescriptor();
  const sourceUrl = new URL(runtimeUrl(), location.href);
  sourceUrl.searchParams.set("runtimeVariant", state.runtimeVariant || "normal");
  sourceUrl.searchParams.set("asset", expectedData.version);
  const ogg = game().music?.ogg;
  if (ogg && typeof ogg.version === "string") sourceUrl.searchParams.set("oggAsset", ogg.version);
  const requestedIdentity = sourceUrl.href;
  if (show) openPlayerView();
  if (state.ready && state.sourceIdentity === requestedIdentity) return;
  resetRuntime(); state.sourceIdentity = requestedIdentity; setPlayerStatus(t("runtime.loadingGameData"));
  const runtimeSession = runtimeSessions.begin({
    game: state.game, runtimeVariant: state.runtimeVariant, generationId: null, revision: null,
  });
  state.source = sourceUrl.href;
  beginGameDataAttempt();
  showTransfer({
    kind: "game",
    mode: "runtime",
    title: t("runtime.requestingComponent"),
    label: t("runtime.requestingComponentLabel", { game: state.game.toUpperCase() }),
    phase: "requesting",
    indeterminate: true,
  });
  const runtimeReady = waitForRuntimeReady(runtimeSession, t("runtime.gameLoadTimeout")).catch(error => {
    if (runtimeSessionCurrent(runtimeSession) && /超时/.test(errorMessage(error))) unlockGameDataImport(t("runtime.loadTimedOutImport"));
    throw error;
  });
  frame.src = state.source;
  await runtimeReady;
}

async function selectedMusicResources(): Promise<MusicResource[]> {
  if (!isOggMusicMode(state.music)) return [];
  if (activeInstalledPackageGeneration) {
    const generation = activeInstalledPackageGeneration;
    const ids = componentFileIds(generation.descriptor, "ogg");
    const installed = ids.filter(fileId => !!generation.files?.[fileId]?.objectId);
    if (installed.length) {
      const resources: LocalMusicResource[] = [];
      for (const fileId of installed) {
        const declaration = generation.descriptor.files[fileId];
        if (declaration) resources.push({ packageFileId: fileId, path: declaration.target, size: Number(declaration.bytes) || 0 });
      }
      return resources;
    }
    if (importServer || !releaseCatalog?.games?.[state.game]) return [];
    const descriptorUrl = releaseCatalogEntryUrl(releaseCatalogUrl, releaseCatalog, state.game);
    if (!descriptorUrl) throw new Error(t("music.packageUrlInvalid"));
    return ids.map(fileId => {
      const declaration = generation.descriptor.files[fileId];
      if (!declaration || typeof declaration.source !== "string" || typeof declaration.target !== "string") {
        throw new Error(t("music.packageResourceInvalid"));
      }
      return {
        url: new URL(declaration.source, descriptorUrl).href,
        path: declaration.target,
        size: Number(declaration.bytes) || 0,
      };
    });
  }
  const pack = musicPackage();
  if (!pack || !Array.isArray(pack.files)) throw new Error(t("music.manifestInvalid"));
  const mount = typeof pack.mount === "string" ? pack.mount.replace(/\/$/, "") : "";
  const base = typeof pack.base === "string" ? pack.base : "./";
  const sizes = Array.isArray(pack.sizes) ? pack.sizes : [];
  return pack.files.map((name, index) => {
    if (typeof name !== "string" || !name || name.includes("/") || name.includes("\\")) throw new Error(t("music.fileNameInvalid"));
    const url = new URL(name, new URL(base, location.href));
    if (typeof pack.version === "string" && pack.version) url.searchParams.set("v", pack.version);
    return { url: url.href, path: `${mount}/${name}`, size: Number(sizes[index]) || 0 };
  });
}

async function selectedSharedResources(language = state.language) {
  if (activeInstalledPackageGeneration) return [];
  const shared = record(manifest.shared) ?? {};
  const vanillaFont = shared.vanillaFont;
  const unicodeFont = shared.unicodeFont;
  if (typeof vanillaFont !== "string" || !vanillaFont || typeof unicodeFont !== "string" || !unicodeFont) {
    throw new Error(t("runtime.sharedFontManifestInvalid"));
  }
  const wanted: Array<{ target: string; network: string }> = [];
  if (language === "ja") wanted.push({ target: "/msgothic.ttc", network: vanillaFont });
  if (language !== "ja" || state.options.thpracEnabled) wanted.push({ target: "/unifont.otf", network: unicodeFont });
  return wanted.map(item => ({ url: new URL(item.network, location.href).href, path: item.target }));
}

function languageCacheKey(pack: RemoteLanguagePackSource): Request {
  return new Request(`${location.origin}/__eagler-language/${state.game}/${pack.language}/${pack.sha256}`);
}

async function readLanguagePackResponse(
  response: Response,
  pack: RemoteLanguagePackSource,
  noteNetworkActivity: (() => void) | null = null,
  networkTaskId: string | null = null,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("Content-Length")) || pack.bytes || 0;
  const label = entryTitle(languageEntry());
  if (networkTaskId) networkActivity.update(networkTaskId, { phase: "receiving", total, label });
  $("#transferWarning").hidden = true;
  $("#transferRetry").hidden = true;
  const startedAt = performance.now();
  let loaded = 0;
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    noteNetworkActivity?.();
    if (networkTaskId) networkActivity.update(networkTaskId, { phase: "receiving", loaded: bytes.length, total: total || bytes.length });
    showTransfer({ kind: "language", mode: "language", label, loaded: bytes.length, total: total || bytes.length, speed: 0 });
    $("#transferTitle").textContent = t("language.downloadComplete");
    transferHideTimer = setTimeout(hideTransfer, 2200);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    noteNetworkActivity?.();
    chunks.push(value);
    loaded += value.length;
    if (networkTaskId) networkActivity.update(networkTaskId, { phase: "receiving", loaded, total });
    const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.1);
    showTransfer({ kind: "language", mode: "language", label, loaded, total, speed: loaded / elapsed });
  }
  const archive = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.length; }
  showTransfer({ kind: "language", mode: "language", label, loaded, total: total || loaded, speed: 0 });
  $("#transferTitle").textContent = t("language.downloadComplete");
  transferHideTimer = setTimeout(hideTransfer, 2200);
  return archive;
}

async function downloadLanguagePack(pack: RemoteLanguagePackSource, cacheMode: RequestCache): Promise<Uint8Array> {
  const operation = beginBlockingNetworkOperation({ label: t("package.cancelDownload") });
  const controller = operation.controller;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutMs = 15_000;
  const arm = () => {
    clearOptionalTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  arm();
  const networkTaskId = networkActivity.begin({
    title: t("language.downloading"),
    label: t("language.requesting", { language: entryTitle(languageEntry()) }),
    kind: "language",
    phase: "requesting",
  });
  try {
    const response = await fetch(pack.url, { cache: cacheMode, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(pack.url).pathname}: HTTP ${response.status}`);
    arm();
    return await readLanguagePackResponse(response, pack, arm, networkTaskId);
  } catch (error) {
    if (timedOut) {
      throw new Error(t("language.streamTimeout", { path: new URL(pack.url).pathname }));
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw error;
  } finally {
    clearOptionalTimeout(timer);
    networkActivity.finish(networkTaskId);
    finishBlockingNetworkOperation(operation);
  }
}

async function prepareLanguagePack() {
  const pack = selectedLanguagePack();
  if (!pack) return null;
  const zip = await ensureFflate();
  if (!zip?.unzipSync) throw new Error(t("file.zipComponentMissing"));
  let archive: Uint8Array | null = null;
  let cache: Cache | null = null;
  let cacheKey: Request | null = null;
  let fromCache = false;
  let durableCache = false;
  if (pack.packageLocal === true) {
    const object = await readPackageObject(pack.packageObjectId);
    if (object?.data instanceof ArrayBuffer) archive = new Uint8Array(object.data);
    else if (object?.blob) archive = new Uint8Array(await object.blob.arrayBuffer());
    else throw new Error(t("language.localMissing"));
  } else {
    try { cache = await globalThis.caches?.open(languageCacheName); } catch {}
    cacheKey = languageCacheKey(pack);
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
      archive = new Uint8Array(await cached.arrayBuffer());
      fromCache = true;
      durableCache = true;
    }
    if (!archive) {
      try {
        archive = await downloadLanguagePack(pack, "force-cache");
      } catch (error) {
        languageTransferFailure(entryTitle(languageEntry()), error);
        throw error;
      }
    }
  }
  if (!archive) throw new Error(t("language.empty"));
  let archiveHash = pack.packageLocal === true ? null : await sha256Hex(archive);
  if (pack.packageLocal !== true && (archive.length !== pack.bytes || archiveHash?.toLowerCase() !== pack.sha256.toLowerCase()) && fromCache) {
    durableCache = false;
    if (cache && cacheKey) try { await cache.delete(cacheKey); } catch {}
    try {
      archive = await downloadLanguagePack(pack, "no-store");
      archiveHash = await sha256Hex(archive);
    } catch (error) {
      languageTransferFailure(entryTitle(languageEntry()), error);
      throw error;
    }
  }
  if (pack.packageLocal !== true && archive.length !== pack.bytes) throw new Error(t("language.sizeError"));
  if (pack.packageLocal !== true && archiveHash?.toLowerCase() !== pack.sha256.toLowerCase()) throw new Error(t("language.hashError"));
  if (cache && cacheKey) {
    try {
      await cache.put(cacheKey, new Response(copyBytesToArrayBuffer(archive)));
      durableCache = true;
    } catch {}
  }
  if (pack.packageLocal !== true && durableCache) rememberOfflineLanguage(localStorage, state.game, languageEntry(), pack);
  const entries = zip.unzipSync(archive);
  const { manifest: packManifest, files } = validateStaticLanguagePackEntries(entries, {
    game: state.game,
    language: pack.language,
  });
  // The hosted shells validate runtimePack.url as a same-origin provenance
  // marker even though the already-verified file bytes are carried inline.
  // Online packs naturally have a URL; bundled offline packs intentionally do
  // not, so expose their stable local IndexedDB key as a same-origin virtual
  // URL rather than making the shell reject an otherwise valid local pack.
  const runtimePackUrl = "url" in pack && typeof pack.url === "string" && pack.url
    ? pack.url
    : pack.packageObjectId
      ? new URL(`/__eagler/package-language/${state.game}/${encodeURIComponent(pack.language)}`, location.origin).href
      : "";
  return { ...pack, runtimeVersion: packManifest.runtimeVersion, bytes: archive.length, url: runtimePackUrl, manifest: packManifest, files };
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function download(name: string, value: string | ArrayBuffer | Blob, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const replayPrefix = () => {
  const prefix = game().replay?.prefix;
  if (!prefix) throw new Error(t("replay.unsupported"));
  return prefix;
};
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

interface ReplayStorageFile { path: string; size: number }
type ImportFileKind = "save" | "replay";

const replayMutations = createReplayMutationQueue();
let replayManagerOwnsRuntime = false;

function runtimeResponseBytes(response: RuntimeResponseMessage): number[] {
  if (!Array.isArray(response.bytes) || !response.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error(t("runtime.invalidFileContent"));
  }
  return response.bytes as number[];
}

function runtimeResponseFiles(response: RuntimeResponseMessage): ReplayStorageFile[] {
  if (!Array.isArray(response.files)) throw new Error(t("runtime.invalidFileList"));
  return response.files.map(value => {
    const item = record(value);
    if (!item || typeof item.path !== "string" || !item.path) throw new Error(t("runtime.invalidFileEntry"));
    return { path: item.path, size: Math.max(0, Number(item.size) || 0) };
  });
}
async function listReplayStorageFiles() {
  await ensureRuntime(false);
  await send("sync");
  const listing = await send("list");
  return runtimeResponseFiles(listing);
}

async function exportFiles(kind: ImportFileKind) {
  const label = t(kind === "save" ? "file.kind.save" : "file.kind.replay");
  const wasReady = state.ready;
  showToast(t("file.exportPreparing", { kind: label }));
  try {
    await ensureRuntime(false); setPlayerStatus(t("file.exporting", { kind: label })); await send("sync");
    if (kind === "save") {
      const result = await send("read", { path: gameStorage().scoreFile });
      download(gameStorage().scoreFile, copyBytesToArrayBuffer(new Uint8Array(runtimeResponseBytes(result))), "application/octet-stream");
    } else {
      const zip = await ensureFflate();
      if (!zip?.zipSync) throw new Error(t("file.zipComponentMissing"));
      const storedFiles = await listReplayStorageFiles();
      const exportPaths = selectReplayExportPaths(storedFiles.map(file => file.path));
      if (!exportPaths.some(isReplayFilePath)) throw new Error(t("file.noReplayToExport"));
      const storedByPath = new Map(storedFiles.map(file => [file.path.toLowerCase(), file]));
      const entries: Record<string, Uint8Array> = {};
      for (const path of exportPaths) {
        const file = storedByPath.get(path.toLowerCase());
        if (!file) continue;
        const result = await send("read", { path: file.path });
        entries[file.path] = new Uint8Array(runtimeResponseBytes(result));
      }
      download(`${state.game}-replay-${new Date().toISOString().slice(0,10)}.zip`,
        copyBytesToArrayBuffer(zip.zipSync(entries, { level: 1 })), "application/zip");
    }
    if (!wasReady) resetRuntime();
    showToast(t("file.exportDownloadStarted", { kind: label }));
    setPlayerStatus(t("file.exported", { kind: label }));
  } catch (error) {
    if (!wasReady) resetRuntime();
    const missingSave = kind === "save" && record(error)?.errno === 44;
    const missingReplay = kind === "replay" && errorMessage(error) === t("file.noReplayToExport");
    if (missingSave || missingReplay) {
      const labelText = t(missingSave ? "file.missingSavePrompt" : "file.missingReplayPrompt");
      if (await askConfirmation({ message: labelText, confirmText: t("file.selectImport") })) {
        const file = await pickFile(missingSave ? ".dat" : replayImportAccept);
        if (file) await importFile(missingSave ? "save" : "replay", file);
      }
      return;
    }
    showToast(t("file.exportFailed", { kind: label, reason: errorMessage(error) }));
    throw error;
  }
}
async function importFileExclusive(kind: ImportFileKind, file: File) {
  if (!file.size) throw new Error(t("file.emptyImport"));
  if (file.size > maxImportBytes) throw new Error(t("file.importTooLarge"));
  if (kind === "save" && state.launched) {
    // Match the established TH06/TH07 Runtime lifecycle: never tear down a
    // running IDBFS owner while it may still have autoPersist work in flight.
    // A late write from that dead iframe can otherwise race the newly imported
    // score.dat and restore the older tree after the import already verified.
    if (state.ready) await send("sync", {}, 10000);
    resetRuntime();
  }
  await ensureRuntime(false); setPlayerStatus(t("file.importing")); let files: Array<{ path: string; bytes: Uint8Array }>;
  const lowerName = file.name.toLowerCase();
  if (kind === "save" && lowerName.endsWith(".dat")) {
    files = [{ path: gameStorage().scoreFile, bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && /\.rpyx?$/.test(lowerName)) {
    const listing = await send("list");
    const existing = runtimeResponseFiles(listing).map(item => item.path);
    const replayName = allocateReplayName(replayPrefix(), existing, file.name);
    if (!replayName) throw new Error(t("file.replaySlotsExhausted"));
    files = [{ path: `replay/${replayName}`, bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && lowerName.endsWith(".zip")) {
    const zip = await ensureFflate();
    if (!zip?.unzipSync) throw new Error(t("file.zipComponentMissing"));
    const guard = createReplayArchiveExtractionGuard({
      maxFileBytes: maxStoredFileBytes,
      maxExpandedBytes: maxReplayArchiveExpandedBytes,
    });
    let archive: Record<string, Uint8Array>;
    try {
      archive = zip.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: guard.filter });
    } catch (error) {
      if (error instanceof ReplayArchiveScanError) {
        const key = error.reason === "unsafe-path" ? "file.zipUnsafePath"
          : error.reason === "duplicate-path" ? "file.zipDuplicatePath"
            : error.reason === "file-too-large" ? "file.importStoredTooLarge"
              : "file.importArchiveExpandedTooLarge";
        throw new Error(t(key));
      }
      throw error;
    }
    const listing = await send("list");
    const existing = runtimeResponseFiles(listing).map(item => item.path);
    const plan = planReplayArchiveImport(replayPrefix(), guard.paths, existing);
    if (!plan.ok) {
      if (plan.reason === "unsafe-path") throw new Error(t("file.zipUnsafePath"));
      if (plan.reason === "duplicate-path") throw new Error(t("file.zipDuplicatePath"));
      throw new Error(t("file.replaySlotsExhausted"));
    }
    files = plan.entries.map(entry => ({ path: entry.targetPath, bytes: archive[entry.sourcePath] }));
  } else {
    throw new Error(t(kind === "save" ? "file.chooseSave" : "file.chooseReplay"));
  }
  if (!files.length) throw new Error(t("file.importNoFiles"));
  const uniquePaths = new Set(files.map(item => item.path.toLowerCase()));
  if (uniquePaths.size !== files.length) throw new Error(t("file.importDuplicatePaths"));
  if (files.some(item => item.bytes.length > maxStoredFileBytes)) throw new Error(t("file.importStoredTooLarge"));
  for (const item of files) await send("write", { path: item.path, bytes: Array.from(item.bytes) });
  if (kind === "save") {
    const expected = files[0].bytes;
    resetRuntime();
    await ensureRuntime(false);
    const persisted = new Uint8Array(runtimeResponseBytes(await send("read", { path: gameStorage().scoreFile })));
    if (persisted.length !== expected.length || persisted.some((byte, index) => byte !== expected[index])) {
      throw new Error(t("file.saveVerifyFailed"));
    }
  }
  const replayDialog = $("#replayDialog");
  const keepReplayManagerOpen = kind === "replay" && replayDialog.open;
  resetRuntime();
  if (keepReplayManagerOpen) await refreshReplayManager();
  else if (replayDialog.open) replayDialog.close();
  $("#player").classList.remove("open");
  $("#player").setAttribute("aria-hidden", "true");
  showToast(t("file.importedRestart", { count: files.length }));
  setStatus(t("file.importedRestart", { count: files.length }));
}

async function importFile(kind: ImportFileKind, file: File) {
  return kind === "replay"
    ? replayMutations.run(() => importFileExclusive(kind, file))
    : importFileExclusive(kind, file);
}

async function refreshReplayManager({ animateRows = false } = {}) {
  const storedFiles = await listReplayStorageFiles();
  const storedPaths = storedFiles.map(file => file.path);
  const files = storedFiles.filter(file => isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  const list = $("#replayList");
  list.replaceChildren();
  $("#replaySummary").textContent = t("replay.fileCount", { count: files.length });
  if (!files.length) {
    const empty = document.createElement("div"); empty.className = "replay-empty"; empty.textContent = t("status.noReplay"); list.append(empty); return;
  }
  for (const [index, file] of files.entries()) {
    const row = document.createElement("div"); row.className = "replay-row";
    if (animateRows) { row.classList.add("replay-row-enter"); row.style.setProperty("--replay-row-delay", `${Math.min(index, 8) * 16}ms`); }
    const name = file.path.split("/").pop() || file.path;
    const label = document.createElement("span"); label.className = "replay-name"; label.textContent = name; label.title = name;
    const size = document.createElement("span"); size.className = "replay-size"; size.textContent = formatBytes(file.size);
    const get = document.createElement("button"); get.type = "button"; get.textContent = t("action.download");
    get.onclick = async () => { try {
      const result = await send("read", { path: file.path });
      download(name || "replay.rpy", copyBytesToArrayBuffer(new Uint8Array(runtimeResponseBytes(result))), "application/octet-stream");
    } catch (error) { showToast(t("replay.downloadFailed", { reason: errorMessage(error) })); } };
    const actions = document.createElement("span"); actions.className = "replay-row-actions";
    const rename = document.createElement("button"); rename.type = "button"; rename.textContent = t("action.rename");
    rename.onclick = async () => { try {
      const renamed = prompt(t("replay.renamePrompt"), name);
      if (renamed === null) return;
      if (!renamed.trim()) throw new Error(t("replay.nameEmpty"));
      if (!isValidReplayName(replayPrefix(), renamed.trim())) throw new Error(t("replay.nameInvalid", { prefix: replayPrefix() }));
      const target = `replay/${renamed.trim()}`;
      if (target.toLowerCase() === file.path.toLowerCase()) return;
      await replayMutations.run(async () => {
        const currentPaths = (await listReplayStorageFiles()).map(entry => entry.path);
        if (!isReplayTargetAvailable(currentPaths, target)) throw new Error(t("replay.nameExists"));
        const result = await send("read", { path: file.path });
        await send("write", { path: target, bytes: runtimeResponseBytes(result) });
        await send("remove", { path: file.path });
      });
      await refreshReplayManager();
    } catch (error) { showToast(t("replay.operationFailed", { reason: errorMessage(error) })); } };
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "replay-delete"; remove.textContent = t("action.delete");
    remove.onclick = async () => { try {
      if (!await askConfirmation({
        message: t("replay.deleteConfirm", { name }),
        confirmText: t("action.delete"),
        tone: "danger"
      })) return;
      await replayMutations.run(() => send("remove", { path: file.path }).then(() => undefined));
      await refreshReplayManager();
    } catch (error) { showToast(t("replay.deleteFailed", { reason: errorMessage(error) })); } };
    actions.append(get, rename, remove);
    row.append(label, size, actions); list.append(row);
  }
}

async function manageReplays() {
  const dialog = $("#replayDialog");
  if (!state.ready && !currentRuntimeSession()) replayManagerOwnsRuntime = true;
  const list = $("#replayList");
  list.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "replay-loading";
  const spinner = document.createElement("i"); spinner.setAttribute("aria-hidden", "true");
  const loadingText = document.createElement("span"); loadingText.textContent = t("replay.loading");
  loading.append(spinner, loadingText);
  list.append(loading);
  $("#replaySummary").textContent = t("status.readingReplay");
  dialog.classList.remove("closing");
  if (!dialog.open) dialog.showModal();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    await refreshReplayManager({ animateRows: true });
  } catch (error) {
    list.replaceChildren();
    const failed = document.createElement("div");
    failed.className = "replay-empty replay-load-error";
    failed.textContent = t("status.replayReadFailed");
    list.append(failed);
    $("#replaySummary").textContent = t("status.replayReadFailed");
    throw error;
  }
}

const replayDialog = $("#replayDialog");
const replayWindow = requiredDescendant(replayDialog, ".replay-window", HTMLElement);
function closeReplayManager() {
  if (!replayDialog.open || replayDialog.classList.contains("closing")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { replayDialog.close("close"); return; }
  replayDialog.classList.add("closing");
  let finished = false;
  const finish = () => { if (finished) return; finished = true; replayDialog.classList.remove("closing"); if (replayDialog.open) replayDialog.close("close"); };
  replayDialog.addEventListener("animationend", event => { if (event.animationName === "replay-window-out") finish(); }, { once: true });
  setTimeout(finish, 220);
}
replayDialog.addEventListener("cancel", event => { event.preventDefault(); closeReplayManager(); });
replayDialog.addEventListener("close", () => {
  replayDialog.classList.remove("closing");
  if (replayManagerOwnsRuntime) {
    replayManagerOwnsRuntime = false;
    const ownedSession = currentRuntimeSession();
    void replayMutations.idle().then(() => {
      if (!state.launched && !replayDialog.open && currentRuntimeSession() === ownedSession) resetRuntime();
      maybeApplyDeferredAppShellUpdate();
    });
  } else {
    maybeApplyDeferredAppShellUpdate();
  }
});
document.querySelectorAll<HTMLElement>("[data-replay-close]").forEach(button => button.addEventListener("click", closeReplayManager));
let replayDragDepth = 0;
replayWindow.addEventListener("dragenter", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault(); replayDragDepth++; replayWindow.classList.add("dragging");
});
replayWindow.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault(); event.dataTransfer.dropEffect = "copy";
});
replayWindow.addEventListener("dragleave", () => {
  replayDragDepth = Math.max(0, replayDragDepth - 1);
  if (!replayDragDepth) replayWindow.classList.remove("dragging");
});
replayWindow.addEventListener("drop", async event => {
  event.preventDefault(); replayDragDepth = 0; replayWindow.classList.remove("dragging");
  try {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length !== 1) throw new Error(t("replay.dropSingle"));
    if (!isReplayImportFileName(files[0].name)) throw new Error(t("replay.dropType"));
    await importFile("replay", files[0]);
  } catch (error) {
    setStatus(t("status.errorReason", { reason: errorMessage(error) })); showToast(t("replay.importFailed", { reason: errorMessage(error) }));
  }
});
type MpFoldName = keyof MultiplayerUiState["folds"];
function isMpFoldName(value: string | undefined): value is MpFoldName {
  return value === "settings" || value === "online";
}
document.querySelectorAll<HTMLButtonElement>("[data-mp-fold]").forEach(button => button.addEventListener("click", () => {
  const name = button.dataset.mpFold;
  if (!isMpFoldName(name)) return;
  mpSetFold(name, !mpUiState.folds[name]);
}));
$("#mpSettingsRoomDrawerToggle").addEventListener("click", () => {
  setMpSettingsRoomDrawerOpen(!mpSettingsRoomDrawerOpen);
});
$("#mpSettingsRoomDrawerCloseHint").addEventListener("click", () => setMpSettingsRoomDrawerOpen(false));
$("#mpLanguageSelect").addEventListener("change", event => {
  const value = $("#mpLanguageSelect").value;
  if (!languageCatalog(state.game).some(entry => entry.id === value)) return;
  state.language = value; saveGamePreferences(); render();
});
$("#mpMusicSelect").addEventListener("change", event => {
  const value = $("#mpMusicSelect").value;
  if (!isMusicMode(value)) return;
  state.music = value; state.musicPreference = state.music; state.musicPreferenceExplicit = true; saveGamePreferences(); render();
});
$("#mpFrameLimitToggle").addEventListener("click", () => {
  state.options.frameLimit60Enabled = !state.options.frameLimit60Enabled; saveGamePreferences(); render();
});
$("#mpTh06HitboxToggle").addEventListener("click", () => setOption("th06FocusHitbox", !state.options.th06FocusHitbox));
$("#mpShareSettingsToggle").addEventListener("click", () => {
  saveGamePreferences();
  mpShareSingleplayerSettings = !mpShareSingleplayerSettings;
  multiplayerPreferences.persistShareSingleplayerSettings(state.product, mpShareSingleplayerSettings);
  restoreGamePreferences(state.game, currentPreferenceId());
  resetRuntime();
  render();
  setTranslatedStatus(mpShareSingleplayerSettings ? "status.shareSettings" : "status.separateSettings");
});
$("#mpMobileOptionsToggle").addEventListener("click", () => {
  mpUiState.mobileOpen = !mpUiState.mobileOpen;
  render();
  mpRefreshFoldHeight("settings");
  setTimeout(() => mpRefreshFoldHeight("settings"), 440);
});
$("#mpTouchToggle").addEventListener("click", () => setOption("touchEnabled", !state.options.touchEnabled));
$("#mpAlwaysHitboxToggle").addEventListener("click", () => setOption("alwaysHitbox", !state.options.alwaysHitbox));
$("#mpLocalPlayerVisibilityToggle").addEventListener("click", () => setOption("enhanceLocalPlayerVisibility", !state.options.enhanceLocalPlayerVisibility));
$("#mpMagnifierToggle").addEventListener("click", () => setOption("magnifierEnabled", !state.options.magnifierEnabled));
$("#mpTouchLayoutEdit").addEventListener("click", () => {
  void openTouchLayoutEditor().catch(error => { const reason = errorMessage(error); showToast(reason); setStatus(t("status.errorReason", { reason })); });
});
$("#mpJoinCode").addEventListener("input", () => {
  const input = $("#mpJoinCode");
  input.value = mpNormalizeRoomCode(input.value);
});
$("#mpCreateRoom").addEventListener("click", () => mpEnterRoom(mpGenerateRoomCode(), true));
$("#mpJoinRoom").addEventListener("click", () => {
  const code = mpNormalizeRoomCode($("#mpJoinCode").value);
  if (!code) { showToast(t("status.enterRoomCode")); return; }
  mpEnterRoom(code, false);
});
$("#mpReplayViewer").addEventListener("click", async () => {
  if (mpLaunchInFlight) return;
  mpLaunchInFlight = true;
  try {
    const product = multiplayerProductIdForGame(state.game);
    if (!product) throw new Error(t("multiplayer.noProduct"));
    state.product = product;
    state.runtimeVariant = "multiplayer";
    state.replayViewer = true;
    resetRuntime();
    openPlayerView();
    await launchConfiguredRuntime();
    setStatus(t("multiplayer.replayMenuOpened", { game: state.game.toUpperCase() }));
  } catch (error) {
    const message = errorMessage(error);
    if (!state.launched && isResourceLoadFailure(error)) {
      // Preserve replayViewer while importing. Closing Player here would reset
      // the Replay intent and turn the post-import resume into a normal launch.
      setPlayerStatus(t("runtime.missingResourcesPlayer"));
      beginManualGamePackageImport(message, captureGameDataContinuation("launch"));
      setStatus(t("runtime.missingResourcesLauncher"));
      showToast(message);
    } else {
      showStartupError(error, t("multiplayer.replayContext", { game: state.game.toUpperCase() }));
      showToast(message);
    }
  } finally {
    mpLaunchInFlight = false;
    maybeApplyDeferredAppShellUpdate();
  }
});
async function mpCopyRoomCode() {
  if (!mpUiState.room) return;
  try { await navigator.clipboard.writeText(mpUiState.room.code); showToast(t("status.roomCodeCopied")); }
  catch { showToast(t("status.roomCode", { code: mpUiState.room.code })); }
}
$("#mpCopyRoomCode").addEventListener("click", mpCopyRoomCode);
// Do not pass the click Event into mpLeaveRoom(fromHistory). An Event is
// truthy and would be mistaken for a popstate-driven leave, leaving ?mpRoom=
// behind in the address bar.
$("#mpLeaveRoom").addEventListener("click", () => mpLeaveRoom());
$("#mpRoomSettingsToggle").addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  mpUiState.roomSettingsOpen = !mpUiState.roomSettingsOpen;
  renderMpRoom();
});
$("#mpRoomPlayerCount").addEventListener("change", event => {
  const room = mpUiState.room;
  if (!room || !mpRoomOwnerLocal() || !mpLobby.connected) return;
  const count = Number($("#mpRoomPlayerCount").value) === 3 ? 3 : 2;
  room.playerCount = count;
  if (mpUiState.seat != null && mpUiState.seat >= count) mpUiState.seat = null;
  mpLobbySend({ type: "settings", playerCount: count, difficulty: room.difficulty });
  renderMpRoom();
});
$("#mpRoomDifficulty").addEventListener("change", event => {
  const room = mpUiState.room;
  if (!room || !mpRoomOwnerLocal() || !mpLobby.connected) return;
  room.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number($("#mpRoomDifficulty").value) || 0));
  mpLobbySend({ type: "settings", playerCount: room.playerCount, difficulty: room.difficulty });
  renderMpRoom();
});
document.querySelectorAll<HTMLElement>("[data-mp-player-count]").forEach(button => button.addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  $("#mpRoomPlayerCount").value = button.dataset.mpPlayerCount || "2";
  $("#mpRoomPlayerCount").dispatchEvent(new Event("change", { bubbles: true }));
}));
document.querySelectorAll<HTMLElement>("[data-mp-difficulty]").forEach(button => button.addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  $("#mpRoomDifficulty").value = button.dataset.mpDifficulty || "0";
  $("#mpRoomDifficulty").dispatchEvent(new Event("change", { bubbles: true }));
}));
document.querySelectorAll<HTMLElement>("[data-mp-seat-drop] button").forEach(button => button.addEventListener("click", () => {
  const drop = button.closest<HTMLElement>("[data-mp-seat-drop]");
  if (drop) mpTakeSeat(Number(drop.dataset.mpSeatDrop));
}));
$("#mpStandUp").addEventListener("click", mpStandUp);
$("#mpSpectatorJoin").addEventListener("click", () => {
  if (mpUiState.spectatorRequested) mpLeaveSpectatorSeat();
  else mpTakeSpectatorSeat();
});

function mpSetupSpectatorRailDrag() {
  const rail = $("#mpSpectatorRail");
  const handle = rail?.querySelector<HTMLElement>(".mp-spectator-rail-head");
  if (!rail || !handle) return;
  const mobile = window.matchMedia("(max-width:780px)");
  let drag: { pointerId: number; dx: number; dy: number } | null = null;

  const clearInlinePosition = () => {
    for (const prop of ["left", "top", "right", "bottom"]) rail.style.removeProperty(prop);
  };
  const mobileViewportSize = () => {
    const viewport = window.visualViewport;
    return {
      width: Math.max(1, viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1),
    };
  };
  const setMobilePosition = (left: number, top: number, save = false) => {
    const margin = 6;
    const rect = rail.getBoundingClientRect();
    const viewport = mobileViewportSize();
    const maxLeft = Math.max(margin, viewport.width - rect.width - margin);
    const maxTop = Math.max(margin, viewport.height - rect.height - margin);
    const x = Math.max(margin, Math.min(maxLeft, left));
    const y = Math.max(margin, Math.min(maxTop, top));
    rail.style.setProperty("left", `${Math.round(x)}px`, "important");
    rail.style.setProperty("top", `${Math.round(y)}px`, "important");
    rail.style.setProperty("right", "auto", "important");
    rail.style.setProperty("bottom", "auto", "important");
    if (save) multiplayerSpectatorRailPositions.save({ x, y });
  };
  const restore = () => {
    if (!mobile.matches) {
      clearInlinePosition();
      return;
    }
    const saved = multiplayerSpectatorRailPositions.load();
    if (saved) setMobilePosition(saved.x, saved.y, false);
  };

  handle.addEventListener("pointerdown", event => {
    if (!mobile.matches || event.button !== 0) return;
    const rect = rail.getBoundingClientRect();
    drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    handle.setPointerCapture?.(event.pointerId);
    rail.classList.add("dragging");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId || !mobile.matches) return;
    setMobilePosition(event.clientX - drag.dx, event.clientY - drag.dy, false);
    event.preventDefault();
  });
  const finish = (event: PointerEvent) => {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    const rect = rail.getBoundingClientRect();
    setMobilePosition(rect.left, rect.top, true);
    rail.classList.remove("dragging");
    drag = null;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  const clampToVisibleViewport = () => {
    if (!mobile.matches) { clearInlinePosition(); return; }
    if (!rail.style.left) return;
    const rect = rail.getBoundingClientRect();
    setMobilePosition(rect.left, rect.top, false);
  };
  window.addEventListener("resize", clampToVisibleViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", clampToVisibleViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", clampToVisibleViewport, { passive: true });
  mobile.addEventListener?.("change", restore);
  restore();
}
mpSetupSpectatorRailDrag();
$("#mpDisplayName").addEventListener("change", () => mpSetDisplayName($("#mpDisplayName").value));
$("#mpDisplayName").addEventListener("blur", () => mpSetDisplayName($("#mpDisplayName").value));
$("#mpLoadoutPrev").addEventListener("click", () => mpSetLoadout(-1));
$("#mpLoadoutNext").addEventListener("click", () => mpSetLoadout(1));
$("#mpLoadoutPrevSeat").addEventListener("click", () => mpSetLoadout(-1));
$("#mpLoadoutNextSeat").addEventListener("click", () => mpSetLoadout(1));
$("#mpReady").addEventListener("click", () => {
  if (mpUiState.seat == null || !mpLobby.connected) return;
  const ready = !mpUiState.ready;
  if (!mpLobbySend({ type: "set-ready", ready })) return;
  mpUiState.ready = ready;
  renderMpRoom();
});
$("#mpCheckGame").addEventListener("click", () => { void mpCheckGame(); });
$("#mpStartGame").addEventListener("click", async () => {
  if (!mpRoomOwnerLocal() || !mpUiState.ready || !mpLobby.connected) return;
  mpLobbySend({ type: "start" });
});

function pickFile(accept: string): Promise<File | null> {
  const input = $("#fileInput"); input.accept = accept; input.multiple = false; input.value = "";
  return new Promise<File | null>(resolve => {
    let settled = false;
    const finish = (file: File | null = null) => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.oncancel = null;
      resolve(file);
    };
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.oncancel = () => finish();
    input.click();
  });
}

async function runAction(action: string) {
  await withLauncherActivity(async () => {
    try {
      if (action === "manage-replay") await manageReplays();
      else if (action === "export-save" || action === "export-replay") await exportFiles(action === "export-save" ? "save" : "replay");
      else {
        const kind = action.slice(7);
        if (kind === "save" && !await askConfirmation({
          message: t("file.importSaveOverwrite"),
          confirmText: t("file.continueImport"),
          tone: "danger"
        })) return;
        const file = await pickFile(kind === "replay" ? replayImportAccept : ".dat");
        if (file && (kind === "save" || kind === "replay")) await importFile(kind, file);
      }
    } catch (error) {
      const message = errorMessage(error);
      setPlayerStatus(message); setStatus(t("status.errorReason", { reason: message })); showToast(t("status.errorReason", { reason: message }));
    }
  });
}

function touchLayoutControlIsVisible(name: TouchLayoutControlName) {
  const element = touchLayoutElement(name);
  return !!element && !element.hidden && getComputedStyle(element).display !== "none";
}

function visibleTouchLayoutControlNames() {
  return touchLayoutControlNames.filter(touchLayoutControlIsVisible);
}

function ensureVisibleTouchLayoutSelection() {
  if (!touchLayoutEditing || touchLayoutControlIsVisible(touchLayoutSelected)) return;
  const next = visibleTouchLayoutControlNames().find(name => name !== "escape") || visibleTouchLayoutControlNames()[0];
  if (next) touchLayoutSelected = next;
}

function updateTouchLayoutEditorUi() {
  ensureVisibleTouchLayoutSelection();
  if (touchLayoutEditing) ensureTouchLayoutDraftProfile();
  for (const name of touchLayoutControlNames) {
    touchLayoutElement(name).classList.toggle("touch-layout-selected", name === touchLayoutSelected);
  }
  const orientation = touchLayoutOrientation();
  const item = touchLayoutDraft?.profiles?.[orientation]?.controls?.[touchLayoutSelected];
  const scale = Math.round((item?.scale ?? 1) * 100);
  $("#touchLayoutScale").value = String(scale);
  $("#touchLayoutScaleValue").value = `${scale}%`;
  $("#touchLayoutOrientation").textContent = t(orientation === "landscape" ? "touch.landscape" : "touch.portrait");
  $("#touchLayoutSelection").textContent = t("touch.selected", { control: touchLayoutControlTitle(touchLayoutSelected) });
  updateTouchLayoutOrientationActionUi();
  updateTouchLayoutWarnings();
}

function selectTouchLayoutControl(name: TouchLayoutControlName) {
  if (!touchLayoutControlIsVisible(name)) return;
  touchLayoutSelected = name;
  const profile = ensureTouchLayoutDraftProfile();
  const item = requiredTouchLayoutPlacement(profile, name);
  if (item) {
    item.priority = Math.max(-1, ...Object.values(profile.controls).map(control => Number.isFinite(control.priority) ? control.priority : -1)) + 1;
    normalizeTouchLayoutPriorityOrder(profile.controls);
    applyTouchLayout(touchLayoutDraft);
  }
  updateTouchLayoutEditorUi();
}

function touchLayoutSettingsElement() {
  return $("#touchLayoutSettingsDragHandle").closest<HTMLElement>(".touch-layout-settings");
}

const touchLayoutWindowMargin = 16;
const touchLayoutWindowPositions = createTouchLayoutWindowPositionStore({ storage: localStorage });
let touchLayoutWindowOrientation: TouchLayoutOrientation | null = null;

function rememberTouchLayoutWindowsNow() {
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
  rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
}

function rememberTouchLayoutWindowPosition(kind: TouchLayoutWindowKind, element: HTMLElement | null) {
  if (!element || element.hidden) return;
  const host = player.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const rangeX = Math.max(0, host.width - rect.width - touchLayoutWindowMargin * 2);
  const rangeY = Math.max(0, host.height - rect.height - touchLayoutWindowMargin * 2);
  const left = Math.max(touchLayoutWindowMargin, Math.min(host.width - rect.width - touchLayoutWindowMargin, rect.left - host.left));
  const top = Math.max(touchLayoutWindowMargin, Math.min(host.height - rect.height - touchLayoutWindowMargin, rect.top - host.top));
  touchLayoutWindowPositions.set(touchLayoutOrientation(), kind, {
    x: rangeX > 0 ? (left - touchLayoutWindowMargin) / rangeX : .5,
    y: rangeY > 0 ? (top - touchLayoutWindowMargin) / rangeY : .5
  });
}

function restoreTouchLayoutWindowPosition(kind: TouchLayoutWindowKind, element: HTMLElement | null) {
  const saved = touchLayoutWindowPositions.get(touchLayoutOrientation(), kind);
  if (!saved || !element || element.hidden) return false;
  const host = player.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const rangeX = Math.max(0, host.width - rect.width - touchLayoutWindowMargin * 2);
  const rangeY = Math.max(0, host.height - rect.height - touchLayoutWindowMargin * 2);
  element.style.left = `${touchLayoutWindowMargin + saved.x * rangeX}px`;
  element.style.top = `${touchLayoutWindowMargin + saved.y * rangeY}px`;
  if (kind === "editor") element.style.transform = "none";
  if (kind === "settings") element.style.right = "auto";
  return true;
}

function resetTouchLayoutEditorPosition() {
  const panel = $("#touchLayoutEditor");
  const settings = touchLayoutSettingsElement();
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("transform");
  settings?.style.removeProperty("left");
  settings?.style.removeProperty("right");
  settings?.style.removeProperty("top");
  settings?.style.removeProperty("height");
}

function positionTouchLayoutWindowsInitial() {
  const panel = $("#touchLayoutEditor");
  const settings = touchLayoutSettingsElement();
  if (!settings || settings.hidden) return;
  const host = player.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const settingsRect = settings.getBoundingClientRect();
  const inset = touchLayoutWindowMargin;
  const gap = window.matchMedia("(max-width:760px)").matches ? 6 : 14;
  const sideBySideWidth = panelRect.width + gap + settingsRect.width;
  // The two editors always start as a left/right pair.  On narrow portrait
  // screens their mobile widths are intentionally small enough to preserve
  // this arrangement rather than switching to a vertical stack.
  const groupLeft = (host.width - sideBySideWidth) / 2;
  const panelLeft = groupLeft;
  const settingsLeft = groupLeft + panelRect.width + gap;
  const panelTop = (host.height - panelRect.height) / 2;
  const settingsTop = (host.height - settingsRect.height) / 2;
  panel.style.left = `${Math.max(inset, Math.min(host.width - panelRect.width - inset, panelLeft))}px`;
  panel.style.top = `${Math.max(inset, Math.min(host.height - panelRect.height - inset, panelTop))}px`;
  panel.style.transform = "none";
  settings.style.right = "auto";
  settings.style.left = `${Math.max(inset, Math.min(host.width - settingsRect.width - inset, settingsLeft))}px`;
  settings.style.top = `${Math.max(inset, Math.min(host.height - settingsRect.height - inset, settingsTop))}px`;
}

function positionTouchLayoutWindows() {
  touchLayoutWindowPositions.reload();
  positionTouchLayoutWindowsInitial();
  restoreTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
  restoreTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
  clampTouchLayoutEditorPosition();
  touchLayoutWindowOrientation = touchLayoutOrientation();
}

function clampTouchLayoutEditorPosition() {
  if (!touchLayoutEditing) return;
  const host = player.getBoundingClientRect();
  const clampPanel = (element: HTMLElement | null) => {
    if (!element || element.hidden) return;
    const rect = element.getBoundingClientRect();
    const left = Math.max(touchLayoutWindowMargin, Math.min(Math.max(touchLayoutWindowMargin, host.width - rect.width - touchLayoutWindowMargin), rect.left - host.left));
    const top = Math.max(touchLayoutWindowMargin, Math.min(Math.max(touchLayoutWindowMargin, host.height - rect.height - touchLayoutWindowMargin), rect.top - host.top));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  };
  const panel = $("#touchLayoutEditor");
  clampPanel(panel);
  panel.style.transform = "none";
  const settings = touchLayoutSettingsElement();
  if (settings) settings.style.right = "auto";
  clampPanel(settings);
}

function beginTouchLayoutEditorDrag(event: PointerEvent) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const panel = $("#touchLayoutEditor");
  const host = player.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${rect.left - host.left}px`;
  panel.style.top = `${rect.top - host.top}px`;
  panel.style.transform = "none";
  touchLayoutEditorDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function moveTouchLayoutEditorDrag(event: PointerEvent) {
  if (!touchLayoutEditorDrag || event.pointerId !== touchLayoutEditorDrag.pointerId) return;
  event.preventDefault();
  const panel = $("#touchLayoutEditor");
  const host = player.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const dx = event.clientX - touchLayoutEditorDrag.x;
  const dy = event.clientY - touchLayoutEditorDrag.y;
  touchLayoutEditorDrag.x = event.clientX;
  touchLayoutEditorDrag.y = event.clientY;
  const safeDx = Math.max(host.left + touchLayoutWindowMargin - panelRect.left, Math.min(host.right - touchLayoutWindowMargin - panelRect.right, dx));
  const safeDy = Math.max(host.top + touchLayoutWindowMargin - panelRect.top, Math.min(host.bottom - touchLayoutWindowMargin - panelRect.bottom, dy));
  panel.style.left = `${panelRect.left - host.left + safeDx}px`;
  panel.style.top = `${panelRect.top - host.top + safeDy}px`;
}

function endTouchLayoutEditorDrag(event?: PointerEvent) {
  if (!touchLayoutEditorDrag || (event && event.pointerId !== touchLayoutEditorDrag.pointerId)) return;
  touchLayoutEditorDrag = null;
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
}

function beginTouchLayoutSettingsDrag(event: PointerEvent) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const settings = touchLayoutSettingsElement();
  if (!settings) return;
  const host = player.getBoundingClientRect();
  const rect = settings.getBoundingClientRect();
  settings.style.right = "auto";
  settings.style.left = `${rect.left - host.left}px`;
  settings.style.top = `${rect.top - host.top}px`;
  touchLayoutSettingsDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function moveTouchLayoutSettingsDrag(event: PointerEvent) {
  if (!touchLayoutSettingsDrag || event.pointerId !== touchLayoutSettingsDrag.pointerId) return;
  event.preventDefault();
  const settings = touchLayoutSettingsElement();
  if (!settings) return;
  const host = player.getBoundingClientRect();
  const rect = settings.getBoundingClientRect();
  const dx = event.clientX - touchLayoutSettingsDrag.x;
  const dy = event.clientY - touchLayoutSettingsDrag.y;
  touchLayoutSettingsDrag.x = event.clientX;
  touchLayoutSettingsDrag.y = event.clientY;
  const maxLeft = Math.max(touchLayoutWindowMargin, host.width - rect.width - touchLayoutWindowMargin);
  const maxTop = Math.max(touchLayoutWindowMargin, host.height - rect.height - touchLayoutWindowMargin);
  settings.style.left = `${Math.max(touchLayoutWindowMargin, Math.min(maxLeft, rect.left - host.left + dx))}px`;
  settings.style.top = `${Math.max(touchLayoutWindowMargin, Math.min(maxTop, rect.top - host.top + dy))}px`;
}

function endTouchLayoutSettingsDrag(event?: PointerEvent) {
  if (!touchLayoutSettingsDrag || (event && event.pointerId !== touchLayoutSettingsDrag.pointerId)) return;
  touchLayoutSettingsDrag = null;
  rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
}

function updateTouchLayoutOrientationActionUi() {
  const switchButton = $("#touchLayoutOrientationHelpOpen");
  if (!switchButton) return;
  switchButton.textContent = t(touchLayoutOrientation() === "landscape" ? "player.switchPortrait" : "player.switchLandscape");
}

async function switchTouchLayoutOrientation() {
  const target = touchLayoutOrientation() === "landscape" ? "portrait" : "landscape";
  const targetTitle = t(target === "landscape" ? "touch.landscape" : "touch.portrait");
  try {
    rememberTouchLayoutWindowsNow();
    if (typeof screen.orientation?.lock !== "function") throw new Error(t("touch.orientationUnsupported"));
    if (!isPlayerFullscreen()) await enterPlayerFullscreen({ focusGame: false });
    await screen.orientation.lock(target);
    showToast(t("touch.orientationRequested", { orientation: targetTitle }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    applyTouchLayout();
    if (touchLayoutEditing) {
      updateTouchLayoutEditorUi();
      applyTouchViewportDraftPosition();
      positionTouchLayoutWindows();
    }
    updatePlayerOrientationUi();
  } catch (error) {
    showToast(t("touch.orientationFailed"));
  }
}

function touchSensitivityPreviewBackgroundTarget(target: EventTarget | null) {
  if (!(target instanceof Element) || !player.contains(target)) return false;
  return !target.closest(".touch-layout-editor,.touch-layout-settings,[data-touch-layout-control],.touch-layout-orientation-help,.touch-help,.game-data-import-window,.game-data-link-window");
}

function resetTouchSensitivityPreviewPosition() {
  touchSensitivityPreview.style.left = "50%";
  touchSensitivityPreview.style.top = "50%";
}

function setTouchSensitivityPreviewOffset(dx: number, dy: number) {
  const rect = player.getBoundingClientRect();
  const clampedX = Math.max(0, Math.min(rect.width, rect.width / 2 + dx));
  const clampedY = Math.max(0, Math.min(rect.height, rect.height / 2 + dy));
  touchSensitivityPreview.style.left = `${clampedX}px`;
  touchSensitivityPreview.style.top = `${clampedY}px`;
}

function beginTouchSensitivityPreview(event: PointerEvent) {
  if (!touchLayoutEditing || touchViewportEditing || touchSensitivityPreviewGesture || touchMovementUsesJoystick(state.options.touchMovementMode) ||
      !touchSensitivityPreviewBackgroundTarget(event.target) || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  touchSensitivityPreviewGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  resetTouchSensitivityPreviewPosition();
  touchSensitivityPreview.classList.add("active");
  try { player.setPointerCapture(event.pointerId); } catch {}
}

function moveTouchSensitivityPreview(event: PointerEvent) {
  const gesture = touchSensitivityPreviewGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  event.preventDefault();
  const gain = Math.min(300, Math.max(50, state.options.touchSensitivity)) / 100;
  setTouchSensitivityPreviewOffset((event.clientX - gesture.startX) * gain, (event.clientY - gesture.startY) * gain);
}

function endTouchSensitivityPreview(event?: PointerEvent) {
  if (!touchSensitivityPreviewGesture || (event && event.pointerId !== touchSensitivityPreviewGesture.pointerId)) return;
  const pointerId = touchSensitivityPreviewGesture.pointerId;
  touchSensitivityPreviewGesture = null;
  touchSensitivityPreview.classList.remove("active");
  resetTouchSensitivityPreviewPosition();
  try { if (player.hasPointerCapture(pointerId)) player.releasePointerCapture(pointerId); } catch {}
}

function cancelTouchSensitivityPreview() {
  if (!touchSensitivityPreviewGesture) {
    touchSensitivityPreview.classList.remove("active");
    resetTouchSensitivityPreviewPosition();
    return;
  }
  endTouchSensitivityPreview();
}

async function openTouchLayoutEditor() {
  if (state.launched) throw new Error(t("touch.editWhileRunning"));
  touchLayoutEditing = true;
  touchViewportEditing = false;
  touchViewportDrag = null;
  touchLayoutDraft = cloneTouchLayout(touchLayout) || emptyTouchLayout();
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchLayoutSettingsDrag = null;
  touchSensitivityCustomOpen = false;
  cancelTouchSensitivityPreview();
  touchLayoutSelected = "bomb";
  touchLayoutEditorEnteredFullscreen = false;
  touchLayoutWindowOrientation = null;
  resetTouchLayoutEditorPosition();
  player.style.setProperty("--touch-preview-image", `url("assets/${state.game}-card.webp")`);
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview", "touch-layout-edit");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = true;
  $("#touchLayoutEditor").hidden = false;
  const settings = touchLayoutSettingsElement();
  if (!settings) throw new Error(t("touch.settingsMissing"));
  settings.hidden = false;
  render();
  const wasFullscreen = isPlayerFullscreen();
  try {
    await enterPlayerFullscreen({ focusGame: false });
    touchLayoutEditorEnteredFullscreen = !wasFullscreen && isPlayerFullscreen();
  } catch (error) {
    touchLayoutEditorEnteredFullscreen = false;
    showToast(t("fullscreen.autoBlocked", { reason: errorMessage(error) }));
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const profile = ensureTouchLayoutDraftProfile();
  const visibleControls = visibleTouchLayoutControlNames();
  if (visibleControls.length) {
    touchLayoutSelected = visibleControls.reduce((best, name) => {
      const bestPriority = profile.controls[best]?.priority ?? touchLayoutControlMeta[best].priority;
      const priority = profile.controls[name]?.priority ?? touchLayoutControlMeta[name].priority;
      return priority > bestPriority ? name : best;
    }, visibleControls[0]);
  }
  applyTouchLayout();
  updateTouchLayoutEditorUi();
  applyTouchViewportDraftPosition();
  positionTouchLayoutWindows();
  setStatus(t("touch.editorStatus"));
}

function saveTouchLayoutEditor() {
  if (!touchLayoutEditing) return;
  rememberTouchLayoutWindowsNow();
  if (!touchLayoutDraft) throw new Error(t("touch.draftUnavailable"));
  const persisted = commitTouchLayout(touchLayoutDraft);
  touchLayoutDraft = cloneTouchLayout(touchLayout) || emptyTouchLayout();
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  applyTouchViewportDraftPosition();
  if (persisted.persisted) {
    setStatus(t(touchLayout ? "touch.layoutSavedStatus" : "touch.layoutDefaultSavedStatus"));
    showToast(t("touch.layoutSaved"));
  } else {
    setStatus(t("touch.layoutSessionOnlyStatus"));
    showToast(t("touch.layoutSessionOnly"));
  }
}

async function closeTouchLayoutEditor() {
  if (touchViewportEditing) finishTouchViewportEditing();
  if (touchLayoutHasUnsavedChanges() && !await askConfirmation({
    message: t("touch.layoutDiscardConfirm"),
    confirmText: t("touch.discardChanges"),
    tone: "danger"
  })) return;
  rememberTouchLayoutWindowsNow();
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchLayoutSettingsDrag = null;
  touchViewportDrag = null;
  touchViewportEditing = false;
  touchLayoutEditing = false;
  touchSensitivityCustomOpen = false;
  touchLayoutDraft = null;
  $("#touchLayoutEditor").hidden = true;
  const settings = touchLayoutSettingsElement();
  if (settings) settings.hidden = true;
  player.classList.remove("touch-layout-edit", "touch-preview", "open");
  for (const name of touchLayoutControlNames) touchLayoutElement(name).classList.remove("touch-layout-selected");
  player.style.removeProperty("--touch-preview-image");
  player.setAttribute("aria-hidden", "true");
  document.body.classList.remove("player-active");
  resetTouchLayoutEditorPosition();
  if (touchLayoutEditorEnteredFullscreen && isPlayerFullscreen()) await exitPlayerFullscreen().catch(() => {});
  touchLayoutEditorEnteredFullscreen = false;
  touchLayoutWindowOrientation = null;
  render();
  setStatus(t("touch.layoutEditorClosed"));
  maybeApplyDeferredAppShellUpdate();
}

function rectOverlapRatio(a: DOMRect, b: DOMRect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (!width || !height) return 0;
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function updateTouchLayoutWarnings() {
  if (!touchLayoutEditing) return;
  const warning = $("#touchLayoutWarning");
  const names = visibleTouchLayoutControlNames();
  const issues: string[] = [];
  for (const name of touchLayoutControlNames) touchLayoutElement(name).classList.remove("touch-layout-collision");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = touchLayoutElement(names[i]);
      const b = touchLayoutElement(names[j]);
      if (rectOverlapRatio(a.getBoundingClientRect(), b.getBoundingClientRect()) >= .28) {
        a.classList.add("touch-layout-collision");
        b.classList.add("touch-layout-collision");
        issues.push(t("touch.controlOverlap", { first: touchLayoutControlTitle(names[i]), second: touchLayoutControlTitle(names[j]) }));
      }
    }
  }
  const reserved = $("#touchLayoutReservedZone").getBoundingClientRect();
  for (const name of names) {
    const element = touchLayoutElement(name);
    if (rectOverlapRatio(element.getBoundingClientRect(), reserved) >= .18) {
      element.classList.add("touch-layout-collision");
      issues.push(t("touch.controlReserved", { control: touchLayoutControlTitle(name) }));
    }
  }
  const unique = [...new Set(issues)];
  warning.hidden = unique.length === 0;
  warning.textContent = unique.length ? t("touch.warningSummary", { issues: unique.join(t("touch.warningSeparator")) }) : "";
}

function moveTouchLayoutItem(name: TouchLayoutControlName, dx: number, dy: number) {
  const profile = ensureTouchLayoutDraftProfile();
  const safe = touchLayoutSafeZone.getBoundingClientRect();
  if (!safe.width || !safe.height) return;
  const item = requiredTouchLayoutPlacement(profile, name);
  item.x += dx / safe.width;
  item.y += dy / safe.height;
  const position = effectiveTouchLayoutPosition(touchLayoutElement(name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutWarnings();
}

function scaleTouchLayoutItem(name: TouchLayoutControlName, scale: number) {
  const profile = ensureTouchLayoutDraftProfile();
  const item = requiredTouchLayoutPlacement(profile, name);
  item.scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, scale));
  const position = effectiveTouchLayoutPosition(touchLayoutElement(name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
}

function beginTouchLayoutDrag(name: TouchLayoutControlName, event: PointerEvent) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const profile = ensureTouchLayoutDraftProfile();
  applyTouchLayout(touchLayoutDraft);
  selectTouchLayoutControl(name);
  const element = touchLayoutElement(name);
  const rect = element.getBoundingClientRect();
  touchLayoutDrag = event.target instanceof Element && event.target.closest(".touch-layout-resize-handle") ? {
    kind: "resize", name, pointerId: event.pointerId,
    anchorX: rect.left, anchorY: rect.top,
    baseWidth: Math.max(1, rect.width), baseHeight: Math.max(1, rect.height),
    startScale: requiredTouchLayoutPlacement(profile, name).scale
  } : { kind: "move", name, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function resizeTouchLayoutItem(drag: Extract<TouchLayoutDrag, { kind: "resize" }>, event: PointerEvent) {
  const profile = ensureTouchLayoutDraftProfile();
  const safe = touchLayoutSafeZone.getBoundingClientRect();
  if (!safe.width || !safe.height) return;
  const vx = event.clientX - drag.anchorX;
  const vy = event.clientY - drag.anchorY;
  const projection = (vx * drag.baseWidth + vy * drag.baseHeight) /
    (drag.baseWidth * drag.baseWidth + drag.baseHeight * drag.baseHeight);
  const scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, drag.startScale * Math.max(.05, projection)));
  const factor = scale / drag.startScale;
  const item = requiredTouchLayoutPlacement(profile, drag.name);
  item.scale = scale;
  item.x = (drag.anchorX + drag.baseWidth * factor / 2 - safe.left) / safe.width;
  item.y = (drag.anchorY + drag.baseHeight * factor / 2 - safe.top) / safe.height;
  const position = effectiveTouchLayoutPosition(touchLayoutElement(drag.name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
}

function moveTouchLayoutDrag(event: PointerEvent) {
  if (!touchLayoutEditing || !touchLayoutDrag || event.pointerId !== touchLayoutDrag.pointerId) return;
  event.preventDefault();
  if (touchLayoutDrag.kind === "resize") {
    resizeTouchLayoutItem(touchLayoutDrag, event);
    return;
  }
  const dx = event.clientX - touchLayoutDrag.x;
  const dy = event.clientY - touchLayoutDrag.y;
  touchLayoutDrag.x = event.clientX;
  touchLayoutDrag.y = event.clientY;
  moveTouchLayoutItem(touchLayoutDrag.name, dx, dy);
}

function endTouchLayoutDrag(event?: PointerEvent) {
  if (!touchLayoutDrag || (event && event.pointerId !== touchLayoutDrag.pointerId)) return;
  touchLayoutDrag = null;
}

function applyTouchViewportDraftPosition() {
  gameZoom.reset();
}

function startTouchViewportEditing() {
  if (!touchLayoutEditing || touchViewportEditing) return;
  rememberTouchLayoutWindowsNow();
  ensureTouchLayoutDraftProfile();
  cancelTouchLayoutGestures();
  touchViewportEditing = true;
  touchViewportDrag = null;
  player.classList.add("touch-viewport-edit");
  $("#touchLayoutEditor").hidden = true;
  const settings = touchLayoutSettingsElement();
  if (settings) settings.hidden = true;
  $("#touchViewportDragSurface").hidden = false;
  $("#touchViewportDone").hidden = false;
  touchSensitivityPreview.hidden = true;
  applyTouchViewportDraftPosition();
  setStatus(t("touch.viewportEditStatus"));
}

function finishTouchViewportEditing() {
  if (!touchViewportEditing) return;
  touchViewportEditing = false;
  touchViewportDrag = null;
  player.classList.remove("touch-viewport-edit");
  $("#touchViewportDragSurface").hidden = true;
  $("#touchViewportDone").hidden = true;
  $("#touchLayoutEditor").hidden = false;
  const settings = touchLayoutSettingsElement();
  if (settings) settings.hidden = false;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  applyTouchViewportDraftPosition();
  positionTouchLayoutWindows();
  setStatus(t("touch.editorStatus"));
}

function resetTouchViewportPosition() {
  if (!touchLayoutEditing) return;
  const profile = ensureTouchLayoutDraftProfile();
  profile.viewport = { x: 0 };
  applyTouchViewportDraftPosition();
  const orientationTitle = t(touchLayoutOrientation() === "landscape" ? "touch.landscape" : "touch.portrait");
  showToast(t("touch.restoreViewport", { orientation: orientationTitle }));
}

function beginTouchViewportDrag(event: PointerEvent) {
  if (!touchViewportEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  touchViewportDrag = { pointerId: event.pointerId, x: event.clientX };
  try { $("#touchViewportDragSurface").setPointerCapture(event.pointerId); } catch {}
}

function moveTouchViewportDrag(event: PointerEvent) {
  if (!touchViewportEditing || !touchViewportDrag || event.pointerId !== touchViewportDrag.pointerId) return;
  event.preventDefault();
  const width = Math.max(1, player.clientWidth);
  const profile = ensureTouchLayoutDraftProfile();
  const dx = event.clientX - touchViewportDrag.x;
  touchViewportDrag.x = event.clientX;
  profile.viewport.x = Math.max(-.5, Math.min(.5, profile.viewport.x + dx / width));
  applyTouchViewportDraftPosition();
}

function endTouchViewportDrag(event?: PointerEvent) {
  if (!touchViewportDrag || (event && event.pointerId !== touchViewportDrag.pointerId)) return;
  const pointerId = touchViewportDrag.pointerId;
  touchViewportDrag = null;
  try {
    const surface = $("#touchViewportDragSurface");
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
  } catch {}
}

function cancelTouchLayoutGestures() {
  if (touchLayoutEditorDrag) rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
  if (touchLayoutSettingsDrag) rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchLayoutSettingsDrag = null;
  touchViewportDrag = null;
  cancelTouchSensitivityPreview();
}

const mpLoadouts = Object.freeze([
  { labelKey: "multiplayer.loadout.reimuA" as const, glyph: "霊", character: 0, shot: 0 }, { labelKey: "multiplayer.loadout.reimuB" as const, glyph: "霊", character: 0, shot: 1 },
  { labelKey: "multiplayer.loadout.marisaA" as const, glyph: "魔", character: 1, shot: 0 }, { labelKey: "multiplayer.loadout.marisaB" as const, glyph: "魔", character: 1, shot: 1 },
  { labelKey: "multiplayer.loadout.sakuyaA" as const, glyph: "咲", character: 2, shot: 0 }, { labelKey: "multiplayer.loadout.sakuyaB" as const, glyph: "咲", character: 2, shot: 1 },
]);
const mpLoadoutLabel = (loadout: (typeof mpLoadouts)[number]) => t(loadout.labelKey);
const mpBootstrapLoadoutIndexes = Object.freeze([0, 2, 4]);
const mpLoadoutCount = () => game().multiplayer?.loadoutCount || 0;
const mpNormalizeLoadoutIndex = (index: unknown) => {
  const count = mpLoadoutCount();
  const numeric = Number.isInteger(Number(index)) ? Number(index) : 0;
  return (numeric % count + count) % count;
};

function mpRoomOwnerLocal() { return mpUiState.room?.synced === true && mpUiState.seat === 0; }

function mpSetFold(name: MpFoldName, open: boolean) {
  mpUiState.folds[name] = !!open;
  const head = document.querySelector<HTMLElement>(`[data-mp-fold="${name}"]`);
  const body = document.querySelector<HTMLElement>(`[data-mp-fold-body="${name}"]`);
  head?.setAttribute("aria-expanded", String(!!open));
  if (body) {
    body.hidden = false;
    body.setAttribute("aria-hidden", String(!open));
    body.inert = !open;
    if (open) {
      mpRefreshFoldHeight(name);
    } else {
      body.style.removeProperty("--mp-fold-height");
    }
  }
  head?.closest(".mp-fold")?.classList.toggle("open", !!open);
}

function mpRefreshFoldHeight(name: MpFoldName) {
  if (!mpUiState.folds[name]) return;
  const body = document.querySelector<HTMLElement>(`[data-mp-fold-body="${name}"]`);
  if (!body) return;
  requestAnimationFrame(() => {
    let height = body.scrollHeight;
    const nested = body.querySelector<HTMLElement>(".mobile-options.open .mobile-options-body");
    if (nested) height += Math.max(0, nested.scrollHeight - nested.clientHeight);
    body.style.setProperty("--mp-fold-height", `${height + 12}px`);
  });
}

function mpGenerateRoomCode() {
  const value = new Uint32Array(1); crypto.getRandomValues(value);
  return String(1000 + (value[0] ?? 0) % 9000);
}

function mpSyncRoomUrl(code: string, push = false) {
  applyHistoryOperations(history, [roomRouteHistoryOperation({
    currentUrl: location.href,
    currentState: history.state,
    product: state.product,
    roomCode: code,
    push,
  })]);
}

function mpPersistRoomState() {
  if (!mpUiState.room) return;
  multiplayerRoomSessions.save(state.product, {
    room: {
      code: mpUiState.room.code,
      playerCount: mpUiState.room.playerCount,
      difficulty: mpUiState.room.difficulty,
      created: !!mpUiState.room.created,
    },
    seat: mpUiState.seat,
    ready: !!mpUiState.ready,
    spectatorRequested: !!mpUiState.spectatorRequested,
    roomSettingsOpen: !!mpUiState.roomSettingsOpen,
  });
}

function mpClearPersistedRoom() {
  multiplayerRoomSessions.clear(state.product);
  mpSyncRoomUrl("");
}

function mpRestoreRoomFromLocation() {
  const code = mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
  if (!code) return false;
  const routedProduct = isMultiplayerProduct(state.product) ? state.product : "th07mp";
  // A room URL opened directly has no guaranteed same-document home entry.
  // Seed one once, then push the room route so the browser Back action is as
  // deterministic as the in-page return button. A managed room entry keeps
  // this marker across refreshes and must not grow history again.
  applyHistoryOperations(history, directRoomHistorySeed({
    currentUrl: location.href,
    currentState: history.state,
    roomCode: code,
  }));
  const saved = multiplayerRoomSessions.load({
    product: routedProduct,
    roomCode: code,
    maxDifficulty: mpDifficultyMax(routedProduct),
  });
  const playerCount: 2 | 3 = saved?.room.playerCount === 3 ? 3 : 2;
  const difficulty = saved?.room.difficulty ?? 1;
  const seat = saved?.seat ?? null;
  mpUiState.room = {
    code, playerCount, difficulty, created: !!saved?.room.created,
    seats: null, synced: false, connection: "connecting",
  };
  mpUiState.seat = seat;
  mpUiState.ready = !!saved?.ready;
  mpUiState.spectatorRequested = !!saved?.spectatorRequested;
  mpUiState.roomSettingsOpen = !!saved?.roomSettingsOpen;
  state.product = routedProduct;
  state.game = gameIdForProduct(routedProduct);
  state.runtimeVariant = "multiplayer";
  state.hasSelection = true;
  restoreMpProductPreferences(routedProduct);
  restoreGamePreferences(state.game, currentPreferenceId());
  return true;
}

function mpEnterRoom(code: string, created: boolean) {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // A relay room is ephemeral: once every lobby/game client leaves, recreating
  // the same room code starts its server-side startSerial from zero again.
  // Do not carry the previous room session's serial into a fresh join, or the
  // next `start` (normally serial=1) will be mistaken for an old event.
  mpLobby.startSerial = 0;
  mpUiState.room = {
    code, playerCount: 2, difficulty: 1, created: !!created,
    seats: null, synced: false, connection: "connecting",
  };
  mpUiState.seat = created ? 0 : null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = false;
  mpUiState.roomSettingsOpen = false;
  mpSyncRoomUrl(code, true);
  renderMpRoom();
  render();
  mpConnectLobby();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  setTranslatedStatus(created ? "status.roomCreated" : "status.roomJoined", { code });
}

function mpResetRoomState() {
  mpDisconnectLobby();
  mpLobby.startSerial = 0;
  mpUiState.room = null;
  mpUiState.seat = null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = false;
  mpUiState.roomSettingsOpen = false;
  multiplayerRoomSessions.clear(state.product);
}

function mpLeaveRoom(fromHistory = false) {
  mpResetRoomState();
  if (!fromHistory) replaceLauncherHomeHistory();
  showLauncherHome();
  setTranslatedStatus("status.roomLeft");
}

function mpAnimateLocalPlayerMove(before: DOMRect | null) {
  const playerCard = $("#mpLocalPlayer");
  if (!before || playerCard.hidden || typeof playerCard.animate !== "function") return;
  const after = playerCard.getBoundingClientRect();
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  playerCard.animate([
    { transform: `translate(${dx}px,${dy}px)`, opacity: .76 },
    { transform: "translate(0,0)", opacity: 1 },
  ], { duration: state.lessMotion ? 1 : 320, easing: "cubic-bezier(.2,.75,.2,1)" });
}

function mpTakeSeat(index: number) {
  if (!mpUiState.room?.synced || !mpLobby.connected || !Number.isInteger(index) || index < 0 || index >= mpUiState.room.playerCount) return;
  const playerCard = $("#mpLocalPlayer");
  const before = !playerCard.hidden ? playerCard.getBoundingClientRect() : null;
  if (!mpLobbySend({ type: "take-seat", seat: index, loadout: mpUiState.preferredLoadout, ready: mpUiState.ready, name: mpUiState.displayName })) return;
  mpUiState.seat = index;
  mpUiState.spectatorRequested = false;
  renderMpRoom();
  requestAnimationFrame(() => mpAnimateLocalPlayerMove(before));
}

function mpStandUp() {
  if (!mpUiState.room?.synced || !mpLobby.connected || mpUiState.seat == null) return;
  if (!mpLobbySend({ type: "stand-up" })) return;
  mpUiState.seat = null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = false;
  renderMpRoom();
}

function mpTakeSpectatorSeat() {
  if (!mpUiState.room?.synced || !mpLobby.connected || mpUiState.spectatorRequested) return;
  if (!mpLobbySend({ type: "spectate", name: mpUiState.displayName })) return;
  mpUiState.seat = null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = true;
  renderMpRoom();
}

function mpLeaveSpectatorSeat() {
  if (!mpUiState.room?.synced || !mpLobby.connected || !mpUiState.spectatorRequested) return;
  if (!mpLobbySend({ type: "leave-spectator" })) return;
  mpUiState.spectatorRequested = false;
  renderMpRoom();
}

function mpConfigureRuntimeSession() {
  const room = mpUiState.room;
  const seat = mpUiState.seat;
  const spectator = seat == null && mpUiState.spectatorRequested === true;
  if (!room) throw new Error(t("multiplayer.roomStateInvalid"));
  let role: { spectator: string } | { player: number };
  if (spectator) role = { spectator: mpLobby.clientId };
  else {
    if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= room.playerCount) throw new Error(t("multiplayer.roomStateInvalid"));
    role = { player: seat };
  }
  let relayUrl;
  try {
    relayUrl = buildMultiplayerGameplayRelayUrl(state.netplay.url, {
      product: state.product,
      roomCode: room.code,
      runId: Number(mpLobby.startSerial),
      role,
    });
  } catch { throw new Error(t("multiplayer.relayUrlInvalid")); }

  const product = multiplayerProductIdForGame(state.game);
  if (!product) throw new Error(t("multiplayer.noProduct"));
  state.product = product;
  state.runtimeVariant = "multiplayer";
  state.replayViewer = false;
  state.netplay.url = relayUrl;
  state.netplay.player = spectator ? 0 : seat;
  state.netplay.playerCount = room.playerCount;
  state.netplay.spectator = spectator;
  state.netplay.spectatorId = spectator ? mpLobby.clientId : "";
  state.netplay.spectatorCount = Math.max(0, Number(room.spectatorCount) || 0);
  state.netplay.seed = Number.parseInt(room.code, 10) & 0xffff;
  state.netplay.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number(room.difficulty) || 0));
  state.netplay.loadouts = Array.from({ length: 3 }, (_, playerIndex) => {
    const loadoutIndex = mpNormalizeLoadoutIndex(room.seats?.[playerIndex]?.loadout ?? mpBootstrapLoadoutIndexes[playerIndex]);
    const loadout = mpLoadouts[loadoutIndex] ?? mpLoadouts[0];
    if (!loadout) throw new Error(t("multiplayer.loadoutEmpty"));
    return { character: loadout.character, shot: loadout.shot };
  });
}

function mpSetDisplayName(value: string) {
  if (multiplayerIdentity.displayNameLocked(mpUiState.displayName)) {
    const input = $("#mpDisplayName");
    if (input && input.value !== mpUiState.displayName) input.value = mpUiState.displayName;
    renderMpRoom();
    return;
  }
  const stored = multiplayerIdentity.storeDisplayNameOnce(value, mpUiState.displayName);
  if (!stored.stored) return;
  const name = stored.name;
  mpUiState.displayName = name;
  const input = $("#mpDisplayName");
  if (input) input.value = name;
  if (mpLobby.connected && mpUiState.room?.synced && (mpUiState.seat != null || mpUiState.spectatorRequested))
    mpLobbySend({ type: "set-name", name });
  renderMpRoom();
}

function mpSetLoadout(delta: number) {
  const count = mpLoadoutCount();
  mpUiState.preferredLoadout = (mpNormalizeLoadoutIndex(mpUiState.preferredLoadout) + delta + count) % count;
  multiplayerPreferences.persistPreferredLoadout(state.product, mpUiState.preferredLoadout);
  if (mpUiState.seat != null) mpLobbySend({ type: "set-loadout", loadout: mpUiState.preferredLoadout });
  renderMpRoom();
}

function renderMpRoom() {
  const room = mpUiState.room;
  if (!room) return;
  const roomReady = room.synced === true && mpLobby.connected;
  const ownerLocal = mpRoomOwnerLocal();
  mpUiState.preferredLoadout = mpNormalizeLoadoutIndex(mpUiState.preferredLoadout);
  const loadout = mpLoadouts[mpUiState.preferredLoadout] ?? mpLoadouts[0];
  if (!loadout) throw new Error(t("multiplayer.loadoutEmpty"));
  const difficultyLabels = ["Easy", "Normal", "Hard", "Lunatic", "Extra", "Phantasm"];
  $("#mpRoomTitle").textContent = game().title;
  $("#mpRoomView").setAttribute("aria-label", `${state.game.toUpperCase()} ${t("multiplayer.roomAria")}`);
  $("#mpRoomCode").textContent = room.code;
  $("#mpRoomPlayerCount").value = String(room.playerCount);
  $("#mpRoomDifficulty").value = String(room.difficulty);
  if (!ownerLocal) mpUiState.roomSettingsOpen = false;
  $("#mpRoomSettingsDrawer").hidden = !ownerLocal;
  $("#mpRoomSettings").hidden = !ownerLocal || !mpUiState.roomSettingsOpen;
  $("#mpRoomSettingsToggle").setAttribute("aria-expanded", String(ownerLocal && mpUiState.roomSettingsOpen));
  $("#mpRoomSettingsToggle").classList.toggle("open", ownerLocal && mpUiState.roomSettingsOpen);
  $("#mpRoomDifficultyText").textContent = difficultyLabels[room.difficulty] || "Normal";
  $("#mpSeatStage").dataset.playerCount = String(room.playerCount);
  $("#mpRoomPlayerCount").disabled = !roomReady || !ownerLocal;
  $("#mpRoomDifficulty").disabled = !roomReady || !ownerLocal;
  $("#mpRoomSettingsHint").textContent = t(ownerLocal ? "multiplayer.ownerLocalHint" : "multiplayer.ownerRemoteHint");
  $("#mpOwnerStatus").textContent = !room.synced
    ? t("multiplayer.syncingMembers")
    : !mpLobby.connected
      ? t("multiplayer.reconnecting")
      : t(ownerLocal ? "multiplayer.youAreHost" : "multiplayer.takeHostSeat");

  document.querySelectorAll<HTMLButtonElement>("[data-mp-player-count]").forEach(button => {
    const selected = Number(button.dataset.mpPlayerCount) === room.playerCount;
    button.classList.toggle("selected", selected);
    button.disabled = !roomReady || !ownerLocal || selected;
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mp-difficulty]").forEach(button => {
    const difficulty = Number(button.dataset.mpDifficulty);
    const supported = difficulty <= mpDifficultyMax();
    const selected = difficulty === room.difficulty;
    button.hidden = !supported;
    button.classList.toggle("selected", selected);
    button.disabled = !supported || !roomReady || !ownerLocal || selected;
    button.setAttribute("aria-pressed", String(selected));
  });
  for (const option of $("#mpRoomDifficulty").options) {
    const supported = Number(option.value) <= mpDifficultyMax();
    option.disabled = !supported;
    option.hidden = !supported;
  }

  document.querySelectorAll<HTMLElement>("[data-mp-seat]").forEach(seat => {
    const index = Number(seat.dataset.mpSeat);
    const active = index < room.playerCount;
    const networkSeat = room.synced ? room.seats?.[index] || null : null;
    const occupied = room.synced === true && (!!networkSeat || mpUiState.seat === index);
    seat.hidden = !active;
    seat.classList.toggle("occupied", occupied);
    seat.classList.toggle("owner", index === 0 && ownerLocal);
    seat.classList.toggle("reconnecting", !!networkSeat?.offline);
    seat.title = networkSeat?.offline ? t("multiplayer.playerReconnecting") : "";
    const drop = seat.querySelector<HTMLElement>("[data-mp-seat-drop]");
    const button = drop?.querySelector<HTMLButtonElement>("button");
    const glyph = seat.querySelector<HTMLElement>("[data-mp-seat-glyph]");
    const me = seat.querySelector<HTMLElement>("[data-mp-seat-me]");
    if (drop) drop.hidden = occupied;
    if (glyph) {
      glyph.hidden = !occupied;
      const seatLoadout = networkSeat ? mpLoadouts[mpNormalizeLoadoutIndex(networkSeat.loadout)] : loadout;
      const seatName = networkSeat?.name || (mpUiState.seat === index ? mpUiState.displayName : "");
      glyph.textContent = mpDisplayInitial(seatName, seatLoadout?.glyph || loadout.glyph);
      seat.title = seatName ? `${seatName} - ${mpLoadoutLabel(seatLoadout || loadout)}` : mpLoadoutLabel(seatLoadout || loadout);
      let loadoutLabel = seat.querySelector<HTMLElement>(".mp-seat-loadout");
      if (!loadoutLabel) {
        loadoutLabel = document.createElement("span");
        loadoutLabel.className = "mp-seat-loadout";
        seat.append(loadoutLabel);
      }
      loadoutLabel.hidden = !occupied;
      loadoutLabel.textContent = mpLoadoutLabel(seatLoadout || loadout);
    }
    if (me) me.hidden = mpUiState.seat !== index;
    if (button) {
      button.disabled = !roomReady || !active || occupied;
      button.textContent = t("multiplayer.join");
    }
  });

  const playerCard = $("#mpLocalPlayer");
  if (!room.synced || mpUiState.seat == null) {
    playerCard.hidden = true;
  } else {
    playerCard.hidden = false;
    $("#mpLocalRoleLabel").textContent = mpLoadoutLabel(loadout);
  }

  $("#mpLocalLoadoutLabel").textContent = mpLoadoutLabel(loadout);
  $("#mpLocalCharacterGlyph").textContent = loadout.glyph;
  const spectatorEntries = Array.isArray(room.spectators) ? room.spectators : [];
  const spectatorCount = Math.max(spectatorEntries.length, Math.max(0, Number(room.spectatorCount) || 0));
  $("#mpSpectatorCount").textContent = String(spectatorCount);
  const spectatorList = $("#mpSpectatorList");
  spectatorList.replaceChildren();
  for (const entry of spectatorEntries) {
    const row = document.createElement("div");
    row.className = "mp-spectator-entry";
    if (entry.clientId === mpLobby.clientId) row.classList.add("mine");
    const avatar = document.createElement("span");
    avatar.className = "mp-spectator-avatar";
    avatar.textContent = mpDisplayInitial(entry.name);
    const marker = document.createElement("span");
    marker.className = "mp-spectator-marker";
    marker.textContent = entry.clientId === mpLobby.clientId ? t("multiplayer.you") : "";
    row.title = entry.name || t("multiplayer.unnamedSpectator");
    row.append(avatar, marker);
    spectatorList.append(row);
  }
  if (!spectatorEntries.length) {
    const empty = document.createElement("div");
    empty.className = "mp-spectator-empty";
    empty.textContent = t("status.noSpectators");
    spectatorList.append(empty);
  }
  const spectatorJoin = $("#mpSpectatorJoin");
  spectatorJoin.disabled = !roomReady || mpUiState.seat != null;
  spectatorJoin.textContent = t(mpUiState.spectatorRequested ? "multiplayer.leaveSpectator" : "multiplayer.joinSpectator");

  const nameInput = $("#mpDisplayName");
  if (nameInput) {
    if (document.activeElement !== nameInput) nameInput.value = mpUiState.displayName;
    const locked = multiplayerIdentity.displayNameLocked(mpUiState.displayName);
    const editor = $("#mpNameEditor");
    if (editor) editor.hidden = locked;
    nameInput.disabled = false;
    nameInput.title = locked ? "" : t("multiplayer.nameOneTimeHint");
  }

  const spectator = $("#mpUnseatedNote");
  spectator.hidden = room.synced === true && mpUiState.seat != null;
  requiredDescendant(spectator, ".mp-spectator-title", HTMLElement).textContent = !room.synced
    ? t("multiplayer.connectingRoom") : t(mpUiState.spectatorRequested ? "multiplayer.spectatorSeat" : "multiplayer.notSeated");
  requiredDescendant(spectator, ".mp-spectator-hint", HTMLElement).textContent = !room.synced
    ? t("multiplayer.syncingState")
    : mpUiState.spectatorRequested
      ? t("multiplayer.waitSpectatorStream")
      : t("multiplayer.chooseSeatOrSpectate");
  requiredDescendant(spectator, ".mp-spectator-loadout", HTMLElement).hidden = !room.synced || mpUiState.spectatorRequested;
  requiredDescendant($("#mpRoomView"), ".mp-room-footer", HTMLElement).hidden = !room.synced || mpUiState.seat == null;
  const ready = $("#mpReady");
  ready.hidden = mpUiState.seat == null;
  ready.disabled = !roomReady || mpUiState.seat == null || room.phase !== "lobby" || mpGameCheckInFlight;
  ready.classList.toggle("ready", mpUiState.ready && mpUiState.seat != null);
  ready.textContent = t(mpUiState.ready && mpUiState.seat != null ? "multiplayer.readyDone" : "multiplayer.ready");
  const gameCheck = $("#mpCheckGame");
  gameCheck.hidden = mpUiState.seat == null;
  gameCheck.disabled = mpUiState.seat == null || (!!room.phase && room.phase !== "lobby") ||
    mpUiState.ready || mpGameCheckInFlight || mpLaunchInFlight;
  gameCheck.textContent = t(mpGameCheckInFlight ? "multiplayer.checkingGame" : "multiplayer.checkGame");
  const start = $("#mpStartGame");
  const synchronizedReady = roomReady && room.phase === "lobby" && Array.isArray(room.seats) &&
    room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
  start.hidden = !ownerLocal;
  start.disabled = !roomReady || room.phase !== "lobby" || (ownerLocal && !synchronizedReady);
  start.textContent = t(!synchronizedReady ? "multiplayer.waitReady" : "multiplayer.startGame");
  mpPersistRoomState();
}

// FLIP: read the visible geometry once, commit the final flex layout, then
// animate compositor transforms. Text and artwork counter-scale independently:
// the image keeps its cover crop instead of stretching with the card. Geometry
// is read only at the endpoints, including the visible frame on interruption.
interface CardArtworkSnapshot { image: HTMLImageElement; cover: number }
interface CardLayoutEntry { rect: DOMRect; artwork: CardArtworkSnapshot[] }
interface CardLayoutSnapshot { cards: Map<HTMLElement, CardLayoutEntry> }
const cardLayoutAnimations = new Set<Animation>();
const cardArtworkSizes = new Set<HTMLImageElement>();
const cardLayoutMedia = matchMedia("(min-width: 781px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
function cancelCardLayoutMotion() {
  for (const animation of cardLayoutAnimations) animation.cancel();
  cardLayoutAnimations.clear();
  for (const image of cardArtworkSizes) {
    image.style.removeProperty("width");
    image.style.removeProperty("height");
  }
  cardArtworkSizes.clear();
  $("#main").classList.remove("card-layout-motion");
}
function captureCardLayout(): CardLayoutSnapshot | null {
  if (!cardLayoutMedia.matches || state.lessMotion) {
    cancelCardLayoutMotion();
    return null;
  }
  // Capture before cancellation so rapid clicks start from the visible frame.
  const rects = new Map<HTMLElement, CardLayoutEntry>();
  for (const card of document.querySelectorAll<HTMLElement>(".game:not([hidden])")) {
    rects.set(card, {
      rect: card.getBoundingClientRect(),
      artwork: [...card.querySelectorAll<HTMLImageElement>(".card-art-image")].map(image => {
        const rect = image.getBoundingClientRect();
        const parent = image.parentElement;
        if (!parent) throw new Error(t("ui.cardImageContainerMissing"));
        const zoom = new DOMMatrixReadOnly(getComputedStyle(parent).transform).a;
        return { image, cover: Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight) / zoom };
      })
    });
  }
  cancelCardLayoutMotion();
  for (const card of rects.keys()) {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  }
  return { cards: rects };
}
function animateCardLayout(before: CardLayoutSnapshot | null) {
  if (!before || !cardLayoutMedia.matches || state.lessMotion) return;
  const main = $("#main");
  main.classList.add("card-layout-motion");
  const style = getComputedStyle(main);
  const duration = Number(style.getPropertyValue("--card-layout-duration"));
  const curveParts = style.getPropertyValue("--ease").match(/[\d.]+/g)?.map(Number) ?? [];
  const [x1 = .2, y1 = .75, x2 = .2, y2 = 1] = curveParts;
  // Sample the project's cubic curve parametrically: x is time, y is progress.
  // Shared samples keep every counter-scale in sync without easing it twice.
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  const samples = Array.from({ length: 101 }, (_, step) => {
    const t = step / 100;
    return { offset: curve(t, x1, x2), remaining: 1 - curve(t, y1, y2) };
  });
  const after: Array<{ card: HTMLElement; end: DOMRect; artwork: Array<CardArtworkSnapshot & { endCover: number }> }> = [];
  for (const card of before.cards.keys()) {
    if (card.hidden) continue;
    const captured = before.cards.get(card);
    if (!captured) continue;
    const artwork = captured.artwork.flatMap(art => {
      const parent = art.image.parentElement;
      if (!parent || !art.image.naturalWidth || !(art.cover > 0) || !Number.isFinite(art.cover)) return [];
      return [{ ...art, endCover: Math.max(parent.clientWidth / art.image.naturalWidth, parent.clientHeight / art.image.naturalHeight) }];
    });
    after.push({ card, end: card.getBoundingClientRect(), artwork });
  }
  const track = (element: Element, frames: Keyframe[], timing: KeyframeAnimationOptions = {}) => {
    const animation = element.animate(frames, { duration, easing: "linear", ...timing });
    cardLayoutAnimations.add(animation);
    animation.finished.catch(() => {}).finally(() => {
      animation.cancel();
      cardLayoutAnimations.delete(animation);
      if (!cardLayoutAnimations.size) cancelCardLayoutMotion();
    });
  };
  for (const { card, end, artwork } of after) {
    const captured = before.cards.get(card);
    if (!captured) continue;
    const start = captured.rect;
    if (!start.width || !end.width || !end.height) continue;
    const dx = start.left - end.left, dy = start.top - end.top;
    const sx = start.width / end.width, sy = start.height / end.height;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(start.width - end.width) + Math.abs(start.height - end.height) < .5) continue;
    const frames: Keyframe[] = [], counterScale: Keyframe[] = [];
    for (const { offset, remaining } of samples) {
      const x = 1 + (sx - 1) * remaining, y = 1 + (sy - 1) * remaining;
      frames.push({ offset, transform: `translate(${dx * remaining}px,${dy * remaining}px) scale(${x},${y})` });
      counterScale.push({ offset, scale: `${1 / x} ${1 / y}` });
    }
    track(card, frames);
    for (const content of card.querySelectorAll<HTMLElement>(".no, .game-copy, .rail-title, .mp-card-mark")) track(content, counterScale);
    for (const { image, cover, endCover } of artwork) {
      // Give the image its full (uncropped) final cover size. Only transforms
      // vary during motion; the card remains the clipping viewport.
      image.style.width = `${image.naturalWidth * endCover}px`;
      image.style.height = `${image.naturalHeight * endCover}px`;
      cardArtworkSizes.add(image);
      track(image, samples.map(({ offset, remaining }) => {
        const size = 1 + (cover / endCover - 1) * remaining;
        const x = 1 + (sx - 1) * remaining, y = 1 + (sy - 1) * remaining;
        return { offset, transform: `translate(calc(-1 * var(--art-position,50%)),-50%) scale(${size / x},${size / y})` };
      }));
    }
  }
  // Fade only the content groups, leaving the panel surface and its layout
  // unchanged. Direct children avoid applying opacity twice to nested controls.
  for (const content of $(".tools").children) {
    if (!(content instanceof HTMLElement) || content.hidden) continue;
    track(content, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 420, delay: 80, easing: style.getPropertyValue("--ease"), fill: "both"
    });
  }
  if (!cardLayoutAnimations.size) main.classList.remove("card-layout-motion");
}
window.addEventListener("resize", cancelCardLayoutMotion);
cardLayoutMedia.addEventListener("change", cancelCardLayoutMotion);

function cancelMobileHomeCards() {
  for (const art of document.querySelectorAll<HTMLElement>(".game .card-art")) {
    for (const animation of art.getAnimations()) {
      if (animation.id === "mobile-home-clear") animation.cancel();
    }
  }
}
function animateMobileHomeCards() {
  cancelMobileHomeCards();
  if (state.hasSelection || matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)").matches) return;
  // Mobile cold start must not animate blur/filter across every card. On
  // throttled phones that keeps expensive paint/compositing active while the
  // Launcher is still settling. A short opacity reveal preserves the cue while
  // leaving the authored card filter completely static.
  for (const art of document.querySelectorAll<HTMLElement>(".game:not([hidden]) .card-art")) {
    const animation = art.animate([
      { opacity: .78 },
      { opacity: 1 }
    ], { duration: 180, easing: "ease-out", fill: "both" });
    animation.id = "mobile-home-clear";
    animation.finished.catch(() => {}).finally(() => animation.cancel());
  }
}
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", cancelMobileHomeCards);

interface CardFilterTransition { animation?: Animation }
let cardFilterTransition: CardFilterTransition | null = null;
const cardFilterReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let cardFilterIndicatorAnimation: Animation | null = null;
function moveCardFilterIndicator(button: HTMLElement | null, animate = true) {
  const indicator = $(".card-filter-indicator");
  if (!indicator || !button || $("#cardFilterBar").hidden) return;
  const start = indicator.getBoundingClientRect();
  cardFilterIndicatorAnimation?.cancel();
  indicator.style.left = `${button.offsetLeft}px`;
  indicator.style.width = `${button.offsetWidth}px`;
  const end = indicator.getBoundingClientRect();
  if (!animate || state.lessMotion || cardFilterReducedMotion.matches || !start.width) return;
  const dx = start.left - end.left;
  const scale = start.width / end.width;
  const animation = indicator.animate([
    { transform: `translateX(${dx}px) scaleX(${scale})` },
    { transform: "translateX(0) scaleX(1)" }
  ], { duration: 380, easing: "cubic-bezier(.22,.8,.22,1)" });
  cardFilterIndicatorAnimation = animation;
  animation.finished.catch(() => {}).finally(() => {
    if (cardFilterIndicatorAnimation !== animation) return;
    animation.cancel();
    cardFilterIndicatorAnimation = null;
  });
}
function cancelCardFilterMotion() {
  const pending = cardFilterTransition;
  cardFilterTransition = null;
  pending?.animation?.cancel();
  const main = $("#main");
  main.classList.remove("card-filter-motion");
  main.inert = false;
}
function finishCardFilterMotion() {
  cardFilterTransition?.animation?.finish();
}
cardFilterReducedMotion.addEventListener("change", finishCardFilterMotion);

async function switchCardFilter(next: string | undefined) {
  if (!isCardFilter(next) || mpUiState.room || state.launched) return;
  if (next === cardFilter && !state.hasSelection && !cardFilterTransition) return;
  moveCardFilterIndicator(document.querySelector<HTMLElement>(`[data-card-filter="${next}"]`));
  const main = $("#main");
  const appearance = getComputedStyle(main);
  const opacity = appearance.opacity, transform = appearance.transform;
  cancelCardFilterMotion();
  // Preserve the current card frame until it has faded away. Cancelling FLIP
  // here would expose the final geometry for a frame during a quick tab click.
  const transition: CardFilterTransition = {};
  cardFilterTransition = transition;
  main.classList.add("card-filter-motion");
  main.inert = true;
  const reduced = () => state.lessMotion || cardFilterReducedMotion.matches;
  try {
    if (!reduced()) {
      transition.animation = main.animate([{ opacity, transform }, { opacity: 0, transform }],
        { duration: 140, easing: "ease-out", fill: "forwards" });
      await transition.animation.finished;
    }
    if (cardFilterTransition !== transition) return;
    // All categories return through the same home route, even when the
    // previously selected game also belongs to the destination category.
    cancelCardFilterMotion();
    cancelCardLayoutMotion();
    closeOtherCustomSelects();
    if (state.hasSelection) resetRuntime();
    cardFilter = next;
    try { localStorage.setItem(cardFilterStorageKey, cardFilter); } catch {}
    replaceLauncherHomeHistory();
    showLauncherHome();
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!reduced()) {
      cardFilterTransition = transition;
      main.classList.add("card-filter-motion");
      main.inert = true;
      transition.animation = main.animate([
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration: 360, easing: getComputedStyle(main).getPropertyValue("--ease"), fill: "both" });
      await transition.animation.finished;
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  } finally {
    if (cardFilterTransition === transition) cancelCardFilterMotion();
  }
}
document.querySelectorAll<HTMLButtonElement>("[data-card-filter]").forEach(button => {
  button.addEventListener("click", () => switchCardFilter(button.dataset.cardFilter));
});
moveCardFilterIndicator(document.querySelector<HTMLElement>(`[data-card-filter="${cardFilter}"]`), false);
new ResizeObserver(() => {
  if (!cardFilterIndicatorAnimation) {
    moveCardFilterIndicator(document.querySelector<HTMLElement>(`[data-card-filter="${cardFilter}"]`), false);
  }
}).observe($("#cardFilterBar"));

document.querySelectorAll<HTMLElement>(".game").forEach(card => {
  card.addEventListener("click", event => {
    event.preventDefault();
    if (mpUiState.room) return;
    cancelMobileHomeCards();
    const mobileLite = matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)").matches || state.lessMotion;
    const main = $("#main");
    const product = card.dataset.product || card.dataset.game;
    const gameId = card.dataset.game;
    if (!product || !gameId || !isProductId(product) || !isGameId(gameId) || !productEnabled(product)) return;
    const changed = state.product !== product;
    const previousLayout = changed || !state.hasSelection ? captureCardLayout() : null;
    if (changed) {
      state.game = gameId;
      state.product = product;
      state.runtimeVariant = isMultiplayerProduct(product) ? "multiplayer" : "normal";
      restoreMpProductPreferences(product);
      restoreGamePreferences(state.game, currentPreferenceId());
      resetRuntime();
    }
    state.hasSelection = true;
    const routeOperation = playerRouteHistoryOperation({
      currentUrl: location.href,
      currentState: history.state,
      routedProduct: routedGameFromLocation(),
      product,
    });
    if (routeOperation) applyHistoryOperations(history, [routeOperation]);
    render();
    animateCardLayout(previousLayout);
    setTranslatedStatus(changed ? "status.switchedProduct" : "status.selectedProduct", { product: productTitle(product) });
    if (mobileLite && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      main.classList.remove("mobile-selection-enter");
      requestAnimationFrame(() => {
        main.classList.add("mobile-selection-enter");
        setTimeout(() => main.classList.remove("mobile-selection-enter"), 180);
      });
    }
  });
  if (matchMedia("(pointer: fine)").matches) {
    card.addEventListener("pointermove", event => {
      if (state.lessMotion || cardLayoutAnimations.size) return;
      if (state.hasSelection && !card.classList.contains("selected")) return;
      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      card.style.setProperty("--ry", `${((x / rect.width) - .5) * 7}deg`);
      card.style.setProperty("--rx", `${(.5 - (y / rect.height)) * 5}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  }
});
$("#languageSelect").addEventListener("change", event => {
  const available = languageCatalog(state.game);
  const value = $("#languageSelect").value;
  if (!available.some(entry => entry.id === value) || state.language === value) return;
  state.language = value;
  saveGamePreferences();
  resetRuntime();
  render();
  setStatus(t("status.selectedLanguage", { language: entryTitle(languageEntry()) }));
});
$("#musicSelect").addEventListener("change", event => {
  const value = $("#musicSelect").value;
  if (!webAudioAvailable && value !== "none") {
    state.music = "none";
    $("#musicSelect").value = "none";
    showToast(t("music.webAudioFallback"));
    setStatus(t("status.musicNone"));
    return;
  }
  if (!isMusicMode(value) || (state.music === value && state.musicPreferenceExplicit && state.musicPreference === value)) return;
  state.music = value;
  state.musicPreference = value;
  state.musicPreferenceExplicit = true;
  saveGamePreferences();
  resetRuntime();
  render();
  setStatus(t("status.musicMode", { music: musicModeLabel(state.music) }));
});
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.action) void runAction(button.dataset.action);
}));
$("#mobileOptionsToggle").addEventListener("click", () => { state.mobileOpen = !state.mobileOpen; render(); });
$("#touchLayoutEdit").addEventListener("click", () => { void openTouchLayoutEditor().catch(error => { const reason = errorMessage(error); showToast(reason); setStatus(t("status.errorReason", { reason })); }); });
$("#touchLayoutScale").addEventListener("input", event => {
  if (!touchLayoutEditing) return;
  const scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, Number($("#touchLayoutScale").value) / 100));
  scaleTouchLayoutItem(touchLayoutSelected, scale);
});
$("#touchLayoutOrientationHelpOpen").addEventListener("click", () => { if (touchLayoutEditing) void switchTouchLayoutOrientation(); });
$("#touchViewportAdjust").addEventListener("click", startTouchViewportEditing);
$("#touchViewportReset").addEventListener("click", resetTouchViewportPosition);
$("#touchViewportDone").addEventListener("click", finishTouchViewportEditing);
$("#touchLayoutReset").addEventListener("click", async () => {
  if (!touchLayoutEditing) return;
  const orientationTitle = t(touchLayoutOrientation() === "landscape" ? "touch.landscape" : "touch.portrait");
  if (!await askConfirmation({
    message: t("touch.restoreLayoutConfirm", { orientation: orientationTitle }),
    confirmText: t("touch.restoreDefault"),
    tone: "danger"
  })) return;
  if (!touchLayoutDraft) touchLayoutDraft = emptyTouchLayout();
  touchLayoutDraft.profiles[touchLayoutOrientation()] = null;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  showToast(t("touch.restoreLayoutToast", { orientation: orientationTitle }));
});
$("#touchLayoutSave").addEventListener("click", saveTouchLayoutEditor);
$("#touchLayoutExit").addEventListener("click", () => { if (touchLayoutEditing) void closeTouchLayoutEditor(); });
$("#thpracToggle").addEventListener("click", () => setOption("thpracEnabled", !state.options.thpracEnabled));
$("#magnifierToggle").addEventListener("click", () => setOption("magnifierEnabled", !state.options.magnifierEnabled));
$("#frameLimitToggle").addEventListener("click", () => setOption("frameLimit60Enabled", !state.options.frameLimit60Enabled));
const mastheadMenu = $("#mastheadMenu");
const mastheadMenuToggle = $("#mastheadMenuToggle");
const mastheadMenuPanel = $("#mastheadMenuPanel");
runtimeDiagnosticsToggle.addEventListener("click", () => {
  runtimeDiagnosticsPreference = !runtimeDiagnosticsEnabled();
  try { localStorage.setItem(runtimeDiagnosticsStorageKey, runtimeDiagnosticsPreference ? "1" : "0"); } catch {}
  syncRuntimeDiagnosticsToggle();
  updateRuntimeDiagnostics();
});
function setMastheadMenuOpen(open: boolean, { focusFirst = false, restoreFocus = false }: { focusFirst?: boolean; restoreFocus?: boolean } = {}) {
  mastheadMenuToggle.setAttribute("aria-expanded", String(open));
  mastheadMenuPanel.setAttribute("aria-hidden", String(!open));
  mastheadMenuPanel.inert = !open;
  if (focusFirst && open) mastheadMenuPanel.querySelector<HTMLElement>(".mizuki-select-trigger, .masthead-menu-item")?.focus();
  if (restoreFocus && !open) mastheadMenuToggle.focus();
}
mastheadMenuToggle.addEventListener("click", () => {
  setMastheadMenuOpen(mastheadMenuToggle.getAttribute("aria-expanded") !== "true");
});
mastheadMenuToggle.addEventListener("keydown", event => {
  if (event.key !== "ArrowDown") return;
  event.preventDefault();
  setMastheadMenuOpen(true, { focusFirst: true });
});
mastheadMenu.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  setMastheadMenuOpen(false, { restoreFocus: true });
});
document.addEventListener("click", event => {
  if (event.target instanceof Node && !mastheadMenu.contains(event.target)) setMastheadMenuOpen(false);
});
const firstUseNotice = createFirstUseNoticeController({
  emptyText: () => t("firstUseNotice.empty"),
  readFailureText: error => t("firstUseNotice.readFailed", { reason: errorMessage(error) }),
});
$("#firstUseNoticeOpen").addEventListener("click", () => {
  setMastheadMenuOpen(false);
  void firstUseNotice.showManual();
});
$("#lessMotionToggle").addEventListener("click", () => {
  cancelCardLayoutMotion();
  state.lessMotion = !state.lessMotion;
  if (state.lessMotion) cancelMobileHomeCards();
  if (state.lessMotion) finishCardFilterMotion();
  try { localStorage.setItem(lessMotionStorageKey, state.lessMotion ? "1" : "0"); } catch {}
  if (state.lessMotion) document.querySelectorAll<HTMLElement>(".game").forEach(card => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  });
  render();
});
$("#firstUseNoticeClose").addEventListener("click", firstUseNotice.close);
$("#firstUseNoticeCloseHint").addEventListener("click", firstUseNotice.close);
const appleRefreshDialog = $("#appleRefreshDialog");
function openAppleRefreshDialog() {
  if (!appleRefreshDialog.open) {
    appleRefreshDialog.classList.remove("closing");
    appleRefreshDialog.showModal();
  }
}
$("#frameLimitAppleNote").addEventListener("click", openAppleRefreshDialog);
$("#mpFrameLimitAppleNote").addEventListener("click", openAppleRefreshDialog);
function closeAppleRefreshDialog() {
  if (!appleRefreshDialog.open || appleRefreshDialog.classList.contains("closing")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { appleRefreshDialog.close(); return; }
  appleRefreshDialog.classList.add("closing");
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    if (appleRefreshDialog.open) appleRefreshDialog.close();
  };
  appleRefreshDialog.addEventListener("animationend", event => { if (event.animationName === "replay-window-out") finish(); }, { once: true });
  setTimeout(finish, 220);
}
$("#appleRefreshClose").addEventListener("click", closeAppleRefreshDialog);
appleRefreshDialog.addEventListener("cancel", event => { event.preventDefault(); closeAppleRefreshDialog(); });
appleRefreshDialog.addEventListener("close", () => appleRefreshDialog.classList.remove("closing"));
appleRefreshDialog.addEventListener("click", event => {
  if (event.target === appleRefreshDialog) closeAppleRefreshDialog();
});
const siteNotice = createSiteNoticeController({
  onOptOut: () => showToast(t("notice.restoreHint")),
});
const multiplayerGuide = createMultiplayerGuideController({
  readFailureText: error => t("multiplayerGuide.readFailed", { reason: errorMessage(error) }),
});
$("#mpGuideOpen").addEventListener("click", () => { void multiplayerGuide.show(); });
createNetworkDiagnosticsController({
  button: $("#mpNetworkCheck"),
  panel: $("#mpNetworkResults"),
  getRelayUrl: () => {
    try { return buildMultiplayerDiagnosticRelayUrl(state.netplay.url); }
    catch { return ""; }
  },
  getFallbackIceServers: () => state.netplay.iceServers,
  translate: (key, params) => t(key, params),
});
createEdgeDrawerGesture({
  side: "right",
  drawer: $("#firstUseNoticeDialog"),
  isOpen: firstUseNotice.isOpen,
  open: firstUseNotice.showManual,
  close: firstUseNotice.close,
});
createEdgeDrawerGesture({
  side: "right",
  drawer: $("#mpSettingsRoomDrawer"),
  isOpen: () => mpSettingsRoomDrawerOpen,
  open: () => {},
  close: () => setMpSettingsRoomDrawerOpen(false),
});
createEdgeDrawerGesture({
  side: "left",
  drawer: $("#siteNotice"),
  isOpen: siteNotice.isOpen,
  open: siteNotice.load,
  close: siteNotice.close,
  enabled: siteNotice.isEnabled,
});
$("#th06HitboxToggle").addEventListener("click", () => setOption("th06FocusHitbox", !state.options.th06FocusHitbox));
$("#touchToggle").addEventListener("click", async () => {
  const enabling = !state.options.touchEnabled;
  if (enabling && !await confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;
  setOption("touchEnabled", enabling);
});
$("#touchMovementMode").addEventListener("change", async event => {
  const value = $("#touchMovementMode").value;
  if (!isTouchMovementMode(value)) { render(); return; }
  if (value !== state.options.touchMovementMode && !await confirmTouchModeBeforeEnable(value)) { render(); return; }
  setOption("touchMovementMode", value);
});
document.querySelectorAll<HTMLElement>("[data-touch-sensitivity-preset]").forEach(button => button.addEventListener("click", () => {
  if (touchMovementUsesJoystick(state.options.touchMovementMode)) return;
  const value = Number(button.dataset.touchSensitivityPreset);
  if (!touchSensitivityPresets.has(value)) return;
  touchSensitivityCustomOpen = false;
  state.options.touchSensitivity = value;
  queueTouchControlsSync();
  saveGamePreferences();
  render();
}));
$("#touchSensitivityCustomToggle").addEventListener("click", () => {
  if (touchMovementUsesJoystick(state.options.touchMovementMode)) return;
  touchSensitivityCustomOpen = true;
  render();
});
$("#touchSensitivity").addEventListener("input", event => {
  const value = Math.min(300, Math.max(50, Math.round(Number($("#touchSensitivity").value) || 100)));
  touchSensitivityCustomOpen = true;
  state.options.touchSensitivity = value;
  $("#touchSensitivityValue").textContent = `${value}%`;
  queueTouchControlsSync();
});
$("#touchSensitivity").addEventListener("change", () => saveGamePreferences());
$("#touchFocusMode").addEventListener("change", event => {
  const value = $("#touchFocusMode").value;
  if (isTouchFocusMode(value)) setOption("touchFocusMode", value);
});
$("#doubleTapBombToggle").addEventListener("click", () => setOption("doubleTapBombEnabled", !state.options.doubleTapBombEnabled));
$("#restartButtonToggle").addEventListener("click", () => setOption("restartButtonEnabled", !state.options.restartButtonEnabled));
$("#alwaysHitboxToggle").addEventListener("click", () => setOption("alwaysHitbox", !state.options.alwaysHitbox));
$("#thpracTouchControlsToggle").addEventListener("click", () => {
  if (state.options.thpracEnabled)
    setOption("thpracTouchControlsEnabled", !state.options.thpracTouchControlsEnabled);
});
$("#startupErrorClose").addEventListener("click", clearStartupError);
$("#toastClose").addEventListener("click", hideToast);
$("#decisionDialog").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  if (event.target === $("#decisionCancel")) return;
  event.preventDefault();
  if ($("#decisionDialog").dataset.confirmOnEnter === "true") $("#decisionConfirm").click();
});
requiredDescendant($("#decisionDialog"), ".decision-window", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  const value = event.submitter instanceof HTMLButtonElement ? event.submitter.value : "cancel";
  closeDecisionDialog(value === "confirm" || value === "secondary" ? value : "cancel");
});
$("#decisionDialog").addEventListener("cancel", event => {
  event.preventDefault();
  closeDecisionDialog("cancel");
});
$("#decisionDialog").addEventListener("close", event => {
  const resolve = decisionResolver;
  const focusReturn = decisionFocusReturn;
  decisionResolver = null;
  decisionFocusReturn = null;
  const value = $("#decisionDialog").returnValue;
  resolve?.(value === "confirm" || value === "secondary" ? value : "cancel");
  if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
  maybeApplyDeferredAppShellUpdate();
});
function toggleTouchFire() {
  touchControls.fireEnabled = !touchControls.fireEnabled;
  renderTouchFireState(false);
  refocusGameIfNeeded();
  pushTouchControlsLive();
}

// iOS/WebKit may drop simultaneous pointer streams when one finger is inside
// the game iframe and another is on a host HUD button. Keep direct movement in
// the host document and forward it into the Runtime as auxiliary touch input.
const directTouchPointers = new Map<number, DirectTouchPoint>();
let nextDirectTouchId = -1000000;
let directTouchFrameRect: { left: number; top: number; width: number; height: number } | null = null;

function invalidateDirectTouchFrameRect() {
  directTouchFrameRect = null;
}

function currentDirectTouchFrameRect(force = false) {
  if (!force && directTouchFrameRect) return directTouchFrameRect;
  const rect = frame.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  directTouchFrameRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  return directTouchFrameRect;
}

function directTouchFramePoint(event: { clientX: number; clientY: number }, forceRect = false) {
  const rect = currentDirectTouchFrameRect(forceRect);
  if (!rect) return null;
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function directTouchZoomInput(touch: Touch): GameZoomPointerInput {
  return {
    pointerId: touch.identifier,
    pointerType: "touch",
    clientX: touch.clientX,
    clientY: touch.clientY,
    currentTarget: touchDirectSurface,
  };
}

function forEachChangedTouch(event: TouchEvent, callback: (touch: Touch) => void) {
  for (let index = 0; index < event.changedTouches.length; index++) {
    const touch = event.changedTouches.item(index);
    if (touch) callback(touch);
  }
}

function postDirectTouch(type: DirectTouchType, touch: DirectTouchPoint) {
  return postRuntimeDirectTouch(touchRuntimeMessageContext(), type, touch);
}

function cancelDirectTouches(notifyRuntime = true) {
  if (!directTouchPointers.size) return;
  directTouchPointers.clear();
  invalidateDirectTouchFrameRect();
  if (notifyRuntime) postRuntimeTouchCancel(touchRuntimeMessageContext());
}

touchDirectSurface.addEventListener("pointerdown", event => {
  if (iosWebKitTouch || event.pointerType === "mouse" || touchDirectSurface.hidden || directTouchPointers.has(event.pointerId)) return;
  const point = directTouchFramePoint(event, directTouchPointers.size === 0 || gameZoom.isActive());
  if (!point) return;
  event.preventDefault();
  const touch = { id: nextDirectTouchId--, ...point };
  directTouchPointers.set(event.pointerId, touch);
  if (gameZoom.isActive()) gameZoom.beginPointer(event);
  postDirectTouch("down", touch);
});

touchDirectSurface.addEventListener("pointermove", event => {
  if (iosWebKitTouch) return;
  const touch = directTouchPointers.get(event.pointerId);
  if (!touch) return;
  // The game iframe geometry is stable throughout normal gameplay. Re-reading
  // getBoundingClientRect() for every high-rate pointermove can force layout on
  // mobile browsers, so reuse the gesture-local rect. Zoom editing is the one
  // path that intentionally changes the frame transform during the gesture.
  const point = directTouchFramePoint(event, gameZoom.isActive());
  if (!point) return;
  event.preventDefault();
  touch.x = point.x;
  touch.y = point.y;
  if (gameZoom.isActive()) gameZoom.movePointer(event);
  postDirectTouch("move", touch);
});

const releaseDirectTouch = (event: PointerEvent) => {
  if (iosWebKitTouch) return;
  const touch = directTouchPointers.get(event.pointerId);
  if (!touch) return;
  event.preventDefault?.();
  const point = Number.isFinite(event.clientX) ? directTouchFramePoint(event, gameZoom.isActive()) : null;
  if (point) { touch.x = point.x; touch.y = point.y; }
  directTouchPointers.delete(event.pointerId);
  if (gameZoom.isActive()) gameZoom.endPointer(event);
  postDirectTouch("up", touch);
  if (!directTouchPointers.size) invalidateDirectTouchFrameRect();
};
touchDirectSurface.addEventListener("pointerup", releaseDirectTouch);
touchDirectSurface.addEventListener("pointercancel", releaseDirectTouch);
touchDirectSurface.addEventListener("lostpointercapture", releaseDirectTouch);

touchDirectSurface.addEventListener("touchstart", event => {
  if (!iosWebKitTouch || touchDirectSurface.hidden) return;
  // On iOS a completed tap can synthesize compatibility mouse/click events and
  // transfer focus away from the Runtime iframe. Own the native TouchEvent
  // sequence instead: WebKit keeps that sequence targeted at the element that
  // received touchstart, which avoids cross-frame PointerEvent capture quirks.
  event.preventDefault();
  forEachChangedTouch(event, contact => {
    if (directTouchPointers.has(contact.identifier)) return;
    const point = directTouchFramePoint(contact, directTouchPointers.size === 0 || gameZoom.isActive());
    if (!point) return;
    const touch = { id: nextDirectTouchId--, ...point };
    directTouchPointers.set(contact.identifier, touch);
    if (gameZoom.isActive()) gameZoom.beginPointer(directTouchZoomInput(contact));
    postDirectTouch("down", touch);
  });
}, { passive: false });

touchDirectSurface.addEventListener("touchmove", event => {
  if (!iosWebKitTouch) return;
  event.preventDefault();
  forEachChangedTouch(event, contact => {
    const touch = directTouchPointers.get(contact.identifier);
    if (!touch) return;
    const point = directTouchFramePoint(contact, gameZoom.isActive());
    if (!point) return;
    touch.x = point.x;
    touch.y = point.y;
    if (gameZoom.isActive()) gameZoom.movePointer(directTouchZoomInput(contact));
    postDirectTouch("move", touch);
  });
}, { passive: false });

const releaseIosDirectTouches = (event: TouchEvent) => {
  if (!iosWebKitTouch) return;
  event.preventDefault();
  forEachChangedTouch(event, contact => {
    const touch = directTouchPointers.get(contact.identifier);
    if (!touch) return;
    const point = directTouchFramePoint(contact, gameZoom.isActive());
    if (point) { touch.x = point.x; touch.y = point.y; }
    directTouchPointers.delete(contact.identifier);
    if (gameZoom.isActive()) gameZoom.endPointer(directTouchZoomInput(contact));
    postDirectTouch("up", touch);
  });
  if (!directTouchPointers.size) invalidateDirectTouchFrameRect();
};
touchDirectSurface.addEventListener("touchend", releaseIosDirectTouches, { passive: false });
touchDirectSurface.addEventListener("touchcancel", releaseIosDirectTouches, { passive: false });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cancelTransientTouchInput();
});
window.addEventListener("blur", () => {
  // Focusing our own Runtime iframe is not leaving the application.
  queueMicrotask(() => { if (!document.hasFocus()) cancelTransientTouchInput(); });
});
window.addEventListener("resize", invalidateDirectTouchFrameRect, { passive: true });
window.visualViewport?.addEventListener("resize", invalidateDirectTouchFrameRect, { passive: true });
document.addEventListener("fullscreenchange", invalidateDirectTouchFrameRect);
document.addEventListener("webkitfullscreenchange", invalidateDirectTouchFrameRect);

function setTouchFocus(value: boolean) {
  if (!state.launched || state.options.touchFocusMode === "two-finger") return;
  const enabled = !!value;
  if (touchControls.focusEnabled === enabled) return;
  touchControls.focusEnabled = enabled;
  renderTouchFocusState(false);
  refocusGameIfNeeded();
  pushTouchControlsLive();
}

const touchFocusButton = $("#touchFocus");
touchFocusButton.addEventListener("pointerdown", event => {
  if (iosWebKitTouch) return;
  if (!state.launched || state.options.touchFocusMode === "two-finger") return;
  event.preventDefault();
  try { touchFocusButton.setPointerCapture(event.pointerId); } catch {}
  if (state.options.touchFocusMode === "hold-button") void setTouchFocus(true);
  else void setTouchFocus(!touchControls.focusEnabled);
});
const releaseHeldTouchFocus = (event: PointerEvent) => {
  if (iosWebKitTouch) return;
  if (state.options.touchFocusMode !== "hold-button") return;
  event?.preventDefault?.();
  void setTouchFocus(false);
};
touchFocusButton.addEventListener("pointerup", releaseHeldTouchFocus);
touchFocusButton.addEventListener("pointercancel", releaseHeldTouchFocus);
touchFocusButton.addEventListener("lostpointercapture", releaseHeldTouchFocus);
touchFocusButton.addEventListener("touchstart", event => {
  if (!iosWebKitTouch || !state.launched || state.options.touchFocusMode === "two-finger") return;
  event.preventDefault();
  if (state.options.touchFocusMode === "hold-button") void setTouchFocus(true);
  else void setTouchFocus(!touchControls.focusEnabled);
}, { passive: false });
const releaseIosHeldTouchFocus = (event: TouchEvent) => {
  if (!iosWebKitTouch || state.options.touchFocusMode !== "hold-button") return;
  event.preventDefault();
  void setTouchFocus(false);
};
touchFocusButton.addEventListener("touchend", releaseIosHeldTouchFocus, { passive: false });
touchFocusButton.addEventListener("touchcancel", releaseIosHeldTouchFocus, { passive: false });
touchFocusButton.addEventListener("click", event => {
  if (event.detail !== 0 || !state.launched || state.options.touchFocusMode !== "toggle-button") return;
  void setTouchFocus(!touchControls.focusEnabled);
});

async function triggerTouchBomb() {
  touchControls.bombSerial++;
  refocusGameIfNeeded();
  pushTouchControlsLive();
}

async function triggerTouchEscape() {
  touchControls.escapeSerial++;
  refocusGameIfNeeded();
  pushTouchControlsLive();
}

const restartKeySpec = Object.freeze({ code: "KeyR", key: "r", keyCode: 82 });

function triggerTouchRestart() {
  if (!state.launched) return;
  const context = touchRuntimeMessageContext();
  postRuntimeHostedKey(context, restartKeySpec, true);
  setTimeout(() => postRuntimeHostedKey(context, restartKeySpec, false), 70);
  refocusGameIfNeeded();
}

const thpracKeySpecs = Object.freeze({
  Tab: Object.freeze({ code: "Tab", key: "Tab", keyCode: 9 }),
  Backspace: Object.freeze({ code: "Backspace", key: "Backspace", keyCode: 8 }),
  F1: Object.freeze({ code: "F1", key: "F1", keyCode: 112 }),
  F2: Object.freeze({ code: "F2", key: "F2", keyCode: 113 }),
  F3: Object.freeze({ code: "F3", key: "F3", keyCode: 114 }),
  F4: Object.freeze({ code: "F4", key: "F4", keyCode: 115 }),
  F5: Object.freeze({ code: "F5", key: "F5", keyCode: 116 }),
  F6: Object.freeze({ code: "F6", key: "F6", keyCode: 117 }),
  F7: Object.freeze({ code: "F7", key: "F7", keyCode: 118 })
});

type ThpracKeyName = keyof typeof thpracKeySpecs;
function isThpracKeyName(name: string | undefined): name is ThpracKeyName {
  return name !== undefined && Object.hasOwn(thpracKeySpecs, name);
}
function pulseThpracKey(name: string | undefined) {
  if (!thpracTouchControlsAvailable() || !state.launched) return;
  if (!isThpracKeyName(name)) return;
  const spec = thpracKeySpecs[name];
  if (!spec) return;
  postRuntimeHostedKey(touchRuntimeMessageContext(), spec, true);
  // OverlayKeyPressed samples at the fixed trainer tick. Hold the synthetic
  // key long enough to span several 60 Hz boundaries, then release it.
  setTimeout(() => postRuntimeHostedKey(touchRuntimeMessageContext(), spec, false), 70);
  refocusGameIfNeeded();
}

async function toggleThpracMouseMode() {
  if (!thpracTouchControlsAvailable() || !state.launched) return;
  thpracMouseMode = !thpracMouseMode;
  thpracMousePointerId = null;
  try { await send("touch-cancel", {}, 3000); } catch {}
  render();
  refocusGameIfNeeded();
}

touchThpracInput.addEventListener("pointerdown", event => {
  if (touchLayoutEditing || !state.launched) return;
  event.preventDefault();
  event.stopPropagation();
  void toggleThpracMouseMode();
});
touchThpracInput.addEventListener("click", event => {
  if (event.detail !== 0 || touchLayoutEditing || !state.launched) return;
  void toggleThpracMouseMode();
});
$("#touchThpracBackspace").addEventListener("pointerdown", event => {
  if (touchLayoutEditing || !state.launched) return;
  event.preventDefault();
  event.stopPropagation();
  pulseThpracKey("Backspace");
});
$("#touchThpracBackspace").addEventListener("click", event => {
  if (event.detail !== 0 || touchLayoutEditing || !state.launched) return;
  pulseThpracKey("Backspace");
});
document.querySelectorAll<HTMLElement>("[data-thprac-key]").forEach(button => {
  button.addEventListener("pointerdown", event => {
    if (touchLayoutEditing || !state.launched) return;
    event.preventDefault();
    event.stopPropagation();
    pulseThpracKey(button.dataset.thpracKey);
  });
  button.addEventListener("click", event => {
    if (event.detail !== 0 || touchLayoutEditing || !state.launched) return;
    pulseThpracKey(button.dataset.thpracKey);
  });
});

const touchActionButtons: Array<[HTMLButtonElement, () => void]> = [
  [$("#touchFire"), toggleTouchFire],
  [$("#touchBomb"), () => { void triggerTouchBomb(); }],
  [$("#touchEscape"), () => { void triggerTouchEscape(); }],
  [$("#touchRestart"), triggerTouchRestart],
];
for (const [button, activate] of touchActionButtons) {
  // Pointer-down is handled directly so the browser never transfers focus
  // from the running iframe to this outer control. A detail-0 click preserves
  // keyboard and assistive-technology activation without firing twice.
  button.addEventListener("pointerdown", event => {
    if (!state.launched) return;
    event.preventDefault();
    try { button.setPointerCapture(event.pointerId); } catch {}
    activate();
  });
  button.addEventListener("click", event => {
    if (event.detail !== 0 || !state.launched) return;
    activate();
  });
}

const touchJoystick = $("#touchJoystick");
const touchJoystickKnob = $("#touchJoystickKnob");
let touchJoystickPointerId: number | null = null;
let touchControlsSyncScheduled = false;
function queueTouchControlsSync() {
  if (touchControlsSyncScheduled || !state.launched) return;
  touchControlsSyncScheduled = true;
  requestAnimationFrame(() => {
    touchControlsSyncScheduled = false;
    pushTouchControlsLive();
  });
}
function resetTouchJoystick(sync = true) {
  touchJoystickPointerId = null;
  touchControls.joystickX = 0;
  touchControls.joystickY = 0;
  touchJoystickKnob.style.transform = "translate(-50%,-50%)";
  touchJoystick.classList.remove("active");
  if (sync) queueTouchControlsSync();
}
function cancelTransientTouchInput() {
  cancelDirectTouches(false);
  resetTouchJoystick(false);
  touchControls.focusEnabled = false;
  renderTouchFocusState(false);
  postRuntimeTouchCancel(touchRuntimeMessageContext());
  // Clear the parent snapshot too, so a queued RAF cannot restore stale input.
  // Fire is an intentional toggle and remains unchanged.
  pushTouchControlsLive();
}
function updateTouchJoystick(event: PointerEvent) {
  if (event.pointerId !== touchJoystickPointerId) return;
  const rect = touchJoystick.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxTravel = Math.max(1, Math.min(rect.width, rect.height) * .34);
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const distance = Math.hypot(dx, dy);
  const clamped = Math.min(distance, maxTravel);
  const ux = distance > 0 ? dx / distance : 0;
  const uy = distance > 0 ? dy / distance : 0;
  const visualX = ux * clamped;
  const visualY = uy * clamped;
  touchJoystickKnob.style.transform = `translate(calc(-50% + ${visualX}px),calc(-50% + ${visualY}px))`;

  // A small radial dead zone prevents an accidental direction when the thumb
  // is merely resting near center. Outside it, keep the full 360-degree vector
  // and publish it as signed stick axes; each game then applies its own original
  // controller-axis thresholds and records only the resulting direction bits.
  const radial = Math.min(1, distance / maxTravel);
  const deadZone = .16;
  const magnitude = radial <= deadZone ? 0 : (radial - deadZone) / (1 - deadZone);
  touchControls.joystickX = Math.round(ux * magnitude * 32767);
  touchControls.joystickY = Math.round(uy * magnitude * 32767);
  queueTouchControlsSync();
}
touchJoystick.addEventListener("pointerdown", event => {
  if (!state.launched || !touchMovementUsesJoystick(state.options.touchMovementMode) || touchJoystickPointerId != null) return;
  event.preventDefault();
  touchJoystickPointerId = event.pointerId;
  touchJoystick.classList.add("active");
  try { touchJoystick.setPointerCapture(event.pointerId); } catch {}
  updateTouchJoystick(event);
});
touchJoystick.addEventListener("pointermove", event => { if (touchJoystickPointerId != null) { event.preventDefault(); updateTouchJoystick(event); } });
const releaseTouchJoystick = (event: PointerEvent) => {
  if (event.pointerId !== touchJoystickPointerId) return;
  event.preventDefault();
  resetTouchJoystick(true);
};
touchJoystick.addEventListener("pointerup", releaseTouchJoystick);
touchJoystick.addEventListener("pointercancel", releaseTouchJoystick);
touchJoystick.addEventListener("lostpointercapture", releaseTouchJoystick);

for (const name of touchLayoutControlNames) {
  touchLayoutElement(name).addEventListener("pointerdown", event => beginTouchLayoutDrag(name, event));
}
const touchLayoutEditorDragHandle = $("#touchLayoutEditorDragHandle");
touchLayoutEditorDragHandle.addEventListener("pointerdown", beginTouchLayoutEditorDrag);
const touchLayoutSettingsDragHandle = $("#touchLayoutSettingsDragHandle");
touchLayoutSettingsDragHandle.addEventListener("pointerdown", beginTouchLayoutSettingsDrag);
const touchViewportDragSurface = $("#touchViewportDragSurface");
touchViewportDragSurface.addEventListener("pointerdown", beginTouchViewportDrag);
touchViewportDragSurface.addEventListener("pointermove", moveTouchViewportDrag);
touchViewportDragSurface.addEventListener("pointerup", endTouchViewportDrag);
touchViewportDragSurface.addEventListener("pointercancel", endTouchViewportDrag);
touchViewportDragSurface.addEventListener("lostpointercapture", endTouchViewportDrag);
player.addEventListener("pointerdown", beginTouchSensitivityPreview);
player.addEventListener("pointermove", moveTouchSensitivityPreview);
player.addEventListener("pointerup", endTouchSensitivityPreview);
player.addEventListener("pointercancel", endTouchSensitivityPreview);
player.addEventListener("lostpointercapture", endTouchSensitivityPreview);
document.addEventListener("pointermove", event => {
  moveTouchLayoutDrag(event);
  moveTouchLayoutEditorDrag(event);
  moveTouchLayoutSettingsDrag(event);
}, true);
document.addEventListener("pointerup", event => {
  endTouchLayoutDrag(event);
  endTouchLayoutEditorDrag(event);
  endTouchLayoutSettingsDrag(event);
}, true);
document.addEventListener("pointercancel", event => {
  endTouchLayoutDrag(event);
  endTouchLayoutEditorDrag(event);
  endTouchLayoutSettingsDrag(event);
}, true);
window.addEventListener("blur", cancelTouchLayoutGestures);
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelTouchLayoutGestures(); });
document.addEventListener("fullscreenchange", cancelTouchLayoutGestures);
const refreshTouchLayoutForViewport = () => {
  applyTouchLayout();
  if (touchLayoutEditing) applyTouchViewportDraftPosition();
  else if (state.launched) gameZoom.applyTransform();
  updatePlayerOrientationUi();
  if (touchLayoutEditing) updateTouchLayoutEditorUi();
  if (touchLayoutEditing && !touchViewportEditing) {
    if (touchLayoutWindowOrientation !== touchLayoutOrientation()) positionTouchLayoutWindows();
    else clampTouchLayoutEditorPosition();
  }
};
window.addEventListener("resize", refreshTouchLayoutForViewport, { passive: true });
window.visualViewport?.addEventListener("resize", refreshTouchLayoutForViewport, { passive: true });
screen.orientation?.addEventListener?.("change", refreshTouchLayoutForViewport);
if (typeof ResizeObserver === "function") new ResizeObserver(refreshTouchLayoutForViewport).observe(touchLayoutSafeZone);
document.querySelectorAll<HTMLElement>("[data-guide-tab]").forEach(tab => tab.addEventListener("click", () => {
  if (tab.getAttribute("aria-expanded") === "true") collapseTouchGuides();
  else if (tab.dataset.guideTab) playTouchGuide(tab.dataset.guideTab);
}));
document.querySelectorAll<HTMLButtonElement>(".guide-replay").forEach(button => button.addEventListener("click", () => {
  const panel = button.closest<HTMLElement>("[data-guide-panel]");
  if (panel?.dataset.guidePanel) playTouchGuide(panel.dataset.guidePanel);
}));
$("#touchHelpOpen").addEventListener("click", () => { collapseTouchGuides(); $("#touchHelp").hidden = false; player.classList.add("help-visible"); });
$("#touchHelpClose").addEventListener("click", closeTouchHelp);
$("#touchHelp").addEventListener("click", event => { if (event.target === $("#touchHelp")) closeTouchHelp(); });
$("#gamePackageImport").addEventListener("click", () => {
  beginManualGamePackageImport(
    t("package.manualImportIntro"),
    captureGameDataContinuation("install-only"),
  );
});
$("#launch").addEventListener("click", async () => {
  try {
    // Via and other mobile browsers can restore a BFCache/history entry with
    // the URL already moved to ?game=th07 while the in-memory state still
    // belongs to TH06.  Treat an explicit route as authoritative at launch so
    // a stale tab can never silently start the wrong runtime/local pack.
    syncSelectionFromPlayerRoute();
    if (!state.launched && importServer && !(await readCurrentPackageGeneration(state.game)).generation) {
      clearStartupError();
      setStatus(t("package.needImport"));
      beginImportAttempt();
      return;
    }
    if (!state.launched && !await confirmInputWarnings()) return;
    if (!state.launched) {
      // Make the real player visible before requestFullscreen so desktop
      // browsers can fullscreen the same element that will host the game.
      openPlayerView();
      try { await enterPlayerFullscreen({ focusGame: false }); }
      catch (error) { showToast(t("fullscreen.autoBlocked", { reason: errorMessage(error) })); }
      await launchConfiguredRuntime();
      if (isPlayerFullscreen()) await lockEscapeForGame();
    } else refocusGameIfNeeded();
  } catch (error) {
    if (!state.launched && isCancelledDownload(error)) {
      if (player.classList.contains("open")) {
        if (!await closePlayerView()) return;
      } else resetRuntime();
      beginManualGamePackageImport();
      setStatus(t("package.downloadCancelledImport"));
      return;
    }
    if (importServer && !state.launched && isResourceLoadFailure(error)) {
      const message = errorMessage(error);
      if (player.classList.contains("open")) {
        if (!await closePlayerView()) return;
      } else resetRuntime();
      beginImportAttempt();
      $("#gameDataImportReason").textContent = gameDataFallbackText(message);
      setStatus(message);
      showToast(message);
      return;
    }
    if (!state.launched && isResourceLoadFailure(error)) {
      const message = errorMessage(error);
      if (player.classList.contains("open")) {
        if (!await closePlayerView()) return;
      } else resetRuntime();
      beginManualGamePackageImport(
        t("package.resourceFailureLocal", { reason: message }),
        captureGameDataContinuation("launch"),
      );
      setStatus(t("package.resourceFailureStatus"));
      return;
    }
    const message = errorMessage(error);
    setPlayerStatus(message);
    showStartupError(error, `${state.game.toUpperCase()} / ${musicModeLabel(state.music)}`);
    showToast(message);
  }
});
const fullscreenToggle = $("#fullscreenToggle");
gameZoomToggle.addEventListener("click", event => {
  if (!state.launched) return;
  event.preventDefault();
  event.stopPropagation();
  resetGameZoomFromControl();
});
orientationToggle.addEventListener("click", event => {
  if (!state.launched) return;
  event.preventDefault();
  event.stopPropagation();
  void switchTouchLayoutOrientation();
});
fullscreenToggle.addEventListener("click", event => {
  if (!state.launched) return;
  event.preventDefault();
  event.stopPropagation();
  void togglePlayerFullscreen();
});
$("#transferRetry").addEventListener("click", async () => {
  $("#transferRetry").hidden = true;
  $("#transferWarning").textContent = t("transfer.retryingOgg");
  try { await send("retry-music", {}, 30 * 60 * 1000); }
  catch (error) { transferFailure({ failed: 1 }); setPlayerStatus(errorMessage(error)); }
});
$("#transferCancel").addEventListener("click", cancelBlockingNetworkOperation);
$("#gameDataImportClose").addEventListener("click", () => closeGameDataImportWindow(true));
$("#gameDataLinkClose").addEventListener("click", closeGameDataLinkWindow);
$("#gameDataFallbackUrl").addEventListener("click", event => {
  if (!gameDataFallback?.url || state.ready) return;
  event.stopPropagation();
  const opened = window.open(gameDataFallback.url, "_blank");
  if (opened) {
    opened.opener = null;
    event.preventDefault();
  }
});
$("#transferDownload").addEventListener("click", () => {
  if (!gameDataFallback || !gameDataAttempt?.unlocked || state.ready) return;
  syncTransientOverlayHost();
  updateGameDataLinkWindow();
  $("#gameDataLinkWindow").hidden = false;
});
$("#transferImport").addEventListener("click", () => {
  if (!gameDataAttempt?.unlocked || state.ready) return;
  $("#gameDataImportInput").click();
});
$("#gameDataImportInput").addEventListener("change", async () => {
  const input = $("#gameDataImportInput");
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file || !gameDataAttempt?.unlocked || state.ready) return;
  const button = $("#transferImport");
  button.disabled = true;
  setGameDataImportBusy(true, t("package.importing"));
  const attemptId = gameDataAttempt.id;
  try {
    const imported = await installImportedGameData(file);
    showToast(t("package.imported", { count: imported.files }));
    if (gameDataAttempt?.importFlow && !state.launched) {
      const continuation = gameDataAttempt.continuation;
      clearGameDataAttempt();
      if (continuationStillValid(continuation)) {
        setPlayerStatus(t("package.continuing"));
        resetRuntime();
        openPlayerView();
        await launchConfiguredRuntime();
        return;
      }
      setStatus(t("package.importedReady"));
      render();
      return;
    }
    if (state.ready) {
      setPlayerStatus(t("package.readyNextLaunch"));
      return;
    }
    if (gameDataAttempt?.id !== attemptId) return;
    setPlayerStatus(t("package.localLaunching"));
    resetRuntime();
    await launchConfiguredRuntime();
  } catch (error) {
    const message = errorMessage(error);
    setPlayerStatus(message);
    const storageFailure = /IndexedDB|存储|写入|配额|quota|浏览器已清理|持久化/i.test(message);
    $("#gameDataImportReason").textContent = importServer
      ? t("package.importServerMissing", { reason: message })
      : storageFailure
        ? t("package.importStorageFailed", { reason: message })
        : t("package.importInvalid", { reason: message });
    openGameDataImportWindow();
    showToast(message);
  } finally {
    setGameDataImportBusy(false);
    button.disabled = false;
  }
});

const touchPreview = new URLSearchParams(location.search).get("preview");
if (touchPreview === "touch" || touchPreview === "touch-hud") {
  state.options.touchEnabled = true;
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = touchPreview !== "touch";
  player.classList.toggle("help-visible", touchPreview === "touch");
}

try { state.lessMotion = localStorage.getItem(lessMotionStorageKey) === "1"; } catch {}
state.mobileOpen = mobileDevice || document.documentElement.clientWidth <= 780;
mpUiState.displayName = multiplayerIdentity.loadDisplayName();
for (const [name, open] of Object.entries(mpUiState.folds)) if (isMpFoldName(name)) mpSetFold(name, open);
if (mpRestoreRoomFromLocation()) {
  renderMpRoom();
  mpConnectLobby();
}
if (!mpUiState.room && !state.launched && !matchesCardFilter(state.product)) state.hasSelection = false;
render(); setTranslatedStatus("status.selectGame");
animateMobileHomeCards();
bootWatchdog?.ready?.();
const launcherRoomRoute = !!mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
if (!launcherRoomRoute && !debugHarness && !touchPreview) {
  void firstUseNotice.maybeShowAutomatically().then(shown => {
    if (!shown) void siteNotice.load();
  });
} else if (!launcherRoomRoute) {
  void siteNotice.load();
}
