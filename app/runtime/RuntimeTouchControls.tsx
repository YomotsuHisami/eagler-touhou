import {lazy, Suspense} from 'react';
import {useRuntimeSnapshot} from './RuntimeHost';
const RuntimeTouchOverlay = lazy(() => import('./RuntimeTouchOverlay'));
/** Eager root shell; the control/editor geometry and gesture code load only for a live session. */
export function RuntimeTouchControls() {
  const snapshot = useRuntimeSnapshot();
  if (!snapshot?.launched || !snapshot.ready || snapshot.spectator) return null;
  return <Suspense fallback={null}><RuntimeTouchOverlay/></Suspense>;
}
