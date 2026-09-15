import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPackagePayload, validatePackageDescriptor } from "../package/package-descriptor.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { runtimeFileNames, runtimeStem } from "../lib/runtime-release.mjs";
import { RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, validateReleaseCatalog } from "../lib/contracts/release-catalog.mjs";
import { HOST_MANIFEST_FILE, validateHostManifest } from "../lib/contracts/host-manifest.mjs";
import { extractGameDataLayout } from "../lib/runtime-data-layout.mjs";
import { assertRuntimeDataShell } from "../lib/runtime-data-provider.mjs";
import { verifyReleaseManifest } from "../lib/release-manifest.mjs";
import {
  RESOURCE_MODE_EXTERNAL,
  RESOURCE_MODE_HOSTED,
  RESOURCE_MODE_IMPORT,
  normalizeResourceMode,
} from "../lib/contracts/resource-mode.mjs";
import { BUILD_AUTHORITY_PUBLICATION, classifyBuildProfile } from "../lib/build-profile.mjs";
import { hostArtworkFiles } from "../lib/frontend-manifest.mjs";
import { assertAppShellContract } from "../lib/app-shell-policy.mjs";
import { assertLanguagePublicationConsistency } from "../lib/language-publication-contract.mjs";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const root = resolve(process.argv[2] || workspace, process.argv[2] ? "" : "dist/eagler-touhou-server");
const deployment = JSON.parse(await readFile(resolve(root, "deployment.json"), "utf8"));
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) throw new Error("invalid deployment manifest");
let releaseIdentity = null;
if (deployment.releaseManifest != null) {
  if (deployment.releaseManifest !== "release-manifest.json") throw new Error("invalid release manifest path");
  releaseIdentity = await verifyReleaseManifest(root);
}
if (typeof deployment.profile !== "string" || !deployment.profile || releaseIdentity?.profile !== deployment.profile) {
  throw new Error("deployment profile does not match Release Manifest");
}
const inferredAuthority = classifyBuildProfile(deployment.profile);
if (!inferredAuthority || (deployment.authority != null && deployment.authority !== inferredAuthority)) {
  throw new Error("deployment profile authority is invalid");
}
const declaredResourceMode = deployment.resourceMode || "hosted";
const resourceMode = normalizeResourceMode(declaredResourceMode);
if (!resourceMode) throw new Error("invalid deployment resourceMode");
const games = validateHostManifest(JSON.parse(await readFile(resolve(root, HOST_MANIFEST_FILE), "utf8")));
const gameIds = Object.keys(games.games);
if (!gameIds.length || gameIds.some(game => !Object.hasOwn(PRODUCT_GAMES, game))) {
  throw new Error("Host Manifest contains no products or an unregistered product");
}
const preloadGames = gameIds.filter(game => PRODUCT_GAMES[game].dataProvider === "emscripten-preload");
if (!deployment.files.some(item => item.path === "touch-guide.css")) throw new Error("touch guide stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "site.webmanifest")) throw new Error("Home Screen Web App manifest missing from deployment");
if (!deployment.files.some(item => item.path === "app-shell-sw.js")) throw new Error("App Shell Service Worker missing from deployment");
if (!deployment.files.some(item => item.path === "migrate.html")) throw new Error("origin migration page missing from deployment");
if (!deployment.files.some(item => item.path === "about.html")) throw new Error("about page missing from deployment");
if (!deployment.files.some(item => item.path === "faq.html")) throw new Error("FAQ page missing from deployment");
if (!deployment.files.some(item => item.path === "about.css")) throw new Error("about stylesheet missing from deployment");
if (!deployment.files.some(item => item.path === "content/FIRST_USE_NOTICE.html")) throw new Error("content/FIRST_USE_NOTICE.html missing from deployment");
if (!deployment.files.some(item => item.path === "content/MULTIPLAYER.html")) throw new Error("content/MULTIPLAYER.html missing from deployment");
for (const font of ["yatra-one-latin.woff2", "chill-round-gothic-site-medium.woff2", "chill-round-gothic-site-bold.woff2", "chill-round-gothic-site-heavy.woff2"]) {
  if (!deployment.files.some(item => item.path === `assets/fonts/${font}`)) throw new Error(`UI font missing from deployment: ${font}`);
}

assertAppShellContract(deployment.appShell, games);
const appShellWorker = await readFile(resolve(root, "app-shell-sw.js"), "utf8");
if (!appShellWorker.includes(deployment.appShell.buildId)) {
  throw new Error("App Shell Service Worker does not match deployment App Shell contract");
}

const knownHostUiPaths = new Set(hostArtworkFiles(Object.keys(PRODUCT_GAMES)).map(name => `assets/${name}`));
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
  if (knownHostUiPaths.has(item.path)) {
    if (item.path.endsWith(".webp") && (bytes.length < 16 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP")) {
      throw new Error(`invalid WebP host artwork: ${item.path}`);
    }
    if (item.path.endsWith(".ico") && (bytes.length < 22 || !bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))) {
      throw new Error(`invalid ICO host artwork: ${item.path}`);
    }
  }
}
if (inferredAuthority === BUILD_AUTHORITY_PUBLICATION) {
  for (const name of hostArtworkFiles(gameIds)) {
    const path = `assets/${name}`;
    if (!inventoryPaths.has(path)) throw new Error(`required host artwork missing from deployment: ${path}`);
  }
}
for (const path of deployment.appShell.entries) {
  if (path === "./") continue;
  if (!inventoryPaths.has(path)) {
    throw new Error(`App Shell contract references file outside deployment inventory: ${path}`);
  }
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files); else files.push(path);
  }
  return files;
}
const sidecars = new Set(["deployment.json", ...(deployment.releaseManifest ? ["release-manifest.json", "checksums.txt"] : [])]);
const actualPaths = new Set((await walk(root))
  .map(path => relative(root, path).replaceAll("\\", "/"))
  .filter(path => !sidecars.has(path)));
