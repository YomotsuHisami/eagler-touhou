import {createContext, useCallback, useContext, type RefObject} from 'react';

export interface OptionsTargets {
  selectedCard: HTMLElement | null;
  panel: HTMLElement | null;
}
/** DOM-free ports: library and directory register only their own live nodes. */
export const OptionsOwnership = createContext<OptionsTargets | null>(null);
export function useOptionsTarget(target: keyof OptionsTargets, local?: RefObject<HTMLElement | null>) {
  const owner = useContext(OptionsOwnership);
  return useCallback((node: HTMLElement | null) => {
    if (local) local.current = node;
    if (!node) return;
    if (owner) owner[target] = node;
    // A stale callback cleanup may not clear a newer registration.
    return () => {
      if (owner?.[target] === node) owner[target] = null;
      if (local?.current === node) local.current = null;
    };
  }, [owner, target, local]);
}
