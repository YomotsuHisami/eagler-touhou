import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {createPlayerFullscreenController, type PlayerFullscreenController, type PlayerFullscreenDocument, type PlayerKeyboardLock} from '../services/player-tools.client';
import type {RuntimeService} from '../services/runtime.client';
import {usePlayerSurface} from './PlayerToolsSurface';
import {useRuntimeViewport} from './RuntimeViewport';

const Context = createContext<PlayerFullscreenController | null | undefined>(undefined);
const noSubscribe = () => () => {}, noSnapshot = () => null;
export const usePlayerFullscreen = () => useContext(Context);

/** Fullscreen belongs to the Player, including DATA acquisition and native
 * code retries. Toolbar mounts and native epochs cannot retire that intent. */
export function PlayerFullscreenProvider({service, frame, children}: {
  service: RuntimeService | null; frame: RefObject<HTMLIFrameElement | null>; children: ReactNode;
}) {
  const surface = usePlayerSurface(), viewport = useRuntimeViewport();
  const snapshot = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? noSnapshot, noSnapshot);
  const [owner, setOwner] = useState<PlayerFullscreenController | null>(null);
  const retained = useRef<{element: HTMLDivElement; controller: PlayerFullscreenController} | null>(null);
  const current = useRef({service, viewport});current.current = {service, viewport};
  const intent = useRef({serial: 0, active: false}), lifetime = useRef(0);
  const active = surface?.starting === true || snapshot?.epoch != null || snapshot?.ready === true || snapshot?.launched === true;
  useEffect(() => {
    if (!surface?.element) return;
    const ticket = ++lifetime.current;
    if (retained.current && retained.current.element !== surface.element) {retained.current.controller.dispose();retained.current = null;}
    const controller = retained.current?.controller ?? createPlayerFullscreenController({document: document as PlayerFullscreenDocument, target: () => surface.element,
      keyboard: (navigator as Navigator & {keyboard?: PlayerKeyboardLock}).keyboard,
      cancelGesture: () => current.current.viewport?.cancelGesture(),
      focus: () => {
        const input = current.current.service?.getInputContext(), target = frame.current;
        if (input?.ready && input.launched && target?.isConnected && input.target === target.contentWindow &&
            !document.querySelector('[role="dialog"]')) target.focus({preventScroll: true});
      }});
    retained.current = {element: surface.element, controller};
    setOwner(controller);
    return () => {queueMicrotask(() => {
      // StrictMode replay must not exit a still-owned Player fullscreen.
      if (lifetime.current === ticket || !surface.element?.isConnected) {
        controller.dispose();if (retained.current?.controller === controller) retained.current = null;
      }
    });};
  }, [surface?.element, frame]);
  useLayoutEffect(() => {
    if (active && !intent.current.active) intent.current.serial++;
    intent.current.active = active;
    owner?.setSession(active ? intent.current.serial : null, active);
  }, [owner, active]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
