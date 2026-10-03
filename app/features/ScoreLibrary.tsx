import {useEffect,useState,useRef} from 'react';
import {listScoreSaves,addScoreSave,activeScoreSave,chooseScoreSave,type ScoreSave} from '../../src/launcher/score-saves.mts';
import {gameIdForProduct,type ProductId} from '../../src/contracts/product-catalog.mts';
import {Button} from '../ui';
/** Same slot store as the existing launcher. Runtime remains the only IDBFS writer. */
export function ScoreLibrary({productId}:{productId:ProductId}){
 const [items,setItems]=useState<ScoreSave[]>([]),[active,setActive]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{let current=true;void Promise.all([listScoreSaves(productId),activeScoreSave(productId)]).then(([rows,picked])=>{if(current){setItems(rows);setActive(picked?.state.id??null);}}).catch(reason=>{if(current)setError(String(reason));});return()=>{current=false;};},[productId,revision]);
 async function importFiles(files:File[]){setBusy(true);setError('');try{for(const file of files){if(file.size>2_000_000)throw Error('DAT 文件超过 2 MB');await addScoreSave(productId,gameIdForProduct(productId),file.name,new Uint8Array(await file.arrayBuffer()));}setRevision(v=>v+1);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}
 async function choose(id:string|null){setBusy(true);setError('');try{await chooseScoreSave(productId,id);setRevision(v=>v+1);}catch(reason){setError(String(reason));}finally{setBusy(false);}}
 function download(save:ScoreSave){const blob=new Blob([new Uint8Array(save.bytes)]);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=save.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section aria-label="存档库"><p>选择的存档将在下次启动前应用，并保留切换前备份。</p><input ref={input} hidden type="file" accept=".dat" multiple onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void importFiles(files);}}/><Button disabled={busy} onClick={()=>input.current?.click()}>添加 DAT 存档</Button><ul>{items.map(item=><li key={item.id}><strong>{item.name}</strong> <time>{new Date(item.updated).toLocaleString()}</time> <Button disabled={busy||active===item.id} onClick={()=>void choose(item.id)}>{active===item.id?'已选择':'使用'}</Button> <Button onClick={()=>download(item)}>导出</Button></li>)}</ul>{items.length===0&&<p>尚无存档</p>}{active&&<Button disabled={busy} onClick={()=>void choose(null)}>使用当前游戏存档</Button>}{error&&<p role="alert">{error}</p>}</section>;
}
