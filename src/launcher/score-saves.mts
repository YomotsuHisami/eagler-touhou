import { parseScoreDat } from './score-dat.mjs';
export interface ScoreSave { id: string; product: string; game: string; name: string; updated: number; bytes: Uint8Array }
export interface ScoreSaveState { product: string; id: string; pending: boolean }
const databaseName='eagler-touhou-score-slots-v1';
async function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const q=indexedDB.open(databaseName,1);q.onupgradeneeded=()=>{q.result.createObjectStore('saves',{keyPath:'id'}).createIndex('product','product');q.result.createObjectStore('active',{keyPath:'product'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('存档列表正在升级，请关闭其他页面后重试'));});}
async function transaction<T>(stores:string[],mode:IDBTransactionMode,work:(tx:IDBTransaction,done:(value:T)=>void)=>void):Promise<T>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let value:T;tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||Error('存档列表操作失败'));};try{work(tx,v=>value=v);}catch(error){tx.abort();reject(error);}});}
export function listScoreSaves(product:string){return transaction<ScoreSave[]>(['saves'],'readonly',(tx,done)=>{const q=tx.objectStore('saves').index('product').getAll(product);q.onsuccess=()=>done(q.result.sort((a:ScoreSave,b:ScoreSave)=>b.updated-a.updated));});}
export function activeScoreSave(product:string){return transaction<{state:ScoreSaveState;save:ScoreSave}|null>(['saves','active'],'readonly',(tx,done)=>{const q=tx.objectStore('active').get(product);q.onsuccess=()=>{if(!q.result){done(null);return;}const state=q.result as ScoreSaveState,r=tx.objectStore('saves').get(state.id);r.onsuccess=()=>done(r.result?{state,save:r.result}:null);};});}
async function storeScoreSave(product:string,game:string,name:string,bytes:Uint8Array){const save:ScoreSave={id:crypto.randomUUID(),product,game,name,updated:Date.now(),bytes:new Uint8Array(bytes)};return transaction<ScoreSave>(['saves'],'readwrite',(tx,done)=>{tx.objectStore('saves').put(save);done(save);});}
export async function addScoreSave(product:string,game:string,name:string,bytes:Uint8Array){parseScoreDat(game,bytes);return storeScoreSave(product,game,name,bytes);}
export async function chooseScoreSave(product:string,id:string|null){return transaction<void>(['saves','active'],'readwrite',(tx,done)=>{const active=tx.objectStore('active');if(id==null){active.delete(product);done();return;}const q=tx.objectStore('saves').get(id);q.onsuccess=()=>{if(!q.result||q.result.product!==product){tx.abort();return;}active.put({product,id,pending:true});done();};});}
export async function updateActiveScoreSave(product:string,bytes:Uint8Array){const current=await activeScoreSave(product);if(!current||current.state.pending)return;parseScoreDat(current.save.game,bytes);return transaction<void>(['saves','active'],'readwrite',(tx,done)=>{const q=tx.objectStore('active').get(product);q.onsuccess=()=>{if(q.result?.id===current.save.id&&!q.result.pending)tx.objectStore('saves').put({...current.save,bytes:new Uint8Array(bytes),updated:Date.now()});done();};});}
export function markScoreSaveApplied(product:string,id:string){return transaction<void>(['active'],'readwrite',(tx,done)=>{const q=tx.objectStore('active').get(product);q.onsuccess=()=>{if(q.result?.id===id)tx.objectStore('active').put({...q.result,pending:false});done();};});}
/** Runtime retains ownership of save writes; selection is applied before launch,
 * not by directly mutating the Runtime's IDBFS database. */
export async function applyPendingScoreSave(product:string,bridge:{read:()=>Promise<Uint8Array|null>;write:(bytes:Uint8Array)=>Promise<void>;sync:()=>Promise<void>}){
 const selected=await activeScoreSave(product);if(!selected?.state.pending)return;
 parseScoreDat(selected.save.game,selected.save.bytes);
 const previous=await bridge.read();
 if(previous?.length)await storeScoreSave(product,selected.save.game,'切换前自动备份 · '+new Date().toLocaleString(),previous);
 await bridge.write(selected.save.bytes);await bridge.sync();
 const verified=await bridge.read();
 if(!verified||verified.length!==selected.save.bytes.length||verified.some((v,i)=>v!==selected.save.bytes[i]))throw Error('所选存档写入校验失败，游戏尚未启动');
 await markScoreSaveApplied(product,selected.save.id);
}
