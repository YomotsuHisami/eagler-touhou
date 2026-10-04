import { existsSync, readdirSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";
import { localModuleClosure } from "./browser-module-graph.mjs";
import { resolvePublicOrRepositorySource } from "./public-source.mjs";

const modulePath = fileURLToPath(import.meta.url);
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(project, "src");
const buildRoot = resolve(project, ".cache", "build", "browser");
const optimizedRoot = resolve(project, ".cache", "build", "optimized");
const buildStatePath = resolve(project, ".cache", "launcher-build-state.json");
const buildLockPath = resolve(project, ".cache", "launcher-build.lock");
const outputRoot = resolve(buildRoot, "assets");
const generatedOutputRoots = Object.freeze([
  resolve(outputRoot, "contracts"),
  resolve(outputRoot, "launcher"),
]);
const configPath = resolve(project, "tsconfig.launcher.json");
const tscPath = resolve(project, "node_modules", "typescript", "bin", "tsc");
const browserFacadePaths = new Set([
  "host-manifest.mjs",
  "product-catalog.mjs",
  "release-catalog.mjs",
  "resource-mode.mjs",
  "runtime-protocol.mjs",
]);

function containsTypeScriptSource(directory) {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? containsTypeScriptSource(path)
      : entry.isFile() && extname(entry.name) === ".mts";
  });
}

// A self-host bundle intentionally contains src/app-shell-sw.js, so the src/ directory
// alone cannot distinguish it from a maintainer checkout. The TypeScript source
// set is the stable boundary: it exists in the checkout and is absent from a
// packaged self-host bundle.
const hasTypeScriptSource = containsTypeScriptSource(sourceRoot);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function collectDeclarationBridges(directory = project) {
  if (!await exists(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && directory === project && ["package", "legacy"].includes(entry.name)) {
      files.push(...await collectDeclarationBridges(path));
    } else if (entry.isFile() && entry.name.endsWith(".d.mts")) {
      files.push(path);
    }
  }
  return files.sort();
}

async function collectGeneratedModules(directory) {
  if (!await exists(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectGeneratedModules(path));
    else if (entry.isFile() && extname(entry.name) === ".mjs") files.push(path);
  }
  return files.sort();
}

async function filesMatch(source, target) {
  try {
    const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)]);
    if (!sourceInfo.isFile() || !targetInfo.isFile() || sourceInfo.size !== targetInfo.size) return false;
    const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)]);
    return sourceBytes.equals(targetBytes);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function collectSources(directory = sourceRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSources(path));
    else if (entry.isFile() && extname(entry.name) === ".mts") files.push(path);
  }
  return files.sort();
}

async function inputIdentity(paths) {
  const entries = [];
  for (const path of [...new Set(paths)].sort()) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Launcher build input is not a file: ${path}`);
    entries.push([relative(project, path).replaceAll("\\", "/"), info.size, info.mtimeMs]);
  }
  return entries;
}

async function outputIdentity(sources) {
  const paths = [
    ...sources.map(outputForSource),
    resolve(buildRoot, "assets/contracts/runtime-generations-worker.js"),
    resolve(project, "public/faq.html"),
    resolve(project, "public/content/FIRST_USE_NOTICE.html"),
    resolve(project, "public/content/MULTIPLAYER.html"),
  ];
  const entries = [];
  for (const path of [...new Set(paths)].sort()) {
    const info = await stat(path);
    if (!info.isFile() || !info.size) throw new Error(`Launcher build output is missing or empty: ${path}`);
    entries.push([relative(project, path).replaceAll("\\", "/"), info.size, info.mtimeMs]);
  }
  return entries;
}

async function buildStateMatches(sources, inputs) {
  try {
    const state = JSON.parse(await readFile(buildStatePath, "utf8"));
    return state?.schema === "eagler-touhou/launcher-build-state/1" &&
      JSON.stringify(state.inputs) === JSON.stringify(inputs) &&
      JSON.stringify(state.outputs) === JSON.stringify(await outputIdentity(sources));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError || /browser module is missing|missing or empty/.test(error?.message || "")) return false;
    throw error;
  }
}

async function acquireBuildLock(timeoutMs = 180000) {
  await mkdir(dirname(buildLockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(buildLockPath);
      try {
        await writeFileAtomic(resolve(buildLockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      } catch (error) {
        await rm(buildLockPath, { recursive: true, force: true });
        throw error;
      }
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out waiting for Launcher build lock: ${buildLockPath}. Remove it only after confirming no build process is running.`);
      }
      await delay(25);
    }
  }
}

