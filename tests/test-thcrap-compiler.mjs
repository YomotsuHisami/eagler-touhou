import assert from "node:assert/strict";
import {
  encodeAsciiLocalizationTable, encodeLocalizationTable, encodeSpellCommentsTable,
  encodeStringLocalizationTable,
  mergeStringdefsResources, mergeThcrapJsonObjects,
  parseThcrapJson, patchEnding, patchThmsgDump, ThcrapRuntimeCompiler
} from "../server/thcrap-compiler.mjs";
import { legacyAsciiPrintfSignature, validateAsciiContract } from "../server/thcrap-ascii-contract.mjs";
import { validateStringContract } from "../server/thcrap-string-contract.mjs";

assert.deepEqual(legacyAsciiPrintfSignature("%s %9d0 %% %3.2f %c"), ["string", "int", "double", "char"]);
assert.throws(() => legacyAsciiPrintfSignature("%*d"), /unsupported printf '\*' width/);
assert.throws(() => legacyAsciiPrintfSignature("%lld"), /length modifier/);

const th07AsciiContract = validateAsciiContract("th07");
const th07StringContract = validateStringContract("th07");
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

function decodeEtlTable(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "ETL1");
  const count = bytes.readUInt32LE(4);
  const records = [];
  let offset = 8;
  for (let index = 0; index < count; index++) {
    const key = bytes.readUInt32LE(offset);
    const line = bytes.readUInt16LE(offset + 4);
    const length = bytes.readUInt16LE(offset + 6);
    offset += 8;
    const text = bytes.subarray(offset, offset + length).toString("utf8");
    offset += length;
    records.push({ key, line, text });
  }
  assert.equal(offset, bytes.length, "ETL1 decoder must consume the complete table");
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
assert.equal(th06AsciiContract.aliases.get("STAGE %d  %.9d"), "th06_practice_format");
assert.equal(th06AsciiContract.aliases.get("Full Power Mode!!"), "th06_ascii_fullpower");
assert.equal(th06AsciiContract.aliases.get("Full Power Mode!"), undefined);

const th06StringContract = validateStringContract("th06");
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

// TH08 msg08: regular dialogue is op-16 auto lines grouped into time_index
// boxes split by op 4/15; op 3 remains the side/line-numbered boss-intro hard
// line; op 8 has no MSG_TH08 opcode entry upstream and must pass through.
const th08Source = Buffer.from([
  "entry 0",
  "@60",
  "\t15;0;6;-1;-1;-1",
  "\t16;originalA",
  "\t4;500",
  "@61",
  "\t16;originalB1",
  "\t16;originalB2",
  "\t4;500",
  "@63",
  "\t16;originalC",
  "\t4;500",
  "\t15;2;-2;-2;-1;-1",
  "\t3;2;0;boss0",
  "@64",
  "\t3;2;1;boss1",
  "\t8;2;0;intro stays original",
  "\t4;60",
  ""
].join("\n"), "utf8");
const th08Diff = {
  "0": {
    "60_0": { lines: ["甲"] },
    "61_0": { lines: ["乙一", "乙二", "乙三"] },
    "63_0": { lines: ["丙"] },
    "63_1": { lines: ["头目零", "头目一", "头目二"] }
  }
};
const th08Patched = patchThmsgDump(th08Source, th08Diff, 8).toString("utf8");
assert.match(th08Patched, /\t16;甲\n\t4;500/);
assert.match(th08Patched, /\t16;乙一\n\t16;乙二\n\t16;乙三\n\t4;500/);
assert.match(th08Patched, /\t16;丙\n\t4;500/);
assert.match(th08Patched, /\t3;2;0;头目零\n@64\n\t3;2;1;头目一\n\t3;2;2;头目二/);
assert.match(th08Patched, /\t8;2;0;intro stays original/);
assert.doesNotMatch(th08Patched, /originalA|originalB1|boss0/);
const th08Unpatched = patchThmsgDump(th08Source, { "0": {} }, 8).toString("utf8");
assert.match(th08Unpatched, /\t16;originalA/);
assert.throws(() => patchThmsgDump(th08Source, th08Diff, 12), /unsupported message version/);
const th11Source = Buffer.from("entry 0 (100)\n@60\n\t17;original\n\t25;0\n\t11;0\n", "utf8");
const th11Patched = patchThmsgDump(th11Source, { "0": { "60_0": { lines: ["地灵殿"] } } }, 11).toString("utf8");
assert.match(th11Patched, /\t17;地灵殿\n\t11;0/);
assert.doesNotMatch(th11Patched, /\t25;/);
const th11Ending = patchThmsgDump(Buffer.from("entry 0 (100)\n@0\n\t3;original\n\t5;0\n"),
  { "0": { "0_0": { lines: ["结局"] } } }, 11, { ending: true }).toString("utf8");
