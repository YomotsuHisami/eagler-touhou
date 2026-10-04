/** Synthetic bytes only. No original-game input, endpoint or credential. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {writeReleaseManifest} from '../../lib/release-manifest.mjs';
import {writeRuntimeGeneration,publishRuntimeManifest} from '../../lib/runtime-generations.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
export async function put(root,path,bytes){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}
export async function files(root,prefix=''){
 const result=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
  if(entry.isDirectory())result.push(...await files(root,prefix+entry.name+'/'));
  else{const path=prefix+entry.name,bytes=await readFile(join(root,path));result.push({path,bytes:bytes.length,sha256:sha(bytes)});}}
 return result.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function createSyntheticPublicationBase(root,mode='hosted'){
 const source=join(root,'source'),runtime=join(root,'runtime-source');
 await put(runtime,'th06.html','<script src="th06.js"></script>');await put(runtime,'th06.js','const fixture = true;');await put(runtime,'th06.wasm','synthetic-wasm');
 const current=await writeRuntimeGeneration({site:source,root:'runtime/th06/',entry:'th06.html',source:runtime,names:['th06.html','th06.js','th06.wasm']});
 await publishRuntimeManifest(source,[{root:'runtime/th06/',current}]);await rm(join(source,'.tmp'),{recursive:true,force:true});
 for(const [path,body] of Object.entries({'index.html':'legacy home','en.html':'legacy English','lobby.html':'legacy lobby','app-shell-sw.js':'old worker','app.js':'old launcher retained for rollback','legacy-mount-retirement-sw.js':'retirement worker','site.webmanifest':'{}','assets/host-card.webp':'original synthetic artwork','assets/th07-card.webp':'synthetic catalog-owned artwork','th06.package.json':'synthetic descriptor','release-catalog.json':'synthetic catalog'}))await put(source,path,body);
 await put(source,'host-manifest.json',json({shared:{runtimeManifest:'runtime-manifest.json',resourceMode:mode},games:{th06:{runtime:`runtime/th06/${current.generation}/th06.html`}}}));
 if(mode==='hosted'){await put(source,'games/th06/th06.data','synthetic-data');await put(source,'shared/unifont.otf','synthetic-font');}
 await put(source,'deployment.json',json({format:'eagler-touhou-deployment/1',profile:'web-validation-fixture',resourceMode:mode,files:await files(source)}));
 await writeReleaseManifest(source,{profile:'web-validation-fixture',sources:{fixture:{revision:'synthetic'}},parameters:{synthetic:true}});
 return {source,current};
}
