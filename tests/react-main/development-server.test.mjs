/** Original development-server HTTP assertions with canonical TH10 identity-only
 * metadata selection. No Runtime/DATA is supplied or executed; no browser claim. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {readReactFrontendArtifact} from '../../lib/react-frontend-artifact.mjs';
let work, artifact, environment;
before(async () => {
  await mkdir(resolve('.cache'), {recursive: true});
  work = await mkdtemp(resolve('.cache/react-development-server-'));
  const output = resolve(work, 'build');
  environment = {...process.env, EAGLER_FRONTEND: 'react', EAGLER_REACT_BUILD_DIRECTORY: output,
    EAGLER_REACT_MOUNT_PATH: '/', EAGLER_REACT_APP_SHELL: '', EAGLER_REACT_APP_SHELL_ORIGIN: '',
    EAGLER_DEVELOPMENT_GAMES: 'th10', EAGLER_TH10_CONTENT_DIR: '', EAGLER_TOUHOU_HOST: '127.0.0.1', EAGLER_ENABLE_THCRAP: '0'};
  execFileSync(process.execPath, ['node_modules/@react-router/dev/bin.cjs', 'build'], {env: environment, encoding: 'utf8', stdio: 'pipe', timeout: 120000});
  artifact = await readReactFrontendArtifact({directory: resolve(output, 'client')});
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

test('original development-server assertions pass with only project setup and generated module subject adapted', async () => {
  const original = await readFile('tests/test-server.mjs', 'utf8');
  const projectLine = 'const project = resolve(fileURLToPath(new URL("..", import.meta.url)));';
  const module = artifact.browserEntrypoints.find(path => path.startsWith('assets/') && !path.startsWith('assets/manifest-'));
  assert.ok(module);
  assert.equal(original.split(projectLine).length, 2);
  assert.equal(original.split('/assets/launcher/app.mjs').length, 2);
  const adapted = original.replace(projectLine, `const project = ${JSON.stringify(resolve('.'))};`)
    .replace('/assets/launcher/app.mjs', '/' + module);
  assert.equal(adapted.replace(`const project = ${JSON.stringify(resolve('.'))};`, projectLine)
    .replace('/' + module, '/assets/launcher/app.mjs'), original);
  const file = resolve(work, 'original-server.mjs'); await writeFile(file, adapted);
  execFileSync(process.execPath, [file], {env: environment, encoding: 'utf8', stdio: 'pipe', timeout: 60000});
});

async function port() {
  const probe = createServer(); await new Promise((yes, no) => {probe.once('error', no); probe.listen(0, '127.0.0.1', yes);});
  const selected = probe.address().port; await new Promise(yes => probe.close(yes)); return selected;
}
async function start({selected = null, env = environment} = {}) {
  selected ??= await port();
  const child = spawn(process.execPath, ['scripts/serve.mjs', String(selected)], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', b => {output += b;}); child.stderr.on('data', b => {output += b;});
  const stopped = new Promise(yes => child.once('exit', yes));
  const stop = async () => {if (child.exitCode !== null || child.signalCode !== null) return; child.kill(); await stopped;};
  try {
    await new Promise((yes, no) => {
      const timeout = setTimeout(() => finish(new Error('Server did not become ready: ' + output)), 30000);
      const onData = () => {if (output.includes(`eagler-touhou: http://127.0.0.1:${selected}/`)) finish();};
      const onExit = () => finish(new Error('Server exited before ready: ' + output));
      const finish = error => {clearTimeout(timeout); child.stdout.off('data', onData); child.off('exit', onExit); child.off('error', finish); error ? no(error) : yes();};
      child.stdout.on('data', onData); child.once('exit', onExit); child.once('error', finish);
    });
    return {base: `http://127.0.0.1:${selected}`, stop};
  } catch (error) {await stop(); throw error;}
}
test('selected React root serves real routes and rejects old UI/disabled worker/missing resource fallback', async () => {
  const server = await start();
  try {
    for (const path of ['/', '/en.html', '/lobby.html']) {
      const response = await fetch(server.base + path); assert.equal(response.status, 200);
      const html = await response.text(); assert.match(html, /__reactRouterContext/);
      assert.doesNotMatch(html, /<script[^>]+src=["'](?:\.\/)?app\.js/);
    }
    for (const path of ['/app-shell-sw.js', '/app.js', '/assets/launcher/app.mjs', '/public/index.html', '/public/app.js', '/missing.wasm', '/missing.js', '/missing.woff2']) {
      const response = await fetch(server.base + path); assert.equal(response.status, 404, path);
      assert.doesNotMatch(await response.text(), /__reactRouterContext/, path);
    }
    const host = await fetch(server.base + '/host-manifest.json'); assert.equal(host.status, 200);
    assert.match(host.headers.get('content-type'), /application\/json/);
    const module = artifact.browserEntrypoints.find(path => path.startsWith('assets/'));
    assert.equal((await fetch(server.base + '/' + module)).status, 200);
  } finally {await server.stop();}
});

test('explicit isolated root serves canonical worker only at its configured loopback origin', async () => {
  const selected = await port();
  const env = {...environment, EAGLER_REACT_BUILD_DIRECTORY: resolve(work, 'isolated'),
    EAGLER_REACT_APP_SHELL: 'isolated', EAGLER_REACT_APP_SHELL_ORIGIN: `http://127.0.0.1:${selected}`};
  execFileSync(process.execPath, ['node_modules/@react-router/dev/bin.cjs', 'build'], {env, encoding: 'utf8', stdio: 'pipe', timeout: 120000});
  const server = await start({selected, env});
  try {
    const response = await fetch(server.base + '/app-shell-sw.js'); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const body = await response.text();
    assert.match(body, /App Shell integrity mismatch/); assert.match(body, /createRuntimeCache/);
    const tag = response.headers.get('etag'); assert.ok(tag);
    assert.equal((await fetch(server.base + '/app-shell-sw.js', {headers: {'If-None-Match': tag}})).status, 304);
    const wrongPort = selected === 65535 ? selected - 1 : selected + 1;
    assert.throws(() => execFileSync(process.execPath, ['scripts/serve.mjs', String(wrongPort)],
      {env, encoding: 'utf8', stdio: 'pipe', timeout: 30000}), error => {
        assert.match(String(error.stderr), /React App Shell origin does not match this development server/); return true;
      });
  } finally {await server.stop();}
});
