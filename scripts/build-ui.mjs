import { spawn } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import routes from '../app/routes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.cache/build/ui/client');

/** Derive navigation from the route owner rather than maintaining a second list. */
export function navigationPatterns(entries, prefix = '') {
  return [...new Set(entries.flatMap(entry => {
    const path = [prefix, entry.path].filter(Boolean).join('/').replaceAll(/\/{2,}/g, '/');
    return [
      ...(entry.index || entry.path ? [`/${path}`.replaceAll(/\/{2,}/g, '/')] : []),
      ...navigationPatterns(entry.children ?? [], path),
    ];
  }))].sort();
}

export async function verifyUiBuild(directory = output) {
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const ownership = JSON.parse(await readFile(resolve(directory, 'ui-ownership.json'), 'utf8'));
  if (ownership.schema !== 'eagler-touhou/ui-ownership/1' || ownership.legacyLauncherIncluded !== false || ownership.nodeBuiltinsIncluded !== false) {
    throw new Error('UI build ownership proof is missing or invalid');
  }
  if (/<script\b[^>]*\bsrc\s*=\s*["'](?:\/)?(?:app\.js|assets\/launcher\/app\.mjs)["']/i.test(html)) {
    throw new Error('The React entry must not execute the legacy launcher');
  }
  if (!Array.isArray(ownership.chunks) || !ownership.chunks.length) throw new Error('UI build has no application chunks');
  for (const chunk of ownership.chunks) {
    if (!/^assets\/[A-Za-z0-9_.-]+\.js$/.test(chunk)) throw new Error(`Invalid application chunk path: ${chunk}`);
    await readFile(resolve(directory, chunk));
  }
  return ownership;
}

export async function buildUi() {
  await new Promise((resolveBuild, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/@react-router/dev/bin.cjs'), 'build'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, npm_config_ignore_scripts: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveBuild() : reject(new Error(`React Router build exited ${code}`)));
  });
  // Public documents retain their styles, but cannot overwrite the SPA entry
  // or introduce the legacy launcher bootstrap. Source public/ is unchanged.
  const publicRoot = resolve(root, 'public');
  await cp(publicRoot, output, { recursive: true, filter: source =>
    !['index.html', 'en.html', 'lobby.html', 'app.js'].some(name => source === resolve(publicRoot, name)),
  });
  await verifyUiBuild();
  const navigation = { schema: 'eagler-touhou/ui-navigation/1', patterns: navigationPatterns(routes) };
  await writeFile(resolve(output, 'ui-navigation.json'), `${JSON.stringify(navigation, null, 2)}\n`);
  console.log(`UI SPA ownership verified; ${navigation.patterns.length} navigation patterns generated`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildUi();
