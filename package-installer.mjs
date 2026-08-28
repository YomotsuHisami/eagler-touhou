import {
  attachGenerationFile,
  planPackageGeneration,
} from "./package-generation.mjs";
import {
  attachPendingPackageObject,
  cancelPendingPackageGeneration,
  commitPendingPackageGeneration,
  garbageCollectPackageStore,
  putPackageObject,
  packageMimeType,
  readCurrentPackageGeneration,
  stagePendingPackageGeneration,
} from "./package-store.mjs";
import { parsePackageZip } from "./package-zip.mjs";
import { validatePackageDescriptor } from "./package-descriptor.mjs";

function generationId() {
  const time = Date.now().toString(36);
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
  return `gen-${time}-${random}`;
}

function abortedDownloadError() {
  const error = new Error("已取消下载");
  error.name = "AbortError";
  return error;
}

export async function installPackageFromAcquisition({
  descriptor,
  desiredFileIds,
  source,
  acquire,
  reuseCurrent = source === "remote",
  onProgress = null,
}) {
  validatePackageDescriptor(descriptor);
  if (!new Set(["local", "remote"]).has(source)) throw new Error("invalid Package installation source");
  if (!Array.isArray(desiredFileIds) || typeof acquire !== "function") {
    throw new Error("invalid Package acquisition request");
  }

  const current = reuseCurrent ? (await readCurrentPackageGeneration(descriptor.game)).generation : null;
  const plan = planPackageGeneration({
    current,
    descriptor,
    desiredFileIds,
    generationId: generationId(),
  });
  await cancelPendingPackageGeneration(descriptor.game);
  await stagePendingPackageGeneration(plan.generation, { source });

  let generation = plan.generation;
  let completed = desiredFileIds.length - plan.needs.length;
  try {
    for (const fileId of plan.needs) {
      const declaration = descriptor.files[fileId];
      const acquired = await acquire(fileId, declaration);
      const acquiredBytes = acquired instanceof ArrayBuffer
        ? acquired.byteLength
        : ArrayBuffer.isView(acquired)
          ? acquired.byteLength
          : acquired instanceof Blob
            ? acquired.size
            : -1;
      if (acquiredBytes >= 0) {
        const expectedBytes = Number(declaration?.bytes) || 0;
        if (expectedBytes && acquiredBytes !== expectedBytes) {
          throw new Error(`${fileId}: Package file size mismatch (${acquiredBytes}/${expectedBytes})`);
        }
        const objectId = await putPackageObject(acquired, {
          type: acquired?.type || packageMimeType(declaration.source),
        });
        generation = attachGenerationFile(generation, fileId, objectId, { storageMode: "arraybuffer" });
        await attachPendingPackageObject(descriptor.game, generation.id, fileId, objectId);
      } else {
        // The new Descriptor is authoritative. Files removed by it never enter
        // desiredFileIds. Every file that remains desired is part of this
        // update transaction and must be acquired before current may switch.
        throw new Error(`${fileId}: desired Package file is unavailable`);
      }
      completed++;
      onProgress?.({ completed, total: desiredFileIds.length, fileId, found: acquiredBytes >= 0 });
    }
    const installation = await commitPendingPackageGeneration(descriptor.game, generation.id, { source });
    return { installation, generation: (await readCurrentPackageGeneration(descriptor.game)).generation };
  } catch (error) {
    try { await cancelPendingPackageGeneration(descriptor.game); } catch {}
    try { await garbageCollectPackageStore(); } catch {}
    throw error;
  }
}

export async function installPackageFromZip(blob, { onProgress = null } = {}) {
  const parsed = await parsePackageZip(blob);
  return installParsedPackageZip(parsed, { onProgress });
}

export async function installParsedPackageZip(parsed, { onProgress = null } = {}) {
  if (!parsed?.descriptor || !(parsed.files instanceof Map)) throw new Error("invalid parsed Package ZIP");
  const desiredFileIds = [...parsed.files.keys()];
  return installPackageFromAcquisition({
    descriptor: parsed.descriptor,
    desiredFileIds,
    source: "local",
    // ZIP bytes explicitly supplied by the user take precedence over any
    // existing object even if a third-party Descriptor reused the revision.
    reuseCurrent: false,
    acquire: async fileId => {
      const sliced = parsed.files.get(fileId)?.blob || null;
      if (!(sliced instanceof Blob)) return null;
      // Treat the user-selected File/ZIP only as an input container. Materialize
      // each entry into independent bytes before crossing the persistent-store
      // boundary. This matches Emscripten's IndexedDB preload-cache model and
      // avoids relying on WebKit serialization of disk-backed File/Blob slices.
      return sliced.arrayBuffer();
    },
    onProgress,
  });
}

export async function installPackageFromRemote(descriptor, {
  descriptorUrl,
  desiredFileIds,
  source = "remote",
  fetchImpl = globalThis.fetch,
  onProgress = null,
  signal = null,
} = {}) {
  if (typeof descriptorUrl !== "string" && !(descriptorUrl instanceof URL)) throw new Error("remote Descriptor URL required");
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable");
  const base = new URL(descriptorUrl, globalThis.location?.href || "https://package.invalid/");
  return installPackageFromAcquisition({
    descriptor,
    desiredFileIds,
    source,
    reuseCurrent: true,
    acquire: async (_fileId, declaration) => {
      const url = new URL(declaration.source, base);
      if (signal?.aborted) throw abortedDownloadError();
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal });
        if (response.status === 404 || response.status === 410) return null;
        if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
        return response.arrayBuffer();
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw abortedDownloadError();
        throw new Error(`${url.pathname}: ${error?.message || error}`);
      }
    },
    onProgress,
  });
}
