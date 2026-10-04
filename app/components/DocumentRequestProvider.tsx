import {createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createDocumentRequestScope} from '../services/document-request-scope';

const Context = createContext<ReturnType<typeof createDocumentRequestScope> | null>(null);

/** One request-start boundary is mounted before the lazy document services.
 * StrictMode replay retains it; final unmount closes all held requests.
 */
export function DocumentRequestProvider({children}: {children: ReactNode}) {
  const [scope] = useState(() => typeof window === 'undefined' ? null
    : createDocumentRequestScope({target: window, fetchImpl: window.fetch.bind(window),
      canResume: () => document.visibilityState === 'visible'}));
  const epoch = useRef(0);
  useLayoutEffect(() => {
    if (!scope) return;
    const effect = ++epoch.current;
    scope.attach();
    return () => {
      scope.detach();
      queueMicrotask(() => {if (epoch.current === effect) scope.dispose();});
    };
  }, [scope]);
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}

export function useDocumentRequestFetch() {return useContext(Context)?.fetch;}
export function useDocumentRequestScope() {return useContext(Context);}
