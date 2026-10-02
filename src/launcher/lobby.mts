import { PRODUCT_GAMES, PRODUCT_IDS, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, productEnabledForBuild } from "../contracts/product-catalog.mjs";
import type { MultiplayerProductId } from "../contracts/product-catalog.mjs";
import { validateHostManifest } from "../contracts/host-manifest.mjs";
import { getUiLocale, initUiLocale, t } from "./i18n.mjs";
import type { UiMessageKey } from "./i18n.mjs";
import { multiplayerMemberId, createMultiplayerIdentityStore, multiplayerControlMode } from "./multiplayer-identity.mjs";
import { buildMultiplayerDirectoryRelayUrl } from "./multiplayer-relay-url.mjs";
import { createMultiplayerRoomSessionStore } from "./multiplayer-room-session.mjs";

type Seat = { initial: string; ready: boolean; online: boolean; controlMode: ReturnType<typeof multiplayerControlMode> } | null;
type Room = { product: MultiplayerProductId; code: string; capacity: 2 | 3; players: number; ready: number;
  difficulty: number; spectators: number; phase: string; joinable: boolean; seats: Seat[]; disableCheatMovement: boolean };
type Mine = { product: MultiplayerProductId; code: string; recoveryToken: string } | null;
type Connection = "loading" | "live" | "offline" | "unsupported" | "missing";
const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
const identity = createMultiplayerIdentityStore();
const sessions = createMultiplayerRoomSessionStore();
const memberId = multiplayerMemberId();
const rowTemplate = el<HTMLTemplateElement>("roomRowTemplate");
const dialog = el<HTMLDialogElement>("roomDialog");
const gameSelect = el<HTMLSelectElement>("gameSelect");
const capacitySelect = el<HTMLSelectElement>("capacitySelect");
const difficultySelect = el<HTMLSelectElement>("difficultySelect");
const codeInput = el<HTMLInputElement>("roomCodeInput");
const rowNodes = new Map<string, { node: HTMLElement; signature: string }>();
let products: MultiplayerProductId[] = [];
let rooms: Room[] = [];
let mine: Mine = null;
let recovering: Mine = null, recoveryTimer = 0, supportsRecovery = false;
let relay = "";
let selectedProduct = new URL(location.href).searchParams.get("game") || "";
let connection: Connection = "loading";
let connectionInterrupted = false;
let socket: WebSocket | null = null;
let reconnectTimer = 0, handshakeTimer = 0, filterTimer = 0, retryCount = 0;
let total = 0, leaving = false;
let loadedProduct: string | null = null, requestedProduct = "", listTimer = 0;
let dialogMode: "create" | "join" = "create";
let afterDialogClose: (() => void) | null = null;
let initialRevealStarted = false;

function decodeImage(source: string) {
  const image = new Image();
  image.src = source;
  return image.decode().catch(() => {});
}

// Start critical visuals alongside the manifest and first relay snapshot.
const initialVisuals = Promise.allSettled([
  decodeImage("assets/launcher-background.webp"),
  document.fonts.load('400 16px "ET Yatra"', "0123456789 Normal Multiplayer"),
  ...[400, 700, 900].map(weight => document.fonts.load(`${weight} 16px "ET Chill Round"`, "联机大厅東方紅魔郷妖々夢永夜抄花映塚風神録")),
]);

function revealInitialPage() {
  if (initialRevealStarted || connection === "loading") return;
  initialRevealStarted = true;
  const covers = [...document.querySelectorAll<HTMLImageElement>(".lobby-main img")]
    .filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < innerHeight + 80 && rect.bottom > 0;
    });
  // Decode the visible covers even though the original nodes use lazy loading.
  const visuals = Promise.allSettled([initialVisuals, ...covers.map(image => decodeImage(image.currentSrc || image.src))]);
  let deadline = 0;
  void Promise.race([visuals, new Promise<void>(resolve => { deadline = window.setTimeout(resolve, 3000); })])
    .then(() => {
      clearTimeout(deadline);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.documentElement.removeAttribute("data-lobby-boot");
        document.querySelector<HTMLElement>(".lobby-main")!.inert = false;
        const preload = document.getElementById("lobbyPreload");
        preload?.classList.add("is-done");
        preload?.setAttribute("aria-hidden", "true");
        window.setTimeout(() => preload?.remove(), 200);
      }));
    });
}

