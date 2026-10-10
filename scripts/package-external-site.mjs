#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { normalizeProductSelection } from "../lib/product-selection.mjs";
import { validateHostManifest } from "../lib/contracts/host-manifest.mjs";
import { run } from "../host/lib/process.mjs";
import { readReactFrontendArtifact } from "../lib/react-frontend-artifact.mjs";
import { normalizeSiteUrl } from "../lib/site-metadata.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf("=");
  if (!value.startsWith("--") || split < 3) throw new Error(`invalid argument: ${value}`);
  return [value.slice(2, split), value.slice(split + 1)];
}));
const required = name => {
  if (!args[name]) throw new Error(`missing --${name}=PATH`);
  return resolve(args[name]);
};

const source = required("source");
const output = required("output");
const runtimeRelease = required("runtime-release");
const candidate = resolve(dirname(output), `.${basename(output)}.external-${randomUUID()}`);
const profile = String(args.profile || "");
if (!/^web-(?:validation|release)-/.test(profile)) throw new Error("external packaging requires an explicit web-validation-* or web-release-* --profile=NAME");
if (source === output) throw new Error("external output must differ from its hosted source");
if (args["test-build"] !== undefined && !["0", "1"].includes(args["test-build"])) throw new Error("--test-build must be 0 or 1");

// Preserve the entire input publication, including its inventory. Resolve an
// existing parent when the requested output does not exist yet, so a parent
// symlink cannot hide source/output ancestry before candidate creation.
async function canonicalTarget(path) {
  const suffix = [];
  for (let parent = path; ; parent = dirname(parent)) {
    try {return resolve(await realpath(parent), ...suffix);}
    catch (error) {
      if (error?.code !== "ENOENT" || dirname(parent) === parent) throw error;
      suffix.unshift(basename(parent));
    }
  }
}
const [ownedSource, ownedOutput] = await Promise.all([canonicalTarget(source), canonicalTarget(output)]);
const contains = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
if (contains(ownedSource, ownedOutput) || contains(ownedOutput, ownedSource)) throw new Error("external source and output directories must not overlap");

await run(process.execPath, [resolve(project, "scripts/verify-server-build.mjs"), source], { cwd: project });
const sourceDeployment = JSON.parse(await readFile(resolve(source, "deployment.json"), "utf8"));
if (sourceDeployment.resourceMode !== "hosted") throw new Error("external source must be a verified hosted deployment");
// The verified hosted input owns the UI, not the caller's checkout selection.
// React deployments embed the original private build metadata in their hash-
// verified deployment and need no maintainer build directory for conversion.
const sourceFrontend = sourceDeployment.frontend
  ? await readReactFrontendArtifact({directory: source, metadata: sourceDeployment.frontend.validationMetadata,
    expectedMountPath: sourceDeployment.frontend.mountPath})
  : null;
const siteUrl = normalizeSiteUrl(args["site-url"] ?? (sourceFrontend ? sourceDeployment.siteUrl : null));
if (sourceFrontend) {
  const destination = siteUrl ? new URL(siteUrl) : null;
  if (destination && destination.pathname !== sourceFrontend.mountPath) throw new Error("React external destination does not match the source frontend mount");
  if (sourceFrontend.appShell && (!destination || destination.origin !== sourceFrontend.appShell.origin ||
      destination.pathname !== sourceFrontend.appShell.mountPath)) {
    throw new Error("React external relocation requires a separately built artifact for the exact isolated origin and mount");
  }
}
const sourceManifest = validateHostManifest(JSON.parse(await readFile(resolve(source, "host-manifest.json"), "utf8")));
const games = normalizeProductSelection(args.games || sourceDeployment.games?.join(","));
if (games.some(game => !sourceManifest.games[game])) throw new Error("external selection is missing from the hosted source");
const runtimeManifest = JSON.parse(await readFile(resolve(runtimeRelease, "runtime-release.json"), "utf8"));
for (const game of games) {
  if (runtimeManifest.games?.[game]?.dataLayout !== sourceManifest.games[game].gameData.layout) {
    throw new Error(`${game}: Runtime Release data layout does not match the hosted Package source`);
  }
}

async function runtimeInventory(root) {
  const files = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.set(relative(root, path).replaceAll("\\", "/"), await readFile(path));
      else throw new Error(`unsupported Runtime entry: ${path}`);
    }
  }
  for (const game of games) await walk(resolve(root, "runtime", game));
  return files;
}

