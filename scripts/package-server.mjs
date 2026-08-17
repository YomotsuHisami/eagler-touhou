import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { retargetStaticThcrapPack } from "../server/thcrap-static-pack.mjs";

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
const vanillaFont = required("vanilla-font");
const expectedUnifontSha256 = "7b62b50acbb186689dc30c446ce4367b87d79489e9907b83255f9fbe0dcfb9e1";
const fontSha256 = createHash("sha256").update(await readFile(font)).digest("hex");
if (fontSha256 !== expectedUnifontSha256) {
  throw new Error(`shared runtime font must be the pinned GNU Unifont 15.1.05 OTF (${expectedUnifontSha256}), got ${fontSha256}`);
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
if (args["feature-config"]) {
  const featurePath = resolve(args["feature-config"]);
  const configured = JSON.parse(await readFile(featurePath, "utf8"));
  if (configured?.schema !== "eagler-touhou/server-features/1" || !configured.games || typeof configured.games !== "object") {
    throw new Error(`invalid server feature config: ${featurePath}`);
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

const languagePackSources = Object.fromEntries(["th06", "th07"].map(game => {
  const source = args[`${game}-language-packs`] ? resolve(args[`${game}-language-packs`]) : null;
  return [game, source ? { source, catalog: null } : null];
}));
for (const game of ["th06", "th07"]) {
  const languagePack = languagePackSources[game];
  const selected = serverFeatures[game].languages?.filter(id => id !== "ja") ?? null;
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
  if (!serverFeatures[game].thprac) continue;
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
  for (const name of ["index.html", "about.html", "about.css", "styles.css", "touch-guide.css", "app.js", "NOTICE.txt", "CHANGELOG.txt", "README.md", "ASSETS.md", "THIRD_PARTY.md"]) {
    await cp(resolve(project, name), resolve(frontend, name));
  }
  await cp(resolve(project, "vendor"), resolve(frontend, "vendor"), { recursive: true });
  const publicAssets = [
    "th06-card.webp", "th07-card.webp",
    "th06-title00.jpg", "th07-title00.jpg",
    "touch-rotate-landscape.webp",
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

async function versionRuntimeScript(gameRoot, game, version) {
  const htmlPath = resolve(gameRoot, `${game}.html`);
  const source = await readFile(htmlPath, "utf8");
  const pattern = new RegExp(`(<script\\b[^>]*\\bsrc=)(["']?)${game}\\.js(?:\\?[^"'\\s>]*)?\\2`, "i");
  if (!pattern.test(source)) throw new Error(`runtime script reference missing: ${htmlPath}`);
  await writeFile(htmlPath, source.replace(pattern, `$1$2${game}.js?v=${version}$2`));
}

async function versionRuntimeDataCache(gameRoot, game, version) {
  const scriptPath = resolve(gameRoot, `${game}.js`);
  const source = await readFile(scriptPath, "utf8");
  const pattern = /(package_uuid:\s*["'])([^"']+)(["'])/;
  if (!pattern.test(source)) throw new Error(`runtime data cache UUID missing: ${scriptPath}`);
  await writeFile(scriptPath, source.replace(pattern, `$1$2-${version}$3`));
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
await cp(vanillaFont, resolve(staging, "shared", "msgothic.ttc"));
await cp(font, resolve(staging, "shared", "unifont.otf"));
manifest.shared = {
  vanillaFont: `../shared/msgothic.ttc?v=${await versionFiles(dirname(vanillaFont), [basename(vanillaFont)])}`,
  unicodeFont: `../shared/unifont.otf?v=${await versionFiles(dirname(font), [basename(font)])}`,
};

for (const game of ["th06", "th07"]) {
  const gameRoot = resolve(staging, "games", game);
  await mkdir(gameRoot, { recursive: true });
  const runtimeFiles = ["html", "js", "wasm", "data"].map(extension => `${game}.${extension}`);
  for (const extension of ["html", "js", "wasm", "data"]) {
    await cp(resolve(builds[game], `${game}.${extension}`), resolve(gameRoot, `${game}.${extension}`));
  }
  const entry = manifest.games[game];
  entry.features = { ...(entry.features || {}), thprac: !!serverFeatures[game].thprac };
  const buildVersion = await versionFiles(builds[game], runtimeFiles);
  await versionRuntimeDataCache(gameRoot, game, buildVersion);
  const runtimeVersion = await versionFiles(gameRoot, runtimeFiles);
  await versionRuntimeScript(gameRoot, game, runtimeVersion);
  entry.runtime = `../games/${game}/${game}.html?hosted=1&v=${runtimeVersion}`;
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
