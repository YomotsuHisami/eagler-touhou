/** Native MIDI event bridge. Owns no Runtime, filesystem, package or timers.
 * TinySynth is injected and retained once per document by the browser adapter.
 * Epoch/document/window checks surround every native event and asynchronous load.
 */
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import {ExternalMidiDevice, externalMidiOffered, navigatorMidiAccessRequest, type ExternalMidiOutputInfo} from '../../src/launcher/external-midi.mts';
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
  readonly externalMidiSupported: boolean;
  readonly externalMidiEnabled: boolean;
  readonly externalMidiGranted: boolean;
  readonly externalMidiSysexEnabled: boolean;
  readonly externalMidiOutputs: readonly ExternalMidiOutputInfo[];
  readonly externalMidiSelectedId: string;
  readonly externalMidiEffectiveId: string;
  readonly externalMidiError: string | null;
}
export interface ExternalMidiPort {
  readonly supported: boolean;
  readonly granted: boolean;
  readonly sysexEnabled: boolean;
  outputCount(): number;
  outputInfo(): ExternalMidiOutputInfo[];
  selectedId(): string;
  effectiveOutputId(): string;
  setSelectedId(id: string): void;
  ensureAccess(): Promise<unknown>;
  openOutputs(): Promise<number>;
  send(bytes: ArrayLike<number>): number;
  panic(): void;
  release(): void;
}
export interface MidiOptions {
  runtime: MidiRuntimePort;
  loadSynth(): Promise<MidiSynth>;
  getActivity(): MidiActivity;
  /** Injection seam for deterministic service tests; production uses Web MIDI. */
  externalMidi?: ExternalMidiPort;
}
const message = (value: unknown) => value instanceof Error ? value.message : String(value);
export function createMidiController(options: MidiOptions) {
  const runtime = options.runtime;
  let externalMidi: ExternalMidiPort | null = options.externalMidi ?? null;
  let externalMidiEnabled = false, externalMidiWasActive = false, externalMidiError: string | null = null, externalIntent = 0;
  let snapshot: MidiSnapshot = Object.freeze({ready: false, loading: false, activeEpoch: null, suspended: true, error: null,
    externalMidiSupported: false, externalMidiEnabled: false, externalMidiGranted: false, externalMidiSysexEnabled: false,
    externalMidiOutputs: Object.freeze([]), externalMidiSelectedId: '', externalMidiEffectiveId: '', externalMidiError: null});
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
  function externalFields() {
    const outputs = externalMidi?.outputInfo() ?? [];
    return {externalMidiSupported: externalMidi?.supported === true, externalMidiEnabled,
      externalMidiGranted: externalMidi?.granted === true, externalMidiSysexEnabled: externalMidi?.sysexEnabled === true,
      externalMidiOutputs: Object.freeze(outputs.map(output => Object.freeze({...output}))),
      externalMidiSelectedId: externalMidi?.selectedId() ?? '', externalMidiEffectiveId: externalMidi?.effectiveOutputId() ?? '',
      externalMidiError};
  }
  function update(patch: Partial<MidiSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch, ...externalFields()});
    for (const listener of listeners) listener();
  }
  externalMidi ??= new ExternalMidiDevice({requestAccess: navigatorMidiAccessRequest(typeof navigator === 'undefined' ? null : navigator), onChange: () => update({})});
  update({});
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
  function externalPlayable(expected: RuntimeMidiEventContext) {
    return externalMidiEnabled && !!externalMidi?.granted && externalMidi.sysexEnabled && externalMidi.outputCount() > 0 &&
      externalMidiOffered(PRODUCT_GAMES[expected.game].musicCapabilities.midi, expected.music);
  }
  function externalMode(expected: RuntimeMidiEventContext) {
    return externalMidiEnabled && !!externalMidi?.granted && externalMidi.sysexEnabled &&
      externalMidiOffered(PRODUCT_GAMES[expected.game].musicCapabilities.midi, expected.music);
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
    if (externalPlayable(expected)) {
      // Keep the current Runtime's sequencer as the only timing owner. Switch
      // the audible sink only when the selected hardware accepts the message.
      try {
        if ((externalMidi?.send(bytes) ?? 0) > 0) {
          if (!externalMidiWasActive) {try {synth?.reset();} catch (error) {update({error: message(error)});}}
          externalMidiWasActive = true;
          return;
        }
        externalMidiError = 'web-midi-no-device';update({});
      } catch (error) {externalMidiError = message(error);update({});}
      if (externalMidiWasActive) externalMidi?.panic();
      externalMidiWasActive = false;
    } else if (externalMidiWasActive) {
      externalMidi?.panic();externalMidiWasActive = false;externalMidiError = 'web-midi-no-device';update({});
    }
    if (!synth || !foreground() || suspended || synth.getAudioContext().state !== 'running') return;
    try {synth.send([...bytes]);} catch (error) {update({error: message(error)});}
  };
  function onClose(event: Event, expected: RuntimeMidiEventContext) {
    if (event.target !== expected.target || !current(expected)) return;
    channelState.clear(); externalMidiWasActive = false; externalMidi?.panic();
    try {synth?.reset();} catch (error) {update({error: message(error)});}
  };
  function unbind() {
    const old = binding; binding = null; gestureEpoch = null; channelState.clear();
    externalMidiWasActive = false; externalMidi?.panic();
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
    if (!synth && !loading) {
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
  async function prepareExternalMidi(epoch: number, currentIntent: () => boolean = () => true): Promise<void> {
    const expected = runtime.getMidiEventContext(), intent = externalIntent, documentTicket = serial;
    if (!expected || expected.epoch !== epoch || !externalMode(expected) || !externalMidi) return;
    const stillCurrent = () => {
      let selected = false;try {selected = currentIntent() === true;} catch {}
      return selected && !disposed && documentActive && documentTicket === serial && intent === externalIntent &&
        externalMidiEnabled && !!current(expected) && runtime.getSnapshot().epoch === epoch && runtime.getSnapshot().ready;
    };
    if (!stillCurrent()) return;
    if (!externalMidi.outputCount()) {externalMidiError = 'web-midi-no-device'; update({}); return;}
    try {
      const opened = await externalMidi.openOutputs();
      if (!stillCurrent()) return;
      externalMidiError = opened ? null : 'web-midi-no-device'; update({});
    } catch (error) {
      if (stillCurrent()) {externalMidiError = message(error); update({});}
    }
  }
  async function setExternalMidiEnabled(enabled: boolean, currentIntent: () => boolean = () => true): Promise<void> {
    const intent = ++externalIntent, documentTicket = serial;
    const runtimeEpoch = runtime.getSnapshot().epoch;
    const runtimeContext = runtime.getMidiEventContext();
    if (!enabled) {
      externalMidiEnabled = false; externalMidiError = null; externalMidiWasActive = false;
      externalMidi?.panic();
      try {synth?.reset();} catch (error) {update({error: message(error)});}
      update({}); return;
    }
    if (!externalMidi?.supported) {
      externalMidiError = 'web-midi-unsupported'; update({});
      throw new Error(externalMidiError);
    }
    externalMidiError = null; update({});
    const selectionCurrent = () => {try {return currentIntent() === true;} catch {return false;}};
    const runtimeStillCurrent = () => runtimeContext ? !!current(runtimeContext) : runtime.getMidiEventContext() === null;
    const stillCurrent = () => !disposed && documentActive && documentTicket === serial && intent === externalIntent &&
      runtime.getSnapshot().epoch === runtimeEpoch && runtimeStillCurrent() && selectionCurrent();
    try {
      // Called directly by the settings switch from a user gesture. The
      // canonical adapter requests SysEx because Runtime streams include it.
      await externalMidi.ensureAccess();
      if (!stillCurrent()) throw new DOMException('External MIDI request was superseded', 'AbortError');
      if (!externalMidi.sysexEnabled) {
        externalMidi.release(); externalMidiError = 'web-midi-sysex-denied'; update({});
        throw new Error(externalMidiError);
      }
      externalMidiEnabled = true; externalMidiError = null; update({});
    } catch (error) {
      if (stillCurrent()) {externalMidiEnabled = false; externalMidiError = message(error); update({});}
      throw error;
    }
  }
  function setExternalMidiDeviceId(id: string) {
    if (!externalMidi) return;
    if (externalMidi.selectedId() !== id) {
      externalMidi.panic(); externalMidiWasActive = false;
      try {synth?.reset();} catch (error) {update({error: message(error)});}
    }
    externalMidi.setSelectedId(id); externalMidiError = null; update({});
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
    documentActive = false; serial++; externalIntent++; externalMidi?.panic(); unbind(); update({loading: false});
  }
  function pageshow() {if (!disposed) {documentActive = true; refresh();}}
  const unsubscribe = runtime.subscribe(refresh);
  refresh();
  return Object.freeze({ensureReady, resumeForGesture, activityChanged, pagehide, pageshow,
    setExternalMidiEnabled, setExternalMidiDeviceId, prepareExternalMidi,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    dispose() {if (disposed) return; pagehide(); unsubscribe(); externalMidi?.release(); disposed = true; listeners.clear();},
  });
}
export type MidiController = ReturnType<typeof createMidiController>;
