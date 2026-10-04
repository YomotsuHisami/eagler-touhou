/** Explicit user-gesture Start only; no job or route-selection ownership. */
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import type {RuntimeLauncherControlContext, RuntimeMidiEventContext, RuntimeSnapshot} from '../services/runtime.client';
import type {MidiController} from '../services/midi.client';
export interface PreparedStartRuntime {
  getSnapshot(): Pick<RuntimeSnapshot, 'phase' | 'epoch' | 'fileOperationBusy' | 'runtimeVariant' | 'saveError' | 'music'>;
  getLauncherControlContext(): RuntimeLauncherControlContext | null;
  getMidiEventContext(): RuntimeMidiEventContext | null;
  launch(): Promise<RuntimeSnapshot>;
}
export function preparedRuntimeNeedsMidi(runtime: PreparedStartRuntime, epoch: number) {
  const context = runtime.getMidiEventContext();
  return !!context && context.epoch === epoch && context.music !== 'none' && PRODUCT_GAMES[context.game].musicCapabilities.midi;
}
export async function startPreparedRuntime({runtime, midi, epoch, currentIntent = () => true}: {
  runtime: PreparedStartRuntime; midi: MidiController | null; epoch: number; currentIntent?: () => boolean;
}): Promise<'started' | 'audio-prepared' | 'superseded'> {
  const current = () => {const live = runtime.getSnapshot(); return currentIntent() && live.epoch === epoch && live.phase === 'prepared' && live.runtimeVariant !== 'multiplayer' && !live.fileOperationBusy && !live.saveError;};
  if (!current()) return 'superseded';
  // Required audio comes from the exact prepared plan, never the potentially
  // delayed React MIDI snapshot or a stale acquisition preference generation.
  if (preparedRuntimeNeedsMidi(runtime, epoch)) {
    if (!midi) throw new Error('Wait for the MIDI bridge before starting this Runtime');
    if (!midi.getSnapshot().ready) {await midi.ensureReady(); return 'audio-prepared';}
    await midi.resumeForGesture(epoch); // Called before first await preserves activation.
  }
  if (!current()) return 'superseded';
  await runtime.launch(); return 'started';
}
