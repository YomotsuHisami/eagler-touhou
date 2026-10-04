import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
  SELF_HOST_BUNDLE_COPY_RULES,
  SELF_HOST_BUNDLE_NODE_DEPENDENCIES,
} from "../lib/self-host-bundle.mjs";
import { FRONTEND_PACKAGE_FILES, FRONTEND_UI_ARTIFACT, resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const targets = new Map(SELF_HOST_BUNDLE_COPY_RULES.map(rule => [rule.target, rule.source]));
assert.equal(targets.size, SELF_HOST_BUNDLE_COPY_RULES.length, "self-host bundle targets must be unique");

function assertCanonicalRelativePath(value, label) {
  const parts = String(value).split("/");
  assert.ok(value && !value.startsWith("/") && !value.includes("\\") &&
    parts.every(part => part && part !== "." && part !== ".."), `${label}: ${value}`);
}

function moduleSpecifiers(source, path) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  const specifiers = [];
  function add(node, kind) {
    if (!node) return;
    if (node.type !== "Literal" || typeof node.value !== "string") return;
    specifiers.push(node.value);
  }
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") {
      if (node.source) add(node.source, node.type);
    } else if (node.type === "ImportExpression") {
      add(node.source, "dynamic import");
    }
    for (const [key, value] of Object.entries(node)) {
      if (["start", "end", "loc", "source"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  return specifiers;
}

for (const rule of SELF_HOST_BUNDLE_COPY_RULES) {
  assertCanonicalRelativePath(rule.source, "unsafe self-host bundle source");
  assertCanonicalRelativePath(rule.target, "unsafe self-host bundle target");
  const info = await stat(resolve(project, rule.source));
  assert.equal(info.isFile(), true, `self-host bundle source is not a file: ${rule.source}`);
}

for (const file of FRONTEND_PACKAGE_FILES) {
  const source = relative(project, resolveFrontendPackageSource(file)).replaceAll("\\", "/");
  const target = FRONTEND_UI_ARTIFACT.publishedFiles.includes(file) ? `ui-prebuilt/${file}`
    : ['en.html','lobby.html'].includes(file) ? 'ui-prebuilt/index.html' : file;
  assert.equal(targets.get(target),source,`frontend input missing from self-host bundle: ${file}`);
}
assert.ok(targets.has('ui-prebuilt/ui-artifact.json'));
assert.ok(targets.has('ui-prebuilt/ui-ownership.json'));
assert.equal(targets.has('assets/launcher/app.mjs'),false,'obsolete browser entry is not a self-host build input');
assert.ok([...targets.keys()].every(target => !target.startsWith("public/")),
  "the source-only public/ directory must not leak into self-host bundle targets");
for (const required of [
  "ui-prebuilt/index.html",
  "assets/contracts/product-catalog.mjs",
  "host/build.mjs",
  "host/build-import.mjs",
  "host/lib/site-builder.mjs",
  "scripts/package-external-site.mjs",
  "scripts/package-server.mjs",
  "scripts/verify-deployed-site.mjs",
  "scripts/verify-server-build.mjs",
  "scripts/prepare-th06-language-pack.mjs",
  "SELF-HOSTING.md",
  "SELF-HOSTING-REFERENCE.md",
  "EXTERNAL_RESOURCE_MODE.md",
  "package.json",
  "package-lock.json",
]) assert.ok(targets.has(required), `required self-host bundle file missing: ${required}`);

assert.ok(!SELF_HOST_BUNDLE_NODE_DEPENDENCIES.includes("typescript"), "self-host bundle must consume compiled Launcher output, not TypeScript");
assert.deepEqual(
  [...targets.keys()].filter(target => target.startsWith("src/")),
  ["src/app-shell-sw.js", "src/runtime-cache-sw.js"],
  "self-host bundle may ship only the owned classic Service Worker build inputs from src/",
);
assert.ok([...targets.keys()].every(target => !target.toLowerCase().endsWith(".mts")),
  "self-host bundle must not ship maintainer TypeScript source");
assert.ok([...targets.keys()].every(target => !target.toLowerCase().endsWith(".ps1")),
  "self-host bundle must not require PowerShell or ship maintainer PowerShell entrypoints");
assert.ok([...targets.keys()].every(target => !target.startsWith("tools/maintainer/")),
  "self-host bundle must not ship maintainer tooling");

for (const target of targets.keys()) {
  const segments = target.toLowerCase().split("/");
  const maintainerOnly = segments.some(segment =>
    ["test-", "test_", "test.", "run-", "audit-", "profile-", "playwright", "webkit"]
      .some(prefix => segment.startsWith(prefix)));
  assert.equal(maintainerOnly, false, `maintainer/test file leaked into self-host bundle: ${target}`);
  assert.notEqual(target, "server/netplay-relay.mjs", "relay server must not be bundled into the static self-host bundle");
}

// Exercise the actual packaged boundary, not only the source-checkout
// manifest. This fixture is assembled from the production copy rules and keeps
// src/app-shell-sw.js while omitting all TypeScript sources and node_modules.
// Before the source-set check in launcher-build.mjs, importing the copied
// launcher-build module incorrectly treated this as a source checkout and
// failed with "Application TypeScript source tree is empty".
const smokeRoot = await mkdtemp(resolve(project, ".cache", "self-host-bundle-smoke-"));
try {
  for (const rule of SELF_HOST_BUNDLE_COPY_RULES) {
    const source = resolve(project, rule.source);
    const target = resolve(smokeRoot, rule.target);
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(source, target);
  }
  const packagedLauncher = await import(pathToFileURL(resolve(smokeRoot, "lib/launcher-build.mjs")).href);
  const packagedResult = await packagedLauncher.ensureLauncherBuild({ force: true });
  assert.deepEqual(packagedResult, { built: false, mode: "prebuilt", sourceCount: 0 });
  assert.equal(
    packagedLauncher.resolveBrowserPublicationSource("assets/contracts/product-catalog.mjs"),
    resolve(smokeRoot, "assets/contracts/product-catalog.mjs"),
    "self-host bundle must resolve compiled browser modules from packaged assets",
  );
  assert.equal(
    packagedLauncher.resolveBrowserPublicationSource("product-catalog.mjs"),
    resolve(smokeRoot, "product-catalog.mjs"),
    "self-host bundle must resolve browser facades from packaged root files",
  );
  const packagedManifest = await import(pathToFileURL(resolve(smokeRoot, "lib/frontend-manifest.mjs")).href);
  assert.ok(packagedManifest.BROWSER_MODULE_FILES.some(path=>/^assets\/entry\.client-/.test(path)));
  assert.ok(packagedManifest.BROWSER_MODULE_FILES.length>2);
  assert.equal(packagedManifest.FRONTEND_UI_ARTIFACT.artifactId,FRONTEND_UI_ARTIFACT.artifactId);
  for(const file of packagedManifest.FRONTEND_PACKAGE_FILES)await stat(packagedManifest.resolveFrontendPackageSource(file));

  // A fresh bundle has no node_modules yet. Doctor must still reach its own
  // environment/input diagnostics instead of failing during module loading.
  const doctor = spawnSync(process.execPath, [
    resolve(smokeRoot, "scripts", "inspect-host.mjs"),
    `--root=${smokeRoot}`,
  ], {
    cwd: smokeRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(doctor.status, 1, "incomplete smoke bundle should fail Host input validation");
  assert.ok(`${doctor.stdout}\n${doctor.stderr}`.includes("Eagler Touhou Host Check"),
    "host:doctor must reach its own diagnostics before npm ci installs package dependencies");

  const external = spawnSync(process.execPath, [
    resolve(smokeRoot, "scripts", "package-external-site.mjs"),
  ], {
    cwd: smokeRoot,
    encoding: "utf8",
  });
  assert.equal(external.status, 1, "External packaging without arguments should fail its input contract");
  assert.ok(`${external.stdout}\n${external.stderr}`.includes("missing --source=PATH"),
    "packaged External entrypoint must load its complete module closure and reach argument validation");
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

const allowedBareImports = new Set(SELF_HOST_BUNDLE_NODE_DEPENDENCIES);
for (const [target, source] of targets) {
  const lowerTarget = target.toLowerCase();
  if (!lowerTarget.endsWith(".js") && !lowerTarget.endsWith(".mjs")) continue;
  const text = await readFile(resolve(project, source), "utf8");
  for (const specifier of moduleSpecifiers(text, target)) {
    if (specifier.startsWith("node:")) continue;
    if (!specifier.startsWith(".")) {
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      assert.ok(allowedBareImports.has(packageName), `${target}: undeclared self-host npm dependency ${packageName}`);
    }
  }
}

const packageTemplate = JSON.parse(await readFile(resolve(project, "host/bundle/package.json"), "utf8"));
assert.deepEqual(Object.keys(packageTemplate.dependencies).sort(), [...SELF_HOST_BUNDLE_NODE_DEPENDENCIES].sort());
assert.equal(packageTemplate.devDependencies, undefined);
assert.deepEqual(Object.keys(packageTemplate.scripts).sort(), [
  "host",
  "host:build",
  "host:doctor",
  "import",
  "package:external-site",
  "verify:deployed",
  "verify:server",
]);
assert.ok(Object.values(packageTemplate.scripts).every(command => !/pwsh|powershell/i.test(command)),
  "self-host npm commands must not require PowerShell");

console.log(JSON.stringify({
  selfHostBundle: "PASS",
  files: SELF_HOST_BUNDLE_COPY_RULES.length,
  nodeDependencies: SELF_HOST_BUNDLE_NODE_DEPENDENCIES,
}));
