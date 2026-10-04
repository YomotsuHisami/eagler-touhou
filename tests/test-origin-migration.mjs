import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { APP_SHELL_FILES, FRONTEND_PACKAGE_FILES, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import { PRODUCT_GAMES } from "../product-catalog.mjs";
import {
  gamePreferenceStorageKey,
  languagePreferenceStorageKey,
} from "../.cache/build/browser/assets/launcher/game-preferences.mjs";
import {
  multiplayerDisplayNameLockedStorageKey,
  multiplayerDisplayNameStorageKey,
} from "../.cache/build/browser/assets/launcher/multiplayer-identity.mjs";
import {
  multiplayerLoadoutStorageKey,
  multiplayerShareSettingsStorageKey,
} from "../.cache/build/browser/assets/launcher/multiplayer-preferences.mjs";
import {
  multiplayerSpectatorRailLegacyPositionStorageKey,
  multiplayerSpectatorRailPositionStorageKey,
} from "../.cache/build/browser/assets/launcher/multiplayer-spectator-rail-position.mjs";
import { touchLayoutStorageKey } from "../.cache/build/browser/assets/launcher/touch-layout-model.mjs";
import { touchLayoutWindowPositionsStorageKey } from "../.cache/build/browser/assets/launcher/touch-layout-editor-state.mjs";
import {
  LEGACY_GAME_DATA_CACHE_NAME,
  LEGACY_IMPORT_STORAGE,
  importedGameDataMetadataKey,
  importedOggMetadataKey,
  legacyLocalAssetKey,
} from "../legacy/legacy-import-storage.mjs";

const html = await readFile(resolveFrontendPackageSource("migrate.html"), "utf8");
const indexHtml = await readFile(resolveFrontendPackageSource("index.html"), "utf8");
// Scan the current browser-owned source graph rather than a retired UI monolith.
async function browserSources(directory) {
  const files = await readdir(directory, {withFileTypes: true});
  return (await Promise.all(files.map(entry => entry.isDirectory()
    ? browserSources(new URL(`${entry.name}/`, directory))
    : /\.[cm]?[jt]sx?$/.test(entry.name) ? readFile(new URL(entry.name, directory), "utf8") : ""))).flat().join("\n");
}
const app = await browserSources(new URL("../app/", import.meta.url));
const playerTools = await readFile(new URL("../app/services/player-tools.client.ts", import.meta.url), "utf8");
const motion = await readFile(new URL("../app/services/motion-preference.client.ts", import.meta.url), "utf8");
const languages = await readFile(new URL("../app/services/language-pack.client.ts", import.meta.url), "utf8");
const legacyImportStorage = await readFile(new URL("../legacy/legacy-import-storage.mjs", import.meta.url), "utf8");
const legacyGamePack = await readFile(new URL("../legacy/legacy-game-pack.mjs", import.meta.url), "utf8");

// migrate.html intentionally stays one self-contained document so the exact
// old HTTP Origin can still run the sender after the rest of the application
// has moved to HTTPS. Source-structure checks below protect that security/data
// boundary, not visual/editorial implementation details.
assert.match(html, /const PROTOCOL = "eagler-touhou\/origin-migration\/1";/);
assert.match(html, /const AUTH_KEY = "eagler-touhou-origin-migration-authorized-v1";/);
const databaseOwners = JSON.parse(html.match(/const DATABASES = new Set\((\[[^;]+\])\);/)?.[1] || "null");
assert.ok(Array.isArray(databaseOwners), "origin migration IndexedDB owner list is not statically auditable");
for (const product of Object.values(PRODUCT_GAMES)) {
  assert.ok(databaseOwners.includes(product.storage.saveRoot),
    `origin migration does not cover registered save root: ${product.storage.saveRoot}`);
}
for (const database of ["eagler-touhou-package-store-v1", "EM_PRELOAD_CACHE", "eagler-touhou-local-assets-v1"]) {
  assert.ok(databaseOwners.includes(database), `origin migration lost persistent database owner: ${database}`);
}
const cacheOwners = JSON.parse(html.match(/const CACHE_NAMES = new Set\((\[[^;]+\])\);/)?.[1] || "null");
assert.deepEqual(cacheOwners, ["eagler-touhou-game-data-v1", "eagler-touhou-language-packs-v1"],
  "origin migration Cache Storage owners changed without an explicit data-ownership decision");
assert.ok(!cacheOwners.some(name => name.startsWith("eagler-touhou-app-shell-")),
  "deployment/App Shell caches must never migrate as player data");
assert.match(html, /const LEGACY_LOCAL_STORAGE_KEYS = new Set\(\["eagler\.mpSpectatorRail\.mobilePosition\.v1"\]\);/,
  "the one published pre-canonical spectator-rail key must remain explicitly migratable");
assert.match(html, /!key\.startsWith\("eagler-touhou-origin-migration-"\)[\s\S]*key\.startsWith\("eagler-"\)[\s\S]*LEGACY_LOCAL_STORAGE_KEYS\.has\(key\)/,
  "migration authorization state must never migrate as player data");

assert.match(html, /target\.protocol = "https:";/);
assert.match(html, /source\.protocol = "http:";/);
assert.match(html, /authorization\.token !== handoff[\s\S]*authorization\.sourceOrigin !== source\.origin[\s\S]*authorization\.targetOrigin !== location\.origin[\s\S]*authorization\.expires < Date\.now\(\)/,
  "cross-host handoff must bind token, source, target and expiry");
assert.match(html, /message\.protocol !== PROTOCOL \|\| message\.nonce !== nonce \|\| event\.origin !== peerOrigin \|\| event\.source !== peer/,
  "receiver messages must be bound to protocol, nonce, origin and opener window");
assert.match(html, /localStorage\.removeItem\(AUTH_KEY\);/,
  "one-shot cross-host authorization must be cleared after completion");
assert.match(html, /type: "inventory-request"/,
  "receiver must request a source inventory before deciding overwrite scope");
assert.match(html, /type: "inventory-summary"/,
  "source must provide a metadata-only inventory before transferring player data");
assert.match(html, /input\.type = "checkbox"/,
  "conflicting owners must require an explicit user choice instead of whole-origin overwrite");
assert.match(html, /overwriteDatabases/);
assert.match(html, /overwriteCaches/);
assert.doesNotMatch(html, /clearTargetPlayerData/,
  "origin migration must not clear all HTTPS player data as one overwrite action");
assert.match(html, /\[\["objects", 0\], \["generations", 1\], \["installations", 2\]\]/,
  "Package Store migration must publish installations only after objects and generations are transferred");

assert.match(html, /receiverDbs\.set\(schema\.name, db\);/);
assert.match(html, /store\.keyPath == null\) store\.put\(message\.value, message\.key\); else store\.put\(message\.value\);/,
  "IndexedDB records must preserve explicit keys for keyless stores");
