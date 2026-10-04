import {useLocale} from './LocaleProvider';
import {Link} from 'react-router';
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {ResourceImportController, ResourceImportSnapshot} from '../services/resource-import.client';
import type {ResourceManagerController} from '../services/resources.client';
import type {PreferencesContextSource} from '../services/preferences.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';

const Context = createContext<ResourceManagerController | null>(null);
const ImportContext = createContext<ResourceImportController | null>(null);
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';

/** One document owner survives route changes and StrictMode effect replay.
 * pagehide fences a pending import; pageshow creates a fresh owner after BFCache.
 */
export function createResourceDocumentOwner<Controller extends {dispose(): void}>(options: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  load(): Promise<() => Controller>;
  onController(controller: Controller | null): void;
  onError(error: unknown): void;
}) {
  let attached = false, active = true, disposed = false, serial = 0;
  let controller: Controller | null = null;
  let loading: Promise<() => Controller> | null = null;
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
  const {t} = useLocale();
  const fetchImpl = useDocumentRequestFetch();
  const [controller, setController] = useState<ResourceManagerController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<ReturnType<typeof createResourceDocumentOwner<ResourceManagerController>> | null>(null);
  const epoch = useRef(0);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createResourceDocumentOwner({
      target: window,
      load: async () => {
        const {createResourceManager} = await import('../services/resources.client');
        return () => createResourceManager({fetchImpl, baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
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
  return <Context.Provider value={controller}><ResourceImportProvider>{children}{error && <p role="alert" className="p-3 text-accent">{t('ui.providers.resources.unavailable')}{error}</p>}</ResourceImportProvider></Context.Provider>;
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
  const {t} = useLocale();
  const {controller, snapshot} = useResourceManager();
  const [dismissed, setDismissed] = useState(snapshot?.outcome);
  const operation = snapshot?.operation;
  const outcome = snapshot?.outcome;
  const mutation = operation && operation.kind !== 'inspect' ? operation : null;
  const finished = !operation && outcome && outcome.kind !== 'inspect' && outcome !== dismissed ? outcome : null;
  if (!mutation && !finished) return null;
  const gameId = (mutation ?? finished)!.gameId;
  return <aside aria-label={t('ui.providers.resources.task')} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role="status" className="grow"><span lang="ja">{PRODUCT_GAMES[gameId].title}</span> · {mutation
      ? mutation.cancelRequested ? t('ui.providers.resources.waitingStop') : mutation.kind === 'remove' ? t('ui.providers.resources.removing') : t('ui.providers.resources.installing')
      : finished?.status === 'completed' ? t('ui.providers.resources.updated') : finished?.status === 'cancelled' ? t('ui.providers.resources.cancelled') : t('ui.providers.resources.failed')}</p>
    {mutation?.progress && <p className="w-full text-xs text-muted">{t('ui.providers.resources.progress', {completed: mutation.progress.completed, total: mutation.progress.total})}</p>}
    {mutation && <button type="button" className={button} disabled={mutation.cancelRequested} onClick={() => controller?.cancel()}>{t('ui.providers.resources.cancelTask')}</button>}
    {finished && <>
      {snapshot?.errors[gameId] && <p className="w-full text-xs text-accent">{snapshot.errors[gameId]!.message}</p>}
      <button type="button" className={button} onClick={() => setDismissed(outcome)}>{t('ui.providers.resources.acknowledge')}</button>
    </>}
  </aside>;
}


/** Local-file review and confirmed import keep their own document-lifetime
 * controller. All mutation paths still serialize in the one Package installer.
 */
function ResourceImportProvider({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const fetchImpl = useDocumentRequestFetch();
  const [controller, setController] = useState<ResourceImportController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<ReturnType<typeof createResourceDocumentOwner<ResourceImportController>> | null>(null);
  const epoch = useRef(0);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createResourceDocumentOwner({target: window,
      load: async () => {const {createResourceImport} = await import('../services/resource-import.client');
        return () => createResourceImport({fetchImpl, baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href});},
      onController: next => {setController(next); if (next) setError(null);},
      onError: failure => setError(failure instanceof Error ? failure.message : String(failure)),
    });
    retained.current = owner; owner.attach();
    return () => {owner.detach(); queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});};
  }, []);
  return <ImportContext.Provider value={controller}>{children}{error && <p role="alert" className="p-3 text-accent">{t('ui.providers.import.unavailable')}{error}</p>}<div className="fixed right-3 bottom-3 left-3 z-30 grid gap-2 sm:left-auto sm:w-[min(32rem,calc(100vw-1.5rem))]"><ResourceJobNotice/><ResourceImportNotice/></div></ImportContext.Provider>;
}

export function useResourceImport() {
  const controller = useContext(ImportContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}

function ResourceImportNotice() {
  const {t} = useLocale();
  const {controller, snapshot} = useResourceImport();
  const resources = useResourceManager();
  const [dismissed, setDismissed] = useState<ResourceImportSnapshot | null>(null);
  const refreshed = useRef<ResourceImportSnapshot['outcome']>(null);
  useEffect(() => {
    const result = snapshot?.outcome;
    if (!result || result === refreshed.current || !resources.controller || resources.snapshot?.operation) return;
    refreshed.current = result;
    void resources.controller.inspect(result.gameId).catch(() => {});
  }, [snapshot?.outcome, resources.controller, resources.snapshot?.operation]);
  if (!snapshot || snapshot === dismissed || !snapshot.operation && !snapshot.review && !snapshot.outcome && !snapshot.error) return null;
  const product = snapshot.operation?.productId ?? snapshot.review?.productId ?? snapshot.outcome?.gameId ?? snapshot.errorGameId;
  if (!product) return null;
  const game = gameIdForProduct(product);
  return <aside aria-label={t('ui.providers.import.task')} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role="status" className="grow"><span lang="ja">{PRODUCT_GAMES[game].title}</span> · {snapshot.operation
      ? snapshot.operation.cancelRequested ? t('ui.providers.import.cancelling') : snapshot.operation.kind === 'inspect' ? t('ui.providers.import.inspecting') : t('ui.providers.import.committing')
      : snapshot.error ? t('ui.providers.import.incomplete') : snapshot.review ? t('ui.providers.import.review') : snapshot.outcome?.kind === 'import' ? t('ui.providers.import.imported') : t('ui.providers.import.removed')}</p>
    {snapshot.error && <p className="w-full text-xs text-accent">{snapshot.error}</p>}
    {snapshot.operation && <button type="button" className={button} disabled={snapshot.operation.cancelRequested} onClick={() => controller?.cancel()}>{t('ui.providers.import.cancel')}</button>}
    <Link to={`/games/${product}/resources`} className={button}>{t('ui.providers.import.view')}</Link>
    {!snapshot.operation && <button type="button" className={button} onClick={() => setDismissed(snapshot)}>{t('ui.providers.dismiss')}</button>}
  </aside>;
}

export function useHostPublication() {return useResourceManager().snapshot?.hostPublication ?? null;}