initUiLocale();
let multiplayerGuidePromise: Promise<ReturnType<typeof import("./multiplayer-guide.mjs")["createMultiplayerGuideController"]>> | null = null;
el("mpGuideOpen").addEventListener("click", () => {
  multiplayerGuidePromise ??= import("./multiplayer-guide.mjs").then(module => module.createMultiplayerGuideController({
    readFailureText: error => t("multiplayerGuide.readFailed", { reason: error instanceof Error ? error.message : String(error) }),
    getGameId: () => isMultiplayerProductId(selectedProduct) ? gameIdForProduct(selectedProduct) : "th07",
  }));
  void multiplayerGuidePromise.then(controller => controller.show());
});
document.title = `${t("lobby.title")} ~ EAGLER TOUHOU`;
const launcherUrl = new URL(getUiLocale() === "en" ? "en.html" : "./", location.href);
el<HTMLAnchorElement>("launcherLink").href = launcherUrl.href;
try { document.body.classList.toggle("less-motion", localStorage.getItem("eagler-touhou-less-motion-v1") === "1"); } catch {}
window.addEventListener("storage", event => {
  if (event.key === "eagler-touhou-less-motion-v1") document.body.classList.toggle("less-motion", event.newValue === "1");
});

function notice(message: string) {
  el("notice").textContent = message;
  el("notice").hidden = !message;
}
function showReturnMessage() {
  try {
    const message = sessionStorage.getItem("eagler-lobby-message");
    if (message) { notice(message); sessionStorage.removeItem("eagler-lobby-message"); }
  } catch {}
}
showReturnMessage();

function parseRoom(value: unknown): Room | null {
  const row = record(value);
  if (!row || typeof row.product !== "string" || !isMultiplayerProductId(row.product) || !products.includes(row.product) ||
      typeof row.code !== "string" || !/^\d{4,8}$/.test(row.code)) return null;
  const policy = multiplayerConfigForProduct(row.product)!;
  const capacity = Number(row.capacity) as 2 | 3;
  if (!policy.playerCounts.includes(capacity)) return null;
  const inputSeats = Array.isArray(row.seats) ? row.seats : Array.isArray(row.initials) ? row.initials : [];
  const seats = Array.from({ length: capacity }, (_, index): Seat => {
    const value = inputSeats[index];
    if (value == null) return null;
    const seat = record(value);
    const initial = [...String(seat?.initial ?? value).replace(/[\u0000-\u001f\u007f]/g, "").trim()][0] || "?";
    return { initial, ready: seat?.ready === true, online: seat?.online !== false, controlMode: multiplayerControlMode(seat?.controlMode) };
  });
  return { product: row.product, code: row.code, capacity, seats,
    disableCheatMovement: row.disableCheatMovement === true,
    players: seats.filter(Boolean).length, ready: bounded(row.ready, capacity),
    spectators: bounded(row.spectators, 999), difficulty: bounded(row.difficulty, policy.difficulties.length - 1),
    phase: row.phase === "lobby" ? "lobby" : "playing", joinable: row.joinable === true };
}

