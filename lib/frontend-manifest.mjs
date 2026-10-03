import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserModuleClosure } from "./browser-module-graph.mjs";
import { ensureLauncherBuild, resolveBrowserPublicationSource } from "./launcher-build.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
await ensureLauncherBuild();
// Compiled contracts do not exist in a freshly unpacked source checkout.
// A static import would execute before the build above, so defer this load
// until the shared build lock has been released and all outputs are ready.
const { PRODUCT_GAMES } = await import("./contracts/product-catalog.mjs");

// Browser entrypoints are the only JavaScript URLs owned manually. Their full
// static ESM dependency closure is derived from source, so adding a module
// cannot accidentally publish an online-only launcher or omit it from precache.
export const BROWSER_MODULE_ENTRYPOINTS = Object.freeze(["app.js", "assets/launcher/lobby.mjs"]);
export const BROWSER_MODULE_FILES = await browserModuleClosure({
  root: project,
  entries: BROWSER_MODULE_ENTRYPOINTS,
  resolveFile: resolveBrowserPublicationSource,
});

// Repository-owned non-module frontend delivery manifest. Original-game-
// derived artwork is supplied by the deployer, never published as source.
const entries = [
  ["index.html", true],
  ["en.html", true],
  ["lobby.html", true],
  ["lobby.css", true],
  ["site.webmanifest", true],
  ["robots.txt", true],
  ["sitemap.xml", false],
  ["styles.css", true],
  ["features.css", true],
  ["ui-fonts.css", false],
  ["ui-fonts-deferred.css", false],
  ["touch-guide.css", true],
  ["assets/character-art.css", true],
  ["assets/dairi/manifest.json", true],
  ["assets/dairi/CREDITS.txt", false],
  ["assets/dairi/reimu.png", true],
  ["assets/dairi/marisa.png", true],
  ["assets/dairi/sakuya.png", true],
  ["assets/dairi/youmu.png", true],
  ["assets/dairi/yukari.png", true],
  ["assets/dairi/alice.png", true],
  ["assets/dairi/remilia.png", true],
  ["assets/dairi/yuyuko.png", true],
  ["assets/dairi/reisen.png", true],
  ["assets/dairi/cirno.png", true],
  ["assets/dairi/lyrica.png", true],
  ["assets/dairi/merlin.png", true],
  ["assets/dairi/lunasa.png", true],
  ["assets/dairi/mystia.png", true],
  ["assets/dairi/tewi.png", true],
  ["assets/dairi/aya.png", true],
  ["assets/dairi/medicine.png", true],
  ["assets/dairi/yuuka.png", true],
  ["assets/dairi/komachi.png", true],
  ["assets/dairi/eiki.png", true],

  ["about.css", true],
  // Origin migration must always use the current network document. Caching it
  // in the App Shell could leave either side of a cutover on stale protocol
  // code even when the server correctly marks the page for revalidation.
  ["migrate.html", false],
  ["legacy-mount-retirement-sw.js", false],
  // Bounded read-only compatibility for previously published game packs and
  // storage. These remain network-addressable until the retirement conditions
  // in legacy/README.md are met, but they are not part of the App Shell.
  ["legacy/legacy-game-pack.mjs", false],
  ["legacy/legacy-import-storage.mjs", false],
  ["legacy/legacy-package-adapter.mjs", false],
  ["about.html", true],
  ["faq.html", true],
  // Deliberately standalone ES5/CSS2-friendly help page: unsupported browsers
  // must be able to read it without loading the modern Launcher or its fonts.
  ["compatibility.html", true],
  ["vendor/fflate.min.js", true],
  ["vendor/webaudio-tinysynth.min.js", true],
  ["vendor/fflate.LICENSE", false],
  ["vendor/webaudio-tinysynth.LICENSE", false],
  ["assets/touch-rotate-landscape.webp", true],
  ["assets/launcher-background.webp", true],
  ["assets/score-character-sheet-CREDITS.txt", false],
  ["assets/score-format-LICENSE.txt", false],
  ["assets/room-caret-left.svg", true],
  ["assets/room-caret-right.svg", true],
  ["assets/room-copy.svg", true],
  ["assets/room-gear-six.svg", true],
  ["assets/room-sliders-horizontal.svg", true],
  ["assets/room-chart-bar.svg", true],
  ["assets/room-users.svg", true],
  ["assets/room-icons-LICENSE.txt", false],
  ["assets/donation.webp", false],
  ["assets/notice-bilibili.svg", true],
  ["assets/notice-touhou-cloud.png", true],
  ["assets/notice-github.svg", true],
  ["assets/notice-qq.svg", true],
  ["assets/fonts/touhou98.woff2", true],
  ["assets/fonts/unifont-site.woff2", true],
  ["assets/fonts/yatra-one-latin.woff2", true],
  ["assets/fonts/chill-round-gothic-site-medium.woff2", false],
  ["assets/fonts/chill-round-gothic-site-bold.woff2", false],
  ["assets/fonts/chill-round-gothic-site-medium-critical.woff2", true],
  ["assets/fonts/chill-round-gothic-site-medium-deferred.woff2", false],
  ["assets/fonts/chill-round-gothic-site-bold-critical.woff2", true],
  ["assets/fonts/chill-round-gothic-site-bold-deferred.woff2", false],
  ["assets/fonts/chill-round-gothic-site-heavy.woff2", true],
  ["assets/fonts/OFL-Unifont.txt", false],
  ["assets/fonts/OFL-YatraOne.txt", false],
  ["assets/fonts/OFL-ChillRoundGothic.txt", false],
  ["NOTICE.txt", false],
  ["content/FIRST_USE_NOTICE.html", true],
  ["content/MULTIPLAYER.html", true],
  ["README.md", false],
  ["ASSETS.md", false],
  ["THIRD_PARTY.md", false],
];
const staticPackageFiles = entries.map(([path]) => path);
const staticAppShellFiles = entries.filter(([, appShell]) => appShell).map(([path]) => path);
export const FRONTEND_PACKAGE_FILES = Object.freeze([...staticPackageFiles, ...BROWSER_MODULE_FILES]);
export const APP_SHELL_FILES = Object.freeze([...staticAppShellFiles, ...BROWSER_MODULE_FILES]);
export const PUBLIC_ASSET_FILES = Object.freeze(FRONTEND_PACKAGE_FILES.filter(path => path.startsWith("assets/")));

// Host-generated site branding is global publication state, not a per-game
// capability. Keep it separate from PRODUCT_GAMES so adding/selecting a title
// cannot accidentally drop a shell-level asset.
export const HOST_SITE_ARTWORK_FILES = Object.freeze([
  "th06.ico",
  "pwa/icon-192.png",
  "pwa/icon-512.png",
  "pwa/icon-maskable-512.png",
  "pwa/apple-touch-icon.png",
]);
export function resolveFrontendPackageSource(path) {
  if (!FRONTEND_PACKAGE_FILES.includes(path)) throw new Error(`unknown frontend package file: ${path}`);
  return resolveBrowserPublicationSource(path);
}
export function hostArtworkFiles(games) {
  const files = games.flatMap(game => {
    const product = PRODUCT_GAMES[game];
    if (!product) throw new Error(`unknown artwork product: ${game}`);
    return product.cardArtwork ? [product.cardArtwork] : [];
  });
  return Object.freeze([...files, ...HOST_SITE_ARTWORK_FILES]);
}
