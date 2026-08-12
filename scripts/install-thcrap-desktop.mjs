import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
  args.set(key.slice(2), value);
  index++;
}

const manifestPath = resolve(args.get("manifest") || "manifest.json");
const outputRoot = resolve(args.get("output") || ".");
const cacheRoot = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.schema !== "eagler-touhou/thcrap-runtime-pack/1" || !manifest.runtimeReady)
  throw new TypeError("manifest is not a ready thcrap runtime pack");
if (!/^th(?:06|07)$/.test(manifest.game) || !Array.isArray(manifest.assets))
  throw new TypeError("invalid thcrap runtime manifest");

let installed = 0;
for (const asset of manifest.assets) {
  if (!asset || typeof asset.targetPath !== "string" || typeof asset.sha256 !== "string" ||
      typeof asset.url !== "string") throw new TypeError("invalid runtime asset");
  const expectedPrefix = `/thcrap/${manifest.game}/`;
  if (!asset.targetPath.startsWith(expectedPrefix))
    throw new TypeError(`asset escapes ${expectedPrefix}: ${asset.targetPath}`);

  const relativePath = asset.targetPath.slice(1).replaceAll("/", sep);
  const destination = resolve(outputRoot, relativePath);
  if (destination !== outputRoot && !destination.startsWith(outputRoot + sep))
    throw new TypeError(`unsafe destination: ${asset.targetPath}`);
  const source = resolve(cacheRoot, "assets", basename(asset.url));
  const bytes = await readFile(source);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== asset.sha256) throw new Error(`SHA-256 mismatch: ${asset.targetPath}`);
  if (Number.isFinite(asset.bytes) && bytes.length !== asset.bytes)
    throw new Error(`size mismatch: ${asset.targetPath}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  installed++;
}

console.log(JSON.stringify({ game: manifest.game, language: manifest.language, installed, outputRoot }));
