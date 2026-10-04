import {createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import type {GamePreferenceStorage} from '../../src/launcher/game-preferences.mts';
import type {TouchLayoutStore} from '../services/touch-layout.client';

const Context = createContext<TouchLayoutStore | null>(null);
const subscribeNone = () => () => {};
const emptySnapshot = () => null;
export function useTouchLayoutStore() { return useContext(Context); }
export function useTouchLayoutSnapshot() {
  const store = useTouchLayoutStore();
  return useSyncExternalStore(store?.subscribe ?? subscribeNone, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
}
export function TouchLayoutProvider({children, storage}: {children: ReactNode; storage?: GamePreferenceStorage | null}) {
  const [store, setStore] = useState<TouchLayoutStore | null>(null);
  useEffect(() => {
    let active = true;
    void import('../services/touch-layout.client').then(({createTouchLayoutStore}) => {
      if (!active) return;
      let selectedStorage = storage ?? null;
      if (storage === undefined) { try {selectedStorage = window.localStorage;} catch { /* Session only. */ } }
      const next = createTouchLayoutStore({storage: selectedStorage});
      next.load(); setStore(next);
    });
    return () => {active = false;};
  }, [storage]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

