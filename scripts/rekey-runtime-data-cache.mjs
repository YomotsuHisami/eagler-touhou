import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(process.argv[2] || "");
const game = process.argv[3];
if (!root || !["th06", "th07"].includes(game)) {
  throw new Error("usage: node scripts/rekey-runtime-data-cache.mjs DEPLOYMENT_ROOT th06|th07");
}

const gameRoot = resolve(root, "games", game);
const scriptPath = resolve(gameRoot, `${game}.js`);
const htmlPath = resolve(gameRoot, `${game}.html`);
const dataPath = resolve(gameRoot, `${game}.data`);
const wasmPath = resolve(gameRoot, `${game}.wasm`);
const token = createHash("sha256")
  .update(await readFile(scriptPath))
  .update(await readFile(dataPath))
  .update(String(Date.now()))
  .digest("hex").slice(0, 16);

let script = await readFile(scriptPath, "utf8");
const uuidPattern = /(package_uuid:\s*["'])([^"']+)(["'])/;
if (!uuidPattern.test(script)) throw new Error(`${game}: package_uuid missing`);
script = script.replace(uuidPattern, `$1$2-rekey-${token}$3`);
await writeFile(scriptPath, script);

const runtimeVersion = createHash("sha256")
  .update(await readFile(scriptPath))
  .update(await readFile(wasmPath))
  .update(await readFile(dataPath))
  .digest("hex").slice(0, 16);
let html = await readFile(htmlPath, "utf8");
const scriptPattern = new RegExp(`(<script\\b[^>]*\\bsrc=)(["']?)${game}\\.js(?:\\?[^"'\\s>]*)?\\2`, "i");
if (!scriptPattern.test(html)) throw new Error(`${game}: runtime script reference missing`);
html = html.replace(scriptPattern, `$1$2${game}.js?v=${runtimeVersion}$2`);
await writeFile(htmlPath, html);

const gamesPath = resolve(root, "eagler-touhou", "games.json");
const games = JSON.parse(await readFile(gamesPath, "utf8"));
games.games[game].runtime = `../games/${game}/${game}.html?hosted=1&v=${runtimeVersion}`;
await writeFile(gamesPath, `${JSON.stringify(games, null, 2)}\n`);

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files); else if (relative(root, path).replaceAll("\\", "/") !== "deployment.json") files.push(path);
  }
  return files;
}
const oldDeployment = JSON.parse(await readFile(resolve(root, "deployment.json"), "utf8"));
const inventory = [];
for (const path of (await walk(root)).sort()) {
  const bytes = await readFile(path);
  inventory.push({ path: relative(root, path).replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const deployment = { ...oldDeployment, generatedAt: new Date().toISOString(), files: inventory };
await writeFile(resolve(root, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify({ root, game, runtimeVersion, files: inventory.length }));
