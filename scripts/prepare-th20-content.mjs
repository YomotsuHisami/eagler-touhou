import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { TH20_MUSIC_FILES, TH20_MUSIC_LAYOUT } from "../lib/th20-content-layout.mjs";
import { assertOggProductionBaseline, pinOggSerial } from "../lib/ogg-production-baseline.mjs";

const PCM_BYTES_PER_FRAME = 4;

function argument(name, fallback) {
  const inline = process.argv.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const originalArgument = argument("--original", "");
if (!originalArgument) throw new Error("Usage: node scripts/prepare-th20-content.mjs --original=DIR --output=DIR");
const original = resolve(originalArgument);
const output = resolve(argument("--output", resolve("assets-ogg")));
const sourceArchive = join(original, "th20.dat");
const sourceMusic = join(original, "thbgm.dat");
const outputArchive = join(output, "th20.data");
const outputMusic = join(output, "bgm-ogg");
const provenancePath = join(output, "provenance.json");
const baselinePath = resolve(import.meta.dirname, "../host/ogg-baselines/th20.json");

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function ffmpegVersion() {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`ffmpeg is required on PATH: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ffmpeg -version failed: ${result.stderr || result.stdout}`);
  return (result.stdout ?? "").split(/\r?\n/, 1)[0].trim();
}

function encodeOgg(pcm, record) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", String(record.sampleRate), "-ac", String(record.channels), "-i", "pipe:0",
    "-c:a", "libvorbis", "-q:a", "5", "-f", "ogg", "pipe:1",
  ], { input: pcm, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`ffmpeg OGG encode failed for ${record.filename}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ffmpeg OGG encode failed for ${record.filename}: ${result.stderr || result.stdout}`);
  if (!result.stdout?.length) throw new Error(`ffmpeg emitted empty OGG for ${record.filename}`);
  return new Uint8Array(result.stdout);
}

async function readExistingProvenance() {
  try { return JSON.parse(await readFile(provenancePath, "utf8")); }
  catch { return null; }
}

if (TH20_MUSIC_LAYOUT.length !== 19 || TH20_MUSIC_FILES.length !== TH20_MUSIC_LAYOUT.length) {
  throw new Error("Invalid canonical TH20 music layout");
}

const archiveBytes = await readFile(sourceArchive);
const musicBytes = await readFile(sourceMusic);
const baselineBytes = await readFile(baselinePath);
const baseline = JSON.parse(baselineBytes);
if (baseline.schema !== "eagler-touhou/ogg-server-baseline/1" || baseline.game !== "th20" ||
    baseline.quality !== 5 || !baseline.files || typeof baseline.files !== "object") {
  throw new Error(`Invalid TH20 production OGG baseline: ${baselinePath}`);
}
const ffmpeg = ffmpegVersion();
const records = TH20_MUSIC_LAYOUT.map((row, index) => ({
  filename: TH20_MUSIC_FILES[index].replace(/\.ogg$/i, ".wav"),
  oggPath: `bgm-ogg/${TH20_MUSIC_FILES[index]}`,
  offset: row.offset,
  loop: row.loop,
  length: row.length,
  channels: 2,
  sampleRate: 44100,
  bytesPerSecond: 176400,
  alignment: 4,
  bitsPerSample: 16,
}));
if (records.some(record => record.offset < 16 || record.length <= 0 || record.loop < 0 || record.loop >= record.length ||
    record.offset + record.length > musicBytes.length || record.offset % PCM_BYTES_PER_FRAME ||
    record.loop % PCM_BYTES_PER_FRAME || record.length % PCM_BYTES_PER_FRAME)) {
  throw new Error("Canonical TH20 music layout does not match the supplied retail thbgm.dat");
}

const layoutIdentity = records.map(({ filename, oggPath, offset, loop, length }) => ({ filename, oggPath, offset, loop, length }));
const sourceIdentity = {
  archive: { name: basename(sourceArchive), bytes: archiveBytes.length, sha256: digest(archiveBytes) },
  music: { name: basename(sourceMusic), bytes: musicBytes.length, sha256: digest(musicBytes) },
  layout: { records: layoutIdentity, sha256: digest(Buffer.from(JSON.stringify(layoutIdentity))) },
  productionBaseline: { name: basename(baselinePath), sha256: digest(baselineBytes) },
  ffmpeg,
  encoder: { codec: "libvorbis", quality: 5 },
};
const previous = await readExistingProvenance();
const sameInput = previous && JSON.stringify(previous.source) === JSON.stringify(sourceIdentity) &&
  Array.isArray(previous.tracks) && previous.tracks.length === records.length;

await mkdir(outputMusic, { recursive: true });
if (!existsSync(outputArchive) || digest(await readFile(outputArchive)) !== sourceIdentity.archive.sha256) {
  await copyFile(sourceArchive, outputArchive);
}

const outputs = [];
for (const record of records) {
  const target = join(output, record.oggPath);
  const outputName = basename(record.oggPath);
  const expected = baseline.files[outputName];
  if (!expected || !Number.isInteger(expected.bytes) || !/^[a-f0-9]{64}$/i.test(expected.sha256 || "") ||
      !/^0x[a-f0-9]{1,8}$/i.test(expected.serial || "")) {
    throw new Error(`Missing or invalid TH20 production OGG baseline for ${outputName}`);
  }
  const old = sameInput ? previous.tracks.find(item => item.filename === record.filename) : null;
  let bytes;
  let action = "reused";
  if (old?.output && existsSync(target) && digest(await readFile(target)) === expected.sha256) {
    bytes = await readFile(target);
  } else {
    bytes = pinOggSerial(
      encodeOgg(musicBytes.subarray(record.offset, record.offset + record.length), record),
      Number.parseInt(expected.serial, 16),
    );
    assertOggProductionBaseline(bytes, expected, outputName);
    action = "encoded";
    const temporary = `${target}.tmp-${process.pid}`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  }
  assertOggProductionBaseline(bytes, expected, outputName);
  outputs.push({
    filename: record.filename,
    oggPath: record.oggPath,
    offset: record.offset,
    loop: record.loop,
    length: record.length,
    format: {
      channels: record.channels,
      sampleRate: record.sampleRate,
      bytesPerSecond: record.bytesPerSecond,
      alignment: record.alignment,
      bitsPerSample: record.bitsPerSample,
    },
    output: { bytes: bytes.length, sha256: digest(bytes) },
    action,
  });
}

const provenance = { schema: "eagler-touhou/th20-content/1", source: sourceIdentity, tracks: outputs };
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  archive: outputArchive,
  tracks: outputs.length,
  encoded: outputs.filter(item => item.action === "encoded").length,
  reused: outputs.filter(item => item.action === "reused").length,
  source: sourceIdentity,
}, null, 2));
