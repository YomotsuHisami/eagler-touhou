import {APP_SHELL_SOURCE_FILE, normalizeAppShellPath} from "./app-shell-contract.mjs";
export {APP_SHELL_CONTRACT_SCHEMA, APP_SHELL_SOURCE_FILE, APP_SHELL_OUTPUT_FILE, normalizeAppShellPath, createAppShellContract} from "./app-shell-contract.mjs";
import { APP_SHELL_FILES, hostArtworkFiles } from "./frontend-manifest.mjs";
import { assertAppShellContract as assertSelectedAppShellContract } from "./app-shell-validation.mjs";
export {APP_SHELL_RUNTIME_GLOBS, runtimeAppShellPaths} from "./app-shell-validation.mjs";
import { APP_SHELL_RUNTIME_GLOBS } from "./app-shell-validation.mjs";

const repositoryInputs = new Set([APP_SHELL_SOURCE_FILE, "src/runtime-cache-sw.js", "legacy/runtime-generation-reader.js", "assets/contracts/runtime-generations-worker.js", "src/contracts/runtime-generations.mts", ...APP_SHELL_FILES]);

export function isRepositoryAppShellInput(value) {
  return repositoryInputs.has(normalizeAppShellPath(value));
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

export function assertAppShellContract(contract, legacyCatalog, { shellFiles = APP_SHELL_FILES } = {}) {
  return assertSelectedAppShellContract(contract, legacyCatalog, {shellFiles});
}
