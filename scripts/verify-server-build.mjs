import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGameDataLayout } from "./game-data-layout.mjs";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const root = resolve(process.argv[2] || workspace, process.argv[2] ? "" : "dist/eagler-touhou-server");
const deployment = JSON.parse(await readFile(resolve(root, "deployment.json"), "utf8"));
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) throw new Error("invalid deployment manifest");
const resourceMode = deployment.resourceMode || "hosted";
if (!["hosted", "import-only"].includes(resourceMode)) throw new Error("invalid deployment resourceMode");
if (!deployment.files.some(item => item.path === "eagler-touhou/touch-guide.css")) throw new Error("touch guide stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/migrate.html")) throw new Error("origin migration page missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.html")) throw new Error("about page missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/faq.html")) throw new Error("FAQ page missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/about.css")) throw new Error("about stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "eagler-touhou/CHANGELOG.txt")) throw new Error("CHANGELOG.txt missing from deployment");
for (const font of ["yatra-one-latin.woff2", "chill-round-gothic-site-medium.woff2", "chill-round-gothic-site-bold.woff2", "chill-round-gothic-site-heavy.woff2"]) {
  if (!deployment.files.some(item => item.path === `eagler-touhou/assets/fonts/${font}`)) throw new Error(`UI font missing from deployment: ${font}`);
}
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

const migrationHtml = await readFile(resolve(root, "eagler-touhou", "migrate.html"), "utf8");
if (!migrationHtml.includes('const PROTOCOL = "eagler-touhou/origin-migration/1";') ||
    !migrationHtml.includes('source.protocol = "http:";') ||
    !migrationHtml.includes('openHttp.onclick = () => {') ||
    !migrationHtml.includes('location.href = sourceLink.href;') ||
    !migrationHtml.includes('heading = "旧站迁移"')) {
  throw new Error("origin migration page is missing the HTTPS -> HTTP migration entry contract");
}
if (/<script\b[^>]+src=/i.test(migrationHtml) || /<link\b[^>]+stylesheet/i.test(migrationHtml)) {
  throw new Error("origin migration page must remain self-contained");
}

async function verifyHtmlReferences(relativeHtmlPath) {
  const htmlPath = resolve(root, relativeHtmlPath);
  const html = await readFile(htmlPath, "utf8");
  for (const tagMatch of html.matchAll(/<[^>]+>/g)) {
    for (const match of tagMatch[0].matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
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
}
const htmlPaths = ["eagler-touhou/index.html", "eagler-touhou/migrate.html", "eagler-touhou/about.html", "eagler-touhou/faq.html"];
if (resourceMode === "hosted") htmlPaths.push("games/th06/th06.html", "games/th07/th07.html");
for (const htmlPath of htmlPaths) await verifyHtmlReferences(htmlPath);

const games = JSON.parse(await readFile(resolve(root, "eagler-touhou", "games.json"), "utf8"));
if (games.protocol !== "eagler-touhou/1") throw new Error("invalid host protocol");
if ((games.shared?.resourceMode || "hosted") !== resourceMode) throw new Error("host/deployment resourceMode mismatch");
if (resourceMode === "hosted") {
  for (const key of ["vanillaFont", "unicodeFont"]) {
    if (typeof games.shared?.[key] !== "string" || !games.shared[key].includes("?v=")) throw new Error(`versioned shared ${key} missing`);
    await stat(resolve(root, "eagler-touhou", games.shared[key].split("?")[0]));
  }
} else {
  if (games.shared?.vanillaFont != null || games.shared?.unicodeFont != null) throw new Error("import-only manifest must not expose runtime font URLs");
  if ([...inventoryPaths].some(path => path.startsWith("games/") || path.startsWith("shared/"))) {
    throw new Error("import-only deployment must not publish game/shared runtime payloads");
  }
}
const fallback = games.shared?.gameDataFallback;
if (fallback != null && (typeof fallback !== "object" || typeof fallback.url !== "string" || !/^https:\/\//.test(fallback.url) ||
    (fallback.hint != null && typeof fallback.hint !== "string"))) {
  throw new Error("invalid optional gameDataFallback in server package");
}
const sharedFontMounts = resourceMode === "hosted"
  ? [games.shared.vanillaFont, games.shared.unicodeFont]
    .map(value => `/${basename(new URL(value, "https://eagler.invalid/eagler-touhou/").pathname)}`)
  : [];
const hostApp = await readFile(resolve(root, "eagler-touhou", "app.js"), "utf8");
const hostIndex = await readFile(resolve(root, "eagler-touhou", "index.html"), "utf8");
if (!/id="originMigrationOpen"[^>]+href="migrate\.html"[^>]+hidden/.test(hostIndex)) {
  throw new Error("HTTPS migration entry missing from main UI");
}
if (!hostApp.includes('originMigrationOpen.hidden = location.protocol !== "https:";')) {
  throw new Error("main UI migration entry is not HTTPS-only");
}
for (const mount of sharedFontMounts) {
  if (!hostApp.includes(`target: "${mount}"`)) throw new Error(`host shared font target mismatch: ${mount}`);
}
for (const game of ["th06", "th07"]) {
  const entry = games.games?.[game];
  if (resourceMode === "import-only") {
    if (!entry?.music?.midi || entry.runtime != null) throw new Error(`invalid import-only game entry: ${game}`);
    if (typeof entry.gameData?.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(entry.gameData.version) ||
        typeof entry.gameData?.layout !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(entry.gameData.layout) ||
        entry.gameData?.path !== `${game}.data` || !Number.isInteger(entry.gameData?.bytes) || entry.gameData.bytes <= 0 ||
        !/^[a-f0-9]{64}$/i.test(entry.gameData?.sha256 || "")) {
      throw new Error(`invalid import-only game data identity: ${game}`);
    }
    const compatibility = entry.offlineCompatibility;
    if (compatibility?.schema !== "eagler-touhou/offline-game-pack/1" ||
        compatibility.runtimeCompatibility?.protocol !== games.protocol ||
        compatibility.runtimeCompatibility?.dataLayout !== entry.gameData.layout ||
        compatibility.runtimeCompatibility?.versionSource !== "offline-pack" ||
        !Array.isArray(compatibility.requiredShared) ||
        !["/msgothic.ttc", "/unifont.otf"].every(target => compatibility.requiredShared.includes(target)) ||
        compatibility.languages?.source !== "offline-pack" ||
        !Array.isArray(compatibility.languages?.baseline) || !compatibility.languages.baseline.includes("ja")) {
      throw new Error(`invalid import-only offline compatibility metadata: ${game}`);
    }
    for (const pack of Object.values(entry.music || {})) {
      if (pack?.base != null) throw new Error(`import-only manifest must not expose music base URL: ${game}`);
    }
    if (!Array.isArray(entry.languageOptions) || !entry.languageOptions.some(language => language?.id === "ja" && language.pack == null)) {
      throw new Error(`missing ${game.toUpperCase()} import-only language baseline`);
    }
    if (typeof entry.features?.thprac !== "boolean") throw new Error(`missing ${game.toUpperCase()} thprac capability`);
    continue;
  }
  if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) throw new Error(`invalid game entry: ${game}`);
  const runtimeVersion = new URL(entry.runtime, "https://eagler.invalid/eagler-touhou/").searchParams.get("v");
  const runtimeHtml = await readFile(resolve(root, "games", game, `${game}.html`), "utf8");
  const runtimeScript = await readFile(resolve(root, "games", game, `${game}.js`), "utf8");
  const runtimeData = await readFile(resolve(root, "games", game, `${game}.data`));
  const dataSha256 = createHash("sha256").update(runtimeData).digest("hex");
  const runtimeLayout = extractGameDataLayout(runtimeScript, game);
  if (!runtimeHtml.includes("invalid shared resource")) throw new Error(`runtime shared resource validation missing: ${game}`);
  for (const mount of sharedFontMounts) {
    if (!runtimeHtml.includes(`"${mount}"`) && !runtimeHtml.includes(`'${mount}'`)) {
      throw new Error(`runtime shared font mount mismatch: ${game} -> ${mount}`);
    }
  }
  const versionedScript = new RegExp(`<script\\b[^>]*\\bsrc=["']?${game}\\.js\\?v=${runtimeVersion}(?:["'\\s>])`, "i");
  if (!runtimeVersion || !versionedScript.test(runtimeHtml)) throw new Error(`unversioned runtime script: ${game}`);
  const packageUuid = runtimeScript.match(/package_uuid:\s*["']([^"']+)["']/)?.[1] || "";
  if (packageUuid !== `sha256-${dataSha256}`) throw new Error(`runtime data cache identity mismatch: ${game}`);
  if (entry.gameData?.path !== `${game}.data` || entry.gameData?.bytes !== runtimeData.length ||
      String(entry.gameData?.sha256 || "").toLowerCase() !== dataSha256 || entry.gameData?.version !== `sha256-${dataSha256}` ||
      entry.gameData?.layout !== runtimeLayout.layout || entry.gameData?.bytes !== runtimeLayout.bytes) {
    throw new Error(`gameData identity mismatch: ${game}`);
  }
  for (const extension of ["html", "js", "wasm", "data"]) await stat(resolve(root, "games", game, `${game}.${extension}`));
  for (const [mode, pack] of Object.entries(entry.music)) {
    if (!Array.isArray(pack.files)) throw new Error(`invalid ${game}/${mode} pack`);
    if (mode !== "midi" && (typeof pack.version !== "string" || pack.version.length < 8)) throw new Error(`unversioned ${game}/${mode} pack`);
    const musicIdentities = [];
    for (const file of pack.files) {
      const path = resolve(root, "eagler-touhou", pack.base, file);
      const bytes = await readFile(path);
      musicIdentities.push({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    if (mode === "ogg") {
      if (!Array.isArray(pack.sizes) || !Array.isArray(pack.sha256) || pack.sizes.length !== pack.files.length || pack.sha256.length !== pack.files.length) {
        throw new Error(`invalid ${game}/ogg content identity`);
      }
      for (let i = 0; i < pack.files.length; i++) {
        if (pack.sizes[i] !== musicIdentities[i].bytes || String(pack.sha256[i]).toLowerCase() !== musicIdentities[i].sha256) {
          throw new Error(`${game}/ogg identity mismatch: ${pack.files[i]}`);
        }
      }
      const setHash = createHash("sha256")
        .update(JSON.stringify(pack.files.map((file, index) => [file, pack.sizes[index], pack.sha256[index]])))
        .digest("hex");
      if (pack.version !== `sha256-${setHash}`) throw new Error(`${game}/ogg set version mismatch`);
    }
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
console.log(JSON.stringify({ valid: true, resourceMode, files: deployment.files.length, music: deployment.music }));
