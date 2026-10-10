/** Server setup/HTTP only. No original browser/native scenario is executed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {webkitPublicationServerArguments} from './webkit-publication-server.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const wrapper = 'tests/browser/test-playwright-webkit-gate.mjs';
function restore(source) {
  return source.replace('import { webkitPublicationServerArguments } from "../support/webkit-publication-server.mjs";\n', '')
    .replace('webkitPublicationServerArguments(output, port)', '["scripts/serve.mjs", String(port), output]');
}

const deploymentMarker = {format: 'eagler-touhou-deployment/1', frontend: {kind: 'react', mountPath: '/'}, appShell: null};
async function markerRoot(action) {
  const root = await mkdtemp(resolve(tmpdir(), 'webkit-selector-contract-'));
  try {await writeFile(resolve(root, 'deployment.json'), JSON.stringify(deploymentMarker)); await action(root);}
  finally {await rm(root, {recursive: true, force: true});}
}

test('main command is exact; React selects the exact supplied packaged root and keeps explicit loopback confinement', async () => markerRoot(async root => {
  for (const environment of [{}, {EAGLER_FRONTEND: 'main'}]) assert.deepEqual(webkitPublicationServerArguments(root, 23456, environment), ['scripts/serve.mjs', '23456', root]);
  for (const host of [undefined, '127.0.0.1', 'localhost', '::1']) assert.deepEqual(webkitPublicationServerArguments(root, 23456,
    {EAGLER_FRONTEND: 'react', ...(host ? {EAGLER_TOUHOU_HOST: host} : {})}), ['scripts/serve-static.mjs', root, '23456']);
  for (const host of ['0.0.0.0', '::', 'example.com']) assert.throws(() => webkitPublicationServerArguments(root, 23456,
    {EAGLER_FRONTEND: 'react', EAGLER_TOUHOU_HOST: host}), /non-loopback/);
  assert.throws(() => webkitPublicationServerArguments(project, 23456, {EAGLER_FRONTEND: 'react'}), /not the source project/);
  assert.throws(() => webkitPublicationServerArguments(root, 23456, {EAGLER_FRONTEND: 'unknown'}), /must be main or react/);
}));

test('incompatible dynamic services fail closed only in selected React mode; fixture metadata settings cannot select a synthesis server', async () => markerRoot(async root => {
  for (const extra of [{EAGLER_ENABLE_THCRAP: '1'}, {EAGLER_TOUHOU_ARTWORK_DIR: '/external/artwork'}]) {
    assert.throws(() => webkitPublicationServerArguments(root, 23456, {EAGLER_FRONTEND: 'react', ...extra}), /dynamic thcrap\/artwork overrides/);
    assert.deepEqual(webkitPublicationServerArguments(root, 23456, extra), ['scripts/serve.mjs', '23456', root]);
  }
  assert.deepEqual(webkitPublicationServerArguments(root, 23456, {EAGLER_FRONTEND: 'react', EAGLER_LAUNCHER_FIXTURE_INPUTS: '/never/read.json'}), ['scripts/serve-static.mjs', root, '23456']);
}));

test('selected publication identity, root mount and no isolated worker are required; main reads no publication marker', async () => markerRoot(async root => {
  const missing = resolve(root, 'missing');
  assert.deepEqual(webkitPublicationServerArguments(missing, 23456, {}), ['scripts/serve.mjs', '23456', missing]);
  assert.throws(() => webkitPublicationServerArguments(missing, 23456, {EAGLER_FRONTEND: 'react'}), /ENOENT/);
  for (const marker of [{...deploymentMarker, frontend: {kind: 'main', mountPath: '/'}}, {...deploymentMarker, frontend: {kind: 'react', mountPath: '/nested/'}}, {...deploymentMarker, appShell: {origin: 'https://different.test'}}]) {
    await writeFile(resolve(root, 'deployment.json'), JSON.stringify(marker));
    assert.throws(() => webkitPublicationServerArguments(root, 23456, {EAGLER_FRONTEND: 'react'}), /verified root-mounted React publication/);
  }
}));

test('wrapper reverses exactly to pinned; packaging, verification, original Python arguments/game loop/environment/cleanup are untouched', async () => {
  const source = await readFile(resolve(project, wrapper), 'utf8');
  const original = execFileSync('git', ['show', `${baseline}:${wrapper}`], {cwd: project, encoding: 'utf8'});
  assert.equal(restore(source), original);
  const verify = source.indexOf('await run(process.execPath, ["scripts/verify-server-build.mjs", output]);');
  const serve = source.indexOf('webkitPublicationServerArguments(output, port)');
  assert.ok(verify > 0 && verify < serve);
  assert.equal(source.slice(source.indexOf('  const url = `http://127.0.0.1:${port}/`;')), original.slice(original.indexOf('  const url = `http://127.0.0.1:${port}/`;')));
});

async function freePort() {
  const server = createServer(); await new Promise((yes, no) => {server.once('error', no); server.listen(0, '127.0.0.1', yes);});
  const port = server.address().port; await new Promise(yes => server.close(yes)); return port;
}
async function start(root) {
  const port = await freePort(), env = {...process.env, EAGLER_FRONTEND: 'react', EAGLER_TOUHOU_HOST: '127.0.0.1'};
  delete env.EAGLER_ENABLE_THCRAP; delete env.EAGLER_TOUHOU_ARTWORK_DIR;
  const child = spawn(process.execPath, webkitPublicationServerArguments(root, port, env), {cwd: project, env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', data => {output += data;}); child.stderr.on('data', data => {output += data;});
  const exited = new Promise(yes => child.once('exit', yes));
  const stop = async () => {if (child.exitCode === null && child.signalCode === null) {child.kill(); await exited;}};
  try {
    await new Promise((yes, no) => {
      const timer = setTimeout(() => finish(new Error('Static server setup timeout: ' + output)), 15000);
      const ready = () => {if (output.includes(`Eagler Touhou host: http://127.0.0.1:${port}/`)) finish();};
      const failed = () => finish(new Error('Static server exited: ' + output));
      const finish = error => {clearTimeout(timer); child.stdout.off('data', ready); child.off('exit', failed); child.off('error', finish); error ? no(error) : yes();};
      child.stdout.on('data', ready); child.once('exit', failed); child.once('error', finish);
    });
    return {base: `http://127.0.0.1:${port}`, stop};
  } catch (error) {await stop(); throw error;}
}
function raw(base, path, {method = 'GET', headers = {}} = {}) {
  return new Promise((yes, no) => {
    const req = request(base + path, {method, headers}, response => {
      const parts = []; response.on('data', part => parts.push(part)); response.once('error', no);
      response.once('end', () => yes({status: response.statusCode, headers: response.headers, body: Buffer.concat(parts)}));
    }); req.once('error', no); req.end();
  });
}

test('production static server preserves MIME/cache/ETag/HEAD/compression/redirect/404 over real loopback HTTP without metadata or worker synthesis', {timeout: 30000}, async () => {
  // Inert HTTP byte probes and a selector marker, never Host/Package/game
  // fixtures. The unchanged wrapper verifier owns actual full publication
  // acceptance; this marker alone does not certify a native publication.
  const root = await mkdtemp(resolve(tmpdir(), 'webkit-http-contract-'));
  const immutable = `runtime/th07/${'a'.repeat(64)}/probe.wasm`;
  const bodies = new Map([
    ['index.html', Buffer.from('<!doctype html><title>HTTP transport probe</title>')],
    ['nested/index.html', Buffer.from('nested transport bytes')],
    ['probe.js', Buffer.from('// compression byte probe\n'.repeat(256))],
    [immutable, Buffer.from('inert wasm MIME byte probe\n'.repeat(100))],
    ['shared/probe.otf', Buffer.from('font MIME byte probe')],
    ['games/th07/probe.data', Buffer.from('DATA MIME byte probe')],
    ['legacy-mount-retirement-sw.js', Buffer.from('// inert response byte probe')],
  ]);
  try {
    await writeFile(resolve(root, 'deployment.json'), JSON.stringify(deploymentMarker));
    for (const [path, body] of bodies) {await mkdir(dirname(resolve(root, path)), {recursive: true}); await writeFile(resolve(root, path), body);}
    const server = await start(root);
    try {
      for (const [path, mime] of [['index.html', 'text/html; charset=utf-8'], ['probe.js', 'text/javascript; charset=utf-8'], [immutable, 'application/wasm'], ['shared/probe.otf', 'font/otf'], ['games/th07/probe.data', 'application/octet-stream']]) {
        const response = await raw(server.base, '/' + path);
        assert.equal(response.status, 200); assert.equal(response.headers['content-type'], mime); assert.deepEqual(response.body, bodies.get(path));
        assert.equal(response.headers['cache-control'], path === immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
        assert.ok(response.headers.etag); assert.ok(response.headers['last-modified']); assert.equal(response.headers.vary, 'Accept-Encoding');
        const head = await raw(server.base, '/' + path, {method: 'HEAD'}); assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers.etag, response.headers.etag); assert.equal(head.headers['content-length'], String(bodies.get(path).length));
        const cached = await raw(server.base, '/' + path, {headers: {'If-None-Match': response.headers.etag}}); assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
      }
      for (const [encoding, decode] of [['gzip', gunzipSync], ['br', brotliDecompressSync]]) {
        const response = await raw(server.base, '/probe.js', {headers: {'Accept-Encoding': encoding}});
        assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], encoding); assert.deepEqual(decode(response.body), bodies.get('probe.js'));
      }
      const directory = await raw(server.base, '/nested?probe=1'); assert.equal(directory.status, 308); assert.equal(directory.headers.location, '/nested/?probe=1'); assert.equal(directory.headers['cache-control'], 'no-store');
      const legacy = await raw(server.base, '/eagler-touhou/'); assert.equal(legacy.status, 302); assert.equal(legacy.headers.location, '/');
      const retired = await raw(server.base, '/eagler-touhou/app-shell-sw.js'); assert.equal(retired.status, 200); assert.equal(retired.headers['service-worker-allowed'], '/eagler-touhou/'); assert.equal(retired.headers['cache-control'], 'no-store');
      assert.equal((await raw(server.base, '/favicon.ico')).status, 204);
      for (const path of ['/missing.html', '/missing.wasm', '/app.js', '/assets/launcher/app.mjs', '/public/index.html', '/host-manifest.json', '/release-catalog.json', '/app-shell-sw.js', '/%2e%2e%2foutside']) {
        const response = await raw(server.base, path); assert.equal(response.status, 404, path); assert.equal(response.body.toString(), 'Not found');
      }
      for (const [path, body] of bodies) assert.deepEqual(await readFile(resolve(root, path)), body, 'serving must not rewrite publication bytes');
    } finally {await server.stop();}
  } finally {await rm(root, {recursive: true, force: true});}
});
