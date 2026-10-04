/** DOM adapter for the existing official, pinned project dependency.
 * TinySynth 1.1.3 has no destroy API and retains a timer. Create it once per
 * document; owners reset+suspend it on teardown/BFCache instead of duplicating it.
 */
import vendorUrl from 'webaudio-tinysynth/webaudio-tinysynth.min.js?url';
import type {MidiSynth} from '../services/midi.client';
interface MidiWindow extends Window {
  WebAudioTinySynth?: new (options: {quality: number; useReverb: number; voices: number}) => MidiSynth;
}
let pending: Promise<MidiSynth> | null = null;
let retained: MidiSynth | null = null;
let constructionFailure: Error | null = null;
export function loadDocumentMidiSynth(): Promise<MidiSynth> {
  if (retained) return Promise.resolve(retained);
  if (constructionFailure) return Promise.reject(constructionFailure);
  if (pending) return pending;
  const host = window as MidiWindow;
  pending = new Promise<void>((resolve, reject) => {
    if (host.WebAudioTinySynth) {resolve(); return;}
    const script = document.createElement('script');
    const timer = window.setTimeout(() => finish(new Error('MIDI synthesizer load timed out')), 30_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) {script.remove(); reject(error);} else resolve();
    };
    script.src = vendorUrl; script.async = true;
    script.onload = () => finish(host.WebAudioTinySynth ? undefined : new Error('MIDI synthesizer did not initialize'));
    script.onerror = () => finish(new Error('MIDI synthesizer could not be loaded'));
    document.head.append(script);
  }).then(() => {
    if (!host.WebAudioTinySynth) throw new Error('MIDI synthesizer is unavailable');
    if (!('AudioContext' in host) && !('webkitAudioContext' in host)) throw new Error('Web Audio is unavailable');
    try {retained = new host.WebAudioTinySynth({quality: 1, useReverb: 1, voices: 64});}
    catch (error) {
      constructionFailure = error instanceof Error ? error : new Error(String(error));
      throw constructionFailure; // Avoid duplicating an undocumented vendor timer after construction failure.
    }
    return retained;
  }).finally(() => {pending = null;});
  return pending;
}
