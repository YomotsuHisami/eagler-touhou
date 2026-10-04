import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import type {createSampleJobController} from '../services/sample-job.client';
type Controller = ReturnType<typeof createSampleJobController>;
const Context = createContext<Controller | null>(null);
const none = () => () => {};
const empty = () => null;
interface SampleDocumentOwnerOptions {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  ready?: () => boolean;
  load: () => Promise<() => Controller>;
  onController(controller: Controller | null): void;
  onError(error: unknown): void;
}
/** React unmount cleanup is not a document-navigation boundary. A lazy module
 * may resolve after pagehide, when WebKit already forbids new fetches. Fence
 * controller creation there, and create a fresh job owner after BFCache return.
 * Detach/attach alone preserves the owner for React's effect replay.
 */
export function createSamplePreparationDocumentOwner(options: SampleDocumentOwnerOptions) {
  // This is the one document-active state, established before Runtime exists.
  // Effect detach/attach must not turn a departed document active again.
  let attached=false, active=true, disposed=false, serial=0;
  let controller: Controller | null=null;
  let loading: Promise<() => Controller> | null=null;
  function activate() {
    if(disposed || !attached || !active || options.ready?.()===false) return;
    if(controller){options.onController(controller);return;}
    const ticket=++serial;
    const task=loading ?? (loading=Promise.resolve().then(options.load));
    void task.then(create=>{
      if(disposed || !attached || !active || options.ready?.()===false || ticket!==serial) return;
      controller=create();options.onController(controller);
    }).catch(error=>{
      if(loading===task) loading=null;
      if(!disposed && attached && active && ticket===serial) options.onError(error);
    });
  }
  const hide=()=>{
    active=false;serial++;
    controller?.dispose();controller=null;options.onController(null);
  };
  const show=()=>{active=true;activate();};
  function detach() {
    if(!attached) return;
    attached=false;serial++;
    options.target.removeEventListener('pagehide',hide);
    options.target.removeEventListener('pageshow',show);
  }
  return Object.freeze({
    attach() {
      if(disposed || attached) return;
      attached=true;
      options.target.addEventListener('pagehide',hide);
      options.target.addEventListener('pageshow',show);
      activate();
    },
    detach,
    reset() {
      if(disposed) return;
      serial++;controller?.dispose();controller=null;options.onController(null);activate();
    },
    dispose() {
      if(disposed) return;
      disposed=true;detach();controller?.dispose();controller=null;
    },
  });
}
function useJob() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller,snapshot};
}
/** This provider survives window/route unsubscription; the plain TS job owns work. */
export function SamplePreparationProvider({children}: {children: ReactNode}) {
  const runtime = useRuntimeService();
  const [controller,setController] = useState<Controller | null>(null);
  const [error,setError] = useState<string | null>(null);
  const runtimeRef=useRef(runtime);
  const previousRuntime=useRef(runtime);
  const retained = useRef<ReturnType<typeof createSamplePreparationDocumentOwner> | null>(null);
  const epoch = useRef(0);
  useLayoutEffect(() => {
    runtimeRef.current=runtime; // Async factories see only the committed owner.
    const effect = ++epoch.current;
    // Attach at commit, unconditionally: Runtime's own lazy import may still
    // be pending when pagehide fires. The retained owner remembers departure.
    const owner=retained.current ?? createSamplePreparationDocumentOwner({
      target:window,
      ready:()=>runtimeRef.current!==null,
      load:async()=>{
        const {createSampleJobController}=await import('../services/sample-job.client');
        return ()=>{
          const current=runtimeRef.current;
          if(!current) throw new Error('Runtime 尚未就绪');
          return createSampleJobController({runtimeService:current,baseUrl:new URL(import.meta.env.BASE_URL,location.origin).href});
        };
      },
      onController:next=>{setController(next);if(next)setError(null);},
      onError:reason=>setError(reason instanceof Error?reason.message:String(reason)),
    });
    retained.current=owner;
    if(previousRuntime.current!==runtime){previousRuntime.current=runtime;owner.reset();}
    owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(()=>{if(epoch.current===effect){owner.dispose();if(retained.current===owner)retained.current=null;}});
    };
  },[runtime]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">资源准备服务不可用：{error}</p>}<PreparationNotice/></Context.Provider>;
}
const button='min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function StartPrepared() {
  const {snapshot} = useJob(), service=useRuntimeService(), live=useRuntimeSnapshot();
  const ready=!!snapshot?.preparedEpoch && live?.epoch===snapshot.preparedEpoch && live.phase==='prepared';
  if(!ready) return null;
  return <button type="button" className={button} onClick={()=>{
    const actual=service?.getSnapshot();
    if(actual?.phase==='prepared' && actual.epoch===snapshot?.preparedEpoch) {
      // launch() reports failures through the retained Runtime snapshot/controls.
      void service!.launch().catch(()=>{});
    }
  }}>启动 TH06 验证</button>;
}
function PreparationNotice() {
  const {controller,snapshot}=useJob(), live=useRuntimeSnapshot();
  const ready=!!snapshot?.preparedEpoch && snapshot.preparedEpoch===live?.epoch && live.phase==='prepared';
  if(!snapshot?.preparing && !ready) return null;
  return <aside aria-label="后台 TH06 准备任务" className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status">{ready?'TH06 验证资源已准备，尚未启动':'TH06 资源准备中，切换窗口不会取消任务'}</p>
    {snapshot.preparing && <button type="button" className={button} onClick={()=>controller?.cancel()}>取消准备与下载</button>}
    <StartPrepared/>
  </aside>;
}
export function SamplePreparation() {
  const {controller,snapshot}=useJob(), live=useRuntimeSnapshot();
  useEffect(()=>{if(controller && !controller.getSnapshot().inspection) void controller.inspect().catch(()=>{});},[controller]);
  const active=!!live && (live.epoch!==null || live.ready || live.launched || !!live.saveError);
  return <section aria-label="TH06 原版验证" className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="font-bold">TH06 原版验证</h2>
    <p className="text-sm text-muted">此验收入口固定日文、无音乐、键盘，暂不应用上方设置。它不是完整游戏接入验收；先准备资源，再明确点击启动。</p>
    {!controller || snapshot?.inspecting ? <p role="status">正在检查本地部署资源…</p> : <p role="status">{snapshot?.inspection?.available?'已找到此入口声明的资源，准备时仍会校验完整数据。':snapshot?.inspection?.reason?.message ?? '尚未检查资源。'}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!controller || snapshot?.inspecting || snapshot?.preparing} onClick={()=>void controller?.inspect().catch(()=>{})}>重新检查</button>
      <button type="button" className={button} disabled={!controller || !snapshot?.inspection?.available || snapshot.preparing || active} onClick={()=>void controller?.prepare().catch(()=>{})}>准备验证资源</button>
    </div>
    {snapshot?.progress && <p className="text-xs text-muted">已处理 {snapshot.progress.completed} / {snapshot.progress.total} 项资源</p>}
    {snapshot?.error && <p role="alert" className="text-sm text-accent">{snapshot.error}</p>}
    {live?.error && <p role="alert" className="text-sm text-accent">{live.error}</p>}
    <p className="text-xs text-muted">源码仓库不含原版游戏数据或完整 Runtime。缺少匹配的外置资源时不会启动游戏。</p>
  </section>;
}