function titleFor(product: MultiplayerProductId) {
  const game = PRODUCT_GAMES[gameIdForProduct(product)];
  return getUiLocale() === "en" ? game.subtitle : game.title;
}
function roomState(room: Room): "recruiting" | "full" | "playing" {
  return room.phase !== "lobby" ? "playing" : room.players >= room.capacity ? "full" : "recruiting";
}
function rowFor(room: Room): HTMLElement {
  const key = `${room.product}-${room.code}`;
  let entry = rowNodes.get(key);
  if (!entry) {
    const node = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    if (document.documentElement.hasAttribute("data-lobby-boot")) node.classList.add("lobby-room-initial");
    node.dataset.key = key;
    const meta = PRODUCT_GAMES[gameIdForProduct(room.product)];
    const cover = node.querySelector<HTMLImageElement>(".lobby-cover img")!;
    cover.addEventListener("error", () => { cover.hidden = true; }, { once: true });
    if ("cardArtwork" in meta && meta.cardArtwork) cover.src = `assets/${meta.cardArtwork}`;
    else cover.hidden = true;
    node.querySelector(".lobby-cover-number")!.textContent = meta.number;
    node.querySelector("h2")!.textContent = titleFor(room.product);
    node.querySelector(".lobby-room-subtitle")!.textContent = meta.subtitle;
    node.querySelector<HTMLButtonElement>(".lobby-join")!.addEventListener("click", () => {
      const current = rooms.find(value => `${value.product}-${value.code}` === key);
      if (!current || !current.joinable || roomState(current) !== "recruiting") return;
      enterRoom(current.product, current.code, false);
    });
    entry = { node, signature: "" };
    rowNodes.set(key, entry);
  }
  const signature = JSON.stringify([room, connection, !!mine, leaving]);
  if (entry.signature === signature) return entry.node;
  entry.signature = signature;
  const node = entry.node;
  const difficulty = multiplayerConfigForProduct(room.product)!.difficulties[room.difficulty];
  node.querySelector(".lobby-room-code")!.textContent = `#${room.code}`;
  node.querySelector(".lobby-difficulty")!.textContent = difficulty;
  node.querySelector(".lobby-mobile-difficulty")!.textContent = difficulty;
  let movementRule = node.querySelector<HTMLElement>(".lobby-movement-rule");
  if (!movementRule) {
    movementRule = document.createElement("span"); movementRule.className = "lobby-movement-rule";
    node.querySelector(".lobby-room-title")!.append(movementRule);
  }
  movementRule.textContent = t("lobby.noCheat"); movementRule.hidden = !room.disableCheatMovement;
  node.querySelector(".lobby-occupancy")!.textContent = t("lobby.count", { players: room.players, capacity: room.capacity });
  const party = node.querySelector<HTMLElement>(".lobby-party")!;
  party.setAttribute("aria-label", t("lobby.count", { players: room.players, capacity: room.capacity }));
  const seatNodes = room.seats.map((seat, index) => {
    const item = document.createElement("span");
    item.className = "lobby-seat";
    item.textContent = seat?.initial || "";
    item.dataset.empty = String(!seat);
    item.dataset.ready = String(!!seat?.ready);
    item.dataset.offline = String(!!seat && !seat.online);
    item.title = t(!seat ? "lobby.seatEmpty" : !seat.online ? "lobby.seatOffline" : seat.ready ? "lobby.seatReady" : "lobby.seatWaiting", { seat: index + 1, name: seat?.initial || "?" });
    if (seat?.controlMode) {
      const label = document.createElement("span"); label.className = "lobby-seat-control";
      label.textContent = t(`multiplayer.control.${seat.controlMode}`);
      label.dataset.mode = seat.controlMode;
      item.append(label);
      item.title += ` · ${label.textContent}`;
    }
    item.setAttribute("aria-label", item.title);
    item.setAttribute("role", "img");
    return item;
  });
  node.querySelector(".lobby-seats")!.replaceChildren(...seatNodes);
  node.querySelector(".lobby-seats")!.classList.toggle("has-controls", room.seats.some(seat => !!seat?.controlMode));
  const playerCount = node.querySelector<HTMLElement>(".lobby-player-count")!;
  playerCount.textContent = `${room.players} / ${room.capacity}`;
  playerCount.setAttribute("aria-label", t("lobby.count", { players: room.players, capacity: room.capacity }));
  const state = roomState(room);
  const stateNode = node.querySelector<HTMLElement>(".lobby-room-state")!;
  stateNode.dataset.state = state;
  stateNode.textContent = t(`lobby.${state}`);
  const join = node.querySelector<HTMLButtonElement>(".lobby-join")!;
  join.disabled = connection !== "live" || !!mine || leaving || !room.joinable || state !== "recruiting";
  join.textContent = t(state === "recruiting" ? "lobby.join" : `lobby.${state}`);
  join.setAttribute("aria-label", `${t("lobby.joinRoom")} ${titleFor(room.product)} #${room.code}`);
  join.title = mine ? t("lobby.conflict") : "";
  return node;
}

