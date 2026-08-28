import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { parseStoredGameDataPack, localGameDataCacheUrl, localOggCacheUrl, GAME_DATA_PACK_SCHEMA, OFFLINE_GAME_PACK_SCHEMA } from "../game-data-import.mjs";

const data = strToU8("DATA-PAYLOAD");
const sha256 = "0123456789abcdef".repeat(4);
const layout = `sha256-${"fedcba9876543210".repeat(4)}`;
const manifest = {
  schema: GAME_DATA_PACK_SCHEMA,
  game: "th07",
  version: `sha256-${sha256}`,
  data: { path: "th07.data", layout, bytes: data.length, sha256 }
};
const stored = zipSync({
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "th07.data": data
}, { level: 0 });
const parsed = await parseStoredGameDataPack(new Blob([stored]));
assert.equal(parsed.manifest.game, "th07");
assert.equal(parsed.manifest.version, manifest.version);
assert.equal(parsed.data.method, 0);
assert.equal(new TextDecoder().decode(await parsed.data.blob.arrayBuffer()), "DATA-PAYLOAD");
assert.equal(localGameDataCacheUrl("https://example.test", "th07", manifest.version),
  `https://example.test/.eagler-local/game-data/th07/${encodeURIComponent(manifest.version)}/th07.data`);

const ogg = strToU8("OGG-PAYLOAD");
const oggSha256 = "abcdef0123456789".repeat(4);
const fullManifest = {
  ...manifest,
  music: {
    mode: "ogg",
    version: `sha256-${oggSha256}`,
    files: [{ path: "th07_01.ogg", bytes: ogg.length, sha256: oggSha256 }]
  }
};
const fullStored = zipSync({
  "manifest.json": strToU8(JSON.stringify(fullManifest)),
  "th07.data": data,
  "th07_01.ogg": ogg
}, { level: 0 });
const fullParsed = await parseStoredGameDataPack(new Blob([fullStored]));
assert.equal(fullParsed.music.length, 1);
assert.equal(fullParsed.music[0].method, 0);
assert.equal(new TextDecoder().decode(await fullParsed.music[0].blob.arrayBuffer()), "OGG-PAYLOAD");
assert.equal(localOggCacheUrl("https://example.test", "th07", fullManifest.music.version, "th07_01.ogg"),
  `https://example.test/.eagler-local/ogg/th07/${encodeURIComponent(fullManifest.music.version)}/th07_01.ogg`);

const runtimeVersion = "0123456789abcdef";
const runtimeHtml = strToU8("<html>runtime</html>");
const runtimeJs = strToU8("console.log('runtime')");
const runtimeWasm = new Uint8Array([0, 97, 115, 109]);
const msgothic = strToU8("font-ttc");
const unifont = strToU8("font-otf");
const languageZip = strToU8("language-zip");
const hashA = "11".repeat(32), hashB = "22".repeat(32), hashC = "33".repeat(32);
const hashD = "44".repeat(32), hashE = "55".repeat(32), hashF = "66".repeat(32);
const offlineManifest = {
  ...fullManifest,
  schema: OFFLINE_GAME_PACK_SCHEMA,
  offline: {
    runtime: {
      version: runtimeVersion,
      files: [
        { role: "html", path: "offline/runtime/th07.html", bytes: runtimeHtml.length, sha256: hashA },
        { role: "js", path: "offline/runtime/th07.js", bytes: runtimeJs.length, sha256: hashB },
        { role: "wasm", path: "offline/runtime/th07.wasm", bytes: runtimeWasm.length, sha256: hashC }
      ]
    },
    shared: [
      { target: "/msgothic.ttc", path: "offline/shared/msgothic.ttc", bytes: msgothic.length, sha256: hashD },
      { target: "/unifont.otf", path: "offline/shared/unifont.otf", bytes: unifont.length, sha256: hashE }
    ],
    languages: [
      { id: "lang_zh-hans", title: "中文（简体）", path: "offline/languages/lang_zh-hans.zip",
        bytes: languageZip.length, sha256: hashF, runtimeVersion }
    ]
  }
};
const offlineStored = zipSync({
  "manifest.json": strToU8(JSON.stringify(offlineManifest)),
  "th07.data": data,
  "th07_01.ogg": ogg,
  "offline/runtime/th07.html": runtimeHtml,
  "offline/runtime/th07.js": runtimeJs,
  "offline/runtime/th07.wasm": runtimeWasm,
  "offline/shared/msgothic.ttc": msgothic,
  "offline/shared/unifont.otf": unifont,
  "offline/languages/lang_zh-hans.zip": languageZip
}, { level: 0 });
const offlineParsed = await parseStoredGameDataPack(new Blob([offlineStored]));
assert.equal(offlineParsed.manifest.schema, OFFLINE_GAME_PACK_SCHEMA);
assert.equal(offlineParsed.offline.runtime.version, runtimeVersion);
assert.deepEqual(offlineParsed.offline.runtime.files.map(file => file.role), ["html", "js", "wasm"]);
assert.deepEqual(offlineParsed.offline.shared.map(file => file.target), ["/msgothic.ttc", "/unifont.otf"]);
assert.deepEqual(offlineParsed.offline.languages.map(file => file.id), ["lang_zh-hans"]);

