/** Player chrome owns no Runtime, render clock, viewport transform or network channel. */
import {createFunctionKeyOwner} from '../../src/launcher/touch-function-key.mts';
import type {RuntimeService} from './runtime.client';

export const PLAYER_KEYBOARD_LOCK_CODES = Object.freeze([
  'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyX',
  'ShiftLeft', 'ShiftRight', 'Enter', 'Tab', 'Backspace', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F12',
]);
export interface PlayerFullscreenTarget {
  requestFullscreen?(options?: FullscreenOptions): Promise<void>;
  webkitRequestFullscreen?(): void | Promise<void>;
}
export interface PlayerFullscreenDocument {
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  readonly documentElement?: unknown;
  exitFullscreen?(): Promise<void>;
  webkitExitFullscreen?(): void | Promise<void>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface PlayerKeyboardLock {lock?(codes: string[]): Promise<void>; unlock?(): void}
export type PlayerFullscreenFailure = 'unsupported' | 'unconfirmed' | 'foreign' | 'failed';
export interface PlayerFullscreenSnapshot {
  readonly fullscreen: boolean;
  readonly busy: boolean;
  readonly failure: PlayerFullscreenFailure | null;
  readonly reason: string | null;
  readonly keyboard: 'off' | 'unavailable' | 'locking' | 'locked' | 'failed';
  readonly keyboardReason: string | null;
}
export interface PlayerFullscreenPorts {
  document: PlayerFullscreenDocument;
  target(): PlayerFullscreenTarget | null;
  keyboard?: PlayerKeyboardLock;
  focus(): void;
  cancelGesture(): void;
  schedule?(callback: () => void, ms: number): unknown;
  cancel?(token: unknown): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Shared fullscreen primitives for the running game and its Launcher preview surfaces. */
export async function requestPlayerFullscreen(target: PlayerFullscreenTarget) {
  if (target.requestFullscreen) await target.requestFullscreen({navigationUI: 'hide'});
  else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
  else throw new Error('Fullscreen request is unavailable');
}
export async function exitPlayerFullscreen(doc: PlayerFullscreenDocument) {
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
  else throw new Error('Fullscreen exit is unavailable');
}

/** Call toggle synchronously from a user gesture. A rejected request never becomes success. */
export function createPlayerFullscreenController(ports: PlayerFullscreenPorts) {
  const doc = ports.document, listeners = new Set<() => void>();
  const schedule = ports.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = ports.cancel ?? (token => clearTimeout(token as ReturnType<typeof setTimeout>));
  let disposed = false, serial = 0, epoch: number | null = null, live = false, lockSerial = 0;
  let latestRequest: {serial: number; epoch: number | null} | null = null;
  let wait: {finish(value: boolean): void} | null = null;
  let state: PlayerFullscreenSnapshot = Object.freeze({fullscreen: false, busy: false, failure: null, reason: null, keyboard: 'off', keyboardReason: null});
  const currentElement = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const isPlayer = () => !!currentElement() && currentElement() === ports.target();
  function update(patch: Partial<PlayerFullscreenSnapshot>) {
    if (disposed) return;
    const next = {...state, ...patch};
    if (Object.keys(next).every(key => next[key as keyof typeof next] === state[key as keyof typeof state])) return;
    state = Object.freeze(next);for (const listener of [...listeners]) listener();
  }
  function unlock() {
    lockSerial++;try {ports.keyboard?.unlock?.();} catch { /* Optional browser enhancement. */ }
    update({keyboard: 'off', keyboardReason: null});
  }
  async function lock() {
    if (!live || !isPlayer() || disposed || state.keyboard === 'locking' || state.keyboard === 'locked') return;
    if (!ports.keyboard?.lock) {update({keyboard: 'unavailable'});return;}
    const ticket = ++lockSerial, ownedEpoch = epoch;
    update({keyboard: 'locking', keyboardReason: null});
    try {
      await ports.keyboard.lock([...PLAYER_KEYBOARD_LOCK_CODES]);
      if (disposed || ticket !== lockSerial || ownedEpoch !== epoch || !live || !isPlayer()) {
        // A late grant must not relock keys after Escape, exit, or session retirement.
        try {ports.keyboard.unlock?.();} catch {}
        return;
      }
      update({keyboard: 'locked'});
    } catch (error) {
      if (!disposed && ticket === lockSerial && ownedEpoch === epoch && isPlayer()) update({keyboard: 'failed', keyboardReason: message(error)});
    }
  }
  const changed: EventListener = () => {
    ports.cancelGesture();const fullscreen = isPlayer();update({fullscreen});
    wait?.finish(true);
    if (!fullscreen) unlock();else if (live) void lock();
  };
  const failed: EventListener = () => {
    ports.cancelGesture();wait?.finish(false);
    if (live) update({failure: 'failed', reason: 'fullscreenerror'});
  };
  doc.addEventListener('fullscreenchange', changed);doc.addEventListener('webkitfullscreenchange', changed);
  doc.addEventListener('fullscreenerror', failed);doc.addEventListener('webkitfullscreenerror', failed);
  function changedWithinDeadline(expected: boolean) {
    if (isPlayer() === expected) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      let timer: unknown;
      const waiter = {finish(value: boolean) {if (wait !== waiter) return;wait = null;cancel(timer);resolve(value && isPlayer() === expected);}};
      wait = waiter;timer = schedule(() => waiter.finish(false), 1500);
    });
  }
  function exit() {
    return exitPlayerFullscreen(doc);
  }
  function retire() {
    serial++;latestRequest = null;wait?.finish(false);unlock();
    // Only retire our own player surface. Do not close unrelated fullscreen content.
    if (currentElement() === ports.target()) {try {void Promise.resolve(exit()).catch(() => {});} catch {}}
    update({busy: false, failure: null, reason: null, fullscreen: isPlayer()});
  }
  async function toggle(): Promise<boolean> {
    if (disposed || !live || state.busy) return false;
    const ticket = ++serial, ownedEpoch = epoch;
    const target = ports.target(), wasPlayer = isPlayer(), foreign = !!currentElement() && !wasPlayer;
    update({busy: true, failure: null, reason: null});
    try {
      if (foreign) {update({failure: 'foreign'});return false;}
      if (wasPlayer) {
        await exit();
        if (ticket !== serial || ownedEpoch !== epoch || disposed) return false;
        if (!await changedWithinDeadline(false)) {update({failure: 'unconfirmed'});return false;}
        update({fullscreen: false});unlock();
        return true;
      }
      if (!target?.requestFullscreen && !target?.webkitRequestFullscreen) {update({failure: 'unsupported'});return false;}
      // No awaited prerequisite before this call: preserve the click's transient activation.
      latestRequest = {serial: ticket, epoch: ownedEpoch};
      await requestPlayerFullscreen(target);
      if (ticket !== serial || ownedEpoch !== epoch || disposed) {
        const newerOwner = !disposed && live && latestRequest?.serial === serial && latestRequest.epoch === epoch && latestRequest.serial !== ticket;
        if (!newerOwner && currentElement() === target) {try {await exit();} catch {}}
        return false;
      }
      if (!await changedWithinDeadline(true)) {update({failure: 'unconfirmed'});return false;}
      if (ticket !== serial || ownedEpoch !== epoch || disposed) return false;
      update({fullscreen: true});void lock();ports.focus();return true;
    } catch (error) {
      if (!disposed && ticket === serial) update({failure: 'failed', reason: message(error), fullscreen: isPlayer()});
      return false;
    } finally {if (!disposed && ticket === serial) update({busy: false});}
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    setSession(nextEpoch: number | null, nextLive: boolean) {
      if (epoch !== nextEpoch || live && !nextLive) retire();
      epoch = nextEpoch;live = nextLive;update({fullscreen: isPlayer()});
      if (live && isPlayer()) void lock();
    },
    toggle,
    dispose() {
      if (disposed) return;retire();disposed = true;
      for (const name of ['fullscreenchange', 'webkitfullscreenchange']) doc.removeEventListener(name, changed);
      for (const name of ['fullscreenerror', 'webkitfullscreenerror']) doc.removeEventListener(name, failed);
      listeners.clear();
    },
  });
}
export type PlayerFullscreenController = ReturnType<typeof createPlayerFullscreenController>;

