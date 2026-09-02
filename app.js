import {
  GAME_DATA_CACHE_NAME,
  importedGameDataMetadataKey,
  importedOggMetadataKey,
  localGameDataCacheUrl,
  localOggCacheUrl,
  parseStoredGameDataPack
} from "./game-data-import.js";
import { parsePackageZip } from "./package-zip.mjs";
import { installParsedPackageZip } from "./package-installer.mjs";
import { installPublishedPackage } from "./package-launcher.mjs";
import { componentFileIds } from "./package-generation.mjs";
import { garbageCollectPackageStore, readCurrentPackageGeneration, readPackageObject } from "./package-store.mjs";
import {
  managedRuntimeUrl,
  readManagedRuntimeData,
  readManagedRuntimeResource,
} from "./runtime-preparation.mjs";
import { createNetworkActivityTracker } from "./network-activity.mjs";
import { HOST_PROTOCOL, createLocalProductManifest } from "./product-catalog.mjs";
import {
  RELEASE_CATALOG_SCHEMA,
  releaseCatalogEntryUrl,
  releaseCatalogFromLegacyManifest,
  validateReleaseCatalog,
} from "./release-catalog.mjs";

const bootWatchdog = window.__eaglerBoot || null;
bootWatchdog?.mark("app-module-executing");

let appShellRegistration = null;
let appShellRegistrationPromise = Promise.resolve(null);
let appShellUpdateReady = false;
let appShellUpdateCheckFailed = false;
let appShellUpdateError = null;
let appShellReloadPending = false;
let appShellReloadScheduled = false;
let serverUpdateState = "unknown";

function remoteFailureReason(error) {
  if (navigator.onLine === false) return "设备离线";
  const message = String(error?.message || error || "");
  const httpStatus = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (httpStatus) return `HTTP ${httpStatus}`;
  if (/超时|timeout|timed out|没有完成请求/i.test(message)) return "请求超时";
  return "连接失败";
}

