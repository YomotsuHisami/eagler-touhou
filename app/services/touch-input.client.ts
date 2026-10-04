import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeCommandPayloads, RuntimeConfigureOptions} from '../../src/contracts/runtime-protocol.mts';
import {createFunctionKeyOwner, functionKeyGames, functionKeySpec} from '../../src/launcher/touch-function-key.mts';
import {DEFAULT_GAME_OPTIONS, touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import type {HostedKeySpec, TouchControlsSnapshot} from '../../src/launcher/touch-runtime-protocol.mts';
import type {LayoutRect} from './touch-layout.client';

export interface TouchInputConfiguration {
  readonly epoch: number;
  readonly game: GameId;
  readonly options: Readonly<RuntimeConfigureOptions>;
  readonly launcherControls: Readonly<{restartButtonEnabled: boolean; thpracTouchControlsEnabled: boolean}>;
}
export type TouchInputCommand = 'keyboard' | 'touch-controls' | 'touch-cancel' | 'direct-touch';
export interface TouchInputPorts {
  /** Both identity and lifecycle checks must refer to the current Runtime owner. */
  current(): {epoch: number | null; ready: boolean; launched: boolean; spectator: boolean};
  post<C extends TouchInputCommand>(command: C, payload: RuntimeCommandPayloads[C]): boolean;
  schedule(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
  requestFrame(callback: () => void): unknown;
  cancelFrame(frame: unknown): void;
}
export const touchTrainerKeys = Object.freeze({
  Tab: {code: 'Tab', key: 'Tab', keyCode: 9}, Backspace: {code: 'Backspace', key: 'Backspace', keyCode: 8},
  F1: {code: 'F1', key: 'F1', keyCode: 112}, F2: {code: 'F2', key: 'F2', keyCode: 113},
  F3: {code: 'F3', key: 'F3', keyCode: 114}, F4: {code: 'F4', key: 'F4', keyCode: 115},
  F5: {code: 'F5', key: 'F5', keyCode: 116}, F6: {code: 'F6', key: 'F6', keyCode: 117},
  F7: {code: 'F7', key: 'F7', keyCode: 118}, F12: {code: 'F12', key: 'F12', keyCode: 123},
} satisfies Record<string, HostedKeySpec>);
export type TouchTrainerKey = keyof typeof touchTrainerKeys;
export type TouchInputAction = 'fire' | 'focus' | 'bomb' | 'escape' | 'restart' | 'function' | TouchTrainerKey;
export interface TouchInputSnapshot extends TouchControlsSnapshot {
  readonly heldFire: boolean;
  readonly functionPressed: boolean;
  readonly joystickVisual: Readonly<{x: number; y: number}>;
  readonly directCount: number;
}
export interface JoystickVector {x: number; y: number; visualX: number; visualY: number}
/** Main's radial .16 dead zone and unquantized signed axes, not title-specific direction rules. */
export function touchJoystickVector(x: number, y: number, rect: LayoutRect): JoystickVector {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !validRect(rect)) return {x: 0, y: 0, visualX: 0, visualY: 0};
  const dx = x - rect.left - rect.width / 2, dy = y - rect.top - rect.height / 2;
  const maxTravel = Math.max(1, Math.min(rect.width, rect.height) * .34), distance = Math.hypot(dx, dy);
  const ux = distance > 0 ? dx / distance : 0, uy = distance > 0 ? dy / distance : 0;
  const radial = Math.min(1, distance / maxTravel), magnitude = radial <= .16 ? 0 : (radial - .16) / .84;
  return {x: Math.round(ux * magnitude * 32767), y: Math.round(uy * magnitude * 32767), visualX: ux * Math.min(distance, maxTravel), visualY: uy * Math.min(distance, maxTravel)};
}
const validRect = (rect: LayoutRect) => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

/** One input generation per Runtime epoch. Injected scheduling and transport; no DOM or storage. */
export function createTouchInputController(configuration: TouchInputConfiguration, ports: TouchInputPorts) {
  const config = structuredClone(configuration);
  const options = {...DEFAULT_GAME_OPTIONS, ...config.options};
  const fire = PRODUCT_GAMES[config.game].touchFire;
  let disposed = false, suspended = false, heldFire = false, functionPressed = false;
  let heldFirePointer: number | null = null, focusPointer: number | null = null, joystickPointer: number | null = null;
  let pendingFrame: unknown = null;
  let visual = {x: 0, y: 0};
  let frameRect: LayoutRect | null = null, nextDirectId = -1000000;
  const direct = new Map<number, {id: number; x: number; y: number}>();
  const controls: TouchControlsSnapshot = {fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0};
  const listeners = new Set<() => void>();
  function current() {const state = ports.current();return !disposed && state.epoch === config.epoch && state.ready && state.launched && !state.spectator;}
  function active() {return current() && options.touchEnabled && !suspended;}
  function post<C extends TouchInputCommand>(command: C, payload: RuntimeCommandPayloads[C]) {return current() && ports.post(command, payload);}
  function snapshot(): TouchInputSnapshot {return Object.freeze({...controls, heldFire, functionPressed, joystickVisual: Object.freeze({...visual}), directCount: direct.size});}
  let state = snapshot();
  function publish() {state = snapshot();for (const listener of [...listeners]) listener();}
  function sync() {post('touch-controls', {...controls, fireEnabled: fire.mode === 'held-key' ? false : controls.fireEnabled, touchSensitivity: options.touchSensitivity});}
  function sendKey(spec: HostedKeySpec, down: boolean) {const payload = {...spec, location: spec.location ?? 0, down};post('keyboard', payload);}
  const functionOwner = createFunctionKeyOwner(down => {functionPressed = down;sendKey(functionKeySpec, down);publish();}, 'tap', callback => ports.schedule(callback, 50), ports.cancel);
  // Repeated ordinary key taps preserve a sampled UP as well as DOWN. This
  // prevents a later timeout from shortening a newer R/trainer pulse.
  const keyOwners = new Map<TouchInputAction, ReturnType<typeof createFunctionKeyOwner>>();
  function pulse(name: TouchInputAction, spec: HostedKeySpec) {
    let owner = keyOwners.get(name);
    if (!owner) {owner = createFunctionKeyOwner(down => sendKey(spec, down), 'tap', callback => ports.schedule(callback, 70), ports.cancel);keyOwners.set(name, owner);}
    owner.down(-1);owner.up(-1);
  }
  function queueSync() {
    if (pendingFrame !== null) return;
    pendingFrame = ports.requestFrame(() => {pendingFrame = null;if (active()) sync();publish();});
  }
  function cancelTransient() {
    if (pendingFrame !== null) {ports.cancelFrame(pendingFrame);pendingFrame = null;}
    functionOwner.cancel();for (const owner of keyOwners.values()) owner.cancel();
    if (heldFire && fire.mode === 'held-key') sendKey(fire.key, false);
    heldFire = false;heldFirePointer = null;focusPointer = null;joystickPointer = null;
    controls.focusEnabled = false;controls.joystickX = 0;controls.joystickY = 0;visual = {x: 0, y: 0};
    direct.clear();frameRect = null;
    if (options.touchEnabled) post('touch-cancel', {});
    // Fire is an intentional toggle and survives transient cancellation.
    if (options.touchEnabled) sync();publish();
  }
  function down(action: TouchInputAction, pointer: number): boolean {
    if (!active()) return false;
    if (action === 'fire') {
      if (fire.mode === 'held-key') {
        if (heldFirePointer !== null) return false;
        heldFirePointer = pointer;heldFire = true;sendKey(fire.key, true);
      } else {controls.fireEnabled = !controls.fireEnabled;sync();}
    } else if (action === 'focus') {
      if (options.touchFocusMode === 'two-finger' || focusPointer !== null) return false;
      focusPointer = pointer;
      controls.focusEnabled = options.touchFocusMode === 'hold-button' || !controls.focusEnabled;sync();
    } else if (action === 'bomb' || action === 'escape') {
      if (action === 'bomb') controls.bombSerial++;else controls.escapeSerial++;
      sync();
    } else if (action === 'restart') {
      if (!config.launcherControls.restartButtonEnabled) return false;
      pulse(action, {code: 'KeyR', key: 'r', keyCode: 82});
    } else if (action === 'function') {
      if (!functionKeyGames.has(config.game)) return false;
      return functionOwner.down(pointer);
    } else {
      if (!config.launcherControls.thpracTouchControlsEnabled || !Object.hasOwn(touchTrainerKeys, action)) return false;
      pulse(action, touchTrainerKeys[action]);
    }
    publish();return true;
  }
  function up(action: TouchInputAction, pointer: number, cancelled = false) {
    if (action === 'function') {if (cancelled) functionOwner.lost(pointer);else functionOwner.up(pointer);return;}
    if (action === 'fire' && heldFirePointer === pointer) {
      heldFirePointer = null;if (heldFire && fire.mode === 'held-key') sendKey(fire.key, false);heldFire = false;
    } else if (action === 'focus' && focusPointer === pointer) {
      focusPointer = null;
      if (options.touchFocusMode === 'hold-button') {controls.focusEnabled = false;sync();}
    }
    publish();
  }
  function point(x: number, y: number) {
    if (!frameRect || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {x: (x - frameRect.left) / frameRect.width, y: (y - frameRect.top) / frameRect.height};
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    start() {if (active()) {sync();publish();}},
    down, up,
    activate(action: TouchInputAction) {
      if (action === 'focus' && options.touchFocusMode !== 'toggle-button' || action === 'fire' && fire.mode === 'held-key') return false;
      const accepted = down(action, -1);up(action, -1);return accepted;
    },
    suspend(value: boolean) {if (value === suspended) return;if (value) cancelTransient();suspended = value;if (!value && active()) sync();},
    cancel: cancelTransient,
    joystickDown(pointer: number, x: number, y: number, rect: LayoutRect) {
      if (!active() || !touchMovementUsesJoystick(options.touchMovementMode) || joystickPointer !== null || !validRect(rect) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      joystickPointer = pointer;
      const vector = touchJoystickVector(x, y, rect);controls.joystickX = vector.x;controls.joystickY = vector.y;visual = {x: vector.visualX, y: vector.visualY};queueSync();return true;
    },
    joystickMove(pointer: number, x: number, y: number, rect: LayoutRect) {
      if (!active() || pointer !== joystickPointer || !validRect(rect) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const vector = touchJoystickVector(x, y, rect);controls.joystickX = vector.x;controls.joystickY = vector.y;visual = {x: vector.visualX, y: vector.visualY};queueSync();
    },
    joystickUp(pointer: number) {
      if (pointer !== joystickPointer) return;
      joystickPointer = null;controls.joystickX = 0;controls.joystickY = 0;visual = {x: 0, y: 0};queueSync();
    },
    directDown(pointer: number, x: number, y: number, rect: LayoutRect) {
      if (!active() || touchMovementUsesJoystick(options.touchMovementMode) || direct.has(pointer) || !validRect(rect)) return false;
      if (!direct.size) frameRect = {...rect};
      const position = point(x, y);if (!position) return false;
      const contact = {id: nextDirectId--, ...position};direct.set(pointer, contact);post('direct-touch', {type: 'down', ...contact});publish();return true;
    },
    directMove(pointer: number, x: number, y: number) {
      const contact = direct.get(pointer), position = point(x, y);
      if (!active() || !contact || !position) return;
      Object.assign(contact, position);post('direct-touch', {type: 'move', ...contact});
    },
    directUp(pointer: number, x?: number, y?: number) {
      const contact = direct.get(pointer);if (!contact) return;
      const position = x !== undefined && y !== undefined ? point(x, y) : null;if (position) Object.assign(contact, position);
      direct.delete(pointer);post('direct-touch', {type: 'up', ...contact});if (!direct.size) frameRect = null;publish();
    },
    updateFrameRect(rect: LayoutRect) {if (validRect(rect)) frameRect = {...rect};},
    dispose() {if (disposed) return;cancelTransient();disposed = true;listeners.clear();},
  });
}
export type TouchInputController = ReturnType<typeof createTouchInputController>;
