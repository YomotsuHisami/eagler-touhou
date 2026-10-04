import {createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation, useNavigate, useNavigation} from 'react-router';
import {createLocaleStore, formatUiMessage, routeUiLocale, UI_LOCALE_STORAGE_KEY,
  type LocaleSnapshot, type LocaleStorage, type UiLocale, type UiMessageKey, type UiMessageParams} from '../services/locale.client';
interface LocaleContextValue {
  readonly locale: UiLocale;
  readonly snapshot: LocaleSnapshot;
  t(key: UiMessageKey, params?: UiMessageParams): string;
  setLocale(locale: UiLocale): void;
}
const fallbackSnapshot: LocaleSnapshot = Object.freeze({locale: 'zh-CN', preferredLocale: null, persistence: 'unknown'});
const fallback: LocaleContextValue = {locale:'zh-CN', snapshot:fallbackSnapshot,
  t:(key,params)=>formatUiMessage('zh-CN',key,params), setLocale:()=>{throw new Error('Locale control requires LocaleProvider');}};
const Context = createContext<LocaleContextValue>(fallback);

/** Mount once inside Router, above translated views. Storage and document lang
 * effects start after mount; published root identity defaults to Chinese. */
export function LocaleProvider({children, initialLocale = 'zh-CN', storage}: {
  children: ReactNode; initialLocale?: UiLocale; storage?: LocaleStorage | null;
}) {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate();
  const [store] = useState(() => createLocaleStore({initialLocale:routeUiLocale(location.pathname,location.search) ?? initialLocale}));
  const serverSnapshot = useRef(store.getSnapshot());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot.current);
  const lastNormalized = useRef<string | null>(null);
  const providerId=useId(),choiceSerial=useRef(0);
  const choice=useRef<{id:string;locale:UiLocale;sourceKey:string}|null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let selectedStorage = storage;
    if (selectedStorage === undefined) {try {selectedStorage = window.localStorage;} catch {selectedStorage = null;}}
    store.hydrate(selectedStorage);
    const changed = (event: StorageEvent) => {if (event.key === UI_LOCALE_STORAGE_KEY || event.key === null) store.hydrate(selectedStorage);};
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [store,storage]);
  useEffect(() => {
    const explicit = routeUiLocale(location.pathname,location.search);
    if (explicit) {
      const accepted=choice.current?.id===location.state?.uiLocaleRequest && choice.current?.locale===explicit;
      store.setLocale(explicit,{persist:accepted});
      if(accepted)choice.current=null;
    }
    if(choice.current && navigation.state==='idle' && location.key!==choice.current.sourceKey && location.state?.uiLocaleRequest!==choice.current.id)choice.current=null;
  }, [store,location,navigation.state]);
  useEffect(() => {
    document.documentElement.lang = snapshot.locale;
    document.documentElement.dataset.uiLocale = snapshot.locale;
  }, [snapshot.locale]);
  useEffect(() => {
    if (choice.current || navigation.state !== 'idle' || snapshot.locale !== 'en' || routeUiLocale(location.pathname,location.search)) return;
    const query = new URLSearchParams(location.search);
    // The legacy adapter first preserves entry/room intent. Competing replaces
    // here could supersede its move from a .html or root-query entry.
    if (/\/(?:index|en|lobby)\.html$/.test(location.pathname) || location.pathname === '/' && (query.has('game') || query.has('mpRoom'))) return;
    const key = `${location.key}:${location.pathname}${location.search}${location.hash}`;
    if (lastNormalized.current === key) return;
    lastNormalized.current = key;
    query.set('uiLocale','en');
    void Promise.resolve(navigate({pathname:location.pathname,search:query.toString(),hash:location.hash},
      {replace:true,state:location.state,preventScrollReset:true})).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));
  }, [location,navigation.state,navigate,snapshot.locale]);
  const setLocale = useCallback((locale: UiLocale) => {
    if(locale!=='en' && locale!=='zh-CN')throw new Error('Unsupported UI locale');
    const query = new URLSearchParams(location.search); query.set('uiLocale',locale);
    const ticket={id:`${providerId}-${++choiceSerial.current}`,locale,sourceKey:location.key};
    choice.current=ticket;setError(null);
    // Route commit, not an optimistic control click or navigation-promise
    // settlement, changes displayed locale and persists the explicit choice.
    const state=location.state && typeof location.state==='object' && !Array.isArray(location.state)?location.state:{};
    const failed=(reason:unknown)=>{if(choice.current===ticket)setError(reason instanceof Error?reason.message:String(reason));};
    try{void Promise.resolve(navigate({pathname:location.pathname,search:query.toString(),hash:location.hash},
      {replace:true,state:{...state,uiLocaleRequest:ticket.id},preventScrollReset:true})).catch(failed);}catch(reason){failed(reason);}
  }, [providerId,location,navigate]);
  const value = useMemo<LocaleContextValue>(() => ({locale:snapshot.locale,snapshot,
    t:(key,params)=>formatUiMessage(snapshot.locale,key,params),setLocale}),[snapshot,setLocale]);
  return <Context.Provider value={value}>{children}{error && <p role="alert">{error}</p>}</Context.Provider>;
}
export function useLocale() {return useContext(Context);}
export function LocaleSelect({className = ''}: {className?: string}) {
  const {locale,t,setLocale} = useLocale();
  return <label className={className}><span className="sr-only">{t('ui.language')}</span>
    <select value={locale} aria-label={t('ui.language')} onChange={event=>setLocale(event.target.value === 'en'?'en':'zh-CN')}
      className="min-h-11 rounded-xl border border-line bg-panel px-3 text-paper">
      <option value="zh-CN">{t('ui.language.zhCN')}</option><option value="en">{t('ui.language.en')}</option>
    </select></label>;
}
