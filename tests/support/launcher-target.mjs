import {readdir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Only select the served artifacts. Test scenarios and metadata fixtures remain
 * owned by the original test. Never fall back to legacy files for missing paths. */
export async function launcherTestFiles(originalFiles, {
  project = fileURLToPath(new URL('../../', import.meta.url)),
  target = process.env.EAGLER_LAUNCHER_TEST_ROOT,
} = {}) {
  if (!target) return originalFiles;
  const root = resolve(project, target);
  if (!(await stat(resolve(root, 'index.html'))).isFile()) throw new Error('Launcher target index.html must be a file');
  const files = new Map();
  async function visit(directory, prefix = '') {
    for (const item of await readdir(directory, {withFileTypes: true})) {
      const name = prefix + item.name, path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path, name + '/');
      else if (item.isFile()) files.set('/' + name, path);
    }
  }
  await visit(root);
  return files;
}
