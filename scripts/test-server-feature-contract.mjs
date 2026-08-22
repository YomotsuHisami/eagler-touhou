import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async relative => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [configText, packageServer, deployScript, app, html, css, webviewMain, webviewReadme, profileCard] = await Promise.all([
  read("deploy/server-features.json"),
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
assert.equal(config.schema, "eagler-touhou/server-features/1");
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
assert.match(app, /url\.href = gameDataFallback\.url/);
assert.doesNotMatch(app, /蓝奏|lanzou|OpenList/i);
assert.doesNotMatch(app, /experimentalOpen|experimentalOptionsToggle/);
assert.match(html, /id="languageOption"[\s\S]*?id="thpracOption"[\s\S]*?id="mobileOptions"[\s\S]*?id="magnifierOption"/);
assert.doesNotMatch(html, /id="featureColumns"/);
assert.match(html, /id="thpracOption"/);
assert.match(html, /id="thpracToggle"/);
assert.match(html, /id="transferDownload"/);
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
