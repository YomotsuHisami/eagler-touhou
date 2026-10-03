import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const directoryArgument = args.find(value => value.startsWith("--directory="));
const workspaceAudit = args.includes("--workspace");
if (args.some(value => value !== "--workspace" && !value.startsWith("--directory=")) ||
    args.filter(value => value.startsWith("--directory=")).length > 1 ||
    (directoryArgument && workspaceAudit)) {
  throw new Error("usage: node scripts/audit-publication.mjs [--workspace | --directory=SOURCE_EXPORT]");
}
const project = directoryArgument ? resolve(directoryArgument.slice("--directory=".length))
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const forbiddenExtensions = new Set([".dat", ".data", ".wav", ".ogg", ".mid", ".midi", ".rpy", ".ttc"]);
const publicAssets = new Set([
  "assets/character-art.css", "assets/dairi/manifest.json", "assets/dairi/CREDITS.txt",
  "assets/dairi/reimu.png",
  "assets/dairi/marisa.png",
  "assets/dairi/sakuya.png",
  "assets/dairi/youmu.png",
  "assets/dairi/yukari.png",
  "assets/dairi/alice.png",
  "assets/dairi/remilia.png",
  "assets/dairi/yuyuko.png",
  "assets/dairi/reisen.png",
  "assets/dairi/cirno.png",
  "assets/dairi/lyrica.png",
  "assets/dairi/merlin.png",
  "assets/dairi/lunasa.png",
  "assets/dairi/mystia.png",
  "assets/dairi/tewi.png",
  "assets/dairi/aya.png",
  "assets/dairi/medicine.png",
  "assets/dairi/yuuka.png",
  "assets/dairi/komachi.png",
  "assets/dairi/eiki.png",

  "assets/score-character-sheet-CREDITS.txt", "assets/score-format-LICENSE.txt",
  "assets/room-caret-left.svg", "assets/room-caret-right.svg",
  "assets/room-chart-bar.svg", "assets/room-copy.svg", "assets/room-gear-six.svg",
  "assets/room-icons-LICENSE.txt", "assets/room-sliders-horizontal.svg", "assets/room-users.svg",
  "assets/launcher-background.webp",
  "assets/donation.webp",
  "assets/touch-rotate-landscape.webp",
  "assets/notice-bilibili.svg",
  "assets/notice-touhou-cloud.png",
  "assets/notice-github.svg", "assets/notice-qq.svg",
  // Repository-owned Phosphor room controls; the MIT notice ships with them.
  "assets/room-caret-left.svg", "assets/room-caret-right.svg",
  "assets/room-chart-bar.svg", "assets/room-copy.svg",
  "assets/room-gear-six.svg", "assets/room-sliders-horizontal.svg",
  "assets/room-users.svg", "assets/room-icons-LICENSE.txt",
  "assets/fonts/touhou98.woff2",
  "assets/fonts/unifont-site.woff2",
  "assets/fonts/OFL-Unifont.txt",
  "assets/fonts/yatra-one-latin.woff2", "assets/fonts/chill-round-gothic-site-medium.woff2", "assets/fonts/chill-round-gothic-site-bold.woff2", "assets/fonts/chill-round-gothic-site-heavy.woff2",
  "assets/fonts/chill-round-gothic-site-medium-critical.woff2", "assets/fonts/chill-round-gothic-site-medium-deferred.woff2",
  "assets/fonts/chill-round-gothic-site-bold-critical.woff2", "assets/fonts/chill-round-gothic-site-bold-deferred.woff2",
  "assets/fonts/OFL-YatraOne.txt", "assets/fonts/OFL-ChillRoundGothic.txt",
  "assets/fonts/NotoSansCJKsc-Regular.otf", "assets/fonts/OFL-NotoSansCJK.txt"
]);
const legacyHostGeneratedOriginalAssets = new Set([
  // Legacy/intermediate names remain forbidden too. They are useful as a
  // guard against accidentally copying extraction staging back into source.
  "assets/th06-title00.jpg",
  "assets/th07-title00.jpg",
  "assets/th08-title00.png",
  "assets/th06.ico",
  "assets/pwa/icon-192.png",
  "assets/pwa/icon-512.png",
  "assets/pwa/icon-maskable-512.png",
  "assets/pwa/apple-touch-icon.png",
]);
function isHostGeneratedOriginalAsset(path) {
  // Card artwork is host-generated from retail content for every formal title.
  // Keep this rule product-neutral so adding a title does not require teaching
  // the publication safety audit another game id.
  return /^assets\/th\d{2}-card\.webp$/i.test(path) || legacyHostGeneratedOriginalAssets.has(path);
}
const failures = [];
let workspaceChecked = null;
if (workspaceAudit) {
  const { PRODUCT_GAMES } = await import("../lib/contracts/product-catalog.mjs");
  const { WORKSPACE_REPOSITORIES, workspacePath } = await import("../lib/workspace-layout.mjs");
  const gameOwners = Object.keys(PRODUCT_GAMES);
  workspaceChecked = [
    WORKSPACE_REPOSITORIES.launcher,
    ...gameOwners.map(owner => `${WORKSPACE_REPOSITORIES[owner]} tracked files`),
  ];
  for (const owner of gameOwners) {
    const repo = WORKSPACE_REPOSITORIES[owner];
    const root = workspacePath(owner);
    if (!existsSync(resolve(root, ".git"))) throw new Error(`workspace publication audit requires sibling repository: ${repo}`);
    const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of tracked) {
      if (forbiddenExtensions.has(extname(file).toLowerCase()) || /(^|\/)assets(?:-ogg)?\//i.test(file)) failures.push(`${repo}/${file}`);
    }
  }
}
async function inspect(path) {
  const rel = relative(project, path).replaceAll("\\", "/");
  if (/^private-assets\/dairi(?:\/|$)/.test(rel)) failures.push(`eagler-touhou/${rel} (local DAIRI artwork must not be redistributed)`);
  const publicRel = rel.startsWith("public/") ? rel.slice("public/".length) : rel;
  if (isHostGeneratedOriginalAsset(publicRel)) failures.push(`eagler-touhou/${rel} (original-game-derived host asset must not be source-published)`);
  else if (publicRel.startsWith("assets/") && !publicAssets.has(publicRel)) failures.push(`eagler-touhou/${rel} (unreviewed public asset)`);
  if (forbiddenExtensions.has(extname(rel).toLowerCase())) failures.push(`eagler-touhou/${rel}`);
  if ((await stat(path)).size > 50 * 1024 * 1024) failures.push(`eagler-touhou/${rel} (>50 MiB)`);
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".cache", ".npm-cache", ".deploy-python", "design", "screenshots"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else await inspect(path);
  }
}
if (!directoryArgument && existsSync(resolve(project, ".git"))) {
  // Source publication candidates are tracked + nonignored new source, not
  // private local validation outputs. Force-added ignored assets remain tracked
  // and therefore still fail. A concrete export is audited with --directory.
  const files = new Set(execFileSync("git", ["-C", project, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {encoding:"utf8"}).split("\0").filter(Boolean));
  for (const asset of publicAssets) {
    const sourcePath = `public/${asset}`;
    if (existsSync(resolve(project, sourcePath))) files.add(sourcePath);
  }
  for (const file of files) if (existsSync(resolve(project, file)) && (await stat(resolve(project, file))).isFile()) {
    await inspect(resolve(project, file));
  }
} else await walk(project);
if (failures.length) throw new Error(`publication contains private/generated resources:\n${failures.join("\n")}`);
console.log(JSON.stringify({ safe: true, scope: directoryArgument ? "explicit-source-export" : "git-source-candidates",
  checked: workspaceChecked || ["eagler-touhou"] }));
