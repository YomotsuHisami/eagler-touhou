// Frontend-independent validation for both published entrypoint owners.
import { APP_SHELL_CONTRACT_SCHEMA, normalizeAppShellPath } from "./app-shell-contract.mjs";
import { RUNTIME_MANIFEST_FILE } from "./contracts/runtime-generations.mjs";
import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";

export const APP_SHELL_RUNTIME_GLOBS = Object.freeze([
  "runtime/**/*.html",
  "runtime/**/*.js",
  "runtime/**/*.wasm",
  "runtime/**/*.mjs",
  "runtime/**/*.json",
  "runtime/**/*.bin",
  "runtime/**/fonts/**/*.gz",
]);

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

export function assertAppShellContract(contract, legacyCatalog, { shellFiles }) {
  if (!Array.isArray(shellFiles)) throw new Error("App Shell validation requires an explicit frontend file graph");
  if (![APP_SHELL_CONTRACT_SCHEMA, "eagler-touhou/app-shell/1"].includes(contract?.schema) || !/^[a-f0-9]{20}$/i.test(contract?.buildId || "") ||
      !Array.isArray(contract?.entries) || !contract.entries.length) {
    throw new Error("invalid App Shell deployment contract");
  }
  const entries = new Set(contract.entries.map(normalizeAppShellPath));
  for (const path of shellFiles) {
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