function showPlayerDebug(message) {
  if (!iosWebKitTouch) return;
  const box = $("#playerDebug");
  const debug = message?.debug || {};
  const lines = [
    "r682 iOS Runtime debug",
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

function playerOpenForAppShellUpdate() {
  // The launch gesture opens the Player before Runtime/SW readiness so it can
  // request fullscreen while user activation is still available. That visual
  // pre-launch state must NOT veto an App Shell handoff reload. Only a game
  // that has actually entered callMain is protected from update reloads.
  return state.launched === true;
}

function maybeReloadForAppShellUpdate() {
  if (!appShellUpdateReady || !appShellReloadPending || appShellReloadScheduled || playerOpenForAppShellUpdate()) return;
  appShellReloadScheduled = true;
  // Reload only after the new worker has completed installation/activation.
  // The worker may already control this page via clients.claim(), but defer
  // the document reload until the Player is closed so a running game is not
  // destroyed by an App Shell update.
  window.setTimeout(() => location.reload(), 0);
}

function mpLobbySend(message) {
  if (!mpLobby.connected || mpLobby.socket?.readyState !== WebSocket.OPEN) return false;
  mpLobby.socket.send(JSON.stringify(message));
  return true;
}

async function installedPackageRuntimeResources() {
  const generation = activeInstalledPackageGeneration;
  if (!generation) return [];
  const runtimeOwned = new Set();
  const runtimes = generation.descriptor.runtimes || (generation.descriptor.runtime ? { normal: generation.descriptor.runtime } : {});
  for (const runtime of Object.values(runtimes)) {
    for (const fileId of runtime?.bootstrap || [runtime?.entry]) {
      if (fileId) runtimeOwned.add(fileId);
    }
  }
  const resources = [];
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

async function installManagedPackageResources(resources) {
  if (!resources.length) return;
  const generation = activeInstalledPackageGeneration;
  const runtimeWindow = currentRuntimeWindow();
  const fs = runtimeWindow?.FS || runtimeWindow?.Module?.FS;
  if (!generation || !runtimeWindow || !fs?.writeFile || !fs?.mkdirTree) {
    throw new Error("游戏 Runtime 文件系统不可访问");
  }
  for (const resource of resources) {
    const prepared = await readManagedRuntimeResource(generation, resource.fileId);
    if (!prepared || prepared.path !== resource.path) throw new Error(`${resource.fileId}: 本地资源已丢失`);
    const slash = prepared.path.lastIndexOf("/");
    if (slash > 0) fs.mkdirTree(prepared.path.slice(0, slash));
    fs.writeFile(prepared.path, new runtimeWindow.Uint8Array(prepared.buffer), { canOwn: true });
  }
}

function mpApplyLobbyRoom(next) {
  if (!mpUiState.room || !next || typeof next !== "object") return;
  mpUiState.room.synced = true;
  mpUiState.room.connection = "connected";
  mpUiState.room.playerCount = Number(next.playerCount) === 3 ? 3 : 2;
  mpUiState.room.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number(next.difficulty) || 0));
  mpUiState.room.spectators = Array.isArray(next.spectators)
    ? next.spectators.map(value => ({
        clientId: String(value?.clientId || ""), name: mpNormalizeDisplayName(value?.name || ""),
      })).filter(value => /^[A-Za-z0-9_-]{8,64}$/.test(value.clientId))
    : [];
  mpUiState.room.spectatorCount = Math.max(0, Number(next.spectatorCount) || mpUiState.room.spectators.length);
  mpUiState.room.seats = Array.from({ length: 3 }, (_, index) => {
    const seat = next.seats?.[index];
    if (!seat || !Number.isInteger(Number(seat.loadout))) return null;
    return { clientId: String(seat.clientId || ""), name: mpNormalizeDisplayName(seat.name || ""), loadout: Math.max(0, Math.min(5, Number(seat.loadout))), ready: !!seat.ready, offline: !!seat.offline };
  });
  const localSeat = mpUiState.room.seats.findIndex(seat => seat?.clientId === mpLobby.clientId);
  const localSpectator = mpUiState.room.spectators.some(entry => entry.clientId === mpLobby.clientId);
  mpUiState.seat = localSeat >= 0 ? localSeat : null;
  if (localSeat >= 0) {
    mpUiState.spectatorRequested = false;
    mpUiState.preferredLoadout = mpUiState.room.seats[localSeat].loadout;
    mpUiState.ready = !!mpUiState.room.seats[localSeat].ready;
  } else {
    if (localSpectator) mpUiState.spectatorRequested = true;
    mpUiState.ready = false;
  }
  renderMpRoom();
}

function mpDisconnectLobby() {
  if (mpLobby.reconnectTimer) clearTimeout(mpLobby.reconnectTimer);
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

function mpScheduleLobbyReconnect(roomCode) {
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
  if (mpLobby.reconnectTimer) clearTimeout(mpLobby.reconnectTimer);
  mpLobby.reconnectTimer = null;
  mpConnectLobby(true);
}

function mpConnectLobby(reconnecting = false) {
  const room = mpUiState.room;
  if (!room || typeof WebSocket !== "function") return;
  mpLobby.clientId = mpLobbyClientId(state.product);
  const transportRoomId = mpTransportRoomId(room.code);
  if (mpLobby.socket && mpLobby.roomCode === transportRoomId && mpLobby.socket.readyState <= WebSocket.OPEN) return;
  if (mpLobby.reconnectTimer) clearTimeout(mpLobby.reconnectTimer);
  mpLobby.reconnectTimer = null;
  if (!reconnecting) mpLobby.reconnectAttempt = 0;
  const previous = mpLobby.socket;
  mpLobby.socket = null;
  mpLobby.connected = false;
  if (previous && previous.readyState < WebSocket.CLOSING) {
    try { previous.close(1000, "replace lobby socket"); } catch {}
  }
  let url;
  try { url = new URL(state.netplay.url); }
  catch { return; }
  if (!/^wss?:$/.test(url.protocol)) return;
  url.searchParams.set("room", transportRoomId);
  url.searchParams.delete("player");
  url.searchParams.set("lobby", mpLobby.clientId);
  const socket = new WebSocket(url.href);
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
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === "state") {
      // The relay snapshot is authoritative for the current room generation.
      // This also prevents a serial remembered from a previous, deleted room
      // with the same code from suppressing the next start event.
      mpLobby.startSerial = Math.max(0, Number(message.room?.startSerial) || 0);
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
let serverConfigurationWarning = "";
async function mpLaunchRoomGame() {
  if (mpLaunchInFlight || state.launched) return;
  mpLaunchInFlight = true;
  try {
    mpConfigureRuntimeSession();
    if (mpUiState.seat != null && !await confirmInputWarnings()) return;
    openPlayerView();
    try { await enterPlayerFullscreen({ focusGame: false }); }
    catch (error) { showToast(`浏览器阻止自动全屏：${error.message}`); }
    await launchConfiguredRuntime(null);
    if (isPlayerFullscreen()) await lockEscapeForGame();
  } catch (error) {
    if (!state.launched && isCancelledDownload(error)) {
      if (player.classList.contains("open")) await closePlayerView();
      else resetRuntime();
      setStatus("下载已取消");
      return;
    }
    if (!state.launched && isResourceLoadFailure(error)) {
      const message = error?.message || String(error);
      // Keep the Player/fullscreen host and multiplayer session intact.
      // syncTransientOverlayHost() moves the import surface into Player while
      // fullscreen, and a successful import resumes launchConfiguredRuntime().
      setPlayerStatus("缺少游戏资源，请导入本地游戏包后继续");
      beginManualGamePackageImport(message);
      setStatus("缺少游戏资源，请先导入本地游戏包");
      showToast(message);
      return;
    }
    const message = error?.message || String(error);
    setPlayerStatus(message);
    showStartupError(error, mpUiState.seat == null ? `${state.game.toUpperCase()} 联机 / 旁观` : `${state.game.toUpperCase()} 联机 / P${mpUiState.seat + 1}`);
    showToast(message);
  } finally {
    mpLaunchInFlight = false;
  }
}

function renderServerStatusNote() {
  const note = document.getElementById("serverStatusNote");
  if (!note) return;
  let text = "";
  let kind = "";
  if (serverConfigurationWarning) {
    kind = "offline";
    text = serverConfigurationWarning;
  } else if (appShellUpdateReady) {
    kind = "update";
    text = playerOpenForAppShellUpdate()
      ? "网站已有更新，退出游戏后自动应用。"
      : "网站已有更新，正在自动应用…";
  } else if (serverUpdateState === "unavailable") {
    kind = "offline";
    text = `无法连接到远程服务器（${remoteFailureReason(remoteCatalogError)}）`;
  } else if (serverUpdateState === "retrying") {
    kind = "checking";
    text = "服务器连接已恢复，正在重新检查网站和游戏更新…";
  } else if (appShellUpdateCheckFailed) {
    kind = "offline";
    text = `网站更新检查失败（${remoteFailureReason(appShellUpdateError)}）`;
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

async function checkAppShellUpdate(registration = appShellRegistration) {
  if (!registration) return;
  try {
    await registration.update();
    appShellUpdateCheckFailed = false;
    appShellUpdateError = null;
    renderServerStatusNote();
  } catch (error) {
    appShellUpdateCheckFailed = true;
    appShellUpdateError = error;
    renderServerStatusNote();
    console.warn("App Shell update check unavailable", error);
  }
}

function watchAppShellRegistration(registration) {
  appShellRegistration = registration;
  const inspectWaiting = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      appShellUpdateReady = true;
      appShellReloadPending = true;
      renderServerStatusNote();
    }
  };
  inspectWaiting();
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    // Snapshot ownership at discovery time. With clients.claim(), a first-ever
    // install gains a controller by the time the worker reaches activated;
    // looking at navigator.serviceWorker.controller only inside statechange
    // would then misclassify that first install as an App Shell update and
    // reload the Launcher underneath the user. Only workers discovered while
    // this page was already controlled are genuine in-place updates.
    const replacingControlledWorker = !!navigator.serviceWorker.controller;
    worker.addEventListener("statechange", () => {
      if (!replacingControlledWorker) return;
      if (worker.state === "installed") {
        appShellUpdateReady = true;
        appShellReloadPending = true;
        renderServerStatusNote();
        return;
      }
      if (worker.state === "activated") {
        appShellUpdateReady = true;
        appShellReloadPending = true;
        renderServerStatusNote();
        maybeReloadForAppShellUpdate();
      }
    });
  });
  void checkAppShellUpdate(registration);
}

// Service Workers are a pure App Shell enhancement.  isSecureContext is the
// browser-owned gate: HTTPS and trustworthy loopback HTTP may use it, while
// ordinary HTTP servers automatically keep the existing no-SW Launcher path.
if (window.isSecureContext && "serviceWorker" in navigator) {
  appShellRegistrationPromise = navigator.serviceWorker.register("./app-shell-sw.js", {
    scope: "./",
    updateViaCache: "none",
  }).then(registration => {
    watchAppShellRegistration(registration);
    return registration;
  }).catch(error => {
    console.warn("App Shell Service Worker unavailable; continuing without it", error);
    return navigator.serviceWorker.getRegistration("./").catch(() => null);
  });
}

const protocol = HOST_PROTOCOL;
let manifest = createLocalProductManifest();
let releaseCatalog = null;
let releaseCatalogUrl = new URL("games.json", location.href).href;
let legacyRemoteAvailable = false;
let remoteCatalogError = null;
let gameDataFallback = null;
let serverResourceMode = "hosted";
let importOnlyServer = false;

let networkActivitySnapshot = { active: [], count: 0, loaded: 0, total: 0 };
let networkActivityRenderQueued = false;
function networkMiB(bytes) { return `${(Math.max(0, Number(bytes) || 0) / 1048576).toFixed(1)} MiB`; }
function renderNetworkActivity(snapshot) {
  networkActivitySnapshot = snapshot;
  const panel = document.getElementById("transfer");
  if (!panel) return;
  if (!snapshot.count) {
    panel.removeAttribute("data-network-active");
    panel.querySelector(".transfer-bar")?.classList.remove("indeterminate");
    if (panel.dataset.networkOwned === "1") {
      panel.hidden = true;
      panel.dataset.networkOwned = "0";
    }
    return;
  }
  const active = snapshot.active;
  const current = [...active].reverse().find(task => task.phase === "receiving" && task.loaded > 0) || active.at(-1);
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
  if (title) title.textContent = current.title || "正在请求服务器…";
  if (label) label.textContent = snapshot.count > 1 ? `${current.label}  +${snapshot.count - 1}` : current.label;
  if (amount) amount.textContent = knownTotal
    ? `${networkMiB(snapshot.loaded)} / ${networkMiB(snapshot.total)}`
    : current.phase === "requesting" ? "等待服务器响应…" : current.loaded > 0 ? `${networkMiB(current.loaded)} 已接收` : "正在接收…";
  if (bar) bar.style.width = knownTotal ? `${Math.min(100, snapshot.loaded / snapshot.total * 100).toFixed(1)}%`
    : currentKnownTotal ? `${Math.min(100, current.loaded / current.total * 100).toFixed(1)}%` : "34%";
  barTrack?.classList.toggle("indeterminate", !knownTotal && !currentKnownTotal);
  if (speedNode) speedNode.textContent = current.phase === "requesting" ? "等待响应" : speed >= 1048576
    ? `${(speed / 1048576).toFixed(1)} MiB/s` : `${Math.round(speed / 1024)} KiB/s`;
  if (eta) eta.textContent = currentKnownTotal && speed > 1024
    ? clock((current.total - current.loaded) / speed) : `${snapshot.count} 个请求`;
  if (warning) warning.hidden = true;
  if (retry) retry.hidden = true;
}
function scheduleNetworkActivityRender(snapshot) {
  networkActivitySnapshot = snapshot;
  if (networkActivityRenderQueued) return;
  networkActivityRenderQueued = true;
  requestAnimationFrame(() => {
    networkActivityRenderQueued = false;
    renderNetworkActivity(networkActivitySnapshot);
  });
}
const networkActivity = createNetworkActivityTracker({ onChange: scheduleNetworkActivityRender });

function packageNetworkMeta(gameId, input) {
  let pathname = "";
  try { pathname = new URL(typeof input === "string" ? input : input?.url || input, location.href).pathname; } catch {}
  const file = decodeURIComponent(pathname.split("/").at(-1) || pathname || "资源");
  const game = String(gameId || "game").toUpperCase();
  if (/\.package\.json$/i.test(pathname)) return { title: "正在获取游戏信息…", label: `获取 ${game} 版本描述`, kind: "descriptor" };
  if (/\.data$/i.test(pathname)) return { title: "正在下载游戏资源…", label: `${game} ${file}`, kind: "game" };
  if (/\.wasm$/i.test(pathname)) return { title: "正在下载运行组件…", label: `${game} WebAssembly`, kind: "runtime" };
  if (/\.js$/i.test(pathname)) return { title: "正在下载运行组件…", label: `${game} 运行脚本`, kind: "runtime" };
  if (/\.html$/i.test(pathname)) return { title: "正在下载运行组件…", label: `${game} 运行页面`, kind: "runtime" };
  if (/\.ogg$/i.test(pathname)) return { title: "正在下载音乐…", label: file, kind: "music" };
  if (/\.(?:ttc|otf|woff2?)$/i.test(pathname)) return { title: "正在下载资源…", label: `字体 ${file}`, kind: "font" };
  if (/\.zip$/i.test(pathname)) return { title: "正在下载游戏包…", label: file, kind: "package" };
  return { title: "正在请求服务器…", label: `${game} ${file}`, kind: "network" };
}
const packageTrackedFetch = gameId => (input, init) => networkActivity.xhrFetch(input, init, packageNetworkMeta(gameId, input));

const installedPackageSnapshots = new Map();
await Promise.all(Object.keys(manifest.games).map(async gameId => {
  try {
    const installed = await readCurrentPackageGeneration(gameId);
    if (installed?.generation) installedPackageSnapshots.set(gameId, installed.generation);
  } catch {}
}));
// This is the safe GC boundary: no Player/Runtime exists yet, so generations
// that are no longer current/pending cannot still be serving lazy resources.
try { await garbageCollectPackageStore(); } catch {}

async function fetchJsonWithTimeout(path, timeoutMs = 12000, meta = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await networkActivity.fetch(path, { cache: "no-store", signal: controller.signal }, {
      title: "正在请求服务器…",
      label: path,
      kind: "metadata",
      ...meta,
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (timedOut || error?.name === "AbortError") throw new Error(`${path}: ${Math.round(timeoutMs / 1000)} 秒内没有完成请求（网络 / CDN 超时）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const originMigrationOpen = document.getElementById("originMigrationOpen");
if (originMigrationOpen) originMigrationOpen.hidden = location.protocol !== "https:";
const legacyHttpEntryParam = "from-http";
function hasLegacyHttpEntryMarker() {
  return location.protocol === "https:" && new URL(location.href).searchParams.get(legacyHttpEntryParam) === "1";
}
async function promptLegacyHttpMigration() {
  if (!hasLegacyHttpEntryMarker()) return;
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete(legacyHttpEntryParam);
  history.replaceState(history.state, "", cleanUrl.href);
  const choice = await askDecision({
    message: "你刚从 HTTP 旧站进入 HTTPS。浏览器会把 HTTP 与 HTTPS 的本地数据分开保存；如果旧站有存档、录像、设置或已安装游戏包，可以进入旧站迁移把它们带过来。",
    confirmText: "进入迁移",
    cancelText: "暂不迁移",
  });
  if (choice === "confirm") location.href = new URL("migrate.html", location.href).href;
}

const validOggManifest = ogg => ogg == null ||
  (typeof ogg.version === "string" && ogg.version.length > 0 &&
   Array.isArray(ogg.files) && Array.isArray(ogg.sizes) &&
   ogg.files.length === ogg.sizes.length &&
   (ogg.sha256 == null ||
    (Array.isArray(ogg.sha256) && ogg.files.length === ogg.sha256.length &&
     ogg.sha256.every(hash => /^[a-f0-9]{64}$/i.test(hash)))));
const validOfflineCompatibility = (item, resourceMode) => resourceMode === "hosted" ||
  (item.offlineCompatibility?.schema === "eagler-touhou/offline-game-pack/1" &&
   item.offlineCompatibility.runtimeCompatibility?.protocol === protocol &&
   item.offlineCompatibility.runtimeCompatibility?.dataLayout === item.gameData?.layout &&
   item.offlineCompatibility.runtimeCompatibility?.versionSource === "offline-pack" &&
   Array.isArray(item.offlineCompatibility.requiredShared) &&
   ["/msgothic.ttc", "/unifont.otf"].every(target => item.offlineCompatibility.requiredShared.includes(target)) &&
   item.offlineCompatibility.languages?.source === "offline-pack" &&
   Array.isArray(item.offlineCompatibility.languages?.baseline) && item.offlineCompatibility.languages.baseline.includes("ja"));

function validateLegacyManifest(value) {
  const resourceMode = value?.shared?.resourceMode || "hosted";
  const importOnly = resourceMode !== "hosted";
  const fallback = value?.shared?.gameDataFallback;
  const fallbackValid = fallback == null ||
    (typeof fallback === "object" && typeof fallback.url === "string" && /^https:\/\//.test(fallback.url) &&
     (fallback.hint == null || typeof fallback.hint === "string"));
  if (value?.protocol !== protocol || !["hosted", "import-only", "import-partial"].includes(resourceMode) ||
      (!importOnly && (typeof value.shared?.vanillaFont !== "string" || typeof value.shared?.unicodeFont !== "string")) ||
      !fallbackValid || !value.games?.th06 || !value.games?.th07 ||
      ![value.games.th06, value.games.th07].every(item => typeof item.multiplayerRuntime === "string") ||
      !Object.values(value.games).every(item => typeof item.runtime === "string" && item.music?.midi &&
      typeof item.gameData?.version === "string" && /^sha256-[a-f0-9]{64}$/i.test(item.gameData.version) &&
      typeof item.gameData?.layout === "string" && /^sha256-[a-f0-9]{64}$/i.test(item.gameData.layout) &&
      typeof item.gameData?.path === "string" && /^th0[67]\.data$/.test(item.gameData.path) &&
      Number.isInteger(item.gameData?.bytes) && item.gameData.bytes > 0 &&
      /^[a-f0-9]{64}$/i.test(item.gameData?.sha256 || "") &&
      validOggManifest(item.music?.ogg) && validOfflineCompatibility(item, resourceMode))) {
    throw new Error("legacy games manifest 的协议或游戏清单无效");
  }
  return value;
}

function applyLegacyManifest(value) {
  manifest = validateLegacyManifest(value);
  serverResourceMode = manifest.shared?.resourceMode || "hosted";
  importOnlyServer = serverResourceMode !== "hosted";
  gameDataFallback = manifest.shared?.gameDataFallback || null;
  serverConfigurationWarning = importOnlyServer && !gameDataFallback
    ? "部署配置错误：import-only / import-partial 必须填写 gameDataFallback.url，否则用户无法通过「打开链接」取得游戏包。"
    : "";
  legacyRemoteAvailable = true;
  renderServerStatusNote();
}

async function refreshRemoteReleaseState() {
  bootWatchdog?.mark("catalog-request");
  try {
    const primary = await fetchJsonWithTimeout("games.json", 12000, { label: "检查服务器发行信息" });
    if (primary?.schema === RELEASE_CATALOG_SCHEMA) {
      releaseCatalog = validateReleaseCatalog(primary);
      releaseCatalogUrl = new URL("games.json", location.href).href;
      try {
        applyLegacyManifest(await fetchJsonWithTimeout("legacy-games.json", 12000, { label: "读取服务器兼容清单" }));
      } catch (error) {
        console.warn("legacy remote compatibility unavailable", error);
      }
    } else {
      applyLegacyManifest(primary);
      try { releaseCatalog = releaseCatalogFromLegacyManifest(primary); } catch {}
    }
    remoteCatalogError = null;
    serverUpdateState = "ready";
    renderServerStatusNote();
    bootWatchdog?.mark("catalog-ok");
    setTimeout(() => { try { render(); } catch {} }, 0);
  } catch (error) {
    remoteCatalogError = error;
    serverUpdateState = "unavailable";
    renderServerStatusNote();
    bootWatchdog?.mark("catalog-unavailable");
    console.warn("remote Release Catalog unavailable; installed game startup remains available", error);
  }
}
let remoteReleasePromise = refreshRemoteReleaseState();

function retryRemoteUpdateChecks() {
  if (serverUpdateState === "unavailable" || remoteCatalogError) {
    serverUpdateState = "retrying";
    renderServerStatusNote();
    remoteReleasePromise = refreshRemoteReleaseState();
  }
  if (appShellRegistration) void checkAppShellUpdate();
}

window.addEventListener("offline", () => {
  remoteCatalogError = remoteCatalogError || new Error("offline");
  serverUpdateState = "unavailable";
  renderServerStatusNote();
});
window.addEventListener("online", retryRemoteUpdateChecks);
window.addEventListener("focus", () => {
  if (remoteCatalogError) retryRemoteUpdateChecks();
  else if (appShellRegistration) void checkAppShellUpdate();
});
function beginImportOnlyAttempt() {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false, startTimer: null, completeTimer: null, importOnly: true };
  $("#gameDataImportReason").textContent = gameDataFallbackText("当前没有可启动的本地游戏资源。");
  updateGameDataLinkWindow();
  openGameDataImportWindow();
}

let gameZoomInputWindow = null;
let thpracMouseInputWindow = null;
let thpracMousePointerId = null;
let thpracMouseMode = false;
let thpracMenuOpen = false;
let runtimeCustomEventWindow = null;

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

function postThpracMouseEvent(event, type) {
  // The Runtime is the direct child iframe again, so pointer ownership and
  // protocol commands share the same browsing context.
  const win = frame.contentWindow;
  if (!win) return;
  win.postMessage({
    protocol, game: state.game, command: "thprac-mouse", type,
    x: event.clientX, y: event.clientY
  }, location.origin);
}

function beginThpracMousePointer(event) {
  if (!thpracMouseModeActive() || event.pointerType !== "touch" || thpracMousePointerId != null) return;
  thpracMousePointerId = event.pointerId;
  try { event.target.setPointerCapture?.(event.pointerId); } catch {}
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
  postThpracMouseEvent(event, "down");
}

function moveThpracMousePointer(event) {
  if (!thpracMouseModeActive() || event.pointerId !== thpracMousePointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
}

function endThpracMousePointer(event) {
  if (event.pointerId !== thpracMousePointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postThpracMouseEvent(event, "move");
  postThpracMouseEvent(event, "up");
  try { event.target.releasePointerCapture?.(event.pointerId); } catch {}
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

function bindThpracMouseInputWindow(win) {
  uninstallThpracMouseInputBridge();
  if (!win) return;
  thpracMouseInputWindow = win;
  win.addEventListener("pointerdown", beginThpracMousePointer, true);
  win.addEventListener("pointermove", moveThpracMousePointer, true);
  win.addEventListener("pointerup", endThpracMousePointer, true);
  win.addEventListener("pointercancel", endThpracMousePointer, true);
}

function uninstallGameZoomInputBridge() {
  if (gameZoomInputWindow) {
    try { gameZoomInputWindow.removeEventListener("pointerdown", beginGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointermove", moveGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointerup", endGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointercancel", endGameZoomPointer, true); } catch {}
  }
  gameZoomInputWindow = null;
  gameZoomState.pointers.clear();
  gameZoomState.pinch = null;
}

function bindGameZoomInputWindow(win) {
  if (!win) return;
  // Navigating an iframe replaces its Window even when the WindowProxy object
  // remains stable. Always detach/re-attach instead of trusting identity.
  if (gameZoomInputWindow) {
    try { gameZoomInputWindow.removeEventListener("pointerdown", beginGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointermove", moveGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointerup", endGameZoomPointer, true); } catch {}
    try { gameZoomInputWindow.removeEventListener("pointercancel", endGameZoomPointer, true); } catch {}
  }
  gameZoomInputWindow = win;
  win.addEventListener("pointerdown", beginGameZoomPointer, true);
  win.addEventListener("pointermove", moveGameZoomPointer, true);
  win.addEventListener("pointerup", endGameZoomPointer, true);
  win.addEventListener("pointercancel", endGameZoomPointer, true);
}

function currentRuntimeWindow() {
  return frame.contentWindow || null;
}

function bindGameKeyWindow(win) {
  if (gameKeyWindow) {
    try { gameKeyWindow.removeEventListener("keydown", handleGameFullscreenKey, true); } catch {}
    try { gameKeyWindow.removeEventListener("keyup", handleGameFullscreenKey, true); } catch {}
  }
  gameKeyWindow = win || null;
  if (!gameKeyWindow) return;
  gameKeyWindow.addEventListener("keydown", handleGameFullscreenKey, true);
  gameKeyWindow.addEventListener("keyup", handleGameFullscreenKey, true);
}

function handleRuntimeThpracMenu(event) {
  thpracMenuOpen = !!event.detail?.open;
  touchThpracFunctionKeys.hidden = !thpracMenuOpen;
}

function handleRuntimeMidi(event) {
  if ((state.music === "midi" || isOggMusicMode(state.music)) && midiSynth && Array.isArray(event.detail?.bytes)) {
    midiSynth.send(event.detail.bytes);
  }
}

function handleRuntimeMidiClose() {
  midiSynth?.reset();
}

function bindRuntimeCustomEventWindow(win) {
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
  bindGameZoomInputWindow(win);
  bindThpracMouseInputWindow(win);
  bindGameKeyWindow(win);
  bindRuntimeCustomEventWindow(win);
}

function uninstallRuntimeDomBridges() {
  uninstallGameZoomInputBridge();
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

function clampGameZoomScale(scale) {
  return Math.max(gameZoomMinScale, Math.min(gameZoomMaxScale, scale));
}

function clampGameZoomTransform(scale, x, y) {
  const width = player.clientWidth;
  const height = player.clientHeight;
  if (!width || !height) return { scale, x: 0, y: 0 };
  if (scale < 1) {
    return { scale, x: (width - width * scale) / 2, y: (height - height * scale) / 2 };
  }
  return {
    scale,
    x: Math.max(width - width * scale, Math.min(0, x)),
    y: Math.max(height - height * scale, Math.min(0, y))
  };
}

function updateGameZoomUi() {
  const available = state.options.magnifierEnabled && (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing;
  gameZoomState.active = available;
  gameZoomToggle.hidden = !available;
  gameZoomToggle.classList.remove("is-on");
  gameZoomToggle.querySelector("strong").textContent = "复位";
  $("#gameZoomScale").textContent = `${Math.round(gameZoomState.scale * 100)}%`;
  player.classList.remove("game-zoom-editing");
}

function updatePlayerOrientationUi() {
  const available = (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing;
  orientationToggle.hidden = !available;
  if (!available) return;
  const targetTitle = touchLayoutOrientation() === "landscape" ? "竖屏" : "横屏";
  $("#orientationTarget").textContent = targetTitle;
  orientationToggle.setAttribute("aria-label", `切换到${targetTitle}`);
  orientationToggle.title = `切换到${targetTitle}`;
}

function applyGameZoomTransform(scale = gameZoomState.scale, x = gameZoomState.x, y = gameZoomState.y) {
  const clamped = clampGameZoomTransform(clampGameZoomScale(scale), x, y);
  const base = gameViewportBaseOffsetPx();
  gameZoomState.scale = clamped.scale;
  gameZoomState.x = clamped.x;
  gameZoomState.y = clamped.y;
  gameViewport.style.transform = `translate3d(${base.x + clamped.x}px,${base.y + clamped.y}px,0) scale(${clamped.scale})`;
  updateGameZoomUi();
}

function cancelGameZoomGesture() {
  gameZoomState.pointers.clear();
  gameZoomState.pinch = null;
}

function resetGameZoom() {
  gameZoomState.scale = 1;
  gameZoomState.x = 0;
  gameZoomState.y = 0;
  gameZoomState.pointers.clear();
  gameZoomState.pinch = null;
  applyGameZoomTransform(1, 0, 0);
}

function beginGameZoomPinch() {
  if (gameZoomState.pointers.size < 2) { gameZoomState.pinch = null; return; }
  const [first, second] = [...gameZoomState.pointers.entries()].slice(0, 2);
  const a = first[1];
  const b = second[1];
  const rect = player.getBoundingClientRect();
  const midX = (a.x + b.x) / 2 - rect.left;
  const midY = (a.y + b.y) / 2 - rect.top;
  const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const base = gameViewportBaseOffsetPx();
  gameZoomState.pinch = {
    ids: [first[0], second[0]],
    distance,
    scale: gameZoomState.scale,
    contentX: (midX - base.x - gameZoomState.x) / gameZoomState.scale,
    contentY: (midY - base.y - gameZoomState.y) / gameZoomState.scale
  };
}

function gameZoomPointerClientPoint(event) {
  // Pointer events observed on the Runtime window use coordinates local to
  // the iframe viewport. The iOS/Android direct-touch bridge instead observes
  // the host document, so convert its visual coordinates back through the
  // currently transformed iframe before the common mapping below multiplies
  // by the scale again.
  if (event.currentTarget === touchDirectSurface) {
    const rect = frame.getBoundingClientRect();
    const scale = Math.max(1, gameZoomState.scale);
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale
    };
  }
  return { x: event.clientX, y: event.clientY };
}

function beginGameZoomPointer(event) {
  if (!gameZoomState.active || event.pointerType === "mouse") return;
  const base = gameViewportBaseOffsetPx();
  const point = gameZoomPointerClientPoint(event);
  gameZoomState.pointers.set(event.pointerId, {
    x: base.x + gameZoomState.x + point.x * gameZoomState.scale,
    y: base.y + gameZoomState.y + point.y * gameZoomState.scale
  });
  if (gameZoomState.pointers.size >= 2) beginGameZoomPinch();
}

function moveGameZoomPointer(event) {
  if (!gameZoomState.active || !gameZoomState.pointers.has(event.pointerId)) return;
  const base = gameViewportBaseOffsetPx();
  const point = gameZoomPointerClientPoint(event);
  gameZoomState.pointers.set(event.pointerId, {
    x: base.x + gameZoomState.x + point.x * gameZoomState.scale,
    y: base.y + gameZoomState.y + point.y * gameZoomState.scale
  });
  const pinch = gameZoomState.pinch;
  if (!pinch || !pinch.ids.every(id => gameZoomState.pointers.has(id))) return;
  const a = gameZoomState.pointers.get(pinch.ids[0]);
  const b = gameZoomState.pointers.get(pinch.ids[1]);
  const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const scale = clampGameZoomScale(pinch.scale * distance / pinch.distance);
  const rect = player.getBoundingClientRect();
  const midX = (a.x + b.x) / 2 - rect.left;
  const midY = (a.y + b.y) / 2 - rect.top;
  applyGameZoomTransform(scale, midX - base.x - pinch.contentX * scale, midY - base.y - pinch.contentY * scale);
}

function endGameZoomPointer(event) {
  if (!gameZoomState.pointers.has(event.pointerId)) return;
  gameZoomState.pointers.delete(event.pointerId);
  gameZoomState.pinch = null;
  if (gameZoomState.pointers.size >= 2) beginGameZoomPinch();
}

function resetGameZoomFromControl() {
  if (!state.launched) return;
  resetGameZoom();
  refocusGameIfNeeded();
}

let changelogLoaded = false;
function appendChangelogLinkedText(target, text) {
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) target.append(document.createTextNode(text.slice(offset, match.index)));
    const link = document.createElement("a");
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = match[0];
    target.append(link);
    offset = match.index + match[0].length;
  }
  if (offset < text.length) target.append(document.createTextNode(text.slice(offset)));
}
function renderChangelogText(target, source) {
  target.replaceChildren();
  const list = document.createElement("div");
  list.className = "changelog-list";
  target.append(list);
  let entry = null;
  let bullets = null;
  const ensureEntry = () => {
    if (entry) return entry;
    entry = document.createElement("section");
    entry.className = "changelog-item";
    list.append(entry);
    return entry;
  };
  for (const rawLine of String(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^=+$/.test(line)) { bullets = null; continue; }
    if (line === "EAGLER TOUHOU CHANGELOG") continue;
    if (/^-{8,}$/.test(line)) { entry = null; bullets = null; continue; }
    const dated = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (dated) {
      entry = document.createElement("section");
      entry.className = "changelog-item";
      const heading = document.createElement("h2");
      const date = document.createElement("span");
      date.className = "changelog-date";
      date.textContent = dated[1];
      heading.append(date);
      if (dated[2]) heading.append(document.createTextNode(` ${dated[2]}`));
      entry.append(heading);
      list.append(entry);
      bullets = null;
      continue;
    }
    if (/^(功能更新|Bug 修复|问题修复|其他)$/.test(line)) {
      const heading = document.createElement("h3");
      heading.textContent = line;
      ensureEntry().append(heading);
      bullets = null;
      continue;
    }
    if (line.startsWith("- ")) {
      if (!bullets) {
        bullets = document.createElement("ul");
        ensureEntry().append(bullets);
      }
      const item = document.createElement("li");
      appendChangelogLinkedText(item, line.slice(2));
      bullets.append(item);
      continue;
    }
    bullets = null;
    const paragraph = document.createElement("p");
    appendChangelogLinkedText(paragraph, line);
    ensureEntry().append(paragraph);
  }
}
async function loadChangelog() {
  if (changelogLoaded) return true;
  const target = $("#changelogText");
  try {
    const response = await fetch(`CHANGELOG.txt?v=${encodeURIComponent(changelogVersion)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderChangelogText(target, await response.text());
    changelogLoaded = true;
    return true;
  } catch (error) {
    target.replaceChildren();
    const failed = document.createElement("p");
    failed.className = "changelog-error";
    failed.textContent = `CHANGELOG.txt 读取失败：${error.message}。请刷新页面后重试。`;
    target.append(failed);
    return false;
  }
}
function readImportedOggMeta(gameId = state.game) {
  try {
    const value = JSON.parse(localStorage.getItem(importedOggMetadataKey(gameId)) || "null");
    if (!value || value.source !== "local-import" || value.game !== gameId || typeof value.version !== "string" ||
        !Array.isArray(value.files) || !value.files.every(name => typeof name === "string" && /^[A-Za-z0-9_.-]+\.ogg$/.test(name))) return null;
    return value;
  } catch {
    return null;
  }
}

async function showChangelog(automatic = false) {
  const dialog = $("#changelogDialog");
  if (dialog.open) return;
  const loaded = await loadChangelog();
  dialog.showModal();
  if (automatic && loaded) {
    try { localStorage.setItem(changelogSeenKey, "1"); } catch {}
  }
}

function closeChangelog() {
  const dialog = $("#changelogDialog");
  if (dialog.open) dialog.close();
}
const defaultOptions = Object.freeze({
  thpracEnabled: false,
  thpracTouchControlsEnabled: false,
  magnifierEnabled: false,
  th06FocusHitbox: false,
  frameLimit60Enabled: false,
  touchEnabled: false,
  touchMovementMode: "touch",
  touchSensitivity: 100,
  touchFocusMode: "hold-button",
  doubleTapBombEnabled: false,
  alwaysHitbox: false,
  enhanceLocalPlayerVisibility: false
});
if (typeof window.AudioContext !== "function" && typeof window.webkitAudioContext === "function") {
  try { window.AudioContext = window.webkitAudioContext; } catch {}
}
const webAudioAvailable = typeof window.AudioContext === "function";

function defaultNetplayRelayUrl() {
  const hostname = location.hostname || "127.0.0.1";
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (loopback) return `${wsProtocol}//${hostname}:18142/?room=eagler-mp&player=0`;
  const url = new URL("/eagler-netplay/", location.href);
  url.protocol = wsProtocol;
  url.searchParams.set("room", "eagler-mp");
  url.searchParams.set("player", "0");
  return url.href;
}

const state = {
  game: "th06", hasSelection: false, music: "ogg-stream", ready: false, launched: false, replayViewer: false,
  musicPreferenceExplicit: false,
  request: 0, pending: new Map(), source: "", sourceIdentity: "", mobileOpen: false,
  product: "th06", options: { ...defaultOptions }, language: "ja", lessMotion: false, runtimeVariant: "normal",
  netplay: {
    url: defaultNetplayRelayUrl(),
    player: 0, playerCount: 2, seed: 19005, difficulty: 1,
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    loadouts: [{ character: 0, shot: 0 }, { character: 1, shot: 0 }, { character: 2, shot: 0 }],
    spectator: false, spectatorId: "", spectatorCount: 0,
  }
};
const multiplayerProducts = new Set(["th06mp", "th07mp"]);
const isMultiplayerProduct = (product = state.product) => multiplayerProducts.has(product);
const gameFromProduct = product => product === "th06mp" ? "th06" : product === "th07mp" ? "th07" : product;
const multiplayerProductForGame = gameId => `${gameId}mp`;
const mpDifficultyMax = (gameId = state.game) => gameId === "th06" ? 4 : 5;
const mpTransportRoomId = (code, product = state.product) => `${product}-${code}`;
const productTitle = product => product === "th06mp" ? "东方红魔乡 联机版"
  : product === "th07mp" ? "东方妖妖梦 联机版"
  : game().title;
const mpUiState = {
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
const mpShareSettingsKeyForProduct = product => `eagler-touhou-${product}-share-singleplayer-settings-v1`;
const mpLoadoutPreferenceKeyForProduct = product => `eagler-touhou-${product}-loadout-v1`;
let mpShareSingleplayerSettings = true;
function restoreMpProductPreferences(product = state.product) {
  if (!isMultiplayerProduct(product)) {
    mpShareSingleplayerSettings = true;
    return;
  }
  try { mpShareSingleplayerSettings = localStorage.getItem(mpShareSettingsKeyForProduct(product)) !== "0"; }
  catch { mpShareSingleplayerSettings = true; }
  const maxLoadout = product === "th06mp" ? 4 : 6;
  let savedLoadout = 0;
  try { savedLoadout = Number(localStorage.getItem(mpLoadoutPreferenceKeyForProduct(product))); } catch {}
  mpUiState.preferredLoadout = Number.isInteger(savedLoadout) && savedLoadout >= 0 && savedLoadout < maxLoadout
    ? savedLoadout : 0;
}
const importedDataUpdateChoices = new Map();
let activeInstalledPackageGeneration = null;
const touchControls = { fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0 };
const touchFocusModes = new Set(["two-finger", "hold-button", "toggle-button"]);
const touchMovementModes = new Set(["touch", "touch-unlimited", "joystick", "joystick-free"]);
const touchMovementUsesJoystick = mode => mode === "joystick" || mode === "joystick-free";
const musicModes = new Set(["ogg-stream", "ogg-full", "midi", "none"]);
const isOggMusicMode = mode => mode === "ogg-stream" || mode === "ogg-full";
const musicTransportMode = mode => isOggMusicMode(mode) ? "ogg" : mode === "midi" ? "midi" : mode === "none" ? "none" : null;
const oggDecodeMode = mode => mode === "ogg-full" ? "full" : "stream";
const musicModeLabel = mode => mode === "ogg-stream" ? "ogg(流式解码，避免切歌时卡顿)"
  : mode === "ogg-full" ? "ogg(全量解码，避免音频卡顿)"
  : mode === "midi" ? "midi"
  : "无";
const touchSensitivityPresets = new Set([50, 100, 200]);
const touchLayoutStorageKey = "eagler-touhou-touch-layout-v1";
const touchLayoutVersion = 4;
const touchLayoutControlMeta = Object.freeze({
  focus: Object.freeze({ id: "touchFocus", title: "低速", priority: 0 }),
  fire: Object.freeze({ id: "touchFire", title: "开火", priority: 1 }),
  bomb: Object.freeze({ id: "touchBomb", title: "Bomb", priority: 2 }),
  joystick: Object.freeze({ id: "touchJoystick", title: "轮盘", priority: 3 }),
  escape: Object.freeze({ id: "touchEscape", title: "ESC", priority: 4 }),
  thpracInput: Object.freeze({ id: "touchThpracInput", title: "模拟鼠标", priority: 5 }),
  thpracTab: Object.freeze({ id: "touchThpracTab", title: "Tab", priority: 6 }),
  thpracMenu: Object.freeze({ id: "touchThpracMenu", title: "作弊菜单", priority: 7 })
});
const touchLayoutScaleMin = .6;
const touchLayoutScaleMax = 1.8;
const touchLayoutOrientations = Object.freeze(["landscape", "portrait"]);
function normalizeTouchLayoutPriorityOrder(controls) {
  const ordered = Object.entries(controls).sort(([aName, a], [bName, b]) => {
    const aPriority = Number.isFinite(a.priority) ? a.priority : touchLayoutControlMeta[aName].priority;
    const bPriority = Number.isFinite(b.priority) ? b.priority : touchLayoutControlMeta[bName].priority;
    return aPriority - bPriority || touchLayoutControlMeta[aName].priority - touchLayoutControlMeta[bName].priority;
  });
  // Backspace is authoritative only inside the optional thprac touch-key set.
  // Swap thprac entries among their existing slots; never promote the set over
  // Bomb/ESC/joystick or any other ordinary touch control.
  const thpracNames = new Set(["thpracInput", "thpracTab", "thpracMenu"]);
  const thpracSlots = ordered.flatMap(([name], index) => thpracNames.has(name) ? [index] : []);
  const menuIndex = ordered.findIndex(([name]) => name === "thpracMenu");
  const highestThpracSlot = thpracSlots.at(-1);
  if (menuIndex >= 0 && highestThpracSlot != null && menuIndex !== highestThpracSlot) {
    [ordered[menuIndex], ordered[highestThpracSlot]] = [ordered[highestThpracSlot], ordered[menuIndex]];
  }
  ordered.forEach(([, item], index) => { item.priority = index; });
  return controls;
}
function normalizeTouchLayoutProfile(profile) {
  if (profile == null) return null;
  if (typeof profile !== "object") return undefined;
  const controls = {};
  for (const name of Object.keys(touchLayoutControlMeta)) {
    const item = profile.controls?.[name];
    // Older saved layouts predate later optional controls. Keep them valid and
    // let the editor fill each missing control from its current default
    // geometry without disturbing the user's remembered positions.
    if (!item && ["joystick", "thpracInput", "thpracTab", "thpracMenu"].includes(name)) continue;
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.scale) ||
        (item.priority != null && !Number.isFinite(item.priority)) ||
        item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 ||
        item.scale < touchLayoutScaleMin || item.scale > touchLayoutScaleMax) return undefined;
    controls[name] = { x: item.x, y: item.y, scale: item.scale, priority: item.priority ?? touchLayoutControlMeta[name].priority };
  }
  const viewport = profile.viewport ?? { x: 0 };
  if (!Number.isFinite(viewport.x) || viewport.x < -.5 || viewport.x > .5) return undefined;
  return { controls: normalizeTouchLayoutPriorityOrder(controls), viewport: { x: viewport.x } };
}
function normalizeTouchLayout(value) {
  if (!value || typeof value !== "object") return null;
  // The editor was never publicly released with v1, but accepting the local
  // development shape costs almost nothing and prevents a surprising reset.
  if (value.version === 1) {
    const migrated = normalizeTouchLayoutProfile({ controls: value.controls });
    if (!migrated) return null;
    return { version: touchLayoutVersion, profiles: { landscape: cloneTouchLayoutProfile(migrated), portrait: cloneTouchLayoutProfile(migrated) } };
  }
  if (![2, 3, touchLayoutVersion].includes(value.version) || typeof value.profiles !== "object") return null;
  const profiles = {};
  for (const orientation of touchLayoutOrientations) {
    const profile = normalizeTouchLayoutProfile(value.profiles[orientation] ?? null);
    if (profile === undefined) return null;
    profiles[orientation] = profile;
  }
  return { version: touchLayoutVersion, profiles };
}
function loadTouchLayout() {
  try { return normalizeTouchLayout(JSON.parse(localStorage.getItem(touchLayoutStorageKey) || "null")); }
  catch { return null; }
}
function cloneTouchLayoutProfile(profile) {
  return profile ? {
    controls: Object.fromEntries(Object.entries(profile.controls).map(([name, item]) => [name, { ...item }])),
    viewport: { ...(profile.viewport || { x: 0 }) }
  } : null;
}
function cloneTouchLayout(layout) {
  return layout ? { version: touchLayoutVersion, profiles: Object.fromEntries(touchLayoutOrientations.map(orientation => [orientation, cloneTouchLayoutProfile(layout.profiles[orientation])])) } : null;
}
function emptyTouchLayout() { return { version: touchLayoutVersion, profiles: { landscape: null, portrait: null } }; }
let touchLayout = loadTouchLayout();
let touchLayoutDraft = null;
let touchLayoutEditing = false;
let touchLayoutSelected = "fire";
let touchLayoutDrag = null;
let touchLayoutEditorDrag = null;
let touchLayoutSettingsDrag = null;
let touchViewportEditing = false;
let touchViewportDrag = null;
let touchSensitivityPreviewGesture = null;
let touchSensitivityCustomOpen = false;
let touchLayoutEditorEnteredFullscreen = false;
const touchHelpSeenKey = "eagler-touch-help-seen-v8";
const mobileDevice = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
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
const changelogVersion = "20260822-1";
const changelogSeenKey = `eagler-touhou-changelog-seen-${changelogVersion}`;
const lessMotionStorageKey = "eagler-touhou-less-motion-v1";
const preferenceKey = gameId => `eagler-touhou-game-options-v1-${gameId}`;
const languagePreferenceKey = gameId => `eagler-touhou-language-v1-${gameId}`;
const currentPreferenceId = () => isMultiplayerProduct() && !mpShareSingleplayerSettings ? state.product : state.game;
const mpRoomSessionKeyForProduct = product => `eagler-touhou-${product}-room-v1`;
const mpRoomUrlKey = "mpRoom";
const mpRoomHistoryKey = "eaglerTouhouMpRoom";
const mpLobbyClientKeyForProduct = product => `eagler-touhou-${product}-lobby-client-v1`;
const mpDisplayNameKey = "eagler-touhou-mp-display-name-v1";
const mpDisplayNameLockedKey = "eagler-touhou-mp-display-name-locked-v1";
function mpNormalizeDisplayName(value) {
  return [...String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, 12).join("");
}
function mpDisplayInitial(name, fallback = "观") {
  return [...mpNormalizeDisplayName(name)][0] || fallback;
}
function mpDisplayNameLocked() {
  try { return localStorage.getItem(mpDisplayNameLockedKey) === "1" && !!mpNormalizeDisplayName(localStorage.getItem(mpDisplayNameKey) || ""); }
  catch { return !!mpUiState.displayName; }
}
function mpRestoreDisplayName() {
  try {
    mpUiState.displayName = mpNormalizeDisplayName(localStorage.getItem(mpDisplayNameKey) || "");
    if (mpUiState.displayName) localStorage.setItem(mpDisplayNameLockedKey, "1");
  }
  catch { mpUiState.displayName = ""; }
}
function mpStoreDisplayNameOnce(value) {
  const name = mpNormalizeDisplayName(value);
  if (!name || mpDisplayNameLocked()) return false;
  mpUiState.displayName = name;
  try {
    localStorage.setItem(mpDisplayNameKey, name);
    localStorage.setItem(mpDisplayNameLockedKey, "1");
  } catch {}
  return true;
}
function mpLobbyClientId(product = state.product) {
  const key = mpLobbyClientKeyForProduct(isMultiplayerProduct(product) ? product : "th07mp");
  try {
    let value = sessionStorage.getItem(key) || "";
    if (/^[A-Za-z0-9_-]{8,64}$/.test(value)) return value;
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    value = `c${bytes[0].toString(36)}${bytes[1].toString(36)}`;
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}
const mpLobby = {
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
const gameFeatures = gameId => manifest.games[gameId].features || {};
const languageDisplayNames = Object.freeze({
  ja: "日本語(原版)",
  "lang_zh-hans": "中文（简体）",
  "lang_zh-hant": "中文（繁體）",
  lang_en: "English",
  lang_ru: "Русский"
});
const languagePriority = id => id === "ja" ? 0
  : id === "lang_zh-hans" ? 10
  : id === "lang_zh-hant" ? 11
  : id === "lang_en" ? 20
  : 100;
const normalizeLanguageCatalog = entries => entries
  .map(entry => ({ ...entry, title: languageDisplayNames[entry.id] || entry.title || entry.id }))
  .sort((a, b) => languagePriority(a.id) - languagePriority(b.id) || String(a.id).localeCompare(String(b.id), "en"));
const languageCatalog = gameId => {
  const base = Array.isArray(manifest.games[gameId].languageOptions)
    ? manifest.games[gameId].languageOptions
    : (Array.isArray(manifest.games[gameId].languages)
      ? [{ id: "ja", title: "日本語(原版)", pack: null }, ...manifest.games[gameId].languages]
      : [{ id: "ja", title: "日本語(原版)", pack: null }]);
  const byId = new Map(base.map(entry => [String(entry.id), { ...entry }]));
  const importedLanguages = readImportedGameDataMeta(gameId)?.legacyAssets?.languages || [];
  for (const offlinePack of importedLanguages) {
    const existing = byId.get(offlinePack.id);
    byId.set(offlinePack.id, existing
      ? { ...existing, offlinePack }
      : { id: offlinePack.id, title: offlinePack.title, pack: null, offlinePack });
  }
  const generation = installedPackageSnapshots.get(gameId);
  const packageLanguages = generation?.descriptor?.components?.language?.entries || [];
  for (const packageEntry of packageLanguages) {
    const ref = generation.files?.[packageEntry.file];
    if (!ref?.objectId) continue;
    const declaration = generation.descriptor.files?.[packageEntry.file];
    const existing = byId.get(packageEntry.id);
    byId.set(packageEntry.id, {
      ...(existing || { id: packageEntry.id, pack: null }),
      title: packageEntry.title || existing?.title || packageEntry.id,
      packageFile: packageEntry.file,
      packageObjectId: ref.objectId,
      packageBytes: Number(declaration?.bytes) || 0,
    });
  }
  return normalizeLanguageCatalog([...byId.values()]);
};
const thpracLocaleForLanguage = id => id === "lang_zh-hans" ? "zh-CN" : id === "ja" ? "ja-JP" : "en-US";
const languageEntry = () => languageCatalog(state.game).find(item => item.id === state.language) || languageCatalog(state.game)[0];
const languageCacheName = "eagler-touhou-language-packs-v1";
function restoreGamePreferences(gameId, preferenceId = gameId) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(preferenceKey(preferenceId)) || "null"); } catch {}
  if (!saved && isMultiplayerProduct(preferenceId)) {
    try { saved = JSON.parse(localStorage.getItem(preferenceKey(gameFromProduct(preferenceId))) || "null"); } catch {}
  }
  // v1 used `limitPresentationTo60` as the host-side persisted key.  The
  // current host deliberately does not migrate that value: every existing
  // user must start the renamed option from its new default (false).  Strip
  // the legacy key from storage as well so a stale `true` cannot be revived
  // by a future object spread or compatibility path.
  if (saved?.options && Object.prototype.hasOwnProperty.call(saved.options, "limitPresentationTo60")) {
    delete saved.options.limitPresentationTo60;
    try { localStorage.setItem(preferenceKey(preferenceId), JSON.stringify(saved)); } catch {}
  }
  const options = { ...defaultOptions };
  for (const name of Object.keys(defaultOptions)) {
    if (typeof saved?.options?.[name] === typeof defaultOptions[name]) options[name] = saved.options[name];
  }
  // Migrate the old separate unlimitedTouch switch into the new mutually
  // exclusive movement selector without surprising existing local users.
  if (!touchMovementModes.has(saved?.options?.touchMovementMode)) {
    options.touchMovementMode = saved?.options?.unlimitedTouch === true ? "touch-unlimited" : "touch";
  }
  if (!touchMovementModes.has(options.touchMovementMode)) options.touchMovementMode = "touch";
  options.touchSensitivity = Number.isFinite(options.touchSensitivity)
    ? Math.min(300, Math.max(50, Math.round(options.touchSensitivity)))
    : 100;
  if (!touchFocusModes.has(options.touchFocusMode)) options.touchFocusMode = "hold-button";
  if (touchMovementUsesJoystick(options.touchMovementMode) && options.touchFocusMode === "two-finger") options.touchFocusMode = "hold-button";
  if (!gameFeatures(gameId).thprac) options.thpracEnabled = false;
  state.options = options;
  const legacyMusic = saved?.music === "ogg" || saved?.music === "wav" ? "ogg-stream" : saved?.music;
  state.musicPreferenceExplicit = saved?.musicPreferenceExplicit === true;
  state.music = webAudioAvailable
    ? (musicModes.has(legacyMusic) ? legacyMusic : "ogg-stream")
    : "none";
  const available = languageCatalog(gameId);
  let savedLanguage = null;
  try { savedLanguage = localStorage.getItem(languagePreferenceKey(preferenceId)); } catch {}
  if (!savedLanguage && isMultiplayerProduct(preferenceId)) {
    try { savedLanguage = localStorage.getItem(languagePreferenceKey(gameFromProduct(preferenceId))); } catch {}
  }
  state.language = available.some(item => item.id === savedLanguage) ? savedLanguage : "ja";
}
function saveGamePreferences() {
  const preferenceId = currentPreferenceId();
  try {
    localStorage.setItem(preferenceKey(preferenceId), JSON.stringify({
      music: state.music,
      musicPreferenceExplicit: state.musicPreferenceExplicit,
      options: Object.fromEntries(Object.keys(defaultOptions).map(name => [name, state.options[name]]))
    }));
  } catch {}
  try { localStorage.setItem(languagePreferenceKey(preferenceId), state.language); } catch {}
}
const loaded = {
  th06: localStorage.getItem("et-loaded-th06") === "1",
  th07: localStorage.getItem("et-loaded-th07") === "1"
};
const $ = selector => document.querySelector(selector);
const guideOrientationTitle = $("#guideOrientationTitle");
const guideOrientationSummary = $("#guideOrientationSummary");
const guideOrientationAndroid = $("#guideOrientationAndroid");
const guideOrientationIos = $("#guideOrientationIos");
if (showIosFullscreenHelp) {
  guideOrientationTitle.textContent = "iPhone 全屏游玩";
  guideOrientationSummary.textContent = "隐藏 Safari 导航栏";
  guideOrientationAndroid.hidden = true;
  guideOrientationIos.hidden = false;
}
const frame = $("#gameFrame");
const gameViewport = $("#gameViewport");
const player = $("#player");
const runtimeDiagnostics = $("#runtimeDiagnostics");
const runtimeBrowserDiag = $("#runtimeBrowserDiag");
const runtimeUaDiag = $("#runtimeUaDiag");
const runtimeGapDiag = $("#runtimeGapDiag");
const runtimeAudioDiag = $("#runtimeAudioDiag");
const runtimeRendererDiag = $("#runtimeRendererDiag");
const runtimeNetplaySessionDiag = $("#runtimeNetplaySessionDiag");
const runtimeNetplayRouteDiag = $("#runtimeNetplayRouteDiag");
const runtimeNetplayFrameDiag = $("#runtimeNetplayFrameDiag");
const runtimeNetplayRollbackDiag = $("#runtimeNetplayRollbackDiag");
const runtimeNetplayQualityDiag = $("#runtimeNetplayQualityDiag");
const runtimeNetplayIceDiag = $("#runtimeNetplayIceDiag");
const runtimeDiagnosticState = {
  maxGapMs: null,
  queuedMs: null,
  minQueuedMs: null,
  backend: "",
  underruns: 0,
  robust: false,
  renderer: ""
};
const runtimeNetplayQualityState = {
  peerTransport: null,
  sampling: false,
  peers: new Map(),
  confirmed: null,
  confirmedAt: null,
};
const netplayConnectionUiState = { transport: null, connectedOnce: false, routeWarningShown: false };
function browserEnvironmentLabels() {
  const ua = String(navigator.userAgent || "");
  const match = regex => regex.exec(ua)?.[1] || "";
  const chromeVersion = match(/(?:Chrome|CriOS)\/([\d.]+)/i);
  const isWebView = /;\s*wv\)/i.test(ua) || /\bVersion\/4\.0\b/i.test(ua) && /\bChrome\//i.test(ua);
  const browserCandidates = [
    [/\bVia(?:Browser)?[\/]?([\d.]*)/i, "Via"],
    [/\bQuark\/([\d.]+)/i, "Quark"],
    [/\bHuaweiBrowser\/([\d.]+)/i, "Huawei Browser"],
    [/\bMiuiBrowser\/([\d.]+)/i, "Mi Browser"],
    [/\bVivoBrowser\/([\d.]+)/i, "vivo Browser"],
    [/\bHeyTapBrowser\/([\d.]+)/i, "HeyTap Browser"],
    [/\bSamsungBrowser\/([\d.]+)/i, "Samsung Internet"],
    [/\bEdgA\/([\d.]+)/i, "Edge"],
    [/\bEdgiOS\/([\d.]+)/i, "Edge"],
    [/\bEdg\/([\d.]+)/i, "Edge"],
    [/\bOPR\/([\d.]+)/i, "Opera"],
    [/\bVivaldi\/([\d.]+)/i, "Vivaldi"],
    [/\bUCBrowser\/([\d.]+)/i, "UC Browser"],
    [/\bMQQBrowser\/([\d.]+)/i, "QQ Browser"],
    [/\bDuckDuckGo\/([\d.]+)/i, "DuckDuckGo"],
    [/\bFirefox\/([\d.]+)/i, "Firefox"],
    [/\bFxiOS\/([\d.]+)/i, "Firefox"],
    [/\bCriOS\/([\d.]+)/i, "Chrome"],
    [/\bChrome\/([\d.]+)/i, isWebView ? "Android WebView" : "Chrome"],
    [/\bVersion\/([\d.]+).*\bSafari\//i, "Safari"]
  ];
  let browser = "未知";
  for (const [regex, name] of browserCandidates) {
    const version = regex.exec(ua)?.[1];
    if (version != null) {
      browser = `${name}${version ? ` ${version}` : ""}`;
      break;
    }
  }
  if (browser.startsWith("Chrome") && navigator.brave) browser = `Brave${chromeVersion ? ` ${chromeVersion}` : ""}`;
  const androidVersion = match(/\bAndroid\s+([^;\)\s]+)/i);
  const iosVersion = match(/\b(?:CPU(?: iPhone)? OS|iPhone OS)\s+([\d_]+)/i).replaceAll("_", ".");
  const platform = androidVersion ? `Android ${androidVersion}` : iosVersion ? `iOS ${iosVersion}` :
    String(navigator.userAgentData?.platform || navigator.platform || "").trim();
  const engine = chromeVersion ? `Chromium ${chromeVersion}` :
    match(/\bFirefox\/([\d.]+)/i) ? `Gecko ${match(/\bFirefox\/([\d.]+)/i)}` :
    match(/\bVersion\/([\d.]+).*\bSafari\//i) ? `WebKit ${match(/\bVersion\/([\d.]+).*\bSafari\//i)}` : "";
  const mobile = navigator.userAgentData?.mobile === true || /\bMobile\b/i.test(ua);
  const tbsVersion = match(/\bTBS\/([\d.]+)/i);
  const traits = [engine, platform, tbsVersion ? `TBS ${tbsVersion}` : "", isWebView ? "WebView" : mobile ? "移动端" : "桌面端"].filter(Boolean);
  return { browser, ua: traits.join(" / ") || "--", raw: ua };
}
const browserEnvironment = browserEnvironmentLabels();
function compactRendererLabel(raw) {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (!value) return "--";
  const angle = /^ANGLE \((.*)\)$/.exec(value);
  if (!angle) return value.slice(0, 72);
  const parts = angle[1].split(",").map(part => part.trim()).filter(Boolean);
  const gpu = parts.find(part => /Adreno|Mali|GeForce|Radeon|Intel|Apple|PowerVR|SwiftShader|llvmpipe/i.test(part));
  return String(gpu || parts[1] || parts[0] || value).slice(0, 72);
}
function resetRuntimeDiagnostics() {
  Object.assign(runtimeDiagnosticState, {
    maxGapMs: null, queuedMs: null, minQueuedMs: null,
    backend: "", underruns: 0, robust: false, renderer: ""
  });
  runtimeBrowserDiag.textContent = `浏览器 ${browserEnvironment.browser}`;
  runtimeUaDiag.textContent = `环境 ${browserEnvironment.ua}`;
  runtimeGapDiag.textContent = "最大间隔 --";
  runtimeAudioDiag.textContent = "音频 --";
  runtimeRendererDiag.textContent = "显卡 --";
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
function resetRuntimeNetplayQuality(peerTransport = null) {
  runtimeNetplayQualityState.peerTransport = peerTransport;
  runtimeNetplayQualityState.sampling = false;
  runtimeNetplayQualityState.peers.clear();
  runtimeNetplayQualityState.confirmed = null;
  runtimeNetplayQualityState.confirmedAt = null;
}
function runtimeNetplaySnapshot() {
  // Product selection alone is not proof that the running game is the LAN
  // Runtime. Never show multiplayer diagnostics over an ordinary game, but
  // keep probing a dedicated multiplayer product even if runtimeVariant was
  // accidentally downgraded - that mismatch is itself diagnostic evidence.
  const multiplayerSurface = state.runtimeVariant === "multiplayer" || isMultiplayerProduct();
  if (!new Set(["th06", "th07"]).has(state.game) || !multiplayerSurface) return null;
  let runtime = null;
  try { runtime = currentRuntimeWindow(); } catch {}
  const value = name => {
    try { return runtime?.[name]; } catch { return undefined; }
  };
  const number = name => {
    const parsed = Number(value(name));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rawRtcPaths = value("__eaglerNetplayRtcPaths");
  const rtcPaths = Array.isArray(rawRtcPaths)
    ? rawRtcPaths.filter(entry => entry && typeof entry === "object").slice(0, 2)
    : [];
  const rawLanPeers = value("__eaglerNetplayLanPeers");
  const lanPeers = Array.isArray(rawLanPeers)
    ? rawLanPeers.filter(entry => entry && typeof entry === "object").slice(0, 3)
    : [];
  const peerState = value(state.game === "th06" ? "__th06PeerTransport" : "__th07PeerTransport");
  let mode = "";
  try { mode = String(runtime?.Module?.eaglerOptions?.netplayMode || ""); } catch {}
  if (mode !== "lan") return null;
  const peerSize = Number(peerState?.peers?.size);
  return {
    mode,
    build: String(value("__eaglerNetplayRuntimeBuild") || "--"),
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
    teamWipeTimer: number("__eaglerNetplayTeamWipeTimer"),
    playerStates: Array.isArray(value("__eaglerNetplayPlayerStates")) ? value("__eaglerNetplayPlayerStates") : [],
    pauseState: Array.isArray(value("__eaglerNetplayPauseState")) ? value("__eaglerNetplayPauseState") : [],
    rtcPaths,
    lanPeers,
    peerCount: Number.isFinite(peerSize) && peerSize >= 0 ? peerSize : null,
    rtcReady: peerState?.rtcReadySent === true,
    failed: peerState?.failed === true,
    error: typeof peerState?.error === "string" ? peerState.error : "",
    peerState,
  };
}
function updateNetplayConnectionWindow(net) {
  const windowElement = $("#netplayConnectionWindow");
  if (!windowElement) return;
  if (!net || state.replayViewer || !net.peerState) {
    windowElement.hidden = true;
    return;
  }
  if (net.spectator) {
    const relayReady = net.peerState.relay?.readyState === WebSocket.OPEN;
    windowElement.hidden = relayReady;
    if (!relayReady) {
      $("#netplayConnectionTitle").textContent = net.failed ? "旁观连接已断开" : "正在连接旁观流…";
      $("#netplayConnectionSummary").textContent = net.failed
        ? String(net.error || "旁观中继连接失败") : "等待本局只读确认帧";
      $("#netplayConnectionPeers").replaceChildren();
      $("#netplayConnectionWarning").hidden = true;
      windowElement.classList.toggle("reconnecting", net.failed);
    }
    return;
  }
  if (netplayConnectionUiState.transport !== net.peerState) {
    netplayConnectionUiState.transport = net.peerState;
    netplayConnectionUiState.connectedOnce = false;
    netplayConnectionUiState.routeWarningShown = false;
  }
  const expected = Math.max(1, Number(state.netplay.playerCount || 2) - 1);
  const localPlayer = Math.max(0, Number(state.netplay.player) || 0);
  const peerRows = [];
  let rtcReadyPeers = 0;
  for (let player = 0; player < expected + 1; player++) {
    if (player === localPlayer) continue;
    const peer = net.peerState.peers?.get?.(player);
    const pcState = String(peer?.pc?.connectionState || peer?.pc?.iceConnectionState || "");
    const channelsReady = peer?.inputOpen === true && peer?.controlOpen === true;
    if (channelsReady) rtcReadyPeers++;
    const disconnected = ["disconnected", "failed", "closed"].includes(pcState) ||
      (netplayConnectionUiState.connectedOnce && net.transport === "rtc" && !channelsReady);
    const status = disconnected ? "已经断开，重连中..." : channelsReady ? "已连接" : pcState === "checking" || pcState === "connecting" ? "正在协商" : "等待连接";
    peerRows.push({ player, status, disconnected, detail: pcState || (channelsReady ? "datachannel" : "signaling") });
  }
  const relayReady = net.transport === "relay" && net.peerState.relay?.readyState === WebSocket.OPEN;
  const allReady = relayReady || (net.transport === "rtc" && rtcReadyPeers === expected);
  if (allReady) {
    netplayConnectionUiState.connectedOnce = true;
    windowElement.hidden = true;
    const degradedRoute = net.transport === "relay" || net.path === "turn" || net.path === "mixed";
    if (degradedRoute && !netplayConnectionUiState.routeWarningShown) {
      netplayConnectionUiState.routeWarningShown = true;
      showToast("直连失败，连接质量可能较差，请尽量使用宽带（WiFi 或 网线）而非流量或 VPN。", 8000);
    }
    return;
  }
  const disconnectedRows = peerRows.filter(row => row.disconnected);
  const reconnecting = netplayConnectionUiState.connectedOnce && (disconnectedRows.length > 0 || net.failed);
  $("#netplayConnectionTitle").textContent = reconnecting
    ? `${disconnectedRows.length ? `P${disconnectedRows.map(row => row.player + 1).join(" / P")}` : "连接"} 已经断开，重连中...`
    : "正在连接其他玩家…";
  $("#netplayConnectionSummary").textContent = `路径 ${net.transport === "rtc" ? "RTC" : net.transport === "relay" ? "WebSocket Relay" : "协商中"} - ${net.path || "connecting"} - ${rtcReadyPeers}/${expected} peers ready`;
  const peersElement = $("#netplayConnectionPeers");
  peersElement.replaceChildren(...peerRows.map(row => {
    const item = document.createElement("div");
    item.className = "netplay-connection-peer";
    const label = document.createElement("span"); label.textContent = `P${row.player + 1} ${row.status}`;
    const detail = document.createElement("span"); detail.textContent = row.detail;
    item.append(label, detail);
    return item;
  }));
  const warning = $("#netplayConnectionWarning");
  const directFailed = net.transport === "relay" || net.path === "turn" || net.path === "mixed" || net.failed;
  warning.hidden = !directFailed;
  warning.textContent = directFailed ? "直连失败，连接质量可能较差，请尽量使用宽带（WiFi 或 网线）而非流量或 VPN。" : "";
  windowElement.classList.toggle("reconnecting", reconnecting);
  windowElement.hidden = false;
}
function selectedRtcPair(stats) {
  for (const report of stats.values()) {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      const pair = stats.get(report.selectedCandidatePairId);
      if (pair) return pair;
    }
  }
  for (const report of stats.values()) {
    if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") return report;
  }
  return null;
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
    const seenPeers = new Set();
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
        quality.rttMs = rttMs;
        quality.samples.push(rttMs);
        if (quality.samples.length > 20) quality.samples.shift();
        const sorted = [...quality.samples].sort((a, b) => a - b);
        const p50 = sorted[Math.floor((sorted.length - 1) * .5)];
        const p95 = sorted[Math.floor((sorted.length - 1) * .95)];
        quality.variationMs = quality.samples.length >= 3 ? Math.max(0, p95 - p50) : null;
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
  const wipe = net.teamWipeTimer != null ? Math.max(0, Math.trunc(net.teamWipeTimer)) : null;
  const states = net.playerStates.length ? ` - states ${net.playerStates.join("/")}` : "";
  const pause = net.pauseState.length ? ` - pause ${net.pauseState.join("/")}` : "";
  const role = net.spectator ? `旁观/${playerCount}P` : `P${playerIndex + 1}/${playerCount}`;
  runtimeNetplaySessionDiag.textContent = `联机 房间 ${room} - ${role} - runtime ${state.runtimeVariant}/${net.mode || "--"} - build ${net.build}${wipe != null ? ` - wipe ${wipe}` : ""}${states}${pause}`;

  const transport = net.transport === "rtc" ? "RTC" : net.transport === "relay" ? "WS Relay" : net.transport === "spectator" ? "只读 WS" : "连接中";
  const route = net.transport === "relay" ? "relay" : net.path;
  const protocols = [...new Set(net.rtcPaths.map(entry => String(entry.protocol || "").toUpperCase()).filter(Boolean))];
  const families = [...new Set(net.rtcPaths.map(entry => String(entry.family || "")).filter(Boolean))];
  const expectedPeers = Math.max(1, playerCount - 1);
  const peerStatus = net.spectator ? "不占玩家席" : net.peerCount == null ? "peers --" : `peers ${net.peerCount}/${expectedPeers}${net.rtcReady ? " ready" : ""}`;
  runtimeNetplayRouteDiag.textContent = `网络 ${transport} - ${route}${protocols.length ? ` - ${protocols.join("/")}` : ""}${families.length ? `/${families.join("/")}` : ""} - ${peerStatus}${net.failed ? ` - FAIL ${net.error || "transport"}` : ""}`;

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
  runtimeNetplayFrameDiag.textContent = net.active
    ? `同步 F${frame ?? "--"} - confirmed ${confirmed ?? "--"}${peerFrames ? ` - ${peerFrames}` : ""}`
    : "同步 等待 Stage 1 接管";

  const rollback = net.rollback != null ? Math.max(0, Math.trunc(net.rollback)) : 0;
  const resimulated = net.resimulated != null ? Math.max(0, Math.trunc(net.resimulated)) : 0;
  const advantage = net.advantage != null ? `${net.advantage >= 0 ? "+" : ""}${net.advantage.toFixed(2)}` : "--";
  const pacing = net.pacing != null ? net.pacing.toFixed(4) : "--";
  runtimeNetplayRollbackDiag.textContent = net.spectator
    ? "旁观只消费全员确认帧 - 无预测 / 无回滚 / 无本地输入"
    : `回滚 ${rollback} - 重模拟 ${resimulated} - lead ${advantage} - pace ${pacing}`;

  const confirmedAgeMs = runtimeNetplayQualityState.confirmedAt == null
    ? null : Math.max(0, performance.now() - runtimeNetplayQualityState.confirmedAt);
  const qualities = [...runtimeNetplayQualityState.peers.values()];
  const rttValues = qualities.map(quality => quality.rttMs).filter(Number.isFinite);
  const variationValues = qualities.map(quality => quality.variationMs).filter(Number.isFinite);
  const iceStates = [...new Set(qualities
    .map(quality => quality.iceState || quality.connectionState)
    .filter(Boolean))];
  runtimeNetplayQualityDiag.textContent = `质量 RTT ${rttValues.length ? `${Math.round(Math.max(...rttValues))}ms` : "--"} - 波动 ${variationValues.length ? `${Math.round(Math.max(...variationValues))}ms` : "--"} - 输入停顿 ${net.active && confirmedAgeMs != null ? `${(confirmedAgeMs / 1000).toFixed(1)}s` : "--"} - ICE ${iceStates.join("/") || "--"}`;
  runtimeNetplayIceDiag.textContent = net.rtcPaths.length
    ? `ICE ${net.rtcPaths.map(entry => `P${Number(entry.peer) + 1} ${entry.path || "?"}/${String(entry.protocol || "?").toLowerCase()}/${entry.family || "?"}`).join(" - ")}`
    : `ICE ${net.transport === "relay" ? "WebSocket fallback" : "候选路径 --"}`;
}
function updateRuntimeDiagnostics() {
  const diag = runtimeDiagnosticState;
  runtimeBrowserDiag.textContent = `浏览器 ${browserEnvironment.browser}`;
  runtimeUaDiag.textContent = `环境 ${browserEnvironment.ua}`;
  runtimeGapDiag.textContent = `最大间隔 ${Number.isFinite(diag.maxGapMs) ? `${Math.round(diag.maxGapMs)}ms` : "--"}`;
  const backend = diag.backend === "worklet" ? "AW" : diag.backend === "script" ? "SP" : "";
  const audioParts = [
    `音频 ${Number.isFinite(diag.minQueuedMs) ? `${Math.max(0, Math.round(diag.minQueuedMs))}ms` : "--"}`,
    backend,
    diag.robust ? "增强" : "",
    diag.underruns > 0 ? `欠载${diag.underruns}` : ""
  ].filter(Boolean);
  runtimeAudioDiag.textContent = audioParts.join(" ");
  runtimeRendererDiag.textContent = `显卡 ${compactRendererLabel(diag.renderer)}`;
  updateNetplayDiagnostics();

  const softwareRenderer = /SwiftShader|llvmpipe|software raster/i.test(diag.renderer);
  const audioBad = diag.underruns > 0 || (Number.isFinite(diag.minQueuedMs) && diag.minQueuedMs < 5);
  const frameBad = Number.isFinite(diag.maxGapMs) && diag.maxGapMs >= 80;
  const audioWarn = Number.isFinite(diag.minQueuedMs) && diag.minQueuedMs < 20;
  const frameWarn = Number.isFinite(diag.maxGapMs) && diag.maxGapMs >= 35;
  runtimeDiagnostics.classList.toggle("bad", softwareRenderer || audioBad || frameBad);
  runtimeDiagnostics.classList.toggle("warn", !softwareRenderer && !audioBad && !frameBad && (audioWarn || frameWarn));
  runtimeDiagnostics.hidden = !state.launched;
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
const gameZoomState = { active: false, scale: 1, x: 0, y: 0, pointers: new Map(), pinch: null };
const gameZoomMinScale = 1;
const gameZoomMaxScale = 3;
const touchLayoutSafeZone = $("#touchLayoutSafeZone");
const touchSensitivityPreview = $("#touchSensitivityPreview");
const touchLayoutElement = name => $("#" + touchLayoutControlMeta[name].id);
function touchLayoutOrientation() {
  const width = window.visualViewport?.width || document.documentElement.clientWidth || player.clientWidth;
  const height = window.visualViewport?.height || document.documentElement.clientHeight || player.clientHeight;
  return width >= height ? "landscape" : "portrait";
}
function currentTouchLayout() { return touchLayoutEditing ? touchLayoutDraft : touchLayout; }
function currentTouchViewportPosition(layout = currentTouchLayout()) {
  return layout?.profiles?.[touchLayoutOrientation()]?.viewport || { x: 0 };
}
function gameViewportBaseOffsetPx(layout = currentTouchLayout()) {
  const viewport = currentTouchViewportPosition(layout);
  return { x: viewport.x * player.clientWidth, y: 0 };
}
function clearTouchLayoutStyles() {
  player.classList.remove("touch-layout-custom");
  for (const name of Object.keys(touchLayoutControlMeta)) {
    const element = touchLayoutElement(name);
    element.style.removeProperty("--touch-layout-x");
    element.style.removeProperty("--touch-layout-y");
    element.style.removeProperty("--touch-layout-scale");
    element.style.removeProperty("z-index");
  }
}
function effectiveTouchLayoutPosition(element, item) {
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
function applyTouchLayout(layout = currentTouchLayout()) {
  const profile = layout?.profiles?.[touchLayoutOrientation()] || null;
  if (!profile) {
    clearTouchLayoutStyles();
    if (state.launched || touchLayoutEditing) applyGameZoomTransform();
    return;
  }
  const hostRect = player.getBoundingClientRect();
  const safeRect = touchLayoutSafeZone.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height || !safeRect.width || !safeRect.height) return;
  player.classList.add("touch-layout-custom");
  for (const [name, item] of Object.entries(profile.controls)) {
    const element = touchLayoutElement(name);
    const position = effectiveTouchLayoutPosition(element, item);
    const x = safeRect.left - hostRect.left + position.x * safeRect.width;
    const y = safeRect.top - hostRect.top + position.y * safeRect.height;
    element.style.setProperty("--touch-layout-x", `${x}px`);
    element.style.setProperty("--touch-layout-y", `${y}px`);
    element.style.setProperty("--touch-layout-scale", String(item.scale));
    element.style.zIndex = String(31 + (Number.isFinite(item.priority) ? item.priority : touchLayoutControlMeta[name].priority));
  }
  if (state.launched || touchLayoutEditing) applyGameZoomTransform();
}
function captureDefaultTouchLayoutProfile() {
  const hiddenStates = Object.fromEntries(Object.keys(touchLayoutControlMeta).map(name => [name, touchLayoutElement(name).hidden]));
  player.classList.add("touch-layout-capturing");
  for (const name of Object.keys(touchLayoutControlMeta)) touchLayoutElement(name).hidden = false;
  clearTouchLayoutStyles();
  try {
    const safe = touchLayoutSafeZone.getBoundingClientRect();
    if (safe.width <= 0 || safe.height <= 0) throw new Error("触控布局预览区域尚未就绪");
    const controls = {};
    for (const name of Object.keys(touchLayoutControlMeta)) {
      const rect = touchLayoutElement(name).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error(`${touchLayoutControlMeta[name].title} 按键不可见`);
      controls[name] = {
        x: Math.max(0, Math.min(1, (rect.left + rect.width / 2 - safe.left) / safe.width)),
        y: Math.max(0, Math.min(1, (rect.top + rect.height / 2 - safe.top) / safe.height)),
        scale: 1,
        priority: touchLayoutControlMeta[name].priority
      };
    }
    return { controls: normalizeTouchLayoutPriorityOrder(controls), viewport: { x: 0 } };
  } finally {
    for (const [name, hidden] of Object.entries(hiddenStates)) touchLayoutElement(name).hidden = hidden;
    player.classList.remove("touch-layout-capturing");
  }
}
function ensureTouchLayoutDraftProfile() {
  if (!touchLayoutDraft) touchLayoutDraft = emptyTouchLayout();
  const orientation = touchLayoutOrientation();
  if (!touchLayoutDraft.profiles[orientation]) {
    touchLayoutDraft.profiles[orientation] = captureDefaultTouchLayoutProfile();
  } else {
    const missing = Object.keys(touchLayoutControlMeta).filter(name => !touchLayoutDraft.profiles[orientation].controls[name]);
    if (missing.length) {
      const defaults = captureDefaultTouchLayoutProfile();
      for (const name of missing) touchLayoutDraft.profiles[orientation].controls[name] = { ...defaults.controls[name] };
      normalizeTouchLayoutPriorityOrder(touchLayoutDraft.profiles[orientation].controls);
      // Missing fields here are schema-extension migration (not an editor
      // action): mirror them into the saved baseline so merely opening an old
      // four-control layout does not create a false "unsaved changes" prompt.
      if (touchLayout?.profiles?.[orientation]) {
        for (const name of missing) touchLayout.profiles[orientation].controls[name] = { ...defaults.controls[name] };
        normalizeTouchLayoutPriorityOrder(touchLayout.profiles[orientation].controls);
        try { localStorage.setItem(touchLayoutStorageKey, JSON.stringify(touchLayout)); } catch {}
      }
      applyTouchLayout(touchLayoutDraft);
    }
  }
  return touchLayoutDraft.profiles[orientation];
}
function persistTouchLayout(layout) {
  const normalized = normalizeTouchLayout(layout);
  touchLayout = normalized && touchLayoutOrientations.some(orientation => normalized.profiles[orientation]) ? normalized : null;
  try {
    if (touchLayout) localStorage.setItem(touchLayoutStorageKey, JSON.stringify(touchLayout));
    else localStorage.removeItem(touchLayoutStorageKey);
  } catch {}
  applyTouchLayout(touchLayout);
}
function canonicalTouchLayout(layout) {
  const normalized = normalizeTouchLayout(layout);
  return normalized && touchLayoutOrientations.some(orientation => normalized.profiles[orientation]) ? normalized : null;
}
function touchLayoutHasUnsavedChanges() {
  return JSON.stringify(canonicalTouchLayout(touchLayoutDraft)) !== JSON.stringify(touchLayout);
}
function siteNoticeBrandAsset(url) {
  const resolved = new URL(url, location.href);
  const host = resolved.hostname.toLowerCase();
  if (host === "cloud.touhou.best") return "assets/notice-touhou-cloud.png";
  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) return "assets/notice-bilibili.svg";
  if (resolved.origin === location.origin && /(?:^|\/)faq\.html$/i.test(resolved.pathname)) return "assets/th06.ico";
  return "";
}

function appendSiteNoticeLine(target, line) {
  const row = document.createElement("div");
  row.className = "site-notice-line";
  const linkPattern = /\[([^\]]+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of line.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) row.append(document.createTextNode(line.slice(cursor, index)));
    let url;
    try { url = new URL(match[2], location.href); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const link = document.createElement("a");
    const asset = siteNoticeBrandAsset(url.href);
    link.className = "site-notice-brand";
    link.href = match[2];
    if (url.origin !== location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.title = url.href;
    if (asset) {
      const icon = document.createElement("span");
      icon.className = "site-notice-brand-icon";
      const image = document.createElement("img");
      image.src = asset;
      image.alt = "";
      image.decoding = "async";
      icon.append(image);
      link.append(icon);
    }
    const label = document.createElement("span");
    label.textContent = match[1];
    link.append(label);
    row.append(link);
    cursor = index + match[0].length;
  }
  if (cursor < line.length) row.append(document.createTextNode(line.slice(cursor)));
  target.append(row);
}

function renderSiteNoticeText(target, text) {
  target.replaceChildren();
  for (const line of text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    appendSiteNoticeLine(target, line);
  }
}

const siteNoticeDurationMs = 12000;
let siteNoticeTimer = null;
const siteNoticeScrollPositions = new WeakMap();

async function loadSiteNotice() {
  const bar = $("#siteNotice");
  const target = $("#siteNoticeContent");
  try {
    const response = await fetch("NOTICE.txt", { cache: "no-store" });
    if (!response.ok) return;
    const text = (await response.text()).replace(/^\uFEFF/, "").trim();
    if (!text) return;
    renderSiteNoticeText(target, text);
    clearTimeout(siteNoticeTimer);
    bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
    const scrollingElement = document.scrollingElement || document.documentElement;
    siteNoticeScrollPositions.set(scrollingElement, Math.max(0, window.scrollY || scrollingElement.scrollTop || 0));
    bar.style.setProperty("--site-notice-duration", `${siteNoticeDurationMs}ms`);
    bar.hidden = false;
    siteNoticeTimer = setTimeout(closeSiteNotice, siteNoticeDurationMs);
  } catch {}
}

function closeSiteNotice() {
  clearTimeout(siteNoticeTimer);
  siteNoticeTimer = null;
  const bar = $("#siteNotice");
  if (bar.hidden || bar.classList.contains("site-notice-closing")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || bar.classList.contains("site-notice-scroll-hidden")) {
    bar.hidden = true;
    bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
    return;
  }
  bar.classList.add("site-notice-closing");
  setTimeout(() => {
    bar.hidden = true;
    bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
  }, 220);
}

function handleSiteNoticeScroll(event) {
  const bar = $("#siteNotice");
  if (bar.hidden) return;
  const scrollingElement = document.scrollingElement || document.documentElement;
  const target = event?.target instanceof Element ? event.target : scrollingElement;
  const current = Math.max(0, target === scrollingElement ? (window.scrollY || scrollingElement.scrollTop || 0) : target.scrollTop);
  const previous = siteNoticeScrollPositions.get(target) ?? current;
  siteNoticeScrollPositions.set(target, current);
  const delta = current - previous;
  if (Math.abs(delta) < 3) return;
  if (delta > 0 && current > 10) bar.classList.add("site-notice-scroll-hidden");
  else if (delta < 0) bar.classList.remove("site-notice-scroll-hidden");
}
const maxImportBytes = 128 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
let midiSynth = null;
let gameKeyWindow = null;
let fullscreenChordActive = false;
const playerHistoryKey = "eaglerTouhouPlayer";
const routedGameFromLocation = () => {
  const value = new URLSearchParams(location.search).get("game");
  return value === "th06" || value === "th07" || value === "th06mp" || value === "th07mp" ? value : null;
};
function launcherHomeUrl(source = location.href) {
  const url = new URL(source);
  url.searchParams.delete("game");
  url.searchParams.delete(mpRoomUrlKey);
  return url;
}
function launcherHomeHistoryState() {
  const next = {
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    [playerHistoryKey]: false,
    [mpRoomHistoryKey]: false,
  };
  delete next.game;
  return next;
}
function replaceLauncherHomeHistory() {
  history.replaceState(launcherHomeHistoryState(), "", launcherHomeUrl());
}
function showLauncherHome() {
  state.hasSelection = false;
  if (isMultiplayerProduct()) {
    state.product = state.game;
    state.runtimeVariant = "normal";
  }
  render();
}
const routedGame = routedGameFromLocation();
const navigationType = performance.getEntriesByType?.("navigation")?.[0]?.type || "";
const debugHarness = new URLSearchParams(location.search).get("debug");
restoreGamePreferences(state.game);
if (routedGame) {
  state.product = routedGame;
  state.game = gameFromProduct(routedGame);
  state.runtimeVariant = isMultiplayerProduct(routedGame) ? "multiplayer" : "normal";
  restoreMpProductPreferences(routedGame);
  restoreGamePreferences(state.game, currentPreferenceId());
  state.hasSelection = true;
  if (navigationType === "reload") {
    const reloadUrl = new URL(location.href);
    const reloadRoom = mpNormalizeRoomCode(reloadUrl.searchParams.get(mpRoomUrlKey));
    const reloadState = { ...(history.state || {}), [playerHistoryKey]: false };
    if (reloadRoom && isMultiplayerProduct(routedGame)) {
      // A multiplayer room route is itself the persistent page state. Keep the
      // product discriminator across refreshes; without it TH06MP degrades to
      // the legacy/default TH07MP product on the next room restore.
      reloadUrl.searchParams.set("game", routedGame);
      reloadState.game = routedGame;
      reloadState[mpRoomHistoryKey] = reloadRoom;
    } else {
      reloadUrl.searchParams.delete("game");
      delete reloadState.game;
    }
    history.replaceState(reloadState, "", reloadUrl);
  } else if (!history.state?.[playerHistoryKey]) {
    const gameUrl = new URL(location.href);
    const homeUrl = new URL(location.href); homeUrl.searchParams.delete("game");
    history.replaceState({ ...(history.state || {}), [playerHistoryKey]: false }, "", homeUrl);
    history.pushState({ [playerHistoryKey]: true, game: routedGame }, "", gameUrl);
  }
}
const setStatus = text => { $("#status").textContent = text; };
const setPlayerStatus = text => { $("#playerStatus").textContent = text; };
let toastTimer = null;
const toastDurationMs = 2000;
let decisionResolver = null;
let decisionFocusReturn = null;
let transferSpeed = 0;
let transferMode = "";
let transferKind = "";
let transferHideTimer = null;
let blockingNetworkOperation = null;
const backgroundPackageUpdates = new Map();
const backgroundOggInstalls = new Map();
let deferredBackgroundPackageUpdate = null;
let musicNoticeTimer = null;
let guidePlaybackTimer = null;
let guideShotTimer = null;
const gameDataStartFallbackMs = 10_000;
const gameDataCompleteFallbackMs = 20_000;
const firstFrameFallbackMs = 12_000;
let gameDataAttemptSerial = 0;
let gameDataAttempt = null;
let firstFrameWatchdogSerial = 0;
let firstFrameWatchdog = null;
let firstFrameExpected = false;
let firstFrameTimedOut = false;
const androidBrowsingContextFocus = /\bAndroid\b/i.test(navigator.userAgent || "");
let playerFocusTimer = null;
let playerFocusDeadline = 0;

function focusPlayerBrowsingContext() {
  if (!androidBrowsingContextFocus || !player.classList.contains("open") || !frame.contentWindow) return;
  try { frame.focus({ preventScroll: true }); } catch { try { frame.focus(); } catch {} }
  try { frame.contentWindow.focus(); } catch {}
}

function stopPlayerFocusRelay() {
  if (playerFocusTimer) clearInterval(playerFocusTimer);
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
  clearTimeout(toastTimer);
  toastTimer = null;
  $("#toast").classList.remove("show");
}
function showToast(text) {
  syncTransientOverlayHost();
  const toast = $("#toast");
  $("#toastText").textContent = text;
  clearTimeout(toastTimer);
  // Restart the fixed two-second progress bar when a toast replaces another toast.
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  toastTimer = setTimeout(hideToast, toastDurationMs);
}
function isCancelledDownload(error) {
  return error?.name === "AbortError" || /已取消下载/.test(String(error?.message || error || ""));
}
function syncTransferCancelButton() {
  const button = $("#transferCancel");
  if (!button) return;
  button.hidden = !blockingNetworkOperation;
  button.textContent = blockingNetworkOperation?.label || "取消下载";
}
function beginBlockingNetworkOperation({ label = "取消下载", onCancel = null } = {}) {
  const operation = { controller: new AbortController(), label, onCancel };
  blockingNetworkOperation = operation;
  syncTransferCancelButton();
  return operation;
}
function finishBlockingNetworkOperation(operation) {
  if (blockingNetworkOperation !== operation) return;
  blockingNetworkOperation = null;
  syncTransferCancelButton();
}
function cancelBlockingNetworkOperation() {
  const operation = blockingNetworkOperation;
  if (!operation) return;
  blockingNetworkOperation = null;
  syncTransferCancelButton();
  operation.controller.abort();
  try { operation.onCancel?.(); } catch (error) { console.warn("blocking download cancel handler failed", error); }
}
function askDecision({ message = "", confirmText = "确定", cancelText = "取消", secondaryText = "", tone = "normal", confirmOnEnter = false } = {}) {
  syncTransientOverlayHost();
  const dialog = $("#decisionDialog");
  if (decisionResolver || dialog.open) return Promise.resolve("cancel");
  $("#decisionTitle").textContent = "确认吗？";
  $("#decisionMessage").textContent = message;
  $("#decisionConfirm").textContent = confirmText;
  $("#decisionCancel").textContent = cancelText;
  const secondary = $("#decisionSecondary");
  secondary.hidden = !secondaryText;
  secondary.textContent = secondaryText || "后台下载";
  dialog.dataset.tone = tone;
  dialog.dataset.options = secondaryText ? "3" : "2";
  dialog.dataset.confirmOnEnter = String(!!confirmOnEnter);
  dialog.classList.remove("closing");
  decisionFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise(resolve => {
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
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  const host = fullscreenElement === player ? player : document.body;
  for (const id of ["toast", "startupError", "decisionDialog", "gameDataImportWindow", "gameDataLinkWindow"]) {
    const element = $("#" + id);
    if (element && element.parentNode !== host) host.append(element);
  }
}
function showStartupError(error, context = "启动失败", allowAfterLaunch = false) {
  if (state.launched && !allowAfterLaunch) return;
  syncTransientOverlayHost();
  const detail = error?.stack || error?.message || String(error);
  $("#startupErrorText").textContent = `[${new Date().toLocaleString()}] ${context}\n${detail}`;
  $("#startupError").hidden = false;
}
function clearFirstFrameWatchdog() {
  stopPlayerFocusRelay();
  if (firstFrameWatchdog) clearTimeout(firstFrameWatchdog);
  firstFrameWatchdog = null;
  firstFrameExpected = false;
  firstFrameTimedOut = false;
  firstFrameWatchdogSerial++;
}
function armFirstFrameWatchdog() {
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
    setPlayerStatus("运行组件已启动，但 12 秒内没有出现首帧");
    showStartupError(new Error(`游戏运行组件已经就绪并进入启动阶段，但 12 秒内没有收到首帧回执。\n这已经越过游戏资源、语言包、字体和音乐等下载阶段，优先检查浏览器 WebGL/WASM、图形驱动、内存或运行组件异常，而不是继续把它归类为 CDN 下载失败。\n\n${diagnostic}`), `${gameId.toUpperCase()} / 首帧`, true);
  }, firstFrameFallbackMs);
}
function noteFirstFrame() {
  stopPlayerFocusRelay();
  if (!firstFrameExpected) return;
  if (firstFrameWatchdog) clearTimeout(firstFrameWatchdog);
  firstFrameWatchdog = null;
  firstFrameExpected = false;
  firstFrameWatchdogSerial++;
  if (firstFrameTimedOut) clearStartupError();
  firstFrameTimedOut = false;
}
function isResourceLoadFailure(error) {
  const message = String(error?.message || error || "");
  return /网络\s*\/\s*CDN|网络|CDN|超时|HTTP\s+\d+|Failed to fetch|Load failed|NetworkError|ERR_(?:CONNECTION|TIMED_OUT|NETWORK|INTERNET|FAILED)|当前服务器不提供游戏文件|请先导入本地游戏包|请导入本地游戏包|本机没有已安装的\s*TH0[67]\s*游戏资源|服务器发行信息尚未就绪/i.test(message);
}
function clearStartupError() { $("#startupError").hidden = true; $("#startupErrorText").textContent = ""; }
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const value = Math.min(Math.ceil(seconds), 99 * 60 + 59);
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
function hideTransfer() {
  if (networkActivity.activeCount > 0) {
    renderNetworkActivity(networkActivity.snapshot());
    return;
  }
  clearTimeout(transferHideTimer);
  transferHideTimer = null;
  $("#transfer").hidden = true;
  $("#transfer").dataset.networkOwned = "0";
  $("#transfer").querySelector(".transfer-bar")?.classList.remove("indeterminate");
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
    open.title = "查看备用游戏下载链接和提取码";
    url.href = gameDataFallback.url;
    url.textContent = gameDataFallback.url;
    hint.textContent = gameDataFallback.hint || "无";
  } else {
    open.disabled = true;
    open.title = "当前服务器未提供备用游戏下载链接";
    url.removeAttribute("href");
    url.textContent = "当前服务器未提供备用下载链接";
    hint.textContent = "无";
  }
}
function setGameDataImportBusy(busy, text = "正在校验并安装游戏包…") {
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
    clearTimeout(gameDataAttempt.startTimer);
    clearTimeout(gameDataAttempt.completeTimer);
    if (gameDataAttempt.blockingOperation) finishBlockingNetworkOperation(gameDataAttempt.blockingOperation);
  }
  gameDataAttempt = null;
  closeGameDataFallbackWindows();
}
function beginManualGamePackageImport(reason = "已取消从服务器下载游戏资源。") {
  clearGameDataAttempt();
  const id = ++gameDataAttemptSerial;
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false, startTimer: null, completeTimer: null, manual: true };
  $("#gameDataImportReason").textContent = `${reason}\n请选择本地游戏包导入；如果服务器提供了备用下载地址，也可以点击「打开链接」取得游戏包。`;
  updateGameDataLinkWindow();
  openGameDataImportWindow();
}
function gameDataFallbackText(reason) {
  if (importOnlyServer) {
    return `${reason}\n当前服务器只提供启动器，不提供游戏文件。已安装的游戏仍可直接启动；没有安装时，请导入本地游戏包。`;
  }
  return `${reason}\n你可以继续等待；如果当前下载太慢，也可以点击「打开链接」取得游戏包后导入。手动导入的本地版本不会被服务器自动替换，只有你主动选择更新时才会更新。`;
}
function unlockGameDataImport(reason) {
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
    label: "取消下载",
    onCancel() {
      void (async () => {
        if (player.classList.contains("open")) await closePlayerView();
        else resetRuntime();
        beginManualGamePackageImport();
        setStatus("下载已取消，可以导入本地游戏包");
      })();
    },
  });
  gameDataAttempt = { id, firstByte: false, downloadComplete: false, unlocked: false, dialogDismissed: false, startTimer: null, completeTimer: null, blockingOperation };
  gameDataAttempt.startTimer = setTimeout(() => {
    if (gameDataAttempt?.id === id && !gameDataAttempt.firstByte) {
      unlockGameDataImport("10 秒内没有收到游戏数据的第一个有效字节。服务器资源下载似乎没有正常开始。");
    }
  }, gameDataStartFallbackMs);
  gameDataAttempt.completeTimer = setTimeout(() => {
    if (gameDataAttempt?.id === id && !gameDataAttempt.downloadComplete && !state.ready) {
      unlockGameDataImport(gameDataAttempt.firstByte
        ? "游戏数据仍在加载，当前速度可能较慢。"
        : "20 秒内仍没有收到游戏数据，服务器资源下载似乎没有正常开始。");
    }
  }, gameDataCompleteFallbackMs);
}
function noteGameDataTransfer(message) {
  const attempt = gameDataAttempt;
  if (!attempt || attempt.id !== gameDataAttemptSerial || state.ready) return;
  const kind = message.kind || (message.mode === "ogg" ? "music" : "game");
  if (kind !== "game") return;
  const loaded = Number(message.loaded) || 0;
  const total = Number(message.total) || 0;
  if (loaded > 0 && !attempt.firstByte) {
    attempt.firstByte = true;
    clearTimeout(attempt.startTimer);
    attempt.startTimer = null;
  }
  if (total > 0 && loaded >= total && !attempt.downloadComplete) {
    attempt.downloadComplete = true;
    clearTimeout(attempt.completeTimer);
    attempt.completeTimer = null;
  }
}
function finishGameDataAttempt() {
  closeGameDataFallbackWindows();
  clearGameDataAttempt();
}
function showTransfer(message) {
  noteGameDataTransfer(message);
  const panel = $("#transfer");
  clearTimeout(transferHideTimer); panel.hidden = false;
  panel.dataset.networkOwned = "0";
  panel.querySelector(".transfer-bar")?.classList.toggle("indeterminate", !!message.indeterminate || (!!message.phase && !Number(message.total)));
  transferKind = message.kind || (message.mode === "ogg" ? "music" : "game");
  const loaded = Number(message.loaded) || 0;
  const total = Number(message.total) || 0;
  const instant = Number(message.speed) || 0;
  if (transferMode !== message.mode) { transferMode = message.mode; transferSpeed = 0; }
  transferSpeed = transferSpeed ? transferSpeed * .72 + instant * .28 : instant;
  const profile = message.mode === "ogg"
    ? { title: "正在下载音乐…", label: "OGG 音乐" }
    : message.mode === "language"
      ? { title: "正在下载语言包…", label: "语言包" }
      : { title: "正在加载…", label: "游戏资源" };
  $("#transferTitle").textContent = message.title || profile.title;
  $("#transferLabel").textContent = message.label || profile.label;
  $("#transferAmount").textContent = message.phase === "requesting" && !total
    ? "等待服务器响应…"
    : message.phase === "preparing" && !total
      ? (message.statusText || "正在准备…")
    : total
    ? `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB`
    : loaded ? `${(loaded / 1048576).toFixed(1)} MiB` : "正在请求…";
  $("#transferBar").style.width = total ? `${Math.min(100, loaded / total * 100).toFixed(1)}%` : message.phase ? "34%" : "0%";
  $("#transferSpeed").textContent = message.phase === "requesting" ? "等待响应"
    : message.phase === "preparing" ? "正在准备"
    : transferSpeed >= 1048576
    ? `${(transferSpeed / 1048576).toFixed(1)} MiB/s`
    : `${Math.round(transferSpeed / 1024)} KiB/s`;
  $("#transferEta").textContent = total && transferSpeed > 1024 ? clock((total - loaded) / transferSpeed) : "--:--";
  syncTransferCancelButton();
}
function languageTransferFailure(label, error) {
  const panel = $("#transfer"); panel.hidden = false;
  transferKind = "language";
  $("#transferTitle").textContent = "语言包下载失败";
  $("#transferLabel").textContent = label || "语言包";
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = `语言包下载失败\n${error?.message || error}`;
  $("#transferRetry").hidden = true;
}
function transferFailure(message) {
  if (state.launched) return;
  const panel = $("#transfer"); panel.hidden = false;
  transferKind = "music";
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = `OGG 下载失败（${message.failed || 1} 个）\n当前音频：MIDI\n当前正在播放 MIDI，并非 OGG 音质`;
  $("#transferRetry").hidden = false;
}
function transferComplete(message) {
  showTransfer({ ...message, mode: "ogg", speed: 0 });
  $("#transferTitle").textContent = "音乐下载完成";
  $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
  transferHideTimer = setTimeout(hideTransfer, 2200);
}
function showMidiFallback() {
  const notice = $("#musicNotice");
  clearTimeout(musicNoticeTimer);
  notice.classList.remove("show");
  requestAnimationFrame(() => {
    notice.classList.add("show");
    musicNoticeTimer = setTimeout(() => notice.classList.remove("show"), 2000);
  });
}

