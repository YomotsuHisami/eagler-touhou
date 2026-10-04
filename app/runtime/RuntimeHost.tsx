import {createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {RuntimeViewport, RuntimeViewportProvider} from './RuntimeViewport';
import {HostedKeyboard} from '../../src/launcher/hosted-keyboard.mts';
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
      const keyboard = keyboardOwner.current;
      const forward = (event: KeyboardEvent) => {
        const context = current.getInputContext();
        const launcherOwnsFocus = event.target instanceof Element && !!event.target.closest('input,select,textarea,button,a,summary,[contenteditable],dialog,[role="dialog"],[role="button"]');
        const keys = keyboard.forward(event,context,launcherOwnsFocus);
        for(const key of keys) current.postInput('keyboard',{down:event.type === 'keydown',...key});
        if(keys.length) event.preventDefault();
      };
      const clear = () => {keyboard.clear();if(frame.current?.isConnected === true)current.postInput('keyboard-clear',{});};
      const visibility = () => {if(document.visibilityState === 'hidden') clear();};
      window.addEventListener('keydown',forward,true);window.addEventListener('keyup',forward,true);
      window.addEventListener('blur',clear);window.addEventListener('pagehide',clear);
      document.addEventListener('visibilitychange',visibility);
      detach = () => {
        window.removeEventListener('keydown',forward,true);window.removeEventListener('keyup',forward,true);
        window.removeEventListener('blur',clear);window.removeEventListener('pagehide',clear);
        document.removeEventListener('visibilitychange',visibility);
        clear();
      };
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
  return <Context.Provider value={service}><FrameContext.Provider value={frame}><RuntimeViewportProvider service={service} frame={frame}>{children}{error && <p role="alert">Runtime 初始化失败：{error}</p>}<RuntimeFrame frame={frame}/></RuntimeViewportProvider></FrameContext.Provider></Context.Provider>;
}
function RuntimeFrame({frame}: {frame: React.RefObject<HTMLIFrameElement | null>}) {
  const snapshot=useRuntimeSnapshot();
  const visible=!!snapshot && (snapshot.launched || snapshot.phase === 'launching' || (snapshot.phase === 'error' && snapshot.ready));
  return <RuntimeViewport frame={frame} visible={visible}/>;
}
