import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const chrome = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome";
const contentType = path => extname(path) === ".mjs" || extname(path) === ".js"
  ? "text/javascript"
  : extname(path) === ".json" ? "application/json" : "application/octet-stream";
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    if (pathname === "/") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<!doctype html><title>launcher-lifecycle-native</title>");
      return;
    }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error("outside root");
    const bytes = await readFile(path);
    res.writeHead(200, { "content-type": contentType(path), "cache-control": "no-store" });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
server.listen(0, "127.0.0.1");
await new Promise(resolveListen => server.once("listening", resolveListen));
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const result = await page.evaluate(async () => {
    const lifecycle = await import("/.cache/build/browser/assets/launcher/launcher-lifecycle.mjs");
    const sessions = await import("/.cache/build/browser/assets/launcher/runtime-session.mjs");
    const shell = await import("/.cache/build/browser/assets/launcher/app-shell-client.mjs");

    const activity = {
      launched: false,
      runtimeReady: false,
      runtimeSessionActive: false,
      touchLayoutEditing: true,
      blockingOperation: false,
      gameDataAttempt: false,
      launchInFlight: false,
      decisionOpen: false,
      replayOpen: false,
    };
    let reloads = 0;
    const registration = {
      waiting: {},
      installing: null,
      addEventListener() {},
      async update() {},
    };
    const serviceWorker = {
      controller: {},
      async register() { return registration; },
      async getRegistration() { return registration; },
    };
    const client = shell.createAppShellClient({
      serviceWorker,
      secureContext: true,
      shouldDeferReload: () => lifecycle.shouldDeferAppShellReload(activity),
      reload: () => { reloads++; },
      schedule: callback => callback(),
      logger: { warn() {} },
    });
    await client.ready;
    const deferredWhileEditing = client.snapshot().updateReady && client.snapshot().reloadPending && reloads === 0;
    activity.touchLayoutEditing = false;
    const appliedAfterSafeBoundary = client.maybeReload() && reloads === 1;

    const continuation = lifecycle.createGameDataContinuation({
      kind: "launch",
      product: "th06mp",
      roomCode: "ABC123",
      replayViewer: true,
    });
    const continuationMatches = lifecycle.gameDataContinuationMatches(continuation, {
      product: "th06mp", roomCode: "ABC123", replayViewer: true,
    });
    const staleContinuationRejected = !lifecycle.gameDataContinuationMatches(continuation, {
      product: "th07mp", roomCode: "ABC123", replayViewer: true,
    });

    const owner = sessions.createRuntimeSessionOwner();
    const first = owner.begin({ game: "th06", runtimeVariant: "normal", generationId: "gen-1", revision: "r1" });
    const second = owner.begin({ game: "th06", runtimeVariant: "normal", generationId: "gen-2", revision: "r2" });
    const oldSessionExpired = !owner.isCurrent(first) && owner.isCurrent(second);
    owner.clear();
    const clearExpiresCurrent = !owner.isCurrent(second) && owner.current() === null;

    return {
      deferredWhileEditing,
      appliedAfterSafeBoundary,
      continuationMatches,
      staleContinuationRejected,
      oldSessionExpired,
      clearExpiresCurrent,
      reloads,
    };
  });
  assert.deepEqual(result, {
    deferredWhileEditing: true,
    appliedAfterSafeBoundary: true,
    continuationMatches: true,
    staleContinuationRejected: true,
    oldSessionExpired: true,
    clearExpiresCurrent: true,
    reloads: 1,
  });
  console.log(JSON.stringify({ launcherLifecycleNative: "PASS", ...result }));
} finally {
  await browser.close();
  server.close();
}
