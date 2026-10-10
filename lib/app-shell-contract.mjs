export const APP_SHELL_CONTRACT_SCHEMA = "eagler-touhou/app-shell/2";
export const APP_SHELL_SOURCE_FILE = "src/app-shell-sw.js";
export const APP_SHELL_OUTPUT_FILE = "app-shell-sw.js";

export function normalizeAppShellPath(value) {
  const path = String(value || "").replaceAll("\\", "/");
  if (path === "./") return "./";
  return path.replace(/^\.\//, "");
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

