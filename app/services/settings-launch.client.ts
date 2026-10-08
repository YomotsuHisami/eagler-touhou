import {launchInputWarnings, type LaunchInputDevice, type LaunchWarningGate} from './launch-warnings';
import {startPreparedRuntime, type PreparedStartRuntime} from './prepared-start';
import type {GameLaunchJobController, LaunchUpdateChoice} from './game-launch-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {RuntimeSnapshot} from './runtime.client';
import type {MidiController} from './midi.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';

export interface SettingsLaunchSelection {
  productId: string;
  preferences: PreferencesSnapshot;
  touchLayout?: TouchLayout | null;
  updateChoice?: LaunchUpdateChoice;
}
export interface SettingsLaunchSnapshot {
  readonly phase: 'idle' | 'warning' | 'preparing' | 'starting' | 'error';
  readonly error: string | null;
  readonly errorCode: string | null;
}
type LaunchRuntime = Omit<PreparedStartRuntime, 'getSnapshot'> & {
  getSnapshot(): RuntimeSnapshot;
  close(): Promise<boolean>;
};

/** One Start intent owns acknowledgments, acquisition and the exact prepared
 * epoch. The existing job, MIDI and Runtime services keep their own work. */
export function createSettingsLaunchController(options: {
  job: GameLaunchJobController;
  runtime: LaunchRuntime;
  midi: MidiController | null;
  warnings: Pick<LaunchWarningGate, 'request' | 'cancel'>;
  device(): LaunchInputDevice;
  current(selection: SettingsLaunchSelection): boolean;
  acquireStart?(selection: SettingsLaunchSelection): () => void;
  enterPlayer?(selection: SettingsLaunchSelection): void | Promise<void>;
}) {
  let snapshot: SettingsLaunchSnapshot = Object.freeze({phase: 'idle', error: null, errorCode: null});
  const listeners = new Set<() => void>();
  let disposed = false;
  let active: {selection: SettingsLaunchSelection; abort: AbortController; epoch: number | null;
    preparation: ReturnType<GameLaunchJobController['getSnapshot']>['selection']; started: boolean; promise: Promise<boolean>; release(): void} | null = null;
  function publish(phase: SettingsLaunchSnapshot['phase'], error: string | null = null, errorCode: string | null = null) {
    if (disposed) return;
    snapshot = Object.freeze({phase, error, errorCode}); for (const listener of listeners) listener();
  }
  function cancel() {
    const request = active; active = null;
    if (!request) return;
    request.abort.abort(); options.warnings.cancel(); request.release();
    const live = options.runtime.getSnapshot(), job = options.job.getSnapshot();
    // Cancel only this preparation. A Runtime already launching/running, or a
    // newer job that reused the root service, never belongs to a stale view.
    if (request.preparation && job.selection === request.preparation && !live.launched &&
        !['launching', 'running', 'saving'].includes(live.phase) &&
        (request.epoch === null || live.epoch === request.epoch)) options.job.cancel();
    publish('idle');
  }
  function launch(input: SettingsLaunchSelection): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (active) return active.promise;
    const selection = structuredClone(input);
    const request = {selection, abort: new AbortController(), epoch: null as number | null,
      preparation: null as ReturnType<GameLaunchJobController['getSnapshot']>['selection'],
      started: false, promise: Promise.resolve(false), release: () => {}};
    active = request;
    const current = () => !disposed && active === request && !request.abort.signal.aborted && options.current(selection);
    const initialWarnings = launchInputWarnings({touchEnabled: selection.preferences.options.touchEnabled,
      music: selection.preferences.music === 'none' ? 'none' : selection.preferences.music === 'midi' ? 'midi' : 'ogg'}, options.device());
    publish('warning');
    const accepted = options.warnings.request({warnings: initialWarnings, current, signal: request.abort.signal, accept: async () => {
      if (!current()) return;
      request.release = options.acquireStart?.(selection) ?? (() => {});
      await options.enterPlayer?.(selection);
      if (!current()) return;
      const old = options.runtime.getSnapshot();
      if (old.phase === 'prepared' && !old.launched) {
        if (old.runtimeVariant === 'multiplayer' || old.fileOperationBusy || old.saveError) throw new Error('Finish the current Runtime operation before starting');
        if (!await options.runtime.close()) throw new Error('The previous Runtime could not be saved and closed');
        if (!current()) return;
      }
      publish('preparing');
      const preparation = options.job.prepare(selection.productId, selection.preferences, selection.touchLayout ?? null, selection.updateChoice ?? 'keep-current');
      request.preparation = options.job.getSnapshot().selection;
      const ready = await preparation; request.epoch = ready.epoch;
      if (!current()) {if (active === request) cancel(); return;}
      if (ready.game !== selection.productId || ready.runtimeVariant !== 'normal') throw new Error('The prepared Runtime does not match this Start request');
      const prepared = () => current() && ready.epoch !== null && options.runtime.getSnapshot().epoch === ready.epoch &&
        options.runtime.getSnapshot().phase === 'prepared' && !options.runtime.getSnapshot().fileOperationBusy && !options.runtime.getSnapshot().saveError;
      if (!prepared()) return;
      const controls = options.runtime.getLauncherControlContext();
      const actualWarnings = launchInputWarnings({music: ready.music ?? 'none',
        touchEnabled: controls?.epoch === ready.epoch ? controls.options.touchEnabled === true : selection.preferences.options.touchEnabled}, options.device());
      // Acquisition may select a real MIDI/none fallback. Acknowledge only the
      // warnings that were not already accepted for this captured Start.
      const remaining = actualWarnings.filter(warning => !initialWarnings.includes(warning));
      if (remaining.length) publish('warning');
      await options.warnings.request({warnings: remaining, current: prepared, signal: request.abort.signal, accept: async () => {
        if (!prepared() || ready.epoch === null) return;
        publish('starting');
        let result = await startPreparedRuntime({runtime: options.runtime, midi: options.midi, epoch: ready.epoch, currentIntent: current, bestEffortMidiResume: true});
        // The launch job normally warms MIDI before preparing the iframe. Keep
        // the same Start intent if a late bridge initialization was required.
        if (result === 'audio-prepared' && prepared()) result = await startPreparedRuntime({runtime: options.runtime, midi: options.midi, epoch: ready.epoch, currentIntent: current, bestEffortMidiResume: true});
        if (result === 'started') request.started = true;
        if (result === 'superseded' && current()) cancel();
      }});
    }});
    request.promise = accepted.then(() => {
      const live = options.runtime.getSnapshot();
      return request.started && live.epoch === request.epoch && (live.launched || live.phase === 'launching' || live.phase === 'running');
    }).catch(error => {
      if (current()) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') publish('idle');
        else publish('error', error instanceof Error ? error.message : String(error), error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null);
      }
      return false;
    }).finally(() => {
      if (active === request) {active = null; request.release(); if (snapshot.phase !== 'error') publish('idle');}
    });
    return request.promise;
  }
  return Object.freeze({launch, cancel, getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    recheck() {if (active && !options.current(active.selection)) cancel();},
    dispose() {cancel(); disposed = true; listeners.clear();},
  });
}
export type SettingsLaunchController = ReturnType<typeof createSettingsLaunchController>;
