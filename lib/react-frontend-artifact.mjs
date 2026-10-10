import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { STATIC_FRONTEND_PACKAGE_FILES, STATIC_APP_SHELL_FILES } from "./frontend-static-manifest.mjs";
import { REACT_APP_SHELL_META, normalizeReactMountPath, validateReactAppShellDeployment } from "./react-app-shell-deployment.mjs";

export const REACT_ARTIFACT_METADATA_FILES = Object.freeze([".vite/manifest.json", ".vite/react-app-shell-graph.json"]);
const compatibilityEntries = STATIC_FRONTEND_PACKAGE_FILES.filter(path => path.startsWith("legacy/"));
const retiredEntryStyles = new Set(["lobby.css", "touch-guide.css"]);

export function frontendSelection(environment = process.env) {
  const selection = environment.EAGLER_FRONTEND;
  if (selection === undefined || selection === "main") return "main";
  if (selection === "react") return "react";
  throw new Error("EAGLER_FRONTEND must be main or react (unset selects main)");
}

// Match main's source/prebuilt boundary: a packaged operator distribution has
// no maintainer .mts sources, although it retains classic worker build inputs.
function hasTypeScriptSource(directory) {
  return existsSync(directory) && readdirSync(directory, {withFileTypes: true}).some(entry =>
    entry.isDirectory() ? hasTypeScriptSource(resolve(directory, entry.name)) : entry.isFile() && entry.name.endsWith(".mts"));
}

export function reactFrontendArtifactDirectory({project, environment = process.env}) {
  if (environment.EAGLER_REACT_BUILD_DIRECTORY) return resolve(project, environment.EAGLER_REACT_BUILD_DIRECTORY, "client");
  return hasTypeScriptSource(resolve(project, "src")) ? resolve(project, ".cache/build/ui-rewrite/client") : resolve(project);
}

function artifactPath(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.\/-]+$/.test(value) || value.startsWith("/") || value.split("/").some(part => !part || part.startsWith("."))) {
    throw new Error(`Invalid React publication path: ${value}`);
  }
  return value;
}

function generatedPath(value) {
  const path = artifactPath(value);
  if (!path.startsWith("assets/") || /^assets\/(?:launcher|contracts)\//.test(path)) throw new Error(`Forbidden React generated file: ${path}`);
  return path;
}

function freeze(value) {
  if (value && typeof value === "object") {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
}

// Match the existing build's HTML parser; comments and script text cannot
// masquerade as entrypoints or App Shell configuration.
function documentTags(html, parse) {
  const result = [];
  function visit(node) {
    if (["script", "link", "meta"].includes(node.tagName)) result.push({tag: node.tagName, attributes: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]))});
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return result;
}

/** Consume a maintainer-built artifact without importing TypeScript, invoking
 * a compiler, or initializing main's legacy UI. Deployment inventories may
 * embed the same private build metadata instead of publishing .vite files.
 * @param {{directory: string, metadata?: {manifest: Record<string, any>, graph: any} | null, expectedMountPath?: string}} options
 */
