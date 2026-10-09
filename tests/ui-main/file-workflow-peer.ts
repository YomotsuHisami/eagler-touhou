/** Synthetic file RPC peer, intentionally no renderer/WASM/game code. */
import type {} from './file-workflow-fixture';
const epoch=Number(new URL(location.href).searchParams.get('runtimeEpoch')),variant=new URL(location.href).searchParams.get('runtimeVariant')??'normal';
const owner=parent.__fileWorkflow,stored=owner.nativeFiles(variant),envelope={protocol:'eagler-touhou/1',game:'th06',epoch};
if(!Number.isSafeInteger(epoch)||epoch<1)throw Error('Synthetic peer requires a hosted epoch');
const globals=window as unknown as Record<string,unknown>;
globals.Module={};globals.FS={mkdirTree(){},writeFile(){}};
const transport={peers:new Map(),relay:{readyState:1},disconnected:false,recovering:false,isRecovering(){return this.recovering;}};
globals.__th06PeerTransport=transport;globals.__eaglerNetplayTransport='relay';globals.__eaglerNetplayPath='relay';
const emit=(value:Record<string,unknown>)=>parent.postMessage({...envelope,...value},location.origin);
owner.events.push(`ready:${variant}:${epoch}`);
window.addEventListener('message',async event=>{
  if(event.source!==parent||event.origin!==location.origin)return;const message=event.data;
  if(message?.syntheticAction==='exit'){emit({event:'exit',status:'success'});return;}
  if(message?.protocol!==envelope.protocol||message.game!=='th06'||message.epoch!==epoch||!message.request)return;
  owner.events.push(message.command+(message.path?`:${message.path}`:''));let result:Record<string,unknown>={};
  if(message.command==='sync'&&owner.consumeSyncFailure()){emit({request:message.request,ok:false,error:'Synthetic save failed'});return;}
  if(message.command==='configure'){await owner.waitConfigure();globals.Module={eaglerOptions:message.options};}
  if(message.command==='list')result={files:[...stored].map(([path,bytes])=>({path,size:bytes.length}))};
  if(message.command==='read'){if(!stored.has(message.path)){emit({request:message.request,ok:false,error:'Synthetic missing file',errno:44});return;}result={bytes:[...stored.get(message.path)!]};}
  if(message.command==='write')stored.set(message.path,[...message.bytes]);
  if(message.command==='remove')stored.delete(message.path);
  emit({request:message.request,ok:true,...result});
  if(message.command==='launch')emit({event:'first-frame'});
});
emit({event:'ready'});
window.addEventListener('pagehide',()=>{const module=globals.Module as {eaglerOptions?:{netplayMode?:string}};if(module.eaglerOptions?.netplayMode==='lan')owner.nativeExited();});
