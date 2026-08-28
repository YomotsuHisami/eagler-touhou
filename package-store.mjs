import { validatePackageDescriptor } from "./package-descriptor.mjs";

export const PACKAGE_STORE_DB = "eagler-touhou-package-store-v1";
export const PACKAGE_STORE_DB_VERSION = 1;
export const PACKAGE_OBJECTS = "objects";
export const PACKAGE_GENERATIONS = "generations";
export const PACKAGE_INSTALLATIONS = "installations";

const GAME_ID = /^th\d{2}$/;
const GENERATION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function assertGame(game) {
  if (typeof game !== "string" || !GAME_ID.test(game)) throw new Error("invalid package game id");
}

function assertGenerationId(generationId) {
  if (typeof generationId !== "string" || !GENERATION_ID.test(generationId)) throw new Error("invalid package generation id");
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function hasStoredPackageBytes(value) {
  return value?.blob instanceof Blob || value?.data instanceof ArrayBuffer;
}

function normalizeStoredPackageObject(value) {
  if (!value || typeof value !== "object") return null;
  if (value.blob instanceof Blob) return value;
  if (!(value.data instanceof ArrayBuffer)) return null;
  return {
    ...value,
    blob: new Blob([value.data], { type: String(value.type || "application/octet-stream") }),
  };
}

async function writePackageObjectRecord(id, value, indexedDBFactory) {
  await withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_OBJECTS], "readwrite");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(PACKAGE_OBJECTS).put(value, id);
    await Promise.all([requestResult(request), done]);
  }, indexedDBFactory);
}

export async function readPackageObjects(objectIds, { indexedDBFactory } = {}) {
  const ids = [...new Set((objectIds || []).filter(id => typeof id === "string" && id))];
  if (!ids.length) return new Map();
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_OBJECTS], "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PACKAGE_OBJECTS);
    const values = await Promise.all(ids.map(id => requestResult(store.get(id))));
    await done;
    const result = new Map();
    for (let index = 0; index < ids.length; index++) {
      const normalized = normalizeStoredPackageObject(values[index]);
      if (normalized) result.set(ids[index], normalized);
    }
    return result;
  }, indexedDBFactory);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function randomObjectId() {
  if (globalThis.crypto?.randomUUID) return `obj-${crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error("secure random source unavailable");
  crypto.getRandomValues(bytes);
  return `obj-${[...bytes].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

export function generationKey(game, generationId) {
  assertGame(game);
  assertGenerationId(generationId);
  return [game, generationId];
}

export async function openPackageStore(indexedDBFactory = globalThis.indexedDB, { timeoutMs = 15000 } = {}) {
  if (!indexedDBFactory?.open) throw new Error("IndexedDB unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(PACKAGE_STORE_DB, PACKAGE_STORE_DB_VERSION);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Package Store open timed out"));
    }, timeoutMs);
    const finish = callback => value => {
      if (settled) {
        try { value?.target?.result?.close?.(); } catch {}
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PACKAGE_OBJECTS)) db.createObjectStore(PACKAGE_OBJECTS);
      if (!db.objectStoreNames.contains(PACKAGE_GENERATIONS)) db.createObjectStore(PACKAGE_GENERATIONS);
      if (!db.objectStoreNames.contains(PACKAGE_INSTALLATIONS)) db.createObjectStore(PACKAGE_INSTALLATIONS);
    };
    request.onsuccess = finish(event => {
      const db = event.target.result;
      db.onversionchange = () => db.close();
      resolve(db);
    });
    request.onerror = finish(() => reject(request.error || new Error("cannot open Package Store")));
    request.onblocked = finish(() => reject(new Error("Package Store open blocked")));
  });
}

async function withPackageDb(callback, indexedDBFactory) {
  const db = await openPackageStore(indexedDBFactory);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

export async function putPackageObject(value, {
  type = value?.type || "application/octet-stream",
  objectId = null,
  indexedDBFactory,
} = {}) {
  const id = objectId || randomObjectId();
  if (typeof id !== "string" || !/^obj-[a-z0-9-]{16,}$/i.test(id)) throw new Error("invalid package object id");
  const normalizedType = String(type || "application/octet-stream");
  let data = null;
  if (value instanceof ArrayBuffer) {
    // The acquisition boundary already materializes independent bytes. Keep
    // that exact buffer to avoid another full-size JS heap copy before the
    // IndexedDB structured clone, which matters on memory-constrained iOS.
    data = value;
  } else if (ArrayBuffer.isView(value)) {
    data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  } else if (value instanceof Blob) {
    data = await value.arrayBuffer();
  } else {
    throw new Error("package object must be binary data");
  }
  await writePackageObjectRecord(id, { data, type: normalizedType, bytes: data.byteLength }, indexedDBFactory);
  return id;
}

export async function readPackageObject(objectId, { indexedDBFactory } = {}) {
  if (typeof objectId !== "string" || !objectId) return null;
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_OBJECTS], "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(PACKAGE_OBJECTS).get(objectId));
    await done;
    return normalizeStoredPackageObject(value);
  }, indexedDBFactory);
}

