import assert from "node:assert/strict";
import { classifyThcrapAsset, createThcrapClient, crc32, downloadThcrapPack } from "../integrations/thcrap.mjs";
import { createThpracSession, normalizeThpracParams, THPRAC_SUPPORTED_GAMES } from "../integrations/thprac.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";

const encoder = new TextEncoder();
const png = encoder.encode("fake png fixture");
const jdiff = encoder.encode('{"1":{"3":"Hello"}}');
const baseStringdefs = encoder.encode('{"base":"Base",}\n');
const leafStringdefs = encoder.encode('{"base":"Override","leaf":"Leaf"}\n');
const fixtures = new Map([
  ["https://example.test/repo.js", { patches: { lang_en: "English", base_tsa: "Base", lang_zh_hans: "invalid legacy id" } }],
  ["https://example.test/lang_en/patch.js", { id: "lang_en", title: "English", dependencies: ["nmlgc/base_tsa"] }],
  ["https://example.test/base_tsa/patch.js", { id: "base_tsa", title: "Base", dependencies: [] }],
  ["https://example.test/base_tsa/files.js", { "stringdefs.js": crc32(baseStringdefs) }],
  ["https://example.test/lang_en/files.js", {
    "stringdefs.js": crc32(leafStringdefs),
    "th06/title02.png": crc32(png),
    "th06/msg1.dat": null,
    "th06/msg1.dat.jdiff": crc32(jdiff),
    "th07/data/title/title02.png": 123,
    "th08/title.png": 456
  }]
]);
const mockFetch = async value => {
  const url = new URL(value).href;
  const clean = new URL(url); clean.search = "";
  const body = fixtures.get(clean.href);
  if (body === undefined) return new Response("missing", { status: 404 });
  if (body instanceof Uint8Array) return new Response(body);
  return Response.json(body);
};
fixtures.set("https://example.test/lang_en/th06/title02.png", png);
fixtures.set("https://example.test/lang_en/th06/msg1.dat.jdiff", jdiff);
fixtures.set("https://example.test/base_tsa/stringdefs.js", baseStringdefs);
fixtures.set("https://example.test/lang_en/stringdefs.js", leafStringdefs);

const client = createThcrapClient({ repository: "https://example.test", fetchImpl: mockFetch });
assert.deepEqual(await client.discoverLanguages(), [{ id: "lang_en", title: "English" }]);
const pack = await client.resolveLanguage("lang_en", "th06");
assert.equal(pack.assets.length, 4);
const stringdefsAssets = pack.assets.filter(asset => asset.sourceRole === "stringdefs");
assert.deepEqual(stringdefsAssets.map(asset => [asset.patch, asset.sourceOrder]), [
  ["nmlgc/base_tsa", 0], ["thpatch/lang_en", 1]
]);
assert.deepEqual(pack.assets.filter(asset => !asset.sourceRole).map(asset => asset.kind), ["jdiff", "image"]);
assert.equal(classifyThcrapAsset("th06/spells.js"), "table");
const downloaded = await downloadThcrapPack(pack, { fetchImpl: mockFetch, concurrency: 2 });
assert.equal(downloaded.resources.length, 4);
assert.deepEqual(downloaded.resources.find(resource => resource.kind === "image").bytes, png);
await assert.rejects(() => client.resolveLanguage("../lang_en", "th06"), /invalid thcrap language/);
assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);

const th06 = normalizeThpracParams("th06", { rank: 80, rankLock: false, life: 99, dlg: true });
assert.equal(th06.rank, 32);
assert.equal(th06.life, 8);
assert.equal(th06.dlg, true);
const th07 = createThpracSession("th07", { cherryMax: 250000, spellBonus: 31 });
assert.equal(th07.params.cherryMax, 250000);
assert.equal(th07.params.spellBonus, 30);
const th08 = createThpracSession("th08", { stage: 8, gauge: -20000, night: 20, rank: 80 });
assert.equal(th08.params.stage, 8);
assert.equal(th08.params.gauge, -10000);
assert.equal(th08.params.night, 11);
assert.equal(th08.params.rank, 16);
assert(th08.features.includes("exact-section-warp"));
const th11 = createThpracSession("th11", { life: 99, life_fragment: 9, power: 200, phase: 9, marisa_b_formation: 9 });
assert.equal(th11.params.life, 9);
assert.equal(th11.params.life_fragment, 4);
assert.equal(th11.params.power, 96);
assert.equal(th11.params.phase, 4);
assert.equal(th11.params.marisa_b_formation, 4);
assert(th11.features.includes("exact-section-warp"));
assert(!th11.features.includes("direct-frame-warp"));
assert.equal(PRODUCT_GAMES.th11.features.thprac, true);
assert(PRODUCT_GAMES.th11.requiredShared.includes("/unifont.otf"));
const declaredThpracGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.features.thprac)
  .map(([game]) => game);
assert.deepEqual(THPRAC_SUPPORTED_GAMES, declaredThpracGames,
  "thprac integration support must exactly match Product Catalog declarations");
console.log(JSON.stringify({ thcrap: { assets: pack.assets.length, stringdefs: stringdefsAssets.length, crc32: "ok" }, thprac: { games: THPRAC_SUPPORTED_GAMES } }));
