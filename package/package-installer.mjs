import {
  planPackageGeneration,
} from "./package-generation.mjs";
import {
  attachPendingPackageObject,
  detachCurrentPackageGeneration,
  attestPackageObjectSha256,
  cancelPendingPackageGeneration,
  commitPendingPackageGeneration,
  garbageCollectPackageStore,
  putPendingPackageObject,
  refreshPendingPackageOperation,
  packageMimeType,
  readPackageObject,
  readCurrentPackageGeneration,
  readVerifiedPackageObjectBySha256,
  readPackageObjectKeys,
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

async function invalidReusableFileIds(current, descriptor, desiredFileIds) {
  if (!current?.descriptor?.files || !current.files || typeof current.files !== "object") return [];
  const invalid = new Set();
  const candidates = [];
  const objectIds = [];
  for (const fileId of desiredFileIds) {
    const previous = current.descriptor.files[fileId];
    const next = descriptor.files[fileId];
    const reference = current.files[fileId];
    if (previous?.revision !== next?.revision || !reference?.objectId) continue;
    const previousBytes = previous.bytes == null ? null : Number(previous.bytes);
    const nextBytes = next.bytes == null ? null : Number(next.bytes);
    const previousHash = previous.sha256?.toLowerCase() || null;
    const nextHash = next.sha256?.toLowerCase() || null;
    if (previousBytes !== nextBytes || (previousHash && nextHash && previousHash !== nextHash)) {
      invalid.add(fileId);
      continue;
    }
    candidates.push({ fileId, objectId: reference.objectId, previousHash, nextHash, bytes: nextBytes });
    objectIds.push(reference.objectId);
  }
  if (!candidates.length) return [...invalid];
  const presentObjectIds = await readPackageObjectKeys(objectIds);
  for (const candidate of candidates) {
    if (!presentObjectIds.has(candidate.objectId)) {
      invalid.add(candidate.fileId);
      continue;
    }
    // Packages published before full SHA-256 declarations used only the
    // 16-character file revision. During their bounded upgrade window, hash
    // the existing object instead of downloading identical bytes again.
    if (!candidate.previousHash && candidate.nextHash) {
      if (!Number.isSafeInteger(candidate.bytes) || candidate.bytes < 0) {
        invalid.add(candidate.fileId);
        continue;
      }
      const object = await readPackageObject(candidate.objectId);
      const actualHash = object ? await sha256Hex(object.data || object.blob) : null;
      if (actualHash?.toLowerCase() !== candidate.nextHash) {
        invalid.add(candidate.fileId);
        continue;
      }
      await attestPackageObjectSha256(candidate.objectId, candidate.nextHash, candidate.bytes);
    }
  }
  return [...invalid];
}

async function stageWhenAvailable(generation, { source, operationId: owner, signal, webLockHeld = false, expectedGenerationId }) {
  while (true) {
    throwIfAborted(signal);
    try {
      return await stagePendingPackageGeneration(generation, { source, operationId: owner, webLockHeld, expectedGenerationId });
    } catch (error) {
      if (error?.name !== "PackageMutationBusyError") throw error;
      // Web Locks serialize current browsers. IndexedDB remains the durable
      // fallback/compatibility authority, so polling here only waits for a
      // genuinely live legacy/non-WebLock owner.
      await delay(100);
    }
  }
}

function abortedDownloadError() {
  const error = new Error("已取消下载");
  error.name = "AbortError";
  return error;
}

async function withPackageWebLock(game, signal, operation) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return operation(false);
  const options = signal ? { mode: "exclusive", signal } : { mode: "exclusive" };
  try {
    return await locks.request(`eagler-touhou-package:${game}`, options, () => operation(true));
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortedDownloadError();
    throw error;
  }
}

