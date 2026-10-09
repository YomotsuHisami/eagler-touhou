import {launchInputWarnings, type LaunchInputDevice, type LaunchWarningGate} from './launch-warnings';
import {startPreparedRuntime, type PreparedStartRuntime} from './prepared-start';
import type {GameLaunchJobController, LaunchUpdateChoice} from './game-launch-job.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {RuntimeSnapshot} from './runtime.client';
import type {MidiController} from './midi.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {isGameDataAcquisitionFailure} from './game-data-acquisition';

export interface SettingsLaunchSelection {
  productId: string;
  preferences: PreferencesSnapshot;
  touchLayout?: TouchLayout | null;
  updateChoice?: LaunchUpdateChoice;
  contextKey?: string;
}
export interface SettingsLaunchSnapshot {
  readonly phase: 'idle' | 'warning' | 'preparing' | 'starting' | 'error';
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly dataRecovery: boolean;
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
  chooseUpdate?(selection: SettingsLaunchSelection, current: () => boolean, signal: AbortSignal): Promise<LaunchUpdateChoice>;
}) {
  let snapshot: SettingsLaunchSnapshot = Object.freeze({phase: 'idle', error: null, errorCode: null, dataRecovery: false});
  const listeners = new Set<() => void>();
  let disposed = false;
  let resumeProof: {key: string} | null = null;
  const resumeKey = (selection: SettingsLaunchSelection) => JSON.stringify({productId: selection.productId, options: selection.preferences.options,
    music: selection.preferences.music, language: selection.preferences.language, touchLayout: selection.touchLayout ?? null, contextKey: selection.contextKey ?? null});
  let active: {selection: SettingsLaunchSelection; abort: AbortController; epoch: number | null;
    preparation: ReturnType<GameLaunchJobController['getSnapshot']>['selection']; cancelledDownload: boolean; started: boolean; promise: Promise<boolean>; release(): void} | null = null;
  function publish(phase: SettingsLaunchSnapshot['phase'], error: string | null = null, errorCode: string | null = null, dataRecovery = false) {
    if (disposed) return;
    snapshot = Object.freeze({phase, error, errorCode, dataRecovery}); for (const listener of listeners) listener();
  }
  function cancel() {
    resumeProof = null;
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
  function launch(input: SettingsLaunchSelection, proof?: NonNullable<typeof resumeProof>): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (active) return active.promise;
    resumeProof = null;
    const selection = structuredClone(input);
    const request = {selection, abort: new AbortController(), epoch: null as number | null,
      preparation: null as ReturnType<GameLaunchJobController['getSnapshot']>['selection'],
      cancelledDownload: false, started: false, promise: Promise.resolve(false), release: () => {}};
    active = request;
    const current = () => !disposed && active === request && !request.abort.signal.aborted && options.current(selection);
    const initialWarnings = launchInputWarnings({touchEnabled: selection.preferences.options.touchEnabled,
      music: selection.preferences.music === 'none' ? 'none' : selection.preferences.music === 'midi' ? 'midi' : 'ogg'}, options.device());
    publish('warning');
    // main's DATA import continuation calls launchConfiguredRuntime directly:
    // it neither repeats input acknowledgments nor requests fullscreen again.
    const accepted = options.warnings.request({warnings: proof ? [] : initialWarnings, current, signal: request.abort.signal, accept: async () => {
      if (!current()) return;
      request.release = options.acquireStart?.(selection) ?? (() => {});
      if (!proof) await options.enterPlayer?.(selection);
      if (!current()) return;
      const old = options.runtime.getSnapshot();
      if (old.phase === 'prepared' && !old.launched) {
        if (old.runtimeVariant === 'multiplayer' || old.fileOperationBusy || old.saveError) throw new Error('Finish the current Runtime operation before starting');
        if (!await options.runtime.close()) throw new Error('The previous Runtime could not be saved and closed');
        if (!current()) return;
      }
      if (selection.updateChoice === undefined && options.chooseUpdate) {
        selection.updateChoice = await options.chooseUpdate(selection, current, request.abort.signal);
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
      // main reports optional OGG fallback without another confirmation.
      if (prepared() && ready.epoch !== null) {
        publish('starting');
        let result = await startPreparedRuntime({runtime: options.runtime, midi: options.midi, epoch: ready.epoch, currentIntent: current, bestEffortMidiResume: true});
        // The launch job normally warms MIDI before preparing the iframe. Keep
        // the same Start intent if a late bridge initialization was required.
        if (result === 'audio-prepared' && prepared()) result = await startPreparedRuntime({runtime: options.runtime, midi: options.midi, epoch: ready.epoch, currentIntent: current, bestEffortMidiResume: true});
        if (result === 'started') request.started = true;
        if (result === 'superseded' && current()) cancel();
      }
    }});
    request.promise = accepted.then(() => {
      const live = options.runtime.getSnapshot();
      return request.started && live.epoch === request.epoch && (live.launched || live.phase === 'launching' || live.phase === 'running');
    }).catch(error => {
      if (current()) {
        if (request.cancelledDownload) {
          resumeProof = {key: resumeKey(selection)};
          publish('error', 'Game download was cancelled', 'download-cancelled', true);
        } else if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') publish('idle');
        else {
          const dataRecovery = isGameDataAcquisitionFailure(error);
          if (dataRecovery) resumeProof = {key: resumeKey(selection)};
          publish('error', error instanceof Error ? error.message : String(error), error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null, dataRecovery);
        }
      }
      return false;
    }).finally(() => {
      if (active === request) {active = null; request.release(); if (snapshot.phase !== 'error') publish('idle');}
    });
    return request.promise;
  }
  return Object.freeze({launch: (input: SettingsLaunchSelection) => launch(input),
    cancelDownload() {
      const request = active, job = options.job.getSnapshot(), live = options.runtime.getSnapshot();
      if (!request?.preparation || job.selection !== request.preparation || !job.preparing || live.launched || ['launching', 'running', 'saving'].includes(live.phase)) return false;
      if (job.musicDownloading) {options.job.cancelMusicDownload();return true;}
      request.cancelledDownload = true;options.job.cancel();return true;
    },
    deferForImport(input: SettingsLaunchSelection) {
      if (disposed || active || !options.current(input)) return false;
      resumeProof = {key: resumeKey(input)};return true;
    }, resume(input: SettingsLaunchSelection) {
    const proof = resumeProof;resumeProof = null;
    if (!proof || proof.key !== resumeKey(input) || !options.current(input)) return Promise.resolve(false);
    return launch(input, proof);
  }, cancel, getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    recheck() {if (active && !options.current(active.selection)) cancel();},
    dispose() {cancel(); disposed = true; listeners.clear();},
  });
}
export type SettingsLaunchController = ReturnType<typeof createSettingsLaunchController>;
