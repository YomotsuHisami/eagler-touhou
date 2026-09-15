import assert from "node:assert/strict";
import {PRODUCT_GAMES} from "../lib/contracts/product-catalog.mjs";
import {runtimeFileNames} from "../lib/runtime-release.mjs";
import {runtimeAppShellPaths} from "../lib/app-shell-policy.mjs";

const identities = assets => Object.fromEntries(
  assets.map(name => [name, {bytes: 1, sha256: "0".repeat(64)}]),
);

const expected = {
  th08: [
    "th08-modern.html",
    "manifest.json",
    "shell.mjs",
    "eagler-host.mjs",
    "motion-replay.mjs",
    "th08-sdl.mjs",
    "th08-sdl.wasm",
    "resources.json",
    "fonts/msgothic.ttc",
    "fonts/blend.bin",
    "fonts/cp932.bin",
  ],
  th10: [
    "th10.html",
    "manifest.json",
    "shell.mjs",
    "eagler-host.mjs",
    "motion-replay.mjs",
    "th10-sdl.mjs",
    "th10-sdl.wasm",
    "resources.json",
    "fonts/msgothic.ttc",
    "fonts/simhei.ttf",
    "fonts/blend.bin",
    "fonts/codepages.bin",
  ],
};

for (const [game, assets] of Object.entries(expected)) {
  const product = PRODUCT_GAMES[game];
  assert.equal(product.runtimeFileLayout, "directory");
  assert.deepEqual(product.requiredShared, []);
  assert.deepEqual(product.runtimeAssets, assets);
  assert.deepEqual(runtimeFileNames(game, identities(assets)), assets);

  const appShellFiles = runtimeAppShellPaths({games: {
    [game]: {runtime: `runtime/${game}/${assets[0]}?hosted=1&v=test`},
  }});
  for (const name of assets) assert.ok(appShellFiles.includes(`runtime/${game}/${name}`));

  for (const extra of [
    "runtime/extra.mjs",
    "runtime/../../outside.js",
    "../outside.js",
    `${game}.dat`,
    `${game}.exe`,
    "fonts/other.ttf",
  ]) {
    const files = identities(assets);
    files[extra] = {bytes: 1, sha256: "0".repeat(64)};
    assert.throws(() => runtimeFileNames(game, files), `${game} must reject ${extra}`);
  }

  const missing = identities(assets);
  delete missing[assets.at(-1)];
  assert.throws(() => runtimeFileNames(game, missing), `${game} must reject an incomplete Runtime`);
}

assert.deepEqual(runtimeFileNames("th06", {
  "th06.html": {}, "th06.js": {}, "th06.wasm": {},
}), ["th06.html", "th06.js", "th06.wasm"]);
assert.throws(() => runtimeFileNames("th06", {
  "th06.html": {}, "th06.js": {}, "th06.wasm": {}, "extra.mjs": {},
}));

console.log(JSON.stringify({sdlRuntimeDirectory: "PASS", games: Object.keys(expected), exactAllowList: true}));
