#!/usr/bin/env node
/** Restore omitted font inputs from an existing clone, otherwise pinned upstream. */
import {readFile,mkdir,copyFile,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const project=resolve(fileURLToPath(new URL('..',import.meta.url))),argv=process.argv.slice(2);
let from='';
for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--from='))from=argv[i].slice(7);else if(argv[i]==='--from')from=argv[++i];else throw Error('未知参数：'+argv[i]);}
const source=from?resolve(from):null;
const config=JSON.parse(await readFile(resolve(project,'config/local-fonts.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let copied=0,downloaded=0,existing=0;
for(const item of config.files){
  const target=resolve(project,item.path);
  try{const current=await readFile(target);if(digest(current)!==item.sha256)throw Error(`${item.path}: 已有文件不同，保留原文件并停止；请先核对改动`);existing++;continue;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let bytes;
  if(source){try{bytes=await readFile(resolve(source,item.path));}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(bytes){if(digest(bytes)!==item.sha256)throw Error(`旧目录中 ${item.path} 与基线不符，未覆盖目标文件`);copied++;}
  else{
    const url=`https://raw.githubusercontent.com/${config.upstream}/${config.revision}/${item.path}`;
    console.log('获取 '+item.path);
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`${item.path}: HTTP ${response.status}；可指定 --from=原项目路径 从现有克隆恢复`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(digest(bytes)!==item.sha256)throw Error(`${item.path}: SHA-256不匹配，未保存`);downloaded++;
  }
  await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
}
// Copy only locally supplied artwork, never saves, settings, source or credentials.
if(source){
  const artwork=['th06-card.webp','th07-card.webp','th08-card.webp','th09-card.webp','th10-card.webp','th06.ico','pwa/icon-192.png','pwa/icon-512.png','pwa/icon-maskable-512.png','pwa/apple-touch-icon.png'];
  for(const name of artwork){
    const target=resolve(project,'.cache/host-artwork',name);
    try{await stat(target);continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const dir of ['.cache/host-artwork','public/assets']){
      const path=resolve(source,dir,name);try{if(!(await stat(path)).isFile())continue;}catch{continue;}
      await mkdir(dirname(target),{recursive:true});await copyFile(path,target);break;
    }
  }
}
console.log(`字体输入已就绪：原有 ${existing} / 本地复制 ${copied} / 获取 ${downloaded}；不会重新下载已核对的文件。`);
