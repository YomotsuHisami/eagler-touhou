/** Launch-local acknowledgments only. No preferences, routing or Runtime owner. */
export type LaunchInputWarning = 'touch.disabledInputWarning' | 'music.noneLaunchWarning' | 'music.midiLaunchWarning';
export interface LaunchWarningSettings {readonly touchEnabled: boolean; readonly music: 'ogg' | 'midi' | 'none'}
export interface LaunchInputDevice {readonly maxTouchPoints: number; readonly anyFinePointer: boolean; readonly userAgent: string; readonly mobile?: boolean}
export function launchInputWarnings(settings: LaunchWarningSettings, device: LaunchInputDevice): readonly LaunchInputWarning[] {
  const mobile = device.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent) ||
    (device.maxTouchPoints > 1 && /Macintosh/i.test(device.userAgent));
  const pureTouch = device.maxTouchPoints > 0 && !device.anyFinePointer;
  const warnings: LaunchInputWarning[] = [];
  if (!settings.touchEnabled && (mobile || pureTouch)) warnings.push('touch.disabledInputWarning');
  if (settings.music === 'none') warnings.push('music.noneLaunchWarning');
  if (settings.music === 'midi') warnings.push('music.midiLaunchWarning');
  return warnings;
}
export function browserLaunchInputDevice(): LaunchInputDevice {
  return {maxTouchPoints: navigator.maxTouchPoints, anyFinePointer: matchMedia('(any-pointer: fine)').matches,
    userAgent: navigator.userAgent, mobile: (navigator as Navigator & {userAgentData?: {mobile?: boolean}}).userAgentData?.mobile};
}
export interface LaunchWarningPrompt {readonly id: number; readonly warning: LaunchInputWarning}
export interface LaunchWarningRequest {
  readonly warnings: readonly LaunchInputWarning[];
  readonly current: () => boolean;
  /** Called in the final button's event stack, before any await (MIDI activation). */
  readonly accept: () => unknown | Promise<unknown>;
  readonly signal?: AbortSignal;
}
/** A canceled/replaced prompt can never authorize a newer request. */
export function createLaunchWarningGate() {
  const listeners = new Set<() => void>();
  let serial = 0, snapshot: LaunchWarningPrompt | null = null;
  let pending: {request: LaunchWarningRequest; remaining: LaunchInputWarning[]; resolve(value: boolean): void; reject(reason: unknown): void; removeAbort(): void} | null = null;
  function publish(value: LaunchWarningPrompt | null) {snapshot = value; for (const listener of listeners) listener();}
  function take() {const value = pending; pending = null; value?.removeAbort(); publish(null); return value;}
  function cancel() {take()?.resolve(false);}
  function valid(request: LaunchWarningRequest) {try {return !request.signal?.aborted && request.current();} catch {return false;}}
  function current() {return !!pending && valid(pending.request);}
  function accept(prompt: LaunchWarningPrompt) {
    if (snapshot !== prompt) return;
    if (!current()) {cancel(); return;}
    const warning = pending!.remaining.shift();
    if (warning) {publish(Object.freeze({id: ++serial, warning})); return;}
    const value = take()!;
    // Do not convert this to a promise continuation: it would lose the final
    // acknowledgment's trusted event stack before the audio owner can resume.
    try {Promise.resolve(value.request.accept()).then(() => value.resolve(true), value.reject);}
    catch (error) {value.reject(error);}
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    request(request: LaunchWarningRequest): Promise<boolean> {
      cancel();
      if (!valid(request)) return Promise.resolve(false);
      if (!request.warnings.length) {
        try {return Promise.resolve(request.accept()).then(() => true);} catch (error) {return Promise.reject(error);}
      }
      return new Promise((resolve, reject) => {
        const abort = () => cancel();
        pending = {request, remaining: request.warnings.slice(1), resolve, reject,
          removeAbort: () => request.signal?.removeEventListener('abort', abort)};
        request.signal?.addEventListener('abort', abort, {once: true});
        publish(Object.freeze({id: ++serial, warning: request.warnings[0]!}));
      });
    },
    accept, cancel,
    dismiss(prompt: LaunchWarningPrompt) {if (snapshot === prompt) cancel();},
    recheck() {if (pending && !current()) cancel();},
  });
}
export type LaunchWarningGate = ReturnType<typeof createLaunchWarningGate>;
