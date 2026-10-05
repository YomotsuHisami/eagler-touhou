// Evidence: L3/module. Preconditions: repository config only. Mutations: none.
// Proves: Runtime build variants resolve deterministic CMake cache arguments
// and agree with the product registry. Does NOT prove a compiler/toolchain build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import {
  loadRuntimeBuildConfig,
  resolveRuntimeBuild,
} from "../lib/runtime-build-profiles.mjs";

const config = await loadRuntimeBuildConfig();
assert.deepEqual(Object.keys(config.games).sort(), Object.keys(PRODUCT_GAMES).sort());
for (const variant of ["normal", "multiplayer"]) {
  assert.equal(config.games.th09.variants[variant].features.thcrap, true,
    `TH09 ${variant} must attest its existing language-pack support`);
}

const cmakeGames = Object.entries(config.games)
  .filter(([, entry]) => entry.builder === "cmake")
  .map(([game]) => game)
  .sort();
const prebuiltGames = Object.entries(config.games)
  .filter(([, entry]) => entry.builder === "prebuilt")
  .map(([game]) => game)
  .sort();

const maintainerBuilder = readFileSync(resolve(import.meta.dirname, "..", "tools", "maintainer", "build-workspace-runtimes.ps1"), "utf8");
assert.match(maintainerBuilder, /\$cmakeGames\s*=\s*@\(/,
  "maintainer workspace Runtime builder must derive CMake products from runtime-builds.json");
assert.match(maintainerBuilder, /\[hashtable\]\s+\$GameAssetDirectories/,
  "maintainer workspace Runtime builder needs a generic per-game asset directory map");
assert.doesNotMatch(maintainerBuilder, /foreach\s*\(\$game\s+in\s+@\([^)]*th0\d/i,
  "maintainer workspace Runtime builder must not carry a second hard-coded game list");

const requestedFeature = policy => policy === "configurable" ? true : policy;

for (const game of cmakeGames) {
  const entry = config.games[game];
  const normalDefinition = entry.variants.normal;
  const normalThcrap = requestedFeature(normalDefinition.features.thcrap);
  const normalThprac = requestedFeature(normalDefinition.features.thprac);
  const normal = await resolveRuntimeBuild({
    game,
    variant: "normal",
    thcrap: normalThcrap,
    thprac: normalThprac,
    assetRoot: `C:/fixture/${game}`,
    runtimeExtension: normalThprac ? "C:/fixture/thprac.cmake" : "",
  });
  assert.equal(normal.features.thcrap, normalThcrap);
  assert.equal(normal.features.thprac, normalThprac);
  assert.equal(normal.workspaceRepository, entry.workspaceRepository);
  assert(normal.cmakeArguments.includes(`-D${entry.assetRootVariable}=C:/fixture/${game}`));
  for (const [key, value] of Object.entries(normalDefinition.cache)) {
    const encoded = typeof value === "boolean" ? (value ? "ON" : "OFF") : value;
    assert(normal.cmakeArguments.includes(`-D${key}=${encoded}`), `${game}: missing normal CMake cache ${key}`);
  }

  if (entry.variants.multiplayer) {
    const definition = entry.variants.multiplayer;
    const multiplayerThcrap = definition.features.thcrap === "configurable" ? false : definition.features.thcrap;
    const multiplayerThprac = definition.features.thprac === "configurable" ? false : definition.features.thprac;
    const multiplayer = await resolveRuntimeBuild({
      game,
      variant: "multiplayer",
      thcrap: multiplayerThcrap,
      thprac: multiplayerThprac,
      assetRoot: `C:/fixture/${game}`,
      runtimeExtension: "",
    });
    assert.equal(multiplayer.features.thcrap, multiplayerThcrap);
    assert.equal(multiplayer.features.thprac, multiplayerThprac);
    for (const [key, value] of Object.entries(definition.cache)) {
      const encoded = typeof value === "boolean" ? (value ? "ON" : "OFF") : value;
      assert(multiplayer.cmakeArguments.includes(`-D${key}=${encoded}`), `${game}: missing multiplayer CMake cache ${key}`);
    }
    assert(multiplayer.cmakeArguments.includes("-DTH_RUNTIME_EXTENSION_CMAKE="));
  }
}

for (const game of prebuiltGames) {
  await assert.rejects(
    () => resolveRuntimeBuild({ game, variant: "normal" }),
    /prebuilt, not a CMake build/,
  );
}

for (const game of cmakeGames) {
  const multiplayer = config.games[game].variants.multiplayer;
  if (!multiplayer || multiplayer.features.thprac !== false) continue;
  await assert.rejects(
    () => resolveRuntimeBuild({ game, variant: "multiplayer", thcrap: false, thprac: true }),
    /fixed to false/,
  );
}

console.log(JSON.stringify({
  schema: config.schema,
  games: Object.keys(config.games),
  cmakeGames,
  prebuiltGames,
  variants: "validated",
}));
