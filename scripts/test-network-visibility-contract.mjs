import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const installer = await readFile(new URL("../package-installer.mjs", import.meta.url), "utf8");
const launcher = await readFile(new URL("../package-launcher.mjs", import.meta.url), "utf8");
const browserTest = await readFile(new URL("./run-launcher-package-first-install-browser-test.mjs", import.meta.url), "utf8");

assert.match(app, /createNetworkActivityTracker\(\{ onChange: scheduleNetworkActivityRender \}\)/,
  "Launcher must own one foreground network activity tracker");
assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*renderNetworkActivity\(networkActivitySnapshot\)/,
  "network progress DOM updates must be coalesced to animation frames");
assert.match(app, /fetchJsonWithTimeout[\s\S]*networkActivity\.fetch\(/,
  "Release Catalog requests must be tracked");
assert.ok((app.match(/fetchImpl:\s*packageTrackedFetch\(state\.game\)/g) || []).length >= 2,
  "Package first-install and update must both use tracked fetch");
assert.match(app, /packageTrackedFetch = gameId => \(input, init\) => networkActivity\.xhrFetch/,
  "Package downloads must use native XHR progress instead of wrapping fetch response streams");
assert.match(app, /ensureManagedOggStartupBarrier[\s\S]*slice\(0, 2\)[\s\S]*addFileIds: initialIds/,
  "a fresh hosted Package install must persist only the first two OGG files before launch");
assert.doesNotMatch(app, /addComponents:\s*isOggMusicMode\(state\.music\)\s*\?\s*\["ogg"\]/,
  "hosted Package installation must not block first launch on the complete OGG component");
assert.match(app, /startManagedOggProgressiveInstall[\s\S]*for \(const fileId of remaining\)[\s\S]*installManagedPackageResources/,
  "remaining OGG files must be persisted then injected one complete file at a time");
assert.match(app, /downloadLanguagePack[\s\S]*networkActivity\.begin\([\s\S]*await fetch\(pack\.url/,
  "Language download must expose request time before first byte");
assert.match(app, /正在准备本地 Runtime…[\s\S]*frame\.src = state\.source/,
  "installed Package Runtime navigation must show an immediate loading state");
assert.match(app, /正在请求运行组件…[\s\S]*frame\.src = state\.source/,
  "Legacy Runtime navigation must show an immediate loading state");
assert.match(installer, /fetchImpl\(url, \{ cache: "no-store", signal \}\)/,
  "Remote Package acquisition must remain injectable through the tracked fetch owner while accepting a blocking-operation AbortSignal");
assert.match(launcher, /fetchImpl\(descriptorUrl, \{ cache: "no-store", signal \}\)/,
  "Package Descriptor acquisition must remain injectable through the tracked fetch owner while accepting a blocking-operation AbortSignal");
assert.match(browserTest, /sawNetworkTransfer/,
  "Real browser first-install E2E must verify that the transfer box actually showed network activity");
assert.match(app, /state\.game !== "th07" \|\| state\.runtimeVariant !== "multiplayer"/,
  "multiplayer diagnostics must stay hidden for every ordinary game Runtime");
assert.match(app, /if \(mode !== "lan"\) return null/,
  "multiplayer diagnostics must require the running LAN Runtime, not only Launcher selection state");
assert.match(index, /id="runtimeNetplayQualityDiag" hidden/,
  "network quality needs a dedicated line so mobile ellipsis does not hide it behind ICE path details");
assert.match(app, /currentRoundTripTime[\s\S]*quality\.samples\.length > 20[\s\S]*p95 - p50/,
  "RTC diagnostics must expose rolling RTT and transparent variation rather than an opaque score");
assert.match(app, /peer\.pc\.connectionState[\s\S]*peer\.pc\.iceConnectionState/,
  "RTC diagnostics must expose live PeerConnection and ICE state");
assert.match(app, /entry\.family[\s\S]*ICE \$\{net\.rtcPaths\.map/,
  "RTC diagnostics must expose selected IPv4 or IPv6 family without exposing the address");
assert.match(app, /confirmedAt = performance\.now\(\)[\s\S]*输入停顿/,
  "RTC diagnostics must expose how long confirmed remote input has stopped advancing");
assert.match(app, /__eaglerNetplayLanPeers[\s\S]*gap[\s\S]*pred[\s\S]*rollbacks/,
  "RTC diagnostics must expose per-peer confirmation, prediction and rollback pressure");

console.log("Network visibility contract: PASS");
