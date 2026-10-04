/** Synthetic acquisition/plan tests, not browser, IndexedDB or game evidence. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({ stdin: {contents: `export * from './app/services/sample-launch.client.ts'; export {prepareRuntimeLaunch} from './src/launcher/runtime-launch.mts';`, resolveDir: root, loader: 'ts'}, bundle: true,
  format: 'esm', platform: 'browser', write: false, plugins: [{ name: 'authored-browser-contracts', setup(builder) {
    builder.onResolve({ filter: /\.mjs$/ }, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path);
      const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
      if (facade) return { path: resolve(root, `src/contracts/${facade}.mts`) };
      const authored = path.replace(/\.mjs$/, '.mts');
      if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return { path: authored };
    });
  } }] });
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const directory = await mkdtemp(join(tmpdir(), 'ui-sample-launch-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'sample.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { inspectTh06Sample, prepareTh06Sample, TH06_SAMPLE_SCOPE, prepareRuntimeLaunch } = await import(pathToFileURL(modulePath).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseUrl = 'https://example.test/review/';
const ids = ['game-data', 'shared-msgothic', 'shared-unifont'];

function fixture({ installed = false } = {}) {
  const buffers = new Map(ids.map((id, i) => [`object-${id}`, new Uint8Array([i + 1, 2, 3]).buffer]));
  const files = Object.fromEntries(ids.map((id, index) => [id, {
    revision: `file-${index}`, source: ['games/th06/th06.data', 'shared/msgothic.ttc', 'shared/unifont.otf'][index],
    target: ['/th06.data', '/msgothic.ttc', '/unifont.otf'][index], bytes: 3,
    sha256: hash(new Uint8Array(buffers.get(`object-${id}`))),
  }]));
  const descriptor = { schema: 'eagler-touhou/package/1', game: 'th06', revision: '1234567890abcdef',
    runtimeRequirement: { protocol: 'eagler-touhou/1', target: 'th06', dataFile: 'game-data', dataLayout: `sha256-${'a'.repeat(64)}` },
    files, base: { files: [...ids] }, components: {} };
  const generation = { id: 'gen-sample', game: 'th06', descriptor,
    files: Object.fromEntries(ids.map(id => [id, { objectId: `object-${id}`, revision: files[id].revision }])) };
  const code = ['th06.html', 'th06.js', 'th06.wasm'].map(path => ({ path, bytes: 4, sha256: hash(path) }));
  const codeId = hash(JSON.stringify(['eagler-touhou/runtime-generation/1', 'th06.html', code.map(file => [file.path, file.bytes, file.sha256])]));
  const runtime = { schema: 'eagler-touhou/runtime-manifest/1', protocol: 'eagler-touhou/1',
    groups: [{ root: 'runtime/th06/', current: { generation: codeId, entry: 'th06.html', files: code }, previous: [] }] };
  const host = { schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
    shared: { resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf', runtimeManifest: 'runtime-manifest.json' },
    games: { th06: { runtime: `runtime/th06/${codeId}/th06.html`,
      gameData: { path: 'th06.data', bytes: 3, sha256: files['game-data'].sha256,
        version: `sha256-${files['game-data'].sha256}`, layout: descriptor.runtimeRequirement.dataLayout },
      music: { midi: { files: [] } }, features: { thprac: true, focusHitbox: true } } } };
  const catalog = { schema: 'eagler-touhou/release-catalog/1', games: { th06: { revision: descriptor.revision, descriptor: 'th06.package.json' } } };
  const responses = new Map([
    ['host-manifest.json', { json: host }], ['release-catalog.json', { json: catalog }],
    ['runtime-manifest.json', { json: runtime }], ['th06.package.json', { json: descriptor }],
    ...code.map(file => [`runtime/th06/${codeId}/${file.path}`, { length: file.bytes, type: file.path.endsWith('.html') ? 'text/html' : 'application/octet-stream' }]),
    ...Object.values(files).map(file => [file.source, { length: file.bytes }]),
  ]);
  const requests = [], installs = [], prepared = [];
  const current = { installation: installed ? { game: 'th06', source: 'local', currentGeneration: generation.id, pendingGeneration: null } : null,
    generation: installed ? generation : null };
  const options = { baseUrl,
    fetchImpl: async (input, init) => {
      const url = new URL(input); requests.push({ url: url.href, ...init });
      assert.ok(url.href.startsWith(baseUrl));
      const item = responses.get(url.href.slice(baseUrl.length));
      if (!item) return new Response(null, { status: 404 });
      if (item.error) throw item.error;
      const headers = item.json ? { 'content-type': 'application/json' }
        : { 'content-length': String(item.length), 'content-type': item.type ?? 'application/octet-stream' };
      return new Response(init.method === 'HEAD' ? null : JSON.stringify(item.json), { status: item.status ?? 200, headers });
    },
    dependencies: {
      readCurrent: async () => current,
      readKeys: async objectIds => new Set(objectIds.filter(id => buffers.has(id))),
      readObject: async id => buffers.has(id) ? { data: buffers.get(id), bytes: buffers.get(id).byteLength } : null,
      install: async (game, args) => { installs.push({ game, args }); return { generation, installation: { game, source: 'remote', currentGeneration: generation.id }, descriptor }; },
    },
    runtimeService: { prepare: async plan => { prepared.push(plan); return { phase: 'prepared', game: 'th06', generationId: plan.generation.id }; } },
  };
  return { options, host, catalog, descriptor, generation, runtime, current, responses, requests, installs, prepared, buffers, codeId };
}
async function reason(f, code) {
  const result = await inspectTh06Sample(f.options);
  assert.equal(result.available, false); assert.equal(result.status, 'unavailable'); assert.equal(result.reason.code, code);
  assert.equal(f.installs.length, 0); assert.equal(f.prepared.length, 0);
  return result;
}

test('read-only fresh inspection probes publication resources at the explicit mount, without installation', async () => {
  const f = fixture(); const result = await inspectTh06Sample(f.options);
  assert.equal(result.available, true); assert.equal(result.status, 'installable'); assert.equal(result.runtimeVerified, false);
  assert.equal(result.generationId, null); assert.deepEqual(result.scope, TH06_SAMPLE_SCOPE);
  assert.equal(f.installs.length, 0); assert.equal(f.prepared.length, 0);
  assert.equal(f.requests.filter(request => request.method === 'HEAD').length, 6);
  assert.equal(result.checks.every(check => check.available), true);
});

test('fresh prepare installs only the base through the current owner, then prepares but does not launch', async () => {
  const f = fixture(); const progress = () => {}; const controller = new AbortController();
  const result = await prepareTh06Sample({ ...f.options, onProgress: progress, signal: controller.signal });
  assert.equal(result.phase, 'prepared'); assert.equal(f.installs.length, 1); assert.equal(f.prepared.length, 1);
  const { game, args } = f.installs[0]; assert.equal(game, 'th06');
  assert.deepEqual(args.addComponents, []); assert.deepEqual(args.addFileIds, []);
  assert.equal(args.preserveLocalSource, true); assert.equal(args.signal, controller.signal); assert.equal(args.onProgress, progress);
  assert.equal(args.catalogUrl, `${baseUrl}release-catalog.json`);
  const plan = f.prepared[0]; assert.equal(plan.generation, f.generation); assert.equal(plan.publishedRuntime, true);
  assert.equal(plan.runtimeVariant, 'normal'); assert.equal(plan.entry, `${baseUrl}${f.host.games.th06.runtime}`);
  assert.deepEqual(plan.resourceFileIds, ['shared-msgothic', 'shared-unifont']);
  assert.deepEqual(plan.configure, { music: 'none', resources: [], runtimeResources: [], sharedResources: [], runtimePack: null,
    options: { limitPresentationTo60: false, touchEnabled: false, touchMovementMode: 'touch', touchSensitivity: 150,
      touchFocusMode: 'hold-button', doubleTapBombEnabled: false, alwaysHitbox: false, oggDecodeMode: 'stream',
      thpracEnabled: false, thpracLocale: 'ja-JP', focusHitboxEnabled: false } });
});

test('installed generation is reused exactly; optionals and durable preferences are not changed', async () => {
  const f = fixture({ installed: true });
  f.descriptor.files['ogg:track'] = { revision: 'optional', source: 'games/th06/music/ogg/track.ogg', target: '/bgm/track.ogg', bytes: 4, sha256: hash('song') };
  f.descriptor.components.ogg = { type: 'ogg', files: ['ogg:track'] };
  f.generation.files['ogg:track'] = { revision: 'optional', objectId: 'optional-object' };
  const before = structuredClone(f.generation);
  const inspection = await inspectTh06Sample(f.options);
  assert.equal(inspection.status, 'installed'); assert.equal(inspection.generationId, f.generation.id);
  await prepareTh06Sample(f.options);
  assert.equal(f.installs.length, 0); assert.equal(f.prepared[0].generation, f.generation);
  assert.deepEqual(f.generation, before); assert.equal(f.requests.some(request => request.url.endsWith('track.ogg')), false);
});

test('valid installed generation tolerates Release Catalog failure but requires Host metadata', async () => {
  const f = fixture({ installed: true }); f.responses.delete('release-catalog.json');
  assert.equal((await inspectTh06Sample(f.options)).status, 'installed');
  await prepareTh06Sample(f.options); assert.equal(f.installs.length, 0);
  await reason(fixtureMissingHost(), 'host-unavailable');
  function fixtureMissingHost() { const missing = fixture(); missing.responses.delete('host-manifest.json'); return missing; }
});

test('no local generation and missing catalog or publication is a clear blocker', async () => {
  const f = fixture(); f.responses.delete('release-catalog.json'); await reason(f, 'catalog-unavailable');
  const other = fixture(); delete other.catalog.games.th06; await reason(other, 'package-unavailable');
});

test('unpublished Runtime is explicitly unsupported, never falsely marked playable', async () => {
  const f = fixture(); delete f.host.shared.runtimeManifest; f.host.games.th06.runtime = 'runtime/th06/th06.html';
  await reason(f, 'unpublished-runtime');
});

test('missing Runtime Manifest, incomplete Runtime and HTML asset fallback block availability', async () => {
  const missing = fixture(); missing.responses.delete('runtime-manifest.json'); await reason(missing, 'runtime-unavailable');
  const incomplete = fixture(); incomplete.responses.delete(`runtime/th06/${incomplete.codeId}/th06.wasm`); await reason(incomplete, 'asset-unavailable');
  const fallback = fixture(); fallback.responses.get('games/th06/th06.data').type = 'text/html'; await reason(fallback, 'asset-unavailable');
  const wrongSize = fixture(); wrongSize.responses.get('shared/msgothic.ttc').length = 5; await reason(wrongSize, 'asset-unavailable');
});

test('invalid Runtime generation identity and multiplayer root are not accepted', async () => {
  const f = fixture(); f.runtime.groups[0].current.files[0].bytes += 1; await reason(f, 'runtime-unavailable');
  const mp = fixture(); mp.runtime.groups[0].root = 'runtime/th06/multiplayer/';
  mp.host.games.th06.runtime = `runtime/th06/multiplayer/${mp.codeId}/th06.html`; await reason(mp, 'runtime-unavailable');
});

test('same-origin mount enforcement rejects URL confusion before package work', async () => {
  const f = fixture(); f.options.baseUrl = `${baseUrl}games/th06`; await reason(f, 'invalid-base-url');
  const other = fixture(); other.host.games.th06.runtime = `/runtime/th06/${other.codeId}/th06.html`;
  await reason(other, 'runtime-unavailable');
});

test('canonical base hashes, paths and resources are required; legacy runtimes and extra resource dependencies are rejected', async () => {
  for (const change of [
    f => { delete f.descriptor.files['shared-msgothic'].sha256; },
    f => { f.descriptor.files['shared-unifont'].source = 'alternate/unifont.otf'; },
    f => { f.descriptor.base.files.pop(); },
    f => { f.descriptor.components.extra = { type: 'resource', files: ['shared-unifont'] }; },
    f => { f.descriptor.runtime = { type: 'html', entry: 'game-data', playerProtocol: 'eagler-touhou/player/1' }; },
  ]) { const f = fixture(); change(f); await reason(f, 'unsupported-package'); }
});

test('Host DATA conflict and Release Catalog descriptor mismatch do not install', async () => {
  const f = fixture(); f.descriptor.files['game-data'].sha256 = 'b'.repeat(64); await reason(f, 'conflicting-generation');
  const release = fixture(); release.catalog.games.th06.revision = 'next'; await reason(release, 'conflicting-generation');
});

test('damaged or inconsistent current generations do not silently trigger a reinstall', async () => {
  const missing = fixture({ installed: true }); missing.buffers.delete('object-shared-msgothic'); await reason(missing, 'missing-object');
  const revision = fixture({ installed: true }); revision.generation.files['game-data'].revision = 'old'; await reason(revision, 'missing-object');
  const identity = fixture({ installed: true }); identity.current.installation.currentGeneration = 'other'; await reason(identity, 'conflicting-generation');
});

test('prepare rehashes existing base bytes before handing them to RuntimeService', async () => {
  const f = fixture({ installed: true }); f.buffers.set('object-shared-unifont', new Uint8Array([9, 9, 9]).buffer);
  assert.equal((await inspectTh06Sample(f.options)).status, 'installed', 'inspection checks availability, not byte integrity');
  await assert.rejects(prepareTh06Sample(f.options), error => error.code === 'integrity-failed');
  assert.equal(f.prepared.length, 0); assert.equal(f.installs.length, 0);
});

test('conflicting installer generation fails before Runtime prepare', async () => {
  const f = fixture(); f.options.dependencies.install = async () => ({ generation: { ...f.generation, descriptor: { ...f.descriptor, revision: 'changed' } } });
  await assert.rejects(prepareTh06Sample(f.options), error => error.code === 'conflicting-generation');
  assert.equal(f.prepared.length, 0);
  const sameRevision = fixture();
  sameRevision.options.dependencies.install = async () => {
    const changed = structuredClone(sameRevision.generation);
    changed.descriptor.files['shared-msgothic'].sha256 = 'c'.repeat(64);
    return { generation: changed };
  };
  await assert.rejects(prepareTh06Sample(sameRevision.options), error => error.code === 'conflicting-generation');
  assert.equal(sameRevision.prepared.length, 0);
});

test('publication feature restrictions are preserved in the exact configure payload', async () => {
  const f = fixture({ installed: true }); f.host.games.th06.features = { thprac: false, focusHitbox: false };
  await prepareTh06Sample(f.options);
  assert.equal('thpracEnabled' in f.prepared[0].configure.options, false);
  assert.equal('thpracLocale' in f.prepared[0].configure.options, false);
  assert.equal('focusHitboxEnabled' in f.prepared[0].configure.options, false);
});

test('abort before work and abort after installation never prepare a Runtime', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(); f.options.signal = controller.signal;
  await reason(f, 'cancelled'); assert.equal(f.requests.length, 0);
  await assert.rejects(prepareTh06Sample(f.options), error => error.name === 'AbortError');
  const later = fixture(), laterController = new AbortController(); later.options.signal = laterController.signal;
  later.options.dependencies.install = async () => { laterController.abort(); return { generation: later.generation }; };
  await assert.rejects(prepareTh06Sample(later.options), error => error.name === 'AbortError'); assert.equal(later.prepared.length, 0);
});

test('storage failure is reported without installation, and repeated inspection does not retain leases', async () => {
  const f = fixture(); f.options.dependencies.readCurrent = async () => { throw new Error('denied'); };
  await reason(f, 'storage-unavailable'); await reason(f, 'storage-unavailable');
  assert.equal(f.installs.length, 0);
});

test('inspection can find a complete declared previous Runtime when the current set is unavailable', async () => {
  const f = fixture();
  const prior = structuredClone(f.runtime.groups[0].current);
  prior.files[0].bytes = 5;
  prior.generation = hash(JSON.stringify(['eagler-touhou/runtime-generation/1', 'th06.html', prior.files.map(file => [file.path, file.bytes, file.sha256])]));
  f.runtime.groups[0].previous.push(prior);
  for (const file of prior.files) f.responses.set(`runtime/th06/${prior.generation}/${file.path}`, { length: file.bytes });
  f.responses.delete(`runtime/th06/${f.codeId}/th06.wasm`);
  const result = await inspectTh06Sample(f.options);
  assert.equal(result.status, 'installable'); assert.equal(result.runtimeVerified, false);
  assert.equal(result.checks.some(check => !check.available && check.url.endsWith('th06.wasm')), true);
  assert.equal(f.installs.length, 0);
});

test('cancellation while loading Runtime metadata remains a cancellation reason', async () => {
  const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
  const fetchImpl = f.options.fetchImpl;
  f.options.fetchImpl = async (...args) => {
    if (String(args[0]).endsWith('runtime-manifest.json')) controller.abort();
    return fetchImpl(...args);
  };
  await reason(f, 'cancelled');
});


test('installed launch reaches real verified offline Runtime fallback with no network metadata or HEAD support', async () => {
 const f=fixture({installed:true}), stores=new Map(), handlers=new Map(), networkRequests=[], requests=[], order=[];
 const files=f.runtime.groups[0].current.files.map(file=>({...file,bytes:4,sha256:hash('code')}));
 const codeId=hash(JSON.stringify(['eagler-touhou/runtime-generation/1','th06.html',files.map(file=>[file.path,file.bytes,file.sha256])]));
 f.runtime.groups[0].current={generation:codeId,entry:'th06.html',files};
 f.host.games.th06.runtime=`runtime/th06/${codeId}/th06.html`;
 const hostBody=JSON.stringify(f.host), remote=new Map([['host-manifest.json',hostBody],['runtime-manifest.json',JSON.stringify(f.runtime)],
  ...files.map(file=>[`runtime/th06/${codeId}/${file.path}`,'code'])]);
 let offline=false;
 const network=async input=>{
  const url=typeof input==='string'?input:input.url;networkRequests.push(url);
  if(offline)throw new Error('Network disconnected');
  const body=remote.get(new URL(url).href.slice(baseUrl.length));return new Response(body??null,{status:body?200:404});
 };
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
  if(!stores.has(name)){
   const entries=new Map(),key=input=>typeof input==='string'?input:input.url;
   stores.set(name,{put:async(input,response)=>entries.set(key(input),response.clone()),match:async input=>entries.get(key(input))?.clone(),
    keys:async()=>[...entries.keys()].map(url=>new Request(url)),delete:async input=>entries.delete(key(input))});
  }return stores.get(name);
 }};
 const contracts=await build({entryPoints:[join(root,'src/contracts/runtime-generations.mts')],bundle:true,write:false,format:'iife',globalName:'EaglerRuntimeGenerations'});
 const source=contracts.outputFiles[0].text+'\n'+await readFile(join(root,'src/runtime-cache-sw.js'),'utf8')+'\n'+
  (await readFile(join(root,'src/app-shell-sw.js'),'utf8')).replaceAll('__APP_SHELL_BUILD_ID__','offline-launch-test').replaceAll('__APP_SHELL_DEFERRED_PATHS__','[]');
 const context=vm.createContext({URL,Request,Response,Headers,Uint8Array,Uint32Array,TextEncoder,AbortController,setTimeout,clearTimeout,console,crypto:webcrypto,caches,fetch:network,
  self:{registration:{scope:baseUrl},__WB_MANIFEST:[{url:'host-manifest.json',revision:hash(hostBody)}],__EAGLER_RUNTIME_MANIFEST:f.runtime,
   clients:{matchAll:async()=>[]},addEventListener:(name,handler)=>handlers.set(name,handler)}});
 vm.runInContext(source,context);
 let installed;handlers.get('install')({waitUntil:task=>{installed=task;}});await installed;
 await vm.runInContext(`runtimeCache.prepareLaunch(${JSON.stringify(f.host.games.th06.runtime)})`,context);
 offline=true;networkRequests.length=0;
 f.options.dependencies.readCurrent=async()=>{order.push('package');return f.current;};
 f.options.fetchImpl=async(input,init={})=>{
  const request=new Request(input,init);requests.push(request);order.push(request.url);
  let response;handlers.get('fetch')({request,respondWith:value=>{response=value;}});
  return response??network(request);
 };
 const worker={postMessage:(data,ports)=>handlers.get('message')({data,ports,waitUntil:task=>void task.catch(()=>{})})};
 let selected;
 f.options.runtimeService.prepare=async plan=>{
  selected=await prepareRuntimeLaunch(plan.entry,{baseUrl,fetchImpl:f.options.fetchImpl,worker});
  f.prepared.push(plan);return {phase:'prepared',generationId:plan.generation.id};
 };
 const inspected=await inspectTh06Sample(f.options);assert.equal(inspected.available,true);assert.equal(inspected.runtimeVerified,false);
 await prepareTh06Sample(f.options);
 assert.equal(order[0],'package');assert.equal(selected.cached,true);assert.equal(selected.generation,codeId);
 assert.equal(f.prepared[0].generation,f.generation);assert.equal(f.installs.length,0);assert.equal(requests.some(request=>request.method==='HEAD'),false);
 assert.ok(networkRequests.length>0);assert.ok(networkRequests.every(url=>url.endsWith('release-catalog.json')||url.endsWith('runtime-manifest.json')));
 // A corrupted committed code object cannot become playable merely because
 // frontend inspection no longer performs HTTP-only availability probes.
 for(const [name,cache] of stores)if(name.startsWith('eagler-touhou-runtime-v2-'))await cache.put(`${baseUrl}runtime/th06/${codeId}/th06.wasm`,new Response('evil'));
 await assert.rejects(prepareTh06Sample(f.options),/unavailable|complete|integrity/);
 assert.equal(f.prepared.length,1);
 // The Package itself is never a substitute for missing Host authority.
 for(const [name,cache] of stores)if(name.startsWith('eagler-touhou-app-shell-'))await cache.delete(baseUrl+'host-manifest.json');
 const missingHost=await inspectTh06Sample(f.options);assert.equal(missingHost.reason.code,'host-unavailable');
});
