import {useLocale} from './LocaleProvider';
import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {PreparedRuntimeStart} from '../runtime/PreparedRuntimeStart';
import {MidiProvider, useMidi} from './MidiProvider';
import type {GameLaunchJobController} from '../services/game-launch-job.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useResourceManager} from './ResourceManagerProvider';
const Context = createContext<GameLaunchJobController | null>(null);
const none = () => () => {};
const empty = () => null;
export function useGameLaunchJob() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
/** Kept above all route/dialog subscribers. Page departure cancels acquisition;
 * route changes never dispose or replace the one Runtime host. */
export function GameLaunchProvider({children}: {children: ReactNode}) {
  return <MidiProvider><GameLaunchOwner>{children}</GameLaunchOwner></MidiProvider>;
}
function GameLaunchOwner({children}: {children: ReactNode}) {
  const {t} = useLocale();
  const fetchImpl = useDocumentRequestFetch();
  const {controller: midi} = useMidi();
  const {controller: resources} = useResourceManager();
  const resourcesRef = useRef(resources);
  const midiRef = useRef(midi);
  const runtime = useRuntimeService();
  const [controller, setController] = useState<GameLaunchJobController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef(runtime), previous = useRef(runtime), epoch = useRef(0);
  const retained = useRef<ReturnType<typeof createPreparationDocumentOwner<GameLaunchJobController>> | null>(null);
  useLayoutEffect(() => {
    runtimeRef.current = runtime; midiRef.current = midi; resourcesRef.current = resources;
    const effect = ++epoch.current;
    const owner = retained.current ?? createPreparationDocumentOwner<GameLaunchJobController>({
      target: window, ready: () => runtimeRef.current !== null && midiRef.current !== null && resourcesRef.current !== null,
      load: async () => {
        const {createGameLaunchJobController, updatePackageForLaunch} = await import('../services/game-launch-job.client');
        return () => {
          const current = runtimeRef.current;
          if (!current) throw new Error('Runtime 尚未就绪');
          let offlineStorage: Storage | null = null;
          try {offlineStorage = window.localStorage;} catch {}
          return createGameLaunchJobController({fetchImpl, offlineStorage,runtimeService: current, baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
            updatePackage: request => updatePackageForLaunch(resourcesRef.current, request),
            audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            midiAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            prepareMidi: signal => {if (!midiRef.current) throw new Error('MIDI service is not ready'); return midiRef.current.ensureReady(signal);}});
        };
      },
      onController: next => {setController(next); if (next) setError(null);},
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    retained.current = owner;
    if (previous.current !== runtime) {previous.current = runtime; owner.reset();}
    owner.attach();
    return () => {
      owner.detach();
      queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});
    };
  }, [runtime, midi, resources]);
  return <Context.Provider value={controller}>{children}{error && <p role="alert">{t('ui.providers.launch.unavailable')}{error}</p>}<GameLaunchNotice/><LaunchPackageUpdateNotice/><GameLaunchReady/><ProgressiveOggNotice/></Context.Provider>;
}
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function GameLaunchNotice() {
  const {t} = useLocale();
  const {controller, snapshot} = useGameLaunchJob();
  if (!snapshot?.preparing) return null;
  return <aside aria-label={t('ui.providers.launch.task')} className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    <p role="status">{t('ui.providers.launch.preparing', {product: snapshot.selection?.productId.toUpperCase() ?? ''})}</p>
    <button type="button" className={button} onClick={() => controller?.cancel()}>{t('ui.providers.launch.cancel')}</button>
  </aside>;
}

function GameLaunchReady() {
  const {snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const warnings = snapshot?.preparedEpoch === live?.epoch ? snapshot?.warnings ?? [] : [];
  return <PreparedRuntimeStart warnings={warnings}/>;
}

function ProgressiveOggNotice() {
  const {t} = useLocale();
  const {controller,snapshot}=useGameLaunchJob(),live=useRuntimeSnapshot(),ogg=snapshot?.ogg;
  if(!ogg||ogg.epoch!==live?.epoch||!['installing','error'].includes(ogg.phase))return null;
  return <aside aria-label={t('ui.providers.ogg.task')} className="fixed bottom-3 right-3 z-30 max-w-sm rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role={ogg.error?'alert':'status'}>{ogg.error??t('ui.providers.ogg.progress', {completed: ogg.completed, total: ogg.total})}</p>
    {ogg.phase==='error'?<button type="button" className={button} onClick={()=>controller?.retryOgg()}>{t('ui.providers.ogg.retry')}</button>:<button type="button" className={button} onClick={()=>controller?.cancelOgg()}>{t('ui.providers.ogg.stop')}</button>}
  </aside>;
}

function LaunchPackageUpdateNotice() {
  const {t} = useLocale(), {controller, snapshot} = useGameLaunchJob();
  const update = snapshot?.packageUpdate;
  if (!update || !['waiting', 'error'].includes(update.phase)) return null;
  return <aside aria-label={t('ui.providers.resources.task')} className="fixed bottom-3 right-3 z-30 max-w-sm rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu">
    <p role={update.error ? 'alert' : 'status'}>{update.error ?? t('react.launch.backgroundWaiting')}</p>
    {update.phase === 'waiting'
      ? <button type="button" className={button} onClick={() => controller?.cancelUpdate()}>{t('ui.providers.resources.cancelTask')}</button>
      : <button type="button" className={button} onClick={() => controller?.dismissUpdate()}>{t('ui.providers.resources.acknowledge')}</button>}
  </aside>;
}
