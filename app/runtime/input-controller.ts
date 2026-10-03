import { HostedKeyboard, type HostedKeyboardEvent } from '../../src/launcher/hosted-keyboard.mts';
import { PRODUCT_GAMES, type GameId } from '../../src/contracts/product-catalog.mts';
import { touchMovementUsesJoystick, type GameOptions } from '../../src/launcher/game-preferences.mts';
import {
  deliverRuntimeInput, postHostedKey, postDirectTouch, postTouchCancel, postTouchControls,
  type DirectTouchPoint, type HostedKeySpec, type TouchRuntimeContext,
} from '../../src/launcher/touch-runtime-protocol.mts';
import {joystickPoint, type InputRect} from './input-geometry';

export interface RuntimeInputState {
  fireEnabled: boolean; heldFire: boolean; focusEnabled: boolean;
  bombSerial: number; escapeSerial: number; joystickX: number; joystickY: number;
  visualX: number; visualY: number;
}
export interface RuntimeInputSource {
  getInputContext(): TouchRuntimeContext;
  getSnapshot(): {inputOptions: Readonly<GameOptions>; game: GameId | null};
}
const initialState = (): RuntimeInputState => ({fireEnabled: true, heldFire: false, focusEnabled: false,
  bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0, visualX: 0, visualY: 0});
const restartKey: HostedKeySpec = {code: 'KeyR', key: 'r', keyCode: 82};
export const practiceKeys: Readonly<Record<string, HostedKeySpec>> = Object.freeze(Object.fromEntries([
  ['Tab', 9], ['Backspace', 8], ['F1', 112], ['F2', 113], ['F3', 114], ['F4', 115],
  ['F5', 116], ['F6', 117], ['F7', 118], ['F12', 123],
].map(([name, code]) => [name, {code: String(name), key: String(name), keyCode: Number(code)}])));

/** React input ownership only. The canonical protocol/keyboard owners and each
 * Runtime still interpret key families, relative movement and touch gestures. */
