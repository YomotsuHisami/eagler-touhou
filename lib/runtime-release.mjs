import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { PRODUCT_CONTENT } from "./content-definition.mjs";
import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";
import { extractGameDataLayout } from "./runtime-data-layout.mjs";
import { assertRuntimeDataShell } from "./runtime-data-provider.mjs";

export const RUNTIME_RELEASE_SCHEMA = "eagler-touhou/runtime-release/1";

const SHA256 = /^[a-f0-9]{64}$/i;
const LAYOUT = /^sha256-[a-f0-9]{64}$/i;

function isCanonicalRelativePath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.includes(":")) return false;
  const parts = value.split("/");
  return parts.every(part => part && part !== "." && part !== "..");
}

export function runtimeStem(game) {
  return game === "th08" ? "th08-modern" : game;
}

// A directory runtime remains a closed, hash-identified code/font set. It does
// not relax the old Emscripten contract or allow original EXE/DAT/DLL content.
export function runtimeFileNames(game, files) {
  const product = PRODUCT_GAMES[game], stem = runtimeStem(game);
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error(`${game}: missing Runtime file identities`);
  const names = Object.keys(files);
  if (product?.runtimeFileLayout !== "directory") {
    const expected = [`${stem}.html`, `${stem}.js`, `${stem}.wasm`];
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`${game}: Runtime file set must be HTML/JS/WASM only`);
    return names;
  }
  const expected = product.runtimeAssets;
  const allowList = new Set(expected);
  for (const name of names) {
    if (!isCanonicalRelativePath(name)) throw new Error(`${game}: forbidden directory Runtime file: ${name}`);
  }
  if (names.length !== expected.length || names.some(name => !allowList.has(name)) ||
      expected.some(name => !Object.hasOwn(files, name))) {
    throw new Error(`${game}: Runtime file set does not match product allow-list`);
  }
  return names;
}

export function validateRuntimeReleaseManifest(manifest) {
  if (!manifest || manifest.schema !== RUNTIME_RELEASE_SCHEMA || manifest.protocol !== "eagler-touhou/1") {
    throw new Error("invalid Runtime Release manifest");
  }
  const registered = Object.keys(PRODUCT_GAMES);
  if (!manifest.games || JSON.stringify(Object.keys(manifest.games)) !== JSON.stringify(registered)) {
    throw new Error("Runtime Release must contain every registered game in canonical order");
  }
  for (const game of registered) {
    const product = PRODUCT_GAMES[game];
    const entry = manifest.games[game];
    if (!entry || entry.dataProvider !== product.dataProvider || !LAYOUT.test(entry.dataLayout || "")) {
      throw new Error(`${game}: invalid Runtime Release data contract`);
    }
    if (!entry.runtime || typeof entry.runtime !== "object") throw new Error(`${game}: normal Runtime is missing`);
    const variants = [["runtime", entry.runtime]];
    if (product.multiplayerRuntime) {
      if (!entry.multiplayerRuntime || typeof entry.multiplayerRuntime !== "object") {
        throw new Error(`${game}: multiplayer Runtime is missing`);
      }
      variants.push(["multiplayerRuntime", entry.multiplayerRuntime]);
    } else if (entry.multiplayerRuntime != null) {
      throw new Error(`${game}: unexpected multiplayer Runtime`);
    }
    for (const [variant, runtime] of variants) {
      if (!isCanonicalRelativePath(runtime.root)) {
        throw new Error(`${game} ${variant}: invalid Runtime root`);
      }
      const expectedNames = runtimeFileNames(game, runtime.files);
      for (const name of expectedNames) {
        const file = runtime.files[name];
        if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !SHA256.test(file.sha256 || "")) {
          throw new Error(`${game} ${variant}: invalid identity for ${name}`);
        }
      }
    }
    if (entry.features == null || typeof entry.features !== "object") throw new Error(`${game}: Runtime feature attestation is missing`);
    for (const key of ["thprac", "languages", "focusHitbox"]) {
      if (typeof entry.features[key] !== "boolean") throw new Error(`${game}: invalid Runtime feature ${key}`);
    }
  }
  return manifest;
}

export async function verifyRuntimeRelease(root) {
  const base = resolve(root);
  const manifest = validateRuntimeReleaseManifest(JSON.parse(await readFile(resolve(base, "runtime-release.json"), "utf8")));
  const expectedFiles = new Set(["runtime-release.json"]);
  for (const [game, entry] of Object.entries(manifest.games)) {
    const variants = [["normal", entry.runtime], ...(entry.multiplayerRuntime ? [["multiplayer", entry.multiplayerRuntime]] : [])];
    let normalLayout = null;
    for (const [variant, runtime] of variants) {
      const stem = runtimeStem(game);
      const htmlSource = await readFile(resolve(base, runtime.root, `${stem}.html`), "utf8");
      assertRuntimeDataShell(htmlSource, game, variant);
      for (const [name, identity] of Object.entries(runtime.files)) {
        const rel = `${runtime.root}/${name}`;
        expectedFiles.add(rel);
        const path = resolve(base, runtime.root, name);
        const info = await stat(path);
        if (!info.isFile() || info.size !== identity.bytes) throw new Error(`${game}: Runtime Release size mismatch: ${runtime.root}/${name}`);
        const bytes = await readFile(path);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (sha256 !== identity.sha256) throw new Error(`${game}: Runtime Release hash mismatch: ${runtime.root}/${name}`);
      }
      if (entry.dataProvider === "emscripten-preload") {
        const runtimeScript = await readFile(resolve(base, runtime.root, `${stem}.js`), "utf8");
        const layout = extractGameDataLayout(runtimeScript, game);
        if (layout.layout !== entry.dataLayout) {
          throw new Error(`${game} ${variant}: Runtime Release DATA layout does not match Runtime JS`);
        }
        if (normalLayout && (layout.layout !== normalLayout.layout || layout.bytes !== normalLayout.bytes)) {
          throw new Error(`${game}: normal and multiplayer Runtime DATA layouts differ`);
        }
        if (variant === "normal") normalLayout = layout;
      }
    }
    if (entry.dataProvider === "retail-memory") {
      const declaredLayout = PRODUCT_CONTENT[game]?.dataLayout;
      if (!declaredLayout || entry.dataLayout !== declaredLayout) {
        throw new Error(`${game}: Runtime Release DATA layout does not match declared content`);
      }
    }
    if (game === "th06" && normalLayout) {
      const hasFocusHitbox = normalLayout.files.some(([path]) => path === "/eagler-hitbox.png");
      if (entry.features.focusHitbox !== hasFocusHitbox) {
        throw new Error(`${game}: focusHitbox capability does not match Runtime DATA layout`);
      }
    }
  }

  const actualFiles = new Set();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const rel = relative(base, path).replaceAll("\\", "/");
      if (!isCanonicalRelativePath(rel)) throw new Error(`Runtime Release contains invalid path: ${rel}`);
      if (entry.isSymbolicLink()) throw new Error(`Runtime Release must not contain symlinks: ${rel}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) actualFiles.add(rel);
      else throw new Error(`Runtime Release contains unsupported filesystem entry: ${rel}`);
    }
  }
  await walk(base);
  const unexpected = [...actualFiles].filter(path => !expectedFiles.has(path)).sort();
  const missing = [...expectedFiles].filter(path => !actualFiles.has(path)).sort();
  if (unexpected.length || missing.length) {
    throw new Error(`Runtime Release file set mismatch${unexpected.length ? `; unexpected=${unexpected.join(",")}` : ""}${missing.length ? `; missing=${missing.join(",")}` : ""}`);
  }
  return manifest;
}
