import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async relative => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [configText, importOnlyConfigText, importPartialConfigText, packageServer, deployScript, app, html, css, webviewMain, webviewReadme, profileCard] = await Promise.all([
  read("deploy/server-features.json"),
  read("deploy/server-features-import-only.example.json"),
  read("deploy/server-features-import-partial.example.json"),
  read("scripts/package-server.mjs"),
  read("deploy/Prepare-eagler-touhou-server.ps1"),
  read("app.js"),
  read("index.html"),
  read("styles.css"),
  read("android-webview-lab/src/vip/touhou/webviewlab/MainActivity.java"),
  read("android-webview-lab/README.md"),
  read("scripts/profile-card-selection.mjs"),
]);

const config = JSON.parse(configText);
const importOnlyConfig = JSON.parse(importOnlyConfigText);
const importPartialConfig = JSON.parse(importPartialConfigText);
assert.equal(config.schema, "eagler-touhou/server-features/1");
assert.equal(config.resourceMode, "hosted", "default deployment must keep hosted resources unless explicitly switched to import-only");
assert.equal(importOnlyConfig.schema, "eagler-touhou/server-features/1");
assert.equal(importOnlyConfig.resourceMode, "import-only", "the low-bandwidth example must explicitly opt into import-only resources");
assert.equal(importPartialConfig.schema, "eagler-touhou/server-features/1");
assert.equal(importPartialConfig.resourceMode, "import-partial", "sparse Runtime publishing must explicitly opt into import-partial resources");
assert.equal(config.gameDataFallback, undefined, "default server feature config must not bind deployments to an external download provider");
for (const game of ["th06", "th07"]) {
  assert.ok(Array.isArray(config.games?.[game]?.languages) && config.games[game].languages.length > 0, `${game}: language allowlist missing`);
  assert.equal(typeof config.games[game].thprac, "boolean", `${game}: thprac capability missing`);
  assert.equal(new Set(config.games[game].languages).size, config.games[game].languages.length, `${game}: duplicate language allowlist`);
}