function render() {
  if (connection === "live") connectionInterrupted = false;
  else if (connection !== "loading") connectionInterrupted = true;
  const showConnectionWarning = connectionInterrupted;
  el("connectionWarning").hidden = !showConnectionWarning;
  el("connectionWarningTitle").textContent = t(connection === "unsupported" ? "lobby.unsupported" : rooms.length ? "lobby.disconnected" : "lobby.offline");
  el("connectionWarningHint").textContent = t(connection === "unsupported" ? "lobby.unsupportedHint" : connection === "missing" ? "lobby.noService" : "lobby.refreshHint");
  const loading = connection === "loading" || (connection === "live" && loadedProduct !== selectedProduct);
  const visible = loading ? [] : rooms.filter(room => !selectedProduct || room.product === selectedProduct);
  const list = el("roomList");
  list.setAttribute("aria-busy", String(loading));
  const keep = new Set(visible.map(room => `${room.product}-${room.code}`));
  for (const [key, entry] of rowNodes) if (!keep.has(key)) { entry.node.remove(); rowNodes.delete(key); }
  let cursor = list.firstElementChild;
  for (const room of visible) {
    const row = rowFor(room);
    if (row !== cursor) list.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
  }
  el("listHead").hidden = !visible.length;
  el("listLoading").hidden = !loading;
  el("emptyState").hidden = loading || !!visible.length || showConnectionWarning;
  el("roomCount").textContent = loading ? "" : t("lobby.roomCount", { count: visible.length });
  const emptyTitle: UiMessageKey = connection === "live" ? "lobby.empty" : connection === "loading" ? "lobby.connecting" : connection === "unsupported" ? "lobby.unsupported" : "lobby.offline";
  const emptyHint: UiMessageKey = connection === "live" ? "lobby.emptyHint" : connection === "loading" ? "lobby.loadingHint" : connection === "unsupported" ? "lobby.unsupportedHint" : connection === "missing" ? "lobby.noService" : "lobby.offlineHint";
  el("emptyTitle").textContent = t(emptyTitle);
  el("emptyHint").textContent = t(emptyHint);
  el("emptyAction").hidden = connection === "loading" || (connection === "live" && !!mine);
  el("emptyAction").textContent = t(connection === "live" ? "lobby.create" : "lobby.retry");
  const disabled = connection !== "live" || !!mine || leaving || !products.length;
  el<HTMLButtonElement>("createButton").disabled = disabled;
  el<HTMLButtonElement>("codeButton").disabled = disabled;
  el<HTMLButtonElement>("submitRoom").disabled = disabled;
  el("membership").hidden = !mine;
  if (mine) el("membershipTitle").textContent = t("lobby.mine", { code: mine.code });
  el("membershipHint").textContent = t(supportsRecovery ? "lobby.mineHint" : "lobby.releaseUnsupported");
  const releaseButton = el<HTMLButtonElement>("releaseMembership");
  releaseButton.hidden = !mine || !supportsRecovery;
  releaseButton.disabled = !!recovering || connection !== "live" || leaving || !mine?.recoveryToken;
  releaseButton.textContent = t(recovering ? "lobby.releasing" : "lobby.release");
  const connectionNote = el("connectionNote");
  connectionNote.hidden = connection !== "live" || total <= rooms.length;
  connectionNote.textContent = t("lobby.truncated", { count: rooms.length });
  revealInitialPage();
}

