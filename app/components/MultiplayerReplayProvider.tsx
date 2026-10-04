import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import type {MultiplayerReplayJob} from '../services/multiplayer-replay.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useLocale} from './LocaleProvider';
import {useMidi} from './MidiProvider';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
const Context = createContext<MultiplayerReplayJob | null>(null);
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function useMultiplayerReplay() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
/** One document owner, mounted inside MIDI and room providers. No route creates
 * a second iframe or resets the Replay intent while resources are imported.
 */
export function MultiplayerReplayProvider({children}: {children: ReactNode}) {
  const {t} = useLocale(), fetchImpl = useDocumentRequestFetch();
  const runtime = useRuntimeService(), {controller: midi} = useMidi();
  const ports = useRef({runtime, midi}); ports.current = {runtime, midi};
  const retained = useRef<ReturnType<typeof createPreparationDocumentOwner<MultiplayerReplayJob>> | null>(null);
  const epoch = useRef(0), previous = useRef(runtime);
  const [controller, setController] = useState<MultiplayerReplayJob | null>(null);
  const [service, setService] = useState<typeof import('../services/multiplayer-replay.client') | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createPreparationDocumentOwner<MultiplayerReplayJob>({target: window,
      ready: () => !!ports.current.runtime && !!ports.current.midi,
      load: async () => {
        const module = await import('../services/multiplayer-replay.client');
        return () => {
          const current = ports.current;
          if (!current.runtime) throw new Error('Runtime is not ready');
          let offlineStorage: Storage | null = null;
          try {offlineStorage = window.localStorage;} catch {}
          const job = module.createMultiplayerReplayJob({fetchImpl, offlineStorage, runtimeService: current.runtime,
            baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href,
            audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            midiAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            prepareMidi: signal => {if (!ports.current.midi) throw new Error('MIDI service is not ready'); return ports.current.midi.ensureReady(signal);},
          });
          setService(module); return job;
        };
      },
      onController: next => {setController(next); if (next) setError(null);},
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    retained.current = owner;
    if (previous.current !== runtime) {previous.current = runtime; owner.reset();}
    owner.attach();
    return () => {owner.detach(); queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});};
  }, [runtime, midi]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">{t('ui.multiplayerReplay.unavailable', {reason: error})}</p>}<MultiplayerReplayNotice service={service}/></Context.Provider>;
}
function MultiplayerReplayNotice({service}: {service: typeof import('../services/multiplayer-replay.client') | null}) {
  const {t} = useLocale(), {controller, snapshot} = useMultiplayerReplay();
  const runtime = useRuntimeService(), live = useRuntimeSnapshot();
  const {controller: midi, snapshot: audio} = useMidi(), {controller: roomController, snapshot: room} = useMultiplayerRoom();
  const [starting, setStarting] = useState(false), [error, setError] = useState<string | null>(null);
  const intent = useRef(0);
  const readyEpoch = runtime && service ? service.preparedMultiplayerReplayEpoch(runtime) : null;
  useEffect(() => {intent.current++; setStarting(false); setError(null); return () => {intent.current++;};}, [readyEpoch, runtime, !!room?.route]);
  if (!snapshot?.preparing && readyEpoch === null) return null;
  const needsMidi = readyEpoch !== null && runtime && service ? service.multiplayerReplayNeedsMidi(runtime, readyEpoch) : false;
  return <aside aria-label={t('ui.multiplayerReplay.title')} className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status">{snapshot?.preparing ? t('ui.multiplayerReplay.preparing', {game: snapshot.selection?.productId.toUpperCase() ?? ''}) : t('ui.multiplayerReplay.ready', {game: live?.game?.toUpperCase() ?? ''})}</p>
    {snapshot?.preparing ? <button type="button" className={button} onClick={() => controller?.cancel()}>{t('ui.providers.launch.cancel')}</button> : <button type="button" className={button} disabled={!runtime || !service || starting || live?.fileOperationBusy || !!room?.route || (needsMidi && !midi)} onClick={() => {
      if (!runtime || !service || readyEpoch === null || room?.route) return;
      const ticket = ++intent.current; setStarting(true); setError(null);
      void service.startMultiplayerReplay({runtime, midi, epoch: readyEpoch, currentIntent: () => ticket === intent.current && !roomController?.getSnapshot().route})
        .catch(reason => {if (ticket === intent.current) setError(reason instanceof Error ? reason.message : String(reason));})
        .finally(() => {if (ticket === intent.current) setStarting(false);});
    }}>{starting ? t('ui.multiplayerReplay.starting') : needsMidi && !audio?.ready ? t('react.prepared.prepareMidi') : t('ui.multiplayerReplay.open')}</button>}
    {room?.route && <p role="status" className="basis-full text-muted">{t('ui.multiplayerReplay.leaveRoom')}</p>}
    {snapshot?.warnings.map((warning, index) => <p key={index} role="status" className="basis-full text-accent">{warning}</p>)}
    {error && <p role="alert" className="basis-full text-accent">{error}</p>}
  </aside>;
}
