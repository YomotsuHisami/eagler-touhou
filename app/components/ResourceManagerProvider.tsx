import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {ResourceManagerController} from '../services/resources.client';
import type {PreferencesContextSource} from '../services/preferences.client';

const Context = createContext<ResourceManagerController | null>(null);
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';

/** One document owner survives route changes and StrictMode effect replay.
 * pagehide fences a pending import; pageshow creates a fresh owner after BFCache.
 */
export function createResourceDocumentOwner(options: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  load(): Promise<() => ResourceManagerController>;
  onController(controller: ResourceManagerController | null): void;
  onError(error: unknown): void;
}) {
  let attached = false, active = true, disposed = false, serial = 0;
  let controller: ResourceManagerController | null = null;
  let loading: Promise<() => ResourceManagerController> | null = null;
  function activate() {
    if (!attached || !active || disposed) return;
    if (controller) { options.onController(controller); return; }
    const ticket = ++serial;
    const task = loading ?? (loading = Promise.resolve().then(options.load));
    void task.then(create => {
      if (!attached || !active || disposed || ticket !== serial) return;
      controller = create(); options.onController(controller);
    }).catch(error => {
      if (loading === task) loading = null;
      if (attached && active && !disposed && ticket === serial) options.onError(error);
    });
  }
  const hide = () => { active = false; serial++; controller?.dispose(); controller = null; options.onController(null); };
  const show = () => { active = true; activate(); };
  function detach() {
    if (!attached) return;
    attached = false; serial++;
    options.target.removeEventListener('pagehide', hide); options.target.removeEventListener('pageshow', show);
  }
  return Object.freeze({
    attach() {
      if (attached || disposed) return;
      attached = true;
      options.target.addEventListener('pagehide', hide); options.target.addEventListener('pageshow', show); activate();
    },
    detach,
    dispose() { if (disposed) return; disposed = true; detach(); controller?.dispose(); controller = null; },
  });
}

export function ResourceManagerProvider({children}: {children: ReactNode}) {
  const [controller, setController] = useState<ResourceManagerController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<ReturnType<typeof createResourceDocumentOwner> | null>(null);
  const epoch = useRef(0);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createResourceDocumentOwner({
      target: window,
      load: async () => {
        const {createResourceManager} = await import('../services/resources.client');
        return () => createResourceManager({baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
          audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window});
      },
      onController: next => { setController(next); if (next) setError(null); },
      onError: failure => setError(failure instanceof Error ? failure.message : String(failure)),
    });
    retained.current = owner; owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(() => { if (epoch.current === effect) { owner.dispose(); if (retained.current === owner) retained.current = null; } });
    };
  }, []);
  return <Context.Provider value={controller}>{children}{error && <p role="alert" className="p-3 text-accent">资源服务不可用：{error}</p>}<ResourceJobNotice/></Context.Provider>;
}

export function useResourceManager() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}

export function useResourcePreferences(): PreferencesContextSource {
  const {snapshot} = useResourceManager();
  const preferences = snapshot?.preferences;
  return useCallback(game => preferences?.[game] ?? {uiLocale: 'zh-CN'}, [preferences]);
}

/** Starts a read-only inspection when a product first needs real metadata. */
export function useResourceInspection(productId: ProductId) {
  const {controller, snapshot} = useResourceManager();
  const attempted = useRef<{controller: ResourceManagerController; productId: ProductId} | null>(null);
  const gameId = gameIdForProduct(productId);
  useEffect(() => {
    if (!controller || snapshot?.operation || snapshot?.inspections[gameId] ||
        attempted.current?.controller === controller && attempted.current.productId === productId) return;
    attempted.current = {controller, productId};
    void controller.inspect(productId).catch(() => {});
  }, [controller, productId, gameId, snapshot?.operation, snapshot?.inspections]);
  return {controller, snapshot, inspection: snapshot?.inspections[gameId] ?? null,
    error: snapshot?.errors[gameId] ?? null};
}

function ResourceJobNotice() {
  const {controller, snapshot} = useResourceManager();
  const [dismissed, setDismissed] = useState(snapshot?.outcome);
  const operation = snapshot?.operation;
  const outcome = snapshot?.outcome;
  const mutation = operation && operation.kind !== 'inspect' ? operation : null;
  const finished = !operation && outcome && outcome.kind !== 'inspect' && outcome !== dismissed ? outcome : null;
  if (!mutation && !finished) return null;
  const gameId = (mutation ?? finished)!.gameId;
  return <aside aria-label="资源任务" className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status" className="grow">{PRODUCT_GAMES[gameId].title} · {mutation
      ? mutation.cancelRequested ? '正在等待当前操作停止…' : mutation.kind === 'install' ? '资源安装中，切换页面不会取消' : '正在移除可选资源'
      : finished?.status === 'completed' ? '资源已更新' : finished?.status === 'cancelled' ? '资源操作已取消' : '资源操作失败'}</p>
    {mutation?.progress && <p className="w-full text-xs text-muted">已处理 {mutation.progress.completed} / {mutation.progress.total} 项文件</p>}
    {mutation && <button type="button" className={button} disabled={mutation.cancelRequested} onClick={() => controller?.cancel()}>取消资源任务</button>}
    {finished && <>
      {snapshot?.errors[gameId] && <p className="w-full text-xs text-accent">{snapshot.errors[gameId]!.message}</p>}
      <button type="button" className={button} onClick={() => setDismissed(outcome)}>知道了</button>
    </>}
  </aside>;
}
