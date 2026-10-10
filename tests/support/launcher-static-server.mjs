import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {staticContentType} from '../../server/static-content-policy.mjs';
import {assertSafeDevelopmentServerScope} from '../../lib/development-server-scope.mjs';
import {prepareLauncherFixture} from './launcher-fixture.mjs';

const host = '127.0.0.1';
const project = fileURLToPath(new URL('../../', import.meta.url));

/** UI fixture only. Serve an explicit artifact tree without legacy/SPA fallback
 * or Service Worker generation. Optional canonical metadata staging happens in
 * a private root before listening. Full publication/offline tests retain their
 * own original assembly contract. */
export async function createLauncherStaticServer(directory) {
  const root = await realpath(resolve(directory));
  assertSafeDevelopmentServerScope({host, project, root});
  if (!(await stat(resolve(root, 'index.html'))).isFile()) throw new Error('Launcher fixture index.html must be a file');
  const inside = path => path === root || path.startsWith(root + sep);
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, {Allow: 'GET, HEAD'}); response.end(); return;
      }
      const url = new URL(request.url || '/', `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);
      let file = resolve(root, `.${pathname}`);
      if (!inside(file)) {response.writeHead(403); response.end(); return;}
      file = await realpath(file);
      if (!inside(file)) {response.writeHead(403); response.end(); return;}
      let info = await stat(file);
      if (info.isDirectory() && !url.pathname.endsWith('/')) {
        response.writeHead(308, {Location: `${url.pathname}/${url.search}`, 'Cache-Control': 'no-store'}); response.end(); return;
      }
      if (info.isDirectory()) {
        file = await realpath(resolve(file, 'index.html'));
        if (!inside(file)) {response.writeHead(403); response.end(); return;}
        info = await stat(file);
      }
      if (!info.isFile()) {response.writeHead(404); response.end('Not found'); return;}
      response.writeHead(200, {'Content-Type': staticContentType(file), 'Content-Length': info.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      if (request.method === 'HEAD') {response.end(); return;}
      await pipeline(createReadStream(file), response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error instanceof URIError ? 400 : 404,
        {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
      if (!response.writableEnded) response.end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]), directory = process.argv[3];
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !directory) throw new Error('usage: launcher-static-server.mjs PORT ARTIFACT_ROOT');
  const inputs = process.env.EAGLER_LAUNCHER_FIXTURE_INPUTS;
  const fixture = inputs ? await prepareLauncherFixture(directory, inputs) : null;
  try {
    const server = await createLauncherStaticServer(fixture?.root ?? directory);
    let stopping = false;
    const stop = () => {if (stopping) return; stopping = true; server.close(); server.closeAllConnections();};
    server.once('close', async () => {await fixture?.dispose(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);});
    server.once('error', async error => {await fixture?.dispose(); console.error(error.message); process.exitCode = 1;});
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    server.listen(port, host, () => console.log(`Launcher UI fixture: http://${host}:${port}/`));
  } catch (error) {await fixture?.dispose(); throw error;}
}