assert.match(th11Ending, /\t3;结局\n\t5;0/);

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

// TH08 contract shape and table encoding.
const th08StringContract = validateStringContract("th08");
assert.equal(th08StringContract.records.length, 154);
assert.equal(th08StringContract.records.filter(record => /^(?:th06|th07|th08)_(?:log|error)_/.test(record.id)).length, 34);
const th08AsciiContract = validateAsciiContract("th08");
assert.equal(th08AsciiContract.records.length, 42);
assert.equal(th08AsciiContract.aliases.get("Clear = %8d0"), "th07 Clear Bonus Format");
assert.equal(th08AsciiContract.aliases.get("Clear  = %8d"), undefined,
  "TH08 must not reuse TH07's two-space stage-clear format literal");
assert.equal(th08AsciiContract.aliases.get("Last Spell Failed"), "th08 Last Spell Failed");
assert.equal(th08AsciiContract.aliases.get("BONUS %8d"), undefined,
  "TH08 must not invent th06_ascii_bonus_format for BONUS %8d");

const th08StringBytes = encodeStringLocalizationTable({
  "th08 Stats Clear Count": "通关次数    %6d %6d %6d %6d %6d %6d",
  "th08 Spell Condition Line 1 210": "解锁条件：收取No.%.3d号符卡。",
  "th08 Bomb Reimu": "灵符「梦想妙珠」"
}, { game: "th08" });
const th08StringRecords = decodeStringTable(th08StringBytes);
assert.equal(th08StringRecords.length, 154);
assert.deepEqual(th08StringRecords.find(record => record.id === "th08 Bomb Reimu"),
  { id: "th08 Bomb Reimu", translation: "灵符「梦想妙珠」", flags: 1 });
assert.throws(() => encodeStringLocalizationTable({
  "th08 Stats Clear Count": "Clear Count %6d"
}, { game: "th08" }), /changes printf signature/);
assert.throws(() => encodeStringLocalizationTable({
  "th08 Spell Condition Line 1 210": "Selectable when acquired."
}, { game: "th08" }), /changes printf signature/);

const th08AsciiBytes = encodeAsciiLocalizationTable({
  "th07 Full Power": "全 power",
  "th08 Last Spell Failed": "Last Spell 失败"
}, { game: "th08" });
const th08AsciiRecords = decodeAsciiTable(th08AsciiBytes);
const th08FullPower = th08AsciiRecords.find(record => record.alias === "Full Power Mode!");
assert.deepEqual(th08FullPower, {
  alias: "Full Power Mode!", id: "th07 Full Power", translation: "全 power",
  baseline: "Full Power Mode!", extraHalf: 31, flags: 3
});
const th08LastSpell = th08AsciiRecords.find(record => record.alias === "Last Spell Failed");
assert.equal(th08LastSpell.extraHalf, 37);
assert.equal(th08LastSpell.flags, 3);
assert.equal(th08AsciiRecords.some(record => record.alias === "Supernatural Border!!"), false,
  "TH08 has no Supernatural Border stringloc");
assert.throws(() => encodeAsciiLocalizationTable({ "th08 Spell Replay": "%d" }, { game: "th08" }),
  /changes printf signature/);

// TH08 msg/end resource routing: msg1a.dat.jdiff and end00a.end.jdiff must
// compile through the thtk runner/patcher with version 8, not fall through
// to canonical JSON.
const th08Dump = Buffer.from("entry 0\n@60\n\t16;original\n\t4;500\n", "utf8");
const th08Compiler = new ThcrapRuntimeCompiler({
  archives: { th08: ["fixture-th08.dat"] },
  runner: {
    async extractArchiveEntry(archive, entry, version) {
      assert.equal(version, 8);
      return Buffer.from(`base:${entry}`);
    },
    async dumpMessage(message, version) {
      assert.equal(version, 8);
      return th08Dump;
    },
    async compileMessage(source, version) {
      assert.equal(version, 8);
      return source;
    }
  }
});
const th08Message = await th08Compiler.process({
  game: "th08", path: "th08/msg1a.dat.jdiff", mountPath: "/thcrap/th08/msg1a.dat.jdiff", kind: "jdiff",
  bytes: Buffer.from('{"0":{"60_0":{"lines":["译"]}}}')
});
assert.equal(th08Message.format, "touhou-message/1");
assert.equal(th08Message.extension, ".dat");
assert.equal(th08Message.targetPath, "/thcrap/th08/msg1a.dat");
assert.equal(th08Message.bytes.toString("utf8"), "entry 0\n@60\n\t16;译\n\t4;500\n");
const th08Ending = await th08Compiler.process({
  game: "th08", path: "th08/end00a.end.jdiff", mountPath: "/thcrap/th08/end00a.end.jdiff", kind: "jdiff",
  bytes: Buffer.from('{"1":{"lines":["结局"]}}')
});
assert.equal(th08Ending.format, "touhou-ending/1");
assert.equal(th08Ending.extension, ".end");
assert.equal(th08Ending.targetPath, "/thcrap/th08/end00a.end");

