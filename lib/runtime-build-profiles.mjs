import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";
import { WORKSPACE_REPOSITORIES } from "./workspace-layout.mjs";

export const RUNTIME_BUILD_SCHEMA = "eagler-touhou/runtime-builds/1";
const CONFIG_URL = new URL("../config/runtime-builds.json", import.meta.url);
let cachedConfig = null;

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateFeaturePolicy(value, label) {
  if (value !== true && value !== false && value !== "configurable") {
    throw new Error(`${label} must be true, false, or configurable`);
  }
}

function validateCache(cache, label) {
  if (!plainObject(cache)) throw new Error(`${label} cache must be an object`);
  for (const [key, value] of Object.entries(cache)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`${label} invalid CMake cache key: ${key}`);
    if (!["string", "boolean", "number"].includes(typeof value)) {
      throw new Error(`${label} unsupported CMake cache value: ${key}`);
    }
  }
}

export function validateRuntimeBuildConfig(config) {
  if (!plainObject(config) || config.schema !== RUNTIME_BUILD_SCHEMA) throw new Error("invalid runtime build config schema");
  if (!plainObject(config.defaults)) throw new Error("runtime build defaults are missing");
  validateCache(config.defaults.cache, "defaults");
  if (!plainObject(config.games)) throw new Error("runtime build games are missing");

  const registered = Object.keys(PRODUCT_GAMES).sort();
  const configured = Object.keys(config.games).sort();
  if (registered.join("\0") !== configured.join("\0")) {
    throw new Error(`runtime build config games must match product registry: ${configured.join(", ")}`);
  }

  for (const [game, entry] of Object.entries(config.games)) {
    const label = `runtime build ${game}`;
    if (!plainObject(entry) || !["cmake", "prebuilt"].includes(entry.builder)) throw new Error(`${label} has invalid builder`);
    if (typeof entry.workspaceRepository !== "string" || !WORKSPACE_REPOSITORIES[entry.workspaceRepository]) {
      throw new Error(`${label} workspaceRepository is required`);
    }
    if (!plainObject(entry.variants) || !entry.variants.normal) throw new Error(`${label} normal variant is required`);
    if (entry.builder === "cmake" && (typeof entry.assetRootVariable !== "string" || !/^TH\d+_ASSET_ROOT$/.test(entry.assetRootVariable))) {
      throw new Error(`${label} assetRootVariable is required for CMake builds`);
    }
    for (const [variant, definition] of Object.entries(entry.variants)) {
      const variantLabel = `${label}/${variant}`;
      if (!plainObject(definition) || !plainObject(definition.features)) throw new Error(`${variantLabel} features are required`);
      if (definition.workspaceRepository != null &&
          (typeof definition.workspaceRepository !== "string" || !WORKSPACE_REPOSITORIES[definition.workspaceRepository])) {
        throw new Error(`${variantLabel} workspaceRepository must name a declared workspace repository`);
      }
      validateFeaturePolicy(definition.features.thcrap, `${variantLabel} thcrap`);
      validateFeaturePolicy(definition.features.thprac, `${variantLabel} thprac`);
      validateCache(definition.cache, variantLabel);
    }
    const expectsMultiplayer = !!PRODUCT_GAMES[game].multiplayerRuntime;
    if (expectsMultiplayer !== !!entry.variants.multiplayer) {
      throw new Error(`${label} multiplayer variant must match product registry`);
    }
  }
  return config;
}

export async function loadRuntimeBuildConfig(url = CONFIG_URL) {
  if (url === CONFIG_URL && cachedConfig) return cachedConfig;
  const config = validateRuntimeBuildConfig(JSON.parse(await readFile(url, "utf8")));
  if (url === CONFIG_URL) cachedConfig = config;
  return config;
}

export async function getRuntimeBuildProfile(game, variant = "normal") {
  const config = await loadRuntimeBuildConfig();
  const gameEntry = config.games[game];
  if (!gameEntry) throw new Error(`unknown Runtime game: ${game}`);
  const definition = gameEntry.variants[variant];
  if (!definition) throw new Error(`${game}: unknown Runtime build variant: ${variant}`);
  return { game, variant, ...gameEntry,
    workspaceRepository: definition.workspaceRepository ?? gameEntry.workspaceRepository,
    definition, defaults: config.defaults };
}

function resolveFeature(policy, override, label) {
  if (policy === "configurable") {
    if (typeof override !== "boolean") throw new Error(`${label} requires an explicit boolean`);
    return override;
  }
  if (override != null && override !== policy) throw new Error(`${label} is fixed to ${policy}`);
  return policy;
}

export function cmakeCacheArguments(cache) {
  return Object.entries(cache).map(([key, value]) => `-D${key}=${typeof value === "boolean" ? (value ? "ON" : "OFF") : value}`);
}

export async function resolveRuntimeBuild({ game, variant = "normal", thcrap, thprac, assetRoot = null, runtimeExtension = null } = {}) {
  const profile = await getRuntimeBuildProfile(game, variant);
  if (profile.builder !== "cmake") throw new Error(`${game}/${variant} is ${profile.builder}, not a CMake build`);
  const resolvedThcrap = resolveFeature(profile.definition.features.thcrap, thcrap, `${game}/${variant} thcrap`);
  const resolvedThprac = resolveFeature(profile.definition.features.thprac, thprac, `${game}/${variant} thprac`);
  if (resolvedThprac && !runtimeExtension) throw new Error(`${game}/${variant} thprac requires runtimeExtension`);
  const cache = {
    ...profile.defaults.cache,
    ...profile.definition.cache,
    TH_ENABLE_THCRAP: resolvedThcrap,
    TH_ENABLE_THPRAC: resolvedThprac,
  };
  if (assetRoot) cache[profile.assetRootVariable] = assetRoot;
  if (runtimeExtension != null) cache.TH_RUNTIME_EXTENSION_CMAKE = runtimeExtension;
  return Object.freeze({
    game,
    variant,
    builder: profile.builder,
    workspaceRepository: profile.workspaceRepository,
    sourceDirectory: WORKSPACE_REPOSITORIES[profile.workspaceRepository],
    assetRootVariable: profile.assetRootVariable,
    features: Object.freeze({ thcrap: resolvedThcrap, thprac: resolvedThprac }),
    cache: Object.freeze(cache),
    cmakeArguments: Object.freeze(cmakeCacheArguments(cache)),
  });
}

export function runtimeBuildConfigPath() {
  return fileURLToPath(CONFIG_URL);
}
