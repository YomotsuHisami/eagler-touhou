#!/usr/bin/env node
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

const args = new Map(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  if (!arg.startsWith('--') || index < 0) throw new Error(`未知参数：${arg}`);
  return [arg.slice(2, index), arg.slice(index + 1)];
}));
for (const key of args.keys()) {
  if (!['project', 'port', 'upstream', 'offline'].includes(key)) throw new Error(`未知参数：--${key}`);
}
const project = resolve(args.get('project') || process.cwd());
const port = Number(args.get('port') || 8137);
if(args.has('offline') && !['true','false'].includes(args.get('offline')))throw Error('--offline 只能为 true/false');
const offline=args.get('offline')==='true';
const upstream = new URL(args.get('upstream') || 'https://touhou.vip/');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须为 1024–65535');
if (upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') {
  throw new Error('资源站地址必须是没有凭据的站点根地址');
}
if (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname))) {
  throw new Error('资源站必须使用 HTTPS（本机测试例外）');
}
const replyHeaders = [
  'content-type', 'content-length', 'content-encoding', 'cache-control', 'etag',
  'last-modified', 'accept-ranges', 'content-range', 'vary',
  'cross-origin-resource-policy', 'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
];
const forwardHeaders = ['range', 'if-range', 'if-none-match', 'if-modified-since'];

async function remote(url, { method = 'GET', headers = {}, signal, redirects = 0 } = {}) {
  if (redirects > 5) throw new Error('资源站重定向次数过多');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('资源站返回了不支持的重定向');
  }
  if (upstream.protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('拒绝 HTTPS 资源降级到 HTTP');
  }
  const response = await new Promise((accept, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, signal,
      headers: { 'accept-encoding': 'identity', 'user-agent': 'EaglerLocalPreview/1', ...headers },
    }, incoming => {
      clearTimeout(headerTimer);
      accept(incoming);
    });
    const headerTimer = setTimeout(() => request.destroy(new Error('连接资源站超时（20 秒）')), 20000);
    request.on('error', error => { clearTimeout(headerTimer); reject(error); });
    request.setTimeout(60000, () => request.destroy(new Error('资源传输超时（60 秒无数据）')));
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    const target = new URL(response.headers.location, url);
    response.destroy();
    return remote(target, { method, headers, signal, redirects: redirects + 1 });
  }
  return response;
}

async function remoteJson(path) {
  const response = await remote(new URL(path, upstream));
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error(`${path} 返回 HTTP ${response.statusCode}`);
  }
  if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
    response.destroy();
    throw new Error(`${path} 意外返回压缩配置，请保留错误信息`);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response) {
    length += chunk.length;
    if (length > 16 * 1024 * 1024) {
      response.destroy();
      throw new Error(`${path} 配置超过 16 MiB`);
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error(`${path} 不是有效 JSON（可能被网络登录页拦截）`); }
}

function localJson(response, method, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  response.end(method === 'HEAD' ? undefined : body);
}

