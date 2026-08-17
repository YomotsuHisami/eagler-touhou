import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  encodeAsciiLocalizationTable, encodeLocalizationTable, encodeStringLocalizationTable,
  mergeStringdefsResources, mergeThcrapJsonObjects,
  parseThcrapJson, patchEnding, patchThmsgDump, ThcrapRuntimeCompiler
} from "../server/thcrap-compiler.mjs";
import { legacyAsciiPrintfSignature, validateAsciiContract } from "../server/thcrap-ascii-contract.mjs";
import { validateStringContract } from "../server/thcrap-string-contract.mjs";

assert.deepEqual(legacyAsciiPrintfSignature("%s %9d0 %% %3.2f %c"), ["string", "int", "double", "char"]);
assert.throws(() => legacyAsciiPrintfSignature("%*d"), /unsupported printf '\*' width/);
assert.throws(() => legacyAsciiPrintfSignature("%lld"), /length modifier/);

const th07AsciiContract = validateAsciiContract("th07");
const th07Stringlocs = JSON.parse(await readFile("../dependencies/upstream-thcrap-tsa/base_tsa/th07/stringlocs.v1.00b.js", "utf8"));
const th07StringIds = new Set(Object.values(th07Stringlocs));
for (const record of th07AsciiContract.records) {
  assert.ok(th07StringIds.has(record.id), `TH07 ASCII contract ID is not in stringlocs: ${record.id}`);
}
const th07StringContract = validateStringContract("th07");
for (const record of th07StringContract.records) {
  assert.ok(th07StringIds.has(record.id), `TH07 strings contract ID is not in stringlocs: ${record.id}`);
}
assert.equal(th07StringContract.records.length, 98);
assert.equal(th07StringContract.records.filter(record => /^(?:th06|th07)_(?:log|error)_/.test(record.id)).length, 35);
assert.doesNotThrow(() => encodeStringLocalizationTable({
  "th06_log_unable_to_read_file": "Cannot read file %s.\r\n"
}, { game: "th07" }));
assert.throws(() => encodeStringLocalizationTable({
  "th06_log_unable_to_read_file": "Cannot read file.\r\n"
}, { game: "th07" }), /changes printf signature/);

function decodeStringTable(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "EST1");
  const count = bytes.readUInt32LE(4);
  const records = [];
  let offset = 8;
  for (let index = 0; index < count; index++) {
    const idLength = bytes.readUInt16LE(offset);
    const translationLength = bytes.readUInt16LE(offset + 2);
    const flags = bytes.readUInt16LE(offset + 4);
    const reserved = bytes.readUInt16LE(offset + 6);
    assert.equal(reserved, 0);
    offset += 8;
    const id = bytes.subarray(offset, offset + idLength).toString("utf8");
    offset += idLength;
    const translation = bytes.subarray(offset, offset + translationLength).toString("utf8");
    offset += translationLength;
    records.push({ id, translation, flags });
  }
  assert.equal(offset, bytes.length, "EST1 decoder must consume the complete table");
  return records;
}

const stringBytes = encodeStringLocalizationTable({
  "th06 Bomb Reimu A": "Spirit Sign \"Fantasy Seal\"",
  "th06 Stats ReimuA": "Reimu Hakurei (Spirit)",
  "th06 BGM In-game format": "BGM: %s",
  "th06_log_sprite_read_error": "Cannot read sprite animation %s. Data is missing or corrupt.",
  "th06_log_reinit_corrupt_config": "The configuration file was corrupted, so it was reinitialized.\n"
}, { game: "th06" });
const stringRecords = decodeStringTable(stringBytes);
assert.equal(stringRecords.length, 44);
assert.deepEqual(stringRecords.find(record => record.id === "th06 Bomb Reimu A"), {
  id: "th06 Bomb Reimu A", translation: "Spirit Sign \"Fantasy Seal\"", flags: 1
});
assert.deepEqual(stringRecords.find(record => record.id === "th06 Bomb Reimu B"), {
  id: "th06 Bomb Reimu B", translation: "", flags: 0
});
assert.deepEqual(stringRecords.find(record => record.id === "th06_log_sprite_read_error"), {
  id: "th06_log_sprite_read_error",
  translation: "Cannot read sprite animation %s. Data is missing or corrupt.",
  flags: 1
});
assert.throws(() => encodeStringLocalizationTable({ "th06 BGM In-game format": "%d" }, { game: "th06" }),
  /changes printf signature/);
assert.doesNotThrow(() => encodeStringLocalizationTable({
  "th06_log_sprite_read_error": "Cannot read sprite animation %s. Data is missing or corrupt."
}, { game: "th06" }));
assert.throws(() => encodeStringLocalizationTable({
  "th06_log_sprite_read_error": "Cannot read sprite animation. Data is missing or corrupt."
}, { game: "th06" }), /changes printf signature/);
assert.equal(th07AsciiContract.aliases.get("Stage1"), "th06_ascii_replay_stage_1");
assert.equal(th07AsciiContract.aliases.get("Stage1  "), "th06_ascii_replay_stage_1");
assert.equal(th07AsciiContract.aliases.get("BONUS %8d"), undefined,
  "TH07 must not invent th06_ascii_bonus_format for BONUS %8d");

