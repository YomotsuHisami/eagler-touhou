import {LaunchWarnings, useLaunchWarningGate} from './LaunchWarnings';
import {browserLaunchInputDevice, launchInputWarnings} from '../services/launch-warnings';
import {useLocale} from './LocaleProvider';
import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation, useNavigate} from 'react-router';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {parseMultiplayerRoomRoute} from '../services/multiplayer-room-route';
import type {MultiplayerRoomController, MultiplayerRoomRuntimePort} from '../services/multiplayer-room.client';
import {useGamePreferences} from './GameSettingsProvider';
import {useRuntimeService} from '../runtime/RuntimeHost';
import {useMidi} from './MidiProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useResourceManager} from './ResourceManagerProvider';
import {gameIdForProduct} from '../../src/contracts/product-catalog.mts';
import {useGamePackageImporter} from './GamePackageImporterContext';
import {MultiplayerCalibration} from './MultiplayerCalibration';
import type {MultiplayerLaunchController} from '../services/multiplayer-launch.client';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {TitleRoomEntry, useTitleRoomEntry} from './TitleRoomEntry';
const Context = createContext<MultiplayerRoomController | null>(null);
const LaunchContext = createContext<MultiplayerLaunchController | null>(null);
const none = () => () => {};
const empty = () => null;
export const createMultiplayerRoomDocumentOwner = createPreparationDocumentOwner<MultiplayerRoomController>;
/** Mount inside GameSettingsProvider, once above route content. */
export function MultiplayerRoomProvider({children, runtimePort}: {children: ReactNode; runtimePort?: MultiplayerRoomRuntimePort}) {
  const {t} = useLocale(), warningGate = useLaunchWarningGate();
  const fetchImpl = useDocumentRequestFetch();
  const location = useLocation(), navigate = useNavigate();
  const runtime = useRuntimeService(), titleEntry = useTitleRoomEntry(runtime);
  const openPackageImporter = useGamePackageImporter();
  const route = parseMultiplayerRoomRoute(location.pathname, location.search, titleEntry.snapshot?.source?.epoch);
  const {store, settings} = useGamePreferences(route?.productId ?? titleEntry.snapshot?.source?.productId ?? 'th06mp');
  const {controller: midi} = useMidi(), layout = useTouchLayoutSnapshot();
  const {controller: resources, snapshot: resourceSnapshot} = useResourceManager();
  const [controller, setController] = useState<MultiplayerRoomController | null>(null);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<ReturnType<typeof createMultiplayerRoomDocumentOwner> | null>(null), epoch = useRef(0);
  const port = useRef(runtimePort); port.current = runtimePort;
  const [launchController, setLaunchController] = useState<MultiplayerLaunchController | null>(null);
  const launchOwner = useRef<ReturnType<typeof createPreparationDocumentOwner<MultiplayerLaunchController>> | null>(null);
  const launchEpoch = useRef(0), previousRuntime = useRef(runtime);
  const ports = useRef({runtime, midi, store, controller, titleEntry: titleEntry.controller, layout: layout?.saved ?? null});
  ports.current = {runtime, midi, store, controller, titleEntry: titleEntry.controller, layout: layout?.saved ?? null};
  const inspected = useRef<string | null>(null), preferencesKey = useRef<string | null>(null);
  const automaticPreparation = useRef<string | null>(null), importerRoom = useRef<string | null>(null);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    const owner = retained.current ?? createMultiplayerRoomDocumentOwner({target: window,
      load: async () => {const {createMultiplayerRoom} = await import('../services/multiplayer-room.client'); return () => createMultiplayerRoom({fetchImpl, baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href, runtime: port.current});},
      onController: next => {setController(next); if (next) setError(null);},
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    retained.current = owner; owner.attach();
    return () => {owner.detach(); queueMicrotask(() => {if (epoch.current === effect) {owner.dispose(); if (retained.current === owner) retained.current = null;}});};
  }, []);
  useLayoutEffect(() => {
    const effect = ++launchEpoch.current;
    const owner = launchOwner.current ?? createPreparationDocumentOwner<MultiplayerLaunchController>({target: window,
      ready: () => !!ports.current.runtime && !!ports.current.midi && !!ports.current.store && !!ports.current.controller,
      load: async () => {
        const {createMultiplayerLaunch} = await import('../services/multiplayer-launch.client');
        return () => {
          const current = ports.current;
          if (!current.runtime || !current.store || !current.midi) throw Error('多人 Runtime 依赖尚未就绪');
          const next = createMultiplayerLaunch({fetchImpl, baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href,
            runtimeService: current.runtime, audioAvailable: 'AudioContext' in window || 'webkitAudioContext' in window,
            midiAvailable: 'AudioContext' in window || 'webkitAudioContext' in window, userAgent: navigator.userAgent,
            getPreferences: productId => ports.current.store?.getSnapshot(productId) ?? null,
            getTouchLayout: () => ports.current.layout,
            confirmInputWarnings: (settings, request, signal, current, stage, _epoch, onAccept) => warningGate.request({
              warnings: launchInputWarnings(settings, browserLaunchInputDevice()).filter(warning =>
                !(stage === 'preparation' && warning === 'music.midiLaunchWarning')), signal,
              current: () => {
                const selected = ports.current.controller?.getSnapshot();
                return current() && selected?.connection === 'connected' && selected.preparation?.status === 'ready' && selected.launch === 'starting' && selected.route?.productId === request.productId && selected.route.roomCode === request.roomCode &&
                  selected.startSerial === request.serial && selected.room?.phase !== 'lobby' && selected.room?.localSeat === request.options.netplayPlayer;
              }, accept: () => onAccept?.(),
            }),
            retainedTitle: {
              retains: productId => ports.current.titleEntry?.retains(productId) ?? false,
              retire: (request, signal) => {const owner = ports.current.titleEntry; if (!owner) throw Error('Title room entry is no longer available.'); return owner.retire(request, signal);},
            },
            prepareMidi: signal => {if (!ports.current.midi) throw Error('MIDI 服务尚未就绪'); return ports.current.midi.ensureReady(signal);},
            prepareMidiAtLaunch: (epoch, current) => {
              const owner = ports.current.midi;
              if (!owner) throw Error('MIDI 服务尚未就绪');
              try {void owner.resumeForGesture(epoch).catch(() => {});} catch {}
              return owner.prepareExternalMidi(epoch, current);
            },
            onTiming: (serial, value) => {
              const active = next.getSnapshot().active, room = ports.current.controller;
              const selected = room?.getSnapshot().route;
              if (active && selected?.productId === active.productId && selected.roomCode === active.roomCode) room?.acceptMeasuredTiming(value, serial);
            },
            onRuntimeEnd: active => {
              const room = ports.current.controller, selected = room?.getSnapshot().route;
              if (selected?.productId === active.productId && selected.roomCode === active.roomCode) room?.runtimeExited(active.serial);
            },
          });
          return next;
        };
      },
      onController: next => setLaunchController(next),
      onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    });
    launchOwner.current = owner;
    if (previousRuntime.current !== runtime) {previousRuntime.current = runtime; owner.reset();}
    owner.attach();
    return () => {owner.detach(); queueMicrotask(() => {if (launchEpoch.current === effect) {owner.dispose(); if (launchOwner.current === owner) launchOwner.current = null;}});};
  }, [runtime, midi, store, controller]);
  useLayoutEffect(() => {controller?.setRuntimePort(runtimePort ?? launchController ?? undefined);}, [controller, runtimePort, launchController]);
  useEffect(() => {
    if (!route || !resources || resourceSnapshot?.operation || resourceSnapshot?.inspections[gameIdForProduct(route.productId)] || inspected.current === route.productId) return;
    inspected.current = route.productId;
    void resources.inspect(route.productId).catch(() => {});
  }, [route?.productId, resources, resourceSnapshot?.operation, resourceSnapshot?.inspections]);
  useLayoutEffect(() => {
    const key = settings ? JSON.stringify({settings, touchLayout: layout?.saved ?? null}) : null;
    if (preferencesKey.current !== null && preferencesKey.current !== key) controller?.invalidatePreparation();
    preferencesKey.current = key;
  }, [controller, settings, layout?.saved]);
  useLayoutEffect(() => {
    if (!controller) return;
    const selected = parseMultiplayerRoomRoute(location.pathname, location.search, titleEntry.snapshot?.source?.epoch);
    titleEntry.controller?.setRoute(selected);
    if (!selected) {controller.setRoute(null); return;}
    const previous = controller.getSnapshot().route;
    if (previous && (previous.productId !== selected.productId || previous.roomCode !== selected.roomCode)) controller.setRoute(null);
    // Wait for this product's real movement preference before auto-seating.
    if (!settings || settings.productId !== selected.productId) return;
    controller.setRoute(selected);
    controller.setInput({movementMode: settings.options.touchMovementMode, touchEnabled: settings.options.touchEnabled,
      mobileDevice: navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches});
  }, [controller, location.pathname, location.search, settings, titleEntry.controller, titleEntry.snapshot?.source]);
  useEffect(() => {
    if (!route) {automaticPreparation.current = null; return;}
    if (!controller || !snapshot?.room || snapshot.connection !== 'connected' || snapshot.room.phase !== 'lobby' ||
        !snapshot.runtimeAvailable || snapshot.preparation) {
      if (!snapshot?.runtimeAvailable) automaticPreparation.current = null;
      return;
    }
    const key = `${snapshot.sessionSerial}:${route.productId}:${route.roomCode}:${JSON.stringify({settings, touchLayout: layout?.saved ?? null})}`;
    if (automaticPreparation.current === key) return;
    automaticPreparation.current = key;
    void controller.prepare();
  }, [controller, route?.productId, route?.roomCode, snapshot?.sessionSerial, snapshot?.room, snapshot?.connection, snapshot?.runtimeAvailable, snapshot?.preparation, settings, layout?.saved]);
  useEffect(() => {
    const activeRoute = snapshot?.route;
    if (!route || !activeRoute || route.productId !== activeRoute.productId || route.roomCode !== activeRoute.roomCode ||
        snapshot.connection !== 'connected' || snapshot.room?.phase !== 'lobby') {if (!route) importerRoom.current = null; return;}
    if (!controller || snapshot.preparation?.status !== 'failed' || !openPackageImporter) return;
    const sessionSerial = snapshot.sessionSerial;
    const key = `${sessionSerial}:${activeRoute.productId}:${activeRoute.roomCode}`;
    if (importerRoom.current === key) return;
    importerRoom.current = key;
    const stillSameRoom = () => {
      const current = controller.getSnapshot();
      return current.sessionSerial === sessionSerial && current.route?.productId === activeRoute.productId && current.route.roomCode === activeRoute.roomCode &&
        current.connection === 'connected' && current.room?.phase === 'lobby';
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!stillSameRoom()) return;
      openPackageImporter(activeRoute.productId, {
        reason: snapshot.error ?? t('ui.multiplayer.resourcesFailed'),
        onImported: async productId => {
          if (!stillSameRoom() || productId !== activeRoute.productId) return;
          try {
            await resources?.inspect(productId);
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            if (stillSameRoom()) await controller.prepare();
          } catch { /* The room snapshot reports the retry failure. */ }
        },
      });
    }));
  }, [controller, route?.productId, route?.roomCode, snapshot?.sessionSerial, snapshot?.route, snapshot?.connection, snapshot?.room, snapshot?.preparation?.status, snapshot?.error, openPackageImporter, resources, t]);
  useLayoutEffect(() => {
    if (!snapshot?.consumedIntent || !route || route.productId !== snapshot.route?.productId || route.roomCode !== snapshot.route.roomCode) return;
    const query = new URLSearchParams(location.search);
    if (!query.has('lobbyAction')) return;
    for (const key of ['lobbyAction', 'lobbyPlayers', 'lobbyDifficulty', 'lobbyVisibility', 'lobbyDisableCheatMovement', 'lobbyChallengeMode']) query.delete(key);
    void navigate({pathname: location.pathname, search: query.toString(), hash: location.hash}, {replace: true, state: location.state});
  }, [snapshot?.consumedIntent, snapshot?.route, location, navigate]);
  useLayoutEffect(() => {
    if (!controller) return;
    const network = (navigator as Navigator & {connection?: EventTarget}).connection;
    const reconnect = () => {if (controller.getSnapshot().route) controller.retry();};
    const visible = () => {if (document.visibilityState === 'visible' && controller.getSnapshot().connection !== 'connected') reconnect();};
    const activity = (event: Event) => {if (event.isTrusted && document.visibilityState === 'visible') controller.noteActivity();};
    window.addEventListener('online', reconnect); network?.addEventListener('change', reconnect);
    document.addEventListener('visibilitychange', visible); document.addEventListener('pointerdown', activity, {passive: true}); document.addEventListener('keydown', activity);
    return () => {window.removeEventListener('online', reconnect); network?.removeEventListener('change', reconnect); document.removeEventListener('visibilitychange', visible); document.removeEventListener('pointerdown', activity); document.removeEventListener('keydown', activity);};
  }, [controller]);
  return <Context.Provider value={controller}><LaunchContext.Provider value={launchController}>{children}<LaunchWarnings gate={warningGate}/>{(titleEntry.error || (error && route)) && <div role="alert"><p>{t('ui.providers.room.unavailable')}{titleEntry.error ?? error}</p>{titleEntry.error && <button type="button" onClick={titleEntry.retry} className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm">{t('action.retry')}</button>}</div>}<MultiplayerCalibration/><TitleRoomEntry controller={titleEntry.controller} snapshot={titleEntry.snapshot} roomController={controller} roomSnapshot={snapshot} runtime={runtime}/></LaunchContext.Provider></Context.Provider>;
}
export function useMultiplayerRoom() {
  const controller = useContext(Context);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}

export function useMultiplayerLaunch() {
  const controller = useContext(LaunchContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  return {controller, snapshot};
}
