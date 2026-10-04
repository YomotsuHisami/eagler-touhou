import { PRODUCT_GAMES } from "../product-catalog.mjs";
import { adaptLegacyStoredImportToPackage } from "./legacy-package-adapter.mjs";

export const LEGACY_GAME_DATA_CACHE_NAME = "eagler-touhou-game-data-v1";
const LOCAL_ASSET_DB = "eagler-touhou-local-assets-v1";
const LOCAL_ASSET_STORE = "ASSETS";
const EM_PRELOAD_DB = "EM_PRELOAD_CACHE";
const EM_PRELOAD_METADATA = "METADATA";
const EM_PRELOAD_PACKAGES = "PACKAGES";
const supportedGames = new Set(Object.keys(PRODUCT_GAMES));

function expectedGameDataPath(game) {
  if (!supportedGames.has(game)) throw new Error("invalid game id");
  return PRODUCT_GAMES[game].package.dataTarget.slice(1);
}

export function importedGameDataMetadataKey(game) {
  if (!supportedGames.has(game)) throw new Error("invalid game id");
  return `eagler-touhou-game-data-import-v1-${game}`;
}

export function importedOggMetadataKey(game) {
  if (!supportedGames.has(game)) throw new Error("invalid game id");
  return `eagler-touhou-ogg-import-v1-${game}`;
}

export function localGameDataCacheUrl(origin, game, version) {
  if (typeof origin !== "string" || !origin) throw new Error("invalid origin");
  if (typeof version !== "string" || !version) throw new Error("invalid game-data version");
  return new URL(`/.eagler-local/game-data/${game}/${encodeURIComponent(version)}/${expectedGameDataPath(game)}`, origin).href;
}

