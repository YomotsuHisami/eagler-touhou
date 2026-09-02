import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

const requireText = (needle, label) => {
  if (!app.includes(needle)) throw new Error(`missing ${label}`);
};

requireText("const routedGameFromLocation = () =>", "route parser");
requireText('navigationType === "reload"', "reload-to-home route clearing");
requireText(`const reloadRoom = mpNormalizeRoomCode(reloadUrl.searchParams.get(mpRoomUrlKey));`, `MP room reload detection`);
requireText(`reloadUrl.searchParams.set("game", routedGame);`, `MP room refresh preserves product route`);
requireText(`reloadState[mpRoomHistoryKey] = reloadRoom;`, `MP room refresh preserves room history state`);
requireText('homeUrl.searchParams.delete("game")', "reload/home route removal");
requireText("function syncSelectionFromPlayerRoute()", "route -> state synchronizer");
requireText("function replaceLauncherHomeHistory()", "deterministic in-page return to home");
requireText('url.searchParams.delete(mpRoomUrlKey);', "home route removes room query");
requireText('if (!fromHistory) replaceLauncherHomeHistory();', "explicit return replaces transient route");
requireText('if (!syncSelectionFromPlayerRoute()) showLauncherHome();', "route-less popstate restores homepage");
requireText('window.addEventListener("popstate"', "history restore synchronizer");
requireText('window.addEventListener("pageshow"', "BFCache restore synchronizer");
requireText("event.persisted && !mpUiState.room && !syncSelectionFromPlayerRoute()", "BFCache homepage restore");
requireText('$("#mpLeaveRoom").addEventListener("click", () => mpLeaveRoom());', "leave-room click must not become a history leave");
requireText('history.pushState({ ...homeState, [mpRoomHistoryKey]: code }, "", roomUrl);', "direct room route receives a home predecessor");
requireText("function mpScheduleLobbyReconnect(roomCode)", "lobby reconnect backoff");
requireText('window.addEventListener("online", mpReconnectLobbyNow)', "immediate lobby reconnect when network returns");
requireText('document.visibilityState === "visible"', "lobby reconnect when the page becomes visible");
requireText('seats: null, synced: false, connection: "connecting"', "server snapshot gate for initial room rendering");
requireText('room.synced = true;', "authoritative room snapshot activation");
requireText('connection = "reconnecting"', "visible reconnecting room state");
requireText('const url = new URL(location.href); url.searchParams.set("game", state.product);', "player entry product route write");
requireText("history.replaceState({ ...previous, [playerHistoryKey]: true, game: state.product }, \"\", url);", "stale player-route correction");
requireText("returnToMpRoom = false", "Player close supports returning to a persistent MP room");
requireText("[playerHistoryKey]: false", "MP Runtime exit clears only the transient Player history state");
requireText("[mpRoomHistoryKey]: roomCode", "MP Runtime exit preserves the room history state");
requireText("returnToMpRoom: !!mpUiState.room && isMultiplayerProduct()", "Runtime exit returns to the active MP room");

for (const functionName of ["closePlayerView", "mpLeaveRoom"]) {
  const start = app.indexOf(`function ${functionName}(`) >= 0
    ? app.indexOf(`function ${functionName}(`)
    : app.indexOf(`async function ${functionName}(`);
  const end = app.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`missing ${functionName}`);
  if (app.slice(start, end).includes("history.back()")) {
    throw new Error(`${functionName} must not depend on the previous history entry`);
  }
}

const pointerAnchor = app.indexOf('if (matchMedia("(pointer: fine)")');
const cardStart = app.lastIndexOf('document.querySelectorAll(".game").forEach(card => {', pointerAnchor);
const cardEnd = pointerAnchor;
if (cardStart < 0 || cardEnd <= cardStart) throw new Error("missing game card handler");
const cardHandler = app.slice(cardStart, cardEnd);
for (const forbidden of [
  'searchParams.set("game"',
  'searchParams.delete("game"',
  'history.pushState(',
  'history.replaceState('
]) {
  if (cardHandler.includes(forbidden)) {
    throw new Error("selecting a game card must not change ?game= or browser history");
  }
}

if (!/value\.game !== gameId/.test(app)) {
  throw new Error("imported game-data metadata must remain isolated by game id");
}

console.log("route/state contract: PASS");
