import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(project, "assets", "fonts");
const sources = [
  "index.html",
  "about.html",
  "faq.html",
  "migrate.html",
  "styles.css",
  "about.css",
  "touch-guide.css",
  "NOTICE.txt",
  "CHANGELOG.txt",
  "app.js",
  "game-data-import.js",
  "games.json",
  "integrations/thcrap.mjs",
  "integrations/thprac.mjs"
];
const upstream = {
  yatra: "https://raw.githubusercontent.com/google/fonts/ec626514f79f831f1ab848a82114a0ce7e2d6372/ofl/yatraone/YatraOne-Regular.ttf",
  chillMedium: "https://cdn.jsdelivr.net/gh/Warren2060/ChillRoundGothic@53505f0818983d2fcdda00dc66e051ad13e81ffb/ttf/ChillRoundGothic_Medium.ttf",
  chillBold: "https://cdn.jsdelivr.net/gh/Warren2060/ChillRoundGothic@53505f0818983d2fcdda00dc66e051ad13e81ffb/ttf/ChillRoundGothic_Bold.ttf",
  chillHeavy: "https://cdn.jsdelivr.net/gh/Warren2060/ChillRoundGothic@53505f0818983d2fcdda00dc66e051ad13e81ffb/ttf/ChillRoundGothic_Heavy.ttf"
};
const licenses = {
  "OFL-YatraOne.txt": "https://raw.githubusercontent.com/google/fonts/ec626514f79f831f1ab848a82114a0ce7e2d6372/ofl/yatraone/OFL.txt",
  "OFL-ChillRoundGothic.txt": "https://raw.githubusercontent.com/Warren2060/ChillRoundGothic/53505f0818983d2fcdda00dc66e051ad13e81ffb/License.txt"
};
const obsoleteOutputs = [
  "chill-round-gothic-site-regular.woff2",
  "zen-maru-gothic-cjk-regular.woff2",
  "zen-maru-gothic-cjk-bold.woff2",
  "chill-round-gothic-sc-regular.woff2",
  "chill-round-gothic-sc-bold.woff2",
  "OFL-ZenMaruGothic.txt"
];

const requested = new Set();
for (const source of sources) {
  for (const character of (await readFile(resolve(project, source), "utf8")).normalize("NFC")) {
    if (character.codePointAt(0) >= 0x20) requested.add(character);
  }
}
const ui = new Set([...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(index + 0x20)), ...requested]);
const gameTitle = new Set("東方紅魔郷妖々夢");
const latin = new Set(Array.from({ length: 0x250 - 0x20 }, (_, index) => String.fromCodePoint(index + 0x20))
  .filter(character => character.codePointAt(0) < 0x7f || character.codePointAt(0) > 0x9f));

const temporary = await mkdtemp(join(tmpdir(), "eagler-ui-fonts-"));
async function download(url, output) {
  const args = ["--http1.1", "--connect-timeout", "10", "--max-time", "120", "--location", "--fail", "--silent", "--show-error", "--output", output, url];
  try {
    await promisify(execFile)("curl.exe", args);
  } catch {
    await promisify(execFile)("curl.exe", ["--noproxy", "*", ...args]);
  }
}
try {
  for (const outputName of obsoleteOutputs) await rm(resolve(outputDirectory, outputName), { force: true });
  const jobs = [
    ["yatra", "yatra-one-latin.woff2", latin],
    ["chillMedium", "chill-round-gothic-site-medium.woff2", ui],
    ["chillBold", "chill-round-gothic-site-bold.woff2", ui],
    ["chillHeavy", "chill-round-gothic-site-heavy.woff2", gameTitle]
  ];
  const audit = [];
  for (const [sourceName, outputName, characters] of jobs) {
    const font = join(temporary, `${sourceName}.ttf`);
    const text = join(temporary, `${sourceName}.txt`);
    const output = resolve(outputDirectory, outputName);
    await download(upstream[sourceName], font);
    await writeFile(text, [...characters].sort().join(""), "utf8");
    const result = await promisify(execFile)("python", [
      resolve(project, "scripts", "subset-font.py"), font,
      `--text-file=${text}`,
      `--output-file=${output}`,
      "--flavor=woff2"
    ], { maxBuffer: 8 * 1024 * 1024 });
    audit.push({ sourceName, outputName, bytes: (await stat(output)).size, ...JSON.parse(result.stdout) });
  }
  for (const [outputName, url] of Object.entries(licenses)) {
    const output = resolve(outputDirectory, outputName);
    const downloaded = join(temporary, outputName);
    try {
      await download(url, downloaded);
      await writeFile(output, await readFile(downloaded));
    } catch (error) {
      if ((await stat(output)).size <= 0) throw error;
    }
  }
  console.log(JSON.stringify({ upstream, licenses, audit }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
