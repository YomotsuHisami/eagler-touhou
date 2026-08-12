import assert from "node:assert/strict";
import { classifyThcrapAsset, createThcrapClient, crc32, downloadThcrapPack } from "../integrations/thcrap.mjs";
import {
  createThpracReplayMetadata, createThpracSession, normalizeThpracParams,
  parseThpracReplayMetadata, thpracReplaySidecarPath
} from "../integrations/thprac.mjs";

const encoder = new TextEncoder();
const png = encoder.encode("fake png fixture");
const jdiff = encoder.encode('{"1":{"3":"Hello"}}');
const fixtures = new Map([
  ["https://example.test/repo.js", { patches: { lang_en: "English", base_tsa: "Base", lang_zh_hans: "invalid legacy id" } }],
  ["https://example.test/lang_en/patch.js", { id: "lang_en", title: "English", dependencies: ["nmlgc/base_tsa"] }],
  ["https://example.test/base_tsa/patch.js", { id: "base_tsa", title: "Base", dependencies: [] }],
  ["https://example.test/base_tsa/files.js", {}],
  ["https://example.test/lang_en/files.js", {
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

const client = createThcrapClient({ repository: "https://example.test", fetchImpl: mockFetch });
assert.deepEqual(await client.discoverLanguages(), [{ id: "lang_en", title: "English" }]);
const pack = await client.resolveLanguage("lang_en", "th06");
assert.equal(pack.assets.length, 2);
assert.deepEqual(pack.assets.map(asset => asset.kind), ["jdiff", "image"]);
assert.equal(classifyThcrapAsset("th06/spells.js"), "table");
const downloaded = await downloadThcrapPack(pack, { fetchImpl: mockFetch, concurrency: 2 });
assert.equal(downloaded.resources.length, 2);
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
const metadata = createThpracReplayMetadata("th07", th07.params);
assert.deepEqual(parseThpracReplayMetadata(JSON.stringify(metadata), "th07").params, metadata.params);
assert.equal(thpracReplaySidecarPath("replay/th7_ud0001.rpy"), "replay/th7_ud0001.rpy.thprac.json");
assert.throws(() => thpracReplaySidecarPath("../th7_01.rpy"), /invalid replay path/);

console.log(JSON.stringify({ thcrap: { assets: pack.assets.length, crc32: "ok" }, thprac: { games: ["th06", "th07"], replaySidecar: "ok" } }));
