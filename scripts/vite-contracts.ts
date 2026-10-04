import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

const nodeBuiltins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const root = fileURLToPath(new URL('../', import.meta.url));
const browserContracts = new Map([
  'product-catalog', 'release-catalog', 'runtime-protocol', 'host-manifest', 'resource-mode',
].flatMap(name => [
  [resolve(root, `${name}.mjs`), resolve(root, `src/contracts/${name}.mts`)],
  [resolve(root, `lib/contracts/${name}.mjs`), resolve(root, `src/contracts/${name}.mts`)],
]));

/** Resolve shared authored contracts without evaluating their Node build facades. */
export function browserContractSources(): Plugin {
  return {
    name: 'eagler-browser-contract-sources',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      if (this.environment.config.consumer !== 'client') return;
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
      const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
      if (modules.some(id => /(?:src\/launcher\/(?:app|lobby)\.mts|public\/app\.js)(?:$|\?)/.test(id))) {
        this.error('The React browser graph must not include the legacy launcher DOM owner');
      }
      if (modules.some(id => id.startsWith('node:') || id.includes('__vite-browser-external'))) {
        this.error('The React browser graph includes a Node-only module');
      }
      this.emitFile({ type: 'asset', fileName: 'ui-ownership.json', source: JSON.stringify({
        schema: 'eagler-touhou/ui-ownership/1', legacyLauncherIncluded: false, nodeBuiltinsIncluded: false,
        chunks: chunks.map(chunk => chunk.fileName).sort(),
        chunkMetrics: chunks.map(chunk => ({file: chunk.fileName, bytes: new TextEncoder().encode(chunk.code).byteLength,
          entry: chunk.isEntry, dynamicEntry: chunk.isDynamicEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports,
          modules: Object.keys(chunk.modules).filter(id => id.startsWith(root) && !id.includes('/node_modules/')).map(id => id.slice(root.length)).sort(),
        })).sort((a,b) => a.file.localeCompare(b.file)),
        assets: Object.values(bundle).map(item => item.fileName).filter(name => name.startsWith('assets/')).sort(),
      }, null, 2) });
    },
    resolveId(source, importer, options) {
      if (importer && !options.ssr && nodeBuiltins.has(source)) {
        this.error(`Node-only import ${source} cannot enter the browser graph (${importer})`);
      }
      if (!importer || !source.startsWith('.')) return;
      const absolute = resolve(dirname(importer.split('?')[0]), source);
      const contract = browserContracts.get(absolute);
      if (contract) return contract;
      // NodeNext-authored .mts owners deliberately name emitted .mjs siblings.
      if (absolute.startsWith(resolve(root, 'src') + '/') && absolute.endsWith('.mjs')) {
        const authored = absolute.slice(0, -4) + '.mts';
        if (existsSync(authored)) return authored;
      }
    },
  };
}
