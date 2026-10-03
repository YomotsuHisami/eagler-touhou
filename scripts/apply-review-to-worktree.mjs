#!/usr/bin/env node
/** Copy reviewed changes to a clean baseline worktree; never commit or push. */
import {readFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const project=resolve(fileURLToPath(new URL('..',import.meta.url))),argv=process.argv.slice(2);
const targetArg=argv.find(a=>a.startsWith('--target='));
if(!targetArg||argv.some(a=>a!==targetArg&&!['--apply','--dry-run'].includes(a)))throw Error('用法：node scripts/apply-review-to-worktree.mjs --target=干净工作树 [--dry-run | --apply]');
const target=resolve(targetArg.slice(9));
if(target===project)throw Error('不能把源码包覆盖到自身；请先新建 PR worktree');
const git=(...args)=>execFileSync('git',['-C',target,...args],{encoding:'utf8'}).trim();
if(resolve(git('rev-parse','--show-toplevel'))!==target)throw Error('--target 必须是仓库根目录');
const metadata=JSON.parse(await readFile(resolve(project,'SOURCE-BASE.json'),'utf8'));
if(git('rev-parse','HEAD')!==metadata.baseCommit)throw Error('目标不是本包的基线提交；请按 docs/FRONTEND-PR.md 建立独立工作树，不要覆盖更新版本');
if(git('status','--porcelain','--untracked-files=all'))throw Error('目标有未提交内容，未覆盖任何文件；请使用新建且干净的工作树');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileDigest(path){try{return digest(await readFile(path));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
for(const item of metadata.changes){
  if(!item.path||item.path.split('/').some(part=>!part||part==='.'||part==='..')||item.path.includes('\\'))throw Error('无效的文件清单路径');
  const source=resolve(project,item.path),dest=resolve(target,item.path);
  if(!source.startsWith(project+sep)||!dest.startsWith(target+sep))throw Error('路径越界');
  if(await fileDigest(source)!==item.afterSha256)throw Error('源码包文件已变更：'+item.path+'；请手动审查，不自动覆盖');
  if(await fileDigest(dest)!==item.beforeSha256)throw Error('目标文件与基线不一致：'+item.path);
  console.log(item.path);
}
console.log(`核对完成：${metadata.changes.length} 个变更文件。`);
if(!argv.includes('--apply')){console.log('仅检查，未写入。加 --apply 才会复制，不会提交或推送。');process.exit(0);}
for(const item of metadata.changes){const dest=resolve(target,item.path);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(project,item.path),dest);}
await copyFile(resolve(project,'SOURCE-BASE.json'),resolve(target,'SOURCE-BASE.json'));
console.log('已复制到独立工作树。接下来 git diff --check / git diff 审查；未提交、未推送。');
