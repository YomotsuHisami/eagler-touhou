import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createThcrapClient, downloadThcrapPack } from "../integrations/thcrap.mjs";
import { ThcrapRuntimeCompiler } from "../server/thcrap-compiler.mjs";
import { ThtkRunner } from "../server/thtk-runner.mjs";
import { createStaticThcrapPack } from "../server/thcrap-static-pack.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
  args.set(key.slice(2), value); index++;
}

const required = name => {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}=PATH`);
  return resolve(value);
};
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const game = (args.get("game") || "th06").toLowerCase();
if (!new Set(["th06", "th07"]).has(game)) throw new Error(`unsupported game: ${game}`);
const language = args.get("language") || "lang_zh-hans";
const repository = args.get("repository");
const output = resolve(args.get("output") || "prepared/thcrap-static");
const runtimeVersion = (args.get("runtime-version") || "auto").toLowerCase();
const thdat = required("thdat");
const thmsg = required("thmsg");
const archives = (args.get("archives") || required("archive")).split(";").filter(Boolean).map(value => resolve(value));
const fontFile = args.get("font-file")
  ? resolve(args.get("font-file"))
  : resolve(workspace, "dependencies", "unifont-15.1.05", "unifont-15.1.05.otf");
const fontName = args.get("font-name") || "Unifont";
const fontPython = args.get("font-python") || "python";
const client = createThcrapClient({ repository });
const runner = new ThtkRunner({ thdat, thmsg });
const compiler = new ThcrapRuntimeCompiler({ runner, archives: { [game]: archives } });

const pack = await client.resolveLanguage(language, game);
const downloaded = await downloadThcrapPack(pack, {
  onProgress: ({ completed, total, path }) => process.stderr.write(`\r${completed}/${total} ${path}                    `)
});
const resources = await compiler.processPack(downloaded.resources);

function collectStrings(value, output) {
  if (typeof value === "string") {
    for (const character of value.normalize("NFC")) {
      const codepoint = character.codePointAt(0);
      if (codepoint >= 0x20 && !(codepoint >= 0x7f && codepoint <= 0x9f)) output.add(character);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
}

async function applyFontOverride(input) {
  if (!fontFile) return input;
  const characters = new Set(Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)));
  for (const resource of downloaded.resources) {
    if (resource.kind !== "jdiff" && resource.kind !== "table") continue;
    try { collectStrings(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resource.bytes)), characters); } catch {}
  }
  const extension = extname(fontFile).toLowerCase();
  if (!new Set([".otf", ".ttf"]).has(extension)) throw new Error(`unsupported font format: ${fontFile}`);
  const outputName = `${basename(fontFile, extension).replace(/[^a-zA-Z0-9._-]+/g, "-")}-subset${extension}`;
  const targetPath = `/thcrap/${game}/fonts/${outputName}`;
  const temporary = await mkdtemp(join(tmpdir(), "eagler-thcrap-font-"));
  try {
    const characterFile = join(temporary, "characters.txt");
    const outputFile = join(temporary, outputName);
    await writeFile(characterFile, [...characters].sort().join(""), "utf8");
    const subset = await promisify(execFile)(fontPython, [
      resolve("scripts/subset-font.py"), fontFile,
      `--text-file=${characterFile}`,
      `--output-file=${outputFile}`
    ], { maxBuffer: 8 * 1024 * 1024 });
    const filtered = input.filter(resource => !/^\/thcrap\/[^/]+\/fonts\//i.test(resource.targetPath || ""));
    let optionsFound = false;
    for (const resource of filtered) {
      if (resource.targetPath !== `/thcrap/${game}/localization/options.json`) continue;
      const options = JSON.parse(Buffer.from(resource.bytes).toString("utf8"));
      options.font = fontName;
      options.fontFile = outputName;
      resource.bytes = Buffer.from(`${JSON.stringify(options)}\n`);
      optionsFound = true;
    }
    if (!optionsFound) throw new Error(`${game}: localization options were not generated`);
    filtered.push({
      path: outputName,
      mountPath: targetPath,
      targetPath,
      bytes: await readFile(outputFile),
      extension,
      format: extension === ".otf" ? "font/otf" : "font/ttf"
    });
    const audit = JSON.parse(subset.stdout);
    process.stderr.write(`\nfont subset: ${audit.included}/${audit.requested} characters -> ${outputName}; fallback: ${audit.fallback.join(",") || "none"}\n`);
    return filtered;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const preparedResources = await applyFontOverride(resources);
const result = createStaticThcrapPack({ pack, resources: preparedResources, runtimeVersion });
const preparedRuntimeVersion = result.manifest.runtimeVersion;
const packDirectory = resolve(output, "thcrap", game, preparedRuntimeVersion);
await mkdir(packDirectory, { recursive: true });
await writeFile(resolve(packDirectory, result.fileName), result.archive);
await writeFile(resolve(packDirectory, `${language}.manifest.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
let catalog = { schema: "eagler-touhou/thcrap-static-catalog/1", game, runtimeVersion: preparedRuntimeVersion, languages: [] };
try { catalog = JSON.parse(await readFile(resolve(output, "catalog.json"), "utf8")); } catch {}
if (catalog.schema !== "eagler-touhou/thcrap-static-catalog/1" || catalog.game !== game ||
    (catalog.runtimeVersion && !["auto", "pending", preparedRuntimeVersion].includes(String(catalog.runtimeVersion).toLowerCase())) ||
    !Array.isArray(catalog.languages)) {
  throw new Error(`invalid existing ${game.toUpperCase()} language catalog: ${output}`);
}
catalog.runtimeVersion = preparedRuntimeVersion;
catalog.languages = catalog.languages.filter(item => item?.id !== result.catalog.id);
catalog.languages.push({ ...result.catalog, pack: { ...result.catalog.pack } });
catalog.languages.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(resolve(output, "catalog.json"), `${JSON.stringify({
  schema: "eagler-touhou/thcrap-static-catalog/1",
  game,
  runtimeVersion: preparedRuntimeVersion,
  languages: catalog.languages
}, null, 2)}\n`);
process.stderr.write("\n");
console.log(JSON.stringify({ output, language, files: result.manifest.files.length, bytes: result.archive.length, sha256: result.sha256, pack: result.catalog.pack.url }));