/** Escape is the game's pause/back action. Never infer or set a paused engine state. */
export function createPlayerEscapeController(service: Pick<RuntimeService, 'getInputContext' | 'postInput'>,
  schedule: (callback: () => void) => unknown = callback => setTimeout(callback, 70),
  cancel: (token: unknown) => void = token => clearTimeout(token as ReturnType<typeof setTimeout>)) {
  let disposed = false, accepted = true, owned: ReturnType<RuntimeService['getInputContext']> | null = null;
  const current = () => {
    const context = service.getInputContext();
    return !disposed && owned && context.epoch === owned.epoch && context.target === owned.target && context.ready && context.launched && !context.spectator;
  };
  const owner = createFunctionKeyOwner(down => {
    try {if (current() && !service.postInput('keyboard', {code: 'Escape', key: 'Escape', keyCode: 27, location: 0, down})) accepted = false;}
    catch {accepted = false;}
  }, 'tap', schedule, cancel);
  return Object.freeze({
    activate() {
      const context = service.getInputContext();
      if (disposed || !context.target || !context.ready || !context.launched || context.spectator) return false;
      if (owned?.epoch !== context.epoch || owned.target !== context.target) owner.cancel();
      owned = context;accepted = true;owner.down(-1);owner.up(-1);
      if (!accepted) {owner.cancel();owned = null;return false;}
      return true;
    },
    cancel() {owner.cancel();owned = null;},
    dispose() {owner.cancel();owned = null;disposed = true;},
  });
}

