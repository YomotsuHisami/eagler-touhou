import {createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {useLocation} from 'react-router';
import {useRuntimeService} from '../runtime/RuntimeHost';
import {createNavigationDraftRegistry, requiresUnloadConfirmation, type NavigationDraft} from '../services/navigation-drafts';
const Context = createContext<ReturnType<typeof createNavigationDraftRegistry> | null>(null);
export function NavigationDraftProvider({children}: {children: ReactNode}) {
  const [registry] = useState(createNavigationDraftRegistry);
  const location = useLocation(), runtime = useRuntimeService();
  useLayoutEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = runtime?.getSnapshot();
      const dirty = registry.blocking(location, {pathname: '', search: '', hash: ''}).length;
      if (requiresUnloadConfirmation(current, dirty)) {event.preventDefault();event.returnValue = '';}
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [registry, runtime, location]);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
export function useNavigationDraftRegistry() {return useContext(Context);}
/** Register unsaved edits with the one root blocker; no history or extra blocker. */
export function useNavigationDraftGuard(draft: Omit<NavigationDraft,'id'>) {
  const registry = useContext(Context), id = useId(), current = useRef(draft);
  useLayoutEffect(() => {current.current = draft;});
  useLayoutEffect(() => {
    if (!registry) throw new Error('Navigation drafts require the root provider');
    return registry.register({id, get label() {return current.current.label;},
      shouldBlock: (from,to) => current.current.shouldBlock(from,to),
      save: () => current.current.save(), discard: () => current.current.discard()});
  }, [registry,id]);
}