export function createRuntimeInput(source: RuntimeInputSource, scheduler = {
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
}) {
  const keyboard = new HostedKeyboard();
  const direct = new Map<number, DirectTouchPoint>();
  const listeners = new Set<() => void>();
  const pulseTimers = new Map<ReturnType<typeof setTimeout>, {context: TouchRuntimeContext; key: HostedKeySpec}>();
  let state = initialState();
  let session: TouchRuntimeContext | null = null;
  let suspended = false;
  let nextDirectId = -1_000_000;
  let fireOwner: number | null = null;
  let focusOwner: number | null = null;
  let joystickOwner: number | null = null;
  let queued: number | null = null;
  let heldKey: HostedKeySpec | null = null;
  let heldContext: TouchRuntimeContext | null = null;
  const context = () => source.getInputContext();
  const options = () => source.getSnapshot().inputOptions;
  const canInput = () => {const value = context(); return !suspended && value.ready && value.launched && !value.spectator && !!value.target;};
  const canTouch = () => canInput() && options().touchEnabled;
  const sameSession = (a: TouchRuntimeContext | null, b: TouchRuntimeContext) =>
    a?.target === b.target && a.game === b.game && a.epoch === b.epoch;
  const heldFireMode = () => {const game = source.getSnapshot().game; return game ? PRODUCT_GAMES[game].touchFire : null;};
  function update(patch: Partial<RuntimeInputState>) {state = Object.freeze({...state, ...patch}); listeners.forEach(listener => listener());}
  function clearScheduled(releasePulses = false) {
    if (queued !== null) scheduler.cancel(queued); queued = null;
    for (const [timer, pulse] of pulseTimers) {
      clearTimeout(timer);
      if (releasePulses && sameSession(pulse.context, context()) && !context().spectator) postHostedKey(pulse.context, pulse.key, false);
    }
    pulseTimers.clear();
  }
  function controlsSnapshot(fireEnabled = state.fireEnabled) {
    return {fireEnabled, focusEnabled: state.focusEnabled, bombSerial: state.bombSerial, escapeSerial: state.escapeSerial, joystickX: state.joystickX, joystickY: state.joystickY};
  }
  function push() {
    if (!canTouch()) return false;
    return postTouchControls(context(), controlsSnapshot(heldFireMode()?.mode === 'held-key' ? false : state.fireEnabled), options().touchSensitivity);
  }
  function queuePush() {
    if (queued !== null || !canTouch()) return;
    queued = scheduler.request(() => {queued = null; push();});
  }
  function releaseFire() {
    fireOwner = null;
    if (!heldKey) return;
    const key = heldKey; heldKey = null;
    // Releasing an installed key remains necessary during an overlay transition.
    const value = context();
    if (!value.spectator && sameSession(heldContext, value)) postHostedKey(value, key, false);
    heldContext = null;
    update({heldFire: false});
  }
  function clearKeyboard() {
    releaseFire(); keyboard.clear();
    const value = context();
    if (!value.launched || !value.ready || !value.target || value.spectator) return;
    deliverRuntimeInput(value, {protocol: value.protocol, game: value.game, epoch: value.epoch, command: 'keyboard-clear'});
  }
  function cancelTransient() {
    clearScheduled(true); direct.clear(); focusOwner = null; joystickOwner = null;
    releaseFire();
    update({focusEnabled: false, joystickX: 0, joystickY: 0, visualX: 0, visualY: 0});
    const value = context();
    if (!value.spectator) postTouchCancel(value);
    push();
  }
  function synchronizeSession() {
    const next = context();
    if (sameSession(session, next) && session?.launched === next.launched && session.spectator === next.spectator) return;
    // Never send an old pointer/key release to a replacement epoch.
    clearScheduled(); keyboard.clear(); direct.clear(); heldKey = null; heldContext = null;
    fireOwner = focusOwner = joystickOwner = null;
    session = next; update(initialState());
    push();
  }
  function setSuspended(value: boolean) {
    if (suspended === value) return;
    if (value) {
      clearKeyboard(); cancelTransient();
      const current = context();
      if (!current.spectator) postTouchControls(current, controlsSnapshot(false), options().touchSensitivity);
    }
    suspended = value;
    if (!value) push();
  }
  function forwardKeyboard(event: HostedKeyboardEvent, launcherOwnsFocus: boolean) {
    const value = context();
    const keys = keyboard.forward(event, value, suspended || launcherOwnsFocus);
    if (!value.spectator) for (const key of keys) postHostedKey(value, key, event.type === 'keydown');
    return keys.length > 0;
  }
  function fireDown(id: number) {
    if (!canTouch() || fireOwner !== null) return false;
    const fire = heldFireMode();
    if (fire?.mode !== 'held-key') {update({fireEnabled: !state.fireEnabled}); push(); return true;}
    fireOwner = id; heldKey = fire.key; heldContext = context(); update({heldFire: true});
    postHostedKey(context(), fire.key, true); return true;
  }
  function fireUp(id: number) {if (id === fireOwner) releaseFire();}
  function focusDown(id: number) {
    if (!canTouch() || options().touchFocusMode === 'two-finger' || focusOwner !== null) return false;
    focusOwner = id;
    update({focusEnabled: options().touchFocusMode === 'hold-button' ? true : !state.focusEnabled}); push(); return true;
  }
  function focusUp(id: number) {
    if (id !== focusOwner) return;
    focusOwner = null;
    if (options().touchFocusMode === 'hold-button') {update({focusEnabled: false}); push();}
  }
  function pulseKey(key: HostedKeySpec) {
    if (!canTouch()) return;
    const original = context();
    postHostedKey(original, key, true);
    const timer = setTimeout(() => {
      pulseTimers.delete(timer);
      if (sameSession(original, context()) && !context().spectator) postHostedKey(original, key, false);
    }, 70);
    pulseTimers.set(timer, {context: original, key});
  }
  function action(name: 'bomb' | 'escape' | 'restart' | string) {
    if (!canTouch()) return;
    if (name === 'bomb') {update({bombSerial: state.bombSerial + 1}); push();}
    else if (name === 'escape') {update({escapeSerial: state.escapeSerial + 1}); push();}
    else if (name === 'restart' && options().restartButtonEnabled) pulseKey(restartKey);
    else if (practiceKeys[name] && options().thpracEnabled && options().thpracTouchControlsEnabled) pulseKey(practiceKeys[name]);
  }
  function directDown(id: number, point: {x: number; y: number}) {
    if (!canTouch() || touchMovementUsesJoystick(options().touchMovementMode) || direct.has(id)) return false;
    const contact = {id: nextDirectId--, ...point}; direct.set(id, contact);
    return postDirectTouch(context(), 'down', contact);
  }
  function directMove(id: number, point: {x: number; y: number}) {
    const contact = direct.get(id); if (!contact || !canTouch()) return false;
    Object.assign(contact, point); return postDirectTouch(context(), 'move', contact);
  }
  function directUp(id: number, point?: {x: number; y: number}) {
    const contact = direct.get(id); if (!contact) return false;
    direct.delete(id); if (point) Object.assign(contact, point);
    return sameSession(session, context()) && !context().spectator && postDirectTouch(context(), 'up', contact);
  }
  function joystickMove(id: number, point: {clientX: number; clientY: number}, rect: InputRect) {
    if (id !== joystickOwner || !canTouch()) return false;
    const next = joystickPoint(rect, point); if (!next) return false;
    update(next); queuePush(); return true;
  }
  function joystickDown(id: number, point: {clientX: number; clientY: number}, rect: InputRect) {
    if (!canTouch() || !touchMovementUsesJoystick(options().touchMovementMode) || joystickOwner !== null) return false;
    joystickOwner = id; return joystickMove(id, point, rect);
  }
  function joystickUp(id: number) {
    if (id !== joystickOwner) return;
    joystickOwner = null; update({joystickX: 0, joystickY: 0, visualX: 0, visualY: 0}); queuePush();
  }
  return {
    getSnapshot: () => state, subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    synchronizeSession, syncControls: push, setSuspended, forwardKeyboard, clearKeyboard, cancelTransient,
    fireDown, fireUp, focusDown, focusUp, action, directDown, directMove, directUp,
    joystickDown, joystickMove, joystickUp, hasDirectTouches: () => direct.size > 0,
    dispose() {clearKeyboard(); cancelTransient(); clearScheduled(); listeners.clear();},
  };
}
export type RuntimeInput = ReturnType<typeof createRuntimeInput>;
