import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../migrate.html", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const gameDataImport = await readFile(new URL("../game-data-import.mjs", import.meta.url), "utf8");
const packageServer = await readFile(new URL("./package-server.mjs", import.meta.url), "utf8");
const packageTest = await readFile(new URL("./package-test.mjs", import.meta.url), "utf8");
const verifyServer = await readFile(new URL("./verify-server-build.mjs", import.meta.url), "utf8");
const verifyDeployed = await readFile(new URL("./verify-deployed-site.mjs", import.meta.url), "utf8");
const verifyCutover = await readFile(new URL("./verify-origin-cutover.mjs", import.meta.url), "utf8");

for (const needle of [
  'const PROTOCOL = "eagler-touhou/origin-migration/1";',
  'const AUTH_KEY = "eagler-touhou-origin-migration-authorized-v1";',
  'new Set(["/savesth06", "/savesth07", "EM_PRELOAD_CACHE", "eagler-touhou-local-assets-v1"])',
  'const CACHE_PREFIX = "eagler-touhou-";',
  '!key.startsWith("eagler-touhou-origin-migration-")',
  'target.protocol = "https:";',
  'source.protocol = "http:";',
  'id="sourceAddress"',
  'id="targetAddress" type="hidden"',
  'id="openHttp" type="button" hidden><span>前往旧站</span><span>→</span></button>',
  'setSide("http", "旧站"',
  'setSide("receiver", "接收中"',
  'upgraded ? "旧站未打开" : "数据迁移"',
  'location.href = sourceLink.href;',
  'openGameLabel.textContent = newSite.href;',
  'openGame.hidden = false;',
  'source.searchParams.set("sourceMode", "http")',
  'authorization.sourceOrigin !== source.origin',
  'authorization.targetOrigin !== location.origin',
  'authorization.expires < Date.now()',
  'localStorage.removeItem(AUTH_KEY);',
  'event.origin !== peerOrigin || event.source !== peer',
  'message.nonce !== nonce',
  'response.arrayBuffer()',
  'await cache.put(req, response);',
  'receiverDbs.set(schema.name, db);',
  'store.put(message.value, message.key)',
]) assert.ok(html.includes(needle), `migration contract missing: ${needle}`);

for (const removedCopy of [
  '正在读取当前旧站中的玩家数据。',
  '正在读取当前旧站的数据。',
  '普通在线播放 OGG 使用浏览器自身的 HTTP 缓存',
  '完整离线 ZIP 导入的 DATA、OGG、Runtime、字体和语言包',
  '旧站数据仍保存在原来的地址中。请先前往旧站进行迁移。',
  '如果浏览器会自动跳到新站，可以手动填写旧服务器 IP 或其它旧站地址。',
]) assert.ok(!html.includes(removedCopy), `migration page must not contain removed copy: ${removedCopy}`);

assert.ok(html.includes('<h1 id="pageTitle">旧站迁移</h1>'), "migration page heading must match the concise navigation label");
assert.ok(html.includes('如果点击按钮后又回到这里，请尝试复制上面的地址并手动在浏览器导航栏中打开。'), "old-site address guidance must match the fallback navigation instruction");