export async function readReactFrontendArtifact({directory, metadata = null, expectedMountPath = undefined}) {
  // Operator entrypoints may inspect selection before npm ci. Keep parser
  // dependencies behind the actual prebuilt-artifact read, after setup.
  const [{parse}, {browserModuleClosure}] = await Promise.all([import("parse5"), import("./browser-module-graph.mjs")]);
  const root = resolve(directory);
  let realRoot;
  try {realRoot = realpathSync(root);} catch (error) {
    throw new Error(`React frontend artifact is missing at ${root}; run npm run build:ui-rewrite in the source checkout or supply a complete prebuilt distribution`, {cause: error});
  }
  const resolveFile = path => {
    const absolute = resolve(root, path), real = realpathSync(absolute);
    if (!real.startsWith(realRoot + sep)) throw new Error(`React publication file escapes artifact root: ${path}`);
    const info = statSync(real);
    if (!info.isFile() || !info.size) throw new Error(`React publication input is empty or not a file: ${path}`);
    return absolute;
  };
  let supplied;
  try {
    supplied = metadata ?? {
      manifest: JSON.parse(await readFile(resolveFile(REACT_ARTIFACT_METADATA_FILES[0]), "utf8")),
      graph: JSON.parse(await readFile(resolveFile(REACT_ARTIFACT_METADATA_FILES[1]), "utf8")),
    };
  } catch (error) {
    throw new Error(`React frontend artifact metadata is missing or invalid at ${root}; run npm run build:ui-rewrite or supply a complete prebuilt distribution`, {cause: error});
  }
  const {manifest, graph} = supplied;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !graph || graph.schema !== "eagler-touhou/react-app-shell-graph/1" || !Array.isArray(graph.shellFiles) || !Object.hasOwn(graph, "appShell")) throw new Error("Invalid React frontend artifact metadata");
  const mountPath = normalizeReactMountPath(graph.mountPath);
  if (expectedMountPath !== undefined && normalizeReactMountPath(expectedMountPath) !== mountPath) throw new Error("React frontend artifact does not match the selected mount");
  const appShell = graph.appShell === null ? null : validateReactAppShellDeployment(graph.appShell);
  if (appShell && appShell.mountPath !== mountPath) throw new Error("React frontend App Shell does not match the artifact mount");
  const generated = new Set(), entrypoints = new Set();
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid Vite browser manifest entry");
    generated.add(generatedPath(entry.file));
    if (entry.isEntry === true) {
      if (!/\.m?js$/.test(entry.file)) throw new Error("Vite browser entrypoint is not JavaScript");
      entrypoints.add(entry.file);
    }
    for (const key of ["imports", "dynamicImports", "css", "assets"]) {
      if (entry[key] !== undefined && (!Array.isArray(entry[key]) || entry[key].some(value => typeof value !== "string"))) throw new Error(`Invalid Vite manifest ${key}`);
    }
    for (const key of [...entry.imports ?? [], ...entry.dynamicImports ?? []]) if (!Object.hasOwn(manifest, key)) throw new Error(`Missing Vite module dependency: ${key}`);
    for (const path of [...entry.css ?? [], ...entry.assets ?? []]) generated.add(generatedPath(path));
  }
  if (!entrypoints.size) throw new Error("React artifact has no Vite browser entrypoints");
  for (const path of ["index.html", "en.html", "lobby.html"]) {
    const tags = documentTags(await readFile(resolveFile(path), "utf8"), parse);
    const declarations = tags.filter(node => node.tag === "meta" && node.attributes.name === REACT_APP_SHELL_META);
    if (declarations.length !== (appShell ? 1 : 0)) throw new Error(`React App Shell metadata mismatch: ${path}`);
    if (appShell && JSON.stringify(validateReactAppShellDeployment(JSON.parse(declarations[0].attributes.content))) !== JSON.stringify(appShell)) throw new Error(`React App Shell metadata mismatch: ${path}`);
    let referencedEntry = false;
    for (const {tag, attributes} of tags) {
      const url = tag === "script" ? attributes.src : tag === "link" ? attributes.href : null;
      if (!url || !url.includes("/assets/")) continue;
      if (!url.startsWith(mountPath + "assets/")) throw new Error(`React document asset escapes its graph/mount: ${url}`);
      const relative = url.slice(mountPath.length);
      if (/^assets\/manifest-[a-f0-9]+\.js$/.test(relative)) {generated.add(relative); entrypoints.add(relative);}
      if (!generated.has(relative)) throw new Error(`React document asset is absent from Vite graph: ${url}`);
      if (entrypoints.has(relative)) referencedEntry = true;
    }
    if (!referencedEntry) throw new Error(`React document has no browser entrypoint: ${path}`);
  }
  const shellFiles = [...new Set([...STATIC_APP_SHELL_FILES.filter(path => !retiredEntryStyles.has(path)), ...generated])].sort();
  if (graph.shellFiles.length !== shellFiles.length || [...graph.shellFiles].sort().some((path, index) => path !== shellFiles[index])) throw new Error("React App Shell graph differs from its canonical static/Vite publication ownership");
  // Vite owns dynamic-expression imports used by React Router; every concrete
  // emitted module import must still stay inside that declared output graph.
  const generatedModules = await browserModuleClosure({root, entries: [...generated].filter(path => /\.m?js$/.test(path)), resolveFile, allowDynamicImports: true});
  if (generatedModules.some(path => !generated.has(path))) throw new Error("React browser module import is absent from the Vite publication graph");
  const compatibility = await browserModuleClosure({root, entries: compatibilityEntries, resolveFile});
  if (compatibility.some(path => !path.startsWith("legacy/"))) throw new Error("React compatibility module escapes its bounded legacy publication");
  const packageFiles = [...new Set([...STATIC_FRONTEND_PACKAGE_FILES, ...generated, ...compatibility])].sort();
  for (const path of packageFiles) resolveFile(artifactPath(path));
  const browserModules = [...new Set([...generatedModules, ...compatibility])].sort();
  const owned = new Set(packageFiles);
  return Object.freeze({kind: "react", root, mountPath, appShell,
    metadata: freeze(structuredClone({manifest, graph})), artifactMetadataFiles: REACT_ARTIFACT_METADATA_FILES,
    packageFiles: Object.freeze(packageFiles), shellFiles: Object.freeze(shellFiles),
    browserEntrypoints: Object.freeze([...entrypoints, ...compatibilityEntries].sort()), browserModules: Object.freeze(browserModules),
    resolveSource(path) {
      if (!owned.has(path)) throw new Error(`unknown React frontend package file: ${path}`);
      return resolveFile(path);
    },
  });
}
