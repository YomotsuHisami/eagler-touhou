import {readFile, readdir, rename, rmdir} from 'node:fs/promises';
import {resolve} from 'node:path';

/** RR prerenders /en.html as en.html/index.html. Preserve the original static
 * .html addresses without requiring server-side rendering or broad rewrites. */
export async function finalizeOriginalEntrypoints(clientDirectory: string, mountPath = '/') {
  for (const filename of ['en.html', 'lobby.html']) {
    // Supported basename prerenders include the mount in their output path.
    // Flatten the file in the mount-local publication without changing HTML.
    const directory = resolve(clientDirectory, '.' + mountPath, filename), source = resolve(directory, 'index.html');
    const entries = await readdir(directory);
    if (entries.length !== 1 || entries[0] !== 'index.html') throw new Error(`Unexpected prerender contents for ${filename}`);
    const html = await readFile(source, 'utf8');
    if (!html.includes('window.__reactRouterContext =') || !html.includes('window.__reactRouterRouteModules =')) throw new Error(`Missing hydration scripts for ${filename}`);
    const temporary = resolve(clientDirectory, `${filename}.prerender-tmp`);
    await rename(source, temporary);
    await rmdir(directory); // Only the validated empty generated directory.
    await rename(temporary, resolve(clientDirectory, filename));
  }
}
