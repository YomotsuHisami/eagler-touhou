import assert from "node:assert/strict";
import {importUiModule} from "./support/import-ui-module.mjs";
import { readFile } from "node:fs/promises";
import { FRONTEND_PACKAGE_FILES, BROWSER_MODULE_FILES, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import {
  UI_LOCALES,
  UI_MESSAGES,
  resolveUiLocale,
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
// Exercise the active injected locale owner, not a singleton that mutates DOM
// or browser history. Metadata and React labels consume the same formatter.
const {createLocaleStore,formatUiMessage}=await importUiModule('app/services/locale.client.ts');
const stored=new Map();const writes=[];const store=createLocaleStore({initialLocale:'en',storage:{
 getItem:key=>stored.get(key)??null,setItem(key,value){stored.set(key,value);writes.push([key,value]);},
}});
store.hydrate();
const t=(key,params)=>store.format(key,params);
assert.equal(t("site.documentTitle"), "Touhou Project Original STGs ~ EAGLER TOUHOU");
assert.match(t("site.description"), /near-pixel-perfect accuracy/);
assert.equal(t("nav.lessMotion"), "Less motion");
assert.equal(t("touch.functionKeyHint"), "Function key");
assert.equal(t("status.roomCreated", { code: "123456" }), "Room 123456 created");
assert.equal(t("missing.fixture"), "missing.fixture", "runtime JS callers retain fail-soft missing-key behavior");
store.setLocale('zh-CN',{persist:false});
assert.equal(t("nav.lessMotion"), "更少动画");
assert.equal(t("touch.functionKeyHint"), "功能按键");
assert.equal(t("status.roomCreated", { code: "123456" }), "已创建房间 123456");
assert.equal(t('status.roomCreated'),'已创建房间 {code}','unknown placeholders remain visible');
assert.equal(writes.length,0,'route locale changes do not implicitly rewrite the saved preference');
store.setLocale('en');assert.deepEqual(writes,[['eagler-touhou-ui-locale-v1','en']]);
assert.equal(formatUiMessage('zh-CN','site.description'),UI_MESSAGES['zh-CN']['site.description']);
assert.throws(()=>store.setLocale('invalid'),/Unsupported UI locale/);

// The Framework entry hydrates locale from its root provider; static legacy
// selector IDs are no longer a publication contract.
assert.match(index,/window\.__reactRouterContext/);
assert.ok(BROWSER_MODULE_FILES.some(path=>/^assets\/root-/.test(path)), 'Framework root containing locale owner is published');
assert.ok(FRONTEND_PACKAGE_FILES.includes("en.html"),
  "the English UI must have an independently crawlable document");

console.log(JSON.stringify({ locales: UI_LOCALES, keys: keys.length, catalogs: "PASS", launcherControl: "PASS" }));
