import { prepareRuntimeLaunch } from "./runtime-launch.mjs";
import { createRoomNetwork } from "./room-network.mjs";
import { recommendMultiplayerInputTiming } from "./multiplayer-input-timing.mjs";
import { initializeGameLibrary } from "./game-library.mjs";
import { PACKAGE_DESCRIPTOR_SCHEMA } from "../../package/package-descriptor.mjs";
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
  resolvePreferredGameLanguage,
  resolveLanguagePackSource,
  selectLanguageEntry,
  thpracLocaleForLanguage,
} from "./language-catalog.mjs";
import { createNetworkActivityTracker } from "./network-activity.mjs";
import { loadOfflineLanguageIndex, rememberOfflineLanguage } from "./offline-language-index.mjs";
import {
  createRawDataImportPackageDescriptor,
  rawDataImportHashMatches,
  rawDataImportMatchesFileName,
  rawDataImportSizeMatches,
} from "./raw-data-import.mjs";
import {
  HOST_PROTOCOL,
  DEFAULT_MULTIPLAYER_PRODUCT_ID,
  DEFAULT_PRODUCT_ID,
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
import {
  RUNTIME_EPOCH_QUERY_PARAMETER,
  TOUCH_SENSITIVITY_MAX,
  TOUCH_SENSITIVITY_MIN,
  isRuntimeResponseMessage,
  parseRuntimeInboundMessage,
} from "../contracts/runtime-protocol.mjs";
import type { RuntimeConfigureOptions } from "../contracts/runtime-protocol.mjs";
import { loadRemoteMetadata } from "./remote-metadata.mjs";
import { getUiLocale, initUiLocale, isUiMessageKey, t } from "./i18n.mjs";
import type { UiMessageKey } from "./i18n.mjs";
import { discouragedBrowserId } from "./browser-support.mjs";
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
  postTouchCancel as postRuntimeTouchCancel,
  postTouchControls as postRuntimeTouchControls,
  deliverRuntimeInput,
} from "./touch-runtime-protocol.mjs";
import { createGameZoomController } from "./game-zoom.mjs";
import { HostedKeyboard } from "./hosted-keyboard.mjs";
import type { GameZoomPointerInput } from "./game-zoom.mjs";
import {
  appendRttSample,
  compactDiagnosticText,
  compactNetplayPeerStatus,
  compactRendererLabel,
  describeBrowserEnvironment,
  describeNetplayConnection,
  runtimeDiagnosticsVisibleByDefault,
  selectedRtcPair,
} from "./runtime-diagnostics-model.mjs";
import {
  createMultiplayerIdentityStore,
  multiplayerMemberId,
  multiplayerDisplayInitial,
  normalizeMultiplayerDisplayName as mpNormalizeDisplayName,
} from "./multiplayer-identity.mjs";
import { normalizeMultiplayerLobbySnapshot } from "./multiplayer-lobby-snapshot.mjs";
import {
  createMultiplayerPreferenceStore,
} from "./multiplayer-preferences.mjs";
import {
  buildMultiplayerDiagnosticRelayUrl,
  buildMultiplayerGameplayRelayUrl,
  buildMultiplayerLobbyRelayUrl,
} from "./multiplayer-relay-url.mjs";
import { buildMultiplayerRuntimeOptions } from "./multiplayer-runtime-options.mjs";
import { createMultiplayerRoomSessionStore } from "./multiplayer-room-session.mjs";
import {
  MP_ROOM_HISTORY_KEY as mpRoomHistoryKey,
  MP_PANEL_HISTORY_KEY as mpPanelHistoryKey,
  MP_SETTINGS_HISTORY_KEY as mpSettingsHistoryKey,
  MP_ROOM_URL_KEY as mpRoomUrlKey,
  PLAYER_HISTORY_KEY as playerHistoryKey,
  TOUCH_LAYOUT_HISTORY_KEY as touchLayoutHistoryKey,
  applyHistoryOperations,
  directRoomHistorySeed,
  initialRoutedHistoryOperations,
  launcherHomeHistoryOperation,
  launcherOptionsHistoryOperation,
  normalizeRoomCode as mpNormalizeRoomCode,
  playerRouteHistoryOperation,
  returnToRoomHistoryOperation,
  roomRouteHistoryOperation,
  roomPanelHistoryOperation,
  roomSettingsHistoryOperation,
  routedProductFromUrl,
  touchLayoutEditorHistoryOperation,
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

type PackageFeatureModule = typeof import("./package-feature.mjs");
type ReplayFeatureModule = typeof import("./replay-files.mjs");
type NetworkDiagnosticsModule = typeof import("./network-diagnostics.mjs");
type MultiplayerGuideModule = typeof import("./multiplayer-guide.mjs");

let packageFeaturePromise: Promise<PackageFeatureModule> | null = null;
let replayFeaturePromise: Promise<ReplayFeatureModule> | null = null;
let networkDiagnosticsPromise: Promise<NetworkDiagnosticsModule> | null = null;
let multiplayerGuidePromise: Promise<MultiplayerGuideModule> | null = null;

function loadPackageFeature(): Promise<PackageFeatureModule> {
  return packageFeaturePromise ??= import("./package-feature.mjs");
}
function loadReplayFeature(): Promise<ReplayFeatureModule> {
  return replayFeaturePromise ??= import("./replay-files.mjs");
}
function loadNetworkDiagnostics(): Promise<NetworkDiagnosticsModule> {
  return networkDiagnosticsPromise ??= import("./network-diagnostics.mjs");
}
function loadMultiplayerGuide(): Promise<MultiplayerGuideModule> {
  return multiplayerGuidePromise ??= import("./multiplayer-guide.mjs");
}
async function installPublishedPackageLazy(...args: Parameters<PackageFeatureModule["installPublishedPackage"]>) {
  return (await loadPackageFeature()).installPublishedPackage(...args);
}

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
let appShellUpdateNoticeStartedAt: number | null = null;
let appShellUpdateNoticeTimer: number | null = null;
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

class RuntimeSwitchedError extends Error {
  constructor() {
    super(t("runtime.switched"));
    this.name = "RuntimeSwitchedError";
  }
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
  const payload = typeof message.name === "string"
    ? { ...message, name: multiplayerDisplayInitial(message.name, "") }
    : message;
  mpLobby.socket.send(JSON.stringify(payload));
  return true;
}

function runtimeResourceFileIds(descriptor: InstalledPackageGeneration["descriptor"]): string[] {
  const ids: string[] = [];
  for (const componentId of Object.keys(descriptor.components || {})) {
    if (descriptor.components?.[componentId]?.type !== "resource") continue;
    ids.push(...componentFileIds(descriptor, componentId));
  }
  return [...new Set(ids)];
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
  const materialize = (fileId: string) => {
    if (runtimeOwned.has(fileId) || fileId === generation.descriptor.runtimeRequirement?.dataFile ||
        !generation.files?.[fileId]?.objectId) return;
    const declaration = generation.descriptor.files[fileId];
    if (!declaration) return;
    // Old generations may still declare executable Runtime files. They are
    // migration input only and must never be materialized into the live FS.
    if (/\.(?:html|m?js|wasm)$/i.test(declaration.source || "")) return;
    resources.push({ fileId, path: declaration.target, size: Number(declaration.bytes) || 0 });
  };
  for (const fileId of generation.descriptor.base?.files || []) materialize(fileId);
  // TH20's retail BGM (thbgm.dat -> /game/thbgm.dat) is a standalone resource
  // component, not a base file, so it is delivered to the Runtime FS through
  // the same managed channel as shared fonts once its object is installed.
  for (const fileId of runtimeResourceFileIds(generation.descriptor)) materialize(fileId);
  return resources;
}

// Remote resource components are only advertised when the deployment actually
// owns them (self-hosted). External deployments keep retail content manual and
// rely on the installed Package Store, so no absent URL is requested.
function selectedRuntimeResources(): Array<{ url: string; path: string; size: number }> {
  if (manifest.shared?.resourceMode !== "hosted") return [];
  const generation = activeInstalledPackageGeneration;
  if (!generation || !releaseCatalog?.games?.[state.game]) return [];
  const ids = runtimeResourceFileIds(generation.descriptor).filter(fileId => !generation.files?.[fileId]?.objectId);
  if (!ids.length) return [];
  const descriptorUrl = releaseCatalogEntryUrl(releaseCatalogUrl, releaseCatalog, state.game);
  if (!descriptorUrl) throw new Error(t("music.packageUrlInvalid"));
  return ids.map(fileId => {
    const declaration = generation.descriptor.files[fileId];
    if (!declaration || typeof declaration.source !== "string" || typeof declaration.target !== "string") {
      throw new Error(t("music.packageResourceInvalid"));
    }
    return { url: new URL(declaration.source, descriptorUrl).href, path: declaration.target, size: Number(declaration.bytes) || 0 };
  });
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
    playerCounts: mpPlayerCounts(),
    difficulties: game().multiplayer?.difficulties || [],
    loadouts: mpLoadouts(),
  });
  if (!normalized) return;
  mpUiState.room.synced = true;
  mpUiState.room.connection = "connected";
  mpUiState.room.playerCount = normalized.playerCount;
  mpUiState.room.difficulty = normalized.difficulty;
  mpUiState.room.inputDelay = normalized.inputDelay;
  mpUiState.room.predictionLimit = normalized.predictionLimit;
  const movementPolicyChanged = !mpUiState.room.disableCheatMovement && normalized.disableCheatMovement;
  mpUiState.room.visibility = normalized.visibility;
  mpUiState.room.disableCheatMovement = normalized.disableCheatMovement;
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
    reportedResourceKey = "";
  }
  renderMpRoom();
  if (movementPolicyChanged && normalized.localSeat != null) void mpEnsureMovementAllowed();
}

