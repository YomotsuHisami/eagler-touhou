import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation, useNavigation} from 'react-router';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {useRuntimeService} from '../runtime/RuntimeHost';
import type {MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {MultiplayerReplayJob} from '../services/multiplayer-replay.client';
import type {PreferencesSnapshot} from '../services/preferences.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useLocale} from './LocaleProvider';
import {playerIntentScope} from '../runtime/route-session.mts';
import {ManagementSurfacePortal} from './ManagementSurface';
import {useMidi} from './MidiProvider';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
import {useGameLaunchJob, usePackageUpdateChoice} from './GameLaunchProvider';
import {useResourceManager} from './ResourceManagerProvider';
import {prepareEntryPackageUpdate} from '../services/entry-package-update.client';
import {useGamePackageImporter} from './GamePackageImporterContext';
import {usePlayerSurface} from '../runtime/PlayerToolsSurface';
import {isGameDataAcquisitionFailure} from '../services/game-data-acquisition';
const Context = createContext<MultiplayerReplayJob | null>(null);
type ReplayStartResult = 'started' | 'audio-prepared' | 'superseded';
interface ReplayActions {
  startReplay(productId: MultiplayerProductId, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null): Promise<ReplayStartResult>;
  cancelReplay(): void;
  starting: boolean;
  error: string | null;
  active: boolean;
  recoverReplay(productId: MultiplayerProductId): boolean;
}
const ActionContext = createContext<ReplayActions | null>(null);
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function useMultiplayerReplay() {
  const controller = useContext(Context);
  const actions = useContext(ActionContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot, startReplay: actions?.startReplay ?? null, cancelReplay: actions?.cancelReplay ?? (() => {}),
    recoverReplay: actions?.recoverReplay ?? (() => false),
    starting: actions?.starting ?? false, error: actions?.error ?? null, active: actions?.active ?? false};
}
/** One root-lifetime owner, mounted above the settings drawer and Replay route.
 * The viewIntent survives drawer unmount; route and room scopes fence its late
 * preparation result without creating another iframe or joining a room.
 */
export function MultiplayerReplayProvider({children}: {children: ReactNode}) {
  const {t} = useLocale(), fetchImpl = useDocumentRequestFetch();
  const importer = useGamePackageImporter(), playerSurface = usePlayerSurface();
  const translate = useRef(t);translate.current = t;
  const location = useLocation(), navigation = useNavigation(), displayed = navigation.location ?? location;
  const runtime = useRuntimeService(), {controller: midi} = useMidi();
  const {controller: gameJob} = useGameLaunchJob();
  const {controller: resources} = useResourceManager(), choosePackageUpdate = usePackageUpdateChoice();
  const {controller: roomController, snapshot: room} = useMultiplayerRoom();
  const currentScope = playerIntentScope(displayed);
  const roomSignature = JSON.stringify(room?.route ?? null);
  const roomRevision = useRef({signature: roomSignature, value: 0});
  if (roomRevision.current.signature !== roomSignature) roomRevision.current = {signature: roomSignature, value: roomRevision.current.value + 1};
  const retained = useRef<ReturnType<typeof createPreparationDocumentOwner<MultiplayerReplayJob>> | null>(null);
  const epoch = useRef(0), previous = useRef(runtime);
  const [controller, setController] = useState<MultiplayerReplayJob | null>(null);
  const [service, setService] = useState<typeof import('../services/multiplayer-replay.client') | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false), [requestError, setRequestError] = useState<string | null>(null);
  const requestSerial = useRef(0), viewIntent = useRef<{ticket: number; productId: MultiplayerProductId; currentScope: string; roomRevision: number;
    controller: MultiplayerReplayJob; runtime: NonNullable<typeof runtime>; midi: NonNullable<typeof midi>; service: NonNullable<typeof service>;
    roomController: typeof roomController} | null>(null);
  const ports = useRef({runtime, midi, gameJob, resources, choosePackageUpdate, controller, service, currentScope, roomRevision: roomRevision.current.value, roomRoute: room?.route ?? null,
    roomController, pathname: location.pathname});
  ports.current = {runtime, midi, gameJob, resources, choosePackageUpdate, controller, service, currentScope, roomRevision: roomRevision.current.value, roomRoute: room?.route ?? null,
    roomController, pathname: location.pathname};

  type ReplayRequest = NonNullable<typeof viewIntent.current>;
  type Recovery = {request: ReplayRequest; preferences: PreferencesSnapshot; touchLayout: TouchLayout | null; reason: string; release(): void};
  const failedReplay = useRef<Omit<Recovery,'release'> | null>(null), recovery = useRef<Recovery | null>(null);
  function sameScope(request: ReplayRequest) {
    const now = ports.current;
    return requestSerial.current === request.ticket && now.runtime === request.runtime && now.midi === request.midi &&
      now.controller === request.controller && now.service === request.service && now.roomController === request.roomController &&
      now.currentScope === request.currentScope && now.roomRevision === request.roomRevision && !now.roomRoute &&
      (now.pathname === `/play/${request.productId}` || now.pathname === `/play/${request.productId}/replays`);
  }
  function current(request: ReplayRequest) {return viewIntent.current === request && sameScope(request);}
  function finishRecovery(record: Recovery) {if (recovery.current === record) recovery.current = null;record.release();}
  function recoverReplay(productId: MultiplayerProductId) {
    const failed = failedReplay.current;
    if (!failed || failed.request.productId !== productId || !sameScope(failed.request) || !importer) return false;
    failedReplay.current = null;
    const record: Recovery = {...failed, release: playerSurface?.beginStart(cancelReplay) ?? (() => {})};
    const previous = recovery.current;recovery.current = record;previous?.release();
    const valid = () => recovery.current === record && sameScope(record.request) && ports.current.roomController?.getSnapshot().route == null;
    const opened = importer(productId, {reason: record.reason, onDismiss: () => finishRecovery(record), onImported: async imported => {
      if (imported !== productId || !valid()) {finishRecovery(record);return;}
      try {
        await ports.current.resources?.inspect(productId);await record.request.controller.inspect(productId);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!valid()) return;
        viewIntent.current = record.request;setStarting(true);
        await runReplay(record.request, record.preferences, record.touchLayout);
      } catch (error) {
        if (valid() && isGameDataAcquisitionFailure(error)) recoverReplay(productId);
        else if (valid()) setRequestError(error instanceof Error ? error.message : String(error));
      } finally {finishRecovery(record);}
    }});
    if (!opened) finishRecovery(record);return opened;
  }

  function cancelReplay() {
    importer?.dismiss?.();
    if (recovery.current) finishRecovery(recovery.current);failedReplay.current = null;
    const request = viewIntent.current;
    if (!request) {requestSerial.current++;setStarting(false);setRequestError(null);return;}
    viewIntent.current = null;
    requestSerial.current++;
    request.controller.cancel();
    setStarting(false); setRequestError(null);
  }

  async function startReplay(productId: MultiplayerProductId, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null): Promise<ReplayStartResult> {
    const selected = ports.current;
    if (viewIntent.current || recovery.current || !selected.runtime || !selected.midi || !selected.controller || !selected.service) return 'superseded';
    if (selected.roomRoute || selected.pathname !== `/play/${productId}` && selected.pathname !== `/play/${productId}/replays`) return 'superseded';
    const request = {ticket: ++requestSerial.current, productId, currentScope: selected.currentScope, roomRevision: selected.roomRevision,
      controller: selected.controller, runtime: selected.runtime, midi: selected.midi, service: selected.service, roomController: selected.roomController};
    viewIntent.current = request; setStarting(true); setRequestError(null);
    failedReplay.current = null;
    return runReplay(request, structuredClone(preferences), structuredClone(touchLayout));
  }
  async function runReplay(request: ReplayRequest, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null): Promise<ReplayStartResult> {
    const productId = request.productId;
    try {
      return await request.service.prepareAndStartMultiplayerReplay({
        prepare: () => request.controller.prepare(productId, preferences, touchLayout),
        preparedEpoch: () => request.controller.getSnapshot().preparedEpoch,
        runtime: request.runtime, midi: request.midi,
        currentIntent: () => current(request) && request.roomController?.getSnapshot().route == null,
      });
    } catch (reason) {
      if (current(request)) setRequestError(reason instanceof Error ? reason.message : String(reason));
      if (current(request) && isGameDataAcquisitionFailure(reason)) failedReplay.current = {request, preferences, touchLayout, reason: reason instanceof Error ? reason.message : String(reason)};
      throw reason;
    } finally {
      if (viewIntent.current === request) {
        if (!current(request)) request.controller.cancel();
        viewIntent.current = null; setStarting(false);
      }
    }
  }

  useLayoutEffect(() => {
    if (recovery.current && !sameScope(recovery.current.request)) finishRecovery(recovery.current);
    if (failedReplay.current && !sameScope(failedReplay.current.request)) failedReplay.current = null;
    const request = viewIntent.current;
    if (request && !current(request)) {
      viewIntent.current = null; requestSerial.current++;
      request.controller.cancel(); setStarting(false); setRequestError(null);
    }
  }, [currentScope, roomRevision.current.value, controller, service, runtime, midi]);
  useLayoutEffect(() => () => {if (recovery.current) finishRecovery(recovery.current);failedReplay.current = null;}, []);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createPreparationDocumentOwner<MultiplayerReplayJob>({target: window,
      ready: () => !!ports.current.runtime && !!ports.current.midi && !!ports.current.gameJob,
      load: async () => {
        const module = await import('../services/multiplayer-replay.client');
        return () => {
          const selected = ports.current;
          if (!selected.runtime) throw new Error('Runtime is not ready');
          let offlineStorage: Storage | null = null;
          try {offlineStorage = window.localStorage;} catch {}
          const job = module.createMultiplayerReplayJob({fetchImpl, offlineStorage, runtimeService: selected.runtime,
            baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href,
            audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            midiAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            prepareMidi: signal => {if (!ports.current.midi) throw new Error('MIDI service is not ready'); return ports.current.midi.ensureReady(signal);},
            onPreparedOgg: seed => {if (!ports.current.gameJob) throw Error('The shared OGG acquisition owner is unavailable');ports.current.gameJob.armOgg(seed);},
            preparePackageUpdate: (productId, signal, stepCurrent) => {
              const intent = viewIntent.current;
              return prepareEntryPackageUpdate({productId, signal, current: () => stepCurrent() && !!intent && intent.productId === productId && current(intent),
                owner: ports.current.resources, choose: ports.current.choosePackageUpdate,
                onFailure: error => setRequestError(translate.current('package.updateFailed', {reason: error instanceof Error ? error.message : String(error)}))});
            },
            onPreparedPackageUpdate: (update, epoch, generationId) => {ports.current.gameJob?.armPackageUpdate({...update, expectedGenerationId: generationId}, epoch);},
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
  }, [runtime, midi, gameJob]);
  const actions: ReplayActions = {startReplay, recoverReplay, cancelReplay, starting, error: requestError, active: viewIntent.current !== null || recovery.current !== null};
  return <Context.Provider value={controller}><ActionContext.Provider value={actions}>{children}
    {error && <p role="alert">{t('ui.multiplayerReplay.unavailable', {reason: error})}</p>}
    <MultiplayerReplayNotice/>
  </ActionContext.Provider></Context.Provider>;
}
function MultiplayerReplayNotice() {
  const {t} = useLocale(), {snapshot, starting, error, active, cancelReplay} = useMultiplayerReplay();
  const noticeError = error ?? snapshot?.error ?? null;
  if (!active && !snapshot?.preparing && !noticeError) return null;
  return <ManagementSurfacePortal>{docked => <aside aria-label={t('ui.multiplayerReplay.title')} className={`${docked ? '' : 'fixed right-3 bottom-3 left-3 z-30 sm:left-auto sm:max-w-lg'} flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu`}>
    {snapshot?.preparing ? <p role="status">{t('ui.multiplayerReplay.preparing', {game: snapshot.selection?.productId.toUpperCase() ?? ''})}</p>
      : starting ? <p role="status">{t('ui.multiplayerReplay.starting')}</p> : null}
    {snapshot?.preparing && active && <button type="button" className={button} onClick={cancelReplay}>{t('ui.providers.launch.cancel')}</button>}
    {snapshot?.warnings.map((warning, index) => <p key={index} role="status" className="basis-full text-accent">{warning}</p>)}
    {noticeError && <p role="alert" className="basis-full text-accent">{noticeError}</p>}
  </aside>}</ManagementSurfacePortal>;
}
