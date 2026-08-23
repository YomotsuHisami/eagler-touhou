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
assert.match(app, /importedDataCompatible = !!importedData && \(importedHasOfflineRuntime \|\| importedData\.layout === expectedData\.layout\)/,
  "v1 imports must use current-runtime layout compatibility while complete v2 bundles own their matching runtime");
assert.match(app, /primeImportedGameDataForRuntime\(sourceUrl, importedData\)/,
  "compatible local imports must prime Emscripten's preload cache so an online cache cannot steal ownership");
assert.match(app, /eaglerLocalImport: meta\.version/,
  "Emscripten preload metadata must remember which local import owns the current package slot");
assert.match(app, /sourceUrl\?\.searchParams\.set\("asset", useImportedData && !importedHasOfflineRuntime \? importedData\.version : expectedData\.version\)/,
  "v1 runtime iframe must receive an imported data version while v2 bundles use their own local runtime");
assert.match(app, /if \(sourceUrl && ogg && typeof ogg\.version === "string"\) sourceUrl\.searchParams\.set\("oggAsset", importedOgg\?\.version \|\| ogg\.version\)/,
  "imported OGG must remain preferred even when the website publishes another OGG version");
assert.match(app, /继续使用你导入的本地版本，不会强制更新/,
  "newer website data must be informational rather than a forced imported-resource update");
assert.match(app, /message: "你导入的本地版本仍然可以继续使用，不会被强制更新或删除。[\s\S]*confirmText: "尝试网站新版"[\s\S]*cancelText: "继续本地版本"/,
  "stale compatible imports must offer, not force, a website-first update attempt through the shared decision dialog");
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
assert.match(app, /await writeLocalImportedAssets\(storedAssets\);\s*await mirrorImportedAssetsToCache\(cacheMirrorAssets\);/,
  "imports must commit all assets to IndexedDB first and only mirror legacy DATA\/OGG assets to Cache Storage opportunistically");
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
assert.match(app, /music: localMusicResources \? "midi" : state\.music[\s\S]*await localMusicInstall\.installInitial\(\)[\s\S]*Module\.touhouMusicMode = "ogg"[\s\S]*await send\("launch"\)/,
  "local OGG must not block configure on blob fetches and must switch the runtime to OGG before launch");
assert.match(app, /function resetRuntime\(\)[\s\S]*revokeImportedOfflineObjectUrls\(\);[\s\S]*frame\.removeAttribute\("src"\)/,
  "runtime reset must release offline-runtime blob URLs");
assert.match(app, /async function createImportedRuntimeSource\(meta, importedOgg\)[\s\S]*replaceAll\("window\.location\.pathname", JSON\.stringify\(stableRuntimePath\)\)[\s\S]*Module\.locateFile[\s\S]*wasmUrl/,
  "v2 imports must synthesize a local runtime with a stable Emscripten preload owner and local WASM URL");
assert.match(app, /const templatePattern = \/<template[\s\S]*eagler-runtime-script-template[\s\S]*content\\\.querySelector[\s\S]*html = html\.replace\(templatePattern, runtimeScript\)/,
  "TH07 v2 runtime synthesis must replace the complete inert template + injector owner rather than only the nested script");
assert.match(app, /primeImportedGameDataForRuntime\(offlineRuntime\.preloadSource, importedData, importedData\.version, importedData\.layout\)/,
  "v2 DATA must be primed against the bundled runtime's own UUID/layout");
assert.match(app, /async function selectedSharedResources\(\)[\s\S]*activeImportedRuntimeMeta\?\.offline[\s\S]*readLocalImportedAsset\(declaration\.key\)[\s\S]*importedOfflineObjectUrl\(blob\)/,
  "fonts required by an offline runtime must come from IndexedDB-backed bundle assets");
assert.match(app, /if \(pack\.localKey\)[\s\S]*readLocalImportedAsset\(pack\.localKey\)/,
  "bundled language packs must be read locally instead of fetched");
