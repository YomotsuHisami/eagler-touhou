/** Refresh an offline release candidate, retaining an on-disk rollback copy. */
import {randomUUID} from 'node:crypto';
import {cp,lstat,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {freezeHostRuntimes,verifyRuntimePublication} from './runtime-generations.mjs';
import {buildAppShell} from './app-shell-build.mjs';
import {FRONTEND_PACKAGE_FILES,FRONTEND_UI_ARTIFACT,hostArtworkFiles,resolveFrontendPackageSource} from './frontend-manifest.mjs';
import {installUiFrontend,verifyUiFrontend} from './ui-frontend.mjs';
import {HOST_MANIFEST_FILE,validateHostManifest} from './contracts/host-manifest.mjs';
import {verifyReleaseManifest,writeReleaseManifest,sourceIdentity} from './release-manifest.mjs';
import {PRIVATE_FRONTEND_ASSETS,privateFrontendAssetSource} from './private-frontend-assets.mjs';
import {WORKSPACE_REPOSITORIES} from './workspace-layout.mjs';
import {normalizeSiteUrl} from './site-metadata.mjs';
import {uiArtifactHash} from './ui-artifact.mjs';
const project=fileURLToPath(new URL('../',import.meta.url)),json=value=>JSON.stringify(value,null,2)+'\n';
export async function refreshUiDeployment(root,{frontend=false,siteUrl=null,artworkRoot=null,artifact=FRONTEND_UI_ARTIFACT}={}){
 root=resolve(root);const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Refresh requires an offline ordinary deployment directory, not a live symlink');
 async function ordinaryTree(directory){for(const item of await readdir(directory,{withFileTypes:true})){if(item.isDirectory())await ordinaryTree(resolve(directory,item.name));else if(!item.isFile())throw Error('Refresh source cannot contain symlinks or special files');}}
 await ordinaryTree(root);
 const original=JSON.parse(await readFile(resolve(root,'deployment.json'),'utf8'));
 if(original.format!=='eagler-touhou-deployment/1'||!Array.isArray(original.files))throw Error('Invalid deployment manifest');
 const previous=await verifyReleaseManifest(root),site=normalizeSiteUrl(siteUrl||original.siteUrl);
 if(artworkRoot&&!frontend)throw Error('Artwork refresh requires frontend refresh');
 const candidate=resolve(dirname(root),`.${basename(root)}.refresh-${randomUUID()}`),backup=resolve(dirname(root),`.${basename(root)}.previous-${randomUUID()}`);
 let moved=false,committed=false;
 try{
  await cp(root,candidate,{recursive:true,errorOnExist:true,force:false});
  await verifyReleaseManifest(candidate); // Fence source changes during copy.
  const deployment=structuredClone(original),host=validateHostManifest(JSON.parse(await readFile(resolve(candidate,HOST_MANIFEST_FILE),'utf8')));
  await freezeHostRuntimes(candidate,host);await writeFile(resolve(candidate,HOST_MANIFEST_FILE),json(host));await verifyRuntimePublication(candidate,host);
  let shell;
  if(frontend){
   const privateTargets=new Set(PRIVATE_FRONTEND_ASSETS.map(item=>item.target));
   for(const path of FRONTEND_PACKAGE_FILES){if(privateTargets.has(path))continue;await mkdir(dirname(resolve(candidate,path)),{recursive:true});await cp(resolveFrontendPackageSource(path),resolve(candidate,path));}
   for(const asset of PRIVATE_FRONTEND_ASSETS){try{const bytes=await readFile(privateFrontendAssetSource(asset.target));await mkdir(dirname(resolve(candidate,asset.target)),{recursive:true});await writeFile(resolve(candidate,asset.target),bytes);}catch(error){if(error.code!=='ENOENT')throw error;}}
   if(artworkRoot)for(const name of hostArtworkFiles(Object.keys(host.games))){const path=`assets/${name}`;if(!original.files.some(file=>file.path===path))continue;await cp(resolve(artworkRoot,name),resolve(candidate,path));}
   shell=await installUiFrontend(candidate,{artifact,hostManifest:host,siteUrl:site,baseReleaseId:previous.releaseId});
   deployment.uiPublication={schema:'eagler-touhou/ui-publication/1',manifest:'ui-publication.json',status:'react-main'};
  }else{
   // Publication archive retention may update only Runtime pointers. Keep the
   // exact existing UI bytes and prelude, even if source's UI is a newer build.
   const marker=deployment.uiPublication?JSON.parse(await readFile(resolve(candidate,'ui-publication.json'),'utf8')):null;
   if(marker && typeof marker.workerPrelude!=='string')throw Error('Existing React release lacks its sealed worker prelude; explicitly refresh frontend');
   shell=await buildAppShell({globDirectory:candidate,swDest:resolve(candidate,'app-shell-sw.js'),appShellFiles:deployment.appShell.entries.filter(path=>path!=='./'&&!path.startsWith('runtime/')&&path!=='runtime-manifest.json'),workerPrelude:marker?.workerPrelude||'',quiet:true});
  }
  if(shell.warnings.length)throw Error(shell.warnings.join('; '));
  const files=[];
  async function inventory(prefix=''){for(const entry of await readdir(resolve(candidate,prefix),{withFileTypes:true})){if(!prefix&&entry.name==='.tmp'){if((await readdir(resolve(candidate,'.tmp'))).length)throw Error('Unfinished refresh staging');continue;}const path=prefix+entry.name;if(entry.isDirectory())await inventory(path+'/');else{if(!entry.isFile())throw Error(`Non-file in refresh: ${path}`);if(['deployment.json','release-manifest.json','checksums.txt'].includes(path))continue;const bytes=await readFile(resolve(candidate,path));files.push({path,bytes:bytes.length,sha256:uiArtifactHash(bytes)});}}}
  await inventory();deployment.files=files.sort((a,b)=>a.path.localeCompare(b.path,'en'));deployment.appShell=shell.contract;deployment.generatedAt=new Date().toISOString();if(site)deployment.siteUrl=site;
  await writeFile(resolve(candidate,'deployment.json'),json(deployment));
  let sources=previous.sources;
  if(frontend){let launcher;try{launcher=await sourceIdentity(project);}catch{const provenance=JSON.parse(await readFile(resolve(project,'self-host-provenance.json'),'utf8'));if(provenance.schema!=='eagler-touhou/self-host-bundle-provenance/1'||provenance.launcherRepository!==WORKSPACE_REPOSITORIES.launcher||!provenance.launcherSource)throw Error('Frontend source provenance unavailable');launcher=provenance.launcherSource;}sources={...sources,[WORKSPACE_REPOSITORIES.launcher]:launcher};}
  await writeReleaseManifest(candidate,{profile:previous.profile,sources,parameters:previous.parameters});await verifyReleaseManifest(candidate);await verifyRuntimePublication(candidate,host);if(deployment.uiPublication)await verifyUiFrontend(candidate,deployment);
  await rename(root,backup);moved=true;await rename(candidate,root);committed=true;
  return {refreshed:true,frontend,buildId:shell.buildId,precache:shell.count,previous:backup};
 }finally{
  if(moved&&!committed)await rename(backup,root);
  await rm(candidate,{recursive:true,force:true});
 }
}
