/** Portable verifier for a prebuilt Framework artifact; no frontend toolchain. */
import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createUiDeploymentContract} from '../scripts/ui-deployment-contract.mjs';
export const UI_ARTIFACT_SCHEMA='eagler-touhou/ui-artifact/1';
export const UI_ARTIFACT_FILE='ui-artifact.json';
export const uiArtifactHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function uiArtifactPath(path){
 if(typeof path!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)||path.split('/').some(part=>!part||part.startsWith('.')))throw Error(`Unsafe UI artifact path: ${path}`);
 return path;
}
export function uiPublishedPath(path){return !['ui-ownership.json',UI_ARTIFACT_FILE].includes(path);}
export async function uiArtifactFiles(root,prefix=''){
 const files=[];
 for(const entry of await readdir(resolve(root,prefix),{withFileTypes:true})){
  const path=uiArtifactPath(prefix+entry.name);
  if(entry.isDirectory())files.push(...await uiArtifactFiles(root,path+'/'));
  else{if(!entry.isFile())throw Error(`UI artifact must contain ordinary files: ${path}`);if(path===UI_ARTIFACT_FILE)continue;
   const bytes=await readFile(resolve(root,path));files.push({path,bytes:bytes.length,sha256:uiArtifactHash(bytes)});}
 }
 return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export function assertUiFrameworkHtml(html,files,mountPath){
 const match=/window\.__reactRouterContext\s*=\s*(\{[\s\S]*?\});/.exec(html);let state;
 try{state=JSON.parse(match?.[1]);}catch{}
 if(state?.basename!==mountPath||state?.isSpaMode!==true)throw Error('Framework HTML does not match its SPA build mount');
 const names=new Set(files.map(file=>file.path));
 const markup=html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,'<script$1></script>').replace(/<style\b([^>]*)>[\s\S]*?<\/style>/gi,'<style$1></style>');
 for(const tag of markup.matchAll(/<(?:script|link)\b[^>]*>/gi))for(const attr of tag[0].matchAll(/\b(?:src|href)=(?:"([^"]*)"|'([^']*)')/gi)){
  const value=attr[1]??attr[2],executable=/^<script/i.test(tag[0])||/\brel=(?:"|')(?:modulepreload|stylesheet)(?:"|')/i.test(tag[0]);
  if(!value.startsWith(mountPath+'assets/')){if(executable)throw Error('Framework executable/style URL does not match its build mount');continue;}
  const path=new URL(value,'https://ui.invalid').pathname.slice(mountPath.length);
  if(!names.has(path))throw Error(`Missing Framework asset: ${path}`);
 }
}
export async function readUiArtifact(root){
 root=resolve(root);if(!(await lstat(resolve(root,UI_ARTIFACT_FILE))).isFile())throw Error('UI artifact metadata must be an ordinary file');
 const raw=JSON.parse(await readFile(resolve(root,UI_ARTIFACT_FILE),'utf8'));
 const {artifactId,...identity}=raw;
 if(identity.schema!==UI_ARTIFACT_SCHEMA||artifactId!==uiArtifactHash(JSON.stringify(identity))||!Array.isArray(identity.files)||typeof identity.workerPrelude!=='string'||!identity.workerPrelude.includes('__EAGLER_UI_NAVIGATION_FALLBACK'))throw Error('UI artifact identity missing or invalid');
 const actual=await uiArtifactFiles(root);
 if(JSON.stringify(actual)!==JSON.stringify(identity.files))throw Error('UI artifact bytes or inventory changed after build');
 for(const file of actual)if(!['index.html','compatibility.html','ui-build.json','ui-navigation.json','ui-ownership.json','NOTICE.txt','content/FIRST_USE_NOTICE.html','content/MULTIPLAYER.html'].includes(file.path)&&!file.path.startsWith('assets/'))throw Error(`Unexpected UI artifact owner: ${file.path}`);
 const [build,navigation,ownership]=await Promise.all(['ui-build.json','ui-navigation.json','ui-ownership.json'].map(path=>readFile(resolve(root,path),'utf8').then(JSON.parse)));
 if(build.schema!=='eagler-touhou/ui-build/1'||build.mountPath!==identity.mountPath||navigation.schema!=='eagler-touhou/ui-navigation/1'||ownership.schema!=='eagler-touhou/ui-ownership/1'||ownership.legacyLauncherIncluded!==false||ownership.nodeBuiltinsIncluded!==false)throw Error('UI build ownership or mount proof mismatch');
 const contract=createUiDeploymentContract({patterns:navigation.patterns,mountPath:identity.mountPath});
 await assertUiFrameworkHtml(await readFile(resolve(root,'index.html'),'utf8'),actual,contract.mountPath);
 return Object.freeze({...raw,root,navigation:contract,publishedFiles:Object.freeze(actual.filter(file=>uiPublishedPath(file.path)).map(file=>file.path))});
}
