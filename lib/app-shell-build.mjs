import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getManifest, injectManifest } from "workbox-build";
import { APP_SHELL_SOURCE_FILE, createAppShellContract } from "./app-shell-contract.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultSourcePath = resolve(project, APP_SHELL_SOURCE_FILE);

function buildHash(entries, source, deferredPaths) {
  const hash = createHash("sha256");
  hash.update(source);
  for (const entry of [...entries].sort((left, right) => left.url.localeCompare(right.url))) {
    hash.update("\0");
    hash.update(entry.url);
    hash.update("\0");
    hash.update(entry.revision || "");
  }
  for (const path of [...deferredPaths].sort()) {
    hash.update("\0deferred\0");
    hash.update(path);
  }
  return hash.digest("hex").slice(0, 20);
}

export async function buildAppShell({
  quiet = false,
  globDirectory = project,
  swDest = /** @type {string | null} */ (null),
  sourcePath = defaultSourcePath,
  additionalGlobPatterns = [],
  deferredPaths = [],
  deferredPathPrefixes = [],
  // Alternate authored UI entries provide their own complete publication
  // closure. The original graph remains the unchanged default.
  shellFiles = /** @type {readonly string[] | null} */ (null),
  runtimeContract = /** @type {{RUNTIME_MANIFEST_FILE: string, validateRuntimeManifest: (value: any) => any} | null} */ (null),
  workerContractSource = /** @type {string | null} */ (null),
} = {}) {
  // Published self-host bundles retain the original compiled-contract/default
  // graph route. An explicit authored entry never initializes that legacy graph.
  let resolveFrontendSource = /** @type {((path: string) => string) | null} */ (null);
  if (shellFiles === null) {
    const frontend = await import("./frontend-manifest.mjs");
    shellFiles = frontend.APP_SHELL_FILES;
    resolveFrontendSource = frontend.resolveFrontendPackageSource;
  }
  const { RUNTIME_MANIFEST_FILE, validateRuntimeManifest } = runtimeContract || await import("./contracts/runtime-generations.mjs");
  if (!Array.isArray(shellFiles) || !shellFiles.includes("index.html") || shellFiles.some(path =>
    typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..") ||
    /[?#*{}[\]]/.test(path) || path.startsWith("runtime/") || [RUNTIME_MANIFEST_FILE, "migrate.html", "legacy-mount-retirement-sw.js", "app-shell-sw.js"].includes(path))) {
    throw new Error("Invalid App Shell publication file graph");
  }
  const resolvedGlobDirectory = resolve(globDirectory);
  const localAppShellPatterns = [];
  const mappedManifestEntries = [];
  let mappedManifestBytes = 0;
  for (const path of [...new Set(shellFiles)]) {
    try {
      const bytes = await readFile(resolve(resolvedGlobDirectory, path));
      if (!bytes.length) throw new Error(`App Shell input is empty: ${path}`);
      localAppShellPatterns.push(path);
    } catch (error) {
      if (error?.code !== "ENOENT" || resolvedGlobDirectory !== project || !resolveFrontendSource) throw error;
      const bytes = await readFile(resolveFrontendSource(path));
      if (!bytes.length) throw new Error(`App Shell input is empty: ${path}`);
      mappedManifestBytes += bytes.length;
      mappedManifestEntries.push({
        url: path,
        revision: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  const manifestConfig = {
    globDirectory: resolvedGlobDirectory,
    globPatterns: [...localAppShellPatterns, ...additionalGlobPatterns.filter(path => !path.replace(/^\.\//, "").startsWith("runtime/") && path !== RUNTIME_MANIFEST_FILE)],
    // Program generations are never a condition of shell installation.
    globIgnores: ["runtime/**", RUNTIME_MANIFEST_FILE],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    // Both Workbox passes must use the same SHA-256 byte identities.
    manifestTransforms: [async entries => ({
      manifest: await Promise.all(entries.map(async entry => ({
        ...entry,
        revision: createHash("sha256").update(await readFile(resolve(resolvedGlobDirectory, entry.url))).digest("hex"),
      }))),
      warnings: [],
    })],
  };
  const runtimeSource = await readFile(resolve(project, "src/runtime-cache-sw.js"), "utf8");
  const shellSource = await readFile(sourcePath, "utf8");
  const workerContract = workerContractSource ?? await readFile((await import("./launcher-build.mjs")).resolveBrowserPublicationSource("assets/contracts/runtime-generations-worker.js"), "utf8");
  const legacyReader = await readFile(resolve(project, "legacy/runtime-generation-reader.js"), "utf8");
  const source = `${workerContract}\n${legacyReader}\n${runtimeSource}\n${shellSource}`;
  if (!source.includes("__APP_SHELL_BUILD_ID__") || !source.includes("__APP_SHELL_DEFERRED_PATHS__") || !source.includes("self.__WB_MANIFEST")) {
    throw new Error("App Shell Service Worker source is missing Workbox build placeholders");
  }
  const firstPass = await getManifest(manifestConfig);
  const sourceEntries = [...firstPass.manifestEntries, ...mappedManifestEntries];
  const indexEntry = sourceEntries.find(entry => entry.url === "index.html");
  if (!indexEntry?.revision) throw new Error("Workbox App Shell manifest is missing index.html");
  const navigationEntry = { url: "./", revision: indexEntry.revision };
  const manifestEntries = [...sourceEntries, navigationEntry];
  const normalizePath = path => String(path).replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedDeferredPrefixes = [...new Set(deferredPathPrefixes.map(normalizePath))];
  const normalizedDeferredPaths = [...new Set([
    ...deferredPaths.map(normalizePath),
    ...manifestEntries.map(entry => normalizePath(entry.url))
      .filter(path => normalizedDeferredPrefixes.some(prefix => path.startsWith(prefix))),
  ])];
  let runtimeManifest = null;
  let runtimeManifestBytes = null;
  try {
    runtimeManifestBytes = await readFile(resolve(resolvedGlobDirectory, RUNTIME_MANIFEST_FILE));
    runtimeManifest = validateRuntimeManifest(JSON.parse(runtimeManifestBytes));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const runtimeIdentity = runtimeManifestBytes ? {
    path: RUNTIME_MANIFEST_FILE,
    sha256: createHash("sha256").update(runtimeManifestBytes).digest("hex"),
  } : null;
  const catalogSource = `self.__EAGLER_RUNTIME_MANIFEST = ${JSON.stringify(runtimeManifest)};\n`;
  const buildId = buildHash(manifestEntries, catalogSource + source, normalizedDeferredPaths);
  const temp = await mkdtemp(join(tmpdir(), "eagler-touhou-app-shell-"));
  const temporarySource = resolve(temp, "sw-src.js");
  const temporaryDestination = resolve(temp, "sw.js");
  try {
    await writeFile(temporarySource, catalogSource + source
      .replaceAll("__APP_SHELL_BUILD_ID__", buildId)
      .replace("__APP_SHELL_DEFERRED_PATHS__", JSON.stringify(normalizedDeferredPaths)), "utf8");
    const injected = await injectManifest({
      ...manifestConfig,
      additionalManifestEntries: [...mappedManifestEntries, navigationEntry],
      swSrc: temporarySource,
      swDest: temporaryDestination,
      injectionPoint: "self.__WB_MANIFEST",
    });
    const worker = await readFile(temporaryDestination);
    if (swDest) {
      await mkdir(dirname(swDest), { recursive: true });
      await writeFile(swDest, worker);
    }
    const warnings = [...firstPass.warnings, ...injected.warnings];
    if (warnings.length && !quiet) warnings.forEach(warning => console.warn(`Workbox: ${warning}`));
    const size = firstPass.size + mappedManifestBytes;
    if (!quiet) console.log(`App Shell Workbox: ${buildId} - ${injected.count} files - ${size} bytes`);
    return Object.freeze({
      buildId, count: injected.count, size,
      warnings: Object.freeze(warnings), worker,
      manifestEntries: Object.freeze(manifestEntries.map(entry => Object.freeze({ ...entry }))),
      contract: createAppShellContract({ buildId, manifestEntries, runtimeManifest: runtimeIdentity }),
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
}