for (const path of actualPaths) if (!inventoryPaths.has(path)) throw new Error(`file missing from inventory: ${path}`);
for (const path of inventoryPaths) if (!actualPaths.has(path)) throw new Error(`inventory file missing: ${path}`);

const migrationHtml = await readFile(resolve(root, "migrate.html"), "utf8");
if (!migrationHtml.includes('const PROTOCOL = "eagler-touhou/origin-migration/1";') ||
    !migrationHtml.includes('source.protocol = "http:";') ||
    !migrationHtml.includes('openHttp.onclick = () => {') ||
    !migrationHtml.includes('location.href = sourceLink.href;') ||
    !migrationHtml.includes('pageTitle.textContent = heading;')) {
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
      try { info = await stat(target); } catch {
        const targetRelative = relative(root, target).replaceAll("\\", "/");
        if (knownHostUiPaths.has(targetRelative)) continue;
        throw new Error(`missing HTML resource: ${relativeHtmlPath} -> ${value}`);
      }
      if (!info.isFile() && !info.isDirectory()) throw new Error(`invalid HTML resource: ${relativeHtmlPath} -> ${value}`);
    }
  }
}
const htmlPaths = ["index.html", "migrate.html", "about.html", "faq.html"];
for (const game of gameIds) {
  const entry = games.games[game];
  for (const runtime of [entry.runtime, entry.multiplayerRuntime].filter(Boolean)) {
    const pathname = new URL(runtime, "https://eagler.invalid/").pathname.slice(1);
    htmlPaths.push(pathname);
  }
}
for (const htmlPath of htmlPaths) await verifyHtmlReferences(htmlPath);

