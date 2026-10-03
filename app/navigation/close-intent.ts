import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** One authoritative close per location; validation cannot act on a newer route. */
export function useCloseIntent(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentLocation = useRef(location);
  const activeIntent = useRef<object | null>(null);
  const mounted = useRef(true);
  // Update before any pending validation continuation can commit old navigation.
  if (currentLocation.current.key !== location.key) activeIntent.current = null;
  currentLocation.current = location;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeIntent.current = null; };
  }, []);
  return useCallback(async (validate?: () => boolean | Promise<boolean>) => {
    if (activeIntent.current || !mounted.current) return false;
    const origin = currentLocation.current;
    const intent = {};
    activeIntent.current = intent;
    let committed = false;
    try {
      if (validate && !await validate()) return false;
      if (!mounted.current || activeIntent.current !== intent || currentLocation.current.key !== origin.key) return false;
      const state = origin.state as { from?: unknown } | null;
      committed = true;
      // Only explicit same-app navigation records authorize traversing history.
      if (typeof state?.from === 'string' && state.from.startsWith('/') && !state.from.startsWith('//')) {
        await navigate(-1);
      } else {
        await navigate(fallback, { replace: true });
      }
      return true;
    } catch (error) {
      committed = false;
      throw error;
    } finally {
      // Never clear a newer intent installed while this one was validating.
      if (!committed && activeIntent.current === intent) activeIntent.current = null;
    }
  }, [navigate, fallback]);
}
