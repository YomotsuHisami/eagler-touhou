import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {PreparedRuntimeStart} from '../runtime/PreparedRuntimeStart';
import {MidiProvider, useMidi} from './MidiProvider';
import type {GameLaunchJobController} from '../services/game-launch-job.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
const Context = createContext<GameLaunchJobController | null>(null);
const none = () => () => {};
const empty = () => null;
export function useGameLaunchJob() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
/** Kept above all route/dialog subscribers. Page departure cancels acquisition;
 * route changes never dispose or replace the one Runtime host. */
export function GameLaunchProvider({children}: {children: ReactNode}) {
  return <MidiProvider><GameLaunchOwner>{children}</GameLaunchOwner></MidiProvider>;
}
function GameLaunchOwner({children}: {children: ReactNode}) {
  const fetchImpl = useDocumentRequestFetch();
  const {controller: midi} = useMidi();
  const midiRef = useRef(midi);
  const runtime = useRuntimeService();
  const [controller, setController] = useState<GameLaunchJobController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef(runtime), previous = useRef(runtime), epoch = useRef(0);
  const retained = useRef<ReturnType<typeof createPreparationDocumentOwner<GameLaunchJobController>> | null>(null);
  useLayoutEffect(() => {
    runtimeRef.current = runtime; midiRef.current = midi;
    const effect = ++epoch.current;
    const owner = retained.current ?? createPreparationDocumentOwner<GameLaunchJobController>({
      target: window, ready: () => runtimeRef.current !== null && midiRef.current !== null,
      load: async () => {
        const {createGameLaunchJobController} = await import('../services/game-launch-job.client');
        return () => {
          const current = runtimeRef.current;
          if (!current) throw new Error('Runtime 尚未就绪');
          let offlineStorage: Storage | null = null;
          try {offlineStorage = window.localStorage;} catch {}
          return createGameLaunchJobController({fetchImpl, offlineStorage,runtimeService: current, baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
            audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            midiAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            prepareMidi: signal => {if (!midiRef.current) throw new Error('MIDI service is not ready'); return midiRef.current.ensureReady(signal);}});
        };
      },
      onController: next => {setController(next); if (next) setError(null);},
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    retained.current = owner;
    if (previous.current !== runtime) {previous.current = runtime; owner.reset();}
    owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});
    };
  }, [runtime, midi]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">游戏准备服务不可用：{error}</p>}<GameLaunchNotice/><GameLaunchReady/><ProgressiveOggNotice/></Context.Provider>;
}
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function GameLaunchNotice() {
  const {controller, snapshot} = useGameLaunchJob();
  if (!snapshot?.preparing) return null;
  return <aside aria-label="后台游戏准备任务" className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status">{snapshot.selection?.productId.toUpperCase()} 准备中，切换窗口不会取消任务</p>
    <button type="button" className={button} onClick={() => controller?.cancel()}>取消准备与下载</button>
  </aside>;
}

function GameLaunchReady() {
  const {snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const warnings = snapshot?.preparedEpoch === live?.epoch ? snapshot?.warnings ?? [] : [];
  return <PreparedRuntimeStart warnings={warnings}/>;
}

function ProgressiveOggNotice() {
  const {controller,snapshot}=useGameLaunchJob(),live=useRuntimeSnapshot(),ogg=snapshot?.ogg;
  if(!ogg||ogg.epoch!==live?.epoch||!['installing','error'].includes(ogg.phase))return null;
  return <aside aria-label="后台音乐准备" className="fixed bottom-3 right-3 z-30 max-w-sm rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role={ogg.error?'alert':'status'}>{ogg.error??`OGG 音乐已准备 ${ogg.completed} / ${ogg.total} 首`}</p>
    {ogg.phase==='error'?<button type="button" className={button} onClick={()=>controller?.retryOgg()}>重试剩余音乐</button>:<button type="button" className={button} onClick={()=>controller?.cancelOgg()}>停止后台下载</button>}
  </aside>;
}
