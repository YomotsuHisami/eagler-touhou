import {useLocale} from '../components/LocaleProvider';
import {createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {RuntimeViewport, RuntimeViewportProvider} from './RuntimeViewport';
import {RuntimeRequestResume} from './RuntimeRequestResume';
import {HostedKeyboard} from '../../src/launcher/hosted-keyboard.mts';
import {bindRuntimeKeyboard} from './keyboard-binding';
import {usePlayerSurface} from './PlayerToolsSurface';
import type {RuntimeService, RuntimeSnapshot} from '../services/runtime.client';
const Context = createContext<RuntimeService | null>(null);
const FrameContext = createContext<RefObject<HTMLIFrameElement | null> | null>(null);
const subscribeNone = () => () => {};
const emptySnapshot = () => null;
export function useRuntimeService() {return useContext(Context);}
/** Read-only handle to the one existing frame for viewport geometry and focus checks. */
export function useRuntimeFrame() {return useContext(FrameContext);}
export function useRuntimeSnapshot(): RuntimeSnapshot | null {
  const service = useRuntimeService();
  return useSyncExternalStore(service?.subscribe ?? subscribeNone, service?.getSnapshot ?? emptySnapshot, emptySnapshot);
}
/** Root lifetime only: modal/route changes never key or replace this frame. */
export function RuntimeProvider({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const retained = useRef<{owner: RuntimeService; frame: HTMLIFrameElement} | null>(null);
  const effectEpoch = useRef(0);
  const keyboardOwner = useRef(new HostedKeyboard());
  const [service, setService] = useState<RuntimeService | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const effect = ++effectEpoch.current;
    let cancelled = false;
    let owner: RuntimeService | null = null;
    let detach: (() => void) | undefined;
    void import('../services/runtime.client').then(({createRuntimeService}) => {
      if(cancelled || !frame.current) return;
      if(retained.current && retained.current.frame !== frame.current) throw new Error('Runtime frame identity changed');
      owner = retained.current?.owner ?? createRuntimeService({frame:frame.current,baseUrl:new URL(import.meta.env.BASE_URL,location.origin).href,onWarning:console.warn});
      retained.current = {owner,frame:frame.current};
      const current = owner;
      detach = bindRuntimeKeyboard({host:window,document,element:Element,frame:() => frame.current,
        service:current,keyboard:keyboardOwner.current});
      setService(current);
    }).catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:String(reason));});
    return () => {
      cancelled=true;detach?.();
      queueMicrotask(() => {
        // Effect replay retains the same DOM host and service. A true document
        // teardown only releases an already detached host; it never reports a
        // successful save after the Runtime document has gone away.
        if(effectEpoch.current !== effect || !owner) return;
        if(retained.current?.frame.isConnected === false) owner.disposeDetachedFrame();
        else return; // Effect replay must retain a still-connected owner.
        if(retained.current?.owner === owner) retained.current = null;
      });
    };
  },[]);
  return <Context.Provider value={service}><FrameContext.Provider value={frame}><RuntimeViewportProvider service={service} frame={frame}><RuntimeRequestResume service={service} frame={frame}/>{children}{error && <p role="alert">{t('react.runtime.initError', {reason:error})}</p>}<RuntimeFrame frame={frame}/></RuntimeViewportProvider></FrameContext.Provider></Context.Provider>;
}
function RuntimeFrame({frame}: {frame: React.RefObject<HTMLIFrameElement | null>}) {
  const snapshot=useRuntimeSnapshot();
  const visible=usePlayerSurface()?.starting === true || !!snapshot && (snapshot.launched || snapshot.phase === 'launching' || (snapshot.phase === 'error' && snapshot.ready));
  return <RuntimeViewport frame={frame} visible={visible}/>;
}
