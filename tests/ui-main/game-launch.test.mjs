/** Synthetic published acquisition/configuration tests, not real game evidence. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync} from 'fflate';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `
 export * from './app/services/game-launch.client.ts';
 export {acquirePublishedGeneration} from './app/services/sample-launch.client.ts';
 export {adaptLegacyGamePackToPackage} from './legacy/legacy-package-adapter.mjs';
 export {PRODUCT_GAMES} from './src/contracts/product-catalog.mts';
 export {DEFAULT_GAME_OPTIONS} from './src/launcher/game-preferences.mts';
`, resolveDir: root, loader: 'ts'}, bundle: true, format: 'esm', platform: 'browser', write: false,
 plugins: [{name: 'authored-browser-contracts', setup(builder) {builder.onResolve({filter: /\.mjs$/}, args => {
  if (!args.path.startsWith('.')) return;
  const path = resolve(dirname(args.importer), args.path);
  const facade = ['product-catalog', 'release-catalog'].find(name => path === resolve(root, `${name}.mjs`));
  if (facade) return {path: resolve(root, `src/contracts/${facade}.mts`)};
  const authored = path.replace(/\.mjs$/, '.mts');
  if (authored.startsWith(join(root, 'src') + '/') && existsSync(authored)) return {path: authored};
 });}}]});
assert.doesNotMatch(bundle.outputFiles[0].text, /node:|src\/launcher\/app\.mts/);
const directory = await mkdtemp(join(tmpdir(), 'ui-game-launch-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const path = join(directory, 'game.mjs'); await writeFile(path, bundle.outputFiles[0].text);
const {inspectPublishedGame, preparePublishedGame, acquirePublishedGeneration, PRODUCT_GAMES, DEFAULT_GAME_OPTIONS, adaptLegacyGamePackToPackage} = await import(pathToFileURL(path).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseUrl = 'https://example.test/review/';
const games = ['th06', 'th07', 'th08', 'th09', 'th10', 'th11'];
function fixture(game = 'th06', {installed = false} = {}) {
 const product = PRODUCT_GAMES[game], target = product.package.dataTarget;
 const shared = product.requiredShared ?? ['/msgothic.ttc', '/unifont.otf'];
 const ids = ['game-data', ...shared.map(path => path === '/msgothic.ttc' ? 'shared-msgothic' : 'shared-unifont')];
 const targets = [target, ...shared], buffers = new Map();
 const files = Object.fromEntries(ids.map((id, index) => {
  const data = new Uint8Array([index + 1, 2, 3]).buffer; buffers.set(`object-${id}`, data);
  return [id, {revision: `rev-${id}`, source: index ? `shared${targets[index]}` : `games/${game}${target}`,
   target: targets[index], bytes: data.byteLength, sha256: hash(new Uint8Array(data))}];
 }));
 const descriptor = {schema: 'eagler-touhou/package/1', game, revision: '1234567890abcdef',
  runtimeRequirement: {protocol: 'eagler-touhou/1', target: game, dataFile: 'game-data', dataLayout: `sha256-${'a'.repeat(64)}`},
  files, base: {files: ids}, components: {}};
 const generation = {id: `gen-${game}`, game, descriptor, files: Object.fromEntries(ids.map(id => [id, {objectId: `object-${id}`, revision: files[id].revision}]))};
 const code = [`${game}.html`, 'shell.mjs', `${game}.wasm`].sort().map(path => ({path, bytes: 4, sha256: hash(path)}));
 const codeId = hash(JSON.stringify(['eagler-touhou/runtime-generation/1', `${game}.html`, code.map(file => [file.path, file.bytes, file.sha256])]));
 const runtime = {schema: 'eagler-touhou/runtime-manifest/1', protocol: 'eagler-touhou/1', groups: [{root: `runtime/${game}/`, current: {generation: codeId, entry: `${game}.html`, files: code}, previous: []}]};
 const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
  shared: {resourceMode: 'hosted', vanillaFont: 'shared/msgothic.ttc', unicodeFont: 'shared/unifont.otf', runtimeManifest: 'runtime-manifest.json'},
  games: {[game]: {runtime: `runtime/${game}/${codeId}/${game}.html`,
   gameData: {path: target.slice(1), bytes: 3, sha256: files['game-data'].sha256, version: `sha256-${files['game-data'].sha256}`, layout: descriptor.runtimeRequirement.dataLayout},
   music: {midi: {files: []}}, features: {thprac: product.features.thprac, focusHitbox: product.features.focusHitbox},
   languages: [], languageOptions: [{id: 'ja', title: '日本語', pack: null}]}}};
 const catalog = {schema: 'eagler-touhou/release-catalog/1', games: {[game]: {revision: descriptor.revision, descriptor: `${game}.package.json`}}};
 const responses = new Map([['host-manifest.json', {json: host}], ['release-catalog.json', {json: catalog}], ['runtime-manifest.json', {json: runtime}], [`${game}.package.json`, {json: descriptor}],
  ...code.map(file => [`runtime/${game}/${codeId}/${file.path}`, {length: file.bytes, type: file.path.endsWith('.html') ? 'text/html' : 'application/octet-stream'}]),
  ...Object.values(files).map(file => [file.source, {length: file.bytes}])]);
 const requests = [], installs = [], prepared = [];
 const current = {installation: installed ? {game, source: 'local', currentGeneration: generation.id, pendingGeneration: null} : null, generation: installed ? generation : null};
 const preferences = {productId: game, preferenceId: game, shareSingleplayerSettings: true, persistence: 'local',
  options: {...DEFAULT_GAME_OPTIONS}, features: {thprac: true, focusHitbox: true}, language: 'ja', languages: [{id: 'ja', title: '日本語'}], music: 'none', musicPreference: 'none', musicPreferenceExplicit: true, musicModes: ['none']};
 const options = {productId: game, baseUrl, preferences,
  fetchImpl: async (input, init = {}) => {
   requests.push({url: String(input), ...init}); assert.ok(String(input).startsWith(baseUrl));
   const url = new URL(input), item = responses.get(url.pathname.slice(new URL(baseUrl).pathname.length));
   if (!item) return new Response(null, {status: 404});
   return new Response(init.method === 'HEAD' ? null : item.data ?? JSON.stringify(item.json), {status: item.status ?? 200,
    headers: item.json ? {'content-type': 'application/json'} : {'content-length': String(item.length ?? item.data?.length), 'content-type': item.type ?? 'application/octet-stream'}});
  },
  dependencies: {readCurrent: async () => current, readKeys: async keys => new Set(keys.filter(id => buffers.has(id))),
   readObject: async id => buffers.has(id) ? {data: buffers.get(id)} : null,
   install: async (game, args) => {installs.push({game, args}); return {generation, descriptor, installation: {game, currentGeneration: generation.id, source: 'remote'}};}},
  runtimeService: {prepare: async plan => {prepared.push(plan); return {phase: 'prepared', epoch: 1, game: plan.game, generationId: plan.generation.id};}},
 };
 function ogg({present = true} = {}) {
  const ids = [1,2,3].map(n => `ogg:track${n}`);
  descriptor.components.ogg = {type: 'ogg', files: ids};
  for (const [n, id] of ids.entries()) {
   const name = `track${n}.ogg`, data = new Uint8Array([n+10, 11, 12]).buffer;
   files[id] = {revision: `rev-${id}`, source: `games/${game}/music/ogg/${name}`, target: `${product.package.musicMounts.ogg}/${name}`, bytes: 3, sha256: hash(new Uint8Array(data))};
   buffers.set(`object-${id}`, data); if (present) generation.files[id] = {objectId: `object-${id}`, revision: files[id].revision};
  }
  return ids;
 }
 function language({local = false, wrongGame = null} = {}) {
  const language = 'lang_en', path = `/thcrap/${game}/stringdefs.js`, bytes = new TextEncoder().encode('{}');
  const manifest = {schema: 'eagler-touhou/thcrap-static-pack/1', game: wrongGame ?? game, language, runtimeVersion: 'v1', files: [{path, bytes: 2}]};
  const archive = zipSync({'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), [path.slice(1)]: bytes});
  const url = `languages/${game}/en.zip`, pack = {url, bytes: archive.length, sha256: hash(archive), runtimeVersion: 'v1'};
  host.games[game].languageOptions.push({id: language, pack}); host.games[game].languages.push({id: language, pack}); responses.set(url, {data: archive});
  if (local) {
   descriptor.files['language:en'] = {revision: 'lang-1', source: url, target: '/language/en.zip', bytes: archive.length, sha256: pack.sha256};
   descriptor.components.language = {type: 'language', entries: [{id: language, file: 'language:en'}]};
   generation.files['language:en'] = {objectId: 'object-language:en', revision: 'lang-1'}; buffers.set('object-language:en', archive.buffer.slice(archive.byteOffset, archive.byteOffset+archive.byteLength));
  }
  preferences.language = language; return {archive, pack, url};
 }
 return {game, options, preferences, descriptor, host, catalog, runtime, generation, current, responses, requests, installs, prepared, buffers, ogg, language};
}
for (const game of games) test(`${game}: product-owned base/target, exact settings, prepare-only through canonical Package owner`, async () => {
 const f = fixture(game); Object.assign(f.preferences.options, {frameLimit60Enabled: true, touchEnabled: true, touchSensitivity: 173, alwaysHitbox: true});
 const inspection = await inspectPublishedGame(f.options); assert.equal(inspection.status, 'installable'); assert.equal(inspection.game, game);
 assert.equal(inspection.runtimeVerified, false); assert.equal(inspection.packageVerified, false); assert.equal(f.installs.length, 0);
 await preparePublishedGame(f.options); const plan = f.prepared[0];
 assert.equal(plan.game, game); assert.equal(plan.runtimeVariant, 'normal'); assert.equal(plan.generation, f.generation);
 assert.equal(plan.configure.options.touchSensitivity, 173); assert.equal(plan.configure.options.limitPresentationTo60, true);
 assert.equal(plan.configure.options.touchEnabled, true); assert.equal(plan.configure.options.alwaysHitbox, true);
 assert.equal(plan.generation.descriptor.files['game-data'].target, PRODUCT_GAMES[game].package.dataTarget);
 assert.deepEqual(plan.resourceFileIds, f.descriptor.base.files.slice(1)); assert.equal(f.installs.length, 1);
 assert.equal('launch' in plan, false);
});
test('unknown, hidden and multiplayer identities fail before any acquisition', async () => {
 for (const productId of ['th06mp', 'th09mp', 'th20', '__proto__', 'th12']) {
  const f = fixture(); const result = await inspectPublishedGame({...f.options, productId});
  assert.equal(result.reason.code, 'unsupported-product'); assert.equal(f.requests.length, 0); assert.equal(f.installs.length, 0);
 }
 const f = fixture(); f.preferences.productId = 'th07'; await assert.rejects(preparePublishedGame(f.options), e => e.code === 'unsupported-product'); assert.equal(f.requests.length, 0);
});
test('Host DATA and canonical product fonts cannot be substituted across games', async () => {
 const f = fixture('th11'); f.descriptor.files['game-data'].target = '/th11.data';
 assert.equal((await inspectPublishedGame(f.options)).reason.code, 'unsupported-package');
 const g = fixture('th09'); g.descriptor.runtimeRequirement.target = 'th06';
 assert.equal((await inspectPublishedGame(g.options)).reason.code, 'unsupported-package');
});
test('metadata conflict and missing installed objects do not trigger silent reinstall', async () => {
 const f = fixture('th08', {installed: true}); f.buffers.delete('object-game-data');
 assert.equal((await inspectPublishedGame(f.options)).reason.code, 'missing-object'); assert.equal(f.installs.length, 0);
 const g = fixture('th07'); g.catalog.games.th07.revision = 'changed';
 assert.equal((await inspectPublishedGame(g.options)).reason.code, 'conflicting-generation');
});
for (const game of games) test(`${game}: verified local OGG selected into Runtime FS with explicit decode mode`, async () => {
 const f = fixture(game, {installed: true}), ids = f.ogg(); f.preferences.music = 'ogg-full';
 await preparePublishedGame(f.options); const plan = f.prepared[0]; assert.equal(plan.configure.music, 'ogg');
 assert.equal(plan.configure.options.oggDecodeMode, 'full'); assert.deepEqual(plan.configure.resources, []);
 assert.deepEqual(plan.resourceFileIds.slice(-3), ids); assert.equal(f.installs.length, 0);
});
test('missing OGG uses canonical installer selection and verifies its exact returned generation', async () => {
 const f = fixture('th10', {installed: true}), ids = f.ogg({present: false}); f.preferences.music = 'ogg-stream';
 f.options.dependencies.install = async (game, args) => {f.installs.push({game,args}); for (const id of ids) f.generation.files[id] = {objectId: `object-${id}`, revision: f.descriptor.files[id].revision}; return {generation: f.generation};};
 await preparePublishedGame(f.options); assert.deepEqual(f.installs[0].args.addFileIds, ids);
 assert.equal(f.prepared[0].configure.options.oggDecodeMode, 'stream');
});
test('OGG wrong mount, corrupted bytes and stale remote revision block Runtime preparation', async () => {
 const mount = fixture('th09', {installed: true}); const ids = mount.ogg(); mount.preferences.music = 'ogg-full'; mount.descriptor.files[ids[0]].target = '/bgm-ogg/track0.ogg';
 await assert.rejects(preparePublishedGame(mount.options), e => e.code === 'unsupported-package');
 const corrupt = fixture('th11', {installed: true}); const corruptIds = corrupt.ogg(); corrupt.preferences.music = 'ogg-stream'; corrupt.buffers.set(`object-${corruptIds[0]}`, new Uint8Array([0,0,0]).buffer);
 await assert.rejects(preparePublishedGame(corrupt.options), e => e.code === 'integrity-failed'); assert.equal(corrupt.prepared.length, 0);
 const stale = fixture('th08', {installed: true}); stale.ogg({present: false}); stale.preferences.music = 'ogg-stream'; stale.catalog.games.th08.revision = 'new';
 await assert.rejects(preparePublishedGame(stale.options), e => e.code === 'unsupported-music'); assert.equal(stale.installs.length, 0);
});
test('unconnected MIDI is explicit, never an apparently successful silent game', async () => {
 const f = fixture(); f.preferences.music = 'midi'; await assert.rejects(preparePublishedGame(f.options), e => e.code === 'unsupported-music'); assert.equal(f.prepared.length, 0);
 assert.equal((await inspectPublishedGame(f.options)).preferencesContext.musicAvailability.midiAvailable, false);
});
test('published language archive is hashed and validated by the existing static-pack contract', async () => {
 const f = fixture('th07'); const language = f.language(); await preparePublishedGame(f.options);
 const pack = f.prepared[0].configure.runtimePack; assert.equal(pack.language, 'lang_en'); assert.equal(pack.manifest.game, 'th07'); assert.equal(pack.files.length, 1);
 assert.equal(pack.url, `${baseUrl}${language.url}?v=${language.pack.sha256}`); assert.equal(f.prepared[0].configure.options.thpracLocale, 'en-US');
});
test('installed language archives work with missing release catalog and never fetch remote translations', async () => {
 const f = fixture('th11', {installed: true}); const lang = f.language({local: true}); f.responses.delete('release-catalog.json'); f.responses.delete(lang.url);
 await preparePublishedGame(f.options); assert.equal(f.installs.length, 0); assert.equal(f.requests.some(r => r.url.includes(lang.url)), false);
 assert.match(f.prepared[0].configure.runtimePack.url, /__eagler\/package-language\/th11\/lang_en$/);
});
test('wrong-language identity, bad archives and off-mount packs safely fall back to Japanese without erasing preference', async () => {
 for(const mutate of [f=>f.language({wrongGame:'th07'}),f=>{f.language().pack.sha256='b'.repeat(64);},f=>{f.language().pack.url='https://other.test/en.zip';}]) {
  const f=fixture('th06'),warnings=[];mutate(f);f.options.onWarning=warning=>warnings.push(warning);await preparePublishedGame(f.options);
  assert.equal(f.prepared[0].configure.language,'ja');assert.equal(f.prepared[0].configure.runtimePack,null);
  assert.equal(f.prepared[0].configure.options.thpracLocale,'ja-JP');assert.equal(f.preferences.language,'lang_en');assert.equal(warnings.length,1);assert.match(warnings[0],/Japanese/);
 }
});
test('click-time settings are isolated from later form edits and Host restrictions win', async () => {
 const f = fixture('th06', {installed: true}); f.preferences.options.thpracEnabled = true; f.preferences.options.frameLimit60Enabled = true;
 f.host.games.th06.features = {thprac: false, focusHitbox: false};
 const task = preparePublishedGame(f.options); f.preferences.options.frameLimit60Enabled = false; await task;
 assert.equal(f.prepared[0].configure.options.limitPresentationTo60, true); assert.equal('thpracEnabled' in f.prepared[0].configure.options, false); assert.equal('focusHitboxEnabled' in f.prepared[0].configure.options, false);
});
test('installer mutation of inspected descriptor is detected despite same revision', async () => {
 const f = fixture('th07'); f.options.dependencies.install = async () => {f.descriptor.files['shared-msgothic'].sha256 = 'b'.repeat(64); return {generation: f.generation};};
 await assert.rejects(preparePublishedGame(f.options), e => e.code === 'conflicting-generation'); assert.equal(f.prepared.length, 0);
});
test('abort after acquisition or during language transfer never prepares Runtime', async () => {
 const f = fixture(); const controller = new AbortController(); f.options.signal = controller.signal;
 f.options.dependencies.install = async () => {controller.abort(); return {generation: f.generation};};
 await assert.rejects(preparePublishedGame(f.options), {name: 'AbortError'}); assert.equal(f.prepared.length, 0);
 const g = fixture('th08'); const lang = g.language(); const signal = new AbortController(); g.options.signal = signal.signal; const fetch = g.options.fetchImpl;
 g.options.fetchImpl = async (input, init) => {if (String(input).includes(lang.url)) signal.abort(); return fetch(input, init);};
 await assert.rejects(preparePublishedGame(g.options), {name: 'AbortError'}); assert.equal(g.prepared.length, 0);
});

test('connected MIDI preparation waits for the real synth bridge and still never launches', async () => {
 const f=fixture('th07'); f.preferences.music='midi'; f.options.midiAvailable=true; let ready=0;
 f.options.prepareMidi=async()=>{ready++;};await preparePublishedGame(f.options);
 assert.equal(ready,1);assert.equal(f.prepared[0].configure.music,'midi');assert.equal(f.prepared.length,1);
});
test('delayed MIDI readiness cancellation cannot proceed to Package or Runtime work', async () => {
 const f=fixture('th06'),controller=new AbortController();f.preferences.music='midi';f.options.midiAvailable=true;f.options.signal=controller.signal;
 let resolve,started;const began=new Promise(yes=>started=yes);const wait=new Promise(yes=>resolve=yes);
 f.options.prepareMidi=async()=>{started();await wait;};const task=preparePublishedGame(f.options);await began;controller.abort();resolve();
 await assert.rejects(task,{name:'AbortError'});assert.equal(f.installs.length,0);assert.equal(f.prepared.length,0);
});
test('launcher-only controls and saved layout are isolated from later editor changes', async () => {
 const f=fixture('th08');Object.assign(f.preferences.options,{restartButtonEnabled:true,magnifierEnabled:true,thpracTouchControlsEnabled:true});
 f.options.touchLayout={version:1,profiles:{landscape:{controls:{bomb:{x:.2,y:.3,scale:1,priority:1}},viewport:{x:0}},portrait:null}};
 const task=preparePublishedGame(f.options);f.options.touchLayout.profiles.landscape.controls.bomb.x=.9;await task;
 assert.equal(f.prepared[0].launcherControls.touchLayout.profiles.landscape.controls.bomb.x,.2);
 assert.equal(f.prepared[0].launcherControls.restartButtonEnabled,true);assert.equal('launcherControls' in f.prepared[0].configure,false);
});

test('language cache uses established origin identity, rehashes hits and remembers only durable verified downloads',async()=>{
 const f=fixture('th07'),lang=f.language(),stored=new Map(),memory=new Map(),events=[];
 const cache={match:async key=>stored.get(key.url)?.clone(),put:async(key,response)=>{events.push(['put',key.url]);stored.set(key.url,response.clone());},delete:async key=>{events.push(['delete',key.url]);return stored.delete(key.url);}};
 f.options.cacheStorage={open:async name=>{assert.equal(name,'eagler-touhou-language-packs-v1');return cache;}};
 f.options.offlineStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
 await preparePublishedGame(f.options);const key=`https://example.test/__eagler-language/th07/lang_en/${lang.pack.sha256}`;
 assert.ok(stored.has(key));assert.ok(memory.has('eagler-touhou-th07-offline-language-index-v1'));
 f.responses.delete(lang.url);f.requests.length=0;await preparePublishedGame(f.options);
 assert.equal(f.requests.some(request=>request.url.includes(lang.url)),false);assert.equal(f.prepared.at(-1).configure.language,'lang_en');
});
test('corrupted language cache is deleted and refetched no-store, cache refusal remains nonfatal',async()=>{
 const f=fixture('th08'),lang=f.language(),events=[];
 f.options.cacheStorage={open:async()=>({match:async()=>new Response(new Uint8Array([1,2,3])),delete:async()=>{events.push('delete');return true;},put:async()=>{throw new Error('quota');}})};
 await preparePublishedGame(f.options);assert.deepEqual(events,['delete']);
 assert.equal(f.requests.find(request=>request.url.includes(lang.url)).cache,'no-store');assert.equal(f.prepared[0].configure.language,'lang_en');
});
test('missing optional translation falls back; cancellation remains terminal rather than being hidden as fallback',async()=>{
 const f=fixture('th11'),lang=f.language(),warnings=[];f.responses.delete(lang.url);f.options.onWarning=message=>warnings.push(message);
 await preparePublishedGame(f.options);assert.equal(f.prepared[0].configure.language,'ja');assert.equal(warnings.length,1);
 const g=fixture('th08'),abort=new AbortController();g.language();g.options.signal=abort.signal;g.options.cacheStorage={open:async()=>{abort.abort();throw new Error('cancel');}};
 await assert.rejects(preparePublishedGame(g.options),{name:'AbortError'});assert.equal(g.prepared.length,0);
});

test('actual legacy ZIP adapter output launches from verified stored objects despite historical source paths',async()=>{
 const f=fixture('th06',{installed:true});const data=f.descriptor.files['game-data'];
 const shared=f.descriptor.base.files.slice(1).map(id=>({...f.descriptor.files[id],path:`legacy/${id}.bin`,blob:new Blob([f.buffers.get(`object-${id}`)])}));
 const music=[1,2,3].map(n=>{const bytes=new Uint8Array([n,7,8]);return {name:`track${n}.ogg`,blob:new Blob([bytes]),uncompressedSize:3,sha256:hash(bytes)};});
 const adapted=adaptLegacyGamePackToPackage({manifest:{game:'th06',data:{path:'th06.data',bytes:data.bytes,sha256:data.sha256,layout:f.descriptor.runtimeRequirement.dataLayout}},data:{blob:new Blob([f.buffers.get('object-game-data')])},offline:{shared},music},{protocol:'eagler-touhou/1'});
 f.generation.descriptor=adapted.descriptor;f.generation.files={};for(const[id,item]of adapted.files){f.generation.files[id]={objectId:`legacy-${id}`,revision:item.declaration.revision};f.buffers.set(`legacy-${id}`,await item.blob.arrayBuffer());}
 f.responses.delete('release-catalog.json');f.preferences.music='ogg-full';await preparePublishedGame(f.options);
 assert.equal(f.installs.length,0);assert.equal(f.prepared[0].configure.music,'ogg');assert.equal(f.prepared[0].generation.descriptor.files['game-data'].source,'th06.data');
});
test('raw/local DATA provenance is not reinterpreted as a network path; bytes and Host identity still gate launch',async()=>{
 const f=fixture('th11',{installed:true});f.descriptor.files['game-data'].source='imported/th11.dat';await preparePublishedGame(f.options);assert.equal(f.installs.length,0);
 f.buffers.set('object-game-data',new Uint8Array([9,9,9]).buffer);await assert.rejects(preparePublishedGame(f.options),error=>error.code==='integrity-failed');assert.equal(f.prepared.length,1);
});
test('verified extra base fonts and resource components are installed, but save/config/code targets are rejected',async()=>{
 const f=fixture('th11',{installed:true});const bytes=new Uint8Array([4,5,6]).buffer;
 const add=(id,target)=>{f.descriptor.files[id]={revision:id,source:`extra/${id}.bin`,target,bytes:3,sha256:hash(new Uint8Array(bytes))};f.generation.files[id]={objectId:id,revision:id};f.buffers.set(id,bytes);};
 add('font-extra','/msgothic.ttc');f.descriptor.base.files.push('font-extra');add('resource-extra','/fonts/extra.ttf');f.descriptor.components.additional={type:'resource',files:['resource-extra']};
 await preparePublishedGame(f.options);assert.ok(f.prepared[0].resourceFileIds.includes('font-extra'));assert.ok(f.prepared[0].resourceFileIds.includes('resource-extra'));
 for(const target of ['/savesth11/scoreth11.dat','/th11.dat','/override.js','/th11.cfg']){f.descriptor.files['resource-extra'].target=target;await assert.rejects(preparePublishedGame(f.options),error=>error.code==='unsupported-package');}
});
test('progressive preparation acquires only the existing two-track startup barrier and arms after exact Runtime preparation',async()=>{
 const f=fixture('th10',{installed:true}),ids=f.ogg({present:false}),seeds=[];f.preferences.music='ogg-stream';f.options.progressiveOgg=true;f.options.onPreparedOgg=seed=>seeds.push(seed);
 f.options.dependencies.install=async(game,args)=>{f.installs.push({game,args});for(const id of args.addFileIds)f.generation.files[id]={objectId:`object-${id}`,revision:f.descriptor.files[id].revision};return {generation:f.generation};};
 await preparePublishedGame(f.options);assert.deepEqual(f.installs[0].args.addFileIds,ids.slice(0,2));assert.deepEqual(f.prepared[0].resourceFileIds.slice(-2),ids.slice(0,2));assert.equal(seeds.length,1);assert.equal(seeds[0].epoch,1);assert.deepEqual(seeds[0].fileIds,ids);
});

test('verified historical DATA enables an explicit repair preparation without claiming an installed canonical base', async () => {
 const f = fixture('th07');
 const calls = [];
 f.options.dependencies.ensureStorage = async (game, request) => {calls.push({game, request}); return {
  game, status: 'needs-repair', generationId: null, legacyPresent: true, repairable: true, warning: 'Verified DATA; shared-font preparation required',
 };};
 const inspection = await inspectPublishedGame(f.options);
 assert.equal(inspection.available, true); assert.equal(inspection.status, 'installable'); assert.equal(inspection.requiresStorageRepair, true);
 assert.equal(inspection.packageVerified, false); assert.equal(inspection.runtimeVerified, false); assert.equal(inspection.generationId, null);
 assert.equal(calls[0].request.intent, 'inspect'); assert.ok(calls[0].request.host.games.th07);
 assert.equal(f.installs.length, 0); assert.ok(!f.requests.some(request => /\.data$/.test(request.url)));
});

test('historical DATA conflicts remain blocked and never fall through to remote DATA acquisition', async () => {
 const f = fixture('th07');
 f.options.dependencies.ensureStorage = async game => ({game, status: 'deferred', generationId: null, legacyPresent: true, repairable: false, warning: 'Existing DATA hash or layout conflicts with the Host'});
 const inspection = await inspectPublishedGame(f.options);
 assert.equal(inspection.available, false); assert.equal(inspection.reason.code, 'storage-unavailable'); assert.equal(inspection.requiresStorageRepair, undefined);
 await assert.rejects(preparePublishedGame(f.options), /hash or layout conflicts/);
 assert.equal(f.installs.length, 0); assert.equal(f.prepared.length, 0); assert.ok(!f.requests.some(request => /\.data$/.test(request.url)));
});

test('explicit prepare requests compatibility repair before the unchanged canonical hash validation', async () => {
 const f = fixture('th07', {installed: true});
 let intent;
 f.options.dependencies.ensureStorage = async (game, request) => {intent = request.intent; return {game, status: 'upgraded', generationId: f.current.generation.id, legacyPresent: false, repairable: false, warning: null};};
 await preparePublishedGame(f.options); assert.equal(intent, 'prepare'); assert.equal(f.prepared.length, 1);
 delete f.current.generation.descriptor.files['game-data'].sha256;
 await assert.rejects(preparePublishedGame(f.options), /full SHA-256/);
 assert.equal(f.prepared.length, 1, 'compatibility status cannot relax the canonical validator');
});

test('installed inspection exposes explicit update choice without fetching replacement Package or code',async()=>{
 const f=fixture('th06',{installed:true});f.catalog.games.th06.revision='new-publication';
 f.responses.delete('runtime-manifest.json');
 const result=await inspectPublishedGame(f.options);
 assert.equal(result.available,true);assert.equal(result.updateAvailable,true);
 assert.equal(result.installedRevision,f.descriptor.revision);assert.equal(result.publishedRevision,'new-publication');
 assert.equal(f.requests.some(request=>request.method==='HEAD'||request.url.endsWith('th06.package.json')),false);
 await preparePublishedGame(f.options);assert.equal(f.prepared[0].generation,f.generation);assert.equal(f.installs.length,0);
});
test('click-time Package identity cannot silently switch to a different installed generation',async()=>{
 const f=fixture('th06',{installed:true});f.options.expectedGenerationId='replaced';
 await assert.rejects(preparePublishedGame(f.options),error=>error.code==='conflicting-generation');assert.equal(f.prepared.length,0);assert.equal(f.installs.length,0);
});
test('validated Host recovery URL and hint survive missing Package inspection without unsafe links',async()=>{
 const f=fixture('th06');f.host.shared.gameDataFallback={url:'https://example.test/game-data/',hint:'Bring your game data'};f.responses.delete('release-catalog.json');
 const result=await inspectPublishedGame(f.options);assert.equal(result.available,false);
 assert.deepEqual(result.gameDataFallback,{url:'https://example.test/game-data/',hint:'Bring your game data'});
 for(const url of ['javascript:alert(1)','https://user:secret@example.test/']){
  f.host.shared.gameDataFallback.url=url;const unsafe=await inspectPublishedGame(f.options);assert.equal(unsafe.gameDataFallback,null);
 }
});


for (const game of ['th06', 'th07', 'th08']) test(`${game}: damaged local initial OGG uses verified MIDI for one launch without changing saved preferences`, async () => {
 const f=fixture(game,{installed:true}),ids=f.ogg(),warnings=[],seeds=[];let synth=0;
 Object.assign(f.preferences,{music:'ogg-full',musicPreference:'ogg-full',musicPreferenceExplicit:true});
 Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{synth++;},progressiveOgg:true,onPreparedOgg:seed=>seeds.push(seed),onWarning:warning=>warnings.push(warning)});
 const before=structuredClone(f.preferences),data=f.buffers.get('object-game-data');f.buffers.set(`object-${ids[0]}`,new Uint8Array([0,0,0]).buffer);
 await preparePublishedGame(f.options);const plan=f.prepared[0];
 assert.equal(plan.configure.music,'midi');assert.equal(plan.localOgg,undefined);assert.deepEqual(plan.resourceFileIds,f.descriptor.base.files.slice(1));
 assert.equal(synth,1);assert.equal(warnings.length,1);assert.match(warnings[0],/using MIDI for this launch/);
 assert.deepEqual(f.preferences,before);assert.equal(f.buffers.get('object-game-data'),data);assert.equal(f.installs.length,0);assert.equal(seeds.length,0);
});
test('unreadable local OGG bytes use typed optional fallback but aborted reads remain terminal',async()=>{
 const f=fixture('th06',{installed:true}),ids=f.ogg(),warnings=[];f.preferences.music='ogg-stream';
 Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{},onWarning:value=>warnings.push(value)});
 const read=f.options.dependencies.readObject;f.options.dependencies.readObject=async id=>{if(id===`object-${ids[0]}`)throw new Error('local object read failed');return read(id);};
 await preparePublishedGame(f.options);assert.equal(f.prepared[0].configure.music,'midi');assert.match(warnings[0],/local object read failed/);
 const g=fixture('th06',{installed:true}),ogg=g.ogg(),abort=new AbortController();g.preferences.music='ogg-stream';
 Object.assign(g.options,{midiAvailable:true,prepareMidi:async()=>{},signal:abort.signal,onWarning:()=>assert.fail('No cancellation fallback')});
 const original=g.options.dependencies.readObject;g.options.dependencies.readObject=async id=>{if(id===`object-${ogg[0]}`){abort.abort();throw new Error('late read');}return original(id);};
 await assert.rejects(preparePublishedGame(g.options),{name:'AbortError'});assert.equal(g.prepared.length,0);
});
for(const game of ['th09','th10','th11'])test(`${game}: sentinel or requested MIDI flag never expands catalog playback capability`,async()=>{
 const f=fixture(game,{installed:true}),ids=f.ogg();f.preferences.music='ogg-full';f.buffers.delete(`object-${ids[0]}`);
 Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{},onWarning:()=>assert.fail('No unavailable MIDI fallback')});
 await assert.rejects(preparePublishedGame(f.options),error=>error.code==='integrity-failed');assert.equal(f.prepared.length,0);assert.equal(f.installs.length,0);
});
test('Host refusal, unready synth and remote provenance cannot authorize local MIDI fallback',async()=>{
 for(const gate of ['host','unready','remote']){
  const f=fixture('th06',{installed:true}),ids=f.ogg();f.preferences.music='ogg-stream';f.buffers.delete(`object-${ids[0]}`);
  Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{},onWarning:()=>assert.fail('Invalid fallback permission')});
  if(gate==='host')f.host.games.th06.music.midi.supported=false;
  if(gate==='unready')f.options.prepareMidi=async()=>{throw new Error('synth unavailable');};
  if(gate==='remote')f.current.installation.source='remote';
  await assert.rejects(preparePublishedGame(f.options));assert.equal(f.prepared.length,0);assert.equal(f.installs.length,0);
 }
});
test('optional fallback never swallows DATA, base font, reference revision or OGG declaration failures',async()=>{
 for(const kind of ['data','font','revision','target','hash','bytes']){
  const f=fixture('th06',{installed:true}),ids=f.ogg();f.preferences.music='ogg-full';
  Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{},onWarning:()=>assert.fail('Identity/base failures must not fall back')});
  if(kind==='data')f.buffers.delete('object-game-data');
  if(kind==='font')f.buffers.set('object-shared-msgothic',new Uint8Array([0,0,0]).buffer);
  if(kind==='revision')f.generation.files[ids[0]].revision='wrong';
  if(kind==='target')f.descriptor.files[ids[0]].target='/wrong/track0.ogg';
  if(kind==='hash')delete f.descriptor.files[ids[2]].sha256;
  if(kind==='bytes')f.descriptor.files[ids[2]].bytes=0;
  await assert.rejects(preparePublishedGame(f.options));assert.equal(f.prepared.length,0);assert.equal(f.installs.length,0);
 }
});
test('Runtime-time optional fallback does not arm the progressive OGG job',async()=>{
 const f=fixture('th06',{installed:true});f.ogg();f.preferences.music='ogg-stream';const seeds=[];
 Object.assign(f.options,{midiAvailable:true,prepareMidi:async()=>{},progressiveOgg:true,onPreparedOgg:seed=>seeds.push(seed)});
 f.options.runtimeService.prepare=async plan=>{f.prepared.push(plan);return{phase:'prepared',epoch:1,game:'th06',music:'midi',musicWarning:'late local corruption'};};
 await preparePublishedGame(f.options);assert.equal(f.prepared[0].configure.music,'ogg');assert.equal(f.prepared[0].localOgg.fallbackToMidi,true);assert.equal(seeds.length,0);
});

function developmentFixture(game = 'th06', {installed = false, identityOnly = false} = {}) {
 const f=fixture(game,{installed}), entry=f.host.games[game];
 f.host.profile='web-development';f.host.shared.testBuild=true;delete f.host.shared.runtimeManifest;
 entry.runtime=`workspace/${game}/build/${game}.html?hosted=1&v=development`;
 if (!identityOnly) entry.gameData.source=`workspace/${game}/assets/${game}.data`;
 f.host.shared.vanillaFont='workspace/fonts/msgothic.ttc';f.host.shared.unicodeFont='workspace/fonts/unifont.otf';
 f.responses.set(`workspace/${game}/build/${game}.html`,{length:4,type:'text/html'});
 f.responses.set(`workspace/${game}/assets/${game}.data`,{data:new Uint8Array(f.buffers.get('object-game-data')),length:3});
 for(const id of ['shared-msgothic','shared-unifont'])if(f.buffers.has(`object-${id}`))f.responses.set(`workspace/fonts/${id==='shared-msgothic'?'msgothic.ttc':'unifont.otf'}`,{data:new Uint8Array(f.buffers.get(`object-${id}`)),length:3});
 f.catalog.games={};
 f.options.dependencies.installDevelopment=async args=>{
  f.installs.push({development:true,args});
  assert.equal(args.expectedGenerationId,f.current.generation?.id??null);assert.equal(args.reuseCurrent,true);
  const desired=await args.desiredFileIds(f.current), source=await args.source(f.current), descriptor=args.descriptor;
  const generation={id:`dev-${game}`,game,descriptor,files:{...f.current.generation?.files}};
  for(const id of desired){
   const bytes=await args.acquire(id,descriptor.files[id]);
   assert.equal(bytes.byteLength,descriptor.files[id].bytes);assert.equal(hash(new Uint8Array(bytes)),descriptor.files[id].sha256);
   f.buffers.set(`dev-object-${id}`,bytes);generation.files[id]={objectId:`dev-object-${id}`,revision:descriptor.files[id].revision};
  }
  const installation={game,currentGeneration:generation.id,source};f.current.generation=generation;f.current.installation=installation;
  return {generation,installation};
 };
 return f;
}
for (const game of games) test(`${game}: explicit development Host acquires through the existing Package writer and emits the live Runtime plan`,async()=>{
 const f=developmentFixture(game);
 const inspected=await inspectPublishedGame(f.options);
 assert.equal(inspected.status,'installable',inspected.reason?.message);assert.equal(f.installs.length,0);
 await preparePublishedGame(f.options);
 assert.equal(f.installs.length,1);assert.equal(f.installs[0].development,true);
 const plan=f.prepared[0];assert.equal(plan.publishedRuntime,false);assert.equal(plan.game,game);
 assert.equal(plan.entry,`${baseUrl}${f.host.games[game].runtime}`);
 assert.deepEqual(plan.resourceFileIds,Object.keys(f.descriptor.files).filter(id=>id!=='game-data'));
 assert.equal(f.requests.some(request=>request.url.endsWith('runtime-manifest.json')),false);
 assert.equal(plan.generation.descriptor.runtimeRequirement.dataLayout,f.host.games[game].gameData.layout);
});
for (const game of games) test(`${game}: identity-only development Host uses matching installed resources without network DATA acquisition`,async()=>{
 const f=developmentFixture(game,{installed:true,identityOnly:true});await preparePublishedGame(f.options);
 assert.equal(f.installs.length,0);assert.equal(f.prepared[0].generation,f.generation);assert.equal(f.prepared[0].publishedRuntime,false);
 assert.equal(f.requests.some(request=>request.method==='HEAD'||request.url.includes('/workspace/')),false);
 const empty=developmentFixture(game,{identityOnly:true});
 const result=await inspectPublishedGame(empty.options);assert.equal(result.reason.code,'package-unavailable');assert.equal(empty.installs.length,0);
});
test('development launch requires explicit profile, test flag, hosted mode, matching entry, and same-origin mounted sources',async()=>{
 for(const change of [
  f=>{f.host.profile='web-release';},f=>{f.host.shared.testBuild=false;},
  f=>{f.host.games.th06.runtime='workspace/th07/th07.html';},
  f=>{f.host.games.th06.gameData.source='https://foreign.example/th06.data';},
  f=>{f.host.games.th06.gameData.source='../outside/th06.data';},
  f=>{f.host.shared.vanillaFont='https://foreign.example/font.ttc';},
 ]){
  const f=developmentFixture();change(f);const result=await inspectPublishedGame(f.options);assert.equal(result.available,false);assert.equal(f.installs.length,0);assert.equal(f.prepared.length,0);
 }
 const hidden=developmentFixture('th20');assert.equal((await inspectPublishedGame(hidden.options)).reason.code,'unsupported-product');assert.equal(hidden.requests.length,0);
});
test('development acquisition preserves local provenance and rejects changed installer identity',async()=>{
 const f=developmentFixture();f.options.dependencies.installDevelopment=async args=>{
  assert.equal(args.source({installation:{source:'local'}}),'local');
  return {generation:{...f.generation,descriptor:{...args.descriptor,revision:'changed'}}};
 };
 await assert.rejects(preparePublishedGame(f.options),error=>error.code==='conflicting-generation');assert.equal(f.prepared.length,0);
});
for(const game of games)test(`${game}: development OGG uses declared sources, canonical mounts, and the two-track barrier without a Release Catalog`,async()=>{
 const f=developmentFixture(game), names=['track0.ogg','track1.ogg','track2.ogg'], tracks=names.map((_,n)=>new Uint8Array([10+n,11,12]));
 f.host.games[game].music.ogg={base:`workspace/${game}/music/`,mount:PRODUCT_GAMES[game].package.musicMounts.ogg,
  version:`sha256-${'c'.repeat(64)}`,files:names,sizes:tracks.map(bytes=>bytes.length),sha256:tracks.map(bytes=>hash(bytes))};
 names.forEach((name,n)=>f.responses.set(`workspace/${game}/music/${name}`,{data:tracks[n],length:tracks[n].length}));
 f.options.preferences.music='ogg-stream';f.options.progressiveOgg=true;let seed;f.options.onPreparedOgg=value=>{seed=value;};
 const inspection=await inspectPublishedGame(f.options);assert.equal(inspection.preferencesContext.musicAvailability.remoteOggAdvertised,true);
 await preparePublishedGame(f.options);
 const ids=names.map(name=>`ogg:${name}`);
 assert.deepEqual(f.prepared[0].localOgg.fileIds,ids.slice(0,2));assert.equal(f.prepared[0].publishedRuntime,false);
 assert.deepEqual(seed.fileIds,ids);assert.equal(seed.resolved.catalog,null);assert.ok(seed.resolved.development);
 assert.equal(f.requests.some(request=>request.url.endsWith('track2.ogg')),false);
 const extended=await acquirePublishedGeneration(f.options,seed.resolved,[ids[2]]);
 assert.ok(extended.files[ids[2]]);assert.equal(f.installs.length,2);assert.equal(f.installs.every(item=>item.development),true);
 assert.equal(extended.descriptor.files[ids[2]].target,`${PRODUCT_GAMES[game].package.musicMounts.ogg}/track2.ogg`);
});

test('root source preview preserves explicit workspace-relative development URLs without treating them as published generations',async()=>{
 const f=developmentFixture('th06'), original=f.options.fetchImpl, preview='https://example.test/';
 f.options.baseUrl=preview;
 f.host.games.th06.runtime='../workspace/th06/build/th06.html?hosted=1&v=source';
 f.host.games.th06.gameData.source='../workspace/th06/assets/th06.data';
 f.host.shared.vanillaFont='../workspace/fonts/msgothic.ttc';f.host.shared.unicodeFont='../workspace/fonts/unifont.otf';
 const actual=[];
 f.options.fetchImpl=(input,init)=>{const url=new URL(input);actual.push(url.href);return original(new URL(url.pathname.slice(1)+url.search,baseUrl).href,init);};
 await preparePublishedGame(f.options);
 assert.equal(f.prepared[0].entry,preview+'workspace/th06/build/th06.html?hosted=1&v=source');
 assert.ok(actual.includes(preview+'workspace/th06/assets/th06.data'));assert.equal(f.prepared[0].publishedRuntime,false);
});
