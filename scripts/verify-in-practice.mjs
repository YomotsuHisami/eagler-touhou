#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { computeMedianRun } from "lighthouse/core/lib/median-run.js";
import puppeteer from "puppeteer-core";
import { buildAppShell } from "../lib/app-shell-build.mjs";
import { APP_SHELL_OUTPUT_FILE } from "../lib/app-shell-policy.mjs";
import { findChromiumExecutable } from "../lib/chromium-executable.mjs";
import { ensureLauncherBuild, resolveBrowserPublicationSource } from "../lib/launcher-build.mjs";
import { PRODUCT_GAMES, PRODUCT_IDS } from "../lib/contracts/product-catalog.mjs";
import { runtimeStem } from "../lib/runtime-release.mjs";
import { HOST_MANIFEST_SCHEMA } from "../lib/contracts/host-manifest.mjs";
import { RELEASE_CATALOG_SCHEMA } from "../lib/contracts/release-catalog.mjs";
import { staticContentCompressible, staticContentType } from "../server/static-content-policy.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf("=");
  if (!value.startsWith("--") || split < 3) throw new Error(`invalid argument: ${value}`);
  return [value.slice(2, split), value.slice(split + 1)];
}));
for (const name of Object.keys(args)) {
  if (!new Set(["diagnostic", "profile", "report", "runs"]).has(name)) throw new Error(`unknown argument: --${name}`);
}
if (args.diagnostic != null && !new Set(["0", "1"]).has(args.diagnostic)) throw new Error("--diagnostic must be 0 or 1");
const diagnostic = args.diagnostic === "1";
const profile = args.profile || "reference";
if (!new Set(["reference", "standard"]).has(profile)) throw new Error("--profile must be reference or standard");
const runCount = Number.parseInt(args.runs || "5", 10);
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 9 || runCount % 2 === 0) {
  throw new Error("--runs must be an odd integer from 1 to 9");
}
const reportPath = resolve(args.report || resolve(tmpdir(), "eagler-touhou-verified-in-practice.json"));
if (reportPath.toLowerCase() === project.toLowerCase() || reportPath.toLowerCase().startsWith(`${project.toLowerCase()}${sep}`)) {
  throw new Error("Verified In Practice reports are evidence artifacts and must be written outside the source repository");
}
const referenceConfig = structuredClone(desktopConfig);
if (profile === "reference") {
  referenceConfig.settings.throttling = {
    ...referenceConfig.settings.throttling,
    rttMs: 10,
    throughputKbps: 40_960,
  };
}

function createReferenceManifest() {
  const hash = "a".repeat(64);
  const layout = "b".repeat(64);
  const games = {};
  for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
    games[game] = {
      runtime: `runtime/${game}/${runtimeStem(game)}.html?verified=1`,
      ...(product.multiplayerRuntime ? { multiplayerRuntime: `runtime/${game}/multiplayer/${runtimeStem(game)}.html?verified=1` } : {}),
      gameData: {
        path: product.package.dataTarget.slice(1),
        bytes: 1,
        sha256: hash,
        version: `sha256-${hash}`,
        layout: `sha256-${layout}`,
      },
      music: { midi: { files: [] } },
    };
  }
  return {
    schema: HOST_MANIFEST_SCHEMA,
    protocol: "eagler-touhou/1",
    profile: "verified-in-practice-reference",
    shared: {
      resourceMode: "hosted",
      vanillaFont: "__verified__/vanilla-font.ttf",
      unicodeFont: "__verified__/unicode-font.otf",
      netplayRelay: "wss://localhost.invalid/netplay",
    },
    games,
  };
}

