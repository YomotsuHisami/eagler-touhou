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
export function LocaleSelect({className = '', menu = false}: {className?: string; menu?: boolean}) {
  const {locale,t,setLocale} = useLocale();
  return <label className={className}><span className="sr-only">{t('ui.language')}</span>
    {menu && <span className="masthead-menu-locale-copy" aria-hidden="true"><svg className="masthead-menu-icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.1 1.5 1.8 3.2 2.1 5H9.9C10.2 7.2 10.9 5.5 12 4Zm-7.4 7h3.1a17 17 0 0 0 0 2H4.6a8 8 0 0 1 0-2Zm5.1 0h4.6a17 17 0 0 1 0 2H9.7a17 17 0 0 1 0-2Zm6.6 0h3.1a8 8 0 0 1 0 2h-3.1a17 17 0 0 0 0-2ZM12 20c-1.1-1.5-1.8-3.2-2.1-5h4.2c-.3 1.8-1 3.5-2.1 5ZM5.5 9a8 8 0 0 1 3.8-4.5A20 20 0 0 0 7.9 9Zm9.2-4.5A8 8 0 0 1 18.5 9h-2.4a20 20 0 0 0-1.4-4.5ZM5.5 15h2.4a20 20 0 0 0 1.4 4.5A8 8 0 0 1 5.5 15Zm9.2 4.5a20 20 0 0 0 1.4-4.5h2.4a8 8 0 0 1-3.8 4.5Z"/></svg><span>{t('ui.language.menu')}</span><svg className="masthead-menu-locale-arrow" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></span>}
    <select value={locale} aria-label={t('ui.language')} onChange={event=>setLocale(event.target.value === 'en'?'en':'zh-CN')}
      className={menu ? 'masthead-menu-locale-select' : 'min-h-11 rounded-xl border border-line bg-panel px-3 text-paper'}>
      <option value="zh-CN">{t('ui.language.zhCN')}</option><option value="en">{t('ui.language.en')}</option>
    </select></label>;
}
