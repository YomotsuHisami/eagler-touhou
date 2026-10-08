import {lazy, Suspense} from 'react';
import {useRuntimeSnapshot} from './RuntimeHost';
const RuntimeTouchOverlay = lazy(() => import('./RuntimeTouchOverlay'));
const MultiplayerQuickChat = lazy(() => import('./MultiplayerQuickChat'));
/** Eager root shell; the control/editor geometry and gesture code load only for a live session. */
export function RuntimeTouchControls() {
  const snapshot = useRuntimeSnapshot();
  const touchControls = !!snapshot?.launched && snapshot.ready && !snapshot.spectator;
  const quickChat = !!snapshot?.launched && snapshot.runtimeVariant === 'multiplayer';
  if (!touchControls && !quickChat) return null;
  return <>
    {quickChat && <Suspense fallback={null}><MultiplayerQuickChat/></Suspense>}
    {touchControls && <Suspense fallback={null}><RuntimeTouchOverlay/></Suspense>}
  </>;
}
