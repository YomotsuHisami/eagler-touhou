import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workspacePath } from "../../lib/workspace-layout.mjs";
import { webkitPublicationServerArguments } from "../support/webkit-publication-server.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workRoot = resolve(tmpdir(), `eagler-playwright-webkit-${randomUUID()}`);
const output = resolve(workRoot, "site");
const artwork = resolve(workRoot, "artwork");
const diagnostics = resolve(tmpdir(), `eagler-playwright-webkit-diagnostics-${randomUUID()}`);
const requestedGame = process.argv.find(value => value.startsWith("--game="))?.split("=", 2)[1] || "";
const requestedMusic = process.argv.find(value => value.startsWith("--music="))?.split("=", 2)[1] || "none";
const packageZip = process.argv.find(value => value.startsWith("--package-zip="))?.slice("--package-zip=".length) || "";
const blockGameData = process.argv.includes("--block-game-data");

if (requestedGame && !new Set(["th06", "th07"]).has(requestedGame)) throw new Error(`Unsupported --game value: ${requestedGame}`);
if (!new Set(["midi", "ogg-stream", "ogg-full", "none"]).has(requestedMusic)) throw new Error(`Unsupported --music value: ${requestedMusic}`);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: project, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} ${args.join(" ")} failed (${signal || code})`)));
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`WebKit smoke server did not become ready: ${lastError || "timeout"}`);
}

let server = null;
let completed = false;
try {
  // Real iOS requires Apple hardware. Keep this gate honest: it is a local
  // desktop-WebKit compatibility lane, not a claim of iPhone/iPad coverage.
  await rm(artwork, { recursive: true, force: true });
  await mkdir(artwork, { recursive: true });
  await run(process.execPath, [
    "scripts/package-server.mjs",
    `--output=${output}`,
    `--artwork-dir=${artwork}`,
    "--games=th06,th07",
    `--th06-build=${workspacePath("th06", "build-web-eagler-thprac-test")}`,
    `--th06-multiplayer-build=${workspacePath("th06", "build-web-netplay-th06")}`,
    `--th07-build=${workspacePath("th07", "build-web-eagler-thprac")}`,
    `--th07-multiplayer-build=${workspacePath("th07", "build-web-th07-netplay")}`,
    `--th06-assets=${workspacePath("th06", "assets")}`,
    `--th07-assets=${workspacePath("th07", "assets")}`,
    `--font=${workspacePath("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf")}`,
    `--vanilla-font=${workspacePath("th06", "assets", "msgothic.ttc")}`,
    `--th06-ogg=${workspacePath("th06", "assets-ogg")}`,
    `--th07-ogg=${workspacePath("th07", "assets-ogg")}`,
    "--music=midi,ogg",
    "--profile=web-validation",
  ]);
  await run(process.execPath, ["scripts/verify-server-build.mjs", output]);
  const port = await freePort();
  server = spawn(process.execPath, webkitPublicationServerArguments(output, port), {
    cwd: project,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, EAGLER_TOUHOU_HOST: process.env.EAGLER_TOUHOU_HOST || "127.0.0.1" },
  });
  const url = `http://127.0.0.1:${port}/`;
  await waitForHttp(url);
  for (const game of requestedGame ? [requestedGame] : ["th06", "th07"]) {
    const args = ["tests/browser/launcher-playwright-webkit.py", url, game, requestedMusic, `--artifact-dir=${diagnostics}`];
    if (packageZip) args.push(`--package-zip=${packageZip}`);
    if (blockGameData) args.push("--block-game-data");
    await run("python", args);
  }
  completed = true;
  console.log("Local Playwright WebKit gate: PASS");
} finally {
  if (server && server.exitCode == null && server.signalCode == null) server.kill();
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (completed) await rm(diagnostics, { recursive: true, force: true });
}