const compressed = zipSync({
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "th07.data": new Uint8Array(4096).fill(65)
}, { level: 6 });
await assert.rejects(() => parseStoredGameDataPack(new Blob([compressed])), /must use STORE/);

const extra = zipSync({
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "th07.data": data,
  "unexpected.bin": strToU8("x")
}, { level: 0 });
await assert.rejects(() => parseStoredGameDataPack(new Blob([extra])), /unexpected game-data pack entry/);

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const offlinePackager = await readFile(new URL("./package-offline-game.mjs", import.meta.url), "utf8");
assert.match(app, /const gameDataStartFallbackMs = 10_000;/, "manual import must not unlock before the 10s no-first-byte boundary");
assert.match(app, /const gameDataCompleteFallbackMs = 20_000;/, "manual import must have the 20s incomplete-transfer boundary");
assert.match(app, /loaded > 0 && !attempt\.firstByte/, "10s gate must be cancelled by the first real GAME DATA payload byte");
assert.match(app, /total > 0 && loaded >= total && !attempt\.downloadComplete/, "20s gate must be cancelled by completed GAME DATA, not runtime-ready timing");
assert.doesNotMatch(app, /pack\.manifest\.version !== expected\.version|该本地数据包不是当前网站要求的新版本/,
  "older self-valid local imports must not be rejected merely for being older than the website");
assert.match(app, /actualHash\.toLowerCase\(\) !== pack\.manifest\.data\.sha256\.toLowerCase\(\)/,
  "imports must verify their own declared data hash rather than the website's current hash");
assert.match(app, /importedDataCompatible = !!importedData && importedData\.layout === expectedData\.layout/,
  "all legacy imports must use current App Runtime layout compatibility; bundled Runtime is never executable");
assert.match(app, /primeImportedGameDataForRuntime\(sourceUrl, importedData\)/,
  "compatible local imports must prime Emscripten's preload cache so an online cache cannot steal ownership");
assert.match(app, /eaglerLocalImport: meta\.version/,
  "Emscripten preload metadata must remember which local import owns the current package slot");
assert.match(app, /const sourceUrl = new URL\(runtimeUrl\(\), location\.href\)[\s\S]*sourceUrl\.searchParams\.set\("asset", useImportedData \? importedData\.version : expectedData\.version\)/,
  "legacy imported DATA must run through the ordinary App-managed Runtime URL in every deployment mode");
assert.match(app, /if \(ogg && typeof ogg\.version === "string"\) sourceUrl\.searchParams\.set\("oggAsset", importedOgg\?\.version \|\| ogg\.version\)/,
  "imported OGG must remain preferred even when the website publishes another OGG version");
assert.match(app, /继续使用你导入的本地版本，不会强制更新/,
  "newer server data must be informational rather than a forced imported-resource update");
assert.match(app, /message: "你导入的本地版本仍然可以继续使用，不会被强制更新或删除。[\s\S]*confirmText: "尝试服务器版本"[\s\S]*cancelText: "继续本地版本"/,
  "stale compatible imports must offer, not force, a server-current-version attempt through the shared decision dialog");
assert.match(app, /importedDataUpdateChoices\.set\(`\$\{state\.game\}:\$\{imported\.version\}->\$\{current\.version\}`, "local"\)/,
  "an explicit fallback import must override an earlier one-session website-update choice");
assert.doesNotMatch(app, /discardImportedGameData\(staleImportedData\)/,
  "a successful website load must never delete an older user-imported resource");
assert.match(app, /const localAssetDbName = "eagler-touhou-local-assets-v1";/,
  "persistent imported DATA/OGG must have an IndexedDB owner that also works on ordinary HTTP origins");
