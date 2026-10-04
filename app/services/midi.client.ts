/** Native MIDI event bridge. Owns no Runtime, filesystem, package or timers.
 * TinySynth is injected and retained once per document by the browser adapter.
 * Epoch/document/window checks surround every native event and asynchronous load.
 */
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import type {RuntimeMidiEventContext, RuntimeSnapshot} from './runtime.client';
export interface MidiAudioContext {
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}
export interface MidiSynth {
  send(bytes: number[]): void;
  reset(): void;
  getAudioContext(): MidiAudioContext;
}
export interface MidiRuntimePort {
  getSnapshot(): Pick<RuntimeSnapshot, 'epoch' | 'game' | 'phase' | 'launched' | 'ready'>;
  getMidiEventContext(): RuntimeMidiEventContext | null;
  subscribe(listener: () => void): () => void;
}
export interface MidiActivity {visible: boolean; focused: boolean; runtimeFocused: boolean}
export interface MidiSnapshot {
  readonly ready: boolean;
  readonly loading: boolean;
  readonly activeEpoch: number | null;
  readonly suspended: boolean;
  readonly error: string | null;
}
export interface MidiOptions {
  runtime: MidiRuntimePort;
  loadSynth(): Promise<MidiSynth>;
  getActivity(): MidiActivity;
}
const message = (value: unknown) => value instanceof Error ? value.message : String(value);
export function createMidiController(options: MidiOptions) {
  const runtime = options.runtime;
  let snapshot: MidiSnapshot = Object.freeze({ready: false, loading: false, activeEpoch: null, suspended: true, error: null});
  const listeners = new Set<() => void>();
  let disposed = false, documentActive = true, serial = 0;
  let synth: MidiSynth | null = null, loading: Promise<void> | null = null;
  let binding: RuntimeMidiEventContext | null = null;
  let gestureEpoch: number | null = null;
  let suspended = true, desiredAudio = false, audioSerial = 0;
  let bindingListeners: {midi: EventListener; close: EventListener; focus: EventListener; blur: EventListener} | null = null;
  // TinySynth.send auto-resumes its context. Drop background notes and retain
  // bounded channel state, instead of letting hidden events defeat suspension.
  const channelState = new Map<string, number[]>();
  function update(patch: Partial<MidiSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch});
    for (const listener of listeners) listener();
  }
  function current(expected = binding) {
    if (disposed || !documentActive || !expected) return null;
    const now = runtime.getMidiEventContext();
    return now && now.epoch === expected.epoch && now.game === expected.game && now.document === expected.document && now.target === expected.target && now.music === expected.music ? now : null;
  }
  function playable(expected = binding) {
    const now = current(expected), live = runtime.getSnapshot();
    return !!now && PRODUCT_GAMES[now.game].musicCapabilities.midi && now.music !== 'none' &&
      live.epoch === now.epoch && (live.launched || live.phase === 'launching');
  }
  function foreground() {
    const activity = options.getActivity();
    return activity.visible && activity.focused && (activity.runtimeFocused || gestureEpoch === binding?.epoch);
  }
  function hush(reset = true) {
    const alreadySuspended = suspended && !desiredAudio && synth?.getAudioContext().state === 'suspended';
    desiredAudio = false; audioSerial++;
    if (!synth || alreadySuspended) return;
    try {if (reset) synth.reset();} catch { /* Suspend still runs if native reset failed. */ }
    suspended = true;
    try {void synth.getAudioContext().suspend().catch(error => update({error: message(error)}));}
    catch (error) {update({error: message(error)});}
    update({suspended: true});
  }
  function onMidi(event: Event, expected: RuntimeMidiEventContext) {
    if (!current(expected) || !playable(expected)) return;
    if (event.target !== expected.target) return;
    const bytes = (event as CustomEvent<{bytes?: unknown}>).detail?.bytes;
    if (!Array.isArray(bytes) || !bytes.length || bytes.length > 65_536 ||
        !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255) || bytes[0] < 0x80) return;
    const command = bytes[0] & 0xf0;
    if (command >= 0x80 && command <= 0xe0) {
      if (bytes.length < (command === 0xc0 || command === 0xd0 ? 2 : 3) || bytes.slice(1).some(value => value > 127)) return;
    } else if (bytes[0] !== 0xf0 || bytes.length < 2 || bytes.at(-1) !== 0xf7 || bytes.slice(1, -1).some(value => value > 127)) return;
    // Retain only channel configuration. Notes are never delayed/replayed.
    if ([0xb0, 0xc0, 0xd0, 0xe0].includes(command)) channelState.set(`${bytes[0]}:${command === 0xb0 ? bytes[1] : 0}`, [...bytes]);
    if (!synth || !foreground() || suspended || synth.getAudioContext().state !== 'running') return;
    try {synth.send([...bytes]);} catch (error) {update({error: message(error)});}
  };
  function onClose(event: Event, expected: RuntimeMidiEventContext) {
    if (event.target !== expected.target || !current(expected)) return;
    channelState.clear(); try {synth?.reset();} catch (error) {update({error: message(error)});}
  };
  function unbind() {
    const old = binding; binding = null; gestureEpoch = null; channelState.clear();
    if (old && bindingListeners) {
      try {
        old.target.removeEventListener('touhou-midi', bindingListeners.midi); old.target.removeEventListener('touhou-midi-close', bindingListeners.close);
        old.target.removeEventListener('focus', bindingListeners.focus); old.target.removeEventListener('blur', bindingListeners.blur);
      } catch { /* A replaced cross-origin Window may no longer expose listeners. */ }
    }
    bindingListeners = null;
    hush(); update({activeEpoch: null});
  }
  function refresh() {
    if (disposed || !documentActive) return;
    const next = runtime.getMidiEventContext();
    if (!next || !PRODUCT_GAMES[next.game].musicCapabilities.midi || next.music === 'none') {if (binding) unbind(); return;}
    if (!binding || binding.epoch !== next.epoch || binding.document !== next.document || binding.target !== next.target || binding.music !== next.music) {
      unbind(); binding = next;
      bindingListeners = {midi: event => onMidi(event, next), close: event => onClose(event, next),
        focus: () => {if (current(next)) activityChanged();}, blur: () => {if (current(next)) {gestureEpoch = null; hush();}}};
      try {
        next.target.addEventListener('touhou-midi', bindingListeners.midi); next.target.addEventListener('touhou-midi-close', bindingListeners.close);
        next.target.addEventListener('focus', bindingListeners.focus); next.target.addEventListener('blur', bindingListeners.blur);
      } catch (error) {unbind(); update({error: message(error)}); return;}
      update({activeEpoch: next.epoch});
    }
    if (!playable() || !foreground()) hush();
  }
  async function ensureReady(signal?: AbortSignal) {
    if (disposed || !documentActive || signal?.aborted) throw new DOMException('MIDI preparation was cancelled', 'AbortError');
    if (synth) return;
    if (!loading) {
      const ticket = serial;
      update({loading: true, error: null});
      const task = options.loadSynth().then(value => {
        if (disposed || !documentActive || ticket !== serial) {
          try {value.reset(); void value.getAudioContext().suspend().catch(() => {});} catch {}
          throw new DOMException('MIDI preparation was cancelled', 'AbortError');
        }
        synth = value; hush(); update({ready: true, loading: false, error: null}); refresh();
      }).catch(error => {if (!disposed && ticket === serial) update({loading: false, error: message(error)}); throw error;})
        .finally(() => {if (loading === task) loading = null;});
      void task.catch(() => {}); loading = task;
    }
    await loading;
    if (disposed || !documentActive || signal?.aborted) throw new DOMException('MIDI preparation was cancelled', 'AbortError');
  }
  /** Invoke synchronously in a user gesture before launch. Never starts Runtime. */
  function resumeForGesture(epoch: number): Promise<void> {
    refresh();
    const expected = binding;
    if (!synth || !expected || expected.epoch !== epoch || !current(expected)) return Promise.reject(new Error('MIDI is not prepared for this Runtime'));
    const audio = synth.getAudioContext(), ticket = serial;
    const activity = options.getActivity();
    if (!activity.visible || !activity.focused) return Promise.reject(new Error('Return to the game to enable MIDI audio'));
    gestureEpoch = epoch; desiredAudio = true; const audioTicket = ++audioSerial;
    // resume is called before any await, preserving the browser user gesture.
    let pending: Promise<void>;
    try {pending = audio.resume();} catch (error) {hush(); update({error: message(error)}); return Promise.reject(error);}
    return pending.then(() => {
      if (audioTicket !== audioSerial || disposed || ticket !== serial || !current(expected) || !foreground()) {
        // Late resume must neither revive a departed document nor suspend a
        // newer epoch which independently requested audio in the meantime.
        if (!desiredAudio) void audio.suspend().catch(() => {});
        return;
      }
      suspended = audio.state !== 'running';
      if (!suspended) for (const bytes of channelState.values()) synth!.send([...bytes]);
      update({suspended, error: suspended ? 'MIDI audio is suspended; tap to enable it' : null});
    }).catch(error => {if (audioTicket === audioSerial) {hush(); update({error: message(error)});} throw error;});
  }
  function activityChanged() {
    if (disposed || !documentActive) return;
    gestureEpoch = null; refresh();
    if (!playable() || !foreground()) {hush(); return;}
    if (synth && binding) void resumeForGesture(binding.epoch).catch(() => {});
  }
  function pagehide() {
    if (disposed) return;
    documentActive = false; serial++; unbind(); update({loading: false});
  }
  function pageshow() {if (!disposed) {documentActive = true; refresh();}}
  const unsubscribe = runtime.subscribe(refresh);
  refresh();
  return Object.freeze({ensureReady, resumeForGesture, activityChanged, pagehide, pageshow,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    dispose() {if (disposed) return; pagehide(); unsubscribe(); disposed = true; listeners.clear();},
  });
}
export type MidiController = ReturnType<typeof createMidiController>;
