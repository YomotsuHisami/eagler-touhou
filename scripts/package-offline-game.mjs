import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { OFFLINE_GAME_PACK_SCHEMA } from "../game-data-import.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const site = resolve(process.argv[2] || "");
const game = String(process.argv[3] || "").toLowerCase();
if (!process.argv[2] || !/^(?:th06|th07)$/.test(game)) {
  throw new Error("usage: node scripts/package-offline-game.mjs <production-site-root> th06|th07 [output.zip]");
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const addEntry = (entries, path, bytes) => {
  if (entries[path]) throw new Error(`duplicate offline ZIP entry: ${path}`);
  entries[path] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const identity = bytes => ({ bytes: bytes.length, sha256: sha256(bytes) });
const sitePathFromUrl = value => {
  const url = new URL(value, "https://offline.invalid/eagler-touhou/");
  if (url.origin !== "https://offline.invalid" || !url.pathname.startsWith("/")) throw new Error(`invalid production asset URL: ${value}`);
  return resolve(site, `.${url.pathname}`);
};

const productionManifest = JSON.parse(await readFile(resolve(site, "eagler-touhou", "games.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
const production = productionManifest.games?.[game];
const source = sourceManifest.games?.[game];
if (!production?.runtime || !production?.gameData || !source?.music?.ogg) throw new Error(`${game}: incomplete production/source manifest`);

const runtimeUrl = new URL(production.runtime, "https://offline.invalid/eagler-touhou/");
const runtimeVersion = runtimeUrl.searchParams.get("v") || "";
if (!/^[a-f0-9]{16}$/i.test(runtimeVersion)) throw new Error(`${game}: invalid production runtime version`);
const runtimeDir = dirname(sitePathFromUrl(production.runtime));
const runtimeFiles = [];
const entries = {};
for (const role of ["html", "js", "wasm"]) {
  const sourcePath = resolve(runtimeDir, `${game}.${role}`);
  const bytes = await readFile(sourcePath);
  const path = `offline/runtime/${game}.${role}`;
  addEntry(entries, path, bytes);
  runtimeFiles.push({ role, path, ...identity(bytes) });
}

const dataPath = resolve(runtimeDir, production.gameData.path);
const data = await readFile(dataPath);
const dataIdentity = identity(data);
if (dataIdentity.bytes !== production.gameData.bytes || dataIdentity.sha256 !== String(production.gameData.sha256).toLowerCase() ||
    production.gameData.version !== `sha256-${dataIdentity.sha256}`) {
  throw new Error(`${game}: production DATA identity mismatch`);
}
addEntry(entries, production.gameData.path, data);

const shared = [];
for (const [target, field, outputName] of [
  ["/msgothic.ttc", "vanillaFont", "msgothic.ttc"],
  ["/unifont.otf", "unicodeFont", "unifont.otf"],
]) {
  const value = productionManifest.shared?.[field];
  if (typeof value !== "string") throw new Error(`${game}: missing production ${field}`);
  const bytes = await readFile(sitePathFromUrl(value));
  const path = `offline/shared/${outputName}`;
  addEntry(entries, path, bytes);
  shared.push({ target, path, ...identity(bytes) });
}

const languages = [];
for (const language of production.languageOptions || []) {
  if (language?.id === "ja" || !language?.pack) continue;
  const pack = language.pack;
  if (pack.runtimeVersion !== runtimeVersion || typeof pack.url !== "string" || !Number.isInteger(pack.bytes) ||
      !/^[a-f0-9]{64}$/i.test(pack.sha256 || "")) throw new Error(`${game}: invalid production language pack ${language?.id}`);
  const bytes = await readFile(sitePathFromUrl(pack.url));
  const hash = sha256(bytes);
  if (bytes.length !== pack.bytes || hash !== pack.sha256.toLowerCase()) throw new Error(`${game}: language pack identity mismatch ${language.id}`);
  const path = `offline/languages/${language.id}.zip`;
  addEntry(entries, path, bytes);
  languages.push({ id: language.id, title: language.title || language.id, path, bytes: bytes.length, sha256: hash,
    runtimeVersion, files: Number.isInteger(pack.files) ? pack.files : undefined });
}

const ogg = source.music.ogg;
if (typeof ogg.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(ogg.version) || !Array.isArray(ogg.files) ||
    !Array.isArray(ogg.sizes) || !Array.isArray(ogg.sha256) || ogg.files.length !== ogg.sizes.length || ogg.files.length !== ogg.sha256.length) {
  throw new Error(`${game}: invalid source OGG identity`);
}
const oggBase = resolve(project, ogg.base || "./");
const musicFiles = [];
for (let i = 0; i < ogg.files.length; i++) {
  const name = ogg.files[i];
  if (basename(name) !== name || !/^[A-Za-z0-9_.-]+\.ogg$/.test(name)) throw new Error(`${game}: unsafe OGG filename ${name}`);
  const bytes = await readFile(resolve(oggBase, name));
  const hash = sha256(bytes);
  if (bytes.length !== Number(ogg.sizes[i]) || hash !== String(ogg.sha256[i]).toLowerCase()) throw new Error(`${game}: OGG identity mismatch ${name}`);
  addEntry(entries, name, bytes);
  musicFiles.push({ path: name, bytes: bytes.length, sha256: hash });
}

const manifest = {
  schema: OFFLINE_GAME_PACK_SCHEMA,
  game,
  version: production.gameData.version,
  data: { path: production.gameData.path, layout: production.gameData.layout, bytes: data.length, sha256: dataIdentity.sha256 },
  music: { mode: "ogg", version: ogg.version, files: musicFiles },
  offline: {
    runtime: { version: runtimeVersion, files: runtimeFiles },
    shared,
    languages
  }
};
entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

const archive = zipSync(entries, { level: 0 });
const packIdentity = sha256(Buffer.from(JSON.stringify(manifest), "utf8"));
const output = process.argv[4]
  ? resolve(process.cwd(), process.argv[4])
  : resolve(workspace, "archive", "temporary", `${game}-offline-${packIdentity.slice(0, 16)}.zip`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
console.log(JSON.stringify({ game, output, bytes: archive.length, method: "STORE", schema: manifest.schema,
  runtimeVersion, dataBytes: data.length, oggFiles: musicFiles.length, languages: languages.map(item => item.id),
  shared: shared.map(item => item.target), packIdentity }));