assert.match(app, /const runtimePackUrl = typeof pack\.url === "string" && pack\.url[\s\S]*new URL\(pack\.localKey, location\.origin\)\.href[\s\S]*url: runtimePackUrl/,
  "bundled language packs must present a same-origin virtual provenance URL to the hosted shell");
assert.match(app, /readLanguagePackResponse\(response, pack, noteNetworkActivity = null\)[\s\S]*kind: "language", mode: "language"/,
  "real language-pack downloads must be visible in the shared transfer window");
assert.match(app, /async function downloadLanguagePack\(pack, cacheMode\)[\s\S]*const timeoutMs = 15_000;[\s\S]*controller\.abort\(\)[\s\S]*15 秒内没有继续收到数据（网络 \/ CDN 超时）/,
  "language-pack downloads must abort a CDN/network stall instead of leaving the black player open indefinitely");
assert.match(app, /function isResourceLoadFailure\(error\)[\s\S]*CDN[\s\S]*Failed to fetch/,
  "the host must classify bounded network/resource failures separately from generic runtime failures");
assert.match(app, /if \(!state\.launched && isResourceLoadFailure\(error\)\)[\s\S]*await closePlayerView\(\)[\s\S]*beginGameDataAttempt\(\);[\s\S]*unlockGameDataImport\(/,
  "a network/CDN launch failure must leave the dead black player and reopen the complete-offline-package fallback flow");
assert.match(app, /const firstFrameFallbackMs = 12_000;[\s\S]*function armFirstFrameWatchdog\(\)[\s\S]*stage=first-frame-timeout[\s\S]*runtime_ready=\$\{state\.ready\}[\s\S]*launch_ack=\$\{state\.launched\}/,
  "the host must distinguish a loaded runtime that never presents its first frame from resource/CDN failures");
assert.match(app, /这已经越过 DATA \/ 语言包 \/ 字体 \/ 音乐等资源下载阶段[\s\S]*浏览器 WebGL\/WASM/,
  "first-frame timeout guidance must explicitly classify the failure as post-resource browser/runtime territory");
assert.match(app, /armFirstFrameWatchdog\(\);\s*try \{\s*await send\("launch"\)[\s\S]*message\.event === "first-frame"[\s\S]*noteFirstFrame\(\)/,
  "the first-frame watchdog must cover the launch boundary and be cleared only by the runtime acknowledgement");
assert.match(app, /LANGUAGE DOWNLOADING\.\.\./,
  "the transfer window must have an explicit language-pack phase");
for (const needle of ["OFFLINE_GAME_PACK_SCHEMA", "offline/runtime", "offline/shared", "offline/languages", "production.languageOptions", "musicFiles"]) {
  assert.ok(offlinePackager.includes(needle), `offline packager contract missing: ${needle}`);
}

assert.match(html, /id="runtimeDiagnostics"[\s\S]*id="runtimeFpsDiag">FPS --<\/span>[\s\S]*id="runtimeGapDiag">MAX --<\/span>[\s\S]*id="runtimeAudioDiag">AUD --<\/span>[\s\S]*id="runtimeRendererDiag">GPU --<\/span>/,
  "the persistent runtime diagnostic strip must use separate lines instead of dot-separated fields");
assert.doesNotMatch(html, /runtimePerfDiag|FPS -- ·/,
  "runtime diagnostics must not regress to a dot-separated combined line");
for (const event of ["runtime-info", "frame-health", "audio-health"]) {
  assert.match(app, new RegExp(`message\\.event === "${event}"`),
    `host must consume ${event} diagnostics from the embedded runtime`);
}

const games = JSON.parse(await readFile(new URL("../games.json", import.meta.url), "utf8"));
assert.equal(games.shared.gameDataFallback, undefined,
  "the development manifest must not bind Eagler to any specific external download provider");
assert.match(app, /const gameDataFallback = manifest\.shared\?\.gameDataFallback;/,
  "the host may consume an optional deployment-provided external fallback URL");
assert.match(app, /url\.href = gameDataFallback\.url/,
  "the link-detail window may expose the deployment-provided external download URL rather than auto-downloading a ZIP");
assert.match(app, /hint\.textContent = gameDataFallback\.hint \|\| "无"/,
  "the link-detail window must surface the deployment-provided extraction-code hint");
assert.match(html, /id="gameDataImportWindow"[\s\S]*?id="gameDataImportClose"[\s\S]*?id="transferImport"[\s\S]*?id="transferDownload"/,
  "manual fallback must use a separate closable import window containing Import and Open Link actions");
assert.match(html, /window\.__eaglerBoot = boot[\s\S]*addEventListener\("error"[\s\S]*addEventListener\("unhandledrejection"[\s\S]*12000/,
  "index.html must own a classic-script startup watchdog that survives app-module/manifest failure");
assert.match(html, /window\.__eaglerBoot && window\.__eaglerBoot\.mark\("app-module-request"\)[\s\S]*type="module" src="app\.js\?v=/,
  "the independent watchdog must know whether the app module was ever requested");
assert.match(app, /bootWatchdog\?\.mark\("app-module-executing"\)[\s\S]*async function fetchManifest\(\)[\s\S]*controller\.abort\(\)[\s\S]*games\.json: 12 秒内没有完成请求（网络 \/ CDN 超时）/,
  "games.json must have a visible bounded failure after the module starts executing");
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
assert.match(app, /如果觉得加载太慢，也可以点击「打开链接」/,
  "the first import window should point to the link window without exposing provider credentials");
assert.doesNotMatch(app, /const hint = gameDataFallback\.hint \? `（\$\{gameDataFallback\.hint\}）`/,
  "the first import window must not interpolate the extraction code or provider hint");
assert.match(app, /if \(firstUnlock && !attempt\.dialogDismissed\) openGameDataImportWindow\(\)/,
  "10s/20s fallback must auto-open the centered import window");
assert.match(app, /if \(importOnlyServer && !imported\.offlineComplete\)[\s\S]*当前服务器不提供游戏资源，请导入包含 Runtime \/ DATA \/ 字体等启动资源的完整离线包/,
  "import-only must reject DATA-only/legacy imports even when their DATA layout is otherwise compatible");
const installImportedBody = app.slice(app.indexOf("async function installImportedGameData(file)"), app.indexOf("async function ensureRuntime(show = true)"));
assert.match(installImportedBody, /if \(importOnlyServer\) \{[\s\S]*!pack\.offline \|\| pack\.manifest\.schema !== compatibility\.schema[\s\S]*compatibility\.requiredShared/,
  "import-only must validate the complete-pack schema/shared compatibility contract before persistence");
assert.ok(installImportedBody.indexOf("if (importOnlyServer) {") < installImportedBody.indexOf("await writeLocalImportedAssets(storedAssets);"),
  "DATA-only imports must be rejected before they can replace persistent imported assets on an import-only server");
assert.match(app, /if \(importOnlyServer && gameDataAttempt\?\.importOnly && imported\.offlineComplete && !state\.launched\)[\s\S]*clearGameDataAttempt\(\);[\s\S]*setStatus\("完整离线包已导入，可以启动游戏"\);[\s\S]*render\(\);[\s\S]*return;/,
  "successful import-only imports must close the import flow and wait for an explicit second launch instead of crossing runtime state machines automatically");
assert.match(app, /function finishGameDataAttempt\(\) \{\s*closeGameDataFallbackWindows\(\);/,
  "runtime GAME DATA completion must force-close both fallback windows");
assert.match(app, /message\.event === "ready"[\s\S]*finishGameDataAttempt\(\)/,
  "the authoritative runtime-ready boundary must close fallback UI before the game is considered ready");
assert.match(app, /游戏数据仍在加载，当前速度可能较慢。/,
  "a slow but progressing download must be described as slow rather than failed");
assert.match(app, /如果觉得加载太慢，也可以点击「打开链接」，从高速网盘下载完整离线包后再导入。完整离线包包含启动所需资源/,
  "slow downloads must offer the complete offline bundle rather than a data-only fallback");
assert.match(app, /20 秒内仍没有收到游戏数据，网站下载似乎没有正常开始。/,
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
