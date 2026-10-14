/** Score acceptance uses synthetic DATs/IDBFS and mounted DOM; no private saves. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let api, React, createRoot, work, env, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive:true}); work = await mkdtemp(resolve(project, '.cache/score-acceptance-'));
  const output = resolve(work,'score.mjs');
  await build({absWorkingDir:project, stdin:{resolveDir:project,loader:'tsx',contents:`
    export * from './app/services/score-storage.ts';
    export * from './app/models/score-statistics.ts';
    export * from './src/launcher/score-dat.mts';
    export * from './app/components/launcher/ScorePanel.tsx';
    export * from './app/components/launcher/products.ts';
    export * from './app/i18n.tsx';
  `},outfile:output,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(output).href);
});
afterEach(async () => {if(root){await React.act(async()=>root.unmount());root=null;} env.document.body.replaceChildren(); assert.equal(env.errors.length,0);});
after(async()=>{env.close();await rm(work,{recursive:true,force:true});});
const tick = () => new Promise(resolve=>setImmediate(resolve));
const settled = async model => {for(let i=0;i<40&&model.getSnapshot().phase==='loading';i++)await tick();};
function block(tag,payload){const b=Buffer.alloc(8+payload.length);b.write(tag);b.writeUInt16LE(b.length,4);payload.copy(b,8);return b;}
function literals(bytes){const out=[];let current=0,bits=0;const bit=b=>{current=(current<<1)|b;if(++bits===8){out.push(current);current=bits=0;}};for(const b of bytes){bit(1);for(let i=7;i>=0;i--)bit((b>>i)&1);}if(bits)out.push(current<<(8-bits));return Buffer.from(out);}
function outerCipher(bytes,key,step,block,limit){const out=Buffer.from(bytes);let size=bytes.length,extra=size%block;if(extra>=block/4)extra=0;extra+=size%2;size-=extra;let pos=0;while(size>0&&limit>0){block=Math.min(block,size);let i=0;for(let j=0;j<2;j++)for(let dst=block-j-1;dst>=0;dst-=2){out[pos+i++]=bytes[pos+dst]^key;key=(key+step)&255;}pos+=block;size-=block;limit-=block;}return out;}
function encode(game,body){
  if(game===10){const compressed=literals(body), b=Buffer.alloc(24+compressed.length);b.write('TH10');b.writeUInt32LE(b.length,4);b.writeUInt32LE(body.length,20);outerCipher(compressed,0xac,0x35,16,compressed.length).copy(b,24);return b;}
  const encoded=game===6?body:literals(body), plain=Buffer.alloc(20+encoded.length);plain.writeUInt32LE(20,8);plain.writeUInt32LE(20+body.length,game===9?12:16);encoded.copy(plain,20);plain.writeUInt16LE(plain.subarray(4).reduce((n,b)=>n+b,0)&65535,2);
  const out=Buffer.from(plain);let key=0;for(let i=2;i<plain.length;i++){key=(key+plain[i-1])&255;key=((key>>5)|(key<<3))&255;out[i]=plain[i]^key;}
  return game===8?outerCipher(out,0x59,0x79,256,3072):game===9?outerCipher(out,0x3a,0xcd,256,3072):out;
}
function score6(name='PLAYER'){const payload=Buffer.alloc(20);payload.writeUInt32LE(1);payload.writeUInt32LE(98765430,4);payload[8]=2;payload[9]=1;payload[10]=99;payload.write(name,11,9,'ascii');return encode(6,Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),block('HSCR',payload)]));}
function plays(game,character,count){const nc=game===7?6:12,payload=Buffer.alloc(game===7?352:536);payload.writeUInt32LE(count,36+6*(nc+5)*4+4+character*4);return encode(game,Buffer.concat([block(`TH${game}K`,Buffer.from([16,0,0,0])),block('PLST',payload)]));}
function score9(){return encode(9,Buffer.concat([block('TH9K',Buffer.from([16,0,0,0])),block('PLST',Buffer.alloc(500))]));}
function score10(){const payload=Buffer.alloc(17264);payload.writeUInt32LE(9875,4);payload.writeUInt32LE(14,1204);const body=Buffer.alloc(12+payload.length);body.write('CR');body.writeUInt32LE(body.length,8);payload.copy(body,12);body.writeUInt32LE(body.subarray(8).reduce((sum,b)=>sum+b,0),4);return encode(10,body);}
function clearBlock(game,character,clean,allRuns=[]){const payload=Buffer.alloc(game===8?28:game===7?20:16),n=game===7?6:5;
 for(let d=0;d<n;d++){if(game===8){payload.writeUInt16LE(clean[d]??0,4+d*2);payload.writeUInt16LE(allRuns[d]??0,14+d*2);}else{payload[4+d]=clean[d]??0;payload[4+n+d]=allRuns[d]??0;}}
 if(game===8)payload[25]=character;else if(game===6)payload.writeUInt16LE(character,14);else payload.writeUInt32LE(character,16);
 return block('CLRD',payload);
}
function score10Block(character,frames,difficulty,count=1){const payload=Buffer.alloc(17264);payload.writeUInt32LE(character,0);payload.writeUInt32LE(frames,1208);if(difficulty!==undefined)payload.writeUInt32LE(count,1212+difficulty*4);
 const body=Buffer.alloc(12+payload.length);body.write('CR');body.writeUInt32LE(body.length,8);payload.copy(body,12);body.writeUInt32LE(body.subarray(8).reduce((sum,b)=>sum+b,0),4);return body;
}
const stored = (bytes,edition=null,modified=0) => ({bytes,edition,modified});
async function seed(factory,root,records,store='FILE_DATA'){
 const db=await new Promise((resolve,reject)=>{const q=factory.open(root,21);q.onupgradeneeded=()=>q.result.createObjectStore(store);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');for(const [path,contents,timestamp]of records)tx.objectStore(store).put({contents,timestamp:timestamp??new Date(0)},path);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
}

test('reused decoder checks TH06–TH10 data, bounds and immutable input',()=>{
 for(const [game,bytes]of [['th06',score6()],['th07',plays(7,5,9)],['th08',plays(8,1,17)],['th09',score9()],['th10',score10()]]){const original=Buffer.from(bytes),report=api.parseScoreDat(game,bytes);assert.equal(report.game,game);assert.deepEqual(bytes,original);assert.throws(()=>api.parseScoreDat(game,bytes.subarray(0,-1)));}
 assert.equal(api.parseScoreDat('th06',score6()).highest,98765430);assert.equal(api.favoriteLoadout(api.parseScoreDat('th06',score6())),null);
 assert.deepEqual(api.favoriteLoadout(api.parseScoreDat('th08',plays(8,1,17))),{name:'咏唱组',count:17,portraits:['marisa','alice']});
 assert.equal(api.favoriteLoadout(api.parseScoreDat('th07',plays(7,5,9))).name,'咲夜 B');
 assert.equal(api.parseScoreDat('th10',score10()).highest,98750);
 assert.equal(api.parseScoreDat('th09',score9()).sections.find(s=>s.title==='通关次数').rows.length,80);
 assert.equal(api.favoriteLoadout(api.parseScoreDat('th09',score9())),null);
 assert.throws(()=>api.parseScoreDat('th07',score6()));assert.throws(()=>api.parseScoreDat('th06',new Uint8Array(2_000_001)));
 const broken=score6();broken[28]^=128;assert.throws(()=>api.parseScoreDat('th06',broken),/校验/);
});
test('favorites retain stable ties, exclude totals and never add difficulty counts twice',()=>{
 const report={sections:[{title:'各机体开局次数',rows:[['结界组','Easy',99],['结界组','合计',7],['咏唱组','合计',7]]}]};
 assert.equal(api.favoriteLoadout(report).name,'结界组');
 assert.equal(api.favoriteLoadout({sections:[{title:'各机体游玩统计',rows:[['合计',100],['灵梦 A',0]]}]}),null);
});
function coverageReport(game,coverage,rows=[]){return {game,clears:api.scoreDifficulties.map((_,row)=>coverage.map(count=>row<count)),sections:rows.length?[{title:'通关次数',rows}]:[]};}
test('featured loadouts preserve genuine play frequency even when every loadout has cleared every difficulty',()=>{
 const report=api.parseScoreDat('th08',plays(8,1,17));report.clears=report.clears.map(row=>row.map(()=>true));
 assert.deepEqual(api.featuredLoadout(report),{name:'咏唱组',count:17,portraits:['marisa','alice'],basis:'plays'});
});
test('featured loadouts use actual TH09/TH10 clear counters when play counts are absent',()=>{
 const payload=Buffer.alloc(500);payload.writeUInt32LE(8,116+3*24+1*4);payload.writeUInt32LE(2,116+4*24);payload.writeUInt32LE(2,116+4*24+1*4);
 const nine=api.parseScoreDat('th09',encode(9,Buffer.concat([block('TH9K',Buffer.from([16,0,0,0])),block('PLST',payload)])));
 assert.equal(api.favoriteLoadout(nine),null);assert.deepEqual(api.featuredLoadout(nine),{name:'妖梦',count:8,portraits:['youmu'],basis:'clears'});
 const ten=api.parseScoreDat('th10',encode(10,Buffer.concat([score10Block(0,0,1,5),score10Block(1,0,2,2),score10Block(6,0,1,999)])));
 assert.equal(api.favoriteLoadout(ten),null);assert.equal(api.featuredLoadout(ten).name,'灵梦 A');assert.equal(api.featuredLoadout(ten).count,5);assert.equal(api.featuredLoadout(ten).basis,'clears');
});
test('clear fallback excludes totals, unknown/practice difficulties and repeated saved counters',()=>{
 const report=coverageReport('th06',[2,1,0,0],[['灵梦 A','Easy',2],['灵梦 A','Normal',3],['灵梦 A','Normal',3],['灵梦 B','Normal',4],['合计','Normal',999],['未知机体','Normal',999],['魔理沙 A','练习',999],['魔理沙 B','Phantasm',999],['魔理沙 A','Easy',Infinity],['魔理沙 B','Extra',-1]]),copy=structuredClone(report);
 assert.deepEqual(api.featuredLoadout(report),{name:'灵梦 A',count:5,basis:'clears',portraits:['reimu']});assert.deepEqual(report,copy);
});
test('coverage fallback needs a unique leader; tied, absent and uniformly comprehensive clears do not choose a loadout',()=>{
 assert.deepEqual(api.featuredLoadout(coverageReport('th06',[1,3,0,2])),{name:'灵梦 B',count:3,basis:'difficulties',portraits:['reimu']});
 assert.equal(api.featuredLoadout(coverageReport('th06',[3,3,0,0])),null);
 assert.equal(api.featuredLoadout(coverageReport('th06',[0,0,0,0])),null);
 assert.equal(api.featuredLoadout(coverageReport('th06',[4,4,4,4])),null);
 assert.equal(api.featuredLoadout(coverageReport('th06',[5,5,5,5],[['灵梦 A','Easy',30],['灵梦 B','Easy',1]])),null);
 const tiedCounts=coverageReport('th06',[1,2,0,0],[['灵梦 A','Easy',5],['灵梦 B','Easy',3],['灵梦 B','Normal',2]]);
 assert.deepEqual(api.featuredLoadout(tiedCounts),{name:'灵梦 B',count:2,basis:'difficulties',portraits:['reimu']});
 tiedCounts.clears[1][0]=true;assert.equal(api.featuredLoadout(tiedCounts),null,'equally strong counters and coverage cannot select an arbitrary first loadout');
 assert.equal(api.featuredLoadout(coverageReport('th11',[])),null);
});
test('clear matrix uses explicit story clears and excludes practice, unlocks, aggregate rows and ranking defaults',()=>{
 const ranking=api.parseScoreDat('th06',score6());assert.equal(ranking.clears[1][2],true);assert.equal(ranking.clears.flat().filter(Boolean).length,1);assert.equal(ranking.playSeconds,null);
 const header=g=>block(`TH${g}K`,Buffer.from([16,0,0,0]));
 const seven=api.parseScoreDat('th07',encode(7,Buffer.concat([header(7),clearBlock(7,0,[0,99,0,0,99,99],[99,0,99]),clearBlock(7,6,[99,99,99,99,99])])));
 assert.equal(seven.clears.length,5);assert.equal(seven.clears[1][0],true);assert.equal(seven.clears[4][0],true);assert.equal(seven.clears.flat().filter(Boolean).length,4);
 assert.equal(seven.clearKinds[0][0],'continued');assert.equal(seven.clearKinds[1][0],'no-continue');
 const defaultRank=Buffer.alloc(40);defaultRank.writeUInt32LE(1000000,4);defaultRank[12]=0;defaultRank[13]=1;defaultRank[14]=99;defaultRank.write('Nanashi',15);
 for(const records of [[block('HSCR',defaultRank),clearBlock(7,0,[0,5])],[clearBlock(7,0,[0,5]),block('HSCR',defaultRank)]]){
 const saved=api.parseScoreDat('th07',encode(7,Buffer.concat([header(7),...records])));assert.equal(saved.clears[1][0],false,'dedicated story progress is authoritative regardless of block order');
 }
 const eight=api.parseScoreDat('th08',encode(8,Buffer.concat([header(8),clearBlock(8,1,[0x80,0x8000,0,0,0],[0x8000,0,0x8000]),clearBlock(8,12,[0xffff,0xffff,0xffff,0xffff,0xffff])])));
 assert.equal(eight.clearKinds[0][1],'continued');assert.equal(eight.clearKinds[1][1],'no-continue');assert.equal(eight.clearKinds[2][1],'continued');assert.equal(eight.clears.flat().filter(Boolean).length,3);
 const access=api.parseScoreDat('th08',encode(8,Buffer.concat([header(8),clearBlock(8,1,[0x80])]))) ;assert.equal(access.clears[0][1],false,'ordinary Final B access is not completion');
 const ninePayload=Buffer.alloc(500);ninePayload.writeUInt32LE(2,116+3*24+2*4);
 const nine=api.parseScoreDat('th09',encode(9,Buffer.concat([header(9),block('PLST',ninePayload)])));assert.equal(nine.clears[2][3],true);assert.equal(nine.clears.flat().filter(Boolean).length,1);assert.equal(nine.playSeconds,null);
});
test('TH06/TH07 keep continued clears yellow and no-continue clears green independently of chapter order',()=>{
 for(const game of [6,7]){
  const entries=[clearBlock(game,0,[5,99],[99,99]),clearBlock(game,1,[0,0],[0,99])];
  for(const records of [entries,[...entries].reverse()]){
   const bytes=encode(game,Buffer.concat([block(`TH${game}K`,Buffer.from([16,0,0,0])),...records])),copy=Buffer.from(bytes),report=api.parseScoreDat(`th0${game}`,bytes);
   assert.equal(report.clearKinds[0][0],'continued');assert.equal(report.clearKinds[1][0],'no-continue');assert.equal(report.clearKinds[1][1],'continued');assert.equal(report.clearKinds[0][1],'none');assert.equal(report.clears[0][0],true);assert.deepEqual(bytes,copy);
   assert.deepEqual(report.sections.find(s=>s.title==='通关与关卡进度').columns,['机体','难度','无续关','含续关']);
  }
 }
});
test('TH08 treats both ending routes as clears and distinguishes continue arrays from stage access and practice',()=>{
 const practice=Buffer.alloc(368);practice.writeUInt32LE(99,4);practice[364]=0;
 const report=api.parseScoreDat('th08',encode(8,Buffer.concat([block('TH8K',Buffer.from([16,0,0,0])),clearBlock(8,0,[0x4000,0x8000,0x80,0,0x8000],[0xc000,0xc000,0xc000]),block('PSCR',practice)])));
 assert.deepEqual(report.clearKinds.map(row=>row[0]),['no-continue','no-continue','continued','none','no-continue']);
 assert.equal(report.clears[3][0],false);assert.equal(report.sections.find(s=>s.title==='单关练习').rows.length,45);
});
test('ranking fallback uses actual continue bytes and TH06 score units, with no-continue taking precedence',()=>{
 for(const game of [6,7,8]){
  const high=continues=>{const b=Buffer.alloc(game===6?20:game===7?40:352);b.writeUInt32LE(1234567*(game===6?10:1)+(game===6?continues:0),4);b[game===6?8:12]=0;b[game===6?9:13]=1;b[game===6?10:14]=99;b.write('PLAYER',game===6?11:15);if(game!==6)b.writeUInt16LE(continues,30);return block('HSCR',b);};
  const read=records=>api.parseScoreDat(`th0${game}`,encode(game,Buffer.concat([block(`TH${game}K`,Buffer.from([16,0,0,0])),...records])));
  assert.equal(read([high(2)]).clearKinds[1][0],'continued');
  for(const records of [[high(2),high(0)],[high(0),high(2)]])assert.equal(read(records).clearKinds[1][0],'no-continue');
 }
});
test('TH09 aggregate counts never borrow continues from an unrelated ranking',()=>{
 const counts=Buffer.alloc(500);counts.writeUInt32LE(2,116+1*4);counts.writeUInt32LE(1,116+4*4);
 const high=Buffer.alloc(36);high.writeUInt32LE(999,4);high[12]=0;high[13]=1;high[35]=2;
 for(const records of [[block('PLST',counts),block('HSCR',high)],[block('HSCR',high),block('PLST',counts)]]){
  const report=api.parseScoreDat('th09',encode(9,Buffer.concat([block('TH9K',Buffer.from([16,0,0,0])),...records])));
  assert.equal(report.clearKinds[1][0],'unknown');assert.equal(report.clearKinds[4][0],'no-continue');assert.equal(report.clears[1][0],true);
 }
});
test('TH10 reads continues only from completed rankings and retains unclassified aggregate history',()=>{
 const chunk=(rows,count=0)=>{const bytes=score10Block(0,0,1,count);for(let i=0;i<rows.length;i++){const o=12+4+(10+i)*24;bytes[o+4]=rows[i].stage;bytes[o+5]=rows[i].continues;}bytes.writeUInt32LE(bytes.subarray(8).reduce((sum,b)=>sum+b,0),4);return bytes;};
 const read=bytes=>api.parseScoreDat('th10',encode(10,bytes));
 assert.equal(read(chunk([{stage:8,continues:2}])).clearKinds[1][0],'continued','zero aggregate cannot negate a saved continued clear');
 assert.equal(read(chunk([{stage:8,continues:0}])).clearKinds[1][0],'no-continue');
 for(const rows of [[{stage:8,continues:2},{stage:8,continues:0}],[{stage:8,continues:0},{stage:8,continues:2}]])assert.equal(read(chunk(rows,2)).clearKinds[1][0],'no-continue');
 assert.equal(read(chunk([{stage:6,continues:0}],1)).clearKinds[1][0],'unknown','a failed no-continue run cannot classify a different aggregate clear');
 assert.equal(read(chunk([{stage:6,continues:2}])).clearKinds[1][0],'none','a continued loss is not a continued clear');
});
test('play duration reads gameplay time and keeps TH10 aggregate frames separate from loadout totals',()=>{
 for(const game of [7,8]){const payload=Buffer.alloc(game===7?352:536);payload.writeUInt32LE(999,4);payload.writeUInt32LE(1,20);payload.writeUInt32LE(2,24);payload.writeUInt32LE(3,28);
 const bytes=encode(game,Buffer.concat([block(`TH${game}K`,Buffer.from([16,0,0,0])),block('PLST',payload)])),copy=Buffer.from(bytes);
 assert.equal(api.parseScoreDat('th'+game,bytes).playSeconds,3723);assert.deepEqual(bytes,copy);
 }
 const individual=[score10Block(0,3600*60,1),score10Block(1,7200*60,2)];
 const withoutTotal=api.parseScoreDat('th10',encode(10,Buffer.concat(individual)));assert.equal(withoutTotal.playSeconds,10800);assert.equal(withoutTotal.clears.flat().filter(Boolean).length,2);
 const withTotal=api.parseScoreDat('th10',encode(10,Buffer.concat([...individual,score10Block(6,10000*60,0)])));assert.equal(withTotal.playSeconds,10000,'saved total is not added to loadout frames');assert.equal(withTotal.clears.flat().filter(Boolean).length,2,'aggregate clear does not mark a loadout');
 assert.equal(api.parseScoreDat('th10',encode(10,Buffer.concat([...individual,score10Block(6,0)]))).playSeconds,10800,'an all-zero saved total does not hide loadout frames');
});
test('cold reads neither create absent databases nor modify existing IDBFS bytes/version',async()=>{
 const factory=new IDBFactory();assert.equal(await api.readStoredScore('th06','ja',factory),null);assert.deepEqual(await factory.databases(),[]);
 assert.equal(await api.readStoredScore('th07','ja',{open:factory.open.bind(factory)}),null);assert.deepEqual(await factory.databases(),[]);
 const bytes=score6();await seed(factory,'/savesth06',[['/savesth06/score.dat',bytes]]);const modes=[];
 const watched={databases:factory.databases.bind(factory),open(name){const q=factory.open(name);q.addEventListener('success',()=>{const db=q.result,transaction=db.transaction.bind(db);db.transaction=(stores,mode)=>{modes.push(mode);return transaction(stores,mode);};});return q;}};
 const value=await api.readStoredScore('th06','ja',watched);assert.deepEqual(value.bytes,new Uint8Array(bytes));assert.deepEqual(modes,['readonly']);assert.deepEqual(await factory.databases(),[{name:'/savesth06',version:21}]);
});
test('TH10 reads its two known edition paths and labels latest durable edition, with preference ties',async()=>{
 const factory=new IDBFactory();await seed(factory,'/savesth10',[['/savesth10/chs/scoreth10.dat',new Uint8Array([1]),new Date(1000)],['/savesth10/jp/scoreth10.dat',new Uint8Array([2]),new Date(2000)]]);
 const result=await api.readStoredScore('th10','lang_zh-hans',factory);assert.equal(result.edition,'jp');assert.deepEqual(result.bytes,new Uint8Array([2]));
 await seed(factory,'/savesth10',[['/savesth10/chs/scoreth10.dat',new Uint8Array([3]),new Date(2000)]]);assert.equal((await api.readStoredScore('th10','lang_zh-hans',factory)).edition,'chs');
 const exact=await api.readStoredScore('th10','ja',factory,8000,'chs');assert.equal(exact.edition,'chs');assert.deepEqual(exact.bytes,new Uint8Array([3]));
});
test('native signed-byte buffers and sliced views preserve their exact binary representation',async()=>{
 const factory=new IDBFactory();
 await seed(factory,'/savesth06',[['/savesth06/score.dat',new Int8Array([-1,0,127,-128])]]);
 assert.deepEqual((await api.readStoredScore('th06','ja',factory)).bytes,new Uint8Array([255,0,127,128]));
 await seed(factory,'/savesth06',[['/savesth06/score.dat',new DataView(new Uint8Array([9,8,7,6]).buffer,1,2)]]);
 assert.deepEqual((await api.readStoredScore('th06','ja',factory)).bytes,new Uint8Array([8,7]));
});
test('unsupported products and multiplayer do not open solo saves',async()=>{
 let opens=0;const factory={open(){opens++;throw Error('Unexpected save access');}};
 for(const productof of ['th06mp','th10mp','th11','th15','th20'])assert.equal(await api.readStoredScore(productof,'ja',factory),null);
 assert.equal(opens,0);
});
test('read errors, invalid records and timeouts stay distinct from no save, and late connections close',async()=>{
 const factory=new IDBFactory();await seed(factory,'/savesth06',[], 'OTHER');await assert.rejects(api.readStoredScore('th06','ja',factory),/layout/);
 const large=new IDBFactory();await seed(large,'/savesth06',[['/savesth06/score.dat',new Uint8Array(2_000_001)]]);await assert.rejects(api.readStoredScore('th06','ja',large),/Invalid/);
 let request,closed=0;const blocked={open(){return request={};}};
 await assert.rejects(api.readStoredScore('th06','ja',blocked,10),/timed out/);request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);
});
test('selection fences late reads and clear/dispose stop publication',async()=>{
 const pending=new Map();const model=api.createScoreStatistics({read:product=>new Promise(resolve=>pending.set(product,resolve))});
 model.select('th06','ja');model.select('th08','ja');pending.get('th08')(stored(plays(8,1,17)));await settled(model);pending.get('th06')(stored(score6()));await tick();
 assert.equal(model.getSnapshot().product,'th08');assert.equal(model.getSnapshot().favorite.count,17);
 model.clear('th06');assert.equal(model.getSnapshot().product,'th08');model.clear('th08');assert.equal(model.getSnapshot().phase,'idle');model.dispose();
});
test('refreshes after suspended work, retaining bytes as read-only data and surfacing parse/storage failures',async()=>{
 let reads=0,value=stored(score6());const model=api.createScoreStatistics({read:async()=>{reads++;return value;}});
 model.suspend(true);model.select('th06','ja');assert.equal(reads,0);model.suspend(false);await settled(model);assert.equal(model.getSnapshot().phase,'ready');
 value=null;model.invalidate('th07');assert.equal(reads,1);await model.refresh();assert.equal(model.getSnapshot().phase,'empty');
 value=stored(new Uint8Array([0]));await model.refresh();assert.equal(model.getSnapshot().phase,'unreadable');
 model.select('th11','ja');assert.equal(model.getSnapshot().phase,'unsupported');model.dispose();
 const bad=api.createScoreStatistics({read:async()=>{throw Error('blocked');}});bad.select('th06','ja');await settled(bad);assert.equal(bad.getSnapshot().phase,'unavailable');bad.dispose();
});
async function mount(model,product='th08',locale='zh-CN'){
 const target=env.document.createElement('main');env.document.body.append(target);root=createRoot(target);
 const p=api.createLibraryProducts([product],path=>'http://stats.local/'+path,id=>'/?game='+id)[0];
 await React.act(async()=>{root.render(React.createElement(api.LocaleProvider,{locale},React.createElement(api.ScorePanel,{model,product:p,language:'ja',assetUrl:path=>'http://stats.local/'+path})));await tick();});
}
for(const locale of ['zh-CN','en'])test(`matrix exposes separate continued/no-continue statuses and leaves empty cells unclassified: ${locale}`,async()=>{
 const data=encode(6,Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),clearBlock(6,0,[0,99],[99,99])]));
 const model=api.createScoreStatistics({read:async()=>stored(data)});await mount(model,'th06',locale);
 const matrix=env.document.querySelector('.clear-matrix'),continued=matrix.querySelector('td[data-clear-kind=continued]'),clean=matrix.querySelector('td[data-clear-kind=no-continue]');
 assert.ok(continued);assert.ok(clean);assert.equal(continued.dataset.cleared,'true');assert.equal(clean.dataset.cleared,'true');assert.equal(matrix.querySelectorAll('td[data-clear-kind=none]').length,18);
 assert.ok(continued.title.includes(locale==='en'?'with continues':'续关通关'));assert.ok(clean.title.includes(locale==='en'?'without continues':'无续关通关'));
 await React.act(async()=>continued.focus());assert.equal(continued.dataset.hovered,'true');assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,8);model.dispose();
});
test('aggregate-only TH09 history keeps the original plain cleared label without extra messages',async()=>{
 const p=Buffer.alloc(500);p.writeUInt32LE(2,116+4);const bytes=encode(9,Buffer.concat([block('TH9K',Buffer.from([16,0,0,0])),block('PLST',p)]));
 const model=api.createScoreStatistics({read:async()=>stored(bytes)});await mount(model,'th09');
 const unknown=env.document.querySelector('td[data-clear-kind=unknown]');assert.ok(unknown);assert.equal(unknown.dataset.cleared,'true');assert.equal(unknown.title,'灵梦 · Normal · 已通关');assert.equal(env.document.querySelector('td[data-clear-kind=no-continue]'),null);model.dispose();
});
test('actual panel renders the compact game summary, TH08 pair and named missing-art states',async()=>{
 const model=api.createScoreStatistics({read:async()=>stored(plays(8,1,17))});await mount(model);
 assert.equal(env.document.querySelectorAll('.score-character img').length,2);assert.deepEqual([...env.document.querySelectorAll('[data-character]')].map(n=>n.dataset.character),['marisa','alice']);
 assert.equal(env.document.querySelector('#gameTitle').textContent,'東方永夜抄');assert.equal(env.document.querySelector('.score-metrics').children.length,3);
 assert.ok(env.document.querySelector('.score-metrics').textContent.includes('17'));assert.equal(env.document.querySelector('.score-section'),null);assert.equal(env.document.querySelector('#scoreRefresh'),null);assert.equal(env.document.querySelector('.score-source'),null);
 await React.act(async()=>env.document.querySelector('.score-character img').dispatchEvent(new env.window.Event('error')));
 assert.equal(env.document.querySelector('.character-art-placeholder').textContent.includes('立绘暂不可用'),true);model.dispose();
});
test('actual English summary labels coverage separately from plays and removes artwork for uniformly cleared saves',async()=>{
 let bytes=score6('<script>');const model=api.createScoreStatistics({read:async()=>stored(bytes)});await mount(model,'th06','en');
 assert.equal(env.document.querySelectorAll('.score-character').length,1);assert.equal(env.document.querySelector('.score-character').getAttribute('aria-label'),'Widest clear coverage');assert.equal(env.document.querySelectorAll('script').length,0);assert.equal(env.document.querySelector('.score-section'),null);
 assert.equal(env.document.querySelector('.score-featured').dataset.basis,'difficulties');assert.equal(env.document.querySelector('.score-featured strong').textContent,'Marisa A · 1 difficulty');assert.equal(model.getSnapshot().favorite,null,'display fallback is not published as play frequency');
 bytes=encode(6,Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),...Array.from({length:4},(_,c)=>clearBlock(6,c,[99,99,99,99,99]))]));
 await React.act(async()=>model.refresh());assert.equal(env.document.querySelector('.score-featured strong').textContent,'—');assert.equal(env.document.querySelector('.score-character'),null);model.dispose();
});
test('actual clear-count summary names the evidence instead of labelling clears as plays',async()=>{
 const bytes=encode(10,Buffer.concat([score10Block(0,0,1,5),score10Block(1,0,2,2)])),model=api.createScoreStatistics({read:async()=>stored(bytes)});await mount(model,'th10','en');
 assert.equal(env.document.querySelector('.score-featured').dataset.basis,'clears');assert.equal(env.document.querySelector('.score-featured>span').textContent,'Most-cleared loadout');assert.equal(env.document.querySelector('.score-featured strong').textContent,'Reimu A · 5 clears');assert.equal(env.document.querySelector('.score-character').getAttribute('aria-label'),'Most-cleared loadout');model.dispose();
});
test('empty and unsupported games do not invent default character artwork',async()=>{
 const model=api.createScoreStatistics({read:async()=>null});await mount(model,'th06');assert.equal(env.document.querySelector('.score-character'),null);
 await mount(model,'th11');assert.equal(env.document.querySelector('.score-character'),null);assert.equal(env.document.querySelector('.score-featured strong').textContent,'—');model.dispose();
});
test('matrix renders loadouts as columns and five difficulty rows with green states and row/column focus highlighting',async()=>{
 const model=api.createScoreStatistics({read:async()=>stored(score6())});await mount(model,'th06');
 const matrix=env.document.querySelector('.clear-matrix'),headers=[...matrix.querySelectorAll('thead th')].slice(1).map(e=>e.textContent);
 assert.deepEqual(headers,['梦A','梦B','魔A','魔B']);assert.deepEqual([...matrix.querySelectorAll('tbody th')].map(e=>e.textContent),['Easy','Normal','Hard','Lunatic','Extra']);
 assert.equal(matrix.querySelector('.clear-matrix-corner').textContent,'');assert.equal(matrix.querySelector('.clear-matrix-corner').getAttribute('aria-label'),'难度');
 assert.equal(matrix.querySelectorAll('td[data-cleared=true]').length,1);assert.ok(matrix.querySelector('td[data-cleared=true]').getAttribute('aria-label').includes('Normal'));
 const media=globalThis.matchMedia;globalThis.matchMedia=query=>({...media(query),matches:query.includes('(hover:hover)')});
 try{
   const cell=matrix.querySelector('tbody tr:nth-child(3) td');
   await React.act(async()=>cell.dispatchEvent(new env.window.PointerEvent('pointerover',{bubbles:true,pointerType:'touch'})));
   assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,0,'touch does not produce hover highlighting');
   await React.act(async()=>cell.dispatchEvent(new env.window.PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'})));
   assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,8,'mouse entry highlights its entire row and column without focus');
   await React.act(async()=>cell.dispatchEvent(new env.window.PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:env.document.body})));
   assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,0);
 }finally{globalThis.matchMedia=media;}
 await React.act(async()=>matrix.querySelector('td[data-cleared=true]').focus());
 assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,8);assert.equal(matrix.querySelectorAll('th[data-highlight=true]').length,2);
 assert.equal(env.document.querySelector('.score-playtime'),null,'missing duration has no visible placeholder');model.dispose();
});
test('matrix names highlight just their own column or row, while cell entry restores both axes',async()=>{
 const model=api.createScoreStatistics({read:async()=>stored(score6())});await mount(model,'th06');
 const matrix=env.document.querySelector('.clear-matrix'),column=matrix.querySelector('thead th:nth-child(3)'),row=matrix.querySelector('tbody tr:nth-child(2) th'),cell=matrix.querySelector('tbody tr:nth-child(3) td');
 const media=globalThis.matchMedia;globalThis.matchMedia=query=>({...media(query),matches:query.includes('(hover:hover)')});
 const enter=async(element,pointerType='mouse')=>React.act(async()=>element.dispatchEvent(new env.window.PointerEvent('pointerover',{bubbles:true,pointerType})));
 const leave=async(element,target=matrix)=>React.act(async()=>element.dispatchEvent(new env.window.PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:target})));
 try{
   await enter(column,'touch');assert.equal(matrix.querySelectorAll('[data-highlight=true]').length,0,'touch movement does not impersonate a mouse');
   await enter(column);assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,5);assert.equal(matrix.querySelectorAll('thead th[data-highlight=true]').length,1);assert.equal(matrix.querySelectorAll('tbody th[data-highlight=true]').length,0);assert.equal(matrix.querySelectorAll('td[data-hovered=true]').length,0);
   await leave(column);assert.equal(matrix.querySelectorAll('[data-highlight=true]').length,0,'moving off the name clears a header-only hover');
   await enter(row);assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,4);assert.equal(matrix.querySelectorAll('thead th[data-highlight=true]').length,0);assert.equal(matrix.querySelectorAll('tbody th[data-highlight=true]').length,1);
   await leave(row,cell);await enter(cell);assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,8);assert.equal(matrix.querySelectorAll('th[data-highlight=true]').length,2);assert.equal(matrix.querySelectorAll('td[data-hovered=true]').length,1);
   await leave(cell,env.document.body);assert.equal(matrix.querySelectorAll('[data-highlight=true]').length,0);
 }finally{globalThis.matchMedia=media;}
 await React.act(async()=>column.focus());assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,5);assert.equal(matrix.querySelectorAll('tbody th[data-highlight=true]').length,0);
 await React.act(async()=>row.focus());assert.equal(matrix.querySelectorAll('td[data-highlight=true]').length,4);assert.equal(matrix.querySelectorAll('thead th[data-highlight=true]').length,0);model.dispose();
});
test('play-time text separates larger numbers from units and keeps a recorded zero distinct from missing time',async()=>{
 let bytes=plays(7,0,1);const model=api.createScoreStatistics({read:async()=>stored(bytes)});await mount(model,'th07');
 assert.equal(env.document.querySelector('.score-playtime').textContent,'游戏时长：0时0分');
 const content=env.document.querySelector('.score-content');
 assert.equal(env.document.querySelector('.score-playtime').parentElement,content,'duration remains below the matrix stage in the shared content area');
 assert.equal(env.document.querySelector('.score-character').parentElement,content,'artwork shares the content bottom instead of centering in the matrix stage');
 assert.equal(env.document.querySelector('.score-stage .score-character'),null);
 assert.deepEqual([...env.document.querySelectorAll('.score-time-number')].map(e=>e.textContent),['0','0']);
 assert.deepEqual([...env.document.querySelectorAll('.score-time-unit')].map(e=>e.textContent),['时','分']);
 const payload=Buffer.alloc(352);payload.writeUInt32LE(46,20);payload.writeUInt32LE(57,24);payload.writeUInt32LE(59,28);
 bytes=encode(7,Buffer.concat([block('TH7K',Buffer.from([16,0,0,0])),block('PLST',payload)]));
 await React.act(async()=>model.refresh());
 assert.equal(env.document.querySelector('.score-playtime').textContent,'游戏时长：46时57分');
 assert.equal(env.document.querySelector('.score-playtime time').dateTime,'PT169079S');
 bytes=encode(7,block('TH7K',Buffer.from([16,0,0,0])));await React.act(async()=>model.refresh());
 assert.equal(env.document.querySelector('.score-playtime'),null,'changing to a save without time removes prior duration');model.dispose();
});
test('touch reveals all matrix columns until an outside interaction, while movement and mouse presses do not latch reveal',async()=>{
 const model=api.createScoreStatistics({read:async()=>stored(score9())});await mount(model,'th09');
 const wrap=env.document.querySelector('.clear-matrix-wrap'),cells=wrap.querySelectorAll('td'),outside=env.document.querySelector('#gameTitle');
 assert.equal(cells.length,api.scoreLoadouts('th09').length*5);
 assert.equal(wrap.dataset.revealed,'false');
 await React.act(async()=>cells[0].dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})));
 assert.equal(wrap.dataset.revealed,'false','mouse reveal belongs to proximity, not a latched press');
 await React.act(async()=>cells[0].dispatchEvent(new env.window.PointerEvent('pointerover',{bubbles:true,pointerType:'touch'})));
 assert.equal(wrap.dataset.revealed,'false','scrolling over the matrix does not reveal it');
 await React.act(async()=>cells[0].dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})));
 assert.equal(wrap.dataset.revealed,'false','a press awaiting scroll/tap resolution does not latch reveal');
 await React.act(async()=>cells[0].dispatchEvent(new env.window.PointerEvent('pointercancel',{bubbles:true,pointerType:'touch'})));
 await React.act(async()=>cells[0].dispatchEvent(new env.window.MouseEvent('click',{bubbles:true})));
 assert.equal(wrap.dataset.revealed,'false','a cancelled scrolling gesture is not a tap');
 await React.act(async()=>{
   cells[0].dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
   cells[0].dispatchEvent(new env.window.MouseEvent('click',{bubbles:true}));
 });
 assert.equal(wrap.dataset.revealed,'true');
 await React.act(async()=>{
   cells[cells.length-1].dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
   cells[cells.length-1].dispatchEvent(new env.window.MouseEvent('click',{bubbles:true}));
 });
 assert.equal(wrap.dataset.revealed,'true','a second cell is still inside the matrix');
 await React.act(async()=>outside.dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})));
 assert.equal(wrap.dataset.revealed,'false');
 await React.act(async()=>{
   cells[0].dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true,pointerType:'pen'}));
   cells[0].dispatchEvent(new env.window.MouseEvent('click',{bubbles:true}));
 });
 assert.equal(wrap.dataset.revealed,'true');
 await React.act(async()=>outside.dispatchEvent(new env.window.FocusEvent('focusin',{bubbles:true})));
 assert.equal(wrap.dataset.revealed,'false','keyboard departure also clears a latched touch reveal');model.dispose();
});
