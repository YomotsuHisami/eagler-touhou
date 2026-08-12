import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const root = resolve(process.argv[2] || workspace, process.argv[2] ? "" : "dist/eagler-touhou-server");
const deployment = JSON.parse(await readFile(resolve(root, "deployment.json"), "utf8"));
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) throw new Error("invalid deployment manifest");
if (!deployment.files.some(item => item.path === "eagler-touhou/touch-guide.css")) throw new Error("touch guide stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.html")) throw new Error("about page missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.css")) throw new Error("about stylesheet missing from deployment");
for (const item of deployment.files) {
  if (item.path.includes("..") || item.path.startsWith("/")) throw new Error(`unsafe inventory path: ${item.path}`);
  const path = resolve(root, item.path);
  const info = await stat(path);
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!info.isFile() || info.size !== item.bytes || hash !== item.sha256) throw new Error(`inventory mismatch: ${item.path}`);
}
const games = JSON.parse(await readFile(resolve(root, "eagler-touhou", "games.json"), "utf8"));
if (games.protocol !== "eagler-touhou/1") throw new Error("invalid host protocol");
if (typeof games.shared?.font !== "string" || !games.shared.font.includes("?v=")) throw new Error("versioned shared font missing");
await stat(resolve(root, "eagler-touhou", games.shared.font.split("?")[0]));
for (const game of ["th06", "th07"]) {
  const entry = games.games?.[game];
  if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) throw new Error(`invalid game entry: ${game}`);
  for (const extension of ["html", "js", "wasm", "data"]) await stat(resolve(root, "games", game, `${game}.${extension}`));
  for (const [mode, pack] of Object.entries(entry.music)) {
    if (!Array.isArray(pack.files)) throw new Error(`invalid ${game}/${mode} pack`);
    if (mode !== "midi" && (typeof pack.version !== "string" || pack.version.length < 8)) throw new Error(`unversioned ${game}/${mode} pack`);
    for (const file of pack.files) await stat(resolve(root, "eagler-touhou", pack.base, file));
  }
}
console.log(JSON.stringify({ valid: true, files: deployment.files.length, music: deployment.music }));
