/** L2/L3 workspace integration.
 * Preconditions: current TH06/TH07/TH08 Runtime build artifacts and TH06/TH07
 * original-content fixtures in the workspace.
 * Mutations: system temp only.
 * Invariant: after creating a resource-free all-product Runtime Release, host
 * assembly for TH06/TH07 succeeds even when EAGLER_WORKSPACE_ROOT points to an
 * empty directory. Only explicit original-content inputs may be consumed.
 * Proves: Runtime Release is a real host input and packager provenance does not
 * re-open sibling Runtime source repositories.
 * Does NOT prove: TH08 original-content host assembly, browser/gameplay, OGG,
 * language packs, thprac, device behavior, or publication.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { workspacePath } from "../lib/workspace-layout.mjs";

function run(args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd: resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1")), env, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolveRun()
      : reject(new Error(`${args.join(" ")} failed (${signal || code})`)));
  });
}

function runExpectFailure(args, env = process.env) {
  const child = spawnSync(process.execPath, args, {
    cwd: resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1")),
    env,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(child.error, undefined, `${args.join(" ")} could not start`);
  assert.notEqual(child.status, 0, `${args.join(" ")} unexpectedly succeeded`);
  return `${child.stdout || ""}\n${child.stderr || ""}`;
}

const scratch = await mkdtemp(resolve(tmpdir(), "eagler-runtime-release-host-"));
const runtimeRelease = resolve(scratch, "runtime-release");
const host = resolve(scratch, "host");
const external = resolve(scratch, "external");
const fakeWorkspace = resolve(scratch, "empty-workspace");
const artwork = resolve(scratch, "artwork");
const features = resolve(scratch, "features.json");

try {
  await mkdir(fakeWorkspace);
  await mkdir(artwork);
  await writeFile(features, JSON.stringify({
    schema: "eagler-touhou/server-features/1",
    resourceMode: "hosted",
    netplayRelay: "wss://relay.example.com/eagler-netplay/",
    gameDataFallback: { url: "https://downloads.example.com/packages", hint: "fixture" },
    originMigration: { mode: "http-to-https" },
    games: {
      th06: { languages: ["ja"], thprac: false },
      th07: { languages: ["ja"], thprac: false },
    },
  }));
  await run([
    "scripts/package-runtime-release.mjs",
    `--output=${runtimeRelease}`,
    `--th06-build=${workspacePath("th06", "build-web-eagler-thprac-test")}`,
    `--th06-multiplayer-build=${workspacePath("th06", "build-web-netplay-th06")}`,
    `--th07-build=${workspacePath("th07", "build-web-eagler-thprac")}`,
    `--th07-multiplayer-build=${workspacePath("th07", "build-web-th07-netplay")}`,
    `--th08-build=${workspacePath("th08", "build-eagler")}`,
    `--th10-build=${workspacePath("th10", "build-eagler")}`,
  ]);

  await run([
    "scripts/package-server.mjs",
    `--output=${host}`,
    `--runtime-release=${runtimeRelease}`,
    "--games=th06,th07",
    "--music=midi",
    "--profile=web-validation-runtime-release",
    `--feature-config=${features}`,
    `--artwork-dir=${artwork}`,
    `--font=${workspacePath("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf")}`,
    `--vanilla-font=${workspacePath("th06", "assets", "msgothic.ttc")}`,
    `--th06-assets=${workspacePath("th06", "assets")}`,
    `--th06-data-assets=${workspacePath("th06", "assets")}`,
    `--th07-assets=${workspacePath("th07", "assets")}`,
  ], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });

  const releaseFailure = runExpectFailure([
    "scripts/package-server.mjs",
    `--output=${resolve(scratch, "release-host")}`,
    `--runtime-release=${runtimeRelease}`,
    "--games=th06,th07",
    "--music=midi",
    "--profile=web-release-hosted",
    `--feature-config=${features}`,
    `--artwork-dir=${artwork}`,
    `--font=${workspacePath("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf")}`,
    `--vanilla-font=${workspacePath("th06", "assets", "msgothic.ttc")}`,
    `--th06-assets=${workspacePath("th06", "assets")}`,
    `--th06-data-assets=${workspacePath("th06", "assets")}`,
    `--th07-assets=${workspacePath("th07", "assets")}`,
  ], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });
  assert.match(releaseFailure, /required host UI asset is missing/,
    "web-release packaging must fail explicitly when selected host artwork is absent");

  await run(["scripts/verify-server-build.mjs", host], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });
  await run([
    "scripts/package-external-site.mjs",
    `--source=${host}`,
    `--output=${external}`,
    `--runtime-release=${runtimeRelease}`,
    "--games=th06,th07",
    "--profile=web-validation-runtime-release-external",
  ], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });
  await run(["scripts/verify-server-build.mjs", external], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });
  const manifest = JSON.parse(await readFile(resolve(host, "release-manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.sources), ["eagler-touhou"]);
  const deployment = JSON.parse(await readFile(resolve(host, "deployment.json"), "utf8"));
  assert.deepEqual(deployment.games, ["th06", "th07"]);
  const hostManifest = JSON.parse(await readFile(resolve(host, "host-manifest.json"), "utf8"));
  assert.equal(hostManifest.shared.netplayRelay, "wss://relay.example.com/eagler-netplay/");
  assert.equal(hostManifest.shared.gameDataFallback.url, "https://downloads.example.com/packages");
  assert.deepEqual(hostManifest.shared.originMigration, { mode: "http-to-https" });
  assert.match(hostManifest.games.th06.multiplayerRuntime, /^runtime\/th06\/multiplayer\/th06\.html\?hosted=1&v=/,
    "TH06 host assembly must publish the isolated multiplayer Runtime from Runtime Release");
  assert.match(hostManifest.games.th07.multiplayerRuntime, /^runtime\/th07\/multiplayer\/th07\.html\?hosted=1&v=/,
    "TH07 host assembly must publish the isolated multiplayer Runtime from Runtime Release");
  const externalDeployment = JSON.parse(await readFile(resolve(external, "deployment.json"), "utf8"));
  const externalManifest = JSON.parse(await readFile(resolve(external, "host-manifest.json"), "utf8"));
  const externalCatalog = JSON.parse(await readFile(resolve(external, "release-catalog.json"), "utf8"));
  assert.equal(externalDeployment.resourceMode, "external");
  assert.equal(externalManifest.shared.resourceMode, "external");
  assert.deepEqual(Object.keys(externalCatalog.games).sort(), ["th06", "th07"]);
  assert(!externalDeployment.files.some(file => file.path.startsWith("games/") || file.path.startsWith("shared/")),
    "external deployment must retain Package metadata without bundling game/shared payloads");
  assert(externalDeployment.files.some(file => file.path === "runtime/th06/th06.wasm"));
  assert(externalDeployment.files.some(file => file.path === "runtime/th07/th07.wasm"));

  const externalDeploymentBeforeMismatch = await readFile(resolve(external, "deployment.json"), "utf8");
  const runtimeManifestPath = resolve(runtimeRelease, "runtime-release.json");
  const changedRuntimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
  const changedRuntimePath = resolve(runtimeRelease, changedRuntimeManifest.games.th06.runtime.root, "th06.wasm");
  const changedRuntimeBytes = Buffer.concat([await readFile(changedRuntimePath), Buffer.from("runtime-mismatch")]);
  await writeFile(changedRuntimePath, changedRuntimeBytes);
  changedRuntimeManifest.games.th06.runtime.files["th06.wasm"] = {
    bytes: changedRuntimeBytes.length,
    sha256: createHash("sha256").update(changedRuntimeBytes).digest("hex"),
  };
  await writeFile(runtimeManifestPath, JSON.stringify(changedRuntimeManifest, null, 2));
  const mismatchFailure = runExpectFailure([
    "scripts/package-external-site.mjs",
    `--source=${host}`,
    `--output=${external}`,
    `--runtime-release=${runtimeRelease}`,
    "--games=th06,th07",
    "--profile=web-validation-runtime-release-external",
  ], { ...process.env, EAGLER_WORKSPACE_ROOT: fakeWorkspace });
  assert.match(mismatchFailure, /external Runtime identity does not match hosted source/);
  assert.equal(await readFile(resolve(external, "deployment.json"), "utf8"), externalDeploymentBeforeMismatch,
    "a mismatched Runtime candidate must not replace the previous External output");
  console.log(JSON.stringify({ runtimeReleaseHost: "PASS", games: deployment.games, sourceRepositories: Object.keys(manifest.sources) }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
