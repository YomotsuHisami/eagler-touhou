import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const root = resolve(process.argv[2] || workspace, process.argv[2] ? "" : "dist/eagler-touhou-server");
const deployment = JSON.parse(await readFile(resolve(root, "deployment.json"), "utf8"));
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) throw new Error("invalid deployment manifest");
if (!deployment.files.some(item => item.path === "eagler-touhou/touch-guide.css")) throw new Error("touch guide stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.html")) throw new Error("about page missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.css")) throw new Error("about stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/CHANGELOG.txt")) throw new Error("CHANGELOG.txt missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/assets/th06-card.webp")) throw new Error("TH06 card image missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/assets/th07-card.webp")) throw new Error("TH07 card image missing from deployment");
const inventoryPaths = new Set();
for (const item of deployment.files) {
  if (item.path.includes("..") || item.path.startsWith("/")) throw new Error(`unsafe inventory path: ${item.path}`);
  if (inventoryPaths.has(item.path)) throw new Error(`duplicate inventory path: ${item.path}`);
  inventoryPaths.add(item.path);
  const path = resolve(root, item.path);
  const info = await stat(path);
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!info.isFile() || info.size !== item.bytes || hash !== item.sha256) throw new Error(`inventory mismatch: ${item.path}`);
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files); else files.push(path);
  }
  return files;
}
const actualPaths = new Set((await walk(root))
  .map(path => relative(root, path).replaceAll("\\", "/"))
  .filter(path => path !== "deployment.json"));
for (const path of actualPaths) if (!inventoryPaths.has(path)) throw new Error(`file missing from inventory: ${path}`);
for (const path of inventoryPaths) if (!actualPaths.has(path)) throw new Error(`inventory file missing: ${path}`);

async function verifyHtmlReferences(relativeHtmlPath) {
  const htmlPath = resolve(root, relativeHtmlPath);
  const html = await readFile(htmlPath, "utf8");
  const references = html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  for (const match of references) {
    const value = match[1] ?? match[2] ?? match[3];
    if (!value || /^(?:data:|https?:|mailto:|#)/i.test(value)) continue;
    const pathname = value.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    const target = pathname.startsWith("/")
      ? resolve(root, pathname.slice(1))
      : resolve(dirname(htmlPath), pathname);
    let info;
    try { info = await stat(target); } catch { throw new Error(`missing HTML resource: ${relativeHtmlPath} -> ${value}`); }
    if (!info.isFile() && !info.isDirectory()) throw new Error(`invalid HTML resource: ${relativeHtmlPath} -> ${value}`);
  }
}
for (const htmlPath of [
  "eagler-touhou/index.html", "eagler-touhou/about.html",
  "games/th06/th06.html", "games/th07/th07.html",
]) await verifyHtmlReferences(htmlPath);

const games = JSON.parse(await readFile(resolve(root, "eagler-touhou", "games.json"), "utf8"));
if (games.protocol !== "eagler-touhou/1") throw new Error("invalid host protocol");
for (const key of ["vanillaFont", "unicodeFont"]) {
  if (typeof games.shared?.[key] !== "string" || !games.shared[key].includes("?v=")) throw new Error(`versioned shared ${key} missing`);
  await stat(resolve(root, "eagler-touhou", games.shared[key].split("?")[0]));
}
const sharedFontMounts = Object.values(games.shared).map(value => `/${basename(new URL(value, "https://eagler.invalid/eagler-touhou/").pathname)}`);
const hostApp = await readFile(resolve(root, "eagler-touhou", "app.js"), "utf8");
for (const mount of sharedFontMounts) {
  if (!hostApp.includes(`path: "${mount}"`)) throw new Error(`host shared font mount mismatch: ${mount}`);
}
for (const game of ["th06", "th07"]) {
  const entry = games.games?.[game];
  if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) throw new Error(`invalid game entry: ${game}`);
  const runtimeVersion = new URL(entry.runtime, "https://eagler.invalid/eagler-touhou/").searchParams.get("v");
  const runtimeHtml = await readFile(resolve(root, "games", game, `${game}.html`), "utf8");
  const runtimeScript = await readFile(resolve(root, "games", game, `${game}.js`), "utf8");
  if (!runtimeHtml.includes("invalid shared resource")) throw new Error(`runtime shared resource validation missing: ${game}`);
  for (const mount of sharedFontMounts) {
    if (!runtimeHtml.includes(`"${mount}"`) && !runtimeHtml.includes(`'${mount}'`)) {
      throw new Error(`runtime shared font mount mismatch: ${game} -> ${mount}`);
    }
  }
  const versionedScript = new RegExp(`<script\\b[^>]*\\bsrc=["']?${game}\\.js\\?v=${runtimeVersion}(?:["'\\s>])`, "i");
  if (!runtimeVersion || !versionedScript.test(runtimeHtml)) throw new Error(`unversioned runtime script: ${game}`);
  if (!/package_uuid:\s*["'][^"']+-[0-9a-f]{16}["']/.test(runtimeScript)) throw new Error(`unversioned runtime data cache: ${game}`);
  for (const extension of ["html", "js", "wasm", "data"]) await stat(resolve(root, "games", game, `${game}.${extension}`));
  for (const [mode, pack] of Object.entries(entry.music)) {
    if (!Array.isArray(pack.files)) throw new Error(`invalid ${game}/${mode} pack`);
    if (mode !== "midi" && (typeof pack.version !== "string" || pack.version.length < 8)) throw new Error(`unversioned ${game}/${mode} pack`);
    for (const file of pack.files) await stat(resolve(root, "eagler-touhou", pack.base, file));
  }
  if (entry.languages) {
    if (!Array.isArray(entry.languages)) throw new Error(`invalid ${game.toUpperCase()} language catalog`);
    for (const language of entry.languages) {
      if (typeof language?.id !== "string" || !language.pack?.url || !/^[a-f0-9]{16,64}$/i.test(language.pack.sha256 || "") ||
          !Number.isInteger(language.pack.bytes) || language.pack.runtimeVersion !== runtimeVersion) {
        throw new Error(`invalid ${game.toUpperCase()} language pack: ${language?.id}`);
      }
      const url = new URL(language.pack.url, new URL("eagler-touhou/", "https://eagler.invalid/"));
      const path = url.pathname.slice("/".length);
      const entryInfo = deployment.files.find(item => item.path === path);
      if (!entryInfo || entryInfo.bytes !== language.pack.bytes || entryInfo.sha256 !== language.pack.sha256) {
        throw new Error(`${game.toUpperCase()} language pack inventory mismatch: ${language.id}`);
      }
    }
  }
  if (!Array.isArray(entry.languageOptions) || entry.languageOptions.length === 0) throw new Error(`missing ${game.toUpperCase()} selectable language list`);
  const selectableIds = new Set();
  for (const language of entry.languageOptions) {
    if (typeof language?.id !== "string" || selectableIds.has(language.id)) throw new Error(`invalid ${game.toUpperCase()} selectable language: ${language?.id}`);
    selectableIds.add(language.id);
    if (language.id === "ja") {
      if (language.pack != null) throw new Error(`${game.toUpperCase()} built-in Japanese must not have a download pack`);
      continue;
    }
    const packaged = entry.languages?.find(item => item.id === language.id);
    if (!packaged || packaged.pack?.sha256 !== language.pack?.sha256) throw new Error(`${game.toUpperCase()} selectable language was not packaged: ${language.id}`);
  }
  if (typeof entry.features?.thprac !== "boolean") throw new Error(`missing ${game.toUpperCase()} thprac capability`);
}
console.log(JSON.stringify({ valid: true, files: deployment.files.length, music: deployment.music }));
