import { writeRuntimeGeneration } from "../lib/runtime-generations.mjs";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { RUNTIME_RELEASE_SCHEMA, runtimeStem, runtimeFileNames, validateRuntimeReleaseManifest, verifyRuntimeRelease } from "../lib/runtime-release.mjs";
import { extractGameDataLayout } from "../lib/runtime-data-layout.mjs";
import { assertRuntimeDataShell } from "../lib/runtime-data-provider.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf("=");
  if (!value.startsWith("--") || split < 3) throw new Error(`invalid argument: ${value}`);
  return [value.slice(2, split), value.slice(split + 1)];
}));
const required = name => {
  if (!args[name]) throw new Error(`missing --${name}=PATH`);
  return resolve(args[name]);
};
const output = required("output");
const temporaryRoot = resolve(dirname(output), ".tmp");
const staging = resolve(temporaryRoot, `${basename(output)}.staging-${randomUUID()}`);
const builds = Object.fromEntries(Object.entries(PRODUCT_GAMES).flatMap(([game, product]) => [
  [game, required(`${game}-build`)],
  ...(product.multiplayerRuntime ? [[`${game}Multiplayer`, required(`${game}-multiplayer-build`)]] : []),
]));

async function identity(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function compileAttestation(build) {
  try {
    return await readFile(resolve(build, "compile_commands.json"), "utf8");
  } catch {
    return "";
  }
}

async function directoryFeatureAttestation(game, build) {
  const manifest = JSON.parse(await readFile(resolve(build, "manifest.json"), "utf8"));
  if (manifest.game !== game || manifest.protocol !== "eagler-touhou/1") {
    throw new Error(`${game}: invalid directory Runtime manifest`);
  }
  return Object.fromEntries(["thprac", "languages", "focusHitbox"].map(feature => {
    const value = manifest.features?.[feature];
    if (value != null && typeof value !== "boolean") {
      throw new Error(`${game}: invalid directory Runtime feature attestation: ${feature}`);
    }
    return [feature, value === true];
  }));
}

async function copyVariant(game, build, root, variant) {
  const stem = runtimeStem(game);
  const html = await readFile(resolve(build, `${stem}.html`), "utf8");
  assertRuntimeDataShell(html, game, variant);
  if (game === "th09" && variant === "multiplayer") {
    const wasm = await readFile(resolve(build, "th09.wasm"));
    const exports = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(entry => entry.name));
    const required = ["th09_peer_url_buffer", "th09_peer_connect", "th09_peer_state", "th09_network_room_begin"];
    const missing = required.filter(name => !exports.has(name));
    if (missing.length) throw new Error(`th09: multiplayer Runtime WASM is missing exports: ${missing.join(", ")}`);
  }
  await mkdir(resolve(staging, root), { recursive: true });
  const files = {};
  if (PRODUCT_GAMES[game].runtimeFileLayout === "directory") {
    const directory = JSON.parse(await readFile(resolve(build, "runtime-files.json"), "utf8"));
    if (directory.schema !== "eagler-touhou/runtime-directory/1") throw new Error(`${game}: missing directory Runtime build manifest`);
    for (const name of runtimeFileNames(game, directory.files)) {
      const source = resolve(build, name), actual = await identity(source), expected = directory.files[name];
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`${game}: stale Runtime build identity: ${name}`);
      await mkdir(dirname(resolve(staging, root, name)), { recursive: true });
      await cp(source, resolve(staging, root, name)); files[name] = actual;
    }
    return files;
  }
  for (const extension of ["html", "js", "wasm"]) {
    const name = `${stem}.${extension}`;
    const source = resolve(build, name);
    await cp(source, resolve(staging, root, name));
    files[name] = await identity(source);
  }
  return files;
}

async function immutableVariant(game, build, root, variant) {
  const files = await copyVariant(game, build, root, variant);
  const generation = await writeRuntimeGeneration({ site: staging, root: root + "/",
    source: resolve(staging, root), entry: `${runtimeStem(game)}.html`,
    names: Object.keys(files), expected: files });
  for (const name of Object.keys(files)) await rm(resolve(staging, root, name));
  return { root: `${root}/${generation.generation}`, generation: generation.generation, files };
}

await mkdir(temporaryRoot, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
try {
const games = {};
for (const game of Object.keys(PRODUCT_GAMES)) {
  const product = PRODUCT_GAMES[game];
  const normalBuild = builds[game];
  const normalRoot = `runtime/${game}`;
  const runtime = await immutableVariant(game, normalBuild, normalRoot, "normal");
  let multiplayerRuntime = null;
  if (product.multiplayerRuntime) {
    const multiplayerBuild = builds[`${game}Multiplayer`];
    const multiplayerRoot = `runtime/${game}/multiplayer`;
    multiplayerRuntime = await immutableVariant(game, multiplayerBuild, multiplayerRoot, "multiplayer");
  }

  let dataLayout = null;
  let normalLayout = null;
  if (product.dataProvider === "emscripten-preload") {
    const normalJs = await readFile(resolve(normalBuild, `${game}.js`), "utf8");
    normalLayout = extractGameDataLayout(normalJs, game);
    dataLayout = normalLayout.layout;
    if (multiplayerRuntime) {
      const multiplayerJs = await readFile(resolve(builds[`${game}Multiplayer`], `${game}.js`), "utf8");
      const multiplayerLayout = extractGameDataLayout(multiplayerJs, game);
      if (normalLayout.layout !== multiplayerLayout.layout || normalLayout.bytes !== multiplayerLayout.bytes) {
        throw new Error(`${game}: normal and multiplayer Runtime DATA layouts differ`);
      }
    }
  } else {
    // retail-memory providers use the product's declared original-content layout.
    const { PRODUCT_CONTENT } = await import("../lib/content-definition.mjs");
    dataLayout = PRODUCT_CONTENT[game]?.dataLayout;
  }

  const directoryFeatures = product.runtimeFileLayout === "directory"
    ? await directoryFeatureAttestation(game, normalBuild)
    : null;
  const compile = directoryFeatures ? "" : await compileAttestation(normalBuild);
  games[game] = {
    dataProvider: product.dataProvider,
    dataLayout,
    runtime,
    ...(multiplayerRuntime ? { multiplayerRuntime } : {}),
    features: {
      thprac: !!product.features.thprac && (directoryFeatures?.thprac === true || compile.includes("THPRAC_PORTABLE_ENABLED=1")),
      languages: !!product.features.languages && (directoryFeatures?.languages === true || compile.includes("-DTH_ENABLE_THCRAP ")),
      focusHitbox: !!product.features.focusHitbox && (directoryFeatures?.focusHitbox === true || !!normalLayout?.files.some(([path]) => path === "/eagler-hitbox.png")),
    },
  };
}

const manifest = validateRuntimeReleaseManifest({
  schema: RUNTIME_RELEASE_SCHEMA,
  protocol: "eagler-touhou/1",
  games,
});
await writeFile(resolve(staging, "runtime-release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await verifyRuntimeRelease(staging);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(JSON.stringify({ output, games: Object.keys(games), schema: RUNTIME_RELEASE_SCHEMA }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
