import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useLocation, useNavigate, type Location, type NavigateFunction, type NavigateOptions, type To } from 'react-router';

type CloseState = { location: Location; navigation: { location?: Location } };
type CloseValidation = () => boolean | Promise<boolean>;

/** Event-time route ownership, independent of a delayed React route commit. */
export function createCloseIntentController(getState: () => CloseState, navigate: NavigateFunction) {
  let mounted = true;
  let activeIntent: { originKey: string } | null = null;
  async function request(fallback: string, validate?: CloseValidation, expectedKey?: string, cancelPendingOpen = false) {
    const before = getState();
    const origin = before.location;
    if (!mounted || (expectedKey !== undefined && expectedKey !== origin.key)) return false;
    if (activeIntent?.originKey === origin.key) return false;
    const intent = { originKey: origin.key };
    activeIntent = intent;
    let committed = false;
    try {
      if (validate && !await validate()) return false;
      const current = getState();
      if (!mounted || activeIntent !== intent || current.location.key !== origin.key || current.navigation.location?.key !== before.navigation.location?.key) return false;
      const state = origin.state as { from?: unknown } | null;
      committed = true;
      if (cancelPendingOpen) {
        // The child has not entered history yet. Abort its loader/navigation by
        // replacing the still-current parent, preserving its query and state.
        await navigate({ pathname: origin.pathname, search: origin.search, hash: origin.hash }, { replace: true, state: origin.state });
      } else if (typeof state?.from === 'string' && state.from.startsWith('/') && !state.from.startsWith('//')) {
        // Only explicit same-app navigation records authorize a history pop.
        await navigate(-1);
      } else {
        await navigate(fallback, { replace: true });
      }
      return true;
    } catch (error) {
      committed = false;
      throw error;
    } finally {
      if (!committed && activeIntent === intent) activeIntent = null;
    }
  }
  return {
    close: request,
    synchronize() { if (activeIntent && activeIntent.originKey !== getState().location.key) activeIntent = null; },
    setMounted(next: boolean) { mounted = next; if (!next) activeIntent = null; },
    dismissNested(fallback: string) {
      const state = getState();
      const parentPath = fallback.replace(/\/$/, '');
      const isParent = (pathname: string) => pathname.replace(/\/$/, '') === parentPath;
      const isChild = (pathname: string) => pathname.startsWith(`${parentPath}/`) && !isParent(pathname);
      const pending = state.navigation.location;
      // A newer navigation outside this panel's parent always wins.
      if (pending && !isChild(pending.pathname)) return null;
      const pendingOpen = isParent(state.location.pathname) && !!pending && isChild(pending.pathname);
      if (!pendingOpen && !isChild(state.location.pathname)) return null;
      return request(fallback, undefined, state.location.key, pendingOpen);
    },
  };
}

/** One authoritative close per location; validation cannot act on a newer route. */
export function useCloseIntent(fallback: string, { dismissNestedOnEscape = false } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  // React Router commits its authoritative state before its transition renders.
  // Reading that state at event time covers both cold lazy opens and that gap.
  const dataRouter = useContext(UNSAFE_DataRouterContext)?.router;
  const current = useRef({ location, navigate });
  current.current = { location, navigate };
  const controllerRef = useRef<ReturnType<typeof createCloseIntentController> | null>(null);
  if (!controllerRef.current) controllerRef.current = createCloseIntentController(
    () => dataRouter?.state ?? { location: current.current.location, navigation: {} },
    (to: To | number, options?: NavigateOptions) =>
      typeof to === 'number' ? current.current.navigate(to) : current.current.navigate(to, options),
  );
  const controller = controllerRef.current;
  useLayoutEffect(() => {
    controller.setMounted(true);
    const unsubscribe = dataRouter?.subscribe(() => controller.synchronize());
    return () => { unsubscribe?.(); controller.setMounted(false); };
  }, [controller, dataRouter]);
  useLayoutEffect(() => {
    if (!dismissNestedOnEscape) return;
    const onEscape = (event: KeyboardEvent) => {
      // Once committed, the top live Dialog owns Escape, including nested local
      // dialogs. This listener covers only the route-open gap before that point.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[data-ui-dialog-live]')) return;
      if (controller.dismissNested(fallback)) event.preventDefault();
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [controller, dismissNestedOnEscape, fallback]);
  return useCallback((validate?: CloseValidation) => controller.close(fallback, validate, location.key), [controller, fallback, location.key]);
}
