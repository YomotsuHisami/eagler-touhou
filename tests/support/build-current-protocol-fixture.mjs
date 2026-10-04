/** Synthetic-only publication for current UI/protocol/relay integration tests.
 * No game code, retail bytes, native engine, timing or persistence evidence. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,stat,writeFile,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_GAMES} from '../../lib/contracts/product-catalog.mjs';
import {validateHostManifest} from '../../lib/contracts/host-manifest.mjs';
import {validateReleaseCatalog} from '../../lib/contracts/release-catalog.mjs';
import {validatePackageDescriptor} from '../../package/package-descriptor.mjs';
import {writeRuntimeGeneration,publishRuntimeManifest,verifyRuntimePublication} from '../../lib/runtime-generations.mjs';
import {installUiFrontend,verifyUiFrontend} from '../../lib/ui-frontend.mjs';
import {writeReleaseManifest} from '../../lib/release-manifest.mjs';
import {files,put} from '../publication/fixtures.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';

export function protocolFixtureScript(game,variant,{configureError='',manualPreflightFrame=false}={}){
 const storage=PRODUCT_GAMES[game].storage;
 return `// Synthetic protocol responses only; never a native game Runtime.
const protocol='eagler-touhou/1',game=${JSON.stringify(game)},variant=${JSON.stringify(variant)},configureError=${JSON.stringify(configureError)},manualPreflightFrame=${JSON.stringify(manualPreflightFrame)};
const epoch=Number(new URLSearchParams(location.search).get('runtimeEpoch'));
const send=(event,fields={})=>parent.postMessage({protocol,game,epoch,event,...fields},location.origin);
const fileBytes=new Map([[${JSON.stringify(storage.saveRoot+'/'+storage.scoreFile)},[83,89,78]]]);
globalThis.__eaglerTestMessages=[];globalThis.__eaglerTestWrites=[];
const FS={mkdirTree(){},writeFile(path,bytes){const data=Array.from(bytes);fileBytes.set(path,data);globalThis.__eaglerTestWrites.push({path,bytes:data});},
 readFile(path){if(!fileBytes.has(path))throw Error('Synthetic file missing');return new Uint8Array(fileBytes.get(path));},unlink(path){fileBytes.delete(path);}};
globalThis.FS=FS;globalThis.Module={FS,touhouMusicMode:'none'};
globalThis.__eaglerSyntheticProtocolFixture=true;
globalThis.__eaglerSendCurrentExit=()=>send('exit',{status:'error'});
globalThis.__eaglerSendStaleExit=()=>send('exit',{epoch:epoch-1,status:'error'});
globalThis.__eaglerSendFirstFrame=()=>send('first-frame');
globalThis.__eaglerTestRequestTitleRoom=()=>{if(game==='th09'&&variant==='normal')send('network-request');};
addEventListener('message',event=>{
 const m=event.data||{};
 if(event.source!==parent||event.origin!==location.origin||m.protocol!==protocol||m.game!==game||m.epoch!==epoch)return;
 if(typeof m.command!=='string')return;
 globalThis.__eaglerTestMessages.push(structuredClone(m));
 let result={};
 if(m.command==='configure'){
  globalThis.__eaglerConfigureOptions=m.options;
  if(configureError){if(m.request)parent.postMessage({protocol,game,epoch,request:m.request,ok:false,error:configureError},location.origin);return;}
  globalThis.Module.touhouMusicMode=m.music;
 }
 if(m.command==='list')result.files=[...fileBytes].map(([path,bytes])=>({path,size:bytes.length}));
 if(m.command==='read'){
  if(!fileBytes.has(m.path)){if(m.request)parent.postMessage({protocol,game,epoch,request:m.request,ok:false,error:'Synthetic file missing'},location.origin);return;}
  result.bytes=[...fileBytes.get(m.path)];
 }
 if(m.command==='write')FS.writeFile(m.path,m.bytes||[]);
 if(m.command==='remove')fileBytes.delete(m.path);
 if(m.request)parent.postMessage({protocol,game,epoch,request:m.request,ok:true,...result},location.origin);
 if(m.command==='launch'&&!(manualPreflightFrame&&variant==='multiplayer'&&!globalThis.__eaglerConfigureOptions?.netplayMode&&!globalThis.__eaglerConfigureOptions?.replayViewer))setTimeout(()=>send('first-frame'),0);
});
send('ready',{saveRoot:${JSON.stringify(storage.saveRoot)}});
send('runtime-info',{renderer:'synthetic-protocol-only',architecture:'fixture',version:'fixture-1'});
`;
}

export async function buildCurrentProtocolFixture({output,games=['th06','th07','th09'],relay='',testBuild=false,ogg=true,midi=false,configureError='',manualPreflightFrame=false}={}){
 if(!output)throw Error('A fresh --output directory is required');
 const root=resolve(output);
 if(await stat(root).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('Synthetic fixture output must not already exist');
 if(!Array.isArray(games)||!games.length||new Set(games).size!==games.length||games.some(game=>!Object.hasOwn(PRODUCT_GAMES,game)))throw Error('Select registered fixture games');
 if(typeof manualPreflightFrame!=='boolean')throw Error('Synthetic manual preflight frame must be boolean');
 if(typeof configureError!=='string'||configureError.length>500)throw Error('Synthetic configure error must be a bounded message');
 if(relay){const url=new URL(relay);if(!['ws:','wss:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Synthetic fixture relay must be an explicit loopback WebSocket URL');}
 await mkdir(root,{recursive:true});
 const host={schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-validation-protocol-ui',
  shared:{resourceMode:'hosted',runtimeManifest:'runtime-manifest.json',vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf',testBuild,...(relay?{netplayRelay:relay}:{})},games:{}};
 const catalog={schema:'eagler-touhou/release-catalog/1',games:{}},groups=[];
 for(const game of games){
  const product=PRODUCT_GAMES[game],payload=Buffer.from('SYNTHETIC DATA '+game),layout='sha256-'+hash('synthetic-layout:'+game);
  const base={'game-data':{source:`games/${game}${product.package.dataTarget}`,target:product.package.dataTarget}};
  for(const target of product.requiredShared??['/msgothic.ttc','/unifont.otf'])base[target==='/msgothic.ttc'?'shared-msgothic':'shared-unifont']={source:'shared'+target,target};
  const packageFiles={};
  for(const [id,entry] of Object.entries(base)){
   const bytes=id==='game-data'?payload:Buffer.from('SYNTHETIC FONT '+entry.target);
   await put(root,entry.source,bytes);packageFiles[id]={...entry,bytes:bytes.length,sha256:hash(bytes),revision:hash(bytes)};
  }
  const oggIds=[];
  if(ogg)for(let index=1;index<=3;index++){
   const id=`ogg:track${index}`,name=`${game}_${String(index).padStart(2,'0')}.ogg`,bytes=Buffer.from('SYNTHETIC AUDIO '+name);
   const source=`games/${game}/music/ogg/${name}`;await put(root,source,bytes);
   packageFiles[id]={source,target:`${product.package.musicMounts.ogg}/${name}`,bytes:bytes.length,sha256:hash(bytes),revision:hash(bytes)};oggIds.push(id);
  }
  const descriptor=validatePackageDescriptor({schema:'eagler-touhou/package/1',game,revision:hash(json(packageFiles)),
   runtimeRequirement:{protocol:'eagler-touhou/1',target:game,dataFile:'game-data',dataLayout:layout},
   files:packageFiles,base:{files:Object.keys(base)},components:oggIds.length?{ogg:{type:'ogg',files:oggIds}}:{}});
  await put(root,`${game}.package.json`,json(descriptor));catalog.games[game]={revision:descriptor.revision,descriptor:`${game}.package.json`};
  const entry={gameData:{path:product.package.dataTarget.slice(1),bytes:payload.length,sha256:hash(payload),version:'sha256-'+hash(payload),layout},
   music:{midi:{files:[],supported:midi===true&&product.musicCapabilities.midi===true}},features:{thprac:false,focusHitbox:false},languages:[],languageOptions:[{id:'ja',title:'日本語',pack:null}]};
  for(const variant of ['normal',...(product.multiplayerRuntime?['multiplayer']:[])]){
   const groupRoot=`runtime/${game}/${variant==='multiplayer'?'multiplayer/':''}`,source=resolve(root,'.fixture-source',game,variant);
   await put(source,`${game}.html`,'<!doctype html><meta charset="utf-8"><title>Synthetic protocol fixture</title><p>Synthetic protocol only; no native game</p><script src="synthetic-runtime.js"></script>');
   await put(source,'synthetic-runtime.js',protocolFixtureScript(game,variant,{configureError,manualPreflightFrame}));
   await put(source,'synthetic.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
   const current=await writeRuntimeGeneration({site:root,root:groupRoot,source,entry:`${game}.html`,names:[`${game}.html`,'synthetic-runtime.js','synthetic.wasm']});
   groups.push({root:groupRoot,current});entry[variant==='normal'?'runtime':'multiplayerRuntime']=`${groupRoot}${current.generation}/${game}.html`;
  }
  host.games[game]=entry;
 }
 validateHostManifest(host);validateReleaseCatalog(catalog);
 await publishRuntimeManifest(root,groups);await rm(resolve(root,'.fixture-source'),{recursive:true});
 await put(root,'host-manifest.json',json(host));await put(root,'release-catalog.json',json(catalog));
 const ui=await installUiFrontend(root,{hostManifest:host,supplementalShellFiles:[]});
 await put(root,'protocol-fixture.json',json({schema:'eagler-touhou/synthetic-ui-protocol-fixture/1',games,nativeRuntime:false,retailData:false,persistentSaveEvidence:false,manualPreflightFrame,mountPath:ui.marker.mountPath}));
 const deployment={format:'eagler-touhou-deployment/1',profile:host.profile,resourceMode:'hosted',uiPublication:'react-main',appShell:ui.contract,files:await files(root)};
 await put(root,'deployment.json',json(deployment));
 await writeReleaseManifest(root,{profile:host.profile,sources:{fixture:{revision:'synthetic-ui-protocol-1'}},parameters:{synthetic:true}});
 await verifyRuntimePublication(root,host);await verifyUiFrontend(root,deployment,host);
 return {root,mountPath:ui.marker.mountPath,games,nativeRuntime:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=Object.fromEntries(process.argv.slice(2).map(argument=>{const match=argument.match(/^--(output|games|relay|test-build|ogg|midi|configure-error|manual-preflight-frame)=(.*)$/);if(!match)throw Error('Use --output=DIR --games=th06,th07,th09 [--relay=ws://127.0.0.1:PORT] [--test-build=0|1] [--ogg=0|1] [--midi=0|1] [--configure-error=MESSAGE] [--manual-preflight-frame=0|1]');return [match[1],match[2]];}));
 for(const key of ['test-build','ogg','midi','manual-preflight-frame'])if(args[key]!==undefined&&!['0','1'].includes(args[key]))throw Error(`--${key} must be 0 or 1`);
 console.log(JSON.stringify(await buildCurrentProtocolFixture({output:args.output,games:args.games?.split(','),relay:args.relay,testBuild:args['test-build']==='1',ogg:args.ogg!=='0',midi:args.midi==='1',configureError:args['configure-error']||'',manualPreflightFrame:args['manual-preflight-frame']==='1'})));
}
