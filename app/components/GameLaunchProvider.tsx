import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import type {GameLaunchJobController} from '../services/game-launch-job.client';
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
  const runtime = useRuntimeService();
  const [controller, setController] = useState<GameLaunchJobController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef(runtime), previous = useRef(runtime), epoch = useRef(0);
  const retained = useRef<ReturnType<typeof createPreparationDocumentOwner<GameLaunchJobController>> | null>(null);
  useLayoutEffect(() => {
    runtimeRef.current = runtime;
    const effect = ++epoch.current;
    const owner = retained.current ?? createPreparationDocumentOwner<GameLaunchJobController>({
      target: window, ready: () => runtimeRef.current !== null,
      load: async () => {
        const {createGameLaunchJobController} = await import('../services/game-launch-job.client');
        return () => {
          const current = runtimeRef.current;
          if (!current) throw new Error('Runtime 尚未就绪');
          return createGameLaunchJobController({runtimeService: current, baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
            audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window});
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
  }, [runtime]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">游戏准备服务不可用：{error}</p>}<GameLaunchNotice/></Context.Provider>;
}
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function StartPreparedGame() {
  const {snapshot} = useGameLaunchJob(), service = useRuntimeService(), live = useRuntimeSnapshot();
  const ready = snapshot?.preparedEpoch != null && live?.epoch === snapshot.preparedEpoch && live.phase === 'prepared';
  if (!ready) return null;
  return <button type="button" className={button} disabled={!!live.fileOperationBusy} onClick={() => {
    const actual = service?.getSnapshot();
    if (actual?.phase === 'prepared' && actual.epoch === snapshot.preparedEpoch && !actual.fileOperationBusy) void service!.launch().catch(() => {});
  }}>启动 {snapshot.selection?.productId.toUpperCase()}</button>;
}
function GameLaunchNotice() {
  const {controller, snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const ready = snapshot?.preparedEpoch != null && snapshot.preparedEpoch === live?.epoch && live.phase === 'prepared';
  if (!snapshot?.preparing && !ready) return null;
  return <aside aria-label="后台游戏准备任务" className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status">{snapshot.selection?.productId.toUpperCase()} {ready ? '已准备，等待启动' : '准备中，切换窗口不会取消任务'}</p>
    <button type="button" className={button} onClick={() => controller?.cancel()}>{ready ? '取消本次启动' : '取消准备与下载'}</button>
    <StartPreparedGame/>
  </aside>;
}