assert.match(html, /function rewriteCacheUrl\(url, sourceOrigin\)[\s\S]*parsed\.origin !== sourceOrigin[\s\S]*location\.origin/,
  "Cache Storage request URLs owned by the old HTTP Origin must be rewritten to HTTPS");
assert.match(html, /await cache\.put\(req, response\);/);
assert.match(html, /response\.arrayBuffer\(\)/,
  "cache entries must transfer response bytes rather than server URLs");

assert.doesNotMatch(html, /<script\b[^>]+src=/i,
  "migration page must remain self-contained so the old Origin needs no other application asset");
assert.doesNotMatch(html, /<link\b[^>]+stylesheet/i,
  "migration page must not depend on a stylesheet that may no longer exist on the old Origin");
assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|sendBeacon\s*\(/,
  "origin migration must transfer player data browser-to-browser, never through the server");
assert.doesNotMatch(html, /localDevHost/,
  "origin security rules must not contain localhost-only bypasses");

// Persistent-storage coverage. sessionStorage is intentionally excluded:
// multiplayer room/client state is tab-scoped and should not cross Origins.
for (const forbidden of ["document.cookie", "navigator.storage.getDirectory", "showDirectoryPicker"]) {
  assert.ok(!app.includes(forbidden) && !legacyImportStorage.includes(forbidden) && !legacyGamePack.includes(forbidden),
    `persistent browser storage path is not covered by origin migration: ${forbidden}`);
}

