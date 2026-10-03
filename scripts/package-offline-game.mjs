import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { canonicalPackagePayload, validatePackageDescriptor } from "../package/package-descriptor.mjs";

const site = resolve(process.argv[2] || "");
const game = String(process.argv[3] || "").toLowerCase();
const withoutOgg = process.argv.includes("--without-ogg");
// DEFLATE for compressible members; already-compressed OGG stays STORE.
const deflate = process.argv.includes("--deflate");
if (!process.argv[2] || !/^th\d{2}$/.test(game)) {
  throw new Error("usage: node scripts/package-offline-game.mjs <production-site-root> thXX [output.zip]");
}

const descriptorPath = resolve(site, `${game}.package.json`);
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
const hasLanguagePacks = Array.isArray(descriptor.components?.language?.entries) &&
  descriptor.components.language.entries.length > 0;
// Language-enabled packages also support the Japanese baseline. Launcher
// requests its shared font even when a Runtime uses baked Japanese glyphs.
const sharedFonts = hasLanguagePacks ? ["msgothic.ttc", "unifont.otf"] : [];
for (const name of sharedFonts) {
  if (descriptor.base.files.some(fileId => descriptor.files[fileId]?.target === `/${name}`)) continue;
  const source = `shared/${name}`;
  const info = await stat(resolve(site, source)).catch(() => null);
  if (!info?.isFile() || !info.size) {
    throw new Error(`${game}: offline package requires ${source}`);
  }
  const fileId = name === "msgothic.ttc" ? "shared-msgothic" : "shared-unifont";
  if (Object.hasOwn(descriptor.files, fileId)) throw new Error(`${game}: package file ID is already in use: ${fileId}`);
  descriptor.files[fileId] = {
    source,
    target: `/${name}`,
    revision: "pending",
  };
  descriptor.base.files.push(fileId);
}
if (withoutOgg) {
  for (const fileId of Object.keys(descriptor.files)) {
    if (fileId.toLowerCase().startsWith("ogg:")) delete descriptor.files[fileId];
  }
  if (descriptor.components?.ogg) delete descriptor.components.ogg;
  descriptor.revision = `${descriptor.revision}-no-ogg`;
}
validatePackageDescriptor(descriptor);
if (descriptor.game !== game) throw new Error(`${game}: Package Descriptor game mismatch`);

const entries = {};
let payloadBytes = 0;
for (const [fileId, declaration] of Object.entries(descriptor.files)) {
  const source = resolve(site, declaration.source);
  const info = await stat(source);
  if (!info.isFile()) throw new Error(`${game}: Package source is not a file: ${fileId}`);
  const bytes = await readFile(source);
  // Package the selected bytes and derive this package generation's identity.
  declaration.bytes = bytes.length;
  declaration.sha256 = createHash("sha256").update(bytes).digest("hex");
  declaration.revision = declaration.sha256.slice(0, 16);
  const payload = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // OGG is already compressed, so keep it stored while DEFLATE handles the
  // retail archive and the descriptor.
  entries[declaration.source] = deflate && declaration.source.toLowerCase().endsWith(".ogg")
    ? [payload, { level: 0 }]
    : payload;
  payloadBytes += bytes.length;
}
descriptor.revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
entries["package.json"] = strToU8(`${JSON.stringify(descriptor, null, 2)}\n`);

const archive = zipSync(entries, { level: deflate ? 9 : 0 });
const identity = createHash("sha256").update(archive).digest("hex").slice(0, 16);
const output = process.argv[4]
  ? resolve(process.cwd(), process.argv[4])
  : resolve(site, "..", `${game}-package-${descriptor.revision}-${identity}.zip`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
console.log(JSON.stringify({
  game,
  revision: descriptor.revision,
  output,
  files: Object.keys(descriptor.files).length,
  payloadBytes,
  archiveBytes: archive.length,
  method: deflate ? "DEFLATE" : "STORE",
  descriptor: "package.json",
  withoutOgg,
  deflate,
}));
