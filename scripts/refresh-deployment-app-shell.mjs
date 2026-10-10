#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendSelection, reactFrontendArtifactDirectory, readReactFrontendArtifact } from "../lib/react-frontend-artifact.mjs";
import { resolveRuntimeGenerationWorkerSource } from "../lib/contracts-build.mjs";
import { run } from "../host/lib/process.mjs";
import { isDeepStrictEqual } from "node:util";
import { sourceIdentity, verifyReleaseManifestDeclaration, writeReleaseManifest } from "../lib/release-manifest.mjs";
import { normalizeSiteUrl, writeSiteMetadata } from "../lib/site-metadata.mjs";
import { PRIVATE_FRONTEND_ASSETS, privateFrontendAssetSource } from "../lib/private-frontend-assets.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const values = process.argv.slice(2);
const refreshFrontend = values.includes("--frontend");
const siteUrlOption = values.find(value => value.startsWith("--site-url="));
const artworkOption = values.find(value => value.startsWith("--artwork-dir="));
const rootValue = values.find(value => !value.startsWith("--"));
if (!rootValue || values.some(value => value !== rootValue && value !== "--frontend" && value !== siteUrlOption && value !== artworkOption)) {
  throw new Error("usage: node scripts/refresh-deployment-app-shell.mjs <deployment-root> [--frontend] [--site-url=https://example.com/] [--artwork-dir=<path>]");
}
const root = resolve(rootValue);
const artworkRoot = artworkOption ? resolve(artworkOption.slice("--artwork-dir=".length)) : null;
if (artworkRoot && !refreshFrontend) throw new Error("--artwork-dir requires --frontend");

const deploymentBytes = await readFile(resolve(root, "deployment.json"));
const deployment = JSON.parse(deploymentBytes);
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) {
  throw new Error("invalid deployment manifest");
}
const reactTarget = deployment.frontend?.kind === "react";
if (reactTarget) {
  // A shell-only refresh inherits its frontend from the target. Select its
  // contract context before importing any cached canonical contract facade.
  // Frontend replacement still requires the caller's explicit selection.
  if (refreshFrontend && frontendSelection() !== "react") throw new Error("React frontend refresh requires explicit EAGLER_FRONTEND=react");
  if (process.env.EAGLER_FRONTEND !== "react") {
    const result = await run(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...values], {
      env: {EAGLER_FRONTEND: "react"}, allowFailure: true,
    });
    process.exit(result.code);
  }
}
const { freezeHostRuntimes, verifyRuntimePublication, verifyRuntimeGenerationDirectory } = await import("../lib/runtime-generations.mjs");
const { buildAppShell } = await import("../lib/app-shell-build.mjs");
const { runtimeAppShellPaths } = await import("../lib/app-shell-validation.mjs");
const { hostArtworkFiles } = await import("../lib/host-artwork.mjs");
const { RUNTIME_GENERATION_FILE, RUNTIME_MANIFEST_FILE, parseRuntimeGenerationPath } = await import("../lib/contracts/runtime-generations.mjs");
const { HOST_MANIFEST_FILE, validateHostManifest } = await import("../lib/contracts/host-manifest.mjs");
const { WORKSPACE_REPOSITORIES } = await import("../lib/workspace-layout.mjs");
const hostManifest = validateHostManifest(JSON.parse(await readFile(resolve(root, HOST_MANIFEST_FILE), "utf8")));
const siteUrl = normalizeSiteUrl(siteUrlOption?.slice("--site-url=".length) || deployment.siteUrl);
let previousArtifact = null, selectedArtifact = null, frontend = null;
if (reactTarget) {
  previousArtifact = await readReactFrontendArtifact({directory: root,
    metadata: deployment.frontend.validationMetadata, expectedMountPath: deployment.frontend.mountPath});
  if ((previousArtifact.appShell === null) !== (deployment.appShell === null)) throw new Error("React deployment App Shell permission does not match its artifact");
  selectedArtifact = refreshFrontend ? await readReactFrontendArtifact({
    directory: reactFrontendArtifactDirectory({project}), expectedMountPath: previousArtifact.mountPath,
  }) : previousArtifact;
  if (!isDeepStrictEqual(selectedArtifact.appShell, previousArtifact.appShell)) {
    throw new Error("React refresh must preserve the deployment's App Shell permission and isolated origin/mount");
  }
  const selectedSite = siteUrl ? new URL(siteUrl) : null;
  if (selectedSite && selectedSite.pathname !== selectedArtifact.mountPath) throw new Error("site URL does not match the React frontend artifact mount");
  if (selectedArtifact.appShell && (!selectedSite || selectedSite.origin !== selectedArtifact.appShell.origin ||
      selectedSite.pathname !== selectedArtifact.appShell.mountPath)) throw new Error("React refresh site URL must match the exact isolated origin and mount");
  if (!refreshFrontend && siteUrl !== normalizeSiteUrl(deployment.siteUrl)) throw new Error("React site URL changes require --frontend");
  if (!(await lstat(root)).isDirectory()) throw new Error("React refresh requires an ordinary preparation directory, not a live publication symlink");
} else {
  if (Object.hasOwn(deployment, "frontend")) throw new Error("invalid deployment frontend identity");
  if (frontendSelection() === "react") throw new Error("cannot refresh a main deployment with the React frontend; use explicit server packaging instead");
  frontend = await import("../lib/frontend-manifest.mjs");
}