// Literal persisted keys are migration contracts, independently of UI rendering.
assert.match(playerTools, /PLAYER_TOUCH_HELP_SEEN_KEY = ['"]eagler-touch-help-seen-v8['"]/);
assert.match(motion, /LESS_MOTION_STORAGE_KEY = ['"]eagler-touhou-less-motion-v1['"]/);

assert.equal(multiplayerSpectatorRailPositionStorageKey, "eagler-touhou-mp-spectator-rail-position-v1");
assert.equal(multiplayerSpectatorRailLegacyPositionStorageKey, "eagler.mpSpectatorRail.mobilePosition.v1");
for (const key of [
  touchLayoutStorageKey,
  touchLayoutWindowPositionsStorageKey,
  gamePreferenceStorageKey("th06"),
  gamePreferenceStorageKey("th07mp"),
  languagePreferenceStorageKey("th07"),
  multiplayerDisplayNameStorageKey,
  multiplayerDisplayNameLockedStorageKey,
  multiplayerShareSettingsStorageKey("th06mp"),
  multiplayerShareSettingsStorageKey("th07mp"),
  multiplayerLoadoutStorageKey("th06mp"),
  multiplayerLoadoutStorageKey("th07mp"),
  multiplayerSpectatorRailPositionStorageKey,
]) {
  assert.ok(key.startsWith("eagler-touhou-"), `host localStorage key moved outside the migratable namespace: ${key}`);
}

assert.equal(importedOggMetadataKey("th06"), "eagler-touhou-ogg-import-v1-th06");
assert.equal(importedGameDataMetadataKey("th07"), "eagler-touhou-game-data-import-v1-th07");
assert.deepEqual(LEGACY_IMPORT_STORAGE, {
  localAssetDatabase: "eagler-touhou-local-assets-v1",
  cacheName: "eagler-touhou-game-data-v1",
  emscriptenPreloadDatabase: "EM_PRELOAD_CACHE",
});
assert.equal(LEGACY_GAME_DATA_CACHE_NAME, "eagler-touhou-game-data-v1");
assert.match(languages, /LANGUAGE_PACK_CACHE = ['"]eagler-touhou-language-packs-v1['"]/);
assert.equal(
  legacyLocalAssetKey("http://old.example/.eagler-local/offline/th07/file.bin", "http://old.example"),
  "/.eagler-local/offline/th07/file.bin",
  "imported local-asset keys must remain origin-independent",
);
assert.equal(
  legacyLocalAssetKey("https://new.example/.eagler-local/offline/th07/file.bin", "https://new.example"),
  "/.eagler-local/offline/th07/file.bin",
  "origin-independent local-asset identity must survive HTTP-to-HTTPS migration",
);
assert.match(legacyImportStorage, /cleanupEmscriptenPreloadOwner[\s\S]*eaglerLocalImport === version[\s\S]*package\/\$\{packageName\}\/\$\{index\}/,
  "legacy Emscripten preload ownership must remain explicitly discoverable for one-way cleanup");

// Publication/cutover boundaries.
assert.ok(FRONTEND_PACKAGE_FILES.includes("migrate.html"));
assert.ok(!APP_SHELL_FILES.includes("migrate.html"),
  "migration protocol must always load from the network instead of a stale App Shell cache");
assert.match(indexHtml,/window\.__reactRouterContext/,
  "Framework entry delegates migration visibility to the validated publication marker");

console.log(JSON.stringify({
  originMigration: "PASS",
  protocol: "browser-to-browser",
  indexedDbOwners: databaseOwners.length,
  cacheOwners: cacheOwners.length,
  exactLegacyLocalStorageKeys: 1,
  serverUpload: false,
}));
