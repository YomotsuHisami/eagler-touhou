import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useRuntimeService} from '../runtime/RuntimeHost';
import type {SaveController} from '../services/saves.client';
const SaveContext = createContext<SaveController | null>(null);
export function useSaveController() {return useContext(SaveContext);}
/** Root lifetime only; route changes never cancel writes or create another owner. */
export function SaveProvider({children}: {children: ReactNode}) {
  const runtime = useRuntimeService();
  const retained = useRef<{runtime: NonNullable<typeof runtime>; controller: SaveController} | null>(null);
  const epoch = useRef(0);
  const [controller, setController] = useState<SaveController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const effect = ++epoch.current; let active = true;
    if (!runtime) return;
    void import('../services/saves.client').then(({createSaveController}) => {
      if (!active) return;
      if (retained.current?.runtime !== runtime) {
        retained.current?.controller.dispose();
        retained.current = {runtime, controller: createSaveController({runtimeService: runtime})};
      }
      setController(retained.current.controller); setError(null);
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {
      active = false;
      queueMicrotask(() => {if (epoch.current === effect) {retained.current?.controller.dispose(); retained.current = null;}});
    };
  }, [runtime]);
  return <SaveContext.Provider value={controller}>{children}{error && <p role="alert">存档管理服务不可用：{error}</p>}</SaveContext.Provider>;
}
