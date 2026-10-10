import {STATIC_FRONTEND_PACKAGE_FILES as staticPackageFiles, STATIC_APP_SHELL_FILES as staticAppShellFiles} from "./frontend-static-manifest.mjs";
export {HOST_SITE_ARTWORK_FILES} from "./frontend-static-manifest.mjs";
export {hostArtworkFiles} from "./host-artwork.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserModuleClosure } from "./browser-module-graph.mjs";
import {frontendSelection, reactFrontendArtifactDirectory, readReactFrontendArtifact} from "./react-frontend-artifact.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const FRONTEND_SELECTION = frontendSelection();
// Opt-in consumes an explicitly built artifact. Missing React output never
// triggers the retired UI compiler or silently falls back to main.
export const REACT_FRONTEND_ARTIFACT = FRONTEND_SELECTION === "react"
  ? await readReactFrontendArtifact({directory: reactFrontendArtifactDirectory({project}), expectedMountPath: process.env.EAGLER_REACT_MOUNT_PATH})
  : null;
let resolveMainSource;
if (!REACT_FRONTEND_ARTIFACT) {
  const launcher = await import("./launcher-build.mjs");
  await launcher.ensureLauncherBuild();
  resolveMainSource = launcher.resolveBrowserPublicationSource;
}

// Browser entrypoints are the only JavaScript URLs owned manually. Their full
// static ESM dependency closure is derived from source, so adding a module
// cannot accidentally publish an online-only launcher or omit it from precache.
export const BROWSER_MODULE_ENTRYPOINTS = REACT_FRONTEND_ARTIFACT?.browserEntrypoints ?? Object.freeze(["app.js", "assets/launcher/lobby.mjs"]);
export const BROWSER_MODULE_FILES = REACT_FRONTEND_ARTIFACT?.browserModules ?? await browserModuleClosure({
  root: project,
  entries: BROWSER_MODULE_ENTRYPOINTS,
  resolveFile: resolveMainSource,
});

export const FRONTEND_PACKAGE_FILES = REACT_FRONTEND_ARTIFACT?.packageFiles ?? Object.freeze([...staticPackageFiles, ...BROWSER_MODULE_FILES]);
export const APP_SHELL_FILES = REACT_FRONTEND_ARTIFACT?.shellFiles ?? Object.freeze([...staticAppShellFiles, ...BROWSER_MODULE_FILES]);
export const PUBLIC_ASSET_FILES = Object.freeze(FRONTEND_PACKAGE_FILES.filter(path => path.startsWith("assets/")));

export function resolveFrontendPackageSource(path) {
  if (!FRONTEND_PACKAGE_FILES.includes(path)) throw new Error(`unknown frontend package file: ${path}`);
  return REACT_FRONTEND_ARTIFACT ? REACT_FRONTEND_ARTIFACT.resolveSource(path) : resolveMainSource(path);
}
