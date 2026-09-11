import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FRONTEND_PACKAGE_FILES, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import {
  applyStaticTranslations,
  UI_LOCALES,
  UI_MESSAGES,
  resolveUiLocale,
  setUiLocale,
  t,
  validateUiCatalogs,
} from "../.cache/build/browser/assets/launcher/i18n.mjs";

const index = await readFile(resolveFrontendPackageSource("index.html"), "utf8");

assert.deepEqual(UI_LOCALES, ["zh-CN", "en"]);
assert.equal(resolveUiLocale("zh-CN"), "zh-CN");
assert.equal(resolveUiLocale("zh-TW"), "zh-CN");
assert.equal(resolveUiLocale("ja-JP"), "en");
const keys = validateUiCatalogs();
assert.deepEqual(Object.keys(UI_MESSAGES["zh-CN"]), keys);
assert.deepEqual(Object.keys(UI_MESSAGES.en), keys);
setUiLocale("en", { persist: false, notify: false });
assert.equal(t("site.documentTitle"), "Original Touhou Games on the Web ~ EAGLER TOUHOU");
assert.match(t("site.description"), /launcher and multiplayer platform/);
assert.equal(t("nav.lessMotion"), "Less motion");
assert.equal(t("status.roomCreated", { code: "123456" }), "Room 123456 created");
assert.equal(t("file.exportFailed", { kind: "replay", reason: "boom" }), "Failed to export replay: boom");
assert.equal(t("file.importedRestart", { count: 2 }), "Imported 2 file(s); restart with Start Game to apply them");
assert.equal(t("replay.importFailed", { reason: "bad" }), "Replay import failed: bad");
assert.equal(t("missing.fixture"), "missing.fixture", "runtime JS callers must retain fail-soft missing-key behavior");
setUiLocale("zh-CN", { persist: false, notify: false });
assert.equal(t("nav.lessMotion"), "更少动画");
assert.equal(t("status.roomCreated", { code: "123456" }), "已创建房间 123456");

const translatedElement = { dataset: { i18n: "nav.lessMotion" }, textContent: "" };
applyStaticTranslations({ querySelectorAll: selector => selector === "[data-i18n]" ? [translatedElement] : [] });
assert.equal(translatedElement.textContent, "更少动画",
  "static translation must update matching DOM text from the active catalog");

const translatedMeta = {
  dataset: { i18nContent: "site.description" },
  content: "",
  setAttribute(name, value) { this[name] = value; },
};
applyStaticTranslations({
  querySelectorAll: selector => selector === "[data-i18n-content]" ? [translatedMeta] : [],
});
assert.equal(translatedMeta.content, t("site.description"),
  "metadata content must follow the active UI locale");

// These are integration selectors consumed by the i18n owner, not styling locks.
assert.match(index, /id="uiLanguageSelect"/);
assert.match(index, /data-i18n="nav\.lessMotion"/);
assert.match(index, /<title data-i18n="site\.documentTitle">网页上的东方原作 ~ EAGLER TOUHOU<\/title>/);
assert.match(index, /<meta name="description"[^>]+data-i18n-content="site\.description">/);
assert.ok(FRONTEND_PACKAGE_FILES.includes("assets/launcher/i18n.mjs"),
  "the browser i18n owner must be part of the published frontend closure");

const appSource = await readFile(resolveFrontendPackageSource("assets/launcher/app.mjs"), "utf8");
const fileWorkflowStart = appSource.indexOf("function runtimeResponseBytes");
const fileWorkflowEnd = appSource.indexOf("const replayDialog", fileWorkflowStart);
assert.ok(fileWorkflowStart >= 0 && fileWorkflowEnd > fileWorkflowStart);
const fileWorkflow = appSource.slice(fileWorkflowStart, fileWorkflowEnd);
assert.doesNotMatch(fileWorkflow, /[\u4e00-\u9fff]/,
  "dynamic save/replay workflows must use the shared i18n catalog instead of hard-coded Chinese UI text");

function assertDynamicSliceUsesCatalog(startMarker, endMarker, message) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing integration slice: ${startMarker}`);
  assert.doesNotMatch(appSource.slice(start, end), /[\u4e00-\u9fff]/, message);
}

assertDynamicSliceUsesCatalog(
  "function updateGameDataLinkWindow",
  "function transferPresentationFromRuntime",
  "manual game-package fallback UI must use the shared i18n catalog",
);
assertDynamicSliceUsesCatalog(
  "function updateTouchLayoutOrientationActionUi",
  "function beginTouchViewportDrag",
  "touch-layout editor UI must use the shared i18n catalog",
);
assertDynamicSliceUsesCatalog(
  "function renderNetworkActivity",
  "const installedPackageSnapshots",
  "dynamic transfer progress must use the shared i18n catalog",
);
assertDynamicSliceUsesCatalog(
  "async function maybeUpdateInstalledPackageBeforeLaunch",
  "function startBackgroundPackageUpdate",
  "package-update decisions and progress must use the shared i18n catalog",
);

const allowedCjkImplementationPatterns = [
  /超时\|timeout\|timed out\|没有完成请求/,
  /已取消下载/,
  /本机没有已安装的/,
  /\/超时\//,
  /IndexedDB\|存储\|写入\|配额/,
  /glyph:\s*["'](?:霊|魔|咲)["']/,
];
const unexpectedCjk = appSource.split("\n")
  .filter(line => /[\u4e00-\u9fff]/.test(line))
  .filter(line => !allowedCjkImplementationPatterns.some(pattern => pattern.test(line)));
assert.deepEqual(unexpectedCjk, [],
  "launcher implementation may retain CJK only in compatibility classifiers and non-translated glyph data");

console.log(JSON.stringify({ locales: UI_LOCALES, keys: keys.length, catalogs: "PASS", launcherControl: "PASS" }));
