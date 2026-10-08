import {useLocale} from './LocaleProvider';
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useRuntimeService} from '../runtime/RuntimeHost';
import {useFilePreparation} from './FilePreparationProvider';
import type {SaveController} from '../services/saves.client';
const SaveContext = createContext<SaveController | null>(null);
export function useSaveController() {return useContext(SaveContext);}
/** Root lifetime only; route changes never cancel writes or create another owner. */
export function SaveProvider({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const runtime = useRuntimeService();
  const {controller: filePreparation} = useFilePreparation();
  const retained = useRef<{runtime: NonNullable<typeof runtime>; filePreparation: typeof filePreparation; controller: SaveController} | null>(null);
  const epoch = useRef(0);
  const [controller, setController] = useState<SaveController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const effect = ++epoch.current; let active = true;
    if (!runtime) return;
    void import('../services/saves.client').then(({createSaveController}) => {
      if (!active) return;
      if (retained.current?.runtime !== runtime || retained.current.filePreparation !== filePreparation) {
        retained.current?.controller.dispose();
        retained.current = {runtime, filePreparation, controller: createSaveController({runtimeService: runtime,
          prepareProduct: filePreparation ? (productId, signal) => filePreparation.ensurePrepared(productId, signal) : undefined})};
      }
      setController(retained.current.controller); setError(null);
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {
      active = false;
      queueMicrotask(() => {if (epoch.current === effect) {retained.current?.controller.dispose(); retained.current = null;}});
    };
  }, [runtime, filePreparation]);
  return <SaveContext.Provider value={controller}>{children}{error && <p role="alert">{t('ui.providers.saves.unavailable')}{error}</p>}</SaveContext.Provider>;
}
