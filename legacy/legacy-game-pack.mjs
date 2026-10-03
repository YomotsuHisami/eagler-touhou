import { PRODUCT_GAMES } from "../product-catalog.mjs";
import { isSafeStoredZipName, parseStoredZip, readStoredZipEntry } from "../package/stored-zip.mjs";

// Read compatibility only. Current packages are Package Descriptor / Package
// ZIP. Do not add a producer for either historical schema below.
export const GAME_DATA_PACK_SCHEMA = "eagler-touhou/game-data-pack/1";
export const OFFLINE_GAME_PACK_SCHEMA = "eagler-touhou/offline-game-pack/1";

const supportedGames = new Set(Object.keys(PRODUCT_GAMES));
const expectedGameDataPath = game => PRODUCT_GAMES[game].package.dataTarget.slice(1);

function validateManifest(manifest) {
  if (!manifest || ![GAME_DATA_PACK_SCHEMA, OFFLINE_GAME_PACK_SCHEMA].includes(manifest.schema) || !supportedGames.has(manifest.game) ||
      typeof manifest.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(manifest.version) ||
      !manifest.data || typeof manifest.data.path !== "string" || manifest.data.path !== expectedGameDataPath(manifest.game) ||
      typeof manifest.data.layout !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(manifest.data.layout) ||
      !Number.isInteger(manifest.data.bytes) || manifest.data.bytes <= 0 ||
      !/^[a-f0-9]{64}$/i.test(manifest.data.sha256 || "")) {
    throw new Error("invalid legacy game pack manifest");
  }
  if (manifest.version.toLowerCase() !== `sha256-${manifest.data.sha256.toLowerCase()}`) {
    throw new Error("legacy game pack version does not identify its data bytes");
  }
  if (manifest.music != null) {
    if (manifest.music.mode !== "ogg" || typeof manifest.music.version !== "string" ||
        !/^sha256-[a-f0-9]{64}$/i.test(manifest.music.version) || !Array.isArray(manifest.music.files) ||
        !manifest.music.files.length) throw new Error("invalid legacy game pack OGG manifest");
    const names = new Set();
    for (const file of manifest.music.files) {
      if (typeof file?.path !== "string" || !/^[A-Za-z0-9_.-]+\.ogg$/.test(file.path) || names.has(file.path) ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid legacy game pack OGG file");
      }
      names.add(file.path);
    }
  }
  if (manifest.schema === OFFLINE_GAME_PACK_SCHEMA) {
    const offline = manifest.offline;
    const runtime = offline?.runtime;
    if (!offline || !runtime || typeof runtime.version !== "string" || !/^[a-f0-9]{16}$/i.test(runtime.version) ||
        !Array.isArray(runtime.files) || runtime.files.length !== 3) {
      throw new Error("invalid legacy offline runtime manifest");
    }
    const runtimeRoles = new Set();
    for (const file of runtime.files) {
      if (!file || !["html", "js", "wasm"].includes(file.role) || runtimeRoles.has(file.role) ||
          typeof file.path !== "string" || !isSafeStoredZipName(file.path) || !file.path.startsWith("offline/runtime/") ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid legacy offline runtime file");
      }
      runtimeRoles.add(file.role);
    }
    if (!["html", "js", "wasm"].every(role => runtimeRoles.has(role))) throw new Error("legacy offline runtime is incomplete");

    if (!Array.isArray(offline.shared) || offline.shared.length < 2) {
      throw new Error("invalid legacy offline shared resource manifest");
    }
    const sharedTargets = new Set();
    for (const file of offline.shared) {
      if (!file || !["/msgothic.ttc", "/unifont.otf"].includes(file.target) || sharedTargets.has(file.target) ||
          typeof file.path !== "string" || !isSafeStoredZipName(file.path) || !file.path.startsWith("offline/shared/") ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid legacy offline shared resource");
      }
      sharedTargets.add(file.target);
    }
    if (!["/msgothic.ttc", "/unifont.otf"].every(target => sharedTargets.has(target))) {
      throw new Error("legacy offline shared resources are incomplete");
    }

    if (!Array.isArray(offline.languages)) throw new Error("invalid legacy offline language manifest");
    const languageIds = new Set();
    for (const language of offline.languages) {
      if (!language || typeof language.id !== "string" || !/^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(language.id) ||
          languageIds.has(language.id.toLowerCase()) || typeof language.title !== "string" || !language.title ||
          typeof language.path !== "string" || !isSafeStoredZipName(language.path) || !language.path.startsWith("offline/languages/") ||
          !Number.isInteger(language.bytes) || language.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(language.sha256 || "") ||
          language.runtimeVersion !== runtime.version) {
        throw new Error("invalid legacy offline language pack");
      }
      languageIds.add(language.id.toLowerCase());
    }
  } else if (manifest.offline != null) {
    throw new Error("legacy offline resources require the offline-game-pack schema");
  }
}

export async function parseStoredGameDataPack(blob) {
  // Historical legacy packs were always STORE; keep the compatibility reader
  // strict so a DEFLATE container is never silently reinterpreted.
  const entries = await parseStoredZip(blob, { allowDeflate: false });
  const entryBlob = async (entry, type) => new Blob([await readStoredZipEntry(blob, entry)], { type });
  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new Error("legacy game pack is missing manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await (await entryBlob(manifestEntry, "application/json")).text());
  } catch (error) {
    throw new Error(`invalid legacy game pack manifest JSON: ${error?.message || error}`);
  }
  validateManifest(manifest);
  const dataEntry = entries.get(manifest.data.path);
  if (!dataEntry) throw new Error(`legacy game pack is missing ${manifest.data.path}`);
  if (dataEntry.uncompressedSize !== manifest.data.bytes) throw new Error(`${manifest.data.path}: manifest size mismatch`);
  const music = [];
  for (const file of manifest.music?.files || []) {
    const entry = entries.get(file.path);
    if (!entry) throw new Error(`legacy game pack is missing ${file.path}`);
    if (entry.uncompressedSize !== file.bytes) throw new Error(`${file.path}: manifest size mismatch`);
    music.push({
      ...entry,
      sha256: file.sha256.toLowerCase(),
      blob: await entryBlob(entry, "audio/ogg"),
    });
  }
  let offline = null;
  if (manifest.schema === OFFLINE_GAME_PACK_SCHEMA) {
    const takeDeclared = async (declaration, type = "application/octet-stream") => {
      const entry = entries.get(declaration.path);
      if (!entry) throw new Error(`legacy game pack is missing ${declaration.path}`);
      if (entry.uncompressedSize !== declaration.bytes) throw new Error(`${declaration.path}: manifest size mismatch`);
      return {
        ...declaration,
        sha256: declaration.sha256.toLowerCase(),
        method: entry.method,
        blob: await entryBlob(entry, type),
      };
    };
    const runtimeTypes = { html: "text/html", js: "text/javascript", wasm: "application/wasm" };
    offline = {
      runtime: {
        version: manifest.offline.runtime.version,
        files: await Promise.all(manifest.offline.runtime.files.map(file => takeDeclared(file, runtimeTypes[file.role] || "application/octet-stream"))),
      },
      shared: await Promise.all(manifest.offline.shared.map(file => takeDeclared(file, file.target.endsWith(".ttc") ? "font/ttf" : "font/otf"))),
      languages: await Promise.all(manifest.offline.languages.map(language => takeDeclared(language, "application/zip"))),
    };
  }
  return {
    manifest,
    data: {
      ...dataEntry,
      blob: await entryBlob(dataEntry, "application/octet-stream"),
    },
    music,
    offline,
  };
}