function outputForSource(source) {
  const rel = relative(sourceRoot, source).replaceAll("\\", "/");
  return resolve(outputRoot, rel.replace(/\.mts$/i, ".mjs"));
}

function normalizePublicPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`invalid browser publication path: ${value}`);
  }
  return path;
}

export function isLauncherBuildOutputPath(value) {
  const path = normalizePublicPath(value);
  return path.startsWith("assets/contracts/") || path.startsWith("assets/launcher/");
}

export function isMappedBrowserPublicationPath(value) {
  const path = normalizePublicPath(value);
  return isLauncherBuildOutputPath(path) || browserFacadePaths.has(path) || ["index.html", "en.html", "styles.css", "features.css", "touch-guide.css"].includes(path);
}

export function resolveBrowserPublicationSource(value) {
  const path = normalizePublicPath(value);
  if (isLauncherBuildOutputPath(path)) {
    return hasTypeScriptSource
      ? resolve(buildRoot, path)
      : resolve(project, path);
  }
  if (browserFacadePaths.has(path)) {
    return hasTypeScriptSource
      ? resolve(project, "src", "browser-facades", path)
      : resolve(project, path);
  }
  return resolvePublicOrRepositorySource(path);
}

async function runTypeScript() {
  if (!await exists(tscPath)) {
    throw new Error("Launcher TypeScript compiler is missing; run npm ci/npm install in the source checkout");
  }
  await rm(buildRoot, { recursive: true, force: true });
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tscPath, "-p", configPath, "--pretty", "false"], {
      cwd: project,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0
      ? resolvePromise()
      : reject(new Error(`Launcher TypeScript build failed with exit code ${code ?? "unknown"}`)));
  });
}

async function runContentPages() {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(project, "scripts", "build-content-pages.mjs"), "--quiet"], {
      cwd: project,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0
      ? resolvePromise()
      : reject(new Error(`Content page build failed with exit code ${code ?? "unknown"}`)));
  });
}

async function materializeBrowserModuleOverlay(sources) {
  const sourceResolver = path => path === "assets/launcher/app.mjs" ? resolve(buildRoot, path) : resolveBrowserPublicationSource(path);
  const modules = await localModuleClosure({
    root: project,
    entries: sources.filter(path=>!/[\\/](?:app|lobby)\.mts$/.test(path)).map(path=>relative(buildRoot,outputForSource(path)).replaceAll("\\","/")),
    resolveFile: sourceResolver,
  });
  for (const path of modules) {
    if (isLauncherBuildOutputPath(path)) continue;
    const target = resolve(buildRoot, path);
    const source = resolveBrowserPublicationSource(path);
    if (await filesMatch(source, target)) continue;
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(source, target);
  }
}

async function verifyOutputs(sources) {
  for (const source of sources) {
    const output = outputForSource(source);
    const info = await stat(output);
    if (!info.isFile() || !info.size) throw new Error(`Launcher build output is missing or empty: ${output}`);
  }
}

