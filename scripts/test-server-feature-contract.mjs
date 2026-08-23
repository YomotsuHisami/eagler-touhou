import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async relative => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [configText, importOnlyConfigText, packageServer, deployScript, app, html, css, webviewMain, webviewReadme, profileCard] = await Promise.all([
  read("deploy/server-features.json"),
  read("deploy/server-features-import-only.example.json"),
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
assert.equal(config.schema, "eagler-touhou/server-features/1");
assert.equal(config.resourceMode, "hosted", "default deployment must keep hosted resources unless explicitly switched to import-only");
assert.equal(importOnlyConfig.schema, "eagler-touhou/server-features/1");
assert.equal(importOnlyConfig.resourceMode, "import-only", "the low-bandwidth example must explicitly opt into import-only resources");
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
assert.match(packageServer, /\["hosted", "import-only"\]\.includes\(configuredFeatures\.resourceMode\)/);
assert.match(packageServer, /const hostedResources = serverResourceMode === "hosted";/);
assert.match(packageServer, /const builds = hostedResources \? \{ th06: required\("th06-build"\)/,
  "import-only packaging must not require game builds");
assert.match(packageServer, /if \(serverResourceMode === "import-only"\)[\s\S]*delete entry\.runtime;[\s\S]*entry\.music = \{[\s\S]*midi: \{ files: \[\] \}/,
  "import-only deployments must strip the runtime URL and rebuild music metadata without network bases");
assert.match(packageServer, /entry\.offlineCompatibility = \{[\s\S]*schema: "eagler-touhou\/offline-game-pack\/1"[\s\S]*protocol: manifest\.protocol[\s\S]*dataLayout: entry\.gameData\.layout[\s\S]*versionSource: "offline-pack"[\s\S]*requiredShared: \["\/msgothic\.ttc", "\/unifont\.otf"\][\s\S]*languages: \{ source: "offline-pack", baseline: \["ja"\] \}/,
  "import-only manifests must retain runtime/data/shared/language compatibility metadata without publishing resource URLs");
assert.match(packageServer, /if \(serverResourceMode === "hosted"\)[\s\S]*msgothic\.ttc[\s\S]*unifont\.otf/,
  "shared runtime fonts are only published in hosted mode");
assert.match(packageServer, /resourceMode: serverResourceMode/);
assert.match(packageServer, /configured\.gameDataFallback != null/);
assert.match(packageServer, /serverGameDataFallback = \{ url: fallback\.url/);
assert.match(packageServer, /\.\.\.\(serverGameDataFallback \? \{ gameDataFallback: serverGameDataFallback \} : \{\}\)/);
assert.match(packageServer, /expectedUnifontSha256 = "7b62b50acbb186689dc30c446ce4367b87d79489e9907b83255f9fbe0dcfb9e1"/);
assert.match(packageServer, /shared runtime font must be the pinned GNU Unifont 15\.1\.05 OTF/);
assert.match(packageServer, /required\("vanilla-font"\)/);
assert.match(packageServer, /msgothic\.ttc/);
assert.match(deployScript, /-DTH_ENABLE_THPRAC=\$thpracMode/);
assert.match(deployScript, /AttachReallyportable\.cmake/);
assert.match(deployScript, /-DTH_RUNTIME_EXTENSION_CMAKE=/);
assert.match(deployScript, /--feature-config=\$featureConfigPath/);
assert.match(deployScript, /gameDataFallback\.url/);
assert.match(deployScript, /gameDataFallback\.hint/);
assert.match(deployScript, /resourceMode/);
assert.match(deployScript, /'hosted', 'import-only'/);
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
assert.match(app, /activeImportedRuntimeMeta\?\.offline[\s\S]*readLocalImportedAsset\(declaration\.key\)[\s\S]*importedOfflineObjectUrl\(blob\)[\s\S]*path: item\.target/,
  "complete offline bundles must supply shared fonts from IndexedDB without network access");
assert.match(app, /state\.language === "ja"/);
assert.match(app, /state\.language !== "ja" \|\| state\.options\.thpracEnabled/);
assert.match(app, /const gameDataFallback = manifest\.shared\?\.gameDataFallback;/);
assert.match(app, /const serverResourceMode = manifest\.shared\?\.resourceMode \|\| "hosted";/);
assert.match(app, /const importOnlyServer = serverResourceMode === "import-only";/);
assert.match(app, /const validOfflineCompatibility = item => !importOnlyServer \|\|[\s\S]*offlineCompatibility\?\.schema === "eagler-touhou\/offline-game-pack\/1"[\s\S]*runtimeCompatibility\?\.protocol === protocol[\s\S]*runtimeCompatibility\?\.dataLayout === item\.gameData\?\.layout/,
  "host must validate the import-only compatibility descriptor before exposing the site");
assert.match(app, /if \(importOnlyServer && !importedHasOfflineRuntime\)[\s\S]*请先导入完整离线包/,
  "import-only launches must require a complete offline runtime");
assert.match(app, /const sourceUrl = importOnlyServer \? null : new URL\(runtimeUrl\(\), location\.href\);/,
  "import-only mode must not construct a hosted runtime URL");
assert.match(app, /if \(importOnlyServer\) throw new Error\(`完整离线包不可用/,
  "broken complete offline packs must fail instead of falling back to hosted resources");
assert.match(app, /beginImportOnlyAttempt\(\)/);
const launchHandler = app.slice(app.indexOf('$("#launch").addEventListener("click"'), app.indexOf('const fullscreenToggle = $("#fullscreenToggle")'));
const importOnlyGateStart = launchHandler.indexOf("if (!state.launched && importOnlyServer && !readImportedGameDataMeta(state.game)?.offline)");
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
assert.match(html, /id="serverResourceNote"/);
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
