import {existsSync} from 'node:fs';
import path from 'node:path';

/** Resolve only existing authored siblings of NodeNext .mjs imports. Both
 * build adapters use this boundary instead of importing compiled Node facades.
 * The injectable path/existence functions also exercise Windows paths on CI. */
export function resolveAuthoredSource(project, source, importer, paths = path, exists = existsSync) {
  if (!importer || !/^\.\.?\//.test(source) || !source.endsWith('.mjs')) return;
  const root = paths.resolve(project);
  const absolute = paths.resolve(paths.dirname(importer.split('?')[0]), source);
  if (absolute.startsWith(paths.resolve(root, 'src') + paths.sep)) {
    const authored = absolute.slice(0, -4) + '.mts';
    if (exists(authored)) return authored;
  }
  for (const directory of ['', 'lib/contracts']) {
    const prefix = paths.resolve(root, directory) + paths.sep;
    if (!absolute.startsWith(prefix) || absolute.slice(prefix.length).includes(paths.sep)) continue;
    const authored = paths.resolve(root, 'src/contracts', absolute.slice(prefix.length, -4) + '.mts');
    if (exists(authored)) return authored;
  }
}

export function authoredSourcesPlugin(project) {
  return {name: 'main-authored-sources', setup(context) {
    context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const authored = resolveAuthoredSource(project, args.path, args.importer);
      if (authored) return {path: authored};
    });
  }};
}