export function localOggCacheUrl(origin, game, version, filename) {
  if (typeof origin !== "string" || !origin) throw new Error("invalid origin");
  if (!supportedGames.has(game)) throw new Error("invalid game id");
  if (typeof version !== "string" || !version) throw new Error("invalid OGG version");
  if (typeof filename !== "string" || !/^[A-Za-z0-9_.-]+\.ogg$/.test(filename)) throw new Error("invalid OGG filename");
  return new URL(`/.eagler-local/ogg/${game}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`, origin).href;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export async function migrateLegacyStoredImport(game, {
  protocol,
  fallbackGameData = null,
  currentRevision = null,
  install,
  prepareState = null,
  prepareParsed = null,
  verifyInstalled = null,
  origin = globalThis.location?.origin || "https://local.invalid",
  storage = globalThis.localStorage,
  indexedDBFactory = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
} = {}) {
  if (typeof install !== "function" || typeof protocol !== "string" || !protocol) {
    throw new Error("legacy migration requires Package installer and protocol");
  }
  const originalState = await loadLegacyStoredImport(game, {
    fallbackGameData, origin, storage, indexedDBFactory, cacheStorage,
  });
  if (!originalState) return { status: "absent" };
  // Optional compatibility preparation may add verified font bytes in memory.
  // Cleanup always uses the original historical state, never added resources.
  const state = prepareState ? await prepareState(originalState) : originalState;
  if (state.incomplete) return { status: "incomplete", missing: state.incomplete };
  const adapted = adaptLegacyStoredImportToPackage(state, { protocol, origin });
  const parsed = prepareParsed ? await prepareParsed(adapted) : adapted;
  let installed = null;
  if (currentRevision !== parsed.descriptor.revision) installed = await install(parsed);
  // A revision match alone is not proof that durable bytes survived. New
  // clients verify the committed generation before releasing the old copy.
  if (verifyInstalled) await verifyInstalled(parsed, installed);
  await discardLegacyStoredImport(originalState, { origin, storage, indexedDBFactory, cacheStorage });
  return {
    status: currentRevision === parsed.descriptor.revision ? "already-current" : "migrated",
    descriptor: parsed.descriptor,
    installed,
  };
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

export function legacyLocalAssetKey(key, origin = "https://local.invalid") {
  try {
    const url = new URL(String(key), origin);
    if (url.pathname.startsWith("/.eagler-local/")) return url.pathname;
  } catch {}
  return String(key);
}

function validLegacyAsset(value) {
  return !!value && typeof value.key === "string" && value.key.startsWith("/.eagler-local/offline/") &&
    Number.isInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/i.test(value.sha256 || "");
}

export function normalizeLegacyImportedAssets(value) {
  const legacy = value?.legacyAssets || value?.offline;
  if (!legacy) return null;
  const runtimeVersion = String(legacy.runtimeVersion || "");
  if (!/^[a-f0-9]{16}$/i.test(runtimeVersion)) return null;
  if (!Array.isArray(legacy.shared) || !legacy.shared.every(item =>
      typeof item?.target === "string" && validLegacyAsset(item))) return null;
  if (!Array.isArray(legacy.languages) || !legacy.languages.every(item =>
      /^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(item?.id || "") && typeof item.title === "string" &&
      validLegacyAsset(item))) return null;
  return { runtimeVersion, shared: legacy.shared, languages: legacy.languages };
}

export function readLegacyGameDataMetadata(game, {
  storage = globalThis.localStorage,
  fallbackGameData = null,
} = {}) {
  try {
    const value = JSON.parse(storage?.getItem?.(importedGameDataMetadataKey(game)) || "null");
    if (!value || value.source !== "local-import" || value.game !== game ||
        typeof value.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(value.version) ||
        !/^[a-f0-9]{64}$/i.test(value.sha256 || "") || !Number.isInteger(value.bytes) || value.bytes <= 0) return null;
    const legacyAssets = normalizeLegacyImportedAssets(value);
    if ((value.legacyAssets || value.offline) && !legacyAssets) return null;
    const layout = /^sha256-[a-f0-9]{64}$/i.test(value.layout || "")
      ? value.layout
      : fallbackGameData && value.version === fallbackGameData.version &&
        value.sha256.toLowerCase() === String(fallbackGameData.sha256 || "").toLowerCase() &&
        value.bytes === fallbackGameData.bytes && /^sha256-[a-f0-9]{64}$/i.test(fallbackGameData.layout || "")
        ? fallbackGameData.layout
        : null;
    if (!layout) return null;
    return { ...value, layout, legacyAssets };
  } catch {
    return null;
  }
}

export function readLegacyOggMetadata(game, { storage = globalThis.localStorage } = {}) {
  try {
    const value = JSON.parse(storage?.getItem?.(importedOggMetadataKey(game)) || "null");
    if (!value || value.source !== "local-import" || value.game !== game ||
        typeof value.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(value.version) ||
        !Array.isArray(value.files) || !value.files.every(name => typeof name === "string" && /^[A-Za-z0-9_.-]+\.ogg$/.test(name))) return null;
    return value;
  } catch {
    return null;
  }
}

async function openExistingDatabase(name, indexedDBFactory) {
  if (!indexedDBFactory?.open) return null;
  return new Promise(resolve => {
    let created = false;
    const request = indexedDBFactory.open(name);
    request.onupgradeneeded = () => { created = true; };
    request.onsuccess = event => {
      const db = event.target.result;
      if (created) {
        db.close();
        try { indexedDBFactory.deleteDatabase(name); } catch {}
        resolve(null);
      } else {
        resolve(db);
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readLegacyImportedAsset(key, {
  origin = globalThis.location?.origin || "https://local.invalid",
  indexedDBFactory = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
} = {}) {
  const db = await openExistingDatabase(LOCAL_ASSET_DB, indexedDBFactory);
  if (db) {
    try {
      if (db.objectStoreNames.contains(LOCAL_ASSET_STORE)) {
        const transaction = db.transaction([LOCAL_ASSET_STORE], "readonly");
        const value = await requestResult(transaction.objectStore(LOCAL_ASSET_STORE).get(legacyLocalAssetKey(key, origin)));
        if (value?.blob instanceof Blob) return value.blob;
        if (value instanceof Blob) return value;
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new Blob([value]);
      }
    } catch {} finally {
      db.close();
    }
  }
  try {
    const response = await cacheStorage?.match?.(key);
    return response ? await response.blob() : null;
  } catch {
    return null;
  }
}

export async function deleteLegacyImportedAsset(key, {
  origin = globalThis.location?.origin || "https://local.invalid",
  indexedDBFactory = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
} = {}) {
  const db = await openExistingDatabase(LOCAL_ASSET_DB, indexedDBFactory);
  if (db) {
    try {
      if (db.objectStoreNames.contains(LOCAL_ASSET_STORE)) {
        const transaction = db.transaction([LOCAL_ASSET_STORE], "readwrite");
        transaction.objectStore(LOCAL_ASSET_STORE).delete(legacyLocalAssetKey(key, origin));
        await transactionDone(transaction);
      }
    } catch {} finally {
      db.close();
    }
  }
  try {
    const cache = await cacheStorage?.open?.(LEGACY_GAME_DATA_CACHE_NAME);
    await cache?.delete?.(key);
  } catch {}
}

export async function loadLegacyStoredImport(game, {
  fallbackGameData = null,
  origin = globalThis.location?.origin || "https://local.invalid",
  storage = globalThis.localStorage,
  indexedDBFactory = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
} = {}) {
  const gameData = readLegacyGameDataMetadata(game, { storage, fallbackGameData });
  if (!gameData) return null;
  const ogg = readLegacyOggMetadata(game, { storage });
  const assets = new Map();
  const dataKey = localGameDataCacheUrl(origin, game, gameData.version);
  const keys = [dataKey];
  for (const name of ogg?.files || []) keys.push(localOggCacheUrl(origin, game, ogg.version, name));
  for (const item of gameData.legacyAssets?.shared || []) keys.push(item.key);
  for (const item of gameData.legacyAssets?.languages || []) keys.push(item.key);
  const missing = [];
  for (const key of keys) {
    const blob = await readLegacyImportedAsset(key, { origin, indexedDBFactory, cacheStorage });
    if (!(blob instanceof Blob)) missing.push(key);
    else assets.set(key, blob);
  }
  return { game, gameData, ogg, assets, dataKey, ...(missing.length ? { incomplete: missing[0], missing } : {}) };
}

async function cleanupEmscriptenPreloadOwner(version, indexedDBFactory) {
  const db = await openExistingDatabase(EM_PRELOAD_DB, indexedDBFactory);
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains(EM_PRELOAD_METADATA) || !db.objectStoreNames.contains(EM_PRELOAD_PACKAGES)) return;
    const metadataTx = db.transaction([EM_PRELOAD_METADATA], "readonly");
    const metadataStore = metadataTx.objectStore(EM_PRELOAD_METADATA);
    const records = [];
    await new Promise((resolve, reject) => {
      const request = metadataStore.openCursor();
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return resolve();
        if (cursor.value?.eaglerLocalImport === version) records.push({ key: cursor.key, chunkCount: Math.max(0, Number(cursor.value.chunkCount) || 0) });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("cannot scan legacy preload metadata"));
    });
    if (!records.length) return;
    const transaction = db.transaction([EM_PRELOAD_METADATA, EM_PRELOAD_PACKAGES], "readwrite");
    const metadata = transaction.objectStore(EM_PRELOAD_METADATA);
    const packages = transaction.objectStore(EM_PRELOAD_PACKAGES);
    for (const record of records) {
      metadata.delete(record.key);
      const packageName = String(record.key).replace(/^metadata\//, "");
      for (let index = 0; index < record.chunkCount; index++) packages.delete(`package/${packageName}/${index}`);
    }
    await transactionDone(transaction);
  } catch {} finally {
    db.close();
  }
}

export async function discardLegacyStoredImport(state, {
  origin = globalThis.location?.origin || "https://local.invalid",
  storage = globalThis.localStorage,
  indexedDBFactory = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
} = {}) {
  if (!state?.gameData?.version || !state.game) return;
  const keys = [state.dataKey || localGameDataCacheUrl(origin, state.game, state.gameData.version)];
  for (const name of state.ogg?.files || []) keys.push(localOggCacheUrl(origin, state.game, state.ogg.version, name));
  for (const item of state.gameData.legacyAssets?.shared || []) keys.push(item.key);
  for (const item of state.gameData.legacyAssets?.languages || []) keys.push(item.key);
  await Promise.all(keys.map(key => deleteLegacyImportedAsset(key, { origin, indexedDBFactory, cacheStorage })));
  try { storage?.removeItem?.(importedGameDataMetadataKey(state.game)); } catch {}
  try { storage?.removeItem?.(importedOggMetadataKey(state.game)); } catch {}
  await cleanupEmscriptenPreloadOwner(state.gameData.version, indexedDBFactory);

  const anyLegacyMetadata = Object.keys(PRODUCT_GAMES).some(game => {
    try {
      return !!storage?.getItem?.(importedGameDataMetadataKey(game)) || !!storage?.getItem?.(importedOggMetadataKey(game));
    } catch {
      return true;
    }
  });
  if (!anyLegacyMetadata && indexedDBFactory?.deleteDatabase) {
    try { indexedDBFactory.deleteDatabase(LOCAL_ASSET_DB); } catch {}
    try { await cacheStorage?.delete?.(LEGACY_GAME_DATA_CACHE_NAME); } catch {}
  }
}

export const LEGACY_IMPORT_STORAGE = Object.freeze({
  localAssetDatabase: LOCAL_ASSET_DB,
  cacheName: LEGACY_GAME_DATA_CACHE_NAME,
  emscriptenPreloadDatabase: EM_PRELOAD_DB,
});
