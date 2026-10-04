import {useLocale} from '../components/LocaleProvider';
import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {useLocation} from 'react-router';
import {createRuntimeViewportStore, type RuntimeViewportStore} from '../services/runtime-viewport';
import type {RuntimeService} from '../services/runtime.client';
import './runtime-viewport.css';

const Context = createContext<RuntimeViewportStore | null>(null);
const subscribeNone = () => () => {}, empty = () => null;
export function useRuntimeViewport() {return useContext(Context);}
export function useRuntimeViewportSnapshot() {
  const store = useRuntimeViewport();
  return useSyncExternalStore(store?.subscribe ?? subscribeNone, store?.getSnapshot ?? empty, empty);
}
type ViewportService = Pick<RuntimeService, 'subscribe' | 'getSnapshot' | 'getLauncherControlContext' | 'getInputContext'>;
export function RuntimeViewportProvider({service, frame, children}: {service: ViewportService | null; frame: RefObject<HTMLIFrameElement | null>; children: ReactNode}) {
  const [store] = useState(createRuntimeViewportStore);
  const snapshot = useSyncExternalStore(service?.subscribe ?? subscribeNone, service?.getSnapshot ?? empty, empty);
  const location = useLocation();
  useLayoutEffect(() => {
    const context = service?.getLauncherControlContext();
    const touchCapable = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    store.setSession(context ? {epoch: context.epoch, touchLayout: context.launcherControls.touchLayout,
      magnifierEnabled: context.launcherControls.magnifierEnabled,
      live: !!snapshot?.launched && !!snapshot.ready && !snapshot.spectator, touchCapable} : null);
  }, [store, service, snapshot?.epoch, snapshot?.ready, snapshot?.launched, snapshot?.spectator]);
  useEffect(() => {
    const target = frame.current?.contentWindow, epoch = snapshot?.epoch;
    if (!service || !target || !epoch || !snapshot.ready) return;
    const current = () => service.getInputContext().epoch === epoch;
    const begin = (event: PointerEvent) => {if (current()) store.beginPointer('frame', event.pointerId, event.clientX, event.clientY, event.pointerType);};
    const move = (event: PointerEvent) => {if (current()) store.movePointer('frame', event.pointerId, event.clientX, event.clientY);};
    const end = (event: PointerEvent) => {if (current()) store.endPointer(event.pointerId);};
    try {
      target.addEventListener('pointerdown', begin, true);target.addEventListener('pointermove', move, true);
      target.addEventListener('pointerup', end, true);target.addEventListener('pointercancel', end, true);
    } catch {return;}
    return () => {
      try {target.removeEventListener('pointerdown', begin, true);target.removeEventListener('pointermove', move, true);target.removeEventListener('pointerup', end, true);target.removeEventListener('pointercancel', end, true);} catch { /* Replaced document. */ }
      store.cancelGesture();
    };
  }, [store, service, frame, snapshot?.epoch, snapshot?.ready]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focus = () => {
      const target = document.activeElement;
      store.suspend(params.get('panel') === 'help' || params.get('touchLayout') === '1' ||
        target instanceof Element && !!target.closest('dialog,[role="dialog"],input,select,textarea,[contenteditable]'));
    };
    const hidden = () => {if (document.visibilityState === 'hidden') store.cancelGesture();};
    const blur = () => queueMicrotask(() => {if (!document.hasFocus()) store.cancelGesture();});
    focus();document.addEventListener('focusin', focus);document.addEventListener('visibilitychange', hidden);window.addEventListener('blur', blur);
    return () => {document.removeEventListener('focusin', focus);document.removeEventListener('visibilitychange', hidden);window.removeEventListener('blur', blur);};
  }, [store, location.search]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

/** The sole iframe stays mounted; only its parent transform and visibility change. */
export function RuntimeViewport({frame, visible}: {frame: RefObject<HTMLIFrameElement | null>; visible: boolean}) {
  const {t} = useLocale();
  const store = useRuntimeViewport(), snapshot = useRuntimeViewportSnapshot();
  const host = useRef<HTMLDivElement>(null), system = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!store || !host.current || !visible) return;
    const measure = () => {
      if (!host.current || !system.current) return;
      const rect = host.current.getBoundingClientRect(), reserved = system.current.getBoundingClientRect();
      store.setGeometry({left: rect.left, top: rect.top, width: rect.width, height: rect.height});
      store.setSystemControls({left: reserved.left, top: reserved.top, width: reserved.width, height: reserved.height});
    };
    measure();const observer = new ResizeObserver(measure);observer.observe(host.current);if (system.current) observer.observe(system.current);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {observer.disconnect();window.visualViewport?.removeEventListener('resize', measure);};
  }, [store, visible, snapshot?.epoch]);
  const reserved = snapshot?.systemControls;
  return <><div ref={host} data-runtime-host className={visible ? 'fixed inset-0 z-20 overflow-hidden bg-black' : 'pointer-events-none fixed top-0 -left-[10000px] h-[480px] w-[640px] opacity-0'} aria-hidden={!visible}>
    <div data-runtime-viewport className="absolute inset-0 origin-top-left will-change-transform" style={{transform: snapshot?.transform ?? 'none'}}>
      <iframe ref={frame} title={t('react.runtime.frameTitle')} className="h-full w-full touch-none border-0" tabIndex={visible ? 0 : -1}/>
    </div>
    <div ref={system} className="runtime-system-anchor invisible" aria-hidden="true"/>
  </div>
    {visible && snapshot?.active && reserved && <button type="button" aria-label={t('react.runtime.resetZoom')} className="runtime-zoom-reset z-40 grid place-items-center rounded-xl bg-panel/90 p-1 text-[10px] text-paper" style={{right: `calc(100vw - ${reserved.left}px + 8px)`, top: reserved.top}}
      onPointerDown={event => {if (event.button !== 0) return;event.preventDefault();store?.reset();}}
      onClick={event => {if (event.detail === 0) {store?.reset();frame.current?.focus({preventScroll: true});}}}>{t('action.reset')}<small>{Math.round(snapshot.scale * 100)}%</small></button>}
  </>;
}