function renderFilters() {
  const filters = ["", ...products].map(product => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lobby-filter";
    button.dataset.product = product;
    button.textContent = product ? PRODUCT_GAMES[gameIdForProduct(product as MultiplayerProductId)].number : t("lobby.all");
    button.title = product ? titleFor(product as MultiplayerProductId) : t("lobby.all");
    button.setAttribute("aria-pressed", String(selectedProduct === product));
    button.addEventListener("click", () => {
      if (selectedProduct === product) return;
      selectedProduct = product;
      loadedProduct = null;
      const route = new URL(location.href);
      if (product) route.searchParams.set("game", product); else route.searchParams.delete("game");
      history.replaceState(history.state, "", route);
      for (const child of el("filters").children) child.setAttribute("aria-pressed", String((child as HTMLElement).dataset.product === product));
      render();
      clearTimeout(filterTimer);
      filterTimer = window.setTimeout(refresh, 180);
    });
    return button;
  });
  el("filters").replaceChildren(...filters);
}
function refresh() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  requestedProduct = selectedProduct;
  socket.send(JSON.stringify({ type: "refresh", product: selectedProduct }));
  clearTimeout(listTimer);
  if (loadedProduct !== selectedProduct) listTimer = window.setTimeout(() => {
    // A filtered directory snapshot is application data, not the connection
    // heartbeat. A delayed/lost refresh reply must not tear down an otherwise
    // healthy directory WebSocket and misreport the whole lobby as offline.
    if (socket?.readyState === WebSocket.OPEN && loadedProduct !== selectedProduct) refresh();
  }, 3000);
}
function disconnect() {
  clearTimeout(reconnectTimer); clearTimeout(handshakeTimer); clearTimeout(listTimer);
  clearTimeout(recoveryTimer); recovering = null;
  const previous = socket;
  socket = null;
  if (previous && previous.readyState < WebSocket.CLOSING) previous.close(1000, "leave directory");
}
function scheduleReconnect() {
  if (leaving || navigator.onLine === false) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connect, Math.min(20_000, 1500 * 2 ** Math.min(retryCount++, 4)));
}
function connect() {
  disconnect();
  if (!relay || leaving) return;
  if (navigator.onLine === false) { connection = "offline"; render(); return; }
  connection = "loading";
  loadedProduct = null; requestedProduct = "";
  render();
  let next: WebSocket;
  try { next = new WebSocket(buildMultiplayerDirectoryRelayUrl(relay, memberId)); }
  catch { connection = "offline"; render(); return; }
  socket = next;
  let received = false;
  handshakeTimer = window.setTimeout(() => {
    if (socket !== next || received) return;
    // Silence is not proof that the relay lacks the directory protocol. Keep
    // the explicit 1008 close as the unsupported signal; otherwise recover
    // from a delayed/lost first snapshot without requiring a page refresh.
    connection = "offline";
    disconnect(); render(); scheduleReconnect();
  }, 10_000);
  next.addEventListener("message", event => {
    if (socket !== next) return;
    let message: Record<string, unknown> | null;
    try { message = record(JSON.parse(String(event.data))); } catch { return; }
    if (message?.type !== "directory" || message.version !== 1 || !Array.isArray(message.rooms)) return;
    const first = !received;
    received = true; retryCount = 0;
    clearTimeout(handshakeTimer);
    const active = record(message.mine);
    supportsRecovery = message.membershipRecovery === true;
    mine = active && typeof active.product === "string" && isMultiplayerProductId(active.product) && typeof active.code === "string" && /^\d{4,8}$/.test(active.code)
      ? { product: active.product, code: active.code, recoveryToken: typeof active.recoveryToken === "string" ? active.recoveryToken : "" } : null;
    if (recovering && mine?.recoveryToken !== recovering.recoveryToken) {
      clearTimeout(recoveryTimer);
      if (!mine) sessions.clear(recovering.product);
      recovering = null;
      notice(t(mine ? "lobby.releaseChanged" : "lobby.released"));
    }
    rooms = message.rooms.slice(0, 200).map(parseRoom).filter((room): room is Room => !!room);
    loadedProduct = typeof message.product === "string" ? message.product : first ? "" : requestedProduct;
    if (loadedProduct === selectedProduct) clearTimeout(listTimer);
    total = bounded(message.total, 100000);
    connection = "live";
    render();
    if (first && selectedProduct) refresh();
  });
  next.addEventListener("close", event => {
    if (socket !== next) return;
    socket = null;
    if (recovering) notice(t("lobby.releaseFailed"));
    clearTimeout(recoveryTimer); recovering = null;
    clearTimeout(handshakeTimer);
    const unsupported = !received && event.code === 1008;
    // A directory socket that already delivered valid data is known-good.
    // Treat a later transport close as automatic recovery first; only a new
    // connection that also misses its first snapshot is promoted to offline.
    connection = unsupported ? "unsupported" : received ? "loading" : "offline";
    render();
    if (connection !== "unsupported") scheduleReconnect();
  });
  next.addEventListener("error", () => {});
}

