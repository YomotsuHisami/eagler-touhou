import {createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService} from '../runtime/RuntimeHost';
import {createFilePreparationController, type FilePreparationController} from '../services/file-preparation.client';
const Context = createContext<FilePreparationController | null>(null);
const none = () => () => {};
const empty = () => null;

/** The shared bridge is long-lived; route views can request preparation without owning the Runtime job. */
export function FilePreparationProvider({children}: {children: ReactNode}) {
  const runtime = useRuntimeService();
  const controller = useMemo(() => runtime ? createFilePreparationController({runtimeService: runtime}) : null, [runtime]);
  useLayoutEffect(() => () => controller?.dispose(), [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}

export function useFilePreparation() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
