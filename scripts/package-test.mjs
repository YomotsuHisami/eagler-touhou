import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDistribution } from "./verify-test-build.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const output = resolve(workspace, "dist", "eagler-touhou-unified-test");
const staging = `${output}.staging`;
const gameFiles = ["html", "js", "wasm", "data"];

async function copyWithRetry(source, target) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await cp(source, target);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EBUSY", "EPERM"].includes(error.code)) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 200));
    }
  }
}

async function versionFiles(base, files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(resolve(base, file)));
  return hash.digest("hex").slice(0, 16);
}

await rm(staging, { recursive: true, force: true });
await mkdir(resolve(staging, "eagler-touhou", "scripts"), { recursive: true });
for (const name of ["index.html", "about.html", "about.css", "styles.css", "touch-guide.css", "app.js", "README.md", "ASSETS.md", "THIRD_PARTY.md", "package.json", "package-lock.json"]) {
  await cp(resolve(project, name), resolve(staging, "eagler-touhou", name));
}
await cp(resolve(project, "vendor"), resolve(staging, "eagler-touhou", "vendor"), { recursive: true });
for (const name of ["th06-title00.jpg", "th07-title00.jpg", "fonts/noto-serif-sc-touhou.woff2", "fonts/OFL-NotoSerifSC.txt"]) {
  const target = resolve(staging, "eagler-touhou", "assets", name);
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(project, "assets", name), target);
}
await cp(resolve(project, "scripts", "serve.mjs"), resolve(staging, "eagler-touhou", "scripts", "serve.mjs"));
await cp(resolve(project, "scripts", "start-package.ps1"), resolve(staging, "启动 eagler-touhou.ps1"));
await cp(resolve(project, "scripts", "stop-package.ps1"), resolve(staging, "停止 eagler-touhou.ps1"));
await mkdir(resolve(staging, "shared"), { recursive: true });
const sharedFont = resolve(workspace, "th06-eagler", "assets", "msgothic.ttc");
await copyWithRetry(sharedFont, resolve(staging, "shared", "msgothic.ttc"));

const builds = {
  th06: resolve(process.env.TH06_WEB_BUILD || resolve(workspace, "th06-eagler", "build-web-eagler-default")),
  th07: resolve(process.env.TH07_WEB_BUILD || resolve(workspace, "th07-eagler", "build-web-eagler-default")),
};
for (const [game, source] of Object.entries(builds)) {
  const target = resolve(staging, "games", game); await mkdir(target, { recursive: true });
  for (const extension of gameFiles) {
    await copyWithRetry(resolve(source, `${game}.${extension}`), resolve(target, `${game}.${extension}`));
  }
}

const manifest = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
manifest.shared = { font: `../shared/msgothic.ttc?v=${await versionFiles(resolve(sharedFont, ".."), ["msgothic.ttc"])}` };
for (const game of Object.keys(builds)) {
  manifest.games[game].runtime = `../games/${game}/${game}.html?hosted=1&v=${await versionFiles(builds[game], gameFiles.map(extension => `${game}.${extension}`))}`;
  for (const mode of ["wav", "ogg"]) {
    const pack = manifest.games[game].music[mode];
    const sourceBase = resolve(project, pack.base);
    const targetBase = resolve(staging, "games", game, "music", mode);
    await mkdir(targetBase, { recursive: true });
    for (const file of pack.files) {
      await copyWithRetry(resolve(sourceBase, file), resolve(targetBase, file));
    }
    pack.base = `../games/${game}/music/${mode}/`;
    pack.version = await versionFiles(sourceBase, pack.files);
    pack.sizes = await Promise.all(pack.files.map(async file => (await stat(resolve(sourceBase, file))).size));
  }
}
await writeFile(resolve(staging, "eagler-touhou", "games.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(staging, "打开测试版.cmd"), `@echo off\r
set /a ET_PORT=20000 + (%RANDOM% %% 20000)\r
where node.exe >nul 2>nul && goto node\r
where py.exe >nul 2>nul && goto python\r
echo eagler-touhou requires Node.js or Python 3 to start its local-only web server.\r
echo Install either runtime, then run this file again.\r
pause\r
exit /b 1\r
:node\r
start "eagler-touhou server" /min cmd.exe /d /c "cd /d %~dp0eagler-touhou && node scripts\\serve.mjs %ET_PORT%"\r
goto open\r
:python\r
start "eagler-touhou server" /min py.exe -m http.server %ET_PORT% --bind 127.0.0.1 --directory "%~dp0"\r
:open\r
timeout /t 1 /nobreak >nul\r
start "" http://127.0.0.1:%ET_PORT%/eagler-touhou/\r
`);
await verifyDistribution(staging);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(output);
console.log(JSON.stringify(await verifyDistribution(output)));
