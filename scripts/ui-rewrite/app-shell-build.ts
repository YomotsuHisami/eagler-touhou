import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse, type DefaultTreeAdapterMap} from 'parse5';
import {buildAppShell} from '../../lib/app-shell-build.mjs';
import {STATIC_APP_SHELL_FILES, HOST_SITE_ARTWORK_FILES} from '../../lib/frontend-static-manifest.mjs';
import {buildRuntimeGenerationWorkerSource} from '../../lib/launcher-optimization.mjs';
import * as runtimeContract from '../../src/contracts/runtime-generations.mts';
import {writeFileAtomic} from '../../lib/atomic-file.mjs';
import {normalizeReactMountPath, REACT_APP_SHELL_META, validateReactAppShellDeployment, type ReactAppShellDeployment} from '../../app/services/app-shell-deployment.ts';
import {readReactFrontendArtifact} from '../../lib/react-frontend-artifact.mjs';

interface ReactShellGraph {schema: string; mountPath: string; appShell: ReactAppShellDeployment | null; shellFiles: string[]}
interface BuildOptions {
  clientDirectory: string;
  mountPath: string;
  appShell: ReactAppShellDeployment | null;
  /** Synthetic runtime selector modules, or explicit Host-owned shell assets. */
  additionalShellFiles?: string[];
}

/** Called only after the supported React Router build has finished. Vite's
 * manifest owns the emitted chunk, asset and dynamic-import dependency graph. */
export async function writeReactAppShellGraph({clientDirectory, mountPath, appShell = null}: {clientDirectory: string; mountPath: string; appShell?: ReactAppShellDeployment | null}) {
  normalizeReactMountPath(mountPath);
  const manifest = JSON.parse(await readFile(resolve(clientDirectory, '.vite/manifest.json'), 'utf8')) as Record<string, {file: string; css?: string[]; assets?: string[]; imports?: string[]; dynamicImports?: string[]}>;
  const generatedFiles: string[] = [];
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry.file !== 'string') throw new Error('Invalid Vite browser manifest');
    for (const key of [...entry.imports ?? [], ...entry.dynamicImports ?? []]) if (!manifest[key]) throw new Error(`Missing Vite module dependency: ${key}`);
    generatedFiles.push(entry.file, ...entry.css ?? [], ...entry.assets ?? []);
  }
  // Keep the original static policy and substitute only the actual React
  // module/CSS graph for the old entrypoint graph. No legacy app.js is copied.
  const retiredEntryStyles = new Set(['lobby.css', 'touch-guide.css']);
  const staticFiles = STATIC_APP_SHELL_FILES.filter(path => !retiredEntryStyles.has(path));
  const graph: ReactShellGraph = {schema: 'eagler-touhou/react-app-shell-graph/1', mountPath, appShell,
    shellFiles: [...new Set([...staticFiles, ...generatedFiles])].sort()};
  await writeFileAtomic(resolve(clientDirectory, '.vite/react-app-shell-graph.json'), JSON.stringify(graph, null, 2) + '\n');
  return graph;
}

function elements(html: string) {
  const result: DefaultTreeAdapterMap['element'][] = [];
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) result.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(html)); return result;
}

/** Compile the existing production worker against this entry's actual graph.
 * This creates files only. It never registers, activates, serves, or deploys. */