function createLocalMusicInstall(resources) {
  const runtimeWindow = currentRuntimeWindow();
  let runtimeDocument = null;
  try { runtimeDocument = runtimeWindow?.document || null; } catch {}
  const fs = runtimeWindow?.FS || runtimeWindow?.Module?.FS;
  if (!runtimeDocument || !runtimeWindow || !fs?.writeFile || !fs?.mkdirTree) {
    throw new Error("离线运行组件的文件系统不可访问");
  }
  const pack = musicPackage();
  const mount = typeof pack?.mount === "string" ? pack.mount.replace(/\/$/, "") : "";
  const allowedPaths = new Set(Array.isArray(pack?.files)
    ? pack.files.filter(name => typeof name === "string" && name && !name.includes("/") && !name.includes("\\"))
      .map(name => `${mount}/${name}`)
    : []);
  const total = resources.reduce((sum, resource) => sum + (Number(resource.size) || 0), 0);
  const startedAt = performance.now();
  let loaded = 0;
  let completed = 0;
  let cancelled = false;
  const emitProgress = () => {
    const seconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
    showTransfer({
      kind: "music", mode: "ogg", title: "正在准备音乐…", label: "本地 OGG",
      loaded, total, speed: loaded / seconds, completed, files: resources.length
    });
  };
  const checkRuntime = () => {
    let currentDocument = null;
    const currentWindow = currentRuntimeWindow();
    try { currentDocument = currentWindow?.document || null; } catch {}
    if (cancelled || currentWindow !== runtimeWindow || currentDocument !== runtimeDocument) throw new Error("离线运行组件已被替换");
  };
  const installOne = async resource => {
    checkRuntime();
    if ((typeof resource.localKey !== "string" && typeof resource.packageFileId !== "string") || typeof resource.path !== "string" ||
        !allowedPaths.has(resource.path)) throw new Error("本地 OGG 资源描述无效");
    const packaged = typeof resource.packageFileId === "string"
      ? await readManagedRuntimeResource(activeInstalledPackageGeneration, resource.packageFileId)
      : null;
    const blob = packaged ? new Blob([packaged.buffer], { type: "audio/ogg" }) : await readLocalImportedAsset(resource.localKey);
    checkRuntime();
    if (!blob || (resource.size && blob.size !== resource.size)) throw new Error(`${resource.path} 已丢失或损坏`);
    const buffer = await blob.arrayBuffer();
    checkRuntime();
    const slash = resource.path.lastIndexOf("/");
    if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
    fs.writeFile(resource.path, new runtimeWindow.Uint8Array(buffer), { canOwn: true });
    loaded += blob.size;
    completed++;
    emitProgress();
  };
  const run = async list => {
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < list.length) await installOne(list[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(2, list.length) }, worker));
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
      if (!remaining.length) {
        $("#transferTitle").textContent = "音乐已就绪";
        transferHideTimer = setTimeout(hideTransfer, 2200);
        return;
      }
      run(remaining).then(() => {
        if (cancelled) return;
        emitProgress();
        $("#transferTitle").textContent = "音乐已就绪";
        $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
        transferHideTimer = setTimeout(hideTransfer, 2200);
      }).catch(error => {
        if (cancelled) return;
        showToast(`部分本地 OGG 准备失败：${error.message}`);
      });
    }
  };
}

