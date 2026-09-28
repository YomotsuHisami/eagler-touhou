/** Score format and persisted-read contracts; no private fixtures are checked in.
 * Optional argv[2] is a directory containing the five user-supplied example DATs.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScoreDat, scoreDuration } from '../.cache/build/browser/assets/launcher/score-dat.mjs';
import { favoriteLoadout, readPersistedScore } from '../.cache/build/browser/assets/launcher/score-panel.mjs';
function block(tag,payload) {const b=Buffer.alloc(8+payload.length);b.write(tag);b.writeUInt16LE(b.length,4);payload.copy(b,8);return b;}
function encode6(body) {const b=Buffer.alloc(20+body.length);b.writeUInt32LE(20,8);b.writeUInt32LE(b.length,16);body.copy(b,20);b.writeUInt16LE(b.subarray(4).reduce((a,v)=>a+v,0)&65535,2);const out=Buffer.from(b);let key=0;for(let i=2;i<b.length;i++){key=(key+b[i-1])&255;key=((key>>5)|(key<<3))&255;out[i]=b[i]^key;}return out;}
const high=Buffer.alloc(20);high.writeUInt32LE(1,0);high.writeUInt32LE(98765430,4);high[8]=2;high[9]=1;high[10]=99;high.write('PLAYER',11);
const synthetic=encode6(Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),block('HSCR',high)]));
const before=Buffer.from(synthetic),report=parseScoreDat('th06',synthetic);
assert.equal(report.highest,98765430);assert.equal(report.sections[0].rows[0][0],'魔理沙 A');assert.deepEqual(synthetic,before,'reading must not mutate Buffer input');
assert.equal(favoriteLoadout(report),null,'rankings are not play counts');
for(const invalid of [synthetic.subarray(0,15),synthetic.subarray(0,-1),Buffer.alloc(100),new Uint8Array(2_000_001)])assert.throws(()=>parseScoreDat('th06',invalid));
assert.throws(()=>parseScoreDat('th07',synthetic));assert.throws(()=>parseScoreDat('th99',synthetic));
const corrupted=Buffer.from(synthetic);corrupted[30]^=128;assert.throws(()=>parseScoreDat('th06',corrupted),/校验/);
const tied={sections:[{title:'各机体游玩统计',rows:[['合计',9999],['灵梦 A',3],['魔理沙 A',3]]}]};
assert.deepEqual(favoriteLoadout(tied),{name:'灵梦 A',count:3,portraits:['reimu']},'ties use stable character order, excluding total');
assert.deepEqual(favoriteLoadout({sections:[{title:'各机体开局次数',rows:[['咏唱组','Easy',100],['结界组','合计',5],['咏唱组','合计',7]]}]}),{name:'咏唱组',count:7,portraits:['marisa','alice']},'use totals once, not double-counting per-difficulty values');
let closed=false,requestedPath;
const factory={open(root){assert.equal(root,'/savesth10');const req={};queueMicrotask(()=>{req.result={objectStoreNames:{contains:n=>n==='FILE_DATA'},close(){closed=true;},transaction(store,mode){assert.equal(store,'FILE_DATA');assert.equal(mode,'readonly');const tx={objectStore(){return{get(path){requestedPath=path;const read={};queueMicrotask(()=>{read.result={contents:new Uint8Array([4,5,6])};read.onsuccess();tx.oncomplete();});return read;}}}};return tx;}};req.onsuccess();});return req;}};
assert.deepEqual(await readPersistedScore('/savesth10','chs/scoreth10.dat',factory),new Uint8Array([4,5,6]));assert.equal(requestedPath,'/savesth10/chs/scoreth10.dat');assert.equal(closed,true);
let aborted=false;
const missing={open(){const req={transaction:{abort(){aborted=true;queueMicrotask(()=>req.onerror());}}};queueMicrotask(()=>req.onupgradeneeded());return req;}};
assert.equal(await readPersistedScore('/savesth06','score.dat',missing),null);assert.equal(aborted,true,'absent DB must not be created');
if(process.argv[2]) {
 const expected={6:[null,0,null],7:[436777350,118,'咲夜 A'],8:[null,0,'咏唱组'],9:[101716030,400,null],10:[730248680,350,'魔理沙 A']};
 for(let g=6;g<=10;g++) {
  const bytes=await readFile(`${process.argv[2]}/${String(g).padStart(2,'0')}.dat`),copy=Buffer.from(bytes),r=parseScoreDat(`th${String(g).padStart(2,'0')}`,bytes),e=expected[g];
  assert.deepEqual(bytes,copy);assert.equal(r.highest,e[0]);assert.equal(r.rankingCount,e[1]);assert.equal(favoriteLoadout(r)?.name??null,e[2]);
  assert.ok(r.sections.every(s=>!s.columns.some(c=>/符卡名称|敌人|符卡说明/.test(c))));
  const bad=Buffer.from(bytes);bad[g===10?0:Math.floor(bad.length/2)]^=128;assert.throws(()=>parseScoreDat(r.game,bad));
  if(g===7)assert.equal(r.sections.find(s=>s.title==='单关练习').rows[0][3],18567380);
  if(g===8)assert.equal(r.sections.find(s=>s.title==='通关与关卡进度').rows.length,65);
  if(g===10)assert.equal(r.sections.find(s=>s.title==='各机体游玩统计').rows[3][1],48);
 }
}
console.log('Score DAT parsing, corruption rejection, favorites, and read-only storage: PASS');

assert.equal(scoreDuration(0),"0 小时 0 分钟");
assert.equal(scoreDuration(3599),"0 小时 59 分钟");
assert.equal(scoreDuration(3600),"1 小时 0 分钟");
assert.equal(scoreDuration(90061),"25 小时 1 分钟");
