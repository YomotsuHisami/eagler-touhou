import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..');
async function walk(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]))).flat();}
const errors=[];
for(const path of await walk(resolve(root,'app'))){if(!/\.(?:ts|tsx)$/.test(path))continue;const text=await readFile(path,'utf8');const name=relative(root,path);
 if(/(?:history\s*\.\s*(?:pushState|replaceState|back|forward|go)|addEventListener\s*\(\s*['"]popstate)/.test(text))errors.push(`${name}: second browser-history owner`);
 if(/(?:from\s*['"][^'"]*launcher\/(?:app|lobby)\.m|import\s*\(\s*['"][^'"]*launcher\/(?:app|lobby)\.m)/.test(text))errors.push(`${name}: legacy application import`);
 if(name.startsWith('app/services/')&&/from\s*['"][^'"]*(?:\/routes\/|\/features\/|\/ui\/)/.test(text))errors.push(`${name}: business owner depends on presentation`);
 if(name!=='app/runtime/runtime-host.tsx'&&/<iframe\b/.test(text))errors.push(`${name}: Runtime iframe outside its single host`);
 if(/navigator\.serviceWorker\.register/.test(text))errors.push(`${name}: independent service worker registration`);
}
if(errors.length)throw Error(errors.join('\n'));console.log('UI ownership boundaries passed');
