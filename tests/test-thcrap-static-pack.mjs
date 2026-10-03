import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { createStaticThcrapPack, staticLanguagePackPath } from "../server/thcrap-static-pack.mjs";

const bytes = Buffer.from("ETL1\0\0\0\0", "ascii");
const pack = createStaticThcrapPack({
  pack: { game: "th06", language: "lang_zh-hans", title: "简体中文", assets: [{ path: "th06/stages.js", crc32: 1 }] },
  resources: [{ path: "th06/stages.js", targetPath: "/thcrap/th06/localization/stages.etl", format: "eagler-localization-table/1", bytes }],
});
assert.equal(pack.manifest.runtimeVersion, "independent");
assert.equal(pack.catalog.pack.runtimeVersion, "independent");
assert.equal(pack.fileName, "lang_zh-hans.zip");
assert.equal(pack.catalog.pack.url, "language/lang_zh-hans.zip");
assert.equal(staticLanguagePackPath("lang_en"), "language/lang_en.zip");
const unpacked = unzipSync(pack.archive);
assert.deepEqual(Buffer.from(unpacked["thcrap/th06/localization/stages.etl"]), bytes);

assert.throws(() => createStaticThcrapPack({
  pack: { game: "th06", language: "lang_zh-hans" },
  resources: [{ targetPath: "/thcrap/th07/bad.bin", bytes }]
}), /invalid thcrap target path/);

const th07Pack = createStaticThcrapPack({
  pack: { game: "th07", language: "lang_en", title: "English", assets: [{ path: "th07/msg1.dat", crc32: 2 }] },
  resources: [{ path: "th07/msg1.dat", targetPath: "/thcrap/th07/msg1.dat", format: "touhou-message/1", bytes }],
});
assert.equal(th07Pack.manifest.game, "th07");
assert.deepEqual(Buffer.from(unzipSync(th07Pack.archive)["thcrap/th07/msg1.dat"]), bytes);

const th08Pack = createStaticThcrapPack({
  pack: { game: "th08", language: "lang_zh-hans", title: "简体中文", assets: [{ path: "th08/msg1a.dat", crc32: 3 }] },
  resources: [{ path: "th08/msg1a.dat", targetPath: "/thcrap/th08/msg1a.dat", format: "touhou-message/1", bytes }],
});
assert.equal(th08Pack.manifest.game, "th08");
assert.deepEqual(Buffer.from(unzipSync(th08Pack.archive)["thcrap/th08/msg1a.dat"]), bytes);
const th09Pack = createStaticThcrapPack({
  pack: { game: "th09", language: "lang_zh-hans", title: "简体中文", assets: [{ path: "th09/pl00.msg.jdiff", crc32: 4 }] },
  resources: [{ path: "th09/pl00.msg.jdiff", targetPath: "/thcrap/th09/pl00.msg", format: "touhou-message/1", bytes }],
});
assert.equal(th09Pack.manifest.game, "th09");
assert.deepEqual(Buffer.from(unzipSync(th09Pack.archive)["thcrap/th09/pl00.msg"]), bytes);
const th11Pack = createStaticThcrapPack({
  pack: { game: "th11", language: "lang_zh-hans", title: "简体中文", assets: [{ path: "th11/st01_00a.msg.jdiff", crc32: 5 }] },
  resources: [{ path: "th11/st01_00a.msg.jdiff", targetPath: "/thcrap/th11/st01_00a.msg", format: "touhou-message/1", bytes }],
});
assert.deepEqual(Buffer.from(unzipSync(th11Pack.archive)["thcrap/th11/st01_00a.msg"]), bytes);
console.log(JSON.stringify({ schema: pack.manifest.schema, files: pack.manifest.files.length, games: ["th06", "th07", "th08", "th09", "th11"], runtimeIndependent: true }));
