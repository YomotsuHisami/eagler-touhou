import assert from "node:assert/strict";
import {
  RELEASE_CATALOG_SCHEMA,
  releaseCatalogEntryUrl,
  releaseCatalogFromLegacyManifest,
  validateReleaseCatalog,
} from "../release-catalog.mjs";

const catalog = validateReleaseCatalog({
  schema: RELEASE_CATALOG_SCHEMA,
  games: {
    th06: { revision: "abc123", descriptor: "../th06.package.json" },
    th08: { revision: "next-8", descriptor: "../packages/th08.package.json" },
  },
});
assert.equal(releaseCatalogEntryUrl("https://touhou.vip/eagler-touhou/games.json", catalog, "th08"),
  "https://touhou.vip/packages/th08.package.json");
assert.equal(releaseCatalogEntryUrl("https://touhou.vip/eagler-touhou/games.json", catalog, "th07"), null);

const legacy = releaseCatalogFromLegacyManifest({
  games: {
    th06: { package: { revision: "r6", descriptor: "../th06.package.json" }, gameData: { path: "legacy" } },
    th07: { package: { revision: "r7", descriptor: "../th07.package.json" }, music: { ogg: {} } },
  },
});
assert.deepEqual(legacy, {
  schema: RELEASE_CATALOG_SCHEMA,
  games: {
    th06: { revision: "r6", descriptor: "../th06.package.json" },
    th07: { revision: "r7", descriptor: "../th07.package.json" },
  },
});
assert.throws(() => validateReleaseCatalog({ schema: RELEASE_CATALOG_SCHEMA, games: { th07: { revision: "x", descriptor: "https://other.invalid/x" } } }),
  /cross-origin/);
console.log("Release Catalog contract: PASS");