const releaseCatalog = validateReleaseCatalog(JSON.parse(await readFile(resolve(root, RELEASE_CATALOG_FILE), "utf8")));
if (games.profile !== deployment.profile) throw new Error("Host Manifest profile does not match deployment");
if (games.protocol !== "eagler-touhou/1") throw new Error("invalid host protocol");
if (normalizeResourceMode(games.shared?.resourceMode || "hosted") !== resourceMode) throw new Error("host/deployment resourceMode mismatch");
for (const game of gameIds.filter(id => PRODUCT_GAMES[id].runtimeFileLayout === "directory")) {
  const entry = games.games[game], runtimeUrl = new URL(entry.runtime, "https://eagler.invalid/");
  if (!entry?.music?.midi || runtimeUrl.pathname !== `/runtime/${game}/${runtimeStem(game)}.html` || !runtimeUrl.searchParams.get("v")) {
    throw new Error(`invalid directory Runtime URL: ${game}`);
  }
  const runtimeRoot = resolve(root, "runtime", game);
  const metadata = JSON.parse(await readFile(resolve(runtimeRoot, "runtime-files.json"), "utf8"));
  if (metadata.schema !== "eagler-touhou/runtime-directory/1") throw new Error(`${game}: invalid Runtime directory manifest`);
  for (const name of runtimeFileNames(game, metadata.files)) {
    const bytes = await readFile(resolve(runtimeRoot, name)), expected = metadata.files[name];
    if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new Error(`${game}: stale Runtime asset: ${name}`);
  }
  const shell = await readFile(resolve(runtimeRoot, `${runtimeStem(game)}.html`), "utf8");
  assertRuntimeDataShell(shell, game, "normal");
  const identity = entry.gameData;
  if (!Number.isSafeInteger(identity?.bytes) || identity.bytes <= 0 || !/^[a-f0-9]{64}$/.test(identity.sha256) ||
      identity.path !== `${game}.data` || identity.version !== `sha256-${identity.sha256}`) throw new Error(`${game}: invalid DATA identity`);
  if (resourceMode === RESOURCE_MODE_HOSTED) {
    const bytes = await readFile(resolve(root, "games", game, `${game}.data`));
    if (bytes.length !== identity.bytes || createHash("sha256").update(bytes).digest("hex") !== identity.sha256) throw new Error(`${game}: DATA identity mismatch`);
  } else if (resourceMode === RESOURCE_MODE_IMPORT) {
    const compatibility = entry.offlineCompatibility;
    if (compatibility?.schema !== "eagler-touhou/offline-game-pack/1" ||
        compatibility.runtimeCompatibility?.protocol !== games.protocol ||
        compatibility.runtimeCompatibility?.dataLayout !== identity.layout ||
        compatibility.runtimeCompatibility?.versionSource !== "offline-pack" ||
        !Array.isArray(entry.offlineCompatibility?.requiredShared) || entry.offlineCompatibility.requiredShared.length !== 0 ||
        compatibility.languages?.source !== "offline-pack" ||
        !Array.isArray(compatibility.languages?.baseline) || !compatibility.languages.baseline.includes("ja") ||
        Object.values(entry.music || {}).some(pack => pack?.base != null)) {
      throw new Error(`${game}: invalid import-only compatibility`);
    }
  }
}
if (resourceMode === RESOURCE_MODE_HOSTED) {
  for (const key of ["vanillaFont", "unicodeFont"]) {
    if (typeof games.shared?.[key] !== "string" || !games.shared[key].includes("?v=")) throw new Error(`versioned shared ${key} missing`);
    await stat(resolve(root, games.shared[key].split("?")[0]));
  }
} else if (resourceMode === RESOURCE_MODE_IMPORT) {
  if (games.shared?.vanillaFont != null || games.shared?.unicodeFont != null) throw new Error(`${resourceMode} manifest must not expose runtime font URLs`);
  const updates = deployment.runtimeUpdates || [];
  if (!Array.isArray(updates)) throw new Error("invalid runtime update declarations");
  const publishedPayloads = [...inventoryPaths].filter(path => path.startsWith("games/") || path.startsWith("shared/"));
  if (updates.length || publishedPayloads.length || Object.keys(releaseCatalog.games).length) {
    throw new Error("import deployment must not publish game/shared payloads, Runtime updates, or releases");
  }
} else {
  if (games.shared?.vanillaFont != null || games.shared?.unicodeFont != null) {
    throw new Error("external manifest must not expose direct runtime font URLs");
  }
  const publishedPayloads = [...inventoryPaths].filter(path => path.startsWith("games/") || path.startsWith("shared/"));
  if (publishedPayloads.length) throw new Error("external deployment must not bundle game/shared payloads");
  if (Object.keys(releaseCatalog.games).sort().join(",") !== [...gameIds].sort().join(",")) {
    throw new Error("external deployment must publish every selected Package Descriptor");
  }
}
const fallback = games.shared?.gameDataFallback;
if (fallback != null && (typeof fallback !== "object" || typeof fallback.url !== "string" || !/^https:\/\//.test(fallback.url) ||
    (fallback.hint != null && typeof fallback.hint !== "string"))) {
  throw new Error("invalid optional gameDataFallback in server package");
}
const netplayRelay = games.shared?.netplayRelay;
if (netplayRelay != null) {
  let relay;
  try { relay = new URL(netplayRelay); }
  catch { throw new Error("invalid optional netplayRelay in server package"); }
  if (!/^wss?:$/.test(relay.protocol)) throw new Error("invalid optional netplayRelay in server package");
}
const sharedFontMounts = resourceMode === RESOURCE_MODE_HOSTED
  ? [games.shared.vanillaFont, games.shared.unicodeFont]
    .map(value => `/${basename(new URL(value, "https://eagler.invalid/").pathname)}`)
  : [];
