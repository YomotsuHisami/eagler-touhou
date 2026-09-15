import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  PACKAGE_DESCRIPTOR_SCHEMA,
  canonicalPackagePayload,
  validatePackageDescriptor,
} from "../package/package-descriptor.mjs";
import { staticLanguagePackPath } from "../server/thcrap-static-pack.mjs";
import { RELEASE_CATALOG_FILE, RELEASE_CATALOG_SCHEMA, validateReleaseCatalog } from "../lib/contracts/release-catalog.mjs";
import { HOST_MANIFEST_FILE, HOST_MANIFEST_SCHEMA, validateHostManifest } from "../lib/contracts/host-manifest.mjs";
import { PRODUCT_GAMES, languagePriority } from "../lib/contracts/product-catalog.mjs";
import { assertProductEntriesRegistered, normalizeProductSelection, selectProductEntries } from "../lib/product-selection.mjs";
import { createPublicationHostSeed } from "../lib/publication-host-seed.mjs";
import { RESOURCE_MODE_EXTERNAL, RESOURCE_MODE_HOSTED, RESOURCE_MODE_IMPORT } from "../lib/contracts/resource-mode.mjs";
import { BUILD_AUTHORITY_PUBLICATION, classifyBuildProfile } from "../lib/build-profile.mjs";
import { extractGameDataLayout } from "../lib/runtime-data-layout.mjs";
import { assemblePreloadData } from "../lib/preload-data-assembler.mjs";
import { assertRuntimeDataShell } from "../lib/runtime-data-provider.mjs";
import { buildAppShell } from "../lib/app-shell-build.mjs";
import { deploymentAppShellPatterns, runtimeAppShellPaths } from "../lib/app-shell-policy.mjs";
import { sourceIdentity, verifyReleaseManifest, writeReleaseManifest, fileSetIdentity } from "../lib/release-manifest.mjs";
import { verifyRuntimeRelease, runtimeFileNames, runtimeStem } from "../lib/runtime-release.mjs";
import { PRODUCT_CONTENT } from "../lib/content-definition.mjs";
import { WORKSPACE_REPOSITORIES, workspacePath, workspaceRoot } from "../lib/workspace-layout.mjs";
import { FRONTEND_PACKAGE_FILES, hostArtworkFiles, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import { normalizeSiteUrl, writeSiteMetadata } from "../lib/site-metadata.mjs";

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
const siteUrl = normalizeSiteUrl(args["site-url"]);
const temporaryRoot = resolve(dirname(output), ".tmp");
const staging = resolve(temporaryRoot, `${basename(output)}.staging-${randomUUID()}`);
const workspace = workspaceRoot();
if (output === project || output === workspace || output === resolve(output, "..")) {
  throw new Error(`unsafe output directory: ${output}`);
}
const featureConfigPath = args["feature-config"] ? resolve(args["feature-config"]) : null;
const configuredFeatures = featureConfigPath ? JSON.parse(await readFile(featureConfigPath, "utf8")) : null;
const externalRecoveryContextPath = args["external-recovery-context"] ? resolve(args["external-recovery-context"]) : null;
const externalRecoveryRequest = externalRecoveryContextPath
  ? JSON.parse(await readFile(externalRecoveryContextPath, "utf8"))
  : null;
if (configuredFeatures && (configuredFeatures.schema !== "eagler-touhou/server-features/1" ||
    !configuredFeatures.games || typeof configuredFeatures.games !== "object")) {
  throw new Error(`invalid server feature config: ${featureConfigPath}`);
}
const configuredResourceMode = configuredFeatures?.resourceMode || RESOURCE_MODE_HOSTED;
if (![RESOURCE_MODE_HOSTED, RESOURCE_MODE_EXTERNAL, RESOURCE_MODE_IMPORT].includes(configuredResourceMode)) {
  throw new Error(`invalid resourceMode in server feature config: ${featureConfigPath}`);
}
const serverResourceMode = configuredResourceMode;
const hostedResources = serverResourceMode === RESOURCE_MODE_HOSTED;
const externalResources = serverResourceMode === RESOURCE_MODE_EXTERNAL;
if (args["test-build"] !== undefined && !["0", "1"].includes(args["test-build"])) throw new Error("--test-build must be 0 or 1");
const testBuild = args["test-build"] === "1";
const buildProfile = args.profile;
const buildAuthority = classifyBuildProfile(buildProfile);
if (!buildAuthority || buildProfile === "web-development") throw new Error("packaging requires an explicit web-validation-* or web-release-* --profile=NAME");
const publicationBuild = buildAuthority === BUILD_AUTHORITY_PUBLICATION;
const gameIds = normalizeProductSelection(args.games);
const languageGames = gameIds.filter(game => PRODUCT_GAMES[game].features.languages);
const preloadGames = gameIds.filter(game => PRODUCT_GAMES[game].dataProvider === "emscripten-preload");
const runtimeReleaseRoot = args["runtime-release"] ? resolve(args["runtime-release"]) : null;
const runtimeRelease = runtimeReleaseRoot ? await verifyRuntimeRelease(runtimeReleaseRoot) : null;
if (externalRecoveryRequest) {
  const requested = externalRecoveryRequest.requestedOverrides;
  const requestedKeys = requested && typeof requested === "object" && !Array.isArray(requested)
    ? Object.keys(requested).sort()
    : [];
  if (externalRecoveryRequest.schema !== "eagler-touhou/external-recovery-request/1" ||
      requestedKeys.join(",") !== "netplayRelay,originMigration,testBuild" ||
      typeof requested.netplayRelay !== "string" ||
      typeof requested.originMigration !== "string" ||
      !["0", "1"].includes(requested.testBuild)) {
    throw new Error(`invalid External recovery context: ${externalRecoveryContextPath}`);
  }
  if (!externalResources || !/^web-validation-/.test(buildProfile)) {
    throw new Error("External recovery provenance is restricted to web-validation-* external packaging");
  }
  if (!runtimeReleaseRoot) {
    throw new Error("External recovery provenance requires --runtime-release=PATH");
  }
}
if (runtimeReleaseRoot && gameIds.some(game => args[`${game}-build`] || args[`${game}-multiplayer-build`])) {
  throw new Error("--runtime-release cannot be mixed with per-game Runtime build directories");
}
// Runtime artifacts are Launcher/App resources in every publication mode.
// Only game content/assets/fonts remain conditional on hosted-resource mode.
const builds = Object.fromEntries(gameIds.flatMap(game => [
  [game, runtimeRelease
    ? resolve(runtimeReleaseRoot, runtimeRelease.games[game].runtime.root)
    : required(`${game}-build`)],
  ...(PRODUCT_GAMES[game].multiplayerRuntime
    ? [[`${game}Multiplayer`, runtimeRelease
      ? resolve(runtimeReleaseRoot, runtimeRelease.games[game].multiplayerRuntime.root)
      : required(`${game}-multiplayer-build`)]]
    : []),
]));
const assets = hostedResources
  ? Object.fromEntries(gameIds.map(game => [game, required(`${game}-assets`)]))
  : Object.fromEntries(gameIds.map(game => [game, null]));
const dataAssets = hostedResources
  ? Object.fromEntries(gameIds.map(game => [game, args[`${game}-data-assets`]
    ? resolve(args[`${game}-data-assets`]) : assets[game]]))
  : Object.fromEntries(gameIds.map(game => [game, null]));
const artworkDir = args["artwork-dir"] ? resolve(args["artwork-dir"]) : null;
if ((hostedResources || publicationBuild) && !artworkDir) {
  throw new Error(`${publicationBuild ? "web-release" : "hosted"} packaging requires --artwork-dir=PATH for the normalized Launcher UI resources`);
}
const font = hostedResources ? required("font") : null;
const vanillaFont = hostedResources ? required("vanilla-font") : null;
const ogg = Object.fromEntries(gameIds.map(game => [
  game,
  args[`${game}-ogg`] ? resolve(args[`${game}-ogg`]) : null,
]));
const modes = new Set((args.music || "midi,ogg").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
for (const mode of modes) if (!["midi", "wav", "ogg"].includes(mode)) throw new Error(`unsupported music mode: ${mode}`);
modes.add("midi");

function musicSourceBase(game, mode) {
  const root = mode === "wav" ? assets[game] : ogg[game];
  const directory = PRODUCT_GAMES[game].package.musicSourceDirectories?.[mode];
  if (!root || typeof directory !== "string") throw new Error(`${game}: ${mode} source is not declared or supplied`);
  return resolve(root, directory);
}

const LANGUAGE_ID = /^(?:ja|lang_[a-z0-9]+(?:-[a-z0-9]+)*)$/i;
const LANGUAGE_DISPLAY_NAMES = Object.freeze({
  ja: "日本語",
  "lang_zh-hans": "中文（简体）",
  "lang_zh-hant": "中文（繁體）",
  lang_en: "English",
  lang_ru: "Русский",
});
const canonicalLanguageIds = ids => [...ids].sort((a, b) =>
  languagePriority(a) - languagePriority(b) || a.localeCompare(b, "en"));
const languageDisplayName = (id, fallback) => LANGUAGE_DISPLAY_NAMES[id] || fallback || id;
const defaultFeatures = Object.freeze(Object.fromEntries(languageGames.map(game => [
  game,
  Object.freeze({ languages: null, thprac: false }),
])));
const serverFeatures = Object.fromEntries(languageGames.map(game => [game, { ...defaultFeatures[game] }]));
let serverGameDataFallback = null;
let serverNetplayRelay = null;
if (configuredFeatures) {
  const configured = configuredFeatures;
  if (configured.netplayRelay != null) {
    let relay;
    try { relay = new URL(String(configured.netplayRelay)); }
    catch { throw new Error(`invalid netplayRelay in server feature config: ${featureConfigPath}`); }
    if (!/^wss?:$/.test(relay.protocol)) throw new Error(`invalid netplayRelay in server feature config: ${featureConfigPath}`);
    serverNetplayRelay = relay.href;
  }
  if (configured.gameDataFallback != null) {
    const fallback = configured.gameDataFallback;
    if (typeof fallback !== "object" || typeof fallback.url !== "string" || !/^https:\/\//.test(fallback.url) ||
        (fallback.hint != null && typeof fallback.hint !== "string")) {
      throw new Error(`invalid gameDataFallback in server feature config: ${featureConfigPath}`);
    }
    serverGameDataFallback = { url: fallback.url, ...(fallback.hint ? { hint: fallback.hint } : {}) };
  }
  for (const game of languageGames) {
    const entry = configured.games[game];
    if (!entry || !Array.isArray(entry.languages) || entry.languages.length === 0 || typeof entry.thprac !== "boolean") {
      throw new Error(`invalid ${game.toUpperCase()} server feature entry`);
    }
    const languages = entry.languages.map(value => String(value).toLowerCase());
    if (languages.some(value => !LANGUAGE_ID.test(value)) || new Set(languages).size !== languages.length) {
      throw new Error(`invalid ${game.toUpperCase()} language allowlist`);
    }
    serverFeatures[game] = { languages, thprac: entry.thprac };
  }
}

const languagePackSources = Object.fromEntries(languageGames.map(game => {
  const source = hostedResources && args[`${game}-language-packs`] ? resolve(args[`${game}-language-packs`]) : null;
  return [game, source ? { source, catalog: null } : null];
}));
for (const game of languageGames) {
  const languagePack = languagePackSources[game];
  const selected = hostedResources ? (serverFeatures[game].languages?.filter(id => id !== "ja") ?? null) : [];
  if (selected?.length && !languagePack) {
    throw new Error(`${game.toUpperCase()} language allowlist requests downloadable packs, but no language-pack directory was provided`);
  }
  if (!languagePack) continue;
  languagePack.catalog = JSON.parse(await readFile(resolve(languagePack.source, "catalog.json"), "utf8"));
  if (languagePack.catalog.schema !== "eagler-touhou/thcrap-static-catalog/1" ||
      languagePack.catalog.game !== game || !Array.isArray(languagePack.catalog.languages) ||
      (!["pending", "auto", "independent"].includes(String(languagePack.catalog.runtimeVersion).toLowerCase()) &&
       !/^[a-f0-9]{16,64}$/i.test(languagePack.catalog.runtimeVersion || ""))) {
    throw new Error(`invalid ${game.toUpperCase()} language catalog: ${languagePack.source}`);
  }
  if (selected) {
    const available = new Set(languagePack.catalog.languages.map(item => String(item?.id || "").toLowerCase()));
    const missingLanguages = selected.filter(id => !available.has(id));
    if (missingLanguages.length) throw new Error(`${game.toUpperCase()} language allowlist is missing prepared packs: ${missingLanguages.join(", ")}`);
  }
}

for (const game of languageGames) {
  if (!hostedResources || !serverFeatures[game].thprac) continue;
  if (runtimeRelease) {
    if (!runtimeRelease.games[game].features.thprac) {
      throw new Error(`${game.toUpperCase()} Runtime Release does not attest thprac capability`);
    }
    continue;
  }
  const compileCommandsPath = resolve(builds[game], "compile_commands.json");
  let compileCommands;
  try {
    compileCommands = await readFile(compileCommandsPath, "utf8");
  } catch {
    throw new Error(`${game.toUpperCase()} thprac publication requires compile_commands.json build attestation`);
  }
  if (!compileCommands.includes("THPRAC_PORTABLE_ENABLED=1") ||
      !compileCommands.replaceAll("\\\\", "/").includes(`/portable/adapters/${game}/adapter.cpp`)) {
    throw new Error(`${game.toUpperCase()} thprac publication requires the full reallyportable adapter, not the ImGui shell alone`);
  }
}

function staticPackPath(value, game) {
  if (typeof value !== "string" || value.startsWith("/") || value.includes("\\")) throw new Error(`invalid language pack URL: ${value}`);
  const parts = value.split("/");
  const currentPath = /^language\/lang_[a-z0-9]+(?:-[a-z0-9]+)*\.zip$/i.test(value);
  const legacyPath = value.startsWith(`thcrap/${game}/`);
  if (parts.some(part => !part || part === "." || part === "..") || (!currentPath && !legacyPath)) {
    throw new Error(`invalid language pack URL: ${value}`);
  }
  return value;
}

async function copyFrontend() {
  const frontend = staging;
  await mkdir(frontend, { recursive: true });
  for (const name of FRONTEND_PACKAGE_FILES) {
    const target = resolve(frontend, name);
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(resolveFrontendPackageSource(name), target);
  }
  await writeSiteMetadata(frontend, siteUrl);
  const copiedHostAssets = [];
  const artworkNames = hostArtworkFiles(gameIds);
  const requiredArtwork = publicationBuild ? new Set(artworkNames) : new Set();
  if (artworkDir) {
    for (const name of artworkNames) {
      const source = resolve(artworkDir, name);
      let info;
      try { info = await stat(source); } catch {
        if (requiredArtwork.has(name)) throw new Error(`required host UI asset is missing: ${source}`);
        continue;
      }
      if (!info.isFile() || !info.size) throw new Error(`invalid host UI asset: ${source}`);
      const target = resolve(frontend, "assets", name);
      await mkdir(resolve(target, ".."), { recursive: true });
      await cp(source, target);
      copiedHostAssets.push(name);
    }
  }
  return copiedHostAssets;
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

async function versionRuntimeVariant(runtimeRoot, dataPath, game) {
  const hash = createHash("sha256");
  for (const extension of ["html", "js", "wasm"]) {
    hash.update(await readFile(resolve(runtimeRoot, `${game}.${extension}`)));
  }
  hash.update(await readFile(dataPath));
  return hash.digest("hex").slice(0, 16);
}

async function fileIdentity(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function descriptorFile(source, target) {
  const normalizedSource = source.replaceAll("\\", "/");
  const identity = await fileIdentity(resolve(staging, normalizedSource));
  return {
    source: normalizedSource,
    target,
    revision: identity.sha256.slice(0, 16),
    bytes: identity.bytes,
    sha256: identity.sha256,
  };
}

async function versionRuntimeScript(gameRoot, stem, version) {
  const htmlPath = resolve(gameRoot, `${stem}.html`);
  const source = await readFile(htmlPath, "utf8");
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(<script\\b[^>]*\\bsrc=)(["']?)${escapedStem}\\.js(?:\\?[^"'\\s>]*)?\\2`, "i");
  if (!pattern.test(source)) throw new Error(`runtime script reference missing: ${htmlPath}`);
  await writeFile(htmlPath, source.replace(pattern, `$1$2${stem}.js?v=${version}$2`));
}

async function assertAppManagedRuntimeShell(buildRoot, game, variant, stem = game) {
  const htmlPath = resolve(buildRoot, `${stem}.html`);
  const source = await readFile(htmlPath, "utf8");
  assertRuntimeDataShell(source, game, variant);
  if (/packageBridge|package-bootstrap|__eaglerPackageBootstrapState/.test(source)) {
    throw new Error(`${game} ${variant} Runtime shell is stale: retired Package Runtime bridge is still present`);
  }
}

async function runtimeDataIdentity(gameRoot, game) {
  // DATA is now owned by the Launcher Package Store. The old
  // --use-preload-cache package_uuid marker intentionally no longer exists;
  // publication identity comes from the actual .data bytes instead.
  return fileIdentity(resolve(gameRoot, `${game}.data`));
}

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files); else files.push(path);
  }
  return files;
}

function resolveRecoveryRelay(value, inherited) {
  if (value === "inherit") return inherited || null;
  if (["none", "disable"].includes(value)) return null;
  let url;
  try { url = new URL(value); }
  catch { throw new Error("External recovery netplayRelay request must be inherit, none/disable, or a valid ws:// / wss:// URL"); }
  if (!/^wss?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("External recovery netplayRelay request must be a plain ws:// or wss:// URL without credentials or fragment");
  }
  return url.href;
}

function resolveRecoveryOriginMigration(value, inherited) {
  if (value === "inherit") return inherited || null;
  if (["none", "disable"].includes(value)) return null;
  if (value === "http-to-https") return { mode: "http-to-https" };
  throw new Error("External recovery originMigration request must be inherit, none/disable, or http-to-https");
}

await mkdir(temporaryRoot, { recursive: true });
await rm(staging, { recursive: true, force: true });
try {
const hostUiAssets = await copyFrontend();
const hostManifestPath = args["host-manifest"] ? resolve(args["host-manifest"]) : null;
if (!hostedResources && !hostManifestPath) {
  throw new Error(`${serverResourceMode} packaging requires an explicit --host-manifest from a verified hosted build`);
}
const manifest = hostManifestPath
  ? validateHostManifest(JSON.parse(await readFile(hostManifestPath, "utf8")))
  : createPublicationHostSeed(buildProfile);
if (externalResources && manifest.shared.resourceMode !== RESOURCE_MODE_HOSTED) {
  throw new Error("external packaging requires a Host Manifest from a hosted resource publication");
}
if (manifest.protocol !== "eagler-touhou/1" || !manifest.games || typeof manifest.games !== "object") {
  throw new Error(`invalid Host Manifest input: ${hostManifestPath || "generated publication Host seed"}`);
}
if (manifest.profile === "web-development") {
  throw new Error("development Host Manifest cannot be used as publication input");
}
assertProductEntriesRegistered(manifest.games, "Host Manifest games");
if (gameIds.some(game => !manifest.games[game])) {
  throw new Error(`Host Manifest is missing selected adapters: ${hostManifestPath || "generated publication Host seed"}`);
}
let externalRecoveryProvenance = null;
if (externalRecoveryRequest) {
  const sourceRoot = dirname(hostManifestPath);
  if (resolve(sourceRoot, HOST_MANIFEST_FILE) !== hostManifestPath) {
    throw new Error("External recovery provenance requires the Hosted root host-manifest.json");
  }
  const sourceRelease = await verifyReleaseManifest(sourceRoot);
  const sourceDeployment = JSON.parse(await readFile(resolve(sourceRoot, "deployment.json"), "utf8"));
  if (sourceDeployment?.format !== "eagler-touhou-deployment/1" ||
      sourceDeployment.resourceMode !== RESOURCE_MODE_HOSTED) {
    throw new Error("External recovery provenance requires an integrity-verified Hosted deployment");
  }
  const requested = externalRecoveryRequest.requestedOverrides;
  const expectedRelay = resolveRecoveryRelay(requested.netplayRelay, manifest.shared.netplayRelay);
  const expectedOriginMigration = resolveRecoveryOriginMigration(requested.originMigration, manifest.shared.originMigration);
  if ((serverNetplayRelay || null) !== expectedRelay ||
      !isDeepStrictEqual(configuredFeatures?.originMigration || null, expectedOriginMigration) ||
      (args["test-build"] || "0") !== requested.testBuild) {
    throw new Error("External recovery requested overrides do not match the effective packaging inputs");
  }
  const runtimeManifestBytes = await readFile(resolve(runtimeReleaseRoot, "runtime-release.json"));
  externalRecoveryProvenance = {
    schema: "eagler-touhou/external-recovery-context/1",
    sourceHostedReleaseId: sourceRelease.releaseId,
    runtimeReleaseManifestSha256: createHash("sha256").update(runtimeManifestBytes).digest("hex"),
    games: gameIds,
    requestedOverrides: requested,
    effectiveDeployment: {
      netplayRelay: expectedRelay,
      originMigration: expectedOriginMigration,
      testBuild,
    },
  };
}
manifest.games = selectProductEntries(manifest.games, gameIds);
manifest.schema = HOST_MANIFEST_SCHEMA;
manifest.profile = buildProfile;
manifest.shared = {
  resourceMode: serverResourceMode,
  testBuild,
  ...(serverResourceMode === RESOURCE_MODE_HOSTED ? {
    vanillaFont: `shared/msgothic.ttc?v=${await versionFiles(dirname(vanillaFont), [basename(vanillaFont)])}`,
    unicodeFont: `shared/unifont.otf?v=${await versionFiles(dirname(font), [basename(font)])}`,
  } : {}),
  ...(serverNetplayRelay ? { netplayRelay: serverNetplayRelay } : {}),
  ...(serverGameDataFallback ? { gameDataFallback: serverGameDataFallback } : {}),
  ...(configuredFeatures?.originMigration != null
    ? { originMigration: configuredFeatures.originMigration }
    : {}),
};
if (serverResourceMode === RESOURCE_MODE_IMPORT) {
  for (const entry of Object.values(manifest.games)) delete entry.package;
}

if (serverResourceMode === RESOURCE_MODE_HOSTED) {
  await mkdir(resolve(staging, "shared"), { recursive: true });
  await cp(vanillaFont, resolve(staging, "shared", "msgothic.ttc"));
  await cp(font, resolve(staging, "shared", "unifont.otf"));
}

for (const game of gameIds.filter(id => PRODUCT_GAMES[id].runtimeFileLayout === "directory")) {
  const entry = manifest.games[game], product = PRODUCT_GAMES[game];
  const declared = runtimeRelease?.games[game]?.runtime.files ||
    JSON.parse(await readFile(resolve(builds[game], "runtime-files.json"), "utf8")).files;
  const names = runtimeFileNames(game, declared), appRuntimeRoot = resolve(staging, "runtime", game);
  const stem = runtimeStem(game);
  await assertAppManagedRuntimeShell(builds[game], game, "normal", stem);
  for (const name of names) {
    const source = resolve(builds[game], name), identity = await fileIdentity(source), expected = declared[name];
    if (identity.bytes !== expected.bytes || identity.sha256 !== expected.sha256) throw new Error(`${game}: Runtime identity mismatch: ${name}`);
    await mkdir(dirname(resolve(appRuntimeRoot, name)), { recursive: true });
    await cp(source, resolve(appRuntimeRoot, name));
  }
  await writeFile(resolve(appRuntimeRoot, "runtime-files.json"), JSON.stringify({ schema: "eagler-touhou/runtime-directory/1", files: declared }, null, 2));
  entry.runtime = `runtime/${game}/${stem}.html?hosted=1&v=${await versionFiles(appRuntimeRoot, names)}`;
  entry.features = { thprac: false, focusHitbox: false };
  entry.languages = []; entry.languageOptions = [{ id: "ja", title: languageDisplayName("ja"), pack: null }];
  const declaredOgg = entry.music?.ogg;
  entry.music = {
    midi: { files: [], supported: false },
    ...(declaredOgg ? { ogg: declaredOgg } : {}),
  };
  if (serverResourceMode === RESOURCE_MODE_IMPORT) {
    const ogg = entry.music?.ogg;
    entry.offlineCompatibility = { schema: "eagler-touhou/offline-game-pack/1",
      runtimeCompatibility: { protocol: manifest.protocol, dataLayout: entry.gameData.layout, versionSource: "offline-pack" },
      requiredShared: [...product.requiredShared], languages: { source: "offline-pack", baseline: ["ja"] } };
    entry.music = {
      midi: { files: [], supported: false },
      ...(ogg ? {
        ogg: {
          version: ogg.version,
          mount: ogg.mount,
          files: ogg.files,
          sizes: ogg.sizes,
          ...(ogg.sha256 ? { sha256: ogg.sha256 } : {}),
        },
      } : {}),
    };
  } else if (hostedResources) {
    const target = `games/${game}/${game}.data`;
    await mkdir(dirname(resolve(staging, target)), { recursive: true });
    await cp(resolve(dataAssets[game], `${game}.data`), resolve(staging, target));
    const identity = await fileIdentity(resolve(staging, target));
    entry.gameData = { path: `${game}.data`, ...identity, version: `sha256-${identity.sha256}`, layout: PRODUCT_CONTENT[game].dataLayout };
    const packageFiles = { "game-data": await descriptorFile(target, `/${game}.data`) };
    const components = {};
    if (modes.has("ogg")) {
      const pack = entry.music?.ogg;
      if (!pack?.files?.length) throw new Error(`${game}: OGG content declaration is missing`);
      const sourceBase = musicSourceBase(game, "ogg");
      const targetBase = resolve(staging, "games", game, "music", "ogg");
      await copyFiles(sourceBase, targetBase, pack.files);
      pack.base = `games/${game}/music/ogg/`;
      const identities = await Promise.all(pack.files.map(file => fileIdentity(resolve(sourceBase, file))));
      pack.sizes = identities.map(identity => identity.bytes);
      Object.assign(pack, fileSetIdentity(pack.files, identities));
      const oggFiles = [];
      const mount = String(pack.mount || "").replace(/\/$/, "");
      for (const name of pack.files) {
        const id = `ogg:${name}`;
        packageFiles[id] = await descriptorFile(`games/${game}/music/ogg/${name}`, `${mount}/${name}`);
        oggFiles.push(id);
      }
      components.ogg = { type: "ogg", files: oggFiles };
    }
    const descriptor = { schema: PACKAGE_DESCRIPTOR_SCHEMA, game, revision: "pending",
      runtimeRequirement: { protocol: manifest.protocol, target: game, dataFile: "game-data", dataLayout: entry.gameData.layout },
      files: packageFiles, base: { files: ["game-data"] }, components };
    descriptor.revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
    validatePackageDescriptor(descriptor);
    const name = `${game}.package.json`; await writeFile(resolve(staging, name), JSON.stringify(descriptor, null, 2));
    entry.package = { revision: descriptor.revision, descriptor: name };
  }
}

for (const game of preloadGames) {
  const entry = manifest.games[game];
  const runtimeCapabilities = runtimeRelease?.games[game]?.features;
  const downloadableLanguages = serverFeatures[game].languages?.some(id => id !== "ja") || false;
  if (runtimeRelease && downloadableLanguages && !runtimeCapabilities.languages) {
    throw new Error(`${game.toUpperCase()} Runtime Release does not attest language capability`);
  }
  entry.features = {
    ...(entry.features || {}),
    thprac: !!serverFeatures[game].thprac,
    ...(game === "th06" && runtimeCapabilities
      ? { focusHitbox: !!runtimeCapabilities.focusHitbox }
      : {}),
  };
  // Executable Runtime belongs to the App Shell in every resource mode.
  const appRuntimeRoot = resolve(staging, "runtime", game);
  await mkdir(appRuntimeRoot, { recursive: true });
  const appRuntimeFiles = ["html", "js", "wasm"].map(extension => `${game}.${extension}`);
  await assertAppManagedRuntimeShell(builds[game], game, "normal");
  for (const extension of ["html", "js", "wasm"]) {
    await cp(resolve(builds[game], `${game}.${extension}`), resolve(appRuntimeRoot, `${game}.${extension}`));
  }
  const runtimeVersion = await versionFiles(appRuntimeRoot, appRuntimeFiles);
  await versionRuntimeScript(appRuntimeRoot, game, runtimeVersion);
  entry.runtime = `runtime/${game}/${game}.html?hosted=1&v=${runtimeVersion}`;
  let multiplayerRuntimeVersion = null;
  const multiplayerBuild = builds[`${game}Multiplayer`];
  if (multiplayerBuild) {
    const multiplayerRoot = resolve(appRuntimeRoot, "multiplayer");
    await mkdir(multiplayerRoot, { recursive: true });
    await assertAppManagedRuntimeShell(multiplayerBuild, game, "multiplayer");
    for (const extension of ["html", "js", "wasm"]) {
      await cp(resolve(multiplayerBuild, `${game}.${extension}`), resolve(multiplayerRoot, `${game}.${extension}`));
    }
    multiplayerRuntimeVersion = await versionFiles(multiplayerRoot, appRuntimeFiles);
    await versionRuntimeScript(multiplayerRoot, game, multiplayerRuntimeVersion);
    entry.multiplayerRuntime = `runtime/${game}/multiplayer/${game}.html?hosted=1&v=${multiplayerRuntimeVersion}`;
  }
  if (serverResourceMode === RESOURCE_MODE_IMPORT) {
    // Runtime artifacts belong to the Launcher/App, not to imported or
    // remotely acquired game content. Publish the supported App Runtime in
    // every resource mode; DATA, OGG, runtime fonts, language content and user
    // data remain separate. Keep only game-content identity/layout metadata in
    // the compatibility descriptor below.
    entry.offlineCompatibility = {
      schema: "eagler-touhou/offline-game-pack/1",
      runtimeCompatibility: {
        protocol: manifest.protocol,
        dataLayout: entry.gameData.layout,
        versionSource: "offline-pack"
      },
      requiredShared: [...(PRODUCT_GAMES[game].requiredShared ?? ["/msgothic.ttc", "/unifont.otf"])],
      languages: { source: "offline-pack", baseline: ["ja"] }
    };
    // A hosted catalog may already carry a Package Descriptor publication.
    // Import mode consumes that catalog only for compatibility identity; it
    // must not re-publish remote package acquisition metadata or a Release
    // Catalog entry because game content is user-supplied in this mode.
    delete entry.package;
    entry.languages = [];
    entry.languageOptions = [{ id: "ja", title: languageDisplayName("ja"), pack: null }];
    const ogg = entry.music?.ogg;
    entry.music = {
      midi: { files: [] },
      ...(ogg ? { ogg: {
        version: ogg.version,
        mount: ogg.mount,
        files: ogg.files,
        sizes: ogg.sizes,
        ...(ogg.sha256 ? { sha256: ogg.sha256 } : {})
      } } : {})
    };
    continue;
  }
  if (externalResources) continue;
  const gameRoot = resolve(staging, "games", game);
  await mkdir(gameRoot, { recursive: true });
  const assembled = await assemblePreloadData({
    game,
    runtimeScript: resolve(appRuntimeRoot, `${game}.js`),
    sourceDirectory: dataAssets[game],
    output: resolve(gameRoot, `${game}.data`),
  });
  const dataIdentity = await runtimeDataIdentity(gameRoot, game);
  const runtimeLayout = assembled.layout;
  if (dataIdentity.bytes !== runtimeLayout.bytes) throw new Error(`${game}: packaged DATA size does not match Runtime layout`);
  entry.gameData = { path: `${game}.data`, ...dataIdentity,
    version: `sha256-${dataIdentity.sha256}`, layout: runtimeLayout.layout };
  if (multiplayerBuild) {
    const multiplayerLayout = extractGameDataLayout(await readFile(resolve(appRuntimeRoot, "multiplayer", `${game}.js`), "utf8"), game);
    if (multiplayerLayout.bytes !== runtimeLayout.bytes || multiplayerLayout.layout !== runtimeLayout.layout) {
      throw new Error(`${game}: normal and multiplayer Runtime builds must use identical shared DATA content/layout`);
    }
  }
  const languagePack = languagePackSources[game];
  if (languagePack) {
    const { source, catalog } = languagePack;
    const catalogVersion = String(catalog.runtimeVersion).toLowerCase();
    entry.languages = [];
    const allowlist = serverFeatures[game].languages;
    const catalogLanguages = allowlist
      ? allowlist.filter(id => id !== "ja").map(id => catalog.languages.find(language => String(language?.id || "").toLowerCase() === id))
      : catalog.languages;
    for (const language of catalogLanguages) {
      if (!language?.id || !language.pack?.url) {
        throw new Error(`invalid ${game.toUpperCase()} language entry: ${language?.id}`);
      }
      const relativePack = staticPackPath(language.pack.url, game);
      const archivePath = resolve(source, relativePack);
      const archiveBytes = await readFile(archivePath);
      const sourceDigest = createHash("sha256").update(archiveBytes).digest("hex");
      const packRuntimeVersion = String(language.pack.runtimeVersion || catalogVersion).toLowerCase();
      if (!['pending', 'auto', 'independent'].includes(packRuntimeVersion) && !/^[a-f0-9]{16,64}$/i.test(packRuntimeVersion)) {
        throw new Error(`invalid ${game.toUpperCase()} language Runtime compatibility marker: ${language.id}`);
      }
      const prepared = {
        archive: archiveBytes,
        sha256: sourceDigest,
        manifest: { runtimeVersion: packRuntimeVersion },
      };
      const outputRelativePack = staticLanguagePackPath(language.id);
      const target = resolve(gameRoot, outputRelativePack);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, prepared.archive);
      entry.languages.push({
        ...language,
        pack: {
          ...language.pack,
          url: `games/${game}/${outputRelativePack}`,
          bytes: prepared.archive.length,
          sha256: prepared.sha256,
          runtimeVersion: packRuntimeVersion,
          files: Array.isArray(prepared.manifest?.files) ? prepared.manifest.files.length : language.pack.files
        }
      });
    }
  } else {
    entry.languages = [];
  }
  const selectableIds = canonicalLanguageIds(serverFeatures[game].languages ?? ["ja", ...entry.languages.map(language => language.id)]);
  entry.languageOptions = selectableIds.map(id => {
    if (id === "ja") return { id: "ja", title: languageDisplayName(id), pack: null };
    const language = entry.languages.find(item => String(item.id).toLowerCase() === id);
    if (!language) throw new Error(`${game.toUpperCase()} selectable language was not packaged: ${id}`);
    return { ...language, title: languageDisplayName(id, language.title) };
  });
  for (const mode of ["wav", "ogg"]) {
    if (!modes.has(mode)) {
      delete entry.music[mode];
      continue;
    }
    const pack = entry.music[mode];
    const sourceBase = musicSourceBase(game, mode);
    const targetBase = resolve(gameRoot, "music", mode);
    await copyFiles(sourceBase, targetBase, pack.files);
    pack.base = `games/${game}/music/${mode}/`;
    const identities = await Promise.all(pack.files.map(file => fileIdentity(resolve(sourceBase, file))));
    pack.sizes = identities.map(identity => identity.bytes);
    if (mode === "ogg") {
      Object.assign(pack, fileSetIdentity(pack.files, identities));
    } else {
      pack.version = await versionFiles(sourceBase, pack.files);
    }
  }

  // Package Descriptor is the transport-neutral owner shared by remote
  // publication and offline ZIP acquisition.
  const packageFiles = {};
  const baseFiles = [];
  packageFiles["game-data"] = await descriptorFile(`games/${game}/${game}.data`, `/${game}.data`);
  baseFiles.push("game-data");
  packageFiles["shared-msgothic"] = await descriptorFile("shared/msgothic.ttc", "/msgothic.ttc");
  packageFiles["shared-unifont"] = await descriptorFile("shared/unifont.otf", "/unifont.otf");
  baseFiles.push("shared-msgothic", "shared-unifont");

  const components = {};
  const oggPack = entry.music?.ogg;
  if (oggPack?.files?.length) {
    const oggFiles = [];
    const mount = String(oggPack.mount || "").replace(/\/$/, "");
    for (const name of oggPack.files) {
      const id = `ogg:${name}`;
      packageFiles[id] = await descriptorFile(`games/${game}/music/ogg/${name}`, `${mount}/${name}`);
      oggFiles.push(id);
    }
    components.ogg = { type: "ogg", files: oggFiles };
  }

  const languageEntries = [];
  for (const language of entry.languageOptions || []) {
    if (!language?.pack?.url || language.id === "ja") continue;
    const url = new URL(language.pack.url, "https://package.invalid/");
    if (url.origin !== "https://package.invalid" || !url.pathname.startsWith("/games/")) {
      throw new Error(`${game}: invalid packaged language URL ${language.pack.url}`);
    }
    const source = url.pathname.slice(1);
    const fileId = `language:${language.id}`;
    packageFiles[fileId] = await descriptorFile(source, `/__eagler/language/${language.id}.zip`);
    languageEntries.push({ id: language.id, title: language.title || language.id, file: fileId });
  }
  if (languageEntries.length) components.language = { type: "language", entries: languageEntries };

  const descriptor = {
    schema: PACKAGE_DESCRIPTOR_SCHEMA,
    game,
    revision: "pending",
    runtimeRequirement: {
      protocol: manifest.protocol,
      target: game,
      dataFile: "game-data",
      dataLayout: entry.gameData.layout,
    },
    files: packageFiles,
    base: { files: baseFiles },
    components,
  };
  descriptor.revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
  validatePackageDescriptor(descriptor);
  const descriptorName = `${game}.package.json`;
  await writeFile(resolve(staging, descriptorName), `${JSON.stringify(descriptor, null, 2)}\n`);
  entry.package = { revision: descriptor.revision, descriptor: descriptorName };
}

if (hostedResources && gameIds.includes("th08")) {
  const game = "th08";
  const entry = manifest.games?.[game];
  if (!entry) throw new Error("TH08 product entry is missing from Host Manifest");
  const gameRoot = resolve(staging, "games", game);
  await mkdir(gameRoot, { recursive: true });

  const packagedData = resolve(gameRoot, `${game}.data`);
  await cp(resolve(assets.th08, "th08.dat"), packagedData);
  const dataIdentity = await fileIdentity(packagedData);
  entry.gameData = { ...(entry.gameData || {}), path: `${game}.data`, bytes: dataIdentity.bytes,
    sha256: dataIdentity.sha256, version: `sha256-${dataIdentity.sha256}` };

  entry.features = { ...(entry.features || {}), thprac: false };
  entry.languages = [];
  entry.languageOptions = [{ id: "ja", title: languageDisplayName("ja"), pack: null }];

  if (!modes.has("ogg")) {
    delete entry.music.ogg;
  } else {
    const pack = entry.music?.ogg;
    if (!pack?.files?.length) throw new Error("TH08 hosted OGG metadata is missing from Host Manifest");
    if (!ogg.th08) throw new Error("TH08 hosted OGG source is required when OGG music is enabled");
    const sourceBase = musicSourceBase(game, "ogg");
    const targetBase = resolve(gameRoot, "music", "ogg");
    await copyFiles(sourceBase, targetBase, pack.files);
    pack.base = `games/${game}/music/ogg/`;
    const identities = await Promise.all(pack.files.map(file => fileIdentity(resolve(sourceBase, file))));
    pack.sizes = identities.map(identity => identity.bytes);
    Object.assign(pack, fileSetIdentity(pack.files, identities));
  }

  const packageFiles = {};
  const baseFiles = [];
  packageFiles["game-data"] = await descriptorFile(`games/${game}/${game}.data`, `/${game}.data`);
  baseFiles.push("game-data");
  packageFiles["shared-msgothic"] = await descriptorFile("shared/msgothic.ttc", "/msgothic.ttc");
  packageFiles["shared-unifont"] = await descriptorFile("shared/unifont.otf", "/unifont.otf");
  baseFiles.push("shared-msgothic", "shared-unifont");

  const components = {};
  const oggPack = entry.music?.ogg;
  if (oggPack?.files?.length) {
    const oggFiles = [];
    const mount = String(oggPack.mount || "").replace(/\/$/, "");
    for (const name of oggPack.files) {
      const id = `ogg:${name}`;
      packageFiles[id] = await descriptorFile(`games/${game}/music/ogg/${name}`, `${mount}/${name}`);
      oggFiles.push(id);
    }
    components.ogg = { type: "ogg", files: oggFiles };
  }

  const descriptor = {
    schema: PACKAGE_DESCRIPTOR_SCHEMA,
    game,
    revision: "pending",
    runtimeRequirement: {
      protocol: manifest.protocol,
      target: game,
      dataFile: "game-data",
      dataLayout: entry.gameData.layout,
    },
    files: packageFiles,
    base: { files: baseFiles },
    components,
  };
  descriptor.revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
  validatePackageDescriptor(descriptor);
  const descriptorName = `${game}.package.json`;
  await writeFile(resolve(staging, descriptorName), `${JSON.stringify(descriptor, null, 2)}\n`);
  entry.package = { revision: descriptor.revision, descriptor: descriptorName };
}

if (externalResources) {
  const sourceRoot = dirname(hostManifestPath);
  for (const [game, entry] of Object.entries(manifest.games)) {
    const pointer = entry.package;
    if (!pointer || typeof pointer.descriptor !== "string" || !pointer.descriptor ||
        basename(pointer.descriptor) !== pointer.descriptor) {
      throw new Error(`${game}: external publication is missing a safe Package Descriptor pointer`);
    }
    const descriptor = validatePackageDescriptor(JSON.parse(await readFile(resolve(sourceRoot, pointer.descriptor), "utf8")));
    const revision = createHash("sha256").update(canonicalPackagePayload(descriptor)).digest("hex").slice(0, 16);
    if (descriptor.game !== game || descriptor.revision !== pointer.revision || descriptor.revision !== revision) {
      throw new Error(`${game}: external Package Descriptor identity mismatch`);
    }
    for (const [fileId, file] of Object.entries(descriptor.files)) {
      if (!/^(?:games|shared)\//.test(file.source)) {
        throw new Error(`${game}: external Package source is outside redirect-owned routes: ${fileId}`);
      }
    }
    await writeFile(resolve(staging, pointer.descriptor), `${JSON.stringify(descriptor, null, 2)}\n`);
  }
}

const releaseCatalog = validateReleaseCatalog({
  schema: RELEASE_CATALOG_SCHEMA,
  games: Object.fromEntries(Object.entries(manifest.games).flatMap(([game, entry]) => entry.package
    ? [[game, { revision: entry.package.revision, descriptor: entry.package.descriptor }]]
    : [])),
});
validateHostManifest(manifest);
await writeFile(resolve(staging, HOST_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(staging, RELEASE_CATALOG_FILE), `${JSON.stringify(releaseCatalog, null, 2)}\n`);
const appShellBuild = await buildAppShell({
  quiet: true,
  globDirectory: staging,
  swDest: resolve(staging, "app-shell-sw.js"),
  additionalGlobPatterns: deploymentAppShellPatterns({ games: gameIds, hostArtwork: hostUiAssets }),
  deferredPaths: runtimeAppShellPaths(manifest),
  deferredPathPrefixes: ["runtime/"],
});

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
  ...(siteUrl ? { siteUrl } : {}),
  format: "eagler-touhou-deployment/1",
  profile: buildProfile,
  authority: buildAuthority,
  games: gameIds,
  releaseManifest: "release-manifest.json",
  generatedAt: new Date().toISOString(),
  resourceMode: serverResourceMode,
  appShell: appShellBuild.contract,
  music: serverResourceMode === RESOURCE_MODE_HOSTED ? [...modes].sort() : [],
  files: inventory,
};
await writeFile(resolve(staging, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`);
const sources = {};
const sourceOwners = runtimeRelease ? ["launcher"] : ["launcher", ...gameIds];
if (!runtimeRelease && languageGames.some(game => serverFeatures[game]?.thprac)) sourceOwners.push("thprac");
let packagedLauncherSource = null;
if (runtimeRelease) {
  try {
    const packaged = JSON.parse(await readFile(resolve(project, "self-host-provenance.json"), "utf8"));
    if (packaged.schema !== "eagler-touhou/self-host-bundle-provenance/1" ||
        packaged.launcherRepository !== WORKSPACE_REPOSITORIES.launcher ||
        !packaged.launcherSource || typeof packaged.launcherSource !== "object") {
      throw new Error("invalid self-host bundle provenance");
    }
    packagedLauncherSource = packaged.launcherSource;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
for (const owner of [...new Set(sourceOwners)]) {
  const repository = WORKSPACE_REPOSITORIES[owner];
  sources[repository] = owner === "launcher" && packagedLauncherSource
    ? packagedLauncherSource
    : await sourceIdentity(workspacePath(owner));
}
await writeReleaseManifest(staging, {
  profile: buildProfile,
  sources,
  parameters: { authority: buildAuthority, resourceMode: serverResourceMode, music: deployment.music,
    runtimeBuildProvenance: runtimeRelease ? "verified-runtime-release" : "not-verified-by-packager",
    ...(externalRecoveryProvenance ? { externalRecovery: externalRecoveryProvenance } : {}) },
});
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(JSON.stringify({ output, files: inventory.length + 3, bytes: inventory.reduce((sum, file) => sum + file.bytes, 0), music: deployment.music }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