assert.match(packageServer, /const allowlist = serverFeatures\[game\]\.languages;/);
assert.match(packageServer, /entry\.languageOptions = selectableIds\.map/);
assert.match(packageServer, /"lang_zh-hans": "中文（简体）"/);
assert.match(packageServer, /lang_en: "English"/);
assert.match(packageServer, /lang_ru: "Русский"/);
assert.match(packageServer, /canonicalLanguageIds/);
assert.match(packageServer, /THPRAC_PORTABLE_ENABLED=1/);
assert.match(packageServer, /full reallyportable adapter, not the ImGui shell alone/);
assert.match(packageServer, /entry\.features = \{ \.\.\.\(entry\.features \|\| \{\}\), thprac: !!serverFeatures\[game\]\.thprac \};/);
assert.match(packageServer, /let serverGameDataFallback = null;/);
assert.match(packageServer, /const serverResourceMode = configuredFeatures\?\.resourceMode \|\| "hosted";/);
assert.match(packageServer, /\["hosted", "import-only", "import-partial"\]\.includes\(configuredFeatures\.resourceMode\)/);
assert.match(packageServer, /const hostedResources = serverResourceMode === "hosted";/);
assert.match(packageServer, /const builds = \{[\s\S]*th06: required\("th06-build"\)[\s\S]*th06Multiplayer: required\("th06-multiplayer-build"\)[\s\S]*th07Multiplayer: required\("th07-multiplayer-build"\)/,
  "every deployment must publish its supported Runtime as App Shell content");
assert.match(packageServer, /assertAppManagedRuntimeShell[\s\S]*__eaglerPrepareManagedRuntimeDataV1[\s\S]*Module\.getPreloadedPackage/,
  "publication must reject stale Runtime shells that cannot consume Launcher-managed DATA");
assert.match(packageServer, /packageBridge\|package-bootstrap\|__eaglerPackageBootstrapState/,
  "publication must reject Runtime shells that still carry the retired Package Runtime bridge");
assert.match(packageServer, /const multiplayerBuild = builds\[`\$\{game\}Multiplayer`\][\s\S]*assertAppManagedRuntimeShell\(multiplayerBuild, game, "multiplayer"\)/,
  "both multiplayer publications must pass the same managed-DATA shell gate as normal Runtime");
assert.match(packageServer, /normal and multiplayer Runtime builds must use identical shared DATA content\/layout/,
  "publication must reject Runtime variants whose shared DATA identity or layout differs");
assert.match(packageServer, /if \(serverResourceMode !== "hosted"\)[\s\S]*entry\.music = \{[\s\S]*midi: \{ files: \[\] \}/,
  "local-package deployments must keep App-managed Runtime while removing network game-content bases");
assert.match(packageServer, /entry\.offlineCompatibility = \{[\s\S]*schema: "eagler-touhou\/offline-game-pack\/1"[\s\S]*protocol: manifest\.protocol[\s\S]*dataLayout: entry\.gameData\.layout[\s\S]*versionSource: "offline-pack"[\s\S]*requiredShared: \["\/msgothic\.ttc", "\/unifont\.otf"\][\s\S]*languages: \{ source: "offline-pack", baseline: \["ja"\] \}/,
  "import-only manifests must retain runtime/data/shared/language compatibility metadata without publishing resource URLs");
assert.match(packageServer, /if \(serverResourceMode === "hosted"\)[\s\S]*msgothic\.ttc[\s\S]*unifont\.otf/,
  "shared runtime fonts are only published in hosted mode");
assert.match(packageServer, /resourceMode: serverResourceMode/);
const serverVerifier = await read("scripts/verify-server-build.mjs");
assert.match(serverVerifier, /import-only deployment must not publish game\/shared payloads, Runtime updates, or releases/,
  "import-only verification must remain strictly resource-free");
assert.match(serverVerifier, /htmlPaths\.push\([\s\S]*eagler-touhou\/runtime\/th06[\s\S]*eagler-touhou\/runtime\/th07/,
  "verification must treat supported Runtime files as App Shell content in every resource mode");
assert.match(packageServer, /configured\.gameDataFallback != null/);
assert.match(packageServer, /serverGameDataFallback = \{ url: fallback\.url/);
assert.match(packageServer, /!hostedResources && !serverGameDataFallback[\s\S]*requires gameDataFallback\.url/,
  "import-only and import-partial publication must fail visibly when the import link is missing");
assert.match(packageServer, /\.\.\.\(serverGameDataFallback \? \{ gameDataFallback: serverGameDataFallback \} : \{\}\)/);
assert.match(packageServer, /expectedUnifontSha256 = "7b62b50acbb186689dc30c446ce4367b87d79489e9907b83255f9fbe0dcfb9e1"/);
assert.match(packageServer, /shared runtime font must be the pinned GNU Unifont 15\.1\.05 OTF/);
assert.match(packageServer, /required\("vanilla-font"\)/);
assert.match(packageServer, /msgothic\.ttc/);
assert.match(deployScript, /-DTH_ENABLE_THPRAC=\$thpracMode/);
assert.match(deployScript, /AttachReallyportable\.cmake/);
assert.match(deployScript, /-DTH_RUNTIME_EXTENSION_CMAKE=/);
assert.match(deployScript, /-DTH_ENABLE_MULTIPLAYER_GAMEPLAY=ON -DTH_ENABLE_NETPLAY=ON/);
assert.match(deployScript, /foreach \(\$game in @\('th06', 'th07'\)\)[\s\S]*build-\$game-multiplayer/,
  "deployment must build isolated multiplayer binaries for both games");
assert.match(deployScript, /--th06-multiplayer-build=\$\(\$multiplayerBuilds\.th06\)/);
assert.match(deployScript, /--th07-multiplayer-build=\$\(\$multiplayerBuilds\.th07\)/);
assert.match(deployScript, /--feature-config=\$featureConfigPath/);
assert.match(deployScript, /gameDataFallback\.url/);
assert.match(deployScript, /gameDataFallback\.hint/);
assert.match(deployScript, /\$resourceMode -in @\('import-only', 'import-partial'\)[\s\S]*requires gameDataFallback\.url/,
  "PowerShell deployment must reject an import server whose Open Link action would be empty");
assert.match(deployScript, /resourceMode/);
assert.match(deployScript, /'hosted', 'import-only', 'import-partial'/);
assert.match(deployScript, /dependencies\\unifont-15\.1\.05\\unifont-15\.1\.05\.otf/);
assert.match(deployScript, /Fonts\\msgothic\.ttc/);

assert.match(app, /manifest\.games\[gameId\]\.languageOptions/);
assert.match(app, /"lang_zh-hans": "中文（简体）"/);
assert.match(app, /lang_ru: "Русский"/);
assert.match(app, /thpracLocaleForLanguage/);
assert.match(app, /gameFeatures\(gameId\)\.thprac/);
assert.match(app, /thpracToggle: state\.options\.thpracEnabled/);
assert.match(app, /target: "\/msgothic\.ttc"/);
assert.match(app, /target: "\/unifont\.otf"/);
assert.match(app, /return wanted\.map\(item => \(\{ url: new URL\(item\.network, location\.href\)\.href, path: item\.target \}\)\)/,
  "online shared fonts must still mount to the same runtime FS paths");
assert.match(app, /activeLegacyImportedAssetsMeta[\s\S]*readLocalImportedAsset\(declaration\.key\)[\s\S]*importedContentObjectUrl\(blob\)[\s\S]*path: item\.target/,
  "legacy complete bundles must supply shared fonts from IndexedDB without executing their bundled Runtime");
assert.match(app, /state\.language === "ja"/);
assert.match(app, /state\.language !== "ja" \|\| state\.options\.thpracEnabled/);
assert.match(app, /let gameDataFallback = null;/);
assert.match(app, /let serverResourceMode = "hosted";/);
assert.match(app, /let importOnlyServer = false;/);
assert.match(app, /applyLegacyManifest[\s\S]*serverResourceMode = manifest\.shared\?\.resourceMode \|\| "hosted"[\s\S]*importOnlyServer = serverResourceMode !== "hosted"[\s\S]*gameDataFallback = manifest\.shared\?\.gameDataFallback \|\| null/,
  "remote compatibility metadata must update the mutable legacy fallback state without blocking local boot");
assert.match(app, /serverConfigurationWarning = importOnlyServer && !gameDataFallback[\s\S]*部署配置错误/,
  "old misconfigured import servers must show a prominent operator warning instead of silently disabling Open Link");
assert.match(app, /const validOfflineCompatibility = \(item, resourceMode\) => resourceMode === "hosted" \|\|[\s\S]*offlineCompatibility\?\.schema === "eagler-touhou\/offline-game-pack\/1"[\s\S]*runtimeCompatibility\?\.protocol === protocol[\s\S]*runtimeCompatibility\?\.dataLayout === item\.gameData\?\.layout/,
  "host must validate the import-only compatibility descriptor before exposing the site");
assert.match(app, /if \(importOnlyServer && !importedDataCompatible\)[\s\S]*请先导入本地游戏包/,
  "import-only legacy launches must require DATA compatible with the current App-managed Runtime");
assert.match(app, /const sourceUrl = new URL\(runtimeUrl\(\), location\.href\);/,
  "import-only mode must use the same App-managed Runtime URL instead of a bundled Runtime");
assert.doesNotMatch(app, /createImportedRuntimeSource|offline-runtime\/|iframe\.src\s*=\s*blob:/,
  "no deployment mode may execute a legacy bundled Runtime document");
assert.match(app, /if \(importOnlyServer\) throw new Error\(`本地游戏包不可用/,
  "broken complete offline packs must fail instead of falling back to hosted resources");
assert.match(app, /beginImportOnlyAttempt\(\)/);
const launchHandler = app.slice(app.indexOf('$("#launch").addEventListener("click"'), app.indexOf('const fullscreenToggle = $("#fullscreenToggle")'));
const importOnlyGateStart = launchHandler.indexOf("if (!state.launched && importOnlyServer && !installedPackageSnapshots.has(state.game) && !readImportedGameDataMeta(state.game)?.legacyAssets)");
const inputWarningStart = launchHandler.indexOf("if (!state.launched && !await confirmInputWarnings()) return;");
assert.ok(importOnlyGateStart >= 0 && inputWarningStart > importOnlyGateStart,
  "import-only must route to complete-pack import before any ordinary launch/input warning flow");
const importOnlyGate = launchHandler.slice(importOnlyGateStart, inputWarningStart);
assert.doesNotMatch(importOnlyGate, /openPlayerView|enterPlayerFullscreen|launchConfiguredRuntime/,
  "missing import-only resources must not open the player, enter fullscreen, or start a runtime before import");
assert.match(importOnlyGate, /beginImportOnlyAttempt\(\);\s*return;/,
  "missing import-only resources must stop at the import UI owner");
assert.match(launchHandler, /if \(importOnlyServer && !state\.launched\)[\s\S]*closePlayerView\(\)[\s\S]*beginImportOnlyAttempt\(\)[\s\S]*gameDataFallbackText\(message\)[\s\S]*return;/,
  "an invalid/damaged complete import-only pack must leave the player and return to the same explicit import path");
assert.match(app, /url\.href = gameDataFallback\.url/);
assert.doesNotMatch(app, /蓝奏|lanzou|OpenList/i);
assert.doesNotMatch(app, /experimentalOpen|experimentalOptionsToggle/);
assert.match(html, /id="languageOption"[\s\S]*?id="thpracOption"[\s\S]*?id="mobileOptions"[\s\S]*?id="magnifierOption"/);
assert.doesNotMatch(html, /id="featureColumns"/);
assert.match(html, /id="thpracOption"/);
assert.match(html, /id="thpracToggle"/);
assert.match(html, /id="transferDownload"/);
assert.doesNotMatch(html, /id="serverResourceNote"/, "import-only mode must not add a redundant resource-mode card");
assert.match(html, /id="decisionDialog"/);
assert.match(html, /id="toastClose"/);
assert.doesNotMatch(html, /id="toastCountdown"|id="toastLife"/);
assert.match(css, /\.decision-dialog\{/);
assert.match(css, /\.toast-close\{/);
assert.match(css, /\.toast\.show:after\{[^}]*height:2px[^}]*animation:toast-life-bar 2s linear forwards/);
assert.doesNotMatch(css, /\.toast-life\{|conic-gradient/);
assert.match(css, /\.mobile-options-body\{[^}]*margin-left:9px;[^}]*padding-left:10px;[^}]*border:0/);
assert.doesNotMatch(css, /\.mobile-options-body\{[^}]*border-left:/);
assert.match(css, /\.mobile-option\{[^}]*font:10px/);

assert.match(css, /@media\(min-width:781px\)\{\.main\.has-selection \.tools\{[^}]*overflow-y:auto/);
assert.match(css, /@media\(max-width:780px\)[\s\S]*?\.main\.has-selection \.tools\{[^}]*overflow:visible/);

for (const [source, label] of [
  [webviewMain, "Android WebView default"],
  [webviewReadme, "Android WebView README default"],
  [profileCard, "profile-card default"],
]) {
  assert.match(source, /http:\/\/touhou\.vip\/eagler-touhou\//, `${label} must stay on the current HTTP origin until the explicit HTTPS cutover`);
}

console.log(JSON.stringify({
  serverLanguages: Object.fromEntries(["th06", "th07"].map(game => [game, config.games[game].languages])),
  thprac: Object.fromEntries(["th06", "th07"].map(game => [game, config.games[game].thprac])),
  toolsScroll: "desktop-only",
}));
