import { validatePackageDescriptor } from "./package-descriptor.mjs";
import { componentFileIds } from "./package-generation.mjs";
import { installPackageFromRemote } from "./package-installer.mjs";
import { readCurrentPackageGeneration } from "./package-store.mjs";
import { releaseCatalogEntryUrl, validateReleaseCatalog } from "./release-catalog.mjs";

function unique(ids) {
  return [...new Set(ids)];
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
} = {}) {
  validatePackageDescriptor(descriptor);
  const ids = [...descriptor.base.files];
  for (const fileId of addFileIds) {
    if (typeof fileId !== "string" || !Object.hasOwn(descriptor.files, fileId)) {
      throw new Error(`unknown requested Package file: ${String(fileId)}`);
    }
    ids.push(fileId);
  }
  const explicitlyAdded = new Set(addComponents);
  for (const [componentId, nextComponent] of Object.entries(descriptor.components)) {
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
  preserveLocalSource = true,
  fetchImpl = globalThis.fetch,
  onProgress = null,
  signal = null,
} = {}) {
  const published = await fetchPublishedPackage(game, { catalog, catalogUrl, fetchImpl, signal });
  if (!published) throw new Error(`${game}: no published Package`);
  const currentResult = await readCurrentPackageGeneration(game);
  const current = currentResult.generation;
  const source = preserveLocalSource && currentResult.installation?.source === "local" ? "local" : "remote";
  const desiredFileIds = desiredFilesForPublishedPackage(published.descriptor, { current, addComponents, addFileIds });
  const installed = await installPackageFromRemote(published.descriptor, {
    descriptorUrl: published.descriptorUrl,
    desiredFileIds,
    source,
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