async function start() {
  try { await stat(resolve(project, 'package.json')); }
  catch { throw new Error('请先 cd 到有 package.json 的 eagler-touhou 项目目录'); }
  const load = file => import(pathToFileURL(resolve(project, file)).href);
  const { FRONTEND_PACKAGE_FILES, hostArtworkFiles, resolveFrontendPackageSource } =
    await load('lib/frontend-manifest.mjs');
  const { PRODUCT_GAMES } = await load('lib/contracts/product-catalog.mjs');
  const { validateHostManifest } = await load('lib/contracts/host-manifest.mjs');
  const { validateReleaseCatalog } = await load('lib/contracts/release-catalog.mjs');
  const { buildAppShell } = await load('lib/app-shell-build.mjs');
  const { staticContentType } = await load('server/static-content-policy.mjs');
  const { privateFrontendAssetSource } = await load('lib/private-frontend-assets.mjs');
  const { localCharacterAssetSource } = await load('lib/local-character-art.mjs');

  console.log(`本地前端：${project}`);
  console.log(offline?'纯界面模式：不访问线上、不下载游戏、不能启动游戏。':`正在读取资源配置：${upstream.href}`);
  const fixture=offline?(await load('lib/local-preview-fixture.mjs')).localPreviewFixture():null;
  const rawHost = fixture?.host || await remoteJson('host-manifest.json');
  if (!rawHost.games || !rawHost.shared) throw new Error('线上 Host Manifest 缺少 games/shared');
  const games = Object.fromEntries(
    Object.entries(rawHost.games).filter(([id]) => Object.hasOwn(PRODUCT_GAMES, id))
  );
  if (!Object.keys(games).length) throw new Error('线上站点没有当前分支支持的游戏');
  const shared = { ...rawHost.shared, testBuild: true };
  delete shared.netplayRelay;
  delete shared.originMigration;
  const host = validateHostManifest({ ...rawHost, shared, games });

  const rawCatalog = fixture?.catalog || await remoteJson('release-catalog.json');
  if (!rawCatalog.games) throw new Error('线上 Release Catalog 缺少 games');
  const catalog = validateReleaseCatalog({
    ...rawCatalog,
    games: Object.fromEntries(
      Object.entries(rawCatalog.games).filter(([id]) => Object.hasOwn(games, id))
    ),
  });
  for (const [id, game] of Object.entries(games)) {
    if (game.package && catalog.games[id] && game.package.revision !== catalog.games[id].revision) {
      throw new Error(`${id} 的线上配置正在更新，过几秒重新运行此命令`);
    }
  }
  const metadata = new Map([
    ['host-manifest.json', host],
    ['release-catalog.json', catalog],
  ]);
  if (shared.runtimeManifest) {
    const { validateRuntimeManifest, runtimeGenerationEntry } =
      await load('lib/contracts/runtime-generations.mjs');
    const runtime = validateRuntimeManifest(await remoteJson(shared.runtimeManifest));
    const entries = new Set(runtime.groups.flatMap(group =>
      [group.current, ...group.previous].map(generation =>
        runtimeGenerationEntry(group.root, generation))
    ));
    for (const [id, game] of Object.entries(games)) {
      for (const field of ['runtime', 'multiplayerRuntime']) {
        if (!game[field]) continue;
        const path = new URL(game[field], upstream).pathname.slice(1);
        if (!entries.has(path)) throw new Error(`${id} 的 Runtime 清单与站点配置不一致，请稍后重试`);
      }
    }
    metadata.set(shared.runtimeManifest, runtime);
  }

  const localFiles = new Map(
    FRONTEND_PACKAGE_FILES.map(path => [path, resolveFrontendPackageSource(path)])
  );
  // Local-only pages are deliberately excluded from the production manifest.
  // Resolve their full ES-module closure too: the optimized Launcher bundle
  // does not publish the separate product-catalog/adapter contract modules.
  const { localModuleClosure } = await load('lib/browser-module-graph.mjs');
  const { resolveBrowserPublicationSource } = await load('lib/launcher-build.mjs');
  const previewModules = await localModuleClosure({
    root: project, entries: ['dev-lobby.mjs'],
    resolveFile: resolveBrowserPublicationSource,
  });
  for (const path of ['dev-lobby.html', 'dev-lobby.css', ...previewModules]) {
    localFiles.set(path, resolveBrowserPublicationSource(path));
  }
  const artwork = new Set(hostArtworkFiles(Object.keys(games)));
  const artRoot = resolve(
    process.env.EAGLER_TOUHOU_ARTWORK_DIR || resolve(project, '.cache/host-artwork')
  );
  const shell = await buildAppShell({
    quiet: true, globDirectory: project,
    additionalGlobPatterns: [], deferredPathPrefixes: ['runtime/'],
  });
  const remoteExact = new Set();
  const allowUrl = value => {
    if (typeof value !== 'string' || !value) return;
    const url = new URL(value, upstream);
    if (url.origin === upstream.origin) remoteExact.add(url.pathname.slice(1));
  };
  for (const entry of Object.values(catalog.games)) allowUrl(entry.descriptor);
  for (const game of Object.values(games)) {
    allowUrl(game.runtime);
    allowUrl(game.multiplayerRuntime);
    allowUrl(game.gameData?.source);
    for (const option of game.languageOptions || []) allowUrl(option.pack?.url);
  }
  allowUrl(shared.vanillaFont);
  allowUrl(shared.unicodeFont);
  const allowedRemote = path =>
    remoteExact.has(path) || artwork.has(path.replace(/^assets\//, '')) ||
    /^(?:runtime|games|shared|packages|thcrap)\//.test(path) ||
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.package\.json$/.test(path);

  const server = createServer(async (request, response) => {
    try {
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
        response.writeHead(403);
        response.end('Loopback host required');
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end('Read-only preview');
        return;
      }
      const raw = request.url || '/';
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
        response.writeHead(400);
        response.end('Invalid path');
        return;
      }
      const url = new URL(raw, `http://127.0.0.1:${port}`);
      const path = decodeURIComponent(url.pathname).slice(1) || 'index.html';
      if (path.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      if (metadata.has(path)) {
        localJson(response, request.method, metadata.get(path));
        return;
      }
      if (path === 'app-shell-sw.js') {
        const body = Buffer.isBuffer(shell.worker) ? shell.worker : Buffer.from(shell.worker);
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache', 'content-length': body.length,
        });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      }
      let file = localCharacterAssetSource(project, path) || localFiles.get(path);
      if (!file && path.startsWith('assets/') && artwork.has(path.slice(7))) {
        const candidate = resolve(artRoot, path.slice(7));
        try { if ((await stat(candidate)).isFile()) file = candidate; } catch {}
      }
      if (!file) {
        const privateFile = privateFrontendAssetSource(path);
        if (privateFile) {
          try { if ((await stat(privateFile)).isFile()) file = privateFile; } catch {}
        }
      }
      if (file) {
        const info = await stat(file);
        if (!info.isFile()) throw new Error('本地发布文件不是普通文件');
        response.writeHead(200, {
          'content-type': staticContentType(file),
          'content-length': info.size, 'cache-control': 'no-cache',
        });
        if (request.method === 'HEAD') response.end();
        else await pipeline(createReadStream(file), response);
        return;
      }
      if(offline && path.startsWith('assets/') && artwork.has(path.slice(7))){
        // Transparent original test placeholder; no third-party artwork or request.
        const placeholder='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#242320"/></svg>';
        response.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});
        response.end(request.method==='HEAD'?undefined:placeholder);return;
      }
      if(offline){response.writeHead(404,{'content-type':'text/plain; charset=utf-8'});response.end('UI preview only; game resources are not installed.');return;}
      if (!allowedRemote(path)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found in the local frontend');
        return;
      }
      const controller = new AbortController();
      response.on('close', () => {
        if (!response.writableFinished) controller.abort();
      });
      const headers = {};
      for (const name of forwardHeaders) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      const outgoing = await remote(new URL('/' + path + url.search, upstream), {
        method: request.method, headers, signal: controller.signal,
      });
      const copied = {};
      for (const name of replyHeaders) {
        if (outgoing.headers[name] !== undefined) copied[name] = outgoing.headers[name];
      }
      response.writeHead(outgoing.statusCode || 502, copied);
      if (request.method === 'HEAD') {
        outgoing.resume();
        response.end();
      } else {
        await pipeline(outgoing, response);
      }
    } catch (error) {
      if (response.destroyed) return;
      console.error(`${request.url}: ${error.message}`);
      if (!response.headersSent) {
        response.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
      }
      if (!response.writableEnded) response.end(`本地预览请求失败：${error.message}`);
    }
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用；停止旧进程或加 --port=8138`
      : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`已加载目录：${Object.keys(games).join(' / ')}`);
    console.log(`打开：http://127.0.0.1:${port}/`);
    console.log(offline?'纯界面预览：没有真实游戏资源。':'本地改版前端 + 线上资源；游戏大文件按需传输，没有批量镜像。');
    console.log('未连接正式联机 Relay。游戏兼容性仍需实际启动验证。');
    console.log('修改源码后 Ctrl+C 停止，再运行本命令。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
start().catch(error => {
  console.error(`\n启动失败：${error.message}`);
  console.error('没有修改前端源码。请保留此错误，不要通过关闭校验来绕过。');
  process.exitCode = 1;
});