async function assertMatchingRuntimeTrees(hostedRoot, externalRoot) {
  const [hostedFiles, externalFiles] = await Promise.all([
    runtimeInventory(hostedRoot),
    runtimeInventory(externalRoot),
  ]);
  if (JSON.stringify([...hostedFiles.keys()].sort()) !== JSON.stringify([...externalFiles.keys()].sort())) {
    throw new Error("external Runtime file set does not match its hosted source");
  }
  for (const [path, bytes] of hostedFiles) {
    if (!bytes.equals(externalFiles.get(path))) throw new Error(`external Runtime identity does not match hosted source: ${path}`);
  }
}

const featureConfig = resolve(tmpdir(), `eagler-touhou-external-features-${randomUUID()}.json`);
let frontendBuild = null;
try {
  const frontendEnvironment = {EAGLER_FRONTEND: sourceFrontend ? "react" : "main"};
  if (sourceFrontend) {
    frontendBuild = await mkdtemp(resolve(tmpdir(), "eagler-touhou-external-frontend-"));
    const client = resolve(frontendBuild, "client"), inventory = new Map(sourceDeployment.files.map(file => [file.path, file]));
    for (const path of sourceFrontend.packageFiles) {
      const bytes = await readFile(sourceFrontend.resolveSource(path)), expected = inventory.get(path);
      if (!expected || bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
        throw new Error(`hosted React frontend changed during external packaging: ${path}`);
      }
      await mkdir(resolve(client, path, ".."), {recursive: true});
      await writeFile(resolve(client, path), bytes);
    }
    const values = [sourceFrontend.metadata.manifest, sourceFrontend.metadata.graph];
    for (const [index, path] of sourceFrontend.artifactMetadataFiles.entries()) {
      await mkdir(resolve(client, path, ".."), {recursive: true});
      await writeFile(resolve(client, path), `${JSON.stringify(values[index])}\n`);
    }
    Object.assign(frontendEnvironment, {EAGLER_REACT_BUILD_DIRECTORY: frontendBuild, EAGLER_REACT_MOUNT_PATH: sourceFrontend.mountPath});
  }
  await writeFile(featureConfig, `${JSON.stringify({
    schema: "eagler-touhou/server-features/1",
    resourceMode: "external",
    games: Object.fromEntries(games.map(game => [game, {
      languages: (sourceManifest.games[game].languageOptions || []).map(language => language.id).filter(Boolean),
      thprac: !!sourceManifest.games[game].features?.thprac,
    }])),
    ...(sourceManifest.shared.netplayRelay ? { netplayRelay: sourceManifest.shared.netplayRelay } : {}),
    ...(sourceManifest.shared.originMigration ? { originMigration: sourceManifest.shared.originMigration } : {}),
  }, null, 2)}\n`);
  await run(process.execPath, [
    resolve(project, "scripts/package-server.mjs"),
    `--output=${candidate}`,
    `--runtime-release=${runtimeRelease}`,
    `--previous-site=${source}`,
    `--host-manifest=${resolve(source, "host-manifest.json")}`,
    `--artwork-dir=${resolve(source, "assets")}`,
    `--feature-config=${featureConfig}`,
    `--games=${games.join(",")}`,
    `--profile=${profile}`,
    `--test-build=${args["test-build"] || "0"}`,
    ...(siteUrl ? [`--site-url=${siteUrl}`] : []),
  ], { cwd: project, env: frontendEnvironment });
  await run(process.execPath, [resolve(project, "scripts/verify-server-build.mjs"), candidate], { cwd: project });
  const candidateDeployment = JSON.parse(await readFile(resolve(candidate, "deployment.json"), "utf8"));
  if (!isDeepStrictEqual(candidateDeployment.frontend ?? null, sourceDeployment.frontend ?? null)) {
    throw new Error("external frontend identity does not match its hosted source");
  }
  await assertMatchingRuntimeTrees(source, candidate);
  await rm(output, { recursive: true, force: true });
  await rename(candidate, output);
} finally {
  await rm(featureConfig, { force: true });
  await rm(candidate, { recursive: true, force: true });
  if (frontendBuild) await rm(frontendBuild, {recursive: true, force: true});
}
