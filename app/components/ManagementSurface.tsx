import {createContext, useContext, useMemo, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import './management-surface.css';
import {useLocation} from 'react-router';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import type {RuntimeSnapshot} from '../services/runtime.client';
import {libraryPanelProduct} from '../services/library-panel-navigation';
interface ManagementSurface {element: HTMLDivElement | null; setElement(element: HTMLDivElement | null): void}
const Context = createContext<ManagementSurface | null>(null);
/** A DOM destination only. Jobs, Start intent and the single save/Exit blocker
 * remain in their existing document-lifetime owners above the routed sheet. */
export function ManagementSurfaceProvider({children, runtimeSnapshot}: {children: ReactNode; runtimeSnapshot?: RuntimeSnapshot | null}) {
  const [slot, setElement] = useState<HTMLDivElement | null>(null);
  const location = useLocation(), hosted = useRuntimeSnapshot();
  const runtime = runtimeSnapshot === undefined ? hosted : runtimeSnapshot;
  const playerVisible = !!runtime && (runtime.launched || runtime.phase === 'launching' || runtime.phase === 'error' && runtime.ready);
  const element = libraryPanelProduct(location.pathname) && !playerVisible ? slot : null;
  const value = useMemo(() => ({element, setElement}), [element]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ManagementSurfaceSlot({floating = false}: {floating?: boolean}) {
  const surface = useContext(Context);
  return <div ref={surface?.setElement} data-management-surface={floating ? 'room' : 'library'}/>;
}
/** Portal the existing presentation, never a duplicate controller/toolbar.
 * Fixtures without a management sheet retain the existing player placement. */
export function ManagementSurfacePortal({children}: {children(docked: boolean): ReactNode}) {
  const target = useContext(Context)?.element;
  return target ? createPortal(children(true), target) : children(false);
}
