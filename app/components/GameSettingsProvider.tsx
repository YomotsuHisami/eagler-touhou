import {createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
import type {GamePreferenceStorage} from '../../src/launcher/game-preferences.mts';
import type {PreferencesContextSource, PreferencesStore} from '../services/preferences.client';
import {TouchLayoutProvider} from './TouchLayoutProvider';

const PreferenceOwner = createContext<PreferencesStore | null>(null);
const unresolvedContext: PreferencesContextSource = () => ({uiLocale: 'zh-CN'});
const noSubscription = () => () => {};
const noSnapshot = () => null;

/** Mount once above route/dialog contents so repeated forms share one owner. */
export function GameSettingsProvider({children, storage, context = unresolvedContext}: {
  children: ReactNode;
  /** Omit for browser storage after mount; pass null for an in-memory session. */
  storage?: GamePreferenceStorage | null;
  context?: PreferencesContextSource;
}) {
  const [store, setStore] = useState<PreferencesStore | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    let active = true;
    // .client is never evaluated by the SPA prerenderer. React's initial render
    // is identical on server/client and does not access browser storage.
    void import('../services/preferences.client').then(({createPreferencesStore}) => {
      if (!active) return;
      let selectedStorage = storage ?? null;
      if (storage === undefined) {
        try { selectedStorage = window.localStorage; } catch { /* Memory-only session. */ }
      }
      setStore(createPreferencesStore({storage: selectedStorage, context: contextRef.current}));
    });
    return () => { active = false; };
  }, [storage]);
  useEffect(() => { store?.setContext(context); }, [store, context]);
  return <PreferenceOwner.Provider value={store}><TouchLayoutProvider storage={storage}>{children}</TouchLayoutProvider></PreferenceOwner.Provider>;
}


/** Observe the root-owned preference generation without creating a second owner. */
export function useGamePreferences(productId: ProductId) {
  const store = useContext(PreferenceOwner);
  const getSnapshot = useCallback(() => store?.getSnapshot(productId) ?? null, [store, productId]);
  const settings = useSyncExternalStore(store?.subscribe ?? noSubscription, getSnapshot, noSnapshot);
  useEffect(() => { store?.loadProduct(productId); }, [store, productId]);
  return {store, settings};
}

