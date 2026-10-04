import { RUNTIME_MANIFEST_FILE, parseRuntimeGenerationPath } from "./contracts/runtime-generations.mjs";
import { APP_SHELL_FILES, hostArtworkFiles } from "./frontend-manifest.mjs";
import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";

export const APP_SHELL_CONTRACT_SCHEMA = "eagler-touhou/app-shell/2";
export const APP_SHELL_SOURCE_FILE = "src/app-shell-sw.js";
export const APP_SHELL_OUTPUT_FILE = "app-shell-sw.js";
export const APP_SHELL_RUNTIME_GLOBS = Object.freeze([
  "runtime/**/*.html",
  "runtime/**/*.js",
  "runtime/**/*.wasm",
  "runtime/**/*.mjs",
  "runtime/**/*.json",
  "runtime/**/*.bin",
  "runtime/**/fonts/**/*.gz",
]);

const repositoryInputs = new Set([APP_SHELL_SOURCE_FILE, "src/runtime-cache-sw.js", "legacy/runtime-generation-reader.js", "assets/contracts/runtime-generations-worker.js", "src/contracts/runtime-generations.mts", ...APP_SHELL_FILES]);

export function normalizeAppShellPath(value) {
  const path = String(value || "").replaceAll("\\", "/");
  if (path === "./") return "./";
  return path.replace(/^\.\//, "");
}

export function isRepositoryAppShellInput(value) {
  return repositoryInputs.has(normalizeAppShellPath(value));
}

export function runtimeAppShellPaths(legacyCatalog) {
  if (!legacyCatalog?.games || typeof legacyCatalog.games !== "object") {
    throw new Error("invalid legacy game catalog");
  }
  const result = new Set();
  for (const [game, entry] of Object.entries(legacyCatalog.games)) {
    for (const runtime of [entry?.runtime, entry?.multiplayerRuntime].filter(Boolean)) {
      const url = new URL(runtime, "https://eagler.invalid/");
      const prefix = "/";
      if (!url.pathname.startsWith(prefix) || !/\.html$/i.test(url.pathname)) {
        throw new Error(`invalid App Runtime URL: ${game}: ${runtime}`);
      }
      const html = url.pathname.slice(prefix.length);
      if (PRODUCT_GAMES[game]?.runtimeFileLayout === "directory") {
        const directory = html.slice(0, html.lastIndexOf("/") + 1);
        for (const file of PRODUCT_GAMES[game].runtimeAssets) result.add(directory + file);
        continue;
      }
      for (const extension of ["html", "js", "wasm"]) {
        result.add(html.replace(/\.html$/i, `.${extension}`));
      }
    }
  }
  return Object.freeze([...result].sort());
}

export function deploymentAppShellPatterns({
  games = [],
  hostArtwork = null,
  includeRuntime = false,
  includeHostArtwork = true,
} = {}) {
  const result = [];
  if (includeRuntime) result.push(...APP_SHELL_RUNTIME_GLOBS);
  if (includeHostArtwork) {
    const artwork = hostArtwork == null ? hostArtworkFiles(games) : hostArtwork;
    result.push(...artwork.map(name => `assets/${name}`));
  }
  return Object.freeze([...new Set(result)]);
}

export function createAppShellContract({ buildId, manifestEntries, runtimeManifest = null }) {
  if (!/^[a-f0-9]{20}$/i.test(buildId || "")) throw new Error("invalid App Shell build id");
  if (!Array.isArray(manifestEntries) || !manifestEntries.length) throw new Error("App Shell manifest entries missing");
  const entries = [...new Set(manifestEntries.map(entry => normalizeAppShellPath(entry?.url)).filter(Boolean))].sort();
  if (!entries.includes("index.html") || !entries.includes("./")) throw new Error("App Shell contract is missing navigation entries");
  return Object.freeze({
    schema: APP_SHELL_CONTRACT_SCHEMA,
    buildId,
    entries: Object.freeze(entries),
    runtimeManifest,
  });
}

export function assertAppShellContract(contract, legacyCatalog, {requiredFiles = APP_SHELL_FILES} = {}) {
  if (![APP_SHELL_CONTRACT_SCHEMA, "eagler-touhou/app-shell/1"].includes(contract?.schema) || !/^[a-f0-9]{20}$/i.test(contract?.buildId || "") ||
      !Array.isArray(contract?.entries) || !contract.entries.length) {
    throw new Error("invalid App Shell deployment contract");
  }
  const entries = new Set(contract.entries.map(normalizeAppShellPath));
  for (const path of requiredFiles) {
    if (!entries.has(path)) throw new Error(`App Shell contract omits repository shell file: ${path}`);
  }
  if (contract.schema === "eagler-touhou/app-shell/1") {
    for (const path of runtimeAppShellPaths(legacyCatalog)) {
      if (!entries.has(path)) throw new Error(`App Shell contract omits Runtime: ${path}`);
    }
  } else {
    if ([...entries].some(path => path.startsWith("runtime/") || path === RUNTIME_MANIFEST_FILE)) {
      throw new Error("Runtime files/pointer must not enter shell precache");
    }
    if (legacyCatalog?.shared?.runtimeManifest === RUNTIME_MANIFEST_FILE &&
        (contract.runtimeManifest?.path !== RUNTIME_MANIFEST_FILE || !/^[a-f0-9]{64}$/.test(contract.runtimeManifest?.sha256 || ""))) {
      throw new Error("App Shell contract omits the Runtime Manifest identity");
    }
  }
  return contract;
}
