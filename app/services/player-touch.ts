import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import {postHostedKey, postTouchControls, postTouchCancel, type HostedKeySpec, type TouchControlsSnapshot} from '../../src/launcher/touch-runtime-protocol.mts';
import {createFunctionKeyOwner, functionKeySpec} from '../../src/launcher/touch-function-key.mts';
import type {SettingsSnapshot} from '../models/game-settings';
import type {RuntimeService, RuntimeMidiEventContext} from './runtime';
import {bindPlayerDirectTouch, type TouchZoomPort} from './player-direct-touch';
import {bindPlayerJoystick} from './player-joystick';

export interface PlayerTouchElements {
  frame: HTMLElement; directSurface: HTMLElement; fire: HTMLElement; focus: HTMLElement;
  functionKey: HTMLElement; escape: HTMLElement; bomb: HTMLElement; restart: HTMLElement;
  joystick: HTMLElement; joystickKnob: HTMLElement;
  thpracBackspace: HTMLElement; thpracKeys: readonly HTMLElement[];
}
export interface PlayerTouchSnapshot extends Readonly<TouchControlsSnapshot> {
  heldFire: boolean; functionDown: boolean; thpracMenuOpen: boolean;
}
/** Main1874/8983: one document-lived auto-fire choice, not durable preferences.
 * Gesture owners may be recreated; reset/dispose must leave this value intact. */
export interface TouchFireStatePort {
  getEnabled(): boolean;
  setEnabled(value: boolean): void;
}
export interface PlayerTouchOptions {
  runtime: Pick<RuntimeService, 'getInputContext' | 'getMidiEventContext' | 'getSnapshot' | 'subscribe'>;
  getSettings(): SettingsSnapshot | null;
  fireState: TouchFireStatePort;
  editing(): boolean;
  playerOpen(): boolean;
  iosWebKitTouch: boolean;
  refocus(): void;
  elements: PlayerTouchElements;
  zoom: TouchZoomPort;
  document: Document;
  window: Window;
}
const thpracKeys: Readonly<Record<string, HostedKeySpec>> = Object.freeze(Object.fromEntries([
  ['Tab', 'Tab', 9], ['Backspace', 'Backspace', 8], ['F1', 'F1', 112], ['F2', 'F2', 113],
  ['F3', 'F3', 114], ['F4', 'F4', 115], ['F5', 'F5', 116], ['F6', 'F6', 117], ['F7', 'F7', 118], ['U', 'KeyU', 85], ['F12', 'F12', 123],
].map(([key, code, keyCode]) => [key, {code: String(code), key: String(key), keyCode: Number(keyCode)}])));
const restartKey = Object.freeze({code: 'KeyR', key: 'r', keyCode: 82});
/** Runtime input ownership only. HUD copy/layout/visibility remain shared view
 * concerns; gesture-local geometry/knob transforms intentionally avoid React's
 * render hot path. Active settings are captured by the launch owner. */
