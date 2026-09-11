import {
  planPackageGeneration,
} from "./package-generation.mjs";
import {
  cancelPendingPackageGeneration,
  commitPendingPackageGeneration,
  garbageCollectPackageStore,
  putPendingPackageObject,
  refreshPendingPackageOperation,
  packageMimeType,
  readCurrentPackageGeneration,
  stagePendingPackageGeneration,
} from "./package-store.mjs";
import { parsePackageZip } from "./package-zip.mjs";
import { validatePackageDescriptor } from "./package-descriptor.mjs";
import { createPackageMutationQueue } from "./package-mutation-queue.mjs";
import { sha256Hex } from "./package-integrity.mjs";

const packageMutations = createPackageMutationQueue();

function generationId() {
  const time = Date.now().toString(36);
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
  return `gen-${time}-${random}`;
}

function operationId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `op-${random.slice(0, 40)}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortedDownloadError();
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stageWhenAvailable(generation, { source, operationId: owner, signal }) {
  while (true) {
    throwIfAborted(signal);
    try {
      return await stagePendingPackageGeneration(generation, { source, operationId: owner });
    } catch (error) {
      if (error?.name !== "PackageMutationBusyError") throw error;
      // IndexedDB is the cross-document authority. Polling here is only the
      // waiter; it never cancels or overwrites somebody else's staging state.
      await delay(100);
    }
  }
}

function abortedDownloadError() {
  const error = new Error("已取消下载");
  error.name = "AbortError";
  return error;
}

async function installPackageFromAcquisitionExclusive({
  descriptor,
  desiredFileIds,
  source,
  acquire,
  reuseCurrent = source === "remote",
  onProgress = null,
  signal = null,
}) {
  const currentResult = reuseCurrent
    ? await readCurrentPackageGeneration(descriptor.game)
    : { installation: null, generation: null };
  const resolvedSource = typeof source === "function" ? await source(currentResult) : source;
  const resolvedDesiredFileIds = typeof desiredFileIds === "function"
    ? await desiredFileIds(currentResult)
    : desiredFileIds;
  if (!new Set(["local", "remote"]).has(resolvedSource)) throw new Error("invalid Package installation source");
  if (!Array.isArray(resolvedDesiredFileIds) || typeof acquire !== "function") {
    throw new Error("invalid Package acquisition request");
  }

  const plan = planPackageGeneration({
    current: currentResult.generation,
    descriptor,
    desiredFileIds: resolvedDesiredFileIds,
    generationId: generationId(),
  });
  const owner = operationId();
  throwIfAborted(signal);
  await stageWhenAvailable(plan.generation, { source: resolvedSource, operationId: owner, signal });
  const heartbeat = setInterval(() => {
    void refreshPendingPackageOperation(descriptor.game, plan.generation.id, owner).catch(() => {});
  }, 30_000);

  let generation = plan.generation;
  let completed = resolvedDesiredFileIds.length - plan.needs.length;
  try {
    for (const fileId of plan.needs) {
      throwIfAborted(signal);
      const declaration = descriptor.files[fileId];
      const acquired = await acquire(fileId, declaration);
      throwIfAborted(signal);
      const acquiredBytes = acquired instanceof ArrayBuffer
        ? acquired.byteLength
        : ArrayBuffer.isView(acquired)
          ? acquired.byteLength
          : acquired instanceof Blob
            ? acquired.size
            : -1;
      if (acquiredBytes >= 0) {
        if (declaration?.bytes != null && acquiredBytes !== Number(declaration.bytes)) {
          throw new Error(`${fileId}: Package file size mismatch (${acquiredBytes}/${declaration.bytes})`);
        }
        if (declaration?.sha256) {
          const actualHash = await sha256Hex(acquired);
          throwIfAborted(signal);
          if (actualHash.toLowerCase() !== declaration.sha256.toLowerCase()) {
            throw new Error(`${fileId}: Package file SHA-256 mismatch`);
          }
        }
        const stored = await putPendingPackageObject(descriptor.game, generation.id, fileId, acquired, {
          type: acquired?.type || packageMimeType(declaration.source),
          operationId: owner,
        });
        generation = stored.generation;
      } else {
        // The new Descriptor is authoritative. Files removed by it never enter
        // desiredFileIds. Every file that remains desired is part of this
        // update transaction and must be acquired before current may switch.
        throw new Error(`${fileId}: desired Package file is unavailable`);
      }
      completed++;
      onProgress?.({ completed, total: resolvedDesiredFileIds.length, fileId, found: acquiredBytes >= 0 });
      throwIfAborted(signal);
    }
    // Cancellation is honored until the commit transaction begins. Once the
    // transaction has committed, the operation is complete and later aborts
    // do not masquerade as a rollback.
    throwIfAborted(signal);
    const installation = await commitPendingPackageGeneration(descriptor.game, generation.id, { source: resolvedSource, operationId: owner });
    clearInterval(heartbeat);
    return { installation, generation: (await readCurrentPackageGeneration(descriptor.game)).generation };
  } catch (error) {
    clearInterval(heartbeat);
    try { await cancelPendingPackageGeneration(descriptor.game, { generationId: generation.id, operationId: owner }); } catch {}
    try { await garbageCollectPackageStore(); } catch {}
    throw error;
  }
}

export async function installPackageFromAcquisition(options) {
  validatePackageDescriptor(options?.descriptor);
  return packageMutations.run(options.descriptor.game, () => installPackageFromAcquisitionExclusive(options));
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
    signal,
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