function updateGameOptions() {
  const policy = multiplayerConfigForProduct(gameSelect.value);
  if (!policy) return;
  capacitySelect.replaceChildren(...policy.playerCounts.map(count => new Option(t("lobby.playersCount", { count }), String(count))));
  difficultySelect.replaceChildren(...policy.difficulties.map((name, index) => new Option(name, String(index))));
  difficultySelect.value = "1";
}
function setDialogMode(mode: "create" | "join") {
  dialogMode = mode;
  el("dialogTitle").textContent = t(mode === "create" ? "lobby.create" : "lobby.byCode");
  el("submitRoom").textContent = t(mode === "create" ? "lobby.create" : "lobby.joinRoom");
  el("createFields").hidden = mode !== "create";
  el("policyFields").hidden = mode !== "create";
  el("codeField").hidden = mode !== "join";
  codeInput.required = mode === "join";
  el("formNote").textContent = t(mode === "create" ? (el<HTMLSelectElement>("visibilitySelect").value === "private" ? "room.privateHint" : "lobby.publicRoom") : "lobby.codeHint");
  el("formError").hidden = true;
}
function openDialog(mode: "create" | "join") {
  if (connection !== "live" || leaving) return;
  if (mine) { notice(t("lobby.conflict")); return; }
  if (selectedProduct) gameSelect.value = selectedProduct;
  updateGameOptions();
  setDialogMode(mode);
  history.pushState({ ...history.state, lobbyDialog: mode }, "");
  dialog.showModal();
  if (mode === "join") codeInput.focus();
}
function closeDialog() {
  if (history.state?.lobbyDialog) history.back();
  else { dialog.close(); const action = afterDialogClose; afterDialogClose = null; action?.(); }
}
window.addEventListener("popstate", () => {
  const mode = history.state?.lobbyDialog;
  if (mode === "create" || mode === "join") {
    setDialogMode(mode);
    if (!dialog.open) dialog.showModal();
  } else {
    if (dialog.open) dialog.close();
    const action = afterDialogClose;
    afterDialogClose = null;
    action?.();
  }
});
dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener("click", event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog();
});
el("closeDialog").addEventListener("click", closeDialog);
gameSelect.addEventListener("change", updateGameOptions);
el("createButton").addEventListener("click", () => openDialog("create"));
el("codeButton").addEventListener("click", () => openDialog("join"));
el("releaseMembership").addEventListener("click", () => {
  if (!supportsRecovery || !mine?.recoveryToken || recovering || socket?.readyState !== WebSocket.OPEN) return;
  recovering = { ...mine };
  socket.send(JSON.stringify({ type: "release-membership", recoveryToken: recovering.recoveryToken }));
  recoveryTimer = window.setTimeout(() => {
    recovering = null;
    notice(t("lobby.releaseFailed")); render();
  }, 8000);
  render();
});
el("visibilitySelect").addEventListener("change", () => setDialogMode(dialogMode));
el("connectionRefresh").addEventListener("click", () => location.reload());
el("emptyAction").addEventListener("click", () => {
  if (connection === "live") openDialog("create");
  else if (!relay) void boot();
  else connect();
});
codeInput.addEventListener("input", () => codeInput.setCustomValidity(""));
el<HTMLFormElement>("roomForm").addEventListener("submit", event => {
  event.preventDefault();
  const product = gameSelect.value;
  if (!isMultiplayerProductId(product) || !products.includes(product) || mine || connection !== "live") return;
  let code = codeInput.value.trim();
  if (dialogMode === "join" && !/^\d{4,8}$/.test(code)) {
    codeInput.setCustomValidity(t("lobby.invalidCode")); codeInput.reportValidity(); return;
  }
  const created = dialogMode === "create";
  if (created) {
    // The relay still arbitrates collisions atomically; the directory is a snapshot.
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    code = String(1000 + random[0] % 9000);
    while (rooms.some(room => room.product === product && room.code === code)) code = String(1000 + (Number(code) - 999) % 9000);
  }
  const capacity = Number(capacitySelect.value) as 2 | 3;
  const difficulty = Number(difficultySelect.value);
  const visibility = el<HTMLSelectElement>("visibilitySelect").value === "private" ? "private" : "public";
  const disableCheatMovement = el<HTMLSelectElement>("cheatSelect").value === "1";
  afterDialogClose = () => enterRoom(product, code, created, capacity, difficulty, visibility, disableCheatMovement);
  closeDialog();
});

