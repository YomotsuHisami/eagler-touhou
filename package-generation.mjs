import { validatePackageDescriptor } from "./package-descriptor.mjs";

function uniqueFileIds(ids, descriptor, label) {
  if (!Array.isArray(ids)) throw new Error(`${label}: file ids must be an array`);
  const output = [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !Object.hasOwn(descriptor.files, id)) throw new Error(`${label}: unknown file ${String(id)}`);
    if (!seen.has(id)) {
      seen.add(id);
      output.push(id);
    }
  }
  return output;
}

export function componentFileIds(descriptor, componentId, entryIds = null) {
  validatePackageDescriptor(descriptor);
  const component = descriptor.components?.[componentId];
  if (!component) return [];
  if (Array.isArray(component.files)) return [...component.files];
  if (!Array.isArray(component.entries)) return [];
  if (entryIds == null) return component.entries.map(entry => entry.file);
  const selected = new Set(entryIds);
  return component.entries.filter(entry => selected.has(entry.id)).map(entry => entry.file);
}

export function planPackageGeneration({ current = null, descriptor, desiredFileIds = null, forceFileIds = [], generationId }) {
  validatePackageDescriptor(descriptor);
  if (typeof generationId !== "string" || !generationId) throw new Error("generation id is required");
  if (current != null && (current.game !== descriptor.game || !current.descriptor || !current.files || typeof current.files !== "object")) {
    throw new Error("current generation does not match the package");
  }

  const desired = uniqueFileIds(desiredFileIds ?? descriptor.base.files, descriptor, "generation plan");
  const forced = new Set(uniqueFileIds(forceFileIds, descriptor, "generation force plan"));
  const files = {};
  const needs = [];
  for (const fileId of desired) {
    const nextFile = descriptor.files[fileId];
    const previousFile = current?.descriptor?.files?.[fileId];
    const previousRef = current?.files?.[fileId];
    if (!forced.has(fileId) && previousFile?.revision === nextFile.revision && previousRef?.objectId) {
      files[fileId] = { ...previousRef, revision: nextFile.revision };
    } else {
      needs.push(fileId);
    }
  }
  return {
    generation: {
      id: generationId,
      game: descriptor.game,
      descriptor,
      files,
    },
    needs,
  };
}

export function attachGenerationFile(generation, fileId, objectId, { storageMode = null } = {}) {
  if (!generation?.descriptor?.files || generation.game !== generation.descriptor.game) throw new Error("invalid generation");
  if (!Object.hasOwn(generation.descriptor.files, fileId)) throw new Error(`unknown generation file: ${fileId}`);
  if (typeof objectId !== "string" || !objectId) throw new Error("object id is required");
  if (storageMode != null && storageMode !== "arraybuffer") throw new Error("invalid generation file storage mode");
  return {
    ...generation,
    files: {
      ...generation.files,
      [fileId]: {
        objectId,
        revision: generation.descriptor.files[fileId].revision,
        ...(storageMode ? { storageMode } : {}),
      },
    },
  };
}

export function commitInstallation(installation, generation, { source = installation?.source ?? "local" } = {}) {
  if (!generation?.id || !generation?.game || generation.descriptor?.game !== generation.game) throw new Error("invalid generation commit");
  if (!new Set(["local", "remote"]).has(source)) throw new Error("invalid installation source");
  if (installation != null && installation.game !== generation.game) throw new Error("installation/game mismatch");
  return {
    ...(installation || {}),
    game: generation.game,
    source,
    currentGeneration: generation.id,
    pendingGeneration: null,
  };
}

export function beginPendingInstallation(installation, generation) {
  if (!generation?.id || !generation?.game || generation.descriptor?.game !== generation.game) throw new Error("invalid pending generation");
  if (installation != null && installation.game !== generation.game) throw new Error("installation/game mismatch");
  return {
    ...(installation || {}),
    game: generation.game,
    source: installation?.source ?? "local",
    currentGeneration: installation?.currentGeneration ?? null,
    pendingGeneration: generation.id,
  };
}
