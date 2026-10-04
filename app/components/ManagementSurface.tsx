import {createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import './management-surface.css';
import {useLocation, useNavigation} from 'react-router';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import type {RuntimeSnapshot} from '../services/runtime.client';
import {libraryPanelProduct} from '../services/library-panel-navigation';
interface ManagementSurface {required: boolean; element: HTMLDivElement | null; setElement(element: HTMLDivElement | null): void}
const Context = createContext<ManagementSurface | null>(null);
/** A DOM destination only. Jobs, Start intent and the single save/Exit blocker
 * remain in their existing document-lifetime owners above the routed sheet. */
export function ManagementSurfaceProvider({children, runtimeSnapshot}: {children: ReactNode; runtimeSnapshot?: RuntimeSnapshot | null}) {
  const [slot, setElement] = useState<HTMLDivElement | null>(null);
  const location = useLocation(), navigation = useNavigation(), hosted = useRuntimeSnapshot();
  const runtime = runtimeSnapshot === undefined ? hosted : runtimeSnapshot;
  const playerVisible = !!runtime && (runtime.launched || runtime.phase === 'launching' || runtime.phase === 'error' && runtime.ready);
  const required = !!libraryPanelProduct((navigation.location ?? location).pathname) && !playerVisible;
  const element = required ? slot : null;
  const value = useMemo(() => ({required, element, setElement}), [required, element]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ManagementSurfaceSlot({floating = false}: {floating?: boolean}) {
  const surface = useContext(Context), slot = useRef<HTMLDivElement>(null);
  const setElement = surface?.setElement;
  // Publish after Radix's mount effects, not from the ref callback. Global
  // upper modals can then mount without being hidden by a later lower sheet.
  useEffect(() => {setElement?.(slot.current);return () => setElement?.(null);}, [setElement]);
  return <div ref={slot} data-management-surface={floating ? 'room' : 'library'}/>;
}
/** Portal the existing presentation, never a duplicate controller/toolbar.
 * Fixtures without a management sheet retain the existing player placement. */
export function ManagementSurfacePortal({children}: {children(docked: boolean): ReactNode}) {
  const target = useContext(Context)?.element;
  return target ? createPortal(children(true), target) : children(false);
}

/** Structural readiness and a direct-link focus fallback, not a second modal
 * stack. Radix still owns focus trapping, accessibility and dismissal. */
export function useManagementModalParent() {
  const surface = useContext(Context), returnFocus = useRef<HTMLElement | null>(null);
  returnFocus.current = surface?.element?.closest<HTMLElement>('[role="dialog"]') ?? null;
  return {ready: !surface?.required || !!surface.element, returnFocus};
}