export const PLAYER_TOUCH_HELP_SEEN_KEY = 'eagler-touch-help-seen-v8';
export function createPlayerInputHelpGate(storage: {getItem(key: string): string | null; setItem(key: string, value: string): void} | null) {
  let seen = false;
  try {seen = storage?.getItem(PLAYER_TOUCH_HELP_SEEN_KEY) === '1';} catch {}
  return {shouldOpen(input: {launched: boolean; spectator: boolean; touchEnabled: boolean}) {
    if (seen || !input.launched || input.spectator || !input.touchEnabled) return false;
    seen = true;try {storage?.setItem(PLAYER_TOUCH_HELP_SEEN_KEY, '1');} catch {}
    return true;
  }};
}

export interface PlayerHelpFocusCapture {readonly sourceKey: string; readonly frame: object; readonly target: object; readonly epoch: number}
/** A Help close may restore gameplay focus only to its original history entry,
 * connected frame and native epoch. Router and the dialog own close timing. */
export function canRestorePlayerHelpFocus(captured: PlayerHelpFocusCapture | null, current: {
  readonly navigationIdle: boolean; readonly locationKey: string; readonly helpOpen: boolean;
  readonly frame: object | null; readonly frameConnected: boolean;
  readonly input: Pick<ReturnType<RuntimeService['getInputContext']>, 'launched' | 'ready' | 'epoch' | 'target'> | null;
}) {
  const input = current.input;
  return !!captured && current.navigationIdle && current.locationKey === captured.sourceKey && !current.helpOpen &&
    current.frame === captured.frame && current.frameConnected && !!input?.launched && input.ready && input.epoch === captured.epoch && input.target === captured.target;
}

export interface PlayerFullscreenKeyEvent {
  readonly type: string; readonly code: string; readonly altKey?: boolean;
  readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly repeat?: boolean;
  readonly defaultPrevented?: boolean; readonly isComposing?: boolean;
}
/** Shared sequence recognition also lets the ordinary input bridge exclude
 * Enter UP after Alt was released first. It never emits Runtime input. */
export function createPlayerFullscreenKeySequence() {
  let held = false, retired = false;
  return Object.freeze({
    accept(event: PlayerFullscreenKeyEvent) {
      const chord = event.code === 'Enter' && event.altKey === true && !event.ctrlKey && !event.metaKey && !event.isComposing;
      if (event.type === 'keydown' && chord) {
        const activate = !held && !event.repeat && !event.defaultPrevented;
        held = true;retired = false;return {handled: true, activate};
      }
      if (event.type === 'keyup' && event.code === 'Enter' && (held || chord || retired)) {
        held = false;retired = false;return {handled: true, activate: false};
      }
      // A real new Enter DOWN starts ordinary input after focus returns. An
      // orphan UP from the retired chord remains suppressed across blur.
      if (event.type === 'keydown' && event.code === 'Enter' && !event.repeat) retired = false;
      return {handled: false, activate: false};
    },
    reset() {retired = retired || held;held = false;},
  });
}
export interface PlayerShortcutTarget {
  addEventListener(type: string, listener: EventListener, capture?: boolean): void;
  removeEventListener(type: string, listener: EventListener, capture?: boolean): void;
}
/** Iframe events never bubble into the parent Window: both exact targets need
 * capture listeners. The caller's identity predicate fences frame, document,
 * Runtime epoch and modal ownership on every event, not only at attachment. */
export function bindPlayerFullscreenShortcut(ports: {
  host: PlayerShortcutTarget; child: PlayerShortcutTarget; current(): boolean; toggle(): void;
}) {
  const sequence = createPlayerFullscreenKeySequence(), seen = new WeakSet<Event>();
  let disposed = false;
  const key: EventListener = event => {
    if (disposed || !ports.current()) {sequence.reset();return;}
    if (seen.has(event)) return;
    seen.add(event);
    const result = sequence.accept(event as KeyboardEvent);
    if (!result.handled) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (result.activate) ports.toggle();
  };
  const clear: EventListener = () => sequence.reset();
  const targets = ports.child === ports.host ? [ports.host] : [ports.host, ports.child];
  const cleanup = () => {
    for (const target of targets) {
      try {target.removeEventListener('keydown', key, true);target.removeEventListener('keyup', key, true);target.removeEventListener('blur', clear);} catch { /* Retired document. */ }
    }
  };
  try {
    for (const target of targets) {target.addEventListener('keydown', key, true);target.addEventListener('keyup', key, true);target.addEventListener('blur', clear);}
  } catch (error) {cleanup();throw error;}
  return Object.freeze({dispose() {if (disposed) return;disposed = true;sequence.reset();cleanup();}});
}
