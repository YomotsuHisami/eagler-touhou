import {createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import type {MidiController} from '../services/midi.client';
const Context = createContext<MidiController | null>(null);
const none = () => () => {};
const empty = () => null;
export function useMidi() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
/** This root bridge survives route changes and owns only MIDI/focus listeners. */
export function MidiProvider({children}: {children: ReactNode}) {
  const runtime = useRuntimeService();
  const [controller, setController] = useState<MidiController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<{runtime: NonNullable<typeof runtime>; controller: MidiController} | null>(null);
  const effectSerial = useRef(0), activeDocument = useRef(true);
  useEffect(() => {
    const effect = ++effectSerial.current;
    let attached = true;
    const activity = () => retained.current?.controller.activityChanged();
    const hide = () => {activeDocument.current = false; retained.current?.controller.pagehide();};
    const show = () => {activeDocument.current = true; retained.current?.controller.pageshow(); void initialize();};
    async function initialize() {
      if (!runtime || !attached || !activeDocument.current) return;
      try {
        const [{createMidiController}, {loadDocumentMidiSynth}] = await Promise.all([
          import('../services/midi.client'), import('../runtime/midi-synth-loader.client'),
        ]);
        if (!attached || !activeDocument.current || effect !== effectSerial.current) return;
        if (retained.current?.runtime !== runtime) {retained.current?.controller.dispose(); retained.current = null;}
        if (!retained.current) retained.current = {runtime, controller: createMidiController({runtime, loadSynth: loadDocumentMidiSynth,
          getActivity: () => ({visible: document.visibilityState !== 'hidden', focused: document.hasFocus(),
            runtimeFocused: document.activeElement instanceof HTMLIFrameElement && document.activeElement.contentWindow === runtime.getMidiEventContext()?.target}),
        })};
        setController(retained.current.controller); setError(null);
      } catch (reason) {if (attached && activeDocument.current) setError(reason instanceof Error ? reason.message : String(reason));}
    }
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    window.addEventListener('blur', activity); window.addEventListener('focus', activity);
    document.addEventListener('visibilitychange', activity);
    void initialize();
    return () => {
      attached = false;
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
      window.removeEventListener('blur', activity); window.removeEventListener('focus', activity);
      document.removeEventListener('visibilitychange', activity);
      queueMicrotask(() => {if (effectSerial.current === effect) {retained.current?.controller.dispose(); retained.current = null;}});
    };
  }, [runtime]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">MIDI 服务不可用：{error}</p>}<MidiNotice/></Context.Provider>;
}
function MidiNotice() {
  const {controller, snapshot} = useMidi(), live = useRuntimeSnapshot();
  if (!controller || !snapshot || snapshot.activeEpoch === null || snapshot.activeEpoch !== live?.epoch || !live.launched || !snapshot.suspended) return null;
  return <aside aria-label="MIDI 音频状态" className="fixed bottom-3 left-3 z-30 max-w-sm rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role={snapshot.error ? 'alert' : 'status'}>{snapshot.error ?? 'MIDI 音频已暂停。返回游戏可继续播放。'}</p>
    <button type="button" className="mt-2 min-h-11 rounded-lg border border-line px-3" onClick={() => void controller.resumeForGesture(snapshot.activeEpoch!).catch(() => {})}>启用 MIDI 声音</button>
  </aside>;
}
