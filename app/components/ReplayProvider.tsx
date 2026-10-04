import {useLocale} from './LocaleProvider';
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useRuntimeService} from '../runtime/RuntimeHost';
import type {ReplayController} from '../services/replays.client';
const ReplayContext = createContext<ReplayController | null>(null);
export function useReplayController() {return useContext(ReplayContext);}
/** Root lifetime only; route changes never cancel writes or create another owner. */
export function ReplayProvider({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const runtime = useRuntimeService();
  const retained = useRef<{runtime: NonNullable<typeof runtime>; controller: ReplayController} | null>(null);
  const epoch = useRef(0);
  const [controller, setController] = useState<ReplayController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const effect = ++epoch.current; let active = true;
    if (!runtime) return;
    void import('../services/replays.client').then(({createReplayController}) => {
      if (!active) return;
      if (retained.current?.runtime !== runtime) {
        retained.current?.controller.dispose();
        retained.current = {runtime, controller: createReplayController({runtimeService: runtime})};
      }
      setController(retained.current.controller); setError(null);
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {
      active = false;
      queueMicrotask(() => {if (epoch.current === effect) {retained.current?.controller.dispose(); retained.current = null;}});
    };
  }, [runtime]);
  return <ReplayContext.Provider value={controller}>{children}{error && <p role="alert">{t('react.replays.serviceError', {reason:error})}</p>}</ReplayContext.Provider>;
}
