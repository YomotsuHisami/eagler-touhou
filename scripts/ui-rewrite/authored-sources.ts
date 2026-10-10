import {resolveAuthoredSource} from '../../lib/authored-source-resolution.mjs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
const root = fileURLToPath(new URL('../../', import.meta.url));
/** The unchanged NodeNext modules spell their emitted siblings .mjs. Resolve
 * authored sources without importing the Node build facades into the browser. */
export function authoredSources(): Plugin {
  return {
    name: 'launcher-authored-sources', enforce: 'pre',
    resolveId(source, importer) {
      return resolveAuthoredSource(root, source, importer);
    },
    generateBundle(_options, bundle) {
      if (this.environment.config.consumer !== 'client') return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          // Test carriers may import production components, never the reverse.
          // Keep the boundary repository-scoped: dependency packages can have
          // legitimate runtime modules in a directory named "tests".
          if (id.replaceAll('\\', '/').startsWith(`${root.replaceAll('\\', '/')}tests/`)) this.error('Test fixture entered the React browser graph');
          if (/(?:src\/launcher\/(?:app|lobby)\.mts|public\/app\.js)(?:$|\?)/.test(id.replaceAll('\\', '/'))) this.error('Legacy DOM/history owner entered the React graph');
          if (id.startsWith('node:') || id.includes('__vite-browser-external')) this.error('Node-only code entered the React browser graph');
        }
      }
    },
  };
}
