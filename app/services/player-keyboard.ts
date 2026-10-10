import {HostedKeyboard} from '../../src/launcher/hosted-keyboard.mts';
import type {RuntimeService, RuntimeMidiEventContext} from './runtime';

export interface PlayerKeyboardOptions {
  runtime: Pick<RuntimeService, 'getInputContext' | 'getMidiEventContext' | 'getSnapshot' | 'postInput' | 'subscribe'>;
  window: EventTarget;
  document: EventTarget & {readonly visibilityState: string};
  frame: EventTarget & {focus(options?: FocusOptions): void; readonly contentWindow: {focus(): void} | null};
  playerOpen(): boolean;
  /** Original Element.closest(input,select,textarea,button,dialog,[role=dialog]). */
  launcherOwnsTarget(target: EventTarget | null): boolean;
  releaseHeldTouchFire(): void;
  cancelTouchFunction(): void;
  toggleFullscreen(): void;
  isPlayerFullscreen(): boolean;
  android: boolean;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}
function sameNativeContext(a: RuntimeMidiEventContext | null, b: RuntimeMidiEventContext | null) {
  return a === b || !!a && !!b && a.epoch === b.epoch && a.game === b.game && a.document === b.document && a.target === b.target;
}
/** Main's host keyboard + Android startup focus relay. Native key events remain
 * native; only Alt+Enter is intercepted in the current iframe window. */
export function createPlayerKeyboard(options: PlayerKeyboardOptions) {
  const keyboard = new HostedKeyboard();
  const now = options.now ?? (() => performance.now());
  const setInterval = options.setInterval ?? globalThis.setInterval;
  const clearInterval = options.clearInterval ?? globalThis.clearInterval;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let deadline = 0, disposed = false, chord = false;
  let bound: RuntimeMidiEventContext | null = null;
  let unbind: (() => void) | null = null;
  let identity = options.runtime.getInputContext();
  function stopFocusRelay() {
    if (timer !== null) clearInterval(timer);
    timer = null; deadline = 0;
  }
  function focusBrowsingContext() {
    if (!options.android || !options.playerOpen() || !options.frame.contentWindow) return;
    try {options.frame.focus({preventScroll: true});} catch {try {options.frame.focus();} catch {}}
    try {options.frame.contentWindow.focus();} catch {}
  }
  function keepFocused() {
    if (!deadline || now() >= deadline) {stopFocusRelay(); return;}
    if (options.document.visibilityState !== 'hidden') focusBrowsingContext();
  }
  function startFocusRelay() {
    if (disposed || !options.android) return;
    stopFocusRelay(); deadline = now() + 15000; keepFocused();
    timer = setInterval(keepFocused, 100);
  }
  const forward: EventListener = raw => {
    const event = raw as KeyboardEvent;
    const state = options.runtime.getSnapshot();
    if (!state.launched || !options.playerOpen() || !options.frame.contentWindow) {keyboard.clear(); return;}
    const context = options.runtime.getInputContext();
    const keys = keyboard.forward(event, context, options.launcherOwnsTarget(event.target));
    for (const key of keys) options.runtime.postInput('keyboard', {down: event.type === 'keydown', ...key});
    if (keys.length) event.preventDefault();
  };
  function clear() {
    options.releaseHeldTouchFire(); options.cancelTouchFunction(); keyboard.clear();
    if (!options.runtime.getSnapshot().launched || !options.frame.contentWindow) return;
    options.runtime.postInput('keyboard-clear', {});
  }
  function rebind() {
    if (disposed) return;
    const nextIdentity = options.runtime.getInputContext();
    if (identity.target !== nextIdentity.target || identity.game !== nextIdentity.game || identity.epoch !== nextIdentity.epoch) {
      // Runtime owns flushing the outgoing epoch; never send its key releases
      // to the replacement document/epoch.
      keyboard.clear(); options.releaseHeldTouchFire(); options.cancelTouchFunction(); chord = false;
      stopFocusRelay(); identity = nextIdentity;
    }
    const state = options.runtime.getSnapshot();
    if (state.firstFrame || !state.ready) stopFocusRelay();
    const next = options.runtime.getMidiEventContext();
    if (sameNativeContext(bound, next)) return;
    unbind?.(); unbind = null; bound = next;
    if (!next) return;
    const fullscreen: EventListener = raw => {
      if (!sameNativeContext(next, options.runtime.getMidiEventContext())) return;
      const event = raw as KeyboardEvent;
      if (event.type === 'keydown' && event.code === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && !chord) {chord = true; options.toggleFullscreen();}
      } else if (event.type === 'keyup' && event.code === 'Enter' && chord) {
        event.preventDefault(); event.stopImmediatePropagation(); chord = false;
      }
    };
    const target = next.target as EventTarget;
    target.addEventListener('keydown', fullscreen, true); target.addEventListener('keyup', fullscreen, true);
    unbind = () => {target.removeEventListener('keydown', fullscreen, true); target.removeEventListener('keyup', fullscreen, true);};
  }
  const visibility = () => {if (options.document.visibilityState === 'hidden') clear();};
  const fullscreenChange = () => {if (!options.isPlayerFullscreen()) chord = false;};
  options.window.addEventListener('keydown', forward, true);
  options.window.addEventListener('keyup', forward, true);
  options.window.addEventListener('blur', clear);
  options.window.addEventListener('pagehide', clear);
  options.document.addEventListener('visibilitychange', visibility);
  options.document.addEventListener('fullscreenchange', fullscreenChange);
  options.document.addEventListener('webkitfullscreenchange', fullscreenChange);
  options.frame.addEventListener('load', rebind);
  const unsubscribe = options.runtime.subscribe(rebind);
  rebind();
  return {
    clear, rebind, startFocusRelay, stopFocusRelay, focusBrowsingContext,
    dispose() {
      if (disposed) return;
      clear(); disposed = true; stopFocusRelay(); unsubscribe(); unbind?.(); unbind = null; bound = null;
      options.window.removeEventListener('keydown', forward, true);
      options.window.removeEventListener('keyup', forward, true);
      options.window.removeEventListener('blur', clear);
      options.window.removeEventListener('pagehide', clear);
      options.document.removeEventListener('visibilitychange', visibility);
      options.document.removeEventListener('fullscreenchange', fullscreenChange);
      options.document.removeEventListener('webkitfullscreenchange', fullscreenChange);
      options.frame.removeEventListener('load', rebind);
    },
  };
}
export type PlayerKeyboard = ReturnType<typeof createPlayerKeyboard>;
