/** Reproduce a freshly unpacked source tree, not an already-built checkout. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const project = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'eagler-preview-cold-start-'));
const checkout = join(scratch, 'source');
const omitted = new Set(['.git', '.cache', 'node_modules', 'dist', 'artifacts',
  'private-assets', 'games', 'runtime-release', 'dependencies']);
const gameIds = ['th06', 'th07', 'th08', 'th09', 'th10'];
let mock;
let fixtureHost;
let fixtureCatalog;
const requests = [];

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function runPreview(label, { npm = false, offline = true, upstream } = {}) {
  // Only remove generated files in this test-owned temporary checkout.
  await rm(join(checkout, '.cache'), { recursive: true, force: true });
  await assert.rejects(stat(join(checkout, '.cache/build/browser/assets/contracts/product-catalog.mjs')),
    error => error.code === 'ENOENT');
  await assert.rejects(stat(join(checkout, 'assets/contracts/product-catalog.mjs')),
    error => error.code === 'ENOENT');
  const port = await freePort();
  const args = npm
    ? ['run', offline ? 'preview:offline' : 'preview:local', '--', `--port=${port}`,
      ...(upstream ? [`--upstream=${upstream}`] : [])]
    : ['eagler-local-preview.mjs', '--offline=true', `--port=${port}`];
  const npmFile = process.env.npm_execpath;
  const command = npm ? (npmFile ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath;
  const childArgs = npm && npmFile ? [npmFile, ...args] : args;
  const child = spawn(command, childArgs, {
    cwd: checkout, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    shell: npm && !npmFile && process.platform === 'win32',
  });
  let logs = '';
  child.stdout.on('data', bytes => { logs += bytes; });
  child.stderr.on('data', bytes => { logs += bytes; });
  const exited = new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', error => { logs += error.message; resolve(); });
  });
  const stop = 'preview-test-stop';
  const terminate = signal => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        // Only the process tree started by this test, never other npm servers.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  try {
    const deadline = Date.now() + 60000;
    while (!logs.includes('打开：') && Date.now() < deadline) {
      assert.equal(child.exitCode, null, `${label}:\n${logs}`);
      await delay(100);
    }
    assert.ok(logs.includes('打开：'), `${label}: server failed to start:\n${logs}`);
    const base = `http://127.0.0.1:${port}/`;
    const checks = ['host-manifest.json', 'release-catalog.json', '', 'app.js', 'styles.css',
      'app-shell-sw.js', 'dev-lobby.html', 'dev-lobby.css', 'dev-lobby.mjs',
      'assets/contracts/product-catalog.mjs', 'assets/contracts/character-art.mjs'];
    for (const path of checks) {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, `${label}: GET /${path}`);
      if (path === 'host-manifest.json') {
        fixtureHost = await response.json();
        assert.deepEqual(Object.keys(fixtureHost.games), gameIds);
        assert.equal(fixtureHost.shared.netplayRelay, undefined);
        if (offline) assert.equal(fixtureHost.profile, 'local-ui-fixture');
      } else if (path === 'release-catalog.json') {
        fixtureCatalog = await response.json();
      } else {
        assert.ok((await response.arrayBuffer()).byteLength > 0, `${label}: empty /${path}`);
      }
    }
    assert.ok((await stat(join(checkout, '.cache/build/browser/assets/contracts/product-catalog.mjs'))).size > 0);
    await assert.rejects(stat(join(checkout, '.cache/launcher-build.lock')), error => error.code === 'ENOENT');
    console.log(`${label}: PASS (no prior compiled output; five games and ${checks.length} routes)`);
  } finally {
    terminate('SIGTERM');
    if (await Promise.race([exited.then(() => 'exited'), delay(3000, stop)]) === stop) {
      terminate('SIGKILL');
      await Promise.race([exited, delay(1000)]);
    }
  }
}

try {
  await cp(project, checkout, {
    recursive: true,
    filter: path => !omitted.has(relative(project, path).split(sep)[0]),
  });
  await symlink(resolve(project, 'node_modules'), join(checkout, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await runPreview('direct node --offline=true');
  await runPreview('npm run preview:offline', { npm: true });
  fixtureHost = { ...fixtureHost, profile: 'web-development' };
  mock = createServer((request, response) => {
    requests.push(request.url);
    const value = request.url === '/host-manifest.json' ? fixtureHost
      : request.url === '/release-catalog.json' ? fixtureCatalog : null;
    response.writeHead(value ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', resolve);
  });
  await runPreview('npm run preview:local (mock metadata only)', {
    npm: true, offline: false, upstream: `http://127.0.0.1:${mock.address().port}/`,
  });
  assert.deepEqual(requests, ['/host-manifest.json', '/release-catalog.json']);
  console.log('Cold-start regression: PASS. No real upstream, game resources, or private artwork used.');
} finally {
  if (mock) {
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
  }
  await rm(scratch, { recursive: true, force: true });
}
