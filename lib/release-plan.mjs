import { resolve } from "node:path";
import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";
import { normalizeProductSelection } from "./product-selection.mjs";

export const RELEASE_INPUT_SCHEMA = "eagler-touhou/release-input/1";
export const RELEASE_PATH_INPUT_KEYS = Object.freeze([
  "RuntimeRelease",
  "FeatureConfig",
  "FontFile",
  "VanillaFontFile",
  "ArtworkDirectory",
]);
export const RELEASE_PATH_MAP_INPUT_KEYS = Object.freeze(["GameDirectories", "LanguagePackDirectories"]);

const FORBIDDEN_FORMAL_BUILD_INPUTS = Object.freeze([
  "Th08Build",
  "EmsdkDirectory",
  "CMake",
  "Ninja",
]);

// Test visibility is a Launcher discovery rule. The bytes must still be in the
// same publication so ?test=1 can launch a hidden test title on that site.
export const FORMAL_RELEASE_GAMES = Object.freeze(Object.keys(PRODUCT_GAMES));

const legacyGameDirectoryKey = game => `Th${PRODUCT_GAMES[game].number}Directory`;
const legacyLanguagePackKey = game => `Th${PRODUCT_GAMES[game].number}LanguagePacks`;

function normalizePathMap(prepare, name, games, { required = false, legacyKey = null, inputDirectory } = {}) {
  const supplied = prepare[name];
  if (supplied != null && (typeof supplied !== "object" || Array.isArray(supplied))) {
    throw new Error(`prepare.${name} must be an object keyed by game id`);
  }
  const result = { ...(supplied || {}) };
  for (const game of games) {
    const oldKey = legacyKey?.(game);
    if (oldKey && prepare[oldKey]) {
      if (result[game] != null && result[game] !== prepare[oldKey]) {
        throw new Error(`prepare.${name}.${game} conflicts with legacy prepare.${oldKey}`);
      }
      result[game] ??= prepare[oldKey];
    }
  }
  for (const game of Object.keys(result)) {
    if (!games.includes(game)) throw new Error(`prepare.${name} contains unknown game: ${game}`);
    if (typeof result[game] !== "string" || !result[game]) throw new Error(`invalid prepare.${name}.${game}`);
    result[game] = resolve(inputDirectory, result[game]);
  }
  if (required) {
    for (const game of games) if (!result[game]) throw new Error(`missing prepare.${name}.${game}`);
  }
  return Object.freeze(result);
}

export function normalizeFormalReleaseInput(input, { inputDirectory, workspace, windir = "C:/Windows" } = {}) {
  if (!input || input.schema !== RELEASE_INPUT_SCHEMA || !input.prepare || typeof input.prepare !== "object") {
    throw new Error("invalid release input");
  }
  const games = [...FORMAL_RELEASE_GAMES];
  if (input.games != null) {
    const requested = normalizeProductSelection(input.games);
    if (JSON.stringify(requested) !== JSON.stringify(games)) {
      throw new Error("formal host release must contain every registered product; product subsets are development/validation only");
    }
  }

  const prepare = { ...input.prepare };
  if (prepare.OutputDirectory || prepare.PythonEnvironmentDirectory || prepare.GeneratedCacheDirectory) {
    throw new Error("release-owned output parameters must not be supplied");
  }
  for (const key of FORBIDDEN_FORMAL_BUILD_INPUTS) {
    if (prepare[key]) {
      throw new Error(`formal release consumes prepare.RuntimeRelease; ${key} belongs to maintainer Runtime compilation`);
    }
  }
  if (!prepare.RuntimeRelease) {
    throw new Error("formal release requires prepare.RuntimeRelease (resource-free all-product Runtime Release)");
  }

  prepare.FontFile ||= resolve(workspace, "dependencies/unifont-15.1.05/unifont-15.1.05.otf");
  prepare.VanillaFontFile ||= resolve(windir, "Fonts/msgothic.ttc");
  prepare.Profile = "web-release-hosted";
  prepare.Games = games;

  prepare.GameDirectories = normalizePathMap(prepare, "GameDirectories", games, {
    required: true,
    legacyKey: legacyGameDirectoryKey,
    inputDirectory,
  });
  const languageGames = games.filter(game => PRODUCT_GAMES[game].features.languages);
  prepare.LanguagePackDirectories = normalizePathMap(prepare, "LanguagePackDirectories", languageGames, {
    legacyKey: legacyLanguagePackKey,
    inputDirectory,
  });
  for (const game of games) delete prepare[legacyGameDirectoryKey(game)];
  for (const game of languageGames) delete prepare[legacyLanguagePackKey(game)];

  for (const key of ["RuntimeRelease", "FeatureConfig"]) {
    if (typeof prepare[key] !== "string" || !prepare[key]) throw new Error(`missing prepare.${key}`);
  }
  for (const key of RELEASE_PATH_INPUT_KEYS) {
    if (!prepare[key]) continue;
    prepare[key] = resolve(inputDirectory, prepare[key]);
  }
  return Object.freeze({ games, prepare: Object.freeze(prepare) });
}

export function formalReleaseSourceOwners() {
  // Game Runtime source provenance belongs to the Runtime Release producer.
  // Host assembly only executes Launcher-owned tooling against explicit inputs.
  return Object.freeze(["launcher"]);
}
