import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { retargetStaticThcrapPack } from "../server/thcrap-static-pack.mjs";
import {
  PACKAGE_DESCRIPTOR_SCHEMA,
  canonicalPackagePayload,
  validatePackageDescriptor,
} from "../package-descriptor.mjs";
import { RELEASE_CATALOG_SCHEMA, validateReleaseCatalog } from "../release-catalog.mjs";
import { extractGameDataLayout } from "./game-data-layout.mjs";
import { buildAppShell } from "./build-app-shell.mjs";

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
const featureConfigPath = args["feature-config"] ? resolve(args["feature-config"]) : null;
const configuredFeatures = featureConfigPath ? JSON.parse(await readFile(featureConfigPath, "utf8")) : null;
if (configuredFeatures && (configuredFeatures.schema !== "eagler-touhou/server-features/1" ||
    !configuredFeatures.games || typeof configuredFeatures.games !== "object")) {
  throw new Error(`invalid server feature config: ${featureConfigPath}`);
}
if (configuredFeatures?.resourceMode != null && !["hosted", "import-only", "import-partial"].includes(configuredFeatures.resourceMode)) {
  throw new Error(`invalid resourceMode in server feature config: ${featureConfigPath}`);
}
const serverResourceMode = configuredFeatures?.resourceMode || "hosted";
const hostedResources = serverResourceMode === "hosted";
// Runtime HTML/JS/WASM are Launcher/App resources in every publication mode.
// Only game content/assets/fonts remain conditional on hosted-resource mode.
const builds = {
  th06: required("th06-build"),
  th06Multiplayer: required("th06-multiplayer-build"),
  th07: required("th07-build"),
  th07Multiplayer: required("th07-multiplayer-build"),
};
const assets = hostedResources ? { th06: required("th06-assets"), th07: required("th07-assets") } : { th06: null, th07: null };
const font = hostedResources ? required("font") : null;
const vanillaFont = hostedResources ? required("vanilla-font") : null;
const expectedUnifontSha256 = "7b62b50acbb186689dc30c446ce4367b87d79489e9907b83255f9fbe0dcfb9e1";
if (hostedResources) {
  const fontSha256 = createHash("sha256").update(await readFile(font)).digest("hex");
  if (fontSha256 !== expectedUnifontSha256) {
    throw new Error(`shared runtime font must be the pinned GNU Unifont 15.1.05 OTF (${expectedUnifontSha256}), got ${fontSha256}`);
  }
}
const ogg = { th06: args["th06-ogg"] && resolve(args["th06-ogg"]), th07: args["th07-ogg"] && resolve(args["th07-ogg"]) };
const modes = new Set((args.music || "midi,ogg").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
for (const mode of modes) if (!["midi", "wav", "ogg"].includes(mode)) throw new Error(`unsupported music mode: ${mode}`);
modes.add("midi");

const LANGUAGE_ID = /^(?:ja|lang_[a-z0-9]+(?:-[a-z0-9]+)*)$/i;
const LANGUAGE_DISPLAY_NAMES = Object.freeze({
  ja: "日本語",
  "lang_zh-hans": "中文（简体）",
  "lang_zh-hant": "中文（繁體）",
  lang_en: "English",
  lang_ru: "Русский",
});
const languagePriority = id => id === "ja" ? 0
  : id === "lang_zh-hans" ? 10
  : id === "lang_zh-hant" ? 11
  : id === "lang_en" ? 20
  : 100;
const canonicalLanguageIds = ids => [...ids].sort((a, b) =>
  languagePriority(a) - languagePriority(b) || a.localeCompare(b, "en"));
const languageDisplayName = (id, fallback) => LANGUAGE_DISPLAY_NAMES[id] || fallback || id;
const defaultFeatures = Object.freeze({
  th06: Object.freeze({ languages: null, thprac: false }),
  th07: Object.freeze({ languages: null, thprac: false }),
});
const serverFeatures = { th06: { ...defaultFeatures.th06 }, th07: { ...defaultFeatures.th07 } };
let serverGameDataFallback = null;
if (configuredFeatures) {
  const configured = configuredFeatures;
  if (configured.gameDataFallback != null) {
    const fallback = configured.gameDataFallback;
    if (typeof fallback !== "object" || typeof fallback.url !== "string" || !/^https:\/\//.test(fallback.url) ||
        (fallback.hint != null && typeof fallback.hint !== "string")) {
      throw new Error(`invalid gameDataFallback in server feature config: ${featureConfigPath}`);
    }
    serverGameDataFallback = { url: fallback.url, ...(fallback.hint ? { hint: fallback.hint } : {}) };
  }
  for (const game of ["th06", "th07"]) {
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
if (!hostedResources && !serverGameDataFallback) {
  throw new Error(`${serverResourceMode} requires gameDataFallback.url so the Launcher import dialog can open the game-package link: ${featureConfigPath || "server feature config"}`);
}

const languagePackSources = Object.fromEntries(["th06", "th07"].map(game => {
  const source = hostedResources && args[`${game}-language-packs`] ? resolve(args[`${game}-language-packs`]) : null;
  return [game, source ? { source, catalog: null } : null];
}));
for (const game of ["th06", "th07"]) {
  const languagePack = languagePackSources[game];
  const selected = hostedResources ? (serverFeatures[game].languages?.filter(id => id !== "ja") ?? null) : [];
  if (selected?.length && !languagePack) {
    throw new Error(`${game.toUpperCase()} language allowlist requests downloadable packs, but no language-pack directory was provided`);
  }
  if (!languagePack) continue;
  languagePack.catalog = JSON.parse(await readFile(resolve(languagePack.source, "catalog.json"), "utf8"));
  if (languagePack.catalog.schema !== "eagler-touhou/thcrap-static-catalog/1" ||
      languagePack.catalog.game !== game || !Array.isArray(languagePack.catalog.languages) ||
      (!["pending", "auto"].includes(String(languagePack.catalog.runtimeVersion).toLowerCase()) &&
       !/^[a-f0-9]{16,64}$/i.test(languagePack.catalog.runtimeVersion || ""))) {
    throw new Error(`invalid ${game.toUpperCase()} language catalog: ${languagePack.source}`);
  }
  if (selected) {
    const available = new Set(languagePack.catalog.languages.map(item => String(item?.id || "").toLowerCase()));
    const missingLanguages = selected.filter(id => !available.has(id));
    if (missingLanguages.length) throw new Error(`${game.toUpperCase()} language allowlist is missing prepared packs: ${missingLanguages.join(", ")}`);
  }
}

for (const game of ["th06", "th07"]) {
  if (!hostedResources || !serverFeatures[game].thprac) continue;
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
  if (parts.some(part => !part || part === "." || part === "..") || !value.startsWith(`thcrap/${game}/`)) {
    throw new Error(`invalid language pack URL: ${value}`);
  }
  return value;
}

async function copyFrontend() {
  const frontend = resolve(staging, "eagler-touhou");
  await mkdir(frontend, { recursive: true });
  for (const name of [
    "index.html", "site.webmanifest", "app-shell-sw.js", "migrate.html", "about.html", "faq.html", "about.css", "styles.css", "touch-guide.css",
    "app.js", "game-data-import.js", "game-data-import.mjs", "network-activity.mjs", "package-descriptor.mjs", "package-generation.mjs", "package-store.mjs",
    "runtime-preparation.mjs", "package-zip.mjs", "package-installer.mjs", "package-launcher.mjs",
    "product-catalog.mjs", "release-catalog.mjs",
    "NOTICE.txt", "CHANGELOG.txt", "README.md", "ASSETS.md", "THIRD_PARTY.md"
  ]) {
    await cp(resolve(project, name), resolve(frontend, name));
  }
  await cp(resolve(project, "vendor"), resolve(frontend, "vendor"), { recursive: true });
  const publicAssets = [
    "th06-card.webp", "th07-card.webp",
    "th06-title00.jpg", "th07-title00.jpg",
    "touch-rotate-landscape.webp",
    "th06.ico",
    "notice-bilibili.svg", "notice-touhou-cloud.png",
    "fonts/touhou98.woff2",
    "fonts/unifont-site.woff2",
    "fonts/noto-serif-sc-touhou.woff2", "fonts/OFL-NotoSerifSC.txt",
    "fonts/yatra-one-latin.woff2", "fonts/chill-round-gothic-site-medium.woff2", "fonts/chill-round-gothic-site-bold.woff2", "fonts/chill-round-gothic-site-heavy.woff2", "fonts/OFL-YatraOne.txt", "fonts/OFL-ChillRoundGothic.txt",
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
  };
}

async function versionRuntimeScript(gameRoot, game, version) {
  const htmlPath = resolve(gameRoot, `${game}.html`);
  const source = await readFile(htmlPath, "utf8");
  const pattern = new RegExp(`(<script\\b[^>]*\\bsrc=)(["']?)${game}\\.js(?:\\?[^"'\\s>]*)?\\2`, "i");
  if (!pattern.test(source)) throw new Error(`runtime script reference missing: ${htmlPath}`);
  await writeFile(htmlPath, source.replace(pattern, `$1$2${game}.js?v=${version}$2`));
}

async function assertAppManagedRuntimeShell(buildRoot, game, variant) {
  const htmlPath = resolve(buildRoot, `${game}.html`);
  const source = await readFile(htmlPath, "utf8");
  if (!source.includes("window.parent.__eaglerPrepareManagedRuntimeDataV1") ||
      !source.includes("Module.getPreloadedPackage")) {
    throw new Error(`${game} ${variant} Runtime shell is stale: App-managed DATA preload hook is missing`);
  }
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

await rm(staging, { recursive: true, force: true });
await buildAppShell({ quiet: true });
await copyFrontend();
const manifest = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
manifest.shared = {
  resourceMode: serverResourceMode,
  ...(serverResourceMode === "hosted" ? {
    vanillaFont: `../shared/msgothic.ttc?v=${await versionFiles(dirname(vanillaFont), [basename(vanillaFont)])}`,
    unicodeFont: `../shared/unifont.otf?v=${await versionFiles(dirname(font), [basename(font)])}`,
  } : {}),
  ...(serverGameDataFallback ? { gameDataFallback: serverGameDataFallback } : {}),
};

if (serverResourceMode === "hosted") {
  await mkdir(resolve(staging, "shared"), { recursive: true });
  await cp(vanillaFont, resolve(staging, "shared", "msgothic.ttc"));
  await cp(font, resolve(staging, "shared", "unifont.otf"));
}

for (const game of ["th06", "th07"]) {
  const entry = manifest.games[game];
  entry.features = { ...(entry.features || {}), thprac: !!serverFeatures[game].thprac };
  // Executable Runtime belongs to the App Shell in every resource mode.
  const appRuntimeRoot = resolve(staging, "eagler-touhou", "runtime", game);
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
  if (serverResourceMode !== "hosted") {
    // Runtime HTML/JS/WASM belong to the Launcher/App, not to imported or
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
      requiredShared: ["/msgothic.ttc", "/unifont.otf"],
      languages: { source: "offline-pack", baseline: ["ja"] }
    };
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
  const gameRoot = resolve(staging, "games", game);
  await mkdir(gameRoot, { recursive: true });
  await cp(resolve(builds[game], `${game}.data`), resolve(gameRoot, `${game}.data`));
  const dataIdentity = await runtimeDataIdentity(gameRoot, game);
  const runtimeLayout = extractGameDataLayout(await readFile(resolve(appRuntimeRoot, `${game}.js`), "utf8"), game);
  if (entry.gameData?.path !== `${game}.data` || entry.gameData?.bytes !== dataIdentity.bytes ||
      String(entry.gameData?.sha256 || "").toLowerCase() !== dataIdentity.sha256 ||
      entry.gameData?.version !== `sha256-${dataIdentity.sha256}` || entry.gameData?.layout !== runtimeLayout.layout ||
      entry.gameData?.bytes !== runtimeLayout.bytes) {
    throw new Error(`${game}: games.json gameData identity does not match packaged .data`);
  }
  if (multiplayerBuild) {
    const multiplayerDataIdentity = await fileIdentity(resolve(multiplayerBuild, `${game}.data`));
    const multiplayerLayout = extractGameDataLayout(await readFile(resolve(appRuntimeRoot, "multiplayer", `${game}.js`), "utf8"), game);
    if (multiplayerDataIdentity.bytes !== dataIdentity.bytes || multiplayerDataIdentity.sha256 !== dataIdentity.sha256 ||
        multiplayerLayout.bytes !== runtimeLayout.bytes || multiplayerLayout.layout !== runtimeLayout.layout) {
      throw new Error(`${game}: normal and multiplayer Runtime builds must use identical shared DATA content/layout`);
    }
  }
  const languagePack = languagePackSources[game];
  if (languagePack) {
    const { source, catalog } = languagePack;
    const catalogVersion = String(catalog.runtimeVersion).toLowerCase();
    if (!['pending', 'auto'].includes(catalogVersion) && catalogVersion !== runtimeVersion) {
      throw new Error(`${game.toUpperCase()} language catalog targets ${catalog.runtimeVersion}, current runtime is ${runtimeVersion}`);
    }
    entry.languages = [];
    const allowlist = serverFeatures[game].languages;
    const catalogLanguages = allowlist
      ? allowlist.filter(id => id !== "ja").map(id => catalog.languages.find(language => String(language?.id || "").toLowerCase() === id))
      : catalog.languages;
    for (const language of catalogLanguages) {
      if (!language?.id || !language.pack?.sha256 || !Number.isInteger(language.pack.bytes)) {
        throw new Error(`invalid ${game.toUpperCase()} language entry: ${language?.id}`);
      }
      const relativePack = staticPackPath(language.pack.url, game);
      const archivePath = resolve(source, relativePack);
      const archiveInfo = await stat(archivePath);
      const archiveBytes = await readFile(archivePath);
      const sourceDigest = createHash("sha256").update(archiveBytes).digest("hex");
      if (sourceDigest !== language.pack.sha256 || archiveInfo.size !== language.pack.bytes) {
        throw new Error(`${game.toUpperCase()} language pack checksum mismatch: ${language.id}`);
      }
      const prepared = catalogVersion === "pending" || catalogVersion === "auto"
        ? retargetStaticThcrapPack(archiveBytes, runtimeVersion) : {
          archive: archiveBytes,
          sha256: sourceDigest,
          fileName: relativePack.split("/").at(-1),
          manifest: { runtimeVersion }
        };
      const outputRelativePack = `thcrap/${game}/${runtimeVersion}/${prepared.fileName}`;
      const target = resolve(gameRoot, outputRelativePack);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, prepared.archive);
      entry.languages.push({
        ...language,
        pack: {
          ...language.pack,
          url: `../games/${game}/${outputRelativePack}`,
          bytes: prepared.archive.length,
          sha256: prepared.sha256,
          runtimeVersion,
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
    const sourceBase = mode === "wav"
      ? (game === "th06" ? resolve(assets.th06, "bgm") : assets.th07)
      : (game === "th06" ? resolve(ogg.th06, "bgm") : resolve(ogg.th07, "bgm-ogg"));
    const targetBase = resolve(gameRoot, "music", mode);
    await copyFiles(sourceBase, targetBase, pack.files);
    pack.base = `../games/${game}/music/${mode}/`;
    const identities = await Promise.all(pack.files.map(file => fileIdentity(resolve(sourceBase, file))));
    pack.sizes = identities.map(identity => identity.bytes);
    if (mode === "ogg") {
      const hashes = identities.map(identity => identity.sha256);
      if (!Array.isArray(pack.sha256) || pack.sha256.length !== hashes.length ||
          pack.sha256.some((hash, index) => String(hash).toLowerCase() !== hashes[index])) {
        throw new Error(`${game}: games.json OGG hashes do not match packaged files`);
      }
      const setHash = createHash("sha256")
        .update(JSON.stringify(pack.files.map((file, index) => [file, pack.sizes[index], hashes[index]])))
        .digest("hex");
      if (pack.version !== `sha256-${setHash}`) {
        throw new Error(`${game}: games.json OGG version does not match packaged OGG content set`);
      }
      pack.sha256 = hashes;
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
    const url = new URL(language.pack.url, "https://package.invalid/eagler-touhou/");
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
  entry.package = { revision: descriptor.revision, descriptor: `../${descriptorName}` };
}
const releaseCatalog = validateReleaseCatalog({
  schema: RELEASE_CATALOG_SCHEMA,
  games: Object.fromEntries(Object.entries(manifest.games).flatMap(([game, entry]) => entry.package
    ? [[game, { revision: entry.package.revision, descriptor: entry.package.descriptor }]]
    : [])),
});
await writeFile(resolve(staging, "eagler-touhou", "legacy-games.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(staging, "eagler-touhou", "games.json"), `${JSON.stringify(releaseCatalog, null, 2)}\n`);
await buildAppShell({
  quiet: true,
  globDirectory: resolve(staging, "eagler-touhou"),
  swDest: resolve(staging, "eagler-touhou", "app-shell-sw.js"),
  additionalGlobPatterns: ["runtime/**/*.html", "runtime/**/*.js", "runtime/**/*.wasm"],
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
  format: "eagler-touhou-deployment/1",
  generatedAt: new Date().toISOString(),
  resourceMode: serverResourceMode,
  music: serverResourceMode === "hosted" ? [...modes].sort() : [],
  files: inventory,
};
await writeFile(resolve(staging, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(JSON.stringify({ output, files: inventory.length + 1, bytes: inventory.reduce((sum, file) => sum + file.bytes, 0), music: deployment.music }));
