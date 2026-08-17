import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "../integrations/thcrap.mjs";
import { ThcrapService } from "../server/thcrap-service.mjs";

const encoder = new TextEncoder();
const png = encoder.encode("server png fixture");
const jdiff = encoder.encode('{"0":{"60_0":{"lines":["Hello"]}}}');
let upstreamRequests = 0;
const fixtures = new Map([
  ["https://example.test/repo.js", { patches: { lang_en: "English" } }],
  ["https://example.test/lang_en/patch.js", { id: "lang_en", title: "English", dependencies: [] }],
  ["https://example.test/lang_en/files.js", { "th06/title02.png": crc32(png), "th06/msg1.dat.jdiff": crc32(jdiff) }],
  ["https://example.test/lang_en/th06/title02.png", png],
  ["https://example.test/lang_en/th06/msg1.dat.jdiff", jdiff]
]);
const fetchImpl = async value => {
  upstreamRequests++;
  const url = new URL(value); url.search = "";
  const body = fixtures.get(url.href);
  if (body === undefined) return new Response("missing", { status: 404 });
  return body instanceof Uint8Array ? new Response(body) : Response.json(body);
};

const cacheRoot = await mkdtemp(join(tmpdir(), "eagler-thcrap-test-"));
try {
  const service = new ThcrapService({ repository: "https://example.test", fetchImpl, cacheRoot, maxAgeMs: 60000 });
  assert.deepEqual(await service.listLanguages(), [{ id: "lang_en", title: "English" }]);
  const manifest = await service.getManifest("th06", "lang_en");
  assert.equal(manifest.schema, "eagler-touhou/thcrap-runtime-pack/1");
  assert.equal(manifest.assets.length, 2);
  assert.deepEqual(manifest.assets.map(asset => asset.format).sort(), ["image", "thcrap-jdiff/1"]);
  const requestsAfterBuild = upstreamRequests;
  assert.deepEqual(await service.getManifest("th06", "lang_en"), manifest);
  assert.equal(upstreamRequests, requestsAfterBuild, "fresh manifest should be served without upstream requests");
  const jsonAsset = manifest.assets.find(asset => asset.format === "thcrap-jdiff/1");
  const file = jsonAsset.url.split("/").at(-1);
  const stored = await service.getAsset("th06", "lang_en", file);
  assert.deepEqual(JSON.parse(await readFile(stored.path, "utf8")), { "0": { "60_0": { lines: ["Hello"] } } });

  let packCalls = 0;
  const packCache = join(cacheRoot, "pack-processor");
  const packService = new ThcrapService({
    repository: "https://example.test", fetchImpl, cacheRoot: packCache, maxAgeMs: 60000,
    packProcessor: async resources => {
      packCalls++;
      assert.equal(resources.length, 2);
      return [
        ...resources.map(resource => ({
          ...resource,
          bytes: resource.bytes,
          extension: resource.kind === "image" ? ".png" : ".json",
          format: resource.kind === "image" ? "image" : "fixture-compiled/1",
          targetPath: resource.mountPath
        })),
        {
          game: "th06", path: "stringdefs.js", mountPath: "/thcrap/th06/localization/ascii.etl",
          targetPath: "/thcrap/th06/localization/ascii.etl", bytes: encoder.encode("EAS1-fixture"),
          extension: ".etl", format: "eagler-localization-ascii/1"
        }
      ];
    }
  });
  const packManifest = await packService.getManifest("th06", "lang_en");
  assert.equal(packCalls, 1, "pack processor must run once for the complete downloaded pack");
  assert.equal(packManifest.assets.length, 3);
  assert.ok(packManifest.assets.some(asset => asset.sourcePath === "stringdefs.js" &&
    asset.targetPath === "/thcrap/th06/localization/ascii.etl" && asset.format === "eagler-localization-ascii/1"));
  assert.equal(packManifest.runtimeReady, true);
  await assert.rejects(() => service.getManifest("th08", "lang_en"), /invalid game id/);
  await assert.rejects(() => service.getAsset("th06", "lang_en", "../secret"), /invalid asset id/);
  console.log(JSON.stringify({ manifestAssets: manifest.assets.length, packManifestAssets: packManifest.assets.length,
    packProcessor: "once", cache: "hit", unsafePaths: "rejected" }));
} finally {
  await rm(cacheRoot, { recursive: true, force: true });
}
