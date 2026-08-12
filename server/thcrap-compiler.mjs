import { extname } from "node:path";

const GAME_VERSION = Object.freeze({ th06: 6, th07: 7 });
const MESSAGE_DIFF = /^(?:th06|th07)\/(msg[1-8]\.dat)\.jdiff$/i;
const ENDING_DIFF = /^(?:th06|th07)\/(end[0-9]{2}b?\.end)\.jdiff$/i;
const LOCALIZATION_TABLE = /^(th06|th07)\/(spells|stages|musiccmt)\.js$/i;
const GAME_OPTIONS = /^(?:(th06|th07)\/)?(th06|th07)\.js$/i;

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

export function parseThcrapJson(resource) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resource.bytes));
  } catch (error) {
    throw new TypeError(`${resource.path}: invalid UTF-8 JSON (${error.message})`);
  }
  assertJsonTree(parsed);
  return parsed;
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

function parseDialogueLine(line) {
  const prefix = line.toString("latin1", 0, Math.min(line.length, 96));
  const match = /^\t(3|8);(-?\d+);(\d+);/.exec(prefix);
  if (!match) return null;
  return {
    opcode: Number(match[1]),
    side: Number(match[2]),
    lineNumber: Number(match[3]),
    type: match[1] === "8" ? "h1" : null
  };
}

function replacementLine(command, lineNumber, text) {
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

export function patchThmsgDump(source, diff) {
  if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError("thmsg source bytes are required");
  assertJsonTree(diff);
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
    const entryMatch = /^entry (\d+)$/.exec(ascii);
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
    const command = parseDialogueLine(lines[lineIndex]);
    if (!command) continue;
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
    if (resource.path === "themes.js") {
      const game = resource.game;
      return {
        bytes: encodeLocalizationTable(parsed, { game, table: "themes" }),
        extension: ".etl",
        format: "eagler-localization-table/1",
        targetPath: `/thcrap/${game}/localization/themes.etl`
      };
    }
    const message = MESSAGE_DIFF.exec(resource.path);
    if (message) {
      const game = resource.path.slice(0, 4).toLowerCase();
      const version = GAME_VERSION[game];
      const base = await this.readBaseFile(game, message[1]);
      const dumped = await this.runner.dumpMessage(base, version);
      const patched = patchThmsgDump(dumped, parsed);
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
}