function mpDisconnectLobby() {
  roomNetwork.reset();
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

let mpLobbyIntent = new URL(location.href).searchParams.get("lobbyAction") || "";
let mpDirectoryAutoSeat = new URL(location.href).searchParams.get("fromLobby") === "1" && mpLobbyIntent === "join";
let mpLobbyStopped = false;
let mpDirectorySupported = false;
let mpControlModesSupported = false;
function mpConnectLobby(reconnecting = false) {
  const room = mpUiState.room;
  if (!room || mpLobbyStopped || typeof WebSocket !== "function") return;
  mpLobby.clientId = multiplayerIdentity.lobbyClientId(isMultiplayerProduct(state.product) ? state.product : DEFAULT_MULTIPLAYER_PRODUCT_ID);
  let lobbyRelay;
  try {
    lobbyRelay = buildMultiplayerLobbyRelayUrl(state.netplay.url, {
      product: state.product,
      roomCode: room.code,
      clientId: mpLobby.clientId,
      memberId: multiplayerMemberId(),
      intent: mpLobbyIntent,
      visibility: room.visibility,
      disableCheatMovement: room.disableCheatMovement,
      playerCount: room.playerCount,
      difficulty: room.difficulty,
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
  mpDirectorySupported = false;
  mpControlModesSupported = false;
  roomNetwork.reset(reconnecting);
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
      mpLobbySend({
        type: "take-seat", seat: mpUiState.seat, loadout: mpUiState.preferredLoadout,
        ready: mpUiState.ready, name: mpUiState.displayName,
        movementMode: state.options.touchMovementMode, touchEnabled: state.options.touchEnabled,
        mobileDevice: mobileDevice || state.options.touchEnabled,
      });
      if (mpUiState.seat === 0 && !(room.disableCheatMovement && state.options.touchMovementMode === "touch-unlimited")) mpSendRoomSettings();
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
    if (message.type === "room-probe-config" || message.type === "room-probe") {
      void roomNetwork.receive(message);
      return;
    }
    if (message.type === "state") {
      if (record(message.roomDirectory)?.version === 1) mpDirectorySupported = true;
      if (record(message.roomDirectory)?.controlModes === true) mpControlModesSupported = true;
      mpLobbyIntent = "join";
      const route = new URL(location.href);
      if (route.searchParams.has("lobbyAction")) {
        route.searchParams.delete("lobbyAction");
        route.searchParams.delete("lobbyPlayers");
        route.searchParams.delete("lobbyDifficulty");
        route.searchParams.delete("lobbyVisibility");
        route.searchParams.delete("lobbyDisableCheatMovement");
        history.replaceState(history.state, "", route);
      }
      const probe = record(message.roomProbe);
      if (probe) void roomNetwork.receive({ type: "room-probe-config", iceServers: probe.iceServers });
      // The relay snapshot is authoritative for the current room generation.
      // This also prevents a serial remembered from a previous, deleted room
      // with the same code from suppressing the next start event.
      mpLobby.startSerial = Math.max(0, Number(record(message.room)?.startSerial) || 0);
      mpApplyLobbyRoom(message.room);
      if (mpDirectoryAutoSeat) {
        mpDirectoryAutoSeat = false;
        const joinedRoom = mpUiState.room;
        const emptySeat = joinedRoom?.seats?.slice(0, joinedRoom.playerCount).findIndex(seat => !seat) ?? -1;
        if (mpUiState.seat == null && emptySeat >= 0) mpTakeSeat(emptySeat);
      }
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
      if (message.code === "movement-policy") {
        const seat = Number(message.seat);
        if (mpUiState.room) mpUiState.room.disableCheatMovement = true;
        void mpEnsureMovementAllowed().then(ok => {
          if (ok && mpUiState.seat == null && Number.isInteger(seat)) void mpTakeSeat(seat);
        });
        return;
      }
      showToast(String(message.error));
    }
  });
  socket.addEventListener("close", event => {
    if (mpLobby.socket !== socket) return;
    roomNetwork.reset(true);
    mpLobby.socket = null;
    mpLobby.connected = false;
    if ([4004, 4007, 4008, 4009, 4010].includes(event.code)) {
      mpLobbyStopped = true;
      const explanation = t(event.code === 4004 ? "lobby.expired" : event.code === 4008 ? "lobby.replaced" : event.code === 4009 ? "lobby.conflict" : event.code === 4010 ? "lobby.removed" : "lobby.gone");
      if (!state.launched) {
        mpResetRoomState();
        if (mpFromDirectory()) {
          try { sessionStorage.setItem("eagler-lobby-message", explanation); } catch {}
          mpReturnToDirectory();
          return;
        }
        applyHistoryOperations(history, [launcherOptionsHistoryOperation({ currentUrl: location.href, currentState: history.state, product: state.product })]);
        state.hasSelection = true;
        render();
      }
      showToast(explanation);
      return;
    }
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
let th09RoomHome: { parent: Node; next: Node | null } | null = null;
type RoomPreparation = {
  room: NonNullable<MultiplayerUiState["room"]>;
  game: GameId;
  controller: AbortController;
  tracker: ReturnType<typeof createNetworkActivityTracker>;
  stage: "package" | "runtime";
  status: "preparing" | "ready" | "failed" | "cancelled" | "importing";
  error: string;
  task: Promise<void>;
};
let roomPreparation: RoomPreparation | null = null;
let reportedResourceSocket: WebSocket | null = null;
let reportedResourceKey = "";

function prepareRoomResources(room = mpUiState.room): Promise<void> {
  if (!room) return Promise.resolve();
  if (roomPreparation?.room === room && roomPreparation.game === state.game) return roomPreparation.task;
  const gameId = state.game;
  const controller = new AbortController();
  const preparation: RoomPreparation = { room, game: gameId, controller,
    tracker: createNetworkActivityTracker({ onChange: scheduleRoomPreparationProgress }),
    stage: "package", status: "preparing", error: "", task: Promise.resolve() };
  roomPreparation = preparation;
  reportedResourceKey = "";
  renderMpRoom();
  preparation.task = (async () => {
    let installed = await readCurrentPackageGeneration(gameId);
    if (!installed?.generation) {
      if (!releaseCatalog) { try { await remoteReleasePromise; } catch {} }
      if (!releaseCatalog?.games?.[gameId]) throw new Error(t("package.releaseNotReadyNoLocal", { game: gameId.toUpperCase() }));
      let result;
      try {
        result = await installPublishedPackageLazy(gameId, {
          catalog: releaseCatalog,
          catalogUrl: releaseCatalogUrl,
          addComponents: [],
          fetchImpl: (input, init) => preparation.tracker.xhrFetch(input, init, packageNetworkMeta(gameId, input)),
          signal: controller.signal,
        });
      } catch (error) {
        if (isCancelledDownload(error)) throw error;
        throw new GameDataAcquisitionError(errorMessage(error), { cause: error });
      }
      if (result.generation) installedPackageSnapshots.set(gameId, result.generation);
      installed = await readCurrentPackageGeneration(gameId);
      if (!installed?.generation) throw new Error(t("package.objectNotPersisted"));
    }
    if (controller.signal.aborted || mpUiState.room !== room) return;
    installedPackageSnapshots.set(gameId, installed.generation);
    preparation.stage = "runtime";
    renderRoomPreparationProgress();
    if (!hostManifestAvailable) { try { await remoteReleasePromise; } catch {} }
    if (controller.signal.aborted || mpUiState.room !== room) return;
    const runtime = game(gameId).multiplayerRuntime;
    if (typeof runtime === "string" && runtime && "runtimeManifest" in manifest.shared && manifest.shared.runtimeManifest) {
      let worker: ServiceWorker | null = null;
      try {
        await appShellClient?.ready;
        worker = (await navigator.serviceWorker?.getRegistration("./"))?.active || null;
      } catch {}
      // Without a worker, preparation uses no-store HTTP and would download
      // the same Runtime again at launch, with no reusable cache benefit.
      if (worker) await prepareRuntimeLaunch(runtime, { worker });
    }
    if (controller.signal.aborted || mpUiState.room !== room) return;
    preparation.status = "ready";
    renderRoomPreparationProgress();
  })().catch(error => {
    if (controller.signal.aborted || mpUiState.room !== room) return;
    preparation.status = "failed";
    preparation.error = errorMessage(error);
    renderRoomPreparationProgress();
    if (isResourceLoadFailure(error)) {
      beginManualGamePackageImport(preparation.error, captureGameDataContinuation("install-only"));
    } else {
      showToast(preparation.error, 4000);
    }
  }).finally(() => {
    if (mpUiState.room === room) renderMpRoom();
  });
  return preparation.task;
}

function th09NetworkOverlayOpen() { return !$("#th09NetworkDialog").hidden; }

function th09CloseNetworkOverlay(resume: boolean) {
  const dialog = $("#th09NetworkDialog");
  if (dialog.hidden) return;
  dialog.hidden = true;
  player.classList.remove("th09-network-open");
  $("#th09NetworkEntry").hidden = false;
  $("#th09NetworkRoom").hidden = true;
  const roomView = $("#mpRoomView");
  if (th09RoomHome) {
    if (th09RoomHome.next?.parentNode === th09RoomHome.parent)
      th09RoomHome.parent.insertBefore(roomView, th09RoomHome.next);
    else th09RoomHome.parent.appendChild(roomView);
    th09RoomHome = null;
  }
  if (resume && state.launched) void send("network-cancel", {}).catch(error => showToast(errorMessage(error)));
}

function th09OpenNetworkOverlay() {
  if (!game().multiplayer?.titleRoomEntry || isMultiplayerProduct() || !state.launched) return;
  if (!state.netplay.url) {
    showToast(t("multiplayer.serviceMissing"));
    void send("network-cancel", {}).catch(() => {});
    return;
  }
  $("#th09NetworkDialog").hidden = false;
  player.classList.add("th09-network-open");
  $("#th09NetworkEntry").hidden = false;
  $("#th09NetworkRoom").hidden = true;
  $("#th09NetworkCode").value = "";
  $("#th09NetworkCreate").focus();
}

function th09EnterNetworkRoom(code: string, created: boolean) {
  if (!th09NetworkOverlayOpen() || !state.launched) return;
  const product = multiplayerProductIdForGame(state.game);
  if (!product) return;
  state.product = product;
  state.hasSelection = true;
  restoreMpProductPreferences(product);
  const roomView = $("#mpRoomView");
  th09RoomHome = { parent: roomView.parentNode!, next: roomView.nextSibling };
  $("#th09NetworkRoom").append(roomView);
  $("#th09NetworkEntry").hidden = true;
  $("#th09NetworkRoom").hidden = false;
  mpEnterRoom(code, created);
}

function th09LeaveNetworkRoom() {
  mpResetRoomState();
  state.product = state.game;
  state.runtimeVariant = "normal";
  const url = new URL(location.href);
  url.searchParams.set("game", state.game);
  url.searchParams.delete(mpRoomUrlKey);
  history.replaceState(history.state, "", url);
  th09CloseNetworkOverlay(true);
  render();
}

let roomLaunchHome: { parent: Node; next: Node | null } | null = null;
let roomLaunchStage: "runtime" | "path" = "runtime";
function showRoomLaunchCover() {
  if (roomLaunchHome || !mpUiState.room) return;
  if (roomPanel.open) roomPanel.close();
  setMpSettingsRoomDrawerOpen(false, true);
  const roomView = $("#mpRoomView");
  roomLaunchHome = { parent: roomView.parentNode!, next: roomView.nextSibling };
  player.append(roomView);
  player.classList.add("mp-room-launch-cover");
  roomLaunchStage = "runtime";
}
function hideRoomLaunchCover() {
  if (!roomLaunchHome) return;
  const roomView = $("#mpRoomView");
  const { parent, next } = roomLaunchHome;
  if (next?.parentNode === parent) parent.insertBefore(roomView, next);
  else parent.appendChild(roomView);
  roomLaunchHome = null;
  player.classList.remove("mp-room-launch-cover");
}
async function waitForGameplayPath(room: NonNullable<MultiplayerUiState["room"]>, timeoutMs = 120_000) {
  // Room probes use separate channels. Only the launched Runtime can confirm
  // the route actually selected for gameplay (RTC or relay).
  const deadline = performance.now() + timeoutMs;
  while (mpUiState.room === room && state.launched && performance.now() < deadline) {
    const net = runtimeNetplaySnapshot();
    if (net?.failed) throw new Error(net.error || t("room.unavailable"));
    if (net?.peerState) {
      const view = describeNetplayConnection({
        spectator: net.spectator, failed: net.failed, error: net.error,
        transport: net.transport, path: net.path, peerState: net.peerState,
        playerCount: state.netplay.playerCount, localPlayer: state.netplay.player,
        webSocketOpenState: WebSocket.OPEN,
      });
      if (view.hidden) return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (mpUiState.room !== room || !state.launched) throw new RuntimeSwitchedError();
  throw new Error(t("room.gameplayPathTimeout"));
}

async function mpLaunchRoomGame() {
  if (mpLaunchInFlight || (state.launched && !th09NetworkOverlayOpen())) return;
  mpLaunchInFlight = true;
  try {
    const room = mpUiState.room;
    await prepareRoomResources(room);
    if (!room || mpUiState.room !== room) return;
    if (roomPreparation?.room === room && ["cancelled", "importing"].includes(roomPreparation.status)) return;
    if (mpUiState.seat != null && !await mpEnsureMovementAllowed()) return;
    if (mpUiState.room !== room) return;
    const fromTh09Overlay = th09NetworkOverlayOpen();
    if (fromTh09Overlay && mpUiState.seat != null && !await confirmInputWarnings()) return;
    if (mpUiState.room !== room) return;
    if (fromTh09Overlay) {
      await send("sync", {}, 10000);
      th09CloseNetworkOverlay(false);
      resetRuntime();
    }
    if (mpUiState.room !== room) return;
    mpConfigureRuntimeSession();
    if (!fromTh09Overlay && mpUiState.seat != null && !await confirmInputWarnings()) return;
    if (mpUiState.room !== room) return;
    // WebKit may require a tap on the Runtime's own start surface. Do not
    // cover that gesture gate with the room while waiting for its first frame.
    const coverUntilReady = !fromTh09Overlay && !iosWebKitTouch;
    if (coverUntilReady) showRoomLaunchCover();
    openPlayerView();
    try { await enterPlayerFullscreen({ focusGame: false }); }
    catch (error) { showToast(t("fullscreen.autoBlocked", { reason: errorMessage(error) })); }
    await launchConfiguredRuntime({ awaitFirstFrame: coverUntilReady });
    if (coverUntilReady) {
      roomLaunchStage = "path";
      renderMpRoom();
      await waitForGameplayPath(room);
    }
    hideRoomLaunchCover();
    if (isPlayerFullscreen()) await lockEscapeForGame();
  } catch (error) {
    if (error instanceof RuntimeSwitchedError) { hideRoomLaunchCover(); return; }
    if (!state.launched && isCancelledDownload(error)) {
      hideRoomLaunchCover();
      if (player.classList.contains("open")) {
        if (!await closePlayerView()) return;
      } else resetRuntime();
      setStatus(t("runtime.downloadCancelled"));
      return;
    }
    if (!state.launched && isResourceLoadFailure(error)) {
      hideRoomLaunchCover();
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
    if (roomLaunchHome && player.classList.contains("open")) {
      await closePlayerView(false, { skipSync: true, returnToMpRoom: true });
    } else hideRoomLaunchCover();
    const message = errorMessage(error);
    setPlayerStatus(message);
    setStatus(message);
    showStartupError(error, mpUiState.seat == null ? t("runtime.multiplayerContext", { game: state.game.toUpperCase() }) : t("runtime.multiplayerPlayerContext", { game: state.game.toUpperCase(), player: mpUiState.seat + 1 }));
    showToast(message);
  } finally {
    hideRoomLaunchCover();
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
    await prepareRoomResources(room);
    if (mpUiState.room !== room) return;
    if (roomPreparation?.room === room && ["cancelled", "importing"].includes(roomPreparation.status)) return;
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
    if (error instanceof RuntimeSwitchedError) return;
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
  const updateVisible = appShell?.updateWaiting === true || appShell?.updateReady === true;
  if (updateVisible && appShellUpdateNoticeStartedAt == null) appShellUpdateNoticeStartedAt = Date.now();
  if (!updateVisible) {
    appShellUpdateNoticeStartedAt = null;
    if (appShellUpdateNoticeTimer != null) window.clearTimeout(appShellUpdateNoticeTimer);
    appShellUpdateNoticeTimer = null;
  }
  const updateSeconds = appShellUpdateNoticeStartedAt == null
    ? 0 : Math.max(0, Math.floor((Date.now() - appShellUpdateNoticeStartedAt) / 1000));
  let text = "";
  let kind = "";
  if (appShell?.activationPending) {
    kind = "update";
    text = t("status.applyingSiteUpdate", { seconds: updateSeconds });
  } else if (appShell?.updateWaiting) {
    kind = "update";
    text = state.launched === true
      ? t("status.siteUpdateAfterExit", { seconds: updateSeconds })
      : shouldDeferAppShellReload()
        ? t("status.siteUpdateAfterOperation", { seconds: updateSeconds })
        : t("status.siteUpdateWaiting", { seconds: updateSeconds });
  } else if (appShell?.updateReady) {
    kind = "update";
    text = state.launched === true
      ? t("status.siteUpdateAfterExit", { seconds: updateSeconds })
      : shouldDeferAppShellReload()
        ? t("status.siteUpdateAfterOperation", { seconds: updateSeconds })
        : t("status.applyingSiteUpdate", { seconds: updateSeconds });
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
  if (kind === "update" && appShellUpdateNoticeTimer == null) {
    appShellUpdateNoticeTimer = window.setTimeout(() => {
      appShellUpdateNoticeTimer = null;
      renderServerStatusNote();
    }, 1000);
  }
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
    decisionOpen: document.querySelector<HTMLDialogElement>("dialog[open]") != null,
    replayOpen: document.querySelector<HTMLDialogElement>("#replayDialog")?.open === true,
  });
}

appShellClient = createAppShellClient({
  shouldDeferReload: shouldDeferAppShellReload,
  onChange: snapshot => {
    document.body.classList.toggle("app-shell-activation-pending", snapshot.activationPending);
    renderServerStatusNote(snapshot);
  },
});
void appShellClient.ready.then(() => {
  if (navigator.serviceWorker?.controller) return loadAppliedAppShellUpdateTime();
});
function maybeApplyDeferredAppShellUpdate() {
  queueMicrotask(() => {
    appShellClient?.maybeReload();
    void appShellClient?.maybeActivateWaiting();
  });
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
let roomProgressRenderQueued = false;
function scheduleRoomPreparationProgress() {
  if (roomProgressRenderQueued) return;
  roomProgressRenderQueued = true;
  requestAnimationFrame(() => {
    roomProgressRenderQueued = false;
    renderRoomPreparationProgress();
  });
}
function renderRoomPreparationProgress() {
  const panel = document.getElementById("mpRoomResourceProgress");
  if (!panel) return;
  const preparation = roomPreparation?.room === mpUiState.room ? roomPreparation : null;
  panel.hidden = !mpUiState.room;
  if (panel.hidden) return;
  const status = preparation?.status || "preparing";
  panel.dataset.status = status;
  panel.title = status === "failed" ? preparation?.error || "" : "";
  const track = $("#mpRoomResourceTrack");
  const cancel = $("#mpRoomResourceCancel");
  const retry = $("#mpRoomResourceRetry");
  cancel.hidden = status !== "preparing" || preparation?.stage !== "package";
  retry.hidden = status !== "failed" && status !== "cancelled";
  track.hidden = false;
  if (status !== "preparing") {
    $("#mpRoomResourceLabel").textContent = t(status === "ready" ? "room.resourcesReady" :
      status === "cancelled" ? "room.resourcesCancelled" :
        status === "importing" ? "package.importingSimple" : "room.resourcesUnavailable");
    $("#mpRoomResourceAmount").textContent = "";
    track.classList.toggle("indeterminate", status === "importing");
    $("#mpRoomResourceFill").style.width = status === "ready" ? "100%" : "0%";
    if (status === "ready") track.setAttribute("aria-valuenow", "100");
    else track.removeAttribute("aria-valuenow");
  } else {
    const snapshot = preparation?.tracker.snapshot();
    const current = snapshot?.active.at(-1);
    const total = current?.total || 0;
    const loaded = current?.loaded || 0;
    $("#mpRoomResourceLabel").textContent = preparation?.stage === "runtime"
      ? t("room.preparingRuntime") : current?.title || t("room.preparingResources");
    $("#mpRoomResourceAmount").textContent = total > 0
      ? `${networkMiB(loaded)} / ${networkMiB(total)}` : loaded > 0 ? networkMiB(loaded) : "";
    track.classList.toggle("indeterminate", total <= 0);
    if (total > 0) {
      const percent = Math.min(100, loaded / total * 100);
      $("#mpRoomResourceFill").style.width = `${percent.toFixed(1)}%`;
      track.setAttribute("aria-valuenow", String(Math.round(percent)));
    } else {
      $("#mpRoomResourceFill").style.removeProperty("width");
      track.removeAttribute("aria-valuenow");
    }
  }
  if (preparation && mpUiState.seat != null && mpLobby.connected && mpLobby.socket?.readyState === WebSocket.OPEN) {
    const current = status === "preparing" && preparation.stage === "package"
      ? preparation.tracker.snapshot().active.at(-1) : null;
    const percent = status === "ready" ? 100 : status === "preparing" && current?.total
      ? Math.min(100, Math.floor(current.loaded / current.total * 20) * 5) : null;
    const resource = { status, stage: preparation.stage, percent };
    const key = JSON.stringify(resource);
    if (reportedResourceSocket !== mpLobby.socket || reportedResourceKey !== key) {
      if (mpLobbySend({ type: "resource-progress", ...resource })) {
        reportedResourceSocket = mpLobby.socket;
        reportedResourceKey = key;
      }
    }
  }
  renderRoomSeatResourceProgress();
}

function renderRoomSeatResourceProgress() {
  const room = mpUiState.room;
  document.querySelectorAll<HTMLElement>("[data-mp-seat]").forEach(seat => {
    const index = Number(seat.dataset.mpSeat);
    const occupant = room?.seats?.[index];
    let resource = seat.querySelector<HTMLElement>(".mp-seat-resource");
    if (!resource) {
      resource = document.createElement("div");
      resource.className = "mp-seat-resource";
      resource.innerHTML = '<span class="mp-seat-resource-label"></span><span class="mp-seat-resource-track"><span></span></span>';
      seat.append(resource);
    }
    const local = index === mpUiState.seat && roomPreparation?.room === room ? roomPreparation : null;
    const current = local?.tracker.snapshot().active.at(-1);
    const progress = local ? {
      status: local.status, stage: local.stage,
      percent: local.status === "ready" ? 100 : local.status === "preparing" && current?.total
        ? Math.round(current.loaded / current.total * 100) : null,
    } : occupant?.resource;
    resource.hidden = !occupant || !progress;
    if (resource.hidden || !progress) return;
    resource.dataset.status = progress.status;
    const label = resource.querySelector<HTMLElement>(".mp-seat-resource-label")!;
    label.textContent = progress.status === "ready" ? t("room.resourcesReady") :
      progress.status === "failed" ? t("room.resourcesUnavailable") :
        progress.status === "cancelled" ? t("room.resourcesCancelled") :
          progress.status === "importing" ? t("package.importingSimple") :
          progress.stage === "runtime" ? t("room.preparingRuntime") :
            progress.percent == null ? t("room.preparingResources") : t("room.peerDownloading", { percent: progress.percent });
    const bar = resource.querySelector<HTMLElement>(".mp-seat-resource-track")!;
    bar.classList.toggle("indeterminate", progress.status === "importing" ||
      progress.status === "preparing" && progress.percent == null);
    bar.querySelector<HTMLElement>("span")!.style.width = `${progress.status === "ready" ? 100 : progress.percent ?? 0}%`;
  });
}

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
  const { installParsedPackageZip, migrateLegacyStoredImport } = await loadPackageFeature();
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
let localPackageStoreHydrationRunning = false;
let localPackageStoreHydrationScheduled = false;
let localPackageStoreHydrationRerun = false;
const hydrateLocalPackageStore = async () => {
  if (localPackageStoreHydrationRunning) {
    localPackageStoreHydrationRerun = true;
    return;
  }
  localPackageStoreHydrationRunning = true;
  try {
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
  } finally {
    localPackageStoreHydrationRunning = false;
    if (localPackageStoreHydrationRerun) {
      localPackageStoreHydrationRerun = false;
      scheduleLocalPackageStoreHydration();
    }
  }
};
// Package migration is compatibility maintenance, not first-paint work. Give
// the browser one rendered frame before evaluating the package/import chunk;
// Workbox still downloads that chunk as part of the eager Launcher App Shell.
function scheduleLocalPackageStoreHydration() {
  if (localPackageStoreHydrationScheduled) return;
  localPackageStoreHydrationScheduled = true;
  requestAnimationFrame(() => setTimeout(() => {
    localPackageStoreHydrationScheduled = false;
    void hydrateLocalPackageStore().catch(error => console.warn("local Package Store hydration deferred", error));
  }, 0));
}
scheduleLocalPackageStoreHydration();

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
  // single-title review package). Keep the Launcher state inside that subset
  // before render() asks game() for music and feature capabilities.
  selectAvailableHostProduct(nextManifest);
  // Startup used the local catalog and provisional feature availability.
  // Reapply saved choices and locale defaults against the first real Host,
  // including when a player opens a multiplayer room link directly.
  if (!hostManifestAvailable && !state.launched) {
    restoreGamePreferences(state.game, currentPreferenceId());
  }
  if (originMigrationOpen) {
    originMigrationOpen.dataset.policy = "host-manifest-origin-migration-policy/1";
    originMigrationOpen.hidden = !hostOriginMigrationAvailable(manifest, location.protocol);
  }
  serverResourceMode = manifest.shared?.resourceMode || "hosted";
  importServer = serverResourceMode === "import";
  gameDataFallback = manifest.shared?.gameDataFallback || null;
  state.netplay.url = typeof manifest.shared?.netplayRelay === "string" ? manifest.shared.netplayRelay : "";
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
    // A freshly loaded Host Manifest may supply identities needed by a legacy
    // migration. Retry maintenance out of band instead of making metadata
    // readiness wait on IndexedDB/package work.
    scheduleLocalPackageStoreHydration();
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

let thpracMenuOpen = false;
let runtimeCustomEventWindow: RuntimeWindow | null = null;

function thpracTouchControlsAvailable() {
  return !!state.options.touchEnabled && !!state.options.thpracTouchControlsEnabled;
}

function thpracTouchControlsVisible() {
  return !!state.options.thpracTouchControlsEnabled && (touchLayoutEditing || !!state.options.touchEnabled);
}

function touchRuntimeMessageContext() {
  const session = currentRuntimeSession();
  return {
    target: frame?.contentWindow || null,
    targetOrigin: location.origin,
    protocol,
    game: state.game,
    epoch: session?.id ?? 0,
    launched: state.launched,
    ready: state.ready,
    spectator: state.netplay.spectator,
  };
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
  bindGameKeyWindow(win);
  bindRuntimeCustomEventWindow(win);
}

function uninstallRuntimeDomBridges() {
  gameZoom.uninstallInputBridge();
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
  game: gameIdForProduct(DEFAULT_PRODUCT_ID), hasSelection: false, music: "ogg-stream", ready: false, launched: false, replayViewer: false,
  musicPreferenceExplicit: false,
  musicPreference: "ogg-stream",
  request: 0, pending: new Map(), source: "", sourceIdentity: "", mobileOpen: false,
  product: DEFAULT_PRODUCT_ID, options: { ...defaultOptions }, language: "ja", lessMotion: false, runtimeVariant: "normal",
  netplay: {
    url: "",
    player: 0, playerCount: 2, seed: 19005, difficulty: 1, inputDelay: 0, predictionLimit: 8,
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    loadouts: [{ character: 0, shot: 0 }, { character: 1, shot: 0 }, { character: 2, shot: 0 }],
    spectator: false, spectatorId: "", spectatorCount: 0,
  }
};
const productIds = new Set<ProductId>(PRODUCT_IDS);
const isMultiplayerProduct = (product: ProductId = state.product) => isMultiplayerProductId(product);
const mpPlayerCounts = (product: ProductId = state.product): readonly (2 | 3)[] =>
  multiplayerConfigForProduct(product)?.playerCounts ?? [2];
const mpDefaultPlayerCount = (product: ProductId = state.product): 2 | 3 => mpPlayerCounts(product)[0] ?? 2;
const mpNormalizePlayerCount = (value: unknown, product: ProductId = state.product): 2 | 3 => {
  const allowed = mpPlayerCounts(product);
  const numeric = Number(value);
  return allowed.includes(numeric as 2 | 3) ? numeric as 2 | 3 : (allowed[0] ?? 2);
};
const mpDifficultyMax = (product: ProductId = state.product) =>
  Math.max(0, (multiplayerConfigForProduct(product)?.difficulties.length ?? 1) - 1);
const productTitle = (product: ProductId) => {
  if (!isMultiplayerProductId(product)) return PRODUCT_GAMES[gameIdForProduct(product)].title;
  const multiplayer = multiplayerConfigForProduct(product);
  return multiplayer ? t(multiplayer.titleKey as UiMessageKey) : PRODUCT_GAMES[gameIdForProduct(product)].title;
};
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
let mpShareSingleplayerSettings = true;
function restoreMpProductPreferences(product: ProductId = state.product) {
  const maxLoadout = multiplayerConfigForProduct(product)?.loadouts.length ?? 0;
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
const touchSensitivityPresets = new Set([100, 150, 200]);
const touchLayoutControlTitle = (name: TouchLayoutControlName) => {
  const meta = touchLayoutControlMeta[name];
  return "titleKey" in meta ? t(meta.titleKey) : meta.title;
};
let touchLayout = loadTouchLayoutFromStorage(localStorage);
let touchLayoutDraft: TouchLayout | null = null;
let touchLayoutEditing = false;
let touchLayoutHistoryEntryOwned = false;
let touchLayoutSelected: TouchLayoutControlName = "fire";
type PointerDrag = { pointerId: number; x: number; y: number };
type TouchLayoutDrag =
  | ({ kind: "move"; name: TouchLayoutControlName } & PointerDrag)
  | { kind: "resize"; name: TouchLayoutControlName; pointerId: number; anchorX: number; anchorY: number; baseWidth: number; baseHeight: number; startScale: number };
let touchLayoutDrag: TouchLayoutDrag | null = null;
let touchLayoutEditorDrag: (PointerDrag & { left: number; top: number; maxLeft: number; maxTop: number }) | null = null;
let touchLayoutEditorCollapsed = false;
let touchLayoutEntryAnimations: Animation[] = [];
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
// Keep the entire player surface as the touch owner on phones. The Runtime
// canvas is letterboxed, so a child-document gesture can lose its target when
// the finger crosses from the image into the black bars.
const hostDirectTouch = iosWebKitTouch || /\bAndroid\b/i.test(navigator.userAgent || "");
const lessMotionStorageKey = "eagler-touhou-less-motion-v1";
const runtimeDiagnosticsStorageKey = "eagler-touhou-runtime-diagnostics-v1";
let runtimeDiagnosticsPreference: boolean | null = null;
try {
  const saved = localStorage.getItem(runtimeDiagnosticsStorageKey);
  if (saved === "1" || saved === "0") runtimeDiagnosticsPreference = saved === "1";
} catch {}
function productEnabled(product: string) {
  if (!productEnabledForBuild(product, manifest.shared.testBuild === true)) return false;
  if (!hostManifestAvailable) return true;
  const gameId = gameIdForProduct(product);
  if (!isGameId(gameId) || !Object.hasOwn(manifest.games, gameId)) return false;
  if (isMultiplayerProductId(product)) {
    const hosted = manifest.games[gameId];
    return !!hosted && "multiplayerRuntime" in hosted &&
      typeof hosted.multiplayerRuntime === "string" && hosted.multiplayerRuntime.length > 0;
  }
  return true;
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
const roomNetwork = createRoomNetwork({ send: mpLobbySend, changed: renderRoomNetwork });
window.addEventListener("pagehide", () => { roomNetwork.suspend(); mpDisconnectLobby(); });
window.addEventListener("pageshow", event => { if (event.persisted) { mpReconnectLobbyNow(); renderMpRoom(); } });
let mpLastActivitySent = 0;
function mpNoteRoomActivity(event: Event) {
  if (!event.isTrusted || !mpDirectorySupported || document.visibilityState !== "visible" || !mpUiState.room || Date.now() - mpLastActivitySent < 15_000) return;
  mpLastActivitySent = Date.now();
  mpLobbySend({ type: "activity" });
}
document.addEventListener("pointerdown", mpNoteRoomActivity, { passive: true });
document.addEventListener("keydown", mpNoteRoomActivity);
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
function restoreStoredLanguagePreference(gameId: GameId, preferenceId: ProductId) {
  const savedLanguage = loadStoredLanguagePreference({
    storage: localStorage,
    preferenceId,
    fallbackPreferenceId: isMultiplayerProductId(preferenceId) ? gameId : null,
  });
  state.language = resolvePreferredGameLanguage(languageCatalog(gameId), savedLanguage, getUiLocale());
}
function restoreGamePreferences(gameId: GameId, preferenceId: ProductId = gameId) {
  const fallbackPreferenceId = isMultiplayerProductId(preferenceId) ? gameIdForProduct(preferenceId) : null;
  const normalized = loadStoredGamePreferences({
    storage: localStorage,
    preferenceId,
    fallbackPreferenceId,
    context: {
      uiLocale: getUiLocale(),
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
  restoreStoredLanguagePreference(gameId, preferenceId);
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
  "#fileInput", "#gameDataImportInput", "#mpJoinCode", "#mpDisplayName", "#th09NetworkCode",
  "#touchSensitivity",
] as const;
const selectElementSelectors = [
  "#uiLanguageSelect", "#mpLanguageSelect", "#mpMusicSelect", "#musicSelect",
  "#languageSelect", "#mpRoomPlayerCount", "#mpRoomDifficulty", "#touchMovementMode",
  "#touchFocusMode",
] as const;
const dialogElementSelectors = [
  "#decisionDialog", "#firstUseNoticeDialog", "#mpGuideDialog", "#appleRefreshDialog", "#donationDialog", "#replayDialog",
] as const;
const anchorElementSelectors = ["#originMigrationOpen", "#gameDataFallbackUrl", "#gameNoticeRepo"] as const;
const outputElementSelectors = ["#touchSensitivityValue"] as const;
const buttonElementSelectors = [
  "#siteNoticeOptOut", "#siteNoticeClose", "#lessMotionToggle", "#mastheadMenuToggle",
  "#siteNoticeToggle", "#runtimeDiagnosticsToggle", "#firstUseNoticeOpen", "#mpShareSettingsToggle", "#mpFrameLimitAppleNote",
  "#mpFrameLimitToggle", "#mpFocusHitboxToggle", "#mpLocalPlayerVisibilityToggle", "#mpMobileOptionsToggle",
  "#mpTouchToggle", "#mpTouchLayoutEdit", "#mpAlwaysHitboxToggle", "#mpMagnifierToggle",
  "#mpReplayViewer", "#mpCreateRoom", "#mpJoinRoom", "#th09NetworkClose", "#th09NetworkCreate", "#th09NetworkJoin", "#frameLimitAppleNote",
  "#mpGuideOpen", "#mpRoomGuideOpen", "#mpNetworkCheck",
  "#frameLimitToggle", "#focusHitboxToggle", "#thpracToggle", "#mobileOptionsToggle",
  "#touchToggle", "#touchLayoutEdit", "#alwaysHitboxToggle", "#magnifierToggle",
  "#launch", "#gamePackageImport", "#mpGamePackageImport", "#mpLeaveRoom", "#mpSpectatorJoin",
  "#mpLoadoutPrev", "#mpLoadoutNext", "#mpStandUp", "#mpLoadoutPrevSeat",
  "#mpLoadoutNextSeat", "#mpCopyRoomCode", "#mpReady", "#mpCheckGame", "#mpStartGame",
  "#mpRoomSettingsToggle", "#toastClose", "#startupErrorClose", "#startupErrorCopy", "#decisionCancel",
  "#mpSettingsRoomDrawerToggle", "#libraryBack",
  "#decisionSecondary", "#decisionConfirm", "#firstUseNoticeClose", "#firstUseNoticeCloseHint", "#mpGuideClose",
  "#appleRefreshClose", "#donationOpen", "#donationOpenTop", "#donationClose", "#transferCancel", "#transferRetry", "#gameDataImportClose",
  "#transferImport", "#transferDownload", "#gameDataLinkClose", "#touchLayoutOrientationHelpOpen",
  "#touchLayoutReset", "#touchLayoutSave", "#touchLayoutExit", "#doubleTapBombToggle",
  "#restartButtonToggle", "#thpracTouchControlsToggle", "#touchSensitivityCustomToggle", "#touchViewportAdjust",
  "#touchViewportReset", "#touchViewportDone", "#touchFocus", "#touchFire",
  "#touchBomb", "#touchEscape", "#touchRestart", "#touchThpracTab",
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
function setMpSettingsRoomDrawerOpen(open: boolean, fromHistory = false) {
  const roomOpen = !!mpUiState.room;
  if (roomOpen && !open && !fromHistory && mpSettingsRoomDrawerOpen && history.state?.[mpSettingsHistoryKey]) {
    history.back();
    return;
  }
  const drawer = $("#mpSettingsRoomDrawer");
  const cue = $("#mpSettingsRoomDrawerToggle");
  const returnFocus = drawer.contains(document.activeElement);
  const backdrop = $("#mpSettingsRoomBackdrop");
  backdrop.hidden = !(roomOpen && open);
  $("#mpRoomView").inert = roomOpen && open;
  const generation = ++mpSettingsRoomDrawerCloseGeneration;
  if (roomOpen && open) {
    if (!mpSettingsRoomDrawerOpen) applyHistoryOperations(history, [roomSettingsHistoryOperation({
      currentUrl: location.href,
      currentState: history.state,
    })]);
    mpSettingsRoomDrawerOpen = true;
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    drawer.hidden = false;
    cue.hidden = true;
    cue.setAttribute("aria-expanded", "true");
    $("#libraryBack").focus({ preventScroll: true });
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
  if (!roomOpen || state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mpSettingsRoomDrawerClosing = false;
    drawer.classList.remove("closing");
    drawer.hidden = true;
    cue.hidden = !roomOpen;
    if (returnFocus && roomOpen) cue.focus({ preventScroll: true });
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
    if (returnFocus && mpUiState.room) cue.focus({ preventScroll: true });
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
  const settingsHeader = $(".tools-head");
  const tools = $(".tools");
  const backLabel = roomOpen ? "settings.drawerClose" : "library.back";
  $("#libraryBack").dataset.i18nAriaLabel = backLabel;
  $("#libraryBack").setAttribute("aria-label", t(backLabel));
  // Reparent the existing menu nodes. Never clone controls: listeners, local
  // preferences and disclosure state must have one owner across both entries.
  cue.hidden = !roomOpen || mpSettingsRoomDrawerOpen || mpSettingsRoomDrawerClosing;
  if (roomOpen) {
    if (settingsHeader.parentElement !== drawer) drawer.prepend(settingsHeader);
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
  if (settingsHeader.parentElement !== tools) tools.prepend(settingsHeader);
  if (fold.parentElement !== shell) shell.insertBefore(fold, onlineFold.nextSibling);
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
const netplayPlayerStatus = $("#netplayPlayerStatus");
const runtimeDiagnosticsToggle = $("#runtimeDiagnosticsToggle");
const runtimeBrowserDiag = $("#runtimeBrowserDiag");
const runtimeGapDiag = $("#runtimeGapDiag");
const runtimeAudioDiag = $("#runtimeAudioDiag");
const runtimeRendererDiag = $("#runtimeRendererDiag");
const runtimeNetplaySessionDiag = $("#runtimeNetplaySessionDiag");
const runtimeNetplayInputDelayDiag = $("#runtimeNetplayInputDelayDiag");
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
  inputOpen?: boolean;
  controlOpen?: boolean;
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
  inputDelay: number | null;
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
} = { transport: null, connectedOnce: false };
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
  for (const line of [runtimeNetplaySessionDiag, runtimeNetplayInputDelayDiag, runtimeNetplayRouteDiag, runtimeNetplayFrameDiag, runtimeNetplayRollbackDiag, runtimeNetplayQualityDiag, runtimeNetplayIceDiag]) {
    line.hidden = true;
  }
  runtimeDiagnostics.classList.remove("warn", "bad");
  runtimeDiagnostics.hidden = true;
  netplayPlayerStatus.hidden = true;
  netplayPlayerStatus.replaceChildren();
  player.classList.remove("netplay-player-status-visible");
  resetRuntimeNetplayQuality();
  netplayConnectionUiState.transport = null;
  netplayConnectionUiState.connectedOnce = false;
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
    inputDelay: number("__eaglerNetplayInputDelayFrames"),
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
    webSocketOpenState: WebSocket.OPEN,
  });
  netplayConnectionUiState.connectedOnce = view.connectedOnce;
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
function updateNetplayPlayerStatus(net: RuntimeNetplaySnapshot | null) {
  const visible = !!net && state.launched && !state.replayViewer && !net.spectator;
  netplayPlayerStatus.hidden = !visible;
  player.classList.toggle("netplay-player-status-visible", visible);
  if (!visible || !net) {
    netplayPlayerStatus.replaceChildren();
    return;
  }
  const playerCount = Math.max(2, Math.min(3, Number(state.netplay.playerCount) || 2));
  const localPlayer = Math.max(0, Math.min(playerCount - 1, Number(state.netplay.player) || 0));
  const rtcPaths = new Map<number, RuntimeNetplayEntry>();
  for (const entry of net.rtcPaths) {
    const peer = Number(entry.peer);
    if (Number.isInteger(peer) && peer >= 0 && peer < playerCount) rtcPaths.set(peer, entry);
  }
  const rows: HTMLElement[] = [];
  for (let peerId = 0; peerId < playerCount; ++peerId) {
    if (peerId === localPlayer) continue;
    const transportPeer = net.peerState?.peers?.get(peerId);
    const pcState = String(transportPeer?.pc?.connectionState || transportPeer?.pc?.iceConnectionState || "");
    const channelsReady = transportPeer?.inputOpen === true && transportPeer?.controlOpen === true;
    let connected: boolean | undefined;
    if (net.transport === "relay") connected = Number(net.peerState?.relay?.readyState) === WebSocket.OPEN ? true : undefined;
    else if (channelsReady || pcState === "connected" || pcState === "completed") connected = true;
    else if (["disconnected", "failed", "closed"].includes(pcState) || net.failed) connected = false;
    const path = rtcPaths.get(peerId);
    const route = net.transport === "relay" ? "relay" : path?.path || (net.path === "mixed" ? "rtc" : net.path);
    const quality = runtimeNetplayQualityState.peers.get(peerId);
    const row = document.createElement("span");
    row.textContent = compactNetplayPeerStatus({
      player: peerId,
      route,
      rttMs: quality?.rttMs,
      variationMs: quality?.variationMs,
      connected,
    });
    if (quality?.rttMs != null) {
      const details = [String(route || "rtc"), path?.protocol, path?.family].filter(Boolean).join("/");
      row.title = `P${peerId + 1} ${details} · RTT ${Math.round(quality.rttMs)}ms` +
        (quality.variationMs != null ? ` · variation ${Math.round(quality.variationMs)}ms` : "");
    }
    rows.push(row);
  }
  netplayPlayerStatus.replaceChildren(...rows);
}
function updateNetplayDiagnostics() {
  const net = runtimeNetplaySnapshot();
  updateNetplayConnectionWindow(net);
  updateNetplayPlayerStatus(net);
  const lines = [runtimeNetplaySessionDiag, runtimeNetplayInputDelayDiag, runtimeNetplayRouteDiag, runtimeNetplayFrameDiag, runtimeNetplayRollbackDiag, runtimeNetplayQualityDiag, runtimeNetplayIceDiag];
  for (const line of lines) line.hidden = !net;
  if (!net) return;

  const room = String(mpUiState.room?.code || "--");
  const playerIndex = Math.max(0, Number(state.netplay.player) || 0);
  const playerCount = Math.max(2, Number(state.netplay.playerCount) || 2);
  const role = net.spectator ? t("diagnostics.netplayRoleSpectator", { players: playerCount }) : `P${playerIndex + 1}/${playerCount}`;
  setRuntimeDiagnostic(runtimeNetplaySessionDiag, t("diagnostics.netplayRuntime", {
    room, role, runtime: `${state.runtimeVariant}/${net.mode || "--"}`,
  }));
  setRuntimeDiagnostic(runtimeNetplayInputDelayDiag, t("diagnostics.inputDelay", {
    frames: Math.max(0, Math.trunc(net.inputDelay ?? (Number(state.netplay.inputDelay) || 0))),
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
const maxGamePackageImportBytes = 256 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
const maxReplayArchiveExpandedBytes = 128 * 1024 * 1024;
let midiSynth: MidiSynth | null = null;
let gameKeyWindow: RuntimeWindow | null = null;
let fullscreenChordActive = false;
const routedGameFromLocation = () => {
  const product = routedProductFromUrl(location.href, productIds);
  return product && productEnabled(product) ? product : null;
};
function replaceLauncherHomeHistory() {
  applyHistoryOperations(history, [launcherHomeHistoryOperation({
    currentUrl: location.href,
    currentState: history.state,
  })]);
}
function showLauncherHome() {
  if ($("#main").classList.contains("card-layout-motion")) cancelCardLayoutMotion();
  state.hasSelection = false;
  render();
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
let transferCancelUserInitiated = false;
interface BlockingNetworkOperation {
  controller: AbortController;
  label: string;
  onCancel: (() => void) | null;
  suppressDeferredReload: boolean;
}
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
function beginBlockingNetworkOperation({
  label = t("player.cancelDownload"),
  onCancel = null,
  suppressDeferredReload = false,
}: {
  label?: string;
  onCancel?: (() => void) | null;
  suppressDeferredReload?: boolean;
} = {}): BlockingNetworkOperation {
  const operation = { controller: new AbortController(), label, onCancel, suppressDeferredReload };
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
  if (!operation.suppressDeferredReload) maybeApplyDeferredAppShellUpdate();
  try { operation.onCancel?.(); } catch (error) { console.warn("blocking download cancel handler failed", error); }
}
function askDecision({ title = "", message = "", confirmText = "", cancelText = "", secondaryText = "", tone = "normal", variant = "", hideCancel = false, confirmOnEnter = false }: {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  tone?: string;
  variant?: string;
  hideCancel?: boolean;
  confirmOnEnter?: boolean;
} = {}): Promise<DecisionChoice> {
  syncTransientOverlayHost();
  const dialog = $("#decisionDialog");
  if (decisionResolver || dialog.open) return Promise.resolve("cancel");
  $("#decisionTitle").textContent = title || t("dialog.confirmTitle");
  $("#decisionMessage").textContent = message;
  $("#decisionConfirm").textContent = confirmText || t("action.confirm");
  const cancelButton = $("#decisionCancel");
  cancelButton.hidden = hideCancel;
  cancelButton.textContent = cancelText || t("action.cancel");
  const secondary = $("#decisionSecondary");
  secondary.hidden = !secondaryText;
  secondary.textContent = secondaryText || t("action.backgroundDownload");
  dialog.dataset.tone = tone;
  dialog.dataset.variant = variant;
  // A hidden cancel hands its column back to the two remaining actions.
  dialog.dataset.options = secondaryText && !hideCancel ? "3" : "2";
  dialog.dataset.confirmOnEnter = String(!!confirmOnEnter);
  dialog.classList.remove("closing");
  decisionFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise<DecisionChoice>(resolve => {
    decisionResolver = resolve;
    dialog.returnValue = "cancel";
    dialog.showModal();
    (hideCancel ? $("#decisionConfirm") : cancelButton).focus({ preventScroll: true });
  });
}
function askConfirmation(options = {}) {
  return askDecision(options).then(value => value === "confirm");
}
// Entry notice from a blacklisted browser. Once the player has seen it, the
// dismissal is remembered so later visits go straight to the launcher. There
// is no cancel action: the player either opens the FAQ or continues browsing.
// The FAQ is a real page navigation, so choosing it leaves the launcher.
const browserWarningDismissedKey = "browser-warning-dismissed";
function browserWarningDismissed(): boolean {
  try { return localStorage.getItem(browserWarningDismissedKey) === "1"; } catch { return false; }
}
function markBrowserWarningDismissed(): void {
  try { localStorage.setItem(browserWarningDismissedKey, "1"); } catch {}
}
async function warnDiscouragedBrowser(): Promise<void> {
  const choice = await askDecision({
    title: t("browserWarning.title"),
    message: t("browserWarning.message"),
    secondaryText: t("action.viewFaq"),
    confirmText: t("action.continueVisit"),
    hideCancel: true,
    variant: "browser-warning",
  });
  // Persist before the FAQ navigation so the next visit no longer warns.
  markBrowserWarningDismissed();
  if (choice === "secondary") location.href = "faq.html";
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
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const area = document.createElement("textarea");
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  area.value = text;
  area.readOnly = true;
  area.style.cssText = "position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none";
  (document.fullscreenElement || document.body).append(area);
  area.select();
  area.setSelectionRange(0, area.value.length);
  let copied = false;
  try { copied = document.execCommand("copy"); } catch {}
  area.remove();
  active?.focus({ preventScroll: true });
  return copied;
}
async function copyStartupError() {
  const text = $("#startupErrorText").textContent || "";
  if (!text) return;
  showToast(t(await copyText(text) ? "dialog.errorCopied" : "dialog.errorCopyFailed"), 3200);
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
  useReasonVerbatim = false,
) {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false, startTimer: null, completeTimer: null, importFlow: true, continuation, manual: true };
  $("#gameDataImportReason").textContent = useReasonVerbatim ? reason : t("package.manualImportReason", { reason });
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
    titleKey: string;
    playerCounts: readonly (2 | 3)[];
    difficulties: readonly string[];
    loadouts: readonly {
      labelKey: string;
      glyph: string;
      character: number;
      shot: number;
    }[];
    peerTransportGlobal: string;
    // Optional Launcher capabilities that a title may withhold: the room
    // spectator seat, and a game-title entry that opens the shared room dialog
    // on top of the already running normal Runtime.
    spectator?: boolean;
    titleRoomEntry?: boolean;
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

function requiredSharedForGame(gameId: GameId = state.game): readonly string[] {
  const product = PRODUCT_GAMES[gameId];
  return "requiredShared" in product ? product.requiredShared : [];
}

function cardArtworkAsset(gameId: GameId = state.game): string | null {
  const product = PRODUCT_GAMES[gameId];
  return "cardArtwork" in product ? `assets/${product.cardArtwork}` : null;
}

function cardArtworkCss(gameId: GameId = state.game): string {
  const artwork = cardArtworkAsset(gameId);
  return artwork ? `url("${artwork}")` : "none";
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
  const { installPackageFromAcquisition } = await loadPackageFeature();
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
  if (!(file instanceof Blob) || file.size <= 0 || file.size > maxGamePackageImportBytes) throw new Error(t("package.invalidDataSize"));
  if (!globalThis.indexedDB?.open) throw new Error(t("package.indexedDbUnavailable"));
  const {
    adaptLegacyGamePackToPackage,
    installPackageFromAcquisition,
    installParsedPackageZip,
    parsePackageZip,
    parseStoredGameDataPack,
  } = await loadPackageFeature();
  const matchesRawDataImport = file instanceof File && rawDataImportMatchesFileName(state.game, file.name);
  if (matchesRawDataImport) {
    const expected = gameDataDescriptor();
    const gameLabel = state.game.toUpperCase();
    if (!rawDataImportSizeMatches(expected, file.size)) throw new Error(t("package.rawDataSizeMismatch", { game: gameLabel, actual: file.size, expected: expected.bytes }));
    setPlayerStatus(t("package.validatingRawData", { game: gameLabel }));
    const bytes = await file.arrayBuffer();
    const actualHash = await sha256Hex(new Uint8Array(bytes));
    if (!rawDataImportHashMatches(expected, actualHash)) throw new Error(t("package.rawDataHashMismatch", { game: gameLabel }));

    // The retail filename is only an acquisition concern. Once accepted, raw
    // data enters the same canonical Package Store namespace as any published
    // Package and is mounted at the product-declared Runtime target.
    const descriptor = createRawDataImportPackageDescriptor(state.game, expected, actualHash);
    const dataFileId = descriptor.runtimeRequirement!.dataFile;
    setPlayerStatus(t("package.installingRawData", { game: gameLabel }));
    const installed = await installPackageFromAcquisition({
      descriptor,
      desiredFileIds: [dataFileId],
      source: "local",
      reuseCurrent: false,
      acquire: async fileId => fileId === dataFileId ? bytes : null,
      onProgress(progress) {
        setPlayerStatus(t("package.installingRawDataProgress", { game: gameLabel, completed: progress.completed, total: progress.total }));
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
    const requiredShared = requiredSharedForGame();
    const packageBaseTargets = new Set((packageZip.descriptor.base?.files || [])
      .map(fileId => packageZip.descriptor.files?.[fileId]?.target)
      .filter((target): target is string => typeof target === "string" && !!target));
    const missingShared = requiredShared.filter(target => !packageBaseTargets.has(target));
    if (missingShared.length) {
      throw new Error(t("package.missingRequiredResource", { resource: missingShared[0].slice(1) }));
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
  if (importServer && !pack.offline) throw new Error(t("package.serverNoContent"));
  if (pack.offline) {
    const requiredShared = requiredSharedForGame();
    for (const target of requiredShared) {
      if (!pack.offline.shared.some(item => item.target === target)) {
        throw new Error(t("package.missingRequiredResource", { resource: target.slice(1) }));
      }
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
  const session = currentRuntimeSession();
  if (!session) throw new RuntimeSwitchedError();
  const assertSession = () => {
    if (!runtimeSessionCurrent(session)) throw new RuntimeSwitchedError();
  };
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
    const runtimeOptions: RuntimeConfigureOptions = {
      limitPresentationTo60: state.options.frameLimit60Enabled,
      touchEnabled: state.options.touchEnabled,
      touchMovementMode: state.options.touchMovementMode,
      touchSensitivity: state.options.touchSensitivity,
      touchFocusMode: state.options.touchFocusMode,
      doubleTapBombEnabled: state.options.doubleTapBombEnabled,
      alwaysHitbox: state.options.alwaysHitbox,
      oggDecodeMode: oggDecodeMode(state.music),
      ...(state.runtimeVariant === "normal" && gameFeatureAvailable(state.game, "thprac")
        ? {
            thpracEnabled: state.options.thpracEnabled,
            thpracLocale: thpracLocaleForLanguage(launchLanguage),
          }
        : {}),
      ...(gameFeatureAvailable(state.game, "focusHitbox")
        ? { focusHitboxEnabled: state.options.focusHitboxEnabled }
        : {}),
      ...(state.runtimeVariant === "multiplayer"
        ? {
            multiplayerLocalPlayerVisibility: state.options.multiplayerLocalPlayerVisibility,
            ...(state.replayViewer ? { replayViewer: true } : {}),
            ...(options.omitNetplay && "preflightWithoutRoom" in (game().multiplayer ?? {})
              ? { multiplayerPreflight: true } : {}),
            ...netplayOptions,
          }
        : {}),
      ...(debugHarness ? { debugHarness } : {}),
    };
    await send("configure", {
      // Imported OGG is already in the host's IndexedDB.  Do not route those
      // bytes back through blob: URLs and fetch() inside the iframe: on mobile
      // and ordinary HTTP origins that duplicates the whole audio payload and
      // can keep configure blocked long enough to look like a dead launch.
      // Write local OGG buffers into the same-origin Runtime FS before callMain().
      // Most Runtimes use MIDI as a sentinel to skip external loading; some need
      // the selected mode so they can consume those installed bytes.
      music: localMusicResources && PRODUCT_GAMES[state.game].musicRuntime.localOggConfigureMode === "midi-sentinel"
        ? "midi" : musicTransportMode(state.music),
      resources: localMusicResources ? [] : musicResources,
      runtimeResources: selectedRuntimeResources(),
      runtimePack: runtimePack ? { ...runtimePack, manifest: runtimePack.manifest, files: runtimePack.files } : null,
      sharedResources: shared,
      options: runtimeOptions,
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
    const networkedLaunch = "netplayMode" in netplayOptions && netplayOptions.netplayMode === "lan";
    const firstFramePromise = options.awaitFirstFrame
      ? waitForRuntimeFirstFrame(session, networkedLaunch || directoryRuntime ? 122_000 : firstFrameFallbackMs + 2000)
      : null;
    // Session invalidation owns cancellation. Observe rejection immediately so
    // an earlier launch failure cannot leave a transient unhandled promise.
    if (firstFramePromise) void firstFramePromise.catch(() => {});
    // A live multiplayer Runtime can wait for another device before it is
    // allowed to present frame zero. That wait has no local 12-second bound;
    // Runtime errors and the launch request still report actual failures.
    if (networkedLaunch) clearFirstFrameWatchdog();
    else armFirstFrameWatchdog(directoryRuntime ? 122_000 : firstFrameFallbackMs);
    // The Runtime is once again the direct child browsing context. Keep the
    // bounded Android focus relay that fixed the historical first-frame stall,
    // but there is no longer a Player -> Runtime focus hop.
    startPlayerFocusRelay();
    try {
      // Directory Runtimes may intentionally wait for a real
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
    if (!runtimeSessionCurrent(session)) throw new RuntimeSwitchedError();
    if (!state.launched) resetRuntime();
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
    midiAvailable: PRODUCT_GAMES[state.game].musicCapabilities.midi && packages.midi?.supported !== false,
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
    // Availability may temporarily force effective music to "none" before a
    // local package is imported. Re-resolve from the saved preference so BGM
    // returns as soon as the package's OGG component becomes available.
    requested: state.musicPreference,
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
function customSelectHost(select?: HTMLSelectElement) {
  const dialog = select?.closest<HTMLDialogElement>("dialog[open]");
  if (dialog) return dialog;
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
  const host = ui.menu.parentElement;
  const dialogHost = host instanceof HTMLDialogElement ? host : null;
  const hostRect = dialogHost?.getBoundingClientRect();
  const visibleLeft = hostRect ? Math.max(viewportGap, hostRect.left + viewportGap) : viewportGap;
  const visibleRight = hostRect ? Math.min(window.innerWidth - viewportGap, hostRect.right - viewportGap) : window.innerWidth - viewportGap;
  const visibleTop = hostRect ? Math.max(viewportGap, hostRect.top + viewportGap) : viewportGap;
  const visibleBottom = hostRect ? Math.min(window.innerHeight - viewportGap, hostRect.bottom - viewportGap) : window.innerHeight - viewportGap;
  const width = Math.min(Math.max(rect.width, 192), Math.min(280, Math.max(1, visibleRight - visibleLeft)));
  const left = Math.max(visibleLeft, Math.min(rect.left, visibleRight - width));
  const belowHeight = Math.max(0, visibleBottom - rect.bottom - gap);
  const aboveHeight = Math.max(0, rect.top - gap - visibleTop);
  const naturalHeight = ui.menu.scrollHeight;
  const openBelow = belowHeight >= Math.min(naturalHeight, 120) || belowHeight >= aboveHeight;
  const availableHeight = Math.max(1, openBelow ? belowHeight : aboveHeight);
  const top = openBelow ? rect.bottom + gap : rect.top - gap - Math.min(naturalHeight, availableHeight);
  ui.menu.style.position = dialogHost ? "absolute" : "fixed";
  ui.menu.style.minWidth = `${Math.round(rect.width)}px`;
  ui.menu.style.width = `${Math.round(width)}px`;
  ui.menu.style.maxHeight = `${Math.round(availableHeight)}px`;
  if (dialogHost && hostRect) {
    ui.menu.style.left = `${Math.round(left - hostRect.left + dialogHost.scrollLeft - dialogHost.clientLeft)}px`;
    ui.menu.style.top = `${Math.round(top - hostRect.top + dialogHost.scrollTop - dialogHost.clientTop)}px`;
  } else {
    ui.menu.style.left = `${Math.round(left)}px`;
    ui.menu.style.top = `${Math.round(top)}px`;
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
  const host = customSelectHost(select);
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
    if (event.key === "Escape") { event.preventDefault(); closeCustomSelect(select); return; }
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
  const touchFire = PRODUCT_GAMES[state.game].touchFire;
  const enabled = touchFire.mode === "held-key" ? heldTouchFire : touchControls.fireEnabled;
  fireButton.classList.toggle("is-on", enabled);
  const pressed = String(enabled);
  if (fireButton.getAttribute("aria-pressed") !== pressed) fireButton.setAttribute("aria-pressed", pressed);
  if (!updateCopy) return;
  const copy = t(touchFire.labelKey);
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
    state.options.touchEnabled && !wheelMovement && !touchLayoutEditing);
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
  // Keep the tools panel out of native inert state. The collapsed panel already
  // uses visibility:hidden + pointer-events:none, while aria-hidden owns
  // accessibility exposure. Avoiding another browser-managed interaction state
  // also makes the Edge hit-test recovery path deterministic after Player exit.
  tools.removeAttribute("inert");
  document.querySelectorAll<HTMLElement>(".game").forEach(card => {
    const candidate = card.dataset.product || card.dataset.game || "";
    if (!isProductId(candidate)) return;
    const product = candidate;
    card.hidden = !productEnabled(product);
    const selected = state.hasSelection && product === state.product;
    card.classList.toggle("selected", selected);
    if (card instanceof HTMLAnchorElement) card.setAttribute("aria-current", selected ? "page" : "false");
  });
  $("#gameId").textContent = multiplayerProduct ? `${state.game.toUpperCase()} MP` : state.game.toUpperCase();
  $("#gameId").dataset.game = state.game;
  $("#gameTitle").textContent = game().title;
  const identity = PRODUCT_GAMES[state.game];
  const cover = $("#optionsCover") as HTMLImageElement;
  const coverSource = cardArtworkAsset(state.game);
  if (coverSource) {
    cover.hidden = false;
    if (cover.getAttribute("src") !== coverSource) cover.src = coverSource;
  } else {
    cover.hidden = true;
  }
  $("#optionsNumber").textContent = identity.number;
  $("#optionsSubtitle").textContent = identity.subtitle;
  const lobbyProduct = multiplayerProductIdForGame(state.game);
  const lobbyLink = $("#optionsLobbyLink") as HTMLAnchorElement;
  lobbyLink.hidden = !lobbyProduct || !productEnabled(lobbyProduct);
  if (lobbyProduct) {
    const lobbyUrl = new URL("lobby.html", location.href);
    lobbyUrl.searchParams.set("game", lobbyProduct);
    lobbyLink.href = lobbyUrl.href;
    lobbyLink.setAttribute("aria-label", `${identity.title} · ${t("lobby.title")}`);
  }
  $("#mpTitleBadge").hidden = !multiplayerProduct;
  const support = PRODUCT_GAMES[state.game].support;
  const noticeGame = "adaptationNotice" in support && support.adaptationNotice === "early-test" && !multiplayerProduct;
  $("#gameNoticeCallout").hidden = !noticeGame;
  if (noticeGame) {
    $("#gameNoticeRepo").href = support.sourceRepository;
    // Per-game credit override (e.g. TH20): keep the shared default otherwise.
    const credit = "credit" in support ? (support.credit as { name: string; url: string }) : null;
    const creditAnchor = document.querySelector<HTMLAnchorElement>("#gameNoticeCredit");
    const creditName = document.querySelector<HTMLElement>("#gameNoticeCreditName");
    if (creditAnchor && creditName) {
      creditAnchor.href = credit ? credit.url : "https://b23.tv/WOQhahY";
      if (credit) {
        creditName.textContent = credit.name;
        creditName.removeAttribute("data-i18n");
      } else {
        creditName.setAttribute("data-i18n", "gameNotice.credit");
      }
    }
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
  const libraryToolsOpen = state.hasSelection && !multiplayerRoomOpen && !state.launched;
  document.body.classList.toggle("library-tools-open", libraryToolsOpen);
  $(".game-library").inert = libraryToolsOpen;
  tools.setAttribute("role", libraryToolsOpen ? "dialog" : "complementary");
  tools.setAttribute("aria-labelledby", "gameTitle");
  tools.setAttribute("aria-modal", String(libraryToolsOpen));
  tools.setAttribute("aria-hidden", String(!libraryToolsOpen));
  if (multiplayerRoomOpen && $("#main").classList.contains("card-layout-motion")) cancelCardLayoutMotion();
  $("#main").classList.toggle("mp-room-open", multiplayerRoomOpen);
  document.body.classList.toggle("mp-room-active", multiplayerRoomOpen);
  if (!multiplayerRoomOpen && roomPanel.open) roomPanel.close();
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
  $("#replayFileTool").hidden = false;
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
  $("#mpFocusHitboxOption").hidden = !gameFeatureAvailable(state.game, "focusHitbox");
  $("#mpFocusHitboxToggle").setAttribute("aria-checked", String(state.options.focusHitboxEnabled));
  $("#mpFocusHitboxToggle").classList.toggle("on", state.options.focusHitboxEnabled);
  $("#mpTouchToggle").setAttribute("aria-checked", String(state.options.touchEnabled));
  $("#mpTouchToggle").classList.toggle("on", state.options.touchEnabled);
  $("#mpAlwaysHitboxToggle").setAttribute("aria-checked", String(state.options.alwaysHitbox));
  $("#mpAlwaysHitboxToggle").classList.toggle("on", state.options.alwaysHitbox);
  $("#mpLocalPlayerVisibilityToggle").setAttribute("aria-checked", String(state.options.multiplayerLocalPlayerVisibility));
  $("#mpLocalPlayerVisibilityToggle").classList.toggle("on", state.options.multiplayerLocalPlayerVisibility);
  $("#mpMagnifierToggle").setAttribute("aria-checked", String(state.options.magnifierEnabled));
  $("#mpMagnifierToggle").classList.toggle("on", state.options.magnifierEnabled);
  $("#mpMagnifierConflict").hidden = state.options.touchFocusMode !== "two-finger";
  $("#mpMobileOptions").classList.toggle("open", mpUiState.mobileOpen);
  $("#mpMobileOptionsToggle").setAttribute("aria-expanded", String(mpUiState.mobileOpen));
  $("#mpMobileOptionsBody").inert = !mpUiState.mobileOpen;
  const selectedLanguage = languageEntry();
  const selectedPack = record(selectedLanguage.offlinePack) || record(selectedLanguage.pack);
  $("#languagePackSize").textContent = selectedPack ? formatBytes(Number(selectedPack.bytes) || 0) : t("settings.builtin");
  const thpracAvailable = gameFeatureAvailable(state.game, "thprac");
  if (!thpracAvailable || multiplayerProduct) state.options.thpracEnabled = false;
  $("#thpracOption").hidden = !thpracAvailable || multiplayerProduct;
  $("#focusHitboxOption").hidden = !gameFeatureAvailable(state.game, "focusHitbox");
  $("#mobileOptions").classList.toggle("open", state.mobileOpen);
  $("#mobileOptionsToggle").setAttribute("aria-expanded", String(state.mobileOpen));
  $("#mobileOptionsBody").inert = !state.mobileOpen;
  const switches = { thpracToggle: state.options.thpracEnabled, thpracTouchControlsToggle: state.options.thpracTouchControlsEnabled, restartButtonToggle: state.options.restartButtonEnabled, magnifierToggle: state.options.magnifierEnabled, frameLimitToggle: state.options.frameLimit60Enabled, focusHitboxToggle: state.options.focusHitboxEnabled, touchToggle: state.options.touchEnabled, doubleTapBombToggle: state.options.doubleTapBombEnabled, alwaysHitboxToggle: state.options.alwaysHitbox };
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
  // Match the other games: the mobile thprac controls are independently
  // configurable and become visible as soon as their touch option is enabled.
  $("#thpracTouchControlsToggle").disabled = false;
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
  $("#touchHelp").classList.toggle("touch-help-touch-input", state.options.touchEnabled);
  if (twoFingerFocusOption) twoFingerFocusOption.disabled = wheelMovement;
  player.classList.toggle("touch-enabled", touchSurfaceVisible);
  player.classList.toggle("touch-joystick-enabled", wheelMovement && touchSurfaceVisible);
  $("#touchJoystick").hidden = !(wheelMovement && touchSurfaceVisible);
  $("#touchRestart").hidden = !state.options.restartButtonEnabled;
  syncDirectTouchSurfaceVisibility();
  renderTouchActionState();
  const thpracControlsVisible = !spectatorRuntime && thpracTouchControlsVisible();
  touchThpracTab.hidden = !thpracControlsVisible;
  touchThpracMenu.hidden = !thpracControlsVisible;
  touchThpracFunctionKeys.hidden = !thpracMenuOpen;
  applyTouchLayout();
  if (touchLayoutEditing) updateTouchLayoutEditorUi();
  gameZoom.refreshUi();
  updatePlayerOrientationUi();
  syncAllCustomSelects();
}

window.addEventListener("eagler-ui-locale-change", () => {
  document.documentElement.lang = getUiLocale();
  if (!state.launched) restoreGamePreferences(state.game, currentPreferenceId());
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
    ...(["th08mp", "th09mp", "th10mp"].includes(state.product) ? {
      inputDelay: state.netplay.inputDelay,
    } : {}),
    ...(state.product === "th08mp" ? {
      predictionLimit: state.netplay.predictionLimit,
    } : {}),
    spectator: state.netplay.spectator === true,
    spectatorId: state.netplay.spectatorId,
    spectatorCount: state.netplay.spectatorCount,
    iceServers: state.netplay.iceServers,
    loadouts: state.netplay.loadouts,
  }, {
    playerCounts: multiplayer.playerCounts,
    difficulties: multiplayer.difficulties,
    loadouts: multiplayer.loadouts,
  });
}

function setOption<K extends keyof GameOptions>(name: K, value: GameOptions[K]) {
  if (name === "touchMovementMode" && value === "touch-unlimited" && mpUiState.room?.disableCheatMovement && mpUiState.seat != null) {
    showToast(t("room.movementRequired")); render(); return;
  }
  if (name === "thpracEnabled" && !gameFeatureAvailable(state.game, "thprac")) return;
  if (state.options[name] === value) return;
  state.options[name] = value;
  if ((name === "touchEnabled" || name === "thpracEnabled" || name === "thpracTouchControlsEnabled") && !thpracTouchControlsAvailable()) {
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
  if ((name === "touchMovementMode" || name === "touchEnabled") && (mpControlModesSupported || mpUiState.room?.disableCheatMovement) && mpUiState.room?.phase === "lobby" && mpUiState.seat != null) mpLobbySend({ type: "movement", movementMode: state.options.touchMovementMode, touchEnabled: state.options.touchEnabled, mobileDevice: mobileDevice || state.options.touchEnabled });
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
    const confirmed = await askConfirmation({
      message: t("touch.disabledInputWarning"),
      confirmText: t("touch.startAnyway")
    });
    if (!confirmed) return false;
  }
  if (state.music === "none") {
    return askConfirmation({
      message: t("music.noneLaunchWarning"),
      confirmText: t("music.startAnyway")
    });
  }
  if (state.music === "midi") {
    return askConfirmation({
      message: t("music.midiLaunchWarning"),
      confirmText: t("music.startAnyway")
    });
  }
  return true;
}

function resetRuntime() {
  clearHostedKeyboard();
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
    pending.reject(new RuntimeSwitchedError());
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
  "Tab", "Backspace", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F12"
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

const hostedKeyboard = new HostedKeyboard();
function forwardHostedKeyboard(event: KeyboardEvent) {
  if (!state.launched || !player.classList.contains("open") || !frame.contentWindow) {
    hostedKeyboard.clear();
    return;
  }
  const ownedByLauncher = event.target instanceof Element && !!event.target.closest("input, select, textarea, button, dialog, [role='dialog']");
  const context = touchRuntimeMessageContext();
  const keys = hostedKeyboard.forward(event, context, ownedByLauncher);
  for (const key of keys) deliverRuntimeInput(context, {
    protocol, game: context.game, epoch: context.epoch, command: "keyboard",
    down: event.type === "keydown", ...key,
  });
  if (keys.length) event.preventDefault();
}
window.addEventListener("keydown", forwardHostedKeyboard, true);
window.addEventListener("keyup", forwardHostedKeyboard, true);
function clearHostedKeyboard() {
  releaseHeldTouchFire();
  hostedKeyboard.clear();
  if (!state.launched || !frame.contentWindow) return;
  const context = touchRuntimeMessageContext();
  deliverRuntimeInput(context,
    { protocol, game: state.game, epoch: context.epoch, command: "keyboard-clear" });
}
window.addEventListener("blur", clearHostedKeyboard);
window.addEventListener("pagehide", clearHostedKeyboard);
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
  cancelLauncherInteractionAnimations();
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
  // Held-key Fire is delivered separately; do not also send its automatic pulse stream.
  const controls = PRODUCT_GAMES[state.game].touchFire.mode === "held-key"
    ? { ...touchControls, fireEnabled: false } : touchControls;
  return postRuntimeTouchControls(touchRuntimeMessageContext(), controls, state.options.touchSensitivity);
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
  hideRoomLaunchCover();
  if (th09NetworkOverlayOpen()) {
    mpResetRoomState();
    th09CloseNetworkOverlay(false);
    state.product = state.game;
    state.runtimeVariant = "normal";
  }
  if (isPlayerFullscreen()) await exitPlayerFullscreen().catch(() => {});
  cancelLauncherInteractionAnimations();
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
    if (fromHistory && mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey)) !== roomCode) {
      // Back was pressed while the game covered its room. Restore the room
      // entry without consuming the options entry beneath it.
      history.forward();
    } else {
      applyHistoryOperations(history, [returnToRoomHistoryOperation({
        currentUrl: location.href,
        currentState: history.state,
        product: state.product,
        roomCode,
      })]);
    }
    renderMpRoom();
    render();
    if (!mpLobby.connected) mpReconnectLobbyNow();
    appShellClient?.maybeReload();
    return true;
  }
  if (!fromHistory) {
    if (!mpUiState.room && history.state?.[playerHistoryKey]) history.back();
    else replaceLauncherHomeHistory();
  }
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

window.addEventListener("popstate", async event => {
  if (touchLayoutEditing) {
    const editorHistoryWasPopped = touchLayoutHistoryEntryOwned;
    touchLayoutHistoryEntryOwned = false;
    const closed = await closeTouchLayoutEditor();
    if (!closed && editorHistoryWasPopped) pushTouchLayoutEditorHistory();
    return;
  }
  if (mpSettingsRoomDrawerOpen && !history.state?.[mpSettingsHistoryKey]) {
    setMpSettingsRoomDrawerOpen(false, true);
    return;
  }
  if (roomPanel.open && !roomPanelClosing && !history.state?.[mpPanelHistoryKey]) {
    closeRoomPanel(true);
    return;
  }
  if (th09NetworkOverlayOpen() && mpUiState.room) {
    mpLeaveRoom();
    return;
  }
  if (player.classList.contains("open") && mpUiState.room) {
    if (!await closePlayerView(true, { skipSync: !!roomLaunchHome, returnToMpRoom: true })) history.forward();
    return;
  }
  if (mpUiState.room) {
    const routedRoom = mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
    if (!routedRoom || routedRoom !== mpUiState.room.code) {
      mpLeaveRoom();
      return;
    }
  }
  // A same-route history notification does not mean the Player was left.
  if (player.classList.contains("open") && record(event.state)?.[playerHistoryKey] === true &&
      routedGameFromLocation() === state.product) return;
  if (player.classList.contains("open") && !await closePlayerView(true)) {
    const restore = playerRouteHistoryOperation({
      currentUrl: location.href, currentState: history.state,
      routedProduct: routedGameFromLocation(), product: state.product,
    });
    if (restore) applyHistoryOperations(history, [restore]);
    return;
  }
  if (!syncSelectionFromPlayerRoute()) {
    if (state.hasSelection && !state.launched) closeLibraryTools(true);
    else showLauncherHome();
  }
});
window.addEventListener("pageshow", event => {
  if (event.persisted && !mpUiState.room && !syncSelectionFromPlayerRoute()) showLauncherHome();
});

function send(command: RuntimeProtocolCommand, payload: UnknownRecord = {}, timeout = 15000): Promise<RuntimeResponseMessage> {
  const runtime = frame.contentWindow;
  const session = currentRuntimeSession();
  if (!state.ready || !runtime || !session) return Promise.reject(new Error(t("runtime.notReady")));
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
    runtime.postMessage({ protocol, game: state.game, epoch: session.id, command, request, ...payload }, location.origin);
  });
}

launcherWindow.__eaglerPrepareManagedRuntimeDataV1 = async request => {
  const session = currentRuntimeSession();
  if (!session || request.epoch !== session.id) {
    throw new DOMException("EAGLER_RUNTIME_SESSION_SUPERSEDED", "AbortError");
  }
  const generation = managedRuntimeGenerationLease.resolve(request);
  setPlayerStatus(t("runtime.handingLocalData"));
  try {
    const result = await readManagedRuntimeData(generation);
    if (!runtimeSessionCurrent(session)) {
      throw new DOMException("EAGLER_RUNTIME_SESSION_SUPERSEDED", "AbortError");
    }
    return result;
  } catch (error) {
    if (!runtimeSessionCurrent(session)) {
      throw new DOMException("EAGLER_RUNTIME_SESSION_SUPERSEDED", "AbortError");
    }
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
  const session = currentRuntimeSession();
  if (!session) return;
  const message = parseRuntimeInboundMessage(event.data, state.game, session.id);
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
  if (message.event === "notice") {
    if (typeof message.message === "string" && message.message) showToast(message.message);
    return;
  }
  if (message.event === "network-request") {
    th09OpenNetworkOverlay();
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
        finish(() => reject(new RuntimeSwitchedError()));
        return;
      }
      finish(() => reject(new Error(timeoutMessage)));
    }, 120000);
    unsubscribe = runtimeSessions.subscribe(() => {
      if (!runtimeSessionCurrent(session)) finish(() => reject(new RuntimeSwitchedError()));
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
      if (!runtimeSessionCurrent(session)) finish(() => reject(new RuntimeSwitchedError()));
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
  const gameId = state.game;
  const variant = state.runtimeVariant;
  const sourceEntry = runtimeUrl();
  const requestedIdentity = `package:${state.game}:${generation.id}:${state.runtimeVariant}:${state.replayViewer ? "replay" : "game"}`;
  if (state.ready && state.sourceIdentity === requestedIdentity) return true;
  const excluded: string[] = [];
  // One direct iframe, as required by the iOS lifecycle contract. Retry only a
  // complete earlier program before readiness, never individual loaded files.
  for (let attempt = 0; attempt < 3; attempt++) {
    resetRuntime();
    activeInstalledPackageGeneration = generation;
    const runtimeSession = await bindRuntimePackageSession(generation);
    managedRuntimeGenerationLease.bind(gameId, generation);
    state.sourceIdentity = requestedIdentity;
    clearGameDataAttempt();
    setPlayerStatus(t("runtime.preparingLocal"));
    showTransfer({ kind: "game", mode: "runtime", title: t("runtime.preparingLocal"),
      label: t("runtime.localGameLabel", { game: gameId.toUpperCase() }), phase: "preparing", indeterminate: true });
    if (show) openPlayerView();
    let selectedGeneration: string | null = null;
    try {
      // Development workspaces intentionally use their live build URLs. A
      // published Host declares the immutable Runtime Manifest capability.
      let entry = sourceEntry;
      if ("runtimeManifest" in manifest.shared && manifest.shared.runtimeManifest) {
        const selected = await prepareRuntimeLaunch(sourceEntry, {
          exclude: excluded,
          worker: (async () => {
            try {
              await appShellClient?.ready;
              return (await navigator.serviceWorker?.getRegistration("./"))?.active || null;
            } catch { return null; }
          })(),
        });
        entry = selected.url;
        selectedGeneration = selected.generation;
      }
      if (!runtimeSessionCurrent(runtimeSession) || state.game !== gameId || state.runtimeVariant !== variant) {
        throw new RuntimeSwitchedError();
      }
      // gameGeneration is the Package Store identity, NOT the code generation.
      const source = new URL(managedRuntimeUrl(entry, generation, variant, location.href));
      source.searchParams.set(RUNTIME_EPOCH_QUERY_PARAMETER, String(runtimeSession.id));
      state.source = source.href;
      const runtimeReady = waitForRuntimeReady(runtimeSession, t("runtime.localLoadTimeout"));
      frame.src = state.source;
      await runtimeReady;
      return true;
    } catch (error) {
      const current = runtimeSessionCurrent(runtimeSession) && state.game === gameId && state.runtimeVariant === variant;
      if (current) resetRuntime();
      if (!current || !selectedGeneration || attempt === 2) throw error;
      excluded.push(selectedGeneration);
      console.warn(`${gameId}: Runtime bootstrap failed; trying a complete previous generation`, error);
    }
  }
  return false;
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
    const updated = await installPublishedPackageLazy(state.game, {
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
  const task = installPublishedPackageLazy(game, {
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
    const updated = await installPublishedPackageLazy(gameId, {
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
        const updated = await installPublishedPackageLazy(gameId, {
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
      await installPublishedPackageLazy(state.game, {
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
  // requires managed DATA (the retail-memory provider).
  if (!releaseCatalog?.games?.[state.game] && PRODUCT_GAMES[state.game].dataProvider === "retail-memory") {
    try {
      await installDevelopmentPackage(show);
      if (await ensureInstalledPackageRuntime(show)) return;
    } catch (error) {
      if (isCancelledDownload(error)) throw error;
      throw new GameDataAcquisitionError(errorMessage(error), { cause: error });
    }
    // retail-memory Runtimes cannot fetch/own retail DATA themselves. If the
    // development Host Manifest only declares the expected identity (no local
    // source) and Package Store has no installed generation, falling through
    // to the legacy direct-runtime path produces a misleading Runtime-side
    // "launch from eagler-touhou" error. Keep DATA acquisition in the Launcher
    // and offer the normal local-package import flow instead.
    throw new GameDataAcquisitionError(t("package.importServerNoFiles"));
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
  sourceUrl.searchParams.set(RUNTIME_EPOCH_QUERY_PARAMETER, String(runtimeSession.id));
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
  const product = PRODUCT_GAMES[state.game];
  if ("requiredShared" in product && product.requiredShared.length === 0) return [];
  const packageTargets = new Set<string>();
  const generation = activeInstalledPackageGeneration;
  if (generation) {
    for (const fileId of generation.descriptor.base?.files || []) {
      if (!generation.files?.[fileId]?.objectId) continue;
      const target = generation.descriptor.files?.[fileId]?.target;
      if (typeof target === "string" && target) packageTargets.add(target);
    }
  }
  const shared = record(manifest.shared) ?? {};
  const vanillaFont = shared.vanillaFont;
  const unicodeFont = shared.unicodeFont;
  const wanted: Array<{ target: string; network: string }> = [];
  const addHosted = (target: string, network: unknown) => {
    if (typeof network !== "string" || !network) {
      throw new GameDataAcquisitionError(generation
        ? t("package.missingRequiredResource", { resource: target.slice(1) })
        : t("runtime.sharedFontManifestInvalid"));
    }
    wanted.push({ target, network });
  };
  if (language === "ja" && !packageTargets.has("/msgothic.ttc")) {
    addHosted("/msgothic.ttc", vanillaFont);
  }
  if ((language !== "ja" || state.options.thpracEnabled) && !packageTargets.has("/unifont.otf")) {
    addHosted("/unifont.otf", unicodeFont);
  }
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

type ReplayMutationQueue = ReturnType<ReplayFeatureModule["createReplayMutationQueue"]>;
let replayMutationQueue: ReplayMutationQueue | null = null;
async function getReplayMutationQueue(): Promise<ReplayMutationQueue> {
  if (replayMutationQueue) return replayMutationQueue;
  const replay = await loadReplayFeature();
  return replayMutationQueue ??= replay.createReplayMutationQueue();
}
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
  const replay = kind === "replay" ? await loadReplayFeature() : null;
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
      const exportPaths = replay!.selectReplayExportPaths(storedFiles.map(file => file.path));
      if (!exportPaths.some(replay!.isReplayFilePath)) throw new Error(t("file.noReplayToExport"));
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
        const file = await pickFile(missingSave ? ".dat" : replay!.replayImportAccept);
        if (file) await importFile(missingSave ? "save" : "replay", file);
      }
      return;
    }
    showToast(t("file.exportFailed", { kind: label, reason: errorMessage(error) }));
    throw error;
  }
}
async function importFileExclusive(kind: ImportFileKind, file: File) {
  const replay = kind === "replay" ? await loadReplayFeature() : null;
  if (!file.size) throw new Error(t("file.emptyImport"));
  if (file.size > maxImportBytes) throw new Error(t("file.importTooLarge"));
  if (kind === "save" && state.launched) {
    // Match the established preload-Runtime lifecycle: never tear down a
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
    const replayName = replay!.allocateReplayName(replayPrefix(), existing, file.name);
    if (!replayName) throw new Error(t("file.replaySlotsExhausted"));
    files = [{ path: `replay/${replayName}`, bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && lowerName.endsWith(".zip")) {
    const zip = await ensureFflate();
    if (!zip?.unzipSync) throw new Error(t("file.zipComponentMissing"));
    const guard = replay!.createReplayArchiveExtractionGuard({
      maxFileBytes: maxStoredFileBytes,
      maxExpandedBytes: maxReplayArchiveExpandedBytes,
    });
    let archive: Record<string, Uint8Array>;
    try {
      archive = zip.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: guard.filter });
    } catch (error) {
      if (error instanceof replay!.ReplayArchiveScanError) {
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
    const plan = replay!.planReplayArchiveImport(replayPrefix(), guard.paths, existing);
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
  if (kind !== "replay") return importFileExclusive(kind, file);
  const mutations = await getReplayMutationQueue();
  return mutations.run(() => importFileExclusive(kind, file));
}

async function refreshReplayManager({ animateRows = false } = {}) {
  const replay = await loadReplayFeature();
  const replayMutations = await getReplayMutationQueue();
  const storedFiles = await listReplayStorageFiles();
  const storedPaths = storedFiles.map(file => file.path);
  const files = storedFiles.filter(file => replay.isReplayFilePath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
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
      if (!replay.isValidReplayName(replayPrefix(), renamed.trim())) throw new Error(t("replay.nameInvalid", { prefix: replayPrefix() }));
      const target = `replay/${renamed.trim()}`;
      if (target.toLowerCase() === file.path.toLowerCase()) return;
      await replayMutations.run(async () => {
        const currentPaths = (await listReplayStorageFiles()).map(entry => entry.path);
        if (!replay.isReplayTargetAvailable(currentPaths, target)) throw new Error(t("replay.nameExists"));
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
    const idle = replayMutationQueue?.idle() ?? Promise.resolve();
    void idle.then(() => {
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
    const replay = await loadReplayFeature();
    if (!replay.isReplayImportFileName(files[0].name)) throw new Error(t("replay.dropType"));
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
$("#mpSettingsRoomDrawer").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); setMpSettingsRoomDrawerOpen(false); }
  if (event.key !== "Tab") return;
  const controls = Array.from($("#mpSettingsRoomDrawer").querySelectorAll<HTMLElement>(
    'button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
  )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden");
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first && last) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last && first) {
    event.preventDefault(); first.focus();
  }
});
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
$("#mpFocusHitboxToggle").addEventListener("click", () => setOption("focusHitboxEnabled", !state.options.focusHitboxEnabled));
$("#mpShareSettingsToggle").addEventListener("click", () => {
  saveGamePreferences();
  mpShareSingleplayerSettings = !mpShareSingleplayerSettings;
  multiplayerPreferences.persistShareSingleplayerSettings(state.product, mpShareSingleplayerSettings);
  restoreGamePreferences(state.game, currentPreferenceId());
  if ((mpControlModesSupported || mpUiState.room?.disableCheatMovement) && mpUiState.room?.phase === "lobby" && mpUiState.seat != null) {
    mpLobbySend({ type: "movement", movementMode: state.options.touchMovementMode, touchEnabled: state.options.touchEnabled, mobileDevice: mobileDevice || state.options.touchEnabled });
    void mpEnsureMovementAllowed();
  }
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
$("#mpLocalPlayerVisibilityToggle").addEventListener("click", () => setOption("multiplayerLocalPlayerVisibility", !state.options.multiplayerLocalPlayerVisibility));
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
$("#th09NetworkClose").addEventListener("click", () => th09CloseNetworkOverlay(true));
$("#th09NetworkCreate").addEventListener("click", () => th09EnterNetworkRoom(mpGenerateRoomCode(), true));
$("#th09NetworkCode").addEventListener("input", () => {
  const field = $("#th09NetworkCode");
  field.value = mpNormalizeRoomCode(field.value);
});
$("#th09NetworkJoin").addEventListener("click", () => {
  const code = mpNormalizeRoomCode($("#th09NetworkCode").value);
  if (!code) { showToast(t("status.enterRoomCode")); return; }
  th09EnterNetworkRoom(code, false);
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
    if (error instanceof RuntimeSwitchedError) return;
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
  if (await copyText(mpUiState.room.code)) showToast(t("status.roomCodeCopied"));
  else showToast(t("status.roomCode", { code: mpUiState.room.code }));
}
$("#mpCopyRoomCode").addEventListener("click", mpCopyRoomCode);
// The room action must work even when WebView history traversal is ignored or
// the previous entry is another panel on this same room URL.
$("#mpLeaveRoom").addEventListener("click", () => mpLeaveRoom());
$("#mpRoomSettingsToggle").addEventListener("click", () => {
  mpUiState.roomSettingsOpen = true;
  openRoomPanel("game", $("#mpRoomSettingsToggle"));
  renderMpRoom();
});
document.getElementById("mpTakeHostSeat")!.addEventListener("click", () => mpTakeSeat(0));
$("#mpRoomPlayerCount").addEventListener("change", event => {
  const room = mpUiState.room;
  if (!room || !mpRoomOwnerLocal() || !mpLobby.connected) return;
  const count = mpNormalizePlayerCount($("#mpRoomPlayerCount").value);
  room.playerCount = count;
  if (mpUiState.seat != null && mpUiState.seat >= count) mpUiState.seat = null;
  mpSendRoomSettings();
  renderMpRoom();
});
$("#mpRoomDifficulty").addEventListener("change", event => {
  const room = mpUiState.room;
  if (!room || !mpRoomOwnerLocal() || !mpLobby.connected) return;
  room.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number($("#mpRoomDifficulty").value) || 0));
  mpSendRoomSettings();
  renderMpRoom();
});
document.querySelectorAll<HTMLElement>("[data-mp-player-count]").forEach(button => button.addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  $("#mpRoomPlayerCount").value = String(mpNormalizePlayerCount(button.dataset.mpPlayerCount));
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

// One native modal owns secondary room controls, focus containment and Escape.
const roomPanel = document.querySelector<HTMLDialogElement>("#mpRoomPanel")!;
let roomPanelTrigger: HTMLElement | null = null;
let roomPanelClosing = false;
function closeRoomPanel(fromHistory = false) {
  if (!roomPanel.open || roomPanelClosing) return;
  if (!fromHistory && history.state?.[mpPanelHistoryKey]) {
    history.back();
    return;
  }
  if (state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) { roomPanel.close(); return; }
  roomPanelClosing = true;
  const motion = roomPanel.animate([{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(14px) scale(.985)" }], { duration: 160, easing: "cubic-bezier(.4,0,1,1)" });
  void motion.finished.catch(() => {}).then(() => { roomPanelClosing = false; if (roomPanel.open) roomPanel.close(); });
}

roomPanel.addEventListener("cancel", event => { event.preventDefault(); closeRoomPanel(); });
function openRoomPanel(kind: "personal" | "network" | "spectators" | "game", trigger: HTMLElement) {
  roomPanelTrigger = trigger;
  roomPanel.dataset.panel = kind;
  document.querySelectorAll<HTMLElement>("[data-room-panel]").forEach(panel => { panel.hidden = panel.dataset.roomPanel !== kind; });
  document.getElementById("mpRoomPanelTitle")!.textContent = t(kind === "personal" ? "room.playerOptions" : kind === "network" ? "room.network" : kind === "game" ? "multiplayer.gameSettings" : "room.spectatorLounge");
  $("#mpSpectatorToggle").setAttribute("aria-expanded", String(kind === "spectators"));
  if (!roomPanel.open) {
    applyHistoryOperations(history, [roomPanelHistoryOperation({
      currentUrl: location.href,
      currentState: history.state,
    })]);
    roomPanel.showModal();
  }
}
roomPanel.addEventListener("close", () => {
  mpUiState.roomSettingsOpen = false;
  $("#mpRoomSettingsToggle").setAttribute("aria-expanded", "false");
  $("#mpSpectatorToggle").setAttribute("aria-expanded", "false");
  roomPanelTrigger?.focus();
});
roomPanel.addEventListener("click", event => {
  if (event.target !== roomPanel) return;
  const rect = roomPanel.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRoomPanel();
});
document.getElementById("mpRoomPanelClose")!.addEventListener("click", () => closeRoomPanel());
$("#mpSpectatorToggle").addEventListener("click", () => openRoomPanel("spectators", $("#mpSpectatorToggle")));
document.getElementById("mpNetworkToggle")!.addEventListener("click", event => {
  const trigger = (event.target as Element).closest<HTMLButtonElement>("button[data-network-peer]");
  if (!trigger) return;
  roomPanel.dataset.networkPeer = trigger.dataset.networkPeer;
  openRoomPanel("network", trigger);
  renderRoomNetwork();
});
$("#mpSeatStage").addEventListener("click", event => {
  const trigger=(event.target as Element).closest<HTMLButtonElement>(".mp-seat-latency[data-network-peer]");
  if(!trigger || trigger.disabled)return;
  roomPanel.dataset.networkPeer=trigger.dataset.networkPeer;
  openRoomPanel("network", trigger);
  renderRoomNetwork();
});
$("#mpRoomNetworkRetry").addEventListener("click", () => { roomNetwork.retry(roomPanel.dataset.networkPeer); renderMpRoom(); });
$("#mpDisplayName").addEventListener("change", () => mpSetDisplayName($("#mpDisplayName").value));
$("#mpDisplayName").addEventListener("blur", () => mpSetDisplayName($("#mpDisplayName").value));
$("#mpLoadoutPrev").addEventListener("click", () => mpSetLoadout(-1));
$("#mpLoadoutNext").addEventListener("click", () => mpSetLoadout(1));
$("#mpLoadoutPrevSeat").addEventListener("click", () => mpSetLoadout(-1));
$("#mpLoadoutNextSeat").addEventListener("click", () => mpSetLoadout(1));
$("#mpReady").addEventListener("click", async () => {
  if (mpUiState.seat == null || !mpLobby.connected) return;
  const room = mpUiState.room;
  const ready = !mpUiState.ready;
  if (ready && roomPreparation?.room === room && ["cancelled", "importing"].includes(roomPreparation.status)) return;
  if (ready && !await mpEnsureMovementAllowed()) return;
  if (mpUiState.room !== room || mpUiState.seat == null || room?.phase !== "lobby") return;
  if (!mpLobbySend({ type: "set-ready", ready, movementMode: state.options.touchMovementMode, touchEnabled: state.options.touchEnabled, mobileDevice: mobileDevice || state.options.touchEnabled })) return;
  mpUiState.ready = ready;
  renderMpRoom();
});
$("#mpRoomResourceCancel").addEventListener("click", () => {
  const preparation = roomPreparation;
  if (!preparation || preparation.room !== mpUiState.room || preparation.status !== "preparing" ||
      preparation.stage !== "package") return;
  preparation.status = "cancelled";
  preparation.controller.abort();
  if (mpUiState.ready) {
    mpLobbySend({ type: "set-ready", ready: false, movementMode: state.options.touchMovementMode,
      touchEnabled: state.options.touchEnabled, mobileDevice: mobileDevice || state.options.touchEnabled });
    mpUiState.ready = false;
  }
  renderMpRoom();
  beginManualGamePackageImport(undefined, captureGameDataContinuation("install-only"));
});
$("#mpRoomResourceRetry").addEventListener("click", () => {
  const preparation = roomPreparation;
  if (!preparation || preparation.room !== mpUiState.room ||
      (preparation.status !== "cancelled" && preparation.status !== "failed")) return;
  if (gameDataAttempt?.manual && gameDataAttempt.continuation?.kind === "install-only") clearGameDataAttempt();
  roomPreparation = null;
  void prepareRoomResources(preparation.room);
});
$("#mpCheckGame").addEventListener("click", () => { void mpCheckGame(); });
$("#mpStartGame").addEventListener("click", async () => {
  if (!mpRoomOwnerLocal() || !mpUiState.ready || !mpLobby.connected) return;
  if(["th08mp","th09mp","th10mp"].includes(state.product)){
    const recommendation=mpInputTimingRecommendation();
    const chosen=Number(document.querySelector<HTMLSelectElement>("#mpInputDelay")?.value);
    const inputDelay=Number.isInteger(chosen)&&chosen>=0&&chosen<=8?chosen:recommendation.inputDelay;
    mpLobbySend(state.product==="th08mp"?{ type: "start", inputDelay, predictionLimit: 8 }:{ type: "start", inputDelay });
  }else mpLobbySend({ type: "start" });
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
        const accept = kind === "replay" ? (await loadReplayFeature()).replayImportAccept : ".dat";
        const file = await pickFile(accept);
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
  $("#touchLayoutOrientation").textContent = t(orientation === "landscape" ? "touch.landscape" : "touch.portrait");
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

function syncTouchLayoutWorkbench() {
  const panel = $("#touchLayoutEditor");
  panel.classList.toggle("is-collapsed", touchLayoutEditorCollapsed);
  $("#touchWorkbenchBody").hidden = touchLayoutEditorCollapsed;
  const collapse = $("#touchLayoutCollapse");
  collapse.setAttribute("aria-expanded", String(!touchLayoutEditorCollapsed));
  const collapseLabel = touchLayoutEditorCollapsed ? "touch.expandPanel" : "touch.collapsePanel";
  collapse.dataset.i18nAriaLabel = collapseLabel;
  collapse.setAttribute("aria-label", t(collapseLabel));
  const settings = touchLayoutSettingsElement();
  if (settings) settings.hidden = false;
  closeOtherCustomSelects();
  if (touchLayoutEditing) clampTouchLayoutEditorPosition();
}

function touchLayoutSettingsElement() {
  return document.querySelector<HTMLElement>("#touchLayoutSettingsPanel");
}

const touchLayoutWindowMargin = 16;
const touchLayoutWindowPositions = createTouchLayoutWindowPositionStore({ storage: localStorage });
let touchLayoutWindowOrientation: TouchLayoutOrientation | null = null;

function rememberTouchLayoutWindowsNow() {
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
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
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("transform");
}

function positionTouchLayoutWindowsInitial() {
  const panel = $("#touchLayoutEditor");
  const host = player.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const portrait = host.height > host.width;
  panel.style.left = `${portrait ? (host.width - rect.width) / 2 : host.width - rect.width - touchLayoutWindowMargin}px`;
  panel.style.top = `${Math.min(76, Math.max(touchLayoutWindowMargin, host.height - rect.height - touchLayoutWindowMargin))}px`;
  panel.style.transform = "none";
}

function positionTouchLayoutWindows() {
  touchLayoutWindowPositions.reload();
  positionTouchLayoutWindowsInitial();
  restoreTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
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
}

function beginTouchLayoutEditorDrag(event: PointerEvent) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  cancelTouchLayoutEntry();
  const panel = $("#touchLayoutEditor");
  const host = player.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${rect.left - host.left}px`;
  panel.style.top = `${rect.top - host.top}px`;
  panel.style.transform = "none";
  touchLayoutEditorDrag = {
    pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    left: rect.left - host.left, top: rect.top - host.top,
    maxLeft: Math.max(touchLayoutWindowMargin, host.width - rect.width - touchLayoutWindowMargin),
    maxTop: Math.max(touchLayoutWindowMargin, host.height - rect.height - touchLayoutWindowMargin),
  };
  try { $("#touchLayoutEditorDragHandle").setPointerCapture(event.pointerId); } catch {}
}

function moveTouchLayoutEditorDrag(event: PointerEvent) {
  if (!touchLayoutEditorDrag || event.pointerId !== touchLayoutEditorDrag.pointerId) return;
  event.preventDefault();
  const panel = $("#touchLayoutEditor");
  const dx = event.clientX - touchLayoutEditorDrag.x;
  const dy = event.clientY - touchLayoutEditorDrag.y;
  touchLayoutEditorDrag.x = event.clientX;
  touchLayoutEditorDrag.y = event.clientY;
  touchLayoutEditorDrag.left = Math.max(touchLayoutWindowMargin, Math.min(touchLayoutEditorDrag.maxLeft, touchLayoutEditorDrag.left + dx));
  touchLayoutEditorDrag.top = Math.max(touchLayoutWindowMargin, Math.min(touchLayoutEditorDrag.maxTop, touchLayoutEditorDrag.top + dy));
  panel.style.left = `${touchLayoutEditorDrag.left}px`;
  panel.style.top = `${touchLayoutEditorDrag.top}px`;
}

function endTouchLayoutEditorDrag(event?: PointerEvent) {
  if (!touchLayoutEditorDrag || (event && event.pointerId !== touchLayoutEditorDrag.pointerId)) return;
  const pointerId = touchLayoutEditorDrag.pointerId;
  touchLayoutEditorDrag = null;
  try { $("#touchLayoutEditorDragHandle").releasePointerCapture(pointerId); } catch {}
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
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
  const gain = Math.min(TOUCH_SENSITIVITY_MAX, Math.max(TOUCH_SENSITIVITY_MIN, state.options.touchSensitivity)) / 100;
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

function cancelTouchLayoutEntry() {
  for (const animation of touchLayoutEntryAnimations) animation.cancel();
  touchLayoutEntryAnimations = [];
  player.classList.remove("touch-layout-preparing");
}

function animateTouchLayoutEntry() {
  cancelTouchLayoutEntry();
  if (state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Start only after fullscreen and positioning settle. Animate composited
  // properties, never the viewport geometry or the preview image's filter.
  const animations = [
    player.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 340, easing: "cubic-bezier(.2,0,.2,1)"
    })
  ];
  touchLayoutEntryAnimations = animations;
  for (const animation of animations) animation.onfinish = () => {
    animation.cancel();
    touchLayoutEntryAnimations = touchLayoutEntryAnimations.filter(active => active !== animation);
  };
}

async function openTouchLayoutEditor() {
  if (touchLayoutEditing) return;
  if (state.launched) throw new Error(t("touch.editWhileRunning"));
  touchLayoutEditing = true;
  cancelTouchLayoutEntry();
  player.classList.add("touch-layout-preparing");
  touchViewportEditing = false;
  touchViewportDrag = null;
  touchLayoutDraft = cloneTouchLayout(touchLayout) || emptyTouchLayout();
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchSensitivityCustomOpen = false;
  cancelTouchSensitivityPreview();
  touchLayoutSelected = "bomb";
  touchLayoutEditorEnteredFullscreen = false;
  touchLayoutWindowOrientation = null;
  resetTouchLayoutEditorPosition();
  player.style.setProperty("--touch-preview-image", cardArtworkCss());
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview", "touch-layout-edit");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = true;
  $("#touchLayoutEditor").hidden = false;
  const settings = touchLayoutSettingsElement();
  if (!settings) throw new Error(t("touch.settingsMissing"));
  touchLayoutEditorCollapsed = false;
  syncTouchLayoutWorkbench();
  render();
  pushTouchLayoutEditorHistory();
  const wasFullscreen = isPlayerFullscreen();
  try {
    await enterPlayerFullscreen({ focusGame: false });
    touchLayoutEditorEnteredFullscreen = !wasFullscreen && isPlayerFullscreen();
  } catch (error) {
    touchLayoutEditorEnteredFullscreen = false;
    showToast(t("fullscreen.autoBlocked", { reason: errorMessage(error) }));
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (!touchLayoutEditing) return;
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
  animateTouchLayoutEntry();
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

function pushTouchLayoutEditorHistory() {
  if (touchLayoutHistoryEntryOwned) return;
  applyHistoryOperations(history, [touchLayoutEditorHistoryOperation({
    currentUrl: location.href,
    currentState: history.state,
  })]);
  touchLayoutHistoryEntryOwned = true;
}

function consumeTouchLayoutEditorHistory() {
  if (!touchLayoutHistoryEntryOwned) return;
  const ownsCurrentEntry = !!history.state?.[touchLayoutHistoryKey];
  touchLayoutHistoryEntryOwned = false;
  if (ownsCurrentEntry) history.back();
}

async function closeTouchLayoutEditor(): Promise<boolean> {
  if (!touchLayoutEditing) return true;
  if (touchViewportEditing) finishTouchViewportEditing();
  if (touchLayoutHasUnsavedChanges() && !await askConfirmation({
    message: t("touch.layoutDiscardConfirm"),
    confirmText: t("touch.discardChanges"),
    tone: "danger"
  })) return false;
  rememberTouchLayoutWindowsNow();
  cancelTouchLayoutEntry();
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchViewportDrag = null;
  touchViewportEditing = false;
  touchLayoutEditing = false;
  touchSensitivityCustomOpen = false;
  touchLayoutDraft = null;
  $("#touchLayoutEditor").hidden = true;
  const settings = touchLayoutSettingsElement();
  if (settings) settings.hidden = true;
  player.classList.remove("touch-layout-edit", "touch-preview", "open", "touch-layout-manipulating");
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
  return true;
}

function rectOverlapRatio(a: DOMRect, b: DOMRect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (!width || !height) return 0;
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function updateTouchLayoutWarnings() {
  if (!touchLayoutEditing) return;
  const names = visibleTouchLayoutControlNames();
  for (const name of touchLayoutControlNames) touchLayoutElement(name).classList.remove("touch-layout-collision");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = touchLayoutElement(names[i]);
      const b = touchLayoutElement(names[j]);
      if (rectOverlapRatio(a.getBoundingClientRect(), b.getBoundingClientRect()) >= .28) {
        a.classList.add("touch-layout-collision");
        b.classList.add("touch-layout-collision");
      }
    }
  }
  const reserved = $("#touchLayoutReservedZone").getBoundingClientRect();
  for (const name of names) {
    const element = touchLayoutElement(name);
    if (rectOverlapRatio(element.getBoundingClientRect(), reserved) >= .18) {
      element.classList.add("touch-layout-collision");
    }
  }
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

function beginTouchLayoutDrag(name: TouchLayoutControlName, event: PointerEvent) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  cancelTouchLayoutEntry();
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
  player.classList.add("touch-layout-manipulating");
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
  player.classList.remove("touch-layout-manipulating");
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
  syncTouchLayoutWorkbench();
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
  touchLayoutDrag = null;
  touchLayoutEditorDrag = null;
  touchViewportDrag = null;
  player.classList.remove("touch-layout-manipulating");
  cancelTouchSensitivityPreview();
}

type MpLoadout = NonNullable<LauncherGameView["multiplayer"]>["loadouts"][number];
const mpLoadouts = (): readonly MpLoadout[] => game().multiplayer?.loadouts || [];
const mpLoadoutLabel = (loadout: MpLoadout) => t(loadout.labelKey as UiMessageKey);
const mpBootstrapLoadoutIndexes = () => {
  const loadouts = mpLoadouts();
  const seen = new Set<number>();
  const primary = loadouts.flatMap((loadout, index) => {
    if (seen.has(loadout.character)) return [];
    seen.add(loadout.character);
    return [index];
  });
  const candidates = primary.length ? primary : [0];
  return Array.from({ length: 3 }, (_, index) => candidates[index % candidates.length] ?? 0);
};
const mpLoadoutCount = () => mpLoadouts().length;
const mpNormalizeLoadoutIndex = (index: unknown) => {
  const count = mpLoadoutCount();
  if (count <= 0) return 0;
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
      visibility: mpUiState.room.visibility,
      disableCheatMovement: mpUiState.room.disableCheatMovement,
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

function mpFromDirectory() { return new URL(location.href).searchParams.get("fromLobby") === "1"; }
function mpReturnToDirectory() {
  const target = new URL("lobby.html", location.href);
  target.searchParams.set("game", state.product);
  // Referrer identifies the source document, not the immediately preceding
  // history entry after room settings/panels have added their own entries.
  location.replace(target.href);
}

function mpRestoreRoomFromLocation() {
  const code = mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
  if (!code) return false;
  const routedProduct = isMultiplayerProduct(state.product) ? state.product : DEFAULT_MULTIPLAYER_PRODUCT_ID;
  // A room URL opened directly has no guaranteed same-document home entry.
  // Seed one once, then push the room route so the browser Back action is as
  // deterministic as the in-page return button. A managed room entry keeps
  // this marker across refreshes and must not grow history again.
  if (mpFromDirectory()) history.replaceState({ ...history.state, [mpRoomHistoryKey]: code }, "", location.href);
  else applyHistoryOperations(history, directRoomHistorySeed({
    currentUrl: location.href,
    currentState: history.state,
    roomCode: code,
  }));
  const saved = multiplayerRoomSessions.load({
    product: routedProduct,
    roomCode: code,
    playerCounts: mpPlayerCounts(routedProduct),
    difficulties: multiplayerConfigForProduct(routedProduct)?.difficulties || [],
  });
  const requested = new URL(location.href).searchParams;
  const createdInDirectory = mpFromDirectory() && requested.get("lobbyAction") === "create";
  const requestedCount = Number(requested.get("lobbyPlayers")) as 2 | 3;
  const playerCount = saved?.room.playerCount ?? (createdInDirectory && mpPlayerCounts(routedProduct).includes(requestedCount) ? requestedCount : mpDefaultPlayerCount(routedProduct));
  const difficulty = saved?.room.difficulty ?? (createdInDirectory ? Math.max(0, Math.min((multiplayerConfigForProduct(routedProduct)?.difficulties.length || 1) - 1, Math.trunc(Number(requested.get("lobbyDifficulty")) || 0))) : 1);
  const seat = saved?.seat ?? (createdInDirectory ? 0 : null);
  mpUiState.room = {
    code, playerCount, difficulty, created: createdInDirectory || !!saved?.room.created,
    visibility: saved?.room.visibility ?? (requested.get("lobbyVisibility") === "private" ? "private" : "public"),
    disableCheatMovement: saved?.room.disableCheatMovement ?? requested.get("lobbyDisableCheatMovement") === "1",
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
  mpLobbyStopped = false;
  mpDirectoryAutoSeat = false;
  mpLobbyIntent = created ? "create" : "join";
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // A relay room is ephemeral: once every lobby/game client leaves, recreating
  // the same room code starts its server-side startSerial from zero again.
  // Do not carry the previous room session's serial into a fresh join, or the
  // next `start` (normally serial=1) will be mistaken for an old event.
  mpLobby.startSerial = 0;
  const timingChoice=document.querySelector<HTMLSelectElement>("#mpInputDelay");
  if(timingChoice)timingChoice.value="auto";
  mpUiState.room = {
    code, playerCount: mpDefaultPlayerCount(), difficulty: 1, created: !!created,
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
  void prepareRoomResources();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  setTranslatedStatus(created ? "status.roomCreated" : "status.roomJoined", { code });
}

function mpResetRoomState() {
  hideRoomLaunchCover();
  roomPreparation?.controller.abort();
  roomPreparation = null;
  reportedResourceSocket = null;
  reportedResourceKey = "";
  mpDisconnectLobby();
  mpLobby.startSerial = 0;
  mpUiState.room = null;
  mpUiState.seat = null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = false;
  mpUiState.roomSettingsOpen = false;
  multiplayerRoomSessions.clear(state.product);
}

function mpSendRoomSettings() {
  const room = mpUiState.room;
  if (!room || mpUiState.seat !== 0) return;
  mpLobbySend({ type: "settings", playerCount: room.playerCount, difficulty: room.difficulty,
    visibility: room.visibility || "public", disableCheatMovement: !!room.disableCheatMovement });
}

document.querySelectorAll<HTMLButtonElement>("[data-room-visibility], [data-room-cheat]").forEach(button => button.addEventListener("click", () => {
  const room = mpUiState.room;
  if (!room || !mpRoomOwnerLocal() || !mpLobby.connected || room.phase !== "lobby") return;
  mpLobbySend({ type: "settings", playerCount: room.playerCount, difficulty: room.difficulty,
    visibility: button.dataset.roomVisibility ?? room.visibility ?? "public",
    disableCheatMovement: button.dataset.roomCheat != null ? button.dataset.roomCheat === "1" : !!room.disableCheatMovement });
}));

let mpMovementDecision: Promise<boolean> | null = null;
function mpEnsureMovementAllowed(): Promise<boolean> {
  const room = mpUiState.room;
  if (!room?.disableCheatMovement || state.options.touchMovementMode !== "touch-unlimited") return Promise.resolve(true);
  if (mpMovementDecision) return mpMovementDecision;
  mpMovementDecision = askDecision({ title: t("room.movementRequired"), message: t("room.movementRequiredHint"),
    confirmText: t("room.useTouch"), secondaryText: t("room.useJoystick"), cancelText: t("action.cancel") })
    .then(choice => {
      if (choice === "cancel" || mpUiState.room !== room) return false;
      setOption("touchMovementMode", choice === "secondary" ? "joystick" : "touch");
      return true;
    }).finally(() => { mpMovementDecision = null; });
  return mpMovementDecision;
}

let mpRoomReturnTimer: number | null = null;
function mpLeaveRoom() {
  if (th09NetworkOverlayOpen()) { th09LeaveNetworkRoom(); return; }
  if (!mpUiState.room) return;
  if (roomLaunchHome && player.classList.contains("open")) {
    void closePlayerView(false, { skipSync: true, returnToMpRoom: true }).then(closed => { if (closed) mpLeaveRoom(); });
    return;
  }
  const reducedMotion = state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Commit departure immediately; only the destination animates. Waiting for
  // the room to fade first stalls both the return button and system Back.
  mpResetRoomState();
  // Clear modal/inert state synchronously; no overlay history traversal or
  // exit animation may keep the destination blocked after the room is gone.
  setMpSettingsRoomDrawerOpen(false, true);
  if (roomPanel.open) roomPanel.close();
  roomPanelClosing = false;
  if (mpFromDirectory()) { mpReturnToDirectory(); return; }
  if (mpRoomReturnTimer !== null) window.clearTimeout(mpRoomReturnTimer);
  mpRoomReturnTimer = null;
  document.body.classList.toggle("mp-room-returning", !reducedMotion);
  applyHistoryOperations(history, [launcherOptionsHistoryOperation({
    currentUrl: location.href,
    currentState: history.state,
    product: state.product,
  })]);
  state.hasSelection = true;
  render();
  $("#libraryBack").focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  setTranslatedStatus("status.roomLeft");
  if (!reducedMotion) {
    mpRoomReturnTimer = window.setTimeout(() => {
      document.body.classList.remove("mp-room-returning");
      mpRoomReturnTimer = null;
    }, 180);
  }
}

const mpSeatPresentations = new WeakMap<HTMLElement, { room: string; occupant: string; animations: Animation[] }>();
function mpAnimateSeatContents(seat: HTMLElement, occupant: string) {
  const room = mpUiState.room;
  const previous = mpSeatPresentations.get(seat);
  if (previous && previous.room === room?.code && previous.occupant === occupant) return;
  previous?.animations.forEach(animation => animation.cancel());
  const presentation = { room: room?.code || "", occupant, animations: [] as Animation[] };
  mpSeatPresentations.set(seat, presentation);
  if (!previous || previous.room !== room?.code || !room?.synced || seat.hidden ||
      state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Only the changed content fades. Seat boundaries and the dock never travel.
  for (const child of seat.querySelectorAll<HTMLElement>(":scope > .mp-seat-face, :scope > .mp-seat-index, :scope > .mp-seat-name, :scope > .mp-seat-state")) {
    if (child.hidden || typeof child.animate !== "function") continue;
    const animation = child.animate([{ opacity: .25 }, { opacity: 1 }], {
      duration: 180, easing: "cubic-bezier(.2,.8,.2,1)",
    });
    presentation.animations.push(animation);
  }
}

async function mpTakeSeat(index: number) {
  if (!mpUiState.room?.synced || !mpLobby.connected || !Number.isInteger(index) || index < 0 || index >= mpUiState.room.playerCount) return;
  if (index === mpUiState.seat || mpUiState.room.seats?.[index]) return;
  const room = mpUiState.room;
  if (!await mpEnsureMovementAllowed() || mpUiState.room !== room || room.phase !== "lobby" || room.seats?.[index]) return;
  mpLobbySend({
    type: "take-seat", seat: index, loadout: mpUiState.preferredLoadout,
    ready: mpUiState.ready, name: mpUiState.displayName,
    movementMode: state.options.touchMovementMode, touchEnabled: state.options.touchEnabled,
    mobileDevice: mobileDevice || state.options.touchEnabled,
  });
  // The lobby snapshot commits old/new occupancy together, including rejection.
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
  state.netplay.inputDelay = Number(room.inputDelay) || 0;
  state.netplay.predictionLimit = Number(room.predictionLimit) || 8;
  const loadouts = mpLoadouts();
  const bootstrapLoadouts = mpBootstrapLoadoutIndexes();
  state.netplay.loadouts = Array.from({ length: 3 }, (_, playerIndex) => {
    const loadoutIndex = mpNormalizeLoadoutIndex(room.seats?.[playerIndex]?.loadout ?? bootstrapLoadouts[playerIndex]);
    const loadout = loadouts[loadoutIndex] ?? loadouts[0];
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
  if (count <= 0) throw new Error(t("multiplayer.loadoutEmpty"));
  mpUiState.preferredLoadout = (mpNormalizeLoadoutIndex(mpUiState.preferredLoadout) + delta + count) % count;
  multiplayerPreferences.persistPreferredLoadout(state.product, mpUiState.preferredLoadout);
  if (mpUiState.seat != null) mpLobbySend({ type: "set-loadout", loadout: mpUiState.preferredLoadout });
  renderMpRoom();
}

function mpInputTimingRecommendation() {
  const room=mpUiState.room;
  const seats=room?.seats?.slice(0,room.playerCount) || [];
  const phones=seats.reduce((count,seat,index)=>count+(seat &&
    (seat.mobileDevice || (index===mpUiState.seat && (mobileDevice || state.options.touchEnabled)))?1:0),0);
  const peerIds=seats.flatMap(seat=>seat && seat.clientId!==mpLobby.clientId && !seat.offline ? [seat.clientId] : []);
  const rtt=roomNetwork.minimumRtt(peerIds);
  const rollbackLimit=state.product==="th10mp"?12:8;
  return recommendMultiplayerInputTiming(phones,rtt,0,rollbackLimit);
}

function renderRoomNetwork() {
  const container = document.getElementById("mpRoomNetworkRows");
  const room = mpUiState.room;
  if (!container || !room) return;
  const inputTimingSupported=["th08mp","th09mp","th10mp"].includes(state.product);
  if(inputTimingSupported){
    const advice=mpInputTimingRecommendation();
    const select=document.querySelector<HTMLSelectElement>("#mpInputDelay")!;
    const automatic=select.querySelector<HTMLOptionElement>('option[value="auto"]')!;
    const text=t("room.inputDelayAutomatic",{frames:advice.inputDelay,milliseconds:(advice.inputDelay*16.67).toFixed(2)});
    if(automatic.textContent!==text){automatic.textContent=text;syncCustomSelect(select);}
  }
  const peers = (room.seats || []).slice(0, room.playerCount).flatMap((seat, index) => seat && index !== mpUiState.seat ? [{ seat, index }] : []);
  const unavailable = !mpLobby.connected || !room.synced;
  const paused = room.phase !== "lobby" || (state.launched && !th09NetworkOverlayOpen());
  const message = unavailable ? t("multiplayer.reconnecting") : paused ? t("room.pausedTest") : mpUiState.seat == null ? t("room.seatToTest") : !peers.length ? t("room.waitPeer") : "";
  document.querySelectorAll<HTMLElement>("[data-mp-seat]").forEach(element=>{
    const index=Number(element.dataset.mpSeat);
    const seat=room.synced && index<room.playerCount ? room.seats?.[index] : null;
    const label=element.querySelector<HTMLButtonElement>(".mp-seat-latency")!;
    label.hidden=!seat;
    const local=seat?.clientId===mpLobby.clientId;
    label.disabled=local || !!message || !!seat?.offline;
    delete label.dataset.networkPeer;
    if(!seat)return;
    if(local){label.textContent=t("room.localDevice");label.removeAttribute("aria-label");return;}
    label.dataset.networkPeer=seat.clientId;
    const values=(["direct","turn"] as const).map(lane=>{
      const metric=roomNetwork.metric(seat.clientId,lane);
      const measured=!unavailable && !seat.offline && metric.state==="connected" && metric.rtt!=null;
      return `${t(`room.${lane}`)} ${measured?`${Math.max(1,Math.round(metric.rtt!))}ms`:"—"}`;
    });
    const text=values.join(" / ");
    if(label.textContent!==values.join(""))label.replaceChildren(...values.map(value=>{
      const lane=document.createElement("span");lane.textContent=value;return lane;
    }));
    label.setAttribute("aria-label",`${t("multiplayer.you")} → P${index+1} · ${text} · ${t("room.connections")}`);
  });
  const capabilities = roomNetwork.capabilities();
  const networkNote = document.querySelector<HTMLElement>("#mpRoomPanel .mp-network-footnote");
  if (networkNote) networkNote.textContent = t(unavailable ? "room.networkNote" : !capabilities.supported
    ? "room.probeUnsupported" : !capabilities.rtcAvailable ? "room.rtcUnavailable"
      : !capabilities.turnConfigured ? "room.turnUnconfigured" : "room.networkNote");
  const retry = document.querySelector<HTMLButtonElement>("#mpRoomNetworkRetry");
  if (retry) retry.disabled = !!message;
  const summary = document.getElementById("mpNetworkSummary");
  const peerLoadout = (seat: typeof peers[number]["seat"]) => mpLoadoutLabel(mpLoadouts()[mpNormalizeLoadoutIndex(seat.loadout)]!);
  const peerTitle = ({ seat, index }: typeof peers[number]) => `${t("multiplayer.you")} → P${index + 1} · ${peerLoadout(seat)}`;
  if (summary) {
    const noTeammates = !unavailable && !paused && !peers.length;
    document.getElementById("mpNetworkToggle")!.hidden = true;
    if (noTeammates) summary.replaceChildren();
    else if (message) summary.textContent = message;
    else {
      // Keep live buttons mounted while samples update, preserving keyboard focus.
      if (!summary.querySelector("button")) summary.replaceChildren();
      const existing = new Map(Array.from(summary.querySelectorAll<HTMLButtonElement>("button[data-network-peer]")).map(button => [button.dataset.networkPeer, button]));
      for (const peer of peers) {
        const { seat } = peer;
        let button = existing.get(seat.clientId);
        if (!button) {
          button = document.createElement("button"); button.type = "button"; button.className = "mp-peer-connection";
          button.dataset.networkPeer = seat.clientId; button.setAttribute("aria-haspopup", "dialog");
          const title = document.createElement("span"); title.className = "mp-peer-connection-title";
          const values = document.createElement("span"); values.className = "mp-peer-connection-values";
          const arrow = document.createElement("img"); arrow.className = "room-icon"; arrow.src = "assets/room-caret-right.svg"; arrow.alt = "";
          button.append(title, values, arrow); summary.append(button);
        }
        const title = peerTitle(peer);
        button.querySelector(".mp-peer-connection-title")!.textContent = title;
        button.querySelector(".mp-peer-connection-values")!.textContent = (["direct", "turn"] as const).map(lane => {
          const metric = roomNetwork.metric(seat.clientId, lane);
          const measured = !seat.offline && metric.state === "connected" && metric.rtt != null;
          return `${t(`room.${lane}`)} ${measured ? `${Math.max(1, Math.round(metric.rtt!))} ms` : t(seat.offline || metric.state === "unavailable" ? "room.unavailable" : "room.checking")}`;
        }).join(" · ");
        button.setAttribute("aria-label", `${title} · ${button.querySelector(".mp-peer-connection-values")!.textContent} · ${t("room.connections")}`);
        existing.delete(seat.clientId);
      }
      for (const button of existing.values()) button.remove();
    }
  }
  if (message) {
    if (container.textContent !== message) { const note = document.createElement("p"); note.className = "mp-network-empty"; note.textContent = message; container.replaceChildren(note); }
    return;
  }
  const selectedPeer = roomPanel.dataset.networkPeer;
  const detailPeers = selectedPeer ? peers.filter(({ seat }) => seat.clientId === selectedPeer) : peers;
  if (!detailPeers.length) {
    const note = document.createElement("p"); note.className = "mp-network-empty"; note.textContent = t("room.peerLeft"); container.replaceChildren(note); return;
  }
  container.replaceChildren(...detailPeers.map(({ seat, index }) => {
    const row = document.createElement("div"); row.className = "mp-network-peer";
    const name = document.createElement("div"); name.className = "mp-network-peer-name";
    const badge = document.createElement("span"); badge.textContent = `${t("multiplayer.you")} → P${index + 1}`;
    const label = document.createElement("strong"); label.textContent = peerLoadout(seat); name.append(badge, label); row.append(name);
    for (const lane of ["direct", "turn", "relay"] as const) {
      const metric = roomNetwork.metric(seat.clientId, lane);
      const cell = document.createElement("div"); cell.className = "mp-network-metric";
      const title = document.createElement("span"); title.textContent = t(`room.${lane}`);
      const value = document.createElement("strong");
      const measured = !seat.offline && metric.state === "connected" && metric.rtt != null;
      value.textContent = measured ? `${Math.max(1, Math.round(metric.rtt!))} ms` : t(seat.offline || metric.state === "unavailable" ? "room.unavailable" : "room.checking");
      cell.dataset.quality = measured ? metric.rtt! < 100 ? "good" : metric.rtt! < 200 ? "fair" : "poor" : "unknown";
      cell.append(title, value);
      const detail = document.createElement("small"); detail.textContent = measured && metric.jitter != null ? t("room.jitter", { value: Math.round(metric.jitter) }) : "—";
      cell.append(detail); row.append(cell);
    }
    return row;
  }));
}

function renderMpRoom() {
  const room = mpUiState.room;
  if (!room) return;
  const roomReady = room.synced === true && mpLobby.connected;
  roomNetwork.update({ localId: mpLobby.clientId, peers: (room.seats || []).slice(0, room.playerCount).filter(seat => seat && !seat.offline).map(seat => seat!.clientId), active: roomReady && mpUiState.seat != null && room.phase === "lobby" && (!state.launched || th09NetworkOverlayOpen()) });
  renderRoomNetwork();
  $("#mpRoomConnection").textContent = t(roomReady ? "room.online" : "multiplayer.reconnecting");
  $("#mpRoomConnection").classList.toggle("connected", roomReady);
  const preparation = roomPreparation?.room === room ? roomPreparation : null;
  $("#mpRoomPhase").textContent = t(player.classList.contains("mp-room-launch-cover") && roomLaunchStage === "path" ? "room.connectingGameplay"
    : player.classList.contains("mp-room-launch-cover") || room.phase === "starting" ? "room.starting" : room.phase === "running" ? "room.running"
    : preparation?.status === "preparing" ? "room.preparingResources"
      : preparation?.status === "importing" ? "package.importingSimple"
      : preparation?.status === "ready" ? "room.resourcesReady"
        : preparation?.status === "failed" ? "room.resourcesUnavailable" : "room.lobby");
  $("#mpRoomPhase").title = preparation?.status === "failed" ? preparation.error : "";
  renderRoomPreparationProgress();
  $("#mpRoomMode").textContent = t("room.coop", { count: room.playerCount });
  $("#mpRoomDifficultyBadge").textContent = game().multiplayer?.difficulties?.[room.difficulty] || "Normal";
  const ownerLocal = mpRoomOwnerLocal();
  mpUiState.preferredLoadout = mpNormalizeLoadoutIndex(mpUiState.preferredLoadout);
  const loadouts = mpLoadouts();
  const loadout = loadouts[mpUiState.preferredLoadout] ?? loadouts[0];
  if (!loadout) throw new Error(t("multiplayer.loadoutEmpty"));
  const difficultyLabels = game().multiplayer?.difficulties || [];
  $("#mpRoomTitle").textContent = game().title;
  $("#mpRoomView").setAttribute("aria-label", `${state.game.toUpperCase()} ${t("multiplayer.roomAria")}`);
  $("#mpRoomCode").textContent = room.code;
  $("#mpRoomPlayerCount").value = String(room.playerCount);
  $("#mpRoomDifficulty").value = String(room.difficulty);
  document.querySelectorAll<HTMLButtonElement>("[data-room-visibility], [data-room-cheat]").forEach(button => {
    const selected = button.dataset.roomVisibility != null
      ? button.dataset.roomVisibility === (room.visibility || "public")
      : (button.dataset.roomCheat === "1") === !!room.disableCheatMovement;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = !roomReady || !ownerLocal || room.phase !== "lobby" || selected;
  });
  // Room configuration is public to everyone; only P1 may mutate it.
  // Losing or acquiring P1 must update the open panel rather than close it.
  mpUiState.roomSettingsOpen = roomPanel.open && roomPanel.dataset.panel === "game";
  $("#mpRoomSettingsDrawer").hidden = false;
  $("#mpRoomSettings").hidden = !mpUiState.roomSettingsOpen;
  $("#mpRoomSettingsToggle").setAttribute("aria-expanded", String(mpUiState.roomSettingsOpen));
  $("#mpRoomSettingsToggle").classList.toggle("open", mpUiState.roomSettingsOpen);
  const takeHost = document.querySelector<HTMLButtonElement>("#mpTakeHostSeat")!;
  takeHost.hidden = !!room.seats?.[0] || ownerLocal;
  takeHost.disabled = !roomReady || room.phase !== "lobby";
  $("#mpRoomDifficultyText").textContent = difficultyLabels[room.difficulty] || "Normal";
  $("#mpSeatStage").dataset.playerCount = String(room.playerCount);
  $("#mpRoomPlayerCount").disabled = !roomReady || !ownerLocal;
  $("#mpRoomDifficulty").disabled = !roomReady || !ownerLocal;
  const inputTiming=document.getElementById("mpInputTiming");
  const inputTimingSupported=["th08mp","th09mp","th10mp"].includes(state.product);
  if(inputTiming)inputTiming.hidden=!inputTimingSupported;
  const inputDelay=document.querySelector<HTMLSelectElement>("#mpInputDelay");
  if(inputDelay){
    inputDelay.disabled=!roomReady||!ownerLocal||room.phase!=="lobby";
    // The existing room contract publishes timing at start, not while the host
    // previews a choice. Do not show teammates a guessed applied value.
    if(room.phase && room.phase!=="lobby")inputDelay.value=String(room.inputDelay||0);
    if(room.phase==="lobby" && !ownerLocal)inputDelay.dataset.triggerI18n="room.inputDelayHost";
    else delete inputDelay.dataset.triggerI18n;
    syncCustomSelect(inputDelay);
  }
  $("#mpRoomSettingsHint").textContent = t(ownerLocal ? "multiplayer.ownerLocalHint" : !room.seats?.[0] ? "room.hostAvailable" : "multiplayer.ownerRemoteHint");


  document.querySelectorAll<HTMLButtonElement>("[data-mp-player-count]").forEach(button => {
    const value = Number(button.dataset.mpPlayerCount);
    const supported = mpPlayerCounts().includes(value as 2 | 3);
    const selected = value === room.playerCount;
    button.hidden = !supported;
    button.classList.toggle("selected", selected);
    button.disabled = !supported || !roomReady || !ownerLocal || selected;
    button.setAttribute("aria-pressed", String(selected));
  });
  for (const option of $("#mpRoomPlayerCount").options) {
    const supported = mpPlayerCounts().includes(Number(option.value) as 2 | 3);
    option.disabled = !supported;
    option.hidden = !supported;
  }
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
    const seatIndex = seat.querySelector<HTMLElement>(".mp-seat-index");
    if (seatIndex) seatIndex.querySelector("span")!.textContent = `P${index + 1}`;
    seat.classList.toggle("occupied", occupied);
    seat.classList.toggle("owner", index === 0 && ownerLocal);
    seat.classList.toggle("reconnecting", !!networkSeat?.offline);
    seat.classList.toggle("is-ready", occupied && !!networkSeat?.ready);
    const nameLabel = seat.querySelector<HTMLElement>("[data-mp-seat-name]");
    const statusLabel = seat.querySelector<HTMLElement>("[data-mp-seat-state]");
    const seatLoadout = (networkSeat ? loadouts[mpNormalizeLoadoutIndex(networkSeat.loadout)] : loadout) || loadout;
    if (nameLabel) nameLabel.textContent = occupied ? mpLoadoutLabel(seatLoadout) : "";
    if (statusLabel) statusLabel.textContent = !occupied ? "" : t(networkSeat?.offline ? "multiplayer.playerReconnecting" : networkSeat?.ready ? "room.ready" : "room.notReady");
    seat.title = networkSeat?.offline ? t("multiplayer.playerReconnecting") : "";
    const drop = seat.querySelector<HTMLElement>("[data-mp-seat-drop]");
    const button = drop?.querySelector<HTMLButtonElement>("button");
    const glyph = seat.querySelector<HTMLElement>("[data-mp-seat-glyph]");
    const me = seat.querySelector<HTMLElement>("[data-mp-seat-me]");
    if (drop) drop.hidden = occupied;
    if (glyph) {
      glyph.hidden = !occupied;
      glyph.textContent = multiplayerDisplayInitial(networkSeat?.name ?? (mpUiState.seat === index ? mpUiState.displayName : ""), "?");
      seat.title = occupied ? mpLoadoutLabel(seatLoadout) : "";
    }
    let controlLabel = seat.querySelector<HTMLElement>(".mp-seat-control");
    if (!controlLabel) {
      controlLabel = document.createElement("span"); controlLabel.className = "mp-seat-control"; seat.append(controlLabel);
    }
    const controlMode = mpUiState.seat === index
      ? !state.options.touchEnabled || touchMovementUsesJoystick(state.options.touchMovementMode) ? "normal" : state.options.touchMovementMode === "touch-unlimited" ? "cheat" : "touch"
      : networkSeat?.controlMode;
    controlLabel.hidden = !occupied || !controlMode;
    controlLabel.textContent = controlMode ? t(`multiplayer.control.${controlMode}`) : "";
    controlLabel.dataset.mode = controlMode || "";
    let edit = seat.querySelector<HTMLButtonElement>(".mp-seat-edit");
    if (!edit) {
      edit = document.createElement("button"); edit.type = "button"; edit.className = "mp-seat-edit";
      edit.addEventListener("click", () => openRoomPanel("personal", edit!)); seat.append(edit);
    }
    edit.hidden = mpUiState.seat !== index || !occupied;
    edit.setAttribute("aria-label", t("room.playerOptions"));
    let remove = seat.querySelector<HTMLButtonElement>(".mp-seat-remove");
    if (!remove && index > 0) {
      remove = document.createElement("button"); remove.type = "button"; remove.className = "mp-seat-remove";
      remove.textContent = "×";
      remove.addEventListener("click", async () => {
        const currentRoom = mpUiState.room;
        const target = currentRoom?.seats?.[index];
        if (!currentRoom || !target || !mpRoomOwnerLocal() || !mpLobby.connected || currentRoom.phase !== "lobby") return;
        if (!await askConfirmation({ message: t("room.removePlayerConfirm", { seat: index + 1 }),
          confirmText: t("room.removePlayer", { seat: index + 1 }), tone: "danger" })) return;
        if (mpUiState.room !== currentRoom || !mpRoomOwnerLocal() || !mpLobby.connected ||
            currentRoom.phase !== "lobby" || currentRoom.seats?.[index]?.clientId !== target.clientId) return;
        mpLobbySend({ type: "remove-player", seat: index, clientId: target.clientId });
      });
      seat.append(remove);
    }
    if (remove) {
      remove.hidden = !roomReady || !ownerLocal || room.phase !== "lobby" || !networkSeat || index === 0;
      remove.setAttribute("aria-label", t("room.removePlayer", { seat: index + 1 }));
      remove.title = t("room.removePlayer", { seat: index + 1 });
    }
    if (me) me.hidden = mpUiState.seat !== index;
    if (button) {
      button.disabled = !roomReady || !active || occupied;
      button.textContent = `${t("multiplayer.join")} P${index + 1}`;
    }
    mpAnimateSeatContents(seat, occupied ? networkSeat?.clientId || mpLobby.clientId : "");
  });
  renderRoomSeatResourceProgress();

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
  const avatarStack = document.getElementById("mpSpectatorAvatars")!;
  avatarStack.replaceChildren(...spectatorEntries.slice(0, 3).map(entry => {
    const avatar = document.createElement("span"); avatar.textContent = multiplayerDisplayInitial(entry.name, "?"); return avatar;
  }));
  avatarStack.hidden = !spectatorEntries.length;
  for (const [spectatorIndex, entry] of spectatorEntries.entries()) {
    const row = document.createElement("div");
    row.className = "mp-spectator-entry";
    if (entry.clientId === mpLobby.clientId) row.classList.add("mine");
    const avatar = document.createElement("span");
    avatar.className = "mp-spectator-avatar";
    avatar.textContent = multiplayerDisplayInitial(entry.name, "?");
    const marker = document.createElement("span");
    marker.className = "mp-spectator-marker";
    marker.textContent = entry.clientId === mpLobby.clientId ? t("multiplayer.you") : "";
    const spectatorLabel = t("room.spectatorNumber", { number: spectatorIndex + 1 });
    row.title = spectatorLabel;
    const copy = document.createElement("div"); copy.className = "mp-spectator-copy";
    const name = document.createElement("strong"); name.textContent = spectatorLabel;
    const status = document.createElement("small"); status.textContent = t("room.watching");
    copy.append(name, status); row.append(avatar, copy, marker);
    if (ownerLocal && roomReady && room.phase === "lobby" && entry.clientId !== mpLobby.clientId) {
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "mp-spectator-remove"; remove.textContent = "×";
      remove.setAttribute("aria-label", t("room.removeSpectator"));
      remove.title = t("room.removeSpectator");
      remove.addEventListener("click", async () => {
        if (!await askConfirmation({ message: t("room.removeSpectatorConfirm"),
          confirmText: t("room.removeSpectator"), tone: "danger" })) return;
        if (mpUiState.room !== room || !mpRoomOwnerLocal() || !mpLobby.connected ||
            room.phase !== "lobby" || !room.spectators?.some(current => current.clientId === entry.clientId)) return;
        mpLobbySend({ type: "remove-spectator", clientId: entry.clientId });
      });
      row.append(remove);
    }
    spectatorList.append(row);
  }
  if (!spectatorEntries.length) {
    const empty = document.createElement("div");
    empty.className = "mp-spectator-empty";
    empty.textContent = t("status.noSpectators");
    spectatorList.append(empty);
  }
  const spectatorJoin = $("#mpSpectatorJoin");
  spectatorJoin.hidden = mpUiState.seat != null || game().multiplayer?.spectator === false;
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
  ready.disabled = !roomReady || mpUiState.seat == null || room.phase !== "lobby" || mpGameCheckInFlight ||
    (roomPreparation?.room === room && ["cancelled", "importing"].includes(roomPreparation.status) && !mpUiState.ready);
  ready.classList.toggle("ready", mpUiState.ready && mpUiState.seat != null);
  ready.setAttribute("aria-pressed", String(mpUiState.ready && mpUiState.seat != null));
  ready.textContent = t(mpUiState.ready && mpUiState.seat != null ? "multiplayer.readyDone" : "multiplayer.ready");
  const gameCheck = $("#mpCheckGame");
  gameCheck.hidden = mpUiState.seat == null || th09NetworkOverlayOpen();
  gameCheck.disabled = mpUiState.seat == null || (!!room.phase && room.phase !== "lobby") ||
    mpUiState.ready || mpGameCheckInFlight || mpLaunchInFlight;
  gameCheck.textContent = t(mpGameCheckInFlight ? "multiplayer.checkingGame" : "multiplayer.checkGame");
  const start = $("#mpStartGame");
  const synchronizedReady = roomReady && room.phase === "lobby" && Array.isArray(room.seats) &&
    room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
  start.hidden = !ownerLocal || !mpUiState.ready;
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
function cancelLauncherInteractionAnimations() {
  cancelCardLayoutMotion();
  cancelMobileHomeCards();
  for (const animation of $("#main").getAnimations({ subtree: true })) {
    try { animation.cancel(); } catch {}
  }
}
function captureCardLayout(): CardLayoutSnapshot | null {
  if ($("#main").classList.contains("library-layout")) return null;
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

initializeGameLibrary();
const mobileLibraryMotion = matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)");
let libraryToolsCloseTimer = 0;
function closeLibraryTools(fromHistory = false) {
  if (mpUiState.room) { setMpSettingsRoomDrawerOpen(false); return; }
  if (state.launched || !state.hasSelection || libraryToolsCloseTimer) return;
  if (!fromHistory && history.state?.[playerHistoryKey] && routedGameFromLocation() === state.product) {
    history.back();
    return;
  }
  const selected = document.querySelector<HTMLElement>(".game.selected");
  closeOtherCustomSelects();
  const finish = () => {
    libraryToolsCloseTimer = 0;
    if (state.hasSelection) {
      if (!fromHistory) replaceLauncherHomeHistory();
      state.hasSelection = false;
      $("#main").classList.remove("has-selection");
      document.body.classList.remove("library-tools-open");
      $(".game-library").inert = false;
      const tools = $(".tools");
      tools.setAttribute("role", "complementary");
      tools.setAttribute("aria-modal", "false");
      tools.setAttribute("aria-hidden", "true");
      for (const card of document.querySelectorAll<HTMLElement>(".game.selected")) {
        card.classList.remove("selected");
        if (card instanceof HTMLAnchorElement) card.setAttribute("aria-current", "false");
      }
    }
    document.body.classList.remove("library-tools-closing");
    selected?.focus({ preventScroll: true });
  };
  if (!mobileLibraryMotion.matches || state.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  // Let the panel exit before changing the library's selected state.
  document.body.classList.add("library-tools-closing");
  libraryToolsCloseTimer = window.setTimeout(finish, 360);
}
$("#libraryBack").addEventListener("click", () => closeLibraryTools());
$("#libraryBackdrop").addEventListener("click", () => closeLibraryTools());
$(".tools").addEventListener("keydown", event => {
  if (!document.body.classList.contains("library-tools-open") || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLibraryTools();
  } else if (event.key === "Tab") {
    const controls = [...$(".tools").querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length && getComputedStyle(control).visibility !== "hidden");
    const destination = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
      : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
    if (destination) { event.preventDefault(); destination.focus(); }
  }
});
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
    const prepareTools = main.classList.contains("library-layout") && mobileLibraryMotion.matches && !state.hasSelection && !state.lessMotion &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prepareTools) document.body.classList.add("library-tools-preparing");
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
    if (prepareTools) requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.remove("library-tools-preparing");
    }));
    animateCardLayout(previousLayout);
    $("#libraryBack").focus({ preventScroll: true });
    setTranslatedStatus(changed ? "status.switchedProduct" : "status.selectedProduct", { product: productTitle(product) });
    if (!main.classList.contains("library-layout") && mobileLite && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
$("#touchLayoutExit").addEventListener("click", () => {
  if (!touchLayoutEditing) return;
  void closeTouchLayoutEditor().then(closed => { if (closed) consumeTouchLayoutEditorHistory(); });
});
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
function openSmallDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) {
    dialog.classList.remove("closing");
    dialog.showModal();
  }
}
function closeSmallDialog(dialog: HTMLDialogElement) {
  if (!dialog.open || dialog.classList.contains("closing")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { dialog.close(); return; }
  dialog.classList.add("closing");
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener("animationend", event => { if (event.animationName === "replay-window-out") finish(); }, { once: true });
  setTimeout(finish, 220);
}
function bindSmallDialog(dialog: HTMLDialogElement, closeButton: HTMLButtonElement) {
  const close = () => closeSmallDialog(dialog);
  closeButton.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => dialog.classList.remove("closing"));
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
}
$("#frameLimitAppleNote").addEventListener("click", () => openSmallDialog(appleRefreshDialog));
$("#mpFrameLimitAppleNote").addEventListener("click", () => openSmallDialog(appleRefreshDialog));
bindSmallDialog(appleRefreshDialog, $("#appleRefreshClose"));
const donationDialog = $("#donationDialog");
const donationTriggers = [$("#donationOpen"), $("#donationOpenTop")];
for (const trigger of donationTriggers) trigger.addEventListener("click", () => openSmallDialog(donationDialog));
bindSmallDialog(donationDialog, $("#donationClose"));
$("#donationImage").addEventListener("error", () => {
  for (const trigger of donationTriggers) trigger.hidden = true;
  if (donationDialog.open) donationDialog.close();
});
const siteNotice = createSiteNoticeController({
  onOptOut: () => showToast(t("notice.restoreHint")),
});
type MultiplayerGuideController = ReturnType<MultiplayerGuideModule["createMultiplayerGuideController"]>;
let multiplayerGuideController: MultiplayerGuideController | null = null;
async function ensureMultiplayerGuideController(): Promise<MultiplayerGuideController> {
  if (multiplayerGuideController) return multiplayerGuideController;
  const module = await loadMultiplayerGuide();
  return multiplayerGuideController ??= module.createMultiplayerGuideController({
    readFailureText: error => t("multiplayerGuide.readFailed", { reason: errorMessage(error) }),
    getGameId: () => state.game,
  });
}
for (const trigger of [$("#mpGuideOpen"), $("#mpRoomGuideOpen")]) trigger.addEventListener("click", () => {
  void ensureMultiplayerGuideController().then(controller => controller.show());
});
const mpNetworkCheck = $("#mpNetworkCheck");
type NetworkDiagnosticsController = ReturnType<NetworkDiagnosticsModule["createNetworkDiagnosticsController"]>;
let networkDiagnosticsController: NetworkDiagnosticsController | null = null;
async function ensureNetworkDiagnosticsController(): Promise<NetworkDiagnosticsController> {
  if (networkDiagnosticsController) return networkDiagnosticsController;
  const module = await loadNetworkDiagnostics();
  return networkDiagnosticsController ??= module.createNetworkDiagnosticsController({
    button: mpNetworkCheck,
    panel: $("#mpNetworkResults"),
    getRelayUrl: () => {
      try { return buildMultiplayerDiagnosticRelayUrl(state.netplay.url); }
      catch { return ""; }
    },
    getFallbackIceServers: () => state.netplay.iceServers,
    translate: (key, params) => t(key, params),
  });
}
for (const eventName of ["pointerenter", "focus"] as const) {
  mpNetworkCheck.addEventListener(eventName, () => { void ensureNetworkDiagnosticsController(); }, { once: true });
}
mpNetworkCheck.addEventListener("click", () => {
  if (networkDiagnosticsController) return;
  void ensureNetworkDiagnosticsController().then(controller => controller.run());
}, { once: true });
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
$("#focusHitboxToggle").addEventListener("click", () => setOption("focusHitboxEnabled", !state.options.focusHitboxEnabled));
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
  const value = Math.min(TOUCH_SENSITIVITY_MAX, Math.max(TOUCH_SENSITIVITY_MIN,
    Math.round(Number($("#touchSensitivity").value) || TOUCH_SENSITIVITY_MIN)));
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
  setOption("thpracTouchControlsEnabled", !state.options.thpracTouchControlsEnabled);
});
$("#startupErrorClose").addEventListener("click", clearStartupError);
$("#startupErrorCopy").addEventListener("click", () => { void copyStartupError(); });
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
  try { touchDirectSurface.setPointerCapture(event.pointerId); } catch {}
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

// Some game Fire controls hold a Runtime key for actions such as charging.
const touchFireButton = $("#touchFire");
let heldTouchFire = false;
let heldTouchFirePointerId: number | null = null;
let heldTouchFireKey: Readonly<{ code: string; key: string; keyCode: number }> | null = null;
function usesHeldTouchFire() {
  return PRODUCT_GAMES[state.game].touchFire.mode === "held-key";
}
function setHeldTouchFire(held: boolean) {
  if (held) {
    const touchFire = PRODUCT_GAMES[state.game].touchFire;
    if (!state.launched || touchFire.mode !== "held-key" || !state.options.touchEnabled || touchLayoutEditing || heldTouchFire) return;
    heldTouchFire = true;
    heldTouchFireKey = touchFire.key;
    renderTouchFireState(false);
    postRuntimeHostedKey(touchRuntimeMessageContext(), touchFire.key, true);
    return;
  }
  if (!heldTouchFire) return;
  heldTouchFire = false;
  const key = heldTouchFireKey;
  heldTouchFireKey = null;
  renderTouchFireState(false);
  if (key) postRuntimeHostedKey(touchRuntimeMessageContext(), key, false);
}
function releaseHeldTouchFire() {
  heldTouchFirePointerId = null;
  setHeldTouchFire(false);
}
touchFireButton.addEventListener("pointerdown", event => {
  if (iosWebKitTouch || heldTouchFirePointerId !== null || !state.launched || !usesHeldTouchFire() || touchLayoutEditing) return;
  event.preventDefault();
  heldTouchFirePointerId = event.pointerId;
  try { touchFireButton.setPointerCapture(event.pointerId); } catch {}
  setHeldTouchFire(true);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
  touchFireButton.addEventListener(type, event => {
    if (iosWebKitTouch || heldTouchFirePointerId !== event.pointerId) return;
    event.preventDefault();
    releaseHeldTouchFire();
  });
}
touchFireButton.addEventListener("touchstart", event => {
  if (!iosWebKitTouch || !state.launched || !usesHeldTouchFire() || touchLayoutEditing) return;
  event.preventDefault();
  setHeldTouchFire(true);
}, { passive: false });
for (const type of ["touchend", "touchcancel"] as const) {
  touchFireButton.addEventListener(type, event => {
    if (!iosWebKitTouch) return;
    event.preventDefault();
    releaseHeldTouchFire();
  }, { passive: false });
}

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
  F7: Object.freeze({ code: "F7", key: "F7", keyCode: 118 }),
  F12: Object.freeze({ code: "F12", key: "F12", keyCode: 123 })
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
  const context = touchRuntimeMessageContext();
  postRuntimeHostedKey(context, spec, true);
  // OverlayKeyPressed samples at the fixed trainer tick. Hold the synthetic
  // key long enough to span several 60 Hz boundaries, then release it.
  setTimeout(() => {
    if (currentRuntimeSession()?.id === context.epoch) postRuntimeHostedKey(context, spec, false);
  }, 70);
  refocusGameIfNeeded();
}

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
    if (button === touchFireButton && usesHeldTouchFire()) return;
    event.preventDefault();
    try { button.setPointerCapture(event.pointerId); } catch {}
    activate();
  });
  button.addEventListener("click", event => {
    if (event.detail !== 0 || !state.launched) return;
    if (button === touchFireButton && usesHeldTouchFire()) return;
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
$("#touchLayoutCollapse").addEventListener("click", () => {
  touchLayoutEditorCollapsed = !touchLayoutEditorCollapsed;
  syncTouchLayoutWorkbench();
});
const touchLayoutEditorDragHandle = $("#touchLayoutEditorDragHandle");
touchLayoutEditorDragHandle.addEventListener("pointerdown", beginTouchLayoutEditorDrag);
touchLayoutEditorDragHandle.addEventListener("lostpointercapture", endTouchLayoutEditorDrag);
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
}, true);
document.addEventListener("pointerup", event => {
  endTouchLayoutDrag(event);
  endTouchLayoutEditorDrag(event);
}, true);
document.addEventListener("pointercancel", event => {
  endTouchLayoutDrag(event);
  endTouchLayoutEditorDrag(event);
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
function openManualGamePackageImport() {
  beginManualGamePackageImport(
    t("package.manualImportIntro"),
    captureGameDataContinuation("install-only"),
  );
}
$("#gamePackageImport").addEventListener("click", openManualGamePackageImport);
$("#mpGamePackageImport").addEventListener("click", openManualGamePackageImport);
$("#mpSettingsRoomBackdrop").addEventListener("click", () => setMpSettingsRoomDrawerOpen(false));
$("#launch").addEventListener("click", async () => {
  try {
    // Via and other mobile browsers can restore a BFCache/history entry with
    // the URL already moved to ?game=th07 while the in-memory state still
    // belongs to the default product. Treat an explicit route as authoritative at launch so
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
    // Browser Back (or another intentional route change) invalidates the
    // pending Runtime session. Its rejected startup request is cancellation,
    // not a failed OGG decode or a game crash.
    if (error instanceof RuntimeSwitchedError) return;
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
        t("package.resourceFailureLocal"),
        captureGameDataContinuation("launch"),
        true,
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
$("#transferCancel").addEventListener("click", () => {
  transferCancelUserInitiated = true;
  try { cancelBlockingNetworkOperation(); }
  finally { transferCancelUserInitiated = false; }
});
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
function roomPreparationForImport(continuation: GameDataContinuation | undefined): RoomPreparation | null {
  const preparation = roomPreparation;
  return continuation?.kind === "install-only" && preparation?.room === mpUiState.room &&
    preparation.game === state.game && ["cancelled", "failed", "importing"].includes(preparation.status)
    ? preparation : null;
}
$("#gameDataImportInput").addEventListener("change", async () => {
  const input = $("#gameDataImportInput");
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file || !gameDataAttempt?.unlocked || state.ready) return;
  const button = $("#transferImport");
  button.disabled = true;
  setGameDataImportBusy(true, t("package.importing"));
  const attemptId = gameDataAttempt.id;
  const roomImport = roomPreparationForImport(gameDataAttempt.continuation);
  if (roomImport) {
    setGameDataImportBusy(true, t("package.importingSimple"));
    roomImport.status = "importing";
    renderMpRoom();
  }
  try {
    const imported = await installImportedGameData(file);
    if (gameDataAttempt?.id !== attemptId) return;
    showToast(t("package.imported", { count: imported.files }));
    if (gameDataAttempt?.importFlow && !state.launched) {
      const continuation = gameDataAttempt.continuation;
      const preparedRoom = roomPreparationForImport(continuation);
      clearGameDataAttempt();
      if (preparedRoom) {
        roomPreparation = null;
        setStatus(t("package.continuing"));
        void prepareRoomResources(preparedRoom.room);
        return;
      }
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
    if (gameDataAttempt?.id !== attemptId) return;
    if (roomImport && roomPreparation === roomImport && roomImport.status === "importing") {
      roomImport.status = "cancelled";
      renderMpRoom();
    }
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
    if (!gameDataAttempt || gameDataAttempt.id === attemptId) {
      setGameDataImportBusy(false);
      button.disabled = false;
    }
  }
});

const touchPreview = new URLSearchParams(location.search).get("preview");
if (touchPreview === "touch" || touchPreview === "touch-hud") {
  state.options.touchEnabled = true;
  player.style.setProperty("--touch-preview-image", cardArtworkCss());
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = touchPreview !== "touch";
  player.classList.toggle("help-visible", touchPreview === "touch");
}

try { state.lessMotion = localStorage.getItem(lessMotionStorageKey) === "1"; } catch {}
// An optional touchscreen (or a narrow desktop window) does not make touch
// controls the primary way to use the launcher. Keep them prominent on mobile
// devices and when the browser's primary pointer is touch.
const primaryTouchPointer = matchMedia("(pointer: coarse)");
const preferTouchSettings = () => mobileDevice || primaryTouchPointer.matches;
function syncTouchSettingsOrder() {
  // Move the actual groups so keyboard and reading order match the visible order.
  for (const selector of ["#mobileOptions", "#mpMobileOptions"]) {
    const touchSettings = $(selector);
    const groups = touchSettings.parentElement!;
    if (preferTouchSettings()) {
      const firstGroup = groups.querySelector(":scope > .options-group");
      if (firstGroup !== touchSettings) groups.insertBefore(touchSettings, firstGroup);
    } else if (groups.lastElementChild !== touchSettings) groups.append(touchSettings);
  }
}
state.mobileOpen = preferTouchSettings();
mpUiState.mobileOpen = preferTouchSettings();
syncTouchSettingsOrder();
primaryTouchPointer.addEventListener("change", syncTouchSettingsOrder);
mpUiState.displayName = multiplayerIdentity.loadDisplayName();
for (const [name, open] of Object.entries(mpUiState.folds)) if (isMpFoldName(name)) mpSetFold(name, open);
if (mpRestoreRoomFromLocation()) {
  renderMpRoom();
  mpConnectLobby();
  void prepareRoomResources();
}
if (!mpUiState.room && !state.launched && !productEnabled(state.product)) state.hasSelection = false;
render(); setTranslatedStatus("status.selectGame");
bootWatchdog?.ready?.();
const launcherRoomRoute = !!mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
const loadEntryNotices = () => {
  if (!launcherRoomRoute && !debugHarness && !touchPreview) {
    void firstUseNotice.maybeShowAutomatically().then(shown => {
      if (!shown) void siteNotice.load();
    });
  } else if (!launcherRoomRoute) {
    void siteNotice.load();
  }
};
if (!debugHarness && !touchPreview && !browserWarningDismissed() && discouragedBrowserId(String(navigator.userAgent || ""))) {
  // First-visit warning for blacklisted UA tokens; the ordinary entry notices
  // run once it is dismissed (the FAQ choice navigates away instead).
  void warnDiscouragedBrowser().then(loadEntryNotices);
} else {
  loadEntryNotices();
}
