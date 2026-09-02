export const GAME_DATA_PACK_SCHEMA = "eagler-touhou/game-data-pack/1";
export const OFFLINE_GAME_PACK_SCHEMA = "eagler-touhou/offline-game-pack/1";
export const GAME_DATA_CACHE_NAME = "eagler-touhou-game-data-v1";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 0xffff + 22;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function safeZipName(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.startsWith("/") || name.includes("\0")) return false;
  return !name.split("/").some(part => !part || part === "." || part === "..");
}

const supportedGameDataGames = new Set(["th06", "th07", "th08"]);
const expectedGameDataPath = game => game === "th08" ? "th08.dat" : `${game}.data`;

export function importedOggMetadataKey(game) {
  if (!supportedGameDataGames.has(game)) throw new Error("invalid game id");
  return `eagler-touhou-ogg-import-v1-${game}`;
}

function assertStoredEntry(entry) {
  if (entry.flags & 0x0001) throw new Error(`${entry.name}: encrypted ZIP entries are not supported`);
  if (entry.method !== 0) throw new Error(`${entry.name}: ZIP entry must use STORE (method 0), not compression method ${entry.method}`);
  if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`${entry.name}: STORE entry size mismatch`);
}

async function locateEocd(blob) {
  if (!(blob instanceof Blob) || blob.size < 22) throw new Error("invalid ZIP file");
  const tailLength = Math.min(blob.size, MAX_EOCD_SEARCH);
  const tailOffset = blob.size - tailLength;
  const tail = new Uint8Array(await blob.slice(tailOffset).arrayBuffer());
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== tail.byteLength) continue;
    const disk = view.getUint16(offset + 4, true);
    const centralDisk = view.getUint16(offset + 6, true);
    const entriesOnDisk = view.getUint16(offset + 8, true);
    const totalEntries = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error("multi-disk ZIP is not supported");
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 is not supported");
    if (centralOffset + centralSize > blob.size) throw new Error("ZIP central directory is out of bounds");
    return { totalEntries, centralSize, centralOffset };
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