// TH09 is MSG_TH09 (auto-line opcode 16, closes on 4/15) in both its story
// and match scripts. Its endings remain the pre-TH10 .end format.
const th09Compiler = new ThcrapRuntimeCompiler({
  archives: { th09: ["fixture-th09.dat"] },
  runner: {
    async extractArchiveEntry(archive, entry, version) {
      assert.equal(archive, "fixture-th09.dat");
      assert.equal(version, 9);
      return Buffer.from(`base:${entry}`);
    },
    async dumpMessage(message, version) {
      assert.equal(version, 9);
      return Buffer.from("entry 50 (80)\n@140\n\t16;original\n\t4;500\n", "utf8");
    },
    async compileMessage(source, version) {
      assert.equal(version, 9);
      return source;
    }
  }
});
for (const entry of ["pl00.msg", "pl00_match.msg"]) {
  const result = await th09Compiler.process({
    game: "th09", path: `th09/${entry}.jdiff`, mountPath: `/thcrap/th09/${entry}.jdiff`, kind: "jdiff",
    bytes: Buffer.from('{"50":{"140_0":{"lines":["译文一","译文二"]}}}')
  });
  assert.equal(result.format, "touhou-message/1");
  assert.equal(result.targetPath, `/thcrap/th09/${entry}`);
  assert.equal(result.bytes.toString("utf8"), "entry 50 (80)\n@140\n\t16;译文一\n\t16;译文二\n\t4;500\n");
}
const th09Ending = await th09Compiler.process({
  game: "th09", path: "th09/end00.end.jdiff", mountPath: "/thcrap/th09/end00.end.jdiff", kind: "jdiff",
  bytes: Buffer.from('{"1":{"lines":["结局"]}}')
});
assert.equal(th09Ending.format, "touhou-ending/1");
assert.equal(th09Ending.targetPath, "/thcrap/th09/end00.end");

// TH08 spellcomments.js: TSA's spell_comment_line uses comment_1[0] for the
// first displayed line and comment_1[1] for the second, so the ETL packs
// comment_N line <line> as (N-1)*0x100+line and the owner at line 0x200.
const th08SpellComments = await th08Compiler.process({
  game: "th08", path: "th08/spellcomments.js", mountPath: "/thcrap/th08/spellcomments.js", kind: "table",
  bytes: Buffer.from(JSON.stringify({
    "54": { comment_1: ["结界是意识的力量。", "弹幕本身笔直的飞行着。别被骗了。"], owner: "博丽灵梦" },
    "3": { comment_1: ["单行"] }
  }))
});
assert.equal(th08SpellComments.format, "eagler-localization-table/1");
assert.equal(th08SpellComments.extension, ".etl");
assert.equal(th08SpellComments.targetPath, "/thcrap/th08/localization/spellcomments.etl");
const th08CommentRecords = decodeEtlTable(th08SpellComments.bytes);
assert.equal(th08CommentRecords.find(record => record.key === 54 && record.line === 0).text, "结界是意识的力量。");
assert.equal(th08CommentRecords.find(record => record.key === 54 && record.line === 1).text, "弹幕本身笔直的飞行着。别被骗了。");
assert.equal(th08CommentRecords.find(record => record.key === 54 && record.line === 0x200).text, "博丽灵梦");
assert.equal(th08CommentRecords.find(record => record.key === 3 && record.line === 1), undefined);
assert.throws(() => encodeSpellCommentsTable({ "1": { comment_1: "not-an-array" } }, { game: "th08" }),
  /expected an array of lines/);

console.log(JSON.stringify({ dialogue: "patched", extraLines: "inserted", ending: "patched", localization: "encoded", ascii: "EAS1", strings: "EST1", spellcomments: "ETL1", th08: "msg08" }));