const th06AsciiContract = validateAsciiContract("th06");
const th06Stringlocs = JSON.parse(await readFile("../dependencies/upstream-thcrap-tsa/base_tsa/th06/stringlocs.v1.02h.js", "utf8"));
const th06StringIds = new Set(Object.values(th06Stringlocs));
for (const record of th06AsciiContract.records) {
  if (!record.lookupOnly) {
    assert.ok(th06StringIds.has(record.id), `TH06 ASCII contract ID is not in final stringlocs JSON: ${record.id}`);
  }
}
assert.equal(th06Stringlocs.Rx6c4c8, "th06_practice_format",
  "TH06 v1.02h duplicate Rx6c4c8 must preserve the final JSON value");
assert.equal(th06AsciiContract.aliases.get("STAGE %d  %.9d"), "th06_practice_format");
assert.equal(th06AsciiContract.aliases.get("Full Power Mode!!"), "th06_ascii_fullpower");
assert.equal(th06AsciiContract.aliases.get("Full Power Mode!"), undefined);

const th06StringContract = validateStringContract("th06");
for (const record of th06StringContract.records) {
  assert.ok(th06StringIds.has(record.id), `TH06 strings contract ID is not in final stringlocs JSON: ${record.id}`);
}
assert.equal(th06StringContract.records.length, 44);
assert.equal(th06StringContract.records.filter(record => /^(?:th06)_(?:log|error)_/.test(record.id)).length, 35);

const relaxed = parseThcrapJson({
  path: "stringdefs.js",
  bytes: Buffer.from(`{
    // line comment
    "literal // stays": "value /* stays */",
    "trailing": "comma",
    /* block
       comment */
  }`, "utf8")
});
assert.deepEqual(relaxed, { "literal // stays": "value /* stays */", trailing: "comma" });
assert.throws(() => parseThcrapJson({ path: "broken.js", bytes: Buffer.from('{"x":1 /*') }), /unterminated block comment/);
assert.deepEqual(
  mergeThcrapJsonObjects({ same: "base", nested: { keep: 1, replace: 1 }, array: [1] },
                         { same: "leaf", nested: { replace: 2, add: 3 }, array: [2], nullValue: null }),
  { same: "leaf", nested: { keep: 1, replace: 2, add: 3 }, array: [2], nullValue: null }
);
assert.deepEqual(mergeStringdefsResources([
  { path: "stringdefs.js", sourceRole: "stringdefs", sourceOrder: 2, bytes: Buffer.from('{"x":"leaf","z":"z"}') },
  { path: "stringdefs.js", sourceRole: "stringdefs", sourceOrder: 0, bytes: Buffer.from('{"x":"base","y":"y",}') }
]), { x: "leaf", y: "y", z: "z" });

function decodeAsciiTable(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "EAS1");
  const count = bytes.readUInt32LE(4);
  const records = [];
  let offset = 8;
  for (let index = 0; index < count; index++) {
    const aliasLength = bytes.readUInt16LE(offset);
    const idLength = bytes.readUInt16LE(offset + 2);
    const translationLength = bytes.readUInt16LE(offset + 4);
    const baselineLength = bytes.readUInt16LE(offset + 6);
    const extraHalf = bytes.readInt16LE(offset + 8);
    const flags = bytes.readUInt16LE(offset + 10);
    offset += 12;
    const take = length => {
      const value = bytes.subarray(offset, offset + length).toString("utf8");
      offset += length;
      return value;
    };
    records.push({
      alias: take(aliasLength), id: take(idLength), translation: take(translationLength),
      baseline: take(baselineLength), extraHalf, flags
    });
  }
  assert.equal(offset, bytes.length, "EAS1 decoder must consume the complete table");
  return records;
}

const asciiBytes = encodeAsciiLocalizationTable({
  "th07 Full Power": "Localized Full Power",
  "th06_ascii_replay_stage_1": "Localized Stage One"
}, { game: "th07" });
const asciiRecords = decodeAsciiTable(asciiBytes);
const fullPower = asciiRecords.find(record => record.alias === "Full Power Mode!");
assert.deepEqual(fullPower, {
  alias: "Full Power Mode!", id: "th07 Full Power", translation: "Localized Full Power",
  baseline: "Full Power Mode!", extraHalf: 17, flags: 3
});
const stage1Aliases = asciiRecords.filter(record => record.id === "th06_ascii_replay_stage_1");
assert.deepEqual(stage1Aliases.map(record => record.alias).sort(), ["Stage1", "Stage1  "]);
assert.ok(stage1Aliases.every(record => record.translation === "Localized Stage One" && record.flags === 1));
const supernatural = asciiRecords.find(record => record.alias === "Supernatural Border!!");
assert.equal(supernatural.translation, "");
assert.equal(supernatural.flags, 2, "missing translation must differ from an explicitly empty translation");
assert.equal(supernatural.extraHalf, -23);
assert.equal(asciiRecords.some(record => record.alias === "BONUS %8d"), false);
assert.throws(() => encodeAsciiLocalizationTable({ "th07 Replay": "%d %8s %6s %7s %8s" }, { game: "th07" }),
  /changes printf signature/);
