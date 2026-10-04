import type {HostedKeyboard} from '../../src/launcher/hosted-keyboard.mts';
import {createPlayerFullscreenKeySequence} from '../services/player-tools.client';
import type {RuntimeService} from '../services/runtime.client';

interface KeyboardEventTarget {
  addEventListener(type: string, listener: EventListener, capture?: boolean): void;
  removeEventListener(type: string, listener: EventListener, capture?: boolean): void;
}
export interface RuntimeKeyboardBindingPorts {
  host: KeyboardEventTarget;
  document: KeyboardEventTarget & {readonly visibilityState: DocumentVisibilityState};
  element: typeof Element;
  frame(): {readonly isConnected?: boolean} | null;
  service: Pick<RuntimeService, 'getInputContext' | 'postInput'>;
  /** RuntimeProvider retains this owner across effect replay. */
  keyboard: HostedKeyboard;
}

/** Bind the permanent host's existing input owner without creating a Runtime,
 * replacing its frame, or taking ownership of trusted iframe resume input. */
export function bindRuntimeKeyboard({host, document, element, frame, service, keyboard}: RuntimeKeyboardBindingPorts) {
  const fullscreenKeys = createPlayerFullscreenKeySequence();
  let fullscreenEpoch: number | null = null;
  const forward: EventListener = input => {
    const event = input as KeyboardEvent;
    const context = service.getInputContext();
    if (fullscreenEpoch !== context.epoch) {fullscreenEpoch = context.epoch;fullscreenKeys.reset();}
    // This listener is installed before player chrome. Reserve both sides
    // of Alt+Enter so its release-only fallback cannot reach native input.
    if (fullscreenKeys.accept(event).handled) return;
    const launcherOwnsFocus = event.target instanceof element && !!event.target.closest('input,select,textarea,button,a,summary,[contenteditable],dialog,[role="dialog"],[role="button"]');
    const keys = keyboard.forward(event,context,launcherOwnsFocus);
    for(const key of keys) service.postInput('keyboard',{down:event.type === 'keydown',...key});
    if(keys.length) event.preventDefault();
  };
  const clear = () => {fullscreenKeys.reset();keyboard.clear();if(frame()?.isConnected === true)service.postInput('keyboard-clear',{});};
  const visibility = () => {if(document.visibilityState === 'hidden') clear();};
  host.addEventListener('keydown',forward,true);host.addEventListener('keyup',forward,true);
  host.addEventListener('blur',clear);host.addEventListener('pagehide',clear);
  document.addEventListener('visibilitychange',visibility);
  return () => {
    host.removeEventListener('keydown',forward,true);host.removeEventListener('keyup',forward,true);
    host.removeEventListener('blur',clear);host.removeEventListener('pagehide',clear);
    document.removeEventListener('visibilitychange',visibility);
    clear();
  };
}