assert.match(app, /async function openLocalAssetDb\(\)[\s\S]*indexedDB\.open\(localAssetDbName, 1\)/,
  "the local asset owner must open its own IndexedDB rather than depend on Cache Storage");
assert.match(app, /async function writeLocalImportedAssets\(entries\)[\s\S]*const db = await openLocalAssetDb\(\)/,
  "persistent imported assets must be written through the IndexedDB owner");
assert.match(app, /function localAssetIdbKey\(key\)[\s\S]*url\.pathname\.startsWith\("\/\.eagler-local\/"\)[\s\S]*return url\.pathname/,
  "IndexedDB asset keys must be origin-independent so HTTP-to-HTTPS migration keeps imported resources addressable");
assert.doesNotMatch(app, /if \(!globalThis\.caches\?\.open\) throw new Error\("当前浏览器不支持持久化游戏数据导入"\)/,
  "ordinary HTTP origins without Cache Storage must not be rejected before ZIP parsing/import");
assert.match(app, /if \(!globalThis\.indexedDB\?\.open\) throw new Error\("当前浏览器不支持持久化游戏数据导入：IndexedDB 不可用"\)/,
  "IndexedDB is the actual persistence capability gate");
assert.match(app, /await writeLocalImportedAssets\(\[\.\.\.cacheMirrorAssets, \.\.\.legacyStoredAssets\]\);\s*await mirrorImportedAssetsToCache\(cacheMirrorAssets\);/,
  "imports must persist legacy content assets to IndexedDB while mirroring only DATA\/OGG to Cache Storage opportunistically");
assert.match(app, /const local = await readLocalImportedAsset\(localGameDataCacheUrl/,
  "runtime preload priming must read the IndexedDB-backed local DATA owner");
assert.match(app, /async function selectedMusicResources\(\)[\s\S]*localKey: localOggCacheUrl\(location\.origin, state\.game, imported\.version, name\)/,
  "imported OGG must keep stable IndexedDB keys instead of being converted into host blob URLs");
assert.doesNotMatch(app, /async function selectedMusicResources\(\)[\s\S]*URL\.createObjectURL\(blob\)/,
  "imported OGG must not take the old IndexedDB -> blob URL -> iframe fetch double-copy path");
assert.match(app, /function createLocalMusicInstall\(resources\)[\s\S]*readLocalImportedAsset\(resource\.localKey\)[\s\S]*fs\.writeFile\(resource\.path, new runtimeWindow\.Uint8Array\(buffer\), \{ canOwn: true \}\)/,
  "imported OGG must be copied directly from IndexedDB into the same-origin runtime FS");
assert.match(app, /function createLocalMusicInstall\(resources\)[\s\S]*const pack = musicPackage\(\);[\s\S]*const mount = typeof pack\?\.mount === "string"[\s\S]*const allowedPaths = new Set[\s\S]*allowedPaths\.has\(resource\.path\)/,
  "local OGG path validation must follow each game's declared mount/files instead of hard-coding one title's BGM directory");
assert.doesNotMatch(app, /\^\\\/bgm\\\//,
  "local OGG installation must not hard-code TH06's /bgm mount because TH07 uses /bgm-ogg");
assert.match(app, /music: localMusicResources \? "midi" : musicTransportMode\(state\.music\)[\s\S]*await localMusicInstall\.installInitial\(\)[\s\S]*Module\.touhouMusicMode = "ogg"[\s\S]*await send\("launch"\)/,
  "local OGG must not block configure on blob fetches and must switch the runtime to OGG before launch");
assert.match(app, /state\.musicPreferenceExplicit = saved\?\.musicPreferenceExplicit === true/,
  "restored music choices must distinguish explicit user selection from an automatic fallback");
assert.match(app, /if \(state\.music === "midi"\)[\s\S]*localOggReady && !state\.musicPreferenceExplicit[\s\S]*state\.music = "ogg-stream"/,
  "a complete local package must repair an automatically selected MIDI fallback back to OGG");
assert.match(app, /Missing resources may require a temporary MIDI fallback[\s\S]*state\.music = "midi";[\s\S]*return;/,
  "temporary MIDI fallback must not be persisted as a user choice");
assert.match(app, /function resetRuntime\(\)[\s\S]*revokeImportedContentObjectUrls\(\);[\s\S]*frame\.removeAttribute\("src"\)/,
  "runtime reset must release temporary legacy content Blob URLs");
assert.match(app, /import \{[^}]*readPackageObject[^}]*\} from "\.\/package-store\.mjs";/,
  "Package-backed language loading must import readPackageObject from Package Store");
