import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { HOST_SITE_ARTWORK_FILES } from "../../lib/frontend-static-manifest.mjs";
import { buildAppShell } from "../../lib/app-shell-build.mjs";
import { writeRuntimeFixture } from "./runtime-recovery-fixture.mjs";

const [directory, version = "a"] = process.argv.slice(2);
if (!directory || !/^[a-z0-9-]+$/.test(version)) throw new Error("usage: build-pwa-fixture.mjs OUTPUT [VERSION]");
const root = resolve(directory);
const target = process.env.EAGLER_PWA_TEST_TARGET || "main";
if (!["main", "react"].includes(target)) throw new Error("EAGLER_PWA_TEST_TARGET must be main or react");
let reactDeployment = null;
if (target === "react") {
  const {assertUiRewriteRuntime} = await import("../../scripts/ui-rewrite/check-runtime.mjs");
  assertUiRewriteRuntime();
  const origin = process.env.EAGLER_PWA_TEST_ORIGIN;
  const site = process.env.EAGLER_PWA_TEST_SITE_ROOT;
  if (!origin || !site) throw new Error("React PWA fixture requires its bound loopback origin and site root");
  const subdirectory = relative(resolve(site), root).split(sep).join("/");
  if (subdirectory === ".." || subdirectory.startsWith("../") || subdirectory.startsWith("/")) throw new Error("React PWA fixture must remain inside its test site");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) throw new Error("React PWA fixture origin must be loopback");
  const {validateReactAppShellDeployment} = await import("../../app/services/app-shell-deployment.ts");
  reactDeployment = validateReactAppShellDeployment({schema: "eagler-touhou/react-app-shell/1", origin,
    mountPath: subdirectory ? `/${subdirectory}/` : "/"});
}
// Legacy publication is the unchanged default. React compiles authored inputs
// directly, so a cold source checkout never initializes the old Launcher build.
const {FRONTEND_PACKAGE_FILES, APP_SHELL_FILES, resolveFrontendPackageSource} = reactDeployment
  ? {} : await import("../../lib/frontend-manifest.mjs");
const {resolveBrowserPublicationSource} = reactDeployment ? {} : await import("../../lib/launcher-build.mjs");
let {writeRuntimeGeneration, publishRuntimeManifest} = reactDeployment ? {} : await import("../../lib/runtime-generations.mjs");
await mkdir(root, { recursive: true });
if (reactDeployment) {
  // Compile the selected mount using React Router basename and Vite base. Keep
  // the original fixture's synthetic icons and every existing nested scope.
  const project = fileURLToPath(new URL("../../", import.meta.url));
  await mkdir(resolve(project, ".cache"), {recursive: true});
  const work = await mkdtemp(resolve(project, ".cache/react-pwa-fixture-"));
  const client = resolve(work, "client");
  try {
    const {build} = await import("esbuild");
    const {authoredSourcesPlugin} = await import("../react-main/authored-sources.mjs");
    const runtimeWriter = resolve(work, "runtime-writer.mjs");
    await build({stdin: {contents: 'export {writeRuntimeGeneration, publishRuntimeManifest} from "./lib/runtime-generations.mjs";',
      resolveDir: project}, outfile: runtimeWriter, bundle: true, platform: "node", format: "esm",
      packages: "external", plugins: [authoredSourcesPlugin(project)], logLevel: "silent"});
    ({writeRuntimeGeneration, publishRuntimeManifest} = await import(pathToFileURL(runtimeWriter).href));
    execFileSync(process.execPath, [resolve(project, "node_modules/@react-router/dev/bin.cjs"), "build"], {
      cwd: project, stdio: "inherit", env: {...process.env,
        EAGLER_REACT_MOUNT_PATH: reactDeployment.mountPath,
        EAGLER_REACT_BUILD_DIRECTORY: work,
        EAGLER_REACT_APP_SHELL: "isolated",
        EAGLER_REACT_APP_SHELL_ORIGIN: reactDeployment.origin},
    });
    const artwork = new Set(HOST_SITE_ARTWORK_FILES.map(path => `assets/${path}`));
    await cp(client, root, {recursive: true, filter: source => {
      const path = relative(client, source).split(sep).join("/");
      // Keep the current worker until the final fixture metadata is hashed.
      return path !== "app-shell-sw.js" && !artwork.has(path);
    }});
  } finally { await rm(work, {recursive: true, force: true}); }
} else for (const path of FRONTEND_PACKAGE_FILES) {
  try {
    const bytes = await readFile(resolveFrontendPackageSource(path));
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), bytes);
  } catch (error) {
    if (error.code !== "ENOENT" || APP_SHELL_FILES.includes(path)) throw error;
  }
}
// Change shell bytes too, so corrupt-shell installation tests cannot reuse an
// unchanged index from the preceding generation instead of reading the fault.
const index = resolve(root, "index.html");
await writeFile(index, (await readFile(index, "utf8")).replace("</head>",
  `<meta name="pwa-fixture-shell" content="${version}"></head>`));