function enterRoom(product: MultiplayerProductId, code: string, created: boolean, playerCount?: 2 | 3, difficulty = 1, visibility: "public" | "private" = "public", disableCheatMovement = false) {
  if (leaving || connection !== "live") return;
  if (mine) { notice(t("lobby.conflict")); return; }
  const policy = multiplayerConfigForProduct(product)!;
  identity.lobbyClientId(product);
  if (created) sessions.save(product, { room: { code, playerCount: playerCount || policy.playerCounts[0], difficulty, created: true, visibility, disableCheatMovement }, seat: 0, ready: false, spectatorRequested: false, roomSettingsOpen: false });
  else sessions.clear(product);
  const url = new URL(launcherUrl);
  url.searchParams.set("game", product);
  url.searchParams.set("mpRoom", code);
  url.searchParams.set("room", code);
  url.searchParams.set("fromLobby", "1");
  url.searchParams.set("lobbyAction", created ? "create" : "join");
  if (created) {
    url.searchParams.set("lobbyPlayers", String(playerCount || policy.playerCounts[0]));
    url.searchParams.set("lobbyDifficulty", String(difficulty));
    url.searchParams.set("lobbyVisibility", visibility);
    url.searchParams.set("lobbyDisableCheatMovement", disableCheatMovement ? "1" : "0");
  }
  leaving = true;
  render();
  disconnect();
  location.assign(url.href);
}

el<HTMLAnchorElement>("launcherLink").addEventListener("click", event => {
  try {
    const previous = new URL(document.referrer);
    if (previous.origin === launcherUrl.origin && [launcherUrl.pathname, new URL("./", launcherUrl).pathname, new URL("en.html", launcherUrl).pathname].includes(previous.pathname) && !previous.searchParams.has("mpRoom") && history.length > 1) {
      event.preventDefault(); history.back();
    }
  } catch {}
});
window.addEventListener("pagehide", () => { leaving = true; clearTimeout(filterTimer); disconnect(); });
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  leaving = false; showReturnMessage(); connect();
});
window.addEventListener("online", () => { if (!leaving && relay) connect(); });
window.addEventListener("offline", () => { disconnect(); connection = "offline"; render(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || leaving || !relay) return;
  if (socket?.readyState === WebSocket.OPEN) refresh();
  else if (connection !== "unsupported") connect();
});

async function boot() {
  connection = "loading"; render();
  try {
    const response = await fetch("host-manifest.json", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = validateHostManifest(await response.json());
    products = PRODUCT_IDS.filter((product): product is MultiplayerProductId => isMultiplayerProductId(product) && productEnabledForBuild(product, manifest.shared.testBuild) && !!manifest.games[gameIdForProduct(product)]);
    if (!products.includes(selectedProduct as MultiplayerProductId)) selectedProduct = "";
    renderFilters();
    gameSelect.replaceChildren(...products.map(product => new Option(titleFor(product), product)));
    updateGameOptions();
    relay = manifest.shared.netplayRelay || "";
    if (!relay) { connection = "missing"; render(); return; }
    connect();
  } catch { connection = "offline"; render(); }
}
void boot();
