import type {MidiSynth, MidiSynthConstructor} from '../../src/launcher/app-types.mts';
import type {MusicMode} from '../../src/launcher/game-preferences.mts';
import type {ExternalMidiController} from './external-midi';
import type {RuntimeService, RuntimeMidiEventContext} from './runtime';

export interface MidiBridgeOptions {
  runtime: Pick<RuntimeService, 'getMidiEventContext' | 'getSnapshot' | 'subscribe'>;
  external: Pick<ExternalMidiController, 'prepare' | 'deliver' | 'panic'>;
  loadSynth(): Promise<MidiSynthConstructor | undefined>;
  webAudioAvailable: boolean;
  translate(key: string): string;
  frame: EventTarget;
  window: EventTarget;
  document: EventTarget & {readonly hidden: boolean; hasFocus(): boolean; readonly activeElement: unknown};
  playerOpen(): boolean;
}
function sameContext(a: RuntimeMidiEventContext | null, b: RuntimeMidiEventContext | null): boolean {
  return a === b || !!a && !!b && a.epoch === b.epoch && a.game === b.game && a.document === b.document && a.target === b.target;
}
/** One retained TinySynth and the existing external MIDI owner. The native
 * event bridge reauthenticates epoch/document on every event, even before a
 * pending iframe-load notification can trigger rebinding. */
export function createMidiBridge(options: MidiBridgeOptions) {
  let synth: MidiSynth | null = null;
  let loading: Promise<MidiSynth | null> | null = null;
  let bound: RuntimeMidiEventContext | null = null;
  let removeBound: (() => void) | null = null;
  let disposed = false;
  const resetSynth = () => {synth?.reset();};
  function reset() {resetSynth(); options.external.panic();}
  function authenticated(context: RuntimeMidiEventContext) {
    return !disposed && sameContext(context, options.runtime.getMidiEventContext());
  }
  function rebind() {
    if (disposed) return;
    const next = options.runtime.getMidiEventContext();
    if (sameContext(bound, next)) return;
    removeBound?.(); removeBound = null;
    if (bound) reset();
    bound = next;
    if (!next) return;
    const onMidi: EventListener = event => {
      if (!authenticated(next)) return;
      const current = options.runtime.getMidiEventContext();
      if (current?.music !== 'midi' && current?.music !== 'ogg') return;
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      const bytes = detail && typeof detail === 'object' && !Array.isArray(detail) && 'bytes' in detail ? detail.bytes : null;
      if (!Array.isArray(bytes)) return;
      const message = bytes.filter((value): value is number => typeof value === 'number');
      // The existing controller resets the synth via beforeExternalTakeover.
      // A hardware output and browser synth must never double the same stream.
      if (!options.external.deliver(message)) synth?.send(message);
    };
    const onClose: EventListener = () => {if (authenticated(next)) reset();};
    next.target.addEventListener('touhou-midi', onMidi);
    next.target.addEventListener('touhou-midi-close', onClose);
    removeBound = () => {
      next.target.removeEventListener('touhou-midi', onMidi);
      next.target.removeEventListener('touhou-midi-close', onClose);
    };
  }
  async function prepare(music: MusicMode | 'ogg'): Promise<void> {
    if (disposed || music === 'none') return;
    if (!options.webAudioAvailable) throw new Error(options.translate('music.webAudioUnsupported'));
    if (!synth) {
      if (!loading) loading = options.loadSynth().then(Constructor => {
        if (disposed) return null;
        if (!Constructor) throw new Error(options.translate('music.synthMissing'));
        return synth ??= new Constructor({quality: 1, useReverb: 1, voices: 64});
      }).finally(() => {loading = null;});
      await loading;
    }
    if (disposed || !synth) return;
    const context = synth.getAudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    await options.external.prepare();
  }
  function suspend() {
    const context = synth?.getAudioContext();
    if (context?.state === 'running') void context.suspend().catch(() => {});
  }
  function resume() {
    if (disposed || !options.runtime.getSnapshot().launched || !options.playerOpen() || options.document.hidden ||
      !options.document.hasFocus() || options.document.activeElement !== options.frame) return;
    const context = synth?.getAudioContext();
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  }
  const visibility = () => {if (options.document.hidden) suspend(); else resume();};
  const pagehide = () => {options.external.panic();};
  options.frame.addEventListener('blur', suspend);
  options.frame.addEventListener('focus', resume);
  options.frame.addEventListener('load', rebind);
  options.window.addEventListener('blur', suspend);
  options.window.addEventListener('focus', resume);
  options.window.addEventListener('pagehide', pagehide);
  options.document.addEventListener('visibilitychange', visibility);
  const unsubscribe = options.runtime.subscribe(rebind);
  rebind();
  return {
    prepare, resetSynth, reset, rebind, suspend, resume,
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); removeBound?.(); removeBound = null; bound = null;
      options.frame.removeEventListener('blur', suspend);
      options.frame.removeEventListener('focus', resume);
      options.frame.removeEventListener('load', rebind);
      options.window.removeEventListener('blur', suspend);
      options.window.removeEventListener('focus', resume);
      options.window.removeEventListener('pagehide', pagehide);
      options.document.removeEventListener('visibilitychange', visibility);
      reset(); suspend();
    },
  };
}
export type MidiBridge = ReturnType<typeof createMidiBridge>;
