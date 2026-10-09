import {useLocale} from './LocaleProvider';
import {ManagementSurfacePortal} from './ManagementSurface';
import {createContext, useContext, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation, useNavigation} from 'react-router';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {MidiProvider, useMidi} from './MidiProvider';
import type {GameLaunchJobController} from '../services/game-launch-job.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useResourceManager} from './ResourceManagerProvider';
import {createSettingsLaunchController, type SettingsLaunchController} from '../services/settings-launch.client';
import {browserLaunchInputDevice} from '../services/launch-warnings';
import {LaunchWarnings, useLaunchWarningGate} from './LaunchWarnings';
import {usePlayerSurface} from '../runtime/PlayerToolsSurface';
import {requestPlayerFullscreen} from '../services/player-tools.client';
import {useGamePackageImport} from './GamePackageImport';
import {GamePackageImporterProvider} from './GamePackageImporterContext';
import {usePreferencesStore} from './GameSettingsProvider';
import {useResourcePreferences} from './ResourceManagerProvider';
import {gameIdForProduct, isProductId} from '../../src/contracts/product-catalog.mts';
import type {SettingsLaunchSelection} from '../services/settings-launch.client';
import {AnimatedDialog} from './AnimatedDialog';
import type {LaunchUpdateChoice} from '../services/game-launch-job.client';
import {playerIntentScope} from '../runtime/route-session.mts';
const Context = createContext<GameLaunchJobController | null>(null);
const StartContext = createContext<SettingsLaunchController | null>(null);
export type PackageUpdateChoice = (source: 'local' | 'remote' | null, current: () => boolean, signal: AbortSignal) => Promise<LaunchUpdateChoice>;
const PackageUpdateContext = createContext<PackageUpdateChoice | null>(null);
export function usePackageUpdateChoice() {return useContext(PackageUpdateContext);}
export {useGamePackageImporter} from './GamePackageImporterContext';
const none = () => () => {};
const empty = () => null;
export function useGameLaunchJob() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
export function useSettingsGameLaunch() {
  const controller = useContext(StartContext);
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
  const translate = useRef(t); translate.current = t;
  const fetchImpl = useDocumentRequestFetch();
  const {controller: midi} = useMidi();
  const {controller: resources} = useResourceManager();
  const resourcesRef = useRef(resources);
  const midiRef = useRef(midi);
  const runtime = useRuntimeService();
  const playerSurface = usePlayerSurface();
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);
  const packageImport = useGamePackageImport(), preferences = usePreferencesStore(), metadata = useResourcePreferences();
  const launchRequest = useRef(0), launchPorts = useRef({preferences, metadata});
  const [updateDecision, setUpdateDecision] = useState<{message: string; finish(choice: LaunchUpdateChoice): void; cancel(): void; current(): boolean} | null>(null);
  const choosePackageUpdate = useCallback<PackageUpdateChoice>((source, current, signal) => new Promise(resolve => {
    let settled = false;
    const finish = (choice: LaunchUpdateChoice) => {if (settled) return;settled = true;signal.removeEventListener('abort', cancel);setUpdateDecision(null);resolve(choice);};
    const cancel = () => finish('keep-current');
    signal.addEventListener('abort', cancel, {once: true});
    if (signal.aborted || !current()) {cancel();return;}
    setUpdateDecision({message: translate.current(source === 'local' ? 'package.updateAvailableLocal' : 'package.updateAvailableRemote'), current, cancel, finish});
  }), []);
  launchPorts.current = {preferences, metadata};
  const [controller, setController] = useState<GameLaunchJobController | null>(null);
  const location = useLocation(), navigation = useNavigation(), warnings = useLaunchWarningGate();
  const visibleRoute = useRef(location.pathname);
  visibleRoute.current = navigation.location?.pathname ?? location.pathname;
  const visibleScope = useRef(''), committedScope = useRef(''), committedPath = useRef(location.pathname);
  const starterRef = useRef<SettingsLaunchController | null>(null);
  const desired = navigation.location ?? location;
  visibleScope.current = playerIntentScope(desired);
  committedScope.current = playerIntentScope(location);committedPath.current = location.pathname;
  const starter = useMemo(() => controller && runtime ? createSettingsLaunchController({job: controller, runtime, midi, warnings,
    device: browserLaunchInputDevice,
    acquireStart: () => playerSurface?.beginStart(() => {starterRef.current?.cancel();packageImport.dismiss();launchRequest.current++;}) ?? (() => {}),
    enterPlayer: () => playerSurface?.element ? requestPlayerFullscreen(playerSurface.element).catch(reason => {setPlayerNotice(translate.current('fullscreen.autoBlocked', {reason: reason instanceof Error ? reason.message : String(reason)}));}) : undefined,
    chooseUpdate: (_selection, current, signal) => {
      const inspection = controller.getSnapshot().inspection;
      if (!inspection?.updateAvailable) return Promise.resolve('keep-current');
      return choosePackageUpdate(inspection.source ?? null, current, signal);
    },
    current: selection => {
      const nativeOwned = runtime.getSnapshot().epoch != null;
      const path = nativeOwned ? committedPath.current : visibleRoute.current, scope = nativeOwned ? committedScope.current : visibleScope.current;
      return path.replace(/\/$/, '') === `/play/${selection.productId}` && (!selection.contextKey || scope === selection.contextKey);
    },
  }) : null, [controller, runtime, midi, warnings, playerSurface?.beginStart, playerSurface?.element, choosePackageUpdate, packageImport.dismiss]);
  starterRef.current = starter;
  useLayoutEffect(() => () => starter?.dispose(), [starter]);
  useLayoutEffect(() => {starter?.recheck();}, [starter, location, navigation.location]);
  useLayoutEffect(() => {if (updateDecision && !updateDecision.current()) {updateDecision.cancel(); setUpdateDecision(null);}}, [updateDecision, location, navigation.location]);
  const startActions = useMemo(() => starter && controller ? Object.freeze({...starter, launch(input: SettingsLaunchSelection) {
    const ticket = ++launchRequest.current, captured = {...structuredClone(input), contextKey: committedScope.current};
    const current = () => launchRequest.current === ticket && visibleScope.current === captured.contextKey && visibleRoute.current.replace(/\/$/, '') === `/play/${captured.productId}`;
    const showImport = (reason?: string, resume = true) => {
      if (!current() || !isProductId(captured.productId)) return;
      const productId = captured.productId;
      const inspection = controller.getSnapshot().inspection;
      // A failed Start releases the player and remounts the lower settings
      // sheet. Commit that sheet's Radix scope before mounting its recovery
      // dialog, otherwise both hideOthers effects hide each other from AT.
      requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!current()) return;
      packageImport.open(productId, {reason, fallback: inspection?.gameDataFallback ?? undefined,
        onDismiss: () => {if (launchRequest.current === ticket) {launchRequest.current++;starter.cancel();}},
        onImported: () => {
          if (!resume || !current()) return;
          void controller.inspect(productId).then(async () => {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            if (!current()) return;
            const fresh = launchPorts.current.preferences?.getSnapshot(productId);
            const selected = fresh ? {...fresh, options: captured.preferences.options,
              language: captured.preferences.language ?? fresh.language, music: captured.preferences.music ?? fresh.music,
              musicPreference: captured.preferences.musicPreference, musicPreferenceExplicit: captured.preferences.musicPreferenceExplicit} : captured.preferences;
            const started = await starter.resume({...captured, preferences: selected});
            if (!started && current() && starter.getSnapshot().dataRecovery) showImport(starter.getSnapshot().error ?? undefined);
          }).catch(() => {});
        }});
      }));
    };
    const inspection = controller.getSnapshot().inspection;
    const context = isProductId(captured.productId) ? launchPorts.current.metadata(gameIdForProduct(captured.productId)) : null;
    if (context?.musicAvailability?.importServer && !inspection?.generationId) {
      if (starter.deferForImport(captured)) showImport(); return Promise.resolve(false);
    }
    const run = (selection: SettingsLaunchSelection) => starter.launch(selection).then(started => {
      if (!started && current()) {
        const failure = starter.getSnapshot();
        if (failure.error && failure.dataRecovery) showImport(failure.errorCode === 'download-cancelled' ? translate.current('package.manualCancelledReason') : failure.error);
      }
      return started;
    });
    return run(captured);
  }}) : null, [starter, controller, packageImport.open]);
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
          return createGameLaunchJobController({fetchImpl, offlineStorage,runtimeService: current, baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href,
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
  return <GamePackageImporterProvider open={packageImport.open} dismiss={packageImport.dismiss}><PackageUpdateContext.Provider value={choosePackageUpdate}><StartContext.Provider value={startActions}><Context.Provider value={controller}>{children}<LaunchWarnings gate={warnings}/>{packageImport.dialog}
    <AnimatedDialog open={updateDecision !== null} onOpenChange={open => {if (!open) updateDecision?.finish('keep-current');}} title={t('dialog.confirmTitle')} description={updateDecision?.message} layer={65}>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className="min-h-11 rounded-xl border border-line px-4 py-2" onClick={() => updateDecision?.finish('keep-current')}>{t('package.keepCurrent')}</button>
        <button type="button" className="min-h-11 rounded-xl border border-line px-4 py-2" onClick={() => updateDecision?.finish('background')}>{t('action.backgroundDownload')}</button>
        <button type="button" className="min-h-11 rounded-xl bg-red px-4 py-2 font-bold" onClick={() => updateDecision?.finish('update-now')}>{t('package.updateNow')}</button>
      </div>
  </AnimatedDialog>
    {playerNotice && <ManagementSurfacePortal>{docked => <aside role="status" className={`${docked ? '' : 'fixed bottom-3 left-3 z-60 max-w-lg'} rounded-xl bg-panel p-3 text-sm text-paper shadow-menu`}>
      <p>{playerNotice}</p><button type="button" className="min-h-11 text-xs underline" onClick={() => setPlayerNotice(null)}>{t('action.close')}</button>
    </aside>}</ManagementSurfacePortal>}
    {error && <p role="alert">{t('ui.providers.launch.unavailable')}{error}</p>}<GameLaunchNotice/><LaunchPackageUpdateNotice/><ProgressiveOggNotice/></Context.Provider></StartContext.Provider></PackageUpdateContext.Provider></GamePackageImporterProvider>;
}
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function GameLaunchNotice() {
  const {t} = useLocale();
  const {controller, snapshot} = useGameLaunchJob();
  const {controller: start} = useSettingsGameLaunch();
  if (!snapshot?.preparing) return null;
  return <ManagementSurfacePortal>{docked => <aside aria-label={t('ui.providers.launch.task')} className={`${docked ? '' : 'fixed right-3 bottom-3 left-3 z-30 sm:left-auto sm:max-w-lg'} flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu`}>
    <p role="status">{t('ui.providers.launch.preparing', {product: snapshot.selection?.productId.toUpperCase() ?? ''})}</p>
    <button type="button" className={button} onClick={() => {
      if (snapshot.packageUpdate?.phase === 'updating') controller?.cancelUpdate();
      else if (!start?.cancelDownload()) controller?.cancel();
    }}>{t('ui.providers.launch.cancel')}</button>
  </aside>}</ManagementSurfacePortal>;
}

function ProgressiveOggNotice() {
  const {t} = useLocale();
  const {controller,snapshot}=useGameLaunchJob(),live=useRuntimeSnapshot(),ogg=snapshot?.ogg;
  if(!ogg||ogg.epoch!==live?.epoch||!['installing','error'].includes(ogg.phase))return null;
  return <ManagementSurfacePortal>{docked => <aside aria-label={t('ui.providers.ogg.task')} className={`${docked ? '' : 'fixed bottom-3 right-3 z-30 max-w-sm'} rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu`}>
    <p role={ogg.error?'alert':'status'}>{ogg.error??t('ui.providers.ogg.progress', {completed: ogg.completed, total: ogg.total})}</p>
    {ogg.phase==='error'?<button type="button" className={button} onClick={()=>controller?.retryOgg()}>{t('ui.providers.ogg.retry')}</button>:<button type="button" className={button} onClick={()=>controller?.cancelOgg()}>{t('ui.providers.ogg.stop')}</button>}
  </aside>}</ManagementSurfacePortal>;
}

function LaunchPackageUpdateNotice() {
  const {t} = useLocale(), {controller, snapshot} = useGameLaunchJob();
  const update = snapshot?.packageUpdate;
  if (!update || !['waiting', 'error'].includes(update.phase)) return null;
  return <ManagementSurfacePortal>{docked => <aside aria-label={t('ui.providers.resources.task')} className={`${docked ? '' : 'fixed bottom-3 right-3 z-30 max-w-sm'} rounded-xl border border-line bg-panel p-3 text-sm text-paper shadow-menu`}>
    <p role={update.error ? 'alert' : 'status'}>{update.error ?? t('react.launch.backgroundWaiting')}</p>
    {update.phase === 'waiting'
      ? <button type="button" className={button} onClick={() => controller?.cancelUpdate()}>{t('ui.providers.resources.cancelTask')}</button>
      : <button type="button" className={button} onClick={() => controller?.dismissUpdate()}>{t('ui.providers.resources.acknowledge')}</button>}
  </aside>}</ManagementSurfacePortal>;
}
