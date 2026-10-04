/** L0 artifact/source ownership contract. Mutation: none. Proves packaged
 * frontend/App Shell files have one owner and original-game-derived host art
 * is not part of repository-owned frontend assets. Does NOT prove rendering. */
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_SHELL_FILES,
  FRONTEND_UI_ARTIFACT,
  LEGACY_READER_FILES,
  BROWSER_MODULE_ENTRYPOINTS,
  BROWSER_MODULE_FILES,
  FRONTEND_PACKAGE_FILES,
  HOST_SITE_ARTWORK_FILES,
  hostArtworkFiles,
  resolveFrontendPackageSource,
} from "../lib/frontend-manifest.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { PRIVATE_FRONTEND_ASSETS } from "../lib/private-frontend-assets.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(project, "public");

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collectFiles(resolve(directory, entry.name), path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

assert.ok(FRONTEND_PACKAGE_FILES.includes("index.html"));
assert.ok(FRONTEND_PACKAGE_FILES.includes("robots.txt"));
assert.ok(FRONTEND_PACKAGE_FILES.includes("vendor/fflate.LICENSE"));
assert.ok(APP_SHELL_FILES.includes("vendor/fflate.min.js"));
assert.ok(!APP_SHELL_FILES.includes("vendor/fflate.LICENSE"));
assert.ok(APP_SHELL_FILES.every(path => FRONTEND_PACKAGE_FILES.includes(path)));
assert.ok(BROWSER_MODULE_ENTRYPOINTS.some(path => /^assets\/entry\.client-/.test(path)));
assert.ok(BROWSER_MODULE_ENTRYPOINTS.some(path => /^assets\/manifest-/.test(path)), "late Framework manifest is a published entry");
assert.ok(BROWSER_MODULE_FILES.length > 2, "every lazy Framework chunk is published offline");
assert.ok(BROWSER_MODULE_FILES.every(path => APP_SHELL_FILES.includes(path)));
assert.equal(new Set(BROWSER_MODULE_FILES).size, BROWSER_MODULE_FILES.length);
assert.ok(FRONTEND_PACKAGE_FILES.every(path => path !== 'app.js' && !path.startsWith('assets/launcher/')), 'legacy DOM bundles are not default publication inputs');
assert.ok(!FRONTEND_PACKAGE_FILES.includes("app-shell-sw.js"));
for (const path of [
  "legacy/legacy-game-pack.mjs",
  "legacy/legacy-import-storage.mjs",
  "legacy/legacy-package-adapter.mjs",
]) {
  assert.ok(FRONTEND_PACKAGE_FILES.includes(path), `${path} must remain published until legacy migration retirement`);
  assert.ok(!APP_SHELL_FILES.includes(path), `${path} must not be pinned in the App Shell`);
}
assert.ok(FRONTEND_PACKAGE_FILES.includes("en.html"));
assert.ok(FRONTEND_PACKAGE_FILES.includes("sitemap.xml"));
assert.ok(FRONTEND_PACKAGE_FILES.every(path => !/title00\.(?:jpg|png)$/i.test(path)));
const gameIds = Object.keys(PRODUCT_GAMES);
const cardArtwork = gameIds.map(game => PRODUCT_GAMES[game].cardArtwork).filter(Boolean);
for (const artwork of cardArtwork) {
  assert.ok(!FRONTEND_PACKAGE_FILES.includes(`assets/${artwork}`),
    `${artwork}: original-game-derived card artwork must remain a Host input, not a repository-owned frontend asset`);
}
assert.deepEqual(HOST_SITE_ARTWORK_FILES, [
  "th06.ico",
  "pwa/icon-192.png",
  "pwa/icon-512.png",
  "pwa/icon-maskable-512.png",
  "pwa/apple-touch-icon.png",
],
  "site branding must be explicit global publication state, not attached to one product selection");
for (const game of gameIds) {
  const expected = PRODUCT_GAMES[game].cardArtwork ? [PRODUCT_GAMES[game].cardArtwork] : [];
  assert.deepEqual(hostArtworkFiles([game]), [...expected, ...HOST_SITE_ARTWORK_FILES],
    `${game}: selected product artwork must come from Product Catalog plus global site artwork`);
}
assert.deepEqual(hostArtworkFiles(gameIds), [...cardArtwork, ...HOST_SITE_ARTWORK_FILES],
  "all registered products must contribute their catalog-owned card artwork exactly once");
for (const file of FRONTEND_PACKAGE_FILES) await access(resolveFrontendPackageSource(file));
assert.ok(LEGACY_READER_FILES.includes('product-catalog.mjs'));
assert.ok(LEGACY_READER_FILES.includes('assets/contracts/product-catalog.mjs'));
assert.ok(LEGACY_READER_FILES.includes('package/package-descriptor.mjs'));
assert.ok(LEGACY_READER_FILES.every(path=>FRONTEND_PACKAGE_FILES.includes(path)&&!APP_SHELL_FILES.includes(path)), 'bounded legacy reader closure stays network-addressable, never pinned into the new shell');
assert.equal(resolveFrontendPackageSource('en.html'),resolveFrontendPackageSource('index.html'),'legacy alias serves the Framework entry');
assert.ok(FRONTEND_UI_ARTIFACT.artifactId && FRONTEND_UI_ARTIFACT.workerPrelude.includes('__EAGLER_UI_NAVIGATION_FALLBACK'));
for (const directory of ["assets/contracts", "assets/launcher"]) {
  await assert.rejects(access(resolve(project, directory)), error => error?.code === "ENOENT",
    `${directory} must not exist as generated source-checkout output`);
}
assert.equal(new Set(PRIVATE_FRONTEND_ASSETS.map(asset => asset.target)).size, PRIVATE_FRONTEND_ASSETS.length,
  "private frontend publication targets must be unique");
for (const asset of PRIVATE_FRONTEND_ASSETS) {
  assert.match(asset.source, /^private-assets\/[a-z0-9][a-z0-9._/-]*$/,
    "private frontend sources must stay inside the ignored private-assets directory");
  assert.match(asset.target, /^assets\/[a-z0-9][a-z0-9._/-]*$/,
    "private frontend targets must stay inside the public assets directory");
}
console.log(JSON.stringify({ frontendManifest: "PASS", packaged: FRONTEND_PACKAGE_FILES.length, appShell: APP_SHELL_FILES.length, games: gameIds }));

assert.throws(()=>hostArtworkFiles(["unknown"]), /unknown artwork product/);