assert.doesNotMatch(html, /<b>新 HTTPS 地址<\/b>/, "new HTTPS target must stay internal until migration completes");
assert.doesNotMatch(html, /id="copyHttp"/, "HTTPS navigator must not add secondary copy-address UI");
assert.doesNotMatch(html, /localDevHost/, "origin migration must not use localhost-only routing/security bypasses");
assert.ok(html.includes('if (location.protocol === "https:") {\n      configureHttpsHome'), "HTTPS must always enter the new-site navigator before sender setup");
assert.ok(html.includes('if (location.protocol !== "http:") {\n      setStatus("当前页面不是可用的 HTTP 旧站。", "bad");'), "sender mode must only run on a real HTTP origin");
assert.match(html, /body\[data-side="https"\] \.grid[\s\S]*display:none!important/, "normal HTTPS page must hide migration inventory and stay a minimal navigator");
assert.match(html, /body\[data-side="http"\] \.route\{display:none!important\}/, "HTTP sender must not show the HTTPS/HTTP address configuration panel");
assert.ok(html.includes('setStatus("扫描完成。");'), "HTTP sender must keep the post-scan status to one concise sentence");
assert.match(html, /\.route-actions button span:last-child[\s\S]*color:var\(--red-bright\)[\s\S]*font-size:20px/, "migration actions must reuse the launch-button arrow treatment");
assert.match(html, /\.status\{min-height:0;padding:10px 12px;border:1px solid rgba\(235,231,223,\.22\);border-radius:3px;background:#171615;box-shadow:none/, "migration notices must use a plain bordered status surface rather than the old alert-card treatment");
assert.match(html, /\.edge-note\{padding:0;border:0;border-radius:0;background:none/, "Edge fallback notice must stay plain text rather than a warning card");
assert.match(html, /min-height:58px[\s\S]*background:#0b0e0b[\s\S]*justify-content:space-between/, "migration actions must use the main launch-button structure");
assert.match(html, /\.route-actions,\.actions\{display:flex;justify-content:flex-end/, "migration actions must stay right-aligned");
assert.match(html, /width:auto;[\s\S]*min-width:180px;[\s\S]*border:1px solid #bfc5bc/, "migration actions must stay content-sized while keeping the visible launch-button border");
assert.match(html, /button\.primary,body\[data-side="http"\] button\.primary,body\[data-side="receiver"\] button\.primary\{background:#0b0e0b;color:#e9ece7;box-shadow:3px 3px 0 #000,inset 1px 1px 0 #2b302a\}/, "migration primary actions must match the main launch surface");
assert.match(html, /body\[data-side="http"\] details\[open\]\{display:flex;flex-direction:column-reverse\}/, "migration log must expand upward from the bottom of the HTTP page");

// Storage-coverage audit.  Player data must not silently move into a new
// persistence API or namespace without being added to the origin migrator.
for (const forbidden of ["sessionStorage", "document.cookie", "navigator.storage.getDirectory", "showDirectoryPicker"]) {
  assert.ok(!app.includes(forbidden) && !gameDataImport.includes(forbidden),
    `persistent browser storage path is not covered by origin migration: ${forbidden}`);
}
for (const keyContract of [
  'const touchLayoutStorageKey = "eagler-touhou-touch-layout-v1";',
  'const touchHelpSeenKey = "eagler-touch-help-seen-v8";',
  'const lessMotionStorageKey = "eagler-touhou-less-motion-v1";',
  'const preferenceKey = gameId => `eagler-touhou-game-options-v1-${gameId}`;',
  'const languagePreferenceKey = gameId => `eagler-touhou-language-v1-${gameId}`;',
  'const touchLayoutWindowPositionsStorageKey = "eagler-touhou-touch-layout-window-positions-v1";',
]) assert.ok(app.includes(keyContract), `host localStorage contract moved outside the migratable namespace: ${keyContract}`);
assert.ok(gameDataImport.includes('return `eagler-touhou-ogg-import-v1-${game}`;'), "OGG import metadata must remain in the migratable localStorage namespace");
assert.ok(gameDataImport.includes('return `eagler-touhou-game-data-import-v1-${game}`;'), "DATA import metadata must remain in the migratable localStorage namespace");
assert.ok(app.includes('const emPreloadCacheName = "EM_PRELOAD_CACHE";'), "Emscripten preload database contract changed without migration coverage");
assert.ok(app.includes('const localAssetDbName = "eagler-touhou-local-assets-v1";'), "local imported-asset database contract changed without migration coverage");
assert.ok(gameDataImport.includes('export const GAME_DATA_CACHE_NAME = "eagler-touhou-game-data-v1";'), "game-data Cache Storage must remain under the migratable cache prefix");
assert.ok(app.includes('const languageCacheName = "eagler-touhou-language-packs-v1";'), "language Cache Storage must remain under the migratable cache prefix");
assert.match(app, /function localAssetIdbKey\(key\)[\s\S]*url\.pathname\.startsWith\("\/\.eagler-local\/"\)[\s\S]*return url\.pathname/,
  "imported asset IndexedDB keys must remain origin-independent across HTTP -> HTTPS migration");
assert.match(app, /function runtimePreloadPackageName\(sourceUrl, gameId = state\.game\)[\s\S]*url\.pathname[\s\S]*encodeURIComponent\(directory\)/,
  "Emscripten preload package keys must remain path-based rather than origin-based");
assert.match(html, /function rewriteCacheUrl\(url, sourceOrigin\)[\s\S]*parsed\.origin !== sourceOrigin[\s\S]*location\.origin/,
  "Cache Storage migration must rewrite old HTTP request origins to the HTTPS origin");

assert.doesNotMatch(html, /ET Unifont/, "migration page must use the themed Yatra/Chill Round font stack without Unifont fallback");
assert.match(html, /body\[data-side="http"\]/, "HTTP old-site mode needs an explicit visual theme");
assert.match(html, /body\[data-side="https"\]/, "HTTPS new-site mode needs an explicit visual theme");
assert.match(html, /body\[data-side="receiver"\]/, "HTTPS receiver mode needs an explicit visual theme");

assert.doesNotMatch(html, /<script\b[^>]+src=/i, "migration page must stay a single self-contained HTML file");
assert.doesNotMatch(html, /<link\b[^>]+stylesheet/i, "migration page must not depend on an external stylesheet");
assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|sendBeacon\s*\(/, "migration page must not upload/fetch player data through the server");
assert.match(packageServer, /"migrate\.html"/, "production packager must publish migrate.html");
assert.match(packageTest, /"migrate\.html"/, "test package must publish migrate.html");
assert.match(verifyServer, /eagler-touhou\/migrate\.html/, "production verifier must require migrate.html");
assert.match(verifyDeployed, /eagler-touhou\/migrate\.html/, "remote verifier must validate migrate.html");
assert.match(verifyCutover, /redirect:\s*"manual"/, "cutover verifier must reject HTTP migration redirects rather than following them");
assert.match(verifyCutover, /strict-transport-security/i, "cutover verifier must reject HSTS during the migration window");
assert.match(verifyCutover, /http\.sha256 !== https\.sha256/, "cutover verifier must require identical HTTP/HTTPS migration pages");
assert.match(indexHtml, /id="originMigrationOpen"[^>]+href="migrate\.html"[^>]+hidden/, "main UI must contain a migration entry hidden by default");
assert.ok(app.includes('originMigrationOpen.hidden = location.protocol !== "https:";'), "main UI migration entry must only be revealed on HTTPS");
assert.match(indexHtml, /更新<\/span><wbr><span>日志/, "masthead changelog may only wrap between 更新 and 日志");
assert.match(indexHtml, /旧站<\/span><wbr><span>迁移/, "masthead migration may only wrap between 旧站 and 迁移");
assert.match(indexHtml, /常见<\/span><wbr><span>问题/, "masthead FAQ may only wrap between 常见 and 问题");

console.log(JSON.stringify({ singlePage: true, indexedDb: ["/savesth06", "/savesth07", "EM_PRELOAD_CACHE", "eagler-touhou-local-assets-v1"], cachePrefix: "eagler-touhou-", networkUpload: false }));
