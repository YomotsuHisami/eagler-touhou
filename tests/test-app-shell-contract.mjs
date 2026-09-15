import assert from "node:assert/strict";
import {
  APP_SHELL_CONTRACT_SCHEMA,
  APP_SHELL_RUNTIME_GLOBS,
  assertAppShellContract,
  createAppShellContract,
  deploymentAppShellPatterns,
  isRepositoryAppShellInput,
  runtimeAppShellPaths,
} from "../lib/app-shell-policy.mjs";
import { APP_SHELL_FILES, FRONTEND_PACKAGE_FILES } from "../lib/frontend-manifest.mjs";

const legacy = {
  games: {
    th06: {
      runtime: "runtime/th06/th06.html?hosted=1&v=a",
      multiplayerRuntime: "runtime/th06/multiplayer/th06.html?hosted=1&v=b",
    },
    th07: {
      runtime: "runtime/th07/th07.html?hosted=1&v=c",
    },
  },
};

const runtimePaths = runtimeAppShellPaths(legacy);
assert.deepEqual(runtimePaths, [
  "runtime/th06/multiplayer/th06.html",
  "runtime/th06/multiplayer/th06.js",
  "runtime/th06/multiplayer/th06.wasm",
  "runtime/th06/th06.html",
  "runtime/th06/th06.js",
  "runtime/th06/th06.wasm",
  "runtime/th07/th07.html",
  "runtime/th07/th07.js",
  "runtime/th07/th07.wasm",
]);

assert.deepEqual(APP_SHELL_RUNTIME_GLOBS, [
  "runtime/**/*.html",
  "runtime/**/*.js",
  "runtime/**/*.wasm",
  "runtime/**/*.mjs",
  "runtime/**/*.json",
  "runtime/**/fonts/**/*.gz",
  "runtime/**/fonts/**/*.ttc",
  "runtime/**/fonts/**/*.ttf",
  "runtime/**/fonts/**/*.bin",
]);
assert.deepEqual(deploymentAppShellPatterns({
  games: ["th06", "th07"],
  hostArtwork: ["th06-card.webp"],
}), [...APP_SHELL_RUNTIME_GLOBS, "assets/th06-card.webp"]);

assert.equal(isRepositoryAppShellInput("src/app-shell-sw.js"), true);
assert.equal(isRepositoryAppShellInput("app.js"), true);
assert.equal(isRepositoryAppShellInput("runtime/th07/th07.js"), false);
assert.equal(FRONTEND_PACKAGE_FILES.includes("app-shell-sw.js"), false,
  "generated Service Worker must never be a repository-owned frontend source file");
assert.equal(FRONTEND_PACKAGE_FILES.includes("migrate.html"), true,
  "origin migration must remain a published browser document");
assert.equal(APP_SHELL_FILES.includes("migrate.html"), false,
  "origin migration must bypass the App Shell cache");
assert.equal(FRONTEND_PACKAGE_FILES.includes("legacy-mount-retirement-sw.js"), true,
  "former Service Worker scope must have a published retirement script");
assert.equal(APP_SHELL_FILES.includes("legacy-mount-retirement-sw.js"), false,
  "retirement worker must not enter the current App Shell cache");

const manifestEntries = [
  ...APP_SHELL_FILES
    .map(url => ({ url, revision: "0".repeat(32) })),
  ...runtimePaths.map(url => ({ url, revision: "1".repeat(32) })),
  { url: "./", revision: "2".repeat(32) },
];
const contract = createAppShellContract({ buildId: "a".repeat(20), manifestEntries });
assert.equal(contract.schema, APP_SHELL_CONTRACT_SCHEMA);
assert.doesNotThrow(() => assertAppShellContract(contract, legacy));

const missingRuntime = {
  ...contract,
  entries: contract.entries.filter(path => path !== "runtime/th07/th07.wasm"),
};
assert.throws(() => assertAppShellContract(missingRuntime, legacy), /omits Runtime/);

console.log(JSON.stringify({ appShellContract: "PASS", runtimeFiles: runtimePaths.length }));
