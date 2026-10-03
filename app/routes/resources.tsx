import {useParams} from 'react-router';
import {useRef,useState,useSyncExternalStore} from 'react';
import {Button} from '../ui';
import {gameIdForProduct,isProductId} from '../../src/contracts/product-catalog.mts';
import {useBrowserServices} from '../services/browser-services';
import type {PackageTaskSnapshot} from '../services/package-tasks.client';
const emptyTasks:readonly PackageTaskSnapshot[]=Object.freeze([]);const emptySubscribe=()=>()=>{};
export default function Resources(){
 const{productId=''}=useParams();const services=useBrowserServices();const input=useRef<HTMLInputElement>(null);const[error,setError]=useState('');
 const tasks=useSyncExternalStore(services?.packageTasks.subscribe??emptySubscribe,()=>services?.packageTasks.getSnapshot()??emptyTasks,()=>emptyTasks);
 if(!isProductId(productId))throw new Response('Unknown product',{status:404});const game=gameIdForProduct(productId);
 async function install(file?:File){if(!services)return;setError('');try{const metadata=services.runtime.getSnapshot().metadata;const handle=file?services.packageTasks.startImport({game,file,expectedData:metadata.hostManifest?.games[game]?.gameData}):services.packageTasks.startPublished({game,catalog:metadata.releaseCatalog});await handle.done;}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
 return <section><p>关闭此窗口不会取消安装。只有点击取消，才停止可取消的任务。</p>
  <div><Button onClick={()=>void install()} disabled={!services}>安装 / 更新资源</Button> <Button onClick={()=>input.current?.click()} disabled={!services}>导入资源包</Button><input ref={input} hidden type="file" accept=".zip,.data" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void install(file);}}/></div>
  <ul>{tasks.filter(task=>task.game===game).map(task=><li key={task.id}><strong>{task.kind==='import'?'导入':'下载'} · {task.status}</strong><p>{task.phase}</p>{task.progress&&<pre>{JSON.stringify(task.progress)}</pre>}{task.error&&<p role="alert">{task.error}</p>}{task.status==='running'?<Button disabled={!task.cancellable} onClick={()=>services?.packageTasks.cancel(task.id)}>取消</Button>:<Button onClick={()=>services?.packageTasks.dismiss(task.id)}>清除记录</Button>}</li>)}</ul>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
