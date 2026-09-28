/** L0 artifact/source ownership contract. Mutation: none. Proves packaged
 * frontend/App Shell files have one owner and original-game-derived host art
 * is not part of repository-owned frontend assets. Does NOT prove rendering. */
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_SHELL_FILES,
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
assert.deepEqual(BROWSER_MODULE_ENTRYPOINTS, ["app.js"]);
assert.ok(BROWSER_MODULE_FILES.includes("app.js"));
assert.ok(BROWSER_MODULE_FILES.includes("assets/launcher/app.mjs"));
assert.ok(BROWSER_MODULE_FILES.length > 2,
  "feature chunks must remain in the published browser graph so code splitting never creates online-only functionality");
assert.ok(BROWSER_MODULE_FILES.some(path => /^assets\/launcher\/[^/]+-[A-Z0-9]{8}\.mjs$/.test(path)),
  "optimized browser graph must contain at least one split feature chunk");
assert.ok(BROWSER_MODULE_FILES.every(path => APP_SHELL_FILES.includes(path)));
assert.equal(new Set(BROWSER_MODULE_FILES).size, BROWSER_MODULE_FILES.length);
assert.ok(APP_SHELL_FILES.includes("features.css"), "deferred feature CSS must still be installed with the App Shell");
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
const cardArtwork = gameIds.map(game => PRODUCT_GAMES[game].cardArtwork);
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
  assert.deepEqual(hostArtworkFiles([game]), [PRODUCT_GAMES[game].cardArtwork, ...HOST_SITE_ARTWORK_FILES],
    `${game}: selected product artwork must come from Product Catalog plus global site artwork`);
}
assert.deepEqual(hostArtworkFiles(gameIds), [...cardArtwork, ...HOST_SITE_ARTWORK_FILES],
  "all registered products must contribute their catalog-owned card artwork exactly once");
assert.match(
  relative(project, resolveFrontendPackageSource("assets/launcher/app.mjs")).replaceAll("\\", "/"),
  /^\.cache\/build\/optimized\/assets\/launcher\/app\.mjs$/,
  "source checkout must publish the optimized Launcher outside the authored assets directory",
);
for (const directory of ["assets/contracts", "assets/launcher"]) {
  await assert.rejects(access(resolve(project, directory)), error => error?.code === "ENOENT",
    `${directory} must not exist as generated source-checkout output`);
}
const publicFiles = await collectFiles(publicRoot);
const declaredPublicFiles = FRONTEND_PACKAGE_FILES.filter(path =>
  resolveFrontendPackageSource(path).startsWith(`${publicRoot}\\`) ||
  resolveFrontendPackageSource(path).startsWith(`${publicRoot}/`)
).concat(["index.html", "styles.css", "touch-guide.css", "dev-lobby.html", "dev-lobby.css", "dev-lobby.mjs"]).sort();
assert.deepEqual(publicFiles, declaredPublicFiles,
  "public/ must contain exactly the allowlisted authored browser source files");
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