function emitGuideShotPair() {
  const help = $("#touchHelp");
  const panel = $(".focus-demo");
  const body = panel.querySelector(".guide-demo-body");
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
  clearInterval(guideShotTimer);
  emitGuideShotPair();
  guideShotTimer = setInterval(emitGuideShotPair, 140);
}

function stopGuideShots() {
  clearInterval(guideShotTimer);
  guideShotTimer = null;
}

const guideDurations = { focus: 7000, menu: 12000, dialogue: 4000 };

function syncTouchGuideFocusMode() {
  const panel = document.querySelector('[data-guide-panel="focus"]');
  const summary = $("#guideFocusSummary");
  const label = $("#guideFocusLabel");
  const controlHint = $("#guideFocusControlHint");
  if (!panel || !summary || !label || !controlHint) return;
  const mode = state.options.touchFocusMode;
  panel.dataset.focusMode = mode;
  if (mode === "two-finger") {
    summary.textContent = "移动时，用第二指按住进入低速";
    label.textContent = "＋ 第二指按住";
    controlHint.textContent = "";
    return;
  }
  if (mode === "toggle-button") {
    summary.textContent = "移动时，点按「低速」按钮切换状态";
    label.textContent = "点按「低速」切换";
    controlHint.textContent = "切换";
    return;
  }
  summary.textContent = "移动时，按住「低速」按钮";
  label.textContent = "按住「低速」";
  controlHint.textContent = "按住";
}

function collapseTouchGuides() {
  clearTimeout(guidePlaybackTimer);
  guidePlaybackTimer = null;
  stopGuideShots();
  $(".shot-stream").replaceChildren();
  document.querySelectorAll("[data-guide-tab]").forEach(tab => tab.setAttribute("aria-expanded", "false"));
  document.querySelectorAll("[data-guide-panel]").forEach(panel => {
    panel.querySelector(".guide-demo-body").hidden = true;
    panel.classList.remove("is-playing", "is-finished");
  });
}

function playTouchGuide(name) {
  collapseTouchGuides();
  const tab = document.querySelector(`[data-guide-tab="${name}"]`);
  const panel = document.querySelector(`[data-guide-panel="${name}"]`);
  if (!tab || !panel) return;
  tab.setAttribute("aria-expanded", "true");
  panel.querySelector(".guide-demo-body").hidden = false;
  // Static help sections expand without starting an animated tutorial replay timer.
  if (!(name in guideDurations)) return;
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
  }, guideDurations[name]);
}

function game() { return manifest.games[state.game]; }
function runtimeUrl() {
  const entry = game();
  if (state.runtimeVariant === "multiplayer") {
    if (typeof entry.multiplayerRuntime !== "string" || !entry.multiplayerRuntime) {
      throw new Error(`当前 ${state.game.toUpperCase()} 游戏资源不包含联机 Runtime`);
    }
    return entry.multiplayerRuntime;
  }
  return entry.runtime;
}
function musicPackage() {
  const transport = musicTransportMode(state.music);
  return transport === "none" ? { files: [] } : game().music[transport];
}
function gameDataDescriptor(gameId = state.game) { return manifest.games[gameId].gameData; }
function validLegacyImportedAsset(value) {
  return !!value && typeof value.key === "string" && value.key.startsWith("/.eagler-local/offline/") &&
    Number.isInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/i.test(value.sha256 || "");
}
function normalizeLegacyImportedAssets(value) {
  const legacy = value?.legacyAssets || value?.offline;
  if (!legacy) return null;
  const runtimeVersion = String(legacy.runtimeVersion || "");
  if (!/^[a-f0-9]{16}$/i.test(runtimeVersion)) return null;
  if (!Array.isArray(legacy.shared) || !legacy.shared.every(item =>
      typeof item?.target === "string" && validLegacyImportedAsset(item))) return null;
  if (!Array.isArray(legacy.languages) || !legacy.languages.every(item =>
      /^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(item?.id || "") && typeof item.title === "string" &&
      validLegacyImportedAsset(item))) return null;
  return { runtimeVersion, shared: legacy.shared, languages: legacy.languages };
}
function legacyImportedAssetKeys(meta) {
  const legacy = normalizeLegacyImportedAssets(meta);
  return legacy ? [...legacy.shared.map(item => item.key), ...legacy.languages.map(item => item.key)] : [];
}
function readImportedGameDataMeta(gameId = state.game) {
  try {
    const value = JSON.parse(localStorage.getItem(importedGameDataMetadataKey(gameId)) || "null");
    if (!value || value.source !== "local-import" || value.game !== gameId || typeof value.version !== "string" ||
        !/^sha256-[a-f0-9]{64}$/i.test(value.version) || !/^[a-f0-9]{64}$/i.test(value.sha256 || "") ||
        !Number.isInteger(value.bytes) || value.bytes <= 0) return null;
    const legacyAssets = normalizeLegacyImportedAssets(value);
    if ((value.legacyAssets || value.offline) && !legacyAssets) return null;
    if (legacyAssets) value.legacyAssets = legacyAssets;
    delete value.offline;
    if (!/^sha256-[a-f0-9]{64}$/i.test(value.layout || "")) {
      const current = gameDataDescriptor(gameId);
      if (value.version !== current.version || value.sha256.toLowerCase() !== current.sha256.toLowerCase() || value.bytes !== current.bytes) return null;
      value.layout = current.layout;
      try { localStorage.setItem(importedGameDataMetadataKey(gameId), JSON.stringify(value)); } catch {}
    }
    return value;
  } catch {
    return null;
  }
}
async function discardImportedGameData(meta) {
  if (!meta || meta.source !== "local-import" || !["th06", "th07"].includes(meta.game)) return;
  try { await deleteLocalImportedAsset(localGameDataCacheUrl(location.origin, meta.game, meta.version)); } catch {}
  for (const key of legacyImportedAssetKeys(meta)) {
    try { await deleteLocalImportedAsset(key); } catch {}
  }
  try {
    const cache = await globalThis.caches?.open(GAME_DATA_CACHE_NAME);
    if (cache) await cache.delete(localGameDataCacheUrl(location.origin, meta.game, meta.version));
  } catch {}
  try {
    const key = importedGameDataMetadataKey(meta.game);
    const current = JSON.parse(localStorage.getItem(key) || "null");
    if (current?.source === "local-import" && current.version === meta.version) localStorage.removeItem(key);
  } catch {}
}
async function discardImportedOgg(meta) {
  if (!meta || meta.source !== "local-import" || !["th06", "th07"].includes(meta.game) || !Array.isArray(meta.files)) return;
  for (const filename of meta.files) {
    try { await deleteLocalImportedAsset(localOggCacheUrl(location.origin, meta.game, meta.version, filename)); } catch {}
  }
  try {
    const cache = await globalThis.caches?.open(GAME_DATA_CACHE_NAME);
    if (cache) {
      for (const filename of meta.files) {
        try { await cache.delete(localOggCacheUrl(location.origin, meta.game, meta.version, filename)); } catch {}
      }
    }
  } catch {}
  try {
    const key = importedOggMetadataKey(meta.game);
    const current = JSON.parse(localStorage.getItem(key) || "null");
    if (current?.source === "local-import" && current.version === meta.version) localStorage.removeItem(key);
  } catch {}
}

const emPreloadCacheName = "EM_PRELOAD_CACHE";
const emPreloadMetadataStore = "METADATA";
const emPreloadPackageStore = "PACKAGES";
const localAssetDbName = "eagler-touhou-local-assets-v1";
const localAssetStore = "ASSETS";
let importedContentObjectUrls = [];
let activeLegacyImportedAssetsMeta = null;
function localOfflineAssetKey(gameId, runtimeVersion, kind, name) {
  if (!/^(?:th06|th07)$/.test(gameId) || !/^[a-f0-9]{16}$/i.test(runtimeVersion) ||
      !/^(?:shared|languages)$/.test(kind) || typeof name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("invalid local offline asset key");
  }
  return `/.eagler-local/offline/${gameId}/${runtimeVersion}/${kind}/${name}`;
}
function localAssetIdbKey(key) {
  try {
    const url = new URL(String(key), location.href);
    if (url.pathname.startsWith("/.eagler-local/")) return url.pathname;
  } catch {}
  return String(key);
}
function runtimePreloadPackageName(sourceUrl, gameId = state.game) {
  const url = sourceUrl instanceof URL ? sourceUrl : new URL(sourceUrl, location.href);
  const slash = url.pathname.lastIndexOf("/");
  const directory = slash >= 0 ? url.pathname.slice(0, slash + 1) : "/";
  return `${encodeURIComponent(directory)}${gameId}.data`;
}
function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}
async function openLocalAssetDb() {
  if (!globalThis.indexedDB?.open) throw new Error("当前浏览器没有 IndexedDB，无法持久化导入游戏数据");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(localAssetDbName, 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(localAssetStore)) db.createObjectStore(localAssetStore);
    };
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地游戏数据存储"));
  });
}
async function writeLocalImportedAssets(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const db = await openLocalAssetDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([localAssetStore], "readwrite");
      const store = transaction.objectStore(localAssetStore);
      for (const entry of entries) {
        const blob = entry.blob instanceof Blob ? entry.blob : new Blob([entry.blob], { type: entry.type || "application/octet-stream" });
        store.put({ blob, type: entry.type || blob.type || "application/octet-stream", bytes: blob.size }, localAssetIdbKey(entry.key));
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法写入本地游戏数据存储"));
      transaction.onabort = () => reject(transaction.error || new Error("本地游戏数据存储写入被中止"));
    });
  } finally {
    db.close();
  }
}
async function readLocalImportedAsset(key) {
  if (globalThis.indexedDB?.open) {
    try {
      const db = await openLocalAssetDb();
      try {
        const transaction = db.transaction([localAssetStore], "readonly");
        const value = await idbRequest(transaction.objectStore(localAssetStore).get(localAssetIdbKey(key)));
        if (value?.blob instanceof Blob) return value.blob;
        if (value instanceof Blob) return value;
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new Blob([value]);
      } finally {
        db.close();
      }
    } catch {}
  }
  try {
    const response = await globalThis.caches?.match?.(key);
    if (!response) return null;
    const blob = await response.blob();
    try { await writeLocalImportedAssets([{ key, blob, type: blob.type || response.headers.get("Content-Type") || "application/octet-stream" }]); } catch {}
    return blob;
  } catch {
    return null;
  }
}
async function deleteLocalImportedAsset(key) {
  if (!globalThis.indexedDB?.open) return;
  const db = await openLocalAssetDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([localAssetStore], "readwrite");
      transaction.objectStore(localAssetStore).delete(localAssetIdbKey(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法删除本地导入资源"));
      transaction.onabort = () => reject(transaction.error || new Error("删除本地导入资源被中止"));
    });
  } finally {
    db.close();
  }
}
async function mirrorImportedAssetsToCache(entries) {
  if (!globalThis.caches?.open) return;
  try {
    const cache = await caches.open(GAME_DATA_CACHE_NAME);
    for (const entry of entries) {
      await cache.put(entry.key, new Response(entry.blob, {
        status: 200,
        headers: {
          "Content-Type": entry.type || entry.blob.type || "application/octet-stream",
          "Content-Length": String(entry.blob.size),
          "X-Eagler-Asset-Source": "local-import",
          "X-Eagler-Asset-Version": entry.version || ""
        }
      }));
    }
  } catch {}
}
function revokeImportedContentObjectUrls() {
  for (const url of importedContentObjectUrls) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  importedContentObjectUrls = [];
  activeLegacyImportedAssetsMeta = null;
}
function importedContentObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  importedContentObjectUrls.push(url);
  return url;
}
async function openEmscriptenPreloadCache() {
  if (!globalThis.indexedDB?.open) throw new Error("当前浏览器没有 IndexedDB");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(emPreloadCacheName, 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(emPreloadPackageStore)) db.createObjectStore(emPreloadPackageStore);
      if (!db.objectStoreNames.contains(emPreloadMetadataStore)) db.createObjectStore(emPreloadMetadataStore);
    };
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error || new Error("无法打开 Emscripten preload cache"));
  });
}
async function readEmscriptenPreloadMetadata(db, packageName) {
  const transaction = db.transaction([emPreloadMetadataStore], "readonly");
  return idbRequest(transaction.objectStore(emPreloadMetadataStore).get(`metadata/${packageName}`));
}
async function primeImportedGameDataForRuntime(sourceUrl, meta, runtimeDataVersion = null, runtimeLayout = null) {
  const expected = gameDataDescriptor(meta.game);
  const expectedLayout = runtimeLayout || expected.layout;
  const expectedVersion = runtimeDataVersion || expected.version;
  if (meta.layout !== expectedLayout) throw new Error("本地游戏数据的文件布局与当前运行时不兼容");
  const packageName = runtimePreloadPackageName(sourceUrl, meta.game);
  const db = await openEmscriptenPreloadCache();
  try {
    const existing = await readEmscriptenPreloadMetadata(db, packageName);
    if (existing?.uuid === expectedVersion && existing?.eaglerLocalImport === meta.version &&
        existing?.eaglerLayout === meta.layout && existing?.chunkCount === 1) return;
    const local = await readLocalImportedAsset(localGameDataCacheUrl(location.origin, meta.game, meta.version));
    if (!local) throw new Error("浏览器已清理本地导入的游戏数据");
    const bytes = await local.arrayBuffer();
    if (bytes.byteLength !== meta.bytes) throw new Error("本地导入的游戏数据大小已损坏");
    const oldChunkCount = Math.max(0, Number(existing?.chunkCount) || 0);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([emPreloadPackageStore, emPreloadMetadataStore], "readwrite");
      const packages = transaction.objectStore(emPreloadPackageStore);
      const metadata = transaction.objectStore(emPreloadMetadataStore);
      packages.put(bytes, `package/${packageName}/0`);
      for (let index = 1; index < oldChunkCount; index++) packages.delete(`package/${packageName}/${index}`);
      metadata.put({
        uuid: expectedVersion,
        chunkCount: 1,
        eaglerLocalImport: meta.version,
        eaglerLayout: meta.layout
      }, `metadata/${packageName}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法写入本地游戏数据 preload cache"));
      transaction.onabort = () => reject(transaction.error || new Error("本地游戏数据 preload cache 写入被中止"));
    });
  } finally {
    db.close();
  }
}
async function releaseImportedGameDataRuntimeOwner(sourceUrl, gameId = state.game) {
  if (!globalThis.indexedDB?.open) return;
  const packageName = runtimePreloadPackageName(sourceUrl, gameId);
  const db = await openEmscriptenPreloadCache();
  try {
    const existing = await readEmscriptenPreloadMetadata(db, packageName);
    if (!existing?.eaglerLocalImport) return;
    const chunkCount = Math.max(0, Number(existing.chunkCount) || 0);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([emPreloadPackageStore, emPreloadMetadataStore], "readwrite");
      const packages = transaction.objectStore(emPreloadPackageStore);
      const metadata = transaction.objectStore(emPreloadMetadataStore);
      for (let index = 0; index < chunkCount; index++) packages.delete(`package/${packageName}/${index}`);
      metadata.delete(`metadata/${packageName}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法释放本地 preload cache owner"));
      transaction.onabort = () => reject(transaction.error || new Error("释放本地 preload cache owner 被中止"));
    });
  } finally {
    db.close();
  }
}
async function installImportedGameData(file) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > maxImportBytes) throw new Error("游戏数据包大小无效");
  if (!globalThis.indexedDB?.open) throw new Error("当前浏览器不支持持久化游戏数据导入：IndexedDB 不可用");
  try {
    const packageZip = await parsePackageZip(file);
    if (packageZip.descriptor.game !== state.game) {
      throw new Error(`这个游戏包属于 ${packageZip.descriptor.game.toUpperCase()}，不是 ${state.game.toUpperCase()}`);
    }
    setPlayerStatus("正在导入游戏包…");
    const installed = await installParsedPackageZip(packageZip, {
      onProgress(progress) {
        setPlayerStatus(`正在导入游戏包… ${progress.completed}/${progress.total}`);
      }
    });
    if (installed?.generation) installedPackageSnapshots.set(state.game, installed.generation);
    // Persistence permission is an eviction-policy hint, not part of the
    // Package transaction. Firefox may leave the request pending awaiting a
    // browser decision, so it must never hold import or launch completion.
    try { void navigator.storage?.persist?.().catch?.(() => {}); } catch {}
    return {
      source: "package-store",
      game: state.game,
      packageInstall: true,
      packageRevision: packageZip.descriptor.revision,
      generationId: installed.installation.currentGeneration,
      files: Object.keys(installed.generation?.files || {}).length,
      offlineComplete: true,
    };
  } catch (error) {
    if (!/Package ZIP is missing package\.json/.test(String(error?.message || error))) throw error;
  }
  const expected = gameDataDescriptor();
  const pack = await parseStoredGameDataPack(file);
  if (pack.manifest.game !== state.game) throw new Error(`该数据包属于 ${pack.manifest.game.toUpperCase()}，不是 ${state.game.toUpperCase()}`);
  if (pack.manifest.data.path !== expected.path) throw new Error("游戏数据包与当前作品不匹配");
  if (importOnlyServer) {
    if (!pack.offline) throw new Error("当前服务器不提供游戏内容，请导入完整游戏包。");
    for (const target of ["/msgothic.ttc", "/unifont.otf"]) {
      if (!pack.offline.shared.some(item => item.target === target)) throw new Error(`导入的旧游戏包缺少 ${target.slice(1)}`);
    }
  }
  setPlayerStatus("正在校验本地游戏数据…");
  const actualHash = await sha256Hex(new Uint8Array(await pack.data.blob.arrayBuffer()));
  if (actualHash.toLowerCase() !== pack.manifest.data.sha256.toLowerCase()) throw new Error("游戏数据包 SHA-256 校验失败");

  let importedOggManifest = null;
  if (pack.manifest.music) {
    importedOggManifest = pack.manifest.music;
    for (let i = 0; i < pack.music.length; i++) {
      setPlayerStatus(`正在校验本地 OGG… ${i + 1}/${pack.music.length}`);
      const item = pack.music[i];
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(`${item.name}: SHA-256 校验失败`);
    }
  }

  let legacyAssets = null;
  const legacyStoredAssets = [];
  if (pack.offline) {
    // Legacy complete packs are content sources only. Their bundled
    // HTML/JS/WASM Runtime is deliberately ignored; current App-managed
    // Runtime remains the only executable path.
    const runtimeVersion = pack.offline.runtime.version;
    const shared = [];
    for (const item of pack.offline.shared) {
      setPlayerStatus(`正在校验旧包资源：${item.target.slice(1)}…`);
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(`${item.path}: SHA-256 校验失败`);
      const name = item.target.slice(1);
      const key = localOfflineAssetKey(state.game, runtimeVersion, "shared", name);
      legacyStoredAssets.push({ key, blob: item.blob, type: item.blob.type || "application/octet-stream", version: runtimeVersion });
      shared.push({ target: item.target, key, bytes: item.bytes, sha256: item.sha256 });
    }
    const languages = [];
    for (const item of pack.offline.languages) {
      setPlayerStatus(`正在校验旧包语言：${item.title}…`);
      const hash = await sha256Hex(new Uint8Array(await item.blob.arrayBuffer()));
      if (hash.toLowerCase() !== item.sha256) throw new Error(`${item.path}: SHA-256 校验失败`);
      const key = localOfflineAssetKey(state.game, runtimeVersion, "languages", `${item.id}.${item.sha256.slice(0, 16)}.zip`);
      legacyStoredAssets.push({ key, blob: item.blob, type: "application/zip", version: runtimeVersion });
      languages.push({ id: item.id, title: item.title, key, bytes: item.bytes, sha256: item.sha256,
        files: Number.isInteger(item.files) ? item.files : undefined });
    }
    legacyAssets = { runtimeVersion, shared, languages };
  }

  const target = localGameDataCacheUrl(location.origin, state.game, pack.manifest.version);
  const cacheMirrorAssets = [{ key: target, blob: new Blob([pack.data.blob], { type: "application/octet-stream" }), type: "application/octet-stream", version: pack.manifest.version }];
  if (importedOggManifest) {
    for (const item of pack.music) {
      cacheMirrorAssets.push({
        key: localOggCacheUrl(location.origin, state.game, importedOggManifest.version, item.name),
        blob: new Blob([item.blob], { type: "audio/ogg" }),
        type: "audio/ogg",
        version: importedOggManifest.version
      });
    }
  }
  await writeLocalImportedAssets([...cacheMirrorAssets, ...legacyStoredAssets]);
  await mirrorImportedAssetsToCache(cacheMirrorAssets);
  const previous = readImportedGameDataMeta(state.game);
  const previousOgg = readImportedOggMeta(state.game);
  const meta = {
    source: "local-import",
    game: state.game,
    version: pack.manifest.version,
    layout: pack.manifest.data.layout,
    sha256: pack.manifest.data.sha256.toLowerCase(),
    bytes: pack.manifest.data.bytes,
    ...(legacyAssets ? { legacyAssets } : {}),
    importedAt: Date.now()
  };
  try { localStorage.setItem(importedGameDataMetadataKey(state.game), JSON.stringify(meta)); } catch {}
  if (previous && previous.version !== meta.version) await discardImportedGameData(previous);
  if (importedOggManifest) {
    const oggMeta = { source: "local-import", game: state.game, version: importedOggManifest.version,
      files: importedOggManifest.files.map(item => item.path), importedAt: Date.now() };
    try { localStorage.setItem(importedOggMetadataKey(state.game), JSON.stringify(oggMeta)); } catch {}
    if (previousOgg && previousOgg.version !== oggMeta.version) await discardImportedOgg(previousOgg);
  }
  try { void navigator.storage?.persist?.().catch?.(() => {}); } catch {}
  return { ...meta, oggFiles: pack.music.length, offlineComplete: !!legacyAssets };
}
function selectedLanguagePack() {
  const entry = languageEntry();
  if (entry.packageObjectId) {
    return {
      language: entry.id,
      packageObjectId: entry.packageObjectId,
      packageFile: entry.packageFile,
      bytes: entry.packageBytes || 0,
      packageLocal: true,
    };
  }
  const local = activeLegacyImportedAssetsMeta?.languages?.find(item => item.id === entry.id) || null;
  if (local) {
    return { ...local, language: entry.id, localKey: local.key, url: null };
  }
  if (!entry.pack) {
    if (entry.offlinePack) throw new Error("当前语言只存在于导入的旧游戏包，但当前没有使用该本地游戏内容");
    return null;
  }
  const pack = entry.pack;
  if (typeof pack.url !== "string" || typeof pack.sha256 !== "string" || !Number.isInteger(pack.bytes)) throw new Error("语言包清单无效");
  return {
    ...pack,
    language: entry.id,
    url: new URL(pack.url, location.href).href
  };
}
async function launchConfiguredRuntime() {
  clearStartupError();
  await ensureRuntime(true);
  chooseDefaultMusic();
  await ensureManagedOggStartupBarrier();
  prepareMidi();
  const runtimePack = await prepareLanguagePack();
  const musicResources = await selectedMusicResources();
  const localMusicResources = isOggMusicMode(state.music) && musicResources.length > 0 &&
    musicResources.every(resource => typeof resource.localKey === "string" || typeof resource.packageFileId === "string") ? musicResources : null;
  const shared = await selectedSharedResources();
  const packageResources = await installedPackageRuntimeResources();
  setPlayerStatus(runtimePack ? `准备 ${entryTitle(languageEntry())} 语言包…` : `准备 ${musicModeLabel(state.music)} 音乐资源…`);
  const netplayOptions = state.runtimeVariant === "multiplayer" && !state.replayViewer ? validatedNetplayOptions() : {};
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
      limitPresentationTo60: state.options.frameLimit60Enabled, debugHarness, thpracLocale: thpracLocaleForLanguage(state.language),
      oggDecodeMode: oggDecodeMode(state.music),
      unlimitedTouch: state.options.touchMovementMode === "touch-unlimited",
      touchBombZoneEnabled: false,
      th06FocusHitbox: state.game === "th06" && state.options.th06FocusHitbox,
      replayViewer: !!state.replayViewer,
      ...netplayOptions }
  }, 30 * 60 * 1000);
  if (packageResources.length) {
    await installManagedPackageResources(packageResources);
  }
  let localMusicInstall = null;
  if (localMusicResources) {
    try {
      localMusicInstall = createLocalMusicInstall(localMusicResources);
      await localMusicInstall.installInitial();
      const runtimeWindow = currentRuntimeWindow();
      if (!runtimeWindow?.Module) throw new Error("游戏运行时不可访问");
      runtimeWindow.Module.touhouMusicMode = "ogg";
    } catch (error) {
      localMusicInstall?.cancel();
      localMusicInstall = null;
      const runtimeWindow = currentRuntimeWindow();
      if (runtimeWindow?.Module) runtimeWindow.Module.touhouMusicMode = "midi";
      hideTransfer();
      showToast(`本地 OGG 准备失败，本次改用 MIDI：${error.message}`);
    }
  }
  armFirstFrameWatchdog();
  // The Runtime is once again the direct child browsing context. Keep the
  // bounded Android focus relay that fixed the historical first-frame stall,
  // but there is no longer a Player -> Runtime focus hop.
  startPlayerFocusRelay();
  try {
    await send("launch");
  } catch (error) {
    clearFirstFrameWatchdog();
    throw error;
  }
  state.launched = true; clearStartupError();
  const backgroundUpdate = deferredBackgroundPackageUpdate;
  deferredBackgroundPackageUpdate = null;
  if (backgroundUpdate) startBackgroundPackageUpdate(backgroundUpdate);
  updateRuntimeDiagnostics();
  // resetRuntime() can run while #player is still hidden, when clientWidth is 0.
  // Re-apply the persisted orientation-specific viewport offset only after the
  // live player has been opened and the runtime has actually launched.
  applyGameZoomTransform(1, 0, 0);
  updateGameZoomUi(); updatePlayerOrientationUi();
  pushTouchControlsLive();
  setPlayerStatus("运行中"); refocusGameIfNeeded();
  if (localMusicInstall) localMusicInstall.installRemaining();
  startManagedOggProgressiveInstall();
}
function entryTitle(entry) { return typeof entry?.title === "string" && entry.title ? entry.title : entry?.id || "语言"; }
function chooseDefaultMusic() {
  const installedGeneration = activeInstalledPackageGeneration || installedPackageSnapshots.get(state.game) || null;
  if (installedGeneration) {
    const ids = componentFileIds(installedGeneration.descriptor, "ogg");
    const localOggCount = ids.filter(fileId => !!installedGeneration.files?.[fileId]?.objectId).length;
    const localOggReady = ids.length > 0 && localOggCount === ids.length;
    const remoteOggReady = !importOnlyServer && localOggCount === 0 && !!releaseCatalog?.games?.[state.game];
    if (state.music === "none") return;
    if (state.music === "midi") {
      if (localOggReady && !state.musicPreferenceExplicit) {
        state.music = "ogg-stream";
        saveGamePreferences();
      }
      return;
    }
    if (isOggMusicMode(state.music) && (localOggReady || remoteOggReady)) return;
    // Missing resources may require a temporary MIDI fallback, but that is not
    // a user preference. Do not persist it and poison a later complete import.
    state.music = "midi";
    return;
  }
  const packages = game().music;
  if (state.music === "none") return;
  if (importOnlyServer) {
    const imported = readImportedOggMeta(state.game);
    const ogg = packages.ogg;
    const localOggReady = !!ogg && !!imported && Array.isArray(ogg.files) &&
      ogg.files.every(name => imported.files.includes(name));
    const wanted = state.musicPreferenceExplicit ? state.music : "ogg-stream";
    const next = isOggMusicMode(wanted) && localOggReady ? wanted : "midi";
    if (state.music !== next) state.music = next;
    return;
  }
  if (isOggMusicMode(state.music) && packages.ogg) return;
  if (state.music === "midi" && packages.midi) return;
  state.music = packages.ogg ? "ogg-stream" : "midi";
  saveGamePreferences();
}

