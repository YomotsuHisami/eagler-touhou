#!/usr/bin/env node
/** Import user-obtained DAIRI PNGs locally. Never fetch, stage, or publish artwork. */
import { readdir, readFile, mkdir, copyFile, writeFile, lstat, rename } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CHARACTER_ART, CHARACTER_ART_IDS, CHARACTER_ART_SCHEMA } from '../lib/contracts/character-art.mjs';
const args = new Map();
for (let i=2;i<process.argv.length;i++) {
  const value=process.argv[i], eq=value.indexOf('=');
  if(value==='--dry-run'||value==='--require-all'){args.set(value.slice(2),true);continue;}
  if(!value.startsWith('--'))throw Error('使用 --from=解压目录 [--map=映射.json] [--dry-run]');
  args.set(value.slice(2,eq<0?undefined:eq),eq<0?process.argv[++i]:value.slice(eq+1));
}
for(const key of args.keys())if(!['from','map','dry-run','require-all'].includes(key))throw Error('未知参数：'+key);
if(!args.get('from'))throw Error('请先从作者主页获取素材并解压，然后指定 --from=解压目录。详见 docs/DAIRI_ART.md');
const source=resolve(args.get('from')), project=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(!(await lstat(source)).isDirectory())throw Error('--from 必须是已解压的文件夹，不是 ZIP');
const destination=resolve(project,'private-assets/dairi');
const files=[];
async function walk(dir,depth=0){
  if(depth>12)throw Error('素材目录层级超过12，请指定更具体的子目录');
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const path=resolve(dir,entry.name);
    if(path===destination)continue;
    if(entry.isDirectory())await walk(path,depth+1);
    else if(entry.isFile()&&extname(entry.name).toLowerCase()==='.png')files.push(path);
    if(files.length>20000)throw Error('PNG超过20000张，请指定更小的素材目录');
  }
}
await walk(source);
const explicit=args.get('map')?JSON.parse(await readFile(resolve(args.get('map')),'utf8')):{};
for(const key of Object.keys(explicit))if(!CHARACTER_ART_IDS.includes(key))throw Error('未知映射角色：'+key);
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[\s・·_\-]/g,'');
const plan=[],missing=[],conflicts=[];
for(const id of CHARACTER_ART_IDS){
  const names=[id,CHARACTER_ART[id].name,...CHARACTER_ART[id].aliases].map(norm);
  let matches=files.filter(file=>names.includes(norm(basename(file,extname(file)))));
  if(explicit[id]){
    const path=resolve(source,explicit[id]);
    if(!path.startsWith(source+sep)||!files.includes(path))throw Error(`${id}: 映射必须指向素材目录内的真实 PNG（不接受符号链接）`);
    matches=[path];
  }
  if(!matches.length){missing.push(id);continue;}
  if(matches.length>1){conflicts.push(`${id}: ${matches.map(file=>relative(source,file)).join(', ')}`);continue;}
  const bytes=await readFile(matches[0]);
  if(bytes.length<33||bytes.length>32*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error(`${id}: 不是有效 PNG 文件`);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>16000||height>16000||width*height>64*1024*1024)throw Error(`${id}: 图片尺寸不合理`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  plan.push({id,path:matches[0],sha256,width,height});
}
console.log(`可导入 ${plan.length}/${CHARACTER_ART_IDS.length} 个角色`);
for(const item of plan)console.log(`${item.id} ← ${relative(source,item.path)}`);
if(missing.length)console.log('尚缺：'+missing.join(', '));
if(conflicts.length)throw Error('同一角色有多张候选，未写入任何图片。请用 --map 指定：\n'+conflicts.join('\n'));
if(args.has('require-all')&&missing.length)throw Error('要求全角色，但素材不全；未写入任何图片');
if(args.has('dry-run'))process.exit(0);
if(!plan.length)throw Error('没有识别到图片。可按 docs/DAIRI_ART.md 的英文名称命名，或使用 --map');
await mkdir(destination,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const hash=file=>readFile(file).then(bytes=>createHash('sha256').update(bytes).digest('hex')).catch(error=>{if(error.code==='ENOENT')return '';throw error;});
for(const item of plan){
  const target=resolve(destination,`${item.id}.png`), old=await hash(target);
  if(old===item.sha256)continue;
  if(old){const backup=resolve(project,'.cache/character-art-backups',stamp,`${item.id}.png`);await mkdir(dirname(backup),{recursive:true});await copyFile(target,backup);}
  const temp=target+'.tmp';await copyFile(item.path,temp);await rename(temp,target);
}
const installed=[];
for(const id of CHARACTER_ART_IDS)if(await hash(resolve(destination,`${id}.png`)))installed.push(id);
const manifest={schema:CHARACTER_ART_SCHEMA,artist:'DAIRI / はるか',source:'https://dairi.fanbox.cc/',usage:'local-only; do not redistribute',characters:installed};
await writeFile(resolve(destination,'manifest.json.tmp'),JSON.stringify(manifest,null,2)+'\n');
await rename(resolve(destination,'manifest.json.tmp'),resolve(destination,'manifest.json'));
console.log(`已导入：${installed.length}。浏览器 Ctrl+Shift+R 刷新。图片在 private-assets/dairi/，不会进入 Git 或发布清单。`);
