/** Execute an authored browser service in Node without generated browser facades
 * or importing the legacy renderer. Only injected ports may touch external state. */
import {existsSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function importUiModule(relative){
 const entry=resolve(root,relative);
 if(!entry.startsWith(resolve(root,'app')+sep)&&!entry.startsWith(resolve(root,'src')+sep))throw Error('UI test module must be authored app/core source');
 const result=await build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',write:false,plugins:[{
  name:'authored-browser-contracts',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{
   if(!args.path.startsWith('.'))return;
   const path=resolve(dirname(args.importer),args.path);
   for(const name of ['product-catalog','release-catalog','runtime-protocol','host-manifest','resource-mode'])
    if(path===resolve(root,`${name}.mjs`)||path===resolve(root,'lib/contracts',`${name}.mjs`))return {path:resolve(root,'src/contracts',`${name}.mts`)};
   const authored=path.replace(/\.mjs$/,'.mts');
   if(authored.startsWith(resolve(root,'src')+sep)&&existsSync(authored))return {path:authored};
  });}
 }]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
