import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = "../archive/temporary/playwright-webkit-smoke-site";
const browserStackDevice = process.argv.find(value => value.startsWith("--browserstack-device="))?.split("=", 2)[1] || "";
const browserStackOsVersion = process.argv.find(value => value.startsWith("--browserstack-os-version="))?.split("=", 2)[1] || "";
const requestedGame = process.argv.find(value => value.startsWith("--game="))?.split("=", 2)[1] || "";
const requestedMusic = process.argv.find(value => value.startsWith("--music="))?.split("=", 2)[1] || "none";
const browserStackUrl = process.argv.find(value => value.startsWith("--browserstack-url="))?.slice("--browserstack-url=".length) || "";
const packageZip = process.argv.find(value => value.startsWith("--package-zip="))?.slice("--package-zip=".length) || "";
const blockGameData = process.argv.includes("--block-game-data");
const browserStackEnabled = !!(browserStackDevice || browserStackOsVersion);
if (browserStackEnabled && (!browserStackDevice || !browserStackOsVersion)) {
  throw new Error("BrowserStack requires both --browserstack-device and --browserstack-os-version");
}
if (requestedGame && !new Set(["th06", "th07"]).has(requestedGame)) {
  throw new Error(`Unsupported --game value: ${requestedGame}`);
}
if (!new Set(["midi", "ogg-stream", "ogg-full", "none"]).has(requestedMusic)) {
  throw new Error(`Unsupported --music value: ${requestedMusic}`);
}
if (browserStackEnabled && (!process.env.BROWSERSTACK_USERNAME || !process.env.BROWSERSTACK_ACCESS_KEY)) {
  throw new Error("Set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY in this shell before running the real-iOS gate");
}
if (browserStackUrl && !/^https:\/\//i.test(browserStackUrl)) {
  throw new Error("--browserstack-url must use HTTPS");
}
const browserStackLocalIdentifier = browserStackEnabled ? `touhou-eagler-${randomUUID()}` : "";

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: project,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal || code})`));
    });
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

function localTunnelOptions() {
  const options = {
    key: process.env.BROWSERSTACK_ACCESS_KEY,
    localIdentifier: browserStackLocalIdentifier,
    forceLocal: true,
  };
  const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  if (!proxyValue) return options;
  try {
    const proxy = new URL(proxyValue);
    options.proxyHost = proxy.hostname;
    options.proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
    // This workspace has no direct route to BrowserStack. Without forceProxy,
    // BrowserStack Local also retries direct repeater connections before using
    // the configured proxy, which makes real-device runs stall for minutes.
    options.forceProxy = true;
    if (proxy.username) options.proxyUser = decodeURIComponent(proxy.username);
    if (proxy.password) options.proxyPass = decodeURIComponent(proxy.password);
  } catch {
    throw new Error("HTTPS_PROXY/HTTP_PROXY is not a valid URL for BrowserStack Local");
  }
  return options;
}

async function startBrowserStackLocal() {
  const module = await import("browserstack-local");
  const BrowserStackLocal = module.default || module;
  const local = new BrowserStackLocal.Local();
  await new Promise((resolveStart, reject) => {
    local.start(localTunnelOptions(), error => error ? reject(error) : resolveStart());
  });
  return local;
}

async function stopBrowserStackLocal(local) {
  if (!local) return;
  await new Promise(resolveStop => local.stop(() => resolveStop()));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`WebKit smoke server did not become ready: ${lastError || "timeout"}`);
}

let port = 0;
let server = null;
if (!browserStackUrl) {
  await run(process.execPath, [
    "scripts/package-server.mjs",
    `--output=${output}`,
    "--th06-build=../th06-eagler/build-web-eagler-thprac-test",
    "--th06-multiplayer-build=../th06-eagler/build-web-netplay-th06",
    "--th07-build=../th07-eagler/build-web-eagler-thprac",
    "--th07-multiplayer-build=../th07-eagler/build-web-th07-netplay",
    "--th06-assets=../th06-eagler/assets",
    "--th07-assets=../th07-eagler/assets",
    "--font=../dependencies/unifont-15.1.05/unifont-15.1.05.otf",
    "--vanilla-font=../th06-eagler/assets/msgothic.ttc",
    "--th06-ogg=../th06-eagler/assets-ogg",
    "--th07-ogg=../th07-eagler/assets-ogg",
    "--music=midi,ogg",
  ]);
  await run(process.execPath, ["scripts/verify-server-build.mjs", output]);
  port = await freePort();
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port), output], {
    cwd: project,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      EAGLER_TOUHOU_HOST: browserStackEnabled ? "0.0.0.0" : (process.env.EAGLER_TOUHOU_HOST || "127.0.0.1"),
    },
  });
}
let browserStackLocal = null;

try {
  const localUrl = port ? `http://127.0.0.1:${port}/eagler-touhou/` : "";
  if (localUrl) await waitForHttp(localUrl);
  if (browserStackEnabled && !browserStackUrl) browserStackLocal = await startBrowserStackLocal();
  const url = browserStackUrl || (browserStackEnabled ? `http://bs-local.com:${port}/eagler-touhou/` : localUrl);
  const games = requestedGame ? [requestedGame] : (browserStackEnabled ? ["th07"] : ["th06", "th07"]);
  for (const game of games) {
    const args = ["scripts/run-launcher-playwright-webkit.py", url, game, requestedMusic];
    if (browserStackEnabled && !browserStackUrl) {
      args.push(
        `--browserstack-device=${browserStackDevice}`,
        `--browserstack-os-version=${browserStackOsVersion}`,
        `--browserstack-local-identifier=${browserStackLocalIdentifier}`,
      );
    }
    if (packageZip) args.push(`--package-zip=${packageZip}`);
    if (blockGameData) args.push("--block-game-data");
    await run("python", args);
  }
  console.log(browserStackEnabled ? "BrowserStack real iOS gate: PASS" : "Playwright WebKit gate: PASS");
} finally {
  await stopBrowserStackLocal(browserStackLocal);
  if (server && server.exitCode == null && server.signalCode == null) server.kill();
}