export async function readPackageInstallation(game, { indexedDBFactory } = {}) {
  assertGame(game);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS], "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(PACKAGE_INSTALLATIONS).get(game));
    await done;
    return value || null;
  }, indexedDBFactory);
}

export async function readPackageGeneration(game, generationId, { indexedDBFactory } = {}) {
  const key = generationKey(game, generationId);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_GENERATIONS], "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(PACKAGE_GENERATIONS).get(key));
    await done;
    return value || null;
  }, indexedDBFactory);
}

export async function readCurrentPackageGeneration(game, { indexedDBFactory } = {}) {
  assertGame(game);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS], "readonly");
    const done = transactionDone(transaction);
    const installation = await requestResult(transaction.objectStore(PACKAGE_INSTALLATIONS).get(game));
    const generation = installation?.currentGeneration
      ? await requestResult(transaction.objectStore(PACKAGE_GENERATIONS).get(generationKey(game, installation.currentGeneration)))
      : null;
    await done;
    return generation ? { installation, generation } : { installation: installation || null, generation: null };
  }, indexedDBFactory);
}

export async function stagePendingPackageGeneration(generation, { source = null, indexedDBFactory } = {}) {
  if (!generation?.id || !generation?.game || generation.descriptor?.game !== generation.game || !generation.files || typeof generation.files !== "object") {
    throw new Error("invalid package generation");
  }
  validatePackageDescriptor(generation.descriptor);
  assertGenerationId(generation.id);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS], "readwrite");
    const done = transactionDone(transaction);
    const installs = transaction.objectStore(PACKAGE_INSTALLATIONS);
    const generations = transaction.objectStore(PACKAGE_GENERATIONS);
    const current = await requestResult(installs.get(generation.game));
    const nextSource = source ?? current?.source ?? "local";
    if (!new Set(["local", "remote"]).has(nextSource)) throw new Error("invalid installation source");
    generations.put(generation, generationKey(generation.game, generation.id));
    const installation = {
      ...(current || {}),
      game: generation.game,
      source: nextSource,
      currentGeneration: current?.currentGeneration ?? null,
      pendingGeneration: generation.id,
    };
    installs.put(installation, generation.game);
    await done;
    return installation;
  }, indexedDBFactory);
}

export async function attachPendingPackageObject(game, generationId, fileId, objectId, { indexedDBFactory } = {}) {
  const key = generationKey(game, generationId);
  if (typeof fileId !== "string" || !fileId || typeof objectId !== "string" || !objectId) throw new Error("invalid package file attachment");
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_OBJECTS, PACKAGE_GENERATIONS], "readwrite");
    const done = transactionDone(transaction);
    const objects = transaction.objectStore(PACKAGE_OBJECTS);
    const generations = transaction.objectStore(PACKAGE_GENERATIONS);
    const [object, generation] = await Promise.all([
      requestResult(objects.get(objectId)),
      requestResult(generations.get(key)),
    ]);
    if (!hasStoredPackageBytes(object) || !generation?.descriptor?.files || !Object.hasOwn(generation.descriptor.files, fileId)) {
      throw new Error("unknown package object or generation file");
    }
    generation.files = {
      ...generation.files,
      [fileId]: {
        objectId,
        revision: generation.descriptor.files[fileId].revision,
        ...(object?.data instanceof ArrayBuffer ? { storageMode: "arraybuffer" } : {}),
      },
    };
    generations.put(generation, key);
    await done;
    return generation;
  }, indexedDBFactory);
}

