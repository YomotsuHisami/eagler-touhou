import {createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode} from 'react';

interface PlayerSurface {readonly element: HTMLDivElement | null; readonly starting: boolean; beginStart(cancel?: () => void): () => void; isStarting(): boolean; cancelStart(): void}
const Context = createContext<PlayerSurface | null>(null);
export function usePlayerSurface() {return useContext(Context);}

/** One document-lifetime fullscreen root. The existing frame and all portal
 * surfaces stay in this container before, during and after fullscreen. */
export function PlayerSurfaceProvider({children}: {children: ReactNode}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [starting, setStarting] = useState(false), startOwner = useRef<{cancel?: () => void} | null>(null);
  const beginStart = useCallback((cancel?: () => void) => {
    const owner = {cancel}; startOwner.current = owner; setStarting(true);
    return () => {if (startOwner.current === owner) {startOwner.current = null; setStarting(false);}};
  }, []);
  const isStarting = useCallback(() => startOwner.current !== null, []);
  const cancelStart = useCallback(() => {const owner=startOwner.current;startOwner.current=null;setStarting(false);owner?.cancel?.();}, []);
  const value = useMemo(() => ({element, starting, beginStart, isStarting, cancelStart}), [element, starting, beginStart, isStarting, cancelStart]);
  return <Context.Provider value={value}><div ref={setElement} data-player-surface className="min-h-svh bg-background text-paper">{children}</div></Context.Provider>;
}
