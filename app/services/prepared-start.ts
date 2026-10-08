/** Explicit user-gesture Start only; no job or route-selection ownership. */
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import type {RuntimeLauncherControlContext, RuntimeMidiEventContext, RuntimeSnapshot} from './runtime.client';
import type {MidiController} from './midi.client';
export interface PreparedStartRuntime {
  getSnapshot(): Pick<RuntimeSnapshot, 'phase' | 'epoch' | 'game' | 'fileOperationBusy' | 'runtimeVariant' | 'saveError' | 'music'>;
  getLauncherControlContext(): RuntimeLauncherControlContext | null;
  getMidiEventContext(): RuntimeMidiEventContext | null;
  launch(): Promise<RuntimeSnapshot>;
}
export function preparedRuntimeNeedsMidi(runtime: PreparedStartRuntime, epoch: number) {
  const context = runtime.getMidiEventContext();
  return !!context && context.epoch === epoch && context.music !== 'none' && PRODUCT_GAMES[context.game].musicCapabilities.midi;
}
export async function startPreparedRuntime({runtime, midi, epoch, currentIntent = () => true, mode = 'game', bestEffortMidiResume = false}: {
  runtime: PreparedStartRuntime; midi: MidiController | null; epoch: number; currentIntent?: () => boolean;
  /** Replay is the sole Multiplayer start allowed through this shared gate. */
  mode?: 'game' | 'multiplayer-replay';
  /** Match the legacy launch path: MIDI setup is required, resume is not. */
  bestEffortMidiResume?: boolean;
}): Promise<'started' | 'audio-prepared' | 'superseded'> {
  const acceptedMultiplayerReplay = () => {
    const live = runtime.getSnapshot(), controls = runtime.getLauncherControlContext();
    if (live.runtimeVariant !== 'multiplayer' || live.game === null || controls?.epoch !== epoch ||
        controls.game !== live.game || controls.runtimeVariant !== 'multiplayer' || controls.options.replayViewer !== true ||
        controls.options.multiplayerPreflight === true || Object.keys(controls.options).some(key => key.startsWith('netplay'))) return false;
    return true;
  };
  const current = () => {const live = runtime.getSnapshot(); return currentIntent() && live.epoch === epoch && live.phase === 'prepared' &&
    (mode === 'multiplayer-replay' ? acceptedMultiplayerReplay() : live.runtimeVariant !== 'multiplayer') &&
    !live.fileOperationBusy && !live.saveError;};
  if (!current()) return 'superseded';
  // Required audio comes from the exact prepared plan, never the potentially
  // delayed React MIDI snapshot or a stale acquisition preference generation.
  if (preparedRuntimeNeedsMidi(runtime, epoch)) {
    if (!midi) throw new Error('Wait for the MIDI bridge before starting this Runtime');
    if (!midi.getSnapshot().ready) {
      await midi.ensureReady();
      if (!current()) return 'superseded';
      if (!bestEffortMidiResume) return 'audio-prepared';
    }
    let resume: Promise<void>;
    if (bestEffortMidiResume) {
      // Main awaits synth/MIDI setup but lets AudioContext.resume settle in the
      // background. MidiController publishes resume errors in its own snapshot.
      resume = midi.resumeForGesture(epoch);
      void resume.catch(() => {});
    } else {
      resume = midi.resumeForGesture(epoch); // Starts synchronously while the gesture is active.
    }
    // The Runtime context exists only after prepare(), so open selected hardware
    // outputs here, immediately before launch. Start the open in the same gesture
    // stack as resume; output failures remain a MIDI-owner fallback/status.
    let external: Promise<void> | undefined;
    try {external = midi.prepareExternalMidi(epoch, currentIntent);} catch {}
    if (!bestEffortMidiResume) await resume;
    await external?.catch(() => {});
  }
  if (!current()) return 'superseded';
  await runtime.launch(); return 'started';
}