export async function commitPendingPackageGeneration(game, generationId, { source = null, indexedDBFactory } = {}) {
  const key = generationKey(game, generationId);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS], "readwrite");
    const done = transactionDone(transaction);
    const installs = transaction.objectStore(PACKAGE_INSTALLATIONS);
    const generations = transaction.objectStore(PACKAGE_GENERATIONS);
    const [installation, generation] = await Promise.all([
      requestResult(installs.get(game)),
      requestResult(generations.get(key)),
    ]);
    if (!generation || generation.game !== game) throw new Error("pending generation not found");
    if (installation?.pendingGeneration && installation.pendingGeneration !== generationId) throw new Error("different pending generation is active");
    const nextSource = source ?? installation?.source ?? "local";
    if (!new Set(["local", "remote"]).has(nextSource)) throw new Error("invalid installation source");
    const committed = {
      ...(installation || {}),
      game,
      source: nextSource,
      currentGeneration: generationId,
      pendingGeneration: null,
    };
    installs.put(committed, game);
    await done;
    return committed;
  }, indexedDBFactory);
}

export async function cancelPendingPackageGeneration(game, { indexedDBFactory } = {}) {
  assertGame(game);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS], "readwrite");
    const done = transactionDone(transaction);
    const installs = transaction.objectStore(PACKAGE_INSTALLATIONS);
    const generations = transaction.objectStore(PACKAGE_GENERATIONS);
    const installation = await requestResult(installs.get(game));
    if (!installation?.pendingGeneration) {
      await done;
      return installation || null;
    }
    generations.delete(generationKey(game, installation.pendingGeneration));
    installation.pendingGeneration = null;
    installs.put(installation, game);
    await done;
    return installation;
  }, indexedDBFactory);
}

export async function readPackageObjectBySource(game, generationId, source, { indexedDBFactory } = {}) {
  const key = generationKey(game, generationId);
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_GENERATIONS, PACKAGE_OBJECTS], "readonly");
    const done = transactionDone(transaction);
    const generation = await requestResult(transaction.objectStore(PACKAGE_GENERATIONS).get(key));
    if (!generation?.descriptor?.files) {
      await done;
      return null;
    }
    const fileId = Object.keys(generation.descriptor.files).find(id => generation.descriptor.files[id].source === source);
    const objectId = fileId ? generation.files?.[fileId]?.objectId : null;
    const object = objectId ? await requestResult(transaction.objectStore(PACKAGE_OBJECTS).get(objectId)) : null;
    await done;
    const normalized = normalizeStoredPackageObject(object);
    return normalized ? { fileId, declaration: generation.descriptor.files[fileId], objectId, ...normalized } : null;
  }, indexedDBFactory);
}

export async function garbageCollectPackageStore({ indexedDBFactory } = {}) {
  return withPackageDb(async db => {
    const transaction = db.transaction([PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS, PACKAGE_OBJECTS], "readwrite");
    const done = transactionDone(transaction);
    const installs = transaction.objectStore(PACKAGE_INSTALLATIONS);
    const generations = transaction.objectStore(PACKAGE_GENERATIONS);
    const objects = transaction.objectStore(PACKAGE_OBJECTS);
    const [allInstallations, allGenerations, allGenerationKeys, allObjectKeys] = await Promise.all([
      requestResult(installs.getAll()),
      requestResult(generations.getAll()),
      requestResult(generations.getAllKeys()),
      requestResult(objects.getAllKeys()),
    ]);
    const liveGenerations = new Set();
    for (const installation of allInstallations) {
      if (installation?.currentGeneration) liveGenerations.add(`${installation.game}\0${installation.currentGeneration}`);
      if (installation?.pendingGeneration) liveGenerations.add(`${installation.game}\0${installation.pendingGeneration}`);
    }
    const liveObjects = new Set();
    let generationsDeleted = 0;
    for (let index = 0; index < allGenerations.length; index++) {
      const generation = allGenerations[index];
      const key = allGenerationKeys[index];
      const live = generation && liveGenerations.has(`${generation.game}\0${generation.id}`);
      if (!live) {
        generations.delete(key);
        generationsDeleted++;
        continue;
      }
      for (const ref of Object.values(generation.files || {})) if (ref?.objectId) liveObjects.add(ref.objectId);
    }
    let objectsDeleted = 0;
    for (const objectId of allObjectKeys) {
      if (!liveObjects.has(objectId)) {
        objects.delete(objectId);
        objectsDeleted++;
      }
    }
    await done;
    return { generationsDeleted, objectsDeleted };
  }, indexedDBFactory);
}

export function packageMimeType(source, fallback = "application/octet-stream") {
  const lower = String(source || "").toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".wasm")) return "application/wasm";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".ttc")) return "font/ttf";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  if (lower.endsWith(".zip")) return "application/zip";
  return fallback;
}
