import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FRONTEND_PACKAGE_FILES, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
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
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  if (!product.multiplayer) continue;
  assert.ok(keys.includes(product.multiplayer.titleKey), `${game}: Multiplayer product title is missing from UI catalogs: ${product.multiplayer.titleKey}`);
  assert.equal(typeof UI_MESSAGES["zh-CN"][product.multiplayer.titleKey], "string");
  assert.equal(typeof UI_MESSAGES.en[product.multiplayer.titleKey], "string");
  for (const loadout of product.multiplayer.loadouts) {
    assert.ok(keys.includes(loadout.labelKey), `${game}: Multiplayer loadout label is missing from UI catalogs: ${loadout.labelKey}`);
    assert.equal(typeof UI_MESSAGES["zh-CN"][loadout.labelKey], "string");
    assert.equal(typeof UI_MESSAGES.en[loadout.labelKey], "string");
  }
}
setUiLocale("en", { persist: false, notify: false });
assert.equal(t("site.documentTitle"), "Touhou Project Original STGs ~ EAGLER TOUHOU");
assert.match(t("site.description"), /near-pixel-perfect accuracy/);
assert.equal(t("nav.lessMotion"), "Less motion");
assert.equal(t("touch.functionKeyHint"), "Function key");
assert.equal(t("status.roomCreated", { code: "123456" }), "Room 123456 created");
assert.equal(t("missing.fixture"), "missing.fixture", "runtime JS callers must retain fail-soft missing-key behavior");
setUiLocale("zh-CN", { persist: false, notify: false });
assert.equal(t("nav.lessMotion"), "更少动画");
assert.equal(t("touch.functionKeyHint"), "功能按键");
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
assert.match(index, /id="touchFunction"[^>]*>[\s\S]*?<small data-i18n="touch\.functionKeyHint">/,
  "the function key subtitle must bind to the translation owner");
assert.match(index, /id="lessMotionToggle"[^>]*>[\s\S]*?data-i18n="nav\.lessMotion"/,
  "the reduced-motion menu control must keep its label translatable");
assert.match(index, /<title data-i18n="site\.documentTitle">东方Project 原作 STG ~ EAGLER TOUHOU<\/title>/);
assert.match(index, /<meta name="description"[^>]+data-i18n-content="site\.description">/);
assert.ok(FRONTEND_PACKAGE_FILES.includes("assets/launcher/app.mjs"),
  "the optimized Launcher bundle containing the i18n owner must be published");
assert.ok(FRONTEND_PACKAGE_FILES.includes("en.html"),
  "the English UI must have an independently crawlable document");

console.log(JSON.stringify({ locales: UI_LOCALES, keys: keys.length, catalogs: "PASS", launcherControl: "PASS" }));
