// Local-only validation host. Real Launcher modules and Package Store; no Runtime stubs.
import {createServer} from 'node:http';
import {createReadStream,readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FRONTEND_PACKAGE_FILES,resolveFrontendPackageSource} from '../../lib/frontend-manifest.mjs';
import {browserModuleClosure} from '../../lib/browser-module-graph.mjs';
import {resolveBrowserPublicationSource} from '../../lib/launcher-build.mjs';
import {runtimeFileNames} from '../../lib/runtime-release.mjs';
import {canonicalPackagePayload,validatePackageDescriptor} from '../../package/package-descriptor.mjs';
const seedModules=await browserModuleClosure({root:resolve(import.meta.dirname,'../..'),entries:['package/package-store.mjs'],resolveFile:resolveBrowserPublicationSource});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.ogg':'audio/ogg','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
export function createFixtureServer(config){
 const host=JSON.parse(readFileSync(resolve(config.referenceSite,'host-manifest.json'),'utf8'));
 delete host.shared.netplayRelay;delete host.shared.originMigration;host.shared.testBuild=true;
 for(const game of Object.keys(host.games))if(!Object.hasOwn(config.games,game))delete host.games[game];
 const bodies=new Map(),files=new Map();
 for(const [game,g] of Object.entries(config.games)){
  const original=JSON.parse(readFileSync(resolve(config.referenceSite,game+'.package.json'),'utf8'));
  const descriptor={...original,base:{files:['game-data']},files:{}};
  for(const [id,file] of Object.entries(original.files)){
   if(id!=='game-data'&&!id.startsWith('ogg:'))continue;
   const path=id==='game-data'?g.data:resolve(g.ogg,file.target.split('/').at(-1));
   let bytes=readFileSync(path);if(id==='game-data'&&g.dataBytes)bytes=bytes.subarray(0,g.dataBytes);
   const sha256=createHash('sha256').update(bytes).digest('hex');
   const url='/__fixture/'+game+'/'+(id==='game-data'?'game.data':file.target.split('/').at(-1));
   descriptor.files[id]={...file,source:url.slice(1),bytes:bytes.length,sha256,revision:sha256.slice(0,16)};
   files.set(url,{path,bytes:bytes.length});
  }
  if(descriptor.files['game-data'].sha256!==host.games[game].gameData.sha256)throw Error(game+' DATA identity mismatch');
  descriptor.revision=createHash('sha256').update(canonicalPackagePayload(descriptor)).digest('hex').slice(0,16);
  validatePackageDescriptor(descriptor);
  bodies.set('/__fixture/'+game+'/package.json',JSON.stringify(descriptor));
  host.games[game].runtime='runtime/'+game+'/'+(game==='th08'?'th08-modern.html':'th10.html')+'?hosted=1';
  // The private fixture supplies local packages, not remote package updates.
  delete host.games[game].package;
  const directory=JSON.parse(readFileSync(resolve(g.runtime,'runtime-files.json'),'utf8'));
  if(directory.schema!=='eagler-touhou/runtime-directory/1')throw Error('Invalid directory Runtime manifest');
  for(const name of runtimeFileNames(game,directory.files)){
   const path=resolve(g.runtime,name),bytes=readFileSync(path),identity=directory.files[name];
   if(bytes.length!==identity.bytes||createHash('sha256').update(bytes).digest('hex')!==identity.sha256)throw Error('Stale Runtime: '+name);
   files.set('/runtime/'+game+'/'+name,{path});
  }
 }
 bodies.set('/host-manifest.json',JSON.stringify(host));
 bodies.set('/release-catalog.json',JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}}));
 const server=createServer((req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;}
  if(pathname==='/__fixture/setup.html'){
   res.writeHead(200,{...headers,'Content-Type':mime['.html']}).end(`<!doctype html><meta charset="utf-8"><title>Eagler SDL 本地测试</title><h1>TH08 / TH10 · eagler</h1><p>将本机测试资源装入此测试站的 Package Store，不上传任何文件。</p><button id="install">准备两作的本地 DATA 与 OGG</button><p id="status"></p><a href="/">进入 eagler-touhou</a><script type="module">import {seedFixture} from '/__fixture/seed.mjs';document.querySelector('button').onclick=async()=>{document.querySelector('button').disabled=true;try{for(const game of ['th08','th10']){document.querySelector('#status').textContent='正在准备 '+game;await seedFixture(game);}document.querySelector('#status').textContent='准备完成，可以进入 Launcher。';}catch(e){document.querySelector('#status').textContent=String(e);}};</script>`);return;
  }
  if(bodies.has(pathname)){res.writeHead(200,{...headers,'Content-Type':mime['.json']}).end(bodies.get(pathname));return;}
  let file=files.get(pathname);
  if(pathname==='/__fixture/seed.mjs')file={path:resolve(import.meta.dirname,'sdl-fixture-seed.mjs')};
  const name=pathname==='/'?'index.html':pathname.slice(1);
  if(!file&&FRONTEND_PACKAGE_FILES.includes(name))file={path:resolveFrontendPackageSource(name)};
  if(!file&&seedModules.includes(name))file={path:resolveBrowserPublicationSource(name)};
  if(!file){const candidate=resolve(config.referenceSite,name);if(candidate.startsWith(resolve(config.referenceSite)+sep)&&/^(assets|vendor)\//.test(name))file={path:candidate};}
  if(!file||!existsSync(file.path)||!statSync(file.path).isFile()){res.writeHead(404).end();return;}
  const bytes=file.bytes??statSync(file.path).size;
  res.writeHead(200,{...headers,'Content-Type':mime[extname(file.path)]??'application/octet-stream','Content-Length':bytes});
  if(req.method==='HEAD')res.end();else createReadStream(file.path,{start:0,end:bytes-1}).on('error',()=>res.destroy()).pipe(res);
 });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const config=JSON.parse(readFileSync(process.env.EAGLER_SDL_FIXTURE,'utf8'));
 createFixtureServer(config).listen(Number(process.env.PORT??8191),'127.0.0.1',()=>console.log('http://127.0.0.1:'+(process.env.PORT??8191)+'/__fixture/setup.html'));
}
