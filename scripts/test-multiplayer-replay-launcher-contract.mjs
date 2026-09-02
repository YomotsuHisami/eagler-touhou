import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, index, th06Shell, th07Shell, th06Options, th07Options, th06Menu, th07Menu, th06Fs, th07Fs] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../../th06-eagler/resources/shell.html", import.meta.url), "utf8"),
  readFile(new URL("../../th07-eagler/resources/shell.html", import.meta.url), "utf8"),
  readFile(new URL("../../th06-eagler/src/EaglerOptions.hpp", import.meta.url), "utf8"),
  readFile(new URL("../../th07-eagler/src/EaglerOptions.hpp", import.meta.url), "utf8"),
  readFile(new URL("../../th06-eagler/src/MainMenu.cpp", import.meta.url), "utf8"),
  readFile(new URL("../../th07-eagler/src/MainMenu.cpp", import.meta.url), "utf8"),
  readFile(new URL("../../th06-eagler/src/FileSystem.cpp", import.meta.url), "utf8"),
  readFile(new URL("../../th07-eagler/src/FileSystem.cpp", import.meta.url), "utf8"),
]);

assert.match(index, /id="mpReplayViewer"[\s\S]*观赏 Replay/,
  "multiplayer settings must expose the Replay viewer action");
assert.match(app, /#mpReplayViewer[\s\S]*state\.product = multiplayerProductForGame\(state\.game\)[\s\S]*state\.runtimeVariant = "multiplayer"[\s\S]*state\.replayViewer = true/,
  "Replay viewer must stay on the selected game's dedicated multiplayer product/runtime");
assert.match(app, /const netplayOptions = state\.runtimeVariant === "multiplayer" && !state\.replayViewer \? validatedNetplayOptions\(\) : \{\}/,
  "Replay viewer must not inherit LAN room/netplay options");
assert.match(app, /replayViewer: !!state\.replayViewer/,
  "Launcher configure must forward Replay-viewer intent explicitly");
assert.match(app, /sourceUrl\.searchParams\.set\("runtimeVariant", state\.runtimeVariant \|\| "normal"\)[\s\S]*if \(state\.replayViewer\) sourceUrl\.searchParams\.set\("launchIntent", "replay"\)/,
  "hosted Runtime URL must select multiplayer storage before Replay configure runs");

for (const [game, shell, options, menu, fs] of [
  ["th06", th06Shell, th06Options, th06Menu, th06Fs],
  ["th07", th07Shell, th07Options, th07Menu, th07Fs],
]) {
  assert.match(shell, new RegExp(`params\\.get\\("runtimeVariant"\\) === "multiplayer" \\? "\\/saves${game}-multiplayer" : "\\/saves${game}"`),
    `${game} shell must mount a distinct multiplayer save/replay root`);
  assert.match(shell, /replayViewer: !!options\.replayViewer/,
    `${game} shell must forward Replay-viewer intent into Module options`);
  assert.match(options, /inline bool ReplayViewerEnabled\(\)[\s\S]*Module\.eaglerOptions\?\.replayViewer/,
    `${game} game must expose Replay-viewer intent to MainMenu`);
  assert.match(options, /inline bool MultiplayerStorageEnabled\(\)[\s\S]*defined\(TH_ENABLE_MULTIPLAYER_GAMEPLAY\)[\s\S]*return true;/,
    `${game} multiplayer storage identity must follow the dedicated MP binary, not transient LAN/Replay state`);
  assert.match(menu, /EaglerOptions::ReplayViewerEnabled\(\)/,
    `${game} MainMenu must route explicit Replay-viewer startup into Replay UI`);
  assert.match(fs, new RegExp(`MultiplayerStorageEnabled\\(\\)[\\s\\S]*\\/saves${game}-multiplayer`),
    `${game} pref-path implementation must agree with the multiplayer shell mount`);
}

console.log("Multiplayer Replay Launcher contract: PASS");