const hostAppFacade = await readFile(resolve(root, "app.js"), "utf8");
const hostApp = await readFile(resolve(root, "assets", "launcher", "app.mjs"), "utf8");
const hostIndex = await readFile(resolve(root, "index.html"), "utf8");
if (!/id="originMigrationOpen"[^>]+href="migrate\.html"[^>]+hidden/.test(hostIndex)) {
  throw new Error("inert origin migration entry missing from main UI");
}
if (!hostApp.includes("host-manifest-origin-migration-policy/1")) {
  throw new Error("main UI migration entry is not governed by the Host Manifest campaign");
}
if (!hostAppFacade.includes('import "./assets/launcher/app.mjs";')) {
  throw new Error("Launcher app.js facade does not delegate to the generated TypeScript artifact");
}
for (const mount of sharedFontMounts) {
  const escapedMount = mount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`target\\s*:\\s*["']${escapedMount}["']`).test(hostApp)) {
    throw new Error(`host shared font target mismatch: ${mount}`);
  }
}
for (const game of preloadGames) {
  const entry = games.games?.[game];
  if (resourceMode === RESOURCE_MODE_IMPORT) {
    if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) {
      throw new Error(`invalid ${resourceMode} game entry: ${game}`);
    }
    if (typeof entry.gameData?.version !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(entry.gameData.version) ||
        typeof entry.gameData?.layout !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(entry.gameData.layout) ||
        entry.gameData?.path !== `${game}.data` || !Number.isInteger(entry.gameData?.bytes) || entry.gameData.bytes <= 0 ||
        !/^[a-f0-9]{64}$/i.test(entry.gameData?.sha256 || "")) {
      throw new Error(`invalid ${resourceMode} game data identity: ${game}`);
    }
    const compatibility = entry.offlineCompatibility;
    if (compatibility?.schema !== "eagler-touhou/offline-game-pack/1" ||
        compatibility.runtimeCompatibility?.protocol !== games.protocol ||
        compatibility.runtimeCompatibility?.dataLayout !== entry.gameData.layout ||
        compatibility.runtimeCompatibility?.versionSource !== "offline-pack" ||
        !Array.isArray(compatibility.requiredShared) ||
        !(PRODUCT_GAMES[game].requiredShared ?? ["/msgothic.ttc", "/unifont.otf"])
          .every(target => compatibility.requiredShared.includes(target)) ||
        compatibility.languages?.source !== "offline-pack" ||
        !Array.isArray(compatibility.languages?.baseline) || !compatibility.languages.baseline.includes("ja")) {
      throw new Error(`invalid ${resourceMode} offline compatibility metadata: ${game}`);
    }
    for (const pack of Object.values(entry.music || {})) {
      if (pack?.base != null) throw new Error(`${resourceMode} manifest must not expose music base URL: ${game}`);
    }
    if (!Array.isArray(entry.languageOptions) || !entry.languageOptions.some(language => language?.id === "ja" && language.pack == null)) {
      throw new Error(`missing ${game.toUpperCase()} ${resourceMode} language baseline`);
    }
    if (typeof entry.features?.thprac !== "boolean") throw new Error(`missing ${game.toUpperCase()} thprac capability`);
    continue;
  }
  if (resourceMode === RESOURCE_MODE_EXTERNAL) continue;
  if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) throw new Error(`invalid game entry: ${game}`);
  const runtimeVersion = new URL(entry.runtime, "https://eagler.invalid/").searchParams.get("v");
  const runtimeHtml = await readFile(resolve(root, "runtime", game, `${game}.html`), "utf8");
  const runtimeScript = await readFile(resolve(root, "runtime", game, `${game}.js`), "utf8");
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
  if (entry.gameData?.path !== `${game}.data` || entry.gameData?.bytes !== runtimeData.length ||
      String(entry.gameData?.sha256 || "").toLowerCase() !== dataSha256 || entry.gameData?.version !== `sha256-${dataSha256}` ||
      entry.gameData?.layout !== runtimeLayout.layout || entry.gameData?.bytes !== runtimeLayout.bytes) {
    throw new Error(`gameData identity mismatch: ${game}`);
  }
  for (const extension of ["html", "js", "wasm"]) {
    await stat(resolve(root, "runtime", game, `${game}.${extension}`));
  }
  await stat(resolve(root, "games", game, `${game}.data`));
  for (const [mode, pack] of Object.entries(entry.music)) {
    if (!Array.isArray(pack.files)) throw new Error(`invalid ${game}/${mode} pack`);
    if (mode !== "midi" && (typeof pack.version !== "string" || pack.version.length < 8)) throw new Error(`unversioned ${game}/${mode} pack`);
    const musicIdentities = [];
    for (const file of pack.files) {
      const path = resolve(root, pack.base, file);
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
          !Number.isInteger(language.pack.bytes) || typeof language.pack.runtimeVersion !== "string") {
        throw new Error(`invalid ${game.toUpperCase()} language pack: ${language?.id}`);
      }
      const url = new URL(language.pack.url, "https://eagler.invalid/");
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

  const published = releaseCatalog.games?.[game];
  if (!published || typeof published.revision !== "string" || typeof published.descriptor !== "string") {
    throw new Error(`missing ${game.toUpperCase()} Release Catalog entry`);
  }
  if (!entry.package || entry.package.revision !== published.revision || entry.package.descriptor !== published.descriptor) {
    throw new Error(`${game.toUpperCase()} legacy Package pointer diverges from Release Catalog`);
  }
  const descriptorHref = releaseCatalogEntryUrl(`https://eagler.invalid/${RELEASE_CATALOG_FILE}`, releaseCatalog, game);
  const descriptorUrl = new URL(descriptorHref);
  const descriptorPath = descriptorUrl.pathname.slice(1);
  const descriptor = JSON.parse(await readFile(resolve(root, descriptorPath), "utf8"));
  validatePackageDescriptor(descriptor);
  if (descriptor.game !== game || descriptor.revision !== published.revision) {
    throw new Error(`${game.toUpperCase()} Package Descriptor identity mismatch`);
  }
  const calculatedPackageRevision = createHash("sha256")
    .update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
  if (descriptor.revision !== calculatedPackageRevision) {
    throw new Error(`${game.toUpperCase()} Package revision does not identify its descriptor`);
  }
  for (const [fileId, file] of Object.entries(descriptor.files)) {
    const path = resolve(root, file.source);
    const bytes = await readFile(path);
    const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    if (file.bytes != null && file.bytes !== bytes.length) throw new Error(`${game.toUpperCase()} Package byte mismatch: ${fileId}`);
    if (file.revision !== revision) throw new Error(`${game.toUpperCase()} Package file revision mismatch: ${fileId}`);
  }
}