const REFERENCE_ARTWORK = Object.freeze({
  "th06-card.webp": "UklGRj4AAABXRUJQVlA4IDIAAAAQAwCdASogACAAPp1In0slpCKhqAgAsBOJZwDE2BanFAAA/vOkdd6tpg6o+skYToAAAA==",
  "th07-card.webp": "UklGRjwAAABXRUJQVlA4IDAAAAAQAwCdASogACAAPp1In0slpCKhqAgAsBOJZwDKABanFAAA/vPfW7HvwIom+cAAAAA=",
  "th08-card.webp": "UklGRkAAAABXRUJQVlA4IDQAAAAQAwCdASogACAAPp1In0slpCKhqAgAsBOJZwC+SBbbDQAA/vHcjSHCx/ZO8nKPIENc4AAA",
  "th10-card.webp": "UklGRj4AAABXRUJQVlA4IDIAAAAQAwCdASogACAAPp1In0slpCKhqAgAsBOJZwDE2BanFAAA/vOkdd6tpg6o+skYToAAAA==",
});

function createCertificate(directory) {
  const key = resolve(directory, "localhost-key.pem");
  const cert = resolve(directory, "localhost-cert.pem");
  const result = spawnSync(process.env.EAGLER_OPENSSL || "openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`OpenSSL is required to create the ephemeral localhost certificate: ${result.stderr || result.error || "unknown error"}`);
  }
  return { key, cert };
}

