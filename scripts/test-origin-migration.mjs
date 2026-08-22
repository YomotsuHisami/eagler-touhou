import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../migrate.html", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const packageServer = await readFile(new URL("./package-server.mjs", import.meta.url), "utf8");
const packageTest = await readFile(new URL("./package-test.mjs", import.meta.url), "utf8");
const verifyServer = await readFile(new URL("./verify-server-build.mjs", import.meta.url), "utf8");
const verifyDeployed = await readFile(new URL("./verify-deployed-site.mjs", import.meta.url), "utf8");
const verifyCutover = await readFile(new URL("./verify-origin-cutover.mjs", import.meta.url), "utf8");

for (const needle of [
  'const PROTOCOL = "eagler-touhou/origin-migration/1";',
  'new Set(["/savesth06", "/savesth07", "EM_PRELOAD_CACHE", "eagler-touhou-local-assets-v1"])',
  'const CACHE_PREFIX = "eagler-touhou-";',
  'key.startsWith("eagler-") || key.startsWith("et-loaded-")',
  'target.protocol = "https:";',
  'source.protocol = "http:";',
  'openHttp.href = source.href;',
  '从旧 HTTP 站开始迁移',
  'event.origin !== peerOrigin || event.source !== peer',
  'message.nonce !== nonce',
  'response.arrayBuffer()',
  'await cache.put(req, response);',
  'receiverDbs.set(schema.name, db);',
  'store.put(message.value, message.key)',
  '普通在线播放 OGG 使用浏览器自身的 HTTP 缓存',
  '完整离线 ZIP 导入的 DATA、OGG、Runtime、字体和语言包',
]) assert.ok(html.includes(needle), `migration contract missing: ${needle}`);

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

console.log(JSON.stringify({ singlePage: true, indexedDb: ["/savesth06", "/savesth07", "EM_PRELOAD_CACHE", "eagler-touhou-local-assets-v1"], cachePrefix: "eagler-touhou-", networkUpload: false }));
