import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const GAME_ID = /^th(?:06|07|08|09|10|11)$/;
const LANGUAGE_ID = /^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const MAX_FILES = 256;

function assertBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be bytes`);
  return value;
}

function assertGame(value) {
  if (typeof value !== "string" || !GAME_ID.test(value)) throw new TypeError(`invalid game id: ${value}`);
  return value.toLowerCase();
}

function assertLanguage(value) {
  if (typeof value !== "string" || !LANGUAGE_ID.test(value)) throw new TypeError(`invalid language id: ${value}`);
  return value;
}

export function staticLanguagePackPath(language) {
  return `language/${assertLanguage(language)}.zip`;
}

function assertTargetPath(value, game) {
  const prefix = `/thcrap/${game}/`;
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 240 || value.includes("\\")) {
    throw new TypeError(`invalid thcrap target path: ${value}`);
  }
  const parts = value.slice(1).split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new TypeError(`invalid thcrap target path: ${value}`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceRevision(pack) {
  const assets = Array.isArray(pack?.assets) ? pack.assets : [];
  return sha256(Buffer.from(JSON.stringify(assets.map(asset => [asset.path, asset.crc32])))).slice(0, 24);
}

export function createStaticThcrapPack({ pack, resources }) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new TypeError("thcrap pack is required");
  const game = assertGame(pack.game);
  const language = assertLanguage(pack.language);
  if (!Array.isArray(resources) || resources.length > MAX_FILES) throw new TypeError("invalid processed thcrap resources");

  const files = [];
  const entries = new Map();
  for (const resource of resources) {
    const targetPath = assertTargetPath(resource?.targetPath || resource?.mountPath, game);
    const bytes = assertBytes(resource?.bytes, `${targetPath} bytes`);
    if (entries.has(targetPath)) throw new Error(`duplicate thcrap target path: ${targetPath}`);
    const entryName = targetPath.slice(1);
    entries.set(entryName, bytes);
    files.push({
      path: targetPath,
      sourcePath: typeof resource.sourcePath === "string" ? resource.sourcePath : resource.path,
      format: typeof resource.format === "string" ? resource.format : "binary",
      bytes: bytes.length
    });
    if (entryName === "manifest.json") throw new Error("thcrap resource cannot replace pack manifest");
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    schema: "eagler-touhou/thcrap-static-pack/1",
    game,
    language,
    title: typeof pack.title === "string" && pack.title ? pack.title : language,
    runtimeVersion: "independent",
    sourceRevision: sourceRevision(pack),
    dependencies: Array.isArray(pack.dependencies) ? pack.dependencies.filter(value => typeof value === "string") : [],
    files
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  entries.set("manifest.json", manifestBytes);

  const orderedEntries = {};
  for (const [path, bytes] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    orderedEntries[path] = bytes;
  }
  const archive = zipSync(orderedEntries, { level: 6, mtime: new Date("1980-01-01T00:00:00Z") });
  const digest = sha256(archive);
  const fileName = `${language}.zip`;
  return Object.freeze({
    archive,
    sha256: digest,
    fileName,
    manifest,
    catalog: {
      id: language,
      title: manifest.title,
      pack: {
        url: staticLanguagePackPath(language),
        bytes: archive.length,
        sha256: digest,
        runtimeVersion: manifest.runtimeVersion,
        files: files.length
      }
    }
  });
}