async function createReferenceServer(workRoot) {
  await ensureLauncherBuild();
  const shell = await buildAppShell({ quiet: true, globDirectory: project });
  const certificate = createCertificate(workRoot);
  const metadata = new Map([
    ["host-manifest.json", Buffer.from(`${JSON.stringify(createReferenceManifest(), null, 2)}\n`)],
    ["release-catalog.json", Buffer.from(`${JSON.stringify({ schema: RELEASE_CATALOG_SCHEMA, games: {} }, null, 2)}\n`)],
    [APP_SHELL_OUTPUT_FILE, shell.worker],
  ]);
  const server = createSecureServer({
    allowHTTP1: true,
    key: await readFile(certificate.key),
    cert: await readFile(certificate.cert),
  }, async (request, response) => {
    try {
      const url = new URL(request.url || "/", "https://localhost");
      if (url.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice(1));
      const artwork = REFERENCE_ARTWORK[basename(relative)];
      if (artwork && relative.startsWith("assets/")) {
        const body = Buffer.from(artwork, "base64");
        response.writeHead(200, {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": body.length,
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      if (relative === "assets/th06.ico") {
        const body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#361317"/><circle cx="16" cy="16" r="8" fill="#a7343e"/></svg>');
        response.writeHead(200, {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": body.length,
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      const generated = metadata.get(relative);
      if (generated) {
        const type = relative.endsWith(".json") ? "application/json; charset=utf-8" : "text/javascript; charset=utf-8";
        response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": generated.length });
        response.end(request.method === "HEAD" ? undefined : generated);
        return;
      }
      const file = resolveBrowserPublicationSource(relative || "index.html");
      if (file !== project && !file.startsWith(project + sep)) throw new Error("path outside project");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      const body = await readFile(file);
      const compress = staticContentCompressible(file, body.length) && /\bbr\b/.test(String(request.headers["accept-encoding"] || ""));
      const delivered = compress ? brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }) : body;
      response.writeHead(200, {
        "Content-Type": staticContentType(file),
        "Cache-Control": "no-cache",
        ...(compress ? { "Content-Encoding": "br", Vary: "Accept-Encoding" } : {}),
        "Content-Length": delivered.length,
      });
      response.end(request.method === "HEAD" ? undefined : delivered);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Not found");
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, url: `https://localhost:${address.port}/` };
}

function visibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function runAgenticChecks(browser, url) {
  const checks = [];
  async function scenario(name, action) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForSelector(".game:not([hidden])", { visible: true });
      await action(page);
      assert.deepEqual(errors, [], `${name} browser errors:\n${errors.join("\n")}`);
      checks.push({ name, pass: true });
    } finally {
      await page.close();
    }
  }

  await scenario("catalog-discovery", async page => {
    const products = await page.$$eval(".game:not([hidden])", elements => elements.map(element => element.innerText));
    assert.equal(products.length, PRODUCT_IDS.length);
    for (const expected of ["東方紅魔郷", "東方妖々夢", "東方永夜抄", "東方風神録", "06MP", "07MP"]) {
      assert(products.some(value => value.includes(expected)), `catalog is missing ${expected}`);
    }
    assert.equal(await page.$("#eaglerBootEmergency"), null);
  });

  await scenario("single-player-flow", async page => {
    const clicked = await page.$$eval(".game:not([hidden])", elements => {
      const target = elements.find(element => element.innerText.includes("Perfect Cherry Blossom") && !element.innerText.includes("07MP"));
      target?.click();
      return Boolean(target);
    });
    assert(clicked);
    await page.waitForFunction(() => document.querySelector(".game.selected")?.getAttribute("aria-current") === "page");
    const actions = await page.$$eval("button", elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).map(element => element.innerText));
    assert(actions.some(value => /启动游戏|Launch Game/i.test(value)), "single-player launch action is not discoverable");
  });

  await scenario("multiplayer-flow", async page => {
    const clicked = await page.$$eval(".game:not([hidden])", elements => {
      const target = elements.find(element => element.innerText.includes("07MP"));
      target?.click();
      return Boolean(target);
    });
    assert(clicked);
    await page.waitForFunction(() => document.querySelector('.game[data-product="th07mp"]')?.getAttribute("aria-current") === "page");
    const actions = (await page.$$eval("button", elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).map(element => element.innerText))).map(visibleText);
    assert(actions.some(value => /创建房间|Create Room/i.test(value)), "create-room action is not discoverable");
    assert(actions.some(value => /加入房间|Join Room/i.test(value)), "join-room action is not discoverable");
    const roomInput = await page.$("input[type=text]");
    assert(roomInput, "room-code input is not discoverable");
  });

  return checks;
}

const workRoot = await mkdtemp(resolve(tmpdir(), "eagler-verified-in-practice-"));
let server;
let browser;
try {
  const reference = await createReferenceServer(workRoot);
  server = reference.server;
  const chromePath = await findChromiumExecutable();
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: resolve(workRoot, "chrome-profile"),
    args: [
      "--ignore-certificate-errors",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const endpoint = new URL(browser.wsEndpoint());
  const results = [];
  for (let attempt = 1; attempt <= runCount; attempt += 1) {
    const result = await lighthouse(reference.url, {
      port: Number(endpoint.port),
      logLevel: "silent",
      output: "json",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    }, referenceConfig);
    if (!result) throw new Error(`Lighthouse produced no result for run ${attempt}`);
    results.push(result.lhr);
  }
  const representative = computeMedianRun(results);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(representative, null, 2)}\n`);
  const categories = Object.fromEntries(Object.entries(representative.categories).map(([id, category]) => [id, Math.round(category.score * 100)]));
  const metricIds = ["first-contentful-paint", "largest-contentful-paint", "speed-index", "total-blocking-time", "cumulative-layout-shift"];
  const metrics = Object.fromEntries(metricIds.map(id => [id, {
    score: Math.round((representative.audits[id].score ?? 0) * 100),
    value: representative.audits[id].displayValue || "",
  }]));
  const agenticChecks = await runAgenticChecks(browser, reference.url);
  const throttling = referenceConfig.settings.throttling;
  const summary = {
    verifiedInPractice: "PASS",
    profile,
    runs: results.map((run, index) => ({
      attempt: index + 1,
      performance: Math.round(run.categories.performance.score * 100),
      totalBlockingTimeMs: Math.round(run.audits["total-blocking-time"].numericValue || 0),
    })),
    network: { rttMs: throttling.rttMs, throughputKbps: throttling.throughputKbps },
    categories,
    metrics,
    agenticChecks,
    report: reportPath,
  };
  const failures = [
    ...Object.entries(categories).filter(([, score]) => score !== 100).map(([id, score]) => `${id}=${score}`),
    ...Object.entries(metrics).filter(([, value]) => value.score !== 100).map(([id, value]) => `${id}=${value.score}`),
  ];
  if (failures.length) {
    summary.verifiedInPractice = diagnostic ? "DIAGNOSTIC" : "FAIL";
    if (!diagnostic) throw new Error(`Verified In Practice score gate failed: ${failures.join(", ")}\n${JSON.stringify(summary, null, 2)}`);
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