async function installPackageFromAcquisitionExclusive({
  descriptor,
  desiredFileIds,
  source,
  acquire,
  reuseCurrent = source === "remote",
  onProgress = null,
  signal = null,
  expectedGenerationId = undefined,
}, webLockHeld = false) {
  const observed = reuseCurrent || expectedGenerationId !== undefined
    ? await readCurrentPackageGeneration(descriptor.game)
    : { installation: null, generation: null };
  if (expectedGenerationId !== undefined && (observed.installation?.currentGeneration ?? null) !== expectedGenerationId) {
    const error = new Error("Package generation changed; inspect and confirm import again");
    error.name = "PackageGenerationChangedError"; throw error;
  }
  // User-supplied ZIP bytes remain authoritative, even when a confirmation
  // fence required reading current. A fence must not enable object reuse.
  const currentResult = reuseCurrent ? observed : { installation: null, generation: null };
  const resolvedSource = typeof source === "function" ? await source(currentResult) : source;
  const resolvedDesiredFileIds = typeof desiredFileIds === "function"
    ? await desiredFileIds(currentResult)
    : desiredFileIds;
  if (!new Set(["local", "remote"]).has(resolvedSource)) throw new Error("invalid Package installation source");
  if (!Array.isArray(resolvedDesiredFileIds) || typeof acquire !== "function") {
    throw new Error("invalid Package acquisition request");
  }

  // A current generation may contain a stale object reference after browser
  // eviction or manual store damage. Do this check before planning so a file
  // with the same declared revision is re-acquired instead of being silently
  // carried into the next generation.
  const invalidReusableIds = await invalidReusableFileIds(
    currentResult.generation,
    descriptor,
    resolvedDesiredFileIds,
  );

  const plan = planPackageGeneration({
    current: currentResult.generation,
    descriptor,
    desiredFileIds: resolvedDesiredFileIds,
    forceFileIds: invalidReusableIds,
    generationId: generationId(),
  });
  const owner = operationId();
  throwIfAborted(signal);
  await stageWhenAvailable(plan.generation, { source: resolvedSource, operationId: owner, signal, webLockHeld, expectedGenerationId });
  const heartbeat = setInterval(() => {
    void refreshPendingPackageOperation(descriptor.game, plan.generation.id, owner).catch(() => {});
  }, 30_000);

  let generation = plan.generation;
  let completed = resolvedDesiredFileIds.length - plan.needs.length;
  try {
    for (const fileId of plan.needs) {
      throwIfAborted(signal);
      const declaration = descriptor.files[fileId];
      const verified = declaration?.sha256 && declaration?.bytes != null
        ? await readVerifiedPackageObjectBySha256(declaration.sha256, declaration.bytes)
        : null;
      if (verified) {
        generation = await attachPendingPackageObject(
          descriptor.game,
          generation.id,
          fileId,
          verified.objectId,
          { operationId: owner },
        );
        completed++;
        onProgress?.({ completed, total: resolvedDesiredFileIds.length, fileId, found: true, reused: true });
        continue;
      }
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
          sha256: declaration?.sha256 || null,
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
  return packageMutations.run(options.descriptor.game, () =>
    withPackageWebLock(options.descriptor.game, options.signal, webLockHeld =>
      installPackageFromAcquisitionExclusive(options, webLockHeld)));
}

export async function installPackageFromZip(blob, { onProgress = null } = {}) {
  const parsed = await parsePackageZip(blob);
  return installParsedPackageZip(parsed, { onProgress });
}

export async function installParsedPackageZip(parsed, { onProgress = null } = {}) {
  if (!parsed?.descriptor || !(parsed.files instanceof Map)) throw new Error("invalid parsed Package ZIP");
  validatePackageDescriptor(parsed.descriptor);
  const missingBaseFiles = parsed.descriptor.base.files.filter(fileId => {
    const entry = parsed.files.get(fileId);
    return !(entry?.blob instanceof Blob);
  });
  if (missingBaseFiles.length) {
    throw new Error(`Package ZIP is missing required base files: ${missingBaseFiles.join(", ")}`);
  }
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
  expectedGenerationId = undefined,
} = {}) {
  if (typeof descriptorUrl !== "string" && !(descriptorUrl instanceof URL)) throw new Error("remote Descriptor URL required");
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable");
  const base = new URL(descriptorUrl, globalThis.location?.href || "https://package.invalid/");
  return installPackageFromAcquisition({
    descriptor,
    desiredFileIds,
    source,
    reuseCurrent: true,
    expectedGenerationId,
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

/** A confirmed uninstall shares every installer entry point's queue and WebLock.
 * The store transaction only detaches current; Runtime leases keep prior bytes.
 */
export async function removeInstalledPackage(game, { expectedGenerationId, signal = null } = {}) {
  if (typeof expectedGenerationId !== "string" || !expectedGenerationId) throw new Error("confirmed Package generation is required");
  return packageMutations.run(game, () => withPackageWebLock(game, signal, () => {
    throwIfAborted(signal);
    return detachCurrentPackageGeneration(game, { expectedGenerationId, signal });
  }));
}
