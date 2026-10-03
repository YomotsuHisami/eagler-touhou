import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { staticContentType, staticContentCacheControl } from '../server/static-content-policy.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPrefixes = ['assets/', 'content/', 'runtime/', 'packages/', 'language-packs/'];
const metadataFiles = new Set(['host-manifest.json', 'release-catalog.json', 'runtime-manifest.json']);

export function decodeUiPath(rawPath) {
  try {
    const pathname = decodeURIComponent(rawPath.split('?')[0]);
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) return null;
    return pathname;
  } catch { return null; }
}

export function isUiNavigation(pathname, patterns) {
  if (!pathname) return false;
  if (patterns.includes(pathname.replace(/\/$/, '') || '/')) return true;
  if (pathname.includes('.')) return false;
  const segments = pathname.replace(/\/$/, '').split('/');
  return patterns.some(pattern => {
    const expected = pattern.replace(/\/$/, '').split('/');
    return segments.length === expected.length && expected.every((part, index) =>
      part.startsWith(':') ? /^[A-Za-z0-9_-]+$/.test(segments[index]) : part === segments[index]);
  });
}

export function uiCacheControl(pathname, immutableAssets = new Set()) {
  return immutableAssets.has(pathname.replace(/^\//, ''))
    ? 'public, max-age=31536000, immutable'
    : staticContentCacheControl(pathname);
}

export function uiByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function safeFile(root, logicalPath) {
  const candidate = resolve(root, `.${logicalPath}`);
  if (!candidate.startsWith(root + sep)) return null;
  try {
    const actual = await realpath(candidate);
    // A public symlink must not expose files outside its explicitly mounted root.
    if (!actual.startsWith(root + sep)) return null;
    const info = await stat(actual);
    return info.isFile() ? { path: actual, info } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

/** Loopback-only preview, without SW installation or production publisher changes. */
export async function createUiServer({ root = resolve(project, '.cache/build/ui/client'), publicRoot = resolve(project, 'public'), assetsRoot = null } = {}) {
  root = await realpath(root);
  publicRoot = publicRoot ? await realpath(publicRoot) : null;
  assetsRoot = assetsRoot ? await realpath(assetsRoot) : null;
  const ownership = JSON.parse(await readFile(resolve(root, 'ui-ownership.json'), 'utf8'));
  const immutableAssets = new Set(ownership.assets ?? ownership.chunks ?? []);
  const navigation = JSON.parse(await readFile(resolve(root, 'ui-navigation.json'), 'utf8'));
  if (navigation.schema !== 'eagler-touhou/ui-navigation/1' || !Array.isArray(navigation.patterns)) throw new Error('Run npm run build:ui before preview');
  return createServer(async (request, response) => {
    try {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
      }
      const pathname = decodeUiPath(request.url ?? '/');
      if (!pathname) { response.writeHead(400); response.end('Invalid path'); return; }
      // Private build metadata is not a web resource.
      if (pathname === '/ui-ownership.json') { response.writeHead(404); response.end(); return; }
      let file = await safeFile(root, pathname);
      const alias = pathname.endsWith('.html') && isUiNavigation(pathname, navigation.patterns);
      if (!file && publicRoot && !alias) file = await safeFile(publicRoot, pathname);
      const mountedArtifact = metadataFiles.has(pathname.slice(1)) || artifactPrefixes.some(prefix => pathname.startsWith(`/${prefix}`));
      if (!file && assetsRoot && mountedArtifact) file = await safeFile(assetsRoot, pathname);
      if (!file && /(?:^|,)\s*text\/html(?:\s*;|\s*,|\s*$)/i.test(request.headers.accept ?? '') && isUiNavigation(pathname, navigation.patterns)) {
        file = await safeFile(root, '/index.html');
      }
      if (!file) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('Not found'); return; }
      const etag = `"${file.info.size.toString(16)}-${Math.trunc(file.info.mtimeMs).toString(16)}"`;
      const headers = {
        'Content-Type': staticContentType(file.path),
        'Cache-Control': uiCacheControl(pathname, immutableAssets),
        ETag: etag,
        'Accept-Ranges': 'bytes',
      };
      if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
      const range = request.headers['if-range'] && request.headers['if-range'] !== etag ? null : uiByteRange(request.headers.range, file.info.size);
      if (range === false) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.info.size}` }); response.end(); return; }
      const contentLength = range ? range.end - range.start + 1 : file.info.size;
      response.writeHead(range ? 206 : 200, {
        ...headers, 'Content-Length': contentLength,
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${file.info.size}` } : {}),
      });
      if (request.method === 'HEAD') { response.end(); return; }
      await pipeline(createReadStream(file.path, range || undefined), response);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else { response.writeHead(500, { 'Cache-Control': 'no-store' }); response.end('Preview could not read this resource'); }
    }
  });
}

export function parseUiArguments(values) {
  const allowed = new Set(['port', 'root', 'assets-root']);
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const token = values[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equal = token.indexOf('=');
    const key = token.slice(2, equal < 0 ? undefined : equal);
    if (!allowed.has(key)) throw new Error(`Unknown preview option: ${key}`);
    const value = equal < 0 ? values[++index] : token.slice(equal + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    result[key] = value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseUiArguments(process.argv.slice(2));
  const port = Number(args.port ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
  const server = await createUiServer({
    ...(args.root ? { root: resolve(args.root) } : {}),
    ...(args['assets-root'] ? { assetsRoot: resolve(args['assets-root']) } : {}),
  });
  server.listen(port, '127.0.0.1', () => console.log(`UI preview: http://127.0.0.1:${port}/`));
}
