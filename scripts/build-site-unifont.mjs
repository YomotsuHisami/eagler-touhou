import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const font = resolve(workspace, "dependencies", "unifont-15.1.05", "unifont-15.1.05.otf");
const output = resolve(project, "assets", "fonts", "unifont-site.woff2");
const sources = [
  "index.html",
  "about.html",
  "faq.html",
  "migrate.html",
  "styles.css",
  "touch-guide.css",
  "NOTICE.txt",
  "CHANGELOG.txt",
  "app.js",
  "game-data-import.js",
  "games.json",
  "integrations/thcrap.mjs",
  "integrations/thprac.mjs"
];

const characters = new Set(Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)));
for (const source of sources) {
  const text = (await readFile(resolve(project, source), "utf8")).normalize("NFC");
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint >= 0x20 && !(codepoint >= 0x7f && codepoint <= 0x9f)) characters.add(character);
  }
}

const temporary = await mkdtemp(join(tmpdir(), "eagler-site-font-"));
try {
  const textFile = join(temporary, "characters.txt");
  await writeFile(textFile, [...characters].sort().join(""), "utf8");
  const result = await promisify(execFile)("python", [
    resolve(project, "scripts", "subset-font.py"), font,
    `--text-file=${textFile}`,
    `--output-file=${output}`,
    "--flavor=woff2"
  ], { maxBuffer: 8 * 1024 * 1024 });
  const audit = JSON.parse(result.stdout);
  const outputStat = await stat(output);
  console.log(JSON.stringify({ ...audit, bytes: outputStat.size, output }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
