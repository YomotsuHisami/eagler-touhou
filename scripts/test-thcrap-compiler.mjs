import assert from "node:assert/strict";
import { encodeLocalizationTable, patchEnding, patchThmsgDump, ThcrapRuntimeCompiler } from "../server/thcrap-compiler.mjs";

const source = Buffer.from([
  "entry 0",
  "@60",
  "\t3;0;0;first",
  "\t3;0;1;second",
  "\t4;300",
  "\t3;0;0;third",
  "@61",
  "\t8;1;0;title",
  "\t8;1;1;name",
  "",
  "entry 1",
  "@60",
  "\t3;0;0;untouched",
  ""
].join("\n"), "utf8");
const diff = {
  "0": {
    "60_0": { lines: ["甲", "乙", "丙"] },
    "60_1": { lines: ["只留一行"] },
    "61_h1_0": { lines: ["标题", "名字"] }
  }
};
const patched = patchThmsgDump(source, diff).toString("utf8");
assert.match(patched, /\t3;0;0;甲\n\t3;0;1;乙\n\t3;0;2;丙\n\t4;300/);
assert.match(patched, /\t3;0;0;只留一行\n@61/);
assert.doesNotMatch(patched, /third/);
assert.match(patched, /\t8;1;0;标题\n\t8;1;1;名字/);
assert.match(patched, /\t3;0;0;untouched/);

const ending = Buffer.concat([
  Buffer.from("@cmd\0\n", "ascii"),
  Buffer.from([0x82, 0xa0, 0x00, 0x0a]),
  Buffer.from([0x82, 0xa2, 0x00, 0x0a]),
  Buffer.from("@next\0\n", "ascii")
]);
const patchedEnding = patchEnding(ending, { "1": { lines: ["结局一", "结局二"] } });
assert.equal(patchedEnding.toString("utf8"), "@cmd\0\n结局一\0\n结局二\0\n@next\0\n");

const table = encodeLocalizationTable({ "2": ["@", "说明", null], "1": ["标题"], "3": null }, { game: "th06", table: "musiccmt" });
assert.equal(table.subarray(0, 4).toString("ascii"), "ETL1");
assert.equal(table.readUInt32LE(4), 3);
let tableOffset = 8;
const decoded = [];
while (tableOffset < table.length) {
  const key = table.readUInt32LE(tableOffset);
  const line = table.readUInt16LE(tableOffset + 4);
  const size = table.readUInt16LE(tableOffset + 6);
  decoded.push([key, line, table.subarray(tableOffset + 8, tableOffset + 8 + size).toString("utf8")]);
  tableOffset += 8 + size;
}
assert.deepEqual(decoded, [[1, 0, "标题"], [2, 0, "@"], [2, 1, "说明"]]);

const themes = encodeLocalizationTable({ th06_01: "赤より紅い夢", th07_01: "妖々夢" }, { game: "th06", table: "themes" });
assert.equal(themes.readUInt32LE(4), 1);
assert.equal(themes.readUInt32LE(8), 1);

const optionsCompiler = new ThcrapRuntimeCompiler({
  runner: { extractArchiveEntry() {}, dumpMessage() {}, compileMessage() {} }
});
const options = await optionsCompiler.process({
  game: "th06", path: "th06/th06.js", mountPath: "/thcrap/th06/th06.js", kind: "table",
  bytes: Buffer.from('{"font":"Aroania"}')
});
assert.equal(options.format, "eagler-localization-options/1");
assert.equal(options.targetPath, "/thcrap/th06/localization/options.json");
assert.deepEqual(JSON.parse(options.bytes), { font: "Aroania" });

console.log(JSON.stringify({ dialogue: "patched", extraLines: "inserted", ending: "patched", localization: "encoded" }));
