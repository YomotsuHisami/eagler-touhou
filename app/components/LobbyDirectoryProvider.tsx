import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation} from 'react-router';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import type {LobbyDirectoryController} from '../services/lobby-directory.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';

const Context = createContext<LobbyDirectoryController | null>(null);
const none = () => () => {};
const empty = () => null;
export const isLobbyDirectoryRoute = (pathname: string) => /^\/lobby\/?$/.test(pathname);
/** Root-lived owner. Page departure fences delayed imports; BFCache creates a
 * fresh controller, while Router filtering/dialog changes retain one socket. */
export const createLobbyDirectoryDocumentOwner = createPreparationDocumentOwner<LobbyDirectoryController>;
export function LobbyDirectoryProvider({children}: {children: ReactNode}) {
  const fetchImpl = useDocumentRequestFetch();
  const location = useLocation();
  const [controller, setController] = useState<LobbyDirectoryController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<ReturnType<typeof createLobbyDirectoryDocumentOwner> | null>(null);
  const epoch = useRef(0);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createLobbyDirectoryDocumentOwner({
      target: window,
      load: async () => {
        const {createLobbyDirectory} = await import('../services/lobby-directory.client');
        return () => createLobbyDirectory({fetchImpl, baseUrl: new URL(import.meta.env.BASE_URL, locationOrigin()).href});
      },
      onController: next => {setController(next); if (next) setError(null);},
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    retained.current = owner; owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});
    };
  }, []);
  useLayoutEffect(() => {
    controller?.setActive(isLobbyDirectoryRoute(location.pathname), new URLSearchParams(location.search).get('game') ?? '');
  }, [controller, location.pathname, location.search]);
  useLayoutEffect(() => {
    if (!controller) return;
    const changed = () => controller.networkChanged();
    const visible = () => {if (document.visibilityState === 'visible') changed();};
    const connection = (navigator as Navigator & {connection?: EventTarget}).connection;
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    connection?.addEventListener('change', changed); document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', changed); window.removeEventListener('offline', changed);
      connection?.removeEventListener('change', changed); document.removeEventListener('visibilitychange', visible);
    };
  }, [controller]);
  return <Context.Provider value={controller}>{children}{error && isLobbyDirectoryRoute(location.pathname) && <p role="alert" className="p-3 text-accent">联机大厅不可用：{error}</p>}</Context.Provider>;
}
function locationOrigin() {return window.location.origin;}
export function useLobbyDirectory() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