assert.doesNotMatch(app, /createImportedRuntimeSource|offlineRuntime\.url|offline-runtime\/|Module\.locateFile.*wasmUrl/,
  "legacy imports must never synthesize or execute bundled HTML\/JS\/WASM Runtime documents");
assert.match(app, /pack\.offline[\s\S]*Legacy complete packs are content sources only[\s\S]*const shared = \[\][\s\S]*const languages = \[\]/,
  "legacy complete packs may preserve shared and language content while ignoring their executable Runtime files");
assert.match(app, /async function selectedSharedResources\(\)[\s\S]*activeLegacyImportedAssetsMeta[\s\S]*readLocalImportedAsset\(declaration\.key\)[\s\S]*importedContentObjectUrl\(blob\)/,
  "legacy shared fonts may use temporary content Blob URLs without Blob document navigation");
assert.match(app, /if \(pack\.localKey\)[\s\S]*readLocalImportedAsset\(pack\.localKey\)/,
  "bundled language packs must be read locally instead of fetched");
const packageInstaller = await readFile(new URL("../package-installer.mjs", import.meta.url), "utf8");
assert.match(packageInstaller,
  /installParsedPackageZip[\s\S]*return sliced\.arrayBuffer\(\)/,
  "local Package ZIP entries must be materialized to independent ArrayBuffer bytes before IndexedDB persistence");
