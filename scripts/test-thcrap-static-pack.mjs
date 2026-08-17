import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { createStaticThcrapPack, retargetStaticThcrapPack } from "../server/thcrap-static-pack.mjs";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const prepareStart = appSource.indexOf("async function prepareLanguagePack()");
const prepareEnd = appSource.indexOf("\nconst isReplay", prepareStart);
assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, "language-pack preparation function is missing");
const prepareSource = appSource.slice(prepareStart, prepareEnd);
assert.match(prepareSource, /const prefix = `\/thcrap\/\$\{state\.game\}\/`;/,
  "language-pack preparation must define the selected game prefix");
assert.match(prepareSource, /name\.startsWith\(`\$\{prefix\.slice\(1\)\}`\)/,
  "language-pack preparation must validate entries against the selected game prefix");

const bytes = Buffer.from("ETL1\0\0\0\0", "ascii");
const fileHash = createHash("sha256").update(bytes).digest("hex");
const pack = createStaticThcrapPack({
  pack: { game: "th06", language: "lang_zh-hans", title: "简体中文", assets: [{ path: "th06/stages.js", crc32: 1 }] },
  resources: [{ path: "th06/stages.js", targetPath: "/thcrap/th06/localization/stages.etl", format: "eagler-localization-table/1", bytes }],
  runtimeVersion: "auto"
});
assert.equal(pack.manifest.runtimeVersion, "pending");
assert.equal(pack.catalog.pack.runtimeVersion, "pending");
assert.match(pack.catalog.pack.url, /^thcrap\/th06\/pending\/lang_zh-hans\.[a-f0-9]{24}\.zip$/);
const unpacked = unzipSync(pack.archive);
assert.deepEqual(Buffer.from(unpacked["thcrap/th06/localization/stages.etl"]), bytes);
assert.equal(JSON.parse(Buffer.from(unpacked["manifest.json"]).toString("utf8")).files[0].sha256, fileHash);

const runtimeVersion = "0123456789abcdef";
const retargeted = retargetStaticThcrapPack(pack.archive, runtimeVersion);
assert.equal(retargeted.manifest.runtimeVersion, runtimeVersion);
const finalManifest = JSON.parse(Buffer.from(unzipSync(retargeted.archive)["manifest.json"]).toString("utf8"));
assert.equal(finalManifest.runtimeVersion, runtimeVersion);
assert.deepEqual(Buffer.from(unzipSync(retargeted.archive)["thcrap/th06/localization/stages.etl"]), bytes);

assert.throws(() => createStaticThcrapPack({
  pack: { game: "th06", language: "lang_zh-hans" },
  resources: [{ targetPath: "/thcrap/th07/bad.bin", bytes }], runtimeVersion
}), /invalid thcrap target path/);

const th07Pack = createStaticThcrapPack({
  pack: { game: "th07", language: "lang_en", title: "English", assets: [{ path: "th07/msg1.dat", crc32: 2 }] },
  resources: [{ path: "th07/msg1.dat", targetPath: "/thcrap/th07/msg1.dat", format: "touhou-message/1", bytes }],
  runtimeVersion
});
assert.equal(th07Pack.manifest.game, "th07");
assert.deepEqual(Buffer.from(unzipSync(th07Pack.archive)["thcrap/th07/msg1.dat"]), bytes);
console.log(JSON.stringify({ schema: pack.manifest.schema, files: pack.manifest.files.length, games: ["th06", "th07"], retargeted: true }));
