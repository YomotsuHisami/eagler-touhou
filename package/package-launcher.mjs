import { validatePackageDescriptor } from "./package-descriptor.mjs";
import { componentFileIds } from "./package-generation.mjs";
import { installPackageFromRemote } from "./package-installer.mjs";
import { readCurrentPackageGeneration } from "./package-store.mjs";
import { releaseCatalogEntryUrl, validateReleaseCatalog } from "../release-catalog.mjs";

function unique(ids) {
  return [...new Set(ids)];
}

export function canUseExistingInstallationAfterRemoteFailure({
  hostManifestAvailable,
  installedGeneration,
} = {}) {
  return hostManifestAvailable === true && !!installedGeneration;
}

export async function fetchPublishedPackage(game, {
  catalog,
  catalogUrl,
  fetchImpl = globalThis.fetch,
  signal = null,
} = {}) {
  validateReleaseCatalog(catalog);
  const entry = catalog.games[game];
  if (!entry) return null;
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable");
  const descriptorUrl = releaseCatalogEntryUrl(catalogUrl, catalog, game);
  const response = await fetchImpl(descriptorUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${new URL(descriptorUrl).pathname}: HTTP ${response.status}`);
  const descriptor = validatePackageDescriptor(await response.json());
  if (descriptor.game !== game) throw new Error(`${game}: published Package game mismatch`);
  if (descriptor.revision !== entry.revision) throw new Error(`${game}: Release Catalog revision does not match Package Descriptor`);
  return { entry, descriptor, descriptorUrl };
}

export function installedComponentIds(generation) {
  if (!generation?.descriptor?.components) return [];
  const installed = [];
  for (const componentId of Object.keys(generation.descriptor.components)) {
    const ids = componentFileIds(generation.descriptor, componentId);
    if (ids.some(fileId => !!generation.files?.[fileId]?.objectId)) installed.push(componentId);
  }
  return installed;
}

export function desiredFilesForPublishedPackage(descriptor, {
  current = null,
  addComponents = [],
  addFileIds = [],
  selectedComponentEntries = {},
} = {}) {
  validatePackageDescriptor(descriptor);
  if (!selectedComponentEntries || typeof selectedComponentEntries !== "object" || Array.isArray(selectedComponentEntries)) {
    throw new Error("selected Package component entries must be an object");
  }
  for (const [componentId, selected] of Object.entries(selectedComponentEntries)) {
    if (!Array.isArray(selected)) throw new Error(`Package component ${componentId} selection must be an array`);
    if (!Object.hasOwn(descriptor.components, componentId) && selected.length) {
      throw new Error(`unknown requested Package component: ${componentId}`);
    }
  }
  const ids = [...descriptor.base.files];
  for (const fileId of addFileIds) {
    if (typeof fileId !== "string" || !Object.hasOwn(descriptor.files, fileId)) {
      throw new Error(`unknown requested Package file: ${String(fileId)}`);
    }
    ids.push(fileId);
  }
  const explicitlyAdded = new Set(addComponents);
  for (const [componentId, nextComponent] of Object.entries(descriptor.components)) {
    const hasSelection = Object.hasOwn(selectedComponentEntries, componentId);
    if (hasSelection && explicitlyAdded.has(componentId)) {
      throw new Error(`Package component ${componentId} cannot request both all files and selected entries`);
    }
    if (hasSelection) {
      if (!Array.isArray(nextComponent.entries)) {
        throw new Error(`Package component ${componentId} does not support entry selection`);
      }
      const selected = selectedComponentEntries[componentId];
      const available = new Set(nextComponent.entries.map(entry => entry.id));
      for (const entryId of selected) {
        if (typeof entryId !== "string" || !available.has(entryId)) {
          throw new Error(`unknown requested Package component entry: ${componentId}/${String(entryId)}`);
        }
      }
      ids.push(...componentFileIds(descriptor, componentId, unique(selected)));
      continue;
    }
    if (explicitlyAdded.has(componentId)) {
      ids.push(...componentFileIds(descriptor, componentId));
      continue;
    }
    const previousComponent = current?.descriptor?.components?.[componentId];
    if (!previousComponent) continue;
    if (Array.isArray(nextComponent.entries) && Array.isArray(previousComponent.entries)) {
      const installedEntryIds = previousComponent.entries
        .filter(entry => !!current.files?.[entry.file]?.objectId)
        .map(entry => entry.id);
      ids.push(...componentFileIds(descriptor, componentId, installedEntryIds));
      continue;
    }
    if (nextComponent.type === "ogg" && previousComponent.type === "ogg") {
      // OGG is intentionally progressive: retain exactly the tracks already
      // installed, then let addFileIds advance the set one track at a time.
      // Treating it like an all-or-nothing component makes the first
      // background step reacquire the complete soundtrack.
      ids.push(...componentFileIds(current.descriptor, componentId)
        .filter(fileId => !!current.files?.[fileId]?.objectId && Object.hasOwn(descriptor.files, fileId)));
      continue;
    }
    if (componentFileIds(current.descriptor, componentId).some(fileId => !!current.files?.[fileId]?.objectId)) {
      ids.push(...componentFileIds(descriptor, componentId));
    }
  }
  return unique(ids);
}

export async function installPublishedPackage(game, {
  catalog,
  catalogUrl,
  addComponents = [],
  addFileIds = [],
  selectedComponentEntries = {},
  preserveLocalSource = true,
  expectedGenerationId = undefined,
  expectedCurrentRevision = undefined,
  expectedFileDeclarations = undefined,
  fetchImpl = globalThis.fetch,
  onProgress = null,
  signal = null,
} = {}) {
  const expectedFiles = expectedFileDeclarations ? structuredClone(expectedFileDeclarations) : null;
  const published = await fetchPublishedPackage(game, { catalog, catalogUrl, fetchImpl, signal });
  if (!published) throw new Error(`${game}: no published Package`);
  const installed = await installPackageFromRemote(published.descriptor, {
    descriptorUrl: published.descriptorUrl,
    // Resolve preservation policy inside the installer's per-game mutation
    // queue. Otherwise a queued import/update can advance current after these
    // decisions were calculated and then be silently dropped.
    desiredFileIds: currentResult => {
      if (expectedCurrentRevision !== undefined && currentResult.generation?.descriptor?.revision !== expectedCurrentRevision) {
        throw new Error('Package revision changed before optional resource acquisition');
      }
      if (expectedFiles && Object.entries(expectedFiles).some(([id, file]) =>
        ['revision', 'source', 'target', 'bytes', 'sha256'].some(key =>
          currentResult.generation?.descriptor?.files?.[id]?.[key] !== file[key] || published.descriptor.files[id]?.[key] !== file[key]))) {
        throw new Error('Package declarations changed before optional resource acquisition');
      }
      return desiredFilesForPublishedPackage(published.descriptor, {
        current: currentResult.generation, addComponents, addFileIds, selectedComponentEntries,
      });
    },
    expectedGenerationId,
    source: currentResult => preserveLocalSource && currentResult.installation?.source === "local" ? "local" : "remote",
    fetchImpl,
    onProgress,
    signal,
  });
  return { ...published, ...installed };
}

export async function publishedPackageStatus(game, catalog) {
  const current = await readCurrentPackageGeneration(game);
  const published = catalog?.games?.[game] || null;
  return {
    installation: current.installation,
    generation: current.generation,
    published,
    updateAvailable: !!current.generation && !!published && current.generation.descriptor?.revision !== published.revision,
  };
}