// Exercise the same selector source used by the real Launcher, not a test-only
// cache implementation. Its fixture ESM publication is kept outside Runtime.
if (reactDeployment) {
  const {build} = await import("esbuild");
  const project = fileURLToPath(new URL("../../", import.meta.url));
  await build({entryPoints: [resolve(project, "src/launcher/runtime-launch.mts"), resolve(project, "src/contracts/runtime-generations.mts")],
    outdir: resolve(root, "fixture"), outbase: resolve(project, "src"), outExtension: {".js": ".mjs"},
    bundle: false, platform: "browser", format: "esm", logLevel: "silent"});
} else for (const [source, target] of [
  ["assets/launcher/runtime-launch.mjs", "fixture/launcher/runtime-launch.mjs"],
  ["assets/contracts/runtime-generations.mjs", "fixture/contracts/runtime-generations.mjs"],
]) {
  await mkdir(dirname(resolve(root, target)), { recursive: true });
  await writeFile(resolve(root, target), await readFile(resolveBrowserPublicationSource(source)));
}
const groups = [];
for (const game of ["pwa-test", "pwa-unused"]) {
  const source = resolve(root, ".tmp", game);
  await rm(source, { recursive: true, force: true });
  await writeRuntimeFixture(source, version);
  const current = await writeRuntimeGeneration({ site: root, root: `runtime/${game}/`, source,
    entry: "runtime.html", names: await readdir(source) });
  groups.push({ root: `runtime/${game}/`, current });
  await rm(source, { recursive: true });
}
await publishRuntimeManifest(root, groups);
// Rehash only after the unchanged version marker, selector modules and Runtime
// generations have been injected. No generated hydration data is rewritten.
const result = reactDeployment
  ? await (await import("../../scripts/ui-rewrite/app-shell-build.ts")).buildReactAppShell({
    clientDirectory: root, mountPath: reactDeployment.mountPath, appShell: reactDeployment,
    additionalShellFiles: ["fixture/launcher/runtime-launch.mjs", "fixture/contracts/runtime-generations.mjs"],
  })
  : await buildAppShell({ quiet: true, globDirectory: root,
  swDest: resolve(root, "app-shell-sw.js"), additionalGlobPatterns: ["runtime/pwa-test/**/*", "runtime/pwa-unused/**/*", "fixture/**/*.mjs"],
  deferredPathPrefixes: ["runtime/pwa-test/", "runtime/pwa-unused/"],
});
if (result.warnings.length) throw new Error(result.warnings.join("\n"));
if (result.manifestEntries.some(entry => !/^[a-f0-9]{64}$/.test(entry.revision || ""))) throw new Error("non-SHA-256 precache entry");
console.log(JSON.stringify({ build: result.buildId, entries: result.count }));
