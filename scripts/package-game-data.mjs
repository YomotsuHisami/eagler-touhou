import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { GAME_DATA_PACK_SCHEMA } from "../game-data-import.mjs";
import { extractGameDataLayout } from "./game-data-layout.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const game = process.argv[2];
if (!/^(?:th06|th07)$/.test(game || "")) throw new Error("usage: node scripts/package-game-data.mjs th06|th07 [output.zip]");

const games = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
const descriptor = games.games?.[game]?.gameData;
const runtime = games.games?.[game]?.runtime;
if (!descriptor || typeof runtime !== "string") throw new Error(`${game}: missing gameData/runtime manifest`);
if (!/^sha256-[a-f0-9]{64}$/i.test(descriptor.layout || "")) throw new Error(`${game}: missing game-data layout identity`);
const runtimePath = runtime.split("?", 1)[0];
const dataPath = resolve(project, dirname(runtimePath), descriptor.path);
const runtimeScriptPath = resolve(project, dirname(runtimePath), `${game}.js`);
const runtimeLayout = extractGameDataLayout(await readFile(runtimeScriptPath, "utf8"), game);
if (runtimeLayout.layout !== descriptor.layout || runtimeLayout.bytes !== descriptor.bytes) {
  throw new Error(`${game}: games.json game-data layout does not match the current Emscripten loader`);
}
const data = await readFile(dataPath);
const sha256 = createHash("sha256").update(data).digest("hex");
if (data.length !== descriptor.bytes || sha256 !== descriptor.sha256 || descriptor.version !== `sha256-${sha256}`) {
  throw new Error(`${game}: build data does not match games.json gameData identity`);
}

const manifest = {
  schema: GAME_DATA_PACK_SCHEMA,
  game,
  version: descriptor.version,
  data: { path: descriptor.path, layout: descriptor.layout, bytes: descriptor.bytes, sha256: descriptor.sha256 }
};
const entries = {
  [descriptor.path]: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
};
const ogg = games.games?.[game]?.music?.ogg;
if (ogg?.files?.length) {
  if (typeof ogg.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(ogg.version) ||
      !Array.isArray(ogg.sizes) || !Array.isArray(ogg.sha256) ||
      ogg.sizes.length !== ogg.files.length || ogg.sha256.length !== ogg.files.length) {
    throw new Error(`${game}: invalid OGG content identity in games.json`);
  }
  const base = resolve(project, ogg.base || "./");
  const musicFiles = [];
  for (let i = 0; i < ogg.files.length; i++) {
    const name = ogg.files[i];
    if (basename(name) !== name || !/^[A-Za-z0-9_.-]+\.ogg$/.test(name)) throw new Error(`${game}: unsafe OGG filename ${name}`);
    const bytes = await readFile(resolve(base, name));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== Number(ogg.sizes[i]) || hash !== String(ogg.sha256[i]).toLowerCase()) {
      throw new Error(`${game}: ${name} does not match games.json OGG identity`);
    }
    entries[name] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    musicFiles.push({ path: name, bytes: bytes.length, sha256: hash });
  }
  manifest.music = { mode: "ogg", version: ogg.version, files: musicFiles };
}
entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
const archive = zipSync(entries, { level: 0 });
const packIdentity = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const output = process.argv[3]
  ? resolve(process.cwd(), process.argv[3])
  : resolve(project, "..", "archive", "temporary", `${game}-game-data-${packIdentity.slice(0, 16)}.zip`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
console.log(JSON.stringify({ game, output, bytes: archive.length, method: "STORE", dataBytes: data.length,
  oggFiles: manifest.music?.files.length || 0, oggBytes: manifest.music?.files.reduce((sum, file) => sum + file.bytes, 0) || 0,
  dataSha256: sha256, packIdentity }));
