import { createReadStream, existsSync, watch } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import { createThcrapHttpHandler } from "../server/thcrap-service.mjs";
import { ThcrapRuntimeCompiler } from "../server/thcrap-compiler.mjs";
import { ThtkRunner } from "../server/thtk-runner.mjs";
import { buildAppShell, isAppShellPath } from "./build-app-shell.mjs";

const host = process.env.EAGLER_TOUHOU_HOST || "127.0.0.1";
const port = Number.parseInt(process.argv[2] || process.env.EAGLER_TOUHOU_PORT || "8130", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口号无效");
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.argv[3] || resolve(project, ".."));
const servedApp = existsSync(resolve(root, "eagler-touhou"))
  ? resolve(root, "eagler-touhou")
  : project;
const localAppShellOptions = {
  quiet: true,
  globDirectory: servedApp,
  swDest: resolve(servedApp, "app-shell-sw.js"),
  additionalGlobPatterns: ["runtime/**/*.html", "runtime/**/*.js", "runtime/**/*.wasm"],
};
const isRuntimeAppShellPath = value => /^runtime\/(?:.*\.(?:html|js|wasm))$/i.test(
  String(value || "").replaceAll("\\", "/")
);
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"], [".data", "application/octet-stream"], [".zip", "application/zip"],
  [".ttc", "font/collection"], [".woff2", "font/woff2"], [".ogg", "audio/ogg"], [".wav", "audio/wav"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".svg", "image/svg+xml"], [".ico", "image/x-icon"],
]);
const compressible = new Set([".html", ".js", ".mjs", ".json", ".css", ".wasm", ".data", ".ttc", ".svg"]);