const customSelects = new Map();
function customSelectHost() {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  return fullscreenElement === player ? player : document.body;
}
function closeCustomSelect(select, { restoreFocus = false } = {}) {
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
function closeOtherCustomSelects(except = null) {
  for (const select of customSelects.keys()) if (select !== except) closeCustomSelect(select);
}
function positionCustomSelectMenu(select) {
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
function syncCustomSelect(select) {
  const ui = customSelects.get(select);
  if (!ui) return;
  const selected = select.selectedOptions[0] || select.options[0];
  ui.value.textContent = selected?.textContent || "";
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
  ui.menu.querySelectorAll(".mizuki-select-item").forEach(item => {
    const selectedItem = item.dataset.value === select.value;
    item.classList.toggle("selected", selectedItem);
    item.setAttribute("aria-selected", String(selectedItem));
  });
  if (!ui.menu.hidden) positionCustomSelectMenu(select);
}
function openCustomSelect(select) {
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
function installCustomSelect(select) {
  if (!select || customSelects.has(select)) return;
  const root = document.createElement("div");
  root.className = "mizuki-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mizuki-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", select.getAttribute("aria-label") || "选择选项");
  const value = document.createElement("span");
  value.className = "mizuki-select-value";
  const arrow = document.createElement("i");
  arrow.className = "mizuki-select-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg>';
  trigger.append(value, arrow);
  select.before(root);
  root.append(trigger, select);
  select.classList.add("custom-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  if (select.id) {
    document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach(label => {
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
  menu.setAttribute("aria-label", select.getAttribute("aria-label") || "选择选项");
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
    const items = [...menu.querySelectorAll(".mizuki-select-item:not(:disabled)")];
    const selectedIndex = Math.max(0, items.findIndex(item => item.dataset.value === select.value));
    items[event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : Math.min(items.length - 1, selectedIndex + 1)]?.focus();
  });
  menu.addEventListener("click", event => {
    const item = event.target.closest(".mizuki-select-item");
    if (!item || item.disabled) return;
    const changed = select.value !== item.dataset.value;
    select.value = item.dataset.value;
    closeCustomSelect(select, { restoreFocus: true });
    syncCustomSelect(select);
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  menu.addEventListener("keydown", event => {
    const item = event.target.closest(".mizuki-select-item");
    if (!item) return;
    const items = [...menu.querySelectorAll(".mizuki-select-item:not(:disabled)")];
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
for (const select of document.querySelectorAll("select.option-select")) installCustomSelect(select);
document.addEventListener("pointerdown", event => {
  for (const [select, ui] of customSelects) {
    if (ui.root.contains(event.target) || ui.menu.contains(event.target)) continue;
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
  const copy = state.options.touchFocusMode === "hold-button" ? "按住低速" : "点按切换";
  const small = focusButton.querySelector("small");
  if (small.textContent !== copy) small.textContent = copy;
}
function renderTouchFireState(updateCopy = true) {
  const fireButton = $("#touchFire");
  fireButton.classList.toggle("is-on", touchControls.fireEnabled);
  const pressed = String(touchControls.fireEnabled);
  if (fireButton.getAttribute("aria-pressed") !== pressed) fireButton.setAttribute("aria-pressed", pressed);
  if (!updateCopy) return;
  const copy = "点按切换";
  const small = fireButton.querySelector("small");
  if (small.textContent !== copy) small.textContent = copy;
}
function renderTouchActionState() {
  renderTouchFocusState();
  renderTouchFireState();
}
function render() {
  chooseDefaultMusic();
  const multiplayerProduct = isMultiplayerProduct();
  document.body.classList.toggle("less-motion", state.lessMotion);
  const lessMotionToggle = $("#lessMotionToggle");
  lessMotionToggle.setAttribute("aria-pressed", String(state.lessMotion));
  lessMotionToggle.title = state.lessMotion ? "恢复完整页面动画" : "减少页面装饰动画";
  $("#main").classList.toggle("has-selection", state.hasSelection);
  const tools = $(".tools");
  tools.classList.toggle("mobile-open", state.mobileOpen);
  tools.classList.toggle("mp-mode", multiplayerProduct);
  tools.setAttribute("aria-hidden", String(!state.hasSelection));
  tools.inert = !state.hasSelection;
  document.querySelectorAll(".game").forEach(card => {
    const product = card.dataset.product || card.dataset.game;
    const selected = state.hasSelection && product === state.product;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  $("#gameId").textContent = multiplayerProduct ? `${state.game.toUpperCase()} MP` : state.game.toUpperCase();
  $("#gameId").dataset.game = state.game;
  $("#gameTitle").textContent = game().title;
  $("#mpTitleBadge").hidden = !multiplayerProduct;
  $("#mpShell").hidden = !multiplayerProduct;
  if (multiplayerProduct && state.hasSelection) {
    for (const [name, open] of Object.entries(mpUiState.folds)) {
      if (open) mpRefreshFoldHeight(name);
    }
  }
  const multiplayerRoomOpen = multiplayerProduct && !!mpUiState.room;
  $("#main").classList.toggle("mp-room-open", multiplayerRoomOpen);
  document.body.classList.toggle("mp-room-active", multiplayerRoomOpen);
  $("#mpRoomView").hidden = !multiplayerRoomOpen;
  const hasInstalledPackage = installedPackageSnapshots.has(state.game);
  const installedGeneration = installedPackageSnapshots.get(state.game) || null;
  const multiplayerAvailable = (
    !!installedGeneration?.descriptor?.runtimes?.multiplayer ||
    typeof game().multiplayerRuntime === "string"
  );
  if (multiplayerProduct && multiplayerAvailable) state.runtimeVariant = "multiplayer";
  $("#launchText").textContent = !hasInstalledPackage && importOnlyServer && !readImportedGameDataMeta(state.game)?.legacyAssets
    ? "导入游戏资源" : state.runtimeVariant === "multiplayer" ? "启动 LAN 联机" : "启动游戏";
  // Keep one explicit import entry in every publication mode. A hosted
  // release may still be paired with a user-provided content generation and
  // then offer the matching remote update through the normal launch flow.
  $("#gamePackageImport").hidden = false;
  const musicSelect = $("#musicSelect");
  musicSelect.value = state.music;
  for (const option of musicSelect.options) {
    option.disabled = !webAudioAvailable && option.value !== "none";
  }
  musicSelect.title = webAudioAvailable ? "" : "当前浏览器不支持 Web Audio，仅可使用无音乐模式";
  const languageEntries = languageCatalog(state.game);
  const languageSelect = $("#languageSelect");
  languageSelect.replaceChildren(...languageEntries.map(entry => {
    const option = document.createElement("option"); option.value = entry.id; option.textContent = entryTitle(entry); return option;
  }));
  languageSelect.value = state.language;
  const mpLanguageSelect = $("#mpLanguageSelect");
  mpLanguageSelect.replaceChildren(...languageEntries.map(entry => {
    const option = document.createElement("option"); option.value = entry.id; option.textContent = entryTitle(entry); return option;
  }));
  mpLanguageSelect.value = state.language;
  $("#mpShareSettingsToggle").setAttribute("aria-checked", String(mpShareSingleplayerSettings));
  $("#mpShareSettingsToggle").classList.toggle("on", mpShareSingleplayerSettings);
  $("#mpMusicSelect").value = state.music;
  $("#mpFrameLimitToggle").setAttribute("aria-checked", String(state.options.frameLimit60Enabled));
  $("#mpFrameLimitToggle").classList.toggle("on", state.options.frameLimit60Enabled);
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
  const selectedPack = selectedLanguage.offlinePack || selectedLanguage.pack;
  $("#languagePackSize").textContent = selectedPack ? formatBytes(Number(selectedPack.bytes) || 0) : "内置";
  const thpracAvailable = !!gameFeatures(state.game).thprac;
  if (!thpracAvailable || multiplayerProduct) state.options.thpracEnabled = false;
  $("#th06HitboxOption").hidden = state.game !== "th06";
  $("#mobileOptions").classList.toggle("open", state.mobileOpen);
  $("#mobileOptionsToggle").setAttribute("aria-expanded", String(state.mobileOpen));
  const switches = { thpracToggle: state.options.thpracEnabled, thpracTouchControlsToggle: state.options.thpracTouchControlsEnabled, magnifierToggle: state.options.magnifierEnabled, frameLimitToggle: state.options.frameLimit60Enabled, th06HitboxToggle: state.options.th06FocusHitbox, touchToggle: state.options.touchEnabled, doubleTapBombToggle: state.options.doubleTapBombEnabled, alwaysHitboxToggle: state.options.alwaysHitbox };
  for (const [id, enabled] of Object.entries(switches)) {
    $("#" + id).setAttribute("aria-checked", String(enabled));
    $("#" + id).classList.toggle("on", enabled);
  }
  const thpracToggle = $("#thpracToggle");
  thpracToggle.disabled = !thpracAvailable || multiplayerProduct || state.runtimeVariant === "multiplayer";
  thpracToggle.title = multiplayerProduct || state.runtimeVariant === "multiplayer" ? "联机版使用不含 thprac 的独立 Runtime" : "";
  const frameLimitToggle = $("#frameLimitToggle");
  frameLimitToggle.disabled = false;
  frameLimitToggle.title = "";
  const frameLimitHint = $("#frameLimitHint");
  $("#frameLimitHintText").textContent = "如果帧数在游玩时经常严重波动，那么必须启用该选项，否则会造成严重的输入延迟。";
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
  const twoFingerFocusOption = touchFocusMode.querySelector('option[value="two-finger"]');
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
  document.querySelectorAll("[data-touch-sensitivity-preset]").forEach(button => {
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
  touchDirectSurface.hidden = !(hostDirectTouch && !spectatorRuntime && state.options.touchEnabled && !wheelMovement && !touchLayoutEditing && !thpracMouseMode);
  renderTouchActionState();
  const thpracControlsVisible = !spectatorRuntime && thpracTouchControlsVisible();
  touchThpracInput.hidden = !thpracControlsVisible;
  touchThpracTab.hidden = !thpracControlsVisible;
  touchThpracMenu.hidden = !thpracControlsVisible;
  touchThpracInput.classList.toggle("is-on", thpracMouseMode);
  touchThpracInput.setAttribute("aria-pressed", String(thpracMouseMode));
  touchThpracInput.querySelector("strong").textContent = "模拟鼠标";
  touchThpracFunctionKeys.hidden = !thpracMenuOpen;
  document.querySelectorAll("[data-action]").forEach(button => {
    const gameLoaded = loaded[state.game];
    button.disabled = !gameLoaded;
    button.title = gameLoaded ? "" : "先在浏览器中打开一次游戏，才能使用此功能";
  });
  applyTouchLayout();
  if (touchLayoutEditing) updateTouchLayoutEditorUi();
  updateGameZoomUi();
  updatePlayerOrientationUi();
  syncAllCustomSelects();
}

function validatedNetplayOptions() {
  if (!new Set(["th06", "th07"]).has(state.game)) throw new Error("当前游戏不支持 LAN 联机 Runtime");
  let url;
  try { url = new URL(state.netplay.url); } catch { throw new Error("Relay WebSocket URL 无效"); }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Relay URL 必须使用 ws:// 或 wss://");
  const { player, playerCount, seed } = state.netplay;
  const spectator = state.netplay.spectator === true;
  if (![2, 3].includes(playerCount) || (!spectator &&
      (!Number.isInteger(player) || player < 0 || player >= playerCount))) throw new Error("LAN 玩家槽位无效");
  if (spectator && !/^[A-Za-z0-9_-]{8,64}$/.test(String(state.netplay.spectatorId || "")))
    throw new Error("旁观者资格无效");
  if (!Number.isInteger(seed) || seed < 0 || seed > 65535) throw new Error("LAN 同步种子必须在 0–65535 之间");
  const difficultyMax = state.game === "th06" ? 4 : 5;
  const difficulty = Number(state.netplay.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > difficultyMax) {
    throw new Error(`LAN 难度必须在 0–${difficultyMax} 之间`);
  }
  const loadouts = state.netplay.loadouts.slice(0, playerCount).map(({ character, shot }, index) => {
    const maxCharacter = state.game === "th06" ? 1 : 2;
    if (!Number.isInteger(character) || character < 0 || character > maxCharacter ||
        !Number.isInteger(shot) || shot < 0 || shot > 1) {
      throw new Error(`P${index + 1} 机体配置无效`);
    }
    return { character, shot };
  });
  if (loadouts.length !== playerCount) throw new Error("LAN 机体配置数量不足");
  return {
    netplayMode: "lan", netplayUrl: url.href, netplayPlayer: player,
    netplayPlayerCount: playerCount, netplaySeed: seed,
    netplayDifficulty: difficulty,
    netplaySpectator: spectator,
    netplaySpectatorId: spectator ? state.netplay.spectatorId : "",
    netplaySpectatorCount: Math.max(0, Number(state.netplay.spectatorCount) || 0),
    netplayIceServers: Array.isArray(state.netplay.iceServers) ? state.netplay.iceServers : [],
    netplayLoadouts: loadouts,
  };
}

function setOption(name, value) {
  if (name === "thpracEnabled" && !gameFeatures(state.game).thprac) return;
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

function touchModeConfirmationText(mode) {
  if (mode === "touch") {
    return "触摸移动会使用新的格式保存录像，和原版录像系统不兼容。";
  }
  if (mode === "touch-unlimited") {
    return "1. 触摸移动会使用新的格式保存录像，和原版录像系统不兼容。\n2. 不限速会破坏游戏原有的弹幕设计，非常不建议使用。\n3. 不限速会使你的处理落率被标记为 100%。";
  }
  if (mode === "joystick-free") {
    return "无方向限制轮盘会使用新的格式保存录像，和原版录像系统不兼容。";
  }
  return "";
}

async function confirmTouchModeBeforeEnable(mode) {
  const message = touchModeConfirmationText(mode);
  return !message || await askConfirmation({
    message,
    confirmText: "启用"
  });
}

async function confirmInputWarnings() {
  const pureTouch = navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches;
  if (!state.options.touchEnabled && (pureTouch || mobileDevice)) {
    return askConfirmation({
      message: "若不启用触摸功能，需要为设备插入键盘或手柄才可以正常游戏。",
      confirmText: "仍要启动"
    });
  }
  return true;
}

function resetRuntime() {
  cancelDirectTouches(false);
  clearTimeout(musicNoticeTimer); $("#musicNotice").classList.remove("show");
  clearFirstFrameWatchdog();
  clearGameDataAttempt();
  hideTransfer();
  revokeImportedContentObjectUrls();
  for (const pending of state.pending.values()) pending.reject(new Error("游戏运行时已切换"));
  state.pending.clear(); state.ready = false; state.launched = false; state.source = ""; state.sourceIdentity = "";
  deferredBackgroundPackageUpdate = null;
  activeInstalledPackageGeneration = null;
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
  resetGameZoom();
  updatePlayerOrientationUi();
  midiSynth?.reset();
  frame.removeAttribute("src");
}

function prepareMidi() {
  if (state.music !== "midi" && !isOggMusicMode(state.music)) return;
  if (!webAudioAvailable) throw new Error("当前浏览器不支持 Web Audio，请选择“无”音乐模式");
  if (!window.WebAudioTinySynth) throw new Error("MIDI 合成器没有加载");
  if (!midiSynth) midiSynth = new window.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 64 });
  const context = midiSynth.getAudioContext();
  if (context.state === "suspended") context.resume();
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
  if (!isPlayerFullscreen() || !navigator.keyboard?.lock) return;
  try {
    // On Android this API is optional, but some browsers may expose it when a
    // physical keyboard is connected. Treat it as best-effort protection
    // against browser-level key consumption in fullscreen; the host OS still
    // has final say over reserved shortcuts.
    await navigator.keyboard.lock(gameKeyboardLockCodes);
  } catch {
    // Keyboard Lock is a progressive enhancement. Unsupported browsers retain
    // their normal browser/system key handling.
  }
}

function isPlayerFullscreen() {
  const current = document.fullscreenElement || document.webkitFullscreenElement;
  // New requests always fullscreen the dedicated player element. Keep the
  // document root accepted only as a legacy/foreign fullscreen state so we
  // can still exit it cleanly if a browser preserved an older session.
  return current === player || current === document.documentElement;
}

async function enterPlayerFullscreen({ focusGame = true } = {}) {
  if (isPlayerFullscreen()) {
    if (focusGame && state.launched) {
      await lockEscapeForGame();
      refocusGameIfNeeded();
    }
    return true;
  }
  const current = document.fullscreenElement || document.webkitFullscreenElement;
  if (current) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
  const target = player;
  if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: "hide" });
  else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  else throw new Error("当前浏览器不支持网页全屏");
  if (focusGame && state.launched) {
    await lockEscapeForGame();
    refocusGameIfNeeded();
  }
  return isPlayerFullscreen();
}

async function togglePlayerFullscreen() {
  try {
    if (isPlayerFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    await enterPlayerFullscreen({ focusGame: true });
  } catch (error) {
    setPlayerStatus(`无法切换全屏：${error.message}`);
  }
}

function handleGameFullscreenKey(event) {
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
  cancelGameZoomGesture();
  cancelTouchLayoutGestures();
  const fullscreenButton = $("#fullscreenToggle");
  const isFullscreen = isPlayerFullscreen();
  fullscreenButton.setAttribute("aria-label", isFullscreen ? "退出全屏" : "进入全屏");
  fullscreenButton.title = isFullscreen ? "退出全屏（Alt+Enter）" : "进入全屏（Alt+Enter）";
  if (isFullscreen) {
    if (state.launched) {
      lockEscapeForGame();
      refocusGameIfNeeded();
    }
  } else {
    if (gameZoomState.active) {
      gameZoomState.active = false;
      updateGameZoomUi();
    }
    fullscreenChordActive = false;
    navigator.keyboard?.unlock?.();
  }
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("fullscreenerror", () => {
  cancelGameZoomGesture();
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
function forwardHostedKeyboard(event) {
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

function preventPlayerBrowserGesture(event) {
  if (!player.classList.contains("open")) return;
  const target = event.target;
  if (target instanceof Element && target.closest("#gameDataLinkWindow")) return;
  if (target === player || (target instanceof Node && player.contains(target))) event.preventDefault();
}
for (const type of ["contextmenu", "selectstart", "dragstart", "gesturestart", "gesturechange", "gestureend"])
  document.addEventListener(type, preventPlayerBrowserGesture, { capture: true, passive: false });

function openPlayerView() {
  if (!player.classList.contains("open")) {
    const previous = history.state && typeof history.state === "object" ? history.state : {};
    const url = new URL(location.href); url.searchParams.set("game", state.product);
    if (!previous[playerHistoryKey]) {
      history.pushState({ ...previous, [playerHistoryKey]: true, game: state.product }, "", url);
    } else if (routedGameFromLocation() !== state.product || previous.game !== state.product) {
      history.replaceState({ ...previous, [playerHistoryKey]: true, game: state.product }, "", url);
    }
  }
  document.body.classList.add("player-active");
  player.classList.add("open");
  player.setAttribute("aria-hidden", "false");
  if (networkActivitySnapshot.count) renderNetworkActivity(networkActivitySnapshot);
  applyTouchLayout(touchLayout);
  if (state.options.touchEnabled && !state.netplay.spectator && localStorage.getItem(touchHelpSeenKey) !== "1") {
    localStorage.setItem(touchHelpSeenKey, "1");
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
  if (!state.launched || !state.ready || !frame.contentWindow || state.netplay.spectator) return false;
  frame.contentWindow.postMessage({
    protocol,
    game: state.game,
    command: "touch-controls",
    ...touchControls,
    touchSensitivity: state.options.touchSensitivity
  }, location.origin);
  return true;
}
function refocusGameIfNeeded() {
  // Keep the historical gameplay hot path: HUD pointerdown handlers prevent
  // default focus transfer, so while the game iframe still owns focus this is
  // intentionally a no-op.  Do not force the Android Player -> Runtime focus
  // relay here; doing so on every fire/focus/bomb/escape input cancels active
  // pointer streams and causes visible frame hitches on mobile WebView.
  if (document.activeElement !== frame) frame.focus({ preventScroll: true });
}

async function closePlayerView(fromHistory = false, { skipSync = false, returnToMpRoom = false } = {}) {
  cancelGameZoomGesture();
  cancelTouchLayoutGestures();
  if (gameZoomState.active) {
    gameZoomState.active = false;
    updateGameZoomUi();
  }
  if (isPlayerFullscreen()) await document.exitFullscreen().catch(() => {});
  // Once the Runtime has already emitted exit there may be nobody left to
  // answer a sync RPC. Waiting for the 3 s timeout only leaves the dead game
  // UI on screen. Normal/manual closes still request an explicit save sync.
  if (!skipSync && state.ready) await send("sync", {}, 3000).catch(() => {});
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
    const url = new URL(location.href);
    url.searchParams.set("game", state.product);
    url.searchParams.set(mpRoomUrlKey, roomCode);
    history.replaceState({
      ...(history.state && typeof history.state === "object" ? history.state : {}),
      [playerHistoryKey]: false,
      [mpRoomHistoryKey]: roomCode,
      game: state.product,
    }, "", url.href);
    renderMpRoom();
    render();
    if (!mpLobby.connected) mpReconnectLobbyNow();
    maybeReloadForAppShellUpdate();
    return;
  }
  if (!fromHistory) replaceLauncherHomeHistory();
  showLauncherHome();
  maybeReloadForAppShellUpdate();
}

function syncSelectionFromPlayerRoute() {
  const routed = routedGameFromLocation();
  if (!routed) return false;
  const nextGame = gameFromProduct(routed);
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
  if (player.classList.contains("open")) await closePlayerView(true);
  if (!syncSelectionFromPlayerRoute()) showLauncherHome();
});
window.addEventListener("pageshow", event => {
  if (event.persisted && !mpUiState.room && !syncSelectionFromPlayerRoute()) showLauncherHome();
});

function send(command, payload = {}, timeout = 15000) {
  if (!state.ready || !frame.contentWindow) return Promise.reject(new Error("游戏运行时尚未就绪"));
  const request = `${Date.now().toString(36)}-${++state.request}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.pending.delete(request); reject(new Error(`${command} 操作超时`)); }, timeout);
    state.pending.set(request, { resolve, reject, timer });
    frame.contentWindow.postMessage({ protocol, game: state.game, command, request, ...payload }, location.origin);
  });
}

window.__eaglerPrepareManagedRuntimeDataV1 = async request => {
  const generation = activeInstalledPackageGeneration;
  if (request?.game !== state.game || !generation?.id || request.generation !== generation.id) {
    throw new Error("Managed Runtime requested an inactive game generation");
  }
  setPlayerStatus("正在把本地 DATA 交给游戏 Runtime…");
  return readManagedRuntimeData(generation);
};

window.addEventListener("message", event => {
  const message = event.data || {};
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (message.protocol !== protocol || message.game !== state.game) return;
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
    loaded[state.game] = true;
    try { localStorage.setItem(`et-loaded-${state.game}`, "1"); } catch {}
    setPlayerStatus("已就绪"); setStatus(`${state.game.toUpperCase()} ${musicModeLabel(state.music)} 已就绪`);
    render();
    frame.dispatchEvent(new CustomEvent("runtime-ready")); return;
  }
  if (message.event === "first-frame") {
    noteFirstFrame();
    // The Runtime main loop is now definitely live. Push the current touch
    // snapshot here instead of racing another message against launch/unwind.
    if (state.launched) pushTouchControlsLive();
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "runtime-info") {
    runtimeDiagnosticState.renderer = typeof message.renderer === "string" ? message.renderer : "";
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "frame-health") {
    runtimeDiagnosticState.maxGapMs = Number.isFinite(Number(message.maxGapMs)) ? Number(message.maxGapMs) : null;
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "audio-health") {
    runtimeDiagnosticState.queuedMs = Number.isFinite(Number(message.queuedMs)) ? Number(message.queuedMs) : null;
    runtimeDiagnosticState.minQueuedMs = Number.isFinite(Number(message.minQueuedMs)) ? Number(message.minQueuedMs) : null;
    runtimeDiagnosticState.backend = message.backend === "worklet" ? "worklet" : message.backend === "script" ? "script" : "";
    runtimeDiagnosticState.underruns = Math.max(0, Number(message.underruns) || 0);
    runtimeDiagnosticState.robust = !!message.robust;
    updateRuntimeDiagnostics();
    return;
  }
  if (message.event === "exit") {
    setPlayerStatus(message.status === "success" ? "游戏已退出" : "游戏异常退出");
    closePlayerView(false, {
      skipSync: true,
      returnToMpRoom: !!mpUiState.room && isMultiplayerProduct(),
    }); return;
  }
  if (message.event === "error") {
    const error = String(message.error || "游戏运行时启动失败");
    setPlayerStatus(error);
    frame.dispatchEvent(new CustomEvent("runtime-error", { detail: error }));
    return;
  }
  if (message.event === "transfer") { showTransfer(message); return; }
  if (message.event === "music-error" || message.event === "music-incomplete") { if (!state.launched) transferFailure(message); return; }
  if (message.event === "music-complete") { transferComplete(message); return; }
  if (message.event === "midi-fallback") { showMidiFallback(message); return; }
  const pending = state.pending.get(message.request);
  if (!pending) return;
  clearTimeout(pending.timer); state.pending.delete(message.request);
  if (message.ok) pending.resolve(message); else {
    const error = new Error(message.error || "游戏运行时操作失败");
    if (Number.isInteger(message.errno)) error.errno = message.errno;
    pending.reject(error);
  }
});

async function ensureInstalledPackageRuntime(show = true) {
  let installed;
  try {
    installed = await readCurrentPackageGeneration(state.game);
  } catch {
    return false;
  }
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
  state.sourceIdentity = requestedIdentity;
  clearGameDataAttempt();
  setPlayerStatus("正在准备本地 Runtime…");
  showTransfer({
    kind: "game",
    mode: "runtime",
    title: "正在准备本地 Runtime…",
    label: `${state.game.toUpperCase()} 本地游戏`,
    phase: "preparing",
    indeterminate: true,
  });
  // Runtime HTML/JS/WASM are Launcher-managed ordinary static resources.
  // Only the selected immutable DATA bytes cross from Package Store into the
  // generated Emscripten loader through Module.getPreloadedPackage.
  state.source = managedRuntimeUrl(runtimeUrl(), generation, state.runtimeVariant, location.href);
  if (show) openPlayerView();
  const runtimeReady = new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      frame.removeEventListener("runtime-ready", ready);
      frame.removeEventListener("runtime-error", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = event => { cleanup(); reject(new Error(event.detail || "本地游戏启动失败")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("本地游戏加载超时")); }, 120000);
    frame.addEventListener("runtime-ready", ready, { once: true });
    frame.addEventListener("runtime-error", failed, { once: true });
  });
  // App-owned same-origin Runtime URLs can commit and execute immediately.
  // Arm readiness/error listeners before navigation so a fast local Runtime
  // cannot emit `ready` in the gap after frame.src changes.
  frame.src = state.source;
  await runtimeReady;
  return true;
}

async function maybeUpdateInstalledPackageBeforeLaunch(installed) {
  const generation = installed?.generation;
  const publication = releaseCatalog?.games?.[state.game];
  if (!generation?.id || !publication || generation.descriptor?.revision === publication.revision) return "none";

  const localInstall = installed.installation?.source === "local";
  const choice = await askDecision({
    message: localInstall
      ? "服务器有新版游戏资源。你当前导入的本地版本仍然可以直接启动。"
      : "服务器有新版游戏资源。当前版本仍然可以直接启动。",
    confirmText: "立即更新",
    secondaryText: "后台下载",
    cancelText: "继续当前版本",
  });
  if (choice === "cancel") return "none";
  if (choice === "secondary") return "background";

  const operation = beginBlockingNetworkOperation({ label: "取消更新" });
  try {
    setPlayerStatus(localInstall ? "正在更新本地游戏…" : "检测到服务器新版，正在更新游戏…");
    const updated = await installPublishedPackage(state.game, {
      catalog: releaseCatalog,
      catalogUrl: releaseCatalogUrl,
      addComponents: [],
      preserveLocalSource: true,
      fetchImpl: packageTrackedFetch(state.game),
      signal: operation.controller.signal,
      onProgress(progress) {
        setPlayerStatus(localInstall
          ? `正在更新本地游戏… ${progress.completed}/${progress.total}`
          : `正在更新游戏… ${progress.completed}/${progress.total}`);
      },
    });
    if (updated?.generation) installedPackageSnapshots.set(state.game, updated.generation);
    showToast("游戏资源已更新。");
    return "updated";
  } catch (error) {
    if (isCancelledDownload(error)) {
      showToast("已取消更新，继续使用当前版本。");
      return "none";
    }
    showToast(`游戏资源更新失败，继续使用当前版本：${error.message || error}`);
    return "none";
  } finally {
    finishBlockingNetworkOperation(operation);
  }
}

function startBackgroundPackageUpdate(installed) {
  const game = state.game;
  if (backgroundPackageUpdates.has(game)) return;
  const catalog = releaseCatalog;
  const catalogUrl = releaseCatalogUrl;
  const addComponents = [];
  const localInstall = installed?.installation?.source === "local";
  const task = installPublishedPackage(game, {
    catalog,
    catalogUrl,
    addComponents,
    preserveLocalSource: true,
    // Background updates deliberately stay out of the blocking transfer UI.
    fetchImpl: globalThis.fetch,
  }).then(updated => {
    if (updated?.generation) {
      installedPackageSnapshots.set(game, updated.generation);
      if (state.game === game && state.launched) {
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
  let generation = activeInstalledPackageGeneration;
  const oggIds = componentFileIds(generation.descriptor, "ogg");
  const initialIds = oggIds.slice(0, 2);
  if (initialIds.length < 2) {
    state.music = "midi";
    return;
  }
  const missing = initialIds.filter(fileId => !generation.files?.[fileId]?.objectId);
  if (!missing.length) return;
  const publication = releaseCatalog?.games?.[state.game];
  if (importOnlyServer || !publication || publication.revision !== generation.descriptor.revision) {
    state.music = "midi";
    showToast("前两首 OGG 尚未完整准备，本次使用 MIDI。游戏内容不会被覆盖。");
    return;
  }
  const operation = beginBlockingNetworkOperation({ label: "取消音乐下载" });
  try {
    setPlayerStatus("正在准备前两首 OGG…");
    const updated = await installPublishedPackage(state.game, {
      catalog: releaseCatalog,
      catalogUrl: releaseCatalogUrl,
      addFileIds: initialIds,
      preserveLocalSource: true,
      fetchImpl: packageTrackedFetch(state.game),
      signal: operation.controller.signal,
      onProgress(progress) {
        setPlayerStatus(`正在准备前两首 OGG… ${progress.completed}/${progress.total}`);
      },
    });
    if (!initialIds.every(fileId => !!updated.generation?.files?.[fileId]?.objectId)) {
      throw new Error("前两首 OGG 未完整写入本地存储");
    }
    generation = updated.generation;
    activeInstalledPackageGeneration = generation;
    installedPackageSnapshots.set(state.game, generation);
  } catch (error) {
    if (!isCancelledDownload(error)) showToast(`前两首 OGG 准备失败，本次使用 MIDI：${error.message || error}`);
    state.music = "midi";
  } finally {
    finishBlockingNetworkOperation(operation);
  }
}

function startManagedOggProgressiveInstall() {
  const gameId = state.game;
  const launchWindow = currentRuntimeWindow();
  const generation = activeInstalledPackageGeneration;
  if (!isOggMusicMode(state.music) || !state.launched || !generation || backgroundOggInstalls.has(gameId)) return;
  const publication = releaseCatalog?.games?.[gameId];
  if (!publication || publication.revision !== generation.descriptor.revision) return;
  const remaining = componentFileIds(generation.descriptor, "ogg")
    .slice(2)
    .filter(fileId => !generation.files?.[fileId]?.objectId);
  if (!remaining.length) return;
  const task = (async () => {
    for (const fileId of remaining) {
      if (!state.launched || state.game !== gameId || currentRuntimeWindow() !== launchWindow) return;
      try {
        const updated = await installPublishedPackage(gameId, {
          catalog: releaseCatalog,
          catalogUrl: releaseCatalogUrl,
          addFileIds: [fileId],
          preserveLocalSource: true,
          fetchImpl: globalThis.fetch,
        });
        if (!updated.generation?.files?.[fileId]?.objectId) throw new Error("下载完成后没有持久化对象");
        activeInstalledPackageGeneration = updated.generation;
        installedPackageSnapshots.set(gameId, updated.generation);
        const declaration = updated.generation.descriptor.files[fileId];
        await installManagedPackageResources([{
          fileId,
          path: declaration.target,
          size: Number(declaration.bytes) || 0,
        }]);
        console.info(`${gameId}: OGG ready ${fileId}`);
      } catch (error) {
        console.warn(`${gameId}: OGG progressive install failed ${fileId}`, error);
      }
    }
  })().finally(() => {
    if (backgroundOggInstalls.get(gameId) === task) backgroundOggInstalls.delete(gameId);
  });
  backgroundOggInstalls.set(gameId, task);
}

async function ensureRuntime(show = true) {
  let localInstalled = null;
  try { localInstalled = await readCurrentPackageGeneration(state.game); } catch {}
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
    const operation = beginBlockingNetworkOperation({ label: "取消下载" });
    try {
      if (show) openPlayerView();
      setPlayerStatus("正在安装游戏资源…");
      await installPublishedPackage(state.game, {
        catalog: releaseCatalog,
        catalogUrl: releaseCatalogUrl,
        addComponents: [],
        fetchImpl: packageTrackedFetch(state.game),
        signal: operation.controller.signal,
        onProgress(progress) {
          setPlayerStatus(`正在安装游戏资源… ${progress.completed}/${progress.total}`);
        }
      });
      if (await ensureInstalledPackageRuntime(show)) return;
    } catch (error) {
      if (isCancelledDownload(error)) throw error;
      if (!legacyRemoteAvailable) throw error;
      showToast(`游戏资源安装失败，本次尝试兼容启动方式：${error.message || error}`);
    } finally {
      finishBlockingNetworkOperation(operation);
    }
  }
  if (!legacyRemoteAvailable) {
    throw new Error(remoteCatalogError
      ? `服务器当前不可用，且本机没有已安装的 ${state.game.toUpperCase()} 游戏资源。请恢复网络后重试，或导入本地游戏包。\n${remoteCatalogError.message || remoteCatalogError}`
      : `服务器发行信息尚未就绪，且本机没有已安装的 ${state.game.toUpperCase()} 游戏资源。请稍后重试，或导入本地游戏包。`);
  }
  const expectedData = gameDataDescriptor();
  const importedData = readImportedGameDataMeta(state.game);
  const importedDataCompatible = !!importedData && importedData.layout === expectedData.layout;
  if (importOnlyServer && !importedDataCompatible) {
    throw new Error("当前服务器不提供游戏文件，请先导入本地游戏包");
  }
  let useImportedData = importOnlyServer ? true : importedDataCompatible;
  if (!importOnlyServer && importedDataCompatible && importedData.version !== expectedData.version) {
    const choiceKey = `${state.game}:${importedData.version}->${expectedData.version}`;
    let choice = importedDataUpdateChoices.get(choiceKey);
    if (!choice) {
      const tryWebsite = await askConfirmation({
        message: "你导入的本地版本仍然可以继续使用，不会被强制更新或删除。\n\n确认后将先尝试服务器当前版本。",
        confirmText: "尝试服务器版本",
        cancelText: "继续本地版本"
      });
      choice = tryWebsite ? "website" : "local";
      importedDataUpdateChoices.set(choiceKey, choice);
    }
    useImportedData = choice !== "website";
  }
  const importedOgg = readImportedOggMeta(state.game);
  const sourceUrl = new URL(runtimeUrl(), location.href);
  sourceUrl.searchParams.set("runtimeVariant", state.runtimeVariant || "normal");
  if (state.replayViewer) sourceUrl.searchParams.set("launchIntent", "replay");
  sourceUrl.searchParams.set("asset", useImportedData ? importedData.version : expectedData.version);
  const ogg = game().music?.ogg;
  if (ogg && typeof ogg.version === "string") sourceUrl.searchParams.set("oggAsset", importedOgg?.version || ogg.version);
  const requestedIdentity = sourceUrl.href;
  if (show) openPlayerView();
  if (state.ready && state.sourceIdentity === requestedIdentity) return;
  resetRuntime(); state.sourceIdentity = requestedIdentity; setPlayerStatus("载入游戏数据…");
  if (importedData && !importedDataCompatible) {
    showToast("已保留你导入的游戏数据，但它的文件布局与当前运行时不兼容；本次改用服务器资源。");
  }
  if (useImportedData) {
    state.source = sourceUrl.href;
    activeLegacyImportedAssetsMeta = importedData.legacyAssets || null;
    try {
      await primeImportedGameDataForRuntime(sourceUrl, importedData);
      clearGameDataAttempt();
      setPlayerStatus("载入本地导入的游戏数据…");
      if (importedData.version !== expectedData.version) {
        showToast("服务器已有新版游戏资源；本次继续使用你导入的本地版本，不会强制更新。");
      }
    } catch (error) {
      activeLegacyImportedAssetsMeta = null;
      if (importOnlyServer) throw new Error(`本地游戏包不可用：${error.message || error}`);
      sourceUrl.searchParams.set("asset", expectedData.version);
      state.source = sourceUrl.href;
      state.sourceIdentity = sourceUrl.href;
      await releaseImportedGameDataRuntimeOwner(sourceUrl, state.game).catch(() => {});
      showToast(`本地导入数据暂时不可用，已改用服务器资源：${error.message}`);
      beginGameDataAttempt();
    }
  } else {
    if (importOnlyServer) throw new Error("当前服务器不提供游戏文件，请先导入本地游戏包");
    state.source = sourceUrl.href;
    await releaseImportedGameDataRuntimeOwner(sourceUrl, state.game).catch(() => {});
    beginGameDataAttempt();
  }
  if (!importOnlyServer && importedOgg && ogg && importedOgg.version !== ogg.version) {
    showToast("服务器已有新版 OGG；本次仍优先使用你导入的本地 OGG，不会强制更新。");
  }
  showTransfer({
    kind: "game",
    mode: "runtime",
    title: "正在请求运行组件…",
    label: `请求 ${state.game.toUpperCase()} 运行组件`,
    phase: "requesting",
    indeterminate: true,
  });
  frame.src = state.source;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      frame.removeEventListener("runtime-ready", done);
      unlockGameDataImport("游戏运行组件加载已超时。");
      reject(new Error("游戏加载超时"));
    }, 120000);
    const done = () => { clearTimeout(timer); resolve(); };
    frame.addEventListener("runtime-ready", done, { once: true });
  });
}

async function selectedMusicResources() {
  if (state.music === "none") return [];
  if (activeInstalledPackageGeneration) {
    const generation = activeInstalledPackageGeneration;
    const ids = componentFileIds(generation.descriptor, "ogg");
    const installed = ids.filter(fileId => !!generation.files?.[fileId]?.objectId);
    if (installed.length) {
      const resources = [];
      for (const fileId of installed) {
        const declaration = generation.descriptor.files[fileId];
        if (declaration) resources.push({ packageFileId: fileId, path: declaration.target, size: Number(declaration.bytes) || 0 });
      }
      return resources;
    }
    if (importOnlyServer || !releaseCatalog?.games?.[state.game]) return [];
    const descriptorUrl = releaseCatalogEntryUrl(releaseCatalogUrl, releaseCatalog, state.game);
    return ids.map(fileId => {
      const declaration = generation.descriptor.files[fileId];
      if (!declaration || typeof declaration.source !== "string" || typeof declaration.target !== "string") {
        throw new Error("音乐 Package 资源描述无效");
      }
      return {
        url: new URL(declaration.source, descriptorUrl).href,
        path: declaration.target,
        size: Number(declaration.bytes) || 0,
      };
    });
  }
  const pack = musicPackage();
  if (!pack || !Array.isArray(pack.files)) throw new Error("音乐资源清单无效");
  const mount = typeof pack.mount === "string" ? pack.mount.replace(/\/$/, "") : "";
  const imported = isOggMusicMode(state.music) ? readImportedOggMeta(state.game) : null;
  if (imported && pack.files.every(name => imported.files.includes(name))) {
    return pack.files.map((name, index) => ({
      localKey: localOggCacheUrl(location.origin, state.game, imported.version, name),
      path: `${mount}/${name}`,
      size: Number(pack.sizes?.[index]) || 0
    }));
  }
  return pack.files.map((name, index) => {
    if (typeof name !== "string" || !name || name.includes("/") || name.includes("\\")) throw new Error("音乐资源文件名无效");
    const url = new URL(name, new URL(pack.base || "./", location.href));
    if (typeof pack.version === "string" && pack.version) url.searchParams.set("v", pack.version);
    return { url: url.href, path: `${mount}/${name}`, size: Number(pack.sizes?.[index]) || 0 };
  });
}

async function selectedSharedResources() {
  if (activeInstalledPackageGeneration) return [];
  const vanillaFont = manifest.shared?.vanillaFont;
  const unicodeFont = manifest.shared?.unicodeFont;
  if (typeof vanillaFont !== "string" || !vanillaFont || typeof unicodeFont !== "string" || !unicodeFont) {
    throw new Error("共享字体资源清单无效");
  }
  const wanted = [];
  if (state.language === "ja") wanted.push({ target: "/msgothic.ttc", network: vanillaFont });
  if (state.language !== "ja" || state.options.thpracEnabled) wanted.push({ target: "/unifont.otf", network: unicodeFont });
  if (activeLegacyImportedAssetsMeta) {
    const resources = [];
    for (const item of wanted) {
      const declaration = activeLegacyImportedAssetsMeta.shared.find(file => file.target === item.target);
      if (!declaration) throw new Error(`导入的游戏包缺少 ${item.target.slice(1)}`);
      const blob = await readLocalImportedAsset(declaration.key);
      if (!blob || blob.size !== declaration.bytes) throw new Error(`离线资源 ${item.target.slice(1)} 已丢失或损坏`);
      resources.push({ url: importedContentObjectUrl(blob), path: item.target });
    }
    return resources;
  }
  return wanted.map(item => ({ url: new URL(item.network, location.href).href, path: item.target }));
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest === "function") {
    return Array.from(new Uint8Array(await subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const k = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const total = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(input);
  padded[input.length] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  dv.setUint32(total - 8, Math.floor(bitLength / 0x100000000), false);
  dv.setUint32(total - 4, bitLength >>> 0, false);
  const w = new Uint32Array(64);
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ror(x, 7) ^ ror(x, 18) ^ (x >>> 3);
      const s1 = ror(y, 17) ^ ror(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return Array.from(h, value => value.toString(16).padStart(8, "0")).join("");
}

function languageCacheKey(pack) {
  return new Request(`${location.origin}/__eagler-language/${state.game}/${pack.language}/${pack.sha256}`);
}

function parseStaticPackManifest(bytes, pack) {
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("语言包清单损坏"); }
  const prefix = `/thcrap/${state.game}/`;
  if (value?.schema !== "eagler-touhou/thcrap-static-pack/1" || value.game !== state.game ||
      value.language !== pack.language || typeof value.runtimeVersion !== "string" ||
      !Array.isArray(value.files) || value.files.length > 256) throw new Error("语言包清单不兼容");
  for (const file of value.files) {
    if (typeof file?.path !== "string" || !file.path.startsWith(prefix) || file.path.includes("\\") || file.path.includes("..") ||
        !Number.isInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== "string") throw new Error("语言包文件清单无效");
  }
  return value;
}

async function readLanguagePackResponse(response, pack, noteNetworkActivity = null, networkTaskId = null) {
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
    $("#transferTitle").textContent = "语言包下载完成";
    transferHideTimer = setTimeout(hideTransfer, 2200);
    return bytes;
  }
  const chunks = [];
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
  $("#transferTitle").textContent = "语言包下载完成";
  transferHideTimer = setTimeout(hideTransfer, 2200);
  return archive;
}

async function downloadLanguagePack(pack, cacheMode) {
  const operation = beginBlockingNetworkOperation({ label: "取消下载" });
  const controller = operation.controller;
  let timer = null;
  let timedOut = false;
  const timeoutMs = 15_000;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  arm();
  const networkTaskId = networkActivity.begin({
    title: "正在下载语言包…",
    label: `请求 ${entryTitle(languageEntry())} 语言包`,
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
      throw new Error(`${new URL(pack.url).pathname}: 15 秒内没有继续收到数据（网络 / CDN 超时）`);
    }
    if (error?.name === "AbortError") throw error;
    throw error;
  } finally {
    clearTimeout(timer);
    networkActivity.finish(networkTaskId);
    finishBlockingNetworkOperation(operation);
  }
}

async function prepareLanguagePack() {
  const pack = selectedLanguagePack();
  if (!pack) return null;
  const prefix = `/thcrap/${state.game}/`;
  if (!globalThis.fflate?.unzipSync) throw new Error("ZIP 组件没有加载");
  let archive = null;
  let cache = null;
  let cacheKey = null;
  let fromCache = false;
  if (pack.packageObjectId) {
    const object = await readPackageObject(pack.packageObjectId);
    if (!object?.blob) throw new Error("本地语言包已丢失");
    archive = new Uint8Array(await object.blob.arrayBuffer());
  } else if (pack.localKey) {
    const blob = await readLocalImportedAsset(pack.localKey);
    if (!blob || blob.size !== pack.bytes) throw new Error("离线语言包已丢失或损坏");
    archive = new Uint8Array(await blob.arrayBuffer());
  } else {
    try { cache = await globalThis.caches?.open(languageCacheName); } catch {}
    cacheKey = languageCacheKey(pack);
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
      archive = new Uint8Array(await cached.arrayBuffer());
      fromCache = true;
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
  let archiveHash = pack.packageObjectId ? null : await sha256Hex(archive);
  if (!pack.packageObjectId && (archive.length !== pack.bytes || archiveHash.toLowerCase() !== pack.sha256.toLowerCase()) && fromCache && !pack.localKey) {
    if (cache) try { await cache.delete(cacheKey); } catch {}
    try {
      archive = await downloadLanguagePack(pack, "no-store");
      archiveHash = await sha256Hex(archive);
    } catch (error) {
      languageTransferFailure(entryTitle(languageEntry()), error);
      throw error;
    }
  }
  if (!pack.packageObjectId && archive.length !== pack.bytes) throw new Error("语言包大小错误");
  if (!pack.packageObjectId && archiveHash.toLowerCase() !== pack.sha256.toLowerCase()) throw new Error("语言包 SHA-256 校验失败");
  if (cache && !pack.localKey) try { await cache.put(cacheKey, new Response(archive)); } catch {}
  const entries = globalThis.fflate.unzipSync(archive);
  const manifestBytes = entries["manifest.json"];
  if (!(manifestBytes instanceof Uint8Array)) throw new Error("语言包缺少清单");
  const packManifest = parseStaticPackManifest(manifestBytes, pack);
  const expected = new Map(packManifest.files.map(file => [file.path, file]));
  const names = Object.keys(entries).filter(name => name !== "manifest.json");
  if (names.length !== expected.size) throw new Error("语言包文件数量不一致");
  const files = [];
  for (const name of names) {
    if (!name.startsWith(`${prefix.slice(1)}`) || name.includes("\\") || name.includes("..")) throw new Error("语言包路径无效");
    const path = `/${name}`;
    const declaration = expected.get(path);
    const bytes = entries[name];
    if (!declaration || bytes.length !== declaration.bytes) {
      throw new Error(`${path}: 语言包文件大小错误`);
    }
    files.push({ path, bytes });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // The hosted shells validate runtimePack.url as a same-origin provenance
  // marker even though the already-verified file bytes are carried inline.
  // Online packs naturally have a URL; bundled offline packs intentionally do
  // not, so expose their stable local IndexedDB key as a same-origin virtual
  // URL rather than making the shell reject an otherwise valid local pack.
  const runtimePackUrl = typeof pack.url === "string" && pack.url
    ? pack.url
    : pack.packageObjectId
      ? new URL(`/__eagler/package-language/${state.game}/${encodeURIComponent(pack.language)}`, location.origin).href
      : new URL(pack.localKey, location.origin).href;
  return { ...pack, runtimeVersion: packManifest.runtimeVersion, bytes: archive.length, url: runtimePackUrl, manifest: packManifest, files };
}

const isReplay = path => /(^|\/)replay\//i.test(path) || /\.rpyx?$/i.test(path);
const isSafeRelativePath = value => typeof value === "string" && value.length > 0 && value.length <= 240 &&
  !value.includes("\\") && !value.startsWith("/") && !value.split("/").some(part => !part || part === "." || part === "..");
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const replayPrefix = () => state.game === "th06" ? "th6" : "th7";
const validReplayName = name => new RegExp(`^${replayPrefix()}_(?:\\d{2}|ud[0-9a-f]{4})\\.rpyx?$`, "i").test(name);
const formatBytes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
async function replayListing() {
  await ensureRuntime(false);
  await send("sync");
  const listing = await send("list");
  return listing.files.filter(file => isReplay(file.path)).sort((a, b) => a.path.localeCompare(b.path));
}
function nextReplayName(existing, extended = false) {
  const lower = new Set(existing.map(path => path.toLowerCase()));
  for (let index = 0; index <= 0xffff; index++) {
    const name = `${replayPrefix()}_ud${index.toString(16).padStart(4, "0")}${extended ? ".rpyx" : ".rpy"}`;
    if (!lower.has(`replay/${name}`)) return name;
  }
  throw new Error("用户录像槽已用尽");
}

async function exportFiles(kind) {
  const label = kind === "save" ? "存档" : "录像";
  const wasReady = state.ready;
  showToast(`正在准备导出${label}…`);
  try {
    await ensureRuntime(false); setPlayerStatus(`正在导出${label}…`); await send("sync");
    if (kind === "save") {
      const result = await send("read", { path: "score.dat" });
      download("score.dat", new Uint8Array(result.bytes), "application/octet-stream");
    } else {
      if (!globalThis.fflate?.zipSync) throw new Error("ZIP 组件没有加载");
      const listing = await replayListing();
      if (!listing.length) throw new Error("没有可导出的录像");
      const entries = {};
      for (const file of listing) {
        const result = await send("read", { path: file.path });
        entries[file.path] = new Uint8Array(result.bytes);
      }
      download(`${state.game}-replay-${new Date().toISOString().slice(0,10)}.zip`,
        fflate.zipSync(entries, { level: 1 }), "application/zip");
    }
    if (!wasReady) resetRuntime();
    showToast(`已开始下载原版${label}`);
    setPlayerStatus(`已导出原版${label}`);
  } catch (error) {
    if (!wasReady) resetRuntime();
    const missingSave = kind === "save" && error?.errno === 44;
    const missingReplay = kind === "replay" && error?.message === "没有可导出的录像";
    if (missingSave || missingReplay) {
      const labelText = missingSave ? "当前还没有 score.dat。是否现在导入存档？" : "当前还没有录像。是否现在导入录像？";
      if (await askConfirmation({ message: labelText, confirmText: "选择导入文件" })) {
        const file = await pickFile(missingSave ? ".dat" : ".zip,.rpy,.rpyx");
        if (file) await importFile(missingSave ? "save" : "replay", file);
      }
      return;
    }
    showToast(`导出${label}失败：${error.message}`);
    throw error;
  }
}
async function importFile(kind, file) {
  if (!file.size) throw new Error("不能导入空文件");
  if (file.size > maxImportBytes) throw new Error("导入文件超过 128 MiB 限制");
  if (kind === "save" && state.launched) resetRuntime();
  await ensureRuntime(false); setPlayerStatus("正在导入…"); let files;
  const lowerName = file.name.toLowerCase();
  if (kind === "save" && lowerName.endsWith(".dat")) {
    files = [{ path: "score.dat", bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && /\.rpyx?$/.test(lowerName)) {
    const sanitized = file.name.replace(/[^\w.()-]/g, "_");
    const listing = await send("list");
    const existing = listing.files.map(item => item.path);
    let replayName = validReplayName(sanitized) ? sanitized : "";
    if (!replayName || existing.some(path => path.toLowerCase() === `replay/${replayName}`.toLowerCase()))
      replayName = nextReplayName(existing, lowerName.endsWith(".rpyx"));
    files = [{ path: `replay/${replayName}`, bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && lowerName.endsWith(".zip")) {
    if (!globalThis.fflate?.unzipSync) throw new Error("ZIP 组件没有加载");
    const archive = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
    const listing = await send("list");
    const existing = listing.files.map(item => item.path);
    files = [];
    for (const [archivePath, bytes] of Object.entries(archive)) {
      if (archivePath.endsWith("/")) continue;
      if (!isSafeRelativePath(archivePath)) throw new Error("ZIP 包含不安全路径");
      const originalName = archivePath.split("/").pop();
      if (!originalName || !/\.rpyx?$/i.test(originalName)) continue;
      const occupied = [...existing, ...files.map(item => item.path)];
      const originalTarget = `replay/${originalName}`;
      const name = validReplayName(originalName) &&
          !occupied.some(path => path.toLowerCase() === originalTarget.toLowerCase())
        ? originalName : nextReplayName(occupied, originalName.toLowerCase().endsWith(".rpyx"));
      files.push({ path: `replay/${name}`, bytes });
    }
  } else {
    throw new Error(kind === "save" ? "请选择原版 .dat 存档" : "请选择 .rpy / .rpyx 录像或录像 ZIP");
  }
  if (!files.length) throw new Error("文件包中没有可导入的文件");
  const uniquePaths = new Set(files.map(item => item.path.toLowerCase()));
  if (uniquePaths.size !== files.length) throw new Error("文件包中存在重复路径");
  if (files.some(item => item.bytes.length > maxStoredFileBytes)) throw new Error("单个文件超过 64 MiB 限制");
  for (const item of files) await send("write", { path: item.path, bytes: Array.from(item.bytes) });
  if (kind === "save") {
    const expected = files[0].bytes;
    resetRuntime();
    await ensureRuntime(false);
    const persisted = new Uint8Array((await send("read", { path: "score.dat" })).bytes);
    if (persisted.length !== expected.length || persisted.some((byte, index) => byte !== expected[index])) {
      throw new Error("存档写入后未能从浏览器持久存储完整读回");
    }
  }
  const replayDialog = $("#replayDialog");
  const keepReplayManagerOpen = kind === "replay" && replayDialog.open;
  resetRuntime();
  if (keepReplayManagerOpen) await refreshReplayManager();
  else if (replayDialog.open) replayDialog.close();
  $("#player").classList.remove("open");
  $("#player").setAttribute("aria-hidden", "true");
  showToast(`已导入 ${files.length} 个文件；点击「启动游戏」重新启动后生效`);
  setStatus(`已导入 ${files.length} 个文件；点击「启动游戏」重新启动后生效`);
}

async function refreshReplayManager({ animateRows = false } = {}) {
  const files = await replayListing();
  const list = $("#replayList");
  list.replaceChildren();
  $("#replaySummary").textContent = `${files.length} 个文件`;
  if (!files.length) {
    const empty = document.createElement("div"); empty.className = "replay-empty"; empty.textContent = "暂无录像文件"; list.append(empty); return;
  }
  for (const [index, file] of files.entries()) {
    const row = document.createElement("div"); row.className = "replay-row";
    if (animateRows) { row.classList.add("replay-row-enter"); row.style.setProperty("--replay-row-delay", `${Math.min(index, 8) * 16}ms`); }
    const name = file.path.split("/").pop();
    const label = document.createElement("span"); label.className = "replay-name"; label.textContent = name; label.title = name;
    const size = document.createElement("span"); size.className = "replay-size"; size.textContent = formatBytes(file.size);
    const get = document.createElement("button"); get.type = "button"; get.textContent = "下载";
    get.onclick = () => send("read", { path: file.path })
      .then(result => download(name, new Uint8Array(result.bytes), "application/octet-stream"))
      .catch(error => showToast(`录像下载失败：${error.message}`));
    const actions = document.createElement("span"); actions.className = "replay-row-actions";
    const rename = document.createElement("button"); rename.type = "button"; rename.textContent = "改名";
    rename.onclick = async () => { try {
      const renamed = prompt("输入新的录像文件名", name);
      if (renamed === null) return;
      if (!renamed.trim()) throw new Error("录像文件名不能为空");
      if (!validReplayName(renamed.trim())) throw new Error(`文件名必须符合 ${replayPrefix()}_01.rpy / .rpyx 或 ${replayPrefix()}_ud0000.rpy / .rpyx`);
      const target = `replay/${renamed.trim()}`;
      if (target.toLowerCase() === file.path.toLowerCase()) return;
      if (files.some(candidate => candidate.path.toLowerCase() === target.toLowerCase())) throw new Error("已存在同名录像文件");
      const result = await send("read", { path: file.path });
      await send("write", { path: target, bytes: result.bytes });
      await send("remove", { path: file.path });
      await refreshReplayManager();
    } catch (error) { showToast(`录像操作失败：${error.message}`); } };
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "replay-delete"; remove.textContent = "删除";
    remove.onclick = async () => { try {
      if (!await askConfirmation({
        message: `录像「${name}」将被永久删除。\n\n此操作无法撤销。`,
        confirmText: "删除",
        tone: "danger"
      })) return;
      await send("remove", { path: file.path });
      await refreshReplayManager();
    } catch (error) { showToast(`录像删除失败：${error.message}`); } };
    actions.append(get, rename, remove);
    row.append(label, size, actions); list.append(row);
  }
}

async function manageReplays() {
  const dialog = $("#replayDialog");
  const list = $("#replayList");
  list.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "replay-loading";
  loading.innerHTML = '<i aria-hidden="true"></i><span>正在读取录像…</span>';
  list.append(loading);
  $("#replaySummary").textContent = "读取中…";
  dialog.classList.remove("closing");
  if (!dialog.open) dialog.showModal();
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    await refreshReplayManager({ animateRows: true });
  } catch (error) {
    list.replaceChildren();
    const failed = document.createElement("div");
    failed.className = "replay-empty replay-load-error";
    failed.textContent = "录像读取失败";
    list.append(failed);
    $("#replaySummary").textContent = "读取失败";
    throw error;
  }
}

const replayDialog = $("#replayDialog");
const replayWindow = document.querySelector("#replayDialog .replay-window");
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
replayDialog.addEventListener("close", () => replayDialog.classList.remove("closing"));
document.querySelectorAll("[data-replay-close]").forEach(button => button.addEventListener("click", closeReplayManager));
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
    if (files.length !== 1) throw new Error("请一次拖入一个 .rpy、.rpyx 或 .zip 文件");
    if (!/\.(rpyx?|zip)$/i.test(files[0].name)) throw new Error("只接受 .rpy / .rpyx 或录像 ZIP");
    await importFile("replay", files[0]);
  } catch (error) {
    setStatus(`错误：${error.message}`); showToast(`录像导入失败：${error.message}`);
  }
});
document.querySelectorAll("[data-mp-fold]").forEach(button => button.addEventListener("click", () => {
  const name = button.dataset.mpFold;
  mpSetFold(name, !mpUiState.folds[name]);
}));
$("#mpLanguageSelect").addEventListener("change", event => {
  const value = event.target.value;
  if (!languageCatalog("th07").some(entry => entry.id === value)) return;
  state.language = value; saveGamePreferences(); render();
});
$("#mpMusicSelect").addEventListener("change", event => {
  if (!musicModes.has(event.target.value)) return;
  state.music = event.target.value; state.musicPreferenceExplicit = true; saveGamePreferences(); render();
});
$("#mpFrameLimitToggle").addEventListener("click", () => {
  state.options.frameLimit60Enabled = !state.options.frameLimit60Enabled; saveGamePreferences(); render();
});
$("#mpShareSettingsToggle").addEventListener("click", () => {
  saveGamePreferences();
  mpShareSingleplayerSettings = !mpShareSingleplayerSettings;
  try { localStorage.setItem(mpShareSettingsKeyForProduct(state.product), mpShareSingleplayerSettings ? "1" : "0"); } catch {}
  restoreGamePreferences(state.game, currentPreferenceId());
  resetRuntime();
  render();
  setStatus(mpShareSingleplayerSettings ? "联机模式已共用单机设置" : "联机模式已改用独立设置");
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
  void openTouchLayoutEditor().catch(error => { showToast(error.message); setStatus(`错误：${error.message}`); });
});
$("#mpJoinCode").addEventListener("input", event => { event.target.value = mpNormalizeRoomCode(event.target.value); });
$("#mpCreateRoom").addEventListener("click", () => mpEnterRoom(mpGenerateRoomCode(), true));
$("#mpJoinRoom").addEventListener("click", () => {
  const code = mpNormalizeRoomCode($("#mpJoinCode").value);
  if (!code) { showToast("请输入房间号"); return; }
  mpEnterRoom(code, false);
});
$("#mpReplayViewer").addEventListener("click", async () => {
  if (mpLaunchInFlight) return;
  mpLaunchInFlight = true;
  try {
    state.product = multiplayerProductForGame(state.game);
    state.runtimeVariant = "multiplayer";
    state.replayViewer = true;
    resetRuntime();
    openPlayerView();
    await launchConfiguredRuntime();
    setStatus(`已打开 ${state.game.toUpperCase()} 联机 Replay 菜单`);
  } catch (error) {
    const message = error?.message || String(error);
    if (!state.launched && isResourceLoadFailure(error)) {
      // Preserve replayViewer while importing. Closing Player here would reset
      // the Replay intent and turn the post-import resume into a normal launch.
      setPlayerStatus("缺少游戏资源，请导入本地游戏包后继续");
      beginManualGamePackageImport(message);
      setStatus("缺少游戏资源，请先导入本地游戏包");
      showToast(message);
    } else {
      showStartupError(error, `${state.game.toUpperCase()} 联机 Replay`);
      showToast(message);
    }
  } finally {
    mpLaunchInFlight = false;
  }
});
async function mpCopyRoomCode() {
  if (!mpUiState.room) return;
  try { await navigator.clipboard.writeText(mpUiState.room.code); showToast("房间号已复制，可以发给好友"); }
  catch { showToast(`房间号：${mpUiState.room.code}`); }
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
  if (!mpRoomOwnerLocal() || !mpLobby.connected) return;
  const count = Number(event.target.value) === 3 ? 3 : 2;
  mpUiState.room.playerCount = count;
  if (mpUiState.seat != null && mpUiState.seat >= count) mpUiState.seat = null;
  mpLobbySend({ type: "settings", playerCount: count, difficulty: mpUiState.room.difficulty });
  renderMpRoom();
});
$("#mpRoomDifficulty").addEventListener("change", event => {
  if (!mpRoomOwnerLocal() || !mpLobby.connected) return;
  mpUiState.room.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number(event.target.value) || 0));
  mpLobbySend({ type: "settings", playerCount: mpUiState.room.playerCount, difficulty: mpUiState.room.difficulty });
  renderMpRoom();
});
document.querySelectorAll("[data-mp-player-count]").forEach(button => button.addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  $("#mpRoomPlayerCount").value = button.dataset.mpPlayerCount;
  $("#mpRoomPlayerCount").dispatchEvent(new Event("change", { bubbles: true }));
}));
document.querySelectorAll("[data-mp-difficulty]").forEach(button => button.addEventListener("click", () => {
  if (!mpRoomOwnerLocal()) return;
  $("#mpRoomDifficulty").value = button.dataset.mpDifficulty;
  $("#mpRoomDifficulty").dispatchEvent(new Event("change", { bubbles: true }));
}));
document.querySelectorAll("[data-mp-seat-drop] button").forEach(button => button.addEventListener("click", () => {
  mpTakeSeat(Number(button.closest("[data-mp-seat-drop]").dataset.mpSeatDrop));
}));
$("#mpStandUp").addEventListener("click", mpStandUp);
$("#mpSpectatorJoin").addEventListener("click", () => {
  if (mpUiState.spectatorRequested) mpLeaveSpectatorSeat();
  else mpTakeSpectatorSeat();
});

const mpSpectatorRailPositionKey = "eagler.mpSpectatorRail.mobilePosition.v1";
function mpSetupSpectatorRailDrag() {
  const rail = $("#mpSpectatorRail");
  const handle = rail?.querySelector(".mp-spectator-rail-head");
  if (!rail || !handle) return;
  const mobile = window.matchMedia("(max-width:780px)");
  let drag = null;

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
  const setMobilePosition = (left, top, save = false) => {
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
    if (save) {
      try { localStorage.setItem(mpSpectatorRailPositionKey, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch {}
    }
  };
  const restore = () => {
    if (!mobile.matches) {
      clearInlinePosition();
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(mpSpectatorRailPositionKey) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setMobilePosition(saved.x, saved.y, false);
    } catch {}
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
  const finish = event => {
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
$("#mpDisplayName").addEventListener("change", event => mpSetDisplayName(event.currentTarget.value));
$("#mpDisplayName").addEventListener("blur", event => mpSetDisplayName(event.currentTarget.value));
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
$("#mpStartGame").addEventListener("click", async () => {
  if (!mpRoomOwnerLocal() || !mpUiState.ready || !mpLobby.connected) return;
  mpLobbySend({ type: "start" });
});

function pickFile(accept) {
  const input = $("#fileInput"); input.accept = accept; input.multiple = false; input.value = "";
  return new Promise(resolve => {
    let settled = false;
    const finish = file => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.oncancel = null;
      resolve(file);
    };
    input.onchange = () => finish(input.files?.[0]);
    input.oncancel = () => finish();
    input.click();
  });
}

async function runAction(action) {
  try {
    if (action === "manage-replay") await manageReplays();
    else if (action.startsWith("export-")) await exportFiles(action.slice(7));
    else {
      const kind = action.slice(7);
      if (kind === "save" && !await askConfirmation({
        message: "导入将覆盖当前游戏已有的存档。",
        confirmText: "继续导入",
        tone: "danger"
      })) return;
      const file = await pickFile(kind === "replay" ? ".zip,.rpy,.rpyx" : ".dat");
      if (file) await importFile(kind, file);
    }
  } catch (error) { setPlayerStatus(error.message); setStatus(`错误：${error.message}`); showToast(`错误：${error.message}`); }
}

function touchLayoutControlIsVisible(name) {
  const element = touchLayoutElement(name);
  return !!element && !element.hidden && getComputedStyle(element).display !== "none";
}

function visibleTouchLayoutControlNames() {
  return Object.keys(touchLayoutControlMeta).filter(touchLayoutControlIsVisible);
}

function ensureVisibleTouchLayoutSelection() {
  if (!touchLayoutEditing || touchLayoutControlIsVisible(touchLayoutSelected)) return;
  const next = visibleTouchLayoutControlNames().find(name => name !== "escape") || visibleTouchLayoutControlNames()[0];
  if (next) touchLayoutSelected = next;
}

function updateTouchLayoutEditorUi() {
  ensureVisibleTouchLayoutSelection();
  if (touchLayoutEditing) ensureTouchLayoutDraftProfile();
  for (const name of Object.keys(touchLayoutControlMeta)) {
    touchLayoutElement(name).classList.toggle("touch-layout-selected", name === touchLayoutSelected);
  }
  const orientation = touchLayoutOrientation();
  const item = touchLayoutDraft?.profiles?.[orientation]?.controls?.[touchLayoutSelected];
  const scale = Math.round((item?.scale ?? 1) * 100);
  $("#touchLayoutScale").value = String(scale);
  $("#touchLayoutScaleValue").value = `${scale}%`;
  $("#touchLayoutOrientation").textContent = orientation === "landscape" ? "横屏" : "竖屏";
  $("#touchLayoutSelection").textContent = `选中了 ${touchLayoutControlMeta[touchLayoutSelected].title}`;
  updateTouchLayoutOrientationActionUi();
  updateTouchLayoutWarnings();
}

function selectTouchLayoutControl(name) {
  if (!touchLayoutControlMeta[name] || !touchLayoutControlIsVisible(name)) return;
  touchLayoutSelected = name;
  const profile = ensureTouchLayoutDraftProfile();
  const item = profile.controls[name];
  if (item) {
    item.priority = Math.max(-1, ...Object.values(profile.controls).map(control => Number.isFinite(control.priority) ? control.priority : -1)) + 1;
    normalizeTouchLayoutPriorityOrder(profile.controls);
    applyTouchLayout(touchLayoutDraft);
  }
  updateTouchLayoutEditorUi();
}

function touchLayoutSettingsElement() {
  return $("#touchLayoutSettingsDragHandle")?.closest(".touch-layout-settings") || null;
}

const touchLayoutWindowMargin = 16;
const touchLayoutWindowPositionsStorageKey = "eagler-touhou-touch-layout-window-positions-v1";

function emptyTouchLayoutWindowPositions() {
  return {
    version: 1,
    profiles: {
      landscape: { editor: null, settings: null },
      portrait: { editor: null, settings: null }
    }
  };
}

function normalizeTouchLayoutWindowPositions(value) {
  if (!value || value.version !== 1 || typeof value.profiles !== "object") return emptyTouchLayoutWindowPositions();
  const normalized = emptyTouchLayoutWindowPositions();
  for (const orientation of touchLayoutOrientations) {
    const source = value.profiles?.[orientation];
    if (!source || typeof source !== "object") continue;
    for (const kind of ["editor", "settings"]) {
      const item = source[kind];
      if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
      normalized.profiles[orientation][kind] = {
        x: Math.max(0, Math.min(1, item.x)),
        y: Math.max(0, Math.min(1, item.y))
      };
    }
  }
  return normalized;
}

function loadTouchLayoutWindowPositions() {
  try {
    return normalizeTouchLayoutWindowPositions(JSON.parse(localStorage.getItem(touchLayoutWindowPositionsStorageKey) || "null"));
  } catch {
    return emptyTouchLayoutWindowPositions();
  }
}

let touchLayoutWindowPositions = loadTouchLayoutWindowPositions();
let touchLayoutWindowOrientation = null;

function persistTouchLayoutWindowPositions() {
  try { localStorage.setItem(touchLayoutWindowPositionsStorageKey, JSON.stringify(touchLayoutWindowPositions)); } catch {}
}

function rememberTouchLayoutWindowsNow() {
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
  rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
}

function rememberTouchLayoutWindowPosition(kind, element) {
  if (!element || element.hidden) return;
  const host = player.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const rangeX = Math.max(0, host.width - rect.width - touchLayoutWindowMargin * 2);
  const rangeY = Math.max(0, host.height - rect.height - touchLayoutWindowMargin * 2);
  const left = Math.max(touchLayoutWindowMargin, Math.min(host.width - rect.width - touchLayoutWindowMargin, rect.left - host.left));
  const top = Math.max(touchLayoutWindowMargin, Math.min(host.height - rect.height - touchLayoutWindowMargin, rect.top - host.top));
  touchLayoutWindowPositions.profiles[touchLayoutOrientation()][kind] = {
    x: rangeX > 0 ? (left - touchLayoutWindowMargin) / rangeX : .5,
    y: rangeY > 0 ? (top - touchLayoutWindowMargin) / rangeY : .5
  };
  persistTouchLayoutWindowPositions();
}

function restoreTouchLayoutWindowPosition(kind, element) {
  const saved = touchLayoutWindowPositions.profiles[touchLayoutOrientation()]?.[kind];
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
  touchLayoutWindowPositions = loadTouchLayoutWindowPositions();
  positionTouchLayoutWindowsInitial();
  restoreTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
  restoreTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
  clampTouchLayoutEditorPosition();
  touchLayoutWindowOrientation = touchLayoutOrientation();
}

function clampTouchLayoutEditorPosition() {
  if (!touchLayoutEditing) return;
  const host = player.getBoundingClientRect();
  const clampPanel = element => {
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

function beginTouchLayoutEditorDrag(event) {
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

function moveTouchLayoutEditorDrag(event) {
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

function endTouchLayoutEditorDrag(event) {
  if (!touchLayoutEditorDrag || (event && event.pointerId !== touchLayoutEditorDrag.pointerId)) return;
  touchLayoutEditorDrag = null;
  rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));
}

function beginTouchLayoutSettingsDrag(event) {
  if (!touchLayoutEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const settings = touchLayoutSettingsElement();
  const host = player.getBoundingClientRect();
  const rect = settings.getBoundingClientRect();
  settings.style.right = "auto";
  settings.style.left = `${rect.left - host.left}px`;
  settings.style.top = `${rect.top - host.top}px`;
  touchLayoutSettingsDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function moveTouchLayoutSettingsDrag(event) {
  if (!touchLayoutSettingsDrag || event.pointerId !== touchLayoutSettingsDrag.pointerId) return;
  event.preventDefault();
  const settings = touchLayoutSettingsElement();
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

function endTouchLayoutSettingsDrag(event) {
  if (!touchLayoutSettingsDrag || (event && event.pointerId !== touchLayoutSettingsDrag.pointerId)) return;
  touchLayoutSettingsDrag = null;
  rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());
}

function updateTouchLayoutOrientationActionUi() {
  const switchButton = $("#touchLayoutOrientationHelpOpen");
  if (!switchButton) return;
  const target = touchLayoutOrientation() === "landscape" ? "竖屏" : "横屏";
  switchButton.textContent = `切换到${target}`;
}

async function switchTouchLayoutOrientation() {
  const target = touchLayoutOrientation() === "landscape" ? "portrait" : "landscape";
  const targetTitle = target === "landscape" ? "横屏" : "竖屏";
  try {
    rememberTouchLayoutWindowsNow();
    if (typeof screen.orientation?.lock !== "function") throw new Error("当前浏览器不支持网页方向锁定");
    if (!isPlayerFullscreen()) await enterPlayerFullscreen({ focusGame: false });
    await screen.orientation.lock(target);
    showToast(`已请求系统切换到${targetTitle}`);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    applyTouchLayout();
    if (touchLayoutEditing) {
      updateTouchLayoutEditorUi();
      applyTouchViewportDraftPosition();
      positionTouchLayoutWindows();
    }
    updatePlayerOrientationUi();
  } catch (error) {
    showToast("切换失败，请查看右上角问号菜单中的横竖屏说明。");
  }
}

function touchSensitivityPreviewBackgroundTarget(target) {
  if (!(target instanceof Element) || !player.contains(target)) return false;
  return !target.closest(".touch-layout-editor,.touch-layout-settings,[data-touch-layout-control],.touch-layout-orientation-help,.touch-help,.game-data-import-window,.game-data-link-window");
}

function resetTouchSensitivityPreviewPosition() {
  touchSensitivityPreview.style.left = "50%";
  touchSensitivityPreview.style.top = "50%";
}

function setTouchSensitivityPreviewOffset(dx, dy) {
  const rect = player.getBoundingClientRect();
  const clampedX = Math.max(0, Math.min(rect.width, rect.width / 2 + dx));
  const clampedY = Math.max(0, Math.min(rect.height, rect.height / 2 + dy));
  touchSensitivityPreview.style.left = `${clampedX}px`;
  touchSensitivityPreview.style.top = `${clampedY}px`;
}

function beginTouchSensitivityPreview(event) {
  if (!touchLayoutEditing || touchViewportEditing || touchSensitivityPreviewGesture || touchMovementUsesJoystick(state.options.touchMovementMode) ||
      !touchSensitivityPreviewBackgroundTarget(event.target) || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  touchSensitivityPreviewGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  resetTouchSensitivityPreviewPosition();
  touchSensitivityPreview.classList.add("active");
  try { player.setPointerCapture(event.pointerId); } catch {}
}

function moveTouchSensitivityPreview(event) {
  const gesture = touchSensitivityPreviewGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  event.preventDefault();
  const gain = Math.min(300, Math.max(50, state.options.touchSensitivity)) / 100;
  setTouchSensitivityPreviewOffset((event.clientX - gesture.startX) * gain, (event.clientY - gesture.startY) * gain);
}

function endTouchSensitivityPreview(event) {
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
  if (state.launched) throw new Error("请先退出正在运行的游戏，再编辑触控布局");
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
  player.style.setProperty("--touch-preview-image", `url("assets/${state.game}-title00.jpg")`);
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview", "touch-layout-edit");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = true;
  $("#touchLayoutEditor").hidden = false;
  touchLayoutSettingsElement().hidden = false;
  render();
  const wasFullscreen = isPlayerFullscreen();
  try {
    await enterPlayerFullscreen({ focusGame: false });
    touchLayoutEditorEnteredFullscreen = !wasFullscreen && isPlayerFullscreen();
  } catch (error) {
    touchLayoutEditorEnteredFullscreen = false;
    showToast(`浏览器阻止自动全屏：${error.message}`);
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
  setStatus("触控布局编辑：拖动按键调整位置，滑杆或右下角按钮调整大小");
}

function saveTouchLayoutEditor() {
  if (!touchLayoutEditing) return;
  rememberTouchLayoutWindowsNow();
  persistTouchLayout(touchLayoutDraft);
  touchLayoutDraft = cloneTouchLayout(touchLayout) || emptyTouchLayout();
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  applyTouchViewportDraftPosition();
  setStatus(touchLayout ? "已保存跨游戏触控布局" : "已保存默认触控布局");
  showToast("保存成功：触控布局已保存");
}

async function closeTouchLayoutEditor() {
  if (touchViewportEditing) finishTouchViewportEditing();
  if (touchLayoutHasUnsavedChanges() && !await askConfirmation({
    message: "退出将丢弃当前未保存的触控布局修改。",
    confirmText: "放弃修改",
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
  touchLayoutSettingsElement().hidden = true;
  player.classList.remove("touch-layout-edit", "touch-preview", "open");
  for (const name of Object.keys(touchLayoutControlMeta)) touchLayoutElement(name).classList.remove("touch-layout-selected");
  player.style.removeProperty("--touch-preview-image");
  player.setAttribute("aria-hidden", "true");
  document.body.classList.remove("player-active");
  resetTouchLayoutEditorPosition();
  if (touchLayoutEditorEnteredFullscreen && isPlayerFullscreen()) await document.exitFullscreen().catch(() => {});
  touchLayoutEditorEnteredFullscreen = false;
  touchLayoutWindowOrientation = null;
  render();
  setStatus("已退出触控布局编辑");
}

function rectOverlapRatio(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (!width || !height) return 0;
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function updateTouchLayoutWarnings() {
  if (!touchLayoutEditing) return;
  const warning = $("#touchLayoutWarning");
  const names = visibleTouchLayoutControlNames();
  const issues = [];
  for (const name of Object.keys(touchLayoutControlMeta)) touchLayoutElement(name).classList.remove("touch-layout-collision");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = touchLayoutElement(names[i]);
      const b = touchLayoutElement(names[j]);
      if (rectOverlapRatio(a.getBoundingClientRect(), b.getBoundingClientRect()) >= .28) {
        a.classList.add("touch-layout-collision");
        b.classList.add("touch-layout-collision");
        issues.push(`${touchLayoutControlMeta[names[i]].title} 与 ${touchLayoutControlMeta[names[j]].title} 重叠较多`);
      }
    }
  }
  const reserved = $("#touchLayoutReservedZone").getBoundingClientRect();
  for (const name of names) {
    const element = touchLayoutElement(name);
    if (rectOverlapRatio(element.getBoundingClientRect(), reserved) >= .18) {
      element.classList.add("touch-layout-collision");
      issues.push(`${touchLayoutControlMeta[name].title} 靠近帮助 / 全屏按钮区域`);
    }
  }
  const unique = [...new Set(issues)];
  warning.hidden = unique.length === 0;
  warning.textContent = unique.length ? `提示：${unique.join("；")}。仍可保存，但实机可能容易误触。` : "";
}

function moveTouchLayoutItem(name, dx, dy) {
  const profile = ensureTouchLayoutDraftProfile();
  const safe = touchLayoutSafeZone.getBoundingClientRect();
  if (!safe.width || !safe.height) return;
  const item = profile.controls[name];
  item.x += dx / safe.width;
  item.y += dy / safe.height;
  const position = effectiveTouchLayoutPosition(touchLayoutElement(name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutWarnings();
}

function scaleTouchLayoutItem(name, scale) {
  const profile = ensureTouchLayoutDraftProfile();
  const item = profile.controls[name];
  item.scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, scale));
  const position = effectiveTouchLayoutPosition(touchLayoutElement(name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
}

function beginTouchLayoutDrag(name, event) {
  if (!touchLayoutEditing || !touchLayoutControlMeta[name] || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const profile = ensureTouchLayoutDraftProfile();
  applyTouchLayout(touchLayoutDraft);
  selectTouchLayoutControl(name);
  const element = touchLayoutElement(name);
  const rect = element.getBoundingClientRect();
  touchLayoutDrag = event.target.closest?.(".touch-layout-resize-handle") ? {
    kind: "resize", name, pointerId: event.pointerId,
    anchorX: rect.left, anchorY: rect.top,
    baseWidth: Math.max(1, rect.width), baseHeight: Math.max(1, rect.height),
    startScale: profile.controls[name].scale
  } : { kind: "move", name, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function resizeTouchLayoutItem(drag, event) {
  const profile = ensureTouchLayoutDraftProfile();
  const safe = touchLayoutSafeZone.getBoundingClientRect();
  if (!safe.width || !safe.height) return;
  const vx = event.clientX - drag.anchorX;
  const vy = event.clientY - drag.anchorY;
  const projection = (vx * drag.baseWidth + vy * drag.baseHeight) /
    (drag.baseWidth * drag.baseWidth + drag.baseHeight * drag.baseHeight);
  const scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, drag.startScale * Math.max(.05, projection)));
  const factor = scale / drag.startScale;
  const item = profile.controls[drag.name];
  item.scale = scale;
  item.x = (drag.anchorX + drag.baseWidth * factor / 2 - safe.left) / safe.width;
  item.y = (drag.anchorY + drag.baseHeight * factor / 2 - safe.top) / safe.height;
  const position = effectiveTouchLayoutPosition(touchLayoutElement(drag.name), item);
  item.x = position.x;
  item.y = position.y;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
}

function moveTouchLayoutDrag(event) {
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

function endTouchLayoutDrag(event) {
  if (!touchLayoutDrag || (event && event.pointerId !== touchLayoutDrag.pointerId)) return;
  touchLayoutDrag = null;
}

function applyTouchViewportDraftPosition() {
  gameZoomState.scale = 1;
  gameZoomState.x = 0;
  gameZoomState.y = 0;
  gameZoomState.pointers.clear();
  gameZoomState.pinch = null;
  applyGameZoomTransform(1, 0, 0);
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
  touchLayoutSettingsElement().hidden = true;
  $("#touchViewportDragSurface").hidden = false;
  $("#touchViewportDone").hidden = false;
  touchSensitivityPreview.hidden = true;
  applyTouchViewportDraftPosition();
  setStatus("调整游戏画面位置：左右拖动画面，完成后返回按键布局");
}

function finishTouchViewportEditing() {
  if (!touchViewportEditing) return;
  touchViewportEditing = false;
  touchViewportDrag = null;
  player.classList.remove("touch-viewport-edit");
  $("#touchViewportDragSurface").hidden = true;
  $("#touchViewportDone").hidden = true;
  $("#touchLayoutEditor").hidden = false;
  touchLayoutSettingsElement().hidden = false;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  applyTouchViewportDraftPosition();
  positionTouchLayoutWindows();
  setStatus("触控布局编辑：拖动按键调整位置，滑杆或右下角按钮调整大小");
}

function resetTouchViewportPosition() {
  if (!touchLayoutEditing) return;
  const profile = ensureTouchLayoutDraftProfile();
  profile.viewport = { x: 0 };
  applyTouchViewportDraftPosition();
  const orientationTitle = touchLayoutOrientation() === "landscape" ? "横屏" : "竖屏";
  showToast(`已恢复${orientationTitle}游戏画面默认位置，保存后生效`);
}

function beginTouchViewportDrag(event) {
  if (!touchViewportEditing || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  touchViewportDrag = { pointerId: event.pointerId, x: event.clientX };
  try { $("#touchViewportDragSurface").setPointerCapture(event.pointerId); } catch {}
}

function moveTouchViewportDrag(event) {
  if (!touchViewportEditing || !touchViewportDrag || event.pointerId !== touchViewportDrag.pointerId) return;
  event.preventDefault();
  const width = Math.max(1, player.clientWidth);
  const profile = ensureTouchLayoutDraftProfile();
  const dx = event.clientX - touchViewportDrag.x;
  touchViewportDrag.x = event.clientX;
  profile.viewport.x = Math.max(-.5, Math.min(.5, profile.viewport.x + dx / width));
  applyTouchViewportDraftPosition();
}

function endTouchViewportDrag(event) {
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
  { label: "灵梦 A", glyph: "霊", character: 0, shot: 0 }, { label: "灵梦 B", glyph: "霊", character: 0, shot: 1 },
  { label: "魔理沙 A", glyph: "魔", character: 1, shot: 0 }, { label: "魔理沙 B", glyph: "魔", character: 1, shot: 1 },
  { label: "咲夜 A", glyph: "咲", character: 2, shot: 0 }, { label: "咲夜 B", glyph: "咲", character: 2, shot: 1 },
]);
const mpBootstrapLoadoutIndexes = Object.freeze([0, 2, 4]);
const mpLoadoutCount = () => state.game === "th06" ? 4 : mpLoadouts.length;
const mpNormalizeLoadoutIndex = index => {
  const count = mpLoadoutCount();
  const numeric = Number.isInteger(Number(index)) ? Number(index) : 0;
  return (numeric % count + count) % count;
};

function mpRoomOwnerLocal() { return mpUiState.room?.synced === true && mpUiState.seat === 0; }

function mpSetFold(name, open) {
  if (!Object.hasOwn(mpUiState.folds, name)) return;
  mpUiState.folds[name] = !!open;
  const head = document.querySelector(`[data-mp-fold="${name}"]`);
  const body = document.querySelector(`[data-mp-fold-body="${name}"]`);
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

function mpRefreshFoldHeight(name) {
  if (!mpUiState.folds[name]) return;
  const body = document.querySelector(`[data-mp-fold-body="${name}"]`);
  if (!body) return;
  requestAnimationFrame(() => {
    let height = body.scrollHeight;
    const nested = body.querySelector(".mobile-options.open .mobile-options-body");
    if (nested) height += Math.max(0, nested.scrollHeight - nested.clientHeight);
    body.style.setProperty("--mp-fold-height", `${height + 12}px`);
  });
}

function mpGenerateRoomCode() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1); crypto.getRandomValues(value);
    return String(1000 + value[0] % 9000);
  }
  return String(1000 + Math.floor(Math.random() * 9000));
}

function mpNormalizeRoomCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function mpSyncRoomUrl(code, push = false) {
  const url = new URL(location.href);
  if (code) {
    url.searchParams.set(mpRoomUrlKey, code);
    url.searchParams.set("game", state.product);
  }
  else url.searchParams.delete(mpRoomUrlKey);
  const nextState = { ...(history.state || {}), [mpRoomHistoryKey]: code || false };
  if (push) history.pushState(nextState, "", url.href);
  else history.replaceState(nextState, "", url.href);
}

function mpPersistRoomState() {
  if (!mpUiState.room) return;
  try {
    sessionStorage.setItem(mpRoomSessionKeyForProduct(state.product), JSON.stringify({
      product: state.product,
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
    }));
  } catch {}
}

function mpClearPersistedRoom() {
  try { sessionStorage.removeItem(mpRoomSessionKeyForProduct(state.product)); } catch {}
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
  if (!history.state?.[mpRoomHistoryKey]) {
    const roomUrl = new URL(location.href);
    const homeState = launcherHomeHistoryState();
    history.replaceState(homeState, "", launcherHomeUrl(roomUrl));
    history.pushState({ ...homeState, [mpRoomHistoryKey]: code }, "", roomUrl);
  }
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(mpRoomSessionKeyForProduct(routedProduct)) || "null"); } catch {}
  const sameRoom = saved?.room?.code === code && (!saved.product || saved.product === routedProduct);
  const playerCount = sameRoom && Number(saved.room.playerCount) === 3 ? 3 : 2;
  const difficultyMax = mpDifficultyMax(gameFromProduct(routedProduct));
  const difficulty = sameRoom ? Math.max(0, Math.min(difficultyMax, Number(saved.room.difficulty) || 0)) : 1;
  const seat = sameRoom && Number.isInteger(saved.seat) && saved.seat >= 0 && saved.seat < playerCount ? saved.seat : null;
  mpUiState.room = {
    code, playerCount, difficulty, created: sameRoom && !!saved.room.created,
    seats: null, synced: false, connection: "connecting",
  };
  mpUiState.seat = seat;
  mpUiState.ready = sameRoom && !!saved.ready;
  mpUiState.spectatorRequested = seat == null && sameRoom && !!saved.spectatorRequested;
  mpUiState.roomSettingsOpen = sameRoom && !!saved.roomSettingsOpen;
  state.product = routedProduct;
  state.game = gameFromProduct(routedProduct);
  state.runtimeVariant = "multiplayer";
  state.hasSelection = true;
  restoreMpProductPreferences(routedProduct);
  restoreGamePreferences(state.game, currentPreferenceId());
  return true;
}

function mpEnterRoom(code, created) {
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
  setStatus(created ? `已创建房间 ${code}` : `已加入房间 ${code}`);
}

function mpResetRoomState() {
  mpDisconnectLobby();
  mpLobby.startSerial = 0;
  mpUiState.room = null;
  mpUiState.seat = null;
  mpUiState.ready = false;
  mpUiState.spectatorRequested = false;
  mpUiState.roomSettingsOpen = false;
  try { sessionStorage.removeItem(mpRoomSessionKeyForProduct(state.product)); } catch {}
}

function mpLeaveRoom(fromHistory = false) {
  mpResetRoomState();
  if (!fromHistory) replaceLauncherHomeHistory();
  showLauncherHome();
  setStatus("已离开联机房间");
}

function mpAnimateLocalPlayerMove(before) {
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

function mpTakeSeat(index) {
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
  if (!room || (!spectator && (!Number.isInteger(seat) || seat < 0 || seat >= room.playerCount)))
    throw new Error("房间状态无效");
  let relay;
  try { relay = new URL(state.netplay.url); }
  catch { throw new Error("Relay WebSocket URL 无效"); }
  if (!/^wss?:$/.test(relay.protocol)) throw new Error("Relay 必须使用 ws:// 或 wss://");
  relay.searchParams.set("room", mpTransportRoomId(room.code));
  if (spectator) {
    relay.searchParams.delete("player");
    relay.searchParams.set("spectator", mpLobby.clientId);
  } else {
    relay.searchParams.delete("spectator");
    relay.searchParams.set("player", String(seat));
  }
  relay.searchParams.set("run", String(Math.max(0, Number(mpLobby.startSerial) || 0)));

  state.product = multiplayerProductForGame(state.game);
  state.runtimeVariant = "multiplayer";
  state.replayViewer = false;
  state.netplay.url = relay.href;
  state.netplay.player = spectator ? 0 : seat;
  state.netplay.playerCount = room.playerCount;
  state.netplay.spectator = spectator;
  state.netplay.spectatorId = spectator ? mpLobby.clientId : "";
  state.netplay.spectatorCount = Math.max(0, Number(room.spectatorCount) || 0);
  state.netplay.seed = Number.parseInt(room.code, 10) & 0xffff;
  state.netplay.difficulty = Math.max(0, Math.min(mpDifficultyMax(), Number(room.difficulty) || 0));
  state.netplay.loadouts = Array.from({ length: 3 }, (_, playerIndex) => {
    const loadoutIndex = mpNormalizeLoadoutIndex(room.seats?.[playerIndex]?.loadout ?? mpBootstrapLoadoutIndexes[playerIndex]);
    const loadout = mpLoadouts[loadoutIndex];
    return { character: loadout.character, shot: loadout.shot };
  });
}

function mpSetDisplayName(value) {
  if (mpDisplayNameLocked()) {
    const input = $("#mpDisplayName");
    if (input && input.value !== mpUiState.displayName) input.value = mpUiState.displayName;
    renderMpRoom();
    return;
  }
  const name = mpNormalizeDisplayName(value);
  if (!mpStoreDisplayNameOnce(name)) return;
  const input = $("#mpDisplayName");
  if (input) input.value = name;
  if (mpLobby.connected && mpUiState.room?.synced && (mpUiState.seat != null || mpUiState.spectatorRequested))
    mpLobbySend({ type: "set-name", name });
  renderMpRoom();
}

function mpSetLoadout(delta) {
  const count = mpLoadoutCount();
  mpUiState.preferredLoadout = (mpNormalizeLoadoutIndex(mpUiState.preferredLoadout) + delta + count) % count;
  try { localStorage.setItem(mpLoadoutPreferenceKeyForProduct(state.product), String(mpUiState.preferredLoadout)); } catch {}
  if (mpUiState.seat != null) mpLobbySend({ type: "set-loadout", loadout: mpUiState.preferredLoadout });
  renderMpRoom();
}

function renderMpRoom() {
  const room = mpUiState.room;
  if (!room) return;
  const roomReady = room.synced === true && mpLobby.connected;
  const ownerLocal = mpRoomOwnerLocal();
  mpUiState.preferredLoadout = mpNormalizeLoadoutIndex(mpUiState.preferredLoadout);
  const loadout = mpLoadouts[mpUiState.preferredLoadout];
  const difficultyLabels = ["Easy", "Normal", "Hard", "Lunatic", "Extra", "Phantasm"];
  $("#mpRoomTitle").textContent = game().title;
  $("#mpRoomView").setAttribute("aria-label", `${state.game.toUpperCase()} 联机房间`);
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
  $("#mpRoomSettingsHint").textContent = ownerLocal
    ? "你当前坐在 P1，可以修改房间设置。修改设置不会取消其他玩家的准备状态。"
    : "只有当前 P1 可以修改房间设置。P1 空缺时任何玩家都可以坐上去成为房主。";
  $("#mpOwnerStatus").textContent = !room.synced
    ? "正在同步房间成员"
    : !mpLobby.connected
      ? "连接中断 - 正在自动重连"
      : ownerLocal ? "你是当前房主 - P1" : "P1 空缺时可直接入座成为房主";

  document.querySelectorAll("[data-mp-player-count]").forEach(button => {
    const selected = Number(button.dataset.mpPlayerCount) === room.playerCount;
    button.classList.toggle("selected", selected);
    button.disabled = !roomReady || !ownerLocal || selected;
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-mp-difficulty]").forEach(button => {
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

  document.querySelectorAll("[data-mp-seat]").forEach(seat => {
    const index = Number(seat.dataset.mpSeat);
    const active = index < room.playerCount;
    const networkSeat = room.synced ? room.seats?.[index] || null : null;
    const occupied = room.synced && (!!networkSeat || mpUiState.seat === index);
    seat.hidden = !active;
    seat.classList.toggle("occupied", occupied);
    seat.classList.toggle("owner", index === 0 && ownerLocal);
    seat.classList.toggle("reconnecting", !!networkSeat?.offline);
    seat.title = networkSeat?.offline ? "该玩家连接中断，正在等待重连" : "";
    const drop = seat.querySelector("[data-mp-seat-drop]");
    const button = drop?.querySelector("button");
    const glyph = seat.querySelector("[data-mp-seat-glyph]");
    const me = seat.querySelector("[data-mp-seat-me]");
    if (drop) drop.hidden = occupied;
    if (glyph) {
      glyph.hidden = !occupied;
      const seatLoadout = networkSeat ? mpLoadouts[mpNormalizeLoadoutIndex(networkSeat.loadout)] : loadout;
      const seatName = networkSeat?.name || (mpUiState.seat === index ? mpUiState.displayName : "");
      glyph.textContent = mpDisplayInitial(seatName, seatLoadout?.glyph || loadout.glyph);
      seat.title = seatName ? `${seatName} - ${seatLoadout?.label || loadout.label}` : (seatLoadout?.label || loadout.label);
      let loadoutLabel = seat.querySelector(".mp-seat-loadout");
      if (!loadoutLabel) {
        loadoutLabel = document.createElement("span");
        loadoutLabel.className = "mp-seat-loadout";
        seat.append(loadoutLabel);
      }
      loadoutLabel.hidden = !occupied;
      loadoutLabel.textContent = seatLoadout?.label || loadout.label;
    }
    if (me) me.hidden = mpUiState.seat !== index;
    if (button) {
      button.disabled = !roomReady || !active || occupied;
      button.textContent = "加入";
    }
  });

  const playerCard = $("#mpLocalPlayer");
  if (!room.synced || mpUiState.seat == null) {
    playerCard.hidden = true;
  } else {
    playerCard.hidden = false;
    $("#mpLocalRoleLabel").textContent = loadout.label;
  }

  $("#mpLocalLoadoutLabel").textContent = loadout.label;
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
    marker.textContent = entry.clientId === mpLobby.clientId ? "我" : "";
    row.title = entry.name || "未命名旁观者";
    row.append(avatar, marker);
    spectatorList.append(row);
  }
  if (!spectatorEntries.length) {
    const empty = document.createElement("div");
    empty.className = "mp-spectator-empty";
    empty.textContent = "暂无旁观";
    spectatorList.append(empty);
  }
  const spectatorJoin = $("#mpSpectatorJoin");
  spectatorJoin.disabled = !roomReady || mpUiState.seat != null;
  spectatorJoin.textContent = mpUiState.spectatorRequested ? "离开旁观" : "加入旁观";

  const nameInput = $("#mpDisplayName");
  if (nameInput) {
    if (document.activeElement !== nameInput) nameInput.value = mpUiState.displayName;
    const locked = mpDisplayNameLocked();
    const editor = $("#mpNameEditor");
    if (editor) editor.hidden = locked;
    nameInput.disabled = false;
    nameInput.title = locked ? "" : "昵称只能设置一次，保存后不可修改";
  }

  const spectator = $("#mpUnseatedNote");
  spectator.hidden = room.synced && mpUiState.seat != null;
  spectator.querySelector(".mp-spectator-title").textContent = !room.synced
    ? "连接房间中" : mpUiState.spectatorRequested ? "旁观席" : "未入座";
  spectator.querySelector(".mp-spectator-hint").textContent = !room.synced
    ? "正在同步成员状态"
    : mpUiState.spectatorRequested
      ? "等待本局开始；开局后短时间内仍可加入当前旁观流"
      : "选择 P 位加入游戏，或主动进入旁观席";
  spectator.querySelector(".mp-spectator-loadout").hidden = !room.synced || mpUiState.spectatorRequested;
  document.querySelector("#mpRoomView .mp-room-footer").hidden = !room.synced || mpUiState.seat == null;
  const ready = $("#mpReady");
  ready.hidden = mpUiState.seat == null;
  ready.disabled = !roomReady || mpUiState.seat == null;
  ready.classList.toggle("ready", mpUiState.ready && mpUiState.seat != null);
  ready.textContent = mpUiState.ready && mpUiState.seat != null ? "已准备" : "准备";
  const start = $("#mpStartGame");
  const synchronizedReady = roomReady && Array.isArray(room.seats) &&
    room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
  start.hidden = !ownerLocal;
  start.disabled = !roomReady || (ownerLocal && !synchronizedReady);
  start.textContent = !synchronizedReady ? "等待准备" : "开始游戏";
  mpPersistRoomState();
}

document.querySelectorAll(".game").forEach(card => {
  card.addEventListener("click", () => {
    if (mpUiState.room) return;
    const mobileLite = matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)").matches || state.lessMotion;
    const main = $("#main");
    const product = card.dataset.product || card.dataset.game;
    const changed = state.product !== product;
    if (changed) {
      state.game = card.dataset.game;
      state.product = product;
      state.runtimeVariant = isMultiplayerProduct(product) ? "multiplayer" : "normal";
      restoreMpProductPreferences(product);
      restoreGamePreferences(state.game, currentPreferenceId());
      resetRuntime();
    }
    state.hasSelection = true;
    render();
    setStatus(changed ? `已切换至 ${productTitle(product)}` : `已选择 ${productTitle(product)}`);
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
      if (state.lessMotion) return;
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
  const value = event.target.value;
  if (!available.some(entry => entry.id === value) || state.language === value) return;
  state.language = value;
  saveGamePreferences();
  resetRuntime();
  render();
  setStatus(`已选择${entryTitle(languageEntry())}`);
});
$("#musicSelect").addEventListener("change", event => {
  const value = event.target.value;
  if (!webAudioAvailable && value !== "none") {
    state.music = "none";
    event.target.value = "none";
    showToast("当前浏览器不支持 Web Audio，已切换为无音乐模式");
    setStatus("音乐：无");
    return;
  }
  if (!musicModes.has(value) || state.music === value) return;
  state.music = value;
  state.musicPreferenceExplicit = true;
  saveGamePreferences();
  resetRuntime();
  render();
  setStatus(`音乐：${musicModeLabel(state.music)}`);
});
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => runAction(button.dataset.action)));
$("#mobileOptionsToggle").addEventListener("click", () => { state.mobileOpen = !state.mobileOpen; render(); });
$("#touchLayoutEdit").addEventListener("click", () => { void openTouchLayoutEditor().catch(error => { showToast(error.message); setStatus(`错误：${error.message}`); }); });
$("#touchLayoutScale").addEventListener("input", event => {
  if (!touchLayoutEditing) return;
  const scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, Number(event.target.value) / 100));
  scaleTouchLayoutItem(touchLayoutSelected, scale);
});
$("#touchLayoutOrientationHelpOpen").addEventListener("click", () => { if (touchLayoutEditing) void switchTouchLayoutOrientation(); });
$("#touchViewportAdjust").addEventListener("click", startTouchViewportEditing);
$("#touchViewportReset").addEventListener("click", resetTouchViewportPosition);
$("#touchViewportDone").addEventListener("click", finishTouchViewportEditing);
$("#touchLayoutReset").addEventListener("click", async () => {
  if (!touchLayoutEditing) return;
  const orientationTitle = touchLayoutOrientation() === "landscape" ? "横屏" : "竖屏";
  if (!await askConfirmation({
    message: `当前${orientationTitle}布局中的未保存调整将被清除。`,
    confirmText: "恢复默认",
    tone: "danger"
  })) return;
  if (!touchLayoutDraft) touchLayoutDraft = emptyTouchLayout();
  touchLayoutDraft.profiles[touchLayoutOrientation()] = null;
  applyTouchLayout(touchLayoutDraft);
  updateTouchLayoutEditorUi();
  showToast(`已恢复${orientationTitle}默认布局，保存后生效`);
});
$("#touchLayoutSave").addEventListener("click", saveTouchLayoutEditor);
$("#touchLayoutExit").addEventListener("click", () => { if (touchLayoutEditing) void closeTouchLayoutEditor(); });
$("#thpracToggle").addEventListener("click", () => setOption("thpracEnabled", !state.options.thpracEnabled));
$("#magnifierToggle").addEventListener("click", () => setOption("magnifierEnabled", !state.options.magnifierEnabled));
$("#frameLimitToggle").addEventListener("click", () => setOption("frameLimit60Enabled", !state.options.frameLimit60Enabled));
$("#changelogOpen").addEventListener("click", () => { void showChangelog(false); });
$("#lessMotionToggle").addEventListener("click", () => {
  state.lessMotion = !state.lessMotion;
  try { localStorage.setItem(lessMotionStorageKey, state.lessMotion ? "1" : "0"); } catch {}
  if (state.lessMotion) document.querySelectorAll(".game").forEach(card => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  });
  render();
});
$("#changelogClose").addEventListener("click", closeChangelog);
$("#changelogConfirm").addEventListener("click", closeChangelog);
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
$("#siteNoticeClose").addEventListener("click", closeSiteNotice);
document.addEventListener("scroll", handleSiteNoticeScroll, { capture: true, passive: true });
$("#th06HitboxToggle").addEventListener("click", () => setOption("th06FocusHitbox", !state.options.th06FocusHitbox));
$("#touchToggle").addEventListener("click", async () => {
  const enabling = !state.options.touchEnabled;
  if (enabling && !await confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;
  setOption("touchEnabled", enabling);
});
$("#touchMovementMode").addEventListener("change", async event => {
  const value = event.target.value;
  if (!touchMovementModes.has(value)) { render(); return; }
  if (value !== state.options.touchMovementMode && !await confirmTouchModeBeforeEnable(value)) { render(); return; }
  setOption("touchMovementMode", value);
});
document.querySelectorAll("[data-touch-sensitivity-preset]").forEach(button => button.addEventListener("click", () => {
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
  const value = Math.min(300, Math.max(50, Math.round(Number(event.target.value) || 100)));
  touchSensitivityCustomOpen = true;
  state.options.touchSensitivity = value;
  $("#touchSensitivityValue").textContent = `${value}%`;
  queueTouchControlsSync();
});
$("#touchSensitivity").addEventListener("change", () => saveGamePreferences());
$("#touchFocusMode").addEventListener("change", event => {
  const value = event.target.value;
  if (touchFocusModes.has(value)) setOption("touchFocusMode", value);
});
$("#doubleTapBombToggle").addEventListener("click", () => setOption("doubleTapBombEnabled", !state.options.doubleTapBombEnabled));
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
  if (event.currentTarget.dataset.confirmOnEnter === "true") $("#decisionConfirm").click();
});
document.querySelector("#decisionDialog .decision-window").addEventListener("submit", event => {
  event.preventDefault();
  closeDecisionDialog(["confirm", "secondary"].includes(event.submitter?.value) ? event.submitter.value : "cancel");
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
  resolve?.(["confirm", "secondary"].includes(event.currentTarget.returnValue) ? event.currentTarget.returnValue : "cancel");
  if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
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
const directTouchPointers = new Map();
let nextDirectTouchId = -1000000;
let directTouchFrameRect = null;

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

function directTouchFramePoint(event, forceRect = false) {
  const rect = currentDirectTouchFrameRect(forceRect);
  if (!rect) return null;
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function postDirectTouch(type, touch) {
  if (!state.launched || !state.ready || !frame.contentWindow || !touch) return false;
  frame.contentWindow.postMessage({
    protocol,
    game: state.game,
    command: "direct-touch",
    type,
    id: touch.id,
    x: touch.x,
    y: touch.y,
  }, location.origin);
  return true;
}

function cancelDirectTouches(notifyRuntime = true) {
  if (!directTouchPointers.size) return;
  directTouchPointers.clear();
  invalidateDirectTouchFrameRect();
  if (notifyRuntime && state.launched && state.ready && frame.contentWindow) {
    frame.contentWindow.postMessage({ protocol, game: state.game, command: "touch-cancel" }, location.origin);
  }
}

touchDirectSurface.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" || touchDirectSurface.hidden || directTouchPointers.has(event.pointerId)) return;
  const point = directTouchFramePoint(event, directTouchPointers.size === 0 || gameZoomState.active);
  if (!point) return;
  event.preventDefault();
  const touch = { id: nextDirectTouchId--, ...point };
  directTouchPointers.set(event.pointerId, touch);
  if (gameZoomState.active) beginGameZoomPointer(event);
  postDirectTouch("down", touch);
});

touchDirectSurface.addEventListener("pointermove", event => {
  const touch = directTouchPointers.get(event.pointerId);
  if (!touch) return;
  // The game iframe geometry is stable throughout normal gameplay. Re-reading
  // getBoundingClientRect() for every high-rate pointermove can force layout on
  // mobile browsers, so reuse the gesture-local rect. Zoom editing is the one
  // path that intentionally changes the frame transform during the gesture.
  const point = directTouchFramePoint(event, gameZoomState.active);
  if (!point) return;
  event.preventDefault();
  touch.x = point.x;
  touch.y = point.y;
  if (gameZoomState.active) moveGameZoomPointer(event);
  postDirectTouch("move", touch);
});

const releaseDirectTouch = event => {
  const touch = directTouchPointers.get(event.pointerId);
  if (!touch) return;
  event.preventDefault?.();
  const point = Number.isFinite(event.clientX) ? directTouchFramePoint(event, gameZoomState.active) : null;
  if (point) { touch.x = point.x; touch.y = point.y; }
  directTouchPointers.delete(event.pointerId);
  if (gameZoomState.active) endGameZoomPointer(event);
  postDirectTouch("up", touch);
  if (!directTouchPointers.size) invalidateDirectTouchFrameRect();
};
touchDirectSurface.addEventListener("pointerup", releaseDirectTouch);
touchDirectSurface.addEventListener("pointercancel", releaseDirectTouch);
touchDirectSurface.addEventListener("lostpointercapture", releaseDirectTouch);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cancelDirectTouches(true);
});
window.addEventListener("blur", () => cancelDirectTouches(true));
window.addEventListener("resize", invalidateDirectTouchFrameRect, { passive: true });
window.visualViewport?.addEventListener("resize", invalidateDirectTouchFrameRect, { passive: true });
document.addEventListener("fullscreenchange", invalidateDirectTouchFrameRect);
document.addEventListener("webkitfullscreenchange", invalidateDirectTouchFrameRect);

function setTouchFocus(value) {
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
  if (!state.launched || state.options.touchFocusMode === "two-finger") return;
  event.preventDefault();
  try { touchFocusButton.setPointerCapture(event.pointerId); } catch {}
  if (state.options.touchFocusMode === "hold-button") void setTouchFocus(true);
  else void setTouchFocus(!touchControls.focusEnabled);
});
const releaseHeldTouchFocus = event => {
  if (state.options.touchFocusMode !== "hold-button") return;
  event?.preventDefault?.();
  void setTouchFocus(false);
};
touchFocusButton.addEventListener("pointerup", releaseHeldTouchFocus);
touchFocusButton.addEventListener("pointercancel", releaseHeldTouchFocus);
touchFocusButton.addEventListener("lostpointercapture", releaseHeldTouchFocus);
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

function postHostedKey(spec, down) {
  if (!state.launched || !frame.contentWindow) return;
  frame.contentWindow.postMessage({
    protocol, game: state.game, command: "keyboard", down,
    code: spec.code, key: spec.key, keyCode: spec.keyCode, location: 0
  }, location.origin);
}

function pulseThpracKey(name) {
  if (!thpracTouchControlsAvailable() || !state.launched) return;
  const spec = thpracKeySpecs[name];
  if (!spec) return;
  postHostedKey(spec, true);
  // OverlayKeyPressed samples at the fixed trainer tick. Hold the synthetic
  // key long enough to span several 60 Hz boundaries, then release it.
  setTimeout(() => postHostedKey(spec, false), 70);
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
document.querySelectorAll("[data-thprac-key]").forEach(button => {
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

for (const [button, activate] of [[$("#touchFire"), toggleTouchFire], [$("#touchBomb"), triggerTouchBomb], [$("#touchEscape"), triggerTouchEscape]]) {
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
let touchJoystickPointerId = null;
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
function updateTouchJoystick(event) {
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
const releaseTouchJoystick = event => {
  if (event.pointerId !== touchJoystickPointerId) return;
  event.preventDefault();
  resetTouchJoystick(true);
};
touchJoystick.addEventListener("pointerup", releaseTouchJoystick);
touchJoystick.addEventListener("pointercancel", releaseTouchJoystick);
touchJoystick.addEventListener("lostpointercapture", releaseTouchJoystick);

for (const name of Object.keys(touchLayoutControlMeta)) {
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
  else if (state.launched) applyGameZoomTransform();
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
document.querySelectorAll("[data-guide-tab]").forEach(tab => tab.addEventListener("click", () => {
  if (tab.getAttribute("aria-expanded") === "true") collapseTouchGuides();
  else playTouchGuide(tab.dataset.guideTab);
}));
document.querySelectorAll(".guide-replay").forEach(button => button.addEventListener("click", () => playTouchGuide(button.closest("[data-guide-panel]").dataset.guidePanel)));
$("#touchHelpOpen").addEventListener("click", () => { collapseTouchGuides(); $("#touchHelp").hidden = false; player.classList.add("help-visible"); });
$("#touchHelpClose").addEventListener("click", closeTouchHelp);
$("#touchHelp").addEventListener("click", event => { if (event.target === $("#touchHelp")) closeTouchHelp(); });
$("#gamePackageImport").addEventListener("click", () => {
  beginManualGamePackageImport("请选择要导入的本地游戏包。已安装游戏时，导入新包会更新本地版本。");
});
$("#launch").addEventListener("click", async () => {
  try {
    // Via and other mobile browsers can restore a BFCache/history entry with
    // the URL already moved to ?game=th07 while the in-memory state still
    // belongs to TH06.  Treat an explicit route as authoritative at launch so
    // a stale tab can never silently start the wrong runtime/local pack.
    syncSelectionFromPlayerRoute();
    if (!state.launched && importOnlyServer && !installedPackageSnapshots.has(state.game) && !readImportedGameDataMeta(state.game)?.legacyAssets) {
      clearStartupError();
      setStatus("需要导入本地游戏包");
      beginImportOnlyAttempt();
      return;
    }
    if (!state.launched && !await confirmInputWarnings()) return;
    if (!state.launched) {
      // Make the real player visible before requestFullscreen so desktop
      // browsers can fullscreen the same element that will host the game.
      openPlayerView();
      try { await enterPlayerFullscreen({ focusGame: false }); }
      catch (error) { showToast(`浏览器阻止自动全屏：${error.message}`); }
      await launchConfiguredRuntime(null);
      if (isPlayerFullscreen()) await lockEscapeForGame();
    } else refocusGameIfNeeded();
  } catch (error) {
    if (!state.launched && isCancelledDownload(error)) {
      if (player.classList.contains("open")) await closePlayerView();
      else resetRuntime();
      beginManualGamePackageImport();
      setStatus("下载已取消，可以导入本地游戏包");
      return;
    }
    if (importOnlyServer && !state.launched) {
      const message = error?.message || String(error);
      if (player.classList.contains("open")) await closePlayerView();
      else resetRuntime();
      beginImportOnlyAttempt();
      $("#gameDataImportReason").textContent = gameDataFallbackText(message);
      setStatus(message);
      showToast(message);
      return;
    }
    if (!state.launched && isResourceLoadFailure(error)) {
      const message = error?.message || String(error);
      if (player.classList.contains("open")) await closePlayerView();
      else resetRuntime();
      beginManualGamePackageImport(`启动资源请求失败：${message}\n这次失败发生在网页启动器已经正常运行之后，更像资源网络 / CDN 问题。`);
      setStatus("资源加载失败，可改用本地游戏包");
      return;
    }
    setPlayerStatus(error.message);
    showStartupError(error, `${state.game.toUpperCase()} / ${musicModeLabel(state.music)}`);
    showToast(error.message);
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
  $("#transferWarning").textContent = "正在重试 OGG 下载…";
  try { await send("retry-music", {}, 30 * 60 * 1000); }
  catch (error) { transferFailure({ failed: 1 }); setPlayerStatus(error.message); }
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
$("#gameDataImportInput").addEventListener("change", async event => {
  const input = event.currentTarget;
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file || !gameDataAttempt?.unlocked || state.ready) return;
  const button = $("#transferImport");
  button.disabled = true;
  setGameDataImportBusy(true, "正在校验并安装游戏包…");
  const attemptId = gameDataAttempt.id;
  try {
    const imported = await installImportedGameData(file);
    if (imported.packageInstall) {
      showToast(`游戏包已导入（${imported.files} 个文件）；之后将从本地启动。`);
      if (gameDataAttempt?.importOnly && !state.launched) {
        clearGameDataAttempt();
        setStatus("游戏包已导入，可以启动游戏");
        render();
        return;
      }
      if (state.ready) {
        setPlayerStatus("游戏已就绪；新导入的游戏包将在下次启动时使用");
        return;
      }
      if (gameDataAttempt?.id !== attemptId) return;
      setPlayerStatus("游戏包导入完成，正在从本地启动…");
      resetRuntime();
      await launchConfiguredRuntime();
      return;
    }
    if (importOnlyServer && !imported.offlineComplete) {
      throw new Error("当前服务器不提供游戏文件，请导入包含启动所需文件的游戏包");
    }
    const current = gameDataDescriptor();
    if ((imported.offlineComplete || imported.layout === current.layout) && imported.version !== current.version) {
      importedDataUpdateChoices.set(`${state.game}:${imported.version}->${current.version}`, "local");
    }
    if (imported.offlineComplete && imported.version !== current.version) {
      showToast("游戏包已导入。服务器已有新版，但本次继续使用包内版本；断网也可启动。");
    } else if (imported.offlineComplete) {
      showToast("游戏包已导入；断网也可启动当前版本。");
    } else if (imported.layout === current.layout && imported.version !== current.version) {
      showToast("本地游戏数据已导入。服务器有更新版本，但不会强制更新；之后仍优先使用此导入版本。");
    } else if (imported.layout !== current.layout) {
      showToast("本地游戏数据已保存，但文件布局与当前运行时不兼容；不会删除该导入资源。");
    } else {
      showToast("本地游戏数据已导入");
    }
    if (importOnlyServer && gameDataAttempt?.importOnly && imported.offlineComplete && !state.launched) {
      clearGameDataAttempt();
      setStatus("游戏包已导入，可以启动游戏");
      render();
      return;
    }
    if (state.ready) {
      setPlayerStatus("游戏已就绪；导入数据将在下次启动时优先使用");
      return;
    }
    if (gameDataAttempt?.id !== attemptId) return;
    setPlayerStatus(imported.offlineComplete ? "游戏包导入完成，正在从本地启动…" : "本地数据导入完成，正在重新启动…");
    resetRuntime();
    await launchConfiguredRuntime();
  } catch (error) {
    const message = error.message || String(error);
    setPlayerStatus(message);
    const storageFailure = /IndexedDB|存储|写入|配额|quota|浏览器已清理|持久化/i.test(message);
    $("#gameDataImportReason").textContent = importOnlyServer
      ? `${message}\n当前服务器没有可回退的游戏文件，请重新导入有效的游戏包。`
      : storageFailure
        ? `${message}\n本地导入未完成；服务器下载仍会继续。`
        : `${message}\n请导入有效的游戏包 ZIP 或兼容数据包；版本较旧本身不会被拒绝，服务器下载仍会继续。`;
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
mpRestoreDisplayName();
for (const [name, open] of Object.entries(mpUiState.folds)) mpSetFold(name, open);
if (mpRestoreRoomFromLocation()) {
  renderMpRoom();
  mpConnectLobby();
}
render(); setStatus("选择游戏后即可启动");
bootWatchdog?.ready();
const launcherRoomRoute = !!mpNormalizeRoomCode(new URL(location.href).searchParams.get(mpRoomUrlKey));
if (!launcherRoomRoute) void loadSiteNotice();
let changelogSeen = false;
try { changelogSeen = localStorage.getItem(changelogSeenKey) === "1"; } catch {}
const legacyHttpEntry = hasLegacyHttpEntryMarker();
if (!launcherRoomRoute && !changelogSeen && !debugHarness && !touchPreview && !legacyHttpEntry) void showChangelog(true);
if (!launcherRoomRoute && !debugHarness && !touchPreview && legacyHttpEntry) void promptLegacyHttpMigration();