if (resourceMode === RESOURCE_MODE_EXTERNAL) {
  for (const game of gameIds) {
    const entry = games.games[game];
    const published = releaseCatalog.games[game];
    if (!published || !entry.package || entry.package.revision !== published.revision ||
        entry.package.descriptor !== published.descriptor) {
      throw new Error(`${game}: external Package pointer diverges from Release Catalog`);
    }
    const descriptorPath = new URL(releaseCatalogEntryUrl(
      `https://eagler.invalid/${RELEASE_CATALOG_FILE}`, releaseCatalog, game)).pathname.slice(1);
    const descriptor = validatePackageDescriptor(JSON.parse(await readFile(resolve(root, descriptorPath), "utf8")));
    const revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
    if (descriptor.game !== game || descriptor.revision !== published.revision || descriptor.revision !== revision) {
      throw new Error(`${game}: external Package Descriptor identity mismatch`);
    }
    assertLanguagePublicationConsistency(game, entry, descriptor);
    for (const [fileId, file] of Object.entries(descriptor.files)) {
      if (!/^(?:games|shared)\//.test(file.source)) {
        throw new Error(`${game}: external Package source is outside redirect-owned routes: ${fileId}`);
      }
      if (inventoryPaths.has(file.source)) throw new Error(`${game}: external payload was bundled: ${fileId}`);
      if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{16}$/i.test(file.revision || "")) {
        throw new Error(`${game}: invalid external Package file identity: ${fileId}`);
      }
    }
  }
}

