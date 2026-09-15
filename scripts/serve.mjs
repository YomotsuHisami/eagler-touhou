import { createReadStream, existsSync, watch } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import { createThcrapHttpHandler } from "../server/thcrap-service.mjs";
import { ThcrapRuntimeCompiler } from "../server/thcrap-compiler.mjs";
import { ThtkRunner } from "../server/thtk-runner.mjs";
import {
  staticContentCacheControl,
  staticContentCompressible,
  staticContentType,
} from "../server/static-content-policy.mjs";
import { buildAppShell } from "../lib/app-shell-build.mjs";
import { createDevelopmentHostManifest } from "../lib/development-host-manifest.mjs";
import { DEVELOPMENT_CONTENT } from "../lib/development-content.mjs";
import { FRONTEND_PACKAGE_FILES, hostArtworkFiles, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import { HOST_MANIFEST_FILE } from "../lib/contracts/host-manifest.mjs";
import { RELEASE_CATALOG_FILE, RELEASE_CATALOG_SCHEMA } from "../lib/contracts/release-catalog.mjs";
import { isMappedBrowserPublicationPath, resolveBrowserPublicationSource } from "../lib/launcher-build.mjs";
import {
  APP_SHELL_OUTPUT_FILE,
  APP_SHELL_RUNTIME_GLOBS,
  isRepositoryAppShellInput,
} from "../lib/app-shell-policy.mjs";
import { assertSafeDevelopmentServerScope } from "../lib/development-server-scope.mjs";
import { workspaceRoot } from "../lib/workspace-layout.mjs";

const host = process.env.EAGLER_TOUHOU_HOST || "127.0.0.1";
const port = Number.parseInt(process.argv[2] || process.env.EAGLER_TOUHOU_PORT || "8130", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口号无效");
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.argv[3] || resolve(project, ".."));
assertSafeDevelopmentServerScope({ host, project, root });
const sourceDevelopmentServer = root === resolve(project, "..");
const servedApp = sourceDevelopmentServer ? project : root;
const defaultArtworkDirectory = sourceDevelopmentServer ? resolve(workspaceRoot(), "games", "host-artwork") : null;
const configuredArtworkDirectory = process.env.EAGLER_TOUHOU_ARTWORK_DIR
  ? resolve(process.env.EAGLER_TOUHOU_ARTWORK_DIR)
  : defaultArtworkDirectory && existsSync(defaultArtworkDirectory) ? defaultArtworkDirectory : null;
if (process.env.EAGLER_TOUHOU_ARTWORK_DIR && !existsSync(configuredArtworkDirectory)) {
  throw new Error(`EAGLER_TOUHOU_ARTWORK_DIR does not exist: ${configuredArtworkDirectory}`);
}
const configuredNetplayRelay = process.env.EAGLER_TOUHOU_NETPLAY_RELAY?.trim() || undefined;
const hostArtwork = new Set(hostArtworkFiles(Object.keys(DEVELOPMENT_CONTENT.games)));
const developmentMetadata = sourceDevelopmentServer ? new Map([
  [HOST_MANIFEST_FILE, `${JSON.stringify(await createDevelopmentHostManifest({
    netplayRelay: configuredNetplayRelay,
  }), null, 2)}\n`],
  [RELEASE_CATALOG_FILE, `${JSON.stringify({ schema: RELEASE_CATALOG_SCHEMA, games: {} }, null, 2)}\n`],
]) : null;
const localAppShellOptions = {
  quiet: true,
  globDirectory: servedApp,
  additionalGlobPatterns: APP_SHELL_RUNTIME_GLOBS,
  deferredPathPrefixes: ["runtime/"],
};
const isRuntimeAppShellPath = value => /^runtime\/(?:.*\.(?:html|js|wasm|mjs|json|ttc|ttf|bin))$/i.test(
  String(value || "").replaceAll("\\", "/")
);
const initialAppShell = await buildAppShell(localAppShellOptions);
let lastAppShellBuildId = initialAppShell.buildId;
let appShellWorker = initialAppShell.worker;
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
        appShellWorker = result.worker;
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
  if (!filename) return;
  const watchedPath = String(filename).replaceAll("\\", "/");
  const publicLogicalPath = watchedPath.startsWith("public/") ? watchedPath.slice("public/".length) : null;
  if (!isRepositoryAppShellInput(watchedPath) &&
      !(publicLogicalPath && isRepositoryAppShellInput(publicLogicalPath)) &&
      !isRuntimeAppShellPath(watchedPath)) return;
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
    if (pathname === "/eagler-touhou" || pathname === "/eagler-touhou/") {
      response.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const legacyRetirementWorker = pathname === "/eagler-touhou/app-shell-sw.js";
    if (legacyRetirementWorker) {
      pathname = "/legacy-mount-retirement-sw.js";
    } else if (pathname.startsWith("/eagler-touhou/")) {
      pathname = pathname.slice("/eagler-touhou".length);
    }
    if (developmentMetadata && pathname.startsWith("/")) {
      const name = pathname.slice(1);
      const body = developmentMetadata.get(name);
      if (body != null) {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Length": Buffer.byteLength(body),
        });
        if (request.method === "HEAD") response.end();
        else response.end(body);
        return;
      }
    }
    const appShellUrl = `/${APP_SHELL_OUTPUT_FILE}`;
    if (pathname === appShellUrl) {
      const tag = `\"${lastAppShellBuildId}\"`;
      const headers = {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        ETag: tag,
        "Content-Length": appShellWorker.length,
      };
      if (request.headers["if-none-match"] === tag) {
        response.writeHead(304, headers);
        response.end();
        return;
      }
      response.writeHead(200, headers);
      if (request.method === "HEAD") response.end();
      else response.end(appShellWorker);
      return;
    }
    const artworkPrefix = "/assets/";
    const artworkName = pathname.startsWith(artworkPrefix) ? pathname.slice(artworkPrefix.length) : "";
    const externalArtwork = configuredArtworkDirectory && hostArtwork.has(artworkName)
      ? resolve(configuredArtworkDirectory, artworkName)
      : null;
    let file;
    const publicPath = pathname.replace(/^\//, "");
    const frontendPath = publicPath || "index.html";
    if (sourceDevelopmentServer && FRONTEND_PACKAGE_FILES.includes(frontendPath)) {
      file = resolveFrontendPackageSource(frontendPath);
    } else if (externalArtwork && existsSync(externalArtwork)) {
      file = externalArtwork;
    } else {
      const appCandidate = resolve(servedApp, `.${pathname}`);
      const workspaceCandidate = resolve(root, `.${pathname}`);
      if (appCandidate !== servedApp && !appCandidate.startsWith(servedApp + sep)) throw new Error("path outside application root");
      if (workspaceCandidate !== root && !workspaceCandidate.startsWith(root + sep)) throw new Error("path outside workspace");
      file = existsSync(appCandidate) ? appCandidate : workspaceCandidate;
    }
    let info = await stat(file);
    if (info.isDirectory() && !url.pathname.endsWith("/")) {
      response.writeHead(308, { Location: `${url.pathname}/${url.search}`, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (info.isDirectory()) { file = resolve(file, "index.html"); info = await stat(file); }
    if (!info.isFile()) throw new Error("not a file");
    const tag = etag(info);
    // This server is the local development server. Runtime JS/WASM/data may be
    // rebuilt in place while their query string is still unchanged. Marking
    // those URLs immutable can mix a freshly revalidated JS glue file with a
    // year-cached WASM/data file, which breaks Emscripten's EM_ASM table ABI.
    // Content-addressed language ZIPs are safe to keep immutable; everything
    // else must revalidate its ETag on each navigation/fetch.
    const cacheControl = legacyRetirementWorker ? "no-store" : staticContentCacheControl(file);
    const commonHeaders = {
      "Content-Type": staticContentType(file),
      "Cache-Control": cacheControl,
      ETag: tag,
      "Last-Modified": info.mtime.toUTCString(),
      Vary: "Accept-Encoding",
    };
    if (legacyRetirementWorker) commonHeaders["Service-Worker-Allowed"] = "/eagler-touhou/";
    if (request.headers["if-none-match"] === tag) {
      response.writeHead(304, commonHeaders); response.end(); return;
    }

    const accepted = request.headers["accept-encoding"] || "";
    const shouldCompress = staticContentCompressible(file, info.size);
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
  console.log(`eagler-touhou: http://${host}:${port}/`);
  console.log(`host artwork: ${configuredArtworkDirectory || "not configured"}`);
  console.log(`thcrap: ${thcrapEnabled ? (runtimeCompiler ? "enabled" : "enabled without runtime compiler") : "disabled"}`);
});
