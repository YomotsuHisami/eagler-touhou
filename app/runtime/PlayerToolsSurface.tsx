import {createContext, useContext, useMemo, useState, type ReactNode} from 'react';

interface PlayerSurface {readonly element: HTMLDivElement | null}
const Context = createContext<PlayerSurface | null>(null);
export function usePlayerSurface() {return useContext(Context);}

/** One document-lifetime fullscreen root. The existing frame and all portal
 * surfaces stay in this container before, during and after fullscreen. */
export function PlayerSurfaceProvider({children}: {children: ReactNode}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({element}), [element]);
  return <Context.Provider value={value}><div ref={setElement} data-player-surface className="min-h-svh bg-background text-paper">{children}</div></Context.Provider>;
}
