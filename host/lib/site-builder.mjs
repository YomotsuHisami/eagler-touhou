import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectHostWorkspace } from "../../lib/host-workspace.mjs";
import { PRODUCT_CONTENT } from "../../lib/content-definition.mjs";
import { PRODUCT_GAMES } from "../../lib/contracts/product-catalog.mjs";
import { workspacePath } from "../../lib/workspace-layout.mjs";
import { ensurePythonEnvironment } from "./python-environment.mjs";
import { ensureThtk } from "./thtk.mjs";
import { run } from "./process.mjs";

const GAMES = Object.freeze(Object.keys(PRODUCT_CONTENT));
const DEFAULT_LANGUAGES = Object.freeze(["ja", "lang_zh-hans", "lang_en"]);

function script(projectRoot, path) {
  return resolve(projectRoot, path);
}

async function fileExists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function treeHasFileNewerThan(root, cutoff) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (await treeHasFileNewerThan(path, cutoff)) return true;
    } else if (entry.isFile() && (await stat(path)).mtimeMs > cutoff) {
      return true;
    }
  }
  return false;
}

export async function reusableHostedBase(projectRoot, layout) {
  let deployment;
  try {
    deployment = JSON.parse(await readFile(resolve(layout.site, "deployment.json"), "utf8"));
  } catch {
    return false;
  }
  if (deployment.format !== "eagler-touhou-deployment/1" ||
      deployment.profile !== "web-validation-self-host" ||
      deployment.resourceMode !== "hosted") return false;
  const actualGames = Array.isArray(deployment.games)
    ? [...new Set(deployment.games.map(value => String(value).toLowerCase()))].sort()
    : [];
  if (actualGames.join(",") !== [...GAMES].sort().join(",")) return false;
  const actualMusic = Array.isArray(deployment.music)
    ? [...new Set(deployment.music.map(value => String(value).toLowerCase()))].sort()
    : [];
  if (actualMusic.join(",") !== [...layout.music].sort().join(",")) return false;
  const generatedAt = Date.parse(String(deployment.generatedAt || ""));
  if (!Number.isFinite(generatedAt)) return false;
  // Old hosted sites can pass structural verification while omitting a newly
  // enabled language capability. Rebuild them before reusing their resources.
  try {
    const manifest = JSON.parse(await readFile(resolve(layout.site, "host-manifest.json"), "utf8"));
    for (const game of GAMES) {
      if (!PRODUCT_GAMES[game].features.languages) continue;
      const options = manifest.games?.[game]?.languageOptions;
      if (!Array.isArray(options) || DEFAULT_LANGUAGES.some(id =>
        !options.some(option => option.id === id && (id === "ja" || option.pack)))) return false;
    }
  } catch {
    return false;
  }
  const provenancePath = resolve(projectRoot, "self-host-provenance.json");
  if (existsSync(provenancePath)) {
    try {
      const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
      const releaseManifest = JSON.parse(await readFile(resolve(layout.site, "release-manifest.json"), "utf8"));
      if (provenance.schema !== "eagler-touhou/self-host-bundle-provenance/1" ||
          !provenance.launcherRepository || !provenance.launcherSource ||
          JSON.stringify(releaseManifest.sources?.[provenance.launcherRepository]) !== JSON.stringify(provenance.launcherSource)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  for (const root of [layout.runtimeRelease, layout.shared, ...GAMES.map(game => layout.games[game])]) {
    if (await treeHasFileNewerThan(root, generatedAt)) return false;
  }
  if (existsSync(layout.config) && (await stat(layout.config)).mtimeMs > generatedAt) return false;
  const verification = await run(process.execPath, [script(projectRoot, "scripts/verify-server-build.mjs"), layout.site], {
    cwd: projectRoot,
    capture: true,
    allowFailure: true,
  });
  return verification.code === 0;
}

async function resolveFonts(projectRoot, layout) {
  let unicode = layout.bundledFonts.unicode;
  if (!unicode) unicode = workspacePath("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf");
  if (!await fileExists(unicode)) throw new Error(`Unicode font not found: ${unicode}`);

  let japanese = layout.bundledFonts.japanese;
  if (!japanese && process.platform === "win32" && process.env.WINDIR) {
    const windowsFont = resolve(process.env.WINDIR, "Fonts", "msgothic.ttc");
    if (await fileExists(windowsFont)) japanese = windowsFont;
  }
  if (!japanese) {
    japanese = unicode;
    console.warn("[Build] Japanese runtime font is not bundled; using the Unicode font fallback");
  }
  return Object.freeze({ unicode, japanese });
}

async function prepareFeatureConfig(projectRoot, layout, resourceMode) {
  const basePath = script(projectRoot, "host/config/site-features.default.json");
  const features = JSON.parse(await readFile(basePath, "utf8"));
  features.resourceMode = resourceMode;
  for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
    if (!product.features.languages && !product.features.thprac) continue;
    features.games[game] = {
      ...(product.features.languages ? { languages: [...DEFAULT_LANGUAGES] } : {}),
      ...(product.features.thprac ? { thprac: true } : {}),
    };
  }
  if (layout.hostConfig.netplay.relay) features.netplayRelay = layout.hostConfig.netplay.relay;
  else delete features.netplayRelay;
  if (layout.hostConfig.externalImportSource.url) {
    features.gameDataFallback = {
      url: layout.hostConfig.externalImportSource.url,
      ...(layout.hostConfig.externalImportSource.hint ? { hint: layout.hostConfig.externalImportSource.hint } : {}),
    };
  } else {
    delete features.gameDataFallback;
  }
  const path = resolve(tmpdir(), `eagler-touhou-host-features-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(features, null, 2)}\n`);
  return path;
}

async function prepareLanguages(projectRoot, layout, python, thtk, font) {
  const languageRoot = resolve(layout.root, ".cache", "generated", "language-packs");
  const games = GAMES.filter(game => PRODUCT_GAMES[game].features.languages);
  const requestedLanguages = ["lang_zh-hans", "lang_en"];
  let task = 0;
  const total = games.length * requestedLanguages.length;
  const prepared = {};
  for (const language of requestedLanguages) {
    const label = language === "lang_zh-hans" ? "Simplified Chinese" : "English";
    for (const game of games) {
      const preparation = PRODUCT_CONTENT[game].hostPreparation?.languagePack;
      if (preparation?.kind !== "thcrap-runtime-compiler") {
        throw new Error(`${game}: language capability has no supported Host preparation declaration`);
      }
      const output = resolve(languageRoot, game);
      prepared[game] = output;
      const args = [
        script(projectRoot, "scripts/prepare-th06-language-pack.mjs"),
        "--game", game, "--language", language,
        "--thdat", thtk.thdat, "--thmsg", thtk.thmsg,
        "--output", output,
        "--font-file", font, "--font-python", python,
      ];
      if (preparation.inputMode === "archives") {
        args.push("--archives", PRODUCT_CONTENT[game].original.files.map(name => resolve(layout.games[game], name)).join(";"));
      } else if (preparation.inputMode === "archive" && preparation.archive) {
        args.push("--archive", resolve(layout.games[game], preparation.archive));
      } else {
        throw new Error(`${game}: invalid language Host preparation input mode`);
      }
      console.log(`[Languages ${++task}/${total}] ${game.toUpperCase()} ${label}`);
      await run(process.execPath, args, { cwd: projectRoot });
    }
  }
  console.log("Default languages ready: Japanese / Simplified Chinese / English");
  return Object.freeze(prepared);
}

async function prepareArtwork(projectRoot, layout, python, thtk) {
  const output = resolve(layout.root, ".cache", "generated", "host-artwork");
  const args = [
    script(projectRoot, "scripts/prepare-host-artwork.py"),
    `--output=${output}`,
    `--games=${GAMES.join(",")}`,
    ...GAMES.map(game => `--game-dir=${game}=${layout.games[game]}`),
  ];
  if (thtk?.thdat) args.push(`--thdat=${thtk.thdat}`);
  if (thtk?.thanm) args.push(`--thanm=${thtk.thanm}`);
  await run(python, args, { cwd: projectRoot });
  return output;
}

async function prepareDeclaredContent(projectRoot, layout) {
  const prepared = {};
  for (const game of GAMES) {
    const declaration = PRODUCT_CONTENT[game].hostPreparation?.preparedContent;
    if (!declaration) continue;
    const output = resolve(layout.root, ".cache", "generated", game);
    await rm(output, { recursive: true, force: true });
    const supplied = resolve(layout.games[game], declaration.directory);
    const markers = await Promise.all(declaration.markerFiles.map(name => fileExists(resolve(supplied, name))));
    if (markers.length > 0 && markers.every(Boolean)) {
      await cp(supplied, output, { recursive: true });
      prepared[game] = output;
      continue;
    }
    const preparationScript = resolve(projectRoot, declaration.script);
    if (!await fileExists(preparationScript)) {
      throw new Error(`${game.toUpperCase()} content is missing: provide ${supplied} or ${declaration.script}`);
    }
    await run(process.execPath, [
      preparationScript,
      `--original=${layout.games[game]}`,
      `--output=${output}`,
    ], { cwd: projectRoot });
    prepared[game] = output;
  }
  return Object.freeze(prepared);
}

async function prepareDeclaredDataAssets(projectRoot, layout, python, fonts, preparedContent) {
  const prepared = {};
  for (const game of GAMES) {
    const declaration = PRODUCT_CONTENT[game].hostPreparation?.dataAssets;
    if (!declaration) continue;
    if (declaration.kind === "prepared-content") {
      if (!preparedContent[game]) throw new Error(`${game}: prepared DATA content is unavailable`);
      prepared[game] = preparedContent[game];
      continue;
    }
    if (declaration.kind !== "legacy-preload-with-focus-hitbox") {
      throw new Error(`${game}: unsupported Host DATA preparation kind ${declaration.kind}`);
    }
    const output = resolve(layout.root, ".cache", "generated", `${game}-data-assets`);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await cp(fonts.unicode, resolve(output, "unifont.otf"));
    await cp(fonts.japanese, resolve(output, "msgothic.ttc"));
    for (const name of PRODUCT_CONTENT[game].original.files) await cp(resolve(layout.games[game], name), resolve(output, name));

    const focus = declaration.focusHitbox;
    if (!focus || !PRODUCT_CONTENT[focus.sourceGame]) throw new Error(`${game}: invalid focus-hitbox Host preparation declaration`);
    const hitbox = resolve(output, focus.output);
    const result = await run(python, [
      script(projectRoot, "scripts/touhou_formats.py"), focus.extractor,
      "--archive", resolve(layout.games[focus.sourceGame], focus.archive),
      "--anm", focus.anm,
      "--texture", focus.texture,
      "--output", hitbox,
    ], { cwd: projectRoot, capture: true, allowFailure: true });
    if (result.code !== 0) {
      await rm(hitbox, { force: true });
      console.warn(`[Host] ${game.toUpperCase()} optional focus-hitbox extraction was unavailable${result.stderr ? `: ${result.stderr}` : ""}`);
    }
    prepared[game] = output;
  }
  return Object.freeze(prepared);
}

async function prepareOgg(projectRoot, layout, python, preparedContent) {
  const roots = {};
  for (const game of GAMES) {
    const preparation = PRODUCT_CONTENT[game].hostPreparation?.ogg;
    if (preparation?.kind === "prepared-content") {
      if (!preparedContent[game]) throw new Error(`${game}: prepared OGG content is unavailable`);
      roots[game] = preparedContent[game];
      continue;
    }
    if (preparation?.kind !== "verified-converter" || !preparation.outputDirectory) {
      throw new Error(`${game}: required OGG capability has no supported Host preparation declaration`);
    }
    const output = resolve(layout.root, ".cache", "generated", game, preparation.outputDirectory);
    await run(python, [
      script(projectRoot, "scripts/convert_bgm_ogg.py"),
      "--game", game,
      "--original-dir", layout.games[game],
      "--output", output,
      "--baseline", script(projectRoot, `host/ogg-baselines/${game}.json`),
    ], { cwd: projectRoot });
    roots[game] = resolve(layout.root, ".cache", "generated", game);
  }
  return Object.freeze(roots);
}

export async function buildHostedSite({ projectRoot, hostRoot, music = "midi,ogg", python = "python" }) {
  const layout = await inspectHostWorkspace(hostRoot, { music });
  const modes = [...layout.music];
  console.log("[Build 1/6] Preparing build environment");
  const hostPython = await ensurePythonEnvironment({ projectRoot, hostRoot: layout.root, python });
  const thtk = await ensureThtk({ hostRoot: layout.root });
  const fonts = await resolveFonts(projectRoot, layout);

  console.log("[Build 2/6] Preparing language packs");
  const languages = await prepareLanguages(projectRoot, layout, hostPython, thtk, fonts.unicode);
  console.log("[Build 3/6] Preparing Launcher artwork");
  const artwork = await prepareArtwork(projectRoot, layout, hostPython, thtk);
  const preparedContent = await prepareDeclaredContent(projectRoot, layout);
  const dataAssets = await prepareDeclaredDataAssets(projectRoot, layout, hostPython, fonts, preparedContent);
  console.log("[Build 4/6] Preparing music");
  const ogg = modes.includes("ogg") ? await prepareOgg(projectRoot, layout, hostPython, preparedContent) : null;
  const features = await prepareFeatureConfig(projectRoot, layout, "hosted");
  try {
    console.log("[Build 5/6] Assembling static site");
    const args = [
      script(projectRoot, "scripts/package-server.mjs"),
      `--output=${layout.site}`,
      `--font=${fonts.unicode}`,
      `--vanilla-font=${fonts.japanese}`,
      `--music=${modes.join(",")}`,
      `--feature-config=${features}`,
      `--artwork-dir=${artwork}`,
      `--games=${GAMES.join(",")}`,
      "--profile=web-validation-self-host",
      `--runtime-release=${layout.runtimeRelease}`,
      ...GAMES.map(game => `--${game}-assets=${layout.games[game]}`),
      ...Object.entries(dataAssets).map(([game, path]) => `--${game}-data-assets=${path}`),
      ...Object.entries(languages).map(([game, path]) => `--${game}-language-packs=${path}`),
    ];
    if (ogg) {
      for (const game of GAMES) args.push(`--${game}-ogg=${ogg[game]}`);
    }
    await run(process.execPath, args, { cwd: projectRoot });
    console.log("[Build 6/6] Verifying generated site");
    await run(process.execPath, [script(projectRoot, "scripts/verify-server-build.mjs"), layout.site], { cwd: projectRoot });
  } finally {
    await rm(features, { force: true });
  }
  return Object.freeze({ layout, python: hostPython, thtk, fonts });
}

export async function buildImportArtifacts({
  projectRoot,
  hostRoot,
  music = "midi,ogg",
  python = "python",
  rebuildHostedBase = false,
  testBuild = false,
}) {
  let layout = await inspectHostWorkspace(hostRoot, { music });
  if (!rebuildHostedBase && await reusableHostedBase(projectRoot, layout)) {
    console.log(`Reusing verified hosted base: ${layout.site}`);
  } else {
    ({ layout } = await buildHostedSite({ projectRoot, hostRoot, music, python }));
  }
  const features = await prepareFeatureConfig(projectRoot, layout, "import");
  const packageTemporaryRoot = resolve(layout.dist, ".tmp");
  const packageStaging = resolve(packageTemporaryRoot, `import.staging-${randomUUID()}`);
  try {
    console.log("[Import 1/3] Assembling import site");
    await run(process.execPath, [
      script(projectRoot, "scripts/package-server.mjs"),
      `--output=${layout.importSite}`,
      `--feature-config=${features}`,
      `--host-manifest=${resolve(layout.site, "host-manifest.json")}`,
      `--runtime-release=${layout.runtimeRelease}`,
      `--artwork-dir=${resolve(layout.site, "assets")}`,
      `--games=${GAMES.join(",")}`,
      "--profile=web-validation-self-host-import",
      `--test-build=${testBuild ? "1" : "0"}`,
    ], { cwd: projectRoot });
    await run(process.execPath, [script(projectRoot, "scripts/verify-server-build.mjs"), layout.importSite], { cwd: projectRoot });

    console.log("[Import 2/3] Building game-content packages");
    await mkdir(packageStaging, { recursive: true });
    for (const game of GAMES) {
      const archive = resolve(packageStaging, `${game}.zip`);
      await run(process.execPath, [script(projectRoot, "scripts/package-offline-game.mjs"), layout.site, game, archive], { cwd: projectRoot });
      await run(process.execPath, [script(projectRoot, "scripts/verify-offline-game-package.mjs"), archive, game], { cwd: projectRoot });
    }
    await rm(layout.importPackages, { recursive: true, force: true });
    await mkdir(resolve(layout.importPackages, ".."), { recursive: true });
    await rename(packageStaging, layout.importPackages);
    console.log("[Import 3/3] Import artifacts verified");
  } finally {
    await rm(features, { force: true });
    await rm(packageStaging, { recursive: true, force: true });
  }
  return Object.freeze({ layout });
}
