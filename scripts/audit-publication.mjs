import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const forbiddenExtensions = new Set([".dat", ".data", ".wav", ".ogg", ".mid", ".midi", ".rpy", ".ttc"]);
const publicArtwork = new Set([
  "assets/th06-card.webp", "assets/th07-card.webp",
  "assets/th06-title00.jpg", "assets/th07-title00.jpg",
  "assets/touch-rotate-landscape.webp",
  "assets/th06.ico",
  "assets/notice-bilibili.svg", "assets/notice-touhou-cloud.png",
  "assets/fonts/touhou98.woff2",
  "assets/fonts/unifont-site.woff2",
  "assets/fonts/noto-serif-sc-touhou.woff2", "assets/fonts/OFL-NotoSerifSC.txt",
  "assets/fonts/yatra-one-latin.woff2", "assets/fonts/chill-round-gothic-site-medium.woff2", "assets/fonts/chill-round-gothic-site-bold.woff2", "assets/fonts/chill-round-gothic-site-heavy.woff2",
  "assets/fonts/OFL-YatraOne.txt", "assets/fonts/OFL-ChillRoundGothic.txt",
  "assets/fonts/NotoSansCJKsc-Regular.otf", "assets/fonts/OFL-NotoSansCJK.txt"
]);
const failures = [];
const runtimeBuildScript = await readFile(resolve(project, "scripts/Build-eagler-runtimes.ps1"), "utf8");
const readme = await readFile(resolve(project, "README.md"), "utf8");
if (!runtimeBuildScript.includes("build-web-eagler-external") ||
    !runtimeBuildScript.includes("build-web-eagler-default") ||
    !runtimeBuildScript.includes("EmbedLocalAssets")) {
  failures.push("runtime build modes are not isolated");
}
if (/build-web-eagler-default[\s\S]{0,800}TH_EXTERNAL_ASSETS=ON/.test(runtimeBuildScript)) {
  failures.push("source-only runtime build can overwrite the playable development build");
}
if (!readme.includes("故障排查：声音和输入初始化后游戏立即退出") ||
    !readme.includes("DirectSound、DirectInput") ||
    !readme.includes("不得在同一 CMake 构建目录中切换 `TH_EXTERNAL_ASSETS`")) {
  failures.push("missing external-assets failure and recovery documentation");
}
for (const repo of ["th06-eagler", "th07-eagler"]) {
  const root = resolve(workspace, repo);
  if (!existsSync(resolve(root, ".git"))) continue;
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of tracked) {
    if (forbiddenExtensions.has(extname(file).toLowerCase()) || /(^|\/)assets(?:-ogg)?\//i.test(file)) failures.push(`${repo}/${file}`);
  }
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".npm-cache", ".deploy-python", "design", "screenshots"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const rel = relative(project, path).replaceAll("\\", "/");
      if (rel.startsWith("assets/") && !publicArtwork.has(rel)) failures.push(`eagler-touhou/${rel} (unreviewed public artwork)`);
      if (forbiddenExtensions.has(extname(rel).toLowerCase())) failures.push(`eagler-touhou/${rel}`);
      if ((await stat(path)).size > 50 * 1024 * 1024) failures.push(`eagler-touhou/${rel} (>50 MiB)`);
    }
  }
}
await walk(project);
if (failures.length) throw new Error(`publication contains private/generated resources:\n${failures.join("\n")}`);
console.log(JSON.stringify({ safe: true, checked: ["eagler-touhou", "th06-eagler tracked files", "th07-eagler tracked files"] }));
