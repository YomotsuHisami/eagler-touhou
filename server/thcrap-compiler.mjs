import { extname } from "node:path";
import { legacyAsciiPrintfSignature, validateAsciiContract } from "./thcrap-ascii-contract.mjs";
import { validateStringContract } from "./thcrap-string-contract.mjs";

const GAME_VERSION = Object.freeze({ th06: 6, th07: 7, th08: 8, th09: 9, th10: 10, th11: 11 });
export const THCRAP_RUNTIME_COMPILER_GAMES = Object.freeze(Object.keys(GAME_VERSION));
const GAME_PATTERN = `(?:${THCRAP_RUNTIME_COMPILER_GAMES.join("|")})`;
const MESSAGE_DIFF = new RegExp(`^${GAME_PATTERN}\\/(msg[1-8][a-z]{0,2}\\.dat)\\.jdiff$`, "i");
const ENDING_DIFF = new RegExp(`^${GAME_PATTERN}\\/(end[0-9]{2}[a-z]?\\.end)\\.jdiff$`, "i");
// TH10 differs: dialogue lives in st*.msg and endings in e*.msg inside th10.dat.
const TH10_DIALOGUE_DIFF = /^th10\/(st\d+_\d+\.msg)\.jdiff$/i;
const TH10_ENDING_DIFF = /^th10\/(e\d+\.msg)\.jdiff$/i;
// TH11 uses MSG_TH11 (auto line 17) and END_TH10, as defined by thcrap_tsa.
const TH11_DIALOGUE_DIFF = /^th11\/(st\d{2}_\d{2}[a-c]\.msg)\.jdiff$/i;
const TH11_ENDING_DIFF = /^th11\/(e\d{2}\.msg)\.jdiff$/i;
// TH09 uses the same encrypted MSG_TH09 command format for both story and
// versus scripts. Ending scripts are the older .end format handled below.
const TH09_DIALOGUE_DIFF = /^th09\/(pl\d{2}(?:_match)?\.msg)\.jdiff$/i;
const LOCALIZATION_TABLE = new RegExp(`^(${GAME_PATTERN})\\/(spells|stages|musiccmt)\\.js$`, "i");
const SPELL_COMMENTS_TABLE = new RegExp(`^(${GAME_PATTERN})\\/spellcomments\\.js$`, "i");
const GAME_OPTIONS = new RegExp(`^(?:(${GAME_PATTERN})\\/)?(${GAME_PATTERN})\\.js$`, "i");

function assertJsonTree(value, depth = 0) {
  if (depth > 16) throw new TypeError("thcrap JSON nesting is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("thcrap JSON contains a non-finite number");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new TypeError("thcrap JSON array is too large");
    for (const item of value) assertJsonTree(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") throw new TypeError("thcrap JSON contains an unsupported value");
  const entries = Object.entries(value);
  if (entries.length > 20000) throw new TypeError("thcrap JSON object is too large");
  for (const [key, item] of entries) {
    if (!key || key.length > 240 || key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new TypeError("thcrap JSON contains an unsafe key");
    }
    assertJsonTree(item, depth + 1);
  }
}

function normalizeThcrapDataJson(text, label = "thcrap data") {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        withoutComments += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index++;
      } else if (character === "\n") {
        // Preserve line structure for useful JSON.parse diagnostics.
        withoutComments += "\n";
      }
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    withoutComments += character;
  }
  if (blockComment) throw new TypeError(`${label}: unterminated block comment`);

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index++) {
    const character = withoutComments[index];
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (lookahead < withoutComments.length && /\s/.test(withoutComments[lookahead])) lookahead++;
      if (withoutComments[lookahead] === "}" || withoutComments[lookahead] === "]") continue;
    }
    normalized += character;
  }
  return normalized;
}

export function parseThcrapJson(resource) {
  let parsed;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(resource.bytes);
    parsed = JSON.parse(normalizeThcrapDataJson(text, resource.path));
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(`${resource.path}:`)) throw error;
    throw new TypeError(`${resource.path}: invalid UTF-8 JSON (${error.message})`);
  }
  assertJsonTree(parsed);
  return parsed;
}

function isJsonObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function mergeThcrapJsonObjects(base, overlay) {
  if (!isJsonObject(base) || !isJsonObject(overlay)) {
    throw new TypeError("thcrap JSON merge requires objects");
  }
  for (const [key, value] of Object.entries(overlay)) {
    if (isJsonObject(base[key]) && isJsonObject(value)) {
      mergeThcrapJsonObjects(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export function mergeStringdefsResources(resources) {
  if (!Array.isArray(resources)) throw new TypeError("stringdefs resources must be an array");
  const layers = resources
    .filter(resource => resource?.sourceRole === "stringdefs")
    .sort((left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0));
  const merged = {};
  for (const resource of layers) {
    const parsed = parseThcrapJson(resource);
    if (!isJsonObject(parsed)) throw new TypeError(`${resource.path}: stringdefs root must be an object`);
    mergeThcrapJsonObjects(merged, parsed);
  }
  return merged;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function encodeAsciiLocalizationTable(stringdefs, { game }) {
  if (!isJsonObject(stringdefs)) throw new TypeError(`${game}: merged stringdefs must be an object`);
  const contract = validateAsciiContract(game);
  const records = [];

  for (const source of contract.records) {
    const rawTranslation = stringdefs[source.id];
    if (rawTranslation !== undefined && rawTranslation !== null && typeof rawTranslation !== "string") {
      throw new TypeError(`${game}: stringdefs value for ${source.id} must be a string or null`);
    }
    const hasTranslation = typeof rawTranslation === "string";
    const translation = hasTranslation ? rawTranslation : "";
    const signatureSource = source.lookupOnly ? source.signatureFallback : source.aliases[0];
    const sourceSignature = legacyAsciiPrintfSignature(signatureSource);
    for (const alias of source.aliases) {
      const aliasSignature = legacyAsciiPrintfSignature(alias);
      if (JSON.stringify(aliasSignature) !== JSON.stringify(sourceSignature)) {
        throw new TypeError(`${game}: ASCII aliases disagree on printf signature for ${source.id}`);
      }
    }
    if (hasTranslation) {
      const translationSignature = legacyAsciiPrintfSignature(translation);
      if (JSON.stringify(translationSignature) !== JSON.stringify(sourceSignature)) {
        throw new TypeError(`${game}: ASCII translation changes printf signature for ${source.id}`);
      }
    }
    const baseline = source.align?.baseline ?? "";
    const extraHalf = source.align ? source.align.extraX * 2 : 0;
    if (!Number.isInteger(extraHalf) || extraHalf < -32768 || extraHalf > 32767) {
      throw new TypeError(`${game}: invalid ASCII half-pixel alignment for ${source.id}`);
    }

    const aliases = source.lookupOnly ? [""] : source.aliases;
    for (const alias of aliases) {
      records.push({
        alias,
        id: source.id,
        translation,
        baseline,
        extraHalf,
        flags: (hasTranslation ? 1 : 0) | (source.align ? 2 : 0)
      });
    }
  }

  records.sort((left, right) => compareCodeUnits(left.alias, right.alias) || compareCodeUnits(left.id, right.id));
  const encoded = records.map(record => ({
    ...record,
    aliasBytes: Buffer.from(record.alias, "utf8"),
    idBytes: Buffer.from(record.id, "utf8"),
    translationBytes: Buffer.from(record.translation, "utf8"),
    baselineBytes: Buffer.from(record.baseline, "utf8")
  }));

  for (const record of encoded) {
    for (const [label, bytes] of [["alias", record.aliasBytes], ["id", record.idBytes],
                                  ["translation", record.translationBytes], ["baseline", record.baselineBytes]]) {
      if (bytes.length > 0xffff) throw new TypeError(`${game}: ASCII ${label} is too long for ${record.id}`);
    }
  }

  const total = 8 + encoded.reduce((sum, record) =>
    sum + 12 + record.aliasBytes.length + record.idBytes.length +
          record.translationBytes.length + record.baselineBytes.length, 0);
  const output = Buffer.allocUnsafe(total);
  output.write("EAS1", 0, 4, "ascii");
  output.writeUInt32LE(encoded.length, 4);
  let offset = 8;
  for (const record of encoded) {
    output.writeUInt16LE(record.aliasBytes.length, offset);
    output.writeUInt16LE(record.idBytes.length, offset + 2);
    output.writeUInt16LE(record.translationBytes.length, offset + 4);
    output.writeUInt16LE(record.baselineBytes.length, offset + 6);
    output.writeInt16LE(record.extraHalf, offset + 8);
    output.writeUInt16LE(record.flags, offset + 10);
    offset += 12;
    for (const bytes of [record.aliasBytes, record.idBytes, record.translationBytes, record.baselineBytes]) {
      bytes.copy(output, offset);
      offset += bytes.length;
    }
  }
  return output;
}

export function encodeStringLocalizationTable(stringdefs, { game }) {
  if (!isJsonObject(stringdefs)) throw new TypeError(`${game}: merged stringdefs must be an object`);
  const contract = validateStringContract(game);
  const records = [];
  for (const source of contract.records) {
    const rawTranslation = stringdefs[source.id];
    if (rawTranslation !== undefined && rawTranslation !== null && typeof rawTranslation !== "string")
      throw new TypeError(`${game}: stringdefs value for ${source.id} must be a string or null`);
    const hasTranslation = typeof rawTranslation === "string";
    const translation = hasTranslation ? rawTranslation : "";
    if (hasTranslation && source.formatFallback !== undefined) {
      const sourceSignature = legacyAsciiPrintfSignature(source.formatFallback);
      const translationSignature = legacyAsciiPrintfSignature(translation);
      if (JSON.stringify(sourceSignature) !== JSON.stringify(translationSignature))
        throw new TypeError(`${game}: string translation changes printf signature for ${source.id}`);
    }
    records.push({ id: source.id, translation, flags: hasTranslation ? 1 : 0 });
  }
  records.sort((left, right) => compareCodeUnits(left.id, right.id));
  const encoded = records.map(record => ({
    ...record,
    idBytes: Buffer.from(record.id, "utf8"),
    translationBytes: Buffer.from(record.translation, "utf8")
  }));
  for (const record of encoded) {
    if (record.idBytes.length > 0xffff || record.translationBytes.length > 0xffff)
      throw new TypeError(`${game}: strings record is too long for ${record.id}`);
  }
  const total = 8 + encoded.reduce((sum, record) => sum + 8 + record.idBytes.length + record.translationBytes.length, 0);
  const output = Buffer.allocUnsafe(total);
  output.write("EST1", 0, 4, "ascii");
  output.writeUInt32LE(encoded.length, 4);
  let offset = 8;
  for (const record of encoded) {
    output.writeUInt16LE(record.idBytes.length, offset);
    output.writeUInt16LE(record.translationBytes.length, offset + 2);
    output.writeUInt16LE(record.flags, offset + 4);
    output.writeUInt16LE(0, offset + 6);
    offset += 8;
    record.idBytes.copy(output, offset);
    offset += record.idBytes.length;
    record.translationBytes.copy(output, offset);
    offset += record.translationBytes.length;
  }
  return output;
}

function splitLines(bytes) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 0x0a) continue;
    lines.push(Buffer.from(bytes.subarray(start, index)));
    start = index + 1;
  }
  if (start < bytes.length) lines.push(Buffer.from(bytes.subarray(start)));
  return { lines, trailingNewline: start === bytes.length };
}

function truncateUtf8(value, maximum = 250) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximum) return bytes;
  let end = maximum;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

// In-game dialogue line layout per msg format, mirroring thcrap's
// th06_msg.cpp MSG_TH06/MSG_TH08 opcode tables. TH06/TH07 share msg06
// (hard lines with explicit side/line numbers, op 8 is the typed boss-intro
// variant); TH08's msg08 keeps hard line op 3 but renders regular dialogue
// through auto line ops 16/19/20 and closes auto boxes with ops 4/15.
const MSG_LINE_FORMAT = Object.freeze({
  6: Object.freeze({ hard: Object.freeze({ 3: null, 8: "h1" }), auto: Object.freeze([]), autoEnd: Object.freeze([]) }),
  8: Object.freeze({ hard: Object.freeze({ 3: null }), auto: Object.freeze([16, 19, 20]), autoEnd: Object.freeze([4, 15]) }),
  // thcrap_tsa/src/th06_msg.cpp MSG_TH09.
  9: Object.freeze({ hard: Object.freeze({}), auto: Object.freeze([16]), autoEnd: Object.freeze([4, 15]) }),
  // TH10 (thcrap th06_msg.cpp MSG_TH10): dialogue is all auto line 16, closed
  // by auto-end opcodes 7/8/10; hard-line op 3 carries no text.
  10: Object.freeze({ hard: Object.freeze({}), auto: Object.freeze([16]), autoEnd: Object.freeze([7, 8, 10]) }),
  // thcrap_tsa/src/th06_msg.cpp MSG_TH11: op 25 is deleted by thcrap.
  11: Object.freeze({ hard: Object.freeze({}), auto: Object.freeze([17]), autoEnd: Object.freeze([7, 8, 9, 11]) })
});

// TH10 endings (thcrap END_TH10): auto line 3, closed by 5/6/9. They live in
// e*.msg and are dumped/compiled with thmsg -e.
const ENDING_LINE_FORMAT = Object.freeze({
  10: Object.freeze({ hard: Object.freeze({}), auto: Object.freeze([3]), autoEnd: Object.freeze([5, 6, 9]) }),
  11: Object.freeze({ hard: Object.freeze({}), auto: Object.freeze([3]), autoEnd: Object.freeze([5, 6, 9]) })
});

function msgLineFormat(version) {
  if (version === 11) return MSG_LINE_FORMAT[11];
  if (version === 10) return MSG_LINE_FORMAT[10];
  if (version === 9) return MSG_LINE_FORMAT[9];
  if (version === 8) return MSG_LINE_FORMAT[8];
  if (version === 6 || version === 7) return MSG_LINE_FORMAT[6];
  throw new TypeError(`unsupported message version: ${version}`);
}

function endingLineFormat(version) {
  if (version === 11) return ENDING_LINE_FORMAT[11];
  if (version === 10) return ENDING_LINE_FORMAT[10];
  throw new TypeError(`unsupported ending version: ${version}`);
}

function parseDialogueLine(line, format) {
  const prefix = line.toString("latin1", 0, Math.min(line.length, 96));
  const opcode = Number(/^\t(\d+);/.exec(prefix)?.[1]);
  if (format.autoEnd.includes(opcode)) return { autoEnd: true };
  if (format.auto.includes(opcode)) return { opcode, auto: true };
  const match = /^\t(3|8);(-?\d+);(\d+);/.exec(prefix);
  if (!match || !(Number(match[1]) in format.hard)) return null;
  return {
    opcode: Number(match[1]),
    side: Number(match[2]),
    lineNumber: Number(match[3]),
    type: format.hard[Number(match[1])]
  };
}

function replacementLine(command, lineNumber, text) {
  if (command.auto) {
    return Buffer.concat([Buffer.from(`\t${command.opcode};`, "ascii"), truncateUtf8(text)]);
  }
  return Buffer.concat([
    Buffer.from(`\t${command.opcode};${command.side};${lineNumber};`, "ascii"),
    truncateUtf8(text)
  ]);
}

function getPatchedLines(diff, entry, key) {
  const entryPatch = diff?.[String(entry)];
  const lines = entryPatch?.[key]?.lines;
  return Array.isArray(lines) && lines.every(line => typeof line === "string") ? lines : null;
}

export function patchThmsgDump(source, diff, version = 6, { ending = false } = {}) {
  if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError("thmsg source bytes are required");
  assertJsonTree(diff);
  const format = ending ? endingLineFormat(version) : msgLineFormat(version);
  const { lines, trailingNewline } = splitLines(source);
  const replacements = new Map();
  const insertions = new Map();
  let entry = -1;
  let time = -1;
  let index = -1;
  let lastType = null;
  let hasLastType = false;
  let box = null;

  const finishBox = () => {
    if (!box) return;
    const patched = getPatchedLines(diff, box.entry, box.key);
    if (patched) {
      for (const item of box.commands) {
        const text = patched[item.command.lineNumber];
        replacements.set(item.index, text === undefined ? null : replacementLine(item.command, item.command.lineNumber, text));
      }
      const nextLine = box.commands.reduce((maximum, item) => Math.max(maximum, item.command.lineNumber), -1) + 1;
      if (patched.length > nextLine) {
        const last = box.commands.at(-1);
        const extra = [];
        for (let lineNumber = nextLine; lineNumber < patched.length; lineNumber++) {
          extra.push(replacementLine(last.command, lineNumber, patched[lineNumber]));
        }
        insertions.set(last.index, extra);
      }
    }
    box = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const ascii = lines[lineIndex].toString("ascii");
    // TH10's thmsg -d appends the entry byte size, e.g. "entry 0 (256)";
    // th06/07/08 emit a bare "entry N". Accept both.
    const entryMatch = /^entry (\d+)(?: \(\d+\))?$/.exec(ascii);
    if (entryMatch) {
      finishBox();
      entry = Number(entryMatch[1]);
      time = -1;
      index = -1;
      lastType = null;
      hasLastType = false;
      continue;
    }
    const timeMatch = /^@(\d+)$/.exec(ascii);
    if (timeMatch) {
      const nextTime = Number(timeMatch[1]);
      if (nextTime !== time) index = -1;
      time = nextTime;
      continue;
    }
    const command = parseDialogueLine(lines[lineIndex], format);
    if (!command) continue;
    if (command.autoEnd) {
      // MSG_TH08 OP_AUTO_END closes an auto box; hard-line boxes stay open
      // (th06_msg.cpp op_auto_end only ends boxes whose last line was auto).
      if (!box || box.auto) finishBox();
      continue;
    }
    if (command.auto) {
      // OP_AUTO_LINE following a hard-line box terminates that box first.
      if (box && !box.auto) finishBox();
      if (!box) {
        index++;
        box = { entry, key: `${time}_${index}`, commands: [], auto: true };
      }
      command.lineNumber = box.commands.length;
      box.commands.push({ index: lineIndex, command });
      lastType = null;
      hasLastType = true;
      continue;
    }
    if (command.lineNumber === 0 || !box) {
      finishBox();
      if (hasLastType) {
        const changedBetweenTypedAndUntyped = (lastType === null) !== (command.type === null);
        const repeatedTypedOpcode = lastType !== null && lastType === command.type;
        if (changedBetweenTypedAndUntyped || repeatedTypedOpcode) index = -1;
      }
      index++;
      const key = command.type ? `${time}_${command.type}_${index}` : `${time}_${index}`;
      box = { entry, key, commands: [] };
    }
    box.commands.push({ index: lineIndex, command });
    lastType = command.type;
    hasLastType = true;
  }
  finishBox();

  const output = [];
  for (let index = 0; index < lines.length; index++) {
    // MSG_TH11 marks opcode 25 as OP_DELETE: thcrap_tsa/process_op omits
    // it from the patched output even when this message has no text diff.
    if (!ending && version === 11 && /^\t25;/.test(lines[index].toString("latin1", 0, 8))) continue;
    if (replacements.has(index)) {
      const replacement = replacements.get(index);
      if (replacement) output.push(replacement);
    } else {
      output.push(lines[index]);
    }
    const extra = insertions.get(index);
    if (extra) output.push(...extra);
  }
  const joined = Buffer.from(output.length ? Buffer.concat(output.flatMap((line, index) =>
    index === output.length - 1 && !trailingNewline ? [line] : [line, Buffer.from("\n")]
  )) : Buffer.alloc(0));
  return joined;
}

function isAtSign(bytes, index) {
  return bytes[index] === 0x40 && (index === 0 || (bytes[index - 1] & 0x80) === 0);
}

export function patchEnding(source, diff) {
  if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError("ending source bytes are required");
  assertJsonTree(diff);
  const bytes = Buffer.from(source);
  const output = [];
  let cursor = 0;
  let lineIndex = 0;
  while (cursor < bytes.length) {
    if (isAtSign(bytes, cursor)) {
      let end = bytes.indexOf(0x0a, cursor);
      if (end < 0) end = bytes.length - 1;
      else end += 1;
      output.push(bytes.subarray(cursor, end));
      cursor = end;
      lineIndex++;
      continue;
    }
    const patch = diff?.[String(lineIndex)]?.lines;
    if (Array.isArray(patch) && patch.every(line => typeof line === "string")) {
      for (const line of patch) output.push(Buffer.from(`${line}\0\n`, "utf8"));
      let end = cursor;
      while (end < bytes.length && !isAtSign(bytes, end)) {
        if (bytes[end] === 0x0a) lineIndex++;
        end++;
      }
      cursor = end;
      continue;
    }
    let end = cursor;
    while (end < bytes.length && !isAtSign(bytes, end)) end++;
    output.push(bytes.subarray(cursor, end));
    for (let index = cursor; index < end; index++) if (bytes[index] === 0x0a) lineIndex++;
    cursor = end;
  }
  return Buffer.concat(output);
}

function canonicalJson(resource, parsed) {
  return {
    bytes: Buffer.from(`${JSON.stringify(parsed)}\n`),
    extension: ".json",
    format: resource.kind === "jdiff" ? "thcrap-jdiff/1" : "thcrap-table/1",
    targetPath: resource.mountPath
  };
}

function pushLocalizationRecord(records, key, line, value, label) {
  if (!Number.isInteger(key) || key < 0 || key > 0xffffffff ||
      !Number.isInteger(line) || line < 0 || line > 0xffff || typeof value !== "string") {
    throw new TypeError(`${label}: invalid localization table record`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 0xffff) throw new TypeError(`${label}: localization text is too long`);
  records.push({ key, line, bytes });
}

export function encodeLocalizationTable(parsed, { game, table } = {}) {
  assertJsonTree(parsed);
  if (!GAME_VERSION[game]) throw new TypeError(`unsupported localization game: ${game}`);
  if (!new Set(["spells", "stages", "musiccmt", "themes"]).has(table)) {
    throw new TypeError(`unsupported localization table: ${table}`);
  }
  const records = [];
  for (const [rawKey, value] of Object.entries(parsed)) {
    let key;
    if (table === "themes") {
      const match = new RegExp(`^${game}_(\\d+)$`, "i").exec(rawKey);
      if (!match) continue;
      key = Number(match[1]);
    } else {
      if (!/^\d+$/.test(rawKey)) continue;
      key = Number(rawKey);
    }
    if (Array.isArray(value)) {
      for (let line = 0; line < value.length; line++) {
        // null means that this patch leaves the inherited/original slot alone.
        if (value[line] === null) continue;
        pushLocalizationRecord(records, key, line, value[line], `${table}.${rawKey}[${line}]`);
      }
    } else if (value === null) {
      continue;
    } else {
      pushLocalizationRecord(records, key, 0, value, `${table}.${rawKey}`);
    }
  }
  return serializeLocalizationRecords(records);
}

function serializeLocalizationRecords(records) {
  records.sort((left, right) => left.key - right.key || left.line - right.line);
  const header = Buffer.alloc(8);
  header.write("ETL1", 0, "ascii");
  header.writeUInt32LE(records.length, 4);
  const chunks = [header];
  for (const record of records) {
    const item = Buffer.alloc(8);
    item.writeUInt32LE(record.key, 0);
    item.writeUInt16LE(record.line, 4);
    item.writeUInt16LE(record.bytes.length, 6);
    chunks.push(item, record.bytes);
  }
  return Buffer.concat(chunks);
}

// spellcomments.js is a per-spell nested table consumed by thcrap's TSA
// spell_comment_line/spell_owner breakpoints.  The practice details screen
// rewrites the two displayed comment lines through comment_1[0]/comment_1[1]
// and the owner through the "owner" field, so the ETL stores comment_N line
// indices as (N-1)*stride+line and the owner at a reserved line.
const SPELL_COMMENT_LINE_STRIDE = 0x100;
export const SPELL_COMMENT_OWNER_LINE = 0x200;

export function encodeSpellCommentsTable(parsed, { game } = {}) {
  assertJsonTree(parsed);
  if (!GAME_VERSION[game]) throw new TypeError(`unsupported localization game: ${game}`);
  const records = [];
  for (const [rawKey, value] of Object.entries(parsed)) {
    if (!/^\d+$/.test(rawKey)) continue;
    const key = Number(rawKey);
    if (value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`spellcomments.${rawKey}: expected an object`);
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      if (field === "owner") {
        if (typeof fieldValue !== "string") {
          throw new TypeError(`spellcomments.${rawKey}.owner: expected a string`);
        }
        pushLocalizationRecord(records, key, SPELL_COMMENT_OWNER_LINE, fieldValue,
          `spellcomments.${rawKey}.owner`);
        continue;
      }
      const comment = /^comment_(\d+)$/.exec(field);
      if (!comment) continue;
      const number = Number(comment[1]);
      if (!Number.isInteger(number) || number < 1 || number > 0x10000 / SPELL_COMMENT_LINE_STRIDE) {
        throw new TypeError(`spellcomments.${rawKey}.${field}: invalid comment index`);
      }
      if (fieldValue === null) continue;
      if (!Array.isArray(fieldValue)) {
        throw new TypeError(`spellcomments.${rawKey}.${field}: expected an array of lines`);
      }
      for (let line = 0; line < fieldValue.length; line++) {
        if (fieldValue[line] === null) continue;
        pushLocalizationRecord(records, key, (number - 1) * SPELL_COMMENT_LINE_STRIDE + line,
          fieldValue[line], `spellcomments.${rawKey}.${field}[${line}]`);
      }
    }
  }
  return serializeLocalizationRecords(records);
}

export class ThcrapRuntimeCompiler {
  constructor({ runner, archives = {} } = {}) {
    if (!runner || typeof runner.extractArchiveEntry !== "function" || typeof runner.dumpMessage !== "function" ||
        typeof runner.compileMessage !== "function") throw new TypeError("thtk runner is required");
    this.runner = runner;
    this.archives = Object.fromEntries(Object.entries(archives).map(([game, value]) => [game, (Array.isArray(value) ? value : [value]).filter(Boolean)]));
    this.baseFiles = new Map();
  }

  async readBaseFile(game, entry) {
    const key = `${game}/${entry}`;
    if (this.baseFiles.has(key)) return this.baseFiles.get(key);
    const version = GAME_VERSION[game];
    const archives = this.archives[game] || [];
    let lastError;
    for (const archive of archives) {
      try {
        const bytes = await this.runner.extractArchiveEntry(archive, entry, version);
        this.baseFiles.set(key, bytes);
        return bytes;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${key}: base resource was not found in configured archives${lastError ? ` (${lastError.message})` : ""}`);
  }

  async process(resource) {
    if (!resource || !(resource.bytes instanceof Uint8Array)) throw new TypeError("invalid downloaded thcrap resource");
    if (resource.sourceRole === "stringdefs") {
      throw new TypeError(`${resource.path}: stringdefs is a pack-level merge source; use processPack()`);
    }
    if (resource.kind !== "jdiff" && resource.kind !== "table") {
      return {
        bytes: Buffer.from(resource.bytes),
        extension: extname(resource.path).toLowerCase() || ".bin",
        format: resource.kind,
        targetPath: resource.mountPath
      };
    }
    const parsed = parseThcrapJson(resource);
    const gameOptions = GAME_OPTIONS.exec(resource.path);
    if (gameOptions || (resource.path === "global.js" && GAME_VERSION[resource.game])) {
      const game = gameOptions ? (gameOptions[1] || gameOptions[2]).toLowerCase() : resource.game;
      if (typeof parsed.font === "string" && Array.isArray(resource.fontFiles)) {
        const normalized = parsed.font.toLowerCase().replace(/[^a-z0-9]/g, "");
        parsed.fontFile = resource.fontFiles.find(file => {
          const stem = file.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
          // script_latin calls the face "Touhou Biolinum" but ships it as
          // THBiolinum.otf.  thcrap/Windows resolves that through the font's
          // internal face name; the Web build needs the physical file name.
          return stem === normalized || (stem.startsWith("th") && `touhou${stem.slice(2)}` === normalized);
        }) || null;
      }
      return {
        bytes: Buffer.from(`${JSON.stringify(parsed)}\n`),
        extension: ".json",
        format: "eagler-localization-options/1",
        targetPath: `/thcrap/${game}/localization/options.json`
      };
    }
    const localization = LOCALIZATION_TABLE.exec(resource.path);
    if (localization) {
      const [, game, table] = localization;
      return {
        bytes: encodeLocalizationTable(parsed, { game: game.toLowerCase(), table: table.toLowerCase() }),
        extension: ".etl",
        format: "eagler-localization-table/1",
        targetPath: `/thcrap/${game.toLowerCase()}/localization/${table.toLowerCase()}.etl`
      };
    }
    const spellComments = SPELL_COMMENTS_TABLE.exec(resource.path);
    if (spellComments) {
      const game = spellComments[1].toLowerCase();
      return {
        bytes: encodeSpellCommentsTable(parsed, { game }),
        extension: ".etl",
        format: "eagler-localization-table/1",
        targetPath: `/thcrap/${game}/localization/spellcomments.etl`
      };
    }
    if (resource.path === "themes.js") {
      const game = resource.game;
      return {
        bytes: encodeLocalizationTable(parsed, { game, table: "themes" }),
        extension: ".etl",
        format: "eagler-localization-table/1",
        targetPath: `/thcrap/${game}/localization/themes.etl`
      };
    }
    const th10Dialogue = TH10_DIALOGUE_DIFF.exec(resource.path);
    const th11Dialogue = TH11_DIALOGUE_DIFF.exec(resource.path);
    if (th11Dialogue) {
      const game = "th11", version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, th11Dialogue[1]);
      const dumped = await this.runner.dumpMessage(base, version);
      const bytes = await this.runner.compileMessage(patchThmsgDump(dumped, parsed, version), version);
      return { bytes, extension: ".msg", format: "touhou-message/1", targetPath: resource.mountPath.replace(/\.jdiff$/i, "") };
    }
    if (th10Dialogue) {
      const game = "th10";
      const version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, th10Dialogue[1]);
      const dumped = await this.runner.dumpMessage(base, version);
      const patched = patchThmsgDump(dumped, parsed, version);
      const bytes = await this.runner.compileMessage(patched, version);
      return {
        bytes,
        extension: ".msg",
        format: "touhou-message/1",
        targetPath: resource.mountPath.replace(/\.jdiff$/i, "")
      };
    }
    const th09Dialogue = TH09_DIALOGUE_DIFF.exec(resource.path);
    if (th09Dialogue) {
      const game = "th09";
      const version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, th09Dialogue[1]);
      const dumped = await this.runner.dumpMessage(base, version);
      const patched = patchThmsgDump(dumped, parsed, version);
      const bytes = await this.runner.compileMessage(patched, version);
      return {
        bytes,
        extension: ".msg",
        format: "touhou-message/1",
        targetPath: resource.mountPath.replace(/\.jdiff$/i, "")
      };
    }
    const th10Ending = TH10_ENDING_DIFF.exec(resource.path);
    const th11Ending = TH11_ENDING_DIFF.exec(resource.path);
    if (th11Ending) {
      const game = "th11", version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, th11Ending[1]);
      const dumped = await this.runner.dumpEnding(base, version);
      const bytes = await this.runner.compileEnding(patchThmsgDump(dumped, parsed, version, { ending: true }), version);
      return { bytes, extension: ".msg", format: "touhou-ending/1", targetPath: resource.mountPath.replace(/\.jdiff$/i, "") };
    }
    if (th10Ending) {
      const game = "th10";
      const version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, th10Ending[1]);
      const dumped = await this.runner.dumpEnding(base, version);
      const patched = patchThmsgDump(dumped, parsed, version, { ending: true });
      const bytes = await this.runner.compileEnding(patched, version);
      return {
        bytes,
        extension: ".msg",
        format: "touhou-ending/1",
        targetPath: resource.mountPath.replace(/\.jdiff$/i, "")
      };
    }
    const message = MESSAGE_DIFF.exec(resource.path);
    if (message) {
      const game = resource.path.slice(0, 4).toLowerCase();
      const version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, message[1]);
      const dumped = await this.runner.dumpMessage(base, version);
      const patched = patchThmsgDump(dumped, parsed, version);
      const bytes = await this.runner.compileMessage(patched, version);
      return {
        bytes,
        extension: ".dat",
        format: "touhou-message/1",
        targetPath: resource.mountPath.replace(/\.jdiff$/i, "")
      };
    }
    const ending = ENDING_DIFF.exec(resource.path);
    if (ending) {
      const game = resource.path.slice(0, 4).toLowerCase();
      const base = await this.readBaseFile(game, ending[1]);
      return {
        bytes: patchEnding(base, parsed),
        extension: ".end",
        format: "touhou-ending/1",
        targetPath: resource.mountPath.replace(/\.jdiff$/i, "")
      };
    }
    return canonicalJson(resource, parsed);
  }

  async processPack(resources) {
    if (!Array.isArray(resources)) throw new TypeError("thcrap resources must be an array");
    const stringdefsSources = resources.filter(resource => resource?.sourceRole === "stringdefs");
    const normalResources = resources.filter(resource => resource?.sourceRole !== "stringdefs");
    const processed = [];
    for (const resource of normalResources) {
      processed.push({ ...resource, ...(await this.process(resource)) });
    }

    if (stringdefsSources.length) {
      const games = new Set(stringdefsSources.map(resource => resource.game));
      if (games.size !== 1) throw new TypeError("stringdefs merge sources must belong to one game");
      const game = [...games][0];
      const merged = mergeStringdefsResources(stringdefsSources);
      const bytes = encodeAsciiLocalizationTable(merged, { game });
      processed.push({
        game,
        path: "stringdefs.js",
        mountPath: `/thcrap/${game}/localization/ascii.etl`,
        targetPath: `/thcrap/${game}/localization/ascii.etl`,
        kind: "table",
        format: "eagler-localization-ascii/1",
        extension: ".etl",
        bytes,
        sourcePaths: stringdefsSources
          .slice()
          .sort((left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0))
          .map(resource => `${resource.patch}:${resource.path}`)
      });
      const stringBytes = encodeStringLocalizationTable(merged, { game });
      processed.push({
        game,
        path: "stringdefs.js",
        mountPath: `/thcrap/${game}/localization/strings.etl`,
        targetPath: `/thcrap/${game}/localization/strings.etl`,
        kind: "table",
        format: "eagler-localization-strings/1",
        extension: ".etl",
        bytes: stringBytes,
        sourcePaths: stringdefsSources
          .slice()
          .sort((left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0))
          .map(resource => `${resource.patch}:${resource.path}`)
      });
    }
    return processed;
  }
}
