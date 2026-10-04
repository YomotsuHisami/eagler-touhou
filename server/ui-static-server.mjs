/** Portable HTTP publication server. No frontend build toolchain is needed. */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib';
import { createUiDeploymentContract, decodeUiDeploymentPath, uiNavigationFallback } from '../scripts/ui-deployment-contract.mjs';
import { staticContentCacheControl, staticContentCompressible, staticContentType } from './static-content-policy.mjs';

const PRIVATE_FILES = new Set(['/ui-ownership.json', '/ui-artifact.json']);
const PUBLICATION_SCHEMA = 'eagler-touhou/ui-publication/1';
const inside = (root, path) => path === root || path.startsWith(root + sep);
const tagFor = info => `"${createHash('sha1').update(`${info.size}:${info.mtimeMs}`).digest('base64url')}"`;

/** Resolve both the requested name and symlinks inside one explicit public root. */
export async function safeSiteFile(root, pathname) {
  const candidate = resolve(root, `.${pathname}`);
  if (!inside(root, candidate)) return null;
  try {
    let path = await realpath(candidate);
    if (!inside(root, path)) return null;
    let info = await stat(path);
    const directory = info.isDirectory();
    if (directory) {
      path = await realpath(resolve(path, 'index.html'));
      if (!inside(root, path)) return null;
      info = await stat(path);
    }
    return info.isFile() ? { path, info, directory } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

export function siteByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

async function publicationContract(root) {
  const file = await safeSiteFile(root, '/ui-publication.json');
  if (!file) {
    // An unreadable or escaping marker must not silently activate legacy mode.
    try { await lstat(resolve(root, 'ui-publication.json')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    throw new Error('UI publication marker must be a readable in-root file');
  }
  if (file.directory) throw new Error('UI publication marker must be a file');
  const marker = JSON.parse(await readFile(file.path, 'utf8'));
  if (marker.schema !== PUBLICATION_SCHEMA || !['react-main', 'experimental-opt-in'].includes(marker.status) ||
      marker.navigation?.schema !== 'eagler-touhou/ui-deployment/1') throw new Error('Invalid UI publication marker');
  const navigation = createUiDeploymentContract(marker.navigation);
  if (marker.mountPath !== navigation.mountPath) throw new Error('UI publication mount mismatch');
  return navigation;
}

function encodingFor(header, compressible) {
  if (!compressible) return '';
  const encodings = new Map(String(header || '').split(',').map(entry => {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => /^\s*q\s*=/.test(parameter));
    return [name.trim(), quality ? Number(quality.split('=')[1]) : 1];
  }));
  return (encodings.get('br') || 0) > 0 ? 'br' : (encodings.get('gzip') || 0) > 0 ? 'gzip' : '';
}

function endError(request, response, status, message) {
  const body = Buffer.from(message);
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function sendResource(request, response, resource, { legacyRetirementWorker = false } = {}) {
  if (resource.body != null) {
    const body = Buffer.from(resource.body);
    response.writeHead(200, { 'Content-Type': resource.contentType || 'application/octet-stream', 'Cache-Control': resource.cacheControl || 'no-store', 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }
  const { path, info } = resource;
  const tag = tagFor(info);
  const headers = {
    'Content-Type': staticContentType(path),
    'Cache-Control': legacyRetirementWorker ? 'no-store' : resource.cacheControl || staticContentCacheControl(path),
    ETag: tag, 'Last-Modified': info.mtime.toUTCString(), 'Accept-Ranges': 'bytes', Vary: 'Accept-Encoding',
    ...(legacyRetirementWorker ? { 'Service-Worker-Allowed': '/eagler-touhou/' } : {}),
  };
  if (String(request.headers['if-none-match'] || '').split(',').some(value => value.trim().replace(/^W\//, '') === tag || value.trim() === '*')) {
    response.writeHead(304, headers); response.end(); return;
  }
  const range = request.headers['if-range'] && request.headers['if-range'] !== tag ? null : siteByteRange(request.headers.range, info.size);
  if (range === false) {
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}`, 'Content-Length': 0 }); response.end(); return;
  }
  const encoding = encodingFor(request.headers['accept-encoding'], !range && staticContentCompressible(path, info.size));
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
  if (encoding) headers['Content-Encoding'] = encoding;
  else headers['Content-Length'] = range ? range.end - range.start + 1 : info.size;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(path, range || undefined);
  if (encoding === 'br') await pipeline(stream, createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }), response);
  else if (encoding === 'gzip') await pipeline(stream, createGzip({ level: 6 }), response);
  else await pipeline(stream, response);
}

/** A publication root is the artifact directory, even when mounted at /nested/.
 * `navigation` + `publication: false` allows source previews without publishing
 * a registration marker or worker. Custom resources remain within that mount.
 */
export async function createPublishedSiteServer({ root, navigation = null, publication = true, resolveResource = null, middleware = null, onError = null } = {}) {
  root = await realpath(resolve(root || '.'));
  if (!(await stat(root)).isDirectory()) throw new Error(`site root is not a directory: ${root}`);
  navigation = publication ? await publicationContract(root) : navigation;
  if (navigation) navigation = createUiDeploymentContract(navigation);
  const mountPath = navigation?.mountPath || '/';
  const prefix = mountPath === '/' ? '' : mountPath.slice(0, -1);
  const resourceFor = pathname => resolveResource ? resolveResource(pathname) : safeSiteFile(root, pathname);
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const raw = request.url || '/';
      let pathname = decodeUiDeploymentPath(raw);
      if (!pathname || /[?#\u0000-\u001f\u007f]/.test(pathname)) { endError(request, response, 400, 'Invalid path'); return; }
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
      const requestPath = pathname;
      // thcrap is a separate source-development API and owns its HTTP methods.
      if (middleware && await middleware(request, response, new URL(`http://site.invalid${raw}`))) return;
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD'); endError(request, response, 405, 'Method not allowed'); return;
      }
      let legacyRetirementWorker = false;
      if (prefix) {
        if (pathname === prefix) {
          if (!raw.split('?')[0].endsWith('/')) {
            response.writeHead(308, { Location: mountPath + query, 'Cache-Control': 'no-store' }); response.end(); return;
          }
          pathname = '/';
        } else if (pathname.startsWith(mountPath)) pathname = pathname.slice(prefix.length);
        else { endError(request, response, 404, 'Not found'); return; }
      } else if (pathname === '/eagler-touhou') {
        response.writeHead(302, { Location: '/' + query, 'Cache-Control': 'no-store' }); response.end(); return;
      } else if (pathname === '/eagler-touhou/app-shell-sw.js') {
        pathname = '/legacy-mount-retirement-sw.js'; legacyRetirementWorker = true;
      } else if (pathname.startsWith('/eagler-touhou/')) {
        pathname = pathname.slice('/eagler-touhou'.length);
      }
      if (PRIVATE_FILES.has(pathname) || (!publication && ['/ui-publication.json', '/app-shell-sw.js'].includes(pathname))) {
        endError(request, response, 404, 'Not found'); return;
      }
      let resource = await resourceFor(pathname);
      if (resource?.directory && !raw.split('?')[0].endsWith('/')) {
        response.writeHead(308, { Location: `${requestPath}/${query}`, 'Cache-Control': 'no-store' }); response.end(); return;
      }
      if (!resource && navigation && uiNavigationFallback({
        url: `http://site.invalid${prefix}${pathname}`, method: request.method, accept: request.headers.accept,
        destination: request.headers['sec-fetch-dest'],
      }, { contract: navigation, scopeUrl: `http://site.invalid${mountPath}` })) resource = await resourceFor('/index.html');
      if (!resource && pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' }); response.end(); return;
      }
      if (!resource) { endError(request, response, 404, 'Not found'); return; }
      await sendResource(request, response, resource, { legacyRetirementWorker });
    } catch (error) {
      onError?.(error, request);
      if (response.headersSent) response.destroy(error);
      else endError(request, response, 500, 'Could not read this resource');
    }
  });
  server.uiMountPath = mountPath;
  return server;
}