const initialAppShell = await buildAppShell(localAppShellOptions);
let lastAppShellBuildId = initialAppShell.buildId;
let appShellRebuildTimer = null;
let appShellBuildRunning = false;
let appShellBuildQueued = false;
async function rebuildAppShell() {
  if (appShellBuildRunning) {
    appShellBuildQueued = true;
    return;
  }
  appShellBuildRunning = true;
  try {
    do {
      appShellBuildQueued = false;
      const result = await buildAppShell(localAppShellOptions);
      if (result.buildId !== lastAppShellBuildId) {
        lastAppShellBuildId = result.buildId;
        console.log(`App Shell updated: ${result.buildId}`);
      }
    } while (appShellBuildQueued);
  } catch (error) {
    console.warn(`App Shell rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    appShellBuildRunning = false;
  }
}
const appShellWatcher = watch(servedApp, { recursive: true }, (_event, filename) => {
  if (!filename || (!isAppShellPath(filename) && !isRuntimeAppShellPath(filename))) return;
  if (appShellRebuildTimer) clearTimeout(appShellRebuildTimer);
  appShellRebuildTimer = setTimeout(() => void rebuildAppShell(), 500);
});
appShellWatcher.unref();

function configuredPaths(value, fallbacks) {
  if (value) return value.split(";").map(path => resolve(path.trim())).filter(Boolean);
  return fallbacks.map(path => resolve(path)).filter(path => existsSync(path));
}

function createRuntimeCompiler() {
  const bundledThtk = resolve(root, "dependencies", "thtk-bin-12", "thtk-bin-12");
  const thdat = resolve(process.env.EAGLER_THTK_THDAT || resolve(bundledThtk, "thdat.exe"));
  const thmsg = resolve(process.env.EAGLER_THTK_THMSG || resolve(bundledThtk, "thmsg.exe"));
  const archives = {
    th06: configuredPaths(process.env.EAGLER_TH06_ARCHIVES, [
      resolve(root, "games", "th06", "紅魔郷ST.DAT"),
      resolve(root, "games", "th06", "紅魔郷ED.DAT")
    ]),
    th07: configuredPaths(process.env.EAGLER_TH07_ARCHIVES, [resolve(root, "games", "th07", "th07.dat")])
  };
  if (!existsSync(thdat) || !existsSync(thmsg) || !archives.th06.length || !archives.th07.length) return null;
  return new ThcrapRuntimeCompiler({ runner: new ThtkRunner({ thdat, thmsg }), archives });
}

const thcrapEnabled = process.env.EAGLER_ENABLE_THCRAP === "1";
const runtimeCompiler = thcrapEnabled ? createRuntimeCompiler() : null;
const handleThcrap = thcrapEnabled ? createThcrapHttpHandler({
  repository: process.env.EAGLER_THCRAP_REPOSITORY,
  cacheRoot: process.env.EAGLER_THCRAP_CACHE,
  maxAgeMs: Number.parseInt(process.env.EAGLER_THCRAP_MAX_AGE_MS || "900000", 10),
  ...(runtimeCompiler ? { packProcessor: resources => runtimeCompiler.processPack(resources) } : {})
}) : async () => false;

function etag(info) {
  return `\"${createHash("sha1").update(`${info.size}:${info.mtimeMs}`).digest("base64url")}\"`;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (await handleThcrap(request, response, url)) return;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/favicon.ico") {
      response.writeHead(204, { "Cache-Control": "public, max-age=86400" });
      response.end();
      return;
    }
    if (pathname === "/") {
      response.writeHead(308, { Location: `/eagler-touhou/${url.search}`, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error("path outside workspace");
    let info = await stat(file);
    if (info.isDirectory() && !url.pathname.endsWith("/")) {
      response.writeHead(308, { Location: `${url.pathname}/${url.search}`, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (info.isDirectory()) { file = resolve(file, "index.html"); info = await stat(file); }
    if (!info.isFile()) throw new Error("not a file");
    const extension = extname(file).toLowerCase();
    const tag = etag(info);
    const hashedPack = extension === ".zip" && /[a-f0-9]{24}\.zip$/i.test(file);
    // This server is the local development server. Runtime JS/WASM/data may be
    // rebuilt in place while their query string is still unchanged. Marking
    // those URLs immutable can mix a freshly revalidated JS glue file with a
    // year-cached WASM/data file, which breaks Emscripten's EM_ASM table ABI.
    // Content-addressed language ZIPs are safe to keep immutable; everything
    // else must revalidate its ETag on each navigation/fetch.
    const cacheControl = hashedPack
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate";
    const commonHeaders = {
      "Content-Type": mime.get(extension) || "application/octet-stream",
      "Cache-Control": cacheControl,
      ETag: tag,
      "Last-Modified": info.mtime.toUTCString(),
      Vary: "Accept-Encoding",
    };
    if (request.headers["if-none-match"] === tag) {
      response.writeHead(304, commonHeaders); response.end(); return;
    }

    const accepted = request.headers["accept-encoding"] || "";
    const shouldCompress = info.size >= 1024 && compressible.has(extension);
    const encoding = shouldCompress && /\bbr\b/.test(accepted) ? "br"
      : shouldCompress && /\bgzip\b/.test(accepted) ? "gzip" : "";
    const headers = { ...commonHeaders };
    if (encoding) headers["Content-Encoding"] = encoding;
    else headers["Content-Length"] = info.size;
    response.writeHead(200, headers);
    if (request.method === "HEAD") { response.end(); return; }

    const source = createReadStream(file);
    if (encoding === "br") {
      await pipeline(source, createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }), response);
    } else if (encoding === "gzip") {
      await pipeline(source, createGzip({ level: 6 }), response);
    } else {
      await pipeline(source, response);
    }
  } catch (error) {
    console.warn(`404 ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
    if (!response.headersSent) response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    if (!response.writableEnded) response.end("Not found");
  }
}).listen(port, host, () => {
  console.log(`eagler-touhou: http://${host}:${port}/eagler-touhou/`);
  console.log(`thcrap: ${thcrapEnabled ? (runtimeCompiler ? "enabled" : "enabled without runtime compiler") : "disabled"}`);
});
