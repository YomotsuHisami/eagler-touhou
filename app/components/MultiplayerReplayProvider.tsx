import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation} from 'react-router';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {useRuntimeService} from '../runtime/RuntimeHost';
import type {MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {MultiplayerReplayJob} from '../services/multiplayer-replay.client';
import type {PreferencesSnapshot} from '../services/preferences.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useLocale} from './LocaleProvider';
import {ManagementSurfacePortal} from './ManagementSurface';
import {useMidi} from './MidiProvider';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
const Context = createContext<MultiplayerReplayJob | null>(null);
type ReplayStartResult = 'started' | 'audio-prepared' | 'superseded';
interface ReplayActions {
  startReplay(productId: MultiplayerProductId, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null): Promise<ReplayStartResult>;
  cancelReplay(): void;
  starting: boolean;
  error: string | null;
  active: boolean;
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
    starting: actions?.starting ?? false, error: actions?.error ?? null, active: actions?.active ?? false};
}
/** One root-lifetime owner, mounted above the settings drawer and Replay route.
 * The viewIntent survives drawer unmount; route and room scopes fence its late
 * preparation result without creating another iframe or joining a room.
 */
export function MultiplayerReplayProvider({children}: {children: ReactNode}) {
  const {t} = useLocale(), fetchImpl = useDocumentRequestFetch();
  const location = useLocation();
  const runtime = useRuntimeService(), {controller: midi} = useMidi();
  const {controller: roomController, snapshot: room} = useMultiplayerRoom();
  const currentScope = JSON.stringify([location.key, location.pathname, location.search, location.hash]);
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
  const ports = useRef({runtime, midi, controller, service, currentScope, roomRevision: roomRevision.current.value, roomRoute: room?.route ?? null,
    roomController, pathname: location.pathname});
  ports.current = {runtime, midi, controller, service, currentScope, roomRevision: roomRevision.current.value, roomRoute: room?.route ?? null,
    roomController, pathname: location.pathname};

  function current(request: NonNullable<typeof viewIntent.current>) {
    const now = ports.current;
    return viewIntent.current === request && requestSerial.current === request.ticket && now.runtime === request.runtime && now.midi === request.midi &&
      now.controller === request.controller && now.service === request.service && now.roomController === request.roomController &&
      now.currentScope === request.currentScope && now.roomRevision === request.roomRevision && !now.roomRoute &&
      (now.pathname === `/play/${request.productId}` || now.pathname === `/play/${request.productId}/replays`);
  }

  function cancelReplay() {
    const request = viewIntent.current;
    if (!request) return;
    viewIntent.current = null;
    requestSerial.current++;
    request.controller.cancel();
    setStarting(false); setRequestError(null);
  }

  async function startReplay(productId: MultiplayerProductId, preferences: PreferencesSnapshot, touchLayout: TouchLayout | null): Promise<ReplayStartResult> {
    const selected = ports.current;
    if (viewIntent.current || !selected.runtime || !selected.midi || !selected.controller || !selected.service) return 'superseded';
    if (selected.roomRoute || selected.pathname !== `/play/${productId}` && selected.pathname !== `/play/${productId}/replays`) return 'superseded';
    const request = {ticket: ++requestSerial.current, productId, currentScope: selected.currentScope, roomRevision: selected.roomRevision,
      controller: selected.controller, runtime: selected.runtime, midi: selected.midi, service: selected.service, roomController: selected.roomController};
    viewIntent.current = request; setStarting(true); setRequestError(null);
    try {
      return await request.service.prepareAndStartMultiplayerReplay({
        prepare: () => request.controller.prepare(productId, preferences, touchLayout),
        preparedEpoch: () => request.controller.getSnapshot().preparedEpoch,
        runtime: request.runtime, midi: request.midi,
        currentIntent: () => current(request) && request.roomController?.getSnapshot().route == null,
      });
    } catch (reason) {
      if (current(request)) setRequestError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      if (viewIntent.current === request) {
        if (!current(request)) request.controller.cancel();
        viewIntent.current = null; setStarting(false);
      }
    }
  }

  useLayoutEffect(() => {
    const request = viewIntent.current;
    if (request && !current(request)) {
      viewIntent.current = null; requestSerial.current++;
      request.controller.cancel(); setStarting(false); setRequestError(null);
    }
  }, [currentScope, roomRevision.current.value, controller, service, runtime, midi]);
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
  const actions: ReplayActions = {startReplay, cancelReplay, starting, error: requestError, active: viewIntent.current !== null};
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
