import { FRONTEND_PACKAGE_FILES, REACT_FRONTEND_ARTIFACT, resolveFrontendPackageSource } from "./frontend-manifest.mjs";
import { localModuleClosure } from "./browser-module-graph.mjs";
import { isMappedBrowserPublicationPath, resolveBrowserPublicationSource } from "./launcher-build.mjs";
import { PRODUCT_CONTENT } from "./content-definition.mjs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureContractsBuild } from "./contracts-build.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reactContracts = REACT_FRONTEND_ARTIFACT ? await ensureContractsBuild({project}) : null;
function resolveHostBuildSource(path) {
  return reactContracts && path.startsWith("assets/contracts/")
    ? resolve(reactContracts.contractsDirectory, path.slice("assets/contracts/".length))
    : resolveBrowserPublicationSource(path);
}

const verifiedOggBaselineFiles = Object.entries(PRODUCT_CONTENT)
  .filter(([, content]) => content.hostPreparation?.ogg?.kind === "verified-converter")
  .map(([game]) => `host/ogg-baselines/${game}.json`);
const preparedContentScripts = Object.values(PRODUCT_CONTENT)
  .map(content => content.hostPreparation?.preparedContent?.script)
  .filter(Boolean);
const languagePreparationScripts = Object.values(PRODUCT_CONTENT)
  .some(content => content.hostPreparation?.languagePack?.kind === "thcrap-runtime-compiler")
    ? ["scripts/prepare-th06-language-pack.mjs"]
    : [];

// The self-host bundle is a distributable product, not a trimmed source checkout.
// Every repository-owned file that can reach `npm run host` / `npm run import`
// is declared here. Maintainer tests, browser runners, publication tooling and
// relay operations stay outside this boundary.
const hostRuntimeRoots = [
  "src/app-shell-sw.js",
  "src/runtime-cache-sw.js",
  "legacy/runtime-generation-reader.js",
  "assets/contracts/runtime-generations-worker.js",
  "assets/contracts/runtime-generations.mjs",
  "config/runtime-builds.json",
  "config/workspace.json",
  "host/build.mjs",
  "host/build-import.mjs",
  "host/lib/node-environment.mjs",
  "host/lib/process.mjs",
  "host/lib/python-environment.mjs",
  "host/lib/site-builder.mjs",
  "host/lib/thtk.mjs",
  ...verifiedOggBaselineFiles,
  "host/requirements.txt",
  "host/config/site-features.default.json",
  "integrations/thcrap.mjs",
  "lib/app-shell-build.mjs",
  "lib/app-shell-policy.mjs",
  "lib/browser-module-graph.mjs",
  "lib/build-profile.mjs",
  "lib/content-definition.mjs",
  "lib/frontend-manifest.mjs",
  "lib/host-config.mjs",
  "lib/launcher-build.mjs",
  "lib/preload-data-assembler.mjs",
  "lib/product-selection.mjs",
  "lib/publication-host-seed.mjs",
  "lib/host-workspace.mjs",
  "lib/release-manifest.mjs",
  "lib/runtime-build-profiles.mjs",
  "lib/runtime-data-layout.mjs",
  "lib/runtime-data-provider.mjs",
  "lib/runtime-release.mjs",
  "lib/workspace-layout.mjs",
  "scripts/convert_bgm_ogg.py",
  "scripts/inspect-host.mjs",
  "scripts/package-external-site.mjs",
  "scripts/package-offline-game.mjs",
  "scripts/package-server.mjs",
  "scripts/prepare-host-artwork.py",
  ...preparedContentScripts,
  ...Object.values(PRODUCT_CONTENT).map(content => content.hostPreparation?.preparedContent?.baseline).filter(Boolean),
  ...languagePreparationScripts,
  "scripts/serve-static.mjs",
  "scripts/deploy-static-site.mjs",
  "scripts/refresh-deployment-app-shell.mjs",
  "scripts/subset-font.py",
  "scripts/touhou_formats.py",
  "scripts/verify-offline-game-package.mjs",
  "scripts/verify-deployed-site.mjs",
  "scripts/verify-runtime-release.mjs",
  "scripts/verify-server-build.mjs",
  "server/static-content-policy.mjs",
  "server/thcrap-ascii-contract.mjs",
  "server/thcrap-compiler.mjs",
  "server/thcrap-static-pack.mjs",
  "server/thcrap-string-contract.mjs",
  "server/thtk-runner.mjs",
  "assets/contracts/host-manifest.mjs",
  "assets/contracts/product-catalog.mjs",
  "assets/contracts/release-catalog.mjs",
  "assets/contracts/resource-mode.mjs",
  "assets/contracts/runtime-protocol.mjs",
];

const hostRuntimeModules = await localModuleClosure({
  root: project,
  entries: hostRuntimeRoots.filter(path => /\.(?:m?js)$/.test(path)),
  allowBareImports: true,
  allowDynamicImports: true,
  resolveFile: resolveHostBuildSource,
});
const hostRuntimeFiles = [...new Set([...hostRuntimeRoots, ...hostRuntimeModules])];

const mappedFiles = [
  ["config/eagler-touhou.config.example.json", "eagler-touhou.config.json"],
  ["host/bundle/package.json", "package.json"],
  ["host/bundle/package-lock.json", "package-lock.json"],
  ["docs/SELF_HOSTING.md", "SELF-HOSTING.md"],
  ["docs/SELF_HOSTING_REFERENCE.md", "SELF-HOSTING-REFERENCE.md"],
  ["docs/EXTERNAL_RESOURCE_MODE.md", "EXTERNAL_RESOURCE_MODE.md"],
];

function copyRule(source, target = source) {
  return Object.freeze({ source, target });
}

export const SELF_HOST_BUNDLE_COPY_RULES = Object.freeze([
  ...FRONTEND_PACKAGE_FILES
    .map(path => copyRule(relative(project, resolveFrontendPackageSource(path)).replaceAll("\\", "/"), path)),
  // Private operator build inputs, never members of FRONTEND_PACKAGE_FILES or
  // public deployment inventory. Both values keep their original build owners.
  ...REACT_FRONTEND_ARTIFACT?.artifactMetadataFiles.map(path => copyRule(
    relative(project, resolve(REACT_FRONTEND_ARTIFACT.root, path)).replaceAll("\\", "/"), path,
  )) ?? [],
  ...hostRuntimeFiles
    .filter(source => !FRONTEND_PACKAGE_FILES.includes(source))
    .sort()
    .map(source => copyRule(
      isMappedBrowserPublicationPath(source)
        ? relative(project, resolveHostBuildSource(source)).replaceAll("\\", "/")
        : source,
      source,
    )),
  ...mappedFiles.map(([source, target]) => copyRule(source, target)),
]);

export const SELF_HOST_BUNDLE_NODE_DEPENDENCIES = Object.freeze([
  "acorn",
  "fflate",
  "parse5",
  "workbox-build",
]);