assert.throws(() => encodeAsciiLocalizationTable({ "th06_ascii_centered_stage_format": "STAGE %s" }, { game: "th06" }),
  /changes printf signature/);

const th06AsciiBytes = encodeAsciiLocalizationTable({
  "th06_ascii_result_clear": "(CLEAR)",
  "th06_ascii_centered_stage_format": "STAGE %d translated"
}, { game: "th06" });
const th06AsciiRecords = decodeAsciiTable(th06AsciiBytes);
const resultClearLookup = th06AsciiRecords.find(record => record.id === "th06_ascii_result_clear");
assert.equal(resultClearLookup.alias, "");
assert.equal(resultClearLookup.translation, "(CLEAR)");
assert.equal(resultClearLookup.flags, 1);
const stageLookup = th06AsciiRecords.find(record => record.id === "th06_ascii_centered_stage_format");
assert.equal(stageLookup.alias, "");
assert.equal(stageLookup.translation, "STAGE %d translated");
assert.equal(th06AsciiRecords.find(record => record.alias === "STAGE %d  %.9d").id, "th06_practice_format");

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

const stringdefsBase = {
  game: "th07", path: "stringdefs.js", mountPath: "/thcrap/th07/_source/stringdefs/000.js",
  kind: "table", sourceRole: "stringdefs", sourceOrder: 0, patch: "nmlgc/base_tsa",
  bytes: Buffer.from('{"th07 Full Power":"Base Full","th07 MAX":"BASE",}')
};
const stringdefsLeaf = {
  game: "th07", path: "stringdefs.js", mountPath: "/thcrap/th07/_source/stringdefs/004.js",
  kind: "table", sourceRole: "stringdefs", sourceOrder: 4, patch: "thpatch/lang_fixture",
  bytes: Buffer.from('{"th07 Full Power":"Leaf Full"}')
};
await assert.rejects(() => optionsCompiler.process(stringdefsBase), /pack-level merge source/);
const packed = await optionsCompiler.processPack([
  stringdefsLeaf,
  { game: "th07", path: "data.bin", mountPath: "/thcrap/th07/data.bin", kind: "binary", bytes: Buffer.from([1, 2, 3]) },
  stringdefsBase
]);
assert.equal(packed.length, 3);
const asciiResource = packed.find(resource => resource.format === "eagler-localization-ascii/1");
assert.equal(asciiResource.targetPath, "/thcrap/th07/localization/ascii.etl");
assert.deepEqual(asciiResource.sourcePaths, ["nmlgc/base_tsa:stringdefs.js", "thpatch/lang_fixture:stringdefs.js"]);
const packedRecords = decodeAsciiTable(asciiResource.bytes);
assert.equal(packedRecords.find(record => record.alias === "Full Power Mode!").translation, "Leaf Full");
assert.equal(packedRecords.find(record => record.alias === "MAX").translation, "BASE");
const stringResource = packed.find(resource => resource.format === "eagler-localization-strings/1");
assert.equal(stringResource.targetPath, "/thcrap/th07/localization/strings.etl");
assert.deepEqual(stringResource.sourcePaths, ["nmlgc/base_tsa:stringdefs.js", "thpatch/lang_fixture:stringdefs.js"]);
const th07StringRecords = decodeStringTable(stringResource.bytes);
assert.equal(th07StringRecords.length, 98);
assert.deepEqual(th07StringRecords.find(record => record.id === "th07 Menu Start"),
                 { id: "th07 Menu Start", translation: "", flags: 0 });
assert.deepEqual(th07StringRecords.find(record => record.id === "th07 Bomb Sakuya B focused"),
                 { id: "th07 Bomb Sakuya B focused", translation: "", flags: 0 });
assert.deepEqual(th07StringRecords.find(record => record.id === "th07 Stats Retries"),
                 { id: "th07 Stats Retries", translation: "", flags: 0 });
assert.deepEqual(th07StringRecords.find(record => record.id === "th06_error_two_instances"),
                 { id: "th06_error_two_instances", translation: "", flags: 0 });
const packedBinary = packed.find(resource => resource.format === "binary");
assert.deepEqual(packedBinary.bytes, Buffer.from([1, 2, 3]));
assert.equal(packedBinary.path, "data.bin");
assert.equal(packedBinary.game, "th07");
assert.equal(packedBinary.mountPath, "/thcrap/th07/data.bin");

console.log(JSON.stringify({ dialogue: "patched", extraLines: "inserted", ending: "patched", localization: "encoded", ascii: "EAS1", strings: "EST1" }));