export async function buildReactAppShell({clientDirectory, mountPath, appShell, additionalShellFiles = []}: BuildOptions) {
  normalizeReactMountPath(mountPath);
  const graph: ReactShellGraph = JSON.parse(await readFile(resolve(clientDirectory, '.vite/react-app-shell-graph.json'), 'utf8'));
  if (graph.schema !== 'eagler-touhou/react-app-shell-graph/1' || graph.mountPath !== mountPath || !Array.isArray(graph.shellFiles)) throw new Error('React App Shell graph does not match this mount');
  if (JSON.stringify(graph.appShell) !== JSON.stringify(appShell)) throw new Error('React App Shell graph does not match its deployment configuration');
  if (appShell && validateReactAppShellDeployment(appShell).mountPath !== mountPath) throw new Error('React App Shell configuration does not match this mount');
  const shellFiles = [...new Set([...graph.shellFiles, ...additionalShellFiles])].sort();
  const hasModule = shellFiles.some(path => /^assets\/.+\.js$/.test(path));
  if (!hasModule || ['index.html', 'en.html', 'lobby.html', 'about.html', 'faq.html', 'styles.css'].some(path => !shellFiles.includes(path))) throw new Error('Incomplete React App Shell graph');
  for (const path of shellFiles) {
    if (!/^[A-Za-z0-9_.\/-]+$/.test(path) || path.split('/').some(part => !part || part.startsWith('.')) || path.startsWith('/') ||
      /^(?:runtime\/|legacy\/|docs\/|src\/|app\/|tests\/|tools\/|package\/|assets\/(?:launcher|contracts)\/)/.test(path) ||
      ['app.js', 'migrate.html', 'legacy-mount-retirement-sw.js', 'app-shell-sw.js', 'runtime-manifest.json'].includes(path)) throw new Error(`Forbidden React App Shell file: ${path}`);
    const info = await stat(resolve(clientDirectory, path));
    if (!info.isFile() || info.size === 0) throw new Error(`React App Shell input is empty or missing: ${path}`);
  }
  for (const file of ['index.html', 'en.html', 'lobby.html']) {
    const nodes = elements(await readFile(resolve(clientDirectory, file), 'utf8'));
    const metadata = nodes.filter(node => node.tagName === 'meta' && node.attrs.some(attr => attr.name === 'name' && attr.value === REACT_APP_SHELL_META));
    if (metadata.length !== (appShell ? 1 : 0) || appShell && metadata[0].attrs.find(attr => attr.name === 'content')?.value !== JSON.stringify(appShell)) throw new Error(`React App Shell metadata mismatch: ${file}`);
    for (const node of nodes) {
      const url = node.attrs.find(attr => (node.tagName === 'script' && attr.name === 'src') || (node.tagName === 'link' && attr.name === 'href'))?.value;
      if (!url || !url.includes('/assets/')) continue;
      // React Router writes its generated route manifest after Vite's client
      // writeBundle hook. Its exact document reference is a build-owned input,
      // not a glob that could accidentally admit unrelated files.
      const relative = url.startsWith(mountPath) ? url.slice(mountPath.length) : '';
      if (/^assets\/manifest-[a-f0-9]+\.js$/.test(relative) && !shellFiles.includes(relative)) {
        const info = await stat(resolve(clientDirectory, relative));
        if (!info.isFile() || !info.size) throw new Error('Missing React Router route manifest');
        shellFiles.push(relative);
      }
      if (!url.startsWith(mountPath + 'assets/') || !shellFiles.includes(url.slice(mountPath.length))) throw new Error(`React document asset escapes its graph/mount: ${url}`);
    }
  }
  await writeFileAtomic(resolve(clientDirectory, '.vite/react-app-shell-graph.json'), JSON.stringify({...graph, shellFiles: shellFiles.slice().sort()}, null, 2) + '\n');
  await readReactFrontendArtifact({directory: clientDirectory, expectedMountPath: mountPath});
  if (!appShell) return null;
  // Host artwork is supplied by an authorized assembly or synthetic fixture.
  // Hash present icons too; never manufacture or borrow production artwork.
  for (const file of HOST_SITE_ARTWORK_FILES) {
    const path = `assets/${file}`;
    try {if ((await stat(resolve(clientDirectory, path))).isFile() && !shellFiles.includes(path)) shellFiles.push(path);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  }
  const result = await buildAppShell({quiet: true, globDirectory: clientDirectory,
    swDest: resolve(clientDirectory, 'app-shell-sw.js'), shellFiles, runtimeContract,
    workerContractSource: await buildRuntimeGenerationWorkerSource({project: fileURLToPath(new URL('../../', import.meta.url))})});
  if (result.warnings.length) throw new Error(result.warnings.join('\n'));
  await writeFileAtomic(resolve(clientDirectory, '.vite/react-app-shell-contract.json'), JSON.stringify(result.contract, null, 2) + '\n');
  return result;
}