async function ensureSourceLauncherBuild({ force = false } = {}) {
  // Packaged self-host bundles intentionally contain compiled browser modules but not
  // TypeScript sources or the compiler. In that product boundary, compilation
  // is a maintainer responsibility that has already happened upstream.
  if (!hasTypeScriptSource) {
    if (!await exists(resolve(project, "assets/contracts/product-catalog.mjs")) ||
        !await exists(resolve(project, "assets/contracts/runtime-generations-worker.js"))) {
      throw new Error("Prebuilt browser contracts are missing from this distribution");
    }
    return Object.freeze({ built: false, mode: "prebuilt", sourceCount: 0 });
  }

  const sources = await collectSources();
  if (!sources.length) throw new Error(`Application TypeScript source tree is empty: ${sourceRoot}`);
  const declarationBridges = await collectDeclarationBridges();
  const browserFacades = await collectGeneratedModules(resolve(sourceRoot, "browser-facades"));
  const inputs = await inputIdentity([
    ...sources,
    ...declarationBridges,
    ...browserFacades,
    configPath,
    tscPath,
    resolve(project, "package-lock.json"),
    modulePath,
    resolve(project, "lib/atomic-file.mjs"),
    resolve(project, "lib/browser-module-graph.mjs"),
    resolve(project, "lib/runtime-worker-build.mjs"),
    resolve(project, "lib/public-source.mjs"),
    resolve(project, "scripts/build-content-pages.mjs"),
    resolve(project, "docs/FAQ.md"),
    resolve(project, "content/FIRST_USE_NOTICE.md"),
    resolve(project, "content/MULTIPLAYER.md"),
  ]);
  if (!force && await buildStateMatches(sources, inputs)) {
    return Object.freeze({ built: false, mode: "source", sourceCount: sources.length });
  }

  // FAQ Markdown is authoritative. Every actual source build refreshes its
  // deployable HTML so maintainers never have to remember a second step.
  await runContentPages();
  const sharedInputMtime = Math.max(
    (await stat(configPath)).mtimeMs,
    (await stat(tscPath)).mtimeMs,
    ...await Promise.all(declarationBridges.map(async path => (await stat(path)).mtimeMs)),
  );
  let stale = force;
  if (!stale) {
    const expectedOutputs = sources.map(outputForSource).sort();
    const actualOutputs = (await Promise.all(generatedOutputRoots.map(collectGeneratedModules))).flat().sort();
    stale = expectedOutputs.length !== actualOutputs.length
      || expectedOutputs.some((path, index) => path !== actualOutputs[index]);
  }
  if (!stale) {
    for (const source of sources) {
      const output = outputForSource(source);
      let outputInfo;
      try { outputInfo = await stat(output); } catch { stale = true; break; }
      const sourceInfo = await stat(source);
      if (!outputInfo.isFile() || !outputInfo.size || outputInfo.mtimeMs < Math.max(sourceInfo.mtimeMs, sharedInputMtime)) {
        stale = true;
        break;
      }
    }
  }
  if (stale) await runTypeScript();
  await verifyOutputs(sources);
  await materializeBrowserModuleOverlay(sources);
  const workerBuildModule = "./runtime-worker-build.mjs";
  const {buildRuntimeWorkerContract} = await import(workerBuildModule);
  await buildRuntimeWorkerContract({project,buildRoot});
  await writeFileAtomic(buildStatePath, `${JSON.stringify({
    schema: "eagler-touhou/launcher-build-state/1",
    inputs,
    outputs: await outputIdentity(sources),
  }, null, 2)}\n`);
  return Object.freeze({ built: stale, mode: "source", sourceCount: sources.length });
}

export async function ensureLauncherBuild(options = {}) {
  // Packaged bundles are immutable inputs and never participate in the source
  // checkout's cross-process build coordination.
  if (!hasTypeScriptSource) return ensureSourceLauncherBuild(options);
  await acquireBuildLock();
  try {
    return await ensureSourceLauncherBuild(options);
  } finally {
    await rm(buildLockPath, { recursive: true });
  }
}

export const LAUNCHER_SOURCE_ROOT = resolve(sourceRoot, "launcher");
export const LAUNCHER_OUTPUT_ROOT = resolve(outputRoot, "launcher");
export const BROWSER_BUILD_ROOT = buildRoot;
