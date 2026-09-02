import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "styles.css"), "utf8");
const relay = readFileSync(resolve(root, "../th07-eagler/tools/netplay/lan-relay.cjs"), "utf8");
const th06Shell = readFileSync(resolve(root, "../th06-eagler/resources/shell.html"), "utf8");
const th07Shell = readFileSync(resolve(root, "../th07-eagler/resources/shell.html"), "utf8");

assert.match(html, /id="mpSpectatorRail"/);
assert.match(html, /id="mpSpectatorList"/);
assert.match(html, /id="mpSpectatorJoin"/);
assert.match(html, /id="mpDisplayName"/);
assert.doesNotMatch(html, /id="mpSpectatorSeat"/);
assert.match(html, /id="mpStandUp"[^>]*>离开座位<\/button>/);
assert.match(css, /\.mp-spectator-rail\{position:absolute/);
assert.match(css, /@media\(max-width:780px\)[\s\S]*\.mp-spectator-rail\{position:fixed!important/);
assert.match(css, /\.mp-spectator-rail-head\{touch-action:none;user-select:none;cursor:grab/);
assert.match(app, /mpSetupSpectatorRailDrag/);
assert.match(app, /mpSpectatorRailPositionKey/);
assert.match(app, /setPointerCapture/);
assert.match(app, /setMobilePosition\(event\.clientX - drag\.dx, event\.clientY - drag\.dy/);
assert.match(css, /\.mp-spectator-list\{[^}]*overflow-y:auto/);
assert.match(css, /\.mp-seat-loadout\{/);

assert.match(app, /spectatorRequested: false/);
assert.match(app, /displayName: ""/);
assert.match(app, /mpNormalizeDisplayName/);
assert.match(app, /mpDisplayInitial/);
assert.match(app, /localStorage\.setItem\(mpDisplayNameKey/);
assert.match(app, /type: "take-seat"[^\n]*name: mpUiState\.displayName/);
assert.match(app, /type: "spectate", name: mpUiState\.displayName/);
assert.match(app, /type: "set-name", name/);
assert.match(app, /glyph\.textContent = mpDisplayInitial\(seatName,/);
assert.match(app, /loadoutLabel\.className = "mp-seat-loadout"/);
assert.match(app, /avatar\.textContent = mpDisplayInitial\(entry\.name\)/);
assert.doesNotMatch(app, /mp-spectator-name/);
assert.match(app, /const spectator = seat == null && mpUiState\.spectatorRequested === true;/);
assert.doesNotMatch(app, /const spectator = seat == null;/);
assert.match(app, /if \(mpUiState\.seat != null \|\| mpUiState\.spectatorRequested\) void mpLaunchRoomGame\(\);/);
assert.match(app, /message\.type === "spectator-start"/);
assert.match(app, /state\.netplay\.spectator = spectator;/);
assert.match(app, /state\.netplay\.spectatorId = spectator \? mpLobby\.clientId : "";/);
assert.match(app, /state\.netplay\.spectatorCount = Math\.max\(0, Number\(room\.spectatorCount\) \|\| 0\);/);
assert.match(app, /netplaySpectator: spectator,/);
assert.match(app, /netplaySpectatorId: spectator \? state\.netplay\.spectatorId : "",/);
assert.match(app, /mpUiState\.seat != null && !await confirmInputWarnings\(\)/);
assert.match(app, /!state\.launched \|\| !state\.ready \|\| !frame\.contentWindow \|\| state\.netplay\.spectator/);
assert.match(app, /const spectatorRuntime = isMultiplayerProduct\(\) && state\.netplay\.spectator === true;/);
assert.match(app, /returnToMpRoom: !!mpUiState\.room && isMultiplayerProduct\(\),/);

assert.match(relay, /spectators: new Map\(\)/);
assert.match(relay, /normalizeDisplayName/);
assert.match(relay, /name: seat\.name \|\| ''/);
assert.match(relay, /message\.type === 'set-name'/);
assert.match(relay, /room\.lobby\.spectators\.set\(clientId, normalizeDisplayName\(message\.name\)\)/);

for (const [game, shell] of [["TH06", th06Shell], ["TH07", th07Shell]]) {
  assert.match(shell, /"netplaySpectator"/);
  assert.match(shell, /invalid spectator id/);
  assert.match(shell, /invalid spectator count/);
  assert.match(shell, /netplaySpectator: !!options\.netplaySpectator,/);
  assert.match(shell, /netplaySpectatorId: options\.netplaySpectatorId \|\| "",/);
  assert.match(shell, /netplaySpectatorCount: options\.netplaySpectatorCount \?\? 0,/);
  assert.ok(shell.includes("runtimeVariant"), `${game} shell must retain the hosted Runtime contract`);
}

console.log("Multiplayer spectator Launcher contract: PASS rail=1 names=all initial-only=1 role-label=1");