export async function parseStoredZip(blob) {
  const eocd = await locateEocd(blob);
  const centralBytes = new Uint8Array(await blob.slice(eocd.centralOffset, eocd.centralOffset + eocd.centralSize).arrayBuffer());
  const view = new DataView(centralBytes.buffer, centralBytes.byteOffset, centralBytes.byteLength);
  const entries = new Map();
  let offset = 0;
  for (let index = 0; index < eocd.totalEntries; index++) {
    if (offset + 46 > centralBytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("invalid ZIP central directory entry");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("ZIP64 entries are not supported");
    }
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralBytes.byteLength) throw new Error("ZIP central directory entry is truncated");
    const name = textDecoder.decode(centralBytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!safeZipName(name)) throw new Error(`unsafe ZIP entry name: ${name}`);
    if (entries.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    const entry = { name, flags, method, crc32, compressedSize, uncompressedSize, localOffset };
    assertStoredEntry(entry);

    const localBytes = new Uint8Array(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    if (localBytes.byteLength !== 30) throw new Error(`${name}: truncated ZIP local header`);
    const localView = new DataView(localBytes.buffer, localBytes.byteOffset, localBytes.byteLength);
    if (localView.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(`${name}: invalid ZIP local header`);
    if (localView.getUint16(8, true) !== method) throw new Error(`${name}: local/central compression method mismatch`);
    const localNameLength = localView.getUint16(26, true);
    const localExtraLength = localView.getUint16(28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > blob.size) throw new Error(`${name}: ZIP entry data is out of bounds`);
    entry.dataOffset = dataOffset;
    entries.set(name, entry);
    offset = next;
  }
  if (offset > centralBytes.byteLength) throw new Error("invalid ZIP central directory length");
  return entries;
}

function validateManifest(manifest) {
  if (!manifest || ![GAME_DATA_PACK_SCHEMA, OFFLINE_GAME_PACK_SCHEMA].includes(manifest.schema) || !supportedGameDataGames.has(manifest.game) ||
      typeof manifest.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(manifest.version) ||
      !manifest.data || typeof manifest.data.path !== "string" || manifest.data.path !== expectedGameDataPath(manifest.game) ||
      typeof manifest.data.layout !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(manifest.data.layout) ||
      !Number.isInteger(manifest.data.bytes) || manifest.data.bytes <= 0 ||
      !/^[a-f0-9]{64}$/i.test(manifest.data.sha256 || "")) {
    throw new Error("invalid game-data pack manifest");
  }
  if (manifest.data.path !== expectedGameDataPath(manifest.game)) throw new Error("game-data pack manifest game/path mismatch");
  if (manifest.version.toLowerCase() !== `sha256-${manifest.data.sha256.toLowerCase()}`) {
    throw new Error("game-data pack version does not identify its data bytes");
  }
  if (manifest.music != null) {
    if (manifest.music.mode !== "ogg" || typeof manifest.music.version !== "string" ||
        !/^sha256-[a-f0-9]{64}$/i.test(manifest.music.version) || !Array.isArray(manifest.music.files) ||
        !manifest.music.files.length || manifest.music.files.length > 64) throw new Error("invalid game-data pack OGG manifest");
    const names = new Set();
    for (const file of manifest.music.files) {
      if (typeof file?.path !== "string" || !/^[A-Za-z0-9_.-]+\.ogg$/.test(file.path) || names.has(file.path) ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid game-data pack OGG file");
      }
      names.add(file.path);
    }
  }
  if (manifest.schema === OFFLINE_GAME_PACK_SCHEMA) {
    const offline = manifest.offline;
    const runtime = offline?.runtime;
    if (!offline || !runtime || typeof runtime.version !== "string" || !/^[a-f0-9]{16}$/i.test(runtime.version) ||
        !Array.isArray(runtime.files) || runtime.files.length !== 3) {
      throw new Error("invalid offline runtime manifest");
    }
    const runtimeRoles = new Set();
    for (const file of runtime.files) {
      if (!file || !["html", "js", "wasm"].includes(file.role) || runtimeRoles.has(file.role) ||
          typeof file.path !== "string" || !safeZipName(file.path) || !file.path.startsWith("offline/runtime/") ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid offline runtime file");
      }
      runtimeRoles.add(file.role);
    }
    if (!["html", "js", "wasm"].every(role => runtimeRoles.has(role))) throw new Error("offline runtime is incomplete");

    if (!Array.isArray(offline.shared) || offline.shared.length < 2 || offline.shared.length > 8) {
      throw new Error("invalid offline shared resource manifest");
    }
    const sharedTargets = new Set();
    for (const file of offline.shared) {
      if (!file || !["/msgothic.ttc", "/unifont.otf"].includes(file.target) || sharedTargets.has(file.target) ||
          typeof file.path !== "string" || !safeZipName(file.path) || !file.path.startsWith("offline/shared/") ||
          !Number.isInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) {
        throw new Error("invalid offline shared resource");
      }
      sharedTargets.add(file.target);
    }
    if (!["/msgothic.ttc", "/unifont.otf"].every(target => sharedTargets.has(target))) {
      throw new Error("offline shared resources are incomplete");
    }

    if (!Array.isArray(offline.languages) || offline.languages.length > 16) throw new Error("invalid offline language manifest");
    const languageIds = new Set();
    for (const language of offline.languages) {
      if (!language || typeof language.id !== "string" || !/^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(language.id) ||
          languageIds.has(language.id.toLowerCase()) || typeof language.title !== "string" || !language.title ||
          typeof language.path !== "string" || !safeZipName(language.path) || !language.path.startsWith("offline/languages/") ||
          !Number.isInteger(language.bytes) || language.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(language.sha256 || "") ||
          language.runtimeVersion !== runtime.version) {
        throw new Error("invalid offline language pack");
      }
      languageIds.add(language.id.toLowerCase());
    }
  } else if (manifest.offline != null) {
    throw new Error("offline resources require the offline-game-pack schema");
  }
}

export async function parseStoredGameDataPack(blob) {
  const entries = await parseStoredZip(blob);
  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new Error("game-data pack is missing manifest.json");
  if (manifestEntry.uncompressedSize > 256 * 1024) throw new Error("game-data pack manifest is too large");
  let manifest;
  try {
    manifest = JSON.parse(await blob.slice(manifestEntry.dataOffset, manifestEntry.dataOffset + manifestEntry.uncompressedSize).text());
  } catch (error) {
    throw new Error(`invalid game-data pack manifest JSON: ${error?.message || error}`);
  }
  validateManifest(manifest);
  const dataEntry = entries.get(manifest.data.path);
  if (!dataEntry) throw new Error(`game-data pack is missing ${manifest.data.path}`);
  if (dataEntry.uncompressedSize !== manifest.data.bytes) throw new Error(`${manifest.data.path}: manifest size mismatch`);
  const allowed = new Set(["manifest.json", manifest.data.path]);
  const music = [];
  for (const file of manifest.music?.files || []) {
    const entry = entries.get(file.path);
    if (!entry) throw new Error(`game-data pack is missing ${file.path}`);
    if (entry.uncompressedSize !== file.bytes) throw new Error(`${file.path}: manifest size mismatch`);
    allowed.add(file.path);
    music.push({
      ...entry,
      sha256: file.sha256.toLowerCase(),
      blob: blob.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize, "audio/ogg")
    });
  }
  let offline = null;
  if (manifest.schema === OFFLINE_GAME_PACK_SCHEMA) {
    const takeDeclared = (declaration, type = "application/octet-stream") => {
      const entry = entries.get(declaration.path);
      if (!entry) throw new Error(`game-data pack is missing ${declaration.path}`);
      if (entry.uncompressedSize !== declaration.bytes) throw new Error(`${declaration.path}: manifest size mismatch`);
      allowed.add(declaration.path);
      return {
        ...declaration,
        sha256: declaration.sha256.toLowerCase(),
        method: entry.method,
        blob: blob.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize, type)
      };
    };
    const runtimeTypes = { html: "text/html", js: "text/javascript", wasm: "application/wasm" };
    offline = {
      runtime: {
        version: manifest.offline.runtime.version,
        files: manifest.offline.runtime.files.map(file => takeDeclared(file, runtimeTypes[file.role] || "application/octet-stream"))
      },
      shared: manifest.offline.shared.map(file => takeDeclared(file, file.target.endsWith(".ttc") ? "font/ttf" : "font/otf")),
      languages: manifest.offline.languages.map(language => takeDeclared(language, "application/zip"))
    };
  }
  for (const name of entries.keys()) {
    if (!allowed.has(name)) throw new Error(`unexpected game-data pack entry: ${name}`);
  }
  return {
    manifest,
    data: {
      ...dataEntry,
      blob: blob.slice(dataEntry.dataOffset, dataEntry.dataOffset + dataEntry.uncompressedSize, "application/octet-stream")
    },
    music,
    offline
  };
}

export function importedGameDataMetadataKey(game) {
  if (!supportedGameDataGames.has(game)) throw new Error("invalid game id");
  return `eagler-touhou-game-data-import-v1-${game}`;
}

export function localGameDataCacheUrl(origin, game, version) {
  if (typeof origin !== "string" || !origin) throw new Error("invalid origin");
  if (!supportedGameDataGames.has(game)) throw new Error("invalid game id");
  if (typeof version !== "string" || !version) throw new Error("invalid game-data version");
  return new URL(`/.eagler-local/game-data/${game}/${encodeURIComponent(version)}/${expectedGameDataPath(game)}`, origin).href;
}

export function localOggCacheUrl(origin, game, version, filename) {
  if (typeof origin !== "string" || !origin) throw new Error("invalid origin");
  if (!supportedGameDataGames.has(game)) throw new Error("invalid game id");
  if (typeof version !== "string" || !version) throw new Error("invalid OGG version");
  if (typeof filename !== "string" || !/^[A-Za-z0-9_.-]+\.ogg$/.test(filename)) throw new Error("invalid OGG filename");
  return new URL(`/.eagler-local/ogg/${game}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`, origin).href;
}
