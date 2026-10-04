/** Browser IndexedDB fixture with the canonical Package module closure only. */
import {cp,mkdir,stat,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureLauncherBuild,resolveBrowserPublicationSource} from '../../lib/launcher-build.mjs';
import {browserModuleClosure} from '../../lib/browser-module-graph.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
export async function buildPackageBrowserFixture(output){
 if(!output)throw Error('Provide a fresh output directory');
 const root=resolve(output);
 if(await stat(root).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('Fixture output already exists');
 await ensureLauncherBuild();
 const modules=await browserModuleClosure({root:project,entries:['package/package-installer.mjs','package/package-launcher.mjs','package/package-store.mjs'],resolveFile:resolveBrowserPublicationSource});
 for(const path of modules){const destination=resolve(root,path);await mkdir(dirname(destination),{recursive:true});await cp(resolveBrowserPublicationSource(path),destination);}
 await writeFile(resolve(root,'index.html'),'<!doctype html><meta charset="utf-8"><title>Package storage fixture</title>');
 return {root,modules};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildPackageBrowserFixture(process.argv[2])));