// Same sibling staging and mkdir-lock patterns as the existing publication
// tools. The target stays untouched until the candidate passes its verifier.
const token = randomUUID();
const candidate = reactTarget ? resolve(dirname(root), `.${basename(root)}.refresh-candidate-${token}`) : null;
const backup = reactTarget ? resolve(dirname(root), `.${basename(root)}.refresh-previous-${token}`) : null;
const lock = reactTarget ? resolve(dirname(root), `.${basename(root)}.refresh-lock`) : null;
const appRoot = candidate || root;
const swPath = resolve(appRoot, "app-shell-sw.js");
const deploymentPath = resolve(appRoot, "deployment.json");
const hostManifestPath = resolve(appRoot, HOST_MANIFEST_FILE);
let originalFiles = null, selectedFiles = null, previousRelease = null, ownsLock = false;

async function inventoryTree(directory, {sidecars = false} = {}, prefix = "", files = []) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    if (item.name === ".tmp") {
      if (reactTarget && !item.isDirectory()) throw new Error(`React refresh temporary path must be an ordinary directory: ${prefix}.tmp`);
      continue;
    }
    const path = prefix + item.name;
    if (item.isDirectory()) await inventoryTree(resolve(directory, item.name), {sidecars}, path + "/", files);
    else if (sidecars || !["deployment.json", "release-manifest.json", "checksums.txt"].includes(path)) {
      if (!item.isFile()) throw new Error(`Non-file in publication: ${path}`);
      const contents = await readFile(resolve(directory, item.name));
      files.push({path, bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex")});
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
async function artifactIdentities(artifact) {
  return Promise.all(artifact.packageFiles.map(async path => {
    const bytes = await readFile(artifact.resolveSource(path));
    return {path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  }));
}

try {
if (reactTarget) {
  await mkdir(lock); ownsLock = true;
  if (!(await readFile(resolve(root, "deployment.json"))).equals(deploymentBytes)) throw new Error("deployment changed while preparing refresh");
  previousRelease = await verifyReleaseManifestDeclaration(root);
  if (!isDeepStrictEqual(previousRelease.parameters?.frontend, {kind: "react", mountPath: previousArtifact.mountPath})) {
    throw new Error("deployment frontend does not match Release Manifest provenance");
  }
  originalFiles = await inventoryTree(root, {sidecars: true});
  const observed = new Map(originalFiles.map(item => [item.path, item]));
  const declared = new Set(previousRelease.files.map(item => item.path));
  // The existing publisher may have added retained immutable generations and
  // rewritten only the Runtime pointer. Every other previously owned file is
  // still required to match its release identity; arbitrary edits are not a
  // license to regenerate their hashes.
  for (const item of previousRelease.files) {
    if (item.path !== RUNTIME_MANIFEST_FILE && !isDeepStrictEqual(observed.get(item.path), item)) {
      throw new Error(`refresh source file differs from Release Manifest: ${item.path}`);
    }
  }
  await verifyRuntimePublication(root, hostManifest);
  const checked = new Set();
  for (const item of originalFiles) {
    if (declared.has(item.path) || ["deployment.json", "release-manifest.json", "checksums.txt"].includes(item.path)) continue;
    const parsed = parseRuntimeGenerationPath(item.path);
    if (!parsed) throw new Error(`unowned refresh source file: ${item.path}`);
    const generation = parsed.root + parsed.generation;
    if (!checked.has(generation)) {
      const descriptor = JSON.parse(await readFile(resolve(root, generation, RUNTIME_GENERATION_FILE), "utf8"));
      if (descriptor.generation !== parsed.generation) throw new Error(`Runtime archive directory identity mismatch: ${generation}`);
      await verifyRuntimeGenerationDirectory(root, parsed.root, descriptor);
      checked.add(generation);
    }
  }
  if (refreshFrontend) selectedFiles = await artifactIdentities(selectedArtifact);
  await cp(root, candidate, {recursive: true, dereference: false, errorOnExist: true, force: false,
    filter: source => basename(source) !== ".tmp"});
  await mkdir(resolve(candidate, ".tmp"));
}

// Source/deployment preparation, not a hot in-place server update. Migrate any
// legacy loose code as one verified generation before rebuilding the shell.
await freezeHostRuntimes(appRoot, hostManifest);
await writeFile(hostManifestPath, `${JSON.stringify(hostManifest, null, 2)}\n`);
await verifyRuntimePublication(appRoot, hostManifest);
const runtimePaths = runtimeAppShellPaths(hostManifest);
const inventoryPaths = new Set(deployment.files.map(item => item.path));
const availableHostArtwork = hostArtworkFiles(Object.keys(hostManifest.games)).filter(name =>
  inventoryPaths.has(`assets/${name}`));

const temporaryRoot = resolve(dirname(swPath), ".tmp");
// React's temporary directory was exclusively created before Runtime freezing;
// never inherit or follow a temporary symlink when preparing the worker.
if (reactTarget) {
  if (!(await lstat(temporaryRoot)).isDirectory()) throw new Error("React refresh candidate temporary path is not an ordinary directory");
} else await mkdir(temporaryRoot, { recursive: true });
const temporary = resolve(temporaryRoot, `app-shell-sw-${process.pid}-${randomUUID()}.js`);
try {
  if (refreshFrontend) {
    if (!reactTarget) await (await import("../lib/launcher-build.mjs")).ensureLauncherBuild();
    const packageFiles = selectedArtifact?.packageFiles || frontend.FRONTEND_PACKAGE_FILES;
    const resolveSource = selectedArtifact ? path => selectedArtifact.resolveSource(path) : frontend.resolveFrontendPackageSource;
    if (reactTarget) {
      const nextOwned = new Set(packageFiles);
      for (const path of previousArtifact.packageFiles) if (!nextOwned.has(path)) await rm(resolve(appRoot, path));
      deployment.frontend.validationMetadata = selectedArtifact.metadata;
    }
    const inventory = new Map(deployment.files.map(item => [item.path, item]));
    for (const path of packageFiles) {
      const target = resolve(appRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveSource(path), target);
      const bytes = await readFile(target);
      const identity = { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      const current = inventory.get(path);
      if (current) Object.assign(current, identity);
      else {
        deployment.files.push(identity);
        inventory.set(path, identity);
      }
    }
    for (const asset of PRIVATE_FRONTEND_ASSETS) {
      const source = privateFrontendAssetSource(asset.target);
      let bytes;
      try { bytes = await readFile(source); }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      const target = resolve(appRoot, asset.target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      const identity = {
        path: asset.target,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      const current = inventory.get(asset.target);
      if (current) Object.assign(current, identity);
      else {
        deployment.files.push(identity);
        inventory.set(asset.target, identity);
      }
    }
    if (artworkRoot) {
      for (const name of availableHostArtwork) {
        const path = `assets/${name}`;
        const target = resolve(appRoot, path);
        await copyFile(resolve(artworkRoot, name), target);
        const bytes = await readFile(target);
        Object.assign(inventory.get(path), {
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
    deployment.files.sort((left, right) => left.path.localeCompare(right.path, "en"));
    const metadataPaths = await writeSiteMetadata(appRoot, siteUrl);
    for (const path of metadataPaths) {
      const bytes = await readFile(resolve(appRoot, path));
      Object.assign(inventory.get(path), { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    if (siteUrl) deployment.siteUrl = siteUrl;
  }
  const result = reactTarget && !selectedArtifact.appShell ? null : await buildAppShell({
    quiet: true,
    globDirectory: appRoot,
    swDest: temporary,
    additionalGlobPatterns: availableHostArtwork.map(name => `assets/${name}`),
    deferredPaths: runtimePaths,
    deferredPathPrefixes: ["runtime/"],
    ...(reactTarget ? {shellFiles: selectedArtifact.shellFiles,
      workerContractSource: await readFile(await resolveRuntimeGenerationWorkerSource(), "utf8")} : {}),
  });
  if (result?.contract.entries.some(path => path.startsWith("runtime/"))) throw new Error("Runtime leaked into Launcher precache");
  if (result) await rename(temporary, swPath);
  else await rm(swPath, {force: true});

  const bytes = result ? await readFile(swPath) : null;
  const identity = bytes ? {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  } : null;
  const inventoryEntry = deployment.files.find(item => item.path === "app-shell-sw.js");
  if (result && !inventoryEntry) throw new Error("deployment inventory does not own app-shell-sw.js");
  if (result) Object.assign(inventoryEntry, identity);
  // Regenerate the complete inventory: migration adds immutable directories and
  // removes old mutable files. Never carry a stale path/hash from the old tree.
  deployment.files = await inventoryTree(appRoot);
  deployment.generatedAt = new Date().toISOString();
  deployment.appShell = result?.contract ?? null;
  await writeFile(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);

  if (deployment.releaseManifest === "release-manifest.json") {
    const previous = previousRelease || JSON.parse(await readFile(resolve(root, "release-manifest.json"), "utf8"));
    let launcherSource;
    try {
      launcherSource = await sourceIdentity(project);
    } catch {
      const provenance = JSON.parse(await readFile(resolve(project, "self-host-provenance.json"), "utf8"));
      if (provenance.schema !== "eagler-touhou/self-host-bundle-provenance/1" ||
          provenance.launcherRepository !== WORKSPACE_REPOSITORIES.launcher ||
          !provenance.launcherSource || typeof provenance.launcherSource !== "object") {
        throw new Error("cannot identify Launcher source for refreshed release provenance");
      }
      launcherSource = provenance.launcherSource;
    }
    await writeReleaseManifest(appRoot, {
      profile: previous.profile,
      sources: { ...previous.sources, [WORKSPACE_REPOSITORIES.launcher]: launcherSource },
      parameters: previous.parameters || {},
    });
  }

  if (reactTarget) {
    if (selectedFiles && !isDeepStrictEqual(selectedFiles, await artifactIdentities(selectedArtifact))) throw new Error("React frontend artifact changed during refresh");
    await run(process.execPath, [resolve(project, "scripts/verify-server-build.mjs"), appRoot], {capture: true});
    if (!isDeepStrictEqual(originalFiles, await inventoryTree(root, {sidecars: true}))) throw new Error("deployment changed while preparing refresh");
    await rename(root, backup);
    try {await rename(candidate, root);}
    catch (error) {
      try {await rename(backup, root);}
      catch (restoreError) {throw new AggregateError([error, restoreError], `refresh replacement and rollback failed; original deployment retained at ${backup}`);}
      throw error;
    }
    await rm(backup, {recursive: true});
  }
  console.log(JSON.stringify({
    refreshed: true,
    frontend: refreshFrontend,
    artwork: Boolean(artworkRoot),
    buildId: result?.buildId ?? null,
    precache: result?.count ?? 0,
    runtimeFiles: runtimePaths.length,
    appShellWorker: identity,
  }));
} finally {
  await rm(temporary, { force: true });
}
} finally {
  if (candidate) await rm(candidate, {recursive: true, force: true});
  if (ownsLock) await rm(lock, {recursive: true});
}
