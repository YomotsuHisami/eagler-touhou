import {
  ROOM_INVITE_KEY,
  encodeRoomInvite,
  roomInviteFromUrl,
  type RoomInvite,
} from "./room-invite.mjs";

export const PLAYER_HISTORY_KEY = "eaglerTouhouPlayer";
export const MP_ROOM_HISTORY_KEY = "eaglerTouhouMpRoom";
export const MP_SETTINGS_HISTORY_KEY = "eaglerTouhouMpSettings";
export const MP_PANEL_HISTORY_KEY = "eaglerTouhouMpPanel";
export const MP_ROOM_URL_KEY = "mpRoom";
export const TOUCH_LAYOUT_HISTORY_KEY = "eaglerTouhouTouchLayoutEditor";

export type HistoryState = Record<string, unknown>;

export interface HistoryOperation {
  kind: "replace" | "push";
  state: HistoryState;
  url: string;
}

function historyState(value: unknown): HistoryState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as HistoryState) }
    : {};
}

export function normalizeRoomCode(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

// Legacy room-link query keys (pre-token). Kept so old shared links still
// resolve, and cleared whenever a room route is (re)written to the token form.
const LEGACY_ROOM_PARAM_KEYS = Object.freeze([
  "mpRoom", "room", "fromLobby", "lobbyAction", "lobbyPlayers",
  "lobbyDifficulty", "lobbyVisibility", "lobbyDisableCheatMovement",
]);

export function clearRoomUrlParams(url: URL): void {
  for (const key of LEGACY_ROOM_PARAM_KEYS) url.searchParams.delete(key);
}

// Resolve the room invite carried by a launcher URL: the opaque token first,
// then the legacy plain query parameters for backward compatibility.
export function resolveRoomInvite(source: string | URL): RoomInvite | null {
  const url = new URL(source);
  const invite = roomInviteFromUrl(url);
  if (invite) return invite;
  const g = url.searchParams.get("game") || "";
  const r = url.searchParams.get(MP_ROOM_URL_KEY) || "";
  if (!g || !r) return null;
  const legacy: RoomInvite = { g, r };
  if (url.searchParams.get("fromLobby") === "1") legacy.f = true;
  const action = url.searchParams.get("lobbyAction");
  if (action === "create" || action === "join") legacy.a = action;
  if (url.searchParams.has("lobbyPlayers")) {
    const players = Number(url.searchParams.get("lobbyPlayers"));
    if (Number.isInteger(players)) legacy.p = players;
  }
  if (url.searchParams.has("lobbyDifficulty")) {
    const difficulty = Number(url.searchParams.get("lobbyDifficulty"));
    if (Number.isInteger(difficulty)) legacy.d = difficulty;
  }
  const visibility = url.searchParams.get("lobbyVisibility");
  if (visibility === "public" || visibility === "private") legacy.v = visibility;
  if (url.searchParams.get("lobbyDisableCheatMovement") === "1") legacy.c = true;
  return legacy;
}

export function roomCodeFromUrl(source: string | URL): string {
  return normalizeRoomCode(resolveRoomInvite(source)?.r ?? "");
}

export function routedProductFromUrl<Product extends string>(
  source: string | URL,
  productIds: ReadonlySet<Product>,
): Product | null {
  const url = new URL(source);
  const invite = roomInviteFromUrl(url);
  if (invite && productIds.has(invite.g as Product)) return invite.g as Product;
  const value = url.searchParams.get("game");
  return value !== null && productIds.has(value as Product) ? value as Product : null;
}

export function launcherHomeUrl(source: string | URL): URL {
  const url = new URL(source);
  url.searchParams.delete("game");
  url.searchParams.delete(MP_ROOM_URL_KEY);
  url.searchParams.delete(ROOM_INVITE_KEY);
  return url;
}

export function launcherHomeHistoryState(currentState: unknown): HistoryState {
  const next = historyState(currentState);
  next[PLAYER_HISTORY_KEY] = false;
  next[MP_ROOM_HISTORY_KEY] = false;
  delete next.game;
  return next;
}

export function launcherHomeHistoryOperation({
  currentUrl,
  currentState,
}: {
  currentUrl: string | URL;
  currentState: unknown;
}): HistoryOperation {
  return {
    kind: "replace",
    state: launcherHomeHistoryState(currentState),
    url: launcherHomeUrl(currentUrl).href,
  };
}

export function launcherOptionsHistoryOperation({
  currentUrl,
  currentState,
  product,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  product: string;
}): HistoryOperation {
  const url = new URL(currentUrl);
  const alreadyOnOptions = url.searchParams.get("game") === product;
  url.searchParams.set("game", product);
  url.searchParams.delete(MP_ROOM_URL_KEY);
  url.searchParams.delete(ROOM_INVITE_KEY);
  return {
    kind: alreadyOnOptions ? "replace" : "push",
    state: {
      ...historyState(currentState),
      [PLAYER_HISTORY_KEY]: true,
      [MP_ROOM_HISTORY_KEY]: false,
      [MP_PANEL_HISTORY_KEY]: false,
      [MP_SETTINGS_HISTORY_KEY]: false,
      game: product,
    },
    url: url.href,
  };
}

export function playerRouteUrl(source: string | URL, product: string): URL {
  const url = new URL(source);
  url.searchParams.set("game", product);
  return url;
}

export function roomRouteUrl(source: string | URL, product: string, roomCode: string): URL {
  const url = new URL(source);
  if (roomCode) {
    const previous = resolveRoomInvite(url);
    const fromDirectory = previous?.g === product && normalizeRoomCode(previous.r) === roomCode && previous.f === true;
    url.searchParams.set(ROOM_INVITE_KEY, encodeRoomInvite({ g: product, r: roomCode, ...(fromDirectory ? { f: true } : {}) }));
    clearRoomUrlParams(url);
  } else {
    url.searchParams.delete(ROOM_INVITE_KEY);
    url.searchParams.delete(MP_ROOM_URL_KEY);
  }
  return url;
}

export function roomRouteHistoryOperation({
  currentUrl,
  currentState,
  product,
  roomCode,
  push = false,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  product: string;
  roomCode: string;
  push?: boolean;
}): HistoryOperation {
  const url = new URL(currentUrl);
  if (roomCode) {
    const roomUrl = roomRouteUrl(url, product, roomCode);
    url.search = roomUrl.search;
    clearRoomUrlParams(url);
  } else {
    url.searchParams.delete(ROOM_INVITE_KEY);
    url.searchParams.delete(MP_ROOM_URL_KEY);
    url.searchParams.set("game", product);
  }
  const nextState = historyState(currentState);
  nextState[MP_ROOM_HISTORY_KEY] = roomCode || false;
  return { kind: push ? "push" : "replace", state: nextState, url: url.href };
}

export function returnToRoomHistoryOperation({
  currentUrl,
  currentState,
  product,
  roomCode,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  product: string;
  roomCode: string;
}): HistoryOperation {
  const url = roomRouteUrl(currentUrl, product, roomCode);
  const nextState = historyState(currentState);
  nextState[PLAYER_HISTORY_KEY] = false;
  nextState[MP_ROOM_HISTORY_KEY] = roomCode;
  nextState.game = product;
  return { kind: "replace", state: nextState, url: url.href };
}

export function roomSettingsHistoryOperation({
  currentUrl,
  currentState,
}: {
  currentUrl: string | URL;
  currentState: unknown;
}): HistoryOperation {
  return {
    kind: "push",
    state: { ...historyState(currentState), [MP_SETTINGS_HISTORY_KEY]: true },
    url: new URL(currentUrl).href,
  };
}

export function roomPanelHistoryOperation({
  currentUrl,
  currentState,
}: {
  currentUrl: string | URL;
  currentState: unknown;
}): HistoryOperation {
  return {
    kind: "push",
    state: { ...historyState(currentState), [MP_PANEL_HISTORY_KEY]: true },
    url: new URL(currentUrl).href,
  };
}

export function initialRoutedHistoryOperations({
  currentUrl,
  currentState,
  routedProduct,
  navigationType,
  multiplayerProduct,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  routedProduct: string;
  navigationType: string;
  multiplayerProduct: boolean;
}): HistoryOperation[] {
  const requestedRoom = multiplayerProduct ? roomCodeFromUrl(currentUrl) : "";
  if (navigationType === "reload") {
    const reloadUrl = new URL(currentUrl);
    const reloadState = historyState(currentState);
    if (requestedRoom) {
      reloadState[PLAYER_HISTORY_KEY] = false;
      reloadState.game = routedProduct;
      reloadState[MP_ROOM_HISTORY_KEY] = requestedRoom;
      return [{ kind: "replace", state: reloadState, url: reloadUrl.href }];
    }
    if (reloadState[PLAYER_HISTORY_KEY]) {
      reloadState.game = routedProduct;
      reloadState[MP_ROOM_HISTORY_KEY] = false;
      return [{ kind: "replace", state: reloadState, url: reloadUrl.href }];
    }
  }

  // The room restorer seeds its own home/room pair for a direct room URL.
  if (requestedRoom) return [];
  const previous = historyState(currentState);
  if (previous[PLAYER_HISTORY_KEY]) return [];
  const gameUrl = new URL(currentUrl);
  const homeUrl = new URL(currentUrl);
  homeUrl.searchParams.delete("game");
  return [
    {
      kind: "replace",
      state: { ...previous, [PLAYER_HISTORY_KEY]: false },
      url: homeUrl.href,
    },
    {
      kind: "push",
      state: { [PLAYER_HISTORY_KEY]: true, game: routedProduct },
      url: gameUrl.href,
    },
  ];
}

export function playerRouteHistoryOperation({
  currentUrl,
  currentState,
  routedProduct,
  product,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  routedProduct: string | null;
  product: string;
}): HistoryOperation | null {
  const previous = historyState(currentState);
  const url = playerRouteUrl(currentUrl, product);
  const nextState = { ...previous, [PLAYER_HISTORY_KEY]: true, game: product };
  if (!previous[PLAYER_HISTORY_KEY]) return { kind: "push", state: nextState, url: url.href };
  if (routedProduct !== product || previous.game !== product) {
    return { kind: "replace", state: nextState, url: url.href };
  }
  return null;
}

export function touchLayoutEditorHistoryOperation({
  currentUrl,
  currentState,
}: {
  currentUrl: string | URL;
  currentState: unknown;
}): HistoryOperation {
  const nextState = historyState(currentState);
  nextState[TOUCH_LAYOUT_HISTORY_KEY] = true;
  return {
    kind: "push",
    state: nextState,
    url: new URL(currentUrl).href,
  };
}

export function directRoomHistorySeed({
  currentUrl,
  currentState,
  roomCode,
}: {
  currentUrl: string | URL;
  currentState: unknown;
  roomCode: string;
}): HistoryOperation[] {
  const previous = historyState(currentState);
  if (previous[MP_ROOM_HISTORY_KEY]) return [];
  const roomUrl = new URL(currentUrl);
  const homeState = launcherHomeHistoryState(previous);
  return [
    { kind: "replace", state: homeState, url: launcherHomeUrl(roomUrl).href },
    {
      kind: "push",
      state: { ...homeState, [MP_ROOM_HISTORY_KEY]: roomCode },
      url: roomUrl.href,
    },
  ];
}

export function applyHistoryOperations(
  historyObj: Pick<History, "replaceState" | "pushState">,
  operations: readonly HistoryOperation[],
): void {
  for (const operation of operations) {
    if (operation.kind === "replace") historyObj.replaceState(operation.state, "", operation.url);
    else historyObj.pushState(operation.state, "", operation.url);
  }
}
