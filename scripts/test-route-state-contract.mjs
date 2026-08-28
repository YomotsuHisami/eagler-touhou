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
requireText('homeUrl.searchParams.delete("game")', "reload/home route removal");
requireText("function syncSelectionFromPlayerRoute()", "route -> state synchronizer");
requireText('window.addEventListener("popstate"', "history restore synchronizer");
requireText('window.addEventListener("pageshow"', "BFCache restore synchronizer");
requireText("if (event.persisted) syncSelectionFromPlayerRoute();", "BFCache route authority");
requireText('$("#mpLeaveRoom").addEventListener("click", () => mpLeaveRoom());', "leave-room click must not become a history leave");
requireText('if (!fromHistory) mpSyncRoomUrl("");', "explicit room leave clears mpRoom route");
requireText("function mpScheduleLobbyReconnect(roomCode)", "lobby reconnect backoff");
requireText('window.addEventListener("online", mpReconnectLobbyNow)', "immediate lobby reconnect when network returns");
requireText('document.visibilityState === "visible"', "lobby reconnect when the page becomes visible");
requireText('seats: null, synced: false, connection: "connecting"', "server snapshot gate for initial room rendering");
requireText('room.synced = true;', "authoritative room snapshot activation");
requireText('connection = "reconnecting"', "visible reconnecting room state");
requireText('const url = new URL(location.href); url.searchParams.set("game", state.game);', "player entry route write");
requireText("history.replaceState({ ...previous, [playerHistoryKey]: true, game: state.game }, \"\", url);", "stale player-route correction");

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