if (resourceMode === RESOURCE_MODE_HOSTED && gameIds.includes("th08")) {
  const game = "th08";
  const entry = games.games?.[game];
  if (!entry?.music?.midi || typeof entry.runtime !== "string" || !entry.runtime.includes("&v=")) {
    throw new Error("invalid game entry: th08");
  }

  const runtimeData = await readFile(resolve(root, "games", game, "th08.data"));
  const dataSha256 = createHash("sha256").update(runtimeData).digest("hex");
  if (entry.gameData?.path !== "th08.data" || entry.gameData?.bytes !== runtimeData.length ||
      String(entry.gameData?.sha256 || "").toLowerCase() !== dataSha256 ||
      entry.gameData?.version !== `sha256-${dataSha256}` ||
      typeof entry.gameData?.layout !== "string" || !/^sha256-[a-f0-9]{64}$/i.test(entry.gameData.layout)) {
    throw new Error("gameData identity mismatch: th08");
  }

  const oggPack = entry.music?.ogg;
  if (oggPack) {
    if (oggPack.mount !== "/bgm-ogg" || !Array.isArray(oggPack.files) ||
        !Array.isArray(oggPack.sizes) || !Array.isArray(oggPack.sha256) ||
        oggPack.sizes.length !== oggPack.files.length || oggPack.sha256.length !== oggPack.files.length) {
      throw new Error("invalid TH08 hosted OGG content identity");
    }
    const oggSet = [];
    for (let index = 0; index < oggPack.files.length; index++) {
      const file = oggPack.files[index];
      const bytes = await readFile(resolve(root, oggPack.base, file));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (oggPack.sizes[index] !== bytes.length || String(oggPack.sha256[index]).toLowerCase() !== sha256) {
        throw new Error(`TH08 hosted OGG identity mismatch: ${file}`);
      }
      oggSet.push([file, bytes.length, sha256]);
    }
    const oggSetHash = createHash("sha256").update(JSON.stringify(oggSet)).digest("hex");
    if (oggPack.version !== `sha256-${oggSetHash}`) throw new Error("TH08 hosted OGG set version mismatch");
  }

  if (!Array.isArray(entry.languageOptions) ||
      !entry.languageOptions.some(language => language?.id === "ja" && language.pack == null) ||
      typeof entry.features?.thprac !== "boolean" || entry.features.thprac !== false) {
    throw new Error("invalid TH08 hosted capability/language metadata");
  }

  const published = releaseCatalog.games?.th08;
  if (!published || entry.package?.revision !== published.revision || entry.package?.descriptor !== published.descriptor) {
    throw new Error("TH08 Release Catalog / legacy Package pointer mismatch");
  }
  const descriptorHref = releaseCatalogEntryUrl(`https://eagler.invalid/${RELEASE_CATALOG_FILE}`, releaseCatalog, game);
  const descriptorPath = new URL(descriptorHref).pathname.slice(1);
  const descriptor = validatePackageDescriptor(JSON.parse(await readFile(resolve(root, descriptorPath), "utf8")));
  const calculatedRevision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
  if (descriptor.game !== game || descriptor.revision !== published.revision || descriptor.revision !== calculatedRevision) {
    throw new Error("TH08 Package Descriptor identity mismatch");
  }
  const descriptorOggFiles = descriptor.components?.ogg?.files;
  const oggOwnershipValid = oggPack
    ? Array.isArray(descriptorOggFiles) && descriptorOggFiles.length === oggPack.files.length
    : descriptorOggFiles === undefined;
  if (descriptor.runtimeRequirement?.dataFile !== "game-data" || descriptor.files?.["game-data"]?.target !== "/th08.data" ||
      !descriptor.base?.files?.includes("game-data") || !oggOwnershipValid) {
    throw new Error("TH08 Package Descriptor base/OGG ownership mismatch");
  }
  for (const [fileId, file] of Object.entries(descriptor.files)) {
    const bytes = await readFile(resolve(root, file.source));
    const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    if (file.bytes != null && file.bytes !== bytes.length) throw new Error(`TH08 Package byte mismatch: ${fileId}`);
    if (file.revision !== revision) throw new Error(`TH08 Package file revision mismatch: ${fileId}`);
  }
}
console.log(JSON.stringify({ valid: true, resourceMode, files: deployment.files.length, music: deployment.music }));
