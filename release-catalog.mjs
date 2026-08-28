export const RELEASE_CATALOG_SCHEMA = "eagler-touhou/release-catalog/1";

const GAME_ID = /^th\d{2}$/;
const REVISION = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

export function validateReleaseCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== RELEASE_CATALOG_SCHEMA ||
      !value.games || typeof value.games !== "object" || Array.isArray(value.games)) {
    throw new Error("invalid Release Catalog");
  }
  for (const [game, entry] of Object.entries(value.games)) {
    if (!GAME_ID.test(game) || !entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.revision !== "string" || !REVISION.test(entry.revision) ||
        typeof entry.descriptor !== "string" || !entry.descriptor || entry.descriptor.includes("\\")) {
      throw new Error(`invalid Release Catalog entry: ${game}`);
    }
    const url = new URL(entry.descriptor, "https://catalog.invalid/eagler-touhou/games.json");
    if (url.origin !== "https://catalog.invalid") throw new Error(`cross-origin Release Catalog descriptor: ${game}`);
  }
  return value;
}

export function releaseCatalogFromLegacyManifest(manifest) {
  const games = {};
  for (const [game, entry] of Object.entries(manifest?.games || {})) {
    if (!GAME_ID.test(game) || !entry?.package?.revision || !entry?.package?.descriptor) continue;
    games[game] = {
      revision: String(entry.package.revision),
      descriptor: String(entry.package.descriptor),
    };
  }
  return validateReleaseCatalog({ schema: RELEASE_CATALOG_SCHEMA, games });
}

export function releaseCatalogEntryUrl(catalogUrl, catalog, game) {
  validateReleaseCatalog(catalog);
  const entry = catalog.games[game];
  if (!entry) return null;
  return new URL(entry.descriptor, catalogUrl).href;
}
