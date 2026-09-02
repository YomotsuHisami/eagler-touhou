import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../app-shell-sw-src.js", import.meta.url), "utf8");
const shellBuild = await readFile(new URL("./build-app-shell.mjs", import.meta.url), "utf8");
const preparation = await readFile(new URL("../runtime-preparation.mjs", import.meta.url), "utf8");
const productCatalog = await readFile(new URL("../product-catalog.mjs", import.meta.url), "utf8");
const packageServer = await readFile(new URL("./package-server.mjs", import.meta.url), "utf8");
const th06Shell = await readFile(new URL("../../th06-eagler/resources/shell.html", import.meta.url), "utf8");
const th07Shell = await readFile(new URL("../../th07-eagler/resources/shell.html", import.meta.url), "utf8");
const th06FileSystem = await readFile(new URL("../../th06-eagler/src/FileSystem.cpp", import.meta.url), "utf8");
const th07FileSystem = await readFile(new URL("../../th07-eagler/src/FileSystem.cpp", import.meta.url), "utf8");

assert.match(app, /let manifest = createLocalProductManifest\(\)/,
  "Launcher must bootstrap independently of remote metadata");
assert.match(productCatalog, /runtime: "\.\/runtime\/th06\/th06\.html"[\s\S]*multiplayerRuntime: "\.\/runtime\/th06\/multiplayer\/th06\.html"/,
  "offline Launcher bootstrap must know both App-owned TH06 Runtime paths without games.json");
assert.match(productCatalog, /runtime: "\.\/runtime\/th07\/th07\.html"[\s\S]*multiplayerRuntime: "\.\/runtime\/th07\/multiplayer\/th07\.html"/,
  "offline Launcher bootstrap must know both App-owned TH07 Runtime paths without games.json");
assert.match(app, /async function ensureRuntime[\s\S]*readCurrentPackageGeneration\(state\.game\)/,
  "installed content must be considered before waiting for remote state");
assert.match(app, /state\.source = managedRuntimeUrl\(runtimeUrl\(\), generation/,
  "installed content must run in the App-managed Runtime");
assert.match(app, /__eaglerPrepareManagedRuntimeDataV1[\s\S]*readManagedRuntimeData/,
  "Launcher must expose a bounded DATA preparation call to its same-origin Runtime child");
assert.match(preparation, /stored\.data instanceof ArrayBuffer[\s\S]*stored\.blob instanceof Blob[\s\S]*arrayBuffer\(\)/,
  "prepared DATA must support existing ArrayBuffer and Blob Package objects");
assert.match(preparation, /buffer\.byteLength !== expectedBytes/,
  "prepared DATA must be size checked without adding a hash gate");
assert.doesNotMatch(app, /waitForServiceWorker|serviceWorkerCapabilities|__runtime__|__package__|page-memory|PackageBootstrap/,
  "Runtime launch must not wait for, probe, or route game bytes through Service Worker");
assert.doesNotMatch(sw, /indexedDB|package-store|__runtime__|__package__|capabilit|page-memory/i,
  "Service Worker must remain App-Shell-only");
assert.match(sw, /const PRECACHE_MANIFEST = self\.__WB_MANIFEST/,
  "App Shell must keep the Workbox manifest injection point");
assert.match(sw, /const entry = manifestEntryForRequest\(event\.request\);[\s\S]*if \(!entry\) return;/,
  "Service Worker fetch handling must be limited to declared App Shell entries");
assert.match(shellBuild, /import \{ getManifest, injectManifest \} from "workbox-build"/,
  "App Shell revisioning must use Workbox");
assert.doesNotMatch(shellBuild, /package-runtime-access|player\.html|runtime-host/,
  "retired carriers must not be published in the App Shell");
assert.match(packageServer, /resolve\(staging, "eagler-touhou", "runtime", game\)/,
  "Runtime HTML JS and WASM must publish inside the App Shell scope");
assert.match(packageServer, /runtimeRequirement:[\s\S]*dataFile: "game-data"/,
  "new Package descriptors must identify content compatibility instead of carrying executable Runtime");

for (const [shell, game] of [[th06Shell, "th06"], [th07Shell, "th07"]]) {
  assert.match(shell, /Module\.getPreloadedPackage = \(_name, expectedBytes\)/,
    `${game} must use the generated Emscripten preload hook`);
  assert.match(shell, /window\.parent\.__eaglerPrepareManagedRuntimeDataV1/,
    `${game} must receive prepared DATA before the generated loader starts`);
  assert.doesNotMatch(shell, /packageBridge|package-bootstrap|blob:/,
    `${game} must not retain the Blob Package Runtime bridge`);
  assert.match(shell, /FS\.mount\(IDBFS, \{ autoPersist: true \}, saveRoot\)/,
    `${game} saves must remain in a dedicated IDBFS root`);
  assert.match(shell, /params\.get\("runtimeVariant"\) === "multiplayer" \? "\/savesth0[67]-multiplayer" : "\/savesth0[67]"/,
    `${game} multiplayer score and replay files must use an independent IDBFS root`);
  assert.match(shell, /replayViewer: !!options\.replayViewer/,
    `${game} shell must forward the explicit replay-viewer startup intent`);
  assert.match(shell, /sync\(\)\.then\(finish, error => \{/,
    `${game} must flush user data before exit`);
}
for (const [source, game] of [[th06FileSystem, "th06"], [th07FileSystem, "th07"]]) {
  assert.match(source, /EaglerOptions::MultiplayerStorageEnabled\(\)[\s\S]*savesth0[67]-multiplayer/,
    `${game} game-side pref paths must agree with the multiplayer IDBFS mount, not only change the shell mount`);
}

assert.match(app, /function ensureManagedOggStartupBarrier[\s\S]*slice\(0, 2\)[\s\S]*addFileIds: initialIds/,
  "only the first two OGG files may block launch");
assert.match(app, /function startManagedOggProgressiveInstall[\s\S]*for \(const fileId of remaining\)[\s\S]*installManagedPackageResources/,
  "remaining OGG files must become usable one complete file at a time");
assert.match(app, /await askDecision\(\{[\s\S]*confirmText: "立即更新"[\s\S]*secondaryText: "后台下载"[\s\S]*cancelText: "继续当前版本"/,
  "imported/current content must stay launchable while offering remote update association");
assert.match(app, /if \(window\.isSecureContext && "serviceWorker" in navigator\)/,
  "App Shell Service Worker registration must remain a secure-context enhancement");
assert.doesNotMatch(indexHtml, /\?v=20\d{6}/,
  "App Shell assets must not return to hand-maintained date versions");
assert.match(app, /sourceUrl\.searchParams\.set\("runtimeVariant", state\.runtimeVariant \|\| "normal"\)/,
  "legacy and hosted Runtime URLs must select the same isolated multiplayer storage root as Package Runtime URLs");
assert.match(indexHtml, /id="mpShareSettingsToggle"[\s\S]*aria-checked="true"/,
  "multiplayer settings sharing must default on while remaining user-toggleable");
assert.match(indexHtml, /id="mpShareSettingsToggle"[\s\S]*class="file-tools-grid mp-file-tools-grid"[\s\S]*id="mpReplayViewer"[\s\S]*观赏 Replay/,
  "multiplayer settings must expose isolated save/replay tools followed by the Replay viewer entry");

console.log("Local Launcher architecture contract: PASS");
