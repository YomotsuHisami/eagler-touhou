import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getManifest, injectManifest } from "workbox-build";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = resolve(project, "app-shell-sw-src.js");
const destinationPath = resolve(project, "app-shell-sw.js");

export const APP_SHELL_GLOBS = Object.freeze([
  "index.html",
  "site.webmanifest",
  "styles.css",
  "touch-guide.css",
  "about.css",
  "app.js",
  "migrate.html",
  "about.html",
  "faq.html",
  "game-data-import.js",
  "game-data-import.mjs",
  "network-activity.mjs",
  "package-descriptor.mjs",
  "package-generation.mjs",
  "package-store.mjs",
  "runtime-preparation.mjs",
  "package-zip.mjs",
  "package-installer.mjs",
  "package-launcher.mjs",
  "product-catalog.mjs",
  "release-catalog.mjs",
  "vendor/fflate.min.js",
  "vendor/webaudio-tinysynth.min.js",
  "assets/*.webp",
  "assets/*.jpg",
  "assets/*.png",
  "assets/*.svg",
  "assets/*.ico",
  "assets/fonts/*.woff2",
]);

const APP_SHELL_EXACT = new Set(APP_SHELL_GLOBS.filter(pattern => !pattern.includes("*")));
const APP_SHELL_ASSET = /^assets\/(?:[^/]+\.(?:webp|jpg|png|svg|ico)|fonts\/[^/]+\.woff2)$/i;

export function isAppShellPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return path === "app-shell-sw-src.js" || APP_SHELL_EXACT.has(path) || APP_SHELL_ASSET.test(path);
}

function buildHash(entries, source) {
  const hash = createHash("sha256");
  hash.update(source);
  for (const entry of [...entries].sort((a, b) => a.url.localeCompare(b.url))) {
    hash.update("\0");
    hash.update(entry.url);
    hash.update("\0");
    hash.update(entry.revision || "");
  }
  return hash.digest("hex").slice(0, 20);
}

export async function buildAppShell({ quiet = false, globDirectory = project, swDest = destinationPath, additionalGlobPatterns = [] } = {}) {
  const manifestConfig = {
    globDirectory,
    globPatterns: [...APP_SHELL_GLOBS, ...additionalGlobPatterns],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  };
  const source = await readFile(sourcePath, "utf8");
  const firstPass = await getManifest(manifestConfig);
  const indexEntry = firstPass.manifestEntries.find(entry => entry.url === "index.html");
  if (!indexEntry?.revision) throw new Error("Workbox App Shell manifest is missing index.html");
  const additionalManifestEntries = [{ url: "./", revision: indexEntry.revision }];
  const buildId = buildHash([...firstPass.manifestEntries, ...additionalManifestEntries], source);
  const temporarySource = resolve(project, `.app-shell-sw-src.${process.pid}.tmp.js`);
  if (!source.includes("__APP_SHELL_BUILD_ID__") || !source.includes("self.__WB_MANIFEST")) {
    throw new Error("App Shell Service Worker source is missing Workbox build placeholders");
  }
  await writeFile(temporarySource, source.replaceAll("__APP_SHELL_BUILD_ID__", buildId), "utf8");
  try {
    const result = await injectManifest({
      ...manifestConfig,
      additionalManifestEntries,
      swSrc: temporarySource,
      swDest,
      injectionPoint: "self.__WB_MANIFEST",
    });
    const warnings = [...firstPass.warnings, ...result.warnings];
    if (warnings.length && !quiet) warnings.forEach(warning => console.warn(`Workbox: ${warning}`));
    if (!quiet) console.log(`App Shell Workbox: ${buildId} - ${result.count} files - ${result.size} bytes`);
    return { buildId, count: result.count, size: result.size, warnings };
  } finally {
    await rm(temporarySource, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildAppShell();
}