export function createPlayerTouch(options: PlayerTouchOptions) {
  const {runtime, elements: el, iosWebKitTouch: ios, window: win, document: doc} = options;
  const cleanup: (() => void)[] = [], listeners = new Set<() => void>();
  const timers = new Set<number>();
  let disposed = false, muted = false, heldFire = false, firePointer: number | null = null;
  let heldFireKey: Readonly<HostedKeySpec> | null = null, functionDown = false, thpracMenuOpen = false;
  let raf: number | null = null;
  let native: RuntimeMidiEventContext | null = null, unbindNative: (() => void) | null = null;
  let identity = runtime.getInputContext();
  const controls: TouchControlsSnapshot = {fireEnabled: options.fireState.getEnabled(), focusEnabled: false, bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0};
  let snapshot: PlayerTouchSnapshot = Object.freeze({...controls, heldFire: false, functionDown: false, thpracMenuOpen: false});
  function publish() {
    const next = {...controls, heldFire, functionDown, thpracMenuOpen};
    if ((Object.keys(next) as (keyof typeof next)[]).every(key => next[key] === snapshot[key])) return;
    snapshot = Object.freeze(next); for (const listener of listeners) listener();
  }
  const context = () => {
    const value = runtime.getInputContext();
    return disposed || muted || value.spectator ? {...value, launched: false, target: null} : value;
  };
  const settings = () => options.getSettings();
  const allowed = () => !disposed && !options.editing() && options.playerOpen() && !!settings()?.options.touchEnabled && !!context().launched;
  const heldMode = () => {const game = settings()?.gameId; return !!game && PRODUCT_GAMES[game].touchFire.mode === 'held-key';};
  const key = (spec: Readonly<HostedKeySpec>, down: boolean) => postHostedKey(context(), spec, down);
  function syncControls() {
    const current = settings(); if (!current) return false;
    return postTouchControls(context(), heldMode() ? {...controls, fireEnabled: false} : controls, current.options.touchSensitivity);
  }
  function queueControls() {
    if (raf !== null || !context().launched) return;
    raf = win.requestAnimationFrame(() => {raf = null; if (!disposed) syncControls();});
  }
  const direct = bindPlayerDirectTouch({surface: el.directSurface, frame: el.frame, ios, zoom: options.zoom, context, allowed});
  const joystick = bindPlayerJoystick({element: el.joystick, knob: el.joystickKnob, allowed,
    movement: () => settings()?.options.touchMovementMode ?? 'touch',
    axes(x, y) {controls.joystickX = x; controls.joystickY = y;}, schedule: queueControls});
  function refocus() {if (!(ios && direct.hasPointers())) options.refocus();}
  const functionOwner = createFunctionKeyOwner(down => {functionDown = down; publish(); key(functionKeySpec, down);});
  function on<K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, config?: AddEventListenerOptions) {
    element.addEventListener(type, listener, config); cleanup.push(() => element.removeEventListener(type, listener, config));
  }
  function capture(element: HTMLElement, event: PointerEvent) {try {element.setPointerCapture(event.pointerId);} catch {}}
  function setFocus(value: boolean) {
    if (!context().launched || settings()?.options.touchFocusMode === 'two-finger' || controls.focusEnabled === value) return;
    controls.focusEnabled = value; publish(); refocus(); syncControls();
  }
  on(el.focus, 'pointerdown', event => {
    if (ios || !allowed() || settings()?.options.touchFocusMode === 'two-finger') return;
    event.preventDefault(); capture(el.focus, event);
    setFocus(settings()?.options.touchFocusMode === 'hold-button' ? true : !controls.focusEnabled);
  });
  const releaseFocus = (event: PointerEvent) => {if (ios || settings()?.options.touchFocusMode !== 'hold-button') return; event.preventDefault(); setFocus(false);};
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) on(el.focus, type, releaseFocus);
  on(el.focus, 'touchstart', event => {
    if (!ios || !allowed() || settings()?.options.touchFocusMode === 'two-finger') return;
    event.preventDefault(); setFocus(settings()?.options.touchFocusMode === 'hold-button' ? true : !controls.focusEnabled);
  }, {passive: false});
  for (const type of ['touchend', 'touchcancel'] as const) on(el.focus, type, event => {
    if (!ios || settings()?.options.touchFocusMode !== 'hold-button') return; event.preventDefault(); setFocus(false);
  }, {passive: false});
  on(el.focus, 'click', event => {if (event.detail === 0 && allowed() && settings()?.options.touchFocusMode === 'toggle-button') setFocus(!controls.focusEnabled);});
  on(el.functionKey, 'pointerdown', event => {
    if (ios || !allowed() || el.functionKey.hidden) return; event.preventDefault();
    if (functionOwner.down(event.pointerId)) capture(el.functionKey, event);
  });
  on(el.functionKey, 'pointerup', event => {if (!ios) {event.preventDefault(); functionOwner.up(event.pointerId);}});
  for (const type of ['pointercancel', 'lostpointercapture'] as const) on(el.functionKey, type, event => {if (!ios) functionOwner.lost(event.pointerId);});
  on(el.functionKey, 'touchstart', event => {
    if (!ios || !allowed() || el.functionKey.hidden || !event.changedTouches.length) return;
    event.preventDefault(); functionOwner.down(event.changedTouches[0].identifier);
  }, {passive: false});
  on(el.functionKey, 'touchend', event => {if (ios) {event.preventDefault(); for (const touch of Array.from(event.changedTouches)) functionOwner.up(touch.identifier);}}, {passive: false});
  on(el.functionKey, 'touchcancel', event => {if (ios) for (const touch of Array.from(event.changedTouches)) functionOwner.lost(touch.identifier);});
  on(el.functionKey, 'click', event => {if (event.detail === 0 && allowed() && !el.functionKey.hidden) {functionOwner.down(-1); functionOwner.up(-1);}});
  function setHeldFire(held: boolean) {
    if (held) {
      const current = settings(); if (!current || !allowed() || heldFire) return;
      const fire = PRODUCT_GAMES[current.gameId].touchFire; if (fire.mode !== 'held-key') return;
      heldFire = true; heldFireKey = fire.key; publish(); key(fire.key, true);
    } else if (heldFire) {
      heldFire = false; const spec = heldFireKey; heldFireKey = null; publish(); if (spec) key(spec, false);
    }
  }
  function releaseHeldTouchFire() {firePointer = null; setHeldFire(false);}
  on(el.fire, 'pointerdown', event => {
    if (ios || firePointer !== null || !allowed() || !heldMode()) return;
    event.preventDefault(); firePointer = event.pointerId; capture(el.fire, event); setHeldFire(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) on(el.fire, type, event => {
    if (ios || firePointer !== event.pointerId) return; event.preventDefault(); releaseHeldTouchFire();
  });
  on(el.fire, 'touchstart', event => {if (ios && allowed() && heldMode()) {event.preventDefault(); setHeldFire(true);}}, {passive: false});
  for (const type of ['touchend', 'touchcancel'] as const) on(el.fire, type, event => {if (ios) {event.preventDefault(); releaseHeldTouchFire();}}, {passive: false});
  function pulse(spec: Readonly<HostedKeySpec>) {
    const captured = context(); if (!captured.launched) return;
    postHostedKey(captured, spec, true);
    const timer = win.setTimeout(() => {
      timers.delete(timer); const current = context();
      if (current.epoch === captured.epoch && current.target === captured.target && current.game === captured.game) postHostedKey(current, spec, false);
    }, 70); timers.add(timer); refocus();
  }
  function pulseThprac(name: string | undefined) {
    if (!name || !Object.hasOwn(thpracKeys, name) || !allowed() || !settings()?.options.thpracTouchControlsEnabled) return;
    pulse(thpracKeys[name]);
  }
  for (const button of [el.thpracBackspace, ...el.thpracKeys]) {
    const name = button === el.thpracBackspace ? 'Backspace' : button.dataset.thpracKey;
    on(button, 'pointerdown', event => {if (!allowed()) return; event.preventDefault(); event.stopPropagation(); pulseThprac(name);});
    on(button, 'click', event => {if (event.detail === 0 && allowed()) pulseThprac(name);});
  }
  const actions: [HTMLElement, () => void][] = [
    [el.fire, () => {controls.fireEnabled = !controls.fireEnabled; options.fireState.setEnabled(controls.fireEnabled); publish(); refocus(); syncControls();}],
    [el.bomb, () => {controls.bombSerial++; refocus(); syncControls();}],
    [el.escape, () => {controls.escapeSerial++; refocus(); syncControls();}],
    [el.restart, () => pulse(restartKey)],
  ];
  for (const [button, activate] of actions) {
    on(button, 'pointerdown', event => {if (!allowed() || (button === el.fire && heldMode())) return; event.preventDefault(); capture(button, event); activate();});
    on(button, 'click', event => {if (event.detail === 0 && allowed() && !(button === el.fire && heldMode())) activate();});
  }
  function cancelPointers() {
    functionOwner.cancel(); direct.cancel(false); joystick.reset(false); controls.focusEnabled = false; publish();
    postTouchCancel(context()); syncControls();
  }
  function reset(notify = true) {
    const previousMuted = muted; if (!notify) muted = true;
    releaseHeldTouchFire(); functionOwner.cancel(); direct.cancel(notify); joystick.reset(false);
    if (raf !== null) win.cancelAnimationFrame(raf); raf = null;
    for (const timer of timers) win.clearTimeout(timer); timers.clear();
    controls.focusEnabled = false; controls.bombSerial = 0; controls.escapeSerial = 0; thpracMenuOpen = false;
    muted = previousMuted; publish();
  }
  function sync() {
    if (disposed) return;
    const current = runtime.getInputContext();
    if (identity.epoch !== current.epoch || identity.target !== current.target || identity.game !== current.game) {reset(false); identity = current;}
    if (!allowed()) {releaseHeldTouchFire(); functionOwner.cancel(); direct.cancel(); joystick.reset(false);}
    const next = runtime.getMidiEventContext();
    if (native?.epoch !== next?.epoch || native?.document !== next?.document || native?.target !== next?.target) {
      unbindNative?.(); unbindNative = null; native = next;
      if (next) {
        const handler: EventListener = event => {
          const now = runtime.getMidiEventContext(); if (now?.epoch !== next.epoch || now.document !== next.document || now.target !== next.target) return;
          const detail: unknown = (event as CustomEvent<unknown>).detail;
          thpracMenuOpen = !!detail && typeof detail === 'object' && 'open' in detail && detail.open === true; publish();
        };
        next.target.addEventListener('eagler-thprac-menu', handler); unbindNative = () => next.target.removeEventListener('eagler-thprac-menu', handler);
      }
    }
    publish();
  }
  const visibility = () => {if (doc.visibilityState === 'hidden') cancelPointers();};
  const blur = () => {queueMicrotask(() => {if (!disposed && !doc.hasFocus()) cancelPointers();});};
  doc.addEventListener('visibilitychange', visibility); win.addEventListener('blur', blur);
  win.addEventListener('resize', direct.invalidate, {passive: true}); win.visualViewport?.addEventListener('resize', direct.invalidate, {passive: true});
  doc.addEventListener('fullscreenchange', direct.invalidate); doc.addEventListener('webkitfullscreenchange', direct.invalidate);
  const unsubscribe = runtime.subscribe(sync); sync();
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
    sync, syncControls, reset, cancelPointers, releaseHeldTouchFire, cancelTouchFunction: () => functionOwner.cancel(),
    hasDirectPointers: direct.hasPointers, pulseThprac,
    dispose() {
      if (disposed) return; reset(); disposed = true; unsubscribe(); unbindNative?.();
      direct.dispose(); joystick.dispose(); for (const off of cleanup) off(); listeners.clear();
      doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('blur', blur);
      win.removeEventListener('resize', direct.invalidate); win.visualViewport?.removeEventListener('resize', direct.invalidate);
      doc.removeEventListener('fullscreenchange', direct.invalidate); doc.removeEventListener('webkitfullscreenchange', direct.invalidate);
    },
  };
}
export type PlayerTouch = ReturnType<typeof createPlayerTouch>;
