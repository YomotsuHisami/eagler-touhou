/** Local portrait pipeline, using synthetic PNGs only (no redistributed artwork). */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {CHARACTER_ART_IDS,TH09_CHARACTER_ART,characterArtForName} from '../lib/contracts/character-art.mjs';
assert.equal(CHARACTER_ART_IDS.length,20);assert.equal(new Set(TH09_CHARACTER_ART).size,16);
assert.deepEqual(characterArtForName('结界组'),['reimu','yukari']);
assert.deepEqual(characterArtForName('灵梦 A'),['reimu']);assert.deepEqual(characterArtForName('魔理沙B'),['marisa']);
assert.deepEqual(characterArtForName('四季映姬'),['eiki']);assert.deepEqual(characterArtForName('未知角色'),[]);
const dir=await mkdtemp(resolve(tmpdir(),'eagler-character-art-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
try{
  const project=resolve(dir,'project'),source=resolve(dir,'input');
  await mkdir(resolve(project,'scripts'),{recursive:true});await mkdir(resolve(project,'lib/contracts'),{recursive:true});await mkdir(source);
  await cp(new URL('../scripts/import-character-art.mjs',import.meta.url),resolve(project,'scripts/import-character-art.mjs'));
  await cp(new URL('../.cache/build/browser/assets/contracts/character-art.mjs',import.meta.url),resolve(project,'lib/contracts/character-art.mjs'));
  for(const id of CHARACTER_ART_IDS)await writeFile(resolve(source,id+'.png'),png);
  const run=(...args)=>spawnSync(process.execPath,[resolve(project,'scripts/import-character-art.mjs'),`--from=${source}`,...args],{encoding:'utf8'});
  let result=run('--dry-run','--require-all');assert.equal(result.status,0,result.stderr);
  await assert.rejects(readFile(resolve(project,'private-assets/dairi/manifest.json')),/ENOENT/);
  result=run('--require-all');assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(await readFile(resolve(project,'private-assets/dairi/manifest.json'),'utf8'));
  assert.deepEqual(manifest.characters,CHARACTER_ART_IDS);
  for(const id of CHARACTER_ART_IDS)assert.deepEqual(await readFile(resolve(project,'private-assets/dairi',id+'.png')),png);
  result=run('--require-all');assert.equal(result.status,0,'idempotent import');
  await writeFile(resolve(source,'灵梦.png'),png);result=run();assert.notEqual(result.status,0,'ambiguous art must require mapping');
  assert.match(result.stderr,/多张候选/);
  await writeFile(resolve(dir,'mapping.json'),JSON.stringify({reimu:'reimu.png'}));
  result=run(`--map=${resolve(dir,'mapping.json')}`);assert.equal(result.status,0,result.stderr);
  await writeFile(resolve(dir,'mapping.json'),JSON.stringify({reimu:'../../outside.png'}));
  result=run(`--map=${resolve(dir,'mapping.json')}`);assert.notEqual(result.status,0,'outside path rejected');
  await writeFile(resolve(source,'marisa.png'),'not an image');
  result=run();assert.notEqual(result.status,0,'non-PNG rejected');
  console.log(JSON.stringify({characterArt:'PASS',characters:20,th09:16,teams:'PASS',dryRun:true,import:true,idempotency:true,ambiguousMapping:true,traversalRejected:true,source:'synthetic PNG fixtures only'}));
}finally{await rm(dir,{recursive:true,force:true});}
