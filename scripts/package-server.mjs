import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf("=");
  if (!value.startsWith("--") || split < 3) throw new Error(`invalid argument: ${value}`);
  return [value.slice(2, split), value.slice(split + 1)];
}));
const required = name => {
  if (!args[name]) throw new Error(`missing --${name}=PATH`);
  return resolve(args[name]);
};
const output = required("output");
const staging = `${output}.staging`;
const workspace = resolve(project, "..");
if (output === project || output === workspace || output === resolve(output, "..")) {
  throw new Error(`unsafe output directory: ${output}`);
}
const builds = { th06: required("th06-build"), th07: required("th07-build") };
const assets = { th06: required("th06-assets"), th07: required("th07-assets") };
const font = required("font");
const ogg = { th06: args["th06-ogg"] && resolve(args["th06-ogg"]), th07: args["th07-ogg"] && resolve(args["th07-ogg"]) };
const modes = new Set((args.music || "midi,ogg").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
for (const mode of modes) if (!["midi", "wav", "ogg"].includes(mode)) throw new Error(`unsupported music mode: ${mode}`);
modes.add("midi");

async function copyFrontend() {
  const frontend = resolve(staging, "eagler-touhou");
  await mkdir(frontend, { recursive: true });
  for (const name of ["index.html", "about.html", "about.css", "styles.css", "touch-guide.css", "app.js", "README.md", "ASSETS.md", "THIRD_PARTY.md"]) {
    await cp(resolve(project, name), resolve(frontend, name));
  }
  await cp(resolve(project, "vendor"), resolve(frontend, "vendor"), { recursive: true });
  const publicAssets = [
    "th06-title00.jpg", "th07-title00.jpg",
    "fonts/noto-serif-sc-touhou.woff2", "fonts/OFL-NotoSerifSC.txt",
  ];
  for (const name of publicAssets) {
    const target = resolve(frontend, "assets", name);
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(resolve(project, "assets", name), target);
  }
}

async function copyFiles(sourceBase, targetBase, files) {
  await mkdir(targetBase, { recursive: true });
  for (const file of files) {
    const source = resolve(sourceBase, file);
    const info = await stat(source);
    if (!info.isFile() || !info.size) throw new Error(`missing or empty resource: ${source}`);
    await cp(source, resolve(targetBase, basename(file)));
  }
}

async function versionFiles(sourceBase, files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(resolve(sourceBase, file)));
  return hash.digest("hex").slice(0, 16);
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files); else files.push(path);
  }
  return files;
}

await rm(staging, { recursive: true, force: true });
await copyFrontend();
const manifest = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
await mkdir(resolve(staging, "shared"), { recursive: true });
await cp(font, resolve(staging, "shared", "msgothic.ttc"));
manifest.shared = { font: `../shared/msgothic.ttc?v=${await versionFiles(resolve(font, ".."), [basename(font)])}` };

for (const game of ["th06", "th07"]) {
  const gameRoot = resolve(staging, "games", game);
  await mkdir(gameRoot, { recursive: true });
  const runtimeFiles = ["html", "js", "wasm", "data"].map(extension => `${game}.${extension}`);
  for (const extension of ["html", "js", "wasm", "data"]) {
    await cp(resolve(builds[game], `${game}.${extension}`), resolve(gameRoot, `${game}.${extension}`));
  }
  const entry = manifest.games[game];
  const runtimeVersion = await versionFiles(builds[game], runtimeFiles);
  entry.runtime = `../games/${game}/${game}.html?hosted=1&v=${runtimeVersion}`;
  for (const mode of ["wav", "ogg"]) {
    if (!modes.has(mode)) {
      delete entry.music[mode];
      continue;
    }
    const pack = entry.music[mode];
    const sourceBase = mode === "wav"
      ? (game === "th06" ? resolve(assets.th06, "bgm") : assets.th07)
      : (game === "th06" ? resolve(ogg.th06, "bgm") : resolve(ogg.th07, "bgm-ogg"));
    const targetBase = resolve(gameRoot, "music", mode);
    await copyFiles(sourceBase, targetBase, pack.files);
    pack.base = `../games/${game}/music/${mode}/`;
    pack.version = await versionFiles(sourceBase, pack.files);
    pack.sizes = await Promise.all(pack.files.map(async file => (await stat(resolve(sourceBase, file))).size));
  }
}
await writeFile(resolve(staging, "eagler-touhou", "games.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const inventory = [];
for (const path of (await walk(staging)).sort()) {
  const bytes = await readFile(path);
  inventory.push({
    path: relative(staging, path).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const deployment = {
  format: "eagler-touhou-deployment/1",
  generatedAt: new Date().toISOString(),
  music: [...modes].sort(),
  files: inventory,
};
await writeFile(resolve(staging, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(JSON.stringify({ output, files: inventory.length + 1, bytes: inventory.reduce((sum, file) => sum + file.bytes, 0), music: deployment.music }));
