import {createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode} from 'react';
import {useLocation, useNavigate, useNavigation} from 'react-router';
import {createLibraryPanelNavigation} from '../services/library-panel-navigation';
const Context = createContext<ReturnType<typeof createLibraryPanelNavigation> | null>(null);
export function LibraryPanelNavigationProvider({children}: {children: ReactNode}) {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate(), id = useId();
  const go = useRef(navigate); go.current = navigate;
  const owner = useRef<ReturnType<typeof createLibraryPanelNavigation> | null>(null);
  owner.current ??= createLibraryPanelNavigation(id, (target, options) => typeof target === 'number' ? go.current(target) : go.current(target, options), {location, navigation});
  const controller = owner.current;
  useLayoutEffect(() => {controller.update({location, navigation});}, [controller, location, navigation]);
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
/** Optional so standalone catalog/SSR fixtures retain ordinary Router links. */
export function useLibraryPanelNavigation() {return useContext(Context);}
