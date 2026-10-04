/** Source builds use the installed toolchain; self-host bundles only read the
 * verified prebuilt artifact and retain their small runtime dependency set. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {readUiArtifact,uiArtifactHash} from './ui-artifact.mjs';
import {uiBuildConfig} from '../scripts/ui-build-config.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
async function inputIdentity(){
 const files=[];
 async function visit(path){if(!existsSync(resolve(project,path)))return;for(const entry of await readdir(resolve(project,path),{withFileTypes:true})){const name=path+'/'+entry.name;if(entry.isDirectory())await visit(name);else if(entry.isFile())files.push([name,uiArtifactHash(await readFile(resolve(project,name)))]);}}
 for(const path of ['app','src','package','legacy','public/assets','public/content'])await visit(path);
 for(const path of ['package-lock.json','react-router.config.ts','vite.config.ts','scripts/build-ui-main.mjs','scripts/finalize-ui-artifact.mjs','scripts/ui-build-config.mjs','scripts/ui-routing.mjs','scripts/ui-deployment-contract.mjs','scripts/vite-contracts.ts','lib/ui-artifact.mjs','NOTICE.txt','public/compatibility.html','th06-card.webp'])files.push([path,uiArtifactHash(await readFile(resolve(project,path)))]);
 return uiArtifactHash(JSON.stringify(files.sort((a,b)=>a[0].localeCompare(b[0],'en'))));
}
export async function ensureUiBuild({environment=process.env}={}){
 const config=uiBuildConfig(environment),prebuilt=resolve(project,'ui-prebuilt');
 if(!existsSync(resolve(project,'app/root.tsx'))){const artifact=await readUiArtifact(prebuilt);if(environment.EAGLER_UI_MOUNT_PATH && artifact.mountPath!==config.mountPath)throw Error('Prebuilt UI mount differs; rebuild the source artifact for this mount');return artifact;}
 const root=resolve(project,config.buildDirectory,'client'),state=resolve(root,'../ui-build-state.json'),lock=resolve(project,'.cache',`ui-artifact-${uiArtifactHash(config.mountPath).slice(0,12)}.lock`);
 await mkdir(resolve(root,'..'),{recursive:true});let acquired=false;const started=Date.now();
 while(!acquired){try{await mkdir(lock);acquired=true;}catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()-started>180000)throw Error('Timed out waiting for UI artifact build lock');await delay(50);}}
 try{
  const input=await inputIdentity();let artifact;
  try{if(JSON.parse(await readFile(state,'utf8')).inputs===input)artifact=await readUiArtifact(root);}catch{}
  if(!artifact){
   await new Promise((done,fail)=>{const child=spawn(process.execPath,[resolve(project,'scripts/build-ui-main.mjs')],{cwd:project,env:{...environment,EAGLER_UI_MOUNT_PATH:config.mountPath,EAGLER_UI_BUILD_DIRECTORY:resolve(project,config.buildDirectory)},stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error(`UI artifact build failed: ${code}`)));});
   artifact=await readUiArtifact(root);await writeFile(state,JSON.stringify({inputs:input}));
  }
  return artifact;
 }finally{await rm(lock,{recursive:true});}
}