assert.doesNotMatch(packageInstaller,
  /installParsedPackageZip[\s\S]*new Blob\(\[/,
  "local Package ZIP installation must not re-wrap materialized bytes as Blob before persistence");
assert.match(app, /const runtimePackUrl = typeof pack\.url === "string" && pack\.url[\s\S]*new URL\(pack\.localKey, location\.origin\)\.href[\s\S]*url: runtimePackUrl/,
  "bundled language packs must present a same-origin virtual provenance URL to the hosted shell");
assert.match(app, /readLanguagePackResponse\(response, pack, noteNetworkActivity = null, networkTaskId = null\)[\s\S]*kind: "language", mode: "language"/,
  "real language-pack downloads must be visible in the shared transfer window");
assert.match(app, /async function downloadLanguagePack\(pack, cacheMode\)[\s\S]*const timeoutMs = 15_000;[\s\S]*controller\.abort\(\)[\s\S]*15 秒内没有继续收到数据（网络 \/ CDN 超时）/,
  "language-pack downloads must abort a CDN/network stall instead of leaving the black player open indefinitely");
assert.match(app, /function isResourceLoadFailure\(error\)[\s\S]*CDN[\s\S]*Failed to fetch/,
  "the host must classify bounded network/resource failures separately from generic runtime failures");
assert.match(app, /if \(!state\.launched && isResourceLoadFailure\(error\)\)[\s\S]*await closePlayerView\(\)[\s\S]*beginManualGamePackageImport\(/,
  "a network/CDN launch failure must leave the dead black player and reopen the manual game-package import flow without pretending a download is still active");
assert.match(app, /if \(!state\.launched && isCancelledDownload\(error\)\)[\s\S]*beginManualGamePackageImport\(\)[\s\S]*下载已取消，可以导入本地游戏包/,
  "a user-cancelled blocking download must immediately enter the manual game-package import flow");
assert.match(app, /const firstFrameFallbackMs = 12_000;[\s\S]*function armFirstFrameWatchdog\(\)[\s\S]*stage=first-frame-timeout[\s\S]*runtime_ready=\$\{state\.ready\}[\s\S]*launch_ack=\$\{state\.launched\}/,
  "the host must distinguish a loaded runtime that never presents its first frame from resource/CDN failures");
assert.match(app, /async function closePlayerView\(fromHistory = false, \{ skipSync = false \} = \{\}\)[\s\S]*if \(!skipSync && state\.ready\) await send\("sync", \{\}, 3000\)/,
  "normal Player close must retain save sync while allowing an already-exited Runtime to skip the dead RPC wait");
assert.match(app, /if \(message\.event === "exit"\)[\s\S]*closePlayerView\(false, \{ skipSync: true \}\)/,
  "Runtime exit must close immediately instead of waiting up to three seconds for a sync reply from a dead Runtime");
assert.match(app, /这已经越过游戏资源、语言包、字体和音乐等下载阶段[\s\S]*浏览器 WebGL\/WASM/,
  "first-frame timeout guidance must explicitly classify the failure as post-resource browser/runtime territory");
assert.match(app, /armFirstFrameWatchdog\(\);[\s\S]{0,900}startPlayerFocusRelay\(\);[\s\S]{0,300}await send\("launch"\)/,
  "the first-frame watchdog must cover the Android focus relay and launch boundary");
assert.match(app, /if \(message\.event === "first-frame"\) \{[\s\S]{0,400}noteFirstFrame\(\)/,
  "the first-frame watchdog must be cleared only by the runtime first-frame acknowledgement");
assert.match(app, /正在下载语言包…/,
  "the transfer window must have an explicit language-pack phase");
for (const needle of ["validatePackageDescriptor", '"package.json"', "descriptor.files", "declaration.source", "zipSync(entries, { level: 0 })"]) {
  assert.ok(offlinePackager.includes(needle), `Package ZIP packager contract missing: ${needle}`);
}
assert.doesNotMatch(offlinePackager, /OFFLINE_GAME_PACK_SCHEMA|offline\/runtime|offline\/shared|offline\/languages/,
  "new official ZIPs must use the remote Package Descriptor directly instead of a second offline schema");

assert.match(html, /id="runtimeDiagnostics"[\s\S]*id="runtimeBrowserDiag">浏览器 --<\/span>[\s\S]*id="runtimeUaDiag">环境 --<\/span>[\s\S]*id="runtimeAudioDiag">音频 --<\/span>[\s\S]*id="runtimeRendererDiag">显卡 --<\/span>[\s\S]*id="runtimeGapDiag">最大间隔 --<\/span>/,
  "the persistent runtime diagnostic strip must prioritize browser identity and keep each field on its own line");
for (const id of ["runtimeNetplaySessionDiag", "runtimeNetplayRouteDiag", "runtimeNetplayFrameDiag", "runtimeNetplayRollbackDiag", "runtimeNetplayIceDiag"]) {
  assert.ok(html.includes(`id="${id}" hidden`), `multiplayer diagnostic line must exist and remain hidden for ordinary play: ${id}`);
}
for (const marker of ["__eaglerNetplayTransport", "__eaglerNetplayPath", "__eaglerNetplayLanFrame", "__eaglerNetplayLanConfirmed", "__eaglerNetplayLanRollback", "__eaglerNetplayLanResimulated", "__eaglerNetplayLanFrameAdvantage", "__eaglerNetplayLanPacingScale", "__eaglerNetplayRtcPaths", "__th07PeerTransport"]) {
  assert.ok(app.includes(marker), `multiplayer diagnostics must expose existing runtime telemetry: ${marker}`);
}
assert.ok(!app.includes("·") && !html.includes("·"),
  "Launcher UI copy must use hyphens instead of the forbidden middle-dot separator");
assert.match(app, /state\.product === "th07mp" \|\| state\.runtimeVariant === "multiplayer"/,
  "TH07MP diagnostics must remain visible even when a runtimeVariant downgrade is exactly the bug being diagnosed");
for (const obsolete of ["NOW LOADING...", "PLAYER LOADING...", "RUNTIME REQUEST...", "LANGUAGE DOWNLOADING...", "OGG NOT READY", ">BR --<", ">UA --<", ">AUD --<", ">GPU --<", ">MAX --<"]) {
  assert.ok(!html.includes(obsolete) && !app.includes(obsolete), `post-launch non-key UI must not regress to English label: ${obsolete}`);
}
assert.ok(!html.includes(">GAME DATA<"), "post-launch transfer label must remain Chinese even if GAME DATA survives in internal comments");
assert.doesNotMatch(html, /runtimeFpsDiag|>FPS --<|runtimePerfDiag|FPS -- [^<]/,
  "the persistent runtime diagnostics must not display FPS or regress to a dot-separated combined line");
assert.match(app, /function browserEnvironmentLabels\(\)/,
  "host diagnostics must own a compact browser/runtime identity formatter");
for (const browserMarker of ["Via", "Android WebView", "Samsung Internet", "QQ Browser", "UC Browser", "Huawei Browser", "Mi Browser"]) {
  assert.ok(app.includes(browserMarker), `host browser diagnostics must recognize ${browserMarker}`);
}
assert.match(app, /`Chromium \$\{chromeVersion\}`/,
  "host diagnostics must expose the Chromium build because browser-family names alone are not sufficiently diagnostic");
for (const event of ["runtime-info", "frame-health", "audio-health"]) {
  assert.match(app, new RegExp(`message\\.event === "${event}"`),
    `host must consume ${event} diagnostics from the embedded runtime`);
}

const games = JSON.parse(await readFile(new URL("../games.json", import.meta.url), "utf8"));
assert.equal(games.shared.gameDataFallback, undefined,
  "the development manifest must not bind Eagler to any specific external download provider");
assert.match(app, /let gameDataFallback = null;[\s\S]*applyLegacyManifest[\s\S]*gameDataFallback = manifest\.shared\?\.gameDataFallback \|\| null/,
  "the host may consume an optional deployment-provided external fallback URL when remote compatibility metadata becomes available");
assert.match(app, /url\.href = gameDataFallback\.url/,
  "the link-detail window may expose the deployment-provided external download URL rather than auto-downloading a ZIP");
assert.match(app, /hint\.textContent = gameDataFallback\.hint \|\| "无"/,
  "the link-detail window must surface the deployment-provided extraction-code hint");
assert.match(html, /id="gameDataImportWindow"[\s\S]*?id="gameDataImportClose"[\s\S]*?id="transferImport"[\s\S]*?id="transferDownload"/,
  "manual fallback must use a separate closable import window containing Import and Open Link actions");
assert.match(html, /class="launch-wrap"[\s\S]*?id="launch"[\s\S]*?id="gamePackageImport"[^>]*hidden[\s\S]*?<span>导入<\/span>[\s\S]*?launch-icon/,
  "the Launcher must keep a hidden-by-default secondary Import action beside Start");
assert.match(app, /\$\("#gamePackageImport"\)\.hidden = false;/,
  "the same explicit Import action must remain reachable in hosted, import-only, and import-partial modes");
assert.match(app, /#gamePackageImport"\)\.addEventListener\("click"[\s\S]*?beginManualGamePackageImport\(/,
  "the persistent Import action must open the shared manual-import window");
assert.doesNotMatch(app, /#gamePackageImport"\)\.addEventListener\("click"[\s\S]{0,300}?#gameDataImportInput"\)\.click\(\)/,
  "the persistent Import action must not jump straight to the native file picker");
assert.match(html, /window\.__eaglerBoot = boot[\s\S]*addEventListener\("error"[\s\S]*addEventListener\("unhandledrejection"[\s\S]*12000/,
  "index.html must own a classic-script startup watchdog that survives app-module/manifest failure");
assert.match(html, /window\.__eaglerBoot && window\.__eaglerBoot\.mark\("app-module-request"\)[\s\S]*type="module" src="app\.js"/,
  "the independent watchdog must know whether the app module was ever requested");
assert.match(app, /bootWatchdog\?\.mark\("app-module-executing"\)[\s\S]*async function fetchJsonWithTimeout[\s\S]*controller\.abort\(\)[\s\S]*let remoteReleasePromise = refreshRemoteReleaseState\(\)/,
  "remote release metadata must keep a bounded request while refreshing in the background");
assert.match(app, /remoteCatalogError = error;[\s\S]*catalog-unavailable[\s\S]*installed game startup remains available/,
  "remote metadata failure must remain UNKNOWN instead of failing the local Launcher boot");
assert.match(app, /render\(\); setStatus\("选择游戏后即可启动"\);\s*bootWatchdog\?\.ready\(\);/,
  "the pre-app watchdog must only be cleared after the normal UI is initialized");
assert.match(html, /id="gameDataLinkWindow"[\s\S]*?id="gameDataLinkClose"[\s\S]*?id="gameDataFallbackUrl"[\s\S]*?id="gameDataFallbackHint"/,
  "Open Link must reveal a separate closable window containing the URL and extraction-code hint");
assert.match(html, /id="gameDataFallbackUrl" href="#" target="_blank" rel="noopener noreferrer"/,
  "the displayed fallback URL must be a real clickable external link");
assert.match(app, /target instanceof Element && target\.closest\("#gameDataLinkWindow"\)/,
  "the link-detail window must be exempt from player browser-gesture suppression so text can be selected/copied");
assert.match(css, /\.game-data-link-window,\.game-data-link-window \*\{[^}]*-webkit-user-select:text!important;[^}]*user-select:text!important;[^}]*-webkit-touch-callout:default!important/,
  "the link-detail window must explicitly restore text selection/copy behavior");
assert.match(app, /\$\("#gameDataFallbackUrl"\)\.addEventListener\("click", event => \{[\s\S]*?window\.open\(gameDataFallback\.url, "_blank"\)[\s\S]*?opened\.opener = null[\s\S]*?event\.preventDefault\(\)/,
  "the fallback URL click must explicitly open a new tab and preserve the anchor as a popup-blocker fallback");
assert.match(css, /\.game-data-import-window,[^{]*\.game-data-link-window\{[^}]*left:50%;[^}]*top:50%;[^}]*transform:translate\(-50%,-50%\)/,
  "the import/link windows must be independently centered over the game viewport");
assert.doesNotMatch(html, /id="transferImportOpen"/,
  "the original transfer panel must not expose an Import entry");
assert.doesNotMatch(app, /transferImportOpen/,
  "the original transfer panel must remain decoupled from fallback import UI");
assert.match(app, /如果当前下载太慢，也可以点击「打开链接」取得游戏包后导入/,
  "the first import window should point to the link window without exposing provider credentials");
assert.doesNotMatch(app, /const hint = gameDataFallback\.hint \? `（\$\{gameDataFallback\.hint\}）`/,
  "the first import window must not interpolate the extraction code or provider hint");
assert.match(app, /if \(firstUnlock && !attempt\.dialogDismissed\) openGameDataImportWindow\(\)/,
  "10s/20s fallback must auto-open the centered import window");
assert.match(app, /if \(importOnlyServer && !imported\.offlineComplete\)[\s\S]*当前服务器不提供游戏文件，请导入包含启动所需文件的游戏包/,
  "import-only must still reject DATA-only imports that do not contain the legacy shared content needed for offline play");
const installImportedBody = app.slice(app.indexOf("async function installImportedGameData(file)"), app.indexOf("async function ensureRuntime(show = true)"));
assert.match(installImportedBody, /if \(importOnlyServer\) \{[\s\S]*!pack\.offline[\s\S]*\["\/msgothic\.ttc", "\/unifont\.otf"\]/,
  "import-only legacy compatibility must require complete-pack shared resources while ignoring its bundled Runtime");
assert.ok(installImportedBody.indexOf("if (importOnlyServer) {") < installImportedBody.indexOf("await writeLocalImportedAssets([...cacheMirrorAssets, ...legacyStoredAssets]);"),
  "DATA-only imports must be rejected before they can replace persistent imported assets on an import-only server");
assert.match(app, /if \(importOnlyServer && gameDataAttempt\?\.importOnly && imported\.offlineComplete && !state\.launched\)[\s\S]*clearGameDataAttempt\(\);[\s\S]*setStatus\("游戏包已导入，可以启动游戏"\);[\s\S]*render\(\);[\s\S]*return;/,
  "successful import-only imports must close the import flow and wait for an explicit second launch instead of crossing runtime state machines automatically");
assert.match(app, /function finishGameDataAttempt\(\) \{\s*closeGameDataFallbackWindows\(\);/,
  "runtime GAME DATA completion must force-close both fallback windows");
assert.match(app, /message\.event === "ready"[\s\S]*finishGameDataAttempt\(\)/,
  "the authoritative runtime-ready boundary must close fallback UI before the game is considered ready");
assert.match(app, /游戏数据仍在加载，当前速度可能较慢。/,
  "a slow but progressing download must be described as slow rather than failed");
assert.match(app, /如果当前下载太慢，也可以点击「打开链接」取得游戏包后导入。手动导入的本地版本不会被服务器自动替换/,
  "slow downloads must offer a local game package rather than a data-only fallback");
assert.match(app, /20 秒内仍没有收到游戏数据，服务器资源下载似乎没有正常开始。/,
  "a true no-data timeout may explicitly say that loading did not start normally");
assert.doesNotMatch(app, /fetch\(gameDataFallback\.url|fetch\(manifest\.shared\.gameDataFallback\.url/,
  "the game must never fetch the external fallback directory automatically");
assert.doesNotMatch(app, /蓝奏|lanzou|OpenList/i,
  "the Eagler host must stay provider-neutral");
for (const game of ["th06", "th07"]) {
  const data = games.games[game].gameData;
  assert.equal(data.version, `sha256-${data.sha256}`, `${game} gameData.version must identify data bytes, not JS/WASM runtime version`);
  assert.match(data.layout, /^sha256-[a-f0-9]{64}$/i, `${game} must publish an independent game-data layout identity`);
  assert.equal(data.path, `${game}.data`);
  assert.ok(data.bytes > 0);
  const oggPack = games.games[game].music.ogg;
  assert.match(oggPack.version, /^sha256-[a-f0-9]{64}$/i, `${game} OGG set must have a content version`);
  assert.equal(oggPack.files.length, oggPack.sizes.length, `${game} OGG sizes must cover every file`);
  assert.equal(oggPack.files.length, oggPack.sha256.length, `${game} OGG hashes must cover every file`);
  assert.ok(oggPack.sha256.every(hash => /^[a-f0-9]{64}$/i.test(hash)), `${game} OGG hashes must be SHA-256`);
  const shell = await readFile(new URL(`../../${game}-eagler/resources/shell.html`, import.meta.url), "utf8");
  assert.match(shell, /const fetchResourceBytes = async \(url, init = \{\}, callbacks = \{\}\) => \{[\s\S]*const timeoutMs = 15000;[\s\S]*controller\.abort\(\)[\s\S]*15 秒内没有继续收到数据（网络 \/ CDN 超时）/,
    `${game} hosted shell must bound runtime/font/OGG CDN stalls`);
  assert.match(shell, /await fetchResourceBytes\(url, \{ cache: "force-cache" \}/,
    `${game} hosted shell resource downloads must use the bounded fetch owner`);
  assert.match(shell, /globalThis\.EaglerTouhouFirstFrame = \(\) => \{ emit\("first-frame"\); emitRuntimeInfo\(\); \};/,
    `${game} hosted shell must expose the first-present observability bridge`);
  assert.match(shell, /globalThis\.EaglerTouhouFrameHealth = \(fps, maxGapMs\) => emit\("frame-health"/,
    `${game} hosted shell must expose low-rate presentation health`);
  assert.match(shell, /globalThis\.EaglerTouhouAudioHealth = \(queuedMs, minQueuedMs, robust\)[\s\S]*backend: "script"[\s\S]*underruns: 0/,
    `${game} hosted shell must report queue health without changing the verified ScriptProcessor backend`);
  assert.doesNotMatch(shell, /AudioWorklet|eagler-sdl-playback|prepareRobustAudioOutput/,
    `${game} rejected AudioWorklet playback experiment must not remain in the hosted shell`);
  assert.match(shell, /const gameDataVersion = params\.get\("asset"\) \|\| "";/, `${game} shell must receive exact data version`);
  assert.match(shell, /const oggAssetVersion = params\.get\("oggAsset"\) \|\| "";/, `${game} shell must receive exact OGG version`);
  assert.match(shell, /caches\.match\(localGameDataUrl\)/, `${game} shell must check the local imported-data cache`);
  assert.match(shell, /caches\.match\(localOgg\)/, `${game} shell must check the local imported-OGG cache`);
  assert.match(shell, /requestUrl\.pathname\.endsWith\(`\/\$\{game\}\.data`\)/, `${game} local bridge must only intercept the game data fetch`);
  assert.match(shell, /return nativeFetch\(input, init\);/, `${game} local bridge must preserve normal website download fallback`);

  const baseline = JSON.parse(await readFile(new URL(`../../${game}-eagler/scripts/ogg_server_baseline.json`, import.meta.url), "utf8"));
  const converter = await readFile(new URL(`../../${game}-eagler/scripts/convert_bgm_ogg.py`, import.meta.url), "utf8");
  assert.equal(baseline.schema, "eagler-touhou/ogg-server-baseline/1");
  assert.equal(baseline.game, game);
  assert.equal(baseline.quality, 0.55, `${game} production OGG quality must remain the current server quality`);
  assert.deepEqual(oggPack.files.map((name, index) => ({ name, bytes: oggPack.sizes[index], sha256: oggPack.sha256[index] })),
    Object.entries(baseline.files).map(([name, entry]) => ({ name, bytes: entry.bytes, sha256: entry.sha256 })),
    `${game} games.json OGG identity must be the exact frozen production-server bytes`);
  assert.match(converter, /pin_ogg_serial\(destination, int\(expected\["serial"\], 0\)\)/,
    `${game} converter must pin the current server Ogg stream serial`);
  assert.match(converter, /checksum = ogg_crc\(data\[offset:page_end\]\)/,
    `${game} converter must recompute Ogg page CRC after pinning the serial`);
  assert.match(converter, /--quality must remain/,
    `${game} converter must fail closed instead of silently changing production OGG quality`);
}
const rekey = await readFile(new URL("./rekey-runtime-data-cache.mjs", import.meta.url), "utf8");
assert.doesNotMatch(rekey, /Date\.now\(\)|-rekey-/,
  "runtime cache-busting must not invalidate byte-identical Emscripten game-data caches");
assert.match(rekey, /expectedPackageUuid = `sha256-\$\{dataSha256\}`/,
  "web-downloaded game-data cache identity must be the actual .data content hash");

console.log("stored ZIP game-data import contract: PASS");
