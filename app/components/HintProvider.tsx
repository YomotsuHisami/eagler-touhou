import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useLocale} from './LocaleProvider';
import {useRuntimeService} from '../runtime/RuntimeHost';
import {useFilePreparation} from './FilePreparationProvider';
import type {HintController} from '../services/hints.client';
const Context = createContext<HintController | null>(null);
export function useHintController() {return useContext(Context);}

/** Root-lifetime owner for product hint-file policy over the shared Runtime. */
export function HintProvider({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const runtime = useRuntimeService();
  const {controller: filePreparation} = useFilePreparation();
  const retained = useRef<{runtime: NonNullable<typeof runtime>; filePreparation: typeof filePreparation; controller: HintController} | null>(null);
  const epoch = useRef(0);
  const [controller, setController] = useState<HintController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const effect = ++epoch.current; let active = true;
    if (!runtime) return;
    void import('../services/hints.client').then(({createHintController}) => {
      if (!active) return;
      if (retained.current?.runtime !== runtime || retained.current.filePreparation !== filePreparation) {
        retained.current?.controller.dispose();
        retained.current = {runtime, filePreparation, controller: createHintController({runtimeService: runtime,
          prepareProduct: filePreparation ? (productId, signal) => filePreparation.ensurePrepared(productId, signal) : undefined})};
      }
      setController(retained.current.controller); setError(null);
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {
      active = false;
      queueMicrotask(() => {if (epoch.current === effect) {retained.current?.controller.dispose(); retained.current = null;}});
    };
  }, [runtime, filePreparation]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">{t('ui.providers.saves.unavailable')}{error}</p>}</Context.Provider>;
}
