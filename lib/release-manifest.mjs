import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

export const RELEASE_MANIFEST_SCHEMA = "eagler-touhou/release-manifest/1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function fileSetIdentity(files, identities) {
  if (!Array.isArray(files) || files.length === 0 || files.length !== identities.length || new Set(files).size !== files.length) {
    throw new Error("invalid content set");
  }
  for (const identity of identities) {
    if (!Number.isSafeInteger(identity.bytes) || identity.bytes <= 0 || !/^[a-f0-9]{64}$/.test(identity.sha256)) {
      throw new Error("invalid content identity");
    }
  }
  const sizes = identities.map(identity => identity.bytes);
  const sha256 = identities.map(identity => identity.sha256);
  const entries = files.map((file, index) => [file, sizes[index], sha256[index]]);
  return {
    sizes,
    sha256,
    version: `sha256-${hash(JSON.stringify(entries))}`,
  };
}

// Revision names clean tracked input; binary diffs and every nonignored new
// input identify the actual dirty tree. No patch contents leave the machine.
export async function sourceIdentity(root) {
  const git = args => execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const actualRoot = resolve(git(["rev-parse", "--show-toplevel"]).toString().trim());
  const normalize = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(actualRoot) !== normalize(resolve(root))) throw new Error(`source repository is not initialized: ${root}`);
  const revision = git(["rev-parse", "HEAD"]).toString().trim();
  const staged = git(["diff", "--cached", "--binary", "HEAD"]);
  const unstaged = git(["diff", "--binary"]);
  const untracked = [];
  for (const name of git(["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean).sort()) {
    untracked.push({ path: name, sha256: hash(await readFile(resolve(root, name))) });
  }
  const submodules = [];
  for (const line of git(["ls-files", "--stage", "-z"]).toString("utf8").split("\0")) {
    if (!line.startsWith("160000 ")) continue;
    const name = line.slice(line.indexOf("\t") + 1);
    const directory = resolve(root, name);
    submodules.push(existsSync(resolve(directory, ".git"))
      ? { path: name, initialized: true, ...await sourceIdentity(directory) }
      : { path: name, initialized: false, revision: line.split(" ")[1] });
  }
  const state = {
    revision,
    stagedSha256: hash(staged),
    unstagedSha256: hash(unstaged),
    untracked,
    submodules,
  };
  return {
    ...state,
    dirty: Boolean(staged.length || unstaged.length || untracked.length || submodules.some(item => item.dirty)),
    sha256: hash(JSON.stringify(state)),
  };
}

function safeFile(root, name) {
  const invalidSegment = name => name.split("/").some(part => !part || part === "." || part === "..");
  if (typeof name !== "string" || !name || name.includes("\\") || isAbsolute(name) || invalidSegment(name)) {
    throw new Error(`unsafe release path: ${name}`);
  }
  const target = resolve(root, name);
  if (relative(root, target).startsWith("..")) throw new Error(`release path escapes root: ${name}`);
  return target;
}

export async function writeReleaseManifest(root, { profile, sources, parameters = {} }) {
  if (!profile || !sources || !Object.keys(sources).length) throw new Error("release provenance needs profile and source identities");
  const deploymentBytes = await readFile(resolve(root, "deployment.json"));
  const deployment = JSON.parse(deploymentBytes);
  const inventory = [...deployment.files].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const identity = {
    profile,
    sources,
    parameters,
    files: inventory,
    deploymentSha256: hash(deploymentBytes),
  };
  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    releaseId: `sha256-${hash(JSON.stringify(identity))}`,
    ...identity,
  };
  await writeFile(resolve(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = [
    ...inventory.map(file => `${file.sha256}  ${file.path}`),
    `${manifest.deploymentSha256}  deployment.json`,
    `${hash(await readFile(resolve(root, "release-manifest.json")))}  release-manifest.json`,
  ];
  await writeFile(resolve(root, "checksums.txt"), `${checksums.join("\n")}\n`);
  return manifest;
}

async function readAndVerifyReleaseManifest(root, verifyFiles) {
  const manifest = JSON.parse(await readFile(resolve(root, "release-manifest.json"), "utf8"));
  const { schema, releaseId, ...identity } = manifest;
  if (schema !== RELEASE_MANIFEST_SCHEMA || releaseId !== `sha256-${hash(JSON.stringify(identity))}`) {
    throw new Error("release manifest identity mismatch");
  }
  if (!identity.profile || !Object.keys(identity.sources || {}).length) throw new Error("release provenance missing");
  const deploymentBytes = await readFile(resolve(root, "deployment.json"));
  if (hash(deploymentBytes) !== identity.deploymentSha256) throw new Error("release deployment identity mismatch");
  const inventory = [...JSON.parse(deploymentBytes).files]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (JSON.stringify(inventory) !== JSON.stringify(identity.files)) throw new Error("release inventory mismatch");
  const seen = new Set();
  for (const file of identity.files) {
    if (seen.has(file.path)) throw new Error(`duplicate release path: ${file.path}`);
    seen.add(file.path);
    const path = safeFile(root, file.path);
    if (verifyFiles) {
      const bytes = await readFile(path);
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`release file mismatch: ${file.path}`);
    }
  }
  const expected = [
    ...inventory.map(file => `${file.sha256}  ${file.path}`),
    `${identity.deploymentSha256}  deployment.json`,
    `${hash(await readFile(resolve(root, "release-manifest.json")))}  release-manifest.json`,
  ].join("\n") + "\n";
  if (await readFile(resolve(root, "checksums.txt"), "utf8") !== expected) {
    throw new Error("release checksum list mismatch");
  }
  return manifest;
}

/** Validate provenance, inventory declaration, and checksum sidecars without
 * accepting current payload bytes. A refresh caller must separately bound and
 * validate its permitted changes before full verification of the candidate. */
export function verifyReleaseManifestDeclaration(root) {
  return readAndVerifyReleaseManifest(root, false);
}

export function verifyReleaseManifest(root) {
  return readAndVerifyReleaseManifest(root, true);
}
