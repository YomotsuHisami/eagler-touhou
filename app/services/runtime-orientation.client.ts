export type PlayerOrientation = 'portrait' | 'landscape';
type OrientationLock = {readonly type?: string; lock?(orientation: string): Promise<void>; unlock?(): void};
type OrientationScreen = {readonly orientation?: OrientationLock};

export interface RuntimeOrientationSnapshot {
  readonly mobile: boolean;
  readonly lockSupported: boolean;
  readonly unsupported: boolean;
  readonly available: boolean;
  readonly pending: boolean;
}
export interface RuntimeOrientationCapabilityState {checked: boolean; unsupported: boolean}
export type RuntimeOrientationResult =
  | {readonly status: 'requested'; readonly orientation: PlayerOrientation}
  | {readonly status: 'failed' | 'unsupported' | 'superseded' | 'unavailable'};
export interface RuntimeOrientationOptions {
  screen?: OrientationScreen | null;
  mobile?: boolean;
  waitForLayout?: () => Promise<void>;
  /** Tests inject an isolated page-level capability record. */
  capabilityState?: RuntimeOrientationCapabilityState;
}
export interface RequestRuntimeOrientationOptions {
  epoch: number | null;
  orientation: PlayerOrientation;
  fullscreen: boolean;
  current(): boolean;
  enterFullscreen(): Promise<boolean>;
}

const orientationApi = (): OrientationScreen | null => typeof window === 'undefined' ? null : window.screen as OrientationScreen;
const mobilePlatform = () => {
  if (typeof navigator === 'undefined') return false;
  const value = navigator as Navigator & {userAgentData?: {mobile?: boolean}};
  return value.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
};
const defaultWaitForLayout = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame !== 'function') {resolve();return;}
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});
const pageCapabilityState: RuntimeOrientationCapabilityState = {checked:false, unsupported:false};
const capabilityListeners = new Map<RuntimeOrientationCapabilityState, Set<() => void>>();
function notifyCapability(state: RuntimeOrientationCapabilityState) {
  for (const listener of [...(capabilityListeners.get(state) ?? [])]) listener();
}

/** Owns only the screen-orientation lock request. Geometry remains derived from
 * measured viewport dimensions after the browser reports the resulting change. */
export function createRuntimeOrientationController(options: RuntimeOrientationOptions = {}) {
  const screen = options.screen === undefined ? orientationApi() : options.screen;
  const orientation = screen?.orientation;
  const mobile = options.mobile ?? mobilePlatform();
  const waitForLayout = options.waitForLayout ?? defaultWaitForLayout;
  const capability = options.capabilityState ?? pageCapabilityState;
  let disposed = false, epoch: number | null = null, serial = 0;
  let pending = false;
  const listeners = new Set<() => void>();
  const lockSupported = typeof orientation?.lock === 'function';
  const snapshot = (): RuntimeOrientationSnapshot => Object.freeze({mobile, lockSupported,
    unsupported: capability.unsupported, available: mobile && lockSupported && !capability.unsupported, pending});
  let state = snapshot();
  function publish() {
    const next = snapshot();
    if (Object.keys(next).every(key => next[key as keyof RuntimeOrientationSnapshot] === state[key as keyof RuntimeOrientationSnapshot])) return;
    state = next;for (const listener of [...listeners]) listener();
  }
  function sessionCurrent(expected: number | null, ticket: number, current?: () => boolean) {
    if (disposed || ticket !== serial || epoch !== expected) return false;
    try {return current ? current() : true;} catch {return false;}
  }
  async function probe(fullscreen: boolean, expectedEpoch: number | null, current?: () => boolean) {
    if (!fullscreen || !state.available || capability.checked || pending || !orientation?.type) return;
    epoch = expectedEpoch;
    const ticket = ++serial;pending = true;publish();
    try {
      await orientation.lock!(orientation.type);
      if (!sessionCurrent(expectedEpoch, ticket, current)) return;
      orientation.unlock?.();capability.checked = true;notifyCapability(capability);
    } catch (error) {
      if (!sessionCurrent(expectedEpoch, ticket, current)) return;
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NotSupportedError') {
        capability.unsupported = true;notifyCapability(capability);
      }
    } finally {
      if (sessionCurrent(expectedEpoch, ticket, current)) {pending = false;publish();}
    }
  }
  async function request(input: RequestRuntimeOrientationOptions): Promise<RuntimeOrientationResult> {
    if (disposed || !state.available || !orientation?.lock) return {status: 'unavailable'};
    epoch = input.epoch;
    if (pending) return {status: 'unavailable'};
    const ticket = ++serial, target: PlayerOrientation = input.orientation === 'landscape' ? 'portrait' : 'landscape';
    pending = true;publish();
    const current = () => sessionCurrent(input.epoch, ticket, input.current);
    try {
      if (!input.fullscreen && !(await input.enterFullscreen())) return {status: 'failed'};
      if (!current()) return {status: 'superseded'};
      await orientation.lock(target);
      if (!current()) return {status: 'superseded'};
      capability.checked = true;notifyCapability(capability);
      await waitForLayout();
      return current() ? {status: 'requested', orientation: target} : {status: 'superseded'};
    } catch (error) {
      if (!current()) return {status: 'superseded'};
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NotSupportedError') {
        capability.unsupported = true;notifyCapability(capability);return {status: 'unsupported'};
      }
      return {status: 'failed'};
    } finally {
      if (current()) {pending = false;publish();}
    }
  }
  let users = capabilityListeners.get(capability);
  if (!users) {users = new Set();capabilityListeners.set(capability, users);}
  users.add(publish);
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    setSession(next: number | null) {
      if (epoch === next) return;
      epoch = next;serial++;pending = false;publish();
    },
    probe,
    request,
    dispose() {
      if (disposed) return;disposed = true;serial++;pending = false;listeners.clear();
      const active = capabilityListeners.get(capability);active?.delete(publish);if (!active?.size) capabilityListeners.delete(capability);
    },
  });
}
export type RuntimeOrientationController = ReturnType<typeof createRuntimeOrientationController>;
